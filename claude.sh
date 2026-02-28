#!/usr/bin/env bash
# :module: Run Claude Code in a sandboxed Podman container with host-side Playwright MCP
set -euo pipefail

IMAGE_NAME="cc-inspect-sandbox"
CONTAINER_NAME="cc-inspect-sandbox"
SCRIPT_DIR="$(dirname "$0")"
PLAYWRIGHT_MCP_PORT=8931

NO_CACHE=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        -n|--no-cache) NO_CACHE=true; shift ;;
        -h|--help) echo "Usage: $(basename "$0") [-n|--no-cache] [-h|--help]"; exit 0 ;;
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

# Start Playwright MCP on host (browser runs here, not in container)
# Bound to localhost only - container reaches it via slirp4netns loopback
# --allowed-hosts '*' needed: container connects via 10.0.2.2 which fails the
# DNS rebinding Host header check otherwise. Safe because we bind 127.0.0.1 only.
echo "Starting Playwright MCP on host port $PLAYWRIGHT_MCP_PORT..."
npx @playwright/mcp@latest \
    --port "$PLAYWRIGHT_MCP_PORT" \
    --host 127.0.0.1 \
    --isolated \
    --headless \
    --allowed-hosts '*' &
MCP_PID=$!
cleanup() { kill "$MCP_PID" 2>/dev/null; wait "$MCP_PID" 2>/dev/null; }
trap cleanup EXIT

# Readiness: /sse is an SSE stream so curl will "timeout" with exit 28 even on
# success. Check the HTTP status code instead.
MCP_READY=false
for _ in $(seq 1 15); do
    HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 1 "http://localhost:${PLAYWRIGHT_MCP_PORT}/sse" 2>/dev/null || true)
    if [[ "$HTTP_CODE" == "200" ]]; then
        MCP_READY=true
        break
    fi
    sleep 1
done
if [[ "$MCP_READY" != true ]]; then
    echo "ERROR: Playwright MCP failed to start on port $PLAYWRIGHT_MCP_PORT" >&2
    exit 1
fi
echo "Playwright MCP ready on port $PLAYWRIGHT_MCP_PORT"

SSH_AGENT_ARGS=()
if [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
    SSH_AGENT_ARGS=(
        -v "$SSH_AUTH_SOCK:/tmp/ssh-agent.sock"
        -e "SSH_AUTH_SOCK=/tmp/ssh-agent.sock"
    )
fi

# Run container (no exec - trap must fire for MCP cleanup)
podman run -it --rm \
    --name "$CONTAINER_NAME" \
    --userns=keep-id \
    --shm-size=2g \
    --security-opt seccomp=unconfined \
    --network=slirp4netns:allow_host_loopback=true \
    -v "$(pwd):/workspace" \
    -v "$HOME/.claude:/home/user/.claude" \
    -v "$HOME/.claude.json:/home/user/.claude.json" \
    -v "$HOME/.config/git:/home/user/.config/git:ro" \
    "${SSH_AGENT_ARGS[@]}" \
    -e "PLAYWRIGHT_MCP_URL=http://10.0.2.2:${PLAYWRIGHT_MCP_PORT}/mcp" \
    -p 3000:3000 \
    -p 5555:5555 \
    "$IMAGE_NAME"
