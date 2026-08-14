import { SHARED } from "@tenure/provisioning"

import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  DETECTOR_CONFIGURATION_NOT_READABLE,
  GET_FINDINGS_BATCH,
  MAX_DETECTOR_PAGES,
  MAX_FINDINGS_PER_DETECTOR,
  countBySeverity,
  guardDutyCoverage,
  guardDutyLines,
  guardDutyReadings,
  rankFindings,
  severityBand,
  type GuardDutyReadings,
} from "./guardduty"

/**
 * STUDIO-070-004 (GuardDuty) — the four outcomes are four different sentences,
 * and "0 findings" is never one of them on its own.
 *
 * The assertions are on `guardDutyReadings` and `guardDutyLines`, the functions
 * a surface renders, rather than on `readAws` or on a parser. A test that drove
 * a private helper would stay green on the day this module stopped calling it,
 * which is a failure this programme has already paid for.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers five capabilities with the shapes the real SDK returns —
 * `{DetectorIds, NextToken}` from ListDetectors, `{FindingIds, NextToken}` from
 * ListFindings, `{Findings: [...]}` from GetFindings, `{ResourceTagMappingList}`
 * from the Tagging API and `{Account, Arn}` from STS — and it can fail each of
 * them INDEPENDENTLY with `AccessDeniedException`, `ThrottlingException`, an
 * empty-but-successful list, or a populated one. A stand-in that returned `[]`
 * regardless of what was asked would prove nothing about code whose entire job
 * is telling those four apart, and it is the fake this repository has already
 * been burnt by. One test asserts the four render as four PAIRWISE DISTINCT
 * strings, which is the assertion such a fake fails.
 *
 * ## Nothing here is a real AWS identifier
 *
 * `123456789012` is AWS's own documentation placeholder account. The detector id
 * is `0123456789abcdef0123456789abcdef`, obviously constructed rather than a
 * real 32-hex detector id. No real ARN, account, region or resource name from
 * any live estate appears in this file.
 */

/* ------------------------------------------------------------- the estate -- */

/** AWS's documentation placeholder. Not a real account. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const ROLE_ARN = `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`

/** Obviously constructed. A real detector id is 32 random hex characters. */
const DETECTOR = "0123456789abcdef0123456789abcdef"
const SECOND_DETECTOR = "fedcba9876543210fedcba9876543210"

const BUCKET_ARN = "arn:aws:s3:::tenure-prod-uploads"
const INSTANCE_ID = "i-0abc0abc0abc0abc0"
const INSTANCE_ARN = `arn:aws:ec2:${REGION}:${ACCOUNT}:instance/${INSTANCE_ID}`

/** A tag set that attributes to a tenant. Only `tenure:tenant` is load-bearing. */
function tenantTags(slug: string): Array<{ Key: string; Value: string }> {
  return [
    { Key: "tenure:tenant", Value: slug },
    { Key: "tenure:environment", Value: "production" },
    { Key: "tenure:module", Value: "storage" },
  ]
}

/* ---------------------------------------------------------- the findings -- */

type RawFinding = Record<string, unknown>

/**
 * Findings shaped exactly as GetFindings returns them: `Severity` a NUMBER,
 * `CreatedAt`/`UpdatedAt` and `EventFirstSeen`/`EventLastSeen` ISO STRINGS, the
 * type verbatim, and the resource block in the per-type shape AWS uses.
 */
function bruteForce(): RawFinding {
  return {
    Id: "finding-ssh-brute-force",
    Arn: `arn:aws:guardduty:${REGION}:${ACCOUNT}:detector/${DETECTOR}/finding/finding-ssh-brute-force`,
    Type: "UnauthorizedAccess:EC2/SSHBruteForce",
    Title: "SSH brute force attacks against i-0abc0abc0abc0abc0",
    Description: "EC2 instance has been involved in SSH brute force attacks.",
    Severity: 8,
    AccountId: ACCOUNT,
    Region: REGION,
    Partition: "aws",
    CreatedAt: "2026-08-12T22:04:11.000Z",
    UpdatedAt: "2026-08-13T08:41:02.000Z",
    Resource: { ResourceType: "Instance", InstanceDetails: { InstanceId: INSTANCE_ID } },
    Service: {
      DetectorId: DETECTOR,
      ServiceName: "guardduty",
      FeatureName: "FlowLogs",
      Archived: false,
      Count: 42,
      EventFirstSeen: "2026-08-12T22:00:00.000Z",
      EventLastSeen: "2026-08-13T08:40:00.000Z",
    },
  }
}

