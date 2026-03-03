#!/usr/bin/env bash
# Run Claude Code in a sandboxed Podman container
set -euo pipefail

IMAGE_NAME="cc-inspect-sandbox"
CONTAINER_NAME="cc-inspect-sandbox"
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

NO_CACHE=false
INTERACTIVE=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        -n|--no-cache) NO_CACHE=true; shift ;;
        -i|--interactive) INTERACTIVE=true; shift ;;
        -h|--help) echo "Usage: $(basename "$0") [-n|--no-cache] [-i|--interactive] [-h|--help]"; exit 0 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [[ "$NO_CACHE" == true ]]; then
    echo "Rebuilding container image (no cache)..."
    podman build --no-cache -t "$IMAGE_NAME" "$PROJECT_ROOT"
elif ! podman image exists "$IMAGE_NAME"; then
    echo "Building container image..."
    podman build -t "$IMAGE_NAME" "$PROJECT_ROOT"
fi

TEMP_CLAUDE_SETTINGS="$(mktemp)"
cp "$HOME/.claude/settings.json" "$TEMP_CLAUDE_SETTINGS"

TEMP_SSH_CONFIG="$(mktemp)"
if [[ -f "$HOME/.ssh/config" ]]; then
    # Strip macOS-only options that OpenSSH on Linux rejects
    grep -iv 'usekeychain' "$HOME/.ssh/config" > "$TEMP_SSH_CONFIG"
else
    touch "$TEMP_SSH_CONFIG"
fi

trap 'rm -f "$TEMP_CLAUDE_SETTINGS" "$TEMP_SSH_CONFIG"' EXIT

SSH_ARGS=()
if [[ "$(uname -s)" == "Darwin" ]]; then
    # macOS: Podman VM can't reach the macOS SSH agent socket; mount ~/.ssh directly
    if [[ -d "$HOME/.ssh" ]]; then
        SSH_ARGS+=(
            -v "$HOME/.ssh:/home/user/.ssh:ro"
            -v "$TEMP_SSH_CONFIG:/home/user/.ssh/config:ro"
        )
    fi
elif [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
    # Linux: bind-mount the agent socket
    SSH_ARGS+=(
        -v "$SSH_AUTH_SOCK:/tmp/ssh-agent.sock"
        -e "SSH_AUTH_SOCK=/tmp/ssh-agent.sock"
    )
fi

podman run -it --rm \
    --name "$CONTAINER_NAME" \
    --userns=keep-id \
    --shm-size=2g \
    --security-opt seccomp=unconfined \
    -e TERM="${TERM:-xterm-256color}" \
    -e COLORTERM="${COLORTERM:-truecolor}" \
    -v "$PROJECT_ROOT:/cc-inspect" \
    -v "$HOME/.claude:/home/user/.claude" \
    -v "$TEMP_CLAUDE_SETTINGS:/home/user/.claude/settings.json" \
    -v "$HOME/.claude.json:/home/user/.claude.json" \
    -v "$(dirname "$(realpath "$HOME/.config/git/config")"):/home/user/.config/git:ro" \
    "${SSH_ARGS[@]}" \
    -p 3000:3000 \
    -p 5555:5555 \
    "$IMAGE_NAME" \
    $(if [[ "$INTERACTIVE" == true ]]; then echo "bash"; else echo "claude --dangerously-skip-permissions"; fi)
