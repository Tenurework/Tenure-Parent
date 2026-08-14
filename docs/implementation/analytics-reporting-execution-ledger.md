# Enterprise Analytics, Reporting and Visualization Cloud — execution ledger

Every `ANL-*` requirement stated by `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`.

Seeded by `tools/import-requirements.mjs`. **Every entry is `FAIL` and
unchecked**, which is the truthful starting state: import is not progress. A
requirement becomes `PASS` when somebody builds it, proves it by mutation, and
records the evidence here — never because a script wrote a row for it.

Before this file existed these requirements were in no execution document at
all. They were not queued, not counted and not failing; they were invisible, and
invisible reads exactly like done. `tests/architecture/document-graph.test.mjs`
ratchets that number downward and it may only shrink.

Statuses: `PASS` · `FAIL` · `BLOCKED_EXTERNAL` · `NOT_APPLICABLE`. There is no
`PARTIAL` and no `BLOCKED_ARCHITECTURE` — `tools/loop/next-batch.mjs` decides on
`PASS`, `BLOCKED_EXTERNAL` and `NOT_APPLICABLE` only, so any other word reads as
undecided and returns the item to the queue every tick, forever. An unfinished
requirement is `FAIL` if the rest can be built now, and `BLOCKED_EXTERNAL` — naming
the commands or the ADR that would unblock it — if it cannot.

- [x] **ANL-000-001** — Inventory every dashboard/report/chart/client-side metric and classify source/owner/truth.
  - Status: PASS
  - Reason: The inventory is derived, not written. `tools/anl-analytics-inventory.mjs` scans
    `apps/web/src` and `apps/system-studio/src` and emits 61 artefacts into
    `docs/architecture/anl-analytics-inventory.json` — 22 analytics surfaces, 22 chart-kit modules,
    8 metric modules, 7 chart panels, 7 client-side metrics, 2 metric endpoints — recording for each
    the literal tokens that classified it, so any verdict can be re-checked by hand. `owner` is
    joined from `tools/ownership-map.mjs` rather than re-decided, so it cannot drift from the
    ownership map CI already guards. `docs/architecture/anl-analytics-inventory.md` carries the half
    a machine cannot decide — which rows each number comes from, and its truth class from a fixed
    six-word vocabulary — and the guard holds the two to set equality in both directions.
  - Code: `tools/anl-analytics-inventory.mjs`, `docs/architecture/anl-analytics-inventory.json`,
    `docs/architecture/anl-analytics-inventory.md`
  - Tests: `tests/architecture/anl-analytics-inventory.test.mjs` — 9 tests, run under
    `npm run test:platform` (bare `node --test`, no TypeScript). Floors included so an empty
    derivation cannot pass: at least 55 artefacts, every one of the six kinds non-empty, both apps
    represented, at least 4 distinct truth classes used.
  - Evidence: 4 mutations, 4 caught, each restored and re-run green.
    (1) deleted the `ChartFrame.tsx` entry from the committed JSON → `not ok 1 - the committed
    inventory is what the tree derives, byte for byte`; (2) changed one cited path to
    `charts/GaugeChart.tsx`, a file that does not exist → `not ok 5` and `not ok 6 - the
    classification invents nothing`; (3) deleted the `Sparkline.tsx` row from the classification →
    `not ok 5 - the classification covers exactly the artefacts the tree derives`; (4) invented the
    truth class `near-live` → `not ok 7 - the classification uses only the truth vocabulary it
    declares`. Determinism verified directly: output contains no CR, no path separator backslash
    (the one backslash is a JSON escape inside the rules block), ids sorted, exactly one trailing
    newline; `node tools/anl-analytics-inventory.mjs --check` re-derives clean.
  - Limitation, stated in the document: the token rules are a floor, not a proof of "every".
    `apps/system-studio/src/app/page.tsx` and `apps/system-studio/src/app/platform/security/page.tsx`
    count with `.filter(...).length`, too common a shape to classify on; both are carried by hand and
    a test asserts they still exist.

