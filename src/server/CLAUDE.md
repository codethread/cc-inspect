# Server (src/server/)

## Overview

Thin Bun server layer with REST API endpoints consuming the Claude SDK. Entry point is `index.tsx` (CLI binary via shebang). The server is a pass-through — all log parsing logic lives in `src/lib/claude/` (see `src/lib/CLAUDE.md` for the log format and parsing details).

## API Endpoints

- `/api/directories` — `claude.listProjects()` → directory IDs
- `/api/sessions?directory=<dir>` — `claude.listSessions(project)` → session handles
- `/api/session?path=<path>` — `claude.parseSession(session)` → full session data
- `DELETE /api/session?path=<path>` — delete a session

Route handlers live in `routes/`.

## Files

- `index.tsx` — Bun server entry point, CLI flag parsing via `util.parseArgs()`. `-s/--session` pre-validates via `claude.parseSession()`
- `routes/` — Thin route handlers delegating to the Claude SDK
- `utils.ts` — Path traversal validation (`isValidDirectory`, `isValidSessionPath`) and constants

## Security

Path traversal validation is a server concern, not an SDK concern. All directory/session path parameters are validated to ensure they stay within `~/.claude/projects/`.

## Bun-Specific Patterns

Default to using Bun instead of Node.js:

- `Bun.serve()` for HTTP (supports WebSockets, HTTPS, routes). Don't use `express`
- `Bun.file` over `node:fs` readFile/writeFile
- Bun automatically loads .env — don't use dotenv

### Frontend Serving

HTML imports with `Bun.serve()` support React, CSS, and Tailwind without Vite. HTML files can import `.tsx`/`.jsx`/`.js` directly and Bun's bundler transpiles and bundles automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler handles them.
