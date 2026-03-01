#!/usr/bin/env bash
# Run Claude Code in a sandboxed Podman container
set -euo pipefail

IMAGE_NAME="cc-inspect-sandbox"
CONTAINER_NAME="cc-inspect-sandbox"
SCRIPT_DIR="$(dirname "$0")"

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
    podman build --no-cache -t "$IMAGE_NAME" "$SCRIPT_DIR"
elif ! podman image exists "$IMAGE_NAME"; then
    echo "Building container image..."
    podman build -t "$IMAGE_NAME" "$SCRIPT_DIR"
fi

SSH_AGENT_ARGS=()
if [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
    SSH_AGENT_ARGS=(
        -v "$SSH_AUTH_SOCK:/tmp/ssh-agent.sock"
        -e "SSH_AUTH_SOCK=/tmp/ssh-agent.sock"
    )
fi

exec podman run -it --rm \
    --name "$CONTAINER_NAME" \
    --userns=keep-id \
    --shm-size=2g \
    --security-opt seccomp=unconfined \
    -v "$(pwd):/workspace" \
    -v "$HOME/.claude:/home/user/.claude" \
    -v "$HOME/.claude.json:/home/user/.claude.json" \
    -v "$HOME/.config/git:/home/user/.config/git:ro" \
    "${SSH_AGENT_ARGS[@]}" \
    -p 3000:3000 \
    -p 5555:5555 \
    "$IMAGE_NAME" \
    $(if [[ "$INTERACTIVE" == true ]]; then echo "bash"; else echo "claude --dangerously-skip-permissions"; fi)
