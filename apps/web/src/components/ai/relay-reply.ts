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
 */

export interface RelayReplyInput {
  /** The generated prose, when there is any. */
  answer: string | null
  /** The route's `available`: flag on AND a key configured AND the tool offered. */
  aiEnabled: boolean
  /** Non-null when this tenant switched the assistant off; the flag's own reason. */
  aiDisabledReason: string | null
  /** Non-null when this principal may not run the retrieval tool; the engine's reason. */
  toolRefusal: string | null
  /** How many ranked sources the route returned. */
  sourceCount: number
}

export type RelayOutcome =
  | "answered"
  /** The tenant's `aiAssistant` flag is off. */
  | "assistant-disabled"
  /** This principal, or this system, may not run `search.corpus`. */
  | "retrieval-refused"
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
 */
export function relayReply(input: RelayReplyInput): RelayReply {
  if (input.answer !== null && input.answer.trim() !== "") {
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
