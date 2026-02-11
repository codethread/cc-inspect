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

The app uses `fetch()` to call the REST API and manages state with React hooks. It handles CLI-provided sessions by attempting to load `/api/session` without parameters on mount.

## File Structure

- `src/types.ts` - Zod schemas and TypeScript types
- `src/frontend/App.tsx` - Main React component with selectors and layout
- `src/frontend/frontend.tsx` - React DOM mounting
- `src/frontend/components/` - React UI components (timeline, event list, details panel)
- `src/frontend/index.html` - HTML entry point that imports React app
- `src/server/index.tsx` - Bun server entry point (CLI binary via shebang)
- `src/server/parser.ts` - Session log parser with agent tree builder
