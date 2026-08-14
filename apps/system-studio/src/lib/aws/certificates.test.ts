import { SHARED } from "@tenure/provisioning"

import {
  MAX_CERTIFICATE_DETAIL_READS,
  MAX_CERTIFICATE_PAGES,
  RENEWAL_HORIZON_DAYS,
  certificateLines,
  certificateReadings,
  daysBetween,
  expiryStateOf,
  isoTimestamp,
  placementOf,
  renewalStateOf,
  validationStateOf,
  type CertificateReadings,
} from "./certificates"
import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 (ACM) — the certificate surface tells four different truths
 * apart, and says the two things the listing cannot.
 *
 * The assertions are on `certificateReadings` and `certificateLines`, the
 * functions a surface renders, rather than on `readAws` or on a parser in
 * isolation. A test that drove a private helper would stay green on the day this
 * module stopped calling it, which is the failure this programme has already paid
 * for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers four capabilities with the shapes the real SDK returns —
 * `{CertificateSummaryList, NextToken}` from ListCertificates, `{Certificate:{…}}`
 * from DescribeCertificate, `{ResourceTagMappingList:[{ResourceARN,Tags}]}` from
 * the Tagging API and `{Account, Arn}` from STS — and it can fail each of them
 * independently with `AccessDeniedException`, `ThrottlingException`, an
 * empty-but-successful list, or a populated one. A stand-in that returned `[]`
 * regardless of what was asked would prove nothing about code whose whole job is
 * telling those four apart, and it is the fake this repository has already been
 * burnt by.
 *
 * ## Nothing here is a real resource
 *
 * The account is AWS's documentation placeholder `123456789012`; every domain is
 * under `example.com` / `example.net`, which RFC 2606 reserves precisely so that
 * a fixture cannot collide with somebody's zone. No credential is used, no AWS
 * call is made, and no approval, review or verification date is recorded by this
 * suite or by the module it exercises.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const HOME_REGION = "eu-west-2"
/** CloudFront requires its certificate in us-east-1. One account, two regions. */
const EDGE_REGION = "us-east-1"

function certArn(region: string, id: string, partition = "aws", account = ACCOUNT): string {
  return `arn:${partition}:acm:${region}:${account}:certificate/${id}`
}

const APP_ARN = certArn(HOME_REGION, "11111111-1111-1111-1111-111111111111")
const STUCK_ARN = certArn(HOME_REGION, "22222222-2222-2222-2222-222222222222")
const IMPORTED_ARN = certArn(EDGE_REGION, "33333333-3333-3333-3333-333333333333")
const ORPHAN_ARN = certArn(HOME_REGION, "44444444-4444-4444-4444-444444444444")

const ALB_ARN = `arn:aws:elasticloadbalancing:${HOME_REGION}:${ACCOUNT}:loadbalancer/app/tenure-prod/abc123`
const DISTRIBUTION_ARN = `arn:aws:cloudfront::${ACCOUNT}:distribution/E1EXAMPLE0001`

/** The clock every case reads. Fixed, so every day count in this file is checkable. */
const NOW_ISO = "2026-08-13T09:15:00.000Z"
const AT = () => new Date(NOW_ISO)

/** An ISO instant a whole number of days from NOW. Deterministic, never Date.now(). */
function daysFromNow(days: number): string {
  return new Date(new Date(NOW_ISO).getTime() + days * 86_400_000).toISOString()
}

interface CertificateFixture {
  arn: string
  domainName: string
  /** What ListCertificates reports. Deliberately separate from the detail's Status. */
  listedStatus: string
  certificate?: Record<string, unknown>
  /** Raised instead of answering, so a per-certificate denial can be exercised. */
  failWith?: string
}

/** The healthy production certificate: issued, attached, validated, months to run. */
function appCertificate(): CertificateFixture {
  return {
    arn: APP_ARN,
    domainName: "app.example.com",
    listedStatus: "ISSUED",
    certificate: {
      CertificateArn: APP_ARN,
      DomainName: "app.example.com",
      SubjectAlternativeNames: ["app.example.com", "www.example.com"],
      DomainValidationOptions: [
        { DomainName: "app.example.com", ValidationStatus: "SUCCESS", ValidationMethod: "DNS" },
        { DomainName: "www.example.com", ValidationStatus: "SUCCESS", ValidationMethod: "DNS" },
      ],
      Status: "ISSUED",
      Type: "AMAZON_ISSUED",
      KeyAlgorithm: "RSA_2048",
      InUseBy: [ALB_ARN],
      RenewalEligibility: "ELIGIBLE",
      NotBefore: daysFromNow(-73),
      NotAfter: daysFromNow(292),
      CreatedAt: daysFromNow(-74),
      IssuedAt: daysFromNow(-73),
    },
  }
}

