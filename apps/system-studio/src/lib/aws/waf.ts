/**
 * STUDIO-070-004 (WAFv2) — is anything actually in front of the front door.
 *
 * `infrastructure/terraform/` provisions the application load balancer and the
 * CloudFront distribution that take every request the pilot serves, and nothing
 * in the running product has ever issued a WAFv2 call. So the console could not
 * distinguish three states that have nothing in common:
 *
 *   - a web ACL exists and is associated with the load balancer;
 *   - no web ACL exists anywhere in this account, and the ALB is taking requests
 *     directly off the internet;
 *   - this engine's role may not call `wafv2:ListWebACLs`, so it has no idea.
 *
 * All three rendered as the same thing — nothing at all — which is the exact
 * shape of defect `read.ts` exists to make impossible.
 *
 * ## The expected answer today is "there is no web ACL", and that is a finding
 *
 * `ListWebACLs` against an account with no WAF succeeds and returns an empty
 * list. That is a real observation and it is the ANSWER to the question an
 * operator is asking, so it does not render as an empty table: `WafCoverage`
 * lifts it into `no-web-acl-exists`, which carries how many internet-facing
 * targets are therefore unprotected and the Terraform resources that would
 * change it. A page that showed an empty grid here would read as "nothing is
 * wrong" while describing an estate with no web application firewall on it.
 *
 * And the successful-empty is kept apart from `AccessDenied` by construction:
 * the empty answer is `EMPTY`, the refusal is `DENIED`, they are different arms
 * of `AwsRead<T>` and the denied arm has no `value` field to read an empty list
 * out of.
 *
 * ## Two scopes, resolved from two places, handled explicitly
 *
 * WAFv2 is really two catalogues. `Scope: REGIONAL` covers load balancers, API
 * Gateway stages and AppSync APIs, and is served from the estate's own region.
 * `Scope: CLOUDFRONT` covers distributions and is served ONLY from the
 * partition's global endpoint. Asking the regional client for the CLOUDFRONT
 * scope does not return the edge ACLs — it returns an empty list, which is the
 * single worst possible failure here, because it reads as "the CDN has no WAF".
 *
 * `client.ts` already keeps two clients for exactly this, and refuses to invent
 * the global endpoint's region: with `AWS_GLOBAL_ENDPOINT_REGION` unset it
 * raises `EndpointRegionUnset`, which `readAws` turns into UNCONFIGURED. So this
 * module reads BOTH scopes, reports each one's state separately, and — this is
 * the part that matters — will not say "no web ACL exists" unless BOTH scopes
 * answered. One scope unread means the answer is `unknown` for that scope, and
 * `WafCoverage` says so out loud.
 *
 * ## Per resource, not per account
 *
 * "This account has a web ACL" is not the question. A web ACL that exists and is
 * associated with nothing protects nothing. So every load balancer and every
 * distribution carries its OWN reading:
 *
 *   - load balancers, via `wafv2:GetWebACLForResource` — one call per resource,
 *     each an independent `AwsRead`, so a denial on one ALB does not collapse
 *     the row for another and does not render as "unprotected";
 *   - distributions, via the `WebACLId` on the distribution summary that
 *     `cloudfront:ListDistributions` already returns. `GetWebACLForResource`
 *     does not accept a distribution ARN — the API's protected-resource types
 *     are load balancers, API Gateway stages, AppSync APIs, Cognito user pools,
 *     App Runner services and Verified Access instances, never a distribution —
 *     so calling it for one would fail and the failure would render as ERROR on
 *     a resource that may well be protected.
 *
 * A network or gateway load balancer cannot carry a web ACL at all. That is
 * UNCONFIGURED with the reason, never `EMPTY`: "WAF cannot be attached to this"
 * and "WAF is not attached to this" are different sentences and only the second
 * is a finding.
 *
 * ## WAF Classic is not WAFv2, and pretending otherwise is a false negative
 *
 * A distribution's `WebACLId` holds a WAFv2 ACL **ARN**, or a WAF **Classic**
 * 36-character id, or the empty string. Classic is a different service with a
 * different API (`waf:*`, not `wafv2:*`) which this engine does not hold a
 * capability for, so a Classic-protected distribution must not be reported as
 * unprotected — it is `waf-classic`, named, with the reason this console cannot
 * describe its rules.
 *
 * ## What this module provably cannot read, said out loud
 *
 * **The default action and rules of a web ACL that is not associated with
 * anything are not readable by this engine.** `wafv2:ListWebACLs` returns only
 * summaries — name, id, description, ARN, lock token. Default action, rules,
 * rule-group references and capacity live on the full `WebACL` object, which
 * comes from `wafv2:GetWebACL`, and that capability is NOT in
 * `capabilities.ts`. This module does not get to add one.
 *
 * `GetWebACLForResource` returns the full `WebACL` for an ACL that IS
 * associated, so rules and default action are read wherever an association
 * gives them. Everywhere else `WebAclDetail` is the `not-readable` arm naming
 * `wafv2:GetWebACL` — a value a surface has to render, not a field it can
 * forget, on the same reasoning as `OldestMessageAge` in `sqs.ts`.
 *
 * ## Count mode is not protection
 *
 * A rule whose action — or whose rule-group override — is `Count` matches and
 * records and then lets the request through. A console that counted rules would
 * report a web ACL in full count mode as protection, which is the reassuring
 * default this programme keeps being burnt by. Every rule carries `blocking`,
 * and a web ACL where nothing blocks is `monitoring-only` in the coverage
 * verdict rather than `protected`.
 *
 * ## Region and partition
 *
 * From the resolved identity — `sts:GetCallerIdentity` for the account and
 * partition, the SDK's own resolved region — and from the ARNs AWS returns. The
 * CLOUDFRONT scope's region is taken from the ARNs of the ACLs it returned,
 * because that is where they demonstrably are; when that scope is empty there is
 * no ARN and the region is null with a reason, rather than a literal. GE-010-007
 * was a data-residency defect caused by exactly the fallback this file does not
 * have.
 *
 * ## Attribution
 *
 * Through `tags.ts` and the Resource Groups Tagging API, which is what every
 * other module in this directory joins on. The same deliberate deviation from
 * "mark it shared where no tag says so" that `sqs.ts` documents applies here:
 * `shared` (somebody decided) and `unattributed` (nobody tagged it) stay apart,
 * and a fourth arm `unknown` exists for when the tag index itself could not be
 * read — "we could not look up this ACL's tags" is not "this ACL has no tenant
 * tag".
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
 * How many `ListWebACLs` pages to walk per scope.
 *
 * `client.ts` asks for 100 per page, so this is two thousand web ACLs before the
 * bound bites. A reader with no bound is how one page render becomes an outage;
 * a reader that silently stopped at the first page is the same lie as an empty
 * list, so hitting the cap is a value — `Truncation` — carried inside the
 * reading rather than a fact left off it.
 */
export const MAX_WEB_ACL_PAGES = 20

/** The same bound for the resource listings this module has to enumerate. */
export const MAX_TARGET_PAGES = 20

