# Analytics limitations and blocked sources — what the numbers cannot do

ANL-040-005. The Analytics Bible §17 asks for "exact metric/report/analytics
limitations and blocked sources" to be **published**, and §19 prohibits "claiming
capability beyond measured released scope". This file is that publication, for
the analytics, reporting and visualization surface only.

It exists because the alternative was already on the record and was wrong. The
stylesheet that carries the chart palette says, in a comment at
`apps/web/src/app/globals.css:13`, that the eight categorical slots are
"validated CVD-safe in BOTH modes … via the data-viz validator". Nothing
validated anything: the simulator that would have measured it,
`apps/web/src/components/charts/cvd.ts`, was imported by no file in the
repository — `grep -rn "cvd" apps packages tools tests` returned only itself —
and its own header named a consumer, `cvd.test.ts`, that did not exist. A
limitation nobody measured reads exactly like a limitation nobody has.

## How each claim here is held to the code

Every number below is **derived on every run** and compared against what is
written here, in both directions — a claim with no code behind it fails, and a
new gap nobody published fails too.

| Section | What checks it |
|---|---|
| Metric limitations declared in code | `tests/architecture/anl-limitations-are-published.test.mjs` |
| Colour-vision separation | `apps/web/src/components/charts/cvd.test.ts` (jest — it needs the TypeScript simulator) |
| Chart-frame contract and adoption | `tests/architecture/anl-limitations-are-published.test.mjs` |
| Visualization grammar coverage | `tests/architecture/anl-limitations-are-published.test.mjs` |
| Undecided requirements | `tests/architecture/anl-limitations-are-published.test.mjs` |

    node --test tests/architecture/anl-limitations-are-published.test.mjs
    npm run test --workspace apps/web -- --ci -t "colour-vision"

---

## 1. Metric limitations declared in code

The governed metrics live in `apps/web/src/lib/analytics/metrics.ts` (ANL-000-002).
A metric that has a limitation states it in its own doc comment under a
`**Limitation.**` heading, and every one of them is republished here. The guard
holds the two sets equal, so a metric that gains a caveat and does not appear
here fails the build.

<!-- metric-limitations -->

| Module | Export | Limitation |
|---|---|---|
| `apps/web/src/lib/analytics/metrics.ts` | `medianDurationMs` | The lower median for an even-sized population, not the mean of the middle two. It matters on small populations, which is every institution in the pilot. |

<!-- /metric-limitations -->

**One entry is not a claim that one limitation exists.** It is the count of
limitations *declared where a machine can find them*. Two known caveats are not
in that form and are stated here by hand:

- `medianDurationMs` is non-additive, so no roll-up across organizations or
  periods is available at all — a median of medians is not a median.
- `formatDuration(null)` renders an em dash rather than `0`, which is the
  correct behaviour and also means "no decisions measured" and "decided
  instantly" are visually distinct only if the reader knows that rule.

## 2. Colour-vision: the palette is not separable, and the stylesheet says it is

`cvd.ts` computes the Viénot / Brettel / Mollon dichromat simulation and CIE76
ΔE between the simulated pair, and declares its own floor: `CVD_SEPARATION_FLOOR
= 20`. Pairs below it "are not an automatic failure; they are WARNs that must be
enumerated with their measured value". They had never been enumerated. Measured
now, over the eight `--chart-1…8` slots, three dichromacies and 28 slot pairs —
84 pairs per theme:

- **10 of the 57 pairs** that can be measured fall below the ΔE-20 floor in the
  light themes;
- **10 of the 56 pairs** that can be measured fall below it in the dark themes;
- the two worst are on dark and are not close calls: a deuteranope sees
  `--chart-5` and `--chart-7` **1.61 ΔE** apart and `--chart-2` and `--chart-4`
  **4.22 ΔE** apart. Both pairs are on screen together in
  `ReportsAnalytics.tsx`, which draws five marks off the same eight slots.

`@media (prefers-contrast: more)` does not help: it overrides text and border
tokens and leaves `--chart-1…8` alone, so the high-contrast themes measure
identically to the default ones.

Every pair that could be measured, worst first. `tritanopia 1~5` is the single
tritanopia pair on light whose simulation stayed inside the gamut; the rest of
that vision is in the table further down.

**Why this is a limitation and not merely a WARN.** `cvd.ts` accepts sub-floor
pairs when "the secondary encoding the chart kit already mandates (legend +
direct labels + 2px gaps)" carries the identity instead. The legend does not:
`ChartLegend.tsx` renders an `aria-hidden` swatch and says so in its own header —
"identity comes from the swatch beside them". Two series whose hues collide are
therefore indistinguishable in the mark *and* in the legend, which is what §12
means by "use pattern/shape/label in addition to colour". No mark in the kit
draws a pattern or a shape difference.

