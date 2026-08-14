import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/**
 * Layout defects a screenshot shows and an assertion never does.
 *
 * Every other spec here asserts that text is *present*. Present and legible are
 * different properties: the Systems tab had sentences drawn on top of each
 * other, every `toBeVisible()` passed, and the page was unreadable. Playwright
 * considers an element visible if it has a non-empty bounding box — overlap,
 * clipping and overflow are all invisible to that.
 *
 * So these measure geometry instead of content:
 *
 *   1. no two text blocks occupy the same pixels
 *   2. nothing spills outside its container
 *   3. the page never scrolls sideways
 *   4. text is not clipped by a fixed height
 *
 * Run headless. The measurements come from the layout engine, so they are the
 * same headed or not — what matters is that they are measurements at all.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

test.beforeAll(() => {
  expect(OPERATOR, "PLATFORM_OPERATORS must be set").not.toBe("")
  expect(SECRET, "PLATFORM_OPERATOR_SECRET must be set").not.toBe("")
})

async function signIn(page: Page) {
  await page.goto("/signin")
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForLoadState("networkidle")
}

/** Every page an operator can reach, at the widths they use. */
const ROUTES = [
  "/",
  "/tenants",
  "/tenants/new",
  "/platform",
  "/platform/cost",
  "/platform/audit",
  // STUDIO-080-001 / 080-008 / 110-006. Added here in the same change that added
  // the pages: a route that is not in this array is a route whose contrast,
  // overlap and horizontal-overflow are never measured, and three new tables of
  // live AWS state are exactly the shape that overflows.
  "/platform/estate",
  "/platform/health",
  "/platform/security",
]
/**
 * STUDIO-030-007 (b) — 320 is not a phone, it is WCAG 2.2 AA 1.4.10.
 *
 * Reflow requires content to be usable at 320 CSS pixels with no
 * two-dimensional scrolling. The narrowest width tested here was 900, so the
 * clause was simply never exercised — and the machinery to exercise it already
 * existed: `document.documentElement.scrollWidth > clientWidth` below is the
 * assertion, and it only ever ran wide. Adding the width, not a new assertion,
 * is what catches this.
 */
const WIDTHS = [1440, 1180, 900, 320]

type Box = { x: number; y: number; w: number; h: number; text: string; tag: string }

/**
 * Leaf text blocks — elements that hold text and contain no other text element.
 * Measuring containers instead would report every parent overlapping its child.
 */
async function textBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: Array<{ x: number; y: number; w: number; h: number; text: string; tag: string }> = []
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const text = (el.textContent ?? "").trim()
      if (!text) continue
      // Leaf-ish: no descendant carries its own text.
      if (Array.from(el.children).some((c) => (c.textContent ?? "").trim())) continue

      const style = getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue

      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue

      out.push({
        x: r.x + window.scrollX,
        y: r.y + window.scrollY,
        w: r.width,
        h: r.height,
        text: text.slice(0, 60),
        tag: el.tagName.toLowerCase(),
      })
    }
    return out
  })
}

