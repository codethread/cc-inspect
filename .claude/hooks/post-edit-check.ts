#!/usr/bin/env bun

import {$} from "bun"

const input = await Bun.stdin.json()

const filePath: string | undefined = input?.tool_input?.file_path
if (!filePath || !/\.(ts|tsx)$/.test(filePath)) {
	process.exit(0)
}

const root = process.env.CLAUDE_PROJECT_DIR ?? input?.cwd ?? process.cwd()

const biome = process.env.BIOME_BINARY ?? "biome"
const result = await $`${biome} check --write --unsafe --log-level=error ${filePath}`
	.cwd(root)
	.quiet()
	.nothrow()

if (result.exitCode !== 0) {
	const out = [result.stdout.toString().trim(), result.stderr.toString().trim()]
		.filter(Boolean)
		.join("\n")
	if (out) {
		console.log(out)
	}
}
