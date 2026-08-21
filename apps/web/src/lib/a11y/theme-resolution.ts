/**
 * GE-143-013 — one answer to "which theme is in force", and one place it lives.
 *
 * The requirement: "Support `system`, explicit light, explicit dark, and
 * optional scheduled theme without wrong-theme flash; persist safely per
 * user/device and honor forced-colors/high-contrast platform behavior."
 *
 * Before this module the product had THREE implementations of that sentence and
 * no scheduled mode at all:
 *
 *   1. `src/app/layout.tsx` — a hand-written pre-hydration string, the only one
 *      that runs before first paint and therefore the only one that decides
 *      whether the reader sees a flash.
 *   2. `src/components/ThemeSwitcher.tsx` `apply()` — the same expression
 *      written again for the click path.
 *   3. the same component's `matchMedia` listener — a third copy of the
 *      "system means ask the OS" rule.
 *
 * Three copies of a boolean is how a fourth mode never gets added: adding it
 * anywhere but all three produces a setting that works until you reload. So the
 * rule is decided once, in `resolveTheme`, and the pre-hydration script is
 * `THEME_BOOT_SCRIPT` — a string this module owns. It cannot IMPORT the
 * function (it runs before any bundle exists), so `theme-resolution.test.ts`
 * evaluates the script against a fake document over the whole input matrix and
 * fails if it and `resolveTheme` ever disagree. That is the anti-drift device;
 * without it the string is copy number four.
 *
 * Three decisions worth stating, because each one is a place a reasonable
 * person would have chosen differently:
 *
 *   * **A malformed stored value is not a theme.** `parsePreference` narrows
 *     anything it does not recognise to `system`, and `parseSchedule` REFUSES a
 *     window it cannot read rather than inventing one. "Persist safely" means a
 *     corrupted `localStorage` entry — a half-written value, another product on
 *     the same origin, a user editing devtools — cannot produce a fourth,
 *     undefined state on <html>.
 *   * **A refusal says why.** `parseSchedule` returns a reason, not `null`.
 *     "There is no schedule stored" and "the stored schedule is unreadable" are
 *     different answers, and a settings screen that shows the second as the
 *     first tells the reader their configuration is missing when it is broken.
 *   * **Forced colors does not pick the theme; it suppresses our paint.** In
 *     Windows High Contrast the platform substitutes its own palette. Our
 *     light/dark choice still resolves normally (the UA scheme, scrollbars and
 *     `color-scheme` all still follow it) but `applyTheme` stamps
 *     `data-forced-colors="active"` so the `@media (forced-colors: active)`
 *     block in `globals.css` can drop the shadows, blurs and translucency the
 *     platform cannot recolour. Fighting the platform by forcing our own colours
 *     back is the failure mode the requirement names.
 *
 * DST: a scheduled window is wall-clock local time, which is what a person
 * means by "dark after 20:00". `minutesSinceMidnight` is therefore read from
 * `Date#getHours`/`getMinutes`, not from a UTC offset. On the two days a year
 * the clock jumps, "20:00" is still 20:00 on the wall; the window is one hour
 * shorter or longer in absolute time and that is the correct behaviour.
 */

/** The four preferences a reader may hold. */
export type ThemePreference = "light" | "dark" | "system" | "scheduled"

/** Where the decision came from, for disclosure in the UI and in tests. */
export type ThemeSource = "explicit" | "system" | "schedule"

/** A wall-clock window during which the dark theme is in force. */
export interface ThemeSchedule {
  /** Minutes since local midnight at which dark begins. 0–1439. */
  readonly darkFromMinute: number
  /** Minutes since local midnight at which dark ends. 0–1439. */
  readonly darkUntilMinute: number
}

/** What the browser can tell us at the moment of resolution. */
export interface ThemeEnvironment {
  /** `matchMedia("(prefers-color-scheme: dark)").matches` */
  readonly systemPrefersDark: boolean
  /** `matchMedia("(forced-colors: active)").matches` */
  readonly forcedColors: boolean
  /** Local wall-clock minutes since midnight, 0–1439. */
  readonly minutesSinceMidnight: number
}

export interface ResolvedTheme {
  readonly dark: boolean
  readonly source: ThemeSource
  readonly forcedColors: boolean
  /**
   * Set only when the stated preference could not be honoured — a `scheduled`
   * preference with no readable schedule. Absent means the preference was used
   * as given; it is never set to a placeholder.
   */
  readonly fallbackReason?: string
}

