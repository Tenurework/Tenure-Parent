/**
 * EXT-100-009 — the last reversible point, recomputed, and the plan per boundary.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §12.8
 * ends with the two sentences this module exists to make executable:
 *
 *   "Define the last reversible point before execution and recalculate it as
 *    cutover advances. If rollback becomes unsafe, the board explicitly moves to
 *    forward recovery with impact and evidence."
 *
 * **Recalculate** is why `lastReversiblePoint` is a pure function of the executed
 * set rather than a stored field. A stored one is written once, at the moment
 * §12.8 says it must start changing, and thereafter reports the plan instead of
 * the cutover. Calling this again with one more executed task is the
 * recalculation, and it is therefore impossible to forget.
 *
 * **Explicitly** is why crossing the point does not silently switch mode.
 * `forwardRecoveryProblems` refuses a forward-recovery record that lacks the
 * impact, the evidence or the authority — and `lastReversiblePoint` reports
 * `forwardRecoveryRequired: true` without deciding anything, because the
 * document gives that decision to the board.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * See `connection-cardinality.mjs`. Node 20, which CI pins, cannot load
 * TypeScript, and both readers — `node --test` and the doc generator — run there.
 *
 * ── Reversibility is declared per task, and refused when it is not ──────────
 *
 * There is no default. A task that says nothing about whether it can be undone is
 * reported as `undeclared`, never assumed reversible — assuming reversible is how
 * a cutover discovers it has passed the point by trying to go back. Nor is it
 * assumed irreversible: that would silently collapse the window and make the
 * board move to forward recovery for a plan that was fine.
 */

import { ROLLBACK_BOUNDARIES } from "./cutover-runbook.mjs"

export { ROLLBACK_BOUNDARIES }

/** How a task relates to going back. Declared, never inferred. */
export const REVERSIBILITY = Object.freeze([
  /** Undoing it restores the prior state within its boundary. */
  "REVERSIBLE",
  /** Once executed, the prior state cannot be restored. Fixes go forward. */
  "IRREVERSIBLE",
])

/**
 * §12.8's boundaries with what its bullets require of each plan.
 *
 * `requires` are keys a plan must fill; `phrase` is the document's own bullet so
 * the list can be checked against §12.8 rather than trusted. Two boundaries also
 * carry a `refuse` rule, because §12.8 does not merely ask for a plan there — it
 * names a specific method as unsafe:
 *
 *   · DATABASE — "never assume down migrations are safe". So a database plan
 *     whose method is a down migration is refused outright rather than warned
 *     about, and the three the document does name are the alternatives.
 *   · IDENTITY — "identity rollback that preserves user access and revokes
 *     invalid sessions". Both halves, because a plan that does the first only
 *     leaves live sessions holding authority the rollback removed.
 */
export const BOUNDARY_PLAN_CONTRACT = Object.freeze([
  Object.freeze({
    key: "INFRASTRUCTURE_APPLICATION",
    phrase: "infrastructure/application rollback to immutable artifact/config",
    requires: Object.freeze(["artifact", "config"]),
  }),
  Object.freeze({
    key: "DATABASE",
    phrase:
      "database forward fix, restore, or compatibility switch; never assume down migrations are safe",
    requires: Object.freeze(["method", "dataImpact"]),
    methods: Object.freeze(["FORWARD_FIX", "RESTORE", "COMPATIBILITY_SWITCH"]),
  }),
  Object.freeze({
    key: "CONFIGURATION",
    phrase: "configuration rollback with data compatibility analysis",
    requires: Object.freeze(["dataCompatibilityAnalysis"]),
  }),
  Object.freeze({
    key: "INTEGRATION",
    phrase: "integration disable/reroute/replay and source ownership restoration",
    requires: Object.freeze(["disableOrReroute", "replay", "sourceOwnershipRestoration"]),
  }),
  Object.freeze({
    key: "MIGRATION",
    phrase:
      "migration rollback to legacy authority or forward correction; prevent lost/double-entered changes",
    requires: Object.freeze(["authorityRestoration", "lostChangePrevention", "doubleEntryPrevention"]),
  }),
  Object.freeze({
    key: "IDENTITY",
    phrase: "identity rollback that preserves user access and revokes invalid sessions",
    requires: Object.freeze(["accessPreservation", "sessionRevocation"]),
  }),
  Object.freeze({
    key: "COMMUNICATION_SUPPORT",
    phrase: "communication and support rollback",
    requires: Object.freeze(["audiences", "supportPosture"]),
  }),
])

