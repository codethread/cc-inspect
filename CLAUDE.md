# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cc-inspect is a web-based visualizer for Claude Code session logs. It parses `.jsonl` log files from `~/.claude/projects/` and displays them in an interactive timeline with agent hierarchies and event details.

## Common Commands

- `bun dev` - Start development server with hot reload on port 5555
- `bun start` - Run without hot reload
- `cc-inspect --help` - Run the globally linked CLI (after `npm link`)
- `bun test` - Run test suite with Bun's built-in test runner
- `bun run fix` - Auto-fix issues with Biome (includes unsafe fixes)
- `bun run verify` - Run all checks (typecheck + lint + format)

## Architecture

### Claude SDK (src/lib/claude/)

Self-contained SDK for parsing Claude Code `.jsonl` session logs. Designed for future extraction as a standalone npm library.

**Public API** via the `Claude` class:

```ts
const claude = new Claude({ path: "/absolute/path/to/projects/dir" });
const projects: ProjectHandle[] = await claude.listProjects();
const sessions: SessionHandle[] = await claude.listSessions(project);
const sessionData: SessionData = await claude.parseSession(session);
```

**Files:**

- `index.ts` — `Claude` class + re-exports (public entry point)
- `types.ts` — All Zod schemas and inferred types for the log domain (LogEntry, Event, AgentNode, SessionData, ProjectHandle, SessionHandle)
- `parser.ts` — Pure parsing functions (internal). Uses `FileReader` interface for dependency injection to enable testing without filesystem access
- `errors.ts` — `ParseError` class with detailed debugging info (line numbers, Zod errors, actual values)
- `__tests__/` — Test suite with fixtures derived from real session logs

**Key patterns:**

- `FileReader` DI interface (`readText`, `exists`) abstracts file reading; `bunFileReader` is the default Bun implementation
- `ProjectHandle` and `SessionHandle` are lightweight descriptors with pre-computed absolute paths
- `listProjects`/`listSessions` use `node:fs/promises` directly; only `.jsonl` content parsing uses `FileReader`

### Server (src/server/index.tsx)

Thin layer that runs a Bun server with REST API endpoints consuming the Claude SDK:

- `/api/directories` — `claude.listProjects()` → directory IDs
- `/api/sessions?directory=<dir>` — `claude.listSessions(project)` → session handles
- `/api/session?path=<path>` — `claude.parseSession(session)` → full session data

Path traversal validation (`isValidDirectory`, `isValidSessionPath` in `utils.ts`) is a server security concern, not an SDK concern.

CLI flags parsed with `util.parseArgs()`. `-s/--session` pre-validates via `claude.parseSession()`.

### Type System (src/types.ts)

Re-exports all SDK types via `export * from "./lib/claude"` so the `#types` import alias continues to work. Also defines app-level API response schemas (DirectoriesResponseSchema, SessionsResponseSchema, SessionDataResponseSchema) as discriminated unions for the server↔frontend contract.

### Event/Log Catalog (src/lib/event-catalog.ts)

Single source of truth for:

- Claude raw entry/content type names
- Session event type names
- Store keys, store action names, devtools/persist names
- Client/server log module names
- Canonical log message names

When adding or changing logged events/actions/messages, update this file first and use its constants in code. For debugging with `jq`, prefer searching these catalog values instead of ad-hoc strings.

### Frontend (src/frontend/App.tsx, src/frontend/frontend.tsx)

React app that renders a single `SessionView` component — a structured document reader with turn grouping, outline sidebar, detail panel, search modal, and filter drawer. `SessionView` orchestrates rendering while UI state is centralized in Zustand stores under `src/frontend/stores`.

The app uses TanStack Query (`@tanstack/react-query`) for data fetching, with query/mutation hooks defined in `src/frontend/api.ts`. The `QueryClientProvider` is set up in `frontend.tsx`. CLI-provided sessions are handled by a `useCliSession` hook that attempts to load `/api/session` without parameters. The API layer rehydrates `Date` objects from JSON responses.

During live tailing, `SessionView` switches data source from TanStack Query to the tail store's WebSocket-fed `sessionData`. The `SubagentDrilldown` component provides a full-width drilldown view for in-progress subagents.

**UI design and behaviour**: see `DESIGN.md` at the project root. This is the authoritative description of all layout, interactions, and event rendering — read it before working on the frontend, and update it whenever user-visible behaviour changes.

### Live Tailing (src/lib/tail/, src/frontend/stores/tail-store.ts)

Real-time streaming of session log events via WebSocket. Architecture:

- `FileTailer` — watches a single `.jsonl` file, emits complete lines via byte-offset tracking
- `SessionTailer` — orchestrates multiple `FileTailer`s for one session, owns incremental parse state, fans out to WebSocket subscribers
- `TailerRegistry` — singleton managing `SessionTailer` instances (shared per session path, capped at 10)
- `/ws/session/tail` — WebSocket route for tail connections
- `tail-store.ts` — frontend Zustand store with WebSocket connection state machine (`disconnected → connecting → connected → reconnecting`)

Protocol: client sends `{ path }`, server responds with a `snapshot` then incremental `events` messages. Supports reconnect via `resumeAfterSeq`.

**Early subagent discovery**: `SessionTailer` watches the session agent directory with `node:fs` `watch` for new `agent-*.jsonl` files. When a file appears, the agent is registered and a `FileTailer` starts immediately — before the Task tool_result arrives in the main log. This makes in-progress subagents visible in real time. If the directory doesn't exist yet (no subagents spawned), a 1s poll retries until it appears. When the tool_result eventually arrives, `SessionTailer` refreshes the `AgentNode` metadata (name/description) and broadcasts the updated node to subscribers. The frontend `tail-store` handles both new-agent and metadata-update cases in `mergeEvents`.

