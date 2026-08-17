import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  BIBLE,
  JSON_PATH,
  MD_PATH,
  NOT_IMPLEMENTED,
  render,
  capabilitiesOf,
} from "../../tools/pack-capability-taxonomy.mjs"
import { ROOT, modules } from "../../tools/pack-surface-inventory.mjs"

/**
 * PACK-040-001 and PACK-050-002 — the registry cannot invent, omit or inflate.
 *
 * `docs/architecture/pack-capability-taxonomy.{json,md}` is generated from the
 * pack Bible's §8 and §9. A generated document is only worth the check that can
 * refute it, and there are three distinct ways this one could be wrong:
 *
 *   1. **Invention** — an entry naming a capability the Bible does not state.
 *      Caught by searching the Bible, as text, for every entry's own quoted
 *      bullet. This test never calls the generator's parser to do that.
 *   2. **Omission** — a bullet the Bible states that produced no entry. Caught
 *      by a second, deliberately dumber scan of the Bible written here: every
 *      list line between §8's heading and §9's, and between §9's and §10's,
 *      must be some entry's `line`. Two independent readers of the same text,
 *      compared — the same technique `pack-surface-inventory.test.mjs` uses to
 *      cross-check module objects against `schema.prisma`.
 *   3. **Inflation** — an entry claiming more implementation than the module
 *      catalog supports. This is the one the requirements are actually about:
 *      PACK-050-002 says "without claiming implementation" and Bible §9 says
 *      "not a claim that every pack is implemented". Every status is either
 *      `not-implemented` or the exact `lifecycle` of a module
 *      `modules/index.ts` declares, read from there rather than from the
 *      document.
 *
 * The assertions below read the COMMITTED artifact, not a fresh render, because
 * the committed artifact is what a reader opens. One test compares the two, so
 * a stale document is a distinct failure from a false one.
 */

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n")

const committed = () => JSON.parse(read(JSON_PATH))

const bible = () => read(BIBLE)

/** Every functional entry, flattened. */
const functionalEntries = (reg) => reg.functional.suites.flatMap((s) => s.entries)
/** Every industry entry, flattened. */
const industryEntries = (reg) => reg.industry.families.flatMap((f) => f.entries)

/**
 * The Bible's own list lines for one section, scanned without the generator.
 *
 * Deliberately naive: find the `## n.` heading, stop at the next `## `, keep
 * every line that starts a markdown list. If this and the generator ever
 * disagree about what §8 contains, one of them is wrong and the test fails
 * rather than both agreeing by construction.
 */
function bulletsOf(sectionHeading) {
  const lines = bible().split("\n")
  const start = lines.findIndex((l) => l.trim() === sectionHeading)
  assert.notEqual(start, -1, `${BIBLE} has no heading ${sectionHeading}`)
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break
    const m = /^(?:-|\d+\.)\s+(.*)$/.exec(line.trim())
    if (m) out.push(m[1].trim())
  }
  return out
}

test("the committed registry is what the Bible now says", () => {
  const { json, md } = render()
  assert.equal(
    read(JSON_PATH),
    json,
    `${JSON_PATH} is stale. Run: node tools/pack-capability-taxonomy.mjs`,
  )
  assert.equal(read(MD_PATH), md, `${MD_PATH} is stale. Run: node tools/pack-capability-taxonomy.mjs`)
})

test("regenerating twice produces the same bytes", () => {
  // No timestamp, no clock, no working-tree state: a registry that differs
  // between two runs cannot be reviewed by diffing it.
  const a = render()
  const b = render()
  assert.equal(a.json, b.json)
  assert.equal(a.md, b.md)
})

test("the registry is not empty, and neither section is", () => {
  // Every assertion below this one is a property of a list. Over an empty list
  // they all hold, which is the failure mode this test exists to separate from
  // a passing suite.
  const reg = committed()
  assert.equal(reg.counts.suites, 10, "Bible §8 states ten functional suites")
  assert.equal(reg.counts.families, 9, "Bible §9 states nine industry families")
  assert.ok(
    reg.counts.functionalEntries > 200,
    `only ${reg.counts.functionalEntries} functional capabilities — the §8 parse is broken`,
  )
  assert.ok(
    reg.counts.industryEntries > 50,
    `only ${reg.counts.industryEntries} industries — the §9 parse is broken`,
  )
})

test("PACK-040-001 — every §8 capability the Bible states has a registry entry, and no entry invents one", () => {
  const reg = committed()
  const text = bible()
  const entries = functionalEntries(reg)

  // 1. invention — every quoted bullet is text the Bible contains, and the
  //    capability is a fragment of the bullet it was split from.
  for (const e of entries) {
    assert.ok(text.includes(e.line), `${e.id} quotes a line ${BIBLE} does not contain: ${e.line}`)
    assert.ok(
      e.line.includes(e.capability),
      `${e.id} claims capability "${e.capability}", which is not part of its own line`,
    )
  }

  // 2. omission — every §8 list line is some entry's line, and every entry's
  //    line is a §8 list line.
  const bullets = bulletsOf("## 8. Functional suite map")
  assert.ok(bullets.length > 50, `scanned only ${bullets.length} §8 bullets`)
  const quoted = new Set(entries.map((e) => e.line))
  for (const bullet of bullets) {
    assert.ok(quoted.has(bullet), `Bible §8 states a capability line no entry covers: ${bullet}`)
    // and it is split into every capability it names, not filed whole
    for (const capability of capabilitiesOf(bullet)) {
      assert.ok(
        entries.some((e) => e.line === bullet && e.capability === capability),
        `Bible §8 names "${capability}" in "${bullet}" and no entry carries it`,
      )
    }
  }
  const stated = new Set(bullets)
  for (const e of entries) {
    assert.ok(stated.has(e.line), `${e.id} quotes a line that is not a §8 list line: ${e.line}`)
  }

  // 3. every entry is identified, and identified once
  const ids = entries.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, "two functional entries share an id")
  for (const e of entries) assert.match(e.id, /^FUN-8\.\d+-[a-z0-9-]+$/, `${e.id} is not a registry id`)
})

