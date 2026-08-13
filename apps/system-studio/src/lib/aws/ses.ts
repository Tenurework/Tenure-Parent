/**
 * STUDIO-070-004 (SES) — the mail plane, read back from AWS.
 *
 * `infrastructure/terraform/ses.tf` creates a domain identity for
 * `tenurework.com`, an email identity for the from-address, a configuration set
 * with `tls_policy = "Require"` and reputation metrics on, and an account-level
 * suppression attribute covering BOUNCE and COMPLAINT. Nothing in the running
 * product had ever read any of it back. So two different outages were the same
 * blank screen:
 *
 *   * the domain identity exists in Terraform and is **not verified**, because
 *     DKIM CNAMEs have to be added at the registrar after apply and nothing
 *     checks that anybody did — SES accepts the send and drops it;
 *   * the account is still in the **SES sandbox**, in which SES delivers only to
 *     recipients that are themselves verified identities and silently refuses
 *     every other address.
 *
 * The second is the single most valuable fact on this surface and the one this
 * module is most careful about. `ProductionAccessEnabled` is a boolean AWS
 * either states or does not, and a missing field is NOT `false` and emphatically
 * not `true`: production access is an approval AWS grants after reviewing a
 * request, and a console that prints "production access granted" off an absent
 * field has invented a sign-off. Hence `Stated<T>` — every fact SES might omit
 * is either `{ stated: true, value }` or `{ stated: false, why }`, and a caller
 * that reaches for `.value` without narrowing does not compile. Same mechanism
 * as `AwsRead<T>`, one level down: `AwsRead` keeps "we could not look" apart
 * from "there is nothing", and `Stated` keeps "AWS did not say" apart from "AWS
 * said no".
 *
 * `Details.ReviewDetails` — AWS's own status for a production-access request —
 * is carried verbatim when SES returns it and is `stated: false` when it does
 * not. It is never synthesised, never defaulted and carries no date this module
 * made up.
 *
 * ## Everything else here follows the directory's existing rules
 *
 * * Every read returns `AwsRead<T>` from `read.ts`. A refused call is DENIED
 *   carrying the principal, the action and a pasteable minimum statement — never
 *   an empty list. "SES has no verified identities" and "we were not allowed to
 *   ask" are the two answers this whole vocabulary exists to keep apart.
 * * Throttles use `throttle.ts`'s schedule, not a second one invented here. The
 *   attempt budget is `READ_ATTEMPTS` and the first pause is `backoffMs(2)`, so
 *   the `retryAfterMs` a THROTTLED SES panel prints is `backoffMs(READ_ATTEMPTS + 1)`
 *   — the same number `readWithBackoff` would have put in `nextAttemptAt`.
 *   Changing the schedule in `throttle.ts` changes it here, which is the point.
 * * Region, partition and account come from `resolveIdentity()` — the resolved
 *   STS answer — and never from a literal. GE-010-007 was a hardcoded
 *   `us-east-1`; an SES ARN built with one would attribute a Frankfurt identity
 *   to a Virginia estate and mis-key every tag lookup.
 * * Attribution goes through the Resource Groups Tagging API path that already
 *   exists in `tags.ts`. SES identities and configuration sets are both taggable
 *   and both appear in that index.
 * * Every reading carries its own `asOf` and its capability's own `refreshMs`.
 *   SES has three cadences, not one: account state moves in seconds
 *   (`SES_ACCOUNT_TTL_MS`), configuration moves when Terraform runs
 *   (`SES_CONFIG_TTL_MS`), and the suppression list grows on every bounce
 *   (`SES_SUPPRESSION_TTL_MS`).
 *
 * ## On the suppression list and the people in it
 *
 * `ListSuppressedDestinations` returns real addresses of real people — a
 * student who bounced is on it by name. The entries are carried, because "why
 * did this one person not get their reminder" is the question the list answers
 * and a masked list cannot. But the SUMMARY a page prints by default is counts
 * by reason and by domain, which is the shape of the problem without anybody's
 * address in it, and every entry also carries `maskedAddress` so a surface that
 * only needs the shape has one to render. A page choosing to print `address` is
 * making that choice explicitly rather than by default.
 */

import {
  CAPABILITIES,
  SES_ACCOUNT_TTL_MS,
  SES_CONFIG_TTL_MS,
  SES_SUPPRESSION_TTL_MS,
  type Capability,
} from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type Attribution, type TaggedResource } from "./tags"
import { backoffMs, READ_ATTEMPTS } from "./throttle"

/* ------------------------------------------------------- stated, or not -- */

