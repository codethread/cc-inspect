# Plan: Extract Claude Code SDK to `src/lib/claude/`

## Requirements Brief

Separate the Claude Code log-parsing domain logic from the cc-inspect application code. All Claude-specific parsing, types, and data access should live in `src/lib/claude/`, designed for future extraction as a standalone npm library. The application server and frontend become thin consumers of this SDK.

The SDK exposes a stateful `Claude` class with instance methods:

```ts
const claude = new Claude({ path: '/absolute/path/to/projects/dir' })

const projects: ProjectHandle[] = await claude.listProjects()
const sessions: SessionHandle[] = await claude.listSessions(project)
const sessionData: SessionData = await claude.parseSession(session)
```

All paths must be absolute. Handles are lightweight descriptors with `id` and `path` for projects, plus `sessionFilePath` and `sessionAgentDir` for sessions. `sessionAgentDir` is always populated as the expected path (may not exist on disk).

No `parseAll()` method — the three methods above are the complete public API.

The SDK must be self-contained (no imports from outside `src/lib/claude/`). It must favour pure functions, dependency injection for IO (to enable testing), strict Zod validation at IO boundaries, and discriminated union types throughout.

A test suite using bun's built-in test runner must cover the SDK's parsing logic, using fixture data derived from real session logs.

---

## Current Architecture

```
src/
├── types.ts                    # ALL types (raw log, events, agents, API responses)
├── server/
│   ├── index.tsx               # Bun server + CLI
│   ├── parser.ts               # All parsing logic
│   ├── utils.ts                # CLAUDE_PROJECTS_DIR, path validation
│   └── routes/
│       ├── directories.ts      # GET /api/directories
│       ├── sessions.ts         # GET /api/sessions
│       ├── session.ts          # GET /api/session
│       └── session-delete.ts   # DELETE /api/session/delete
└── frontend/
    ├── App.tsx
    ├── api.ts                  # TanStack Query hooks
    ├── frontend.tsx
    └── components/
        ├── GraphTimeline.tsx
        ├── EventDetailsPanel.tsx
        ├── Header.tsx
        ├── AgentTree.tsx
        └── EventList.tsx
```

### Key Observations From Real Session Logs

Explored session files at `~/.claude/projects/-Users-adamhall-dev-projects-cc-inspect/`.

**Log entry types observed**: `user`, `assistant`, `summary`, `progress`, `system`, `queue-operation`
- Parser currently handles: `user`, `assistant`, `summary` (skips others silently)

**Directory structure**:
```
<projects-dir>/
└── <project-folder-name>/         # e.g. -Users-adamhall-dev-projects-cc-inspect
    ├── <session-uuid>.jsonl       # main session log
    └── <session-uuid>/
        └── subagents/
            └── agent-<short-id>.jsonl
```

**Agent spawning flow**:
1. Assistant message contains `tool_use` with `name: "Task"` and `input: {description, prompt, subagent_type, model?}`
2. User message contains `tool_result` with matching `tool_use_id`, plus `toolUseResult` object with `{agentId, content, prompt, status, totalDurationMs, totalTokens, totalToolUseCount, usage}`
3. Agent's own log file at `<session-uuid>/subagents/agent-<agentId>.jsonl` contains the agent's internal conversation

**`toolUseResult` shapes**: Can be `object`, `string`, or `array` — parser normalizes via `normalizeToolUseResult()`

---

## Target Architecture

```
src/
├── types.ts                        # Re-exports from SDK + app-level API response types
├── lib/
│   └── claude/
│       ├── index.ts                # Claude class (public SDK entry point)
│       ├── types.ts                # All Zod schemas + inferred types for Claude log domain
│       ├── parser.ts               # Pure parsing functions (internal)
│       ├── errors.ts               # ParseError class
│       └── __tests__/
│           ├── parser.test.ts      # Unit tests for parsing functions
│           ├── claude.test.ts      # Integration tests for Claude class
│           └── fixtures/           # .jsonl test fixture files
│               ├── simple-session.jsonl
│               ├── session-with-agents.jsonl
│               ├── session-with-agents/
│               │   └── subagents/
│               │       ├── agent-abc1234.jsonl
│               │       └── agent-def5678.jsonl
│               └── malformed.jsonl
├── server/
│   ├── index.tsx                   # Bun server + CLI (uses Claude SDK)
│   ├── utils.ts                    # CLAUDE_PROJECTS_DIR, path validation (server security)
│   └── routes/
│       ├── directories.ts          # Thin wrapper around claude.listProjects()
│       ├── sessions.ts             # Thin wrapper around claude.listSessions()
│       ├── session.ts              # Thin wrapper around claude.parseSession()
│       └── session-delete.ts       # Unchanged (delete is not an SDK concern)
└── frontend/                       # Unchanged (imports from #types still work)
```

