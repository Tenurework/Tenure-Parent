import { SHARED } from "@tenure/provisioning"

import { __resetIdentity } from "./identity"
import {
  ALIASES_NOT_READABLE,
  MAX_KEY_DETAIL_READS,
  MAX_KEY_PAGES,
  keyReadings,
  kmsLines,
  type KmsReadings,
} from "./keys"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 (KMS) — the key surface tells four different truths apart, and
 * refuses to let an AWS-managed key stand in for a compliance pass.
 *
 * The assertions are on `keyReadings` and `kmsLines`, the functions a surface
 * renders, rather than on `readAws` or on a parser. A test that drove a private
 * helper would stay green on the day this module stopped calling it, which is
 * precisely the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeKms` answers five capabilities with the shapes the real SDK returns —
 * `{Keys:[{KeyId,KeyArn}], NextMarker, Truncated}` from ListKeys,
 * `{KeyMetadata:{…}}` from DescribeKey (with real `Date` objects, because that
 * is what the SDK hands back), `{KeyRotationEnabled, RotationPeriodInDays,
 * NextRotationDate}` from GetKeyRotationStatus,
 * `{ResourceTagMappingList:[{ResourceARN,Tags}]}` from the Tagging API and
 * `{Account, Arn}` from STS — and each can fail independently with
 * `AccessDeniedException`, `ThrottlingException`, an empty-but-successful list
 * or a populated one. A stand-in that returned `[]` regardless of what was asked
 * would prove nothing about code whose entire job is telling those apart, and it
 * is the fake this repository has already been burnt by.
 *
 * ## Every identifier here is obviously constructed
 *
 * The account id is `123456789012`, AWS's own documentation placeholder, and the
 * key ids are repeated-digit UUIDs. Nothing in this file is a real account, a
 * real ARN or a real key — stated here so no reader mistakes a fixture for an
 * observation.
 */

/* -------------------------------------------------------------- the estate -- */

/** AWS's documentation placeholder account. Not a real account. */
const ACCOUNT = "123456789012"
/** The region the fake identity resolves to. Read from identity, never a literal in keys.ts. */
const REGION = "eu-west-2"
const PARTITION = "aws"

const KEY_RDS = "11111111-1111-1111-1111-111111111111"
const KEY_S3 = "22222222-2222-2222-2222-222222222222"
const KEY_AWS_MANAGED = "33333333-3333-3333-3333-333333333333"
const KEY_PENDING = "44444444-4444-4444-4444-444444444444"
const KEY_ASYMMETRIC = "55555555-5555-5555-5555-555555555555"

function keyArn(keyId: string, partition = PARTITION, region = REGION): string {
  return `arn:${partition}:kms:${region}:${ACCOUNT}:key/${keyId}`
}

interface MetadataFixture {
  KeyId: string
  Arn: string
  AWSAccountId: string
  Description?: string
  Enabled: boolean
  KeyState: string
  KeyManager: string
  KeyUsage?: string
  KeySpec?: string
  Origin?: string
  MultiRegion?: boolean
  CreationDate?: Date
  DeletionDate?: Date
  PendingDeletionWindowInDays?: number
  CustomKeyStoreId?: string
}

interface KeyFixture {
  keyId: string
  /** Omitted from the LISTING when false, so the ARN-provenance path is exercised. */
  listArn?: boolean
  metadata?: MetadataFixture
  /** Raised by DescribeKey instead of answering, so a per-key denial is exercised. */
  describeFailsWith?: string
  /** What GetKeyRotationStatus does for this key, when it is asked at all. */
  rotation?:
    | { enabled: boolean; periodDays?: number; nextRotationAt?: Date }
    | { failWith: string }
    /** Answers 200 with no `KeyRotationEnabled` at all — neither on nor off. */
    | { omitEnabled: true }
}

function customerMetadata(
  keyId: string,
  description: string,
  overrides: Partial<MetadataFixture> = {},
): MetadataFixture {
  return {
    KeyId: keyId,
    Arn: keyArn(keyId),
    AWSAccountId: ACCOUNT,
    Description: description,
    Enabled: true,
    KeyState: "Enabled",
    KeyManager: "CUSTOMER",
    KeyUsage: "ENCRYPT_DECRYPT",
    KeySpec: "SYMMETRIC_DEFAULT",
    Origin: "AWS_KMS",
    MultiRegion: false,
    CreationDate: new Date("2025-01-04T10:00:00.000Z"),
    ...overrides,
  }
}

/**
 * The estate: two customer keys (one rotating, one NOT), one AWS-managed key,
 * one scheduled for deletion, and one asymmetric key on which rotation is not a
 * setting that exists.
 */
function healthyEstate(): KeyFixture[] {
  return [
    {
      keyId: KEY_RDS,
      listArn: true,
      metadata: customerMetadata(KEY_RDS, "tenure-prod RDS storage encryption"),
      rotation: {
        enabled: true,
        periodDays: 365,
        nextRotationAt: new Date("2026-11-01T10:00:00.000Z"),
      },
    },
    {
      keyId: KEY_S3,
      listArn: true,
      metadata: customerMetadata(KEY_S3, "tenure-prod uploads bucket SSE-KMS"),
      rotation: { enabled: false },
    },
    {
      keyId: KEY_AWS_MANAGED,
      listArn: true,
      metadata: customerMetadata(KEY_AWS_MANAGED, "Default key that protects my RDS resources", {
        KeyManager: "AWS",
      }),
    },
    {
      keyId: KEY_PENDING,
      listArn: true,
      metadata: customerMetadata(KEY_PENDING, "retired analytics key", {
        Enabled: false,
        KeyState: "PendingDeletion",
        DeletionDate: new Date("2026-09-02T00:00:00.000Z"),
        PendingDeletionWindowInDays: 20,
      }),
      rotation: { enabled: true },
    },
    {
      keyId: KEY_ASYMMETRIC,
      listArn: true,
      metadata: customerMetadata(KEY_ASYMMETRIC, "document signing key", {
        KeyUsage: "SIGN_VERIFY",
        KeySpec: "RSA_4096",
      }),
    },
  ]
}

/* -------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  /** How `kms:ListKeys` behaves. The four cases this suite exists to separate. */
  listKeys?: Outcome
  keys?: KeyFixture[]
  /** Keys per ListKeys page, so pagination is walked rather than assumed. */
  pageSize?: number
  /** Keeps handing back a NextMarker forever, so the page bound is exercised. */
  endlessPages?: boolean
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Every capability the module asked for, in order. Asserted on directly. */
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function fakeKms(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.listKeys ?? "populated"
  const keys = options.keys ?? healthyEstate()
  const pageSize = options.pageSize ?? 100
  const identity = options.identity ?? {
    arn: `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
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

        case "kms:ListKeys": {
          if (listOutcome === "denied") throwing("AccessDeniedException")
          if (listOutcome === "throttled") throwing("ThrottlingException")
          // The real API returns an EMPTY `Keys` array when the account has no
          // keys. Both that and an omitted field are the same fact, and the fake
          // sends the one AWS actually sends.
          if (listOutcome === "empty") return { Keys: [], Truncated: false }

          const marker = (input as { Marker?: unknown } | undefined)?.Marker
          if (options.endlessPages) {
            const page = typeof marker === "string" ? Number(marker) : 0
            const fixture = keys[page % keys.length]
            return {
              Keys: [{ KeyId: `${fixture.keyId}`, KeyArn: keyArn(fixture.keyId) }],
              NextMarker: String(page + 1),
              Truncated: true,
            }
          }

          const start = typeof marker === "string" ? Number(marker) : 0
          const slice = keys.slice(start, start + pageSize)
          const next = start + pageSize
          return {
            Keys: slice.map((k) => ({
              KeyId: k.keyId,
              ...(k.listArn === false ? {} : { KeyArn: keyArn(k.keyId) }),
            })),
            ...(next < keys.length ? { NextMarker: String(next), Truncated: true } : {}),
          }
        }

        case "kms:DescribeKey": {
          const keyId = String((input as { KeyId?: unknown } | undefined)?.KeyId ?? "")
          const fixture = keys.find((k) => k.keyId === keyId)
          if (!fixture) throwing("NotFoundException")
          if (fixture.describeFailsWith) throwing(fixture.describeFailsWith)
          return { KeyMetadata: fixture.metadata }
        }

        case "kms:GetKeyRotationStatus": {
          const keyId = String((input as { KeyId?: unknown } | undefined)?.KeyId ?? "")
          const fixture = keys.find((k) => k.keyId === keyId)
          if (!fixture || !fixture.rotation) throwing("NotFoundException")
          if ("failWith" in fixture.rotation) throwing(fixture.rotation.failWith)
          if ("omitEnabled" in fixture.rotation) return { KeyId: keyId }
          return {
            KeyId: keyId,
            KeyRotationEnabled: fixture.rotation.enabled,
            ...(fixture.rotation.periodDays === undefined
              ? {}
              : { RotationPeriodInDays: fixture.rotation.periodDays }),
            ...(fixture.rotation.nextRotationAt === undefined
              ? {}
              : { NextRotationDate: fixture.rotation.nextRotationAt }),
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

const AT = () => new Date("2026-08-13T09:15:00.000Z")

async function load(options: FakeOptions = {}): Promise<KmsReadings> {
  return keyReadings(fakeKms(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: KmsReadings): string {
  return kmsLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* --------------------------------------------- the four outcomes, compared -- */

describe("the KMS surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every key with its purpose", async () => {
    const readings = await load()
    expect(readings.keys.state).toBe("ACTUAL")
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.keys.value).toHaveLength(5)

    const text = surfaceText(readings)
    expect(text).toContain("tenure-prod RDS storage encryption")
    expect(text).toContain("tenure-prod uploads bucket SSE-KMS")
    expect(text).toContain("customer-managed")
    expect(text).toContain("AWS-managed")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ listKeys: "empty" })
    expect(readings.keys.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
  })

  test("a denial is DENIED, names the action and the principal, and is NEVER an empty list", async () => {
    const readings = await load({ listKeys: "denied" })
    expect(readings.keys.state).toBe("DENIED")
    if (readings.keys.state !== "DENIED") throw new Error("narrowing")
    expect(readings.keys.action).toBe("kms:ListKeys")
    expect(readings.keys.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.keys.region).toBe(REGION)
    expect(readings.keys.partition).toBe(PARTITION)
    expect(readings.keys.minimumStatement).toContain("kms:ListKeys")

    const text = surfaceText(readings)
    expect(text).toContain("kms:ListKeys")
    expect(text).toContain("Minimum statement")
    // The sentence an operator must never see for a denial.
    expect(text).not.toContain("none —")
    // And no key rows at all: there is no value to iterate.
    expect(kmsLines(readings)).toHaveLength(3)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty result", async () => {
    const readings = await load({ listKeys: "throttled" })
    expect(readings.keys.state).toBe("THROTTLED")
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("none —")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four outcomes produce four DIFFERENT surfaces", async () => {
    const texts = await Promise.all(
      (["populated", "empty", "denied", "throttled"] as const).map(async (outcome) => {
        __resetIdentity()
        return surfaceText(await load({ listKeys: outcome }))
      }),
    )
    expect(new Set(texts).size).toBe(4)
  })
})

/* ------------------------------------ an AWS-managed key is not a pass mark -- */

describe("the rotation posture does not let an AWS-managed key stand in for compliance", () => {
  test("AWS-managed keys are excluded from the denominator and from the rotating count", async () => {
    const readings = await load()
    const posture = readings.posture

    // Two customer-managed keys had their rotation READ: KEY_RDS (on) and
    // KEY_S3 (off). KEY_PENDING is customer-managed and rotating, so three.
    expect(posture.customerManagedRead).toBe(3)
    expect(posture.rotating).toBe(2)
    expect(posture.notRotating).toEqual([KEY_S3])
    expect(posture.awsManagedExcluded).toBe(1)

    // The AWS-managed key is in NO compliant total.
    expect(posture.rotating + posture.notRotating.length).toBe(posture.customerManagedRead)
    expect(posture.customerManagedRead).toBeLessThan(readings.keys.state === "ACTUAL" ? 5 : 0)

    const text = surfaceText(readings)
    expect(text).toContain("AWS-managed key(s) excluded")
    expect(text).toContain("not evidence this estate does")
  })

  test("no GetKeyRotationStatus call is made for an AWS-managed key", async () => {
    const calls: string[] = []
    await keyReadings(fakeKms({ calls }), { now: AT })
    const rotationCalls = calls.filter((c) => c === "kms:GetKeyRotationStatus")
    // Three: the two symmetric customer keys and the pending-deletion one. Not
    // the AWS-managed key, and not the asymmetric key.
    expect(rotationCalls).toHaveLength(3)
  })

  test("a customer-managed key with rotation off is named, not counted", async () => {
    const readings = await load()
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    const s3 = readings.keys.value.find((k) => k.keyId === KEY_S3)
    expect(s3?.rotation.kind).toBe("disabled")

    const text = surfaceText(readings)
    expect(text).toContain("NOT ROTATING")
    expect(text).toContain(KEY_S3)
    expect(text).toContain("every object ever encrypted under it shares one key")
  })

  test("an asymmetric key is not-applicable, which is neither a pass nor a finding", async () => {
    const readings = await load()
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    const signing = readings.keys.value.find((k) => k.keyId === KEY_ASYMMETRIC)
    expect(signing?.rotation.kind).toBe("not-applicable")
    expect(readings.posture.notApplicable).toEqual([KEY_ASYMMETRIC])
    expect(readings.posture.notRotating).not.toContain(KEY_ASYMMETRIC)
    expect(surfaceText(readings)).toContain("rotation not applicable")
  })

  test("a key whose material was imported cannot rotate, and says why", async () => {
    const imported = healthyEstate().map((k) =>
      k.keyId === KEY_RDS
        ? {
            ...k,
            metadata: customerMetadata(KEY_RDS, "imported material", { Origin: "EXTERNAL" }),
            rotation: undefined,
          }
        : k,
    )
    const readings = await load({ keys: imported })
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    const key = readings.keys.value.find((k) => k.keyId === KEY_RDS)
    expect(key?.rotation.kind).toBe("not-applicable")
    expect(surfaceText(readings)).toContain("origin EXTERNAL")
  })
})

/* ---------------------------------------- a key pending deletion is urgent -- */

describe("a key scheduled for deletion names the date", () => {
  test("the lifecycle carries the deletion date and the remaining window", async () => {
    const readings = await load()
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    const pending = readings.keys.value.find((k) => k.keyId === KEY_PENDING)
    expect(pending?.lifecycle.kind).toBe("pending-deletion")
    if (pending?.lifecycle.kind !== "pending-deletion") throw new Error("narrowing")
    expect(pending.lifecycle.deletionDate).toBe("2026-09-02T00:00:00.000Z")
    expect(pending.lifecycle.windowDays).toBe(20)

    const text = surfaceText(readings)
    expect(text).toContain("PENDING DELETION")
    expect(text).toContain("2026-09-02T00:00:00.000Z")
    expect(text).toContain("permanently unrecoverable")
    expect(readings.posture.pendingDeletion).toEqual([
      { keyId: KEY_PENDING, deletionDate: "2026-09-02T00:00:00.000Z" },
    ])
  })

  test("a disabled key does not read as pending deletion, and vice versa", async () => {
    const disabled = healthyEstate().map((k) =>
      k.keyId === KEY_PENDING
        ? {
            ...k,
            metadata: customerMetadata(KEY_PENDING, "retired analytics key", {
              Enabled: false,
              KeyState: "Disabled",
            }),
          }
        : k,
    )
    const readings = await load({ keys: disabled })
    const text = surfaceText(readings)
    expect(text).toContain("DISABLED")
    expect(text).not.toContain("PENDING DELETION")
    expect(readings.posture.pendingDeletion).toEqual([])
  })
})

/* --------------------------------------- sub-calls degrade INDEPENDENTLY -- */

describe("one denied detail does not collapse the row, and does not render as a default", () => {
  test("a denied DescribeKey leaves the other keys intact and names the refusal", async () => {
    const estate = healthyEstate().map((k) =>
      k.keyId === KEY_S3 ? { ...k, describeFailsWith: "AccessDeniedException" } : k,
    )
    const readings = await load({ keys: estate })
    expect(readings.keys.state).toBe("ACTUAL")
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.keys.value).toHaveLength(5)

    const s3 = readings.keys.value.find((k) => k.keyId === KEY_S3)
    expect(s3?.detail.state).toBe("DENIED")
    if (s3?.detail.state !== "DENIED") throw new Error("narrowing")
    expect(s3.detail.action).toBe("kms:DescribeKey")

    // The row is still there and the OTHER rows still read.
    const text = surfaceText(readings)
    expect(text).toContain("tenure-prod RDS storage encryption")
    expect(text).toContain("kms:DescribeKey")
    // And it must not render as anything reassuring: no lifecycle, no rotation.
    expect(s3.lifecycle.kind).toBe("unknown")
    expect(s3.rotation.kind).toBe("unknown")
    expect(readings.posture.unreadable).toEqual([KEY_S3])
    expect(readings.posture.complete).toBe(false)
  })

  test("a key whose describe was refused has UNKNOWN rotation — never 'not rotating'", async () => {
    const estate = healthyEstate().map((k) =>
      k.keyId === KEY_S3 ? { ...k, describeFailsWith: "AccessDeniedException" } : k,
    )
    const readings = await load({ keys: estate })
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    const s3 = readings.keys.value.find((k) => k.keyId === KEY_S3)
    expect(s3?.rotation.kind).toBe("unknown")
    expect(readings.posture.notRotating).toEqual([])
    expect(readings.posture.rotating).toBe(2)
    expect(surfaceText(readings)).toContain("rotation unknown")
  })

  test("a denied GetKeyRotationStatus is UNKNOWN, counted in neither total", async () => {
    const estate = healthyEstate().map((k) =>
      k.keyId === KEY_RDS ? { ...k, rotation: { failWith: "AccessDeniedException" } } : k,
    )
    const readings = await load({ keys: estate })
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    const rds = readings.keys.value.find((k) => k.keyId === KEY_RDS)

    // The row still carries its description and lifecycle — the detail read
    // succeeded and only the rotation sub-call failed.
    expect(rds?.detail.state).toBe("ACTUAL")
    expect(rds?.lifecycle.kind).toBe("active")
    expect(rds?.rotation.kind).toBe("unknown")

    expect(readings.posture.rotationUnknown).toEqual([KEY_RDS])
    expect(readings.posture.rotating).toBe(1)
    expect(readings.posture.notRotating).toEqual([KEY_S3])
    expect(readings.posture.customerManagedRead).toBe(2)
    expect(readings.posture.complete).toBe(false)

    const text = surfaceText(readings)
    expect(text).toContain("Rotation UNKNOWN for")
    expect(text).toContain("kms:GetKeyRotationStatus")
    expect(text).toContain("NOT a verdict over the whole estate")
  })

  test("a throttled rotation read is its own state, not a finding", async () => {
    const estate = healthyEstate().map((k) =>
      k.keyId === KEY_RDS ? { ...k, rotation: { failWith: "ThrottlingException" } } : k,
    )
    const readings = await load({ keys: estate })
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    const rds = readings.keys.value.find((k) => k.keyId === KEY_RDS)
    expect(rds?.rotation.kind).toBe("unknown")
    if (rds?.rotation.kind !== "unknown") throw new Error("narrowing")
    expect(rds.rotation.why).toContain("throttled")
    expect(readings.posture.notRotating).toEqual([KEY_S3])
  }, 15000)

  test("a rotation answer with no KeyRotationEnabled is UNKNOWN, not 'off'", async () => {
    const estate = healthyEstate().map((k) =>
      k.keyId === KEY_RDS ? { ...k, rotation: { omitEnabled: true as const } } : k,
    )
    const readings = await load({ keys: estate })
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    const rds = readings.keys.value.find((k) => k.keyId === KEY_RDS)
    expect(rds?.rotation.kind).toBe("unknown")
    // The finding must not be invented, and must not be hidden either.
    expect(readings.posture.notRotating).toEqual([KEY_S3])
    expect(readings.posture.rotating).toBe(1)
    expect(readings.posture.rotationUnknown).toEqual([KEY_RDS])
  })

  test("an unrecognised KeyManager is neither counted nor guessed", async () => {
    const estate = healthyEstate().map((k) =>
      k.keyId === KEY_RDS
        ? {
            ...k,
            metadata: customerMetadata(KEY_RDS, "a key from a future API", {
              KeyManager: "PARTNER",
            }),
          }
        : k,
    )
    const readings = await load({ keys: estate })
    expect(readings.posture.unrecognisedManagement).toEqual([KEY_RDS])
    expect(readings.posture.rotating).toBe(1)
    expect(readings.posture.awsManagedExcluded).toBe(1)
    expect(readings.posture.complete).toBe(false)
    expect(surfaceText(readings)).toContain("Unrecognised KeyManager on")
  })
})

/* ------------------------------------------------ pagination and its bound -- */

describe("the listing paginates to completion, with a bound that announces itself", () => {
  test("every page is walked, not just the first", async () => {
    const calls: string[] = []
    // One key per page: five pages, five keys, all present.
    const readings = await keyReadings(fakeKms({ pageSize: 1, calls }), { now: AT })
    expect(readings.keys.state).toBe("ACTUAL")
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.keys.value).toHaveLength(5)
    expect(calls.filter((c) => c === "kms:ListKeys")).toHaveLength(5)
    expect(readings.truncation.kind).toBe("complete")
    expect(surfaceText(readings)).toContain("complete — 5 key(s) listed")
  })

  test("hitting the page bound returns the keys AND an explicit 'there were more'", async () => {
    const calls: string[] = []
    const readings = await keyReadings(fakeKms({ endlessPages: true, calls }), { now: AT })
    expect(calls.filter((c) => c === "kms:ListKeys")).toHaveLength(MAX_KEY_PAGES)
    expect(readings.keys.state).toBe("ACTUAL")
    expect(readings.truncation.kind).toBe("more-keys")
    if (readings.truncation.kind !== "more-keys") throw new Error("narrowing")
    expect(readings.truncation.pagesRead).toBe(MAX_KEY_PAGES)

    const text = surfaceText(readings)
    expect(text).toContain("PARTIAL")
    expect(text).toContain("there are more this engine did not list")
    // A truncated listing can never present its posture as a verdict.
    expect(readings.posture.complete).toBe(false)
  }, 30000)

  test("keys past the description budget are UNCONFIGURED, never 'healthy'", async () => {
    // MAX_KEY_DETAIL_READS + 1 AWS-managed keys, so no rotation calls are made
    // and the case stays about the description budget alone.
    const many: KeyFixture[] = Array.from({ length: MAX_KEY_DETAIL_READS + 1 }, (_unused, i) => {
      const id = `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`
      return {
        keyId: id,
        listArn: true,
        metadata: customerMetadata(id, `generated fixture ${i}`, { KeyManager: "AWS" }),
      }
    })
    const readings = await keyReadings(fakeKms({ keys: many, pageSize: 1000 }), { now: AT })
    expect(readings.keys.state).toBe("ACTUAL")
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.keys.value).toHaveLength(MAX_KEY_DETAIL_READS + 1)

    const last = readings.keys.value[MAX_KEY_DETAIL_READS]
    expect(last.detail.state).toBe("UNCONFIGURED")
    expect(last.rotation.kind).toBe("unknown")
    expect(readings.truncation.kind).toBe("detail-budget")
    expect(surfaceText(readings)).toContain("PARTIAL")
    expect(readings.posture.complete).toBe(false)
  }, 30000)
})

