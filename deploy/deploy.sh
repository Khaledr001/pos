#!/usr/bin/env bash
# =============================================================================
# DevsFleet POS — build and release on the VPS.
#
#   ./deploy/deploy.sh              # build, migrate, reload
#   ./deploy/deploy.sh --no-migrate # skip migrations
#   ./deploy/deploy.sh --no-pull    # build the working tree as-is
#
# Safe to re-run. Every step is idempotent, and the PM2 reload is the last
# thing that happens — a build that fails leaves the running site untouched.
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PULL=1
MIGRATE=1
for arg in "$@"; do
  case "$arg" in
    --no-pull)    PULL=0 ;;
    --no-migrate) MIGRATE=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# Preflight. Every one of these has produced a confusing failure downstream.
# -----------------------------------------------------------------------------
say "Preflight"

command -v node >/dev/null || die "node is not on PATH. If it came from nvm, PM2 and cron will not see it either — see docs/DEPLOYMENT.md."
command -v pnpm >/dev/null || die "pnpm is not on PATH (corepack enable && corepack prepare pnpm@11.2.2 --activate)"
command -v pm2  >/dev/null || die "pm2 is not installed (npm i -g pm2)"

[ -f apps/api/.env ] || die "apps/api/.env is missing. Copy deploy/api.env.example to apps/api/.env and fill it in."

