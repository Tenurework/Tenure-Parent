import type { ExternalIdentity } from "./entities"
import {
  MIGRATION_WAVES,
  ROLLBACK_TARGET,
  isMigrationWave,
  localLoginPermitted,
  planWaveAdvance,
  planWaveRollback,
  recoveryPath,
  rollbackAvailable,
  sessionEffect,
  ssoOffered,
  waveIndex,
  waveRecordProblems,
  type MigrationWave,
  type WaveRecord,
} from "./sso-migration"

/**
 * IER-100-008 — the wave ladder — and IER-100-011 — rollback that creates
 * nothing.
 *
 * The assertions to distrust in a file like this are the ones that restate the
 * table. `localLoginPermitted("SSO_REQUIRED") === false` is worth having, but a
 * mutation flipping the table also flips a test written from the table, so the
 * cases below anchor on the CONSEQUENCE where there is one: that the ladder
 * covers every stage §15.2 names, that a wave cannot be skipped, that an
 * incomplete record cannot advance, and that no rollback outcome names a
 * credential the request did not carry.
 */

const LOCAL = (over: Partial<ExternalIdentity> = {}): ExternalIdentity => ({
  id: "identity-local-1",
  personId: "person-1",
  connectionId: "connection-local",
  issuer: "https://cognito.example/local",
  subject: "sub-1",
  assertedEmail: "person@example.edu",
  emailVerified: true,
  status: "REVOKED",
  linkedAt: "2026-01-01T00:00:00.000Z",
  lastAuthenticatedAt: null,
  ...over,
})

const record = (over: Partial<WaveRecord> = {}): WaveRecord => ({
  wave: "HYBRID",
  counts: { inScope: 400, linked: 388, failedLinks: 2, duplicateProfiles: 0 },
  exceptions: [
    { personId: "person-9", reason: "no directory record yet; joins next term", authorizedBy: "ose-director", expiresAt: null },
    { personId: "person-10", reason: "on leave, mailbox suspended", authorizedBy: "ose-director", expiresAt: "2026-09-01T00:00:00.000Z" },
  ],
  supportPlan: "OSE front desk restores the previous method on request; escalation to platform on-call after 30 minutes.",
  sessionEffect: sessionEffect("HYBRID"),
  rollbackPlan: "Return to PILOT by disabling the connection; local credentials were never revoked at this wave.",
  approval: {
    requestedBy: "platform-eng",
    approvedBy: "ose-director",
    approvedAt: "2026-03-01T12:00:00.000Z",
    digest: "sha256:0c1d",
  },
  ...over,
})

describe("the ladder covers every stage the Bible names", () => {
  it("names the seven waves the requirement names and the three §15.2 adds", () => {
    // Written out rather than derived from MIGRATION_WAVES: deriving it would
    // make the assertion true of whatever the list happens to say.
    expect([...MIGRATION_WAVES]).toEqual([
      "DISCOVERY",
      "TEST_IDP",
      "PRE_LINK",
      "PILOT",
      "HYBRID",
      "SSO_PREFERRED",
      "SSO_REQUIRED",
      "LOCAL_DISABLED",
      "ROLLBACK_WINDOW",
      "RETIRED",
    ])
  })

  it("gives every wave a position, and nothing else one", () => {
    for (const wave of MIGRATION_WAVES) expect(waveIndex(wave)).toBeGreaterThanOrEqual(0)
    expect(waveIndex("SSO_ENABLED")).toBe(-1)
    expect(isMigrationWave("HYBRID")).toBe(true)
    expect(isMigrationWave("hybrid")).toBe(false)
  })

  it("decides local login, SSO and recovery for every wave with no gaps", () => {
    for (const wave of MIGRATION_WAVES) {
      expect(typeof localLoginPermitted(wave)).toBe("boolean")
      expect(typeof ssoOffered(wave, "PRODUCTION")).toBe("boolean")
      expect(["LOCAL_LOGIN", "OPERATOR_ROLLBACK", "REVIEWED_RELINK"]).toContain(recoveryPath(wave).path)
    }
  })
})