/**
 * The certificate that stops a tenant provisioning run: PENDING_VALIDATION with a
 * CNAME nobody ever created. There is no NotAfter — ACM does not set one until a
 * certificate issues — so its expiry is genuinely unknown.
 */
function stuckCertificate(): CertificateFixture {
  return {
    arn: STUCK_ARN,
    domainName: "new-tenant.example.com",
    listedStatus: "PENDING_VALIDATION",
    certificate: {
      CertificateArn: STUCK_ARN,
      DomainName: "new-tenant.example.com",
      SubjectAlternativeNames: ["new-tenant.example.com"],
      DomainValidationOptions: [
        {
          DomainName: "new-tenant.example.com",
          ValidationStatus: "PENDING_VALIDATION",
          ValidationMethod: "DNS",
          ResourceRecord: {
            Name: "_9d4e8a1c2b3f.new-tenant.example.com.",
            Type: "CNAME",
            Value: "_c7f2a5b8e1d0.acm-validations.example.net.",
          },
        },
      ],
      Status: "PENDING_VALIDATION",
      Type: "AMAZON_ISSUED",
      KeyAlgorithm: "RSA_2048",
      InUseBy: [],
      RenewalEligibility: "INELIGIBLE",
      CreatedAt: daysFromNow(-60),
    },
  }
}

/** Imported, three weeks from expiry, and AWS is never going to renew it. */
function importedCertificate(): CertificateFixture {
  return {
    arn: IMPORTED_ARN,
    domainName: "edge.example.com",
    listedStatus: "ISSUED",
    certificate: {
      CertificateArn: IMPORTED_ARN,
      DomainName: "edge.example.com",
      SubjectAlternativeNames: ["edge.example.com"],
      Status: "ISSUED",
      Type: "IMPORTED",
      KeyAlgorithm: "EC_prime256v1",
      InUseBy: [DISTRIBUTION_ARN],
      RenewalEligibility: "INELIGIBLE",
      NotBefore: daysFromNow(-344),
      NotAfter: daysFromNow(21),
      ImportedAt: daysFromNow(-344),
      CreatedAt: daysFromNow(-344),
    },
  }
}

/** Issued, attached to nothing, ten days out and INELIGIBLE for managed renewal. */
function orphanCertificate(): CertificateFixture {
  return {
    arn: ORPHAN_ARN,
    domainName: "legacy.example.com",
    listedStatus: "ISSUED",
    certificate: {
      CertificateArn: ORPHAN_ARN,
      DomainName: "legacy.example.com",
      SubjectAlternativeNames: ["legacy.example.com"],
      DomainValidationOptions: [
        { DomainName: "legacy.example.com", ValidationStatus: "SUCCESS", ValidationMethod: "DNS" },
      ],
      Status: "ISSUED",
      Type: "AMAZON_ISSUED",
      KeyAlgorithm: "RSA_2048",
      InUseBy: [],
      RenewalEligibility: "INELIGIBLE",
      NotBefore: daysFromNow(-355),
      NotAfter: daysFromNow(10),
      CreatedAt: daysFromNow(-356),
      IssuedAt: daysFromNow(-355),
    },
  }
}

function estate(): CertificateFixture[] {
  return [appCertificate(), stuckCertificate(), importedCertificate(), orphanCertificate()]
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  listCertificates?: Outcome
  certificates?: CertificateFixture[]
  /** How many ARNs each page carries, so pagination and its bound can be driven. */
  pageSize?: number
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * real `NextToken` paging, and independently failable per capability.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.listCertificates ?? "populated"
  const certificates = options.certificates ?? estate()
  const pageSize = options.pageSize ?? certificates.length
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: HOME_REGION,
  }
  const calls = options.calls ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "tag:GetResources": {
          const outcome = options.tagsOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { ResourceTagMappingList: [] }
          return {
            ResourceTagMappingList: Object.entries(options.tags ?? {}).map(([arn, Tags]) => ({
              ResourceARN: arn,
              Tags,
            })),
          }
        }

        case "acm:ListCertificates": {
          if (listOutcome === "denied") throwing("AccessDeniedException")
          if (listOutcome === "throttled") throwing("ThrottlingException")
          // The real API OMITS CertificateSummaryList when there are none rather
          // than returning an empty array, and a fake that returned `[]` would be
          // testing a response AWS never sends.
          if (listOutcome === "empty") return {}
          const token = (input as { NextToken?: unknown } | undefined)?.NextToken
          const start = typeof token === "string" ? Number(token) : 0
          const slice = certificates.slice(start, start + pageSize)
          const next = start + pageSize
          return {
            CertificateSummaryList: slice.map((c) => ({
              CertificateArn: c.arn,
              DomainName: c.domainName,
              Status: c.listedStatus,
            })),
            NextToken: next < certificates.length ? String(next) : undefined,
          }
        }

        case "acm:DescribeCertificate": {
          const arn = String((input as { CertificateArn?: unknown } | undefined)?.CertificateArn ?? "")
          const fixture = certificates.find((c) => c.arn === arn)
          if (!fixture) throwing("ResourceNotFoundException")
          if (fixture.failWith) throwing(fixture.failWith)
          return { Certificate: fixture.certificate }
        }

        default:
          throw new Error(
            `the stand-in was asked for ${String(capability)}, which this suite does not exercise`,
          )
      }
    },
    async resolvedRegion() {
      return identity === "denied" ? HOME_REGION : identity.region
    },
  }
}

