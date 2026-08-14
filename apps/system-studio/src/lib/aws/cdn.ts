/**
 * STUDIO-070-004 (CDN / CloudFront) — the edge is the perimeter, and the console
 * could not see it.
 *
 * `infrastructure/terraform/cloudfront.tf` and `infrastructure/studio/cloudfront.tf`
 * each create a distribution, and the only CloudFront call this engine ever made
 * was `ListDistributions` inside `inventory.ts` — which returns an id, a status
 * and an origin domain name. None of those is where a defect lives. The
 * configuration is:
 *
 *   - `origin_protocol_policy = "http-only"` on BOTH distributions. Every byte
 *     between the edge and the load balancer crosses the network in plaintext.
 *     That is a real line in this repository, not a hypothetical.
 *   - `# web_acl_id = aws_wafv2_web_acl.main.arn` — commented out. The pilot's
 *     distribution has no web ACL, and the summary form of the read cannot say so.
 *   - `minimum_protocol_version = "TLSv1"` on the Studio's own distribution,
 *     against `TLSv1.2_2021` on the pilot's. One of those two floors admits
 *     protocol versions with known attacks against them, and only the config read
 *     can tell you which.
 *   - no `logging_config` on either, so there is no access log to read after an
 *     incident.
 *
 * So this module reads `GetDistributionConfig` for every distribution, and it
 * reads `ListInvalidations` because "the deploy went out but I do not see my
 * change" is, in this estate, almost always an invalidation still `InProgress`.
 *
 * ## Three capabilities, three readings, and they fail apart
 *
 * `cloudfront:ListDistributions`, `cloudfront:GetDistributionConfig` and
 * `cloudfront:ListInvalidations` are three IAM actions and a role is routinely
 * granted the first without the other two — the first is `Resource: "*"`, the
 * other two are scoped to `distribution/*`. Folding them would make a refused
 * `GetDistributionConfig` render as "refused cloudfront:ListDistributions", so
 * the statement an operator pastes into a policy would not contain the action
 * that is actually missing: they would grant it, redeploy, and be refused
 * identically. `retained.ts` paid for that lesson once already.
 *
 * So the listing is one `AwsRead`, and EVERY distribution carries its own
 * `AwsRead` for its config and another for its invalidations. A distribution
 * whose config was refused still appears in the list, saying it was refused —
 * and critically, its TLS floor, its WAF association and its origin protocol
 * render as "not read", never as the reassuring default. A row that said
 * "WAF: none" because the config read was denied would be this console
 * inventing a finding; a row that said "TLS: fine" would be it inventing a
 * clean bill. Both are worse than the honest blank.
 *
 * ## What this module cannot read, said out loud
 *
 * **A managed cache policy's TTLs are not readable here.** The Studio's own
 * distribution sets `cache_policy_id = "4135ea2d-…"` (AWS's `CachingDisabled`)
 * rather than the legacy `ForwardedValues`/`MinTTL`/`DefaultTTL`/`MaxTTL` fields.
 * `GetDistributionConfig` returns the policy ID and nothing else about it; the
 * TTLs are behind `cloudfront:GetCachePolicy`, which is NOT in the capability
 * registry and which this module does not get to add. So `CacheDisposition` has
 * a `managed-policy` arm that names the policy id and states that its TTLs were
 * not read. Reading a policy id as "cached" would be a guess, and reading it as
 * "bypass" would be a guess in the other direction — the id `4135ea2d-…` happens
 * to be CachingDisabled today, and a module that recognised magic UUIDs would be
 * asserting an AWS implementation detail as a fact about this estate.
 *
 * **Whether a web ACL actually blocks anything is not readable here.** The
 * config carries `WebACLId`; the rules inside it are `wafv2:GetWebACL`. So the
 * WAF reading says "associated" or "none" and never "protected".
 *
 * ## Pagination
 *
 * Bounded, and the bound is REPORTED. Both `ListDistributions` and
 * `ListInvalidations` are marker-paged. A reader that returned the first page
 * and stopped is the same lie as an empty list, and a reader with no bound is
 * how one page render becomes an unbounded loop against a shared throttle. So
 * every paged read carries a `Truncation` that says "that was all of them" or
 * "there were more, and this engine stopped".
 *
 * ## Region, partition and attribution
 *
 * CloudFront is a partition-GLOBAL service: `arn:aws:cloudfront::123456789012:distribution/E…`
 * carries an empty region field, by construction. So a distribution's `region` is
 * null and says why, and the `partition` comes from the ARN's second segment —
 * from AWS's own answer. When AWS returned no ARN the partition falls back to the
 * RESOLVED IDENTITY, never to a literal `"aws"`: GE-010-007 was a data-residency
 * defect caused by exactly that fallback, and a GovCloud console link built from
 * a guessed partition points at the commercial console.
 *
 * Attribution is `tags.ts` and the Resource Groups Tagging API, with a fourth
 * answer `unknown` for when the tag index itself could not be read — "we could
 * not look up this distribution's tags" is not "this distribution has no tenant
 * tag", and only the second is a finding somebody should act on.
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
 * How many `ListDistributions` pages to walk.
 *
 * CloudFront returns up to 100 per page, so this is two thousand distributions
 * before the listing is DECLARED truncated — never silently cut.
 */
export const MAX_DISTRIBUTION_PAGES = 20

/** How many `ListInvalidations` pages to walk per distribution. 100 per page. */
export const MAX_INVALIDATION_PAGES = 5

/**
 * How many distributions get a config and an invalidation read in one load.
 *
 * Both are one call per distribution against a CloudFront-wide throttle. The
 * estate has two distributions; the cap exists so an account that has grown two
 * hundred does not turn one page render into four hundred API calls.
 *
 * Distributions past the cap are NOT dropped and do not render as clean: they
 * carry an UNCONFIGURED config read whose `why` says the engine stopped, which
 * is a visibly different sentence from "this distribution has no findings".
 */
export const MAX_DISTRIBUTION_DEPTH_READS = 50

/** How many invalidations to carry per distribution, so a render is bounded. */
export const MAX_INVALIDATIONS_SAMPLED = 40

/** How many detail reads are in flight at once, so one load is not a burst. */
const DETAIL_CONCURRENCY = 4

/**
 * The retry schedule, taken from `throttle.ts` rather than retyped.
 *
 * Two modules disagreeing about how long a throttle waits is itself the defect;
 * `backoffMs(2)` is the pause after the first failure and `readAws` doubles it.
 */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  backoffMs: backoffMs(2),
}

/* ---------------------------------------------------------------- shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface ListDistributionsResponse {
  DistributionList?: {
    NextMarker?: string
    IsTruncated?: boolean
    Items?: Array<{
      Id?: string
      ARN?: string
      Status?: string
      DomainName?: string
      Enabled?: boolean
      Comment?: string
      Aliases?: { Items?: string[] }
      LastModifiedTime?: string | Date
    }>
  }
}

interface ForwardedValuesShape {
  QueryString?: boolean
  Cookies?: { Forward?: string; WhitelistedNames?: { Items?: string[] } }
  Headers?: { Items?: string[] }
}

interface CacheBehaviourShape {
  PathPattern?: string
  TargetOriginId?: string
  ViewerProtocolPolicy?: string
  Compress?: boolean
  AllowedMethods?: { Items?: string[]; CachedMethods?: { Items?: string[] } }
  CachePolicyId?: string
  OriginRequestPolicyId?: string
  ResponseHeadersPolicyId?: string
  ForwardedValues?: ForwardedValuesShape
  MinTTL?: number
  DefaultTTL?: number
  MaxTTL?: number
  FunctionAssociations?: { Items?: Array<{ FunctionARN?: string; EventType?: string }> }
  LambdaFunctionAssociations?: { Items?: Array<{ LambdaFunctionARN?: string; EventType?: string }> }
}

interface GetDistributionConfigResponse {
  ETag?: string
  DistributionConfig?: {
    Comment?: string
    Enabled?: boolean
    DefaultRootObject?: string
    PriceClass?: string
    HttpVersion?: string
    IsIPV6Enabled?: boolean
    WebACLId?: string
    Aliases?: { Items?: string[] }
    Origins?: {
      Items?: Array<{
        Id?: string
        DomainName?: string
        OriginPath?: string
        OriginAccessControlId?: string
        S3OriginConfig?: { OriginAccessIdentity?: string }
        CustomOriginConfig?: {
          HTTPPort?: number
          HTTPSPort?: number
          OriginProtocolPolicy?: string
          OriginSslProtocols?: { Items?: string[] }
        }
      }>
    }
    DefaultCacheBehavior?: CacheBehaviourShape
    CacheBehaviors?: { Items?: CacheBehaviourShape[] }
    Logging?: { Enabled?: boolean; IncludeCookies?: boolean; Bucket?: string; Prefix?: string }
    ViewerCertificate?: {
      CloudFrontDefaultCertificate?: boolean
      ACMCertificateArn?: string
      IAMCertificateId?: string
      SSLSupportMethod?: string
      MinimumProtocolVersion?: string
      CertificateSource?: string
    }
    Restrictions?: { GeoRestriction?: { RestrictionType?: string; Items?: string[] } }
  }
}

interface ListInvalidationsResponse {
  InvalidationList?: {
    NextMarker?: string
    IsTruncated?: boolean
    Items?: Array<{ Id?: string; Status?: string; CreateTime?: string | Date }>
  }
}

/* ------------------------------------------------------------ truncation -- */

