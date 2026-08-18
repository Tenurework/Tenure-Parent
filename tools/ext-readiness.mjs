#!/usr/bin/env node
/**
 * EXT-010-007 — readiness derived from evidence, and the refusal that stops a
 * failed critical gate being painted green by hand.
 *
 * The requirement: *"Implement evidence-derived health/readiness and prevent
 * manual green overrides of failed critical gates."* Its two authorities:
 *
 *   §3.4  > Status is calculated from evidence and child state where possible;
 *         > executives may not manually paint a failed program green.
 *
 *   §11.5 > Readiness dashboards calculate status from gates, not subjective
 *         > percentages. […] Use `READY`, `READY_WITH_ACCEPTED_RISK`,
 *         > `NOT_READY`, or `BLOCKED_EXTERNAL`. Critical gates cannot be
 *         > averaged away by many low-risk green items. Every accepted risk has
 *         > authority, rationale, compensating control, expiry, owner, and
 *         > contingency.
 *
 * ## The programme it scores is this one
 *
 * The implementation programme Tenure is running on itself. Its child state is
 * the 2,265 requirements in the registry; its evidence is the ledger rows. That
 * is not a stand-in for a tenant programme — it is a programme, with the same
 * objects, and it is the one whose evidence exists today.
 *
 * ## What "evidence-derived" actually changes
 *
 * A row saying `Status: PASS` is a claim. A row saying `Status: PASS` under a
 * `Code:` path, a `Tests:` count and an `Evidence:` command is a proven claim.
 * This engine counts only the second, and the difference is not academic: of the
 * PASS rows in this repository today, well under half carry all three. A
 * dashboard reading the status word alone reports a programme far greener than
 * the evidence supports, and reporting the two numbers apart is the entire point.
 *
 * `CLAIMED` is therefore its own outcome, distinct from `FAILED`. "We looked and
 * the evidence is not there" and "the work failed" are different answers.
 *
 * ## The refusals
 *
 * `applyOverride` is the only way a state moves off its evidence, and it refuses:
 *
 *   MANUAL_GREEN              anything asking for `READY`, always. §3.4 admits
 *                             no exception and neither does this.
 *   INCOMPLETE_ACCEPTED_RISK  a risk acceptance missing any of §11.5's six
 *                             fields, or expired, naming each one absent.
 *   RISK_DOES_NOT_NAME_GATE   a critical gate lifted by a risk acceptance
 *                             written about the programme in general. A blanket
 *                             acceptance sweeping a critical gate is the
 *                             averaging §11.5 forbids, wearing a signature.
 *
 * and `programReadiness` never averages: the worst dimension decides, it is
 * named, and `averagedReadiness` exists beside it only so a test can show the
 * two disagree — 14 green dimensions and one red critical gate is NOT_READY.
 *
 *   node tools/ext-readiness.mjs
 */
import fs from "node:fs"
import path from "node:path"

import { ROOT, ledgerStatuses } from "./document-graph.mjs"
import { ledgerRows } from "./ext-ledger-rows.mjs"

export const EXTENSION_PATH = "docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md"
export const REGISTRY_PATH = "docs/architecture/capability-completeness-registry.yaml"

const abs = (p) => path.join(ROOT, p)

