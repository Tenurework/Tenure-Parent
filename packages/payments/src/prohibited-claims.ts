/**
 * PAY-000-004 — the copy Bible §2 forbids, as rules something can run.
 *
 * Bible §2 ends with a sentence that is a lint rule written in prose: *"Do not
 * use product copy such as 'Tenure bank account,' 'Tenure holds your funds,'
 * 'Tenure-issued card,' 'insured by Tenure,' or 'payments available globally'
 * unless the exact legal/provider relationship permits it."* Until this file
 * existed that sentence was enforced by whoever happened to read it. Nothing in
 * the repository could tell you whether a page, a document or an assistant reply
 * contained one of those phrases, and the five phrases are dangerous precisely
 * because each is the *natural* way to describe the feature — an engineer
 * writing "your Tenure balance" is not being careless, they are being fluent.
 *
 * ## Why patterns rather than the five strings
 *
 * Matching the literal five would catch the examples and nothing else. Bible §2
 * gives the examples *and* the boundary they violate ("Tenure is not
 * automatically: … Custodian or holder of customer funds"), so each rule below
 * carries `boundary` — the §2 line it protects — and generalizes the example to
 * the class. `bibleCopy` is the §2 phrase the rule came from, or `null` for the
 * rules that come from a "Tenure is not" line with no worked example.
 *
 * ## Negations are not matched, and that is structural rather than a special case
 *
 * Every pattern anchored on Tenure is written as `Tenure` immediately followed
 * by its verb or article — `Tenure\s+holds`, `Tenure\s+is\s+(a|an|the)`. A
 * negation puts a word in between ("Tenure does not hold", "Tenure is not a
 * bank", "Tenure never holds"), so the accurate sentence a boundary document has
 * to be able to write does not trip the rule that forbids its opposite. This is
 * tested rather than asserted: `prohibited-claims.test.ts` runs every negated
 * form from Bible §2's own list through the scanner and requires zero findings.
 *
 * What that does NOT buy is quotation. A document *citing* the forbidden copy
 * contains the forbidden copy, and no pattern can tell a citation from a claim.
 * `prohibited-claims-content-review.test.ts` therefore carries an explicit,
 * per-file, per-rule allowance list, and fails if an allowance stops matching
 * anything — an allowance nobody re-reads is a blanket exemption with a comment
 * on it.
 *
 * Pure: no filesystem, no network, no node builtin. It is re-exported from the
 * client-safe `@tenure/payments/gateway` subpath because the two surfaces that
 * have to run it — a merchant disclosure and an assistant reply — are both
 * reachable from a client component.
 */

/** The phrasing Bible §2 says to use instead, where a disclosure is required. */
export const APPROVED_DISCLOSURE_PHRASE =
  "financial account provided through Stripe and its banking partners"

export interface ProhibitedClaimRule {
  /** Stable machine id. Safe to switch on, safe to put in an allowance list. */
  id: string
  /**
   * The exact phrase Bible §2 names, when it names one. `null` when the rule
   * comes from a "Tenure is not automatically" line instead — those have no
   * worked example, and inventing one would make the citation false.
   */
  bibleCopy: string | null
  /** The Bible §2 boundary this protects, in §2's words. */
  boundary: string
  pattern: RegExp
  /** Why the sentence is false, not merely off-brand. */
  why: string
  /** What may be said instead. Never "ask legal" — a phrase or a refusal. */
  insteadSay: string
}

/**
 * The rules.
 *
 * Ordered by Bible §2's own boundary list so a reader can check the coverage
 * against the authority rather than against a count. Every pattern is
 * case-insensitive and global-free — `scanProhibitedClaims` clones each with the
 * `g` flag it needs, because a shared `g` regex carries `lastIndex` between
 * calls and would skip findings on every second scan.
 */
