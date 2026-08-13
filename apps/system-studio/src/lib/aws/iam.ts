/**
 * STUDIO-000-009 — IAM posture: who this estate lets in, on what, and with what.
 *
 * The requirement asks for three facts that nothing in this repository could
 * answer: which resources were created by hand and are managed by nothing, which
 * access keys are long-lived, and which policies carry a wildcard action or a
 * wildcard resource. All three are IAM facts, and all three are read here.
 *
 * ── Why one call and not six ────────────────────────────────────────────────
 *
 * `iam:GetAccountAuthorizationDetails` returns roles, users, their attached and
 * inline policies AND the local managed policy DOCUMENTS in one paged call. The
 * obvious alternative — ListRoles → ListAttachedRolePolicies → GetPolicy →
 * GetPolicyVersion → ListRolePolicies → GetRolePolicy — is six grants and N+1
 * calls against an account-wide, low-TPS API, and it has six chances for exactly
 * one of them to be the denied one that quietly empties the wildcard sweep while
 * every other panel stays green. A sweep that returns "no wildcards" because a
 * sub-call was refused is the defect this whole directory exists to prevent.
 *
 * ── What this module refuses to claim ───────────────────────────────────────
 *
 * Three separate "we did not actually look" facts are carried out to the caller
 * rather than folded into a clean-looking result:
 *
 *   1. `read` is the `AwsRead<IamPosture>` union. DENIED carries the principal,
 *      the action and a pasteable statement; it has no `value` field at all, so
 *      a caller cannot render a denial as an empty role table without the
 *      compiler stopping them.
 *   2. `posture.keyCoverage` counts the users whose `iam:ListAccessKeys` was
 *      refused, throttled or errored. When it is not `complete`, `longLivedKeys`
 *      is a FLOOR and the headline says so. "No long-lived keys" and "we could
 *      not read the keys of four users" are not the same sentence.
 *   3. `posture.unswept` names every attached policy whose document this call
 *      does not return — AWS-managed policies, because `client.ts` filters to
 *      `["User", "Role", "LocalManagedPolicy"]`. `AdministratorAccess` is an
 *      AWS-managed policy and is precisely the wildcard grant an operator is
 *      looking for, so a sweep that silently skipped it and reported zero
 *      wildcards would be worse than no sweep.
 *
 * ── Region, partition, and why there is no literal here ─────────────────────
 *
 * Every account and partition string comes from `resolveIdentity()`, which reads
 * `sts:GetCallerIdentity` and takes the partition off the returned ARN's second
 * segment. `scope.arnPrefix` is BUILT from those two, so a GovCloud estate gets
 * `arn:aws-us-gov:iam::…` and never `arn:aws:`. When identity could not be read
 * the scope is nulls and says so, rather than defaulting — a confident
 * `us-east-1` under a role that could not answer is the GE-010-007 residency
 * defect, and IAM is the last surface that should carry it, because an operator
 * reading a role list attributed to the wrong partition will act on it.
 *
 * IAM itself is partition-global: there is one IAM endpoint per partition, and
 * these findings are account-wide rather than per-region. `scope.region` is the
 * region the SDK resolved for this process, reported because it is what a denial
 * message needs, and `scope.global` says plainly that the findings are not
 * scoped to it.
 *
 * ── Attribution ─────────────────────────────────────────────────────────────
 *
 * A role is attributed to a tenant when a tag says so, through the Resource
 * Groups Tagging API path that already exists in `tags.ts`, falling back to the
 * tags `GetAccountAuthorizationDetails` returns on the principal itself. Three
 * arms, not two: `unattributed` stays separate from `shared`, because for THIS
 * requirement the untagged role IS the finding. Folding "nobody tagged this"
 * into "somebody decided this is platform overhead" would erase exactly the
 * console-created resource STUDIO-000-009 asks to be shown.
 *
 * ── Read only ───────────────────────────────────────────────────────────────
 *
 * Two capabilities, both reads. Nothing here creates, attaches, detaches or
 * deletes anything, no mutating IAM verb is reachable from this module, and the
 * task role denies every one of them by name (infrastructure/studio/iam.tf).
 * `iam:ListAccessKeys` returns key IDs and creation dates; it cannot return a
 * secret access key, and this module never asks for one. The key ID is the
 * identifier an operator needs in order to rotate the key — it is not the
 * credential.
 */

import { MANAGED_BY, tagProblems, type TagProblem } from "@tenure/provisioning"

import { IAM_POSTURE_TTL_MS } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import {
  attributionOf,
  tagIndex,
  taggedResources,
  type Attribution,
  type TaggedResource,
} from "./tags"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/* ---------------------------------------------------------- the schedule -- */

/**
 * The retry schedule, taken from `throttle.ts` rather than invented here.
 *
 * `readAws` retries a throttle with exponential backoff from a first delay; the
 * console already has one answer to "how many attempts and how long between
 * them", and it is `READ_ATTEMPTS` and `backoffMs`. Passing them in means the
 * `retryAfterMs` this surface reports is the schedule's own number — a THROTTLED
 * IAM panel and a THROTTLED tenants read tell an operator to wait the same
 * length of time, because they are waiting on the same policy.
 *
 * `backoffMs(2)` is the pause after the first failure; `readAws` doubles from
 * there, which is exactly what `backoffMs` does for attempts 3, 4 … So the value
 * reported on exhaustion is `backoffMs(READ_ATTEMPTS + 1)`, and the test asserts
 * that identity rather than a copied constant.
 *
 * Classification stays with `read.ts`: it owns which error names mean "denied"
 * and which mean "slow down", and a second opinion here would be a second
 * vocabulary. `throttle.ts` owns the schedule; `read.ts` owns the verdict.
 */
const RETRY_SCHEDULE = { attempts: READ_ATTEMPTS, backoffMs: backoffMs(2) } as const

/** The pause an exhausted throttle reports, derived rather than restated. */
export const THROTTLE_RETRY_AFTER_MS = backoffMs(READ_ATTEMPTS + 1)

