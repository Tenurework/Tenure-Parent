/**
 * @jest-environment jsdom
 */
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import {
  SANKEY_LIMITS,
  SankeyChart,
  computeLayout,
  layerCapacity,
  type SankeyLayout,
  type SankeyLink,
  type SankeyNode,
} from "./SankeyChart"

/**
 * The Sankey is the only chart in the product whose legibility degrades
 * *silently*: too many nodes in a column and the bands overlap, too little flow
 * on a link and the ribbon becomes a sub-pixel hairline, and either way the SVG
 * renders without complaint. Nothing here asserts a pixel; everything asserts a
 * bound the layout promised in its own doc comment, at four graph sizes:
 *
 *   small        3 nodes  — the shape both production callers actually ship
 *   medium      25 nodes  — a real analytics fan-in, at two chart heights
 *   large      201 nodes  — past any column's capacity
 *   pathological         — 500 equal flows, zero-value links, a self-link, a cycle
 *
 * `computeLayout` is exported for exactly this: the component is a `useMemo`
 * around it plus SVG, so the arithmetic is where the failure would live.
 */

const { MIN_NODE_H, MIN_RIBBON_H, LABEL_LINE_H, PAD_Y } = SANKEY_LIMITS
const EPS = 1e-6
const WIDTH = 720

// ── fixtures ────────────────────────────────────────────────────────────────

/** Approvals: two requesters into one board. */
function small(): { nodes: SankeyNode[]; links: SankeyLink[] } {
  return {
    nodes: [
      { id: "a", label: "Finance" },
      { id: "b", label: "Facilities" },
      { id: "board", label: "Board" },
    ],
    links: [
      { source: "a", target: "board", value: 30 },
      { source: "b", target: "board", value: 12 },
    ],
  }
}

/** A fan-in/fan-out with a spread of magnitudes, like the seat-allocation flow. */
function medium(): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  for (let i = 0; i < 20; i++) {
    nodes.push({ id: `s${i}`, label: `Category ${i}` })
    links.push({ source: `s${i}`, target: "hub", value: 200 - i * 8 })
  }
  nodes.push({ id: "hub", label: "Allocated" })
  for (let j = 0; j < 4; j++) {
    nodes.push({ id: `t${j}`, label: `Outcome ${j}` })
    links.push({ source: "hub", target: `t${j}`, value: 660 + j * 40 })
  }
  return { nodes, links }
}

/** 200 sources into one sink — past capacity at any chart height we ship. */
function large(): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const nodes: SankeyNode[] = [{ id: "sink", label: "Total" }]
  const links: SankeyLink[] = []
  for (let i = 0; i < 200; i++) {
    nodes.push({ id: `n${i}`, label: `Node ${i}` })
    links.push({ source: `n${i}`, target: "sink", value: 1 + (i % 17) })
  }
  return { nodes, links }
}

/**
 * 500 identical flows (no magnitude to rank on), a zero-value link, a self-link,
 * and a two-node cycle — each of which has its own way of breaking a layout.
 */
function pathological(): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const nodes: SankeyNode[] = [
    { id: "sink", label: "Sink" },
    { id: "ghost", label: "Unconnected" },
    { id: "cyc1", label: "Cycle A" },
    { id: "cyc2", label: "Cycle B" },
  ]
  const links: SankeyLink[] = [
    { source: "sink", target: "sink", value: 999 }, // self-link
    { source: "ghost", target: "sink", value: 0 }, // zero-value link
    { source: "cyc1", target: "cyc2", value: 5 },
    { source: "cyc2", target: "cyc1", value: 5 }, // cycle
  ]
  for (let i = 0; i < 500; i++) {
    nodes.push({ id: `p${i}`, label: `Flow ${i}` })
    links.push({ source: `p${i}`, target: "sink", value: 100 })
  }
  return { nodes, links }
}

// ── shared invariant battery ────────────────────────────────────────────────

function columnsOf(layout: SankeyLayout) {
  const byLayer = new Map<number, SankeyLayout["nodes"]>()
  for (const n of layout.nodes) {
    const c = byLayer.get(n.layer) ?? []
    c.push(n)
    byLayer.set(n.layer, c)
  }
  for (const c of byLayer.values()) c.sort((a, b) => a.y - b.y)
  return [...byLayer.values()]
}