describe("the rollback window is a window, not the old method switched back on", () => {
  it("keeps local login off for the whole of it", () => {
    // The property an `index <= SSO_PREFERRED` implementation gets wrong: the
    // ladder is not monotonic here, because ROLLBACK_WINDOW sits after
    // LOCAL_DISABLED.
    expect(localLoginPermitted("LOCAL_DISABLED")).toBe(false)
    expect(localLoginPermitted("ROLLBACK_WINDOW")).toBe(false)
    expect(localLoginPermitted("SSO_PREFERRED")).toBe(true)
  })

  it("still offers a way back from it, and none after retirement", () => {
    expect(rollbackAvailable("ROLLBACK_WINDOW")).toBe(true)
    expect(rollbackAvailable("RETIRED")).toBe(false)
  })
})

describe("what somebody locked out is told", () => {
  it("points at the old method while it works", () => {
    expect(recoveryPath("HYBRID").path).toBe("LOCAL_LOGIN")
  })

  it("points at an operator rollback once it does not", () => {
    expect(recoveryPath("SSO_REQUIRED").path).toBe("OPERATOR_ROLLBACK")
    expect(recoveryPath("ROLLBACK_WINDOW").path).toBe("OPERATOR_ROLLBACK")
  })

  it("never offers a new account after retirement", () => {
    const recovery = recoveryPath("RETIRED")
    expect(recovery.path).toBe("REVIEWED_RELINK")
    // The consequence, asserted on the words a person reads: a page that says
    // "we can restore your password" after retirement sends them to a queue
    // that will refuse them, and the improvisation at that point is a fresh
    // local account.
    expect(recovery.detail).toContain("cannot be switched back on")
    expect(recovery.detail).not.toMatch(/restore the previous method/)
  })
})

describe("a session opened with a password does not outlive the wave that forbids passwords", () => {
  it("revokes local-credential sessions on entering the three waves that refuse them", () => {
    for (const wave of ["SSO_REQUIRED", "LOCAL_DISABLED", "RETIRED"] as MigrationWave[]) {
      expect(sessionEffect(wave).sessions).toBe("REVOKE_LOCAL_CREDENTIAL_SESSIONS")
    }
  })

  it("leaves sessions alone in the waves where both methods are acceptable", () => {
    for (const wave of ["DISCOVERY", "TEST_IDP", "PRE_LINK", "PILOT", "HYBRID", "SSO_PREFERRED"] as MigrationWave[]) {
      expect(sessionEffect(wave).sessions).toBe("UNCHANGED")
    }
  })
})

describe("the federated method is not drawn during the back-office stages", () => {
  it("offers nothing at discovery or pre-link", () => {
    expect(ssoOffered("DISCOVERY", "PRODUCTION")).toBe(false)
    expect(ssoOffered("PRE_LINK", "PRODUCTION")).toBe(false)
    expect(ssoOffered("DISCOVERY", "NON_PRODUCTION")).toBe(false)
  })

  it("offers a test IdP to non-production users only", () => {
    expect(ssoOffered("TEST_IDP", "NON_PRODUCTION")).toBe(true)
    expect(ssoOffered("TEST_IDP", "PRODUCTION")).toBe(false)
  })

  it("offers it from the pilot onward", () => {
    for (const wave of ["PILOT", "HYBRID", "SSO_PREFERRED", "SSO_REQUIRED", "LOCAL_DISABLED", "RETIRED"] as MigrationWave[]) {
      expect(ssoOffered(wave, "PRODUCTION")).toBe(true)
    }
  })
})

