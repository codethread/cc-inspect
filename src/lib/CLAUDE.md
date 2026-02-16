# Claude SDK (src/lib/)

## Overview

Self-contained SDK for parsing Claude Code `.jsonl` session logs. Designed for future extraction as a standalone npm library. Lives under `claude/`.

`src/types.ts` (one level up) re-exports all SDK types via `export * from "./lib/claude"` so the `#types` import alias works project-wide. It also defines app-level API response schemas (discriminated unions) for the server-frontend contract.

## Public API

Via the `Claude` class in `claude/index.ts`:

```ts
const claude = new Claude({ path: '/absolute/path/to/projects/dir' })
const projects: ProjectHandle[] = await claude.listProjects()
const sessions: SessionHandle[] = await claude.listSessions(project)
const sessionData: SessionData = await claude.parseSession(session)
```

## Files

- `claude/index.ts` — `Claude` class + re-exports (public entry point)
- `claude/types.ts` — All Zod schemas and inferred types for the log domain (LogEntry, Event, AgentNode, SessionData, ProjectHandle, SessionHandle)
- `claude/parser.ts` — Pure parsing functions (internal). Uses `FileReader` interface for DI to enable testing without filesystem access
- `claude/errors.ts` — `ParseError` class with detailed debugging info (line numbers, Zod errors, actual values)
- `claude/__tests__/` — Test suite with fixtures derived from real session logs

## Key Patterns

- `FileReader` DI interface (`readText`, `exists`) abstracts file reading; `bunFileReader` is the default Bun implementation
- `ProjectHandle` and `SessionHandle` are lightweight descriptors with pre-computed absolute paths
- `listProjects`/`listSessions` use `node:fs/promises` directly; only `.jsonl` content parsing uses `FileReader`

## Claude Code Log File Format

Claude Code stores session logs under `~/.claude/projects/<project-id>/`. Understanding the file layout and log entry structure is essential for working on the parser.

### File Layout

```
~/.claude/projects/
  <project-id>/
    <session-id>.jsonl              # Main session log
    <session-id>/
      subagents/
        agent-<agent-id>.jsonl      # Sub-agent log (one per spawned agent)
```

- Each **project** is a directory named by a project-specific ID
- Each **session** is a `.jsonl` file at the project root (files starting with `agent-` are excluded from session listing)
- Each **sub-agent** gets its own `.jsonl` in the `<session-id>/subagents/` directory

### Log Entry Structure

Each line in a `.jsonl` file is a JSON object validated against `LogEntrySchema`. The `type` field determines the entry kind:

| `type` | Role | Key fields |
|---|---|---|
| `"user"` | User turn (prompt or tool result) | `uuid`, `parentUuid`, `timestamp`, `message` (with `role: "user"`) |
| `"assistant"` | Model response | `uuid`, `parentUuid`, `timestamp`, `message` (with `role: "assistant"`, `model`) |
| `"summary"` | Context window summary | `summary`, `leafUuid`, `timestamp` |

Other `type` values (e.g. `"queue-operation"`) are silently skipped by the parser.

### Message Content Model

The `message.content` field is either a plain string or an array of content blocks. Each block has a `type` discriminator:

| Content type | Found in | Description |
|---|---|---|
| `"text"` | user, assistant | Plain text message |
| `"thinking"` | assistant | Model's chain-of-thought (with optional `signature`) |
| `"tool_use"` | assistant | Tool invocation: `id`, `name`, `input` |
| `"tool_result"` | user | Tool output: `tool_use_id`, `content`, `is_error` |
| `"image"` | user | Base64-encoded image |

### Conversation Flow

A typical exchange follows this pattern in the log:

```
user    → { content: "Do something" }
assistant → { content: [thinking, text, tool_use(id="tu1", name="Read", input={...})] }
user    → { content: [tool_result(tool_use_id="tu1", content="file contents")] }
assistant → { content: [text("Done.")] }
```

Key relationships:
- `parentUuid` links each entry to its causal predecessor, forming a chain
- `tool_use.id` in an assistant message matches `tool_result.tool_use_id` in the subsequent user message — this is how tool calls are paired with their results
- An assistant message can contain multiple `tool_use` blocks; the next user message will contain a corresponding `tool_result` for each

### Tool Use Result Metadata

User entries carrying tool results also have a top-level `toolUseResult` field (separate from `message.content`). This contains execution metadata:

```json
{
  "toolUseResult": {
    "status": "completed",
    "agentId": "abc1234",
    "prompt": "...",
    "totalDurationMs": 5000,
    "totalTokens": 1200,
    "totalToolUseCount": 3,
    "stdout": "...",
    "stderr": "..."
  }
}
```

The `agentId` field here is the primary signal for discovering sub-agents (see below). Other fields provide tool-specific metadata (file results, grep results, bash output, etc.).

`toolUseResult` can be a single object, an array (first element is used), or a string (ignored).

### Sub-Agent Discovery and Tree Building

Sub-agents are spawned via the `Task` tool. The parser reconstructs the agent tree through a multi-step correlation:

1. **Find agent IDs**: scan main log `user` entries for `toolUseResult.agentId` — each unique ID is a sub-agent
2. **Load agent logs**: for each discovered ID, load `<session-id>/subagents/agent-<id>.jsonl`
3. **Extract agent metadata**: correlate the tool result back to the original `tool_use` to get `description`, `model`, `subagent_type`:
   - Find the `user` entry whose `toolUseResult.agentId` matches
   - Extract `tool_use_id` from the `tool_result` content block in that entry
   - Search backward through `assistant` entries for a `tool_use` block with matching `id` and `name === "Task"`
   - Read `input.description`, `input.model`, `input.subagent_type` from that tool use
4. **Build tree**: main agent is the root; each sub-agent becomes a child node with its own parsed events

### Resumed Agents

When a `Task` tool call includes a `resume` parameter (containing an existing agent ID), the agent's events appear in two places:

- **Agent's own log file** — events from the original invocation
- **Main session log** — events after the resume point

The parser combines both sources and sorts chronologically. The `isResumed` and `resumedFrom` fields on `AgentNode` track this relationship.

Detection: a `tool_use` with `name === "Task"` and `"resume" in input` signals a resume. The `input.resume` value is the agent ID being resumed.

### Output Data Model

The parser transforms raw log entries into a structured output:

- **`SessionData`** — top-level container with `sessionId`, `mainAgent` (root of agent tree), `allEvents` (flat chronological list), `logDirectory`
- **`AgentNode`** — recursive tree node: `id`, `name`, `model`, `subagentType`, `description`, `parent`, `children`, `events`, `logPath`
- **`Event`** — normalized event with `id`, `parentId`, `timestamp`, `sessionId`, `agentId`, `type`, `data`

Event types (discriminated union on `data.type`):
- `user-message` — user text input
- `assistant-message` — model text output
- `tool-use` — tool invocation with `toolName`, `toolId`, `input`
- `tool-result` — tool output with `toolUseId`, `success`, `output`, optional `agentId`
- `thinking` — model chain-of-thought
- `agent-spawn` — agent creation event (synthetic, derived from tool-use of Task tool)
- `summary` — context window compaction summary

## Testing

- `bun test` runs the SDK test suite
- Tests use table-driven style (`it.each`) with shared factory functions
- `__tests__/fixtures/` contains `.jsonl` fixtures derived from real session logs
- Fixtures cover: simple sessions (text + tool use + summary), sessions with sub-agents (Task tool spawning), malformed input
