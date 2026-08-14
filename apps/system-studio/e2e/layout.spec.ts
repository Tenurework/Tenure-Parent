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
  /*
   * The six that were served and never measured.
   *
   * `find src/app -name page.tsx` returns eighteen routes; this array listed
   * nine. A shell rebuild measured on nine routes and shipped on eighteen is a
   * shell rebuild that has been measured on half of itself, and these six carry
   * the widest tables in the console — five EC2/ELBv2 readers on `/network`
   * alone. `/signin` and the three tenant-detail routes are deliberately not
   * here: the first renders no shell at all (information-architecture §9.1) and
   * the others need a seeded tenant, which `an irreversible move is separated`
   * below already provides for the one case that needs it.
   */
  "/platform/network",
  "/platform/compute",
  "/platform/messaging",
  "/platform/identity",
  "/platform/data",
  "/platform/diagnostics",
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

      // `getClientRects()`, one box per LINE — not `getBoundingClientRect()`,
      // which returns the union of them.
      //
      // For an inline element that wraps, the union is a lie about where the ink
      // is: a `<time>` broken across two lines returns one box spanning the full
      // column width and both line heights, and every word on the second line
      // sits geometrically "inside" it while overlapping nothing on screen. That
      // produced `"2026-08-14 19:23 UTC" (time) over "OPEN" (b) — 100% covered`
      // on /platform/audit at three widths, for a sentence reading
      // "…as of <time>. An <b>OPEN</b> row is…" — two inline siblings in normal
      // flow, which cannot overlap.
      //
      // It stayed hidden until the shell narrowed the content column enough to
      // make that `<time>` wrap for the first time. The bug was always here; the
      // wrap is what exposed it.
      for (const r of el.getClientRects()) {
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

        // Visually-hidden text is clipped ON PURPOSE — that is the whole
        // technique. The standard recipe is a 1px box with `overflow: hidden`
        // and `clip-path: inset(50%)`, which is indistinguishable by
        // scrollHeight from a heading squashed by a fixed height. Reporting it
        // would push somebody to "fix" an accessible label by making it
        // visible, or to delete it — both worse than the false positive.
        //
        // Detected by the clip, not by a class name, so it holds for any
        // module's own sr-only rule rather than one the test knows about.
        // Nav.tsx's `Sections of {label}` group labels are the nine that
        // surfaced this.
        const clipsItself = style.clipPath !== "none" || style.clip !== "auto"
        const oneByOne = el.clientWidth <= 2 && el.clientHeight <= 2
        if (clipsItself && oneByOne) continue

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
 * STUDIO-030-008 — the shell.
 *
 * Three properties, and each of them is a defect this console actually had:
 *
 *   1. The content region uses the width it has. `main` was
 *      `inline-size: min(100%, 1280px); margin-inline: auto` — 80px of dead
 *      page down each side of a 1440px screen and 320px down each side of a
 *      1920px one. The operator's words: "isolated in the centre of the
 *      screen".
 *   2. The top bar and the navigation do not reflow after hydration. A shell
 *      rebuild is exactly where layout shift is introduced, so this is
 *      measured rather than asserted.
 *   3. A route change does not lose keyboard focus.
 *
 * Every number below is a measurement of the running console, not a token read
 * out of the stylesheet: a test that read `--rail-inline-size` and then checked
 * the rail against it would pass on a rail that renders at zero.
 * ───────────────────────────────────────────────────────────────────────────*/

/** What the shell's three regions occupy, in CSS pixels, rounded. */
async function shellGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      }
    }
    return {
      viewport: document.documentElement.clientWidth,
      topbar: box("header.masthead"),
      rail: box(".console-rail"),
      main: box("main"),
    }
  })
}

/*
 * The operator's complaint, encoded.
 *
 * Both widths matter and they catch different regressions. At 1440 the old
 * rule left 80px of empty page on each side of the content, which the
 * right-edge check below fails on. At 1920 a 1280px cap re-introduced INSIDE
 * the content column — the way this gets undone by accident, since at 1440 a
 * 1280px cap is invisible once a 272px rail is subtracted — leaves 368px of it,
 * which the same check fails on. One width would have licensed the other.
 */
const CONTENT_EDGE_TOLERANCE_PX = 48

