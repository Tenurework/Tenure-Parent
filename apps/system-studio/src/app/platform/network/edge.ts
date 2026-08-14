/**
 * STUDIO-080-002 — the edge, as a CHAIN rather than as four tables.
 *
 * ── The question this file answers ─────────────────────────────────────────
 *
 * A tenant hostname reaches this estate through four resources owned by four
 * different AWS services, and it is broken if ANY ONE of them is broken:
 *
 *     Route 53 record  →  CloudFront distribution  →  ACM certificate
 *                                  ↓
 *                          AWS WAF web ACL
 *
 * Four separate tables cannot answer it. `lib/aws/dns.ts` knows a record aliases
 * `d111.cloudfront.net` and nothing about what that distribution serves;
 * `lib/aws/cdn.ts` knows a distribution references an ACM ARN and nothing about
 * whether that certificate validated; `lib/aws/certificates.ts` knows a
 * certificate is `PENDING_VALIDATION` and nothing about which hostname is dark
 * because of it; `lib/aws/waf.ts` knows an ARN carries no web ACL and nothing
 * about whether that ARN is the one a tenant resolves to. This module is the
 * join, and the join is the value: **an operator should be able to read one row
 * and know why a hostname is dark.**
 *
 * ── What it does not do ────────────────────────────────────────────────────
 *
 * It reads nothing. It takes the four readers' already-loaded structures and
 * correlates them. Every AWS call on this surface is made by a reader in
 * `lib/aws/`; a page that reached the SDK directly would be a second, untested
 * path to the same data with none of the `AwsRead` discipline on it.
 *
 * It also does not re-derive what a reader already decided. `hostVerdict()` in
 * `dns.ts` already answers "does this hostname point at one of OUR
 * distributions", guarded on the record read's own pagination; this module calls
 * it rather than matching domain strings itself. A second implementation of that
 * join would be a second place for the guard to be missing.
 *
 * ── Every leg has an "unknown" arm, and it is never the reassuring one ─────
 *
 * The chain is drawn from reads that each fail independently. A refused
 * `acm:ListCertificates` must not render as "no certificate problem", a refused
 * `wafv2:ListWebACLs` must not render as "no WAF" — that is this console
 * inventing a finding — and a refused `route53:ListResourceRecordSets` must not
 * render as "this host does not resolve here". So each leg is a union whose
 * unknown arm carries the sentence saying which read did not answer, and
 * `chainVerdict` cannot reach `intact` while any leg is unknown.
 *
 * A note the ACM leg needs specifically: **`acm:ListCertificates` is regional,
 * and a CloudFront distribution's certificate lives in `us-east-1` whatever
 * region this console runs in.** An ARN this listing does not contain is
 * therefore usually a certificate in another region, NOT a missing certificate,
 * and `not-in-listing` says so with both regions named. Rendering that as
 * "certificate missing" would send an operator to reissue a certificate that
 * exists.
 */

import type { Severity } from "../../../components/md3"
import type {
  CdnReadings,
  CertificateSource,
  DistributionReading,
  OriginReading,
  TlsFloor,
  WebAclAssociation,
} from "../../../lib/aws/cdn"
import type {
  CertificateReading,
  CertificateReadings,
  PendingDnsValidation,
} from "../../../lib/aws/certificates"
import { hostVerdict, type DnsReadings, type HostVerdict } from "../../../lib/aws/dns"
import type { AwsRead } from "../../../lib/aws/read"
import type { Association, ResourceProtection, WafReadings } from "../../../lib/aws/waf"

/* ────────────────────────────────────────────────────────── small shared ── */

/** Whether a read carries a value. Local, so this module imports no page code. */
function carriesValue<T>(read: AwsRead<T>): read is Extract<AwsRead<T>, { value: T }> {
  return read.state === "ACTUAL" || read.state === "STALE"
}

/** Read, and there is genuinely nothing — the arm that is a FACT, not a failure. */
function answeredEmpty(read: AwsRead<unknown>): boolean {
  return read.state === "EMPTY"
}

/* ───────────────────────────────────────────────────────────── the legs ─── */

/**
 * The DNS leg: how a viewer arrives at the hostname.
 *
 * `no-alias` is not a failure. A distribution with no alternate domain name is
 * reached only at its own `*.cloudfront.net` name, which is a legitimate
 * configuration and a different sentence from "the record is missing".
 */
export type DnsLeg =
  | {
      kind: "resolves"
      host: string
      zoneName: string
      recordType: string
      via: "alias" | "cname"
      why: string
    }
  /** The record points at a name this estate does not own. The takeover finding. */
  | { kind: "dangling"; host: string; zoneName: string; target: string; why: string }
  /** It resolves, but not to this distribution. Named, with what it does reach. */
  | { kind: "elsewhere"; host: string; zoneName: string; target: string; what: string; why: string }
  /** Read to the end, and this host is not in the zone. A claim, not a silence. */
  | { kind: "no-record"; host: string; zoneName: string; why: string }
  /** No hosted zone here covers it — its DNS is served somewhere else entirely. */
  | { kind: "no-zone"; host: string; why: string }
  /** The distribution declares no alternate domain name. Not a finding. */
  | { kind: "no-alias"; why: string }
  | { kind: "unknown"; host: string | null; why: string }

