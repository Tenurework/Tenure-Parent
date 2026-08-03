import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-051-005 — every path that changes something has to make a permission
 * decision, not merely check that somebody is signed in.
 *
 * `entry-points.md` (GE-000-004) already proves every handler has *a* guard.
 * That is a weaker claim than it reads: `session` proves you are signed in and
 * `tenant` proves which tenant you are acting in. Neither proves you may do
 * this. A server action guarded by `session` + `tenant` is reachable by every
 * member of the tenant, and for an action that spends money or changes a roster
 * that is the whole vulnerability.
 *
 * This measures the gap and holds it shut. The number below may only shrink.
 *
 * ## Why it reads the generated inventory rather than the source
 *
 * Guard attribution is genuinely hard: a Next.js layout guards everything
 * nested beneath it, so a page with no guard of its own may be thoroughly
 * guarded. `tools/entry-point-inventory.mjs` already walks the layout chain to
 * work that out, and `test:platform` regenerates it and fails when the
 * committed copy is stale — so it cannot drift. A second implementation of the
 * same attribution here would be a second answer to the same question, and the
 * two would disagree eventually.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const INVENTORY = "docs/architecture/entry-points.md"

/**
 * Paths that change something and prove only that somebody is signed in.
 *
 * MAY ONLY SHRINK. Raising it to make a build pass is the failure this number
 * exists to prevent, and the assertion says so in both directions.
 */
const UNAUTHORIZED_MUTATORS = 31

/**
 * Mutating paths that legitimately have no guard, and why.
 *
 * Named and reasoned, never a pattern. A pattern grows to fit whatever is added
 * next; a name has to be defended when somebody reads it.
 */
const NO_GUARD_BY_DESIGN = {
  signOutAction:
    "Signing out acts on the caller's own session and nothing else. Requiring a guard would " +
    "mean a session too broken to pass one is a session nobody can end, which turns a bad " +
    "cookie into a locked account.",
}

/** Sections of the inventory whose rows can change state. */
const MUTATING_SECTIONS = ["## API routes", "## Server actions"]

/** Verbs that change something. A GET route is a read and is not counted here. */
const MUTATING_VERBS = ["POST", "PUT", "PATCH", "DELETE"]

function inventoryRows() {
  const source = fs.readFileSync(path.join(ROOT, INVENTORY), "utf8")
  const lines = source.split(String.fromCharCode(10))

  const rows = []
  let section = null
  for (const line of lines) {
    if (line.startsWith("## ")) {
      section = line.trim()
      continue
    }
    if (!line.startsWith("|")) continue

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim())
    if (cells.length < 2) continue
    // Header and separator rows.
    if (/^-+$/.test(cells[0].replace(/[:\s]/g, "")) || cells[0] === "Route") continue
    if (cells[0] === "Action" || cells[0] === "Page" || cells[0] === "Guard") continue

    rows.push({ section, name: cells[0], middle: cells[1] ?? "", guards: cells[cells.length - 1] })
  }
  return rows
}

/**
 * Does this row prove more than "somebody is signed in"?
 *
 * `capability` is a permission decision. `shared-secret` is the machine
 * equivalent: there is no principal to decide about on a cron or control-plane
 * path, and the secret proves the caller is the specific machine that holds it.
 * Counting those as debt would mean this ratchet can never reach zero, which is
 * how a ratchet stops being read.
 *
 * `session`, `tenant` and `url-token` are not enough. The first two prove
 * identity and scope; the third proves somebody was sent a link, which is a
 * capability in the object sense and not one this platform decided to confer.
 */
function decidesPermission(row) {
  return /capability|shared-secret/i.test(row.guards)
}

function mutatingRows() {
  return inventoryRows().filter((row) => {
    if (!MUTATING_SECTIONS.includes(row.section)) return false
    if (row.section === "## API routes") {
      // The middle column lists verbs. A route serving only GET is a read.
      return MUTATING_VERBS.some((verb) => row.middle.toUpperCase().includes(verb))
    }
    // Every exported server action is invoked to do something.
    return true
  })
}

test("the inventory is where this test thinks it is, and parses", () => {
  // Every assertion below passes trivially against an empty list, and this list
  // comes from parsing a generated markdown table.
  const rows = inventoryRows()
  assert.ok(
    rows.length >= 40,
    `Parsed ${rows.length} rows out of ${INVENTORY}, expected at least 40. The generator's ` +
      `table shape has changed and this test is now measuring nothing.`,
  )
  assert.ok(
    rows.some((r) => r.section === "## API routes"),
    `No "## API routes" section found in ${INVENTORY}.`,
  )
  assert.ok(
    rows.some(decidesPermission),
    `No row in ${INVENTORY} claims a capability guard, so the detector is not reading the ` +
      `guards column.`,
  )
})

