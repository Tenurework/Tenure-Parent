/**
 * EXT-100-007 — the go/no-go board, and the decision record it produces.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §12.6
 * opens with the sentence that decides what this module has to be: "The board
 * reviews current evidence, not prepared slides alone." It then lists eight
 * mandatory dimensions and ends:
 *
 *   "The recorded result is `GO`, `NO_GO`, `PAUSE_AND_REASSESS`, or `ROLLBACK`,
 *    with participants, votes/authority, evidence digest, conditions, expiry,
 *    and time."
 *
 * Two words in the opening sentence are load-bearing. **Current** means evidence
 * has an age and an age can disqualify it, so every dimension carries a freshness
 * budget and stale evidence is a distinct verdict from absent and from failing.
 * **Evidence** means the board's inputs are records, not a checklist somebody
 * ticked: a dimension nobody presented evidence for is `NOT_PRESENTED`, which is
 * "we could not look", and a dimension whose evidence says the thing is not ready
 * is `NOT_SATISFIED`, which is "we looked and found nothing". This codebase's
 * central rule is that collapsing those two is the bug, and a go/no-go board is
 * where collapsing them ends a pilot.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * See `connection-cardinality.mjs`: Node 20 is what CI pins, it cannot load
 * TypeScript, and both readers run there.
 *
 * ── A GO is derived, never asserted ────────────────────────────────────────
 *
 * `decide()` computes the result from the readiness of the eight dimensions and
 * the open defects. A caller cannot pass `result: "GO"` and have it accepted —
 * `decisionProblems()` refuses a recorded GO that the evidence does not support,
 * and names every dimension that refused it. That is the difference between a
 * board and a form.
 */

const HOURS = 3_600_000

/**
 * §12.6's eight mandatory dimensions, in the document's order.
 *
 * `freshnessHours` is this module's own decision and is stated as such: §12.6
 * requires *current* evidence and gives no number, so a budget had to be chosen
 * or "current" would mean nothing. The three shapes below are the reasoning:
 *
 *   · 720h (30 days) for what a signed artifact fixes — a release version, a
 *     certification, an acceptance record. These do not decay; they are
 *     superseded, and the digest catches that.
 *   · 72h for readiness that a change can invalidate — infrastructure, external
 *     parties, support staffing.
 *   · 24h for the two that are about the state of the data and the running
 *     system right now: conversion/reconciliation, and smoke/isolation. Evidence
 *     from the previous rehearsal is not evidence about tonight.
 */
export const GO_NO_GO_DIMENSIONS = Object.freeze([
  Object.freeze({
    key: "versions",
    phrase:
      "approved release/IaC/config/mapping/localization/connector/Relay versions and rollback identifiers",
    freshnessHours: 720,
  }),
  Object.freeze({
    key: "production_readiness",
    phrase:
      "production infrastructure, identity, security, privacy, monitoring, backup, restore/DR, capacity, and cost readiness",
    freshnessHours: 72,
  }),
  Object.freeze({
    key: "conversion_reconciliation",
    phrase:
      "final conversion status and signed technical/business/financial/security/content reconciliations",
    freshnessHours: 24,
  }),
  Object.freeze({
    key: "smoke_isolation",
    phrase: "critical end-to-end smoke and tenant-isolation results",
    freshnessHours: 24,
  }),
  Object.freeze({
    key: "external_readiness",
    phrase:
      "external system, provider, bank, email/SMS, SSO/SCIM, DNS/certificate, and support readiness",
    freshnessHours: 72,
  }),
  Object.freeze({
    key: "business_readiness",
    phrase:
      "UAT acceptance, training, communications, support staffing, runbooks, and known-defect/risk statement",
    freshnessHours: 720,
  }),
  Object.freeze({
    key: "defects",
    phrase: "no unresolved S0/S1; S2 only under explicitly permitted exceptional risk authority",
    freshnessHours: 24,
  }),
  Object.freeze({
    key: "rollback_feasibility",
    phrase:
      "rollback feasibility at the current boundary, estimated duration/data impact, and authority",
    freshnessHours: 72,
  }),
])

/** §12.6's four recorded results, verbatim. */
export const DECISIONS = Object.freeze(["GO", "NO_GO", "PAUSE_AND_REASSESS", "ROLLBACK"])

/** The four verdicts one dimension can hold. Three of them are not "ready". */
export const DIMENSION_VERDICTS = Object.freeze([
  /** Evidence exists, is current, and says the dimension is ready. */
  "SATISFIED",
  /** Evidence exists, is current, and says it is not. We looked. */
  "NOT_SATISFIED",
  /** Evidence exists and is older than this dimension's budget. */
  "STALE",
  /** No evidence at all. We could not look — which is not the same answer. */
  "NOT_PRESENTED",
])

const named = (value) => typeof value === "string" && value.trim().length > 0

const instant = (value) => {
  if (!named(value)) return NaN
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? NaN : ms
}

/**
 * Each of §12.6's dimensions, judged against the evidence presented at `at`.
 *
 * `evidence` is a map from dimension key to `{ ready, asOf, digest, source }`.
 * Absent keys are `NOT_PRESENTED` and that is deliberately not an error: a board
 * convened before every dimension has evidence is normal, and what must not be
 * possible is a GO in that state.
 */