const named = (value) => typeof value === "string" && value.trim().length > 0

/**
 * The last point the cutover can still be reversed from, given what has run.
 *
 * The task list is the executable order — §12.3's runbook — and `executed` is the
 * set of ids that have completed. The answer is always one of three shapes, and
 * they are three because two would hide the case that matters:
 *
 *   `{ reversible: true,  taskId: null }`   nothing irreversible has run and
 *                                            nothing has run at all, or only
 *                                            reversible work has. The point is
 *                                            ahead: `nextIrreversible` names it.
 *   `{ reversible: true,  taskId: "…" }`     the last completed task from which
 *                                            rollback still restores prior state.
 *   `{ reversible: false, forwardRecoveryRequired: true }`
 *                                            an irreversible task has completed.
 *                                            §12.8 hands the next move to the
 *                                            board; this function does not take it.
 *
 * `undeclared` is separate from all three and is never folded into an answer: a
 * task with no declared reversibility means the plan does not know where its own
 * point of no return is, and reporting a confident point in that state is worse
 * than reporting none.
 */
export function lastReversiblePoint(tasks, executed) {
  const order = (Array.isArray(tasks) ? tasks : []).filter((t) => named(t?.id))
  const done = new Set([...(executed ?? [])].map((id) => String(id).trim()))

  const undeclared = order
    .filter((t) => !REVERSIBILITY.includes(t.reversibility))
    .map((t) => t.id.trim())

  let lastReversible = null
  let crossedAt = null
  const irreversibleExecuted = []

  for (const task of order) {
    const id = task.id.trim()
    if (!done.has(id)) continue
    if (task.reversibility === "IRREVERSIBLE") {
      irreversibleExecuted.push(id)
      if (crossedAt === null) crossedAt = id
    } else if (task.reversibility === "REVERSIBLE" && crossedAt === null) {
      lastReversible = id
    }
  }

  const nextIrreversible =
    order.find((t) => !done.has(t.id.trim()) && t.reversibility === "IRREVERSIBLE")?.id?.trim() ??
    null

  const boundaries = Object.freeze([
    ...new Set(
      order
        .filter((t) => done.has(t.id.trim()) && named(t.rollbackBoundary))
        .map((t) => t.rollbackBoundary.trim()),
    ),
  ])

  if (crossedAt !== null) {
    return Object.freeze({
      reversible: false,
      forwardRecoveryRequired: true,
      crossedAt,
      lastReversibleTaskId: lastReversible,
      irreversibleExecuted: Object.freeze(irreversibleExecuted),
      boundaries,
      undeclared: Object.freeze(undeclared),
      why:
        `"${crossedAt}" has completed and is declared IRREVERSIBLE. Rollback no longer restores ` +
        `the prior state, so §12.8 requires the board to move explicitly to forward recovery ` +
        `"with impact and evidence" — this is not that decision, it is the fact that forces it.`,
    })
  }

  return Object.freeze({
    reversible: true,
    forwardRecoveryRequired: false,
    taskId: lastReversible,
    nextIrreversible,
    boundaries,
    undeclared: Object.freeze(undeclared),
    why:
      lastReversible === null
        ? `No task has completed, so the cutover is at its starting state.` +
          (nextIrreversible ? ` The point of no return is "${nextIrreversible}".` : "")
        : `Rollback from "${lastReversible}" still restores the prior state.` +
          (nextIrreversible ? ` The point of no return is "${nextIrreversible}".` : ""),
  })
}

/**
 * Whether the boundary plans cover the boundaries this cutover actually touches.
 *
 * The touched set is derived from the tasks rather than declared, so a plan
 * cannot be complete by omitting a boundary from its own list of boundaries.
 */
