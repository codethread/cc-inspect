# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cc-inspect is a web-based visualizer for Claude Code session logs. It parses `.jsonl` log files from `~/.claude/projects/` and displays them in an interactive timeline with agent hierarchies and event details.

## Common Commands

### Development

- `bun dev` - Start development server with hot reload on port 5555
- `bun start` - Run without hot reload
- `cc-inspect` - Run the globally linked CLI (after `npm link`)
- `cc-inspect -s <path>` - Load a specific session file
- `cc-inspect --help` - Show CLI help

### Testing

- `bun test` - Run test suite with Bun's built-in test runner

### Code Quality

- `bun run typecheck` - Type check with TypeScript
- `bun run lint` - Lint with Biome
- `bun run fmt` - Format code with Biome
- `bun run check` - Run Biome checks (lint + format check)
- `bun run fix` - Auto-fix issues with Biome (includes unsafe fixes)
- `bun run verify` - Run all checks (typecheck + lint + format)

### Installation

- `bun install` - Install dependencies
- `npm link` - Link the CLI globally for system-wide use

## Architecture

### Claude SDK (src/lib/claude/)

Self-contained SDK for parsing Claude Code `.jsonl` session logs. Designed for future extraction as a standalone npm library.

**Public API** via the `Claude` class:

```ts
const claude = new Claude({ path: '/absolute/path/to/projects/dir' })
const projects: ProjectHandle[] = await claude.listProjects()
const sessions: SessionHandle[] = await claude.listSessions(project)
const sessionData: SessionData = await claude.parseSession(session)
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

### Frontend (src/frontend/App.tsx, src/frontend/frontend.tsx)

React app with three main features:

1. **Directory/Session selector** - Dropdown UI in header to browse and load sessions, with URL persistence (`?directory=<dir>&session=<path>`)

2. **GraphTimeline** - Main visualization component showing events chronologically with agent context

3. **EventDetailsPanel** - Side panel displaying full event data when selected

The app uses TanStack Query (`@tanstack/react-query`) for data fetching, with query/mutation hooks defined in `src/frontend/api.ts`. The `QueryClientProvider` is set up in `frontend.tsx`. CLI-provided sessions are handled by a `useCliSession` hook that attempts to load `/api/session` without parameters.

## File Structure

- `src/lib/claude/` - Self-contained Claude Code SDK (types, parser, errors, Claude class)
- `src/lib/claude/__tests__/` - SDK test suite with .jsonl fixtures
- `src/types.ts` - Re-exports SDK types + app-level API response schemas
- `src/server/index.tsx` - Bun server entry point (CLI binary via shebang)
- `src/server/routes/` - Thin route handlers using Claude SDK
- `src/server/utils.ts` - Server-level path validation and constants
- `src/frontend/App.tsx` - Main React component with selectors and layout
- `src/frontend/api.ts` - TanStack Query hooks and fetch helper
- `src/frontend/frontend.tsx` - React DOM mounting with QueryClientProvider
- `src/frontend/components/` - React UI components (timeline, event list, details panel)
- `src/frontend/index.html` - HTML entry point that imports React app

## Code style

- Focus on pure functions with minimal side effects
- Ensure functions minimise side effects and use dependency injection to maximise testability
- Keep type purity, i.e ensure all unknown IO is validated through zod and then strictly parsed into discriminated union types where possible (we want the type system to encapsulate as much correctness as possible).
- Code can make breaking changes, there is no public api or legacy behaviour - however all checks must pass for work to be considered finished
- avoid index files and default exports, use named files and exports for clear usage patterns. Typescript namespaces are valid to group logical functions into a cohesive collection without the need for an object to hold them.
- use inline interfaces for return types in most cases (or shared interfaces if applicable)

## Test style

- tests should use tables, i.e it.each or similar. This aligns with pure functions that can assert on input and output
- tests should try to reuse common factory functions to make refactors to inputs easier

## Development process

This project uses a strict plan -> build process facilitated by beads (`bd` cli) for task management. The process has two distinct phases: an exploratory planning phase (no beads), followed by an execution phase (driven by beads).

### Phase 1: Planning (no beads, no planning tools)

Planning is a freeform dialogue between the user and agent. The goal is to thoroughly understand the problem space before committing to a plan of execution.

- **Explore**: read relevant code, ask questions, gather requirements
- **Experiment**: write throwaway proof-of-concepts, run commands, add small tests to validate assumptions
- **Dispose**: all exploratory artefacts are removed once they've served their purpose - nothing from this phase is kept in the codebase
- **Document**: produce a final plan as a simple markdown file (`Plan.md` in the project root)

This phase does not use beads, planning tools, or task tracking. It is purely conversational and investigative.

### Phase 2: Execution (beads-driven)

Once the plan is finalised, execution follows a structured loop using beads for task management.

#### Setup

1. **Branch**: ensure work is on a fresh feature branch off the base branch (e.g. `main`). The branch starts clean - beads data is not tracked by git.
2. **Create the epic**: create a beads epic (`bd create --type=epic`) with the plan as its description. The epic is the single source of truth for the feature's intent and requirements.
3. **Create the user review task**: this is the first task created and the last one completed. It acts as a final gate for the user to verify the feature meets their expectations. It is never started until everything else is done.
4. **Create initial work tasks**: based on the epic, create the first 2-3 tasks to begin implementation.

#### Task design

- **Ad hoc, not upfront**: do not break the entire epic into tasks at the start - they will drift from reality as implementation progresses. Create tasks in small batches (2-3 at a time) as work is planned.
- **Chunky, not granular**: tasks should be meaningful units of work, not micro-steps. A single task can cover a significant piece of functionality.
- **Domain-scoped**: each task should relate to one area of concern. For example, backend and frontend changes for the same feature should be separate tasks rather than one monolithic task. But not every API change needs its own task - group logically.
- **Start large**: prefer larger tasks initially. If they prove too broad, break future tasks down further.

#### The execution loop

The execution loop alternates between **worker agents** (stateless, task-focused) and an **architect agent** (stateful, epic-aware).

```
┌─────────────────────────────────────────────┐
│                   EPIC                      │
│            (source of truth)                │
└──────────────────┬──────────────────────────┘
                   │
         ┌─────────▼──────────┐
         │  Architect creates  │
         │   next task batch   │◄──────────────┐
         └─────────┬──────────┘               │
                   │                          │
         ┌─────────▼──────────┐               │
         │  Worker agents      │               │
         │  complete tasks     │               │
         └─────────┬──────────┘               │
                   │                          │
         ┌─────────▼──────────┐               │
         │  Git commit         │               │
         │  (reference tasks)  │               │
         └─────────┬──────────┘               │
                   │                          │
         ┌─────────▼──────────┐     yes       │
         │  Architect review:  ├──────────────┘
         │  more work needed?  │
         └─────────┬──────────┘
                   │ no
         ┌─────────▼──────────┐
         │  User review task   │
         │  (final gate)       │
         └─────────────────────┘
