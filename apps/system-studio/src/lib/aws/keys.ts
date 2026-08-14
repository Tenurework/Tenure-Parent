/**
 * STUDIO-070-004 (KMS) — the customer-managed keys, what each one is for, and
 * the ones that are not rotating.
 *
 * `kms:ListKeys` has been in the capability registry since the read plane was
 * built and nothing ever called it. Even if something had, a list of key ids is
 * not an answer: `b8f2…` tells an operator nothing about what it encrypts,
 * whether it is still enabled, whether the annual rotation an auditor asks about
 * is switched on, or whether somebody scheduled it for deletion last Tuesday
 * with three RDS snapshots still encrypted under it. `kms:DescribeKey` and
 * `kms:GetKeyRotationStatus` are what turn the list into the answer, and this
 * module is where the three are joined.
 *
 * ## An AWS-managed key is not a passing check
 *
 * Every account carries dozens of `aws/…` keys — `aws/rds`, `aws/s3`, `aws/ssm`
 * — created by the services themselves. AWS rotates them on its own schedule and
 * a customer cannot turn that on or off. They are therefore NOT evidence that
 * this estate rotates its keys, and the one thing this module must never do is
 * let them inflate the number. A posture that counts fifty AWS-managed keys as
 * "rotating" and two customer-managed keys with rotation off as a rounding error
 * reports 96% compliance for an estate whose every controllable key is
 * non-compliant. So `KeyRotationPosture` keeps them in their own field,
 * `awsManagedExcluded`, and they appear in no compliant total anywhere.
 *
 * A customer-managed key with rotation DISABLED is the finding. It is named, by
 * key id, in `notRotating` — not counted.
 *
 * ## Rotation is not always a boolean
 *
 * Automatic rotation applies to symmetric encryption keys whose material AWS
 * generated. On an asymmetric key, an HMAC key, a key with imported material
 * (`Origin: EXTERNAL`) or a key in a custom key store, `GetKeyRotationStatus`
 * raises `UnsupportedOperationException` — rotation cannot be enabled, so
 * "disabled" would be a finding an operator cannot act on. That is its own arm,
 * `not-applicable`, carrying the reason. And a rotation read that was refused is
 * `unknown`, never `disabled` and never `enabled`: an alarming default is a false
 * finding and a reassuring default is a missed one, and the whole read plane
 * exists so neither gets invented.
 *
 * ## A key pending deletion is urgent, and the date is the fact
 *
 * `KeyState: PendingDeletion` means the key material is destroyed on
 * `DeletionDate` and everything encrypted under it becomes permanently
 * unrecoverable — a backup, a snapshot, an S3 object with SSE-KMS. "Pending
 * deletion" without the date is a warning nobody can schedule around, so
 * `KeyLifecycle` carries the date and the remaining window, and refuses to
 * render the state without them.
 *
 * ## Aliases: NOT READ, and said out loud
 *
 * A key's aliases are what make it legible — `alias/tenure-prod-rds` is the
 * answer to "what is this key for" that a description often is not. They come
 * from `kms:ListAliases`, which is not in the capability registry and which this
 * module does not get to add: `client.ts` switches on the capability
 * deliberately so there is no way to express "send this arbitrary command", and
 * a service agent widening that seam is exactly the thing the seam is for. So
 * every key carries `ALIASES_NOT_READABLE`, naming the capability key and the
 * IAM action that would answer it. A field silently left off the type would let
 * a surface render a key with no alias and let an operator read that as "this
 * key has no alias", which is a claim about AWS rather than about us.
 *
 * ## Region, partition, attribution, bounds
 *
 * Region and partition come from the resolved identity and from the `KeyArn`
 * AWS returns — there is no literal region and no `"aws"` partition fallback in
 * this file, because GE-010-007 was a data-residency defect caused by exactly
 * that fallback. Attribution goes through `tags.ts` and the Resource Groups
 * Tagging API, with a fourth answer, `unknown`, for when the tag index itself
 * could not be read. Both loops are bounded, and hitting a bound produces an
 * explicit truncation signal rather than a short list that looks complete.
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
 * How many `ListKeys` pages to walk. The API returns up to 100 keys a page by
 * default, so this is five thousand keys before the reader stops — and when it
 * stops it SAYS so, through `KeyListTruncation`. A reader with no bound is how
 * one page render becomes an outage; a reader that silently returns the first
 * page is the same lie as an empty list.
 */
export const MAX_KEY_PAGES = 50

/**
 * How many keys get a `DescribeKey` in one load.
 *
 * `DescribeKey` is one call per key against a shared account throttle. Keys past
 * the budget are NOT dropped and do not render as anything reassuring: they
 * carry an UNCONFIGURED detail whose `why` says the engine stopped, which is a
 * visibly different sentence from "this key is fine".
 */
export const MAX_KEY_DETAIL_READS = 300

