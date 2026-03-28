.PHONY: run lint fmt fmt-check check fix typecheck build verify test

run:
	bun install
	bun run --cwd packages/cc-inspect build
	mkdir -p ~/.local/bin
	ln -sf $(CURDIR)/packages/cc-inspect/bin/cc-inspect ~/.local/bin/cc-inspect
	cc-inspect

lint:
	bun run lint

fmt:
	bun run fmt

fmt-check:
	bun run fmt:check

check:
	bun run check

fix:
	bun run fix

typecheck:
	bun run typecheck

build:
	bun run build

test:
	bun run --filter '*' test

verify: typecheck lint fmt-check
