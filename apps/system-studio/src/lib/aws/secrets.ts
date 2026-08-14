/**
 * STUDIO-070-004 (Secrets Manager) — which secrets exist, whether any of them
 * rotates, which are past due, and which are sitting in a recovery window
 * waiting to become unrecoverable.
 *
 * The service was dark. `secret-refs.ts` calls `secretsmanager:DescribeSecret`
 * for ONE named reference on the provisioning path — "does `tenure/acme/db`
 * resolve" — and that is the only Secrets Manager call the running product has
 * ever made. Nothing enumerated. So the console could confirm a reference it was
 * handed and could not answer the question an operator actually asks, which is
 * *"is anything in here rotting"*. The 2026-08-13 audit ends with a shared secret
 * left in Secrets Manager and a sentence saying it "should be rotated
 * afterwards"; a note in a handoff document is not a control, and this module is
 * how that sentence becomes a reading somebody can be shown.
 *
 * ## It cannot read a value, structurally, and that is the whole safety argument
 *
 * This module names exactly two capabilities, `secretsmanager:ListSecrets` and
 * `secretsmanager:DescribeSecret`, both metadata calls. The command that returns
 * a secret's material is not imported here, is not imported by `client.ts`, is
 * absent from `capabilities.ts`, and `client.ts`'s `call()` switches on the
 * capability so there is no way to express "send this arbitrary command"
 * regardless. `secret-refs.test.ts` fails the build if that command's NAME
 * appears in code anywhere under `apps/system-studio/src`, and
 * `secrets.test.ts` asserts the same property over this file specifically.
 *
 * Belt and braces beyond that: the projection out of the API response is a
 * WHITELIST. Every field this module reads is named at `projectEntry`, so a
 * response that carried material would have to be deliberately read to leak.
 *
 * That layer is tested TWICE and deliberately so, because the first test alone
 * does not see it. `secrets.test.ts` feeds the stand-in responses carrying
 * `SecretString` and `SecretBinary` and asserts nothing downstream contains
 * them — but that passes with the whitelist removed, since the raw entries never
 * escape `secretReadings` today anyway. Replacing the projection with a spread
 * was applied as a mutation and the surface tests stayed green, which is the
 * definition of a guard nobody would notice going off. So `projectEntry` is
 * exported and asserted directly: it is on the production path (every entry
 * passes through it) and it is the layer that survives a future change which
 * starts carrying an entry onto a reading.
 *
 * ## Two capabilities, two readings, on purpose
 *
 * `ListSecrets` and `DescribeSecret` are separate IAM actions, and in this
 * estate they are separately SCOPED: the registry grants `ListSecrets` on `*`
 * (the API enumerates, so it has no ARN to scope to) and `DescribeSecret` only
 * on `arn:*:secretsmanager:*:*:secret:tenure/*`. A role holding both will
 * therefore be refused the per-secret call on any secret outside that namespace.
 * That refusal is a real, expected, per-row fact and it must render as one: the
 * row stays, carrying DENIED with `secretsmanager:DescribeSecret` and the
 * statement that would widen the scope. Folding the detail into the listing
 * would make it render as "refused secretsmanager:ListSecrets", so the statement
 * an operator pastes would not contain the action that is actually missing —
 * `retained.ts` paid for that lesson with `backup:ListBackupVaults`.
 *
 * ## What the detail read adds, said plainly
 *
 * `ListSecrets` already returns rotation state, the schedule, every timestamp,
 * the KMS key and `DeletedDate`. `DescribeSecret` adds `ReplicationStatus` —
 * which regions this secret has been COPIED to — and that is a residency fact
 * about material, not a nicety: a secret replicated into a region a tenant's
 * residency does not permit is the GE-010-007 shape of defect wearing different
 * clothes. It is read per secret, bounded, and it degrades on its own. A row
 * whose detail was refused still reports its rotation posture from the listing,
 * because one denied sub-call must not collapse the row.
 *
 * ## What this module cannot know, said out loud
 *
 * **The length of a deletion recovery window is not returned by any read.**
 * `RecoveryWindowInDays` is an argument to `DeleteSecret`; `ListSecrets` and
 * `DescribeSecret` return only `DeletedDate`, the moment deletion was requested.
 * So the exact date a scheduled secret becomes unrecoverable is not knowable
 * from here, and this module refuses to print one. It reports the documented
 * BOUND — AWS accepts 7 to 30 days — labelled as a bound, plus the fact that
 * carries the actual information: the secret is still being listed, and a secret
 * whose window has closed is gone rather than listed, so the window is still
 * running as of this reading.
 *
 * **A `cron()` rotation schedule is not converted into an interval.** A cron
 * expression can mean "the first Monday of every third month", and turning that
 * into a number of days requires evaluating a schedule this module has no
 * business evaluating. `RotationSchedule` has a `cron` arm that carries the
 * expression and says the interval is not computed, and the overdue verdict for
 * such a secret leans on AWS's own `NextRotationDate` or says it cannot decide.
 * A guessed interval is how a secret gets reported as overdue on a schedule
 * nobody set.
 *
 * ## Region and partition
 *
 * From the ARN AWS returned for each secret, and otherwise from the resolved
 * identity — `sts:GetCallerIdentity` for the account and partition, the SDK's own
 * resolved region for the region. There is no region literal in this file and no
 * `"aws"` fallback anywhere in it.
 */

import { CAPABILITIES } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type TaggedResource } from "./tags"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/* ---------------------------------------------------------------- limits -- */

/**
 * How many `ListSecrets` pages to walk before stopping.
 *
 * `client.ts` asks for `MaxResults: 100`, so this is two thousand secrets. A
 * page loop with no bound is how one agent takes down a server render with a
 * person waiting; a reader that silently returns the first page is the same lie
 * as an empty list. So it is bounded AND the bound is REPORTED — `PaginationBound`
 * carries a `truncated` arm and every derived count is qualified by it.
 */
export const MAX_LIST_PAGES = 20

/**
 * How many secrets get a `DescribeSecret` in one load.
 *
 * One call per secret against an account-wide throttle. Secrets past the cap are
 * NOT dropped and do NOT render as "no replicas": they carry an UNCONFIGURED
 * detail whose `why` says the engine stopped looking, which is a different
 * sentence from "this secret is not replicated anywhere".
 */
export const MAX_DETAIL_READS = 200

/** How many detail reads are in flight at once, so one load is not a burst. */
const DETAIL_CONCURRENCY = 8

