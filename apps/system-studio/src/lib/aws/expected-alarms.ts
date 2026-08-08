import "server-only"

import fs from "node:fs"
import path from "node:path"

/**
 * STUDIO-080-008 — the alarms this estate is supposed to have, read from the
 * Terraform that declares them.
 *
 * MISSING is only a useful verdict if the expected set is falsifiable. A list
 * typed into this file would be a second declaration of the same fact, and the
 * two would disagree the first time somebody adds an alarm to
 * `infrastructure/terraform/cloudwatch.tf` — at which point the console reports
 * the estate as complete because its own list is short.
 *
 * So the names are parsed out of the Terraform. `${local.name_prefix}` is
 * resolved from `NAME_PREFIX`, which the deploy sets; when it is unset the
 * suffixes are still returned and matched loosely, because "we know four alarms
 * are declared and cannot tell you their full names" is more useful than an
 * empty expectation.
 */

const ALARM_NAME = /alarm_name\s*=\s*"([^"]+)"/g

/** Where the alarms are declared. Relative to the repository root. */
const SOURCES = [
  "infrastructure/terraform/cloudwatch.tf",
  "infrastructure/studio/cloudwatch.tf",
]

/** Cached: the file does not change under a running container. */
let cached: readonly string[] | null = null

export function expectedAlarmNames(root: string = process.cwd()): readonly string[] {
  if (cached) return cached

  const prefix = process.env.NAME_PREFIX?.trim()
  const names: string[] = []

  for (const source of SOURCES) {
    // The container image ships the app, not the Terraform. A missing file is
    // the normal production case and must not throw — it means "no expectation
    // is declarable here", which the alarm surface renders as no MISSING rows
    // rather than as an error about a file an operator cannot see.
    const full = path.join(root, source)
    let text: string
    try {
      text = fs.readFileSync(full, "utf8")
    } catch {
      continue
    }
    for (const match of text.matchAll(ALARM_NAME)) {
      const declared = match[1]
      const resolved = declared.replace(/\$\{local\.name_prefix\}/g, prefix ?? "")
      // A name that still holds an unresolved interpolation cannot be compared
      // to a real alarm name, and comparing it anyway would report every alarm
      // as MISSING — the loudest possible false alarm.
      if (resolved.includes("${")) continue
      if (!prefix && resolved.startsWith("-")) continue
      names.push(resolved)
    }
  }

  cached = [...new Set(names)].sort()
  return cached
}

/** For tests, which write a fixture and need the next read to see it. */
export function __resetExpectedAlarms(): void {
  cached = null
}
