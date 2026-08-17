# Simon absorption — hard-coded tenant assumptions

**Generated** by `node tools/simon-convergence-inventory.mjs` from
`docs/architecture/simon-convergence-inventory.json`. Do not edit by hand — `tests/simon-convergence-inventory.test.mjs`
re-renders this file from the snapshot and reds on any difference.

Closes **SIMON-000-004**. Both repositories are read at the commits pinned by
`docs/architecture/simon-absorption-inventory.json`; the pilot is never cloned, checked out or pushed to
from here.

Every probe below is a pattern run over a real file list at a pinned commit, and every row
names a path and the line numbers inside it. A probe may print what it matched only when its
pattern is a closed set of literal tokens — a season, a role name, an AWS region, an ARN service
prefix — and the ones whose patterns have an open capture print `#` of the matched length
instead. So no student, staff or applicant data can reach this file, and no value appears for any
identifier a probe could not have enumerated in advance.


Observed 2026-08-17. Source `47c1128cb55953b11bedc47927508bc5d622b159`, target `cc4e5291da1ce948b2a2153dfbe8444bbb1528b7`.

## What was scanned

| Side | Files in tree | Scanned | Excluded | Hits |
| --- | --- | --- | --- | --- |
| source | 364 | 321 | 32 | 1825 |
| target | 1526 | 1362 | 123 | 5913 |

Excluded on purpose, with the reason:

| Pattern | Why |
| --- | --- |
| `/^docs\//` | prose and generated inventories, not runtime behaviour |
| `/(^\|\/)(node_modules\|\.next\|dist\|build\|coverage)\//` | installed or generated |
| `/(^\|\/)(package-lock\.json\|pnpm-lock\.yaml\|yarn\.lock)$/` | a machine record of resolved versions |
| `/^Tier1\//` | the pilot’s real records — listed by path, never opened |

## The assumptions the requirement names, one row each

| Assumption | Probes | Source hits | Source files | Target hits | Target files |
| --- | --- | --- | --- | --- | --- |
| Simon / OSE | `tenant-token` | 637 | 107 | 1333 | 237 |
| University | `university-token` | 22 | 17 | 199 | 88 |
| account | `aws-account-id` | 0 | 0 | 445 | 103 |
| club | `club-token` | 925 | 125 | 1654 | 276 |
| domain | `domain-literal` | 98 | 31 | 788 | 172 |
| region | `aws-region` | 21 | 13 | 809 | 185 |
| resource | `aws-arn-prefix` `resource-identifier` | 3 | 2 | 479 | 88 |
| role | `role-comparison` `role-constant` | 111 | 43 | 183 | 76 |
| route name | `tenant-in-path` | 0 | 0 | 3 | 3 |
| term | `term-with-year` `term-season-enum` | 8 | 4 | 18 | 14 |
| workflow | `workflow-shape` | 0 | 0 | 2 | 2 |

## The hiding places the requirement names, one row each

A finding is attributed to the **first** place whose pattern matches its path, so these rows
partition the hits exactly once and the column sums equal the totals above.

| Place | Source hits | Source files | Target hits | Target files | Target evidence |
| --- | --- | --- | --- | --- | --- |
| fixtures | 55 | 1 | 65 | 3 | `apps/web/scripts/seed-guard.test.mjs` `apps/web/scripts/seed.mjs` `tools/dev/seed-studio-fleet.mjs` |
| CSS | 2 | 1 | 4 | 2 | `apps/system-studio/src/components/breadcrumbs.module.css` `apps/web/src/app/globals.css` |
| reports | 41 | 5 | 44 | 7 | `apps/system-studio/src/lib/cost-report.ts` `apps/web/e2e/search-reports.spec.ts` `apps/web/src/app/(app)/reports/finance/page.tsx` `apps/web/src/app/(app)/reports/page.tsx` `apps/web/src/app/api/reports/pulse/route.ts` `apps/web/src/components/charts/panels/ReportsAnalytics.tsx` |
| permission checks | 89 | 7 | 213 | 24 | `apps/system-studio/e2e/authorize-logic.spec.ts` `apps/system-studio/src/lib/authorize.ts` `apps/system-studio/src/lib/aws/guardduty.test.ts` `apps/web/src/lib/admin/guard.test.ts` `apps/web/src/lib/calendar-permissions.test.ts` `apps/web/src/lib/rbac.test.ts` |
| deployment scripts | 71 | 18 | 146 | 32 | `.github/workflows/aws-inventory.yml` `.github/workflows/bootstrap-oidc.yml` `.github/workflows/ci.yml` `.github/workflows/custom-domain.yml` `.github/workflows/db-recovery.yml` `.github/workflows/debug-logs.yml` |
| route names | 391 | 53 | 828 | 96 | `apps/system-studio/src/app/console-index/answer.test.ts` `apps/system-studio/src/app/layout.tsx` `apps/system-studio/src/app/page.tsx` `apps/system-studio/src/app/platform/compute/compute-answer.test.ts` `apps/system-studio/src/app/platform/cost/cost-citation.test.tsx` `apps/system-studio/src/app/platform/cost/cost-decisions.test.ts` |
| elsewhere | 1176 | 90 | 4613 | 456 | `apps/system-studio/e2e/adoption.spec.ts` `apps/system-studio/e2e/api-contract.spec.ts` `apps/system-studio/e2e/auth-mode-logic.spec.ts` `apps/system-studio/e2e/aws-unknown-is-not-absent.spec.ts` `apps/system-studio/e2e/breadcrumbs.spec.ts` `apps/system-studio/e2e/commands-logic.spec.ts` |