/**
 * A fact AWS either stated or did not.
 *
 * There is no third arm and no default. `SendingEnabled` absent from a
 * `GetAccount` response is not `false` — SES simply did not say, and the two
 * render differently because acting on them differs: "sending is disabled on
 * this account" is a support case, and "we cannot tell whether sending is
 * enabled" is a reason to look again.
 *
 * The type is what enforces it. `{ stated: false }` has no `value` field, so
 * `account.productionAccess.value` without a narrow is a compile error rather
 * than `undefined` rendering as an empty chip.
 */
export type Stated<T> = { stated: true; value: T } | { stated: false; why: string }

/** Wrap an optional SDK field. `why` is the sentence an operator reads. */
export function stated<T>(value: T | null | undefined, why: string): Stated<T> {
  return value === null || value === undefined ? { stated: false, why } : { stated: true, value }
}

/** The sentence a surface prints for a stated-or-not fact. */
export function describeStated<T>(fact: Stated<T>, render: (value: T) => string): string {
  return fact.stated ? render(fact.value) : `unstated — ${fact.why}`
}

/* --------------------------------------------------------- attribution -- */

/**
 * Who an SES resource belongs to.
 *
 * `Attribution` from `tags.ts` unchanged — tenant, shared, unattributed — plus
 * a fourth arm this module needs and that one does not have: the tag index
 * itself was not readable, or identity was not resolved so the ARN to look up
 * could not be built. Folding that into `unattributed` would say "nobody tagged
 * this" about a resource nobody was allowed to look at, which is the
 * STUDIO-000-007 defect wearing an attribution's clothes.
 *
 * `unattributed` is deliberately NOT folded into `shared` either. `tags.ts`
 * carries the reason at length: an untagged resource becomes every tenant's
 * problem the moment somebody treats it as platform overhead.
 */
export type SesAttribution = Attribution | { kind: "unknown"; why: string }

export function describeSesAttribution(attribution: SesAttribution): string {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug
    case "shared":
      return "shared — platform mail, decided"
    case "unattributed":
      return "unattributable — missing tenure:tenant"
    case "unknown":
      return `unknown — ${attribution.why}`
  }
}

/* -------------------------------------------------------------- shapes -- */

export interface SesSendQuota {
  /** Messages SES will accept in a rolling 24 hours. 200 is the sandbox cap. */
  max24HourSend: Stated<number>
  /** Messages per second. */
  maxSendRate: Stated<number>
  sentLast24Hours: Stated<number>
}

/**
 * Whether SES will deliver to an arbitrary recipient.
 *
 * Three arms, and the third is the one that earns the type. A sandbox account
 * delivers only to verified identities and drops everything else without an
 * error the sender can see, so `SANDBOX` is an outage this console has to name.
 * `UNSTATED` means `GetAccount` answered without `ProductionAccessEnabled` —
 * which this engine reports rather than resolving, because resolving it either
 * way is a claim about an AWS approval nobody made.
 */
export type ProductionAccess =
  | { state: "PRODUCTION"; note: string }
  | { state: "SANDBOX"; consequence: string }
  | { state: "UNSTATED"; why: string }

export interface SesAccount {
  productionAccess: ProductionAccess
  /** Account-wide sending switch. Off means SES accepts nothing at all. */
  sendingEnabled: Stated<boolean>
  /** `HEALTHY`, `PROBATION`, `SHUTDOWN` — SES's reputation enforcement. */
  enforcementStatus: Stated<string>
  quota: SesSendQuota
  /** Fraction of the 24-hour quota already spent, 0..1. Unstated if either half is. */
  quotaUsed: Stated<number>
  /** The reasons SES auto-suppresses on, account-wide. `ses.tf` sets BOUNCE + COMPLAINT. */
  suppressedReasons: Stated<readonly string[]>
  /**
   * AWS's own review of this account's production-access request, verbatim.
   *
   * Carried only when SES returns `Details.ReviewDetails`. Never constructed,
   * never dated by this module, never inferred from `ProductionAccessEnabled`.
   * An approval is a thing a human at AWS granted or did not.
   */
  productionAccessReview: Stated<{ status: string; caseId: string | null }>
  /**
   * The SES account is one account-wide resource — there is no per-tenant SES
   * account to attribute — so this is `shared` as a statement of fact rather
   * than as a fallback for a missing tag.
   */
  attribution: SesAttribution
}

/** Whether SES will send FROM an identity. */
export type SesVerification =
  | { state: "VERIFIED"; sesStatus: string }
  | { state: "NOT_VERIFIED"; sesStatus: string; consequence: string }
  | { state: "UNSTATED"; why: string }

