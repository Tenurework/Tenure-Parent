// Relative rather than the "@/" alias throughout this file, so it can be
// rendered by a test runner that does not carry the Studio's path mapping — see
// cost-citation.test.tsx beside it. apps/web's jest maps "@/" to apps/web's own
// src, so an aliased import here would resolve to the wrong app.
import type { CostReport } from "../../../lib/cost-report"
// Per-file rather than through the `components/md3` barrel, for the same reason
// the imports above are relative: the barrel re-exports `Button` and `Tabs`,
// which import `next/link`, and this component is rendered by a plain
// `renderToStaticMarkup` in `cost-citation.test.tsx`. Nothing below reaches the
// Next runtime. `components/md3/aws-outcomes.test.tsx` imports the same way.
import { Badge } from "../../../components/md3/Badge"
import { Card } from "../../../components/md3/Card"
import { Chip } from "../../../components/md3/Chip"
import { DataTable, type DataColumn } from "../../../components/md3/DataTable"
import { EmptyState } from "../../../components/md3/EmptyState"
import { KeyValue } from "../../../components/md3/KeyValue"

import { citation, formatAmount, minorUnits } from "./cost-decisions"
import styles from "./cost.module.css"

/**
 * The connected arm of the FinOps Center: what a real bill says, once one is
 * being read.
 *
 * Its own module rather than a function inside `page.tsx` for one reason: the
 * page imports `@/lib/auth` and `next/link`, so nothing can render it outside a
 * Next request, and a citation nobody can render is a citation nobody has
 * checked. Everything here is pure — a report in, markup out — and
 * `cost-citation.test.tsx` renders it against a report built by the real
 * `buildCostReport`, which is the only place a figure's provenance is set.
 *
 * ## What changed when this page was brought onto the primitives
 *
 * The four regions here were `<section className="system">` with `<table
 * className="grid">` inside and `<span className="badge warn">` on top: class
 * strings this route had accumulated, whose meaning lived in a global
 * stylesheet nothing on this page referenced. They are now `Card` and
 * `DataTable`, which means the tables scroll inside their own bounded region
 * (`layout.spec.ts` runs this route at 320 CSS pixels and treats a sideways
 * page scroll as a defect), the captions are rendered rather than implied, and
 * the reconciliation verdict is a `Badge` tone rather than `className="ok"` /
 * `className="error"` — the one place this file carried meaning in a colour
 * whose contrast nothing measured.
 */

export function CostReportView({ report }: { report: CostReport }) {
  const { summary, reconciliation, tenants, unallocated, splits } = report

  return (
    <>
      <Card
        headline="This month, from the bill"
        headerAside={
          <>
            <Badge tone={summary.freshness.stale ? "warn" : "neutral"}>
              {summary.freshness.stale ? "stale" : "fresh"}
            </Badge>
            <Chip>as of {summary.freshness.asOf}</Chip>
            {/* The citation, BESIDE the as-of and not instead of it. Two
                different facts: when the data is current as of, and which system
                said so. PAY-180-003. */}
            <Chip data-testid="figure-source">{citation(summary.actual.source)}</Chip>
          </>
        }
        supportingText={
          summary.freshness.stale
            ? `This data is ${Math.round(summary.freshness.ageHours)} hours old. AWS billing settles over days, so recent spend may be missing entirely rather than merely late.`
            : "Every figure below traces to a billed line in the connected Cost and Usage Report."
        }
      >
        <KeyValue
          ariaLabel="This month's totals"
          items={[
            {
              key: "actual",
              term: "Actual, month to date",
              value: (
                <>
                  <span title={minorUnits(summary.actual.amount)}>
                    {formatAmount(summary.actual.amount)}
                  </span>{" "}
                  — {Math.round(summary.actual.periodCompleteness * 100)}% through the period
                </>
              ),
            },
            {
              key: "amortized",
              term: "Amortized",
              value: (
                <>
                  <span title={minorUnits(summary.amortized.amount)}>
                    {formatAmount(summary.amortized.amount)}
                  </span>{" "}
                  — what this month&rsquo;s usage cost, with commitments spread over their term.
                </>
              ),
            },
            {
              key: "forecast",
              term: "Forecast",
              value: summary.forecast ? (
                <>
                  <span title={minorUnits(summary.forecast.amount)}>
                    {formatAmount(summary.forecast.amount)}
                  </span>{" "}
                  {/* The forecast carries its own citation, marked derived, so
                      nothing can present a projection as a billed line. */}
                  — {summary.forecast.source.reference}
                </>
              ) : (
                "Unknown — too early in the period to project without inventing a number."
              ),
            },
            {
              key: "unallocated",
              term: "Reached no tenant",
              value: (
                <>
                  <span title={minorUnits(summary.unallocated)}>
                    {formatAmount(summary.unallocated)}
                  </span>{" "}
                  — {(summary.unallocatedShare * 100).toFixed(1)}% of spend reached no tenant.
                  Reported, not spread.
                </>
              ),
            },
          ]}
        />

        {/* The property that makes the rest worth reading. Shown, not assumed. */}
        <p className={`${styles.caveat} md3-body-medium`}>
          <Badge tone={reconciliation.reconciles ? "ok" : "bad"}>
            {reconciliation.reconciles ? "reconciles" : "does not reconcile"}
          </Badge>{" "}
          {reconciliation.reconciles
            ? `Tenant costs plus unallocated equal the ${summary.lineCount} ingested lines exactly.`
            : `${formatAmount(reconciliation.discrepancy)} is unaccounted for across ${summary.lineCount} lines. ` +
              `This is shown rather than absorbed into the largest tenant.`}
        </p>
      </Card>

      <Card
        headline="By tenant"
        headerAside={<Chip>as of {summary.freshness.asOf}</Chip>}
        supportingText="Direct spend is what the tenant's own tagged resources cost. An allocated share is its part of a shared cost, and the driver that decided the share travels with it."
      >
        <div className={styles.wide}>
          <DataTable
            caption="What each tenant's spend was this period, and how any shared part of it was decided"
            columns={TENANT_COLUMNS}
            rows={tenants}
            rowKey={(tenant) => tenant.tenantId}
            empty={
              <EmptyState
                headline="No tenant carried any of this bill"
                description="Every ingested line reached no tenant. That is a tagging gap, not an empty bill — the total above is unchanged."
              />
            }
          />
        </div>
      </Card>

      {splits.length > 0 && (
        <Card
          headline="Shared-cost splits"
          headerAside={
            <>
              <Badge title="A reversal returns the recorded amount negated, rather than running the split rule again.">
                reversal replays, never re-derives
              </Badge>
              <Chip>as of {summary.freshness.asOf}</Chip>
            </>
          }
          supportingText="Every shared cost a driver covered, per recipient, with what reversing the split returns them. The reversal is the recorded amount negated — not the rule run again. Re-deriving a largest-remainder split on the way back moves the leftover units between recipients, and the total still nets to zero while two tenants are permanently a unit out, in opposite directions."
        >
          <div className={styles.wide}>
            <DataTable
              caption="Each recorded split, per recipient, with its reversal"
              columns={SPLIT_COLUMNS}
              rows={splits.flatMap(({ split, reversal }) =>
                split.parts.map((part, index) => ({
                  key: `${split.splitId}-${part.recipientId}`,
                  splitId: index === 0 ? split.splitId : "",
                  recipientId: part.recipientId,
                  received: part.amount,
                  returns: reversal[index].amount,
                })),
              )}
              rowKey={(row) => row.key}
              empty={
                <EmptyState
                  headline="No shared cost was split this period"
                  description="Nothing in this bill was covered by an allocation driver."
                />
              }
            />
          </div>
        </Card>
      )}

      {unallocated.length > 0 && (
        <Card
          headline="Unallocated — the remainder no tenant owns"
          headerAside={
            <>
              <Badge tone="warn" title={minorUnits(summary.unallocated)}>
                {formatAmount(summary.unallocated)}
              </Badge>
              <Chip>as of {summary.freshness.asOf}</Chip>
            </>
          }
          supportingText="Spend that reached no tenant, with the reason. It is not distributed: a split nobody chose produces a page whose total reconciles and whose every row is wrong."
        >
          <div className={styles.wide}>
            <DataTable
              caption="Every service whose spend reached no tenant, and why"
              columns={UNALLOCATED_COLUMNS}
              rows={unallocated}
              rowKey={(entry) => `${entry.service}-${entry.lineIds[0]}`}
              empty={
                <EmptyState
                  headline="Every ingested line reached a tenant"
                  description="Nothing in this bill is unallocated."
                />
              }
            />
          </div>
        </Card>
      )}
    </>
  )
}

