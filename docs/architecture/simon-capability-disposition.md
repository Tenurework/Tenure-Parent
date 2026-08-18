# Simon absorption — capability and package disposition

**Generated** by `node tools/simon-convergence-inventory.mjs` from
`docs/architecture/simon-convergence-inventory.json`. Do not edit by hand — `tests/simon-convergence-inventory.test.mjs`
re-renders this file from the snapshot and reds on any difference.

Closes **SIMON-000-006**. Both repositories are read at the commits pinned by
`docs/architecture/simon-absorption-inventory.json`; the pilot is never cloned, checked out or pushed to
from here.

Every row carries one label from the bible's own enumeration. Four of the eight labels are
assignable from a file-list comparison and four are not; the legend says which, and a row needing
a judgement this evidence cannot make is `UNKNOWN` with the reason printed rather than a guess
wearing a label.


Observed 2026-08-18.

## The eight labels, and which of them this evidence can assign

| Label | Auto-assignable | Meaning here |
| --- | --- | --- |
| `PARENT_CANONICAL` | yes | the target holds every source path for this capability AND the same content at each of them |
| `MERGE_REQUIRED` | yes | both sides hold it and the source has paths the target lacks, or shared paths whose content differs |
| `REIMPLEMENT_REQUIRED` | yes | the source holds it and the target’s probe matched nothing |
| `UNKNOWN` | yes | neither side matched, or the label needs a judgement this evidence cannot make |
| `SOURCE_SUPERIOR` | no — human adjudication | a quality judgement — never auto-assigned |
| `CONFIG_ONLY` | no — human adjudication | a judgement about intent — never auto-assigned |
| `DATA_ONLY` | no — human adjudication | a judgement about intent — never auto-assigned |
| `DEPRECATE_AFTER_PROOF` | no — human adjudication | requires the proof to exist first — never auto-assigned |

## Whether the target holds the source’s implementation, not just a file at the path

A disposition computed from path presence alone said `PARENT_CANONICAL` for a capability whose
content diverges — which for an absorption is wrong in the one direction that matters, because
it reads as "there is nothing to merge". Every path both trees carry and any capability probe
matches is therefore digested on both sides: 254 shared paths, 92
identical, **162 divergent**, 0 undetermined. Digest is
sha256 over LF-normalised text, first 16 hex digits; a line ending is not a divergence, and a path neither side would yield is
named rather than counted as agreement.

## Capability by capability

25 capabilities: MERGE_REQUIRED 24, PARENT_CANONICAL 1.