async function load(options: FakeOptions = {}): Promise<CertificateReadings> {
  return certificateReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: CertificateReadings): string {
  return certificateLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

function lineFor(readings: CertificateReadings, label: string): string {
  return certificateLines(readings).find((l) => l.label === label)?.text ?? ""
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own gateway,
  // which bypasses the cache, but a stale cache from another suite would silently
  // make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the certificate surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and describes every certificate", async () => {
    const readings = await load()
    expect(readings.certificates.state).toBe("ACTUAL")
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.certificates.value).toHaveLength(4)
    const text = surfaceText(readings)
    expect(text).toContain("app.example.com")
    expect(text).toContain("new-tenant.example.com")
    expect(text).toContain("edge.example.com")
    expect(text).toContain("legacy.example.com")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ listCertificates: "empty" })
    expect(readings.certificates.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
    // An empty listing was still walked to completion, and the bound says so.
    expect(readings.pages).toEqual({ kind: "complete", pagesRead: 1, certificatesRead: 0 })
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listCertificates: "denied" })
    expect(readings.certificates.state).toBe("DENIED")
    if (readings.certificates.state !== "DENIED") throw new Error("narrowing")

    expect(readings.certificates.action).toBe("acm:ListCertificates")
    expect(readings.certificates.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.certificates.accountId).toBe(ACCOUNT)
    expect(readings.certificates.region).toBe(HOME_REGION)
    expect(readings.certificates.partition).toBe("aws")
    expect(JSON.parse(readings.certificates.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["acm:ListCertificates"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.certificates).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
    // A denied listing has no pages, and must not report itself as complete.
    expect(readings.pages.kind).toBe("not-read")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ listCertificates: "throttled" })
    expect(readings.certificates.state).toBe("THROTTLED")
    if (readings.certificates.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.certificates.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
    expect(readings.pages.kind).toBe("not-read")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ listCertificates: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------- the stuck validation finding -- */

describe("a certificate stuck at PENDING_VALIDATION carries the exact record that would fix it", () => {
  test("the CNAME is surfaced verbatim — name, type and value", async () => {
    const readings = await load()
    expect(readings.stuckValidation.kind).toBe("stuck")
    if (readings.stuckValidation.kind !== "stuck") throw new Error("narrowing")
    expect(readings.stuckValidation.stuck).toHaveLength(1)

    const stuck = readings.stuckValidation.stuck[0]
    expect(stuck.arn).toBe(STUCK_ARN)
    expect(stuck.domainName).toBe("new-tenant.example.com")
    // From CreatedAt against the injected clock, not a wall-clock read.
    expect(stuck.pendingForDays).toBe(60)
    expect(stuck.waiting).toHaveLength(1)
    expect(stuck.waiting[0].record).toEqual({
      kind: "cname",
      name: "_9d4e8a1c2b3f.new-tenant.example.com.",
      type: "CNAME",
      value: "_c7f2a5b8e1d0.acm-validations.example.net.",
    })

    const line = lineFor(readings, "Stuck validation")
    expect(line).toContain("STUCK VALIDATION")
    // The whole point: an operator can paste this without leaving the page.
    expect(line).toContain("_9d4e8a1c2b3f.new-tenant.example.com.")
    expect(line).toContain("_c7f2a5b8e1d0.acm-validations.example.net.")
    expect(line).toContain("pending 60 day(s)")
  })

  test("an estate with nothing pending says so, and names what it could not read", async () => {
    const readings = await load({ certificates: [appCertificate()] })
    expect(readings.stuckValidation.kind).toBe("none")
    if (readings.stuckValidation.kind !== "none") throw new Error("narrowing")
    expect(readings.stuckValidation.certificatesRead).toBe(1)
    expect(readings.stuckValidation.unreadable).toEqual([])
    const line = lineFor(readings, "Stuck validation")
    expect(line).toContain("nothing is waiting on a validation record")
    expect(line).not.toContain("STUCK VALIDATION")
  })

  test("a certificate whose validation record ACM has not stated says so, not an empty CNAME", async () => {
    const bare = stuckCertificate()
    // ACM accepted the request but has published no ResourceRecord yet.
    ;(bare.certificate as Record<string, unknown>).DomainValidationOptions = [
      {
        DomainName: "new-tenant.example.com",
        ValidationStatus: "PENDING_VALIDATION",
        ValidationMethod: "DNS",
      },
    ]
    const readings = await load({ certificates: [bare] })
    expect(readings.stuckValidation.kind).toBe("stuck")
    if (readings.stuckValidation.kind !== "stuck") throw new Error("narrowing")
    expect(readings.stuckValidation.stuck[0].waiting[0].record.kind).toBe("absent")
    const line = lineFor(readings, "Stuck validation")
    expect(line).toContain("no record stated")
    expect(line).toContain("not the same as nothing being required")
  })

  test("a denied listing makes the stuck-validation state unknown, never 'nothing is waiting'", async () => {
    const readings = await load({ listCertificates: "denied" })
    expect(readings.stuckValidation.kind).toBe("unknown")
    const line = lineFor(readings, "Stuck validation")
    expect(line).toContain("unknown")
    expect(line).toContain("acm:ListCertificates")
    expect(line).not.toContain("nothing is waiting")
  })

  test("no certificate answering makes it unknown, not 'nothing is waiting'", async () => {
    const readings = await load({
      certificates: estate().map((c) => ({ ...c, failWith: "AccessDeniedException" })),
    })
    expect(readings.stuckValidation.kind).toBe("unknown")
    const line = lineFor(readings, "Stuck validation")
    expect(line).toContain("unknown")
    expect(line).not.toContain("nothing is waiting on a validation record")
  })

  test("email validation is reported as email, not as a DNS record that does not exist", async () => {
    const byEmail = stuckCertificate()
    ;(byEmail.certificate as Record<string, unknown>).DomainValidationOptions = [
      {
        DomainName: "new-tenant.example.com",
        ValidationStatus: "PENDING_VALIDATION",
        ValidationMethod: "EMAIL",
        ValidationDomain: "example.com",
        ValidationEmails: ["admin@example.com", "hostmaster@example.com"],
      },
    ]
    const readings = await load({ certificates: [byEmail] })
    // Not a DNS record, so it is not in the stuck-DNS finding — there is nothing
    // to paste into a zone, and pretending there is would be a false remedy.
    expect(readings.stuckValidation.kind).toBe("none")
    const text = surfaceText(readings)
    expect(text).toContain("waiting on email approval")
    expect(text).toContain("admin@example.com")
    expect(text).not.toContain("CNAME")
  })

  test("a FAILED validation is failed, which is not pending and not validated", async () => {
    const failed = stuckCertificate()
    ;(failed.certificate as Record<string, unknown>).DomainValidationOptions = [
      { DomainName: "new-tenant.example.com", ValidationStatus: "FAILED", ValidationMethod: "DNS" },
    ]
    ;(failed.certificate as Record<string, unknown>).Status = "FAILED"
    const readings = await load({ certificates: [failed] })
    const text = surfaceText(readings)
    expect(text).toContain("VALIDATION FAILED")
    expect(text).toContain("has to be requested again")
    expect(readings.stuckValidation.kind).toBe("none")
  })
})

/* ----------------------------------------------- the renewal-risk finding -- */

describe("a certificate approaching expiry that AWS will not renew is its own state", () => {
  test("both un-renewable certificates are named, soonest first, with days as a number", async () => {
    const readings = await load()
    expect(readings.renewalRisk.kind).toBe("at-risk")
    if (readings.renewalRisk.kind !== "at-risk") throw new Error("narrowing")
    expect(readings.renewalRisk.horizonDays).toBe(RENEWAL_HORIZON_DAYS)
    expect(readings.renewalRisk.risks.map((r) => r.domainName)).toEqual([
      "legacy.example.com",
      "edge.example.com",
    ])
    expect(readings.renewalRisk.risks.map((r) => r.daysRemaining)).toEqual([10, 21])

    const orphan = readings.renewalRisk.risks[0]
    expect(orphan.why).toContain("INELIGIBLE")
    expect(orphan.why).toContain("attached to no resource")
    expect(orphan.inUseBy).toEqual([])

    const imported = readings.renewalRisk.risks[1]
    expect(imported.why).toContain("does not renew imported certificates")
    expect(imported.inUseBy).toEqual([DISTRIBUTION_ARN])

    // The certificate with no NotAfter is named as unreadable rather than
    // assumed distant — it cannot be ranked, so it cannot be cleared.
    expect(readings.renewalRisk.unreadable).toEqual(["new-tenant.example.com"])

    const line = lineFor(readings, "Renewal")
    expect(line).toContain("RENEWAL WILL NOT HAPPEN")
    expect(line).toContain("legacy.example.com in 10 day(s)")
    expect(line).toContain("It fronts " + DISTRIBUTION_ARN)
  })

  test("an already-expired certificate sorts ahead of one with a day left", async () => {
    const expired = orphanCertificate()
    ;(expired.certificate as Record<string, unknown>).NotAfter = daysFromNow(-5)
    const readings = await load({ certificates: [importedCertificate(), expired] })
    if (readings.renewalRisk.kind !== "at-risk") throw new Error("narrowing")
    expect(readings.renewalRisk.risks.map((r) => r.daysRemaining)).toEqual([-5, 21])
    expect(surfaceText(readings)).toContain("EXPIRED")
    expect(surfaceText(readings)).toContain("5 day(s) ago")
  })

  test("an eligible certificate months out is not a risk, and the list stays worth reading", async () => {
    const readings = await load({ certificates: [appCertificate()] })
    expect(readings.renewalRisk.kind).toBe("none")
    if (readings.renewalRisk.kind !== "none") throw new Error("narrowing")
    expect(readings.renewalRisk.certificatesRead).toBe(1)
    const line = lineFor(readings, "Renewal")
    expect(line).toContain("no certificate is inside 60 days of expiry")
    expect(line).not.toContain("RENEWAL WILL NOT HAPPEN")
  })

  test("a managed renewal that FAILED inside the horizon is a risk, not a reassurance", async () => {
    const failing = orphanCertificate()
    ;(failing.certificate as Record<string, unknown>).RenewalEligibility = "ELIGIBLE"
    ;(failing.certificate as Record<string, unknown>).RenewalSummary = {
      RenewalStatus: "FAILED",
      RenewalStatusReason: "DOMAIN_VALIDATION_DENIED",
      UpdatedAt: daysFromNow(-2),
    }
    const readings = await load({ certificates: [failing] })
    expect(readings.renewalRisk.kind).toBe("at-risk")
    if (readings.renewalRisk.kind !== "at-risk") throw new Error("narrowing")
    expect(readings.renewalRisk.risks[0].why).toContain("FAILED")
    expect(readings.renewalRisk.risks[0].why).toContain("DOMAIN_VALIDATION_DENIED")
    expect(surfaceText(readings)).toContain("managed renewal FAILED")
  })

  test("a managed renewal in progress inside the horizon is not reported as a risk", async () => {
    const renewing = orphanCertificate()
    ;(renewing.certificate as Record<string, unknown>).RenewalEligibility = "ELIGIBLE"
    ;(renewing.certificate as Record<string, unknown>).InUseBy = [ALB_ARN]
    ;(renewing.certificate as Record<string, unknown>).RenewalSummary = {
      RenewalStatus: "PENDING_AUTO_RENEWAL",
      UpdatedAt: daysFromNow(-1),
    }
    const readings = await load({ certificates: [renewing] })
    expect(readings.renewalRisk.kind).toBe("none")
    expect(surfaceText(readings)).toContain("managed renewal PENDING_AUTO_RENEWAL")
  })

  test("a denied listing makes the renewal state unknown, never 'no certificate is inside'", async () => {
    const readings = await load({ listCertificates: "denied" })
    expect(readings.renewalRisk.kind).toBe("unknown")
    const line = lineFor(readings, "Renewal")
    expect(line).toContain("unknown")
    expect(line).not.toContain("no certificate is inside")
  })
})

/* ---------------------------------- sub-calls degrade independently of each -- */

describe("a certificate whose detail was refused still appears, saying so", () => {
  test("the denial names DescribeCertificate, not the listing action, and the rest still read", async () => {
    const certificates = estate()
    certificates[0] = { ...appCertificate(), failWith: "AccessDeniedException" }
    const readings = await load({ certificates })

    // One denied detail does not collapse the row, and does not collapse the load.
    expect(readings.certificates.state).toBe("ACTUAL")
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.certificates.value).toHaveLength(4)

    const app = readings.certificates.value.find((c) => c.domainName === "app.example.com")
    expect(app?.detail.state).toBe("DENIED")
    if (app?.detail.state !== "DENIED") throw new Error("narrowing")
    // The whole reason the two capabilities are read separately: granting
    // acm:ListCertificates would not have fixed this, and a denial naming it
    // would have sent an operator to grant an action they already hold.
    expect(app.detail.action).toBe("acm:DescribeCertificate")
    expect(app.detail.minimumStatement).toContain("acm:DescribeCertificate")
    expect(app.detail.minimumStatement).not.toContain("acm:ListCertificates")
    expect(JSON.parse(app.detail.minimumStatement).Resource).toBe("arn:*:acm:*:*:certificate/*")

    const line = lineFor(readings, "app.example.com")
    expect(line).toContain("refused acm:DescribeCertificate")
    // And it must not render as a reassuring default.
    expect(line).not.toContain("validated")
    expect(line).not.toContain("day(s) remaining")
    expect(line).not.toContain("renewal eligible")

    // The certificates that DID answer are still fully read.
    expect(readings.stuckValidation.kind).toBe("stuck")
    expect(readings.renewalRisk.kind).toBe("at-risk")
    if (readings.renewalRisk.kind !== "at-risk") throw new Error("narrowing")
    expect(readings.renewalRisk.unreadable).toEqual([
      "app.example.com",
      "new-tenant.example.com",
    ])
  })

  test("a throttled detail is throttled, not valid and not empty", async () => {
    const certificates = [{ ...appCertificate(), failWith: "ThrottlingException" }]
    const readings = await load({ certificates })
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.certificates.value[0].detail.state).toBe("THROTTLED")
    const line = lineFor(readings, "app.example.com")
    expect(line).toContain("throttled")
    expect(line).not.toContain("day(s) remaining")
  })

  test("a detail answering without a Status is an ERROR, never an assumed ISSUED", async () => {
    const nameless = appCertificate()
    delete (nameless.certificate as Record<string, unknown>).Status
    const readings = await load({ certificates: [nameless] })
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    const detail = readings.certificates.value[0].detail
    expect(detail.state).toBe("ERROR")
    if (detail.state !== "ERROR") throw new Error("narrowing")
    expect(detail.safeDetail).toContain("without a Status")
    expect(lineFor(readings, "app.example.com")).not.toContain("ISSUED")
  })

  test("certificates past the detail cap say they were not read, not that they are fine", async () => {
    const many: CertificateFixture[] = []
    for (let i = 0; i < MAX_CERTIFICATE_DETAIL_READS + 3; i += 1) {
      const arn = certArn(HOME_REGION, `bulk-${String(i).padStart(4, "0")}`)
      const base = appCertificate()
      many.push({
        arn,
        domainName: `bulk-${String(i).padStart(4, "0")}.example.com`,
        listedStatus: "ISSUED",
        certificate: { ...base.certificate, CertificateArn: arn },
      })
    }
    const readings = await load({ certificates: many })
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.certificates.value).toHaveLength(MAX_CERTIFICATE_DETAIL_READS + 3)
    const last = readings.certificates.value[readings.certificates.value.length - 1]
    expect(last.detail.state).toBe("UNCONFIGURED")
    if (last.detail.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(last.detail.why).toContain("not the same as their being fine")
  })
})

