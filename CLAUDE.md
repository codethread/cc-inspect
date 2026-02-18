# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cc-inspect is a web-based visualizer for Claude Code session logs. It parses `.jsonl` log files from `~/.claude/projects/` and displays them in an interactive timeline with agent hierarchies and event details.

## Common Commands

### Development

- `bun dev` - Generate route tree then start development server with hot reload on port 5555
- `bun run routes:generate` - Regenerate TanStack Router route tree (`src/frontend/routeTree.gen.ts`)
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

Three main domains, each with their own `CLAUDE.md` containing detailed documentation:

- **`src/lib/`** — Self-contained Claude SDK for parsing `.jsonl` session logs
- **`src/server/`** — Bun HTTP server with REST API endpoints consuming the SDK
- **`src/frontend/`** — React app for timeline visualization

**`src/types.ts`** bridges the domains: re-exports SDK types via `#types` alias and defines app-level API response schemas (discriminated unions) for the server-frontend contract.

## Code Style

- Focus on pure functions with minimal side effects
- Use dependency injection to maximise testability
- Validate all unknown IO through Zod, parse into discriminated union types where possible
- No public API or legacy behaviour — breaking changes are fine, but all checks must pass
- Avoid index files and default exports; use named files and exports. TypeScript namespaces are valid for grouping logical functions
- Use inline interfaces for return types in most cases (or shared interfaces if applicable)

## Test Style

- Table-driven tests (`it.each` or similar) aligned with pure function input/output assertions
- Reuse common factory functions to make input refactors easier
