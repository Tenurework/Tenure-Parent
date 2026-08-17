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


Observed 2026-08-17.

## The eight labels, and which of them this evidence can assign

| Label | Auto-assignable | Meaning here |
| --- | --- | --- |
| `PARENT_CANONICAL` | yes | the target holds this capability and every source path for it |
| `MERGE_REQUIRED` | yes | both sides hold it and the source has paths the target does not |
| `REIMPLEMENT_REQUIRED` | yes | the source holds it and the target’s probe matched nothing |
| `UNKNOWN` | yes | neither side matched, or the label needs a judgement this evidence cannot make |
| `SOURCE_SUPERIOR` | no — human adjudication | a quality judgement — never auto-assigned |
| `CONFIG_ONLY` | no — human adjudication | a judgement about intent — never auto-assigned |
| `DATA_ONLY` | no — human adjudication | a judgement about intent — never auto-assigned |
| `DEPRECATE_AFTER_PROOF` | no — human adjudication | requires the proof to exist first — never auto-assigned |

## Capability by capability

25 capabilities: MERGE_REQUIRED 2, PARENT_CANONICAL 23.

| Capability | Source | Target | Source-only | Disposition | Why | Source-only evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Frontend framework | 1 | 2 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Frontend routes (pages) | 37 | 58 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Frontend layouts | 3 | 4 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Frontend components | 73 | 143 | 2 | `MERGE_REQUIRED` | 2 source path(s) for this capability are absent from the target tree | `apps/web/src/components/brand/TenantBackdrop.tsx` `apps/web/src/components/brand/TenantSplash.tsx` |
| Styles | 1 | 24 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Design tokens / theme config | 1 | 2 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| HTTP API handlers | 20 | 29 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Backend services / domain libraries | 30 | 64 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Database engine (provisioned) | 2 | 2 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Database schema | 1 | 1 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Database migrations | 2 | 15 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Events / scheduled jobs | 2 | 6 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Queues | 1 | 1 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Identity and authentication | 3 | 9 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Authorization | 2 | 14 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Tenancy isolation | 5 | 9 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| File storage | 2 | 2 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Search | 3 | 3 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| AI | 3 | 3 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Outbound integrations (email) | 2 | 2 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Observability | 3 | 3 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Infrastructure as code | 20 | 36 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| Unit tests | 26 | 395 | 5 | `MERGE_REQUIRED` | 5 source path(s) for this capability are absent from the target tree | `apps/web/src/app/api/documents/_lib/content.test.ts` `apps/web/src/app/api/documents/_lib/mammoth-sanitize.test.ts` `apps/web/src/app/api/documents/_lib/sanitize.test.ts` `apps/web/src/lib/schemas/creatable-card-types.test.ts` `apps/web/src/lib/tenant/brand.test.ts` |
| End-to-end tests | 28 | 85 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |
| CI / deployment workflows | 12 | 18 | 0 | `PARENT_CANONICAL` | every source path for this capability is already present in the target tree at the same path | — |

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

- A capability disposition is computed from PATHS, not from behaviour. `PARENT_CANONICAL` here
  means the target tree holds every path the source probe matched — it does not mean the target
  implementation is as good, and it never claims to.
- The two repositories share history, which is why so many rows land on `PARENT_CANONICAL`:
  the parent was branched from the pilot, so most source paths are literally present here.
- `SOURCE_SUPERIOR`, `CONFIG_ONLY`, `DATA_ONLY` and `DEPRECATE_AFTER_PROOF` are never assigned
  by this generator, and the guard test asserts that. Assigning one is `SIMON-010-001`’s job.