function attackSequence(): RawFinding {
  return {
    Id: "finding-attack-sequence",
    Type: "AttackSequence:IAM/CompromisedCredentials",
    Title: "Potential compromise of IAM credentials",
    Severity: 9,
    AccountId: ACCOUNT,
    Region: REGION,
    Partition: "aws",
    CreatedAt: "2026-08-13T07:00:00.000Z",
    UpdatedAt: "2026-08-13T08:55:00.000Z",
    Resource: {
      ResourceType: "AccessKey",
      AccessKeyDetails: { AccessKeyId: "AKIAEXAMPLEEXAMPLE00", UserName: "tenure-ci", UserType: "IAMUser" },
    },
    Service: {
      DetectorId: DETECTOR,
      ServiceName: "guardduty",
      FeatureName: "CloudTrail",
      Archived: false,
      Count: 3,
      EventFirstSeen: "2026-08-13T06:59:00.000Z",
      EventLastSeen: "2026-08-13T08:54:00.000Z",
    },
  }
}

function bucketExposed(): RawFinding {
  return {
    Id: "finding-bucket-anonymous",
    Type: "Policy:S3/BucketAnonymousAccessGranted",
    Title: "Bucket policy grants access to everyone",
    Severity: 5,
    AccountId: ACCOUNT,
    Region: REGION,
    Partition: "aws",
    CreatedAt: "2026-08-11T10:00:00.000Z",
    UpdatedAt: "2026-08-13T05:00:00.000Z",
    Resource: {
      ResourceType: "S3Bucket",
      S3BucketDetails: [{ Arn: BUCKET_ARN, Name: "tenure-prod-uploads" }],
    },
    Service: {
      DetectorId: DETECTOR,
      ServiceName: "guardduty",
      FeatureName: "S3DataEvents",
      Archived: false,
      Count: 1,
      EventFirstSeen: "2026-08-11T09:58:00.000Z",
      EventLastSeen: "2026-08-13T04:59:00.000Z",
    },
  }
}

function portProbe(): RawFinding {
  return {
    Id: "finding-port-probe",
    Type: "Recon:EC2/PortProbeUnprotectedPort",
    Title: "Unprotected port on i-0abc0abc0abc0abc0 is being probed",
    Severity: 2,
    AccountId: ACCOUNT,
    Region: REGION,
    Partition: "aws",
    CreatedAt: "2026-08-10T01:00:00.000Z",
    UpdatedAt: "2026-08-13T02:00:00.000Z",
    Resource: { ResourceType: "Instance", InstanceDetails: { InstanceId: INSTANCE_ID } },
    Service: {
      DetectorId: DETECTOR,
      ServiceName: "guardduty",
      FeatureName: "FlowLogs",
      Archived: false,
      Count: 900,
      EventFirstSeen: "2026-08-10T00:55:00.000Z",
      EventLastSeen: "2026-08-13T01:59:00.000Z",
    },
  }
}

/** No `Severity` at all — the value this engine must not read as "low". */
function unrankable(): RawFinding {
  return {
    Id: "finding-no-severity",
    Type: "Discovery:S3/MaliciousIPCaller",
    Title: "S3 API called from a known malicious IP",
    AccountId: ACCOUNT,
    Region: REGION,
    Partition: "aws",
    Resource: {
      ResourceType: "S3Bucket",
      S3BucketDetails: [{ Arn: BUCKET_ARN, Name: "tenure-prod-uploads" }],
    },
    Service: {
      DetectorId: DETECTOR,
      ServiceName: "guardduty",
      Archived: false,
      EventFirstSeen: "2026-08-13T03:00:00.000Z",
      EventLastSeen: "2026-08-13T03:30:00.000Z",
    },
  }
}