/**
 * The window AWS's `DeleteSecret` accepts for `RecoveryWindowInDays`.
 *
 * A documented API constraint, not an observation about this estate, and it is
 * used only to state a BOUND on when a scheduled secret becomes unrecoverable.
 * The actual value is not returned by any read this engine holds — see the
 * module header — so a single date here would be an invention.
 */
export const RECOVERY_WINDOW_MIN_DAYS = 7
export const RECOVERY_WINDOW_MAX_DAYS = 30

const MS_PER_DAY = 86_400_000
const MS_PER_HOUR = 3_600_000

/* ---------------------------------------------------------------- shapes -- */

/**
 * The API's shapes, declared rather than imported — `client.ts` is the one owner
 * of an SDK package and `forbidden-clients.test.mjs` enforces it.
 *
 * Dates arrive as `Date` from the SDK's deserialiser. They are typed as
 * `unknown` here rather than as `Date`, because the one thing worse than a
 * missing timestamp is a timestamp this module invented by coercing something
 * that was not one — see `isoDate`.
 */
export interface RotationRules {
  AutomaticallyAfterDays?: number
  Duration?: string
  ScheduleExpression?: string
}

export interface SecretListEntry {
  ARN?: string
  Name?: string
  Description?: string
  KmsKeyId?: string
  RotationEnabled?: boolean
  RotationLambdaARN?: string
  RotationRules?: RotationRules
  LastRotatedDate?: unknown
  LastChangedDate?: unknown
  LastAccessedDate?: unknown
  DeletedDate?: unknown
  NextRotationDate?: unknown
  Tags?: Array<{ Key?: string; Value?: string }>
  OwningService?: string
  CreatedDate?: unknown
  PrimaryRegion?: string
}

interface ListSecretsResponse {
  SecretList?: SecretListEntry[]
  NextToken?: string
}

interface DescribeSecretResponse extends SecretListEntry {
  ReplicationStatus?: Array<{
    Region?: string
    KmsKeyId?: string
    Status?: string
    StatusMessage?: string
    LastAccessedDate?: unknown
  }>
}

/* ------------------------------------------------------------ the shapes -- */

/**
 * How far the listing got.
 *
 * `truncated` is not an error and is not a failure: it is the reader saying "the
 * estate is bigger than the bound I am allowed to spend". Every count derived
 * from a truncated listing is qualified with it, because "3 secrets have no
 * rotation" read off the first two thousand of five thousand is a number that
 * means nothing.
 */
export type PaginationBound =
  | { kind: "complete"; pages: number; secrets: number }
  | { kind: "truncated"; pages: number; secrets: number; why: string }
  /**
   * The listing was read and there are genuinely no secrets. Separate from
   * `complete` with a count of zero because the page count is not recoverable
   * from an EMPTY reading — `readAws` drops the value on that arm — and stating
   * a number this engine did not observe is the habit this module is against.
   */
  | { kind: "no-secrets"; why: string }
  /** The listing itself was not read, so nothing can be said about its extent. */
  | { kind: "unknown"; why: string }

/**
 * What encrypts a secret.
 *
 * Secrets Manager OMITS `KmsKeyId` when the secret is encrypted under the
 * account's AWS-managed `aws/secretsmanager` key. That omission is documented
 * and unambiguous, so it is reported as the fact it is rather than as `null` —
 * a null would read as "we do not know what encrypts this", which is a different
 * and much more alarming sentence.
 */
export type SecretEncryption =
  | { kind: "customer-managed"; kmsKeyId: string }
  | { kind: "aws-managed"; why: string }

/**
 * A rotation schedule, as far as this engine will commit to reading one.
 *
 * `cron` deliberately does not carry an interval. See the module header: a cron
 * expression is a schedule, not a period, and a guessed period is how a secret
 * gets reported overdue against a cadence nobody configured.
 */
export type RotationSchedule =
  | { kind: "interval-days"; days: number; intervalMs: number; source: string }
  | { kind: "rate"; expression: string; intervalMs: number; source: string }
  | { kind: "cron"; expression: string; why: string }
  /** Rotation is on and AWS returned no rules at all. Itself a finding. */
  | { kind: "none"; why: string }
  | { kind: "unreadable"; expression: string; why: string }

/**
 * Whether rotation is configured at all — the first of the three operational
 * questions this module exists to answer.
 */
export type RotationPosture =
  | { kind: "not-configured"; why: string }
  | {
      kind: "configured"
      schedule: RotationSchedule
      /** The function AWS calls to do it, or null when rotation is service-managed. */
      rotationLambdaArn: string | null
      /** AWS's own answer for when the next rotation is due, when it gave one. */
      nextRotationAt: string | null
    }

/**
 * Whether a secret is past due — the second question.
 *
 * `never-rotated` is separate from `overdue` because they are separate findings
 * with separate remedies, and separate again from `no-interval`, which is what a
 * secret with rotation switched off gets. Reporting a never-rotated secret as
 * "0 days overdue" would be a number where a sentence belongs.
 */
export type RotationAge =
  /** Rotation is configured, an interval is known, and the secret is past it. */
  | {
      kind: "overdue"
      lastRotatedAt: string | null
      dueAt: string
      overdueByMs: number
      /** Which fact produced the verdict — AWS's own date, or an interval sum. */
      basis: string
    }
  /** Rotation is configured and the secret is inside its interval. */
  | { kind: "within-interval"; lastRotatedAt: string | null; dueAt: string | null; basis: string }
  /** Rotation is configured and it has never actually run. */
  | { kind: "never-rotated"; createdAt: string | null; ageMs: number | null; why: string }
  /** Rotation is off, so there is no interval to be past. Not a pass. */
  | { kind: "no-interval"; why: string }
  /** An interval could not be established. Explicitly not "fine". */
  | { kind: "undetermined"; why: string }

/**
 * Whether a secret is on its way out — the third question.
 *
 * The `scheduled` arm is careful about what it claims. It states the moment
 * deletion was requested, which AWS returned; it states that the recovery window
 * is still running, which follows from the secret still being LISTED — a secret
 * whose window has closed is permanently deleted and is not returned by
 * `ListSecrets` at all, with or without `IncludePlannedDeletion`; and it states
 * the window's END only as the documented 7-to-30-day bound, labelled as a
 * bound, because `RecoveryWindowInDays` is not returned by any read.
 */
export type DeletionState =
  | { kind: "active" }
  | {
      kind: "scheduled"
      deletionRequestedAt: string
      /** How long the recovery window has been running, at this reading. */
      elapsedMs: number
      /** Earliest and latest this could become unrecoverable, from the API's own bound. */
      earliestPermanentAt: string
      latestPermanentAt: string
      why: string
    }
  /** AWS returned a `DeletedDate` this engine could not read as a date. */
  | { kind: "unreadable"; raw: string; why: string }

