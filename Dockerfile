FROM node:24-bookworm

ARG CODEX_CLI_VERSION=0.165.0
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    NODE_USE_ENV_PROXY=1 \
    CODEX_CLI_PATH=/usr/local/bin/codex \
    CODEX_ONLY_MODE=true

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git unzip patch python3 make g++ ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@${CODEX_CLI_VERSION}

WORKDIR /opt/codex-web
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3
COPY . .
RUN npm run prepare \
    && npm run test:codex-only \
    && npm run test:web-assets \
    && npm run test:cleanup \
    && npm run test:workspace-directory \
    && npm run test:download \
    && npm run test:startup \
    && rm -rf scratch/ChatGPT.app \
    && mkdir -p /workspace \
    && chown node:node /workspace

USER node
ENV HOME=/home/node
WORKDIR /workspace
EXPOSE 8214
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8214/__backend/ui-config.js').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "/opt/codex-web/scripts/docker-auth-proxy.mjs", "/opt/codex-web/src/server/main.js", "--host", "0.0.0.0", "--port", "8214"]
