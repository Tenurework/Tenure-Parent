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

/**
 * STUDIO-030-007 — which way the layout runs.
 *
 * "RTL readiness" is a property of the stylesheet, not of a translation:
 * `globals.css` holds zero physical-direction declarations, so setting this
 * mirrors the layout instead of breaking it. It is a preference rather than a
 * locale because there is no locale negotiation in this console and inventing
 * one to prove a CSS property would be a feature nobody asked for — what an
 * operator (and `layout.spec.ts`) needs is the ability to SET it.
 */
export type TextDirection = "ltr" | "rtl"

export interface Preferences {
  colorScheme: ColorScheme
  density: Density
  reducedMotion: AccessibilityPreference
  increasedContrast: AccessibilityPreference
  direction: TextDirection
}

export const DEFAULT_PREFERENCES: Preferences = {
  colorScheme: "system",
  density: "comfortable",
  reducedMotion: "system",
  increasedContrast: "system",
  direction: "ltr",
}

/** One key per preference, so a corrupt value for one does not lose the rest. */
export const STORAGE_KEYS = {
  colorScheme: "tenure-studio-theme",
  density: "tenure-studio-density",
  reducedMotion: "tenure-studio-reduced-motion",
  increasedContrast: "tenure-studio-increased-contrast",
  direction: "tenure-studio-direction",
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
 * STUDIO-030-005 — "persist only as operator preference".
 *
 * The second clause of the density item, and it is a constraint on WHERE a
 * choice may be written, not only on which control writes it. Density is one
 * operator's eyesight and one operator's screen: it is not a property of the
 * tenant, so it may not reach the tenant registry, a manifest, an audit entry
 * or any other server-side record. `localStorage`, on the operator's own
 * device, is the whole of the store — there is deliberately no cookie, because
 * a cookie is sent to the server on every request and would put the preference
 * in the one place this clause forbids.
 *
 * Which makes the store fallible, and it has to be treated as such:
 *
 *   * Reading `window.localStorage` THROWS — it does not return null — when the
 *     browser is blocking site data (Safari private browsing, and Chrome with
 *     "Block third-party cookies" on a site the operator has denied). The
 *     pre-paint script has always caught that; `PreferencesMenu` had no guard,
 *     so on such a browser its mount effect threw, and an exception thrown from
 *     an effect unmounts the tree that contains it. The masthead renders
 *     `<PreferencesMenu />` on EVERY route, so the failure was not a lost
 *     preference — it was the console.
 *   * A write can fail on its own (quota, or a store that is readable and not
 *     writable). Failing to remember a preference must cost the preference and
 *     nothing else, so `writePreference` reports it rather than throwing, and
 *     the menu says so.
 *
 * These take the store as an argument so both outcomes are testable without a
 * browser that can be persuaded to deny one.
 */
export interface PreferenceStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Never read. Only used to prove the store answers before it is trusted. */
const STORE_PROBE_KEY = "tenure-studio-storage-probe"

/**
 * The operator's own store, or `null` when this browser will not give one up.
 *
 * `host` is the window by default and an argument for the tests: a store can
 * fail at the property access (a throwing getter) or at first use, and both
 * have to end as `null` rather than as an exception.
 */
export function preferenceStore(
  host: { localStorage?: PreferenceStore } = globalThis as { localStorage?: PreferenceStore },
): PreferenceStore | null {
  try {
    const store = host.localStorage
    if (!store) return null
    // A read, not a write: probing with `setItem` would leave a key behind on
    // every load, and the failure being guarded against here is access itself.
    store.getItem(STORE_PROBE_KEY)
    return store
  } catch {
    return null
  }
}

/**
 * A stored preference, if it is one of the values this console accepts.
 *
 * An unknown value is the default rather than an error: the keys are readable
 * and editable by anyone with devtools, and a typo there must not be able to
 * put the document into a state the stylesheet has no rules for.
 */
export function readPreference<T extends string>(
  store: PreferenceStore | null,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!store) return fallback
  try {
    const value = store.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

/** Whether the choice will survive the tab. `false` is a fact for the operator, not an error. */
export function writePreference(
  store: PreferenceStore | null,
  key: string,
  value: string,
): boolean {
  if (!store) return false
  try {
    store.setItem(key, value)
    return true
  } catch {
    return false
  }
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
    // `dir` is a real HTML attribute rather than a data- hook, because it is
    // what the layout engine keys on: `margin-inline-start` means nothing
    // without it. `ltr` is the server-rendered default and the script only ever
    // writes `rtl`, so there is one place a direction can come from.
    dir: preferences.direction === "rtl" ? "rtl" : null,
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

    // STUDIO-030-007. Before the first paint, like the rest: flipping direction
    // after hydration would reflow the entire page under the reader, which is
    // worse than a colour flash.
    if (get(${JSON.stringify(STORAGE_KEYS.direction)}, "ltr") === "rtl") {
      el.setAttribute("dir", "rtl");
    }
  } catch (e) {
    /* Private mode denies localStorage. Falling through leaves the defaults,
       which are a state nobody chose rather than a broken page. */
  }
})();
`
