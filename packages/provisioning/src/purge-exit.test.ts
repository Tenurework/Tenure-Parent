/**
 * GE-103-013 and GE-103-015 — the two gates on the way out, and the graph that
 * makes them the only way out.
 *
 * The assertions that matter are the negative ones. A gate is worth exactly
 * what it refuses, and the refusals here are of three kinds: a check that
 * failed, a check nobody could answer, and an approval that looked complete
 * and was not.
 */
import { describe, expect, it } from "@jest/globals"

import {
  ALL_STATES,
  LifecycleError,
  advance,
  nextStates,
  type TenantState,
} from "./lifecycle"
import {
  C7_COOLING_OFF_MS,
} from "./change-class"
import {
  PURGE_CHECKS,
  PURGE_CHECK_IDS,
  purgeClearance,
  type PurgeCheckId,
  type PurgeFacts,
} from "./purge-gate"
import { TOMBSTONE_FIELDS, TombstoneRefused, buildTombstone, tombstoneProblems } from "./tombstone"

const NOW = "2026-08-17T12:00:00.000Z"
const OPERATOR = { principalId: "dana@tenure.example", at: NOW }
const SECOND = "ravi@tenure.example"
const SLUG = "midtown-arts"

/** Fifteen minutes and one second before NOW, so the C7 period has elapsed. */
const REQUESTED_AT = new Date(Date.parse(NOW) - C7_COOLING_OFF_MS - 1000).toISOString()

const facts = (over: Partial<PurgeFacts> = {}): PurgeFacts => ({
  slug: SLUG,
  exportOutcome: { taken: true, completedAt: "2026-07-01T00:00:00.000Z", digest: "e3b0c442" },
  contract: { endedAt: "2026-06-30T00:00:00.000Z", obligationsDischarged: true },
  retention: [{ subject: "student-records", expiresAt: "2026-01-01T00:00:00.000Z" }],
  legalHold: { active: false },
  tax: [{ jurisdiction: "US-NY", retainUntil: "2026-03-31T00:00:00.000Z" }],
  audit: { evidenceRef: "s3://tenure-audit/purges/midtown", retainedUntil: "2036-01-01T00:00:00.000Z" },
  coolingOff: { requestedAt: REQUESTED_AT, requestedBy: OPERATOR.principalId },
  approval: {
    requestedBy: OPERATOR.principalId,
    approvedBy: SECOND,
    approverIsOperator: true,
    // C7's token is the target itself — see `confirmationTokenFor`.
    typedConfirmation: SLUG,
    performedBy: SECOND,
  },
  ...over,
})

const tombstone = (over: Record<string, unknown> = {}) => ({
  tenantId: "t-01J9F5ZK3M4N5P6Q7R8S9T0V1W",
  lifecycle: {
    registeredAt: "2024-09-01T00:00:00.000Z",
    purgeApprovedAt: NOW,
    purgedAt: NOW,
  },
  purgeManifestDigest: "a".repeat(64),
  approvals: [
    { principalId: OPERATOR.principalId, role: "requested", at: NOW },
    { principalId: SECOND, role: "approved", at: NOW },
  ],
  evidenceRef: "s3://tenure-audit/purges/midtown",
  ...over,
})

const verdictOf = (f: PurgeFacts, id: PurgeCheckId, at = NOW) =>
  purgeClearance(f, at).results.find((r) => r.id === id)?.verdict