/**
 * Whether a paged read reached the end, or gave up at its bound.
 *
 * A value rather than a boolean so the reason travels with it. "There were more"
 * and "that was all of them" are the two answers, and only the second licenses a
 * surface to print a count without a qualifier.
 */
export type Truncation =
  | { kind: "complete" }
  | { kind: "truncated"; pagesRead: number; itemsRead: number; why: string }

export const COMPLETE: Truncation = { kind: "complete" }

/** The sentence a surface prints for a truncation. Empty when it is complete. */
export function describeTruncation(truncation: Truncation): string {
  return truncation.kind === "complete"
    ? ""
    : ` — TRUNCATED: ${truncation.why} (${truncation.itemsRead} read over ${truncation.pagesRead} page(s); there were more)`
}

/** A paged result and whether it is all of them. */
interface Paged<T> {
  items: readonly T[]
  truncation: Truncation
}

/* --------------------------------------------------------------- origins -- */

/**
 * How the edge talks to one origin.
 *
 * `plaintext` and `viewer-dependent` are separate arms because they are separate
 * facts with the same consequence: `http-only` always crosses the network in the
 * clear, `match-viewer` does so whenever a viewer arrives over HTTP. Collapsing
 * them would make the remediation ambiguous — one is fixed by changing the origin
 * policy, the other by ALSO fixing the viewer protocol policy on every behaviour.
 *
 * `unreported` exists because "AWS did not return an origin protocol policy" and
 * "AWS said https-only" must not be the same row. The CustomOriginConfig field is
 * required by the API today; a row that assumed it would be a row that lies the
 * day an SDK version stops returning it.
 */
export type OriginProtocol =
  /** `http-only`. Edge-to-origin traffic is unencrypted. */
  | { kind: "plaintext"; policy: string; why: string }
  /** `match-viewer`. Unencrypted whenever the viewer arrived over HTTP. */
  | { kind: "viewer-dependent"; policy: string; why: string }
  /** `https-only`, with the SSL protocols the edge will negotiate. */
  | { kind: "tls"; policy: string; sslProtocols: readonly string[] }
  /** An S3 origin: the protocol is AWS's, and access control is OAC or OAI. */
  | { kind: "s3-managed"; access: "origin-access-control" | "origin-access-identity" | "public" }
  | { kind: "unreported"; why: string }

/** One origin behind a distribution. */
export interface OriginReading {
  id: string
  domainName: string | null
  originPath: string | null
  protocol: OriginProtocol
}

/**
 * What `OriginProtocolPolicy` means for one origin.
 *
 * Exported and pure because it is the single most consequential derivation in
 * this module — it is the one that decides whether the sentence on the screen
 * says the ALB link is in the clear — and a derivation a reviewer cannot read on
 * its own is one nobody checks.
 */
export function originProtocolOf(origin: {
  S3OriginConfig?: { OriginAccessIdentity?: string }
  OriginAccessControlId?: string
  CustomOriginConfig?: { OriginProtocolPolicy?: string; OriginSslProtocols?: { Items?: string[] } }
}): OriginProtocol {
  const custom = origin.CustomOriginConfig
  if (!custom) {
    if (origin.S3OriginConfig || origin.OriginAccessControlId) {
      if (origin.OriginAccessControlId) return { kind: "s3-managed", access: "origin-access-control" }
      const oai = origin.S3OriginConfig?.OriginAccessIdentity ?? ""
      return {
        kind: "s3-managed",
        access: oai.trim() === "" ? "public" : "origin-access-identity",
      }
    }
    return {
      kind: "unreported",
      why:
        "cloudfront:GetDistributionConfig returned this origin with neither a CustomOriginConfig nor " +
        "an S3OriginConfig, so how the edge reaches it cannot be stated. Unknown, not secure.",
    }
  }
  const policy = (custom.OriginProtocolPolicy ?? "").trim()
  const sslProtocols = (custom.OriginSslProtocols?.Items ?? []).filter((p) => typeof p === "string")
  switch (policy) {
    case "http-only":
      return {
        kind: "plaintext",
        policy,
        why:
          "origin_protocol_policy is http-only: every request CloudFront forwards to this origin, and " +
          "every response it returns, crosses the network unencrypted. TLS terminates at the edge and " +
          "is not resumed. Anything on the path between the edge and the origin sees session cookies " +
          "in the clear.",
      }
    case "match-viewer":
      return {
        kind: "viewer-dependent",
        policy,
        why:
          "origin_protocol_policy is match-viewer: CloudFront reaches this origin over whatever protocol " +
          "the VIEWER used. A viewer that arrives over HTTP produces an unencrypted edge-to-origin hop, " +
          "so this is only as safe as every cache behaviour's viewer protocol policy.",
      }
    case "https-only":
      return { kind: "tls", policy, sslProtocols }
    case "":
      return {
        kind: "unreported",
        why:
          "cloudfront:GetDistributionConfig returned a CustomOriginConfig with no OriginProtocolPolicy. " +
          "How the edge reaches this origin is unknown, which is not the same as its being encrypted.",
      }
    default:
      return {
        kind: "unreported",
        why:
          `cloudfront:GetDistributionConfig returned OriginProtocolPolicy ${JSON.stringify(policy)}, ` +
          `which this engine does not model. Reported rather than assumed to be safe.`,
      }
  }
}

export function describeOriginProtocol(protocol: OriginProtocol): string {
  switch (protocol.kind) {
    case "plaintext":
      return `PLAINTEXT to origin (${protocol.policy}) — ${protocol.why}`
    case "viewer-dependent":
      return `conditional (${protocol.policy}) — ${protocol.why}`
    case "tls":
      return `TLS to origin (${protocol.policy}${
        protocol.sslProtocols.length > 0 ? `, ${protocol.sslProtocols.join("/")}` : ""
      })`
    case "s3-managed":
      if (protocol.access === "origin-access-control") {
        return "S3 origin, reached through an origin access control"
      }
      if (protocol.access === "origin-access-identity") {
        return "S3 origin, reached through a legacy origin access identity"
      }
      return "S3 origin with NO origin access control or identity — the bucket is reachable without the edge"
    case "unreported":
      return `origin protocol unknown — ${protocol.why}`
  }
}

/* ------------------------------------------------------------------- TLS -- */

/**
 * CloudFront's security policies, weakest first.
 *
 * This is AWS's own enumerated list of `MinimumProtocolVersion` values, not a
 * parse of the string: `TLSv1.1_2016` sorts after `TLSv1_2016` and a comparison
 * on the text would get that backwards, and `SSLv3` would sort as newer than
 * everything because "S" is after "T".
 */
export const TLS_POLICY_ORDER: readonly string[] = [
  "SSLv3",
  "TLSv1",
  "TLSv1_2016",
  "TLSv1.1_2016",
  "TLSv1.2_2018",
  "TLSv1.2_2019",
  "TLSv1.2_2021",
]

