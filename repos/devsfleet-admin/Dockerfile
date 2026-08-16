# =============================================================================
# devsfleet-admin — standalone production image
#
# Build from this repo's root:
#
#   docker build -t devsfleet-admin .
#
# No monorepo context needed. This image is self-contained.
# =============================================================================

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV CI=true

# -----------------------------------------------------------------------------
# deps
# -----------------------------------------------------------------------------
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-utils/package.json packages/shared-utils/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# build
# -----------------------------------------------------------------------------
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared-types/node_modules ./packages/shared-types/node_modules 2>/dev/null || true
COPY --from=deps /app/packages/shared-utils/node_modules ./packages/shared-utils/node_modules

COPY . .

# NEXT_PUBLIC_* is inlined into the client bundle at BUILD time.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# Build shared packages first, then Next.js
RUN pnpm --filter @devsfleet/shared-types build && \
    pnpm --filter @devsfleet/shared-utils build && \
    pnpm run build

# -----------------------------------------------------------------------------
# runtime
# -----------------------------------------------------------------------------
FROM node:24-alpine AS runtime

RUN apk add --no-cache tini curl && \
    addgroup -g 1001 -S devsfleet && \
    adduser  -u 1001 -S devsfleet -G devsfleet

WORKDIR /app

# Next.js standalone output
COPY --from=build --chown=devsfleet:devsfleet /app/.next/standalone ./
COPY --from=build --chown=devsfleet:devsfleet /app/.next/static ./.next/static

USER devsfleet

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT}/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
