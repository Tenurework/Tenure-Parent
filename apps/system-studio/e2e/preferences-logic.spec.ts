import { test, expect } from "@playwright/test"

import {
  DEFAULT_PREFERENCES,
  documentAttributes,
  resolveAccessibility,
  resolveColorScheme,
  type Preferences,
} from "../src/lib/preferences"

/**
 * GE-022-008 — the resolution rules, with no browser.
 *
 * These use Playwright as a plain test runner because they need no page. The
 * Studio has no unit-test toolchain, and adding jest for four pure functions
 * would mean a second transform, a second config and a second thing to keep in
 * step with `tsconfig.json` — a worse trade than an unusual home for a fast
 * test. The browser tests in `preferences.spec.ts` cover what a page is needed
 * for, which is everything that can be broken by CSS.
 */

const device = (over: Partial<{ dark: boolean; reducedMotion: boolean; increasedContrast: boolean }> = {}) => ({
  dark: false,
  reducedMotion: false,
  increasedContrast: false,
  ...over,
})

test.describe("accessibility preferences: the device is a floor, not a default", () => {
  // This is the load-bearing rule of the whole item. Bible §26.5 says settings
  // "can be overridden by device accessibility preferences" — so a person whose
  // operating system asks for reduced motion gets it whatever this console's
  // own control says. `prefers-reduced-motion` is commonly set for vestibular
  // disorders, and a product where a stray click re-enables animation has
  // turned a medical accommodation into a preference.

  test("the device asking is enough, whatever the stored value", () => {
    for (const stored of ["system", "on", "off"] as const) {
      expect(resolveAccessibility(stored, true)).toBe(true)
    }
  })

  test("the user asking is enough, whatever the device says", () => {
    expect(resolveAccessibility("on", false)).toBe(true)
  })

  test("off and system are the same when the device is silent", () => {
    // Both mean "no". They are distinct values so the UI can show which of the
    // two a person chose, not so they can resolve differently.
    expect(resolveAccessibility("off", false)).toBe(false)
    expect(resolveAccessibility("system", false)).toBe(false)
  })

  test("there is no way to express 'never'", () => {
    // If some future value could suppress a device request, this rule stops
    // being a floor. The type has three values and none of them can.
    const everyOutcomeWhenDeviceAsks = (["system", "on", "off"] as const).map((p) =>
      resolveAccessibility(p, true),
    )
    expect(everyOutcomeWhenDeviceAsks).toEqual([true, true, true])
  })
})

test.describe("colour scheme is taste: an explicit choice beats the machine", () => {
  test("light on a dark machine stays light", () => {
    // The asymmetry with the rule above, and it is deliberate. A person who
    // picked light on a dark-mode laptop meant it; nobody's health depends on
    // the outcome.
    expect(resolveColorScheme("light", true)).toBe(false)
  })

  test("dark on a light machine stays dark", () => {
    expect(resolveColorScheme("dark", false)).toBe(true)
  })

  test("system follows the machine both ways", () => {
    expect(resolveColorScheme("system", true)).toBe(true)
    expect(resolveColorScheme("system", false)).toBe(false)
  })
})

test.describe("document attributes", () => {
  test("defaults set nothing at all", () => {
    // Light, comfortable, full motion and normal contrast are the CSS defaults,
    // so there is exactly one place each state can come from. An attribute
    // spelling out the default would be a second source to disagree with it.
    expect(documentAttributes(DEFAULT_PREFERENCES, device())).toEqual({
      "data-theme": null,
      "data-density": null,
      "data-motion": null,
      "data-contrast": null,
    })
  })

  test("a silent device plus explicit choices sets all four", () => {
    const chosen: Preferences = {
      colorScheme: "dark",
      density: "compact",
      reducedMotion: "on",
      increasedContrast: "on",
    }
    expect(documentAttributes(chosen, device())).toEqual({
      "data-theme": "dark",
      "data-density": "compact",
      "data-motion": "reduced",
      "data-contrast": "more",
    })
  })

  test("a device asking for accessibility sets those two from defaults alone", () => {
    expect(
      documentAttributes(DEFAULT_PREFERENCES, device({ reducedMotion: true, increasedContrast: true })),
    ).toMatchObject({ "data-motion": "reduced", "data-contrast": "more" })
  })

  test("density never follows the device, because no device reports one", () => {
    // Guards against someone later wiring density to a media query that does
    // not mean what it looks like.
    expect(
      documentAttributes(DEFAULT_PREFERENCES, device({ dark: true, reducedMotion: true, increasedContrast: true }))[
        "data-density"
      ],
    ).toBeNull()
  })
})
