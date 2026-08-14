/**
 * STUDIO-070-004 (ACM) — the certificates the Global Deployment Engine depends
 * on, why one of them is stuck, and which one AWS is not going to renew.
 *
 * `infrastructure/terraform/acm.tf` provisions certificates and nothing in the
 * running console has ever asked ACM a second question about them.
 * `inventory.ts` and `health.ts` both call `acm:ListCertificates`, which answers
 * with an ARN, a domain and a one-word `Status`. That is the whole of what this
 * platform can see about TLS today, and it is not enough to diagnose either of
 * the two failures that actually happen:
 *
 * **A certificate PENDING_VALIDATION forever.** ACM issues a DNS-validated
 * certificate only once a specific CNAME exists in the zone. When that record was
 * never created — a hosted zone in another account, a Terraform apply that failed
 * halfway, a domain delegated somewhere else — the certificate sits at
 * `PENDING_VALIDATION` indefinitely, the listener it was meant for never gets a
 * certificate, and tenant provisioning stops with no error anywhere. The listing
 * shows `PENDING_VALIDATION` and stops. The record that must exist is in
 * `DescribeCertificate`'s `DomainValidationOptions[].ResourceRecord`, and this
 * module carries it out verbatim — name, type and value — because the remedy is
 * to paste it into a zone, and an operator who has to go and find it will not.
 *
 * **A certificate that expires because AWS was never going to renew it.**
 * Managed renewal is not a property of having bought a certificate: ACM can only
 * renew a certificate it can revalidate, and `RenewalEligibility: INELIGIBLE`
 * plus an `IMPORTED` type both mean nobody is coming. `Status` stays `ISSUED`
 * right up until the moment it does not, so the listing is reassuring for
 * thirteen months and then the site is down. The expiry is in `NotAfter`,
 * eligibility is in `RenewalEligibility`, and the two together are the finding.
 *
 * ## Two capabilities, two readings, on purpose
 *
 * `acm:ListCertificates` and `acm:DescribeCertificate` are separate IAM actions,
 * and in this estate they are separately scoped — `iam.tf` grants the first on
 * `*` and the second on `arn:*:acm:*:*:certificate/*`. A role can hold one
 * without the other. Folding the detail reads into the listing would make a
 * refused `DescribeCertificate` render as "refused acm:ListCertificates", so the
 * statement an operator pastes into a policy would not contain the action that is
 * actually missing: they would grant it, redeploy, and be refused identically.
 * `sqs.ts` is built this way for the same reason and says so.
 *
 * So the listing is one `AwsRead`, and EVERY certificate carries its own
 * `AwsRead` for its detail. A certificate whose detail was refused still appears,
 * saying it was refused — it does not vanish, and its validation does not render
 * as "validated", its expiry does not render as a comfortable number of days, and
 * its renewal does not render as "managed".
 *
 * ## Days remaining is a number, and it is signed
 *
 * A surface has to be able to rank by "closest to expiry", so `ExpiryState`
 * carries `daysRemaining` as a number rather than a sentence. It goes NEGATIVE
 * past `NotAfter` — an expired certificate must sort ahead of one with a day
 * left, and clamping at zero would bury it in the middle of the table. When AWS
 * stated no `NotAfter` the arm is `unknown` and there is no number at all, so a
 * caller cannot sort an unread certificate into the safe end of the list.
 *
 * ## Region, partition and account
 *
 * From the certificate's OWN ARN, which AWS returned, and from the resolved
 * identity where there is no ARN to read. There is no literal region in this file
 * and no `"aws"` partition fallback. That matters more for ACM than for most
 * services: a CloudFront distribution's certificate must live in us-east-1 while
 * the load balancer's lives in the estate's region, so this module reads two
 * regions in one account as a matter of course and a hardcoded one would be
 * wrong for at least half the list. GE-010-007 was exactly this defect.
 *
 * ## Attribution
 *
 * Through `tags.ts` and the Resource Groups Tagging API, so a certificate
 * attributes the same way a queue does. `tags.ts` keeps `shared` (somebody
 * decided) and `unattributed` (nobody tagged it) apart; this module adds a fourth
 * answer, `unknown`, for when the tag index itself could not be read. "We could
 * not look up this certificate's tags" is not "this certificate has no tenant
 * tag", and sending an operator to add a tag that is already there is the small
 * daily cost of collapsing them.
 *
 * ## What this module does not do
 *
 * It reads. There is no issue, no delete, no `RequestCertificate`, no
 * `ResendValidationEmail`, and no path from anything here into `mutate.ts`. The
 * CNAME it surfaces is a record for a human to create; this engine does not
 * create it, and `certificates.ts` holds no Route 53 write capability to do so.
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
 * How many `ListCertificates` pages to walk before stopping.
 *
 * A reader with no bound is how one server render becomes an outage; a reader
 * that silently returns the first page is the same lie as an empty list. So it
 * is capped AND the cap is reported: hitting it produces a `truncated` page
 * bound naming how much was read, which every renderer here prints.
 */
export const MAX_CERTIFICATE_PAGES = 20

/**
 * How many certificates get a detail read in one load.
 *
 * `DescribeCertificate` is one call per certificate against an account-wide ACM
 * throttle. This estate has a handful; the cap exists so an account that has
 * grown a thousand does not turn one page render into a thousand API calls.
 *
 * Certificates past the cap are NOT dropped and do not render as valid: they
 * carry an UNCONFIGURED detail whose `why` says the engine stopped, which is a
 * different sentence from "this certificate is fine".
 */
export const MAX_CERTIFICATE_DETAIL_READS = 200

/** How many detail reads are in flight at once. Bounded so one load is not a burst. */
const DETAIL_CONCURRENCY = 8

