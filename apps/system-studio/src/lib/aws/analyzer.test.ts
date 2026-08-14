import { SHARED } from "@tenure/provisioning"

import {
  EXPOSED_ACTION_NOT_READABLE,
  EXTERNAL_PRINCIPAL_NOT_READABLE,
  MAX_ANALYZER_PAGES,
  MAX_FINDING_PAGES,
  analyzerLines,
  analyzerReadings,
  arnLocation,
  isoOf,
  roleOf,
  type AnalyzerReadings,
} from "./analyzer"
import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 (ANALYZER) — the Access Analyzer surface tells apart the four
 * outcomes, and tells "no analyzer" apart from "no external access".
 *
 * The assertions are on `analyzerReadings` and `analyzerLines`, the functions a
 * surface renders, rather than on `readAws` or on any parser. A test that drove
 * a private helper would stay green on the day this module stopped calling it,
 * which is the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers four capabilities with the shapes the real SDK returns —
 * `{analyzers, nextToken}` from ListAnalyzers, `{findings, nextToken}` from
 * ListFindingsV2, `{ResourceTagMappingList: [{ResourceARN, Tags}]}` from the
 * Tagging API, `{Account, Arn}` from STS — and it can fail each of them
 * independently with `AccessDeniedException`, `ThrottlingException`, an
 * empty-but-successful list, or a populated one. It PAGES: the findings fixture
 * is sliced by `nextToken` exactly as AWS pages it, so the pagination bound and
 * the truncation signal are exercised against a client that really has more
 * pages rather than against a flag. A stand-in that returned `[]` regardless of
 * what was asked would prove nothing about code whose whole job is telling those
 * outcomes apart, and it is the fake this repository has already been burnt by.
 *
 * Every timestamp in the fake is a `Date`, because that is what the SDK
 * deserialises to. A fake handing back ISO strings would have hidden the fact
 * that the module has to convert them.
 *
 * ## No real identifiers
 *
 * `123456789012` is AWS's own documentation placeholder account. Every ARN,
 * analyzer name and finding id below is constructed for this file. Nothing here
 * names a real account, a real resource or a real external principal.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const OTHER_ACCOUNT = "210987654321"

const ANALYZER_ARN = `arn:aws:access-analyzer:${REGION}:${ACCOUNT}:analyzer/tenure-prod-external-access`
const UNUSED_ANALYZER_ARN = `arn:aws:access-analyzer:${REGION}:${ACCOUNT}:analyzer/tenure-prod-unused-access`
const SECOND_ANALYZER_ARN = `arn:aws:access-analyzer:${REGION}:${ACCOUNT}:analyzer/tenure-prod-org-access`

/** Terraform-provisioned resource types, as ARNs Access Analyzer reports them. */
const BUCKET_ARN = "arn:aws:s3:::tenure-prod-uploads"
const KMS_ARN = `arn:aws:kms:${REGION}:${ACCOUNT}:key/11111111-2222-3333-4444-555555555555`
const ROLE_ARN = `arn:aws:iam::${ACCOUNT}:role/tenure-prod-task`
const SECRET_ARN = `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:tenure-prod-db-AbCdEf`

const AT = () => new Date("2026-08-13T09:15:00.000Z")

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface AnalyzerFixture {
  arn: string
  name: string
  type: string
  status: string
  statusReason?: { code: string }
  createdAt?: Date
  lastResourceAnalyzed?: string
  lastResourceAnalyzedAt?: Date
}

interface FindingFixture {
  id: string
  resource?: string
  resourceType: string
  resourceOwnerAccount?: string
  status: string
  findingType?: string
  error?: string
  createdAt?: Date
  analyzedAt?: Date
  updatedAt?: Date
}

