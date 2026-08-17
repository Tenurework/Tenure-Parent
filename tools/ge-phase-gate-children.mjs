#!/usr/bin/env node
/**
 * What a `GE-GATE-*` row is allowed to say, computed from the phase it gates.
 *
 * The Unified Global Engine master prompt states the rule in §4.6 of its
 * checkbox protocol, and states it as a one-directional ceiling:
 *
 *   "A phase gate stays unchecked until every required child is checked or
 *    validly `BLOCKED_EXTERNAL` without weakening an invariant."
 *
 * Forty-four `GE-GATE-*` rows exist and nothing was checking that rule against
 * any of them. `tests/architecture/pass-requires-evidence.test.mjs` already
 * enforces it for the other families, but its child derivation is
 * `^([A-Z]+)-GATE-(\d{3})$` → `PREFIX-NNN-\d+`, which needs a three-digit gate
 * number sharing digits with its children. `TTES-GATE-040` gates `TTES-040-*`
 * and works. `GE-GATE-2` gates `GE-020-*`, `GE-021-*` and `GE-022-*`, matches
 * neither the id shape nor the digits, and so returns null — every GE gate is
 * invisible to that guard, including the two recorded `PASS`.
 *
 * The mapping is not guessable from the identifiers, and it does not have to be
 * guessed: the authority document declares it structurally. Each `## Phase N —`
 * heading contains the `### GE-XXX:` groups belonging to that phase and ends
 * with a `### Phase N gate` naming exactly one `GE-GATE-N`. This module reads
 * that structure, so the child set comes from the document that owns it rather
 * than from a heuristic over digits.
 *
 * Two properties this deliberately keeps:
 *
 *  - A gate may be recorded WORSE than its children. Several carry a clause
 *    beyond "every child passes" — `GE-GATE-0`'s is "no credential or customer
 *    data was exposed", and its fourteen children are all PASS while the gate is
 *    honestly BLOCKED_EXTERNAL over a disclosure that is a person's to decide.
 *    A check asserting recorded === computed would demand that row be flipped to
 *    PASS, which is the opposite of the rule. Only the ceiling is enforced.
 *
 *  - "We could not look" is not "we looked and found nothing". A phase whose
 *    children include an id with no ledger row at all resolves to UNDETERMINED,
 *    not FAIL: the former says the evidence was never read, the latter says it
 *    was read and was bad, and collapsing them would let a missing row present
 *    as a decided failure.
 *
 * Run `node tools/ge-phase-gate-children.mjs` for the table. Nothing here writes
 * to the tree; `tests/architecture/ge-phase-gate-rule-six.test.mjs` is the
 * caller that fails CI.
 */
import fs from "node:fs"
import path from "node:path"

import { ROOT, ledgerStatuses } from "./document-graph.mjs"

/**
 * The authority. Read by name and not discovered, because there are two copies
 * in the tree — `Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0 (1).md`
 * is a download duplicate — and a glob would pick whichever the filesystem
 * happened to hand back first.
 */
export const AUTHORITY = "Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md"

/** The sentence this module implements, quoted so a reader need not go looking. */
export const RULE_SIX =
  "A phase gate stays unchecked until every required child is checked or validly " +
  "`BLOCKED_EXTERNAL` without weakening an invariant."

/** `## Phase 12 — Low-code, SDK extensions, and Marketplace shell` */
const PHASE_HEADING = /^## Phase (\d+) — (.+)$/m

/** `- [ ] GE-120-001 — Support custom objects…` — a child requirement of the enclosing phase. */
const CHILD = /^- \[[ xX]\] (GE-\d{3}-\d{3})\b/gm

/** `- [ ] GE-GATE-12 — Declarative/low-code…` — the phase's own gate. */
const GATE = /^- \[[ xX]\] (GE-GATE-\d+)\b/gm

export function authorityText() {
  return fs.readFileSync(path.join(ROOT, AUTHORITY), "utf8")
}

/**
 * The phases the authority declares, each with its gate and its children.
 *
 * Split on the phase heading rather than scanned line by line, so a child can
 * only ever be attributed to the phase whose section physically contains it.
 * The prose before `## Phase 0` also carries `- [ ]` lines (§5's global
 * operating rules) and they are correctly outside every phase: they carry no
 * identifier, and this only reads identified rows.
 */
export function phases(text = authorityText()) {
  const out = []
  // A split with one capture group per heading part yields
  // [preamble, "0", "title", body, "1", "title", body, …] — so 1 + 3N entries,
  // and the last triple starts at 3N-2.
  const parts = text.split(new RegExp(PHASE_HEADING.source, "m"))
  for (let i = 1; i + 2 <= parts.length - 1; i += 3) {
    const number = Number(parts[i])
    const title = parts[i + 1]
    const body = parts[i + 2] ?? ""
    const children = [...body.matchAll(CHILD)].map((m) => m[1])
    const gates = [...body.matchAll(GATE)].map((m) => m[1])
    out.push({
      phase: number,
      title: title.trim(),
      gate: gates.length === 1 ? gates[0] : null,
      gates,
      children,
    })
  }
  return out
}

/** The four statuses the protocol allows, plus the one this module adds for an unread child. */
export const DECIDED = new Set(["PASS", "NOT_APPLICABLE"])

