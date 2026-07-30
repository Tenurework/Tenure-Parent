# ADR-0001 — Versioned migrations, and what a container is allowed to do at boot

- **Status:** Accepted
- **Date:** 2026-07-30
- **Supersedes:** the pilot-phase note in `docs/RUNBOOK.md` that deferred this "before GA"

## Context

Every production container did three things before serving its first request:

```sh
# scripts/entrypoint.sh, before this change
prisma db push --skip-generate --accept-data-loss   # line 25
node scripts/seed.mjs                               # line 27
# on failure of either: "⚠️ Schema sync failed — starting app anyway"
```

There was no `prisma/migrations` directory. The live database's shape was
whatever `schema.prisma` happened to say at the moment of the last deploy, and
`--accept-data-loss` gave Prisma permission to drop whatever stood in the way of
getting there.

This was a deliberate pilot-phase choice and it was survivable while the data
was recreatable. It stops being survivable at the point the platform work
begins, for a specific reason: the multi-tenancy migration's first schema change
is replacing global unique constraints with tenant-scoped composite ones —
`Organization.slug`, `Role.positionCode`, `Deliverable.key`,
`DirectoryPerson.email`, `ApprovalRequest.idempotencyKey`. Applying that class
of change through `db push --accept-data-loss` against a populated database is
exactly the operation the flag exists to permit and nobody wants.

Three further properties made the old arrangement unsafe independently of that:

1. **Failure was non-fatal.** A failed schema sync logged a warning and started
   the server anyway, against an unknown schema.
2. **Seeding ran on every boot**, from every task in the service, on every
   scale-out — including the seven passwordless `@tenure.demo` accounts, one of
   which holds `OSE_DIRECTOR`.
3. **Editing `schema.prisma` without a migration was invisible.** Nothing could
   detect it, because there was nothing to be out of step with.

## Decision

**1. Adopt `prisma migrate deploy`, baselined against the existing database.**

`prisma/migrations/20260730000000_baseline/` reproduces the pilot's current
shape: 39 tables, 21 enums, 24 unique indexes, 58 foreign keys. It is recorded
as applied on the existing database rather than replayed over it.

That substitution is only safe because the two are provably identical, which was
established in both directions before anything was changed:

| Check | Result |
|---|---|
| `migrate diff --from-url <db-push database> --to-schema-datamodel` | empty |
| `migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel` | empty |

Both empty ⇒ the migration history and the live database describe the same
schema, so recording the baseline as applied asserts something true.

**2. Boot fails closed.** `scripts/db-bootstrap.mjs` exits non-zero if it cannot
prove the schema is current. ECS's deployment circuit breaker
(`infrastructure/terraform/ecs.tf`, `rollback = true`) then returns to the last
good task definition. A container that does not know its schema does not serve.

**3. Absence must be proven, never inferred.** The bootstrap decides what to do
by probing for `_prisma_migrations` and for a sentinel table. A probe that
*fails* and a probe that reports *"not there"* are the same exit code, and
conflating them is dangerous in one direction: a broken probe reads as "empty
database", and `migrate deploy` then runs `CREATE TABLE` over live data. So only
Postgres saying "does not exist" counts as absence; anything else is fatal.

This is not hypothetical — it is the bug the end-to-end test caught during
implementation. Node 20+ refuses to spawn `npx.cmd` without a shell
(CVE-2024-27980), the probe never ran, and a populated database was classified
`empty`. Fail-closed contained it; the classification is now explicit and tested.

**4. Seeding is not part of starting a server.** It is reference-data
management. It requires `SEED_ON_BOOT=true`, and the demo login accounts require
a second opt-in (`SEED_DEMO_ACCOUNTS`, default off when `NODE_ENV=production`).

**5. The environment is a contract, checked before serving.** `src/lib/env.ts`,
called from `src/instrumentation.ts`. Most consequentially: `AUTH_DEV_LOGIN=true`
in production now refuses to boot unless `ALLOW_DEV_LOGIN_IN_PRODUCTION=true`
says so explicitly, so the posture cannot be inherited by a copied task
definition.

## Consequences

**A schema change now takes two steps, and CI enforces the second.**

```sh
npx prisma migrate dev --name describe-your-change
```

The `Migrations · Drift + Apply` job fails the build when `prisma/migrations`
stops reproducing `prisma/schema.prisma`, and separately proves that a
`db push`-shaped database with rows in it survives the baseline.

**The pilot keeps working, with the remaining risk now explicit.**
`ALLOW_DEV_LOGIN_IN_PRODUCTION=true` is set in `ecs.tf`, with an inline note on
how to remove it. It is not a new exposure; it was previously unconditional and
unstated. `SEED_ON_BOOT` is deliberately *not* set there — boot-time seeding is
what this ADR removed, and reference data is now published by the "Seed
reference data" workflow as a one-off ECS task.

**Migrations still run at container boot, not as a separate deploy stage.** RDS
is reachable only inside the VPC, so a GitHub Actions runner cannot reach it.
Prisma takes a Postgres advisory lock, so concurrent task starts serialise
rather than race. This is the remaining gap against §33's "migration stage"
requirement and is deferred to a follow-up ADR covering a one-off ECS
`RunTask` stage — which is also what a long backfill will need, since a
migration that outlives the ALB health-check grace period cannot run at boot.

## Alternatives considered

**Keep `db push`, add backups.** Backups make a bad migration recoverable, not
detectable, and recovery means restoring a pilot to an earlier state. It also
leaves schema drift unobservable in CI.

**Squash to a fresh migration and reset the database.** Correct in a vacuum. The
pilot holds real roster and governance data from a live institution, so no.

**Wrap `db push` in a guard that refuses destructive changes.** Reimplements
`migrate diff` badly and still yields no migration history to review, test, or
roll back.

## Verification

| Scenario | Result |
|---|---|
| Legacy pilot DB (39 tables, live row, no ledger) | baselined; `Institution` row intact; 40 tables |
| Same DB, bootstrap run twice | second run no-ops (`managed`) |
| Empty DB | full history applied; converges on the identical 40 tables |
| Probe cannot run | refuses to guess, exits non-zero |
| Full e2e suite against a migrated DB | 128/128 passed |
| Unit tests for planner, probe classification, env contract | 39 added |
