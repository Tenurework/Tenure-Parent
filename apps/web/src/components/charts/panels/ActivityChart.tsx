"use client"

import { useMemo } from "react"
import { ChartFrame } from "../ChartFrame"
import { tableFromSeries } from "../chart-table"
import { LineAreaChart } from "../LineAreaChart"
import { formatNumber } from "../format"
import { bucketByDay } from "../timeseries"

/**
 * Activity trend panel for the dashboard: audit events per day over the last 30
 * days. The page hands us pre-serialised ISO timestamps (scoped to the clubs the
 * viewer can see) and we bucket them on the client so the chart stays a plain
 * data island with no server coupling.
 *
 * TTES-020-002-CHART-FRAME. It used to be a `<Card>` with a title and a mark,
 * and nothing in it said which rows the count came from, as of when, or in what
 * unit — and a screen-reader user's only route to the numbers was a thirty-stop
 * tour of per-point `aria-label`s. `ChartFrame` carries the provenance line,
 * the accessible table and the CSV, all built from the same `days` the mark is
 * handed, so the table cannot disagree with the picture.
 */
export function ActivityChart({ events }: { events: string[] }) {
  const days = useMemo(
    () => bucketByDay(events.map((e) => new Date(e)), 30),
    [events]
  )

  const table = useMemo(
    () =>
      tableFromSeries(
        days.map((d) => d.label),
        [{ name: "Events", values: days.map((d) => d.value) }],
        "Day",
      ),
    [days],
  )

  // The client's own clock, and stated as such: the buckets were computed here
  // from timestamps the server sent, so "as of" is when this rendered.
  const asOf = useMemo(
    () => new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    [],
  )

  return (
    <ChartFrame
      title="Activity"
      question="How much is happening across my clubs, day by day?"
      source="Audit events for the clubs you can see"
      asOf={asOf}
      unit="events per day"
      filters="last 30 days"
      table={table}
      fileName="tenure-activity-30-days"
    >
      <LineAreaChart
        categories={days.map((d) => d.label)}
        series={[{ name: "Events", values: days.map((d) => d.value) }]}
        formatValue={formatNumber}
        formatAxis={formatNumber}
        height={200}
      />
    </ChartFrame>
  )
}