/** How many detail reads are in flight at once, so one load is not a burst. */
const DETAIL_CONCURRENCY = 8

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/* ---------------------------------------------------------------- shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface ListKeysResponse {
  Keys?: Array<{ KeyId?: string; KeyArn?: string }>
  NextMarker?: string
  Truncated?: boolean
}

interface DescribeKeyResponse {
  KeyMetadata?: {
    KeyId?: string
    Arn?: string
    AWSAccountId?: string
    Description?: string
    Enabled?: boolean
    KeyState?: string
    KeyManager?: string
    KeyUsage?: string
    KeySpec?: string
    Origin?: string
    MultiRegion?: boolean
    CreationDate?: Date | string
    DeletionDate?: Date | string
    ValidTo?: Date | string
    PendingDeletionWindowInDays?: number
    CustomKeyStoreId?: string
  }
}

interface GetKeyRotationStatusResponse {
  KeyRotationEnabled?: boolean
  KeyId?: string
  RotationPeriodInDays?: number
  NextRotationDate?: Date | string
  OnDemandRotationStartDate?: Date | string
}

/* ------------------------------------------------------------- vocabulary -- */

/**
 * Who controls the key.
 *
 * `unrecognised` exists because `KeyManager` is a string AWS chose and a value
 * this module has not seen must not silently become `CUSTOMER` — that would put
 * a key AWS controls into the compliance denominator, which is the exact lie the
 * module header is about.
 */
export type KeyManagement =
  | { kind: "customer" }
  | { kind: "aws" }
  | { kind: "unrecognised"; raw: string }

export function keyManagementOf(raw: string | undefined): KeyManagement {
  if (raw === "CUSTOMER") return { kind: "customer" }
  if (raw === "AWS") return { kind: "aws" }
  return { kind: "unrecognised", raw: raw ?? "absent" }
}

/**
 * Where a key is in its life.
 *
 * `pending-deletion` carries the date because the date is the entire fact: it is
 * the moment everything encrypted under this key becomes unrecoverable. An arm
 * that said "pending deletion" and nothing else is a warning nobody can schedule
 * around.
 */
export type KeyLifecycle =
  | { kind: "active" }
  /** Disabled: it still exists and nothing can decrypt with it. */
  | { kind: "disabled"; keyState: string }
  | {
      kind: "pending-deletion"
      /** ISO, from AWS's `DeletionDate`. Null when AWS did not return one — said, not guessed. */
      deletionDate: string | null
      /** The remaining waiting period AWS reported, in days. */
      windowDays: number | null
      why: string
    }
  /** Awaiting imported material, replicating, or any other state AWS reports. */
  | { kind: "other"; keyState: string }
  /** The describe did not answer. Not a state of the key — a state of the read. */
  | { kind: "unknown"; why: string }

/**
 * Whether automatic rotation is on.
 *
 * Five arms, and only one of them is a compliance pass. `aws-managed` is
 * deliberately not one: see the module header.
 */
export type RotationState =
  /** On. The only arm that counts toward the rotating total. */
  | {
      kind: "enabled"
      /** AWS's `RotationPeriodInDays`. Null when absent, which means the 365-day default. */
      periodDays: number | null
      nextRotationAt: string | null
    }
  /** Off, on a key whose owner can turn it on. THE finding. */
  | { kind: "disabled"; why: string }
  /**
   * AWS controls this key's rotation and no customer setting exists. Reported,
   * never counted — as compliant or as a finding.
   */
  | { kind: "aws-managed"; why: string }
  /** Rotation cannot be enabled on this kind of key at all. */
  | { kind: "not-applicable"; why: string }
  /** The rotation read was refused, throttled, broken or never made. */
  | { kind: "unknown"; why: string }

/**
 * A key's aliases.
 *
 * One arm, deliberately, exactly as `sqs.ts` does for the oldest-message age.
 * `kms:ListAliases` is not in the capability registry and this module does not
 * add capabilities. This type exists so the absence is a value a surface has to
 * render rather than a field a surface can forget.
 */
export interface AliasesUnavailable {
  state: "NOT_READABLE"
  /** The capability key that would answer it, spelled as the registry would spell it. */
  needs: "kms:ListAliases"
  /** The IAM action, spelled as IAM spells it, so the grant is unambiguous. */
  iamAction: "kms:ListAliases"
  why: string
}

/** The same object for every key: nothing about it varies per key. */
export const ALIASES_NOT_READABLE: AliasesUnavailable = {
  state: "NOT_READABLE",
  needs: "kms:ListAliases",
  iamAction: "kms:ListAliases",
  why:
    "a key's aliases come from kms:ListAliases, which is not in this engine's capability " +
    "registry. No alias was read — which is not the same as this key having none.",
}

/** What one `DescribeKey` answered. */
export interface KeyDetail {
  /** AWS's own `KeyId` from the metadata, not one this engine carried in. */
  keyId: string
  /** AWS's own `Arn`. Null only when AWS omitted it. */
  arn: string | null
  accountId: string | null
  /** What the key is for, as somebody wrote it. Null when unset — not "". */
  description: string | null
  keyState: string
  /** AWS's `Enabled` flag. Null when absent, because false is a claim. */
  enabled: boolean | null
  management: KeyManagement
  keyUsage: string | null
  keySpec: string | null
  origin: string | null
  multiRegion: boolean | null
  customKeyStoreId: string | null
  creationDate: string | null
  deletionDate: string | null
  pendingDeletionWindowInDays: number | null
  validTo: string | null
}

/**
 * Which tenant a key belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and can be denied, throttled or broken. A key
 * whose tags were never read must not render as "unattributable — missing
 * tenure:tenant", a sentence that sends an operator to add a tag that is
 * probably already there.
 */
