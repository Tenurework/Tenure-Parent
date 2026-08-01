import { test, expect, type Page } from "@playwright/test"

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

const OPERATOR = process.env.PLATFORM_OPERATORS ?? ""
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
const ROUTES = ["/", "/tenants", "/tenants/new", "/platform"]
const WIDTHS = [1440, 1180, 900]

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

        // Horizontal page scroll: the single clearest sign something is too
        // wide for where it was put.
        const overflowsPage = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        )
        expect(overflowsPage, "the page scrolls sideways").toBe(false)

        // Content wider than its own section, unless that section scrolls on
        // purpose (wide tables are allowed to, and say so in CSS).
        const spills = await page.evaluate(() => {
          const bad: string[] = []
          for (const section of Array.from(document.querySelectorAll("section, form, dl, nav"))) {
            const box = section.getBoundingClientRect()
            for (const child of Array.from(section.querySelectorAll("*"))) {
              const style = getComputedStyle(child)
              if (style.overflowX === "auto" || style.overflowX === "scroll") continue
              const parent = child.parentElement
              if (parent && ["auto", "scroll"].includes(getComputedStyle(parent).overflowX)) continue

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
