import { PrismaClient } from "@prisma/client"
import { createHash } from "node:crypto"

import { ReconcileRefused, reconcile, verifyDigest, type DeploymentManifest } from "./reconcile"

/**
 * The reconciler, against a real database.
 *
 * Idempotency cannot be tested with a mock. The property under test is that the
 * DATABASE refuses a duplicate — unique constraints on the slug, the email and
 * the (user, institution) pair — and a fake client would happily accept two of
 * everything and report success.
 *
 * Needs Postgres:
 *   DATABASE_URL=postgresql://tenure:tenure@localhost:5433/tenure
 */
const db = new PrismaClient({ log: ["error"] })

const SLUG = `itest-recon-${process.pid}`
const ADMIN = `admin-${process.pid}@example.invalid`

/** Build a manifest whose digest actually verifies, the way the engine does. */
function signed(over: Partial<DeploymentManifest> = {}): DeploymentManifest {
  const body = {
    slug: SLUG,
    manifestDigest: "manifest-digest-abc",
    configurationChecksum: "cfg-abc123",
    modules: ["organizations@1.0.0", "administration@1.0.0"],
    blueprintId: "university-student-organizations",
    schemaVersion: "2026.07.31",
    evidenceDigest: "evidence-abc",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "operator@tenure.example",
    ...over,
  }
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32)
  return { ...body, digest }
}

const input = (manifest: DeploymentManifest) => ({
  manifest,
  displayName: "Reconcile Integration Test",
  initialAdminEmail: ADMIN,
  cellSchemaVersion: "2026.07.31",
  at: "2026-08-01T00:00:00.000Z",
})

async function cleanup() {
  const inst = await db.institution.findUnique({ where: { slug: SLUG } })
  if (inst) {
    await db.auditEvent.deleteMany({ where: { institutionId: inst.id } })
    await db.institutionMembership.deleteMany({ where: { institutionId: inst.id } })
    await db.institution.delete({ where: { id: inst.id } })
  }
  await db.user.deleteMany({ where: { email: ADMIN } })
}

beforeAll(cleanup)
afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe("reconcile", () => {
  it("materialises the tenant on first run", async () => {
    const report = await reconcile(db, input(signed()))

    expect(report.applied).toBe(true)
    expect(report.changes).toEqual([
      `created institution "${SLUG}"`,
      "created the administrator account",
      "granted director rights to the administrator",
    ])

    const inst = await db.institution.findUnique({ where: { slug: SLUG } })
    expect(inst).not.toBeNull()

    const membership = await db.institutionMembership.findFirst({
      where: { institutionId: inst!.id },
      include: { user: true },
    })
    expect(membership!.role).toBe("OSE_DIRECTOR")
    expect(membership!.user.email).toBe(ADMIN)
  })

  it("is idempotent — a second run changes nothing and duplicates nothing", async () => {
    // GE-102-011. This is the requirement; everything else in the module exists
    // to make it true.
    const before = {
      institutions: await db.institution.count({ where: { slug: SLUG } }),
      users: await db.user.count({ where: { email: ADMIN } }),
    }

    const report = await reconcile(db, input(signed()))

    expect(report.changes).toEqual([])
    expect(await db.institution.count({ where: { slug: SLUG } })).toBe(before.institutions)
    expect(await db.user.count({ where: { email: ADMIN } })).toBe(before.users)

    const inst = await db.institution.findUnique({ where: { slug: SLUG } })
    expect(await db.institutionMembership.count({ where: { institutionId: inst!.id } })).toBe(1)
  })

  it("survives concurrent reconciles without duplicating anything", async () => {
    // The case a check-then-write cannot handle: both callers see nothing and
    // both write. Only the database can arbitrate.
    await cleanup()

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => reconcile(db, input(signed()))),
    )
    // At least one must succeed; losers of a write race may throw, which is
    // correct — what must NOT happen is two of anything.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true)

    expect(await db.institution.count({ where: { slug: SLUG } })).toBe(1)
    expect(await db.user.count({ where: { email: ADMIN } })).toBe(1)
    const inst = await db.institution.findUnique({ where: { slug: SLUG } })
    expect(await db.institutionMembership.count({ where: { institutionId: inst!.id } })).toBe(1)
  })

  it("refuses an artifact that does not verify", async () => {
    // Altered in transit: the field changes, the digest does not.
    const tampered = { ...signed(), configurationChecksum: "cfg-tampered" }
    expect(await verifyDigest(tampered)).toBe(false)

    await expect(reconcile(db, input(tampered))).rejects.toThrow(ReconcileRefused)
    await expect(reconcile(db, input(tampered))).rejects.toThrow(/altered between publication/)
  })

  it("refuses to apply across a schema boundary", async () => {
    // An engine ahead references columns the cell lacks; one behind omits
    // configuration the cell now requires. Both are wrong to guess at.
    const ahead = signed({ schemaVersion: "2026.12.01" })
    await expect(reconcile(db, input(ahead))).rejects.toThrow(/do not apply across a schema boundary/)
  })

  it("refuses without a usable administrator", async () => {
    await expect(
      reconcile(db, { ...input(signed()), initialAdminEmail: "not-an-address" }),
    ).rejects.toThrow(/nobody can sign into/)
  })

  it("records which artifact materialised the tenant", async () => {
    await cleanup()
    await reconcile(db, input(signed()))

    const inst = await db.institution.findUnique({ where: { slug: SLUG } })
    const audit = await db.auditEvent.findFirst({
      where: { institutionId: inst!.id, action: "Tenant.Reconciled" },
    })

    // Without this, "which manifest produced this tenant?" has no answer after
    // the fact — and that is the question asked first in an incident.
    expect(audit).not.toBeNull()
    const meta = audit!.metadata as Record<string, unknown>
    expect(meta.deploymentDigest).toBe(signed().digest)
    expect(meta.configurationChecksum).toBe("cfg-abc123")
  })
})

