import fs from "node:fs"
import path from "node:path"

import { PROVIDER_API_VERSION, normalizeProviderApiVersion } from "./api-version"
import {
  evaluateCapabilityGates,
  type CapabilityGateDecision,
  type GateResult,
} from "./capability-gates"

/**
 * PAY-000-008 / PAY-010-004 — what Tenure has actually approved, as data.
 *
 * The failure this exists to make impossible is the cheap one: reading a
 * provider's marketing page, seeing that the provider supports a thing, and
 * recording that Tenure supports it. Provider capability, Tenure certification,
 * tenant entitlement and merchant activation are four different facts (Bible
 * §3, PAY-010-002) and only the first of them is on the provider's website.
 *
 * So every leaf named by Bible §3 is registered here, and every one of them is
 * `PLANNED` or `UNSUPPORTED`, because none of them has an approval ADR. That is
 * not pessimism; it is the truthful reading. `assertRegistry` refuses any entry
 * claiming a state that implies live money — `TENANT_PILOT`, `GA_LIMITED`, `GA`
 * — unless it names an ADR **that exists on disk**, so promoting one is a
 * deliberate act with a document behind it rather than an edit to a string.
 *
 * The support matrix on each leaf (countries, currencies, entity types,
 * business types) is what `eligibility.ts` simulates against. It is declared
 * here and nowhere else so there is one answer to "can this tenant do this",
 * which is the property Bible §3 asks for when it says the availability truth
 * must be the same in System Studio, tenant UI, APIs and documentation.
 *
 * This module reads the filesystem. `gateway.ts` — the client-safe subpath —
 * deliberately does not import it.
 */

export const CAPABILITY_STATES = [
  "DISCOVERED",
  "ARCHITECTED",
  "PLANNED",
  "BUILDING",
  "INTERNAL_PREVIEW",
  "TENANT_PILOT",
  "GA_LIMITED",
  "GA",
  "DEPRECATED",
  "UNSUPPORTED",
] as const

export type CapabilityState = (typeof CAPABILITY_STATES)[number]

/**
 * The states that put real money in front of a real tenant.
 *
 * Everything below `TENANT_PILOT` is internal work: a plan, a design, a build,
 * an internal preview. Those need no legal approval because nobody outside
 * Tenure can reach them. These three do, and that is the whole line this file
 * draws.
 */
export const STATES_REQUIRING_APPROVAL: readonly CapabilityState[] = [
  "TENANT_PILOT",
  "GA_LIMITED",
  "GA",
]

export type LegalEntityType =
  | "COMPANY"
  | "NON_PROFIT"
  | "GOVERNMENT_ENTITY"
  | "PARTNERSHIP"
  | "INDIVIDUAL"

export type BusinessType =
  | "EDUCATION"
  | "NON_PROFIT"
  | "PUBLIC_SECTOR"
  | "PROFESSIONAL_SERVICES"
  | "RETAIL"

/** The approval that promoted a capability, as a repo-relative ADR path. */
export interface CapabilityApproval {
  adr: string
}

/**
 * PAY-010-003 — the provider API version a leaf's certification was reviewed
 * under, and how far that review extends.
 *
 * The effective window above says WHEN a capability is declared. This says
 * AGAINST WHAT. They are different facts and both of them can invalidate a
 * certification on their own: a leaf whose window is open is still uncertified
 * if the build is now speaking an API version nobody reviewed it against.
 *
 * `compatibleThrough: null` means the review covers `reviewedUnder` and nothing
 * else — deliberately, and it is the default. The alternative reading, "null is
 * open-ended", would make this field decorative: every future version would be
 * inside every window and the check could never fire. Bible §16 calls an API
 * upgrade intentional, so the truthful default is that a version nobody has
 * reviewed the leaf under is a version the leaf is not certified for. Moving
 * `PROVIDER_API_VERSION` therefore takes every leaf out of its window and back
 * to `UNSUPPORTED` until somebody widens the review, which is the review task
 * `version-watch.ts` raises (PAY-010-007) rather than a silent carry-forward.
 *
 * Versions are provider date versions (`YYYY-MM-DD`). They are compared as
 * strings, which is exact rather than convenient: zero-padded fixed-width ISO
 * dates order lexicographically in date order, so no comparator is needed and
 * none is introduced — `platform-config`'s is the only one in the repository
 * and this package must not import that one back (see `api-version.ts`).
 * `normalizeProviderApiVersion` is still used, for its refusal: it is what
 * makes "not a provider version" an error instead of a string that sorts.
 */
export interface ProviderApiCompatibility {
  /** The exact provider API version the leaf's certification was reviewed under. */
  reviewedUnder: string
  /** The newest version the review extends to, INCLUSIVE. Null = only `reviewedUnder`. */
  compatibleThrough: string | null
}

export interface PaymentCapability {
  /** Stable, provider-neutral id. Never a provider object name. */
  id: string
  provider: string
  /** The provider program the leaf belongs to, e.g. `connect`, `issuing`. */
  program: string
  state: CapabilityState
  /**
   * Null until legal and finance have approved it. `assertRegistry` refuses a
   * money-facing state with a null here, so this cannot be forgotten — it can
   * only be filled in.
   */
  approvedBy: CapabilityApproval | null
  /** ISO date the state became true. */
  effectiveFrom: string
  /** ISO date it stops being true, or null for open-ended. */
  effectiveTo: string | null
  /**
   * The provider API versions this leaf's certification was reviewed under.
   *
   * `null` ONLY for a leaf that makes no provider call at all — `program:
   * "none"`. `assertRegistry` enforces that in both directions, so a
   * provider-backed leaf cannot opt out of the check by omitting the field and
   * a non-provider leaf cannot acquire a compatibility claim it has no API to
   * be compatible with.
   */
  apiVersions: ProviderApiCompatibility | null
  /** ISO 3166-1 alpha-2 countries the leaf is declared for. */
  countries: readonly string[]
  /** ISO 4217 codes the leaf can settle in. */
  currencies: readonly string[]
  legalEntityTypes: readonly LegalEntityType[]
  businessTypes: readonly BusinessType[]
  /**
   * Product modules whose surfaces would use this leaf.
   *
   * Declared on the capability rather than in a second table keyed by module,
   * because the question a module list has to answer — "this module wants
   * payments; what is the state of the payments it wants?" — is the same fact
   * read from the other end.
   */
  servesModules: readonly string[]
  summary: string
}

export class PaymentCapabilityError extends Error {
  readonly code: string
  readonly capabilityId: string

  constructor(code: string, capabilityId: string, message: string) {
    super(message)
    this.name = "PaymentCapabilityError"
    this.code = code
    this.capabilityId = capabilityId
  }
}

/* ------------------------------------------------------------- the matrices */

/**
 * Where a Tenure-certified leaf could plausibly be offered, once approved.
 *
 * Not "everywhere the provider operates". These are the jurisdictions the
 * pilot's blueprints actually name (US, GB, AE) plus the ones an approval would
 * be sought for together. A country absent from this list produces a named
 * blocker rather than a silent yes.
 */
const CERTIFIABLE_COUNTRIES = [
  "US",
  "CA",
  "GB",
  "IE",
  "AE",
  "AU",
  "NZ",
  "SG",
  "DE",
  "FR",
  "NL",
  "ES",
  "IT",
] as const

/**
 * Settlement currencies the platform's own configuration may name.
 *
 * `blueprints/` publishes USD, GBP and AED today; the rest are the currencies
 * of the countries above. `localization.ts` refuses a tenant currency outside
 * the union of this across non-`UNSUPPORTED` leaves — see `eligibility.ts`.
 */
const CERTIFIABLE_CURRENCIES = [
  "USD",
  "CAD",
  "GBP",
  "EUR",
  "AED",
  "AUD",
  "NZD",
  "SGD",
] as const

const CERTIFIABLE_ENTITY_TYPES: readonly LegalEntityType[] = [
  "COMPANY",
  "NON_PROFIT",
  "GOVERNMENT_ENTITY",
  "PARTNERSHIP",
]

const CERTIFIABLE_BUSINESS_TYPES: readonly BusinessType[] = [
  "EDUCATION",
  "NON_PROFIT",
  "PUBLIC_SECTOR",
  "PROFESSIONAL_SERVICES",
]

/** A leaf Tenure intends to build. Nothing here is available; it is planned. */
function planned(
  id: string,
  program: string,
  summary: string,
  servesModules: readonly string[],
  overrides: Partial<PaymentCapability> = {},
): PaymentCapability {
  return {
    id,
    provider: "stripe",
    program,
    state: "PLANNED",
    approvedBy: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    // Reviewed under the pinned version and no other, because no other has been
    // reviewed. `program: "none"` leaves override this to null through
    // `overrides`; every provider-backed leaf keeps it.
    apiVersions: { reviewedUnder: PROVIDER_API_VERSION, compatibleThrough: null },
    countries: CERTIFIABLE_COUNTRIES,
    currencies: CERTIFIABLE_CURRENCIES,
    legalEntityTypes: CERTIFIABLE_ENTITY_TYPES,
    businessTypes: CERTIFIABLE_BUSINESS_TYPES,
    servesModules,
    summary,
    ...overrides,
  }
}

/**
 * A leaf Tenure has decided NOT to offer, with an empty matrix.
 *
 * The empty matrix is load-bearing rather than lazy: `simulateEligibility`
 * evaluates against the declared matrix, so an unsupported leaf blocks on every
 * axis and the operator is told all of them at once instead of fixing the
 * country, re-running, and being handed the currency.
 */
function unsupported(
  id: string,
  program: string,
  summary: string,
  servesModules: readonly string[],
): PaymentCapability {
  return {
    id,
    provider: "stripe",
    program,
    state: "UNSUPPORTED",
    approvedBy: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    apiVersions: { reviewedUnder: PROVIDER_API_VERSION, compatibleThrough: null },
    countries: [],
    currencies: [],
    legalEntityTypes: [],
    businessTypes: [],
    servesModules,
    summary,
  }
}

/**
 * Bible §3's required capability leaves, every one of them.
 *
 * The split between `PLANNED` and `UNSUPPORTED` is not a guess. `UNSUPPORTED`
 * is used exactly where Bible §2 says Tenure is not the thing — issuer, bank,
 * custodian of funds, payroll provider, KYC decision owner — or where §0
 * disables it by default, as it does platform fees. Everything else is work
 * Tenure intends to do and has not done.
 */
export const PAYMENT_CAPABILITIES: readonly PaymentCapability[] = [
  planned(
    "merchant.connected-account.onboarding",
    "connect",
    "Merchant connected-account onboarding and management.",
    ["administration"],
  ),
  planned("acceptance.card-and-wallet", "payments", "Online card and wallet acceptance.", [
    "budgeting",
    "reimbursements",
  ]),
  planned("acceptance.bank-debit-and-transfer", "payments", "Bank debit and bank transfer acceptance.", [
    "budgeting",
  ]),
  planned(
    "acceptance.local-payment-methods",
    "payments",
    "Local payment methods by country and currency.",
    ["budgeting"],
  ),
  planned("checkout.hosted", "checkout", "Hosted Checkout.", ["budgeting"]),
  planned("checkout.embedded", "checkout", "Embedded checkout and Payment Element.", ["budgeting"]),
  planned("checkout.payment-links-and-invoices", "billing", "Payment links and invoices.", [
    "budgeting",
  ]),
  unsupported("acceptance.in-person-terminal", "terminal", "In-person payments and Terminal.", []),
  planned("funds-flow.direct-charge", "connect", "Direct charges to the tenant merchant.", [
    "budgeting",
    "reimbursements",
  ]),
  planned("funds-flow.destination-charge", "connect", "Destination charges.", ["budgeting"]),
  planned(
    "funds-flow.separate-charges-and-transfers",
    "connect",
    "Separate charges and transfers, and multi-party splits.",
    ["budgeting"],
  ),
  unsupported(
    "funds-flow.application-fee",
    "connect",
    "Application and platform fees. Disabled by default (Bible §0.6): Tenure may collect one only where contract, pricing, tax treatment, provider configuration and legal review all allow it.",
    [],
  ),
  planned("refunds.full-partial-and-reversal", "payments", "Refunds, partial refunds and reversals.", [
    "reimbursements",
  ]),
  planned("disputes.evidence", "payments", "Payment disputes and evidence submission.", [
    "reimbursements",
  ]),
  planned("balances.provider-and-tenant", "connect", "Provider and tenant balances.", ["budgeting"]),
  planned("payouts.automatic-manual-instant", "connect", "Automatic, manual and instant payouts.", [
    "budgeting",
  ]),
  planned(
    "payouts.schedule-and-destination",
    "connect",
    "Payout schedule and payout destination management.",
    ["budgeting"],
  ),
  planned(
    "disbursement.vendor-and-contractor",
    "connect",
    "Vendor, contractor and third-party disbursement.",
    ["reimbursements"],
  ),
  unsupported(
    "financial-account.embedded",
    "treasury",
    "Embedded financial accounts. Tenure is not a bank, money transmitter or custodian of customer funds (Bible §2).",
    [],
  ),
  unsupported(
    "financial-account.transfers",
    "treasury",
    "Inbound transfers, outbound transfers and outbound payments.",
    [],
  ),
  unsupported(
    "cards.physical-and-virtual",
    "issuing",
    "Physical and virtual cards. Tenure is not an issuer or card network (Bible §2).",
    [],
  ),
  unsupported(
    "cards.lifecycle",
    "issuing",
    "Cardholder, card, authorization, transaction and dispute management.",
    [],
  ),
  planned(
    "data.financial-connections",
    "financial-connections",
    "Financial Connections and open-banking data access.",
    ["budgeting"],
  ),
  planned(
    "billing.subscriptions-and-usage",
    "billing",
    "Billing, invoicing, subscriptions and usage payment collection.",
    ["budgeting"],
  ),
  planned("tax.calculation", "tax", "Tax calculation and provider integration.", ["budgeting"]),
  unsupported(
    "identity.kyc-kyb",
    "identity",
    "Identity, KYC and KYB provider integration. The provider owns the decision; Tenure is not the KYC/KYB decision owner (Bible §2).",
    [],
  ),
  planned("risk.fraud-tooling", "radar", "Fraud and risk tooling and controls.", ["budgeting"]),
  planned(
    "currency.multi-presentment-and-settlement",
    "payments",
    "Multi-currency presentment and settlement.",
    ["budgeting"],
  ),
  planned(
    "internal.allocations-and-settlement-instructions",
    "none",
    "Internal organizational allocations and settlement instructions. No provider call: no external legal or bank-account boundary is crossed (Bible §0.10).",
    ["budgeting", "reimbursements", "approvals"],
    // The one leaf with no provider API behind it, so there is no API version
    // for it to be compatible with. Declaring one would be a claim about a call
    // this leaf must never make.
    { apiVersions: null },
  ),
  planned(
    "marketplace.supplier-and-payee-accounts",
    "connect",
    "Marketplace, supplier and payee connected accounts.",
    ["reimbursements"],
  ),
  planned(
    "reporting.fees-reserves-tax-forms-reconciliation",
    "reporting",
    "Provider reporting, fees, reserves, tax forms and reconciliation.",
    ["budgeting"],
  ),
]

/* ------------------------------------------------------------- the ADR check */

let cachedRoot: string | null = null

/**
 * The monorepo root, found by walking up from the process's own directory.
 *
 * Neither `__dirname` nor `import.meta.url` is available in both of the two
 * ways this file is loaded — jest transpiles these packages to CJS, and
 * `node --test` loads the architecture suites as ESM. Walking up for a marker
 * that exists in exactly one place works under both, and throws rather than
 * defaulting to cwd: a root that silently resolved to the wrong directory would
 * make every `adrExists` call return false and turn the guard into a blanket
 * refusal that looks like a policy decision.
 */
function repoRoot(): string {
  if (cachedRoot) return cachedRoot
  let dir = process.cwd()
  for (;;) {
    if (fs.existsSync(path.join(dir, "docs", "decisions"))) {
      cachedRoot = dir
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(
        `Cannot locate the repository root from ${process.cwd()}: no ancestor contains docs/decisions.`,
      )
    }
    dir = parent
  }
}

/** Does this repo-relative ADR path name a file that exists? */
export function adrExistsOnDisk(adr: string): boolean {
  if (!adr || path.isAbsolute(adr)) return false
  return fs.existsSync(path.join(repoRoot(), adr))
}

export interface RegistryChecks {
  adrExists: (adr: string) => boolean
}

/* --------------------------------------------- the provider API-version check */

/**
 * Is `version` inside the reviewed window?
 *
 * Inclusive at both ends. `compatibleThrough: null` narrows the window to the
 * single reviewed version — see `ProviderApiCompatibility` for why that, and
 * not "open-ended", is the honest default.
 */
function withinApiWindow(window: ProviderApiCompatibility, version: string): boolean {
  if (version < window.reviewedUnder) return false
  if (window.compatibleThrough === null) return version === window.reviewedUnder
  return version <= window.compatibleThrough
}

function describeApiWindow(window: ProviderApiCompatibility): string {
  return window.compatibleThrough === null
    ? `reviewed under ${window.reviewedUnder} only`
    : `reviewed under ${window.reviewedUnder} through ${window.compatibleThrough}`
}

export type ApiCompatibilityVerdict =
  | { compatible: true; code: "api-version-reviewed" | "api-version-not-applicable"; reason: string }
  | { compatible: false; code: "api-version-not-reviewed"; reason: string }

/**
 * PAY-010-003 — is this leaf certified for the provider API version in use?
 *
 * Defaults to the pinned `PROVIDER_API_VERSION`, which is what production runs
 * on; the parameter exists so a watch process can ask the same question about a
 * CANDIDATE version without changing the pin (PAY-010-007).
 *
 * A leaf with no provider program is `compatible` with the code that says so,
 * rather than a bare `true`: "no API is involved" and "the API version was
 * reviewed" are different answers and a caller reporting them should be able to
 * tell them apart.
 */
export function providerApiCompatibility(
  id: string,
  version: string = PROVIDER_API_VERSION,
): ApiCompatibilityVerdict {
  const cap = capability(id)
  normalizeProviderApiVersion(version)

  if (cap.apiVersions === null) {
    return {
      compatible: true,
      code: "api-version-not-applicable",
      reason: `"${cap.id}" makes no provider call (program "none"), so no API version applies.`,
    }
  }

  if (withinApiWindow(cap.apiVersions, version)) {
    return {
      compatible: true,
      code: "api-version-reviewed",
      reason: `"${cap.id}" is ${describeApiWindow(cap.apiVersions)}, which covers ${version}.`,
    }
  }

  return {
    compatible: false,
    code: "api-version-not-reviewed",
    reason:
      `"${cap.id}" is ${describeApiWindow(cap.apiVersions)}, and ${version} is outside that. ` +
      `Nobody has reviewed this leaf against ${version}; carrying the certification forward ` +
      `would be inferring availability rather than deciding it (Bible §16).`,
  }
}

/**
 * Refuse a registry that claims availability it has not earned.
 *
 * Two distinct refusals, deliberately carrying different codes:
 *
 *   * `capability-state-unapproved` — a money-facing state with no ADR at all.
 *   * `capability-adr-missing` — an ADR named but not on disk, which is the
 *     failure mode of copying a plausible filename into the field.
 *
 * They are different because they need different fixes: the first needs a
 * decision, the second needs the decision to have been written down.
 *
 * `adrExists` is injected rather than reached for directly so the same function
 * is exercised by a test that does not have to create files on disk. The
 * production path passes `adrExistsOnDisk`.
 */