export interface SesIdentity {
  /** SES's own name for it — a domain, or an address. */
  name: string
  /** `DOMAIN`, `EMAIL_ADDRESS`, `MANAGED_DOMAIN`. */
  identityType: Stated<string>
  verification: SesVerification
  sendingEnabled: Stated<boolean>
  /**
   * Built from the resolved identity's partition, region and account.
   *
   * `null` when identity itself is unresolved — in which case `attribution` is
   * `unknown`, because there was no key to look the tags up under.
   */
  arn: string | null
  attribution: SesAttribution
}

export interface SesConfigurationSet {
  name: string
  /** `REQUIRE` or `OPTIONAL`. `ses.tf` asks for Require. */
  tlsPolicy: Stated<string>
  sendingEnabled: Stated<boolean>
  reputationMetricsEnabled: Stated<boolean>
  suppressedReasons: Stated<readonly string[]>
  arn: string | null
  attribution: SesAttribution
}

export interface SuppressedDestination {
  /** The address SES holds. Real, and a real person's. */
  address: string
  /** Local part removed. The operationally useful half without the person. */
  maskedAddress: string
  domain: string
  /** `BOUNCE` or `COMPLAINT`. */
  reason: Stated<string>
  lastUpdatedAt: Stated<string>
}

export interface SesSuppression {
  entries: readonly SuppressedDestination[]
  /** Counts by reason — the shape of the problem with nobody's address in it. */
  byReason: Readonly<Record<string, number>>
  byDomain: Readonly<Record<string, number>>
  /**
   * SES still had pages when the page budget ran out.
   *
   * Carried rather than swallowed: a truncated list that renders as a complete
   * one is a console asserting an address is NOT suppressed when it never looked.
   */
  truncated: boolean
}

/* ------------------------------------------------- the SDK's own shapes -- */
/* Declared rather than imported. `client.ts` is the only module permitted to
 * import `@aws-sdk/*`; see `tests/architecture/forbidden-clients.test.mjs`. */

interface GetAccountResponse {
  ProductionAccessEnabled?: boolean
  SendingEnabled?: boolean
  EnforcementStatus?: string
  SendQuota?: { Max24HourSend?: number; MaxSendRate?: number; SentLast24Hours?: number }
  SuppressionAttributes?: { SuppressedReasons?: string[] }
  Details?: { ReviewDetails?: { Status?: string; CaseId?: string } }
}

interface ListEmailIdentitiesResponse {
  EmailIdentities?: Array<{
    IdentityType?: string
    IdentityName?: string
    SendingEnabled?: boolean
    VerificationStatus?: string
  }>
  NextToken?: string
}

interface ListConfigurationSetsResponse {
  ConfigurationSets?: string[]
  NextToken?: string
}

interface GetConfigurationSetResponse {
  ConfigurationSetName?: string
  DeliveryOptions?: { TlsPolicy?: string }
  ReputationOptions?: { ReputationMetricsEnabled?: boolean }
  SendingOptions?: { SendingEnabled?: boolean }
  SuppressionOptions?: { SuppressedReasons?: string[] }
}

interface ListSuppressedDestinationsResponse {
  SuppressedDestinationSummaries?: Array<{
    EmailAddress?: string
    Reason?: string
    LastUpdateTime?: string | Date
  }>
  NextToken?: string
}

/* ------------------------------------------------------------ plumbing -- */

/**
 * How many pages to walk before reporting the list truncated.
 *
 * A runaway page loop against a suppression list with a hundred thousand
 * entries is an outage on the page that is supposed to report outages.
 */
export const MAX_PAGES = 20

/**
 * The retry schedule, taken from `throttle.ts` rather than restated.
 *
 * `backoffMs(2)` is the pause after the first failure — `backoffMs(1)` is zero
 * because the first attempt is not a retry — and `readAws` doubles it per
 * attempt, which reproduces `backoffMs(3)`, `backoffMs(4)` and so on exactly.
 */
export const SES_READ_ATTEMPTS = READ_ATTEMPTS
export const SES_FIRST_BACKOFF_MS = backoffMs(2)

/** What a THROTTLED SES panel will say it is waiting, so a test can assert it. */
export const SES_RETRY_AFTER_MS = backoffMs(READ_ATTEMPTS + 1)

interface SesContext {
  now: () => Date
  denial: DenialContext
  sleep?: (ms: number) => Promise<void>
  /** Resolved, or null — in which case no SES ARN can be built. */
  identity: Identity | null
  tags: Map<string, Readonly<Record<string, string>>>
  /** Whether the tag index was readable at all. */
  tagsReadable: boolean
  /** Why it was not, when it was not. */
  tagsWhy: string
}

