import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"

/**
 * A requirement marked PASS has to say what proved it.
 *
 * The Constitution's CI list ends with "a checked requirement lacks evidence",
 * and it is last for a reason: it is the failure that survives every other
 * guard. The document graph can prove a requirement was imported, the
 * reconciler can prove the checkbox matches the ledger, and the ledger can
 * still say PASS because somebody wrote PASS.
 *
 * `PASS` in this repository means twelve things — implemented, connected,
 * authorized, migrated, tested positively and negatively, integrated, deployed,
 * observed, monitored, evidenced, rollback-able, owned. None of that is
 * checkable from a status line. What IS checkable is whether the entry claims
 * anything at all a reader could go and re-run.
 *
 * So this asks for the minimum that makes a claim falsifiable: a PASS entry
 * names evidence, and the evidence contains a number or a command rather than
 * an adjective. "Works well" is not evidence. "2901/2901 unit, 13 mutations, 13
 * caught" is a claim somebody can go and disprove.
 */

const LEDGER_DIR = "docs/implementation"

/** Ledger entries, split the way the ledgers are actually written. */
export function entries() {
  const dir = path.join(ROOT, LEDGER_DIR)
  const out = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith("-ledger.md")) continue
    const text = fs.readFileSync(path.join(dir, name), "utf8")
    for (const chunk of text.split(/\n(?=- \[[ xX]\] \*\*)/)) {
      const id = chunk.match(/^- \[([ xX])\] \*\*([^*]+)\*\*/)
      if (!id) continue
      // `\*{0,2}` because eleven entries write `Status: **BLOCKED_EXTERNAL**`.
      // Without it they read as FAIL here too, and this file's own evidence
      // rules would be applied to the wrong status.
      const declared = chunk.match(/^\s*[-*]\s*Status:\s*\*{0,2}([A-Z_]+)/m)?.[1]
      out.push({
        file: `${LEDGER_DIR}/${name}`,
        id: id[2].trim(),
        checked: id[1].toLowerCase() === "x",
        status: declared ?? (id[1].toLowerCase() === "x" ? "PASS" : "FAIL"),
        body: chunk,
      })
    }
  }
  return out
}

/**
 * Does this entry point at something a reader could re-run or open?
 *
 * A count, a ratio, a path, or a command. Deliberately not a keyword list:
 * "verified", "confirmed" and "complete" are the words that get written when
 * nothing was measured, and a guard that accepted them would pass exactly the
 * entries it exists to catch.
 */
export function citesSomethingCheckable(body, id = "") {
  // A release gate is not a requirement and is not proven the same way. Its
  // evidence is its children — "17 of 17", each carrying its own — so it must
  // state that ratio and does not need a Code or Evidence header of its own.
  // Demanding one would push somebody to copy a child's citation upward, which
  // makes the gate look independently proven when it is not.
  if (/-GATE-/.test(id)) {
    return /\b\d+\s*(?:\/|\s+of\s+)\s*\d+\b/.test(body)
  }

  // `Code/config:` and `Code:` are both used; the header check must not turn a
  // fully-evidenced entry into a finding over a slash.
  if (!/^\s*[-*]\s*\*{0,2}(Evidence|Commit|Code[\w/]*|Tests)\*{0,2}\s*:/m.test(body)) return false

  // Five shapes, and the common property is that a reader can go and look. A
  // count can be re-run, a command can be re-run, a commit can be shown, a path
  // can be opened. The first version of this only accepted the first three and
  // reported a hundred honest entries as unevidenced — GE-000-001 records a
  // worktree state and cites the commit that proves it, which is exactly the
  // right kind of evidence for a requirement about repository state.
  return (
    /\d+\s*\/\s*\d+/.test(body) || // 2901/2901
    /\d+\s+of\s+\d+/.test(body) || // 17 of 17
    /\b\d+\s+(mutations?|tests?|guards?|suites?|items?)\b/i.test(body) || // 13 mutations
    /`[^`]*\b(npm|node|npx|terraform|docker|gh|git|prisma|playwright)\b[^`]*`/.test(body) || // a command
    /`[0-9a-f]{7,40}`/.test(body) || // a commit somebody can `git show`
    /`[\w./-]+\.(ts|tsx|mjs|js|sql|tf|yml|yaml|prisma|md)`/.test(body) // a file to open
  )
}