/**
 * How many resources get a `GetWebACLForResource` call in one load.
 *
 * One call per load balancer, against an account-wide WAFv2 throttle. The estate
 * has one ALB; the cap exists so an account that has grown a thousand does not
 * turn one page render into a thousand API calls. Resources past the cap are NOT
 * dropped and do NOT read as unprotected: they carry an UNCONFIGURED association
 * whose `why` says the engine stopped looking.
 */
export const MAX_ASSOCIATION_READS = 100

/** How many association reads are in flight at once. Bounded so a load is not a burst. */
const ASSOCIATION_CONCURRENCY = 8

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/* ---------------------------------------------------------------- shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface ListWebAclsResponse {
  NextMarker?: string
  WebACLs?: Array<{
    Name?: string
    Id?: string
    ARN?: string
    Description?: string
    LockToken?: string
  }>
}

/**
 * The full `WebACL` object.
 *
 * Exported because `parseWebAcl` takes it and a caller — or a surface agent
 * writing a fixture — has to be able to name the shape. It is still declared
 * here rather than imported from the SDK: `client.ts` is the one module allowed
 * to hold an AWS package.
 */
export interface WebAclShape {
  Name?: string
  Id?: string
  ARN?: string
  Description?: string
  Capacity?: number
  DefaultAction?: { Allow?: unknown; Block?: unknown }
  Rules?: Array<{
    Name?: string
    Priority?: number
    Action?: Record<string, unknown>
    OverrideAction?: Record<string, unknown>
    Statement?: Record<string, unknown>
  }>
}

interface GetWebAclForResourceResponse {
  WebACL?: WebAclShape
}

interface DescribeLoadBalancersResponse {
  LoadBalancers?: Array<{
    LoadBalancerArn?: string
    LoadBalancerName?: string
    Type?: string
    Scheme?: string
  }>
  NextMarker?: string
}

interface ListDistributionsResponse {
  DistributionList?: {
    NextMarker?: string
    IsTruncated?: boolean
    Items?: Array<{
      Id?: string
      ARN?: string
      DomainName?: string
      Enabled?: boolean
      /**
       * The CloudFront summary's own field. Empty string when nothing is
       * attached, a WAFv2 ACL ARN, or a WAF Classic id.
       */
      WebACLId?: string
    }>
  }
}

/* ----------------------------------------------------------------- types -- */

/** WAFv2's two catalogues. Regional resources, or the edge. */
export type WafScope = "REGIONAL" | "CLOUDFRONT"

/**
 * Whether a paged read reached the end, or stopped because this engine capped it.
 *
 * Carried INSIDE the value rather than beside it, so a caller that renders the
 * list cannot render it without having the truncation in hand. A partial answer
 * that looks whole is the failure the whole read plane is built against.
 */
export type Truncation =
  | { kind: "complete"; pages: number }
  | { kind: "capped"; pages: number; read: number; why: string }

/** Which tenant a WAF resource belongs to. See the module header on the fourth arm. */
export type WafAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/** A web ACL's default action — what happens to a request no rule matched. */
export type DefaultAction =
  | { kind: "allow" }
  | { kind: "block" }
  | { kind: "unreadable"; why: string }

/** What a rule does with a request it matched. */
export type RuleAction =
  | { kind: "allow" }
  | { kind: "block" }
  /** Matched, recorded, and let through. Not protection. */
  | { kind: "count" }
  | { kind: "captcha" }
  | { kind: "challenge" }
  /** A rule group whose own actions stand — the group's rules block if they say so. */
  | { kind: "override-none" }
  /** A rule group forced entirely into count mode. Nothing in it blocks. */
  | { kind: "override-count" }
  | { kind: "unreadable"; why: string }

/** What a rule matches on, to the depth this console reports it. */
export type RuleStatement =
  | {
      kind: "managed-rule-group"
      vendor: string
      name: string
      version: string | null
      excludedRules: readonly string[]
    }
  | { kind: "rule-group-reference"; arn: string; excludedRules: readonly string[] }
  | { kind: "rate-based"; limit: number | null }
  | { kind: "other"; statement: string }

export interface WafRule {
  name: string
  /** Evaluation order. Null when AWS returned none rather than a guessed zero. */
  priority: number | null
  action: RuleAction
  statement: RuleStatement
  /**
   * Whether this rule can actually stop a request.
   *
   * False for count, for a rule group overridden to count, and for an action
   * this engine could not read — an unreadable action is not evidence of
   * blocking, and defaulting it to "blocking" is how a monitoring-only ACL gets
   * reported as protection.
   */
  blocking: boolean
}

/**
 * A web ACL's contents.
 *
 * Two arms, and the `not-readable` one is the common case: see the module header.
 * `wafv2:GetWebACL` is not in the capability registry, so the rules and default
 * action of an ACL that is associated with nothing cannot be read by this engine
 * at all.
 */
export type WebAclDetail =
  | {
      kind: "read"
      /** Which call produced it, so the reading's provenance is never implied. */
      via: "wafv2:GetWebACLForResource"
      defaultAction: DefaultAction
      /** WCUs the ACL consumes. Null when AWS did not return it. */
      capacity: number | null
      rules: readonly WafRule[]
      /** True when at least one rule can stop a request. */
      blocks: boolean
    }
  | { kind: "not-readable"; needs: "wafv2:GetWebACL"; why: string }

/** The same object every time: nothing about it varies per ACL. */
export const WEB_ACL_DETAIL_NOT_READABLE: WebAclDetail = {
  kind: "not-readable",
  needs: "wafv2:GetWebACL",
  why:
    "wafv2:ListWebACLs returns summaries only — name, id, description and ARN. A web ACL's " +
    "default action, rules and rule-group references come from wafv2:GetWebACL, which is not " +
    "in this engine's capability registry, so they are unknown for any web ACL that is not " +
    "associated with a resource this console can read. Unknown, not 'no rules'.",
}

/** One web ACL as `ListWebACLs` reports it, joined to what else could be learnt. */
export interface WebAclSummary {
  name: string
  id: string
  arn: string
  description: string | null
  scope: WafScope
  /** From the ACL's own ARN. Never a literal and never the caller's region assumed. */
  region: string | null
  partition: string | null
  accountId: string | null
  attribution: WafAttribution
  /** Read where an association gave it, `not-readable` otherwise. See the header. */
  detail: WebAclDetail
}

/** One scope's answer: the ACLs, where they were read from, and whether that was all. */
export interface WebAclListing {
  scope: WafScope
  /**
   * The region this scope's ACLs are in, from their ARNs.
   *
   * Null when the scope answered with nothing — there is no ARN to read it off,
   * and the alternative is a guessed region, which is the GE-010-007 defect.
   */
  region: string | null
  acls: readonly WebAclSummary[]
  truncation: Truncation
}

/** Something that takes requests from the internet and could carry a web ACL. */
export type ProtectionTargetKind =
  | "application-load-balancer"
  | "network-load-balancer"
  | "gateway-load-balancer"
  | "load-balancer-of-unstated-type"
  | "distribution"

export interface ProtectionTarget {
  arn: string
  /** A label for a human — a name or a domain. Never an attribution key. */
  name: string
  kind: ProtectionTargetKind
  /** Which WAFv2 catalogue an ACL for this target would live in. */
  scope: WafScope
  /** `internet-facing`, `internal`, or null where the API states none. */
  scheme: string | null
}