/**
 * How old an active access key has to be before it is "long-lived".
 *
 * 90 days, which is the CIS AWS Foundations Benchmark's rotation horizon. A
 * number rather than a judgement, stated once, so a page cannot use 60 and an
 * export use 180 and both call the same key compliant.
 */
export const LONG_LIVED_KEY_DAYS = 90

/** Pages walked before giving up. A runaway page loop is an outage, not a read. */
const MAX_PAGES = 20

/* --------------------------------------------------------- the API shapes -- */

interface TagShape {
  Key?: string
  Value?: string
}

interface AttachedPolicyShape {
  PolicyName?: string
  PolicyArn?: string
}

interface InlinePolicyShape {
  PolicyName?: string
  PolicyDocument?: string
}

interface PolicyDetailShape {
  PolicyName?: string
  Arn?: string
  DefaultVersionId?: string
  PolicyVersionList?: Array<{
    Document?: string
    VersionId?: string
    IsDefaultVersion?: boolean
  }>
}

interface RoleDetailShape {
  Path?: string
  RoleName?: string
  RoleId?: string
  Arn?: string
  CreateDate?: Date | string
  AssumeRolePolicyDocument?: string
  RolePolicyList?: InlinePolicyShape[]
  AttachedManagedPolicies?: AttachedPolicyShape[]
  PermissionsBoundary?: { PermissionsBoundaryArn?: string }
  Tags?: TagShape[]
  RoleLastUsed?: { LastUsedDate?: Date | string; Region?: string }
}

interface UserDetailShape {
  Path?: string
  UserName?: string
  UserId?: string
  Arn?: string
  CreateDate?: Date | string
  UserPolicyList?: InlinePolicyShape[]
  AttachedManagedPolicies?: AttachedPolicyShape[]
  PermissionsBoundary?: { PermissionsBoundaryArn?: string }
  Tags?: TagShape[]
}

interface AuthorizationDetailsResponse {
  RoleDetailList?: RoleDetailShape[]
  UserDetailList?: UserDetailShape[]
  Policies?: PolicyDetailShape[]
  IsTruncated?: boolean
  Marker?: string
}

interface ListAccessKeysResponse {
  AccessKeyMetadata?: Array<{
    UserName?: string
    AccessKeyId?: string
    Status?: string
    CreateDate?: Date | string
  }>
  IsTruncated?: boolean
  Marker?: string
}

/* ---------------------------------------------------- policy documents --- */

/** One normalised statement. `Not*` forms are kept, never dropped — see below. */
export interface PolicyStatement {
  sid: string | null
  effect: string
  actions: readonly string[]
  /** `NotAction` under an Allow is a wildcard by construction: everything else. */
  notActions: readonly string[]
  resources: readonly string[]
  notResources: readonly string[]
  /**
   * Trust-policy principals, flattened to strings.
   *
   * `Principal` arrives as `"*"`, `{"AWS": "*"}`, `{"Service": "…"}` or
   * `{"AWS": ["arn:…", "*"]}`. All four are flattened here so a caller asks one
   * question — is `"*"` in this list — rather than re-deriving the shape at the
   * call site and getting one of the four wrong.
   */
  principals: readonly string[]
  hasCondition: boolean
}

/**
 * A policy document, or an honest account of why it is not one.
 *
 * `UNREADABLE` exists because "this document did not parse" must not enter the
 * sweep as "this document has no wildcards". A JSON parse failure is exactly the
 * shape of bug that makes a credential sweep return empty for every file.
 */
export type PolicyDocumentRead =
  | { state: "PARSED"; statements: readonly PolicyStatement[] }
  | { state: "UNREADABLE"; why: string }

/**
 * Decode an IAM policy document as `GetAccountAuthorizationDetails` returns it.
 *
 * The API returns documents URL-encoded, and the JS SDK does not decode them, so
 * a reader that calls `JSON.parse` straight off the wire throws on every single
 * policy — and a sweep that catches that throw and continues reports a clean
 * account. Documents that already look like JSON are parsed as-is, because an
 * SDK release that starts decoding must not turn this into an outage.
 */
export function decodePolicyDocument(raw: unknown): PolicyDocumentRead {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { state: "UNREADABLE", why: "the response carried no policy document" }
  }
  let text = raw
  if (!raw.trim().startsWith("{")) {
    try {
      text = decodeURIComponent(raw)
    } catch {
      return { state: "UNREADABLE", why: "the document is not valid URL-encoded text" }
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { state: "UNREADABLE", why: "the document did not parse as JSON" }
  }
  const doc = parsed as { Statement?: unknown } | null
  if (!doc || typeof doc !== "object") {
    return { state: "UNREADABLE", why: "the document is not a policy object" }
  }
  const rawStatements = Array.isArray(doc.Statement)
    ? doc.Statement
    : doc.Statement
      ? [doc.Statement]
      : []
  if (rawStatements.length === 0) {
    return { state: "UNREADABLE", why: "the document declares no Statement" }
  }
  const statements: PolicyStatement[] = []
  for (const entry of rawStatements) {
    const s = entry as Record<string, unknown>
    if (!s || typeof s !== "object") continue
    statements.push({
      sid: typeof s.Sid === "string" ? s.Sid : null,
      effect: typeof s.Effect === "string" ? s.Effect : "",
      actions: stringList(s.Action),
      notActions: stringList(s.NotAction),
      resources: stringList(s.Resource),
      notResources: stringList(s.NotResource),
      principals: flattenPrincipal(s.Principal),
      hasCondition: Boolean(s.Condition && typeof s.Condition === "object"),
    })
  }
  if (statements.length === 0) {
    return { state: "UNREADABLE", why: "no statement in the document was an object" }
  }
  return { state: "PARSED", statements }
}

function stringList(value: unknown): readonly string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string")
  return []
}

/**
 * Every principal named by a `Principal` block, whatever shape it took.
 *
 * The keys — `AWS`, `Service`, `Federated`, `CanonicalUser` — are dropped and
 * only the values kept, because the question this feeds is "can anybody assume
 * this", and `{"AWS": "*"}` and `"*"` are the same answer to it.
 */
