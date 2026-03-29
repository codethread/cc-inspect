# PRD: Simplify Build Config & Hook Naming

## Overview

Clean up the split between Makefile, package.json scripts, and Claude hooks so each has a single clear responsibility:

- **Makefile** — consumer entry point only (install + run)
- **Root package.json** — source of truth for all dev scripts
- **Claude hooks** — named after behavior, call package.json scripts or binaries directly

## Goals

- Remove indirection (hooks calling Make calling package.json)
- Name hooks after what they do, not what tool they use
- Makefile becomes a thin consumer convenience wrapper

## Non-Goals

- Changing biome config or lint rules
- Changing the build pipeline itself
- Modifying per-package scripts (`packages/cc-inspect/package.json`, `packages/claude-sdk/package.json`)

## Changes

### 1. Makefile — strip to `run` only

**Current:** Has targets for `run`, `lint`, `fmt`, `fmt-check`, `check`, `fix`, `typecheck`, `build`, `test`, `verify`.

**Target:** Keep only the `run` target. Remove everything else. The `run` target already does install → build → symlink → launch, which is all consumers need.

### 2. Root package.json — update `verify` script

**Current:** `"verify": "bun run typecheck && bun run check && bun run build"`

**Target:** `"verify": "bun run fix && bun run typecheck && bun run build"`

Replace `check` (report-only) with `fix` (auto-correct). The existing `fix` script already uses `--write --unsafe` flags so it auto-corrects everything it can before typechecking. Order is: fix → typecheck → build.

### 3. Rename `post-edit-biome.ts` → `post-edit-check.ts`

**Current file:** `.claude/hooks/post-edit-biome.ts` — runs `biome check --write` on the edited file.

**Target file:** `.claude/hooks/post-edit-check.ts` — same behavior, add `--unsafe` flag to match the fix script. Named after behavior ("check after edit") not tooling ("biome").

The hook:
- Reads `file_path` from stdin JSON (`input.tool_input.file_path`)
- Skips non-`.ts`/`.tsx` files
- Runs `biome check --write --unsafe --log-level=error` on the single file
- Reports any remaining errors to stdout

### 4. Update `stop-verify.ts` — call `bun run verify` instead of `make verify`

**Current:** Runs `make verify` (which chains through Make targets back to package.json scripts).

**Target:** Runs `bun run verify` directly — package.json is the source of truth.

### 5. Update `.claude/settings.json`

Update `PostToolUse` hook command paths from `post-edit-biome.ts` → `post-edit-check.ts`. Both `Edit` and `Write` matchers point to the same hook.

## QA Criteria

### Agent-verifiable

- `make` (default target) runs successfully
- `bun run verify` from root passes (exits 0)
- `bun run verify` stderr shows execution order: fix → typecheck → build
- No references to removed Makefile targets in hook files
- `.claude/hooks/post-edit-check.ts` exists, `post-edit-biome.ts` does not
- `.claude/settings.json` references `post-edit-check.ts`, not `post-edit-biome.ts`
- `stop-verify.ts` calls `bun run verify`, not `make verify`

### Hook integration tests (via headless Claude harness)

A prototype harness exists at `test-hooks-harness.ts`. It spawns `claude -p` in a subprocess to verify hooks fire correctly end-to-end.

**Harness details:**

- Strips `CLAUDECODE` env var (the only guard needed — prevents nested Claude Code detection)
- Flags: `--model haiku --verbose --output-format stream-json --dangerously-skip-permissions --max-turns N`
- `--verbose` is required for `stream-json` to work
- Cost: ~$0.01-0.03 per run with haiku

**Key finding from prototyping:** PostToolUse hooks don't emit stream events — verify them by checking **file effects** (e.g. biome formatted the file). Stop hooks do emit `hook_started`/`hook_response` events with `hook_event="Stop"`.

**Scratch file placement:** Must be inside `packages/*/src/` to match biome's `includes` pattern (`"packages/*/src/**/*.ts"` in `biome.json`).

**Test cases:**

1. **Post-edit check** — Create a scratch `.ts` file at `packages/cc-inspect/src/_hook-test-scratch.ts` with deliberately bad formatting (e.g. `const y=2` missing spaces). Instruct Claude to read then edit the file (`--max-turns 4`). After completion, verify the file has biome formatting applied (spaces around `=`, etc.) — this proves the PostToolUse hook ran.

2. **Verify pipeline** — Run `bun run verify` directly (no Claude needed). Confirm exit code 0 and stderr shows fix, typecheck, and build steps executed.

### Human-verifiable

- Edit a `.ts` file in an interactive Claude Code session → post-edit-check hook fires and formats
- Complete a task → stop-verify hook runs the full verify pipeline

## Files to modify

| File | Action |
|------|--------|
| `Makefile` | Strip to `run` target only |
| `package.json` | Change `verify` script: `check` → `fix` |
| `.claude/hooks/post-edit-biome.ts` | Rename to `post-edit-check.ts`, add `--unsafe` flag |
| `.claude/hooks/stop-verify.ts` | Replace `make verify` with `bun run verify` |
| `.claude/settings.json` | Update hook command paths |
| `test-hooks-harness.ts` | Update to test against renamed hooks (cleanup after QA) |