Light themes (`light`, `light-contrast` — identical):

<!-- cvd:light -->

| Vision | Slot | Slot | ΔE76 after simulation |
|---|---|---|---|
| deuteranopia | 2 | 4 | 5.29 |
| protanopia | 2 | 4 | 12.16 |
| tritanopia | 1 | 5 | 14.82 |
| protanopia | 1 | 8 | 14.83 |
| protanopia | 3 | 6 | 14.97 |
| deuteranopia | 3 | 6 | 16.54 |
| deuteranopia | 4 | 8 | 16.72 |
| deuteranopia | 2 | 8 | 16.83 |
| protanopia | 1 | 4 | 18.77 |
| deuteranopia | 5 | 7 | 19.65 |

<!-- /cvd:light -->

Dark themes (`dark`, `dark-contrast` — identical):

<!-- cvd:dark -->

| Vision | Slot | Slot | ΔE76 after simulation |
|---|---|---|---|
| deuteranopia | 5 | 7 | 1.61 |
| deuteranopia | 2 | 4 | 4.22 |
| protanopia | 5 | 7 | 10.74 |
| protanopia | 2 | 4 | 14.02 |
| protanopia | 1 | 8 | 14.13 |
| deuteranopia | 3 | 6 | 14.67 |
| protanopia | 3 | 6 | 15.03 |
| deuteranopia | 4 | 8 | 15.94 |
| protanopia | 1 | 4 | 16.03 |
| deuteranopia | 2 | 8 | 19.76 |

<!-- /cvd:dark -->

### The tritanopia answer is "cannot measure", not "safe"

This is the part a summary would get wrong, and the first version of this
document did. Read plainly, the numbers above cover protanopia and deuteranopia
and **almost nothing about tritanopia**, because on this palette the Viénot
single-plane projection leaves the display gamut: the simulated blue channel
lands as far out as linear **-2.042** (-521 on a 0–255 axis) and **+1.451**.
`toSrgb` clamps that to 0 or 255, and the clamp is what a naive audit then
measures — six of eight light slots and seven of eight dark slots collapse onto
two clamped values, and ΔE duly reports pairs 0.45 and 0.50 apart as
indistinguishable hues. They are not hues at all.

`cvd.ts` therefore refuses those pairs instead of scoring them (`outOfGamut`,
`cvdAudit`), which leaves **27 of the 28 tritanopia pairs unmeasured on light and
28 of the 28 tritanopia pairs unmeasured on dark**. The one light pair that can
be measured, `--chart-1` against `--chart-5`, is below the floor at ΔE 14.82.

So the honest statement is: the palette is **measurably not separable for
red-green dichromacy**, and **unassessed for tritanopia**. Assessing it needs the
Brettel two-plane simulation, which this module does not implement.

Light slots the tritanopia projection cannot place, with the linear channel value
it produced:

<!-- gamut:light -->

| Vision | Slot | Channel | Linear value |
|---|---|---|---|
| tritanopia | 2 | b | -0.716 |
| tritanopia | 3 | b | 1.346 |
| tritanopia | 4 | b | -1.783 |
| tritanopia | 6 | b | -1.225 |
| tritanopia | 7 | b | 1.226 |
| tritanopia | 8 | b | -1.751 |

<!-- /gamut:light -->

Dark:

<!-- gamut:dark -->

| Vision | Slot | Channel | Linear value |
|---|---|---|---|
| tritanopia | 1 | b | 1.113 |
| tritanopia | 2 | b | -0.713 |
| tritanopia | 3 | b | 1.451 |
| tritanopia | 4 | b | -1.710 |
| tritanopia | 6 | b | -1.172 |
| tritanopia | 7 | b | 1.425 |
| tritanopia | 8 | b | -2.042 |

<!-- /gamut:dark -->

A protanopia or deuteranopia slot has never left the gamut on this palette, which
is why the twenty collisions above are measurements rather than artefacts.

**Not fixed here, deliberately.** Eight simultaneously separable hues across
three dichromacies is a palette redesign in `globals.css`, which is the design
system's file and not analytics'. What is fixed is that the numbers now exist,
are pinned, and fail the build the moment a hue moves.

## 3. The shared chart frame carries 9 of the 14 slots §7 names

§7's opening paragraph lists what a `ChartFrame` must contain. `ChartFrame.tsx`
carries nine of the fourteen. The mapping is derived from the component's own
prop list, so a slot cannot be claimed without a prop behind it:

<!-- frame-slots -->