test("PACK-040-001 — no entry claims more implementation than modules/index.ts declares", () => {
  const reg = committed()
  const catalog = new Map(modules().map((m) => [m.key, m]))
  assert.ok(catalog.size >= 12, `read only ${catalog.size} modules from modules/index.ts`)

  for (const e of functionalEntries(reg)) {
    if (e.coveredBy === null) {
      assert.equal(
        e.status,
        NOT_IMPLEMENTED,
        `${e.id} is covered by nothing and says "${e.status}" — "we have not built it" is the only ` +
          "honest status for a capability no module claims",
      )
      continue
    }
    const module = catalog.get(e.coveredBy.module)
    assert.ok(module, `${e.id} is covered by "${e.coveredBy.module}", which the catalog does not declare`)
    // The status is the MODULE's own lifecycle. Not "a lifecycle", not one the
    // document chose: the same string the manifest states.
    assert.equal(
      e.status,
      module.lifecycle,
      `${e.id} says "${e.status}" while ${module.key} declares lifecycle "${module.lifecycle}"`,
    )
    assert.equal(e.coveredBy.lifecycle, module.lifecycle)
    assert.equal(e.coveredBy.mode, module.mode)
    assert.ok(
      typeof e.coveredBy.why === "string" && e.coveredBy.why.trim().length > 10,
      `${e.id} claims coverage with no reason anybody can review`,
    )
  }

  // And the ceiling, stated separately, because it is the claim PACK-000-004
  // removed and this registry is the widest surface on which it could return.
  for (const e of [...functionalEntries(reg), ...industryEntries(reg)]) {
    assert.ok(
      e.status !== "available" && e.status !== "approved",
      `${e.id} says "${e.status}" — no module in this catalog is available, so no capability is`,
    )
  }
})

test("PACK-050-002 — the §9 taxonomy is every industry the Bible lists, claiming none of them", () => {
  const reg = committed()
  const text = bible()
  const entries = industryEntries(reg)

  const bullets = bulletsOf("## 9. Industry pack taxonomy")
  assert.ok(bullets.length > 50, `scanned only ${bullets.length} §9 entries`)
  const quoted = new Set(entries.map((e) => e.line))
  for (const bullet of bullets) {
    assert.ok(quoted.has(bullet), `Bible §9 lists an industry the taxonomy omits: ${bullet}`)
  }
  const stated = new Set(bullets)
  for (const e of entries) {
    assert.ok(stated.has(e.line), `${e.id} names an industry §9 does not list: ${e.line}`)
    assert.ok(text.includes(e.line), `${e.id} quotes a line ${BIBLE} does not contain: ${e.line}`)
  }

  // The requirement's own words: "without claiming implementation". Not one
  // industry pack exists, so not one entry may say otherwise — and the count is
  // asserted as well as the per-entry status, so an entry ADDED with a claim is
  // caught even if the loop above is satisfied by it.
  assert.equal(reg.counts.industryImplemented, 0)
  for (const e of entries) {
    assert.equal(e.status, NOT_IMPLEMENTED, `${e.id} claims "${e.status}" and no industry pack exists`)
    assert.equal(e.coveredBy, null, `${e.id} claims coverage by "${e.coveredBy?.module}"`)
  }

  // The registry carries its own governing sentence, quoted from §9 rather than
  // paraphrased, because the sentence IS the requirement.
  assert.equal(
    reg.industry.preamble,
    "Treat this as a maintained capability registry, not a claim that every pack is implemented.",
  )
  assert.ok(text.includes(reg.industry.preamble))
})

test("PACK-050-002 — the regulated families carry the Bible's own limits, verbatim", () => {
  const reg = committed()
  const text = bible()
  const byId = new Map(reg.industry.families.map((f) => [f.id, f]))

  // Every caveat travels as the Bible wrote it. A paraphrase is a rewrite of a
  // legal limit by whoever was tidying a table.
  for (const family of reg.industry.families) {
    for (const caveat of family.caveats) {
      assert.ok(text.includes(caveat), `§${family.id} carries a caveat ${BIBLE} does not state: ${caveat}`)
    }
  }

  // The three §9 families whose limits are not stylistic. Named individually,
  // by the phrase the Bible uses, so that dropping one is a failure rather than
  // a smaller number nobody reads.
  const mustCarry = [
    ["9.6", "must not claim to replace an EHR"],
    ["9.8", "must not imply it is a core banking"],
    ["9.9", "remain governed external systems until specifically implemented and certified"],
  ]
  for (const [id, phrase] of mustCarry) {
    const family = byId.get(id)
    assert.ok(family, `the taxonomy has no family §${id}`)
    assert.ok(
      family.caveats.some((c) => c.includes(phrase)),
      `§${id} (${family.title}) does not carry its own limit: expected a caveat containing "${phrase}"`,
    )
  }
})
