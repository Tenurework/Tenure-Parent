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


Observed 2026-08-18. Source `47c1128cb55953b11bedc47927508bc5d622b159`, target `ccbe45af1196221bc56e082bdf885b7f3c0a9fea`.

## What was scanned

| Side | Files in tree | Scanned | Excluded | Hits |
| --- | --- | --- | --- | --- |
| source | 364 | 321 | 32 | 2873 |
| target | 1671 | 1487 | 143 | 9310 |

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
| Simon / OSE | `tenant-token` | 637 | 107 | 1447 | 253 |
| University | `university-token` | 22 | 17 | 208 | 93 |
| account | `aws-account-id` | 0 | 0 | 462 | 107 |
| club | `club-token` `org-category-member` | 1018 | 126 | 1867 | 308 |
| domain | `domain-literal` | 98 | 31 | 818 | 181 |
| region | `aws-region` | 21 | 13 | 840 | 193 |
| resource | `aws-arn-prefix` `resource-identifier` | 3 | 2 | 493 | 91 |
| role | `role-comparison` `role-constant` `role-enum-member` | 357 | 56 | 636 | 112 |
| route name | `tenant-in-path` | 0 | 0 | 5 | 5 |
| term | `term-with-year` `term-season-enum` | 8 | 4 | 23 | 15 |
| workflow | `workflow-shape` `approval-chain-symbol` `sla-threshold` `workflow-state-member` | 709 | 75 | 2511 | 361 |

## The hiding places the requirement names, one row each

A finding is attributed to the **first** place whose pattern matches its path, so these rows
partition the hits exactly once and the column sums equal the totals above.

| Place | Source hits | Source files | Target hits | Target files | Target evidence |
| --- | --- | --- | --- | --- | --- |
| fixtures | 72 | 1 | 94 | 4 | `apps/web/scripts/seed-guard.mjs` `apps/web/scripts/seed-guard.test.mjs` `apps/web/scripts/seed.mjs` `tools/dev/seed-studio-fleet.mjs` |
| CSS | 2 | 1 | 5 | 3 | `apps/system-studio/src/app/globals.css` `apps/system-studio/src/components/breadcrumbs.module.css` `apps/web/src/app/globals.css` |
| reports | 64 | 5 | 81 | 8 | `apps/system-studio/src/lib/cost-report.ts` `apps/web/e2e/search-reports.spec.ts` `apps/web/scripts/duplicate-source-report.mjs` `apps/web/src/app/(app)/reports/finance/page.tsx` `apps/web/src/app/(app)/reports/page.tsx` `apps/web/src/app/api/reports/pulse/route.ts` |
| permission checks | 219 | 8 | 473 | 36 | `apps/system-studio/e2e/authorize-logic.spec.ts` `apps/system-studio/src/lib/authorize.ts` `apps/system-studio/src/lib/aws/guardduty.test.ts` `apps/system-studio/src/lib/aws/guardduty.ts` `apps/web/src/lib/admin/guard.test.ts` `apps/web/src/lib/calendar-permissions.test.ts` |
| deployment scripts | 77 | 19 | 165 | 34 | `.github/workflows/aws-inventory.yml` `.github/workflows/bootstrap-oidc.yml` `.github/workflows/ci.yml` `.github/workflows/custom-domain.yml` `.github/workflows/db-recovery.yml` `.github/workflows/debug-logs.yml` |
| route names | 741 | 54 | 1370 | 109 | `apps/system-studio/src/app/console-index/answer.test.ts` `apps/system-studio/src/app/layout.tsx` `apps/system-studio/src/app/page.tsx` `apps/system-studio/src/app/platform/compute/compute-answer.test.ts` `apps/system-studio/src/app/platform/cost/cost-citation.test.tsx` `apps/system-studio/src/app/platform/cost/cost-decisions.test.ts` |
| elsewhere | 1698 | 99 | 7122 | 594 | `apps/system-studio/e2e/adoption.spec.ts` `apps/system-studio/e2e/api-contract.spec.ts` `apps/system-studio/e2e/auth-mode-logic.spec.ts` `apps/system-studio/e2e/aws-unknown-is-not-absent.spec.ts` `apps/system-studio/e2e/breadcrumbs.spec.ts` `apps/system-studio/e2e/commands-logic.spec.ts` |

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
| `approval-chain-symbol` | workflow | literal | `/\b(?:[Aa]pprovalStep\|[Aa]pprovalDelegation\|[Aa]pprovalChain\|[Rr]oleTransfer)\b/g` | the approval chain is a code-declared model — a tenant adding a step needs a migration, not configuration |
| `sla-threshold` | workflow | literal | `/\bSLA_[A-Z][A-Z0-9_]*\b\|\b[Ss]la(?:Hours\|Days\|Level\|Color\|Threshold)\b\|\b[Ee]scalat(?:e\|es\|ed\|ing\|ion\|ions)\b/g` | an SLA or escalation threshold in code is a workflow policy a tenant cannot re-set |
| `domain-literal` | domain | literal | `/(?<![@\w])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:edu\|com\|org\|net\|gov)\b/g` | a hostname in code pins one tenant’s deployment |
| `aws-account-id` | account | mask | `/(?<![\w.])\d{12}(?![\w.])/g` | an AWS account id in code pins one account; it is also semi-secret, so it is masked |
| `aws-region` | region | literal | `/\b(?:us\|eu\|ap\|sa\|ca\|me\|af\|il)-(?:east\|west\|north\|south\|northeast\|northwest\|southeast\|southwest\|central)-[1-9]\b/g` | a region in code pins one topology; the bible forbids Simon owning the AWS topology |
| `aws-arn-prefix` | resource | literal | `/\barn:aws[a-z-]*:[a-z0-9-]+:/g` | a literal ARN is a resource this repository does not own the lifecycle of |
| `resource-identifier` | resource | mask | `/\b(?:bucket\|bucket_name\|table_name\|queue_url\|topic_arn\|distribution_id\|hosted_zone_id\|certificate_arn\|cluster_name\|user_pool_id\|user_pool_client_id)\s*[:=]\s*['"][^'"\n]{1,120}['"]/g` | a named resource is a deployed thing with an owner; the name itself is masked |
| `tenant-in-path` | route name | literal (path) | `/(?:^\|\/)(?:simon\|ose)(?:[-_.]\|\/\|$)/i` | a tenant-named route or module is a fork wearing a directory name |
| `role-enum-member` | role | literal (derived) | `/\b(?:FUNCTIONAL\|MEMBER\|OSE_ADVISOR\|OSE_DIRECTOR\|OSE_STAFF\|PRESIDENT)\b/g` | a role name the schema declares is an authorization assumption wherever it appears in code |
| `workflow-state-member` | workflow | literal (derived) | `/\b(?:ACTIVE\|ALUMNI\|APPROVED\|ARCHIVED\|CANCELLED\|COMPLETED\|DECLINED\|DRAFT\|NEEDS_CHANGES\|PENDING\|PENDING_APPROVAL\|PENDING_OSE\|PENDING_PRESIDENT\|PUBLISHED\|REJECTED\|REVOKED\|SHADOW\|SUSPENDED)\b/g` | a workflow state written into code is a workflow shape no tenant can vary |
| `org-category-member` | club | literal (derived) | `/\b(?:COMMUNITY\|ORGANIZATION\|PROFESSIONAL\|SOCIAL)\b/g` | how the tenant classifies its organisations is tenant configuration; `COMMUNITY`/`SOCIAL` are Simon’s categories, not the platform’s |

