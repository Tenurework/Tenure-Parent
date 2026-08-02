import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-040-001 — a membership query that means "now" has to say so.
 *
 * Membership used to be a row that existed or did not, and revoking deleted it.
 * It is now effective-dated, which quietly changes the meaning of **every**
 * existing read: `where: { institutionId }` used to mean "current members" and
 * now means "everyone who has ever been a member, including the ones who were
 * removed".
 *
 * That is not a subtle failure. A revoked director still counts toward the
 * last-director guard; a departed staff member still receives the institution's
 * notifications; a revoked person keeps every capability, because `rbac.ts`
 * resolves institution roles from exactly this table. The change made to
 * preserve history would have preserved access instead.
 *
 * Nine call sites existed when this was written, and this guard found a tenth
 * that a manual sweep had missed — `rbac.ts`, the one every capability check
 * flows through. The dangerous one is the eleventh, added later by someone who
 * has never read this file, so the rule is enforced here rather than remembered.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/**
 * Reads that legitimately span every membership, past and present, with the
 * reason each is exempt. Exemptions are named files, never patterns: a pattern
 * is how the next forgetful query lets itself in.
 */
const EXEMPT = new Map([
  [
    "apps/web/src/lib/platform/tenant-export.ts",
    "A tenant export must contain the tenant's whole history, including memberships that ended. " +
      "Filtering here would produce an export that silently omits the record of everyone who left.",
  ],
  [
    "apps/web/src/lib/identity/live-membership.ts",
    "This file defines the filter. It cannot be required to use itself.",
  ],
])

/** Every source file in apps/web, tracked or merely present. */
function sourceFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "apps/web/src"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.(test|itest)\.tsx?$/.test(file))
}

/** File text with comments stripped, so prose about a query is not a query. */
function code(file) {
  return fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const READ_METHODS = /\binstitutionMembership\s*\.\s*(findMany|findFirst|count|aggregate|groupBy)\s*\(/g

/**
 * The argument text of each membership read in a file.
 *
 * Brace-matched, and checked per call rather than per file. The first version of
 * this guard asked whether the file *mentioned* `liveMembershipWhere` anywhere —
 * which the import line satisfies. Deleting the filter from the query in
 * `rbac.ts` and leaving the import left the guard green, and that is the call
 * site every capability check flows through. A guard that cannot tell use from
 * mention is a guard against typos.
 */
function readCalls(text) {
  const calls = []
  for (const match of text.matchAll(READ_METHODS)) {
    const open = match.index + match[0].length - 1
    let depth = 0
    for (let i = open; i < text.length; i++) {
      if (text[i] === "(") depth++
      else if (text[i] === ")") {
        depth--
        if (depth === 0) {
          calls.push({ method: match[1], body: text.slice(open, i + 1) })
          break
        }
      }
    }
  }
  return calls
}

const USES_FILTER = /liveMembershipWhere\s*\(/

/**
 * Reads that deliberately span revoked rows, keyed by the file and the text
 * that identifies them. Narrow on purpose: the revoke and transfer paths must
 * find a membership in order to end it, and a live filter would make an
 * already-revoked one invisible to the code that reports it as such.
 */
const UNFILTERED_BY_DESIGN = [
  {
    file: "apps/web/src/app/(app)/admin/actions.ts",
    method: "findUnique",
    why: "Revoking and transferring must read a membership whatever its state, in order to change it.",
  },
]

test("every membership read that means 'now' uses the one live filter", () => {
  const offenders = []

  for (const file of sourceFiles()) {
    if (EXEMPT.has(file)) continue
    for (const call of readCalls(code(file))) {
      if (USES_FILTER.test(call.body)) continue
      const excused = UNFILTERED_BY_DESIGN.some((e) => e.file === file && e.method === call.method)
      if (excused) continue
      offenders.push(`${file} — ${call.method}${call.body.replace(/\s+/g, " ").slice(0, 110)}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these membership queries do not filter to live memberships. A membership is now ` +
      `effective-dated, so an unfiltered read includes people who were revoked:\n  ${offenders.join("\n  ")}\n` +
      `Use liveMembershipWhere() from @/lib/identity/live-membership.`,
  )
})

test("the last-director guards count only live directors", () => {
  // The specific regression effective-dating introduces: counting revoked
  // directors would let the last real one be removed because a departed
  // colleague still has a row.
  const counts = readCalls(code("apps/web/src/app/(app)/admin/actions.ts")).filter(
    (call) => call.method === "count",
  )

  assert.ok(counts.length >= 2, `expected both director-count guards, found ${counts.length}`)
  for (const call of counts) {
    assert.ok(
      USES_FILTER.test(call.body),
      `a director count does not filter to live memberships:\n${call.body}`,
    )
  }
})

test("nothing deletes a membership row", () => {
  // Revocation is effective-dating. A delete destroys the record that someone
  // was ever a member, which is what an approval they signed resolves against —
  // and it is what the product's own notification promises does not happen.
  const offenders = []
  for (const file of sourceFiles()) {
    if (/\binstitutionMembership\s*\.\s*(delete|deleteMany)\b/.test(code(file))) offenders.push(file)
  }
  assert.deepEqual(
    offenders,
    [],
    `these files delete a membership instead of effective-dating it:\n  ${offenders.join("\n  ")}`,
  )
})

test("the guard can tell a filtered query from an unfiltered one", () => {
  // Asserted on the extractor itself, because its failure mode is silence: a
  // brace-matcher that returns nothing reports every file as compliant. This is
  // the shape that fooled the first version.
  const filtered = readCalls(`db.institutionMembership.findMany({ where: { ...liveMembershipWhere(), a: 1 } })`)
  const unfiltered = readCalls(
    `import { liveMembershipWhere } from "x"\ndb.institutionMembership.findMany({ where: { a: 1 } })`,
  )

  assert.equal(filtered.length, 1)
  assert.equal(unfiltered.length, 1)
  assert.ok(USES_FILTER.test(filtered[0].body))
  assert.ok(!USES_FILTER.test(unfiltered[0].body), "an import must not count as using the filter")
})

test("every exemption names a real file", () => {
  // An exemption for a file that no longer exists is one nobody has read since
  // it moved, and it silently stops protecting anything.
  for (const file of [...EXEMPT.keys(), ...UNFILTERED_BY_DESIGN.map((e) => e.file)]) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is exempted but does not exist`)
  }
})
