import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-020-005 — the consolidation plan has to keep describing the code.
 *
 * `docs/migrations/duplicate-sources.json` names, for every fact this schema
 * stores twice, which source is authoritative and which is on the way out. A
 * plan like that is accurate on the day it is written and decays silently: a
 * new `tx.budget.update` in a server action does not fail anything, does not
 * appear in review as a duplicate, and quietly makes the migration plan wrong.
 * By the time the migration runs, the file says a table has no writers and the
 * table has three.
 *
 * So the writer sets are recomputed here from the codebase and compared.
 *
 * ## Strict where one instance is the whole risk
 *
 * A `deprecated` or `parallel` source is matched EXACTLY, in both directions. A
 * new writer fails, and so does a listed writer that no longer writes — a stale
 * allowlist naming a deleted file silently covers whatever is written at that
 * path next, which is the lesson from the estate-exemption list in GE-012-001.
 *
 * A `canonical` source is held to a floor of one writer rather than an exact
 * list. `AuditEvent` has twenty and legitimately grows; pinning it would mean
 * updating this file in most commits, and a guard that churns is a guard people
 * satisfy without reading. The floor still catches the case that matters:
 * a canonical source nothing writes is either dead or unwired, and both have to
 * be declared rather than discovered during a migration.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const REGISTRY = path.join(ROOT, "docs/migrations/duplicate-sources.json")

const registry = JSON.parse(fs.readFileSync(REGISTRY, "utf8"))

/** Prisma's delegate name for a model: first letter lowercased. */
const delegateOf = (model) => model[0].toLowerCase() + model.slice(1)

const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]
const SEARCH_ROOTS = ["apps/web/src", "apps/web/scripts", "packages"]

/**
 * Files that write a model, through ANY handle.
 *
 * The handle is `[A-Za-z_$][A-Za-z0-9_$]*` rather than `db`, and that is the
 * whole point: the writes that matter most happen through a `tx.` handle inside
 * `db.$transaction`, and a pattern anchored on `db.` misses every one of them.
 * An earlier draft of this guard did exactly that and reported `OutboxEvent`
 * and `Budget` as having writers it had not found, for the wrong reason.
 */