/** A schedule that parsed, or the reason it did not. */
export type ScheduleParse =
  | { readonly ok: true; readonly schedule: ThemeSchedule }
  | { readonly ok: false; readonly reason: string }

export const THEME_STORAGE_KEY = "tenure-theme"
export const THEME_SCHEDULE_STORAGE_KEY = "tenure-theme-schedule"

const PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system", "scheduled"]

/**
 * Narrows a stored value to a preference. Anything unrecognised — including
 * `null`, an empty string and a value written by something that is not this
 * product — is `system`, which is the only default that is correct on a device
 * we know nothing about.
 */
export function parsePreference(raw: string | null | undefined): ThemePreference {
  return PREFERENCES.includes(raw as ThemePreference) ? (raw as ThemePreference) : "system"
}

/** `"HH:MM"` → minutes since midnight, or `null` if it is not a wall-clock time. */
function parseClock(text: string): number | null {
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(text)
  if (!m) return null
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Reads `"20:00-06:30"`.
 *
 * A window whose ends are equal is REFUSED rather than interpreted: it could
 * mean "always dark" or "never dark" and there is no way to tell which the
 * person meant, so accepting it would silently choose one.
 */
export function parseSchedule(raw: string | null | undefined): ScheduleParse {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: false, reason: "no schedule is stored" }
  }
  const parts = raw.split("-")
  if (parts.length !== 2) {
    return { ok: false, reason: `expected "HH:MM-HH:MM", read ${JSON.stringify(raw)}` }
  }
  const from = parseClock(parts[0].trim())
  const until = parseClock(parts[1].trim())
  if (from === null || until === null) {
    return { ok: false, reason: `expected "HH:MM-HH:MM", read ${JSON.stringify(raw)}` }
  }
  if (from === until) {
    return {
      ok: false,
      reason: `a window that starts and ends at ${parts[0].trim()} is neither always nor never`,
    }
  }
  return { ok: true, schedule: { darkFromMinute: from, darkUntilMinute: until } }
}

/** Renders a schedule back to the form `parseSchedule` reads. */
export function formatSchedule(schedule: ThemeSchedule): string {
  const clock = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
  return `${clock(schedule.darkFromMinute)}-${clock(schedule.darkUntilMinute)}`
}

/**
 * Is the given wall-clock minute inside the dark window?
 *
 * The window is half-open, `[from, until)`, and wraps midnight when
 * `from > until` — which is the ordinary case, because the reason to schedule a
 * dark theme is the evening.
 */
export function scheduleSaysDark(schedule: ThemeSchedule, minutesSinceMidnight: number): boolean {
  const { darkFromMinute: from, darkUntilMinute: until } = schedule
  return from < until
    ? minutesSinceMidnight >= from && minutesSinceMidnight < until
    : minutesSinceMidnight >= from || minutesSinceMidnight < until
}

/**
 * The one decision. Everything else in the product asks this.
 */
export function resolveTheme(
  preference: ThemePreference,
  environment: ThemeEnvironment,
  schedule: ThemeSchedule | null,
): ResolvedTheme {
  const forcedColors = environment.forcedColors
  if (preference === "light") return { dark: false, source: "explicit", forcedColors }
  if (preference === "dark") return { dark: true, source: "explicit", forcedColors }
  if (preference === "scheduled") {
    if (schedule) {
      return {
        dark: scheduleSaysDark(schedule, environment.minutesSinceMidnight),
        source: "schedule",
        forcedColors,
      }
    }
    return {
      dark: environment.systemPrefersDark,
      source: "system",
      forcedColors,
      fallbackReason: "a scheduled theme was chosen but no readable schedule is stored",
    }
  }
  return { dark: environment.systemPrefersDark, source: "system", forcedColors }
}

/** The three attributes `<html>` carries. Named so the tests cannot drift. */
export const DARK_CLASS = "dark"
export const THEME_SOURCE_ATTRIBUTE = "data-theme-source"
export const FORCED_COLORS_ATTRIBUTE = "data-forced-colors"

/**
 * Stamps a resolution onto the document element.
 *
 * `data-theme-source` is written even for the ordinary case so the DOM states
 * which rule produced the current appearance rather than leaving it implicit —
 * the same reason `data-density` is always written.
 */
