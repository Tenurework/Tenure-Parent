"use client"

import { useMemo, useState, useTransition } from "react"
// Closest available aliases from the single icon source (no direct Save/Reset/
// Trend glyphs exist; see notes). Direction on the variance card is carried by
// tone colour, not the icon.
import { CheckCircle, RotateCw, Trash2, BarChart3, type IconType } from "@/components/ui/icons"
import { Card, CardHeader } from "@/components/ui/Card"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { DonutChart, slotColor, STATUS, REFERENCE } from "@/components/charts"
import { formatCents, parseMoneyToCents } from "@/lib/finance"
import { BudgetBarChart, type ChartRow } from "./BudgetBarChart"
import { BudgetUpload } from "./BudgetUpload"
import { LedgerDrawer, type LedgerEntryRow, type LedgerSources } from "./LedgerDrawer"
import {
  deleteBudgetLine,
  saveForecast,
  upsertBudgetLine,
} from "@/app/(app)/orgs/[slug]/finance/actions"

export type DashboardLine = {
  id: string
  category: string
  budgetedCents: number
  actualCents: number
  forecastCents: number | null
  source: string
  note: string | null
}

/** Starting projected value for a line: real spend if any, else saved forecast, else budget. */
function projectedDefault(line: DashboardLine): number {
  if (line.actualCents !== 0) return line.actualCents
  if (line.forecastCents != null) return line.forecastCents
  return line.budgetedCents
}

const dollars = (cents: number) => (cents / 100).toFixed(2)