- [x] **ANL-000-002** — Remove duplicate/untraceable calculations and false real-time labels.
  - Status: PASS
  - Reason: The inventory above found the duplicates. "Approvals awaiting decision" was decided in
    four places, each naming the statuses itself — `/reports`, `/dashboard`, `/admin` and
    `/api/reports/pulse`, the last of which overwrites the first fifteen seconds after render.
    "Median time to decision" was computed **twice on the same page**, over different populations,
    through formatting ladders that disagreed at the day boundary: five days rendered `120.0 h` in
    the stat tile and `5.0 days` in the panel beneath it, under the same words. A third population —
    drafts and returned requests included — was rendered under the same word "pending" on
    `/orgs/[slug]/impact` and `/orgs/[slug]/handoff`. All are now defined once in
    `apps/web/src/lib/analytics/metrics.ts` and imported by all six callers; the panel and the tile
    now state which population each measured. The false real-time label: `/orgs/[slug]/handoff` said
    "live from the seat lifecycle" over four tiles read once at render that never refresh — §19 names
    calling stale data real time — and now says when they were read.
  - Code: `apps/web/src/lib/analytics/metrics.ts` (new), and its six callers —
    `apps/web/src/app/(app)/reports/page.tsx`, `apps/web/src/app/(app)/dashboard/page.tsx`,
    `apps/web/src/app/(app)/admin/page.tsx`, `apps/web/src/app/(app)/orgs/[slug]/impact/page.tsx`,
    `apps/web/src/app/(app)/orgs/[slug]/handoff/page.tsx`,
    `apps/web/src/app/api/reports/pulse/route.ts`,
    `apps/web/src/components/charts/panels/ReportsAnalytics.tsx`.
  - Tests: `tests/architecture/anl-single-metric-definition.test.mjs` — 7 tests under
    `npm run test:platform`; it scans the DERIVED inventory rather than a typed list of files, so it
    grows with the analytics surface. `apps/web/src/lib/analytics/metrics.test.ts` — 10 tests under
    `npm run test --workspace apps/web -- --ci` (jest).
  - Evidence: 6 mutations, 6 caught, each restored and re-run green.
    (1) re-inlined `["PENDING_PRESIDENT", "PENDING_OSE"]` in the pulse endpoint → `not ok 3 - no
    analytics artefact writes out the open-approval status set itself`; (2) the same on `/admin` →
    same failure; (3) re-inlined the four-status array on `/handoff` → `not ok 4 - no analytics
    artefact writes out the undecided-approval status set itself`; (4) restored the panel's own
    `Math.floor(sorted.length / 2)` and its hour-only ladder → `not ok 5 - no analytics artefact
    carries a second median or a second duration ladder`; (5) restored `subtitle="… live from the
    seat lifecycle."` → `not ok 6 - no analytics surface calls its numbers live without showing how
    fresh they are`; (6) removed the day rung from `formatDuration` → jest `2 failed, 8 passed`,
    reporting `Expected: "5.0 days" / Received: "120.0 h"`, which is the original defect reproduced.
    `npx tsc --noEmit -p apps/web/tsconfig.json` exits 0; `npm run lint --workspace apps/web` reports
    no error on any changed file.
  - Shared-file note, disclosed rather than hidden: `tools/ownership-map.mjs` gained one prefix
    (`apps/web/src/lib/analytics/`) in the `reporting` domain, because
    `tests/architecture/ownership.test.mjs` fails on an unowned source file and its own error message
    instructs that edit. Nothing else in that file changed.
    `docs/architecture/ownership.md` is stale and was NOT regenerated: it records 758 files against
    880 in the tree, 120 of which are other domains' in-flight work this wave, so regenerating it
    would bake in half-finished trees. That is a wave-level regeneration, not this requirement's.