/** Area shared by two rectangles. */
function overlapArea(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return x * y
}

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    for (const route of ROUTES) {
      test(`${route} — no text overlaps other text`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 })
        await signIn(page)
        await page.goto(route)
        await page.waitForLoadState("networkidle")

        const boxes = await textBoxes(page)
        expect(boxes.length, "the page rendered no text at all").toBeGreaterThan(5)

        const collisions: string[] = []
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const area = overlapArea(boxes[i], boxes[j])
            if (area <= 0) continue

            // A few pixels of shared box is normal — inline elements sit on a
            // shared baseline and antialiasing rounds outward. A collision is
            // when a meaningful share of the smaller block is covered.
            const smaller = Math.min(boxes[i].w * boxes[i].h, boxes[j].w * boxes[j].h)
            if (area / smaller > 0.25) {
              collisions.push(
                `"${boxes[i].text}" (${boxes[i].tag}) over "${boxes[j].text}" (${boxes[j].tag}) — ` +
                  `${Math.round((area / smaller) * 100)}% covered`,
              )
            }
          }
        }

        expect(collisions, `text drawn on top of other text at ${width}px`).toEqual([])
      })

      test(`${route} — nothing overflows its container or the page`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 })
        await signIn(page)
        await page.goto(route)
        await page.waitForLoadState("networkidle")

        /*
         * Horizontal page scroll: the single clearest sign something is too
         * wide for where it was put — and, until now, the least actionable
         * thing this suite could say.
         *
         * `the page scrolls sideways: expected false, received true` is true and
         * tells you nothing. Reproducing it cost a rebuilt DOM out of the trace
         * artifact, a headless re-render at 320px, and three CSS hypotheses,
         * because the failure named no element. The check below is unchanged —
         * same condition, same verdict — but it now carries the offenders with
         * it.
         *
         * "Offender" is defined narrowly on purpose: an element that sticks out
         * past the viewport WHOSE PARENT DOES NOT. That is the first thing to go
         * wide; every ancestor after it is a consequence. A box that scrolls on
         * purpose is excluded, because a wide table inside `overflow-x: auto` is
         * the design and not the defect — which is also why the section walk
         * below cannot see this: it compares children to their section, never a
         * section to the viewport.
         */
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement
          const limit = doc.clientWidth
          const scrolls = (el: Element) =>
            ["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(el).overflowX)

          const offenders: string[] = []
          for (const el of Array.from(document.querySelectorAll("*"))) {
            const box = el.getBoundingClientRect()
            if (box.width === 0 || box.right <= limit + 1) continue
            const parent = el.parentElement
            if (parent && parent.getBoundingClientRect().right > limit + 1) continue
            if (parent && scrolls(parent)) continue
            const name =
              el.tagName.toLowerCase() +
              (el.id ? `#${el.id}` : "") +
              (el.className && typeof el.className === "string"
                ? `.${el.className.trim().split(/\s+/).join(".")}`
                : "")
            offenders.push(
              `${name} right=${Math.round(box.right)} width=${Math.round(box.width)} — ` +
                `${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 70)}`,
            )
          }
          return { scrolls: doc.scrollWidth > limit + 1, width: doc.scrollWidth, limit, offenders }
        })

        expect(
          overflow.scrolls,
          `the page scrolls sideways — ${overflow.width}px of content in a ${overflow.limit}px viewport.` +
            ` First element wider than the viewport whose parent is not:\n  ` +
            (overflow.offenders.slice(0, 8).join("\n  ") || "(none isolated — the width is on a scrolling ancestor)"),
        ).toBe(false)

        // Content wider than its own section, unless that section scrolls on
        // purpose (wide tables are allowed to, and say so in CSS).
        const spills = await page.evaluate(() => {
          const bad: string[] = []
          for (const section of Array.from(document.querySelectorAll("section, form, dl, nav"))) {
            const box = section.getBoundingClientRect()
            const scrolls = (el: Element) =>
              ["auto", "scroll"].includes(getComputedStyle(el).overflowX)

            for (const child of Array.from(section.querySelectorAll("*"))) {
              if (scrolls(child)) continue
              // Walk to the section, not one step. `table.grid` is
              // `display:block; overflow-x:auto` (globals.css) precisely so a
              // wide table scrolls instead of the page — but the elements that
              // measure wide are `tr`, `th` and `td`, whose immediate parent is
              // `thead`/`tbody`, and those do not scroll. Checking only
              // `parentElement` therefore reported every row of a deliberately
              // scrollable table as a layout defect. It reported none of them on
              // Windows and ten on Linux, because the tolerance below is 2px and
              // FreeType sets this table a fraction wider than DirectWrite —
              // so the bug was invisible until CI ran it.
              let ancestor: Element | null = child.parentElement
              let inScroller = false
              while (ancestor) {
                if (scrolls(ancestor)) {
                  inScroller = true
                  break
                }
                if (ancestor === section) break
                ancestor = ancestor.parentElement
              }
              if (inScroller) continue

              const r = child.getBoundingClientRect()
              if (r.width === 0) continue
              if (r.right > box.right + 2) {
                bad.push(`${child.tagName.toLowerCase()} "${(child.textContent ?? "").trim().slice(0, 40)}"`)
              }
            }
          }
          return [...new Set(bad)].slice(0, 8)
        })
        expect(spills, "content spills outside its section").toEqual([])
      })
    }
  })
}

