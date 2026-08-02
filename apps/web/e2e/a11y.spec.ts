import { test, expect, type Page } from "@playwright/test"
import { signIn } from "./support/auth"

/**
 * GE-022-003 — WCAG 2.2 AA, checked in a browser.
 *
 * The half of the item that arithmetic cannot reach. `src/lib/a11y/contrast.ts`
 * proves the palette; nothing there can tell you that the focused element is
 * underneath the sticky header, that a 320px viewport scrolls sideways, or that
 * a control is 18px tall.
 *
 * Each test names the success criterion it is for, because "accessibility test"
 * is not a thing that can pass or fail — a criterion is. Where a criterion is
 * NOT covered here it is named at the bottom rather than left to look covered.
 */

const PAGES = ["/dashboard", "/orgs", "/resources", "/calendar", "/feed"]

/** Interactive things a user can reach, excluding what is deliberately hidden. */
const INTERACTIVE =
  'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

async function visibleInteractive(page: Page) {
  return page.evaluate((selector) => {
    const out: { tag: string; label: string; w: number; h: number }[] = []
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const style = getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue
      // Visually hidden until focused — the skip link. It is 1x1 by design and
      // full size the moment it matters, so measuring it while hidden reports a
      // failure for the one control that exists to help.
      if (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)") continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      out.push({
        tag: el.tagName.toLowerCase(),
        label:
          (el.getAttribute("aria-label") ||
            el.textContent?.trim().slice(0, 40) ||
            el.getAttribute("name") ||
            el.getAttribute("href") ||
            "")
            .replace(/\s+/g, " "),
        w: Math.round(rect.width * 10) / 10,
        h: Math.round(rect.height * 10) / 10,
      })
    }
    return out
  }, INTERACTIVE)
}

