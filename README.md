# cc-inspect

A web-based visualizer for Claude Code session logs.

## TL;DR

Install deps, build, link the binary, and run it:

```bash
make run
```

Load a specific session:

```bash
cc-inspect -s ~/.claude/projects/-Users-foo/session-id.jsonl
```

<img alt="Image" src="https://github.com/user-attachments/assets/76ee5b47-58ca-4418-9102-6b81878ed470" />

## Installation
For a manual setup, run `bun install`, `bun run build`, then `npm link`.

## Usage

Start the server:

```bash
cc-inspect
```

Or load a specific session:

```bash
cc-inspect -s ~/.claude/projects/-Users-foo/session-id.jsonl
```

Expose on your local network:

```bash
cc-inspect --host 0.0.0.0 --port 5555
```

View help:

```bash
cc-inspect --help
```

## Development

Start with hot reload:

```bash
bun dev
```

Run without linking:

```bash
bun start
```
