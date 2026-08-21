import {
  decide,
  type AuthorizationRequest,
  type AuthorizationWorld,
  type Decision as AuthorizationDecision,
  type ResourceRef,
} from "@tenure/authorization"

import { evaluate, grantsAccess, type Decision as EligibilityDecision, type Fact } from "./evaluate"
import type { CompiledPolicy } from "./policy"
import { checkProofs, requirementAtTarget, type ProofAssertion, type ProofCheck, type ProofRequirement } from "./proofs"
import { targetWindowState, validateTarget, formatTargetRef, type EligibilityTarget } from "./targets"

/**
 * IER-120-002 / IER-120-003 / IER-120-005 — the composed gate, in the order the
 * Bible puts it in, with the property that only the last stage can allow.
 *
 * §2.1 requires three separate gates and forbids collapsing them into one
 * boolean:
 *
 *   1. **tenant capability entitlement** — has this tenant bought the thing?
 *   2. **person eligibility** — does policy say this person belongs to the
 *      population the thing is for?
 *   3. **authorization** — may this principal perform THIS action on THIS
 *      resource, right now?
 *
 * Two separate engines already answer 2 and 3: `evaluate` in this directory,
 * and `decide` in `@tenure/authorization`. Neither of them knows the other
 * exists, and until now nothing composed them — so "eligible" and "authorized"
 * were two answers with no defined relationship, which in practice means
 * whichever one a caller happened to ask became the access decision.
 *
 * ## The invariant this file exists for
 *
 * **Eligibility never allows.** `allowed` is true only when stage 3 returned
 * `allowed`, and there is exactly one `return` in this function that can set
 * it. IER-120-003 is that sentence — "Require central server authorization
 * after eligibility for every action/resource" — and it is not a habit to
 * maintain but a shape: `decideTargetAccess` has no parameter that skips
 * authorization and no early success path. A caller cannot ask this module
 * "is this person eligible, and just let them in", because that function does
 * not exist here.
 *
 * The converse matters as much and is easier to get wrong: authorization alone
 * does not allow either. A principal holding a CONFIRMED role grant for a
 * permission in a module the tenant never bought is denied at stage 1, before
 * their eligibility is even evaluated — because §2.1's gate 1 is about the
 * TENANT, and a grant is a statement about a person.
 *
 * ## Order, and why person eligibility does not run first
 *
 * IER-120-002's sentence is "Require tenant capability entitlement **before**
 * person eligibility can activate a module". Not merely "as well as": before.
 * When the capability is absent this function returns without calling
 * `evaluate` at all, and the returned `eligibility` is `null` rather than a
 * denial. That is the honest report — nobody asked the eligibility question, so
 * there is no eligibility answer — and it is also the safe one: an eligibility
 * evaluation is a read of a person's roster facts, and a tenant that has not
 * bought the module has bought no reason for that read to happen.
 *
 * ## Determinism
 *
 * `now` is an argument, `world` is a value, `facts` are values. This module
 * reads no clock, no database, no environment and no network, and
 * `module-scope.test.ts` checks that against the source rather than against
 * behaviour, for the reason `engine-purity.test.ts` gives: a behavioural test
 * shows today's code is deterministic and cannot show tomorrow's is.
 */

/** The stages, in the order they run. Each can only refuse. */
export const ACCESS_STAGES = [
  "TARGET",
  "TENANT_CAPABILITY",
  "TARGET_WINDOW",
  "PERSON_ELIGIBILITY",
  "PROOFS",
  "SERVER_AUTHORIZATION",
] as const
export type AccessStage = (typeof ACCESS_STAGES)[number]

export interface AccessTraceStep {
  stage: AccessStage
  outcome: "pass" | "fail"
  /** Safe to show an admin: codes and target refs, never an attribute value. */
  detail: string
}