/**
 * The certificate leg: what the edge presents, and whether it will keep working.
 *
 * `daysRemaining` is carried as a NUMBER so a table can rank by it. It is absent
 * on every arm that did not read an expiry, so a certificate nobody measured
 * cannot sort into the comfortable end.
 */
export type CertificateLeg =
  | {
      kind: "acm"
      arn: string
      domainName: string
      status: string
      daysRemaining: number | null
      notAfter: string | null
      /** `PENDING_VALIDATION` and what would end it. Empty on a validated cert. */
      waiting: readonly PendingDnsValidation[]
      validation: string
      renewal: string
      expiry: string
    }
  /** The default `*.cloudfront.net` certificate. No custom hostname can use it. */
  | { kind: "cloudfront-default"; why: string }
  /** A legacy IAM-uploaded certificate: ACM knows nothing about it, nor does this. */
  | { kind: "iam"; certificateId: string; why: string }
  /**
   * The ACM listing answered and does not contain this ARN. Almost always a
   * REGION difference, never a missing certificate, and it names both regions.
   */
  | { kind: "not-in-listing"; arn: string; certificateRegion: string | null; why: string }
  | { kind: "unknown"; why: string }

/**
 * The WAF leg: whether anything filters a request before the origin sees it.
 *
 * `attached` carries `blocking` as a THREE-valued field — true, false, or null
 * for "the rules were not readable". `wafv2:GetWebACL` is not in the capability
 * registry, so an ACL that is attached but whose rules could not be described is
 * `null`, and a surface must not print that as protection.
 */
export type WafLeg =
  | { kind: "attached"; webAclId: string; name: string | null; blocking: boolean | null; why: string }
  /** WAF Classic. A different service this engine holds no capability for. */
  | { kind: "classic"; id: string; why: string }
  /** The config was READ and there is no web ACL. The finding. */
  | { kind: "none"; why: string }
  | { kind: "unknown"; why: string }

/** The origin leg: how the edge reaches the application behind it. */
export type OriginLeg =
  | { kind: "plaintext"; origins: readonly string[]; why: string }
  | { kind: "viewer-dependent"; origins: readonly string[]; why: string }
  | { kind: "public-bucket"; origins: readonly string[]; why: string }
  | { kind: "encrypted"; origins: readonly string[] }
  | { kind: "unknown"; why: string }

/* ───────────────────────────────────────────────────────────── the chain ── */

/** One end-to-end path from a hostname to an origin, with every leg named. */
export interface EdgeChain {
  key: string
  /** The hostname this chain is FOR. Null when the distribution has no alias. */
  host: string | null
  distributionId: string
  distributionDomain: string | null
  distributionArn: string | null
  status: string | null
  enabled: boolean | null
  dns: DnsLeg
  certificate: CertificateLeg
  waf: WafLeg
  origin: OriginLeg
  tls: TlsFloor | null
  /** Invalidations still InProgress on this distribution. The deploy answer. */
  invalidationsInFlight: readonly string[]
  /** The weakest leg, in one sentence, or null when nothing on it is wrong. */
  breaks: readonly ChainBreak[]
  /** The worst break's severity, or null when there is none. */
  severity: Severity | null
}

/** One thing wrong with one chain, at one leg. */
export interface ChainBreak {
  leg: "dns" | "certificate" | "waf" | "origin" | "distribution"
  code:
    | "dangling-record"
    | "points-elsewhere"
    | "no-record"
    | "certificate-pending"
    | "certificate-expired"
    | "certificate-expiring"
    | "certificate-unrenewable"
    | "no-waf"
    | "waf-not-blocking"
    | "plaintext-origin"
    | "viewer-dependent-origin"
    | "public-bucket-origin"
    | "distribution-disabled"
  severity: Severity
  detail: string
}

/** Severity order, worst first. Used to rank chains and to pick a headline. */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
}

/* ────────────────────────────────────────────────────────────── DNS leg ─── */

/**
 * One hostname's DNS leg, from the reader's own verdict.
 *
 * `hostVerdict` already carries every guard that matters — it refuses
 * `no-record` unless the zone was read to the end, and refuses to answer at all
 * when the zone listing did not answer. This function only renames its arms into
 * the chain's vocabulary and decides whether the target is THIS distribution.
 */
export function dnsLegOf(verdict: HostVerdict, distributionId: string): DnsLeg {
  switch (verdict.kind) {
    case "points-at-distribution":
      if (verdict.distributionId !== distributionId) {
        return {
          kind: "elsewhere",
          host: verdict.host,
          zoneName: verdict.zoneName,
          target: verdict.distributionDomain,
          what: `CloudFront distribution ${verdict.distributionId}`,
          why:
            `${verdict.host} resolves to distribution ${verdict.distributionId}, not to ` +
            `${distributionId}. Two distributions claiming one alias is a configuration this ` +
            `console reports rather than resolves.`,
        }
      }
      return {
        kind: "resolves",
        host: verdict.host,
        zoneName: verdict.zoneName,
        recordType: verdict.recordType,
        via: verdict.via,
        why: verdict.why,
      }
    case "dangling":
      return {
        kind: "dangling",
        host: verdict.host,
        zoneName: verdict.zoneName,
        target: verdict.target,
        why: verdict.why,
      }
    case "points-elsewhere":
      return {
        kind: "elsewhere",
        host: verdict.host,
        zoneName: verdict.zoneName,
        target: verdict.target,
        what: verdict.what,
        why: verdict.why,
      }
    case "no-record":
      return { kind: "no-record", host: verdict.host, zoneName: verdict.zoneName, why: verdict.why }
    case "no-zone":
      return { kind: "no-zone", host: verdict.host, why: verdict.why }
    case "ambiguous-zone":
      return { kind: "unknown", host: verdict.host, why: verdict.why }
    case "unknown":
      return { kind: "unknown", host: verdict.host, why: verdict.why }
  }
}