/* ------------------------------------------------------ pagination bounds -- */

describe("the listing is paginated to completion, with a bound that is reported", () => {
  test("multiple pages are walked and the bound says complete", async () => {
    const calls: string[] = []
    const readings = await certificateReadings(fakeAws({ pageSize: 1, calls }), { now: AT })
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.certificates.value).toHaveLength(4)
    // Four ARNs over four pages plus the empty fifth that carries no NextToken.
    expect(calls.filter((c) => c === "acm:ListCertificates").length).toBeGreaterThan(1)
    expect(readings.pages.kind).toBe("complete")
    if (readings.pages.kind !== "complete") throw new Error("narrowing")
    expect(readings.pages.certificatesRead).toBe(4)
    expect(lineFor(readings, "Listing")).toContain("complete — 4 certificate(s)")
  })

  test("hitting the page cap returns an explicit 'there were more' signal", async () => {
    // One certificate per page, more certificates than the cap allows pages.
    const many: CertificateFixture[] = []
    for (let i = 0; i < MAX_CERTIFICATE_PAGES + 5; i += 1) {
      const arn = certArn(HOME_REGION, `page-${String(i).padStart(4, "0")}`)
      const base = appCertificate()
      many.push({
        arn,
        domainName: `page-${String(i).padStart(4, "0")}.example.com`,
        listedStatus: "ISSUED",
        certificate: { ...base.certificate, CertificateArn: arn },
      })
    }
    const readings = await load({ certificates: many, pageSize: 1 })
    expect(readings.pages.kind).toBe("truncated")
    if (readings.pages.kind !== "truncated") throw new Error("narrowing")
    expect(readings.pages.pagesRead).toBe(MAX_CERTIFICATE_PAGES)
    expect(readings.pages.certificatesRead).toBe(MAX_CERTIFICATE_PAGES)
    expect(readings.pages.why).toContain("this is not the whole estate")

    // The certificates that WERE read are real and still rendered.
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.certificates.value).toHaveLength(MAX_CERTIFICATE_PAGES)
    const line = lineFor(readings, "Listing")
    expect(line).toContain("TRUNCATED")
    expect(line).not.toContain("complete")
  })
})