/**
 * What is in front of one resource.
 *
 * Note what is NOT an arm: "none". An absent association is the `EMPTY` state of
 * the `AwsRead` that wraps this, so it cannot be confused with a refusal, and a
 * caller cannot reach a `value` on the arms that mean "we did not find out".
 */
export type Association =
  | { kind: "web-acl"; arn: string; name: string | null; detail: WebAclDetail }
  /** A WAF Classic id. A different service this engine holds no capability for. */
  | { kind: "waf-classic"; id: string; why: string }

export interface ResourceProtection {
  target: ProtectionTarget
  /**
   * EMPTY means nothing is attached — a finding. DENIED means this engine was
   * refused and knows nothing. UNCONFIGURED means the call was never made,
   * because WAF cannot attach to this kind of resource or because the cap was
   * reached. Three different sentences, none of which is the others.
   */
  association: AwsRead<Association>
  attribution: WafAttribution
  /** This reading's own cadence, from the capability's declaration. */
  refreshMs: number
  asOf: string
}

/** One unprotected internet-facing resource, for the verdict to name. */
export interface ExposedResource {
  arn: string
  name: string
  kind: ProtectionTargetKind
  scheme: string | null
}

/**
 * The headline: is anything in front of this estate.
 *
 * Every arm is careful about what it claims. `covered` carries the resources it
 * could NOT read, so "covered" never quietly means "covered as far as we
 * bothered to look", and `no-web-acl-exists` is only reachable when BOTH scopes
 * answered successfully.
 */
export type WafCoverage =
  /** At least one scope could not be read. Nothing can be said about coverage. */
  | { kind: "unknown"; why: string }
  /**
   * Both scopes answered and neither holds a web ACL. The expected answer in
   * this estate today, and a finding rather than an empty table.
   */
  | {
      kind: "no-web-acl-exists"
      scopesRead: readonly WafScope[]
      exposed: readonly ExposedResource[]
      unreadable: readonly string[]
      remedy: string
    }
  /** Web ACLs exist, and at least one internet-facing resource has none attached. */
  | {
      kind: "exposed"
      exposed: readonly ExposedResource[]
      protectedCount: number
      unreadable: readonly string[]
      remedy: string
    }
  /**
   * Everything that could carry a web ACL has one, and every one of them is in
   * count mode. Matching and recording, blocking nothing.
   */
  | { kind: "monitoring-only"; resources: readonly string[]; unreadable: readonly string[]; why: string }
  /**
   * Everything that could carry a web ACL has one.
   *
   * `blockingConfirmed` is separate from `protectedCount` because they are
   * different claims: the first is "this engine read the rules and at least one
   * of them stops a request", the second is only "something is attached". A
   * distribution's association names its web ACL and carries no rules — see the
   * header on `wafv2:GetWebACL` — so `detailUnread` names every resource whose
   * ACL could not be described, and the rendered sentence says so rather than
   * implying the rules were checked.
   */
  | {
      kind: "protected"
      protectedCount: number
      blockingConfirmed: number
      detailUnread: readonly string[]
      unreadable: readonly string[]
    }
  /** Nothing this console can see takes requests from the internet. */
  | { kind: "no-targets"; why: string }

/** Everything a WAF surface needs, in one load. */
export interface WafReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /** The estate's own region, from `sts` + the SDK. DENIED here is never `[]`. */
  regional: AwsRead<WebAclListing>
  /** The partition's global endpoint. UNCONFIGURED when that region is not set. */
  cloudfront: AwsRead<WebAclListing>
  /** The load balancers and distributions this console could enumerate. */
  loadBalancers: AwsRead<readonly ProtectionTarget[]>
  distributions: AwsRead<readonly ProtectionTarget[]>
  /** One row per target, each degrading independently. */
  protection: readonly ResourceProtection[]
  coverage: WafCoverage
  asOf: string
  /** Each capability's declared cadence, read from the registry, not retyped. */
  refreshMs: { webAcls: number; association: number }
}

/* --------------------------------------------------------------- parsing -- */

/** The ARN's region, or null. `arn:partition:service:region:account:resource`. */
export function arnRegion(arn: string): string | null {
  const parts = arn.split(":")
  return parts.length >= 6 && parts[0] === "arn" ? parts[3] || null : null
}

export function arnPartition(arn: string): string | null {
  const parts = arn.split(":")
  return parts.length >= 6 && parts[0] === "arn" ? parts[1] || null : null
}

export function arnAccount(arn: string): string | null {
  const parts = arn.split(":")
  return parts.length >= 6 && parts[0] === "arn" ? parts[4] || null : null
}

/** Truncated so a malformed response cannot become an unbounded string in a render. */
function shortRaw(raw: string): string {
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
}

/**
 * A WAFv2 action object — `{Allow:{}}`, `{Block:{}}`, `{Count:{}}` — as a value.
 *
 * `unreadable` rather than a default, on purpose. An action this engine did not
 * recognise is not evidence that the rule blocks, and it is not evidence that it
 * does not; both claims are wrong and only the unreadable arm is honest.
 */
export function parseDefaultAction(raw: unknown): DefaultAction {
  const action = raw as Record<string, unknown> | null | undefined
  if (!action || typeof action !== "object") {
    return {
      kind: "unreadable",
      why: "the web ACL answered without a DefaultAction. What happens to an unmatched request is unknown.",
    }
  }
  if ("Block" in action) return { kind: "block" }
  if ("Allow" in action) return { kind: "allow" }
  return {
    kind: "unreadable",
    why: `DefaultAction carries neither Allow nor Block, but ${shortRaw(Object.keys(action).join(", ")) || "nothing"}`,
  }
}

/** A rule's action, or a rule group's override. Count is called count. */
export function parseRuleAction(
  action: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): RuleAction {
  if (override && typeof override === "object") {
    // WAFv2 sends `{None:{}}` for "the group's own actions stand" and `{Count:{}}`
    // for "force everything in this group to count", which blocks nothing.
    if ("Count" in override) return { kind: "override-count" }
    if ("None" in override) return { kind: "override-none" }
  }
  if (action && typeof action === "object") {
    if ("Block" in action) return { kind: "block" }
    if ("Allow" in action) return { kind: "allow" }
    if ("Count" in action) return { kind: "count" }
    if ("Captcha" in action) return { kind: "captcha" }
    if ("Challenge" in action) return { kind: "challenge" }
    return {
      kind: "unreadable",
      why: `rule action carries none of Block, Allow, Count, Captcha or Challenge, but ${
        shortRaw(Object.keys(action).join(", ")) || "nothing"
      }`,
    }
  }
  return {
    kind: "unreadable",
    why:
      "the rule answered with neither an Action nor an OverrideAction. Whether it can stop a " +
      "request is unknown, which is not the same as its being able to.",
  }
}

/** Whether an action can actually stop a request. Unreadable is not blocking. */
export function actionBlocks(action: RuleAction): boolean {
  switch (action.kind) {
    case "block":
    case "captcha":
    case "challenge":
    // A rule group whose own actions stand: its managed rules block by default,
    // which is the whole reason `override-count` is a separate arm.
    case "override-none":
      return true
    case "allow":
    case "count":
    case "override-count":
    case "unreadable":
      return false
  }
}

function stringList(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (entry as Record<string, unknown> | null)?.[key])
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .sort()
}

