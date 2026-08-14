import fs from "fs"
import path from "path"

import { SHARED } from "@tenure/provisioning"

import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  MAX_DETAIL_READS,
  MAX_LIST_PAGES,
  RECOVERY_WINDOW_MAX_DAYS,
  RECOVERY_WINDOW_MIN_DAYS,
  isoDate,
  parseRotationSchedule,
  projectEntry,
  secretLines,
  secretReadings,
  type SecretsReadings,
} from "./secrets"

/**
 * STUDIO-070-004 (Secrets Manager) — the secrets surface tells four different
 * truths apart, and answers the three questions the audit note asked.
 *
 * The assertions are on `secretReadings` and `secretLines`, the functions a
 * surface renders, rather than on `readAws` or on any parser. A test that drove
 * a private helper would stay green on the day this module stopped calling it,
 * which is precisely the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers four capabilities with the shapes the real SDK returns —
 * `{SecretList, NextToken}` with `Date` objects in the timestamp fields, exactly
 * as the SDK's deserialiser produces them; `{ReplicationStatus: […]}` from
 * DescribeSecret; `{ResourceTagMappingList: […]}` from the Tagging API;
 * `{Account, Arn}` from STS — and it can fail each of them independently with
 * `AccessDeniedException`, `ThrottlingException`, an empty-but-successful list,
 * or a populated one. A stand-in that returned `[]` regardless of what was asked
 * would prove nothing about the code that has to tell those four apart, and it
 * is the fake this repository has already been burnt by.
 *
 * The fixture entries also carry secret MATERIAL, because the real API shape has
 * fields for it and the one property this module must never lose is that none of
 * it reaches a surface.
 */

/* ------------------------------------------------------------- the estate -- */

/** Obviously constructed. Not a real AWS account, and never was. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"

const AT_ISO = "2026-08-13T09:15:00.000Z"
const AT = () => new Date(AT_ISO)
const AT_MS = Date.parse(AT_ISO)
const DAY_MS = 86_400_000

/** A `Date`, n days before the fixed clock — which is what the SDK hands back. */
function daysAgo(n: number): Date {
  return new Date(AT_MS - n * DAY_MS)
}

/**
 * A secret ARN. Assembled from its parts so the six-character suffix AWS appends
 * is visible as the thing it is: the reason this module refuses to synthesise an
 * ARN when the API did not return one.
 */
function secretArn(name: string, suffix: string, partition = "aws", region = REGION): string {
  return `arn:${partition}:secretsmanager:${region}:${ACCOUNT}:secret:${name}-${suffix}`
}

type Entry = Record<string, unknown>

/**
 * Material, in the shape the API has fields for.
 *
 * Present in every fixture entry. `ListSecrets` does not in fact return these —
 * that is the entire safety property — so a fixture that carried them proves the
 * module cannot surface material even when it is handed some.
 */
const MATERIAL = {
  SecretString: "pw-do-not-render-4bd91f2c",
  SecretBinary: "YmluYXJ5LWRvLW5vdC1yZW5kZXI=",
}

interface SecretFixture {
  entry: Entry
  /** The `DescribeSecret` answer for this secret, when it is allowed to answer. */
  detail?: Record<string, unknown>
  /** Raised instead of answering, so a per-secret failure can be exercised. */
  detailFailWith?: string
}

/**
 * The estate this suite reasons about: six secrets, each a different posture.
 *
 * `tenure/prod/nextauth` is the shape the 2026-08-13 audit left behind — a
 * shared secret with no rotation and a note in a handoff document saying it
 * "should be rotated afterwards". This suite is the assertion that the note
 * becomes a reading.
 */
