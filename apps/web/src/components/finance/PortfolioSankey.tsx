"use client"

import { SankeyChart, type SankeyNode, type SankeyLink } from "@/components/charts"
import { formatCents } from "@/lib/finance"

/**
 * Client wrapper so a server page can render the finance Sankey without passing
 * a function prop (formatValue) across the server→client boundary.
 */
export function PortfolioSankey({
  nodes,
  links,
  height,
}: {
  nodes: SankeyNode[]
  links: SankeyLink[]
  height: number
}) {
  return <SankeyChart nodes={nodes} links={links} height={height} formatValue={formatCents} />
}