function readOptions(ctx: SesContext, isEmpty?: (value: unknown) => boolean) {
  return {
    now: ctx.now,
    denial: ctx.denial,
    attempts: SES_READ_ATTEMPTS,
    backoffMs: SES_FIRST_BACKOFF_MS,
    sleep: ctx.sleep,
    isEmpty,
  }
}

/**
 * An SES ARN, built from the resolved estate and nothing else.
 *
 * No region literal, no partition literal, no account literal. If identity did
 * not resolve there is no ARN — the function returns null rather than assembling
 * one out of defaults, because an ARN with a guessed region silently misses
 * every entry in the tag index and the resource renders as untagged.
 */
export function sesArn(
  identity: Identity | null,
  kind: "identity" | "configuration-set",
  name: string,
): string | null {
  if (!identity) return null
  return `arn:${identity.partition}:ses:${identity.region}:${identity.accountId}:${kind}/${name}`
}

function attributionFor(arn: string | null, ctx: SesContext): SesAttribution {
  if (!arn) {
    return {
      kind: "unknown",
      why: "sts:GetCallerIdentity has not answered, so this resource's ARN could not be built to look its tags up",
    }
  }
  if (!ctx.tagsReadable) return { kind: "unknown", why: ctx.tagsWhy }
  return attributionOf(ctx.tags.get(arn) ?? {})
}

/**
 * Whether a reading actually carries a value.
 *
 * A type predicate rather than a boolean, so the compiler does the narrowing.
 * `read.value` after `if (!hasValue(read)) return read` is safe; `read.value`
 * without it does not compile — which is `read.ts`'s whole mechanism, used
 * rather than worked around.
 *
 * The `return read` in the false branch is also what carries one capability's
 * refusal to another's surface: `ListConfigurationSets` names the sets that
 * `GetConfigurationSet` then describes, and if the LIST was refused the detail
 * read must report THAT refusal — naming `ses:ListConfigurationSets` and its
 * minimum statement — rather than reporting an empty set list. An operator told
 * "no configuration sets" concludes Terraform never applied.
 *
 * The value-less arms of `AwsRead<T>` mention no `T`, so a refusal read for one
 * value type IS a refusal read for another, with no cast and no second
 * vocabulary of states.
 */
export function hasValue<T>(read: AwsRead<T>): read is Extract<AwsRead<T>, { value: T }> {
  return read.state === "ACTUAL" || read.state === "STALE"
}

/* --------------------------------------------------------- the reads -- */

const SANDBOX_CONSEQUENCE =
  "this account is in the SES sandbox: SES delivers only to recipients that are themselves " +
  "verified identities and refuses every other address, so mail to a real member is accepted " +
  "by the application and never arrives"

async function readAccount(gw: AwsGateway, ctx: SesContext): Promise<AwsRead<SesAccount>> {
  return readAws<SesAccount>(
    "ses:GetAccount",
    async () => {
      const response = (await gw.call("ses:GetAccount")) as GetAccountResponse
      const quota: SesSendQuota = {
        max24HourSend: stated(
          response?.SendQuota?.Max24HourSend,
          "ses:GetAccount answered without SendQuota.Max24HourSend",
        ),
        maxSendRate: stated(
          response?.SendQuota?.MaxSendRate,
          "ses:GetAccount answered without SendQuota.MaxSendRate",
        ),
        sentLast24Hours: stated(
          response?.SendQuota?.SentLast24Hours,
          "ses:GetAccount answered without SendQuota.SentLast24Hours",
        ),
      }
      const review = response?.Details?.ReviewDetails
      return {
        productionAccess: productionAccessFrom(response?.ProductionAccessEnabled),
        sendingEnabled: stated(
          response?.SendingEnabled,
          "ses:GetAccount answered without SendingEnabled; whether this account can send at all is not established",
        ),
        enforcementStatus: stated(
          response?.EnforcementStatus,
          "ses:GetAccount answered without EnforcementStatus",
        ),
        quota,
        quotaUsed: quotaUsedFrom(quota),
        suppressedReasons: stated(
          response?.SuppressionAttributes?.SuppressedReasons,
          "ses:GetAccount answered without SuppressionAttributes.SuppressedReasons",
        ),
        // Verbatim or absent. Never assembled, and never given a date.
        productionAccessReview:
          review && review.Status
            ? { stated: true, value: { status: review.Status, caseId: review.CaseId ?? null } }
            : {
                stated: false,
                why:
                  "SES returned no Details.ReviewDetails. Whether a production-access request was reviewed, " +
                  "by whom and when is not something this engine can state",
              },
        attribution: { kind: "shared" },
      }
    },
    // An account read that succeeded is never "nothing". Without this the
    // default emptiness test would still say ACTUAL, but stating it here means
    // a future field rename cannot turn a real account into EMPTY.
    readOptions(ctx, () => false),
  )
}

