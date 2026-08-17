import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

/**
 * STUDIO-030-001 — the BASE scale, held down by measurement.
 *
 * ADR-0009 "Component scale: compact by default" moved the console's default
 * geometry down so that a working set fits one screen. That decision is worth
 * exactly as much as the thing that stops it drifting back, and "just a bit more
 * padding" is how it drifts back — one component at a time, each change
 * defensible on its own, none of them measured against the screen.
 *
 * So this spec measures the four numbers the decision was made on, in the
 * DEFAULT density at a standard 1440x900 viewport:
 *
 *   1. the computed height of a table row on the fleet
 *   2. the computed height of a button
 *   3. the computed height of a text input
 *   4. the number of estate rows visible without scrolling
 *
 * and asserts a CEILING on each. A ceiling, not an equality: a later change may
 * make a row shorter, and a test that reds on an improvement is a test people
 * delete. It may not make one taller without changing the number here, which is
 * the argument this file exists to force.
 *
 * ## Why the row ceilings are what they are
 *
 * They are the measured values plus a small tolerance, and the tolerance is for
 * font metrics rather than for design drift: a row's height is
 * `padding-block * 2 + line-height * lines`, and `line-height` resolves through
 * a rem against whatever the platform's default font actually is. 2px absorbs
 * that; it does not absorb a step of `--space`, which is 4px at the smallest.
 *
 * ## Why the floor on the control heights
 *
 * STUDIO-030-007 requires a 24x24 CSS pixel target (WCAG 2.2 AA 2.5.8). The
 * ceiling here and that floor are in genuine tension, which is the point — the
 * assertion is a BAND, so a future change cannot satisfy the density rule by
 * breaking the accessibility one. `preferences.spec.ts` measures `--tap` in
 * every preference combination; this measures that the rendered control still
 * clears it after the scale came down.
 */

const OPERATOR = operatorFor()
const SECRET = process.env.PLATFORM_OPERATOR_SECRET ?? ""

/** The viewport the decision was measured at. Not a phone, and not a laptop
 *  someone happened to have open: 1440x900 is the width `layout.spec.ts`
 *  already treats as the desktop case. */
const VIEWPORT = { width: 1440, height: 900 }

test.use({ viewport: VIEWPORT })

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

/**
 * The default density, explicitly.
 *
 * STUDIO-030-005 keeps a comfortable/compact toggle and this spec is about the
 * base the toggle sits around, so it must not accidentally measure whichever
 * density a previous spec left in storage. `data-density` absent IS the
 * default; the attribute is cleared rather than set to a value, because setting
 * it to "comfortable" would measure a branch the tokens do not have.
 */
async function useDefaultDensity(page: Page) {
  await page.evaluate(() => {
    document.documentElement.removeAttribute("data-density")
  })
}

