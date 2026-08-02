import {
  canTransition,
  isServing,
  loginProjection,
  validateRegistryRecord,
  type TenantLifecycle,
  type TenantRegistryRecord,
} from "./tenant-registry"

/**
 * GE-030-001 — the global tenant registry.
 *
 * The interesting assertions are not "does it store a field". They are the
 * three places this record can be wrong in a way nobody notices: a tenant
 * placed outside the region it is contractually allowed to be in, a lifecycle
 * that can go somewhere it should not, and a login projection that leaks the
 * customer list.
 */
const RECORD: TenantRegistryRecord = {
  tenantId: "tnt_01HQ0000000000000000000000",
  slug: "rochester",
  lifecycle: "ACTIVE",
  provenance: "composed",
  legalName: "University of Rochester",
  displayName: "Simon Business School — Ainslie OSE",
  primaryContactEmail: "ose@example.invalid",
  plan: "institution",
  entitlements: ["finance"],
  residency: ["us-east-1", "us-west-2"],
  isolation: "pooled",
  placement: { cellId: "cell-use1-a", region: "us-east-1", placedAt: "2026-08-01T00:00:00.000Z" },
  release: "1.0.512",
  configRevision: 7,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
}

describe("the record validates before it is written", () => {
  it("accepts a well-formed record", () => {
    expect(validateRegistryRecord(RECORD)).toEqual([])
  })

  it("refuses a placement outside the residency the customer agreed to", () => {
    // The one that is a contractual breach rather than a bug. A migration can
    // satisfy capacity and violate residency at the same time, which is exactly
    // what a single "region" field cannot express.
    const moved = {
      ...RECORD,
      placement: { ...RECORD.placement, region: "eu-west-1" },
    }
    expect(validateRegistryRecord(moved)).toEqual([
      {
        field: "placement.region",
        reason: "residency-violation",
        detail: "placed in eu-west-1, which is not among us-east-1, us-west-2",
      },
    ])
  })

  it("refuses an empty residency list rather than reading it as 'anywhere'", () => {
    // "Anywhere" is never what a customer with a residency requirement agreed
    // to, and an empty list is the easiest way to get there by accident.
    const problems = validateRegistryRecord({ ...RECORD, residency: [] })
    expect(problems.map((p) => p.field)).toContain("residency")
  })

  it("reports every problem, not the first", () => {
    const problems = validateRegistryRecord({
      ...RECORD,
      tenantId: "",
      legalName: "",
      primaryContactEmail: "nobody",
      configRevision: -1,
    })
    expect(problems.map((p) => p.field).sort()).toEqual(
      ["configRevision", "legalName", "primaryContactEmail", "tenantId"].sort(),
    )
  })

  it("holds the slug to something that can be a URL segment", () => {
    for (const bad of ["Rochester", "ro", "-rochester", "rochester-", "roch ester", "roch_ester"]) {
      expect(validateRegistryRecord({ ...RECORD, slug: bad }).map((p) => p.field)).toContain("slug")
    }
    for (const ok of ["rochester", "midtown-arts", "a1b", "x".repeat(40)]) {
      expect(validateRegistryRecord({ ...RECORD, slug: ok }).map((p) => p.field)).not.toContain(
        "slug",
      )
    }
  })

  it("keeps the id separate from the slug", () => {
    // A slug is a URL and customers ask to change URLs. If the id were the
    // slug, a rename would either break every reference or require rewriting
    // them — and rewriting is how an audit trail comes to point at a tenant
    // that no longer exists under that name.
    const renamed = { ...RECORD, slug: "simon" }
    expect(validateRegistryRecord(renamed)).toEqual([])
    expect(renamed.tenantId).toBe(RECORD.tenantId)
  })
})

describe("the lifecycle only goes where it may", () => {
  it("cannot come back from archived", () => {
    // Restoring a tenant is a new registration against a restored backup — a
    // different operation with a different approval, not an edge on this graph.
    for (const to of [
      "REGISTERED",
      "PROVISIONING",
      "ACTIVE",
      "SUSPENDED",
      "MIGRATING",
      "DEPROVISIONING",
    ] as TenantLifecycle[]) {
      expect(canTransition("ARCHIVED", to)).toBe(false)
    }
  })

  it("cannot skip deprovisioning on the way out", () => {
    expect(canTransition("ACTIVE", "ARCHIVED")).toBe(false)
    expect(canTransition("SUSPENDED", "ARCHIVED")).toBe(false)
    expect(canTransition("ACTIVE", "DEPROVISIONING")).toBe(true)
    expect(canTransition("DEPROVISIONING", "ARCHIVED")).toBe(true)
  })

  it("lets a suspension be undone and a migration finish", () => {
    expect(canTransition("ACTIVE", "SUSPENDED")).toBe(true)
    expect(canTransition("SUSPENDED", "ACTIVE")).toBe(true)
    expect(canTransition("ACTIVE", "MIGRATING")).toBe(true)
    expect(canTransition("MIGRATING", "ACTIVE")).toBe(true)
  })

  it("does not treat migration as a way out of a suspension", () => {
    // Suspended is a commercial state. Migrating out of it would resume service
    // for a tenant somebody deliberately stopped.
    expect(canTransition("SUSPENDED", "MIGRATING")).toBe(false)
  })
})

describe("only a serving tenant resolves", () => {
  it("serves in exactly the two states where the tenant is live", () => {
    const serving = (
      [
        "REGISTERED",
        "PROVISIONING",
        "ACTIVE",
        "SUSPENDED",
        "MIGRATING",
        "DEPROVISIONING",
        "ARCHIVED",
      ] as TenantLifecycle[]
    ).filter(isServing)
    // A migration keeps serving — that is the point of a migration.
    expect(serving.sort()).toEqual(["ACTIVE", "MIGRATING"])
  })
})

describe("the login projection", () => {
  it("carries exactly four fields, and no more", () => {
    // The load-bearing test. The login page is reachable by anyone, so whatever
    // it can read is effectively public — and "which universities use Tenure,
    // in which regions, on which plan" is a customer list. A projection is only
    // safe while nobody adds a field to it, so the field list is asserted rather
    // than described.
    expect(Object.keys(loginProjection(RECORD)!).sort()).toEqual([
      "cellId",
      "displayName",
      "region",
      "slug",
    ])
  })

  it("leaks nothing commercial or contactable", () => {
    const projected = JSON.stringify(loginProjection(RECORD))
    for (const secret of [
      RECORD.legalName,
      RECORD.primaryContactEmail,
      RECORD.plan,
      RECORD.tenantId,
      RECORD.release,
      "finance",
    ]) {
      expect(projected).not.toContain(secret)
    }
  })

  it("does not resolve a tenant that is not serving", () => {
    // A suspended tenant that still resolved would present a sign-in form that
    // cannot work — and the difference between "wrong password" and "your
    // institution is suspended" is a fact about that institution's commercial
    // relationship, told to whoever typed the URL.
    for (const lifecycle of [
      "REGISTERED",
      "PROVISIONING",
      "SUSPENDED",
      "DEPROVISIONING",
      "ARCHIVED",
    ] as TenantLifecycle[]) {
      expect(loginProjection({ ...RECORD, lifecycle })).toBeNull()
    }
  })

  it("keeps serving through a migration", () => {
    expect(loginProjection({ ...RECORD, lifecycle: "MIGRATING" })).not.toBeNull()
  })
})
