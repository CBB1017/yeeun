# syntax=docker/dockerfile:1.7
# Base image pinned by version and digest (see docs/versions.md).
ARG NODE_IMAGE=node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9

# ---------- dependencies ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --ignore-scripts=false

# ---------- build ----------
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---------- web runtime ----------
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "build/index.js"]

# ---------- migrate (one-shot) ----------
FROM web AS migrate
HEALTHCHECK NONE
CMD ["node", "dist/migrate.js"]

# ---------- worker toolchain (parsers, OCR, office conversion; no CLI binaries) ----------
FROM ${NODE_IMAGE} AS worker-base
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tesseract-ocr tesseract-ocr-kor tesseract-ocr-eng poppler-utils \
      libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-writer-nogui fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/* \
 && dpkg-query -W -f='${Package}=${Version}\n' tesseract-ocr tesseract-ocr-kor tesseract-ocr-eng poppler-utils libreoffice-core-nogui libreoffice-calc-nogui libreoffice-impress-nogui fonts-noto-cjk > /etc/yeeun-tool-versions

# Test image: same toolchain; source + node_modules are mounted by Compose.
FROM worker-base AS worker-test
WORKDIR /workspace
CMD ["npx", "vitest", "run"]

# ---------- worker runtime ----------
FROM worker-base AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
ENV HOME=/home/node
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=6 \
  CMD ["node", "dist/healthcheck.js", "worker"]
CMD ["node", "dist/worker.js"]

# ---------- cli-runner bundle (node builtins only) ----------
FROM deps AS runner-build
COPY scripts/build-runner.mjs ./scripts/
COPY src/lib/server/cli/runner-core.ts ./src/lib/server/cli/
COPY src/server-entry/cli-runner.ts ./src/server-entry/
RUN node scripts/build-runner.mjs

# ---------- cli-runner: only the CLI binaries + owner subscription auth volume ----------
FROM ${NODE_IMAGE} AS cli-runner
ARG CLAUDE_CODE_VERSION=2.1.316
ARG CODEX_VERSION=0.166.0
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.npm \
    npm install -g --no-audit --no-fund \
      @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION}
RUN mkdir -p /cli-auth/claude /cli-auth/codex /runner/work \
 && chown -R node:node /cli-auth /runner
WORKDIR /runner
COPY --from=runner-build --chown=node:node /app/dist/cli-runner.js ./cli-runner.js
USER node
ENV HOME=/home/node \
    CLAUDE_CONFIG_DIR=/cli-auth/claude \
    CODEX_HOME=/cli-auth/codex \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "cli-runner.js"]
