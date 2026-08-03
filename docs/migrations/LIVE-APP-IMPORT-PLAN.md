# Importing the live Tenure application

How the working product was moved into this repository, why that method and not
another, and what is true afterwards. Written after the import ran, so it records
what happened rather than what was intended.

## What each repository actually contained

Checked by cloning both, not by reading a previous description of them.

**`Tenurework/Tenure-Parent`** — 5 files, all Markdown, 227 KB, 2 commits.
`ARCHITECTURE.md`, `CLAUDE.md`, `CURRENT-STATE-INVENTORY.md`, `README.md`,
`REVIEW-FINDINGS.md`. No application, no `package.json`, no tests, no
infrastructure. A repository of documents about a product that lived elsewhere.

**`Tenurework/Tenure`** — 344 files, 4.4 MB, deep history, 7 live branches.
The working product, and already monorepo-shaped:

```
package.json            workspaces: ["apps/*", "packages/*"]   name: "tenure-parent"
apps/web/               Next.js 15.5 · React 19 · Prisma 6 · NextAuth 5 beta
                        219 source files · 19 unit suites · 28 e2e spec files
apps/web/prisma/        997-line schema, 40 models, versioned migrations
infrastructure/terraform/  21 .tf files — ECS, RDS, CloudFront, ACM, SES, SQS…
.github/workflows/      13 workflows — ci, deploy, db-recovery, ops-status…
docs/                   RUNBOOK.md, 3 ADRs, PRODUCT-DECISIONS.md
Tier1/                  Simon Business School source documents (PDF/XLSX)
```

The decisive fact: commit `a9d901b` *"refactor(repo): relocate the app to apps/web
inside an npm-workspaces monorepo"* had already done the restructuring, in the
source repository, and had already named the root package `tenure-parent`. The
target layout was not something to build — it was something already built in the
wrong repository.

## Import method

```
git remote add live https://github.com/Tenurework/Tenure.git
git fetch live main
git merge --allow-unrelated-histories --no-ff live/main
```

A root-level merge of unrelated histories. Result commit `05e3a3e`.

### Why this and not a subtree or filter-repo

The directive names `apps/web` as the preferred destination. The application is
*already at* `apps/web` in the source. So the merge that preserves the most is the
one that moves nothing:

- **`git subtree add --prefix=apps/web`** would have produced
  `apps/web/apps/web/src/…`, and `apps/web/infrastructure/terraform/`, and
  `apps/web/.github/workflows/`. Every path in 13 workflow files, the Dockerfile,
  the Terraform, `jest.config.js`, `playwright.config.ts` and `tsconfig.json` would
  then need rewriting to undo it. That is a rewrite dressed as an import.
- **`git filter-repo --to-subdirectory-filter`** has the same problem plus a
  rewritten SHA for every commit, which breaks every commit reference in the ADRs
  and runbook that were imported alongside it.
- **A snapshot copy** discards history, which the directive forbids and which is
  the thing most worth keeping.

### The two preconditions, checked before merging

```
$ git merge-base HEAD live/main
→ no common ancestor          # unrelated histories, so --allow-unrelated-histories is correct
                              # and not masking a bad remote

$ comm -12 <(git ls-tree -r --name-only HEAD | sort) \
           <(git ls-tree -r --name-only live/main | sort)
→ (empty)                     # zero overlapping paths
```

Zero overlap matters: with no path present on both sides, no conflict resolution
runs, so nothing from either tree can be silently dropped. `Tenure` has no root
`README.md` and no `CLAUDE.md`; `Tenure-Parent` has no `apps/`, `docs/`,
`infrastructure/` or `package.json`. The trees are disjoint. The merge is
mechanically an addition.

## History is preserved, and this is what proves it

```
$ git log --follow --name-status --oneline -- apps/web/src/lib/rbac.ts
M    apps/web/src/lib/rbac.ts
R100 src/lib/rbac.ts → apps/web/src/lib/rbac.ts     ← crosses the a9d901b relocation
M    src/lib/rbac.ts
M    src/lib/rbac.ts
… 5 more …
A    src/lib/rbac.ts                                 ← b932e7d, 2026-07-10

$ git log --follow --format='%h %ad %s' --date=short -- apps/web/src/lib/rbac.ts | tail -1
b932e7d 2026-07-10 feat(rbac): Week 2 - RBAC core, roster views, pilot sign-in, DB bootstrap
```