## Every probe, its pattern, and how much of a match it may print

| Probe | Assumption | Reveals | Pattern | Why it matters |
| --- | --- | --- | --- | --- |
| `tenant-token` | Simon / OSE | literal | `/\b(?:Simon\|SIMON\|simon\|OSE\|Ose\|ose)\b/g` | a tenant name in core code is the specific §2 failure absorption exists to prevent |
| `university-token` | University | literal | `/\bUniversit(?:y\|ies)\b/gi` | the institution type is tenant configuration, not a platform concept |
| `club-token` | club | literal | `/\bclubs?\b/gi` | “club” is Simon’s word for an organisation unit; the platform term is configurable |
| `term-with-year` | term | literal | `/\b(?:Fall\|Spring\|Summer\|Winter)[ _-]?20\d{2}\b/gi` | a term baked into code expires; the pilot target is Fall 2026 |
| `term-season-enum` | term | literal | `/\b(?:FALL\|SPRING\|SUMMER\|WINTER)\b/g` | a fixed season enumeration is an academic-calendar assumption |
| `role-comparison` | role | literal | `/\brole\b\s*(?:===\|!==\|==\|!=)\s*['"][^'"\n]{1,40}['"]/g` | SIMON-030-007: routing must come from workflow data, not hard-coded role checks |
| `role-constant` | role | literal | `/\b(?:SUPER_ADMIN\|OSE_ADMIN\|ADVISOR\|TREASURER\|PRESIDENT\|VICE_PRESIDENT)\b/g` | a role constant in code cannot be re-assigned by a tenant |
| `workflow-shape` | workflow | literal | `/\b(?:six\|6)[ _-]step\b\|\bstep\s*(?:===\|==)\s*\d+\|\b(?:VP\|PRESIDENT\|OSE)_(?:APPROVAL\|REVIEW\|SIGNOFF)\b/gi` | the six-step OSE workflow must be data, so future variants need no code change |
| `domain-literal` | domain | literal | `/(?<![@\w])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:edu\|com\|org\|net\|gov)\b/g` | a hostname in code pins one tenant’s deployment |
| `aws-account-id` | account | mask | `/(?<![\w.])\d{12}(?![\w.])/g` | an AWS account id in code pins one account; it is also semi-secret, so it is masked |
| `aws-region` | region | literal | `/\b(?:us\|eu\|ap\|sa\|ca\|me\|af\|il)-(?:east\|west\|north\|south\|northeast\|northwest\|southeast\|southwest\|central)-[1-9]\b/g` | a region in code pins one topology; the bible forbids Simon owning the AWS topology |
| `aws-arn-prefix` | resource | literal | `/\barn:aws[a-z-]*:[a-z0-9-]+:/g` | a literal ARN is a resource this repository does not own the lifecycle of |
| `resource-identifier` | resource | mask | `/\b(?:bucket\|bucket_name\|table_name\|queue_url\|topic_arn\|distribution_id\|hosted_zone_id\|certificate_arn\|cluster_name\|user_pool_id\|user_pool_client_id)\s*[:=]\s*['"][^'"\n]{1,120}['"]/g` | a named resource is a deployed thing with an owner; the name itself is masked |
| `tenant-in-path` | route name | literal (path) | `/(?:^\|\/)(?:simon\|ose)(?:[-_.]\|\/\|$)/i` | a tenant-named route or module is a fork wearing a directory name |

## source — the twenty files carrying the most assumptions

175 files carry at least one. The complete per-file, per-line list is in the snapshot.