---

## SDK Public API

### `src/lib/claude/index.ts`

```ts
import type { SessionData, AgentNode, Event } from "./types"

/** Lightweight descriptor for a project directory */
interface ProjectHandle {
  /** Project folder name (e.g. "-Users-adamhall-dev-projects-cc-inspect") */
  id: string
  /** Absolute path to the project directory */
  path: string
}

/** Lightweight descriptor for a session within a project */
interface SessionHandle {
  /** Session UUID (filename without .jsonl extension) */
  id: string
  /** Absolute path to the session .jsonl file */
  sessionFilePath: string
  /** Absolute path to the expected subagents directory (may not exist) */
  sessionAgentDir: string
}

interface ClaudeOptions {
  /** Absolute path to the Claude projects base directory */
  path: string
}

class Claude {
  constructor(options: ClaudeOptions)

  /** List project directories that contain at least one session file */
  listProjects(): Promise<ProjectHandle[]>

  /** List session files within a project directory */
  listSessions(project: ProjectHandle): Promise<SessionHandle[]>

  /** Parse a session into a full agent tree with chronological events */
  parseSession(session: SessionHandle): Promise<SessionData>
}
```

### Re-exports from `index.ts`

```ts
// Types consumers need
export type { ProjectHandle, SessionHandle, ClaudeOptions }
export { Claude }
export { ParseError } from "./errors"

// Re-export all domain types
export * from "./types"
```

---

## File-by-File Plan

### 1. Create `src/lib/claude/types.ts`

**Move from `src/types.ts`** — all Zod schemas and inferred types for the Claude log domain:

**Raw log schemas** (lines 6–132 of current `src/types.ts`):
- `UsageSchema`, `TextContentSchema`, `ThinkingContentSchema`, `ToolUseContentSchema`, `ImageContentSchema`, `ToolResultContentSchema`, `MessageContentSchema`
- `FileResultSchema`, `ImageFileResultSchema`, `ToolUseResultSchema`
- `MessageSchema`, `ThinkingMetadataSchema`, `LogEntrySchema`
- All corresponding inferred types

**Processed event schemas** (lines 150–265):
- `UserMessageDataSchema`, `AssistantMessageDataSchema`, `ToolUseDataSchema`, `ToolResultDataSchema`, `ThinkingDataSchema`, `AgentSpawnDataSchema`, `SummaryDataSchema`
- `EventDataSchema`, `EventTypeSchema`, `EventSchema`
- `AgentNode` type + `AgentNodeSchema`
- `SessionDataSchema`
- All corresponding inferred types

**New types to add**:

```ts
export const ProjectHandleSchema = z.object({
  id: z.string(),
  path: z.string(),
})
export type ProjectHandle = z.infer<typeof ProjectHandleSchema>

export const SessionHandleSchema = z.object({
  id: z.string(),
  sessionFilePath: z.string(),
  sessionAgentDir: z.string(),
})
export type SessionHandle = z.infer<typeof SessionHandleSchema>
```

**Do NOT move** (these stay in `src/types.ts`):
- `SessionSchema` / `Session` — replaced by `SessionHandle` in SDK; removed from `src/types.ts`
- `DirectoriesResponseSchema`, `SessionsResponseSchema`, `SessionDataResponseSchema` — app-level API contracts

### 2. Create `src/lib/claude/errors.ts`

Move `ParseError` class from `src/server/parser.ts` (lines 22–119). Only depends on `zod` for `ZodError` type. No changes to implementation.

### 3. Create `src/lib/claude/parser.ts`

Move all parsing functions from `src/server/parser.ts`. These become **internal** (not re-exported from `index.ts`). The `Claude` class calls them.

**Dependency injection for file reading**: To enable testing without real filesystem access, extract the IO boundary:

```ts
/** Abstraction over file reading for testability */
export interface FileReader {
  readText(path: string): Promise<string>
  exists(path: string): Promise<boolean>
}

/** Default implementation using Bun.file */
export const bunFileReader: FileReader = {
  async readText(path: string) {
    return Bun.file(path).text()
  },
  async exists(path: string) {
    return Bun.file(path).exists()
  },
}
```

