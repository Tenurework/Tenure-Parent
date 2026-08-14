# Analytics inventory — every dashboard, report, chart and client-side metric

ANL-000-001. The Analytics Bible §17 asks for an inventory of "every
dashboard/report/chart/client-side metric" classified by "source/owner/truth".
This file is the classification. The list it classifies is **not written here**:
it is derived from the source tree by `tools/anl-analytics-inventory.mjs` into
`docs/architecture/anl-analytics-inventory.json`, and
`tests/architecture/anl-analytics-inventory.test.mjs` fails the build when the
two disagree in either direction — a derived artefact nobody classified, or a
classified path that no longer exists.

That split is the whole design. A hand-written inventory is a claim about the
repository that stops being true the day after somebody adds a chart, and
nothing notices, because prose has no failing state. Half of this claim is
machine-decidable — *what analytics code exists, and which domain owns it* — and
that half is derived on every run. The half that is not — *which rows a number
came from, and whether the surface is telling the truth about it* — is written
below, and it is held to the derived half by set equality.

## How the derived half is derived

`tools/anl-analytics-inventory.mjs` walks `apps/system-studio/src` and
`apps/web/src` in sorted order, normalises CRLF to LF before matching, and
classifies a file by literal tokens it records alongside the verdict, so any
classification can be re-checked by hand. The rules and their exact token lists
are in the generator and echoed into the JSON's `rules` block. `owner` is not
decided here at all: it is joined from `tools/ownership-map.mjs`, which already
assigns every source file to exactly one platform domain and is guarded by
`tests/architecture/ownership.test.mjs`. `(shared)` is that map's own answer for
a design-system file no domain owns.

    node tools/anl-analytics-inventory.mjs            # rewrite the JSON
    node tools/anl-analytics-inventory.mjs --check    # exit 1 if it is stale
    node --test tests/architecture/anl-analytics-inventory.test.mjs

## Truth classes

| Class | What it means |
|---|---|
| `system-of-record` | Read from the owning domain's canonical rows or an AWS API on this request. No cache, no copy. |
| `derived-server` | Computed on the server from rows read on this request. |
| `derived-client` | Computed in the browser from data the server already sent. |
| `polled` | Refreshed in the browser on a stated interval from an endpoint. |
| `presentation` | Carries no data of its own — renders values it is handed. |
| `guard` | A count that enforces an invariant and is never rendered as a metric. |

`derived-client` is the class the Bible's §19 prohibition is about — "do not
calculate canonical metrics independently in clients". Six artefacts below carry
it. Each one's note says what it re-derives and from what, because the
prohibition is against an *independent* second calculation, not against
arithmetic in a browser.

## Known limits of this inventory

Stated rather than implied, because the requirement says "every" and no token
scan can prove that word:

1. The rules are a **floor**. A page that renders a number through prose alone —
   no chart, no stat primitive, no aggregation call — matches nothing and is not
   here. Two are known: `apps/system-studio/src/app/page.tsx` and
   `apps/system-studio/src/app/platform/security/page.tsx` both count with
   `.filter(...).length`, which is too common a shape to classify on without
   sweeping in every list in the codebase. They are recorded in the table below
   and marked as rule-missed, and the guard test asserts their paths exist.
2. `packages/**` is not scanned. No package renders a chart or a dashboard;
   `packages/finops` computes cost figures the Studio pages read, and it is
   reached through those pages' rows below.
3. Nothing here says a metric is *correct*. It says where it comes from.
   Correctness is ANL-010-002's reconciliation requirement.

---

## Analytics surfaces — dashboards and reports

