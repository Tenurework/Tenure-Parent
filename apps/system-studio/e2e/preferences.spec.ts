import { test, expect, type Page } from "@playwright/test"

import { documentAttributes, STORAGE_KEYS, type Preferences } from "../src/lib/preferences"

/**
 * GE-022-008 — display preferences, measured on the rendered page.
 *
 * The claims worth testing are the ones a stylesheet can quietly break: that
 * compact tightens space without shrinking anything a person has to hit, that
 * every combination still meets contrast, and that reduced motion stops
 * transitions rather than shortening them. A token can be correct in
 * `globals.css` and wrong on screen — one rule with a literal value is all it
 * takes — so everything below reads `getComputedStyle` from the live document.
 *
 * WCAG 2.2 AA throughout: 1.4.3 contrast (4.5:1 body text) and 2.5.8 target
 * size (24x24 CSS pixels).
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
  // The click settles on /api/auth/callback/operator, which returns no HTML, so
  // every locator after it would search an empty document.
  await page.goto("/")
  await page.waitForLoadState("networkidle")
}

/** Open the panel if it is closed, then choose one option. */
async function choose(page: Page, group: keyof Preferences, value: string) {
  const panel = page.locator(".pref-panel")
  if (!(await panel.isVisible())) await page.locator(".pref-trigger").click()
  await page.locator(`[name="${group}"][value="${value}"]`).check()
}

const attributesOf = (page: Page) =>
  page.evaluate(() => ({
    "data-theme": document.documentElement.getAttribute("data-theme"),
    "data-density": document.documentElement.getAttribute("data-density"),
    "data-motion": document.documentElement.getAttribute("data-motion"),
    "data-contrast": document.documentElement.getAttribute("data-contrast"),
  }))

/** Text blocks failing AA against their effective background. */
async function contrastFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const parse = (c: string): [number, number, number] | null => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const [r, g, b] = m[1].split(",").map((v) => parseFloat(v))
      return [r, g, b]
    }
    // Transparency is ALPHA zero — a four-component colour whose fourth value
    // is 0. Testing the string for ", 0)" also matches `rgb(0, 0, 0)`, which
    // once meant pure black was skipped as "no background".
    const transparent = (c: string) => {
      const m = c.match(/rgba\(([^)]+)\)/)
      if (!m) return false
      const parts = m[1].split(",").map((v) => parseFloat(v))
      return parts.length === 4 && parts[3] === 0
    }
    const lum = ([r, g, b]: [number, number, number]) => {
      const [R, G, B] = [r, g, b].map((v) => {
        const s = v / 255
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * R + 0.7152 * G + 0.0722 * B
    }
    const ratio = (fg: [number, number, number], bg: [number, number, number]) => {
      const a = lum(fg)
      const b = lum(bg)
      const [hi, lo] = a > b ? [a, b] : [b, a]
      return (hi + 0.05) / (lo + 0.05)
    }
    const effectiveBg = (el: Element): [number, number, number] => {
      let node: Element | null = el
      while (node) {
        const c = getComputedStyle(node).backgroundColor
        const rgb = parse(c)
        if (rgb && !transparent(c)) return rgb
        node = node.parentElement
      }
      return [255, 255, 255]
    }

    const failures: string[] = []
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const text = (el.textContent ?? "").trim()
      if (!text) continue
      if (Array.from(el.children).some((c) => (c.textContent ?? "").trim())) continue
      const style = getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue
      const fg = parse(style.color)
      if (!fg) continue
      const r = ratio(fg, effectiveBg(el))
      if (r < 4.5) failures.push(`"${text.slice(0, 32)}" ${style.color} = ${r.toFixed(2)}:1`)
    }
    return failures
  })
}