function liveEstate(): RawFinding[] {
  return [bruteForce(), attackSequence(), bucketExposed(), portProbe(), unrankable()]
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface DetectorFixture {
  /** How `guardduty:ListFindings` behaves for THIS detector. */
  listFindings?: Outcome
  /** How `guardduty:GetFindings` behaves for THIS detector. */
  getFindings?: Outcome
  findings?: RawFinding[]
  /** Ids ListFindings reports. Defaults to the ids of `findings`. */
  findingIds?: string[]
  /** ListFindings never stops handing back a NextToken. Exercises the page cap. */
  endlessFindingPages?: boolean
}

interface FakeOptions {
  listDetectors?: Outcome
  detectors?: Record<string, DetectorFixture>
  /** ListDetectors never stops handing back a NextToken. Exercises the page cap. */
  endlessDetectorPages?: boolean
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function outcomeGate(outcome: Outcome): void {
  if (outcome === "denied") throwing("AccessDeniedException")
  if (outcome === "throttled") throwing("ThrottlingException")
}

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * and independently failable per capability AND per detector.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.listDetectors ?? "populated"
  const detectors = options.detectors ?? { [DETECTOR]: { findings: liveEstate() } }
  const identity = options.identity ?? { arn: ROLE_ARN, account: ACCOUNT, region: REGION }
  const calls = options.calls ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
      const arg = (input ?? {}) as Record<string, unknown>

      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "tag:GetResources": {
          const outcome = options.tagsOutcome ?? "populated"
          outcomeGate(outcome)
          if (outcome === "empty") return { ResourceTagMappingList: [] }
          return {
            ResourceTagMappingList: Object.entries(options.tags ?? {}).map(([arn, Tags]) => ({
              ResourceARN: arn,
              Tags,
            })),
          }
        }

        case "guardduty:ListDetectors": {
          outcomeGate(listOutcome)
          // The real API OMITS DetectorIds entirely when there are none. It does
          // not return an empty array, and a fake that did would be testing a
          // response AWS never sends.
          if (listOutcome === "empty") return {}
          const ids = Object.keys(detectors).sort()
          if (options.endlessDetectorPages) {
            const page = Number(arg.NextToken ?? 0)
            return {
              DetectorIds: [`${DETECTOR.slice(0, 30)}${String(page).padStart(2, "0")}`],
              NextToken: String(page + 1),
            }
          }
          return { DetectorIds: ids }
        }

        case "guardduty:ListFindings": {
          const id = String(arg.DetectorId ?? "")
          const fixture = detectors[id]
          if (!fixture) throwing("BadRequestException")
          outcomeGate(fixture.listFindings ?? "populated")
          if ((fixture.listFindings ?? "populated") === "empty") return {}
          if (fixture.endlessFindingPages) {
            const page = Number(arg.NextToken ?? 0)
            return {
              FindingIds: Array.from({ length: 50 }, (_, i) => `paged-${page}-${i}`),
              NextToken: String(page + 1),
            }
          }
          const ids = fixture.findingIds ?? (fixture.findings ?? []).map((f) => String(f.Id))
          return ids.length > 0 ? { FindingIds: ids } : {}
        }

        case "guardduty:GetFindings": {
          const id = String(arg.DetectorId ?? "")
          const fixture = detectors[id]
          if (!fixture) throwing("BadRequestException")
          outcomeGate(fixture.getFindings ?? "populated")
          if ((fixture.getFindings ?? "populated") === "empty") return {}
          const wanted = new Set((arg.FindingIds as string[] | undefined) ?? [])
          if (wanted.size > GET_FINDINGS_BATCH) {
            // AWS rejects more than 50 ids in one request. A fake that accepted
            // them would let a batching bug ship green.
            throwing("BadRequestException")
          }
          return { Findings: (fixture.findings ?? []).filter((f) => wanted.has(String(f.Id))) }
        }

        default:
          throw new Error(
            `the stand-in was asked for ${String(capability)}, which this suite does not exercise`,
          )
      }
    },
    async resolvedRegion() {
      return identity === "denied" ? REGION : identity.region
    },
  }
}