export interface TargetAccessRequest {
  target: EligibilityTarget
  subjectId: string
  tenantId: string
  /**
   * The action being attempted, as a permission key.
   *
   * Required. There is no "just tell me if they are eligible" mode: a call to
   * this module is a call about an action, and a check with no action is the
   * shape that turns into an allow nobody scoped.
   */
  permission: string
  resource?: ResourceRef
  /** The explicit evaluation clock. There is no other one. */
  now: Date
  /** Gate 1's input: capabilities this TENANT is entitled to. */
  tenantCapabilities: readonly string[]
  /** Gate 2: the compiled policy that decides this target. */
  policy: CompiledPolicy
  facts: readonly Fact[]
  unavailableSources?: readonly string[]
  /** IER-120-006. Empty means this target conditions on no proof. */
  proofRequirements?: readonly ProofRequirement[]
  proofs?: readonly ProofAssertion[]
  /** Gate 3's input. */
  world: AuthorizationWorld
  session?: AuthorizationRequest["session"]
}

export interface TargetAccessDecision {
  allowed: boolean
  /** The stage that decided. On an allow, always `SERVER_AUTHORIZATION`. */
  stage: AccessStage
  targetRef: string
  /** Null when gate 1 or the window stopped before the question was asked. */
  eligibility: EligibilityDecision | null
  /** Null when an earlier stage refused. Never null on an allow. */
  authorization: AuthorizationDecision | null
  proofChecks: readonly ProofCheck[]
  /** Stable codes, safe to show. */
  reasonCodes: readonly string[]
  trace: readonly AccessTraceStep[]
}

export function decideTargetAccess(request: TargetAccessRequest): TargetAccessDecision {
  const targetRef = formatTargetRef(request.target)
  const trace: AccessTraceStep[] = []

  const refuse = (
    stage: AccessStage,
    reasonCodes: readonly string[],
    detail: string,
    parts: {
      eligibility?: EligibilityDecision | null
      authorization?: AuthorizationDecision | null
      proofChecks?: readonly ProofCheck[]
    } = {},
  ): TargetAccessDecision => {
    trace.push({ stage, outcome: "fail", detail })
    return {
      allowed: false,
      stage,
      targetRef,
      eligibility: parts.eligibility ?? null,
      authorization: parts.authorization ?? null,
      proofChecks: parts.proofChecks ?? [],
      reasonCodes,
      trace,
    }
  }

  // Stage 0 — the target is well-formed. A request naming a target this
  // deployment cannot resolve is refused, not guessed at.
  const problems = validateTarget(request.target)
  if (problems.length > 0) {
    return refuse(
      "TARGET",
      problems.map((p) => `MALFORMED_TARGET:${p.path}`),
      `${targetRef}: ${problems.map((p) => p.message).join("; ")}`,
    )
  }
  trace.push({ stage: "TARGET", outcome: "pass", detail: targetRef })

  // Stage 1 — IER-120-002. Before eligibility, not alongside it.
  if (!request.tenantCapabilities.includes(request.target.capability)) {
    return refuse(
      "TENANT_CAPABILITY",
      ["TENANT_CAPABILITY_NOT_ENTITLED"],
      `tenant is not entitled to "${request.target.capability}"; person eligibility was not evaluated`,
    )
  }
  trace.push({
    stage: "TENANT_CAPABILITY",
    outcome: "pass",
    detail: `entitled to "${request.target.capability}"`,
  })

  // Stage 2 — IER-120-005, the target's own dates.
  const windowState = targetWindowState(request.target, request.now)
  if (windowState === "NOT_YET_ACTIVE") {
    return refuse("TARGET_WINDOW", ["TARGET_NOT_YET_ACTIVE"], `${targetRef} has not opened`)
  }
  if (windowState === "EXPIRED") {
    return refuse("TARGET_WINDOW", ["TARGET_EXPIRED"], `${targetRef} has closed`)
  }
  trace.push({ stage: "TARGET_WINDOW", outcome: "pass", detail: windowState })

  // Stage 3 — gate 2. The person's own eligibility, including their own
  // effective dates, which the engine reports as PENDING_EFFECTIVE_DATE and
  // EXPIRED rather than as a bare denial.
  const eligibility = evaluate(request.policy, {
    subjectId: request.subjectId,
    facts: request.facts,
    now: request.now,
    tenantCapabilities: request.tenantCapabilities,
    unavailableSources: request.unavailableSources,
  })
  if (!grantsAccess(eligibility)) {
    return refuse(
      "PERSON_ELIGIBILITY",
      [`INELIGIBLE_FOR_TARGET:${eligibility.outcome}`, ...eligibility.reasonCodes],
      `${targetRef}: ${eligibility.outcome}`,
      { eligibility },
    )
  }
  trace.push({ stage: "PERSON_ELIGIBILITY", outcome: "pass", detail: eligibility.outcome })

  // Stage 4 — IER-120-006. Requirements are narrowed to this target's scope
  // first, so a certificate for another site cannot satisfy one here.
  const requirements = (request.proofRequirements ?? []).map((r) =>
    requirementAtTarget(r, request.target),
  )
  const proofs = checkProofs(requirements, request.proofs ?? [], request.now)
  if (!proofs.satisfied) {
    return refuse(
      "PROOFS",
      proofs.checks.filter((c) => !c.satisfied).map((c) => c.code),
      `${targetRef}: unmet proof requirements`,
      { eligibility, proofChecks: proofs.checks },
    )
  }
  trace.push({
    stage: "PROOFS",
    outcome: "pass",
    detail: `${requirements.length} requirement(s) satisfied`,
  })

  // Stage 5 — IER-120-003. The only stage that can allow, and it always runs.
  const authorization = decide(request.world, {
    principalId: request.subjectId,
    tenantId: request.tenantId,
    permission: request.permission,
    resource: request.resource,
    at: request.now.toISOString(),
    session: request.session,
  })
  trace.push({
    stage: "SERVER_AUTHORIZATION",
    outcome: authorization.allowed ? "pass" : "fail",
    detail: `${request.permission}: ${authorization.reason}`,
  })
  return {
    allowed: authorization.allowed,
    stage: "SERVER_AUTHORIZATION",
    targetRef,
    eligibility,
    authorization,
    proofChecks: proofs.checks,
    reasonCodes: authorization.allowed ? [] : [authorization.reason],
    trace,
  }
}