/* ------------------------------------------------------ residency and tags -- */

describe("region and partition come from the ARN and the identity, never a literal", () => {
  test("one account holding certificates in two regions reports both", async () => {
    const readings = await load()
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    const app = readings.certificates.value.find((c) => c.domainName === "app.example.com")
    const edge = readings.certificates.value.find((c) => c.domainName === "edge.example.com")
    // A single resolved region for the whole load would be wrong for one of these.
    expect(app?.region).toBe(HOME_REGION)
    expect(edge?.region).toBe(EDGE_REGION)
    expect(app?.accountId).toBe(ACCOUNT)
    expect(app?.partition).toBe("aws")
  })

  test("a GovCloud estate produces GovCloud placement and no us-east-1 anywhere", async () => {
    // The GE-010-007 shape: a hardcoded us-east-1 or a partition guessed as "aws"
    // would place these certificates in the wrong partition on a page an operator
    // uses to decide where data lives.
    const govArn = certArn("us-gov-west-1", "55555555-5555-5555-5555-555555555555", "aws-us-gov")
    const base = appCertificate()
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
      certificates: [
        {
          arn: govArn,
          domainName: "gov.example.com",
          listedStatus: "ISSUED",
          certificate: {
            ...base.certificate,
            CertificateArn: govArn,
            DomainName: "gov.example.com",
            SubjectAlternativeNames: ["gov.example.com"],
            InUseBy: [],
          },
        },
      ],
    })
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    const cert = readings.certificates.value[0]
    expect(cert.partition).toBe("aws-us-gov")
    expect(cert.region).toBe("us-gov-west-1")
    expect(surfaceText(readings)).not.toContain("us-east-1")
  })

  test("with identity unresolved and no ARN to read, no placement is invented", async () => {
    const base = appCertificate()
    const readings = await load({
      identity: "denied",
      certificates: [
        {
          arn: "not-an-arn",
          domainName: "broken.example.com",
          listedStatus: "ISSUED",
          certificate: { ...base.certificate, CertificateArn: "not-an-arn" },
        },
      ],
    })
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    const cert = readings.certificates.value[0]
    expect(cert.region).toBeNull()
    expect(cert.partition).toBeNull()
    expect(cert.accountId).toBeNull()
    expect(surfaceText(readings)).toContain("region unknown")
  })
})