const AT = () => new Date("2026-08-13T09:15:00.000Z")

async function load(options: FakeOptions = {}): Promise<GuardDutyReadings> {
  return guardDutyReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: GuardDutyReadings): string {
  return guardDutyLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the GuardDuty surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every finding type verbatim", async () => {
    const readings = await load()
    expect(readings.detectors.state).toBe("ACTUAL")
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.detectors.value).toHaveLength(1)

    const text = surfaceText(readings)
    // Verbatim, not a paraphrase. This string is what an operator searches for.
    expect(text).toContain("UnauthorizedAccess:EC2/SSHBruteForce")
    expect(text).toContain("AttackSequence:IAM/CompromisedCredentials")
    expect(text).toContain("Policy:S3/BucketAnonymousAccessGranted")
    expect(text).toContain("Recon:EC2/PortProbeUnprotectedPort")
    // First and last seen come from Service.EventFirstSeen / EventLastSeen.
    expect(text).toContain("first seen 2026-08-12T22:00:00.000Z, last seen 2026-08-13T08:40:00.000Z")
  })

  test("an empty-but-successful list is EMPTY, and it is the finding — not an absence", async () => {
    const readings = await load({ listDetectors: "empty" })
    expect(readings.detectors.state).toBe("EMPTY")
    expect(readings.posture.kind).toBe("not-enabled")

    const text = surfaceText(readings)
    expect(text).toContain("NOTHING IS WATCHING")
    // The remedy, naming both the Terraform resource and the API action.
    expect(text).toContain("aws_guardduty_detector")
    expect(text).toContain("guardduty:CreateDetector")
    // The cost implication, with no invented figure in it.
    expect(text).toContain("GuardDuty is not free")
    expect(text).toContain("This engine states no figure")
    expect(text).not.toMatch(/\$\d/)
    // It is not a refusal, so it must not print a policy to paste.
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listDetectors: "denied" })
    expect(readings.detectors.state).toBe("DENIED")
    if (readings.detectors.state !== "DENIED") throw new Error("narrowing")

    expect(readings.detectors.action).toBe("guardduty:ListDetectors")
    expect(readings.detectors.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.detectors.accountId).toBe(ACCOUNT)
    expect(readings.detectors.region).toBe(REGION)
    expect(readings.detectors.partition).toBe("aws")
    expect(JSON.parse(readings.detectors.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["guardduty:ListDetectors"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so
    // a caller cannot reach an empty array.
    expect("value" in readings.detectors).toBe(false)
    expect(readings.posture.kind).toBe("unknown")

    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    // The two sentences that would be a lie: a refusal must never read as an
    // absence, and must never read as the finding that GuardDuty is off.
    expect(text).not.toContain("NOTHING IS WATCHING")
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ listDetectors: "throttled" })
    expect(readings.detectors.state).toBe("THROTTLED")
    if (readings.detectors.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.detectors.retryAfterMs).toBe(800)

    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
    expect(text).not.toContain("NOTHING IS WATCHING")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ listDetectors: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that
    // notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------ a detector that exists is not a pass -- */

describe("a detector's status is unknown, and that is said rather than defaulted", () => {
  test("the configuration is NOT_READABLE and names guardduty:GetDetector", async () => {
    const readings = await load()
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const detector = readings.detectors.value[0]
    expect(detector.configuration).toBe(DETECTOR_CONFIGURATION_NOT_READABLE)
    expect(detector.configuration.state).toBe("NOT_READABLE")
    expect(detector.configuration.needs).toBe("guardduty:GetDetector")

    const text = surfaceText(readings)
    expect(text).toContain("guardduty:GetDetector")
    expect(text).toContain("ENABLED or SUSPENDED")
    // The five protection plans are each named, not summarised away.
    expect(text).toContain("S3 Protection")
    expect(text).toContain("EKS Protection")
    expect(text).toContain("Malware Protection")
    expect(text).toContain("RDS Protection")
    expect(text).toContain("Lambda Protection")
    expect(text).toContain("publishing frequency")
  })

  test("zero findings from a detector never reads as a clean bill of health", async () => {
    const readings = await load({
      detectors: { [DETECTOR]: { listFindings: "empty" } },
    })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.detectors.value[0].findings.state).toBe("EMPTY")

    const text = surfaceText(readings)
    expect(text).toContain("NOT a clean bill of health")
    expect(text).toContain("A suspended detector generates no new findings")
    // The one word this surface may never print unqualified about a zero.
    expect(text).not.toContain("all clear")
  })

  test("coverage can never reach CHECKING, and its three reachable states differ", async () => {
    const present = guardDutyCoverage(await load())
    expect(present.state).toBe("PARTIAL")
    expect(present.remedy).toContain("guardduty:GetDetector")

    __resetIdentity()
    const off = guardDutyCoverage(await load({ listDetectors: "empty" }))
    expect(off.state).toBe("NOT_CHECKING")
    expect(off.detail).toContain("NO detector in this region")

    __resetIdentity()
    const refused = guardDutyCoverage(await load({ listDetectors: "denied" }))
    expect(refused.state).toBe("UNREADABLE")
    expect(refused.action).toBe("guardduty:ListDetectors")
    expect(refused.minimumStatement).toBeDefined()

    expect(new Set([present.state, off.state, refused.state]).size).toBe(3)
    // Every one of them uses the key the security page already declares, so a
    // live row displaces its own placeholder rather than sitting beside it.
    for (const row of [present, off, refused]) expect(row.key).toBe("guardduty::detectors")
  })
})

