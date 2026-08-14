import { SHARED } from "@tenure/provisioning"

import { __resetIdentity } from "./identity"
import {
  MAX_LIST_PAGES,
  MAX_POSTURE_BUCKETS,
  bucketArn,
  bucketLines,
  bucketPosture,
  publicAccessGaps,
  type S3Readings,
} from "./buckets"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 (S3) — the bucket surface tells four different truths apart,
 * and degrades one fact at a time.
 *
 * The assertions are on `bucketPosture` and `bucketLines`, the functions a
 * surface renders, rather than on `readAws` or on any parser. A test that drove
 * a private helper would stay green on the day this module stopped calling it,
 * which is precisely the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers nine capabilities with the shapes the real SDK returns —
 * `{Buckets:[{Name, CreationDate, BucketRegion}], ContinuationToken}` from
 * ListBuckets, `{PublicAccessBlockConfiguration:{…four booleans…}}`,
 * `{PolicyStatus:{IsPublic}}`, `{ServerSideEncryptionConfiguration:{Rules}}`,
 * `{Status, MFADelete}`, `{Rules}`, `{TagSet}`, `{CORSRules}`, plus
 * `{ResourceTagMappingList}` from the Tagging API and `{Account, Arn}` from STS
 * — and it can fail EACH of them independently, per bucket, with
 * `AccessDenied`, `ThrottlingException`, one of S3's "there is no such
 * configuration" codes, an empty-but-successful answer, or a populated one.
 *
 * A stand-in that returned `[]` regardless of what was asked would prove nothing
 * about code whose entire job is telling those apart, and it is the fake this
 * repository has already been burnt by. The "four visibly different surfaces"
 * case below is the assertion that would catch one.
 *
 * ## The account id is obviously constructed
 *
 * `123456789012` is AWS's own documentation placeholder. Nothing here is a real
 * account, a real bucket name or a real ARN, and no verification date, approval
 * or sign-off appears anywhere in this file.
 */

const ACCOUNT = "123456789012"
const DOCUMENTS = "tenure-prod-documents-123456789012"
const EXPORTS = "tenure-prod-exports-123456789012"

/* ------------------------------------------------------------- the estate -- */

type Fail = { fail: string }

function isFail(value: unknown): value is Fail {
  return typeof value === "object" && value !== null && typeof (value as Fail).fail === "string"
}

interface BucketFixture {
  name: string
  /** What ListBuckets states as `BucketRegion`. Omitted means S3 did not state it. */
  region?: string
  createdAt?: string
  pab?:
    | {
        BlockPublicAcls?: boolean
        IgnorePublicAcls?: boolean
        BlockPublicPolicy?: boolean
        RestrictPublicBuckets?: boolean
      }
    | "no-config"
    | Fail
  policyStatus?: boolean | Fail
  encryption?: { algorithm: string; kmsKeyId?: string; bucketKey?: boolean } | Fail
  versioning?: { Status?: string; MFADelete?: string } | Fail
  lifecycle?: LifecycleFixtureRule[] | Fail
  tagging?: Array<{ Key: string; Value: string }> | Fail
  cors?: Array<{ AllowedOrigins: string[]; AllowedMethods: string[]; ID?: string }> | Fail
}

interface LifecycleFixtureRule {
  ID: string
  Status: string
  Filter?: { Prefix?: string }
  Expiration?: { Days?: number }
  Transitions?: Array<{ Days: number; StorageClass: string }>
}

/**
 * The two buckets `infrastructure/terraform/s3.tf` provisions, with the posture
 * that file declares: documents is KMS-encrypted, versioned and CORS-open;
 * exports has neither encryption nor versioning declared, which is the drift the
 * console exists to show.
 */