/**
 * Rule 6 over a phase's children.
 *
 * `statusOf` is a function so the caller decides where truth comes from — the
 * ledgers in production, a literal map in the tests. It returns undefined for a
 * child with no row, which is the case that must not be read as FAIL.
 */
export function ruleSixVerdict(children, statusOf) {
  const decided = []
  const blocked = []
  const failing = []
  const unrecorded = []
  for (const id of children) {
    const status = statusOf(id)
    if (status === undefined) unrecorded.push(id)
    else if (DECIDED.has(status)) decided.push(id)
    else if (status === "BLOCKED_EXTERNAL") blocked.push(id)
    else failing.push(id)
  }
  let verdict
  // Order is the whole point. A phase with one unread child and forty failing
  // ones is still UNDETERMINED, because the unread child could be the one that
  // matters and nobody has looked at it.
  if (children.length === 0) verdict = "UNDETERMINED"
  else if (unrecorded.length > 0) verdict = "UNDETERMINED"
  else if (failing.length > 0) verdict = "FAIL"
  else if (blocked.length > 0) verdict = "BLOCKED_EXTERNAL"
  else verdict = "PASS"
  return { verdict, total: children.length, decided, blocked, failing, unrecorded }
}

/**
 * How good a status is, so "recorded no better than the children allow" is one
 * comparison. `UNDETERMINED` sits at the floor with FAIL: a gate whose evidence
 * has not been read may not claim to be blocked either, because
 * `BLOCKED_EXTERNAL` is a positive claim that the only thing left is a person's
 * decision, and that claim needs the children read to make.
 */
export const RANK = { FAIL: 0, UNDETERMINED: 0, BLOCKED_EXTERNAL: 1, NOT_APPLICABLE: 2, PASS: 3 }

/** The best status a gate over these children may be recorded as. */
export function ceiling(verdict) {
  return verdict === "PASS" ? "PASS" : verdict === "BLOCKED_EXTERNAL" ? "BLOCKED_EXTERNAL" : "FAIL"
}

/**
 * Every GE gate, its children, the Rule 6 verdict over them, and what the
 * ledger records — one row per gate, sorted by phase.
 */
export function evaluate({ text = authorityText(), statuses = ledgerStatuses() } = {}) {
  const statusOf = (id) => statuses.get(id)?.status
  return phases(text)
    .filter((p) => p.gate !== null)
    .map((p) => {
      const result = ruleSixVerdict(p.children, statusOf)
      const recorded = statusOf(p.gate)
      const allowed = ceiling(result.verdict)
      return {
        gate: p.gate,
        phase: p.phase,
        title: p.title,
        recorded: recorded ?? "UNRECORDED",
        ...result,
        allowed,
        // Undefined recorded is its own finding (`unrecordedGates`), not an
        // over-claim; `RANK[undefined]` would be NaN and compare false anyway,
        // so this is explicit rather than accidental.
        overclaims: recorded !== undefined && RANK[recorded] > RANK[allowed],
      }
    })
    .sort((a, b) => a.phase - b.phase)
}

/** Gates the authority names that no ledger has a row for. */
export function unrecordedGates(rows = evaluate()) {
  return rows.filter((r) => r.recorded === "UNRECORDED").map((r) => r.gate)
}

function pad(s, n) {
  return String(s).length >= n ? String(s) : String(s) + " ".repeat(n - String(s).length)
}

export function report(rows = evaluate()) {
  const lines = [
    `Rule 6 — ${RULE_SIX}`,
    `Authority: ${AUTHORITY}`,
    "",
    `${pad("GATE", 12)}${pad("RECORDED", 18)}${pad("CHILDREN", 10)}${pad("COMPUTED", 18)}DETAIL`,
  ]
  for (const r of rows) {
    const detail =
      r.unrecorded.length > 0
        ? `no ledger row for ${r.unrecorded.slice(0, 3).join(", ")}${r.unrecorded.length > 3 ? ` +${r.unrecorded.length - 3}` : ""}`
        : r.failing.length > 0
          ? `${r.failing.length} FAIL: ${r.failing.slice(0, 3).join(", ")}${r.failing.length > 3 ? ` +${r.failing.length - 3}` : ""}`
          : r.blocked.length > 0
            ? `${r.blocked.length} BLOCKED_EXTERNAL: ${r.blocked.join(", ")}`
            : "every child decided"
    lines.push(
      `${pad(r.gate, 12)}${pad(r.recorded, 18)}${pad(`${r.decided.length}/${r.total}`, 10)}${pad(r.verdict, 18)}${detail}` +
        (r.overclaims ? `  <-- OVER-CLAIMS: ceiling is ${r.allowed}` : ""),
    )
  }
  const over = rows.filter((r) => r.overclaims)
  lines.push("")
  lines.push(`${rows.length} gates, ${over.length} recorded above the ceiling their children allow.`)
  return lines.join("\n")
}

function main() {
  console.log(report())
}

// Basename rather than a resolved-URL comparison: `new URL(import.meta.url).pathname`
// is `/C:/…` on Windows and needs a slice that is wrong on POSIX, and getting
// that wrong makes the module print its table on every import — including from
// the test, which would then pass while reading nothing.
if (process.argv[1] && path.basename(process.argv[1]) === "ge-phase-gate-children.mjs") {
  main()
}