| Artefact | Source | Truth | Note |
|---|---|---|---|
| `apps/system-studio/src/app/platform/audit/page.tsx` | `lib/audit-ledger`, `lib/aws/trail`, `lib/aws/dynamodb-tables`, `lib/registry` | `system-of-record` | Record and hold counts folded with `readable.reduce(...)` over every trail read this request. |
| `apps/system-studio/src/app/platform/compute/page.tsx` | `lib/aws/lambda`, `lib/aws/containers`, `lib/aws/ecr` | `system-of-record` | Live AWS reads; `StaleIndicator` carries each capability's refresh cadence. |
| `apps/system-studio/src/app/platform/cost/page.tsx` | `lib/aws/budgets`, `lib/aws/tags`, `lib/cost-source` | `system-of-record` | Figures are AWS Budgets and the tagging API. Unknown renders as `Unknown`, never zero. |
| `apps/system-studio/src/app/platform/data/page.tsx` | `lib/aws/buckets`, `lib/aws/database`, `lib/aws/dynamodb-tables`, `lib/aws/elasticache`, `lib/aws/retained` | `system-of-record` | Live AWS reads per storage surface. |
| `apps/system-studio/src/app/platform/estate/page.tsx` | `lib/aws/inventory`, `lib/aws/drift`, `lib/aws/topology`, `lib/aws/capabilities`, `lib/aws/tags` | `system-of-record` | Coverage and drift decided in `estate-coverage.ts` / `estate-answer.ts`. |
| `apps/system-studio/src/app/platform/health/page.tsx` | `lib/aws/alarms`, `lib/aws/aws-health`, `lib/aws/expected-alarms` | `system-of-record` | CloudWatch alarms against the expected set. |
| `apps/system-studio/src/app/platform/identity/page.tsx` | `lib/aws/cognito`, `lib/aws/iam`, `lib/aws/keys`, `lib/aws/analyzer`, `lib/aws/secrets` | `system-of-record` | Two door counts, decided in `doors.ts`. |
| `apps/system-studio/src/app/platform/messaging/page.tsx` | `lib/aws/ses`, `lib/aws/sqs`, `lib/aws/eventbridge`, `lib/aws/metrics` | `system-of-record` | Reach and queue depth, ranked in `reach.ts`. |
| `apps/system-studio/src/app/platform/network/page.tsx` | `lib/aws/network`, `lib/aws/loadbalancer` | `system-of-record` | Live VPC and load-balancer reads. |
| `apps/system-studio/src/app/platform/page.tsx` | `lib/aws/capabilities`, `lib/cells`, the execution ledgers | `derived-server` | Programme completion percentage: `(decided / totalItems) * 100`, computed on this render. |
| `apps/system-studio/src/app/tenants/page.tsx` | `lib/registry` (DynamoDB), `lib/aws/health`, `lib/fleet-health` | `system-of-record` | Fleet verdicts decided in `fleet-view.ts`. |
| `apps/web/src/app/(app)/admin/audit/page.tsx` | `db.auditEvent`, `db.organization`, `db.user` | `system-of-record` | `db.auditEvent.count` for the total; rows are the audit trail itself. |
| `apps/web/src/app/(app)/admin/page.tsx` | `db.organization`, `db.roleAssignment`, `db.role`, `db.approvalRequest`, `db.directoryPerson`, `db.auditEvent` | `system-of-record` | Six `.count()` calls, one per stat tile. |
| `apps/web/src/app/(app)/admin/people/page.tsx` | `db.directoryPerson`, `db.institutionMembership`, `db.roleTransfer` | `system-of-record` | Directory counts for the people admin surface. |
| `apps/web/src/app/(app)/dashboard/page.tsx` | `db.organization`, `db.roleAssignment`, `db.approvalRequest`, `db.event`, `db.budgetLine`, `db.delivery`, `db.auditEvent` | `system-of-record` | Counts and one `budgetLine.aggregate`; the activity trend is handed to `ActivityChart` as raw timestamps. |
| `apps/web/src/app/(app)/messages/page.tsx` | `db.conversation`, `db.delivery` (`groupBy`), `db.organization` | `system-of-record` | Delivery outcomes grouped in the database, not in the page. |
| `apps/web/src/app/(app)/orgs/page.tsx` | `db.organization` | `derived-server` | Per-club figures folded from the rows read on this request. |
| `apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx` | `db.budgetLine`, `db.ledgerEntry`, `db.vendor`, `db.approvalRequest`, `db.document` | `system-of-record` | `budgetLine.actualCents` is the stored roll-up written by `finance/actions.ts`. |
| `apps/web/src/app/(app)/orgs/[slug]/handoff/page.tsx` | `db.approvalRequest`, `db.budgetLine`, `db.deliverable` | `derived-server` | Seat-fill and open-work counts for the outgoing officer. |
| `apps/web/src/app/(app)/orgs/[slug]/impact/page.tsx` | `db.event`, `db.roleAssignment`, `db.memoryRecord`, `db.collabInterest`, `db.approvalRequest` (`groupBy`), `db.budgetLine` | `system-of-record` | Four `.count()` calls and one `groupBy`. |
| `apps/web/src/app/(app)/reports/finance/page.tsx` | `db.organization` → `db.budgetLine`, rolled up by `lib/finance` `rollUpPortfolio` | `derived-server` | Totals are grouped by currency and never summed across denominations (PAY-080-004). |
| `apps/web/src/app/(app)/reports/page.tsx` | `db.organization`, `db.roleAssignment`, `db.approvalRequest`, `db.approvalStep`, `db.event`, `db.conflictRecord`, `db.memoryRecord`, `db.role`, `db.auditEvent` | `derived-server` | The institution report. Its median-time-to-decision and open-approval definitions are `lib/analytics/metrics.ts` (ANL-000-002). |
| `apps/system-studio/src/app/page.tsx` | `lib/registry`, `lib/aws/*` | `system-of-record` | **Rule-missed** — counts configuration verdicts with `.filter(...).length`, a shape the scan deliberately does not classify on. |
| `apps/system-studio/src/app/platform/security/page.tsx` | `lib/aws/securityhub` via `posture.ts`, `lib/aws/iam` | `system-of-record` | **Rule-missed** — same shape. Severity counts come from `countBySeverity` in `posture.ts`. |

