/**
 * STUDIO-070-004 (LOADBALANCER) — the front door, and the only honest answer to
 * "is anything actually being served".
 *
 * `infrastructure/terraform/alb.tf` provisions an application load balancer, one
 * target group on port 3000 health-checking `/api/health`, and one listener on
 * port 80 speaking HTTP. Nothing in the running product had ever issued an
 * `elasticloadbalancing:*` call, so this whole service was dark: the console
 * could not name the load balancers, could not say which listener terminated
 * TLS, and — the expensive one — could not say whether the load balancer was
 * willing to send a request to any of the tasks ECS reports as RUNNING.
 *
 * ## Target health is the liveness signal, and ECS's task count is not
 *
 * `ecs:DescribeServices` reports the number of tasks ECS believes it started.
 * `elasticloadbalancing:DescribeTargetHealth` reports how many of those the load
 * balancer will actually route to. Those two numbers disagree for the entire
 * duration of a failed deployment, and they disagree silently: a service reads
 * RUNNING while every target is `draining` or `unhealthy`, and the estate is
 * down. That gap is why `TARGET_HEALTH_TTL_MS` is ten seconds while everything
 * else here is three minutes.
 *
 * An unhealthy target carries its reason code AND its description, because
 * `Target.ResponseCodeMismatch` (the app answered, with the wrong status) and
 * `Target.Timeout` (the app did not answer at all) send an operator to
 * completely different places, and a row that said only "unhealthy" sends them
 * to neither. `HealthReason` is a union whose `known: false` arm has no `code`
 * field at all, so a surface cannot print an empty string where a reason should
 * be.
 *
 * ## Five capabilities, five readings, degrading independently
 *
 * `DescribeLoadBalancers`, `DescribeListeners`, `DescribeTargetGroups`,
 * `DescribeTargetHealth` and `DescribeRules` are five separate IAM actions and a
 * role is routinely granted some and not others. Folding them into one reading
 * would make a refused `DescribeTargetHealth` render as "refused
 * DescribeLoadBalancers", so the statement an operator pastes into a policy
 * would not contain the action that is actually missing — they would grant it,
 * redeploy, and be refused identically. `retained.ts` paid for that lesson with
 * `backup:ListBackupVaults` and `sqs.ts` is built the way that one ended up.
 *
 * So the listing is one `AwsRead`, every load balancer carries its OWN
 * `AwsRead` for its listeners and for its target groups, and every target group
 * carries its own `AwsRead` for its target health. A denied target-health call
 * does not collapse the load balancer row to UNKNOWN, does not remove it, and —
 * this is the part that matters — does not render as "0 unhealthy targets".
 *
 * ## A plaintext listener is a finding, and "we could not check" is not "fine"
 *
 * A listener speaking HTTP with no redirect to HTTPS is a finding: the estate's
 * own listener is exactly that today (`alb.tf` line 43, `protocol = "HTTP"`,
 * with a comment saying CloudFront terminates TLS in front of it — which is true
 * and is still a load balancer that will serve plaintext to anyone who reaches
 * it directly).
 *
 * The redirect can live in the listener's default action OR in a listener rule,
 * and rules are a SEPARATE capability. So when the default action is not a
 * redirect and `DescribeRules` could not be read, the posture is
 * `plaintext-redirect-unknown` and not `plaintext-no-redirect`. Reporting a
 * finding this engine did not establish is the same class of defect as
 * suppressing one it did.
 *
 * ## Certificates
 *
 * Every HTTPS and TLS listener reports the certificate ARNs bound to it, and
 * `listenerCertificates()` flattens them into a join list. This exists so the
 * certificates reader can correlate an expiry to a LIVE listener: an ACM
 * certificate expiring in six days matters enormously if a listener is serving
 * it and not at all if it is orphaned, and only this module knows which.
 *
 * ## Region and partition
 *
 * From the ARN AWS returned, and otherwise from the resolved identity. There is
 * no literal region in this file and no `"aws"` partition fallback. GE-010-007
 * was a data-residency defect caused by exactly that fallback, and a DNS name
 * parsed for its region (`<name>-<id>.<region>.elb.amazonaws.com`) is the same
 * guess wearing a different hat — that host shape is the commercial partition's
 * only.
 *
 * ## Attribution
 *
 * Through `tags.ts` and the Resource Groups Tagging API, so a load balancer
 * attributes the same way a queue does. Note the deliberate deviation from "mark
 * it shared where no tag says otherwise": `tags.ts` keeps `shared` (somebody
 * decided) and `unattributed` (nobody tagged it) apart, and folding them is how
 * an untagged load balancer gets billed to a tenant that did not create it. A
 * FOURTH answer, `unknown`, covers the case where the tag index itself could not
 * be read — "we could not look up this load balancer's tags" is not "this load
 * balancer has no tenant tag".
 *
 * ## What this module does NOT read, said out loud
 *
 * - **Target groups not attached to a load balancer are not listed.**
 *   `DescribeTargetGroups` is called with `LoadBalancerArn` per load balancer,
 *   which is the scoping that makes the call bounded. An orphaned target group
 *   is real and this module does not claim to see it.
 * - **Classic (v1) load balancers are not read.** The capability registry holds
 *   the v2 Describes only; `elasticloadbalancing:DescribeLoadBalancers` against
 *   the v2 API does not return Classic load balancers, and this module does not
 *   get to add a capability.
 * - **Access-log configuration is a load balancer ATTRIBUTE**
 *   (`DescribeLoadBalancerAttributes`), which is not in the registry, so this
 *   module says nothing about whether access logging is on. `alb.tf` sets it to
 *   `enabled = false`; that is Terraform's claim, not a read.
 */

import { CAPABILITIES, type Capability } from "./capabilities"
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
 * How many pages any one paged Describe walks before it stops.
 *
 * `client.ts` asks for `PageSize: 400`, so this is four thousand load balancers,
 * listeners or target groups. A runaway page loop is an outage in a server
 * render with a person waiting; hitting the cap is NOT silently ignored — see
 * `Truncation`, which travels with the value and becomes a finding.
 */
export const MAX_PAGES = 10

/**
 * How many load balancers get their listeners and target groups read in one
 * load. Beyond this the row still appears, carrying UNCONFIGURED sub-reads whose
 * `why` says the engine stopped — which is a different sentence from "this load
 * balancer has no listeners".
 */
export const MAX_DETAILED_LOAD_BALANCERS = 50

/**
 * How many target groups get a `DescribeTargetHealth` in one load.
 *
 * One call per target group, against an account-wide ELB Describe throttle the
 * deploy pipeline also uses. The estate has one target group; the cap exists so
 * an account that has grown three hundred does not turn one page render into
 * three hundred API calls.
 */
export const MAX_TARGET_HEALTH_READS = 100

/**
 * How many `DescribeRules` calls are spent looking for a redirect that is not in
 * the listener's default action. Only plaintext listeners are candidates, so on
 * a correctly configured estate this budget is never touched at all.
 */
export const MAX_RULE_READS = 50

