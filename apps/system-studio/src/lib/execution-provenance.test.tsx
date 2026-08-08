import { renderToStaticMarkup } from "react-dom/server"

import type { StepEvidence, TenantManifest } from "@tenure/provisioning"

import { EvidencePanel } from "../components/EvidencePanel"

/**
 * STUDIO-070-005 — the PRODUCER is what is asserted on, and the tenant page's
 * evidence panel is where the assertion lands.
 *
 * `runAdvance` assembles the execution provenance and `executeStep` stamps it
 * onto the evidence; the panel renders it. This test drives the real
 * `runAdvance`, takes the evidence it actually wrote to the registry, and
 * renders the real panel component over it. A test that called `executeStep`
 * directly with a hand-built `StepRun` would stay green the day `runAdvance`
 * stopped threading the request ids — which is exactly the mutation recorded
 * against this item.
 *
 * ## The registry stand-in
 *
 * DynamoDB is replaced, and nothing else is. The stand-in stores what it is
 * given and returns it, which is the only property of the registry this path
 * depends on; the lifecycle rules, the change-class gate, the executor, the
 * secret-ref resolution and the panel are all the real ones. `getTenant`
 * returns a request id the way the real one does — off `$metadata.requestId` —
 * because that value is the thing under test.
 */

const DDB_REQUEST_ID = "M3T4D4T4-1234-5678-9abc-000000000001"

let stored: { evidence: StepEvidence | undefined } = { evidence: undefined }

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

jest.mock("./registry", () => ({
  tableName: () => "tenure-studio-tenants",
  getTenant: jest.fn(async () => ({
    slug: "simon-ose",
    // The Query's request id, exactly as the real `getTenant` reports it.
    awsRequestIds: [DDB_REQUEST_ID],
    manifest: manifest(),
    state: "PLANNED" as const,
    digest: "d".repeat(32),
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    history: [],
    evidence: [],
  })),
  advanceTenant: jest.fn(async (_slug: string, to: string, _o: unknown, evidence: StepEvidence) => {
    stored.evidence = evidence
    return { record: { state: to }, awsRequestId: "write-id" }
  }),
  startCoolingOff: jest.fn(async (_s: string, _a: string, requestedBy: string, at: string) => ({
    requestedAt: at,
    requestedBy,
  })),
}))

jest.mock("./deliver", () => ({
  deliverToCell: jest.fn(async () => ({ delivered: true, changes: [], detail: "applied" })),
  deploymentSigningKey: () => ({ keyId: "studio-test", secret: "a-secret" }),
}))

import { runAdvance } from "./command-handlers"

beforeEach(() => {
  stored = { evidence: undefined }
})

async function advanceAndRender() {
  const outcome = await runAdvance({
    slug: "simon-ose",
    to: "PLANNED",
    principalId: "dana@tenure.example",
    at: "2026-08-07T12:00:00.000Z",
  })
  expect(outcome.ok).toBe(true)
  const evidence = stored.evidence
  expect(evidence).toBeDefined()
  return {
    evidence: evidence!,
    markup: renderToStaticMarkup(<EvidencePanel evidence={[evidence!]} />),
  }
}

describe("a step's evidence carries provenance the operator can act on", () => {
  it("names the AWS request id the run actually read against", async () => {
    const { evidence, markup } = await advanceAndRender()
    expect(evidence.awsRequestIds).toEqual([DDB_REQUEST_ID])
    expect(markup).toContain(DDB_REQUEST_ID)
    expect(markup).not.toContain("no AWS request id recorded")
  })

  it("carries an input AND an output digest, not one optional digest", async () => {
    const { evidence, markup } = await advanceAndRender()
    expect(evidence.inputDigest).toHaveLength(32)
    expect(evidence.outputDigest).toHaveLength(32)
    expect(markup).toContain(evidence.inputDigest)
    expect(markup).toContain(evidence.outputDigest)
  })

  it("names the resource it touched, and says plainly that no role session is claimed", async () => {
    const { evidence, markup } = await advanceAndRender()
    expect(evidence.resourceHandles).toEqual([
      "dynamodb:table/tenure-studio-tenants#TENANT#simon-ose",
    ])
    expect(evidence.assumedRoleArn).toBeNull()
    expect(markup).toContain("dynamodb:table/tenure-studio-tenants#TENANT#simon-ose")
    expect(markup).toMatch(/cannot read its own identity/)
  })

  it("says a successful step has no next retry and owed no compensation", async () => {
    const { evidence, markup } = await advanceAndRender()
    expect(evidence.nextRetryAt).toBeNull()
    expect(evidence.compensation).toBeNull()
    expect(markup).toMatch(/not applicable — the step succeeded/)
    expect(markup).toMatch(/none — nothing was owed/)
  })

  it("reds the panel when a step cites no request id", () => {
    // The rendering half of the mutation below, asserted directly so the panel's
    // own behaviour is pinned as well as the producer's.
    const bare: StepEvidence = {
      step: "plan",
      state: "PLANNED",
      ok: true,
      detail: "…",
      inputDigest: "a".repeat(32),
      outputDigest: "b".repeat(32),
      correlationId: "corr",
      attempt: 1,
      awsRequestIds: [],
      assumedRoleArn: null,
      resourceHandles: ["h"],
      nextRetryAt: null,
      compensation: null,
    }
    const markup = renderToStaticMarkup(<EvidencePanel evidence={[bare]} />)
    expect(markup).toContain("no AWS request id recorded")
    expect(markup).toContain('data-provenance-problem=""')
  })
})
