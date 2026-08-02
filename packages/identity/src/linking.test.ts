import {
  LINK_STEP_UP_MINUTES,
  applyMerge,
  personLiveness,
  planLink,
  planUnlink,
  validateMergeProposal,
  validateMergeReview,
  type ExternalIdentity,
  type IdentityAssertion,
  type MergeProposal,
  type MergeReview,
  type Person,
  type RecoveryMethod,
} from "./index"

/**
 * GE-040-004 — linking, unlinking, collisions and merge review.
 *
 * Adding a way to sign in as someone is the highest-risk action in an identity
 * system short of impersonation. Most of these tests are about the three things
 * that must not happen quietly: a link on a stale session, a collision resolved
 * by guessing, and the removal of somebody's last way in.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString()
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const person = (over: Partial<Person> = {}): Person => ({
  id: "person-1",
  displayName: "A Person",
  primaryEmail: "a.person@rochester.example",
  status: "ACTIVE",
  createdAt: days(-100),
  mergedIntoPersonId: null,
  ...over,
})

const identity = (over: Partial<ExternalIdentity> = {}): ExternalIdentity => ({
  id: "ext-1",
  personId: "person-1",
  connectionId: "conn-saml",
  issuer: "https://idp.rochester.example/saml",
  subject: "S-1",
  assertedEmail: "a.person@rochester.example",
  emailVerified: true,
  status: "ACTIVE",
  linkedAt: days(-30),
  lastAuthenticatedAt: null,
  ...over,
})

const assertion = (over: Partial<IdentityAssertion> = {}): IdentityAssertion => ({
  connectionId: "conn-local",
  issuer: "https://cognito.example",
  subject: "cognito-sub-9",
  assertedEmail: "a.person@rochester.example",
  emailVerified: true,
  ...over,
})

const recovery = (over: Partial<RecoveryMethod> = {}): RecoveryMethod => ({
  id: "rec-1",
  personId: "person-1",
  kind: "BACKUP_EMAIL",
  reference: "b***@example.invalid",
  verifiedAt: days(-5),
  status: "ACTIVE",
  createdAt: days(-5),
  ...over,
})

const linkRequest = (over: Partial<Parameters<typeof planLink>[0]> = {}) => ({
  person: person(),
  assertion: assertion(),
  newIdentityId: "ext-new",
  lastAuthenticatedAt: minutesAgo(1),
  at: NOW,
  ...over,
})

describe("linking needs recent authentication, not merely a session", () => {
  it("links a fresh credential after a recent authentication", () => {
    const outcome = planLink(linkRequest(), [identity()])
    expect(outcome.linked).toBe(true)
    if (!outcome.linked) return
    expect(outcome.identity.personId).toBe("person-1")
    expect(outcome.identity.subject).toBe("cognito-sub-9")
    expect(outcome.identity.status).toBe("ACTIVE")
  })

  it("refuses when the person has never authenticated", () => {
    const outcome = planLink(linkRequest({ lastAuthenticatedAt: null }), [])
    expect(outcome.linked).toBe(false)
    if (outcome.linked) return
    expect(outcome.reason).toBe("STEP_UP_REQUIRED")
  })

  it("refuses on a session older than the step-up window", () => {
    // A session can be eight hours old and inherited from a laptop somebody
    // walked away from. The question is not whether they were here today.
    const outcome = planLink(
      linkRequest({ lastAuthenticatedAt: minutesAgo(LINK_STEP_UP_MINUTES + 1) }),
      [],
    )
    expect(outcome.linked).toBe(false)
    if (outcome.linked) return
    expect(outcome.reason).toBe("STEP_UP_STALE")
  })

  it("accepts an authentication exactly at the boundary", () => {
    expect(planLink(linkRequest({ lastAuthenticatedAt: minutesAgo(LINK_STEP_UP_MINUTES) }), []).linked).toBe(true)
  })

  it("is much stricter than an ordinary session", () => {
    expect(LINK_STEP_UP_MINUTES).toBeLessThan(60)
  })
})

describe("a collision is never resolved by guessing", () => {
  it("refuses a credential that belongs to somebody else, and says whose", () => {
    // One of the two records is wrong, and picking one has a person's history
    // on the other side of it.
    const theirs = identity({ id: "ext-theirs", personId: "person-2", connectionId: "conn-local", issuer: "https://cognito.example", subject: "cognito-sub-9" })
    const outcome = planLink(linkRequest(), [theirs])

    expect(outcome.linked).toBe(false)
    if (outcome.linked) return
    expect(outcome.reason).toBe("COLLISION")
    expect(outcome.collision).toEqual({ existingIdentityId: "ext-theirs", heldByPersonId: "person-2" })
    expect(outcome.detail).toMatch(/reviewed merge/)
  })

  it("does not silently move a credential between people", () => {
    const theirs = identity({ id: "ext-theirs", personId: "person-2", connectionId: "conn-local", issuer: "https://cognito.example", subject: "cognito-sub-9" })
    const outcome = planLink(linkRequest(), [theirs])
    expect("identity" in outcome).toBe(false)
  })

  it("reports an already-linked credential separately from a collision", () => {
    // They need different answers: one is "nothing to do", the other is "a
    // person has to look at this".
    const mine = identity({ id: "ext-mine", personId: "person-1", connectionId: "conn-local", issuer: "https://cognito.example", subject: "cognito-sub-9" })
    const outcome = planLink(linkRequest(), [mine])
    expect(outcome.linked).toBe(false)
    if (outcome.linked) return
    expect(outcome.reason).toBe("ALREADY_LINKED_HERE")
  })

  it("refuses to revive a credential this person previously unlinked", () => {
    // Linking it again creates a new link, so the record of its removal
    // survives — the same rule as reviving a revoked membership.
    const revoked = identity({ id: "ext-old", personId: "person-1", connectionId: "conn-local", issuer: "https://cognito.example", subject: "cognito-sub-9", status: "REVOKED" })
    const outcome = planLink(linkRequest(), [revoked])
    expect(outcome.linked).toBe(false)
    if (outcome.linked) return
    expect(outcome.reason).toBe("RELINK_REVOKED")
  })
})

describe("the last way back in cannot be removed", () => {
  const unlinkRequest = (over = {}) => ({
    identityId: "ext-1",
    person: person(),
    lastAuthenticatedAt: minutesAgo(1),
    at: NOW,
    ...over,
  })

  it("unlinks when another live credential remains", () => {
    const outcome = planUnlink(unlinkRequest(), [identity(), identity({ id: "ext-2", subject: "S-2" })], [])
    expect(outcome.unlinked).toBe(true)
    if (!outcome.unlinked) return
    expect(outcome.identity.status).toBe("REVOKED")
    expect(outcome.remainingCredentials).toBe(1)
  })

  it("unlinks the only credential when a verified recovery method remains", () => {
    const outcome = planUnlink(unlinkRequest(), [identity()], [recovery()])
    expect(outcome.unlinked).toBe(true)
    if (!outcome.unlinked) return
    expect(outcome.remainingCredentials).toBe(0)
    expect(outcome.remainingRecoveryMethods).toBe(1)
  })

  it("refuses to remove the only way in", () => {
    // The system having done it on request, politely, is not a defence.
    const outcome = planUnlink(unlinkRequest(), [identity()], [])
    expect(outcome.unlinked).toBe(false)
    if (outcome.unlinked) return
    expect(outcome.reason).toBe("LAST_WAY_IN")
    expect(outcome.detail).toMatch(/lock the account permanently/)
  })

  it("does not count an unverified recovery method toward the floor", () => {
    // Otherwise a person satisfies it with a mailbox they cannot read — or one
    // somebody else can.
    const outcome = planUnlink(unlinkRequest(), [identity()], [recovery({ verifiedAt: null })])
    expect(outcome.unlinked).toBe(false)
    if (outcome.unlinked) return
    expect(outcome.reason).toBe("LAST_WAY_IN")
  })

  it("does not count a revoked recovery method", () => {
    const outcome = planUnlink(unlinkRequest(), [identity()], [recovery({ status: "REVOKED" })])
    expect(outcome.unlinked).toBe(false)
  })

  it("does not count an already-unlinked credential as a way in", () => {
    const outcome = planUnlink(unlinkRequest(), [identity(), identity({ id: "ext-2", subject: "S-2", status: "REVOKED" })], [])
    expect(outcome.unlinked).toBe(false)
    if (outcome.unlinked) return
    expect(outcome.reason).toBe("LAST_WAY_IN")
  })

  it("does not count another person's credentials or recovery methods", () => {
    const outcome = planUnlink(
      unlinkRequest(),
      [identity(), identity({ id: "ext-other", personId: "person-2", subject: "S-9" })],
      [recovery({ id: "rec-other", personId: "person-2" })],
    )
    expect(outcome.unlinked).toBe(false)
  })

  it("needs recent authentication too", () => {
    const outcome = planUnlink(
      unlinkRequest({ lastAuthenticatedAt: minutesAgo(LINK_STEP_UP_MINUTES + 1) }),
      [identity(), identity({ id: "ext-2", subject: "S-2" })],
      [],
    )
    expect(outcome.unlinked).toBe(false)
    if (outcome.unlinked) return
    expect(outcome.reason).toBe("STEP_UP_STALE")
  })

  it("refuses a credential that is not this person's", () => {
    const outcome = planUnlink(unlinkRequest({ identityId: "ext-nope" }), [identity()], [])
    expect(outcome.unlinked).toBe(false)
    if (outcome.unlinked) return
    expect(outcome.reason).toBe("NOT_LINKED")
  })
})

describe("a merge is reviewed, and a shared address is not evidence", () => {
  const proposal = (over: Partial<MergeProposal> = {}): MergeProposal => ({
    id: "merge-1",
    keepPersonId: "person-1",
    mergePersonId: "person-2",
    proposedBy: "director@rochester.example",
    evidence: "Both records were created during the Fall import; the registrar confirmed one student number.",
    proposedAt: NOW.toISOString(),
    ...over,
  })

  it("accepts a proposal with real evidence", () => {
    expect(validateMergeProposal(proposal())).toEqual([])
  })

  it("refuses a proposal whose evidence is an address", () => {
    // Approving on that basis is the auto-merge vulnerability performed by
    // hand, which is precisely what GE-040-002 refuses to do automatically.
    for (const evidence of ["shared@rochester.example", "same email", "Matching e-mail."]) {
      const problems = validateMergeProposal(proposal({ evidence }))
      expect(problems.map((p) => p.field)).toContain("evidence")
    }
  })

  it("refuses merging a record into itself", () => {
    expect(
      validateMergeProposal(proposal({ mergePersonId: "person-1" })).map((p) => p.field),
    ).toContain("mergePersonId")
  })

  it("refuses a review by the proposer", () => {
    // A merge is irreversible in the way that matters: the superseded record
    // stops being the one anything resolves to.
    const review: MergeReview = {
      proposalId: "merge-1",
      reviewedBy: "director@rochester.example",
      reviewedAt: NOW.toISOString(),
      verdict: "APPROVED",
      finding: "Looks right to me.",
    }
    expect(validateMergeReview(proposal(), review).map((p) => p.field)).toContain("reviewedBy")
  })

  it("refuses a review with no finding", () => {
    // A rejection nobody explained will simply be re-proposed.
    const review: MergeReview = {
      proposalId: "merge-1",
      reviewedBy: "second@rochester.example",
      reviewedAt: NOW.toISOString(),
      verdict: "REJECTED",
      finding: "no",
    }
    expect(validateMergeReview(proposal(), review).map((p) => p.field)).toContain("finding")
  })

  it("refuses a review pointed at a different proposal", () => {
    const review: MergeReview = {
      proposalId: "merge-9",
      reviewedBy: "second@rochester.example",
      reviewedAt: NOW.toISOString(),
      verdict: "APPROVED",
      finding: "Confirmed with the registrar.",
    }
    expect(validateMergeReview(proposal(), review).map((p) => p.field)).toContain("proposalId")
  })
})

describe("an approved merge supersedes rather than deletes", () => {
  const proposal: MergeProposal = {
    id: "merge-1",
    keepPersonId: "person-1",
    mergePersonId: "person-2",
    proposedBy: "director@rochester.example",
    evidence: "The registrar confirmed both records are the same student number.",
    proposedAt: NOW.toISOString(),
  }

  it("keeps the superseded record, pointing at the survivor", () => {
    // Older references still have to resolve — an approval signed by that id
    // must not become unreadable.
    const result = applyMerge(proposal, person({ id: "person-2" }), [])
    expect(result.superseded.mergedIntoPersonId).toBe("person-1")
    expect(result.superseded.id).toBe("person-2")

    const state = personLiveness(result.superseded, NOW)
    expect(state.live).toBe(false)
    if (state.live) return
    expect(state.reason).toBe("SUPERSEDED")
  })

  it("moves the merged person's identities and leaves their keys alone", () => {
    // A merge is a statement about people. Changing a key would silently make
    // the credential a different credential.
    const theirs = [
      identity({ id: "ext-a", personId: "person-2", subject: "S-A" }),
      identity({ id: "ext-b", personId: "person-2", subject: "S-B" }),
      identity({ id: "ext-mine", personId: "person-1" }),
    ]
    const result = applyMerge(proposal, person({ id: "person-2" }), theirs)
    expect(result.reassignedIdentityIds).toEqual(["ext-a", "ext-b"])
    expect(result.keepPersonId).toBe("person-1")
  })

  it("reassigns nothing when the merged record had no credentials", () => {
    expect(applyMerge(proposal, person({ id: "person-2" }), []).reassignedIdentityIds).toEqual([])
  })
})
