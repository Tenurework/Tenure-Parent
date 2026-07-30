"use client"

import { useId, useMemo, useState } from "react"
import { useMeasuredWidth, useMounted } from "./hooks"
import { slotColor } from "./palette"
import { formatCompact } from "./format"
import { ChartEmpty } from "./ChartEmpty"

export type SankeyNode = { id: string; label: string; color?: string }
export type SankeyLink = { source: string; target: string; value: number }

type Positioned = {
  id: string
  label: string
  x: number
  y: number
  h: number
  value: number
  color: string
  layer: number
  labelLeft: boolean
}
type Ribbon = {
  d: string
  color: string
  source: string
  target: string
  value: number
  sourceLabel: string
  targetLabel: string
}

/**
 * Dependency-free layered Sankey / flow diagram. Nodes are placed in columns by
 * longest-path depth; ribbon width is proportional to flow value on a single
 * global scale (so a node's height equals its throughput). Colour follows the
 * source node (identity), links ride at low opacity and brighten on hover —
 * hovering a node isolates everything it touches. The signature "where the money
 * / the approvals flow" view.
 */
export function SankeyChart({
  nodes,
  links,
  height = 300,
  nodeWidth = 14,
  formatValue = (n) => formatCompact(n),
  className,
}: {
  nodes: SankeyNode[]
  links: SankeyLink[]
  height?: number
  nodeWidth?: number
  formatValue?: (n: number) => string
  className?: string
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()
  const mounted = useMounted()
  const uid = useId().replace(/:/g, "")
  const [hover, setHover] = useState<string | null>(null)

  const layout = useMemo(
    () => computeLayout(nodes, links, width, height, nodeWidth),
    [nodes, links, width, height, nodeWidth]
  )

  const valid = nodes.length > 0 && links.some((l) => l.value > 0)

  return (
    <div ref={ref} data-testid="chart-sankey" className={className}>
      <div className="relative" style={{ height }}>
        {!valid ? (
          <ChartEmpty height={height} />
        ) : width > 0 && layout ? (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Flow diagram">
            {/* ribbons */}
            {layout.ribbons.map((r, i) => {
              const on = hover == null || hover === r.source || hover === r.target
              return (
                <path
                  key={`${uid}-r${i}`}
                  d={r.d}
                  fill={r.color}
                  opacity={mounted ? (on ? (hover ? 0.55 : 0.4) : 0.07) : 0}
                  style={{ transition: "opacity 260ms ease" }}
                >
                  <title>{`${r.sourceLabel} → ${r.targetLabel}: ${formatValue(r.value)}`}</title>
                </path>
              )
            })}
            {/* nodes + labels */}
            {layout.nodes.map((nd) => {
              const on = hover == null || hover === nd.id
              return (
                <g
                  key={nd.id}
                  onPointerEnter={() => setHover(nd.id)}
                  onPointerLeave={() => setHover(null)}
                  style={{ cursor: "default" }}
                >
                  <rect
                    x={nd.x}
                    y={nd.y}
                    width={nodeWidth}
                    height={nd.h}
                    rx={2}
                    fill={nd.color}
                    opacity={on ? 1 : 0.4}
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "center",
                      transform: mounted ? "scaleY(1)" : "scaleY(0.001)",
                      transition: `transform 420ms cubic-bezier(0.16,1,0.3,1) ${nd.layer * 70}ms, opacity 200ms ease`,
                    }}
                  />
                  <text
                    x={nd.labelLeft ? nd.x - 7 : nd.x + nodeWidth + 7}
                    y={nd.y + nd.h / 2}
                    textAnchor={nd.labelLeft ? "end" : "start"}
                    dominantBaseline="middle"
                    fontSize={11}
                    style={{ opacity: on ? 1 : 0.45, transition: "opacity 200ms ease" }}
                  >
                    <tspan fontWeight={600} fill="var(--text-1)">
                      {nd.label}
                    </tspan>
                    <tspan dx={7} fill="var(--text-3)" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatValue(nd.value)}
                    </tspan>
                  </text>
                </g>
              )
            })}
          </svg>
        ) : null}
      </div>
    </div>
  )
}

function computeLayout(
  nodes: SankeyNode[],
  links: SankeyLink[],
  width: number,
  height: number,
  nodeWidth: number
): { nodes: Positioned[]; ribbons: Ribbon[] } | null {
  if (nodes.length === 0 || width <= 0) return null
  const byId = new Map(nodes.map((n, i) => [n.id, { ...n, idx: i }]))
  const valLinks = links.filter((l) => byId.has(l.source) && byId.has(l.target) && l.value > 0)
  if (valLinks.length === 0) return null

  // Longest-path layering from sources (stable for DAGs; capped for safety).
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  for (let iter = 0; iter < nodes.length; iter++) {
    let changed = false
    for (const l of valLinks) {
      const want = (layer.get(l.source) ?? 0) + 1
      if ((layer.get(l.target) ?? 0) < want) {
        layer.set(l.target, want)
        changed = true
      }
    }
    if (!changed) break
  }
  const maxLayer = Math.max(...nodes.map((n) => layer.get(n.id) ?? 0))

  // Throughput = max(incoming, outgoing) so pass-through nodes size correctly.
  const inSum = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  const outSum = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  for (const l of valLinks) {
    outSum.set(l.source, (outSum.get(l.source) ?? 0) + l.value)
    inSum.set(l.target, (inSum.get(l.target) ?? 0) + l.value)
  }
  const through = new Map<string, number>(
    nodes.map((n) => [n.id, Math.max(inSum.get(n.id) ?? 0, outSum.get(n.id) ?? 0)])
  )

  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const n of nodes) layers[layer.get(n.id) ?? 0].push(n.id)

  const padY = 6
  const nodeGap = 16
  const plotH = height - padY * 2
  const layerSum = layers.map((ids) => ids.reduce((s, id) => s + (through.get(id) ?? 0), 0))
  const maxLayerSum = Math.max(1, ...layerSum)
  const maxNodesInLayer = Math.max(1, ...layers.map((ids) => ids.length))
  const scale = Math.max(0, (plotH - (maxNodesInLayer - 1) * nodeGap)) / maxLayerSum

  const colX = (L: number) => (maxLayer === 0 ? 8 : 8 + (L / maxLayer) * (width - 16 - nodeWidth))

  const pos = new Map<string, { x: number; y: number; h: number }>()
  layers.forEach((ids, L) => {
    const x = colX(L)
    const hs = ids.map((id) => Math.max(3, (through.get(id) ?? 0) * scale))
    const totalH = hs.reduce((a, b) => a + b, 0) + (ids.length - 1) * nodeGap
    let y = padY + Math.max(0, (plotH - totalH) / 2)
    ids.forEach((id, i) => {
      pos.set(id, { x, y, h: hs[i] })
      y += hs[i] + nodeGap
    })
  })

  // Stack link endpoints on each node edge, ordered by the counterpart's y to
  // reduce crossings.
  const outBy = new Map<string, SankeyLink[]>(nodes.map((n) => [n.id, []]))
  const inBy = new Map<string, SankeyLink[]>(nodes.map((n) => [n.id, []]))
  for (const l of valLinks) {
    outBy.get(l.source)!.push(l)
    inBy.get(l.target)!.push(l)
  }
  outBy.forEach((lst) => lst.sort((a, b) => (pos.get(a.target)!.y ?? 0) - (pos.get(b.target)!.y ?? 0)))
  inBy.forEach((lst) => lst.sort((a, b) => (pos.get(a.source)!.y ?? 0) - (pos.get(b.source)!.y ?? 0)))

  const sy = new Map<SankeyLink, [number, number]>()
  outBy.forEach((lst, src) => {
    let off = 0
    const p = pos.get(src)!
    for (const l of lst) {
      const w = l.value * scale
      sy.set(l, [p.y + off, p.y + off + w])
      off += w
    }
  })
  const ty = new Map<SankeyLink, [number, number]>()
  inBy.forEach((lst, tgt) => {
    let off = 0
    const p = pos.get(tgt)!
    for (const l of lst) {
      const w = l.value * scale
      ty.set(l, [p.y + off, p.y + off + w])
      off += w
    }
  })

  const ribbons: Ribbon[] = valLinks.map((l) => {
    const sp = pos.get(l.source)!
    const tp = pos.get(l.target)!
    const [syt, syb] = sy.get(l)!
    const [tyt, tyb] = ty.get(l)!
    const sx = sp.x + nodeWidth
    const tx = tp.x
    const mx = (sx + tx) / 2
    const d = `M${sx},${syt} C${mx},${syt} ${mx},${tyt} ${tx},${tyt} L${tx},${tyb} C${mx},${tyb} ${mx},${syb} ${sx},${syb} Z`
    const src = byId.get(l.source)!
    return {
      d,
      color: src.color ?? slotColor(src.idx % 8),
      source: l.source,
      target: l.target,
      value: l.value,
      sourceLabel: src.label,
      targetLabel: byId.get(l.target)!.label,
    }
  })

  const outNodes: Positioned[] = nodes
    .filter((n) => pos.has(n.id))
    .map((n) => {
      const p = pos.get(n.id)!
      const meta = byId.get(n.id)!
      const L = layer.get(n.id) ?? 0
      return {
        id: n.id,
        label: n.label,
        x: p.x,
        y: p.y,
        h: p.h,
        value: through.get(n.id) ?? 0,
        color: n.color ?? slotColor(meta.idx % 8),
        layer: L,
        labelLeft: L === maxLayer && maxLayer > 0,
      }
    })

  return { nodes: outNodes, ribbons }
}
