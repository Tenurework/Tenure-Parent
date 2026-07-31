# Tenure

The Tenure platform monorepo. One codebase from which the Tenure team configures,
provisions, deploys, operates and supports organization-specific systems.

## What is here

| Path | What it is |
|---|---|
| `apps/web/` | The application. Next.js 15.5, React 19, Prisma 6, NextAuth 5 beta. 219 source files, 40 routes. |
| `apps/web/prisma/` | 40-model schema, 997 lines, versioned migrations. |
| `packages/` | Platform packages. Empty — a package appears here when it has working code that something uses. |
| `infrastructure/terraform/` | ECS, RDS, CloudFront, ACM, SES, SQS, ElastiCache — 21 files. |
| `tests/` | Monorepo-level tests: properties of the repository, not of the application. |
| `tools/` | Operational scripts. |
| `docs/` | Architecture, decisions, migrations, runbook. |
| `Tier1/`, `*.pdf`, `*.xlsx` | Simon Business School source documents the roster and resource data derive from. |

Status, honestly: this is the working pilot application plus the beginnings of the
platform around it. The configuration engine, module runtime, blueprint system and
System Studio described in `docs/architecture/PLATFORM-ARCHITECTURE.md` are not
built yet. Where a directory named in that document does not exist here, it is
because nothing real would be in it.

## Running it

Requires Node ≥ 20 (developed on 22.21) and Docker.

```bash
npm ci

docker run -d --name tenure-pg \
  -e POSTGRES_USER=tenure -e POSTGRES_PASSWORD=tenure -e POSTGRES_DB=tenure \
  -p 5433:5432 postgres:16

export DATABASE_URL="postgresql://tenure:tenure@localhost:5433/tenure"

cd apps/web
npx prisma migrate deploy
node scripts/seed.mjs        # 26 clubs, 235 seats, 172 people
cd ../..

npm run dev                  # http://localhost:3000
```

`GET /api/health` returns `{"status":"ok","db":"ok"}` when the app can reach the
database.

## Checks

```bash
npm run lint
npm run type-check
npm run test --workspace apps/web -- --ci    # 258 unit tests
npm run test:platform                        # monorepo-level tests
npm run build

cd apps/web
npm run test:isolation                       # needs DATABASE_URL and a seeded database
npx playwright install --with-deps chromium
npx playwright test                          # 132 e2e specs
```

Two things to know before trusting a red result:

- **`test:isolation` needs seeded data.** One assertion guards itself with
  `roleAssignment.count() > 0`, which is only true after `scripts/seed.mjs`.
  16/17 unseeded, 17/17 seeded. This is the failure currently reding CI on
  `satvikOS/Tenure` — see `docs/migrations/BASELINE-VALIDATION.md`.
- **The e2e suite is not idempotent.** Seven specs mutate state they later assert
  on. 132/132 against a fresh migrate+seed; 125/132 on a second run against the
  same database.

## Deployment

**Production deploys from `satvikOS/Tenure`, not from here.** That is deliberate
and temporary: this repository is canonical for development first, and canonical
for deployment only after a staging equivalence proof and an approved cutover.

Every AWS-touching workflow here is disarmed with
`if: github.repository == 'satvikOS/Tenure'`, because this repository holds the
same deploy credentials and `deploy.yml` fires on a push to `main`. That guard is
asserted by `npm run test:platform` in CI. See
`docs/decisions/ADR-0004-CANONICAL-MONOREPO.md`.

## Documents, in the order they are worth reading

1. `docs/decisions/ADR-0004-CANONICAL-MONOREPO.md` — why this repository is canonical.
2. `docs/migrations/LIVE-APP-IMPORT-PLAN.md` — how the application got here, with the history proof.
3. `docs/migrations/BASELINE-VALIDATION.md` — every check, its exit code, and the pre-existing failures.
4. `docs/architecture/REVIEW-FINDINGS.md` — an adversarial review of the platform spec against the real code. **Read before the spec itself.**
5. `docs/architecture/PLATFORM-ARCHITECTURE.md` — the target platform (~7,200 lines).
6. `docs/RUNBOOK.md` — operating the live pilot.

### Why the review comes before the specification

The specification's sections were authored in parallel and then reviewed by an
independent pass instructed to find only defects. It found several that would not
work as written — an RLS bootstrap deadlock that would stop the application
authenticating anyone, two contradictory `withTenant` designs with opposite failure
semantics, effective-permission SQL that never checks membership state so suspended
members keep every capability, and three mutually exclusive target schemas all
marked MVP. Treat the specification as a strong draft with a known defect list.
Where the two disagree, the review wins.
