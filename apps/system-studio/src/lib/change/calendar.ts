import { CHANGE_CLASSES, type ChangeClass } from "@tenure/provisioning"

import type { ChangeCalendar, FreezePeriod, MaintenanceWindow } from "./windows"

/**
 * STUDIO-060-008 — where the change calendar comes from, and what it means when
 * there isn't one.
 *
 * The windows and freezes are estate facts: they are decided by whoever runs
 * this installation, they differ between installations, and they change without
 * a deploy. `tests/security/no-hardcoded-estate.test.mjs` exists because a fact
 * of that shape compiled into the product is a fact nobody can correct — so the
 * calendar is READ, from `CHANGE_CALENDAR`, and there is no built-in default.
 *
 * An absent calendar is reported as absent. `scheduleVerdict` then answers
 * `OUTSIDE_WINDOW` for every window-bound class, which is the safe direction and
 * is stated on the surface as "nothing says when a change may run here" rather
 * than rendering as a permission.
 *
 * A MALFORMED calendar is not the same as an absent one and does not degrade to
 * it. It is reported with what is wrong, because an operator who wrote a
 * calendar and had it silently ignored is worse off than one who wrote none:
 * they believe changes are governed.
 */

export interface CalendarSource {
  calendar: ChangeCalendar
  /** Where it came from, or why there is none. Rendered, never swallowed. */
  state: "DECLARED" | "ABSENT" | "MALFORMED"
  detail: string
}

const EMPTY: ChangeCalendar = { windows: [], freezes: [] }

const isWeekday = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6

const isMinute = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2 * 1440

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v))

const isClassList = (v: unknown): v is ChangeClass[] =>
  Array.isArray(v) && v.length > 0 && v.every((c) => (CHANGE_CLASSES as readonly string[]).includes(c))

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string")

/**
 * Parse a calendar document, reporting every problem rather than the first.
 *
 * Exported so the parse is testable without an environment, and so the shape a
 * malformed calendar is refused for is a property of a function rather than of
 * a process's environment at a moment.
 */
export function parseCalendar(raw: unknown): CalendarSource {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { calendar: EMPTY, state: "MALFORMED", detail: "CHANGE_CALENDAR must be a JSON object." }
  }
  const doc = raw as Record<string, unknown>
  const problems: string[] = []
  const windows: MaintenanceWindow[] = []
  const freezes: FreezePeriod[] = []

  const rawWindows = doc.windows ?? []
  if (!Array.isArray(rawWindows)) {
    problems.push("`windows` must be an array.")
  } else {
    for (const [index, entry] of rawWindows.entries()) {
      const w = entry as Record<string, unknown>
      if (
        typeof w?.id !== "string" ||
        typeof w?.label !== "string" ||
        !isWeekday(w?.weekday) ||
        !isMinute(w?.startMinuteUtc) ||
        !isMinute(w?.endMinuteUtc) ||
        !isStringList(w?.environments ?? [])
      ) {
        problems.push(`windows[${index}] needs id, label, weekday 0-6, startMinuteUtc, endMinuteUtc.`)
        continue
      }
      if (w.endMinuteUtc <= w.startMinuteUtc) {
        problems.push(`windows[${index}] ends at or before it starts.`)
        continue
      }
      windows.push({
        id: w.id,
        label: w.label,
        weekday: w.weekday,
        startMinuteUtc: w.startMinuteUtc,
        endMinuteUtc: w.endMinuteUtc,
        environments: (w.environments as string[] | undefined) ?? [],
      })
    }
  }

  const rawFreezes = doc.freezes ?? []
  if (!Array.isArray(rawFreezes)) {
    problems.push("`freezes` must be an array.")
  } else {
    for (const [index, entry] of rawFreezes.entries()) {
      const f = entry as Record<string, unknown>
      if (
        typeof f?.id !== "string" ||
        typeof f?.label !== "string" ||
        !isIso(f?.fromUtc) ||
        !isIso(f?.toUtc) ||
        !isClassList(f?.classes) ||
        typeof f?.emergencyPermitted !== "boolean" ||
        !isStringList(f?.environments ?? [])
      ) {
        problems.push(
          `freezes[${index}] needs id, label, ISO fromUtc/toUtc, a non-empty classes list, and an explicit emergencyPermitted.`,
        )
        continue
      }
      if (Date.parse(f.toUtc) <= Date.parse(f.fromUtc)) {
        problems.push(`freezes[${index}] ends at or before it starts.`)
        continue
      }
      freezes.push({
        id: f.id,
        label: f.label,
        fromUtc: f.fromUtc,
        toUtc: f.toUtc,
        classes: f.classes,
        environments: (f.environments as string[] | undefined) ?? [],
        emergencyPermitted: f.emergencyPermitted,
      })
    }
  }

  if (problems.length > 0) {
    return {
      calendar: EMPTY,
      state: "MALFORMED",
      detail:
        `CHANGE_CALENDAR was set and could not be read, so NO calendar is in force: ${problems.join(" ")} ` +
        `Nothing is being governed by it until this is fixed.`,
    }
  }
  return {
    calendar: { windows, freezes },
    state: "DECLARED",
    detail: `${windows.length} maintenance window(s) and ${freezes.length} freeze period(s) declared.`,
  }
}

/**
 * The calendar this installation is running under.
 *
 * `env` is a parameter with a default rather than a direct `process.env` read,
 * so the resolution is testable at every arm without mutating a process.
 */
export function changeCalendar(
  env: Record<string, string | undefined> = process.env,
): CalendarSource {
  const raw = env.CHANGE_CALENDAR?.trim()
  if (!raw) {
    return {
      calendar: EMPTY,
      state: "ABSENT",
      detail:
        "No change calendar is declared (CHANGE_CALENDAR is unset), so nothing says when a change may run " +
        "here. Every window-bound class reads as outside a window until one is set.",
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      calendar: EMPTY,
      state: "MALFORMED",
      detail: `CHANGE_CALENDAR is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    }
  }
  return parseCalendar(parsed)
}
