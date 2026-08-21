import {
  REQUIRES_OWNER,
  RESIDUAL_CLAIMS,
  RESIDUAL_COST,
  SERVING,
  classify,
  needsApproval,
  nextStates,
  observeResidual,
  reconcileResidual,
  type IsolationTier,
  type ObservedTenantResources,
  type ResourceClass,
  type TenantState,
} from "@tenure/provisioning"

import { mutationForTransition, planMutation } from "./aws/mutate"
import { purgeFinalitySentence } from "./purge-finality"
import { riskDigest, type HighRisk } from "../components/states"

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
 * Does moving to `state` destroy something nothing can put back?
 *
 * Asked of `classify`, which is the platform's one answer to that question:
 * C7 is defined as "destroys data or capability that cannot be recreated from
 * anything this platform holds", and `requirementsFor` refuses to automate it.
 * A second list here would be a list that disagrees with the gate the first
 * time somebody adds a state. The target is not read by `classify` — the class
 * of a lifecycle move is a property of the destination alone.
 */
function destroysTenant(state: TenantState): boolean {
  return classify({ surface: "tenant-lifecycle", action: state, target: "" }) === "C7"
}

/**
 * Can a tenant that reaches `state` ever serve traffic again?
 *
 * Answered by walking the transition graph, not by a label. Breadth-first from
 * the target state: if no serving state is reachable, the move is one-way, and
 * that is the single most important thing to tell someone before they make it.
 *
 * ## The walk stops at a state that destroys the tenant
 *
 * Without that clause this function returned `true` for EVERY state in the
 * graph, including `PURGING` — because `PURGING → FAILED → DRAFT → … → ACTIVE`
 * is a path, and the walk followed it. So `riskOf` told an operator that the
 * one action with no undo was "Reversible. A serving state is reachable again
 * from PURGING", and `AdvanceControls` — which reads exactly this to decide
 * what goes in the separated one-way group — never found a one-way move to
 * separate. The whole of STUDIO-030-004 was unreachable code, and the layout
 * suite's `fieldset.destructive` assertion is what found it.
 *
 * The path is real and it is not a recovery: rebuilding from DRAFT under the
 * same slug produces a new, empty tenant. Coming back from PURGING is a new
 * registration against a restored backup, which is a different operation with a
 * different approval — the same thing `tenant-registry.ts` says about ARCHIVED.
 * So a destroying state is entered and never left for this purpose: it is
 * expanded no further, and only a state that is itself serving, or that reaches
 * one WITHOUT passing through the shredder, counts as reversible.
 */
export function canReachServing(state: TenantState): boolean {
  const seen = new Set<TenantState>([state])
  const queue: TenantState[] = [state]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (SERVING.has(current)) return true
    if (destroysTenant(current)) continue
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

export interface RetainedAwsObservation {
  /**
   * Resource classes found by live retained-resource AWS reads.
   *
   * Kept separate from the registry observation so "the registry says it should
   * hold snapshots" and "AWS shows retained snapshots" cannot be confused.
   */
  classes: readonly ResourceClass[]
  /** Human-readable source rows, rendered on the tenant page. */
  sources: readonly string[]
  /** Reads that could not be made. These are not treated as absence. */
  unknown: readonly string[]
}

export const NO_RETAINED_AWS_OBSERVATION: RetainedAwsObservation = {
  classes: [],
  sources: [],
  unknown: [],
}

function combineResidualClasses(
  registry: readonly ResourceClass[],
  retained: RetainedAwsObservation,
): readonly ResourceClass[] {
  return [...new Set<ResourceClass>([...registry, ...retained.classes])]
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
  retained: RetainedAwsObservation,
): {
  note: string
  unexplained: readonly ResourceClass[]
  overclaimed: readonly ResourceClass[]
  retainedSources: readonly string[]
  retainedUnknown: readonly string[]
} | null {
  const claim = RESIDUAL_CLAIMS[state]
  if (!claim) return null
  const { unexplained, overclaimed } = reconcileResidual(
    claim,
    combineResidualClasses(observed, retained),
  )
  return {
    note: claim.note,
    unexplained,
    overclaimed,
    retainedSources: retained.sources,
    retainedUnknown: retained.unknown,
  }
}

export function riskOf(
  slug: string,
  from: TenantState,
  to: TenantState,
  retained: RetainedAwsObservation,
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
  const findings = residualFindings(to, observed, retained)

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
      findings && findings.retainedUnknown.length > 0
        ? `Live retained-resource reads are unobserved: ${findings.retainedUnknown.join("; ")}.`
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
    /*
     * GE-103-019. The lifecycle half and the CONTENT half, in that order.
     *
     * "No path back to a serving state" is a statement about the transition
     * graph. It is compatible with "and the data is on a snapshot somebody can
     * restore", which for a purge is false — so the second sentence says what
     * is true of the tenant's records, and `purgeFinalitySentence` returns ""
     * for every destination where the question does not arise.
     *
     * Appended, never prepended: `DangerZone.classifyConsequence` reads the
     * first word of this string and throws on anything that is neither
     * IRREVERSIBLE nor Reversible.
     */
    reversibility: [
      oneWay
        ? `IRREVERSIBLE. No path back to a serving state exists from ${to}.`
        : `Reversible. A serving state is reachable again from ${to}.`,
      purgeFinalitySentence(to),
    ]
      .filter(Boolean)
      .join(" "),
  }
}