## Metric endpoints

| Artefact | Source | Truth | Note |
|---|---|---|---|
| `apps/web/src/app/api/reports/pulse/route.ts` | `db.approvalRequest`, `db.event`, `db.roleAssignment`, `db.conflictRecord` | `system-of-record` | The endpoint the `/reports` "Live now" strip polls every 15s. Open-approval statuses come from `lib/analytics/metrics.ts`, not from literals here. |
| `apps/web/src/app/api/notifications/route.ts` | `db.notification` | `system-of-record` | Unread count for the shell bell. |

## Metric modules — where a figure is decided

| Artefact | Source | Truth | Note |
|---|---|---|---|
| `apps/system-studio/src/app/platform/cost/cost-decisions.ts` | Budgets and tag readings handed in by the page | `derived-server` | Threshold rows and the "running away" verdict. |
| `apps/system-studio/src/app/platform/cost/cost-rates.ts` | `lib/aws/pricing` — the published on-demand rates for the shapes this estate provisions | `derived-server` | Quote rows and their total. Arithmetic is integer minor units in `Money`, never a float. The rates are READ, not transcribed: a catalogue of typed-in prices is right on the day somebody typed it and wrong from the next AWS price change onward, with nothing in the product able to say which day it is. A rate that could not be read is absent, never zero — a quote that silently prices something at nothing is worse than no quote. |
| `apps/system-studio/src/app/platform/estate/estate-answer.ts` | Estate readings handed in by the page | `derived-server` | The sentences the estate page leads with, including the arms that must not be reachable when a read failed. |
| `apps/system-studio/src/app/platform/estate/estate-coverage.ts` | Declared capabilities vs read resources | `derived-server` | Both directions of drift, including services with no reader. |
| `apps/system-studio/src/app/platform/identity/doors.ts` | Cognito and IAM readings | `derived-server` | Front-door and account-door counts, kept distinct. |
| `apps/system-studio/src/app/platform/messaging/reach.ts` | SES / SQS readings | `derived-server` | Ranks mailability; does not re-derive the sandbox verdict. |
| `apps/system-studio/src/app/tenants/fleet-view.ts` | Registry rows and health observations | `derived-server` | Everything `/tenants` decides, separated from what it draws. |
| `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` | `db.ledgerEntry` (`aggregate _sum`) | `derived-server` | **The canonical actual.** Writes `budgetLine.actualCents` from the sum of its ledger entries inside the posting transaction. Every other "actual" in the product is this number or a re-derivation of it. |
| `apps/web/src/app/(app)/admin/actions.ts` | `db.institutionMembership` (`count`) | `guard` | Counts live directors to refuse the demotion or revocation of the last one. Never rendered. |
| `apps/web/src/lib/analytics/metrics.ts` | — | `derived-server` | **Rule-missed by design** — the canonical metric definitions themselves (ANL-000-002). It renders nothing and reads nothing; it is what the surfaces above agree on. |

## Chart kit

Every module under `apps/web/src/components/charts/`. All are `presentation`:
they carry no data of their own and render values they are handed, which is
precisely why the kit is safe to share across domains. Source column is
therefore "whatever the caller passes".

