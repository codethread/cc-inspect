#!/bin/bash
# Regenerate TanStack Router route tree when route files are modified.
# Triggered by PostToolUse on Write/Edit.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" =~ src/frontend/routes/ ]]; then
  cd "$CLAUDE_PROJECT_DIR" || exit 0
  bun tsr generate 2>&1
fi

exit 0
