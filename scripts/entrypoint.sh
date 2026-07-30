#!/bin/sh
# Container entrypoint: compose DATABASE_URL, apply migrations, then either
# serve (default) or run a one-off task.
#
#   sh scripts/entrypoint.sh          → migrate, then serve
#   sh scripts/entrypoint.sh seed     → migrate, seed reference data, exit
set -e

MODE="${1:-serve}"

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

exec node server.js