/* ────────────────────────────────────────────────────── certificate leg ── */

/**
 * The certificate a distribution presents, joined to the ACM listing.
 *
 * The region caveat in the module header is implemented here, and it is the only
 * reason this is not a one-line map lookup.
 */
export function certificateLegOf(
  source: CertificateSource | null,
  certificates: CertificateReadings,
  listingRegion: string | null,
): CertificateLeg {
  if (source === null) {
    return {
      kind: "unknown",
      why:
        "this distribution's configuration was not read, so which certificate the edge presents is " +
        "unknown. Unknown, not the default certificate.",
    }
  }
  if (source.kind === "cloudfront-default") {
    return {
      kind: "cloudfront-default",
      why:
        "the edge presents CloudFront's own *.cloudfront.net certificate. No custom hostname can be " +
        "served over HTTPS through it — a viewer arriving at a tenant domain gets a name mismatch.",
    }
  }
  if (source.kind === "iam") {
    return {
      kind: "iam",
      certificateId: source.certificateId,
      why:
        "the certificate was uploaded to IAM rather than issued by ACM. ACM does not know about it, " +
        "so nothing renews it and acm:DescribeCertificate cannot state its expiry. " +
        "iam:GetServerCertificate is not in this engine's capability registry.",
    }
  }
  if (source.kind === "unreported") {
    return {
      kind: "unknown",
      why:
        "cloudfront:GetDistributionConfig returned a ViewerCertificate this engine could not read a " +
        "source from. Which certificate the edge presents is unknown.",
    }
  }

  // An ACM ARN. Now: is it in the listing, and did the listing answer at all?
  const arn = source.arn
  const certificateRegion = arnRegionOf(arn)
  if (!carriesValue(certificates.certificates)) {
    if (answeredEmpty(certificates.certificates)) {
      return {
        kind: "not-in-listing",
        arn,
        certificateRegion,
        why: notInListingWhy(arn, certificateRegion, listingRegion, "and returned no certificate"),
      }
    }
    return {
      kind: "unknown",
      why:
        `the distribution presents ACM certificate ${arn}, and acm:ListCertificates did not answer, ` +
        `so its validation state, its expiry and whether AWS will renew it are all unknown. ` +
        `Unknown, not valid.`,
    }
  }

  const found = certificates.certificates.value.find((c) => c.arn === arn)
  if (found === undefined) {
    return {
      kind: "not-in-listing",
      arn,
      certificateRegion,
      why: notInListingWhy(arn, certificateRegion, listingRegion, "and does not contain this ARN"),
    }
  }
  return acmLegOf(found)
}

/** The ARN's region segment, or null. CloudFront's own ARNs carry an empty one. */
function arnRegionOf(arn: string): string | null {
  const parts = arn.split(":")
  return parts.length >= 6 && parts[0] === "arn" ? parts[3] || null : null
}

function notInListingWhy(
  arn: string,
  certificateRegion: string | null,
  listingRegion: string | null,
  what: string,
): string {
  const where = certificateRegion ?? "an unstated region"
  const here = listingRegion ?? "an unresolved region"
  return (
    `acm:ListCertificates answered ${what}. That is almost certainly a REGION difference and not a ` +
    `missing certificate: this listing covers ${here}, ${arn} is in ${where}, and a certificate a ` +
    `CloudFront distribution presents must live in us-east-1 whatever region this console runs in. ` +
    `This engine holds no capability to list another region's certificates, so the expiry and the ` +
    `validation state of this one are NOT known — they are not "fine".`
  )
}

/** One certificate reading as the chain's certificate leg. */
function acmLegOf(certificate: CertificateReading): CertificateLeg {
  const detail = certificate.detail
  if (!carriesValue(detail)) {
    return {
      kind: "unknown",
      why:
        `${certificate.arn} is in the listing as ${certificate.listedStatus ?? "an unstated status"}, ` +
        `and acm:DescribeCertificate did not answer for it, so its expiry, its validation and its ` +
        `renewal eligibility are unknown.`,
    }
  }
  const value = detail.value
  const waiting = value.validation.kind === "pending-dns" ? value.validation.waiting : []
  return {
    kind: "acm",
    arn: certificate.arn,
    domainName: value.domainName,
    status: value.status,
    daysRemaining: value.expiry.kind === "unknown" ? null : value.expiry.daysRemaining,
    notAfter: value.notAfter,
    waiting,
    validation: describeValidationShort(value.validation.kind),
    renewal: describeRenewalShort(value.renewal),
    expiry:
      value.expiry.kind === "unknown"
        ? `expiry unknown — ${value.expiry.why}`
        : value.expiry.kind === "expired"
          ? `EXPIRED ${Math.abs(value.expiry.daysRemaining)} day(s) ago, on ${value.expiry.notAfter}`
          : `${value.expiry.daysRemaining} day(s) left, expires ${value.expiry.notAfter}`,
  }
}