describe("every wave carries the eight things §15.2 requires", () => {
  it("accepts a complete record", () => {
    expect(waveRecordProblems(record())).toEqual([])
  })

  it("refuses a record with no support plan", () => {
    const problems = waveRecordProblems(record({ supportPlan: "TBD" }))
    expect(problems.map((p) => p.field)).toContain("supportPlan")
  })

  it("refuses a record with no rollback plan", () => {
    expect(waveRecordProblems(record({ rollbackPlan: "" })).map((p) => p.field)).toContain("rollbackPlan")
  })

  it("refuses an unapproved wave", () => {
    expect(waveRecordProblems(record({ approval: null })).map((p) => p.field)).toContain("approval")
  })

  it("refuses a wave its own requester approved", () => {
    const problems = waveRecordProblems(
      record({
        approval: { requestedBy: "platform-eng", approvedBy: "platform-eng", approvedAt: "2026-03-01T12:00:00.000Z", digest: "sha256:0c1d" },
      }),
    )
    expect(problems.map((p) => p.field)).toContain("approval.approvedBy")
  })

  it("refuses an approval that binds to no version of the plan", () => {
    const problems = waveRecordProblems(
      record({
        approval: { requestedBy: "platform-eng", approvedBy: "ose-director", approvedAt: "2026-03-01T12:00:00.000Z", digest: "  " },
      }),
    )
    expect(problems.map((p) => p.field)).toContain("approval.digest")
  })

  it("refuses more failed links than decisions about them", () => {
    const problems = waveRecordProblems(record({ counts: { inScope: 400, linked: 380, failedLinks: 9, duplicateProfiles: 0 } }))
    const failed = problems.find((p) => p.field === "counts.failedLinks")
    expect(failed?.detail).toContain("9 links failed and 2 exceptions")
  })

  it("accepts failed links that every one of them has an exception for", () => {
    // Zero failed links would be a migration nobody ran. The property is that
    // each is somebody a named person decided about, not that there are none.
    expect(waveRecordProblems(record({ counts: { inScope: 400, linked: 398, failedLinks: 2, duplicateProfiles: 0 } }))).toEqual([])
  })

  it("refuses any unresolved duplicate profile", () => {
    const problems = waveRecordProblems(record({ counts: { inScope: 400, linked: 388, failedLinks: 2, duplicateProfiles: 1 } }))
    expect(problems.map((p) => p.field)).toContain("counts.duplicateProfiles")
  })

  it("refuses more links than people in scope", () => {
    const problems = waveRecordProblems(record({ counts: { inScope: 10, linked: 11, failedLinks: 0, duplicateProfiles: 0 } }))
    expect(problems.map((p) => p.field)).toContain("counts.linked")
  })

  it("refuses a negative count", () => {
    const problems = waveRecordProblems(record({ counts: { inScope: 10, linked: -1, failedLinks: 0, duplicateProfiles: 0 } }))
    expect(problems.map((p) => p.field)).toContain("counts.linked")
  })

  it("refuses an exception nobody authorized or explained", () => {
    const problems = waveRecordProblems(
      record({ exceptions: [{ personId: "person-9", reason: "n/a", authorizedBy: "", expiresAt: null }], counts: { inScope: 400, linked: 399, failedLinks: 1, duplicateProfiles: 0 } }),
    )
    expect(problems.map((p) => p.field)).toEqual(
      expect.arrayContaining(["exceptions[0].reason", "exceptions[0].authorizedBy"]),
    )
  })

  it("refuses a record whose declared session behaviour is not what happens", () => {
    const problems = waveRecordProblems(
      record({ wave: "SSO_REQUIRED", sessionEffect: { sessions: "UNCHANGED", detail: "nothing to do" } }),
    )
    const mismatch = problems.find((p) => p.field === "sessionEffect")
    expect(mismatch?.detail).toContain("REVOKE_LOCAL_CREDENTIAL_SESSIONS")
  })
})

describe("advancing one step at a time", () => {
  it("advances to the next wave with a complete record", () => {
    const outcome = planWaveAdvance("PILOT", "HYBRID", record())
    expect(outcome).toMatchObject({ advanced: true, wave: "HYBRID", localLoginPermitted: true })
  })

  it("refuses a skipped wave and says how many", () => {
    const outcome = planWaveAdvance("PILOT", "SSO_REQUIRED", record({ wave: "SSO_REQUIRED" }))
    expect(outcome).toMatchObject({ advanced: false, reason: "SKIPPED_WAVE" })
    expect((outcome as { detail: string }).detail).toContain("skips 2 wave(s)")
  })

  it("refuses a move backwards, and names rollback as the thing being avoided", () => {
    const outcome = planWaveAdvance("SSO_REQUIRED", "HYBRID", record())
    expect(outcome).toMatchObject({ advanced: false, reason: "NOT_AN_ADVANCE" })
    expect((outcome as { detail: string }).detail).toContain("rollback")
  })

  it("refuses standing still", () => {
    expect(planWaveAdvance("HYBRID", "HYBRID", record())).toMatchObject({ reason: "NOT_AN_ADVANCE" })
  })

  it("refuses a record written for a different wave", () => {
    expect(planWaveAdvance("PILOT", "HYBRID", record({ wave: "SSO_PREFERRED" }))).toMatchObject({
      advanced: false,
      reason: "RECORD_FOR_ANOTHER_WAVE",
    })
  })

  it("refuses an incomplete record and hands back every problem at once", () => {
    const outcome = planWaveAdvance("PILOT", "HYBRID", record({ approval: null, supportPlan: "" }))
    expect(outcome).toMatchObject({ advanced: false, reason: "RECORD_INCOMPLETE" })
    expect((outcome as { problems: readonly unknown[] }).problems).toHaveLength(2)
  })

  it("carries the wave's consequences into the outcome rather than leaving the caller to look them up", () => {
    const outcome = planWaveAdvance(
      "SSO_PREFERRED",
      "SSO_REQUIRED",
      record({
        wave: "SSO_REQUIRED",
        sessionEffect: sessionEffect("SSO_REQUIRED"),
        rollbackPlan: "Roll the tenant back to HYBRID; the local credentials are suspended, not deleted.",
      }),
    )
    expect(outcome).toMatchObject({
      advanced: true,
      localLoginPermitted: false,
      sessionEffect: { sessions: "REVOKE_LOCAL_CREDENTIAL_SESSIONS" },
      recovery: { path: "OPERATOR_ROLLBACK" },
    })
  })
})

