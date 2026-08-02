import {
  AdoptionRefused,
  REQUIRED_ADOPTION_CHECKS,
  adoptTenant,
  type AdoptionEvidence,
  type AdoptionInput,
} from "./adoption"
import { MANIFEST_VERSION } from "./manifest"
import { loginProjection } from "./tenant-registry"

/**
 * Adopting Simon OSE.
 *
 * The pilot has been serving real students since before this control plane
 * existed. Bringing it under the engine is a real operation with a real
 * temptation attached: write a provisioning history so it looks like every
 * other tenant. These tests are mostly about refusing that.
 */
const SIMON: AdoptionInput["manifest"] = {
  manifestVersion: MANIFEST_VERSION,
  slug: "rochester",
  legalName: "University of Rochester",
  displayName: "Simon Business School — Ainslie OSE",
  blueprintId: "university-student-organizations",
  modules: ["organizations", "administration"],
  entitlements: ["finance"],
  region: "us-east-1",
  isolation: "pooled",
  configuration: {},
  secretRefs: {},
  initialAdminEmail: "ose@example.invalid",
  notes: "Adopted; predates the registry.",
}

const evidence = (over: Partial<Record<string, boolean>> = {}): AdoptionEvidence[] =>
  REQUIRED_ADOPTION_CHECKS.map((check) => ({
    check,
    passed: over[check] ?? true,
    detail: `checked ${check}`,
  }))

const INPUT: AdoptionInput = {
  manifest: SIMON,
  tenantId: "tnt_01simonose0000000000000000",
  cellId: "cell-us-east-1-a",
  release: "1.0.512",
  primaryContactEmail: "ose@example.invalid",
  plan: "institution",
  residency: ["us-east-1"],
  evidence: evidence(),
  at: "2026-08-02T00:00:00.000Z",
}

describe("adoption produces a real record, and says it was adopted", () => {
  it("brings the pilot under the engine", () => {
    const record = adoptTenant(INPUT)
    expect(record.slug).toBe("rochester")
    expect(record.displayName).toBe("Simon Business School — Ainslie OSE")
    expect(record.legalName).toBe("University of Rochester")
    expect(record.entitlements).toEqual(["finance"])
    expect(record.placement).toEqual({
      cellId: "cell-us-east-1-a",
      region: "us-east-1",
      placedAt: "2026-08-02T00:00:00.000Z",
    })
  })

  it("marks it adopted, not composed", () => {
    // The whole point. Writing a DRAFT → PROVISIONED history would be a lie in
    // the one place the platform's honesty is load-bearing, because nobody ran
    // those steps — the tenant was built by hand, by people, over months.
    expect(adoptTenant(INPUT).provenance).toBe("adopted")
  })

  it("records it as ACTIVE, because it is", () => {
    // Starting at REGISTERED would be the mirror-image lie: a record saying
    // nothing has been provisioned, for a system with live users in it.
    expect(adoptTenant(INPUT).lifecycle).toBe("ACTIVE")
  })

  it("claims no configuration revision", () => {
    // The engine has applied nothing. The tenant's configuration came from the
    // file binding, and claiming revision 1 would make the next reconcile
    // compare against a revision that never existed.
    expect(adoptTenant(INPUT).configRevision).toBe(0)
  })

  it("resolves at sign-in like any other serving tenant", () => {
    // The observable outcome: the pilot is now routable through the registry
    // rather than through a file the login path cannot see.
    expect(loginProjection(adoptTenant(INPUT))).toEqual({
      slug: "rochester",
      displayName: "Simon Business School — Ainslie OSE",
      cellId: "cell-us-east-1-a",
      region: "us-east-1",
    })
  })
})

describe("adoption asserts only what was checked", () => {
  it("refuses when a required check has no evidence", () => {
    // An adoption that skipped its checks is a registry record claiming a cell
    // holds a tenant it may not hold.
    const partial = { ...INPUT, evidence: [evidence()[0]] }
    expect(() => adoptTenant(partial)).toThrow(AdoptionRefused)
    expect(() => adoptTenant(partial)).toThrow(/missing evidence for: cell-serves-it/)
  })

  it("refuses when a check failed", () => {
    const failing = { ...INPUT, evidence: evidence({ "cell-serves-it": false }) }
    expect(() => adoptTenant(failing)).toThrow(/cell-serves-it/)
  })

  it("names every failed check, not the first", () => {
    const failing = {
      ...INPUT,
      evidence: evidence({ "cell-serves-it": false, "institution-exists": false }),
    }
    try {
      adoptTenant(failing)
      throw new Error("should have refused")
    } catch (err) {
      expect((err as Error).message).toMatch(/cell-serves-it/)
      expect((err as Error).message).toMatch(/institution-exists/)
    }
  })

  it("requires an administrator", () => {
    // A tenant nobody can administer is not adopted, it is inherited.
    expect(() =>
      adoptTenant({ ...INPUT, evidence: evidence({ "administrator-identified": false }) }),
    ).toThrow(/administrator-identified/)
  })

  it("refuses to write a record that would not validate", () => {
    // Adoption goes through the same validator as composition, so an adopted
    // tenant cannot be placed outside its residency either.
    expect(() => adoptTenant({ ...INPUT, residency: ["eu-west-1"] })).toThrow(
      /residency|placement.region/,
    )
  })
})
