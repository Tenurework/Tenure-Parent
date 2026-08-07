import {
  REQUIRES_OWNER,
  RESIDUAL_CLAIMS,
  RESIDUAL_COST,
  SERVING,
  needsApproval,
  nextStates,
  observeResidual,
  reconcileResidual,
  type ObservedTenantResources,
  type ResourceClass,
  type TenantState,
} from "@tenure/provisioning"

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
/**
 * WRK-120-005 — what this tenant is actually holding, said in the residual
 * vocabulary.
 *
 * A thin projection so both the risk panel and the state panel observe from the
 * same four facts. Every one of them is something the registry already owns —
 * `tests/security/operator-plane-content.test.mjs` fails if the console ever
 * needs a row from a tenant's database to answer an operational question.
 */
export function observedFor(input: ObservedTenantResources): readonly ResourceClass[] {
  return observeResidual(input)
}

/**
 * The residual claim for a state, checked against what is retained.
 *
 * Returns `null` for a state that claims nothing — ACTIVE, DRAFT, anything
 * still running. That is deliberately not an empty reconciliation: "we compared
 * and found nothing wrong" and "there was nothing to compare" are different
 * statements, and a panel that renders the second as the first is telling an
 * operator a check ran that did not.
 */
export function residualFindings(
  state: TenantState,
  observed: readonly ResourceClass[],
): { note: string; unexplained: readonly ResourceClass[]; overclaimed: readonly ResourceClass[] } | null {
  const claim = RESIDUAL_CLAIMS[state]
  if (!claim) return null
  const { unexplained, overclaimed } = reconcileResidual(claim, observed)
  return { note: claim.note, unexplained, overclaimed }
}

export function riskOf(
  slug: string,
  from: TenantState,
  to: TenantState,
  /**
   * What the tenant is holding right now.
   *
   * Required rather than defaulted to empty. An empty default would make every
   * caller that forgot it report "nothing unexplained", which is the answer an
   * operator most wants to be true and the one they must not be given by
   * accident — so `tsc` names the caller instead.
   */
  observed: readonly ResourceClass[],
): HighRisk {
  const oneWay = !canReachServing(to)
  const residual = RESIDUAL_COST[to]
  // WRK-120-005. The sentence was unfalsifiable on its own: it says what the
  // destination state is SUPPOSED to retain, and nothing compared it to what
  // this tenant actually holds. A hibernated tenant still running a dedicated
  // task rendered identically to one that is not.
  const findings = residualFindings(to, observed)

  return {
    target: `${slug} — currently ${from}`,
    impact: [
      SERVING.has(to) ? "Serves traffic in this state." : "Does not serve traffic in this state.",
      residual ?? "",
      findings && findings.unexplained.length > 0
        ? `Retained beyond that claim, and still billing: ${findings.unexplained.join(", ")}.`
        : "",
      findings && findings.overclaimed.length > 0
        ? `Claimed by that note and not held here: ${findings.overclaimed.join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    policy: needsApproval(from, to)
      ? `Lifecycle requires a recorded approver for ${from} → ${to}.`
      : `Lifecycle permits ${from} → ${to} without a second approver.`,
    approval: [
      needsApproval(from, to)
        ? "A second operator identity. The engine refuses the same person as actor and approver."
        : "None required.",
      // The owner is not the approver, and saying so here is the point: one
      // agrees to the move, the other answers for the tenant afterwards.
      REQUIRES_OWNER.has(to)
        ? `A successor owner must be named — ${to} without one is how a departure leaves an orphan.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    reversibility: oneWay
      ? `IRREVERSIBLE. No path back to a serving state exists from ${to}.`
      : `Reversible. A serving state is reachable again from ${to}.`,
  }
}