test.describe("the preferences menu", () => {
  test("offers all four preferences, each as a labelled group", async ({ page }) => {
    await signIn(page)
    await page.locator(".pref-trigger").click()
    for (const legend of ["Theme", "Density", "Reduced motion", "Increased contrast"]) {
      await expect(page.getByRole("group", { name: legend })).toBeVisible()
    }
  })

  test("each preference reaches the document", async ({ page }) => {
    await signIn(page)
    await choose(page, "colorScheme", "dark")
    await choose(page, "density", "compact")
    await choose(page, "reducedMotion", "on")
    await choose(page, "increasedContrast", "on")

    expect(await attributesOf(page)).toEqual({
      "data-theme": "dark",
      "data-density": "compact",
      "data-motion": "reduced",
      "data-contrast": "more",
    })
  })

  test("survives a reload and a navigation", async ({ page }) => {
    await signIn(page)
    await choose(page, "colorScheme", "dark")
    await choose(page, "density", "compact")

    await page.reload()
    expect(await attributesOf(page)).toMatchObject({ "data-theme": "dark", "data-density": "compact" })

    await page.getByRole("link", { name: "Tenants" }).click()
    await page.waitForLoadState("networkidle")
    expect(await attributesOf(page)).toMatchObject({ "data-theme": "dark", "data-density": "compact" })
  })

  test("applies preferences before the page paints, not after hydration", async ({ request }) => {
    // Asserted on the SERVED HTML, because a browser cannot tell the two apart:
    // without the inline script React's effect still stamps the attributes a
    // moment later, and every assertion through `page` passes while the operator
    // watches the layout reflow on every navigation.
    const html = await (await request.get("/signin")).text()

    // A <script> placed in <head> is dropped from the output entirely by the
    // App Router. It renders only as a child of <body>.
    const script = html.indexOf(STORAGE_KEYS.colorScheme)
    expect(script, "the pre-paint script is not in the served HTML").toBeGreaterThan(-1)

    // Before the content it prevents a flash of. After it is the same as absent.
    const content = html.indexOf('class="masthead"')
    expect(content).toBeGreaterThan(-1)
    expect(script).toBeLessThan(content)

    // All four keys. Density reflows the whole layout, which is worse than a
    // colour flash and the easiest of the four to leave out.
    for (const key of Object.values(STORAGE_KEYS)) expect(html).toContain(key)

    // These constants lived in a "use client" module once and reached the server
    // layout as client references, serialising to `getItem(undefined)`. Nothing
    // threw; every operator simply got the defaults.
    expect(html).not.toContain("getItem(undefined)")
  })
})

/**
 * The inline script duplicates `documentAttributes`, and it has to: a bundled
 * import cannot run before the bundle loads, and the bundle loading is the
 * thing being raced. Two copies of one rule is exactly the failure GE-020-005
 * is about, so these drive the real script in a real browser and compare it
 * against the module, case by case.
 */
const DRIFT_CASES: {
  name: string
  stored: Partial<Preferences>
  device: { dark: boolean; reducedMotion: boolean; increasedContrast: boolean }
}[] = [
  { name: "nothing stored, silent device", stored: {}, device: { dark: false, reducedMotion: false, increasedContrast: false } },
  { name: "nothing stored, dark device", stored: {}, device: { dark: true, reducedMotion: false, increasedContrast: false } },
  { name: "light chosen on a dark device", stored: { colorScheme: "light" }, device: { dark: true, reducedMotion: false, increasedContrast: false } },
  { name: "dark chosen on a light device", stored: { colorScheme: "dark" }, device: { dark: false, reducedMotion: false, increasedContrast: false } },
  { name: "compact chosen", stored: { density: "compact" }, device: { dark: false, reducedMotion: false, increasedContrast: false } },
  { name: "device asks reduced motion, control says off", stored: { reducedMotion: "off" }, device: { dark: false, reducedMotion: true, increasedContrast: false } },
  { name: "device asks contrast, control says off", stored: { increasedContrast: "off" }, device: { dark: false, reducedMotion: false, increasedContrast: true } },
  { name: "control forces both, device silent", stored: { reducedMotion: "on", increasedContrast: "on" }, device: { dark: false, reducedMotion: false, increasedContrast: false } },
]