interface FakeOptions {
  /** How `access-analyzer:ListAnalyzers` behaves. The four cases, separated. */
  listAnalyzers?: Outcome
  analyzers?: AnalyzerFixture[]
  /** Findings per analyzer ARN. An absent entry answers with an empty page. */
  findings?: Record<string, FindingFixture[]>
  /** Per-analyzer failure, so one denied detail can be shown not to collapse the row. */
  findingsOutcome?: Record<string, Outcome>
  /** How many findings a page carries, so pagination is real rather than simulated. */
  findingsPageSize?: number
  /** How many analyzers a page carries. */
  analyzersPageSize?: number
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

/** The healthy estate: one active external-access analyzer, nothing shared. */
function oneActiveAnalyzer(): AnalyzerFixture[] {
  return [
    {
      arn: ANALYZER_ARN,
      name: "tenure-prod-external-access",
      type: "ACCOUNT",
      status: "ACTIVE",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      lastResourceAnalyzed: BUCKET_ARN,
      lastResourceAnalyzedAt: new Date("2026-08-13T08:00:00.000Z"),
    },
  ]
}

/**
 * A stand-in that behaves like the SDK: same response shapes, same field casing
 * (Access Analyzer is lower-camel, unlike SQS), same error names, real paging,
 * and independently failable per capability.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.listAnalyzers ?? "populated"
  const analyzers = options.analyzers ?? oneActiveAnalyzer()
  const findings = options.findings ?? {}
  const findingsOutcome = options.findingsOutcome ?? {}
  const findingsPageSize = options.findingsPageSize ?? 100
  const analyzersPageSize = options.analyzersPageSize ?? 100
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []

  /** `page:<n>` tokens, so the fake pages the way the API does. */
  const offsetOf = (token: unknown): number => {
    const raw = typeof token === "string" ? token : ""
    const match = /^page:(\d+)$/.exec(raw)
    return match ? Number(match[1]) : 0
  }

  return {
    async call(capability, input) {
      calls.push(String(capability))
      const args = (input ?? {}) as Record<string, unknown>

      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "tag:GetResources": {
          const outcome = options.tagsOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { ResourceTagMappingList: [] }
          return {
            ResourceTagMappingList: Object.entries(options.tags ?? {}).map(([arn, Tags]) => ({
              ResourceARN: arn,
              Tags,
            })),
          }
        }

        case "access-analyzer:ListAnalyzers": {
          if (listOutcome === "denied") throwing("AccessDeniedException")
          if (listOutcome === "throttled") throwing("ThrottlingException")
          // The real API returns an EMPTY ARRAY for an account with no analyzer.
          if (listOutcome === "empty") return { analyzers: [] }
          const from = offsetOf(args.nextToken)
          const page = analyzers.slice(from, from + analyzersPageSize)
          const next = from + analyzersPageSize
          return {
            analyzers: page,
            ...(next < analyzers.length ? { nextToken: `page:${next}` } : {}),
          }
        }

        case "access-analyzer:ListFindingsV2": {
          const arn = String(args.analyzerArn ?? "")
          const outcome = findingsOutcome[arn]
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          const all = findings[arn] ?? []
          const from = offsetOf(args.nextToken)
          const page = all.slice(from, from + findingsPageSize)
          const next = from + findingsPageSize
          return {
            findings: page,
            ...(next < all.length ? { nextToken: `page:${next}` } : {}),
          }
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

async function load(options: FakeOptions = {}): Promise<AnalyzerReadings> {
  return analyzerReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: AnalyzerReadings): string {
  return analyzerLines(readings)
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

describe("the analyzer listing says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names the analyzer", async () => {
    const readings = await load()
    expect(readings.analyzers.state).toBe("ACTUAL")
    if (readings.analyzers.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.analyzers.value.analyzers).toHaveLength(1)
    expect(readings.analyzers.value.truncated).toBe(false)

    const analyzer = readings.analyzers.value.analyzers[0]
    expect(analyzer.role).toEqual({ kind: "answers-external-access" })
    // Region and partition come from the ARN AWS returned, not from a literal.
    expect(analyzer.region).toBe(REGION)
    expect(analyzer.partition).toBe("aws")
    expect(analyzer.accountId).toBe(ACCOUNT)
    // Timestamps arrive as Dates from the SDK and leave as ISO strings.
    expect(analyzer.createdAt).toBe("2026-07-01T00:00:00.000Z")
    expect(analyzer.lastResourceAnalyzedAt).toBe("2026-08-13T08:00:00.000Z")

    expect(surfaceText(readings)).toContain("tenure-prod-external-access")
  })

  test("an empty-but-successful list is EMPTY — and renders as UNKNOWN with the remedy, never as 'no external access'", async () => {
    const readings = await load({ listAnalyzers: "empty" })
    expect(readings.analyzers.state).toBe("EMPTY")
    expect(readings.externalAccess.kind).toBe("no-analyzer")

    const text = surfaceText(readings)
    // The whole point of this module. Both halves are asserted: what it must
    // say, and what it must never say.
    expect(text).toContain("unknown — NO ANALYZER EXISTS")
    expect(text).toContain("access-analyzer:CreateAnalyzer")
    expect(text).not.toContain("no external access found")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listAnalyzers: "denied" })
    expect(readings.analyzers.state).toBe("DENIED")
    if (readings.analyzers.state !== "DENIED") throw new Error("narrowing")

    expect(readings.analyzers.action).toBe("access-analyzer:ListAnalyzers")
    expect(readings.analyzers.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.analyzers.accountId).toBe(ACCOUNT)
    expect(readings.analyzers.region).toBe(REGION)
    expect(readings.analyzers.partition).toBe("aws")
    expect(JSON.parse(readings.analyzers.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["access-analyzer:ListAnalyzers"],
      Resource: "*",
    })

    // There is no `value` on this arm at all, so a caller cannot reach an empty
    // list; the render says "unknown".
    expect("value" in readings.analyzers).toBe(false)
    expect(readings.externalAccess.kind).toBe("unknown")

    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).toContain("Minimum statement")
    expect(text).not.toContain("no external access found")
    expect(text).not.toContain("NO ANALYZER EXISTS")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ listAnalyzers: "throttled" })
    expect(readings.analyzers.state).toBe("THROTTLED")
    if (readings.analyzers.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.analyzers.retryAfterMs).toBe(800)

    expect(readings.externalAccess.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
    expect(text).not.toContain("no external access found")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ listAnalyzers: outcome })))
    }
    expect(new Set(texts).size).toBe(4)
  })
})

