# Build from the repository root:  docker build -f backend/Dockerfile .
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/
COPY packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile --filter backend...
COPY backend backend
RUN pnpm --filter backend exec prisma generate && pnpm --filter backend build
# Production dependencies only, plus the compiled app (dist includes the generated Prisma client).
RUN pnpm deploy --filter backend --prod --legacy /out && cp -r backend/dist /out/dist

FROM base AS run
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=build /out ./
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
USER node
EXPOSE 4000
# Apply pending migrations, then start the API.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