describe("the seven checks the requirement names", () => {
  it("declares exactly those seven, in that order", () => {
    expect([...PURGE_CHECK_IDS]).toEqual([
      "export",
      "contract",
      "retention",
      "legal-hold",
      "tax",
      "audit",
      "cooling-off",
    ])
    expect(PURGE_CHECKS.map((c) => c.id)).toEqual([...PURGE_CHECK_IDS])
  })

  it("clears a tenant whose every check is satisfied", () => {
    const clearance = purgeClearance(facts(), NOW)
    expect(clearance.cleared).toBe(true)
    expect(clearance.blockers).toEqual([])
    expect(clearance.results.every((r) => r.verdict === "satisfied")).toBe(true)
  })

  it("runs every check even when an earlier one has already refused", () => {
    // An operator who fixes one refusal and is handed the next has been made to
    // discover the list one item at a time — which, with a fifteen-minute
    // cooling-off in it, costs an afternoon.
    const clearance = purgeClearance(
      facts({ legalHold: { active: true, matterRef: "M-9" }, tax: [{ jurisdiction: "US-NY", retainUntil: "2030-01-01T00:00:00.000Z" }] }),
      NOW,
    )
    expect(clearance.blockers.map((b) => b.id)).toEqual(["legal-hold", "tax"])
  })

  it.each<[PurgeCheckId, Partial<PurgeFacts>]>([
    ["export", { exportOutcome: undefined }],
    ["contract", { contract: undefined }],
    ["retention", { retention: undefined }],
    ["legal-hold", { legalHold: undefined }],
    ["tax", { tax: undefined }],
    ["audit", { audit: undefined }],
    ["cooling-off", { coolingOff: undefined }],
  ])("treats an unsupplied %s fact as unknown, and unknown blocks", (id, over) => {
    const clearance = purgeClearance(facts(over), NOW)
    expect(verdictOf(facts(over), id)).toBe("unknown")
    expect(clearance.cleared).toBe(false)
    expect(clearance.explanation).toContain("An unknown is not a no, and it is certainly not a yes")
  })

  it("keeps `we looked and there are none` apart from `nobody looked`", () => {
    // The pair this whole module exists for. An EMPTY retention list is a real
    // answer and passes; an ABSENT one is not an answer at all.
    expect(verdictOf(facts({ retention: [] }), "retention")).toBe("satisfied")
    expect(verdictOf(facts({ retention: undefined }), "retention")).toBe("unknown")
    expect(verdictOf(facts({ tax: [] }), "tax")).toBe("satisfied")
    expect(verdictOf(facts({ tax: undefined }), "tax")).toBe("unknown")
  })

  it("blocks on a live retention schedule and names what is still retained", () => {
    const f = facts({ retention: [{ subject: "transcripts", expiresAt: "2031-01-01T00:00:00.000Z" }] })
    const result = purgeClearance(f, NOW).results.find((r) => r.id === "retention")
    expect(result?.verdict).toBe("blocked")
    expect(result?.detail).toContain("transcripts until 2031-01-01T00:00:00.000Z")
  })

  it("blocks on a live contract term and on undischarged obligations separately", () => {
    expect(verdictOf(facts({ contract: { endedAt: "2030-01-01T00:00:00.000Z", obligationsDischarged: true } }), "contract")).toBe("blocked")
    expect(verdictOf(facts({ contract: { endedAt: "2026-06-30T00:00:00.000Z", obligationsDischarged: false } }), "contract")).toBe("blocked")
  })

  it("accepts a recorded decision NOT to export, and refuses an unattributable one", () => {
    expect(
      verdictOf(
        facts({ exportOutcome: { taken: false, declinedBy: SECOND, at: NOW, reason: "customer took a live migration" } }),
        "export",
      ),
    ).toBe("satisfied")
    expect(
      verdictOf(facts({ exportOutcome: { taken: false, declinedBy: "", at: NOW, reason: "" } }), "export"),
    ).toBe("blocked")
    // An export with no digest cannot show the customer received anything.
    expect(
      verdictOf(facts({ exportOutcome: { taken: true, completedAt: NOW, digest: "  " } }), "export"),
    ).toBe("blocked")
  })

  it("blocks when the audit evidence would not outlive the purge", () => {
    const result = purgeClearance(
      facts({ audit: { evidenceRef: "s3://a/b", retainedUntil: "2020-01-01T00:00:00.000Z" } }),
      NOW,
    ).results.find((r) => r.id === "audit")
    expect(result?.verdict).toBe("blocked")
    expect(result?.detail).toContain("nothing that can show it was authorised")
  })

  it("measures cooling-off against the persisted request time, not a second caller value", () => {
    const oneMinuteShort = new Date(Date.parse(NOW) - C7_COOLING_OFF_MS + 60_000).toISOString()
    const result = purgeClearance(
      facts({ coolingOff: { requestedAt: oneMinuteShort, requestedBy: OPERATOR.principalId } }),
      NOW,
    ).results.find((r) => r.id === "cooling-off")
    expect(result?.verdict).toBe("blocked")
    expect(result?.detail).toContain("more minute(s) to wait")
  })

  it("reads an unparseable instant as unknown rather than as expired", () => {
    expect(verdictOf(facts({ contract: { endedAt: "last Tuesday", obligationsDischarged: true } }), "contract")).toBe("unknown")
    expect(verdictOf(facts({ coolingOff: { requestedAt: "soon", requestedBy: SECOND } }), "cooling-off")).toBe("unknown")
  })

  it("is deterministic — no clock, no environment", () => {
    const f = facts()
    expect(JSON.stringify(purgeClearance(f, NOW))).toBe(JSON.stringify(purgeClearance(f, NOW)))
  })
})

describe("the separate protected destructive human approval", () => {
  it("takes its demands from the change taxonomy rather than restating them", () => {
    const { requirements } = purgeClearance(facts(), NOW).approval
    // C7: two people, a typed token naming the target, a cooling-off, and not
    // something this platform performs itself.
    expect(requirements.approvers).toBe(2)
    expect(requirements.typedConfirmation).toBe(SLUG)
    expect(requirements.coolingOffMs).toBe(C7_COOLING_OFF_MS)
    expect(requirements.automatable).toBe(false)
  })

  it("refuses an absent approval rather than defaulting it", () => {
    const clearance = purgeClearance(facts({ approval: undefined }), NOW)
    expect(clearance.cleared).toBe(false)
    expect(clearance.approval.problems.join(" ")).toContain("An absent approval is a refusal")
  })

  it("refuses self-approval", () => {
    const clearance = purgeClearance(
      facts({
        approval: {
          requestedBy: OPERATOR.principalId,
          approvedBy: OPERATOR.principalId,
          approverIsOperator: true,
          typedConfirmation: SLUG,
          performedBy: OPERATOR.principalId,
        },
      }),
      NOW,
    )
    expect(clearance.approval.problems.join(" ")).toContain("cannot approve their own purge")
  })

  it("refuses an approver nobody looked up", () => {
    const clearance = purgeClearance(
      facts({
        approval: { requestedBy: OPERATOR.principalId, approvedBy: SECOND, approverIsOperator: false, typedConfirmation: SLUG, performedBy: SECOND },
      }),
      NOW,
    )
    expect(clearance.approval.problems.join(" ")).toContain("not verified as a platform operator")
  })

  it("refuses a near-miss confirmation, and never echoes what was typed as acceptable", () => {
    const clearance = purgeClearance(
      facts({
        approval: { requestedBy: OPERATOR.principalId, approvedBy: SECOND, approverIsOperator: true, typedConfirmation: "midtown-art", performedBy: SECOND },
      }),
      NOW,
    )
    expect(clearance.cleared).toBe(false)
    expect(clearance.approval.problems.join(" ")).toContain(`must be exactly "${SLUG}"`)
  })

  it("refuses a purge no human performed", () => {
    const clearance = purgeClearance(
      facts({
        approval: { requestedBy: OPERATOR.principalId, approvedBy: SECOND, approverIsOperator: true, typedConfirmation: SLUG, performedBy: null },
      }),
      NOW,
    )
    expect(clearance.approval.problems.join(" ")).toContain(
      "this platform was about to destroy the data itself",
    )
  })

  it("reports every approval problem at once", () => {
    const clearance = purgeClearance(
      facts({
        approval: { requestedBy: OPERATOR.principalId, approvedBy: OPERATOR.principalId, approverIsOperator: false, typedConfirmation: "", performedBy: null },
      }),
      NOW,
    )
    expect(clearance.approval.problems.length).toBe(4)
  })
})

describe("PURGED_ZERO_INCREMENTAL_COST is reachable only through the gate", () => {
  it("has exactly one predecessor, which is itself gated", () => {
    const predecessors = ALL_STATES.filter((s: TenantState) =>
      nextStates(s).includes("PURGED_ZERO_INCREMENTAL_COST"),
    )
    expect(predecessors).toEqual(["PURGING"])
    expect(ALL_STATES.filter((s: TenantState) => nextStates(s).includes("PURGING"))).toEqual([
      "PURGE_PENDING",
    ])
  })

  it("refuses PURGE_PENDING → PURGING with no clearance at all", () => {
    expect(() =>
      advance("PURGE_PENDING", "PURGING", { actor: OPERATOR, approvedBy: SECOND, approverIsOperator: true }),
    ).toThrow(/requires a purge clearance/)
  })

  it("refuses PURGE_PENDING → PURGING on a clearance that did not clear, quoting why", () => {
    const clearance = purgeClearance(facts({ legalHold: { active: true, matterRef: "M-9" } }), NOW)
    expect(() =>
      advance("PURGE_PENDING", "PURGING", {
        actor: OPERATOR,
        approvedBy: SECOND,
        approverIsOperator: true,
        purgeClearance: clearance,
      }),
    ).toThrow(/A legal hold is in force \(M-9\)/)
  })

  it("permits it on a complete clearance", () => {
    const { state } = advance("PURGE_PENDING", "PURGING", {
      actor: OPERATOR,
      approvedBy: SECOND,
      approverIsOperator: true,
      purgeClearance: purgeClearance(facts(), NOW),
    })
    expect(state).toBe("PURGING")
  })

  it("still refuses an unapproved purge before it looks at the clearance", () => {
    expect(() =>
      advance("PURGE_PENDING", "PURGING", { actor: OPERATOR, purgeClearance: purgeClearance(facts(), NOW) }),
    ).toThrow(/requires a recorded approver/)
  })

  it("refuses PURGING → PURGED_ZERO_INCREMENTAL_COST with no tombstone", () => {
    expect(() => advance("PURGING", "PURGED_ZERO_INCREMENTAL_COST", { actor: OPERATOR })).toThrow(
      /requires a tombstone/,
    )
  })

  it("permits it with a valid one", () => {
    const { state } = advance("PURGING", "PURGED_ZERO_INCREMENTAL_COST", {
      actor: OPERATOR,
      tombstone: tombstone(),
    })
    expect(state).toBe("PURGED_ZERO_INCREMENTAL_COST")
  })

  it("refuses a tombstone carrying customer content", () => {
    expect(() =>
      advance("PURGING", "PURGED_ZERO_INCREMENTAL_COST", {
        actor: OPERATOR,
        tombstone: tombstone({ legalName: "Midtown Arts Collective" }),
      }),
    ).toThrow(LifecycleError)
  })
})

describe("the tombstone carries five fields and no content", () => {
  it("declares exactly the five the requirement names", () => {
    expect([...TOMBSTONE_FIELDS]).toEqual([
      "tenantId",
      "lifecycle",
      "purgeManifestDigest",
      "approvals",
      "evidenceRef",
    ])
  })

  it("accepts a minimal, complete one", () => {
    expect(tombstoneProblems(tombstone())).toEqual([])
    expect(Object.keys(buildTombstone({
      tenantId: "t-01J9F5ZK3M4N5P6Q7R8S9T0V1W",
      registeredAt: "2024-09-01T00:00:00.000Z",
      purgeApprovedAt: NOW,
      purgedAt: NOW,
      purgeManifestDigest: "b".repeat(64),
      approvals: [
        { principalId: OPERATOR.principalId, role: "requested", at: NOW },
        { principalId: SECOND, role: "approved", at: NOW },
      ],
      evidenceRef: "audit:purge/midtown",
    })).sort()).toEqual([...TOMBSTONE_FIELDS].sort())
  })

  it.each([
    ["legalName", "Midtown Arts Collective"],
    ["displayName", "Midtown Arts"],
    ["primaryContactEmail", "head@midtown.example"],
    ["slug", "midtown-arts"],
    ["reason", "the board voted to wind the collective up"],
    ["manifest", { modules: ["governance"] }],
  ])("refuses the extra field %s without echoing its value", (field, value) => {
    const problems = tombstoneProblems(tombstone({ [field]: value }))
    expect(problems.map((p) => p.field)).toContain(field)
    expect(problems.find((p) => p.field === field)?.reason).toBe("not-permitted")
    expect(JSON.stringify(problems)).not.toContain(String(value))
  })

  it("refuses a name or an address where the opaque id belongs", () => {
    expect(tombstoneProblems(tombstone({ tenantId: "Midtown Arts Collective" }))[0]?.reason).toBe(
      "not-opaque",
    )
    expect(tombstoneProblems(tombstone({ tenantId: "head@midtown.example" }))[0]?.reason).toBe(
      "not-opaque",
    )
  })

  it("refuses anything but a full sha256 where the digest belongs", () => {
    for (const bad of ["a".repeat(63), "A".repeat(64), "not-a-digest", "z".repeat(64)]) {
      expect(tombstoneProblems(tombstone({ purgeManifestDigest: bad })).map((p) => p.reason)).toContain(
        "not-a-digest",
      )
    }
  })

  it("refuses evidence inlined instead of referenced", () => {
    expect(
      tombstoneProblems(tombstone({ evidenceRef: '{"steps":[{"step":"PURGING"}]}' })).map((p) => p.reason),
    ).toContain("not-a-reference")
    expect(tombstoneProblems(tombstone({ evidenceRef: "the audit log" })).map((p) => p.reason)).toContain(
      "not-a-reference",
    )
  })

  it("refuses a single approval, because one row cannot show two people agreed", () => {
    const problems = tombstoneProblems(
      tombstone({ approvals: [{ principalId: OPERATOR.principalId, role: "requested", at: NOW }] }),
    )
    expect(problems.map((p) => p.reason)).toContain("insufficient")
  })

  it("refuses a free-text field smuggled into an approval row", () => {
    const problems = tombstoneProblems(
      tombstone({
        approvals: [
          { principalId: OPERATOR.principalId, role: "requested", at: NOW, note: "spoke to the dean" },
          { principalId: SECOND, role: "approved", at: NOW },
        ],
      }),
    )
    expect(problems.map((p) => p.field)).toContain("approvals[0].note")
  })

  it("refuses a local timestamp — a tombstone outlives the zone that wrote it", () => {
    expect(
      tombstoneProblems(tombstone({ lifecycle: { registeredAt: "2024-09-01 09:00 EDT", purgeApprovedAt: NOW, purgedAt: NOW } })).map(
        (p) => p.reason,
      ),
    ).toContain("not-an-instant")
  })

  it("names every missing field rather than the first", () => {
    const problems = tombstoneProblems({ tenantId: "t-1234" })
    expect(problems.filter((p) => p.reason === "required").map((p) => p.field).sort()).toEqual(
      ["approvals", "evidenceRef", "lifecycle", "purgeManifestDigest"].sort(),
    )
  })

  it("refuses a non-object outright", () => {
    for (const bad of [null, undefined, "t-1234", 7, []]) {
      expect(tombstoneProblems(bad)[0]?.reason).toBe("not-a-tombstone")
    }
  })

  it("throws rather than returning a half-built one", () => {
    expect(() =>
      buildTombstone({
        tenantId: "t-01J9F5ZK3M4N5P6Q7R8S9T0V1W",
        registeredAt: "2024-09-01T00:00:00.000Z",
        purgeApprovedAt: NOW,
        purgedAt: NOW,
        purgeManifestDigest: "short",
        approvals: [
          { principalId: OPERATOR.principalId, role: "requested", at: NOW },
          { principalId: SECOND, role: "approved", at: NOW },
        ],
        evidenceRef: "audit:purge/midtown",
      }),
    ).toThrow(TombstoneRefused)
  })

  it("does not carry a caller's extra fields through on a spread", () => {
    const built = buildTombstone({
      tenantId: "t-01J9F5ZK3M4N5P6Q7R8S9T0V1W",
      registeredAt: "2024-09-01T00:00:00.000Z",
      purgeApprovedAt: NOW,
      purgedAt: NOW,
      purgeManifestDigest: "c".repeat(64),
      approvals: [
        { principalId: OPERATOR.principalId, role: "requested", at: NOW, note: "x" } as never,
        { principalId: SECOND, role: "approved", at: NOW },
      ],
      evidenceRef: "audit:purge/midtown",
    })
    expect(Object.keys(built.approvals[0])).toEqual(["principalId", "role", "at"])
  })
})
