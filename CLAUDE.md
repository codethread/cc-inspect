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

### Server (src/server/index.tsx)

Entry point that runs a Bun server with REST API endpoints:

- `/api/directories` - Lists project directories in `~/.claude/projects/` that contain session files
- `/api/sessions?directory=<dir>` - Lists session files (excluding agent logs) in a directory
- `/api/session?path=<path>` - Parses and returns full session data with events

The server uses path traversal validation (`isValidDirectory`, `isValidSessionPath`) to ensure requests stay within `~/.claude/projects/`.

CLI flags are parsed with `util.parseArgs()`. If `-s/--session` is provided, the session is pre-validated on startup and served via `/api/session`.

### Parser (src/parser.ts)

Core parsing logic that transforms Claude Code `.jsonl` logs into structured data:

1. **parseSessionLogs()** - Main entry point that:
   - Parses the main session log file
   - Discovers and loads sub-agent logs (files starting with `agent-<id>.jsonl`)
   - Builds an agent tree hierarchy with parent-child relationships
   - Extracts and chronologically sorts all events

2. **parseJsonlFile()** - Reads `.jsonl` files line by line and validates each with Zod schemas

3. **buildAgentTree()** - Constructs agent hierarchy by:
   - Creating an AgentNode for the main session
   - Parsing each sub-agent's log file and adding as children
   - Handling resumed agents (which have events in both agent log and main session log)
   - Extracting agent metadata (name, model, description) from Task tool uses

4. **parseEvents()** - Converts log entries to typed Event objects:
   - User messages, assistant messages, thinking blocks
   - Tool uses (with special handling for Task tool and resume parameter)
   - Tool results (with agentId tracking for sub-agents)
   - Summaries

5. **ParseError** - Custom error class that provides detailed debugging info including line numbers, Zod validation errors, and actual values

### Type System (src/types.ts)

Comprehensive Zod schemas and TypeScript types for:

- **LogEntry** - Raw `.jsonl` entry format with message content, tool results, metadata
- **Event** - Processed timeline event with typed data union
- **AgentNode** - Recursive agent tree structure with events
- **SessionData** - Complete parsed session with agent tree and all events
- **API responses** - Discriminated unions for `/api/*` endpoints

All parsing uses Zod for runtime validation to catch schema mismatches early.

### Frontend (src/frontend/App.tsx, src/frontend/frontend.tsx)

React app with three main features:

1. **Directory/Session selector** - Dropdown UI in header to browse and load sessions, with URL persistence (`?directory=<dir>&session=<path>`)

2. **GraphTimeline** - Main visualization component showing events chronologically with agent context

3. **EventDetailsPanel** - Side panel displaying full event data when selected

The app uses TanStack Query (`@tanstack/react-query`) for data fetching, with query/mutation hooks defined in `src/frontend/api.ts`. The `QueryClientProvider` is set up in `frontend.tsx`. CLI-provided sessions are handled by a `useCliSession` hook that attempts to load `/api/session` without parameters.

## File Structure

- `src/types.ts` - Zod schemas and TypeScript types
- `src/frontend/App.tsx` - Main React component with selectors and layout
- `src/frontend/api.ts` - TanStack Query hooks and fetch helper
- `src/frontend/frontend.tsx` - React DOM mounting with QueryClientProvider
- `src/frontend/components/` - React UI components (timeline, event list, details panel)
- `src/frontend/index.html` - HTML entry point that imports React app
- `src/server/index.tsx` - Bun server entry point (CLI binary via shebang)
- `src/server/parser.ts` - Session log parser with agent tree builder

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
