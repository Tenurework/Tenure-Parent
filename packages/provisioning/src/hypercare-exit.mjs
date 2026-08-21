/**
 * EXT-110-007 — the criteria hypercare exits on, and the evidence behind each.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §13.5
 * opens with two words that decide the shape of this module: "Hypercare exits
 * **only when**", followed by seven bullets. It is a conjunction, not a score.
 * There is no weighting here and no percentage, because a readiness percentage
 * is what lets six satisfied criteria carry an unsatisfied one over the line.
 *
 * ── Three verdicts, and `UNKNOWN` blocks ───────────────────────────────────
 *
 * Every criterion answers `SATISFIED`, `BLOCKED` or `UNKNOWN`, and the third is
 * the one carrying the requirement: "the reconciliations all passed" and "nobody
 * told us whether the reconciliations ran" are different answers, and a gate
 * that collapses them hands operational ownership over on the strength of a
 * field somebody forgot. `purge-gate.ts` makes exactly this argument for tenant
 * purge; the argument is cited rather than the code reused, because that module
 * is a TypeScript gate over a different document's checks and importing it would
 * bind §13.5's exit to GE-103's lifecycle.
 *
 * `UNKNOWN` blocks exit exactly as `BLOCKED` does, and is reported separately so
 * that the answer is "go and publish this fact" rather than "argue with a
 * refusal".
 *
 * ── What is deliberately NOT decided here ──────────────────────────────────
 *
 * §13.5's last bullet is the transition sign-off, and its immutable-manifest
 * half is EXT-110-008 — a separate requirement, not claimed by this module. What
 * `signoff` checks is §13.5's own sentence: that both the customer and the
 * Tenure service owner signed. Whether the manifest they signed is immutable is
 * -008's question and this module does not answer it.
 *
 * §13.5's closing paragraph — unfinished optimization moving to a governed
 * success roadmap — is EXT-110-009 and is likewise not claimed here.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * Same reason as `cutover-runbook.mjs`: Node 20, which CI pins, cannot load
 * TypeScript, and both readers run there.
 */

import { RISK_LEVELS, registerProblems, stateOf } from "./hypercare-workarounds.mjs"

/** The three answers. `UNKNOWN` is not a soft `SATISFIED`. */
export const VERDICTS = Object.freeze(["SATISFIED", "BLOCKED", "UNKNOWN"])

/**
 * §13.5's handover list, in the document's order.
 *
 * Twelve items, listed here rather than summarised as "operational handover",
 * because the summary is what lets a handover with no DR runbook and no
 * certificate-renewal calendar be reported as done. `phrase` is the document's
 * own word so the list can be checked against §13.5 rather than trusted.
 */
export const HANDOVER_ITEMS = Object.freeze([
  "monitoring",
  "alerts",
  "runbooks",
  "access",
  "serviceCatalog",
  "backupRestore",
  "disasterRecovery",
  "certificateAndSecretRenewals",
  "batchCalendars",
  "vendorContacts",
  "escalationPaths",
])

/** The severities §13.5's first bullet names. */
export const BLOCKING_SEVERITIES = Object.freeze(["S0", "S1"])

/**
 * §13.5's seven bullets, each with the document's own sentence and the evaluator
 * that answers it.
 *
 * The `phrase` is here so a reader can check the list against §13.5; the `key`
 * is what a caller fills in. A criterion whose facts are absent answers
 * `UNKNOWN` — never `SATISFIED`, and never silently omitted from the result.
 */
export const EXIT_CRITERIA = Object.freeze([
  Object.freeze({
    key: "defects",
    phrase: "No unresolved S0/S1 and no unaccepted S2.",
  }),
  Object.freeze({
    key: "businessCycles",
    phrase:
      "Critical business cycles complete and reconcile, including payroll/bank/month-end where in scope or an agreed observation window substitutes.",
  }),
  Object.freeze({
    key: "thresholds",
    phrase:
      "Reliability, performance, integration, security, data quality, support SLA, and cost remain within threshold for the agreed period.",
  }),
  Object.freeze({
    key: "workarounds",
    phrase:
      "Workarounds and residual defects have owners, risk acceptance, deadlines, and support documentation.",
  }),
  Object.freeze({
    key: "handover",
    phrase:
      "Monitoring, alerts, runbooks, access, CMDB/service catalog, backup/restore, DR, certificate/secret renewals, batch calendars, vendor contacts, and escalation paths are handed over.",
  }),
  Object.freeze({
    key: "knowledge",
    phrase:
      "Knowledge-transfer sessions and support simulations pass; accepting support seats attest readiness.",
  }),
  Object.freeze({
    key: "signoff",
    phrase: "Customer and Tenure service owners sign the transition evidence manifest.",
  }),
])

