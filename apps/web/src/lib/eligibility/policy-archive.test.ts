import { PolicyArchive, SHIPPED_POLICY_ARCHIVE, catalogDigestOf } from "./policy-archive"
import { compilePolicyOrThrow, type AttributeCatalog, type EligibilityPolicy } from "./policy"
import { COMPILED_TENANT_ENTRY_POLICY, TENANT_ENTRY_POLICY } from "./tenant-entry"

/**
 * IER-070-009 — "Preserve past policy versions needed for historical
 * explanations."
 *
 * The property under test is not "the archive stores things". It is that
 * storing a NEW version leaves the old one exactly where it was, byte for byte,
 * and that a digest nobody archived comes back as nothing rather than as the
 * current version.
 */

const CATALOG: AttributeCatalog = {
  "affiliation.status": {
    id: "affiliation.status",
    type: "enum",
    members: ["ACTIVE", "ENDED"],
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 3_600_000,
    derivation: "SOURCE_ASSERTED",
  },
}

function policy(overrides: Partial<EligibilityPolicy> = {}): EligibilityPolicy {
  return {
    policyId: "test.archive",
    version: "1",
    owner: "platform-identity",
    purpose: "test",
    target: "tenant.workspace",
    requiresTenantCapability: "core.workspace",
    subject: "person",
    risk: "LOW",
    activeFrom: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    rollout: { percent: 100, cohortSalt: "salt" },
    attributes: [{ attribute: "affiliation.status", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 600_000 }],
    requiredSources: [],
    deny: [],
    conditions: { all: [{ attribute: "affiliation.status", op: "in", values: ["ACTIVE"] }] },
    conditionallyEligible: [],
    onMissing: "INDETERMINATE",
    onStale: "INDETERMINATE",
    onConflict: "MANUAL_REVIEW_REQUIRED",
    onSourceUnavailable: "INDETERMINATE",
    exceptions: [],
    reviewEveryDays: 180,
    approvedBy: "platform-identity",
    rollbackTo: null,
    ...overrides,
  }
}

const V1 = compilePolicyOrThrow(policy(), CATALOG)
const V2 = compilePolicyOrThrow(
  policy({
    version: "2",
    activeFrom: "2026-07-01T00:00:00.000Z",
    // A real change of meaning: v2 also admits a person on leave.
    conditions: { all: [{ attribute: "affiliation.status", op: "in", values: ["ACTIVE", "ENDED"] }] },
    rollbackTo: "1",
  }),
  CATALOG,
)

describe("IER-070-009 — a superseded policy version is still readable", () => {
  it("v1 and v2 have different digests, so a receipt can tell them apart", () => {
    expect(V1.digest).not.toEqual(V2.digest)
  })

  it("registering v2 does not disturb v1", () => {
    const archive = new PolicyArchive()
    archive.register(V1, "2026-01-01T00:00:00.000Z")
    const before = JSON.stringify(archive.byDigest(V1.digest))

    archive.register(V2, "2026-07-01T00:00:00.000Z")

    expect(JSON.stringify(archive.byDigest(V1.digest))).toEqual(before)
    expect(archive.size()).toBe(2)
  })

  it("the archived v1 still carries the conditions v1 decided with, not v2's", () => {
    const archive = new PolicyArchive()
    archive.register(V1, "2026-01-01T00:00:00.000Z")
    archive.register(V2, "2026-07-01T00:00:00.000Z")

    const archived = archive.byDigest(V1.digest)
    expect(archived).not.toBeNull()
    expect(archived?.policy.conditions).toEqual({
      all: [{ attribute: "affiliation.status", op: "in", values: ["ACTIVE"] }],
    })
    expect(archived?.version).toBe("1")
  })

  it("an unarchived digest is null — never the current version", () => {
    const archive = new PolicyArchive()
    archive.register(V2, "2026-07-01T00:00:00.000Z")
    expect(archive.byDigest(V1.digest)).toBeNull()
  })

  it("re-registering keeps the original archival instant", () => {
    const archive = new PolicyArchive()
    archive.register(V1, "2026-01-01T00:00:00.000Z")
    const again = archive.register(V1, "2027-12-31T00:00:00.000Z")
    expect(again.archivedAt).toBe("2026-01-01T00:00:00.000Z")
    expect(archive.size()).toBe(1)
  })

  it("versionsOf returns every version of one policy, oldest activation first", () => {
    const archive = new PolicyArchive()
    archive.register(V2, "2026-07-01T00:00:00.000Z")
    archive.register(V1, "2026-01-01T00:00:00.000Z")
    expect(archive.versionsOf("test.archive").map((entry) => entry.version)).toEqual(["1", "2"])
    expect(archive.versionsOf("nobody.else")).toEqual([])
  })

  it("the catalog is archived with its own digest, because changing it changes decisions without changing the policy", () => {
    // The same policy document, compiled against a catalog that admits an
    // older assertion. Nothing in the policy moved; what counts as stale did.
    const relaxed: AttributeCatalog = {
      "affiliation.status": { ...CATALOG["affiliation.status"], maxAgeMs: 7_200_000 },
    }
    const sameDocumentDifferentCatalog = compilePolicyOrThrow(policy(), relaxed)

    expect(sameDocumentDifferentCatalog.digest).toBe(V1.digest)
    expect(catalogDigestOf(relaxed)).not.toBe(catalogDigestOf(CATALOG))

    const archive = new PolicyArchive()
    const entry = archive.register(V1, "2026-01-01T00:00:00.000Z")
    expect(entry.catalogDigest).toBe(catalogDigestOf(CATALOG))
  })

  it("the shipped tenant-entry policy is archived at import, under its own activation instant", () => {
    const archived = SHIPPED_POLICY_ARCHIVE.byDigest(COMPILED_TENANT_ENTRY_POLICY.digest)
    expect(archived).not.toBeNull()
    expect(archived?.policyId).toBe("tenure.tenant-entry.v1")
    expect(archived?.archivedAt).toBe(TENANT_ENTRY_POLICY.activeFrom)
    expect(archived?.approvedBy).toBe(TENANT_ENTRY_POLICY.approvedBy)
    expect(SHIPPED_POLICY_ARCHIVE.versionsOf("tenure.tenant-entry.v1").length).toBeGreaterThan(0)
  })
})
