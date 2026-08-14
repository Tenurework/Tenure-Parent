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
// 30 -> 25. Not debt anybody repaid by hand: the inventory learned to see two
// authorization decisions it had been reading straight over — the console's
// `isOperator()` and finance's `decideFinanceAction` — and 5 paths it had been
// counting as naked turned out to be gated all along. The number moved because
// the detector got better, which is the only direction it is allowed to move
// for that reason; a detector that got WORSE would show the same drop and is
// why `the detector separates a permission decision from a session check`
// asserts on both halves.
const UNAUTHORIZED_MUTATORS = 25

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
  // `operator` belongs here, and its absence was invisible while this ran over
  // `apps/web` alone: the platform-operator check exists only in the System
  // Studio, so no row ever carried it. The moment the deployer experience
  // joined the inventory, six console actions that call `isOperator()` —
  // composeTenant, adoptTenantAction, publish, rollback, review, advanceState —
  // read as "proves only that somebody is signed in", which is the opposite of
  // true: it is the strongest gate in the product, and the console has no
  // tenant capabilities to check because it acts on tenants rather than inside
  // one. Counting them as debt would have driven someone to "fix" the console
  // by weakening what operator means.
  return /capability|shared-secret|operator/i.test(row.guards)
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

/* ─────────────────────────────────────────────────────────── STUDIO-020-006 ──
 * The System Studio's own half of "every path authorizes".
 *
 * The inventory above proves a path has *a* guard, and it counts `operator` as
 * a permission decision. That was true when `operator` meant one thing; it is
 * not true now. `isOperator(email)` is a MEMBERSHIP test — it answers "do we
 * know who this is" and nothing else — while `authorizeCommand(...)` decides a
 * named command against a resource, a verb, a tenant, an account, a region and
 * an environment. To the inventory's regex both read as `operator`, so a page
 * reverted from the second to the first would lose every axis of its decision
 * and the guard column would not move.
 *
 * These read the Studio's source directly, which the inventory deliberately
 * does not, and hold the nine sites STUDIO-020-006 converted.
 */

const STUDIO_SRC = path.join(ROOT, "apps/system-studio/src")

/**
 * Source with comments removed.
 *
 * Necessary, not fastidious: `src/app/tenants/actions.ts` and
 * `.../configuration/actions.ts` both explain in prose that they "used to be
 * `isOperator(email)`", and a detector that read a comment as a call would
 * report the two best-converted files in the console as the two worst.
 */
function studioCode(relative) {
  const source = fs.readFileSync(path.join(STUDIO_SRC, relative), "utf8")
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(String.fromCharCode(10))
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join(String.fromCharCode(10))
}

const callsFn = (source, fn) => new RegExp(`\\b${fn}\\s*\\(`).test(source)

/**
 * The nine call sites STUDIO-020-006 names.
 *
 * Listed by name rather than found by a glob. A glob silently stops covering a
 * file somebody moved, and reports the same green it reports when every file is
 * present and correct.
 */
const DECIDING_SITES = [
  "app/page.tsx",
  "app/platform/page.tsx",
  "app/platform/cost/page.tsx",
  "app/tenants/page.tsx",
  "app/tenants/new/page.tsx",
  "app/tenants/[slug]/page.tsx",
  "app/tenants/[slug]/configuration/page.tsx",
  "app/tenants/actions.ts",
  "app/tenants/[slug]/configuration/actions.ts",
]

/**
 * Modules that call `isOperator` for AUTHENTICATION, which is what it is for.
 *
 * `isOperator` is not forbidden — it is exactly `roleOf(...) !== null`, and "is
 * this address Tenure staff" is a real question with real askers. Answering
 * "may they do this" with it is what is forbidden.
 */
const AUTHENTICATION_ONLY = {
  "lib/operators.ts": "Defines it, and defines the role table it is derived from.",
  "app/signin/page.tsx":
    "Redirects an operator who is ALREADY signed in away from the sign-in form. The question is " +
    "literally 'do we know who this is', and there is no resource to decide about yet.",
  "lib/command-handlers.ts":
    "Records whether a named approver is Tenure staff on a four-eyes step. Not a gate on the " +
    "caller — the caller was decided by the command gate — but a fact about a third party " +
    "written into the evidence.",
  "app/api/export/route.ts":
    "The 401 half only: no operator session at all means there is nothing to decide about yet, " +
    "and answering that with a 403 would tell an anonymous caller which surfaces exist. What " +
    "may actually be exported is decided per surface by `authorizeCommand`, which the route " +
    "calls for every one it is asked for — so this is the authentication half sitting in front " +
    "of a real authorization gate, not standing in for one.",
}

/**
 * Studio pages and server actions still gated on membership alone.
 *
 * MAY ONLY SHRINK, and each is named with what it exposes. All five are
 * surfaces added AFTER STUDIO-020-006 converted the nine, so they were never
 * part of that change. They are written down rather than left invisible,
 * because a hole nobody recorded is a hole nobody closes.
 */