function terraformEstate(): BucketFixture[] {
  return [
    {
      name: DOCUMENTS,
      createdAt: "2026-01-04T10:00:00.000Z",
      pab: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
      policyStatus: false,
      encryption: { algorithm: "aws:kms", kmsKeyId: "alias/tenure-documents", bucketKey: true },
      versioning: { Status: "Enabled" },
      lifecycle: [
        {
          ID: "expire-temp-uploads",
          Status: "Enabled",
          Filter: { Prefix: "tmp/" },
          Expiration: { Days: 1 },
        },
      ],
      tagging: [
        { Key: "tenure:tenant", Value: SHARED },
        { Key: "tenure:environment", Value: "production" },
      ],
      cors: [{ ID: "presigned-uploads", AllowedOrigins: ["*"], AllowedMethods: ["PUT", "POST", "GET"] }],
    },
    {
      name: EXPORTS,
      createdAt: "2026-01-04T10:00:05.000Z",
      pab: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
      policyStatus: { fail: "NoSuchBucketPolicy" },
      encryption: { algorithm: "AES256" },
      versioning: {},
      lifecycle: [{ ID: "expire-exports", Status: "Enabled", Expiration: { Days: 30 } }],
      tagging: { fail: "NoSuchTagSet" },
      cors: { fail: "NoSuchCORSConfiguration" },
    },
  ]
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  /** How `s3:ListBuckets` behaves. The four cases this suite exists to separate. */
  listBuckets?: Outcome
  buckets?: BucketFixture[]
  /** Hand out a ContinuationToken forever, to drive the page cap. */
  endlessPages?: boolean
  /** Split the fixtures across pages, so pagination-to-completion is exercised. */
  pageSize?: number
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

/** A stand-in that behaves like the SDK: same shapes, same error names, per bucket. */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.listBuckets ?? "populated"
  const buckets = options.buckets ?? terraformEstate()
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: "eu-west-2",
  }
  const calls = options.calls ?? []
  const pageSize = options.pageSize ?? buckets.length

  const find = (input: Record<string, unknown> | undefined): BucketFixture => {
    const name = String((input as { Bucket?: unknown } | undefined)?.Bucket ?? "")
    const fixture = buckets.find((b) => b.name === name)
    if (!fixture) throwing("NoSuchBucket")
    return fixture
  }

  return {
    async call(capability, input) {
      calls.push(`${String(capability)}:${String((input as { Bucket?: unknown })?.Bucket ?? "")}`)
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

        case "s3:ListBuckets": {
          if (listOutcome === "denied") throwing("AccessDenied")
          if (listOutcome === "throttled") throwing("ThrottlingException")
          // The real API omits `Buckets` entirely when there are none. It does
          // not return an empty array, and a fake that did would be testing a
          // response AWS never sends.
          if (listOutcome === "empty") return {}
          if (options.endlessPages) {
            return {
              Buckets: buckets.map((bucket) => toListEntry(bucket)),
              ContinuationToken: "more-please",
            }
          }
          const token = (input as { ContinuationToken?: unknown } | undefined)?.ContinuationToken
          const offset = typeof token === "string" ? Number(token) : 0
          const slice = buckets.slice(offset, offset + pageSize)
          const next = offset + pageSize
          return {
            // BucketRegion is stated only on a page whose request carried a
            // parameter — which is exactly how S3 behaves, and why the first
            // page's buckets have no region.
            Buckets: slice.map((b) => toListEntry(b, typeof token === "string")),
            ...(next < buckets.length ? { ContinuationToken: String(next) } : {}),
          }
        }

        case "s3:GetBucketPublicAccessBlock": {
          const fixture = find(input)
          if (isFail(fixture.pab)) throwing(fixture.pab.fail)
          if (fixture.pab === "no-config") throwing("NoSuchPublicAccessBlockConfiguration")
          if (fixture.pab === undefined) return {}
          return { PublicAccessBlockConfiguration: fixture.pab }
        }

        case "s3:GetBucketPolicyStatus": {
          const fixture = find(input)
          if (isFail(fixture.policyStatus)) throwing(fixture.policyStatus.fail)
          if (fixture.policyStatus === undefined) return {}
          return { PolicyStatus: { IsPublic: fixture.policyStatus } }
        }

        case "s3:GetBucketEncryption": {
          const fixture = find(input)
          if (isFail(fixture.encryption)) throwing(fixture.encryption.fail)
          if (fixture.encryption === undefined) return {}
          return {
            ServerSideEncryptionConfiguration: {
              Rules: [
                {
                  ApplyServerSideEncryptionByDefault: {
                    SSEAlgorithm: fixture.encryption.algorithm,
                    ...(fixture.encryption.kmsKeyId
                      ? { KMSMasterKeyID: fixture.encryption.kmsKeyId }
                      : {}),
                  },
                  ...(fixture.encryption.bucketKey === undefined
                    ? {}
                    : { BucketKeyEnabled: fixture.encryption.bucketKey }),
                },
              ],
            },
          }
        }

        case "s3:GetBucketVersioning": {
          const fixture = find(input)
          if (isFail(fixture.versioning)) throwing(fixture.versioning.fail)
          // `{}` is what S3 returns for a bucket that has never had versioning:
          // a SUCCESSFUL empty body, not an error and not an absence.
          return fixture.versioning ?? {}
        }

        case "s3:GetBucketLifecycleConfiguration": {
          const fixture = find(input)
          if (isFail(fixture.lifecycle)) throwing(fixture.lifecycle.fail)
          if (fixture.lifecycle === undefined) throwing("NoSuchLifecycleConfiguration")
          return { Rules: fixture.lifecycle }
        }

        case "s3:GetBucketTagging": {
          const fixture = find(input)
          if (isFail(fixture.tagging)) throwing(fixture.tagging.fail)
          if (fixture.tagging === undefined) throwing("NoSuchTagSet")
          return { TagSet: fixture.tagging }
        }

        case "s3:GetBucketCors": {
          const fixture = find(input)
          if (isFail(fixture.cors)) throwing(fixture.cors.fail)
          if (fixture.cors === undefined) throwing("NoSuchCORSConfiguration")
          return { CORSRules: fixture.cors }
        }

        default:
          throw new Error(
            `the stand-in was asked for ${String(capability)}, which this suite does not exercise`,
          )
      }
    },
    async resolvedRegion() {
      return identity === "denied" ? "eu-west-2" : identity.region
    },
  }
}

function toListEntry(bucket: BucketFixture, statesRegion = false) {
  return {
    Name: bucket.name,
    ...(bucket.createdAt ? { CreationDate: new Date(bucket.createdAt) } : {}),
    ...(statesRegion && bucket.region ? { BucketRegion: bucket.region } : {}),
  }
}

const AT = () => new Date("2026-08-13T09:15:00.000Z")

async function load(options: FakeOptions = {}): Promise<S3Readings> {
  return bucketPosture(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: S3Readings): string {
  return bucketLines(readings)
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

describe("the S3 surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every bucket", async () => {
    const readings = await load()
    expect(readings.buckets.state).toBe("ACTUAL")
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.buckets.value).toHaveLength(2)
    const text = surfaceText(readings)
    expect(text).toContain(DOCUMENTS)
    expect(text).toContain(EXPORTS)
    expect(text).toContain("all four public access blocks are set")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ listBuckets: "empty" })
    expect(readings.buckets.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listBuckets: "denied" })
    expect(readings.buckets.state).toBe("DENIED")
    if (readings.buckets.state !== "DENIED") throw new Error("narrowing")

    // The IAM action, which is spelled differently from the API. A denial naming
    // "s3:ListBuckets" would send an operator to grant a permission that does
    // not exist.
    expect(readings.buckets.action).toBe("s3:ListAllMyBuckets")
    expect(readings.buckets.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.buckets.accountId).toBe(ACCOUNT)
    expect(readings.buckets.region).toBe("eu-west-2")
    expect(readings.buckets.partition).toBe("aws")
    expect(JSON.parse(readings.buckets.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["s3:ListAllMyBuckets"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.buckets).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
    // And the exposure verdict must not read as reassurance.
    expect(readings.publicExposure.kind).toBe("unknown")
    expect(text).not.toContain("no public bucket observed")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ listBuckets: "throttled" })
    expect(readings.buckets.state).toBe("THROTTLED")
    if (readings.buckets.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.buckets.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ listBuckets: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that
    // notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------- public access is the headline -- */

describe("a bucket that is open is a finding, and an unread one is never 'closed'", () => {
  test("a block flag switched off in the console surfaces by name", async () => {
    const buckets = terraformEstate()
    buckets[1] = {
      ...buckets[1],
      pab: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: true,
      },
    }
    const readings = await load({ buckets })

    expect(readings.publicExposure.kind).toBe("exposed")
    if (readings.publicExposure.kind !== "exposed") throw new Error("narrowing")
    expect(readings.publicExposure.buckets).toHaveLength(1)
    expect(readings.publicExposure.buckets[0].bucket).toBe(EXPORTS)
    expect(readings.publicExposure.buckets[0].reasons.join(" ")).toContain("BlockPublicPolicy")
    expect(readings.publicExposure.buckets[0].policySaysPublic).toBe(false)

    const text = surfaceText(readings)
    expect(text).toContain("PUBLIC ACCESS FINDING")
    expect(text).toContain("PUBLIC ACCESS BLOCK INCOMPLETE")
    expect(text).not.toContain("no public bucket observed")
  })

  test("no public access block at all is an answer, and the loudest one", async () => {
    const buckets = terraformEstate()
    buckets[0] = { ...buckets[0], pab: "no-config" }
    const readings = await load({ buckets })

    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const documents = readings.buckets.value.find((b) => b.name === DOCUMENTS)
    expect(documents?.publicAccessBlock.state).toBe("ACTUAL")
    if (documents?.publicAccessBlock.state !== "ACTUAL") throw new Error("narrowing")
    expect(documents.publicAccessBlock.value.kind).toBe("absent")
    // All four gaps, because none of the four is in force.
    expect(publicAccessGaps(documents.publicAccessBlock.value)).toEqual([
      "BlockPublicAcls",
      "IgnorePublicAcls",
      "BlockPublicPolicy",
      "RestrictPublicBuckets",
    ])
    expect(readings.publicExposure.kind).toBe("exposed")
    const text = surfaceText(readings)
    expect(text).toContain("NO PUBLIC ACCESS BLOCK")
    // Never a red "we could not check": S3 told us, and what it told us is bad.
    expect(text).not.toContain("error — NoSuchPublicAccessBlockConfiguration")
  })

  test("a policy status of IsPublic is the finding even with all four blocks set", async () => {
    const buckets = terraformEstate()
    buckets[1] = { ...buckets[1], policyStatus: true }
    const readings = await load({ buckets })

    expect(readings.publicExposure.kind).toBe("exposed")
    if (readings.publicExposure.kind !== "exposed") throw new Error("narrowing")
    expect(readings.publicExposure.buckets[0].policySaysPublic).toBe(true)
    const text = surfaceText(readings)
    expect(text).toContain("POLICY STATUS: PUBLIC")
    expect(text).toContain("reports this bucket as PUBLIC")
  })

  test("a DENIED public-access-block read is never rendered as blocked", async () => {
    // The defect this whole module exists against: a refused sub-call that
    // renders as reassurance.
    const buckets = terraformEstate()
    buckets[0] = { ...buckets[0], pab: { fail: "AccessDenied" } }
    const readings = await load({ buckets })

    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const documents = readings.buckets.value.find((b) => b.name === DOCUMENTS)
    expect(documents?.publicAccessBlock.state).toBe("DENIED")
    if (documents?.publicAccessBlock.state !== "DENIED") throw new Error("narrowing")
    expect(documents.publicAccessBlock.action).toBe("s3:GetBucketPublicAccessBlock")
    expect(documents.publicAccessBlock.minimumStatement).toContain("s3:GetBucketPublicAccessBlock")
    expect(documents.publicAccessBlock.minimumStatement).not.toContain("s3:ListAllMyBuckets")

    // The estate verdict is qualified by the bucket it could not read, and the
    // bucket is named. "none observed" alone would be the lie.
    expect(readings.publicExposure.kind).toBe("none-observed")
    if (readings.publicExposure.kind !== "none-observed") throw new Error("narrowing")
    expect(readings.publicExposure.partiallyUnread).toEqual([DOCUMENTS])

    const line = bucketLines(readings).find((l) => l.label === DOCUMENTS)
    expect(line?.text).toContain("refused s3:GetBucketPublicAccessBlock")
    expect(line?.text).not.toContain("all four public access blocks are set")
    expect(surfaceText(readings)).toContain("could not be fully read")
  })

  test("a throttled public-access-block read is throttled, not blocked", async () => {
    const buckets = terraformEstate()
    buckets[1] = { ...buckets[1], pab: { fail: "ThrottlingException" } }
    const readings = await load({ buckets })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const exports = readings.buckets.value.find((b) => b.name === EXPORTS)
    expect(exports?.publicAccessBlock.state).toBe("THROTTLED")
    const line = bucketLines(readings).find((l) => l.label === EXPORTS)
    expect(line?.text).toContain("throttled")
    expect(line?.text).not.toContain("all four public access blocks are set")
    if (readings.publicExposure.kind !== "none-observed") throw new Error("narrowing")
    expect(readings.publicExposure.partiallyUnread).toEqual([EXPORTS])
  })

  test("a 200 with no PublicAccessBlockConfiguration is an ERROR, never four blocks", async () => {
    const buckets = terraformEstate()
    buckets[0] = { ...buckets[0], pab: undefined }
    const readings = await load({ buckets })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const documents = readings.buckets.value.find((b) => b.name === DOCUMENTS)
    expect(documents?.publicAccessBlock.state).toBe("ERROR")
    if (documents?.publicAccessBlock.state !== "ERROR") throw new Error("narrowing")
    expect(documents.publicAccessBlock.safeDetail).toContain("four blocks being in force")
    // Scoped to THIS bucket's line: the other bucket genuinely does have all
    // four set, and asserting over the whole surface would be asserting that a
    // real reading is absent.
    const line = bucketLines(readings).find((l) => l.label === DOCUMENTS)
    expect(line?.text).not.toContain("all four public access blocks are set")
    expect(line?.text).toContain("error —")
  })

  test("the Terraform estate, read back whole, reports no public bucket", async () => {
    const readings = await load()
    expect(readings.publicExposure.kind).toBe("none-observed")
    if (readings.publicExposure.kind !== "none-observed") throw new Error("narrowing")
    expect(readings.publicExposure.bucketsRead).toBe(2)
    expect(readings.publicExposure.partiallyUnread).toHaveLength(0)
    const text = surfaceText(readings)
    expect(text).toContain("no public bucket observed")
    expect(text).not.toContain("PUBLIC ACCESS FINDING")
    expect(text).not.toContain("could not be fully read")
  })
})

