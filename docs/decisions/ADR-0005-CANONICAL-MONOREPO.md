# ADR-0005 — Tenure-Parent is the canonical monorepo, by merging Tenure into it

- **Status:** Accepted
- **Date:** 2026-07-31
- **Implements:** PD-001
- **Completes:** ADR-0003, whose status reads *"structure done; repo-identity step outstanding"*

> **On the number.** The build directive names this file `ADR-0001-CANONICAL-MONOREPO.md`.
> `ADR-0001-versioned-migrations-and-boot-safety.md` already existed and was imported with
> the application, so this was first written as ADR-0004. `satvikOS/Tenure` then added its
> own ADR-0004 — the tenant-scoped schema programme — while the import was in flight. That
> one is upstream and deployed, so this one moved to 0005 rather than asking it to.
>
> Two repositories numbering ADRs independently, and colliding within a day, is precisely
> the overlap cost recorded under Consequences below. It is left visible rather than tidied
> away, because it is evidence about how long the overlap can safely run.

## Context

PD-001 decided in the abstract that the platform is built in `Tenure-Parent` and
that `satvikOS/Tenure` migrates into it. ADR-0003 then did half the work — but in
the wrong repository. It relocated the application to `apps/web` inside an
npm-workspaces monorepo *within `satvikOS/Tenure`*, and even named the root
package `tenure-parent`, while leaving the actual `Tenure-Parent` repository
holding five Markdown files. Its own Consequences section says so.

So on 2026-07-31 the state was:

- `satvikOS/Tenure` — the whole working product, correctly monorepo-shaped, 344
  files, deploying production, CI red on the two most recent commits.
- `satvikOS/Tenure-Parent` — `ARCHITECTURE.md`, `CLAUDE.md`,
  `CURRENT-STATE-INVENTORY.md`, `README.md`, `REVIEW-FINDINGS.md`. Nothing that runs.

Two repositories, one of which is named as the platform and contains no platform.

## Decision

Merge `satvikOS/Tenure` into `satvikOS/Tenure-Parent` **at the root**, with full
history, and treat the result as canonical.

```
git remote add live https://github.com/satvikOS/Tenure.git
git fetch live main
git merge --allow-unrelated-histories --no-ff live/main
```

Root, not `apps/web`: ADR-0003 already put the application at `apps/web` in the
source, so a root merge lands every file at the path it already occupies. The
directive's preferred destination is satisfied without moving anything.

### Why not the alternatives

**`git subtree add --prefix=apps/web`.** Yields `apps/web/apps/web/src/`, plus
`infrastructure/` and `.github/` nested one level too deep. Undoing that means
editing 13 workflows, the Dockerfile, all Terraform paths, the Prisma schema
location, `jest.config.js` and `playwright.config.ts` — a rewrite performed under
the name of an import, with the deploy pipeline as the thing that breaks if a path
is missed.

**`git filter-repo --to-subdirectory-filter`.** Same path damage, and it rewrites
every commit SHA. The imported ADRs and `RUNBOOK.md` cite commits by SHA; all of
those citations would dangle.

**Snapshot copy.** Loses history, which the directive forbids and which is the
asset most worth keeping — `git blame` on a tenancy file is how the next person
learns why the chokepoint is shaped the way it is.

**Evolve `satvikOS/Tenure` in place and rename it.** Already rejected in PD-001.
It also does not survive contact with the deploy pipeline: that repository's
`main` builds a container and rolls production ECS on every push, so it is the
worst possible place to do exploratory platform work.

## Consequences

**Immediately true.**

- One repository holds the application, the schema, the infrastructure, the CI and
  the platform documents. `packages/` is here, empty, adjacent to a real
  application that platform code can be validated against.
- History is intact. `git log --follow apps/web/src/lib/rbac.ts` reaches
  `b932e7d` (2026-07-10) through the `R100 src/lib/rbac.ts → apps/web/src/lib/rbac.ts`
  rename. SHAs are unchanged, so every citation in the imported docs resolves.
- The monorepo runs: 258/258 unit, 132/132 e2e, build, container build, 9/9
  container inspections, `/api/health` → `200 {"status":"ok","db":"ok"}`. All from
  `Tenure-Parent`, all recorded in `docs/migrations/BASELINE-VALIDATION.md`.

**Deliberately not yet true.**

- **Production still deploys from `satvikOS/Tenure`.** This repository has no
  deployment. That is the safe order: canonical for development first, canonical
  for deployment only after a staging equivalence proof and an approved cutover.
- **`satvikOS/Tenure` is untouched and stays that way.** It is the rollback source.
  It is not archived, not made read-only, not branched from here. The one change
  worth making there — the isolation test that reds its CI — goes as a pull request
  for a human to merge, never as a push to its `main`, because that deploys.

**Costs accepted.**

- Two repositories exist during the overlap, and a fix applied in one has to be
  applied in the other. Bounded by keeping the overlap short and by making
  `Tenure`-side changes rare and PR-only.
- `Tenure-Parent`'s `main` currently has no CI. The imported workflows trigger on
  `push: [main, develop]` and will start running here the moment this branch
  merges — including `deploy.yml`, which must be neutralised in this repository
  before that happens, or a merge to `main` here attempts an AWS deploy with
  credentials it does not have. **This is the first thing to fix after the import
  lands, and it is tracked as such.**

## Verification

`docs/migrations/BASELINE-VALIDATION.md` — every check, its command, its exit code,
and the one pre-existing failure, run before the import.

`docs/migrations/LIVE-APP-IMPORT-PLAN.md` — the method, the two preconditions
checked before merging, the history proof, the post-merge results, and rollback.
