/**
 * GE-041-005 — how sure we are it is really them, and how recently we were sure.
 *
 * Bible §21.2: "MFA and step-up based on risk and action; strong recovery and
 * enumeration resistance." §9.1 adds "step-up/recent authentication for
 * high-risk actions" and "passkeys/passwordless and adaptive controls when
 * supported".
 *
 * ## Two questions, not one
 *
 * "Has this person stepped up" is the wrong question, and asking it is how
 * step-up degrades into a checkbox. There are two:
 *
 *   1. **How** did they prove it — a password, a second factor, or something
 *      phishing-resistant? A password re-entry proves the session-holder knows
 *      the password, which an attacker with the password also does.
 *   2. **When**? An eight-hour-old proof is a proof about the morning.
 *
 * A policy that only sets a freshness window lets a password re-prompt satisfy
 * an action that needs a security key. One that only sets a level lets a
 * key-tap from this morning authorise a break-glass at midnight.
 *
 * ## One place decides, so there are not three answers
 *
 * Before this, linking a credential required authentication within 10 minutes
 * and a support session required 30, as two bare constants in two packages with
 * nothing saying why they differ. They differ for a good reason — changing how
 * somebody signs in is not the same act as continuing to hold support access —
 * but "for a good reason" has to be written down somewhere, or the next
 * constant is chosen by whoever needs it to be shorter.
 *
 * `REQUIREMENTS` is that somewhere. The differences are still there; they are
 * now a table rather than folklore.
 */

/**
 * What a proof of identity actually demonstrated, weakest first.
 *
 * Ordered, and compared by index rather than by name — a set membership test
 * would make `PHISHING_RESISTANT` fail a requirement for `MFA`, which is
 * backwards and is the classic way this check is written wrong.
 */
export const ASSURANCE_LEVELS = ["NONE", "PASSWORD", "MFA", "PHISHING_RESISTANT"] as const
export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number]

export function meetsLevel(held: AssuranceLevel, required: AssuranceLevel): boolean {
  return ASSURANCE_LEVELS.indexOf(held) >= ASSURANCE_LEVELS.indexOf(required)
}

/**
 * Actions the platform gates on assurance.
 *
 * A closed list, deliberately. An open string would mean a new sensitive action
 * arrives with no requirement and defaults to whatever the code happens to do,
 * which in every system that has tried it is "nothing".
 */
export const GATED_ACTIONS = [
  /** Ordinary use. Named so the absence of a requirement is explicit. */
  "read",
  /** Changing how somebody signs in — link, unlink, recovery method. */
  "credential-change",
  /** Continuing to hold an approved support session (GE-033-003). */
  "support-session",
  /** Break-glass (GE-033-004). */
  "break-glass",
  /** Publishing tenant configuration (GE-031-006). */
  "config-publish",
  /** Anything irreversible: purge, key deletion, tenant closure. */
  "destructive",
] as const
export type GatedAction = (typeof GATED_ACTIONS)[number]

export interface AssuranceRequirement {
  level: AssuranceLevel
  /** How recently the proof must have been given. Null means "at any point". */
  maxAgeMinutes: number | null
  /** Why, in the words the person is shown. */
  because: string
}

/**
 * What each action requires.
 *
 * The two existing constants are here rather than in their own modules:
 * `credential-change` is the 10 minutes `linking.ts` used, `support-session` is
 * the 30 `support-session.ts` used. Same numbers, one table, and the reason
 * they differ is now written next to them.
 */
export const REQUIREMENTS: Readonly<Record<GatedAction, AssuranceRequirement>> = {
  read: {
    level: "PASSWORD",
    maxAgeMinutes: null,
    because: "Ordinary use needs a session, and nothing more.",
  },
  "credential-change": {
    level: "MFA",
    maxAgeMinutes: 10,
    because:
      "Adding or removing a way to sign in is how an account is taken over permanently, so it needs a " +
      "second factor proved in the last few minutes rather than a session that could have been left open.",
  },
  "support-session": {
    level: "MFA",
    maxAgeMinutes: 30,
    because:
      "Support access reaches a customer's data. Thirty minutes rather than ten because the operator is " +
      "working continuously inside an incident, and a ten-minute re-prompt during one is a control people " +
      "route around.",
  },
  "break-glass": {
    level: "PHISHING_RESISTANT",
    maxAgeMinutes: 10,
    because:
      "Break-glass skips the approval another party would have given, so the one remaining control is " +
      "certainty about who is asking. A phishable factor is the one an attacker already has.",
  },
  "config-publish": {
    level: "MFA",
    maxAgeMinutes: 30,
    because: "A published configuration changes what every person in the tenant may do.",
  },
  destructive: {
    level: "PHISHING_RESISTANT",
    maxAgeMinutes: 10,
    because: "This cannot be undone.",
  },
}

export type AssuranceRefusal = "NEVER_PROVED" | "LEVEL_TOO_LOW" | "PROOF_TOO_OLD"

export interface AssuranceSatisfied {
  satisfied: true
}

export interface AssuranceUnsatisfied {
  satisfied: false
  reason: AssuranceRefusal
  /** What would satisfy it, so the caller can prompt for the right thing. */
  required: AssuranceRequirement
  detail: string
}