/* ------------------------------- the findings read, and its four outcomes -- */

describe("the findings read is its own reading with its own four outcomes", () => {
  const exposureFindings: FindingFixture[] = [
    {
      id: "finding-bucket-0001",
      resource: BUCKET_ARN,
      resourceType: "AWS::S3::Bucket",
      resourceOwnerAccount: ACCOUNT,
      status: "ACTIVE",
      findingType: "ExternalAccess",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      analyzedAt: new Date("2026-08-13T08:00:00.000Z"),
      updatedAt: new Date("2026-08-13T08:00:00.000Z"),
    },
  ]

  test("populated findings become EXTERNAL ACCESS naming the resource and its type", async () => {
    const readings = await load({ findings: { [ANALYZER_ARN]: exposureFindings } })
    expect(readings.externalAccess.kind).toBe("external-access")
    if (readings.externalAccess.kind !== "external-access") throw new Error("narrowing")
    expect(readings.externalAccess.totalActive).toBe(1)
    expect(readings.externalAccess.exposures[0].resource).toBe(BUCKET_ARN)
    expect(readings.externalAccess.exposures[0].resourceType).toBe("AWS::S3::Bucket")

    const text = surfaceText(readings)
    expect(text).toContain("EXTERNAL ACCESS")
    expect(text).toContain(BUCKET_ARN)
    expect(text).not.toContain("no external access found")
  })

  test("empty findings from an ACTIVE external-access analyzer is the ONLY route to 'no external access found'", async () => {
    const readings = await load()
    expect(readings.externalAccess.kind).toBe("none-found")
    if (readings.externalAccess.kind !== "none-found") throw new Error("narrowing")
    expect(readings.externalAccess.analyzersRead).toEqual(["tenure-prod-external-access"])
    expect(readings.externalAccess.unreadable).toEqual([])
    expect(surfaceText(readings)).toContain("no external access found")
  })

  test("a denied findings read names access-analyzer:ListFindingsV2 — not ListAnalyzers", async () => {
    const readings = await load({ findingsOutcome: { [ANALYZER_ARN]: "denied" } })
    expect(readings.analyzers.state).toBe("ACTUAL")
    if (readings.analyzers.state !== "ACTUAL") throw new Error("narrowing")

    const findings = readings.analyzers.value.analyzers[0].findings
    expect(findings.state).toBe("DENIED")
    if (findings.state !== "DENIED") throw new Error("narrowing")
    // The action an operator pastes must be the one that was actually refused.
    // A statement naming ListAnalyzers would be granted, redeployed, and refused
    // identically.
    expect(findings.action).toBe("access-analyzer:ListFindingsV2")
    expect(JSON.parse(findings.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["access-analyzer:ListFindingsV2"],
      Resource: "arn:*:access-analyzer:*:*:analyzer/*",
    })

    expect(readings.externalAccess.kind).toBe("findings-unreadable")
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toContain("no external access found")
  })

  test("a throttled findings read is THROTTLED, not clear and not denied", async () => {
    const readings = await load({ findingsOutcome: { [ANALYZER_ARN]: "throttled" } })
    if (readings.analyzers.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.analyzers.value.analyzers[0].findings.state).toBe("THROTTLED")
    expect(readings.externalAccess.kind).toBe("findings-unreadable")
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).not.toContain("no external access found")
  })
})