## The vocabulary that is read out of the schemas rather than typed here

Three probes above are **derived**: their pattern is the alternation of every member of every
enum whose name matches the selector, taken from both trees and applied to both. Hand-listing
this vocabulary is what the first version of this scan did, and it missed the three roles the
pilot actually declares — `\bOSE\b` does not match `OSE_DIRECTOR`, because `_` is a word
character. A role added to the schema is in the probe on the next run instead.

| Probe | Assumption | Enum selector | Members | Vocabulary |
| --- | --- | --- | --- | --- |
| `role-enum-member` | role | `/(?:Role\|Scope)$/` | 6 | `FUNCTIONAL` `MEMBER` `OSE_ADVISOR` `OSE_DIRECTOR` `OSE_STAFF` `PRESIDENT` |
| `workflow-state-member` | workflow | `/Status$/` | 18 | `ACTIVE` `ALUMNI` `APPROVED` `ARCHIVED` `CANCELLED` `COMPLETED` `DECLINED` `DRAFT` `NEEDS_CHANGES` `PENDING` `PENDING_APPROVAL` `PENDING_OSE` `PENDING_PRESIDENT` `PUBLISHED` |
| `org-category-member` | club | `/Category$/` | 4 | `COMMUNITY` `ORGANIZATION` `PROFESSIONAL` `SOCIAL` |

Every declaration the vocabulary came from:

| Side | Enum | Declared at | Members | Probe |
| --- | --- | --- | --- | --- |
| source | `InstitutionRole` | `apps/web/prisma/schema.prisma`:80 | `OSE_ADVISOR` `OSE_DIRECTOR` `OSE_STAFF` | `role-enum-member` |
| source | `RoleScope` | `apps/web/prisma/schema.prisma`:328 | `FUNCTIONAL` `MEMBER` `PRESIDENT` | `role-enum-member` |
| target | `InstitutionRole` | `apps/web/prisma/schema.prisma`:89 | `OSE_ADVISOR` `OSE_DIRECTOR` `OSE_STAFF` | `role-enum-member` |
| target | `RoleScope` | `apps/web/prisma/schema.prisma`:423 | `FUNCTIONAL` `MEMBER` `PRESIDENT` | `role-enum-member` |
| source | `OrgStatus` | `apps/web/prisma/schema.prisma`:174 | `ACTIVE` `ARCHIVED` `PENDING` | `workflow-state-member` |
| source | `AssignmentStatus` | `apps/web/prisma/schema.prisma`:335 | `ACTIVE` `ALUMNI` `SHADOW` | `workflow-state-member` |
| source | `ApprovalStatus` | `apps/web/prisma/schema.prisma`:369 | `APPROVED` `CANCELLED` `DRAFT` `NEEDS_CHANGES` `PENDING_OSE` `PENDING_PRESIDENT` `REJECTED` | `workflow-state-member` |
| source | `EventStatus` | `apps/web/prisma/schema.prisma`:422 | `APPROVED` `CANCELLED` `DRAFT` `PENDING_APPROVAL` `PUBLISHED` | `workflow-state-member` |
| source | `CollabStatus` | `apps/web/prisma/schema.prisma`:819 | `APPROVED` `DECLINED` `PENDING_OSE` | `workflow-state-member` |
| source | `RoleTransferStatus` | `apps/web/prisma/schema.prisma`:898 | `CANCELLED` `COMPLETED` `DECLINED` `PENDING` | `workflow-state-member` |
| target | `MembershipStatus` | `apps/web/prisma/schema.prisma`:107 | `ACTIVE` `REVOKED` `SUSPENDED` | `workflow-state-member` |
| target | `OrgStatus` | `apps/web/prisma/schema.prisma`:223 | `ACTIVE` `ARCHIVED` `PENDING` | `workflow-state-member` |
| target | `AssignmentStatus` | `apps/web/prisma/schema.prisma`:430 | `ACTIVE` `ALUMNI` `SHADOW` | `workflow-state-member` |
| target | `ApprovalStatus` | `apps/web/prisma/schema.prisma`:464 | `APPROVED` `CANCELLED` `DRAFT` `NEEDS_CHANGES` `PENDING_OSE` `PENDING_PRESIDENT` `REJECTED` | `workflow-state-member` |
| target | `EventStatus` | `apps/web/prisma/schema.prisma`:595 | `APPROVED` `CANCELLED` `DRAFT` `PENDING_APPROVAL` `PUBLISHED` | `workflow-state-member` |
| target | `CollabStatus` | `apps/web/prisma/schema.prisma`:1293 | `APPROVED` `DECLINED` `PENDING_OSE` | `workflow-state-member` |
| target | `RoleTransferStatus` | `apps/web/prisma/schema.prisma`:1387 | `CANCELLED` `COMPLETED` `DECLINED` `PENDING` | `workflow-state-member` |
| source | `OrgCategory` | `apps/web/prisma/schema.prisma`:180 | `COMMUNITY` `ORGANIZATION` `PROFESSIONAL` `SOCIAL` | `org-category-member` |
| target | `OrgCategory` | `apps/web/prisma/schema.prisma`:229 | `COMMUNITY` `ORGANIZATION` `PROFESSIONAL` `SOCIAL` | `org-category-member` |

## source — the twenty files carrying the most assumptions

187 files carry at least one. The complete per-file, per-line list is in the snapshot.

