import {
  ASSURANCE_LEVELS,
  GATED_ACTIONS,
  LINK_STEP_UP_MINUTES,
  MAX_VERIFICATION_ATTEMPTS,
  REQUIREMENTS,
  SAFE_VERIFICATION_MESSAGE,
  assuranceFor,
  digestsEqual,
  meetsLevel,
  verifyChallenge,
  type HeldAssurance,
  type VerificationChallenge,
} from "./index"

/**
 * GE-041-005 — how sure we are it is really them, and how recently we were sure.
 *
 * "Has this person stepped up" is the wrong question, and asking it is how
 * step-up degrades into a checkbox. There are two — how did they prove it, and
 * when — and a policy that answers only one of them fails in a specific,
 * predictable way.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString()

const held = (over: Partial<HeldAssurance> = {}): HeldAssurance => ({
  level: "MFA",
  provedAt: minutesAgo(1),
  ...over,
})

describe("assurance levels are ordered, not a set", () => {
  it("accepts a stronger factor than the one required", () => {
    // A set membership test would make PHISHING_RESISTANT fail a requirement
    // for MFA, which is backwards and is the classic way this is written wrong.
    expect(meetsLevel("PHISHING_RESISTANT", "MFA")).toBe(true)
    expect(meetsLevel("MFA", "MFA")).toBe(true)
    expect(meetsLevel("PASSWORD", "MFA")).toBe(false)
    expect(meetsLevel("NONE", "PASSWORD")).toBe(false)
  })

  it("orders every level it declares", () => {
    for (let i = 1; i < ASSURANCE_LEVELS.length; i++) {
      expect(meetsLevel(ASSURANCE_LEVELS[i], ASSURANCE_LEVELS[i - 1])).toBe(true)
      expect(meetsLevel(ASSURANCE_LEVELS[i - 1], ASSURANCE_LEVELS[i])).toBe(false)
    }
  })
})

describe("both questions are asked, not one", () => {
  it("refuses a password re-entry for an action needing a second factor", () => {
    // A policy that only sets a freshness window lets a password re-prompt
    // satisfy an action that needs a security key.
    const outcome = assuranceFor("credential-change", held({ level: "PASSWORD" }), NOW)
    expect(outcome.satisfied).toBe(false)
    if (outcome.satisfied) return
    expect(outcome.reason).toBe("LEVEL_TOO_LOW")
  })

  it("refuses a strong factor proved too long ago", () => {
    // And one that only sets a level lets a key-tap from this morning
    // authorise a break-glass at midnight.
    const outcome = assuranceFor("break-glass", held({ level: "PHISHING_RESISTANT", provedAt: minutesAgo(30) }), NOW)
    expect(outcome.satisfied).toBe(false)
    if (outcome.satisfied) return
    expect(outcome.reason).toBe("PROOF_TOO_OLD")
  })

  it("checks the level before the age", () => {
    // Someone holding only a password should be told to set up a second
    // factor, not to re-enter their password. A refusal saying "try again more
    // recently" when the answer is "you need a security key" sends them round
    // a loop that cannot terminate.
    const outcome = assuranceFor("break-glass", held({ level: "PASSWORD", provedAt: minutesAgo(600) }), NOW)
    expect(outcome.satisfied).toBe(false)
    if (outcome.satisfied) return
    expect(outcome.reason).toBe("LEVEL_TOO_LOW")
  })

  it("reports never-proved separately from too-old", () => {
    for (const nothing of [held({ provedAt: null }), held({ level: "NONE" })]) {
      const outcome = assuranceFor("credential-change", nothing, NOW)
      expect(outcome.satisfied).toBe(false)
      if (outcome.satisfied) return
      expect(outcome.reason).toBe("NEVER_PROVED")
    }
  })

  it("satisfies an action when both hold", () => {
    expect(assuranceFor("credential-change", held(), NOW)).toEqual({ satisfied: true })
  })

  it("tells the caller what would satisfy it", () => {
    // So the caller can prompt for the right thing rather than guessing.
    const outcome = assuranceFor("break-glass", held({ level: "PASSWORD" }), NOW)
    expect(outcome.satisfied).toBe(false)
    if (outcome.satisfied) return
    expect(outcome.required.level).toBe("PHISHING_RESISTANT")
    expect(outcome.required.maxAgeMinutes).toBe(10)
  })
})

describe("one table decides, so there are not three answers", () => {
  it("gives every gated action a requirement", () => {
    // An open action list would mean a new sensitive action arrives with no
    // requirement and defaults to whatever the code happens to do.
    for (const action of GATED_ACTIONS) {
      expect(REQUIREMENTS[action]).toBeDefined()
      expect(REQUIREMENTS[action].because.length).toBeGreaterThan(20)
    }
  })

  it("is where linking's window now comes from", () => {
    // It was a bare 10 next to a bare 30 in another package, with nothing
    // saying why they differ.
    expect(LINK_STEP_UP_MINUTES).toBe(REQUIREMENTS["credential-change"].maxAgeMinutes)
  })

  it("requires phishing resistance for anything irreversible", () => {
    for (const action of ["break-glass", "destructive"] as const) {
      expect(REQUIREMENTS[action].level).toBe("PHISHING_RESISTANT")
    }
  })

  it("lets ordinary reading through on a session alone", () => {
    // A policy that gated reads would be turned off within a week.
    expect(assuranceFor("read", held({ level: "PASSWORD", provedAt: minutesAgo(400) }), NOW)).toEqual({
      satisfied: true,
    })
  })

  it("gives support sessions a longer window than credential changes, on purpose", () => {
    // The operator is working continuously inside an incident, and a
    // ten-minute re-prompt during one is a control people route around.
    expect(REQUIREMENTS["support-session"].maxAgeMinutes).toBeGreaterThan(
      REQUIREMENTS["credential-change"].maxAgeMinutes!,
    )
  })
})

describe("comparing a code does not leak where it differs", () => {
  it("matches identical digests", () => {
    expect(digestsEqual("abc123", "abc123")).toBe(true)
  })

  it("rejects a difference anywhere, including the first byte and the last", () => {
    expect(digestsEqual("abc123", "zbc123")).toBe(false)
    expect(digestsEqual("abc123", "abc124")).toBe(false)
  })

  it("rejects differing lengths without short-circuiting on them", () => {
    expect(digestsEqual("abc", "abcd")).toBe(false)
    expect(digestsEqual("abcd", "abc")).toBe(false)
    expect(digestsEqual("", "a")).toBe(false)
  })

  it("rejects a trailing NUL, which the loop alone treats as absent", () => {
    // The length XOR is not redundant, and this is the case that proves it.
    // Out-of-range `charCodeAt` is NaN, folded to 0 by `|| 0`, so a trailing
    // U+0000 XORs against the absent position to zero and the two compare
    // equal. Folding the lengths in is what closes that.
    //
    // A mutation removing the length term survived until this existed — the
    // other length cases all differ in a non-zero byte and never reach it.
    expect(digestsEqual("abc", "abc\u0000")).toBe(false)
    expect(digestsEqual("abc\u0000", "abc")).toBe(false)
  })

  it("compares every byte regardless of where the first difference is", () => {
    // The property, asserted the only way it can be from inside: the function
    // has no early return. A `===` exits at the first differing byte and the
    // timing of that exit is measurable across enough attempts.
    const source = digestsEqual.toString()
    expect(source).not.toMatch(/return\s+false/)
    expect(source).toMatch(/\|=/)
  })
})

describe("a verification code is single-use, expiring and attempt-limited", () => {
  const challenge = (over: Partial<VerificationChallenge> = {}): VerificationChallenge => ({
    id: "chal-1",
    codeDigest: "digest-of-482913",
    subjectRef: "recovery:rec-1",
    createdAt: minutesAgo(2),
    expiresAt: new Date(NOW.getTime() + 8 * 60_000).toISOString(),
    consumedAt: null,
    attempts: 0,
    ...over,
  })

  it("verifies a correct code and marks it consumed in the returned record", () => {
    // Consumed in the return, so a caller that persists the outcome cannot
    // accidentally leave a used code usable.
    const outcome = verifyChallenge(challenge(), "digest-of-482913", NOW)
    expect(outcome.verified).toBe(true)
    expect(outcome.next.consumedAt).toBe(NOW.toISOString())
  })

  it("refuses a code that was already used", () => {
    const outcome = verifyChallenge(challenge({ consumedAt: minutesAgo(1) }), "digest-of-482913", NOW)
    expect(outcome.verified).toBe(false)
    expect(outcome.reason).toBe("ALREADY_USED")
  })

  it("refuses an expired code even when it is correct", () => {
    const outcome = verifyChallenge(challenge({ expiresAt: minutesAgo(1) }), "digest-of-482913", NOW)
    expect(outcome.verified).toBe(false)
    expect(outcome.reason).toBe("EXPIRED")
  })

  it("counts a wrong guess", () => {
    expect(verifyChallenge(challenge(), "wrong", NOW).next.attempts).toBe(1)
  })

  it("stops accepting guesses once the limit is reached", () => {
    const spent = challenge({ attempts: MAX_VERIFICATION_ATTEMPTS })
    const outcome = verifyChallenge(spent, "digest-of-482913", NOW)
    expect(outcome.verified).toBe(false)
    expect(outcome.reason).toBe("TOO_MANY_ATTEMPTS")
  })

  it("does not spend an attempt on a challenge that was never usable", () => {
    // Otherwise an attacker exhausts somebody's attempts against an expired or
    // consumed challenge and locks them out of a code they could have used.
    expect(verifyChallenge(challenge({ expiresAt: minutesAgo(1) }), "wrong", NOW).next.attempts).toBe(0)
    expect(verifyChallenge(challenge({ consumedAt: minutesAgo(1) }), "wrong", NOW).next.attempts).toBe(0)
  })

  it("checks consumed and expired before comparing, so a spent code is not an oracle", () => {
    // A correct code against a consumed challenge must not report INCORRECT or
    // anything else that distinguishes it from a wrong one.
    const consumed = challenge({ consumedAt: minutesAgo(1) })
    expect(verifyChallenge(consumed, "digest-of-482913", NOW).reason).toBe(
      verifyChallenge(consumed, "definitely-wrong", NOW).reason,
    )
  })

  it("has one message for every failure", () => {
    // Expired, already used and incorrect are three facts, and the difference
    // is worth exactly one thing to an attacker: whether they are guessing at
    // a real challenge.
    expect(SAFE_VERIFICATION_MESSAGE).toMatch(/did not work/)
    expect(SAFE_VERIFICATION_MESSAGE).not.toMatch(/expired|used|incorrect/i)
  })

  it("keeps the distinct reasons for the log", () => {
    const reasons = [
      verifyChallenge(challenge({ consumedAt: minutesAgo(1) }), "x", NOW).reason,
      verifyChallenge(challenge({ expiresAt: minutesAgo(1) }), "x", NOW).reason,
      verifyChallenge(challenge({ attempts: MAX_VERIFICATION_ATTEMPTS }), "x", NOW).reason,
      verifyChallenge(challenge(), "x", NOW).reason,
    ]
    expect(new Set(reasons).size).toBe(4)
  })

  it("never carries the code itself on the record", () => {
    // A database read must not hand somebody every outstanding verification.
    expect(Object.keys(challenge())).not.toContain("code")
  })
})