/* ---------------------------------------- degrading independently, proven -- */

describe("one denied detail does not collapse the row and does not read as clear", () => {
  const twoAnalyzers: AnalyzerFixture[] = [
    ...oneActiveAnalyzer(),
    {
      arn: SECOND_ANALYZER_ARN,
      name: "tenure-prod-org-access",
      type: "ORGANIZATION",
      status: "ACTIVE",
      createdAt: new Date("2026-07-02T00:00:00.000Z"),
    },
  ]

  test("one analyzer refused, one answered: the verdict is qualified, not UNKNOWN and not clear", async () => {
    const readings = await load({
      analyzers: twoAnalyzers,
      findingsOutcome: { [SECOND_ANALYZER_ARN]: "denied" },
    })

    if (readings.analyzers.state !== "ACTUAL") throw new Error("narrowing")
    const [first, second] = readings.analyzers.value.analyzers
    // Sorted by ARN: …analyzer/tenure-prod-external-access sorts before …/tenure-prod-org-access.
    expect(first.name).toBe("tenure-prod-external-access")
    expect(first.findings.state).toBe("EMPTY")
    expect(second.findings.state).toBe("DENIED")

    expect(readings.externalAccess.kind).toBe("none-found")
    if (readings.externalAccess.kind !== "none-found") throw new Error("narrowing")
    expect(readings.externalAccess.analyzersRead).toEqual(["tenure-prod-external-access"])
    expect(readings.externalAccess.unreadable).toEqual(["tenure-prod-org-access"])

    const text = surfaceText(readings)
    // "no external access found" survives — the analyzer that ANSWERED found
    // none — but it is never left unqualified.
    expect(text).toContain("no external access found")
    expect(text).toContain("1 analyzer(s) could not be read (tenure-prod-org-access)")
    expect(text).toContain("this is not a complete answer")
  })

  test("both refused collapses to UNKNOWN, because nothing answered", async () => {
    const readings = await load({
      analyzers: twoAnalyzers,
      findingsOutcome: { [ANALYZER_ARN]: "denied", [SECOND_ANALYZER_ARN]: "denied" },
    })
    expect(readings.externalAccess.kind).toBe("findings-unreadable")
    expect(surfaceText(readings)).not.toContain("no external access found")
  })
})

/* --------------------------------- an analyzer that answers another question -- */

