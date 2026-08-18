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


Observed 2026-08-18. 217 source modules and 798 target modules declare at least one export; 184 pairs at the same path export exactly the same names.

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
| `finance.ts` | `apps/web/src/lib/finance.ts` | `apps/web/src/lib/finance.ts` | yes | — | `FinanceIntegrity` `FinanceIntegrityLine` `IntegrityLineInput` `IntegrityPostingInput` `LedgerDisclosure` `LedgerLineInput` `LedgerTieOut` `LedgerTieOutCurrency` `MixedCurrencyError` `PortfolioClub` `PortfolioClubInput` `PortfolioRollUp` |
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

## The same declared name, different members — DECIDED

The export tables above read JS/TS modules only. This one reads the two Prisma schemas: 60 declarations on the source side, 76 here, 48 of them identical member-for-member. "Same name, different semantics" in a data model is a schema fact, and no reading of `export` statements finds it.

| Declaration | Name | Source | Target | Only in source | Only in target |
| --- | --- | --- | --- | --- | --- |
| enum | `LedgerKind` | `apps/web/prisma/schema.prisma`:739 | `apps/web/prisma/schema.prisma`:926 | — | `RECEIPT` `REVERSAL` |
| model | `ApprovalRequest` | `apps/web/prisma/schema.prisma`:380 | `apps/web/prisma/schema.prisma`:475 | — | `fundsFlowExceptions` `preparedById` |
| model | `ApprovalStep` | `apps/web/prisma/schema.prisma`:405 | `apps/web/prisma/schema.prisma`:520 | — | `authority` `configChecksum` `configRevision` `evidenceDocument` `evidenceDocumentId` |
| model | `AuditEvent` | `apps/web/prisma/schema.prisma`:872 | `apps/web/prisma/schema.prisma`:1346 | — | `mode` |
| model | `Document` | `apps/web/prisma/schema.prisma`:581 | `apps/web/prisma/schema.prisma`:756 | — | `approvalStepEvidence` |
| model | `Event` | `apps/web/prisma/schema.prisma`:438 | `apps/web/prisma/schema.prisma`:611 | — | `ledgerEntries` |
| model | `Institution` | `apps/web/prisma/schema.prisma`:58 | `apps/web/prisma/schema.prisma`:58 | — | `connectionLaunchTokens` `inboxEvents` `modelUsage` `outboxEvents` `serving` |
| model | `InstitutionMembership` | `apps/web/prisma/schema.prisma`:87 | `apps/web/prisma/schema.prisma`:113 | — | `effectiveFrom` `effectiveUntil` `status` `statusReason` |
| model | `LedgerEntry` | `apps/web/prisma/schema.prisma`:749 | `apps/web/prisma/schema.prisma`:947 | — | `account` `allocations` `currency` `effectiveAt` `event` `eventId` `fundCode` `institutionId` `journalId` `postedBySeat` `postedBySeatId` `reversalReason` |
| model | `Organization` | `apps/web/prisma/schema.prisma`:134 | `apps/web/prisma/schema.prisma`:181 | — | `fundsFlowConfigs` `seats` |
| model | `Role` | `apps/web/prisma/schema.prisma`:188 | `apps/web/prisma/schema.prisma`:237 | `positionCode` `positionNote` `seatOrder` `vacancyNote` | `seat` `templateKey` |
| model | `User` | `apps/web/prisma/schema.prisma`:101 | `apps/web/prisma/schema.prisma`:139 | — | `calendarTokenEpoch` `connectionLaunchTokens` |

## Declared on one side only — DECIDED

0 declarations exist in the pilot and not here; 16 exist here and not in the pilot. A concept only one side has is either an absorption item or a rename, which is what the candidate table below is for.

| Side | Declaration | Name | Declared at | Members |
| --- | --- | --- | --- | --- |
| target only | enum | `LedgerSide` | `apps/web/prisma/schema.prisma`:921 | 2 |
| target only | enum | `MembershipStatus` | `apps/web/prisma/schema.prisma`:107 | 3 |
| target only | enum | `ReceiptSource` | `apps/web/prisma/schema.prisma`:1061 | 3 |
| target only | model | `ConflictDeclaration` | `apps/web/prisma/schema.prisma`:555 | 8 |
| target only | model | `ConnectionLaunchToken` | `apps/web/prisma/schema.prisma`:1654 | 13 |
| target only | model | `ExternalReference` | `apps/web/prisma/schema.prisma`:1100 | 12 |
| target only | model | `InboxEvent` | `apps/web/prisma/schema.prisma`:1564 | 6 |
| target only | model | `ModelUsageMeter` | `apps/web/prisma/schema.prisma`:1601 | 9 |
| target only | model | `OutboxEvent` | `apps/web/prisma/schema.prisma`:1506 | 21 |
| target only | model | `PaymentsFundsFlowConfig` | `apps/web/prisma/schema.prisma`:1222 | 18 |
| target only | model | `ProviderBalanceTransaction` | `apps/web/prisma/schema.prisma`:1155 | 13 |
| target only | model | `ProviderEventReceipt` | `apps/web/prisma/schema.prisma`:1190 | 11 |
| target only | model | `ReceiptAllocation` | `apps/web/prisma/schema.prisma`:1072 | 11 |
| target only | model | `Recusal` | `apps/web/prisma/schema.prisma`:576 | 9 |
| target only | model | `Seat` | `apps/web/prisma/schema.prisma`:276 | 16 |
| target only | model | `Settlement` | `apps/web/prisma/schema.prisma`:1130 | 11 |

