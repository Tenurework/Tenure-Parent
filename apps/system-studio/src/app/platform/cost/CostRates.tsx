// Relative, per-file imports rather than the "@/" alias and rather than the
// `components/md3` barrel — the reason `CostReportView.tsx` beside this gives:
// apps/web's jest maps "@/" to its own src, and the barrel re-exports `Button`
// and `Tabs`, which reach `next/link`. This component is rendered by a plain
// `renderToStaticMarkup` in `cost-rates.test.tsx`, so nothing below may touch
// the Next runtime.
import { Badge } from "../../../components/md3/Badge"
import { Card } from "../../../components/md3/Card"
import { Chip } from "../../../components/md3/Chip"
import { DataTable, type DataColumn } from "../../../components/md3/DataTable"
import { EmptyState } from "../../../components/md3/EmptyState"
import { KeyValue } from "../../../components/md3/KeyValue"
import { StaleIndicator } from "../../../components/md3/StaleIndicator"
import { UnknownState } from "../../../components/md3/UnknownState"
import { PRICE_ATTRIBUTION_WHY, type PricingReadings } from "../../../lib/aws/pricing"

import { formatAmount } from "./cost-decisions"
import {
  HOURS_PER_MONTH,
  approvalWord,
  exactUnits,
  rateRows,
  ratesAnswer,
  standingMonthly,
  unknownGroups,
  type RateRow,
} from "./cost-rates"
import styles from "./cost.module.css"

/**
 * "What does the rate a quote is built from actually say?" — the fourth answer
 * on this page, and the one that grounds the other three.
 *
 * ## Why this belongs beside the budget and the month-to-date figure
 *
 * The panels above answer what the fleet HAS spent and whether anything is
 * running away. Neither answers what a change WOULD cost, and that is the
 * question every approval on this page is really about. Cost Explorer cannot
 * answer it — it reports consumption — so the answer has to come from the
 * published price list, which is what `lib/aws/pricing.ts` reads.
 *
 * Until this panel existed, that reader reached no screen at all. Its rates
 * existed, were tested, had a capability and an IAM grant, and an operator
 * approving a database still had nothing to check the catalogue's transcribed
 * figure against.
 *
 * ## The rule this panel is here to hold
 *
 * **An unpriced shape is UNKNOWN, and the total says so.** Not zero, not
 * omitted, not "priced items only". `standingMonthly` returns no amount at all
 * while any shape's rate is unresolved, and this component has no arm that
 * prints a figure beside a caveat — because the figure is what gets read. A
 * commitment approved against a total that quietly costed an unpriced item at
 * nothing is the exact surprise the price-tag requirement exists to prevent.
 *
 * ## And the rule about how a rate is printed
 *
 * A metered AWS rate is routinely finer than a cent — $0.0000166667 per
 * vCPU-hour — and formatting one at the currency's display precision produces
 * `$0.00`, which reads as free. So the unit column prints AWS's own published
 * decimal with the currency beside it, and carries the exact integer minor
 * units in the cell's `title`. The currency formatter appears only on the
 * monthly extension, where the figure is genuinely at that scale.
 */
