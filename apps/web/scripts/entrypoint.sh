#!/bin/sh
# Container entrypoint: compose DATABASE_URL, apply migrations, then either
# serve (default) or run a one-off task.
#
#   sh scripts/entrypoint.sh          → migrate, then serve
#   sh scripts/entrypoint.sh seed     → migrate, seed reference data, exit
#
# Recovery modes. These deliberately run BEFORE the bootstrap, because the
# situation they exist for is one where the bootstrap cannot succeed: a
# migration recorded as started and never finished makes `migrate deploy`
# return P3009 from every image, so a mode that migrated first could never be
# reached. RDS is VPC-only, so this task is the only place these commands can
# run at all.
#
#   sh scripts/entrypoint.sh migrate-status
#   sh scripts/entrypoint.sh migrate-resolve-rolled-back <migration_name>
#   sh scripts/entrypoint.sh migrate-resolve-applied     <migration_name>
set -e

MODE="${1:-serve}"
MIGRATION="${2:-}"

# DB_CREDS is the RDS-managed master secret: JSON {"username","password"}.
# Compose a proper postgres URL from it plus DB_HOST/DB_PORT/DB_NAME.
if [ -n "$DB_CREDS" ] && [ -n "$DB_HOST" ]; then
  DATABASE_URL=$(node -e '
    const c = JSON.parse(process.env.DB_CREDS);
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT || "5432";
    const name = process.env.DB_NAME || "tenure";
    const user = encodeURIComponent(c.username);
    const pass = encodeURIComponent(c.password);
    console.log(`postgresql://${user}:${pass}@${host}:${port}/${name}?schema=public&connection_limit=5`);
  ')
  export DATABASE_URL
fi

# ── Recovery, before the bootstrap that these exist to unblock ───────────────
PRISMA="node prisma-cli/node_modules/prisma/build/index.js"

case "$MODE" in
  migrate-status)
    echo "🔎 prisma migrate status"
    # Reports the stuck migration and exits non-zero when the ledger is not
    # clean, which is the answer we want rather than a failure.
    $PRISMA migrate status || true
    exit 0
    ;;
  migrate-resolve-rolled-back|migrate-resolve-applied)
    if [ -z "$MIGRATION" ]; then
      echo "❌ $MODE needs a migration name as the second argument."
      exit 1
    fi
    # --rolled-back: the migration's changes are NOT in the database.
    # --applied:     they ARE, and only the ledger is wrong.
    # Choosing wrong leaves the schema and the ledger permanently disagreeing,
    # so the workflow that invokes this requires the operator to type which.
    case "$MODE" in
      *rolled-back) FLAG="--rolled-back" ;;
      *)            FLAG="--applied" ;;
    esac
    echo "🩹 prisma migrate resolve $FLAG $MIGRATION"
    $PRISMA migrate resolve "$FLAG" "$MIGRATION"
    echo "✅ Resolved. Re-run migrate-status to confirm the ledger is clean."
    exit 0
    ;;
esac

if [ "$SKIP_DB_BOOTSTRAP" != "true" ]; then
  # Versioned migrations, fail-closed. `set -e` above means a failed bootstrap
  # exits the container rather than serving against an unverified schema; the
  # ECS deployment circuit breaker then rolls back. See scripts/db-bootstrap.mjs.
  node scripts/db-bootstrap.mjs
fi

# Seeding is NOT part of starting a server. scripts/seed.mjs is a development
# and e2e fixture: it issues unscoped deletes to reset test state. Running it on
# every boot meant every task raced to rewrite the same rows on every scale-out,
# and destroyed live rows while doing it.
#
# `seed` mode runs it once, as a deliberate one-off task, and exits without
# serving. Invoked by .github/workflows/seed-reference-data.yml via an ECS
# command override. SEED_ON_BOOT remains for local and CI convenience.
if [ "$MODE" = "seed" ] || [ "$SEED_ON_BOOT" = "true" ]; then
  echo "⏳ Seeding reference data..."
  node scripts/seed.mjs
  if [ "$MODE" = "seed" ]; then
    echo "✅ Seed complete — one-off task, not starting the server."
    exit 0
  fi
fi

# In an npm workspace, Next's standalone output is laid out relative to the
# file-tracing root (the monorepo root), so server.js is emitted at
# apps/web/server.js with the traced node_modules hoisted beside it. Do NOT
# `cd apps/web` first: everything above this line — the Prisma CLI probe in
# db-bootstrap.mjs and the CLI's implicit ./prisma/schema.prisma lookup —
# depends on cwd staying /app. server.js does its own process.chdir(__dirname).
exec node apps/web/server.js