const named = (value) => typeof value === "string" && value.trim().length > 0
const isList = (value) => Array.isArray(value)

const verdict = (key, v, detail) => Object.freeze({ criterion: key, verdict: v, detail })

/** ── the seven evaluators ─────────────────────────────────────────────── */

function defectsVerdict(facts) {
  const defects = facts?.defects
  if (!isList(defects)) {
    return verdict(
      "defects",
      "UNKNOWN",
      "No defect list was supplied. An exit taken without looking at the defect list is not an " +
        "exit with no defects.",
    )
  }
  const open = defects.filter((d) => d?.resolved !== true)
  const blocking = open.filter((d) => BLOCKING_SEVERITIES.includes(String(d?.severity).trim()))
  if (blocking.length > 0) {
    return verdict(
      "defects",
      "BLOCKED",
      `${blocking.length} unresolved ${BLOCKING_SEVERITIES.join("/")} defect(s): ` +
        `${blocking.map((d) => d.id ?? "(unidentified)").join(", ")}.`,
    )
  }
  const unaccepted = open.filter(
    (d) => String(d?.severity).trim() === "S2" && !named(d?.acceptedBy),
  )
  if (unaccepted.length > 0) {
    return verdict(
      "defects",
      "BLOCKED",
      `${unaccepted.length} open S2 defect(s) with nobody named as accepting them: ` +
        `${unaccepted.map((d) => d.id ?? "(unidentified)").join(", ")}. §13.5 bars an unaccepted ` +
        `S2, and an acceptance with no acceptor is the absence wearing the word.`,
    )
  }
  return verdict(
    "defects",
    "SATISFIED",
    `${defects.length} defect(s) reviewed; no unresolved ${BLOCKING_SEVERITIES.join("/")} and no ` +
      `unaccepted S2.`,
  )
}

function businessCyclesVerdict(facts) {
  const cycles = facts?.businessCycles
  if (!isList(cycles) || cycles.length === 0) {
    return verdict(
      "businessCycles",
      "UNKNOWN",
      "No critical business cycles were declared. §13.5 requires the ones in scope to have " +
        "completed and reconciled; a program that lists none has not looked.",
    )
  }
  const problems = []
  for (const cycle of cycles) {
    const id = cycle?.name ?? "(unnamed)"
    if (cycle?.completed === true && cycle?.reconciled === true) continue
    // §13.5's own escape: "or an agreed observation window substitutes".
    if (named(cycle?.observationWindow) && named(cycle?.agreedBy)) continue
    if (named(cycle?.observationWindow) && !named(cycle?.agreedBy)) {
      problems.push(
        `"${id}" substitutes an observation window that nobody agreed. §13.5's word is "agreed".`,
      )
      continue
    }
    if (cycle?.completed === undefined || cycle?.reconciled === undefined) {
      problems.push(`"${id}" does not say whether it completed or reconciled.`)
      continue
    }
    problems.push(
      `"${id}" completed=${cycle.completed} reconciled=${cycle.reconciled}, with no agreed ` +
        `observation window in its place.`,
    )
  }
  if (problems.length === 0) {
    return verdict("businessCycles", "SATISFIED", `${cycles.length} critical cycle(s) complete or covered.`)
  }
  const unknown = problems.some((p) => p.includes("does not say"))
  return verdict("businessCycles", unknown ? "UNKNOWN" : "BLOCKED", problems.join(" "))
}

function thresholdsVerdict(facts) {
  const measures = facts?.thresholds
  if (!isList(measures) || measures.length === 0) {
    return verdict(
      "thresholds",
      "UNKNOWN",
      "No threshold measurements were supplied. §13.5 requires seven dimensions to have stayed " +
        "within threshold for the agreed period, which is a measurement and not an impression.",
    )
  }
  const unstated = measures.filter((m) => m?.withinThreshold === undefined)
  if (unstated.length > 0) {
    return verdict(
      "thresholds",
      "UNKNOWN",
      `${unstated.length} measure(s) do not state whether they were within threshold: ` +
        `${unstated.map((m) => m?.dimension ?? "(unnamed)").join(", ")}.`,
    )
  }
  const breached = measures.filter((m) => m.withinThreshold !== true)
  if (breached.length > 0) {
    return verdict(
      "thresholds",
      "BLOCKED",
      `${breached.length} dimension(s) outside threshold: ` +
        `${breached.map((m) => m?.dimension ?? "(unnamed)").join(", ")}.`,
    )
  }
  const short = measures.filter(
    (m) => typeof m.observedDays === "number" && typeof m.agreedPeriodDays === "number" && m.observedDays < m.agreedPeriodDays,
  )
  if (short.length > 0) {
    return verdict(
      "thresholds",
      "BLOCKED",
      `${short.length} dimension(s) were within threshold for less than the agreed period: ` +
        short
          .map((m) => `${m.dimension} (${m.observedDays}d of ${m.agreedPeriodDays}d)`)
          .join(", ") +
        `. §13.5's phrase is "for the agreed period", and a number that has been good since ` +
        `Tuesday is not one that has held.`,
    )
  }
  return verdict("thresholds", "SATISFIED", `${measures.length} dimension(s) within threshold for the agreed period.`)
}

