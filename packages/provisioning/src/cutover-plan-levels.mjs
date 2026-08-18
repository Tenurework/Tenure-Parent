/**
 * EXT-100-003 — the six cutover plan levels, and the joins between them.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §12.3
 * says "Maintain:" and then names six artefacts — strategy, integrated plan,
 * detailed runbook, contact/escalation matrix, communications plan, decision
 * log. Each bullet names its own required content.
 *
 * Two of the six already exist as modules and are NOT restated here:
 *
 *   · the detailed runbook is `cutover-runbook.mjs` (EXT-100-006), which binds a
 *     task to §12.3's ten bindings and finds prerequisite cycles;
 *   · the contact/escalation matrix is `cutover-command-roles.mjs`
 *     (EXT-100-002), which fills §12.2's seats and finds coverage gaps.
 *
 * This module owns the other four and, more importantly, the JOINS. A plan set
 * where every artefact is individually complete and they disagree with each
 * other is the normal failure, not the exotic one: a decision log citing a task
 * that was renamed, a communications plan owned by a seat nobody filled, a
 * milestone depending on a milestone that was cut. Each of those renders as a
 * complete plan in six documents and as a contradiction only when the two are
 * read together — which, by T0, nobody does.
 *
 * So `planProblems` takes the runbook and the roster as arguments, and refuses:
 *
 *   · `decision-affects-unknown-task` — a decision that changed a task that is
 *     not in the runbook;
 *   · `decision-authority-not-accountable` — a decision taken by a seat §12.2
 *     does not make accountable, or by nobody;
 *   · `communication-owner-not-a-seat` — an audience owned by a name rather than
 *     by a durable seat;
 *   · `milestone-dependency-unknown` / `milestone-dependency-cycle` — an
 *     integrated plan that cannot be executed in any order.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * Same reason as `cutover-runbook.mjs`: Node 20 (which CI pins) cannot load TS,
 * and both readers — `node --test` and the generator under `tools/` — run there.
 */

import { COMMAND_SEATS } from "./cutover-command-roles.mjs"
import { dependencyCycles } from "./cutover-runbook.mjs"

/**
 * §12.3's six levels. `owner` names the module that checks a level's interior
 * when that is somewhere else, so this list stays the index of the six rather
 * than becoming a second copy of two of them.
 */
export const PLAN_LEVELS = Object.freeze([
  Object.freeze({ key: "strategy", title: "Strategy", owner: "cutover-plan-levels.mjs" }),
  Object.freeze({ key: "integratedPlan", title: "Integrated plan", owner: "cutover-plan-levels.mjs" }),
  Object.freeze({ key: "runbook", title: "Detailed runbook", owner: "cutover-runbook.mjs" }),
  Object.freeze({ key: "contactMatrix", title: "Contact/escalation matrix", owner: "cutover-command-roles.mjs" }),
  Object.freeze({ key: "communicationsPlan", title: "Communications plan", owner: "cutover-plan-levels.mjs" }),
  Object.freeze({ key: "decisionLog", title: "Decision log", owner: "cutover-plan-levels.mjs" }),
])

/** §12.3's strategy bullet, one entry per noun it names. */
export const STRATEGY_ELEMENTS = Object.freeze([
  Object.freeze({ key: "scope", phrase: "scope" }),
  Object.freeze({ key: "approach", phrase: "approach" }),
  Object.freeze({ key: "freeze", phrase: "freeze" }),
  Object.freeze({ key: "coexistence", phrase: "coexistence" }),
  Object.freeze({ key: "migration", phrase: "migration" }),
  Object.freeze({ key: "activation", phrase: "activation" }),
  Object.freeze({ key: "rollbackPhilosophy", phrase: "rollback philosophy" }),
  Object.freeze({ key: "support", phrase: "support" }),
  Object.freeze({ key: "successMeasures", phrase: "success measures" }),
])

