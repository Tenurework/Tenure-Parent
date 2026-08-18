/**
 * EXT-100-008 — activation, progressive change, validation, and cleanup.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §12.7
 * is seven bullets, and each one is a refusal this module makes:
 *
 *   1. "Activation is an idempotent protected command bound to exact approved
 *      manifests."
 *   2. "Routing/DNS/feature/entitlement/connection changes are progressive where
 *      possible and observable."
 *   3. "Smoke tests use safe tenant-specific synthetic/canary records and clean
 *      them through normal audited workflows."
 *   4. "Validate sign-in, tenant resolution, authorization, seat context, core
 *      transactions, audit, memory, files, workflow, notifications, reporting,
 *      search/Relay degradation boundaries, integrations, and financial
 *      effects."
 *   5. "Verify no cross-tenant access and no production callback to
 *      nonproduction endpoints."
 *   6. "Business owners execute critical day-one scenarios before broad release
 *      when risk requires."
 *   7. "Every deviation opens a command-center event and evaluates rollback
 *      threshold."
 *
 * The distinction the whole module is built on is bullet 4 against bullet 5. A
 * validation check that was NOT RUN and a validation check that PASSED are
 * different answers, and the one thing an activation report must never do is
 * collapse them — "we could not look" reported as "we looked and found nothing"
 * is how a cutover is released with sign-in unverified. So `VERDICTS` has no
 * default: a check absent from the results is `NOT_RUN`, reported as its own
 * finding, and `activationVerdict` will not return RELEASE while one exists.
 *
 * Bullet 5 is different again, and is treated as an absolute rather than as a
 * check: cross-tenant access observed, or a production callback to a
 * nonproduction endpoint observed, is not a failed validation to be weighed
 * against the others. It is a stop.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * Same reason as `cutover-runbook.mjs`: Node 20 (which CI pins) cannot load TS,
 * and both readers — `node --test` and the generator under `tools/` — run there.
 */

import { FLOATING_VERSION, ROLLBACK_BOUNDARIES } from "./cutover-runbook.mjs"

/**
 * The manifests §12.6 requires approved versions and rollback identifiers for,
 * which §12.7 then requires activation to be *bound to exactly*.
 *
 * §12.6's sentence is "Approved release/IaC/config/mapping/localization/
 * connector/Relay versions and rollback identifiers" — seven, and the rollback
 * identifier is a property of each rather than an eighth.
 */
export const ACTIVATION_MANIFESTS = Object.freeze([
  "release",
  "iac",
  "config",
  "mapping",
  "localization",
  "connector",
  "relay",
])

/** §12.7's progressive-change bullet, in its own order. */
export const PROGRESSIVE_CHANGES = Object.freeze([
  "routing",
  "dns",
  "feature",
  "entitlement",
  "connection",
])

/**
 * §12.7's validation bullet, one entry per noun, with the document's own word.
 *
 * Fourteen, and the count is asserted in the test against §12.7 rather than
 * against this array, so that shortening the list is a test failure rather than
 * a smaller table.
 */
export const VALIDATION_CHECKS = Object.freeze([
  Object.freeze({ key: "sign-in", phrase: "sign-in" }),
  Object.freeze({ key: "tenant-resolution", phrase: "tenant resolution" }),
  Object.freeze({ key: "authorization", phrase: "authorization" }),
  Object.freeze({ key: "seat-context", phrase: "seat context" }),
  Object.freeze({ key: "core-transactions", phrase: "core transactions" }),
  Object.freeze({ key: "audit", phrase: "audit" }),
  Object.freeze({ key: "memory", phrase: "memory" }),
  Object.freeze({ key: "files", phrase: "files" }),
  Object.freeze({ key: "workflow", phrase: "workflow" }),
  Object.freeze({ key: "notifications", phrase: "notifications" }),
  Object.freeze({ key: "reporting", phrase: "reporting" }),
  Object.freeze({ key: "search-relay-degradation", phrase: "search/Relay degradation boundaries" }),
  Object.freeze({ key: "integrations", phrase: "integrations" }),
  Object.freeze({ key: "financial-effects", phrase: "financial effects" }),
])

/**
 * §12.7's two absolutes. Named separately from `VALIDATION_CHECKS` because they
 * are not weighed: bullet 5 says "Verify no ...", and a verification that finds
 * one has ended the release regardless of how the other thirteen went.
 */