export function boardReadiness(evidence, at) {
  const now = instant(at)
  return Object.freeze(
    GO_NO_GO_DIMENSIONS.map((dimension) => {
      const record = evidence?.[dimension.key]
      if (record === undefined || record === null) {
        return Object.freeze({
          key: dimension.key,
          verdict: "NOT_PRESENTED",
          why:
            `No evidence was presented for "${dimension.phrase}". §12.6 makes it mandatory, and ` +
            `an absent record is not a passing one — nobody looked.`,
        })
      }

      const asOf = instant(record.asOf)
      if (Number.isNaN(asOf) || Number.isNaN(now)) {
        return Object.freeze({
          key: dimension.key,
          verdict: "NOT_PRESENTED",
          why:
            `Evidence for "${dimension.key}" carries no readable timestamp (asOf="${record.asOf}", ` +
            `board time="${at}"). §12.6 requires *current* evidence, and evidence with no time ` +
            `cannot be current or stale — it can only be believed.`,
        })
      }

      const ageHours = (now - asOf) / HOURS
      if (ageHours > dimension.freshnessHours || ageHours < 0) {
        return Object.freeze({
          key: dimension.key,
          verdict: "STALE",
          ageHours,
          why:
            ageHours < 0
              ? `Evidence for "${dimension.key}" is dated ${record.asOf}, after the board at ${at}. ` +
                `Evidence from the future is a clock or a copy-paste error, and either way it is ` +
                `not evidence about now.`
              : `Evidence for "${dimension.key}" is ${ageHours.toFixed(1)}h old against a budget ` +
                `of ${dimension.freshnessHours}h. §12.6: the board "reviews current evidence, not ` +
                `prepared slides alone".`,
        })
      }

      if (record.ready !== true) {
        return Object.freeze({
          key: dimension.key,
          verdict: "NOT_SATISFIED",
          ageHours,
          why: named(record.why)
            ? record.why
            : `Current evidence for "${dimension.key}" does not report readiness.`,
        })
      }

      return Object.freeze({ key: dimension.key, verdict: "SATISFIED", ageHours })
    }),
  )
}

/**
 * §12.6's defect rule, which is not a count.
 *
 * "No unresolved S0/S1; S2 only under explicitly permitted exceptional risk
 * authority." So an S0 blocks unconditionally; an S2 blocks *unless* a named
 * authority permitted it, and that permission has to be a record with an author,
 * not a severity downgrade. Anything below S2 does not block.
 */
export function defectBlockers(defects) {
  const blockers = []
  for (const defect of defects ?? []) {
    if (defect?.resolved === true) continue
    const id = named(defect?.id) ? defect.id.trim() : "(unidentified)"
    const severity = named(defect?.severity) ? defect.severity.trim().toUpperCase() : "(none)"

    if (severity === "S0" || severity === "S1") {
      blockers.push(
        Object.freeze({
          defect: id,
          severity,
          reason: "unresolved-critical",
          detail:
            `${id} is an unresolved ${severity}. §12.6 admits no exception for S0/S1 — the ` +
            `exceptional-risk authority it names applies to S2 only.`,
        }),
      )
      continue
    }

    if (severity === "S2") {
      const risk = defect?.acceptedRisk
      const missing = []
      if (!named(risk?.authority)) missing.push("authority")
      if (!named(risk?.compensatingControl)) missing.push("compensating control")
      if (!named(risk?.expiry)) missing.push("expiry")
      if (missing.length > 0) {
        blockers.push(
          Object.freeze({
            defect: id,
            severity,
            reason: "s2-without-permitted-risk",
            detail:
              `${id} is an unresolved S2 and its accepted risk states no ${missing.join(", ")}. ` +
              `§12.6 permits S2 "only under explicitly permitted exceptional risk authority", ` +
              `and §11.5 requires an owner, a compensating control and an expiry — a risk with ` +
              `no expiry is a decision that outlives the reason for it.`,
          }),
        )
      }
      continue
    }

    if (severity === "(none)") {
      blockers.push(
        Object.freeze({
          defect: id,
          severity,
          reason: "unclassified-defect",
          detail:
            `${id} is unresolved and carries no severity. §12.6's rule is stated in severities, ` +
            `so an unclassified defect cannot be shown to pass it — it is not "minor", it is ` +
            `unassessed.`,
        }),
      )
    }
  }
  return Object.freeze(blockers)
}

/**
 * The result §12.6 says the board must record, derived from what it reviewed.
 *
 * `ROLLBACK` is reachable only when activation has already begun — before that
 * there is nothing to roll back and the honest answer is `NO_GO`. That is the
 * distinction §12.8 draws between a decision at the gate and a decision after the
 * last reversible point, and merging them is how a board "rolls back" a system
 * that was never activated while the real question — whether to start — goes
 * unrecorded.
 */