| §7 slot | ChartFrame prop |
|---|---|
| title | `title` |
| question | `question` |
| metric definition | — |
| source | `source` |
| freshness | `asOf` |
| filters | `filters` |
| comparison | `comparison` |
| unit/currency | `unit` |
| uncertainty | — |
| annotations | — |
| legend | — |
| accessible data table | `table` |
| export | `fileName` |
| drill-through | — |

<!-- /frame-slots -->

The five missing slots are not cosmetic. **Metric definition** is what makes a
number auditable and is ANL-000-003's persisted `MetricDefinition`, which does
not exist. **Uncertainty** is what stops a forecast being read as a fact.
**Drill-through** is §9's "source-record drill-through" and the reason a reader
can check a number rather than believe it.

### Adoption: 1 of 9 mark-rendering modules sits in a frame

The frame is only a frame where it is used. Nine modules render a chart mark;
one of them wraps it in `ChartFrame`. The other eight ship no accessible data
table, no CSV export and no provenance line at all:

<!-- bare-marks -->

- `apps/web/src/app/(app)/admin/page.tsx`
- `apps/web/src/app/(app)/dashboard/page.tsx`
- `apps/web/src/app/(app)/reports/page.tsx`
- `apps/web/src/components/charts/panels/ReportsAnalytics.tsx`
- `apps/web/src/components/finance/BudgetBarChart.tsx`
- `apps/web/src/components/finance/FinanceDashboard.tsx`
- `apps/web/src/components/finance/PortfolioSankey.tsx`
- `apps/web/src/components/ui/Bento.tsx`

<!-- /bare-marks -->

`apps/web/src/components/charts/panels/ActivityChart.tsx` is the one that does.
`ReportsAnalytics.tsx` is the costliest omission: it renders five marks —
including the Sankey — with no table alternative for any of them.

## 4. Visualization grammar: 10 of the 45 marks §7 names

The kit is thirteen modules. Each is either a mark or frame chrome, and the
disposition is held to the directory listing in both directions:

<!-- kit-modules -->

| Module | Disposition |
|---|---|
| `BarChart.tsx` | mark |
| `ChartEmpty.tsx` | chrome |
| `ChartFrame.tsx` | chrome |
| `ChartLegend.tsx` | chrome |
| `ChartTooltip.tsx` | chrome |
| `DonutChart.tsx` | mark |
| `HBarChart.tsx` | mark |
| `LineAreaChart.tsx` | mark |
| `LiveStats.tsx` | mark |
| `Meter.tsx` | mark |
| `RangeFilter.tsx` | chrome |
| `SankeyChart.tsx` | mark |
| `Sparkline.tsx` | mark |

<!-- /kit-modules -->

Every mark §7.1–§7.10 names, and what ships it. `—` means **not shipped**: no
module in the kit draws it, and no page draws it by hand.

<!-- grammar -->

| §7 family | Mark | Shipped by |
|---|---|---|
| 7.1 Comparison and ranking | bar/column | `BarChart.tsx`, `HBarChart.tsx` |
| 7.1 Comparison and ranking | grouped bar | `BarChart.tsx` |
| 7.1 Comparison and ranking | dot/lollipop | — |
| 7.1 Comparison and ranking | bullet | — |
| 7.2 Time and change | line | `LineAreaChart.tsx` |
| 7.2 Time and change | step | — |
| 7.2 Time and change | area | `LineAreaChart.tsx` |
| 7.2 Time and change | stacked area | — |
| 7.2 Time and change | small multiples | — |
| 7.2 Time and change | calendar heatmap | — |
| 7.2 Time and change | event-overlay timeline | — |
| 7.3 Financial bridges and variance | waterfall/bridge | — |
| 7.3 Financial bridges and variance | variance bars | — |
| 7.3 Financial bridges and variance | contribution tree | — |
| 7.3 Financial bridges and variance | driver decomposition | — |
| 7.4 Distribution and relationship | histogram | — |
| 7.4 Distribution and relationship | box/violin | — |
| 7.4 Distribution and relationship | scatter/bubble | — |
| 7.4 Distribution and relationship | correlation matrix | — |
| 7.4 Distribution and relationship | cohort heatmap | — |
| 7.5 Composition and hierarchy | stacked bar | `BarChart.tsx` |
| 7.5 Composition and hierarchy | treemap | — |
| 7.5 Composition and hierarchy | sunburst | — |
| 7.5 Composition and hierarchy | pie/donut | `DonutChart.tsx` |
| 7.6 Flow and lineage | sankey/alluvial | `SankeyChart.tsx` |
| 7.7 Process and funnel | funnel | — |
| 7.7 Process and funnel | stage conversion | — |
| 7.7 Process and funnel | process-mining map | — |
| 7.7 Process and funnel | control chart | — |
| 7.7 Process and funnel | SLA aging | — |
| 7.8 Schedule, capacity and dependency | gantt/timeline | — |
| 7.8 Schedule, capacity and dependency | capacity heatmap | — |
| 7.8 Schedule, capacity and dependency | resource histogram | — |
| 7.8 Schedule, capacity and dependency | critical-path/dependency graph | — |
| 7.8 Schedule, capacity and dependency | plan-vs-actual bands | — |
| 7.9 Organization, network and geography | org tree/graph | — |
| 7.9 Organization, network and geography | relationship network | — |
| 7.9 Organization, network and geography | site/map | — |
| 7.9 Organization, network and geography | route | — |
| 7.9 Organization, network and geography | choropleth/symbol maps | — |
| 7.10 KPI and status | metric/scorecard | `LiveStats.tsx` |
| 7.10 KPI and status | sparkline | `Sparkline.tsx` |
| 7.10 KPI and status | bullet | — |
| 7.10 KPI and status | progress | `Meter.tsx` |
| 7.10 KPI and status | control-limit | — |