**Functions to move** (all become internal, taking `FileReader` as parameter where they do IO):

| Function | Signature Change | Notes |
|----------|-----------------|-------|
| `parseSessionLogs` | `(sessionFilePath: string, reader: FileReader) → Promise<SessionData>` | Main orchestrator. Takes `SessionHandle` fields, delegates to others. |
| `parseJsonlFile` | `(filePath: string, reader: FileReader) → Promise<LogEntry[]>` | Uses `reader.readText()` instead of `Bun.file()` |
| `extractSessionId` | `(logPath: string) → string` | Pure, no change |
| `normalizeToolUseResult` | `(toolUseResult) → ToolUseResult \| undefined` | Pure, no change |
| `findAgentLogs` | `(sessionAgentDir: string, mainLogEntries: LogEntry[]) → Promise<Map<string, string>>` | Uses `reader.exists()`. Constructs paths from `sessionAgentDir` rather than computing them. |
| `buildAgentTree` | `(options) → Promise<AgentNode>` | Passes `reader` through to `parseJsonlFile` |
| `extractMainAgentModel` | `(logEntries: LogEntry[]) → string \| undefined` | Pure, no change |
| `extractAgentInfo` | `(logEntries: LogEntry[], agentId: string) → ExtendedAgentInfo` | Pure, no change |
| `parseSessionEventsForAgent` | `(logEntries, sessionId, agentId) → Event[]` | Pure, no change |
| `parseEvents` | `(logEntries, sessionId, agentId) → Event[]` | Pure, no change |
| `extractAllEvents` | `(agent: AgentNode) → Event[]` | Pure, no change |

**Key change**: `findAgentLogs` currently computes `join(logDirectory, sessionId, "subagents", ...)`. In the new design, the `sessionAgentDir` is passed in directly (from `SessionHandle.sessionAgentDir`), so the function simply does `join(sessionAgentDir, "agent-<id>.jsonl")`.

**Internal types** (`AgentInfo`, `ExtendedAgentInfo`) stay in this file as unexported interfaces.

### 4. Create `src/lib/claude/index.ts`

The `Claude` class implementation:

```ts
import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import type { ProjectHandle, SessionHandle, SessionData } from "./types"
import { parseSessionLogs, type FileReader, bunFileReader } from "./parser"
import { ParseError } from "./errors"

export interface ClaudeOptions {
  /** Absolute path to the Claude projects base directory */
  path: string
  /** Optional file reader for dependency injection (testing) */
  reader?: FileReader
}

export class Claude {
  private readonly basePath: string
  private readonly reader: FileReader

  constructor(options: ClaudeOptions) {
    this.basePath = options.path
    this.reader = options.reader ?? bunFileReader
  }

  async listProjects(): Promise<ProjectHandle[]> {
    // readdir basePath with { withFileTypes: true }
    // filter directories
    // for each, check if it contains .jsonl files (not agent-*)
    // return sorted ProjectHandle[]
  }

  async listSessions(project: ProjectHandle): Promise<SessionHandle[]> {
    // readdir project.path
    // filter .jsonl files, exclude agent-* files
    // stat each file for modifiedAt
    // sort by mtime desc
    // return SessionHandle[] with computed sessionAgentDir
  }

  async parseSession(session: SessionHandle): Promise<SessionData> {
    // delegate to parseSessionLogs(session.sessionFilePath, session.sessionAgentDir, this.reader)
    return parseSessionLogs(session.sessionFilePath, session.sessionAgentDir, this.reader)
  }
}
```

Note: `listProjects` and `listSessions` use `node:fs/promises` `readdir`/`stat` because these are directory-level operations. The `FileReader` interface is for reading file *contents* (the `.jsonl` parsing path). This is consistent with how the current code works — the routes use `node:fs` for directory listing, and only the parser uses `Bun.file`.

**Exports**:
```ts
export { Claude }
export type { ClaudeOptions, ProjectHandle, SessionHandle }
export { ParseError } from "./errors"
export type { FileReader } from "./parser"
export { bunFileReader } from "./parser"
// Re-export all domain types for SDK consumers
export * from "./types"
```

### 5. Update `src/types.ts`

Strip down to re-exports + app-level API response schemas:

