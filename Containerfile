FROM node:22-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git openssh-client gnupg unzip \
    && rm -rf /var/lib/apt/lists/*

# Bun (root)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Playwright CLI + Chromium — agent-optimized CLI, no MCP server needed.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN npm install -g @playwright/cli@latest \
    && PW="$(npm root -g)/@playwright/cli/node_modules/.bin/playwright" \
    && "$PW" install --with-deps chromium \
    && chmod -R a+rx /opt/ms-playwright

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

# Non-root user — UID remapped by --userns=keep-id at runtime
RUN useradd -m -s /bin/bash user
USER user
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/user/.bun/bin:/home/user/.local/bin:${PATH}"

# Claude Code native binary — installs to ~/.local/bin/claude
RUN curl -fsSL https://claude.ai/install.sh | bash

WORKDIR /workspace

ENTRYPOINT ["entrypoint.sh"]
CMD ["bash"]
