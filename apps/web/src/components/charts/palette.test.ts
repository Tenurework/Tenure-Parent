import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { CHART_SLOTS, slotsForKeys } from "./palette"
import { DonutChart, type DonutDatum } from "./DonutChart"
import { ReportsAnalytics } from "./panels/ReportsAnalytics"

/**
 * A category's colour is part of how a reader identifies it. The reports panel
 * ranks memory types by count inside a `useMemo` keyed on the range filter, so
 * the SAME donut is handed the same categories in a different order as the user
 * moves between "This term" and "12 months". If the palette is keyed on array
 * position, PLAYBOOK and CONTACT trade hues on that click and the legend means
 * something different in each view.
 *
 * These are the eight MemoryRecordType values (prisma/schema.prisma:679) — the
 * real keys the reports donut is drawn from.
 */
const MEMORY_TYPES = [
  "CONTACT",
  "PLAYBOOK",
  "BUDGET",
  "VENDOR",
  "LESSON",
  "THREAD",
  "CREDENTIAL",
  "DEADLINE",
] as const

const shuffledOnce = ["THREAD", "BUDGET", "DEADLINE", "VENDOR", "CREDENTIAL", "CONTACT", "LESSON", "PLAYBOOK"]

describe("slotsForKeys", () => {
  it("gives a key the same colour under every permutation of the same keys", () => {
    const base = slotsForKeys(MEMORY_TYPES)
    const reversed = slotsForKeys([...MEMORY_TYPES].reverse())
    const shuffled = slotsForKeys(shuffledOnce)
    const sorted = slotsForKeys([...MEMORY_TYPES].sort())
    for (const key of MEMORY_TYPES) {
      expect(reversed.get(key)).toBe(base.get(key))
      expect(shuffled.get(key)).toBe(base.get(key))
      expect(sorted.get(key)).toBe(base.get(key))
    }
  })

  it("still gives every category of a ≤8-category chart a distinct slot", () => {
    const assigned = [...slotsForKeys(MEMORY_TYPES).values()]
    expect(assigned).toHaveLength(8)
    expect(new Set(assigned).size).toBe(8)
    for (const c of assigned) expect(CHART_SLOTS).toContain(c)
  })

  it("does not repaint a key when the chart's other categories change", () => {
    const all = slotsForKeys(MEMORY_TYPES)
    // What a range filter actually does: some types have no records in the
    // window, so the donut is drawn from a subset.
    const subset = slotsForKeys(["VENDOR", "PLAYBOOK", "CONTACT"])
    expect(subset.get("CONTACT")).toBe(all.get("CONTACT"))
    expect(subset.get("PLAYBOOK")).toBe(all.get("PLAYBOOK"))
    // A single key on its own keeps the hue it has in the full chart.
    expect(slotsForKeys(["PLAYBOOK"]).get("PLAYBOOK")).toBe(all.get("PLAYBOOK"))
  })

  it("is pinned to fixed hues — same answer in every process, run and platform", () => {
    // A hash that varied by process would still pass the permutation tests above
    // while repainting the chart between the server render and the client one.
    expect(Object.fromEntries(slotsForKeys(MEMORY_TYPES))).toEqual({
      VENDOR: "var(--chart-1)",
      PLAYBOOK: "var(--chart-2)",
      CONTACT: "var(--chart-3)",
      CREDENTIAL: "var(--chart-4)",
      DEADLINE: "var(--chart-5)",
      THREAD: "var(--chart-6)",
      LESSON: "var(--chart-7)",
      BUDGET: "var(--chart-8)",
    })
  })

  it("reads the whole key, not just the bits a weak hash leaves in the low byte", () => {
    // Case differs by one bit (0x20), and in FNV-1a that bit can never propagate
    // down into the low three bits that `% 8` reads — so a raw `fnv % 8` puts
    // EVERY case-pair on the same slot, and a chart keyed on display labels is
    // silently a chart keyed on their upper-case enums. The avalanche finalizer
    // is what fixes that; this counts how many of the eight real pairs separate.
    const titleCase = (s: string) => s[0] + s.slice(1).toLowerCase()
    const separated = MEMORY_TYPES.filter(
      (t) => slotsForKeys([t]).get(t) !== slotsForKeys([titleCase(t)]).get(titleCase(t))
    )
    expect(separated.length).toBeGreaterThanOrEqual(6)
  })

  it("de-duplicates, and stays deterministic past the eighth key", () => {
    expect(slotsForKeys(["CONTACT", "CONTACT"]).size).toBe(1)
    const nine = [...MEMORY_TYPES, "MINUTES"]
    const map = slotsForKeys(nine)
    expect(map.size).toBe(9)
    for (const c of map.values()) expect(CHART_SLOTS).toContain(c)
    // Nine categories into eight slots: a hue is reused rather than the call
    // throwing or handing back an undefined colour. Distinctness is what gives
    // out here — identity does not: the assignment is still permutation-proof.
    expect(new Set(map.values()).size).toBe(8)
    expect(Object.fromEntries(map)).toEqual(Object.fromEntries(slotsForKeys([...nine].reverse())))
  })
})