/**
 * Which tenant a secret belongs to, and how that was decided.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and it can be denied, throttled or broken. A
 * secret whose tags were never read must not render as "unattributable — missing
 * tenure:tenant", because that sentence sends an operator to add a tag that is
 * probably already there.
 *
 * `source` is carried because this reader has TWO tag sources and they are not
 * equally authoritative. The Resource Groups Tagging API is the estate-wide join
 * `tags.ts` owns and is used first, as every other module in this directory
 * does. `ListSecrets` also hands back each secret's own `Tags`, straight from
 * the service that owns them, and that is used when the index does not carry the
 * ARN or could not be read — an attribution from the owning service is strictly
 * better than "unknown", and pretending it was not in the response would be
 * throwing away a fact to keep a rule tidy.
 */
export type SecretAttribution =
  | { kind: "tenant"; tenantSlug: string; source: string }
  | { kind: "shared"; source: string }
  | { kind: "unattributed"; source: string }
  | { kind: "unknown"; why: string }

/** One replica of a secret's material, in another region. A residency fact. */
export interface SecretReplica {
  region: string
  kmsKeyId: string | null
  status: string | null
  statusMessage: string | null
}

/**
 * What the per-secret `DescribeSecret` added.
 *
 * Its own `AwsRead` on every row, so a refusal on one secret — which is the
 * EXPECTED outcome for any secret outside the `tenure/*` scope the registry
 * grants — degrades that row and nothing else.
 */
export interface SecretDetail {
  /** Empty means AWS returned no ReplicationStatus: not replicated. */
  replicas: readonly SecretReplica[]
  /** The region AWS considers primary, when it named one. */
  primaryRegion: string | null
  /** Repeated from the detail call so a stale listing cannot be the only source. */
  rotationEnabled: boolean
}

export interface SecretReading {
  /** The secret's name. A label and a namespace check — never an attribution key. */
  name: string
  arn: string | null
  /** Where the ARN came from, or why there is none. Never silent. */
  arnProvenance: string
  region: string | null
  partition: string | null
  accountId: string | null
  attribution: SecretAttribution
  encryption: SecretEncryption
  rotation: RotationPosture
  age: RotationAge
  deletion: DeletionState
  createdAt: string | null
  lastChangedAt: string | null
  lastRotatedAt: string | null
  /**
   * When AWS last saw this secret retrieved. Day granularity — Secrets Manager
   * truncates it — so it answers "has anything used this in months", not "who
   * read it at 14:03".
   */
  lastAccessedAt: string | null
  /** Set when AWS itself manages the secret (an RDS-managed password, say). */
  owningService: string | null
  detail: AwsRead<SecretDetail>
  /** This row's detail cadence, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/** A secret that is past the rotation interval somebody configured for it. */
export interface OverdueSecret {
  name: string
  arn: string | null
  attribution: SecretAttribution
  lastRotatedAt: string | null
  dueAt: string
  overdueByMs: number
  basis: string
}

/** A secret in its deletion recovery window, with the window still running. */
export interface PendingDeletion {
  name: string
  arn: string | null
  attribution: SecretAttribution
  deletionRequestedAt: string
  elapsedMs: number
  earliestPermanentAt: string
  latestPermanentAt: string
}

/** A secret with no rotation configured at all. */
export interface UnrotatedSecret {
  name: string
  arn: string | null
  attribution: SecretAttribution
  /** How long since anything changed it. The number that makes "no rotation" bite. */
  ageSinceChangeMs: number | null
  lastChangedAt: string | null
}

/**
 * The three operational questions, answered together — or explicitly not.
 *
 * A union rather than four arrays, for the reason `DeadLetterState` is a union
 * in `sqs.ts`: a surface holding `{noRotation: []}` off a DENIED listing renders
 * a reassuring "every secret rotates", and there is no arrangement of empty
 * arrays that can say "we were not allowed to look".
 */
export type SecretPosture =
  | { kind: "unknown"; why: string }
  | {
      kind: "assessed"
      /** Question one: which secrets have no rotation. */
      noRotation: readonly UnrotatedSecret[]
      /** Question two: which are older than their rotation interval. */
      overdue: readonly OverdueSecret[]
      /** Question three: which are scheduled for deletion, window still running. */
      pendingDeletion: readonly PendingDeletion[]
      /**
       * Secrets whose posture could not be decided — a detail refused, a cron
       * schedule, a timestamp AWS did not return. Named, never folded into the
       * healthy count.
       */
      undetermined: readonly string[]
      secretsAssessed: number
      /** The qualifier on every count above. A truncated listing qualifies them all. */
      pagination: PaginationBound
    }

/** Everything a Secrets Manager surface needs, in one load. */
export interface SecretsReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The secrets. DENIED here is a refused `secretsmanager:ListSecrets` and is
   * NEVER `[]` — an operator reading "no secrets" when the truth is "we were not
   * allowed to look" is the single most dangerous thing this surface can say.
   */
  secrets: AwsRead<readonly SecretReading[]>
  pagination: PaginationBound
  posture: SecretPosture
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { inventory: number; detail: number }
}

/* --------------------------------------------------------------- parsing -- */

/**
 * An AWS timestamp as an ISO string, or null.
 *
 * Accepts a `Date` (what the SDK deserialiser produces), a string and a number,
 * and returns null for everything else rather than coercing. `new Date(x)` on a
 * value that is not a date yields `Invalid Date`, whose `toISOString` throws —
 * and a throw here would turn one odd field into a whole row reading ERROR.
 */
export function isoDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

/** Truncated, so a malformed expression cannot become an unbounded render string. */
function shortRaw(raw: string): string {
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
}

/**
 * A Secrets Manager `rate()` expression as an interval.
 *
 * The documented forms are `rate(N days)` and `rate(N hours)`, minimum four
 * hours. Singular units are accepted because AWS accepts them. Anything else is
 * `unreadable` rather than guessed — see the module header on what a guessed
 * interval costs.
 */
