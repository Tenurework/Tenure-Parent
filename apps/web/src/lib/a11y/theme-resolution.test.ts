/**
 * GE-143-013 — the theme rule, and the proof there is only one of it.
 *
 * Four groups here, and the third is the one that matters:
 *
 *   1. the parsers, including what they REFUSE and the reason they give;
 *   2. `resolveTheme` over every preference, including the scheduled window
 *      that wraps midnight;
 *   3. **script equivalence** — `THEME_BOOT_SCRIPT` evaluated against a fake
 *      document over a 240-case matrix, compared against `resolveTheme` +
 *      `applyTheme`. The pre-hydration script cannot import the function, so
 *      this is the only thing standing between "one rule" and "two rules that
 *      agree today";
 *   4. call-site scans — nothing else in the product may hold its own copy.
 */
import fs from "node:fs"
import path from "node:path"

import {
  DARK_CLASS,
  FORCED_COLORS_ATTRIBUTE,
  THEME_BOOT_SCRIPT,
  THEME_SCHEDULE_STORAGE_KEY,
  THEME_SOURCE_ATTRIBUTE,
  THEME_STORAGE_KEY,
  applyTheme,
  formatSchedule,
  parsePreference,
  parseSchedule,
  resolveTheme,
  scheduleSaysDark,
  type ThemePreference,
} from "./theme-resolution"

const WEB_SRC = path.join(__dirname, "..", "..")
const read = (rel: string) => fs.readFileSync(path.join(WEB_SRC, rel), "utf8")

describe("parsePreference", () => {
  it("accepts the four real preferences", () => {
    for (const p of ["light", "dark", "system", "scheduled"] as ThemePreference[]) {
      expect(parsePreference(p)).toBe(p)
    }
  })

  it("narrows anything else to system rather than inventing a fourth state", () => {
    // A half-written localStorage value, another product on the same origin, a
    // devtools edit. None of them may reach <html>.
    for (const raw of [null, undefined, "", "Dark", "midnight", "true", "0"]) {
      expect(parsePreference(raw)).toBe("system")
    }
  })
})

describe("parseSchedule", () => {
  it("reads a wall-clock window", () => {
    const parsed = parseSchedule("20:00-06:30")
    expect(parsed).toEqual({ ok: true, schedule: { darkFromMinute: 1200, darkUntilMinute: 390 } })
  })

  it("distinguishes nothing stored from something unreadable", () => {
    // The bug this exists to prevent: a settings screen telling a reader their
    // schedule is missing when in fact it is corrupt.
    const absent = parseSchedule(null)
    expect(absent.ok).toBe(false)
    expect(absent.ok === false && absent.reason).toBe("no schedule is stored")

    const broken = parseSchedule("20h-6h")
    expect(broken.ok).toBe(false)
    expect(broken.ok === false && broken.reason).toContain("expected \"HH:MM-HH:MM\"")
  })

  it("refuses out-of-range clock values", () => {
    for (const raw of ["24:00-06:00", "20:60-06:00", "20:00-06:99"]) {
      expect(parseSchedule(raw).ok).toBe(false)
    }
  })

  it("refuses a window whose ends are equal instead of guessing which one was meant", () => {
    const parsed = parseSchedule("20:00-20:00")
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.reason).toContain("neither always nor never")
  })

  it("round-trips through formatSchedule", () => {
    for (const raw of ["20:00-06:30", "00:00-12:00", "07:15-23:45"]) {
      const parsed = parseSchedule(raw)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(formatSchedule(parsed.schedule)).toBe(raw)
    }
  })
})