<!-- /grammar -->

Three families — 7.3 financial bridges, 7.4 distribution, 7.8 schedule — have
**no mark at all**, and each is a domain minimum in §8: variance waterfall for
Finance, sensitivity for Planning, Gantt and capacity for Operations. Anything
those surfaces show today is a bar or a line standing in for a mark that does
not exist.

Two near-misses worth stating so nobody counts them as coverage:

- `/reports` renders approval stages as horizontal bars. That is a ranked bar
  chart of stage counts, not a **funnel**: nothing preserves the cohort or the
  re-entry behaviour §7.7 requires.
- `BarChart` accepts an `overlayLine`, which is a trend on the same scale. It is
  not **plan-vs-actual bands** and it is not a **control chart** — there is no
  band, no limit and no signal rule.

## 5. Blocked sources

A source is blocked when the platform cannot read it at all. Both entries below
distinguish "we looked and found nothing" from "we could not look", which is the
distinction the whole codebase is built on — neither renders a zero.

| Source | State | What it blocks | What would unblock it |
|---|---|---|---|
| AWS Cost and Usage Report / Cost Explorer | `NOT_CONFIGURED` — `apps/system-studio/src/lib/cost-source.ts` returns a discriminated `CostSource` and the page renders the arm it gets | Every cost figure on the FinOps surface, and the tenant-cost Sankey §7.6 names | An AWS Organization, a CUR export, and the `FINOPS_CUR_BUCKET` / `FINOPS_CUR_PREFIX` environment the module names |
| Persisted semantic layer — metric definitions, versions, datasets, saved views | Absent. `apps/web/prisma/schema.prisma` declares none of the 26 canonical objects §3 names | Metric certification, effective-dated versions, impact analysis, subscriptions, and the "metric definition" frame slot above | The schema change and migration recorded against ANL-000-003 in the analytics ledger |

## 6. Requirements not yet decided

The honest denominator. The Analytics Bible states 27 `ANL-*` requirements; the
ones below are not `PASS` in
`docs/implementation/analytics-reporting-execution-ledger.md`, which means the
capability they describe is **not claimed**. The list is compared against the
ledger on every run, so it cannot drift in either direction — closing one
requires publishing that here.

<!-- undecided -->
```
ANL-000-003  BLOCKED_EXTERNAL
ANL-010-001  FAIL
ANL-010-002  FAIL
ANL-010-003  FAIL
ANL-010-004  FAIL
ANL-020-001  FAIL
ANL-020-002  FAIL
ANL-020-003  FAIL
ANL-020-004  FAIL
ANL-020-005  FAIL
ANL-030-001  FAIL
ANL-030-002  FAIL
ANL-030-003  FAIL
ANL-030-004  FAIL
ANL-040-001  FAIL
ANL-040-002  FAIL
ANL-040-003  FAIL
ANL-040-004  FAIL
ANL-GATE-000  FAIL
ANL-GATE-010  FAIL
ANL-GATE-020  FAIL
ANL-GATE-030  FAIL
ANL-GATE-040  FAIL
```
<!-- /undecided -->

`ANL-GATE-000` deserves its own sentence, because it is the one a reader is most
likely to assume: metrics and reports do **not** yet have one governed
definition and source everywhere. Two of its four children are `PASS` — the
inventory and the de-duplication — and the third is blocked on the schema, so
the gate cannot be claimed no matter how the arithmetic is arranged.