export const ISOLATION_ASSERTIONS = Object.freeze([
  Object.freeze({
    key: "no-cross-tenant-access",
    phrase: "no cross-tenant access",
    why: "A tenant that can read another tenant's data at T0 has already breached; nothing later in the release repairs it.",
  }),
  Object.freeze({
    key: "no-nonproduction-callback",
    phrase: "no production callback to nonproduction endpoints",
    why: "Production data leaving for a nonproduction endpoint is an export nobody authorised, and the endpoint's operator is not the tenant's processor.",
  }),
])

/** A check's three states. There is no fourth, and no default. */
export const VERDICTS = Object.freeze(["PASSED", "FAILED", "NOT_RUN"])

/** What `activationVerdict` may conclude. */
export const RELEASE_RESULTS = Object.freeze(["RELEASE", "HOLD", "STOP"])

/** A digest that names an artifact rather than describing one. */
const DIGEST = /^sha256:[0-9a-f]{64}$/

const named = (value) => typeof value === "string" && value.trim().length > 0

/**
 * Bullet 1: every way an activation command fails "idempotent protected command
 * bound to exact approved manifests".
 */
export function activationCommandProblems(command) {
  const problems = []
  const bad = (reason, detail) => problems.push(Object.freeze({ area: "command", reason, detail }))

  if (!named(command?.idempotencyKey)) {
    bad(
      "not-idempotent",
      "The activation command carries no idempotency key. §12.7 requires activation to be " +
        "idempotent, and the only operational meaning of that at 03:00 is that pressing it twice " +
        "— because the first response was lost — does the work once.",
    )
  }
  if (command?.protected !== true) {
    bad(
      "unprotected",
      "The activation command is not declared protected. §12.7 calls it a \"protected command\"; " +
        "§19's completion protocol and §15.4.1's two-person approval records both assume the " +
        "protection is a property of the command rather than of the person who happens to run it.",
    )
  }
  if (!named(command?.approvedBy)) {
    bad(
      "unapproved",
      "No approver is recorded. A protected command with no approval record is protected by " +
        "convention.",
    )
  } else if (named(command?.executedBy) && command.approvedBy.trim() === command.executedBy.trim()) {
    bad(
      "self-approved",
      `${command.executedBy} both approved and executed activation. §15.4.1 requires two-person ` +
        `approval records; one seat in both is not an incomplete record — it is a record that ` +
        `renders as approved.`,
    )
  }

  const manifests = command?.manifests
  const bound = manifests !== null && typeof manifests === "object" ? manifests : {}
  for (const kind of ACTIVATION_MANIFESTS) {
    const manifest = bound[kind]
    if (manifest === null || typeof manifest !== "object") {
      bad(
        "manifest-unbound",
        `Activation is not bound to a ${kind} manifest. §12.6 requires approved ${kind} versions ` +
          `and rollback identifiers, and §12.7 binds activation to them "exactly".`,
      )
      continue
    }
    if (!named(manifest.version)) {
      bad("manifest-version-absent", `The ${kind} manifest names no version.`)
    } else if (FLOATING_VERSION.test(manifest.version.trim())) {
      bad(
        "manifest-version-not-exact",
        `The ${kind} manifest is bound to "${manifest.version}", which resolves at execution time ` +
          `rather than naming an artifact. Rehearsal and T0 can then activate different things ` +
          `and both be "as approved".`,
      )
    }
    if (!named(manifest.digest)) {
      bad(
        "manifest-digest-absent",
        `The ${kind} manifest carries no digest. §12.6 records an "evidence digest"; a version ` +
          `label is a name a build can be republished under, and a digest is not.`,
      )
    } else if (!DIGEST.test(manifest.digest.trim())) {
      bad(
        "manifest-digest-malformed",
        `The ${kind} manifest's digest "${manifest.digest}" is not a \`sha256:\` hex digest. An ` +
          `unverifiable digest is worse than none, because it is checked by being present.`,
      )
    }
    if (!named(manifest.rollbackId)) {
      bad(
        "manifest-rollback-id-absent",
        `The ${kind} manifest names no rollback identifier. §12.6 requires one per approved ` +
          `version; without it, rollback means "find whatever was there before".`,
      )
    }
  }

  return Object.freeze(problems)
}

