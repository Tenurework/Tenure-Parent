import { capability } from "./capability-registry"
import type { BusinessType, LegalEntityType } from "./capability-registry"
import { chooseFundsFlow, type FundsFlowChoice, type FundsFlowConfig } from "./funds-flow"
import { partyFor, type FundsFlow, type ResponsibilityParty } from "./responsibility"

/**
 * PAY-040-003 — which charge model, decided from the facts, with the reasons kept.
 *
 * Bible §6: "Choose the Stripe account configuration from current
 * controller/responsibility capabilities, not an obsolete blanket assumption."
 * The assumption this replaces is the one every integration starts with —
 * DIRECT unless something obviously says otherwise — which is wrong in the
 * expensive direction, because the flows that are NOT direct are the ones that
 * can put fees, refunds, chargebacks and negative balances on the platform.
 *
 * Six inputs, all of them load-bearing: the use case, the seller legal entity,
 * the parties, the acquiring region, the connected-account configuration and
 * who bears loss. Every unsupported combination returns a NAMED blocker, and a
 * decision with no supporting configuration is refused rather than defaulted —
 * `model` comes back null with the reasons, the same explainability discipline
 * `packages/authorization/src/decide.ts` holds for permissions.
 *
 * Its consumer is `liability.ts` (PAY-070-003), which turns a decision that
 * shifts liability onto Tenure into an exception approval request.
 */

export const CHARGE_MODELS = ["DIRECT", "DESTINATION", "SEPARATE_CHARGE_AND_TRANSFER"] as const

export type ChargeModel = (typeof CHARGE_MODELS)[number]

const MODEL_FOR_FLOW: Readonly<Record<FundsFlow, ChargeModel>> = {
  direct: "DIRECT",
  destination: "DESTINATION",
  separate_charges_and_transfers: "SEPARATE_CHARGE_AND_TRANSFER",
}

export type PaymentUseCase =
  /** A tenant legal entity sells to an outside customer. */
  | "TENANT_CUSTOMER_SALE"
  /** Members pay the organization they belong to. */
  | "MEMBER_DUES"
  /** The tenant pays a vendor or contractor. */
  | "VENDOR_DISBURSEMENT"
  /** Money moves between dimensions under one legal owner. */
  | "INTERNAL_ALLOCATION"
  /** One charge is split across several recipients. */
  | "MARKETPLACE_SPLIT"

export interface SellerParty {
  legalEntityId: string
  /** ISO 3166-1 alpha-2 of the legal entity's registration. */
  country: string
  legalEntityType: LegalEntityType
  businessType: BusinessType
}

export interface BuyerParty {
  /** ISO 3166-1 alpha-2 the payer transacts from. */
  country: string
  kind: "INDIVIDUAL" | "ORGANIZATION"
}

export interface ConnectedAccountConfiguration {
  /** Null when no connected account exists for the seller yet. */
  accountId: string | null
  chargesEnabled: boolean
  payoutsEnabled: boolean
  /** Recorded responsibility answers, per funds flow. */
  responsibility: FundsFlowConfig
}

export interface ChargeModelAmounts {
  grossCents: number
  /** Bible §0.6: disabled by default. Non-zero is itself a blocker. */
  platformFeeCents: number
}

export interface ChargeModelInput {
  useCase: PaymentUseCase
  capabilityId: string
  seller: SellerParty
  buyer: BuyerParty
  /**
   * The acquiring region the charge is presented in — where the merchant of
   * record is treated as established for this payment.
   *
   * Not derivable from the seller: a UK legal entity may present a charge in
   * an EU acquiring region, and that is exactly the case with different
   * licensing, scheme fees and dispute rules. Passing it explicitly is what
   * lets this refuse the combinations the capability was never certified for.
   */
  region: string
  currency: string
  connectedAccount: ConnectedAccountConfiguration
  /**
   * Who the configuration says bears loss. Null means nobody has said, which is
   * a blocker rather than a reason to pick.
   */
  lossBearer: ResponsibilityParty | null
  amounts: ChargeModelAmounts
}

export interface ChargeModelDecision {
  /** Null when the inputs do not support any model. Never defaulted to DIRECT. */
  model: ChargeModel | null
  liableParty: ResponsibilityParty | null
  /** Why this model, in the inputs that decided it. Never a bare enum. */
  reasons: string[]
  blockers: string[]
  /** Echoed so a downstream approval can pin exactly what it approved. */
  capabilityId: string
  region: string
  sellerLegalEntityId: string
  useCase: PaymentUseCase
  amounts: ChargeModelAmounts
  fundsFlow: FundsFlowChoice
}

/**
 * Regions where a capability is certified, derived from its declared countries.
 *
 * There is deliberately no second region table. A region that is not one of the
 * capability's declared countries is not certified, and inventing a broader
 * region vocabulary would let a charge be presented somewhere the capability's
 * own matrix does not cover.
 */