```ts
import { z } from "zod"
import { SessionHandleSchema, SessionDataSchema } from "./lib/claude/types"

// Re-export all SDK types so #types alias continues to work for frontend
export * from "./lib/claude"

// App-level API response types (server ↔ frontend contract)

export const DirectoriesResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), directories: z.array(z.string()) }),
  z.object({ status: z.literal("error"), error: z.string() }),
])

export const SessionsResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), sessions: z.array(SessionHandleSchema) }),
  z.object({ status: z.literal("error"), error: z.string() }),
])

export const SessionDataResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), data: SessionDataSchema }),
  z.object({ status: z.literal("error"), error: z.string() }),
])

export type DirectoriesResponse = z.infer<typeof DirectoriesResponseSchema>
export type SessionsResponse = z.infer<typeof SessionsResponseSchema>
export type SessionDataResponse = z.infer<typeof SessionDataResponseSchema>
```

**Breaking change**: `Session` type is removed. Frontend `api.ts` and `Header.tsx` import `Session` — these must be updated to use `SessionHandle` instead.

### 6. Delete `src/server/parser.ts`

Entirely replaced by `src/lib/claude/parser.ts`.

### 7. Update `src/server/routes/directories.ts`

Before:
```ts
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { CLAUDE_PROJECTS_DIR } from "../utils"
// ... manual readdir + filter logic
```

After:
```ts
import { Claude } from "../../lib/claude"
import { CLAUDE_PROJECTS_DIR } from "../utils"

export async function directoriesHandler(): Promise<Response> {
  try {
    const claude = new Claude({ path: CLAUDE_PROJECTS_DIR })
    const projects = await claude.listProjects()
    const directories = projects.map(p => p.id)
    // ... return success response with directories
  } catch { ... }
}
```

### 8. Update `src/server/routes/sessions.ts`

Before: manual `readdir` + `stat` + filter + sort.

After:
```ts
import { Claude } from "../../lib/claude"
import { CLAUDE_PROJECTS_DIR, isValidDirectory } from "../utils"
import { join } from "node:path"

export async function sessionsHandler(req): Promise<Response> {
  // ... validate directory parameter (server security concern, stays here)
  const dirPath = join(CLAUDE_PROJECTS_DIR, directory)
  const claude = new Claude({ path: CLAUDE_PROJECTS_DIR })
  const sessions = await claude.listSessions({ id: directory, path: dirPath })
  // ... return success response with sessions
}
```

### 9. Update `src/server/routes/session.ts`

Before:
```ts
import { ParseError, parseSessionLogs } from "../parser"
```

After:
```ts
import { Claude, ParseError } from "../../lib/claude"
import { dirname, join } from "node:path"

// Inside handler:
const sessionId = basename(sessionPath).replace(".jsonl", "")
const projectDir = dirname(sessionPath)
const claude = new Claude({ path: dirname(projectDir) })
const session: SessionHandle = {
  id: sessionId,
  sessionFilePath: sessionPath,
  sessionAgentDir: join(projectDir, sessionId, "subagents"),
}
const sessionData = await claude.parseSession(session)
```

Note: The route constructs a `SessionHandle` from the raw path parameter. This is the boundary between "HTTP request with a raw path string" and "typed SDK handle".

### 10. Update `src/server/index.tsx`

Before:
```ts
import { parseSessionLogs } from "./parser"
// ... await parseSessionLogs(cliSessionPath)
```

After:
```ts
import { Claude } from "../lib/claude"
import { dirname, basename, join } from "node:path"

// Inside CLI validation:
const sessionId = basename(cliSessionPath).replace(".jsonl", "")
const projectDir = dirname(cliSessionPath)
const claude = new Claude({ path: dirname(projectDir) })
const sessionData = await claude.parseSession({
  id: sessionId,
  sessionFilePath: cliSessionPath,
  sessionAgentDir: join(projectDir, sessionId, "subagents"),
})
```

### 11. Update `src/server/routes/session-delete.ts`

No changes needed — delete is not an SDK concern.

### 12. Update `src/server/utils.ts`

No changes needed. `CLAUDE_PROJECTS_DIR` and validation functions stay as server security concerns.

### 13. Update Frontend Files

**`src/frontend/api.ts`**:
- Change `Session` import to `SessionHandle`
- Update `useSessions` return type from `Session[]` to `SessionHandle[]`

**`src/frontend/components/Header.tsx`**:
- Change `Session` import to `SessionHandle`
- Update prop types and references

**All other frontend files**: No changes needed. `Event`, `AgentNode`, `SessionData` are re-exported through `#types` unchanged.

---

## Test Suite

### Test File: `src/lib/claude/__tests__/parser.test.ts`