/**
 * The weakest policy this engine calls current.
 *
 * `TLSv1.2_2018` is the first policy in AWS's list whose floor is TLS 1.2;
 * everything below it admits TLS 1.0 or 1.1, which every major browser removed
 * in 2020 and which PCI DSS has disallowed since 2018.
 */
export const MODERN_TLS_FLOOR = "TLSv1.2_2018"

/**
 * The lowest protocol version a viewer may negotiate.
 *
 * `unreported` is its own arm rather than being read as the AWS default. There
 * IS a default, and reporting it would put a distribution on — or off — a
 * remediation list because of a field the API did not return, which is a claim
 * about our read dressed up as a claim about the estate.
 */
export type TlsFloor =
  | { kind: "modern"; version: string; certificateSource: CertificateSource }
  | { kind: "deprecated"; version: string; why: string; certificateSource: CertificateSource }
  | { kind: "unmodelled"; version: string; why: string; certificateSource: CertificateSource }
  | { kind: "unreported"; why: string; certificateSource: CertificateSource }

/** Where the certificate the edge presents comes from. AWS's own three answers. */
export type CertificateSource =
  | { kind: "cloudfront-default" }
  | { kind: "acm"; arn: string; sslSupportMethod: string | null }
  | { kind: "iam"; certificateId: string; sslSupportMethod: string | null }
  | { kind: "unreported" }

export function certificateSourceOf(
  certificate:
    | {
        CloudFrontDefaultCertificate?: boolean
        ACMCertificateArn?: string
        IAMCertificateId?: string
        SSLSupportMethod?: string
      }
    | undefined,
): CertificateSource {
  if (!certificate) return { kind: "unreported" }
  const sslSupportMethod = certificate.SSLSupportMethod?.trim() || null
  if (certificate.ACMCertificateArn && certificate.ACMCertificateArn.trim() !== "") {
    return { kind: "acm", arn: certificate.ACMCertificateArn, sslSupportMethod }
  }
  if (certificate.IAMCertificateId && certificate.IAMCertificateId.trim() !== "") {
    return { kind: "iam", certificateId: certificate.IAMCertificateId, sslSupportMethod }
  }
  if (certificate.CloudFrontDefaultCertificate === true) return { kind: "cloudfront-default" }
  return { kind: "unreported" }
}

export function tlsFloorOf(
  certificate:
    | {
        CloudFrontDefaultCertificate?: boolean
        ACMCertificateArn?: string
        IAMCertificateId?: string
        SSLSupportMethod?: string
        MinimumProtocolVersion?: string
      }
    | undefined,
): TlsFloor {
  const certificateSource = certificateSourceOf(certificate)
  const version = (certificate?.MinimumProtocolVersion ?? "").trim()
  if (version === "") {
    return {
      kind: "unreported",
      certificateSource,
      why:
        "cloudfront:GetDistributionConfig returned no MinimumProtocolVersion for this distribution. " +
        "Which TLS versions a viewer may negotiate is unknown, which is not the same as its being modern.",
    }
  }
  const index = TLS_POLICY_ORDER.indexOf(version)
  if (index < 0) {
    return {
      kind: "unmodelled",
      version,
      certificateSource,
      why:
        `AWS reports the security policy ${version}, which is not in this engine's ordered list of ` +
        `CloudFront security policies. It is reported verbatim rather than ranked, because ranking a ` +
        `policy this engine does not know would be a guess in whichever direction happened to be reassuring.`,
    }
  }
  if (index >= TLS_POLICY_ORDER.indexOf(MODERN_TLS_FLOOR)) {
    return { kind: "modern", version, certificateSource }
  }
  return {
    kind: "deprecated",
    version,
    certificateSource,
    why:
      `the security policy ${version} admits TLS versions below 1.2. Every current browser removed TLS ` +
      `1.0 and 1.1 in 2020 and PCI DSS has disallowed them since June 2018, so this floor exists only to ` +
      `serve clients that no longer exist — while remaining negotiable by anything that asks for it.`,
  }
}

export function describeCertificateSource(source: CertificateSource): string {
  switch (source.kind) {
    case "cloudfront-default":
      return "CloudFront's default certificate (*.cloudfront.net — no custom domain can be served)"
    case "acm":
      return `ACM certificate ${source.arn}${source.sslSupportMethod ? ` (${source.sslSupportMethod})` : ""}`
    case "iam":
      return `IAM-uploaded certificate ${source.certificateId}${
        source.sslSupportMethod ? ` (${source.sslSupportMethod})` : ""
      }`
    case "unreported":
      return "certificate source unreported"
  }
}

export function describeTlsFloor(floor: TlsFloor): string {
  switch (floor.kind) {
    case "modern":
      return `TLS floor ${floor.version} — ${describeCertificateSource(floor.certificateSource)}`
    case "deprecated":
      return `TLS floor ${floor.version} — DEPRECATED: ${floor.why} — ${describeCertificateSource(
        floor.certificateSource,
      )}`
    case "unmodelled":
      return `TLS floor ${floor.version} — unranked: ${floor.why}`
    case "unreported":
      return `TLS floor unknown — ${floor.why}`
  }
}

/* ------------------------------------------------------------------- WAF -- */

/**
 * Whether a web ACL is attached to this distribution.
 *
 * `none` carries the sentence, because the sentence is the finding: nothing
 * rate-limits or filters requests before they reach the origin. A boolean would
 * let a surface print "WAF: false" in grey beside a green status chip, which is
 * the composition this module exists to make impossible.
 *
 * And `unreported` is NOT `none`. A row that printed "no WAF" because the config
 * read was refused would be this console inventing a finding.
 */
export type WebAclAssociation =
  | { kind: "associated"; webAclId: string; why: string }
  | { kind: "none"; why: string }
  | { kind: "unreported"; why: string }

export function webAclOf(webAclId: string | undefined): WebAclAssociation {
  if (webAclId === undefined) {
    return {
      kind: "unreported",
      why:
        "cloudfront:GetDistributionConfig returned no WebACLId field at all. Whether a web ACL is " +
        "attached is unknown, which is not the same as there being none.",
    }
  }
  if (webAclId.trim() === "") {
    return {
      kind: "none",
      why:
        "no AWS WAF web ACL is associated with this distribution. Nothing filters, rate-limits or " +
        "logs a request before it reaches the origin — every request that resolves the edge is " +
        "forwarded. infrastructure/terraform/cloudfront.tf has web_acl_id commented out.",
    }
  }
  return {
    kind: "associated",
    webAclId,
    why:
      "a web ACL is attached. WHAT it allows or blocks is wafv2:GetWebACL, which this engine does not " +
      "hold — associated is not the same as protected.",
  }
}

export function describeWebAcl(waf: WebAclAssociation): string {
  switch (waf.kind) {
    case "associated":
      return `WAF ${waf.webAclId} — ${waf.why}`
    case "none":
      return `NO WAF — ${waf.why}`
    case "unreported":
      return `WAF unknown — ${waf.why}`
  }
}

/* ------------------------------------------------------- cache behaviours -- */

/**
 * Whether a behaviour actually caches anything.
 *
 * `bypass` is only ever reached from the LEGACY fields, where the TTLs are in
 * the response and `MaxTTL = 0` means nothing can be stored. See the module
 * header for why a managed cache policy gets its own arm instead: the TTLs are
 * behind a capability this engine does not hold, and both "cached" and "bypass"
 * would be guesses.
 */
export type CacheDisposition =
  /** Legacy TTLs, and they permit storage. */
  | { kind: "cached"; minTtl: number; defaultTtl: number; maxTtl: number }
  /** Legacy TTLs, and `MaxTTL` is zero: every request reaches the origin. */
  | { kind: "bypass"; why: string }
  /** A managed cache policy. Its TTLs are NOT readable from this capability. */
  | { kind: "managed-policy"; cachePolicyId: string; why: string }
  | { kind: "unreported"; why: string }