/**
 * Bullet 2: progressive where possible, and observable.
 *
 * "Where possible" is why `progressive: false` is not refused outright — some
 * changes genuinely flip. It is refused when it is asserted without a reason,
 * because an unexplained non-progressive change is indistinguishable from one
 * nobody tried to stage.
 */
export function progressiveChangeProblems(changes) {
  const problems = []
  const bad = (change, reason, detail) => problems.push(Object.freeze({ area: "progressive", change, reason, detail }))

  const list = Array.isArray(changes) ? changes : []
  const seen = new Set()

  for (const change of list) {
    const kind = named(change?.kind) ? change.kind.trim() : "(unnamed)"
    if (!PROGRESSIVE_CHANGES.includes(kind)) {
      bad(kind, "change-kind-unknown", `"${kind}" is not one of §12.7's ${PROGRESSIVE_CHANGES.join(", ")} changes.`)
      continue
    }
    seen.add(kind)

    if (change.progressive !== true && !named(change.whyNotProgressive)) {
      bad(
        kind,
        "not-progressive-and-unexplained",
        `The ${kind} change is not progressive and gives no reason. §12.7 says "progressive where ` +
          `possible"; an unexplained flip is not a judgement that it was impossible, it is the ` +
          `absence of one.`,
      )
    }
    if (!named(change.observedBy)) {
      bad(
        kind,
        "not-observable",
        `The ${kind} change names no observation signal. §12.7 requires these changes to be ` +
          `"observable"; one nobody is watching is reported by its consequences.`,
      )
    }
    if (!named(change.reversal)) {
      bad(
        kind,
        "no-reversal",
        `The ${kind} change names no reversal. Every one of §12.7's five changes is inside §12.8's ` +
          `rollback boundaries, so each has to say how it comes back.`,
      )
    }
    if (named(change.rollbackBoundary) && !ROLLBACK_BOUNDARIES.includes(change.rollbackBoundary.trim())) {
      bad(
        kind,
        "unknown-rollback-boundary",
        `"${change.rollbackBoundary}" is not one of §12.8's boundaries: ${ROLLBACK_BOUNDARIES.join(", ")}.`,
      )
    }
  }

  for (const kind of PROGRESSIVE_CHANGES) {
    if (!seen.has(kind)) {
      bad(
        kind,
        "change-unplanned",
        `Activation plans no ${kind} change. §12.7 names all ${PROGRESSIVE_CHANGES.length}; if ` +
          `this cutover genuinely makes none, the plan says so rather than omitting the row.`,
      )
    }
  }

  return Object.freeze(problems)
}

/**
 * Bullet 3: smoke records are synthetic, tenant-specific, and cleaned through
 * normal audited workflows.
 *
 * `tenant` is required so "tenant-specific" is checked rather than assumed: a
 * canary record created in the wrong tenant is a real record in somebody's
 * production ledger.
 */
export function smokeProblems(records, tenant) {
  const problems = []
  const bad = (record, reason, detail) => problems.push(Object.freeze({ area: "smoke", record, reason, detail }))

  const list = Array.isArray(records) ? records : []
  if (!named(tenant)) {
    bad("(all)", "tenant-unstated", "Smoke records were checked without the tenant they belong to, so \"tenant-specific\" could not be verified at all.")
  }

  for (const record of list) {
    const id = named(record?.id) ? record.id.trim() : "(unnamed)"
    if (record?.synthetic !== true) {
      bad(
        id,
        "not-synthetic",
        `"${id}" is not declared synthetic. §12.7 requires "safe tenant-specific synthetic/canary ` +
          `records"; a smoke test run against a real record is a production transaction nobody ` +
          `asked for.`,
      )
    }
    if (named(tenant) && (!named(record?.tenant) || record.tenant.trim() !== tenant.trim())) {
      bad(
        id,
        "wrong-tenant",
        `"${id}" belongs to "${record?.tenant ?? "no tenant"}" while this cutover activates ` +
          `"${tenant}". A canary in another tenant is that tenant's data.`,
      )
    }
    const cleanup = record?.cleanup
    if (cleanup === null || typeof cleanup !== "object") {
      bad(
        id,
        "no-cleanup",
        `"${id}" declares no cleanup. §12.7 requires smoke records to be cleaned "through normal ` +
          `audited workflows"; a canary left behind is indistinguishable from real data a week ` +
          `later.`,
      )
      continue
    }
    if (!named(cleanup.workflow)) {
      bad(id, "cleanup-not-a-workflow", `"${id}" is cleaned by no named workflow. "Normal audited workflows" is §12.7's phrase, and a direct deletion is neither.`)
    }
    if (cleanup.audited !== true) {
      bad(
        id,
        "cleanup-unaudited",
        `"${id}" is cleaned outside the audit trail. The cleanup of a canary is the step most ` +
          `likely to be done by hand at 04:00, which is exactly why §12.7 names it.`,
      )
    }
    if (cleanup.completed !== true) {
      bad(
        id,
        "cleanup-incomplete",
        `"${id}" has not been cleaned up. Reported before release, this is a task; reported after, ` +
          `it is a record in the tenant's ledger that nobody will recognise.`,
      )
    }
  }

  return Object.freeze(problems)
}