/** How many sub-reads are in flight at once. Bounded so one load is not a burst. */
const CONCURRENCY = 6

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/* ------------------------------------------------------------- API shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface DescribeLoadBalancersResponse {
  LoadBalancers?: Array<{
    LoadBalancerArn?: string
    LoadBalancerName?: string
    DNSName?: string
    Scheme?: string
    VpcId?: string
    Type?: string
    CreatedTime?: string | Date
    State?: { Code?: string; Reason?: string }
    AvailabilityZones?: Array<{ ZoneName?: string; SubnetId?: string }>
    SecurityGroups?: string[]
    IpAddressType?: string
  }>
  NextMarker?: string
}

interface RedirectConfigShape {
  Protocol?: string
  Port?: string
  Host?: string
  Path?: string
  Query?: string
  StatusCode?: string
}

interface ActionShape {
  Type?: string
  TargetGroupArn?: string
  RedirectConfig?: RedirectConfigShape
}

interface DescribeListenersResponse {
  Listeners?: Array<{
    ListenerArn?: string
    LoadBalancerArn?: string
    Port?: number
    Protocol?: string
    SslPolicy?: string
    Certificates?: Array<{ CertificateArn?: string; IsDefault?: boolean }>
    DefaultActions?: ActionShape[]
    AlpnPolicy?: string[]
  }>
  NextMarker?: string
}

interface DescribeTargetGroupsResponse {
  TargetGroups?: Array<{
    TargetGroupArn?: string
    TargetGroupName?: string
    Protocol?: string
    Port?: number
    VpcId?: string
    TargetType?: string
    ProtocolVersion?: string
    LoadBalancerArns?: string[]
    HealthCheckEnabled?: boolean
    HealthCheckProtocol?: string
    HealthCheckPort?: string
    HealthCheckPath?: string
    HealthCheckIntervalSeconds?: number
    HealthCheckTimeoutSeconds?: number
    HealthyThresholdCount?: number
    UnhealthyThresholdCount?: number
    Matcher?: { HttpCode?: string; GrpcCode?: string }
  }>
  NextMarker?: string
}

interface DescribeTargetHealthResponse {
  TargetHealthDescriptions?: Array<{
    Target?: { Id?: string; Port?: number; AvailabilityZone?: string }
    HealthCheckPort?: string
    TargetHealth?: { State?: string; Reason?: string; Description?: string }
  }>
}

interface DescribeRulesResponse {
  Rules?: Array<{
    RuleArn?: string
    Priority?: string
    IsDefault?: boolean
    Actions?: ActionShape[]
  }>
  NextMarker?: string
}

/* ---------------------------------------------------------------- shapes -- */

/**
 * Whether a page loop finished or stopped at its bound.
 *
 * A reader that silently returns the first page is the same lie as an empty
 * list, so the bound is not silent: `truncated` names the capability and the
 * page count, travels on the value, and becomes a `listing-truncated` finding.
 */
export type Truncation =
  | { kind: "complete" }
  | { kind: "truncated"; capability: Capability; pagesRead: number; why: string }

/**
 * Whether the load balancer answers the internet or only the VPC.
 *
 * A union rather than a string, and `unstated` is its own arm rather than
 * defaulting to `internal`. "AWS did not tell us the scheme" defaulting to the
 * safe-sounding answer is precisely the reassuring default this read plane
 * exists to forbid.
 */
export type LoadBalancerScheme =
  | { kind: "internet-facing" }
  | { kind: "internal" }
  | { kind: "unstated"; raw: string | null; why: string }

/**
 * What a listener does about TLS.
 *
 * `plaintext-no-redirect` is the finding. `plaintext-redirect-unknown` is the
 * case where the default action is not a redirect and the listener's RULES could
 * not be read — a redirect may well be in a rule, so claiming the finding would
 * be inventing one. Two arms, because they are two facts.
 */
export type TlsPosture =
  /** Terminating TLS. The certificate ARNs are what the certificates reader joins on. */
  | { kind: "terminates-tls"; protocol: string; certificateArns: readonly string[]; sslPolicy: string | null }
  /** Plaintext, but every request is bounced to HTTPS. Not a finding. */
  | {
      kind: "redirects-to-https"
      protocol: string
      via: "default-action" | "rule"
      statusCode: string | null
      targetPort: string | null
    }
  /** THE FINDING: plaintext in, plaintext on, and nothing sends the caller to TLS. */
  | { kind: "plaintext-no-redirect"; protocol: string; why: string }
  /** Plaintext, and this engine could not read the rules that might redirect. */
  | { kind: "plaintext-redirect-unknown"; protocol: string; why: string }
  /** TCP / UDP / TCP_UDP on a network load balancer: TLS is not this layer's question. */
  | { kind: "not-http"; protocol: string }
  /** AWS returned a listener with no protocol. Not assumed to be anything. */
  | { kind: "unstated"; why: string }

/** Why a target is not being served, when AWS said why. */
export type HealthReason =
  /** `Target.ResponseCodeMismatch`, `Target.Timeout`, `Elb.RegistrationInProgress`, … */
  | { known: true; code: string; description: string }
  /**
   * AWS reported a non-healthy state with no reason code. The arm carries NO
   * `code` field, so a surface cannot print an empty string where an operator
   * expects the one token that decides where they go next.
   */
  | { known: false; why: string }

/**
 * What the load balancer thinks of one target.
 *
 * `healthy` is the ONLY arm that means a request will be routed here. Every
 * other AWS state — `initial`, `unhealthy`, `unused`, `draining`, `unavailable`
 * — lands in `not-serving` carrying AWS's own state string and its reason, so
 * "draining during a deploy" and "unhealthy in steady state" stay distinguishable
 * without this module deciding which of them an operator cares about.
 */
export type TargetHealthState =
  | { kind: "healthy" }
  | { kind: "not-serving"; state: string; reason: HealthReason }
  /** AWS returned a target description with no `TargetHealth.State` at all. */
  | { kind: "unstated"; why: string }

export interface TargetHealthReading {
  /** Instance id, IP or Lambda ARN, depending on the group's target type. */
  targetId: string
  port: number | null
  availabilityZone: string | null
  /** The port the health check itself used, which can differ from the traffic port. */
  healthCheckPort: string | null
  health: TargetHealthState
}

/** A target that is not being served, flattened for a finding to name. */
export interface NotServingTarget {
  targetId: string
  port: number | null
  /** AWS's own state string: `unhealthy`, `draining`, `initial`, `unused`, `unavailable`. */
  state: string
  /** `Target.ResponseCodeMismatch` etc., or null when AWS gave no reason code. */
  reasonCode: string | null
  description: string
}

/** The health-check configuration a target group applies. Nulls are absences, not zeros. */
export interface HealthCheckConfig {
  enabled: boolean | null
  protocol: string | null
  port: string | null
  path: string | null
  intervalSeconds: number | null
  timeoutSeconds: number | null
  healthyThreshold: number | null
  unhealthyThreshold: number | null
  /** The status codes counted as healthy — `"200"` in this estate. */
  matcher: string | null
}

/**
 * Whether anything is actually being served out of a target group.
 *
 * Derived from the health read and careful about every claim. `no-targets` is
 * separate from `none-serving`: nothing registered at all is a different
 * incident from targets registered and every one refused, and `unknown` never
 * pretends to be either.
 */
export type ServingState =
  | { kind: "unknown"; why: string }
  /** `DescribeTargetHealth` succeeded and returned nothing. No task is registered. */
  | { kind: "no-targets"; why: string }
  | { kind: "all-serving"; healthy: number }
  | { kind: "degraded"; healthy: number; notServing: readonly NotServingTarget[] }
  /** Registered targets, and the load balancer will route to none of them. */
  | { kind: "none-serving"; notServing: readonly NotServingTarget[] }

