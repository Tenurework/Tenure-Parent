import type { WorkflowDefinition, WorkflowTransition } from "./definition"

/**
 * What the host knows about one actor and one instance.
 *
 * `roles` are the roles this actor plays *for this instance* — requester,
 * president of the owning club, staff-office approver. The host resolves them,
 * because "the president of the club this request belongs to" is a relationship
 * only the host can evaluate.
 *
 * `conditions` are the named booleans a transition's `when`/`unless` refers to.
 * Passing them in keeps the engine a pure function: the same inputs always
 * produce the same available actions, which is what makes a decision testable
 * and reproducible in a support session.
 */
export interface WorkflowContext {
  state: string
  roles: readonly string[]
  conditions?: Readonly<Record<string, boolean>>
}

export interface AvailableAction {
  action: string
  label: string
  to: string
}

function conditionHolds(t: WorkflowTransition, conditions: Record<string, boolean>): boolean {
  if (t.when) return conditions[t.when] === true
  if (t.unless) return conditions[t.unless] !== true
  return true
}

/** Transitions legal from a state for an actor, before role filtering. */
function candidates(def: WorkflowDefinition, ctx: WorkflowContext): WorkflowTransition[] {
  const conditions = ctx.conditions ?? {}
  return def.transitions.filter((t) => t.from === ctx.state && conditionHolds(t, conditions))
}

/**
 * Every action this actor may take right now.
 *
 * Order follows the definition's transition order, so a UI rendering buttons
 * from this gets a stable, author-controlled sequence rather than one that
 * depends on how roles happened to be sorted.
 */
export function availableActions(
  def: WorkflowDefinition,
  ctx: WorkflowContext,
): AvailableAction[] {
  const out: AvailableAction[] = []
  const seen = new Set<string>()

  for (const t of candidates(def, ctx)) {
    if (!t.allowedRoles.some((r) => ctx.roles.includes(r))) continue
    if (seen.has(t.action)) continue
    seen.add(t.action)
    out.push({ action: t.action, label: t.label, to: t.to })
  }
  return out
}

export type TransitionRefusal =
  | { ok: false; reason: "unknown-action"; detail: string }
  | { ok: false; reason: "not-from-this-state"; detail: string }
  | { ok: false; reason: "condition-not-met"; detail: string }
  | { ok: false; reason: "actor-not-permitted"; detail: string }

export type TransitionResult = { ok: true; to: string; transition: WorkflowTransition } | TransitionRefusal

/**
 * Take an action, or refuse with a reason.
 *
 * Refusals are distinguished rather than collapsed into one "not allowed",
 * because they need different responses: a wrong state is a stale page and
 * should be reloaded, while a permission failure is a genuine denial and should
 * be told to the user as one.
 */
export function applyAction(
  def: WorkflowDefinition,
  ctx: WorkflowContext,
  action: string,
): TransitionResult {
  const conditions = ctx.conditions ?? {}

  const anyWithAction = def.transitions.filter((t) => t.action === action)
  if (anyWithAction.length === 0) {
    return { ok: false, reason: "unknown-action", detail: `"${action}" is not an action in this workflow.` }
  }

  const fromThisState = anyWithAction.filter((t) => t.from === ctx.state)
  if (fromThisState.length === 0) {
    return {
      ok: false,
      reason: "not-from-this-state",
      detail: `"${action}" cannot be taken from "${ctx.state}".`,
    }
  }

  const satisfying = fromThisState.filter((t) => conditionHolds(t, conditions))
  if (satisfying.length === 0) {
    return {
      ok: false,
      reason: "condition-not-met",
      detail:
        `"${action}" from "${ctx.state}" requires ` +
        fromThisState.map((t) => (t.when ? `${t.when}=true` : `${t.unless}=false`)).join(" or ") +
        `.`,
    }
  }

  const permitted = satisfying.find((t) => t.allowedRoles.some((r) => ctx.roles.includes(r)))
  if (!permitted) {
    return {
      ok: false,
      reason: "actor-not-permitted",
      detail:
        `"${action}" from "${ctx.state}" is for ${satisfying
          .flatMap((t) => t.allowedRoles)
          .join(", ")}; this actor is ${ctx.roles.join(", ") || "(no role)"}.`,
    }
  }

  return { ok: true, to: permitted.to, transition: permitted }
}

/**
 * A running instance, pinned to the definition version it started under.
 *
 * Pinning is the whole reason instances are modelled at all. Publishing a new
 * version of an approval flow must not change what the fifty requests already
 * in flight are allowed to do — an approver who opened a request under one set
 * of gates should not find a different set when they come back to it. The
 * pinned version is also what an audit record cites.
 */
export interface WorkflowInstance {
  readonly instanceId: string
  readonly definitionKey: string
  readonly definitionVersion: string
  readonly state: string
  readonly history: readonly {
    action: string
    from: string
    to: string
    actor: string
    at: string
  }[]
}

export function startInstance(
  def: WorkflowDefinition,
  instanceId: string,
): WorkflowInstance {
  return Object.freeze({
    instanceId,
    definitionKey: def.key,
    definitionVersion: def.version,
    state: def.initial,
    history: Object.freeze([]),
  })
}

export class WorkflowError extends Error {
  readonly reason: TransitionRefusal["reason"]
  constructor(refusal: TransitionRefusal) {
    super(refusal.detail)
    this.name = "WorkflowError"
    this.reason = refusal.reason
  }
}

/** Advance an instance. Returns a new instance; the original is untouched. */
export function advance(
  def: WorkflowDefinition,
  instance: WorkflowInstance,
  ctx: Omit<WorkflowContext, "state">,
  action: string,
  by: { actor: string; at: string },
): WorkflowInstance {
  if (def.version !== instance.definitionVersion) {
    // Silently running an instance against a newer definition is how an approver
    // finds different gates than the ones they were shown.
    throw new Error(
      `Instance ${instance.instanceId} is pinned to ${instance.definitionKey}@${instance.definitionVersion}, ` +
        `but was given ${def.key}@${def.version}. Load the pinned version.`,
    )
  }

  const result = applyAction(def, { ...ctx, state: instance.state }, action)
  if (!result.ok) throw new WorkflowError(result)

  return Object.freeze({
    ...instance,
    state: result.to,
    history: Object.freeze([
      ...instance.history,
      Object.freeze({ action, from: instance.state, to: result.to, actor: by.actor, at: by.at }),
    ]),
  })
}

export function isTerminal(def: WorkflowDefinition, state: string): boolean {
  return def.states.find((s) => s.key === state)?.terminal === true
}
