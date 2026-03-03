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
    # Strip macOS-only options that OpenSSH on Linux rejects; grep exits 1 on no match
    grep -iv 'usekeychain' "$HOME/.ssh/config" > "$TEMP_SSH_CONFIG" || true
fi

cleanup() {
    rm -f "$TEMP_CLAUDE_SETTINGS" "$TEMP_SSH_CONFIG"
    [[ -n "${SSH_TUNNEL_PID:-}" ]] && kill "$SSH_TUNNEL_PID" 2>/dev/null || true
}
trap cleanup EXIT

GIT_CONFIG_DIR=""
if [[ -f "$HOME/.config/git/config" ]]; then
    GIT_CONFIG_DIR="$(dirname "$(realpath "$HOME/.config/git/config")")"
fi

VM_SSH_SOCK="/tmp/host-ssh-agent.sock"
SSH_TUNNEL_PID=""
SSH_ARGS=()
if [[ "$(uname -s)" == "Darwin" ]]; then
    if [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
        # macOS: reverse-tunnel host SSH agent into the Podman VM (virtiofs can't share sockets)
        podman machine ssh -- rm -f "$VM_SSH_SOCK"
        podman machine ssh -- -R "$VM_SSH_SOCK:$SSH_AUTH_SOCK" -N &
        SSH_TUNNEL_PID=$!
        sleep 0.5
        SSH_ARGS+=(
            -v "$VM_SSH_SOCK:/tmp/ssh-agent.sock"
            -e "SSH_AUTH_SOCK=/tmp/ssh-agent.sock"
        )
    fi
    # Mount filtered SSH config for host entries (IdentityFile directives, etc.)
    if [[ -f "$HOME/.ssh/config" ]]; then
        SSH_ARGS+=(-v "$TEMP_SSH_CONFIG:/home/user/.ssh/config:ro")
    fi
elif [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
    # Linux: bind-mount the agent socket directly
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
    ${GIT_CONFIG_DIR:+-v "$GIT_CONFIG_DIR:/home/user/.config/git:ro"} \
    "${SSH_ARGS[@]}" \
    -p 3000:3000 \
    -p 5555:5555 \
    "$IMAGE_NAME" \
    $(if [[ "$INTERACTIVE" == true ]]; then echo "bash"; else echo "claude --dangerously-skip-permissions"; fi)