export function parseRotationSchedule(rules: RotationRules | undefined): RotationSchedule {
  const days = rules?.AutomaticallyAfterDays
  if (typeof days === "number" && Number.isFinite(days) && days > 0) {
    return {
      kind: "interval-days",
      days,
      intervalMs: days * MS_PER_DAY,
      source: "RotationRules.AutomaticallyAfterDays",
    }
  }

  const expression = rules?.ScheduleExpression
  if (typeof expression !== "string" || expression.trim() === "") {
    return {
      kind: "none",
      why:
        "rotation is switched on and AWS returned no RotationRules, so there is no cadence to be " +
        "past. Rotation that is enabled with no schedule does not run on one.",
    }
  }

  const trimmed = expression.trim()
  if (/^cron\(/i.test(trimmed)) {
    return {
      kind: "cron",
      expression: shortRaw(trimmed),
      why:
        "a cron() rotation schedule is a schedule, not a period — it can mean 'the first Monday of " +
        "every third month'. This engine does not convert one into an interval, so whether this " +
        "secret is past due is decided from AWS's own NextRotationDate or not at all.",
    }
  }

  const rate = /^rate\(\s*(\d+)\s+(day|days|hour|hours)\s*\)$/i.exec(trimmed)
  if (rate) {
    const amount = Number(rate[1])
    const unit = rate[2].toLowerCase()
    const intervalMs = unit.startsWith("day") ? amount * MS_PER_DAY : amount * MS_PER_HOUR
    if (amount > 0) {
      return {
        kind: "rate",
        expression: trimmed,
        intervalMs,
        source: "RotationRules.ScheduleExpression",
      }
    }
  }

  return {
    kind: "unreadable",
    expression: shortRaw(trimmed),
    why: "RotationRules.ScheduleExpression is neither a cron() nor a rate(N days|hours) expression",
  }
}

/** Rotation posture, straight off what AWS returned. */
export function rotationPostureOf(entry: SecretListEntry): RotationPosture {
  if (entry.RotationEnabled !== true) {
    return {
      kind: "not-configured",
      why:
        "RotationEnabled is not true, so nothing rotates this secret. Its material is as old as " +
        "the last time a human changed it.",
    }
  }
  return {
    kind: "configured",
    schedule: parseRotationSchedule(entry.RotationRules),
    rotationLambdaArn:
      typeof entry.RotationLambdaARN === "string" && entry.RotationLambdaARN
        ? entry.RotationLambdaARN
        : null,
    nextRotationAt: isoDate(entry.NextRotationDate),
  }
}

/**
 * Whether a secret is past its rotation interval.
 *
 * AWS's own `NextRotationDate` wins when it gave one — it is the service's
 * answer to the same question, computed from the same schedule, and preferring
 * a locally summed interval over it would be this engine second-guessing the
 * service that runs the rotation. The interval sum is the fallback for the case
 * AWS returns no next date, which is what happens when rotation has never run.
 */
export function rotationAgeOf(
  posture: RotationPosture,
  lastRotatedAt: string | null,
  createdAt: string | null,
  now: Date,
): RotationAge {
  if (posture.kind === "not-configured") {
    return {
      kind: "no-interval",
      why:
        "rotation is not configured, so there is no interval this secret can be past. That is the " +
        "finding, not a pass.",
    }
  }

  const nowMs = now.getTime()

  // AWS's own answer first.
  if (posture.nextRotationAt) {
    const dueMs = new Date(posture.nextRotationAt).getTime()
    if (Number.isFinite(dueMs)) {
      const basis = "AWS's own NextRotationDate for this secret"
      if (nowMs > dueMs) {
        return {
          kind: "overdue",
          lastRotatedAt,
          dueAt: posture.nextRotationAt,
          overdueByMs: nowMs - dueMs,
          basis,
        }
      }
      return { kind: "within-interval", lastRotatedAt, dueAt: posture.nextRotationAt, basis }
    }
  }

  const schedule = posture.schedule
  const intervalMs =
    schedule.kind === "interval-days" || schedule.kind === "rate" ? schedule.intervalMs : null

  if (!lastRotatedAt) {
    const createdMs = createdAt ? new Date(createdAt).getTime() : NaN
    return {
      kind: "never-rotated",
      createdAt,
      ageMs: Number.isFinite(createdMs) ? nowMs - createdMs : null,
      why:
        "rotation is configured and AWS reports no LastRotatedDate, so it has never actually run. " +
        "A configured rotation that has never run is not a rotating secret.",
    }
  }

  if (intervalMs === null) {
    return {
      kind: "undetermined",
      why:
        `rotation is configured but no interval could be established — ` +
        `${schedule.kind === "cron" ? schedule.why : schedule.kind === "unreadable" ? schedule.why : schedule.kind === "none" ? schedule.why : "the schedule is not an interval"} ` +
        `and AWS returned no NextRotationDate. Whether this secret is past due is unknown, which is ` +
        `not the same as its being current.`,
    }
  }

  const lastMs = new Date(lastRotatedAt).getTime()
  if (!Number.isFinite(lastMs)) {
    return {
      kind: "undetermined",
      why: `LastRotatedDate ${JSON.stringify(lastRotatedAt)} is not a date this engine can measure against`,
    }
  }
  const dueMs = lastMs + intervalMs
  const basis = `LastRotatedDate plus ${schedule.kind === "rate" ? schedule.expression : `${intervalMs / MS_PER_DAY} day(s)`}`
  if (nowMs > dueMs) {
    return {
      kind: "overdue",
      lastRotatedAt,
      dueAt: new Date(dueMs).toISOString(),
      overdueByMs: nowMs - dueMs,
      basis,
    }
  }
  return { kind: "within-interval", lastRotatedAt, dueAt: new Date(dueMs).toISOString(), basis }
}

/** Whether a secret is scheduled for deletion, and what can honestly be said about it. */
export function deletionStateOf(entry: SecretListEntry, now: Date): DeletionState {
  const raw = entry.DeletedDate
  if (raw === undefined || raw === null) return { kind: "active" }
  const requestedAt = isoDate(raw)
  if (!requestedAt) {
    return {
      kind: "unreadable",
      raw: shortRaw(String(raw)),
      why:
        "AWS returned a DeletedDate this engine could not read as a date. The secret is being " +
        "deleted and the schedule is unknown — which is worse than either, so it is not reported " +
        "as active.",
    }
  }
  const requestedMs = new Date(requestedAt).getTime()
  return {
    kind: "scheduled",
    deletionRequestedAt: requestedAt,
    elapsedMs: now.getTime() - requestedMs,
    earliestPermanentAt: new Date(requestedMs + RECOVERY_WINDOW_MIN_DAYS * MS_PER_DAY).toISOString(),
    latestPermanentAt: new Date(requestedMs + RECOVERY_WINDOW_MAX_DAYS * MS_PER_DAY).toISOString(),
    why:
      "the recovery window is still running: a secret whose window has closed is permanently " +
      `deleted and is no longer listed at all. RecoveryWindowInDays is not returned by any read ` +
      `this engine holds, so the exact date it becomes unrecoverable is not knowable from here — ` +
      `AWS accepts ${RECOVERY_WINDOW_MIN_DAYS} to ${RECOVERY_WINDOW_MAX_DAYS} days, which is the ` +
      `bound stated above and not a date this engine observed.`,
  }
}

/** What encrypts a secret, with the documented omission read as the fact it is. */
export function encryptionOf(entry: SecretListEntry): SecretEncryption {
  const key = entry.KmsKeyId
  if (typeof key === "string" && key.trim() !== "") {
    return { kind: "customer-managed", kmsKeyId: key }
  }
  return {
    kind: "aws-managed",
    why:
      "Secrets Manager omits KmsKeyId when a secret is encrypted under the account's AWS-managed " +
      "aws/secretsmanager key. The omission is the answer, not a gap in this reading.",
  }
}

/**
 * The whitelist. Every field this module reads out of an API response is named
 * here and nowhere else, so material that arrived in a response would have to be
 * added deliberately to escape.
 *
 * Exported so it can be asserted directly. See the module header: the
 * surface-level "no material reaches a line" test does not fail when this
 * projection is removed, because no raw entry reaches a line today — which makes
 * this the one layer here whose removal is invisible unless something looks at
 * it on purpose. `secretReadings` is its only production caller, on every entry
 * of every page.
 */
export function projectEntry(raw: SecretListEntry): SecretListEntry {
  return {
    ARN: typeof raw.ARN === "string" ? raw.ARN : undefined,
    Name: typeof raw.Name === "string" ? raw.Name : undefined,
    KmsKeyId: typeof raw.KmsKeyId === "string" ? raw.KmsKeyId : undefined,
    RotationEnabled: raw.RotationEnabled === true,
    RotationLambdaARN:
      typeof raw.RotationLambdaARN === "string" ? raw.RotationLambdaARN : undefined,
    RotationRules: raw.RotationRules
      ? {
          AutomaticallyAfterDays:
            typeof raw.RotationRules.AutomaticallyAfterDays === "number"
              ? raw.RotationRules.AutomaticallyAfterDays
              : undefined,
          Duration:
            typeof raw.RotationRules.Duration === "string" ? raw.RotationRules.Duration : undefined,
          ScheduleExpression:
            typeof raw.RotationRules.ScheduleExpression === "string"
              ? raw.RotationRules.ScheduleExpression
              : undefined,
        }
      : undefined,
    LastRotatedDate: raw.LastRotatedDate,
    LastChangedDate: raw.LastChangedDate,
    LastAccessedDate: raw.LastAccessedDate,
    DeletedDate: raw.DeletedDate,
    NextRotationDate: raw.NextRotationDate,
    Tags: Array.isArray(raw.Tags)
      ? raw.Tags.map((t) => ({ Key: t?.Key, Value: t?.Value }))
      : undefined,
    OwningService: typeof raw.OwningService === "string" ? raw.OwningService : undefined,
    CreatedDate: raw.CreatedDate,
    PrimaryRegion: typeof raw.PrimaryRegion === "string" ? raw.PrimaryRegion : undefined,
  }
}

/* ----------------------------------------------------------- the reading -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/** What the paged listing produced: the entries, and how far it got. */
interface SecretListing {
  entries: readonly SecretListEntry[]
  pagination: PaginationBound
}

async function listSecrets(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<SecretListing>> {
  return readAws<SecretListing>(
    "secretsmanager:ListSecrets",
    async () => {
      const entries: SecretListEntry[] = []
      let token: string | undefined
      let pages = 0
      let truncated = false

      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const response = (await gw.call("secretsmanager:ListSecrets", {
          NextToken: token,
        })) as ListSecretsResponse
        pages += 1
        for (const raw of response?.SecretList ?? []) {
          if (!raw) continue
          entries.push(projectEntry(raw))
        }
        token = response?.NextToken || undefined
        if (!token) break
        if (page === MAX_LIST_PAGES - 1) {
          // NOT a throw, and NOT a silent stop. `sqs.ts` throws here because a
          // partial queue list rendered as the estate is a lie; the honest third
          // option is to render what was read and SAY it is partial, which is
          // what the truncated arm is for. Every count derived downstream
          // carries it.
          truncated = true
        }
      }

      // Sorted by name so two loads of the same estate produce the same order.
      // ListSecrets promises none, and an order that changes between renders
      // makes a diff of two screenshots unreadable. Sorted with an explicit
      // comparator rather than the default: the default sorts by UTF-16 code
      // unit, which is stable, but a locale-aware default would not be —
      // byte-identical output on Linux and Windows is the property that matters.
      entries.sort((a, b) => {
        const an = a.Name ?? a.ARN ?? ""
        const bn = b.Name ?? b.ARN ?? ""
        return an < bn ? -1 : an > bn ? 1 : 0
      })

      const pagination: PaginationBound = truncated
        ? {
            kind: "truncated",
            pages,
            secrets: entries.length,
            why:
              `secretsmanager:ListSecrets still had pages after ${MAX_LIST_PAGES}. ${entries.length} ` +
              `secret(s) were read and there are more. Every count on this surface is a count of ` +
              `what was read, not of the account.`,
          }
        : { kind: "complete", pages, secrets: entries.length }

      return { entries, pagination }
    },
    {
      now: options.now,
      denial: options.denial,
      // The default `looksEmpty` inspects object keys, and this value always has
      // two — so without this override an account with no secrets would render
      // ACTUAL with an empty list rather than EMPTY, and "0 secrets" is a
      // different sentence from "none".
      isEmpty: (value) => (value as SecretListing).entries.length === 0,
      ...RETRY,
    },
  )
}

async function readSecretDetail(
  gw: AwsGateway,
  secretId: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<SecretDetail>> {
  return readAws<SecretDetail>(
    "secretsmanager:DescribeSecret",
    async () => {
      const response = (await gw.call("secretsmanager:DescribeSecret", {
        SecretId: secretId,
      })) as DescribeSecretResponse
      const replicas: SecretReplica[] = []
      for (const replica of response?.ReplicationStatus ?? []) {
        if (!replica || typeof replica.Region !== "string" || !replica.Region) continue
        replicas.push({
          region: replica.Region,
          kmsKeyId: typeof replica.KmsKeyId === "string" ? replica.KmsKeyId : null,
          status: typeof replica.Status === "string" ? replica.Status : null,
          statusMessage: typeof replica.StatusMessage === "string" ? replica.StatusMessage : null,
        })
      }
      // Deterministic order, for the same reason the listing is sorted.
      replicas.sort((a, b) => (a.region < b.region ? -1 : a.region > b.region ? 1 : 0))
      return {
        replicas,
        primaryRegion: typeof response?.PrimaryRegion === "string" ? response.PrimaryRegion : null,
        rotationEnabled: response?.RotationEnabled === true,
      }
    },
    {
      now: options.now,
      denial: options.denial,
      // A secret's detail is never meaningfully "empty": a secret with no
      // replicas is a fact, and EMPTY here would render as "we looked and there
      // is no such secret", which is a different and false sentence.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/* ------------------------------------------------------------ attribution -- */

function tagsFrom(entry: SecretListEntry): Readonly<Record<string, string>> | undefined {
  if (!Array.isArray(entry.Tags)) return undefined
  const tags: Record<string, string> = {}
  for (const tag of entry.Tags) {
    if (tag?.Key) tags[tag.Key] = tag.Value ?? ""
  }
  return tags
}

function fromTags(
  tags: Readonly<Record<string, string>>,
  source: string,
): SecretAttribution {
  const decided = attributionOf(tags)
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.tenantSlug, source }
    case "shared":
      return { kind: "shared", source }
    case "unattributed":
      return { kind: "unattributed", source }
  }
}

/**
 * Which tenant a secret belongs to.
 *
 * The tag index first, then the secret's own tags, then `unknown`. See
 * `SecretAttribution` on why there are two sources and why the second is not
 * thrown away.
 */
export function attributionFor(
  arn: string | null,
  ownTags: Readonly<Record<string, string>> | undefined,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): SecretAttribution {
  const indexReadable =
    tagged.state === "ACTUAL" || tagged.state === "STALE" || tagged.state === "EMPTY"

  if (indexReadable && arn) {
    const tags = index.get(arn)
    if (tags !== undefined) return fromTags(tags, "the Resource Groups Tagging API index")
  }

  if (ownTags !== undefined) {
    return fromTags(
      ownTags,
      indexReadable
        ? "the secret's own Tags from ListSecrets — the tag index answered and does not carry this ARN"
        : `the secret's own Tags from ListSecrets — ${describeRead(tagged, "the tag index")}`,
    )
  }

  if (indexReadable && arn) {
    // The index answered, this ARN is not in it, and ListSecrets returned no
    // Tags field at all. The Tagging API returns resources that HAVE tags, so an
    // absence from it is an observation: no tags.
    return { kind: "unattributed", source: "the Resource Groups Tagging API index, by absence" }
  }

  return {
    kind: "unknown",
    why: arn
      ? `this secret's tags were not read — ${describeRead(tagged, "the tag index")}, and ListSecrets returned no Tags for it`
      : "this secret has no ARN this engine can state, so it cannot be joined against the tag " +
        "index. Unattributed would be a claim about its tags; this is a claim about ours.",
  }
}

/* ------------------------------------------------------------- the surface -- */

/**
 * Every secret the estate holds, with its rotation posture, its age against that
 * posture, and whether it is on its way out.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function secretReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<SecretsReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const listed = await listSecrets(gw, { now, denial })
  const at = now()
  const asOf = at.toISOString()
  const refreshMs = {
    inventory: CAPABILITIES["secretsmanager:ListSecrets"].refreshMs,
    detail: CAPABILITIES["secretsmanager:DescribeSecret"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they are already an `AwsRead<SecretReading[]>`. A cast
    // here would be the place a future empty array could be smuggled in.
    const secrets: AwsRead<readonly SecretReading[]> = listed
    // EMPTY is not one of the "we could not look" states and must not be
    // rendered as one. `readAws` produces it only after the call RESOLVED, so
    // "there are no secrets in this account and region" is a fact this engine
    // established — and answering "unknown" to a question it can answer is the
    // same collapse, one size down, that the whole read plane exists to refuse.
    const pagination: PaginationBound =
      listed.state === "EMPTY"
        ? {
            kind: "no-secrets",
            why:
              "secretsmanager:ListSecrets answered and returned no secrets at all. This engine " +
              "looked, and there is genuinely nothing here — a fact about the account, not a gap " +
              "in what this engine was able to see.",
          }
        : { kind: "unknown", why: describeRead(listed, "the Secrets Manager listing") }
    return {
      identity,
      tagged,
      secrets,
      pagination,
      posture: secretPosture(secrets, pagination),
      asOf,
      refreshMs,
    }
  }

  const entries = listed.value.entries
  const pagination = listed.value.pagination

  const details: Array<AwsRead<SecretDetail>> = new Array(entries.length)
  for (let start = 0; start < entries.length; start += DETAIL_CONCURRENCY) {
    const batch = entries.slice(start, start + DETAIL_CONCURRENCY)
    const read = await Promise.all(
      batch.map((entry, offset) => {
        const position = start + offset
        if (position >= MAX_DETAIL_READS) {
          const skipped: AwsRead<SecretDetail> = {
            state: "UNCONFIGURED",
            capability: "secretsmanager:DescribeSecret",
            why:
              `this engine reads at most ${MAX_DETAIL_READS} secret details per load and this secret ` +
              `is number ${position + 1} of ${entries.length}. Its replication was not read — which ` +
              `is not the same as its having no replicas.`,
          }
          return Promise.resolve(skipped)
        }
        // The ARN when AWS gave one, the name otherwise. `DescribeSecret` takes
        // either, and the ARN is unambiguous where a name is only unique within
        // the account and region this call resolves to.
        const secretId = entry.ARN ?? entry.Name ?? ""
        return readSecretDetail(gw, secretId, { now, denial })
      }),
    )
    for (let i = 0; i < read.length; i += 1) details[start + i] = read[i]
  }

  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"

  const readings: SecretReading[] = entries.map((entry, i) => {
    const arn = typeof entry.ARN === "string" && entry.ARN ? entry.ARN : null
    const arnProvenance = arn
      ? "AWS's own ARN for this secret, as ListSecrets returned it"
      : "none — ListSecrets returned no ARN for this secret, and this engine will not assemble one: " +
        "a secret's ARN carries a six-character suffix AWS generates, so an assembled ARN would be " +
        "a string that resolves to nothing"

    // `arn:PARTITION:secretsmanager:REGION:ACCOUNT:secret:NAME-SUFFIX`.
    const parts = arn ? arn.split(":") : []
    const wellFormed = parts.length >= 6 && parts[0] === "arn"

    const rotation = rotationPostureOf(entry)
    const lastRotatedAt = isoDate(entry.LastRotatedDate)
    const createdAt = isoDate(entry.CreatedDate)

    return {
      name: entry.Name ?? arn ?? "",
      arn,
      arnProvenance,
      // From the ARN when there is one — AWS's answer beats anything assembled —
      // and otherwise from the resolved identity. Never from a literal.
      partition: wellFormed ? parts[1] : identityResolved ? identity.value.partition : null,
      region: wellFormed ? parts[3] : identityResolved ? identity.value.region : null,
      accountId: wellFormed ? parts[4] : identityResolved ? identity.value.accountId : null,
      attribution: attributionFor(arn, tagsFrom(entry), tagged, index),
      encryption: encryptionOf(entry),
      rotation,
      age: rotationAgeOf(rotation, lastRotatedAt, createdAt, at),
      deletion: deletionStateOf(entry, at),
      createdAt,
      lastChangedAt: isoDate(entry.LastChangedDate),
      lastRotatedAt,
      lastAccessedAt: isoDate(entry.LastAccessedDate),
      owningService: typeof entry.OwningService === "string" ? entry.OwningService : null,
      detail: details[i],
      refreshMs: refreshMs.detail,
      asOf,
    }
  })

  const secrets: AwsRead<readonly SecretReading[]> = { ...listed, value: readings }
  return {
    identity,
    tagged,
    secrets,
    pagination,
    posture: secretPosture(secrets, pagination),
    asOf,
    refreshMs,
  }
}

/* --------------------------------------------------------------- posture -- */

/**
 * The three operational questions, derived.
 *
 * Exported and pure so the derivation can be reasoned about on its own — but
 * `secretReadings` is the only production caller and the tests drive it through
 * there, not through here.
 */
export function secretPosture(
  secrets: AwsRead<readonly SecretReading[]>,
  pagination: PaginationBound,
): SecretPosture {
  if (secrets.state === "EMPTY") {
    // Assessed, over nothing. Every list below is empty because there was
    // nothing to put in it, which is a different fact from `unknown`'s "we were
    // not able to look", and `pagination.no-secrets` is what tells the two apart
    // on the rendered line.
    return {
      kind: "assessed",
      noRotation: [],
      overdue: [],
      pendingDeletion: [],
      undetermined: [],
      secretsAssessed: 0,
      pagination,
    }
  }
  if (secrets.state !== "ACTUAL" && secrets.state !== "STALE") {
    return { kind: "unknown", why: describeRead(secrets, "the Secrets Manager listing") }
  }

  const noRotation: UnrotatedSecret[] = []
  const overdue: OverdueSecret[] = []
  const pendingDeletion: PendingDeletion[] = []
  const undetermined: string[] = []

  for (const secret of secrets.value) {
    if (secret.rotation.kind === "not-configured") {
      const changedMs = secret.lastChangedAt ? new Date(secret.lastChangedAt).getTime() : NaN
      const asOfMs = new Date(secret.asOf).getTime()
      noRotation.push({
        name: secret.name,
        arn: secret.arn,
        attribution: secret.attribution,
        ageSinceChangeMs:
          Number.isFinite(changedMs) && Number.isFinite(asOfMs) ? asOfMs - changedMs : null,
        lastChangedAt: secret.lastChangedAt,
      })
    }

    switch (secret.age.kind) {
      case "overdue":
        overdue.push({
          name: secret.name,
          arn: secret.arn,
          attribution: secret.attribution,
          lastRotatedAt: secret.age.lastRotatedAt,
          dueAt: secret.age.dueAt,
          overdueByMs: secret.age.overdueByMs,
          basis: secret.age.basis,
        })
        break
      case "never-rotated":
      case "undetermined":
        // A configured rotation that has never run, and a schedule no interval
        // could be read from, are both "this engine cannot say this secret is
        // current". Counting either as healthy is the reassuring default the
        // whole read plane exists to refuse.
        undetermined.push(secret.name)
        break
      case "within-interval":
      case "no-interval":
        break
    }

    if (secret.deletion.kind === "scheduled") {
      pendingDeletion.push({
        name: secret.name,
        arn: secret.arn,
        attribution: secret.attribution,
        deletionRequestedAt: secret.deletion.deletionRequestedAt,
        elapsedMs: secret.deletion.elapsedMs,
        earliestPermanentAt: secret.deletion.earliestPermanentAt,
        latestPermanentAt: secret.deletion.latestPermanentAt,
      })
    } else if (secret.deletion.kind === "unreadable") {
      undetermined.push(secret.name)
    }
  }

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0

  return {
    kind: "assessed",
    noRotation: noRotation.sort(byName),
    overdue: overdue.sort(byName),
    pendingDeletion: pendingDeletion.sort(byName),
    undetermined: [...new Set(undetermined)].sort(),
    secretsAssessed: secrets.value.length,
    pagination,
  }
}

/* ------------------------------------------------------------ rendering -- */

function days(ms: number): string {
  return `${Math.floor(ms / MS_PER_DAY)} day(s)`
}

/** The sentence a surface prints for one secret's rotation posture. */
export function describeRotation(rotation: RotationPosture): string {
  if (rotation.kind === "not-configured") {
    return `NO ROTATION — ${rotation.why}`
  }
  switch (rotation.schedule.kind) {
    case "interval-days":
      return `rotates every ${rotation.schedule.days} day(s) (${rotation.schedule.source})`
    case "rate":
      return `rotates on ${rotation.schedule.expression} (${rotation.schedule.source})`
    case "cron":
      return `rotates on ${rotation.schedule.expression} — ${rotation.schedule.why}`
    case "none":
      return `rotation enabled with no schedule — ${rotation.schedule.why}`
    case "unreadable":
      return `rotation schedule unreadable — ${rotation.schedule.why}`
  }
}

/** The sentence a surface prints for one secret's age against its schedule. */
export function describeRotationAge(age: RotationAge): string {
  switch (age.kind) {
    case "overdue":
      return `OVERDUE by ${days(age.overdueByMs)} — due ${age.dueAt}, basis: ${age.basis}`
    case "within-interval":
      return `within its interval${age.dueAt ? `, next due ${age.dueAt}` : ""} (basis: ${age.basis})`
    case "never-rotated":
      return `NEVER ROTATED — ${age.why}${age.ageMs === null ? "" : ` The secret is ${days(age.ageMs)} old.`}`
    case "no-interval":
      return `no interval — ${age.why}`
    case "undetermined":
      return `age undetermined — ${age.why}`
  }
}

/** The sentence a surface prints for one secret's deletion state. */
export function describeDeletion(deletion: DeletionState): string {
  switch (deletion.kind) {
    case "active":
      return "not scheduled for deletion"
    case "scheduled":
      return (
        `SCHEDULED FOR DELETION — requested ${deletion.deletionRequestedAt}, ` +
        `${days(deletion.elapsedMs)} ago. Recoverable now; unrecoverable somewhere between ` +
        `${deletion.earliestPermanentAt} and ${deletion.latestPermanentAt}. ${deletion.why}`
      )
    case "unreadable":
      return `deletion state unreadable — ${deletion.why}`
  }
}

/** The sentence a surface prints for one secret's attribution. */
export function describeSecretAttribution(attribution: SecretAttribution): string {
  switch (attribution.kind) {
    case "tenant":
      return `${attribution.tenantSlug} (from ${attribution.source})`
    case "shared":
      return `shared — platform overhead, decided (from ${attribution.source})`
    case "unattributed":
      return `unattributable — missing tenure:tenant (from ${attribution.source})`
    case "unknown":
      return `attribution unknown — ${attribution.why}`
  }
}

/** The sentence a surface prints for what encrypts a secret. */
export function describeEncryption(encryption: SecretEncryption): string {
  return encryption.kind === "customer-managed"
    ? `encrypted under ${encryption.kmsKeyId}`
    : `encrypted under the AWS-managed aws/secretsmanager key — ${encryption.why}`
}

/** The sentence a surface prints for one secret's replication detail. */
export function describeDetail(detail: AwsRead<SecretDetail>): string {
  if (detail.state === "ACTUAL" || detail.state === "STALE") {
    if (detail.value.replicas.length === 0) return "not replicated to any other region"
    return `replicated to ${detail.value.replicas
      .map((r) => `${r.region}${r.status ? ` (${r.status})` : ""}`)
      .join(", ")}`
  }
  // Every other state goes through the one renderer, so a refused detail reads
  // as a refusal here exactly as it does everywhere else — never as "no
  // replicas".
  return describeRead(detail, "replication")
}

/** The sentence a surface prints for one secret. One funnel, so states cannot drift. */
export function describeSecret(secret: SecretReading): string {
  const where =
    secret.region && secret.partition
      ? `${secret.region} (partition ${secret.partition})`
      : "region unknown — identity is unresolved and AWS returned no usable ARN"
  return (
    `${secret.name} — ${where} — ${describeSecretAttribution(secret.attribution)} · ` +
    `${describeRotation(secret.rotation)} · ${describeRotationAge(secret.age)} · ` +
    `${describeDeletion(secret.deletion)} · ${describeEncryption(secret.encryption)} · ` +
    `${describeDetail(secret.detail)} · ` +
    `last accessed ${secret.lastAccessedAt ?? "never, as far as AWS reports"} · ` +
    `as of ${secret.asOf}, refreshed every ${Math.round(secret.refreshMs / 1000)}s`
  )
}

/** The sentence a surface prints for how far the listing got. */
export function describePagination(pagination: PaginationBound): string {
  switch (pagination.kind) {
    case "complete":
      return `${pagination.secrets} secret(s) read over ${pagination.pages} page(s) — the whole listing`
    case "truncated":
      return `PARTIAL — ${pagination.why}`
    case "no-secrets":
      return `no secrets — ${pagination.why}`
    case "unknown":
      return `extent unknown — ${pagination.why}`
  }
}

/** The sentence a surface prints for the three operational questions. */
export function describeSecretPosture(posture: SecretPosture): string {
  if (posture.kind === "unknown") {
    return `unknown — ${posture.why}`
  }
  if (posture.secretsAssessed === 0 && posture.pagination.kind === "no-secrets") {
    // Its own sentence. "Every secret that was read has rotation configured" is
    // TRUE of an empty account and reads as a clean bill of health for one, so
    // the empty case says what it means instead.
    return (
      "no secrets exist in this account and region — nothing to rotate, nothing past an interval, " +
      `nothing scheduled for deletion. ${describePagination(posture.pagination)}`
    )
  }
  const parts: string[] = []
  parts.push(
    posture.noRotation.length === 0
      ? "every secret that was read has rotation configured"
      : `NO ROTATION on ${posture.noRotation.length}: ${posture.noRotation
          .map(
            (s) =>
              `${s.name}${s.ageSinceChangeMs === null ? "" : ` (unchanged for ${days(s.ageSinceChangeMs)})`}`,
          )
          .join(", ")}`,
  )
  parts.push(
    posture.overdue.length === 0
      ? "none that were read is past its rotation interval"
      : `OVERDUE ${posture.overdue.length}: ${posture.overdue
          .map((s) => `${s.name} by ${days(s.overdueByMs)}`)
          .join(", ")}`,
  )
  parts.push(
    posture.pendingDeletion.length === 0
      ? "none that were read is scheduled for deletion"
      : `SCHEDULED FOR DELETION ${posture.pendingDeletion.length}: ${posture.pendingDeletion
          .map((s) => `${s.name} (requested ${s.deletionRequestedAt}, recovery window still running)`)
          .join(", ")}`,
  )
  if (posture.undetermined.length > 0) {
    parts.push(
      `UNDETERMINED ${posture.undetermined.length}: ${posture.undetermined.join(", ")} — this engine ` +
        `cannot say these are current, which is not the same as their being current`,
    )
  }
  return `${parts.join(" · ")} · ${describePagination(posture.pagination)}`
}

export interface SecretLine {
  label: string
  text: string
}

/**
 * What a Secrets Manager surface prints.
 *
 * A surface agent renders exactly these strings. The tests assert on them, which
 * is what makes the mutation proofs land on the production path rather than on a
 * helper nothing calls.
 */
export function secretLines(readings: SecretsReadings): readonly SecretLine[] {
  const lines: SecretLine[] = [
    {
      label: "Secrets",
      text: describeRead(
        readings.secrets,
        `secrets read from AWS, refreshed every ${Math.round(readings.refreshMs.inventory / 1000)}s`,
      ),
    },
    { label: "Rotation posture", text: describeSecretPosture(readings.posture) },
    { label: "Coverage", text: describePagination(readings.pagination) },
  ]
  if (readings.secrets.state === "ACTUAL" || readings.secrets.state === "STALE") {
    for (const secret of readings.secrets.value) {
      lines.push({ label: secret.name, text: describeSecret(secret) })
    }
  }
  return lines
}
