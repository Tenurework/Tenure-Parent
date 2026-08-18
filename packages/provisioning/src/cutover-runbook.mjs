/**
 * EXT-100-006 — what every cutover task must be bound to before it may run.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §12.3's
 * "Detailed runbook" bullet names the bindings in one sentence: "minute/time-
 * window tasks with executor, approver, duration, command/API/workflow
 * reference, prerequisites, evidence, success/failure thresholds, retry,
 * rollback boundary, and escalation." §12.7 adds the one that makes a reference
 * a binding rather than a hint: activation is "bound to exact approved
 * manifests".
 *
 * So this module refuses two different things, and the second is the point:
 *
 *   · a task missing a required binding — nobody decided who runs it, or how
 *     long it takes, or what proves it worked;
 *   · a task whose binding is present and not *exact* — `latest`, `main`,
 *     `^2.1.0`. A floating version is a task that ran against one artifact in
 *     rehearsal and may run against another at T0, which is precisely the class
 *     of surprise §12.4's "no-surprise review" exists to prevent.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * See `connection-cardinality.mjs`. Node 20 (which CI pins) cannot load TS, and
 * both readers — `node --test` and the doc generator — run there.
 *
 * ── Separation of duties is a refusal, not a warning ───────────────────────
 *
 * §12.3 names executor and approver as two bindings; §6.2 step 7 requires
 * promotion "under separation of duties"; §15.4.1 requires "two-person approval
 * records". One seat holding both is therefore not an incomplete task, it is a
 * task with one person in it wearing two labels, and the runbook renders it as
 * approved.
 */

/** §12.8's boundaries, so a task's rollback boundary is one of the plan's. */
export const ROLLBACK_BOUNDARIES = Object.freeze([
  "INFRASTRUCTURE_APPLICATION",
  "DATABASE",
  "CONFIGURATION",
  "INTEGRATION",
  "MIGRATION",
  "IDENTITY",
  "COMMUNICATION_SUPPORT",
])

/**
 * §12.3's runbook bindings, reduced to the field each one lands in.
 *
 * `phrase` is the document's own word so the list can be checked against §12.3
 * rather than trusted. Every one is required — there is no "recommended" tier,
 * because §19.1's completion protocol has no partial state and a task with nine
 * of ten bindings is a task that will be executed.
 */
export const REQUIRED_TASK_BINDINGS = Object.freeze([
  Object.freeze({ key: "version", phrase: "exact version" }),
  Object.freeze({ key: "executor", phrase: "executor" }),
  Object.freeze({ key: "approver", phrase: "approver" }),
  Object.freeze({ key: "durationMinutes", phrase: "duration" }),
  Object.freeze({ key: "reference", phrase: "command/API/workflow reference" }),
  Object.freeze({ key: "verification", phrase: "evidence and success/failure thresholds" }),
  Object.freeze({ key: "retry", phrase: "retry" }),
  Object.freeze({ key: "rollbackBoundary", phrase: "rollback boundary" }),
  Object.freeze({ key: "escalation", phrase: "escalation" }),
])

/**
 * Version strings that are not versions.
 *
 * Each is a *resolution instruction* — "whatever is newest", "whatever the
 * branch points at", "anything in this range" — and a runbook that carries one
 * records the instruction rather than the artifact. Two rehearsals of the same
 * runbook can then execute different code and both be "as written".
 */
export const FLOATING_VERSION = /^(latest|main|master|head|stable|current|\*)$|^[\^~><]|(\.x$)/i

const named = (value) => typeof value === "string" && value.trim().length > 0

/**
 * Every way one task fails §12.3, in a stable order.
 *
 * `prerequisites` is checked here for shape only (it must be an array of named
 * ids); whether those ids exist and run earlier is a property of the whole
 * runbook and lives in `runbookProblems`.
 */