function estate(): SecretFixture[] {
  return [
    {
      // Rotates every 30 days and rotated 5 days ago. Healthy.
      entry: {
        ...MATERIAL,
        ARN: secretArn("tenure/prod/database", "a1b2c3"),
        Name: "tenure/prod/database",
        KmsKeyId: `arn:aws:kms:${REGION}:${ACCOUNT}:key/11111111-2222-3333-4444-555555555555`,
        RotationEnabled: true,
        RotationLambdaARN: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:tenure-rotate-rds`,
        RotationRules: { AutomaticallyAfterDays: 30 },
        LastRotatedDate: daysAgo(5),
        LastChangedDate: daysAgo(5),
        LastAccessedDate: daysAgo(1),
        NextRotationDate: new Date(AT_MS + 25 * DAY_MS),
        CreatedDate: daysAgo(400),
        Tags: [{ Key: "tenure:tenant", Value: "simon-ose" }],
      },
      detail: { ReplicationStatus: [] },
    },
    {
      // No rotation at all, and untouched for 400 days. The audit's leftover.
      entry: {
        ...MATERIAL,
        ARN: secretArn("tenure/prod/nextauth", "d4e5f6"),
        Name: "tenure/prod/nextauth",
        RotationEnabled: false,
        LastChangedDate: daysAgo(400),
        LastAccessedDate: daysAgo(2),
        CreatedDate: daysAgo(400),
        Tags: [{ Key: "tenure:tenant", Value: SHARED }],
      },
      detail: { ReplicationStatus: [] },
    },
    {
      // Rotation configured for 30 days, last rotated 90 days ago, and AWS
      // returned no NextRotationDate. The interval sum is what catches it.
      entry: {
        ...MATERIAL,
        ARN: secretArn("tenure/prod/ses-smtp", "g7h8i9"),
        Name: "tenure/prod/ses-smtp",
        RotationEnabled: true,
        RotationRules: { ScheduleExpression: "rate(30 days)" },
        LastRotatedDate: daysAgo(90),
        LastChangedDate: daysAgo(90),
        LastAccessedDate: daysAgo(1),
        CreatedDate: daysAgo(500),
        Tags: [{ Key: "tenure:tenant", Value: SHARED }],
      },
      detail: { ReplicationStatus: [] },
    },
    {
      // Scheduled for deletion three days ago, recovery window still running.
      entry: {
        ...MATERIAL,
        ARN: secretArn("tenure/acme/api-key", "j1k2l3"),
        Name: "tenure/acme/api-key",
        RotationEnabled: false,
        DeletedDate: daysAgo(3),
        LastChangedDate: daysAgo(60),
        CreatedDate: daysAgo(300),
        Tags: [{ Key: "tenure:tenant", Value: "acme-university" }],
      },
      detail: { ReplicationStatus: [] },
    },
    {
      // Rotation switched on, never actually run. Not healthy, not overdue.
      entry: {
        ...MATERIAL,
        ARN: secretArn("tenure/prod/stripe", "m4n5o6"),
        Name: "tenure/prod/stripe",
        RotationEnabled: true,
        RotationRules: { AutomaticallyAfterDays: 90 },
        LastChangedDate: daysAgo(120),
        CreatedDate: daysAgo(120),
        Tags: [{ Key: "tenure:tenant", Value: SHARED }],
      },
      detail: { ReplicationStatus: [] },
    },
    {
      // Outside the `tenure/*` scope the registry grants DescribeSecret on, so
      // the detail call is refused. The EXPECTED per-row denial.
      entry: {
        ...MATERIAL,
        ARN: secretArn("ops/legacy-token", "p7q8r9"),
        Name: "ops/legacy-token",
        RotationEnabled: false,
        LastChangedDate: daysAgo(900),
        CreatedDate: daysAgo(900),
      },
      detailFailWith: "AccessDeniedException",
    },
  ]
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  /** How `secretsmanager:ListSecrets` behaves. The four cases this suite separates. */
  listSecrets?: Outcome
  secrets?: SecretFixture[]
  /** Entries per page, so pagination is exercised rather than assumed. */
  pageSize?: number
  /** Never stop handing back a NextToken, so the page bound is reached. */
  endlessPages?: boolean
  /** Which ARNs the Tagging API reports, and with which tags. */
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

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * `Date` objects where the SDK produces `Date` objects, and independently
 * failable per capability.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.listSecrets ?? "populated"
  const secrets = options.secrets ?? estate()
  const pageSize = options.pageSize ?? 100
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
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

        case "secretsmanager:ListSecrets": {
          if (listOutcome === "denied") throwing("AccessDeniedException")
          if (listOutcome === "throttled") throwing("ThrottlingException")
          // The real API OMITS SecretList entirely when there are none. It does
          // not return an empty array, and a fake that did would be testing a
          // response AWS never sends.
          if (listOutcome === "empty") return {}
          const token = (input as { NextToken?: unknown } | undefined)?.NextToken
          const start = typeof token === "string" ? Number(token) : 0
          const page = secrets.slice(start, start + pageSize).map((s) => s.entry)
          const next = start + pageSize
          if (options.endlessPages) {
            // Always another page, which is how the bound gets reached.
            return { SecretList: page, NextToken: String(next % Math.max(1, secrets.length)) }
          }
          return next < secrets.length
            ? { SecretList: page, NextToken: String(next) }
            : { SecretList: page }
        }

        case "secretsmanager:DescribeSecret": {
          const id = String((input as { SecretId?: unknown } | undefined)?.SecretId ?? "")
          const fixture = secrets.find((s) => s.entry.ARN === id || s.entry.Name === id)
          if (!fixture) throwing("ResourceNotFoundException")
          if (fixture.detailFailWith) throwing(fixture.detailFailWith)
          return { ...MATERIAL, ...fixture.entry, ...(fixture.detail ?? {}) }
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

async function load(options: FakeOptions = {}): Promise<SecretsReadings> {
  return secretReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: SecretsReadings): string {
  return secretLines(readings)
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

describe("the secrets surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every secret", async () => {
    const readings = await load()
    expect(readings.secrets.state).toBe("ACTUAL")
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.secrets.value).toHaveLength(6)
    const text = surfaceText(readings)
    expect(text).toContain("tenure/prod/nextauth")
    expect(text).toContain("ops/legacy-token")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ listSecrets: "empty" })
    expect(readings.secrets.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
  })

  test("an empty account is ASSESSED over nothing — never 'unknown', never a clean bill of health", async () => {
    // The distinction this whole module is about, one size down. EMPTY is only
    // produced after the call RESOLVED, so "there are no secrets" is a fact this
    // engine established; answering "unknown" to a question it can answer would
    // be the same collapse as rendering a denial as an absence.
    const readings = await load({ listSecrets: "empty" })
    expect(readings.posture.kind).toBe("assessed")
    if (readings.posture.kind !== "assessed") throw new Error("narrowing")
    expect(readings.posture.secretsAssessed).toBe(0)
    expect(readings.pagination.kind).toBe("no-secrets")

    const line = secretLines(readings).find((l) => l.label === "Rotation posture")
    expect(line?.text).toContain("no secrets exist in this account and region")
    expect(line?.text).not.toContain("unknown")
    // And NOT the sentence that reads as a clean bill of health for an estate
    // that has secrets.
    expect(line?.text).not.toContain("every secret that was read has rotation configured")

    // The denied surface must still be visibly different from this one.
    __resetIdentity()
    const denied = await load({ listSecrets: "denied" })
    expect(denied.posture.kind).toBe("unknown")
    expect(surfaceText(denied)).not.toBe(surfaceText(readings))
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listSecrets: "denied" })
    expect(readings.secrets.state).toBe("DENIED")
    if (readings.secrets.state !== "DENIED") throw new Error("narrowing")

    expect(readings.secrets.action).toBe("secretsmanager:ListSecrets")
    expect(readings.secrets.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.secrets.accountId).toBe(ACCOUNT)
    expect(readings.secrets.region).toBe(REGION)
    expect(readings.secrets.partition).toBe("aws")
    expect(JSON.parse(readings.secrets.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["secretsmanager:ListSecrets"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.secrets).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ listSecrets: "throttled" })
    expect(readings.secrets.state).toBe("THROTTLED")
    if (readings.secrets.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.secrets.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ listSecrets: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that
    // notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })

  test("a refused listing makes the posture unknown, never 'every secret rotates'", async () => {
    const readings = await load({ listSecrets: "denied" })
    expect(readings.posture.kind).toBe("unknown")
    const line = secretLines(readings).find((l) => l.label === "Rotation posture")
    expect(line?.text).toContain("unknown")
    expect(line?.text).toContain("secretsmanager:ListSecrets")
    expect(line?.text).not.toContain("every secret that was read has rotation configured")
    expect(line?.text).not.toContain("none that were read is past its rotation interval")
  })
})

/* ------------------------------------------- the three operational questions -- */

describe("the three questions the audit note asked", () => {
  test("which secrets have no rotation — named, with how long they have sat", async () => {
    const readings = await load()
    expect(readings.posture.kind).toBe("assessed")
    if (readings.posture.kind !== "assessed") throw new Error("narrowing")

    expect(readings.posture.noRotation.map((s) => s.name)).toEqual([
      "ops/legacy-token",
      "tenure/acme/api-key",
      "tenure/prod/nextauth",
    ])
    const nextauth = readings.posture.noRotation.find((s) => s.name === "tenure/prod/nextauth")
    expect(nextauth?.ageSinceChangeMs).toBe(400 * DAY_MS)
    // The audit's leftover is a SHARED secret and the surface says so, so
    // "whose is it" does not become the reason nothing happens.
    expect(nextauth?.attribution.kind).toBe("shared")

    const line = secretLines(readings).find((l) => l.label === "Rotation posture")
    expect(line?.text).toContain("NO ROTATION on 3")
    expect(line?.text).toContain("tenure/prod/nextauth (unchanged for 400 day(s))")
  })

  test("which are older than their rotation interval — from the interval, not from a guess", async () => {
    const readings = await load()
    if (readings.posture.kind !== "assessed") throw new Error("narrowing")

    expect(readings.posture.overdue.map((s) => s.name)).toEqual(["tenure/prod/ses-smtp"])
    const overdue = readings.posture.overdue[0]
    // Rotated 90 days ago on a rate(30 days) schedule: 60 days past due.
    expect(overdue.overdueByMs).toBe(60 * DAY_MS)
    expect(overdue.dueAt).toBe(new Date(AT_MS - 60 * DAY_MS).toISOString())
    expect(overdue.basis).toContain("rate(30 days)")

    const line = secretLines(readings).find((l) => l.label === "Rotation posture")
    expect(line?.text).toContain("OVERDUE 1: tenure/prod/ses-smtp by 60 day(s)")
    // And the healthy one is NOT in it.
    expect(line?.text).not.toContain("tenure/prod/database by")
  })

  test("AWS's own NextRotationDate decides when it gave one, and a healthy secret is within interval", async () => {
    const readings = await load()
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const db = readings.secrets.value.find((s) => s.name === "tenure/prod/database")
    expect(db?.age.kind).toBe("within-interval")
    if (db?.age.kind !== "within-interval") throw new Error("narrowing")
    expect(db.age.basis).toContain("NextRotationDate")
    expect(db.age.dueAt).toBe(new Date(AT_MS + 25 * DAY_MS).toISOString())
  })

  test("which are scheduled for deletion, with the recovery window still running", async () => {
    const readings = await load()
    if (readings.posture.kind !== "assessed") throw new Error("narrowing")

    expect(readings.posture.pendingDeletion.map((s) => s.name)).toEqual(["tenure/acme/api-key"])
    const pending = readings.posture.pendingDeletion[0]
    expect(pending.deletionRequestedAt).toBe(new Date(AT_MS - 3 * DAY_MS).toISOString())
    expect(pending.elapsedMs).toBe(3 * DAY_MS)
    // A BOUND, not a date. RecoveryWindowInDays is not returned by any read this
    // engine holds, so a single date here would be an invention.
    expect(pending.earliestPermanentAt).toBe(
      new Date(AT_MS - 3 * DAY_MS + RECOVERY_WINDOW_MIN_DAYS * DAY_MS).toISOString(),
    )
    expect(pending.latestPermanentAt).toBe(
      new Date(AT_MS - 3 * DAY_MS + RECOVERY_WINDOW_MAX_DAYS * DAY_MS).toISOString(),
    )

    const row = secretLines(readings).find((l) => l.label === "tenure/acme/api-key")
    expect(row?.text).toContain("SCHEDULED FOR DELETION")
    expect(row?.text).toContain("Recoverable now")
    expect(row?.text).toContain("RecoveryWindowInDays is not returned by any read")
  })

  test("a rotation that has never run is undetermined, never counted as healthy", async () => {
    const readings = await load()
    if (readings.posture.kind !== "assessed") throw new Error("narrowing")
    expect(readings.posture.undetermined).toContain("tenure/prod/stripe")
    // And it is NOT in the overdue list, because "never ran" and "60 days late"
    // are different findings with different remedies.
    expect(readings.posture.overdue.map((s) => s.name)).not.toContain("tenure/prod/stripe")

    const row = secretLines(readings).find((l) => l.label === "tenure/prod/stripe")
    expect(row?.text).toContain("NEVER ROTATED")
    expect(row?.text).toContain("has never actually run")

    const line = secretLines(readings).find((l) => l.label === "Rotation posture")
    expect(line?.text).toContain("UNDETERMINED")
    expect(line?.text).toContain("not the same as their being current")
  })

  test("a cron() schedule is not converted into an interval and does not become 'fine'", async () => {
    const secrets: SecretFixture[] = [
      {
        entry: {
          ...MATERIAL,
          ARN: secretArn("tenure/prod/cronned", "s1t2u3"),
          Name: "tenure/prod/cronned",
          RotationEnabled: true,
          RotationRules: { ScheduleExpression: "cron(0 8 1 * ? *)" },
          LastRotatedDate: daysAgo(900),
          LastChangedDate: daysAgo(900),
          CreatedDate: daysAgo(900),
          Tags: [],
        },
        detail: { ReplicationStatus: [] },
      },
    ]
    const readings = await load({ secrets })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.secrets.value[0].age.kind).toBe("undetermined")
    const row = secretLines(readings).find((l) => l.label === "tenure/prod/cronned")
    expect(row?.text).toContain("cron(0 8 1 * ? *)")
    expect(row?.text).toContain("age undetermined")
    // Rotated 900 days ago and the surface still refuses to call it overdue,
    // because nothing here knows what interval the cron expression means.
    expect(row?.text).not.toContain("OVERDUE")
  })

  test("parseRotationSchedule keeps interval, rate, cron, absent and unreadable apart", () => {
    expect(parseRotationSchedule({ AutomaticallyAfterDays: 30 })).toEqual({
      kind: "interval-days",
      days: 30,
      intervalMs: 30 * DAY_MS,
      source: "RotationRules.AutomaticallyAfterDays",
    })
    expect(parseRotationSchedule({ ScheduleExpression: "rate(12 hours)" })).toMatchObject({
      kind: "rate",
      intervalMs: 12 * 3_600_000,
    })
    expect(parseRotationSchedule({ ScheduleExpression: "cron(0 8 1 * ? *)" }).kind).toBe("cron")
    expect(parseRotationSchedule(undefined).kind).toBe("none")
    expect(parseRotationSchedule({ ScheduleExpression: "every other tuesday" }).kind).toBe(
      "unreadable",
    )
  })
})

/* ------------------------------------------ per-secret detail degrades alone -- */

describe("a denied detail degrades one row and nothing else", () => {
  test("the row survives, keeps its rotation posture, and names DescribeSecret", async () => {
    const readings = await load()
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")

    const legacy = readings.secrets.value.find((s) => s.name === "ops/legacy-token")
    expect(legacy).toBeDefined()
    expect(legacy?.detail.state).toBe("DENIED")
    if (legacy?.detail.state !== "DENIED") throw new Error("narrowing")

    // The whole reason the two capabilities are read separately: granting
    // ListSecrets would not have fixed this, and a denial naming it would send
    // an operator to grant an action they already hold.
    expect(legacy.detail.action).toBe("secretsmanager:DescribeSecret")
    expect(legacy.detail.minimumStatement).toContain("secretsmanager:DescribeSecret")
    expect(legacy.detail.minimumStatement).not.toContain("secretsmanager:ListSecrets")
    // And the registry's scope is in the statement, which is WHY it was refused.
    expect(legacy.detail.minimumStatement).toContain("secret:tenure/*")

    // The row did not collapse: rotation still came off the listing.
    expect(legacy.rotation.kind).toBe("not-configured")
    expect(legacy.lastChangedAt).toBe(new Date(AT_MS - 900 * DAY_MS).toISOString())

    const row = secretLines(readings).find((l) => l.label === "ops/legacy-token")
    expect(row?.text).toContain("refused secretsmanager:DescribeSecret")
    expect(row?.text).toContain("NO ROTATION")
    // The reassuring default it must not be.
    expect(row?.text).not.toContain("not replicated to any other region")

    // Every OTHER row still answered.
    const db = readings.secrets.value.find((s) => s.name === "tenure/prod/database")
    expect(db?.detail.state).toBe("ACTUAL")
    // And the whole read is still ACTUAL — one refused detail is not an outage.
    expect(readings.secrets.state).toBe("ACTUAL")
  })

  test("a throttled detail is throttled, not 'no replicas'", async () => {
    const secrets = estate()
    secrets[0] = { ...secrets[0], detail: undefined, detailFailWith: "ThrottlingException" }
    const readings = await load({ secrets })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const db = readings.secrets.value.find((s) => s.name === "tenure/prod/database")
    expect(db?.detail.state).toBe("THROTTLED")
    const row = secretLines(readings).find((l) => l.label === "tenure/prod/database")
    expect(row?.text).toContain("throttled")
    expect(row?.text).not.toContain("not replicated to any other region")
  })

  test("replication is reported when it answers — a residency fact, not a nicety", async () => {
    const secrets = estate()
    secrets[0] = {
      ...secrets[0],
      detail: {
        PrimaryRegion: REGION,
        ReplicationStatus: [
          { Region: "us-east-1", Status: "InSync", KmsKeyId: "alias/aws/secretsmanager" },
          { Region: "ap-south-1", Status: "Failed", StatusMessage: "KMS key not found" },
        ],
      },
    }
    const readings = await load({ secrets })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const db = readings.secrets.value.find((s) => s.name === "tenure/prod/database")
    if (db?.detail.state !== "ACTUAL") throw new Error("narrowing")
    // Sorted, so two loads of the same estate produce the same string.
    expect(db.detail.value.replicas.map((r) => r.region)).toEqual(["ap-south-1", "us-east-1"])
    const row = secretLines(readings).find((l) => l.label === "tenure/prod/database")
    expect(row?.text).toContain("replicated to ap-south-1 (Failed), us-east-1 (InSync)")
  })

  test("secrets past the detail cap say they were not read, not that they have no replicas", async () => {
    const many: SecretFixture[] = []
    for (let i = 0; i < MAX_DETAIL_READS + 3; i += 1) {
      const name = `tenure/bulk/${String(i).padStart(4, "0")}`
      many.push({
        entry: {
          ...MATERIAL,
          ARN: secretArn(name, "z9y8x7"),
          Name: name,
          RotationEnabled: true,
          RotationRules: { AutomaticallyAfterDays: 30 },
          LastRotatedDate: daysAgo(1),
          LastChangedDate: daysAgo(1),
          CreatedDate: daysAgo(10),
          Tags: [],
        },
        detail: { ReplicationStatus: [] },
      })
    }
    const readings = await load({ secrets: many, pageSize: 1000 })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.secrets.value).toHaveLength(MAX_DETAIL_READS + 3)
    const last = readings.secrets.value[readings.secrets.value.length - 1]
    expect(last.detail.state).toBe("UNCONFIGURED")
    if (last.detail.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(last.detail.why).toContain("not the same as its having no replicas")
  })
})

/* ----------------------------------------------------------- the page bound -- */

describe("pagination is walked to completion, bounded, and says when it stopped", () => {
  test("several pages are walked and the coverage says the listing is whole", async () => {
    const calls: string[] = []
    const readings = await load({ pageSize: 2, calls })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.secrets.value).toHaveLength(6)
    // Six secrets at two per page is three pages, not one. A reader that
    // returned the first page would have found two.
    expect(calls.filter((c) => c === "secretsmanager:ListSecrets")).toHaveLength(3)
    expect(readings.pagination).toEqual({ kind: "complete", pages: 3, secrets: 6 })
    expect(surfaceText(readings)).toContain("6 secret(s) read over 3 page(s) — the whole listing")
  })

  test("hitting the bound is an explicit 'there were more', not a silent first page", async () => {
    const readings = await load({ pageSize: 2, endlessPages: true })
    expect(readings.pagination.kind).toBe("truncated")
    if (readings.pagination.kind !== "truncated") throw new Error("narrowing")
    expect(readings.pagination.pages).toBe(MAX_LIST_PAGES)
    expect(readings.pagination.why).toContain("still had pages")

    const text = surfaceText(readings)
    expect(text).toContain("PARTIAL")
    // And the qualifier travels with the counts, so "3 have no rotation" is not
    // read as a fact about the account.
    const line = secretLines(readings).find((l) => l.label === "Rotation posture")
    expect(line?.text).toContain("PARTIAL")
  })

  test("the secrets are ordered by name, so two loads of one estate produce one string", async () => {
    const forward = await load()
    __resetIdentity()
    const reversed = await load({ secrets: [...estate()].reverse() })
    expect(surfaceText(forward)).toBe(surfaceText(reversed))
  })
})

/* ------------------------------------------------------ residency and tags -- */

describe("region and partition come from the resolved identity and from AWS's ARNs", () => {
  test("a GovCloud estate produces GovCloud rows and no us-east-1 anywhere", async () => {
    // The GE-010-007 shape: a hardcoded us-east-1 or a partition guessed as
    // "aws" would place these secrets in the wrong partition on a page an
    // operator uses to decide where material lives.
    const name = "tenure/gov/database"
    const secrets: SecretFixture[] = [
      {
        entry: {
          ...MATERIAL,
          ARN: secretArn(name, "v1w2x3", "aws-us-gov", "us-gov-west-1"),
          Name: name,
          RotationEnabled: true,
          RotationRules: { AutomaticallyAfterDays: 30 },
          LastRotatedDate: daysAgo(1),
          LastChangedDate: daysAgo(1),
          CreatedDate: daysAgo(30),
          Tags: [],
        },
        detail: { ReplicationStatus: [] },
      },
    ]
    const readings = await load({
      secrets,
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
    })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const secret = readings.secrets.value[0]
    expect(secret.partition).toBe("aws-us-gov")
    expect(secret.region).toBe("us-gov-west-1")
    expect(secret.accountId).toBe(ACCOUNT)
    expect(surfaceText(readings)).not.toContain("us-east-1")
  })

  test("with no ARN from AWS, no ARN is invented and the row says why", async () => {
    // A secret ARN carries a six-character suffix AWS generates, so an assembled
    // one resolves to nothing. The row falls back to the resolved identity for
    // where it is, and says the ARN is absent.
    const secrets: SecretFixture[] = [
      {
        entry: {
          ...MATERIAL,
          Name: "tenure/prod/nameless",
          RotationEnabled: false,
          LastChangedDate: daysAgo(10),
          CreatedDate: daysAgo(10),
          Tags: [],
        },
        detail: { ReplicationStatus: [] },
      },
    ]
    const readings = await load({ secrets })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const secret = readings.secrets.value[0]
    expect(secret.arn).toBeNull()
    expect(secret.arnProvenance).toContain("will not assemble one")
    // Region still comes from the resolved identity rather than from nowhere.
    expect(secret.region).toBe(REGION)
    expect(secret.partition).toBe("aws")
  })

  test("with identity unresolved and no ARN, the row refuses to place itself", async () => {
    const secrets: SecretFixture[] = [
      {
        entry: {
          ...MATERIAL,
          Name: "tenure/prod/nameless",
          RotationEnabled: false,
          LastChangedDate: daysAgo(10),
          CreatedDate: daysAgo(10),
        },
        detail: { ReplicationStatus: [] },
      },
    ]
    const readings = await load({ secrets, identity: "denied", tagsOutcome: "denied" })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const secret = readings.secrets.value[0]
    expect(secret.region).toBeNull()
    expect(secret.partition).toBeNull()
    expect(secret.attribution.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("region unknown")
  })
})

describe("attribution comes from a tag, and 'we could not look' is its own answer", () => {
  test("the Resource Groups Tagging API index is used first", async () => {
    const arn = secretArn("tenure/prod/database", "a1b2c3")
    const readings = await load({
      tags: { [arn]: [{ Key: "tenure:tenant", Value: "from-the-index" }] },
    })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const db = readings.secrets.value.find((s) => s.name === "tenure/prod/database")
    expect(db?.attribution).toEqual({
      kind: "tenant",
      tenantSlug: "from-the-index",
      source: "the Resource Groups Tagging API index",
    })
    // The secret's own Tags say `simon-ose`; the index won, and the surface says
    // which source answered so the two can be reconciled.
    expect(surfaceText(readings)).toContain("from-the-index (from the Resource Groups Tagging API index)")
  })

  test("the shared sentinel is shared, and an untagged secret is unattributable — not the same", async () => {
    const readings = await load()
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const shared = readings.secrets.value.find((s) => s.name === "tenure/prod/nextauth")
    const untagged = readings.secrets.value.find((s) => s.name === "ops/legacy-token")
    expect(shared?.attribution.kind).toBe("shared")
    expect(untagged?.attribution.kind).toBe("unattributed")
    const text = surfaceText(readings)
    expect(text).toContain("shared — platform overhead, decided")
    expect(text).toContain("unattributable — missing tenure:tenant")
  })

  test("a denied tag index falls back to the secret's own Tags, and says it did", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const db = readings.secrets.value.find((s) => s.name === "tenure/prod/database")
    expect(db?.attribution.kind).toBe("tenant")
    if (db?.attribution.kind !== "tenant") throw new Error("narrowing")
    expect(db.attribution.tenantSlug).toBe("simon-ose")
    expect(db.attribution.source).toContain("the secret's own Tags")
    expect(db.attribution.source).toContain("tag:GetResources")
  })

  test("a denied index and no tags at all is unknown, never unattributable", async () => {
    // The distinction that matters: "missing tenure:tenant" sends an operator to
    // add a tag that is probably already there.
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const legacy = readings.secrets.value.find((s) => s.name === "ops/legacy-token")
    expect(legacy?.attribution.kind).toBe("unknown")
    const row = secretLines(readings).find((l) => l.label === "ops/legacy-token")
    expect(row?.text).toContain("attribution unknown")
    expect(row?.text).toContain("tag:GetResources")
    expect(row?.text).not.toContain("missing tenure:tenant")
  })

  test("a throttled tag index is also unknown for an untagged secret, and says throttled", async () => {
    const readings = await load({ tagsOutcome: "throttled" })
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const legacy = readings.secrets.value.find((s) => s.name === "ops/legacy-token")
    expect(legacy?.attribution.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("throttled")
  })
})

/* ------------------------------------------------------ as-of and cadence -- */

describe("every reading carries when it was taken and how often it refreshes", () => {
  test("the load stamps an explicit asOf and both capabilities' own cadences", async () => {
    const readings = await load()
    expect(readings.asOf).toBe(AT_ISO)
    // Not numbers retyped here: these are the registry's declarations, so a
    // cadence changed in capabilities.ts changes what the surface promises.
    expect(readings.refreshMs.inventory).toBe(600_000)
    expect(readings.refreshMs.detail).toBe(30_000)
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    for (const secret of readings.secrets.value) {
      expect(secret.asOf).toBe(AT_ISO)
      expect(secret.refreshMs).toBe(30_000)
    }
    const text = surfaceText(readings)
    expect(text).toContain("refreshed every 600s")
    expect(text).toContain("refreshed every 30s")
    expect(text).toContain(`as of ${AT_ISO}`)
  })

  test("the AWS-managed key omission is reported as the fact it is, not as a gap", async () => {
    const readings = await load()
    if (readings.secrets.state !== "ACTUAL") throw new Error("narrowing")
    const nextauth = readings.secrets.value.find((s) => s.name === "tenure/prod/nextauth")
    expect(nextauth?.encryption.kind).toBe("aws-managed")
    const db = readings.secrets.value.find((s) => s.name === "tenure/prod/database")
    expect(db?.encryption.kind).toBe("customer-managed")
    const text = surfaceText(readings)
    expect(text).toContain("encrypted under the AWS-managed aws/secretsmanager key")
    expect(text).toContain("key/11111111-2222-3333-4444-555555555555")
  })

  test("isoDate refuses to coerce a non-date into a timestamp", () => {
    expect(isoDate(new Date(AT_MS))).toBe(AT_ISO)
    expect(isoDate(AT_ISO)).toBe(AT_ISO)
    expect(isoDate(undefined)).toBeNull()
    expect(isoDate({})).toBeNull()
    expect(isoDate("not a date")).toBeNull()
    expect(isoDate(new Date("not a date"))).toBeNull()
  })
})

/* ------------------------------------------------- it cannot read a value -- */

describe("this module cannot read a secret's value and cannot grow the ability to", () => {
  /**
   * The forbidden command's name, assembled rather than written.
   *
   * `secret-refs.test.ts` fails the build if the literal appears in CODE
   * anywhere under `apps/system-studio/src` — string literals included, comments
   * stripped — and it exempts only itself. Writing it out here would make this
   * file the offender and get the guard's own assertion deleted, which is the
   * opposite of what it wants.
   */
  const FORBIDDEN = ["Get", "Secret", "Value"].join("")
  const MODULE = path.join(__dirname, "secrets.ts")

  test("the value-returning command's name appears nowhere in this module", () => {
    const source = fs.readFileSync(MODULE, "utf8")
    expect(source).not.toContain(FORBIDDEN)
    expect(source).not.toContain(`${FORBIDDEN}Command`)
  })

  test("the module imports no AWS SDK package at all", () => {
    const source = fs.readFileSync(MODULE, "utf8")
    // Every AWS call goes through the one gateway in client.ts. A second client
    // built here would pick its own region and credential chain, which is the
    // GE-010-007 shape and what forbidden-clients.test.mjs exists to stop.
    expect(source).not.toMatch(/from\s+["']@aws-sdk\//)
    expect(source).not.toMatch(/require\(\s*["']@aws-sdk\//)
  })

  test("it calls exactly four capabilities and no others", async () => {
    const calls: string[] = []
    await load({ calls })
    expect(new Set(calls)).toEqual(
      new Set([
        "sts:GetCallerIdentity",
        "tag:GetResources",
        "secretsmanager:ListSecrets",
        "secretsmanager:DescribeSecret",
      ]),
    )
  })

  test("the projection out of an API response carries only named metadata fields", () => {
    /*
     * A direct assertion on a function `secretReadings` calls for every entry of
     * every page, and it is here for a reason worth writing down: replacing
     * `projectEntry` with a spread of the raw response was applied as a mutation
     * and the surface-level test below stayed GREEN, because no raw entry
     * reaches a reading today. A layer whose removal nothing notices is a guard
     * that cannot fail, which is the exact defect this programme has shipped
     * five times. So the layer is asserted where it is visible.
     */
    const projected = projectEntry({
      ...MATERIAL,
      ARN: secretArn("tenure/prod/database", "a1b2c3"),
      Name: "tenure/prod/database",
      RotationEnabled: true,
      RotationRules: { AutomaticallyAfterDays: 30, Nonsense: "dropped" },
      Tags: [{ Key: "tenure:tenant", Value: "simon-ose" }],
    } as unknown as Parameters<typeof projectEntry>[0])

    const keys = Object.keys(projected)
    expect(keys).not.toContain("SecretString")
    expect(keys).not.toContain("SecretBinary")
    expect(JSON.stringify(projected)).not.toContain(MATERIAL.SecretString)
    expect(JSON.stringify(projected)).not.toContain(MATERIAL.SecretBinary)
    // Unknown fields on a nested shape are dropped too, not carried along.
    expect(Object.keys(projected.RotationRules ?? {})).toEqual([
      "AutomaticallyAfterDays",
      "Duration",
      "ScheduleExpression",
    ])
    // And it kept everything the module actually needs.
    expect(projected.Name).toBe("tenure/prod/database")
    expect(projected.RotationEnabled).toBe(true)
    expect(projected.Tags).toEqual([{ Key: "tenure:tenant", Value: "simon-ose" }])
  })

  test("material in an API response reaches no reading and no rendered line", async () => {
    // The fixtures hand the stand-in fields the real ListSecrets does not
    // return. If any of it reached a surface, this is where it would show.
    const readings = await load()
    const serialised = JSON.stringify(readings)
    expect(serialised).not.toContain(MATERIAL.SecretString)
    expect(serialised).not.toContain(MATERIAL.SecretBinary)
    expect(serialised).not.toContain("SecretString")
    expect(serialised).not.toContain("SecretBinary")

    const text = surfaceText(readings)
    expect(text).not.toContain(MATERIAL.SecretString)
    expect(text).not.toContain(MATERIAL.SecretBinary)
    // And the readings are not empty, so the assertions above are about a
    // populated surface rather than about nothing.
    expect(text.length).toBeGreaterThan(500)
  })
})