/** Every bound `computeLayout` documents, checked against one laid-out graph. */
function assertLegible(layout: SankeyLayout, height: number) {
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]))

  for (const column of columnsOf(layout)) {
    // A — the stack fits the plot, and bands never overlap.
    const stacked = column.reduce((s, n) => s + n.h, 0) + (column.length - 1) * layout.nodeGap
    expect(stacked).toBeLessThanOrEqual(layout.plotH + EPS)
    expect(column.length).toBeLessThanOrEqual(layout.capacity)
    for (let i = 1; i < column.length; i++) {
      expect(column[i].y).toBeGreaterThanOrEqual(column[i - 1].y + column[i - 1].h - EPS)
    }
    expect(column[0].y).toBeGreaterThanOrEqual(PAD_Y - EPS)
    const last = column[column.length - 1]
    expect(last.y + last.h).toBeLessThanOrEqual(height - PAD_Y + EPS)

    // A — folding happened early enough that floor-height bands do not own the
    // column. (`avail` is the budget the layout planned this column against.)
    const avail = layout.plotH - (column.length - 1) * layout.nodeGap
    const pinned = column.filter((n) => n.h <= MIN_NODE_H + EPS).length
    expect(pinned * MIN_NODE_H).toBeLessThanOrEqual(avail * 0.5 + EPS)

    // D — no two labels in a column are closer than one line.
    const shown = column.filter((n) => n.showLabel).map((n) => n.y + n.h / 2)
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i] - shown[i - 1]).toBeGreaterThanOrEqual(LABEL_LINE_H - EPS)
    }
    expect(shown.length).toBeGreaterThan(0)
  }

  // B — no band is a hairline.
  for (const n of layout.nodes) expect(n.h).toBeGreaterThanOrEqual(MIN_NODE_H - EPS)

  const outDeg = new Map<string, number>()
  const inDeg = new Map<string, number>()
  for (const r of layout.ribbons) {
    outDeg.set(r.source, (outDeg.get(r.source) ?? 0) + 1)
    inDeg.set(r.target, (inDeg.get(r.target) ?? 0) + 1)
  }

  for (const r of layout.ribbons) {
    expect(r.value).toBeGreaterThan(0)
    expect(r.source).not.toBe(r.target)
    const s = nodeById.get(r.source)!
    const t = nodeById.get(r.target)!
    expect(s).toBeDefined()
    expect(t).toBeDefined()

    // C — endpoints stay inside the band they hang off.
    expect(r.sourceY).toBeGreaterThanOrEqual(s.y - EPS)
    expect(r.sourceY + r.sourceH).toBeLessThanOrEqual(s.y + s.h + EPS)
    expect(r.targetY).toBeGreaterThanOrEqual(t.y - EPS)
    expect(r.targetY + r.targetH).toBeLessThanOrEqual(t.y + t.h + EPS)

    // B — thick enough to see, or an equal share of a band too thin to hold
    // that many ribbons at the floor.
    expect(r.sourceH).toBeGreaterThanOrEqual(
      Math.min(MIN_RIBBON_H, s.h / outDeg.get(r.source)!) - EPS
    )
    expect(r.targetH).toBeGreaterThanOrEqual(
      Math.min(MIN_RIBBON_H, t.h / inDeg.get(r.target)!) - EPS
    )
  }
}

function layoutOf(g: { nodes: SankeyNode[]; links: SankeyLink[] }, height: number) {
  const layout = computeLayout(g.nodes, g.links, WIDTH, height, 14)
  expect(layout).not.toBeNull()
  return layout!
}

// ── the four sizes ──────────────────────────────────────────────────────────

