import { test, expect, type Page } from "@playwright/test"

/**
 * Dark mode, measured on the rendered page rather than in the stylesheet.
 *
 * A palette can be correct in `globals.css` and wrong on screen: one rule with
 * a literal colour, one component that hardcodes `#fff`, and a token nobody
 * changed is no longer what the pixel is. So these read `getComputedStyle` from
 * the live document and compute the contrast ratio the way a browser does.
 *
 * The threshold is WCAG 2.2 AA for body text, 4.5:1 (1.4.3). The console is
 * read for long stretches by operators looking at other people's data, and the
 * palette is deliberately neither pure black nor pure white in either theme —
 * so both the floor AND the ceiling are asserted.
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
  // The click settles on /api/auth/callback/operator, which returns no HTML —
  // so every locator after it finds an empty document. layout.spec.ts navigates
  // explicitly afterwards and never noticed; this does it here so the helper
  // leaves the browser on a page rather than on an endpoint.
  await page.goto("/")
  await page.waitForLoadState("networkidle")
}

/** sRGB relative luminance, per WCAG. Run in the page so it reads real pixels. */
const CONTRAST_FN = `
  function parse(c) {
    const m = c.match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const [r, g, b] = m[1].split(",").map((v) => parseFloat(v))
    return [r, g, b]
  }
  /*
   * Transparent means ALPHA zero, which is a four-component colour whose fourth
   * value is 0. Testing the string for ", 0)" also matches rgb(0, 0, 0) — pure
   * black was being skipped as "no background", which is the one value these
   * tests exist to catch. A mutation setting --bg to #000000 passed twice
   * before this was written properly.
   */
  function transparent(c) {
    const m = c.match(/rgba\\(([^)]+)\\)/)
    if (!m) return false
    const parts = m[1].split(",").map((v) => parseFloat(v))
    return parts.length === 4 && parts[3] === 0
  }
  function lum(rgb) {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  function ratio(fg, bg) {
    const a = lum(fg), b = lum(bg)
    const [hi, lo] = a > b ? [a, b] : [b, a]
    return (hi + 0.05) / (lo + 0.05)
  }
`

/**
 * The effective background behind an element.
 *
 * Walking up until something is not transparent, because `rgba(0,0,0,0)` on the
 * element itself would otherwise compute as pure black and every ratio would be
 * wrong in the direction that looks fine.
 */
type Measured = { text: string; fg: string; bg: string; ratio: number }

async function measureText(page: Page): Promise<Measured[]> {
  return page.evaluate(`(() => {
    ${CONTRAST_FN}
    function effectiveBg(el) {
      let node = el
      while (node) {
        const c = getComputedStyle(node).backgroundColor
        const rgb = parse(c)
        if (rgb && !transparent(c)) return rgb
        node = node.parentElement
      }
      return [255, 255, 255]
    }
    const out = []
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const text = (el.textContent || "").trim()
      if (!text) continue
      if (Array.from(el.children).some((c) => (c.textContent || "").trim())) continue
      const style = getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue
      const fg = parse(style.color)
      if (!fg) continue
      const bg = effectiveBg(el)
      out.push({
        text: text.slice(0, 40),
        fg: style.color,
        bg: 'rgb(' + bg.join(', ') + ')',
        ratio: ratio(fg, bg),
      })
    }
    return out
  })()`) as Promise<Measured[]>
}

const rgbOf = (s: string) => (s.match(/\\d+/g) ?? s.match(/\d+/g) ?? []).map(Number)

