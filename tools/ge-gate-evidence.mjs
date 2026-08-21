#!/usr/bin/env node
/**
 * The children a `GE-GATE-*` names in its own sentence, and whether any of its
 * children was ever actually decided.
 *
 * `tools/ge-phase-gate-children.mjs` derives a gate's children from the
 * authority's *structure*: the `### GE-XXX:` groups physically inside the
 * `## Phase N —` section that ends in `### Phase N gate`. That is right and it
 * is not complete, because twenty-three of the forty-four gates name a second
 * child set in their *prose*, in another family's namespace, which no section
 * boundary contains:
 *
 *   GE-GATE-19 — "Every `EXT-010-*` item passes …"
 *   GE-GATE-36 — "Every applicable `INT-*` and `PAY-*` gate passes …"
 *   GE-GATE-41 — "Every applicable `TTES-*` gate passes …"
 *
 * Structurally GE-GATE-41 gates six `GE-410-*` rows. Its sentence gates the six
 * `TTES-GATE-*` rows as well, and two of those are `PASS` on real evidence while
 * four are not. Nothing read that sentence, so the gate's recorded reason could
 * name only the `GE-410-*` stubs — a blocker list that omits the family the
 * requirement is actually about.
 *
 * Two further distinctions this module makes and the structural evaluator
 * cannot:
 *
 *  1. **A seeded row is not a decision.** `tools/import-requirements.mjs` writes
 *     every newly imported requirement as three lines — the statement, `Status:
 *     FAIL`, and `Reason: imported from \`<doc>\`; not yet implemented`. That is
 *     the truthful starting state and it means *nobody has looked*. Read back
 *     through `ledgerStatuses()` it is indistinguishable from a requirement
 *     somebody built, tested and found broken. So `GE-GATE-34` computes `FAIL`
 *     over six `GE-340-*` rows that no one has ever opened, asserting evidence
 *     that does not exist. Here a seeded row resolves to undecided, and a gate
 *     over undecided children is `UNDETERMINED` — "we could not look" — exactly
 *     as a child with no row at all already is.
 *
 *  2. **A named band with no members is also "we could not look".** GE-GATE-36
 *     requires every applicable `PAY-*` **gate** to pass. The registry holds 224
 *     `PAY-*` requirements and **zero** `PAY-GATE-*` rows, because the Payments
 *     Bible declares no gate section at all — every other family a GE gate
 *     quantifies over declares between five and twelve. Folding that into a
 *     universally-quantified test makes it vacuously true, and a gate that
 *     passes because its children were never written is the worst answer
 *     available. An empty band forces `UNDETERMINED` and is reported by name.
 *
 * Nothing here writes to the tree and nothing here edits a ledger: the output is
 * the blocker list a `FAIL` row should quote. `tests/architecture/ge-gate-evidence.test.mjs`
 * is the caller that fails CI, and `npm run test:platform` discovers it.
 *
 * Run `node tools/ge-gate-evidence.mjs` for the table.
 */
import fs from "node:fs"
import path from "node:path"

import { ROOT, ledgerStatuses } from "./document-graph.mjs"
import { AUTHORITY, authorityText, ceiling, phases, RANK, ruleSixVerdict } from "./ge-phase-gate-children.mjs"

export const LEDGER_DIR = "docs/implementation"
export const REGISTRY = "docs/architecture/capability-completeness-registry.yaml"

/**
 * The seeder's row, matched whole.
 *
 * `tools/import-requirements.mjs` emits exactly:
 *
 *     - [ ] **<ID>** — <statement>
 *       - Status: FAIL
 *       - Reason: imported from `<document>`; not yet implemented
 *
 * The trailing `(?!\x20)` is what makes this a claim about *evidence* rather
 * than about text: it requires the line after the reason not to be another
 * indented bullet, so a row somebody later added a `Code:`, `Tests:` or
 * `Evidence:` line to stops matching and counts as looked-at. This reads only
 * the shape of an entry; the status still comes from `ledgerStatuses()`, so
 * there is no second status parser here.
 */
