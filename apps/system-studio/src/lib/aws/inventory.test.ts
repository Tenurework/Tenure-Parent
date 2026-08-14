import { CAPABILITIES, type Capability } from "./capabilities"
import { __resetIdentity } from "./identity"
import {
  __resetInventoryCache,
  estateCoverage,
  estateInventory,
  estateLines,
  estateResourceCount,
  estateSectionLines,
  sectionResources,
  type EstateReadings,
  type EstateSection,
} from "./inventory"
import type { AwsGateway } from "./read"
import { SHARED_TAG } from "./tags"

/**
 * STUDIO-080-001 — the estate composed from EVERY reader, and the two
 * properties that matter more than how many of them there are.
 *
 * ## What is asserted, and through what
 *
 * Every assertion here goes through `estateInventory`, which is the function
 * `/platform/estate`, `/` and `/tenants/[slug]` call, and through the
 * `estateCoverage` / `estateResourceCount` / `estateSectionLines` that a surface
 * renders. Nothing drives a private helper: a test that did would stay green on
 * the day the page stopped calling it, which is the failure this programme has
 * already paid for.
 *
 * ## The stand-in is a client, not a stub
 *
 * `gatewayFor` answers named capabilities with the shapes the real SDK returns
 * — `{repositories}` from `ecr:DescribeRepositories`, `{Buckets}` from
 * `s3:ListBuckets`, `{ResourceTagMappingList}` from the Tagging API, `{Account,
 * Arn}` from STS — and anything unnamed answers `{}`, which every reader in this
 * directory maps to EMPTY. It can fail any single capability with a denial, a
 * throttle, or an error that is not an AWS error at all, INDEPENDENTLY of the
 * rest. A stand-in that answered the same thing to everything would prove
 * nothing about a composition whose entire job is to keep thirty services'
 * failures apart.
 *
 * Every account id here is the obviously-constructed `123456789012`. No AWS
 * account, ARN, bucket or resource name in this file is real, and nothing here
 * opens a socket.
 */

/* --------------------------------------------------------------- the estate */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"

function repoArn(name: string): string {
  return `arn:aws:ecr:${REGION}:${ACCOUNT}:repository/${name}`
}

/**
 * The input reaches the answer, because one capability is not one question.
 *
 * `wafv2:ListWebACLs` is asked twice per load with different `Scope`s, and the
 * REGIONAL catalogue and the CLOUDFRONT one are separately permissioned in real
 * policies. A stand-in that could not tell the two calls apart could not
 * reproduce the case this file has to cover: half a service read.
 */
type Answers = Partial<Record<Capability, (input?: Record<string, unknown>) => unknown>>

/** An error shaped the way the AWS SDK shapes one: the `name` carries the code. */
function awsError(name: string): Error {
  const error = new Error(`${name}: raised by the stand-in gateway`)
  error.name = name
  return error
}

interface StandIn {
  gateway: AwsGateway
  /** How many times each capability actually reached the inner gateway. */
  calls: Map<string, number>
}

function gatewayFor(answers: Answers): StandIn {
  const calls = new Map<string, number>()
  return {
    calls,
    gateway: {
      async call(capability, input) {
        calls.set(capability, (calls.get(capability) ?? 0) + 1)
        const answer = answers[capability]
        return answer ? answer(input) : {}
      },
      async resolvedRegion() {
        calls.set("|resolvedRegion", (calls.get("|resolvedRegion") ?? 0) + 1)
        return REGION
      },
    },
  }
}

/**
 * An estate holding one image repository and one bucket.
 *
 * Two services rather than twenty because two is what the properties need: one
 * to fail while the other keeps answering. Every other capability answers `{}`,
 * which is a real, successful, empty response — and the difference between that
 * and a refusal is most of what this file is about.
 */