| File | Place | Hits | Assumptions |
| --- | --- | --- | --- |
| `apps/web/scripts/roster-data.sample.mjs` | elsewhere | 138 | Simon / OSE, club, term |
| `apps/web/src/lib/policies.ts` | elsewhere | 97 | Simon / OSE, University, club, domain, role |
| `apps/web/scripts/deliverables-data.mjs` | elsewhere | 82 | Simon / OSE, club, role |
| `apps/web/scripts/generate-roster.mjs` | elsewhere | 77 | Simon / OSE, club, role, term |
| `apps/web/scripts/seed.mjs` | fixtures | 55 | Simon / OSE, University, club, domain, role |
| `apps/web/src/app/(app)/admin/clubs/page.tsx` | route names | 47 | Simon / OSE, club |
| `apps/web/scripts/resources-data.mjs` | elsewhere | 46 | Simon / OSE, club, domain, role |
| `apps/web/src/app/(app)/admin/actions.ts` | route names | 44 | Simon / OSE, club, role |
| `apps/web/prisma/schema.prisma` | elsewhere | 42 | Simon / OSE, University, club, domain, role, term |
| `apps/web/e2e/app.spec.ts` | elsewhere | 39 | Simon / OSE, club, role |
| `apps/web/scripts/clubs-data.mjs` | elsewhere | 36 | Simon / OSE, club, role |
| `apps/web/src/lib/rbac.ts` | permission checks | 32 | Simon / OSE, club, role |
| `apps/web/e2e/roster.spec.ts` | elsewhere | 28 | Simon / OSE, University, club, domain |
| `apps/web/e2e/club-cards.spec.ts` | elsewhere | 27 | Simon / OSE, club |
| `apps/web/src/app/(app)/reports/finance/page.tsx` | reports | 27 | Simon / OSE, club |
| `apps/web/src/lib/admin/capabilities.ts` | elsewhere | 27 | Simon / OSE, club |
| `apps/web/src/app/(app)/dashboard/page.tsx` | route names | 24 | Simon / OSE, club, role |
| `apps/web/e2e/admin-console.spec.ts` | elsewhere | 23 | Simon / OSE, University, club |
| `apps/web/src/lib/tenant/brand.test.ts` | elsewhere | 23 | Simon / OSE |
| `apps/web/e2e/admin.spec.ts` | elsewhere | 22 | Simon / OSE, club |

## target — the twenty files carrying the most assumptions

620 files carry at least one. The complete per-file, per-line list is in the snapshot.

| File | Place | Hits | Assumptions |
| --- | --- | --- | --- |
| `apps/system-studio/src/lib/aws/tags.test.ts` | elsewhere | 188 | Simon / OSE, account, region, resource |
| `apps/system-studio/src/lib/aws/console-link.test.ts` | elsewhere | 147 | account, domain, region, resource |
| `apps/web/scripts/roster-data.sample.mjs` | elsewhere | 138 | Simon / OSE, club, term |
| `packages/organization-model/src/organization-model.test.ts` | elsewhere | 116 | Simon / OSE, University, club |
| `apps/web/src/lib/policies.ts` | elsewhere | 97 | Simon / OSE, University, club, domain, role |
| `apps/system-studio/src/lib/aws/certificates.test.ts` | elsewhere | 87 | Simon / OSE, account, domain, region, resource |
| `apps/web/scripts/deliverables-data.mjs` | elsewhere | 82 | Simon / OSE, club, role |
| `packages/provisioning/src/provider-packs.ts` | elsewhere | 81 | domain |
| `apps/web/scripts/generate-roster.mjs` | elsewhere | 77 | Simon / OSE, club, role, term |
| `apps/system-studio/e2e/aws-unknown-is-not-absent.spec.ts` | elsewhere | 72 | account, domain, region, resource |
| `apps/system-studio/src/app/platform/network/edge.test.ts` | route names | 67 | account, domain, region, resource |
| `apps/system-studio/src/lib/aws/aws-health.test.ts` | elsewhere | 67 | Simon / OSE, account, region, resource |
| `apps/system-studio/src/lib/aws/topology.test.ts` | elsewhere | 67 | account, domain, region, resource |
| `apps/system-studio/src/lib/aws/dns.test.ts` | elsewhere | 65 | account, domain, region, resource |
| `apps/web/scripts/seed.mjs` | fixtures | 57 | Simon / OSE, University, club, domain, role |
| `apps/system-studio/src/generated/platform-truth.json` | elsewhere | 53 | Simon / OSE, club, region |
| `apps/system-studio/src/app/tenants/[slug]/tenant-answers.test.ts` | route names | 51 | account, region, resource |
| `apps/web/prisma/schema.prisma` | elsewhere | 50 | Simon / OSE, University, club, domain, role, term |
| `apps/web/src/lib/rbac.ts` | permission checks | 50 | Simon / OSE, club, role |
| `tools/loop/harvested-queue.json` | elsewhere | 49 | Simon / OSE, University, club, domain, region, role |

## Honest limits

- A probe is a pattern, not a compiler. It locates a literal; it does not decide whether that
  literal is load-bearing. `club` in a comment and `club` in a permission check both count here,
  and separating them is adjudication, not search.
- A hit is not automatically a defect. The point of the table is that the list exists and is
  re-derivable, so `SIMON-GATE-010` can be argued from evidence instead of from memory.
- `docs/` is excluded. An assumption that exists only in prose is not runtime behaviour, and
  the generated inventories there mention the tenant thousands of times.
- Non-scannable extensions are not searched: spreadsheets, PDFs and images could hold an
  assumption and this scan would not see it. `Tier1/` is listed by path and never opened.
- `aws-account-id` matches any bare twelve-digit run. An AWS account id has that shape and so
  do other things, so a hit there is a shape to look at, not an account. It is masked either
  way, which is why the ambiguity costs nothing.
- `domain-literal` prints the hostname it matched. A hostname is a public DNS name, not a
  credential, and every one this found is already committed in this repository — the CloudFront
  domain is in `README.md` and six workflows. Anything account-scoped is caught by
  `resource-identifier` or `aws-account-id` instead, and both of those mask.