/**
 * Which tenant a resource belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and it can be denied, throttled or broken. A
 * load balancer whose tags were never read must not render as "unattributable —
 * missing tenure:tenant", because that sentence sends an operator to add a tag
 * that is probably already there.
 */
export type LoadBalancerAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

export interface TargetGroupReading {
  arn: string
  name: string | null
  protocol: string | null
  port: number | null
  vpcId: string | null
  targetType: string | null
  protocolVersion: string | null
  /** Every load balancer this group is attached to, as AWS reported it. */
  loadBalancerArns: readonly string[]
  healthCheck: HealthCheckConfig
  attribution: LoadBalancerAttribution
  /** Its own reading, so a refused health call does not collapse the row. */
  health: AwsRead<readonly TargetHealthReading[]>
  /** Derived from `health`, and never claiming more than it says. */
  serving: ServingState
  /** `TARGET_HEALTH_TTL_MS`, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/**
 * A certificate AWS reported on a listener.
 *
 * `isDefault` is `boolean | null` and not `boolean`, because `DescribeListeners`
 * returns the listener's DEFAULT certificate and omits the flag on it. Reading
 * an omitted flag as `false` would report the estate's only certificate as an
 * SNI extra; reading it as `true` would do the same in reverse the day AWS
 * starts returning more. Null is "AWS did not say", which is the truth.
 */
export interface ListenerCertificateBinding {
  arn: string
  isDefault: boolean | null
}

export interface ListenerReading {
  arn: string
  loadBalancerArn: string
  port: number | null
  protocol: string | null
  tls: TlsPosture
  /** Certificates bound to this listener. Empty for a plaintext listener. */
  certificates: readonly ListenerCertificateBinding[]
  sslPolicy: string | null
  /** `forward` / `redirect` / `fixed-response` / `authenticate-cognito` / … */
  defaultActionTypes: readonly string[]
  /** Target groups the default action forwards to. */
  forwardsTo: readonly string[]
  refreshMs: number
  asOf: string
}

export interface LoadBalancerReading {
  arn: string
  name: string | null
  /** `application`, `network` or `gateway`, as AWS said. Never inferred from the name. */
  type: string | null
  scheme: LoadBalancerScheme
  dnsName: string | null
  vpcId: string | null
  /** `active`, `provisioning`, `active_impaired`, `failed`. */
  stateCode: string | null
  stateReason: string | null
  availabilityZones: readonly string[]
  subnetIds: readonly string[]
  securityGroupIds: readonly string[]
  ipAddressType: string | null
  createdAt: string | null
  /** From this load balancer's own ARN, else from the resolved identity. Never a literal. */
  region: string | null
  partition: string | null
  accountId: string | null
  attribution: LoadBalancerAttribution
  /** Its own reading. A denied `DescribeListeners` does not blank the row. */
  listeners: AwsRead<readonly ListenerReading[]>
  /** Its own reading, independently. */
  targetGroups: AwsRead<readonly TargetGroupReading[]>
  refreshMs: number
  asOf: string
}

/**
 * Something an operator has to act on.
 *
 * Every arm carries the ARNs it is about, so a surface can link, and a `why`
 * sentence, so a surface need not compose one and two surfaces cannot compose
 * different ones. `health-unreadable` is a finding in its own right: not being
 * able to see whether the estate is serving traffic IS the incident when it
 * happens.
 */
export type LoadBalancerFinding =
  | {
      kind: "plaintext-listener"
      loadBalancerArn: string
      listenerArn: string
      port: number | null
      scheme: LoadBalancerScheme
      why: string
    }
  | { kind: "redirect-unknown"; loadBalancerArn: string; listenerArn: string; port: number | null; why: string }
  | { kind: "no-targets"; loadBalancerArn: string; targetGroupArn: string; why: string }
  | {
      kind: "none-serving"
      loadBalancerArn: string
      targetGroupArn: string
      notServing: readonly NotServingTarget[]
      why: string
    }
  | {
      kind: "targets-not-serving"
      loadBalancerArn: string
      targetGroupArn: string
      healthy: number
      notServing: readonly NotServingTarget[]
      why: string
    }
  | { kind: "health-unreadable"; loadBalancerArn: string; targetGroupArn: string; why: string }
  | { kind: "listeners-unreadable"; loadBalancerArn: string; why: string }
  | { kind: "target-groups-unreadable"; loadBalancerArn: string; why: string }
  | { kind: "listing-truncated"; capability: Capability; pagesRead: number; why: string }

/** A live certificate binding, for the certificates reader to join an expiry against. */
export interface ListenerCertificate {
  certificateArn: string
  listenerArn: string
  loadBalancerArn: string
  loadBalancerName: string | null
  port: number | null
  protocol: string | null
  /**
   * Whether this is the listener's default certificate, `null` when
   * `DescribeListeners` did not say — which is the usual case, since it omits
   * `IsDefault` on the default certificate it returns.
   */
  isDefault: boolean | null
}

/** Everything a load balancer surface needs, in one load. */
export interface LoadBalancerReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The load balancers. DENIED here is a refused
   * `elasticloadbalancing:DescribeLoadBalancers` and is NEVER `[]` — an operator
   * reading "no load balancers" when the truth is "we were not allowed to look"
   * is the single most dangerous thing this surface can say.
   */
  loadBalancers: AwsRead<readonly LoadBalancerReading[]>
  findings: readonly LoadBalancerFinding[]
  /** Whether the listing walked to the end, or stopped at `MAX_PAGES`. */
  truncation: Truncation
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: {
    loadBalancers: number
    listeners: number
    targetGroups: number
    targetHealth: number
    rules: number
  }
}

/* --------------------------------------------------------------- helpers -- */

/** An ARN's parts, when it is one. Used for region, partition and account only. */
function arnParts(arn: string): { partition: string; region: string; accountId: string } | null {
  const parts = arn.split(":")
  if (parts.length < 6 || parts[0] !== "arn") return null
  const [, partition, , region, accountId] = parts
  if (!partition) return null
  return { partition, region: region || "", accountId: accountId || "" }
}