/** §12.3's communications-plan bullet, one entry per noun it names. */
export const COMMUNICATION_ELEMENTS = Object.freeze([
  Object.freeze({ key: "audience", phrase: "audience" }),
  Object.freeze({ key: "channel", phrase: "channel" }),
  Object.freeze({ key: "template", phrase: "template" }),
  Object.freeze({ key: "trigger", phrase: "trigger" }),
  Object.freeze({ key: "owner", phrase: "owner" }),
  Object.freeze({ key: "translations", phrase: "translations" }),
  Object.freeze({ key: "accessibility", phrase: "accessibility" }),
  Object.freeze({ key: "approval", phrase: "approval" }),
])

/** §12.3's decision-log bullet, one entry per noun it names. */
export const DECISION_ELEMENTS = Object.freeze([
  Object.freeze({ key: "options", phrase: "options" }),
  Object.freeze({ key: "evidence", phrase: "evidence" }),
  Object.freeze({ key: "authority", phrase: "authority" }),
  Object.freeze({ key: "timestamp", phrase: "timestamp" }),
  Object.freeze({ key: "rationale", phrase: "rationale" }),
  Object.freeze({ key: "affectedTasks", phrase: "affected tasks" }),
  Object.freeze({ key: "followUp", phrase: "follow-up" }),
])

/**
 * §12.3's integrated plan runs "from preparation through hypercare".
 *
 * Named as phases rather than dates because §12.4 already owns the dates: an
 * integrated plan whose milestones all sit in one phase is a workstream plan
 * with a bigger title, and the span is the property that distinguishes them.
 */
export const PLAN_PHASES = Object.freeze([
  "PREPARATION",
  "BUILD",
  "REHEARSAL",
  "CUTOVER",
  "HYPERCARE",
])

const named = (value) => typeof value === "string" && value.trim().length > 0

/** ISO-8601 instant, not a date: §12.3 asks a decision for its timestamp. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const ACCOUNTABLE_SEATS = Object.freeze(COMMAND_SEATS.filter((s) => s.accountable).map((s) => s.key))
const ALL_SEATS = Object.freeze(COMMAND_SEATS.map((s) => s.key))

/**
 * Every way a plan set fails §12.3, in a stable order.
 *
 * `context` carries the artefacts the joins are checked against:
 *   · `runbookTasks` — the tasks `cutover-runbook.mjs` validated;
 *   · `roster` — the seats `cutover-command-roles.mjs` validated.
 * Both are optional, and their absence is reported as its own finding rather
 * than silently skipping the join. A join that quietly does not run is the same
 * defect as a join that passes wrongly, one level further back.
 */
