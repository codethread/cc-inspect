# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Bun workspaces monorepo with two packages:

- **`@codethread/claude-sdk`** (`packages/claude-sdk/`) — standalone SDK for parsing Claude Code `.jsonl` session logs
- **`cc-inspect`** (`packages/cc-inspect/`) — web-based visualizer that consumes the SDK

## Monorepo Structure

```
packages/
  claude-sdk/          # @codethread/claude-sdk — publishable SDK
  cc-inspect/          # cc-inspect app — server + frontend
biome.json             # shared linter/formatter config
tsconfig.json          # project references to both packages
package.json           # workspace root
```

## Common Commands

Run from the **root**:
- `bun install` — install all workspace dependencies

Run from **`packages/cc-inspect/`**:
- `bun dev` — start dev server with hot reload on port 5555
- `bun start` — run without hot reload
- `bun test` — run app test suite
- `bun run verify` — typecheck + lint + format
- `bun run fix` — auto-fix Biome issues

Run from **`packages/claude-sdk/`**:
- `bun test` — run SDK test suite
- `bun run typecheck` — typecheck SDK

## Architecture

### Claude SDK (`packages/claude-sdk/`)

Self-contained SDK for parsing Claude Code `.jsonl` session logs. Published as `@codethread/claude-sdk`.

**Public API** via the `Claude` class:

```ts
import { Claude } from "@codethread/claude-sdk";
const claude = new Claude({ path: "/absolute/path/to/projects/dir" });
const projects = await claude.listProjects();
const sessions = await claude.listSessions(project);
const sessionData = await claude.parseSession(session);
```

Also exports incremental parsing functions (`parseLines`, `processMainEntries`, `processAgentEntries`, `buildAgentNode`, `createParseStateFromSession`) used by the tail/streaming layer.

**Files:**

- `src/index.ts` — `Claude` class + re-exports (public entry point)
- `src/types.ts` — Zod schemas and inferred types (LogEntry, Event, AgentNode, SessionData, etc.)
- `src/parser.ts` — Pure parsing functions. Uses `FileReader` DI interface for testability
- `src/incremental.ts` — Incremental parser for streaming JSONL processing
- `src/errors.ts` — `ParseError` class with debugging info
- `src/event-catalog.ts` — SDK-level constants (entry types, content types, event types)
- `src/__tests__/` — Test suite with `.jsonl` fixtures

### App (`packages/cc-inspect/`)

#### Server (`src/server/index.tsx`)

Bun server with REST API endpoints consuming the SDK:

- `/api/directories` — `claude.listProjects()` → directory IDs
- `/api/sessions?directory=<dir>` — `claude.listSessions(project)` → session handles
- `/api/session?path=<path>` — `claude.parseSession(session)` → full session data

Path traversal validation in `utils.ts`. CLI flags via `util.parseArgs()`.

#### Type System (`src/types.ts`)

Re-exports all SDK types via `export * from "@codethread/claude-sdk"` so the `#types` import alias works. Also defines app-level API response schemas as discriminated unions.

#### Event/Log Catalog (`src/lib/event-catalog.ts`)

Re-exports SDK domain constants and defines app-only constants:

- Store keys, store action names, devtools/persist names
- Client/server log module names
- Canonical log message names

When adding new logged events, update this file first.

#### Frontend (`src/frontend/`)

React app with `SessionView` component — structured document reader with turn grouping, outline sidebar, detail panel, search modal, and filter drawer. Uses TanStack Query for session picker and WebSocket streaming via the tail store.

**UI design and behaviour**: see `DESIGN.md` in `packages/cc-inspect/`.

#### Streaming (`src/lib/tail/`, `src/frontend/stores/tail-store.ts`)

All session data flows through WebSocket streaming. Architecture:

- `FileTailer` — watches a single `.jsonl` file via byte-offset tracking
- `SessionTailer` — orchestrates multiple `FileTailer`s, owns incremental parse state
- `TailerRegistry` — singleton managing `SessionTailer` instances
- `tail-store.ts` — frontend Zustand store with WebSocket connection state machine

Early subagent discovery via `node:fs` directory watching.

## File Structure

```
packages/claude-sdk/src/
  index.ts, types.ts, parser.ts, incremental.ts, errors.ts, event-catalog.ts
  __tests__/                    # SDK tests + fixtures

packages/cc-inspect/src/
  types.ts                      # Re-exports SDK types + app API schemas
  server/
    index.tsx                   # Bun server entry point
    routes/                     # Route handlers
    utils.ts                    # Path validation
  frontend/
    App.tsx, frontend.tsx        # React app entry
    api.ts                      # TanStack Query hooks
    components/                 # SessionView, Outline, FilterDrawer, etc.
    stores/                     # Zustand stores
  lib/
    event-catalog.ts            # App-level catalog (re-exports SDK constants)
    tail/                       # File/session tailing
    log/                        # Structured JSONL logging
```

## Code style

- Focus on pure functions with minimal side effects
- Use dependency injection for testability
- Validate unknown IO through Zod into discriminated union types
- No legacy behaviour constraints — breaking changes are fine if checks pass
- Named files and exports, no index files or default exports. TypeScript namespaces are valid for grouping.
- Inline interfaces for return types (or shared if applicable)
- Frontend state in stores (`src/frontend/stores`), not component-local state
- Agent-first: log all events to the structured JSONL log for debugging

## Logging

All logging goes through the structured JSONL log system. Dev log path shown in `bun dev` output.

### Checklist for new code

1. **Catalog first** — add entries to `packages/cc-inspect/src/lib/event-catalog.ts`
2. **Create logger at module top**:
   - Server: `const log = () => getServerLogger(LOG_MODULE.X)`
   - Client: `const log = createClientLogger(LOG_MODULE.X)`
3. **Log at key lifecycle points** — start, success, error, state transitions
4. **Use `timed()`** for async operations
5. **Log levels**: `debug` internal, `info` lifecycle, `warn` recoverable, `error` failures

## State machines

Discriminated union + pure transition pattern:

1. State union on `status` field
2. Event union for all inputs
3. Effect union for side effects (returned as data)
4. Pure `transition(state, event) → { state, effects[] }`
5. Single `dispatch(event)` host

## Test style

- Table-driven tests via `it.each`
- Reuse common factory functions for input construction