## One concept, two names — CANDIDATE

The half of this requirement a similarity score over shared export NAMES structurally cannot answer: a rename has no shared name. Two signals are required instead — the two names must share a word of at least 5 letters, and their shapes must overlap. For schema declarations that means member Jaccard ≥ 0.3; for module exports it means the two names live in the same module at the same path, one on each side.

Two shared words is the **strong** signal and one is **weak**: `deleteLedgerEntry` and
`reverseLedgerEntry` share `ledger` and `entry` and really are one concept under two names,
while two exports that share only `approval` are usually two things that both mention
approvals. Strong rows are listed in full; weak ones are counted and sampled, because a
ranked single number is what made the first version of this table useless.

Schema declarations — 0 strong, 2 weak:

| Strength | Declaration | Source name | Target name | Shared words | Member Jaccard | Shared members |
| --- | --- | --- | --- | --- | --- | --- |
| weak | enum | `ApprovalStatus` | `EventStatus` | `status` | 0.333 | `APPROVED` `CANCELLED` `DRAFT` |
| weak | model | `Budget` | `BudgetLine` | `budget` | 0.333 | `academicYear` `createdAt` `currency` `id` `organization` `organizationId` `updatedAt` |

Module exports, same path, one name on each side — 1 strong, 21 weak:

| Strength | Module | Path | Source export | Target export | Shared words |
| --- | --- | --- | --- | --- | --- |
| strong | `actions.ts` | `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` | `deleteLedgerEntry` | `reverseLedgerEntry` | `entry` `ledger` |
| weak | `approvals.ts` | `apps/web/src/lib/approvals.ts` | `canViewApproval` | `APPROVAL_DIGEST_FIELDS` | `approval` |
| weak | `approvals.ts` | `apps/web/src/lib/approvals.ts` | `canViewApproval` | `APPROVAL_DIGEST_MISMATCH_REASON` | `approval` |
| weak | `approvals.ts` | `apps/web/src/lib/approvals.ts` | `canViewApproval` | `ApprovalAuthority` | `approval` |
| weak | `approvals.ts` | `apps/web/src/lib/approvals.ts` | `canViewApproval` | `ApprovalMoney` | `approval` |
| weak | `approvals.ts` | `apps/web/src/lib/approvals.ts` | `canViewApproval` | `ApprovalPayloadSubject` | `approval` |
| weak | `approvals.ts` | `apps/web/src/lib/approvals.ts` | `canViewApproval` | `approvalAuthorityFor` | `approval` |

## Different names, overlapping shape — CANDIDATE

Differently-named module pairs, each side exporting at least 4 names of its own, that share Jaccard ≥ 0.6 of them: 1. The 1 strongest are below, and the full list is in the snapshot. **Nothing here is decided** — a metric cannot know whether two modules are one concept.

Framework-dictated names are excluded from the metric and only from the metric: `DELETE` `GET` `HEAD` `OPTIONS` `PATCH` `POST` `PUT` `default` `dynamic` `dynamicParams` `fetchCache` `generateMetadata` `generateStaticParams` `metadata` `middleware` `revalidate` `runtime` `viewport`. Every Next.js page exports `default`, so leaving them in scored unrelated pages at 1.0 for agreeing about a framework contract. 2 ordered pairs collapse to 1 once a pair carried by both trees is counted once.

| Jaccard | Source | Target | Shared exports |
| --- | --- | --- | --- |
| 0.833 | `apps/web/scripts/generate-roster.mjs` | `apps/web/scripts/roster-data.sample.mjs` | `ADVISORS` `CURRENT_TERM` `PRIOR_TERM` `ROSTER` `VACANT_LABEL` |

## Honest limits

- The export scan is textual, like the baseline generator’s import scan. A name produced by a
  macro, a barrel re-export chain or a runtime assignment is invisible to it.
- The schema comparison reads Prisma `model` and `enum` declarations. A concept that lives only
  in a raw SQL migration and never reaches the schema is not compared here, and a member list
  is a shape rather than a meaning: two enums can agree on every member and still be used for
  different things.
- A shared word is a hint, not a synonym. `deleteLedgerEntry` and `reverseLedgerEntry` share
  `ledger` and `entry` AND are genuinely one concept under two names; two other exports could
  share a noun and mean unrelated things. That is why every row here says CANDIDATE.
- The two repositories share history, so most same-named modules ARE the same module. That is
  why the decided tables report only the pairs that differ, and why the identical count is
  printed above rather than as rows.
- A Jaccard candidate is a question, not an answer. Adjudicating one belongs to SIMON-010-001,
  which selects the canonical implementation for each shared capability.

