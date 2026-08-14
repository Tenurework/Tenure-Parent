import { test, expect, type Page } from "@playwright/test"

import { CONFIG_DOMAINS } from "@tenure/configuration"

import { operatorFor } from "./operator-identity"

/**
 * The configuration surface's STRUCTURE, measured in a browser.
 *
 * `pricing-surface.spec.ts` beside this one proves the money is on the page.
 * This proves the things that are true of the page rather than of a number:
 *
 *   1. the answer leads — the running total is drawn above the editor that
 *      changes it, not sixth under a form;
 *   2. every panel says what it is AS OF, and which clock it means;
 *   3. the Material 3 primitives are what draw it, and the ad-hoc class strings
 *      the page had accumulated are gone;
 *   4. it survives 320 CSS pixels — `layout.spec.ts` runs the console's static
 *      routes at four widths and this one is not among them, because it needs a
 *      tenant slug that spec has no way to know. The same three measurements
 *      are made here, against a seeded slug, so the route is not simply
 *      unmeasured.
 *   5. it asks its question in words before any apparatus, and answers all
 *      three parts of it — including the third, *what would changing it cost*,
 *      which is a DELTA against what this tenant is paying today rather than a
 *      list price;
 *   6. an option gated by a capability nobody here holds is on the page,
 *      uneditable, with the reason — not hidden, and not left enabled to be
 *      refused after the operator has typed into it.
 *
 * Skipped without a registry, and skipped loudly: a structure spec that quietly
 * passes when there is no tenant to render is worse than none.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""
const configured = !!process.env.TENANT_TABLE

/** The tenant seeded into the registry, as `pricing-surface.spec.ts` uses. */
const SLUG = "rochester"

/** Generous, because a cold Next route compiles on first request. */
const VISIBLE = { timeout: 60_000 }

async function signIn(page: Page) {
  await page.goto("/signin", { waitUntil: "domcontentloaded" })
  if (!new URL(page.url()).pathname.startsWith("/signin")) return
  await page.getByLabel("Email").fill(OPERATOR)
  await page.getByLabel("Operator secret").fill(SECRET)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 150_000 })
}

type Box = { x: number; y: number; w: number; h: number; text: string; tag: string }

/** Leaf text blocks, exactly as `layout.spec.ts` measures them. */
async function textBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: Array<{ x: number; y: number; w: number; h: number; text: string; tag: string }> = []
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const text = (el.textContent ?? "").trim()
      if (!text) continue
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

function overlapArea(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return x * y
}

