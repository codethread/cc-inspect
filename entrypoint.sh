#!/bin/bash
# Configure Playwright MCP connection to host if URL is provided
if [[ -n "${PLAYWRIGHT_MCP_URL:-}" ]]; then
    cat > /workspace/.mcp.json <<EOF
{
  "mcpServers": {
    "playwright": {
      "type": "http",
      "url": "${PLAYWRIGHT_MCP_URL}"
    }
  }
}
EOF
fi
exec "$@"