- [ ] **ANL-000-003** — Implement canonical semantic/metric/report/visualization objects and versions.
  - Status: BLOCKED_EXTERNAL
  - Reason: The Bible §3 names 26 canonical objects and §4 requires that "metric changes create new
    versions and impact analysis". None of the 26 exists: `grep -n "^model " apps/web/prisma/schema.prisma`
    returns 52 models and not one of `SemanticModel`, `SemanticEntity`, `Dimension`, `Hierarchy`,
    `Measure`, `MetricDefinition`, `MetricVersion`, `Dataset`, `DatasetSnapshot`, `QueryDefinition`,
    `SavedView`, `ReportDefinition`, `ReportVersion`, `DashboardDefinition`, `VisualizationDefinition`,
    `ChartAnnotation`, `AlertDefinition`, `Subscription`, `DistributionRun`, `ExportArtifact`,
    `NarrativeDefinition`, `DataQualityRule`, `DataQualityResult`, `LineageEdge`,
    `FreshnessObservation` or `AnalyticsEvidence`. A version with effective dates that survives a
    deploy is a row, not a constant, so this cannot be completed in code alone — and the file it
    needs, `apps/web/prisma/schema.prisma`, is on this wave's do-not-edit list along with
    `apps/web/src/lib/db.ts`, which every reader of those tables would have to go through.
  - Unblocked by: adding the 26 models with tenant scoping to `apps/web/prisma/schema.prisma`, then
    `cd apps/web && npx prisma migrate dev --name analytics-semantic-objects` and
    `npx prisma migrate deploy` against the Postgres in `CLAUDE.md`. Read
    `docs/architecture/REVIEW-FINDINGS.md` first — the tenancy and RLS defects it names bind these
    tables, and `SavedView`, `Subscription` and `ExportArtifact` each carry a recipient-time
    authorization requirement (ANL-030-003) that the review's effective-permission findings govern.
  - Evidence: `apps/web/src/lib/analytics/metrics.ts` from ANL-000-002 is the code-only half — one
    governed definition per shared metric — and it says in its own header that it is deliberately not
    a semantic-model registry. Naming it as progress here would be the "a type declares it" failure.
    Not started, not partially claimed.

- [ ] **ANL-000-004** — Import every `ANL-*` item into the canonical ledger.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-010-001** — Implement conformed dimensions, effective dating, measures and metric certification.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-010-002** — Implement projections/snapshots, quality, freshness, lineage and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-010-003** — Enforce tenant/row/column/cell/domain authorization in query/cache/export/alert/Relay.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-010-004** — Implement query budgets, workload isolation and safe self-service.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-020-001** — Implement shared ChartFrame and chart grammar from Section 7.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-020-002** — Implement domain minimum visualizations and source drill-through.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-020-003** — Implement cross-filter, compare, annotations, saved views, alerts and action handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-020-004** — Provide accessible tables/summaries, keyboard, color-vision, zoom and responsive alternatives.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-020-005** — Pass visual-regression, correctness and large-data performance tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-030-001** — Implement governed report/dashboard authoring and publication.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-030-002** — Implement transactional, financial, management, analytical and executive report families.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-030-003** — Implement secure subscriptions/bursting/exports with recipient-time authorization.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-030-004** — Implement Relay narratives with citations, human review and signed version.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-040-001** — Maintain benchmark scenarios for SAP/Oracle/Workday/Salesforce/Rippling/NetSuite/Intuit Enterprise Suite.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-040-002** — Implement and evidence the Intuit comparison in Section 14.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-040-003** — Pass all twelve E2E scenarios with zero unexplained source/report variance.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-040-004** — Instrument best-system scorecard baselines/targets/results.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-040-005** — Publish exact metric/report/analytics limitations and blocked sources.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-GATE-000** — Metrics and reports have one governed definition and source.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-GATE-010** — Analytics is accurate, isolated and scalable.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-GATE-020** — Charts are high-end, truthful, accessible and actionable.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-GATE-030** — Reporting works from operational detail to executive/board outcomes.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-GATE-040** — “Best analytics” is claimed only for measured released scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented
