/**
 * TTES-020-002 — what Relay says when it has no answer, decided once.
 *
 * `/api/ai/chat` already distinguishes four outcomes and returns the facts for
 * each. The panel used to type the response as `{ answer, aiEnabled, sources }`
 * and drop the other two on the floor, so both refusals fell through the same
 * two-branch ladder and both came out wrong:
 *
 *   * a tenant that deliberately switched the assistant off was told "AI
 *     answers aren't set up for this workspace yet" — as if nobody had got
 *     round to it, rather than as if an administrator had made a decision;
 *   * a principal refused the `search.corpus` tool was told "I couldn't find
 *     anything about that in your workspace", which is a false statement about
 *     their own data. Nothing was searched. The route's own header says
 *     collapsing these "would tell at least one person something false".
 *
 * A pure module rather than an inline ladder so the four outcomes are testable
 * without a browser, and so the ordering — refusal before absence — is written
 * down in one place. `TenureAIPanel` is the production caller.
 *
 * PAY-000-004 added a sixth outcome, `claim-refused`, above the answer branch:
 * the payments copy Bible §2 prohibits is what a model reaches for when asked
 * where a club's money is, and this is the only place in the repository where
 * vendor prose becomes product text.
 */

import { reviewPaymentsClaims } from "@/lib/relay/payments-claim-review"

export interface RelayReplyInput {
  /** The generated prose, when there is any. */
  answer: string | null
  /** The route's `available`: flag on AND a key configured AND the tool offered. */
  aiEnabled: boolean
  /** Non-null when this tenant switched the assistant off; the flag's own reason. */
  aiDisabledReason: string | null
  /** Non-null when this principal may not run the retrieval tool; the engine's reason. */
  toolRefusal: string | null
  /**
   * WRK-GATE-070. Non-null when the vendor DID produce an answer and the route
   * discarded it for citing a source that was not offered.
   *
   * Required, not optional, and that is the point: the route has emitted this
   * field since the citation check landed, and this module's whole reason for
   * existing is that a response field nobody typed is a response field nobody
   * reads. An optional one would compile at `TenureAIPanel` untouched and leave
   * the ladder below giving the answer at the bottom — "Tenure AI couldn't
   * generate an answer just now" — which is false twice over: it did generate
   * one, and the reason it is not on screen is not transient.
   */
  citationRefusal: string | null
  /** How many ranked sources the route returned. */
  sourceCount: number
}

export type RelayOutcome =
  | "answered"
  /** The tenant's `aiAssistant` flag is off. */
  | "assistant-disabled"
  /** This principal, or this system, may not run `search.corpus`. */
  | "retrieval-refused"
  /** The model answered, and cited a source that was never offered. */
  | "citation-refused"
  /**
   * PAY-000-004. The model answered, and the answer made one of the payments
   * claims Bible §2 prohibits — see `PROHIBITED_CLAIM_RULES`. Separate from
   * `citation-refused` because the fault is different: the sentence may be
   * perfectly well sourced and still be legally false about who holds money.
   */
  | "claim-refused"
  /** Nobody has configured a model in this cell. */
  | "unconfigured"

export interface RelayReply {
  outcome: RelayOutcome
  /** What the transcript shows. Never claims a search that did not happen. */
  message: string
  /** Whether the ranked sources below the message are worth showing. */
  showSources: boolean
}

/**
 * Order matters and is the whole point.
 *
 * `toolRefusal` is checked BEFORE the sources, because a refused retrieval
 * returns zero sources and the zero-sources branch reads "I couldn't find
 * anything" — the exact false statement this function exists to stop. And
 * `aiDisabledReason` is checked before "no key", because a tenant that turned
 * the vendor off has not failed to configure anything.
 *
 * `citationRefusal` (WRK-GATE-070) sits above both of the "nothing was
 * configured / switched off" branches for the same reason: it is the only one
 * of the five that describes a vendor call that actually happened, and the
 * bottom branch it would otherwise fall into calls that a transient failure.
 */
export function relayReply(input: RelayReplyInput): RelayReply {
  if (input.answer !== null && input.answer.trim() !== "") {
    // PAY-000-004, and it is FIRST because it is the only branch that inspects
    // text a vendor wrote. Bible §2 forbids five specific pieces of product
    // copy, and a language model produces every one of them unprompted, because
    // each is the fluent way to describe the feature. A static lint cannot reach
    // a sentence that is generated per request, so the rules run here.
    //
    // The rules themselves live in `@/lib/relay/payments-claim-review`, not
    // here: a shell module may not import a package (TTES-000-002, enforced by
    // `tests/architecture/shell-separation.test.mjs`), and the rules are a
    // package.
    const claims = reviewPaymentsClaims(input.answer)
    if (claims.withheld && claims.message !== null) {
      return {
        outcome: "claim-refused",
        message: claims.message,
        // The retrieved sources are real and unaffected by what the model wrote
        // about them, and they are the honest remainder.
        showSources: input.sourceCount > 0,
      }
    }
    return { outcome: "answered", message: input.answer, showSources: input.sourceCount > 0 }
  }

  if (input.toolRefusal) {
    return {
      outcome: "retrieval-refused",
      // Says nothing about what is or is not in the workspace: nothing was
      // looked at. It names the reason the engine gave instead.
      message: `I wasn't able to search your workspace for this. ${input.toolRefusal}`,
      showSources: false,
    }
  }

  // WRK-GATE-070. Before every remaining branch, because every remaining branch
  // describes a call that did not happen. This one describes a call that did:
  // the vendor answered, the answer cited a record that was not retrieved, and
  // the route dropped it. Reaching the bottom of this ladder instead would tell
  // the reader a transient failure occurred, which would send them to retry the
  // one thing that is not going to help — and, worse, would hide that a model
  // fabricated a citation, which is the fact somebody needs to know.
  if (input.citationRefusal) {
    return {
      outcome: "citation-refused",
      message:
        `I wrote an answer and did not show it: it cited a source that was not among the ones ` +
        `retrieved for you, so nothing in it could be checked against a record you can open. ` +
        `${input.citationRefusal}`,
      // The sources are real and were genuinely matched — they are the honest
      // remainder, and showing them is what makes this a degradation rather
      // than a dead end.
      showSources: input.sourceCount > 0,
    }
  }

  if (input.aiDisabledReason) {
    return {
      outcome: "assistant-disabled",
      message: input.sourceCount
        ? `Tenure AI is switched off for this workspace, so there is no written answer. ${input.aiDisabledReason} These are the most relevant items:`
        : `Tenure AI is switched off for this workspace, so there is no written answer. ${input.aiDisabledReason}`,
      showSources: input.sourceCount > 0,
    }
  }

  if (!input.aiEnabled) {
    return {
      outcome: "unconfigured",
      message: input.sourceCount
        ? "No model is connected for this workspace, so I can't write an answer — but these are the most relevant items:"
        : "No model is connected for this workspace, so I can't write an answer.",
      showSources: input.sourceCount > 0,
    }
  }

  // Enabled, allowed, configured — and the model still returned nothing. A
  // transient vendor failure, which is a different sentence again.
  return {
    outcome: "answered",
    message: input.sourceCount
      ? "Tenure AI couldn't generate an answer just now — here are the most relevant items in your workspace:"
      : "Tenure AI couldn't generate an answer just now, and I didn't find anything matching in your workspace.",
    showSources: input.sourceCount > 0,
  }
}
