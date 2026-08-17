import { PROVIDER_MODES } from "./api-version"
import type { ProviderMode } from "./external-reference"
import {
  APPROVED_DISCLOSURE_PHRASE,
  PROHIBITED_CLAIM_RULES,
  describeFinding,
  scanProhibitedClaims,
  type ProhibitedClaimFinding,
  type ProhibitedClaimRule,
} from "./prohibited-claims"
import { classifyRequest, type RefusalDecision } from "./refusal"
import {
  partyFor,
  resolveResponsibility,
  type FundsFlow,
  type ResponsibilityConfig,
  type ResponsibilityParty,
} from "./responsibility"

export {
  classifyRequest,
  PROVIDER_MODES,
  type FundsFlow,
  type ProviderMode,
  type RefusalDecision,
  type ResponsibilityConfig,
  type ResponsibilityParty,
}

/**
 * PAY-000-004 — re-exported here, on the CLIENT-SAFE subpath, deliberately.
 *
 * The two surfaces that have to run the rules at request time are a merchant
 * disclosure (below) and a Relay reply (`apps/web/src/components/ai/relay-reply.ts`),
 * and the second is a client module. The rules are pure — no filesystem, no
 * crypto — so they belong on this side of the split rather than behind the
 * package root, which reaches `node:fs` through the capability registry.
 */
export {
  APPROVED_DISCLOSURE_PHRASE,
  PROHIBITED_CLAIM_RULES,
  describeFinding,
  scanProhibitedClaims,
  type ProhibitedClaimFinding,
  type ProhibitedClaimRule,
}

/**
 * PAY-020-002 — the door business modules go through, and the only one.
 *
 * Bible §4: "Every business module calls semantic commands such as
 * `CreateCustomerPayment`, `ApproveVendorDisbursement`, `IssueOrganizationCard`,
 * or `RefundReceipt`. It never constructs provider API requests directly." The
 * rule was unenforceable because there was nothing to point a module AT: no
 * payments package existed, and the command bus that would have been the
 * alternative (`apps/web/src/lib/commands/bus.ts`) had zero production callers.
 *
 * Three properties make this a port rather than a wrapper:
 *
 *   * **No provider SDK, and no dependency that could pull one in.** The
 *     package declares no dependencies at all;
 *     `tests/architecture/payments-port-is-the-only-door.test.mjs` fails the
 *     build if any source file imports a provider client or names a provider
 *     endpoint.
 *   * **No write verb in the type.** Every export here answers a question.
 *     There is no `charge`, no `payout`, no `transfer` — not "not yet
 *     implemented", but absent, so a module cannot call one and a reviewer
 *     cannot miss one being added.
 *   * **Integer minor units and an explicit mode.** A quote with no mode is a
 *     quote that will one day be computed against live and rendered as test.
 *
 * This module is the CLIENT-SAFE subpath (`@tenure/payments/gateway`): nothing
 * in its import graph touches a node builtin, so `apps/web/src/lib/finance.ts`
 * — which client components import — can reach it. The root entry point pulls
 * in the capability registry, which reads ADRs off disk.
 */

export class GatewayError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "GatewayError"
    this.code = code
  }
}

export interface MerchantDescriptorInput {
  /** The registered legal name of the entity that sells. Never a Tenure name. */
  legalName: string
  /** Up to 22 characters, as it appears on the payer's statement. */
  statementDescriptor: string
  fundsFlow: FundsFlow
  responsibility: ResponsibilityConfig
}

export interface MerchantDescriptor {
  legalName: string
  statementDescriptor: string
  /** Resolved from the responsibility matrix, never assumed. */
  merchantOfRecord: ResponsibilityParty | null
  /** The sentence a receipt or preview may show. Accurate phrasing only. */
  disclosure: string
  blockers: readonly string[]
}

/**
 * Who the payer sees, and what may truthfully be said about it.
 *
 * Bible §2 lists the product copy that is forbidden — "Tenure bank account",
 * "Tenure holds your funds", "Tenure-issued card" — and the reason it is
 * forbidden is that it is usually true-sounding and legally false. So the
 * disclosure is generated from the resolved matrix rather than written by hand
 * at each surface, and an unresolved `merchantDisplay` produces a blocker
 * instead of a sentence naming Tenure by default.
 */
export function describeMerchant(input: MerchantDescriptorInput): MerchantDescriptor {
  const resolutions = resolveResponsibility(input.fundsFlow, input.responsibility)
  const merchantOfRecord = partyFor(resolutions, "merchantDisplay")
  const feePayer = partyFor(resolutions, "feePayer")
  const blockers = resolutions
    .filter((r) => r.axis === "merchantDisplay" || r.axis === "feePayer")
    .flatMap((r) => r.blockers)

  const descriptor = input.statementDescriptor.trim()
  if (descriptor.length === 0) {
    blockers.push(
      "statement-descriptor-empty: the payer would see nothing identifying the seller, which is " +
        "the single largest driver of disputes (PAY-040-007).",
    )
  } else if (descriptor.length > 22) {
    blockers.push(
      `statement-descriptor-too-long: ${descriptor.length} characters. Networks truncate at 22, ` +
        `so the payer sees something other than what this preview showed.`,
    )
  }

  const disclosure =
    merchantOfRecord === null
      ? "The seller for this payment has not been decided, so no merchant can be shown."
      : merchantOfRecord === "TENANT"
        ? `${input.legalName} is the seller for this payment.` +
          (feePayer === null
            ? ""
            : feePayer === "TENURE"
              ? " Processing fees are borne by Tenure."
              : feePayer === "CUSTOMER"
                ? " Processing fees are passed to the payer."
                : ` Processing fees are borne by the ${feePayer.toLowerCase()}.`)
        : `${merchantOfRecord} is recorded as the seller for this payment.`

  // PAY-000-004. The sentence is generated, and one of its inputs is not:
  // `legalName` is whatever the tenant registered. A club whose registered legal
  // name happens to contain one of Bible §2's forbidden phrases would have this
  // surface print it on a receipt, from data, with no code change anybody could
  // review. So the generated sentence is scanned before it is returned, and a
  // finding becomes a blocker and REPLACES the disclosure — not a warning
  // alongside it, because a warning beside the wrong sentence still ships the
  // wrong sentence.
  const claims = scanProhibitedClaims(disclosure)
  if (claims.length > 0) {
    for (const finding of claims) blockers.push(`prohibited-claim-${describeFinding(finding)}`)
    return {
      legalName: input.legalName,
      statementDescriptor: descriptor,
      merchantOfRecord,
      disclosure:
        `No merchant disclosure can be shown for this payment: the generated sentence contains ` +
        `product copy Bible §2 prohibits (${claims.map((f) => f.ruleId).join(", ")}). ` +
        `Where a disclosure is required the approved phrasing is "${APPROVED_DISCLOSURE_PHRASE}".`,
      blockers,
    }
  }

  return {
    legalName: input.legalName,
    statementDescriptor: descriptor,
    merchantOfRecord,
    disclosure,
    blockers,
  }
}

export interface PaymentQuoteInput {
  /** Integer minor units. Never a decimal, never a float (Bible §5). */
  amountMinorUnits: number
  /** ISO 4217, uppercase. */
  currency: string
  mode: ProviderMode
  fundsFlow: FundsFlow
  responsibility: ResponsibilityConfig
}

export interface PaymentQuote {
  quotable: boolean
  amountMinorUnits: number
  currency: string
  mode: ProviderMode
  feePayer: ResponsibilityParty | null
  merchantOfRecord: ResponsibilityParty | null
  refundPayer: ResponsibilityParty | null
  /** Every reason this cannot be quoted, not the first. */
  blockers: readonly string[]
}

/**
 * What a payment would look like. A question, not an instruction.
 *
 * Nothing here contacts a provider and nothing here can move money. The output
 * is what Bible §7's funds-flow preview renders: who the seller is, who bears
 * fees, who funds a refund — and, when any of those is unanswered, the reason
 * rather than a plausible default.
 */
export function quotePayment(input: PaymentQuoteInput): PaymentQuote {
  const blockers: string[] = []

  if (!(PROVIDER_MODES as readonly string[]).includes(input.mode)) {
    throw new GatewayError(
      "gateway-mode-unknown",
      `"${input.mode}" is not a provider mode. Test and live are separated by account, keys, ` +
        `secrets and event destinations (PAY-000-007); a quote with no mode belongs to neither.`,
    )
  }

  if (!Number.isInteger(input.amountMinorUnits)) {
    blockers.push(
      `amount-not-integer: ${input.amountMinorUnits} is not a whole number of minor units. ` +
        `Binary floating point never touches money (Bible §5).`,
    )
  }
  if (input.amountMinorUnits <= 0) {
    blockers.push(`amount-not-positive: ${input.amountMinorUnits} minor units.`)
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    blockers.push(`currency-not-iso-4217: "${input.currency}" is not a three-letter uppercase code.`)
  }

  const resolutions = resolveResponsibility(input.fundsFlow, input.responsibility)
  for (const resolution of resolutions) blockers.push(...resolution.blockers)

  return {
    quotable: blockers.length === 0,
    amountMinorUnits: input.amountMinorUnits,
    currency: input.currency,
    mode: input.mode,
    feePayer: partyFor(resolutions, "feePayer"),
    merchantOfRecord: partyFor(resolutions, "merchantDisplay"),
    refundPayer: partyFor(resolutions, "refundPayer"),
    blockers,
  }
}