describe("an analyzer that does not answer the external-access question is not coverage", () => {
  test("an unused-access analyzer alone renders as UNKNOWN with the remedy", async () => {
    const readings = await load({
      analyzers: [
        {
          arn: UNUSED_ANALYZER_ARN,
          name: "tenure-prod-unused-access",
          type: "ACCOUNT_UNUSED_ACCESS",
          status: "ACTIVE",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    })

    expect(readings.externalAccess.kind).toBe("not-answering")
    if (readings.externalAccess.kind !== "not-answering") throw new Error("narrowing")
    expect(readings.externalAccess.analyzersSeen).toBe(1)

    const text = surfaceText(readings)
    expect(text).toContain("NO ANALYZER ANSWERS THIS QUESTION")
    expect(text).toContain("access-analyzer:CreateAnalyzer")
    expect(text).not.toContain("no external access found")
  })

  test("its findings are never even asked for — the call is not made", async () => {
    const calls: string[] = []
    await analyzerReadings(
      fakeAws({
        calls,
        analyzers: [
          {
            arn: UNUSED_ANALYZER_ARN,
            name: "tenure-prod-unused-access",
            type: "ACCOUNT_UNUSED_ACCESS",
            status: "ACTIVE",
          },
        ],
      }),
      { now: AT },
    )
    expect(calls).toContain("access-analyzer:ListAnalyzers")
    expect(calls).not.toContain("access-analyzer:ListFindingsV2")
  })

  test("a CREATING external-access analyzer is not-active, and its silence claims nothing", async () => {
    const readings = await load({
      analyzers: [
        {
          arn: ANALYZER_ARN,
          name: "tenure-prod-external-access",
          type: "ACCOUNT",
          status: "CREATING",
          statusReason: { code: "AWS_SERVICE_ACCESS_DISABLED" },
        },
      ],
    })
    expect(readings.externalAccess.kind).toBe("not-answering")
    const text = surfaceText(readings)
    expect(text).toContain("AWS_SERVICE_ACCESS_DISABLED")
    expect(text).not.toContain("no external access found")
  })

  test("roleOf separates the three answers", () => {
    expect(roleOf("ACCOUNT", "ACTIVE")).toEqual({ kind: "answers-external-access" })
    expect(roleOf("ORGANIZATION", "ACTIVE")).toEqual({ kind: "answers-external-access" })
    expect(roleOf("ACCOUNT_UNUSED_ACCESS", "ACTIVE").kind).toBe("different-question")
    expect(roleOf("ACCOUNT_INTERNAL_ACCESS", "ACTIVE").kind).toBe("different-question")
    expect(roleOf("ACCOUNT", "FAILED").kind).toBe("not-active")
    // A type AWS did not return must not be assumed to answer the question.
    expect(roleOf("UNKNOWN", "ACTIVE").kind).toBe("different-question")
  })
})

/* ------------------------------------------ archived findings are history -- */

describe("only a live finding is an exposure", () => {
  test("ARCHIVED and RESOLVED findings do not raise the alarm, and ACTIVE does", async () => {
    const history: FindingFixture[] = [
      {
        id: "finding-archived-0001",
        resource: KMS_ARN,
        resourceType: "AWS::KMS::Key",
        resourceOwnerAccount: ACCOUNT,
        status: "ARCHIVED",
        findingType: "ExternalAccess",
      },
      {
        id: "finding-resolved-0002",
        resource: ROLE_ARN,
        resourceType: "AWS::IAM::Role",
        resourceOwnerAccount: ACCOUNT,
        status: "RESOLVED",
        findingType: "ExternalAccess",
      },
    ]
    const quiet = await load({ findings: { [ANALYZER_ARN]: history } })
    expect(quiet.externalAccess.kind).toBe("none-found")

    __resetIdentity()
    const loud = await load({
      findings: {
        [ANALYZER_ARN]: [
          ...history,
          {
            id: "finding-active-0003",
            resource: SECRET_ARN,
            resourceType: "AWS::SecretsManager::Secret",
            resourceOwnerAccount: ACCOUNT,
            status: "ACTIVE",
            findingType: "ExternalAccess",
          },
        ],
      },
    })
    expect(loud.externalAccess.kind).toBe("external-access")
    if (loud.externalAccess.kind !== "external-access") throw new Error("narrowing")
    expect(loud.externalAccess.totalActive).toBe(1)
    expect(loud.externalAccess.exposures[0].resource).toBe(SECRET_ARN)
  })

  test("a status AWS did not return is treated as live, never assumed resolved", async () => {
    const readings = await load({
      findings: {
        [ANALYZER_ARN]: [
          {
            id: "finding-nostatus-0001",
            resource: BUCKET_ARN,
            resourceType: "AWS::S3::Bucket",
            // status and findingType deliberately omitted, as an SDK that added a
            // new enum member and a response this engine partly understands both
            // look like.
            status: "",
          },
        ],
      },
    })
    expect(readings.externalAccess.kind).toBe("external-access")
    expect(surfaceText(readings)).toContain("status UNKNOWN")
  })
})

/* ------------------------------------------------------- pagination bounds -- */

describe("pagination completes, is bounded, and says so when the bound is hit", () => {
  function findingsPage(count: number, from = 0): FindingFixture[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `finding-${String(from + i).padStart(6, "0")}`,
      resource: `${BUCKET_ARN}-${from + i}`,
      resourceType: "AWS::S3::Bucket",
      resourceOwnerAccount: OTHER_ACCOUNT,
      status: "ACTIVE",
      findingType: "ExternalAccess",
    }))
  }

  test("findings across several pages are all walked — not just the first", async () => {
    const readings = await load({
      findings: { [ANALYZER_ARN]: findingsPage(25) },
      findingsPageSize: 10,
    })
    if (readings.analyzers.state !== "ACTUAL") throw new Error("narrowing")
    const findings = readings.analyzers.value.analyzers[0].findings
    if (findings.state !== "ACTUAL") throw new Error("narrowing")
    expect(findings.value.exposures).toHaveLength(25)
    expect(findings.value.pagesRead).toBe(3)
    expect(findings.value.truncated).toBe(false)
    expect(findings.value.truncationNote).toBeNull()
  })

  test("hitting the findings cap sets truncated and prints an explicit 'there were more'", async () => {
    // One finding per page, so MAX_FINDING_PAGES + a remainder forces the cap.
    const readings = await load({
      findings: { [ANALYZER_ARN]: findingsPage(MAX_FINDING_PAGES + 5) },
      findingsPageSize: 1,
    })
    if (readings.analyzers.state !== "ACTUAL") throw new Error("narrowing")
    const findings = readings.analyzers.value.analyzers[0].findings
    if (findings.state !== "ACTUAL") throw new Error("narrowing")

    expect(findings.value.pagesRead).toBe(MAX_FINDING_PAGES)
    expect(findings.value.truncated).toBe(true)
    expect(findings.value.truncationNote).toContain(`after ${MAX_FINDING_PAGES} pages`)
    // What WAS read is still shown — a partial answer is not thrown away.
    expect(findings.value.exposures).toHaveLength(MAX_FINDING_PAGES)

    expect(readings.externalAccess.kind).toBe("external-access")
    if (readings.externalAccess.kind !== "external-access") throw new Error("narrowing")
    expect(readings.externalAccess.truncated).toBe(true)
    expect(surfaceText(readings)).toContain("this count is a floor")
  })

  test("hitting the analyzer cap sets truncated and prints a coverage floor", async () => {
    const many: AnalyzerFixture[] = Array.from({ length: MAX_ANALYZER_PAGES + 3 }, (_, i) => ({
      arn: `arn:aws:access-analyzer:${REGION}:${ACCOUNT}:analyzer/a-${String(i).padStart(3, "0")}`,
      name: `a-${String(i).padStart(3, "0")}`,
      type: "ACCOUNT",
      status: "ACTIVE",
    }))
    const readings = await load({ analyzers: many, analyzersPageSize: 1 })
    if (readings.analyzers.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.analyzers.value.pagesRead).toBe(MAX_ANALYZER_PAGES)
    expect(readings.analyzers.value.truncated).toBe(true)
    expect(readings.analyzers.value.analyzers).toHaveLength(MAX_ANALYZER_PAGES)

    const text = surfaceText(readings)
    expect(text).toContain("Analyzers truncated")
    expect(text).toContain("coverage below is a floor, not a total")
  })
})