/** The colour each segment and each legend swatch is actually painted with. */
function renderDonut(data: DonutDatum[]): { arcs: Record<string, string>; legend: Record<string, string> } {
  const html = renderToStaticMarkup(
    createElement(DonutChart, { data, formatValue: (n: number) => String(n) })
  )
  const arcs: Record<string, string> = {}
  for (const [tag] of html.matchAll(/<circle\b[^>]*>/g)) {
    const label = /aria-label="([^":]+):/.exec(tag)?.[1]
    const stroke = /stroke="([^"]+)"/.exec(tag)?.[1]
    if (label && stroke) arcs[label] = stroke
  }
  const legend: Record<string, string> = {}
  for (const li of html.split("<li").slice(1)) {
    const swatch = /background:\s*([^;"]+)/.exec(li)?.[1]
    const label = /class="min-w-0 flex-1 truncate[^"]*">([^<]*)</.exec(li)?.[1]
    if (label && swatch) legend[label] = swatch
  }
  return { arcs, legend }
}

describe("DonutChart", () => {
  // The two orderings the reports panel produces for the same four categories:
  // counts fall differently over a term than over twelve months, so the
  // count-descending sort hands the chart a different row order.
  const thisTerm: DonutDatum[] = [
    { key: "CONTACT", label: "Contact", value: 31 },
    { key: "LESSON", label: "Lesson", value: 18 },
    { key: "PLAYBOOK", label: "Playbook", value: 12 },
    { key: "VENDOR", label: "Vendor", value: 4 },
  ]
  const twelveMonths: DonutDatum[] = [
    { key: "VENDOR", label: "Vendor", value: 96 },
    { key: "PLAYBOOK", label: "Playbook", value: 74 },
    { key: "LESSON", label: "Lesson", value: 40 },
    { key: "CONTACT", label: "Contact", value: 39 },
  ]

  it("paints a category the same colour however the rows are ranked", () => {
    const a = renderDonut(thisTerm)
    const b = renderDonut(twelveMonths)
    expect(Object.keys(a.arcs).sort()).toEqual(["Contact", "Lesson", "Playbook", "Vendor"])
    expect(a.arcs).toEqual(b.arcs)
    // The legend swatch has to move with the arc, or the legend lies.
    expect(a.legend).toEqual(a.arcs)
    expect(b.legend).toEqual(b.arcs)
    // Not vacuously equal: the four categories are four different hues.
    expect(new Set(Object.values(a.arcs)).size).toBe(4)
  })

  it("keys colour on `key`, so re-labelling a category does not repaint it", () => {
    const renamed = thisTerm.map((d) => ({ ...d, label: `${d.label} cards` }))
    const before = renderDonut(thisTerm).arcs
    const after = renderDonut(renamed).arcs
    for (const d of thisTerm) expect(after[`${d.label} cards`]).toBe(before[d.label])
  })

  it("falls back to the label when a datum carries no key", () => {
    const unkeyed = thisTerm.map((d) => ({ label: d.label, value: d.value }))
    const { arcs } = renderDonut(unkeyed)
    expect(arcs).toEqual(slotColoursFor(["Contact", "Lesson", "Playbook", "Vendor"]))
  })

  it("lets an explicit colour win, for the reserved status tokens", () => {
    const { arcs } = renderDonut([
      { key: "CONTACT", label: "Contact", value: 3, color: "var(--error)" },
      { key: "LESSON", label: "Lesson", value: 5 },
    ])
    expect(arcs.Contact).toBe("var(--error)")
    expect(arcs.Lesson).toBe(slotsForKeys(["CONTACT", "LESSON"]).get("LESSON"))
  })
})