test.describe("the inline script agrees with the module it duplicates", () => {
  for (const testCase of DRIFT_CASES) {
    test(testCase.name, async ({ page }) => {
      await page.emulateMedia({
        colorScheme: testCase.device.dark ? "dark" : "light",
        reducedMotion: testCase.device.reducedMotion ? "reduce" : "no-preference",
        contrast: testCase.device.increasedContrast ? "more" : "no-preference",
      })

      await page.goto("/signin")
      await page.evaluate(
        ({ keys, stored }) => {
          localStorage.clear()
          for (const [name, value] of Object.entries(stored)) {
            localStorage.setItem((keys as Record<string, string>)[name], value as string)
          }
        },
        { keys: STORAGE_KEYS as Record<string, string>, stored: testCase.stored as Record<string, string> },
      )

      // The application bundle is blocked for the reload, and this is the whole
      // reason these tests mean anything. `PreferencesMenu`'s mount effect calls
      // `documentAttributes` — the module — and re-stamps the attributes a
      // moment after hydration. So a script that disagrees with the module is
      // silently CORRECTED before any assertion runs, and the drift test passes
      // while the flash it exists to prevent happens on every load.
      //
      // Proven: a mutation removing the device check from the script's contrast
      // branch passed all eight of these until the bundle was blocked.
      await page.route("**/_next/static/chunks/**", (route) => route.abort())
      await page.reload({ waitUntil: "domcontentloaded" })

      const expected = documentAttributes(
        {
          colorScheme: "system",
          density: "comfortable",
          reducedMotion: "system",
          increasedContrast: "system",
          ...testCase.stored,
        },
        testCase.device,
      )
      expect(await attributesOf(page)).toEqual(expected)
    })
  }
})

test.describe("compact tightens space and nothing else", () => {
  test("actually reduces spacing, or density is a no-op", async ({ page }) => {
    await signIn(page)
    const mainPadding = () =>
      page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("main")!).paddingTop))

    const comfortable = await mainPadding()
    await choose(page, "density", "compact")
    expect(await mainPadding()).toBeLessThan(comfortable)
  })

  test("does not shrink text", async ({ page }) => {
    // Bible §26.3.4: "ERP density is earned through alignment and progressive
    // disclosure, not tiny text."
    await signIn(page)
    const bodySize = () => page.evaluate(() => getComputedStyle(document.body).fontSize)
    const before = await bodySize()
    await choose(page, "density", "compact")
    expect(await bodySize()).toBe(before)
  })

  for (const density of ["comfortable", "compact"] as const) {
    test(`keeps every control at least 24x24 in ${density}`, async ({ page }) => {
      // WCAG 2.2 AA 2.5.8, and the line this item draws: compact tightens the
      // space AROUND a control, never the control itself.
      await signIn(page)
      await choose(page, "density", density)

      const small = await page.evaluate(() => {
        const out: string[] = []
        for (const el of Array.from(document.querySelectorAll("button, summary, input, .pref-option"))) {
          const style = getComputedStyle(el)
          if (style.display === "none" || style.visibility === "hidden") continue
          const box = el.getBoundingClientRect()
          if (box.width === 0 && box.height === 0) continue

          // WCAG 2.5.8 measures the TARGET, and for an input wrapped in a label
          // the label is the target — a 13x13 radio inside a 24px row is a 24px
          // target, which is why the criterion is written about targets rather
          // than about elements. Only skip when the label actually clears it.
          const label = el.closest("label")
          if (label && el.tagName === "INPUT") {
            const labelBox = label.getBoundingClientRect()
            if (labelBox.height >= 24 && labelBox.width >= 24) continue
          }

          if (box.height < 24 || box.width < 24) {
            out.push(`${el.tagName}.${el.className || "-"} ${box.width.toFixed(0)}x${box.height.toFixed(0)}`)
          }
        }
        return out
      })
      expect(small).toEqual([])
    })
  }
})