/** The sandbox fact, and the refusal to guess it. */
export function productionAccessFrom(enabled: boolean | undefined | null): ProductionAccess {
  if (enabled === true) {
    return {
      state: "PRODUCTION",
      note: "AWS has granted this account production access; SES will deliver to any recipient",
    }
  }
  if (enabled === false) return { state: "SANDBOX", consequence: SANDBOX_CONSEQUENCE }
  return {
    state: "UNSTATED",
    why:
      "ses:GetAccount answered without ProductionAccessEnabled. Production access is an approval AWS grants, " +
      "and this engine will not report one it was not told about",
  }
}

function quotaUsedFrom(quota: SesSendQuota): Stated<number> {
  if (!quota.max24HourSend.stated || !quota.sentLast24Hours.stated) {
    return { stated: false, why: "SES did not state both the 24-hour quota and the amount sent against it" }
  }
  if (quota.max24HourSend.value <= 0) {
    return { stated: false, why: "SES reported a 24-hour quota of zero, which no fraction describes" }
  }
  return { stated: true, value: quota.sentLast24Hours.value / quota.max24HourSend.value }
}

const NOT_VERIFIED_CONSEQUENCE =
  "SES will refuse to send from this identity; a message the application queues against it is dropped"

export function verificationFrom(status: string | undefined | null): SesVerification {
  if (status === undefined || status === null || status === "") {
    return {
      state: "UNSTATED",
      why: "ses:ListEmailIdentities answered without a VerificationStatus for this identity",
    }
  }
  if (status === "SUCCESS") return { state: "VERIFIED", sesStatus: status }
  return { state: "NOT_VERIFIED", sesStatus: status, consequence: NOT_VERIFIED_CONSEQUENCE }
}

async function readIdentities(
  gw: AwsGateway,
  ctx: SesContext,
): Promise<AwsRead<readonly SesIdentity[]>> {
  return readAws<readonly SesIdentity[]>(
    "ses:ListEmailIdentities",
    async () => {
      const out: SesIdentity[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = (await gw.call("ses:ListEmailIdentities", {
          NextToken: token,
        })) as ListEmailIdentitiesResponse

        for (const entry of response?.EmailIdentities ?? []) {
          if (!entry.IdentityName) continue
          const arn = sesArn(ctx.identity, "identity", entry.IdentityName)
          out.push({
            name: entry.IdentityName,
            identityType: stated(
              entry.IdentityType,
              "ses:ListEmailIdentities answered without an IdentityType for this identity",
            ),
            verification: verificationFrom(entry.VerificationStatus),
            sendingEnabled: stated(
              entry.SendingEnabled,
              "ses:ListEmailIdentities answered without SendingEnabled for this identity",
            ),
            arn,
            attribution: attributionFor(arn, ctx),
          })
        }

        token = response?.NextToken || undefined
        if (!token) break
      }
      return out
    },
    readOptions(ctx),
  )
}

async function readConfigurationSetNames(
  gw: AwsGateway,
  ctx: SesContext,
): Promise<AwsRead<readonly string[]>> {
  return readAws<readonly string[]>(
    "ses:ListConfigurationSets",
    async () => {
      const out: string[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = (await gw.call("ses:ListConfigurationSets", {
          NextToken: token,
        })) as ListConfigurationSetsResponse
        for (const name of response?.ConfigurationSets ?? []) {
          if (name) out.push(name)
        }
        token = response?.NextToken || undefined
        if (!token) break
      }
      return out
    },
    readOptions(ctx),
  )
}

async function readConfigurationSets(
  gw: AwsGateway,
  ctx: SesContext,
  names: AwsRead<readonly string[]>,
): Promise<AwsRead<readonly SesConfigurationSet[]>> {
  // If the LIST could not be read, the detail read reports that refusal rather
  // than reporting no configuration sets. An operator told "no configuration
  // sets" would conclude Terraform never applied.
  if (!hasValue(names)) return names
  const setNames = names.value

  return readAws<readonly SesConfigurationSet[]>(
    "ses:GetConfigurationSet",
    async () => {
      const out: SesConfigurationSet[] = []
      for (const name of setNames) {
        const response = (await gw.call("ses:GetConfigurationSet", {
          ConfigurationSetName: name,
        })) as GetConfigurationSetResponse
        const arn = sesArn(ctx.identity, "configuration-set", name)
        out.push({
          name: response?.ConfigurationSetName ?? name,
          tlsPolicy: stated(
            response?.DeliveryOptions?.TlsPolicy,
            "ses:GetConfigurationSet answered without DeliveryOptions.TlsPolicy",
          ),
          sendingEnabled: stated(
            response?.SendingOptions?.SendingEnabled,
            "ses:GetConfigurationSet answered without SendingOptions.SendingEnabled",
          ),
          reputationMetricsEnabled: stated(
            response?.ReputationOptions?.ReputationMetricsEnabled,
            "ses:GetConfigurationSet answered without ReputationOptions.ReputationMetricsEnabled",
          ),
          suppressedReasons: stated(
            response?.SuppressionOptions?.SuppressedReasons,
            "ses:GetConfigurationSet answered without SuppressionOptions.SuppressedReasons",
          ),
          arn,
          attribution: attributionFor(arn, ctx),
        })
      }
      return out
    },
    readOptions(ctx),
  )
}

