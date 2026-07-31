/**
 * Where the roster comes from.
 *
 * The real roster is 172 named students and advisors with their university
 * email addresses. It is currently committed at `scripts/roster-data.mjs`, and
 * while this repository is public `raw.githubusercontent.com` serves it to
 * anyone — so that data is exactly as private as a repository setting, which is
 * not a control anybody chose.
 *
 * This indirection is what lets it stop being committed. Three sources, in
 * order:
 *
 *   1. ROSTER_FILE          — a path to a real roster the developer supplies.
 *   2. scripts/roster-data.mjs, if it is still present.
 *   3. scripts/roster-data.sample.mjs — the committed synthetic fixture.
 *
 * Once the real roster lives somewhere the repository does not (S3, or an
 * operator's machine), `git rm --cached scripts/roster-data.mjs` plus a
 * `.gitignore` line removes it from source with no code change: source 2 simply
 * stops resolving, and CI and local development fall through to the fixture.
 * That is deliberate — the removal should not also be a refactor.
 *
 * The fixture is structurally identical to the real data (same 26 clubs, 209
 * seats, codes, vacancies and predecessor links) so tests exercise the real
 * shape. Every person in it is generated and every address is `@example.invalid`,
 * which RFC 2606 reserves so nothing can be delivered to one.
 *
 * Production is loud about it. Seeding a real institution from synthetic people
 * is a data incident that would otherwise be discovered by a student finding a
 * stranger's name on their own seat, so it refuses rather than warns.
 */

import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))

async function load() {
  if (process.env.ROSTER_FILE) {
    const path = resolve(process.env.ROSTER_FILE)
    if (!existsSync(path)) {
      throw new Error(`ROSTER_FILE is set to ${path}, which does not exist.`)
    }
    return { source: `ROSTER_FILE (${path})`, synthetic: false, mod: await import(`file://${path}`) }
  }

  const real = join(here, "roster-data.mjs")
  if (existsSync(real)) {
    return { source: "scripts/roster-data.mjs", synthetic: false, mod: await import(`file://${real}`) }
  }

  const sample = join(here, "roster-data.sample.mjs")
  if (!existsSync(sample)) {
    throw new Error(
      "No roster available: ROSTER_FILE is unset, scripts/roster-data.mjs is absent, and the " +
        "synthetic fixture scripts/roster-data.sample.mjs is missing too. Regenerate it with " +
        "`node scripts/anonymize-roster.mjs > scripts/roster-data.sample.mjs`.",
    )
  }
  return { source: "scripts/roster-data.sample.mjs (synthetic)", synthetic: true, mod: await import(`file://${sample}`) }
}

const { source, synthetic, mod } = await load()

if (synthetic && process.env.NODE_ENV === "production" && process.env.ALLOW_SYNTHETIC_ROSTER !== "true") {
  throw new Error(
    `Refusing to seed production from the synthetic roster (${source}). Every person in it is ` +
      `invented, so this would put fabricated names on real board seats. Set ROSTER_FILE to the ` +
      `real roster, or ALLOW_SYNTHETIC_ROSTER=true if a synthetic environment is genuinely what ` +
      `you want.`,
  )
}

console.log(`📇 Roster source: ${source}`)

export const { ROSTER, ADVISORS, CURRENT_TERM, PRIOR_TERM, VACANT_LABEL } = mod
export const ROSTER_IS_SYNTHETIC = synthetic