export type KeyAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

export interface KeyReading {
  /** The key id from the listing — the handle every other KMS call takes. */
  keyId: string
  /** AWS's `KeyArn` from the listing, or the describe, or assembled. Never invented. */
  arn: string | null
  /** Where the ARN came from, or why there is none. Never silent. */
  arnProvenance: string
  region: string | null
  partition: string | null
  accountId: string | null
  attribution: KeyAttribution
  /** Refused, throttled, broken or read — per key, with its own action named. */
  detail: AwsRead<KeyDetail>
  /** Degrades on its own: a refused rotation read does not collapse the row. */
  rotation: RotationState
  lifecycle: KeyLifecycle
  aliases: AliasesUnavailable
  /** This key's detail cadence, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/**
 * Whether the listing is the whole estate.
 *
 * A bound that is hit silently is the same lie as an empty list, so hitting one
 * is a value the surface has to render. `detail-budget` is separate from
 * `more-keys` because they are different truncations with different remedies.
 */
export type KeyListTruncation =
  | { kind: "complete"; keysRead: number }
  | { kind: "more-keys"; keysRead: number; pagesRead: number; why: string }
  | { kind: "detail-budget"; keysRead: number; detailsRead: number; why: string }
  | {
      kind: "both"
      keysRead: number
      pagesRead: number
      detailsRead: number
      why: string
    }
  /** The listing never answered, so there is nothing to be truncated. */
  | { kind: "unknown"; why: string }

/**
 * The rotation posture of the estate, counted the way an auditor asks about it.
 *
 * There is no single percentage field on purpose. Every number here is
 * accompanied by the names it was computed from, and the categories that must
 * never be folded together are separate fields: `awsManagedExcluded` is not
 * compliant, `rotationUnknown` is not compliant, and `notApplicable` is neither
 * a pass nor a finding.
 */
export interface KeyRotationPosture {
  /** Customer-managed keys whose rotation status was actually read. The denominator. */
  customerManagedRead: number
  /** Of those, the ones rotating. The numerator, and nothing else is in it. */
  rotating: number
  /** Of those, the ones NOT rotating, by key id. THE finding. */
  notRotating: readonly string[]
  /** Customer-managed keys on which rotation cannot be enabled at all. */
  notApplicable: readonly string[]
  /** Customer-managed keys whose rotation status could not be read, by key id. */
  rotationUnknown: readonly string[]
  /** AWS-managed keys. Counted here and in no compliant total anywhere. */
  awsManagedExcluded: number
  /** Keys whose manager AWS reported as something this engine does not recognise. */
  unrecognisedManagement: readonly string[]
  /** Keys scheduled for deletion, with the date. The urgent finding. */
  pendingDeletion: readonly { keyId: string; deletionDate: string | null }[]
  /** Keys whose `DescribeKey` did not answer, by key id. */
  unreadable: readonly string[]
  /**
   * Whether this posture is computed over the whole estate. False when the
   * listing was truncated, a detail was unreadable or a rotation was unknown —
   * so a surface can never present a partial count as a verdict.
   */
  complete: boolean
}

/** Everything a KMS surface needs, in one load. */
export interface KmsReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The keys. DENIED here is a refused `kms:ListKeys` and is NEVER `[]` — an
   * operator reading "no customer-managed keys" when the truth is "we were not
   * allowed to look" is the single most dangerous thing this surface can say.
   */
  keys: AwsRead<readonly KeyReading[]>
  truncation: KeyListTruncation
  posture: KeyRotationPosture
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { keys: number; detail: number; rotation: number }
}

/* --------------------------------------------------------------- parsing -- */

/**
 * An AWS timestamp as an ISO string.
 *
 * The SDK hands back `Date`; a serialised response hands back a string. Both are
 * accepted and anything else becomes null rather than `Invalid Date`, because a
 * deletion date rendered as "Invalid Date" is a deletion date nobody schedules
 * around.
 */