test.describe("STUDIO-030-001 — the base scale stays down", () => {
  /**
   * A fleet row.
   *
   * 52px is the ceiling, and the measured value is 50.47px. It was 59.72px.
   *
   * The number is not "one line of text plus padding" because a fleet row is not
   * one line: the tenant cell stacks a name over a slug, so the shortest row in
   * the table carries about 2.4 lines of `body-small`. 50.47px is
   * `4 + 4` of `--row-padding-block` plus 42.47px of stacked content, where the
   * content came down with `body-small`'s line-height (1.5 → 1.4) and the padding
   * came down with the token (8px → 4px). Both halves are in the ceiling, which
   * is why putting either one back reds this.
   *
   * 52 rather than 50.47 exactly: a row's height resolves through a rem against
   * whatever the platform's default font actually is, and 1.5px absorbs that. It
   * does not absorb a step of `--space`, which is 4px at the smallest, or a step
   * of line-height, which is 1.25px per line here.
   */
  test("a fleet table row is at or under 52px", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants")
    await useDefaultDensity(page)
    await page.waitForLoadState("networkidle")

    const rows = page.locator("table.grid tbody tr, .md3-table tbody tr")
    await expect(rows.first()).toBeVisible()

    const heights = await rows.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().height * 100) / 100),
    )
    expect(heights.length, "the fleet must render rows to measure").toBeGreaterThan(0)

    /* The SHORTEST row, not the tallest: a cell whose content wraps to two
       lines is taller for a reason that is content rather than scale, and
       asserting on the tallest would make this spec a test of the seed data.
       The shortest row is the one carrying exactly one line in every cell, so
       it is the row whose height IS padding plus line-height. */
    const shortest = Math.min(...heights)
    expect(
      shortest,
      `fleet row heights were ${heights.join(", ")} — the shortest is the scale`,
    ).toBeLessThanOrEqual(52)
  })

  /**
   * A button, and an input, in a band.
   *
   * 34px ceiling: `--tap` (24) plus `--space-2` (8) plus a 1px border each
   * side. Before, the button was built on `--space-3` (12) and the input on
   * `--space-4` (16), giving 38px and 42px. 24px floor: STUDIO-030-007.
   */
  test("a button sits between 24px and 34px", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants")
    await useDefaultDensity(page)

    const button = page.locator(".md3-button").first()
    await expect(button).toBeVisible()
    const height = await button.evaluate(
      (el) => Math.round(el.getBoundingClientRect().height * 100) / 100,
    )

    expect(height, "a button must still be a 24px target").toBeGreaterThanOrEqual(24)
    expect(height, "a button must stay at a medium height").toBeLessThanOrEqual(34)
  })

  test("a text input sits between 24px and 34px", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants/new")
    await useDefaultDensity(page)
    await page.waitForLoadState("networkidle")

    const input = page.locator(".md3-field-input, .field input[type='text']").first()
    await expect(input).toBeVisible()
    const height = await input.evaluate(
      (el) => Math.round(el.getBoundingClientRect().height * 100) / 100,
    )

    expect(height, "an input must still be a 24px target").toBeGreaterThanOrEqual(24)
    expect(height, "an input must stay at a medium height").toBeLessThanOrEqual(34)
  })

  /**
   * The hit area, separately from the visible box.
   *
   * This is the half of STUDIO-030-007 the ceiling above could otherwise be
   * satisfied by cheating: a 20px input with 24px of hit area is compliant, and
   * a 34px input with a 20px hit area is not, and only one of those two is
   * visible in a screenshot. `elementFromPoint` at the four corners of the
   * 24x24 box centred on the control is the actual question 2.5.8 asks — does
   * a pointer landing anywhere in that square reach the control.
   */
  test("a control's hit area covers 24x24 CSS pixels even where the box is smaller", async ({
    page,
  }) => {
    await signIn(page)
    await page.goto("/tenants")
    await useDefaultDensity(page)

    const probe = await page.evaluate(() => {
      const control = document.querySelector<HTMLElement>(".md3-button")
      if (!control) return null
      const box = control.getBoundingClientRect()
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2
      const half = 12 /* 24 / 2 */
      const corners: Array<[number, number]> = [
        [cx - half + 0.5, cy - half + 0.5],
        [cx + half - 0.5, cy - half + 0.5],
        [cx - half + 0.5, cy + half - 0.5],
        [cx + half - 0.5, cy + half - 0.5],
      ]
      /*
       * The control ITSELF or something inside it — never an ancestor.
       *
       * `at.contains(control)` was in this list once and made the assertion
       * unfailable: a point 4px outside a 16px-tall button lands on the wrapper
       * `<div>`, which contains the button, so a control HALF the required
       * target reported four hits. That mutation is recorded in the result note.
       * A pointer landing on the wrapper does not activate the button, which is
       * the whole question WCAG 2.2 AA 2.5.8 asks.
       */
      const hits = corners.map(([x, y]) => {
        const at = document.elementFromPoint(x, y)
        return at !== null && (at === control || control.contains(at))
      })
      return { height: box.height, width: box.width, hits }
    })

    expect(probe, "a button must be present to probe").not.toBeNull()
    expect(
      probe!.hits,
      `the 24x24 target around a ${probe!.width}x${probe!.height} control missed a corner`,
    ).toEqual([true, true, true, true])
  })
})

/**
 * ── The number the whole decision was made for, and the honest form of it ────
 *
 * ADR-0009's falsifiable form: "checked by asserting a minimum number of rows
 * visible in a standard viewport rather than by eye".
 *
 * Taken literally — rows whose rectangle lies inside the viewport at scroll 0 —
 * the answer on both pages is ZERO, before this change and after it. That is
 * measured, not assumed: on `/platform/estate` at 1440×900 the first table row
 * sat at y = 1399 and now sits at y = 1319, and on `/tenants` it went 1414 →
 * 1275. Roughly 1,200px of what is above it is page COMPOSITION — five
 * paragraphs of prose, two full unknown-state panels — which lives in
 * `src/app/platform/estate/page.tsx` and `src/app/tenants/page.tsx`, not in the
 * token layer.
 *
 * A test that asserted the literal count would therefore be asserting a property
 * of two page components against a change to a stylesheet, and would go green or
 * red when somebody edited a paragraph. So this asserts what the token layer
 * actually decides: how many rows the base scale FITS in the content region — the
 * viewport, minus the top bar, minus `main`'s own padding, minus the table's
 * header — which is a function of `--row-padding-block`, `body-small`'s
 * line-height, `--topbar-block-size` and `main`'s padding, and of nothing else.
 *
 * Put a step of padding back on a row and this reds. Edit a paragraph and it does
 * not. That is the property worth a test.
 */