export function applyTheme(root: Element, resolved: ResolvedTheme): void {
  root.classList.toggle(DARK_CLASS, resolved.dark)
  root.setAttribute(THEME_SOURCE_ATTRIBUTE, resolved.source)
  if (resolved.forcedColors) root.setAttribute(FORCED_COLORS_ATTRIBUTE, "active")
  else root.removeAttribute(FORCED_COLORS_ATTRIBUTE)
}

/** Reads the environment out of a live browser. */
export function readEnvironment(win: Window): ThemeEnvironment {
  const now = new Date()
  return {
    systemPrefersDark: win.matchMedia("(prefers-color-scheme: dark)").matches,
    forcedColors: win.matchMedia("(forced-colors: active)").matches,
    minutesSinceMidnight: now.getHours() * 60 + now.getMinutes(),
  }
}

/**
 * Resolves and applies from live browser state. The click path and the
 * OS-change listener both go through here, so neither can hold its own copy of
 * the rule.
 */
export function applyStoredTheme(win: Window): ResolvedTheme {
  let preference: ThemePreference = "system"
  let parsed: ScheduleParse = { ok: false, reason: "no schedule is stored" }
  try {
    preference = parsePreference(win.localStorage.getItem(THEME_STORAGE_KEY))
    parsed = parseSchedule(win.localStorage.getItem(THEME_SCHEDULE_STORAGE_KEY))
  } catch {
    // A blocked or full localStorage is a device condition, not a preference.
    // Falling through with `system` is the same answer a first visit gets.
  }
  const resolved = resolveTheme(preference, readEnvironment(win), parsed.ok ? parsed.schedule : null)
  applyTheme(win.document.documentElement, resolved)
  return resolved
}

/**
 * The pre-hydration script.
 *
 * It runs in `<head>` before first paint, which is the whole point: resolving
 * the theme after hydration paints the wrong one first and then corrects it,
 * and that correction is the flash the requirement forbids.
 *
 * It also carries the nav and density stamps, unchanged, because they are the
 * other two things that must be right before first paint and a second inline
 * script would be a second blocking parse for no gain.
 *
 * Written as a string rather than compiled from `resolveTheme` because there is
 * no bundle yet when it runs. `theme-resolution.test.ts` evaluates it against a
 * fake document across the full matrix and asserts it agrees with
 * `resolveTheme` and `applyTheme` exactly, so the duplication is checked rather
 * than trusted.
 */
export const THEME_BOOT_SCRIPT = [
  "(function(){try{",
  'var s=localStorage.getItem("' + THEME_STORAGE_KEY + '");',
  'var t=(s==="light"||s==="dark"||s==="system"||s==="scheduled")?s:"system";',
  'var q=function(m){return window.matchMedia(m).matches};',
  'var sd=q("(prefers-color-scheme: dark)");',
  'var fc=q("(forced-colors: active)");',
  'var d=sd,src="system";',
  'if(t==="light"){d=false;src="explicit"}',
  'else if(t==="dark"){d=true;src="explicit"}',
  'else if(t==="scheduled"){',
  'var w=localStorage.getItem("' + THEME_SCHEDULE_STORAGE_KEY + '")||"";',
  'var p=w.split("-");var a=null,b=null;',
  'if(p.length===2){',
  'var r=/^([0-9]{1,2}):([0-9]{2})$/;',
  'var ma=r.exec(p[0].trim()),mb=r.exec(p[1].trim());',
  'if(ma&&+ma[1]<24&&+ma[2]<60)a=+ma[1]*60+ +ma[2];',
  'if(mb&&+mb[1]<24&&+mb[2]<60)b=+mb[1]*60+ +mb[2];',
  '}',
  'if(a!==null&&b!==null&&a!==b){',
  'var n=new Date();var mm=n.getHours()*60+n.getMinutes();',
  'd=(a<b)?(mm>=a&&mm<b):(mm>=a||mm<b);src="schedule"',
  '}}',
  'var e=document.documentElement;',
  'e.classList.toggle("' + DARK_CLASS + '",d);',
  'e.setAttribute("' + THEME_SOURCE_ATTRIBUTE + '",src);',
  'if(fc)e.setAttribute("' + FORCED_COLORS_ATTRIBUTE + '","active");',
  'else e.removeAttribute("' + FORCED_COLORS_ATTRIBUTE + '");',
  'var nv=localStorage.getItem("tenure-nav");',
  'e.classList.toggle("nav-collapsed",nv==="collapsed");',
  'var dy=localStorage.getItem("tenure-density");',
  'e.setAttribute("data-density",dy==="compact"?"compact":"comfortable");',
  "}catch(err){}})()",
].join("")