export function isoOf(value: Date | string | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** A string AWS may have omitted. Empty becomes null: "" is not a description. */
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

/**
 * The lifecycle a key's metadata describes.
 *
 * Derived from `KeyState`, which is AWS's own word, rather than from `Enabled` —
 * `Enabled: false` is true of a disabled key AND of one pending deletion, and
 * those have wildly different urgencies.
 */
export function lifecycleOf(detail: KeyDetail): KeyLifecycle {
  switch (detail.keyState) {
    case "Enabled":
      return { kind: "active" }
    case "Disabled":
      return { kind: "disabled", keyState: detail.keyState }
    case "PendingDeletion":
    case "PendingReplicaDeletion":
      return {
        kind: "pending-deletion",
        deletionDate: detail.deletionDate,
        windowDays: detail.pendingDeletionWindowInDays,
        why:
          detail.deletionDate === null
            ? `key ${detail.keyId} is ${detail.keyState} and AWS returned no DeletionDate. ` +
              `Everything encrypted under it becomes permanently unrecoverable when it is deleted.`
            : `key ${detail.keyId} is scheduled for deletion on ${detail.deletionDate}. ` +
              `Everything encrypted under it — snapshots, backups, SSE-KMS objects — becomes ` +
              `permanently unrecoverable on that date.`,
      }
    default:
      return { kind: "other", keyState: detail.keyState }
  }
}

/**
 * Whether automatic rotation is a setting this key can even have.
 *
 * Decided from the metadata AWS already returned, so a key that would raise
 * `UnsupportedOperationException` is not asked. Returns null when rotation IS
 * applicable, and the sentence otherwise.
 *
 * `KeySpec` absent is deliberately treated as applicable rather than as
 * not-applicable: guessing "not applicable" would quietly remove a key from the
 * compliance denominator, which is the direction that makes a posture number
 * lie.
 */
export function rotationInapplicableReason(detail: KeyDetail): string | null {
  if (detail.keySpec !== null && detail.keySpec !== "SYMMETRIC_DEFAULT") {
    return (
      `automatic rotation applies only to symmetric encryption keys; this key's spec is ` +
      `${detail.keySpec}, so rotation cannot be enabled on it and its absence is not a finding`
    )
  }
  if (detail.origin !== null && detail.origin !== "AWS_KMS") {
    return (
      `this key's material has origin ${detail.origin} rather than AWS_KMS, so AWS cannot rotate ` +
      `it automatically. Rotating it is a manual re-import, not a switch`
    )
  }
  if (detail.customKeyStoreId !== null) {
    return (
      `this key lives in custom key store ${detail.customKeyStoreId}; AWS does not rotate keys in ` +
      `a custom key store automatically`
    )
  }
  return null
}

/* ----------------------------------------------------------- the readings -- */

async function listKeyHandles(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<{
  read: AwsRead<readonly { keyId: string; keyArn: string | null }[]>
  hadMore: boolean
  pagesRead: number
}> {
  // Carried out of the closure rather than thrown, because hitting the bound is
  // a fact the surface must render alongside the keys it DID read — throwing
  // would turn a partial-but-useful answer into an ERROR box with no keys in it.
  let hadMore = false
  let pagesRead = 0

  const read = await readAws<readonly { keyId: string; keyArn: string | null }[]>(
    "kms:ListKeys",
    async () => {
      const handles: { keyId: string; keyArn: string | null }[] = []
      let marker: string | undefined
      hadMore = false
      pagesRead = 0
      for (let page = 0; page < MAX_KEY_PAGES; page += 1) {
        const response = (await gw.call("kms:ListKeys", { Marker: marker })) as ListKeysResponse
        pagesRead = page + 1
        for (const entry of response?.Keys ?? []) {
          if (typeof entry?.KeyId !== "string" || !entry.KeyId) continue
          handles.push({
            keyId: entry.KeyId,
            keyArn: typeof entry.KeyArn === "string" && entry.KeyArn ? entry.KeyArn : null,
          })
        }
        marker = response?.NextMarker || undefined
        if (!marker) break
        if (page === MAX_KEY_PAGES - 1) {
          hadMore = true
        }
      }
      // Sorted so two loads of the same estate produce the same order. ListKeys
      // does not promise one, and an order that changes between renders makes a
      // diff of two screenshots unreadable.
      return handles.sort((a, b) => (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0))
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )

  return { read, hadMore, pagesRead }
}

async function readKeyDetail(
  gw: AwsGateway,
  keyId: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<KeyDetail>> {
  return readAws<KeyDetail>(
    "kms:DescribeKey",
    async () => {
      const response = (await gw.call("kms:DescribeKey", { KeyId: keyId })) as DescribeKeyResponse
      const metadata = response?.KeyMetadata
      if (!metadata) {
        throw new Error(
          `kms:DescribeKey answered for ${keyId} without KeyMetadata. Nothing about this key can ` +
            `be stated from that.`,
        )
      }
      const keyState = optionalString(metadata.KeyState)
      if (!keyState) {
        // Never defaulted to "Enabled". A key whose state was not returned must
        // not render as active — that is the sentence that hides a pending
        // deletion.
        throw new Error(
          `kms:DescribeKey answered for ${keyId} without KeyState. A key state this engine did ` +
            `not read must not render as active.`,
        )
      }
      return {
        keyId: optionalString(metadata.KeyId) ?? keyId,
        arn: optionalString(metadata.Arn),
        accountId: optionalString(metadata.AWSAccountId),
        description: optionalString(metadata.Description),
        keyState,
        enabled: optionalBoolean(metadata.Enabled),
        management: keyManagementOf(optionalString(metadata.KeyManager) ?? undefined),
        keyUsage: optionalString(metadata.KeyUsage),
        keySpec: optionalString(metadata.KeySpec),
        origin: optionalString(metadata.Origin),
        multiRegion: optionalBoolean(metadata.MultiRegion),
        customKeyStoreId: optionalString(metadata.CustomKeyStoreId),
        creationDate: isoOf(metadata.CreationDate),
        deletionDate: isoOf(metadata.DeletionDate),
        pendingDeletionWindowInDays: optionalNumber(metadata.PendingDeletionWindowInDays),
        validTo: isoOf(metadata.ValidTo),
      }
    },
    {
      now: options.now,
      denial: options.denial,
      // A key's metadata is never meaningfully "empty": an answer with nothing
      // in it is a fault and throws above. EMPTY here would be a key reported as
      // having no metadata, which is not a thing.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

interface RotationFacts {
  enabled: boolean
  periodDays: number | null
  nextRotationAt: string | null
}

async function readRotation(
  gw: AwsGateway,
  keyId: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<RotationFacts>> {
  return readAws<RotationFacts>(
    "kms:GetKeyRotationStatus",
    async () => {
      const response = (await gw.call("kms:GetKeyRotationStatus", {
        KeyId: keyId,
      })) as GetKeyRotationStatusResponse
      const enabled = optionalBoolean(response?.KeyRotationEnabled)
      if (enabled === null) {
        // Not defaulted in either direction. `false` invents a finding an
        // operator will chase; `true` hides one.
        throw new Error(
          `kms:GetKeyRotationStatus answered for ${keyId} without KeyRotationEnabled. Rotation ` +
            `this engine did not read must not render as on or as off.`,
        )
      }
      return {
        enabled,
        periodDays: optionalNumber(response?.RotationPeriodInDays),
        nextRotationAt: isoOf(response?.NextRotationDate),
      }
    },
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

/**
 * The rotation state for one key, given what the detail said about it.
 *
 * Exported because it is where the "an AWS-managed key is not a passing check"
 * rule physically lives, and a reader should be able to find it.
 */
export function rotationStateFrom(
  detail: AwsRead<KeyDetail>,
  rotation: AwsRead<RotationFacts> | null,
): RotationState {
  if (detail.state !== "ACTUAL" && detail.state !== "STALE") {
    return {
      kind: "unknown",
      why:
        `whether this key rotates is unknown because its metadata was not read — ` +
        `${describeRead(detail, "kms:DescribeKey")}`,
    }
  }
  const meta = detail.value
  if (meta.management.kind === "aws") {
    return {
      kind: "aws-managed",
      why:
        `this is an AWS-managed key (KeyManager AWS). AWS rotates it on its own schedule and no ` +
        `customer setting exists, so it is neither a rotation finding nor evidence that this ` +
        `estate rotates its keys. It is excluded from the rotation posture.`,
    }
  }
  if (meta.management.kind === "unrecognised") {
    return {
      kind: "unknown",
      why:
        `kms:DescribeKey reported KeyManager ${JSON.stringify(meta.management.raw)}, which this ` +
        `engine does not recognise. Treating it as customer-managed would put a key AWS may ` +
        `control into the compliance denominator; treating it as AWS-managed would hide a finding.`,
    }
  }

  const inapplicable = rotationInapplicableReason(meta)
  if (inapplicable !== null) return { kind: "not-applicable", why: inapplicable }

  if (rotation === null) {
    return {
      kind: "unknown",
      why:
        `this engine reads at most ${MAX_KEY_DETAIL_READS} keys per load and this key's rotation ` +
        `status was not among them. Not read is not "not rotating".`,
    }
  }

  if (rotation.state === "ACTUAL" || rotation.state === "STALE") {
    if (rotation.value.enabled) {
      return {
        kind: "enabled",
        periodDays: rotation.value.periodDays,
        nextRotationAt: rotation.value.nextRotationAt,
      }
    }
    return {
      kind: "disabled",
      why:
        `customer-managed key ${meta.keyId} has automatic rotation switched OFF. Its key material ` +
        `never changes, so every object ever encrypted under it shares one key.`,
    }
  }

  // `UnsupportedOperationException` reaches here as ERROR — AWS raises it for
  // key kinds the metadata check above did not catch (a spec this SDK does not
  // model yet). Mapped to not-applicable rather than to a finding an operator
  // cannot act on.
  if (rotation.state === "ERROR" && rotation.code === "UnsupportedOperationException") {
    return {
      kind: "not-applicable",
      why:
        `AWS answered UnsupportedOperationException for kms:GetKeyRotationStatus on ${meta.keyId}: ` +
        `automatic rotation cannot be enabled on this key.`,
    }
  }

  return {
    kind: "unknown",
    why: describeRead(rotation, `rotation status for ${meta.keyId}`),
  }
}

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): KeyAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this key's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this key has no ARN this engine can state, so it cannot be joined against the tag index. " +
        "Unattributed would be a claim about its tags; this is a claim about ours.",
    }
  }
  const tags = index.get(arn)
  // The tag index answered and this ARN is not in it. That IS an observation:
  // the Resource Groups Tagging API returns resources that have tags, so an
  // absence means no tags at all, which is what `unattributed` says.
  if (tags === undefined) return { kind: "unattributed" }
  const decided = attributionOf(tags)
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.tenantSlug }
    case "shared":
      return { kind: "shared" }
    case "unattributed":
      return { kind: "unattributed" }
  }
}

/**
 * A key's ARN, assembled from the resolved identity.
 *
 * Used only when neither the listing nor the describe returned one. The
 * partition and region come from `identity` and from nowhere else — a partition
 * guessed as "aws" is the GE-010-007 shape of defect. Returns null when identity
 * is unresolved, because half an ARN is worse than none: it would join against
 * the tag index, match nothing, and read exactly like an untagged key.
 */
export function deriveKeyArn(keyId: string, identity: AwsRead<Identity>): string | null {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return null
  if (!keyId) return null
  const { partition, region, accountId } = identity.value
  if (!partition || !region || !accountId) return null
  return `arn:${partition}:kms:${region}:${accountId}:key/${keyId}`
}

/* ----------------------------------------------------------- the surface -- */

/**
 * Every KMS key the estate can see, with its state, its manager, its rotation
 * and its tenant.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function keyReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<KmsReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const listing = await listKeyHandles(gw, { now, denial })
  const asOf = now().toISOString()
  const refreshMs = {
    keys: CAPABILITIES["kms:ListKeys"].refreshMs,
    detail: CAPABILITIES["kms:DescribeKey"].refreshMs,
    rotation: CAPABILITIES["kms:GetKeyRotationStatus"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listing.read.state !== "ACTUAL" && listing.read.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so this already IS an `AwsRead<readonly KeyReading[]>`. A
    // cast here would be the place an empty array could later be smuggled in.
    const keys: AwsRead<readonly KeyReading[]> = listing.read
    const truncation: KeyListTruncation = {
      kind: "unknown",
      why: describeRead(listing.read, "the KMS key listing"),
    }
    return {
      identity,
      tagged,
      keys,
      truncation,
      posture: rotationPosture(keys, truncation),
      asOf,
      refreshMs,
    }
  }

  const handles = listing.read.value
  const details: Array<AwsRead<KeyDetail>> = new Array(handles.length)
  const rotations: Array<AwsRead<RotationFacts> | null> = new Array(handles.length).fill(null)
  let detailsRead = 0

  for (let start = 0; start < handles.length; start += DETAIL_CONCURRENCY) {
    const batch = handles.slice(start, start + DETAIL_CONCURRENCY)
    const read = await Promise.all(
      batch.map(async (handle, offset) => {
        const position = start + offset
        if (position >= MAX_KEY_DETAIL_READS) {
          const skipped: AwsRead<KeyDetail> = {
            state: "UNCONFIGURED",
            capability: "kms:DescribeKey",
            why:
              `this engine reads at most ${MAX_KEY_DETAIL_READS} key descriptions per load and ` +
              `this key is number ${position + 1} of ${handles.length}. Nothing about it was read ` +
              `— which is not the same as its being healthy.`,
          }
          return { detail: skipped, rotation: null }
        }
        const detail = await readKeyDetail(gw, handle.keyId, { now, denial })

        // The rotation call is made ONLY for customer-managed keys on which
        // rotation is a setting that exists. An AWS-managed key would answer
        // `true` and that answer is not a compliance fact — asking would spend a
        // call to obtain a number that must not be counted. Every skip is
        // represented by an arm of RotationState, never by a default.
        const rotatable =
          (detail.state === "ACTUAL" || detail.state === "STALE") &&
          detail.value.management.kind === "customer" &&
          rotationInapplicableReason(detail.value) === null
        const rotation = rotatable
          ? await readRotation(gw, handle.keyId, { now, denial })
          : null
        return { detail, rotation }
      }),
    )
    for (let i = 0; i < read.length; i += 1) {
      details[start + i] = read[i].detail
      rotations[start + i] = read[i].rotation
      if (start + i < MAX_KEY_DETAIL_READS) detailsRead += 1
    }
  }

  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"

  const readings: KeyReading[] = handles.map((handle, i) => {
    const detail = details[i]
    const fromDetail =
      detail.state === "ACTUAL" || detail.state === "STALE" ? detail.value.arn : null
    const fromListing = handle.keyArn
    const fromAws = fromListing ?? fromDetail
    const derived = fromAws === null ? deriveKeyArn(handle.keyId, identity) : null
    const arn = fromAws ?? derived
    const arnProvenance = fromListing
      ? "AWS's own KeyArn from kms:ListKeys"
      : fromDetail
        ? "AWS's own Arn from kms:DescribeKey — the listing did not carry one"
        : derived
          ? "assembled from the resolved identity's partition, region and account — neither the " +
            "listing nor the description carried an ARN"
          : "none — no ARN was returned and identity is unresolved, so this engine will not " +
            "assemble one it cannot stand behind"

    const parts = arn ? arn.split(":") : []
    const arnHasParts = parts.length >= 6 && parts[0] === "arn"

    return {
      keyId: handle.keyId,
      arn,
      arnProvenance,
      // From the ARN when there is one — AWS's answer beats anything assembled —
      // and otherwise from the resolved identity. Never from a literal.
      partition: arnHasParts ? parts[1] : identityResolved ? identity.value.partition : null,
      region: arnHasParts ? parts[3] : identityResolved ? identity.value.region : null,
      accountId: arnHasParts
        ? parts[4]
        : detail.state === "ACTUAL" || detail.state === "STALE"
          ? detail.value.accountId
          : identityResolved
            ? identity.value.accountId
            : null,
      attribution: attributionFor(arn, tagged, index),
      detail,
      rotation: rotationStateFrom(detail, rotations[i]),
      lifecycle:
        detail.state === "ACTUAL" || detail.state === "STALE"
          ? lifecycleOf(detail.value)
          : { kind: "unknown", why: describeRead(detail, `key ${handle.keyId}`) },
      aliases: ALIASES_NOT_READABLE,
      refreshMs: refreshMs.detail,
      asOf,
    }
  })

  const keys: AwsRead<readonly KeyReading[]> = { ...listing.read, value: readings }
  const truncation = truncationOf(
    handles.length,
    listing.hadMore,
    listing.pagesRead,
    detailsRead,
  )
  return {
    identity,
    tagged,
    keys,
    truncation,
    posture: rotationPosture(keys, truncation),
    asOf,
    refreshMs,
  }
}

/** Which bounds, if any, this load hit. Exported so the derivation is inspectable. */
export function truncationOf(
  keysRead: number,
  hadMorePages: boolean,
  pagesRead: number,
  detailsRead: number,
): KeyListTruncation {
  const detailBudgetHit = keysRead > MAX_KEY_DETAIL_READS
  const pagesWhy =
    `kms:ListKeys still had a NextMarker after ${MAX_KEY_PAGES} page(s); ${keysRead} key(s) were ` +
    `read and there are more this engine did not list.`
  const detailWhy =
    `${keysRead} key(s) were listed and only the first ${detailsRead} were described — this ` +
    `engine reads at most ${MAX_KEY_DETAIL_READS} descriptions per load.`
  if (hadMorePages && detailBudgetHit) {
    return { kind: "both", keysRead, pagesRead, detailsRead, why: `${pagesWhy} ${detailWhy}` }
  }
  if (hadMorePages) return { kind: "more-keys", keysRead, pagesRead, why: pagesWhy }
  if (detailBudgetHit) return { kind: "detail-budget", keysRead, detailsRead, why: detailWhy }
  return { kind: "complete", keysRead }
}

/**
 * The rotation posture of everything that was read.
 *
 * Exported and pure so the counting rule can be reasoned about on its own, but
 * `keyReadings` is the only production caller. Note what is NOT here: no
 * percentage, and no total that mixes AWS-managed keys into the denominator.
 */
export function rotationPosture(
  keys: AwsRead<readonly KeyReading[]>,
  truncation: KeyListTruncation,
): KeyRotationPosture {
  const empty: KeyRotationPosture = {
    customerManagedRead: 0,
    rotating: 0,
    notRotating: [],
    notApplicable: [],
    rotationUnknown: [],
    awsManagedExcluded: 0,
    unrecognisedManagement: [],
    pendingDeletion: [],
    unreadable: [],
    complete: false,
  }
  if (keys.state !== "ACTUAL" && keys.state !== "STALE") return empty

  const notRotating: string[] = []
  const notApplicable: string[] = []
  const rotationUnknown: string[] = []
  const unrecognisedManagement: string[] = []
  const pendingDeletion: { keyId: string; deletionDate: string | null }[] = []
  const unreadable: string[] = []
  let rotating = 0
  let awsManagedExcluded = 0

  for (const key of keys.value) {
    if (key.detail.state !== "ACTUAL" && key.detail.state !== "STALE") {
      unreadable.push(key.keyId)
      continue
    }
    if (key.detail.value.management.kind === "unrecognised") {
      unrecognisedManagement.push(key.keyId)
    }
    if (key.lifecycle.kind === "pending-deletion") {
      pendingDeletion.push({ keyId: key.keyId, deletionDate: key.lifecycle.deletionDate })
    }
    switch (key.rotation.kind) {
      case "enabled":
        rotating += 1
        break
      case "disabled":
        notRotating.push(key.keyId)
        break
      case "not-applicable":
        notApplicable.push(key.keyId)
        break
      case "aws-managed":
        awsManagedExcluded += 1
        break
      case "unknown":
        rotationUnknown.push(key.keyId)
        break
    }
  }

  return {
    // The denominator is exactly the keys whose rotation this engine READ. A
    // key it could not read is in `rotationUnknown` and in no total.
    customerManagedRead: rotating + notRotating.length,
    rotating,
    notRotating: notRotating.sort(),
    notApplicable: notApplicable.sort(),
    rotationUnknown: rotationUnknown.sort(),
    awsManagedExcluded,
    unrecognisedManagement: unrecognisedManagement.sort(),
    pendingDeletion: [...pendingDeletion].sort((a, b) => (a.keyId < b.keyId ? -1 : 1)),
    unreadable: unreadable.sort(),
    complete:
      truncation.kind === "complete" &&
      unreadable.length === 0 &&
      rotationUnknown.length === 0 &&
      unrecognisedManagement.length === 0,
  }
}

/* ------------------------------------------------------------ rendering -- */

/** The sentence a surface prints for one key's rotation. Five visibly different. */
export function describeRotation(rotation: RotationState): string {
  switch (rotation.kind) {
    case "enabled": {
      const period =
        rotation.periodDays === null
          ? "on AWS's default annual schedule"
          : `every ${rotation.periodDays} day(s)`
      const next = rotation.nextRotationAt === null ? "" : `, next on ${rotation.nextRotationAt}`
      return `rotating ${period}${next}`
    }
    case "disabled":
      return `NOT ROTATING — ${rotation.why}`
    case "aws-managed":
      return `AWS-managed — ${rotation.why}`
    case "not-applicable":
      return `rotation not applicable — ${rotation.why}`
    case "unknown":
      return `rotation unknown — ${rotation.why}`
  }
}

/** The sentence a surface prints for one key's lifecycle. */
export function describeLifecycle(lifecycle: KeyLifecycle): string {
  switch (lifecycle.kind) {
    case "active":
      return "enabled"
    case "disabled":
      return `DISABLED (${lifecycle.keyState}) — nothing can decrypt with this key while it stays disabled`
    case "pending-deletion":
      return `PENDING DELETION — ${lifecycle.why}${
        lifecycle.windowDays === null ? "" : ` Waiting period: ${lifecycle.windowDays} day(s).`
      }`
    case "other":
      return `state ${lifecycle.keyState}`
    case "unknown":
      return `state unknown — ${lifecycle.why}`
  }
}

/** The sentence a surface prints for one key's attribution. */
export function describeKeyAttribution(attribution: KeyAttribution): string {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug
    case "shared":
      return "shared — platform overhead, decided"
    case "unattributed":
      return "unattributable — missing tenure:tenant"
    case "unknown":
      return `attribution unknown — ${attribution.why}`
  }
}

/** The sentence a surface prints for the truncation signal. */
export function describeTruncation(truncation: KeyListTruncation): string {
  switch (truncation.kind) {
    case "complete":
      return `complete — ${truncation.keysRead} key(s) listed and every one described`
    case "more-keys":
    case "detail-budget":
    case "both":
      return `PARTIAL — ${truncation.why}`
    case "unknown":
      return `unknown — ${truncation.why}`
  }
}

/** The sentence a surface prints for the rotation posture. Never a percentage. */
export function describePosture(posture: KeyRotationPosture): string {
  const head =
    `${posture.rotating} of ${posture.customerManagedRead} customer-managed key(s) whose rotation ` +
    `was read are rotating`
  const finding =
    posture.notRotating.length === 0
      ? ""
      : `. NOT ROTATING: ${posture.notRotating.join(", ")}`
  const aws =
    posture.awsManagedExcluded === 0
      ? ""
      : `. ${posture.awsManagedExcluded} AWS-managed key(s) excluded — AWS rotates them and they ` +
        `are not evidence this estate does`
  const notApplicable =
    posture.notApplicable.length === 0
      ? ""
      : `. ${posture.notApplicable.length} key(s) cannot have automatic rotation`
  const unknown =
    posture.rotationUnknown.length === 0
      ? ""
      : `. Rotation UNKNOWN for ${posture.rotationUnknown.join(", ")}`
  const unrecognised =
    posture.unrecognisedManagement.length === 0
      ? ""
      : `. Unrecognised KeyManager on ${posture.unrecognisedManagement.join(", ")}`
  const deletion =
    posture.pendingDeletion.length === 0
      ? ""
      : `. PENDING DELETION: ${posture.pendingDeletion
          .map((k) => `${k.keyId} on ${k.deletionDate ?? "a date AWS did not return"}`)
          .join(", ")}`
  const unreadable =
    posture.unreadable.length === 0 ? "" : `. ${posture.unreadable.length} key(s) unreadable`
  const completeness = posture.complete
    ? ""
    : ". This posture is NOT a verdict over the whole estate — something was not read"
  return `${head}${finding}${aws}${notApplicable}${unknown}${unrecognised}${deletion}${unreadable}${completeness}`
}

/** The sentence a surface prints for one key. One funnel, so states cannot drift. */
export function describeKey(key: KeyReading): string {
  const where =
    key.region && key.partition
      ? `${key.region} (partition ${key.partition})`
      : "region unknown — identity is unresolved"
  const head = `${key.keyId} — ${where} — ${describeKeyAttribution(key.attribution)}`

  if (key.detail.state === "ACTUAL" || key.detail.state === "STALE") {
    const d = key.detail.value
    const manager =
      d.management.kind === "customer"
        ? "customer-managed"
        : d.management.kind === "aws"
          ? "AWS-managed"
          : `KeyManager ${d.management.raw} (unrecognised)`
    return (
      `${head} — ${manager} — ${d.description ?? "no description set"} — ` +
      `${describeLifecycle(key.lifecycle)} — ${describeRotation(key.rotation)} — ` +
      `aliases: ${key.aliases.why} — as of ${key.asOf}, refreshed every ` +
      `${Math.round(key.refreshMs / 1000)}s`
    )
  }
  // Every other state goes through the one renderer, so a refused describe reads
  // as a refusal here exactly as it does everywhere else — never as "enabled".
  return `${head} — ${describeRead(key.detail, `key ${key.keyId}`)} — ${describeRotation(key.rotation)}`
}

export interface KmsLine {
  label: string
  text: string
}

/**
 * What a KMS surface prints.
 *
 * A surface agent renders exactly these strings. The tests assert on them, which
 * is what makes the mutation proofs land on the production path rather than on a
 * helper nothing calls.
 */
export function kmsLines(readings: KmsReadings): readonly KmsLine[] {
  const lines: KmsLine[] = [
    {
      label: "Keys",
      text: describeRead(
        readings.keys,
        `KMS keys read from AWS, refreshed every ${Math.round(readings.refreshMs.keys / 1000)}s`,
      ),
    },
    { label: "Coverage", text: describeTruncation(readings.truncation) },
    { label: "Rotation posture", text: describePosture(readings.posture) },
  ]
  if (readings.keys.state === "ACTUAL" || readings.keys.state === "STALE") {
    for (const key of readings.keys.value) {
      lines.push({ label: key.keyId, text: describeKey(key) })
    }
  }
  return lines
}
