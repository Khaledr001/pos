# =============================================================================
# apps/api — standalone production image
#
# Build from the REPO ROOT, because the build stage needs the lockfile and the
# workspace packages this service imports:
#
#   docker build -f apps/api/Dockerfile -t devsfleet-api .
#
# The resulting image contains only this service and its own node_modules. It
# has no knowledge of apps/admin or apps/pos and never resolves a path outside
# its own directory, which is what lets it move to its own host whenever you
# want.
# =============================================================================

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /repo
ENV PNPM_HOME=/pnpm
ENV CI=true

# -----------------------------------------------------------------------------
# deps — install only what this service's dependency graph needs.
#
# `--filter=@devsfleet/api...` (trailing dots) means "this package AND its
# workspace dependencies". Without it, every build would also fetch Electron and
# Next.js, which this image never runs.
# -----------------------------------------------------------------------------
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json            apps/api/
COPY packages/db/package.json         packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-utils/package.json packages/shared-utils/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@devsfleet/api...

# -----------------------------------------------------------------------------
# build
# -----------------------------------------------------------------------------
FROM base AS build

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages ./packages
COPY tsconfig.base.json pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm --filter=@devsfleet/api... build

# `pnpm deploy` flattens the workspace: symlinked workspace packages become
# real directories inside the output's node_modules, so the result runs with no
# monorepo present. --legacy is required from pnpm 10 unless the workspace opts
# into injected dependencies.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter=@devsfleet/api --prod --legacy /out

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
COPY --from=build --chown=devsfleet:devsfleet /repo/packages/db/migrations ./migrations
COPY --from=build --chown=devsfleet:devsfleet /repo/packages/db/sql        ./sql

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
