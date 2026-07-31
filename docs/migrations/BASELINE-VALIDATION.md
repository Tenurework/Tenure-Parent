# Baseline validation

What the existing Tenure application actually did when every check available to it
was run, before anything in this repository changed it. Recorded so that a failure
found later can be attributed: pre-existing, or caused by the import.

Every line below is the result of a command that was executed. Nothing is inferred
from CI configuration or from a previous claim.

- **Source repository:** `https://github.com/satvikOS/Tenure`
- **Branch:** `main`
- **Commit:** `8d11204` — *feat(tenancy): enforce isolation, and refuse a create that names another tenant*
- **Run on:** Windows 11, Node v22.21.0, npm 10.9.4, Docker 29.4.3, git 2.51.2
- **Database:** PostgreSQL 16 in Docker (`postgres:16`), published on `localhost:5433`
- **Date:** 2026-07-31

## Result summary

| # | Check | Command | Exit | Result |
|---|---|---|---|---|
| 1 | Install | `npm ci` | 0 | PASS — 765 packages |
| 2 | Lint | `npm run lint` | 0 | PASS — 6 warnings, 0 errors |
| 3 | Type check | `npm run type-check` | 0 | PASS |
| 4 | Unit tests | `npm run test --workspace apps/web -- --ci` | 0 | PASS — **258 passed / 258**, 19 suites |
| 5 | Production build | `npm run build` | 0 | PASS — 40 routes compiled |
| 6 | Prisma schema | `npx prisma validate` | 0 | PASS |
| 7 | Migration drift | `npx prisma migrate diff --from-migrations … --exit-code` | 0 | PASS — migrations reproduce `schema.prisma` exactly |
| 8 | Migrate from empty | `npx prisma migrate deploy` | 0 | PASS — baseline migration applied |
| 9 | Migration status | `npx prisma migrate status` | 0 | PASS — up to date |
| 10 | Seed | `node scripts/seed.mjs` | 0 | PASS — 26 clubs, 235 seats, 172 people, 259 holdings |
| 11 | **Tenant isolation (unseeded)** | `npm run test:isolation` | **1** | **FAIL — 16 passed / 17.** Pre-existing. See below. |
| 12 | Tenant isolation (seeded) | same, after `seed.mjs` | 0 | PASS — 17 / 17 |
| 13 | Local startup | `npm run start` | — | PASS — ready in 716 ms |
| 14 | Health endpoint | `GET /api/health` | — | PASS — `200 {"status":"ok","db":"ok"}` |
| 15 | E2E (headless) | `npx playwright test` | 0 | PASS — **132 passed / 132**, 28 files, 4.0 min |
| 16 | Container build | `docker build -f apps/web/Dockerfile .` | 0 | PASS |
| 17 | Container contents | 9 inspection assertions from `ci.yml` | 0 | PASS — 9 / 9 |

Terraform was **not** validated: the binary is not installed on this machine, and
installing it would not have made the validation meaningful without AWS credentials
and remote state. `infrastructure/terraform/` is imported unchanged and unexecuted.
This is recorded as an untested surface, not as a pass.

## The one pre-existing failure

`apps/web/src/lib/tenancy/isolation.itest.ts` →
*"what a tenant scope does NOT protect › is filtered once the caller supplies the
relation predicate"*

```
expect(received).toBeGreaterThan(expected)
Expected: > 0
Received:   0
  at isolation.itest.ts:243
```

**This is not a local artefact.** The same assertion is failing on `main` in GitHub
Actions, and has been since it was introduced:

| Run | Commit | `Migrations · Drift + Apply + Isolation` |
|---|---|---|
| [30601682322](https://github.com/satvikOS/Tenure/actions/runs/30601682322) | `8d11204` | failure — this assertion |
| [30599825012](https://github.com/satvikOS/Tenure/actions/runs/30599825012) | `8f5f151` | failure — this assertion |
| 30599084639 | `cba9fa3` | success (predates the assertion) |

`deploy.yml` runs `ci.yml` as a required gate, so **both deploys after `8f5f151`
never ran**. The two most recent commits on `Tenure` main are not in production.

### Why it fails

The assertion reads:

```ts
expect(leaked).toBe(0)
expect(await runUnscoped("migration", "assert", () => db.roleAssignment.count()))
  .toBeGreaterThan(0)
```

The second line is a guard: it is there so that the `toBe(0)` above it means
"correctly filtered" rather than "the table happened to be empty". But the guard
depends on `RoleAssignment` rows that the test never creates. It gets them only if
something else already seeded the database.

In `ci.yml` the `migrations` job applies migrations to an empty database and then
runs `test:isolation` against it. Nothing in that job seeds. So the count is 0, the
guard fires, and the job fails. The `e2e` job does seed — but it is a different job
with its own database.

Confirmed by direct experiment on one database:

| State | Result |
|---|---|
| after `migrate deploy`, no seed | 16 passed, 1 failed |
| after `node scripts/seed.mjs` | **17 passed, 0 failed** |

### Why it matters beyond the red build

The test is *weaker* than it looks even when it passes. Its subject is the
neighbouring case — `RoleAssignment` has no tenant column, so a scope does not
filter it — and the point is that a caller-supplied relation predicate does. But
because tenant A's fixture has no seats, `toBe(0)` is satisfied by a correct filter
and by a filter that matched nothing, identically. With the seed present the guard
passes for an unrelated reason: the rows are OSE's, not tenant B's.

The fix is for the test to own its fixture — create a `RoleAssignment` under tenant
B and assert that tenant A's filtered count excludes it while the unscoped count
includes it. Then it proves leakage, needs no ambient data, and CI goes green.
Tracked as its own change; it is not part of the import.

## E2E is not idempotent against a used database

Running the full Playwright suite twice against the same database gives
132/132 then 125/132. Seven specs mutate state they later assert on:

```
app.spec.ts:134            approvals: VP submits → President approves → OSE approves
app.spec.ts:205            uninvolved member cannot act on someone else's request
delegation.spec.ts:11      a president's backup approves on their behalf
finance.spec.ts:157        a line's actual drills down to its ledger
memory.spec.ts:62          documents tab renders with upload gated by storage config
reimbursement.spec.ts:12   member files → both gates approve → auto-posts a spend
soft-delete.spec.ts:6      an archived document can be restored
```

Against a freshly migrated and seeded database the suite is 132/132 every time.
CI never sees this because its Postgres service container is new per run. It is
recorded here because it will surface the moment anyone runs the suite twice
locally, and because it is a real constraint on the platform test suites this
repository will add.

### One intermittent failure, observed once

`resources.spec.ts` → *"OSE can retire a resource and restore it"* failed once, on
2026-07-31, in a full-suite run against a freshly migrated and seeded database.

What was checked afterwards:

| Run | Result |
|---|---|
| the same spec file alone, same database | 11 / 11 |
| full suite, new database | 139 / 139 |
| full suite, another new database | 139 / 139 |

So it is intermittent, not a regression, and not the ordinary non-idempotence
above — that reproduces reliably on a second run against a used database, and
this did not. Ruled out by reading: the `title` locator is `RUN_ID`-scoped and
does not collide with the `E2E Second`/`E2E Third` titles the neighbouring
publish test creates, so `.first()` is not resolving the wrong card.

Most likely a race between a server action's revalidation and the assertion that
the heading has gone. Not diagnosed further because the failure output was not
captured before the retry, and guessing at a cause would be worse than recording
the observation. CI runs with `retries: 1`, so it would self-heal there — which
is itself worth knowing, because it means CI can be green while this is real.

## Pre-existing issues recorded, not fixed

Per the operating rules, these were found during baselining and are left alone so
that the import changes nothing but location.

1. **The isolation assertion above.** Reds CI, blocks deploys.
2. **`npm audit`: 34 vulnerabilities (32 high, 2 critical)** on the imported tree.
   Not triaged here; a dependency-scanning gate is CI work, and fixing them inside
   the import would make the import unreviewable.
3. **6 ESLint warnings** — unused `isOse`, `SURFACE`, `MAX_SAVE_BYTES`, a stale
   `eslint-disable`, an `<img>`, one exhaustive-deps.
4. **`next lint` is deprecated** and is removed in Next.js 16.
5. **Terraform unvalidated** — see above.
6. **E2E non-idempotence** — see above.

## Reproducing this

```bash
docker run -d --name tenure-pg \
  -e POSTGRES_USER=tenure -e POSTGRES_PASSWORD=tenure -e POSTGRES_DB=tenure \
  -p 5433:5432 postgres:16

export DATABASE_URL="postgresql://tenure:tenure@localhost:5433/tenure"

npm ci
npm run lint
npm run type-check
npm run test --workspace apps/web -- --ci
npm run build

cd apps/web
npx prisma validate
npx prisma migrate deploy
npm run test:isolation          # 16/17 here — the pre-existing failure
node scripts/seed.mjs
npm run test:isolation          # 17/17 here
npx playwright install --with-deps chromium
npx playwright test             # 132/132 on a fresh seed
```