export type AssuranceOutcome = AssuranceSatisfied | AssuranceUnsatisfied

export interface HeldAssurance {
  level: AssuranceLevel
  /** When it was proved. Null means never. */
  provedAt: string | null
}

/**
 * Whether a session may perform an action.
 *
 * Level is checked before age, deliberately. Someone holding only a password
 * should be told to set up a second factor, not to re-enter their password —
 * and a refusal that says "try again more recently" when the real answer is
 * "you need a security key" sends them round a loop that cannot terminate.
 */
export function assuranceFor(action: GatedAction, held: HeldAssurance, at: Date): AssuranceOutcome {
  const required = REQUIREMENTS[action]

  if (held.level === "NONE" || held.provedAt === null) {
    return {
      satisfied: false,
      reason: "NEVER_PROVED",
      required,
      detail: `${required.because} Sign in again to continue.`,
    }
  }

  if (!meetsLevel(held.level, required.level)) {
    return {
      satisfied: false,
      reason: "LEVEL_TOO_LOW",
      required,
      detail:
        `${required.because} This session was verified with ${held.level.toLowerCase().replace(/_/g, " ")}, ` +
        `and this action needs ${required.level.toLowerCase().replace(/_/g, " ")}.`,
    }
  }

  if (required.maxAgeMinutes !== null) {
    const proved = Date.parse(held.provedAt)
    if (Number.isNaN(proved)) {
      return { satisfied: false, reason: "NEVER_PROVED", required, detail: `${required.because} Sign in again to continue.` }
    }
    if (at.getTime() - proved > required.maxAgeMinutes * 60_000) {
      return {
        satisfied: false,
        reason: "PROOF_TOO_OLD",
        required,
        detail: `${required.because} Confirm it is you to continue.`,
      }
    }
  }

  return { satisfied: true }
}

/**
 * A code sent out of band, to prove control of an address or device.
 *
 * The code itself is never stored on this record — only its digest — so a
 * database read does not hand somebody every outstanding verification.
 */
export interface VerificationChallenge {
  id: string
  /** Digest of the code. Never the code. */
  codeDigest: string
  /** What is being proved. A recovery method, an email, a device. */
  subjectRef: string
  createdAt: string
  expiresAt: string
  /** Set once used. A code is single-use whatever else is true of it. */
  consumedAt: string | null
  attempts: number
}

/** Wrong guesses allowed before the challenge is spent. */
export const MAX_VERIFICATION_ATTEMPTS = 5

export type VerificationRefusal = "EXPIRED" | "ALREADY_USED" | "TOO_MANY_ATTEMPTS" | "INCORRECT"

export interface VerificationOutcome {
  verified: boolean
  /** Null when verified. Never shown verbatim — see `SAFE_VERIFICATION_MESSAGE`. */
  reason: VerificationRefusal | null
  /** The challenge as it should now be stored: attempts incremented, or consumed. */
  next: VerificationChallenge
}

/**
 * One message for every failure.
 *
 * "Expired", "already used" and "incorrect" are three different facts and the
 * difference between them is worth exactly one thing to an attacker: whether
 * they are guessing at a real challenge. The `reason` is for the log.
 */
export const SAFE_VERIFICATION_MESSAGE =
  "That code did not work. Request a new one and try again."

/**
 * Compare two digests without leaking where they differ.
 *
 * `a === b` on strings exits at the first differing byte, and the timing of
 * that exit is measurable across enough attempts. This compares every byte
 * regardless. Length is folded in rather than short-circuited on, for the same
 * reason.
 *
 * Digests, not codes: the caller hashes the submitted code with the same
 * function that produced `codeDigest`. This function does not hash, because a
 * hash chosen here would be one nobody could change without changing every
 * stored challenge.
 */
export function digestsEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let i = 0; i < length; i++) {
    difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0)
  }
  return difference === 0
}

/**
 * Check a submitted code against a challenge.
 *
 * Order matters and is deliberate: consumed and expired are checked before the
 * comparison, so a spent challenge cannot be used as an oracle to grind at the
 * code. The attempt counter increments on a wrong guess and *not* on an expired
 * or consumed one — otherwise an attacker could exhaust somebody's attempts on
 * a challenge that was never usable.
 */
export function verifyChallenge(
  challenge: VerificationChallenge,
  submittedDigest: string,
  at: Date,
): VerificationOutcome {
  if (challenge.consumedAt !== null) {
    return { verified: false, reason: "ALREADY_USED", next: challenge }
  }

  const expires = Date.parse(challenge.expiresAt)
  if (Number.isNaN(expires) || at.getTime() >= expires) {
    return { verified: false, reason: "EXPIRED", next: challenge }
  }

  if (challenge.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    return { verified: false, reason: "TOO_MANY_ATTEMPTS", next: challenge }
  }

  if (!digestsEqual(challenge.codeDigest, submittedDigest)) {
    return {
      verified: false,
      reason: "INCORRECT",
      next: { ...challenge, attempts: challenge.attempts + 1 },
    }
  }

  return {
    verified: true,
    reason: null,
    // Consumed in the returned record, so a caller that persists the outcome
    // cannot accidentally leave a used code usable.
    next: { ...challenge, consumedAt: at.toISOString() },
  }
}