`git log --follow` on a file inside `apps/web` walks back through the rename to
its original creation in the source repository three weeks before the monorepo
existed. `git blame` resolves to the original authoring commits. Commit SHAs are
unchanged — `8d11204` in this repository is `8d11204` in `Tenurework/Tenure` — so
every commit citation in the imported ADRs and runbook still resolves.

## Verified after the merge, from this repository

Every command run with cwd = `Tenure-Parent`, against PostgreSQL 16 in Docker.

| Check | Exit | Result |
|---|---|---|
| `npm ci` | 0 | 765 packages, root lockfile drives `apps/web` |
| `npm run type-check` | 0 | PASS |
| `npm run lint` | 0 | PASS (6 pre-existing warnings) |
| `npm run test --workspace apps/web -- --ci` | 0 | **258 / 258** |
| `npm run build` | 0 | 40 routes |
| `npx prisma migrate diff … --exit-code` | 0 | no drift |
| `npx prisma migrate deploy` (empty DB) | 0 | applied |
| `node scripts/seed.mjs` | 0 | 26 clubs, 235 seats |
| `docker build -f apps/web/Dockerfile .` | 0 | image built |
| container inspection (9 assertions from `ci.yml`) | 0 | **9 / 9** |
| `npm run start` → `GET /api/health` | — | `200 {"status":"ok","db":"ok"}` |
| `GET /signin` | — | `200` |
| `npx playwright test` (fresh seed) | 0 | **132 / 132** |

No source file, migration, workflow or Terraform file was edited to make any of
this pass. The paths the tooling depends on — `apps/web/prisma/schema.prisma`,
the root lockfile, the Dockerfile's root build context, `infrastructure/terraform`
at the root — were already correct because the source repository had already put
them there. **Section 6.4 of the directive, "repair path assumptions", turned out
to require no repairs.** That is a finding, not an omission.

## What was deliberately not done

- **`Tenurework/Tenure` is untouched.** No push, no branch, no force, no archive. It
  still holds `main`, still deploys production on push, and is the rollback source
  until cutover completes.
- **No production anything.** No DNS, no secrets, no Terraform apply, no migration
  against a production database.
- **No pre-existing defect fixed inside the import.** Including the isolation test
  that is currently reding CI on the source repository — fixing it here would mean
  the import commit no longer means "the same code, in a new place".
- **`packages/` is still empty** apart from `.gitkeep`. Packages get created when
  they have working code in them.

## Rollback

The import is one merge commit on one branch. Nothing depends on it yet.

```bash
# Branch not yet merged to main:
git branch -D platform/import-live-tenure

# Already merged:
git revert -m 1 <merge-sha>

# Total abandonment: Tenurework/Tenure is unmodified and still deploys production.
# Nothing needs to be undone there.
```

## Where the documents went

`Tenure-Parent`'s five root files were about a product in another repository. With
that product now here, they moved into `docs/architecture/` beside the imported
`docs/`, and `README.md` and `CLAUDE.md` were rewritten to describe a repository
that now contains an application.

| Before | After |
|---|---|
| `ARCHITECTURE.md` | `docs/architecture/PLATFORM-ARCHITECTURE.md` |
| `CURRENT-STATE-INVENTORY.md` | `docs/architecture/CURRENT-STATE-INVENTORY.md` |
| `REVIEW-FINDINGS.md` | `docs/architecture/REVIEW-FINDINGS.md` |
| `README.md` | rewritten in place |
| `CLAUDE.md` | rewritten in place |

`REVIEW-FINDINGS.md` survives the move unedited and is the most load-bearing
document of the three: it is an adversarial review of `PLATFORM-ARCHITECTURE.md`
against the real code, and it finds an RLS bootstrap deadlock, two contradictory
`withTenant` designs and three mutually exclusive target schemas in it. The
architecture document must not be implemented without it.
