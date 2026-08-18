import type { CapabilityState } from "./capability-registry"

/**
 * PAY-010-002 — four different facts, four gates, and all four must pass.
 *
 * Bible §3 is explicit that a payments capability is not a boolean, and the
 * reason is that "can this tenant do this" is the conjunction of four questions
 * that are answered by four different parties, on four different clocks:
 *
 *   1. **Provider capability.** What the PROVIDER ACCOUNT reports. Not what the
 *      provider's documentation says — that is the failure Bible §2's last line
 *      names ("never infer availability from a Stripe marketing page"), and it
 *      is the reason this gate refuses to be answered from a constant. The
 *      input is an OBSERVATION of an account, carrying the account it was read
 *      from and when.
 *   2. **Tenure certification.** Whether Tenure has certified the leaf to a
 *      money-facing state, which `capability-registry.ts` decides and which
 *      needs an approving ADR on disk.
 *   3. **Tenant entitlement.** Whether this tenant's system actually runs a
 *      module the leaf serves. A platform-wide certification is not a grant to
 *      every tenant.
 *   4. **Merchant activation.** Whether the connected account this tenant would
 *      transact on can accept charges and move the resulting balance, with no
 *      outstanding provider requirements.
 *
 * Before this module those four were partly conflated and partly absent.
 * `simulateEligibility` folded certification into the country/currency matrix,
 * `decideChargeModel` mixed the merchant-activation facts into one flat blocker
 * list, and neither the provider observation nor the tenant entitlement was
 * asked for at all. A single list of blockers cannot answer "which of the four
 * is missing", which is the question an operator has and the question the
 * requirement names.
 *
 * ## UNDETERMINED is not FAIL, and neither of them is PASS
 *
 * The verdict vocabulary has three words on purpose. "We looked and the answer
 * is no" and "we could not look" are different answers, and collapsing them is
 * the failure this codebase finds most often: a gate that reports FAIL for an
 * unread provider account teaches an operator to treat the refusal as a
 * configuration problem, and a gate that reports PASS for one is the marketing
 * page again. `UNDETERMINED` never allows — `allow` is `every verdict is PASS`
 * — but it says which of the two it is.
 *
 * ## Every gate is evaluated
 *
 * There is no short-circuit. Four verdicts always come back, in
 * `CAPABILITY_GATES` order, so an operator who fixes the first blocker is not
 * then handed the second — the same discipline `simulateEligibility` holds for
 * its five axes.
 *
 * Pure. Takes the facts rather than fetching them, so the module that owns each
 * fact stays the module that reads it, and so this file imports nothing at
 * runtime — `capability-registry.ts` imports THIS, and a runtime import back
 * would be a cycle.
 */

export const CAPABILITY_GATES = [
  "provider-capability",
  "tenure-certification",
  "tenant-entitlement",
  "merchant-activation",
] as const

export type CapabilityGate = (typeof CAPABILITY_GATES)[number]

/**
 * `PASS` — the gate was evaluated and it is satisfied.
 * `FAIL` — the gate was evaluated and it is not.
 * `UNDETERMINED` — the fact this gate needs has not been read.
 */
export type GateVerdict = "PASS" | "FAIL" | "UNDETERMINED"

export interface GateResult {
  gate: CapabilityGate
  verdict: GateVerdict
  /** Stable machine code. Safe to switch on; safe to put in a support ticket. */
  code: string
  /** Why, in the values that decided it. Never a bare enum. */
  reason: string
}

/**
 * What one provider ACCOUNT reports about one leaf, and when it was read.
 *
 * The account id and the timestamp are required rather than optional because an
 * observation without them cannot be attributed or aged, and an unattributable
 * observation is indistinguishable from an assumption.
 */
export interface ProviderCapabilityObservation {
  /** The provider account the observation was read from. */
  accountId: string
  /**
   * What the provider reports. `unrequested` is distinct from `inactive`: one
   * has never been asked for, the other was asked for and refused, and the work
   * that clears them is different.
   */
  status: "active" | "inactive" | "pending" | "unrequested"
  /** ISO timestamp the account was read. */
  observedAt: string
}