const ESTATE: Answers = {
  "sts:GetCallerIdentity": () => ({
    Account: ACCOUNT,
    Arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-ecs-task/abc`,
    UserId: "AROAEXAMPLE:abc",
  }),
  "tag:GetResources": () => ({
    ResourceTagMappingList: [
      {
        ResourceARN: repoArn("tenure-web"),
        // The sentinel `@tenure/provisioning` writes and `tags.ts` reads back,
        // imported rather than retyped: a second spelling here would be a test
        // agreeing with itself about a value the stack never sets.
        Tags: [
          { Key: "tenure:tenant", Value: SHARED_TAG },
          { Key: "tenure:environment", Value: "prod" },
        ],
      },
    ],
  }),
  "ecr:DescribeRepositories": () => ({
    repositories: [
      {
        repositoryName: "tenure-web",
        repositoryArn: repoArn("tenure-web"),
        registryId: ACCOUNT,
        imageTagMutability: "IMMUTABLE",
      },
    ],
  }),
  "s3:ListBuckets": () => ({
    Buckets: [{ Name: "tenure-prod-uploads", CreationDate: "2026-01-04T10:00:00.000Z" }],
  }),
}

const NOW = () => new Date("2026-08-13T09:00:00.000Z")

async function inventory(answers: Answers): Promise<EstateReadings> {
  return estateInventory(gatewayFor(answers).gateway, { now: NOW })
}

function section(readings: EstateReadings, capability: Capability): EstateSection {
  const found = readings.sections.find((entry) => entry.capability === capability)
  if (!found) throw new Error(`no section for ${capability}`)
  return found
}

beforeEach(() => {
  __resetIdentity()
  __resetInventoryCache()
})

/* ==================================================================== 1 == */

describe("coverage is part of the answer, not an absence", () => {
  test("a service that could not be read is UNKNOWN, and a service that answered with nothing is ABSENT", async () => {
    const readings = await inventory({
      ...ESTATE,
      "ecr:DescribeRepositories": () => {
        throw awsError("AccessDeniedException")
      },
    })

    const ecr = section(readings, "ecr:DescribeRepositories")
    expect(ecr.coverage.kind).toBe("UNKNOWN")
    if (ecr.coverage.kind !== "UNKNOWN") throw new Error("narrowing")
    expect(ecr.coverage.state).toBe("DENIED")
    // The remedy travels with the refusal: the action, and a pasteable statement.
    expect(ecr.coverage.why).toContain("ecr:DescribeRepositories")
    expect(ecr.coverage.why).toContain("Minimum statement")

    // Cognito was asked and answered with nothing. That IS a claim about the
    // account, and it is the one thing the arm above must never be read as.
    const cognito = section(readings, "cognito-idp:ListUserPools")
    expect(cognito.coverage.kind).toBe("ABSENT")

    // And they are told apart at the report level, not only per section.
    expect(readings.coverage.absent).toContain("cognito-idp:ListUserPools")
    expect(readings.coverage.absent).not.toContain("ecr:DescribeRepositories")
    expect(readings.coverage.unknown.map((gap) => gap.capability)).toContain(
      "ecr:DescribeRepositories",
    )
  })

  test("a caller can render \"we cannot see ECR\" differently from \"there is no ECR\"", async () => {
    const denied = await inventory({
      ...ESTATE,
      "ecr:DescribeRepositories": () => {
        throw awsError("AccessDeniedException")
      },
    })
    const empty = await inventory({ ...ESTATE, "ecr:DescribeRepositories": () => ({}) })

    const deniedEcr = section(denied, "ecr:DescribeRepositories")
    const emptyEcr = section(empty, "ecr:DescribeRepositories")

    // Different kinds, and provably different text. Same service, same reader,
    // same page — the only difference is what AWS said.
    expect(deniedEcr.coverage.kind).toBe("UNKNOWN")
    expect(emptyEcr.coverage.kind).toBe("ABSENT")
    expect(deniedEcr.text).not.toEqual(emptyEcr.text)
    expect(emptyEcr.text).toContain("none")
    expect(deniedEcr.text).not.toContain("none —")
  })

  test("every capability in the registry is either claimed by a section or listed as NO_READER", async () => {
    const readings = await inventory(ESTATE)
    const claimed = new Set<string>()
    for (const entry of readings.sections) for (const capability of entry.covers) claimed.add(capability)
    const gaps = new Set(readings.coverage.noReader.map((gap) => gap.capability))

    for (const capability of Object.keys(CAPABILITIES) as Capability[]) {
      // Exactly one of the two, never both and never neither. A capability
      // added to the registry that nothing reads surfaces here on the next
      // render rather than being invisible until somebody notices.
      expect(claimed.has(capability) !== gaps.has(capability)).toBe(true)
    }
    expect(claimed.size + gaps.size).toBe(Object.keys(CAPABILITIES).length)

    // And the partition is not satisfied by putting everything on the gap side:
    // this build claims a reader for every capability the registry declares, so
    // the gap list is empty TODAY. A capability added to `capabilities.ts` that
    // no section covers reds this line — which is the whole point of computing
    // `noReader` rather than hand-listing it.
    expect(readings.coverage.noReader).toEqual([])
    expect(claimed.size).toBe(Object.keys(CAPABILITIES).length)
  })

  test("a capability no section covers is NO_READER — a gap in the console, never an absence in the account", () => {
    // `estateCoverage` is the exported function `estateInventory` calls and a
    // surface re-runs over `readings.sections`. Driving it with the ECR section
    // withheld is the only way to SEE a populated `noReader` on a build that
    // currently reads everything — and a populated one is exactly what a caller
    // must be able to render differently from ABSENT.
    const withoutEcr: readonly EstateSection[] = []
    const report = estateCoverage(withoutEcr)
    const gap = report.noReader.find((entry) => entry.capability === "ecr:DescribeRepositories")

    expect(gap).toBeDefined()
    expect(gap?.service).toBe("ecr")
    // The wording has to say whose gap it is. "No ECR repositories" would be a
    // claim about the account; this is a claim about the console.
    expect(gap?.why).toContain("no module in this build reads ecr:DescribeRepositories")
    expect(gap?.why).toContain("may well be present there")

    // NO_READER is not folded into any of the other three lists.
    expect(report.absent).toEqual([])
    expect(report.visible).toEqual([])
    expect(report.unknown).toEqual([])
    expect(report.noReader).toHaveLength(Object.keys(CAPABILITIES).length)
  })

  test("a reader that exists but is deliberately not driven says so, and is not an absence", async () => {
    const readings = await inventory(ESTATE)
    const metrics = section(readings, "cloudwatch:GetMetricData")

    expect(metrics.coverage.kind).toBe("NOT_COMPOSED")
    expect(metrics.contribution.kind).toBe("not-composed")
    if (metrics.coverage.kind !== "NOT_COMPOSED") throw new Error("narrowing")
    expect(metrics.coverage.why).toContain("caller's own queries")

    expect(readings.coverage.absent).not.toContain("cloudwatch:GetMetricData")
    expect(readings.coverage.notComposed.map((gap) => gap.capability)).toContain(
      "cloudwatch:GetMetricData",
    )
  })
})

/* ==================================================================== 2 == */

describe("one denied service does not collapse the inventory", () => {
  test("ECR denied leaves every other section real, and the total says what it excludes", async () => {
    const readings = await inventory({
      ...ESTATE,
      "ecr:DescribeRepositories": () => {
        throw awsError("AccessDeniedException")
      },
    })

    // The bucket is still there, read, named and attributed.
    const buckets = sectionResources(section(readings, "s3:ListBuckets"))
    expect(buckets.map((resource) => resource.name)).toEqual(["tenure-prod-uploads"])
    expect(readings.count.counted).toBe(buckets.length)

    // And the number is not offered on its own.
    expect(readings.count.complete).toBe(false)
    expect(readings.count.excluded.map((entry) => entry.capability)).toContain(
      "ecr:DescribeRepositories",
    )
    expect(readings.count.text).toContain("at least")
    expect(readings.count.text).toContain("EXCLUDES")
    expect(readings.count.text).toContain("Image repositories")
  })

  test("a reader that throws outright degrades only its own section", async () => {
    // Not an AWS error at all — the kind of failure an adapter has, not a
    // service. `Promise.all` over the raw readers would have made this take
    // down the estate.
    const readings = await inventory({
      ...ESTATE,
      "route53:ListHostedZones": () => {
        throw new TypeError("cannot read properties of undefined")
      },
    })

    const dns = section(readings, "route53:ListHostedZones")
    expect(dns.coverage.kind).toBe("UNKNOWN")
    if (dns.coverage.kind !== "UNKNOWN") throw new Error("narrowing")
    expect(dns.coverage.state).toBe("ERROR")

    // Everything else answered exactly as it does with no failure at all.
    expect(sectionResources(section(readings, "ecr:DescribeRepositories"))).toHaveLength(1)
    expect(sectionResources(section(readings, "s3:ListBuckets"))).toHaveLength(1)
    expect(readings.count.counted).toBe(2)
  })

  test("half a service — one WAF scope readable, the other refused — keeps the readable half and names the other", async () => {
    const readings = await inventory({
      ...ESTATE,
      "wafv2:ListWebACLs": (input) => {
        // REGIONAL and CLOUDFRONT are separately permissioned in real policies,
        // and a role holding one and not the other is the ordinary case.
        if (input?.Scope === "CLOUDFRONT") throw awsError("AccessDeniedException")
        return {
          WebACLs: [
            {
              Name: "tenure-regional",
              Id: "11111111-2222-3333-4444-555555555555",
              ARN: `arn:aws:wafv2:${REGION}:${ACCOUNT}:regional/webacl/tenure-regional/1111`,
            },
          ],
        }
      },
    })

    const waf = section(readings, "wafv2:ListWebACLs")
    // The half that answered is real, counted and named. It is not discarded
    // because its sibling scope was refused.
    expect(sectionResources(waf).map((resource) => resource.name)).toEqual(["tenure-regional"])

    // And the half that did not is stated, not implied by its absence. A reader
    // of this section must not conclude the account has one web ACL.
    expect(waf.contribution.kind).toBe("resources")
    if (waf.contribution.kind !== "resources") throw new Error("narrowing")
    expect(waf.contribution.omitted.map((entry) => entry.label)).toEqual([
      "CLOUDFRONT-scope web ACLs",
    ])
    expect(waf.contribution.omitted[0].why).toContain("wafv2:ListWebACLs")
    expect(waf.contribution.omitted[0].service).toBe("wafv2")

    // It reaches the total, so the total cannot be read as complete.
    expect(readings.count.omitted.map((entry) => entry.label)).toContain(
      "CLOUDFRONT-scope web ACLs",
    )
    expect(readings.count.complete).toBe(false)
  })

  test("a resource the published contract refuses takes down its own section and nothing else", async () => {
    const readings = await inventory({
      ...ESTATE,
      "ecr:DescribeRepositories": () => ({
        repositories: [
          {
            repositoryName: "tenure-web",
            // Eleven digits. `parseEstateResource` requires twelve, so this is
            // an adapter bug reaching the runtime gate — the case the gate is
            // there for. It must not render, and it must not take the load down.
            repositoryArn: `arn:aws:ecr:${REGION}:12345678901:repository/tenure-web`,
          },
        ],
      }),
    })

    const ecr = section(readings, "ecr:DescribeRepositories")
    expect(ecr.coverage.kind).toBe("UNKNOWN")
    if (ecr.coverage.kind !== "UNKNOWN") throw new Error("narrowing")
    expect(ecr.coverage.state).toBe("ERROR")
    // Not ABSENT. "ECR holds nothing" would be a claim about the account, and
    // what actually happened is that this build could not represent what it read.
    expect(readings.coverage.absent).not.toContain("ecr:DescribeRepositories")
    expect(sectionResources(ecr)).toEqual([])

    // Every other section is exactly what it is with no failure at all.
    expect(sectionResources(section(readings, "s3:ListBuckets")).map((r) => r.name)).toEqual([
      "tenure-prod-uploads",
    ])
    expect(readings.count.excluded.map((entry) => entry.capability)).toContain(
      "ecr:DescribeRepositories",
    )
  })

  test("with no credentials at all the load still resolves, and every section says UNKNOWN rather than nothing", async () => {
    // The console must keep booting when STS itself is unreachable. A page that
    // throws because the credential chain is empty is not a refusal an operator
    // can act on — it is an outage in the tool they reached for to diagnose one.
    const readings = await estateInventory(
      {
        async call() {
          throw awsError("CredentialsProviderError")
        },
        async resolvedRegion() {
          throw awsError("CredentialsProviderError")
        },
      },
      { now: NOW },
    )

    expect(readings.identity.state).not.toBe("ACTUAL")
    expect(readings.count.counted).toBe(0)
    expect(readings.count.complete).toBe(false)
    expect(readings.count.text).toContain("at least 0 resources")
    expect(readings.count.text).toContain("EXCLUDES")

    // Not one section claims the account holds nothing. Zero VISIBLE and zero
    // ABSENT is the correct answer when nothing could be read at all.
    expect(readings.coverage.visible).toEqual([])
    expect(readings.coverage.absent).toEqual([])
    expect(readings.coverage.unknown.length).toBeGreaterThan(0)
    for (const entry of readings.sections) {
      expect(["UNKNOWN", "NOT_COMPOSED"]).toContain(entry.coverage.kind)
    }
  })

  test("the four surfaces three pages read by name survive a failure in any other service", async () => {
    const readings = await inventory({
      ...ESTATE,
      "s3:ListBuckets": () => {
        throw awsError("AccessDeniedException")
      },
      "cognito-idp:ListUserPools": () => {
        throw awsError("ThrottlingException")
      },
    })

    for (const read of [
      readings.ecsServices,
      readings.databases,
      readings.distributions,
      readings.certificates,
    ]) {
      // EMPTY, because this estate holds none of them — not DENIED, and not a
      // failure borrowed from a neighbouring service.
      expect(read.state).toBe("EMPTY")
    }
    expect(estateLines(readings).map((line) => line.surface)).toEqual([
      "ECS services",
      "Databases",
      "Edge distributions",
      "Certificates",
    ])
  })
})

/* ==================================================================== 3 == */

describe("the total is never a bare number", () => {
  test("services with a reader this page does not drive are excluded by name", async () => {
    const readings = await inventory(ESTATE)
    const excluded = readings.count.excluded.map((entry) => entry.capability)

    // Backup vaults and SSM parameters are resources, read per tenant, and
    // genuinely not in this total. A count that omitted them silently would be
    // a lie with a number on it.
    expect(excluded).toContain("backup:ListBackupVaults")
    expect(excluded).toContain("ssm:DescribeParameters")
    expect(readings.count.complete).toBe(false)
    expect(readings.count.text).toContain("at least")
  })

  test("a resource read but not nameable by an ARN is omitted out loud, never dropped", async () => {
    const readings = await inventory({
      ...ESTATE,
      "ecr:DescribeRepositories": () => ({
        repositories: [
          { repositoryName: "tenure-web", repositoryArn: repoArn("tenure-web") },
          // ECR answered, and answered without an ARN. The repository exists.
          { repositoryName: "tenure-worker" },
        ],
      }),
    })

    const ecr = section(readings, "ecr:DescribeRepositories")
    expect(ecr.contribution.kind).toBe("resources")
    if (ecr.contribution.kind !== "resources") throw new Error("narrowing")
    expect(ecr.contribution.omitted.map((entry) => entry.label)).toEqual(["tenure-worker"])
    expect(sectionResources(ecr).map((resource) => resource.name)).toEqual(["tenure-web"])

    expect(readings.count.omitted.map((entry) => entry.label)).toContain("tenure-worker")
    expect(readings.count.text).toContain("could not")
  })

  test("estateResourceCount and estateCoverage are the same functions the readings carry", async () => {
    const readings = await inventory(ESTATE)
    expect(estateResourceCount(readings.sections)).toEqual(readings.count)
    expect(estateCoverage(readings.sections)).toEqual(readings.coverage)
  })
})

/* ==================================================================== 4 == */

describe("thirty readers, not thirty times the calls", () => {
  test("identity and the tag index are read once for the whole load", async () => {
    const stand = gatewayFor(ESTATE)
    const readings = await estateInventory(stand.gateway, { now: NOW })

    // Every reader in this directory resolves identity and reads the tag index
    // for itself. Thirty of them running together must still be one of each.
    expect(stand.calls.get("sts:GetCallerIdentity")).toBe(1)
    expect(stand.calls.get("tag:GetResources")).toBe(1)
    expect(stand.calls.get("|resolvedRegion")).toBe(1)

    expect(readings.calls.byCapability["sts:GetCallerIdentity"]).toBe(1)
    expect(readings.calls.deduplicated).toBeGreaterThan(0)
    expect(readings.calls.asked).toBeGreaterThan(readings.calls.issued)
  })

  test("a second load inside the cadence window issues nothing, and the answers are the same", async () => {
    const stand = gatewayFor(ESTATE)
    const first = await estateInventory(stand.gateway, { now: NOW, cache: true })
    const issuedAfterFirst = first.calls.issued
    expect(issuedAfterFirst).toBeGreaterThan(0)

    const second = await estateInventory(stand.gateway, { now: NOW, cache: true })
    expect(second.calls.issued).toBe(0)
    expect(second.calls.fromCache).toBeGreaterThan(0)
    expect(sectionResources(section(second, "ecr:DescribeRepositories"))).toEqual(
      sectionResources(section(first, "ecr:DescribeRepositories")),
    )
  })

  test("a capability past its own window is re-read while a longer-lived one is not", async () => {
    const stand = gatewayFor(ESTATE)
    await estateInventory(stand.gateway, { now: NOW, cache: true })
    const ecrCalls = stand.calls.get("ecr:DescribeRepositories") ?? 0

    // Ten minutes on: ECR repositories declare a ten-minute window and ACM
    // declares an hour. The windows are the registry's, not this file's.
    const later = () => new Date(NOW().getTime() + CAPABILITIES["ecr:DescribeRepositories"].refreshMs)
    await estateInventory(stand.gateway, { now: later, cache: true })

    expect(stand.calls.get("ecr:DescribeRepositories")).toBe(ecrCalls + 1)
    expect(stand.calls.get("acm:ListCertificates")).toBe(1)
  })

  test("a denial is held for the window; a throttle never is", async () => {
    const denying = gatewayFor({
      ...ESTATE,
      "ecr:DescribeRepositories": () => {
        throw awsError("AccessDeniedException")
      },
    })
    await estateInventory(denying.gateway, { now: NOW, cache: true })
    const deniedCalls = denying.calls.get("ecr:DescribeRepositories") ?? 0
    await estateInventory(denying.gateway, { now: NOW, cache: true })
    // An IAM policy does not change between two reads in the same second.
    expect(denying.calls.get("ecr:DescribeRepositories")).toBe(deniedCalls)

    __resetInventoryCache()

    const throttling = gatewayFor({
      ...ESTATE,
      "ecr:DescribeRepositories": () => {
        throw awsError("ThrottlingException")
      },
    })
    await estateInventory(throttling.gateway, { now: NOW, cache: true })
    const throttledCalls = throttling.calls.get("ecr:DescribeRepositories") ?? 0
    await estateInventory(throttling.gateway, { now: NOW, cache: true })
    // The remedy for a throttle is to ask again. A cached one would make the
    // next window's worth of loads fail for a reason that had already passed.
    expect(throttling.calls.get("ecr:DescribeRepositories")).toBeGreaterThan(throttledCalls)
  })
})

/* ==================================================================== 5 == */

describe("what the surfaces render", () => {
  test("estateSectionLines opens with exactly the four lines estateLines has always returned", async () => {
    const readings = await inventory(ESTATE)
    const legacy = estateLines(readings)
    const all = estateSectionLines(readings)

    expect(all.slice(0, 4)).toEqual(legacy)
    // And it is not only those four any more.
    expect(all.length).toBeGreaterThan(legacy.length)
    expect(all.map((line) => line.surface)).toContain("Buckets")
    expect(all.map((line) => line.surface)).toContain("Image repositories")
  })

  test("a bucket ARN carries no account, and the resource still names the account it was read in", async () => {
    const readings = await inventory(ESTATE)
    const [bucket] = sectionResources(section(readings, "s3:ListBuckets"))

    expect(bucket.arn).toBe("arn:aws:s3:::tenure-prod-uploads")
    // The ARN's account segment is empty by construction. The account is the
    // one STS resolved — never a literal, and never left blank.
    expect(bucket.accountId).toBe(ACCOUNT)
    expect(bucket.contract.accountId).toBe(ACCOUNT)
    expect(bucket.contract.region).toBe("global")
    expect(bucket.contract.stateful).toBe(true)
  })

  test("a resource is attributed from the tag index, through the same join as every other service", async () => {
    const readings = await inventory(ESTATE)
    const [repository] = sectionResources(section(readings, "ecr:DescribeRepositories"))

    expect(repository.attribution).toEqual({ kind: "shared" })
    expect(repository.contract.environment).toBe("prod")
    expect(repository.contract.service).toBe("ecr")
    expect(repository.contract.resourceType).toBe("repository")
  })

  test("every section states its own cadence from the registry rather than a number typed here", async () => {
    const readings = await inventory(ESTATE)
    for (const entry of readings.sections) {
      expect(entry.refreshMs).toBe(CAPABILITIES[entry.capability].refreshMs)
    }
  })
})