export function flattenPrincipal(value: unknown): readonly string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) {
    const out: string[] = []
    for (const entry of value) for (const s of flattenPrincipal(entry)) out.push(s)
    return out
  }
  if (value && typeof value === "object") {
    const out: string[] = []
    for (const nested of Object.values(value as Record<string, unknown>)) {
      for (const s of flattenPrincipal(nested)) out.push(s)
    }
    return out
  }
  return []
}

/* ---------------------------------------------------------- wildcards ---- */

/** How wide a statement's actions are. `exact` is the only one that is not a finding. */
export type ActionScope = "all-actions" | "all-service-actions" | "prefix-wildcard" | "exact"

/** How wide a statement's resources are. */
export type ResourceScope = "all-resources" | "arn-pattern" | "exact"

/**
 * What kind of wildcard this is, worst first.
 *
 * A closed union rather than a severity number, because "admin" and "every
 * action in one service" need different sentences and a shared integer would
 * flatten them into the same row.
 */
export type WildcardKind =
  /** `Action: "*"` on `Resource: "*"`. Administrator, whatever the policy is called. */
  | "ADMIN"
  /** Every action, on something narrower than everything. */
  | "ALL_ACTIONS"
  /** Some actions, on every resource in the account. */
  | "ALL_RESOURCES"
  /** `s3:*` — every action in one service. */
  | "SERVICE_WIDE"
  /** `iam:Put*` — a prefix, which grows whenever AWS ships a new API. */
  | "PREFIX"
  /** `NotAction` / `NotResource` under an Allow: everything except a list. */
  | "NEGATED"
  /** A trust policy that any principal can assume. */
  | "ANY_PRINCIPAL"

export interface IamWildcard {
  /** The role or user the policy is attached to. */
  principalArn: string
  principalName: string
  policyName: string
  policyArn: string | null
  source: "attached-managed" | "inline" | "trust-policy"
  statementIndex: number
  statementSid: string | null
  kind: WildcardKind
  actionScope: ActionScope
  resourceScope: ResourceScope
  actions: readonly string[]
  resources: readonly string[]
  /** A `Condition` narrows a wildcard without removing it. Stated, never used to hide it. */
  conditioned: boolean
  detail: string
}

export function actionScopeOf(actions: readonly string[]): ActionScope {
  let widest: ActionScope = "exact"
  for (const action of actions) {
    if (action === "*") return "all-actions"
    if (/^[A-Za-z0-9-]+:\*$/.test(action)) widest = "all-service-actions"
    else if (action.includes("*") && widest === "exact") widest = "prefix-wildcard"
  }
  return widest
}

export function resourceScopeOf(resources: readonly string[]): ResourceScope {
  let widest: ResourceScope = "exact"
  for (const resource of resources) {
    if (resource === "*") return "all-resources"
    // `arn:*:*:*:*:*` is `*` spelled long. Six segments, every one a bare star.
    if (/^arn:\*:\*:\*:\*:\*$/.test(resource)) return "all-resources"
    if (resource.includes("*")) widest = "arn-pattern"
  }
  return widest
}

/**
 * Whether a statement is a finding, and which kind.
 *
 * Only `Allow` statements. A `Deny` on `*` is the opposite of a problem — it is
 * how `infrastructure/studio/iam.tf` stops this console mutating anything — and
 * reporting it as a wildcard grant would train an operator to ignore the panel.
 *
 * `Resource: "arn:aws:s3:::bucket/*"` is deliberately NOT a resource finding: an
 * object-level ARN pattern is the only way to grant object access at all, and
 * flagging it would bury the `Resource: "*"` that matters. It is recorded as
 * `arn-pattern` so a caller can see the difference.
 */
export function classifyStatement(statement: PolicyStatement): {
  kind: WildcardKind
  actionScope: ActionScope
  resourceScope: ResourceScope
} | null {
  if (statement.effect !== "Allow") return null

  const actionScope = actionScopeOf(statement.actions)
  const resourceScope = resourceScopeOf(statement.resources)
  const negated = statement.notActions.length > 0 || statement.notResources.length > 0

  if (actionScope === "all-actions" && resourceScope === "all-resources") {
    return { kind: "ADMIN", actionScope, resourceScope }
  }
  if (actionScope === "all-actions") return { kind: "ALL_ACTIONS", actionScope, resourceScope }
  if (resourceScope === "all-resources") {
    return { kind: "ALL_RESOURCES", actionScope, resourceScope }
  }
  if (negated) return { kind: "NEGATED", actionScope, resourceScope }
  if (actionScope === "all-service-actions") {
    return { kind: "SERVICE_WIDE", actionScope, resourceScope }
  }
  if (actionScope === "prefix-wildcard") return { kind: "PREFIX", actionScope, resourceScope }
  return null
}

const WILDCARD_SENTENCE: Readonly<Record<WildcardKind, string>> = {
  ADMIN: "every action on every resource — this is administrator access under another name",
  ALL_ACTIONS: "every action in the account, scoped only by resource",
  ALL_RESOURCES: "named actions on every resource in the account",
  SERVICE_WIDE: "every action in a service, including ones AWS has not shipped yet",
  PREFIX: "an action prefix, which widens on its own whenever AWS adds an API to it",
  NEGATED: "everything EXCEPT a list — a NotAction or NotResource under an Allow",
  ANY_PRINCIPAL: "a trust policy any principal can assume",
}

/* --------------------------------------------------------- what manages -- */

/**
 * What created a principal, and therefore what can safely change it.
 *
 * `aws-service-linked` is its own answer rather than "unmanaged": a
 * `/aws-service-role/` role is AWS's, an operator cannot manage it with
 * Terraform, and listing it as a console-created finding would fill the panel
 * with rows nobody can act on and hide the ones they can.
 */
export type IamManagementKind =
  | "terraform"
  | "cloudformation"
  | "console"
  | "sdk"
  | "aws-service-linked"
  | "unmanaged"

export interface IamManagement {
  kind: IamManagementKind
  /** True for the two answers STUDIO-000-009 asks to be surfaced. */
  isConsoleOrUnmanaged: boolean
  detail: string
}

const SERVICE_LINKED_PATH = "/aws-service-role/"

