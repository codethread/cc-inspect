FROM node:22-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git openssh-client gnupg unzip \
    && rm -rf /var/lib/apt/lists/*

# Bun (root)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Playwright CLI + Chromium — agent-optimized CLI
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN npm install -g @playwright/cli@latest \
    && PW="$(npm root -g)/@playwright/cli/node_modules/.bin/playwright" \
    && "$PW" install --with-deps chromium \
    && chmod -R a+rx /opt/ms-playwright

# Non-root user — UID remapped by --userns=keep-id at runtime
RUN useradd -m -s /bin/bash user
USER user
RUN mkdir -p ~/.ssh && chmod 700 ~/.ssh \
    && ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/user/.bun/bin:/home/user/.local/bin:${PATH}"

# Claude Code — download binary directly, skip self-installer (OOMs at 2GB)
RUN BUCKET="https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases" \
    && VERSION=$(curl -fsSL "$BUCKET/latest") \
    && case "$(uname -m)" in \
        aarch64) ARCH="arm64" ;; \
        x86_64)  ARCH="x64"   ;; \
        *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;; \
    esac \
    && mkdir -p "$HOME/.local/bin" \
    && curl -fsSL "$BUCKET/$VERSION/linux-${ARCH}/claude" -o "$HOME/.local/bin/claude" \
    && chmod +x "$HOME/.local/bin/claude"

RUN git config --global --add safe.directory /cc-inspect

WORKDIR /cc-inspect

CMD ["bash"]
