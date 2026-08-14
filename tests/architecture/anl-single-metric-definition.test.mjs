import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT, derive } from "../../tools/anl-analytics-inventory.mjs"

/**
 * ANL-000-002 — a metric the product states twice must be defined once, and a
 * surface must not call a frozen number live.
 *
 * ## The two defects this guards, both real, both found by ANL-000-001
 *
 * **1. One metric, several definitions.** "Approvals awaiting decision" was
 * decided in four places — `/reports`, `/dashboard`, `/admin` and
 * `/api/reports/pulse` — each naming the statuses itself. "Median time to
 * decision" was computed twice ON THE SAME PAGE, over different populations,
 * through formatting ladders that disagreed at the day boundary: five days read
 * `120.0 h` in the stat tile and `5.0 days` in the panel under it. And a THIRD
 * population — draft and returned requests included — was rendered under the
 * same word "pending" on `/orgs/[slug]/impact` and `/orgs/[slug]/handoff`.
 *
 * None of that is caught by a type. Four literal arrays of the same two strings
 * type-check perfectly, and so does a duration formatter missing a rung.
 *
 * **2. A frozen number called live.** `/orgs/[slug]/handoff` said "live from the
 * seat lifecycle" over four tiles read once at render and never refreshed. §19
 * of the Analytics Bible names calling stale data real time; a reader who left
 * the tab open read an hour-old figure labelled live.
 *
 * ## Why the checks are shaped this way
 *
 * The population scanned is the DERIVED analytics inventory
 * (`tools/anl-analytics-inventory.mjs`), not a hand-listed set of files. A guard
 * over a list somebody typed stops covering the surface the day a chart is added
 * somewhere new, and it stops silently. This one grows with the inventory.
 */

const CANONICAL = "apps/web/src/lib/analytics/metrics.ts"

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n")

/** Analytics artefacts, with their normalised text. The canonical module last. */
function artefactSources() {
  return derive()
    .artefacts.map((a) => ({ id: a.id, kinds: a.kinds, text: read(a.id) }))
    .filter((a) => a.id !== CANONICAL)
}

