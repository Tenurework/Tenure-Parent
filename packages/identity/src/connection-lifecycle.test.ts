import {
  applyConnectionAction,
  connectionServesSignIn,
  hasStagedChange,
  servingConfigurationId,
  verificationKeys,
  type Connection,
  type SigningKey,
  type TransitionOutcome,
  type TransitionRefusal,
} from "./index"

/**
 * GE-043-001 — the lifecycle exists so a tenant cannot lock itself out.
 *
 * Somebody pastes an identity provider's metadata into a form, saves, and the
 * tenant's entire staff cannot sign in. The people who could fix it are the
 * people locked out. Every rule here is one step of that path made impossible.
 */

const NOW = new Date("2026-08-03T12:00:00Z")
const iso = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

const key = (over: Partial<SigningKey> = {}): SigningKey => ({
  id: "key-1",
  certificate: "MIID...",
  notAfter: iso(365),
  retiredAt: null,
  ...over,
})

const connection = (over: Partial<Connection> = {}): Connection => ({
  id: "conn-1",
  tenantId: "rochester",
  state: "DRAFT",
  configurationId: "cfg-1",
  activeConfigurationId: null,
  previousConfigurationId: null,
  signingKeys: [key()],
  lastTest: null,
  ...over,
})

const accepted = (outcome: TransitionOutcome): Connection => {
  if (!outcome.ok) throw new Error(`expected an accepted transition, got ${outcome.reason}: ${outcome.detail}`)
  return outcome.connection
}

const refusedBecause = (outcome: TransitionOutcome, reason: TransitionRefusal) => {
  expect(outcome.ok).toBe(false)
  if (outcome.ok) throw new Error("expected a refusal")
  expect(outcome.reason).toBe(reason)
  expect(outcome.detail.length).toBeGreaterThan(20)
}

describe("nothing goes live without evidence that it works", () => {
  it("refuses to activate a connection that was never tested", () => {
    refusedBecause(
      applyConnectionAction(connection({ state: "TESTED" }), "ACTIVATE", { at: NOW }),
      "NO_PASSING_TEST",
    )
  })

  it("refuses to activate on a failed test", () => {
    // A failed test leaves the connection VALIDATED, and ACTIVATE is reachable
    // from there — the refusal has to come from the evidence, not the state
    // name, or an operator is told "wrong state" when the answer is "your test
    // failed".
    const tested = accepted(
      applyConnectionAction(connection({ state: "VALIDATED" }), "TEST", { at: NOW, testSucceeded: false }),
    )
    refusedBecause(applyConnectionAction(tested, "ACTIVATE", { at: NOW }), "NO_PASSING_TEST")
  })

  it("refuses to activate on a test of a different configuration", () => {
    // The clause that matters. A test proving an *older* configuration works is
    // not evidence about this one, and treating it as such is exactly how a
    // "tested" connection breaks on activation.
    const stale = connection({
      state: "TESTED",
      configurationId: "cfg-2",
      lastTest: { configurationId: "cfg-1", at: iso(-1), succeeded: true },
    })
    refusedBecause(applyConnectionAction(stale, "ACTIVATE", { at: NOW }), "TEST_IS_STALE")
  })

  it("activates when the passing test ran against this configuration", () => {
    // Without this the refusals above could come from a function that refuses
    // everything.
    const ready = connection({
      state: "TESTED",
      configurationId: "cfg-2",
      lastTest: { configurationId: "cfg-2", at: iso(-1), succeeded: true },
    })
    expect(accepted(applyConnectionAction(ready, "ACTIVATE", { at: NOW })).state).toBe("ACTIVE")
  })

  it("cannot be activated on structural validity alone", () => {
    // Metadata that parses is not evidence that the provider will sign anything
    // we can verify. A VALIDATED connection with no test is refused for the
    // reason that is actually true.
    const validated = connection({ state: "VALIDATED", lastTest: null })
    refusedBecause(applyConnectionAction(validated, "ACTIVATE", { at: NOW }), "NO_PASSING_TEST")
  })

  it("activates a re-validated connection whose passing test still applies", () => {
    // Re-validating an unchanged configuration keeps the evidence, so this is
    // legitimately activatable and refusing it would be theatre.
    const revalidated = connection({
      state: "VALIDATED",
      lastTest: { configurationId: "cfg-1", at: iso(-1), succeeded: true },
    })
    expect(accepted(applyConnectionAction(revalidated, "ACTIVATE", { at: NOW })).state).toBe("ACTIVE")
  })
})

