/**
 * STUDIO-070-004 (SES) — the four answers, and the four different sentences.
 *
 * The defect this file exists to catch is the one `read.ts` was written for and
 * that `tools/aws-inventory.mjs` shipped: a denied call rendering as an empty
 * list. On a mail surface it is worse than on an estate surface, because the
 * reassuring version of "no verified identities" and the reassuring version of
 * "we were refused ses:ListEmailIdentities" are the same blank panel, and the
 * operator concludes mail is fine either way.
 *
 * So the stand-in gateway here is required to behave like the real client in
 * FOUR ways for every SES surface — AccessDenied, a throttle, an
 * empty-but-successful response, and a populated one — and every surface is
 * asserted to print four DIFFERENT sentences. A fake that returns `[]`
 * regardless proves nothing at all, which is exactly the fake this programme has
 * been burned by; the one below can raise `AccessDeniedException`, raise
 * `ThrottlingException` on every attempt, answer successfully with nothing, and
 * answer successfully with the pilot's actual SES configuration.
 *
 * Everything is asserted through `sesReadings()` and `sesLines()` — the two
 * functions a route calls. A test that drove `readAccount` or `describeRead`
 * directly would stay green the day the surface stopped calling them, and the
 * mutation proofs recorded in the ledger are applied to the production path for
 * the same reason.
 *
 * The region here is deliberately NOT us-east-1, and one case runs in
 * `aws-us-gov`. GE-010-007 was a hardcoded region; a residency assertion that
 * uses the default region cannot fail.
 */

import { CAPABILITIES, type Capability } from "./capabilities"
import { __resetIdentity } from "./identity"
import { type AwsGateway } from "./read"
import { backoffMs, READ_ATTEMPTS } from "./throttle"
import {
  MAX_PAGES,
  SES_FIRST_BACKOFF_MS,
  SES_RETRY_AFTER_MS,
  mailabilityVerdict,
  maskAddress,
  productionAccessFrom,
  sesArn,
  sesLines,
  sesReadings,
  verificationFrom,
  type SesLine,
  type SesReadings,
} from "./ses"

/* --------------------------------------------------------- the estate -- */

const ACCOUNT = "222233334444"
const REGION = "eu-west-1"
const PARTITION = "aws"
const CALLER_ARN = `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/session`

const DOMAIN = "tenurework.com"
const FROM_ADDRESS = `no-reply@${DOMAIN}`
const CONFIG_SET = "tenure-prod-mail"

const IDENTITY_ARN = `arn:${PARTITION}:ses:${REGION}:${ACCOUNT}:identity/${DOMAIN}`
const CONFIG_SET_ARN = `arn:${PARTITION}:ses:${REGION}:${ACCOUNT}:configuration-set/${CONFIG_SET}`

/* ------------------------------------------------------- the stand-in -- */

type Responder = (input: Record<string, unknown>, callIndex: number) => unknown

interface FakeOptions {
  region?: string
  callerArn?: string
  account?: string
  answers?: Partial<Record<Capability, Responder>>
}

interface Fake {
  gateway: AwsGateway
  calls: Array<{ capability: Capability; input: Record<string, unknown> }>
  countOf(capability: Capability): number
}

/** An SDK-shaped error: the SDK surfaces `name`, and `read.ts` classifies on it. */
function awsError(name: string, message = `${name} raised by the stand-in`): Error {
  const error = new Error(message)
  error.name = name
  return error
}

const throws =
  (name: string, message?: string): Responder =>
  () => {
    throw message === undefined ? awsError(name) : awsError(name, message)
  }

/**
 * The pilot's SES, as `infrastructure/terraform/ses.tf` provisions it: a domain
 * identity that Terraform created and nobody finished verifying at the
 * registrar, a verified from-address, and one configuration set.
 */
const POPULATED: Partial<Record<Capability, Responder>> = {
  "ses:GetAccount": () => ({
    ProductionAccessEnabled: false,
    SendingEnabled: true,
    EnforcementStatus: "HEALTHY",
    SendQuota: { Max24HourSend: 200, MaxSendRate: 1, SentLast24Hours: 41 },
    SuppressionAttributes: { SuppressedReasons: ["BOUNCE", "COMPLAINT"] },
  }),
  "ses:ListEmailIdentities": () => ({
    EmailIdentities: [
      { IdentityName: DOMAIN, IdentityType: "DOMAIN", VerificationStatus: "PENDING", SendingEnabled: true },
      {
        IdentityName: FROM_ADDRESS,
        IdentityType: "EMAIL_ADDRESS",
        VerificationStatus: "SUCCESS",
        SendingEnabled: true,
      },
    ],
  }),
  "ses:ListConfigurationSets": () => ({ ConfigurationSets: [CONFIG_SET] }),
  "ses:GetConfigurationSet": (input) => ({
    ConfigurationSetName: String(input.ConfigurationSetName),
    DeliveryOptions: { TlsPolicy: "REQUIRE" },
    ReputationOptions: { ReputationMetricsEnabled: true },
    SendingOptions: { SendingEnabled: true },
    SuppressionOptions: { SuppressedReasons: ["BOUNCE", "COMPLAINT"] },
  }),
  "ses:ListSuppressedDestinations": () => ({
    SuppressedDestinationSummaries: [
      { EmailAddress: "bounced@example.edu", Reason: "BOUNCE", LastUpdateTime: "2026-08-01T00:00:00.000Z" },
      { EmailAddress: "complained@example.edu", Reason: "COMPLAINT", LastUpdateTime: new Date(0) },
      { EmailAddress: "bounced@example.org", Reason: "BOUNCE", LastUpdateTime: "2026-08-02T00:00:00.000Z" },
    ],
  }),
}