export function FinanceDashboard({
  slug,
  canManage,
  canReverse,
  merchantLegalName,
  merchantStatementDescriptor,
  lines,
  ledgerByLine,
  sources,
}: {
  slug: string
  canManage: boolean
  /**
   * PAY-150-001. `finance.ledger.reverse`, decided separately from the budget
   * capability `canManage` stands for. Threaded through rather than reused so
   * the drawer offers the correction control to exactly the people the server
   * will accept it from.
   */
  canReverse: boolean
  /**
   * PAY-040-007. The legal seller and the statement descriptor, resolved on the
   * server from the institution rather than written into a component. Bible §6
   * asks for both on every payment preview; Bible §2 forbids implying Tenure is
   * the seller, so neither may be a literal in the client bundle.
   */
  merchantLegalName: string
  merchantStatementDescriptor: string
  lines: DashboardLine[]
  ledgerByLine: Record<string, LedgerEntryRow[]>
  sources: LedgerSources
}) {
  // Editable projected spend per line, in dollar strings, drives the live view.
  const [projected, setProjected] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, dollars(projectedDefault(l))]))
  )

  // Deleting a line is a hard, unrecoverable delete — gate it behind a confirm.
  const [deleteTarget, setDeleteTarget] = useState<DashboardLine | null>(null)
  const [deleting, startDelete] = useTransition()

  // The budget line whose ledger drawer (drill-down to source) is open.
  const [ledgerLine, setLedgerLine] = useState<DashboardLine | null>(null)

  const projectedCentsFor = (l: DashboardLine) =>
    parseMoneyToCents(projected[l.id]) ?? 0

  const totals = useMemo(() => {
    let budgeted = 0
    let actual = 0
    let projectedSum = 0
    for (const l of lines) {
      budgeted += l.budgetedCents
      actual += l.actualCents
      projectedSum += projectedCentsFor(l)
    }
    return {
      budgeted,
      actual,
      projectedSum,
      remaining: budgeted - actual,
      variance: budgeted - projectedSum, // + = savings, − = overspend
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, projected])

  const chartRows: ChartRow[] = lines.map((l) => ({
    category: l.category,
    budgetedCents: l.budgetedCents,
    projectedCents: projectedCentsFor(l),
  }))

  const dirty = lines.some(
    (l) => Math.round((parseMoneyToCents(projected[l.id]) ?? 0)) !== projectedDefault(l)
  )

  const saveForecastForSlug = saveForecast.bind(null, slug)
  const upsertForSlug = upsertBudgetLine.bind(null, slug)
  const deleteForSlug = deleteBudgetLine.bind(null, slug)

  const savings = totals.variance >= 0

  // Budget utilization donut — spent against total budget (actuals, not the live
  // projection). Turns red once spend exceeds the plan.
  const overSpent = totals.actual > totals.budgeted
  const utilPct =
    totals.budgeted > 0 ? Math.round((totals.actual / totals.budgeted) * 100) : 0
  const utilData = [
    { label: "Spent", value: totals.actual, color: overSpent ? STATUS.error : slotColor(0) },
    { label: "Remaining", value: Math.max(0, totals.remaining), color: REFERENCE },
  ]

  return (
    <div className="space-y-4">
      {/* Summary tiles with a compact utilization donut alongside */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <SummaryCard label="Total budget" value={formatCents(totals.budgeted)} />
          <SummaryCard
            label="Spent to date"
            value={formatCents(totals.actual)}
            hint={
              totals.budgeted > 0
                ? `${Math.round((totals.actual / totals.budgeted) * 100)}% of budget`
                : undefined
            }
          />
          <SummaryCard
            label="Remaining"
            value={formatCents(totals.remaining)}
            tone={totals.remaining < 0 ? "bad" : "neutral"}
          />
          <SummaryCard
            label={savings ? "Projected savings" : "Projected overspend"}
            value={formatCents(Math.abs(totals.variance))}
            tone={savings ? "good" : "bad"}
            icon={BarChart3}
          />
        </div>
        <Card>
          <CardHeader title="Budget utilization" subtitle="Portion of the allocation used" />
          <DonutChart
            data={utilData}
            centerValue={`${utilPct}%`}
            centerLabel="utilized"
            formatValue={formatCents}
          />
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader
          title="Actual vs budget by category"
          subtitle="Edit the projected column below to model spending and see savings update live."
        />
        <BudgetBarChart rows={chartRows} />
      </Card>

      {/* Editable table */}
      <Card padding="none">
        <div className="border-b border-border p-5">
          <CardHeader
            title="Budget lines"
            subtitle={
              canManage
                ? "Adjust projected spend to forecast. Save to keep your projection."
                : "Read-only — your role can view but not edit this club's budget."
            }
          />
        </div>

        <form action={canManage ? saveForecastForSlug : undefined}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-3">
                  <th className="px-5 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Budgeted</th>
                  <th className="px-3 py-2 text-right font-medium">Spent</th>
                  <th className="px-3 py-2 text-right font-medium">Projected</th>
                  <th className="px-3 py-2 text-right font-medium">Variance</th>
                  {canManage && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 6 : 5} className="px-5 py-6 text-center text-text-3">
                      No budget lines yet. Add one below or upload a spreadsheet.
                    </td>
                  </tr>
                )}
                {lines.map((l) => {
                  const projCents = projectedCentsFor(l)
                  const variance = l.budgetedCents - projCents
                  return (
                    <tr key={l.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-2.5">
                        <span className="text-text-1">{l.category}</span>
                        {l.actualCents > l.budgetedCents && l.budgetedCents > 0 && (
                          <span
                            className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                            style={{ background: "var(--error-light)", color: "var(--error)" }}
                          >
                            Over budget
                          </span>
                        )}
                        {l.source === "import" && (
                          <span className="ml-2 text-[10px] uppercase text-text-3">imported</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-text-2">
                        {formatCents(l.budgetedCents)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setLedgerLine(l)}
                          title="View the transactions behind this figure"
                          className="tabular-nums text-text-1 underline decoration-dotted decoration-text-disabled underline-offset-2 hover:text-[--primary] hover:decoration-[--primary]"
                        >
                          {formatCents(l.actualCents)}
                        </button>
                        {(ledgerByLine[l.id]?.length ?? 0) > 0 && (
                          <span className="ml-1.5 align-middle text-[11px] text-text-3">
                            {ledgerByLine[l.id].length}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {canManage ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-text-3">$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              name={`forecast-${l.id}`}
                              value={projected[l.id] ?? ""}
                              onChange={(e) =>
                                setProjected((p) => ({ ...p, [l.id]: e.target.value }))
                              }
                              className="h-8 w-24 rounded border border-border px-2 text-right text-text-1 bg-surface placeholder:text-text-3"
                              aria-label={`Projected spend for ${l.category}`}
                            />
                          </span>
                        ) : (
                          formatCents(projCents)
                        )}
                      </td>
                      {/* GE-143-012: financial polarity is a protected meaning,
                          so the positive side is --success-text rather than the
                          brand accent. It was the accent, and an institution
                          whose accent is a maroon therefore shipped a table
                          where under budget and over budget were both red — a
                          sign error the contrast gate cannot see, because both
                          colours pass it. */}
                      <td
                        className={`px-3 py-2.5 text-right ${
                          variance < 0 ? "text-[--error]" : "text-[--success-text]"
                        }`}
                      >
                        {variance < 0 ? "-" : ""}
                        {formatCents(Math.abs(variance))}
                      </td>
                      {canManage && (
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(l)}
                            className="text-text-3 hover:text-[--error]"
                            aria-label={`Delete ${l.category}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {canManage && lines.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-border p-4">
              <p className="text-xs text-text-3">
                {dirty
                  ? "Unsaved projection — save to keep it, or reset to the actual figures."
                  : "Projection matches saved values."}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setProjected(
                      Object.fromEntries(lines.map((l) => [l.id, dollars(projectedDefault(l))]))
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-text-2 hover:bg-base"
                >
                  <RotateCw size={13} /> Reset
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded bg-[--primary] px-3 py-1.5 text-xs font-medium text-[--primary-text] hover:opacity-90"
                >
                  <CheckCircle size={13} /> Save forecast
                </button>
              </div>
            </div>
          )}
        </form>
      </Card>

      {canManage && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Add a line */}
          <Card>
            <CardHeader title="Add a budget line" />
            <form action={upsertForSlug} className="space-y-3">
              <input
                name="category"
                required
                maxLength={80}
                placeholder="Category, e.g. Catering"
                className="h-9 w-full rounded border border-border px-3 text-sm text-text-1 bg-surface placeholder:text-text-3"
              />
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1 text-xs text-text-2">
                  Budgeted
                  <input
                    name="budgeted"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-9 w-full rounded border border-border px-3 text-sm text-text-1 bg-surface placeholder:text-text-3"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs text-text-2">
                  Spent so far
                  <input
                    name="actual"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-9 w-full rounded border border-border px-3 text-sm text-text-1 bg-surface placeholder:text-text-3"
                  />
                </label>
              </div>
              <button className="h-9 w-full rounded bg-[--primary] text-sm font-medium text-[--primary-text] hover:opacity-90">
                Add line
              </button>
            </form>
          </Card>

          <BudgetUpload slug={slug} />
        </div>
      )}

      {ledgerLine && (
        <LedgerDrawer
          slug={slug}
          line={{
            id: ledgerLine.id,
            category: ledgerLine.category,
            actualCents: ledgerLine.actualCents,
            budgetedCents: ledgerLine.budgetedCents,
          }}
          entries={ledgerByLine[ledgerLine.id] ?? []}
          sources={sources}
          canManage={canManage}
          canReverse={canReverse}
          merchantLegalName={merchantLegalName}
          merchantStatementDescriptor={merchantStatementDescriptor}
          isOpen={ledgerLine !== null}
          onOpenChange={(open) => {
            if (!open) setLedgerLine(null)
          }}
        />
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={deleteTarget ? `Delete the “${deleteTarget.category}” line?` : ""}
        description={
          deleteTarget
            ? `This permanently deletes the “${deleteTarget.category}” budget line (${formatCents(
                deleteTarget.budgetedCents
              )} budgeted, ${formatCents(
                deleteTarget.actualCents
              )} spent). It can't be recovered — you'd re-enter it by hand.`
            : ""
        }
        confirmLabel="Delete line"
        variant="danger"
        busy={deleting}
        onConfirm={() => {
          const target = deleteTarget
          if (!target) return
          startDelete(async () => {
            const fd = new FormData()
            fd.set("id", target.id)
            await deleteForSlug(fd)
            setDeleteTarget(null)
          })
        }}
      />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon: Icon,
}: {
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "good" | "bad"
  icon?: IconType
}) {
  // GE-143-012, same reason as the variance column: `good` and `bad` are a
  // polarity, so both sides come from the status palette a tenant cannot set.
  const color =
    tone === "good" ? "text-[--success-text]" : tone === "bad" ? "text-[--error]" : "text-text-1"
  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-2">{label}</p>
        {Icon && <Icon size={15} className={color} />}
      </div>
      <p className={`mt-2 text-xl font-bold ${color}`} style={{ letterSpacing: "-0.02em" }}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-text-3">{hint}</p>}
    </Card>
  )
}