export function CostRates({ readings, now }: { readings: PricingReadings; now?: number }) {
  const standing = standingMonthly(readings)
  const answer = ratesAnswer(readings, standing)
  const rows = rateRows(readings)
  const groups = unknownGroups(readings)

  return (
    <Card
      headline="What its shapes cost, per unit"
      headerAside={
        <>
          <Badge tone={answer.tone} title={answer.headline}>
            {answer.badge}
          </Badge>
          {/*
            A Chip, not a Badge: `.md3-badge` is `white-space: nowrap`, and an
            ISO timestamp in one runs past the card at the 320 CSS pixels
            `layout.spec.ts` measures.
          */}
          <Chip>
            <StaleIndicator
              asOf={readings.asOf}
              // The capability's own cadence, from the registry rather than a
              // literal here — a page that invents a refresh window is
              // describing a refresh nothing performs.
              cadenceMs={readings.refreshMs.products}
              now={now}
              label="the published price list"
            />
          </Chip>
        </>
      }
      supportingText={answer.headline}
    >
      {/*
        The refusals first, and once per distinct failure rather than once per
        shape. STUDIO-000-007: a read this engine could not perform carries the
        principal, the action and a pasteable minimum IAM statement, and never
        renders as an empty list or a zero.
      */}
      {groups.map((group) => (
        <UnknownState key={group.key} what={group.what} read={group.read} now={now} />
      ))}

      <div className={styles.rates}>
        <DataTable
          caption={`Every shape this estate provisions, at AWS's own published on-demand rate — ${rows.length} of them`}
          columns={COLUMNS}
          rows={rows}
          rowKey={(row) => row.key}
          empty={
            <EmptyState
              headline="No shape was priced on this page load"
              description={
                "This engine asked the Price List for nothing, so nothing here is grounded in a " +
                "published rate. That is not a report that these shapes are free."
              }
            />
          }
        />
      </div>

      {/*
        The running total, as a description list rather than a tile: it is a
        composition — a quantity, a currency, what is in it and what is not —
        and a single large figure would be read as the fleet's bill, which is
        the panel at the top of this page and a different number.
      */}
      <KeyValue
        ariaLabel="The running total, and exactly what is in it"
        items={[
          {
            key: "total",
            term: `One unit of each hourly shape, for ${HOURS_PER_MONTH} hours`,
            value: standing.known ? (
              <span
                title={`${exactUnits(standing.amount)}, summed as integers. No float holds this figure at any point.`}
              >
                {formatAmount(standing.amount)}
              </span>
            ) : (
              // The word, never a partial sum and never a zero. This is the
              // arm the whole panel exists to make reachable.
              <span title={standing.why}>Unknown — {standing.why}</span>
            ),
          },
          {
            key: "composition",
            term: "What is in it",
            value: standing.known
              ? `${standing.included.length} hourly shape(s): ${standing.included.join(", ")}`
              : standing.missing.length > 0
                ? `nothing is summed while ${standing.missing.length} shape(s) are unpriced: ${standing.missing.join(", ")}`
                : "nothing is summed — see the reason above",
          },
          {
            key: "excluded",
            term: "What is not, and why",
            value:
              standing.excluded.length === 0
                ? "nothing is left out of it silently"
                : standing.excluded
                    .map((excluded) => `${excluded.shape} — ${excluded.why}`)
                    .join(" · "),
          },
          {
            key: "approval",
            term: "What that commitment would need",
            /*
              The verdict is rendered HERE and never in a table cell. The
              approval-band table further down this page is asserted by
              `e2e/cost.spec.ts` with `getByRole("cell", …)`, and a second cell
              carrying the same verdict word would resolve that locator to two
              elements. The band is policy stated once; this is the policy read
              against a figure.
            */
            value: standing.known
              ? `${approvalWord(standing.approval)} — ${standing.approvalDetail}`
              : "not assessed. A commitment whose recurring cost is unknown cannot be approved on cost, and this engine will not band it as though it were small.",
          },
        ]}
      />

      <p className={`${styles.caveat} md3-body-medium`}>
        These are list prices, not a bill and not a forecast. The quantity above is stated rather
        than implied — one unit of each shape, for {HOURS_PER_MONTH} hours, which is AWS&rsquo;s own
        month — and it is not what this fleet runs; what it actually spent is the answer at the top
        of this page. A rate per request or per GB carries no monthly figure at all, because its
        quantity belongs to the plan being quoted and this engine will not invent one.
      </p>
      <p className={`${styles.caveat} md3-body-small`}>
        Attribution: shared — {PRICE_ATTRIBUTION_WHY}
      </p>
    </Card>
  )
}

/**
 * A row's columns.
 *
 * The unit rate is `align: "end"` with the others left: it is a figure read
 * against a fixed unit, and `end` also switches on `tabular-nums` so ten
 * published decimals line up column-wise instead of drifting.
 *
 * Every figure cell carries its whole truth in `title` — the exact integer minor
 * units for a resolved rate, and the reason for one that is not.
 */
const COLUMNS: readonly DataColumn<RateRow>[] = [
  {
    key: "shape",
    header: "Shape",
    cell: (row) => <code title={row.reads}>{row.key}</code>,
  },
  { key: "reads", header: "What it prices", cell: (row) => row.reads },
  {
    key: "unit",
    header: "Published rate",
    align: "end",
    cell: (row) => <span title={row.unit.title}>{row.unit.text}</span>,
  },
  {
    key: "monthly",
    header: `One unit, ${HOURS_PER_MONTH} hours`,
    align: "end",
    cell: (row) => <span title={row.monthly.title}>{row.monthly.text}</span>,
  },
  {
    key: "status",
    header: "The read",
    cell: (row) => (
      <Badge tone={row.tone} title={row.evidence}>
        {row.status}
      </Badge>
    ),
  },
  { key: "where", header: "Asked for", cell: (row) => row.where },
]
