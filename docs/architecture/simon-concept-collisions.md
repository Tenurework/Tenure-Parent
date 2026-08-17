# Simon absorption — duplicate and colliding business concepts

**Generated** by `node tools/simon-convergence-inventory.mjs` from
`docs/architecture/simon-convergence-inventory.json`. Do not edit by hand — `tests/simon-convergence-inventory.test.mjs`
re-renders this file from the snapshot and reds on any difference.

Closes **SIMON-000-005**. Both repositories are read at the commits pinned by
`docs/architecture/simon-absorption-inventory.json`; the pilot is never cloned, checked out or pushed to
from here.

Three findings, kept apart because they are three claims of different strength. Two are
decided by comparing two lists. The third is a similarity metric proposing candidates, labelled
`CANDIDATE` in every row, with its threshold printed so the list can be reproduced and argued
with.


Observed 2026-08-17. 217 source modules and 697 target modules declare at least one export; 184 pairs at the same path export exactly the same names.

## Same name, different shape — DECIDED

| Module | Source | Target | Same path | Only in source | Only in target |
| --- | --- | --- | --- | --- | --- |
| `AIProvider.tsx` | `apps/web/src/components/ai/AIProvider.tsx` | `apps/web/src/components/ai/AIProvider.tsx` | yes | — | `AIScope` `AIScopeAnchor` `AIScopeAnchorInput` |
| `Badge.tsx` | `apps/web/src/components/ui/Badge.tsx` | `apps/web/src/components/ui/Badge.tsx` | yes | — | `BADGE_VARIANT_STYLES` `BadgeVariant` |
| `Button.tsx` | `apps/web/src/components/ui/Button.tsx` | `apps/web/src/components/ui/Button.tsx` | yes | — | `BUTTON_SIZES` `BUTTON_VARIANTS` |
| `Overlay.tsx` | `apps/web/src/components/ui/Overlay.tsx` | `apps/web/src/components/ui/Overlay.tsx` | yes | — | `PopoverDialog` |
| `SankeyChart.tsx` | `apps/web/src/components/charts/SankeyChart.tsx` | `apps/web/src/components/charts/SankeyChart.tsx` | yes | — | `SANKEY_LIMITS` `SankeyLayout` `SankeyPositionedNode` `SankeyRibbon` `computeLayout` `layerCapacity` |
| `SideNav.tsx` | `apps/web/src/components/shell/SideNav.tsx` | `apps/web/src/components/shell/SideNav.tsx` | yes | — | `NavItemView` `NavSectionView` |
| `actions.ts` | `apps/web/src/app/(app)/actions.ts` | `apps/web/src/app/(app)/actions.ts` | yes | — | `switchTenantAction` |
| `actions.ts` | `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` | `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` | yes | `deleteLedgerEntry` | `reverseLedgerEntry` |
| `ai.ts` | `apps/web/src/lib/ai.ts` | `apps/web/src/lib/ai.ts` | yes | — | `AiCompleteOptions` |
| `approvals-sla.ts` | `apps/web/src/lib/approvals-sla.ts` | `apps/web/src/lib/approvals-sla.ts` | yes | — | `PENDING_STATES` |
| `approvals.ts` | `apps/web/src/lib/approvals.ts` | `apps/web/src/lib/approvals.ts` | yes | `canViewApproval` | `APPROVAL_DIGEST_FIELDS` `APPROVAL_DIGEST_MISMATCH_REASON` `ApprovalAuthority` `ApprovalMoney` `ApprovalPayloadSubject` `NO_STANDING_DECLARATIONS` `approvalAuthorityFor` `approvalDigest` `approvalMoney` `approvalSubmissionKey` `decisionControl` `exceedsApprovalThreshold` |
| `calendar-data.ts` | `apps/web/src/lib/calendar-data.ts` | `apps/web/src/lib/calendar-data.ts` | yes | — | `calendarSelectorFor` `calendarTokenEpochFor` `eventIdOfOccurrence` |
| `calendar-sync.ts` | `apps/web/src/lib/calendar-sync.ts` | `apps/web/src/lib/calendar-sync.ts` | yes | `CalendarSyncProvider` `calendarSync` `setCalendarSyncProvider` | `CALENDAR_TOKEN_MAX_AGE_MS` `CalendarTokenClaims` `calendarTokenSubject` |
| `calendar.ts` | `apps/web/src/lib/calendar.ts` | `apps/web/src/lib/calendar.ts` | yes | — | `CONFLICT_RULES` `ConflictInputs` `ConflictRule` `ConflictRuleSpec` `explainConflict` `isBlockingConflict` |
| `context.ts` | `apps/web/src/lib/tenancy/context.ts` | `apps/web/src/lib/tenancy/context.ts` | yes | — | `TENANT_PURPOSES` `TenantPurpose` `currentEnvironment` `isNextControlFlowError` `isNextNavigationThrow` `isTenantPurpose` |
| `eslint.config.mjs` | `apps/web/eslint.config.mjs` | `apps/web/eslint.config.mjs` | yes | — | `DESIGN_TOKEN_EXCEPTIONS` `DESIGN_TOKEN_RULES` `assertOneImportBoundary` `deprecatedImportPaths` `deprecatedNamesFrom` `designTokenConfigs` `lintToday` |
| `finance.ts` | `apps/web/src/lib/finance.ts` | `apps/web/src/lib/finance.ts` | yes | — | `FinanceIntegrity` `FinanceIntegrityLine` `IntegrityLineInput` `IntegrityPostingInput` `LedgerDisclosure` `MixedCurrencyError` `PortfolioClub` `PortfolioClubInput` `PortfolioRollUp` `financeIntegrity` `formatCentsIn` `ledgerDisclosure` |
| `icons.tsx` | `apps/web/src/components/ui/icons.tsx` | `apps/web/src/components/ui/icons.tsx` | yes | — | `RowsComfortable` `RowsCompact` |
| `index.ts` | `apps/web/src/components/charts/index.ts` | `apps/web/src/components/charts/index.ts` | yes | — | `ChartFrame` `csvCell` `tableFromSeries` `toCsv` |
| `knowledge-card.ts` | `apps/web/src/lib/schemas/knowledge-card.ts` | `apps/web/src/lib/schemas/knowledge-card.ts` | yes | `CreatableCardType` `CreatableCardTypeEnum` `isRetiredCardType` | — |
| `palette.ts` | `apps/web/src/components/charts/palette.ts` | `apps/web/src/components/charts/palette.ts` | yes | — | `slotsForKeys` |
| `rbac.ts` | `apps/web/src/lib/rbac.ts` | `apps/web/src/lib/rbac.ts` | yes | `isFinanceRole` | `OrgRef` `OrgWriteTarget` `acceptsWrites` `carriesFinanceAuthority` `decideFinanceAction` |
| `s3.ts` | `apps/web/src/lib/s3.ts` | `apps/web/src/lib/s3.ts` | yes | — | `fileRef` |
| `search-data.ts` | `apps/web/src/lib/search-data.ts` | `apps/web/src/lib/search-data.ts` | yes | — | `loadInteractiveSearchCorpus` |
| `search.ts` | `apps/web/src/lib/search.ts` | `apps/web/src/lib/search.ts` | yes | — | `RetrievalVisibility` `RetrievedRow` `SENSITIVITY_LEVELS` `Sensitivity` `WithheldMatch` `authorizeRetrieved` `sensitivityRank` `verifyCitations` `withheldMatches` |
| `tenant-scope.ts` | `apps/web/src/lib/tenant-scope.ts` | `apps/web/src/lib/tenant-scope.ts` | yes | — | `ACTING_INSTITUTION_COOKIE` `ActingInstitution` `actingInstitutionChoice` `actingInstitutions` `chooseActingInstitution` |