describe("changing the configuration discards the evidence for the old one", () => {
  it("clears a passing test when validation changes the configuration", () => {
    const tested = connection({
      state: "TESTED",
      lastTest: { configurationId: "cfg-1", at: iso(-1), succeeded: true },
    })
    const revalidated = accepted(
      applyConnectionAction(tested, "VALIDATE", { at: NOW, configurationId: "cfg-2" }),
    )

    expect(revalidated.lastTest).toBeNull()
    expect(revalidated.state).toBe("VALIDATED")
    // Refused for the reason that is actually true — the evidence is gone —
    // rather than for the state, which is reachable.
    refusedBecause(applyConnectionAction(revalidated, "ACTIVATE", { at: NOW }), "NO_PASSING_TEST")
  })

  it("keeps the test when validation changed nothing", () => {
    // Re-validating the same configuration is a no-op somebody clicks twice.
    // Discarding evidence there would make the flow feel broken.
    const tested = connection({
      state: "TESTED",
      lastTest: { configurationId: "cfg-1", at: iso(-1), succeeded: true },
    })
    const again = accepted(applyConnectionAction(tested, "VALIDATE", { at: NOW, configurationId: "cfg-1" }))
    expect(again.lastTest?.succeeded).toBe(true)
  })
})

describe("a signing key has to be able to verify something", () => {
  it("refuses to activate with every certificate expired", () => {
    const ready = connection({
      state: "TESTED",
      signingKeys: [key({ notAfter: iso(-1) })],
      lastTest: { configurationId: "cfg-1", at: iso(-2), succeeded: true },
    })
    refusedBecause(applyConnectionAction(ready, "ACTIVATE", { at: NOW }), "NO_LIVE_SIGNING_KEY")
  })

  it("refuses to activate with every certificate retired", () => {
    const ready = connection({
      state: "TESTED",
      signingKeys: [key({ retiredAt: iso(-1) })],
      lastTest: { configurationId: "cfg-1", at: iso(-2), succeeded: true },
    })
    refusedBecause(applyConnectionAction(ready, "ACTIVATE", { at: NOW }), "NO_LIVE_SIGNING_KEY")
  })

  it("excludes retired and expired keys from verification", () => {
    const mixed = connection({
      signingKeys: [key({ id: "live" }), key({ id: "retired", retiredAt: iso(-1) }), key({ id: "old", notAfter: iso(-1) })],
    })
    expect(verificationKeys(mixed, NOW).map((k) => k.id)).toEqual(["live"])
  })

  it("says a connection with no live key does not serve sign-in", () => {
    const active = connection({ state: "ACTIVE", signingKeys: [key({ notAfter: iso(-1) })] })
    expect(connectionServesSignIn(active, NOW)).toBe(false)
    expect(connectionServesSignIn(connection({ state: "ACTIVE" }), NOW)).toBe(true)
    expect(connectionServesSignIn(connection({ state: "TESTED" }), NOW)).toBe(false)
  })
})

describe("rotation is an overlap, not a swap", () => {
  const active = connection({
    state: "ACTIVE",
    lastTest: { configurationId: "cfg-1", at: iso(-1), succeeded: true },
  })

  it("adds the incoming certificate without removing the outgoing one", () => {
    // Assertions signed with the old key are on the wire while the new one is
    // installed. Replacing immediately rejects every one of them — an outage
    // that looks exactly like a misconfiguration.
    const rotated = accepted(
      applyConnectionAction(active, "ROTATE", { at: NOW, newKey: key({ id: "key-2" }) }),
    )
    expect(rotated.signingKeys.map((k) => k.id)).toEqual(["key-1", "key-2"])
    expect(verificationKeys(rotated, NOW).map((k) => k.id)).toEqual(["key-1", "key-2"])
  })

  it("does not knock the connection out of service", () => {
    const rotated = accepted(
      applyConnectionAction(active, "ROTATE", { at: NOW, newKey: key({ id: "key-2" }) }),
    )
    expect(rotated.state).toBe("ACTIVE")
    expect(connectionServesSignIn(rotated, NOW)).toBe(true)
  })

  it("refuses a key that is already installed", () => {
    refusedBecause(
      applyConnectionAction(active, "ROTATE", { at: NOW, newKey: key({ id: "key-1" }) }),
      "ALREADY_THERE",
    )
  })

  it("refuses a rotation with no incoming certificate", () => {
    refusedBecause(applyConnectionAction(active, "ROTATE", { at: NOW }), "NO_LIVE_SIGNING_KEY")
  })
})