/** Local part removed. The domain is the half that describes the problem. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf("@")
  if (at <= 0 || at === address.length - 1) return "[address]"
  return `[address]@${address.slice(at + 1)}`
}

function domainOf(address: string): string {
  const at = address.lastIndexOf("@")
  if (at <= 0 || at === address.length - 1) return "[no domain]"
  return address.slice(at + 1).toLowerCase()
}

async function readSuppression(
  gw: AwsGateway,
  ctx: SesContext,
): Promise<AwsRead<SesSuppression>> {
  return readAws<SesSuppression>(
    "ses:ListSuppressedDestinations",
    async () => {
      const entries: SuppressedDestination[] = []
      const byReason: Record<string, number> = {}
      const byDomain: Record<string, number> = {}
      let token: string | undefined
      let truncated = false

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = (await gw.call("ses:ListSuppressedDestinations", {
          NextToken: token,
        })) as ListSuppressedDestinationsResponse

        for (const entry of response?.SuppressedDestinationSummaries ?? []) {
          if (!entry.EmailAddress) continue
          const reason = entry.Reason
          const domain = domainOf(entry.EmailAddress)
          entries.push({
            address: entry.EmailAddress,
            maskedAddress: maskAddress(entry.EmailAddress),
            domain,
            reason: stated(
              reason,
              "ses:ListSuppressedDestinations answered without a Reason for this address",
            ),
            lastUpdatedAt: stated(
              entry.LastUpdateTime instanceof Date
                ? entry.LastUpdateTime.toISOString()
                : entry.LastUpdateTime,
              "ses:ListSuppressedDestinations answered without a LastUpdateTime for this address",
            ),
          })
          if (reason) byReason[reason] = (byReason[reason] ?? 0) + 1
          byDomain[domain] = (byDomain[domain] ?? 0) + 1
        }

        token = response?.NextToken || undefined
        if (!token) break
        // The budget ran out with SES still holding pages.
        if (page === MAX_PAGES - 1) truncated = true
      }

      return { entries, byReason, byDomain, truncated }
    },
    // An object is never "empty" by the default test, and an empty suppression
    // list is a real and reassuring answer that has to be able to say EMPTY.
    readOptions(ctx, (value) => (value as SesSuppression).entries.length === 0),
  )
}

/* --------------------------------------------------------- the surface -- */

export interface SesReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  account: AwsRead<SesAccount>
  identities: AwsRead<readonly SesIdentity[]>
  configurationSetNames: AwsRead<readonly string[]>
  configurationSets: AwsRead<readonly SesConfigurationSet[]>
  suppressed: AwsRead<SesSuppression>
}

/**
 * The SES surface's whole data load, in one call.
 *
 * Production calls this with no arguments: `supplied` falls through to
 * `liveGateway()`, which dynamically imports `client.ts` and reaches the real
 * `SESv2Client`. Tests pass a stand-in gateway to the SAME function — a test
 * driving a private helper the surface does not call would stay green the day
 * the surface stopped calling it.
 */
export async function sesReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SesReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })

  const resolved =
    identity.state === "ACTUAL" || identity.state === "STALE" ? identity.value : null
  const tagsReadable = tagged.state === "ACTUAL" || tagged.state === "STALE" || tagged.state === "EMPTY"

  const ctx: SesContext = {
    now,
    denial,
    sleep: options.sleep,
    identity: resolved,
    tags: tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : []),
    tagsReadable,
    tagsWhy: tagsReadable
      ? ""
      : `the tag index could not be read — ${describeRead(tagged, "tag:GetResources")}`,
  }

  const [account, identities, configurationSetNames, suppressed] = await Promise.all([
    readAccount(gw, ctx),
    readIdentities(gw, ctx),
    readConfigurationSetNames(gw, ctx),
    readSuppression(gw, ctx),
  ])
  const configurationSets = await readConfigurationSets(gw, ctx, configurationSetNames)

  return {
    identity,
    tagged,
    account,
    identities,
    configurationSetNames,
    configurationSets,
    suppressed,
  }
}