## File Structure

- `src/lib/claude/` - Self-contained Claude Code SDK (types, parser, errors, Claude class)
- `src/lib/claude/__tests__/` - SDK test suite with .jsonl fixtures
- `src/lib/tail/` - File/session tailing with state machines
- `src/lib/tail/__tests__/` - Tailing test suite
- `src/types.ts` - Re-exports SDK types + app-level API response schemas
- `src/server/index.tsx` - Bun server entry point (CLI binary via shebang)
- `src/server/routes/` - Thin route handlers using Claude SDK
- `src/server/utils.ts` - Server-level path validation and constants
- `src/frontend/App.tsx` - React app entry point, renders SessionView
- `src/frontend/api.ts` - TanStack Query hooks, fetch helper, Date rehydration
- `src/frontend/frontend.tsx` - React DOM mounting with QueryClientProvider
- `src/frontend/components/SessionView.tsx` - Main layout component and orchestration
- `src/frontend/components/SessionPicker.tsx` - Session/project dropdown
- `src/frontend/components/Outline.tsx` - Left sidebar navigation
- `src/frontend/components/FilterDrawer.tsx` - Slide-out filter panel
- `src/frontend/components/SearchModal.tsx` - ⌘K full-text search modal
- `src/frontend/components/DetailPanel.tsx` - Right-side event detail panel
- `src/frontend/components/TurnView.tsx` - Turn renderer with all event block types
- `src/frontend/components/ToolGroupAccordion.tsx` - Collapsible tool call group accordion
- `src/frontend/components/SubagentSectionView.tsx` - Bordered subagent section wrapper
- `src/frontend/components/SubagentDrilldown.tsx` - Subagent drilldown view
- `src/frontend/components/session-view/` - Pure TS utilities: types, helpers, agent-colors, grouping, filtering
- `src/frontend/components/MarkdownContent.tsx` - Markdown renderer
- `src/frontend/index.html` - HTML entry point that imports React app
- `src/frontend/stores/` - Zustand stores for UI/filter/selection/accordion/picker/keybinding state
- `src/frontend/stores/tail-store.ts` - Tailing state + WebSocket management

## Code style

- Focus on pure functions with minimal side effects
- Ensure functions minimise side effects and use dependency injection to maximise testability
- Keep type purity, i.e ensure all unknown IO is validated through zod and then strictly parsed into discriminated union types where possible (we want the type system to encapsulate as much correctness as possible).
- Code can make breaking changes, there is no public api or legacy behaviour - however all checks must pass for work to be considered finished
- avoid index files and default exports, use named files and exports for clear usage patterns. Typescript namespaces are valid to group logical functions into a cohesive collection without the need for an object to hold them.
- use inline interfaces for return types in most cases (or shared interfaces if applicable)
- Frontend state rule: keep app/UI state in stores (`src/frontend/stores`) rather than component-local state. Persist only durable user preferences; keep session-specific state non-persistent.
- this repo is Agent first, so all events should be logged to the development log file to allow debugging an introspection (log file is shown in `bun dev` output). Use `jq` and `rg` or Explore based subagents to obtain details.

## Logging

All logging goes through the structured JSONL log system. The dev log file path is shown in `bun dev` output — use `jq` and `rg` against it for debugging.

### Checklist for new code

1. **Catalog first** — add entries to `src/lib/event-catalog.ts` before writing any log calls:
   - `LOG_MODULE` for new domains (e.g. `TAIL: "tail"`, `ROUTES_TAIL: "routes.tail"`)
   - `LOG_MESSAGE` for each loggable event (e.g. `TAIL_FILE_CHANGED: "tail.file.changed"`)
2. **Create logger at module top**:
   - Server: `const log = () => getServerLogger(LOG_MODULE.X)` (thunk because init is deferred)
   - Client: `const log = createClientLogger(LOG_MODULE.X)`
3. **Log at key lifecycle points** — start, success, error, state transitions:
   - `log().info(LOG_MESSAGE.X, { path, count, id, ... })` for structured metadata
   - `log().error(LOG_MESSAGE.X, { err: message, stack, data: { context } })` for errors
   - Use **different message names** for different error types (e.g. `PARSE_ERROR` vs `FAILED_TO_PARSE`)
4. **Use `timed()`** for async operations — it auto-records `dur_ms`:
   ```ts
   const result = await log().timed(LOG_MESSAGE.X, () => someAsyncOp(), { path })
   ```
5. **Log levels**: `debug` for internal state, `info` for lifecycle/operations, `warn` for recoverable issues, `error` for failures

### Module naming

Follow `domain.resource` dot-notation: `server`, `routes.session`, `routes.tail`, `tail.file`, `tail.session`, `api`, `store.ui`. Match existing patterns in the catalog.

## State machines

Components with distinct lifecycle states (e.g. connecting → connected → reconnecting) use a **discriminated union + pure transition** pattern rather than ad-hoc boolean flags or xstate:

1. **State union**: each variant on a `status` field, carrying only the data relevant to that state
2. **Event union**: all inputs that can cause a transition
3. **Effect union**: side effects to execute after transition (returned as data, not executed inline)
4. **Pure `transition(state, event) → { state, effects[] }`**: exhaustive, no side effects
5. **Single `dispatch(event)`**: the host class/store calls `transition()`, updates state, then runs effects

This keeps state explicit and testable. Test transitions with `it.each` tables: `(state, event) → expectedStatus + expectedEffects`.

## Test style

- tests should use tables, i.e it.each or similar. This aligns with pure functions that can assert on input and output
- tests should try to reuse common factory functions to make refactors to inputs easier