async function affordedRows(page: Page, viewportHeight: number) {
  return page.evaluate((height) => {
    const table = document.querySelector<HTMLElement>(".md3-table, table.grid")
    if (!table) return null
    const firstBodyRow = table.querySelector("tbody tr")
    const headerRow = table.querySelector("thead tr")
    /* The SHORTEST body row, for the reason the fleet test gives: a cell that
       wraps is taller for a reason that is content rather than scale. */
    const bodyRows = Array.from(table.querySelectorAll("tbody tr"))
    const rowHeights = bodyRows.map((r) => r.getBoundingClientRect().height).filter((h) => h > 0)
    const rowHeight = rowHeights.length
      ? Math.min(...rowHeights)
      : (firstBodyRow ?? headerRow)?.getBoundingClientRect().height
    if (!rowHeight || rowHeight <= 0) return null

    /* The top of `main`'s CONTENT box — the first y-coordinate the page is
       allowed to draw at. Not the table's own top, which is where the page
       composition would leak in. */
    const main = document.querySelector<HTMLElement>("main")
    if (!main) return null
    const mainBox = main.getBoundingClientRect()
    const contentTop = mainBox.top + parseFloat(getComputedStyle(main).paddingTop)
    const header = headerRow ? headerRow.getBoundingClientRect().height : 0

    /* The SCALE's own contribution to a row, separated from the content's.
     *
     * A row is `lines × line-height + padding-top + padding-bottom`. Only the
     * second part is what the token layer sets; the first is how many lines the
     * cell's text wraps to, which is a property of the DATA. On this machine the
     * estate's shortest row is 67.94px and in CI it is 84.91px, from the same
     * stylesheet — different ARNs, different wrapping.
     *
     * So `singleLine` is the height a row WOULD have if its tallest cell held one
     * line. It is the same number in every environment, which makes it the only
     * honest thing to assert a row budget against. */
    const cell = table.querySelector<HTMLElement>("tbody td, tbody th")
    const cellStyle = cell ? getComputedStyle(cell) : null
    const lineHeight = cellStyle ? parseFloat(cellStyle.lineHeight) : 0
    const padBlock = cellStyle
      ? parseFloat(cellStyle.paddingTop) + parseFloat(cellStyle.paddingBottom)
      : 0
    const singleLine = lineHeight + padBlock

    return {
      rowHeight: Math.round(rowHeight * 100) / 100,
      header: Math.round(header * 100) / 100,
      contentTop: Math.round(contentTop * 100) / 100,
      afforded: Math.floor((height - contentTop - header) / rowHeight),
      lineHeight: Math.round(lineHeight * 100) / 100,
      padBlock: Math.round(padBlock * 100) / 100,
      singleLine: Math.round(singleLine * 100) / 100,
      affordedSingleLine: singleLine > 0 ? Math.floor((height - contentTop - header) / singleLine) : 0,
    }
  }, viewportHeight)
}

test.describe("STUDIO-030-001 — the scale affords a working set", () => {
  /**
   * The fleet: 13 rows before, 15 after. The floor is 15.
   *
   * 799px of content region (900 − 76 of top bar and `main` padding − 24.69 of
   * table header) over a 50.47px row. Before: 783px over 59.72px. The 2-row gain
   * is the row padding (8px), `body-small`'s line-height (1.25px × 2.4 lines) and
   * `main`'s top padding (8px), and no one of the three would have bought a row
   * on its own — which is the argument for changing the base rather than one
   * component.
   */
  test("the fleet scale affords at least 15 rows in a 900px content region", async ({ page }) => {
    await signIn(page)
    await page.goto("/tenants")
    await useDefaultDensity(page)
    await page.waitForLoadState("networkidle")

    const m = await affordedRows(page, VIEWPORT.height)
    expect(m, "the fleet must render a table to measure").not.toBeNull()
    expect(
      m!.afforded,
      `a ${m!.rowHeight}px row under a ${m!.header}px header in a region starting at y=${m!.contentTop}`,
    ).toBeGreaterThanOrEqual(15)
  })

  /**
   * The estate, asserted on the scale rather than on the data.
   *
   * This test first read `afforded >= 11`, measured against this machine's estate
   * rows at 67.94px. In CI the same stylesheet renders them at 84.91px and only 9
   * fit — because the estate's cells carry ARNs and Terraform paths that wrap, and
   * how many lines they wrap to depends on WHICH resources the account holds. The
   * spec's own comment said as much ("that is content, and the scale cannot fix
   * it") and then asserted a row count anyway, so it passed here and red CI.
   *
   * A row count cannot be asserted across environments whose data differs. What
   * CAN is the token layer's own contribution: one line of `body-small` plus the
   * row padding, which is identical everywhere the stylesheet is. 30 rows of that
   * fit the region, against 25 before the scale change — the same 2-rows-per-9
   * improvement the old number was reaching for, expressed so that content cannot
   * move it.
   */
  test("the estate scale affords at least 28 single-line rows in a 900px region", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform/estate")
    await useDefaultDensity(page)
    await page.waitForLoadState("networkidle")

    const m = await affordedRows(page, VIEWPORT.height)
    expect(m, "the estate must render a table to measure").not.toBeNull()
    expect(
      m!.affordedSingleLine,
      `a ${m!.singleLine}px single-line row (${m!.lineHeight}px line + ${m!.padBlock}px padding) ` +
        `under a ${m!.header}px header in a region starting at y=${m!.contentTop}; ` +
        `the shortest ACTUAL row here is ${m!.rowHeight}px, which is content`,
    ).toBeGreaterThanOrEqual(28)
  })
})

