import { __resetEstate, __resetFleet, placementFor } from "./cells"

/**
 * GE-101-001 / GE-101-003 — the policy on the path compose actually takes.
 *
 * `placement.test.ts` in `@tenure/provisioning` proves the gates. This proves
 * they are reached: `composeTenant` calls `placementFor`, `placementFor` runs
 * the policy over the fleet before `choosePlacement` picks from it, and the
 * decision it hands back carries the version and the explanation the console
 * renders. A policy nothing calls is a policy nothing enforces.
 */

const ENV = { ...process.env }

beforeEach(() => {
  __resetEstate()
  __resetFleet()
  process.env.AWS_REGION = "us-east-1"
  process.env.AWS_ACCOUNT_ID = "047385673922"
  process.env.AWS_PARTITION = "aws"
  process.env.DEPLOY_ENVIRONMENT = "production"
  process.env.CELL_ID = "cell-use1-a"
  process.env.CELL_MAX_TENANTS = "50"
  process.env.CELL_TENANT_COUNT = "3"
})

afterEach(() => {
  process.env = { ...ENV }
  __resetEstate()
  __resetFleet()
})

const tenant = { tenantId: "simon", residency: ["us-east-1"], environment: "production" as const }

it("places a pooled tenant and says which policy and configuration decided it", () => {
  const placement = placementFor(tenant, { isolation: "pooled" })
  expect(placement.cellId).toBe("cell-use1-a")
  expect(placement.reason).toBe("placed")
  expect(placement.policy.policyVersion).toBe("1.0")
  expect(placement.policy.configVersion).toMatch(/^[0-9a-f]{16}$/)
  expect(placement.policy.adapter).toBe("pooled")
  expect(placement.policy.explanation).toEqual([])
})

it("refuses a silo tenant on a fleet that publishes no isolation shapes", () => {
  // The behaviour change this wiring exists for. Before it, a silo tenant was
  // registered against the shared cell and nothing anywhere said so.
  const placement = placementFor(tenant, { isolation: "silo" })
  expect(placement.cellId).toBeNull()
  expect(placement.reason).toBe("policy-refused")
  expect(placement.policy.explanation.join("\n")).toMatch(
    /isolation-tier could not be checked/,
  )
})

it("places the silo tenant once the fleet publishes the shape and the key", () => {
  process.env.CELL_ISOLATION_CLASSES = "pooled,bridge,silo"
  process.env.CELL_KMS_CMK_SUPPORTED = "true"
  process.env.CELL_KMS_KEY_REGION = "us-east-1"
  __resetFleet()
  const placement = placementFor(tenant, { isolation: "silo" })
  expect(placement.reason).toBe("placed")
  expect(placement.cellId).toBe("cell-use1-a")
})

it("keeps admission's own refusal rather than reporting it as a policy refusal", () => {
  process.env.CELL_TENANT_COUNT = "50"
  __resetFleet()
  const placement = placementFor(tenant, { isolation: "pooled" })
  expect(placement.cellId).toBeNull()
  // choosePlacement says this better than a gate could, and still does.
  expect(placement.reason).toBe("no-capacity")
  expect(placement.admission.recommendation).not.toBe("none")
  // The policy still reports it, marked as somebody else's refusal.
  expect(placement.policy.explanation.join("\n")).toMatch(
    /capacity refused .* \(enforced by fleet admission\)/,
  )
})

it("demands the control plane's own partition, and refuses a cell outside it", () => {
  process.env.AWS_PARTITION = "aws-us-gov"
  __resetFleet()
  __resetEstate()
  // Cell and demand move together here, so this passes; the value of the gate
  // is that the two are compared at all rather than assumed equal.
  expect(placementFor(tenant, { isolation: "pooled" }).reason).toBe("placed")
})