describe("engine and cell agree on what a digest covers", () => {
  it("an artifact the ENGINE signs verifies with the CELL's independent verifier", async () => {
    // The one assertion that ties the two halves together.
    //
    // `deploymentManifest` (packages/provisioning) and `verifyDigest`
    // (apps/web) compute the digest separately, on purpose — a shared helper
    // would let both drift together and still agree. This test is what makes
    // that separation safe rather than merely principled: if either side ever
    // changes which fields are covered, an artifact stops verifying HERE,
    // loudly, instead of in production against a real tenant.
    const { deploymentManifest, executeStep, MANIFEST_VERSION } = await import("@tenure/provisioning")

    const tenantManifest = {
      manifestVersion: MANIFEST_VERSION,
      slug: SLUG,
      legalName: "Reconcile Integration Test",
      displayName: "Reconcile Integration Test",
      blueprintId: "university-student-organizations",
      modules: ["organizations"],
      entitlements: [],
      region: "us-east-1",
      isolation: "pooled" as const,
      configuration: {},
      secretRefs: {},
      initialAdminEmail: ADMIN,
    }

    const ctx = {
      resolveConfiguration: () => ({ checksum: "cfg-cross-check", values: { a: 1 }, problems: [] }),
      resolveModules: () => ({ ordered: [{ key: "organizations", version: "1.0.0" }], problems: [] }),
      validateTopology: () => ({ valid: true, problems: [] }),
      schemaVersion: () => "2026.07.31",
    }

    const evidence = [executeStep("CONFIGURING", tenantManifest, ctx)]
    const produced = deploymentManifest(tenantManifest, evidence, ctx, {
      createdAt: "2026-08-01T00:00:00.000Z",
      createdBy: "operator@tenure.example",
    })

    expect(await verifyDigest(produced)).toBe(true)

    // And the cell applies it end to end — the full round trip, engine to rows.
    await cleanup()
    const report = await reconcile(db, {
      manifest: produced,
      displayName: "Reconcile Integration Test",
      initialAdminEmail: ADMIN,
      cellSchemaVersion: "2026.07.31",
      at: "2026-08-01T00:00:00.000Z",
    })

    expect(report.applied).toBe(true)
    expect(report.changes).toContain(`created institution "${SLUG}"`)
    expect(await db.institution.count({ where: { slug: SLUG } })).toBe(1)
  })
})