export function taskProblems(task) {
  const problems = []
  const id = named(task?.id) ? task.id.trim() : "(unnamed)"
  const bad = (reason, detail) => problems.push(Object.freeze({ task: id, reason, detail }))

  if (id === "(unnamed)") {
    bad(
      "unidentified",
      "A runbook task with no id cannot be depended on, evidenced, or reported. §12.3's " +
        "prerequisites and §12.6's evidence digest both cite tasks by id.",
    )
  }

  for (const binding of REQUIRED_TASK_BINDINGS) {
    const value = task?.[binding.key]
    const present =
      binding.key === "durationMinutes"
        ? Number.isFinite(value)
        : binding.key === "verification" || binding.key === "retry"
          ? value !== null && typeof value === "object"
          : named(value)
    if (!present) {
      bad(
        "unbound",
        `"${id}" declares no ${binding.phrase}. §12.3 binds every runbook task to all ` +
          `${REQUIRED_TASK_BINDINGS.length}; this one is absent, so at T0 the answer comes from ` +
          `whoever is in the room.`,
      )
    }
  }

  if (named(task?.version) && FLOATING_VERSION.test(task.version.trim())) {
    bad(
      "version-not-exact",
      `"${id}" is bound to version "${task.version}", which resolves at execution time rather ` +
        `than naming an artifact. §12.7 requires activation "bound to exact approved manifests" ` +
        `and §12.6 requires "approved release/IaC/config/mapping/localization/connector/Relay ` +
        `versions and rollback identifiers" — a range is not an identifier.`,
    )
  }

  if (Number.isFinite(task?.durationMinutes) && task.durationMinutes <= 0) {
    bad(
      "duration-not-positive",
      `"${id}" declares a duration of ${task.durationMinutes} minutes. §12.3's runbook is a ` +
        `minute/time-window plan; a zero-length task cannot be sequenced against a window and ` +
        `sums into a cutover that appears to fit in less time than it takes.`,
    )
  }

  if (named(task?.executor) && named(task?.approver) && task.executor.trim() === task.approver.trim()) {
    bad(
      "self-approved",
      `"${id}" names ${task.executor} as both executor and approver. §12.3 names them as two ` +
        `bindings, §6.2 promotes "under separation of duties", and §15.4.1 requires two-person ` +
        `approval records. One seat in both is not an incomplete task — it is a task the runbook ` +
        `renders as approved.`,
    )
  }

  const verification = task?.verification
  if (verification !== null && typeof verification === "object") {
    if (!named(verification.success)) {
      bad(
        "no-success-threshold",
        `"${id}" states no success threshold. §12.3 requires "success/failure thresholds", and a ` +
          `task with neither is verified by the executor's judgement at 03:00.`,
      )
    }
    if (!named(verification.failure)) {
      bad(
        "no-failure-threshold",
        `"${id}" states no failure threshold. Without one, a task that did not succeed is ` +
          `indistinguishable from a task nobody has finished checking — and only one of those ` +
          `stops the cutover.`,
      )
    }
    if (!named(verification.evidence)) {
      bad(
        "no-evidence",
        `"${id}" names no evidence. §12.6's board "reviews current evidence, not prepared slides ` +
          `alone", which it can only do for tasks that produce some.`,
      )
    }
  }

  const retry = task?.retry
  if (retry !== null && typeof retry === "object") {
    if (!Number.isInteger(retry.attempts) || retry.attempts < 1) {
      bad(
        "retry-attempts-unstated",
        `"${id}" declares retry without a whole number of attempts ≥ 1. "Retry: yes" is not a ` +
          `procedure — at 03:00 it is read as "keep going".`,
      )
    } else if (retry.attempts > 1 && retry.idempotent !== true) {
      bad(
        "retry-without-idempotency",
        `"${id}" may be attempted ${retry.attempts} times and does not declare itself idempotent. ` +
          `§3.2 requires that "optimistic concurrency and idempotency protect every state ` +
          `transition"; retrying a non-idempotent task is how one payment file becomes two.`,
      )
    }
  }

  if (named(task?.rollbackBoundary) && !ROLLBACK_BOUNDARIES.includes(task.rollbackBoundary.trim())) {
    bad(
      "unknown-rollback-boundary",
      `"${task.rollbackBoundary}" is not one of §12.8's boundaries: ` +
        `${ROLLBACK_BOUNDARIES.join(", ")}. A boundary the rollback plans do not cover is a task ` +
        `whose reversal nobody has designed.`,
    )
  }

  if (task?.prerequisites !== undefined && !Array.isArray(task.prerequisites)) {
    bad(
      "prerequisites-not-a-list",
      `"${id}" declares prerequisites that are not a list. §12.3 binds prerequisites per task; ` +
        `a prose sentence cannot be checked for order or for existence.`,
    )
  }

  return Object.freeze(problems)
}

/**
 * Properties of the runbook as a whole: identity, reachability, and order.
 *
 * The cycle check is the one that cannot be done per task. Three tasks each
 * waiting for the next is a runbook where every individual binding is complete
 * and nothing can start, and it renders as a valid dependency list.
 */
