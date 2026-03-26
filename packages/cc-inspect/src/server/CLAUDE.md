# Server instructions

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