| Artefact | Truth | What it is |
|---|---|---|
| `apps/web/src/components/charts/index.ts` | `presentation` | The kit's public surface. Inline SVG only; no chart library. |
| `apps/web/src/components/charts/ChartFrame.tsx` | `presentation` | The shared frame: title, question, source, as-of, unit, filters, accessible table, CSV. |
| `apps/web/src/components/charts/chart-table.ts` | `presentation` | The table and the CSV behind a chart, built from the same values the mark is handed. |
| `apps/web/src/components/charts/ChartEmpty.tsx` | `presentation` | The empty state a mark falls back to. |
| `apps/web/src/components/charts/ChartLegend.tsx` | `presentation` | Legend, present whenever a chart carries two or more series. |
| `apps/web/src/components/charts/ChartTooltip.tsx` | `presentation` | The one floating tooltip every mark uses. |
| `apps/web/src/components/charts/BarChart.tsx` | `presentation` | Vertical bars — single, grouped or stacked. Sums stacks client-side for the axis domain. |
| `apps/web/src/components/charts/HBarChart.tsx` | `presentation` | Horizontal bars — the approval funnel and the budget comparison. |
| `apps/web/src/components/charts/LineAreaChart.tsx` | `presentation` | Multi-series line/area with a crosshair hover layer. |
| `apps/web/src/components/charts/DonutChart.tsx` | `presentation` | Donut keyed by stable category identity, so colour does not follow rank. |
| `apps/web/src/components/charts/SankeyChart.tsx` | `presentation` | Flow diagram; lays out bands and suppresses colliding labels. |
| `apps/web/src/components/charts/Sparkline.tsx` | `presentation` | Bare trend for a stat tile. |
| `apps/web/src/components/charts/Meter.tsx` | `presentation` | Single-ratio meter (budget used, seat fill). Server-compatible. |
| `apps/web/src/components/charts/LiveStats.tsx` | `polled` | The only polling component in the kit. States its own freshness — "Updated {ago}" — beside the "Live now" label. |
| `apps/web/src/components/charts/RangeFilter.tsx` | `presentation` | The segmented range control; local to the kit. |
| `apps/web/src/components/charts/hooks.ts` | `presentation` | `useMeasuredWidth`, `usePolling`, `useTimeAgo`. |
| `apps/web/src/components/charts/format.ts` | `presentation` | Number and axis-tick formatting, pure. |
| `apps/web/src/components/charts/palette.ts` | `presentation` | The single source of truth for mark colour. |
| `apps/web/src/components/charts/cvd.ts` | `presentation` | Colour-vision-deficiency separation, computed rather than asserted (ANL-020-004). |
| `apps/web/src/components/charts/timeseries.ts` | `presentation` | Pure time bucketing, used by both server pages and the client panel. |
| `apps/web/src/components/charts/panels/ActivityChart.tsx` | `derived-client` | Buckets audit-event timestamps the server sent into 30 days. The only panel wrapped in `ChartFrame`, and it states the client clock as its as-of. |
| `apps/web/src/components/charts/panels/ReportsAnalytics.tsx` | `derived-client` | Re-aggregates the approval, decision, event and memory streams the reports page serialises, under a range filter the reader chooses. Its median and its open-approval stages come from `lib/analytics/metrics.ts` (ANL-000-002). |

## Chart panels outside the kit

| Artefact | Source | Truth | Note |
|---|---|---|---|
| `apps/web/src/components/finance/FinanceDashboard.tsx` | `db.budgetLine` rows handed in by the club finance page | `derived-client` | Sums budgeted/actual/projected across the lines it was given, and re-derives variance as the reader types a forecast. It does not re-derive `actualCents`; it adds up the stored value. |
| `apps/web/src/components/finance/BudgetBarChart.tsx` | Rows handed in by `FinanceDashboard` | `presentation` | Budget vs actual/projected by category. |
| `apps/web/src/components/finance/PortfolioSankey.tsx` | Nodes and links handed in by the portfolio page | `presentation` | Client wrapper so a server page can pass a formatter. |
| `apps/web/src/components/ui/Bento.tsx` | Values handed in | `presentation` | `StatGrid` / `StatTile` — the stat primitive every dashboard renders a headline number through. Owned by no domain; it is design system. |

## Client-side metrics

| Artefact | Source | Truth | Note |
|---|---|---|---|
| `apps/web/src/components/finance/LedgerDrawer.tsx` | Ledger entries handed in by `FinanceDashboard` | `derived-client` | Re-derives the line's actual as the sum of the entries on screen, deliberately and with the reason in the code: it must update as entries are posted, and the stored `actualCents` is the cache. Not an independent definition — the same formula `finance/actions.ts` writes. |
| `apps/web/src/components/finance/BudgetUpload.tsx` | The parsed spreadsheet preview, before anything is written | `derived-client` | Totals a preview the database has not seen yet. There is no server figure to disagree with. |
| `apps/web/src/components/ResourcesBrowser.tsx` | Resource rows handed in by the resources page | `derived-client` | Counts what the reader's filter left visible. A count of a view, not a metric of the institution. |

---

## What this inventory found

Three things worth naming, all of them acted on:

1. **The chart kit already carries a frame, and almost nothing uses it.**
   `ChartFrame` states title, question, source, as-of, unit, filters, accessible
   table and CSV — and exactly one panel in the product is wrapped in it. Six
   charts on `/reports` sit in a bare `Card` with no provenance line at all.
   That is ANL-020-001's work, not this requirement's, and it is recorded here
   so that requirement starts from a measured gap rather than a survey.
2. **One metric had two definitions.** Median time to decision was computed
   twice on the same page, over different scopes, with different formatting
   ladders — see ANL-000-002 and `apps/web/src/lib/analytics/metrics.ts`.
3. **`derived-client` is rarer than expected and every instance is traceable.**
   Six artefacts, each re-deriving something the server also knows, each with
   the reason stated in code. The prohibition the Bible names — a client
   inventing a canonical metric — was not found. That is a finding, and it is
   recorded as one rather than as an absence of work.