export const PROHIBITED_CLAIM_RULES: readonly ProhibitedClaimRule[] = [
  {
    id: "tenure-is-merchant-of-record",
    bibleCopy: null,
    boundary: "Merchant of record.",
    pattern: /\bTenure\s+is\s+(?:the\s+)?merchant\s+of\s+record\b/i,
    why:
      "The tenant legal entity is the merchant by default (pay-adr-0001). Tenure becoming the " +
      "merchant of record is an approved exception pinned to one decision, never a sentence.",
    insteadSay:
      "Name the resolved party: `describeMerchant` returns `merchantOfRecord` from the " +
      "responsibility matrix, and null when nobody has decided.",
  },
  {
    id: "tenure-is-a-bank",
    bibleCopy: null,
    boundary: "Bank, money transmitter, payment institution, acquirer, issuer or card network.",
    pattern:
      /\bTenure\s+is\s+(?:a|an|the)\s+(?:bank|money\s+transmitter|payment\s+institution|acquirer|issuer|card\s+network)\b/i,
    why: "Tenure holds none of those licences or scheme memberships.",
    insteadSay: `"${APPROVED_DISCLOSURE_PHRASE}".`,
  },
  {
    id: "tenure-bank-account",
    bibleCopy: "Tenure bank account",
    boundary: "Bank, money transmitter, payment institution, acquirer, issuer or card network.",
    pattern: /\bTenure(?:'s|’s)?\s+(?:bank|checking|savings|deposit)\s+accounts?\b/i,
    why:
      "No account in this product is held at Tenure. Calling it one tells the reader their money " +
      "is somewhere it is not, which is the sentence a regulator reads first.",
    insteadSay: `"${APPROVED_DISCLOSURE_PHRASE}".`,
  },
  {
    id: "insured-by-tenure",
    bibleCopy: "insured by Tenure",
    boundary: "Bank, money transmitter, payment institution, acquirer, issuer or card network.",
    pattern: /\b(?:insured\s+by\s+Tenure|Tenure\s+insures)\b/i,
    why: "Tenure carries no deposit insurance and is not a party that could.",
    insteadSay:
      "State the actual holder of the funds and its arrangement, or say nothing about insurance.",
  },
  {
    id: "tenure-holds-funds",
    bibleCopy: "Tenure holds your funds",
    boundary: "Custodian or holder of customer funds.",
    pattern:
      /\bTenure\s+(?:holds|hold|is\s+holding|will\s+hold|safeguards|keeps|custodies)\s+(?:your|their|the|tenant|customer|student|club|any)?\s*(?:funds?|money|cash|deposits?)\b/i,
    why:
      "Tenure is not a custodian. Funds sit with the provider and its banking partners; a " +
      "sentence that moves them to Tenure moves the liability with it.",
    insteadSay: `"${APPROVED_DISCLOSURE_PHRASE}".`,
  },
  {
    id: "tenure-balance-is-funds",
    bibleCopy: null,
    boundary: "Custodian or holder of customer funds.",
    pattern: /\byour\s+Tenure\s+balance\b/i,
    why:
      "The only balance Tenure computes is an internal subledger figure. Naming it the reader's " +
      "balance presents a bookkeeping total as available money (PAY-080-006).",
    insteadSay:
      "Say which balance it is — an internal allocation, a provider balance or a bank balance — " +
      "and never let the first stand in for the third.",
  },
  {
    id: "tenure-issued-card",
    bibleCopy: "Tenure-issued card",
    boundary: "Bank, money transmitter, payment institution, acquirer, issuer or card network.",
    pattern: /\bTenure[-\s]issued\b/i,
    why:
      "Tenure is not an issuer. `cards.physical-and-virtual` is UNSUPPORTED in the registry for " +
      "exactly this reason, so the phrase describes a product that does not exist.",
    insteadSay: "Name the issuing bank and its programme, once one exists.",
  },
  {
    id: "tenure-is-employer-or-tax-filer",
    bibleCopy: null,
    boundary: "Employer, payroll provider or tax filer.",
    // Two alternatives, and the second REQUIRES the tax noun. `Tenure submits`
    // on its own is a true sentence about dispute evidence (Bible §14), so a
    // verb-only pattern would refuse the accurate copy along with the false.
    pattern:
      /\bTenure\s+is\s+(?:your|the)\s+(?:employer|payroll\s+provider|tax\s+filer)\b|\bTenure\s+(?:files|will\s+file|submits)\b[^.\n]{0,40}\b(?:tax|taxes|1099|W-9|W-2)\b/i,
    why: "Tenure employs nobody in a tenant and files nothing with any tax authority.",
    insteadSay:
      "Describe the data handoff and name the party that files, per PAY-090-007's supported " +
      "jurisdictions.",
  },
  {
    id: "tenure-decides-kyc",
    bibleCopy: null,
    boundary: "KYC/KYB decision owner where Stripe owns that obligation.",
    pattern: /\bTenure\s+(?:verifies|approves|decides|clears|confirms)\b[^.\n]{0,40}\b(?:KYC|KYB|identity|identities)\b/i,
    why:
      "The provider owns the verification decision. Tenure collects, reminds and records; saying " +
      "it decides makes an outcome Tenure cannot produce sound like one it controls.",
    insteadSay: "Say the provider decides and Tenure tracks the outstanding requirements.",
  },
  {
    id: "tenure-guarantees-balances",
    bibleCopy: null,
    boundary: "Guarantor for tenant negative balances.",
    pattern:
      /\bTenure\s+(?:guarantees|guarantee|will\s+cover|covers|underwrites|backs|absorbs)\b[^.\n]{0,50}\b(?:negative\s+balance|balances?|shortfall|losses?|chargebacks?)\b/i,
    why:
      "Tenure accepting a loss is an approved exception with a pinned digest " +
      "(`assertLiabilityApproved`), not a standing promise.",
    insteadSay:
      "Name the resolved `lossPayer` for the flow, and say when an exception approval is required.",
  },
  {
    id: "tenure-replaces-provider-records",
    bibleCopy: null,
    boundary: "A replacement for provider, bank, network or regulator records.",
    pattern:
      /\bTenure\s+(?:replaces|supersedes|stands\s+in\s+for|is\s+the\s+(?:system\s+of\s+record|authoritative\s+record))\b[^.\n]{0,50}\b(?:provider|bank|network|regulator)\b/i,
    why:
      "Tenure's subledger is evidence beside the provider's records, never instead of them. A " +
      "reconciliation that treats it as authoritative cannot find its own errors.",
    insteadSay: "Say Tenure reconciles TO the provider record and reports the variance.",
  },
  {
    id: "payments-available-globally",
    bibleCopy: "payments available globally",
    boundary:
      "Capability availability is the registry's answer, not a marketing claim (Bible §3, PAY-000-008).",
    pattern:
      /\b(?:payments?|payouts?|cards?)\s+(?:are\s+|is\s+)?(?:available\s+)?(?:globally|worldwide|in\s+every\s+country|everywhere)\b|\bglobal\s+payments?\s+(?:coverage|availability|support)\b/i,
    why:
      "Every capability declares its own country matrix and every leaf is PLANNED or UNSUPPORTED " +
      "today. A global claim is availability inferred from the provider's reach.",
    insteadSay:
      "Render the leaf's declared countries, or the blockers `simulateEligibility` returns.",
  },
]

export interface ProhibitedClaimFinding {
  ruleId: string
  /** The text that matched, verbatim, so a reviewer can see the sentence. */
  matched: string
  /** Character offset of the match in the scanned text. */
  index: number
  boundary: string
  why: string
  insteadSay: string
}

/**
 * Every prohibited claim in one piece of text, in the order they appear.
 *
 * Every rule is evaluated — not the first hit — for the same reason
 * `simulateEligibility` returns every blocker: a writer who fixes one sentence
 * and is handed the next runs the loop once per rule.
 *
 * `matchAll` needs the `g` flag and the rules are declared without it, so each
 * pattern is cloned per call. Sharing one `g` regex across calls carries
 * `lastIndex` forward and makes the second scan of the same text find nothing,
 * which is the failure mode that looks exactly like the text being clean.
 */
export function scanProhibitedClaims(text: string): readonly ProhibitedClaimFinding[] {
  if (typeof text !== "string" || text.length === 0) return []

  const findings: ProhibitedClaimFinding[] = []
  for (const rule of PROHIBITED_CLAIM_RULES) {
    const global = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace("g", "")}g`)
    for (const match of text.matchAll(global)) {
      findings.push({
        ruleId: rule.id,
        matched: match[0],
        index: match.index ?? -1,
        boundary: rule.boundary,
        why: rule.why,
        insteadSay: rule.insteadSay,
      })
    }
  }
  return findings.sort((a, b) => (a.index === b.index ? a.ruleId.localeCompare(b.ruleId) : a.index - b.index))
}

/** One line a reviewer, a blocker list or a lint failure can print. */
export function describeFinding(finding: ProhibitedClaimFinding): string {
  return (
    `${finding.ruleId}: "${finding.matched}" — ${finding.why} Bible §2 boundary: ` +
    `${finding.boundary} Instead: ${finding.insteadSay}`
  )
}
