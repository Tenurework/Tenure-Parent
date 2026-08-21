/**
 * EXT-110-005 — expedited but complete emergency change, and the governed
 * correction package a data fix goes through.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §13.4
 * states four rules and this module is each of them:
 *
 *   "Emergency changes use an expedited but complete risk, test, approval,
 *    rollback, deployment, and evidence path."
 *   "Configuration fixes are versioned and promoted; direct production editing
 *    does not become normal."
 *   "Data fixes use approved domain commands or a governed correction package
 *    with before/after, affected records, dry run, validation, approval, audit,
 *    and rollback/compensation."
 *   "Relay may draft diagnosis and correction plans but cannot execute protected
 *    fixes without normal authority."
 *
 * ── "expedited but complete" is the whole design ───────────────────────────
 *
 * The two words are in tension and §13.4 keeps both. So a step has three
 * dispositions and not two: `FULL`, `COMPRESSED`, and `SKIPPED`. Compression is
 * what "expedited" means and it is allowed — with the shortcut named, so a
 * reviewer can see what was traded. `SKIPPED` is refused, because a path missing
 * a step is not a fast path, it is a different path. An emergency change that
 * simply omits a step is refused identically: an absent step and a skipped step
 * are the same hole, and only one of them is honest about it.
 *
 * ── "does not become normal" is arithmetic ─────────────────────────────────
 *
 * Every change process ever written says direct production editing is
 * exceptional, and every one of them has a folder of exceptions. So
 * `directEditPosture` counts: what fraction of configuration fixes bypassed the
 * landscape, and does each bypass name the emergency change that authorised it
 * and the promotion that puts it back. A rule stated as a sentence is a rule
 * nobody can be shown to have broken.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * Same reason as `cutover-runbook.mjs`: Node 20, which CI pins, cannot load
 * TypeScript, and both readers — `node --test` and the generator under `tools/`
 * — run there.
 */

/**
 * §13.4's six steps of the emergency path, in the document's order.
 *
 * The order is not decorative: `rollback` is stated before `deployment` because
 * the reversal has to exist before the thing it reverses is live, and a path
 * that plans the rollback afterwards has already shipped without one.
 */
export const EMERGENCY_STEPS = Object.freeze([
  Object.freeze({ key: "risk", phrase: "risk" }),
  Object.freeze({ key: "test", phrase: "test" }),
  Object.freeze({ key: "approval", phrase: "approval" }),
  Object.freeze({ key: "rollback", phrase: "rollback" }),
  Object.freeze({ key: "deployment", phrase: "deployment" }),
  Object.freeze({ key: "evidence", phrase: "evidence" }),
])

/** What was done with a step. `SKIPPED` exists so it can be refused by name. */
export const STEP_DISPOSITIONS = Object.freeze(["FULL", "COMPRESSED", "SKIPPED"])

/**
 * §13.4's seven facts of a governed correction package.
 *
 * `rollbackOrCompensation` carries the document's "or": some corrections cannot
 * be undone and are instead compensated by an offsetting entry, and demanding a
 * rollback from those would push the fix outside the governed path entirely.
 */
export const CORRECTION_FACTS = Object.freeze([
  Object.freeze({ key: "before", phrase: "before" }),
  Object.freeze({ key: "after", phrase: "after" }),
  Object.freeze({ key: "affectedRecords", phrase: "affected records" }),
  Object.freeze({ key: "dryRun", phrase: "dry run" }),
  Object.freeze({ key: "validation", phrase: "validation" }),
  Object.freeze({ key: "approval", phrase: "approval" }),
  Object.freeze({ key: "audit", phrase: "audit" }),
  Object.freeze({ key: "rollbackOrCompensation", phrase: "rollback/compensation" }),
])

/** The two routes §13.4 permits a data fix to take. There is no third. */
export const DATA_FIX_ROUTES = Object.freeze(["DOMAIN_COMMAND", "CORRECTION_PACKAGE"])

/**
 * Actors that are Relay wearing a person's clothes.
 *
 * Shared shape with `cutover-command-roles.mjs`'s occupant test and kept here
 * rather than imported, for one reason worth stating: that pattern is written
 * against a *seat occupant* on a roster and this one is written against the
 * *executor* of a change. They happen to look alike today. Making one of them
 * import the other would mean a future tightening of either silently changes
 * what the other refuses, in a different section of a different document.
 */
const RELAY_ACTOR = /(^|[^a-z])(relay|copilot|ai[- ]?(assistant|agent)|autonomous[- ]?agent)([^a-z]|$)/i