describe("rollback needs somewhere to go", () => {
  it("refuses when nothing has ever been active", () => {
    // "Rollback" that quietly disabled the connection instead would take the
    // tenant down in the name of recovering it.
    const never = connection({ state: "ACTIVE", previousConfigurationId: null })
    refusedBecause(applyConnectionAction(never, "ROLLBACK", { at: NOW }), "NOTHING_TO_ROLL_BACK_TO")
  })

  it("returns to the configuration that was serving sign-ins", () => {
    const rolled = accepted(
      applyConnectionAction(
        connection({ state: "ACTIVE", configurationId: "cfg-2", activeConfigurationId: "cfg-2", previousConfigurationId: "cfg-1" }),
        "ROLLBACK",
        { at: NOW },
      ),
    )
    expect(rolled.configurationId).toBe("cfg-1")
    // So a rollback can be undone.
    expect(rolled.previousConfigurationId).toBe("cfg-2")
  })

  it("lands in TESTED rather than ACTIVE", () => {
    // The earlier configuration did work, but this is a recovery, and requiring
    // one deliberate ACTIVATE is what stops a rollback loop oscillating
    // unattended.
    const rolled = accepted(
      applyConnectionAction(
        connection({ state: "ACTIVE", configurationId: "cfg-2", activeConfigurationId: "cfg-2", previousConfigurationId: "cfg-1" }),
        "ROLLBACK",
        { at: NOW },
      ),
    )
    expect(rolled.state).toBe("TESTED")
    expect(connectionServesSignIn(rolled, NOW)).toBe(false)
  })

  it("discards the test evidence, which belonged to the configuration left behind", () => {
    const rolled = accepted(
      applyConnectionAction(
        connection({
          state: "ACTIVE",
          configurationId: "cfg-2",
          activeConfigurationId: "cfg-2",
          previousConfigurationId: "cfg-1",
          lastTest: { configurationId: "cfg-2", at: iso(-1), succeeded: true },
        }),
        "ROLLBACK",
        { at: NOW },
      ),
    )
    expect(rolled.lastTest).toBeNull()
    // And so the rolled-back configuration cannot be activated on the strength
    // of a test that was never run against it.
    refusedBecause(applyConnectionAction(rolled, "ACTIVATE", { at: NOW }), "NO_PASSING_TEST")
  })
})

describe("activation records what to roll back to", () => {
  it("has nothing to roll back to on a first activation", () => {
    // Nothing was replaced. Recording the configuration being activated would
    // make ROLLBACK return to exactly where it started — which is the bug the
    // end-to-end test below found.
    const first = accepted(
      applyConnectionAction(
        connection({ state: "TESTED", lastTest: { configurationId: "cfg-1", at: iso(-1), succeeded: true } }),
        "ACTIVATE",
        { at: NOW },
      ),
    )
    expect(first.previousConfigurationId).toBeNull()
    expect(first.activeConfigurationId).toBe("cfg-1")
    refusedBecause(applyConnectionAction(first, "ROLLBACK", { at: NOW }), "NOTHING_TO_ROLL_BACK_TO")
  })

  it("remembers the configuration a second activation replaced", () => {
    const second = accepted(
      applyConnectionAction(
        connection({
          state: "TESTED",
          configurationId: "cfg-2",
          activeConfigurationId: "cfg-1",
          lastTest: { configurationId: "cfg-2", at: iso(-1), succeeded: true },
        }),
        "ACTIVATE",
        { at: NOW },
      ),
    )
    expect(second.previousConfigurationId).toBe("cfg-1")
    expect(second.activeConfigurationId).toBe("cfg-2")
  })

  it("does not overwrite it when re-activating the same configuration", () => {
    // Activating twice is something an operator does. Overwriting here would
    // set `previous` to the current configuration and make rollback a no-op at
    // the moment it is needed.
    const active = connection({
      state: "ACTIVE",
      configurationId: "cfg-2",
      activeConfigurationId: "cfg-2",
      previousConfigurationId: "cfg-1",
      lastTest: { configurationId: "cfg-2", at: iso(-1), succeeded: true },
    })
    const again = accepted(applyConnectionAction(active, "ACTIVATE", { at: NOW }))
    expect(again.previousConfigurationId).toBe("cfg-1")
  })
})