/* ------------------------------------------- sub-calls degrade separately -- */

describe("one denied detail does not collapse the row, and names its OWN action", () => {
  test("a refused GetFindings keeps the detector, and prints GetFindings' statement", async () => {
    const readings = await load({
      detectors: { [DETECTOR]: { findings: liveEstate(), getFindings: "denied" } },
    })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const detector = readings.detectors.value[0]

    // The row survives. It does not vanish and it does not render as zero.
    expect(detector.detectorId).toBe(DETECTOR)
    // The ids were readable, so that read is ACTUAL and says so.
    expect(detector.findingIds.state).toBe("ACTUAL")
    expect(detector.findings.state).toBe("DENIED")
    if (detector.findings.state !== "DENIED") throw new Error("narrowing")

    // The whole point: the minimum statement carries the action that is ACTUALLY
    // missing. Printing guardduty:ListFindings here sends an operator to grant a
    // permission they already have.
    expect(detector.findings.action).toBe("guardduty:GetFindings")
    expect(JSON.parse(detector.findings.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["guardduty:GetFindings"],
      Resource: "arn:*:guardduty:*:*:detector/*",
    })

    const text = surfaceText(readings)
    expect(text).toContain(DETECTOR)
    expect(text).toContain("guardduty:GetFindings")
  })

  test("a refused ListFindings reports under ListFindings, and GetFindings says why it never ran", async () => {
    const readings = await load({
      detectors: { [DETECTOR]: { listFindings: "denied" } },
    })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const detector = readings.detectors.value[0]

    expect(detector.findingIds.state).toBe("DENIED")
    if (detector.findingIds.state !== "DENIED") throw new Error("narrowing")
    expect(detector.findingIds.action).toBe("guardduty:ListFindings")

    // Not DENIED under GetFindings — that call was never made, and reporting it
    // as refused would send an operator to grant an action nothing tried.
    expect(detector.findings.state).toBe("UNCONFIGURED")
    if (detector.findings.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(detector.findings.capability).toBe("guardduty:GetFindings")
    expect(detector.findings.why).toContain("guardduty:ListFindings")
  })

  test("one broken detector does not silence the other", async () => {
    const readings = await load({
      detectors: {
        [DETECTOR]: { listFindings: "denied" },
        [SECOND_DETECTOR]: { findings: [bruteForce()] },
      },
    })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.detectors.value).toHaveLength(2)

    const broken = readings.detectors.value.find((d) => d.detectorId === DETECTOR)
    const working = readings.detectors.value.find((d) => d.detectorId === SECOND_DETECTOR)
    expect(broken?.findingIds.state).toBe("DENIED")
    expect(working?.findings.state).toBe("ACTUAL")

    // And the top-line answer names the detector it could not read rather than
    // quietly reporting a count that is missing half the estate.
    expect(readings.posture.kind).toBe("detectors-present")
    if (readings.posture.kind !== "detectors-present") throw new Error("narrowing")
    expect(readings.posture.unreadable).toEqual([DETECTOR])
    expect(surfaceText(readings)).toContain("so this count is a floor")
  })
})

