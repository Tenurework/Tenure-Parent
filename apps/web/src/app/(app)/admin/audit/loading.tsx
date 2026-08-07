import { StateSurface } from "@/components/ui/StateSurface"

/**
 * TTES-030-002 — a route-level loading boundary that reserves the shape of the
 * table it precedes.
 *
 * `find src/app -name loading.tsx` returned nothing across 37 pages, so every
 * server-rendered list arrived by replacing an empty document: no announcement
 * that anything was loading, and a full-height reflow when it landed. The
 * geometry is the audit grid's own — a toolbar strip and twelve 44px rows in
 * six columns — so `Skeleton`'s arithmetic reserves the box the rows will
 * occupy instead of a one-line card.
 */
export default function Loading() {
  return (
    <StateSurface
      state="loading"
      title="Loading the audit log"
      geometry={{ rows: 12, rowHeight: 44, gap: 1, headerHeight: 132, columns: [3, 2, 2, 3, 3, 1] }}
    />
  )
}
