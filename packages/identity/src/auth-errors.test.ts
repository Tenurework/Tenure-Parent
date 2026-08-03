import {
  AUTHENTICATION_OUTCOMES,
  DISCLOSING_TERMS,
  FAILURE_OUTCOMES,
  NotAFailureError,
  SIGN_IN_FAILED_MESSAGE,
  disclosesCondition,
  signInFailure,
  type AuthenticationOutcome,
} from "./index"

/**
 * GE-042-007 — enumeration resistance, asserted rather than intended.
 *
 * The engine names four ways authentication fails. Each is a different fact
 * somebody needs, and showing which one to the browser answers "is this person
 * here" for anybody who asks.
 */

describe("every failure looks the same from outside", () => {
  it("produces one message for every failing outcome", () => {
    // Byte-identical, not merely similar. "No account with that address" and
    // "That password is incorrect" differ by one word and by everything.
    const messages = new Set(
      FAILURE_OUTCOMES.map((outcome) => signInFailure({ outcome, correlationId: "c" }).message),
    )
    expect(messages.size).toBe(1)
    expect([...messages][0]).toBe(SIGN_IN_FAILED_MESSAGE)
  })

  it("covers more than one outcome, so the assertion above is not trivial", () => {
    // A set of one message is guaranteed if there is one outcome.
    expect(FAILURE_OUTCOMES.length).toBeGreaterThan(3)
    expect(FAILURE_OUTCOMES).toContain("FAILED_CREDENTIAL")
    expect(FAILURE_OUTCOMES).toContain("FAILED_NO_MEMBERSHIP")
    expect(FAILURE_OUTCOMES).toContain("FAILED_SUSPENDED")
  })

  it("never names the condition in the message", () => {
    for (const outcome of FAILURE_OUTCOMES) {
      const failure = signInFailure({ outcome, correlationId: "c", detail: "suspended since June" })
      expect(disclosesCondition(failure.message)).toBe(false)
      expect(failure.message.toLowerCase()).not.toContain(outcome.toLowerCase())
    }
  })

  it("does not leak the detail into the message", () => {
    // The detail is the useful sentence and the dangerous one. It belongs in
    // the audit record and nowhere the browser can read.
    const failure = signInFailure({
      outcome: "FAILED_SUSPENDED",
      correlationId: "c",
      detail: "person suspended platform-wide on 2026-07-30",
    })
    expect(failure.message).not.toContain("2026-07-30")
    expect(failure.message).not.toContain("suspended")
  })

  it("still tells the person what to do", () => {
    // A message that resists enumeration and strands the legitimate person has
    // solved the smaller problem.
    expect(SIGN_IN_FAILED_MESSAGE).toMatch(/try again/i)
    expect(SIGN_IN_FAILED_MESSAGE).toMatch(/administrator/i)
  })
})

describe("the specific reason survives, out of sight", () => {
  it("keeps the outcome in the audit record", () => {
    const failure = signInFailure({ outcome: "FAILED_NO_MEMBERSHIP", correlationId: "c" })
    expect(failure.audit.outcome).toBe("FAILED_NO_MEMBERSHIP")
  })

  it("keeps the detail the caller supplied", () => {
    const failure = signInFailure({
      outcome: "FAILED_CONNECTION_DISABLED",
      correlationId: "c",
      detail: "connection okta-rochester disabled by operator",
    })
    expect(failure.audit.detail).toBe("connection okta-rochester disabled by operator")
  })

  it("falls back to the outcome rather than recording nothing", () => {
    // An empty reason is the record that looks complete and answers nothing.
    const failure = signInFailure({ outcome: "FAILED_CREDENTIAL", correlationId: "c" })
    expect(failure.audit.detail).toBe("FAILED_CREDENTIAL")
    expect(failure.audit.detail.length).toBeGreaterThan(0)
  })
})

describe("the correlation id is a handle, not a hint", () => {
  it("is carried through exactly as given", () => {
    const failure = signInFailure({ outcome: "FAILED_SUSPENDED", correlationId: "req-7f3a91" })
    expect(failure.correlationId).toBe("req-7f3a91")
  })

  it("does not vary with the outcome", () => {
    // An id derived from the reason is the disclosure wearing a hex string:
    // two attempts, two different ids, and the caller learns they differ.
    const ids = new Set(
      FAILURE_OUTCOMES.map((outcome) => signInFailure({ outcome, correlationId: "same" }).correlationId),
    )
    expect(ids.size).toBe(1)
    expect([...ids][0]).toBe("same")
  })
})

describe("a success is not a failure", () => {
  it("refuses SUCCEEDED", () => {
    // The pass-through is the dangerous default: a caller that mixed up its
    // branches would show "could not sign you in" to somebody who just did,
    // and the audit record would say the opposite of what happened.
    expect(() => signInFailure({ outcome: "SUCCEEDED", correlationId: "c" })).toThrow(NotAFailureError)
  })

  it("refuses STEP_UP_SUCCEEDED", () => {
    expect(() => signInFailure({ outcome: "STEP_UP_SUCCEEDED", correlationId: "c" })).toThrow(
      NotAFailureError,
    )
  })

  it("accepts every other outcome, so the refusals are not blanket", () => {
    for (const outcome of FAILURE_OUTCOMES) {
      expect(() => signInFailure({ outcome, correlationId: "c" })).not.toThrow()
    }
  })

  it("partitions the outcomes with nothing left over", () => {
    // A new outcome added to the engine lands in one side or the other. If it
    // lands in neither, this fails rather than the new outcome silently
    // becoming un-reportable.
    const successful = AUTHENTICATION_OUTCOMES.filter(
      (outcome: AuthenticationOutcome) => !FAILURE_OUTCOMES.includes(outcome),
    )
    expect(successful.length + FAILURE_OUTCOMES.length).toBe(AUTHENTICATION_OUTCOMES.length)
    expect(successful).toEqual(["SUCCEEDED", "STEP_UP_SUCCEEDED"])
  })
})

describe("the disclosure detector", () => {
  it("recognises the sentences people actually write", () => {
    // Asserted on the detector because its failure mode is silence: one that
    // matches nothing reports every message as safe.
    expect(disclosesCondition("No account with that email address.")).toBe(true)
    expect(disclosesCondition("That password is incorrect.")).toBe(true)
    expect(disclosesCondition("Your account has been suspended.")).toBe(true)
    expect(disclosesCondition("You are not a member of this organization.")).toBe(true)
  })

  it("is case-insensitive, because sentences start with capitals", () => {
    expect(disclosesCondition("SUSPENDED")).toBe(true)
  })

  it("catches the same disclosure in a different word order", () => {
    // The first version of the list held phrases — "incorrect password",
    // "wrong password" — and let this through, which is the word order a real
    // message is more likely to use.
    expect(disclosesCondition("That password is incorrect.")).toBe(true)
    expect(disclosesCondition("Incorrect password.")).toBe(true)
    expect(disclosesCondition("The credential supplied was not valid.")).toBe(true)
  })

  it("does not fire on the message this module ships", () => {
    // If it did, somebody would relax the detector rather than fix a finding.
    expect(disclosesCondition(SIGN_IN_FAILED_MESSAGE)).toBe(false)
  })

  it("lists terms rather than one", () => {
    expect(DISCLOSING_TERMS.length).toBeGreaterThan(5)
  })
})