export function cacheDispositionOf(behaviour: CacheBehaviourShape): CacheDisposition {
  const policyId = (behaviour.CachePolicyId ?? "").trim()
  if (policyId !== "") {
    return {
      kind: "managed-policy",
      cachePolicyId: policyId,
      why:
        `this behaviour uses the managed cache policy ${policyId}. Its TTLs and cache key are behind ` +
        `cloudfront:GetCachePolicy, which is not in this engine's capability registry, so whether it ` +
        `caches at all was NOT read. Unknown, not "caching".`,
    }
  }
  const { MinTTL, DefaultTTL, MaxTTL } = behaviour
  if (typeof MaxTTL !== "number" || typeof MinTTL !== "number") {
    return {
      kind: "unreported",
      why:
        "this behaviour carries neither a CachePolicyId nor the legacy MinTTL/MaxTTL fields, so whether " +
        "it caches cannot be stated from cloudfront:GetDistributionConfig.",
    }
  }
  const defaultTtl = typeof DefaultTTL === "number" ? DefaultTTL : 0
  if (MaxTTL === 0) {
    return {
      kind: "bypass",
      why:
        "MaxTTL is 0, so nothing matching this path is ever stored at the edge: every request is " +
        "forwarded to the origin. An invalidation cannot fix a stale response here because there was " +
        "never a cached one — and the origin carries the full request load.",
    }
  }
  return { kind: "cached", minTtl: MinTTL, defaultTtl, maxTtl: MaxTTL }
}

export function describeCacheDisposition(disposition: CacheDisposition): string {
  switch (disposition.kind) {
    case "cached":
      return `cached (min ${disposition.minTtl}s / default ${disposition.defaultTtl}s / max ${disposition.maxTtl}s)`
    case "bypass":
      return `BYPASSES THE CACHE — ${disposition.why}`
    case "managed-policy":
      return `cache policy ${disposition.cachePolicyId} — not read: ${disposition.why}`
    case "unreported":
      return `cache disposition unknown — ${disposition.why}`
  }
}

/**
 * How wide the cache key is, when the legacy fields say.
 *
 * Forwarding all cookies or all headers is not itself a defect — the pilot's
 * default behaviour must forward the RSC headers or every link click breaks —
 * but it is the fact that explains a cache hit ratio of zero, and it is carried
 * so a surface can say so rather than leaving an operator to guess.
 */
export interface CacheKeyWidth {
  forwardsQueryString: boolean | null
  cookies: string | null
  forwardsAllHeaders: boolean
  headers: readonly string[]
}

export function cacheKeyWidthOf(behaviour: CacheBehaviourShape): CacheKeyWidth {
  const forwarded = behaviour.ForwardedValues
  const headers = (forwarded?.Headers?.Items ?? []).filter((h) => typeof h === "string")
  return {
    forwardsQueryString: typeof forwarded?.QueryString === "boolean" ? forwarded.QueryString : null,
    cookies: forwarded?.Cookies?.Forward?.trim() || null,
    forwardsAllHeaders: headers.includes("*"),
    headers,
  }
}

/** One cache behaviour: which paths it matches, and what it does with them. */
export interface CacheBehaviourReading {
  /** The path pattern, or `*` for the default behaviour — which is what it matches. */
  pathPattern: string
  /** True for the distribution's `DefaultCacheBehavior`. */
  isDefault: boolean
  targetOriginId: string | null
  /** `redirect-to-https`, `https-only` or `allow-all` — read, never assumed. */
  viewerProtocolPolicy: string | null
  /** True when the policy admits a plaintext viewer request. */
  allowsPlaintextViewer: boolean
  compress: boolean | null
  allowedMethods: readonly string[]
  cachedMethods: readonly string[]
  disposition: CacheDisposition
  keyWidth: CacheKeyWidth
  /** Edge functions on this behaviour — the closed-pilot gate is one of these. */
  edgeFunctions: readonly string[]
}

function behaviourReading(behaviour: CacheBehaviourShape, isDefault: boolean): CacheBehaviourReading {
  const viewerProtocolPolicy = behaviour.ViewerProtocolPolicy?.trim() || null
  const edgeFunctions = [
    ...(behaviour.FunctionAssociations?.Items ?? []).map(
      (f) => `${f.EventType ?? "unknown-event"}:${f.FunctionARN ?? "unnamed-function"}`,
    ),
    ...(behaviour.LambdaFunctionAssociations?.Items ?? []).map(
      (f) => `${f.EventType ?? "unknown-event"}:${f.LambdaFunctionARN ?? "unnamed-function"}`,
    ),
  ].sort()
  return {
    // The default behaviour matches everything no other pattern claimed, which
    // is what `*` says. Naming it "default" instead would leave a reader unable
    // to see which paths it covers.
    pathPattern: isDefault ? "*" : behaviour.PathPattern?.trim() || "(unnamed pattern)",
    isDefault,
    targetOriginId: behaviour.TargetOriginId?.trim() || null,
    viewerProtocolPolicy,
    allowsPlaintextViewer: viewerProtocolPolicy === "allow-all",
    compress: typeof behaviour.Compress === "boolean" ? behaviour.Compress : null,
    allowedMethods: (behaviour.AllowedMethods?.Items ?? []).filter((m) => typeof m === "string"),
    cachedMethods: (behaviour.AllowedMethods?.CachedMethods?.Items ?? []).filter(
      (m) => typeof m === "string",
    ),
    disposition: cacheDispositionOf(behaviour),
    keyWidth: cacheKeyWidthOf(behaviour),
    edgeFunctions,
  }
}

export function describeCacheBehaviour(behaviour: CacheBehaviourReading): string {
  const viewer =
    behaviour.viewerProtocolPolicy === null
      ? "viewer protocol unreported"
      : behaviour.allowsPlaintextViewer
        ? `viewer protocol ${behaviour.viewerProtocolPolicy} — PLAINTEXT VIEWERS ACCEPTED`
        : `viewer protocol ${behaviour.viewerProtocolPolicy}`
  const key: string[] = []
  if (behaviour.keyWidth.cookies) key.push(`cookies ${behaviour.keyWidth.cookies}`)
  if (behaviour.keyWidth.forwardsAllHeaders) key.push("all headers forwarded")
  else if (behaviour.keyWidth.headers.length > 0) key.push(`headers ${behaviour.keyWidth.headers.join("/")}`)
  if (behaviour.keyWidth.forwardsQueryString === true) key.push("query string in key")
  const functions =
    behaviour.edgeFunctions.length > 0 ? ` · edge functions: ${behaviour.edgeFunctions.join(", ")}` : ""
  return (
    `${behaviour.pathPattern}${behaviour.isDefault ? " (default)" : ""} → ` +
    `${behaviour.targetOriginId ?? "unnamed origin"} — ${describeCacheDisposition(behaviour.disposition)} — ` +
    `${viewer}${key.length > 0 ? ` · ${key.join(", ")}` : ""}${functions}`
  )
}

/* --------------------------------------------------------------- logging -- */

/**
 * Whether the edge writes an access log.
 *
 * `disabled` is a value and not an absence, because it is the answer to a
 * question somebody asks after an incident: there is no record of who reached
 * this distribution, and there will not be a retrospective one.
 */
export type AccessLogging =
  | { kind: "enabled"; bucket: string; prefix: string | null; includesCookies: boolean }
  | { kind: "disabled"; why: string }
  | { kind: "unreported"; why: string }

export function accessLoggingOf(
  logging: { Enabled?: boolean; IncludeCookies?: boolean; Bucket?: string; Prefix?: string } | undefined,
): AccessLogging {
  if (!logging || typeof logging.Enabled !== "boolean") {
    return {
      kind: "unreported",
      why:
        "cloudfront:GetDistributionConfig returned no Logging block for this distribution, so whether " +
        "the edge writes an access log is unknown — not known to be off.",
    }
  }
  if (!logging.Enabled) {
    return {
      kind: "disabled",
      why:
        "standard access logging is OFF. There is no per-request record of what reached this " +
        "distribution, so after an incident there is nothing to read back and nothing to retrofit: " +
        "CloudFront does not backfill logs for requests it did not log.",
    }
  }
  const bucket = logging.Bucket?.trim() ?? ""
  if (bucket === "") {
    return {
      kind: "unreported",
      why:
        "cloudfront:GetDistributionConfig reports logging Enabled with no destination bucket. That " +
        "combination cannot be acted on and is reported rather than read as either state.",
    }
  }
  return {
    kind: "enabled",
    bucket,
    prefix: logging.Prefix?.trim() || null,
    includesCookies: logging.IncludeCookies === true,
  }
}

