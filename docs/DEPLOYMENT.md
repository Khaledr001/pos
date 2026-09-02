# Deployment

Production runbook for `isp.devsfleet.com`'s VPS, where the POS runs alongside
the existing ISP system.

The apps run on the host under **PM2**; the data services run in **Docker**.
That split is deliberate: PM2 matches how everything else on this box is
operated, while Postgres keeps the two-role setup that tenant isolation depends
on — reproducing `devsfleet_migrator` / `devsfleet_app` by hand is how an app
role accidentally ends up with `BYPASSRLS`.

```
Internet :443
└── nginx (host, already serving isp.devsfleet.com)
     ├── pos.devsfleet.com ──→ 127.0.0.1:3000   admin panel   PM2
     │    ├── /releases   (human-facing download page)
     │    └── /pos-dl/*   (machine-facing feed — both are Next.js routes,
     │                     reading /var/www/devsfleet-pos-releases/ directly)
     ├── api.devsfleet.com ──→ 127.0.0.1:3001   API           PM2
     └── cdn.devsfleet.com ──→ 127.0.0.1:9000   MinIO         docker
                                 (only /*/products/* is exposed)

docker, all bound to 127.0.0.1:
     postgres 5433 · redis 6380 · minio 9000/9001 · nightly backup
```

The POS terminals are Electron desktop apps. The API and admin panel run on
this VPS; the terminal app itself is **installed on the tills**, not deployed
here, and points at `https://pos-api.devsfleet.com` — the actual API
hostname in production. (`api.devsfleet.com` appears elsewhere in older docs
and example files; it was never wired up. `deploy.sh`'s
`NEXT_PUBLIC_API_URL` default already used the correct `pos-api` host — only
the POS-specific release tooling had drifted from it.)

What *is* served from this VPS is the installer feed the tills download from
and auto-update against, at `https://pos.devsfleet.com/pos-dl/`. This is
**not** a raw nginx static-file location — it's a Next.js route handler
(`apps/admin/src/app/pos-dl/[...path]/route.ts`) inside the admin app,
reached through the exact same unmodified `location /` proxy every other
admin page already uses. It reads straight from
`/var/www/devsfleet-pos-releases/` on disk, no nginx config involved.
Deliberate, after nginx changes on this box turned out riskier than expected
(a pre-existing, unrelated broken `options-ssl-nginx.conf` reference meant
*any* nginx reload — not just this one — was one config test away from taking
the whole box down): publishing or reinstalling a POS release should never
require touching nginx again, on this VPS or the next one.

The admin panel's **Releases** page (`/releases`, under Administration in the
sidebar, gated on `device:manage`) fetches `latest.yml`/`latest-linux.yml`
from that same route client-side and renders download buttons from it — that
page is the one place a human is meant to go for an installer; `/pos-dl/` is
what it and every till's auto-updater read from underneath.

One-time setup on the VPS — no nginx step, just the directory the admin app
reads from and the deploy user's write access to it:

```bash
sudo mkdir -p /var/www/devsfleet-pos-releases
sudo chown "$(whoami)" /var/www/devsfleet-pos-releases   # the SSH deploy user needs to write here
```

Cutting a release, from a dev machine:

```bash
# bump the version electron-updater compares against first
git tag pos-v1.3.0
git push origin pos-v1.3.0
```