/** What a rule matches on, to the depth this console reports. */
export function parseStatement(raw: Record<string, unknown> | undefined): RuleStatement {
  const statement = raw as Record<string, Record<string, unknown> | undefined> | undefined
  if (!statement || typeof statement !== "object") {
    return { kind: "other", statement: "none — the rule answered without a Statement" }
  }
  const managed = statement.ManagedRuleGroupStatement
  if (managed && typeof managed === "object") {
    return {
      kind: "managed-rule-group",
      vendor: typeof managed.VendorName === "string" ? managed.VendorName : "",
      name: typeof managed.Name === "string" ? managed.Name : "",
      version: typeof managed.Version === "string" && managed.Version ? managed.Version : null,
      excludedRules: stringList(managed.ExcludedRules, "Name"),
    }
  }
  const group = statement.RuleGroupReferenceStatement
  if (group && typeof group === "object") {
    return {
      kind: "rule-group-reference",
      arn: typeof group.ARN === "string" ? group.ARN : "",
      excludedRules: stringList(group.ExcludedRules, "Name"),
    }
  }
  const rate = statement.RateBasedStatement
  if (rate && typeof rate === "object") {
    return {
      kind: "rate-based",
      limit: typeof rate.Limit === "number" && Number.isFinite(rate.Limit) ? rate.Limit : null,
    }
  }
  const keys = Object.keys(statement)
  return { kind: "other", statement: keys.length > 0 ? shortRaw(keys.join(", ")) : "an empty Statement" }
}

/** The full `WebACL` object as a value this console can render. */
export function parseWebAcl(acl: WebAclShape): WebAclDetail {
  const rules: WafRule[] = (acl.Rules ?? []).map((rule, index) => {
    const action = parseRuleAction(rule.Action, rule.OverrideAction)
    return {
      name: typeof rule.Name === "string" && rule.Name ? rule.Name : `rule ${index + 1} (unnamed)`,
      priority: typeof rule.Priority === "number" && Number.isFinite(rule.Priority) ? rule.Priority : null,
      action,
      statement: parseStatement(rule.Statement),
      blocking: actionBlocks(action),
    }
  })
  const defaultAction = parseDefaultAction(acl.DefaultAction)
  return {
    kind: "read",
    via: "wafv2:GetWebACLForResource",
    defaultAction,
    capacity: typeof acl.Capacity === "number" && Number.isFinite(acl.Capacity) ? acl.Capacity : null,
    rules,
    // The default action counts: an ACL with no blocking rule but a Block
    // default blocks everything that does not match an allow.
    blocks: rules.some((rule) => rule.blocking) || defaultAction.kind === "block",
  }
}

/**
 * What a distribution's `WebACLId` means.
 *
 * Three answers, and the empty string is one of them: it is CloudFront's way of
 * saying nothing is attached. A WAFv2 ACL is an ARN; anything else non-empty is
 * a WAF Classic id, and Classic is a different service — see the module header.
 */
export function parseDistributionWebAcl(webAclId: string | undefined): Association | null {
  const value = (webAclId ?? "").trim()
  if (!value) return null
  if (value.startsWith("arn:")) {
    const segments = value.split("/")
    return {
      kind: "web-acl",
      arn: value,
      name: segments.length >= 2 ? segments[segments.length - 2] || null : null,
      // A distribution's association names the ACL but does not carry its rules,
      // and GetWebACL is not in the registry. Not readable, said out loud.
      detail: WEB_ACL_DETAIL_NOT_READABLE,
    }
  }
  return {
    kind: "waf-classic",
    id: value,
    why:
      "this distribution carries a WAF Classic web ACL id, not a WAFv2 ARN. WAF Classic is a " +
      "separate, deprecated service read through waf: and waf-regional: actions, which this " +
      "engine holds no capability for — so this distribution is NOT unprotected, and its rules " +
      "cannot be described here.",
  }
}

/** An ELBv2 `Type` as a target kind. Only application load balancers can carry a WAF. */
export function loadBalancerKind(type: string | undefined): ProtectionTargetKind {
  switch (type) {
    case "application":
      return "application-load-balancer"
    case "network":
      return "network-load-balancer"
    case "gateway":
      return "gateway-load-balancer"
    default:
      return "load-balancer-of-unstated-type"
  }
}

/* ------------------------------------------------------------ the reads -- */

async function listWebAcls(
  gw: AwsGateway,
  scope: WafScope,
  options: {
    now: () => Date
    denial: DenialContext
    /** The tag read, so an unreadable index says so rather than reading as untagged. */
    tagged: AwsRead<readonly TaggedResource[]>
    index: Map<string, Readonly<Record<string, string>>>
  },
): Promise<AwsRead<WebAclListing>> {
  return readAws<WebAclListing>(
    "wafv2:ListWebACLs",
    async () => {
      const raw: Array<{ name: string; id: string; arn: string; description: string | null }> = []
      let marker: string | undefined
      let pages = 0
      let capped = false

      for (let page = 0; page < MAX_WEB_ACL_PAGES; page += 1) {
        const response = (await gw.call("wafv2:ListWebACLs", {
          Scope: scope,
          NextMarker: marker,
        })) as ListWebAclsResponse
        pages += 1

        for (const acl of response?.WebACLs ?? []) {
          if (!acl?.ARN || !acl.Name || !acl.Id) continue
          raw.push({
            name: acl.Name,
            id: acl.Id,
            arn: acl.ARN,
            description: typeof acl.Description === "string" && acl.Description ? acl.Description : null,
          })
        }

        marker = response?.NextMarker || undefined
        if (!marker) break
        if (page === MAX_WEB_ACL_PAGES - 1) {
          // The bound bit. Not thrown, and not hidden: the caller gets what was
          // read AND the statement that it is not all of it.
          capped = true
        }
      }

      // Sorted so two loads of the same estate produce the same order. ListWebACLs
      // promises none, and an order that changes between renders makes a diff of
      // two screenshots unreadable.
      raw.sort((a, b) => (a.arn < b.arn ? -1 : a.arn > b.arn ? 1 : 0))

      return {
        scope,
        // From the ARNs AWS returned, which is where these ACLs demonstrably
        // are. Not from the caller's region, which for the CLOUDFRONT scope is
        // not even the region the call went to.
        region: raw.length > 0 ? arnRegion(raw[0].arn) : null,
        acls: raw.map((acl) => ({
          ...acl,
          scope,
          region: arnRegion(acl.arn),
          partition: arnPartition(acl.arn),
          accountId: arnAccount(acl.arn),
          attribution: attributionFor(acl.arn, options.tagged, options.index),
          detail: WEB_ACL_DETAIL_NOT_READABLE,
        })),
        truncation: capped
          ? {
              kind: "capped",
              pages,
              read: raw.length,
              why:
                `wafv2:ListWebACLs still had pages after ${MAX_WEB_ACL_PAGES} in the ${scope} scope. ` +
                `${raw.length} web ACL(s) were read and there are more — this list is NOT the whole scope.`,
            }
          : { kind: "complete", pages },
      }
    },
    {
      now: options.now,
      denial: options.denial,
      // EMPTY means the scope holds no web ACLs AND the listing was complete. A
      // capped listing is never EMPTY: it read something, and it is not the whole
      // answer, which is a different fact from "there is nothing here".
      isEmpty: (value) => {
        const listing = value as WebAclListing
        return listing.acls.length === 0 && listing.truncation.kind === "complete"
      },
      ...RETRY,
    },
  )
}