export function managementOf(
  path: string,
  tags: Readonly<Record<string, string>>,
): IamManagement {
  if (path.startsWith(SERVICE_LINKED_PATH)) {
    return {
      kind: "aws-service-linked",
      isConsoleOrUnmanaged: false,
      detail: `service-linked (${path}) — created and owned by an AWS service, not by this estate`,
    }
  }
  const declared = tags["tenure:managed-by"]
  if (declared && (MANAGED_BY as readonly string[]).includes(declared)) {
    const kind = declared as "terraform" | "cloudformation" | "console" | "sdk"
    return {
      kind,
      isConsoleOrUnmanaged: kind === "console",
      detail:
        kind === "console"
          ? "tenure:managed-by = console — created by hand; nothing will reproduce or correct it"
          : `tenure:managed-by = ${kind}`,
    }
  }
  return {
    kind: "unmanaged",
    isConsoleOrUnmanaged: true,
    detail:
      "no tenure:managed-by tag — nothing in this repository declares it, so nothing can " +
      "safely change it and nothing will notice if it disappears",
  }
}

/* ------------------------------------------------------------ the shapes -- */

/** Where a principal's tenant attribution came from. */
export type AttributionSource = "resource-groups-tagging" | "iam-resource-tags" | "none"

export interface IamAccessKey {
  userName: string
  /**
   * The key ID, not the secret.
   *
   * `iam:ListAccessKeys` cannot return a secret access key and this module never
   * asks for one. The ID is what `aws iam update-access-key --access-key-id …`
   * takes, so masking it would make the finding unactionable.
   */
  accessKeyId: string
  status: string
  createdAt: string | null
  ageDays: number | null
  /** Active and older than `LONG_LIVED_KEY_DAYS`. An inactive key is not in use. */
  longLived: boolean
  detail: string
}

export interface AttachedPolicyRef {
  name: string
  arn: string | null
}

/**
 * An attached policy whose document this read does NOT contain.
 *
 * Not a footnote. `client.ts` asks for `["User", "Role", "LocalManagedPolicy"]`,
 * so AWS-managed policy documents are absent by construction — and
 * `AdministratorAccess` is an AWS-managed policy. A sweep that skipped it and
 * reported zero wildcards would be a guard that cannot fail.
 */
export interface UnsweptPolicy {
  principalArn: string
  principalName: string
  policyName: string
  policyArn: string | null
  why: string
}

export interface IamPrincipal {
  kind: "role" | "user"
  name: string
  arn: string
  path: string
  createdAt: string | null
  tags: Readonly<Record<string, string>>
  attribution: Attribution
  attributionSource: AttributionSource
  attributionDetail: string
  management: IamManagement
  /** Every way this principal's tags fail the twelve-key contract. */
  tagProblems: readonly TagProblem[]
  attachedPolicies: readonly AttachedPolicyRef[]
  inlinePolicyNames: readonly string[]
  hasPermissionsBoundary: boolean
  wildcards: readonly IamWildcard[]
  /** Roles only. Null means AWS reports no use in its tracking period. */
  lastUsedAt: string | null
  /** Users only; null for roles, which cannot hold access keys. */
  accessKeys: AwsRead<readonly IamAccessKey[]> | null
}

/**
 * How much of the access-key question was actually answerable.
 *
 * `iam:ListAccessKeys` is per-user, so a partial denial is possible and is the
 * dangerous case: nineteen users answered, one refused, and a page that prints
 * "no long-lived keys" is wrong about the twentieth. `complete` gates that
 * sentence, and `longLivedKeys` is documented as a floor whenever it is false.
 */
export interface KeyCoverage {
  usersAsked: number
  usersAnswered: number
  usersDenied: number
  usersThrottled: number
  usersErrored: number
  complete: boolean
  detail: string
}

/**
 * How much of the wildcard question was actually answerable.
 *
 * Same shape of honesty, one level down: a document that did not parse and a
 * policy whose document was never returned both mean the sweep did not cover
 * that policy, and neither may be reported as "no wildcards found".
 */
export interface SweepCoverage {
  policiesSwept: number
  policiesUnreadable: number
  policiesUnswept: number
  complete: boolean
  detail: string
}

export interface IamPosture {
  roles: readonly IamPrincipal[]
  users: readonly IamPrincipal[]
  /** Every wildcard finding across every principal, worst kind first. */
  wildcards: readonly IamWildcard[]
  /** Active keys past `LONG_LIVED_KEY_DAYS`. A FLOOR when `keyCoverage.complete` is false. */
  longLivedKeys: readonly IamAccessKey[]
  /** Every access key seen, long-lived or not — a new key is still a key. */
  accessKeys: readonly IamAccessKey[]
  /** Console-created or managed by nothing. STUDIO-000-009's first clause. */
  unmanaged: readonly IamPrincipal[]
  unswept: readonly UnsweptPolicy[]
  unreadableDocuments: readonly UnsweptPolicy[]
  keyCoverage: KeyCoverage
  sweepCoverage: SweepCoverage
}

/**
 * The account and partition these findings belong to, from the resolved identity.
 *
 * Every field is nullable and every null means "identity did not answer". There
 * is no default: `arnPrefix` is built from the partition and account STS
 * returned, so a GovCloud estate cannot be rendered under `arn:aws:`.
 */
export interface IamScope {
  accountId: string | null
  partition: string | null
  region: string | null
  arnPrefix: string | null
  /** IAM is one endpoint per partition: these findings are account-wide. */
  global: true
  detail: string
}

export interface IamPostureSurface {
  identity: AwsRead<Identity>
  scope: IamScope
  /** The union. DENIED / THROTTLED / EMPTY are not interchangeable and do not carry a value. */
  read: AwsRead<IamPosture>
  /** Present only when the read produced one. Null on every UNKNOWN state AND on EMPTY. */
  posture: IamPosture | null
  /** The tag index this attributed against, carried so a caller can see it was read. */
  tagIndexRead: AwsRead<readonly TaggedResource[]>
  headline: string
  /** The explicit "as of" this reading was taken. */
  asOf: string
  /** This capability's own refresh cadence, not a global one. */
  refreshMs: number
}

