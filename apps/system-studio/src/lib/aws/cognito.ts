/**
 * STUDIO-070-004 (Cognito) — the pool that guards this console, read back.
 *
 * `infrastructure/studio/cognito.tf` provisions the operator user pool, its one
 * app client, its hosted domain and the operator accounts in it. Nothing in the
 * running product had ever issued a Cognito call, so every fact about the
 * console's own front door was invisible FROM the console: whether MFA was
 * enforced, how long a temporary password stayed usable, and which operator
 * accounts had never been forced through a password change.
 *
 * That is not a hypothetical gap. On 2026-08-13 an audit found the migration to
 * Cognito had seeded every operator with the SHARED SECRET as a PERMANENT
 * password (`password`, not `temporary_password`) with `message_action =
 * SUPPRESS` — no invitation, so no forced change was ever triggered — and the
 * pool's `mfa_configuration` left at `OPTIONAL`, which is a second factor
 * nobody enrolled. Each of those is a fact an API returns. None of them reached
 * a screen. This module is the read that would have shown them.
 *
 * ## What it can see, and what it provably cannot
 *
 * Three of the facts an operator will ask for are NOT in any response this
 * engine is allowed to fetch, and each one is modelled as a value a surface has
 * to render rather than a field a surface can forget:
 *
 *   * **When an operator last signed in.** Cognito's `UserType` carries
 *     `UserCreateDate`, `UserLastModifiedDate`, `Enabled`, `UserStatus` and
 *     `MFAOptions` — and no authentication timestamp, in any SDK version. The
 *     nearest thing is `AdminListUserAuthEvents`, which needs the pool's
 *     advanced-security feature plan and an `Admin*` verb this engine does not
 *     hold. `LAST_SIGN_IN_NOT_READABLE` says so, in one place, for every
 *     operator. `UserLastModifiedDate` is NOT it and must never be printed as
 *     it: it moves when an attribute is edited and does not move when somebody
 *     signs in.
 *   * **Whether an operator has enrolled a TOTP authenticator.**
 *     `MFAOptions` is the legacy SMS-only field. Software-token enrolment lives
 *     in `UserMFASettingList`, which only `AdminGetUser` returns — deliberately
 *     absent from the capability registry, and named by GE-041-001 as
 *     vocabulary this layer does not speak. An empty `MFAOptions` means SMS MFA
 *     is not configured; it does not mean unprotected, and it does not mean
 *     protected.
 *   * **Whether the invitation was suppressed.** `MessageAction` is a parameter
 *     of the create call. Cognito does not store it and no read returns it. The
 *     observable consequence — an administratively created account that reached
 *     CONFIRMED without a human sign-in — is reported instead, as a SUSPICION
 *     with its evidence and its counter-case attached.
 *
 * ## Never a credential, ever
 *
 * `DescribeUserPoolClient` returns `ClientSecret` in its response body. This
 * module reads that field for exactly one purpose — to report the BOOLEAN
 * `hasSecret`, which is a real configuration fact (`generate_secret = true`) —
 * and the value never enters a returned object, a log line or a rendered
 * string. `ListUsers` is narrowed to the `email` attribute in `client.ts`, and
 * narrowed AGAIN here to the sign-in identifier alone, so a widening of that
 * call cannot leak a phone number into a render through this module.
 *
 * ## GE-041-001, and why everything is in this one file
 *
 * `tests/security/provider-independence.test.mjs` confines the Cognito SDK and
 * Cognito's vocabulary to an identity adapter, with a two-file estate exemption
 * — `client.ts`, which constructs every SDK client, and this file, which is the
 * only module that reads a user pool as an AWS RESOURCE. The exemption is a
 * ratchet asserted at `length <= 2`, so a THIRD file carrying a pool identifier
 * reds the build.
 *
 * That has a consequence for whoever renders this: **no exported field is named
 * with Cognito's own vocabulary.** A pool identifier is `poolId`, not the
 * SDK's spelling; an app client's is `clientId`. Threading the SDK's names out
 * of here would fail the guard in the first page that imported them, which is
 * the guard working as designed. The forbidden half of the exemption applies
 * inside this file too: not one authentication or user-pool-write verb appears
 * here, and none ever should.
 *
 * ## Region and partition
 *
 * From the pool's own ARN where AWS returned one, and otherwise from the
 * resolved identity. There is no region literal in this file and no `"aws"`
 * partition fallback: GE-010-007 was a data-residency defect caused by exactly
 * that fallback. `ListUserPools` is a regional call, so the pools listed are
 * the ones in the region the SDK resolved — which is a fact worth stating
 * rather than a completeness this module claims.
 *
 * ## Attribution
 *
 * Preferring the pool's OWN `UserPoolTags`, which `DescribeUserPool` returns,
 * and falling back to the Resource Groups Tagging API index in `tags.ts` when
 * the description was refused. Both are tags; neither is a name. The fourth
 * answer `unknown` exists because "we could not read this pool's tags" is not
 * "this pool has no tenant tag", and only the second is a finding an operator
 * can act on.
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

/* ---------------------------------------------------------------- bounds -- */

/**
 * How many `ListUserPools` pages to walk. `client.ts` asks for 60 per page, so
 * this is 600 pools before the reader stops.
 *
 * It does NOT throw on reaching the cap and it does not return the first page
 * as though it were the estate. It returns what it has WITH a `truncated`
 * completeness, because a reader that silently returns page one is the same lie
 * as an empty list and a reader with no bound is how one page render becomes an
 * account-wide throttle.
 */
export const MAX_POOL_PAGES = 10

/** Pages of app clients per pool. 60 per page: 600 clients before it stops. */
export const MAX_CLIENT_PAGES = 10

/** Pages of operators per pool. 60 per page: 1,200 accounts before it stops. */
export const MAX_OPERATOR_PAGES = 20

/**
 * How many pools get the four detail reads in one load.
 *
 * Each pool costs a `DescribeUserPool`, a `GetUserPoolMfaConfig`, a
 * `ListUserPoolClients` (plus one `DescribeUserPoolClient` per client), a
 * `DescribeUserPoolDomain` and a `ListUsers`, against an account-wide Cognito
 * throttle. Pools past the cap are NOT dropped and do NOT render as
 * unconfigured pools: every one of their detail reads carries UNCONFIGURED
 * saying the engine stopped, which is a different sentence from "MFA is off".
 */
export const MAX_POOLS_DESCRIBED = 25

/** App clients described per pool, for the same reason and with the same treatment. */
export const MAX_CLIENTS_DESCRIBED = 25

/** How many pools are read at once. Bounded so one load is not a burst. */
const POOL_CONCURRENCY = 4

/**
 * Cognito's own default when a pool's password policy does not set
 * `TemporaryPasswordValidityDays`.
 *
 * Stated as a constant with its provenance rather than inlined as a `?? 7`,
 * because it is an assumption about AWS's behaviour and an assumption needs
 * somewhere to be argued with. The `default` arm of `TemporaryPasswordWindow`
 * carries it separately from a value the pool actually declared, so a surface
 * can tell "somebody chose seven days" from "nobody chose, and AWS's default is
 * seven days".
 */
export const COGNITO_DEFAULT_TEMPORARY_PASSWORD_VALIDITY_DAYS = 7

/**
 * How close to its creation an administratively created account may reach
 * CONFIRMED before this engine reports it as never having been forced through a
 * password change.
 *
 * Fifteen minutes. A forced password change requires a human to open the hosted
 * UI, sign in with the temporary credential and choose a new one; that does not
 * happen inside the same quarter of an hour as the Terraform apply that created
 * the account. Setting a PERMANENT password at creation does — the provider
 * issues the create and the password write back to back.
 *
 * This is a heuristic and it is reported as one. See `OPERATOR_SUSPICION_CAVEAT`
 * for the case that would produce a false positive; it travels with the finding
 * so nobody has to come here to learn it.
 */
export const PERMANENT_PASSWORD_SUSPICION_WINDOW_MS = 15 * 60_000

/** The tag whose value identifies the stack a resource belongs to. */
export const CONSOLE_POOL_TAG_KEY = "tenure:module"

/**
 * The value `infrastructure/studio/main.tf` gives that tag for everything in
 * the Studio stack, including the operator pool.
 *
 * A TAG, never a name. `${local.name_prefix}-operators` is a string somebody
 * typed and can retype; `tenure:module = system-studio` is a fact the stack
 * asserts about every resource it owns, and it is the same key the estate's tag
 * contract is checked against.
 */
export const CONSOLE_POOL_TAG_VALUE = "system-studio"

/** The retry schedule is `throttle.ts`'s, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/* ------------------------------------------------- the API's own shapes -- */

/**
 * Declared rather than imported, for the reason `client.ts` states: one module
 * owns the SDK, and a type import from `@aws-sdk/client-cognito-*` here would
 * be a second file the GE-041-001 import rule has to exempt.
 */
interface ListUserPoolsResponse {
  UserPools?: Array<{ Id?: string; Name?: string; Status?: string }>
  NextToken?: string
}

interface DescribeUserPoolResponse {
  UserPool?: {
    Id?: string
    Name?: string
    Arn?: string
    MfaConfiguration?: string
    EstimatedNumberOfUsers?: number
    Domain?: string
    CustomDomain?: string
    DeletionProtection?: string
    CreationDate?: Date | string
    LastModifiedDate?: Date | string
    UserPoolTags?: Record<string, string>
    UsernameAttributes?: string[]
    AutoVerifiedAttributes?: string[]
    AdminCreateUserConfig?: {
      AllowAdminCreateUserOnly?: boolean
      UnusedAccountValidityDays?: number
    }
    AccountRecoverySetting?: {
      RecoveryMechanisms?: Array<{ Name?: string; Priority?: number }>
    }
    Policies?: {
      PasswordPolicy?: {
        MinimumLength?: number
        RequireUppercase?: boolean
        RequireLowercase?: boolean
        RequireNumbers?: boolean
        RequireSymbols?: boolean
        TemporaryPasswordValidityDays?: number
      }
    }
  }
}

interface GetUserPoolMfaConfigResponse {
  MfaConfiguration?: string
  SoftwareTokenMfaConfiguration?: { Enabled?: boolean }
  SmsMfaConfiguration?: { SmsAuthenticationMessage?: string }
  EmailMfaConfiguration?: { Message?: string }
}

interface ListUserPoolClientsResponse {
  UserPoolClients?: Array<{ ClientId?: string; ClientName?: string }>
  NextToken?: string
}