/** An AWS timestamp, which the SDK hands back as a Date and a fixture as a string. */
function isoOrNull(value: string | Date | undefined): string | null {
  if (value === undefined || value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

/** Run `fn` over `items` with at most `limit` in flight. Order is preserved. */
async function mapWithLimit<A, B>(
  items: readonly A[],
  limit: number,
  fn: (item: A, index: number) => Promise<B>,
): Promise<B[]> {
  const out: B[] = new Array(items.length)
  for (let start = 0; start < items.length; start += limit) {
    const batch = items.slice(start, start + limit)
    const done = await Promise.all(batch.map((item, offset) => fn(item, start + offset)))
    for (let i = 0; i < done.length; i += 1) out[start + i] = done[i]
  }
  return out
}

/**
 * Walk a paged Describe to completion, or to `MAX_PAGES` and say so.
 *
 * The truncation is RETURNED, not thrown and not swallowed. Throwing would make
 * a partially-read estate render as ERROR, which hides the load balancers that
 * were read; swallowing would render a partial list as if it were the estate,
 * which is the failure this whole read plane is built against.
 */
async function pageThrough<T>(
  gw: AwsGateway,
  capability: Capability,
  input: Record<string, unknown>,
  extract: (response: unknown) => { items: readonly T[]; nextMarker: string | undefined },
): Promise<{ items: T[]; truncation: Truncation }> {
  const items: T[] = []
  let marker: string | undefined
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await gw.call(capability, { ...input, Marker: marker })
    const { items: got, nextMarker } = extract(response)
    for (const item of got) items.push(item)
    marker = nextMarker || undefined
    if (!marker) return { items, truncation: { kind: "complete" } }
    if (page === MAX_PAGES) {
      return {
        items,
        truncation: {
          kind: "truncated",
          capability,
          pagesRead: page,
          why:
            `${capability} still had pages after ${MAX_PAGES}. ${items.length} were read and ` +
            `there are more — this is not the whole estate, and it is not being rendered as if ` +
            `it were.`,
        },
      }
    }
  }
  /* istanbul ignore next — the loop returns on every path above. */
  return { items, truncation: { kind: "complete" } }
}

/**
 * A sub-read's page bound, which is unreachable in AWS and still not silent.
 *
 * ELB quotas cap listeners per load balancer at 50 and rules per listener at
 * 100, so a `MAX_PAGES` walk at 400 per page cannot truncate these in a real
 * account. If it ever does, the sub-read becomes ERROR carrying the sentence,
 * which degrades that ONE row — rather than rendering a partial listener list as
 * if it were the whole front door.
 */
function refuseTruncated(truncation: Truncation): void {
  if (truncation.kind === "truncated") throw new Error(truncation.why)
}

/* --------------------------------------------------------------- parsing -- */

export function parseScheme(raw: string | undefined): LoadBalancerScheme {
  if (raw === "internet-facing") return { kind: "internet-facing" }
  if (raw === "internal") return { kind: "internal" }
  return {
    kind: "unstated",
    raw: stringOrNull(raw),
    why:
      `elasticloadbalancing:DescribeLoadBalancers returned Scheme=${JSON.stringify(raw ?? null)}, ` +
      `which is neither internet-facing nor internal. Whether this load balancer answers the ` +
      `internet is unknown, and defaulting it to "internal" would be a reassuring guess.`,
  }
}

/** Whether an action is a redirect that lands on HTTPS. `HTTPS` is AWS's own spelling. */
function redirectToHttps(action: ActionShape | undefined): RedirectConfigShape | null {
  if (!action || action.Type !== "redirect") return null
  const config = action.RedirectConfig
  if (!config) return null
  // `#{protocol}` is the AWS placeholder meaning "keep the incoming protocol",
  // which on an HTTP listener redirects HTTP to HTTP. It is not a fix.
  return config.Protocol === "HTTPS" ? config : null
}

/**
 * What a listener does about TLS, from the listener alone.
 *
 * Returns `plaintext-redirect-unknown` for a plaintext listener with no redirect
 * in its default action: the rules have not been consulted yet, and this
 * function does not get to decide the finding on their behalf.
 * `refineWithRules` replaces it once the rules read has answered.
 */
export function tlsPostureOf(listener: {
  Protocol?: string
  SslPolicy?: string
  Certificates?: Array<{ CertificateArn?: string; IsDefault?: boolean }>
  DefaultActions?: ActionShape[]
}): TlsPosture {
  const protocol = stringOrNull(listener.Protocol)
  if (!protocol) {
    return {
      kind: "unstated",
      why:
        "elasticloadbalancing:DescribeListeners returned a listener with no Protocol. Whether it " +
        "serves plaintext is unknown, and this engine will not assume either answer.",
    }
  }

  if (protocol === "HTTPS" || protocol === "TLS") {
    const certificateArns = (listener.Certificates ?? [])
      .map((c) => stringOrNull(c.CertificateArn))
      .filter((arn): arn is string => arn !== null)
    return {
      kind: "terminates-tls",
      protocol,
      certificateArns,
      sslPolicy: stringOrNull(listener.SslPolicy),
    }
  }

  if (protocol !== "HTTP") return { kind: "not-http", protocol }

  for (const action of listener.DefaultActions ?? []) {
    const redirect = redirectToHttps(action)
    if (redirect) {
      return {
        kind: "redirects-to-https",
        protocol,
        via: "default-action",
        statusCode: stringOrNull(redirect.StatusCode),
        targetPort: stringOrNull(redirect.Port),
      }
    }
  }

  return {
    kind: "plaintext-redirect-unknown",
    protocol,
    why:
      "this listener speaks HTTP and its default action is not a redirect to HTTPS. A redirect " +
      "may still be configured in a listener rule, which is a separate read.",
  }
}

/**
 * Fold a rules reading into a provisional plaintext posture.
 *
 * Only ever called for a listener already at `plaintext-redirect-unknown`. A
 * rules read that was DENIED, THROTTLED or broken leaves the posture UNKNOWN and
 * does NOT promote it to the finding, because a redirect this engine could not
 * look for is not a redirect this engine established the absence of.
 */
export function refineWithRules(
  provisional: TlsPosture,
  rules: AwsRead<readonly { redirectsToHttps: RedirectConfigShape | null }[]>,
): TlsPosture {
  if (provisional.kind !== "plaintext-redirect-unknown") return provisional

  if (rules.state === "ACTUAL" || rules.state === "STALE") {
    for (const rule of rules.value) {
      if (rule.redirectsToHttps) {
        return {
          kind: "redirects-to-https",
          protocol: provisional.protocol,
          via: "rule",
          statusCode: stringOrNull(rule.redirectsToHttps.StatusCode),
          targetPort: stringOrNull(rule.redirectsToHttps.Port),
        }
      }
    }
  }

  if (rules.state === "ACTUAL" || rules.state === "STALE" || rules.state === "EMPTY") {
    return {
      kind: "plaintext-no-redirect",
      protocol: provisional.protocol,
      why:
        "this listener speaks HTTP, its default action is not a redirect to HTTPS, and no listener " +
        "rule redirects to HTTPS either. Anything that reaches this listener directly is served " +
        "in plaintext.",
    }
  }

  return {
    kind: "plaintext-redirect-unknown",
    protocol: provisional.protocol,
    why:
      `this listener speaks HTTP and its default action is not a redirect to HTTPS. Whether a ` +
      `listener RULE redirects could not be established — ${describeRead(rules, "the listener rules")}`,
  }
}

/** One target description, with a reason an operator can act on. */
export function parseTargetHealth(description: {
  Target?: { Id?: string; Port?: number; AvailabilityZone?: string }
  HealthCheckPort?: string
  TargetHealth?: { State?: string; Reason?: string; Description?: string }
}): TargetHealthReading | null {
  const targetId = stringOrNull(description.Target?.Id)
  if (!targetId) return null

  const state = stringOrNull(description.TargetHealth?.State)
  const port = numberOrNull(description.Target?.Port)

  let health: TargetHealthState
  if (state === null) {
    health = {
      kind: "unstated",
      why:
        `elasticloadbalancing:DescribeTargetHealth returned target ${targetId} with no ` +
        `TargetHealth.State. Whether the load balancer will route to it is unknown; it is not ` +
        `being counted as healthy.`,
    }
  } else if (state === "healthy") {
    health = { kind: "healthy" }
  } else {
    const code = stringOrNull(description.TargetHealth?.Reason)
    const text = stringOrNull(description.TargetHealth?.Description)
    health = {
      kind: "not-serving",
      state,
      reason:
        code === null
          ? {
              known: false,
              why:
                `AWS reported target ${targetId} as ${state} with no Reason code. ` +
                `Target.ResponseCodeMismatch and Target.Timeout send an operator to completely ` +
                `different places, and neither can be claimed here.`,
            }
          : { known: true, code, description: text ?? "" },
    }
  }

  return {
    targetId,
    port,
    availabilityZone: stringOrNull(description.Target?.AvailabilityZone),
    healthCheckPort: stringOrNull(description.HealthCheckPort),
    health,
  }
}

/** The not-serving targets, flattened so a finding can name them. */
export function notServing(targets: readonly TargetHealthReading[]): NotServingTarget[] {
  const out: NotServingTarget[] = []
  for (const target of targets) {
    if (target.health.kind === "healthy") continue
    if (target.health.kind === "unstated") {
      out.push({
        targetId: target.targetId,
        port: target.port,
        state: "unstated",
        reasonCode: null,
        description: target.health.why,
      })
      continue
    }
    const reason = target.health.reason
    out.push({
      targetId: target.targetId,
      port: target.port,
      state: target.health.state,
      reasonCode: reason.known ? reason.code : null,
      description: reason.known ? reason.description : reason.why,
    })
  }
  return out
}

/**
 * Whether anything is being served, derived from the health reading.
 *
 * Every non-value state maps to `unknown` carrying the one renderer's sentence.
 * There is no branch here that turns a refusal into a count.
 */
export function servingStateOf(health: AwsRead<readonly TargetHealthReading[]>): ServingState {
  if (health.state === "EMPTY") {
    return {
      kind: "no-targets",
      why:
        "elasticloadbalancing:DescribeTargetHealth answered and this target group has no " +
        "registered targets. Nothing is being served out of it — which is not the same as its " +
        "targets being unhealthy, and not the same as the call having been refused.",
    }
  }
  if (health.state !== "ACTUAL" && health.state !== "STALE") {
    return { kind: "unknown", why: describeRead(health, "this target group's target health") }
  }

  const healthy = health.value.filter((t) => t.health.kind === "healthy").length
  const bad = notServing(health.value)
  if (bad.length === 0) return { kind: "all-serving", healthy }
  if (healthy === 0) return { kind: "none-serving", notServing: bad }
  return { kind: "degraded", healthy, notServing: bad }
}

/* --------------------------------------------------------- the sub-reads -- */

function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): LoadBalancerAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this resource's tags were not read — ${describeRead(tagged, "the tag index")}`,
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
  // The Resource Groups Tagging API returns resources that HAVE tags, so an
  // absence from the index means no tags at all, which is what `unattributed`
  // says. It is an observation, not a failure.
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