export function assertRegistry(
  capabilities: readonly PaymentCapability[],
  checks: RegistryChecks,
): void {
  const seen = new Set<string>()
  for (const cap of capabilities) {
    if (seen.has(cap.id)) {
      throw new PaymentCapabilityError(
        "capability-duplicate-id",
        cap.id,
        `Two capabilities share the id "${cap.id}". One id, one answer.`,
      )
    }
    seen.add(cap.id)

    if (!(CAPABILITY_STATES as readonly string[]).includes(cap.state)) {
      throw new PaymentCapabilityError(
        "capability-unknown-state",
        cap.id,
        `"${cap.state}" is not one of ${CAPABILITY_STATES.join(" | ")}.`,
      )
    }

    if (Number.isNaN(Date.parse(cap.effectiveFrom))) {
      throw new PaymentCapabilityError(
        "capability-bad-effective-from",
        cap.id,
        `effectiveFrom "${cap.effectiveFrom}" is not a date.`,
      )
    }
    if (cap.effectiveTo !== null) {
      if (Number.isNaN(Date.parse(cap.effectiveTo))) {
        throw new PaymentCapabilityError(
          "capability-bad-effective-to",
          cap.id,
          `effectiveTo "${cap.effectiveTo}" is not a date.`,
        )
      }
      if (Date.parse(cap.effectiveTo) <= Date.parse(cap.effectiveFrom)) {
        throw new PaymentCapabilityError(
          "capability-inverted-window",
          cap.id,
          `effectiveTo ${cap.effectiveTo} is not after effectiveFrom ${cap.effectiveFrom}.`,
        )
      }
    }

    // PAY-010-003. The API-version half of the declaration, checked the same way
    // the date half is: the shape first, then the policy.
    if (cap.apiVersions === null) {
      if (cap.program !== "none") {
        throw new PaymentCapabilityError(
          "capability-api-version-missing",
          cap.id,
          `"${cap.id}" runs on provider program "${cap.program}" and declares no reviewed API ` +
            `version. Only a leaf with no provider call at all (program "none") may omit it; ` +
            `omitting it elsewhere is a certification with nothing behind it.`,
        )
      }
    } else {
      if (cap.program === "none") {
        throw new PaymentCapabilityError(
          "capability-api-version-on-non-provider-leaf",
          cap.id,
          `"${cap.id}" makes no provider call (program "none") and yet claims compatibility with ` +
            `provider API version ${cap.apiVersions.reviewedUnder}. There is no call for that ` +
            `claim to be about.`,
        )
      }
      try {
        normalizeProviderApiVersion(cap.apiVersions.reviewedUnder)
        if (cap.apiVersions.compatibleThrough !== null) {
          normalizeProviderApiVersion(cap.apiVersions.compatibleThrough)
        }
      } catch (error) {
        throw new PaymentCapabilityError(
          "capability-bad-api-version",
          cap.id,
          `"${cap.id}" declares an unreadable provider API version: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (
        cap.apiVersions.compatibleThrough !== null &&
        cap.apiVersions.compatibleThrough <= cap.apiVersions.reviewedUnder
      ) {
        throw new PaymentCapabilityError(
          "capability-inverted-api-window",
          cap.id,
          `compatibleThrough ${cap.apiVersions.compatibleThrough} is not after reviewedUnder ` +
            `${cap.apiVersions.reviewedUnder}. An inclusive upper bound below the lower bound is ` +
            `a window nothing is inside; drop it to null instead, which means the reviewed ` +
            `version alone.`,
        )
      }
    }

    if (!STATES_REQUIRING_APPROVAL.includes(cap.state)) continue

    if (cap.apiVersions !== null && !withinApiWindow(cap.apiVersions, PROVIDER_API_VERSION)) {
      throw new PaymentCapabilityError(
        "capability-api-version-uncertified",
        cap.id,
        `"${cap.id}" claims ${cap.state}, and this build is pinned to provider API version ` +
          `${PROVIDER_API_VERSION}, which is outside its reviewed window ` +
          `(${describeApiWindow(cap.apiVersions)}). A certification reviewed against a different ` +
          `API version is not a certification of the calls this build makes.`,
      )
    }

    if (cap.approvedBy === null) {
      throw new PaymentCapabilityError(
        "capability-state-unapproved",
        cap.id,
        `"${cap.id}" claims ${cap.state}, which puts money in front of a tenant, and names no ` +
          `approving ADR. A provider supporting something is not Tenure having approved it.`,
      )
    }
    if (!checks.adrExists(cap.approvedBy.adr)) {
      throw new PaymentCapabilityError(
        "capability-adr-missing",
        cap.id,
        `"${cap.id}" claims ${cap.state} on the authority of "${cap.approvedBy.adr}", which is not ` +
          `a file in this repository. The approval has to exist, not merely be cited.`,
      )
    }
  }
}

/* ---------------------------------------------------------------- the reader */

const BY_ID = new Map(PAYMENT_CAPABILITIES.map((c) => [c.id, c]))

/**
 * The registered capability, or a refusal.
 *
 * Deliberately throws for an unknown id rather than returning undefined: every
 * caller of this is deciding whether something is allowed, and `undefined`
 * flowing into that decision is how an unregistered leaf comes to be treated as
 * one that simply has no restrictions.
 */
export function capability(id: string): PaymentCapability {
  const found = BY_ID.get(id)
  if (!found) {
    throw new PaymentCapabilityError(
      "capability-unknown",
      id,
      `No payments capability "${id}" is registered. It cannot be enabled by naming it.`,
    )
  }
  return found
}

/**
 * The state of one capability, at a moment.
 *
 * Outside its effective window the answer is `UNSUPPORTED`, not the declared
 * state: a leaf whose window has closed is exactly as unavailable as one that
 * was never certified, and reporting the stored word would make an expired
 * certification read as current.
 */
export function capabilityState(id: string, at: string = new Date().toISOString()): CapabilityState {
  const cap = capability(id)
  const when = Date.parse(at)
  if (Number.isNaN(when)) {
    throw new PaymentCapabilityError("capability-bad-as-of", id, `"${at}" is not a date.`)
  }
  if (when < Date.parse(cap.effectiveFrom)) return "UNSUPPORTED"
  if (cap.effectiveTo !== null && when >= Date.parse(cap.effectiveTo)) return "UNSUPPORTED"
  // PAY-010-003. The second window, and it invalidates a state exactly as the
  // date window does: a leaf certified against a provider API version this
  // build no longer speaks is as unavailable as one whose window has closed,
  // and reporting the stored word would make an unreviewed certification read
  // as current.
  if (!providerApiCompatibility(cap.id).compatible) return "UNSUPPORTED"
  return cap.state
}

/** Is this state one a tenant may actually transact on? */
export function isTransactable(state: CapabilityState): boolean {
  return STATES_REQUIRING_APPROVAL.includes(state)
}

/**
 * Every settlement currency any non-`UNSUPPORTED` leaf declares.
 *
 * The union rather than an intersection: a tenant denominated in a currency
 * some capability can settle is configurable, and which capability it is
 * becomes an eligibility question per capability. An intersection would refuse
 * a legitimate currency because one unrelated leaf does not list it.
 */
export function settlementCurrencies(): readonly string[] {
  const out = new Set<string>()
  for (const cap of PAYMENT_CAPABILITIES) {
    if (cap.state === "UNSUPPORTED") continue
    for (const code of cap.currencies) out.add(code)
  }
  return [...out].sort()
}

/** What a module list needs to render a state instead of a boolean. */
export interface ModulePaymentCapability {
  moduleKey: string
  capabilityId: string
  state: CapabilityState
  /**
   * PAY-010-002. True only when ALL FOUR gates pass — provider capability,
   * Tenure certification, tenant entitlement and merchant activation.
   *
   * It used to mean "the state is a money-facing one", which is one of the
   * four. A certified leaf on a tenant with no connected account and no
   * observed provider account was reported transactable, and the surfaces that
   * render this word have no other source to correct it from.
   */
  transactable: boolean
  /** All four verdicts, so a surface can say WHICH gate is unmet. */
  gates: readonly GateResult[]
  summary: string
}

/**
 * PAY-000-008's production read path.
 *
 * Validates the whole registry against the ADRs on disk on every call — which
 * is cheap (thirty-one objects and, at most, thirty-one `existsSync` calls that
 * only run once an entry claims a money-facing state) and is what makes the
 * guard part of serving rather than part of CI. A registry edited to claim GA
 * without writing the ADR does not render a wrong module list; it fails.
 *
 * Called by `packages/platform-config/src/modules.ts`.
 */
export function capabilityAvailabilityForModules(
  moduleKeys: readonly string[],
  at: string = new Date().toISOString(),
): readonly ModulePaymentCapability[] {
  assertRegistry(PAYMENT_CAPABILITIES, { adrExists: adrExistsOnDisk })

  const wanted = new Set(moduleKeys)
  const out: ModulePaymentCapability[] = []
  for (const cap of PAYMENT_CAPABILITIES) {
    for (const moduleKey of cap.servesModules) {
      if (!wanted.has(moduleKey)) continue
      const state = capabilityState(cap.id, at)
      // PAY-010-002. Two of the four facts are knowable here and two are not,
      // and they are passed as what they are. `entitledModules` IS the caller's
      // module set — the tenant's own — so the entitlement gate is answered.
      // The provider observation is `null`: this layer has read no provider
      // account, and `null` produces UNDETERMINED rather than a guess in either
      // direction. `merchantActivation` is `null` for the opposite reason —
      // this layer knows there is no connected account for any tenant in this
      // repository, which is a fact, so the gate FAILS rather than abstaining.
      const decision: CapabilityGateDecision = evaluateCapabilityGates({
        capabilityId: cap.id,
        certification: { state, transactable: isTransactable(state) },
        servesModules: cap.servesModules,
        providerCapability: null,
        entitledModules: moduleKeys,
        merchantActivation: null,
      })
      out.push({
        moduleKey,
        capabilityId: cap.id,
        state,
        transactable: decision.allow,
        gates: decision.gates,
        summary: cap.summary,
      })
    }
  }
  return out.sort((a, b) =>
    a.moduleKey === b.moduleKey
      ? a.capabilityId.localeCompare(b.capabilityId)
      : a.moduleKey.localeCompare(b.moduleKey),
  )
}