/* ------------------------------------------------------ what it prints -- */

/** Each SES capability's own refresh window, so a surface can print its cadence. */
export const SES_SURFACE_REFRESH_MS: Readonly<Record<string, number>> = {
  "SES account": SES_ACCOUNT_TTL_MS,
  "Sending identities": SES_CONFIG_TTL_MS,
  "Configuration sets": SES_CONFIG_TTL_MS,
  "Suppression list": SES_SUPPRESSION_TTL_MS,
}

export interface SesLine {
  surface: string
  capability: Capability
  /** From `CAPABILITIES`, never a literal typed here. */
  refreshMs: number
  /** When the reading was taken, or null for a state that never took one. */
  asOf: string | null
  /** The rendered sentence. One funnel, so DENIED cannot be worded as absence. */
  text: string
  read: AwsRead<unknown>
}

function asOfOf(read: AwsRead<unknown>): string | null {
  switch (read.state) {
    case "ACTUAL":
    case "EMPTY":
    case "STALE":
    case "THROTTLED":
      return read.asOf
    default:
      return null
  }
}

/** The account line's subject: the sandbox fact first, because it is the fact. */
export function accountSubject(read: AwsRead<SesAccount>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") return "SES account state"
  const a = read.value
  const access =
    a.productionAccess.state === "PRODUCTION"
      ? "production access"
      : a.productionAccess.state === "SANDBOX"
        ? `SANDBOX — ${a.productionAccess.consequence}`
        : `production access UNSTATED — ${a.productionAccess.why}`
  const sending = describeStated(a.sendingEnabled, (v) => (v ? "sending enabled" : "sending DISABLED"))
  const sent = describeStated(a.quota.sentLast24Hours, (v) => String(v))
  const max = describeStated(a.quota.max24HourSend, (v) => String(v))
  const rate = describeStated(a.quota.maxSendRate, (v) => `${v}/s`)
  const used = describeStated(a.quotaUsed, (v) => `${Math.round(v * 100)}% of the 24h quota spent`)
  return `SES account — ${access} · ${sending} · ${sent}/${max} in 24h (${used}) · max ${rate}`
}

function identitiesSubject(read: AwsRead<readonly SesIdentity[]>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") return "SES sending identities"
  const verified = read.value.filter((i) => i.verification.state === "VERIFIED").length
  const unverified = read.value.filter((i) => i.verification.state === "NOT_VERIFIED")
  const unstated = read.value.filter((i) => i.verification.state === "UNSTATED").length
  const detail =
    unverified.length > 0
      ? ` · NOT VERIFIED: ${unverified.map((i) => i.name).join(", ")} — ${NOT_VERIFIED_CONSEQUENCE}`
      : ""
  const unstatedDetail = unstated > 0 ? ` · ${unstated} whose verification SES did not state` : ""
  return `SES sending identities — ${verified} of ${read.value.length} verified${detail}${unstatedDetail}`
}

function configurationSetsSubject(read: AwsRead<readonly SesConfigurationSet[]>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") return "SES configuration sets"
  const names = read.value.map((c) => {
    const tls = describeStated(c.tlsPolicy, (v) => `TLS ${v}`)
    const sending = describeStated(c.sendingEnabled, (v) => (v ? "sending enabled" : "sending DISABLED"))
    return `${c.name} (${tls}, ${sending}, ${describeSesAttribution(c.attribution)})`
  })
  return `SES configuration sets — ${names.join("; ")}`
}

/**
 * The suppression line, deliberately without anybody's address in it.
 *
 * Counts by reason and by domain. A surface that needs the addresses reads
 * `suppressed.value.entries` and makes that choice on purpose.
 */
function suppressionSubject(read: AwsRead<SesSuppression>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") return "SES suppression list"
  const s = read.value
  const reasons = Object.keys(s.byReason)
    .sort()
    .map((r) => `${r} ${s.byReason[r]}`)
    .join(", ")
  const domains = Object.keys(s.byDomain)
    .sort()
    .map((d) => `${d} ${s.byDomain[d]}`)
    .join(", ")
  const truncated = s.truncated
    ? ` · TRUNCATED at ${MAX_PAGES} pages — this list is incomplete and an address absent from it may still be suppressed`
    : ""
  return `SES suppression list — ${s.entries.length} addresses (${reasons || "no reason stated"}) across ${domains}${truncated}`
}

/**
 * What an SES surface prints, per capability.
 *
 * A route renders exactly these strings, which is why the mutation proofs
 * target this and not `describeRead`.
 */
