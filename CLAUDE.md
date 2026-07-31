# Tenure-Parent

`github.com/satvikOS/Tenure-Parent` — the canonical Tenure platform monorepo.

As of 2026-07-31 this repository contains the working product, not just documents
about it. `satvikOS/Tenure` was merged in whole, with history
(`docs/decisions/ADR-0004-CANONICAL-MONOREPO.md`).

```
apps/web/                 the application — Next.js 15, React 19, Prisma 6, NextAuth 5
apps/web/prisma/          997-line schema, 40 models, versioned migrations
packages/                 platform packages (empty until something real lives here)
infrastructure/terraform/ ECS, RDS, CloudFront, ACM, SES, SQS
tests/                    monorepo-level tests — properties of the repo, not the app
tools/                    operational scripts
docs/architecture/        the platform spec and its adversarial review
docs/decisions/           ADRs and PRODUCT-DECISIONS.md
docs/migrations/          import plan, baseline validation
```

## Two rules that are not negotiable

**1. Never push to `github.com/satvikOS/Tenure`.**

A push to its `main` builds a container, applies Terraform and rolls production ECS
for a live pilot carrying real student data. It remains the rollback source until
cutover completes. If something there needs to change — and there is at least one
thing, a test that reds its CI — open a **pull request** and let a human merge it.
A PR runs CI; it does not deploy.

**2. The production workflows in this repository are disarmed, and must stay that way.**

This repository holds the same `ACCESSKEYID` / `SECRETACCESSKEY` secrets as the one
that deploys. `deploy.yml` triggers on `push: branches: [main]`. Every AWS-touching
job therefore carries:

```yaml
if: github.repository == 'satvikOS/Tenure'
```

Without it, merging to `main` here rolls production. `npm run test:platform`
asserts this and runs in CI; `tools/disarm-production-workflows.mjs` restores it.
Do not remove a guard to "make the workflow work" — it working is the failure mode.

## Pushing

**Commit and push to `main` in THIS repository, periodically, as you work.** Push
each coherent, verified piece as it is finished rather than saving up one large
push at the end.

Verify before pushing. At minimum, for a change touching the app:

```bash
npm run type-check && npm run lint
npm run test --workspace apps/web -- --ci
npm run test:platform
npm run build
```

Database and e2e work needs Postgres:

```bash
docker run -d --name tenure-pg \
  -e POSTGRES_USER=tenure -e POSTGRES_PASSWORD=tenure -e POSTGRES_DB=tenure \
  -p 5433:5432 postgres:16
export DATABASE_URL="postgresql://tenure:tenure@localhost:5433/tenure"
cd apps/web && npx prisma migrate deploy && node scripts/seed.mjs
npx playwright test
```

**The e2e suite is not idempotent** — it mutates state it later asserts on. 132/132
on a fresh migrate+seed, 125/132 on a second run against the same database. Re-seed
between runs; a failure there is usually stale state, not your change.

## Before implementing anything from the platform architecture

Read `docs/architecture/REVIEW-FINDINGS.md` **first**. It is an adversarial review
of `docs/architecture/PLATFORM-ARCHITECTURE.md` conducted against the real code,
and it finds an RLS bootstrap deadlock that would stop the app authenticating
anyone, two contradictory `withTenant` designs with opposite failure semantics,
three mutually exclusive target schemas all marked MVP, and SQL that references
columns the schema does not have. Implementing the spec without the review means
implementing known-broken designs.

Where the two disagree, the review wins.

## Evidence

Do not report a command as passing unless it was run. Do not describe a file as
changed unless it is in the branch. Do not call an interface implemented when it
is only declared. `docs/migrations/BASELINE-VALIDATION.md` is the shape this is
expected to take: every check, its command, its exit code, and the failures that
were already there.