interface DescribeUserPoolClientResponse {
  UserPoolClient?: {
    ClientId?: string
    ClientName?: string
    /**
     * Present in the response and NEVER carried out of this module. Read only
     * to answer the boolean `hasSecret`.
     */
    ClientSecret?: string
    CallbackURLs?: string[]
    LogoutURLs?: string[]
    AllowedOAuthFlows?: string[]
    AllowedOAuthScopes?: string[]
    ExplicitAuthFlows?: string[]
    SupportedIdentityProviders?: string[]
    EnableTokenRevocation?: boolean
    PreventUserExistenceErrors?: string
    RefreshTokenValidity?: number
    AccessTokenValidity?: number
    IdTokenValidity?: number
    TokenValidityUnits?: { AccessToken?: string; IdToken?: string; RefreshToken?: string }
  }
}

interface DescribeUserPoolDomainResponse {
  DomainDescription?: {
    Domain?: string
    Status?: string
    Version?: string
    CloudFrontDistribution?: string
    CustomDomainConfig?: { CertificateArn?: string }
  }
}

interface ListUsersResponse {
  Users?: Array<{
    Username?: string
    UserStatus?: string
    Enabled?: boolean
    UserCreateDate?: Date | string
    UserLastModifiedDate?: Date | string
    MFAOptions?: Array<{ DeliveryMedium?: string; AttributeName?: string }>
    Attributes?: Array<{ Name?: string; Value?: string }>
  }>
  PaginationToken?: string
}

/* ------------------------------------------------------- small vocabulary -- */

/**
 * Whether a paged read saw the whole thing.
 *
 * Explicit, and carried on the value rather than inferred from a length. A list
 * that stopped at the bound and a list that ended are different facts and only
 * the second is a complete answer; a surface that cannot tell them apart will
 * print "3 operators" about a pool with four hundred.
 */
export type Completeness =
  | { kind: "complete"; pagesWalked: number }
  | { kind: "truncated"; pagesWalked: number; seen: number; why: string }

/** The Studio's own timestamp normaliser. AWS hands back `Date`; a render needs ISO. */
function isoOf(value: Date | string | undefined | null): string | null {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const parsed = Date.parse(String(value))
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

/** Milliseconds between two ISO timestamps, or null when either is missing. */
function msBetween(earlier: string | null, later: string | null): number | null {
  if (!earlier || !later) return null
  const a = Date.parse(earlier)
  const b = Date.parse(later)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return b - a
}

const MS_PER_DAY = 86_400_000

/* -------------------------------------------------------------- the pool -- */

/**
 * A pool's password policy, as read.
 *
 * Every field is nullable and nothing is defaulted. A `minimumLength` of `null`
 * means AWS did not return one; rendering that as `0` or as `8` would be this
 * engine inventing a policy, and the whole point of the panel is that the
 * policy is the pool's, not ours.
 */
export interface PasswordPolicyReading {
  minimumLength: number | null
  requireUppercase: boolean | null
  requireLowercase: boolean | null
  requireNumbers: boolean | null
  requireSymbols: boolean | null
  temporaryPasswordValidityDays: number | null
}

/**
 * How long a temporary password stays usable in this pool.
 *
 * The audit's second question, after MFA. Three arms, because "the pool sets
 * seven days", "the pool sets nothing and AWS's default is seven days" and "we
 * could not read the policy" are three different states and only the first is
 * something somebody decided.
 */
export type TemporaryPasswordWindow =
  | { kind: "declared"; days: number }
  | { kind: "default"; days: number; why: string }
  | { kind: "unknown"; why: string }

/**
 * The pool-level MFA posture — the single fact whose absence the 2026-08-13
 * audit turned on.
 *
 * `enforced` is the only arm that is reassuring, and it is the only arm that
 * cannot be reached by a failed read. `unknown` exists precisely so that a
 * refused `GetUserPoolMfaConfig` never renders as a pool with MFA on.
 *
 * `provenance` names WHICH call answered, because the fact is available from
 * two of them and they can disagree: `GetUserPoolMfaConfig` is authoritative,
 * `DescribeUserPool`'s `MfaConfiguration` is the fallback used when the first
 * was refused, and an operator reading "OPTIONAL" deserves to know which one
 * said so.
 */
export type MfaPosture =
  | { kind: "enforced"; factors: readonly string[]; provenance: string }
  /** The defect. A second factor nobody enrolled is the same protection as none. */
  | { kind: "optional"; factors: readonly string[]; provenance: string; why: string }
  | { kind: "off"; provenance: string; why: string }
  /** AWS returned a value this engine does not model. Never folded into another arm. */
  | { kind: "unrecognised"; raw: string; provenance: string }
  | { kind: "unknown"; why: string }

/** Everything `DescribeUserPool` answered about one pool. */
export interface PoolDetail {
  poolId: string
  /** A label for a human. Never an attribution key and never an identification key. */
  name: string | null
  arn: string | null
  /** Verbatim, so the fallback posture and the authoritative one can be compared. */
  mfaConfigurationRaw: string | null
  passwordPolicy: PasswordPolicyReading
  temporaryPasswordWindow: TemporaryPasswordWindow
  /** `allow_admin_create_user_only` — whether anybody can sign themselves up. */
  adminCreateUserOnly: boolean | null
  accountRecoveryMechanisms: readonly string[]
  usernameAttributes: readonly string[]
  autoVerifiedAttributes: readonly string[]
  /** The hosted-UI domain prefix, and the custom domain if one is attached. */
  hostedDomain: string | null
  customDomain: string | null
  deletionProtection: string | null
  estimatedUsers: number | null
  createdAt: string | null
  lastModifiedAt: string | null
  /** The pool's own tags, which beat the tagging index because the service returned them. */
  tags: Readonly<Record<string, string>>
}

/** What `GetUserPoolMfaConfig` answered. The authoritative source for `MfaPosture`. */
export interface PoolMfaDetail {
  mfaConfigurationRaw: string | null
  softwareTokenEnabled: boolean
  smsConfigured: boolean
  emailConfigured: boolean
}

/** One app client — an extra one is an extra way in, so every one is named. */
export interface PoolClientReading {
  clientId: string
  name: string | null
  /** Refused, throttled, broken or read — per client, with its own action named. */
  detail: AwsRead<PoolClientDetail>
}

export interface PoolClientDetail {
  clientId: string
  name: string | null
  /**
   * Whether the client was issued a secret. The BOOLEAN only; the value is read
   * from the response to compute this and never leaves this function.
   */
  hasSecret: boolean
  callbackUrls: readonly string[]
  logoutUrls: readonly string[]
  allowedOAuthFlows: readonly string[]
  allowedOAuthScopes: readonly string[]
  explicitAuthFlows: readonly string[]
  supportedIdentityProviders: readonly string[]
  tokenRevocationEnabled: boolean | null
  preventUserExistenceErrors: string | null
  accessTokenValidity: number | null
  idTokenValidity: number | null
  refreshTokenValidity: number | null
  tokenValidityUnits: Readonly<Record<string, string>>
}

/** The hosted-UI domain operators are redirected to. */
export interface PoolDomainDetail {
  domain: string
  status: string | null
  version: string | null
  cloudFrontDistribution: string | null
  /** The ARN of the certificate on a custom domain, when there is one. */
  certificateArn: string | null
}

/* ---------------------------------------------------------- the operator -- */

/**
 * An account's status, kept as a closed union with an escape hatch.
 *
 * `UNRECOGNISED` carries the raw string rather than being folded into
 * `CONFIRMED`, because the way a status union rots is a new AWS value landing
 * in the default arm of a switch and rendering as the reassuring one. `ABSENT`
 * is separate again: AWS returning no `UserStatus` at all is this engine's
 * problem to report, not an account state.
 */
export type OperatorStatus =
  | { code: "CONFIRMED" }
  | { code: "FORCE_CHANGE_PASSWORD" }
  | { code: "RESET_REQUIRED" }
  | { code: "UNCONFIRMED" }
  | { code: "ARCHIVED" }
  | { code: "COMPROMISED" }
  | { code: "EXTERNAL_PROVIDER" }
  | { code: "UNKNOWN" }
  | { code: "UNRECOGNISED"; raw: string }
  | { code: "ABSENT"; why: string }

const MODELLED_STATUSES = new Set([
  "CONFIRMED",
  "FORCE_CHANGE_PASSWORD",
  "RESET_REQUIRED",
  "UNCONFIRMED",
  "ARCHIVED",
  "COMPROMISED",
  "EXTERNAL_PROVIDER",
  "UNKNOWN",
])

export function classifyStatus(raw: string | undefined | null): OperatorStatus {
  if (raw === undefined || raw === null || raw === "") {
    return {
      code: "ABSENT",
      why:
        "the roster answered for this account without a status. Its state is unread — which is " +
        "not the same as its being confirmed.",
    }
  }
  if (MODELLED_STATUSES.has(raw)) return { code: raw } as OperatorStatus
  return { code: "UNRECOGNISED", raw }
}

/**
 * What this engine can and cannot say about one operator's second factor.
 *
 * Shaped so the unreadable half is a value rather than an omission. `MFAOptions`
 * is SMS-only and legacy; software-token enrolment is not in any response this
 * engine is permitted to fetch, and a field left off the type is a field a
 * surface renders as a blank cell that reads like "none".
 */
export interface OperatorMfaEnrolment {
  /** From `MFAOptions`. True means SMS MFA is set up for this account. */
  smsConfigured: boolean
  /** The delivery media the account has SMS MFA on, when it has any. */
  smsDeliveryMedia: readonly string[]
  /** One arm, deliberately. See the module header. */
  softwareToken: { state: "NOT_READABLE"; needs: string; why: string }
  /** The sentence a surface prints instead of inventing "no MFA". */
  why: string
}

/** The same object for every operator: nothing about it varies per account. */
export const SOFTWARE_TOKEN_NOT_READABLE: OperatorMfaEnrolment["softwareToken"] = {
  state: "NOT_READABLE",
  needs: "cognito-idp:AdminGetUser",
  why:
    "software-token (TOTP) enrolment is not returned by the roster read — it lives in " +
    "UserMFASettingList, which only the per-account admin read returns. That read is " +
    "deliberately absent from this engine's capabilities. Unknown, not absent.",
}

/**
 * When an operator last signed in.
 *
 * One arm. Cognito has no such field, so this exists to make the absence
 * something a surface must render rather than something it can forget. The
 * `notThis` line names the field somebody would otherwise reach for.
 */
export interface LastSignIn {
  state: "NOT_READABLE"
  needs: "cognito-idp:AdminListUserAuthEvents"
  why: string
  notThis: string
}

export const LAST_SIGN_IN_NOT_READABLE: LastSignIn = {
  state: "NOT_READABLE",
  needs: "cognito-idp:AdminListUserAuthEvents",
  why:
    "Cognito's roster read returns no authentication timestamp, in any SDK version. The sign-in " +
    "history lives in the pool's authentication events, which need the advanced-security feature " +
    "plan and a per-account admin read this engine does not hold.",
  notThis:
    "last-modified is NOT last sign-in: it moves when an attribute is edited and does not move " +
    "when somebody signs in.",
}

/**
 * How far into its temporary-password window a pending account is.
 *
 * The arithmetic the audit needed and nobody could do: an account still in
 * FORCE_CHANGE_PASSWORD after the window closed cannot complete its first
 * sign-in at all, and an account whose window is still open is a credential
 * sitting live somewhere.
 */
export type FirstSignInWindow =
  | { kind: "not-pending"; why: string }
  | { kind: "open"; ageDays: number; windowDays: number; since: string; sinceMeans: string }
  | {
      kind: "expired"
      ageDays: number
      windowDays: number
      since: string
      sinceMeans: string
      why: string
    }
  | { kind: "unknown"; why: string }

/** The counter-case that would make `neverForcedAPasswordChange` a false positive. */
export const OPERATOR_SUSPICION_CAVEAT =
  "This is an inference from two timestamps, not a read of the create call: Cognito does not " +
  "store whether the invitation was suppressed or whether the seeded password was permanent. An " +
  "operator who happened to complete their forced password change within minutes of the account " +
  "being created would look identical."

/** What one row of the roster says, and refuses to say. */
export interface OperatorReading {
  /**
   * The sign-in identifier and nothing else.
   *
   * The `email` attribute when the roster returned one, otherwise the username.
   * No other attribute value is carried out of this module — the roster read is
   * narrowed to `email` in `client.ts` and narrowed again here, so a widening
   * there cannot leak a phone number into a render through this file.
   */
  signInIdentifier: string
  /** Where that identifier came from, so nobody has to guess whether it is an email. */
  identifierProvenance: "email attribute" | "username"
  status: OperatorStatus
  /** `false` is a real, actionable fact: the account exists and cannot sign in. */
  enabled: boolean | null
  mfa: OperatorMfaEnrolment
  lastSignIn: LastSignIn
  createdAt: string | null
  lastModifiedAt: string | null
  firstSignInWindow: FirstSignInWindow
  /**
   * Suspected to be holding a password an administrator set permanently, rather
   * than one the operator chose.
   *
   * Null when the question does not arise or cannot be asked. When set it
   * carries its own evidence and `OPERATOR_SUSPICION_CAVEAT`, so the claim
   * travels with what would disprove it.
   */
  neverForcedAPasswordChange: {
    suspected: true
    createdAt: string
    confirmedWithinMs: number
    windowMs: number
    why: string
    caveat: string
  } | null
}

/** A roster page walk: the accounts, and whether the walk saw all of them. */
export interface OperatorRoster {
  operators: readonly OperatorReading[]
  completeness: Completeness
}

/* ------------------------------------------------------------ attribution -- */

/**
 * Which tenant a pool belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express. A
 * pool whose tags were never read must not render as "unattributable — missing
 * tenure:tenant", because that sentence sends an operator to add a tag that is
 * probably already there.
 */
export type PoolAttribution =
  | { kind: "tenant"; tenantSlug: string; provenance: string }
  | { kind: "shared"; provenance: string }
  | { kind: "unattributed"; provenance: string }
  | { kind: "unknown"; why: string }

/* ------------------------------------------------------------ the reading -- */

/** One pool, with every sub-read carried separately so one refusal is one refusal. */
export interface PoolReading {
  poolId: string
  /** From `ListUserPools`. A label; nothing here joins or classifies on it. */
  listedName: string | null
  /** AWS's own `Arn` where the description answered, else one assembled from identity. */
  arn: string | null
  /** Which of those, or why there is none. Never silent. */
  arnProvenance: string
  /** From the pool's ARN where AWS returned one, else the resolved identity. */
  region: string | null
  partition: string | null
  accountId: string | null
  /** Where those three came from. Never silent, never a literal. */
  locationProvenance: string
  attribution: PoolAttribution
  detail: AwsRead<PoolDetail>
  mfa: AwsRead<PoolMfaDetail>
  /** Derived from `mfa` first and `detail` second, so one refusal is not both. */
  mfaPosture: MfaPosture
  clients: AwsRead<PoolClientInventory>
  domain: AwsRead<PoolDomainDetail>
  operators: AwsRead<OperatorRoster>
  /** Whether this pool's tags mark it as the one guarding this console. */
  guardsThisConsole: boolean | null
  asOf: string
}

export interface PoolClientInventory {
  clients: readonly PoolClientReading[]
  completeness: Completeness
}

export interface PoolInventory {
  pools: readonly PoolReading[]
  completeness: Completeness
  /**
   * `ListUserPools` is regional. Stated rather than implied, so "one pool" is
   * read as "one pool in this region" and not as "one pool in the account".
   */
  scope: string
}

/**
 * Which pool guards this console.
 *
 * Four arms and no guess. Identification is by TAG — see
 * `CONSOLE_POOL_TAG_VALUE` — because a pool called `tenure-prod-operators` is a
 * string somebody typed, and the console picking its own front door by name is
 * how it ends up describing the wrong pool's MFA setting with total confidence.
 */
export type ConsolePoolIdentification =
  | { kind: "identified"; poolId: string; how: string }
  | { kind: "ambiguous"; poolIds: readonly string[]; why: string }
  | { kind: "not-tagged"; poolsRead: number; why: string }
  | { kind: "unknown"; why: string }

/* -------------------------------------------------------------- findings -- */

/**
 * The facts that would have made the 2026-08-13 audit visible from this console.
 *
 * A union rather than a list of strings, so a surface can rank them and a test
 * can assert on the one that matters without matching prose. Every arm carries
 * the evidence it was derived from; the `unknown` arms carry the refusal's own
 * sentence, so a finding list is never quietly shorter because a read failed.
 */
export type CognitoFinding =
  | {
      kind: "mfa-not-enforced"
      severity: "critical"
      poolId: string
      posture: MfaPosture
      text: string
    }
  | { kind: "mfa-unknown"; severity: "unknown"; poolId: string; text: string }
  | {
      kind: "operator-awaiting-first-password-change"
      severity: "warning"
      poolId: string
      signInIdentifier: string
      window: FirstSignInWindow
      text: string
    }
  | {
      kind: "temporary-password-window-expired"
      severity: "critical"
      poolId: string
      signInIdentifier: string
      window: FirstSignInWindow
      text: string
    }
  | {
      kind: "operator-never-forced-a-password-change"
      severity: "critical"
      poolId: string
      signInIdentifier: string
      text: string
    }
  | { kind: "self-signup-open"; severity: "critical"; poolId: string; text: string }
  | { kind: "roster-unknown"; severity: "unknown"; poolId: string; text: string }
  | {
      kind: "temporary-password-window-unknown"
      severity: "unknown"
      poolId: string
      text: string
    }
  | { kind: "pools-unknown"; severity: "unknown"; text: string }

/** Everything a Cognito surface needs, in one load. */
export interface CognitoReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The pools. DENIED here is a refused `cognito-idp:ListUserPools` and is NEVER
   * an empty inventory — an operator reading "no user pools" when the truth is
   * "we were not allowed to look" is the single most dangerous thing this
   * surface can say about the system that lets them in.
   */
  pools: AwsRead<PoolInventory>
  consolePool: ConsolePoolIdentification
  findings: readonly CognitoFinding[]
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: {
    pools: number
    detail: number
    mfa: number
    clients: number
    clientDetail: number
    domain: number
    operators: number
  }
}