Tests for all pure parsing functions. Uses fixture `.jsonl` files.

**Fixture strategy**: Create minimal but realistic `.jsonl` fixtures derived from real session log structure observed at `~/.claude/projects/`. Each fixture is the minimum valid data to test a specific scenario.

#### Test cases — `parseJsonlFile`
- Parses valid .jsonl with multiple entry types (user, assistant, summary)
- Skips empty lines
- Throws `ParseError` with line number on invalid JSON
- Throws `ParseError` with Zod details on schema mismatch
- Handles entries with minimal fields (summary has only `type`, `summary`, `leafUuid`)

#### Test cases — `normalizeToolUseResult`
- Returns undefined for `undefined` input
- Returns undefined for string input
- Returns the object for object input
- Returns first element for array input

#### Test cases — `extractSessionId`
- Extracts UUID from path like `/foo/bar/abc-123.jsonl`
- Handles nested paths

#### Test cases — `findAgentLogs`
- Discovers agent IDs from `toolUseResult.agentId` in main log entries
- Returns map of agentId → log file path
- Handles missing agent log files (warns but continues)
- Returns empty map when no agents exist

#### Test cases — `extractMainAgentModel`
- Returns model from first assistant message
- Returns undefined when no assistant messages exist
- Skips user messages

#### Test cases — `extractAgentInfo`
- Extracts name, model, subagentType, description from Task tool_use matching a tool_result with agentId
- Detects resumed agents (Task tool_use with `resume` parameter)
- Falls back to agentId as name when no matching tool_use found
- Falls back to prompt substring when tool_use_id not found

#### Test cases — `parseEvents`
- Converts user message (string content) to user-message event
- Converts user message (array content with text) to user-message event
- Converts tool_result content to tool-result event
- Converts assistant text content to assistant-message event
- Converts thinking content to thinking event
- Converts tool_use content to tool-use event
- Detects resume flag on Task tool_use
- Skips entries with unknown types (progress, system, queue-operation)
- Skips entries missing uuid or timestamp
- Handles summary entries (uses leafUuid as id, provides fallback timestamp)

#### Test cases — `parseSessionEventsForAgent`
- Extracts tool-result events for a specific agent from session log
- Skips entries that belong to the agent's own log (entry.agentId matches)
- Handles string and array tool_result content

#### Test cases — `buildAgentTree`
- Creates main agent with events and children
- Attaches sub-agents as children with correct metadata
- Combines agent file events and session events for resumed agents
- Sorts combined events chronologically

#### Test cases — `extractAllEvents`
- Flattens single agent (no children) to sorted events
- Recursively collects events from nested agents
- Sorts all events chronologically across agents

### Test File: `src/lib/claude/__tests__/claude.test.ts`

Integration tests for the `Claude` class. Uses the `FileReader` dependency injection to avoid real filesystem.

#### Test cases — `listProjects`
- Lists directories containing .jsonl files
- Excludes directories with no .jsonl files
- Excludes non-directory entries
- Returns sorted ProjectHandle array with correct id and path

#### Test cases — `listSessions`
- Lists .jsonl files excluding agent-* files
- Returns SessionHandle with correct id, sessionFilePath, sessionAgentDir
- sessionAgentDir ends with `<session-id>/subagents`
- Sorts by modification time descending

#### Test cases — `parseSession`
- Parses a simple session (no agents) and returns SessionData
- Parses a session with sub-agents and returns correct agent tree
- Delegates to parser with the provided FileReader

### Test Fixtures: `src/lib/claude/__tests__/fixtures/`

#### `simple-session.jsonl`
Minimal session with: 1 user message (string content), 1 assistant message (text + thinking), 1 tool_use, 1 tool_result, 1 summary. Derived from observed patterns in real logs.

#### `session-with-agents.jsonl` + `session-with-agents/subagents/agent-abc1234.jsonl`
Session that spawns a sub-agent via Task tool. Main log has the Task tool_use in assistant message and tool_result in user message with `toolUseResult.agentId`. Agent log has its own user/assistant conversation.

#### `malformed.jsonl`
Contains a line with invalid JSON and a line with valid JSON but invalid schema, for error handling tests.

---

## Type Migration Summary