/** The merchant connected account this tenant would transact on. */
export interface MerchantActivation {
  accountId: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  /** Provider requirement ids still outstanding on the account. */
  requirementsCurrentlyDue: readonly string[]
}

export interface CapabilityGateFacts {
  capabilityId: string
  /**
   * The certification answer, already resolved by the registry.
   *
   * Passed in rather than re-derived: `capability-registry.ts` owns the states,
   * the effective window and the ADR check, and a second reading of them here
   * would be a second answer to the same question.
   */
  certification: {
    state: CapabilityState
    /** Whether that state is one that puts money in front of a tenant. */
    transactable: boolean
  }
  /** The modules this leaf serves, from its own definition. */
  servesModules: readonly string[]
  /** `null` when no provider account has been read for this leaf. */
  providerCapability: ProviderCapabilityObservation | null
  /**
   * The modules this tenant's system runs.
   *
   * `null` and `[]` mean different things and are treated differently: `null`
   * is "the tenant's module set could not be read" (UNDETERMINED), `[]` is
   * "read, and it runs nothing" (FAIL).
   */
  entitledModules: readonly string[] | null
  /** `null` when no connected account exists for this tenant yet. */
  merchantActivation: MerchantActivation | null
}

export interface CapabilityGateDecision {
  capabilityId: string
  /** All four, always, in `CAPABILITY_GATES` order. */
  gates: readonly GateResult[]
  /** True only when every one of the four is `PASS`. */
  allow: boolean
  /** `gate — reason` for every gate that is not `PASS`. */
  blockers: readonly string[]
}

function providerGate(facts: CapabilityGateFacts): GateResult {
  const gate: CapabilityGate = "provider-capability"
  const observation = facts.providerCapability

  if (observation === null) {
    return {
      gate,
      verdict: "UNDETERMINED",
      code: "provider-capability-unobserved",
      reason:
        `No provider account has been read for "${facts.capabilityId}", so what the provider ` +
        `supports on the account this tenant would transact on is unknown. A provider's ` +
        `documentation is not an observation of an account (Bible §2), and an unread account ` +
        `is not an account that said no.`,
    }
  }

  if (observation.status === "active") {
    return {
      gate,
      verdict: "PASS",
      code: "provider-capability-active",
      reason:
        `Provider account ${observation.accountId} reported "${facts.capabilityId}" active when ` +
        `it was read at ${observation.observedAt}.`,
    }
  }

  return {
    gate,
    verdict: "FAIL",
    code: `provider-capability-${observation.status}`,
    reason:
      `Provider account ${observation.accountId} reported "${facts.capabilityId}" as ` +
      `${observation.status} when it was read at ${observation.observedAt}.` +
      (observation.status === "unrequested"
        ? ` It has never been requested on that account.`
        : observation.status === "pending"
          ? ` The provider has not finished deciding.`
          : ` The provider declined it on that account.`),
  }
}

function certificationGate(facts: CapabilityGateFacts): GateResult {
  const gate: CapabilityGate = "tenure-certification"
  const { state, transactable } = facts.certification

  if (transactable) {
    return {
      gate,
      verdict: "PASS",
      code: "tenure-certified",
      reason: `Tenure has certified "${facts.capabilityId}" to ${state}.`,
    }
  }

  return {
    gate,
    verdict: "FAIL",
    code: "tenure-not-certified",
    reason:
      `"${facts.capabilityId}" is ${state}, which is not a state that puts money ` +
      `in front of a tenant. Certification to TENANT_PILOT or above needs an approving ADR on ` +
      `disk; a provider supporting something is not Tenure having approved it.`,
  }
}