export function planProblems(plan, context = {}) {
  const problems = []
  const bad = (level, reason, detail) => problems.push(Object.freeze({ level, reason, detail }))

  for (const level of PLAN_LEVELS) {
    const value = plan?.[level.key]
    const present = level.key === "strategy" ? value !== null && typeof value === "object" : Array.isArray(value) ? value.length > 0 : value !== null && typeof value === "object"
    if (!present) {
      bad(
        level.key,
        "level-absent",
        `§12.3 says "Maintain:" and names ${level.title} as one of ${PLAN_LEVELS.length} levels. ` +
          `This plan set has none, so the questions it answers are answered ad hoc.`,
      )
    }
  }

  // ── Strategy ──────────────────────────────────────────────────────────────
  const strategy = plan?.strategy
  if (strategy !== null && typeof strategy === "object") {
    for (const element of STRATEGY_ELEMENTS) {
      if (!named(strategy[element.key])) {
        bad(
          "strategy",
          "strategy-element-missing",
          `The strategy states no ${element.phrase}. §12.3's strategy bullet names all ` +
            `${STRATEGY_ELEMENTS.length}; an unstated one is decided during the cutover it was ` +
            `supposed to govern.`,
        )
      }
    }
  }

  // ── Integrated plan ───────────────────────────────────────────────────────
  const milestones = Array.isArray(plan?.integratedPlan) ? plan.integratedPlan : []
  const milestoneIds = new Set()
  for (const milestone of milestones) {
    const id = named(milestone?.id) ? milestone.id.trim() : null
    if (!id) {
      bad("integratedPlan", "milestone-unidentified", "A milestone with no id cannot be depended on or reported.")
      continue
    }
    if (milestoneIds.has(id)) {
      bad("integratedPlan", "milestone-duplicated", `"${id}" appears twice; a dependency on it is satisfied by whichever the reader found first.`)
    }
    milestoneIds.add(id)
    if (!named(milestone.workstream)) {
      bad("integratedPlan", "milestone-without-workstream", `"${id}" belongs to no workstream. §12.3's integrated plan is "workstream milestones and dependencies".`)
    }
    if (!PLAN_PHASES.includes(milestone.phase)) {
      bad(
        "integratedPlan",
        "milestone-phase-unknown",
        `"${id}" is in phase "${milestone.phase}", which is not one of ${PLAN_PHASES.join(", ")}. ` +
          `§12.3's plan spans "preparation through hypercare"; a milestone outside that span is ` +
          `outside the plan it is in.`,
      )
    }
  }
  if (milestones.length > 0) {
    const covered = new Set(milestones.map((m) => m.phase))
    for (const phase of PLAN_PHASES) {
      if (!covered.has(phase)) {
        bad(
          "integratedPlan",
          "phase-uncovered",
          `No milestone sits in ${phase}. §12.3 requires the integrated plan to run "from ` +
            `preparation through hypercare"; a plan that stops at cutover hands hypercare a ` +
            `date nobody agreed.`,
        )
      }
    }
  }
  for (const milestone of milestones) {
    const id = named(milestone?.id) ? milestone.id.trim() : null
    if (!id) continue
    for (const dependency of Array.isArray(milestone.dependsOn) ? milestone.dependsOn : []) {
      const upstream = String(dependency ?? "").trim()
      if (!milestoneIds.has(upstream)) {
        bad(
          "integratedPlan",
          "milestone-dependency-unknown",
          `"${id}" depends on "${upstream}", which is not a milestone in this plan. A dependency ` +
            `on something absent is never reported unmet.`,
        )
      }
    }
  }
  // Reuses the runbook's cycle finder rather than growing a second one; it reads
  // `{ id, prerequisites }`, which is the same graph under a different noun.
  for (const cycle of dependencyCycles(milestones.map((m) => ({ id: m?.id, prerequisites: m?.dependsOn })))) {
    bad(
      "integratedPlan",
      "milestone-dependency-cycle",
      `${cycle.join(" → ")} → ${cycle[0]} is a cycle. The plan has an order for every pair and no ` +
        `order overall.`,
    )
  }

  // ── Communications plan ───────────────────────────────────────────────────
  const communications = Array.isArray(plan?.communicationsPlan) ? plan.communicationsPlan : []
  for (const entry of communications) {
    const audience = named(entry?.audience) ? entry.audience.trim() : "(unnamed audience)"
    for (const element of COMMUNICATION_ELEMENTS) {
      const value = entry?.[element.key]
      const present = element.key === "channel" ? Array.isArray(value) && value.length > 0 : named(value)
      if (!present) {
        bad(
          "communicationsPlan",
          "communication-element-missing",
          `"${audience}" declares no ${element.phrase}. §12.3's communications bullet names all ` +
            `${COMMUNICATION_ELEMENTS.length}, and §12.6's board reviews "communications" as a ` +
            `readiness dimension.`,
        )
      }
    }
    if (named(entry?.owner) && !ALL_SEATS.includes(entry.owner.trim())) {
      bad(
        "communicationsPlan",
        "communication-owner-not-a-seat",
        `"${audience}" is owned by "${entry.owner}", which is not one of §12.2's ` +
          `${ALL_SEATS.length} durable seats. An owner who is a person rather than a seat leaves ` +
          `the audience unowned the moment that person changes job.`,
      )
    }
  }

  // ── Decision log ──────────────────────────────────────────────────────────
  const decisions = Array.isArray(plan?.decisionLog) ? plan.decisionLog : []
  const runbookTasks = context.runbookTasks
  const knownTasks = Array.isArray(runbookTasks)
    ? new Set(runbookTasks.map((t) => (named(t?.id) ? t.id.trim() : "")).filter(Boolean))
    : null
  const rosterSeats = Array.isArray(context.roster?.seats)
    ? new Set(context.roster.seats.map((s) => (named(s?.seat) ? s.seat.trim() : "")).filter(Boolean))
    : null

  if (decisions.length > 0 && knownTasks === null) {
    bad(
      "decisionLog",
      "runbook-not-supplied",
      "The decision log was checked without the runbook, so no decision's affected tasks could " +
        "be resolved. That is not the same as every decision citing a real task, and reporting " +
        "it as clean would collapse the two.",
    )
  }
  if (decisions.length > 0 && rosterSeats === null) {
    bad(
      "decisionLog",
      "roster-not-supplied",
      "The decision log was checked without the roster, so no decision's authority could be " +
        "resolved to a staffed seat.",
    )
  }

  for (const decision of decisions) {
    const id = named(decision?.id) ? decision.id.trim() : "(unidentified decision)"
    for (const element of DECISION_ELEMENTS) {
      const value = decision?.[element.key]
      const present =
        element.key === "options" || element.key === "affectedTasks"
          ? Array.isArray(value) && value.length > 0
          : named(value)
      if (!present) {
        bad(
          "decisionLog",
          "decision-element-missing",
          `"${id}" records no ${element.phrase}. §12.3's decision-log bullet names all ` +
            `${DECISION_ELEMENTS.length}; a decision missing its options is a decision that ` +
            `records the outcome and destroys the reasoning.`,
        )
      }
    }
    if (Array.isArray(decision?.options) && decision.options.length < 2) {
      bad(
        "decisionLog",
        "decision-had-one-option",
        `"${id}" records ${decision.options.length} option. §12.3 asks for "options"; one option ` +
          `is a decision that was taken before the log was opened, and the log makes it look ` +
          `considered.`,
      )
    }
    if (named(decision?.timestamp) && !INSTANT.test(decision.timestamp.trim())) {
      bad(
        "decisionLog",
        "decision-timestamp-not-an-instant",
        `"${id}" is timestamped "${decision.timestamp}", which is not an ISO-8601 instant with a ` +
          `zone. A cutover is run by seats in several time zones, so a bare date orders two ` +
          `decisions by nothing.`,
      )
    }
    if (named(decision?.authority)) {
      const authority = decision.authority.trim()
      if (!ACCOUNTABLE_SEATS.includes(authority)) {
        bad(
          "decisionLog",
          "decision-authority-not-accountable",
          `"${id}" was taken by "${authority}", which is not one of §12.2's accountable seats ` +
            `(${ACCOUNTABLE_SEATS.join(", ")}). §12.6 records "participants, votes/authority"; a ` +
            `decision taken by a seat with no authority is an opinion the log promotes.`,
        )
      } else if (rosterSeats !== null && !rosterSeats.has(authority)) {
        bad(
          "decisionLog",
          "decision-authority-unstaffed",
          `"${id}" was taken by "${authority}", which is accountable but is not on this cutover's ` +
            `roster. The seat exists; nobody is in it.`,
        )
      }
    }
    if (knownTasks !== null) {
      for (const task of Array.isArray(decision?.affectedTasks) ? decision.affectedTasks : []) {
        const ref = String(task ?? "").trim()
        if (!knownTasks.has(ref)) {
          bad(
            "decisionLog",
            "decision-affects-unknown-task",
            `"${id}" changed task "${ref}", which is not in the runbook. Either the decision was ` +
              `never applied or the task was renamed after it was — and the log reads identically ` +
              `in both cases.`,
          )
        }
      }
    }
  }

  return Object.freeze(problems)
}

/**
 * Which of §12.3's six levels this plan set actually maintains, and which
 * module answered for each.
 *
 * Returned as data so the generator can print it and the test can assert it,
 * rather than as a boolean: "five of six" is the answer that matters and a
 * boolean cannot carry it.
 */
export function levelCoverage(plan) {
  return Object.freeze(
    PLAN_LEVELS.map((level) => {
      const value = plan?.[level.key]
      const present = Array.isArray(value) ? value.length > 0 : value !== null && typeof value === "object"
      return Object.freeze({
        level: level.key,
        title: level.title,
        checkedBy: level.owner,
        maintained: present,
        entries: Array.isArray(value) ? value.length : present ? 1 : 0,
      })
    }),
  )
}
