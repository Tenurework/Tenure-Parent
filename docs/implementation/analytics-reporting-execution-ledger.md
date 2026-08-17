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

- [x] **ANL-000-004** — Import every `ANL-*` item into the canonical ledger.
  - Status: PASS
  - Reason: All 27 `ANL-*` requirements the Bible states have a row in this ledger, and — the half
    that matters and that the global ratchet cannot see — no OTHER ledger claims one, no row is
    invented, no row is stated twice, and the generated registry routes every one of the 27 back to
    this file. Those four are the ways an import passes while the work is invisible: a row filed
    under another domain counts as imported while the owning domain has nothing to work; an invented
    id inflates a denominator nobody re-derives; a duplicated id is two statuses of which
    `tools/loop/next-batch.mjs` reads whichever the parser saw last; and a null `ledger:` field is a
    decision a reader of the register cannot find. The requirement says "the CANONICAL ledger", so
    the `ledger:` field is checked directly rather than the mere presence of a row somewhere.
  - Code: `tests/architecture/anl-requirements-are-imported.test.mjs` is the whole deliverable —
    this requirement is a property of the repository, and the artefact that closes it is the guard
    that keeps it true. It reads the Bible at the canonical path
    `docs/architecture/architecture-document-graph.yaml` records for it, never at a hard-coded
    string, so a rename the graph knows about cannot make it pass from a file the graph does not
    consider authoritative. The 27 ids and the ledger rows both come from
    `tools/document-graph.mjs` (`requirementsIn`, `ledgerStatuses`, `buildRegistry`) rather than
    from a second parser — the shape its INT and WRK siblings record as the defect to avoid.
  - Caller: `tools/run-platform-tests.mjs` discovers every `tests/**/*.test.mjs` and runs it under
    `npm run test:platform`, which is in `npm run verify` and in CI. Nothing has to import it.
  - Tests: 9 tests, all passing. `node --test tests/architecture/anl-requirements-are-imported.test.mjs`
    → `# pass 9 # fail 0`. One of the nine exercises the row detector against an assembled sample
    (a checked row, an unchecked row, another family's row, prose mentioning an id, a gate) so a
    parser that silently matched nothing could not make the other eight vacuous.
  - Evidence: 2 mutations, 2 caught, restored and re-run green.
    (1) renamed the `ANL-020-005` row to `**ANL-020-005-DELETED**` → `not ok 4 - every ANL
    requirement the Bible states has a row in the analytics ledger` and `not ok 5 - the analytics
    ledger invents no requirement and repeats none` (`# pass 7 # fail 2`); restored → `# pass 9`.
    (2) duplicated the `ANL-040-005` row verbatim → `not ok 5 - the analytics ledger invents no
    requirement and repeats none` (`# pass 8 # fail 1`); restored → `# pass 9 # fail 0`.
  - Limitation, stated because the word is "every": this proves the 27 ids the Bible's §17 checklist
    and gate list STATE are all here. It cannot prove the Bible states everything it should — a
    capability the Bible never wrote down is outside anything this can see.

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
  - Reason: Both halves exist in part and neither is done, and the gap is now MEASURED rather than
    estimated — that is this row's only contribution, and it is worth more than a partial tick.
    **The frame carries 9 of the 14 slots §7's opening paragraph names.** Derived from
    `ChartFrame.tsx`'s own prop list rather than read off its comment: `title`, `question`, `source`,
    `asOf`, `unit`, `filters`, `comparison`, `table` and `fileName` are there; **metric definition,
    uncertainty, annotations, legend and drill-through are not**. Those five are not cosmetic — the
    metric definition is what makes a number auditable, uncertainty is what stops a forecast being
    read as a fact, and drill-through is §9's "source-record drill-through", the reason a reader can
    check a number instead of believing it.
    **The frame is used by 1 of the 9 modules that render a mark.** `ActivityChart.tsx` is the one.
    The other eight — including `ReportsAnalytics.tsx`, which draws five marks with the Sankey among
    them — ship no accessible data table, no CSV export and no provenance line at all. A shared frame
    nine-tenths of the surface does not use is a component, not a contract.
    **The grammar is 10 of the 45 marks §7.1–§7.10 names.** Three whole families have no mark:
    §7.3 financial bridges (waterfall, variance bars, contribution tree, driver decomposition),
    §7.4 distribution (histogram, box/violin, scatter/bubble, correlation matrix, cohort heatmap) and
    §7.8 schedule (Gantt, capacity heatmap, resource histogram, critical path, plan-vs-actual bands).
    Each is a §8 domain minimum — variance waterfall for Finance, sensitivity for Planning, Gantt for
    Operations — so those surfaces are currently showing a bar or a line standing in for a mark that
    does not exist.
  - Code: nothing new for this requirement. `apps/web/src/components/charts/ChartFrame.tsx` and the
    kit's thirteen components are what exists; the measurement of what they are missing is published
    in `docs/architecture/anl-analytics-limitations.md` §3 and §4 (ANL-040-005).
  - Tests: `tests/architecture/anl-limitations-are-published.test.mjs` holds those three numbers to
    the tree in both directions — 12 tests, `# pass 12 # fail 0`. A mark that lands, a prop that is
    added or a module that adopts the frame all fail the guard until the published ratio is
    re-derived, so this FAIL cannot quietly become stale in either direction.
  - Evidence: 3 of the 5 mutations recorded under `ANL-040-005` are exactly the ones that pin this
    row's numbers: renaming the `table` prop citation caught the frame-slot mapping, removing
    `PortfolioSankey.tsx` from the bare list caught the adoption ratio, and claiming `DonutChart.tsx`
    ships a treemap caught the grammar ratio (11 of 45 derived against 10 of 45 published).
  - What closing it needs, in order: (1) the five missing frame slots, of which `metric definition`
    depends on `ANL-000-003`'s persisted `MetricDefinition` and therefore on a schema change this
    wave may not make; (2) the 35 absent marks, or a decision recorded in this ledger that a named
    subset is `NOT_APPLICABLE` for Tenure's declared scope — §7 is written for a general BI product
    and "every mark" may not be the right target, but that is a decision to record, not to assume;
    (3) adoption: eight modules to move inside the frame, which is a change to eight surfaces owned
    by three other domains and needs their agreement rather than a unilateral edit.

- [ ] **ANL-020-002** — Implement domain minimum visualizations and source drill-through.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-020-003** — Implement cross-filter, compare, annotations, saved views, alerts and action handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-020-004** — Provide accessible tables/summaries, keyboard, color-vision, zoom and responsive alternatives.
  - Status: FAIL
  - Reason: The colour-vision half is now MEASURED and it fails. That is the finding this row exists
    to record, and it took building the instrument to get it.
    `apps/web/src/app/globals.css:13` claims the eight chart slots are "validated CVD-safe in BOTH
    modes … via the data-viz validator". No validator existed: `cvd.ts`, the 190-line
    Viénot/Brettel/Mollon simulator written for THIS requirement, was imported by no file in the
    repository, and its header named a consumer — `cvd.test.ts` — that did not exist. Run for the
    first time, over the real palette: **10 of the 57 measurable pairs on light and 10 of the 56 on
    dark fall below the ΔE-20 floor `cvd.ts` itself declares.** The worst is `--chart-5` against
    `--chart-7` at **ΔE 1.61** for a deuteranope on dark, with `--chart-2` against `--chart-4` at
    **4.22** — two pairs `ReportsAnalytics.tsx` renders on one screen. `prefers-contrast: more`
    changes nothing: it overrides text and border tokens and leaves `--chart-1…8` alone.
    `cvd.ts` allows sub-floor pairs when "the secondary encoding the chart kit already mandates
    (legend + direct labels + 2px gaps)" carries the identity instead. It does not.
    `ChartLegend.tsx` renders an `aria-hidden` swatch and states in its own header that "identity
    comes from the swatch beside them" — so a colliding pair is indistinguishable in the mark AND in
    the legend, and no mark in the kit draws a pattern or a shape difference. §12 asks for
    "pattern/shape/label in addition to colour"; there is none.
    The tables half fails too, and by the same measurement as `ANL-020-001`: 1 of the 9
    mark-rendering modules sits in a `ChartFrame`, so eight ship no accessible data table. §12's
    "charts have semantic summaries" has no implementation anywhere — `ChartFrame` renders a
    `<caption>` restating the title, question, unit and source, which is provenance rather than a
    summary of the data. Keyboard, zoom/reflow and mobile alternatives were not measured at all: they
    need a rendered page, and this wave is deliberately build-free.
  - Code: `apps/web/src/components/charts/cvd.ts` (fixed — the gamut refusal described under
    `ANL-040-005`), `apps/web/src/components/charts/cvd.test.ts` (new — the instrument, 15 tests).
    No production behaviour changed for a reader: this row buys a measurement, not a fix.
  - Caller: `cvd.test.ts` is `cvd.ts`'s first caller, under
    `npm run test --workspace apps/web -- --ci`. Its own header says that is the right shape for a
    colour-system validator ("a colour-system validator's product IS its audit") and names
    `src/lib/a11y/contrast.ts` as the precedent.
  - Tests: `npx jest src/components/charts/cvd.test.ts` → `Tests: 15 passed, 15 total`. The palette's
    collisions and its unmeasurable pairs are both pinned to two decimal places, so a hue edit fails
    the build and has to be re-decided rather than silently changing what a dichromat sees.
  - Evidence: the 5 mutations under `ANL-040-005`, of which the fifth (`1.61` → `1.71` in the
    published table) is this row's: jest reported
    `Expected: "deuteranopia 5~7 1.71" / Received: "deuteranopia 5~7 1.61"`.
  - Why it is not a PASS, precisely: (1) the palette is not separable for red-green dichromacy and
    fixing it is a redesign of `globals.css`, the design system's file, not analytics'; (2) tritanopia
    is UNASSESSED — the Viénot single-plane projection leaves the display gamut on this palette, so
    27 of 28 pairs on light and 28 of 28 on dark cannot be scored at all, and assessing them needs
    the Brettel two-plane simulation this module does not implement; (3) no chart carries a semantic
    summary; (4) eight of nine mark renderers carry no data table; (5) keyboard, zoom and responsive
    behaviour is unmeasured, and claiming it on the strength of a `.chart-hit:focus-visible` rule in
    the stylesheet would be exactly the "a type declares it" failure this ledger is written against.

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
  - Reason: A benchmark scenario is a scenario that RUNS. §14 asks for "Tenure's own baselines and
    comparable scenario tests", which means a task performed end to end against seeded data, timed,
    with the result recorded — and the mapping half of that (which requirements a competitor's
    strength corresponds to) is `ANL-040-002`, closed above, deliberately without claiming this one.
    What is missing is the harness, and it is missing for a stated reason rather than an unexamined
    one: a scenario needs Postgres, `npx prisma migrate deploy`, `node scripts/seed.mjs` and
    Playwright against a built app — `CLAUDE.md` documents the sequence — and the e2e suite is not
    idempotent (132/132 on a fresh seed, 125/132 on a second run), so a benchmark whose baseline
    depends on how many times it has been run measures the fixture rather than the platform.
  - Code: none. Named rather than implied so nobody counts the comparison document as this: the
    verdict column in `docs/architecture/anl-intuit-benchmark.md` is derived from ledger STATUS, and a
    status is not a timing.
  - Tests: `tests/architecture/anl-intuit-benchmark.test.mjs` reads this row's status and forbids any
    `exceeds` verdict while it is not `PASS` — so this FAIL is load-bearing rather than decorative,
    and closing it is what unlocks the only superiority claim §14 permits.
  - Evidence: mutation (4) recorded under `ANL-040-002` — setting a verdict to `exceeds` →
    `not ok 6 - superiority is not claimed while the instrument for measuring it is unbuilt`, whose
    message names this requirement and its `FAIL`.
  - What closing it needs: the four commands in `CLAUDE.md`'s database section, a per-scenario
    baseline recorded as data rather than prose, and a decision about re-seeding between runs. It is
    not blocked on anything external — a wave with a database can do it — so it stays `FAIL` rather
    than `BLOCKED_EXTERNAL`.

- [ ] **ANL-040-002** — Implement and evidence the Intuit comparison in Section 14.
  - Status: FAIL
  - Overturned on review: REFUTED ON REQUIREMENT SCOPE (check 1), not on execution quality. Everything mechanical checks out: `node --test tests/architecture/anl-intuit-benchmark.test.mjs` -> # pass 8 # fail 0, all eleven §14 strengths present and quoted, 37 citations / 35 distinct ids / 13 domains, and all five claimed mutations reproduced verbatim one at a time and restored to md5 8a4644e6570169739850069e19e34430: Payments 2 of 4->3 of 4 -> not ok 3 'Payments and bill pay: says 3 decided, ledgers show 2'; BI partial->met -> not ok 4 'the ledgers support at most "partial"'; EXT-140-001->EXT-140-999 -> not ok 2; verdict->exceeds -> not ok 4 + not ok 6 naming ANL-040-001 FAIL, # pass 6 # fail 2; verdict rule body -> 'partial' -> not ok 5, # pass 7 # fail 1. Two more of my own also fired: dropping the Marketing-connection row -> not ok 1; cutting that row to one citation -> not ok 2 'a gesture, not a comparison'. No lag is currently tolerated (the console.log never fires), so the asymmetric weakening hides nothing today. The problem is the sentence. Bible line 331 reads 'Implement AND EVIDENCE the Intuit comparison in Section 14', and §14's table column is 'Tenure must MEET AND EXCEED through evidence', closing with the instruction that defines that evidence: 'Establish Tenure's own baselines and comparable scenario tests.' The delivered artefact establishes no baseline and no comparable scenario test — it is a roll-up of other requirements' ledger statuses, and it reports that Tenure meets ZERO of the eleven strengths (4 partial, 7 not started). The document says so itself: 'this document is the comparison, not the proof', and 'no such harness exists for a competitor comparison'. Two textual discriminators decide it against the closer's reading. First, §17 is titled 'Evidence-gated checklist', so every item is already evidence-gated; 'and evidence' in this one item must add something, and §14 says what — baselines and comparable scenario tests. Second, in the same §17 block ANL-040-005 uses 'PUBLISH' for a document deliverable while ANL-040-002 uses 'IMPLEMENT', the verb this Bible uses everywhere else for building capability (ANL-010-001, ANL-020-001, ANL-030-001); closing 'Implement' with a document is the narrower reading. This repository's own precedent points the same way: PLN-040-004 explicitly REFUSED exactly this substitution ('a generated pln-scorecard.md ... with 12 rows reading "no instrument exists" ... would be an honest document and it would not instrument anything, and filing it as PASS against a requirement whose verb is "instrument" is exactly the substitution this ledger exists to refuse'), and OPS did the same for its scorecard. ANL-040-001 FAIL, ANL-040-003 FAIL, ANL-040-004 FAIL and GE-420-006 ('Prove the Intuit Enterprise Suite ... benchmark') FAIL are all consistent with ANL-040-002 not being closable yet. Recommendation: keep docs/architecture/anl-intuit-benchmark.md and its guard — they are genuinely good, derived and mutation-proven — but record the row as FAIL (or PARTIAL, if this ledger has that vocabulary) with the document cited as the gap analysis, and let it flip to PASS when ANL-040-001 gives the comparison an instrument.
  - Reason: The comparison exists as a document whose every flattering cell is COMPUTED from the
    execution ledgers, in `docs/architecture/anl-intuit-benchmark.md`. All eleven §14 strengths are
    there, quoted from §14; each cites the requirements across the platform that would constitute
    meeting it (37 citations, 35 distinct ids, 13 domains); the `Decided` ratio is recomputed from
    `docs/implementation/*-execution-ledger.md` on every run; and the verdict is a FUNCTION of that
    ratio, so `met` is unavailable to a row while any requirement it cites is unfinished. The result
    is four `partial` and seven `not started` — nothing claims Tenure meets an Intuit strength, and
    nothing claims it exceeds one.
    **One deliberate weakening, recorded because it is a weakening.** The guard first demanded EXACT
    equality between the published ratio and the ledgers, and it went red within the hour — on
    `TTES-050-004`, which another domain closed while this was being written. That is worth thinking
    about rather than working around: a guard whose likeliest failure is another team's requirement
    PASSING, in a file only this domain may edit, is a guard somebody deletes, and deleting it takes
    the overclaim check with it. So the comparison is now checked asymmetrically — a ratio or verdict
    STRONGER than the ledgers support fails hard, because that is the claim §14 forbids; one that lags
    is tolerated, because it understates Tenure and no rule in the Bible is written to prevent that.
    The single exception is the direction a reader is entitled to: a row all of whose requirements
    have passed must say `met`. The published ratios are therefore a floor, and the document says so.
    **The reading of the requirement, stated so it can be argued with.** §14's actionable instruction
    is "Do not copy Intuit UI or repeat vendor performance claims as Tenure claims. Establish
    Tenure's own baselines and comparable scenario tests." The scenario tests are separate
    requirements — `ANL-040-001` (benchmark scenarios) and `ANL-040-003` (the twelve E2E scenarios) —
    both `FAIL`, both needing a seeded database and a harness. What is left as this requirement's own
    content is the comparison itself, evidenced. So the strongest claim available is governed rather
    than written: `exceeds` is forbidden to every row until `ANL-040-001` is `PASS`, and the guard
    enforces that by reading its status rather than trusting the document.
    This is the requirement most likely to be closed dishonestly in the whole family. A comparison
    document has no compiler, no runtime and no user; every cell is prose, and prose about a
    competitor is where "we are better" gets written. That is why the guard, not the document, is the
    deliverable.
  - Code: `docs/architecture/anl-intuit-benchmark.md` (new — the comparison);
    `tests/architecture/anl-intuit-benchmark.test.mjs` (new — the derivation). Statuses come from
    `tools/document-graph.mjs` (`ledgerStatuses`), the same reader the registry is built from, so the
    document cannot disagree with the register a reader would check it against.
  - Caller: `tools/run-platform-tests.mjs` discovers and runs it under `npm run test:platform`, which
    is in `npm run verify` and in CI.
  - Tests: 8 tests, `node --test tests/architecture/anl-intuit-benchmark.test.mjs` →
    `# pass 8 # fail 0`. Floors so a parser that read nothing could not agree with everything: §14
    must still tabulate 11 strengths, ≥25 distinct ids must be cited, every row must cite ≥2, ≥6
    distinct domains must appear, and at least one cited requirement must be `PASS` (otherwise the
    verdict rule is never exercised by real data). The `met` branch of the rule is reached by NO row
    today, so it is exercised directly against a synthetic four-id ledger — including that
    `BLOCKED_EXTERNAL` does not count as met, and that an id nobody decides can never lift a verdict.
  - Evidence: **5 mutations, 5 caught**, each restored and re-run green. They are the five ways this
    document would actually rot: an overclaimed ratio, a verdict promoted by hand, a citation to a
    requirement nobody owns, a superiority claim slipped in, and the rule itself broken where no real
    row exercises it.
  - Mutations, verbatim:
    (1) overclaimed the "Payments and bill pay" ratio, `2 of 4` → `3 of 4` →
    `not ok 3 - the decided ratio never claims more than the ledgers show`, reporting
    `Payments and bill pay: says 3 decided, ledgers show 2` (`# pass 7 # fail 1`).
    (2) promoted the "Business intelligence and reporting" verdict from `partial` to `met` →
    `not ok 4 - a verdict never outruns the work, and a fully met row is published as met`, reporting
    `Business intelligence and reporting: says "met", the ledgers support at most "partial"`.
    (3) replaced the cited `EXT-140-001` with `EXT-140-999`, an id no ledger decides →
    `not ok 2 - every cited requirement is one a ledger actually decides`, reporting
    `AI insights/agents → EXT-140-999`.
    (4) changed the "Fast adoption/easy learning" verdict to `exceeds` → TWO failures,
    `not ok 4` (`"exceeds" is outside the verdict vocabulary`) and
    `not ok 6 - superiority is not claimed while the instrument for measuring it is unbuilt`
    (`claims Tenure exceeds a competitor while ANL-040-001 (comparable scenario tests) is FAIL.
    Superiority is a measurement; build the scenarios first.`), `# pass 6 # fail 2`.
    (5) replaced the rule's body, `return passing === ids.length ? 'met' : 'partial'` → `return
    'partial'`, so `met` became unreachable → `not ok 5 - the verdict rule is exercised directly,
    including the branch no row reaches yet` (`# pass 7 # fail 1`). Restored → `# pass 8 # fail 0`.
  - Limitation, and it is the interesting one: this proves the comparison is **consistent with the
    programme's own record**. It does not prove the record is right about Intuit's scope — §14's
    eleven strengths are quoted from the Bible, and the Bible's account of a competitor is as of the
    day it was written. Nothing here re-verifies Intuit's product, and by §14's own prohibition
    nothing here should.

- [ ] **ANL-040-003** — Pass all twelve E2E scenarios with zero unexplained source/report variance.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-040-004** — Instrument best-system scorecard baselines/targets/results.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **ANL-040-005** — Publish exact metric/report/analytics limitations and blocked sources.
  - Status: PASS
  - Reason: `docs/architecture/anl-analytics-limitations.md` publishes six sections, and every number
    in it is derived on every run and compared with the document in BOTH directions. That direction
    matters more here than anywhere else in this ledger: a stale inventory over-reports work, but a
    stale LIMITATION under-reports it — the page keeps listing yesterday's gaps while a new one lands
    and nobody is told. So a limitation the code no longer has fails the build, and a gap the code
    has and the document omits fails it too.
    What it publishes, all of it measured rather than asserted: (1) every analytics export whose doc
    comment declares a `**Limitation.**`; (2) the colour-vision separation of the eight chart slots,
    per theme, per dichromacy, with the pairs it CANNOT measure listed separately; (3) which of §7's
    fourteen `ChartFrame` slots the component carries — 9 of 14 — derived from its own prop list;
    (4) which mark-rendering modules ship no table, export or provenance — 8 of 9 — derived from the
    tree; (5) which of the 45 marks §7.1–§7.10 names the kit ships — 10 of 45; (6) two blocked
    sources and the 22 ANL requirements not claimed.
    The colour-vision section is why this requirement was worth doing rather than writing.
    `globals.css:13` says the chart slots are "validated CVD-safe in BOTH modes … via the data-viz
    validator". Nothing validated anything: `cvd.ts`, the 190-line Viénot/Brettel/Mollon simulator
    that would have measured it, was imported by NO file — `grep -rn "cvd" apps packages tools tests`
    returned only itself — and its own header named a consumer, `cvd.test.ts`, that did not exist.
    Measured now: **10 of the 57 measurable pairs on light and 10 of the 56 on dark fall below the
    ΔE-20 floor `cvd.ts` itself declares**, the worst being `--chart-5` against `--chart-7` at
    ΔE 1.61 for a deuteranope on dark — two hues `ReportsAnalytics` renders on the same screen.
  - Code: `docs/architecture/anl-analytics-limitations.md` (new, the publication);
    `apps/web/src/components/charts/cvd.ts` (fixed — see the mutation note below);
    `apps/web/src/components/charts/cvd.test.ts` (new, the colour-vision instrument);
    `tests/architecture/anl-limitations-are-published.test.mjs` (new, the guard for the other five
    sections). The derivations reuse `tools/document-graph.mjs` (`ledgerStatuses`) and
    `apps/web/src/lib/a11y/theme-tokens.ts` (`readThemes`, `token`) rather than re-parsing the ledger
    or the stylesheet a second time.
  - Caller: the publication's readers are its two guards, which is the right shape for a document —
    `tools/run-platform-tests.mjs` runs the platform guard under `npm run test:platform`, and jest
    collects `cvd.test.ts` under `npm run test --workspace apps/web`. `cvd.ts` had NO caller before
    this and now has one: that is what makes its arithmetic a measurement rather than a comment, and
    its own header says so ("Consumers: `cvd.test.ts`, which is what gates the palette").
  - Tests: `apps/web/src/components/charts/cvd.test.ts` — 15 tests, jest
    (`npx jest src/components/charts/cvd.test.ts` → `Tests: 15 passed, 15 total`).
    `tests/architecture/anl-limitations-are-published.test.mjs` — 12 tests, `node --test` →
    `# pass 12 # fail 0`. Floors in both so an empty derivation cannot pass: §7 must still name 14
    frame slots, the kit must still have ≥10 components, ≥5 modules must render a mark, the grammar
    table must hold ≥40 rows, and `scored + skipped` must equal 84 pairs per theme.
  - Evidence: **5 mutations, 5 caught**, each restored and re-run green — recorded verbatim in the
    Mutations section at the end of this entry. One of them was not a mutation at all but a real
    defect this work found: `cvd.ts` clamped every simulation into the display gamut before measuring
    ΔE, and the tritanopia projection leaves that gamut by up to twice full scale (linear blue
    -2.042). The clamp collapsed six of eight light slots onto two values, and the audit duly
    reported pairs 0.45 and 0.50 ΔE apart as indistinguishable hues. They are not hues at all. That
    is the exact collapse this codebase forbids — "we could not look" reported as "we looked and
    found nothing" — and it would have sent somebody to redesign a hue over an arithmetic artefact.
    `outOfGamut()` and `cvdAudit()` now separate the two, `separationUnder()` throws rather than
    scoring a clamped pair, and the published document states 27 of 28 tritanopia pairs on light and
    28 of 28 on dark as UNMEASURED rather than safe.
  - Mutations, verbatim:
    (1) deleted the `medianDurationMs` row from the published metric-limitations table →
    `not ok 2 - every metric limitation declared in code is published`.
    (2) changed the frame-slot table's `accessible data table` prop from `` `table` `` to
    `` `rows` `` → `not ok 4 - a carried frame slot names a prop ChartFrame really has, and an
    absent one names none`.
    (3) removed `apps/web/src/components/finance/PortfolioSankey.tsx` from the bare-marks list →
    `not ok 5 - the unframed mark renderers are exactly the ones published`.
    (4) changed the grammar table's `treemap` row from `—` to `` `DonutChart.tsx` `` →
    `not ok 9 - the grammar coverage ratio is the one the table adds up to` (the ratio moved to
    11 of 45 and the document still said 10).
    (5) changed one published ΔE from `1.61` to `1.71` → jest
    `● the published limitation › publishes exactly the collisions this computation finds`, whose
    array diff reads `- "deuteranopia 5~7 1.61"` (Expected — the computation) against
    `+ "deuteranopia 5~7 1.71"` (Received — the document), `Tests: 1 failed, 14 passed`.
  - Limitation of this publication, stated in it and here: it publishes the limitations a machine can
    find — a declared `**Limitation.**`, a missing prop, an absent mark, a non-PASS requirement. A
    metric that is simply WRONG is not one of those, and §9's reconciliation requirement
    (`ANL-010-002`) is where that is caught. Nothing here says a number is correct; it says what the
    platform cannot do and where it could not look.

- [ ] **ANL-GATE-000** — Metrics and reports have one governed definition and source.
  - Status: FAIL
  - Children: 3 of 4 decided — `ANL-000-001` PASS, `ANL-000-002` PASS, `ANL-000-004` PASS,
    `ANL-000-003` BLOCKED_EXTERNAL.
  - Reason: Three of the four children are `PASS` and the fourth is blocked, which is exactly the
    arithmetic that tempts a gate to be ticked. It cannot be, for a reason in the code rather than in
    the bookkeeping: `ANL-000-003` is the persisted semantic layer, and without a `MetricDefinition`
    row a metric's governed definition lives in a TypeScript constant that a deploy replaces. That is
    one definition per build, not one governed definition — there is no version, no effective date and
    no impact analysis, so a metric can change meaning between two reports run a week apart with
    nothing recording that it did.
    `tests/architecture/pass-requires-evidence.test.mjs` counts only `PASS` and `NOT_APPLICABLE` as
    decided, so `BLOCKED_EXTERNAL` correctly holds this gate open, and this row does not argue with
    it.
  - Evidence: 3 of 4 children decided; the blocker is stated with its unblocking commands under
    `ANL-000-003`. `docs/architecture/anl-analytics-limitations.md` publishes this gate's state in
    prose for a reader who does not read ledgers, and
    `tests/architecture/anl-limitations-are-published.test.mjs` holds that list to this file.

- [ ] **ANL-GATE-010** — Analytics is accurate, isolated and scalable.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-GATE-020** — Charts are high-end, truthful, accessible and actionable.
  - Status: FAIL
  - Children: 0 of 5 decided — `ANL-020-001` FAIL, `ANL-020-002` FAIL, `ANL-020-003` FAIL,
    `ANL-020-004` FAIL, `ANL-020-005` FAIL.
  - Reason: None of the five is decided, and two of them are now decided FAILURES with numbers rather
    than unread rows, which is the only thing that changed this wave. On "accessible": 8 of the 9
    mark-rendering modules carry no data table, no export and no provenance, and 10 of the 84
    colour-slot pairs a dichromat can be measured on fall below the floor the kit's own validator
    declares. On "high-end": 10 of the 45 marks §7 names exist, and three whole §7 families have
    none. Both numbers are published in `docs/architecture/anl-analytics-limitations.md` and guarded.
  - Evidence: 0 of 5 children decided; the two measured ones cite their guards and mutations under
    `ANL-020-001` and `ANL-020-004` above.

- [ ] **ANL-GATE-030** — Reporting works from operational detail to executive/board outcomes.
  - Status: FAIL
  - Reason: imported from `Tenure_Enterprise_Analytics_Reporting_and_Visualization_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **ANL-GATE-040** — “Best analytics” is claimed only for measured released scope.
  - Status: FAIL
  - Children: 1 of 5 decided — `ANL-040-001` FAIL, `ANL-040-002` FAIL, `ANL-040-003` FAIL,
    `ANL-040-004` FAIL, `ANL-040-005` PASS.
  - Reason: The one child that landed is the publication of what analytics cannot do
    (`ANL-040-005`), which makes an over-claim harder to make by accident. `ANL-040-002` — the
    comparison whose verdicts are computed from the ledgers rather than asserted — was claimed and
    then OVERTURNED on review: the engine and its mutation proofs were sound, but the requirement's
    own sentence asks for more than the claim closed. Its row carries the refuter's reasoning.
    What is still missing is the other half of the gate's sentence, "measured": there is no scenario
    harness (`ANL-040-001`), the twelve E2E scenarios do not run (`ANL-040-003`), and the §15
    scorecard has no instrument (`ANL-040-004`). So no superiority is claimed anywhere today, which
    satisfies the gate's prohibition by having nothing to prohibit — and that is not the same as
    passing it.
  - Evidence: 1 of 5 children decided. The prohibition is enforced by
    `tests/architecture/anl-intuit-benchmark.test.mjs`, which forbids any `exceeds` verdict while
    `ANL-040-001` is not `PASS`; mutation (4) under `ANL-040-002` shows it firing.