describe("computeLayout stays legible as the graph grows", () => {
  it("small: draws every node, labels every node, folds nothing", () => {
    const layout = layoutOf(small(), 300)
    assertLegible(layout, 300)
    expect(layout.foldedNodes).toBe(0)
    expect(layout.nodes).toHaveLength(3)
    expect(layout.nodes.every((n) => n.showLabel)).toBe(true)
    expect(layout.nodes.every((n) => n.aggregatedCount === 0)).toBe(true)
    // Throughput sizing: the board carries both flows, so it is the tall band.
    expect(layout.nodes.find((n) => n.id === "board")!.value).toBe(42)
  })

  it("medium at 300px: 20 categories all keep their own band", () => {
    const layout = layoutOf(medium(), 300)
    assertLegible(layout, 300)
    expect(layout.foldedNodes).toBe(0)
    expect(layout.nodes).toHaveLength(25)
  })

  it("medium at 120px: the same graph folds rather than overlapping", () => {
    const layout = layoutOf(medium(), 120)
    assertLegible(layout, 120)
    expect(layerCapacity(120)).toBeLessThan(20)
    expect(layout.foldedNodes).toBeGreaterThan(0)
    const other = layout.nodes.filter((n) => n.aggregatedCount > 0)
    expect(other).toHaveLength(1)
    expect(other[0].label).toBe(`Other (${other[0].aggregatedCount})`)
  })

  it("large: 200 sources fold into one Other band carrying their whole sum", () => {
    const g = large()
    const layout = layoutOf(g, 300)
    assertLegible(layout, 300)

    const sources = layout.nodes.filter((n) => n.layer === 0)
    const other = sources.filter((n) => n.aggregatedCount > 0)
    expect(other).toHaveLength(1)
    expect(sources.length).toBeLessThan(200)
    expect(sources.length).toBeLessThanOrEqual(layout.capacity)

    // The fold conserves value: kept bands + Other = the whole column.
    const columnTotal = g.links.reduce((s, l) => s + l.value, 0)
    const kept = sources.filter((n) => n.aggregatedCount === 0)
    expect(kept.reduce((s, n) => s + n.value, 0) + other[0].value).toBeCloseTo(columnTotal, 6)
    expect(other[0].aggregatedCount).toBe(200 - kept.length)
    expect(layout.foldedNodes).toBe(200 - kept.length)
    expect(other[0].label).toBe(`Other (${200 - kept.length})`)

    // The fold conserves flow too: no ribbon was dropped on the floor.
    expect(layout.ribbons.reduce((s, r) => s + r.value, 0)).toBeCloseTo(columnTotal, 6)
  })

  it("pathological: 500 equal flows, a self-link, a cycle and a zero-value link", () => {
    const g = pathological()
    const layout = layoutOf(g, 300)
    assertLegible(layout, 300)

    // Neither the self-link nor the cycle is allowed to drive column depth —
    // untreated, longest-path layering gives them one column per node.
    expect(layout.nodes.every((n) => n.layer <= 1)).toBe(true)
    expect(layout.ribbons.some((r) => r.source === "sink")).toBe(false)
    // Excluding the feedback edge from ranking does not delete it: the cycle's
    // flow is still drawn in both directions, it just does not set the columns.
    expect(layout.ribbons.filter((r) => r.target === "cyc2")).toHaveLength(1)
    expect(layout.ribbons.filter((r) => r.source === "cyc2")).toHaveLength(1)

    // The zero-value link contributes nothing, so "Unconnected" never appears.
    expect(layout.nodes.some((n) => n.id === "ghost")).toBe(false)

    // 500 identical flows give the ranking nothing to work with, so almost all
    // of them fold — and the fold still adds up to the column it replaced
    // (500 × 100, plus the cycle's 5; the unconnected node carries nothing).
    const other = layout.nodes.filter((n) => n.aggregatedCount > 0)
    expect(other).toHaveLength(1)
    const firstColumn = layout.nodes.filter((n) => n.layer === 0)
    expect(firstColumn.reduce((s, n) => s + n.value, 0)).toBeCloseTo(50_005, 6)
    expect(other[0].value).toBeCloseTo(
      50_005 - firstColumn.filter((n) => n.aggregatedCount === 0).reduce((s, n) => s + n.value, 0),
      6
    )
    expect(layout.foldedNodes).toBeGreaterThan(400)
  })

  it("is deterministic — same input, byte-identical layout", () => {
    const g = large()
    const a = computeLayout(g.nodes, g.links, WIDTH, 300, 14)
    const b = computeLayout(g.nodes, g.links, WIDTH, 300, 14)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it("crowding costs a label only to a band a shown label already covers", () => {
    // 20 bands in a 288px plot puts label centres ~9px apart, under the 12px a
    // line needs — so this is the size at which the rule has to be live.
    const layout = layoutOf(medium(), 300)
    const column = columnsOf(layout).find((c) => c.length === 20)!
    const suppressed = column.filter((n) => !n.showLabel)
    expect(suppressed.length).toBeGreaterThan(0)

    // The biggest flow in a column never loses its label…
    const biggest = column.reduce((a, b) => (b.value > a.value ? b : a))
    expect(biggest.showLabel).toBe(true)

    // …and nothing is dropped except where a shown label is already there.
    const shown = column.filter((n) => n.showLabel).map((n) => n.y + n.h / 2)
    for (const n of suppressed) {
      const centre = n.y + n.h / 2
      expect(shown.some((c) => Math.abs(c - centre) < LABEL_LINE_H)).toBe(true)
    }
  })
})

/**
 * Both shipping callers — `panels/ReportsAnalytics.tsx` (seat allocation) and
 * `finance/PortfolioSankey.tsx` via `reports/finance/page.tsx` (budget split) —
 * build the same shape: N categories, each splitting into two sinks, at a height
 * that grows with N. Bounding density must not cost that shape anything.
 */
describe("the shape both production callers ship", () => {
  const split = (n: number) => {
    const nodes: SankeyNode[] = [
      { id: "left", label: "Spent" },
      { id: "right", label: "Remaining" },
    ]
    const links: SankeyLink[] = []
    for (let i = 0; i < n; i++) {
      nodes.unshift({ id: `c${i}`, label: `Club ${i}` })
      links.push({ source: `c${i}`, target: "left", value: 5_000 + i * 900 })
      links.push({ source: `c${i}`, target: "right", value: 1_200 + i * 300 })
    }
    return { nodes, links }
  }

  it.each([4, 8, 12, 18])("keeps every one of %i categories, labelled", (n) => {
    const height = Math.max(300, n * 34)
    const layout = layoutOf(split(n), height)
    assertLegible(layout, height)
    expect(layout.foldedNodes).toBe(0)
    expect(layout.nodes).toHaveLength(n + 2)
    expect(layout.nodes.filter((x) => !x.showLabel)).toHaveLength(0)
  })
})

describe("computeLayout declines to draw what it cannot draw", () => {
  it("returns null when every link is a self-link", () => {
    expect(
      computeLayout(
        [{ id: "a", label: "A" }],
        [{ source: "a", target: "a", value: 10 }],
        WIDTH,
        300,
        14
      )
    ).toBeNull()
  })

  it("returns null before the container has been measured", () => {
    const g = small()
    expect(computeLayout(g.nodes, g.links, 0, 300, 14)).toBeNull()
  })

  it("returns null when the height leaves no plot area", () => {
    const g = small()
    expect(computeLayout(g.nodes, g.links, WIDTH, 2 * PAD_Y, 14)).toBeNull()
  })
})

describe("layerCapacity", () => {
  it("is the count that exactly fills the plot at floor height and tightest gap", () => {
    const height = 300
    const k = layerCapacity(height)
    const plotH = height - PAD_Y * 2
    expect(k * MIN_NODE_H + (k - 1) * SANKEY_LIMITS.NODE_GAP_MIN).toBeLessThanOrEqual(plotH)
    expect((k + 1) * MIN_NODE_H + k * SANKEY_LIMITS.NODE_GAP_MIN).toBeGreaterThan(plotH)
  })

  it("never promises a column it cannot draw", () => {
    for (const h of [40, 120, 260, 300, 480, 900]) expect(layerCapacity(h)).toBeGreaterThanOrEqual(1)
  })
})

/**
 * The layout rules above are only worth anything if the component obeys them.
 * `SankeyChart` is the production caller — `panels/ReportsAnalytics.tsx:207`
 * and `finance/PortfolioSankey.tsx:19` both render it — so this drives the real
 * component in a DOM and reads the SVG it produces.
 */
describe("SankeyChart renders what the layout decided", () => {
  const mount = (g: { nodes: SankeyNode[]; links: SankeyLink[] }, height: number) => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(createElement(SankeyChart, { nodes: g.nodes, links: g.links, height }))
    })
    const svg = host.querySelector("svg")
    return { host, root, svg }
  }

  beforeAll(() => {
    // jsdom has no ResizeObserver and reports clientWidth 0, so the chart would
    // never leave its pre-measurement state. Stand in for a measured container.
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(private cb: (e: { contentRect: { width: number } }[]) => void) {}
      observe() {
        this.cb([{ contentRect: { width: WIDTH } }])
      }
      unobserve() {}
      disconnect() {}
    }
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  it("draws one band per laid-out node and skips the suppressed labels", () => {
    const g = medium()
    const layout = layoutOf(g, 300)
    const suppressed = layout.nodes.filter((n) => !n.showLabel).length
    expect(suppressed).toBeGreaterThan(0)

    const { host, root, svg } = mount(g, 300)
    expect(svg).not.toBeNull()
    expect(svg!.querySelectorAll("rect")).toHaveLength(layout.nodes.length)
    // The label the layout suppressed is not in the DOM…
    expect(svg!.querySelectorAll("text")).toHaveLength(layout.nodes.length - suppressed)
    // …but its reading is: every band keeps a <title>, suppressed or not.
    const titles = [...svg!.querySelectorAll("g > title")].map((t) => t.textContent)
    expect(titles).toHaveLength(layout.nodes.length)
    for (const n of layout.nodes.filter((x) => !x.showLabel)) {
      expect(titles.some((t) => t?.startsWith(`${n.label}:`))).toBe(true)
    }
    act(() => root.unmount())
    host.remove()
  })

  it("shows the empty state rather than a blank box when nothing is drawable", () => {
    const { host, root, svg } = mount(
      { nodes: [{ id: "a", label: "A" }], links: [{ source: "a", target: "a", value: 10 }] },
      300
    )
    expect(svg).toBeNull()
    expect(host.textContent).toContain("No data")
    act(() => root.unmount())
    host.remove()
  })
})