for (const width of WIDTHS) {
  test(`at ${width}px — no text overflows the box it is drawn in`, async ({ page }) => {
    // The defect the box-overlap check above cannot see.
    //
    // A `dt` in a fixed-width column stays that width while its TEXT runs past
    // the edge and prints over the neighbouring `dd`. No two element boxes
    // collide, so overlap detection reports nothing, and every
    // `toBeVisible()` passes on a page that cannot be read. The signal is the
    // element's own scrollWidth exceeding its clientWidth while overflow is
    // visible — content wider than its box, with nothing clipping it.
    await page.setViewportSize({ width, height: 1000 })
    await signIn(page)

    for (const route of ROUTES) {
      await page.goto(route)
      await page.waitForLoadState("networkidle")

      const spilling = await page.evaluate(() => {
        const bad: string[] = []
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          const style = getComputedStyle(el)
          // Only elements that neither clip nor scroll — those handle it.
          if (style.overflowX !== "visible") continue
          if (!(el.textContent ?? "").trim()) continue
          if (Array.from(el.children).some((c) => (c.textContent ?? "").trim())) continue

          // 2px of slack for subpixel rounding.
          if (el.scrollWidth > el.clientWidth + 2) {
            bad.push(
              `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 45)}" ` +
                `(${el.scrollWidth}px of text in a ${el.clientWidth}px box)`,
            )
          }
        }
        return [...new Set(bad)].slice(0, 10)
      })

      expect(spilling, `text wider than its box on ${route} at ${width}px`).toEqual([])
    }
  })
}