describe("attribution comes from the tag index, and 'we could not look' is its own answer", () => {
  test("a tenure:tenant tag attributes the certificate to that tenant", async () => {
    const readings = await load({
      tags: {
        [STUCK_ARN]: [
          { Key: "tenure:tenant", Value: "simon-ose" },
          { Key: "tenure:environment", Value: "production" },
        ],
      },
    })
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    const stuck = readings.certificates.value.find((c) => c.arn === STUCK_ARN)
    expect(stuck?.attribution).toEqual({ kind: "tenant", tenantSlug: "simon-ose" })
    // And the finding carries it, so the operator knows whose provisioning is stuck.
    if (readings.stuckValidation.kind !== "stuck") throw new Error("narrowing")
    expect(readings.stuckValidation.stuck[0].attribution).toEqual({
      kind: "tenant",
      tenantSlug: "simon-ose",
    })
    expect(surfaceText(readings)).toContain("simon-ose")
  })

  test("the shared sentinel is shared, and an untagged certificate is unattributable", async () => {
    const readings = await load({
      tags: { [APP_ARN]: [{ Key: "tenure:tenant", Value: SHARED }] },
    })
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    const shared = readings.certificates.value.find((c) => c.arn === APP_ARN)
    const untagged = readings.certificates.value.find((c) => c.arn === ORPHAN_ARN)
    expect(shared?.attribution.kind).toBe("shared")
    expect(untagged?.attribution.kind).toBe("unattributed")
    const text = surfaceText(readings)
    expect(text).toContain("shared — platform overhead")
    expect(text).toContain("unattributable — missing tenure:tenant")
  })

  test("a denied tag index makes attribution unknown, not unattributable", async () => {
    // The distinction that matters: "missing tenure:tenant" sends an operator to
    // add a tag that is probably already there.
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    for (const cert of readings.certificates.value) {
      expect(cert.attribution.kind).toBe("unknown")
    }
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    expect(text).toContain("tag:GetResources")
    expect(text).not.toContain("missing tenure:tenant")
  })

  test("a throttled tag index is also unknown, and says throttled", async () => {
    const readings = await load({ tagsOutcome: "throttled" })
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.certificates.value[0].attribution.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("throttled")
  })
})