/** A successful answer that contains nothing. Not an error, and not a denial. */
const EMPTY_ANSWERS: Partial<Record<Capability, Responder>> = {
  "ses:GetAccount": () => ({}),
  "ses:ListEmailIdentities": () => ({ EmailIdentities: [] }),
  "ses:ListConfigurationSets": () => ({ ConfigurationSets: [] }),
  "ses:ListSuppressedDestinations": () => ({}),
}

function fakeAws(options: FakeOptions = {}): Fake {
  const region = options.region ?? REGION
  const callerArn = options.callerArn ?? CALLER_ARN
  const account = options.account ?? ACCOUNT
  const calls: Fake["calls"] = []

  const base: Partial<Record<Capability, Responder>> = {
    "sts:GetCallerIdentity": () => ({ Account: account, Arn: callerArn }),
    "tag:GetResources": () => ({ ResourceTagMappingList: [] }),
    ...POPULATED,
  }
  const answers = { ...base, ...(options.answers ?? {}) }

  return {
    calls,
    countOf: (capability) => calls.filter((c) => c.capability === capability).length,
    gateway: {
      async call(capability, input = {}) {
        const index = calls.filter((c) => c.capability === capability).length
        calls.push({ capability, input })
        const responder = answers[capability]
        if (!responder) {
          // The real client answers every capability in the union; an unhandled
          // one is a defect in the fake, not a result to assert on.
          throw new Error(`stand-in has no answer for ${capability}`)
        }
        return responder(input, index)
      },
      async resolvedRegion() {
        return region
      },
    },
  }
}

const FIXED_NOW = () => new Date("2026-08-13T09:30:00.000Z")

/** Every read runs with an instant sleep, so a throttle test costs nothing. */
async function read(options: FakeOptions = {}): Promise<{ readings: SesReadings; fake: Fake }> {
  const fake = fakeAws(options)
  const readings = await sesReadings(fake.gateway, { now: FIXED_NOW, sleep: async () => {} })
  return { readings, fake }
}

function lineFor(lines: readonly SesLine[], surface: string): SesLine {
  const line = lines.find((l) => l.surface === surface)
  if (!line) throw new Error(`no line for ${surface}; got ${lines.map((l) => l.surface).join(", ")}`)
  return line
}

beforeEach(() => {
  // `resolveIdentity` caches per process. Every test supplies its own gateway,
  // which bypasses the cache, but a leaked cache would make the residency cases
  // pass for the wrong reason.
  __resetIdentity()
})

/* =========================================================================
 * 1. The four cases, per surface, through the production render path.
 * ====================================================================== */

interface SurfaceCase {
  surface: string
  capability: Capability
  /** The capability the stand-in breaks to produce denial / throttle. */
  broken: Capability
  /** `GetAccount` always answers with an object, so it is ACTUAL-with-nothing. */
  emptyState: "EMPTY" | "ACTUAL"
  /** A fragment only the populated answer can produce. */
  populatedFragment: string
}

const SURFACES: SurfaceCase[] = [
  {
    surface: "SES account",
    capability: "ses:GetAccount",
    broken: "ses:GetAccount",
    emptyState: "ACTUAL",
    populatedFragment: "SANDBOX",
  },
  {
    surface: "Sending identities",
    capability: "ses:ListEmailIdentities",
    broken: "ses:ListEmailIdentities",
    emptyState: "EMPTY",
    populatedFragment: "NOT VERIFIED",
  },
  {
    surface: "Configuration sets",
    capability: "ses:GetConfigurationSet",
    broken: "ses:GetConfigurationSet",
    emptyState: "EMPTY",
    populatedFragment: CONFIG_SET,
  },
  {
    surface: "Suppression list",
    capability: "ses:ListSuppressedDestinations",
    broken: "ses:ListSuppressedDestinations",
    emptyState: "EMPTY",
    populatedFragment: "BOUNCE",
  },
]

