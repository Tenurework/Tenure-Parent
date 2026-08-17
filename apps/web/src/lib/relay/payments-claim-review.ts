import { scanProhibitedClaims } from "@tenure/payments/gateway"

/**
 * PAY-000-004 — the content review Relay's own answers go through.
 *
 * Bible §2 forbids five pieces of product copy about payments, and a language
 * model produces every one of them unprompted: each is the fluent English answer
 * to "where is my club's money". A static lint cannot reach a sentence that is
 * written per request, so the rules have to run on the way out.
 *
 * ## Why this is a lib module and not two lines in `relay-reply.ts`
 *
 * `apps/web/src/components/ai/relay-reply.ts` is a SHELL module, and
 * `tests/architecture/shell-separation.test.mjs` refuses a shell module that
 * imports anything outside `apps/web` — a component reaching a package is how
 * the tenant shell and the operator shell converge on one file (TTES-000-002).
 * The first version of this check imported `@tenure/payments/gateway` from the
 * component and turned that guard red. So the package import lives here, in the
 * same place and for the same reason `apps/web/src/lib/finance.ts` holds the
 * other consumer of the payments port.
 *
 * ## Withheld, not redacted
 *
 * Deleting the offending clause leaves a sentence whose subject has changed and
 * whose remaining half still reads as an assurance — "until the payout runs on
 * Friday" is worse on its own than in the false sentence it came from. So the
 * answer is dropped whole and the reader is told an answer was written, that it
 * made a claim that is not true of Tenure, and which claim it was.
 */
export interface PaymentsClaimReview {
  /** True when the answer may not be shown. */
  withheld: boolean
  /** The rules that fired, most useful first. Empty when nothing did. */
  ruleIds: readonly string[]
  /** What to show instead, or null when there is nothing to withhold. */
  message: string | null
}

export function reviewPaymentsClaims(answer: string): PaymentsClaimReview {
  const findings = scanProhibitedClaims(answer)
  if (findings.length === 0) return { withheld: false, ruleIds: [], message: null }

  // Each rule's own `why` — the reason the sentence is false, not a generic
  // "that can't be shown". A refusal that does not say what was wrong sends the
  // reader to ask the question again in different words.
  const reasons = [...new Set(findings.map((finding) => finding.why))].join(" ")

  return {
    withheld: true,
    ruleIds: [...new Set(findings.map((finding) => finding.ruleId))],
    message:
      `I wrote an answer and did not show it: it made a claim about payments that is not true of ` +
      `Tenure — ${reasons} Ask an administrator for the exact arrangement rather than relying on ` +
      `this.`,
  }
}
