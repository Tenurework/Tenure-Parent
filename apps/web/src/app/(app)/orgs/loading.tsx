import { StateSurface } from "@/components/ui/StateSurface"

/** TTES-030-002. See admin/audit/loading.tsx — the club grid's own geometry. */
export default function Loading() {
  return (
    <StateSurface
      state="loading"
      title="Loading clubs"
      geometry={{ rows: 9, rowHeight: 148, gap: 16, headerHeight: 88, columns: [1, 1, 1] }}
    />
  )
}