function writersOf(model) {
  const pattern = `(^|[^A-Za-z0-9_$])[A-Za-z_$][A-Za-z0-9_$]*\\.${delegateOf(model)}\\.(${WRITE_METHODS.join("|")})\\(`
  let out = ""
  try {
    out = execFileSync(
      "git",
      ["grep", "-lE", pattern, "--", ...SEARCH_ROOTS],
      { cwd: ROOT, encoding: "utf8" },
    )
  } catch (err) {
    // git grep exits 1 for "no matches", which is an answer and not a failure.
    if (err.status !== 1) throw err
    return []
  }
  return out
    .split("\n")
    .filter(Boolean)
    // A test is not a source of production fact. Including them would make the
    // registry churn every time a table gains a test, for no safety.
    .filter((f) => !/\.(test|itest|spec)\.[cm]?[jt]sx?$/.test(f))
    .map((f) => f.replace(/^apps\/web\//, ""))
    .sort()
}

const allSources = registry.families.flatMap((f) => f.sources.map((s) => ({ ...s, fact: f.fact })))

test("every model named in the plan exists in the schema", () => {
  const schema = fs.readFileSync(path.join(ROOT, "apps/web/prisma/schema.prisma"), "utf8")
  for (const source of allSources) {
    assert.match(
      schema,
      new RegExp(`^model ${source.model} \\{`, "m"),
      `${source.fact}: the plan names ${source.model}, which is not a model. A migration plan ` +
        `referring to a table that does not exist is a plan nobody can execute.`,
    )
  }
})

test("a deprecated, unwired or parallel source has exactly the writers the plan says", () => {
  for (const source of allSources) {
    if (source.role === "canonical") continue
    const actual = writersOf(source.model)
    assert.deepEqual(
      actual,
      [...source.writers].sort(),
      `${source.fact}/${source.model} (${source.role}): the plan lists ${JSON.stringify(source.writers)} ` +
        `and the codebase has ${JSON.stringify(actual)}.\n` +
        `  A NEW writer means the source being consolidated is spreading — add the write to the ` +
        `canonical source instead, or change the verdict in ${path.relative(ROOT, REGISTRY)} and say why.\n` +
        `  A MISSING writer means the list is stale, which is worse than wrong: an entry naming a ` +
        `deleted file silently covers whatever is written at that path next.`,
    )
  }
})

test("an unwired source has no writers, because that is what unwired means", () => {
  const unwired = allSources.filter((s) => s.role === "unwired")

  // The floor here used to be `unwired.length > 0`, with the message "the plan
  // should still record OutboxEvent as unwired, or explain what changed". This
  // is that explanation: PACK-060-001 wired OutboxEvent's write half —
  // `approvals/actions.ts` publishes inside the same transaction as the status
  // change — so it is `canonical` now and no source is unwired. The list being
  // empty is the codebase having improved, not the plan having gone stale.
  //
  // The floor is not simply deleted, because a loop over an empty array passes
  // forever and proves nothing. What it was really protecting against is a
  // broken `writersOf` reporting every source as writer-free, and that is
  // asserted directly instead — which is a stronger check than the presence of
  // a fixture, and it does not go stale the next time a source is wired.
  assert.ok(
    writersOf("AuditEvent").length > 0,
    "writersOf found nothing writing AuditEvent, which many files write. The scan is broken, so " +
      "the loop below would find no writers for anything and pass emptily.",
  )

  for (const source of unwired) {
    assert.deepEqual(
      writersOf(source.model),
      [],
      `${source.model} is recorded as unwired but something writes it now. That is good news — ` +
        `change its role to canonical and correct the GE-021-006 note in the ledger.`,
    )
  }
})

test("a canonical source is written by something", () => {
  for (const source of allSources) {
    if (source.role !== "canonical") continue
    const actual = writersOf(source.model)
    assert.ok(
      actual.length >= 1,
      `${source.fact}/${source.model} is the canonical source for "${source.fact}" and nothing writes it. ` +
        `Either it is dead, or it is built and not connected — OutboxEvent was the second and had a table, ` +
        `a dispatch loop, retries, a dead-letter path and tests, with no adapter. Declare it: role "unwired".`,
    )
  }
})

test("every family names more than one source, or it is not a duplicate", () => {
  for (const family of registry.families) {
    assert.ok(
      family.sources.length >= 2,
      `${family.fact} lists ${family.sources.length} source(s). A family with one source is not a ` +
        `duplicate and does not belong in this file.`,
    )
  }
})

test("every family says what happens to the data before anything is dropped", () => {
  // The item is "do not delete historical data blindly". A verdict with no
  // pre-drop check is exactly that.
  for (const family of registry.families) {
    assert.ok(
      Array.isArray(family.beforeAnyDrop) && family.beforeAnyDrop.length > 0,
      `${family.fact} has a verdict of ${family.verdict} and no beforeAnyDrop. Say what is lost, ` +
        `even when the answer is "nothing is dropped in this family".`,
    )
    assert.ok(family.plan?.length > 0, `${family.fact} has no plan`)
    assert.ok(family.reason?.length > 40, `${family.fact} has no reason worth reading`)
  }
})

test("the readable plan matches the data it is generated from", () => {
  // The one thing this item must not do is store its own deliverable twice.
  // docs/migrations/DUPLICATE-SOURCES.md is rendered from the JSON; if someone
  // edits the Markdown, the guard reads one plan and the human reads another.
  execFileSync("node", ["tools/duplicate-sources-doc.mjs", "--check"], { cwd: ROOT, stdio: "pipe" })
})

test("the six duplicated facts the item names are all covered", () => {
  // GE-020-005 enumerates them: person, member, role, approval, audit, finance.
  // "member" is recorded as "seat" because that is what the schema calls it and
  // renaming it in the plan would make the plan harder to match to the code.
  assert.deepEqual(
    registry.families.map((f) => f.fact).sort(),
    ["approval", "audit", "finance", "person", "role", "seat"],
  )
})