/* ---------------------------------------- one denial does not sink the row -- */

describe("each per-bucket fact degrades on its own", () => {
  test("a denied policy status leaves encryption, versioning, lifecycle and tags real", async () => {
    const buckets = terraformEstate()
    buckets[0] = { ...buckets[0], policyStatus: { fail: "AccessDenied" } }
    const readings = await load({ buckets })

    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const documents = readings.buckets.value.find((b) => b.name === DOCUMENTS)
    if (!documents) throw new Error("narrowing")

    expect(documents.policyStatus.state).toBe("DENIED")
    // Everything else answered, and says so.
    expect(documents.publicAccessBlock.state).toBe("ACTUAL")
    expect(documents.encryption.state).toBe("ACTUAL")
    expect(documents.versioning.state).toBe("ACTUAL")
    expect(documents.lifecycle.state).toBe("ACTUAL")
    expect(documents.tags.state).toBe("ACTUAL")
    expect(documents.cors.state).toBe("ACTUAL")

    const line = bucketLines(readings).find((l) => l.label === DOCUMENTS)
    expect(line?.text).toContain("refused s3:GetBucketPolicyStatus")
    expect(line?.text).toContain("SSE-KMS")
    expect(line?.text).toContain("versioning enabled")
    expect(line?.text).toContain("expire-temp-uploads")
    // And the refusal did not become the reassuring default.
    expect(line?.text).not.toContain("policy status: not public")
  })

  test("a bucket in another region can fail one call and keep the rest of its row", async () => {
    // `PermanentRedirect` is what S3 raises for a bucket the client's endpoint
    // cannot serve. It is not a denial and it is not an absence, so it lands as
    // ERROR — which is an UNKNOWN, and specifically not a reassuring default.
    const buckets = terraformEstate()
    buckets[1] = { ...buckets[1], encryption: { fail: "PermanentRedirect" } }
    const readings = await load({ buckets })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const exports = readings.buckets.value.find((b) => b.name === EXPORTS)
    expect(exports?.encryption.state).toBe("ERROR")
    expect(exports?.publicAccessBlock.state).toBe("ACTUAL")
    expect(exports?.lifecycle.state).toBe("ACTUAL")
    const line = bucketLines(readings).find((l) => l.label === EXPORTS)
    expect(line?.text).toContain("PermanentRedirect")
    expect(line?.text).not.toContain("SSE-S3")
    expect(line?.text).not.toContain("NO DEFAULT ENCRYPTION")
  })

  test("versioning's successful empty body is 'never enabled', not EMPTY", async () => {
    const readings = await load()
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const exports = readings.buckets.value.find((b) => b.name === EXPORTS)
    // The trap: `{}` through the default emptiness test would become EMPTY, and
    // "we looked and there is nothing" would replace the actual reading.
    expect(exports?.versioning.state).toBe("ACTUAL")
    if (exports?.versioning.state !== "ACTUAL") throw new Error("narrowing")
    expect(exports.versioning.value).toEqual({ status: "never-enabled", mfaDelete: "not-stated" })
    const line = bucketLines(readings).find((l) => l.label === EXPORTS)
    expect(line?.text).toContain("VERSIONING NEVER ENABLED")
    expect(line?.text).toContain("MFA-delete not stated by S3")
  })

  test("suspended versioning and MFA-delete are read back distinctly", async () => {
    const buckets = terraformEstate()
    buckets[0] = { ...buckets[0], versioning: { Status: "Suspended", MFADelete: "Enabled" } }
    const readings = await load({ buckets })
    const line = bucketLines(readings).find((l) => l.label === DOCUMENTS)
    expect(line?.text).toContain("VERSIONING SUSPENDED")
    expect(line?.text).toContain("MFA-delete enabled")
  })

  test("SSE-KMS and SSE-S3 are different answers, and 'none' is a third", async () => {
    const readings = await load()
    const documents = bucketLines(readings).find((l) => l.label === DOCUMENTS)
    const exports = bucketLines(readings).find((l) => l.label === EXPORTS)
    expect(documents?.text).toContain("SSE-KMS under alias/tenure-documents")
    expect(exports?.text).toContain("SSE-S3 (AES256)")
    expect(exports?.text).toContain("not under a key this account controls")

    const buckets = terraformEstate()
    buckets[1] = {
      ...buckets[1],
      encryption: { fail: "ServerSideEncryptionConfigurationNotFoundError" },
    }
    const unencrypted = await load({ buckets })
    expect(surfaceText(unencrypted)).toContain("NO DEFAULT ENCRYPTION")
  })

  test("a lifecycle configuration is read back rule by rule, and its absence is its own answer", async () => {
    const readings = await load()
    const documents = bucketLines(readings).find((l) => l.label === DOCUMENTS)
    expect(documents?.text).toContain("expire-temp-uploads Enabled, prefix tmp/, expires after 1d")
    const exports = bucketLines(readings).find((l) => l.label === EXPORTS)
    expect(exports?.text).toContain("expire-exports Enabled, whole bucket, expires after 30d")

    const buckets = terraformEstate()
    buckets[0] = { ...buckets[0], lifecycle: { fail: "NoSuchLifecycleConfiguration" } }
    const none = await load({ buckets })
    expect(surfaceText(none)).toContain("every object keeps billing")
  })

  test("a CORS rule allowing any origin is called out; its absence is not", async () => {
    const readings = await load()
    const documents = bucketLines(readings).find((l) => l.label === DOCUMENTS)
    // s3.tf sets allowed_origins = ["*"] on the documents bucket.
    expect(documents?.text).toContain("CORS ALLOWS ANY ORIGIN (*) for GET, POST, PUT")
    const exports = bucketLines(readings).find((l) => l.label === EXPORTS)
    expect(exports?.text).toContain("no CORS configuration")
  })
})

/* ------------------------------------------------------ residency and tags -- */

describe("region and partition come from AWS, never from a literal", () => {
  test("a region S3 did not state is unknown, and is NOT the caller's region", async () => {
    // The GE-010-007 shape: filling a bucket's region in from the resolved
    // identity would place it in a region nobody read, on the page an operator
    // uses to decide where data lives.
    const readings = await load()
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    for (const bucket of readings.buckets.value) {
      expect(bucket.region.kind).toBe("unstated")
    }
    const text = surfaceText(readings)
    expect(text).toContain("region unknown")
    expect(text).toContain("s3:GetBucketLocation")
    expect(text).not.toContain("eu-west-2")
    expect(text).not.toContain("us-east-1")
  })

  test("a region S3 DID state is used verbatim", async () => {
    const buckets = terraformEstate().map((b) => ({ ...b, region: "eu-west-2" }))
    // pageSize 1 forces a second request, which carries a ContinuationToken —
    // which is when S3 states BucketRegion.
    const readings = await load({ buckets, pageSize: 1 })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const second = readings.buckets.value.find((b) => b.name === EXPORTS)
    expect(second?.region).toEqual({ kind: "stated", region: "eu-west-2" })
    expect(surfaceText(readings)).toContain("eu-west-2")
  })

  test("a GovCloud identity produces GovCloud ARNs and no commercial partition anywhere", async () => {
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
    })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const documents = readings.buckets.value.find((b) => b.name === DOCUMENTS)
    expect(documents?.arn).toBe(`arn:aws-us-gov:s3:::${DOCUMENTS}`)
    expect(documents?.partition).toBe("aws-us-gov")
    expect(surfaceText(readings)).toContain("partition aws-us-gov")
    expect(surfaceText(readings)).not.toContain("partition aws)")
  })

  test("with identity unresolved no ARN is invented", async () => {
    const readings = await load({ identity: "denied" })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    for (const bucket of readings.buckets.value) {
      expect(bucket.arn).toBeNull()
      expect(bucket.partition).toBeNull()
    }
    expect(bucketArn(DOCUMENTS, readings.identity)).toBeNull()
  })
})

describe("attribution comes from the tag index first and the bucket's own tags second", () => {
  test("a tenure:tenant tag in the index attributes the bucket to that tenant", async () => {
    const readings = await load({
      tags: {
        [`arn:aws:s3:::${EXPORTS}`]: [
          { Key: "tenure:tenant", Value: "simon-ose" },
          { Key: "tenure:environment", Value: "production" },
        ],
      },
    })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const exports = readings.buckets.value.find((b) => b.name === EXPORTS)
    expect(exports?.attribution).toEqual({ kind: "tenant", tenantSlug: "simon-ose" })
    expect(exports?.attributionSource).toContain("tag:GetResources")
    expect(surfaceText(readings)).toContain("simon-ose")
  })

  test("a bucket absent from the index falls back to its own tags, not to 'unattributed'", async () => {
    // The S3 correction: the Tagging API answers for one region and a bucket ARN
    // carries none, so "not in the index" is not "untagged".
    const readings = await load({ tagsOutcome: "empty" })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const documents = readings.buckets.value.find((b) => b.name === DOCUMENTS)
    expect(documents?.attribution.kind).toBe("shared")
    expect(documents?.attributionSource).toContain("s3:GetBucketTagging")
    expect(surfaceText(readings)).toContain("shared — platform overhead")
  })

  test("NoSuchTagSet is definitively unattributed", async () => {
    const readings = await load({ tagsOutcome: "empty" })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const exports = readings.buckets.value.find((b) => b.name === EXPORTS)
    expect(exports?.attribution.kind).toBe("unattributed")
    expect(surfaceText(readings)).toContain("unattributable — missing tenure:tenant")
  })

  test("a denied index AND denied bucket tags is unknown, not unattributable", async () => {
    // The distinction that matters: "missing tenure:tenant" sends an operator to
    // add a tag that is probably already there.
    const buckets = terraformEstate().map((b) => ({ ...b, tagging: { fail: "AccessDenied" } }))
    const readings = await load({ buckets, tagsOutcome: "denied" })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    for (const bucket of readings.buckets.value) {
      expect(bucket.attribution.kind).toBe("unknown")
    }
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    expect(text).toContain("tag:GetResources")
    expect(text).not.toContain("unattributable — missing tenure:tenant")
  })

  test("a throttled tag index with readable bucket tags still attributes, and says where from", async () => {
    const readings = await load({ tagsOutcome: "throttled" })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    const documents = readings.buckets.value.find((b) => b.name === DOCUMENTS)
    expect(documents?.attribution.kind).toBe("shared")
    expect(documents?.attributionSource).toContain("s3:GetBucketTagging")
  })
})

/* ------------------------------------------------- pagination and the caps -- */

describe("the listing paginates to completion, with a bound and an explicit signal", () => {
  test("every page is walked and every bucket appears", async () => {
    const many: BucketFixture[] = []
    for (let i = 0; i < 7; i += 1) {
      many.push({ ...terraformEstate()[1], name: `tenure-bulk-${String(i).padStart(3, "0")}` })
    }
    const readings = await load({ buckets: many, pageSize: 2 })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.buckets.value).toHaveLength(7)
    expect(readings.listing).toEqual({ kind: "complete", bucketsListed: 7, pagesRead: 4 })
    expect(surfaceText(readings)).toContain("7 bucket(s) listed in full over 4 page(s)")
  })

  test("hitting the page cap keeps the buckets read and says there were more", async () => {
    const readings = await load({ endlessPages: true })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    // The buckets that WERE read are real and are kept.
    expect(readings.buckets.value.length).toBe(2 * MAX_LIST_PAGES)
    expect(readings.listing.kind).toBe("truncated")
    if (readings.listing.kind !== "truncated") throw new Error("narrowing")
    expect(readings.listing.pagesRead).toBe(MAX_LIST_PAGES)
    const text = surfaceText(readings)
    expect(text).toContain("THERE WERE MORE")
    expect(text).toContain("is NOT the estate")
    expect(text).not.toContain("listed in full")
  })

  test("a complete listing never claims there were more", async () => {
    const readings = await load()
    expect(readings.listing.kind).toBe("complete")
    expect(surfaceText(readings)).not.toContain("THERE WERE MORE")
  })

  test("buckets past the posture cap say they were not read, not that they are blocked", async () => {
    const many: BucketFixture[] = []
    for (let i = 0; i < MAX_POSTURE_BUCKETS + 3; i += 1) {
      many.push({ ...terraformEstate()[0], name: `tenure-bulk-${String(i).padStart(4, "0")}` })
    }
    const readings = await load({ buckets: many })
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.buckets.value).toHaveLength(MAX_POSTURE_BUCKETS + 3)
    const last = readings.buckets.value[readings.buckets.value.length - 1]
    expect(last.publicAccessBlock.state).toBe("UNCONFIGURED")
    if (last.publicAccessBlock.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(last.publicAccessBlock.why).toContain("not the same as")
    expect(last.encryption.state).toBe("UNCONFIGURED")
    // And it is counted as unread rather than as compliant.
    if (readings.publicExposure.kind !== "none-observed") throw new Error("narrowing")
    expect(readings.publicExposure.partiallyUnread).toContain(last.name)
    const line = bucketLines(readings).find((l) => l.label === last.name)
    expect(line?.text).not.toContain("all four public access blocks are set")
  })
})