describe("every SES surface answers four different ways", () => {
  test.each(SURFACES)(
    "$surface — denied, throttled, empty and populated are four different sentences",
    async ({ surface, capability, broken, emptyState, populatedFragment }) => {
      const denied = await read({ answers: { [broken]: throws("AccessDeniedException") } })
      const throttled = await read({ answers: { [broken]: throws("ThrottlingException") } })
      const empty = await read({ answers: EMPTY_ANSWERS })
      const populated = await read()

      const deniedLine = lineFor(sesLines(denied.readings), surface)
      const throttledLine = lineFor(sesLines(throttled.readings), surface)
      const emptyLine = lineFor(sesLines(empty.readings), surface)
      const populatedLine = lineFor(sesLines(populated.readings), surface)

      // The states themselves are four, not two.
      expect(deniedLine.read.state).toBe("DENIED")
      expect(throttledLine.read.state).toBe("THROTTLED")
      expect(emptyLine.read.state).toBe(emptyState)
      expect(populatedLine.read.state).toBe("ACTUAL")

      // And the sentences a surface prints are four, not two. This is the
      // assertion the whole file is for.
      const texts = [deniedLine.text, throttledLine.text, emptyLine.text, populatedLine.text]
      expect(new Set(texts).size).toBe(4)

      // A denial names the action and hands over a statement to paste, and
      // never says "none".
      expect(deniedLine.text).toContain(CAPABILITIES[capability].iamActions[0])
      expect(deniedLine.text).toContain('"Effect":"Allow"')
      expect(deniedLine.text).toContain(CALLER_ARN)
      expect(deniedLine.text).toContain(ACCOUNT)
      expect(deniedLine.text).not.toContain("none —")
      expect(deniedLine.text).not.toContain(populatedFragment)

      // A throttle is its own state: not a failure, and not an absence.
      expect(throttledLine.text).toContain("throttled")
      expect(throttledLine.text).toContain(`${SES_RETRY_AFTER_MS}ms`)
      expect(throttledLine.text).not.toContain("none —")
      expect(throttledLine.text).not.toContain('"Effect":"Allow"')

      // An empty-but-successful read is a claim, and says so without an IAM
      // statement attached.
      expect(emptyLine.text).not.toContain('"Effect":"Allow"')
      expect(emptyLine.text).not.toContain(populatedFragment)

      // The populated read carries the fact only real data can produce.
      expect(populatedLine.text).toContain(populatedFragment)
    },
  )

  test("a denied SES read is never an empty list", async () => {
    const { readings } = await read({
      answers: {
        "ses:ListEmailIdentities": throws("AccessDeniedException"),
        "ses:ListSuppressedDestinations": throws("AccessDeniedException"),
      },
    })
    // The point of the union: there is no `value` to reach for, so a surface
    // cannot render zero rows out of a refusal.
    expect(readings.identities.state).toBe("DENIED")
    expect(readings.suppressed.state).toBe("DENIED")
    expect("value" in readings.identities).toBe(false)
    expect("value" in readings.suppressed).toBe(false)
  })

  test("each denial arm carries the region and partition it was refused in", async () => {
    const { readings } = await read({ answers: { "ses:GetAccount": throws("AccessDeniedException") } })
    const account = readings.account
    if (account.state !== "DENIED") throw new Error(`expected DENIED, got ${account.state}`)
    expect(account.region).toBe(REGION)
    expect(account.partition).toBe(PARTITION)
    expect(account.accountId).toBe(ACCOUNT)
    expect(account.action).toBe("ses:GetAccount")
  })
})

/* =========================================================================
 * 2. The sandbox, and the refusal to invent an approval.
 * ====================================================================== */

