/**
 * A workflow, declared rather than compiled in.
 *
 * The application's approval flow is currently a `switch` over statuses in
 * `lib/approvals.ts`. It is correct, and it is also the only flow the product
 * can have: a nonprofit that wants a two-stage programme review, or a university
 * that wants a finance gate before the staff-office gate, needs a code change
 * and a deploy.
 *
 * A definition makes the flow data. The engine stays the same; what differs
 * between two organization systems is which definition their release pins.
 *
 * Deliberately a state machine with gates, not a general workflow language.
 * Timers, parallel branches, compensation and sub-processes are all real
 * requirements and all absent, because the thing that has to be right first is
 * that a transition cannot happen unless someone with the right role takes it,
 * and that an in-flight instance keeps the rules it started under.
 */

export interface WorkflowState {
  key: string
  label: string
  /** Terminal states have no outgoing transitions and end the instance. */
  terminal?: boolean
}

/**
 * Who may take a transition.
 *
 * A role the *actor plays for this instance* — requester, approver at a named
 * gate — rather than a global role name. That distinction is what lets one
 * definition serve every organization: "the president of the club this request
 * belongs to" is a relationship, and the host resolves it.
 */
export type ActorRole = string

export interface WorkflowTransition {
  /** Action name, e.g. "approve". Unique per (from, action). */
  action: string
  from: string
  to: string
  /** Any one of these roles may take it. Empty means nobody, which is a defect. */
  allowedRoles: readonly ActorRole[]
  label: string
  /**
   * Named condition the host evaluates, e.g. "requesterIsPresident".
   *
   * A string rather than a function so a definition stays serializable and
   * diffable — a release pins the definition, and a function cannot be hashed.
   * The host supplies the values; the engine only reads them.
   */
  when?: string
  /** Inverts `when`. Two transitions on one action, split by a condition. */
  unless?: string
}

export interface WorkflowDefinition {
  key: string
  version: string
  name: string
  initial: string
  states: readonly WorkflowState[]
  transitions: readonly WorkflowTransition[]
}

export class WorkflowDefinitionError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`Invalid workflow definition:\n  ${problems.join("\n  ")}`)
    this.name = "WorkflowDefinitionError"
    this.problems = problems
  }
}

/**
 * Check a definition before anything runs on it.
 *
 * Every failure here is one that would otherwise appear as an instance stuck in
 * a state nobody can leave — which looks, to the person holding it, exactly like
 * a permissions problem.
 */
export function validateDefinition(def: WorkflowDefinition): void {
  const problems: string[] = []
  const stateKeys = new Set<string>()

  for (const s of def.states) {
    if (!s.key) problems.push("A state has no key.")
    else if (stateKeys.has(s.key)) problems.push(`Duplicate state "${s.key}".`)
    else stateKeys.add(s.key)
  }

  if (def.states.length === 0) problems.push("A workflow must declare at least one state.")
  if (!stateKeys.has(def.initial)) {
    problems.push(`Initial state "${def.initial}" is not declared.`)
  }

  const seen = new Set<string>()
  for (const t of def.transitions) {
    if (!stateKeys.has(t.from)) problems.push(`Transition "${t.action}" leaves unknown state "${t.from}".`)
    if (!stateKeys.has(t.to)) problems.push(`Transition "${t.action}" enters unknown state "${t.to}".`)
    if (t.allowedRoles.length === 0) {
      problems.push(`Transition "${t.action}" from "${t.from}" allows no roles, so nobody could take it.`)
    }
    if (t.when && t.unless) {
      problems.push(`Transition "${t.action}" from "${t.from}" declares both when and unless.`)
    }

    const fromState = def.states.find((s) => s.key === t.from)
    if (fromState?.terminal) {
      problems.push(`Transition "${t.action}" leaves terminal state "${t.from}".`)
    }

    // (from, action, when) must be unique: two unconditional transitions on the
    // same action from the same state means the outcome depends on array order.
    const key = `${t.from}::${t.action}::${t.when ?? ""}::${t.unless ?? ""}`
    if (seen.has(key)) {
      problems.push(`Two transitions for "${t.action}" from "${t.from}" with the same condition.`)
    }
    seen.add(key)
  }

  // Every non-terminal state must have a way out, and every state must be
  // reachable from the initial one. Both failures strand instances.
  for (const s of def.states) {
    if (s.terminal) continue
    if (!def.transitions.some((t) => t.from === s.key)) {
      problems.push(`State "${s.key}" is not terminal and has no outgoing transition.`)
    }
  }

  const reachable = new Set<string>([def.initial])
  const queue = [def.initial]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const t of def.transitions.filter((t) => t.from === cur)) {
      if (reachable.has(t.to)) continue
      reachable.add(t.to)
      queue.push(t.to)
    }
  }
  for (const s of def.states) {
    if (!reachable.has(s.key)) {
      problems.push(`State "${s.key}" is unreachable from the initial state "${def.initial}".`)
    }
  }

  if (problems.length > 0) throw new WorkflowDefinitionError(problems)
}

/** Freeze a validated definition. A published version is immutable. */
export function publishDefinition(def: WorkflowDefinition): WorkflowDefinition {
  validateDefinition(def)
  return Object.freeze({
    ...def,
    states: Object.freeze(def.states.map((s) => Object.freeze({ ...s }))),
    transitions: Object.freeze(
      def.transitions.map((t) =>
        Object.freeze({ ...t, allowedRoles: Object.freeze([...t.allowedRoles]) }),
      ),
    ),
  })
}
