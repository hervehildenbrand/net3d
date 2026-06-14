# syntax=docker/dockerfile:1

# ── builder: install the workspace and build the web UI ─────────────────────
FROM node:22-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# Manifests first so `pnpm install` is cached until dependencies change.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

# Sources, then build the UI to packages/web/dist.
COPY . .
RUN pnpm --filter @net3d/web build

# ── runtime: the Fastify proxy (via tsx) serving the built UI ───────────────
FROM node:22-slim AS runtime
WORKDIR /app/packages/server
# Bring over the installed workspace + built UI from the builder.
COPY --from=builder /app /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
# Absolute path so it resolves regardless of the process working directory.
ENV WEB_DIST=/app/packages/web/dist
EXPOSE 8080

# @net3d/shared and the server both run straight from TypeScript via tsx; no
# transpile step, no pnpm/corepack needed at runtime.
CMD ["node", "--import", "tsx", "src/index.ts"]