export function describeAccessLogging(logging: AccessLogging): string {
  switch (logging.kind) {
    case "enabled":
      return `access log → ${logging.bucket}${logging.prefix ? `/${logging.prefix}` : ""}${
        logging.includesCookies ? " (cookies included)" : ""
      }`
    case "disabled":
      return `NO ACCESS LOG — ${logging.why}`
    case "unreported":
      return `access logging unknown — ${logging.why}`
  }
}

/* ------------------------------------------------------ geo restrictions -- */

export type GeoRestriction =
  | { kind: "none"; why: string }
  | { kind: "allowlist"; countries: readonly string[] }
  | { kind: "blocklist"; countries: readonly string[] }
  | { kind: "unreported"; why: string }

export function geoRestrictionOf(
  restriction: { RestrictionType?: string; Items?: string[] } | undefined,
): GeoRestriction {
  const type = (restriction?.RestrictionType ?? "").trim()
  const countries = (restriction?.Items ?? []).filter((c) => typeof c === "string").sort()
  switch (type) {
    case "none":
      return {
        kind: "none",
        why: "no geographic restriction — this distribution serves every country CloudFront serves",
      }
    case "whitelist":
      return { kind: "allowlist", countries }
    case "blacklist":
      return { kind: "blocklist", countries }
    case "":
      return {
        kind: "unreported",
        why:
          "cloudfront:GetDistributionConfig returned no GeoRestriction block, so whether this " +
          "distribution is geographically restricted is unknown.",
      }
    default:
      return {
        kind: "unreported",
        why: `AWS reports the geo restriction type ${JSON.stringify(type)}, which this engine does not model.`,
      }
  }
}

export function describeGeoRestriction(geo: GeoRestriction): string {
  switch (geo.kind) {
    case "none":
      return geo.why
    case "allowlist":
      return `served only to ${geo.countries.length} country/countries (${geo.countries.join(", ")})`
    case "blocklist":
      return `blocked in ${geo.countries.length} country/countries (${geo.countries.join(", ")})`
    case "unreported":
      return `geo restriction unknown — ${geo.why}`
  }
}

/* --------------------------------------------------------- invalidations -- */

/** One invalidation, as CloudFront reports it. */
export interface InvalidationReading {
  id: string
  /** `InProgress` or `Completed`, verbatim. Never normalised into a boolean. */
  status: string
  createdAt: string | null
}

/**
 * Whether a cache purge is still in flight.
 *
 * This is the answer to "the deploy went out, why do I not see my change". An
 * invalidation that is still `InProgress` means the edge is legitimately still
 * serving the old object, and no amount of redeploying will change that.
 *
 * `unknown` is a separate arm from `none` for the usual reason: a refused
 * `ListInvalidations` must not render as "no purge is running", which is the one
 * sentence that would send an operator to redeploy.
 */
export type InvalidationBacklog =
  | { kind: "in-flight"; ids: readonly string[]; oldestCreatedAt: string | null; why: string }
  | { kind: "settled"; lastCompletedAt: string | null; considered: number }
  | { kind: "none"; why: string }
  | { kind: "unknown"; why: string }

export function invalidationBacklogOf(
  read: AwsRead<Paged<InvalidationReading>>,
): InvalidationBacklog {
  if (read.state === "EMPTY") {
    return {
      kind: "none",
      why:
        "cloudfront:ListInvalidations answered, and this distribution has no invalidation history at " +
        "all. Nothing has ever been purged from this cache.",
    }
  }
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return {
      kind: "unknown",
      why: `this distribution's invalidations were not read — ${describeRead(read, "the invalidations")}`,
    }
  }
  const items = read.value.items
  const inFlight = items.filter((i) => i.status === "InProgress")
  if (inFlight.length > 0) {
    const created = inFlight.map((i) => i.createdAt).filter((c): c is string => c !== null)
    created.sort()
    return {
      kind: "in-flight",
      ids: inFlight.map((i) => i.id),
      oldestCreatedAt: created[0] ?? null,
      why:
        `${inFlight.length} invalidation(s) are still InProgress. Until they complete the edge is ` +
        `legitimately still serving the objects they name, so a deploy that "went out" is not yet ` +
        `visible to viewers. Redeploying does not make this finish sooner.`,
    }
  }
  const completed = items
    .filter((i) => i.status === "Completed")
    .map((i) => i.createdAt)
    .filter((c): c is string => c !== null)
    .sort()
  return {
    kind: "settled",
    lastCompletedAt: completed.length > 0 ? completed[completed.length - 1] : null,
    considered: items.length,
  }
}

export function describeInvalidationBacklog(backlog: InvalidationBacklog): string {
  switch (backlog.kind) {
    case "in-flight":
      return (
        `${backlog.ids.length} invalidation(s) IN PROGRESS (${backlog.ids.join(", ")}` +
        `${backlog.oldestCreatedAt ? `, oldest created ${backlog.oldestCreatedAt}` : ""}) — ${backlog.why}`
      )
    case "settled":
      return `no invalidation in flight — ${backlog.considered} read, last created ${
        backlog.lastCompletedAt ?? "at an unreported time"
      }`
    case "none":
      return backlog.why
    case "unknown":
      return `invalidations unknown — ${backlog.why}`
  }
}

/* ----------------------------------------------------------- attribution -- */

/**
 * Which tenant a distribution belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and it can be denied, throttled or broken. A
 * distribution whose tags were never read must not render as "unattributable —
 * missing tenure:tenant", because that sentence sends an operator to add a tag
 * that is probably already there.
 */
export type CdnAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