function regionBlockers(input: ChargeModelInput): string[] {
  const cap = capability(input.capabilityId)
  const region = input.region.toUpperCase()
  const out: string[] = []

  if (region.length !== 2) {
    out.push(
      `region-not-a-country: "${input.region}" is not an ISO 3166-1 alpha-2 code. The acquiring ` +
        `region decides scheme fees and dispute rules; it cannot be guessed.`,
    )
    return out
  }

  if (!cap.countries.map((c) => c.toUpperCase()).includes(region)) {
    out.push(
      `region-not-certified: "${input.capabilityId}" is not certified to acquire in ${region}` +
        (cap.countries.length > 0 ? ` (certified: ${cap.countries.join(", ")}).` : ` (no region is certified for it).`),
    )
  }

  if (region !== input.seller.country.toUpperCase()) {
    out.push(
      `region-cross-border-acquiring: the seller is established in ` +
        `${input.seller.country.toUpperCase()} and the charge is presented in ${region}. ` +
        `Cross-border acquiring changes the merchant of record and needs its own legal and ` +
        `provider review (PAY-000-005).`,
    )
  }

  return out
}

/** The decision. Pure — no provider call, no persistence, no money movement. */
export function decideChargeModel(input: ChargeModelInput): ChargeModelDecision {
  const reasons: string[] = []
  const blockers: string[] = [...regionBlockers(input)]

  if (input.useCase === "INTERNAL_ALLOCATION") {
    blockers.push(
      `internal-allocation-is-not-a-charge: no external legal or bank-account boundary is ` +
        `crossed, so no provider charge model applies (Bible §0.10). Post it to the internal ` +
        `subledger instead.`,
    )
  }

  if (input.amounts.grossCents <= 0) {
    blockers.push(
      `amount-not-positive: grossCents is ${input.amounts.grossCents}. A charge model is a ` +
        `decision about money that moves.`,
    )
  }

  if (input.amounts.platformFeeCents !== 0) {
    blockers.push(
      `platform-fee-not-enabled: a Tenure application fee of ${input.amounts.platformFeeCents} ` +
        `minor units is configured, and platform fees are disabled by default (Bible §0.6). ` +
        `Enabling one needs the contract, pricing, tax treatment, provider configuration and ` +
        `legal review to allow it.`,
    )
  }

  if (input.connectedAccount.accountId === null) {
    blockers.push(
      `no-connected-account: the seller ${input.seller.legalEntityId} has no connected account, ` +
        `so there is no account for any flow to route to.`,
    )
  } else if (!input.connectedAccount.chargesEnabled) {
    blockers.push(
      `charges-not-enabled: connected account ${input.connectedAccount.accountId} cannot accept ` +
        `charges. Outstanding onboarding requirements are the usual cause (PAY-050-001).`,
    )
  }

  if (input.lossBearer === null) {
    blockers.push(
      `loss-bearer-unanswered: nobody has recorded who carries a loss on this flow. Bible §6 ` +
        `requires the decision; defaulting it is how the platform acquires liability silently.`,
    )
  }

  const fundsFlow = chooseFundsFlow(
    {
      id: input.seller.legalEntityId,
      capabilityId: input.capabilityId,
      country: input.seller.country,
      currency: input.currency,
      legalEntityType: input.seller.legalEntityType,
      businessType: input.seller.businessType,
    },
    input.connectedAccount.responsibility,
  )

  if (fundsFlow.flow === null) {
    blockers.push(`funds-flow-unavailable: ${fundsFlow.reason}`)
  } else {
    reasons.push(fundsFlow.reason)
  }

  reasons.push(
    `Use case ${input.useCase}: seller ${input.seller.legalEntityId} (${input.seller.legalEntityType}, ` +
      `${input.seller.businessType}, ${input.seller.country.toUpperCase()}) selling to a ` +
      `${input.buyer.kind} in ${input.buyer.country.toUpperCase()}, acquired in ` +
      `${input.region.toUpperCase()}, settling ${input.currency.toUpperCase()}.`,
  )

  const resolvedLoss =
    fundsFlow.flow === null ? null : partyFor(fundsFlow.responsibility, "lossPayer")

  if (input.lossBearer !== null && resolvedLoss !== null && input.lossBearer !== resolvedLoss) {
    blockers.push(
      `loss-bearer-contradicts-configuration: the request says ${input.lossBearer} carries loss ` +
        `and the ${fundsFlow.flow} responsibility matrix resolves lossPayer to ${resolvedLoss}. ` +
        `Two answers to one question is not a decision.`,
    )
  }

  if (blockers.length > 0) {
    return {
      model: null,
      liableParty: null,
      reasons,
      blockers,
      capabilityId: input.capabilityId,
      region: input.region.toUpperCase(),
      sellerLegalEntityId: input.seller.legalEntityId,
      useCase: input.useCase,
      amounts: input.amounts,
      fundsFlow,
    }
  }

  // `fundsFlow.flow` is non-null here: a null flow pushed a blocker above and
  // this branch is only reached with none.
  const flow = fundsFlow.flow as FundsFlow
  const model = MODEL_FOR_FLOW[flow]
  reasons.push(
    `Charge model ${model}, from funds flow ${flow}. Loss is carried by ${resolvedLoss}.`,
  )

  return {
    model,
    liableParty: resolvedLoss,
    reasons,
    blockers: [],
    capabilityId: input.capabilityId,
    region: input.region.toUpperCase(),
    sellerLegalEntityId: input.seller.legalEntityId,
    useCase: input.useCase,
    amounts: input.amounts,
    fundsFlow,
  }
}