export function boundaryPlanProblems(tasks, plans) {
  const problems = []
  const bad = (boundary, reason, detail) =>
    problems.push(Object.freeze({ boundary, reason, detail }))

  const touched = new Set(
    (Array.isArray(tasks) ? tasks : [])
      .map((t) => (named(t?.rollbackBoundary) ? t.rollbackBoundary.trim() : null))
      .filter(Boolean),
  )

  const byBoundary = new Map()
  for (const plan of plans ?? []) {
    const key = named(plan?.boundary) ? plan.boundary.trim() : null
    if (!key) {
      bad("(unnamed)", "malformed", "A rollback plan names no boundary, so nothing can be shown covered by it.")
      continue
    }
    if (!ROLLBACK_BOUNDARIES.includes(key)) {
      bad(
        key,
        "unknown-boundary",
        `"${key}" is not a §12.8 boundary. One of: ${ROLLBACK_BOUNDARIES.join(", ")}.`,
      )
      continue
    }
    if (byBoundary.has(key)) {
      bad(key, "duplicate-plan", `Two rollback plans for ${key}. Whichever is read first decides.`)
    }
    byBoundary.set(key, plan)
  }

  for (const boundary of [...touched].sort()) {
    if (!ROLLBACK_BOUNDARIES.includes(boundary)) continue
    if (!byBoundary.has(boundary)) {
      const contract = BOUNDARY_PLAN_CONTRACT.find((c) => c.key === boundary)
      bad(
        boundary,
        "no-plan",
        `Tasks in this cutover carry the ${boundary} rollback boundary and no plan covers it. ` +
          `§12.8: "${contract.phrase}". An unplanned boundary is not a boundary that will not be ` +
          `crossed — it is one nobody has designed the reversal of.`,
      )
    }
  }

  for (const contract of BOUNDARY_PLAN_CONTRACT) {
    const plan = byBoundary.get(contract.key)
    if (!plan) continue

    for (const field of contract.requires) {
      if (!named(plan[field])) {
        bad(
          contract.key,
          "incomplete-plan",
          `The ${contract.key} plan states no ${field}. §12.8: "${contract.phrase}".`,
        )
      }
    }

    if (contract.key === "DATABASE" && named(plan.method)) {
      const method = plan.method.trim().toUpperCase()
      if (!contract.methods.includes(method)) {
        bad(
          "DATABASE",
          "unsafe-database-rollback",
          `The database plan's method is "${plan.method}". §12.8 names three — ` +
            `${contract.methods.join(", ")} — and adds "never assume down migrations are safe". ` +
            `A reversal by down migration is refused rather than warned about: it is the one ` +
            `method whose failure is discovered while production is already half-migrated.`,
        )
      }
    }
  }

  return Object.freeze(problems)
}

/**
 * Whether a move to forward recovery is the explicit decision §12.8 requires.
 *
 * Refuses the record, not the move: the board may always decide to go forward.
 * What it may not do is have that decision be an absence — a cutover that ran
 * past its last reversible point and simply carried on has made the decision by
 * not making it, and no record exists to review afterwards.
 */
export function forwardRecoveryProblems(record, point) {
  const problems = []
  const bad = (field, reason, detail) => problems.push(Object.freeze({ field, reason, detail }))

  if (!record) {
    return Object.freeze([
      Object.freeze({
        field: "record",
        reason: "no-explicit-move",
        detail:
          point && point.forwardRecoveryRequired
            ? `"${point.crossedAt}" has completed and rollback is no longer safe, and no forward-` +
              `recovery decision is recorded. §12.8 requires the board to move "explicitly", so ` +
              `the absence is the finding: the cutover is in forward recovery and nobody said so.`
            : "No forward-recovery record was supplied.",
      }),
    ])
  }

  if (!named(record.authority)) {
    bad(
      "authority",
      "no-authority",
      "§12.8 gives the move to the board. A forward-recovery record with no authority names " +
        "nobody who took the most consequential decision in the cutover.",
    )
  }
  if (!named(record.impact)) {
    bad(
      "impact",
      "no-impact",
      "§12.8 requires impact. Moving to forward recovery without stating what is now " +
        "unrecoverable is the decision made without its consequence.",
    )
  }
  if (!named(record.evidence)) {
    bad(
      "evidence",
      "no-evidence",
      "§12.8 requires evidence. Without it the record asserts that rollback became unsafe rather " +
        "than showing it, and §12.6's rule about slides applies here with more force.",
    )
  }
  if (!named(record.at)) {
    bad("at", "no-time", "A forward-recovery decision with no time cannot be placed against the task that forced it.")
  }

  if (point && point.forwardRecoveryRequired !== true) {
    bad(
      "record",
      "premature-move",
      `A forward-recovery decision is recorded while rollback is still available` +
        (point.taskId ? ` from "${point.taskId}"` : "") +
        `. Recording it early gives up the reversal the plan still has, and §12.8's move is ` +
        `conditioned on rollback having become unsafe.`,
    )
  }

  return Object.freeze(problems)
}
