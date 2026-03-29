# Progress

## Codebase Patterns

- **Makefile shim**: When removing Makefile targets that hooks depend on, keep a thin shim
  delegating to `bun run <cmd>` until the hook is migrated. Task 002 must remove the
  `verify` shim when it updates `stop-verify.ts`.
- **verify script order**: `bun run fix` must run before typecheck/build so formatting
  is applied before type errors are surfaced.
- **Hook file permissions**: Files created by the Write tool are mode 644 (not executable).
  Hook files invoked directly as commands (not via `bun <path>`) must have executable bit set
  with `chmod +x` after creation.

---

## Task Log

### 001 — Update root package.json verify script and strip Makefile
**Completed**: 2026-03-30

Changed `verify` script from `typecheck && check && build` to `fix && typecheck && build`.
Stripped Makefile to run+verify; verify shims to `bun run verify` to avoid breaking the
stop-verify hook which still calls `make verify`. Task 002 should finish the cleanup.

### 003 — Run integration tests via harness and clean up
**Completed**: 2026-03-30

Ran `bun test-hooks-harness.ts` — all 7 checks passed (Edit called, session succeeded,
biome formatted spacing, edit applied, verify exit 0, typecheck/fix/build all ran).
Deleted harness and scratch files.

### 002 — Rename post-edit hook, update stop-verify hook, update settings.json
**Completed**: 2026-03-30

Created `post-edit-check.ts` with `--unsafe` flag, deleted `post-edit-biome.ts`, updated
`stop-verify.ts` to use `bun run verify`, updated `settings.json` to reference new hook.
Also removed the Makefile `verify` shim (as planned). Hook file needed `chmod +x` since
Write tool creates files as 644.
