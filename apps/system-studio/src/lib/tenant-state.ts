import { RESIDUAL_COST, SERVING, needsApproval, nextStates, type TenantState } from "@tenure/provisioning"

import type { HighRisk } from "@/components/states"

/**
 * GE-022-006 — which lifecycle states mean "archived" and "about to be gone",
 * and what a person needs told before moving a tenant into one.
 *
 * All of it is derived from the lifecycle graph rather than written down beside
 * it. A second list of "dangerous states" maintained by hand is a list that
 * disagrees with the state machine the first time someone adds a state, and the
 * disagreement surfaces as a confirmation dialog that does not appear.
 */

/** Retained, readable, not serving. */
export const ARCHIVED_STATES: ReadonlySet<TenantState> = new Set<TenantState>([
  "SUSPENDED_LOGICAL",
  "HIBERNATED_ZERO_RUNTIME",
])

/** On the way out. `PURGE_PENDING` is still recoverable; `PURGING` is not. */
export const PURGE_STATES: ReadonlySet<TenantState> = new Set<TenantState>(["PURGE_PENDING", "PURGING"])

/**
 * Can a tenant that reaches `state` ever serve traffic again?
 *
 * Answered by walking the transition graph, not by a label. Breadth-first from
 * the target state: if no serving state is reachable, the move is one-way, and
 * that is the single most important thing to tell someone before they make it.
 */
export function canReachServing(state: TenantState): boolean {
  const seen = new Set<TenantState>([state])
  const queue: TenantState[] = [state]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (SERVING.has(current)) return true
    for (const next of nextStates(current)) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return false
}

/**
 * The five things Bible §26.6 requires before a high-risk action runs, for one
 * transition, filled from facts the engine already holds.
 *
 * Nothing here is a fixed string dressed up as analysis: the impact is the
 * residual-cost note the fleet page already shows, the policy is whether the
 * lifecycle demands an approver, and reversibility comes from `canReachServing`.
 */
export function riskOf(slug: string, from: TenantState, to: TenantState): HighRisk {
  const oneWay = !canReachServing(to)
  const residual = RESIDUAL_COST[to]

  return {
    target: `${slug} — currently ${from}`,
    impact: [
      SERVING.has(to) ? "Serves traffic in this state." : "Does not serve traffic in this state.",
      residual ?? "",
    ]
      .filter(Boolean)
      .join(" "),
    policy: needsApproval(from, to)
      ? `Lifecycle requires a recorded approver for ${from} → ${to}.`
      : `Lifecycle permits ${from} → ${to} without a second approver.`,
    approval: needsApproval(from, to)
      ? "A second operator identity. The engine refuses the same person as actor and approver."
      : "None required.",
    reversibility: oneWay
      ? `IRREVERSIBLE. No path back to a serving state exists from ${to}.`
      : `Reversible. A serving state is reachable again from ${to}.`,
  }
}