| Current Type | Current Location | New Location | Notes |
|---|---|---|---|
| All Zod log schemas | `src/types.ts` | `src/lib/claude/types.ts` | Move |
| All event/agent schemas | `src/types.ts` | `src/lib/claude/types.ts` | Move |
| `SessionSchema` / `Session` | `src/types.ts` | Removed | Replaced by `SessionHandle` in SDK |
| `DirectoriesResponseSchema` | `src/types.ts` | `src/types.ts` (stays) | App-level API contract |
| `SessionsResponseSchema` | `src/types.ts` | `src/types.ts` (stays, uses `SessionHandleSchema`) | Updated to reference SDK schema |
| `SessionDataResponseSchema` | `src/types.ts` | `src/types.ts` (stays) | App-level API contract |
| `ParseError` | `src/server/parser.ts` | `src/lib/claude/errors.ts` | Move |
| All parser functions | `src/server/parser.ts` | `src/lib/claude/parser.ts` | Move + add FileReader DI |
| `ProjectHandle` | New | `src/lib/claude/types.ts` | New type |
| `SessionHandle` | New | `src/lib/claude/types.ts` | New type, replaces `Session` |

## Frontend Import Migration

| File | Current Import | New Import |
|---|---|---|
| `api.ts` | `Session` | `SessionHandle` |
| `Header.tsx` | `Session` | `SessionHandle` |
| All others | `Event`, `AgentNode`, `SessionData` | No change (re-exported via `#types`) |

## Implementation Order

1. Create `src/lib/claude/types.ts` — move SDK types from `src/types.ts`
2. Create `src/lib/claude/errors.ts` — move `ParseError`
3. Create `src/lib/claude/parser.ts` — move parsing functions, add `FileReader` DI
4. Create `src/lib/claude/index.ts` — `Claude` class + re-exports
5. Update `src/types.ts` — strip to re-exports + API response types
6. Delete `src/server/parser.ts`
7. Update server routes (`directories.ts`, `sessions.ts`, `session.ts`) to use SDK
8. Update `src/server/index.tsx` to use SDK
9. Update frontend (`api.ts`, `Header.tsx`) for `Session` → `SessionHandle` rename
10. Create test fixtures in `src/lib/claude/__tests__/fixtures/`
11. Write `src/lib/claude/__tests__/parser.test.ts`
12. Write `src/lib/claude/__tests__/claude.test.ts`
13. Add `"test": "bun test"` script to `package.json`
14. Run `bun run verify` to confirm type-checking, lint, and format pass
15. Run `bun test` to confirm all tests pass
16. Update `CLAUDE.md` to reflect new architecture

---

## Key Design Decisions

1. **`FileReader` interface for DI** — Allows tests to provide in-memory `.jsonl` content without touching the filesystem. The `bunFileReader` default uses `Bun.file` in production.

2. **Handles as lightweight descriptors** — `ProjectHandle` and `SessionHandle` are plain data objects with pre-computed paths. The SDK never guesses paths; callers provide them or get them from `listProjects()`/`listSessions()`.

3. **`sessionAgentDir` always populated** — Even if no sub-agents exist, the handle contains the *expected* path (`<project>/<session-id>/subagents`). The parser checks existence at runtime.

4. **No `parseAll()`** — Consumers iterate `listSessions()` and call `parseSession()` individually. This gives them control over concurrency and error handling per session.

5. **`#types` alias unchanged** — `package.json` `imports.#types` still points at `src/types.ts`, which now re-exports everything from the SDK. Zero frontend churn for most components.

6. **Server security stays in server** — `isValidDirectory`, `isValidSessionPath`, and `CLAUDE_PROJECTS_DIR` remain in `src/server/utils.ts`. The SDK does not enforce access control; that is the server's responsibility.

7. **`listProjects`/`listSessions` use `readdir`/`stat` directly** — These are directory-level operations that don't need the `FileReader` abstraction. The `FileReader` is specifically for reading `.jsonl` file contents where we need Zod validation and want testability.

## References

| File | Purpose |
|---|---|
| `src/types.ts` | Source of all types to split |
| `src/server/parser.ts` | Source of all parsing logic to move |
| `src/server/utils.ts` | Server-level constants and validation |
| `src/server/index.tsx` | Server entry point to update |
| `src/server/routes/directories.ts` | Route to thin out |
| `src/server/routes/sessions.ts` | Route to thin out |
| `src/server/routes/session.ts` | Route to thin out |
| `src/frontend/api.ts` | Frontend hooks — `Session` → `SessionHandle` |
| `src/frontend/components/Header.tsx` | Frontend component — `Session` → `SessionHandle` |
| `package.json` | `#types` import alias, scripts |
| `biome.json` | Lint/format config (noDefaultExport rule) |
