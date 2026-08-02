/**
 * GE-022-008 — the viewer's own display preferences.
 *
 * Four of them, shared by a server component and a client one. Deliberately NOT
 * in the component: a non-component value exported from a `"use client"` module
 * does not survive being imported by a server component — Next replaces the
 * module's exports with client references, and the pre-paint script below
 * serialised to `localStorage.getItem(undefined)` when this lived there. Nothing
 * threw; every operator simply got the default regardless of their choice.
 *
 * ## The device wins on accessibility, and the user wins on taste
 *
 * Bible §26.5: "Settings follow the user across surfaces where safe and can be
 * overridden by device accessibility preferences."
 *
 * So the two are resolved differently, and the difference is the point:
 *
 *   * **Colour scheme and density are taste.** An explicit choice beats the
 *     machine, because a person who picked light on a dark-mode laptop meant it.
 *   * **Reduced motion and increased contrast are accessibility.** The operating
 *     system setting is a FLOOR, not a default: if the machine asks for reduced
 *     motion, motion is reduced even if this console's own toggle says otherwise.
 *     `prefers-reduced-motion` is commonly set for vestibular disorders, and a
 *     product that lets a stray click in its own settings re-enable animation has
 *     turned a medical accommodation into a preference.
 *
 * That asymmetry is enforced in `resolvePreferences` and asserted in the e2e.
 */

export type ColorScheme = "system" | "light" | "dark"
export type Density = "comfortable" | "compact"
/** `system` follows the machine. `on` forces it. `off` means "only if the machine asks". */
export type AccessibilityPreference = "system" | "on" | "off"

export interface Preferences {
  colorScheme: ColorScheme
  density: Density
  reducedMotion: AccessibilityPreference
  increasedContrast: AccessibilityPreference
}

export const DEFAULT_PREFERENCES: Preferences = {
  colorScheme: "system",
  density: "comfortable",
  reducedMotion: "system",
  increasedContrast: "system",
}

/** One key per preference, so a corrupt value for one does not lose the rest. */
export const STORAGE_KEYS = {
  colorScheme: "tenure-studio-theme",
  density: "tenure-studio-density",
  reducedMotion: "tenure-studio-reduced-motion",
  increasedContrast: "tenure-studio-increased-contrast",
} as const satisfies Record<keyof Preferences, string>

/**
 * What the document should actually be, given a stored preference and what the
 * machine says.
 *
 * Pure, and exported, so the asymmetry above is testable without a browser.
 * `deviceAsks` is what `matchMedia` reports.
 */
export function resolveAccessibility(
  preference: AccessibilityPreference,
  deviceAsks: boolean,
): boolean {
  // `on` forces it; otherwise the device decides. Note that "off" and "system"
  // behave identically when the device asks — that is the floor, and it is why
  // there is no way to express "never" in this type.
  return preference === "on" || deviceAsks
}

export function resolveColorScheme(preference: ColorScheme, deviceIsDark: boolean): boolean {
  return preference === "dark" || (preference === "system" && deviceIsDark)
}

/**
 * The attributes the stylesheet keys on, for a resolved set of preferences.
 *
 * A value of `null` means "remove the attribute": light, comfortable, full
 * motion and normal contrast are the CSS defaults, so there is exactly one
 * place a state can come from rather than two that can disagree.
 */
export function documentAttributes(
  preferences: Preferences,
  device: { dark: boolean; reducedMotion: boolean; increasedContrast: boolean },
): Record<string, string | null> {
  return {
    "data-theme": resolveColorScheme(preferences.colorScheme, device.dark) ? "dark" : null,
    "data-density": preferences.density === "compact" ? "compact" : null,
    "data-motion": resolveAccessibility(preferences.reducedMotion, device.reducedMotion)
      ? "reduced"
      : null,
    "data-contrast": resolveAccessibility(preferences.increasedContrast, device.increasedContrast)
      ? "more"
      : null,
  }
}

/**
 * The pre-paint script, as source.
 *
 * Runs before the browser paints, which React cannot do: the earliest it could
 * stamp these attributes is after hydration, and by then the default page is
 * already on screen. That gap is the flash — and for `data-density` it is worse
 * than a flash, because the whole layout reflows under the reader.
 *
 * Kept dependency-free and small because it is inlined and blocking. It
 * duplicates the resolution logic above rather than importing it, which is a
 * real cost: a bundled import cannot run before the bundle loads, and the bundle
 * loading is the thing being raced. `preferences.test.ts` runs the same cases
 * against both so the copies cannot drift silently.
 */
export const NO_FLASH_SCRIPT = `
(function () {
  try {
    var get = function (k, d) { var v = localStorage.getItem(k); return v === null ? d : v };
    var ask = function (q) { return matchMedia(q).matches };
    var el = document.documentElement;

    var scheme = get(${JSON.stringify(STORAGE_KEYS.colorScheme)}, "system");
    if (scheme === "dark" || (scheme === "system" && ask("(prefers-color-scheme: dark)"))) {
      el.setAttribute("data-theme", "dark");
    }

    if (get(${JSON.stringify(STORAGE_KEYS.density)}, "comfortable") === "compact") {
      el.setAttribute("data-density", "compact");
    }

    // The device is a floor for both of these, not a default. See the note above.
    if (get(${JSON.stringify(STORAGE_KEYS.reducedMotion)}, "system") === "on" ||
        ask("(prefers-reduced-motion: reduce)")) {
      el.setAttribute("data-motion", "reduced");
    }

    if (get(${JSON.stringify(STORAGE_KEYS.increasedContrast)}, "system") === "on" ||
        ask("(prefers-contrast: more)")) {
      el.setAttribute("data-contrast", "more");
    }
  } catch (e) {
    /* Private mode denies localStorage. Falling through leaves the defaults,
       which are a state nobody chose rather than a broken page. */
  }
})();
`