/* ------------------------------------------------------------ attribution -- */

describe("attribution comes from the tagging API, and says so when it could not", () => {
  const exposure: FindingFixture[] = [
    {
      id: "finding-bucket-0001",
      resource: BUCKET_ARN,
      resourceType: "AWS::S3::Bucket",
      resourceOwnerAccount: ACCOUNT,
      status: "ACTIVE",
      findingType: "ExternalAccess",
    },
    {
      id: "finding-kms-0002",
      resource: KMS_ARN,
      resourceType: "AWS::KMS::Key",
      resourceOwnerAccount: ACCOUNT,
      status: "ACTIVE",
      findingType: "ExternalAccess",
    },
    {
      id: "finding-role-0003",
      resource: ROLE_ARN,
      resourceType: "AWS::IAM::Role",
      resourceOwnerAccount: ACCOUNT,
      status: "ACTIVE",
      findingType: "ExternalAccess",
    },
  ]

  test("a tenant tag attributes, a shared tag is shared, and an untagged resource is unattributed", async () => {
    const readings = await load({
      findings: { [ANALYZER_ARN]: exposure },
      tags: {
        [BUCKET_ARN]: [{ Key: "tenure:tenant", Value: "acme-university" }],
        [KMS_ARN]: [{ Key: "tenure:tenant", Value: SHARED }],
        // ROLE_ARN is deliberately absent from the index.
      },
    })
    if (readings.externalAccess.kind !== "external-access") throw new Error("narrowing")
    const by = new Map(readings.externalAccess.exposures.map((e) => [e.resource, e.attribution]))
    expect(by.get(BUCKET_ARN)).toEqual({ kind: "tenant", tenantSlug: "acme-university" })
    expect(by.get(KMS_ARN)).toEqual({ kind: "shared" })
    expect(by.get(ROLE_ARN)).toEqual({ kind: "unattributed" })
  })

  test("a denied tagging read makes attribution UNKNOWN, never 'missing tenure:tenant'", async () => {
    const readings = await load({
      findings: { [ANALYZER_ARN]: exposure },
      tagsOutcome: "denied",
    })
    if (readings.externalAccess.kind !== "external-access") throw new Error("narrowing")
    for (const e of readings.externalAccess.exposures) {
      expect(e.attribution.kind).toBe("unknown")
    }
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    expect(text).not.toContain("unattributable — missing tenure:tenant")
  })
})