/**
 * The window inside which an un-renewable certificate is a finding.
 *
 * Sixty days because that is when ACM's own managed renewal starts for a
 * certificate it CAN renew: past this point a certificate that has not been
 * renewed is one that is not going to be, and the remaining time is the time
 * somebody has to do it by hand.
 */
export const RENEWAL_HORIZON_DAYS = 60

const MS_PER_DAY = 86_400_000

/* ---------------------------------------------------------------- shapes -- */

/**
 * The API's shapes, declared rather than imported — see client.ts's one-owner
 * rule. Exported where an exported function takes one as a parameter, so a
 * caller can name the type it has to construct rather than inferring it.
 */
interface ListCertificatesResponse {
  CertificateSummaryList?: Array<{
    CertificateArn?: string
    DomainName?: string
    Status?: string
  }>
  NextToken?: string
}

export interface ResourceRecordShape {
  Name?: string
  Type?: string
  Value?: string
}

export interface DomainValidationShape {
  DomainName?: string
  ValidationStatus?: string
  ValidationMethod?: string
  ValidationDomain?: string
  ValidationEmails?: string[]
  ResourceRecord?: ResourceRecordShape
}

export interface DescribeCertificateResponse {
  Certificate?: {
    CertificateArn?: string
    DomainName?: string
    SubjectAlternativeNames?: string[]
    DomainValidationOptions?: DomainValidationShape[]
    Status?: string
    Type?: string
    KeyAlgorithm?: string
    InUseBy?: string[]
    FailureReason?: string
    RevocationReason?: string
    RenewalEligibility?: string
    NotBefore?: Date | string
    NotAfter?: Date | string
    CreatedAt?: Date | string
    IssuedAt?: Date | string
    ImportedAt?: Date | string
    RevokedAt?: Date | string
    RenewalSummary?: {
      RenewalStatus?: string
      RenewalStatusReason?: string
      UpdatedAt?: Date | string
      DomainValidationOptions?: DomainValidationShape[]
    }
  }
}

/* ------------------------------------------------------------- the types -- */

/**
 * The DNS record ACM is waiting for, or the reason there is not one to state.
 *
 * `absent` is its own arm rather than a null field. ACM computes the record when
 * it accepts the request and it is normally there immediately, but a missing one
 * is a real observation — and a surface printing an empty CNAME row would be
 * telling an operator to create a record with no name and no value.
 */
export type ValidationRecord =
  | { kind: "cname"; name: string; type: string; value: string }
  | { kind: "absent"; why: string }

/** One domain still waiting on DNS validation, with the record that would end it. */
export interface PendingDnsValidation {
  domain: string
  /** The exact record that must exist. Carried verbatim from AWS, never assembled. */
  record: ValidationRecord
}

/** One domain waiting on email validation, with where the mail went. */
export interface PendingEmailValidation {
  domain: string
  validationDomain: string | null
  emails: readonly string[]
}

/**
 * Whether a certificate's domains are validated, and if not, what is missing.
 *
 * `not-applicable` and `unknown` are separate arms and always will be. An
 * IMPORTED certificate has no validation to do — that is a fact — while a
 * certificate whose `DomainValidationOptions` AWS did not return is one this
 * engine cannot speak for. Folding the second into the first is how a broken read
 * renders as "nothing to do here".
 */
export type ValidationState =
  | { kind: "validated"; domains: readonly string[] }
  | { kind: "pending-dns"; waiting: readonly PendingDnsValidation[] }
  | { kind: "pending-email"; waiting: readonly PendingEmailValidation[] }
  | { kind: "failed"; domains: readonly string[]; why: string }
  | { kind: "not-applicable"; why: string }
  | { kind: "unknown"; why: string }

/**
 * Whether AWS will renew this certificate before it expires.
 *
 * `ineligible` and `imported` are separate from `unknown` because they are
 * findings with different remedies — reattach the certificate to something ACM
 * can validate through, versus import a new one — and both are different from
 * "we could not tell", which is not a remedy at all.
 */
export type RenewalState =
  /** ACM has started or completed a managed renewal. `status` is AWS's own word. */
  | { kind: "managed"; status: string; statusReason: string | null; updatedAt: string | null }
  /** Eligible, and no renewal is under way yet. Normal outside the 60-day window. */
  | { kind: "eligible"; why: string }
  /** ACM will not renew this. The finding. */
  | { kind: "ineligible"; why: string }
  /** Imported: AWS never renews these, whatever else it says. */
  | { kind: "imported"; why: string }
  | { kind: "unknown"; why: string }

/**
 * How long this certificate has left.
 *
 * `daysRemaining` is signed and is the only number a surface should rank on. It
 * is absent entirely on `unknown`, so a certificate whose `NotAfter` was never
 * read cannot be sorted into the comfortable end of a table.
 */
export type ExpiryState =
  | { kind: "expires"; notAfter: string; daysRemaining: number }
  | { kind: "expired"; notAfter: string; daysRemaining: number }
  | { kind: "unknown"; why: string }

/**
 * Which tenant a certificate belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express — see
 * the module header.
 */
export type CertificateAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/** Everything one `DescribeCertificate` answered, parsed. */
export interface CertificateDetail {
  arn: string
  domainName: string
  /** Every name this certificate covers, including the primary. Sorted, deduplicated. */
  subjectAlternativeNames: readonly string[]
  /** AWS's own `Status` word: ISSUED, PENDING_VALIDATION, EXPIRED, FAILED, … */
  status: string
  /** AMAZON_ISSUED, IMPORTED or PRIVATE. Null when AWS did not say. */
  type: string | null
  keyAlgorithm: string | null
  /**
   * The resources this certificate is attached to — load balancers, CloudFront
   * distributions, API Gateway domains. Empty is meaningful: an unattached
   * certificate is one AWS cannot revalidate through, which is half of why a
   * renewal goes ineligible.
   */
  inUseBy: readonly string[]
  validation: ValidationState
  renewal: RenewalState
  expiry: ExpiryState
  /** AWS's own `RenewalEligibility`, kept raw alongside the interpreted `renewal`. */
  renewalEligibility: string | null
  notBefore: string | null
  notAfter: string | null
  createdAt: string | null
  issuedAt: string | null
  importedAt: string | null
  revokedAt: string | null
  revocationReason: string | null
  failureReason: string | null
}