function describeValidationShort(kind: string): string {
  switch (kind) {
    case "validated":
      return "validated"
    case "pending-dns":
      return "PENDING — waiting for a DNS validation record"
    case "pending-email":
      return "PENDING — waiting for an approval email"
    case "failed":
      return "FAILED validation"
    case "not-applicable":
      return "imported — nothing to validate"
    default:
      return "validation unknown"
  }
}

function describeRenewalShort(renewal: { kind: string }): string {
  switch (renewal.kind) {
    case "managed":
      return "ACM manages renewal"
    case "eligible":
      return "eligible for renewal"
    case "ineligible":
      return "NOT eligible for renewal"
    case "imported":
      return "imported — AWS never renews it"
    default:
      return "renewal unknown"
  }
}

/* ───────────────────────────────────────────────────────────── WAF leg ─── */

/**
 * What sits in front of one distribution.
 *
 * Two sources, and they answer different halves. The distribution's own config
 * says whether a web ACL id is set; `wafv2:GetWebACLForResource` — via the WAF
 * reader's per-resource row — says what that ACL actually does. A distribution
 * whose config was refused but whose protection row answered is still knowable,
 * and vice versa, so both are consulted and neither is required.
 */
export function wafLegOf(
  association: WebAclAssociation | null,
  protection: ResourceProtection | undefined,
): WafLeg {
  const fromProtection = protection ? legFromAssociation(protection.association) : null
  if (fromProtection !== null) return fromProtection

  if (association === null) {
    return {
      kind: "unknown",
      why:
        "this distribution's configuration was not read and no WAF association was read for it " +
        "either, so whether anything filters requests before the origin is unknown. Unknown, not " +
        "unprotected — reporting a finding this engine did not establish is the same defect as " +
        "suppressing one it did.",
    }
  }
  switch (association.kind) {
    case "associated":
      return {
        kind: "attached",
        webAclId: association.webAclId,
        name: null,
        blocking: null,
        why: association.why,
      }
    case "none":
      return { kind: "none", why: association.why }
    case "unreported":
      return { kind: "unknown", why: association.why }
  }
}

/** The WAF reader's own per-resource answer, when it produced one. */
function legFromAssociation(read: AwsRead<Association>): WafLeg | null {
  if (read.state === "EMPTY") {
    return {
      kind: "none",
      why:
        "wafv2:GetWebACLForResource answered and there is NO web ACL in front of this distribution. " +
        "This is a successful read returning nothing, not a refusal: every request that resolves the " +
        "edge is forwarded to the origin unfiltered, unrated and unlogged by WAF.",
    }
  }
  if (!carriesValue(read)) return null
  const association = read.value
  if (association.kind === "waf-classic") {
    return { kind: "classic", id: association.id, why: association.why }
  }
  const detail = association.detail
  return {
    kind: "attached",
    webAclId: association.arn,
    name: association.name,
    blocking: detail.kind === "read" ? detail.blocks : null,
    why:
      detail.kind === "read"
        ? detail.blocks
          ? `web ACL ${association.name ?? association.arn} is attached and at least one of its rules can stop a request.`
          : `web ACL ${association.name ?? association.arn} is attached and NOT ONE of its rules can stop a request — every rule is in count mode or overridden to count. It matches and records; it blocks nothing.`
        : detail.why,
  }
}

/* ───────────────────────────────────────────────────────────── origin leg ── */

/** How the edge reaches the application, folded across a distribution's origins. */
export function originLegOf(origins: readonly OriginReading[] | null): OriginLeg {
  if (origins === null) {
    return {
      kind: "unknown",
      why:
        "this distribution's configuration was not read, so how the edge reaches its origin is " +
        "unknown. Unknown, not encrypted.",
    }
  }
  const label = (o: OriginReading) => `${o.id} → ${o.domainName ?? "unnamed"}`
  const plaintext = origins.filter((o) => o.protocol.kind === "plaintext")
  if (plaintext.length > 0) {
    return {
      kind: "plaintext",
      origins: plaintext.map(label),
      why:
        "origin_protocol_policy is http-only. TLS terminates at the edge and is not resumed: every " +
        "request CloudFront forwards, session cookies included, crosses the network in the clear.",
    }
  }
  const bucket = origins.filter(
    (o) => o.protocol.kind === "s3-managed" && o.protocol.access === "public",
  )
  if (bucket.length > 0) {
    return {
      kind: "public-bucket",
      origins: bucket.map(label),
      why:
        "an S3 origin with neither an origin access control nor an origin access identity. The " +
        "bucket is reachable without going through the edge at all, so every control on the " +
        "distribution — WAF, geo restriction, signed URLs — can be walked around.",
    }
  }
  const viewer = origins.filter((o) => o.protocol.kind === "viewer-dependent")
  if (viewer.length > 0) {
    return {
      kind: "viewer-dependent",
      origins: viewer.map(label),
      why:
        "origin_protocol_policy is match-viewer: the edge reaches this origin over whatever protocol " +
        "the VIEWER used, so a viewer arriving over HTTP produces an unencrypted edge-to-origin hop.",
    }
  }
  const unreported = origins.filter((o) => o.protocol.kind === "unreported")
  if (unreported.length > 0) {
    return {
      kind: "unknown",
      why:
        `${unreported.length} origin(s) came back with no protocol policy this engine models, so how ` +
        `the edge reaches them is unknown rather than encrypted.`,
    }
  }
  return { kind: "encrypted", origins: origins.map(label) }
}

