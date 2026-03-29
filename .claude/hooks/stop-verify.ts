#!/usr/bin/env bun

import { $ } from "bun";

const input = await Bun.stdin.json();

const root = process.env.CLAUDE_PROJECT_DIR ?? input?.cwd ?? process.cwd();

const verify = await $`make verify`
  .cwd(root)
  .quiet()
  .nothrow();

if (verify.exitCode !== 0) {
  const out = [verify.stdout.toString().trim(), verify.stderr.toString().trim()]
    .filter(Boolean)
    .join("\n");
  console.log(
    JSON.stringify({
      decision: "block",
      reason: out,
    }),
  );
}
