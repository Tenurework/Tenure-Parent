"use client"

import { HBarChart, STATUS } from "@/components/charts"
import { formatCents, formatCentsCompact } from "@/lib/finance"

export type ChartRow = {
  category: string
  budgetedCents: number
  projectedCents: number
}

/**
 * Actual/projected vs budget by category, rebuilt on the shared chart kit's
 * horizontal grouped bar chart. The kit supplies the rounded data-ends, 2px
 * surface gaps, floating tooltip, legend and --chart tokens; we only supply the
 * two grouped series and paint an over-budget projected bar with the reserved
 * error token via `cellColor`. Props stay `ChartRow[]` so FinanceDashboard's
 * live-edit re-render (rows recompute as the forecast is typed) is untouched.
 */
export function BudgetBarChart({ rows }: { rows: ChartRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-text-3">
        Add a budget line to see the chart.
      </p>
    )
  }

  const data = rows.map((r) => ({
    label: r.category,
    values: [r.budgetedCents, r.projectedCents],
  }))

  return (
    <div>
      <HBarChart
        data={data}
        series={[{ name: "Budget" }, { name: "Actual / projected" }]}
        formatValue={formatCents}
        formatAxis={formatCentsCompact}
        cellColor={(ri, si) =>
          si === 1 && rows[ri].projectedCents > rows[ri].budgetedCents
            ? STATUS.error
            : undefined
        }
        ariaLabel="Budget versus actual spending by category"
      />
      <p className="mt-2 pl-1 text-meta text-text-3">
        A projected bar turns red when it runs over its budget.
      </p>
    </div>
  )
}
