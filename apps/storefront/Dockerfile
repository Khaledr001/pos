# =============================================================================
# apps/storefront — the online store, as a standalone production image
#
# Build from the REPO ROOT:
#
#   docker build -f apps/storefront/Dockerfile -t devsfleet-storefront .
#
# One image serves every tenant's shop: the API picks the tenant from the
# hostname each request arrives on. Like the admin panel it never touches
# Postgres — everything is an HTTP call to the API.
# =============================================================================

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /repo
ENV PNPM_HOME=/pnpm
ENV CI=true

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/storefront/package.json            apps/storefront/
COPY packages/storefront-client/package.json packages/storefront-client/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@devsfleet/storefront...

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/storefront/node_modules ./apps/storefront/node_modules
COPY --from=deps /repo/packages/storefront-client/node_modules ./packages/storefront-client/node_modules
COPY tsconfig.base.json pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/storefront-client ./packages/storefront-client
COPY apps/storefront ./apps/storefront
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter=@devsfleet/storefront build

FROM node:24-alpine AS runtime
RUN apk add --no-cache tini curl && \
    addgroup -g 1001 -S devsfleet && \
    adduser  -u 1001 -S devsfleet -G devsfleet
WORKDIR /app

# The standalone output keeps the workspace layout; server.js is under apps/storefront.
COPY --from=build --chown=devsfleet:devsfleet /repo/apps/storefront/.next/standalone ./
COPY --from=build --chown=devsfleet:devsfleet /repo/apps/storefront/.next/static ./apps/storefront/.next/static
COPY --from=build --chown=devsfleet:devsfleet /repo/apps/storefront/public ./apps/storefront/public

USER devsfleet
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS -o /dev/null http://127.0.0.1:${PORT}/robots.txt || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/storefront/server.js"]