for (const width of [1440, 1920]) {
  test(`at ${width}px the content region uses the width available`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await signIn(page)
    await page.goto("/tenants")
    await page.waitForLoadState("networkidle")

    const shell = await shellGeometry(page)
    expect(shell.rail, "there is no persistent navigation region").not.toBeNull()
    expect(shell.main, "there is no content region").not.toBeNull()
    const rail = shell.rail!
    const main = shell.main!

    expect(rail.w, "the navigation region rendered at no width").toBeGreaterThan(120)
    expect(
      rail.x,
      `the navigation region starts ${rail.x}px in from the inline start; it is the edge of the shell`,
    ).toBeLessThanOrEqual(2)

    expect(
      main.x - (rail.x + rail.w),
      `${Math.round(main.x - (rail.x + rail.w))}px of gutter between the navigation and the content`,
    ).toBeLessThanOrEqual(CONTENT_EDGE_TOLERANCE_PX)

    expect(
      shell.viewport - (main.x + main.w),
      `the content region stops ${Math.round(shell.viewport - (main.x + main.w))}px short of the ` +
        `inline end of a ${shell.viewport}px viewport. This is the assertion that says the console ` +
        `is not a column in the middle of the screen; a re-centred \`main\` fails here first.`,
    ).toBeLessThanOrEqual(CONTENT_EDGE_TOLERANCE_PX)

    // And the two regions together account for the viewport, so neither can be
    // satisfied by the other having quietly collapsed.
    expect(
      rail.w + main.w,
      `the navigation (${rail.w}px) and the content (${main.w}px) occupy ${rail.w + main.w}px of a ` +
        `${shell.viewport}px viewport`,
    ).toBeGreaterThanOrEqual(shell.viewport - CONTENT_EDGE_TOLERANCE_PX)
  })
}

/*
 * No reflow after hydration, measured by rendering the page twice.
 *
 * The second context has JavaScript disabled, so what it lays out is the
 * server's HTML against the stylesheet with nothing having hydrated, nothing
 * having mounted an effect and no client component having corrected itself.
 * If the two geometries agree, nothing in the shell moved when React arrived —
 * which is the whole of "prevent layout shift" for a frame that renders on
 * every route.
 *
 * This is the assertion that catches the obvious ways to build this badly: a
 * rail whose width is measured in a `useEffect`, a top bar that renders the
 * account menu only once the session resolves on the client, a `<details>`
 * opened from `localStorage` on mount, a mark with no intrinsic size. All four
 * are invisible to every other test in this file, because they are all correct
 * once they have settled.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100"

for (const width of [1440, 900]) {
  test(`at ${width}px the shell does not reflow after hydration`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 1000 })
    await signIn(page)
    await page.goto("/platform/cost")
    await page.waitForLoadState("networkidle")
    const hydrated = await shellGeometry(page)

    // The same session, replayed into a context that will never run a line of
    // the application's JavaScript.
    const cookies = await page.context().cookies()
    const raw = await browser.newContext({
      baseURL: BASE_URL,
      javaScriptEnabled: false,
      viewport: { width, height: 1000 },
    })
    await raw.addCookies(cookies)
    const rawPage = await raw.newPage()
    try {
      await rawPage.goto("/platform/cost")
      const served = await shellGeometry(rawPage)

      expect(served.topbar, "the server rendered no top bar").not.toBeNull()
      expect(served.rail, "the server rendered no navigation region").not.toBeNull()
      expect(
        { topbar: served.topbar, rail: served.rail, main: served.main },
        "the shell is laid out differently before and after hydration — the first number is the " +
          "server's HTML with no JavaScript, the second is the hydrated page",
      ).toEqual({ topbar: hydrated.topbar, rail: hydrated.rail, main: hydrated.main })
    } finally {
      await raw.close()
    }
  })
}

/*
 * Keyboard focus survives a route change.
 *
 * `Nav.tsx` renders the current entry as a `<span>` and the others as `<a>`, so
 * activating a rail link unmounts the anchor that holds focus. A browser whose
 * focused element is removed drops focus on `<body>`, and the next Tab restarts
 * at the top of the document — past the skip link, the mark, the estate chips,
 * the search control, the account menu and every rail entry — to reach the page
 * that was just opened.
 *
 * What is asserted is the outcome rather than the mechanism: after the
 * navigation, focus is on something real, it is inside the content region the
 * operator asked for, and the page did not scroll to put it there.
 */