describe("disabling is reversible and does not erase anything", () => {
  it("keeps the configuration and the keys", () => {
    const active = connection({
      state: "ACTIVE",
      lastTest: { configurationId: "cfg-1", at: iso(-1), succeeded: true },
    })
    const disabled = accepted(applyConnectionAction(active, "DISABLE", { at: NOW }))

    expect(disabled.state).toBe("DISABLED")
    expect(disabled.configurationId).toBe("cfg-1")
    expect(disabled.signingKeys).toHaveLength(1)
    expect(connectionServesSignIn(disabled, NOW)).toBe(false)
  })

  it("can be re-activated without re-testing, because nothing changed", () => {
    const disabled = connection({
      state: "DISABLED",
      lastTest: { configurationId: "cfg-1", at: iso(-1), succeeded: true },
    })
    expect(accepted(applyConnectionAction(disabled, "ACTIVATE", { at: NOW })).state).toBe("ACTIVE")
  })
})

describe("actions are refused from states they do not apply to", () => {
  it("will not test a draft", () => {
    // A draft has not been validated, so a "test" would be testing whether the
    // metadata parses — which is what validation is for.
    refusedBecause(applyConnectionAction(connection({ state: "DRAFT" }), "TEST", { at: NOW }), "WRONG_STATE")
  })

  it("will not roll back a draft", () => {
    refusedBecause(applyConnectionAction(connection({ state: "DRAFT" }), "ROLLBACK", { at: NOW }), "WRONG_STATE")
  })

  it("will not rotate a key onto a disabled connection", () => {
    refusedBecause(
      applyConnectionAction(connection({ state: "DISABLED" }), "ROTATE", { at: NOW, newKey: key({ id: "key-2" }) }),
      "WRONG_STATE",
    )
  })

  it("names the states each action does apply to", () => {
    // A refusal that does not say what to do next is a support ticket.
    const outcome = applyConnectionAction(connection({ state: "DRAFT" }), "TEST", { at: NOW })
    if (outcome.ok) throw new Error("expected a refusal")
    expect(outcome.detail).toContain("VALIDATED")
  })
})

