import { simulateEligibility, type Blocker } from "./eligibility"
import {
  FUNDS_FLOWS,
  failingAxes,
  resolveResponsibility,
  type FundsFlow,
  type ResponsibilityConfig,
  type ResponsibilityResolution,
} from "./responsibility"
import type { BusinessType, LegalEntityType } from "./capability-registry"

export { FUNDS_FLOWS, type FundsFlow }

/**
 * PAY-070-002 — direct charges are the default, and only where they are earned.
 *
 * Bible §0.1 and §6 make direct the preferred flow: the tenant legal entity
 * sells, so the tenant connected account should be the merchant and should
 * carry fees, disputes and negative balances. The two ways to get this wrong
 * are opposite and both common — refuse direct to an eligible merchant (which
 * pushes everyone onto destination charges and quietly moves liability to the
 * platform), or grant it to a merchant whose responsibility matrix has holes in
 * it (which moves liability to the platform *and* hides that it happened).
 *
 * So this calls `resolveResponsibility` FIRST, for every flow, and returns
 * `direct` only when all eight axes resolve with zero blockers and the merchant
 * is eligible for the capability. Every refused flow comes back with the axes
 * that failed it, because "you cannot use destination charges" without the
 * reason is a support ticket rather than an answer.
 *
 * Pure decision. No provider call, no money movement — Bible §0.9: one click
 * may initiate an approved state machine, never bypass one.
 */

export interface MerchantProfile {
  id: string
  /** The registry leaf this charge would run on. */
  capabilityId: string
  country: string
  currency: string
  legalEntityType: LegalEntityType
  businessType: BusinessType
}

/** The responsibility configuration recorded for each flow this merchant may use. */
export type FundsFlowConfig = Partial<Record<FundsFlow, ResponsibilityConfig>>

export interface RefusedFlow {
  flow: FundsFlow
  blockers: readonly string[]
}

export interface FundsFlowChoice {
  /** Null when no flow's blockers are satisfiable — which is a real answer. */
  flow: FundsFlow | null
  reason: string
  refusedFlows: readonly RefusedFlow[]
  /** The eligibility blockers, so the caller need not re-simulate to explain. */
  eligibility: readonly Blocker[]
  /** All eight axes for the chosen flow, or for `direct` when nothing was chosen. */
  responsibility: readonly ResponsibilityResolution[]
}

function blockersFor(
  flow: FundsFlow,
  config: FundsFlowConfig,
): { resolutions: readonly ResponsibilityResolution[]; blockers: readonly string[] } {
  const resolutions = resolveResponsibility(flow, config[flow] ?? {})
  const axes = failingAxes(resolutions)
  if (axes.length === 0) return { resolutions, blockers: [] }
  return {
    resolutions,
    blockers: [
      `${flow}: ${axes.length} of 8 responsibility axes unresolved — ${axes.join(", ")}.`,
      ...resolutions.flatMap((r) => r.blockers),
    ],
  }
}

/**
 * Which funds flow this merchant gets, and why every other one was refused.
 *
 * The order is `FUNDS_FLOWS` order — direct, destination, separate — which is
 * ascending platform liability. The first flow whose responsibility matrix is
 * complete wins, so a merchant that qualifies for direct is never handed a
 * flow that shifts loss to Tenure merely because that one also happened to be
 * configured.
 */
export function chooseFundsFlow(
  merchant: MerchantProfile,
  config: FundsFlowConfig,
): FundsFlowChoice {
  const eligibility = simulateEligibility({
    capabilityId: merchant.capabilityId,
    country: merchant.country,
    currency: merchant.currency,
    legalEntityType: merchant.legalEntityType,
    businessType: merchant.businessType,
  })

  const perFlow = FUNDS_FLOWS.map((flow) => ({ flow, ...blockersFor(flow, config) }))
  const directResolutions =
    perFlow.find((f) => f.flow === "direct")?.resolutions ?? resolveResponsibility("direct", {})

  if (!eligibility.eligible) {
    return {
      flow: null,
      reason:
        `${merchant.id} is not eligible for "${merchant.capabilityId}": ` +
        eligibility.blockers.map((b) => b.code).join(", ") +
        `. No funds flow is available until eligibility is satisfied — the flow decides who ` +
        `carries the money, not whether there may be any.`,
      refusedFlows: perFlow.map(({ flow, blockers }) => ({
        flow,
        blockers: [
          `${flow}: refused because the merchant is not eligible for the capability.`,
          ...blockers,
        ],
      })),
      eligibility: eligibility.blockers,
      responsibility: directResolutions,
    }
  }

  const chosen = perFlow.find((f) => f.blockers.length === 0)

  if (!chosen) {
    return {
      flow: null,
      reason:
        `No funds flow has a complete responsibility matrix for ${merchant.id}. Every flow is ` +
        `refused below with the axes that failed it; answering those axes is what makes one ` +
        `available.`,
      refusedFlows: perFlow.map(({ flow, blockers }) => ({ flow, blockers })),
      eligibility: [],
      responsibility: directResolutions,
    }
  }

  return {
    flow: chosen.flow,
    reason:
      chosen.flow === "direct"
        ? `${merchant.id} is eligible for "${merchant.capabilityId}" and all 8 responsibility axes ` +
          `resolve for a direct charge, which is the approved default (Bible §0.1).`
        : `Direct charges are refused for ${merchant.id}, so the lowest-liability flow with a ` +
          `complete responsibility matrix is ${chosen.flow}. It shifts liability away from the ` +
          `tenant merchant and needs an exception approval (PAY-070-003).`,
    refusedFlows: perFlow
      .filter((f) => f.flow !== chosen.flow)
      .map(({ flow, blockers }) => ({ flow, blockers })),
    eligibility: [],
    responsibility: chosen.resolutions,
  }
}