test("moving between routes does not lose keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signIn(page)
  await page.goto("/tenants")
  await page.waitForLoadState("networkidle")

  const entry = page.locator(".console-rail").getByRole("link", { name: "Cost", exact: true })
  await entry.focus()
  expect(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "the rail entry did not take focus, so this test never exercised a keyboard navigation",
  ).toBe("Cost")

  const scrollBefore = await page.evaluate(() => window.scrollY)
  await entry.press("Enter")
  await page.waitForURL("**/platform/cost")
  await page.waitForLoadState("networkidle")

  /*
   * Polled, and the window is why.
   *
   * Focus is dropped at the moment React commits the new route and unmounts the
   * anchor, which is a frame or two AFTER the URL changes — measured here at
   * 300ms for the URL and 450ms for the repair, on this machine. A single read
   * taken the instant `waitForURL` returns is therefore a read of the gap
   * rather than of the outcome. The window is bounded at three seconds: if
   * nothing repairs the drop, focus stays on `<body>` for the life of the page
   * and this fails, which is exactly what happens with the restoration in
   * `layout.tsx` removed.
   */
  await expect
    .poll(
      async () => page.evaluate(() => (document.activeElement ?? document.body).tagName.toLowerCase()),
      {
        timeout: 3_000,
        message:
          "focus was dropped on <body> by the route change and nothing put it back. A keyboard " +
          "operator now re-traverses the whole shell to reach the page they just opened.",
      },
    )
    .not.toBe("body")

  const landed = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return {
      tag: el ? el.tagName.toLowerCase() : "none",
      id: el?.id ?? "",
      inShell: !!el?.closest(".console-shell, header.masthead"),
      scrollY: window.scrollY,
    }
  })

  expect(landed.inShell, `focus landed on <${landed.tag}>, outside the shell entirely`).toBe(true)
  expect(landed.scrollY, "moving focus also scrolled the page").toBe(scrollBefore)

  /*
   * And it is a place a keyboard operator can continue FROM.
   *
   * The assertion is where the next Tab must NOT be rather than where it must
   * be: the content of a given route may hold no focusable element at all, and
   * a test that demanded one would be asserting something about that page
   * instead of about the shell. What must never happen is the Tab landing back
   * in the chrome — that is the symptom of focus having restarted at the top of
   * the document, which is the defect.
   */
  await page.keyboard.press("Tab")
  const next = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return {
      inChrome: !!el?.closest(".console-rail, header.masthead"),
      label: (el?.textContent ?? "").trim().slice(0, 40),
    }
  })
  expect(
    next.inChrome,
    `the Tab after the navigation went back into the shell chrome, at "${next.label}" — focus had ` +
      `restarted at the top of the document`,
  ).toBe(false)
})

/*
 * The rail is a rail at 1440 and is out of the flow at 320 — and "out of the
 * flow" means `display: none`, not moved.
 *
 * The distinction is the reason this is a test. `textBoxes()` above skips
 * `display:none` and measures everything else IN PAGE COORDINATES, so a rail
 * hidden by `transform: translateX(-100%)` is still collected, its labels are
 * still measured, and they sit on top of the content's boxes — and under
 * `dir="rtl"` the same transform lands on the positive side and scrolls the
 * page. Every overlap failure that would produce points at the page rather
 * than at the rail, so it is asserted here directly.
 */
