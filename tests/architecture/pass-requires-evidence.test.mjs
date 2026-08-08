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

/**
 * The child ratio a gate claims, in either spelling the ledgers actually use.
 *
 *   - Children: 0 of 5 decided            → { decided: 0, total: 5 }
 *   - **2 of 4 children decided.** …      → { decided: 2, total: 4 }
 *
 * The second spelling is here because reading only the first made the truth
 * check below skip the gates that needed it most: three `PACK-GATE-*` rows
 * stated their ratio this way and every one was WRONG — 010 said 2 of 4 with
 * one child decided, 030 said 3 of 5 with two, 080 said 0 of 5 with three. (A
 * fourth, 060, used a shape this deliberately does not read; see
 * `unparsedChildRatioLines`.) A parser that recognises one spelling does not
 * make the others invalid, it makes them unchecked, and an unchecked ratio is a
 * number a reader believes.
 *
 * What it must keep rejecting is a ratio that is not about children at all:
 * `2901/2901 unit tests` satisfies the gate-evidence rule above and must not be
 * mistaken for a count of finished requirements. Hence the discriminator in
 * both branches — the key is literally `Children`, or the number pair is
 * immediately followed by the word.
 */
export function statedChildRatio(body) {
  const keyed = /^\s*[-*]\s*\*{0,2}Children\*{0,2}\s*:\s*\*{0,2}(\d+)\s*(?:\/|\s+of\s+)\s*(\d+)/m.exec(body)
  if (keyed) return { decided: Number(keyed[1]), total: Number(keyed[2]) }
  const prose = /(\d+)\s*(?:\/|\s+of\s+)\s*(\d+)\s*\*{0,2}\s+child(?:ren)?\b/i.exec(body)
  return prose ? { decided: Number(prose[1]), total: Number(prose[2]) } : null
}

/**
 * Lines that talk about a gate's children with a ratio in them, when nothing in
 * the entry parses as a ratio at all.
 *
 * The residue of the two spellings above. `PACK-GATE-060` writes "A gate is
 * proven by its children, and 0 of 4 are complete" — a child ratio by any
 * reader's understanding, in a shape no parser should be widened to guess at,
 * and wrong (one of its four is PASS). Rather than loosening `statedChildRatio`
 * until it matches English, the entry is asked to say it once in the canonical
 * place. Returns [] when the entry already states a ratio, so this only ever
 * fires on a claim no checker can see.
 */
export function unparsedChildRatioLines(body) {
  if (statedChildRatio(body)) return []
  return body
    .split("\n")
    .filter((line) => /\bchild(?:ren)?\b/i.test(line) && /\d+\s*(?:\/|\s+of\s+)\s*\d+/.test(line))
    .map((line) => line.trim())
}

/**
 * Statuses an entry claims about ANOTHER requirement, in the one shape a
 * checker can read: the id in backticks, then the status.
 *
 *     - Children: 2 of 5 decided — `TTES-040-001` PASS, `TTES-040-003` FAIL
 *
 * Why this exists on top of the ratio check above, which already reads the same
 * line. A ratio is a COUNT, and a count is stable under the one edit this
 * repository actually makes to a decided requirement: a PASS being withdrawn.
 * Two were withdrawn in a single session (`PACK-GATE-000`, `PACK-GATE-020`). A
 * gate saying "2 of 5 — 001 and 002 PASS" while 001 is withdrawn and 003 lands
 * still says 2 of 5, the arithmetic still checks out, and every reader believes
 * the two names rather than the total.
 *
 * `TTES-GATE-040` is the standing proof that per-child prose rots on its own:
 * its `TTES-040-002` paragraph read "nothing" for as long as it took somebody to
 * re-read it, while that child had been decided PASS with an e2e behind it. The
 * ratio caught the count on the next run; nothing was watching the sentence.
 *
 * Deliberately narrow — the status has to FOLLOW the id, optionally through
 * `is`/`was`/`=`. "`PACK-020-001`, the archetype axes it is named for, was FAIL"
 * is prose about a child and is not a claim this reads, because a parser that
 * guessed at English would report findings nobody wrote. The answer to a claim
 * this cannot see is to state it in the canonical shape as well, exactly as
 * `unparsedChildRatioLines` asks for the ratio.
 */
export function statedChildStatuses(body) {
  const out = []
  const re =
    /`([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}-\d+)`\s*(?:=\s*|\bis\s+|\bwas\s+)?\*{0,2}(PASS|FAIL|BLOCKED_EXTERNAL|NOT_APPLICABLE)\b/g
  for (const m of body.matchAll(re)) out.push({ id: m[1], status: m[2] })
  return out
}

