.PHONY: run

run:
	bun install
	bun run --cwd packages/cc-inspect build
	mkdir -p ~/.local/bin
	ln -sf $(CURDIR)/packages/cc-inspect/bin/cc-inspect ~/.local/bin/cc-inspect
	cc-inspect