/** One certificate as a surface sees it: the summary, plus its own detail reading. */
export interface CertificateReading {
  arn: string
  /** From the listing. A label; the authoritative domain is in the detail. */
  domainName: string
  /** The listing's `Status`. Present even when the detail read was refused. */
  listedStatus: string | null
  region: string | null
  partition: string | null
  accountId: string | null
  attribution: CertificateAttribution
  /** Refused, throttled, broken, capped or read — per certificate, with its own action. */
  detail: AwsRead<CertificateDetail>
  /** This certificate's detail cadence, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/**
 * Whether the listing was walked to completion.
 *
 * A bound with no signal is a partial answer wearing a complete answer's clothes.
 * `truncated` names how much was read so a surface can say "the first N of an
 * unknown number", and `not-read` exists because a denied listing has no pages at
 * all and must not report itself as complete.
 */
export type PageBound =
  | { kind: "complete"; pagesRead: number; certificatesRead: number }
  | { kind: "truncated"; pagesRead: number; certificatesRead: number; why: string }
  | { kind: "not-read"; why: string }

/** A certificate stuck at PENDING_VALIDATION, with the record that would unstick it. */
export interface StuckValidation {
  arn: string
  domainName: string
  /** From `CreatedAt`. Null when AWS stated none — not zero, which would read as "just now". */
  pendingForDays: number | null
  waiting: readonly PendingDnsValidation[]
  attribution: CertificateAttribution
}

/**
 * Whether anything is stuck waiting for a validation record.
 *
 * Lifted out of the certificate table because it is the single most common cause
 * of a tenant provisioning run that never finishes, and a row in a table is how
 * it stays unread for a week. Every arm is careful about what it claims: `none`
 * carries the certificates it could NOT read, so "nothing is stuck" never quietly
 * means "nothing is stuck as far as we bothered to look".
 */
export type StuckValidationState =
  | { kind: "unknown"; why: string }
  | { kind: "none"; certificatesRead: number; unreadable: readonly string[] }
  | { kind: "stuck"; stuck: readonly StuckValidation[]; unreadable: readonly string[] }

/** A certificate approaching expiry that AWS is not going to renew. */
export interface RenewalRisk {
  arn: string
  domainName: string
  /** Signed, so an already-expired certificate sorts ahead of one with a day left. */
  daysRemaining: number
  notAfter: string
  /** Why nobody is coming: ineligible, imported, or a managed renewal that failed. */
  why: string
  /** What breaks when it lapses. Empty is itself part of why it went ineligible. */
  inUseBy: readonly string[]
  attribution: CertificateAttribution
}

export type RenewalRiskState =
  | { kind: "unknown"; why: string }
  | { kind: "none"; certificatesRead: number; horizonDays: number; unreadable: readonly string[] }
  | { kind: "at-risk"; risks: readonly RenewalRisk[]; horizonDays: number; unreadable: readonly string[] }

/** Everything a certificate surface needs, in one load. */
export interface CertificateReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The certificates. DENIED here is a refused `acm:ListCertificates` and is
   * NEVER `[]` — an operator reading "no certificates" when the truth is "we were
   * not allowed to look" is the single most dangerous thing this surface can say.
   */
  certificates: AwsRead<readonly CertificateReading[]>
  /** Whether the listing was walked to completion, or stopped at the cap. */
  pages: PageBound
  stuckValidation: StuckValidationState
  renewalRisk: RenewalRiskState
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { certificates: number; detail: number }
}

/* --------------------------------------------------------------- parsing -- */

/**
 * An AWS timestamp as an ISO string.
 *
 * The SDK unmarshals ACM's epoch-seconds fields into `Date` objects, but the
 * gateway is an interface and a caller may hand back what the wire carried. Both
 * are accepted; anything else is null rather than a date this engine invented.
 */
export function isoTimestamp(value: Date | string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value * 1000)
        : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Whole days from `now` to `notAfter`, signed.
 *
 * Truncated toward zero rather than rounded, so "0 days remaining" means the
 * certificate expires within the next twenty-four hours rather than "some time
 * around today". Negative past the date.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.trunc((to.getTime() - from.getTime()) / MS_PER_DAY)
}

/**
 * How long a certificate has left.
 *
 * A missing `NotAfter` is `unknown`, never a large number. This is the field a
 * surface ranks on, and a certificate with no stated expiry sorted to the safe
 * end of the table is the shape of defect this whole read plane exists against.
 */
export function expiryStateOf(notAfter: string | null, now: Date): ExpiryState {
  if (!notAfter) {
    return {
      kind: "unknown",
      why:
        "acm:DescribeCertificate answered without NotAfter, so how long this certificate has " +
        "left is unknown. Unknown, not distant.",
    }
  }
  const end = new Date(notAfter)
  if (Number.isNaN(end.getTime())) {
    return { kind: "unknown", why: `NotAfter ${JSON.stringify(notAfter)} is not a date this engine can read` }
  }
  const daysRemaining = daysBetween(now, end)
  return daysRemaining < 0
    ? { kind: "expired", notAfter: end.toISOString(), daysRemaining }
    : { kind: "expires", notAfter: end.toISOString(), daysRemaining }
}

