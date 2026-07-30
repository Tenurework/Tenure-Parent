"use client"

import { useMemo } from "react"
import { Card, CardHeader } from "@/components/ui/Card"
import { LineAreaChart } from "../LineAreaChart"
import { formatNumber } from "../format"
import { bucketByDay } from "../timeseries"

/**
 * Activity trend panel for the dashboard: audit events per day over the last 30
 * days. The page hands us pre-serialised ISO timestamps (scoped to the clubs the
 * viewer can see) and we bucket them on the client so the chart stays a plain
 * data island with no server coupling.
 */
export function ActivityChart({ events }: { events: string[] }) {
  const days = useMemo(
    () => bucketByDay(events.map((e) => new Date(e)), 30),
    [events]
  )

  return (
    <Card>
      <CardHeader title="Activity" subtitle="Audit events across your clubs, last 30 days" />
      <LineAreaChart
        categories={days.map((d) => d.label)}
        series={[{ name: "Events", values: days.map((d) => d.value) }]}
        formatValue={formatNumber}
        formatAxis={formatNumber}
        height={200}
      />
    </Card>
  )
}