/* ------------------------------------------------------------ the reader -- */

export async function iamPosture(
  /** Omitted in production: the page calls this with no argument. */
  supplied?: AwsGateway,
  options: { now?: () => Date; sleep?: (ms: number) => Promise<void> } = {},
): Promise<IamPostureSurface> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const scope = scopeFrom(identity)

  const tagIndexRead = await taggedResources(supplied, { now, denial })
  const index =
    tagIndexRead.state === "ACTUAL" || tagIndexRead.state === "STALE"
      ? tagIndex(tagIndexRead.value)
      : null

  const read = await readAws<IamPosture>(
    "iam:GetAccountAuthorizationDetails",
    () => collect(gw, now, denial, index, options.sleep),
    {
      now,
      denial,
      ...RETRY_SCHEDULE,
      sleep: options.sleep,
      // An account genuinely has principals, so EMPTY here is a real and
      // separate claim: the call succeeded and returned no role and no user.
      // The default object test would never fire — `IamPosture` always has keys
      // — and would quietly turn "the account is empty" into ACTUAL.
      isEmpty: (value) => {
        const posture = value as IamPosture
        return posture.roles.length === 0 && posture.users.length === 0
      },
    },
  )

  const posture = read.state === "ACTUAL" || read.state === "STALE" ? read.value : null
  const asOf = now().toISOString()

  return {
    identity,
    scope,
    read,
    posture,
    tagIndexRead,
    headline: headlineFor(read, posture, scope, asOf),
    asOf,
    refreshMs: IAM_POSTURE_TTL_MS,
  }
}

/**
 * The account/partition band, derived from STS and from nothing else.
 *
 * `resolveIdentity` takes the partition off the ARN's second segment, so this is
 * the estate's real partition rather than the SDK's default. Every field is null
 * when identity did not answer, and `detail` says which of the two it is —
 * "cannot see itself" and "cannot see IAM" are different problems.
 */
export function scopeFrom(identity: AwsRead<Identity>): IamScope {
  if (identity.state === "ACTUAL" || identity.state === "STALE") {
    const { accountId, partition, region } = identity.value
    return {
      accountId,
      partition,
      region,
      arnPrefix: `arn:${partition}:iam::${accountId}:`,
      global: true,
      detail:
        `account ${accountId}, partition ${partition} — IAM is partition-global, so these ` +
        `findings are account-wide and not scoped to ${region}`,
    }
  }
  return {
    accountId: null,
    partition: null,
    region: null,
    arnPrefix: null,
    global: true,
    detail:
      "unknown account and partition — sts:GetCallerIdentity did not answer, so no ARN " +
      "prefix is claimed for these findings",
  }
}

/* ------------------------------------------------------------- collection -- */

async function collect(
  gw: AwsGateway,
  now: () => Date,
  denial: DenialContext,
  index: Map<string, Readonly<Record<string, string>>> | null,
  sleep?: (ms: number) => Promise<void>,
): Promise<IamPosture> {
  const roleDetails: RoleDetailShape[] = []
  const userDetails: UserDetailShape[] = []
  /** Local managed policy documents, by ARN — the join for an attached policy. */
  const managed = new Map<string, PolicyDetailShape>()

  let marker: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = (await gw.call("iam:GetAccountAuthorizationDetails", {
      Marker: marker,
    })) as AuthorizationDetailsResponse

    for (const role of response?.RoleDetailList ?? []) roleDetails.push(role)
    for (const user of response?.UserDetailList ?? []) userDetails.push(user)
    for (const policy of response?.Policies ?? []) {
      if (policy.Arn) managed.set(policy.Arn, policy)
    }

    marker = response?.IsTruncated ? response.Marker || undefined : undefined
    if (!marker) break
  }

  const wildcards: IamWildcard[] = []
  const unswept: UnsweptPolicy[] = []
  const unreadable: UnsweptPolicy[] = []
  let swept = 0

  const roles: IamPrincipal[] = []
  for (const detail of roleDetails) {
    const arn = detail.Arn ?? ""
    const name = detail.RoleName ?? ""
    if (!arn || !name) continue
    const tags = tagsOf(detail.Tags)
    const attributed = attributeFrom(index, arn, tags)

    const found = sweepPrincipal({
      principalArn: arn,
      principalName: name,
      attached: detail.AttachedManagedPolicies ?? [],
      inline: detail.RolePolicyList ?? [],
      trustDocument: detail.AssumeRolePolicyDocument,
      managed,
      unswept,
      unreadable,
    })
    swept += found.swept
    for (const w of found.wildcards) wildcards.push(w)

    roles.push({
      kind: "role",
      name,
      arn,
      path: detail.Path ?? "/",
      createdAt: isoOf(detail.CreateDate),
      tags,
      attribution: attributed.attribution,
      attributionSource: attributed.source,
      attributionDetail: attributed.detail,
      management: managementOf(detail.Path ?? "/", tags),
      tagProblems: tagProblems(tags),
      attachedPolicies: (detail.AttachedManagedPolicies ?? []).map((p) => ({
        name: p.PolicyName ?? "(unnamed)",
        arn: p.PolicyArn ?? null,
      })),
      inlinePolicyNames: (detail.RolePolicyList ?? []).map((p) => p.PolicyName ?? "(unnamed)"),
      hasPermissionsBoundary: Boolean(detail.PermissionsBoundary?.PermissionsBoundaryArn),
      wildcards: found.wildcards,
      lastUsedAt: isoOf(detail.RoleLastUsed?.LastUsedDate),
      accessKeys: null,
    })
  }

  const allKeys: IamAccessKey[] = []
  const coverage = {
    usersAsked: 0,
    usersAnswered: 0,
    usersDenied: 0,
    usersThrottled: 0,
    usersErrored: 0,
  }

  const users: IamPrincipal[] = []
  for (const detail of userDetails) {
    const arn = detail.Arn ?? ""
    const name = detail.UserName ?? ""
    if (!arn || !name) continue
    const tags = tagsOf(detail.Tags)
    const attributed = attributeFrom(index, arn, tags)

    const found = sweepPrincipal({
      principalArn: arn,
      principalName: name,
      attached: detail.AttachedManagedPolicies ?? [],
      inline: detail.UserPolicyList ?? [],
      trustDocument: undefined,
      managed,
      unswept,
      unreadable,
    })
    swept += found.swept
    for (const w of found.wildcards) wildcards.push(w)

    coverage.usersAsked += 1
    const keys = await accessKeysFor(gw, name, now, denial, sleep)
    switch (keys.state) {
      case "ACTUAL":
      case "STALE":
        coverage.usersAnswered += 1
        for (const key of keys.value) allKeys.push(key)
        break
      case "EMPTY":
        coverage.usersAnswered += 1
        break
      case "DENIED":
        coverage.usersDenied += 1
        break
      case "THROTTLED":
        coverage.usersThrottled += 1
        break
      default:
        coverage.usersErrored += 1
        break
    }

    users.push({
      kind: "user",
      name,
      arn,
      path: detail.Path ?? "/",
      createdAt: isoOf(detail.CreateDate),
      tags,
      attribution: attributed.attribution,
      attributionSource: attributed.source,
      attributionDetail: attributed.detail,
      management: managementOf(detail.Path ?? "/", tags),
      tagProblems: tagProblems(tags),
      attachedPolicies: (detail.AttachedManagedPolicies ?? []).map((p) => ({
        name: p.PolicyName ?? "(unnamed)",
        arn: p.PolicyArn ?? null,
      })),
      inlinePolicyNames: (detail.UserPolicyList ?? []).map((p) => p.PolicyName ?? "(unnamed)"),
      hasPermissionsBoundary: Boolean(detail.PermissionsBoundary?.PermissionsBoundaryArn),
      wildcards: found.wildcards,
      lastUsedAt: null,
      accessKeys: keys,
    })
  }

  roles.sort(byArn)
  users.sort(byArn)
  allKeys.sort((a, b) => compare(`${a.userName}::${a.accessKeyId}`, `${b.userName}::${b.accessKeyId}`))
  wildcards.sort(byWildcard)
  unswept.sort(byUnswept)
  unreadable.sort(byUnswept)

  const keyCoverage = keyCoverageOf(coverage)
  const sweepCoverage: SweepCoverage = {
    policiesSwept: swept,
    policiesUnreadable: unreadable.length,
    policiesUnswept: unswept.length,
    complete: unreadable.length === 0 && unswept.length === 0,
    detail:
      unreadable.length === 0 && unswept.length === 0
        ? `${swept} policy document(s) swept for wildcards; every attached and inline policy was read`
        : `${swept} policy document(s) swept, but ${unswept.length} attached policy document(s) were ` +
          `not returned by this call and ${unreadable.length} did not parse — a policy that was not ` +
          `read is not a policy without wildcards`,
  }

  return {
    roles,
    users,
    wildcards,
    longLivedKeys: allKeys.filter((k) => k.longLived),
    accessKeys: allKeys,
    unmanaged: [...roles, ...users].filter((p) => p.management.isConsoleOrUnmanaged).sort(byArn),
    unswept,
    unreadableDocuments: unreadable,
    keyCoverage,
    sweepCoverage,
  }
}