/**
 * IER-120-004 — the navigation hint, derived from the same decisions.
 *
 * "UI navigation derives from current semantic entitlements and authorization
 * hints, but servers independently enforce every action and data query" (§17).
 * Both halves of that sentence are structural here rather than aspirational:
 *
 *   - it *derives*, because it takes decisions this module produced and filters
 *     them. It cannot form an opinion of its own, because it has no inputs of
 *     its own — no world, no facts, no capability list. A menu that disagrees
 *     with the server is not expressible.
 *   - it is *not enforcement*, because it returns strings. There is no path
 *     from this function's output to an allow: `decideTargetAccess` does not
 *     take a target-ref list and does not consult one, so a caller who adds a
 *     ref to a menu has changed what a person can SEE and nothing else.
 *
 * The bypass this shape is proof against is the one IER-120-008 names: a
 * client that calls the underlying route for a target its menu never showed
 * gets exactly the same answer, because the menu was never an input.
 */
export function visibleTargets(decisions: readonly TargetAccessDecision[]): string[] {
  return decisions.filter((d) => d.allowed).map((d) => d.targetRef)
}

/**
 * Why a target is absent from a menu, for the surfaces that should say.
 *
 * A hidden link and an explained absence are different products: "your safety
 * training has lapsed" is actionable and an empty menu is not. The codes are
 * the same stable codes the refusal carried, so the sentence a person is shown
 * and the reason the server recorded cannot drift apart.
 */
export function hiddenTargetReasons(
  decisions: readonly TargetAccessDecision[],
): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {}
  for (const decision of decisions) {
    if (!decision.allowed) out[decision.targetRef] = decision.reasonCodes
  }
  return out
}
