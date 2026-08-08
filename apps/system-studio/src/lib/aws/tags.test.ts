import { REQUIRED_RESOURCE_TAGS, SHARED } from "@tenure/provisioning"

import {
  attributionOf,
  describeAttribution,
  forTenant,
  tagCompliance,
  taggedResources,
} from "./tags"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-002 — the estate reader applies the tag contract to every result.
 *
 * The assertions are on `taggedResources`, the PRODUCER — the one function every
 * GetResources page passes through — rather than on `tagProblems` itself. A test
 * that called `tagProblems` directly would stay green on the day the reader
 * stopped calling it, which is the exact shape of failure this programme has
 * already paid for.
 *
 * The stand-in gateway returns the response the Resource Groups Tagging API
 * actually returns — `ResourceTagMappingList` with `Tags: [{Key, Value}]`,
 * paginated by `PaginationToken` — rather than a convenient array. A stand-in
 * that returns a shape the real API never produces proves nothing about the
 * projection that has to read the real one.
 */

const FULLY_TAGGED: Record<string, string> = {
  "tenure:tenant": "simon-ose",
  "tenure:environment": "production",
  "tenure:cell": "cell-us-east-1-a",
  "tenure:account-purpose": "workload",
  "tenure:module": "tenant-cell",
  "tenure:release": "2026.07.31",
  "tenure:stack": "pilot/terraform.tfstate",
  "tenure:data-class": "student-record",
  "tenure:owner-seat": "platform-engineering",
  "tenure:cost-center": "tenant-cells",
  "tenure:retention": "P7Y",
  "tenure:managed-by": "terraform",
}

const asTags = (map: Record<string, string>) =>
  Object.entries(map).map(([Key, Value]) => ({ Key, Value }))

function gatewayReturning(
  pages: Array<{
    PaginationToken?: string
    ResourceTagMappingList: Array<{ ResourceARN: string; Tags: Array<{ Key: string; Value: string }> }>
  }>,
): AwsGateway {
  let page = 0
  return {
    async call(capability) {
      if (capability !== "tag:GetResources") throw new Error(`unexpected ${capability}`)
      return pages[page++] ?? { ResourceTagMappingList: [] }
    },
    async resolvedRegion() {
      return "us-east-1"
    },
  }
}