async function listLoadBalancers(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<readonly ProtectionTarget[]>> {
  return readAws<readonly ProtectionTarget[]>(
    "elasticloadbalancing:DescribeLoadBalancers",
    async () => {
      const targets: ProtectionTarget[] = []
      let marker: string | undefined
      for (let page = 0; page < MAX_TARGET_PAGES; page += 1) {
        const response = (await gw.call("elasticloadbalancing:DescribeLoadBalancers", {
          Marker: marker,
        })) as DescribeLoadBalancersResponse
        for (const lb of response?.LoadBalancers ?? []) {
          if (!lb?.LoadBalancerArn) continue
          targets.push({
            arn: lb.LoadBalancerArn,
            name: lb.LoadBalancerName || lb.LoadBalancerArn,
            kind: loadBalancerKind(lb.Type),
            scope: "REGIONAL",
            scheme: typeof lb.Scheme === "string" && lb.Scheme ? lb.Scheme : null,
          })
        }
        marker = response?.NextMarker || undefined
        if (!marker) break
        if (page === MAX_TARGET_PAGES - 1) {
          // Here the partial answer cannot be carried honestly inside the value —
          // a truncated list of load balancers rendered as the estate's front
          // doors would let an unprotected one go unmentioned. So it throws, and
          // becomes ERROR with the reason rather than a shorter list.
          throw new Error(
            `elasticloadbalancing:DescribeLoadBalancers still had pages after ${MAX_TARGET_PAGES}. ` +
              `This engine will not render a partial list of load balancers as if it were every front door.`,
          )
        }
      }
      targets.sort((a, b) => (a.arn < b.arn ? -1 : a.arn > b.arn ? 1 : 0))
      return targets
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

/**
 * The distributions, and what each one's `WebACLId` says.
 *
 * The association travels with the target because it arrives in the same
 * response: there is no second call to make, and inventing one would be a call
 * that can fail separately for no gain.
 */
async function listDistributions(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<{
  targets: AwsRead<readonly ProtectionTarget[]>
  associations: Map<string, Association | null>
}> {
  const associations = new Map<string, Association | null>()
  const targets = await readAws<readonly ProtectionTarget[]>(
    "cloudfront:ListDistributions",
    async () => {
      const found: ProtectionTarget[] = []
      let marker: string | undefined
      for (let page = 0; page < MAX_TARGET_PAGES; page += 1) {
        const response = (await gw.call("cloudfront:ListDistributions", {
          Marker: marker,
        })) as ListDistributionsResponse
        const list = response?.DistributionList
        for (const item of list?.Items ?? []) {
          if (!item?.ARN) continue
          found.push({
            arn: item.ARN,
            name: item.DomainName || item.Id || item.ARN,
            kind: "distribution",
            scope: "CLOUDFRONT",
            // A distribution is internet-facing by construction; there is no
            // "internal" distribution, and saying so is not a guess.
            scheme: "internet-facing",
          })
          associations.set(item.ARN, parseDistributionWebAcl(item.WebACLId))
        }
        marker = list?.IsTruncated ? list?.NextMarker || undefined : undefined
        if (!marker) break
        if (page === MAX_TARGET_PAGES - 1) {
          throw new Error(
            `cloudfront:ListDistributions still had pages after ${MAX_TARGET_PAGES}. This engine ` +
              `will not render a partial list of distributions as if it were every edge.`,
          )
        }
      }
      found.sort((a, b) => (a.arn < b.arn ? -1 : a.arn > b.arn ? 1 : 0))
      return found
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
  return { targets, associations }
}

/**
 * What is in front of one load balancer.
 *
 * Its own `AwsRead` per resource. A denied `GetWebACLForResource` on one ALB
 * says so on that row and leaves every other row alone — and, critically, does
 * not render as "no web ACL", which is the reassuring default.
 */
async function readAssociation(
  gw: AwsGateway,
  target: ProtectionTarget,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Association>> {
  const read = await readAws<Association | null>(
    "wafv2:GetWebACLForResource",
    async () => {
      const response = (await gw.call("wafv2:GetWebACLForResource", {
        ResourceArn: target.arn,
      })) as GetWebAclForResourceResponse
      const acl = response?.WebACL
      // AWS answers with an empty body when nothing is associated. Returned as
      // null and turned into EMPTY by `isEmpty` — a fact, not a failure.
      if (!acl || !acl.ARN) return null
      return {
        kind: "web-acl",
        arn: acl.ARN,
        name: typeof acl.Name === "string" && acl.Name ? acl.Name : null,
        // The one place a web ACL's rules ARE readable by this engine.
        detail: parseWebAcl(acl),
      }
    },
    {
      now: options.now,
      denial: options.denial,
      isEmpty: (value) => value === null,
      ...RETRY,
    },
  )
  return withoutNull(read)
}

/**
 * `AwsRead<Association | null>` narrowed to `AwsRead<Association>`.
 *
 * Written as a branch rather than a cast. `isEmpty` above already maps null to
 * EMPTY, so the null arms here are unreachable — and a cast is exactly the seam
 * through which an empty value gets smuggled into a state that means "we read
 * something", which is the defect this whole read plane exists to prevent. A
 * branch that turns a stray null into EMPTY is the same answer the type
 * promises, arrived at honestly.
 */
function withoutNull(read: AwsRead<Association | null>): AwsRead<Association> {
  if (read.state === "ACTUAL") {
    if (read.value === null) {
      return { state: "EMPTY", capability: read.capability, asOf: read.asOf }
    }
    return { ...read, value: read.value }
  }
  if (read.state === "STALE") {
    if (read.value === null) {
      return { state: "EMPTY", capability: read.capability, asOf: read.asOf }
    }
    return { ...read, value: read.value }
  }
  return read
}

/* --------------------------------------------------------- attribution -- */

function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): WafAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `these tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this resource has no ARN this engine can state, so it cannot be joined against the tag " +
        "index. Unattributed would be a claim about its tags; this is a claim about ours.",
    }
  }
  const tags = index.get(arn)
  // The tag index answered and this ARN is not in it. The Resource Groups
  // Tagging API returns resources that HAVE tags, so an absence means none.
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

/* ----------------------------------------------------------- the surface -- */

/**
 * Everything a WAF surface needs: both scopes, every front door, and a verdict.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function wafReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<WafReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [])

  // The two scopes are two catalogues served from two endpoints, and one being
  // refused or unconfigured says nothing about the other. Read together, kept
  // apart.
  const [regional, cloudfront, loadBalancers, distributionRead] = await Promise.all([
    listWebAcls(gw, "REGIONAL", { now, denial, tagged, index }),
    listWebAcls(gw, "CLOUDFRONT", { now, denial, tagged, index }),
    listLoadBalancers(gw, { now, denial }),
    listDistributions(gw, { now, denial }),
  ])

  const asOf = now().toISOString()
  const refreshMs = {
    webAcls: CAPABILITIES["wafv2:ListWebACLs"].refreshMs,
    association: CAPABILITIES["wafv2:GetWebACLForResource"].refreshMs,
  }

  const balancerTargets =
    loadBalancers.state === "ACTUAL" || loadBalancers.state === "STALE" ? loadBalancers.value : []
  const distributionTargets =
    distributionRead.targets.state === "ACTUAL" || distributionRead.targets.state === "STALE"
      ? distributionRead.targets.value
      : []

  /*
   * Load balancers, one GetWebACLForResource each, bounded and batched. A
   * network or gateway load balancer is not called at all: WAFv2 cannot attach
   * to one, and the call would fail in a way that renders as a fault on a
   * resource that is behaving exactly as designed.
   */
  const associations: Array<AwsRead<Association>> = new Array(balancerTargets.length)
  for (let start = 0; start < balancerTargets.length; start += ASSOCIATION_CONCURRENCY) {
    const batch = balancerTargets.slice(start, start + ASSOCIATION_CONCURRENCY)
    const read = await Promise.all(
      batch.map((target, offset) => {
        const position = start + offset
        if (target.kind !== "application-load-balancer") {
          const notApplicable: AwsRead<Association> = {
            state: "UNCONFIGURED",
            capability: "wafv2:GetWebACLForResource",
            why:
              `a ${target.kind.replace(/-/g, " ")} cannot carry a WAFv2 web ACL — the API's ` +
              `protected-resource types are application load balancers, API Gateway stages, ` +
              `AppSync APIs, Cognito user pools, App Runner services and Verified Access ` +
              `instances. This engine did not ask, which is not a finding about this resource.`,
          }
          return Promise.resolve(notApplicable)
        }
        if (position >= MAX_ASSOCIATION_READS) {
          const skipped: AwsRead<Association> = {
            state: "UNCONFIGURED",
            capability: "wafv2:GetWebACLForResource",
            why:
              `this engine reads at most ${MAX_ASSOCIATION_READS} web ACL associations per load and ` +
              `this resource is number ${position + 1} of ${balancerTargets.length}. Whether a web ` +
              `ACL is in front of it was NOT read — which is not the same as there being none.`,
          }
          return Promise.resolve(skipped)
        }
        return readAssociation(gw, target, { now, denial })
      }),
    )
    for (let i = 0; i < read.length; i += 1) associations[start + i] = read[i]
  }

  const protection: ResourceProtection[] = [
    ...balancerTargets.map((target, i) => ({
      target,
      association: associations[i],
      attribution: attributionFor(target.arn, tagged, index),
      refreshMs: refreshMs.association,
      asOf,
    })),
    ...distributionTargets.map((target) => ({
      target,
      // The fact came from the distribution listing, so that is the capability
      // this reading names. Claiming it came from a wafv2 call would misdirect
      // an operator reading a denial.
      association: distributionAssociation(
        distributionRead.associations.get(target.arn) ?? null,
        asOf,
      ),
      attribution: attributionFor(target.arn, tagged, index),
      refreshMs: CAPABILITIES["cloudfront:ListDistributions"].refreshMs,
      asOf,
    })),
  ]

  return {
    identity,
    tagged,
    regional,
    cloudfront,
    loadBalancers,
    distributions: distributionRead.targets,
    protection,
    coverage: wafCoverage({
      regional,
      cloudfront,
      loadBalancers,
      distributions: distributionRead.targets,
      protection,
    }),
    asOf,
    refreshMs,
  }
}