/**
 * §13.5's workaround bullet, answered by the EXT-110-006 register rather than by
 * a second set of rules.
 *
 * "Owners, risk acceptance, deadlines and support documentation" are four of the
 * seven facts `WORKAROUND_FACTS` already carries, so re-checking them here would
 * be the repository's second workaround validator. What §13.5 adds on top is the
 * word *acceptance*: a HIGH-risk workaround crossing the exit needs somebody to
 * have accepted that risk by name, which the register does not require while
 * hypercare is running.
 */
function workaroundsVerdict(facts, at) {
  const register = facts?.workarounds
  if (!isList(register)) {
    return verdict(
      "workarounds",
      "UNKNOWN",
      "No workaround register was supplied. §13.5 asks what happened to the workarounds; an " +
        "absent register answers that nobody asked.",
    )
  }
  const problems = registerProblems(register, at)
  if (problems.length > 0) {
    return verdict(
      "workarounds",
      "BLOCKED",
      `${problems.length} finding(s) in the workaround register: ` +
        `${[...new Set(problems.map((p) => p.reason))].sort().join(", ")}.`,
    )
  }
  const unaccepted = register.filter(
    (w) =>
      named(w?.risk) &&
      RISK_LEVELS.includes(w.risk.trim()) &&
      w.risk.trim() === "HIGH" &&
      !named(w?.riskAcceptedBy) &&
      stateOf(w, at).state === "ACTIVE",
  )
  if (unaccepted.length > 0) {
    return verdict(
      "workarounds",
      "BLOCKED",
      `${unaccepted.length} HIGH-risk workaround(s) still active with nobody named as accepting ` +
        `the risk: ${unaccepted.map((w) => w.id).join(", ")}. §13.5 adds "risk acceptance" to ` +
        `§13.4's seven facts precisely at the moment the risk stops being the program's.`,
    )
  }
  return verdict("workarounds", "SATISFIED", `${register.length} workaround(s), each complete and either closed or accepted.`)
}

function handoverVerdict(facts) {
  const handover = facts?.handover
  if (!handover || typeof handover !== "object") {
    return verdict(
      "handover",
      "UNKNOWN",
      `No handover record was supplied. §13.5 names ${HANDOVER_ITEMS.length} items that transfer, ` +
        `and an absent record is not an empty one.`,
    )
  }
  const unstated = HANDOVER_ITEMS.filter((item) => handover[item] === undefined)
  if (unstated.length > 0) {
    return verdict(
      "handover",
      "UNKNOWN",
      `${unstated.length} handover item(s) say nothing either way: ${unstated.join(", ")}.`,
    )
  }
  const outstanding = HANDOVER_ITEMS.filter((item) => !named(handover[item]?.acceptedBy))
  if (outstanding.length > 0) {
    return verdict(
      "handover",
      "BLOCKED",
      `${outstanding.length} handover item(s) name no accepting owner: ${outstanding.join(", ")}. ` +
        `A handover with nobody on the receiving end is a handover to the person who notices first.`,
    )
  }
  return verdict("handover", "SATISFIED", `All ${HANDOVER_ITEMS.length} items accepted by a named owner.`)
}

