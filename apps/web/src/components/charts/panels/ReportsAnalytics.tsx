"use client"

import { useMemo, useState } from "react"
import { Card, CardHeader } from "@/components/ui/Card"
import { LineAreaChart } from "../LineAreaChart"
import { BarChart } from "../BarChart"
import { HBarChart } from "../HBarChart"
import { DonutChart } from "../DonutChart"
import { SankeyChart } from "../SankeyChart"
import { RangeFilter, type RangeOption } from "../RangeFilter"
import { MUTED_SERIES, slotColor } from "../palette"
import { formatNumber } from "../format"
import { bucketByMonth, startOfTerm } from "../timeseries"

type Range = "term" | "year" | "all"

const RANGE_OPTIONS: RangeOption<Range>[] = [
  { value: "term", label: "This term" },
  { value: "year", label: "12 months" },
  { value: "all", label: "All" },
]

// Approval funnel stages, in pipeline order (top → bottom).
const STAGES = [
  ["DRAFT", "Draft"],
  ["PENDING_PRESIDENT", "Pending President"],
  ["NEEDS_CHANGES", "Needs changes"],
  ["PENDING_OSE", "Pending OSE"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
] as const

const HOUR = 3.6e6
const DAY = 8.64e7
const DURATION_BUCKETS = [
  { label: "<1h", max: HOUR },
  { label: "1–6h", max: 6 * HOUR },
  { label: "6–24h", max: 24 * HOUR },
  { label: "1–3d", max: 3 * DAY },
  { label: "3–7d", max: 7 * DAY },
  { label: "7d+", max: Infinity },
]

export type ReportsAnalyticsProps = {
  approvals: { status: string; createdAt: string }[]
  decisions: { occurredAt: string; durationMs: number }[]
  eventDates: string[]
  memory: { type: string; createdAt: string }[]
  roster: { category: string; filled: number; vacant: number }[]
}

function cutoffFor(range: Range, now: Date): Date | null {
  if (range === "all") return null
  if (range === "term") return startOfTerm(now)
  const d = new Date(now)
  d.setFullYear(d.getFullYear() - 1)
  return d
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

export function ReportsAnalytics({
  approvals,
  decisions,
  eventDates,
  memory,
  roster,
}: ReportsAnalyticsProps) {
  const [range, setRange] = useState<Range>("year")

  const model = useMemo(() => {
    const now = new Date()
    const cutoff = cutoffFor(range, now)
    const after = (iso: string) => (cutoff ? new Date(iso) >= cutoff : true)

    // 1. Approval funnel
    const statusCount = new Map<string, number>()
    for (const a of approvals) if (after(a.createdAt)) statusCount.set(a.status, (statusCount.get(a.status) ?? 0) + 1)
    const funnel = STAGES.map(([key, label]) => ({ label, values: [statusCount.get(key) ?? 0] }))

    // 2. Time-to-decision distribution + median
    const durs = decisions.filter((d) => after(d.occurredAt)).map((d) => d.durationMs)
    const buckets = DURATION_BUCKETS.map(() => 0)
    for (const ms of durs) {
      const idx = DURATION_BUCKETS.findIndex((b) => ms < b.max)
      buckets[idx >= 0 ? idx : DURATION_BUCKETS.length - 1]++
    }
    const sorted = [...durs].sort((a, b) => a - b)
    const medianMs = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
    const medianLabel =
      medianMs == null
        ? "—"
        : medianMs < HOUR
          ? `${Math.max(1, Math.round(medianMs / 6e4))} min`
          : medianMs < DAY
            ? `${(medianMs / HOUR).toFixed(1)} h`
            : `${(medianMs / DAY).toFixed(1)} days`

    // 3. Events per month
    const evDates = eventDates.filter(after).map((s) => new Date(s))
    const from = range === "year" ? cutoff : range === "term" ? cutoff : null
    const months = bucketByMonth(evDates, from, now)

    // 4. Memory coverage by type. Rows are ranked by count, so the rank of a
    // type changes with `range` — hence `key`, the MemoryRecordType enum value,
    // which pins each type's colour to the type itself rather than to the row it
    // lands on. Without it, switching this panel between "This term" and "12
    // months" repaints the donut and the legend means something different in
    // each view.
    const memCount = new Map<string, number>()
    for (const m of memory) if (after(m.createdAt)) memCount.set(m.type, (memCount.get(m.type) ?? 0) + 1)
    const memoryData = [...memCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, value]) => ({ key: type, label: titleCase(type), value }))
    const memoryTotal = memoryData.reduce((n, d) => n + d.value, 0)

    return { funnel, buckets, medianLabel, months, memoryData, memoryTotal }
  }, [range, approvals, decisions, eventDates, memory])

  // Seat-allocation flow: each board-position category splits into filled and
  // vacant seats — an honest two-layer Sankey straight from current roster data.
  const sankey = useMemo(() => {
    const nodes = [
      ...roster.map((r) => ({ id: `cat:${r.category}`, label: r.category })),
      { id: "filled", label: "Filled", color: slotColor(0) },
      { id: "vacant", label: "Vacant", color: MUTED_SERIES },
    ]
    const links = roster.flatMap((r) => [
      ...(r.filled > 0 ? [{ source: `cat:${r.category}`, target: "filled", value: r.filled }] : []),
      ...(r.vacant > 0 ? [{ source: `cat:${r.category}`, target: "vacant", value: r.vacant }] : []),
    ])
    return { nodes, links }
  }, [roster])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="micro-label text-text-3">Analytics</p>
        <RangeFilter value={range} onChange={setRange} options={RANGE_OPTIONS} ariaLabel="Report time range" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Approval pipeline" subtitle="Requests by stage, draft through decision" />
          <HBarChart
            data={model.funnel}
            series={[{ name: "Requests" }]}
            formatValue={formatNumber}
            formatAxis={formatNumber}
            ariaLabel="Approval requests by stage"
          />
        </Card>

        <Card>
          <CardHeader title="Time to decision" subtitle={`Median ${model.medianLabel} from request to final decision`} />
          <BarChart
            categories={DURATION_BUCKETS.map((b) => b.label)}
            series={[{ name: "Decisions", values: model.buckets }]}
            formatValue={formatNumber}
            formatAxis={formatNumber}
            height={220}
          />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Events published" subtitle="Per month across the institution" />
          <LineAreaChart
            categories={model.months.map((m) => m.label)}
            series={[{ name: "Events published", values: model.months.map((m) => m.value) }]}
            formatValue={formatNumber}
            formatAxis={formatNumber}
            height={240}
          />
        </Card>

        <Card>
          <CardHeader title="Institutional memory" subtitle="Knowledge cards by type" />
          <DonutChart
            data={model.memoryData}
            centerValue={formatNumber(model.memoryTotal)}
            centerLabel="cards"
            formatValue={formatNumber}
          />
        </Card>

        <Card>
          <CardHeader title="Roster fill by category" subtitle="Filled vs vacant board seats — current" />
          <BarChart
            categories={roster.map((r) => r.category)}
            series={[
              { name: "Filled", values: roster.map((r) => r.filled), color: slotColor(0) },
              { name: "Vacant", values: roster.map((r) => r.vacant), color: MUTED_SERIES },
            ]}
            formatValue={formatNumber}
            formatAxis={formatNumber}
            height={220}
          />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Seat allocation flow"
            subtitle="How board seats split into filled and vacant across position categories"
          />
          <SankeyChart
            nodes={sankey.nodes}
            links={sankey.links}
            height={Math.max(260, sankey.nodes.length * 30)}
            formatValue={formatNumber}
          />
        </Card>
      </div>
    </div>
  )
}
