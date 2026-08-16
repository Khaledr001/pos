# =============================================================================
# apps/admin — standalone production image
#
# Build from the REPO ROOT:
#
#   docker build -f apps/admin/Dockerfile -t devsfleet-admin .
#
# Uses Next.js `output: "standalone"`, which traces the exact files the server
# needs — including the workspace packages — and emits a self-contained bundle.
# The image never talks to Postgres; it calls the API over HTTP, so it can live
# on a different host from day one.
# =============================================================================

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /repo
ENV PNPM_HOME=/pnpm
ENV CI=true

# -----------------------------------------------------------------------------
# deps
# -----------------------------------------------------------------------------
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/admin/package.json            apps/admin/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-utils/package.json packages/shared-utils/

# Note the absence of packages/db — the admin panel has no database access,
# and the boundary check in scripts/check-boundaries.mjs keeps it that way.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@devsfleet/admin...

# -----------------------------------------------------------------------------
# build
# -----------------------------------------------------------------------------
FROM base AS build

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/admin/node_modules ./apps/admin/node_modules
COPY tsconfig.base.json pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/admin ./apps/admin

# NEXT_PUBLIC_* is inlined into the client bundle at BUILD time, not read at
# runtime. The API URL therefore has to be supplied here:
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://api.devsfleet.com/api/v1 ...
# Changing it later means rebuilding the image, not restarting the container.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter=@devsfleet/shared-types --filter=@devsfleet/shared-utils build \
 && pnpm --filter=@devsfleet/admin build

# -----------------------------------------------------------------------------
# runtime
# -----------------------------------------------------------------------------
FROM node:24-alpine AS runtime

RUN apk add --no-cache tini curl && \
    addgroup -g 1001 -S devsfleet && \
    adduser  -u 1001 -S devsfleet -G devsfleet

WORKDIR /app

# In a monorepo the standalone output keeps the workspace layout:
#   .next/standalone/node_modules          hoisted deps
#   .next/standalone/apps/admin/server.js  the entrypoint
# Copying the tree wholesale preserves the relative paths server.js expects.
COPY --from=build --chown=devsfleet:devsfleet /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=devsfleet:devsfleet /repo/apps/admin/.next/static ./apps/admin/.next/static

USER devsfleet

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT}/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/admin/server.js"]