test.describe("reduced motion stops motion", () => {
  test("zeroes transition durations when chosen", async ({ page }) => {
    await signIn(page)
    await choose(page, "reducedMotion", "on")

    const moving = await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .map((el) => getComputedStyle(el).transitionDuration)
        .filter((d) => d && d !== "0s"),
    )
    expect(moving).toEqual([])
  })

  test("offers no way to switch it off, and honours the device", async ({ page }) => {
    // The floor, enforced in the UI as well as in the resolver: the control has
    // "Match device" and "Always on" and no third option, because
    // `prefers-reduced-motion` is commonly set for vestibular disorders and a
    // product where a stray click re-enables animation has turned a medical
    // accommodation into a preference.
    await page.emulateMedia({ reducedMotion: "reduce" })
    await signIn(page)
    await page.locator(".pref-trigger").click()
    // `toHaveCount` rather than `count()`: the panel is rendered only once
    // React has processed the toggle, and a bare `count()` does not retry — it
    // returned 0 and read as "the control is missing" rather than "not yet".
    await expect(page.locator('[name="reducedMotion"]')).toHaveCount(2)
    await expect(page.locator('[name="reducedMotion"][value="off"]')).toHaveCount(0)
    await page.locator('[name="reducedMotion"][value="system"]').check()

    expect(await attributesOf(page)).toMatchObject({ "data-motion": "reduced" })
    const moving = await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .map((el) => getComputedStyle(el).transitionDuration)
        .filter((d) => d && d !== "0s"),
    )
    expect(moving).toEqual([])
  })

  test("animates within the documented band when not reduced", async ({ page }) => {
    // Bible §26.3.7: 120-220 ms. Outside that band a transition is either
    // imperceptible or slow enough to read as lag.
    await signIn(page)
    const ms = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector(".pref-trigger")!).transitionDuration) * 1000,
    )
    expect(ms).toBeGreaterThanOrEqual(120)
    expect(ms).toBeLessThanOrEqual(220)
  })
})

/**
 * Eight combinations, because contrast is a property of the COMBINATION.
 * Increased contrast on dark is a different set of pairs from increased
 * contrast on light, and compact changes which elements sit against which
 * backgrounds.
 */
for (const theme of ["light", "dark"] as const) {
  for (const density of ["comfortable", "compact"] as const) {
    for (const contrast of ["system", "on"] as const) {
      test(`AA contrast holds: ${theme} + ${density} + contrast ${contrast}`, async ({ page }) => {
        await signIn(page)
        await choose(page, "colorScheme", theme)
        await choose(page, "density", density)
        await choose(page, "increasedContrast", contrast)
        await page.keyboard.press("Escape")

        for (const route of ["/", "/tenants", "/platform"]) {
          await page.goto(route)
          await page.waitForLoadState("networkidle")
          expect(await contrastFailures(page), route).toEqual([])
        }
      })
    }
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} uses neither pure black nor pure white`, async ({ page }) => {
    await signIn(page)
    await choose(page, "colorScheme", theme)

    const extremes = await page.evaluate(() => {
      const seen = new Set<string>()
      const all = [document.documentElement, document.body, ...Array.from(document.querySelectorAll("body *"))]
      for (const el of all) {
        const s = getComputedStyle(el)
        const parts = (s.backgroundColor.match(/rgba\(([^)]+)\)/)?.[1] ?? "").split(",").map((v) => parseFloat(v))
        if (!(parts.length === 4 && parts[3] === 0)) seen.add(s.backgroundColor)

        // Colours only where text is drawn: <html> has no colour rule, so its
        // computed colour is the user agent's default black — a false positive
        // that failed this test against a correct palette.
        const ownText = Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim(),
        )
        if (ownText) seen.add(s.color)
      }
      return [...seen].filter((c) => {
        const [r, g, b] = (c.match(/\d+/g) ?? []).slice(0, 3).map(Number)
        return (r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)
      })
    })
    expect(extremes).toEqual([])
  })
}