describe("the estate reader applies the twelve-tag contract to every resource", () => {
  const survey = () =>
    taggedResources(
      gatewayReturning([
        {
          ResourceTagMappingList: [
            {
              ResourceARN: "arn:aws:rds:us-east-1:1:db:tenure-pilot-db",
              Tags: asTags(FULLY_TAGGED),
            },
            {
              // The control plane. Explicitly shared, which is a DECISION.
              ResourceARN: "arn:aws:dynamodb:us-east-1:1:table/tenure-studio-tenants",
              Tags: asTags({ ...FULLY_TAGGED, "tenure:tenant": SHARED, "tenure:cell": SHARED }),
            },
            {
              // Somebody clicked this into existence. Nobody decided anything.
              ResourceARN: "arn:aws:s3:::tenure-scratch-bucket",
              Tags: [{ Key: "Name", Value: "scratch" }],
            },
            {
              // Attributed, and still non-compliant — the case a survey that
              // only looked at `tenure:tenant` would report as fine.
              ResourceARN: "arn:aws:ecs:us-east-1:1:service/tenure/api",
              Tags: asTags(
                Object.fromEntries(
                  Object.entries(FULLY_TAGGED).filter(([k]) => k !== "tenure:cost-center"),
                ) as Record<string, string>,
              ),
            },
          ],
        },
      ]),
      { now: () => new Date("2026-08-07T00:00:00.000Z") },
    )

  it("reads every page and decides an attribution for each resource", async () => {
    const read = await survey()
    expect(read.state).toBe("ACTUAL")
    if (read.state !== "ACTUAL") return

    expect(read.value.map((r) => r.attribution.kind)).toEqual([
      "tenant",
      "shared",
      "unattributed",
      "tenant",
    ])
  })

  it("renders an untagged resource as unattributable and names the missing key", async () => {
    const read = await survey()
    if (read.state !== "ACTUAL") throw new Error("expected ACTUAL")

    const untagged = read.value.find((r) => r.arn.includes("scratch-bucket"))!
    expect(describeAttribution(untagged.attribution)).toBe("unattributable — missing tenure:tenant")

    // And emphatically NOT shared. `tenure:tenant = tenure:shared` is somebody
    // deciding this is platform overhead; no tag at all is nobody having
    // looked, and folding the two spreads an untagged resource across every
    // customer's bill.
    expect(untagged.attribution.kind).not.toBe("shared")
    const shared = read.value.find((r) => r.arn.includes("studio-tenants"))!
    expect(shared.attribution.kind).toBe("shared")
    expect(describeAttribution(shared.attribution)).toMatch(/decided/)
  })

  it("carries a per-resource problem list, not a compliant/non-compliant flag", async () => {
    const read = await survey()
    if (read.state !== "ACTUAL") throw new Error("expected ACTUAL")

    const compliant = read.value.find((r) => r.arn.includes("pilot-db"))!
    expect(compliant.problems).toEqual([])

    const missingCostCentre = read.value.find((r) => r.arn.includes("service/tenure/api"))!
    expect(missingCostCentre.problems.map((p) => p.key)).toEqual(["tenure:cost-center"])
    // The operator has to be able to act on it, which means the ARN and the key
    // in one sentence — not "one resource is non-compliant".
    expect(missingCostCentre.problems[0].detail).toMatch(/Missing tenure:cost-center/)

    const untagged = read.value.find((r) => r.arn.includes("scratch-bucket"))!
    expect(untagged.problems).toHaveLength(REQUIRED_RESOURCE_TAGS.length)
    expect(untagged.problems.map((p) => p.key)).toContain("tenure:tenant")
  })

  it("counts shared and unattributable separately", async () => {
    const read = await survey()
    if (read.state !== "ACTUAL") throw new Error("expected ACTUAL")

    expect(tagCompliance(read.value)).toEqual({
      total: 4,
      attributed: 2,
      shared: 1,
      unattributable: 1,
      nonCompliant: 2,
    })
  })

  it("gives a tenant its own resources AND the ones nobody claimed", async () => {
    const read = await survey()
    if (read.state !== "ACTUAL") throw new Error("expected ACTUAL")

    const { mine, unattributable } = forTenant(read.value, "simon-ose")
    expect(mine.map((r) => r.arn)).toEqual([
      "arn:aws:rds:us-east-1:1:db:tenure-pilot-db",
      "arn:aws:ecs:us-east-1:1:service/tenure/api",
    ])
    // Travels with the tenant's list deliberately: a page showing only the
    // resources it could attribute lets a reader believe the estate is fully
    // attributed.
    expect(unattributable).toHaveLength(1)
  })

  it("walks every page rather than reporting the first one as the estate", async () => {
    const read = await taggedResources(
      gatewayReturning([
        {
          PaginationToken: "next",
          ResourceTagMappingList: [
            { ResourceARN: "arn:aws:s3:::one", Tags: asTags(FULLY_TAGGED) },
          ],
        },
        {
          ResourceTagMappingList: [
            { ResourceARN: "arn:aws:s3:::two", Tags: asTags(FULLY_TAGGED) },
          ],
        },
      ]),
    )
    if (read.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(read.value.map((r) => r.arn)).toEqual(["arn:aws:s3:::one", "arn:aws:s3:::two"])
  })

  it("does not render a denial as an untagged estate", async () => {
    const denied: AwsGateway = {
      async call() {
        const error = new Error("User is not authorized to perform: tag:GetResources")
        error.name = "AccessDeniedException"
        throw error
      },
      async resolvedRegion() {
        return "us-east-1"
      },
    }
    const read = await taggedResources(denied)
    expect(read.state).toBe("DENIED")
  })
})

describe("attributionOf is the package's decision, not a second one", () => {
  it("reads the shared sentinel as the VALUE of tenure:tenant", () => {
    // The bug this replaced: `shared` used to key off a separate
    // `tenure:shared = "true"` tag, while the Terraform writes
    // `tenure:tenant = "tenure:shared"`. Under the old reading every
    // control-plane resource in the studio stack attributed to a tenant whose
    // slug is literally "tenure:shared" — and would have been billed to it.
    expect(attributionOf({ "tenure:tenant": SHARED })).toEqual({ kind: "shared" })
    expect(attributionOf({ "tenure:shared": "true" })).toEqual({ kind: "unattributed" })
    expect(attributionOf({ "tenure:tenant": "simon-ose" })).toEqual({
      kind: "tenant",
      tenantSlug: "simon-ose",
    })
  })
})