/* ---------------------------------------------------- ranking and severity -- */

describe("findings are ranked by severity and an unreadable severity is not a low one", () => {
  test("AWS's published bands, at every boundary", () => {
    expect(severityBand(10)).toBe("CRITICAL")
    expect(severityBand(9)).toBe("CRITICAL")
    expect(severityBand(8.9)).toBe("HIGH")
    expect(severityBand(7)).toBe("HIGH")
    expect(severityBand(6.9)).toBe("MEDIUM")
    expect(severityBand(4)).toBe("MEDIUM")
    expect(severityBand(3.9)).toBe("LOW")
    expect(severityBand(1)).toBe("LOW")
    expect(severityBand(0.5)).toBe("INFORMATIONAL")
    // The three that must not become a band this engine did not read.
    expect(severityBand(null)).toBe("UNRANKED")
    expect(severityBand(Number.NaN)).toBe("UNRANKED")
    expect(severityBand(11)).toBe("UNRANKED")
  })

  test("the rendered order is unranked, then critical, then down", async () => {
    const readings = await load()
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const findings = readings.detectors.value[0].findings
    if (findings.state !== "ACTUAL") throw new Error("narrowing")

    expect(findings.value.map((f) => f.band)).toEqual([
      "UNRANKED",
      "CRITICAL",
      "HIGH",
      "MEDIUM",
      "LOW",
    ])
    // And in the rendered surface, in that order.
    const text = surfaceText(readings)
    const positions = [
      "Discovery:S3/MaliciousIPCaller",
      "AttackSequence:IAM/CompromisedCredentials",
      "UnauthorizedAccess:EC2/SSHBruteForce",
      "Policy:S3/BucketAnonymousAccessGranted",
      "Recon:EC2/PortProbeUnprotectedPort",
    ].map((type) => text.indexOf(type))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)

    // The unranked one says WHY it is at the top rather than implying it is worst.
    expect(text).toContain("severity UNRANKED")
    expect(text).toContain("ranked above critical rather than assumed to be low")
  })

  test("the counts are per band and only for bands that occurred", async () => {
    const readings = await load()
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const findings = readings.detectors.value[0].findings
    if (findings.state !== "ACTUAL") throw new Error("narrowing")
    expect(countBySeverity(findings.value)).toEqual([
      { band: "UNRANKED", count: 1 },
      { band: "CRITICAL", count: 1 },
      { band: "HIGH", count: 1 },
      { band: "MEDIUM", count: 1 },
      { band: "LOW", count: 1 },
    ])
  })

  test("ranking is deterministic — the same input in any order gives one order", async () => {
    const readings = await load()
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const findings = readings.detectors.value[0].findings
    if (findings.state !== "ACTUAL") throw new Error("narrowing")
    const forwards = rankFindings(findings.value).map((f) => f.id)
    const backwards = rankFindings([...findings.value].reverse()).map((f) => f.id)
    expect(backwards).toEqual(forwards)
  })
})

