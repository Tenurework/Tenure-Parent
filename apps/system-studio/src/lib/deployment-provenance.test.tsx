import { renderToStaticMarkup } from "react-dom/server"

import type { DeploymentManifest, StepEvidence, TenantManifest } from "@tenure/provisioning"

import { DeploymentPanel } from "../components/DeploymentPanel"

/**
 * STUDIO-070-009 — the artifact's signature and its rollback target, asserted on
 * the PRODUCER.
 *
 * `runAdvance` is what publishes an artifact. It signs with the key
 * `deploymentSigningKey()` returns and it passes `previousDigest:
 * tenant.deployment?.digest`, which is the whole of the fix that stopped
 * `rollbackDigest` being permanently null. Neither of those had a test that
 * failed when the caller stopped doing it: the package's own suite calls
 * `deploymentManifest` with an explicit `previousDigest` and stays green while
 * the only real caller passes nothing — the exact shape of failure this
 * programme has already paid for twice.
 *
 * So this test drives the real `runAdvance` against a tenant that ALREADY has a
 * published artifact, takes the artifact `runAdvance` actually handed to the
 * registry, and renders the real panel over it. Mutating `previousDigest` to
 * `null` in `command-handlers.ts` reds it; mutating `signWith` to `undefined`
 * reds it.
 *
 * ## The registry stand-in
 *
 * DynamoDB is replaced and nothing else is: the lifecycle rules, the change-class
 * gate, the executor, the signing and the panel are all real. `getTenant`
 * returns a `deployment` the way the real one does — the item at `sk =
 * "DEPLOYMENT"` — because that value is the thing under test.
 */

const PREVIOUS_DIGEST = "1f".repeat(16)

let published: DeploymentManifest | undefined

const manifest = (): TenantManifest => ({
  manifestVersion: 1,
  slug: "simon-ose",
  legalName: "Simon Business School",
  displayName: "Simon OSE",
  blueprintId: "university-student-organizations",
  modules: ["organizations"],
  entitlements: [],
  region: "us-east-1",
  isolation: "pooled",
  coexistence: "TENURE_CLOUD_PRIMARY",
  systemOfRecord: { org: "tenure" },
  configuration: {},
  secretRefs: {},
  initialAdminEmail: "admin@simon.example",
})

/** The artifact already in the registry — what a second publication rolls back to. */
const priorDeployment = () =>
  ({
    slug: "simon-ose",
    digest: PREVIOUS_DIGEST,
    configurationChecksum: "c".repeat(32),
    configKeys: [],
    schemaVersion: "unpinned",
    migrationDigest: null,
    modules: ["organizations"],
    resourceDigest: "r".repeat(32),
    testDigest: "t".repeat(32),
    evidenceDigest: "e".repeat(32),
    releaseDigest: null,
    rollbackDigest: null,
    iacDigest: null,
    modelDigest: null,
    policyDigest: null,
    serving: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "dana@tenure.example",
  }) as unknown as DeploymentManifest

jest.mock("./registry", () => ({
  tableName: () => "tenure-studio-tenants",
  getTenant: jest.fn(async () => ({
    slug: "simon-ose",
    awsRequestIds: ["DDB-REQ-0001"],
    manifest: manifest(),
    state: "VALIDATING" as const,
    digest: "d".repeat(32),
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    history: [],
    evidence: [],
    deployment: priorDeployment(),
  })),
  advanceTenant: jest.fn(
    async (
      _slug: string,
      to: string,
      _o: unknown,
      _evidence: StepEvidence,
      deployment?: DeploymentManifest,
    ) => {
      published = deployment
      return { record: { state: to }, awsRequestId: "write-id" }
    },
  ),
  startCoolingOff: jest.fn(async (_s: string, _a: string, requestedBy: string, at: string) => ({
    requestedAt: at,
    requestedBy,
  })),
}))

// The real `deliverToCell` is not exercised here — CONFIGURING does not deliver
// — but `deploymentSigningKey` is what decides whether the artifact is signed,
// so it is given a key rather than mocked away.
jest.mock("./deliver", () => ({
  deliverToCell: jest.fn(async () => ({ delivered: true, changes: [], detail: "applied" })),
  deploymentSigningKey: () => ({ keyId: "studio-test", secret: "a-secret" }),
}))

import { runAdvance } from "./command-handlers"

beforeEach(() => {
  published = undefined
})

async function publishAndRender() {
  const outcome = await runAdvance({
    slug: "simon-ose",
    to: "CONFIGURING",
    principalId: "dana@tenure.example",
    approvedBy: "sam@tenure.example",
    at: "2026-08-07T12:00:00.000Z",
  })
  expect(outcome.ok).toBe(true)
  expect(published).toBeDefined()
  return {
    deployment: published!,
    markup: renderToStaticMarkup(<DeploymentPanel deployment={published!} />),
  }
}

describe("the artifact a publication actually emits", () => {
  it("names the artifact it rolls back to, taken from the one already published", async () => {
    const { deployment, markup } = await publishAndRender()
    expect(deployment.rollbackDigest).toBe(PREVIOUS_DIGEST)
    expect(markup).toContain(PREVIOUS_DIGEST)
    expect(markup).not.toContain("this is the first artifact published")
  })

  it("is signed, by the key the engine is configured with", async () => {
    const { deployment, markup } = await publishAndRender()
    expect(deployment.signature).toBeDefined()
    expect(deployment.signature?.algorithm).toBe("hmac-sha256")
    expect(deployment.signature?.keyId).toBe("studio-test")
    expect(markup).toContain("hmac-sha256 by studio-test")
    expect(markup).not.toContain("data-deployment-problem")
  })

  it("states the three digests it does not carry rather than leaving them blank", async () => {
    const { deployment, markup } = await publishAndRender()
    expect(deployment.iacDigest).toBeNull()
    expect(deployment.modelDigest).toBeNull()
    expect(deployment.policyDigest).toBeNull()
    expect(markup).toContain("not stated — this artifact names no infrastructure revision")
    expect(markup).toContain("not stated — this artifact names no model revision")
    expect(markup).toContain("not stated — this artifact names no policy revision")
  })

  it("reds the panel for an unsigned artifact, which is one a cell will refuse", async () => {
    const { deployment } = await publishAndRender()
    const { signature: _dropped, ...unsigned } = deployment
    void _dropped
    const markup = renderToStaticMarkup(
      <DeploymentPanel deployment={unsigned as DeploymentManifest} />,
    )
    expect(markup).toContain('data-deployment-problem=""')
    expect(markup).toContain("unsigned — its origin is not established")
    expect(markup).toContain("none — unsigned, and undeliverable to a cell")
  })
})