test.describe("the configuration surface is structured, not a wall of rows", () => {
  test.skip(!configured, "TENANT_TABLE is not set — no registry to read a tenant from.")
  test.skip(!OPERATOR || !SECRET, "PLATFORM_OPERATORS / PLATFORM_OPERATOR_SECRET are not set.")

  test("leads with the answer: the running total is drawn above the editor", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration?seats=250`, { waitUntil: "domcontentloaded" })

    const cost = page.locator("#running-total")
    const editor = page.locator("#configuration")
    await expect(cost).toBeVisible(VISIBLE)
    await expect(editor).toBeVisible(VISIBLE)

    // Geometry, not DOM order. A card moved below another by a grid or an
    // `order` property is still below it to the reader, and the reader is who
    // this is about.
    const [costBox, editorBox] = await Promise.all([cost.boundingBox(), editor.boundingBox()])
    expect(costBox, "the running total card has no box").not.toBeNull()
    expect(editorBox, "the configuration card has no box").not.toBeNull()
    expect(
      costBox!.y,
      "the running total is drawn below the editor — the apparatus is leading, not the answer",
    ).toBeLessThan(editorBox!.y)

    // And the answer is a figure, at the top of that card, rather than a number
    // an operator has to assemble out of a table.
    const figure = cost.locator(".config-figure")
    await expect(figure).toHaveText("1000.00 USD", VISIBLE)
  })

  test("every panel says what it is as of, and which clock it means", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration`, { waitUntil: "domcontentloaded" })

    // Three different clocks, deliberately. Collapsing them into one "last
    // updated" puts a fresh timestamp on a price list nothing has re-read.
    await expect(page.locator("#running-total .md3-card-support")).toContainText(
      /Priced from/,
      VISIBLE,
    )
    await expect(page.locator("#configuration-history .md3-card-support")).toContainText(
      /Read from the tenant registry at \d{4}-\d{2}-\d{2}T/,
      VISIBLE,
    )
    await expect(page.locator("#module-dependencies .md3-card-support")).toContainText(
      /As compiled into this deployment/,
      VISIBLE,
    )
    await expect(page.locator("#not-editable-here .md3-card-support")).toContainText(
      /As compiled into this deployment/,
      VISIBLE,
    )

    // And where it does not know something, it says so rather than implying a
    // number. No seat count is recorded against a tenant anywhere.
    await expect(page.locator("#running-total")).toContainText(
      "a seat count nobody has stated",
      VISIBLE,
    )
  })

  test("is drawn by the Material 3 primitives, with no ad-hoc classes left", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration`, { waitUntil: "domcontentloaded" })
    await expect(page.locator("#running-total")).toBeVisible(VISIBLE)

    // The primitives are present…
    expect(await page.locator(".md3-card").count()).toBeGreaterThanOrEqual(4)
    expect(await page.locator("#running-total .md3-table-shell").count()).toBe(1)
    expect(await page.locator("#running-total .md3-chip").count()).toBe(3)
    expect(await page.locator("#running-total .md3-badge").count()).toBe(1)

    // …and the legacy layout classes this page used to be built from are not.
    // Scoped to the cards this route owns: the masthead and the nav are a
    // foundation agent's, and the editor inside #configuration is its own
    // component.
    for (const legacy of [".md3-card > .system", ".md3-card > .chips", ".md3-card > .badge"]) {
      expect(await page.locator(legacy).count(), `${legacy} is still drawing this page`).toBe(0)
    }

    // No inline styles. `style={{ display: "contents" }}` on a wrapper is what
    // the two definition lists here used to need, and an inline style is a
    // declaration the contrast and layout audits cannot see.
    expect(
      await page.locator("#module-dependencies [style], #not-editable-here [style]").count(),
      "an inline style attribute is back on this route",
    ).toBe(0)
  })

  test("survives 320 CSS pixels: no sideways scroll, no overlap, nothing spilling", async ({
    page,
  }) => {
    await signIn(page)

    for (const width of [1440, 1180, 900, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`/tenants/${SLUG}/configuration?seats=250`, { waitUntil: "domcontentloaded" })
      await expect(page.locator("#running-total")).toBeVisible(VISIBLE)
      await page.waitForLoadState("networkidle")

      const overflowsPage = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      )
      expect(overflowsPage, `the page scrolls sideways at ${width}px`).toBe(false)

      const boxes = await textBoxes(page)
      expect(boxes.length, `the page rendered no text at all at ${width}px`).toBeGreaterThan(5)
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
      expect(collisions, `text drawn on top of other text at ${width}px`).toEqual([])

      // Wide tables scroll inside their own container rather than taking the
      // page with them — the same walk-to-the-section rule layout.spec.ts uses.
      const spills = await page.evaluate(() => {
        const bad: string[] = []
        const scrolls = (el: Element) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX)
        for (const section of Array.from(document.querySelectorAll("section, form, dl, nav"))) {
          const box = section.getBoundingClientRect()
          for (const child of Array.from(section.querySelectorAll("*"))) {
            if (scrolls(child)) continue
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
      expect(spills, `content spills outside its section at ${width}px`).toEqual([])
    }
  })
})

test.describe("the configuration surface answers all three parts of its question", () => {
  test.skip(!configured, "TENANT_TABLE is not set — no registry to read a tenant from.")
  test.skip(!OPERATOR || !SECRET, "PLATFORM_OPERATORS / PLATFORM_OPERATOR_SECRET are not set.")

  test("asks the question in words, above every card", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration?seats=250`, { waitUntil: "domcontentloaded" })

    const question = page.getByTestId("configuration-question")
    await expect(question).toBeVisible(VISIBLE)
    await expect(question).toHaveText(
      "What is this tenant configured to do, what does that cost, and what would changing it cost?",
    )

    // Above the apparatus, geometrically. A question printed below the thing it
    // is meant to frame is decoration.
    const [questionBox, costBox] = await Promise.all([
      question.boundingBox(),
      page.locator("#running-total").boundingBox(),
    ])
    expect(questionBox!.y).toBeLessThan(costBox!.y)
  })

  test("answers it in the lead, from what was actually read", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration?seats=250`, { waitUntil: "domcontentloaded" })

    const answer = page.getByTestId("configuration-answer")
    await expect(answer).toBeVisible(VISIBLE)
    // All three parts. The seat count is the one the operator stated, and the
    // figure is the resolver's — 250 x $4.00 for the assistant.
    await expect(answer).toContainText("1000.00 USD a month at 250 seats")
    await expect(answer).toContainText(/Revision \d+, published |Nothing has ever been published/)
    await expect(answer).toContainText(/would add |No option on this page moves the bill/)
  })

  test("prices a change as a DELTA against what this tenant pays today", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration?seats=250`, { waitUntil: "domcontentloaded" })

    const change = page.locator("#change-cost")
    await expect(change).toBeVisible(VISIBLE)

    // Between the answer and the apparatus: what it costs, then what a change
    // would cost, then the form that makes one.
    const [costBox, changeBox, editorBox] = await Promise.all([
      page.locator("#running-total").boundingBox(),
      change.boundingBox(),
      page.locator("#configuration").boundingBox(),
    ])
    expect(costBox!.y).toBeLessThan(changeBox!.y)
    expect(changeBox!.y).toBeLessThan(editorBox!.y)

    // The delta against today, stated as a difference and not as a list price.
    await expect(change).toContainText("The monthly bill today")
    await expect(change).toContainText("Without this tenant's published revision")
    await expect(change).toContainText("What the published revision accounts for")

    // And every option carries a direction WORD, not only a sign — meaning
    // carried by a glyph alone is meaning nobody has to read.
    await expect(
      change.getByText(/^(adds \+|removes -|no change to the bill)/).first(),
    ).toBeVisible(VISIBLE)

    // As-of, like every other panel, and naming which clock it means.
    await expect(change.locator(".md3-card-support")).toContainText(
      /compiled into this deployment; what each option is SET to was read from the registry at \d{4}-\d{2}-\d{2}T/,
    )
  })

  test("groups the priced options by the domain that governs them", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration?seats=250`, { waitUntil: "domcontentloaded" })

    const headings = page.locator("#change-cost h3")
    const count = await headings.count()
    expect(count, "the change-cost card has no domain groups at all").toBeGreaterThan(0)

    // Every group is a domain the registry NAMES. A heading reading "strings"
    // or "booleans" would be grouping by the shape of the form instead.
    const known = new Set(CONFIG_DOMAINS.map((domain) => domain.id))
    for (let i = 0; i < count; i++) {
      const text = (await headings.nth(i).textContent())?.trim() ?? ""
      expect(known.has(text), `"${text}" is not a domain the configuration registry declares`).toBe(
        true,
      )
    }

    // The running total is grouped the same way, so the two tables talk about
    // configuration in one vocabulary.
    await expect(page.locator("#running-total table caption")).toContainText(
      "grouped by the domain that governs it",
    )
  })

  test("shows a capability-gated option, uneditable, with the reason", async ({ page }) => {
    await signIn(page)
    await page.goto(`/tenants/${SLUG}/configuration`, { waitUntil: "domcontentloaded" })
    await expect(page.locator("#configuration")).toBeVisible(VISIBLE)

    // This build has at least one — `platform.relay.modelTokenBudgetPerMonth`
    // declares `requiresCapability`, and `change-cost.test.ts` pins that fact so
    // this assertion cannot become vacuously true by the key disappearing.
    const locked = page.locator("[data-locked]")
    const count = await locked.count()
    expect(count, "no capability-gated field is rendered at all").toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const control = locked.nth(i)
      // Visible — not hidden, which is the failure this exists against.
      await expect(control).toBeVisible(VISIBLE)
      // Uneditable, and announced as such.
      expect(await control.evaluate((el: HTMLInputElement) => el.readOnly)).toBe(true)
      await expect(control).toHaveAttribute("aria-disabled", "true")

      // With the reason, naming the capability.
      const key = await control.getAttribute("data-locked")
      const reason = page.locator(`[data-locked-reason="${key}"]`)
      await expect(reason).toBeVisible(VISIBLE)
      await expect(reason).toContainText("Requires the capability")
    }

    // And the same key is named in the change-cost table, so the two panels do
    // not disagree about who may change it.
    await expect(page.locator("#change-cost")).toContainText("Requires the capability")
  })
})