/** An association learnt from the distribution listing, as the read it came from. */
function distributionAssociation(
  association: Association | null,
  asOf: string,
): AwsRead<Association> {
  if (association === null) {
    return { state: "EMPTY", capability: "cloudfront:ListDistributions", asOf }
  }
  return {
    state: "ACTUAL",
    capability: "cloudfront:ListDistributions",
    value: association,
    asOf,
    fresh: true,
  }
}

/* ------------------------------------------------------------- the verdict -- */

/** Whether a listing is one this engine actually performed. */
function listingRead(listing: AwsRead<WebAclListing>): boolean {
  return listing.state === "ACTUAL" || listing.state === "STALE" || listing.state === "EMPTY"
}

function aclCount(listing: AwsRead<WebAclListing>): number {
  return listing.state === "ACTUAL" || listing.state === "STALE" ? listing.value.acls.length : 0
}

/**
 * Whether a listing walked its scope to the end.
 *
 * EMPTY is complete by construction — `isEmpty` above only returns true for a
 * listing that finished. A CAPPED listing is not: it stopped early, and a
 * capped listing that happened to read nothing is emphatically not evidence
 * that the scope holds nothing. Without this, a paging bug or a bound hit on
 * page one would render as "NO WEB APPLICATION FIREWALL" — a confident claim
 * about a catalogue this engine never finished reading.
 */
function listingComplete(listing: AwsRead<WebAclListing>): boolean {
  if (listing.state === "EMPTY") return true
  if (listing.state === "ACTUAL" || listing.state === "STALE") {
    return listing.value.truncation.kind === "complete"
  }
  return false
}

/**
 * What it would take to put a web ACL in front of this estate.
 *
 * Named as Terraform resources rather than console clicks, because the estate is
 * provisioned from `infrastructure/terraform/` and a fix applied by hand there
 * is a fix the next apply removes. This is a statement of what is missing — it
 * is not an approval, a sign-off or a claim that anybody has reviewed it.
 */
export const WAF_REMEDY =
  "no web ACL is attached. Closing it takes an aws_wafv2_web_acl in the REGIONAL scope, in this " +
  "estate's own region, associated with the load balancer by an aws_wafv2_web_acl_association; " +
  "and, for the edge, an aws_wafv2_web_acl in the CLOUDFRONT scope (which lives at the " +
  "partition's global endpoint) referenced by the distribution's web_acl_id. Until then every " +
  "request reaches the origin unfiltered."

/**
 * The headline verdict.
 *
 * Exported and pure so the derivation can be reasoned about on its own, but
 * `wafReadings` is the only production caller and the tests drive it through
 * there rather than through here.
 */