export const SEEDED_ROW =
  /^- \[ \] \*\*([A-Z][A-Z0-9]{1,7}-(?:\d{3}-\d{3}|GATE-\d+))\*\* — [^\n]*\n {2}- Status: FAIL\n {2}- Reason: imported from `[^`\n]+`; not yet implemented\n(?!\x20)/gm

/**
 * The template line as it appears in `tools/import-requirements.mjs` — escaped
 * backticks and all, because it lives inside a template literal there. Held
 * here so the test can assert the two files still describe the same row rather
 * than assert against a copy of one of them.
 */
export const SEEDED_REASON_TEMPLATE = "  - Reason: imported from \\`${r.source_document}\\`; not yet implemented"

/**
 * Every requirement whose ledger entry is still the seeded stub and nothing
 * more — imported, never opened.
 */
export function seededRequirements(dir = path.join(ROOT, LEDGER_DIR)) {
  const seeded = new Set()
  if (!fs.existsSync(dir)) return seeded
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith("-ledger.md")) continue
    // A file that does not end in a newline would hide its last entry from a
    // pattern anchored with `\n(?!\x20)`; normalising costs one concatenation.
    const text = fs.readFileSync(path.join(dir, name), "utf8").replace(/\s*$/, "\n")
    for (const m of text.matchAll(SEEDED_ROW)) seeded.add(m[1])
  }
  return seeded
}

/** `- [ ] GE-GATE-36 — Every applicable …` in the authority. */
const GATE_LINE = /^- \[[ xX]\] (GE-GATE-\d+) — (.+)$/gm

/** The sentence each gate states, from the document that states it. */
export function gateStatements(text = authorityText()) {
  const out = new Map()
  for (const m of text.matchAll(GATE_LINE)) out.set(m[1], m[2].trim())
  return out
}

/**
 * The requirement bands a gate's own sentence puts inside a universal
 * quantifier.
 *
 * Only a clause that says its members must **pass** counts. `GE-GATE-18` names
 * `` `GE-*` `` and `` `EXT-*` `` and says they "are unified", which is a claim
 * about the registry rather than about those requirements' statuses; reading it
 * as a child set would make one gate the parent of all 781 GE rows.
 */
const PASS_CLAUSE =
  /\bEvery (?:applicable )?((?:`[A-Z][A-Z0-9]{1,7}(?:-\d{3})?-\*`(?: and )?)+) (item|gate)s? (?:and rehearsal )?pass(?:es)?/g

const BAND = /`([A-Z][A-Z0-9]{1,7}(?:-\d{3})?)-\*`/g

export function bandsNamedBy(statement) {
  const bands = []
  for (const clause of statement.matchAll(PASS_CLAUSE)) {
    const kind = clause[2]
    for (const b of clause[1].matchAll(BAND)) bands.push({ band: b[1], kind })
  }
  return bands
}

/** Every requirement id the generated registry knows about. */
export function registryIds(file = path.join(ROOT, REGISTRY)) {
  const text = fs.readFileSync(file, "utf8")
  return [...text.matchAll(/^ *- id: "([^"]+)"$/gm)].map((m) => m[1])
}

/**
 * The ids a band names.
 *
 * `kind: "gate"` over band `CFG` means the `CFG-GATE-*` rows — the sentence says
 * "gate passes" and the family's gates are what it is quantifying over.
 * `kind: "item"` over band `EXT-010` means the numbered `EXT-010-NNN` rows.
 */
export function bandMembers({ band, kind }, ids) {
  const pattern = kind === "gate" ? new RegExp(`^${band}-GATE-\\d+$`) : new RegExp(`^${band}-\\d{3}$`)
  return ids.filter((id) => pattern.test(id)).sort()
}

/**
 * Every GE gate with both child sets merged, the seeded rows demoted to
 * undecided, and the Rule 6 verdict over the result.
 */
export function evaluateWithEvidence({
  text = authorityText(),
  statuses = ledgerStatuses(),
  seeded = seededRequirements(),
  ids = registryIds(),
} = {}) {
  const statements = gateStatements(text)
  // A seeded row is present-but-unopened, which is the same answer as absent:
  // undefined, so `ruleSixVerdict` files it under `unrecorded`.
  const statusOf = (id) => (seeded.has(id) ? undefined : statuses.get(id)?.status)

  return phases(text)
    .filter((p) => p.gate !== null)
    .map((p) => {
      const statement = statements.get(p.gate) ?? ""
      const named = bandsNamedBy(statement)
      const bands = named.map((n) => {
        const members = bandMembers(n, ids)
        return { ...n, members, statuses: members.map((id) => statusOf(id) ?? "UNDECIDED") }
      })
      const emptyBands = bands.filter((b) => b.members.length === 0).map((b) => `${b.band}-${b.kind.toUpperCase()}-*`)

      const crossFamily = bands.flatMap((b) => b.members)
      const children = [...new Set([...p.children, ...crossFamily])]
      const result = ruleSixVerdict(children, statusOf)

      // A band the sentence quantifies over and the registry cannot populate is
      // an unread child set, not an empty one that trivially satisfies.
      const verdict = emptyBands.length > 0 ? "UNDETERMINED" : result.verdict
      const recorded = statuses.get(p.gate)?.status
      const allowed = ceiling(verdict)

      return {
        gate: p.gate,
        phase: p.phase,
        statement,
        bands,
        emptyBands,
        structural: p.children,
        crossFamily,
        children,
        verdict,
        total: children.length,
        decided: result.decided,
        blocked: result.blocked,
        failing: result.failing,
        // `unrecorded` from Rule 6 is "no row"; here it also carries "seeded row,
        // never opened". Named `undecided` because those are one answer.
        undecided: result.unrecorded,
        recorded: recorded ?? "UNRECORDED",
        allowed,
        overclaims: recorded !== undefined && RANK[recorded] > RANK[allowed],
      }
    })
    .sort((a, b) => a.phase - b.phase)
}

/** The blocker sentence a FAIL row should quote, or "" when the gate is PASS. */
export function blockerSummary(row) {
  const parts = []
  if (row.emptyBands.length > 0) parts.push(`no requirement exists for ${row.emptyBands.join(", ")}`)
  if (row.undecided.length > 0) parts.push(`${row.undecided.length} undecided (${row.undecided.slice(0, 4).join(", ")}${row.undecided.length > 4 ? ` +${row.undecided.length - 4}` : ""})`)
  if (row.failing.length > 0) parts.push(`${row.failing.length} FAIL (${row.failing.slice(0, 4).join(", ")}${row.failing.length > 4 ? ` +${row.failing.length - 4}` : ""})`)
  if (row.blocked.length > 0) parts.push(`${row.blocked.length} BLOCKED_EXTERNAL (${row.blocked.join(", ")})`)
  return parts.join("; ")
}

function pad(s, n) {
  const v = String(s)
  return v.length >= n ? v : v + " ".repeat(n - v.length)
}

export function report(rows = evaluateWithEvidence()) {
  const lines = [
    `Authority: ${AUTHORITY}`,
    "Children = the phase section's own rows PLUS the bands the gate's sentence quantifies over.",
    "A seeded ledger row (imported, never opened) counts as undecided, not as a decided FAIL.",
    "",
    `${pad("GATE", 12)}${pad("RECORDED", 18)}${pad("COMPUTED", 15)}${pad("CHILDREN", 10)}BLOCKERS`,
  ]
  for (const r of rows) {
    lines.push(
      `${pad(r.gate, 12)}${pad(r.recorded, 18)}${pad(r.verdict, 15)}${pad(`${r.decided.length}/${r.total}`, 10)}` +
        (blockerSummary(r) || "every child decided") +
        (r.overclaims ? `  <-- OVER-CLAIMS: ceiling is ${r.allowed}` : ""),
    )
  }
  const withBands = rows.filter((r) => r.bands.length > 0)
  lines.push("")
  lines.push(
    `${rows.length} gates; ${withBands.length} name a cross-family band in their own sentence, ` +
      `adding ${withBands.reduce((n, r) => n + r.crossFamily.length, 0)} children the section structure does not contain.`,
  )
  lines.push(`${rows.filter((r) => r.overclaims).length} recorded above the ceiling their children allow.`)
  return lines.join("\n")
}

if (process.argv[1] && path.basename(process.argv[1]) === "ge-gate-evidence.mjs") {
  console.log(report())
}
