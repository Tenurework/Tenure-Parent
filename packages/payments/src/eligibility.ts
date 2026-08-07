import {
  PAYMENT_CAPABILITIES,
  capability,
  capabilityState,
  isTransactable,
  settlementCurrencies,
  type BusinessType,
  type LegalEntityType,
} from "./capability-registry"

/**
 * PAY-010-006 — can this tenant do this, and if not, what would fix it?
 *
 * The failure this replaces is not "the answer was wrong". It is the answer
 * arriving one blocker at a time. An operator configures a tenant, is told the
 * country is not supported, fixes it, is told the currency is not supported,
 * fixes that, and is then told the entity type is wrong — four round trips for
 * a question that was fully determined at the first one. REVIEW-FINDINGS §21
 * records the same shape from the module side: a collapsed refusal "produces
 * support tickets that take a week to resolve".
 *
 * So `simulateEligibility` evaluates every axis and returns every blocker.
 * Never the first, never a boolean, and never a hardcoded `true` — the matrix
 * it evaluates against is the one `capability-registry.ts` declares, so an
 * `UNSUPPORTED` leaf with an empty matrix blocks on all five axes at once and
 * says so.
 */

export type BlockerSubject = "country" | "currency" | "entity" | "businessType" | "capabilityState"

export interface Blocker {
  /** Stable machine code. Safe to switch on; safe to put in a support ticket. */
  code: string
  subject: BlockerSubject
  /** What is wrong, in the values that were asked about. */
  detail: string
  /** What would have to change. Never "contact support". */
  whatWouldUnblock: string
}

export interface EligibilityRequest {
  capabilityId: string
  /** ISO 3166-1 alpha-2. */
  country: string
  /** ISO 4217. */
  currency: string
  legalEntityType: LegalEntityType
  businessType: BusinessType
  /** When the question is asked, so an effective window is honoured. */
  at?: string
}

export interface EligibilityResult {
  eligible: boolean
  blockers: readonly Blocker[]
}

/**
 * Every reason this request cannot proceed.
 *
 * Order is fixed — state, country, currency, entity, business type — so two
 * runs of the same question produce the same list and a snapshot of it is
 * meaningful. `eligible` is derived from the list being empty rather than
 * tracked alongside it: a boolean maintained in parallel with the reasons is a
 * boolean that will one day disagree with them.
 */
export function simulateEligibility(request: EligibilityRequest): EligibilityResult {
  const cap = capability(request.capabilityId)
  const at = request.at ?? new Date().toISOString()
  const state = capabilityState(cap.id, at)
  const blockers: Blocker[] = []

  if (!isTransactable(state)) {
    blockers.push({
      code: "capability-not-transactable",
      subject: "capabilityState",
      detail: `"${cap.id}" is ${state} as of ${at}. ${cap.summary}`,
      whatWouldUnblock:
        state === "UNSUPPORTED"
          ? `Tenure has decided not to offer this. Reopening it is an ADR, not a configuration change.`
          : `Certification to TENANT_PILOT or above, recorded in an approving ADR on disk.`,
    })
  }

  const country = request.country.toUpperCase()
  if (!cap.countries.includes(country)) {
    blockers.push({
      code: "country-not-supported",
      subject: "country",
      detail: `"${cap.id}" is not declared for ${country}.`,
      whatWouldUnblock:
        cap.countries.length === 0
          ? `No country is declared for this capability at all.`
          : `Declared countries are ${cap.countries.join(", ")}. Adding one is a legal and provider review (PAY-000-005).`,
    })
  }

  const currency = request.currency.toUpperCase()
  if (!cap.currencies.includes(currency)) {
    blockers.push({
      code: "currency-not-supported",
      subject: "currency",
      detail: `"${cap.id}" cannot settle ${currency}.`,
      whatWouldUnblock:
        cap.currencies.length === 0
          ? `No settlement currency is declared for this capability at all.`
          : `Declared settlement currencies are ${cap.currencies.join(", ")}.`,
    })
  }

  if (!cap.legalEntityTypes.includes(request.legalEntityType)) {
    blockers.push({
      code: "entity-type-not-supported",
      subject: "entity",
      detail: `"${cap.id}" is not declared for a ${request.legalEntityType} legal entity.`,
      whatWouldUnblock:
        cap.legalEntityTypes.length === 0
          ? `No legal entity type is declared for this capability at all.`
          : `Declared entity types are ${cap.legalEntityTypes.join(", ")}.`,
    })
  }

  if (!cap.businessTypes.includes(request.businessType)) {
    blockers.push({
      code: "business-type-not-supported",
      subject: "businessType",
      detail: `"${cap.id}" is not declared for the ${request.businessType} business type.`,
      whatWouldUnblock:
        cap.businessTypes.length === 0
          ? `No business type is declared for this capability at all.`
          : `Declared business types are ${cap.businessTypes.join(", ")}.`,
    })
  }

  return { eligible: blockers.length === 0, blockers }
}

/**
 * The narrower question the tenant's `currency` configuration option asks.
 *
 * A currency is chosen long before a capability is: it is set on the blueprint
 * or the tenant and it reinterprets every stored amount. So the check at
 * selection time is not "is this capability eligible" but "is there any leaf
 * Tenure has not written off that could ever settle this" — and the honest
 * answer is the union across the registry, computed from the same matrix.
 *
 * Refusing here rather than at first charge is the whole point. A tenant
 * published in a currency nothing can settle looks configured for months and
 * fails on the first payment, by which time budgets are denominated in it.
 *
 * Consumed by `packages/platform-config/src/localization.ts`.
 */
export function simulateCurrencySelection(
  currency: string,
  at: string = new Date().toISOString(),
): EligibilityResult {
  const code = currency.toUpperCase()
  const supported = settlementCurrencies()
  if (supported.includes(code)) return { eligible: true, blockers: [] }

  const namedBy = PAYMENT_CAPABILITIES.filter((c) => c.currencies.includes(code)).map((c) => c.id)

  return {
    eligible: false,
    blockers: [
      {
        code: "currency-has-no-settleable-capability",
        subject: "currency",
        detail:
          namedBy.length > 0
            ? `${code} is declared only by capabilities Tenure has marked UNSUPPORTED (${namedBy.join(", ")}), as of ${at}.`
            : `No registered payments capability can settle ${code}, as of ${at}.`,
        whatWouldUnblock: `Settleable currencies today are ${supported.join(", ")}. Adding ${code} means declaring it on a capability in the payments registry, which is a legal and provider review (PAY-000-005).`,
      },
    ],
  }
}