/**
 * Bullets 4 and 5: the fourteen checks and the two absolutes.
 *
 * Returns `{ problems, notRun, failed, stops }`. `notRun` and `failed` are
 * separate lists because they are separate answers, and `stops` is separate
 * from both because an isolation breach is not a score.
 */
export function validationProblems(results) {
  const problems = []
  const bad = (check, reason, detail) => problems.push(Object.freeze({ area: "validation", check, reason, detail }))

  const byKey = new Map(
    (Array.isArray(results) ? results : [])
      .filter((r) => named(r?.check))
      .map((r) => [r.check.trim(), r]),
  )

  const notRun = []
  const failed = []
  for (const check of VALIDATION_CHECKS) {
    const result = byKey.get(check.key)
    const verdict = named(result?.verdict) ? result.verdict.trim() : "NOT_RUN"
    if (!VERDICTS.includes(verdict)) {
      bad(check.key, "verdict-unknown", `"${verdict}" is not one of ${VERDICTS.join(", ")}.`)
      continue
    }
    if (verdict === "NOT_RUN") {
      notRun.push(check.key)
      bad(
        check.key,
        "check-not-run",
        `${check.phrase} was not validated. §12.7 names all ${VALIDATION_CHECKS.length}; a check ` +
          `nobody ran and a check that passed are different answers, and a release that treats ` +
          `them alike is a release nobody validated.`,
      )
      continue
    }
    if (verdict === "FAILED") {
      failed.push(check.key)
      bad(check.key, "check-failed", `${check.phrase} failed validation${named(result?.detail) ? `: ${result.detail}` : "."}`)
      continue
    }
    if (!named(result?.evidence)) {
      bad(
        check.key,
        "check-without-evidence",
        `${check.phrase} is recorded PASSED with no evidence. §12.6's board "reviews current ` +
          `evidence, not prepared slides alone", and a bare PASSED is a slide.`,
      )
    }
  }

  // §12.7's two isolation assertions arrive in the same result list and are
  // handled below, so they are not unknown checks; anything else is.
  for (const key of byKey.keys()) {
    const known =
      VALIDATION_CHECKS.some((c) => c.key === key) || ISOLATION_ASSERTIONS.some((a) => a.key === key)
    if (!known) {
      bad(
        key,
        "check-unknown",
        `"${key}" is neither one of §12.7's ${VALIDATION_CHECKS.length} validations nor one of its ` +
          `${ISOLATION_ASSERTIONS.length} isolation assertions. A result nobody asked for is a ` +
          `result nobody reads.`,
      )
    }
  }

  const stops = []
  for (const assertion of ISOLATION_ASSERTIONS) {
    const result = byKey.get(assertion.key)
    const verdict = named(result?.verdict) ? result.verdict.trim() : "NOT_RUN"
    if (verdict === "PASSED") continue
    stops.push(assertion.key)
    bad(
      assertion.key,
      verdict === "FAILED" ? "isolation-breached" : "isolation-unverified",
      verdict === "FAILED"
        ? `${assertion.phrase} could NOT be verified — the check found the thing it looks for. ${assertion.why}`
        : `${assertion.phrase} was not verified. §12.7 says "Verify no ..."; unverified is not the ` +
          `same as clean, and this is the pair where the difference is a breach.`,
    )
  }

  return Object.freeze({
    problems: Object.freeze(problems),
    notRun: Object.freeze(notRun),
    failed: Object.freeze(failed),
    stops: Object.freeze(stops),
  })
}