async function readListenerRules(
  gw: AwsGateway,
  listenerArn: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<readonly { redirectsToHttps: RedirectConfigShape | null }[]>> {
  return readAws<readonly { redirectsToHttps: RedirectConfigShape | null }[]>(
    "elasticloadbalancing:DescribeRules",
    async () => {
      const { items, truncation } = await pageThrough<{
        redirectsToHttps: RedirectConfigShape | null
      }>(
        gw,
        "elasticloadbalancing:DescribeRules",
        { ListenerArn: listenerArn },
        (response) => {
          const typed = response as DescribeRulesResponse | null
          return {
            items: (typed?.Rules ?? []).map((rule) => {
              let redirect: RedirectConfigShape | null = null
              for (const action of rule.Actions ?? []) {
                const found = redirectToHttps(action)
                if (found) {
                  redirect = found
                  break
                }
              }
              return { redirectsToHttps: redirect }
            }),
            nextMarker: typed?.NextMarker,
          }
        },
      )
      refuseTruncated(truncation)
      return items
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

async function readListeners(
  gw: AwsGateway,
  loadBalancerArn: string,
  options: { now: () => Date; denial: DenialContext; asOf: string; ruleBudget: () => boolean },
): Promise<AwsRead<readonly ListenerReading[]>> {
  const listed = await readAws<
    readonly {
      reading: ListenerReading
      needsRules: boolean
    }[]
  >(
    "elasticloadbalancing:DescribeListeners",
    async () => {
      const { items, truncation } = await pageThrough<{
        reading: ListenerReading
        needsRules: boolean
      }>(
        gw,
        "elasticloadbalancing:DescribeListeners",
        { LoadBalancerArn: loadBalancerArn },
        (response) => {
          const typed = response as DescribeListenersResponse | null
          const out: Array<{ reading: ListenerReading; needsRules: boolean }> = []
          for (const listener of typed?.Listeners ?? []) {
            const arn = stringOrNull(listener.ListenerArn)
            if (!arn) continue
            const tls = tlsPostureOf(listener)
            out.push({
              reading: {
                arn,
                loadBalancerArn: stringOrNull(listener.LoadBalancerArn) ?? loadBalancerArn,
                port: numberOrNull(listener.Port),
                protocol: stringOrNull(listener.Protocol),
                tls,
                certificates: (listener.Certificates ?? [])
                  .map((c) => ({
                    arn: stringOrNull(c.CertificateArn),
                    isDefault: booleanOrNull(c.IsDefault),
                  }))
                  .filter((c): c is ListenerCertificateBinding => c.arn !== null),
                sslPolicy: stringOrNull(listener.SslPolicy),
                defaultActionTypes: (listener.DefaultActions ?? [])
                  .map((a) => stringOrNull(a.Type))
                  .filter((t): t is string => t !== null),
                forwardsTo: (listener.DefaultActions ?? [])
                  .map((a) => stringOrNull(a.TargetGroupArn))
                  .filter((t): t is string => t !== null),
                refreshMs: CAPABILITIES["elasticloadbalancing:DescribeListeners"].refreshMs,
                asOf: options.asOf,
              },
              needsRules: tls.kind === "plaintext-redirect-unknown",
            })
          }
          return { items: out, nextMarker: typed?.NextMarker }
        },
      )
      refuseTruncated(truncation)
      return items
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )

  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast. After this narrowing the remaining arms carry no `value`, so they
    // ARE an `AwsRead<readonly ListenerReading[]>` — which is the one place an
    // empty array could otherwise have been smuggled in.
    return listed
  }

  const refined = await mapWithLimit(listed.value, CONCURRENCY, async ({ reading, needsRules }) => {
    if (!needsRules) return reading
    if (!options.ruleBudget()) {
      // Out of budget. The posture stays UNKNOWN — it is NOT promoted to the
      // finding, because a redirect this engine never looked for is not a
      // redirect this engine established the absence of.
      return reading
    }
    const rules = await readListenerRules(gw, reading.arn, options)
    return { ...reading, tls: refineWithRules(reading.tls, rules) }
  })

  return { ...listed, value: refined }
}

async function readTargetHealth(
  gw: AwsGateway,
  targetGroupArn: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<readonly TargetHealthReading[]>> {
  return readAws<readonly TargetHealthReading[]>(
    "elasticloadbalancing:DescribeTargetHealth",
    async () => {
      // Not paginated: DescribeTargetHealth returns every registered target.
      const response = (await gw.call("elasticloadbalancing:DescribeTargetHealth", {
        TargetGroupArn: targetGroupArn,
      })) as DescribeTargetHealthResponse | null
      const out: TargetHealthReading[] = []
      for (const description of response?.TargetHealthDescriptions ?? []) {
        const parsed = parseTargetHealth(description)
        if (parsed) out.push(parsed)
      }
      // Sorted so two loads of the same target group produce the same order and a
      // diff of two screenshots is readable. AWS promises no order here.
      return out.sort((a, b) => a.targetId.localeCompare(b.targetId))
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

async function readTargetGroups(
  gw: AwsGateway,
  loadBalancerArn: string,
  options: {
    now: () => Date
    denial: DenialContext
    asOf: string
    tagged: AwsRead<readonly TaggedResource[]>
    index: Map<string, Readonly<Record<string, string>>>
    healthBudget: () => boolean
  },
): Promise<AwsRead<readonly TargetGroupReading[]>> {
  interface Bare {
    arn: string
    name: string | null
    protocol: string | null
    port: number | null
    vpcId: string | null
    targetType: string | null
    protocolVersion: string | null
    loadBalancerArns: readonly string[]
    healthCheck: HealthCheckConfig
  }

  const listed = await readAws<readonly Bare[]>(
    "elasticloadbalancing:DescribeTargetGroups",
    async () => {
      const { items, truncation } = await pageThrough<Bare>(
        gw,
        "elasticloadbalancing:DescribeTargetGroups",
        { LoadBalancerArn: loadBalancerArn },
        (response) => {
          const typed = response as DescribeTargetGroupsResponse | null
          const out: Bare[] = []
          for (const group of typed?.TargetGroups ?? []) {
            const arn = stringOrNull(group.TargetGroupArn)
            if (!arn) continue
            out.push({
              arn,
              name: stringOrNull(group.TargetGroupName),
              protocol: stringOrNull(group.Protocol),
              port: numberOrNull(group.Port),
              vpcId: stringOrNull(group.VpcId),
              targetType: stringOrNull(group.TargetType),
              protocolVersion: stringOrNull(group.ProtocolVersion),
              loadBalancerArns: (group.LoadBalancerArns ?? []).filter(
                (a): a is string => typeof a === "string" && a !== "",
              ),
              healthCheck: {
                enabled: booleanOrNull(group.HealthCheckEnabled),
                protocol: stringOrNull(group.HealthCheckProtocol),
                port: stringOrNull(group.HealthCheckPort),
                path: stringOrNull(group.HealthCheckPath),
                intervalSeconds: numberOrNull(group.HealthCheckIntervalSeconds),
                timeoutSeconds: numberOrNull(group.HealthCheckTimeoutSeconds),
                healthyThreshold: numberOrNull(group.HealthyThresholdCount),
                unhealthyThreshold: numberOrNull(group.UnhealthyThresholdCount),
                matcher:
                  stringOrNull(group.Matcher?.HttpCode) ?? stringOrNull(group.Matcher?.GrpcCode),
              },
            })
          }
          return { items: out, nextMarker: typed?.NextMarker }
        },
      )
      refuseTruncated(truncation)
      return items
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )

  if (listed.state !== "ACTUAL" && listed.state !== "STALE") return listed

  const groups = await mapWithLimit(listed.value, CONCURRENCY, async (bare) => {
    const health: AwsRead<readonly TargetHealthReading[]> = options.healthBudget()
      ? await readTargetHealth(gw, bare.arn, options)
      : {
          state: "UNCONFIGURED",
          capability: "elasticloadbalancing:DescribeTargetHealth",
          why:
            `this engine reads at most ${MAX_TARGET_HEALTH_READS} target-group health calls per ` +
            `load and that budget is spent. This target group's health was NOT read — which is ` +
            `not the same as its targets being healthy, and not the same as its having none.`,
        }
    const reading: TargetGroupReading = {
      ...bare,
      attribution: attributionFor(bare.arn, options.tagged, options.index),
      health,
      serving: servingStateOf(health),
      refreshMs: CAPABILITIES["elasticloadbalancing:DescribeTargetHealth"].refreshMs,
      asOf: options.asOf,
    }
    return reading
  })

  return { ...listed, value: groups }
}

/* ----------------------------------------------------------- the surface -- */

/**
 * Every load balancer the estate owns, its listeners, its target groups and
 * whether anything is actually being served.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function loadBalancerReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<LoadBalancerReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const refreshMs = {
    loadBalancers: CAPABILITIES["elasticloadbalancing:DescribeLoadBalancers"].refreshMs,
    listeners: CAPABILITIES["elasticloadbalancing:DescribeListeners"].refreshMs,
    targetGroups: CAPABILITIES["elasticloadbalancing:DescribeTargetGroups"].refreshMs,
    targetHealth: CAPABILITIES["elasticloadbalancing:DescribeTargetHealth"].refreshMs,
    rules: CAPABILITIES["elasticloadbalancing:DescribeRules"].refreshMs,
  }

  interface BareLb {
    arn: string
    name: string | null
    type: string | null
    scheme: LoadBalancerScheme
    dnsName: string | null
    vpcId: string | null
    stateCode: string | null
    stateReason: string | null
    availabilityZones: readonly string[]
    subnetIds: readonly string[]
    securityGroupIds: readonly string[]
    ipAddressType: string | null
    createdAt: string | null
  }

  // Reset per attempt, so a throttle retry inside `readAws` cannot leave a
  // truncation flag behind from a page walk that was abandoned.
  let truncation: Truncation = { kind: "complete" }

  const listed = await readAws<readonly BareLb[]>(
    "elasticloadbalancing:DescribeLoadBalancers",
    async () => {
      truncation = { kind: "complete" }
      const walked = await pageThrough<BareLb>(
        gw,
        "elasticloadbalancing:DescribeLoadBalancers",
        {},
        (response) => {
          const typed = response as DescribeLoadBalancersResponse | null
          const out: BareLb[] = []
          for (const lb of typed?.LoadBalancers ?? []) {
            const arn = stringOrNull(lb.LoadBalancerArn)
            if (!arn) continue
            const zones = lb.AvailabilityZones ?? []
            out.push({
              arn,
              name: stringOrNull(lb.LoadBalancerName),
              type: stringOrNull(lb.Type),
              scheme: parseScheme(lb.Scheme),
              dnsName: stringOrNull(lb.DNSName),
              vpcId: stringOrNull(lb.VpcId),
              stateCode: stringOrNull(lb.State?.Code),
              stateReason: stringOrNull(lb.State?.Reason),
              availabilityZones: zones
                .map((z) => stringOrNull(z.ZoneName))
                .filter((z): z is string => z !== null),
              subnetIds: zones
                .map((z) => stringOrNull(z.SubnetId))
                .filter((z): z is string => z !== null),
              securityGroupIds: (lb.SecurityGroups ?? []).filter(
                (g): g is string => typeof g === "string" && g !== "",
              ),
              ipAddressType: stringOrNull(lb.IpAddressType),
              createdAt: isoOrNull(lb.CreatedTime),
            })
          }
          return { items: out, nextMarker: typed?.NextMarker }
        },
      )
      truncation = walked.truncation
      // Sorted by ARN so two loads of the same estate render in the same order.
      return walked.items.sort((a, b) => a.arn.localeCompare(b.arn))
    },
    { now, denial, ...RETRY },
  )

  const asOf = now().toISOString()

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. There
  // is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    const loadBalancers: AwsRead<readonly LoadBalancerReading[]> = listed
    return {
      identity,
      tagged,
      loadBalancers,
      findings: loadBalancerFindings(loadBalancers, truncation),
      truncation,
      asOf,
      refreshMs,
    }
  }

  // Budgets are shared across the whole load, not per load balancer, because the
  // throttle they protect is account-wide.
  let healthReadsLeft = MAX_TARGET_HEALTH_READS
  const healthBudget = (): boolean => {
    if (healthReadsLeft <= 0) return false
    healthReadsLeft -= 1
    return true
  }
  let ruleReadsLeft = MAX_RULE_READS
  const ruleBudget = (): boolean => {
    if (ruleReadsLeft <= 0) return false
    ruleReadsLeft -= 1
    return true
  }

  const readings = await mapWithLimit(listed.value, CONCURRENCY, async (bare, position) => {
    const parts = arnParts(bare.arn)
    const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"

    let listeners: AwsRead<readonly ListenerReading[]>
    let targetGroups: AwsRead<readonly TargetGroupReading[]>

    if (position >= MAX_DETAILED_LOAD_BALANCERS) {
      const why =
        `this engine reads details for at most ${MAX_DETAILED_LOAD_BALANCERS} load balancers per ` +
        `load and this is number ${position + 1} of ${listed.value.length}. Its listeners and ` +
        `target groups were NOT read — which is not the same as its having none.`
      listeners = {
        state: "UNCONFIGURED",
        capability: "elasticloadbalancing:DescribeListeners",
        why,
      }
      targetGroups = {
        state: "UNCONFIGURED",
        capability: "elasticloadbalancing:DescribeTargetGroups",
        why,
      }
    } else {
      // Both sub-reads run, and each fails on its own. One denied detail must not
      // collapse the row.
      ;[listeners, targetGroups] = await Promise.all([
        readListeners(gw, bare.arn, { now, denial, asOf, ruleBudget }),
        readTargetGroups(gw, bare.arn, { now, denial, asOf, tagged, index, healthBudget }),
      ])
    }

    const reading: LoadBalancerReading = {
      ...bare,
      // AWS's own ARN beats anything assembled; identity is the only fallback,
      // and there is no literal region and no "aws" partition default.
      partition: parts?.partition ?? (identityResolved ? identity.value.partition : null),
      region: parts?.region || (identityResolved ? identity.value.region : null),
      accountId: parts?.accountId || (identityResolved ? identity.value.accountId : null),
      attribution: attributionFor(bare.arn, tagged, index),
      listeners,
      targetGroups,
      refreshMs: refreshMs.loadBalancers,
      asOf,
    }
    return reading
  })

  const loadBalancers: AwsRead<readonly LoadBalancerReading[]> = { ...listed, value: readings }
  return {
    identity,
    tagged,
    loadBalancers,
    findings: loadBalancerFindings(loadBalancers, truncation),
    truncation,
    asOf,
    refreshMs,
  }
}

/* -------------------------------------------------------------- findings -- */

/**
 * What an operator has to act on.
 *
 * Exported and pure, so the derivation can be reasoned about on its own — but
 * `loadBalancerReadings` is the only production caller and the tests drive it
 * through there, not through here.
 */
export function loadBalancerFindings(
  loadBalancers: AwsRead<readonly LoadBalancerReading[]>,
  truncation: Truncation = { kind: "complete" },
): readonly LoadBalancerFinding[] {
  const findings: LoadBalancerFinding[] = []

  if (truncation.kind === "truncated") {
    findings.push({
      kind: "listing-truncated",
      capability: truncation.capability,
      pagesRead: truncation.pagesRead,
      why: truncation.why,
    })
  }

  if (loadBalancers.state !== "ACTUAL" && loadBalancers.state !== "STALE") return findings

  for (const lb of loadBalancers.value) {
    if (lb.listeners.state !== "ACTUAL" && lb.listeners.state !== "STALE") {
      if (lb.listeners.state !== "EMPTY") {
        findings.push({
          kind: "listeners-unreadable",
          loadBalancerArn: lb.arn,
          why: describeRead(lb.listeners, `${lb.name ?? lb.arn} listeners`),
        })
      }
    } else {
      for (const listener of lb.listeners.value) {
        if (listener.tls.kind === "plaintext-no-redirect") {
          findings.push({
            kind: "plaintext-listener",
            loadBalancerArn: lb.arn,
            listenerArn: listener.arn,
            port: listener.port,
            scheme: lb.scheme,
            why: listener.tls.why,
          })
        } else if (listener.tls.kind === "plaintext-redirect-unknown") {
          findings.push({
            kind: "redirect-unknown",
            loadBalancerArn: lb.arn,
            listenerArn: listener.arn,
            port: listener.port,
            why: listener.tls.why,
          })
        }
      }
    }

    if (lb.targetGroups.state !== "ACTUAL" && lb.targetGroups.state !== "STALE") {
      if (lb.targetGroups.state !== "EMPTY") {
        findings.push({
          kind: "target-groups-unreadable",
          loadBalancerArn: lb.arn,
          why: describeRead(lb.targetGroups, `${lb.name ?? lb.arn} target groups`),
        })
      }
      continue
    }

    for (const group of lb.targetGroups.value) {
      switch (group.serving.kind) {
        case "unknown":
          findings.push({
            kind: "health-unreadable",
            loadBalancerArn: lb.arn,
            targetGroupArn: group.arn,
            why: group.serving.why,
          })
          break
        case "no-targets":
          findings.push({
            kind: "no-targets",
            loadBalancerArn: lb.arn,
            targetGroupArn: group.arn,
            why: group.serving.why,
          })
          break
        case "none-serving":
          findings.push({
            kind: "none-serving",
            loadBalancerArn: lb.arn,
            targetGroupArn: group.arn,
            notServing: group.serving.notServing,
            why:
              `every registered target in ${group.name ?? group.arn} is refused by the load ` +
              `balancer. ECS may still report these tasks as RUNNING; no request is reaching them.`,
          })
          break
        case "degraded":
          findings.push({
            kind: "targets-not-serving",
            loadBalancerArn: lb.arn,
            targetGroupArn: group.arn,
            healthy: group.serving.healthy,
            notServing: group.serving.notServing,
            why:
              `${group.serving.notServing.length} of ${group.serving.healthy + group.serving.notServing.length} ` +
              `targets in ${group.name ?? group.arn} are not being served.`,
          })
          break
        case "all-serving":
          break
      }
    }
  }

  return findings
}

/**
 * Every certificate bound to a live listener.
 *
 * The join the certificates reader needs: an ACM certificate expiring in six
 * days matters enormously if a listener is serving it and not at all if it is
 * orphaned. Returns only what was actually read — a load balancer whose
 * listeners were refused contributes nothing here, which is why a caller must
 * also look at `findings` rather than treating an empty list as "no TLS".
 */
export function listenerCertificates(
  readings: LoadBalancerReadings,
): readonly ListenerCertificate[] {
  const out: ListenerCertificate[] = []
  const lbs = readings.loadBalancers
  if (lbs.state !== "ACTUAL" && lbs.state !== "STALE") return out

  for (const lb of lbs.value) {
    if (lb.listeners.state !== "ACTUAL" && lb.listeners.state !== "STALE") continue
    for (const listener of lb.listeners.value) {
      for (const certificate of listener.certificates) {
        out.push({
          certificateArn: certificate.arn,
          listenerArn: listener.arn,
          loadBalancerArn: lb.arn,
          loadBalancerName: lb.name,
          port: listener.port,
          protocol: listener.protocol,
          // Carried through from AWS, including its silence. Not inferred from
          // the position in the array — the order is not documented, and a
          // certificate reported as "default" because it happened to be first is
          // a claim this engine cannot stand behind.
          isDefault: certificate.isDefault,
        })
      }
    }
  }
  return out
}

/* ------------------------------------------------------------- rendering -- */

export function describeScheme(scheme: LoadBalancerScheme): string {
  switch (scheme.kind) {
    case "internet-facing":
      return "internet-facing"
    case "internal":
      return "internal"
    case "unstated":
      return `scheme unknown — ${scheme.why}`
  }
}

export function describeTlsPosture(tls: TlsPosture): string {
  switch (tls.kind) {
    case "terminates-tls":
      return (
        `${tls.protocol}, terminating TLS with ` +
        `${tls.certificateArns.length} certificate(s)` +
        `${tls.certificateArns.length > 0 ? ` (${tls.certificateArns.join(", ")})` : ""}` +
        `${tls.sslPolicy ? ` under policy ${tls.sslPolicy}` : ""}`
      )
    case "redirects-to-https":
      return (
        `${tls.protocol}, redirecting to HTTPS via its ${tls.via}` +
        `${tls.statusCode ? ` (${tls.statusCode})` : ""}` +
        `${tls.targetPort ? ` on port ${tls.targetPort}` : ""}`
      )
    case "plaintext-no-redirect":
      return `PLAINTEXT — ${tls.why}`
    case "plaintext-redirect-unknown":
      return `plaintext, redirect unknown — ${tls.why}`
    case "not-http":
      return `${tls.protocol} — not an HTTP listener, so an HTTPS redirect is not the question`
    case "unstated":
      return `protocol unknown — ${tls.why}`
  }
}

export function describeTargetHealth(target: TargetHealthReading): string {
  const where = `${target.targetId}${target.port === null ? "" : `:${target.port}`}`
  switch (target.health.kind) {
    case "healthy":
      return `${where} — healthy`
    case "unstated":
      return `${where} — state unknown: ${target.health.why}`
    case "not-serving": {
      const reason = target.health.reason
      return reason.known
        ? `${where} — ${target.health.state}: ${reason.code}${reason.description ? ` (${reason.description})` : ""}`
        : `${where} — ${target.health.state}, no reason code: ${reason.why}`
    }
  }
}

export function describeServingState(serving: ServingState): string {
  switch (serving.kind) {
    case "unknown":
      return `serving unknown — ${serving.why}`
    case "no-targets":
      return `no registered targets — ${serving.why}`
    case "all-serving":
      return `${serving.healthy} target(s) healthy and being served`
    case "degraded":
      return (
        `DEGRADED — ${serving.healthy} healthy, ${serving.notServing.length} not served: ` +
        serving.notServing
          .map(
            (t) =>
              `${t.targetId} ${t.state}${t.reasonCode ? ` ${t.reasonCode}` : " (no reason code)"}` +
              `${t.description ? ` — ${t.description}` : ""}`,
          )
          .join("; ")
      )
    case "none-serving":
      return (
        `NOTHING SERVED — all ${serving.notServing.length} registered target(s) refused: ` +
        serving.notServing
          .map(
            (t) =>
              `${t.targetId} ${t.state}${t.reasonCode ? ` ${t.reasonCode}` : " (no reason code)"}` +
              `${t.description ? ` — ${t.description}` : ""}`,
          )
          .join("; ")
      )
  }
}

export function describeLoadBalancerAttribution(attribution: LoadBalancerAttribution): string {
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

export function describeFinding(finding: LoadBalancerFinding): string {
  switch (finding.kind) {
    case "plaintext-listener":
      return (
        `PLAINTEXT LISTENER — ${finding.listenerArn}` +
        `${finding.port === null ? "" : ` on port ${finding.port}`} of an ` +
        `${describeScheme(finding.scheme)} load balancer. ${finding.why}`
      )
    case "redirect-unknown":
      return `redirect unknown — ${finding.listenerArn}: ${finding.why}`
    case "no-targets":
      return `NO REGISTERED TARGETS — ${finding.targetGroupArn}. ${finding.why}`
    case "none-serving":
      return `NOTHING SERVED — ${finding.targetGroupArn}. ${finding.why}`
    case "targets-not-serving":
      return `DEGRADED — ${finding.targetGroupArn}. ${finding.why}`
    case "health-unreadable":
      return `target health unreadable — ${finding.targetGroupArn}: ${finding.why}`
    case "listeners-unreadable":
      return `listeners unreadable — ${finding.loadBalancerArn}: ${finding.why}`
    case "target-groups-unreadable":
      return `target groups unreadable — ${finding.loadBalancerArn}: ${finding.why}`
    case "listing-truncated":
      return `TRUNCATED — ${finding.why}`
  }
}

/** The sentence a surface prints for one load balancer. One funnel, so states cannot drift. */
export function describeLoadBalancer(lb: LoadBalancerReading): string {
  const where =
    lb.region && lb.partition
      ? `${lb.region} (partition ${lb.partition})`
      : "region unknown — identity is unresolved and the ARN did not carry one"
  const head =
    `${lb.name ?? lb.arn} — ${lb.type ?? "type unstated"}, ${describeScheme(lb.scheme)} — ` +
    `${where} — ${describeLoadBalancerAttribution(lb.attribution)} — ` +
    `state ${lb.stateCode ?? "unstated"}`

  const listenerText =
    lb.listeners.state === "ACTUAL" || lb.listeners.state === "STALE"
      ? lb.listeners.value
          .map((l) => `:${l.port ?? "?"} ${describeTlsPosture(l.tls)}`)
          .join(" · ")
      : describeRead(lb.listeners, `${lb.name ?? lb.arn} listeners`)

  const groupText =
    lb.targetGroups.state === "ACTUAL" || lb.targetGroups.state === "STALE"
      ? lb.targetGroups.value
          .map((g) => `${g.name ?? g.arn}: ${describeServingState(g.serving)}`)
          .join(" · ")
      : describeRead(lb.targetGroups, `${lb.name ?? lb.arn} target groups`)

  return (
    `${head}\n  listeners: ${listenerText}\n  targets: ${groupText}\n  ` +
    `as of ${lb.asOf}, refreshed every ${Math.round(lb.refreshMs / 1000)}s ` +
    `(target health every ${Math.round(CAPABILITIES["elasticloadbalancing:DescribeTargetHealth"].refreshMs / 1000)}s)`
  )
}

export interface LoadBalancerLine {
  label: string
  text: string
}

/**
 * What a load balancer surface prints.
 *
 * The surface agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function loadBalancerLines(readings: LoadBalancerReadings): readonly LoadBalancerLine[] {
  const lines: LoadBalancerLine[] = [
    {
      label: "Load balancers",
      text: describeRead(
        readings.loadBalancers,
        `load balancers read from AWS, refreshed every ` +
          `${Math.round(readings.refreshMs.loadBalancers / 1000)}s`,
      ),
    },
  ]

  if (readings.loadBalancers.state === "ACTUAL" || readings.loadBalancers.state === "STALE") {
    for (const lb of readings.loadBalancers.value) {
      lines.push({ label: lb.name ?? lb.arn, text: describeLoadBalancer(lb) })
    }
  }

  lines.push({
    label: "Findings",
    text:
      readings.findings.length === 0
        ? "no load balancer findings from what was read"
        : readings.findings.map(describeFinding).join("\n"),
  })

  return lines
}