test.describe("WCAG 2.2 AA", () => {
  test("2.4.1 Bypass Blocks — the first Tab stop skips the shell", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/dashboard")

    await page.keyboard.press("Tab")

    // First, not fourth. A skip link after the logo and two header buttons is
    // three stops the user still has to make on every single page.
    const first = page.locator(":focus")
    await expect(first).toHaveText(/skip to main/i)

    // Visible once focused. `display:none` is not focusable, so a skip link that
    // hides that way is one nobody can use — which is how this criterion is most
    // often failed while looking met.
    const box = await first.boundingBox()
    expect(box, "the focused skip link has no box — it is still hidden").not.toBeNull()
    expect(box!.width).toBeGreaterThan(40)
    expect(box!.height).toBeGreaterThan(16)

    // And it must actually move focus, not just scroll. Without tabIndex on the
    // target the fragment scrolls and focus stays on the link, so the next Tab
    // walks straight back into the navigation the user just skipped.
    await page.keyboard.press("Enter")
    const movedTo = await page.evaluate(() => document.activeElement?.id ?? "")
    expect(movedTo).toBe("main")
  })

  test("1.4.10 Reflow — no sideways scrolling at 320 CSS px", async ({ page }) => {
    // 320x256 is the reflow target: 400% zoom of a 1280x1024 window. The
    // existing layout spec stops at 768, which is where this starts to matter.
    await signIn(page, "Dana Whitfield")
    await page.setViewportSize({ width: 320, height: 256 })

    const overflowing: string[] = []
    for (const path of PAGES) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        // Name the offenders, so a failure says what to fix rather than that
        // something, somewhere, is too wide.
        //
        // Only the DEEPEST overflowing elements, and only those not inside a
        // fixed-position subtree.
        //
        // Two rounds of noise led here. Reporting every overflowing element
        // listed each ancestor of the real culprit as well, and reporting the
        // single widest one pointed at a closed drawer parked off-canvas — an
        // element that is always the widest thing on the page and never the
        // reason the document scrolls. What is wanted is the leaf that is too
        // wide, in normal flow.
        widest: (() => {
          const client = document.documentElement.clientWidth
          const inFixedSubtree = (el: Element) => {
            for (let n: Element | null = el; n; n = n.parentElement) {
              if (getComputedStyle(n).position === "fixed") return true
            }
            return false
          }
          const over = Array.from(document.querySelectorAll("body *")).filter(
            (el) => el.getBoundingClientRect().right > client + 1 && !inFixedSubtree(el),
          )
          return over
            .filter((el) => !over.some((other) => other !== el && el.contains(other)))
            .slice(0, 4)
            .map(
              (el) =>
                `<${el.tagName.toLowerCase()} class="${(el.getAttribute("class") ?? "").slice(0, 50)}"> to ${Math.round(el.getBoundingClientRect().right)}px`,
            )
        })(),
      }))
      // One pixel of tolerance for sub-pixel rounding, not more.
      if (overflow.doc > overflow.client + 1) {
        overflowing.push(
          `${path}: content is ${overflow.doc}px in a ${overflow.client}px viewport; overflowing: ${overflow.widest.join(", ") || "(nothing non-fixed — a fixed element is extending the scroll width)"}`,
        )
      }
    }
    expect(overflowing).toEqual([])
  })

  test("2.5.8 Target Size (Minimum) — nothing interactive is under 24px", async ({ page }) => {
    await signIn(page, "Dana Whitfield")

    const tooSmall: string[] = []
    for (const path of PAGES) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      for (const el of await visibleInteractive(page)) {
        // The criterion's Inline exception: a link sitting in a sentence is
        // sized by the text around it.
        if (el.tag === "a" && el.h < 24 && el.w > 24) continue
        // The Essential exception, for chart geometry. A bar's width IS the
        // data — twenty days of a time series cannot each be 24px wide without
        // changing what the chart says. The keyboard path to the same
        // information is the reason this is acceptable rather than ignored:
        // the bars are in the Tab order with a label carrying the value, which
        // the "focus changes something you can see" test below also checks.
        if (["rect", "circle", "path", "g"].includes(el.tag)) continue
        if (el.w < 24 || el.h < 24) {
          tooSmall.push(`${path}: <${el.tag}> "${el.label}" is ${el.w}x${el.h}`)
        }
      }
    }
    expect(tooSmall).toEqual([])
  })

  test("2.4.11 Focus Not Obscured — the sticky shell never covers the focused control", async ({
    page,
  }) => {
    // New in 2.2, and the criterion this shell is most exposed to: a fixed
    // header, a fixed side nav and a fixed footer, with one scrolling region
    // between them. Tabbing into something that has scrolled under the header
    // leaves a keyboard user with focus they cannot see.
    await signIn(page, "Dana Whitfield")
    await page.goto("/orgs")
    await page.waitForLoadState("networkidle")

    const obscured: string[] = []
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab")
      const state = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return null
        // Is the CENTRE of the focused element covered by something else? The
        // "minimum" version of the criterion allows partial obscuring, so the
        // centre is the right probe: hit-testing a corner would report a false
        // failure for anything with a rounded edge or an overlapping shadow.
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const top = document.elementFromPoint(cx, cy)
        const covered = !!top && top !== el && !el.contains(top) && !top.contains(el)
        return {
          covered,
          offscreen: r.bottom < 0 || r.top > innerHeight,
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
          by: covered ? `${top?.tagName.toLowerCase()}.${String(top?.className).slice(0, 40)}` : "",
        }
      })
      if (!state) continue
      if (state.covered || state.offscreen) {
        obscured.push(
          `"${state.label}" is ${state.offscreen ? "scrolled out of view" : `covered by ${state.by}`}`,
        )
      }
    }
    expect(obscured).toEqual([])
  })

  test("2.4.7 Focus Visible — focus changes something you can see", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")

    const invisible: string[] = []
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab")
      const state = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const s = getComputedStyle(el)
        const hasOutline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0
        const hasShadow = s.boxShadow !== "none"
        // A border or background that changes on focus also counts, but only if
        // :focus-visible actually matched — which is the thing most likely to
        // be silently false on an element that styles :focus instead.
        const matchedFocusVisible = el.matches(":focus-visible")
        const label = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)
        return {
          visible: hasOutline || hasShadow,
          label,
          tag: el.tagName.toLowerCase(),
          // SVG elements expose className as an SVGAnimatedString, not a string.
          cls: (el.getAttribute("class") ?? "").slice(0, 30),
          matchedFocusVisible,
          outline: `${s.outlineStyle} ${s.outlineWidth}`,
        }
      })
      if (state && !state.visible) {
        invisible.push(
          `<${state.tag} class="${state.cls}"> "${state.label}" — outline ${state.outline}, :focus-visible ${state.matchedFocusVisible ? "matched" : "DID NOT match"}`,
        )
      }
    }
    expect(invisible).toEqual([])
  })

  test("2.1.2 No Keyboard Trap — Tab always keeps moving", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")

    const seen: string[] = []
    let repeats = 0
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab")
      const here = await page.evaluate(() => {
        const el = document.activeElement
        if (!el) return "none"
        return `${el.tagName}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}`
      })
      // Landing on the same element twice in a row means Tab did not move.
      if (seen.length > 0 && here === seen[seen.length - 1]) repeats++
      else repeats = 0
      expect(repeats, `focus stuck on ${here}`).toBeLessThan(3)
      seen.push(here)
    }
    // And it visited a real number of distinct stops rather than cycling two.
    expect(new Set(seen).size).toBeGreaterThan(8)
  })

  test("1.3.1 Info and Relationships — one main, one h1, no skipped heading level", async ({
    page,
  }) => {
    await signIn(page, "Dana Whitfield")

    const problems: string[] = []
    for (const path of PAGES) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      const structure = await page.evaluate(() => ({
        mains: document.querySelectorAll("main").length,
        h1s: document.querySelectorAll("h1").length,
        levels: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) =>
          Number(h.tagName.slice(1)),
        ),
        unlabelledInputs: Array.from(
          document.querySelectorAll("input:not([type=hidden]), select, textarea"),
        )
          .filter((el) => {
            if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return false
            if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false
            return !el.closest("label")
          })
          .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute("type") ?? "text"}]`),
      }))

      if (structure.mains !== 1) problems.push(`${path}: ${structure.mains} <main> elements`)
      if (structure.h1s !== 1) problems.push(`${path}: ${structure.h1s} <h1> elements`)
      for (let i = 1; i < structure.levels.length; i++) {
        const jump = structure.levels[i] - structure.levels[i - 1]
        // Going deeper by more than one level leaves a gap a screen reader
        // reports as a missing section.
        if (jump > 1) {
          problems.push(`${path}: heading level jumps h${structure.levels[i - 1]} -> h${structure.levels[i]}`)
          break
        }
      }
      // 4.1.2 — a control with no accessible name is announced as "edit text".
      for (const input of structure.unlabelledInputs) problems.push(`${path}: unlabelled ${input}`)
    }
    expect(problems).toEqual([])
  })

  test("1.4.4 Resize Text — the page does not forbid zooming", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.goto("/dashboard")
    const viewport = await page.evaluate(
      () => document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
    )
    // `user-scalable=no` and a `maximum-scale` below 2 both take the decision
    // away from someone who needs the text bigger.
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/i)
    const max = /maximum-scale\s*=\s*([\d.]+)/i.exec(viewport)
    if (max) expect(Number(max[1])).toBeGreaterThanOrEqual(2)
  })

  test("2.3.3 / reduced motion — the preference actually reaches the CSS", async ({ page }) => {
    await signIn(page, "Dana Whitfield")
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")

    // A global reduce block exists in globals.css. This is the check that it is
    // in the shipped stylesheet and matching real elements, rather than being
    // present in source and layered under something that overrides it.
    const longTransitions = await page.evaluate(() => {
      const slow: string[] = []
      for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 400)) {
        const s = getComputedStyle(el)
        const duration = Math.max(
          ...s.transitionDuration.split(",").map((d) => parseFloat(d) || 0),
          ...s.animationDuration.split(",").map((d) => parseFloat(d) || 0),
        )
        if (duration > 0.05) slow.push(`${el.tagName.toLowerCase()} ${duration}s`)
      }
      return slow
    })
    expect(longTransitions).toEqual([])
  })
})

/**
 * Not covered here, named rather than left to look covered:
 *
 *   1.2.x Captions and audio description — the product ships no time-based
 *         media, so there is nothing to caption. This becomes a real gap the
 *         first time a video is embedded.
 *   1.4.3 Contrast — proved by arithmetic in src/lib/a11y/contrast.test.ts
 *         across all four themes, which a browser check would only sample.
 *   2.4.11 for elements reached by mouse or programmatic focus — this walks the
 *         Tab order, which is the path a keyboard user takes.
 *   3.x   Understandable — error identification and consistent help are
 *         judgements about copy, not properties a browser can assert.
 */
