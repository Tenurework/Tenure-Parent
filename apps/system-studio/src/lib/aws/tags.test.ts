import { REQUIRED_RESOURCE_TAGS, SHARED } from "@tenure/provisioning"

import {
  arnScopeOf,
  attributionOf,
  coverageFor,
  coverageFromIndex,
  coverageSummary,
  declarationsFrom,
  describeAttribution,
  describeCoverage,
  estateCoverage,
  forTenant,
  mergeScope,
  notCoverableResources,
  parseArn,
  resourcesForTenant,
  scopeFromIndex,
  tagApiGapFor,
  tagCompliance,
  tagIndex,
  taggedResources,
  unownedResources,
  UNRESOLVED_SCOPE,
  type ArnScope,
  type NativeTagAnswer,
  type TaggedResource,
} from "./tags"
import type { Identity } from "./identity"
import type { AwsGateway, AwsRead } from "./read"

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

    const compliance = tagCompliance(read.value)
    expect({
      total: compliance.total,
      attributed: compliance.attributed,
      shared: compliance.shared,
      unattributable: compliance.unattributable,
      nonCompliant: compliance.nonCompliant,
    }).toEqual({
      total: 4,
      attributed: 2,
      shared: 1,
      unattributable: 1,
      nonCompliant: 2,
    })

    // The untagged resource arrives as a finding an operator can act on, not as
    // the number 1. `TagCompliancePanel` renders the counts; the row is what
    // tells somebody WHICH bucket is costing money nobody owns.
    expect(compliance.unowned.map((f) => f.arn)).toEqual(["arn:aws:s3:::tenure-scratch-bucket"])
    expect(compliance.unowned[0].remedy).toContain("tenure:tenant")
    expect(compliance.unowned[0].service).toBe("s3")
  })

  it("gives a tenant its own resources AND the ones nobody claimed", async () => {
    const read = await survey()
    if (read.state !== "ACTUAL") throw new Error("expected ACTUAL")

    const { mine, unattributable, unowned } = forTenant(read.value, "simon-ose")
    expect(mine.map((r) => r.arn)).toEqual([
      "arn:aws:rds:us-east-1:1:db:tenure-pilot-db",
      "arn:aws:ecs:us-east-1:1:service/tenure/api",
    ])
    // Travels with the tenant's list deliberately: a page showing only the
    // resources it could attribute lets a reader believe the estate is fully
    // attributed.
    expect(unattributable).toHaveLength(1)
    // The same resources, as findings. `footprint.ts` counts `unattributable`;
    // this is what lets a surface name them.
    expect(unowned.map((f) => f.arn)).toEqual(unattributable.map((r) => r.arn))
    expect(unowned[0].why).toContain("unattributable — missing tenure:tenant")
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

/* ══════════════════════════════════════════════════════════ coverage ═════ */

/**
 * STUDIO-070-002 / STUDIO-000-007 — an ARN absent from `tag:GetResources` is
 * not an untagged resource.
 *
 * Every case below is one way the two get conflated, and the conflation is the
 * expensive one: a cost report that folds "we cannot see this resource's tags"
 * into "nobody tagged this resource" still adds up, still renders, and is
 * wrong. There is no assertion here that a resource is untagged unless its tags
 * were actually read.
 */

const REGION = "us-east-1"

/** The tag index as `taggedResources` produces it, without going through AWS. */
function indexRead(resources: readonly TaggedResource[]): AwsRead<readonly TaggedResource[]> {
  return {
    state: "ACTUAL",
    capability: "tag:GetResources",
    value: resources,
    asOf: "2026-08-07T00:00:00.000Z",
    fresh: true,
  }
}

const deniedIndex: AwsRead<readonly TaggedResource[]> = {
  state: "DENIED",
  capability: "tag:GetResources",
  action: "tag:GetResources",
  principal: "arn:aws:iam::123456789012:role/tenure-studio-reader",
  accountId: "123456789012",
  region: REGION,
  partition: "aws",
  errorCode: "AccessDeniedException",
  minimumStatement: '{"Effect":"Allow","Action":["tag:GetResources"],"Resource":"*"}',
}

function tagged(arn: string, tags: Record<string, string>): TaggedResource {
  return { arn, tags, attribution: attributionOf(tags), problems: [] }
}

/** The account every fixture ARN below states, and the one the index answered for. */
const ACCOUNT = "111122223333"

/**
 * The scope a resolved identity would establish for these fixtures.
 *
 * Written out rather than defaulted inside `coverageFor`, because the entire
 * point of `ArnScope` is that no field of it is ever assumed: a test that let
 * the partition default would be testing a code path production does not have.
 */
const SCOPE: ArnScope = { partition: "aws", region: REGION, accountId: ACCOUNT }

const ask = (
  arn: string,
  opts: {
    resources?: readonly TaggedResource[]
    index?: AwsRead<readonly TaggedResource[]>
    scope?: ArnScope
    native?: NativeTagAnswer
  } = {},
) => {
  const resources = opts.resources ?? []
  const index = opts.index ?? indexRead(resources)
  return coverageFor({
    arn,
    index,
    indexed: tagIndex(resources),
    indexScope: opts.scope ?? SCOPE,
    native: opts.native,
  })
}

describe("an ARN comes apart the way AWS writes it", () => {
  it("reads all three resource forms and does not invent a region for a global ARN", () => {
    // type/id
    expect(parseArn("arn:aws:ecs:us-east-1:111122223333:service/tenure/api")).toEqual({
      partition: "aws",
      service: "ecs",
      region: "us-east-1",
      accountId: "111122223333",
      resourceType: "service",
      resourceId: "tenure/api",
    })
    // type:id — and the id keeps every colon after the first
    expect(parseArn("arn:aws:logs:us-east-1:111122223333:log-group:/tenure/api:*")).toEqual({
      partition: "aws",
      service: "logs",
      region: "us-east-1",
      accountId: "111122223333",
      resourceType: "log-group",
      resourceId: "/tenure/api:*",
    })
    // bare id, no region, no account. This is the S3 bucket ARN form, and the
    // empty region is the fact the whole coverage model turns on.
    expect(parseArn("arn:aws:s3:::tenure-scratch-bucket")).toEqual({
      partition: "aws",
      service: "s3",
      region: "",
      accountId: "",
      resourceType: "",
      resourceId: "tenure-scratch-bucket",
    })
    // A partition that is not "aws" survives. A GovCloud ARN read as commercial
    // is a residency defect, not a cosmetic one.
    expect(parseArn("arn:aws-us-gov:cloudfront::111122223333:distribution/E1")).toEqual({
      partition: "aws-us-gov",
      service: "cloudfront",
      region: "",
      accountId: "111122223333",
      resourceType: "distribution",
      resourceId: "E1",
    })
  })

  it("returns null rather than a half-parsed record", () => {
    expect(parseArn("tenure-scratch-bucket")).toBeNull()
    expect(parseArn("arn:aws:s3")).toBeNull()
    expect(parseArn("arn:aws:s3:::")).toBeNull()
    expect(parseArn("")).toBeNull()
  })
})

describe("the service's own tags outrank the index, and the answer says which", () => {
  it("prefers a native answer over an index entry that disagrees", () => {
    // The index is stale — it still carries the tenant this pool was created
    // for. The service itself has the current tag. A console that trusted the
    // index would bill the wrong customer.
    const coverage = ask("arn:aws:cognito-idp:us-east-1:111122223333:userpool/us-east-1_ABC", {
      resources: [
        tagged("arn:aws:cognito-idp:us-east-1:111122223333:userpool/us-east-1_ABC", {
          "tenure:tenant": "old-tenant",
        }),
      ],
      native: {
        kind: "tags",
        capability: "cognito-idp:DescribeUserPool",
        tags: { "tenure:tenant": "simon-ose" },
      },
    })
    expect(coverage).toEqual({
      kind: "tenant",
      tenantSlug: "simon-ose",
      via: { path: "service-native", capability: "cognito-idp:DescribeUserPool" },
    })
    expect(describeCoverage(coverage)).toBe(
      "simon-ose — via cognito-idp:DescribeUserPool, the service's own tags",
    )
  })

  it("treats a definitive service answer of 'no tags' as the finding it is", () => {
    const coverage = ask("arn:aws:s3:::tenure-scratch-bucket", {
      native: {
        kind: "none",
        capability: "s3:GetBucketTagging",
        why: "tenure-scratch-bucket carries no tags at all (NoSuchTagSet).",
      },
    })
    expect(coverage).toEqual({
      kind: "untagged",
      via: { path: "service-native", capability: "s3:GetBucketTagging" },
    })
  })

  it("does not turn a failed service read into a finding", () => {
    const coverage = ask("arn:aws:s3:::tenure-scratch-bucket", {
      native: {
        kind: "unreadable",
        capability: "s3:GetBucketTagging",
        why: "refused s3:GetBucketTagging",
      },
    })
    // An S3 bucket ARN carries no region, so the index cannot answer either.
    expect(coverage.kind).toBe("not-coverable")
    expect(coverage.kind).not.toBe("untagged")
  })

  it("names the region the index answered for when the index decided", () => {
    const coverage = ask("arn:aws:rds:us-east-1:111122223333:db:tenure-pilot", {
      resources: [
        tagged("arn:aws:rds:us-east-1:111122223333:db:tenure-pilot", {
          "tenure:tenant": "simon-ose",
        }),
      ],
    })
    expect(describeCoverage(coverage)).toBe(
      "simon-ose — via the estate tag index (tag:GetResources) in us-east-1",
    )
  })
})

describe("absence from the index is four different facts, and only one is a finding", () => {
  it("reports a resource in the index's own region, of a type it carries, as untagged", () => {
    const coverage = ask("arn:aws:ecs:us-east-1:111122223333:service/tenure/api")
    expect(coverage).toEqual({
      kind: "untagged",
      via: { path: "tag-index", capability: "tag:GetResources", region: "us-east-1" },
    })
    expect(describeCoverage(coverage)).toBe(
      "unattributable — missing tenure:tenant — via the estate tag index (tag:GetResources) in us-east-1",
    )
  })

  it("refuses to call a global resource untagged, and names what would answer", () => {
    const zone = ask("arn:aws:route53:::hostedzone/Z0123456789ABCDEFGHIJ")
    expect(zone.kind).toBe("not-coverable")
    if (zone.kind !== "not-coverable") throw new Error("expected not-coverable")
    expect(zone.readInstead).toBeNull()
    expect(zone.remedy).toContain("route53:ListTagsForResource")

    const distribution = ask("arn:aws:cloudfront::111122223333:distribution/E1EXAMPLE")
    expect(distribution.kind).toBe("not-coverable")
    if (distribution.kind !== "not-coverable") throw new Error("expected not-coverable")
    expect(distribution.remedy).toContain("cloudfront:ListTagsForResource")

    // Neither is a finding, and neither may be counted as one.
    expect(
      unownedResources(
        [zone, distribution].map((coverage, i) => ({
          arn: `arn:${i}`,
          parsed: null,
          coverage,
          tags: null,
          problems: null,
        })),
      ),
    ).toEqual([])
  })

  it("catches a global resource nobody put in the gap table", () => {
    // IAM appears in no entry of `TAG_API_GAPS`, deliberately: the rule that
    // saves it is the general one — its ARN carries no region, so a regional
    // index cannot be concluded from. A console that relied on the table would
    // report every IAM role in the account as untagged spend the first time a
    // service was added that nobody remembered to list.
    const role = ask("arn:aws:iam::111122223333:role/tenure-studio-reader")
    expect(role.kind).toBe("not-coverable")
    if (role.kind !== "not-coverable") throw new Error("expected not-coverable")
    expect(tagApiGapFor(parseArn("arn:aws:iam::111122223333:role/tenure-studio-reader"))).toBeNull()
    expect(role.why).toContain("global resource")
    expect(role.why).toContain("us-east-1")
    expect(role.remedy).toContain("iam")
  })

  it("names the capability this console already holds when there is one", () => {
    const bucket = ask("arn:aws:s3:::tenure-pilot-uploads")
    expect(bucket.kind).toBe("not-coverable")
    if (bucket.kind !== "not-coverable") throw new Error("expected not-coverable")
    // A real capability from the registry, which `buckets.ts` performs today —
    // not a remedy sentence about something nobody can call.
    expect(bucket.readInstead).toBe("s3:GetBucketTagging")
    expect(tagApiGapFor(parseArn("arn:aws:s3:::tenure-pilot-uploads"))?.readInstead).toBe(
      "s3:GetBucketTagging",
    )
  })

  it("refuses to call a resource in another region untagged, and names both regions", () => {
    const coverage = ask("arn:aws:sqs:eu-west-1:111122223333:tenure-jobs")
    expect(coverage.kind).toBe("not-coverable")
    if (coverage.kind !== "not-coverable") throw new Error("expected not-coverable")
    expect(coverage.why).toContain("eu-west-1")
    expect(coverage.why).toContain("us-east-1")
  })

  it("will not decide at all when the index's own region is unresolved", () => {
    const coverage = ask("arn:aws:sqs:eu-west-1:111122223333:tenure-jobs", {
      scope: { ...SCOPE, region: null },
    })
    expect(coverage.kind).toBe("unknown")
  })

  it("will not decide from a string it could not parse", () => {
    const coverage = ask("tenure-jobs")
    expect(coverage.kind).toBe("unknown")
    if (coverage.kind !== "unknown") throw new Error("expected unknown")
    expect(coverage.why).toContain("not an ARN")
  })
})

describe("the index answers for one partition and one account, and says which", () => {
  it("refuses to call a resource in another partition untagged, and names both", () => {
    // A GovCloud resource read by a commercial-partition console. The index
    // physically cannot carry it, and an estate report that called it untagged
    // would be a finding about a resource in a partition nobody read.
    const coverage = ask(`arn:aws-us-gov:sqs:us-gov-west-1:${ACCOUNT}:tenure-jobs`)
    expect(coverage.kind).toBe("not-coverable")
    if (coverage.kind !== "not-coverable") throw new Error("expected not-coverable")
    expect(coverage.why).toContain("aws-us-gov")
    expect(coverage.why).toContain("aws")
    expect(coverage.remedy).toContain("aws-us-gov")
  })

  it("refuses to call another account's resource untagged, and names both accounts", () => {
    // tag:GetResources indexes the CALLER's account. A resource in a member
    // account — the shape `organization.ts` lists — is absent from it whether it
    // is tagged or not, and folding that into "untagged" invents a finding
    // against an account this console has never read.
    const other = "444455556666"
    const coverage = ask(`arn:aws:sqs:${REGION}:${other}:tenure-jobs`)
    expect(coverage.kind).toBe("not-coverable")
    if (coverage.kind !== "not-coverable") throw new Error("expected not-coverable")
    expect(coverage.kind).not.toBe("untagged")
    expect(coverage.why).toContain(other)
    expect(coverage.why).toContain(ACCOUNT)
    expect(coverage.remedy).toContain(other)
  })

  it("will not decide when the account the index answered for is unresolved", () => {
    const coverage = ask(`arn:aws:sqs:${REGION}:${ACCOUNT}:tenure-jobs`, {
      scope: { ...SCOPE, accountId: null },
    })
    expect(coverage.kind).toBe("unknown")
    if (coverage.kind !== "unknown") throw new Error("expected unknown")
    expect(coverage.why).toContain(ACCOUNT)
    expect(coverage.why).toContain("could not be resolved")
  })

  it("will not decide when the partition the index answered in is unresolved", () => {
    const coverage = ask(`arn:aws:sqs:${REGION}:${ACCOUNT}:tenure-jobs`, {
      scope: UNRESOLVED_SCOPE,
    })
    expect(coverage.kind).toBe("unknown")
    if (coverage.kind !== "unknown") throw new Error("expected unknown")
    expect(coverage.why).toContain("partition")
  })

  it("still concludes untagged when every axis of the scope matches", () => {
    // The control case. Without it, an engine that answered `unknown` to
    // everything would pass every assertion above and find nothing, ever.
    expect(ask(`arn:aws:sqs:${REGION}:${ACCOUNT}:tenure-jobs`).kind).toBe("untagged")
  })
})

describe("the scope is resolved from what was read, never from a literal", () => {
  const identity = (value: Identity): AwsRead<Identity> => ({
    state: "ACTUAL",
    capability: "sts:GetCallerIdentity",
    value,
    asOf: "2026-08-07T00:00:00.000Z",
    fresh: true,
  })

  it("takes the account, partition and region from a resolved identity", () => {
    expect(
      arnScopeOf(
        identity({
          accountId: ACCOUNT,
          arn: `arn:aws:iam::${ACCOUNT}:role/tenure-studio-reader`,
          partition: "aws",
          region: REGION,
        }),
      ),
    ).toEqual(SCOPE)
  })

  it("resolves nothing at all from an identity that was denied", () => {
    // The failure this prevents: a denied sts:GetCallerIdentity yielding a
    // partly-filled scope, which reads downstream exactly like a resolved one.
    const denied: AwsRead<Identity> = {
      state: "DENIED",
      capability: "sts:GetCallerIdentity",
      action: "sts:GetCallerIdentity",
      principal: "unknown",
      accountId: null,
      region: null,
      partition: null,
      errorCode: "AccessDenied",
      minimumStatement: '{"Effect":"Allow","Action":["sts:GetCallerIdentity"],"Resource":"*"}',
    }
    expect(arnScopeOf(denied)).toEqual(UNRESOLVED_SCOPE)
  })

  it("learns the partition and account from the ARNs the index itself returned", () => {
    // A console with no sts:GetCallerIdentity can still read the tag index. The
    // ARNs it returns are, by construction, of the account and partition it
    // answered for — so the scope is learnt from data rather than assumed.
    expect(
      scopeFromIndex([
        tagged(`arn:aws:rds:${REGION}:${ACCOUNT}:db:tenure-pilot`, {}),
        tagged(`arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/tenure-studio`, {}),
        // No region, no account stated. Skipped rather than counted as "".
        tagged("arn:aws:s3:::tenure-pilot-uploads", {}),
      ]),
    ).toEqual(SCOPE)
  })

  it("concludes nothing from ARNs that disagree", () => {
    expect(
      scopeFromIndex([
        tagged(`arn:aws:rds:${REGION}:${ACCOUNT}:db:one`, {}),
        tagged("arn:aws:rds:eu-west-1:444455556666:db:two", {}),
      ]),
    ).toEqual({ partition: "aws", region: null, accountId: null })
  })

  it("completes a partial scope field by field instead of overwriting it", () => {
    // An identity that resolved an account but came back with no region must
    // still let the client's own resolved region decide. A spread would write
    // the null over it.
    expect(
      mergeScope(
        { partition: null, region: null, accountId: ACCOUNT },
        { partition: "aws", region: REGION, accountId: "999999999999" },
      ),
    ).toEqual(SCOPE)
  })
})

describe("a denied index is not an untagged estate", () => {
  it("renders UNKNOWN carrying the principal, the action and the pasteable statement", () => {
    const coverage = ask("arn:aws:sqs:us-east-1:111122223333:tenure-jobs", { index: deniedIndex })
    expect(coverage.kind).toBe("unknown")
    if (coverage.kind !== "unknown") throw new Error("expected unknown")
    expect(coverage.why).toContain("tag:GetResources")
    expect(coverage.why).toContain("arn:aws:iam::123456789012:role/tenure-studio-reader")
    expect(coverage.why).toContain('"Action":["tag:GetResources"]')
    // The sentence an operator must never see for a denial.
    expect(describeCoverage(coverage)).not.toContain("missing tenure:tenant")
  })

  it("still answers from the service's own tags when the index was refused", () => {
    const coverage = ask("arn:aws:cognito-idp:us-east-1:111122223333:userpool/us-east-1_ABC", {
      index: deniedIndex,
      native: {
        kind: "tags",
        capability: "cognito-idp:DescribeUserPool",
        tags: { "tenure:tenant": "simon-ose" },
      },
    })
    expect(coverage).toEqual({
      kind: "tenant",
      tenantSlug: "simon-ose",
      via: { path: "service-native", capability: "cognito-idp:DescribeUserPool" },
    })
  })
})

describe("spend nobody owns is output, not residue", () => {
  const covered = coverageFromIndex(
    [
      tagged("arn:aws:rds:us-east-1:111122223333:db:tenure-pilot", { "tenure:tenant": "simon-ose" }),
      tagged("arn:aws:dynamodb:us-east-1:111122223333:table/tenure-studio", {
        "tenure:tenant": SHARED,
      }),
      tagged("arn:aws:ec2:us-east-1:111122223333:natgateway/nat-0a1b", { Name: "nat" }),
    ],
    { region: REGION },
  )

  it("gives each unowned resource an ARN, a service, a region and a remedy", () => {
    const unowned = unownedResources(covered)
    expect(unowned).toHaveLength(1)
    expect(unowned[0].arn).toBe("arn:aws:ec2:us-east-1:111122223333:natgateway/nat-0a1b")
    expect(unowned[0].service).toBe("ec2")
    expect(unowned[0].region).toBe("us-east-1")
    expect(unowned[0].remedy).toContain("tenure:tenant")
    expect(unowned[0].remedy).toContain(SHARED)
    expect(unowned[0].via).toEqual({
      path: "tag-index",
      capability: "tag:GetResources",
      region: "us-east-1",
    })
  })

  it("never counts a deliberately shared resource as unowned", () => {
    expect(unownedResources(covered).map((f) => f.arn)).not.toContain(
      "arn:aws:dynamodb:us-east-1:111122223333:table/tenure-studio",
    )
  })

  it("answers which resources belong to tenant X, on an exact slug", () => {
    const withNeighbour = coverageFromIndex([
      tagged("arn:aws:s3:::acme-primary", { "tenure:tenant": "acme" }),
      // The name trap: a DIFFERENT customer whose slug starts with the first's.
      tagged("arn:aws:s3:::acme-backups", { "tenure:tenant": "acme-staging" }),
    ])
    expect(resourcesForTenant(withNeighbour, "acme").map((r) => r.arn)).toEqual([
      "arn:aws:s3:::acme-primary",
    ])
  })

  it("counts five classes and folds none of them", () => {
    expect(coverageSummary(covered)).toEqual({
      total: 3,
      tenant: 1,
      shared: 1,
      untagged: 1,
      notCoverable: 0,
      unknown: 0,
      tenants: ["simon-ose"],
    })
  })
})

/* ────────────────────────────────────────────── the composed estate ────── */

function gatewayWith(
  pages: Array<{
    PaginationToken?: string
    ResourceTagMappingList: Array<{
      ResourceARN: string
      Tags: Array<{ Key: string; Value: string }>
    }>
  }>,
): AwsGateway {
  let page = 0
  return {
    async call(capability) {
      if (capability !== "tag:GetResources") throw new Error(`unexpected ${capability}`)
      return pages[page++] ?? { ResourceTagMappingList: [] }
    },
    async resolvedRegion() {
      return REGION
    },
  }
}

describe("attribution across every service the console can read", () => {
  const declared = [
    // Read by `cognito.ts`, which has the pool's own tags.
    {
      arn: "arn:aws:cognito-idp:us-east-1:111122223333:userpool/us-east-1_ABC",
      native: {
        kind: "tags" as const,
        capability: "cognito-idp:DescribeUserPool",
        tags: { "tenure:tenant": "simon-ose" },
      },
    },
    // Read by `dns.ts`. Global ARN, and this console holds no Route 53 tag
    // capability — so it is not coverable, and emphatically not untagged.
    { arn: "arn:aws:route53:::hostedzone/Z0123456789ABCDEFGHIJ" },
    // Read by `cdn.ts`. Same shape, different service.
    { arn: "arn:aws:cloudfront::111122223333:distribution/E1EXAMPLE" },
    // Read by `sqs.ts`. In the index's region, of a type it carries, absent
    // from it: genuinely untagged.
    { arn: "arn:aws:sqs:us-east-1:111122223333:tenure-jobs" },
  ]

  const estate = () =>
    estateCoverage(
      declared,
      gatewayWith([
        {
          ResourceTagMappingList: [
            {
              ResourceARN: "arn:aws:rds:us-east-1:111122223333:db:tenure-pilot",
              Tags: asTags(FULLY_TAGGED),
            },
            {
              ResourceARN: "arn:aws:dynamodb:us-east-1:111122223333:table/tenure-studio",
              Tags: asTags({ ...FULLY_TAGGED, "tenure:tenant": SHARED, "tenure:cell": SHARED }),
            },
          ],
        },
      ]),
      { now: () => new Date("2026-08-07T00:00:00.000Z") },
    )

  it("separates the four coverage classes across six resources from five services", async () => {
    const coverage = await estate()
    // Nobody supplied an identity. The region came from the client's own
    // resolution and the account and partition were LEARNT from the ARNs the
    // index itself returned — the only two sources that are not a literal.
    expect(coverage.indexScope).toEqual({
      partition: "aws",
      region: "us-east-1",
      accountId: "111122223333",
    })
    expect(coverage.summary).toEqual({
      total: 6,
      tenant: 2,
      shared: 1,
      untagged: 1,
      notCoverable: 2,
      unknown: 0,
      tenants: ["simon-ose"],
    })
  })

  it("keeps not-coverable out of the unowned finding list", async () => {
    const coverage = await estate()
    expect(coverage.unowned.map((f) => f.arn)).toEqual([
      "arn:aws:sqs:us-east-1:111122223333:tenure-jobs",
    ])
    expect(coverage.notCoverable.map((r) => r.arn)).toEqual([
      "arn:aws:route53:::hostedzone/Z0123456789ABCDEFGHIJ",
      "arn:aws:cloudfront::111122223333:distribution/E1EXAMPLE",
    ])
    // A resource whose tags were never read must not join the compliant pile
    // with an empty problem list.
    expect(coverage.notCoverable.every((r) => r.problems === null)).toBe(true)
    expect(coverage.notCoverable.every((r) => r.tags === null)).toBe(true)
  })

  it("says which path decided each answer", async () => {
    const coverage = await estate()
    const pool = coverage.resources.find((r) => r.arn.includes("userpool"))!
    expect(describeCoverage(pool.coverage)).toContain("cognito-idp:DescribeUserPool")
    const db = coverage.resources.find((r) => r.arn.includes("db:tenure-pilot"))!
    expect(describeCoverage(db.coverage)).toContain("the estate tag index (tag:GetResources)")
  })

  it("boots with no credentials: a region that cannot be resolved is not an untagged estate", async () => {
    const coverage = await estateCoverage(declared, {
      async call() {
        const error = new Error("Could not load credentials from any providers")
        error.name = "CredentialsProviderError"
        throw error
      },
      async resolvedRegion() {
        throw new Error("Region is missing")
      },
    })

    expect(coverage.indexScope).toEqual(UNRESOLVED_SCOPE)
    expect(coverage.index.state).toBe("ERROR")
    // Nothing is claimed about anybody's tags, and nothing threw.
    expect(coverage.unowned).toEqual([])
    expect(coverage.summary.unknown).toBe(3)
    expect(coverage.summary.untagged).toBe(0)
  })

  it("carries the index read so a denial renders with its IAM statement", async () => {
    // A scope is supplied, so nothing here reaches `liveGateway` — and the
    // denial still has to survive a fully-resolved scope. A denied index is not
    // an untagged estate no matter how much is known about the account.
    const coverage = await estateCoverage(declared, undefined, {
      index: deniedIndex,
      scope: SCOPE,
    })
    expect(coverage.index.state).toBe("DENIED")
    // The one native answer still lands; the rest are unknown, not untagged.
    expect(coverage.summary.tenant).toBe(1)
    expect(coverage.summary.untagged).toBe(0)
    expect(coverage.summary.unknown).toBe(3)
  })

  it("counts a resource its reader could not name an ARN for, rather than dropping it", async () => {
    // `logs.ts`, `ecr.ts`, `cognito.ts`, `keys.ts`, `secrets.ts` and
    // `elasticache.ts` all declare `arn: string | null` — the AWS API they call
    // can omit it. Dropping those shrinks the estate's own total, and shrinks it
    // exactly around the resources whose identity was already incomplete.
    // Shaped exactly as `cognito.ts` holds it: `PoolDetail` carries
    // `arn: string | null`, a `poolId`, and the pool's own `tags` from
    // DescribeUserPool. Both capabilities named here are real registry entries.
    const { declared: fromPools, unidentified } = declarationsFrom(
      { capability: "cognito-idp:ListUserPools", service: "cognito-idp" },
      [
        {
          arn: `arn:aws:cognito-idp:${REGION}:${ACCOUNT}:userpool/us-east-1_WITHARN`,
          label: "us-east-1_WITHARN",
        },
        // No ARN, and no tag answer either: unknowable, and it must say so.
        { arn: null, label: "us-east-1_NOARN" },
        // No ARN, but the service answered about its own tags — which needs no
        // ARN at all. This is attributable, and it would have been lost.
        {
          arn: null,
          label: "us-east-1_NOARNTAGGED",
          native: {
            kind: "tags",
            capability: "cognito-idp:DescribeUserPool",
            tags: { "tenure:tenant": "simon-ose" },
          },
        },
      ],
    )

    expect(fromPools.map((d) => d.arn)).toEqual([
      `arn:aws:cognito-idp:${REGION}:${ACCOUNT}:userpool/us-east-1_WITHARN`,
    ])
    expect(fromPools[0].source).toBe("cognito-idp:ListUserPools")
    expect(unidentified.map((u) => u.label)).toEqual(["us-east-1_NOARN", "us-east-1_NOARNTAGGED"])
    expect(unidentified[0].coverage.kind).toBe("unknown")
    // Never "untagged": a missing identifier is not a finding about tags.
    expect(unidentified[0].coverage.kind).not.toBe("untagged")
    expect(unidentified[0].tags).toBeNull()
    expect(unidentified[0].problems).toBeNull()
    expect(describeCoverage(unidentified[0].coverage)).toContain("cognito-idp:ListUserPools")
    expect(unidentified[1].coverage).toEqual({
      kind: "tenant",
      tenantSlug: "simon-ose",
      via: { path: "service-native", capability: "cognito-idp:DescribeUserPool" },
    })

    const coverage = await estateCoverage(fromPools, gatewayWith([{ ResourceTagMappingList: [] }]), {
      scope: SCOPE,
      unidentified,
    })
    // One declared with an ARN, two that never had one. All three are in the
    // total; none vanished into a rounding difference.
    expect(coverage.summary.total).toBe(3)
    // The pool that HAS an ARN is `not-coverable`: Cognito is in the gap table,
    // so the index's silence about it proves nothing. Absent from the index and
    // absent from the findings — which is the whole correction this module makes.
    expect(coverage.summary.notCoverable).toBe(1)
    expect(coverage.summary.tenant).toBe(1)
    expect(coverage.summary.unknown).toBe(1)
    expect(coverage.summary.untagged).toBe(0)
    expect(coverage.unidentified).toHaveLength(2)
  })

  it("makes the unowned list and the untagged count agree, ARN or no ARN", async () => {
    const { declared, unidentified } = declarationsFrom(
      { capability: "cognito-idp:ListUserPools", service: "cognito-idp" },
      [
        {
          arn: null,
          label: "us-east-1_NOARN",
          native: {
            kind: "none",
            capability: "cognito-idp:DescribeUserPool",
            why: "the pool's UserPoolTags is empty",
          },
        },
      ],
    )
    const coverage = await estateCoverage(
      [...declared, { arn: `arn:aws:sqs:${REGION}:${ACCOUNT}:tenure-jobs` }],
      gatewayWith([{ ResourceTagMappingList: [] }]),
      { scope: SCOPE, unidentified },
    )

    // Two untagged resources, two rows. A page that printed "2 unowned" over a
    // list of one is the defect this asserts against.
    expect(coverage.summary.untagged).toBe(2)
    expect(coverage.unowned).toHaveLength(2)
    expect(coverage.unowned.map((u) => u.label)).toEqual([
      `arn:aws:sqs:${REGION}:${ACCOUNT}:tenure-jobs`,
      "us-east-1_NOARN",
    ])
    const [withArn, withoutArn] = coverage.unowned
    expect(withArn.accountId).toBe(ACCOUNT)
    expect(withArn.partition).toBe("aws")
    expect(withArn.region).toBe(REGION)
    // Nothing is invented for the one with no ARN, and the remedy sends the
    // operator to the reader that knows which resource it is.
    expect(withoutArn.arn).toBeNull()
    expect(withoutArn.accountId).toBeNull()
    expect(withoutArn.partition).toBeNull()
    expect(withoutArn.service).toBe("cognito-idp")
    expect(withoutArn.remedy).toContain("cognito-idp:ListUserPools")
    expect(withoutArn.remedy).toContain("tenure:tenant")
  })

  it("does not let the index overrule a service that answered for its own resource", async () => {
    const arn = "arn:aws:cognito-idp:us-east-1:111122223333:userpool/us-east-1_ABC"
    const coverage = await estateCoverage(
      [
        {
          arn,
          native: {
            kind: "tags",
            capability: "cognito-idp:DescribeUserPool",
            tags: { "tenure:tenant": "simon-ose" },
          },
        },
      ],
      gatewayWith([
        {
          ResourceTagMappingList: [
            { ResourceARN: arn, Tags: asTags({ ...FULLY_TAGGED, "tenure:tenant": "old-tenant" }) },
          ],
        },
      ]),
    )
    expect(coverage.resources).toHaveLength(1)
    expect(coverage.summary.tenants).toEqual(["simon-ose"])
    expect(notCoverableResources(coverage.resources)).toEqual([])
  })
})