export function describeCdnAttribution(attribution: CdnAttribution): string {
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

/* -------------------------------------------------------------- readings -- */

/** What one `GetDistributionConfig` answered, in this engine's vocabulary. */
export interface DistributionConfigReading {
  comment: string | null
  enabled: boolean | null
  aliases: readonly string[]
  /**
   * The object served for a request to `/`. Null when there is none — which for
   * a distribution fronting an application is normal and for one fronting a
   * bucket means the root request 403s or lists.
   */
  defaultRootObject: string | null
  origins: readonly OriginReading[]
  tls: TlsFloor
  waf: WebAclAssociation
  behaviours: readonly CacheBehaviourReading[]
  logging: AccessLogging
  geo: GeoRestriction
  priceClass: string | null
  httpVersion: string | null
  ipv6Enabled: boolean | null
}

/** One distribution: what the summary said, and what the config said. */
export interface DistributionReading {
  id: string
  /** AWS's own `ARN`. Null only when AWS did not return one. */
  arn: string | null
  domainName: string | null
  /** `Deployed` or `InProgress`, verbatim from the summary. */
  status: string | null
  enabled: boolean | null
  aliases: readonly string[]
  lastModifiedAt: string | null
  /**
   * Always null, and it says why.
   *
   * CloudFront is a partition-global service and its ARNs carry an empty region
   * segment by construction. A region printed here would have to come from
   * somewhere other than AWS's answer, and a region this engine made up is the
   * shape of the GE-010-007 residency defect.
   */
  region: null
  whyNoRegion: string
  /** From the ARN's second segment, or the resolved identity. Never a literal. */
  partition: string | null
  attribution: CdnAttribution
  /** Refused, throttled, capped, broken or read — per distribution, action named. */
  config: AwsRead<DistributionConfigReading>
  /** Independent of `config`: one can be refused while the other answers. */
  invalidations: AwsRead<Paged<InvalidationReading>>
  /** Derived from `invalidations`, and `unknown` when that read did not answer. */
  invalidationBacklog: InvalidationBacklog
  /** How much of this distribution's invalidation history was walked. */
  invalidationTruncation: Truncation
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { config: number; invalidations: number }
  asOf: string
}

/**
 * One thing wrong with one distribution, named.
 *
 * A list rather than a score. A number would let two very different estates —
 * one with a plaintext origin, one with no access log — render identically, and
 * the remediation for the two shares nothing.
 */
export interface CdnFinding {
  distributionId: string
  /** A stable slug so a surface can group or filter without parsing prose. */
  code:
    | "plaintext-origin"
    | "viewer-dependent-origin"
    | "public-s3-origin"
    | "no-waf"
    | "deprecated-tls"
    | "plaintext-viewer"
    | "no-access-log"
  detail: string
}

/**
 * Whether anything at the edge is exposed.
 *
 * The headline. Every arm is careful about what it claims: `clear` is reachable
 * ONLY when every distribution's config was actually READ and none of them
 * produced a finding. Anything less is `unverified`, whose whole job is to say
 * that the absence of findings on the screen is not evidence.
 */
export type EdgeExposure =
  /** The listing itself was not readable, so nothing can be said. */
  | { kind: "unknown"; why: string }
  /** No distribution at all. Not a posture statement — there is no edge. */
  | { kind: "no-distributions" }
  /** At least one distribution carries a finding. This is the alarm. */
  | {
      kind: "exposed"
      findings: readonly CdnFinding[]
      plaintextOrigins: readonly string[]
      unprotected: readonly string[]
      /** Distributions this engine could not read. Named, so nothing is implied. */
      unreadable: readonly string[]
    }
  /**
   * No findings, and at least one distribution whose config was not read. The
   * clean screen is not a clean bill and this arm exists so a surface cannot
   * print it as one.
   */
  | { kind: "unverified"; why: string; unreadable: readonly string[]; distributionsRead: number }
  /** Every distribution's config was read, and none of them produced a finding. */
  | { kind: "clear"; distributionsRead: number }

/** Everything a CDN surface needs, in one load. */
export interface CdnReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The distributions. DENIED here is a refused `cloudfront:ListDistributions`
   * and is NEVER `[]` — an operator reading "no distributions" when the truth is
   * "we were not allowed to look" is the single most dangerous thing this
   * surface can say.
   */
  distributions: AwsRead<readonly DistributionReading[]>
  /** How much of the distribution listing was walked. */
  truncation: Truncation
  exposure: EdgeExposure
  findings: readonly CdnFinding[]
  /** Distributions with an invalidation still InProgress. The deploy-visibility answer. */
  invalidationsInFlight: readonly string[]
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { distributions: number; config: number; invalidations: number }
}

/* --------------------------------------------------------------- parsing -- */

/**
 * An AWS timestamp as an ISO string.
 *
 * The SDK hands back `Date` and a JSON transport hands back a string. Both are
 * accepted; anything else becomes null rather than `Invalid Date`, because a
 * render showing "Invalid Date" as an invalidation's creation time is a render
 * an operator stops trusting.
 */