```

**Worker agents** are stateless. They pick up tasks from `bd ready`, complete them, and report back. They have full context from the task description and can see the parent epic via `bd show`. They do not need to understand the broader plan beyond their task scope.

**The architect agent** is stateful and responsible for:

- Reviewing completed work against the epic after each batch of tasks
- Verifying that what was built matches the epic's intent
- Creating the next batch of tasks based on what remains
- Handling deviations: if something went wrong, the architect either creates corrective tasks or escalates to the user to discuss rollback
- Updating the epic description if the implementation approach needs to evolve - but only with careful consideration that changes stay aligned with the original requirements

#### Git workflow during execution

After each batch of tasks is completed, commit the work on the feature branch:

- Stage and commit after each completed task batch
- Reference beads task IDs in commit messages for traceability between git history and beads
- This creates a reviewable trail where commits map to completed tasks, even though beads data itself is not in git

#### Autonomy and escalation

This process is designed to be autonomous. The user should not need to be involved between the planning phase and the user review task. The architect agent drives progress independently.

Escalate to the user only when:

- A blocker is encountered that fundamentally contradicts the epic's intent and cannot be resolved by adjusting the implementation approach
- A significant scope change is needed that would alter the original requirements

It is acceptable for the architect to evolve implementation details, adjust the technical approach, and even update the epic's description - as long as the original requirements and user intent are preserved. The plan is a living document; the requirements are not.