export function runbookProblems(tasks) {
  const problems = []
  const bad = (task, reason, detail) => problems.push(Object.freeze({ task, reason, detail }))

  const list = Array.isArray(tasks) ? tasks : []
  const seen = new Set()
  for (const task of list) {
    const id = named(task?.id) ? task.id.trim() : null
    if (id && seen.has(id)) {
      bad(
        id,
        "duplicate-task-id",
        `"${id}" appears twice. Prerequisites and evidence both cite tasks by id, so two tasks ` +
          `with one id means a dependency is satisfied by whichever the reader found first.`,
      )
    }
    if (id) seen.add(id)
    problems.push(...taskProblems(task))
  }

  for (const task of list) {
    const id = named(task?.id) ? task.id.trim() : null
    if (!id || !Array.isArray(task.prerequisites)) continue
    for (const prerequisite of task.prerequisites) {
      const upstream = String(prerequisite ?? "").trim()
      if (!upstream) {
        bad(id, "empty-prerequisite", `"${id}" lists an empty prerequisite.`)
        continue
      }
      if (!seen.has(upstream)) {
        bad(
          id,
          "unknown-prerequisite",
          `"${id}" depends on "${upstream}", which is not a task in this runbook. A dependency ` +
            `on something absent is never reported unmet.`,
        )
      }
    }
  }

  for (const cycle of dependencyCycles(list)) {
    bad(
      cycle[0],
      "dependency-cycle",
      `${cycle.join(" → ")} → ${cycle[0]} is a cycle. Every binding in it may be complete and ` +
        `none of these tasks can start; a dependency list renders it as ordinary.`,
    )
  }

  return Object.freeze(problems)
}

/**
 * Prerequisite cycles, each reported once from its lowest-sorting member.
 *
 * Iterative depth-first search with an explicit stack rather than recursion: a
 * runbook is operator-authored data and a deep chain must not be able to end the
 * process with a stack overflow instead of a finding.
 */
export function dependencyCycles(tasks) {
  const graph = new Map()
  for (const task of tasks ?? []) {
    const id = named(task?.id) ? task.id.trim() : null
    if (!id) continue
    graph.set(
      id,
      (Array.isArray(task.prerequisites) ? task.prerequisites : [])
        .map((p) => String(p ?? "").trim())
        .filter(Boolean),
    )
  }

  const found = new Map()
  const state = new Map() // id → 0 unvisited, 1 on stack, 2 done

  for (const root of [...graph.keys()].sort()) {
    if (state.get(root) === 2) continue
    /** @type {{ id: string, next: number }[]} */
    const stack = [{ id: root, next: 0 }]
    const path = [root]
    state.set(root, 1)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const edges = graph.get(frame.id) ?? []
      if (frame.next >= edges.length) {
        state.set(frame.id, 2)
        stack.pop()
        path.pop()
        continue
      }
      const next = edges[frame.next++]
      if (!graph.has(next)) continue // reported as unknown-prerequisite instead
      if (state.get(next) === 1) {
        const cycle = path.slice(path.indexOf(next))
        // Canonical form: rotate so the lowest-sorting id leads, so the same
        // cycle discovered from two roots is reported once.
        const lowest = cycle.indexOf([...cycle].sort()[0])
        const rotated = [...cycle.slice(lowest), ...cycle.slice(0, lowest)]
        found.set(rotated.join("→"), Object.freeze(rotated))
        continue
      }
      if (state.get(next) === 2) continue
      state.set(next, 1)
      stack.push({ id: next, next: 0 })
      path.push(next)
    }
  }

  return Object.freeze([...found.values()].sort((a, b) => a[0].localeCompare(b[0])))
}

/**
 * The runbook's total duration in minutes, and what is not counted.
 *
 * Returns `{ total, unbound }` — never a bare number. A sum over tasks where
 * some declare no duration is a smaller number than the truth, and a smaller
 * number that looks complete is how a cutover window is agreed that does not
 * fit. `unbound` names every task the total could not include.
 */
export function plannedDuration(tasks) {
  let total = 0
  const unbound = []
  for (const task of tasks ?? []) {
    const id = named(task?.id) ? task.id.trim() : "(unnamed)"
    if (Number.isFinite(task?.durationMinutes) && task.durationMinutes > 0) {
      total += task.durationMinutes
    } else {
      unbound.push(id)
    }
  }
  return Object.freeze({ total, unbound: Object.freeze(unbound) })
}
