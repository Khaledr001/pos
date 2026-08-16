# =============================================================================
# devsfleet-api — standalone production image
#
# Build from this repo's root:
#
#   docker build -t devsfleet-api .
#
# No monorepo context needed. This image is self-contained.
# =============================================================================

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV CI=true

# -----------------------------------------------------------------------------
# deps — install everything this repo needs
# -----------------------------------------------------------------------------
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/db/package.json         packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-utils/package.json packages/shared-utils/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# build
# -----------------------------------------------------------------------------
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared-types/node_modules ./packages/shared-types/node_modules 2>/dev/null || true
COPY --from=deps /app/packages/shared-utils/node_modules ./packages/shared-utils/node_modules

COPY . .

# Build shared packages first (dependency order), then the API
RUN pnpm --filter @devsfleet/shared-types build && \
    pnpm --filter @devsfleet/shared-utils build && \
    pnpm --filter @devsfleet/db build && \
    pnpm run build

# Flatten the workspace for production: workspace packages become real
# directories inside the output's node_modules.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --prod --legacy /out

# -----------------------------------------------------------------------------
# runtime
# -----------------------------------------------------------------------------
FROM node:24-alpine AS runtime

# tini reaps zombies and forwards SIGTERM, so `enableShutdownHooks` actually
# runs — without it a deploy can kill the process mid-write on a sale.
RUN apk add --no-cache tini curl && \
    addgroup -g 1001 -S devsfleet && \
    adduser  -u 1001 -S devsfleet -G devsfleet

WORKDIR /app
COPY --from=build --chown=devsfleet:devsfleet /out/node_modules ./node_modules
COPY --from=build --chown=devsfleet:devsfleet /out/dist         ./dist
COPY --from=build --chown=devsfleet:devsfleet /out/package.json ./package.json

# Migrations and the RLS/trigger SQL, so a release job can run them from this
# same image rather than needing a checkout on the server.
COPY --from=build --chown=devsfleet:devsfleet /app/packages/db/migrations ./migrations
COPY --from=build --chown=devsfleet:devsfleet /app/packages/db/sql        ./sql

USER devsfleet

ENV NODE_ENV=production
ENV API_PORT=3001
EXPOSE 3001

# Compose and orchestrators use this to decide readiness. /health is
# deliberately dependency-free; /ready is the one that checks Postgres.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${API_PORT}/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