function keyCoverageOf(counts: {
  usersAsked: number
  usersAnswered: number
  usersDenied: number
  usersThrottled: number
  usersErrored: number
}): KeyCoverage {
  const complete = counts.usersAsked === counts.usersAnswered
  const unanswered = counts.usersDenied + counts.usersThrottled + counts.usersErrored
  return {
    ...counts,
    complete,
    detail: complete
      ? counts.usersAsked === 0
        ? "no IAM users exist, so there are no access keys to read"
        : `access keys read for all ${counts.usersAsked} user(s)`
      : `access keys could NOT be read for ${unanswered} of ${counts.usersAsked} user(s) ` +
        `(${counts.usersDenied} refused, ${counts.usersThrottled} throttled, ${counts.usersErrored} errored). ` +
        `The long-lived key list is a floor, not a total.`,
  }
}

/**
 * One user's access keys, as its own reading.
 *
 * A separate `AwsRead` rather than a throw, because `iam:ListAccessKeys` is a
 * separate grant scoped to `arn:*:iam::*:user/*` and can be refused on its own.
 * Letting it throw would turn a partial denial into a DENIED for the whole
 * posture and lose the roles that WERE read; swallowing it would turn a refusal
 * into "this user has no keys", which is the lie this directory exists to stop.
 */
async function accessKeysFor(
  gw: AwsGateway,
  userName: string,
  now: () => Date,
  denial: DenialContext,
  sleep?: (ms: number) => Promise<void>,
): Promise<AwsRead<readonly IamAccessKey[]>> {
  return readAws<readonly IamAccessKey[]>(
    "iam:ListAccessKeys",
    async () => {
      const out: IamAccessKey[] = []
      let marker: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = (await gw.call("iam:ListAccessKeys", {
          UserName: userName,
          Marker: marker,
        })) as ListAccessKeysResponse

        for (const meta of response?.AccessKeyMetadata ?? []) {
          if (!meta.AccessKeyId) continue
          const createdAt = isoOf(meta.CreateDate)
          const ageDays =
            createdAt === null
              ? null
              : Math.max(0, Math.floor((now().getTime() - Date.parse(createdAt)) / 86_400_000))
          const status = meta.Status ?? "Unknown"
          const longLived =
            status === "Active" && ageDays !== null && ageDays >= LONG_LIVED_KEY_DAYS
          out.push({
            userName: meta.UserName ?? userName,
            accessKeyId: meta.AccessKeyId,
            status,
            createdAt,
            ageDays,
            longLived,
            detail: keySentence(status, ageDays, longLived),
          })
        }

        marker = response?.IsTruncated ? response.Marker || undefined : undefined
        if (!marker) break
      }
      return out
    },
    { now, denial, ...RETRY_SCHEDULE, sleep },
  )
}