/* ------------------------------------------------------------ attribution -- */

describe("attribution comes from a tag, and 'we could not look' is its own answer", () => {
  test("a finding on a tagged bucket attributes to that tenant", async () => {
    const readings = await load({ tags: { [BUCKET_ARN]: tenantTags("acme-university") } })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const findings = readings.detectors.value[0].findings
    if (findings.state !== "ACTUAL") throw new Error("narrowing")

    const bucket = findings.value.find((f) => f.type === "Policy:S3/BucketAnonymousAccessGranted")
    expect(bucket?.attribution).toEqual({ kind: "tenant", tenantSlug: "acme-university" })
    expect(surfaceText(readings)).toContain("acme-university")
  })

  test("an instance ARN is assembled from the finding's OWN partition, region and account", async () => {
    const readings = await load({ tags: { [INSTANCE_ARN]: tenantTags("riverside-college") } })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const findings = readings.detectors.value[0].findings
    if (findings.state !== "ACTUAL") throw new Error("narrowing")

    const brute = findings.value.find((f) => f.type === "UnauthorizedAccess:EC2/SSHBruteForce")
    expect(brute?.resource.arn).toBe(INSTANCE_ARN)
    expect(brute?.attribution).toEqual({ kind: "tenant", tenantSlug: "riverside-college" })
  })

  test("a tenure:shared tag is shared, and it is not the same as untagged", async () => {
    const readings = await load({
      tags: {
        [BUCKET_ARN]: [{ Key: "tenure:tenant", Value: SHARED }],
      },
    })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const findings = readings.detectors.value[0].findings
    if (findings.state !== "ACTUAL") throw new Error("narrowing")

    const bucket = findings.value.find((f) => f.type === "Policy:S3/BucketAnonymousAccessGranted")
    const instance = findings.value.find((f) => f.type === "UnauthorizedAccess:EC2/SSHBruteForce")
    expect(bucket?.attribution).toEqual({ kind: "shared" })
    expect(instance?.attribution).toEqual({ kind: "unattributed" })
  })

  test("a refused tag index is attribution unknown, NOT 'missing tenure:tenant'", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const findings = readings.detectors.value[0].findings
    if (findings.state !== "ACTUAL") throw new Error("narrowing")

    for (const finding of findings.value) {
      expect(finding.attribution.kind).toBe("unknown")
    }
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    // The sentence that would send an operator to add a tag that is already there.
    expect(text).not.toContain("unattributable — missing tenure:tenant")
  })

  test("a finding naming no taggable resource is unknown, with the reason", async () => {
    const readings = await load({ tags: {} })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const findings = readings.detectors.value[0].findings
    if (findings.state !== "ACTUAL") throw new Error("narrowing")

    // An access key is a credential, not a tagged resource: there is no ARN.
    const key = findings.value.find((f) => f.type === "AttackSequence:IAM/CompromisedCredentials")
    expect(key?.resource.arn).toBeNull()
    expect(key?.attribution.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("not a tagged resource")
  })
})

/* --------------------------------------------------------------- the caps -- */

