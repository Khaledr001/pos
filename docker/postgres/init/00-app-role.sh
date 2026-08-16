#!/bin/bash
# =============================================================================
# Creates the runtime application role.
#
# A shell script rather than plain SQL because the password must come from the
# environment — a production password should never be a literal in a committed
# file. `docker-entrypoint-initdb.d` runs .sh and .sql alike in filename order,
# so this executes before 01-extensions-and-functions.sql.
#
# Runs ONCE, against an empty data directory. Editing it later has no effect
# until `pnpm infra:nuke` (dev) or a deliberate ALTER ROLE (production).
# =============================================================================
set -euo pipefail

# The dev fallback matches the repo-root .env.example, so `pnpm infra:up` works
# with no configuration. Production sets APP_DB_PASSWORD in deploy/.env.
APP_PASSWORD="${APP_DB_PASSWORD:-app_dev_password}"

if [ "$APP_PASSWORD" = "app_dev_password" ] && [ "${NODE_ENV:-}" = "production" ]; then
    echo "FATAL: APP_DB_PASSWORD is unset while NODE_ENV=production." >&2
    exit 1
fi

run_psql() {
    # -v pw=... with :'pw' lets psql do the quoting, so a password containing
    # a quote or backslash cannot break out into SQL.
    psql -v ON_ERROR_STOP=1 \
         --username "$POSTGRES_USER" \
         --dbname "$POSTGRES_DB" \
         -v pw="$APP_PASSWORD" \
         "$@"
}

ROLE_EXISTS=$(run_psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'devsfleet_app'")

if [ "$ROLE_EXISTS" = "1" ]; then
    run_psql -c "ALTER ROLE devsfleet_app LOGIN PASSWORD :'pw' NOBYPASSRLS"
    echo "devsfleet_app: password updated"
else
    # ---------------------------------------------------------------------
    # NOBYPASSRLS is the entire point of this role.
    #
    # It is also granted DML only — no CREATE, ALTER or DROP (see the default
    # privileges in 01-extensions-and-functions.sql). A compromised API
    # therefore cannot drop a policy to read around its own tenant isolation.
    # ---------------------------------------------------------------------
    run_psql -c "CREATE ROLE devsfleet_app LOGIN PASSWORD :'pw' NOBYPASSRLS"
    echo "devsfleet_app: created"
fi