test.describe("the theme toggle", () => {
  test("cycles System, Light, Dark and back", async ({ page }) => {
    await signIn(page)
    const toggle = page.getByRole("button", { name: /^Theme:/ })

    await expect(toggle).toHaveText("System")
    await toggle.click()
    await expect(toggle).toHaveText("Light")
    await toggle.click()
    await expect(toggle).toHaveText("Dark")
    await toggle.click()
    await expect(toggle).toHaveText("System")
  })

  test("actually changes the page, not just the label", async ({ page }) => {
    await signIn(page)
    const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

    const toggle = page.getByRole("button", { name: /^Theme:/ })
    await toggle.click() // Light
    const light = await bodyBg()
    await toggle.click() // Dark
    const dark = await bodyBg()

    expect(dark).not.toBe(light)
    // Dark must be darker, which is not implied by "different".
    const sum = (c: string) => (c.match(/\d+/g) ?? []).slice(0, 3).reduce((a, b) => a + Number(b), 0)
    expect(sum(dark)).toBeLessThan(sum(light))
  })

  test("survives a reload and a navigation", async ({ page }) => {
    // A preference that resets on the next page is not a preference. This also
    // covers the pre-paint script: after reload the attribute must be present
    // before React hydrates, or the operator sees a white flash every time.
    await signIn(page)
    const toggle = page.getByRole("button", { name: /^Theme:/ })
    await toggle.click()
    await toggle.click() // Dark
    await expect(toggle).toHaveText("Dark")

    await page.reload()
    await expect(page.getByRole("button", { name: /^Theme:/ })).toHaveText("Dark")
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark")

    await page.getByRole("link", { name: "Tenants" }).click()
    await page.waitForLoadState("networkidle")
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark")
  })

  test("applies the theme before the page paints, not after hydration", async ({ request }) => {
    // This asserts on the SERVED HTML rather than through a browser, because a
    // browser cannot tell the two apart: without the inline script, React's
    // effect still stamps the attribute a moment later, and every assertion
    // through `page` passes while the operator sees a white flash on every
    // navigation. Removing the script broke nothing observable — which is
    // exactly why it needs a test that looks at the document itself.
    //
    // Three real regressions are covered here, all of which shipped silently:
    const html = await (await request.get("/signin")).text()

    // 1. The script placed in <head> was dropped from the output entirely by
    //    the App Router. It renders only as a child of <body>.
    const script = html.indexOf("tenure-studio-theme")
    expect(script, "the pre-paint script is not in the served HTML").toBeGreaterThan(-1)

    // 2. It must come before the content it is preventing a flash of. After it
    //    is the same as absent.
    const content = html.indexOf('class="masthead"')
    expect(content).toBeGreaterThan(-1)
    expect(script).toBeLessThan(content)

    // 3. THEME_STORAGE_KEY lived in a "use client" module and reached the
    //    server layout as a client reference, serialising to
    //    `localStorage.getItem(undefined)`. Nothing threw; the script ran, read
    //    nothing, and every operator got light regardless of their choice.
    expect(html).not.toContain("localStorage.getItem(undefined)")
  })

  test("is large enough to hit", async ({ page }) => {
    // WCAG 2.2 2.5.8 — 24x24 CSS pixels. An 11px uppercase label in a masthead
    // is the exact shape of control that misses this.
    await signIn(page)
    const box = await page.getByRole("button", { name: /^Theme:/ }).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(24)
    expect(box!.width).toBeGreaterThanOrEqual(24)
  })
})

for (const theme of ["light", "dark"] as const) {
  test(`every text block meets AA contrast in ${theme}`, async ({ page }) => {
    await signIn(page)
    const toggle = page.getByRole("button", { name: /^Theme:/ })
    await toggle.click() // Light
    if (theme === "dark") await toggle.click()
    await expect(toggle).toHaveText(theme === "dark" ? "Dark" : "Light")

    for (const route of ["/", "/tenants", "/platform"]) {
      await page.goto(route)
      await page.waitForLoadState("networkidle")

      const failures = (await measureText(page)).filter((m) => m.ratio < 4.5)
      expect(
        failures.map((f) => `${route} "${f.text}" ${f.fg} on ${f.bg} = ${f.ratio.toFixed(2)}:1`),
      ).toEqual([])
    }
  })

  test(`${theme} uses neither pure black nor pure white`, async ({ page }) => {
    // The palette's stated rule, asserted where it can actually be broken. A
    // single component with `color: #fff` passes every contrast check and
    // breaks the thing the palette exists for.
    await signIn(page)
    const toggle = page.getByRole("button", { name: /^Theme:/ })
    await toggle.click()
    if (theme === "dark") await toggle.click()

    const colors = await page.evaluate(() => {
      const seen = new Set<string>()
      const all = [document.documentElement, document.body, ...Array.from(document.querySelectorAll("body *"))]

      for (const el of all) {
        const s = getComputedStyle(el)

        // BACKGROUNDS from everything, `body` included. The page background is
        // set on `body`, so a scan of `body *` never sees it — a mutation
        // setting --bg to #000000 passed this test until `body` was added.
        //
        // Transparent means ALPHA zero: a four-component colour whose fourth
        // value is 0. Testing the string for ", 0)" also matches `rgb(0, 0, 0)`,
        // so pure black was skipped as "no background" — and pure black is the
        // one value this test exists to catch. The same mutation passed a
        // second time because of it.
        const bgParts = (s.backgroundColor.match(/rgba\(([^)]+)\)/)?.[1] ?? "")
          .split(",")
          .map((v) => parseFloat(v))
        const isTransparent = bgParts.length === 4 && bgParts[3] === 0
        if (!isTransparent) seen.add(s.backgroundColor)

        // COLOURS only where text is actually drawn. `<html>` has no colour
        // rule of its own, so its computed colour is the user agent's default
        // black — real, inherited by nothing that renders, and a false positive
        // that made this test fail against a correct palette.
        const ownText = Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim(),
        )
        if (ownText) seen.add(s.color)
      }
      return [...seen]
    })

    const extremes = colors.filter((c) => {
      const [r, g, b] = (c.match(/\d+/g) ?? []).slice(0, 3).map(Number)
      return (r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)
    })
    expect(extremes).toEqual([])
  })
}