/* ─────────────────────────────────────────────────────────── the breaks ─── */

/**
 * Everything wrong with one chain, worst first.
 *
 * Exported and pure because it is the derivation that decides what an operator
 * looks at first, and a ranking a reviewer cannot read on its own is one nobody
 * checks. Note what is NOT here: no arm is produced by an `unknown` leg. An
 * unread certificate is not a finding, it is an absence of knowledge, and the
 * `unverified` arm of the verdict is where that gets said.
 */
export function chainBreaks(chain: {
  dns: DnsLeg
  certificate: CertificateLeg
  waf: WafLeg
  origin: OriginLeg
  enabled: boolean | null
  host: string | null
}): readonly ChainBreak[] {
  const breaks: ChainBreak[] = []

  if (chain.dns.kind === "dangling") {
    breaks.push({
      leg: "dns",
      code: "dangling-record",
      severity: "critical",
      detail:
        `${chain.dns.host} in ${chain.dns.zoneName} points at ${chain.dns.target}, which this ` +
        `account does not own. That name is re-registrable by anyone, and this record keeps sending ` +
        `this estate's users at it. ${chain.dns.why}`,
    })
  }
  if (chain.dns.kind === "elsewhere") {
    breaks.push({
      leg: "dns",
      code: "points-elsewhere",
      severity: "high",
      detail:
        `${chain.dns.host} resolves to ${chain.dns.target} (${chain.dns.what}) rather than to this ` +
        `distribution. Whatever this distribution serves, that hostname does not reach it.`,
    })
  }
  if (chain.dns.kind === "no-record") {
    breaks.push({
      leg: "dns",
      code: "no-record",
      severity: "high",
      detail:
        `this distribution declares ${chain.dns.host} as an alternate domain name and ${chain.dns.zoneName} ` +
        `was read to the end with no address record for it. The hostname does not resolve here at ` +
        `all: a tenant pointed at it reaches nothing.`,
    })
  }

  if (chain.certificate.kind === "acm") {
    const cert = chain.certificate
    if (cert.status === "PENDING_VALIDATION" || cert.waiting.length > 0) {
      breaks.push({
        leg: "certificate",
        code: "certificate-pending",
        severity: "critical",
        detail:
          `certificate ${cert.arn} is ${cert.status} — ${cert.validation}. ACM will not issue it ` +
          `until the validation record exists, and a tenant provision waiting on this certificate ` +
          `does not finish. This is the commonest cause of a provision that stalls with no error.` +
          (cert.waiting.length > 0
            ? ` Waiting on: ${cert.waiting
                .map((w) =>
                  w.record.kind === "cname"
                    ? `${w.domain} needs CNAME ${w.record.name} → ${w.record.value}`
                    : `${w.domain} — ${w.record.why}`,
                )
                .join("; ")}.`
            : ""),
      })
    }
    if (cert.daysRemaining !== null && cert.daysRemaining < 0) {
      breaks.push({
        leg: "certificate",
        code: "certificate-expired",
        severity: "critical",
        detail: `certificate ${cert.arn} EXPIRED — ${cert.expiry}. Every viewer gets a TLS error.`,
      })
    } else if (cert.daysRemaining !== null && cert.daysRemaining <= 30) {
      breaks.push({
        leg: "certificate",
        code: "certificate-expiring",
        severity: cert.daysRemaining <= 7 ? "critical" : "high",
        detail: `certificate ${cert.arn} — ${cert.expiry}. ${cert.renewal}.`,
      })
    }
    if (cert.renewal.startsWith("NOT eligible") || cert.renewal.startsWith("imported")) {
      breaks.push({
        leg: "certificate",
        code: "certificate-unrenewable",
        severity: "high",
        detail:
          `certificate ${cert.arn} — ${cert.renewal}. Nobody is coming: when it lapses it lapses, ` +
          `and ${cert.expiry}.`,
      })
    }
  }
  if (chain.certificate.kind === "cloudfront-default" && chain.host !== null) {
    breaks.push({
      leg: "certificate",
      code: "certificate-pending",
      severity: "high",
      detail:
        `${chain.host} is served by a distribution presenting CloudFront's default certificate. ` +
        `${chain.certificate.why}`,
    })
  }

  if (chain.waf.kind === "none") {
    breaks.push({
      leg: "waf",
      code: "no-waf",
      severity: "high",
      detail: chain.waf.why,
    })
  }
  if (chain.waf.kind === "attached" && chain.waf.blocking === false) {
    breaks.push({
      leg: "waf",
      code: "waf-not-blocking",
      severity: "medium",
      detail: chain.waf.why,
    })
  }

  if (chain.origin.kind === "plaintext") {
    breaks.push({
      leg: "origin",
      code: "plaintext-origin",
      severity: "critical",
      detail: `${chain.origin.origins.join(", ")} — ${chain.origin.why}`,
    })
  }
  if (chain.origin.kind === "public-bucket") {
    breaks.push({
      leg: "origin",
      code: "public-bucket-origin",
      severity: "high",
      detail: `${chain.origin.origins.join(", ")} — ${chain.origin.why}`,
    })
  }
  if (chain.origin.kind === "viewer-dependent") {
    breaks.push({
      leg: "origin",
      code: "viewer-dependent-origin",
      severity: "high",
      detail: `${chain.origin.origins.join(", ")} — ${chain.origin.why}`,
    })
  }

  if (chain.enabled === false) {
    breaks.push({
      leg: "distribution",
      code: "distribution-disabled",
      severity: "medium",
      detail:
        "the distribution is DISABLED. CloudFront serves nothing from it, whatever the DNS record, " +
        "the certificate and the web ACL say.",
    })
  }

  return [...breaks].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

/* ────────────────────────────────────────────────────────────── verdict ─── */

/**
 * Whether the edge holds, and what it is allowed to claim.
 *
 * `intact` is reachable ONLY when every chain was built from legs that all
 * answered. `unverified` is the arm that exists so a clean screen is never read
 * as a clean bill — it names the chains carrying an unknown leg and refuses the
 * comfortable sentence.
 */
export type EdgeVerdict =
  | { kind: "unknown"; why: string }
  /** No distribution at all, and the listing said so. There is no edge to grade. */
  | { kind: "no-edge"; why: string }
  | {
      kind: "broken"
      breaks: readonly (ChainBreak & { key: string; host: string | null; distributionId: string })[]
      chainsChecked: number
      unverified: readonly string[]
      headline: Severity
    }
  | { kind: "unverified"; why: string; unverified: readonly string[]; chainsChecked: number }
  | { kind: "intact"; chainsChecked: number }

/** Every leg that carries no knowledge, for one chain. Empty when all answered. */
export function unknownLegs(chain: EdgeChain): readonly string[] {
  const unknown: string[] = []
  if (chain.dns.kind === "unknown") unknown.push("DNS")
  if (chain.certificate.kind === "unknown" || chain.certificate.kind === "not-in-listing") {
    unknown.push("certificate")
  }
  if (chain.waf.kind === "unknown") unknown.push("WAF")
  if (chain.origin.kind === "unknown") unknown.push("origin")
  return unknown
}

export function edgeVerdict(
  distributions: AwsRead<readonly DistributionReading[]>,
  chains: readonly EdgeChain[],
): EdgeVerdict {
  if (answeredEmpty(distributions)) {
    return {
      kind: "no-edge",
      why:
        "cloudfront:ListDistributions answered and this account holds no distribution. There is no " +
        "CloudFront edge in front of this estate — which is a fact about the estate, not a posture " +
        "verdict, and says nothing about what reaches the load balancers directly.",
    }
  }
  if (!carriesValue(distributions)) {
    return {
      kind: "unknown",
      why:
        "the distribution listing did not answer, so no chain from a hostname to an origin can be " +
        "drawn at all. This console therefore knows of no broken edge and of no absence of one.",
    }
  }

  const unverified = chains
    .filter((c) => unknownLegs(c).length > 0)
    .map((c) => `${c.host ?? c.distributionId} (${unknownLegs(c).join(", ")} unread)`)

  const breaks = chains.flatMap((c) =>
    c.breaks.map((b) => ({ ...b, key: c.key, host: c.host, distributionId: c.distributionId })),
  )
  if (breaks.length > 0) {
    const sorted = [...breaks].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    return {
      kind: "broken",
      breaks: sorted,
      chainsChecked: chains.length,
      unverified,
      headline: sorted[0].severity,
    }
  }
  if (unverified.length > 0) {
    return {
      kind: "unverified",
      why:
        `no break was established on any of the ${chains.length} chain(s) drawn, and ` +
        `${unverified.length} of them carries a leg this engine could not read. An absence of ` +
        `findings over reads that did not answer is not evidence the edge holds.`,
      unverified,
      chainsChecked: chains.length,
    }
  }
  return { kind: "intact", chainsChecked: chains.length }
}

/* ────────────────────────────────────────────────────────── the assembly ── */

/** Everything the network surface's edge section renders. */
export interface EdgeAnswer {
  chains: readonly EdgeChain[]
  verdict: EdgeVerdict
  /**
   * Records pointing at names this estate does not own, INCLUDING the ones with
   * no distribution to chain from. A takeover on a record that aliases a deleted
   * S3 website endpoint would otherwise never appear on this page.
   */
  takeovers: readonly {
    key: string
    zoneName: string
    recordName: string
    recordType: string
    target: string
    why: string
  }[]
  /** Certificates ranked by days remaining. The number is the sort key. */
  certificates: readonly CertificateRow[]
  /** Distributions with a purge still running. The deploy-visibility answer. */
  invalidations: readonly { distributionId: string; ids: readonly string[]; why: string }[]
  /** The lead sentence, and the tone the badge takes. */
  lead: { verdict: string; because: string; tone: "neutral" | "info" | "ok" | "warn" | "bad" }
}

/** One certificate, flattened for a table that ranks by expiry. */
export interface CertificateRow {
  key: string
  arn: string
  domainName: string
  status: string
  /** Signed. Null only when the expiry was never read — those sort last, named. */
  daysRemaining: number | null
  expiry: string
  validation: string
  renewal: string
  /** The exact CNAME still required, when validation is pending. */
  waiting: readonly PendingDnsValidation[]
  /** What breaks when it lapses. Empty is itself part of why a renewal goes ineligible. */
  inUseBy: readonly string[]
  severity: Severity
  attribution: string
}

/**
 * The whole edge section, from the four readers.
 *
 * One entry point, called once by the page. Every argument is an already-loaded
 * reading; nothing in this file talks to AWS.
 */
export function edgeAnswer(
  cdn: CdnReadings,
  dns: DnsReadings,
  certificates: CertificateReadings,
  waf: WafReadings,
): EdgeAnswer {
  const listingRegion = identityRegionOf(certificates)
  const protectionByArn = new Map<string, ResourceProtection>()
  for (const row of waf.protection) protectionByArn.set(row.target.arn, row)

  const chains: EdgeChain[] = []
  if (carriesValue(cdn.distributions)) {
    for (const distribution of cdn.distributions.value) {
      const config = carriesValue(distribution.config) ? distribution.config.value : null
      const inFlight =
        distribution.invalidationBacklog.kind === "in-flight"
          ? distribution.invalidationBacklog.ids
          : []
      const certificate = certificateLegOf(
        config === null ? null : sourceOf(config.tls),
        certificates,
        listingRegion,
      )
      const wafLeg = wafLegOf(
        config === null ? null : config.waf,
        distribution.arn === null ? undefined : protectionByArn.get(distribution.arn),
      )
      const origin = originLegOf(config === null ? null : config.origins)
      const aliases = config?.aliases ?? distribution.aliases

      // One chain per alternate domain name: they are separate hostnames with
      // separate DNS records, and one of them dangling while the other resolves
      // is exactly the state a per-distribution row would hide.
      const hosts = aliases.length > 0 ? aliases : [null]
      for (const host of hosts) {
        const dnsLeg: DnsLeg =
          host === null
            ? {
                kind: "no-alias",
                why:
                  "this distribution declares no alternate domain name, so it is reached only at its " +
                  "own CloudFront domain. No Route 53 record is required and none is missing.",
              }
            : dnsLegOf(hostVerdict(dns, host), distribution.id)
        const partial = {
          dns: dnsLeg,
          certificate,
          waf: wafLeg,
          origin,
          enabled: distribution.enabled,
          host,
        }
        const breaks = chainBreaks(partial)
        chains.push({
          key: `${distribution.id}::${host ?? "no-alias"}`,
          host,
          distributionId: distribution.id,
          distributionDomain: distribution.domainName,
          distributionArn: distribution.arn,
          status: distribution.status,
          enabled: distribution.enabled,
          dns: dnsLeg,
          certificate,
          waf: wafLeg,
          origin,
          tls: config?.tls ?? null,
          invalidationsInFlight: inFlight,
          breaks,
          severity: breaks.length > 0 ? breaks[0].severity : null,
        })
      }
    }
  }

  chains.sort((a, b) => {
    const left = a.severity === null ? 99 : SEVERITY_RANK[a.severity]
    const right = b.severity === null ? 99 : SEVERITY_RANK[b.severity]
    if (left !== right) return left - right
    return a.key.localeCompare(b.key)
  })

  const verdict = edgeVerdict(cdn.distributions, chains)

  const takeovers =
    dns.takeover.kind === "dangling"
      ? dns.takeover.risks.map((risk) => ({
          key: `${risk.zoneId}::${risk.recordName}::${risk.recordType}`,
          zoneName: risk.zoneName,
          recordName: risk.recordName,
          recordType: risk.recordType,
          target: risk.target,
          why: risk.why,
        }))
      : []

  return {
    chains,
    verdict,
    takeovers,
    certificates: certificateRows(certificates),
    invalidations: invalidationRows(cdn),
    lead: leadOf(verdict, takeovers.length),
  }
}

/** The ACM listing's own region, from the resolved identity. Never a literal. */
function identityRegionOf(certificates: CertificateReadings): string | null {
  return carriesValue(certificates.identity) ? certificates.identity.value.region : null
}

/** A `TlsFloor`'s certificate source. Present on every arm, so this is total. */
function sourceOf(tls: TlsFloor): CertificateSource {
  return tls.certificateSource
}

/**
 * Every certificate, ranked by how long it has left.
 *
 * `daysRemaining` is the sort key and it is a NUMBER. A certificate whose expiry
 * was never read has `null` and sorts LAST with the reason printed — not into
 * the comfortable end of the table, and not as a zero.
 */
export function certificateRows(certificates: CertificateReadings): readonly CertificateRow[] {
  if (!carriesValue(certificates.certificates)) return []
  const rows = certificates.certificates.value.map((certificate): CertificateRow => {
    const detail = certificate.detail
    if (!carriesValue(detail)) {
      return {
        key: certificate.arn,
        arn: certificate.arn,
        domainName: certificate.domainName,
        status: certificate.listedStatus ?? "status not returned by the listing",
        daysRemaining: null,
        expiry: `expiry unknown — acm:DescribeCertificate did not answer (${detail.state})`,
        validation: "validation unknown — the detail read did not answer",
        renewal: "renewal unknown — the detail read did not answer",
        waiting: [],
        inUseBy: [],
        severity: "medium",
        attribution: describeAttribution(certificate.attribution),
      }
    }
    const value = detail.value
    const days = value.expiry.kind === "unknown" ? null : value.expiry.daysRemaining
    return {
      key: certificate.arn,
      arn: certificate.arn,
      domainName: value.domainName,
      status: value.status,
      daysRemaining: days,
      expiry:
        value.expiry.kind === "unknown"
          ? `expiry unknown — ${value.expiry.why}`
          : value.expiry.kind === "expired"
            ? `EXPIRED ${Math.abs(value.expiry.daysRemaining)} day(s) ago, on ${value.expiry.notAfter}`
            : `${value.expiry.daysRemaining} day(s) left, expires ${value.expiry.notAfter}`,
      validation: describeValidationShort(value.validation.kind),
      renewal: describeRenewalShort(value.renewal),
      waiting: value.validation.kind === "pending-dns" ? value.validation.waiting : [],
      inUseBy: value.inUseBy,
      severity: certificateSeverity(value.status, days),
      attribution: describeAttribution(certificate.attribution),
    }
  })
  return rows.sort((a, b) => {
    if (a.daysRemaining === null && b.daysRemaining === null) return a.arn.localeCompare(b.arn)
    if (a.daysRemaining === null) return 1
    if (b.daysRemaining === null) return -1
    return a.daysRemaining - b.daysRemaining
  })
}

/** How urgent one certificate is. `PENDING_VALIDATION` is critical on its own. */
export function certificateSeverity(status: string, daysRemaining: number | null): Severity {
  if (status === "PENDING_VALIDATION") return "critical"
  if (status === "EXPIRED" || status === "FAILED" || status === "REVOKED") return "critical"
  if (daysRemaining === null) return "medium"
  if (daysRemaining < 0) return "critical"
  if (daysRemaining <= 7) return "critical"
  if (daysRemaining <= 30) return "high"
  if (daysRemaining <= 60) return "medium"
  return "low"
}

function describeAttribution(attribution: { kind: string; tenantSlug?: string }): string {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug ?? "tenant"
    case "shared":
      return "shared — platform overhead"
    case "unattributed":
      return "unattributable — missing tenure:tenant"
    default:
      return "attribution unknown"
  }
}