test("the detector separates a permission decision from a session check", () => {
  assert.equal(decidesPermission({ guards: "`session` + `tenant`" }), false)
  assert.equal(decidesPermission({ guards: "`session` + `capability` + `tenant`" }), true)
  assert.equal(decidesPermission({ guards: "`tenant` + `shared-secret`" }), true)
  assert.equal(decidesPermission({ guards: "`tenant` + `url-token`" }), false)
  assert.equal(decidesPermission({ guards: "**none**" }), false)
})

test("mutating paths that only prove a session only shrink", () => {
  const mutators = mutatingRows()
  assert.ok(
    mutators.length >= 20,
    `Found ${mutators.length} mutating paths, expected at least 20. A filter that stops matching ` +
      `reports no debt and passes.`,
  )

  // Paths defended by name below are not debt — they are decided, and counting
  // them would mean this number can never reach zero.
  const excused = new Set(Object.keys(NO_GUARD_BY_DESIGN))
  const unauthorized = mutators
    .filter((row) => !excused.has(row.name.replace(/`/g, "")))
    .filter((row) => !decidesPermission(row))

  assert.ok(
    unauthorized.length <= UNAUTHORIZED_MUTATORS,
    `${unauthorized.length} mutating paths prove only that somebody is signed in, up from ` +
      `${UNAUTHORIZED_MUTATORS}:` +
      String.fromCharCode(10) +
      unauthorized.map((r) => `  ${r.section} ${r.name} — ${r.guards}`).join(String.fromCharCode(10)) +
      String.fromCharCode(10) +
      `This ratchet may only shrink. Authorize the new path rather than raising the number.`,
  )

  assert.equal(
    unauthorized.length,
    UNAUTHORIZED_MUTATORS,
    `${unauthorized.length} unauthorized mutating paths, and the ratchet says ` +
      `${UNAUTHORIZED_MUTATORS}. Lower UNAUTHORIZED_MUTATORS to ${unauthorized.length} — a ` +
      `ratchet that is not tightened when the debt is paid stops meaning anything.`,
  )
})

/**
 * Everything wrong with the set of unguarded paths and the exemptions claiming
 * to cover them.
 *
 * Extracted so the self-test below exercises it. An exemption check that is
 * only ever run against the real, currently-correct data is a check nobody has
 * seen work.
 */
function exemptionProblems(nakedNames, exemptions) {
  const problems = []
  const declared = new Set(Object.keys(exemptions))

  for (const name of nakedNames) {
    if (!declared.has(name)) {
      problems.push(`"${name}" has no guard and no stated reason.`)
    }
  }
  for (const name of declared) {
    if (!nakedNames.includes(name)) {
      problems.push(
        `"${name}" is excused and no longer exists unguarded — an exemption outliving the thing ` +
          `it excused.`,
      )
    }
    const reason = exemptions[name] ?? ""
    if (reason.length <= 60) {
      problems.push(
        `"${name}" is excused with ${reason.length} characters. An exemption nobody explained is ` +
          `one nobody can argue with.`,
      )
    }
  }
  return problems
}

test("the exemption check catches both directions and a bare assertion", () => {
  const good = { a: "x".repeat(61) }
  assert.deepEqual(exemptionProblems(["a"], good), [])

  assert.match(exemptionProblems(["a", "b"], good).join(" "), /"b" has no guard/)
  assert.match(exemptionProblems([], good).join(" "), /outliving the thing/)
  assert.match(exemptionProblems(["a"], { a: "short" }).join(" "), /nobody explained/)
})

test("a mutating path with no guard at all is one somebody named", () => {
  // Distinct from the ratchet above, and not on it. A handler with no guard is
  // reachable by anyone on the internet; one with a session guard is reachable
  // by anyone with an account. The first is not debt to be paid down over time,
  // so it is not counted — it is either defended by name here or it is a
  // finding.
  const naked = mutatingRows()
    .filter((row) => /\*\*none\*\*/i.test(row.guards))
    .map((r) => r.name.replace(/`/g, ""))

  assert.ok(
    Object.keys(NO_GUARD_BY_DESIGN).length > 0,
    "Nothing is excused, so this test is comparing two empty lists and proving nothing.",
  )
  assert.deepEqual(exemptionProblems(naked, NO_GUARD_BY_DESIGN), [])
})
