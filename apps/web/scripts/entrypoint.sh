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

# `migrate` mode: apply migrations as a deploy stage and exit, without serving.
#
# This is where migrations are supposed to happen. deploy.yml runs it as a
# one-off task BEFORE updating the service, so a migration that fails fails the
# deploy while the running task carries on serving the old version untouched.
# Applying at container start instead means a bad migration meets a service that
# is already mid-replacement, and P3009 then locks out every image including the
# one ECS would roll back to (ADR-0001, and the recovery path in db-recovery.yml).
#
# Timeouts are set here rather than inside the migration files because Prisma
# wraps a migration in a single transaction: the ACCESS EXCLUSIVE lock its first
# statement takes is held until the last one commits, and lock *acquisition* is
# unbounded. Without a ceiling, one long-running reader blocks the migration,
# the migration blocks every subsequent reader, the pool (connection_limit=5)
# exhausts, /api/health 503s, and the ALB kills the only task in ~90s.
if [ "$MODE" = "migrate" ]; then
  echo "⏳ Applying migrations as a deploy stage..."
  export PGOPTIONS="${PGOPTIONS:--c lock_timeout=3s -c statement_timeout=120s}"
  echo "   PGOPTIONS=$PGOPTIONS"
  node scripts/db-bootstrap.mjs
  echo "✅ Migrations applied — one-off task, not starting the server."
  exit 0
fi

if [ "$SKIP_DB_BOOTSTRAP" != "true" ]; then
  # Still runs at boot, deliberately, even though the deploy stage above is the
  # primary path. `migrate deploy` is idempotent, so on a normal deploy this is
  # a no-op that prints "No pending migrations to apply" — and it is the only
  # thing standing between a task that started outside a deploy (a scale-out, a
  # health-check replacement, a manual RunTask) and a schema it was not built
  # for. Fail-closed: `set -e` exits the container rather than serving against
  # an unverified schema. See scripts/db-bootstrap.mjs.
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