| Capability | Source | Target | Source-only | Shared | Divergent | Disposition | Why | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Frontend framework | 1 | 2 | 0 | 1 | 1 | `MERGE_REQUIRED` | every source path is present in the target tree, but 1 of 1 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/next.config.ts` |
| Frontend routes (pages) | 37 | 58 | 0 | 37 | 24 | `MERGE_REQUIRED` | every source path is present in the target tree, but 24 of 37 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/app/(app)/admin/approvals/page.tsx` `apps/web/src/app/(app)/admin/audit/page.tsx` `apps/web/src/app/(app)/admin/clubs/[slug]/page.tsx` `apps/web/src/app/(app)/admin/overrides/page.tsx` |
| Frontend layouts | 3 | 4 | 0 | 3 | 2 | `MERGE_REQUIRED` | every source path is present in the target tree, but 2 of 3 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/app/(app)/layout.tsx` `apps/web/src/app/layout.tsx` |
| Frontend components | 73 | 146 | 2 | 71 | 46 | `MERGE_REQUIRED` | 2 source path(s) for this capability are absent from the target tree, and 46 shared path(s) differ in content | `apps/web/src/components/brand/TenantBackdrop.tsx` `apps/web/src/components/brand/TenantSplash.tsx` `apps/web/src/components/CalendarFilters.tsx` `apps/web/src/components/CalendarSubscribe.tsx` `apps/web/src/components/CalendarTimeGrid.tsx` `apps/web/src/components/ClubCard.tsx` |
| Styles | 1 | 24 | 0 | 1 | 1 | `MERGE_REQUIRED` | every source path is present in the target tree, but 1 of 1 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/app/globals.css` |
| Design tokens / theme config | 1 | 2 | 0 | 1 | 1 | `MERGE_REQUIRED` | every source path is present in the target tree, but 1 of 1 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/tailwind.config.ts` |
| HTTP API handlers | 20 | 29 | 0 | 20 | 10 | `MERGE_REQUIRED` | every source path is present in the target tree, but 10 of 20 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/app/api/ai/chat/route.ts` `apps/web/src/app/api/ai/draft/route.ts` `apps/web/src/app/api/calendar/event/[id]/route.ts` `apps/web/src/app/api/calendar/ics/[token]/route.ts` |
| Backend services / domain libraries | 30 | 64 | 0 | 30 | 23 | `MERGE_REQUIRED` | every source path is present in the target tree, but 23 of 30 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/lib/ai.ts` `apps/web/src/lib/approvals-sla.ts` `apps/web/src/lib/approvals.ts` `apps/web/src/lib/auth.ts` |
| Database engine (provisioned) | 2 | 2 | 0 | 2 | 2 | `MERGE_REQUIRED` | every source path is present in the target tree, but 2 of 2 shared path(s) differ in content, so the target does not hold the source implementation | `infrastructure/terraform/elasticache.tf` `infrastructure/terraform/rds.tf` |
| Database schema | 1 | 1 | 0 | 1 | 1 | `MERGE_REQUIRED` | every source path is present in the target tree, but 1 of 1 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/prisma/schema.prisma` |
| Database migrations | 2 | 15 | 0 | 2 | 1 | `MERGE_REQUIRED` | every source path is present in the target tree, but 1 of 2 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/prisma/migrations/migration_lock.toml` |
| Events / scheduled jobs | 2 | 6 | 0 | 2 | 1 | `MERGE_REQUIRED` | every source path is present in the target tree, but 1 of 2 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/app/api/jobs/reminders/route.ts` |
| Queues | 1 | 1 | 0 | 1 | 0 | `PARENT_CANONICAL` | every source path for this capability is present in the target tree and all 1 shared path(s) are byte-identical after line-ending normalisation | — |
| Identity and authentication | 3 | 9 | 0 | 3 | 1 | `MERGE_REQUIRED` | every source path is present in the target tree, but 1 of 3 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/lib/auth.ts` |
| Authorization | 2 | 14 | 0 | 2 | 2 | `MERGE_REQUIRED` | every source path is present in the target tree, but 2 of 2 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/lib/admin/guard.ts` `apps/web/src/lib/rbac.ts` |
| Tenancy isolation | 5 | 9 | 0 | 5 | 3 | `MERGE_REQUIRED` | every source path is present in the target tree, but 3 of 5 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/lib/tenancy/context.ts` `apps/web/src/lib/tenancy/registry.ts` `apps/web/src/lib/tenant-scope.ts` |
| File storage | 2 | 2 | 0 | 2 | 1 | `MERGE_REQUIRED` | every source path is present in the target tree, but 1 of 2 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/lib/s3.ts` |
| Search | 3 | 3 | 0 | 3 | 3 | `MERGE_REQUIRED` | every source path is present in the target tree, but 3 of 3 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/app/api/search/route.ts` `apps/web/src/lib/search-data.ts` `apps/web/src/lib/search.ts` |
| AI | 3 | 3 | 0 | 3 | 3 | `MERGE_REQUIRED` | every source path is present in the target tree, but 3 of 3 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/app/api/ai/chat/route.ts` `apps/web/src/app/api/ai/draft/route.ts` `apps/web/src/lib/ai.ts` |
| Outbound integrations (email) | 2 | 2 | 0 | 2 | 1 | `MERGE_REQUIRED` | every source path is present in the target tree, but 1 of 2 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/src/lib/notify.ts` |
| Observability | 3 | 3 | 0 | 3 | 1 | `MERGE_REQUIRED` | every source path is present in the target tree, but 1 of 3 shared path(s) differ in content, so the target does not hold the source implementation | `infrastructure/terraform/cloudwatch.tf` |
| Infrastructure as code | 20 | 36 | 0 | 20 | 10 | `MERGE_REQUIRED` | every source path is present in the target tree, but 10 of 20 shared path(s) differ in content, so the target does not hold the source implementation | `infrastructure/terraform/alb.tf` `infrastructure/terraform/cloudfront.tf` `infrastructure/terraform/cloudwatch.tf` `infrastructure/terraform/ecs.tf` |
| Unit tests | 26 | 467 | 5 | 21 | 17 | `MERGE_REQUIRED` | 5 source path(s) for this capability are absent from the target tree, and 17 shared path(s) differ in content | `apps/web/src/app/api/documents/_lib/content.test.ts` `apps/web/src/app/api/documents/_lib/mammoth-sanitize.test.ts` `apps/web/src/app/api/documents/_lib/sanitize.test.ts` `apps/web/src/lib/schemas/creatable-card-types.test.ts` `apps/web/src/lib/tenant/brand.test.ts` `apps/web/src/lib/approvals-sla.test.ts` `apps/web/src/lib/approvals.test.ts` `apps/web/src/lib/calendar-permissions.test.ts` `apps/web/src/lib/calendar.test.ts` |
| End-to-end tests | 28 | 85 | 0 | 28 | 10 | `MERGE_REQUIRED` | every source path is present in the target tree, but 10 of 28 shared path(s) differ in content, so the target does not hold the source implementation | `apps/web/e2e/admin-console.spec.ts` `apps/web/e2e/app.spec.ts` `apps/web/e2e/calendar.spec.ts` `apps/web/e2e/handoff.spec.ts` |
| CI / deployment workflows | 12 | 19 | 0 | 12 | 12 | `MERGE_REQUIRED` | every source path is present in the target tree, but 12 of 12 shared path(s) differ in content, so the target does not hold the source implementation | `.github/workflows/ci.yml` `.github/workflows/custom-domain.yml` `.github/workflows/db-recovery.yml` `.github/workflows/debug-logs.yml` |

## Package by package

19 workspaces across both repositories: MERGE_REQUIRED 1, PARENT_CANONICAL 18.

| Package | Source manifest | Target manifest | Disposition | Why | What is missing |
| --- | --- | --- | --- | --- | --- |
| `tenure` | `apps/web/package.json` | `apps/web/package.json` | `MERGE_REQUIRED` | the target manifest is missing 0 script(s) and 2 dependency(ies) the source declares | `@types/sanitize-html` `sanitize-html` |
| `tenure-parent` | `package.json` | `package.json` | `PARENT_CANONICAL` | the target manifest declares every script and dependency the source one does | — |
| `@tenure/audit` | — | `packages/audit/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/authorization` | — | `packages/authorization/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/blueprints` | — | `blueprints/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/configuration` | — | `packages/configuration/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/contracts` | — | `packages/contracts/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/finops` | — | `packages/finops/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/identity` | — | `packages/identity/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/metadata` | — | `packages/metadata/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/module-runtime` | — | `packages/module-runtime/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/modules` | — | `modules/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/organization-model` | — | `packages/organization-model/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/payments` | — | `packages/payments/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/platform-config` | — | `packages/platform-config/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/provisioning` | — | `packages/provisioning/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/releases` | — | `packages/releases/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/system-studio` | — | `apps/system-studio/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |
| `@tenure/workflow` | — | `packages/workflow/package.json` | `PARENT_CANONICAL` | a target-only workspace; the source has nothing to merge | — |

## Honest limits

- A capability disposition is computed from PATHS and from CONTENT EQUALITY, not from behaviour.
  `PARENT_CANONICAL` here means the target tree holds every path the source probe matched and
  the same bytes at each of them. `MERGE_REQUIRED` on a content divergence does not say which
  side is better or that anything is missing — it says the two files are not the same file, so
  the question is open. Which side wins is `SIMON-010-001`.
- Content equality is a digest comparison, so it cannot tell a reformat from a rewrite. A
  divergence is a reason to read the diff, not a size.
- The two repositories share history, which is why every capability has shared paths at all:
  the parent was branched from the pilot, so most source paths are literally present here. What
  the digests show is that being present is not the same as being unchanged.
- `SOURCE_SUPERIOR`, `CONFIG_ONLY`, `DATA_ONLY` and `DEPRECATE_AFTER_PROOF` are never assigned
  by this generator, and the guard test asserts that. Assigning one is `SIMON-010-001`’s job.