/**
 * Bullet 7: every deviation opens a command-center event and evaluates the
 * rollback threshold.
 *
 * The second half is the one that gets dropped. An event with no rollback
 * evaluation is a deviation that was logged, which reads in the morning exactly
 * like a deviation that was considered.
 */
export function deviationProblems(deviations) {
  const problems = []
  const bad = (deviation, reason, detail) => problems.push(Object.freeze({ area: "deviation", deviation, reason, detail }))

  for (const deviation of Array.isArray(deviations) ? deviations : []) {
    const id = named(deviation?.id) ? deviation.id.trim() : "(unnamed)"
    if (!named(deviation?.commandCenterEvent)) {
      bad(id, "no-command-center-event", `Deviation "${id}" opened no command-center event. §12.7: "Every deviation opens a command-center event".`)
    }
    const evaluation = deviation?.rollbackThreshold
    if (evaluation === null || typeof evaluation !== "object") {
      bad(
        id,
        "rollback-threshold-not-evaluated",
        `Deviation "${id}" records no rollback-threshold evaluation. §12.7 requires each deviation ` +
          `to evaluate it; a logged deviation with no evaluation reads as a considered one.`,
      )
      continue
    }
    if (typeof evaluation.crossed !== "boolean") {
      bad(id, "rollback-threshold-undecided", `Deviation "${id}" evaluated the rollback threshold to neither crossed nor not-crossed.`)
    }
    if (!named(evaluation.decidedBy)) {
      bad(id, "rollback-threshold-unattributed", `Deviation "${id}" evaluated the rollback threshold with no seat attached.`)
    }
  }

  return Object.freeze(problems)
}

/**
 * The activation's overall result, derived from the four checks above rather
 * than recorded beside them.
 *
 * `STOP` for an isolation breach or a crossed rollback threshold — those end the
 * release. `HOLD` for anything else outstanding, including a check nobody ran
 * and a day-one scenario §12.7 requires when `riskRequiresDayOne` is set.
 * `RELEASE` only when nothing is outstanding, and `why` always says which.
 */
export function activationVerdict(input) {
  const command = activationCommandProblems(input?.command)
  const progressive = progressiveChangeProblems(input?.changes)
  const smoke = smokeProblems(input?.smokeRecords, input?.tenant)
  const validation = validationProblems(input?.validation)
  const deviations = deviationProblems(input?.deviations)

  const crossed = (Array.isArray(input?.deviations) ? input.deviations : []).filter(
    (d) => d?.rollbackThreshold?.crossed === true,
  )

  const dayOne = Array.isArray(input?.dayOneScenarios) ? input.dayOneScenarios : []
  const dayOneOutstanding =
    input?.riskRequiresDayOne === true
      ? dayOne.length === 0
        ? ["(none recorded)"]
        : dayOne.filter((s) => s?.executedBy === undefined || !named(s.executedBy) || s.result !== "PASSED").map((s) => s?.id ?? "(unnamed)")
      : []

  const problems = Object.freeze([
    ...command,
    ...progressive,
    ...smoke,
    ...validation.problems,
    ...deviations,
  ])

  if (validation.stops.length > 0) {
    return Object.freeze({
      result: "STOP",
      why:
        `§12.7's isolation verification did not come back clean (${validation.stops.join(", ")}). ` +
        `This is not weighed against the other checks.`,
      problems,
    })
  }
  if (crossed.length > 0) {
    return Object.freeze({
      result: "STOP",
      why: `${crossed.length} deviation(s) crossed the rollback threshold; §12.7 sends that to the board, not to the release.`,
      problems,
    })
  }
  if (dayOneOutstanding.length > 0) {
    return Object.freeze({
      result: "HOLD",
      why:
        `Risk requires business owners to execute critical day-one scenarios before broad ` +
        `release, and ${dayOneOutstanding.length} has not passed under a named owner ` +
        `(${dayOneOutstanding.join(", ")}).`,
      problems,
    })
  }
  if (problems.length > 0) {
    return Object.freeze({
      result: "HOLD",
      why: `${problems.length} §12.7 finding(s) outstanding, including ${validation.notRun.length} validation(s) nobody ran.`,
      problems,
    })
  }
  return Object.freeze({
    result: "RELEASE",
    why: `All ${VALIDATION_CHECKS.length} validations passed with evidence, both isolation assertions verified, and no finding outstanding.`,
    problems,
  })
}
