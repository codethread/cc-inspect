# cc-inspect

A web-based visualizer for Claude Code session logs.

## Installation

Install dependencies:

```bash
bun install
```

Link the executable globally:

```bash
npm link
```

## Usage

Start the server:

```bash
cc-inspect
```

Or load a specific session:

```bash
cc-inspect -s ~/.claude/projects/-Users-foo/session-id.jsonl
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