/**
 * The requirements a gate is the gate for, when the ids say so.
 *
 * `TTES-GATE-040` is the gate over `TTES-040-001…005`, and the ledger says so
 * in the only place it can be checked: the identifiers. Returns null when the
 * family cannot be derived — `GE-GATE-3` gathers four families and names them
 * in prose — because a check that guesses is worse than one that abstains.
 */
export function gateChildren(id, file, all) {
  const m = /^([A-Z]+)-GATE-(\d{3})$/.exec(id)
  if (!m) return null
  const child = new RegExp(`^${m[1]}-${m[2]}-\\d+$`)
  const kids = all.filter((e) => e.file === file && child.test(e.id))
  return kids.length > 0 ? kids : null
}

/** A decided child is one somebody finished with. FAIL is not a decision. */
const DECIDED = new Set(["PASS", "NOT_APPLICABLE"])

/** `- Children: 0 of 5 decided` → `{ decided: 0, total: 5 }`. */
export function statedChildRatio(body) {
  const m = /^\s*[-*]\s*\*{0,2}Children\*{0,2}\s*:\s*\*{0,2}(\d+)\s*(?:\/|\s+of\s+)\s*(\d+)/m.exec(body)
  return m ? { decided: Number(m[1]), total: Number(m[2]) } : null
}

test("the reader finds the ledger entries", () => {
  // Every assertion below passes on an empty list, and this list comes from
  // splitting markdown on a heading shape.
  const all = entries()
  assert.ok(all.length >= 900, `Parsed ${all.length} ledger entries, expected at least 900.`)
  assert.ok(
    all.some((e) => e.status === "PASS"),
    "No entry is PASS, so the evidence rule below is never exercised by real data.",
  )
  assert.ok(
    all.some((e) => e.status === "FAIL"),
    "No entry is FAIL, so the reader is probably matching only one shape.",
  )
})

test("the evidence detector rejects adjectives and accepts measurements", () => {
  // Exercised directly. A detector that returned true for everything would make
  // the real check below vacuous, and it would look identical in CI.
  assert.equal(citesSomethingCheckable("- Evidence: works well, verified end to end"), false)
  assert.equal(citesSomethingCheckable("- Evidence: complete and confirmed"), false)
  assert.equal(citesSomethingCheckable("- Status: PASS"), false, "no Evidence line at all")

  assert.equal(citesSomethingCheckable("- Evidence: 2901/2901 unit across 119 suites"), true)
  assert.equal(citesSomethingCheckable("- Evidence: 13 mutations, 13 caught"), true)
  assert.equal(citesSomethingCheckable("- Evidence: ran `npm run test:platform`, green"), true)
  // Repository state is proven by the commit that shows it, and a code
  // requirement by the file that implements it. Both are openable.
  assert.equal(citesSomethingCheckable("- Evidence: worktree clean\n  - Commit: `5b680ec`"), true)
  assert.equal(citesSomethingCheckable("- Evidence: see `packages/authorization/src/decide.ts`"), true)

  // A gate is proven by its children and states the ratio; it is held to that
  // and not to a citation it would have to borrow from one of them.
  assert.equal(citesSomethingCheckable("every child is complete. 17 of 17.", "GE-GATE-2"), true)
  assert.equal(citesSomethingCheckable("every child is complete.", "GE-GATE-2"), false)
})

test("every PASS entry cites evidence a reader could re-run", () => {
  const unevidenced = entries()
    .filter((e) => e.status === "PASS")
    .filter((e) => !citesSomethingCheckable(e.body, e.id))
    .map((e) => `${e.file} ${e.id}`)

  assert.deepEqual(
    unevidenced,
    [],
    "These requirements are marked PASS and cite nothing checkable:" +
      String.fromCharCode(10) +
      unevidenced.join(String.fromCharCode(10)) +
      String.fromCharCode(10) +
      "An Evidence line naming a count, a ratio or a command is the minimum that makes PASS a " +
      "claim somebody can disprove. Adjectives are not evidence.",
  )
})

test("a checked box and a PASS status agree", () => {
  // Two ways of saying the same thing, and they drift. A ticked entry whose
  // status says otherwise reads as done in the prompt and undone in the ledger,
  // and which one a reader believes depends on which they opened.
  const disagreeing = entries()
    .filter((e) => (e.checked && e.status !== "PASS") || (!e.checked && e.status === "PASS"))
    .map((e) => `${e.file} ${e.id}: checked=${e.checked} status=${e.status}`)

  assert.deepEqual(disagreeing, [], "A ledger entry's checkbox and status disagree.")
})

