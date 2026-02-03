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

### Server (src/index.tsx)

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

### Frontend (src/App.tsx, src/frontend.tsx)

React app with three main features:

1. **Directory/Session selector** - Dropdown UI in header to browse and load sessions, with URL persistence (`?directory=<dir>&session=<path>`)

2. **GraphTimeline** - Main visualization component showing events chronologically with agent context

3. **EventDetailsPanel** - Side panel displaying full event data when selected

The app uses `fetch()` to call the REST API and manages state with React hooks. It handles CLI-provided sessions by attempting to load `/api/session` without parameters on mount.

## File Structure

- `src/index.tsx` - Bun server entry point (CLI binary via shebang)
- `src/parser.ts` - Session log parser with agent tree builder
- `src/types.ts` - Zod schemas and TypeScript types
- `src/App.tsx` - Main React component with selectors and layout
- `src/frontend.tsx` - React DOM mounting
- `src/components/` - React UI components (timeline, event list, details panel)
- `src/index.html` - HTML entry point that imports React app

## Key Implementation Details

### Agent Discovery
Sub-agents are discovered by scanning log entries for `toolUseResult.agentId` fields, then loading corresponding `agent-<id>.jsonl` files from the same directory as the main session log.

### Resumed Agents
When a Task tool is called with a `resume` parameter, events for that agent appear in both:
1. The agent's own log file (`agent-<id>.jsonl`)
2. The main session log (after resume)

The parser combines events from both sources and sorts chronologically.

### Tool Use Matching
To extract agent metadata (from Task tool parameters like `description`, `model`, `subagent_type`), the parser:
1. Finds tool results with `agentId` in user messages
2. Extracts `tool_use_id` from the tool_result content
3. Searches backward for assistant messages containing matching `tool_use` with that ID
4. Extracts input parameters from the tool_use

### Security
Directory and session path parameters are validated to prevent path traversal attacks. All paths must be within `~/.claude/projects/`.

## Bun-Specific Patterns

Default to using Bun instead of Node.js:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv

### Bun APIs
- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa

### Frontend with Bun
HTML imports with `Bun.serve()` support React, CSS, and Tailwind without Vite. HTML files can import `.tsx`, `.jsx`, or `.js` files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle them.