describe("scheduleSaysDark", () => {
  const evening = { darkFromMinute: 20 * 60, darkUntilMinute: 6 * 60 + 30 }

  it("wraps midnight, which is the only reason anyone schedules a theme", () => {
    expect(scheduleSaysDark(evening, 19 * 60 + 59)).toBe(false)
    expect(scheduleSaysDark(evening, 20 * 60)).toBe(true)
    expect(scheduleSaysDark(evening, 3 * 60)).toBe(true)
    expect(scheduleSaysDark(evening, 6 * 60 + 29)).toBe(true)
    expect(scheduleSaysDark(evening, 6 * 60 + 30)).toBe(false)
    expect(scheduleSaysDark(evening, 12 * 60)).toBe(false)
  })

  it("handles a non-wrapping window with the same half-open ends", () => {
    const daytime = { darkFromMinute: 9 * 60, darkUntilMinute: 17 * 60 }
    expect(scheduleSaysDark(daytime, 8 * 60 + 59)).toBe(false)
    expect(scheduleSaysDark(daytime, 9 * 60)).toBe(true)
    expect(scheduleSaysDark(daytime, 16 * 60 + 59)).toBe(true)
    expect(scheduleSaysDark(daytime, 17 * 60)).toBe(false)
  })
})

describe("resolveTheme", () => {
  const env = (systemPrefersDark: boolean, minutes = 12 * 60, forcedColors = false) => ({
    systemPrefersDark,
    forcedColors,
    minutesSinceMidnight: minutes,
  })

  it("honours an explicit choice against the OS", () => {
    expect(resolveTheme("light", env(true), null)).toEqual({
      dark: false,
      source: "explicit",
      forcedColors: false,
    })
    expect(resolveTheme("dark", env(false), null)).toEqual({
      dark: true,
      source: "explicit",
      forcedColors: false,
    })
  })

  it("asks the OS for system", () => {
    expect(resolveTheme("system", env(true), null).dark).toBe(true)
    expect(resolveTheme("system", env(false), null).dark).toBe(false)
    expect(resolveTheme("system", env(false), null).source).toBe("system")
  })

  it("uses the window for scheduled, ignoring the OS", () => {
    const schedule = { darkFromMinute: 20 * 60, darkUntilMinute: 6 * 60 }
    expect(resolveTheme("scheduled", env(false, 22 * 60), schedule)).toEqual({
      dark: true,
      source: "schedule",
      forcedColors: false,
    })
    expect(resolveTheme("scheduled", env(true, 13 * 60), schedule)).toEqual({
      dark: false,
      source: "schedule",
      forcedColors: false,
    })
  })

  it("says why it fell back when scheduled has no readable schedule", () => {
    // "We looked and found nothing" is a different answer from "we could not
    // look", and a silent fall-through to system is neither.
    const resolved = resolveTheme("scheduled", env(true), null)
    expect(resolved.dark).toBe(true)
    expect(resolved.source).toBe("system")
    expect(resolved.fallbackReason).toBe(
      "a scheduled theme was chosen but no readable schedule is stored",
    )
  })

  it("reports forced colors without letting it choose the theme", () => {
    // The platform substitutes its palette; it does not tell us the reader
    // wants light. Our resolution stands and the attribute tells CSS to stop
    // painting effects the platform cannot recolour.
    const resolved = resolveTheme("dark", env(false, 0, true), null)
    expect(resolved).toEqual({ dark: true, source: "explicit", forcedColors: true })
  })
})

/* ── the fake document the boot script runs against ───────────────────────── */