export function decide({ readiness, defects, activationStarted = false } = {}) {
  const blockers = defectBlockers(defects)
  const unsatisfied = (readiness ?? []).filter((r) => r.verdict !== "SATISFIED")

  if (unsatisfied.length === 0 && blockers.length === 0) {
    return Object.freeze({ result: "GO", blockers: Object.freeze([]), unsatisfied: Object.freeze([]) })
  }

  const result = activationStarted
    ? "ROLLBACK"
    : // Something the board can still resolve tonight — evidence not yet
      // presented, or stale evidence that a fresh run would refresh — is a
      // pause. Something the evidence positively refutes is a NO_GO.
      unsatisfied.every((r) => r.verdict === "NOT_PRESENTED" || r.verdict === "STALE") &&
        blockers.length === 0
      ? "PAUSE_AND_REASSESS"
      : "NO_GO"

  return Object.freeze({
    result,
    blockers,
    unsatisfied: Object.freeze(unsatisfied.map((r) => r.key)),
  })
}

/**
 * Every way a recorded decision fails §12.6's closing sentence.
 *
 * The first check is the one that makes the rest matter: a recorded `GO` is
 * compared against the readiness the board actually had, and refused if the
 * evidence does not support it. Without that, this function checks the
 * completeness of a form.
 */
export function decisionProblems(record, { readiness, defects, activationStarted } = {}) {
  const problems = []
  const bad = (field, reason, detail) => problems.push(Object.freeze({ field, reason, detail }))

  if (!DECISIONS.includes(record?.result)) {
    bad(
      "result",
      "unknown-result",
      `"${record?.result}" is not a §12.6 result. One of: ${DECISIONS.join(", ")}.`,
    )
  }

  const derived = decide({ readiness, defects, activationStarted })
  if (record?.result === "GO" && derived.result !== "GO") {
    bad(
      "result",
      "go-not-supported-by-evidence",
      `A GO is recorded and the evidence supports ${derived.result}. ` +
        (derived.unsatisfied.length > 0
          ? `Not satisfied: ${derived.unsatisfied.join(", ")}. `
          : "") +
        (derived.blockers.length > 0
          ? `Blocking defects: ${derived.blockers.map((b) => b.defect).join(", ")}. `
          : "") +
        `§12.6's board "reviews current evidence, not prepared slides alone"; a GO the evidence ` +
        `refuses is the slide.`,
    )
  }

  const participants = Array.isArray(record?.participants) ? record.participants : []
  if (participants.length === 0) {
    bad(
      "participants",
      "no-participants",
      "§12.6 requires participants. A decision with none is a decision nobody made, and the " +
        "escalation path in §12.2 has nobody to escalate to.",
    )
  }
  for (const participant of participants) {
    const who = named(participant?.seat) ? participant.seat.trim() : "(unnamed seat)"
    if (!named(participant?.seat)) {
      bad(
        "participants",
        "participant-without-seat",
        "A participant is recorded with no seat. §12.2 assigns decision rights to durable seats, " +
          "not to people, precisely so a record stays readable after the occupant changes.",
      )
    }
    if (!named(participant?.vote)) {
      bad(
        "participants",
        "participant-without-vote",
        `${who} is recorded as a participant with no vote or authority. §12.6 requires ` +
          `"votes/authority" — attendance is not a position.`,
      )
    }
  }

  if (!named(record?.evidenceDigest)) {
    bad(
      "evidenceDigest",
      "no-evidence-digest",
      "§12.6 requires an evidence digest. Without one the decision cites 'the evidence' and " +
        "cannot be shown afterwards to have cited this evidence rather than a later version.",
    )
  }

  if (!named(record?.at) || Number.isNaN(instant(record?.at))) {
    bad(
      "at",
      "no-decision-time",
      `§12.6 requires the time. A decision with none cannot be placed before or after any of the ` +
        `evidence it reviewed, which is the only way "current" can be checked.`,
    )
  }

  const expiry = instant(record?.expiry)
  if (!named(record?.expiry) || Number.isNaN(expiry)) {
    bad(
      "expiry",
      "no-expiry",
      "§12.6 requires an expiry. A GO with no expiry authorizes an activation next week against " +
        "evidence from tonight.",
    )
  } else if (!Number.isNaN(instant(record?.at)) && expiry <= instant(record.at)) {
    bad(
      "expiry",
      "expiry-not-after-decision",
      `The decision expires at ${record.expiry}, at or before it was taken (${record.at}). ` +
        `An authorization with no live window is either a typo or a decision nobody may act on.`,
    )
  }

  for (const condition of record?.conditions ?? []) {
    const text = named(condition?.condition) ? condition.condition.trim() : "(unstated)"
    if (!named(condition?.condition)) {
      bad("conditions", "unstated-condition", "A condition is recorded with no text.")
    }
    if (!named(condition?.owner)) {
      bad(
        "conditions",
        "condition-without-owner",
        `Condition "${text}" names no owner. A conditional GO whose conditions nobody owns is an ` +
          `unconditional GO with extra sentences.`,
      )
    }
    if (!named(condition?.dueBy)) {
      bad(
        "conditions",
        "condition-without-due",
        `Condition "${text}" has no due time, so it cannot be shown unmet at any moment.`,
      )
    }
  }

  return Object.freeze(problems)
}