/* ---------------------------------------------------- as-of and cadence -- */

describe("every reading carries when it was taken and how often it refreshes", () => {
  test("the load stamps an explicit asOf and both capabilities' own cadences", async () => {
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    // Not numbers retyped here: these are the registry's declarations, so a
    // cadence changed in capabilities.ts changes what the surface promises.
    expect(readings.refreshMs.buckets).toBe(600_000)
    expect(readings.refreshMs.posture).toBe(300_000)
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    for (const bucket of readings.buckets.value) {
      expect(bucket.asOf).toBe("2026-08-13T09:15:00.000Z")
      expect(bucket.refreshMs).toBe(300_000)
    }
    const text = surfaceText(readings)
    expect(text).toContain("refreshed every 600s")
    expect(text).toContain("refreshed every 300s")
    expect(text).toContain("as of 2026-08-13T09:15:00.000Z")
  })

  test("a bucket's creation date is read back from AWS's own field", async () => {
    const readings = await load()
    if (readings.buckets.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.buckets.value.find((b) => b.name === DOCUMENTS)?.createdAt).toBe(
      "2026-01-04T10:00:00.000Z",
    )
  })

  test("the bucket order is stable across loads", async () => {
    const shuffled = [...terraformEstate()].reverse()
    const a = await load()
    __resetIdentity()
    const b = await load({ buckets: shuffled })
    if (a.buckets.state !== "ACTUAL" || b.buckets.state !== "ACTUAL") throw new Error("narrowing")
    expect(a.buckets.value.map((x) => x.name)).toEqual(b.buckets.value.map((x) => x.name))
  })
})