function keySentence(status: string, ageDays: number | null, longLived: boolean): string {
  if (ageDays === null) {
    return `${status} key with no creation date in the response — its age cannot be judged`
  }
  if (longLived) {
    return `${status} for ${ageDays} day(s) — past the ${LONG_LIVED_KEY_DAYS}-day rotation horizon`
  }
  if (status !== "Active") {
    return `${status} for ${ageDays} day(s) — not usable, but still attached to the user`
  }
  return `${status} for ${ageDays} day(s) — within the ${LONG_LIVED_KEY_DAYS}-day rotation horizon`
}

/* ---------------------------------------------------------- the sweep ----- */

function sweepPrincipal(input: {
  principalArn: string
  principalName: string
  attached: readonly AttachedPolicyShape[]
  inline: readonly InlinePolicyShape[]
  trustDocument: string | undefined
  managed: Map<string, PolicyDetailShape>
  unswept: UnsweptPolicy[]
  unreadable: UnsweptPolicy[]
}): { wildcards: readonly IamWildcard[]; swept: number } {
  const wildcards: IamWildcard[] = []
  let swept = 0

  for (const attached of input.attached) {
    const policyName = attached.PolicyName ?? "(unnamed)"
    const policyArn = attached.PolicyArn ?? null
    const detail = policyArn ? input.managed.get(policyArn) : undefined
    const document = detail ? defaultVersionDocument(detail) : undefined

    if (document === undefined) {
      input.unswept.push({
        principalArn: input.principalArn,
        principalName: input.principalName,
        policyName,
        policyArn,
        why: policyArn && isAwsManaged(policyArn)
          ? "AWS-managed policy — this call returns User, Role and LocalManagedPolicy only, " +
            "so its document was never fetched and its wildcards are unknown"
          : "the policy is attached but its document was not in the response — its wildcards are unknown",
      })
      continue
    }

    const read = decodePolicyDocument(document)
    if (read.state === "UNREADABLE") {
      input.unreadable.push({
        principalArn: input.principalArn,
        principalName: input.principalName,
        policyName,
        policyArn,
        why: read.why,
      })
      continue
    }
    swept += 1
    collectWildcards(read.statements, {
      principalArn: input.principalArn,
      principalName: input.principalName,
      policyName,
      policyArn,
      source: "attached-managed",
      into: wildcards,
    })
  }

  for (const inline of input.inline) {
    const policyName = inline.PolicyName ?? "(unnamed)"
    const read = decodePolicyDocument(inline.PolicyDocument)
    if (read.state === "UNREADABLE") {
      input.unreadable.push({
        principalArn: input.principalArn,
        principalName: input.principalName,
        policyName,
        policyArn: null,
        why: read.why,
      })
      continue
    }
    swept += 1
    collectWildcards(read.statements, {
      principalArn: input.principalArn,
      principalName: input.principalName,
      policyName,
      policyArn: null,
      source: "inline",
      into: wildcards,
    })
  }

  if (input.trustDocument !== undefined) {
    const read = decodePolicyDocument(input.trustDocument)
    if (read.state === "UNREADABLE") {
      input.unreadable.push({
        principalArn: input.principalArn,
        principalName: input.principalName,
        policyName: "(trust policy)",
        policyArn: null,
        why: read.why,
      })
    } else {
      swept += 1
      read.statements.forEach((statement, i) => {
        if (statement.effect !== "Allow") return
        if (!trustsAnyPrincipal(statement)) return
        wildcards.push({
          principalArn: input.principalArn,
          principalName: input.principalName,
          policyName: "(trust policy)",
          policyArn: null,
          source: "trust-policy",
          statementIndex: i,
          statementSid: statement.sid,
          kind: "ANY_PRINCIPAL",
          actionScope: actionScopeOf(statement.actions),
          resourceScope: "exact",
          actions: statement.actions,
          resources: [],
          conditioned: statement.hasCondition,
          detail:
            `${input.principalName}: trust policy statement ${i} — ${WILDCARD_SENTENCE.ANY_PRINCIPAL}` +
            (statement.hasCondition
              ? ", narrowed by a Condition — read the condition before treating it as safe"
              : ", with NO Condition"),
        })
      })
    }
  }

  return { wildcards, swept }
}

/**
 * A trust policy statement any principal can assume.
 *
 * `decodePolicyDocument` flattens `Principal` into `statement.principals`, so
 * the four shapes AWS accepts collapse to one question here. A role whose trust
 * policy names `"*"` can be assumed from outside this account entirely, which is
 * a different and worse fact than a wide permission policy.
 */
export function trustsAnyPrincipal(statement: PolicyStatement): boolean {
  return statement.principals.includes("*")
}

function collectWildcards(
  statements: readonly PolicyStatement[],
  context: {
    principalArn: string
    principalName: string
    policyName: string
    policyArn: string | null
    source: "attached-managed" | "inline"
    into: IamWildcard[]
  },
): void {
  statements.forEach((statement, i) => {
    const verdict = classifyStatement(statement)
    if (!verdict) return
    context.into.push({
      principalArn: context.principalArn,
      principalName: context.principalName,
      policyName: context.policyName,
      policyArn: context.policyArn,
      source: context.source,
      statementIndex: i,
      statementSid: statement.sid,
      kind: verdict.kind,
      actionScope: verdict.actionScope,
      resourceScope: verdict.resourceScope,
      actions: statement.notActions.length > 0 ? statement.notActions : statement.actions,
      resources: statement.notResources.length > 0 ? statement.notResources : statement.resources,
      conditioned: statement.hasCondition,
      detail:
        `${context.principalName} · ${context.policyName} statement ${i}: ` +
        `${WILDCARD_SENTENCE[verdict.kind]}` +
        (statement.hasCondition
          ? " — narrowed by a Condition, which limits it without removing it"
          : ""),
    })
  })
}

/* -------------------------------------------------------- attribution ----- */