describe("a live connection stages a change without going out of service", () => {
  const live = connection({
    state: "ACTIVE",
    activeConfigurationId: "cfg-1",
    lastTest: { configurationId: "cfg-1", at: iso(-1), succeeded: true },
  })

  it("keeps serving while new metadata is validated", () => {
    // An identity provider rotating its metadata is routine. Requiring DISABLE
    // first would make every routine rotation an outage, and an outage nobody
    // schedules is one somebody skips — which is how the certificate expires
    // instead.
    const staged = accepted(applyConnectionAction(live, "VALIDATE", { at: NOW, configurationId: "cfg-2" }))

    expect(staged.state).toBe("ACTIVE")
    expect(connectionServesSignIn(staged, NOW)).toBe(true)
    expect(hasStagedChange(staged)).toBe(true)
  })

  it("keeps serving the old configuration, not the staged one", () => {
    // Validating live traffic against a staged entity id or ACS URL would apply
    // an untested configuration to everybody signing in.
    const staged = accepted(applyConnectionAction(live, "VALIDATE", { at: NOW, configurationId: "cfg-2" }))

    expect(staged.configurationId).toBe("cfg-2")
    expect(servingConfigurationId(staged)).toBe("cfg-1")
  })

  it("keeps serving while the staged change is tested, pass or fail", () => {
    // The test says nothing about the configuration currently serving, so a
    // failed test must not take the tenant down.
    let staged = accepted(applyConnectionAction(live, "VALIDATE", { at: NOW, configurationId: "cfg-2" }))
    staged = accepted(applyConnectionAction(staged, "TEST", { at: NOW, testSucceeded: false }))

    expect(connectionServesSignIn(staged, NOW)).toBe(true)
    expect(servingConfigurationId(staged)).toBe("cfg-1")
  })

  it("promotes the staged configuration on activation", () => {
    let staged = accepted(applyConnectionAction(live, "VALIDATE", { at: NOW, configurationId: "cfg-2" }))
    staged = accepted(applyConnectionAction(staged, "TEST", { at: NOW, testSucceeded: true }))
    staged = accepted(applyConnectionAction(staged, "ACTIVATE", { at: NOW }))

    expect(servingConfigurationId(staged)).toBe("cfg-2")
    expect(staged.previousConfigurationId).toBe("cfg-1")
    expect(hasStagedChange(staged)).toBe(false)
  })

  it("refuses to promote a staged change that failed its test", () => {
    let staged = accepted(applyConnectionAction(live, "VALIDATE", { at: NOW, configurationId: "cfg-2" }))
    staged = accepted(applyConnectionAction(staged, "TEST", { at: NOW, testSucceeded: false }))

    refusedBecause(applyConnectionAction(staged, "ACTIVATE", { at: NOW }), "NO_PASSING_TEST")
    // And the tenant is still signing in throughout.
    expect(connectionServesSignIn(staged, NOW)).toBe(true)
  })

  it("reports nothing serving when the connection is not active", () => {
    expect(servingConfigurationId(connection({ state: "TESTED" }))).toBeNull()
    expect(servingConfigurationId(connection({ state: "DISABLED", activeConfigurationId: "cfg-1" }))).toBeNull()
  })
})

describe("the whole path, end to end", () => {
  it("draft → validate → test → activate → rotate → disable → activate → rollback", () => {
    // The item's own sequence, run once as a sequence rather than as eight
    // independent facts: each step's output is the next step's input, so a
    // transition that returned a subtly wrong connection fails here even if it
    // looked right in isolation.
    let c = connection()

    c = accepted(applyConnectionAction(c, "VALIDATE", { at: NOW, configurationId: "cfg-1" }))
    expect(c.state).toBe("VALIDATED")

    c = accepted(applyConnectionAction(c, "TEST", { at: NOW, testSucceeded: true }))
    expect(c.state).toBe("TESTED")

    c = accepted(applyConnectionAction(c, "ACTIVATE", { at: NOW }))
    expect(c.state).toBe("ACTIVE")
    expect(connectionServesSignIn(c, NOW)).toBe(true)

    c = accepted(applyConnectionAction(c, "ROTATE", { at: NOW, newKey: key({ id: "key-2" }) }))
    expect(verificationKeys(c, NOW)).toHaveLength(2)

    c = accepted(applyConnectionAction(c, "DISABLE", { at: NOW }))
    expect(connectionServesSignIn(c, NOW)).toBe(false)

    c = accepted(applyConnectionAction(c, "ACTIVATE", { at: NOW }))
    expect(c.state).toBe("ACTIVE")

    // Still nothing to roll back to: cfg-1 is the only configuration that has
    // ever served, and disabling then re-enabling it replaced nothing. An
    // earlier draft recorded the configuration being activated here, which made
    // ROLLBACK return to exactly where it started — this sequence is what
    // exposed it.
    refusedBecause(applyConnectionAction(c, "ROLLBACK", { at: NOW }), "NOTHING_TO_ROLL_BACK_TO")

    // Move to a second configuration the honest way, then roll back off it.
    c = accepted(applyConnectionAction(c, "VALIDATE", { at: NOW, configurationId: "cfg-2" }))
    c = accepted(applyConnectionAction(c, "TEST", { at: NOW, testSucceeded: true }))
    c = accepted(applyConnectionAction(c, "ACTIVATE", { at: NOW }))
    expect(c.activeConfigurationId).toBe("cfg-2")
    expect(c.previousConfigurationId).toBe("cfg-1")

    c = accepted(applyConnectionAction(c, "ROLLBACK", { at: NOW }))
    expect(c.configurationId).toBe("cfg-1")
    expect(c.state).toBe("TESTED")
    // And the thing rolled away from is what a fresh ACTIVATE would replace.
    expect(c.previousConfigurationId).toBe("cfg-2")
  })
})
