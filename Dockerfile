# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for @pll/server.
# Stage 1 (builder): install all workspace deps + compile native better-sqlite3.
# Stage 2 (runtime): copy node_modules + workspace source; run server with tsx.
#
# Default DB path inside the container: /data/lacrosse.db
# Mount Azure Files (or any persistent volume) at /data.

ARG NODE_VERSION=20-alpine

############################
# Stage 1 — build / install
############################
FROM node:${NODE_VERSION} AS builder

# Native build deps for better-sqlite3
RUN apk add --no-cache python3 make g++ libc6-compat

# pnpm via corepack (pinned in package.json -> packageManager)
RUN corepack enable

WORKDIR /app

# Copy lockfile + workspace manifests first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json  ./packages/shared/
COPY packages/ingest/package.json  ./packages/ingest/
COPY packages/server/package.json  ./packages/server/
COPY packages/web/package.json     ./packages/web/

# Install everything (including dev deps — tsx is needed at runtime).
# --frozen-lockfile keeps the image deterministic.
# pnpm 10 requires explicit allow-list for native build scripts; root
# package.json sets pnpm.onlyBuiltDependencies = ["better-sqlite3", "esbuild"].
RUN pnpm install --frozen-lockfile

# Belt-and-braces: ensure the native better-sqlite3 binding exists for the
# image's arch. Without this, pnpm's script gate can silently skip the
# postinstall and the container exits with "Could not locate the bindings file".
RUN pnpm rebuild better-sqlite3

# Now copy the rest of the workspace source the server needs
COPY packages/shared ./packages/shared
COPY packages/ingest ./packages/ingest
COPY packages/server ./packages/server

# Optional typecheck — fail fast if the image source is broken.
# (Skipped by default to keep CI separate; uncomment if you want belt-and-braces.)
# RUN pnpm --filter @pll/server typecheck

############################
# Stage 2 — runtime
############################
FROM node:${NODE_VERSION} AS runtime

# libstdc++ is required by the better-sqlite3 prebuilt binary on alpine.
RUN apk add --no-cache libstdc++ libc6-compat tini \
  && addgroup -S app && adduser -S app -G app \
  && mkdir -p /data && chown -R app:app /data

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DB_PATH=/data/lacrosse.db

# Pull installed deps + source from the builder stage.
COPY --from=builder --chown=app:app /app/node_modules           ./node_modules
COPY --from=builder --chown=app:app /app/package.json           ./package.json
COPY --from=builder --chown=app:app /app/pnpm-workspace.yaml    ./pnpm-workspace.yaml
COPY --from=builder --chown=app:app /app/tsconfig.base.json     ./tsconfig.base.json
COPY --from=builder --chown=app:app /app/packages/shared        ./packages/shared
COPY --from=builder --chown=app:app /app/packages/ingest        ./packages/ingest
COPY --from=builder --chown=app:app /app/packages/server        ./packages/server

USER app

EXPOSE 8080

# Tini handles PID-1 signal forwarding for clean Fastify shutdown.
ENTRYPOINT ["/sbin/tini", "--"]

# Run the server through its installed tsx (no global install needed).
CMD ["node", "node_modules/tsx/dist/cli.mjs", "packages/server/src/index.ts"]
