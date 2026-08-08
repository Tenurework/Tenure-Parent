import type { DeploymentManifest, TenantManifest } from "@tenure/provisioning"

import { deliverToCell, deploymentSigningKey } from "./deliver"

/**
 * STUDIO-070-009 — the hand-off refuses an unsigned artifact.
 *
 * This is the CALLER-side half of the signature. Signing an artifact that
 * nothing checks is theatre; `deliverToCell` refusing to send one is what makes
 * the field load-bearing, and it mirrors `transition(_, "approved")` in
 * `@tenure/releases` refusing to approve an unsigned release.
 *
 * The refusal is asserted first, before the endpoint is even considered, so a
 * deployment with no cell configured and a deployment with no signature give
 * different answers — otherwise "not delivered" would cover both and nobody
 * could tell which problem they had.
 */

const tenant: TenantManifest = {
  manifestVersion: 1,
  slug: "simon-ose",
  legalName: "Simon Business School",
  displayName: "Simon OSE",
  blueprintId: "university-student-organizations",
  modules: ["governance"],
  entitlements: [],
  region: "us-east-1",
  isolation: "pooled",
  coexistence: "TENURE_CLOUD_PRIMARY",
  systemOfRecord: { org: "tenure" },
  configuration: {},
  secretRefs: {},
  initialAdminEmail: "admin@simon.example",
}

const artifact = (over: Partial<DeploymentManifest> = {}): DeploymentManifest =>
  ({
    slug: "simon-ose",
    manifestDigest: "m".repeat(32),
    configurationChecksum: "cfg",
    modules: ["governance@1.2.0"],
    blueprintId: "university-student-organizations",
    schemaVersion: "2026.07.31",
    configKeys: [],
    evidenceDigest: "e".repeat(32),
    releaseDigest: "r".repeat(32),
    resourceDigest: null,
    migrationDigest: null,
    testDigest: null,
    rollbackDigest: null,
    iacDigest: null,
    modelDigest: null,
    policyDigest: null,
    serving: false,
    digest: "d".repeat(32),
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "dana@tenure.example",
    ...over,
  }) as DeploymentManifest

describe("an unsigned artifact is not delivered", () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  it("refuses before it looks at the transport at all", async () => {
    // Both the endpoint AND the shared secret are configured here, so the only
    // possible reason to refuse is the missing signature. Without this the
    // assertion would pass for the wrong reason on any machine with no
    // CELL_RECONCILE_URL set — which is every machine.
    process.env.CELL_RECONCILE_URL = "https://cell.invalid/reconcile"
    process.env.PLATFORM_RECONCILE_SECRET = "shared-secret"

    const outcome = await deliverToCell(artifact(), tenant)
    expect(outcome.delivered).toBe(false)
    expect(outcome.detail).toMatch(/unsigned/)
    expect(outcome.detail).toMatch(/DEPLOYMENT_SIGNING_KEY_ID/)
    // And it never reached the network: a fetch to cell.invalid would have
    // produced the "cell did not answer" message instead.
    expect(outcome.detail).not.toMatch(/did not answer/)
  })

  it("tells an unsigned artifact apart from an unconfigured cell", async () => {
    delete process.env.CELL_RECONCILE_URL
    delete process.env.PLATFORM_RECONCILE_SECRET

    const signed = artifact({
      signature: { keyId: "studio-2026-08", algorithm: "hmac-sha256", value: "ab".repeat(32) },
    })
    const outcome = await deliverToCell(signed, tenant)
    expect(outcome.delivered).toBe(false)
    expect(outcome.detail).toMatch(/No cell endpoint is configured/)
    expect(outcome.detail).not.toMatch(/unsigned/)
  })
})

describe("the signing key comes from the environment, and its absence is not a default", () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  it("is null when either half is missing", () => {
    delete process.env.DEPLOYMENT_SIGNING_KEY_ID
    delete process.env.DEPLOYMENT_SIGNING_SECRET
    expect(deploymentSigningKey()).toBeNull()

    process.env.DEPLOYMENT_SIGNING_KEY_ID = "studio-2026-08"
    expect(deploymentSigningKey()).toBeNull()

    process.env.DEPLOYMENT_SIGNING_SECRET = "   "
    expect(deploymentSigningKey()).toBeNull()
  })

  it("is the pair when both are set", () => {
    process.env.DEPLOYMENT_SIGNING_KEY_ID = "studio-2026-08"
    process.env.DEPLOYMENT_SIGNING_SECRET = "a-real-looking-secret"
    expect(deploymentSigningKey()).toEqual({
      keyId: "studio-2026-08",
      secret: "a-real-looking-secret",
    })
  })
})