/**
 * Paths a ledger entry says do not exist yet, in the shape blockers write them:
 *
 *     ls docs/decisions/ADR-0009-competitive-benchmarking.md   # absent on 2026-08-07
 *
 * A `BLOCKED_EXTERNAL` entry is a claim about the world, and the world moves.
 * This session found `docs/architecture/ux-task-scorecard.md` still recording
 * that `node apps/web/scripts/seed.mjs` aborts on a missing `institutionId`
 * when the seed had since been fixed and runs clean — a blocker that had become
 * false with nothing watching, on an item the loop skips for exactly as long as
 * it stays blocked. A path claimed absent is the one part of such a claim a
 * machine can re-check.
 */
export function absenceClaims(body) {
  const out = []
  const re = /^\s*ls\s+([\w./@-]+)\s*#\s*absent(?:\s+on\s+([\d-]+))?/gm
  for (const m of body.matchAll(re)) out.push({ path: m[1], since: m[2] ?? "" })
  return out
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
  // The prose spelling three PACK gates used, which reading only the keyed form
  // left unchecked — and all three were wrong.
  assert.deepEqual(statedChildRatio("  - **2 of 4 children decided.** PACK-010-001 …"), {
    decided: 2,
    total: 4,
  })
  assert.deepEqual(statedChildRatio("  - Reason: **0 of 5 children decided** — …"), { decided: 0, total: 5 })
  // The gate-evidence rule above accepts any ratio anywhere in the body, which
  // is how "2901/2901 unit tests" reads as a child ratio. This one does not.
  assert.equal(statedChildRatio("  - Evidence: 2901/2901 unit tests"), null)
  assert.equal(statedChildRatio("  - Evidence: 136/136 suites, 3431/3431 tests green"), null)

  // The residue: a ratio about children in a shape the parser is deliberately
  // not widened to guess at.
  assert.deepEqual(unparsedChildRatioLines("  - proven by its children, and 0 of 4 are complete"), [
    "- proven by its children, and 0 of 4 are complete",
  ])
  // Silent once the entry says it in the canonical place, so the two never
  // report the same entry twice.
  assert.deepEqual(
    unparsedChildRatioLines("  - Children: 1 of 4 decided\n  - its children, and 0 of 4 are complete"),
    [],
  )
  // And silent on an entry that never mentions children at all.
  assert.deepEqual(unparsedChildRatioLines("  - Evidence: 136/136 suites"), [])

  assert.deepEqual(absenceClaims("    ls docs/decisions/ADR-0009.md   # absent on 2026-08-07"), [
    { path: "docs/decisions/ADR-0009.md", since: "2026-08-07" },
  ])
  // Not every `ls` is a claim. Only one saying the thing is not there.
  assert.deepEqual(absenceClaims("    ls docs/decisions/"), [])

  // Per-child statuses: the shape that is read, and the shapes that are not.
  assert.deepEqual(
    statedChildStatuses("  - Children: 2 of 5 decided — `TTES-040-001` PASS, `TTES-040-003` FAIL"),
    [
      { id: "TTES-040-001", status: "PASS" },
      { id: "TTES-040-003", status: "FAIL" },
    ],
  )
  assert.deepEqual(statedChildStatuses("  - `TTES-050-002` is BLOCKED_EXTERNAL"), [
    { id: "TTES-050-002", status: "BLOCKED_EXTERNAL" },
  ])
  assert.deepEqual(statedChildStatuses("  - `TTES-040-002` **PASS** — the console refusal"), [
    { id: "TTES-040-002", status: "PASS" },
  ])
  // Prose about a child is not a claim about its status. Widening this to match
  // would make the check report sentences nobody wrote as findings.
  assert.deepEqual(
    statedChildStatuses("  - `PACK-020-001`, the archetype axes it is named for, was FAIL"),
    [],
  )
  assert.deepEqual(statedChildStatuses("  - `TTES-040-002` UI security: decided PASS since"), [])
  // A gate id is not a requirement id and is not checked as one.
  assert.deepEqual(statedChildStatuses("  - `TTES-GATE-040` FAIL"), [])
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

test("an entry that states another requirement's status states the true one", () => {
  // The count is checked above; this checks the NAMES. They fail differently.
  // A ratio goes stale when a child is decided, which is loud — the arithmetic
  // stops adding up on the next run. A named list goes stale when one child is
  // decided and another is withdrawn, which is silent: the total is unchanged
  // and the two sentences a reader actually reads are both wrong. PASSes ARE
  // withdrawn here — two in one session — so that is not a hypothetical.
  const all = entries()
  const status = new Map(all.map((e) => [e.id, e.status]))
  const claims = []
  const wrong = []
  for (const entry of all) {
    for (const claim of statedChildStatuses(entry.body)) {
      // An entry restating its own status is the Status line's job, not this.
      if (claim.id === entry.id) continue
      claims.push(`${entry.id} → ${claim.id}`)
      const actual = status.get(claim.id)
      if (actual === undefined) {
        wrong.push(
          `${entry.file} ${entry.id}: says \`${claim.id}\` is ${claim.status}, and no ledger entry has that id`,
        )
      } else if (actual !== claim.status) {
        wrong.push(`${entry.file} ${entry.id}: says \`${claim.id}\` ${claim.status}, ledger says ${actual}`)
      }
    }
  }
  // Floor, because the finding is an absence: a parser that matched nothing
  // would agree with every ledger forever, and this shape is written in exactly
  // one place today.
  assert.ok(
    claims.length >= 5,
    `Only ${claims.length} per-requirement status claims parsed across the ledgers; the ` +
      "`\\`ID\\` STATUS` shape has changed and this check is no longer reading anything.",
  )
  assert.deepEqual(
    wrong,
    [],
    "A ledger entry names another requirement's status and the ledger disagrees. Re-read the " +
      "requirement rather than editing the number: a gate's named children are what a reader " +
      "believes when the ratio still adds up.",
  )
})

test("a gate is not PASS while a child it gates is undecided", () => {
  // The children are derived from the ids, NOT from whether the entry chose to
  // state a ratio. Reading `statedChildRatio` first was the hole and it was the
  // wrong way round: the single edit that turns a false PASS into an
  // unfalsifiable one — deleting the `Children:` line — also switched off the
  // check that would have caught it. Two gates were already through it when
  // this was fixed. `PACK-GATE-000` was PASS over an inventory (PACK-000-001)
  // and a ledger import (PACK-000-003) that are both FAIL; `PACK-GATE-020` was
  // PASS while `PACK-020-001`, the archetype axes the gate is named for, was
  // FAIL. Neither stated a ratio, so neither was looked at.
  const all = entries()
  const gated = []
  const premature = []
  const unstated = []
  for (const entry of all) {
    const kids = gateChildren(entry.id, entry.file, all)
    if (!kids) continue
    gated.push(entry.id)
    if (entry.status !== "PASS") continue
    const undecided = kids.filter((k) => !DECIDED.has(k.status))
    if (undecided.length > 0) {
      premature.push(`${entry.file} ${entry.id}: ${undecided.map((k) => `${k.id}=${k.status}`).join(", ")}`)
    }
    // A PASS gate has to say what it is claiming, so the ratio-truth check
    // above has something to hold it to on the day a sixth child appears.
    if (!statedChildRatio(entry.body)) {
      unstated.push(`${entry.file} ${entry.id}: PASS with ${kids.length} children and no stated ratio`)
    }
  }
  // Floor: both findings are absences, and a derivation that returned null
  // everywhere would report a clean repository. 182 gate entries exist; the
  // ones whose children are derivable from the ids are the ones checked here.
  assert.ok(gated.length >= 100, `Only ${gated.length} gates have derivable children; the id scheme has changed.`)
  assert.deepEqual(premature, [], "A gate is PASS while requirements it gates are not.")
  assert.deepEqual(unstated, [], "A PASS gate does not say how many of its children are decided.")
})

test("a gate that talks about a child ratio states it where a checker can read it", () => {
  // The escape hatch the two spellings leave. `PACK-GATE-060` said "A gate is
  // proven by its children, and 0 of 4 are complete" — a ratio to every reader,
  // no ratio to any parser, and wrong (PACK-060-001 is PASS). The answer is not
  // a looser parser; it is one canonical line per gate.
  const all = entries()
  const unreadable = []
  for (const entry of all) {
    if (!gateChildren(entry.id, entry.file, all)) continue
    for (const line of unparsedChildRatioLines(entry.body)) {
      unreadable.push(`${entry.file} ${entry.id}: ${line.slice(0, 100)}`)
    }
  }
  assert.deepEqual(
    unreadable,
    [],
    "These gates claim a child ratio in prose nothing checks. State it as `- Children: N of M decided` " +
      "as well, so the ratio-truth assertion above can hold it to the ledger.",
  )
})

test("an entry that says a file is absent is still right about it", () => {
  // A BLOCKED_EXTERNAL entry is a claim about the world, and the loop skips the
  // item for as long as it stands — so a blocker that quietly comes true is the
  // most expensive kind of stale sentence in this repository. One had already:
  // `docs/architecture/ux-task-scorecard.md` recorded the seed aborting on a
  // missing `institutionId` long after the seed was fixed.
  const all = entries()
  const claims = []
  const wrong = []
  for (const entry of all) {
    for (const claim of absenceClaims(entry.body)) {
      claims.push(`${entry.id} → ${claim.path}`)
      if (fs.existsSync(path.join(ROOT, claim.path))) {
        wrong.push(
          `${entry.file} ${entry.id}: says \`${claim.path}\` was absent${claim.since ? ` on ${claim.since}` : ""}, ` +
            `and it now exists — re-decide the item rather than leaving it blocked.`,
        )
      }
    }
  }
  // Floor: a parser that matched nothing would agree with every ledger forever.
  assert.ok(claims.length >= 1, "No entry states a re-checkable absence claim; the `ls … # absent` shape has changed.")
  assert.deepEqual(wrong, [], "A blocker's absence claim has come true and the entry still says it has not.")
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
