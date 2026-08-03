import { AUTHENTICATION_OUTCOMES, type AuthenticationOutcome } from "./entities"

/**
 * GE-042-007 — the sign-in page tells everybody the same thing.
 *
 * Bible §9.1: "strong recovery and **enumeration resistance**."
 *
 * The engine already names four ways authentication fails —
 * `FAILED_CREDENTIAL`, `FAILED_NO_MEMBERSHIP`, `FAILED_SUSPENDED`,
 * `FAILED_CONNECTION_DISABLED` — and each is a different fact that somebody
 * needs. The mistake is showing which one to the browser. "No account with that
 * address" answers *is this person here* for anybody who asks, one address at a
 * time, and a school's address format is guessable. "Your account is suspended"
 * is worse: it confirms the account exists **and** volunteers its state to
 * whoever is holding the credential, who at that moment is more likely to be
 * the attacker than the owner.
 *
 * So every failure produces one message, byte for byte, and the real reason
 * goes to the audit record. Support can answer "why can I not sign in?" from
 * the correlation id the page shows; the page itself knows nothing.
 *
 * ## This is the opposite of GE-042-006, deliberately
 *
 * `accessState` distinguishes suspended from revoked from never-placed, and
 * that is right, because it runs **after** somebody has proved who they are.
 * The person reading it is the account holder. Here nobody has proved anything
 * yet, so every sentence is addressed to an unknown party.
 *
 * The line between the two is authentication, and it is the only line that
 * matters: before it, say nothing; after it, say everything useful.
 */

/**
 * The one sentence.
 *
 * It names no condition — not the credential, not the account, not the
 * organization — because naming any of them is the disclosure. It does say what
 * to do next, since a message that resists enumeration and also strands the
 * legitimate person has solved the smaller problem.
 */
export const SIGN_IN_FAILED_MESSAGE =
  "We could not sign you in. Check the details and try again, or ask your organization's administrator for help."

export interface SignInFailure {
  /** Shown to the person. Identical for every reason. */
  message: string
  /**
   * Shown to the person so support can find the real reason.
   *
   * Supplied by the caller and never derived from the outcome — an id that
   * encoded the reason would be the disclosure wearing a hex string.
   */
  correlationId: string
  /** Recorded server-side, never sent to the browser. */
  audit: {
    outcome: AuthenticationOutcome
    detail: string
  }
}

export class NotAFailureError extends Error {
  constructor(outcome: AuthenticationOutcome) {
    super(
      `${outcome} is not a failure. Building a sign-in failure from it would show "could not sign you in" ` +
        `to somebody who just did — and the audit record would say the opposite of what happened.`,
    )
    this.name = "NotAFailureError"
  }
}

const SUCCESSFUL: ReadonlySet<AuthenticationOutcome> = new Set<AuthenticationOutcome>([
  "SUCCEEDED",
  "STEP_UP_SUCCEEDED",
])

/** Every outcome that is a failure. Derived, so a new outcome is covered by default. */
export const FAILURE_OUTCOMES: readonly AuthenticationOutcome[] = AUTHENTICATION_OUTCOMES.filter(
  (outcome) => !SUCCESSFUL.has(outcome),
)

/**
 * Turn a specific failure into a generic one, keeping the specific one.
 *
 * Refuses a success rather than passing it through. The pass-through is the
 * dangerous default: a caller that mixed up its branches would show a failure
 * to somebody who authenticated, and the record would say they did not.
 */
export function signInFailure(input: {
  outcome: AuthenticationOutcome
  correlationId: string
  detail?: string
}): SignInFailure {
  if (SUCCESSFUL.has(input.outcome)) throw new NotAFailureError(input.outcome)

  return {
    message: SIGN_IN_FAILED_MESSAGE,
    correlationId: input.correlationId,
    audit: {
      outcome: input.outcome,
      // The detail is for the audit record only. Defaulting it to the outcome
      // keeps a caller that omitted it from writing an empty reason, which is
      // the record that looks complete and answers nothing.
      detail: input.detail ?? input.outcome,
    },
  }
}

/**
 * Words that would give the game away.
 *
 * Single terms, not phrases. The first version listed "incorrect password" and
 * "wrong password" and let *"That password is incorrect"* through — the same
 * disclosure in a different word order, and the word order a real message is
 * more likely to use. Any list of phrasings is a list somebody writes around
 * without meaning to.
 *
 * So these are the nouns and states that identify **which check failed**:
 * naming the credential says the account exists, and naming a lifecycle state
 * says both that it exists and what is wrong with it. A pre-authentication
 * message needs none of them.
 *
 * Exported so the guard in `tests/security/` checks the same list this module
 * was written against, rather than a second copy that drifts.
 */
export const DISCLOSING_TERMS = [
  "password",
  "passphrase",
  "credential",
  "suspended",
  "revoked",
  "disabled",
  "locked",
  "expired",
  "member",
  "membership",
  "not found",
  "does not exist",
  "unknown",
  "no account",
  "incorrect",
  "invalid",
] as const

/** Whether a message aimed at an unauthenticated visitor discloses a condition. */
export function disclosesCondition(message: string): boolean {
  const text = message.toLowerCase()
  return DISCLOSING_TERMS.some((term) => text.includes(term))
}