describe("IER-100-011 — a rollback reactivates and never creates", () => {
  const request = {
    requestedBy: "ose-director",
    approvedBy: "platform-eng",
    reason: "the university's IdP is returning a signature error for every student",
    localIdentities: [LOCAL(), LOCAL({ id: "identity-local-2", personId: "person-2" })],
    at: new Date("2026-04-01T09:00:00.000Z"),
  }

  it("lands on the wave where both methods work", () => {
    const outcome = planWaveRollback("SSO_REQUIRED", request)
    expect(outcome).toMatchObject({ rolledBack: true, to: ROLLBACK_TARGET })
    expect(localLoginPermitted(ROLLBACK_TARGET)).toBe(true)
  })

  it("names only credentials the request carried", () => {
    const outcome = planWaveRollback("LOCAL_DISABLED", request)
    const ids = (outcome as { reactivateIdentityIds: readonly string[] }).reactivateIdentityIds
    const supplied = new Set(request.localIdentities.map((identity) => identity.id))
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(supplied.has(id)).toBe(true)
  })

  it("leaves an already-active credential out rather than rewriting it", () => {
    const outcome = planWaveRollback("SSO_REQUIRED", {
      ...request,
      localIdentities: [LOCAL({ status: "ACTIVE" }), LOCAL({ id: "identity-local-2", status: "REVOKED" })],
    })
    expect((outcome as { reactivateIdentityIds: readonly string[] }).reactivateIdentityIds).toEqual(["identity-local-2"])
  })

  it("refuses after retirement, and says why creating one would be worse", () => {
    const outcome = planWaveRollback("RETIRED", request)
    expect(outcome).toMatchObject({ rolledBack: false, reason: "OLD_METHOD_RETIRED" })
    expect((outcome as { detail: string }).detail).toContain("second authority")
  })

  it("refuses when there is nothing to reactivate rather than minting one", () => {
    const outcome = planWaveRollback("SSO_REQUIRED", { ...request, localIdentities: [] })
    expect(outcome).toMatchObject({ rolledBack: false, reason: "NO_LOCAL_CREDENTIAL" })
  })

  it("refuses a rollback its requester approved", () => {
    expect(planWaveRollback("SSO_REQUIRED", { ...request, approvedBy: request.requestedBy })).toMatchObject({
      rolledBack: false,
      reason: "SELF_APPROVED",
    })
  })

  it("refuses a rollback with no stated reason", () => {
    expect(planWaveRollback("SSO_REQUIRED", { ...request, reason: "broken" })).toMatchObject({
      rolledBack: false,
      reason: "NO_REASON",
    })
  })

  it("refuses from a wave that changed nothing about signing in", () => {
    for (const wave of ["DISCOVERY", "TEST_IDP", "PRE_LINK"] as MigrationWave[]) {
      expect(planWaveRollback(wave, request)).toMatchObject({ rolledBack: false, reason: "NOTHING_TO_ROLL_BACK" })
    }
  })

  it("returns no field through which a credential could be created", () => {
    // The structural half of IER-100-011. A future `mintedIdentityId` on this
    // outcome is the thing to notice, and it would be added by someone being
    // helpful; asserting the shape means it cannot arrive quietly.
    const outcome = planWaveRollback("SSO_REQUIRED", request)
    expect(Object.keys(outcome).sort()).toEqual(["detail", "reactivateIdentityIds", "rolledBack", "sessionEffect", "to"])
  })
})