/* ------------------------------------------------------------- the calls -- */

async function listPoolIds(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<{ pools: Array<{ poolId: string; name: string | null }>; completeness: Completeness }>> {
  return readAws(
    "cognito-idp:ListUserPools",
    async () => {
      const pools: Array<{ poolId: string; name: string | null }> = []
      let token: string | undefined
      let pagesWalked = 0
      let completeness: Completeness = { kind: "complete", pagesWalked: 0 }
      for (let page = 0; page < MAX_POOL_PAGES; page += 1) {
        const response = (await gw.call("cognito-idp:ListUserPools", {
          NextToken: token,
        })) as ListUserPoolsResponse
        pagesWalked = page + 1
        for (const pool of response?.UserPools ?? []) {
          if (typeof pool?.Id === "string" && pool.Id) {
            pools.push({ poolId: pool.Id, name: typeof pool.Name === "string" ? pool.Name : null })
          }
        }
        token = response?.NextToken || undefined
        if (!token) break
      }
      completeness = token
        ? {
            kind: "truncated",
            pagesWalked,
            seen: pools.length,
            why:
              `this engine walks at most ${MAX_POOL_PAGES} pages of user pools and AWS still had ` +
              `more. ${pools.length} pool(s) are shown and the account holds more than that.`,
          }
        : { kind: "complete", pagesWalked }
      // Sorted so two loads of the same account render in the same order. The
      // API promises no order, and an order that changes between renders makes
      // a diff of two screenshots unreadable.
      pools.sort((a, b) => (a.poolId < b.poolId ? -1 : a.poolId > b.poolId ? 1 : 0))
      return { pools, completeness }
    },
    {
      now: options.now,
      denial: options.denial,
      isEmpty: (value) => (value as { pools: unknown[] }).pools.length === 0,
      ...RETRY,
    },
  )
}

function passwordPolicyOf(
  policy: NonNullable<NonNullable<DescribeUserPoolResponse["UserPool"]>["Policies"]>["PasswordPolicy"],
): PasswordPolicyReading {
  return {
    minimumLength: typeof policy?.MinimumLength === "number" ? policy.MinimumLength : null,
    requireUppercase: typeof policy?.RequireUppercase === "boolean" ? policy.RequireUppercase : null,
    requireLowercase: typeof policy?.RequireLowercase === "boolean" ? policy.RequireLowercase : null,
    requireNumbers: typeof policy?.RequireNumbers === "boolean" ? policy.RequireNumbers : null,
    requireSymbols: typeof policy?.RequireSymbols === "boolean" ? policy.RequireSymbols : null,
    temporaryPasswordValidityDays:
      typeof policy?.TemporaryPasswordValidityDays === "number"
        ? policy.TemporaryPasswordValidityDays
        : null,
  }
}

/**
 * How long a temporary password lasts, from the policy and — failing that —
 * from the deprecated `UnusedAccountValidityDays`, which is what an older pool
 * still carries the number in.
 */
export function temporaryPasswordWindowOf(
  policy: PasswordPolicyReading,
  unusedAccountValidityDays: number | null,
): TemporaryPasswordWindow {
  if (policy.temporaryPasswordValidityDays !== null) {
    return { kind: "declared", days: policy.temporaryPasswordValidityDays }
  }
  if (unusedAccountValidityDays !== null) {
    return { kind: "declared", days: unusedAccountValidityDays }
  }
  return {
    kind: "default",
    days: COGNITO_DEFAULT_TEMPORARY_PASSWORD_VALIDITY_DAYS,
    why:
      "the pool declares no temporary-password validity, so AWS's default of " +
      `${COGNITO_DEFAULT_TEMPORARY_PASSWORD_VALIDITY_DAYS} day(s) applies. Nobody chose this ` +
      "number; it is the one that applies in the absence of a choice.",
  }
}

async function readPoolDetail(
  gw: AwsGateway,
  poolId: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<PoolDetail>> {
  return readAws<PoolDetail>(
    "cognito-idp:DescribeUserPool",
    async () => {
      const response = (await gw.call("cognito-idp:DescribeUserPool", {
        UserPoolId: poolId,
      })) as DescribeUserPoolResponse
      const pool = response?.UserPool
      if (!pool) {
        throw new Error(
          `cognito-idp:DescribeUserPool answered for ${poolId} with no pool. Nothing about this ` +
            `pool's policy can be stated from that.`,
        )
      }
      const policy = passwordPolicyOf(pool.Policies?.PasswordPolicy)
      const unused =
        typeof pool.AdminCreateUserConfig?.UnusedAccountValidityDays === "number"
          ? pool.AdminCreateUserConfig.UnusedAccountValidityDays
          : null
      const tags: Record<string, string> = {}
      for (const [key, value] of Object.entries(pool.UserPoolTags ?? {})) {
        if (typeof key === "string" && typeof value === "string") tags[key] = value
      }
      return {
        poolId: pool.Id ?? poolId,
        name: typeof pool.Name === "string" ? pool.Name : null,
        arn: typeof pool.Arn === "string" && pool.Arn ? pool.Arn : null,
        mfaConfigurationRaw:
          typeof pool.MfaConfiguration === "string" ? pool.MfaConfiguration : null,
        passwordPolicy: policy,
        temporaryPasswordWindow: temporaryPasswordWindowOf(policy, unused),
        adminCreateUserOnly:
          typeof pool.AdminCreateUserConfig?.AllowAdminCreateUserOnly === "boolean"
            ? pool.AdminCreateUserConfig.AllowAdminCreateUserOnly
            : null,
        accountRecoveryMechanisms: (pool.AccountRecoverySetting?.RecoveryMechanisms ?? [])
          .map((m) => (typeof m?.Name === "string" ? m.Name : ""))
          .filter((n) => n !== ""),
        usernameAttributes: (pool.UsernameAttributes ?? []).filter(
          (a): a is string => typeof a === "string",
        ),
        autoVerifiedAttributes: (pool.AutoVerifiedAttributes ?? []).filter(
          (a): a is string => typeof a === "string",
        ),
        hostedDomain: typeof pool.Domain === "string" && pool.Domain ? pool.Domain : null,
        customDomain:
          typeof pool.CustomDomain === "string" && pool.CustomDomain ? pool.CustomDomain : null,
        deletionProtection:
          typeof pool.DeletionProtection === "string" ? pool.DeletionProtection : null,
        estimatedUsers:
          typeof pool.EstimatedNumberOfUsers === "number" ? pool.EstimatedNumberOfUsers : null,
        createdAt: isoOf(pool.CreationDate),
        lastModifiedAt: isoOf(pool.LastModifiedDate),
        tags,
      }
    },
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

async function readPoolMfa(
  gw: AwsGateway,
  poolId: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<PoolMfaDetail>> {
  return readAws<PoolMfaDetail>(
    "cognito-idp:GetUserPoolMfaConfig",
    async () => {
      const response = (await gw.call("cognito-idp:GetUserPoolMfaConfig", {
        UserPoolId: poolId,
      })) as GetUserPoolMfaConfigResponse
      return {
        mfaConfigurationRaw:
          typeof response?.MfaConfiguration === "string" ? response.MfaConfiguration : null,
        softwareTokenEnabled: response?.SoftwareTokenMfaConfiguration?.Enabled === true,
        smsConfigured: response?.SmsMfaConfiguration !== undefined,
        emailConfigured: response?.EmailMfaConfiguration !== undefined,
      }
    },
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

/**
 * The pool's MFA posture, degrading one step at a time.
 *
 * `GetUserPoolMfaConfig` first because it is the authoritative answer and the
 * only one that names the factors. `DescribeUserPool`'s `MfaConfiguration` when
 * that call was refused, clearly labelled, because a partial answer beats a
 * blank one. And `unknown` when neither answered — never `enforced`, which is
 * the arm a defaulting implementation would fall into and the one that would
 * have hidden the audit's finding.
 */
export function mfaPostureFrom(
  mfa: AwsRead<PoolMfaDetail>,
  detail: AwsRead<PoolDetail>,
): MfaPosture {
  let raw: string | null = null
  let factors: string[] = []
  let provenance = ""

  if (mfa.state === "ACTUAL" || mfa.state === "STALE") {
    raw = mfa.value.mfaConfigurationRaw
    if (mfa.value.softwareTokenEnabled) factors.push("software token (TOTP)")
    if (mfa.value.smsConfigured) factors.push("SMS")
    if (mfa.value.emailConfigured) factors.push("email")
    provenance = "cognito-idp:GetUserPoolMfaConfig"
  } else if (detail.state === "ACTUAL" || detail.state === "STALE") {
    raw = detail.value.mfaConfigurationRaw
    factors = []
    provenance =
      "cognito-idp:DescribeUserPool — the authoritative MFA read was not available " +
      `(${describeRead(mfa, "the pool's MFA configuration")})`
  } else {
    return {
      kind: "unknown",
      why:
        `neither read answered. ${describeRead(mfa, "the pool's MFA configuration")} ` +
        `${describeRead(detail, "the pool description")}`,
    }
  }

  if (raw === null) {
    return {
      kind: "unknown",
      why:
        `${provenance} answered without an MFA configuration. Whether this pool enforces a ` +
        `second factor is unread, which is not the same as its enforcing one.`,
    }
  }
  switch (raw) {
    case "ON":
      return { kind: "enforced", factors, provenance }
    case "OPTIONAL":
      return {
        kind: "optional",
        factors,
        provenance,
        why:
          "OPTIONAL means every operator may enrol a second factor and none has to. For a pool " +
          "whose members can publish tenant configuration, that is the same protection as OFF " +
          "while reading like a choice somebody made.",
      }
    case "OFF":
      return {
        kind: "off",
        provenance,
        why:
          "no second factor is possible for any account in this pool. A single stolen password " +
          "is the whole estate.",
      }
    default:
      return { kind: "unrecognised", raw, provenance }
  }
}

async function readClients(
  gw: AwsGateway,
  poolId: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<PoolClientInventory>> {
  return readAws<PoolClientInventory>(
    "cognito-idp:ListUserPoolClients",
    async () => {
      const listed: Array<{ clientId: string; name: string | null }> = []
      let token: string | undefined
      let pagesWalked = 0
      for (let page = 0; page < MAX_CLIENT_PAGES; page += 1) {
        const response = (await gw.call("cognito-idp:ListUserPoolClients", {
          UserPoolId: poolId,
          NextToken: token,
        })) as ListUserPoolClientsResponse
        pagesWalked = page + 1
        for (const client of response?.UserPoolClients ?? []) {
          if (typeof client?.ClientId === "string" && client.ClientId) {
            listed.push({
              clientId: client.ClientId,
              name: typeof client.ClientName === "string" ? client.ClientName : null,
            })
          }
        }
        token = response?.NextToken || undefined
        if (!token) break
      }
      listed.sort((a, b) => (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0))

      const clients: PoolClientReading[] = []
      for (let i = 0; i < listed.length; i += 1) {
        const entry = listed[i]
        if (i >= MAX_CLIENTS_DESCRIBED) {
          clients.push({
            clientId: entry.clientId,
            name: entry.name,
            detail: {
              state: "UNCONFIGURED",
              capability: "cognito-idp:DescribeUserPoolClient",
              why:
                `this engine describes at most ${MAX_CLIENTS_DESCRIBED} app clients per pool and ` +
                `this is number ${i + 1} of ${listed.length}. Its configuration was not read — ` +
                `which is not the same as its having none.`,
            },
          })
          continue
        }
        clients.push({
          clientId: entry.clientId,
          name: entry.name,
          detail: await readClientDetail(gw, poolId, entry.clientId, options),
        })
      }

      const completeness: Completeness = token
        ? {
            kind: "truncated",
            pagesWalked,
            seen: listed.length,
            why:
              `this engine walks at most ${MAX_CLIENT_PAGES} pages of app clients and AWS still ` +
              `had more. There are more ways into this pool than the ${listed.length} shown.`,
          }
        : { kind: "complete", pagesWalked }
      return { clients, completeness }
    },
    {
      now: options.now,
      denial: options.denial,
      isEmpty: (value) => (value as PoolClientInventory).clients.length === 0,
      ...RETRY,
    },
  )
}

async function readClientDetail(
  gw: AwsGateway,
  poolId: string,
  clientId: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<PoolClientDetail>> {
  return readAws<PoolClientDetail>(
    "cognito-idp:DescribeUserPoolClient",
    async () => {
      const response = (await gw.call("cognito-idp:DescribeUserPoolClient", {
        UserPoolId: poolId,
        ClientId: clientId,
      })) as DescribeUserPoolClientResponse
      const client = response?.UserPoolClient
      if (!client) {
        throw new Error(
          `cognito-idp:DescribeUserPoolClient answered for ${clientId} with no client. Its ` +
            `callback URLs and OAuth flows cannot be stated from that.`,
        )
      }
      const units: Record<string, string> = {}
      for (const [key, value] of Object.entries(client.TokenValidityUnits ?? {})) {
        if (typeof value === "string") units[key] = value
      }
      return {
        clientId: client.ClientId ?? clientId,
        name: typeof client.ClientName === "string" ? client.ClientName : null,
        // The one place the secret is touched. A BOOLEAN leaves this function
        // and the value does not: it is not stored, not logged, not returned,
        // and not interpolated into any string this module builds.
        hasSecret: typeof client.ClientSecret === "string" && client.ClientSecret.length > 0,
        callbackUrls: (client.CallbackURLs ?? []).filter((u): u is string => typeof u === "string"),
        logoutUrls: (client.LogoutURLs ?? []).filter((u): u is string => typeof u === "string"),
        allowedOAuthFlows: (client.AllowedOAuthFlows ?? []).filter(
          (f): f is string => typeof f === "string",
        ),
        allowedOAuthScopes: (client.AllowedOAuthScopes ?? []).filter(
          (s): s is string => typeof s === "string",
        ),
        explicitAuthFlows: (client.ExplicitAuthFlows ?? []).filter(
          (f): f is string => typeof f === "string",
        ),
        supportedIdentityProviders: (client.SupportedIdentityProviders ?? []).filter(
          (p): p is string => typeof p === "string",
        ),
        tokenRevocationEnabled:
          typeof client.EnableTokenRevocation === "boolean" ? client.EnableTokenRevocation : null,
        preventUserExistenceErrors:
          typeof client.PreventUserExistenceErrors === "string"
            ? client.PreventUserExistenceErrors
            : null,
        accessTokenValidity:
          typeof client.AccessTokenValidity === "number" ? client.AccessTokenValidity : null,
        idTokenValidity: typeof client.IdTokenValidity === "number" ? client.IdTokenValidity : null,
        refreshTokenValidity:
          typeof client.RefreshTokenValidity === "number" ? client.RefreshTokenValidity : null,
        tokenValidityUnits: units,
      }
    },
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

async function readDomain(
  gw: AwsGateway,
  detail: AwsRead<PoolDetail>,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<PoolDomainDetail>> {
  if (detail.state !== "ACTUAL" && detail.state !== "STALE") {
    // The domain API takes a domain STRING, not a pool identifier, and the only
    // place that string comes from is the pool description. Not attempted is
    // its own state; guessing the prefix would be a call against a domain that
    // may belong to somebody else.
    return {
      state: "UNCONFIGURED",
      capability: "cognito-idp:DescribeUserPoolDomain",
      why:
        `the hosted domain could not be asked about, because the pool description names it and ` +
        `that read did not answer. ${describeRead(detail, "the pool description")}`,
    }
  }
  const domain = detail.value.customDomain ?? detail.value.hostedDomain
  if (!domain) {
    return {
      state: "UNCONFIGURED",
      capability: "cognito-idp:DescribeUserPoolDomain",
      why:
        "this pool has no hosted-UI domain and no custom domain, so there is no sign-in page for " +
        "it. Operators reach it through an app client only.",
    }
  }
  return readAws<PoolDomainDetail>(
    "cognito-idp:DescribeUserPoolDomain",
    async () => {
      const response = (await gw.call("cognito-idp:DescribeUserPoolDomain", {
        Domain: domain,
      })) as DescribeUserPoolDomainResponse
      const description = response?.DomainDescription
      if (!description || !description.Domain) {
        throw new Error(
          `cognito-idp:DescribeUserPoolDomain answered for ${domain} with no description. ` +
            `Whether the sign-in page is live cannot be stated from that.`,
        )
      }
      return {
        domain: description.Domain,
        status: typeof description.Status === "string" ? description.Status : null,
        version: typeof description.Version === "string" ? description.Version : null,
        cloudFrontDistribution:
          typeof description.CloudFrontDistribution === "string"
            ? description.CloudFrontDistribution
            : null,
        certificateArn:
          typeof description.CustomDomainConfig?.CertificateArn === "string"
            ? description.CustomDomainConfig.CertificateArn
            : null,
      }
    },
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

/**
 * The sign-in identifier for one roster row, and nothing else about them.
 *
 * `client.ts` asks for the `email` attribute only. This filters again on the
 * way out, so if that narrowing is ever widened — for a legitimate reason, in
 * another agent's change — no additional attribute value can reach a render
 * through this module.
 */
function signInIdentifierOf(user: {
  Username?: string
  Attributes?: Array<{ Name?: string; Value?: string }>
}): { signInIdentifier: string; identifierProvenance: "email attribute" | "username" } {
  for (const attribute of user.Attributes ?? []) {
    if (attribute?.Name === "email" && typeof attribute.Value === "string" && attribute.Value) {
      return { signInIdentifier: attribute.Value, identifierProvenance: "email attribute" }
    }
  }
  return {
    signInIdentifier: typeof user.Username === "string" ? user.Username : "",
    identifierProvenance: "username",
  }
}

/**
 * How far into the temporary-password window a pending account is.
 *
 * The basis is the account's LAST MODIFIED time rather than its creation time,
 * and that is a deliberate choice with a cost: resending an invitation reissues
 * the temporary password AND updates last-modified, so last-modified is the
 * closest observable proxy for when the current credential was issued — but an
 * unrelated attribute edit moves it too. `sinceMeans` carries that so the
 * number is never read as more precise than it is.
 */
export function firstSignInWindowOf(
  status: OperatorStatus,
  lastModifiedAt: string | null,
  createdAt: string | null,
  window: TemporaryPasswordWindow,
  asOf: string,
): FirstSignInWindow {
  if (status.code !== "FORCE_CHANGE_PASSWORD") {
    return {
      kind: "not-pending",
      why: "this account is not waiting on a first sign-in, so no temporary password is open on it.",
    }
  }
  if (window.kind === "unknown") {
    return {
      kind: "unknown",
      why:
        `this account is waiting on its first sign-in, and how long its temporary password lasts ` +
        `is unread — ${window.why}`,
    }
  }
  const basis = lastModifiedAt ?? createdAt
  const elapsed = msBetween(basis, asOf)
  if (basis === null || elapsed === null) {
    return {
      kind: "unknown",
      why:
        "this account is waiting on its first sign-in and the roster returned no timestamp for " +
        "it, so how long that credential has been open cannot be stated.",
    }
  }
  const ageDays = Math.floor(elapsed / MS_PER_DAY)
  const sinceMeans =
    lastModifiedAt !== null
      ? "measured from last-modified, which is when the temporary password was most recently " +
        "issued — and also when any other attribute was last edited"
      : "measured from the account's creation, because the roster returned no last-modified time"
  if (ageDays > window.days) {
    return {
      kind: "expired",
      ageDays,
      windowDays: window.days,
      since: basis,
      sinceMeans,
      why:
        `the temporary password expired after ${window.days} day(s) and this account has been ` +
        `waiting ${ageDays}. It cannot complete a first sign-in; the account is stranded and ` +
        `needs a new invitation.`,
    }
  }
  return { kind: "open", ageDays, windowDays: window.days, since: basis, sinceMeans }
}

/**
 * Whether an administratively created account reached CONFIRMED without a human
 * ever signing in — the observable shadow of a permanent password set at
 * creation.
 *
 * Returns null whenever the question cannot be asked: a pool that permits
 * self-signup, a status other than CONFIRMED, or missing timestamps. Never
 * guesses, and never claims certainty — the returned object carries its two
 * timestamps, the window it was judged against, and the caveat that would
 * disprove it.
 */
export function permanentPasswordSuspicion(
  status: OperatorStatus,
  createdAt: string | null,
  lastModifiedAt: string | null,
  adminCreateUserOnly: boolean | null,
): OperatorReading["neverForcedAPasswordChange"] {
  if (status.code !== "CONFIRMED") return null
  if (adminCreateUserOnly !== true) return null
  const settled = msBetween(createdAt, lastModifiedAt ?? createdAt)
  if (createdAt === null || settled === null) return null
  if (settled > PERMANENT_PASSWORD_SUSPICION_WINDOW_MS) return null
  return {
    suspected: true,
    createdAt,
    confirmedWithinMs: settled,
    windowMs: PERMANENT_PASSWORD_SUSPICION_WINDOW_MS,
    why:
      `this pool only an administrator may create accounts in, and this account reached CONFIRMED ` +
      `${Math.round(settled / 1000)}s after it was created. Reaching CONFIRMED requires either a ` +
      `human completing a forced password change — which does not happen seconds after a ` +
      `provisioning run — or a password an administrator set permanently. The credential this ` +
      `account signs in with is therefore one nobody was forced to change.`,
    caveat: OPERATOR_SUSPICION_CAVEAT,
  }
}

async function readOperators(
  gw: AwsGateway,
  poolId: string,
  detail: AwsRead<PoolDetail>,
  options: { now: () => Date; denial: DenialContext; asOf: string },
): Promise<AwsRead<OperatorRoster>> {
  const window: TemporaryPasswordWindow =
    detail.state === "ACTUAL" || detail.state === "STALE"
      ? detail.value.temporaryPasswordWindow
      : {
          kind: "unknown",
          why: `the pool's password policy was not read — ${describeRead(detail, "the pool description")}`,
        }
  const adminCreateUserOnly =
    detail.state === "ACTUAL" || detail.state === "STALE" ? detail.value.adminCreateUserOnly : null

  return readAws<OperatorRoster>(
    "cognito-idp:ListUsers",
    async () => {
      const operators: OperatorReading[] = []
      let token: string | undefined
      let pagesWalked = 0
      for (let page = 0; page < MAX_OPERATOR_PAGES; page += 1) {
        const response = (await gw.call("cognito-idp:ListUsers", {
          UserPoolId: poolId,
          PaginationToken: token,
        })) as ListUsersResponse
        pagesWalked = page + 1
        for (const user of response?.Users ?? []) {
          if (!user) continue
          const status = classifyStatus(user.UserStatus)
          const createdAt = isoOf(user.UserCreateDate)
          const lastModifiedAt = isoOf(user.UserLastModifiedDate)
          const media = (user.MFAOptions ?? [])
            .map((option) => (typeof option?.DeliveryMedium === "string" ? option.DeliveryMedium : ""))
            .filter((m) => m !== "")
          operators.push({
            ...signInIdentifierOf(user),
            status,
            enabled: typeof user.Enabled === "boolean" ? user.Enabled : null,
            mfa: {
              smsConfigured: (user.MFAOptions ?? []).length > 0,
              smsDeliveryMedia: media,
              softwareToken: SOFTWARE_TOKEN_NOT_READABLE,
              why:
                (user.MFAOptions ?? []).length > 0
                  ? "SMS MFA is configured on this account. Whether a software token is also " +
                    "enrolled is not readable from the roster."
                  : "SMS MFA is not configured on this account. That is NOT the same as no second " +
                    "factor: software-token enrolment is not readable from the roster.",
            },
            lastSignIn: LAST_SIGN_IN_NOT_READABLE,
            createdAt,
            lastModifiedAt,
            firstSignInWindow: firstSignInWindowOf(
              status,
              lastModifiedAt,
              createdAt,
              window,
              options.asOf,
            ),
            neverForcedAPasswordChange: permanentPasswordSuspicion(
              status,
              createdAt,
              lastModifiedAt,
              adminCreateUserOnly,
            ),
          })
        }
        token = response?.PaginationToken || undefined
        if (!token) break
      }
      const completeness: Completeness = token
        ? {
            kind: "truncated",
            pagesWalked,
            seen: operators.length,
            why:
              `this engine walks at most ${MAX_OPERATOR_PAGES} pages of the roster and AWS still ` +
              `had more. ${operators.length} account(s) are shown and this pool holds more; the ` +
              `accounts not shown have not been checked for anything below.`,
          }
        : { kind: "complete", pagesWalked }
      operators.sort((a, b) =>
        a.signInIdentifier < b.signInIdentifier
          ? -1
          : a.signInIdentifier > b.signInIdentifier
            ? 1
            : 0,
      )
      return { operators, completeness }
    },
    {
      now: options.now,
      denial: options.denial,
      isEmpty: (value) => (value as OperatorRoster).operators.length === 0,
      ...RETRY,
    },
  )
}

/* ---------------------------------------------------------- attribution -- */

/**
 * Which tenant a pool belongs to, preferring the pool's own tags.
 *
 * `DescribeUserPool` returns `UserPoolTags`, which is the service's own answer
 * about its own resource; the Resource Groups Tagging API index is a second
 * source that may not have indexed a pool yet. Both are tags. Neither is a
 * name. `unknown` is returned when neither answered, because "we could not read
 * this pool's tags" and "this pool has no tenant tag" have opposite remedies.
 */
export function poolAttribution(
  detail: AwsRead<PoolDetail>,
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): PoolAttribution {
  if (detail.state === "ACTUAL" || detail.state === "STALE") {
    return shape(detail.value.tags, "the pool's own tags, from cognito-idp:DescribeUserPool")
  }
  const indexReadable =
    tagged.state === "ACTUAL" || tagged.state === "STALE" || tagged.state === "EMPTY"
  if (!indexReadable) {
    return {
      kind: "unknown",
      why:
        `neither this pool's own tags nor the estate tag index could be read — ` +
        `${describeRead(detail, "the pool description")} ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this pool's description was not readable, so this engine has no ARN for it and cannot " +
        "join it against the tag index. Unattributed would be a claim about its tags; this is a " +
        "claim about ours.",
    }
  }
  const tags = index.get(arn)
  if (tags === undefined) {
    return {
      kind: "unattributed",
      provenance:
        "the estate tag index answered and this pool's ARN is not in it, which means it carries " +
        "no tags at all",
    }
  }
  return shape(tags, "the estate tag index (tag:GetResources)")

  function shape(
    tags: Readonly<Record<string, string>>,
    provenance: string,
  ): PoolAttribution {
    const decided = attributionOf(tags)
    switch (decided.kind) {
      case "tenant":
        return { kind: "tenant", tenantSlug: decided.tenantSlug, provenance }
      case "shared":
        return { kind: "shared", provenance }
      case "unattributed":
        return { kind: "unattributed", provenance }
    }
  }
}

/**
 * A pool's ARN, assembled from the resolved identity.
 *
 * Used ONLY when `DescribeUserPool` could not be read — when it can, AWS's own
 * `Arn` is used instead. The format `arn:PARTITION:cognito-idp:REGION:ACCOUNT:
 * userpool/ID` is the documented one, and every variable part comes from the
 * resolved identity: `sts:GetCallerIdentity` for the account and the partition,
 * the SDK's own resolved region for the region. There is no literal region here
 * and no `"aws"` fallback — GE-010-007 was a residency defect caused by exactly
 * that fallback.
 *
 * It exists because without it a refused description costs the pool its tag
 * join as well, and a pool that cannot be joined against the tag index renders
 * as `unattributed` — a specific, actionable, FALSE finding ("somebody forgot
 * to tag this") produced by a call nobody was allowed to make.
 *
 * `ListUserPools` is regional and returns pools in the caller's own account, so
 * both the region and the account in the assembled ARN are the ones the pool is
 * actually in. Returns null when identity is unresolved, because half an ARN
 * joins against nothing and reads exactly like an untagged pool.
 */
export function derivePoolArn(poolId: string, identity: AwsRead<Identity>): string | null {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return null
  if (!poolId) return null
  const { partition, region, accountId } = identity.value
  if (!partition || !region || !accountId) return null
  return `arn:${partition}:cognito-idp:${region}:${accountId}:userpool/${poolId}`
}

/** The effective tags for a pool, from whichever source answered. Null when neither did. */
function effectiveTags(
  detail: AwsRead<PoolDetail>,
  arn: string | null,
  index: Map<string, Readonly<Record<string, string>>>,
): Readonly<Record<string, string>> | null {
  if (detail.state === "ACTUAL" || detail.state === "STALE") return detail.value.tags
  if (arn) {
    const tags = index.get(arn)
    if (tags !== undefined) return tags
  }
  return null
}

/* -------------------------------------------------------- the entry point -- */

/**
 * Every user pool in the resolved region, its configuration, its clients, its
 * domain, its MFA posture and its operator roster.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
/**
 * `DescribeUserPool` for a named set of pools, and nothing else.
 *
 * STUDIO-060-004 needs one field — `EstimatedNumberOfUsers` — for the pools a
 * tenant is attributed, and `cognitoReadings()` is the wrong instrument for
 * that: it lists every pool in the region and then reads MFA configuration,
 * app clients, domains and the operator roster for each. That is the right
 * load for the identity surface and an unreasonable one for a tenant page that
 * wants a count.
 *
 * So this is the same reader, over ids the caller already resolved — not a
 * second description of a pool. The per-pool result is an `AwsRead`, so a
 * denial arrives as a denial rather than as an absent pool.
 */
export async function userPoolDetails(
  poolIds: readonly string[],
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<readonly { poolId: string; detail: AwsRead<PoolDetail> }[]> {
  if (poolIds.length === 0) return []
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)

  const out: { poolId: string; detail: AwsRead<PoolDetail> }[] = []
  for (let start = 0; start < poolIds.length; start += POOL_CONCURRENCY) {
    const batch = poolIds.slice(start, start + POOL_CONCURRENCY)
    const read = await Promise.all(
      batch.map(async (poolId) => ({
        poolId,
        detail: await readPoolDetail(gw, poolId, { now, denial }),
      })),
    )
    out.push(...read)
  }
  return out
}

export async function cognitoReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<CognitoReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const listed = await listPoolIds(gw, { now, denial })
  const asOf = now().toISOString()
  const refreshMs = {
    pools: CAPABILITIES["cognito-idp:ListUserPools"].refreshMs,
    detail: CAPABILITIES["cognito-idp:DescribeUserPool"].refreshMs,
    mfa: CAPABILITIES["cognito-idp:GetUserPoolMfaConfig"].refreshMs,
    clients: CAPABILITIES["cognito-idp:ListUserPoolClients"].refreshMs,
    clientDetail: CAPABILITIES["cognito-idp:DescribeUserPoolClient"].refreshMs,
    domain: CAPABILITIES["cognito-idp:DescribeUserPoolDomain"].refreshMs,
    operators: CAPABILITIES["cognito-idp:ListUsers"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an inventory.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: after this narrowing the remaining arms are precisely the ones
    // with no `value` field, so they already ARE an `AwsRead<PoolInventory>`. A
    // cast here would be the place an empty inventory could be smuggled in.
    const pools: AwsRead<PoolInventory> = listed
    return {
      identity,
      tagged,
      pools,
      consolePool: {
        kind: "unknown",
        why: describeRead(listed, "the user-pool listing"),
      },
      findings: [
        {
          kind: "pools-unknown",
          severity: "unknown",
          text:
            `the user pools in this region could not be listed, so nothing can be said about the ` +
            `pool guarding this console — ${describeRead(listed, "the user-pool listing")}`,
        },
      ],
      asOf,
      refreshMs,
    }
  }

  const entries = listed.value.pools
  const readings: PoolReading[] = new Array(entries.length)
  for (let start = 0; start < entries.length; start += POOL_CONCURRENCY) {
    const batch = entries.slice(start, start + POOL_CONCURRENCY)
    const read = await Promise.all(
      batch.map((entry, offset) =>
        readOnePool(gw, entry, start + offset, entries.length, {
          now,
          denial,
          asOf,
          identity,
          tagged,
          index,
        }),
      ),
    )
    for (let i = 0; i < read.length; i += 1) readings[start + i] = read[i]
  }

  const inventory: PoolInventory = {
    pools: readings,
    completeness: listed.value.completeness,
    scope:
      "the user pools in the region this engine resolved from its own credentials. " +
      "cognito-idp:ListUserPools is a regional call; pools in other regions are not shown and " +
      "are not claimed to be absent.",
  }
  const pools: AwsRead<PoolInventory> = { ...listed, value: inventory }
  return {
    identity,
    tagged,
    pools,
    consolePool: identifyConsolePool(pools),
    findings: cognitoFindings(pools),
    asOf,
    refreshMs,
  }
}

async function readOnePool(
  gw: AwsGateway,
  entry: { poolId: string; name: string | null },
  position: number,
  total: number,
  context: {
    now: () => Date
    denial: DenialContext
    asOf: string
    identity: AwsRead<Identity>
    tagged: AwsRead<readonly TaggedResource[]>
    index: Map<string, Readonly<Record<string, string>>>
  },
): Promise<PoolReading> {
  const { now, denial, asOf, identity, tagged, index } = context

  if (position >= MAX_POOLS_DESCRIBED) {
    const why =
      `this engine describes at most ${MAX_POOLS_DESCRIBED} pools per load and this pool is ` +
      `number ${position + 1} of ${total}. Nothing about it was read — which is not the same as ` +
      `its having no MFA, no clients and no operators.`
    const skipped = <T,>(capability: PoolCapability): AwsRead<T> => ({
      state: "UNCONFIGURED",
      capability,
      why,
    })
    const detail = skipped<PoolDetail>("cognito-idp:DescribeUserPool")
    const mfa = skipped<PoolMfaDetail>("cognito-idp:GetUserPoolMfaConfig")
    const derived = derivePoolArn(entry.poolId, identity)
    return {
      poolId: entry.poolId,
      listedName: entry.name,
      arn: derived,
      arnProvenance: arnProvenanceFor(null, derived),
      ...locationOf(null, identity),
      attribution: poolAttribution(detail, derived, tagged, index),
      detail,
      mfa,
      mfaPosture: mfaPostureFrom(mfa, detail),
      clients: skipped<PoolClientInventory>("cognito-idp:ListUserPoolClients"),
      domain: skipped<PoolDomainDetail>("cognito-idp:DescribeUserPoolDomain"),
      operators: skipped<OperatorRoster>("cognito-idp:ListUsers"),
      guardsThisConsole: null,
      asOf,
    }
  }

  // Every sub-read is its own `AwsRead` and every one is awaited independently.
  // A refused `GetUserPoolMfaConfig` must not collapse the roster to UNKNOWN,
  // and a refused `ListUsers` must not hide that MFA is OPTIONAL.
  const detail = await readPoolDetail(gw, entry.poolId, { now, denial })
  const [mfa, clients, domain, operators] = await Promise.all([
    readPoolMfa(gw, entry.poolId, { now, denial }),
    readClients(gw, entry.poolId, { now, denial }),
    readDomain(gw, detail, { now, denial }),
    readOperators(gw, entry.poolId, detail, { now, denial, asOf }),
  ])

  const fromAws = detail.state === "ACTUAL" || detail.state === "STALE" ? detail.value.arn : null
  const derived = fromAws ? null : derivePoolArn(entry.poolId, identity)
  const arn = fromAws ?? derived
  const tags = effectiveTags(detail, arn, index)
  return {
    poolId: entry.poolId,
    listedName: entry.name,
    arn,
    arnProvenance: arnProvenanceFor(fromAws, derived),
    // Location comes from AWS's OWN ARN or from nothing: an assembled ARN's
    // region is the identity's region by construction, so reporting it as the
    // pool's would be this engine quoting itself back as evidence.
    ...locationOf(fromAws, identity),
    attribution: poolAttribution(detail, arn, tagged, index),
    detail,
    mfa,
    mfaPosture: mfaPostureFrom(mfa, detail),
    clients,
    domain,
    operators,
    guardsThisConsole: tags === null ? null : tags[CONSOLE_POOL_TAG_KEY] === CONSOLE_POOL_TAG_VALUE,
    asOf,
  }
}

/** Where a pool's ARN came from, said out loud so a join is never mistaken for a read. */
function arnProvenanceFor(fromAws: string | null, derived: string | null): string {
  if (fromAws) return "AWS's own Arn, from cognito-idp:DescribeUserPool"
  if (derived) {
    return (
      "assembled from the resolved identity's partition, region and account and this pool's " +
      "identifier — the pool's own description was not readable. Used to join the tag index, " +
      "never as evidence of where the pool is"
    )
  }
  return (
    "none — the pool description was not readable and identity is unresolved, so this engine " +
    "will not assemble an ARN it cannot stand behind"
  )
}

/** The capabilities a pool's sub-reads are attributed to. Kept honest by the registry. */
type PoolCapability =
  | "cognito-idp:DescribeUserPool"
  | "cognito-idp:GetUserPoolMfaConfig"
  | "cognito-idp:ListUserPoolClients"
  | "cognito-idp:DescribeUserPoolClient"
  | "cognito-idp:DescribeUserPoolDomain"
  | "cognito-idp:ListUsers"

/**
 * Where a pool lives.
 *
 * From the ARN AWS returned, and otherwise from the resolved identity. Not from
 * the pool identifier's own region prefix, and emphatically not from a literal:
 * GE-010-007 was a residency defect caused by a hardcoded region, and every
 * value here is traceable to something AWS said.
 */
function locationOf(
  arn: string | null,
  identity: AwsRead<Identity>,
): { region: string | null; partition: string | null; accountId: string | null; locationProvenance: string } {
  const parts = arn ? arn.split(":") : []
  if (parts.length >= 6 && parts[0] === "arn") {
    return {
      partition: parts[1] || null,
      region: parts[3] || null,
      accountId: parts[4] || null,
      locationProvenance: "the pool's own ARN, as cognito-idp:DescribeUserPool returned it",
    }
  }
  if (identity.state === "ACTUAL" || identity.state === "STALE") {
    return {
      partition: identity.value.partition,
      region: identity.value.region,
      accountId: identity.value.accountId,
      locationProvenance:
        "the resolved identity — sts:GetCallerIdentity for the account and partition, the SDK's " +
        "own resolved region — because the pool description did not return an ARN",
    }
  }
  return {
    partition: null,
    region: null,
    accountId: null,
    locationProvenance:
      "none — the pool description returned no ARN and identity is unresolved, so this engine " +
      "will not state a region it cannot stand behind",
  }
}

/* --------------------------------------------------------- identification -- */

/** Which pool guards this console, decided by tag and never by name. */
export function identifyConsolePool(pools: AwsRead<PoolInventory>): ConsolePoolIdentification {
  if (pools.state !== "ACTUAL" && pools.state !== "STALE") {
    return { kind: "unknown", why: describeRead(pools, "the user-pool listing") }
  }
  const readings = pools.value.pools
  const matched = readings.filter((p) => p.guardsThisConsole === true).map((p) => p.poolId)
  if (matched.length === 1) {
    return {
      kind: "identified",
      poolId: matched[0],
      how: `it carries ${CONSOLE_POOL_TAG_KEY} = ${CONSOLE_POOL_TAG_VALUE}, which the Studio stack sets on everything it owns`,
    }
  }
  if (matched.length > 1) {
    return {
      kind: "ambiguous",
      poolIds: matched.sort(),
      why:
        `${matched.length} pools carry ${CONSOLE_POOL_TAG_KEY} = ${CONSOLE_POOL_TAG_VALUE}. This ` +
        `engine will not pick one of them by name; whichever is stale is an extra way in.`,
    }
  }
  const unreadable = readings.filter((p) => p.guardsThisConsole === null).map((p) => p.poolId)
  if (unreadable.length > 0) {
    return {
      kind: "unknown",
      why:
        `no pool that answered carries ${CONSOLE_POOL_TAG_KEY} = ${CONSOLE_POOL_TAG_VALUE}, and ` +
        `${unreadable.length} pool(s) could not be read at all (${unreadable.sort().join(", ")}). ` +
        `Which pool guards this console is unknown.`,
    }
  }
  return {
    kind: "not-tagged",
    poolsRead: readings.length,
    why:
      `all ${readings.length} pool(s) answered and none carries ${CONSOLE_POOL_TAG_KEY} = ` +
      `${CONSOLE_POOL_TAG_VALUE}. Either the console's pool is in another region, or the stack ` +
      `that created it stopped tagging it — and an untagged pool cannot be told from somebody ` +
      `else's.`,
  }
}

/* -------------------------------------------------------------- findings -- */

/**
 * The findings, derived from the readings and nothing else.
 *
 * Exported and pure so the derivation can be reasoned about on its own, but
 * `cognitoReadings` is the only production caller and the tests drive it
 * through there.
 */
export function cognitoFindings(pools: AwsRead<PoolInventory>): readonly CognitoFinding[] {
  if (pools.state !== "ACTUAL" && pools.state !== "STALE") {
    return [
      {
        kind: "pools-unknown",
        severity: "unknown",
        text:
          `the user pools in this region could not be listed, so nothing can be said about the ` +
          `pool guarding this console — ${describeRead(pools, "the user-pool listing")}`,
      },
    ]
  }

  const findings: CognitoFinding[] = []
  for (const pool of pools.value.pools) {
    const posture = pool.mfaPosture
    switch (posture.kind) {
      case "optional":
        findings.push({
          kind: "mfa-not-enforced",
          severity: "critical",
          poolId: pool.poolId,
          posture,
          text:
            `MFA is OPTIONAL on ${pool.poolId} — ${posture.why} (read from ${posture.provenance})`,
        })
        break
      case "off":
        findings.push({
          kind: "mfa-not-enforced",
          severity: "critical",
          poolId: pool.poolId,
          posture,
          text: `MFA is OFF on ${pool.poolId} — ${posture.why} (read from ${posture.provenance})`,
        })
        break
      case "unrecognised":
        findings.push({
          kind: "mfa-unknown",
          severity: "unknown",
          poolId: pool.poolId,
          text:
            `${pool.poolId} reports an MFA configuration this engine does not model ` +
            `(${posture.raw}, read from ${posture.provenance}). Whether a second factor is ` +
            `required is unread.`,
        })
        break
      case "unknown":
        findings.push({
          kind: "mfa-unknown",
          severity: "unknown",
          poolId: pool.poolId,
          text: `whether a second factor is enforced on ${pool.poolId} is unknown — ${posture.why}`,
        })
        break
      case "enforced":
        break
    }

    if (
      (pool.detail.state === "ACTUAL" || pool.detail.state === "STALE") &&
      pool.detail.value.adminCreateUserOnly === false
    ) {
      findings.push({
        kind: "self-signup-open",
        severity: "critical",
        poolId: pool.poolId,
        text:
          `${pool.poolId} permits self-signup — anybody who reaches its sign-in page can create ` +
          `an account in the pool that guards this console.`,
      })
    }

    if (
      (pool.detail.state === "ACTUAL" || pool.detail.state === "STALE") &&
      pool.detail.value.temporaryPasswordWindow.kind === "default"
    ) {
      findings.push({
        kind: "temporary-password-window-unknown",
        severity: "unknown",
        poolId: pool.poolId,
        text:
          `${pool.poolId} declares no temporary-password validity — ` +
          `${pool.detail.value.temporaryPasswordWindow.why}`,
      })
    } else if (pool.detail.state !== "ACTUAL" && pool.detail.state !== "STALE") {
      findings.push({
        kind: "temporary-password-window-unknown",
        severity: "unknown",
        poolId: pool.poolId,
        text:
          `how long a temporary password lasts in ${pool.poolId} is unknown — ` +
          `${describeRead(pool.detail, "the pool description")}`,
      })
    }

    if (pool.operators.state === "EMPTY") {
      // Read, and there is genuinely nobody. NOT a finding of the unknown kind:
      // "this pool has no accounts" is an answer, and reporting it as "who may
      // sign in is unknown" would send an operator to check a policy that is
      // working. There is simply nobody to iterate.
      continue
    }
    if (pool.operators.state !== "ACTUAL" && pool.operators.state !== "STALE") {
      findings.push({
        kind: "roster-unknown",
        severity: "unknown",
        poolId: pool.poolId,
        text:
          `who may sign in to ${pool.poolId} is unknown — ` +
          `${describeRead(pool.operators, "the operator roster")}`,
      })
      continue
    }

    for (const operator of pool.operators.value.operators) {
      const window = operator.firstSignInWindow
      if (window.kind === "expired") {
        findings.push({
          kind: "temporary-password-window-expired",
          severity: "critical",
          poolId: pool.poolId,
          signInIdentifier: operator.signInIdentifier,
          window,
          text:
            `${operator.signInIdentifier} is still awaiting a first sign-in on ${pool.poolId} and ` +
            `its temporary password expired — ${window.why}`,
        })
      } else if (window.kind === "open") {
        findings.push({
          kind: "operator-awaiting-first-password-change",
          severity: "warning",
          poolId: pool.poolId,
          signInIdentifier: operator.signInIdentifier,
          window,
          text:
            `${operator.signInIdentifier} is in FORCE_CHANGE_PASSWORD on ${pool.poolId}, ` +
            `${window.ageDays} day(s) into a ${window.windowDays}-day temporary-password window ` +
            `(${window.sinceMeans}). That credential is live until it is used or expires.`,
        })
      }
      if (operator.neverForcedAPasswordChange) {
        findings.push({
          kind: "operator-never-forced-a-password-change",
          severity: "critical",
          poolId: pool.poolId,
          signInIdentifier: operator.signInIdentifier,
          text:
            `${operator.signInIdentifier} on ${pool.poolId} was never forced to change its ` +
            `password — ${operator.neverForcedAPasswordChange.why} ` +
            `${operator.neverForcedAPasswordChange.caveat}`,
        })
      }
    }
  }
  return findings
}

/* ------------------------------------------------------------- rendering -- */

/** The sentence a surface prints for a pool's MFA posture. One renderer, always. */
export function describeMfaPosture(posture: MfaPosture): string {
  switch (posture.kind) {
    case "enforced":
      return (
        `MFA is enforced (ON)` +
        `${posture.factors.length > 0 ? ` — ${posture.factors.join(", ")}` : " — no factor is enabled, which makes ON unusable"}` +
        ` · read from ${posture.provenance}`
      )
    case "optional":
      return `MFA is OPTIONAL — ${posture.why} · read from ${posture.provenance}`
    case "off":
      return `MFA is OFF — ${posture.why} · read from ${posture.provenance}`
    case "unrecognised":
      return `MFA configuration ${posture.raw} is one this engine does not model · read from ${posture.provenance}`
    case "unknown":
      return `MFA configuration unknown — ${posture.why}`
  }
}

/** The sentence a surface prints for a pool's attribution. */
export function describePoolAttribution(attribution: PoolAttribution): string {
  switch (attribution.kind) {
    case "tenant":
      return `${attribution.tenantSlug} — from ${attribution.provenance}`
    case "shared":
      return `shared — platform overhead, decided; from ${attribution.provenance}`
    case "unattributed":
      return `unattributable — missing tenure:tenant; from ${attribution.provenance}`
    case "unknown":
      return `attribution unknown — ${attribution.why}`
  }
}

/** The sentence a surface prints for one operator. Never a password, never an attribute. */
export function describeOperator(operator: OperatorReading): string {
  const status =
    operator.status.code === "UNRECOGNISED"
      ? `status ${operator.status.raw} (not modelled by this engine)`
      : operator.status.code === "ABSENT"
        ? `status unread — ${operator.status.why}`
        : `status ${operator.status.code}`
  const enabled =
    operator.enabled === null
      ? "enabled unread"
      : operator.enabled
        ? "enabled"
        : "DISABLED — this account exists and cannot sign in"
  const windowText =
    operator.firstSignInWindow.kind === "expired"
      ? ` · ${operator.firstSignInWindow.why}`
      : operator.firstSignInWindow.kind === "open"
        ? ` · ${operator.firstSignInWindow.ageDays} day(s) into a ${operator.firstSignInWindow.windowDays}-day temporary-password window`
        : operator.firstSignInWindow.kind === "unknown"
          ? ` · temporary-password window unknown — ${operator.firstSignInWindow.why}`
          : ""
  const suspicion = operator.neverForcedAPasswordChange
    ? ` · NEVER FORCED A PASSWORD CHANGE — ${operator.neverForcedAPasswordChange.why}`
    : ""
  return (
    `${operator.signInIdentifier} (${operator.identifierProvenance}) — ${status} · ${enabled} · ` +
    `MFA: ${operator.mfa.why} · last sign-in: ${operator.lastSignIn.why}` +
    `${windowText}${suspicion}`
  )
}

/** The sentence a surface prints for a paged read's completeness. */
export function describeCompleteness(completeness: Completeness): string {
  return completeness.kind === "complete"
    ? `complete — ${completeness.pagesWalked} page(s) walked`
    : `TRUNCATED — ${completeness.why}`
}

/** The sentence a surface prints for the console-pool identification. */
export function describeConsolePool(identification: ConsolePoolIdentification): string {
  switch (identification.kind) {
    case "identified":
      return `${identification.poolId} — ${identification.how}`
    case "ambiguous":
      return `ambiguous — ${identification.why} (${identification.poolIds.join(", ")})`
    case "not-tagged":
      return `unidentified — ${identification.why}`
    case "unknown":
      return `unknown — ${identification.why}`
  }
}

export interface CognitoLine {
  label: string
  text: string
}

/**
 * What a Cognito surface prints.
 *
 * A surface agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function cognitoLines(readings: CognitoReadings): readonly CognitoLine[] {
  const lines: CognitoLine[] = [
    {
      label: "User pools",
      text: describeRead(
        readings.pools,
        `user pools read from AWS, refreshed every ${Math.round(readings.refreshMs.pools / 1000)}s`,
      ),
    },
    { label: "Console pool", text: describeConsolePool(readings.consolePool) },
  ]

  if (readings.pools.state === "ACTUAL" || readings.pools.state === "STALE") {
    lines.push({ label: "Scope", text: readings.pools.value.scope })
    lines.push({
      label: "Pool listing",
      text: describeCompleteness(readings.pools.value.completeness),
    })
    for (const pool of readings.pools.value.pools) {
      const where =
        pool.region && pool.partition
          ? `${pool.region} (partition ${pool.partition})`
          : "region unknown — no ARN and identity is unresolved"
      lines.push({
        label: pool.poolId,
        text:
          `${where} — ${describePoolAttribution(pool.attribution)} — ` +
          `${describeMfaPosture(pool.mfaPosture)} · as of ${pool.asOf}, refreshed every ` +
          `${Math.round(readings.refreshMs.mfa / 1000)}s`,
      })
      lines.push({
        label: `${pool.poolId} · policy`,
        text:
          pool.detail.state === "ACTUAL" || pool.detail.state === "STALE"
            ? describePasswordPolicy(pool.detail.value)
            : describeRead(pool.detail, `${pool.poolId} description`),
      })
      lines.push({
        label: `${pool.poolId} · domain`,
        text:
          pool.domain.state === "ACTUAL" || pool.domain.state === "STALE"
            ? `${pool.domain.value.domain} — status ${pool.domain.value.status ?? "unread"}`
            : describeRead(pool.domain, `${pool.poolId} hosted domain`),
      })
      lines.push({
        label: `${pool.poolId} · clients`,
        text:
          pool.clients.state === "ACTUAL" || pool.clients.state === "STALE"
            ? pool.clients.value.clients.map((c) => describeClient(c)).join(" | ") +
              ` · ${describeCompleteness(pool.clients.value.completeness)}`
            : describeRead(pool.clients, `${pool.poolId} app clients`),
      })
      if (pool.operators.state === "ACTUAL" || pool.operators.state === "STALE") {
        lines.push({
          label: `${pool.poolId} · operators`,
          text: `${pool.operators.value.operators.length} account(s) · ${describeCompleteness(pool.operators.value.completeness)}`,
        })
        for (const operator of pool.operators.value.operators) {
          lines.push({ label: `${pool.poolId} · ${operator.signInIdentifier}`, text: describeOperator(operator) })
        }
      } else {
        lines.push({
          label: `${pool.poolId} · operators`,
          text: describeRead(pool.operators, `${pool.poolId} operator roster`),
        })
      }
    }
  }

  for (const finding of readings.findings) {
    lines.push({ label: `Finding (${finding.severity})`, text: finding.text })
  }
  return lines
}

/** The sentence a surface prints for one app client. Never the secret, only whether there is one. */
export function describeClient(client: PoolClientReading): string {
  if (client.detail.state !== "ACTUAL" && client.detail.state !== "STALE") {
    return `${client.clientId} — ${describeRead(client.detail, "this app client")}`
  }
  const d = client.detail.value
  return (
    `${d.name ?? client.clientId} — ${d.hasSecret ? "has a client secret" : "no client secret"} · ` +
    `flows ${d.allowedOAuthFlows.join("/") || "none"} · scopes ${d.allowedOAuthScopes.join("/") || "none"} · ` +
    `${d.callbackUrls.length} callback URL(s) · token revocation ` +
    `${d.tokenRevocationEnabled === null ? "unread" : d.tokenRevocationEnabled ? "on" : "OFF"}`
  )
}

/** The sentence a surface prints for one pool's password policy. */
export function describePasswordPolicy(detail: PoolDetail): string {
  const p = detail.passwordPolicy
  const window =
    detail.temporaryPasswordWindow.kind === "unknown"
      ? `temporary-password window unknown — ${detail.temporaryPasswordWindow.why}`
      : detail.temporaryPasswordWindow.kind === "default"
        ? `temporary-password window ${detail.temporaryPasswordWindow.days} day(s), by AWS default — ${detail.temporaryPasswordWindow.why}`
        : `temporary-password window ${detail.temporaryPasswordWindow.days} day(s), declared`
  const signup =
    detail.adminCreateUserOnly === null
      ? "self-signup unread"
      : detail.adminCreateUserOnly
        ? "administrator-created accounts only"
        : "SELF-SIGNUP IS OPEN"
  return (
    `minimum length ${p.minimumLength ?? "unread"} · ` +
    `upper ${flag(p.requireUppercase)} lower ${flag(p.requireLowercase)} ` +
    `digits ${flag(p.requireNumbers)} symbols ${flag(p.requireSymbols)} · ` +
    `${window} · ${signup} · recovery ${detail.accountRecoveryMechanisms.join(", ") || "unread"}`
  )
}

function flag(value: boolean | null): string {
  return value === null ? "unread" : value ? "required" : "not required"
}
