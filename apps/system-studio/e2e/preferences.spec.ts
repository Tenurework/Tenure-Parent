import { test, expect, type Page } from "@playwright/test"
import { operatorFor } from "./operator-identity"

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
  // The click settles through a redirect chain that returns no HTML of its own,
  // so every locator after it would search an empty document — hence the goto.
  //
  // And the goto is retried until the SIGNED-IN shell is there, which is not
  // belt and braces. A `goto` issued while that chain is still in flight
  // resolves to wherever the chain lands, which is `/signin`: the session
  // cookie is set, the operator is signed in, and the page under the test is
  // the signed-out one. Measured on this harness, that happened on roughly half
  // of runs. Every test in this file then ran against a console with no rail,
  // no navigation and none of the surfaces it exists to measure — and passed,
  // because an audit of what is on screen cannot tell that the wrong thing is.
  await expect(async () => {
    await page.goto("/")
    await expect(page.locator('.console-shell[data-shell="console"]')).toBeAttached({
      timeout: 2_000,
    })
  }).toPass({ timeout: 30_000 })
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
    // `dir` is the fifth thing the pre-hydration script writes, and reading only
    // the four `data-*` attributes left it unchecked: `documentAttributes()`
    // returns a `dir` key, so every comparison below was against an object with
    // one more key than this collected, and all eight cases failed on the
    // absence rather than on a disagreement. Reading it is also the point —
    // direction has to be set before paint for the same reason theme does, or
    // an RTL operator gets a left-to-right flash on every load.
    dir: document.documentElement.getAttribute("dir"),
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
      // The server-rendered default, untouched: none of the four controls
      // exercised above sets a direction, so `dir` must still read "ltr". Worth
      // asserting rather than omitting — a preference write that clobbered the
      // document direction as a side effect is exactly the kind of thing this
      // test is positioned to catch.
      dir: "ltr",
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
          direction: "ltr",
          ...testCase.stored,
        },
        testCase.device,
      )
      // `documentAttributes` describes what the SCRIPT must write, not the DOM
      // that results: `dir: null` means "leave the server default alone", and
      // `layout.tsx:27` server-renders `<html lang="en" dir="ltr">`. So the
      // attribute read back is "ltr" in exactly the cases the module returns
      // null, and comparing the two directly asserted the script had erased an
      // attribute it is documented never to touch.
      expect(await attributesOf(page)).toEqual({ ...expected, dir: expected.dir ?? "ltr" })
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

/**
 * The extremes, measured on the rendered page — rewritten for the neutral family.
 *
 * ## What this replaces, and why the replacement is at least as strong
 *
 * The version before this one asserted the dark theme's base **was** `#000000`,
 * positively, because an OLED-black theme had been directed and a palette
 * drifting back to a charcoal was the failure worth catching.
 *
 * The product owner has since asked for the near-black neutral greys instead.
 * The assertion is therefore re-pointed, not loosened — it still pins an exact
 * value on the rendered page, it is simply a different one:
 *
 *   * **light** keeps the original rule in full — neither extreme, anywhere.
 *   * **dark** must be `rgb(33, 33, 33)` at the base and `rgb(23, 23, 23)` at the
 *     rail. Two values rather than one, because the family's page and its rail
 *     are different planes and a palette that collapses them renders a console
 *     with no sidebar — which every ratio in this file would happily allow.
 *   * **pure black is now forbidden as an opaque background too.** It was
 *     required before; it is banned now, and the alpha check is what keeps the
 *     scrim (`rgba(0, 0, 0, 0.72)`, which is a translucent film over the page and
 *     not a surface) out of the ban.
 *   * **pure white as a foreground is forbidden in both themes.** 21:1 is where
 *     halation and smearing between adjacent glyphs come from, and that is as
 *     true at #212121 as it was at #000.
 *   * **pure black as a foreground is forbidden in both themes**, unchanged.
 *   * the container ladder is measured on the live document: five tokens, four
 *     adjacent steps, each of which has to clear 1.12:1 or two panels smear into
 *     one another. Shadow carries elevation now that the base is grey and there
 *     are darker pixels to draw with — the ladder's job is separating adjacent
 *     PLANES, which no shadow does, so the floor is unchanged.
 *
 * Nothing was deleted. Two clauses got stricter (the base is two pinned values,
 * and black went from required to banned as a surface) and none got weaker.
 */