# The API refuses to boot on a bad value anyway, but failing here costs seconds
# instead of a restart loop that nginx answers with 502.
node -e '
  const fs = require("fs");
  const env = Object.fromEntries(
    fs.readFileSync("apps/api/.env", "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
  const need = ["DATABASE_URL","REDIS_URL","JWT_ACCESS_SECRET","JWT_REFRESH_SECRET","S3_ACCESS_KEY","S3_SECRET_KEY","S3_PUBLIC_URL"];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) { console.error("apps/api/.env is missing: " + missing.join(", ")); process.exit(1); }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) { console.error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ."); process.exit(1); }
  if (/devsfleet_migrator/.test(env.DATABASE_URL)) { console.error("DATABASE_URL points at the MIGRATOR role, which bypasses RLS. Use devsfleet_app."); process.exit(1); }
  if (env.DATABASE_URL.includes("CHANGE_ME") || env.S3_ACCESS_KEY === "") { console.error("apps/api/.env still holds placeholder values."); process.exit(1); }
' || die "apps/api/.env did not pass preflight"

# NEXT_PUBLIC_* is inlined into the client bundle at BUILD time and cannot be
# changed by restarting anything. Read it from the API's own env so there is
# one source of truth for the API's public URL.
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://api.devsfleet.com/api/v1}"
echo "    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL  (compiled into the admin bundle)"

# -----------------------------------------------------------------------------
if [ -f deploy/docker-compose.data.yml ] && [ -f deploy/.env ] && command -v docker >/dev/null 2>&1; then
  say "Data services (Docker)"
  docker compose -f deploy/docker-compose.data.yml --env-file deploy/.env up -d
  # Wait for Postgres rather than racing the migration against a cold container.
  for i in $(seq 1 30); do
    if docker exec devsfleet-postgres pg_isready -U devsfleet_migrator -d devsfleet >/dev/null 2>&1; then
      echo "    postgres ready"; break
    fi
    [ "$i" = 30 ] && die "postgres did not become ready in 60s (docker logs devsfleet-postgres)"
    sleep 2
  done
else
  say "Data services (Native System Services)"
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -q && echo "    native postgres ready" || true
  fi
fi

# -----------------------------------------------------------------------------
if [ "$PULL" = 1 ]; then
  say "Pulling"
  git pull --ff-only
fi

say "Installing dependencies"
# Not --prod: the build needs nest, next and tsc, and the migration runner needs tsx.
pnpm install --frozen-lockfile

say "Building"
# Only what this host runs. `pnpm build` would also build apps/pos — an
# Electron desktop app that is installed on the tills, never served from here.
# Building it on the VPS downloads the Electron binaries for nothing, and ties
# a server deploy to the health of a codebase the server does not run.
pnpm --filter=@devsfleet/api... --filter=@devsfleet/admin... build

# -----------------------------------------------------------------------------
# Next.js `output: "standalone"` traces the SERVER's dependencies only. It does
# not copy .next/static or public/ into the bundle — that is documented Next
# behaviour, not a bug, and every self-hosted deployment has to do it.
#
# Skip this and the panel serves HTML with no CSS and no JavaScript, returning
# 404 for every /_next/static/* request, with nothing in any log to explain it.
# -----------------------------------------------------------------------------
say "Assembling the standalone admin bundle"
STANDALONE="apps/admin/.next/standalone"
[ -d "$STANDALONE" ] || die "$STANDALONE missing — did the admin build actually run?"

mkdir -p "$STANDALONE/apps/admin/.next"
rm -rf "$STANDALONE/apps/admin/.next/static"
cp -r apps/admin/.next/static "$STANDALONE/apps/admin/.next/static"
if [ -d apps/admin/public ]; then
  rm -rf "$STANDALONE/apps/admin/public"
  cp -r apps/admin/public "$STANDALONE/apps/admin/public"
fi
echo "    static assets copied into the standalone output"

# -----------------------------------------------------------------------------
if [ "$MIGRATE" = 1 ]; then
  say "Migrations"
  # The migrator credential is passed for this command only. It is deliberately
  # NOT in apps/api/.env: the API must never hold a BYPASSRLS credential.
  MIGRATOR_URL="$(grep -E '^DATABASE_URL_MIGRATOR=' deploy/.env apps/api/.env 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [ -z "$MIGRATOR_URL" ]; then
    APP_URL="$(grep -E '^DATABASE_URL=' apps/api/.env 2>/dev/null | head -1 | cut -d= -f2- || true)"
    MIG_PW="$(grep -E '^MIGRATOR_DB_PASSWORD=' deploy/.env apps/api/.env 2>/dev/null | head -1 | cut -d= -f2- || true)"
    if [ -n "$MIG_PW" ] && [ -n "$APP_URL" ]; then
      MIGRATOR_URL="$(node -e '
        try {
          const u = new URL(process.argv[1]);
          u.username = "devsfleet_migrator";
          u.password = encodeURIComponent(process.argv[2]);
          console.log(u.toString());
        } catch {
          console.log(process.argv[1]);
        }
      ' "$APP_URL" "$MIG_PW")"
    else
      MIGRATOR_URL="$APP_URL"
    fi
  fi
  DATABASE_URL_MIGRATOR="$MIGRATOR_URL" pnpm db:migrate
fi

# -----------------------------------------------------------------------------
say "Reloading PM2"
# PM2 writes the log paths named in ecosystem.config.cjs. Created once, and
# only if missing, so a routine deploy never stops on a sudo password prompt.
if [ ! -d /var/log/pm2 ]; then
  sudo mkdir -p /var/log/pm2 && sudo chown "$USER" /var/log/pm2 \
    || die "could not create /var/log/pm2 — create it once by hand, then re-run"
fi
# `reload` is zero-downtime where the app supports it and a restart otherwise;
# either way nginx retries the upstream, so a till mid-sale sees a pause, not
# an error. `startOrReload` also covers the very first deploy.
pm2 startOrReload deploy/ecosystem.config.cjs
pm2 save

# -----------------------------------------------------------------------------
say "Verifying"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then echo "    API   /health OK"; break; fi
  [ "$i" = 20 ] && die "API never answered /health — pm2 logs devsfleet-pos-api"
  sleep 1
done
curl -fsS http://127.0.0.1:3001/ready >/dev/null 2>&1 \
  && echo "    API   /ready  OK (database reachable)" \
  || die "API is up but /ready failed — it cannot reach Postgres. Check DATABASE_URL."
for i in $(seq 1 20); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then echo "    Admin /       OK"; break; fi
  [ "$i" = 20 ] && die "Admin never answered — pm2 logs devsfleet-pos-admin"
  sleep 1
done

printf '\n\033[1;32mDeployed.\033[0m  pm2 status | pm2 logs devsfleet-pos-api\n\n'