const MEMBERSHIP_ONLY_GATES = {
  "app/platform/audit/actions.ts":
    "STUDIO-110-005. `placeHold` and `releaseHold` write a legal hold, so an operator of ANY " +
    "family — auditor-read-only included — can place and lift a preservation order.",
  "app/platform/audit/page.tsx":
    "STUDIO-110-005. Reads every audit chain, its verification and the retention plan it implies.",
  "app/platform/estate/page.tsx":
    "STUDIO-080-001. Its top-level gate is membership; the console deep links it renders are " +
    "already decided with mayAct(role, 'aws.console:read').",
  "app/platform/health/page.tsx":
    "STUDIO-080-008. Reads CloudWatch alarm state across the estate, for every operator family.",
  "app/platform/security/page.tsx":
    "STUDIO-110-006. Reads Security Hub findings across the estate, for every operator family.",
}

const MEMBERSHIP_ONLY_GATE_COUNT = 5

/** Every `.ts`/`.tsx` under the Studio's `src`, relative to it, POSIX-separated. */
function studioModules(dir = STUDIO_SRC, prefix = "") {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...studioModules(path.join(dir, entry.name), rel))
    else if (/\.tsx?$/.test(entry.name)) out.push(rel)
  }
  return out
}

test("the comment stripper does not read prose as a call", () => {
  // Everything below depends on this, and the failure it prevents would make
  // the two best-converted files in the console look like the two worst.
  const stripped = studioCode("app/tenants/actions.ts")
  assert.equal(
    callsFn(stripped, "isOperator"),
    false,
    "`app/tenants/actions.ts` mentions isOperator only in prose; the stripper read it as a call.",
  )
  assert.equal(
    callsFn(stripped, "authorizeCommand"),
    true,
    "The stripper removed the real authorizeCommand call, so it is deleting code and every " +
      "assertion below would pass by seeing nothing at all.",
  )
})

test("the nine sites STUDIO-020-006 converted decide a command, and none checks membership", () => {
  const problems = []
  for (const site of DECIDING_SITES) {
    const source = studioCode(site)
    if (!callsFn(source, "authorizeCommand")) problems.push(`${site} no longer calls authorizeCommand.`)
    if (callsFn(source, "isOperator")) {
      problems.push(
        `${site} calls isOperator. That is the membership test STUDIO-020-006 replaced: it carries ` +
          `no resource, no verb, no tenant, no account and no region, so every operator family ` +
          `decides the same.`,
      )
    }
  }
  assert.deepEqual(problems, [])
})

test("isOperator stays the authentication half and cannot quietly regain authority", () => {
  const source = fs.readFileSync(path.join(STUDIO_SRC, "lib/operators.ts"), "utf8")
  // The body, not the doc comment. STUDIO-020-005 kept `isOperator` as exactly
  // `roleOf(...) !== null` so no call site changed meaning; a body that grew a
  // second clause would be a second authorization model nobody reviewed.
  assert.match(
    source,
    /export function isOperator\([\s\S]{0,240}?\)\s*:\s*boolean\s*\{\s*return roleOf\(email, env\) !== null\s*\}/,
    "isOperator is no longer exactly `return roleOf(email, env) !== null`.",
  )
  for (const name of ["roleOf", "mayAct", "mayView", "OPERATOR_ROLES", "OPERATOR_GRANTS"]) {
    assert.match(
      source,
      new RegExp(`export (function|const) ${name}\\b`),
      `operators.ts no longer exports ${name}.`,
    )
  }
})

test("every other caller of isOperator is named, and the ones gating on it only shrink", () => {
  const callers = studioModules()
    .filter((rel) => !/\.(test|itest|spec)\.tsx?$/.test(rel))
    .filter((rel) => callsFn(studioCode(rel), "isOperator"))

  assert.ok(
    callers.length > 0,
    "Nothing in the Studio calls isOperator at all, so this test is scanning the wrong tree.",
  )

  const named = new Set([...Object.keys(AUTHENTICATION_ONLY), ...Object.keys(MEMBERSHIP_ONLY_GATES)])
  const unnamed = callers.filter((rel) => !named.has(rel))
  assert.deepEqual(
    unnamed,
    [],
    `Callers of isOperator with no stated reason:${String.fromCharCode(10)}` +
      unnamed.join(String.fromCharCode(10)) +
      `${String.fromCharCode(10)}Decide with authorizeCommand, or say here why membership is the ` +
      `whole question.`,
  )

  const gating = callers.filter((rel) => rel in MEMBERSHIP_ONLY_GATES)
  assert.ok(
    gating.length <= MEMBERSHIP_ONLY_GATE_COUNT,
    `${gating.length} Studio surfaces gate on membership alone, up from ` +
      `${MEMBERSHIP_ONLY_GATE_COUNT}. Authorize the new one rather than raising the number.`,
  )
  // Deliberately NOT asserted in the other direction. Each entry is a hole
  // somebody else is converting right now, and a suite that reds the moment one
  // of them is fixed would be a suite arguing against its own subject. Lower
  // MEMBERSHIP_ONLY_GATE_COUNT when they are.
  for (const [name, reason] of Object.entries(MEMBERSHIP_ONLY_GATES)) {
    assert.ok(reason.length > 60, `"${name}" is excused with ${reason.length} characters.`)
  }
})
