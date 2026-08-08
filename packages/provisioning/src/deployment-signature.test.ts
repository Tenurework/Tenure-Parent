import { createHash } from "node:crypto"

import { deploymentManifest, executeStep, verifyDeployment, type ExecutionContext } from "./execute"
import { MANIFEST_VERSION } from "./manifest"
import type { TenantManifest } from "./manifest"

/**
 * STUDIO-070-009 — the artifact is signed, and the cell's verifier still agrees
 * about what the digest covers.
 *
 * Three call sites described this artifact as signed while `execute.ts` said in
 * as many words that nothing signed it. This is the half that makes the sentence
 * true; `deliver.test.ts` is the half that refuses to send an unsigned one.
 *
 * The last case in this file is the one that matters most and is the easiest to
 * get wrong: `verifyDigest` in `apps/web/src/lib/provisioning/reconcile.ts`
 * recomputes the digest over "everything except `digest`". Adding a `signature`
 * field WITHOUT teaching it to strip that too would have made every signed
 * artifact fail verification at the cell — a total provisioning outage that
 * compiles, and that no unit test on this side would notice.
 */

const KEY = { keyId: "studio-2026-08", secret: "a-real-looking-secret-value" }

const manifest = (over: Partial<TenantManifest> = {}): TenantManifest => ({
  manifestVersion: MANIFEST_VERSION,
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
  ...over,
})

const ctx: ExecutionContext = {
  resolveConfiguration: () => ({ checksum: "cfg-abc123", values: { a: 1 }, problems: [] }),
  resolveModules: () => ({ ordered: [{ key: "governance", version: "1.2.0" }], problems: [] }),
  validateTopology: () => ({ valid: true, problems: [] }),
  schemaVersion: () => "2026.07.31",
  resolveSecretRefs: () => ({}),
}

const META = {
  createdAt: "2026-08-01T00:00:00.000Z",
  createdBy: "dana@tenure.example",
  serving: true,
}

const evidence = () => [
  executeStep("CONFIGURING", manifest(), ctx, {
    correlationId: "sig-test",
    attempt: 1,
    // STUDIO-070-005. Spelled out rather than defaulted — the fields are
    // required precisely so a fixture cannot leave them out either.
    awsRequestIds: [],
    assumedRoleArn: null,
    resourceHandles: [],
    nextRetryAt: null,
    compensation: null,
  }),
]

describe("a deployment artifact can be attributed to the engine that produced it", () => {
  it("carries no signature when no key is configured, rather than a fake one", () => {
    const unsigned = deploymentManifest(manifest(), evidence(), ctx, META)
    expect(unsigned.signature).toBeUndefined()
    expect(verifyDeployment(unsigned, () => KEY.secret)).toEqual({
      valid: false,
      reason: "unsigned",
      detail: expect.stringMatching(/nothing about who produced it/),
    })
  })

  it("signs over the same bytes the digest covers", () => {
    const signed = deploymentManifest(manifest(), evidence(), ctx, { ...META, signWith: KEY })
    expect(signed.signature).toEqual({
      keyId: KEY.keyId,
      algorithm: "hmac-sha256",
      value: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(verifyDeployment(signed, (id) => (id === KEY.keyId ? KEY.secret : undefined))).toEqual({
      valid: true,
      keyId: KEY.keyId,
    })
  })

  it("refuses to verify under a key it cannot resolve", () => {
    const signed = deploymentManifest(manifest(), evidence(), ctx, { ...META, signWith: KEY })
    expect(verifyDeployment(signed, () => undefined)).toMatchObject({
      valid: false,
      reason: "unknown-key",
    })
  })

  it("refuses an artifact whose content changed after signing", () => {
    const signed = deploymentManifest(manifest(), evidence(), ctx, { ...META, signWith: KEY })
    const tampered = { ...signed, serving: false }
    expect(verifyDeployment(tampered, () => KEY.secret)).toMatchObject({
      valid: false,
      reason: "content-altered",
    })
  })

  it("refuses to sign with an empty secret", () => {
    // A signature anyone can reproduce is worse than a visibly missing one: it
    // teaches an operator to trust a property the artifact does not have.
    expect(() =>
      deploymentManifest(manifest(), evidence(), ctx, {
        ...META,
        signWith: { keyId: "studio", secret: "" },
      }),
    ).toThrow(/Refusing to sign/)
  })

  it("survives a round trip through a store that loses key order", () => {
    const signed = deploymentManifest(manifest(), evidence(), ctx, { ...META, signWith: KEY })
    const shuffled = Object.fromEntries(Object.entries(signed).reverse()) as typeof signed
    expect(Object.keys(shuffled)).not.toEqual(Object.keys(signed))
    expect(verifyDeployment(shuffled, () => KEY.secret)).toMatchObject({ valid: true })
  })
})

describe("the three digests the engine can only be told", () => {
  it("says null rather than inventing a value nobody supplied", () => {
    const artifact = deploymentManifest(manifest(), evidence(), ctx, META)
    expect(artifact.iacDigest).toBeNull()
    expect(artifact.modelDigest).toBeNull()
    expect(artifact.policyDigest).toBeNull()
  })

  it("covers each of them in the digest, so they are not decoration", () => {
    const base = deploymentManifest(manifest(), evidence(), ctx, META)
    for (const field of ["iacDigest", "modelDigest", "policyDigest"] as const) {
      const stated = deploymentManifest(manifest(), evidence(), ctx, {
        ...META,
        [field]: "0".repeat(32),
      })
      expect(stated[field]).toBe("0".repeat(32))
      expect(stated.digest).not.toBe(base.digest)
    }
  })

  it("names the artifact it rolls back to when the caller supplies one", () => {
    const first = deploymentManifest(manifest(), evidence(), ctx, { ...META, serving: false })
    expect(first.rollbackDigest).toBeNull()
    const second = deploymentManifest(manifest(), evidence(), ctx, {
      ...META,
      previousDigest: first.digest,
    })
    expect(second.rollbackDigest).toBe(first.digest)
    expect(second.digest).not.toBe(first.digest)
  })
})

describe("the cell's independent verifier still agrees about what the digest covers", () => {
  /**
   * The cell's implementation, reproduced here EXACTLY as
   * `apps/web/src/lib/provisioning/reconcile.ts` writes it.
   *
   * Reproduced rather than imported on purpose, and for the same reason that
   * file keeps its own copy: two implementations that share a helper drift
   * together and still agree. If either side ever changes which fields it
   * strips, this reds — which is the whole point, because the alternative is
   * discovering it against a real tenant.
   */
  const cellVerifyDigest = (artifact: Record<string, unknown>): boolean => {
    const { digest, signature, ...body } = artifact
    void signature
    const canonical = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonical)
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      }
      return value
    }
    const computed = createHash("sha256")
      .update(JSON.stringify(canonical(body)))
      .digest("hex")
      .slice(0, 32)
    return computed === digest
  }

  it("verifies a SIGNED artifact — the field must not be inside the hashed body", () => {
    const signed = deploymentManifest(manifest(), evidence(), ctx, { ...META, signWith: KEY })
    expect(signed.signature).toBeDefined()
    expect(cellVerifyDigest(signed as unknown as Record<string, unknown>)).toBe(true)
  })

  it("still refuses an artifact whose content actually changed", () => {
    const signed = deploymentManifest(manifest(), evidence(), ctx, { ...META, signWith: KEY })
    const tampered = { ...signed, configurationChecksum: "cfg-tampered" }
    expect(cellVerifyDigest(tampered as unknown as Record<string, unknown>)).toBe(false)
  })
})