function slotColoursFor(keys: string[]): Record<string, string> {
  return Object.fromEntries(slotsForKeys(keys))
}

/**
 * The panel is where the bug lived: `memoryData` is sorted by count inside a
 * `useMemo` keyed on the range filter, so the donut's row order is a function of
 * the window the user picked. These render the real panel — the same component
 * app/(app)/reports/page.tsx mounts — over two windows in which the categories
 * rank differently.
 */
describe("ReportsAnalytics memory donut", () => {
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()
  const card = (type: string, daysAgo: number) => ({ type, createdAt: iso(daysAgo) })

  function panelDonut(memory: { type: string; createdAt: string }[]): Record<string, string> {
    const html = renderToStaticMarkup(
      createElement(ReportsAnalytics, {
        approvals: [{ status: "APPROVED", createdAt: iso(20) }],
        decisions: [{ occurredAt: iso(20), durationMs: 7.2e6 }],
        eventDates: [iso(15)],
        memory,
        roster: [{ category: "Executive", filled: 3, vacant: 1 }],
      })
    )
    // Scope to the donut: the panel draws five other charts.
    const donut = html.slice(html.indexOf('data-testid="chart-donut"'))
    const out: Record<string, string> = {}
    for (const [tag] of donut.matchAll(/<circle\b[^>]*>/g)) {
      const label = /aria-label="([^":]+):/.exec(tag)?.[1]
      const stroke = /stroke="([^"]+)"/.exec(tag)?.[1]
      if (label && stroke) out[label] = stroke
    }
    return out
  }

  // Same four categories, opposite rankings — CONTACT leads one, PLAYBOOK the other.
  const contactHeavy = [
    ...Array.from({ length: 6 }, (_, i) => card("CONTACT", i + 1)),
    ...Array.from({ length: 4 }, (_, i) => card("LESSON", i + 1)),
    ...Array.from({ length: 3 }, (_, i) => card("PLAYBOOK", i + 1)),
    card("VENDOR", 1),
  ]
  const playbookHeavy = [
    ...Array.from({ length: 9 }, (_, i) => card("PLAYBOOK", i + 1)),
    ...Array.from({ length: 5 }, (_, i) => card("VENDOR", i + 1)),
    ...Array.from({ length: 2 }, (_, i) => card("CONTACT", i + 1)),
    card("LESSON", 1),
  ]

  it("keeps every category's hue when the ranking flips between windows", () => {
    const a = panelDonut(contactHeavy)
    const b = panelDonut(playbookHeavy)
    expect(Object.keys(a).sort()).toEqual(["Contact", "Lesson", "Playbook", "Vendor"])
    expect(a).toEqual(b)
    expect(new Set(Object.values(a)).size).toBe(4)
  })

  it("keys the donut on the MemoryRecordType value, not on the title-cased label", () => {
    // The label is a display transform of the key; keying on it would make a
    // copy edit ("Playbook" → "Playbooks") a repaint. These differ: the enum
    // keys resolve to chart-3/7/2/1, the labels to chart-2/7/3/5.
    const byEnum = slotsForKeys(["CONTACT", "LESSON", "PLAYBOOK", "VENDOR"])
    const byLabel = slotsForKeys(["Contact", "Lesson", "Playbook", "Vendor"])
    expect(byEnum.get("CONTACT")).not.toBe(byLabel.get("Contact"))

    const painted = panelDonut(contactHeavy)
    expect(painted).toEqual({
      Contact: byEnum.get("CONTACT"),
      Lesson: byEnum.get("LESSON"),
      Playbook: byEnum.get("PLAYBOOK"),
      Vendor: byEnum.get("VENDOR"),
    })
  })
})
