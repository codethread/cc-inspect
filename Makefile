.PHONY: run

run:
	bun install
	bun run build
	npm link
	cc-inspect
