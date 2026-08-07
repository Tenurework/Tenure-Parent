/**
 * PAY-040-002 — the eight responsibilities, per funds flow, with no silent default.
 *
 * Bible §6 requires each of these to be an explicit decision for every funds
 * flow, and Bible §2 says why: "Tenure is not automatically merchant of record."
 * The word doing the work there is *automatically*. Every one of these axes has
 * a plausible-looking default, and every plausible-looking default is a way for
 * the platform to acquire a liability nobody decided to take.
 *
 * So `resolveResponsibility` never fills a gap. An axis nobody has answered
 * comes back with `party: null` and a named blocker, and it comes back in a
 * list of exactly eight, so a partial matrix is not a value this module can
 * produce. A caller cannot forget an axis; it can only be handed one it has to
 * deal with.
 *
 * Pure. No provider call, no money movement, no I/O. Its production caller is
 * `chooseFundsFlow` in `funds-flow.ts` (PAY-070-002), which is what makes this
 * a live rule rather than a declared type.
 */

export const RESPONSIBILITY_AXES = [
  "merchantDisplay",
  "feePayer",
  "lossPayer",
  "refundPayer",
  "disputeOwner",
  "kycUpdateOwner",
  "accountCollectionOwner",
  "supportOwner",
] as const

export type ResponsibilityAxis = (typeof RESPONSIBILITY_AXES)[number]

export const RESPONSIBILITY_PARTIES = ["TENURE", "TENANT", "PROVIDER", "CUSTOMER"] as const

export type ResponsibilityParty = (typeof RESPONSIBILITY_PARTIES)[number]

export const FUNDS_FLOWS = ["direct", "destination", "separate_charges_and_transfers"] as const

export type FundsFlow = (typeof FUNDS_FLOWS)[number]

/**
 * Two layers, and the difference between them is who is accountable.
 *
 * `defaults` are the platform's approved answers for this merchant's
 * configuration — what onboarding and legal recorded. `overrides` are what this
 * tenant asked to change. Both are partial and both may be absent, which is why
 * an empty config produces eight blockers rather than eight guesses.
 */
export interface ResponsibilityConfig {
  defaults?: Partial<Record<ResponsibilityAxis, ResponsibilityParty>>
  overrides?: Partial<Record<ResponsibilityAxis, ResponsibilityParty>>
}

export interface ResponsibilityResolution {
  axis: ResponsibilityAxis
  /** Null exactly when `blockers` is non-empty. There is no third state. */
  party: ResponsibilityParty | null
  source: "default" | "tenant-override"
  /** Empty when the axis is answered and the answer is legal for this flow. */
  blockers: string[]
}

/**
 * Parties that may never hold an axis, whatever the flow.
 *
 * These are not preferences. Bible §2 lists what Tenure is not, and each entry
 * here is one of those turned into a refusal:
 *
 *   * `kycUpdateOwner: TENURE` — Tenure is not the KYC/KYB decision owner.
 *   * `lossPayer: CUSTOMER` — a customer does not carry the platform's losses.
 *   * `merchantDisplay: CUSTOMER` — the payer is not the seller.
 *   * `supportOwner: CUSTOMER` / `accountCollectionOwner: CUSTOMER` — likewise.
 */
const FORBIDDEN_PARTIES: Readonly<Record<ResponsibilityAxis, readonly ResponsibilityParty[]>> = {
  merchantDisplay: ["CUSTOMER", "PROVIDER"],
  feePayer: [],
  lossPayer: ["CUSTOMER"],
  refundPayer: ["CUSTOMER"],
  disputeOwner: ["CUSTOMER"],
  kycUpdateOwner: ["TENURE", "CUSTOMER"],
  accountCollectionOwner: ["CUSTOMER"],
  supportOwner: ["CUSTOMER"],
}

/**
 * Axes a direct charge cannot place on Tenure.
 *
 * A direct charge is the flow in which the tenant's connected account IS the
 * merchant: the charge lands there, the provider takes its fee there, a dispute
 * is debited there. Recording that Tenure carries the loss on a direct charge
 * is not a policy Tenure could honour — it describes an arrangement the provider
 * is not implementing. Bible §6: "Prefer direct-charge configurations when the
 * tenant seller should be merchant and Stripe/connected account should carry
 * fees and negative-balance responsibility."
 */
const DIRECT_CHARGE_NOT_TENURE: readonly ResponsibilityAxis[] = [
  "merchantDisplay",
  "lossPayer",
  "refundPayer",
  "disputeOwner",
  "accountCollectionOwner",
]

/**
 * Resolve all eight axes for one funds flow.
 *
 * Always returns eight entries, in `RESPONSIBILITY_AXES` order, whatever the
 * config says. An unset axis is a blocker, never a default — see the header.
 */
export function resolveResponsibility(
  fundsFlow: FundsFlow,
  config: ResponsibilityConfig,
): readonly ResponsibilityResolution[] {
  return RESPONSIBILITY_AXES.map((axis) => {
    const override = config.overrides?.[axis]
    const fallback = config.defaults?.[axis]
    const party = override ?? fallback ?? null
    const source: "default" | "tenant-override" = override ? "tenant-override" : "default"
    const blockers: string[] = []

    if (party === null) {
      blockers.push(
        `${axis} is unanswered for the ${fundsFlow} flow. Bible §6 requires an explicit decision; ` +
          `a default here is how Tenure becomes merchant of record without anyone deciding it.`,
      )
      return { axis, party: null, source, blockers }
    }

    if (FORBIDDEN_PARTIES[axis].includes(party)) {
      blockers.push(
        `${axis} cannot be ${party}: Bible §2 lists what Tenure and the payer are not, and this ` +
          `assignment contradicts it.`,
      )
    }

    if (fundsFlow === "direct" && party === "TENURE" && DIRECT_CHARGE_NOT_TENURE.includes(axis)) {
      blockers.push(
        `${axis} cannot be TENURE on a direct charge: the charge lands on the tenant's connected ` +
          `account, so the provider debits that account and no Tenure policy changes where the ` +
          `money comes from.`,
      )
    }

    return { axis, party, source, blockers: blockers.length > 0 ? blockers : [] }
  })
}

/** The axes that came back unanswered or illegal. The list a refusal names. */
export function failingAxes(
  resolutions: readonly ResponsibilityResolution[],
): readonly ResponsibilityAxis[] {
  return resolutions.filter((r) => r.blockers.length > 0).map((r) => r.axis)
}

/** Who carries a loss, once resolved. Null when the axis is blocked. */
export function partyFor(
  resolutions: readonly ResponsibilityResolution[],
  axis: ResponsibilityAxis,
): ResponsibilityParty | null {
  const found = resolutions.find((r) => r.axis === axis)
  if (!found || found.blockers.length > 0) return null
  return found.party
}