export function sesLines(readings: SesReadings): readonly SesLine[] {
  const rows: Array<[string, AwsRead<unknown>, string]> = [
    ["SES account", readings.account, accountSubject(readings.account)],
    ["Sending identities", readings.identities, identitiesSubject(readings.identities)],
    [
      "Configuration sets",
      readings.configurationSets,
      configurationSetsSubject(readings.configurationSets),
    ],
    ["Suppression list", readings.suppressed, suppressionSubject(readings.suppressed)],
  ]
  // The capability comes off the READING, not off the row. When the
  // configuration-set detail read is carrying a refusal of
  // `ses:ListConfigurationSets`, the line must name the action that was actually
  // refused — a line that named `ses:GetConfigurationSet` would send an operator
  // to grant a permission that was never the problem.
  return rows.map(([surface, read, subject]) => ({
    surface,
    capability: read.capability,
    refreshMs: CAPABILITIES[read.capability].refreshMs,
    asOf: asOfOf(read),
    text: describeRead(read, subject),
    read,
  }))
}

/* --------------------------------------------------------- the verdict -- */

/**
 * Whether this account can actually deliver mail, and to whom.
 *
 * The question `ses.tf` could not answer. Four arms, and UNKNOWN is one of
 * them: a verdict computed from a denied read would be the STUDIO-000-007
 * defect with a green chip on it.
 */
export type SesMailabilityVerdict =
  | {
      verdict: "CAN_SEND"
      /** Identities SES will send FROM right now. */
      sendableFrom: readonly string[]
      /** Empty when production access is granted. */
      recipientRestriction: string | null
      why: string
    }
  | {
      verdict: "CANNOT_SEND"
      sendableFrom: readonly string[]
      blocked: readonly { name: string; why: string }[]
      why: string
    }
  | { verdict: "UNKNOWN"; why: string }

export function mailabilityVerdict(readings: SesReadings): SesMailabilityVerdict {
  const account = readings.account
  const identities = readings.identities

  if (account.state !== "ACTUAL" && account.state !== "STALE") {
    return {
      verdict: "UNKNOWN",
      why: `the SES account could not be read — ${describeRead(account, "ses:GetAccount")}`,
    }
  }
  if (identities.state === "DENIED" || identities.state === "THROTTLED" || identities.state === "ERROR" || identities.state === "UNCONFIGURED") {
    return {
      verdict: "UNKNOWN",
      why: `the sending identities could not be read — ${describeRead(identities, "ses:ListEmailIdentities")}`,
    }
  }

  const all = identities.state === "EMPTY" ? [] : identities.value
  const sendableFrom = all
    .filter((i) => i.verification.state === "VERIFIED" && (!i.sendingEnabled.stated || i.sendingEnabled.value))
    .map((i) => i.name)
  const blocked = all
    .filter((i) => !(i.verification.state === "VERIFIED" && (!i.sendingEnabled.stated || i.sendingEnabled.value)))
    .map((i) => ({
      name: i.name,
      why:
        i.verification.state === "NOT_VERIFIED"
          ? `${i.verification.sesStatus} — ${i.verification.consequence}`
          : i.verification.state === "UNSTATED"
            ? i.verification.why
            : "SES reports sending disabled on this identity",
    }))

  if (account.value.sendingEnabled.stated && account.value.sendingEnabled.value === false) {
    return {
      verdict: "CANNOT_SEND",
      sendableFrom,
      blocked,
      why: "SES reports sending disabled account-wide; no identity can send regardless of verification",
    }
  }
  if (sendableFrom.length === 0) {
    return {
      verdict: "CANNOT_SEND",
      sendableFrom,
      blocked,
      why:
        all.length === 0
          ? "SES holds no sending identities at all, so there is no address this platform can send from"
          : "no SES identity is both verified and sending-enabled, so every message is dropped at the API",
    }
  }

  switch (account.value.productionAccess.state) {
    case "PRODUCTION":
      return {
        verdict: "CAN_SEND",
        sendableFrom,
        recipientRestriction: null,
        why: "production access is granted and at least one identity is verified",
      }
    case "SANDBOX":
      return {
        verdict: "CAN_SEND",
        sendableFrom,
        recipientRestriction: account.value.productionAccess.consequence,
        why: "an identity is verified, but the account is in the sandbox and most recipients will not receive mail",
      }
    case "UNSTATED":
      return {
        verdict: "UNKNOWN",
        why: `an identity is verified, but ${account.value.productionAccess.why}`,
      }
  }
}

export { SES_ACCOUNT_TTL_MS, SES_CONFIG_TTL_MS, SES_SUPPRESSION_TTL_MS }