function attributeFrom(
  index: Map<string, Readonly<Record<string, string>>> | null,
  arn: string,
  ownTags: Readonly<Record<string, string>>,
): { attribution: Attribution; source: AttributionSource; detail: string } {
  const indexed = index?.get(arn)
  if (indexed && Object.keys(indexed).length > 0) {
    return {
      attribution: attributionOf(indexed),
      source: "resource-groups-tagging",
      detail: "attributed from the Resource Groups Tagging API index",
    }
  }
  if (Object.keys(ownTags).length > 0) {
    return {
      attribution: attributionOf(ownTags),
      source: "iam-resource-tags",
      detail:
        index === null
          ? "attributed from the tags IAM returned on the principal — the tag index itself was not readable"
          : "attributed from the tags IAM returned on the principal — the tag index did not carry this ARN",
    }
  }
  return {
    attribution: attributionOf({}),
    source: "none",
    detail:
      index === null
        ? "no tags on the principal AND the tag index was not readable — this is UNKNOWN attribution, " +
          "not a decision that it belongs to nobody"
        : "no tenure:tenant tag, on the principal or in the tag index — unattributable, which is the finding",
  }
}

/* ------------------------------------------------------------ rendering -- */

/**
 * The one sentence every surface prints for this reading.
 *
 * Each state produces demonstrably different text: DENIED names the action, the
 * error code and the pasteable statement and says no table is shown; EMPTY says
 * the call succeeded and returned nothing; THROTTLED names the wait; ACTUAL
 * counts what was found AND appends every coverage caveat. A test asserts all
 * four are distinct strings, because "says something different" is the property,
 * not "returns a different enum".
 */
export function headlineFor(
  read: AwsRead<IamPosture>,
  posture: IamPosture | null,
  scope: IamScope,
  asOf: string,
): string {
  const where = scope.accountId
    ? `account ${scope.accountId} (partition ${scope.partition})`
    : "an account this engine could not identify"

  switch (read.state) {
    case "DENIED":
      return (
        `unknown — this engine's role was refused ${read.action} (${read.errorCode}) as ${read.principal}. ` +
        `No role, policy or access-key finding is shown for ${where}, because none was read: ` +
        `this is NOT an estate without wildcard policies or long-lived keys. ` +
        `Minimum statement: ${read.minimumStatement}`
      )
    case "THROTTLED":
      return (
        `throttled — AWS rate-limited ${read.capability} for ${where} after ${READ_ATTEMPTS} attempt(s); ` +
        `retrying in ${read.retryAfterMs}ms, as of ${read.asOf}. Nothing is claimed about IAM posture yet.`
      )
    case "UNCONFIGURED":
      return `not configured — ${read.why}`
    case "ERROR":
      return `error — ${read.capability} failed for ${where} (${read.code}): ${read.safeDetail}`
    case "EMPTY":
      return (
        `none — ${read.capability} succeeded for ${where} and returned no role and no user, as of ${read.asOf}. ` +
        `That is a read result, not a refusal.`
      )
    case "STALE":
    case "ACTUAL": {
      if (!posture) return `error — a read reported ${read.state} without a value`
      const parts = [
        `${posture.roles.length} role(s) and ${posture.users.length} user(s) in ${where}`,
        `${posture.unmanaged.length} console-created or unmanaged`,
        `${posture.wildcards.length} wildcard grant(s)`,
        `${posture.longLivedKeys.length} access key(s) past ${LONG_LIVED_KEY_DAYS} days`,
      ]
      const caveats: string[] = []
      if (!posture.sweepCoverage.complete) caveats.push(posture.sweepCoverage.detail)
      if (!posture.keyCoverage.complete) caveats.push(posture.keyCoverage.detail)
      return (
        `${parts.join(" · ")} — as of ${asOf}` +
        (caveats.length > 0 ? `. Incomplete: ${caveats.join(" ")}` : "")
      )
    }
  }
}

/* ------------------------------------------------------------- plumbing -- */

function tagsOf(tags: readonly TagShape[] | undefined): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const tag of tags ?? []) {
    if (tag.Key) out[tag.Key] = tag.Value ?? ""
  }
  return out
}

/**
 * The default version's document.
 *
 * `DefaultVersionId` decides which version is in force; taking the first version
 * in the list — or the newest — reports a policy that may not be the one AWS is
 * evaluating. `IsDefaultVersion` is the fallback when the id is absent.
 */
function defaultVersionDocument(detail: PolicyDetailShape): string | undefined {
  const versions = detail.PolicyVersionList ?? []
  const byId = detail.DefaultVersionId
    ? versions.find((v) => v.VersionId === detail.DefaultVersionId)
    : undefined
  const chosen = byId ?? versions.find((v) => v.IsDefaultVersion)
  return chosen?.Document
}

/** `arn:PARTITION:iam::aws:policy/...` — the account segment is literally `aws`. */
function isAwsManaged(policyArn: string): boolean {
  return policyArn.split(":")[4] === "aws"
}

function isoOf(value: Date | string | undefined): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === "string" && value) {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : new Date(ms).toISOString()
  }
  return null
}

/**
 * Ordering, by code unit rather than by locale.
 *
 * `localeCompare` sorts differently under different ICU data, which makes a
 * generated ordering "current here, stale in CI". Every comparison in this
 * module is a plain code-unit comparison so the same input produces the same
 * order on Linux and on Windows.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function byArn(a: { arn: string }, b: { arn: string }): number {
  return compare(a.arn, b.arn)
}

/** Worst kind first, then a stable tiebreak so two runs order identically. */
const WILDCARD_ORDER: readonly WildcardKind[] = [
  "ADMIN",
  "ALL_ACTIONS",
  "ALL_RESOURCES",
  "ANY_PRINCIPAL",
  "NEGATED",
  "SERVICE_WIDE",
  "PREFIX",
]

function byWildcard(a: IamWildcard, b: IamWildcard): number {
  const rank = WILDCARD_ORDER.indexOf(a.kind) - WILDCARD_ORDER.indexOf(b.kind)
  if (rank !== 0) return rank
  return compare(
    `${a.principalArn}::${a.policyName}::${a.statementIndex}`,
    `${b.principalArn}::${b.policyName}::${b.statementIndex}`,
  )
}

function byUnswept(a: UnsweptPolicy, b: UnsweptPolicy): number {
  return compare(`${a.principalArn}::${a.policyName}`, `${b.principalArn}::${b.policyName}`)
}

export { IAM_POSTURE_TTL_MS }
