// =============================================================================
// PM2 — DevsFleet POS (API + admin panel)
//
//   pm2 start  deploy/ecosystem.config.cjs
//   pm2 reload deploy/ecosystem.config.cjs   # zero-downtime
//   pm2 logs devsfleet-pos-api
//   pm2 save                                 # survive a reboot
//
// Run from the REPO ROOT — every `cwd` below is relative to this file, and PM2
// resolves them against the config's own directory.
//
// -----------------------------------------------------------------------------
// THERE ARE NO SECRETS IN THIS FILE, AND NONE MAY BE ADDED.
//
// The API reads its own `apps/api/.env` at boot (NestJS ConfigModule resolves
// it from process.cwd(), which is why `cwd` is set to apps/api below). That
// file is chmod 600 and gitignored.
//
// The alternative — inlining DATABASE_URL and JWT secrets here, the way a PM2
// ecosystem file usually does — puts every production credential in a file
// that is committed, diffed, and pasted into chat windows when something
// breaks. Keeping them in .env means this file is safe to read aloud.
// -----------------------------------------------------------------------------
//
// `.cjs`, not `.js`: PM2 loads the config with require(), and the extension
// pins it to CommonJS regardless of what the workspace later sets for "type".
// =============================================================================

const path = require("node:path");
const REPO = path.resolve(__dirname, "..");

/** Shared across both apps — restart policy, log format, memory guard. */
const common = {
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  watch: false, // never in production
  max_restarts: 10,
  restart_delay: 3000,
  min_uptime: "10s",
  log_date_format: "YYYY-MM-DD HH:mm:ss",
  merge_logs: true,
  // SIGINT, then SIGKILL after the grace period. Nest's enableShutdownHooks
  // drains in-flight requests on SIGINT; 10s is long enough for a sale to
  // finish committing and short enough that a deploy does not stall.
  kill_timeout: 10000,
  // PM2 marks the process online only once it calls process.send('ready'),
  // which Nest does not — so stay with the default uptime-based readiness and
  // let nginx's own upstream retry cover the second or two of restart.
  wait_ready: false,
};

module.exports = {
  apps: [
    // -------------------------------------------------------------------------
    // API — the only thing that talks to Postgres.
    //
    // Behind nginx at https://api.devsfleet.com. Also what the POS terminals
    // and the WhatsApp webhook reach.
    // -------------------------------------------------------------------------
    {
      ...common,
      name: "devsfleet-pos-api",
      script: "dist/main.js",
      cwd: path.join(REPO, "apps/api"),
      // Node runs it directly; `nest` is a build-time tool and is not needed here.
      max_memory_restart: "768M",
      out_file: "/var/log/pm2/devsfleet-pos-api-out.log",
      error_file: "/var/log/pm2/devsfleet-pos-api-error.log",
      env: {
        // Everything else — DATABASE_URL, JWT secrets, S3, DeepSeek — comes
        // from apps/api/.env, read by the app itself. Do not duplicate it here:
        // a real environment variable WINS over the .env file, so a stale copy
        // in this file would silently override the one you edited.
        NODE_ENV: "production",
      },
    },

    // -------------------------------------------------------------------------
    // Admin panel — an HTTP client of the API and nothing more. It holds no
    // database credentials and cannot reach Postgres.
    //
    // Runs the Next.js `output: "standalone"` bundle. The entrypoint keeps the
    // monorepo's directory layout, so cwd is the standalone root and the script
    // path inside it is apps/admin/server.js.
    //
    // NOTE: `next build` does NOT copy .next/static or public/ into the
    // standalone output — deploy/deploy.sh does that. Skipping it yields a
    // site that serves HTML with no CSS and no JS, and no error anywhere.
    // -------------------------------------------------------------------------
    {
      ...common,
      name: "devsfleet-pos-admin",
      script: "apps/admin/server.js",
      cwd: path.join(REPO, "apps/admin/.next/standalone"),
      max_memory_restart: "512M",
      out_file: "/var/log/pm2/devsfleet-pos-admin-out.log",
      error_file: "/var/log/pm2/devsfleet-pos-admin-error.log",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        // Loopback only. nginx is the sole way in; without this Next binds
        // 0.0.0.0 and the panel answers on the VPS's public IP, bypassing TLS.
        HOSTNAME: "127.0.0.1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
};