export function isoTime(value: string | Date | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

interface RawDistribution {
  id: string
  arn: string | null
  domainName: string | null
  status: string | null
  enabled: boolean | null
  aliases: readonly string[]
  lastModifiedAt: string | null
}

/* ----------------------------------------------------------- the reads -- */

/** Every distribution in the account, paginated to a stated bound. */
async function listDistributions(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Paged<RawDistribution>>> {
  return readAws<Paged<RawDistribution>>(
    "cloudfront:ListDistributions",
    async () => {
      const items: RawDistribution[] = []
      let marker: string | undefined
      let truncation: Truncation = COMPLETE
      let pages = 0
      for (let page = 0; page < MAX_DISTRIBUTION_PAGES; page += 1) {
        pages = page + 1
        const response = (await gw.call("cloudfront:ListDistributions", {
          Marker: marker,
        })) as ListDistributionsResponse
        for (const dist of response?.DistributionList?.Items ?? []) {
          if (!dist?.Id) continue
          items.push({
            id: dist.Id,
            arn: dist.ARN ?? null,
            domainName: dist.DomainName ?? null,
            status: dist.Status ?? null,
            enabled: typeof dist.Enabled === "boolean" ? dist.Enabled : null,
            aliases: [...(dist.Aliases?.Items ?? [])].filter((a) => typeof a === "string").sort(),
            lastModifiedAt: isoTime(dist.LastModifiedTime),
          })
        }
        marker = response?.DistributionList?.NextMarker || undefined
        if (!marker) break
        if (page === MAX_DISTRIBUTION_PAGES - 1) {
          // Not thrown, and not hidden. Hitting the bound is an expected state
          // and it travels as a value every renderer prints, rather than as a
          // first page passed off as the whole account.
          truncation = {
            kind: "truncated",
            pagesRead: pages,
            itemsRead: items.length,
            why: `cloudfront:ListDistributions still had pages after ${MAX_DISTRIBUTION_PAGES}; this engine stopped there`,
          }
        }
      }
      // Sorted so two loads of the same account produce the same order.
      // ListDistributions does not promise one, and an order that changes
      // between renders makes a diff of two screenshots unreadable.
      items.sort((a, b) => a.id.localeCompare(b.id))
      return { items, truncation }
    },
    {
      now: options.now,
      denial: options.denial,
      // EMPTY is decided on the ITEMS, not on the wrapper: a `Paged` with an
      // empty list is an account with no distributions, and `looksEmpty` would
      // call the wrapper non-empty because it has two keys.
      isEmpty: (value) => (value as Paged<RawDistribution>).items.length === 0,
      ...RETRY,
    },
  )
}

/** One distribution's configuration — where the defects actually live. */
async function readDistributionConfig(
  gw: AwsGateway,
  id: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<DistributionConfigReading>> {
  return readAws<DistributionConfigReading>(
    "cloudfront:GetDistributionConfig",
    async () => {
      const response = (await gw.call("cloudfront:GetDistributionConfig", {
        Id: id,
      })) as GetDistributionConfigResponse
      const config = response?.DistributionConfig
      if (!config) {
        // Not returned as an empty configuration. A row rendered from a blank
        // config would say "no WAF, no logging, no origins" — three findings
        // this engine would have invented out of a malformed response.
        throw new Error(
          `cloudfront:GetDistributionConfig answered for ${id} without a DistributionConfig. ` +
            `Nothing about this distribution's origins, TLS floor or WAF can be stated from it.`,
        )
      }
      const origins: OriginReading[] = (config.Origins?.Items ?? [])
        .filter((o) => typeof o?.Id === "string" && o.Id !== "")
        .map((o) => ({
          id: o.Id as string,
          domainName: o.DomainName ?? null,
          originPath: o.OriginPath?.trim() || null,
          protocol: originProtocolOf(o),
        }))
        // Deterministic order, for the same reason the distribution list is sorted.
        .sort((a, b) => a.id.localeCompare(b.id))

      const behaviours: CacheBehaviourReading[] = []
      if (config.DefaultCacheBehavior) {
        behaviours.push(behaviourReading(config.DefaultCacheBehavior, true))
      }
      for (const ordered of config.CacheBehaviors?.Items ?? []) {
        behaviours.push(behaviourReading(ordered, false))
      }

      return {
        comment: config.Comment?.trim() || null,
        enabled: typeof config.Enabled === "boolean" ? config.Enabled : null,
        aliases: [...(config.Aliases?.Items ?? [])].filter((a) => typeof a === "string").sort(),
        defaultRootObject: config.DefaultRootObject?.trim() || null,
        origins,
        tls: tlsFloorOf(config.ViewerCertificate),
        waf: webAclOf(config.WebACLId),
        behaviours,
        logging: accessLoggingOf(config.Logging),
        geo: geoRestrictionOf(config.Restrictions?.GeoRestriction),
        priceClass: config.PriceClass?.trim() || null,
        httpVersion: config.HttpVersion?.trim() || null,
        ipv6Enabled: typeof config.IsIPV6Enabled === "boolean" ? config.IsIPV6Enabled : null,
      }
    },
    // A configuration is never EMPTY: it is an object with a dozen fields and
    // the interesting ones are precisely the falsy ones.
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

/** One distribution's invalidation history, paginated to a stated bound. */
async function readInvalidations(
  gw: AwsGateway,
  id: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Paged<InvalidationReading>>> {
  return readAws<Paged<InvalidationReading>>(
    "cloudfront:ListInvalidations",
    async () => {
      const items: InvalidationReading[] = []
      let marker: string | undefined
      let truncation: Truncation = COMPLETE
      let pages = 0
      for (let page = 0; page < MAX_INVALIDATION_PAGES; page += 1) {
        pages = page + 1
        const response = (await gw.call("cloudfront:ListInvalidations", {
          DistributionId: id,
          Marker: marker,
        })) as ListInvalidationsResponse
        for (const invalidation of response?.InvalidationList?.Items ?? []) {
          if (!invalidation?.Id) continue
          items.push({
            id: invalidation.Id,
            // Verbatim. Normalising this into a boolean is how "InProgress"
            // becomes "not done" becomes a row nobody reads.
            status: invalidation.Status?.trim() || "unreported",
            createdAt: isoTime(invalidation.CreateTime),
          })
        }
        marker = response?.InvalidationList?.NextMarker || undefined
        if (!marker) break
        if (page === MAX_INVALIDATION_PAGES - 1) {
          truncation = {
            kind: "truncated",
            pagesRead: pages,
            itemsRead: items.length,
            why: `cloudfront:ListInvalidations still had pages after ${MAX_INVALIDATION_PAGES} for ${id}; this engine stopped there`,
          }
        }
      }
      // Newest first — "is a purge running right now" is the question this list
      // is read for — with the id as a deterministic tie-break.
      items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || a.id.localeCompare(b.id))
      return { items: items.slice(0, MAX_INVALIDATIONS_SAMPLED), truncation }
    },
    {
      now: options.now,
      denial: options.denial,
      isEmpty: (value) => (value as Paged<InvalidationReading>).items.length === 0,
      ...RETRY,
    },
  )
}

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): CdnAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this distribution's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this distribution has no ARN this engine can state, so it cannot be joined against the tag " +
        "index. Unattributed would be a claim about its tags; this is a claim about ours.",
    }
  }
  const tags = index.get(arn)
  if (tags === undefined) {
    // The tag index answered and this ARN is not in it. That IS an observation:
    // the Resource Groups Tagging API returns resources that have tags, so an
    // absence means no tags at all, which is what `unattributed` says.
    return { kind: "unattributed" }
  }
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
 * CloudFront ARNs carry no region, and this is the sentence that says so.
 *
 * Written once and attached to every row, because "region: —" with no
 * explanation reads as a missing field, and a missing field is the thing an
 * operator fills in with a guess.
 */
const WHY_NO_REGION =
  "CloudFront is a partition-global service: its ARNs carry an empty region segment, so this " +
  "distribution has no region to report. The edge itself serves from every point of presence in " +
  "its price class."

/* ----------------------------------------------------------- the surface -- */

/**
 * Every distribution, its configuration, and whether a purge is still running.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function cdnReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<CdnReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [])

  const listed = await listDistributions(gw, { now, denial })
  const asOf = now().toISOString()
  const refreshMs = {
    distributions: CAPABILITIES["cloudfront:ListDistributions"].refreshMs,
    config: CAPABILITIES["cloudfront:GetDistributionConfig"].refreshMs,
    invalidations: CAPABILITIES["cloudfront:ListInvalidations"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they already ARE an `AwsRead<DistributionReading[]>`. A
    // cast here would be the place a future empty array could be smuggled in.
    const distributions: AwsRead<readonly DistributionReading[]> = listed
    return {
      identity,
      tagged,
      distributions,
      truncation: COMPLETE,
      exposure: edgeExposure(distributions),
      findings: [],
      invalidationsInFlight: [],
      asOf,
      refreshMs,
    }
  }

  const raw = listed.value.items
  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"

  // Config and invalidations per distribution, both independently failable.
  const configs: Array<AwsRead<DistributionConfigReading>> = new Array(raw.length)
  const invalidations: Array<AwsRead<Paged<InvalidationReading>>> = new Array(raw.length)
  for (let start = 0; start < raw.length; start += DETAIL_CONCURRENCY) {
    const batch = raw.slice(start, start + DETAIL_CONCURRENCY)
    const read = await Promise.all(
      batch.map(async (dist, offset) => {
        const position = start + offset
        if (position >= MAX_DISTRIBUTION_DEPTH_READS) {
          const skipped = (
            capability: "cloudfront:GetDistributionConfig" | "cloudfront:ListInvalidations",
          ) =>
            ({
              state: "UNCONFIGURED",
              capability,
              why:
                `this engine reads at most ${MAX_DISTRIBUTION_DEPTH_READS} distributions per load and ` +
                `this one is number ${position + 1} of ${raw.length}. It was not read — which is not ` +
                `the same as its having no findings.`,
            }) as const
          return {
            config: skipped("cloudfront:GetDistributionConfig") as AwsRead<DistributionConfigReading>,
            invalidations: skipped("cloudfront:ListInvalidations") as AwsRead<
              Paged<InvalidationReading>
            >,
          }
        }
        // Both are issued regardless of the other's outcome. A refused
        // ListInvalidations must not collapse the configuration to UNKNOWN, and
        // a refused GetDistributionConfig must not hide an in-flight purge.
        const [configRead, invalidationRead] = await Promise.all([
          readDistributionConfig(gw, dist.id, { now, denial }),
          readInvalidations(gw, dist.id, { now, denial }),
        ])
        return { config: configRead, invalidations: invalidationRead }
      }),
    )
    for (let i = 0; i < read.length; i += 1) {
      configs[start + i] = read[i].config
      invalidations[start + i] = read[i].invalidations
    }
  }

  const readings: DistributionReading[] = raw.map((dist, r) => {
    const parts = dist.arn ? dist.arn.split(":") : []
    const invalidationRead = invalidations[r]
    const invalidationTruncation =
      invalidationRead.state === "ACTUAL" || invalidationRead.state === "STALE"
        ? invalidationRead.value.truncation
        : COMPLETE
    return {
      id: dist.id,
      arn: dist.arn,
      domainName: dist.domainName,
      status: dist.status,
      enabled: dist.enabled,
      aliases: dist.aliases,
      lastModifiedAt: dist.lastModifiedAt,
      region: null,
      whyNoRegion: WHY_NO_REGION,
      // From the ARN when there is one — AWS's answer beats anything assembled —
      // and otherwise from the RESOLVED identity. Never a literal "aws".
      partition: parts.length >= 6 ? parts[1] : identityResolved ? identity.value.partition : null,
      attribution: attributionFor(dist.arn, tagged, index),
      config: configs[r],
      invalidations: invalidationRead,
      invalidationBacklog: invalidationBacklogOf(invalidationRead),
      invalidationTruncation,
      refreshMs: { config: refreshMs.config, invalidations: refreshMs.invalidations },
      asOf,
    }
  })

  const distributions: AwsRead<readonly DistributionReading[]> = { ...listed, value: readings }
  const findings = cdnFindings(distributions)
  return {
    identity,
    tagged,
    distributions,
    truncation: listed.value.truncation,
    exposure: edgeExposure(distributions),
    findings,
    invalidationsInFlight: readings
      .filter((d) => d.invalidationBacklog.kind === "in-flight")
      .map((d) => d.id),
    asOf,
    refreshMs,
  }
}

/* -------------------------------------------------------- derived states -- */

/**
 * Every defect this engine can name, across every distribution whose config was
 * actually read.
 *
 * Distributions whose config was NOT read contribute nothing here, deliberately
 * — a finding invented from a denied read is worse than a missing one — and
 * `edgeExposure` is where their absence is accounted for.
 */
export function cdnFindings(
  distributions: AwsRead<readonly DistributionReading[]>,
): readonly CdnFinding[] {
  if (distributions.state !== "ACTUAL" && distributions.state !== "STALE") return []
  const out: CdnFinding[] = []
  for (const dist of distributions.value) {
    if (dist.config.state !== "ACTUAL" && dist.config.state !== "STALE") continue
    const config = dist.config.value
    for (const origin of config.origins) {
      if (origin.protocol.kind === "plaintext") {
        out.push({
          distributionId: dist.id,
          code: "plaintext-origin",
          detail: `origin ${origin.id} (${origin.domainName ?? "unnamed"}): ${origin.protocol.why}`,
        })
      } else if (origin.protocol.kind === "viewer-dependent") {
        out.push({
          distributionId: dist.id,
          code: "viewer-dependent-origin",
          detail: `origin ${origin.id} (${origin.domainName ?? "unnamed"}): ${origin.protocol.why}`,
        })
      } else if (origin.protocol.kind === "s3-managed" && origin.protocol.access === "public") {
        out.push({
          distributionId: dist.id,
          code: "public-s3-origin",
          detail: `origin ${origin.id} has no origin access control or identity: the bucket is reachable without going through the edge`,
        })
      }
    }
    if (config.waf.kind === "none") {
      out.push({ distributionId: dist.id, code: "no-waf", detail: config.waf.why })
    }
    if (config.tls.kind === "deprecated") {
      out.push({ distributionId: dist.id, code: "deprecated-tls", detail: config.tls.why })
    }
    for (const behaviour of config.behaviours) {
      if (behaviour.allowsPlaintextViewer) {
        out.push({
          distributionId: dist.id,
          code: "plaintext-viewer",
          detail:
            `cache behaviour ${behaviour.pathPattern} has viewer protocol policy allow-all: a viewer ` +
            `may reach this path over plain HTTP and is not redirected.`,
        })
      }
    }
    if (config.logging.kind === "disabled") {
      out.push({ distributionId: dist.id, code: "no-access-log", detail: config.logging.why })
    }
  }
  return out
}

/**
 * Whether the edge is exposed, stated so that a clean screen is never mistaken
 * for a clean bill.
 *
 * Exported and pure so the derivation can be reasoned about on its own — but
 * `cdnReadings` is the only production caller, and the tests drive it through
 * there rather than through here.
 */
export function edgeExposure(
  distributions: AwsRead<readonly DistributionReading[]>,
): EdgeExposure {
  if (distributions.state === "EMPTY") return { kind: "no-distributions" }
  if (distributions.state !== "ACTUAL" && distributions.state !== "STALE") {
    return {
      kind: "unknown",
      why: `the distribution listing was not read — ${describeRead(distributions, "cloudfront:ListDistributions")}`,
    }
  }
  if (distributions.value.length === 0) return { kind: "no-distributions" }

  const findings = cdnFindings(distributions)
  const unreadable: string[] = []
  let read = 0
  for (const dist of distributions.value) {
    if (dist.config.state === "ACTUAL" || dist.config.state === "STALE") {
      read += 1
    } else {
      unreadable.push(`${dist.id}: ${describeRead(dist.config, "its configuration")}`)
    }
  }

  if (findings.length > 0) {
    const plaintextOrigins = distributions.value
      .filter((d) =>
        findings.some((f) => f.distributionId === d.id && f.code === "plaintext-origin"),
      )
      .map((d) => d.id)
    const unprotected = distributions.value
      .filter((d) => findings.some((f) => f.distributionId === d.id && f.code === "no-waf"))
      .map((d) => d.id)
    return { kind: "exposed", findings, plaintextOrigins, unprotected, unreadable }
  }

  if (unreadable.length > 0) {
    return {
      kind: "unverified",
      why:
        `no finding was produced, but ${unreadable.length} of ${distributions.value.length} ` +
        `distribution(s) had their configuration refused, throttled, capped or broken. The absence of ` +
        `findings below covers only the ${read} that answered, and is not a statement about the rest.`,
      unreadable,
      distributionsRead: read,
    }
  }
  return { kind: "clear", distributionsRead: read }
}

export function describeEdgeExposure(exposure: EdgeExposure): string {
  switch (exposure.kind) {
    case "unknown":
      return `unknown — ${exposure.why}`
    case "no-distributions":
      return "no distributions — there is no CloudFront edge in this account to describe"
    case "exposed":
      return (
        `EXPOSED — ${exposure.findings.length} finding(s) across ` +
        `${new Set(exposure.findings.map((f) => f.distributionId)).size} distribution(s)` +
        `${exposure.plaintextOrigins.length > 0 ? `; plaintext origin on ${exposure.plaintextOrigins.join(", ")}` : ""}` +
        `${exposure.unprotected.length > 0 ? `; no WAF on ${exposure.unprotected.join(", ")}` : ""}` +
        `${exposure.unreadable.length > 0 ? `; NOT READ: ${exposure.unreadable.join("; ")}` : ""}`
      )
    case "unverified":
      return `unverified — ${exposure.why} NOT READ: ${exposure.unreadable.join("; ")}`
    case "clear":
      return `clear — ${exposure.distributionsRead} distribution(s) read, and none of them produced a finding`
  }
}

/* ------------------------------------------------------------- renderers -- */

/** The sentence a surface prints for one distribution. One funnel, so states cannot drift. */
export function describeDistribution(distribution: DistributionReading): string {
  const where = distribution.partition
    ? `partition ${distribution.partition}, no region (${distribution.whyNoRegion})`
    : "partition unknown — identity is unresolved and AWS returned no ARN"
  const head =
    `${distribution.id} — ${distribution.domainName ?? "no domain name reported"} — ` +
    `${distribution.status ?? "status unreported"} — ${where} — ` +
    `${describeCdnAttribution(distribution.attribution)}`

  const config =
    distribution.config.state === "ACTUAL" || distribution.config.state === "STALE"
      ? `${describeOriginList(distribution.config.value.origins)} · ` +
        `${describeTlsFloor(distribution.config.value.tls)} · ` +
        `${describeWebAcl(distribution.config.value.waf)} · ` +
        `${describeAccessLogging(distribution.config.value.logging)} · ` +
        `${describeGeoRestriction(distribution.config.value.geo)} · ` +
        `root object ${distribution.config.value.defaultRootObject ?? "none"}`
      : // Every other state goes through the one renderer, so a refused config
        // reads as a refusal here exactly as it does everywhere else — never as
        // "no WAF", which would be a finding this engine invented.
        describeRead(distribution.config, `${distribution.id} configuration`)

  return (
    `${head} · ${config} · ${describeInvalidationBacklog(distribution.invalidationBacklog)}` +
    `${describeTruncation(distribution.invalidationTruncation)} · as of ${distribution.asOf}, ` +
    `configuration refreshed every ${Math.round(distribution.refreshMs.config / 1000)}s`
  )
}

function describeOriginList(origins: readonly OriginReading[]): string {
  if (origins.length === 0) return "no origins reported"
  return origins
    .map((o) => `${o.id} → ${o.domainName ?? "unnamed"}: ${describeOriginProtocol(o.protocol)}`)
    .join(" | ")
}

export interface CdnLine {
  label: string
  text: string
}

/**
 * What a CDN surface prints.
 *
 * The surface agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function cdnLines(readings: CdnReadings): readonly CdnLine[] {
  const lines: CdnLine[] = [
    {
      label: "Distributions",
      text:
        describeRead(
          readings.distributions,
          `distributions read from AWS, refreshed every ${Math.round(readings.refreshMs.distributions / 1000)}s`,
        ) + describeTruncation(readings.truncation),
    },
    { label: "Edge exposure", text: describeEdgeExposure(readings.exposure) },
  ]
  if (readings.invalidationsInFlight.length > 0) {
    lines.push({
      label: "Invalidations in flight",
      text:
        `${readings.invalidationsInFlight.join(", ")} — a deploy's cache purge has not finished, so the ` +
        `edge is still serving the previous objects. This is the usual reason a change that "went out" ` +
        `is not visible.`,
    })
  }
  for (const finding of readings.findings) {
    lines.push({ label: `${finding.distributionId}: ${finding.code}`, text: finding.detail })
  }
  if (readings.distributions.state === "ACTUAL" || readings.distributions.state === "STALE") {
    for (const distribution of readings.distributions.value) {
      lines.push({ label: distribution.id, text: describeDistribution(distribution) })
      if (distribution.config.state === "ACTUAL" || distribution.config.state === "STALE") {
        for (const behaviour of distribution.config.value.behaviours) {
          lines.push({
            label: `${distribution.id} behaviour`,
            text: describeCacheBehaviour(behaviour),
          })
        }
      }
    }
  }
  return lines
}
