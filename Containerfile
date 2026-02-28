FROM node:22-slim

# System deps (no Playwright/Chromium - browser runs on host via MCP)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git openssh-client gnupg unzip \
    && rm -rf /var/lib/apt/lists/*

# Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

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