function knowledgeVerdict(facts) {
  const knowledge = facts?.knowledge
  if (!knowledge || typeof knowledge !== "object") {
    return verdict(
      "knowledge",
      "UNKNOWN",
      "No knowledge-transfer record was supplied. §13.5 requires sessions and simulations to have " +
        "passed, which is a result and not an intention.",
    )
  }
  if (knowledge.sessionsPassed === undefined || knowledge.supportSimulationsPassed === undefined) {
    return verdict(
      "knowledge",
      "UNKNOWN",
      "The record does not state whether the knowledge-transfer sessions and the support " +
        "simulations passed.",
    )
  }
  if (knowledge.sessionsPassed !== true || knowledge.supportSimulationsPassed !== true) {
    return verdict(
      "knowledge",
      "BLOCKED",
      `Knowledge transfer sessionsPassed=${knowledge.sessionsPassed}, ` +
        `supportSimulationsPassed=${knowledge.supportSimulationsPassed}.`,
    )
  }
  const seats = isList(knowledge.attestingSeats) ? knowledge.attestingSeats : []
  const unattested = seats.filter((s) => s?.attested !== true)
  if (seats.length === 0) {
    return verdict(
      "knowledge",
      "UNKNOWN",
      "The sessions and simulations passed and no accepting support seat is listed. §13.5's third " +
        "clause is that the seats attest readiness; nobody attesting is not everybody attesting.",
    )
  }
  if (unattested.length > 0) {
    return verdict(
      "knowledge",
      "BLOCKED",
      `${unattested.length} accepting support seat(s) have not attested readiness: ` +
        `${unattested.map((s) => s?.seat ?? "(unnamed)").join(", ")}.`,
    )
  }
  return verdict("knowledge", "SATISFIED", `Sessions and simulations passed; ${seats.length} seat(s) attested.`)
}

function signoffVerdict(facts) {
  const signoff = facts?.signoff
  if (!signoff || typeof signoff !== "object") {
    return verdict(
      "signoff",
      "UNKNOWN",
      "No transition sign-off was supplied. §13.5's last bullet needs two signatures, and an " +
        "absent record has neither.",
    )
  }
  const missing = ["customer", "tenureServiceOwner"].filter((party) => !named(signoff[party]))
  if (missing.length > 0) {
    return verdict(
      "signoff",
      "BLOCKED",
      `The transition manifest is unsigned by: ${missing.join(", ")}. §13.5 names both parties, ` +
        `and one signature is a handover one side agreed to.`,
    )
  }
  if (!named(signoff.manifestRef)) {
    return verdict(
      "signoff",
      "UNKNOWN",
      "Both parties signed and the record does not say what they signed. §13.5's phrase is " +
        "\"transition evidence manifest\"; a signature with no manifest reference cannot be " +
        "matched to the evidence it approves. (Whether that manifest is immutable is EXT-110-008 " +
        "and is not decided here.)",
    )
  }
  return verdict("signoff", "SATISFIED", `Signed by ${signoff.customer} and ${signoff.tenureServiceOwner} over ${signoff.manifestRef}.`)
}

const EVALUATORS = Object.freeze({
  defects: defectsVerdict,
  businessCycles: businessCyclesVerdict,
  thresholds: thresholdsVerdict,
  workarounds: workaroundsVerdict,
  handover: handoverVerdict,
  knowledge: knowledgeVerdict,
  signoff: signoffVerdict,
})

/**
 * All seven criteria, in §13.5's order, always all seven.
 *
 * A criterion whose facts are absent produces an `UNKNOWN` row rather than no
 * row, because a result with six entries reads as six criteria that exist.
 */
export function exitReadiness(facts, at) {
  return Object.freeze(EXIT_CRITERIA.map((c) => EVALUATORS[c.key](facts ?? {}, at)))
}

/**
 * `EXIT` only when all seven are `SATISFIED`.
 *
 * The verdict names which criteria are outstanding and in which way, because
 * "hypercare is not ready to exit" is not actionable and "the DR runbook has no
 * accepting owner and two S1 defects are open" is.
 */
export function exitVerdict(facts, at) {
  const readiness = exitReadiness(facts, at)
  const blocked = readiness.filter((r) => r.verdict === "BLOCKED")
  const unknown = readiness.filter((r) => r.verdict === "UNKNOWN")

  if (blocked.length === 0 && unknown.length === 0) {
    return Object.freeze({
      result: "EXIT",
      readiness,
      why: `All ${EXIT_CRITERIA.length} of §13.5's criteria are satisfied.`,
    })
  }

  return Object.freeze({
    result: "HOLD",
    readiness,
    blocked: Object.freeze(blocked.map((r) => r.criterion)),
    unknown: Object.freeze(unknown.map((r) => r.criterion)),
    why:
      `§13.5 says hypercare exits "only when" every criterion holds. ` +
      (blocked.length > 0 ? `${blocked.length} blocked (${blocked.map((r) => r.criterion).join(", ")}). ` : "") +
      (unknown.length > 0
        ? `${unknown.length} unknown (${unknown.map((r) => r.criterion).join(", ")}) — nobody has ` +
          `published the fact, which is a different answer from the fact being bad and blocks ` +
          `exit for the same reason.`
        : ""),
  })
}