/* -------------------------------------- what this engine honestly cannot say -- */

describe("the external principal and the exposed action are values, not omissions", () => {
  test("every exposure carries NOT_READABLE naming access-analyzer:GetFindingV2", async () => {
    const readings = await load({
      findings: {
        [ANALYZER_ARN]: [
          {
            id: "finding-bucket-0001",
            resource: BUCKET_ARN,
            resourceType: "AWS::S3::Bucket",
            resourceOwnerAccount: ACCOUNT,
            status: "ACTIVE",
            findingType: "ExternalAccess",
          },
        ],
      },
    })
    if (readings.externalAccess.kind !== "external-access") throw new Error("narrowing")
    const e = readings.externalAccess.exposures[0]
    expect(e.externalPrincipal).toBe(EXTERNAL_PRINCIPAL_NOT_READABLE)
    expect(e.exposedAction).toBe(EXPOSED_ACTION_NOT_READABLE)
    expect(e.externalPrincipal.needs).toBe("access-analyzer:GetFindingV2")

    // And it is PRINTED, not merely carried. A field a surface can forget is a
    // blank cell an operator reads as "nobody".
    const text = surfaceText(readings)
    expect(text).toContain("external principal: the external principal is not a field")
    expect(text).toContain("exposed action: the exposed action is not a field")
    expect(text).toContain("access-analyzer:GetFindingV2")
  })
})

/* --------------------------------------------- region, partition, identity -- */