type TenantRow = CostReport["tenants"][number]

const TENANT_COLUMNS: readonly DataColumn<TenantRow>[] = [
  { key: "tenant", header: "Tenant", cell: (row) => <code>{row.tenantId}</code> },
  {
    key: "direct",
    header: "Direct",
    align: "end",
    cell: (row) => <span title={minorUnits(row.direct)}>{formatAmount(row.direct)}</span>,
  },
  {
    key: "allocated",
    header: "Allocated share",
    align: "end",
    cell: (row) => <span title={minorUnits(row.allocated)}>{formatAmount(row.allocated)}</span>,
  },
  {
    key: "total",
    header: "Total",
    align: "end",
    cell: (row) => <span title={minorUnits(row.total)}>{formatAmount(row.total)}</span>,
  },
  {
    key: "driver",
    header: "Driver",
    // The justification travels with the number. "Why is this tenant paying
    // $412 of the NAT gateway" has an answer here rather than in a comment.
    cell: (row) =>
      row.attributions.length === 0
        ? "none — this is all direct spend"
        : row.attributions.map((a) => `${a.measure} (${a.weight}/${a.totalWeight})`).join("; "),
  },
]

interface SplitRow {
  key: string
  splitId: string
  recipientId: string
  received: Parameters<typeof formatAmount>[0]
  returns: Parameters<typeof formatAmount>[0]
}

const SPLIT_COLUMNS: readonly DataColumn<SplitRow>[] = [
  { key: "split", header: "Split", cell: (row) => row.splitId },
  { key: "recipient", header: "Recipient", cell: (row) => <code>{row.recipientId}</code> },
  {
    key: "received",
    header: "Received",
    align: "end",
    cell: (row) => <span title={minorUnits(row.received)}>{formatAmount(row.received)}</span>,
  },
  {
    key: "returns",
    header: "Reversal returns",
    align: "end",
    cell: (row) => <span title={minorUnits(row.returns)}>{formatAmount(row.returns)}</span>,
  },
]

type UnallocatedRow = CostReport["unallocated"][number]

const UNALLOCATED_COLUMNS: readonly DataColumn<UnallocatedRow>[] = [
  { key: "service", header: "Service", cell: (row) => row.service },
  {
    key: "amount",
    header: "Amount",
    align: "end",
    cell: (row) => <span title={minorUnits(row.amount)}>{formatAmount(row.amount)}</span>,
  },
  { key: "why", header: "Why", cell: (row) => row.reason },
  { key: "lines", header: "Lines", align: "end", cell: (row) => row.lineIds.length },
]
