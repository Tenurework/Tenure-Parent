import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"

/**
 * The task scorecard and the journeys that produce it have to agree.
 *
 * `apps/web/e2e/support/journey-metrics.ts` already refuses a journey with no
 * row, but that check only runs when the whole e2e suite runs — which needs a
 * built app and a seeded database. The two failures worth catching in seconds
 * are exactly the ones a reader cannot see:
 *
 *   - a journey added to a spec and never written down, so nobody can notice it
 *     getting worse;
 *   - a row left behind in the scorecard after its journey was deleted, which
 *     reads as coverage and is a fossil.
 *
 * And one more, which is the reason `TTES-050-002` is blocked rather than done:
 * a competitor task time that appeared in the document without anybody running
 * a competitor product. See the last test.
 */

const SCORECARD = "docs/architecture/ux-task-scorecard.md"
const E2E_DIR = "apps/web/e2e"

/**
 * The journey ids the scorecard declares, with their persona.
 *
 * A deliberately separate reading from the TypeScript parser in
 * `journey-metrics.ts`: two independent readers of the same table disagree
 * loudly when somebody reformats it, and one reader that is also the only
 * consumer can drift without anybody noticing.
 */
function scorecardRows() {
  const text = fs.readFileSync(path.join(ROOT, SCORECARD), "utf8")
  const rows = []
  for (const line of text.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
    if (cells.length < 7) continue
    const id = /^`([A-Za-z0-9][A-Za-z0-9-]*)`$/.exec(cells[0])?.[1]
    if (!id) continue
    rows.push({ id, persona: cells[1], counts: cells.slice(3, 7) })
  }
  return rows
}

/** Every journey any spec actually runs, with the persona it declares. */
function declaredJourneys() {
  const dir = path.join(ROOT, E2E_DIR)
  const found = []
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith(".spec.ts")) {
        const text = fs.readFileSync(p, "utf8")
        // The declaration object literal `measureJourney` is called with, on
        // one line or four — Prettier picks depending on how long it is.
        const re = /id:\s*"([A-Za-z0-9][A-Za-z0-9-]*)",\s*persona:\s*"([^"]+)"/g
        for (const m of text.matchAll(re)) {
          found.push({ id: m[1], persona: m[2], file: path.relative(ROOT, p).replace(/\\/g, "/") })
        }
      }
    }
  }
  walk(dir)
  return found
}

/**
 * The one journey that is deliberately absent from the scorecard.
 *
 * `journey-metrics.spec.ts` runs it to prove the harness refuses an undeclared
 * journey. Naming it here rather than allowing a general exemption is the
 * point: any OTHER unwritten journey fails this file.
 */
const DELIBERATELY_UNDECLARED = new Set(["J99-undeclared"])

test("the readers agree that the scorecard has rows at all", () => {
  // Every assertion below passes on two empty lists.
  const rows = scorecardRows()
  const journeys = declaredJourneys()
  assert.ok(rows.length >= 5, `Parsed ${rows.length} scorecard rows; the table shape has changed.`)
  assert.ok(
    journeys.length >= 5,
    `Found ${journeys.length} measureJourney declarations under ${E2E_DIR}; the call shape has changed.`,
  )
})

test("every journey a spec runs has a row in the scorecard", () => {
  const ids = new Set(scorecardRows().map((r) => r.id))
  const missing = declaredJourneys()
    .filter((j) => !ids.has(j.id) && !DELIBERATELY_UNDECLARED.has(j.id))
    .map((j) => `${j.file}: ${j.id}`)
  assert.deepEqual(
    missing,
    [],
    `These journeys are measured but not written down in ${SCORECARD}, so no one can see them get worse.`,
  )
})

test("every row in the scorecard belongs to a journey something runs", () => {
  const declared = new Map(declaredJourneys().map((j) => [j.id, j]))
  const orphans = scorecardRows()
    .filter((r) => !declared.has(r.id))
    .map((r) => r.id)
  assert.deepEqual(orphans, [], `These rows have no journey behind them and read as coverage.`)
})

test("a row's persona is the persona the journey is driven by", () => {
  // The budget was measured for somebody. Swapping who does the job — a member
  // for a director, say — changes what the shell offers them and invalidates
  // every number in the row, silently, because the counts still parse.
  const declared = new Map(declaredJourneys().map((j) => [j.id, j]))
  const mismatched = scorecardRows()
    .filter((r) => declared.has(r.id) && declared.get(r.id).persona !== r.persona)
    .map((r) => `${r.id}: scorecard says "${r.persona}", ${declared.get(r.id).file} drives "${declared.get(r.id).persona}"`)
  assert.deepEqual(mismatched, [])
})

test("the harness's own rows carry real numbers, so the gate is switched on", () => {
  // Every product row may legitimately be an em dash today — see "Why the
  // product rows are still unmeasured". The harness rows may not: they are what
  // proves a budget can fail at all, and a dash there would turn the whole
  // scorecard into a document that cannot say no.
  const unmeasured = scorecardRows()
    .filter((r) => r.id.startsWith("J00-"))
    .filter((r) => r.counts.some((c) => !/^\d+$/.test(c)))
    .map((r) => `${r.id}: ${r.counts.join(" | ")}`)
  assert.deepEqual(unmeasured, [], "The harness self-check rows must be measured, not declared.")
})

test("no competitor task time has been written down that nobody measured", () => {
  // TTES-050-002's substance is a measured comparison against products this
  // repository has no lawful access to and no human-subjects protocol for. A
  // plausible-looking number in this table would be indistinguishable from a
  // real one to every reader and to every other test here, which is the exact
  // failure the requirement's wording guards against.
  const text = fs.readFileSync(path.join(ROOT, SCORECARD), "utf8")
  const COMPETITORS = [
    "Granola", "Vercel", "Brex", "Monarch", "Perplexity", "ChatGPT",
    "Intuit", "SAP", "Workday", "Oracle", "Rippling",
  ]
  const rows = []
  for (const line of text.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
    // A table row that names a competitor AND carries a number is a measurement
    // claim. Prose naming them is fine and necessary — the requirement names
    // them itself.
    const namesOne = COMPETITORS.some((c) => cells.some((cell) => cell.includes(c)))
    if (namesOne && cells.some((cell) => /^\d+(\.\d+)?$/.test(cell))) rows.push(line.trim())
  }
  assert.deepEqual(
    rows,
    [],
    `${SCORECARD} carries competitor measurements. Nothing in this repository ran a competitor ` +
      `product, so these numbers came from somewhere else. TTES-050-002 stays BLOCKED_EXTERNAL ` +
      `until lawful licensed access and a human-subjects protocol exist.`,
  )
})