/**
 * Source with comments removed, so a check about what a READER sees is not
 * fooled by a sentence about the code.
 *
 * `/…/s` is a compile error at this repository's ES2017 target and would be a
 * silent behaviour change here, so the block-comment pattern is spelled with
 * `[\s\S]` deliberately.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")
}

test("the canonical metric module exists and defines both populations", () => {
  // Everything below is an absence check against a list. If this file were
  // deleted or renamed, the absences would all still hold and the guard would
  // report a clean repository over a codebase with no definition at all.
  const text = read(CANONICAL)
  for (const symbol of [
    "OPEN_APPROVAL_STATUSES",
    "UNDECIDED_APPROVAL_STATUSES",
    "medianDurationMs",
    "formatDuration",
  ]) {
    assert.ok(text.includes(`export const ${symbol}`) || text.includes(`export function ${symbol}`),
      `${CANONICAL} no longer exports ${symbol}.`)
  }
})

test("the guard is actually looking at the analytics surface", () => {
  const artefacts = artefactSources()
  assert.ok(artefacts.length >= 50, `Only ${artefacts.length} artefacts scanned; the inventory has stopped deriving.`)
  // The four surfaces that carried a duplicate are still in scope. A guard that
  // stops seeing the files it was written for reports green forever.
  for (const id of [
    "apps/web/src/app/(app)/reports/page.tsx",
    "apps/web/src/app/(app)/dashboard/page.tsx",
    "apps/web/src/app/(app)/admin/page.tsx",
    "apps/web/src/app/api/reports/pulse/route.ts",
    "apps/web/src/components/charts/panels/ReportsAnalytics.tsx",
  ]) {
    assert.ok(artefacts.some((a) => a.id === id), `${id} is no longer in the derived inventory; the guard has a hole.`)
  }
})

test("no analytics artefact writes out the open-approval status set itself", () => {
  // The literal array, in either order and either quote style. `ReportsAnalytics`
  // names all six workflow statuses as funnel STAGES, which is a rendering of
  // every stage rather than a second definition of "open" — so the check is the
  // two-element set, not the presence of a status name.
  const pair = /\[\s*["'](PENDING_PRESIDENT|PENDING_OSE)["']\s*,\s*["'](PENDING_PRESIDENT|PENDING_OSE)["']\s*\]/
  const offenders = artefactSources()
    .filter((a) => pair.test(a.text))
    .map((a) => a.id)
  assert.deepEqual(
    offenders,
    [],
    `These artefacts decide for themselves what "awaiting decision" means. Import ` +
      `OPEN_APPROVAL_STATUSES from ${CANONICAL} instead — four copies of this array is how the ` +
      `pulse endpoint and the tile it replaces come to disagree.`,
  )
})

test("no analytics artefact writes out the undecided-approval status set itself", () => {
  const set = /\[\s*["']DRAFT["']\s*,\s*["']PENDING_PRESIDENT["']/
  const offenders = artefactSources()
    .filter((a) => set.test(a.text))
    .map((a) => a.id)
  assert.deepEqual(
    offenders,
    [],
    `These artefacts define "still in flight" themselves. Import UNDECIDED_APPROVAL_STATUSES ` +
      `from ${CANONICAL} — it is a different population from the open set and both were ` +
      `rendered under the word "pending".`,
  )
})

test("no analytics artefact carries a second median or a second duration ladder", () => {
  // Two shapes, because the duplication had two halves and either one alone
  // reproduces the defect: selecting the middle of a sorted population, and
  // rendering milliseconds as a unit.
  const median = /Math\.floor\([^)\n]*\.length\s*\/\s*2\s*\)/
  const ladder = /\.toFixed\(1\)\}\s*(h|days)\b/
  const offenders = artefactSources()
    .filter((a) => median.test(a.text) || ladder.test(a.text))
    .map((a) => `${a.id}${median.test(a.text) ? " [median]" : ""}${ladder.test(a.text) ? " [ladder]" : ""}`)
  assert.deepEqual(
    offenders,
    [],
    `These artefacts compute or format a duration metric themselves. Use medianDurationMs / ` +
      `formatDuration from ${CANONICAL}. The two copies this replaced disagreed at the day ` +
      `boundary and put 120.0 h and 5.0 days on the same screen.`,
  )
})

test("no analytics surface calls its numbers live without showing how fresh they are", () => {
  // The claim, as a reader meets it: in rendered text, not in a comment about
  // the code. `/reports` may say it — it renders `LiveStats`, which polls every
  // fifteen seconds and prints "Updated {ago}" beside the word. `/handoff` said
  // it over four tiles that never move, and that is the defect.
  const claim = /\b(live from|in real ?time|real-?time|live now)\b/i
  const freshness = ["LiveStats", "StaleIndicator", "ChartFrame", "asOf"]

  const surfaces = artefactSources().filter((a) => a.kinds.includes("analytics-surface"))
  assert.ok(surfaces.length >= 15, `Only ${surfaces.length} surfaces scanned; the derivation has narrowed.`)

  const offenders = surfaces
    .filter((a) => claim.test(withoutComments(a.text)))
    .filter((a) => !freshness.some((token) => a.text.includes(token)))
    .map((a) => a.id)
  assert.deepEqual(
    offenders,
    [],
    "These surfaces claim their numbers are live and render nothing that says how fresh they " +
      "are. Either poll them and show the age, or say when they were read. §19 names calling " +
      "stale data real time.",
  )
})

test("the freshness check can still see a claim, and can still see a comment", () => {
  // Exercised directly. Every assertion above this one is an absence, and the
  // two ways this check dies quietly are a regex that matches nothing and a
  // comment-stripper that eats the whole file.
  assert.ok(/\b(live from|in real ?time|real-?time|live now)\b/i.test('subtitle="live from the seat lifecycle"'))
  assert.equal(withoutComments("/* live from x */\nconst a = 1").includes("live from"), false)
  assert.equal(withoutComments("// live from x\nconst a = 1").includes("live from"), false)
  assert.equal(withoutComments('const s = "live from the record"').includes("live from"), true)
})