/* ---------------------------------------------------- as-of and cadence -- */

describe("every reading carries when it was taken and how often it refreshes", () => {
  test("the load stamps an explicit asOf and both capabilities' own cadences", async () => {
    const readings = await load()
    expect(readings.asOf).toBe(NOW_ISO)
    // Not numbers retyped here: these are the registry's declarations, so a
    // cadence changed in capabilities.ts changes what the surface promises.
    expect(readings.refreshMs.certificates).toBe(3_600_000)
    expect(readings.refreshMs.detail).toBe(3_600_000)
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    for (const cert of readings.certificates.value) {
      expect(cert.asOf).toBe(NOW_ISO)
      expect(cert.refreshMs).toBe(3_600_000)
    }
    const text = surfaceText(readings)
    expect(text).toContain("refreshed every 3600s")
    expect(text).toContain(`as of ${NOW_ISO}`)
  })

  test("what a certificate is in use by is stated, and 'nothing' is stated too", async () => {
    const readings = await load()
    const app = lineFor(readings, "app.example.com")
    expect(app).toContain(`in use by ${ALB_ARN}`)
    const orphan = lineFor(readings, "legacy.example.com")
    expect(orphan).toContain("in use by nothing — attached to no resource")
  })

  test("every subject alternative name is carried, including the primary", async () => {
    const readings = await load()
    if (readings.certificates.state !== "ACTUAL") throw new Error("narrowing")
    const app = readings.certificates.value.find((c) => c.arn === APP_ARN)
    if (app?.detail.state !== "ACTUAL") throw new Error("narrowing")
    expect(app.detail.value.subjectAlternativeNames).toEqual([
      "app.example.com",
      "www.example.com",
    ])
    expect(lineFor(readings, "app.example.com")).toContain("covers app.example.com, www.example.com")
  })
})