/* --------------------------------------- region, partition and attribution -- */

describe("region and partition come from the resolved identity, never a literal", () => {
  test("a GovCloud identity produces GovCloud keys, with no us-east-1 anywhere", async () => {
    const govKeys = healthyEstate().map((k) => ({ ...k, listArn: false, metadata: undefined }))
    const readings = await load({
      keys: govKeys.map((k) => ({
        ...k,
        describeFailsWith: "AccessDeniedException",
      })),
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
    })
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    for (const key of readings.keys.value) {
      expect(key.partition).toBe("aws-us-gov")
      expect(key.region).toBe("us-gov-west-1")
      expect(key.arn).toBe(
        `arn:aws-us-gov:kms:us-gov-west-1:${ACCOUNT}:key/${key.keyId}`,
      )
      expect(key.arnProvenance).toContain("assembled from the resolved identity")
    }
    expect(surfaceText(readings)).not.toContain("us-east-1")
  })

  test("an unresolved identity yields no assembled ARN rather than half of one", async () => {
    const readings = await load({
      keys: healthyEstate().map((k) => ({
        ...k,
        listArn: false,
        describeFailsWith: "AccessDeniedException",
      })),
      identity: "denied",
    })
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    for (const key of readings.keys.value) {
      expect(key.arn).toBeNull()
      expect(key.arnProvenance).toContain("will not")
    }
    expect(surfaceText(readings)).toContain("region unknown")
  })

  test("a key is attributed from its tenure:tenant tag, and shared where one says so", async () => {
    const readings = await load({
      tags: {
        [keyArn(KEY_RDS)]: [
          { Key: "tenure:tenant", Value: "northwood-academy" },
          { Key: "tenure:environment", Value: "production" },
        ],
        [keyArn(KEY_S3)]: [{ Key: "tenure:tenant", Value: SHARED }],
      },
    })
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    const byId = new Map(readings.keys.value.map((k) => [k.keyId, k]))
    expect(byId.get(KEY_RDS)?.attribution).toEqual({
      kind: "tenant",
      tenantSlug: "northwood-academy",
    })
    expect(byId.get(KEY_S3)?.attribution).toEqual({ kind: "shared" })
    // Present in the tag index with no tags of its own: nobody claimed it.
    expect(byId.get(KEY_PENDING)?.attribution).toEqual({ kind: "unattributed" })
    const text = surfaceText(readings)
    expect(text).toContain("northwood-academy")
    expect(text).toContain("shared — platform overhead")
  })

  test("a denied tag index is UNKNOWN attribution, not 'unattributable'", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    for (const key of readings.keys.value) {
      expect(key.attribution.kind).toBe("unknown")
    }
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    expect(text).not.toContain("unattributable — missing tenure:tenant")
  })
})