/** Distributions with a purge still running, from the reader's own backlog arm. */
export function invalidationRows(
  cdn: CdnReadings,
): readonly { distributionId: string; ids: readonly string[]; why: string }[] {
  if (!carriesValue(cdn.distributions)) return []
  return cdn.distributions.value
    .filter((d) => d.invalidationBacklog.kind === "in-flight")
    .map((d) => {
      const backlog = d.invalidationBacklog
      return {
        distributionId: d.id,
        ids: backlog.kind === "in-flight" ? backlog.ids : [],
        why: backlog.kind === "in-flight" ? backlog.why : "",
      }
    })
}

/** The sentence at the top, and the tone the badge takes. */
export function leadOf(
  verdict: EdgeVerdict,
  takeovers: number,
): { verdict: string; because: string; tone: "neutral" | "info" | "ok" | "warn" | "bad" } {
  if (takeovers > 0) {
    return {
      verdict: "Subdomain takeover",
      because:
        `${takeovers} DNS record(s) in this account point at names this account does not own. That ` +
        `is a subdomain takeover: the target is re-registrable by anyone, and until the record is ` +
        `removed this estate keeps sending its own users at whatever is registered there next. ` +
        `Nothing else on this page outranks it.`,
      tone: "bad",
    }
  }
  switch (verdict.kind) {
    case "unknown":
      return {
        verdict: "Edge not read",
        because: verdict.why,
        tone: "warn",
      }
    case "no-edge":
      return { verdict: "No CloudFront edge", because: verdict.why, tone: "info" }
    case "broken":
      return {
        verdict: verdict.headline === "critical" ? "Edge broken" : "Edge degraded",
        because:
          `${verdict.breaks.length} break(s) across ${verdict.chainsChecked} chain(s) from a hostname ` +
          `to an origin. The first row below is the one to fix first: ${verdict.breaks[0].detail}`,
        tone: verdict.headline === "critical" ? "bad" : "warn",
      }
    case "unverified":
      return { verdict: "Edge unverified", because: verdict.why, tone: "warn" }
    case "intact":
      return {
        verdict: "Edge intact",
        because:
          `every one of the ${verdict.chainsChecked} chain(s) from a hostname to an origin was read ` +
          `end to end — DNS record, distribution, certificate, web ACL and origin protocol — and not ` +
          `one of them carries a break. This is an absence established by reads that ran.`,
        tone: "ok",
      }
  }
}