test.describe("STUDIO-030-001 — the scale is a ladder, and space is the hierarchy", () => {

  /**
   * The type scale steps by ratio.
   *
   * ADR-0009: "a heading that is three times body size on an internal console
   * is a poster". This is that sentence as an assertion — the largest role in
   * the scale, measured against body, at the width the console is read at.
   * Asserting the RATIO rather than the pixel size is what survives a viewer
   * who has raised their browser's base font size, which the whole scale is in
   * `rem` to support.
   */
  test("the largest display role is under twice body size", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")
    await useDefaultDensity(page)

    const ratio = await page.evaluate(() => {
      const probe = document.createElement("div")
      probe.style.position = "absolute"
      probe.style.visibility = "hidden"
      const big = document.createElement("span")
      big.className = "md3-display-large"
      const small = document.createElement("span")
      small.className = "md3-body-medium"
      probe.append(big, small)
      document.body.append(probe)
      const bigSize = parseFloat(getComputedStyle(big).fontSize)
      const smallSize = parseFloat(getComputedStyle(small).fontSize)
      probe.remove()
      return { bigSize, smallSize, ratio: bigSize / smallSize }
    })

    expect(
      ratio.ratio,
      `display-large is ${ratio.bigSize}px against a ${ratio.smallSize}px body`,
    ).toBeLessThan(2)
  })

  /**
   * Space is hierarchy, and the assertion is the comparison rather than either
   * number. ADR-0009: "the gap between groups should exceed the gap within
   * one". A stylesheet where `--space-4` (a group gap) has been tuned down past
   * `--space-2` (a within-group gap) has inverted the thing the whole ramp is
   * for, and no individual value would show it.
   */
  test("the between-group step exceeds the within-group step", async ({ page }) => {
    await signIn(page)
    await page.goto("/platform")
    await useDefaultDensity(page)

    const steps = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      const read = (name: string) => parseFloat(style.getPropertyValue(name))
      return {
        s1: read("--space-1"),
        s2: read("--space-2"),
        s3: read("--space-3"),
        s4: read("--space-4"),
        s6: read("--space-6"),
      }
    })

    expect(steps.s2, "within-group must exceed the hairline step").toBeGreaterThan(steps.s1)
    expect(steps.s4, "between-group must exceed within-group").toBeGreaterThan(steps.s2)
    expect(steps.s6, "between-region must exceed between-group").toBeGreaterThan(steps.s4)
  })

  /**
   * 200% zoom, which is where a base scale tuned too tightly gets caught.
   *
   * STUDIO-030-007 requires the console to work at 200%. Emulating zoom by
   * halving the viewport is the standard equivalence — 1440x900 at 200% is
   * 720x450 of CSS pixels — and the property that must hold is the one
   * `layout.spec.ts` measures at 320: the page does not scroll sideways.
   *
   * It belongs HERE rather than only there because it is the specific risk this
   * change carries. Density bought by making the console unusable magnified is
   * an accessibility requirement traded for a screenshot.
   */
  test("no sideways scroll at 200% zoom", async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 720, height: 450 })
    for (const route of ["/tenants", "/platform", "/platform/estate"]) {
      await page.goto(route)
      await useDefaultDensity(page)
      await page.waitForLoadState("networkidle")
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(
        overflow.scrollWidth,
        `${route} scrolls sideways at 200% zoom (${overflow.scrollWidth} > ${overflow.clientWidth})`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1)
    }
  })
})