test("text is never clipped by a fixed height", async ({ page }) => {
  // scrollHeight beyond clientHeight on a non-scrolling element means the words
  // are there and the reader cannot see them — which is worse than missing,
  // because nothing looks wrong.
  await page.setViewportSize({ width: 1180, height: 1000 })
  await signIn(page)

  for (const route of ROUTES) {
    await page.goto(route)
    await page.waitForLoadState("networkidle")

    const clipped = await page.evaluate(() => {
      const bad: string[] = []
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const style = getComputedStyle(el)
        if (style.overflow !== "hidden" && style.overflowY !== "hidden") continue
        if (el.scrollHeight > el.clientHeight + 2) {
          bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`)
        }
      }
      return [...new Set(bad)]
    })

    expect(clipped, `text clipped on ${route}`).toEqual([])
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * STUDIO-030-004 — the irreversible move is not beside the ordinary one.
 *
 * Measured as a rectangle, deliberately. An assertion on `fieldset.destructive`
 * would pass on a restyle that put the two groups back on one line with the
 * class still attached, and the property that matters is the GAP: an operator
 * reaching for an ordinary advance must not be able to hit PURGING by being a
 * few pixels off.
 *
 * The tenant this runs against is seeded by `tools/dev/seed-studio-fleet.mjs`
 * in ACTIVE, a state whose successors include both kinds.
 */
const MINIMUM_DESTRUCTIVE_GAP_PX = 16

test("an irreversible move is separated from the ordinary ones", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 1000 })
  await signIn(page)
  await page.goto("/tenants/seed-deployed")
  await page.waitForLoadState("networkidle")

  const advance = page.locator(".advance")
  await expect(advance, "the tenant page rendered no lifecycle controls").toBeVisible()

  const geometry = await page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, text: (el.textContent ?? "").trim() }
    }
    const destructive = document.querySelector("fieldset.destructive")
    const ordinary = Array.from(document.querySelectorAll(".advance > .chips .chip")).map(box)
    return {
      hasDestructive: destructive !== null,
      irreversible: destructive
        ? Array.from(destructive.querySelectorAll(".chip")).map(box)
        : [],
      ordinary,
    }
  })

  // If this state has no one-way successor there is nothing to separate, and a
  // test that silently passed on that would be a test that never ran.
  expect(
    geometry.hasDestructive,
    "ACTIVE has no irreversible successor to separate — the fixture, not the layout, is wrong",
  ).toBe(true)
  expect(geometry.irreversible.length).toBeGreaterThan(0)
  expect(geometry.ordinary.length).toBeGreaterThan(0)

  const topOfIrreversible = Math.min(...geometry.irreversible.map((b) => b.top))
  const bottomOfOrdinary = Math.max(...geometry.ordinary.map((b) => b.bottom))

  expect(
    topOfIrreversible - bottomOfOrdinary,
    `the irreversible group starts ${topOfIrreversible - bottomOfOrdinary}px below the ordinary ` +
      `one; ${MINIMUM_DESTRUCTIVE_GAP_PX}px is the floor. A one-way move must not be a slip away ` +
      `from an ordinary one.`,
  ).toBeGreaterThanOrEqual(MINIMUM_DESTRUCTIVE_GAP_PX)

  // And the group says what it is, in words. Colour alone is not a carrier.
  await expect(page.locator("fieldset.destructive legend")).toContainText(/one-way/i)
})

/* ─────────────────────────────────────────────────────────────────────────────
 * STUDIO-030-011 — a budget per route, not one number for the console.
 *
 * Two things are asserted and they fail for different reasons:
 *
 *   * DOM nodes. A table that stops paging grows without bound, and the node
 *     count is what notices — `showing N of M` is the honest half, and this is
 *     the half that fails when the pager is removed.
 *   * Largest Contentful Paint, read from the browser's own PerformanceObserver
 *     rather than from a wall-clock stopwatch, because the stopwatch measures
 *     the test runner.
 *
 * The numbers are per route and named. One global number would be far too loose
 * for `/` and far too tight for `/platform`, and a budget that fits everything
 * constrains nothing.
 */
const NODE_BUDGET: Record<string, number> = {
  "/": 400,
  "/tenants": 1400,
  "/platform": 6000,
  "/platform/cost": 800,
}

const LCP_BUDGET_MS = 2500

for (const [route, budget] of Object.entries(NODE_BUDGET)) {
  test(`${route} stays inside its DOM and LCP budget`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signIn(page)

    await page.goto(route)
    await page.waitForLoadState("networkidle")

    const nodes = await page.evaluate(() => document.querySelectorAll("*").length)
    expect(
      nodes,
      `${route} rendered ${nodes} elements against a budget of ${budget}. A table that stopped ` +
        `paging is the usual cause; the fix is the pager, not the number.`,
    ).toBeLessThanOrEqual(budget)

    // Core Web Vitals, from the entry the browser itself reports. Collected
    // after the fact via `buffered: true`, so the observer does not have to be
    // installed before navigation — which it cannot be, on a server-rendered
    // page reached by `goto`.
    const lcp = await page.evaluate(
      () =>
        new Promise<number | null>((resolve) => {
          let latest: number | null = null
          try {
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) latest = entry.startTime
            })
            observer.observe({ type: "largest-contentful-paint", buffered: true })
          } catch {
            resolve(null)
            return
          }
          setTimeout(() => resolve(latest), 500)
        }),
    )

    // `null` means the browser does not report LCP at all, which is a fact about
    // the browser and must not be reported as a pass OR a failure of the page.
    if (lcp !== null) {
      expect(lcp, `${route} painted its largest element at ${Math.round(lcp)}ms`).toBeLessThanOrEqual(
        LCP_BUDGET_MS,
      )
    }
  })
}

/* ─────────────────────────────────────────────────────────────────────────────
 * STUDIO-030-007 (a) — the layout survives being mirrored.
 *
 * `globals.css` holds zero physical-direction declarations. This is what makes
 * that a property rather than a claim: `dir` is flipped on the live document and
 * the same overlap detector every route already runs is run again. Reverting one
 * `margin-inline-start` to `margin-left` reds this while every LTR test stays
 * green, which is the only shape of proof that distinguishes "mirrors" from
 * "happens not to have moved".
 */
test("layout survives RTL", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 1000 })
  await signIn(page)

  for (const route of ROUTES) {
    await page.goto(route)
    await page.waitForLoadState("networkidle")
    await page.evaluate(() => document.documentElement.setAttribute("dir", "rtl"))

    const boxes = await textBoxes(page)
    expect(boxes.length, `${route} rendered no text at all under RTL`).toBeGreaterThan(5)

    const collisions: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const area = overlapArea(boxes[i], boxes[j])
        if (area <= 0) continue
        const smaller = Math.min(boxes[i].w * boxes[i].h, boxes[j].w * boxes[j].h)
        if (area / smaller > 0.25) {
          collisions.push(`"${boxes[i].text}" over "${boxes[j].text}"`)
        }
      }
    }
    expect(collisions, `text drawn on top of other text on ${route} under dir="rtl"`).toEqual([])

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows, `${route} scrolls sideways under dir="rtl"`).toBe(false)
  }
})