export function wafCoverage(input: {
  regional: AwsRead<WebAclListing>
  cloudfront: AwsRead<WebAclListing>
  loadBalancers: AwsRead<readonly ProtectionTarget[]>
  distributions: AwsRead<readonly ProtectionTarget[]>
  protection: readonly ResourceProtection[]
}): WafCoverage {
  const { regional, cloudfront, loadBalancers, distributions, protection } = input

  // A scope this engine could not read makes every other statement conditional,
  // so it is said first and nothing else is claimed.
  if (!listingRead(regional) || !listingRead(cloudfront)) {
    const unread: string[] = []
    // The scope is named by this function rather than left to `describeRead`,
    // which renders a denial from the capability alone — and BOTH scopes are the
    // same capability. "refused wafv2:ListWebACLs" without the scope leaves an
    // operator unable to tell a refused edge catalogue from a refused regional
    // one, which are different exposures with different remedies.
    if (!listingRead(regional)) {
      unread.push(`the REGIONAL scope — ${describeRead(regional, "the REGIONAL web ACL listing")}`)
    }
    if (!listingRead(cloudfront)) {
      unread.push(`the CLOUDFRONT scope — ${describeRead(cloudfront, "the CLOUDFRONT web ACL listing")}`)
    }
    return {
      kind: "unknown",
      why:
        `whether anything is in front of this estate cannot be stated: ${unread.join("; ")}. ` +
        `An unread scope is not an empty one.`,
    }
  }

  // Same rule for the resource listings: an estate whose load balancers could
  // not be enumerated cannot be declared protected OR exposed.
  const targetsUnread: string[] = []
  if (loadBalancers.state === "DENIED" || loadBalancers.state === "THROTTLED" || loadBalancers.state === "ERROR") {
    targetsUnread.push(describeRead(loadBalancers, "the load balancer listing"))
  }
  if (distributions.state === "DENIED" || distributions.state === "THROTTLED" || distributions.state === "ERROR") {
    targetsUnread.push(describeRead(distributions, "the distribution listing"))
  }
  if (targetsUnread.length > 0) {
    return {
      kind: "unknown",
      why:
        `web ACLs were read, but what they would be protecting was not: ${targetsUnread.join("; ")}. ` +
        `Coverage cannot be stated over resources this engine could not enumerate.`,
    }
  }

  // Rows whose association could not be read. Named everywhere a verdict is
  // given, so no verdict ever quietly means "as far as we bothered to look".
  const unreadable = protection
    .filter((row) => {
      const state = row.association.state
      return state === "DENIED" || state === "THROTTLED" || state === "ERROR" || state === "UNCONFIGURED"
    })
    // A resource that CANNOT carry a WAF is not an unread row; it is a resource
    // the question does not apply to.
    .filter((row) => row.target.kind === "application-load-balancer" || row.target.kind === "distribution")
    .map((row) => `${row.target.name} — ${describeRead(row.association, "its web ACL association")}`)
    .sort()

  const applicable = protection.filter(
    (row) => row.target.kind === "application-load-balancer" || row.target.kind === "distribution",
  )

  if (applicable.length === 0) {
    return {
      kind: "no-targets",
      why:
        "nothing this console can see takes requests from the internet through a resource a web " +
        "ACL can attach to. There is no load balancer or distribution to protect.",
    }
  }

  const exposed: ExposedResource[] = applicable
    .filter((row) => row.association.state === "EMPTY")
    .map((row) => ({
      arn: row.target.arn,
      name: row.target.name,
      kind: row.target.kind,
      scheme: row.target.scheme,
    }))
    .sort((a, b) => (a.arn < b.arn ? -1 : a.arn > b.arn ? 1 : 0))

  const attached = applicable.filter(
    (row) => row.association.state === "ACTUAL" || row.association.state === "STALE",
  )

  // Both scopes answered, and both are empty. The expected answer in this estate
  // today, and the one that has to read as a finding rather than a blank table.
  if (
    aclCount(regional) === 0 &&
    aclCount(cloudfront) === 0 &&
    listingComplete(regional) &&
    listingComplete(cloudfront) &&
    attached.length === 0
  ) {
    return {
      kind: "no-web-acl-exists",
      scopesRead: ["REGIONAL", "CLOUDFRONT"],
      exposed,
      unreadable,
      remedy: WAF_REMEDY,
    }
  }

  if (exposed.length > 0) {
    return { kind: "exposed", exposed, protectedCount: attached.length, unreadable, remedy: WAF_REMEDY }
  }

  // Everything applicable has something attached. Whether any of it BLOCKS is a
  // separate question, and count mode is the answer that looks like protection.
  const blocking = attached.filter((row) => {
    if (row.association.state !== "ACTUAL" && row.association.state !== "STALE") return false
    const association = row.association.value
    // A WAF Classic ACL cannot be described by this engine, so it is not counted
    // as blocking and not counted as monitoring-only either — it is listed as
    // unreadable detail below.
    if (association.kind !== "web-acl") return false
    return association.detail.kind === "read" && association.detail.blocks
  })

  if (blocking.length === 0 && attached.every((row) => detailWasRead(row))) {
    return {
      kind: "monitoring-only",
      resources: attached.map((row) => row.target.name).sort(),
      unreadable,
      why:
        "every web ACL in front of this estate matches and records but blocks nothing — every " +
        "rule is in Count mode or overridden to Count, and no default action blocks. Requests " +
        "are being logged, not stopped.",
    }
  }

  return {
    kind: "protected",
    protectedCount: attached.length,
    blockingConfirmed: blocking.length,
    detailUnread: attached
      .filter((row) => !detailWasRead(row))
      .map((row) => row.target.name)
      .sort(),
    unreadable,
  }
}

/** Whether a row's associated ACL had its rules read, rather than only named. */
function detailWasRead(row: ResourceProtection): boolean {
  if (row.association.state !== "ACTUAL" && row.association.state !== "STALE") return false
  const association = row.association.value
  return association.kind === "web-acl" && association.detail.kind === "read"
}

/* ------------------------------------------------------------ rendering -- */

