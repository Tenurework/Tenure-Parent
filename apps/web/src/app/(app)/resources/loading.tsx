import { StateSurface } from "@/components/ui/StateSurface"

/** TTES-030-002. See admin/audit/loading.tsx — the board's own card geometry. */
export default function Loading() {
  return (
    <StateSurface
      state="loading"
      title="Loading board resources"
      geometry={{ rows: 6, rowHeight: 168, gap: 16, headerHeight: 96, columns: [1, 1, 1] }}
    />
  )
}
