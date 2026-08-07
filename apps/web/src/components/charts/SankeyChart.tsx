"use client"

import { useId, useMemo, useState } from "react"
import { useMeasuredWidth, useMounted } from "./hooks"
import { MUTED_SERIES, slotColor } from "./palette"
import { formatCompact } from "./format"
import { ChartEmpty } from "./ChartEmpty"

export type SankeyNode = { id: string; label: string; color?: string }
export type SankeyLink = { source: string; target: string; value: number }

export type SankeyPositionedNode = {
  id: string
  label: string
  x: number
  y: number
  h: number
  value: number
  color: string
  layer: number
  labelLeft: boolean
  /**
   * False when this band's label would land within `LABEL_LINE_H` of a label
   * already committed in the same column. A suppressed label is not lost — the
   * band still carries a `<title>`, so hover and assistive technology read it.
   */
  showLabel: boolean
  /** `0` for a real node; `n` when this band is a fold of `n` source nodes. */
  aggregatedCount: number
}

export type SankeyRibbon = {
  d: string
  color: string
  source: string
  target: string
  value: number
  sourceLabel: string
  targetLabel: string
  /** Endpoint spans, exposed so the layout's containment rule is checkable. */
  sourceY: number
  sourceH: number
  targetY: number
  targetH: number
}

export type SankeyLayout = {
  nodes: SankeyPositionedNode[]
  ribbons: SankeyRibbon[]
  /** The vertical band the layout may use. Bands + gaps never exceed it. */
  plotH: number
  /** Gap actually chosen between stacked bands (shrinks as a column fills). */
  nodeGap: number
  /** Value → pixels, one global scale so a band's height is its throughput. */
  scale: number
  /** How many bands one column may hold before folding starts. */
  capacity: number
  /** How many source nodes were folded into `Other` bands. `0` when none were. */
  foldedNodes: number
}

/**
 * The legibility floors this chart refuses to draw below. They are the whole
 * reason `computeLayout` can be asked "does this graph still fit?" and answer
 * honestly instead of silently overlapping bands.
 */
export const SANKEY_LIMITS = {
  /** A band shorter than this reads as a rule, not a rectangle. */
  MIN_NODE_H: 4,
  /** A ribbon thinner than this reads as a rendering artifact. */
  MIN_RIBBON_H: 1.5,
  /** Vertical room one 11px label needs before it collides with its neighbour. */
  LABEL_LINE_H: 12,
  /** Gaps shrink as a column fills, but never past this. */
  NODE_GAP_MIN: 4,
  /** …and never grow past this, so a two-node chart does not look sparse. */
  NODE_GAP_MAX: 16,
  PAD_Y: 6,
} as const

/**
 * A column whose bands are mostly pinned to `MIN_NODE_H` has stopped encoding
 * proportion — every flow looks the same size. Folding starts before that: at
 * most this share of a column's vertical budget may be floor-height bands.
 */
const MAX_CLAMPED_SHARE = 0.5

/**
 * The most bands one column can hold at the tightest legal gap. Beyond this,
 * `computeLayout` folds the smallest flows into a single `Other (n)` band
 * rather than stacking bands that would overlap.
 */
export function layerCapacity(height: number): number {
  const plotH = height - SANKEY_LIMITS.PAD_Y * 2
  if (plotH <= 0) return 1
  const pitch = SANKEY_LIMITS.MIN_NODE_H + SANKEY_LIMITS.NODE_GAP_MIN
  return Math.max(1, Math.floor((plotH + SANKEY_LIMITS.NODE_GAP_MIN) / pitch))
}

/**
 * Gap between stacked bands — generous while a column is sparse, tightening as
 * it fills, never past `NODE_GAP_MIN`. It is non-increasing in `bands`, which is
 * what lets each column plan its fold against its own band count before the
 * chart-wide gap (taken from the fullest column) is known: the real gap can only
 * be smaller, so the real budget can only be larger than the one planned for.
 */
function gapFor(bands: number, plotH: number): number {
  const { MIN_NODE_H, NODE_GAP_MIN, NODE_GAP_MAX } = SANKEY_LIMITS
  if (bands <= 1) return NODE_GAP_MAX
  // Whitespace is capped at a third of the plot so gaps never crowd out the
  // bands themselves, and again at the widest gap that still leaves every band
  // its floor height. Both terms fall as `bands` rises, so this is monotone.
  const share = plotH / (3 * bands)
  const feasible = (plotH - bands * MIN_NODE_H) / (bands - 1)
  return Math.min(NODE_GAP_MAX, Math.max(NODE_GAP_MIN, Math.min(share, feasible)))
}

/**
 * Would a column that keeps its `keep` largest nodes and folds the rest still
 * read as a proportional stack? False once too much of the column is bands
 * pinned to the floor, or once it needs more bands than the column can hold.
 */
function columnReadable(sorted: number[], keep: number, capacity: number, plotH: number): boolean {
  const kept = sorted.slice(0, keep)
  const foldedSum = sorted.slice(keep).reduce((a, b) => a + b, 0)
  const bandValues = keep < sorted.length ? [...kept, foldedSum] : kept
  if (bandValues.length === 0 || bandValues.length > capacity) return false
  const gap = gapFor(bandValues.length, plotH)
  const avail = plotH - (bandValues.length - 1) * gap
  const s = fitScale(bandValues, avail, SANKEY_LIMITS.MIN_NODE_H)
  if (s === null) return false
  // Negated so a NaN product (a zero value against an unconstrained scale)
  // counts as pinned rather than slipping through as "large enough".
  const pinned = bandValues.filter((v) => !(v * s >= SANKEY_LIMITS.MIN_NODE_H)).length
  return pinned * SANKEY_LIMITS.MIN_NODE_H <= avail * MAX_CLAMPED_SHARE
}

/**
 * How many of a column's nodes keep a band of their own. The rest fold into one
 * `Other (n)`. Keeps as many as stay readable — the search runs downward from
 * the column's capacity and stops at the first count that does.
 */
function keepCountFor(sorted: number[], capacity: number, plotH: number): number {
  const n = sorted.length
  const start = n <= capacity ? n : Math.max(0, capacity - 1)
  for (let keep = start; keep > 0; keep--) {
    if (columnReadable(sorted, keep, capacity, plotH)) return keep
  }
  // Nothing was readable. Under capacity the stack still fits, so keep it whole
  // rather than replacing a small chart with a single anonymous band.
  return n <= capacity ? n : 0
}

/**
 * Largest `s` for which `sum(max(minSize, v * s)) <= avail`.
 *
 * This is the fit rule that makes the floors safe. Clamping each item to a
 * minimum AFTER dividing space proportionally is what makes a naive stack
 * overflow: the clamp adds height the proportional budget never accounted for.
 * Solving for the scale instead means the clamp is inside the budget.
 *
 * The sum is monotone non-decreasing in `s`, so a bisection converges. Returns
 * `null` when even `s = 0` does not fit (`count * minSize > avail`), and
 * `Infinity` when no value is positive and therefore nothing constrains `s`.
 */
function fitScale(values: number[], avail: number, minSize: number): number | null {
  const n = values.length
  if (n === 0) return Number.POSITIVE_INFINITY
  if (n * minSize > avail) return null
  let peak = 0
  for (const v of values) if (v > peak) peak = v
  if (peak <= 0) return Number.POSITIVE_INFINITY

  // sum(max(minSize, v*hi)) >= peak*hi = avail, so the answer is at or below hi.
  let lo = 0
  let hi = avail / peak
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    let sum = 0
    for (const v of values) sum += Math.max(minSize, v * mid)
    if (sum <= avail) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Dependency-free layered Sankey / flow diagram. Nodes are placed in columns by
 * longest-path depth; ribbon width is proportional to flow value on a single
 * global scale (so a node's height equals its throughput). Colour follows the
 * source node (identity), links ride at low opacity and brighten on hover —
 * hovering a node isolates everything it touches. The signature "where the money
 * / the approvals flow" view.
 *
 * Density is bounded rather than hoped for: a column that would hold more bands
 * than `layerCapacity(height)` folds its smallest flows into one `Other (n)`
 * band, and labels that would collide are suppressed to the band's `<title>`.
 * See `computeLayout` for the guarantees this rests on.
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

  // A graph whose only links are self-links or dangle off unknown ids draws
  // nothing, so it must read as empty rather than as a blank measured box.
  const drawable = nodes.length > 0 && links.some((l) => l.value > 0 && l.source !== l.target)
  const empty = !drawable || (width > 0 && layout == null)

  return (
    <div ref={ref} data-testid="chart-sankey" className={className}>
      <div className="relative" style={{ height }}>
        {empty ? (
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
                  {/* Carries the reading of a band whose label had to be dropped. */}
                  <title>{`${nd.label}: ${formatValue(nd.value)}`}</title>
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
                  {nd.showLabel ? (
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
                  ) : null}
                </g>
              )
            })}
          </svg>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Links that must not drive column depth: a feedback edge can never satisfy
 * "one column to the right of its source", so the longest-path relaxation below
 * would push its endpoints one column further on every pass and stop only at
 * the iteration cap — a graph with a single 2-cycle would render one column per
 * node. Found by iterative DFS (a link into a node still on the stack), so the
 * flow is still drawn; it just does not get a vote on where the columns are.
 */
function backEdges(nodes: SankeyNode[], valLinks: SankeyLink[]): Set<SankeyLink> {
  const adj = new Map<string, SankeyLink[]>(nodes.map((n) => [n.id, []]))
  for (const l of valLinks) adj.get(l.source)!.push(l)
  const state = new Map<string, 0 | 1 | 2>(nodes.map((n) => [n.id, 0]))
  const back = new Set<SankeyLink>()
  for (const root of nodes) {
    if (state.get(root.id) !== 0) continue
    state.set(root.id, 1)
    const stack: { id: string; i: number }[] = [{ id: root.id, i: 0 }]
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      const edges = adj.get(top.id)!
      if (top.i >= edges.length) {
        state.set(top.id, 2)
        stack.pop()
        continue
      }
      const l = edges[top.i++]
      const st = state.get(l.target) ?? 0
      if (st === 1) back.add(l)
      else if (st === 0) {
        state.set(l.target, 1)
        stack.push({ id: l.target, i: 0 })
      }
    }
  }
  return back
}

type WorkLink = { source: string; target: string; value: number; order: number }
type Band = {
  id: string
  label: string
  value: number
  color: string
  layer: number
  aggregatedCount: number
}

/**
 * Places every node and ribbon, and is the only place the chart decides what it
 * is willing to draw. Four guarantees hold for every input, at every size:
 *
 *  A. Per column, `sum(band heights) + gaps <= plotH`. Bands never overlap and
 *     never leave the plot. Held by solving for the value→pixel scale with the
 *     minimum-height clamp inside the budget (`fitScale`), and by folding the
 *     smallest flows of a column into one `Other (n)` band once it would exceed
 *     `layerCapacity(height)` bands, or once more than `MAX_CLAMPED_SHARE` of
 *     its budget would be bands pinned to `MIN_NODE_H`.
 *  B. Every band is at least `MIN_NODE_H` tall; every ribbon endpoint is at
 *     least `min(MIN_RIBBON_H, bandHeight / linkCount)` thick — the floor,
 *     unless the band physically cannot host that many ribbons at the floor, in
 *     which case the ribbons share the band equally: connectivity survives even
 *     where proportion cannot.
 *  C. Ribbon endpoints stacked on a band stay inside that band.
 *  D. Two labels in one column are never closer than `LABEL_LINE_H`. Labels are
 *     committed largest-flow-first, so what survives crowding is what matters.
 *
 * Returns `null` when there is nothing to draw.
 */
export function computeLayout(
  nodes: SankeyNode[],
  links: SankeyLink[],
  width: number,
  height: number,
  nodeWidth: number
): SankeyLayout | null {
  const { MIN_NODE_H, MIN_RIBBON_H, LABEL_LINE_H, PAD_Y } = SANKEY_LIMITS
  const plotH = height - PAD_Y * 2
  if (nodes.length === 0 || width <= 0 || plotH <= 0) return null

  const byId = new Map(nodes.map((n, i) => [n.id, { ...n, idx: i }]))
  // A self-link has no ribbon to draw between two columns, and it makes the
  // longest-path pass below run away (a node can never out-rank itself), so it
  // is dropped rather than rendered as a degenerate blob at runaway depth.
  const valLinks = links.filter(
    (l) => l.value > 0 && l.source !== l.target && byId.has(l.source) && byId.has(l.target)
  )
  if (valLinks.length === 0) return null

  // Longest-path layering from sources, over the acyclic part of the graph.
  const feedback = backEdges(nodes, valLinks)
  const rankLinks = feedback.size === 0 ? valLinks : valLinks.filter((l) => !feedback.has(l))
  const layerOf = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  for (let iter = 0; iter < nodes.length; iter++) {
    let changed = false
    for (const l of rankLinks) {
      const want = (layerOf.get(l.source) ?? 0) + 1
      if ((layerOf.get(l.target) ?? 0) < want) {
        layerOf.set(l.target, want)
        changed = true
      }
    }
    if (!changed) break
  }
  const maxLayer = nodes.reduce((m, n) => Math.max(m, layerOf.get(n.id) ?? 0), 0)

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

  const rawLayers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const n of nodes) rawLayers[layerOf.get(n.id) ?? 0].push(n.id)

  // ── Capacity: fold a column that cannot be drawn legibly ──────────────────
  const capacity = layerCapacity(height)
  const foldTo = new Map<string, string>()
  const bands = new Map<string, Band>()
  const layers: string[][] = []
  let foldedNodes = 0

  rawLayers.forEach((ids, L) => {
    // Rank by throughput so the flows that carry the story survive; original
    // input order breaks ties, so the same graph always folds the same way.
    const ranked = [...ids].sort(
      (a, b) => (through.get(b) ?? 0) - (through.get(a) ?? 0) || byId.get(a)!.idx - byId.get(b)!.idx
    )
    const keep = keepCountFor(
      ranked.map((id) => through.get(id) ?? 0),
      capacity,
      plotH
    )
    const keepSet = new Set(ranked.slice(0, keep))
    // Kept bands stay in input order so the column does not reshuffle as data
    // changes; the fold, being a summary, sits at the bottom.
    const kept = keep >= ids.length ? ids : ids.filter((id) => keepSet.has(id))
    const folded = keep >= ids.length ? [] : ids.filter((id) => !keepSet.has(id))
    const column: string[] = []
    for (const id of kept) {
      const meta = byId.get(id)!
      bands.set(id, {
        id,
        label: meta.label,
        value: through.get(id) ?? 0,
        color: meta.color ?? slotColor(meta.idx % 8),
        layer: L,
        aggregatedCount: 0,
      })
      column.push(id)
    }
    if (folded.length > 0) {
      const otherId = `__other__${L}`
      for (const id of folded) foldTo.set(id, otherId)
      foldedNodes += folded.length
      bands.set(otherId, {
        id: otherId,
        label: `Other (${folded.length})`,
        value: folded.reduce((s, id) => s + (through.get(id) ?? 0), 0),
        // An aggregate is not an entity, so it must not wear a categorical slot.
        color: MUTED_SERIES,
        layer: L,
        aggregatedCount: folded.length,
      })
      column.push(otherId)
    }
    layers.push(column)
  })

  // Re-point folded endpoints at their `Other` band and merge the duplicates
  // that creates, so one thick ribbon replaces a hundred hairlines.
  const merged = new Map<string, WorkLink>()
  valLinks.forEach((l, i) => {
    const s = foldTo.get(l.source) ?? l.source
    const t = foldTo.get(l.target) ?? l.target
    if (s === t) return // both ends folded into the same band
    const key = `${s}\u0000${t}`
    const prev = merged.get(key)
    if (prev) prev.value += l.value
    else merged.set(key, { source: s, target: t, value: l.value, order: i })
  })
  const workLinks = [...merged.values()]
  if (workLinks.length === 0) return null

  // ── Vertical budget ───────────────────────────────────────────────────────
  const maxN = layers.reduce((m, c) => Math.max(m, c.length), 1)
  const nodeGap = gapFor(maxN, plotH)

  let scale = Number.POSITIVE_INFINITY
  for (const column of layers) {
    if (column.length === 0) continue
    const avail = plotH - (column.length - 1) * nodeGap
    const s = fitScale(
      column.map((id) => bands.get(id)!.value),
      avail,
      MIN_NODE_H
    )
    scale = Math.min(scale, s ?? 0)
  }
  if (!Number.isFinite(scale)) scale = 0

  const colX = (L: number) => (maxLayer === 0 ? 8 : 8 + (L / maxLayer) * (width - 16 - nodeWidth))

  const pos = new Map<string, { x: number; y: number; h: number }>()
  layers.forEach((column, L) => {
    const x = colX(L)
    const hs = column.map((id) => Math.max(MIN_NODE_H, bands.get(id)!.value * scale))
    const totalH = hs.reduce((a, b) => a + b, 0) + Math.max(0, column.length - 1) * nodeGap
    let y = PAD_Y + Math.max(0, (plotH - totalH) / 2)
    column.forEach((id, i) => {
      pos.set(id, { x, y, h: hs[i] })
      y += hs[i] + nodeGap
    })
  })

  // Stack link endpoints on each band, ordered by the counterpart's y to reduce
  // crossings, then floored and re-fitted so no ribbon vanishes or overflows.
  const outBy = new Map<string, WorkLink[]>()
  const inBy = new Map<string, WorkLink[]>()
  for (const id of bands.keys()) {
    outBy.set(id, [])
    inBy.set(id, [])
  }
  for (const l of workLinks) {
    outBy.get(l.source)!.push(l)
    inBy.get(l.target)!.push(l)
  }
  outBy.forEach((lst) =>
    lst.sort((a, b) => pos.get(a.target)!.y - pos.get(b.target)!.y || a.order - b.order)
  )
  inBy.forEach((lst) =>
    lst.sort((a, b) => pos.get(a.source)!.y - pos.get(b.source)!.y || a.order - b.order)
  )

  const stack = (lst: WorkLink[], nodeId: string, into: Map<WorkLink, [number, number]>) => {
    if (lst.length === 0) return
    const p = pos.get(nodeId)!
    const vals = lst.map((l) => l.value)
    const s = fitScale(vals, p.h, MIN_RIBBON_H)
    const widths =
      s === null
        ? // The band cannot host this many ribbons at the floor. Show that the
          // connections exist rather than drawing sub-pixel proportions.
          vals.map(() => p.h / vals.length)
        : vals.map((v) => Math.max(MIN_RIBBON_H, v * Math.min(scale, s)))
    const total = widths.reduce((a, b) => a + b, 0)
    let y = p.y + Math.max(0, (p.h - total) / 2)
    lst.forEach((l, i) => {
      into.set(l, [y, y + widths[i]])
      y += widths[i]
    })
  }

  const sy = new Map<WorkLink, [number, number]>()
  const ty = new Map<WorkLink, [number, number]>()
  outBy.forEach((lst, id) => stack(lst, id, sy))
  inBy.forEach((lst, id) => stack(lst, id, ty))

  const ribbons: SankeyRibbon[] = workLinks.map((l) => {
    const sp = pos.get(l.source)!
    const tp = pos.get(l.target)!
    const [syt, syb] = sy.get(l)!
    const [tyt, tyb] = ty.get(l)!
    const sx = sp.x + nodeWidth
    const tx = tp.x
    const mx = (sx + tx) / 2
    const d = `M${sx},${syt} C${mx},${syt} ${mx},${tyt} ${tx},${tyt} L${tx},${tyb} C${mx},${tyb} ${mx},${syb} ${sx},${syb} Z`
    return {
      d,
      color: bands.get(l.source)!.color,
      source: l.source,
      target: l.target,
      value: l.value,
      sourceLabel: bands.get(l.source)!.label,
      targetLabel: bands.get(l.target)!.label,
      sourceY: syt,
      sourceH: syb - syt,
      targetY: tyt,
      targetH: tyb - tyt,
    }
  })

  // Commit labels largest-flow-first: crowding costs the smallest flows their
  // label, never the ones the chart exists to show.
  const labelled = new Set<string>()
  for (const column of layers) {
    const centre = new Map<string, number>()
    for (const id of column) {
      const p = pos.get(id)!
      centre.set(id, p.y + p.h / 2)
    }
    const byImportance = [...column].sort(
      (a, b) => bands.get(b)!.value - bands.get(a)!.value || centre.get(a)! - centre.get(b)!
    )
    const taken: number[] = []
    for (const id of byImportance) {
      const c = centre.get(id)!
      if (taken.every((t) => Math.abs(t - c) >= LABEL_LINE_H)) {
        labelled.add(id)
        taken.push(c)
      }
    }
  }

  const outNodes: SankeyPositionedNode[] = []
  layers.forEach((column, L) => {
    for (const id of column) {
      const b = bands.get(id)!
      const p = pos.get(id)!
      outNodes.push({
        id,
        label: b.label,
        x: p.x,
        y: p.y,
        h: p.h,
        value: b.value,
        color: b.color,
        layer: L,
        labelLeft: L === maxLayer && maxLayer > 0,
        showLabel: labelled.has(id),
        aggregatedCount: b.aggregatedCount,
      })
    }
  })

  return { nodes: outNodes, ribbons, plotH, nodeGap, scale, capacity, foldedNodes }
}
