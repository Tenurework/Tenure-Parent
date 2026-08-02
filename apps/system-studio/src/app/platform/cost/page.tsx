import Link from "next/link"

import {
  PEER_THRESHOLD_MINOR,
  TWO_PERSON_THRESHOLD_MINOR,
  EXECUTIVE_THRESHOLD_MINOR,
  toDecimal,
  money,
} from "@tenure/finops"

import { EmptyState } from "@/components/states"
import { costSource, type CostReport } from "@/lib/cost-source"
import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"

/**
 * The FinOps Center — STUDIO-120-008/009/010.
 *
 * What the fleet costs, what each tenant costs, what could not be attributed to
 * anyone, and how much approval a new commitment needs.
 *
 * The page has two arms and only two. Either a Cost and Usage Report is
 * connected and every figure traces to a billed line, or none is and the page
 * says so and explains what an operator must do about it. There is deliberately
 * no third arm showing sample data: the bible's prohibited-shortcut list names
 * "fake cost", and this is the page from which someone approves an Aurora
 * cluster. An empty page is obviously empty; $4,182.55 is actionable and wrong.
 */
export const dynamic = "force-dynamic"

const usd = (units: number) => `$${toDecimal(money(units, "USD"))}`

export default async function CostPage() {
  // The same gate every operator page uses. Not extracted into a helper here:
  // that is a refactor across six passing pages, and this one does not need it.
  const session = await auth()
  if (!isOperator(session?.user?.email)) {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }

  const source = await costSource()

  return (
    <>
      <h1>Cost</h1>
      <p>
        What the fleet costs, allocated to tenants by resource tag, with shared spend split by a stated
        driver and everything else reported unallocated rather than spread. Every figure carries its
        currency and the moment the billing data was last refreshed.
      </p>

      {source.state === "NOT_CONFIGURED" ? (
        <section className="system">
          <header>
            <h2>No billing data is connected</h2>
            <span className="badge warn">not configured</span>
          </header>

          <EmptyState what="cost data" because={source.why} />

          <h3>What connects it</h3>
          {/*
            Steps rather than a support link. This is a blocked dependency with
            an exact remedy, and the remedy belongs where the gap is visible —
            an operator who reaches this page should not have to find a runbook
            to learn that the missing piece is a CUR delivery and two
            environment variables.
          */}
          <ol className="steps">
            {source.operatorSteps.map((step) => (
              <li key={step}>
                <code>{step}</code>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <CostReportView report={source.report} />
      )}

      {/* ── Approval thresholds ──────────────────────────────────────────
          Shown whether or not billing data is connected, because they govern
          what a plan may commit to and that is true before the first bill
          arrives. STUDIO-120-010. */}
      <section className="system">
        <header>
          <h2>Approval thresholds</h2>
          <span className="badge quiet">per month, recurring</span>
        </header>
        <p>
          Assessed on the <b>recurring monthly</b> cost of a change, not its one-off price. A NAT
          gateway costs about $32 to create and $390 a year to keep; a threshold applied to the former
          approves the latter without anyone seeing it. A plan&rsquo;s total is assessed as well as each
          change in it, so ten small commitments cannot add up to a large one nobody approved.
        </p>
        <table className="grid">
          <thead>
            <tr>
              <th>Monthly cost</th>
              <th>Approval</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>under {usd(PEER_THRESHOLD_MINOR)}</td>
              <td>none</td>
              <td>Recorded but not gated, so the pattern is visible even when each instance is not.</td>
            </tr>
            <tr>
              <td>{usd(PEER_THRESHOLD_MINOR)} and above</td>
              <td>one reviewer</td>
              <td>Small but recurring. One reviewer, so that it is at least seen.</td>
            </tr>
            <tr>
              <td>{usd(TWO_PERSON_THRESHOLD_MINOR)} and above</td>
              <td>two people</td>
              <td>Material. Neither approver may be the requester.</td>
            </tr>
            <tr>
              <td>{usd(EXECUTIVE_THRESHOLD_MINOR)} and above</td>
              <td>executive</td>
              <td>A budget decision, not an engineering one.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p className="slug">
        <Link href="/platform">← back to Platform</Link>
      </p>
    </>
  )
}

function CostReportView({ report }: { report: CostReport }) {
  const { summary, reconciliation, tenants, unallocated } = report

  return (
    <>
      <section className="system">
        <header>
          <h2>This month</h2>
          <span className={`badge ${summary.freshness.stale ? "warn" : "quiet"}`}>
            as of {summary.freshness.asOf}
          </span>
        </header>

        {summary.freshness.stale && (
          <p className="hint">
            This data is {Math.round(summary.freshness.ageHours)} hours old. AWS billing settles over
            days, so recent spend may be missing entirely rather than merely late.
          </p>
        )}

        <table className="grid">
          <tbody>
            <tr>
              <td>Actual, month to date</td>
              <td className="num">{usd(summary.actual.amount.units)}</td>
              <td>{Math.round(summary.actual.periodCompleteness * 100)}% through the period</td>
            </tr>
            <tr>
              <td>Amortized</td>
              <td className="num">{usd(summary.amortized.amount.units)}</td>
              <td>What this month&rsquo;s usage cost, with commitments spread over their term.</td>
            </tr>
            <tr>
              <td>Forecast</td>
              <td className="num">{summary.forecast ? usd(summary.forecast.amount.units) : "—"}</td>
              <td>
                {summary.forecast
                  ? "Straight-line projection to the end of the period. A guess, labelled as one."
                  : "Too early in the period to project without inventing a number."}
              </td>
            </tr>
            <tr>
              <td>Unallocated</td>
              <td className="num">{usd(summary.unallocated.units)}</td>
              <td>
                {(summary.unallocatedShare * 100).toFixed(1)}% of spend reached no tenant. Reported, not
                spread.
              </td>
            </tr>
          </tbody>
        </table>

        {/* The property that makes the rest worth reading. Shown, not assumed. */}
        <p className={reconciliation.reconciles ? "ok" : "error"}>
          {reconciliation.reconciles
            ? `Reconciled: tenant costs plus unallocated equal the ${summary.lineCount} ingested lines exactly.`
            : `Does not reconcile — ${usd(reconciliation.discrepancy.units)} unaccounted for across ${summary.lineCount} lines. ` +
              `This is shown rather than absorbed into the largest tenant.`}
        </p>
      </section>

      <section className="system">
        <header>
          <h2>By tenant</h2>
        </header>
        <table className="grid">
          <thead>
            <tr>
              <th>Tenant</th>
              <th className="num">Direct</th>
              <th className="num">Allocated share</th>
              <th className="num">Total</th>
              <th>Driver</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant.tenantId}>
                <td>{tenant.tenantId}</td>
                <td className="num">{usd(tenant.direct.units)}</td>
                <td className="num">{usd(tenant.allocated.units)}</td>
                <td className="num">{usd(tenant.total.units)}</td>
                <td>
                  {/* The justification travels with the number. "Why is this
                      tenant paying $412 of the NAT gateway" has an answer here
                      rather than in a code comment. */}
                  {tenant.attributions.length === 0
                    ? "—"
                    : tenant.attributions
                        .map((a) => `${a.measure} (${a.weight}/${a.totalWeight})`)
                        .join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {unallocated.length > 0 && (
        <section className="system">
          <header>
            <h2>Unallocated</h2>
            <span className="badge warn">{usd(summary.unallocated.units)}</span>
          </header>
          <p>
            Spend that reached no tenant, with the reason. It is not distributed: a split nobody chose
            produces a page whose total reconciles and whose every row is wrong.
          </p>
          <table className="grid">
            <thead>
              <tr>
                <th>Service</th>
                <th className="num">Amount</th>
                <th>Why</th>
                <th className="num">Lines</th>
              </tr>
            </thead>
            <tbody>
              {unallocated.map((entry) => (
                <tr key={`${entry.service}-${entry.lineIds[0]}`}>
                  <td>{entry.service}</td>
                  <td className="num">{usd(entry.amount.units)}</td>
                  <td>{entry.reason}</td>
                  <td className="num">{entry.lineIds.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