That workflow builds Windows and Linux installers on native runners (no macOS
build in CI yet — the config in `apps/pos/electron-builder.yml` supports it,
but nobody has asked for a Mac till) and `scp`s them, plus the
`latest.yml`/`latest-linux.yml` manifests `electron-updater` (and the admin
panel's Releases page) read, into `/var/www/devsfleet-pos-releases/`.

Prefer to build by hand instead of via a tag push? `deploy/release-pos.sh`
does the same build + package + publish, run directly on the VPS — see its
header comment for flags. It can only produce whatever the machine it runs on
builds natively (Linux, on this VPS), same limitation as everywhere else in
this doc.

**Not yet set up: code signing.** Windows installers trigger a SmartScreen
warning and macOS builds are blocked by Gatekeeper until a certificate is
added — see the comment above the "Package the installer" step in the
workflow.

---

## Ports

| Port | Service | Notes |
|---|---|---|
| 3000 | admin (PM2) | loopback |
| 3001 | api (PM2) | loopback |
| 5433 | Postgres 18 (docker) | shifted off 5432, which the ISP system holds |
| 6380 | Redis (docker) | shifted off 6379, likewise |
| 9000 / 9001 | MinIO / console (docker) | loopback |

Unchanged: `5001` portfolio, `3100` isp-backend. Freed by this change: `6201`
and `4000`, from the .NET POS being retired.

Check nothing collides before you start:

```bash
sudo ss -tlnp | grep -E ':(3000|3001|5433|6380|9000|9001)\b' || echo "all free"
```

---

## First deploy

### 1. Retire the old POS

```bash
pm2 delete pos-api pos-frontend
pm2 save
```

Keep `/var/www/pos` until the new system is accepted — deleting it is the one
step with no undo. The old `pos` Postgres database on 5432 is untouched by any
of this.

### 2. Prerequisites

```bash
node --version     # needs >= 22; the repo builds on 24.11.1
corepack enable && corepack prepare pnpm@11.2.2 --activate
npm i -g pm2
docker --version && docker compose version
```

> **If node came from nvm, PM2 will not find it after a reboot.** `pm2 startup`
> generates a systemd unit with the PATH of the shell that ran it, and nvm's
> path lives in `.bashrc`, which systemd never sources. Either install node
> system-wide, or add the interpreter path to the generated unit and re-run
> `pm2 save`. This fails silently at 3am, not at deploy time.

### 3. DNS

Point all three at the VPS and let them propagate **before** requesting
certificates — a failed ACME challenge counts against Let's Encrypt's rate
limit.

```
pos.devsfleet.com   A   <vps-ip>
api.devsfleet.com   A   <vps-ip>
cdn.devsfleet.com   A   <vps-ip>
```

```bash
for h in pos api cdn; do dig +short $h.devsfleet.com; done
```

### 4. Clone and configure

```bash
sudo mkdir -p /var/www/devsfleet-pos && sudo chown -R $USER:$USER /var/www/devsfleet-pos
git clone <repo> /var/www/devsfleet-pos
cd /var/www/devsfleet-pos

cp deploy/.env.prod.example deploy/.env
cp deploy/api.env.example   apps/api/.env
chmod 600 deploy/.env apps/api/.env
```

Generate every secret — do not reuse one from another system:

```bash
echo "MIGRATOR_DB_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')"
echo "APP_DB_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')"
echo "REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')"
echo "S3_ACCESS_KEY=$(openssl rand -hex 12)"
echo "S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=')"
echo "JWT_ACCESS_SECRET=$(openssl rand -base64 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 48)"
```

`tr -d '/+='` keeps the database and Redis passwords URL-safe, so they can go
into a connection string without percent-encoding. The JWT secrets are never
part of a URL, so they keep their full alphabet.

Fill in `deploy/.env`, then `apps/api/.env` — the two database passwords and
the Redis password must **match** across the files, and the S3 keys too.

The API refuses to boot if `JWT_ACCESS_SECRET` equals `JWT_REFRESH_SECRET`, if
either has fewer than 12 distinct characters, or if `DATABASE_URL` points at
the migrator role.

### 5. Certificates

nginx will not start while an `ssl_certificate` path does not exist, so the
certificates have to come first. That is what the bootstrap config is for.

```bash
sudo mkdir -p /var/www/certbot
sudo cp deploy/nginx/devsfleet-pos.bootstrap.conf /etc/nginx/sites-available/devsfleet-pos
sudo ln -sf /etc/nginx/sites-available/devsfleet-pos /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/certbot \
  -d pos.devsfleet.com -d api.devsfleet.com -d cdn.devsfleet.com

# One certificate covers all three; the real config expects it under
# /etc/letsencrypt/live/pos.devsfleet.com/, which is the first -d name.
sudo cp deploy/nginx/devsfleet-pos.conf /etc/nginx/sites-available/devsfleet-pos
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Deploy

```bash
./deploy/deploy.sh
```

It starts the data services, waits for Postgres, installs, builds, assembles
the standalone admin bundle, runs migrations, reloads PM2, and verifies
`/health`, `/ready` and the panel before reporting success.

### 7. Seed the first tenant

Once, on an empty database:

```bash
DATABASE_URL_MIGRATOR="postgres://devsfleet_migrator:<pw>@127.0.0.1:5433/devsfleet" pnpm db:seed
```

**Change both seeded passwords immediately** — they are in the repo:
`admin@devsfleet.com` / `ChangeMe123!` and the platform operator.

### 8. Confirm isolation actually holds

```bash
pnpm verify:rls
```

Run it as `devsfleet_app`. Run as a superuser it passes unconditionally and
proves nothing, because RLS does not apply to a role that bypasses it.

### 9. Boot persistence

```bash
pm2 save
pm2 startup     # run the command it prints
```

Docker services already carry `restart: unless-stopped`.

---

## Updating

```bash
cd /var/www/devsfleet-pos && ./deploy/deploy.sh
```

`--no-migrate` skips migrations; `--no-pull` builds the working tree as-is.

A failed build leaves the running site untouched — PM2 is reloaded last.

---

## Rollback

```bash
git log --oneline -10
git checkout <sha>
./deploy/deploy.sh --no-migrate
```

`--no-migrate` matters: **migrations do not roll back.** Drizzle has no down
migrations here, by design — see `docs/DECISIONS.md`. If a release included a
destructive schema change, the only way back is the nightly dump, and you lose
everything written since it. Read the generated SQL before shipping one.

---

## Backup and restore

Nightly `pg_dump -Fc` into `deploy/backups/`, 14 days retained.

```bash
ls -lh deploy/backups/
docker logs devsfleet-backup --tail 20
```

**Rehearse the restore before you need it.** An untested backup is a guess, and
this is the only copy of every sale ever rung up.

```bash
# Into a scratch database, NOT over the live one.
docker exec -e PGPASSWORD=<migrator-pw> devsfleet-postgres \
  createdb -U devsfleet_migrator restore_test

docker exec -e PGPASSWORD=<migrator-pw> devsfleet-postgres \
  pg_restore -U devsfleet_migrator -d restore_test --no-owner \
  /backups/devsfleet-<stamp>.dump

docker exec -e PGPASSWORD=<migrator-pw> devsfleet-postgres \
  psql -U devsfleet_migrator -d restore_test -c \
  "SELECT count(*) FROM sales; SELECT max(created_at) FROM sales;"

docker exec -e PGPASSWORD=<migrator-pw> devsfleet-postgres \
  dropdb -U devsfleet_migrator restore_test
```

The dumps sit on the same disk as the database they protect. Copy them off the
host — that is the difference between a backup and a second copy of the same
failure.

---

## WhatsApp

The webhook is **not** at the root. The API's global prefix applies to it, so
the URL to give Meta is:

```
https://pos-api.devsfleet.com/api/v1/whatsapp/webhook
```

Per-tenant numbers live in the `whatsapp_accounts` table, not in `.env`; each
row carries its own `verifyToken` and `appSecret`. `WHATSAPP_ENABLED` in
`apps/api/.env` gates the feature globally, and setting it `true` makes
`WHATSAPP_APP_SECRET` mandatory — without it signatures cannot be verified and
anyone who learns the URL can inject messages.

nginx must not alter the request body: the signature is computed over the exact
bytes Meta sent, read from `req.rawBody`. Nothing in the shipped config touches
it. Do not add anything that does.

> **Known gap:** `whatsapp_accounts.accessToken` and `appSecret` are stored in
> plaintext. Anyone with database read access holds those tenants' WhatsApp
> credentials. Envelope encryption is not built yet.

---

## Troubleshooting

**502 from nginx.** PM2 is down or still booting.
`pm2 status`, then `pm2 logs devsfleet-pos-api --lines 100`. The API validates
its whole environment at boot and exits with a readable list, so a restart loop
almost always means a bad `.env` value.

**Panel loads with no styling, `/_next/static/*` all 404.** The standalone
bundle is missing its static assets. `next build` does not copy them; re-run
`./deploy/deploy.sh`, which does.

**Notifications never arrive, everything else works.** Check the browser
console for a CSP violation on `wss://pos-api.devsfleet.com`, then confirm nginx is
proxying `/socket.io/` with the `Upgrade` headers. socket.io serves from
`/socket.io/` regardless of the gateway's `/notifications` namespace — the
namespace is not a URL path.

**Product images 404 from cdn.devsfleet.com.** The nginx location is a
whitelist matching `/devsfleet/<uuid>/products/`. Confirm `S3_PUBLIC_URL` is
`https://cdn.devsfleet.com/devsfleet` and that `minio-init` set the anonymous
policy: `docker logs devsfleet-minio-init`.

**`pnpm db:migrate` cannot connect.** It needs `DATABASE_URL_MIGRATOR`, not
`DATABASE_URL`, and the migrator port is 5433, not 5432 — 5432 is the ISP
system's PostgreSQL.

**A tenant sees another tenant's data.** Stop and treat it as an incident.
Check `DATABASE_URL` names `devsfleet_app`, then run `pnpm verify:rls` as that
role.

---

## Rotating a password

The Postgres init scripts run **once**, against an empty data directory.
Editing `deploy/.env` afterwards changes nothing. Rotate in the database:

```bash
docker exec -it devsfleet-postgres psql -U devsfleet_migrator -d devsfleet \
  -c "ALTER ROLE devsfleet_app PASSWORD 'new-password'"
```

Then update `APP_DB_PASSWORD` in `deploy/.env` and `DATABASE_URL` in
`apps/api/.env`, and `pm2 reload devsfleet-pos-api`.

Never grant `BYPASSRLS` to `devsfleet_app` to work around a permissions error.
That single flag turns every RLS policy off for the API and is a silent
cross-tenant leak.

---

## The all-in-Docker alternative

`deploy/docker-compose.prod.yml` runs everything — including Caddy, which
obtains its own certificates and needs ports 80 and 443. It is **not** what
this VPS uses, because nginx already holds those ports for the ISP system.
It is kept for a future dedicated host; migrating means moving the other sites
into the Caddyfile first.