test("the child-ratio detectors read real shapes and reject invented ones", () => {
  // Exercised directly, because both are allowed to abstain — and a detector
  // that abstains on everything would make the two checks below vacuous while
  // looking identical in CI.
  const all = entries()
  const ttes = "docs/implementation/tenant-experience-execution-ledger.md"
  const kids = gateChildren("TTES-GATE-040", ttes, all)
  assert.ok(kids, "TTES-GATE-040's children could not be derived from the ledger at all.")
  assert.deepEqual(
    kids.map((k) => k.id).sort(),
    ["TTES-040-001", "TTES-040-002", "TTES-040-003", "TTES-040-004", "TTES-040-005"],
    "The gate's children are the TTES-040 requirements; this is the mapping the ratio is checked against.",
  )
  // A gate that gathers several families names them in prose, and is not guessed at.
  assert.equal(gateChildren("GE-GATE-3", "docs/implementation/global-engine-execution-ledger.md", all), null)
  // Not a gate at all.
  assert.equal(gateChildren("TTES-040-001", ttes, all), null)

  assert.deepEqual(statedChildRatio("  - Children: 0 of 5 decided"), { decided: 0, total: 5 })
  assert.deepEqual(statedChildRatio("  - Children: 21/21 PASS"), { decided: 21, total: 21 })
  // The gate-evidence rule above accepts any ratio anywhere in the body, which
  // is how "2901/2901 unit tests" reads as a child ratio. This one does not.
  assert.equal(statedChildRatio("  - Evidence: 2901/2901 unit tests"), null)
})

test("a gate that states its child ratio states the true one", () => {
  // A gate is proven by its children, so the ratio is the whole claim. Written
  // by hand it goes stale the first time a child is decided, and a stale ratio
  // is indistinguishable from a measured one — it is a number, and the
  // evidence rule above is satisfied by a number.
  const all = entries()
  const wrong = []
  for (const entry of all) {
    const stated = statedChildRatio(entry.body)
    if (!stated) continue
    const kids = gateChildren(entry.id, entry.file, all)
    if (!kids) continue
    const decided = kids.filter((k) => DECIDED.has(k.status)).length
    if (stated.total !== kids.length || stated.decided !== decided) {
      wrong.push(
        `${entry.file} ${entry.id}: says ${stated.decided} of ${stated.total}, ledger says ${decided} of ${kids.length}` +
          ` (${kids.map((k) => `${k.id}=${k.status}`).join(", ")})`,
      )
    }
  }
  assert.deepEqual(wrong, [], "A gate's stated child ratio disagrees with the children in the same ledger.")
})

test("a gate is not PASS while a child it counts is undecided", () => {
  const all = entries()
  const premature = []
  for (const entry of all) {
    if (entry.status !== "PASS") continue
    const stated = statedChildRatio(entry.body)
    const kids = stated && gateChildren(entry.id, entry.file, all)
    if (!kids) continue
    const undecided = kids.filter((k) => !DECIDED.has(k.status))
    if (undecided.length > 0) {
      premature.push(`${entry.file} ${entry.id}: ${undecided.map((k) => `${k.id}=${k.status}`).join(", ")}`)
    }
  }
  assert.deepEqual(premature, [], "A gate is PASS while requirements it gates are not.")
})

test("no entry claims a status the loop cannot act on", () => {
  // Was five. `BLOCKED_ARCHITECTURE` is not one the loop can act on — this
  // test's own title says so and it was accepting it anyway, which meant the
  // one word most likely to be written by an agent hitting a schema wall passed
  // here and respun its item forever.
  const KNOWN = ["PASS", "FAIL", "BLOCKED_EXTERNAL", "NOT_APPLICABLE"]
  const unknown = [...new Set(entries().map((e) => e.status))].filter((s) => !KNOWN.includes(s))
  assert.deepEqual(
    unknown,
    [],
    `Statuses outside the vocabulary: ${unknown.join(", ")}. There is deliberately no PARTIAL — ` +
      `an unfinished requirement stays FAIL unless a precise blocker exists.`,
  )
})