| File | Place | Hits | Assumptions |
| --- | --- | --- | --- |
| `apps/web/scripts/roster-data.sample.mjs` | elsewhere | 164 | Simon / OSE, club, term |
| `apps/web/src/app/(app)/admin/actions.ts` | route names | 126 | Simon / OSE, club, role, workflow |
| `apps/web/src/lib/policies.ts` | elsewhere | 103 | Simon / OSE, University, club, domain, role |
| `apps/web/prisma/schema.prisma` | elsewhere | 100 | Simon / OSE, University, club, domain, role, term, workflow |
| `apps/web/scripts/deliverables-data.mjs` | elsewhere | 93 | Simon / OSE, club, role |
| `apps/web/scripts/generate-roster.mjs` | elsewhere | 82 | Simon / OSE, club, role, term |
| `apps/web/scripts/seed.mjs` | fixtures | 72 | Simon / OSE, University, club, domain, role, workflow |
| `apps/web/prisma/migrations/20260730000000_baseline/migration.sql` | elsewhere | 64 | club, role, term, workflow |
| `apps/web/src/app/(app)/admin/clubs/page.tsx` | route names | 62 | Simon / OSE, club, workflow |
| `apps/web/scripts/clubs-data.mjs` | elsewhere | 59 | Simon / OSE, club, role |
| `apps/web/src/lib/rbac.ts` | permission checks | 59 | Simon / OSE, club, role, workflow |
| `apps/web/src/lib/approvals.test.ts` | elsewhere | 56 | Simon / OSE, club, role, workflow |
| `apps/web/scripts/resources-data.mjs` | elsewhere | 55 | Simon / OSE, club, domain, role |
| `apps/web/src/lib/calendar-permissions.test.ts` | permission checks | 55 | Simon / OSE, club, role, workflow |
| `apps/web/src/lib/admin/capabilities.ts` | elsewhere | 49 | Simon / OSE, club, role |
| `apps/web/e2e/app.spec.ts` | elsewhere | 48 | Simon / OSE, club, role, workflow |
| `apps/web/src/lib/approvals.ts` | elsewhere | 46 | Simon / OSE, club, role, workflow |
| `apps/web/src/lib/rbac.test.ts` | permission checks | 46 | Simon / OSE, club, role, workflow |
| `apps/web/src/app/(app)/approvals/actions.ts` | route names | 42 | Simon / OSE, club, role, workflow |
| `apps/web/src/lib/messaging.ts` | elsewhere | 41 | Simon / OSE, club, role, workflow |

## target — the twenty files carrying the most assumptions

788 files carry at least one. The complete per-file, per-line list is in the snapshot.

| File | Place | Hits | Assumptions |
| --- | --- | --- | --- |
| `apps/system-studio/src/lib/aws/tags.test.ts` | elsewhere | 188 | Simon / OSE, account, region, resource |
| `apps/web/scripts/roster-data.sample.mjs` | elsewhere | 164 | Simon / OSE, club, term |
| `tools/loop/queue-groups.json` | elsewhere | 149 | Simon / OSE, University, club, domain, region, role, workflow |
| `tools/loop/harvested-queue.json` | elsewhere | 148 | Simon / OSE, University, club, domain, region, role, workflow |
| `apps/system-studio/src/lib/aws/console-link.test.ts` | elsewhere | 147 | account, domain, region, resource |
| `apps/web/src/app/(app)/admin/actions.ts` | route names | 131 | Simon / OSE, club, role, workflow |
| `apps/web/prisma/schema.prisma` | elsewhere | 118 | Simon / OSE, University, club, domain, role, term, workflow |
| `packages/organization-model/src/organization-model.test.ts` | elsewhere | 116 | Simon / OSE, University, club |
| `apps/web/src/lib/approvals.test.ts` | elsewhere | 110 | Simon / OSE, club, role, workflow |
| `tools/simon-convergence-inventory.mjs` | elsewhere | 109 | Simon / OSE, University, club, domain, region, resource, role, route name, term, workflow |
| `apps/web/src/lib/policies.ts` | elsewhere | 103 | Simon / OSE, University, club, domain, role |
| `apps/web/scripts/deliverables-data.mjs` | elsewhere | 93 | Simon / OSE, club, role |
| `apps/system-studio/src/lib/aws/certificates.test.ts` | elsewhere | 87 | Simon / OSE, account, domain, region, resource |
| `apps/web/src/lib/rbac.test.ts` | permission checks | 85 | Simon / OSE, club, role, workflow |
| `apps/web/src/lib/rbac.ts` | permission checks | 84 | Simon / OSE, club, role, workflow |
| `apps/web/scripts/generate-roster.mjs` | elsewhere | 82 | Simon / OSE, club, role, term |
| `packages/provisioning/src/provider-packs.ts` | elsewhere | 82 | domain, workflow |
| `apps/web/src/lib/search.test.ts` | elsewhere | 77 | Simon / OSE, account, club, region, role, workflow |
| `packages/provisioning/src/catalogs.test.ts` | elsewhere | 77 | account, domain, region, resource, workflow |
| `apps/system-studio/e2e/aws-unknown-is-not-absent.spec.ts` | elsewhere | 75 | account, domain, region, resource, workflow |

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
- The derived vocabulary is read from `schema.prisma` on each side, because that is where both
  trees declare their roles and workflow states. A role or state that exists only as a bare
  TypeScript string union, and never in the schema, is not in the vocabulary — the probe would
  find it everywhere once it were declared, and until then this scan does not claim to.
- `domain-literal` prints the hostname it matched. A hostname is a public DNS name, not a
  credential, and every one this found is already committed in this repository — the CloudFront
  domain is in `README.md` and six workflows. Anything account-scoped is caught by
  `resource-identifier` or `aws-account-id` instead, and both of those mask.