/* -------------------------------------------- what this module cannot read -- */

describe("aliases are not read, and the surface says so rather than implying none", () => {
  test("every key carries the alias gap, naming the capability and the IAM action", async () => {
    const readings = await load()
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    for (const key of readings.keys.value) {
      expect(key.aliases).toBe(ALIASES_NOT_READABLE)
      expect(key.aliases.needs).toBe("kms:ListAliases")
      expect(key.aliases.iamAction).toBe("kms:ListAliases")
    }
    const text = surfaceText(readings)
    expect(text).toContain("kms:ListAliases")
    expect(text).toContain("not the same as this key having none")
  })
})

/* ------------------------------------------------- as-of and refresh cadence -- */

describe("every reading carries an as-of and its own refresh cadence", () => {
  test("the cadences come from the capability registry, not from a literal here", async () => {
    const { CAPABILITIES } = await import("./capabilities")
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    expect(readings.refreshMs.keys).toBe(CAPABILITIES["kms:ListKeys"].refreshMs)
    expect(readings.refreshMs.detail).toBe(CAPABILITIES["kms:DescribeKey"].refreshMs)
    expect(readings.refreshMs.rotation).toBe(CAPABILITIES["kms:GetKeyRotationStatus"].refreshMs)
    if (readings.keys.state !== "ACTUAL") throw new Error("narrowing")
    for (const key of readings.keys.value) {
      expect(key.asOf).toBe("2026-08-13T09:15:00.000Z")
      expect(key.refreshMs).toBe(CAPABILITIES["kms:DescribeKey"].refreshMs)
    }
    expect(surfaceText(readings)).toContain("as of 2026-08-13T09:15:00.000Z")
  })
})