/** §11.5's dimension list and its four states, parsed rather than retyped. */
export function readinessVocabulary(text = fs.readFileSync(abs(EXTENSION_PATH), "utf8")) {
  const section = /### 11\.5 Readiness scoring\n([\s\S]*?)\n## /.exec(text)
  if (!section) throw new Error(`§11.5 not found in ${EXTENSION_PATH}`)
  const dims = /Dimensions include ([^.]+)\./.exec(section[1])
  if (!dims) throw new Error("§11.5 states no dimension list")
  const dimensions = dims[1]
    .replace(/,? and /g, ", ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const states = [...section[1].matchAll(/`([A-Z_]+)`/g)].map((m) => m[1])
  return { dimensions, states: [...new Set(states)] }
}

export const { dimensions: DIMENSIONS, states: STATES } = readinessVocabulary()

/**
 * The gates §11.5 calls critical, with why each one is.
 *
 * Critical is not "important". It is "a gate whose failure is not survivable by
 * being outvoted", which is what the sentence about averaging means, so the test
 * for membership is: would shipping with this red be a decision somebody could
 * take by pointing at how much else is green?
 */
export const CRITICAL = {
  "security/privacy": "a live pilot carries real student data; a privacy failure is not offset by any amount of working feature",
  "data/migration": "a conversion that loses or duplicates records is discovered after cutover and cannot be un-run",
  "finance/payroll/banking": "money moves once; an unreconciled ledger or an unproven payment file is not survivable",
  cutover: "the go-live gate itself — averaging it away is the failure mode §11.5 names",
  "legal/contract": "a regulatory or contractual breach is not a percentage",
}

/**
 * Which requirements are evidence for which dimension.
 *
 * By prefix, and for EXT by band, because the extension's own bands are already
 * a subject index. Every prefix must appear: an unbound prefix is a silent hole
 * in every dashboard downstream, so `bindingProblems()` fails on one rather than
 * letting its requirements go uncounted.
 */
export const BINDINGS = [
  { match: /^CFG-/, dimension: "scope/config", why: "the tenant configurator is where scope becomes configuration" },
  { match: /^PACK-/, dimension: "scope/config", why: "archetype packs are scope selected, not code written" },
  { match: /^PLN-/, dimension: "scope/config", why: "planning and decision scope" },
  { match: /^WRK-/, dimension: "scope/config", why: "the work graph is the product's scope surface" },
  { match: /^GE-/, dimension: "code/release", why: "the global engine builds and releases the platform" },
  { match: /^STUDIO-/, dimension: "code/release", why: "the AWS control plane that performs the release" },
  { match: /^TTES-/, dimension: "accessibility/UX", why: "the tenant experience system is the UX authority" },
  { match: /^IER-/, dimension: "security/privacy", why: "identity, eligibility, entitlement and access continuity" },
  { match: /^INT-/, dimension: "integrations", why: "the integration ecosystem and connector certification" },
  { match: /^CAT-/, dimension: "integrations", why: "the connector catalog and connection composer" },
  { match: /^PAY-/, dimension: "finance/payroll/banking", why: "payments, treasury and the Stripe control plane" },
  { match: /^FIN-/, dimension: "finance/payroll/banking", why: "the financial management cloud" },
  {
    match: /^HCM-/,
    dimension: "finance/payroll/banking",
    why: "workforce records are payroll's input, and §11.5 lists no separate workforce dimension — inventing one would put a gate outside the authority",
  },
  { match: /^OPS-/, dimension: "support/operations", why: "the operations cloud" },
  { match: /^ANL-/, dimension: "support/operations", why: "reporting is how operations sees the system; §11.5 lists no analytics dimension" },
  { match: /^SIMON-/, dimension: "external dependencies", why: "the pilot tenant's absorption waits on artifacts only the customer can supply" },

  { match: /^EXT-(000|010)-/, dimension: "scope/config", why: "authority, baseline and the implementation control plane" },
  { match: /^EXT-020-/, dimension: "code/release", why: "environment landscape and promotion by digest" },
  { match: /^EXT-(030|050|080)-/, dimension: "finance/payroll/banking", why: "the universal journal, payroll boundary and bank channel" },
  { match: /^EXT-040-/, dimension: "legal/contract", why: "localization and regulatory content is statutory obligation" },
  { match: /^EXT-060-/, dimension: "data/migration", why: "the migration factory" },
  { match: /^EXT-070-/, dimension: "integrations", why: "high-volume integrations" },
  { match: /^EXT-090-/, dimension: "UAT", why: "end-to-end testing and UAT governance" },
  { match: /^EXT-100-/, dimension: "cutover", why: "cutover and go-live" },
  { match: /^EXT-(110|120)-/, dimension: "support/operations", why: "hypercare, service transition and legacy retirement" },
  { match: /^EXT-(130|140)-/, dimension: "accessibility/UX", why: "the implementation workbench and the Relay copilot are user-facing surfaces" },
  { match: /^EXT-150-/, dimension: "security/privacy", why: "security, privacy, records, reliability and FinOps" },
  { match: /^EXT-160-/, dimension: "code/release", why: "final release and proof" },
  { match: /^EXT-GATE-/, dimension: "scope/config", why: "a band gate is a control-plane object, not a subject of its own" },
]

export const dimensionOf = (id) => BINDINGS.find((b) => b.match.test(id))?.dimension ?? null

/**
 * The three markers a proven row carries. `Caller:` is counted and reported but
 * does not gate, because it entered the row format later than most of these
 * rows were written and requiring it retroactively would mark work unproven for
 * a reason that had not been invented when it was done.
 */
export const EVIDENCE_MARKERS = [
  { name: "Code", re: /^\s*[-*]\s*\**Code\**\s*:/m },
  { name: "Tests", re: /^\s*[-*]\s*\**Tests?\**\s*:/m },
  { name: "Evidence", re: /^\s*[-*]\s*\**Evidence\**\s*:/m },
]
export const CALLER_MARKER = { name: "Caller", re: /^\s*[-*]\s*\**Caller\**\s*:/m }

/**
 * What a requirement's evidence actually is.
 *
 * NO_ROW is not FAILED. FAILED is not CLAIMED. Every one of those three is a
 * different thing to do next, and a dashboard that renders them one colour is
 * why "42 closed" once meant 24.
 */
export function evidenceOf(status, row) {
  if (!row) return { outcome: "NO_ROW", missing: ["a ledger row"] }
  if (status === "NOT_APPLICABLE") return { outcome: "EXCLUDED", missing: [] }
  if (status === "BLOCKED_EXTERNAL") return { outcome: "BLOCKED", missing: [] }
  if (status !== "PASS") return { outcome: "FAILED", missing: [] }
  const missing = EVIDENCE_MARKERS.filter((m) => !m.re.test(row.body)).map((m) => m.name)
  return { outcome: missing.length === 0 ? "PROVEN" : "CLAIMED", missing }
}

/**
 * A dimension's state, from its children's evidence. No percentages.
 *
 * `basis` carries what the four state words cannot: a dimension nothing binds to
 * is NOT_READY, and so is a dimension whose every child failed, and they are not
 * the same situation.
 */
export function dimensionReadiness(entries) {
  const counts = { PROVEN: 0, CLAIMED: 0, FAILED: 0, BLOCKED: 0, EXCLUDED: 0, NO_ROW: 0 }
  for (const e of entries) counts[e.evidence.outcome] += 1
  if (entries.length === 0) {
    return { state: "NOT_READY", basis: "NO_EVIDENCE_SOURCE", counts, why: "no requirement in the registry binds to this dimension, so nothing has been assessed — that is not readiness" }
  }
  const unproven = counts.CLAIMED + counts.FAILED + counts.NO_ROW
  if (unproven === 0 && counts.BLOCKED === 0) return { state: "READY", basis: "ALL_PROVEN", counts, why: "every requirement is proven or excluded" }
  if (unproven === 0) {
    return { state: "BLOCKED_EXTERNAL", basis: "ONLY_BLOCKED_REMAIN", counts, why: `${counts.BLOCKED} requirements wait on an external party and nothing else is unproven` }
  }
  return {
    state: "NOT_READY",
    basis: counts.CLAIMED > 0 && counts.FAILED === 0 && counts.NO_ROW === 0 ? "CLAIMED_WITHOUT_EVIDENCE" : "UNPROVEN_CHILDREN",
    counts,
    why: `${counts.FAILED} failed, ${counts.CLAIMED} claim PASS without Code/Tests/Evidence, ${counts.NO_ROW} have no row`,
  }
}

// ── accepted risk and the override refusal ───────────────────────────────────

/** §11.5's six fields, exactly. */
export const ACCEPTED_RISK_FIELDS = ["authority", "rationale", "compensatingControl", "expiry", "owner", "contingency"]

export function acceptedRiskProblems(risk, now = new Date()) {
  if (!risk) return ["no accepted-risk record"]
  const problems = ACCEPTED_RISK_FIELDS.filter((f) => !risk[f] || String(risk[f]).trim() === "").map((f) => `missing ${f}`)
  if (risk.expiry) {
    const at = new Date(risk.expiry)
    if (Number.isNaN(at.getTime())) problems.push("expiry is not a date")
    else if (at <= now) problems.push(`expired ${risk.expiry}`)
  }
  return problems
}

/**
 * The only door out of the evidence, and it is mostly shut.
 *
 * Returns `{applied:false, refusal, why}` or `{applied:true, state, by}`. It
 * never mutates its argument: a caller that ignores the refusal gets no state
 * change, rather than a state change it forgot to check for.
 */
export function applyOverride(dimension, current, override, now = new Date()) {
  const critical = dimension in CRITICAL
  if (!STATES.includes(override?.to)) {
    return { applied: false, refusal: "UNKNOWN_STATE", why: `${override?.to} is not one of ${STATES.join(", ")}` }
  }
  if (!override.actor || String(override.actor).trim() === "") {
    return { applied: false, refusal: "NO_ACTOR", why: "an override with nobody's name on it is not a decision" }
  }
  if (override.to === "READY" && current.state !== "READY") {
    return {
      applied: false,
      refusal: "MANUAL_GREEN",
      why: `${dimension} is ${current.state} on the evidence (${current.why}); §3.4 does not let ${override.actor} paint that green`,
    }
  }
  if (override.to === "READY_WITH_ACCEPTED_RISK") {
    const problems = acceptedRiskProblems(override.acceptedRisk, now)
    if (problems.length > 0) {
      return { applied: false, refusal: "INCOMPLETE_ACCEPTED_RISK", why: `§11.5 requires all six fields, unexpired: ${problems.join("; ")}` }
    }
    if (critical && override.acceptedRisk.gate !== dimension) {
      return {
        applied: false,
        refusal: "RISK_DOES_NOT_NAME_GATE",
        why: `${dimension} is a critical gate (${CRITICAL[dimension]}); a risk acceptance naming ${override.acceptedRisk.gate ?? "no gate"} cannot lift it`,
      }
    }
    if (current.state === "READY") return { applied: false, refusal: "NOTHING_TO_OVERRIDE", why: `${dimension} is already READY on the evidence` }
    return { applied: true, state: "READY_WITH_ACCEPTED_RISK", by: override.actor }
  }
  // Downgrades take no ceremony. Nobody has ever needed protecting from a
  // programme reporting itself less ready than its evidence allows.
  return { applied: true, state: override.to, by: override.actor }
}

// ── the programme ────────────────────────────────────────────────────────────

const RANK = { NOT_READY: 0, BLOCKED_EXTERNAL: 1, READY_WITH_ACCEPTED_RISK: 2, READY: 3 }

/**
 * Worst dimension decides, and it is named. This is the whole of "critical gates
 * cannot be averaged away": there is no arithmetic here to average with.
 */
export function programReadiness(states) {
  const entries = Object.entries(states)
  if (entries.length === 0) return { state: "NOT_READY", decidedBy: null, why: "no dimensions" }
  const critical = entries.filter(([d]) => d in CRITICAL)
  const pool = critical.some(([, s]) => RANK[s] < RANK.READY) ? critical : entries
  const worst = pool.reduce((a, b) => (RANK[a[1]] <= RANK[b[1]] ? a : b))
  return {
    state: worst[1],
    decidedBy: worst[0],
    critical: worst[0] in CRITICAL,
    why: `${worst[0]} is ${worst[1]}${worst[0] in CRITICAL ? " and is a critical gate" : ""}`,
  }
}

/** The number §11.5 forbids using. Exported only so a test can show it disagrees. */
export function averagedReadiness(states) {
  const values = Object.values(states)
  return values.filter((s) => s === "READY").length / values.length
}

// ── the real programme ───────────────────────────────────────────────────────

export function registryIds(text = fs.readFileSync(abs(REGISTRY_PATH), "utf8")) {
  return [...text.matchAll(/^  - id: "?([A-Z]{2,8}-(?:\d{3}-\d{3}|GATE-\d+))"?/gm)].map((m) => m[1])
}

export function bindingProblems(ids = registryIds()) {
  const unbound = new Set()
  for (const id of ids) if (!dimensionOf(id)) unbound.add(id.replace(/-\d+$/, ""))
  const problems = [...unbound].sort().map((p) => ({ kind: "UNBOUND_REQUIREMENT", detail: `${p}… binds to no §11.5 dimension` }))
  for (const b of BINDINGS) {
    if (!DIMENSIONS.includes(b.dimension)) problems.push({ kind: "DIMENSION_NOT_IN_AUTHORITY", detail: `${b.dimension} is not one of §11.5's ${DIMENSIONS.length}` })
  }
  for (const d of Object.keys(CRITICAL)) {
    if (!DIMENSIONS.includes(d)) problems.push({ kind: "CRITICAL_NOT_A_DIMENSION", detail: `${d} is called critical and is not a §11.5 dimension` })
  }
  return problems
}

/** Every dimension's readiness, computed from the registry's ids and the ledgers' rows. */
export function assessProgramme() {
  const ids = registryIds()
  const statuses = ledgerStatuses()
  const rows = new Map()
  for (const r of ledgerRows()) if (!rows.has(r.id)) rows.set(r.id, r)

  const byDimension = new Map(DIMENSIONS.map((d) => [d, []]))
  for (const id of ids) {
    const d = dimensionOf(id)
    if (!d || !byDimension.has(d)) continue
    byDimension.get(d).push({ id, status: statuses.get(id)?.status ?? null, evidence: evidenceOf(statuses.get(id)?.status ?? null, rows.get(id) ?? null) })
  }
  const readiness = {}
  for (const [d, entries] of byDimension) readiness[d] = { ...dimensionReadiness(entries), dimension: d, critical: d in CRITICAL, size: entries.length }
  return readiness
}

if (process.argv[1] && path.basename(process.argv[1]) === "ext-readiness.mjs") {
  const problems = bindingProblems()
  const readiness = assessProgramme()
  const states = Object.fromEntries(Object.entries(readiness).map(([d, r]) => [d, r.state]))
  const width = Math.max(...DIMENSIONS.map((d) => d.length))
  for (const d of DIMENSIONS) {
    const r = readiness[d]
    console.log(
      `${d.padEnd(width)}  ${r.critical ? "!" : " "} ${r.state.padEnd(24)} ${String(r.size).padStart(4)} reqs  ` +
        `proven ${r.counts.PROVEN}, claimed ${r.counts.CLAIMED}, failed ${r.counts.FAILED}, blocked ${r.counts.BLOCKED}, no row ${r.counts.NO_ROW}`,
    )
  }
  const overall = programReadiness(states)
  console.log(`\nProgramme: ${overall.state} — ${overall.why}.`)
  console.log(
    `The percentage §11.5 forbids would read ${(averagedReadiness(states) * 100).toFixed(0)}% ready. ` +
      `It is not used, and "! " marks the gates it could never have outvoted.`,
  )
  console.log(`${problems.length} binding problems.`)
  for (const p of problems) console.log(`  ✗ ${p.kind}: ${p.detail}`)
  process.exit(problems.length === 0 ? 0 : 1)
}
