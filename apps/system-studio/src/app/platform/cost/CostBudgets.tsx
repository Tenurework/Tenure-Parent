import {
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState,
  KeyValue,
  StaleIndicator,
  UnknownState,
  type DataColumn,
} from "@/components/md3"
import type { BudgetReadings } from "@/lib/aws/budgets"
import { describeAttribution } from "@/lib/aws/tags"

import { budgetRows, runawayAnswer, unknownArm, type BudgetRow } from "./cost-decisions"
import styles from "./cost.module.css"

/**
 * "Is anything running away?" — the third question this page answers, and the
 * only one that can be answered before a Cost and Usage Report exists.
 *
 * ## Why budgets and not an anomaly detector
 *
 * `@tenure/finops` has `detectAnomalies`, and it is the better instrument: it
 * compares this period against a baseline rather than against a number somebody
 * typed. It needs two periods of billed lines, and this fleet has none — so
 * using it here would mean inventing a baseline, and a fabricated baseline
 * produces alerts that are indistinguishable from real ones. AWS Budgets is the
 * instrument that exists today: AWS computes the forecast, this engine reads it,
 * and every figure below came off `budgets:DescribeBudgets` on this page load.
 *
 * ## The thing this panel exists to stop
 *
 * A budget alert threshold carries a subscriber list, and a threshold with an
 * empty one fires into nothing: the budget is breached, AWS evaluates the
 * notification, and no human is told. On every console that has ever shipped
 * this renders as the same quiet row as a budget that is fine.
 *
 * This engine cannot yet read subscriber lists — the two capabilities are not in
 * `capabilities.ts` — so every row's "who it notifies" reads UNKNOWN, the count
 * of unreachable budgets includes them, and `runawayAnswer`'s caveat survives
 * even the all-clear. That is deliberate: "we did not look" must never be the
 * most reassuring rendering on the page.
 */
export function CostBudgets({ readings, now }: { readings: BudgetReadings; now?: number }) {
  const read = readings.budgets
  const answer = runawayAnswer(read)
  const unknown = unknownArm(read)
  const rows = read.state === "ACTUAL" || read.state === "STALE" ? budgetRows(read.value) : []

  return (
    <Card
      headline="Is anything running away"
      headerAside={
        <>
          <Badge tone={answer.tone} title={answer.headline}>
            {answer.badge}
          </Badge>
          {/*
            A Chip, not a Badge: `.md3-badge` is `white-space: nowrap` because a
            status is one word, and an ISO timestamp in one runs past the card at
            the 320 CSS pixels `layout.spec.ts` measures.
          */}
          <Chip>
            <StaleIndicator
              asOf={readings.asOf}
              cadenceMs={readings.refreshMs}
              now={now}
              label="the account's budgets"
            />
          </Chip>
        </>
      }
      supportingText={answer.headline}
    >
      {/*
        The caveat is rendered ABOVE the table and outside every arm, because it
        is true whatever the table says — including when the table is all good
        news, which is the case it exists for.
      */}
      {answer.caveat ? (
        <p className={`${styles.caveat} md3-body-medium`}>{answer.caveat}</p>
      ) : null}

      {unknown ? (
        <UnknownState what="the account's budgets" read={unknown} now={now} />
      ) : read.state === "EMPTY" ? (
        <EmptyState
          headline="No budget is defined in this account"
          description={
            "AWS returned no budgets. Nothing is watching what this account spends, so nothing would " +
            "raise its hand if spend tripled tomorrow — which is a different fact from spend being " +
            "under control, and it is the one this engine can see."
          }
        />
      ) : (
        <div className={styles.budgets}>
          <DataTable
            caption={`Every budget in this account, as AWS computed it — ${rows.length} of them`}
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.key}
            empty={
              <EmptyState
                headline="No budget is defined in this account"
                description="Nothing is watching what this account spends."
              />
            }
          />
        </div>
      )}

      {/*
        Which tenant each budget's own cost filters watch is a separate fact from
        which tenant OWNS the budget resource, and a budget tagged for one and
        filtered to another is a real misconfiguration. Shown per row rather than
        collapsed into one column, so the mismatch is visible.
      */}
      {rows.length > 0 ? (
        <KeyValue
          ariaLabel="The budgets, counted"
          items={[
            {
              key: "counts",
              term: "Where they stand",
              value: answer.counts
                ? `${answer.counts.over} over · ${answer.counts.atRisk} projected over · ` +
                  `${answer.counts.within} within · ${answer.counts.noForecast} with no AWS forecast · ` +
                  `${answer.counts.noLimit} with no limit set`
                : "unknown",
            },
            {
              key: "reach",
              term: "Reaching a human",
              value:
                answer.unreachable === null
                  ? "unknown"
                  : `${answer.unreachable} of ${rows.length} cannot be shown to notify anybody`,
            },
            {
              key: "owner",
              term: "Who owns these budget resources",
              // From the resource's own tags, through the Resource Groups
              // Tagging API — the same attribution the estate page renders, and
              // through the same one renderer so an unattributable budget cannot
              // read as "shared" here and as "—" there.
              value: [...new Set(rows.map((row) => describeAttribution(row.owner)))].join("; "),
            },
          ]}
        />
      ) : null}
    </Card>
  )
}

/**
 * A row's columns.
 *
 * Money is `align: "end"` so the digits line up column-wise, and every money
 * cell carries its integer minor units in the `title` — `$120.00` is what a
 * person reads and `12000 minor units of USD` is what the platform stores, with
 * no float anywhere between them.
 */
const COLUMNS: readonly DataColumn<BudgetRow>[] = [
  {
    key: "name",
    header: "Budget",
    cell: (row) => <span title={row.arn}>{row.name}</span>,
  },
  { key: "watches", header: "Watches", cell: (row) => row.watches },
  {
    key: "limit",
    header: "Limit",
    align: "end",
    cell: (row) => <span title={row.limit.title}>{row.limit.text}</span>,
  },
  {
    key: "actual",
    header: "Spent",
    align: "end",
    cell: (row) => <span title={row.actual.title}>{row.actual.text}</span>,
  },
  {
    key: "forecast",
    header: "AWS forecast",
    align: "end",
    cell: (row) => <span title={row.forecast.title}>{row.forecast.text}</span>,
  },
  {
    key: "posture",
    header: "Where it stands",
    cell: (row) => (
      <Badge tone={row.tone} title={row.postureDetail}>
        {row.posture}
      </Badge>
    ),
  },
  {
    key: "notifies",
    header: "Who it notifies",
    cell: (row) => (
      <Badge tone={row.notifies.tone} title={row.notifies.detail}>
        {row.notifies.word}
      </Badge>
    ),
  },
]
