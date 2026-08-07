import { toDecimal, type Money } from "@tenure/finops"

// Relative rather than the "@/" alias so this component can be rendered by a
// test runner that does not carry the Studio's path mapping — see
// cost-citation.test.tsx beside it.
import type { CostReport } from "../../../lib/cost-report"

/**
 * The connected arm of the FinOps Center.
 *
 * Its own module rather than a function inside `page.tsx` for one reason: the
 * page imports `@/lib/auth` and `next/link`, so nothing can render it outside a
 * Next request, and a citation nobody can render is a citation nobody has
 * checked. Everything here is pure — a report in, markup out — and
 * `e2e/cost-citation.spec.tsx` renders it against a report built by the real
 * `buildCostReport`, which is the only place a figure's provenance is set.
 */

/**
 * An amount, at its OWN currency's precision.
 *
 * `toDecimal` used to default to two minor digits regardless of what currency
 * was travelling in the `Money`, so a JPY-billed account rendered a hundredfold
 * high. It now reads the currency's exponent, and the rounding mode is stated
 * rather than defaulted: `half-even` for display, because it is the only mode
 * whose bias over a page of figures is zero and because a debit and the credit
 * that reverses it must render with the same magnitude.
 */
export function formatAmount(amount: Money): string {
  const rendered = toDecimal(amount, "half-even")
  return amount.currency === "USD" ? `$${rendered}` : `${rendered} ${amount.currency}`
}

/**
 * Where a number came from, in one line.
 *
 * PAY-180-003. `as of` says when the DATA is current; this says which system
 * produced it and when this engine last read that system — the question an
 * operator asks before acting on a figure, because "the bill says so" and "we
 * estimated it" are different claims that otherwise render identically.
 */
export function citation(source: { system: string; reference: string; retrievedAt: string }): string {
  return `source: ${source.system} · ${source.reference} · read ${source.retrievedAt}`
}

export function CostReportView({ report }: { report: CostReport }) {
  const { summary, reconciliation, tenants, unallocated, splits } = report

  return (
    <>
      <section className="system">
        <header>
          <h2>This month</h2>
          <span className={`badge ${summary.freshness.stale ? "warn" : "quiet"}`}>
            as of {summary.freshness.asOf}
          </span>
          {/* The citation, beside the as-of and not instead of it. Two different
              facts: when the data is current as of, and which system said so. */}
          <span className="badge quiet" data-testid="figure-source">
            {citation(summary.actual.source)}
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
              <td className="num">{formatAmount(summary.actual.amount)}</td>
              <td>{Math.round(summary.actual.periodCompleteness * 100)}% through the period</td>
            </tr>
            <tr>
              <td>Amortized</td>
              <td className="num">{formatAmount(summary.amortized.amount)}</td>
              <td>What this month&rsquo;s usage cost, with commitments spread over their term.</td>
            </tr>
            <tr>
              <td>Forecast</td>
              <td className="num">
                {summary.forecast ? formatAmount(summary.forecast.amount) : "—"}
              </td>
              <td>
                {summary.forecast
                  ? // The forecast carries its own citation, marked derived, so nothing
                    // can present a projection as a billed line.
                    summary.forecast.source.reference
                  : "Too early in the period to project without inventing a number."}
              </td>
            </tr>
            <tr>
              <td>Unallocated</td>
              <td className="num">{formatAmount(summary.unallocated)}</td>
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
            : `Does not reconcile — ${formatAmount(reconciliation.discrepancy)} unaccounted for across ${summary.lineCount} lines. ` +
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
                <td className="num">{formatAmount(tenant.direct)}</td>
                <td className="num">{formatAmount(tenant.allocated)}</td>
                <td className="num">{formatAmount(tenant.total)}</td>
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

      {splits.length > 0 && (
        <section className="system">
          <header>
            <h2>Shared-cost splits</h2>
            <span className="badge quiet">reversal replays, never re-derives</span>
          </header>
          <p>
            Every shared cost a driver covered, per recipient, with what reversing the split returns
            them. The reversal is the recorded amount negated — not the rule run again. Re-deriving a
            largest-remainder split on the way back moves the leftover units between recipients, and
            the total still nets to zero while two tenants are permanently a unit out, in opposite
            directions.
          </p>
          <table className="grid">
            <thead>
              <tr>
                <th>Split</th>
                <th>Recipient</th>
                <th className="num">Received</th>
                <th className="num">Reversal returns</th>
              </tr>
            </thead>
            <tbody>
              {splits.flatMap(({ split, reversal }) =>
                split.parts.map((part, index) => (
                  <tr key={`${split.splitId}-${part.recipientId}`}>
                    <td>{index === 0 ? split.splitId : ""}</td>
                    <td>{part.recipientId}</td>
                    <td className="num">{formatAmount(part.amount)}</td>
                    <td className="num">{formatAmount(reversal[index].amount)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </section>
      )}

      {unallocated.length > 0 && (
        <section className="system">
          <header>
            <h2>Unallocated</h2>
            <span className="badge warn">{formatAmount(summary.unallocated)}</span>
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
                  <td className="num">{formatAmount(entry.amount)}</td>
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