describe("every page loop is bounded, and says so when it hits the bound", () => {
  test("a detector listing that never ends is capped and says THERE WERE MORE", async () => {
    const readings = await load({ endlessDetectorPages: true })
    expect(readings.detectorPages.kind).toBe("capped")
    if (readings.detectorPages.kind !== "capped") throw new Error("narrowing")
    expect(readings.detectorPages.read).toBe(MAX_DETECTOR_PAGES)
    expect(surfaceText(readings)).toContain("THERE WERE MORE")
  })

  test("a finding listing that never ends is capped at the finding cap", async () => {
    const readings = await load({
      detectors: { [DETECTOR]: { endlessFindingPages: true, findings: [] } },
    })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const detector = readings.detectors.value[0]
    expect(detector.idPages.kind).toBe("capped")
    if (detector.idPages.kind !== "capped") throw new Error("narrowing")
    expect(detector.idPages.read).toBe(MAX_FINDINGS_PER_DETECTOR)
    expect(detector.idPages.why).toContain("THERE WERE MORE")
    if (detector.findingIds.state !== "ACTUAL") throw new Error("narrowing")
    expect(detector.findingIds.value).toHaveLength(MAX_FINDINGS_PER_DETECTOR)
  })

  test("GetFindings is called in batches of at most 50 — AWS's own limit", async () => {
    const calls: string[] = []
    // 500 ids, hydrated 50 at a time, is ten GetFindings calls. The fake throws
    // BadRequestException on a batch of 51, so a batching bug is red here.
    const readings = await guardDutyReadings(
      fakeAws({ detectors: { [DETECTOR]: { endlessFindingPages: true, findings: [] } }, calls }),
      { now: AT },
    )
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.detectors.value[0].findings.state).not.toBe("ERROR")
    expect(calls.filter((c) => c === "guardduty:GetFindings")).toHaveLength(
      MAX_FINDINGS_PER_DETECTOR / GET_FINDINGS_BATCH,
    )
  })

  test("ids that GetFindings did not return are named, not silently dropped", async () => {
    const readings = await load({
      detectors: {
        [DETECTOR]: {
          findings: [bruteForce()],
          // ListFindings reports two; GetFindings only knows one of them.
          findingIds: ["finding-ssh-brute-force", "finding-vanished"],
        },
      },
    })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const detector = readings.detectors.value[0]
    expect(detector.unhydrated).toEqual(["finding-vanished"])
    const text = surfaceText(readings)
    expect(text).toContain("finding-vanished")
    expect(text).toContain("NOT counted")
  })
})

/* ------------------------------------------------------------- residency -- */

describe("region and partition come from the resolved identity, never a literal", () => {
  test("a GovCloud identity produces a GovCloud surface with no us-east-1 in it", async () => {
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
    })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const detector = readings.detectors.value[0]
    expect(detector.partition).toBe("aws-us-gov")
    expect(detector.region).toBe("us-gov-west-1")
    expect(detector.arn).toBe(
      `arn:aws-us-gov:guardduty:us-gov-west-1:${ACCOUNT}:detector/${DETECTOR}`,
    )

    const text = surfaceText(readings)
    expect(text).toContain("us-gov-west-1")
    // The detector's own line carries no commercial-partition region. The
    // FINDINGS still say eu-west-2 because AWS put that on the finding itself,
    // and AWS's own answer is never overwritten by this engine.
    expect(
      guardDutyLines(readings).find((l) => l.label === `Detector ${DETECTOR}`)?.text,
    ).not.toContain("us-east-1")
  })

  test("with identity unresolved no ARN is assembled at all", async () => {
    const readings = await load({ identity: "denied" })
    if (readings.detectors.state !== "ACTUAL") throw new Error("narrowing")
    const detector = readings.detectors.value[0]
    expect(detector.arn).toBeNull()
    expect(detector.region).toBeNull()
    expect(detector.partition).toBeNull()
    expect(detector.arnProvenance).toContain("identity is unresolved")
    expect(surfaceText(readings)).toContain("region unknown — identity is unresolved")
  })
})

/* ------------------------------------------------------- as-of and cadence -- */

describe("every reading carries when it was read and how often it refreshes", () => {
  test("the cadence is the capability's own, in the rendered surface", async () => {
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    // GUARDDUTY_DETECTOR_TTL_MS is an hour; GUARDDUTY_FINDINGS_TTL_MS is two
    // minutes. Both are read from capabilities.ts rather than retyped here.
    expect(readings.refreshMs.detectors).toBe(3_600_000)
    expect(readings.refreshMs.findingIds).toBe(120_000)
    expect(readings.refreshMs.findings).toBe(120_000)

    const text = surfaceText(readings)
    expect(text).toContain("detectors refreshed every 3600s, findings every 120s")
    expect(text).toContain("2026-08-13T09:15:00.000Z")
  })
})