test("the navigation is a full-height rail at 1440 and off-canvas at 320", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signIn(page)
  await page.goto("/platform/audit")
  await page.waitForLoadState("networkidle")

  const wide = await page.evaluate(() => {
    const rail = document.querySelector(".console-rail")!
    const tree = document.getElementById("console-sections")
    const style = getComputedStyle(rail)
    return {
      treeVisible: tree ? getComputedStyle(tree).display !== "none" : false,
      treeOverflowY: tree ? getComputedStyle(tree).overflowY : "absent",
      treeMaxHeight: tree ? getComputedStyle(tree).maxHeight : "absent",
      position: style.position,
      height: Math.round(rail.getBoundingClientRect().height),
      destinations: rail.querySelectorAll("a[href], .here").length,
    }
  })
  expect(wide.treeVisible, "the rail's sections are hidden at 1440px").toBe(true)
  expect(wide.position, "the rail does not stay with the operator as the page scrolls").toBe("sticky")
  expect(
    wide.treeOverflowY,
    "the tree must scroll ITSELF inside the rail; `hidden` would put navigation out of reach with " +
      "nothing on screen to say so, and `visible` makes a long tree push the page",
  ).toBe("auto")
  expect(
    wide.treeMaxHeight === "none" ? Number.POSITIVE_INFINITY : parseFloat(wide.treeMaxHeight),
    `the tree is bounded at ${wide.treeMaxHeight}, which is not inside a 1000px viewport. The bound ` +
      `is \`calc(100dvh - var(--console-nav-offset))\` and the shell supplies that offset; a shell ` +
      `that does not sets it to the 9rem fallback and the tree runs off the bottom of the screen.`,
  ).toBeLessThanOrEqual(1000)
  expect(wide.height, "the rail is not full height").toBeGreaterThan(600)
  expect(wide.destinations, "the rail rendered no destinations").toBeGreaterThanOrEqual(14)

  await page.setViewportSize({ width: 320, height: 1000 })
  const disclosure = page.locator('.console-rail [aria-controls="console-sections"]')
  await expect(disclosure, "there is no way to open the sections at 320px").toBeVisible()

  const narrow = await page.evaluate(() => {
    const rail = document.querySelector(".console-rail")!.getBoundingClientRect()
    const main = document.querySelector("main")!.getBoundingClientRect()
    return {
      treeDisplay: getComputedStyle(document.getElementById("console-sections")!).display,
      railHeight: Math.round(rail.height),
      gapToContent: Math.round(main.top - rail.bottom),
    }
  })
  expect(
    narrow.treeDisplay,
    "the collapsed tree is still laid out. It must be `display: none` — a tree moved off-screen is " +
      "still measured, and its labels are then measured on top of the page's.",
  ).toBe("none")
  /*
   * The rail's OWN height, not the content's top. At 320 the top bar wraps to
   * several rows and is most of what sits above the page; that is the bar's
   * lane and asserting on it here would make this test fail for a change it is
   * not about. What this lane owns is that the collapsed navigation is a
   * CONTROL rather than a screenful — an open fourteen-entry tree above every
   * page is what `display: none` and the disclosure exist to prevent.
   */
  expect(
    narrow.railHeight,
    `the collapsed navigation region is ${narrow.railHeight}px tall. Closed, it is one disclosure ` +
      `button and its padding.`,
  ).toBeLessThan(120)
  expect(narrow.gapToContent, "there is dead space between the navigation and the page").toBeLessThan(24)

  // Opening it is one click and it does not scroll the page out from under the
  // operator.
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await disclosure.click()
  expect(
    await page.evaluate(() => getComputedStyle(document.getElementById("console-sections")!).display),
    "the sections did not open",
  ).not.toBe("none")
  expect(await page.evaluate(() => window.scrollY), "opening the sections scrolled the page").toBe(
    scrollBefore,
  )
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
 *
 * ## Why the page's budget is counted over `main` and not over the document
 *
 * It used to be `document.querySelectorAll("*")`. Under the old chrome — a bar
 * of four items and a strip of fourteen links — the difference did not matter.
 * The shell is now a persistent top bar, a navigation tree of fourteen
 * destinations with their sub-items, and a breadcrumb trail, and MEASURED at
 * 1440 on this build those three carry 38 + 166 + 3 elements, 200 in the rail
 * inside a tenant where the contextual sub-tree renders. `/` then reported 500
 * against a budget of 400 while its own content had not grown by one node.
 *
 * The numbers below are UNCHANGED, and the reading is narrowed to the page
 * instead — which is what they were about. Raising them to swallow the chrome
 * would have been the same edit with the meaning removed: a page could then
 * grow by 100 nodes and still pass, and nothing would bound the chrome at all.
 *
 * So the chrome gets its own budget, below, which is a bound this file did not
 * have before. Counted over the three shell regions by name rather than as
 * "everything outside `main`": the App Router emits a variable number of
 * `<script>` tags carrying the flight payload, and a budget that counted those
 * would fail on a page that added a card.
 */
const NODE_BUDGET: Record<string, number> = {
  "/": 400,
  "/tenants": 1400,
  "/platform": 6000,
  "/platform/cost": 800,
}

/**
 * The shell's own ceiling — the top bar, the navigation tree and the trail.
 *
 * Measured at 1440: 38 + 166 + 3 = 207 on `/`, and 245 inside a tenant, where
 * the rail grows the contextual sub-tree. 320 is that plus room for a group and
 * its sub-items; it is not room for a second navigation.
 */
const SHELL_NODE_BUDGET = 320

const LCP_BUDGET_MS = 2500

for (const [route, budget] of Object.entries(NODE_BUDGET)) {
  test(`${route} stays inside its DOM and LCP budget`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signIn(page)

    await page.goto(route)
    await page.waitForLoadState("networkidle")

    const counted = await page.evaluate(() => ({
      page: document.querySelectorAll("main *").length,
      shell:
        document.querySelectorAll("header.masthead *").length +
        document.querySelectorAll(".console-rail *").length +
        document.querySelectorAll('[data-breadcrumbs="shell"] *').length,
    }))

    expect(
      counted.page,
      `${route} rendered ${counted.page} elements inside <main> against a budget of ${budget}. A ` +
        `table that stopped paging is the usual cause; the fix is the pager, not the number.`,
    ).toBeLessThanOrEqual(budget)

    expect(
      counted.shell,
      `the shell rendered ${counted.shell} elements on ${route} against a budget of ` +
        `${SHELL_NODE_BUDGET}. This is on EVERY route, so it is the one budget that is paid ` +
        `fourteen times a session.`,
    ).toBeLessThanOrEqual(SHELL_NODE_BUDGET)

    // And it is really there: a shell that rendered nothing would satisfy a
    // ceiling, which is the way a budget quietly stops measuring anything.
    expect(counted.shell, `${route} rendered no shell at all`).toBeGreaterThan(30)

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