describe("region and partition resolve from the identity and from AWS's own ARNs", () => {
  test("a GovCloud identity produces GovCloud analyzer ARNs, with no 'aws' anywhere", async () => {
    const govArn = "arn:aws-us-gov:access-analyzer:us-gov-west-1:123456789012:analyzer/gov-access"
    const readings = await analyzerReadings(
      fakeAws({
        identity: {
          arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
          account: ACCOUNT,
          region: "us-gov-west-1",
        },
        analyzers: [
          { arn: govArn, name: "gov-access", type: "ACCOUNT", status: "ACTIVE" },
        ],
      }),
      { now: AT },
    )
    if (readings.analyzers.state !== "ACTUAL") throw new Error("narrowing")
    const analyzer = readings.analyzers.value.analyzers[0]
    expect(analyzer.partition).toBe("aws-us-gov")
    expect(analyzer.region).toBe("us-gov-west-1")
    expect(surfaceText(readings)).not.toContain("us-east-1")
  })

  test("a global resource keeps its empty region rather than borrowing the caller's", async () => {
    const readings = await load({
      findings: {
        [ANALYZER_ARN]: [
          {
            id: "finding-role-0001",
            resource: ROLE_ARN,
            resourceType: "AWS::IAM::Role",
            resourceOwnerAccount: ACCOUNT,
            status: "ACTIVE",
            findingType: "ExternalAccess",
          },
        ],
      },
    })
    if (readings.externalAccess.kind !== "external-access") throw new Error("narrowing")
    const e = readings.externalAccess.exposures[0]
    // `arn:aws:iam::123456789012:role/…` has an EMPTY region segment. Claiming
    // the role is in eu-west-2 would be a false residency statement.
    expect(e.region).toBeNull()
    expect(e.partition).toBe("aws")
    expect(surfaceText(readings)).toContain("global, partition aws")
  })

  test("a denied identity still renders a denial that names the unresolved principal", async () => {
    const readings = await load({ identity: "denied", listAnalyzers: "denied" })
    expect(readings.identity.state).toBe("DENIED")
    if (readings.analyzers.state !== "DENIED") throw new Error("narrowing")
    expect(readings.analyzers.principal).toContain("unknown principal")
    expect(readings.analyzers.accountId).toBeNull()
  })

  test("the refresh cadence is the registry's, not a number retyped here", async () => {
    const readings = await load()
    // ACCESS_ANALYZER_TTL_MS is 900_000 in capabilities.ts. Asserted as the
    // rendered cadence so a divergence between the two is visible.
    expect(readings.refreshMs.analyzers).toBe(900_000)
    expect(readings.refreshMs.findings).toBe(900_000)
    expect(surfaceText(readings)).toContain("refreshed every 900s")
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
  })
})

/* ------------------------------------------------------------- the parsers -- */

describe("the parsers", () => {
  test("isoOf converts Dates, ISO strings and epoch seconds, and refuses anything else", () => {
    expect(isoOf(new Date("2026-08-13T09:15:00.000Z"))).toBe("2026-08-13T09:15:00.000Z")
    expect(isoOf("2026-08-13T09:15:00.000Z")).toBe("2026-08-13T09:15:00.000Z")
    expect(isoOf(1786000000)).toBe(new Date(1786000000 * 1000).toISOString())
    expect(isoOf(new Date("not a date"))).toBeNull()
    expect(isoOf(undefined)).toBeNull()
    expect(isoOf({})).toBeNull()
  })

  test("arnLocation reads what the ARN says and refuses to guess when it is not one", () => {
    expect(arnLocation(ANALYZER_ARN)).toEqual({
      parsed: true,
      partition: "aws",
      region: REGION,
      accountId: ACCOUNT,
    })
    expect(arnLocation(ROLE_ARN)).toEqual({
      parsed: true,
      partition: "aws",
      region: null,
      accountId: ACCOUNT,
    })
    expect(arnLocation("not-an-arn")).toEqual({
      parsed: false,
      partition: null,
      region: null,
      accountId: null,
    })
    expect(arnLocation(null).parsed).toBe(false)
  })
})