function entitlementGate(facts: CapabilityGateFacts): GateResult {
  const gate: CapabilityGate = "tenant-entitlement"
  const entitled = facts.entitledModules

  if (entitled === null) {
    return {
      gate,
      verdict: "UNDETERMINED",
      code: "tenant-entitlement-unreadable",
      reason:
        `The modules this tenant runs were not supplied, so whether it is entitled to ` +
        `"${facts.capabilityId}" is unknown. An unread entitlement is not a granted one.`,
    }
  }

  if (facts.servesModules.length === 0) {
    return {
      gate,
      verdict: "FAIL",
      code: "capability-serves-no-module",
      reason:
        `"${facts.capabilityId}" serves no product module, so no tenant can be entitled to it ` +
        `through one. A leaf Tenure has written off declares no modules, and that is what this ` +
        `reads.`,
    }
  }

  const matched = facts.servesModules.filter((m) => entitled.includes(m))
  if (matched.length === 0) {
    return {
      gate,
      verdict: "FAIL",
      code: "tenant-not-entitled",
      reason:
        `"${facts.capabilityId}" serves ${facts.servesModules.join(", ")}, and this tenant runs ` +
        (entitled.length === 0 ? `no modules at all.` : `${entitled.join(", ")}.`) +
        ` A platform-wide certification is not a grant to every tenant.`,
    }
  }

  return {
    gate,
    verdict: "PASS",
    code: "tenant-entitled",
    reason: `This tenant runs ${matched.join(", ")}, which "${facts.capabilityId}" serves.`,
  }
}

function activationGate(facts: CapabilityGateFacts): GateResult {
  const gate: CapabilityGate = "merchant-activation"
  const merchant = facts.merchantActivation

  if (merchant === null) {
    return {
      gate,
      verdict: "FAIL",
      code: "merchant-account-absent",
      reason:
        `No connected account exists for this tenant, so there is no merchant for ` +
        `"${facts.capabilityId}" to activate on. This is a fact that was read, not one that was ` +
        `missing: the absence of an account is itself the answer.`,
    }
  }

  if (!merchant.chargesEnabled) {
    return {
      gate,
      verdict: "FAIL",
      code: "merchant-charges-disabled",
      reason:
        `Connected account ${merchant.accountId} cannot accept charges. Outstanding onboarding ` +
        `requirements are the usual cause (PAY-050-001).`,
    }
  }

  if (!merchant.payoutsEnabled) {
    return {
      gate,
      verdict: "FAIL",
      code: "merchant-payouts-disabled",
      reason:
        `Connected account ${merchant.accountId} can accept charges but cannot pay out. ` +
        `Accepting money onto an account that cannot move it accumulates a balance the tenant ` +
        `cannot reach, which is worse than refusing the charge.`,
    }
  }

  if (merchant.requirementsCurrentlyDue.length > 0) {
    return {
      gate,
      verdict: "FAIL",
      code: "merchant-requirements-outstanding",
      reason:
        `Connected account ${merchant.accountId} has ${merchant.requirementsCurrentlyDue.length} ` +
        `outstanding provider requirement(s): ${merchant.requirementsCurrentlyDue.join(", ")}. ` +
        `A requirement that is currently due becomes a restriction on a deadline.`,
    }
  }

  return {
    gate,
    verdict: "PASS",
    code: "merchant-activated",
    reason:
      `Connected account ${merchant.accountId} accepts charges, pays out, and has no ` +
      `outstanding provider requirements.`,
  }
}

/**
 * The four gates, evaluated independently, and the conjunction of them.
 *
 * `allow` is derived from the four verdicts rather than tracked alongside them,
 * for the same reason `simulateEligibility` derives `eligible` from its blocker
 * list: a boolean maintained in parallel with the reasons is a boolean that
 * will one day disagree with them.
 */
export function evaluateCapabilityGates(facts: CapabilityGateFacts): CapabilityGateDecision {
  const gates: readonly GateResult[] = [
    providerGate(facts),
    certificationGate(facts),
    entitlementGate(facts),
    activationGate(facts),
  ]

  return {
    capabilityId: facts.capabilityId,
    gates,
    allow: gates.every((g) => g.verdict === "PASS"),
    blockers: gates
      .filter((g) => g.verdict !== "PASS")
      .map((g) => `${g.gate} ${g.verdict}: ${g.code} — ${g.reason}`),
  }
}