const named = (value) => typeof value === "string" && value.trim().length > 0
const filled = (value) => (Array.isArray(value) ? value.filter(named).length > 0 : named(value))

/**
 * Every way an emergency change fails §13.4's first bullet.
 *
 * A change is a `{ id, steps: { risk: {...}, ... }, executor, approver }`. Each
 * step is `{ disposition, detail, shortcut }` — `shortcut` being what was traded
 * away, required exactly when the disposition is `COMPRESSED`, because
 * "expedited" without a record of the expedition is indistinguishable from
 * nothing having been done.
 */
export function emergencyChangeProblems(change) {
  const problems = []
  const bad = (step, reason, detail) =>
    problems.push(Object.freeze({ id: change?.id ?? "(unidentified)", step, reason, detail }))

  if (!named(change?.id)) {
    bad(
      "(change)",
      "unidentified-change",
      "An emergency change with no id cannot be cited by the configuration fix it authorised, " +
        "counted in §13.3's change-failure rate, or produced as evidence at §13.5's exit.",
    )
  }

  for (const step of EMERGENCY_STEPS) {
    const record = change?.steps?.[step.key]
    if (record === undefined || record === null) {
      bad(
        step.key,
        "step-absent",
        `The path records nothing for ${step.phrase}. §13.4 says "expedited but complete"; an ` +
          `absent step is the incomplete half, and it is the one that leaves no trace of itself.`,
      )
      continue
    }
    const disposition = named(record.disposition) ? record.disposition.trim() : null
    if (disposition === null || !STEP_DISPOSITIONS.includes(disposition)) {
      bad(
        step.key,
        "step-disposition-unreadable",
        `The ${step.phrase} step records a disposition of ${JSON.stringify(record.disposition)}. ` +
          `One of ${STEP_DISPOSITIONS.join(", ")} — a step nobody can classify is not a step ` +
          `somebody performed.`,
      )
      continue
    }
    if (disposition === "SKIPPED") {
      bad(
        step.key,
        "step-skipped",
        `The ${step.phrase} step was skipped. §13.4 allows the emergency path to be expedited, ` +
          `not shortened by a step: a path missing one is not a fast path, it is a different one.`,
      )
      continue
    }
    if (!named(record.detail)) {
      bad(
        step.key,
        "step-unevidenced",
        `The ${step.phrase} step is marked ${disposition} and says nothing about what was done. ` +
          `A disposition with no detail records the intention to perform the step.`,
      )
    }
    if (disposition === "COMPRESSED" && !named(record.shortcut)) {
      bad(
        step.key,
        "compression-unstated",
        `The ${step.phrase} step is COMPRESSED and does not name what was traded away. ` +
          `"Expedited" is a decision with a cost, and one whose cost is unrecorded cannot be ` +
          `reviewed afterwards or refused at the time.`,
      )
    }
  }

  if (named(change?.executor) && named(change?.approver) && change.executor.trim() === change.approver.trim()) {
    bad(
      "approval",
      "self-approved-change",
      `"${change.executor}" is both executor and approver. Compressing the approval step is ` +
        `expediting it; being the approval is removing it.`,
    )
  }

  if (named(change?.executor) && RELAY_ACTOR.test(change.executor)) {
    bad(
      "deployment",
      "relay-executed-fix",
      `"${change.executor}" executed the change. §13.4: Relay "may draft diagnosis and correction ` +
        `plans but cannot execute protected fixes without normal authority."`,
    )
  }
  if (named(change?.approver) && RELAY_ACTOR.test(change.approver)) {
    bad(
      "approval",
      "relay-approved-fix",
      `"${change.approver}" approved the change. An approval is the authority §13.4 says Relay ` +
        `does not have; drafting the plan and approving it are not the same act.`,
    )
  }

  return Object.freeze(problems)
}

/**
 * Every way a configuration fix fails §13.4's second bullet.
 *
 * `promotedFrom` is the landscape environment the version was proven in. §4.4
 * governs promotion itself; what is enforced here is only §13.4's sentence — a
 * configuration fix carries a version and came through the landscape, or it
 * names the emergency change that authorised bypassing it and the promotion
 * that puts it back.
 */