/** Backgrounds and text colours as the browser actually computed them. */
async function renderedExtremes(page: Page) {
  return page.evaluate(() => {
    const backgrounds = new Set<string>()
    const foregrounds = new Set<string>()
    const all = [document.documentElement, document.body, ...Array.from(document.querySelectorAll("body *"))]
    for (const el of all) {
      const s = getComputedStyle(el)
      const parts = (s.backgroundColor.match(/rgba\(([^)]+)\)/)?.[1] ?? "").split(",").map((v) => parseFloat(v))
      if (!(parts.length === 4 && parts[3] === 0)) backgrounds.add(s.backgroundColor)

      // Colours only where text is drawn: <html> has no colour rule, so its
      // computed colour is the user agent's default black — a false positive
      // that failed this test against a correct palette.
      const ownText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim(),
      )
      if (ownText) foregrounds.add(s.color)
    }
    const is = (c: string, v: number) => {
      const [r, g, b] = (c.match(/\d+/g) ?? []).slice(0, 3).map(Number)
      return r === v && g === v && b === v
    }
    // A surface, as opposed to a film drawn over one. `rgba(0, 0, 0, 0.72)` is
    // the scrim: it is a translucent dimming of the page behind a dialog, and
    // banning it as "a pure-black background" would ban the one thing in the
    // palette that is SUPPOSED to be pure black.
    const opaque = (c: string) => {
      const m = c.match(/rgba\(([^)]+)\)/)
      if (!m) return true
      const parts = m[1].split(",").map((v) => parseFloat(v))
      return !(parts.length === 4 && parts[3] < 1)
    }
    const rail = document.querySelector(".console-rail")
    return {
      blackBackgrounds: [...backgrounds].filter((c) => is(c, 0) && opaque(c)),
      whiteBackgrounds: [...backgrounds].filter((c) => is(c, 255)),
      blackForegrounds: [...foregrounds].filter((c) => is(c, 0)),
      whiteForegrounds: [...foregrounds].filter((c) => is(c, 255)),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      railBackground: rail ? getComputedStyle(rail).backgroundColor : null,
    }
  })
}

test("light uses neither pure black nor pure white", async ({ page }) => {
  await signIn(page)
  await choose(page, "colorScheme", "light")

  const seen = await renderedExtremes(page)
  expect(seen.blackBackgrounds).toEqual([])
  expect(seen.whiteBackgrounds).toEqual([])
  expect(seen.blackForegrounds).toEqual([])
  expect(seen.whiteForegrounds).toEqual([])
})

test("dark is the neutral family at the base, and neither extreme is a glyph", async ({ page }) => {
  await signIn(page)
  await choose(page, "colorScheme", "dark")

  // Wait, THEN measure. `renderedExtremes` is one `page.evaluate` — it samples
  // once and does not retry, so a rail that has not painted yet reads as a rail
  // that is not there, and the assertion below fails on a race rather than on a
  // palette. `toBeVisible` is the half that retries.
  await expect(page.locator(".console-rail")).toBeVisible()

  const seen = await renderedExtremes(page)
  // Positive, and on the two planes rather than one. A palette that drifted to
  // some other near-black would pass every ratio in this file and fail here;
  // so would one that painted the rail and the page the same colour.
  expect(seen.bodyBackground, "the dark theme's page is not #212121").toBe("rgb(33, 33, 33)")
  expect(seen.railBackground, "the rail is not the plane below the page (#171717)").toBe(
    "rgb(23, 23, 23)",
  )
  // Negative, and stricter than it was: pure black used to be REQUIRED as the
  // base and is now banned as any opaque surface. The scrim is exempt by alpha,
  // not by name.
  expect(seen.blackBackgrounds, "an opaque pure-black surface on a near-black theme").toEqual([])
  expect(seen.blackForegrounds, "pure black text on a dark theme").toEqual([])
  expect(seen.whiteForegrounds, "pure white text is the glare half of the clause").toEqual([])
  expect(seen.whiteBackgrounds).toEqual([])
})

test("the dark container ladder is visibly stepped on the rendered page", async ({ page }) => {
  // Shadow carries elevation now that the base is #212121 and there are darker
  // pixels to draw with. What a shadow cannot do is separate two adjacent
  // PLANES, so the ladder still has to be stepped and the floor is unchanged.
  // Measured on the live document rather than on the stylesheet, because a
  // token can be correct and still be overridden by a rule nobody remembered.
  await signIn(page)
  await choose(page, "colorScheme", "dark")

  const steps = await page.evaluate(() => {
    const names = [
      "--md-sys-color-surface-container-lowest",
      "--md-sys-color-surface-container-low",
      "--md-sys-color-surface-container",
      "--md-sys-color-surface-container-high",
      "--md-sys-color-surface-container-highest",
    ]
    const style = getComputedStyle(document.documentElement)
    const lum = (hex: string) => {
      const s = hex.trim().replace("#", "")
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
      const [R, G, B] = [r, g, b].map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * R + 0.7152 * G + 0.0722 * B
    }
    const values = names.map((n) => style.getPropertyValue(n).trim())
    return values.slice(1).map((value, i) => {
      const a = lum(value)
      const b = lum(values[i])
      const [hi, lo] = a > b ? [a, b] : [b, a]
      return { from: values[i], to: value, ratio: (hi + 0.05) / (lo + 0.05) }
    })
  })

  expect(steps.length, "the container tokens did not resolve on the rendered page").toBe(4)
  const flat = steps
    .filter((s) => s.ratio < 1.12)
    .map((s) => `${s.from} → ${s.to} = ${s.ratio.toFixed(3)}:1`)
  expect(flat, "two adjacent surfaces the operator cannot tell apart").toEqual([])
})