/**
 * Which gate refused, and what the operator is told — STUDIO-140-006.
 *
 * `code` is what lands on the audit ledger's outcome row, so "how often was
 * this refused, and by which gate" is a scan of one field. `detail` is what the
 * operator reads, and no two arms may produce the same sentence: a gate whose
 * arms all say "not allowed" is a gate no test can tell from a gate that
 * stopped working.
 */
export interface HighRiskVerdict {
  code: "REFUSED_CONFIRMATION" | "REFUSED_STALE_CONSEQUENCE" | "REFUSED_IRREVERSIBLE"
  detail: string
}

/**
 * The three refusals `advanceState` owns, decided in one place — STUDIO-140-006.
 *
 * ## Why this is not inline in the action
 *
 * It used to be, and that made it unprovable. A Next server action reaches its
 * refusals only through an authenticated session and a live registry, so the
 * ONLY thing that could exercise them was a browser suite gated on a running
 * DynamoDB — and a suite that skips when the table is unset asserts nothing at
 * all on the day the table is unset. The decision is pure: it needs the tenant's
 * four observable facts, the transition, and the two strings the form submitted.
 * Nothing in it needs a session, a socket or a clock.
 *
 * So it is a function, and `e2e/high-risk-fails-closed.spec.ts` drives all five
 * refusals through it — the two the lifecycle engine owns (self-approval, an
 * approver who is not an operator) coming from `advance()` itself — and asserts
 * the five sentences differ. The same spec asserts, on the ACTION'S OWN SOURCE,
 * that `advanceState` calls this before `gate()` and returns what it says: a
 * pure decision nothing calls is the failure mode this whole item is about, and
 * an extraction with no binding assertion would have reintroduced it.
 *
 * ## The risk is recomputed here, never accepted from the form
 *
 * `riskOf` is called on facts the SERVER holds — the tenant's isolation, its
 * published deployment, its evidence — and the digest is taken of that. The
 * browser's `riskDigest` field is only ever COMPARED against it. That is what
 * makes the comparison meaningful: an operator who read a consequence that has
 * since changed submits a digest of the old one, and the move is refused rather
 * than applied under a description that stopped being true.
 *
 * Returns `null` when nothing here refuses. That is not "permitted" — the
 * lifecycle engine, the command gate, the cost band and the change-class token
 * all still run afterwards, and `advanceState` runs them in that order.
 */
export function highRiskVerdict(input: {
  slug: string
  from: TenantState
  to: TenantState
  /** The tenant's four observable facts, exactly as the tenant page reads them. */
  isolation: IsolationTier
  hasDeployment: boolean
  serving: boolean
  evidenceRecords: number
  /** The registry table, so a refusal names the resource an operator would type. */
  tenantTable: string | undefined
  reason: string
  /** What the operator typed into the confirmation field. Never trimmed here — the caller trims. */
  typed: string
  /** The digest the page rendered, as submitted. Compared, never trusted. */
  submittedDigest: string
  /**
   * The audit row this attempt already wrote, named so a refusal is traceable
   * to it.
   *
   * Nullable because the ledger's own record type is — a chain whose head has
   * not been claimed yet has no sequence. Rendered as `unrecorded` rather than
   * `null`, because "audit row null" reads as a bug in the message and this is
   * the sentence an operator forwards to whoever they escalate to.
   */
  auditSequence: number | null
}): HighRiskVerdict | null {
  const auditRow = input.auditSequence ?? "unrecorded"
  const observed = observeResidual({
    isolation: input.isolation,
    hasDeployment: input.hasDeployment,
    serving: input.serving,
    evidenceRecords: input.evidenceRecords,
  })
  const risk = riskOf(input.slug, input.from, input.to, NO_RETAINED_AWS_OBSERVATION, observed)

  // Only where the lifecycle demands a second identity. Demanding a typed
  // target on every move is how a control becomes a field people paste into,
  // and the change-class gate (STUDIO-060-007) already asks for its own token
  // on the moves this one does not cover.
  if (needsApproval(input.from, input.to)) {
    if (input.typed !== input.slug) {
      return {
        code: "REFUSED_CONFIRMATION",
        detail:
          `Type ${input.slug} exactly to confirm. The server compares what was typed against the ` +
          `target it resolved itself, so a confirmation typed for a different tenant is refused ` +
          `rather than applied to this one. Audit row ${auditRow}.`,
      }
    }

    if (input.submittedDigest !== riskDigest(risk)) {
      return {
        code: "REFUSED_STALE_CONSEQUENCE",
        detail:
          `The consequence changed while this page was open. What was approved was not what would ` +
          `run now — reload and read it again. Audit row ${auditRow}.`,
      }
    }
  }

  // Two lifecycle moves are AWS mutations and both are in the destructive half.
  // This console refuses to perform them and hands back the commands a human
  // runs under their own credentials.
  const mutation = mutationForTransition({
    slug: input.slug,
    to: input.to,
    isolation: input.isolation,
    serving: input.serving,
    tenantTable: input.tenantTable,
    reason: input.reason,
  })
  if (mutation) {
    const verdict = planMutation(mutation)
    if (verdict.outcome === "REFUSED_IRREVERSIBLE") {
      return { code: "REFUSED_IRREVERSIBLE", detail: verdict.message }
    }
  }

  return null
}