export function configurationFixProblems(fix) {
  const problems = []
  const bad = (field, reason, detail) =>
    problems.push(Object.freeze({ id: fix?.id ?? "(unidentified)", field, reason, detail }))

  if (!named(fix?.version)) {
    bad(
      "version",
      "unversioned-fix",
      `The configuration fix carries no version. §13.4: configuration fixes "are versioned and ` +
        `promoted". An unversioned fix cannot be told apart from the state before it or promoted ` +
        `anywhere afterwards.`,
    )
  }

  if (fix?.directProductionEdit === true) {
    if (!named(fix?.authorisedBy)) {
      bad(
        "authorisedBy",
        "unauthorised-direct-edit",
        `The fix was made directly in production and names no emergency change that authorised ` +
          `it. §13.4's "does not become normal" is a rule about the exception having a name.`,
      )
    }
    if (!named(fix?.promotionBackfill)) {
      bad(
        "promotionBackfill",
        "direct-edit-not-backfilled",
        `The fix was made directly in production and no promotion puts it back through the ` +
          `landscape. Without it the next promotion from a lower environment silently reverts the ` +
          `fix, which is how the same incident happens twice.`,
      )
    }
  } else if (!named(fix?.promotedFrom)) {
    bad(
      "promotedFrom",
      "unpromoted-fix",
      `The fix declares no environment it was promoted from and no direct production edit. ` +
        `§13.4 requires one of the two to be true, and a fix that claims neither arrived by a ` +
        `route nobody recorded.`,
    )
  }

  return Object.freeze(problems)
}

/**
 * "Direct production editing does not become normal", as a measurement.
 *
 * Returns the count, the share, and every direct edit that is missing its
 * authorisation or its backfill. There is no threshold here on purpose: §13.4
 * does not state one, and inventing "under 10% is fine" would be this module
 * deciding something the document did not. What it does is make the number
 * exist, which is the part that was missing.
 */
export function directEditPosture(fixes) {
  const list = Array.isArray(fixes) ? fixes : []
  const direct = list.filter((f) => f?.directProductionEdit === true)
  const ungoverned = direct.filter((f) => !named(f?.authorisedBy) || !named(f?.promotionBackfill))

  return Object.freeze({
    total: list.length,
    directEdits: direct.length,
    share: list.length === 0 ? null : direct.length / list.length,
    ungoverned: Object.freeze(ungoverned.map((f) => f?.id ?? "(unidentified)")),
    why:
      list.length === 0
        ? "No configuration fixes were supplied, so nothing was measured. That is not a posture of zero."
        : `${direct.length} of ${list.length} configuration fixes bypassed the landscape, of ` +
          `which ${ungoverned.length} lack an authorising emergency change or a promotion back.`,
  })
}

/**
 * Every way a data fix fails §13.4's third bullet.
 *
 * The route decides what is required, which is why the route is stated rather
 * than inferred from which fields happen to be present. A fix that names no
 * route is refused before its fields are looked at: guessing that the presence
 * of a `before` means somebody intended a correction package is how a fix with
 * six of the eight facts passes as a package.
 */
export function dataFixProblems(fix) {
  const problems = []
  const bad = (field, reason, detail) =>
    problems.push(Object.freeze({ id: fix?.id ?? "(unidentified)", field, reason, detail }))

  const route = named(fix?.route) ? fix.route.trim() : null
  if (route === null || !DATA_FIX_ROUTES.includes(route)) {
    bad(
      "route",
      "unrouted-data-fix",
      `The data fix declares a route of ${JSON.stringify(fix?.route)}. §13.4 permits exactly two ` +
        `— ${DATA_FIX_ROUTES.join(" or ")} — and anything else is a write to production nobody ` +
        `classified.`,
    )
    return Object.freeze(problems)
  }

  if (route === "DOMAIN_COMMAND") {
    if (!named(fix?.command)) {
      bad(
        "command",
        "unnamed-command",
        `The fix routes through an approved domain command and does not say which. §13.4's word ` +
          `is "approved"; a command nobody names cannot be shown to be one.`,
      )
    }
    return Object.freeze(problems)
  }

  for (const fact of CORRECTION_FACTS) {
    if (!filled(fix?.[fact.key])) {
      bad(
        fact.key,
        "correction-fact-missing",
        `The correction package states no ${fact.phrase}. §13.4 lists all ` +
          `${CORRECTION_FACTS.length}; a package missing one is a script somebody ran.`,
      )
    }
  }

  if (fix?.dryRun !== undefined && fix?.dryRun !== null && fix?.dryRunMatchedApply === false) {
    bad(
      "dryRun",
      "dry-run-diverged",
      `The dry run and the applied change affected different record sets. A dry run whose result ` +
        `is allowed to differ from the apply is a rehearsal of a different correction.`,
    )
  }

  if (named(fix?.executor) && RELAY_ACTOR.test(fix.executor)) {
    bad(
      "executor",
      "relay-executed-fix",
      `"${fix.executor}" executed the data fix. §13.4 lets Relay draft the correction plan and ` +
        `not execute it.`,
    )
  }

  return Object.freeze(problems)
}