/** The record ACM is waiting for, carried out of the API verbatim. */
export function validationRecordOf(option: DomainValidationShape): ValidationRecord {
  const record = option.ResourceRecord
  const name = typeof record?.Name === "string" ? record.Name : ""
  const type = typeof record?.Type === "string" ? record.Type : ""
  const value = typeof record?.Value === "string" ? record.Value : ""
  if (!name || !type || !value) {
    return {
      kind: "absent",
      why:
        `ACM has stated no complete validation record for ${option.DomainName ?? "this domain"} ` +
        `(name=${JSON.stringify(name)}, type=${JSON.stringify(type)}, value=${JSON.stringify(value)}). ` +
        `There is nothing to create yet — which is not the same as nothing being required.`,
    }
  }
  return { kind: "cname", name, type, value }
}

/**
 * Whether the domains on a certificate are validated, and what is outstanding.
 *
 * Exported and pure: the derivation is the load-bearing part of this module and
 * it is worth being able to reason about on its own. `certificateDetailOf` is the
 * only production caller.
 */
export function validationStateOf(
  options: readonly DomainValidationShape[] | undefined,
  certificateType: string | null,
  certificateStatus: string,
): ValidationState {
  if (certificateType === "IMPORTED") {
    return {
      kind: "not-applicable",
      why:
        "this certificate was imported, so ACM performs no domain validation on it. Whoever " +
        "imported it owns its renewal too.",
    }
  }
  if (!options || options.length === 0) {
    return {
      kind: "unknown",
      why:
        `acm:DescribeCertificate answered for a ${certificateStatus} certificate with no ` +
        `DomainValidationOptions, so this engine cannot say which domains are validated. ` +
        `Unknown, not validated.`,
    }
  }

  const failed = options.filter((o) => o.ValidationStatus === "FAILED")
  if (failed.length > 0) {
    return {
      kind: "failed",
      domains: failed.map((o) => o.DomainName ?? "(unnamed domain)").sort(),
      why:
        "ACM reports validation FAILED for these domains. A failed validation does not retry on " +
        "its own; the certificate has to be requested again.",
    }
  }

  const pending = options.filter((o) => o.ValidationStatus !== "SUCCESS")
  if (pending.length === 0) {
    return { kind: "validated", domains: options.map((o) => o.DomainName ?? "(unnamed domain)").sort() }
  }

  // DNS wins when any pending domain is DNS-validated: the CNAME is the actionable
  // remedy, and a mixed certificate whose DNS half is stuck must not render as an
  // email problem an operator cannot act on from a console.
  const dns = pending.filter((o) => o.ValidationMethod === "DNS" || o.ResourceRecord !== undefined)
  if (dns.length > 0) {
    return {
      kind: "pending-dns",
      waiting: dns
        .map((option) => ({
          domain: option.DomainName ?? "(unnamed domain)",
          record: validationRecordOf(option),
        }))
        .sort((a, b) => a.domain.localeCompare(b.domain)),
    }
  }
  return {
    kind: "pending-email",
    waiting: pending
      .map((option) => ({
        domain: option.DomainName ?? "(unnamed domain)",
        validationDomain: option.ValidationDomain ?? null,
        emails: [...(option.ValidationEmails ?? [])].sort(),
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain)),
  }
}

/**
 * Whether AWS will renew this certificate.
 *
 * The order of the tests is the argument. IMPORTED is checked first because AWS
 * never renews an imported certificate whatever `RenewalEligibility` says, and a
 * `RenewalSummary` is checked before bare eligibility because a managed renewal
 * that FAILED is a live incident that an "eligible" reading would hide.
 */
export function renewalStateOf(
  certificateType: string | null,
  renewalEligibility: string | null,
  summary: { RenewalStatus?: string; RenewalStatusReason?: string; UpdatedAt?: Date | string } | undefined,
  inUseBy: readonly string[],
): RenewalState {
  if (certificateType === "IMPORTED") {
    return {
      kind: "imported",
      why:
        "this certificate was imported into ACM, and AWS does not renew imported certificates. " +
        "Somebody has to import a replacement before NotAfter.",
    }
  }
  if (summary && typeof summary.RenewalStatus === "string" && summary.RenewalStatus) {
    return {
      kind: "managed",
      status: summary.RenewalStatus,
      statusReason: summary.RenewalStatusReason ?? null,
      updatedAt: isoTimestamp(summary.UpdatedAt),
    }
  }
  if (renewalEligibility === "INELIGIBLE") {
    return {
      kind: "ineligible",
      why:
        "ACM reports this certificate INELIGIBLE for managed renewal" +
        (inUseBy.length === 0
          ? ", and it is attached to no resource — ACM revalidates through the resources a " +
            "certificate is in use by, so an unattached certificate has nothing to revalidate through."
          : `, though it is in use by ${inUseBy.length} resource(s). Renewal will not happen on its own.`),
    }
  }
  if (renewalEligibility === "ELIGIBLE") {
    return {
      kind: "eligible",
      why: "ACM reports this certificate eligible for managed renewal and has not started one yet.",
    }
  }
  return {
    kind: "unknown",
    why:
      `acm:DescribeCertificate stated no RenewalEligibility (${JSON.stringify(renewalEligibility)}) ` +
      `and no RenewalSummary, so whether AWS will renew this certificate is unknown. Unknown, not yes.`,
  }
}

/** The signed number a surface ranks on, or null when there is no honest number. */
export function daysRemainingOf(expiry: ExpiryState): number | null {
  return expiry.kind === "unknown" ? null : expiry.daysRemaining
}

/* -------------------------------------------------------------- the ARN -- */

/**
 * The partition, region and account of a certificate, from its own ARN.
 *
 * `arn:PARTITION:acm:REGION:ACCOUNT:certificate/uuid`. Read rather than assumed,
 * and read per certificate rather than once for the load: a CloudFront
 * certificate lives in us-east-1 while the load balancer's lives in the estate's
 * region, so one account routinely holds certificates in two regions and a single
 * answer would be wrong for one of them.
 */
export function placementOf(
  arn: string,
  identity: AwsRead<Identity>,
): { partition: string | null; region: string | null; accountId: string | null } {
  const parts = arn.split(":")
  if (parts.length >= 6 && parts[0] === "arn") {
    return {
      partition: parts[1] || null,
      region: parts[3] || null,
      accountId: parts[4] || null,
    }
  }
  if (identity.state === "ACTUAL" || identity.state === "STALE") {
    return {
      partition: identity.value.partition,
      region: identity.value.region,
      accountId: identity.value.accountId,
    }
  }
  return { partition: null, region: null, accountId: null }
}

/* ----------------------------------------------------------- the reading -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

interface CertificateSummaryRow {
  arn: string
  domainName: string
  status: string | null
}

interface Listing {
  summaries: readonly CertificateSummaryRow[]
  pages: PageBound
}

async function listCertificates(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<{ read: AwsRead<Listing>; pages: PageBound }> {
  // Captured out of the run so the page bound survives an EMPTY reading, whose
  // arm carries no value. A listing that walked one page and found nothing is
  // still a complete listing, and a surface has to be able to say so.
  //
  // A holder object rather than a bare `let`: TypeScript's control-flow analysis
  // does not track assignments made inside a closure, so a `let` initialised to
  // `null` narrows to `null` at the use site below and the fallback becomes
  // unconditional. That would silently report every listing as `not-read`.
  const observed: { pages: PageBound | null } = { pages: null }

  const read = await readAws<Listing>(
    "acm:ListCertificates",
    async () => {
      const summaries: CertificateSummaryRow[] = []
      let token: string | undefined
      let pagesRead = 0
      let truncated = false

      for (let page = 0; page < MAX_CERTIFICATE_PAGES; page += 1) {
        const response = (await gw.call("acm:ListCertificates", {
          NextToken: token,
        })) as ListCertificatesResponse
        pagesRead += 1
        for (const summary of response?.CertificateSummaryList ?? []) {
          if (typeof summary?.CertificateArn !== "string" || !summary.CertificateArn) continue
          summaries.push({
            arn: summary.CertificateArn,
            domainName:
              typeof summary.DomainName === "string" && summary.DomainName
                ? summary.DomainName
                : summary.CertificateArn,
            status: typeof summary.Status === "string" && summary.Status ? summary.Status : null,
          })
        }
        token = response?.NextToken || undefined
        if (!token) break
        if (page === MAX_CERTIFICATE_PAGES - 1) {
          // Not thrown, and not hidden. AWS still had pages and this engine
          // stopped: the certificates read are real and the list is incomplete,
          // and both halves of that have to reach the surface.
          truncated = true
        }
      }

      // Sorted so two loads of the same estate produce the same order.
      // `ListCertificates` promises none, and an order that changes between
      // renders makes a diff of two screenshots unreadable.
      const sorted = [...summaries].sort((a, b) => a.arn.localeCompare(b.arn))
      const pages: PageBound = truncated
        ? {
            kind: "truncated",
            pagesRead,
            certificatesRead: sorted.length,
            why:
              `acm:ListCertificates still had pages after ${MAX_CERTIFICATE_PAGES}. ` +
              `${sorted.length} certificate(s) were read and there are more this engine did not ` +
              `look at — this is not the whole estate.`,
          }
        : { kind: "complete", pagesRead, certificatesRead: sorted.length }
      observed.pages = pages
      return { summaries: sorted, pages }
    },
    {
      now: options.now,
      denial: options.denial,
      // A listing that answered with no certificates is EMPTY. Without this the
      // default test sees a non-empty object — `{summaries, pages}` — and reports
      // ACTUAL with an empty array inside, which is precisely the reading that
      // must not exist.
      isEmpty: (value) => (value as Listing).summaries.length === 0,
      ...RETRY,
    },
  )

  const pages: PageBound = observed.pages ?? {
    kind: "not-read",
    why: `the certificate listing was not read — ${describeRead(read, "acm:ListCertificates")}`,
  }
  return { read, pages }
}

/** Parse one `DescribeCertificate` answer. Exported so the derivation is testable. */
export function certificateDetailOf(
  response: DescribeCertificateResponse,
  arn: string,
  now: Date,
): CertificateDetail {
  const certificate = response?.Certificate
  if (!certificate) {
    throw new Error(
      `acm:DescribeCertificate answered for ${arn} without a Certificate. There is nothing to ` +
        `report about this certificate, which is not the same as its being healthy.`,
    )
  }
  const status = typeof certificate.Status === "string" && certificate.Status ? certificate.Status : ""
  if (!status) {
    throw new Error(
      `acm:DescribeCertificate answered for ${arn} without a Status. A certificate whose state ` +
        `AWS did not state must not render as issued.`,
    )
  }
  const type = typeof certificate.Type === "string" && certificate.Type ? certificate.Type : null
  const inUseBy = [...(certificate.InUseBy ?? [])].filter((r): r is string => typeof r === "string").sort()
  const notAfter = isoTimestamp(certificate.NotAfter)
  const names = new Set<string>()
  if (typeof certificate.DomainName === "string" && certificate.DomainName) {
    names.add(certificate.DomainName)
  }
  for (const name of certificate.SubjectAlternativeNames ?? []) {
    if (typeof name === "string" && name) names.add(name)
  }

  return {
    arn: typeof certificate.CertificateArn === "string" && certificate.CertificateArn ? certificate.CertificateArn : arn,
    domainName: certificate.DomainName ?? arn,
    subjectAlternativeNames: [...names].sort(),
    status,
    type,
    keyAlgorithm: certificate.KeyAlgorithm ?? null,
    inUseBy,
    validation: validationStateOf(certificate.DomainValidationOptions, type, status),
    renewal: renewalStateOf(
      type,
      certificate.RenewalEligibility ?? null,
      certificate.RenewalSummary,
      inUseBy,
    ),
    expiry: expiryStateOf(notAfter, now),
    renewalEligibility: certificate.RenewalEligibility ?? null,
    notBefore: isoTimestamp(certificate.NotBefore),
    notAfter,
    createdAt: isoTimestamp(certificate.CreatedAt),
    issuedAt: isoTimestamp(certificate.IssuedAt),
    importedAt: isoTimestamp(certificate.ImportedAt),
    revokedAt: isoTimestamp(certificate.RevokedAt),
    revocationReason: certificate.RevocationReason ?? null,
    failureReason: certificate.FailureReason ?? null,
  }
}

async function readCertificateDetail(
  gw: AwsGateway,
  arn: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<CertificateDetail>> {
  return readAws<CertificateDetail>(
    "acm:DescribeCertificate",
    async () => {
      const response = (await gw.call("acm:DescribeCertificate", {
        CertificateArn: arn,
      })) as DescribeCertificateResponse
      return certificateDetailOf(response, arn, options.now())
    },
    {
      now: options.now,
      denial: options.denial,
      // A certificate's detail is never meaningfully "empty": an answer with
      // nothing in it is a fault and it throws above.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): CertificateAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this certificate's tags were not read — ${describeRead(tagged, "the tag index")}`,
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

/* ----------------------------------------------------------- the surface -- */

/**
 * Every certificate in this account and region, with its validation, its expiry
 * and whether AWS is going to renew it.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function certificateReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<CertificateReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [])

  const { read: listed, pages } = await listCertificates(gw, { now, denial })
  const asOf = now().toISOString()
  const refreshMs = {
    certificates: CAPABILITIES["acm:ListCertificates"].refreshMs,
    detail: CAPABILITIES["acm:DescribeCertificate"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they are already an `AwsRead<CertificateReading[]>`. A
    // cast here would be the place a future empty array could be smuggled in.
    const certificates: AwsRead<readonly CertificateReading[]> = listed
    return {
      identity,
      tagged,
      certificates,
      pages,
      stuckValidation: stuckValidationState(certificates),
      renewalRisk: renewalRiskState(certificates),
      asOf,
      refreshMs,
    }
  }

  const summaries = listed.value.summaries
  const details: Array<AwsRead<CertificateDetail>> = new Array(summaries.length)
  for (let start = 0; start < summaries.length; start += DETAIL_CONCURRENCY) {
    const batch = summaries.slice(start, start + DETAIL_CONCURRENCY)
    const read = await Promise.all(
      batch.map((summary, offset) => {
        const position = start + offset
        if (position >= MAX_CERTIFICATE_DETAIL_READS) {
          const skipped: AwsRead<CertificateDetail> = {
            state: "UNCONFIGURED",
            capability: "acm:DescribeCertificate",
            why:
              `this engine reads at most ${MAX_CERTIFICATE_DETAIL_READS} certificate details per ` +
              `load and this certificate is number ${position + 1} of ${summaries.length}. Its ` +
              `validation, expiry and renewal were not read — which is not the same as their ` +
              `being fine.`,
          }
          return Promise.resolve(skipped)
        }
        return readCertificateDetail(gw, summary.arn, { now, denial })
      }),
    )
    for (let i = 0; i < read.length; i += 1) details[start + i] = read[i]
  }

  const readings: CertificateReading[] = summaries.map((summary, i) => {
    const placement = placementOf(summary.arn, identity)
    return {
      arn: summary.arn,
      domainName: summary.domainName,
      listedStatus: summary.status,
      partition: placement.partition,
      region: placement.region,
      accountId: placement.accountId,
      attribution: attributionFor(summary.arn, tagged, index),
      detail: details[i],
      refreshMs: refreshMs.detail,
      asOf,
    }
  })

  const certificates: AwsRead<readonly CertificateReading[]> = { ...listed, value: readings }
  return {
    identity,
    tagged,
    certificates,
    pages,
    stuckValidation: stuckValidationState(certificates),
    renewalRisk: renewalRiskState(certificates),
    asOf,
    refreshMs,
  }
}

/* --------------------------------------------------------- the two states -- */

/**
 * Which certificates are waiting on a validation record that does not exist.
 *
 * Exported and pure so the derivation can be reasoned about on its own — but
 * `certificateReadings` is the only production caller and the tests drive it
 * through there, not through here.
 */
export function stuckValidationState(
  certificates: AwsRead<readonly CertificateReading[]>,
  now?: Date,
): StuckValidationState {
  if (certificates.state !== "ACTUAL" && certificates.state !== "STALE") {
    return { kind: "unknown", why: describeRead(certificates, "the certificate listing") }
  }

  const unreadable: string[] = []
  const stuck: StuckValidation[] = []

  for (const certificate of certificates.value) {
    const detail = certificate.detail
    if (detail.state !== "ACTUAL" && detail.state !== "STALE") {
      unreadable.push(certificate.domainName)
      continue
    }
    const validation = detail.value.validation
    if (validation.kind === "unknown") {
      // The detail was read and it did not answer the question. That is not a
      // certificate that is fine; it belongs in the same list as the ones that
      // could not be read at all.
      unreadable.push(certificate.domainName)
      continue
    }
    if (validation.kind !== "pending-dns") continue

    const created = detail.value.createdAt ? new Date(detail.value.createdAt) : null
    const reference = now ?? new Date(certificate.asOf)
    const pendingForDays =
      created && !Number.isNaN(created.getTime()) && !Number.isNaN(reference.getTime())
        ? daysBetween(created, reference)
        : null

    stuck.push({
      arn: certificate.arn,
      domainName: detail.value.domainName,
      pendingForDays,
      waiting: validation.waiting,
      attribution: certificate.attribution,
    })
  }

  if (stuck.length > 0) {
    return {
      kind: "stuck",
      // Longest-waiting first, and a certificate with no stated creation time
      // sorts last rather than being dropped.
      stuck: [...stuck].sort((a, b) => (b.pendingForDays ?? -1) - (a.pendingForDays ?? -1)),
      unreadable: [...unreadable].sort(),
    }
  }
  if (unreadable.length > 0 && unreadable.length === certificates.value.length) {
    return {
      kind: "unknown",
      why:
        `no certificate answered acm:DescribeCertificate (${unreadable.length} of ` +
        `${certificates.value.length}), so whether anything is waiting on a validation record is unknown.`,
    }
  }
  return {
    kind: "none",
    certificatesRead: certificates.value.length,
    unreadable: [...unreadable].sort(),
  }
}

/**
 * Which certificates are approaching expiry with nobody coming to renew them.
 *
 * A certificate inside the horizon whose renewal is `ineligible`, `imported`,
 * `unknown` or a managed renewal that has FAILED. `managed` with any other status
 * and `eligible` are not risks — ACM is handling those, and reporting them would
 * make the list one an operator learns to ignore, which costs more than it saves.
 */
export function renewalRiskState(
  certificates: AwsRead<readonly CertificateReading[]>,
  horizonDays: number = RENEWAL_HORIZON_DAYS,
): RenewalRiskState {
  if (certificates.state !== "ACTUAL" && certificates.state !== "STALE") {
    return { kind: "unknown", why: describeRead(certificates, "the certificate listing") }
  }

  const unreadable: string[] = []
  const risks: RenewalRisk[] = []

  for (const certificate of certificates.value) {
    const detail = certificate.detail
    if (detail.state !== "ACTUAL" && detail.state !== "STALE") {
      unreadable.push(certificate.domainName)
      continue
    }
    const expiry = detail.value.expiry
    if (expiry.kind === "unknown") {
      // No NotAfter means this certificate cannot be ranked or cleared. It is
      // named as unreadable rather than assumed distant.
      unreadable.push(certificate.domainName)
      continue
    }
    if (expiry.daysRemaining > horizonDays) continue

    const renewal = detail.value.renewal
    const why =
      renewal.kind === "ineligible" || renewal.kind === "imported" || renewal.kind === "unknown"
        ? renewal.why
        : renewal.kind === "managed" && renewal.status === "FAILED"
          ? `ACM's managed renewal for this certificate reports FAILED` +
            `${renewal.statusReason ? ` (${renewal.statusReason})` : ""}. It will not complete on its own.`
          : null
    if (why === null) continue

    risks.push({
      arn: certificate.arn,
      domainName: detail.value.domainName,
      daysRemaining: expiry.daysRemaining,
      notAfter: expiry.notAfter,
      why,
      inUseBy: detail.value.inUseBy,
      attribution: certificate.attribution,
    })
  }

  if (risks.length > 0) {
    return {
      kind: "at-risk",
      // Soonest first, expired ones ahead of everything — which is what the
      // signed number is for.
      risks: [...risks].sort((a, b) => a.daysRemaining - b.daysRemaining),
      horizonDays,
      unreadable: [...unreadable].sort(),
    }
  }
  if (unreadable.length > 0 && unreadable.length === certificates.value.length) {
    return {
      kind: "unknown",
      why:
        `no certificate answered acm:DescribeCertificate (${unreadable.length} of ` +
        `${certificates.value.length}), so whether any certificate is about to lapse is unknown.`,
    }
  }
  return {
    kind: "none",
    certificatesRead: certificates.value.length,
    horizonDays,
    unreadable: [...unreadable].sort(),
  }
}

/* ------------------------------------------------------------ rendering -- */

/** The sentence a surface prints for one certificate's attribution. */
export function describeCertificateAttribution(attribution: CertificateAttribution): string {
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

/** The record an operator has to create, spelled out so it can be pasted. */
export function describeValidationRecord(record: ValidationRecord): string {
  switch (record.kind) {
    case "cname":
      return `${record.type} ${record.name} -> ${record.value}`
    case "absent":
      return `no record stated — ${record.why}`
  }
}

/** The sentence a surface prints for one certificate's validation. */
export function describeValidation(validation: ValidationState): string {
  switch (validation.kind) {
    case "validated":
      return `validated — ${validation.domains.join(", ")}`
    case "pending-dns":
      return (
        `PENDING VALIDATION — waiting on DNS for ${validation.waiting.length} domain(s). ` +
        `Create: ${validation.waiting
          .map((w) => `${w.domain}: ${describeValidationRecord(w.record)}`)
          .join("; ")}`
      )
    case "pending-email":
      return (
        `PENDING VALIDATION — waiting on email approval for ` +
        `${validation.waiting
          .map(
            (w) =>
              `${w.domain}${w.emails.length > 0 ? ` (sent to ${w.emails.join(", ")})` : " (no addresses stated)"}`,
          )
          .join("; ")}`
      )
    case "failed":
      return `VALIDATION FAILED — ${validation.domains.join(", ")}. ${validation.why}`
    case "not-applicable":
      return `no validation — ${validation.why}`
    case "unknown":
      return `validation unknown — ${validation.why}`
  }
}

/** The sentence a surface prints for one certificate's renewal. */
export function describeRenewal(renewal: RenewalState): string {
  switch (renewal.kind) {
    case "managed":
      return (
        `managed renewal ${renewal.status}` +
        `${renewal.statusReason ? ` (${renewal.statusReason})` : ""}` +
        `${renewal.updatedAt ? `, updated ${renewal.updatedAt}` : ""}`
      )
    case "eligible":
      return `renewal eligible — ${renewal.why}`
    case "ineligible":
      return `NOT ELIGIBLE FOR RENEWAL — ${renewal.why}`
    case "imported":
      return `NOT RENEWED BY AWS — ${renewal.why}`
    case "unknown":
      return `renewal unknown — ${renewal.why}`
  }
}

/** The sentence a surface prints for one certificate's expiry. */
export function describeExpiry(expiry: ExpiryState): string {
  switch (expiry.kind) {
    case "expires":
      return `expires ${expiry.notAfter} — ${expiry.daysRemaining} day(s) remaining`
    case "expired":
      return `EXPIRED ${expiry.notAfter} — ${Math.abs(expiry.daysRemaining)} day(s) ago`
    case "unknown":
      return `expiry unknown — ${expiry.why}`
  }
}

/** The sentence a surface prints for one certificate. One funnel, so states cannot drift. */
export function describeCertificate(certificate: CertificateReading): string {
  const where =
    certificate.region && certificate.partition
      ? `${certificate.region} (partition ${certificate.partition})`
      : "region unknown — this certificate's ARN did not carry one and identity is unresolved"
  const head =
    `${certificate.domainName} — ${where} — ` +
    `${describeCertificateAttribution(certificate.attribution)}`

  if (certificate.detail.state === "ACTUAL" || certificate.detail.state === "STALE") {
    const d = certificate.detail.value
    const covers =
      d.subjectAlternativeNames.length > 0
        ? ` · covers ${d.subjectAlternativeNames.join(", ")}`
        : " · covers no name AWS stated"
    const attached =
      d.inUseBy.length > 0
        ? ` · in use by ${d.inUseBy.join(", ")}`
        : " · in use by nothing — attached to no resource"
    return (
      `${head} — ${d.status}${covers} · ${describeExpiry(d.expiry)} · ` +
      `${describeValidation(d.validation)} · ${describeRenewal(d.renewal)}${attached} · ` +
      `as of ${certificate.asOf}, refreshed every ${Math.round(certificate.refreshMs / 1000)}s`
    )
  }
  // Every other state goes through the one renderer, so a refused detail reads as
  // a refusal here exactly as it does everywhere else — never as "validated".
  return `${head} — ${describeRead(certificate.detail, `${certificate.domainName} detail`)}`
}

/** The sentence a surface prints for the stuck-validation finding. */
export function describeStuckValidation(state: StuckValidationState): string {
  switch (state.kind) {
    case "unknown":
      return `unknown — ${state.why}`
    case "none": {
      const qualifier =
        state.unreadable.length === 0
          ? ""
          : `, though ${state.unreadable.length} certificate(s) could not be read (${state.unreadable.join(", ")})`
      return (
        `nothing is waiting on a validation record — ${state.certificatesRead} certificate(s) ` +
        `listed${qualifier}`
      )
    }
    case "stuck": {
      const named = state.stuck
        .map(
          (s) =>
            `${s.domainName}` +
            `${s.pendingForDays === null ? "" : ` (pending ${s.pendingForDays} day(s))`}` +
            ` needs ${s.waiting.map((w) => describeValidationRecord(w.record)).join(" and ")}`,
        )
        .join("; ")
      const qualifier =
        state.unreadable.length === 0
          ? ""
          : ` A further ${state.unreadable.length} certificate(s) could not be read.`
      return (
        `STUCK VALIDATION — ${state.stuck.length} certificate(s) will never issue until a DNS ` +
        `record exists: ${named}.${qualifier}`
      )
    }
  }
}

/** The sentence a surface prints for the renewal finding. */
export function describeRenewalRisk(state: RenewalRiskState): string {
  switch (state.kind) {
    case "unknown":
      return `unknown — ${state.why}`
    case "none": {
      const qualifier =
        state.unreadable.length === 0
          ? ""
          : `, though ${state.unreadable.length} certificate(s) could not be read (${state.unreadable.join(", ")})`
      return (
        `no certificate is inside ${state.horizonDays} days of expiry without a renewal path — ` +
        `${state.certificatesRead} certificate(s) listed${qualifier}`
      )
    }
    case "at-risk": {
      const named = state.risks
        .map(
          (r) =>
            `${r.domainName} in ${r.daysRemaining} day(s) (${r.notAfter}) — ${r.why}` +
            `${r.inUseBy.length > 0 ? ` It fronts ${r.inUseBy.join(", ")}.` : ""}`,
        )
        .join("; ")
      const qualifier =
        state.unreadable.length === 0
          ? ""
          : ` A further ${state.unreadable.length} certificate(s) could not be read.`
      return (
        `RENEWAL WILL NOT HAPPEN — ${state.risks.length} certificate(s) expire within ` +
        `${state.horizonDays} days and AWS is not going to renew them: ${named}.${qualifier}`
      )
    }
  }
}

/** The sentence a surface prints for how much of the listing was walked. */
export function describePageBound(pages: PageBound): string {
  switch (pages.kind) {
    case "complete":
      return `complete — ${pages.certificatesRead} certificate(s) over ${pages.pagesRead} page(s)`
    case "truncated":
      return `TRUNCATED — ${pages.why}`
    case "not-read":
      return `not read — ${pages.why}`
  }
}

export interface CertificateLine {
  label: string
  text: string
}

/**
 * What a certificate surface prints.
 *
 * A surface agent renders exactly these strings. The tests assert on them, which
 * is what makes the mutation proofs land on the production path rather than on a
 * helper nothing calls.
 */
export function certificateLines(readings: CertificateReadings): readonly CertificateLine[] {
  const lines: CertificateLine[] = [
    {
      label: "Certificates",
      text: describeRead(
        readings.certificates,
        `certificates read from AWS, refreshed every ${Math.round(readings.refreshMs.certificates / 1000)}s`,
      ),
    },
    { label: "Listing", text: describePageBound(readings.pages) },
    { label: "Stuck validation", text: describeStuckValidation(readings.stuckValidation) },
    { label: "Renewal", text: describeRenewalRisk(readings.renewalRisk) },
  ]
  if (readings.certificates.state === "ACTUAL" || readings.certificates.state === "STALE") {
    for (const certificate of readings.certificates.value) {
      lines.push({ label: certificate.domainName, text: describeCertificate(certificate) })
    }
  }
  return lines
}