/** The sentence a surface prints for one resource's attribution. */
export function describeWafAttribution(attribution: WafAttribution): string {
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

/** The sentence a surface prints for a web ACL's default action. */
export function describeDefaultAction(action: DefaultAction): string {
  switch (action.kind) {
    case "allow":
      return "default action ALLOW — an unmatched request reaches the origin"
    case "block":
      return "default action BLOCK — only what a rule allows reaches the origin"
    case "unreadable":
      return `default action unknown — ${action.why}`
  }
}

/** The sentence a surface prints for one rule. Count mode is said in words. */
export function describeRule(rule: WafRule): string {
  const where = rule.priority === null ? "priority unstated" : `priority ${rule.priority}`
  const what =
    rule.statement.kind === "managed-rule-group"
      ? `managed rule group ${rule.statement.vendor}/${rule.statement.name}` +
        `${rule.statement.version ? ` version ${rule.statement.version}` : ""}` +
        `${
          rule.statement.excludedRules.length > 0
            ? ` (${rule.statement.excludedRules.length} rule(s) excluded: ${rule.statement.excludedRules.join(", ")})`
            : ""
        }`
      : rule.statement.kind === "rule-group-reference"
        ? `rule group ${rule.statement.arn}` +
          `${
            rule.statement.excludedRules.length > 0
              ? ` (${rule.statement.excludedRules.length} rule(s) excluded)`
              : ""
          }`
        : rule.statement.kind === "rate-based"
          ? `rate limit ${rule.statement.limit === null ? "unstated" : rule.statement.limit} per five minutes`
          : `statement: ${rule.statement.statement}`
  const action =
    rule.action.kind === "unreadable" ? `action unknown — ${rule.action.why}` : rule.action.kind
  const effect = rule.blocking ? "blocks" : "does NOT block"
  return `${rule.name} — ${where} — ${what} — ${action}, ${effect}`
}

/** The sentence a surface prints for a web ACL's contents. */
export function describeDetail(detail: WebAclDetail): string {
  if (detail.kind === "not-readable") {
    return `rules unknown — ${detail.why}`
  }
  const blocking = detail.rules.filter((rule) => rule.blocking).length
  return (
    `${describeDefaultAction(detail.defaultAction)} · ${detail.rules.length} rule(s), ` +
    `${blocking} of which can stop a request` +
    `${detail.capacity === null ? "" : ` · ${detail.capacity} WCU`}` +
    `${detail.blocks ? "" : " · BLOCKS NOTHING — matching and recording only"}`
  )
}

/** The sentence a surface prints for one resource's protection. One funnel. */
export function describeProtection(row: ResourceProtection): string {
  const head =
    `${row.target.name} (${row.target.kind.replace(/-/g, " ")}` +
    `${row.target.scheme ? `, ${row.target.scheme}` : ""}) — ` +
    `${describeWafAttribution(row.attribution)}`

  if (row.association.state === "ACTUAL" || row.association.state === "STALE") {
    const association = row.association.value
    if (association.kind === "waf-classic") {
      return `${head} — WAF Classic web ACL ${association.id} — ${association.why}`
    }
    return (
      `${head} — behind web ACL ${association.name ?? association.arn} — ` +
      `${describeDetail(association.detail)} · as of ${row.asOf}, refreshed every ` +
      `${Math.round(row.refreshMs / 1000)}s`
    )
  }
  if (row.association.state === "EMPTY") {
    // The one sentence this module exists to be able to say. Deliberately not
    // the word "none", which reads as an absence of information.
    return (
      `${head} — NO WEB ACL — this engine asked and AWS answered that nothing is associated. ` +
      `Requests reach it unfiltered. As of ${row.asOf}.`
    )
  }
  // Everything else goes through the one renderer, so a refusal reads as a
  // refusal here exactly as it does everywhere else — never as "unprotected".
  return `${head} — ${describeRead(row.association, `${row.target.name}'s web ACL association`)}`
}

/** The sentence a surface prints for one scope's listing. */
export function describeScope(scope: WafScope, listing: AwsRead<WebAclListing>): string {
  const served =
    scope === "CLOUDFRONT"
      ? "served from the partition's global endpoint"
      : "served from this estate's own region"
  if (listing.state === "ACTUAL" || listing.state === "STALE") {
    const value = listing.value
    const capped =
      value.truncation.kind === "capped" ? ` · INCOMPLETE — ${value.truncation.why}` : ""
    return (
      `${value.acls.length} web ACL(s) in the ${scope} scope (${served}` +
      `${value.region ? `, ${value.region}` : ""}): ` +
      `${value.acls.map((acl) => acl.name).join(", ")}${capped}`
    )
  }
  if (listing.state === "EMPTY") {
    return (
      `no web ACL exists in the ${scope} scope — wafv2:ListWebACLs succeeded and returned an ` +
      `empty list (${served}). There is nothing to attach. As of ${listing.asOf}.`
    )
  }
  return describeRead(listing, `web ACLs in the ${scope} scope`)
}

/** The sentence a surface prints for the headline verdict. */
export function describeCoverage(coverage: WafCoverage): string {
  switch (coverage.kind) {
    case "unknown":
      return `unknown — ${coverage.why}`
    case "no-targets":
      return `nothing to protect — ${coverage.why}`
    case "no-web-acl-exists": {
      const named =
        coverage.exposed.length === 0
          ? ""
          : ` ${coverage.exposed.length} internet-reachable resource(s) are taking requests ` +
            `directly: ${coverage.exposed.map((e) => e.name).join(", ")}.`
      const qualifier =
        coverage.unreadable.length === 0
          ? ""
          : ` A further ${coverage.unreadable.length} resource(s) could not be read.`
      return (
        `NO WEB APPLICATION FIREWALL — both WAFv2 scopes (${coverage.scopesRead.join(" and ")}) ` +
        `were read successfully and neither contains a single web ACL.${named} ${coverage.remedy}${qualifier}`
      )
    }
    case "exposed": {
      const qualifier =
        coverage.unreadable.length === 0
          ? ""
          : ` A further ${coverage.unreadable.length} resource(s) could not be read.`
      return (
        `EXPOSED — ${coverage.exposed.length} resource(s) have no web ACL in front of them ` +
        `(${coverage.exposed.map((e) => e.name).join(", ")}), while ${coverage.protectedCount} ` +
        `do. ${coverage.remedy}${qualifier}`
      )
    }
    case "monitoring-only": {
      const qualifier =
        coverage.unreadable.length === 0
          ? ""
          : ` A further ${coverage.unreadable.length} resource(s) could not be read.`
      return `MONITORING ONLY — ${coverage.why} Resources: ${coverage.resources.join(", ")}.${qualifier}`
    }
    case "protected": {
      const qualifier =
        coverage.unreadable.length === 0
          ? ""
          : `, though ${coverage.unreadable.length} resource(s) could not be read ` +
            `(${coverage.unreadable.join("; ")})`
      // Never "and at least one rule blocks" unqualified: for a resource whose
      // rules this engine cannot read, that would be a claim about a rule set
      // nobody looked at.
      const unread =
        coverage.detailUnread.length === 0
          ? ""
          : `. The rules of ${coverage.detailUnread.length} of them could NOT be read — ` +
            `${coverage.detailUnread.join(", ")} — so whether those web ACLs block anything is ` +
            `unknown (it needs wafv2:GetWebACL, which this engine does not hold)`
      return (
        `attached — every resource that can carry a web ACL has one ` +
        `(${coverage.protectedCount} resource(s)), ${coverage.blockingConfirmed} of which were ` +
        `read and confirmed to block${qualifier}${unread}`
      )
    }
  }
}

export interface WafLine {
  label: string
  text: string
}

/**
 * What a WAF surface prints.
 *
 * The surface agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function wafLines(readings: WafReadings): readonly WafLine[] {
  const lines: WafLine[] = [
    { label: "Coverage", text: describeCoverage(readings.coverage) },
    {
      label: "REGIONAL scope",
      text:
        `${describeScope("REGIONAL", readings.regional)} · refreshed every ` +
        `${Math.round(readings.refreshMs.webAcls / 1000)}s`,
    },
    {
      label: "CLOUDFRONT scope",
      text:
        `${describeScope("CLOUDFRONT", readings.cloudfront)} · refreshed every ` +
        `${Math.round(readings.refreshMs.webAcls / 1000)}s`,
    },
  ]
  for (const row of readings.protection) {
    lines.push({ label: row.target.name, text: describeProtection(row) })
    // The rules themselves, where this engine actually read them. A row that
    // said "behind a web ACL" and stopped would let a rule group sitting
    // entirely in Count mode read as protection, which is the reassuring
    // default this module exists to refuse.
    if (row.association.state !== "ACTUAL" && row.association.state !== "STALE") continue
    const association = row.association.value
    if (association.kind !== "web-acl" || association.detail.kind !== "read") continue
    for (const rule of association.detail.rules) {
      lines.push({ label: `${row.target.name} · rule`, text: describeRule(rule) })
    }
  }
  // The web ACLs that exist but are attached to nothing. An ACL nobody
  // associated is a rule set somebody wrote and nobody is running.
  for (const listing of [readings.regional, readings.cloudfront]) {
    if (listing.state !== "ACTUAL" && listing.state !== "STALE") continue
    for (const acl of listing.value.acls) {
      lines.push({
        label: acl.name,
        text:
          `${acl.name} — ${acl.scope} scope` +
          `${acl.region ? `, ${acl.region}` : ""}` +
          `${acl.partition ? `, partition ${acl.partition}` : ""} — ` +
          `${describeWafAttribution(acl.attribution)} — ${describeDetail(acl.detail)}`,
      })
    }
  }
  return lines
}