/* ------------------------------------------------------------- the parsers -- */

describe("the derivations refuse to guess", () => {
  test("expiry with no NotAfter is unknown, never a comfortable number", () => {
    const state = expiryStateOf(null, new Date(NOW_ISO))
    expect(state.kind).toBe("unknown")
    // No `daysRemaining` on this arm at all, so a caller cannot sort on it.
    expect("daysRemaining" in state).toBe(false)
    if (state.kind !== "unknown") throw new Error("narrowing")
    expect(state.why).toContain("Unknown, not distant")
  })

  test("days remaining is truncated, not rounded, and goes negative", () => {
    const now = new Date(NOW_ISO)
    // 23 hours from now is still zero whole days remaining, not one.
    expect(daysBetween(now, new Date(now.getTime() + 23 * 3_600_000))).toBe(0)
    expect(expiryStateOf(daysFromNow(-1), now)).toEqual({
      kind: "expired",
      notAfter: daysFromNow(-1),
      daysRemaining: -1,
    })
  })

  test("no DomainValidationOptions is unknown, not validated", () => {
    const state = validationStateOf(undefined, "AMAZON_ISSUED", "PENDING_VALIDATION")
    expect(state.kind).toBe("unknown")
    if (state.kind !== "unknown") throw new Error("narrowing")
    expect(state.why).toContain("Unknown, not validated")
  })

  test("an imported certificate has no validation, which is a fact and not an unknown", () => {
    expect(validationStateOf(undefined, "IMPORTED", "ISSUED").kind).toBe("not-applicable")
  })

  test("renewal with neither eligibility nor a summary is unknown, not yes", () => {
    const state = renewalStateOf("AMAZON_ISSUED", null, undefined, [])
    expect(state.kind).toBe("unknown")
    if (state.kind !== "unknown") throw new Error("narrowing")
    expect(state.why).toContain("Unknown, not yes")
  })

  test("IMPORTED beats an ELIGIBLE eligibility, because AWS still will not renew it", () => {
    expect(renewalStateOf("IMPORTED", "ELIGIBLE", undefined, []).kind).toBe("imported")
  })

  test("placementOf reads the ARN and falls back to the identity, never to a literal", () => {
    const unresolved = placementOf("not-an-arn", {
      state: "UNCONFIGURED",
      capability: "sts:GetCallerIdentity",
      why: "no credentials",
    })
    expect(unresolved).toEqual({ partition: null, region: null, accountId: null })

    expect(placementOf(certArn("ap-southeast-2", "abc", "aws"), {
      state: "ACTUAL",
      capability: "sts:GetCallerIdentity",
      value: {
        accountId: ACCOUNT,
        arn: `arn:aws:sts::${ACCOUNT}:assumed-role/x/y`,
        partition: "aws",
        region: HOME_REGION,
      },
      asOf: NOW_ISO,
      fresh: true,
    })).toEqual({ partition: "aws", region: "ap-southeast-2", accountId: ACCOUNT })
  })

  test("isoTimestamp accepts what the SDK returns and refuses what it cannot read", () => {
    expect(isoTimestamp(new Date(NOW_ISO))).toBe(NOW_ISO)
    expect(isoTimestamp(NOW_ISO)).toBe(NOW_ISO)
    expect(isoTimestamp(undefined)).toBeNull()
    expect(isoTimestamp("not a date")).toBeNull()
  })
})