## One identifier, two declaration kinds — DECIDED

| Symbol | Source kind | Source | Target kind | Target |
| --- | --- | --- | --- | --- |
| `ButtonProps` | interface | `apps/web/src/components/ui/Button.tsx` | type | `apps/system-studio/src/components/md3/Button.tsx` |
| `Capability` | interface | `apps/web/src/lib/admin/capabilities.ts` | type | `apps/system-studio/src/lib/aws/capabilities.ts` |
| `DashboardLine` | type | `apps/web/src/components/finance/FinanceDashboard.tsx` | interface | `apps/system-studio/src/lib/aws/dashboards.ts` |
| `TabItem` | function | `apps/web/src/components/ui/Tabs.tsx` | interface | `apps/system-studio/src/components/md3/Tabs.tsx` |

## Different names, overlapping shape — CANDIDATE

Differently-named module pairs, each side exporting at least 4 names of its own, that share Jaccard ≥ 0.6 of them: 1. The 1 strongest are below, and the full list is in the snapshot. **Nothing here is decided** — a metric cannot know whether two modules are one concept.

Framework-dictated names are excluded from the metric and only from the metric: `DELETE` `GET` `HEAD` `OPTIONS` `PATCH` `POST` `PUT` `default` `dynamic` `dynamicParams` `fetchCache` `generateMetadata` `generateStaticParams` `metadata` `middleware` `revalidate` `runtime` `viewport`. Every Next.js page exports `default`, so leaving them in scored unrelated pages at 1.0 for agreeing about a framework contract. 2 ordered pairs collapse to 1 once a pair carried by both trees is counted once.

| Jaccard | Source | Target | Shared exports |
| --- | --- | --- | --- |
| 0.833 | `apps/web/scripts/generate-roster.mjs` | `apps/web/scripts/roster-data.sample.mjs` | `ADVISORS` `CURRENT_TERM` `PRIOR_TERM` `ROSTER` `VACANT_LABEL` |

## Honest limits

- The export scan is textual, like the baseline generator’s import scan. A name produced by a
  macro, a barrel re-export chain or a runtime assignment is invisible to it.
- The two repositories share history, so most same-named modules ARE the same module. That is
  why the decided tables report only the pairs that differ, and why the identical count is
  printed above rather than as rows.
- A Jaccard candidate is a question, not an answer. Adjudicating one belongs to SIMON-010-001,
  which selects the canonical implementation for each shared capability.