describe("sandbox state is stated, never assumed", () => {
  test("ProductionAccessEnabled false renders as SANDBOX with its consequence", async () => {
    const { readings } = await read()
    const line = lineFor(sesLines(readings), "SES account")
    expect(line.text).toContain("SANDBOX")
    expect(line.text).toContain("verified identities")
    expect(line.text).not.toContain("production access is granted")
  })

  test("ProductionAccessEnabled true renders as production access", async () => {
    const { readings } = await read({
      answers: {
        "ses:GetAccount": () => ({
          ProductionAccessEnabled: true,
          SendingEnabled: true,
          SendQuota: { Max24HourSend: 50000, MaxSendRate: 14, SentLast24Hours: 120 },
        }),
      },
    })
    const line = lineFor(sesLines(readings), "SES account")
    expect(line.text).toContain("production access")
    expect(line.text).not.toContain("SANDBOX")
  })

  test("an ABSENT ProductionAccessEnabled is UNSTATED — never production, never sandbox", async () => {
    // The fabricated-approval guard. Production access is an approval AWS
    // grants; a console that resolves a missing field either way has written
    // down a decision nobody made.
    const { readings } = await read({ answers: EMPTY_ANSWERS })
    const account = readings.account
    if (account.state !== "ACTUAL") throw new Error(`expected ACTUAL, got ${account.state}`)
    expect(account.value.productionAccess.state).toBe("UNSTATED")

    const line = lineFor(sesLines(readings), "SES account")
    expect(line.text).toContain("UNSTATED")
    expect(line.text).not.toContain("SANDBOX")
    expect(line.text).not.toMatch(/production access is granted|has granted/)
  })

  test("the three production-access answers are three distinct values", () => {
    expect(productionAccessFrom(true).state).toBe("PRODUCTION")
    expect(productionAccessFrom(false).state).toBe("SANDBOX")
    expect(productionAccessFrom(undefined).state).toBe("UNSTATED")
    expect(productionAccessFrom(null).state).toBe("UNSTATED")
  })

  test("a production-access review is carried verbatim or not at all", async () => {
    const absent = await read()
    const withReview = await read({
      answers: {
        "ses:GetAccount": () => ({
          ProductionAccessEnabled: false,
          Details: { ReviewDetails: { Status: "PENDING", CaseId: "case-4417" } },
        }),
      },
    })

    const a = absent.readings.account
    const b = withReview.readings.account
    if (a.state !== "ACTUAL" || b.state !== "ACTUAL") throw new Error("expected ACTUAL")

    // Absent means absent: no invented status, no invented date.
    expect(a.value.productionAccessReview.stated).toBe(false)
    if (b.value.productionAccessReview.stated !== true) throw new Error("expected a stated review")
    expect(b.value.productionAccessReview.value).toEqual({ status: "PENDING", caseId: "case-4417" })
  })

  test("an unstated sending switch is not a disabled one", async () => {
    const { readings } = await read({ answers: EMPTY_ANSWERS })
    const account = readings.account
    if (account.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(account.value.sendingEnabled.stated).toBe(false)
    const line = lineFor(sesLines(readings), "SES account")
    expect(line.text).toContain("unstated")
    expect(line.text).not.toContain("sending DISABLED")
  })
})

/* =========================================================================
 * 3. Verification — the domain Terraform created and nobody finished.
 * ====================================================================== */

describe("identity verification", () => {
  test("only SUCCESS is verified; every other status names the consequence", () => {
    expect(verificationFrom("SUCCESS").state).toBe("VERIFIED")
    expect(verificationFrom("PENDING").state).toBe("NOT_VERIFIED")
    expect(verificationFrom("FAILED").state).toBe("NOT_VERIFIED")
    expect(verificationFrom("TEMPORARY_FAILURE").state).toBe("NOT_VERIFIED")
    expect(verificationFrom("NOT_STARTED").state).toBe("NOT_VERIFIED")
    expect(verificationFrom(undefined).state).toBe("UNSTATED")
    expect(verificationFrom("").state).toBe("UNSTATED")
  })

  test("the surface names the unverified domain rather than counting it as fine", async () => {
    const { readings } = await read()
    const line = lineFor(sesLines(readings), "Sending identities")
    expect(line.text).toContain("1 of 2 verified")
    expect(line.text).toContain(DOMAIN)
    expect(line.text).toContain("NOT VERIFIED")
  })

  test("an unstated verification is neither verified nor unverified", async () => {
    const { readings } = await read({
      answers: {
        "ses:ListEmailIdentities": () => ({ EmailIdentities: [{ IdentityName: DOMAIN }] }),
      },
    })
    const line = lineFor(sesLines(readings), "Sending identities")
    expect(line.text).toContain("0 of 1 verified")
    expect(line.text).toContain("SES did not state")
    expect(line.text).not.toContain("NOT VERIFIED")
  })
})

/* =========================================================================
 * 4. The verdict — and the four inputs that make it four answers.
 * ====================================================================== */

describe("mailability", () => {
  test("a verified identity in the sandbox can send, with the restriction named", async () => {
    const { readings } = await read()
    const verdict = mailabilityVerdict(readings)
    if (verdict.verdict !== "CAN_SEND") throw new Error(`expected CAN_SEND, got ${verdict.verdict}`)
    expect(verdict.sendableFrom).toEqual([FROM_ADDRESS])
    expect(verdict.recipientRestriction).toContain("sandbox")
  })

  test("no verified identity is CANNOT_SEND, with each blocked identity's reason", async () => {
    const { readings } = await read({
      answers: {
        "ses:ListEmailIdentities": () => ({
          EmailIdentities: [{ IdentityName: DOMAIN, VerificationStatus: "PENDING", SendingEnabled: true }],
        }),
      },
    })
    const verdict = mailabilityVerdict(readings)
    if (verdict.verdict !== "CANNOT_SEND") throw new Error(`expected CANNOT_SEND, got ${verdict.verdict}`)
    expect(verdict.blocked.map((b) => b.name)).toEqual([DOMAIN])
    expect(verdict.blocked[0].why).toContain("PENDING")
  })

  test("an EMPTY identity list is CANNOT_SEND — a real answer, not an unknown", async () => {
    const { readings } = await read({ answers: EMPTY_ANSWERS })
    // GetAccount answered with nothing, so production access is UNSTATED — but
    // "SES holds no identities" is decidable without it.
    const verdict = mailabilityVerdict(readings)
    if (verdict.verdict !== "CANNOT_SEND") throw new Error(`expected CANNOT_SEND, got ${verdict.verdict}`)
    expect(verdict.why).toContain("no sending identities")
  })

  test("a DENIED identity list is UNKNOWN — never CAN_SEND and never CANNOT_SEND", async () => {
    const { readings } = await read({
      answers: { "ses:ListEmailIdentities": throws("AccessDeniedException") },
    })
    const verdict = mailabilityVerdict(readings)
    expect(verdict.verdict).toBe("UNKNOWN")
    expect(verdict.why).toContain("ses:ListEmailIdentities")
  })

  test("a THROTTLED account read is UNKNOWN, not a sandbox claim", async () => {
    const { readings } = await read({ answers: { "ses:GetAccount": throws("ThrottlingException") } })
    const verdict = mailabilityVerdict(readings)
    expect(verdict.verdict).toBe("UNKNOWN")
    expect(verdict.why).toContain("throttled")
  })

  test("the four verdict sentences are four different sentences", async () => {
    const canSend = mailabilityVerdict((await read()).readings)
    const cannotSend = mailabilityVerdict(
      (
        await read({
          answers: {
            "ses:ListEmailIdentities": () => ({
              EmailIdentities: [{ IdentityName: DOMAIN, VerificationStatus: "FAILED" }],
            }),
          },
        })
      ).readings,
    )
    const deniedVerdict = mailabilityVerdict(
      (await read({ answers: { "ses:GetAccount": throws("AccessDeniedException") } })).readings,
    )
    const throttledVerdict = mailabilityVerdict(
      (await read({ answers: { "ses:GetAccount": throws("ThrottlingException") } })).readings,
    )
    const whys = [canSend.why, cannotSend.why, deniedVerdict.why, throttledVerdict.why]
    expect(new Set(whys).size).toBe(4)
  })

  test("account-wide sending disabled beats a verified identity", async () => {
    const { readings } = await read({
      answers: {
        "ses:GetAccount": () => ({ ProductionAccessEnabled: true, SendingEnabled: false }),
      },
    })
    const verdict = mailabilityVerdict(readings)
    if (verdict.verdict !== "CANNOT_SEND") throw new Error(`expected CANNOT_SEND, got ${verdict.verdict}`)
    expect(verdict.why).toContain("account-wide")
  })
})

/* =========================================================================
 * 5. Residency — region and partition come from the resolved identity.
 * ====================================================================== */

describe("the estate is resolved, never assumed", () => {
  test("SES ARNs are built from the identity's own partition, region and account", async () => {
    const { readings } = await read()
    const identities = readings.identities
    if (identities.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(identities.value[0].arn).toBe(IDENTITY_ARN)
    expect(identities.value[0].arn).not.toContain("us-east-1")

    const sets = readings.configurationSets
    if (sets.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(sets.value[0].arn).toBe(CONFIG_SET_ARN)
  })

  test("a GovCloud estate produces GovCloud ARNs and attributes there", async () => {
    const govAccount = "555566667777"
    const govRegion = "us-gov-west-1"
    const govArn = `arn:aws-us-gov:ses:${govRegion}:${govAccount}:identity/${DOMAIN}`

    const { readings } = await read({
      region: govRegion,
      account: govAccount,
      callerArn: `arn:aws-us-gov:sts::${govAccount}:assumed-role/tenure-studio-task/session`,
      answers: {
        "tag:GetResources": () => ({
          ResourceTagMappingList: [
            { ResourceARN: govArn, Tags: [{ Key: "tenure:tenant", Value: "simon-ose" }] },
          ],
        }),
      },
    })

    const identities = readings.identities
    if (identities.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(identities.value[0].arn).toBe(govArn)
    // The tag join only lands if the ARN was built in the right partition AND
    // region. A hardcoded `aws` / `us-east-1` misses this entry entirely and
    // the identity reads as unattributable.
    expect(identities.value[0].attribution).toEqual({ kind: "tenant", tenantSlug: "simon-ose" })
  })

  test("no ARN is built when identity is unresolved, and attribution says so", async () => {
    const { readings } = await read({
      answers: { "sts:GetCallerIdentity": throws("AccessDeniedException") },
    })
    const identities = readings.identities
    if (identities.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(identities.value[0].arn).toBeNull()
    expect(identities.value[0].attribution.kind).toBe("unknown")
    // And the SES denial context degrades honestly rather than going blank.
    expect(readings.identity.state).toBe("DENIED")
  })

  test("sesArn refuses to assemble an ARN without an identity", () => {
    expect(sesArn(null, "identity", DOMAIN)).toBeNull()
    expect(
      sesArn({ accountId: ACCOUNT, arn: CALLER_ARN, partition: PARTITION, region: REGION }, "configuration-set", CONFIG_SET),
    ).toBe(CONFIG_SET_ARN)
  })
})

/* =========================================================================
 * 6. Attribution — four answers, four sentences.
 * ====================================================================== */

describe("tenant attribution goes through the tagging API", () => {
  const tagged = (tags: Array<{ Key: string; Value: string }>) => ({
    "tag:GetResources": (() => ({
      ResourceTagMappingList: [{ ResourceARN: CONFIG_SET_ARN, Tags: tags }],
    })) as Responder,
  })

  test("a tenant tag attributes to that tenant", async () => {
    const { readings } = await read({ answers: tagged([{ Key: "tenure:tenant", Value: "simon-ose" }]) })
    const sets = readings.configurationSets
    if (sets.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(sets.value[0].attribution).toEqual({ kind: "tenant", tenantSlug: "simon-ose" })
  })

  test("the shared VALUE marks a resource shared", async () => {
    const { readings } = await read({ answers: tagged([{ Key: "tenure:tenant", Value: "tenure:shared" }]) })
    const sets = readings.configurationSets
    if (sets.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(sets.value[0].attribution).toEqual({ kind: "shared" })
  })

  test("no tenant tag is unattributable — and is NOT folded into shared", async () => {
    const { readings } = await read({ answers: tagged([{ Key: "tenure:module", Value: "mail" }]) })
    const sets = readings.configurationSets
    if (sets.state !== "ACTUAL") throw new Error("expected ACTUAL")
    // `tags.ts` is explicit that these are different facts: an untagged
    // resource treated as platform overhead becomes every tenant's problem.
    expect(sets.value[0].attribution).toEqual({ kind: "unattributed" })
  })

  test("a DENIED tag index is unknown attribution, not unattributable", async () => {
    const { readings } = await read({ answers: { "tag:GetResources": throws("AccessDeniedException") } })
    const sets = readings.configurationSets
    if (sets.state !== "ACTUAL") throw new Error("expected ACTUAL")
    const attribution = sets.value[0].attribution
    expect(attribution.kind).toBe("unknown")
    if (attribution.kind !== "unknown") throw new Error("expected unknown")
    expect(attribution.why).toContain("tag:GetResources")
    expect(readings.tagged.state).toBe("DENIED")
  })

  test("the SES account itself is shared as a fact, not as a fallback", async () => {
    const { readings } = await read()
    const account = readings.account
    if (account.state !== "ACTUAL") throw new Error("expected ACTUAL")
    // There is no per-tenant SES account to attribute.
    expect(account.value.attribution).toEqual({ kind: "shared" })
  })

  test("the four attribution answers render as four different sentences", async () => {
    const runs = await Promise.all([
      read({ answers: tagged([{ Key: "tenure:tenant", Value: "simon-ose" }]) }),
      read({ answers: tagged([{ Key: "tenure:tenant", Value: "tenure:shared" }]) }),
      read({ answers: tagged([{ Key: "tenure:module", Value: "mail" }]) }),
      read({ answers: { "tag:GetResources": throws("AccessDeniedException") } }),
    ])
    const texts = runs.map((r) => lineFor(sesLines(r.readings), "Configuration sets").text)
    expect(new Set(texts).size).toBe(4)
  })
})

/* =========================================================================
 * 7. The throttle schedule is throttle.ts's, not a second one.
 * ====================================================================== */

describe("throttling", () => {
  test("the attempt budget and the wait an operator is told both come from throttle.ts", async () => {
    const { readings, fake } = await read({
      answers: { "ses:ListSuppressedDestinations": throws("ThrottlingException") },
    })
    expect(fake.countOf("ses:ListSuppressedDestinations")).toBe(READ_ATTEMPTS)

    const suppressed = readings.suppressed
    if (suppressed.state !== "THROTTLED") throw new Error(`expected THROTTLED, got ${suppressed.state}`)
    // Not a number typed here: the schedule is `throttle.ts`'s, so changing it
    // there changes what this panel says.
    expect(suppressed.retryAfterMs).toBe(backoffMs(READ_ATTEMPTS + 1))
    expect(SES_FIRST_BACKOFF_MS).toBe(backoffMs(2))
    expect(SES_RETRY_AFTER_MS).toBe(backoffMs(READ_ATTEMPTS + 1))
  })

  test("a throttle that clears on the second attempt is an ordinary read", async () => {
    let attempts = 0
    const { readings } = await read({
      answers: {
        "ses:ListSuppressedDestinations": () => {
          attempts += 1
          if (attempts === 1) throw awsError("TooManyRequestsException")
          return { SuppressedDestinationSummaries: [{ EmailAddress: "x@example.edu", Reason: "BOUNCE" }] }
        },
      },
    })
    expect(readings.suppressed.state).toBe("ACTUAL")
  })

  test("a throttle is not an error and not an empty list", async () => {
    const { readings } = await read({
      answers: { "ses:ListEmailIdentities": throws("ProvisionedThroughputExceededException") },
    })
    expect(readings.identities.state).toBe("THROTTLED")
    expect("value" in readings.identities).toBe(false)
  })
})

/* =========================================================================
 * 8. One capability's refusal is not another capability's emptiness.
 * ====================================================================== */

describe("a gated read reports the refusal that actually happened", () => {
  test("a denied ListConfigurationSets does not render as 'no configuration sets'", async () => {
    const { readings, fake } = await read({
      answers: { "ses:ListConfigurationSets": throws("AccessDeniedException") },
    })
    const sets = readings.configurationSets
    if (sets.state !== "DENIED") throw new Error(`expected DENIED, got ${sets.state}`)
    // The action named is the one that was refused, not the one that was
    // never attempted. An operator sent to grant GetConfigurationSet would
    // change nothing.
    expect(sets.action).toBe("ses:ListConfigurationSets")
    expect(fake.countOf("ses:GetConfigurationSet")).toBe(0)

    const line = lineFor(sesLines(readings), "Configuration sets")
    expect(line.capability).toBe("ses:ListConfigurationSets")
    expect(line.text).toContain("ses:ListConfigurationSets")
    expect(line.text).not.toContain("none —")
  })

  test("an empty set list stays EMPTY and asks for no detail", async () => {
    const { readings, fake } = await read({
      answers: { "ses:ListConfigurationSets": () => ({ ConfigurationSets: [] }) },
    })
    expect(readings.configurationSets.state).toBe("EMPTY")
    expect(fake.countOf("ses:GetConfigurationSet")).toBe(0)
  })

  test("a throttled set list carries the throttle, not an emptiness", async () => {
    const { readings } = await read({
      answers: { "ses:ListConfigurationSets": throws("ThrottlingException") },
    })
    expect(readings.configurationSets.state).toBe("THROTTLED")
  })
})

/* =========================================================================
 * 9. Paging, and admitting when a list is incomplete.
 * ====================================================================== */

describe("paging", () => {
  test("every page of identities is walked and the token is passed back", async () => {
    const { readings, fake } = await read({
      answers: {
        "ses:ListEmailIdentities": (_input, n) =>
          n === 0
            ? {
                EmailIdentities: [{ IdentityName: DOMAIN, VerificationStatus: "SUCCESS" }],
                NextToken: "page-2",
              }
            : { EmailIdentities: [{ IdentityName: FROM_ADDRESS, VerificationStatus: "SUCCESS" }] },
      },
    })
    const identities = readings.identities
    if (identities.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(identities.value.map((i) => i.name)).toEqual([DOMAIN, FROM_ADDRESS])
    const second = fake.calls.filter((c) => c.capability === "ses:ListEmailIdentities")[1]
    expect(second.input.NextToken).toBe("page-2")
  })

  test("a suppression list longer than the page budget says it is truncated", async () => {
    const { readings } = await read({
      answers: {
        // Always another page. The real list can be very long.
        "ses:ListSuppressedDestinations": (_input, n) => ({
          SuppressedDestinationSummaries: [
            { EmailAddress: `p${n}@example.edu`, Reason: "BOUNCE", LastUpdateTime: "2026-08-01T00:00:00.000Z" },
          ],
          NextToken: `page-${n + 1}`,
        }),
      },
    })
    const suppressed = readings.suppressed
    if (suppressed.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(suppressed.value.entries).toHaveLength(MAX_PAGES)
    expect(suppressed.value.truncated).toBe(true)

    const line = lineFor(sesLines(readings), "Suppression list")
    expect(line.text).toContain("TRUNCATED")
    expect(line.text).toContain("may still be suppressed")
  })

  test("a complete suppression list is not marked truncated", async () => {
    const { readings } = await read()
    const suppressed = readings.suppressed
    if (suppressed.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(suppressed.value.truncated).toBe(false)
    expect(lineFor(sesLines(readings), "Suppression list").text).not.toContain("TRUNCATED")
  })
})

/* =========================================================================
 * 10. The suppression list, and the people in it.
 * ====================================================================== */

describe("suppression", () => {
  test("counts by reason and by domain, and the default sentence carries no local part", async () => {
    const { readings } = await read()
    const suppressed = readings.suppressed
    if (suppressed.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(suppressed.value.byReason).toEqual({ BOUNCE: 2, COMPLAINT: 1 })
    expect(suppressed.value.byDomain).toEqual({ "example.edu": 2, "example.org": 1 })

    const line = lineFor(sesLines(readings), "Suppression list")
    expect(line.text).toContain("3 addresses")
    expect(line.text).toContain("BOUNCE 2")
    expect(line.text).toContain("example.edu 2")
    // The shape of the problem, without anybody's address in it.
    expect(line.text).not.toContain("bounced@")
    expect(line.text).not.toContain("complained@")
  })

  test("each entry keeps the real address and a masked one", async () => {
    const { readings } = await read()
    const suppressed = readings.suppressed
    if (suppressed.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(suppressed.value.entries[0].address).toBe("bounced@example.edu")
    expect(suppressed.value.entries[0].maskedAddress).toBe("[address]@example.edu")
    expect(maskAddress("someone@example.org")).toBe("[address]@example.org")
    expect(maskAddress("not-an-address")).toBe("[address]")
    expect(maskAddress("@example.org")).toBe("[address]")
  })

  test("a Date and an ISO string both become one ISO string", async () => {
    const { readings } = await read()
    const suppressed = readings.suppressed
    if (suppressed.state !== "ACTUAL") throw new Error("expected ACTUAL")
    const [first, second] = suppressed.value.entries
    expect(first.lastUpdatedAt).toEqual({ stated: true, value: "2026-08-01T00:00:00.000Z" })
    expect(second.lastUpdatedAt).toEqual({ stated: true, value: "1970-01-01T00:00:00.000Z" })
  })

  test("an entry SES gave no reason for says so rather than guessing BOUNCE", async () => {
    const { readings } = await read({
      answers: {
        "ses:ListSuppressedDestinations": () => ({
          SuppressedDestinationSummaries: [{ EmailAddress: "x@example.edu" }],
        }),
      },
    })
    const suppressed = readings.suppressed
    if (suppressed.state !== "ACTUAL") throw new Error("expected ACTUAL")
    expect(suppressed.value.entries[0].reason.stated).toBe(false)
    expect(suppressed.value.byReason).toEqual({})
  })

  test("an empty suppression list is EMPTY, which is a reassuring answer and a real one", async () => {
    const { readings } = await read({
      answers: { "ses:ListSuppressedDestinations": () => ({ SuppressedDestinationSummaries: [] }) },
    })
    expect(readings.suppressed.state).toBe("EMPTY")
    expect(lineFor(sesLines(readings), "Suppression list").text).toContain("none")
  })
})

/* =========================================================================
 * 11. As-of and cadence, carried explicitly.
 * ====================================================================== */

describe("every line carries when it was read and how often it is re-read", () => {
  test("as-of is the reading's own timestamp, and null where there was no reading", async () => {
    const good = await read()
    for (const line of sesLines(good.readings)) {
      expect(line.asOf).toBe("2026-08-13T09:30:00.000Z")
      expect(line.text).toContain("2026-08-13T09:30:00.000Z")
    }

    const denied = await read({ answers: { "ses:GetAccount": throws("AccessDeniedException") } })
    // A DENIED arm took no reading; claiming an as-of would be claiming a look.
    expect(lineFor(sesLines(denied.readings), "SES account").asOf).toBeNull()
  })

  test("each line's cadence is its own capability's, and SES has three of them", async () => {
    const { readings } = await read()
    const lines = sesLines(readings)
    expect(lineFor(lines, "SES account").refreshMs).toBe(CAPABILITIES["ses:GetAccount"].refreshMs)
    expect(lineFor(lines, "Sending identities").refreshMs).toBe(
      CAPABILITIES["ses:ListEmailIdentities"].refreshMs,
    )
    expect(lineFor(lines, "Configuration sets").refreshMs).toBe(
      CAPABILITIES["ses:GetConfigurationSet"].refreshMs,
    )
    expect(lineFor(lines, "Suppression list").refreshMs).toBe(
      CAPABILITIES["ses:ListSuppressedDestinations"].refreshMs,
    )
    // Three distinct cadences: account state, configuration, suppression. One
    // TTL for all of them is either a stale console or a bill.
    expect(new Set(lines.map((l) => l.refreshMs)).size).toBe(3)
  })
})

/* =========================================================================
 * 12. The other error shapes SES actually raises.
 * ====================================================================== */

describe("other failures are neither denials nor absences", () => {
  test("an unmodelled failure is ERROR with a lead, not EMPTY", async () => {
    const { readings } = await read({
      answers: { "ses:GetAccount": throws("BadRequestException", "the request was malformed") },
    })
    const account = readings.account
    if (account.state !== "ERROR") throw new Error(`expected ERROR, got ${account.state}`)
    expect(account.code).toBe("BadRequestException")
    expect(account.safeDetail).toContain("malformed")
    expect(lineFor(sesLines(readings), "SES account").text).toContain("error —")
  })

  test("a credential material in an error message never reaches the surface", async () => {
    const { readings } = await read({
      answers: {
        "ses:GetAccount": throws(
          "BadRequestException",
          "rejected for principal AKIAIOSFODNN7EXAMPLE on this account",
        ),
      },
    })
    const line = lineFor(sesLines(readings), "SES account")
    expect(line.text).not.toContain("AKIAIOSFODNN7EXAMPLE")
    expect(line.text).toContain("[access-key-id]")
  })

  test("the five SES capabilities this module reads are all in the registry", () => {
    for (const capability of [
      "ses:GetAccount",
      "ses:ListEmailIdentities",
      "ses:ListConfigurationSets",
      "ses:GetConfigurationSet",
      "ses:ListSuppressedDestinations",
    ] as Capability[]) {
      expect(CAPABILITIES[capability]).toBeDefined()
      expect(CAPABILITIES[capability].iamActions.length).toBeGreaterThan(0)
    }
    // `ses:SendEmail` is deliberately absent: a console that reads every
    // tenant's mail configuration must not be able to send as them.
    expect(Object.keys(CAPABILITIES)).not.toContain("ses:SendEmail")
  })
})