function fakeWorld(opts: {
  stored: Record<string, string>
  systemPrefersDark: boolean
  forcedColors: boolean
  minutes: number
}) {
  const classes = new Set<string>()
  const attributes = new Map<string, string>()
  const element = {
    classList: {
      toggle(name: string, force?: boolean) {
        if (force === undefined) throw new Error("the boot script must not toggle blind")
        if (force) classes.add(name)
        else classes.delete(name)
        return force
      },
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (k: string, v: string) => void attributes.set(k, v),
    removeAttribute: (k: string) => void attributes.delete(k),
    getAttribute: (k: string) => attributes.get(k) ?? null,
  }
  const localStorage = {
    getItem: (k: string) => (k in opts.stored ? opts.stored[k] : null),
  }
  const window = {
    matchMedia: (query: string) => ({
      matches:
        query === "(prefers-color-scheme: dark)"
          ? opts.systemPrefersDark
          : query === "(forced-colors: active)"
            ? opts.forcedColors
            : false,
    }),
  }
  class FakeDate {
    getHours() {
      return Math.floor(opts.minutes / 60)
    }
    getMinutes() {
      return opts.minutes % 60
    }
  }
  return { element, localStorage, window, FakeDate, classes, attributes }
}

function runBootScript(opts: Parameters<typeof fakeWorld>[0]) {
  const world = fakeWorld(opts)
  const run = new Function("window", "document", "localStorage", "Date", THEME_BOOT_SCRIPT)
  run(world.window, { documentElement: world.element }, world.localStorage, world.FakeDate)
  return world
}

describe("THEME_BOOT_SCRIPT", () => {
  const PREFERENCES: (string | null)[] = ["light", "dark", "system", "scheduled", "midnight", null]
  const SCHEDULES: (string | null)[] = ["20:00-06:30", "09:00-17:00", "20:00-20:00", "20h-6h", null]
  const MINUTES = [0, 6 * 60 + 29, 6 * 60 + 30, 13 * 60, 22 * 60]

  it("agrees with resolveTheme on every combination of preference, schedule, clock and OS", () => {
    let cases = 0
    let darkCases = 0
    let scheduleSourced = 0
    for (const preference of PREFERENCES) {
      for (const scheduleText of SCHEDULES) {
        for (const minutes of MINUTES) {
          for (const systemPrefersDark of [true, false]) {
            const stored: Record<string, string> = {}
            if (preference !== null) stored[THEME_STORAGE_KEY] = preference
            if (scheduleText !== null) stored[THEME_SCHEDULE_STORAGE_KEY] = scheduleText

            const world = runBootScript({
              stored,
              systemPrefersDark,
              forcedColors: false,
              minutes,
            })

            const parsed = parseSchedule(scheduleText)
            const expected = resolveTheme(
              parsePreference(preference),
              { systemPrefersDark, forcedColors: false, minutesSinceMidnight: minutes },
              parsed.ok ? parsed.schedule : null,
            )

            const label = `${preference}/${scheduleText}/${minutes}/${systemPrefersDark}`
            expect(`${label}:${world.classes.has(DARK_CLASS)}`).toBe(`${label}:${expected.dark}`)
            expect(`${label}:${world.attributes.get(THEME_SOURCE_ATTRIBUTE)}`).toBe(
              `${label}:${expected.source}`,
            )
            cases++
            if (expected.dark) darkCases++
            if (expected.source === "schedule") scheduleSourced++
          }
        }
      }
    }
    // A matrix that never exercises the interesting branch passes vacuously.
    expect(cases).toBe(PREFERENCES.length * SCHEDULES.length * MINUTES.length * 2)
    expect(darkCases).toBeGreaterThan(0)
    expect(scheduleSourced).toBeGreaterThan(0)
  })

  it("stamps and clears the forced-colors attribute exactly as applyTheme does", () => {
    for (const forcedColors of [true, false]) {
      const world = runBootScript({
        stored: { [THEME_STORAGE_KEY]: "dark" },
        systemPrefersDark: false,
        forcedColors,
        minutes: 0,
      })
      const reference = fakeWorld({
        stored: {},
        systemPrefersDark: false,
        forcedColors,
        minutes: 0,
      })
      applyTheme(reference.element as unknown as Element, {
        dark: true,
        source: "explicit",
        forcedColors,
      })
      expect(world.attributes.get(FORCED_COLORS_ATTRIBUTE)).toBe(
        reference.attributes.get(FORCED_COLORS_ATTRIBUTE),
      )
      expect(world.attributes.get(FORCED_COLORS_ATTRIBUTE)).toBe(
        forcedColors ? "active" : undefined,
      )
    }
  })

  it("still stamps nav and density before first paint", () => {
    // They share the script because they are the other two things that must be
    // right before the first paint; losing them here is a frame-wide reflow.
    const world = runBootScript({
      stored: { "tenure-nav": "collapsed", "tenure-density": "compact" },
      systemPrefersDark: false,
      forcedColors: false,
      minutes: 0,
    })
    expect(world.classes.has("nav-collapsed")).toBe(true)
    expect(world.attributes.get("data-density")).toBe("compact")

    const plain = runBootScript({
      stored: {},
      systemPrefersDark: false,
      forcedColors: false,
      minutes: 0,
    })
    expect(plain.classes.has("nav-collapsed")).toBe(false)
    expect(plain.attributes.get("data-density")).toBe("comfortable")
  })

  it("survives a localStorage that throws", () => {
    // Safari in private mode, a full quota, a blocked third-party context. The
    // page must still paint, at the system theme.
    const run = new Function("window", "document", "localStorage", "Date", THEME_BOOT_SCRIPT)
    const world = fakeWorld({
      stored: {},
      systemPrefersDark: true,
      forcedColors: false,
      minutes: 0,
    })
    expect(() =>
      run(
        world.window,
        { documentElement: world.element },
        {
          getItem() {
            throw new Error("SecurityError")
          },
        },
        world.FakeDate,
      ),
    ).not.toThrow()
  })
})

describe("no second implementation of the theme rule", () => {
  it("is the only module that toggles the dark class", () => {
    // The defect this closes: three copies of the same boolean, in
    // layout.tsx's inline string, ThemeSwitcher.apply and its matchMedia
    // listener. A fourth mode added to one of them works until you reload.
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        const rel = path.relative(WEB_SRC, full).split(path.sep).join("/")
        if (rel === "lib/a11y/theme-resolution.ts" || rel === "lib/a11y/theme-resolution.test.ts") {
          continue
        }
        const source = fs.readFileSync(full, "utf8")
        if (/classList\.toggle\(\s*["'`]dark["'`]/.test(source)) offenders.push(rel)
        if (/prefers-color-scheme:\s*dark\)?["'`]\s*\)\s*\.matches/.test(source)) {
          offenders.push(`${rel} (asks the OS directly)`)
        }
      }
    }
    walk(WEB_SRC)
    expect(offenders).toEqual([])
  })

  it("is what the root layout injects before first paint", () => {
    const layout = read("app/layout.tsx")
    expect(layout).toMatch(/THEME_BOOT_SCRIPT/)
    expect(layout).toMatch(/from "@\/lib\/a11y\/theme-resolution"/)
    // The literal it replaced must not still be sitting beside it.
    expect(layout).not.toMatch(/tenure-theme["']\)\s*\|\|/)
  })

  it("is what the theme switcher applies", () => {
    const switcher = read("components/ThemeSwitcher.tsx")
    expect(switcher).toMatch(/applyStoredTheme/)
    expect(switcher).toMatch(/THEME_STORAGE_KEY/)
  })
})

describe("forced colors are honoured in the stylesheet", () => {
  const css = read("app/globals.css")

  it("declares a forced-colors block", () => {
    expect(css).toMatch(/@media\s*\(forced-colors:\s*active\)/)
  })

  it("drops the effects the platform cannot recolour", () => {
    const start = css.indexOf("@media (forced-colors: active)")
    expect(start).toBeGreaterThan(-1)
    // Brace-balanced read of the block, so a nested rule cannot truncate it.
    let depth = 0
    let end = start
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++
      else if (css[i] === "}") {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    const block = css.slice(start, end)
    for (const property of ["box-shadow", "backdrop-filter", "text-shadow"]) {
      expect(block).toMatch(new RegExp(`${property}:\\s*none`))
    }
    // A focus ring painted in a colour the platform has replaced is invisible.
    expect(block).toMatch(/outline:[^;]*Highlight/)
  })

  it("targets the attribute the resolver stamps, so JS and CSS agree", () => {
    expect(css).toContain(`[${FORCED_COLORS_ATTRIBUTE}="active"]`)
  })
})
