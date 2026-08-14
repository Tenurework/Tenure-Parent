import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  CONSOLE_POOL_TAG_KEY,
  CONSOLE_POOL_TAG_VALUE,
  MAX_OPERATOR_PAGES,
  MAX_POOL_PAGES,
  cognitoLines,
  cognitoReadings,
  type CognitoReadings,
} from "./cognito"

/**
 * STUDIO-070-004 (Cognito) — the console can finally see its own front door,
 * and it tells four different truths apart while doing it.
 *
 * Every assertion is on `cognitoReadings` and `cognitoLines`, the two functions
 * a surface calls, rather than on `readAws`, a parser or a helper. A test that
 * drove a private helper would stay green on the day this module stopped
 * calling it, which is the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers all seven Cognito capabilities plus STS and the Tagging API
 * with the shapes the real SDK returns — `{UserPools, NextToken}`,
 * `{UserPool: {Policies: {PasswordPolicy: …}}}`, `{MfaConfiguration,
 * SoftwareTokenMfaConfiguration}`, `{UserPoolClients}`, `{UserPoolClient:
 * {ClientSecret, …}}`, `{DomainDescription}`, `{Users, PaginationToken}` — and
 * every one of them can fail INDEPENDENTLY with `AccessDeniedException`, a
 * `ThrottlingException`, an empty-but-successful answer or a populated one. A
 * stand-in that returned `[]` regardless of what was asked would prove nothing
 * about code whose entire job is telling those four apart, and it is the fake
 * this repository has already been burnt by.
 *
 * Dates arrive as `Date` objects, because that is what the SDK hands back. A
 * fake handing ISO strings would have hidden the conversion the module has to
 * perform, and a mis-parsed `UserCreateDate` is exactly what makes the
 * temporary-password arithmetic silently wrong.
 *
 * ## The estate in this fixture
 *
 * `123456789012` is an obviously constructed account id, not a real one, and no
 * ARN, pool identifier or domain below names any real resource.
 *
 * The fixture reproduces the 2026-08-13 audit: an operator pool whose MFA was
 * left OPTIONAL, whose accounts were seeded administratively, and where one
 * account reached CONFIRMED three seconds after it was created — the observable
 * shadow of a permanent password set at provisioning time.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const OTHER_REGION = "eu-central-1"

/** The console's own pool. Deliberately given a boring name — the TAG identifies it. */
const CONSOLE_POOL = `${REGION}_AaAaAaAaA`

/**
 * A second pool with a name that looks exactly like the one somebody would
 * pick the console's pool by, and no identifying tag. If identification ever
 * regresses to matching on a name, this pool is what it will choose.
 */
const DECOY_POOL = `${REGION}_BbBbBbBbB`

const NOW = new Date("2026-08-13T09:15:00.000Z")
const AT = () => NOW

function poolArn(poolId: string, region = REGION, partition = "aws"): string {
  return `arn:${partition}:cognito-idp:${region}:${ACCOUNT}:userpool/${poolId}`
}

/** The Studio stack's tags. `tenure:module` is the load-bearing one. */
function studioTags(): Record<string, string> {
  return {
    [CONSOLE_POOL_TAG_KEY]: CONSOLE_POOL_TAG_VALUE,
    "tenure:tenant": "tenure:shared",
    "tenure:environment": "production",
  }
}

/** A client secret. Never asserted as present — asserted as ABSENT from every output. */
const CLIENT_SECRET = "a-client-secret-that-must-never-be-rendered"

interface UserFixture {
  username: string
  email?: string
  status?: string
  enabled?: boolean
  created: string
  lastModified: string
  mfaOptions?: Array<{ DeliveryMedium?: string; AttributeName?: string }>
  /** Extra attributes, to prove the module drops everything but the identifier. */
  extraAttributes?: Array<{ Name: string; Value: string }>
}

/**
 * The four operator accounts the audit would have found.
 *
 * `ops-a` is the defect: CONFIRMED three seconds after creation in a pool only
 * an administrator can create accounts in.
 * `ops-b` is stranded: still awaiting a first sign-in twelve days into a
 * seven-day temporary-password window.
 * `ops-c` is pending and still inside the window — a live credential.
 * `ops-d` is a normal account: created in May, confirmed a month later.
 */
function operatorFixtures(): UserFixture[] {
  return [
    {
      username: "ops-a",
      email: "ops-a@example.test",
      status: "CONFIRMED",
      created: "2026-05-01T00:00:00.000Z",
      lastModified: "2026-05-01T00:00:03.000Z",
      extraAttributes: [{ Name: "phone_number", Value: "+15550000000" }],
    },
    {
      username: "ops-b",
      email: "ops-b@example.test",
      status: "FORCE_CHANGE_PASSWORD",
      created: "2026-07-30T09:15:00.000Z",
      lastModified: "2026-08-01T09:15:00.000Z",
    },
    {
      username: "ops-c",
      email: "ops-c@example.test",
      status: "FORCE_CHANGE_PASSWORD",
      created: "2026-08-11T09:15:00.000Z",
      lastModified: "2026-08-11T09:15:00.000Z",
    },
    {
      username: "ops-d",
      email: "ops-d@example.test",
      status: "CONFIRMED",
      created: "2026-05-01T00:00:00.000Z",
      lastModified: "2026-06-01T00:00:00.000Z",
      mfaOptions: [{ DeliveryMedium: "SMS", AttributeName: "phone_number" }],
    },
  ]
}

interface PoolFixture {
  poolId: string
  /** What `ListUserPools` calls it. Never load-bearing. */
  listedName: string
  arn?: string
  mfaConfiguration?: string
  softwareTokenEnabled?: boolean
  adminCreateUserOnly?: boolean
  temporaryPasswordValidityDays?: number | null
  tags?: Record<string, string>
  domain?: string | null
  users?: UserFixture[]
  clientIds?: string[]
}

function consolePoolFixture(): PoolFixture {
  return {
    poolId: CONSOLE_POOL,
    listedName: "pool-one",
    arn: poolArn(CONSOLE_POOL),
    // THE DEFECT. `infrastructure/studio/cognito.tf` says ON; this fixture is
    // the estate as the audit found it.
    mfaConfiguration: "OPTIONAL",
    softwareTokenEnabled: true,
    adminCreateUserOnly: true,
    temporaryPasswordValidityDays: 7,
    tags: studioTags(),
    domain: "tenure-prod-operators-domain",
    users: operatorFixtures(),
    clientIds: ["client-one"],
  }
}

function decoyPoolFixture(): PoolFixture {
  return {
    poolId: DECOY_POOL,
    // The name somebody would pick by. No identifying tag.
    listedName: "tenure-prod-operators",
    arn: poolArn(DECOY_POOL),
    mfaConfiguration: "ON",
    softwareTokenEnabled: true,
    adminCreateUserOnly: true,
    temporaryPasswordValidityDays: 7,
    tags: { "tenure:tenant": "tenure:shared" },
    domain: null,
    users: [],
    clientIds: [],
  }
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  listPools?: Outcome
  describePool?: Outcome | "denied-for-console"
  mfaConfig?: Outcome
  listClients?: Outcome
  describeClient?: Outcome
  describeDomain?: Outcome
  listUsers?: Outcome
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  pools?: PoolFixture[]
  /** Emits a NextToken on every page, so the bound and its signal can be exercised. */
  endlessPoolPages?: boolean
  endlessUserPages?: boolean
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function gate(outcome: Outcome): void {
  if (outcome === "denied") throwing("AccessDeniedException")
  if (outcome === "throttled") throwing("ThrottlingException")
}

function fakeAws(options: FakeOptions = {}): AwsGateway {
  const pools = options.pools ?? [consolePoolFixture(), decoyPoolFixture()]
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/session`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []
  const find = (id: unknown): PoolFixture | undefined =>
    pools.find((p) => p.poolId === String(id))

  return {
    async call(capability, input) {
      calls.push(String(capability))
      const arg = (input ?? {}) as Record<string, unknown>

      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "tag:GetResources": {
          const outcome = options.tagsOutcome ?? "populated"
          gate(outcome)
          if (outcome === "empty") return { ResourceTagMappingList: [] }
          return {
            ResourceTagMappingList: pools
              .filter((p) => p.arn)
              .map((p) => ({
                ResourceARN: p.arn,
                Tags: Object.entries(p.tags ?? {}).map(([Key, Value]) => ({ Key, Value })),
              })),
          }
        }

        case "cognito-idp:ListUserPools": {
          const outcome = options.listPools ?? "populated"
          gate(outcome)
          // The real API OMITS UserPools entirely when there are none.
          if (outcome === "empty") return {}
          if (options.endlessPoolPages) {
            return {
              UserPools: pools.map((p) => ({ Id: p.poolId, Name: p.listedName })),
              NextToken: "there-is-always-another-page",
            }
          }
          return { UserPools: pools.map((p) => ({ Id: p.poolId, Name: p.listedName })) }
        }

        case "cognito-idp:DescribeUserPool": {
          const outcome = options.describePool ?? "populated"
          if (outcome === "denied-for-console") {
            if (String(arg.UserPoolId) === CONSOLE_POOL) throwing("AccessDeniedException")
          } else {
            gate(outcome)
          }
          const pool = find(arg.UserPoolId)
          if (!pool) throwing("ResourceNotFoundException")
          return {
            UserPool: {
              Id: pool.poolId,
              Name: pool.listedName,
              Arn: pool.arn,
              MfaConfiguration: pool.mfaConfiguration,
              EstimatedNumberOfUsers: (pool.users ?? []).length,
              Domain: pool.domain ?? undefined,
              DeletionProtection: "ACTIVE",
              CreationDate: new Date("2026-04-01T00:00:00.000Z"),
              LastModifiedDate: new Date("2026-08-01T00:00:00.000Z"),
              UserPoolTags: pool.tags ?? {},
              UsernameAttributes: ["email"],
              AutoVerifiedAttributes: ["email"],
              AdminCreateUserConfig: {
                AllowAdminCreateUserOnly: pool.adminCreateUserOnly ?? true,
              },
              AccountRecoverySetting: {
                RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }],
              },
              Policies: {
                PasswordPolicy: {
                  MinimumLength: 24,
                  RequireUppercase: false,
                  RequireLowercase: false,
                  RequireNumbers: false,
                  RequireSymbols: false,
                  ...(pool.temporaryPasswordValidityDays === null
                    ? {}
                    : { TemporaryPasswordValidityDays: pool.temporaryPasswordValidityDays ?? 7 }),
                },
              },
            },
          }
        }

        case "cognito-idp:GetUserPoolMfaConfig": {
          const outcome = options.mfaConfig ?? "populated"
          gate(outcome)
          const pool = find(arg.UserPoolId)
          if (!pool) throwing("ResourceNotFoundException")
          return {
            MfaConfiguration: pool.mfaConfiguration,
            SoftwareTokenMfaConfiguration: { Enabled: pool.softwareTokenEnabled ?? false },
          }
        }

        case "cognito-idp:ListUserPoolClients": {
          const outcome = options.listClients ?? "populated"
          gate(outcome)
          if (outcome === "empty") return {}
          const pool = find(arg.UserPoolId)
          if (!pool) throwing("ResourceNotFoundException")
          const ids = pool.clientIds ?? []
          if (ids.length === 0) return {}
          return {
            UserPoolClients: ids.map((ClientId) => ({ ClientId, ClientName: `${ClientId}-name` })),
          }
        }

        case "cognito-idp:DescribeUserPoolClient": {
          const outcome = options.describeClient ?? "populated"
          gate(outcome)
          return {
            UserPoolClient: {
              ClientId: String(arg.ClientId),
              ClientName: `${String(arg.ClientId)}-name`,
              // Present in the real response. The module reads it to answer a
              // boolean and must never carry it out.
              ClientSecret: CLIENT_SECRET,
              CallbackURLs: ["https://console.example.test/api/auth/callback"],
              LogoutURLs: ["https://console.example.test/signin"],
              AllowedOAuthFlows: ["code"],
              AllowedOAuthScopes: ["email", "openid", "profile"],
              SupportedIdentityProviders: ["COGNITO"],
              EnableTokenRevocation: true,
              PreventUserExistenceErrors: "ENABLED",
              AccessTokenValidity: 60,
              TokenValidityUnits: { AccessToken: "minutes" },
            },
          }
        }

        case "cognito-idp:DescribeUserPoolDomain": {
          const outcome = options.describeDomain ?? "populated"
          gate(outcome)
          return {
            DomainDescription: {
              Domain: String(arg.Domain),
              Status: "ACTIVE",
              Version: "20230101",
              CloudFrontDistribution: "d111111abcdef8.cloudfront.example.test",
            },
          }
        }

        case "cognito-idp:ListUsers": {
          const outcome = options.listUsers ?? "populated"
          gate(outcome)
          const pool = find(arg.UserPoolId)
          if (!pool) throwing("ResourceNotFoundException")
          const users = outcome === "empty" ? [] : (pool.users ?? [])
          // The real API omits `Users` entirely when the pool has none.
          if (users.length === 0) return {}
          return {
            Users: users.map((u) => ({
              Username: u.username,
              UserStatus: u.status,
              Enabled: u.enabled ?? true,
              UserCreateDate: new Date(u.created),
              UserLastModifiedDate: new Date(u.lastModified),
              ...(u.mfaOptions ? { MFAOptions: u.mfaOptions } : {}),
              Attributes: [
                ...(u.email ? [{ Name: "email", Value: u.email }] : []),
                ...(u.extraAttributes ?? []),
              ],
            })),
            ...(options.endlessUserPages ? { PaginationToken: "always-another-page" } : {}),
          }
        }

        default:
          throw new Error(
            `the stand-in was asked for ${String(capability)}, which this suite does not exercise`,
          )
      }
    },
    async resolvedRegion() {
      return identity === "denied" ? REGION : identity.region
    },
  }
}

async function load(options: FakeOptions = {}): Promise<CognitoReadings> {
  __resetIdentity()
  return cognitoReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: CognitoReadings): string {
  return cognitoLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

/** Every string anywhere in the returned object graph, for leak assertions. */
function everything(readings: CognitoReadings): string {
  return JSON.stringify(readings) + "\n" + surfaceText(readings)
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* ---------------------------------------------- the four outcomes, compared -- */

describe("the Cognito surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every pool", async () => {
    const readings = await load()
    expect(readings.pools.state).toBe("ACTUAL")
    if (readings.pools.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.pools.value.pools).toHaveLength(2)
    const text = surfaceText(readings)
    expect(text).toContain(CONSOLE_POOL)
    expect(text).toContain(DECOY_POOL)
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ listPools: "empty" })
    expect(readings.pools.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("Minimum statement")
    expect(text).not.toContain("refused")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listPools: "denied" })
    expect(readings.pools.state).toBe("DENIED")
    if (readings.pools.state !== "DENIED") throw new Error("narrowing")

    expect(readings.pools.action).toBe("cognito-idp:ListUserPools")
    expect(readings.pools.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.pools.accountId).toBe(ACCOUNT)
    expect(readings.pools.region).toBe(REGION)
    expect(readings.pools.partition).toBe("aws")
    expect(JSON.parse(readings.pools.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["cognito-idp:ListUserPools"],
      Resource: "*",
    })

    // The thing it must NOT be: there is no `value` on this arm at all, so a
    // caller cannot reach an empty inventory and print "no user pools".
    expect("value" in readings.pools).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ listPools: "throttled" })
    expect(readings.pools.state).toBe("THROTTLED")
    if (readings.pools.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.pools.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      texts.push(surfaceText(await load({ listPools: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that
    // notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })

  test("the roster tells its own four outcomes apart, per pool", async () => {
    const populated = await load()
    const empty = await load({ listUsers: "empty" })
    const denied = await load({ listUsers: "denied" })
    const throttled = await load({ listUsers: "throttled" })

    expect(rosterOf(populated).state).toBe("ACTUAL")
    expect(rosterOf(empty).state).toBe("EMPTY")
    expect(rosterOf(denied).state).toBe("DENIED")
    expect(rosterOf(throttled).state).toBe("THROTTLED")

    const denials = denied.findings.filter((f) => f.kind === "roster-unknown")
    expect(denials.length).toBeGreaterThan(0)
    expect(denials[0].text).toContain("cognito-idp:ListUsers")

    // The critical distinction: an empty roster is an ANSWER, not an unknown.
    expect(empty.findings.some((f) => f.kind === "roster-unknown")).toBe(false)

    const texts = [populated, empty, denied, throttled].map(surfaceText)
    expect(new Set(texts).size).toBe(4)
  })
})

function rosterOf(readings: CognitoReadings, poolId = CONSOLE_POOL) {
  if (readings.pools.state !== "ACTUAL") throw new Error("the pool listing did not answer")
  const pool = readings.pools.value.pools.find((p) => p.poolId === poolId)
  if (!pool) throw new Error(`${poolId} is not in the inventory`)
  return pool.operators
}

function poolOf(readings: CognitoReadings, poolId = CONSOLE_POOL) {
  if (readings.pools.state !== "ACTUAL") throw new Error("the pool listing did not answer")
  const pool = readings.pools.value.pools.find((p) => p.poolId === poolId)
  if (!pool) throw new Error(`${poolId} is not in the inventory`)
  return pool
}

/* ------------------------------------- the facts the 2026-08-13 audit needed -- */

describe("the facts that would have made the Cognito migration defect visible", () => {
  test("MFA left OPTIONAL is a critical finding, not a quiet field", async () => {
    const readings = await load()
    const pool = poolOf(readings)
    expect(pool.mfaPosture.kind).toBe("optional")

    const finding = readings.findings.find(
      (f) => f.kind === "mfa-not-enforced" && f.poolId === CONSOLE_POOL,
    )
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe("critical")
    expect(finding?.text).toContain("OPTIONAL")
    expect(surfaceText(readings)).toContain("MFA is OPTIONAL")

    // And the pool that IS enforced produces no such finding, so the finding is
    // about the pool rather than about the code path.
    expect(poolOf(readings, DECOY_POOL).mfaPosture.kind).toBe("enforced")
    expect(
      readings.findings.some((f) => f.kind === "mfa-not-enforced" && f.poolId === DECOY_POOL),
    ).toBe(false)
  })

  test("an account still in FORCE_CHANGE_PASSWORD past its window is reported as stranded", async () => {
    const readings = await load()
    const roster = rosterOf(readings)
    if (roster.state !== "ACTUAL") throw new Error("narrowing")

    const stranded = roster.value.operators.find((o) => o.signInIdentifier === "ops-b@example.test")
    expect(stranded?.status.code).toBe("FORCE_CHANGE_PASSWORD")
    expect(stranded?.firstSignInWindow.kind).toBe("expired")
    if (stranded?.firstSignInWindow.kind !== "expired") throw new Error("narrowing")
    // 2026-08-01 to 2026-08-13 is twelve days, against a seven-day window.
    expect(stranded.firstSignInWindow.ageDays).toBe(12)
    expect(stranded.firstSignInWindow.windowDays).toBe(7)

    expect(
      readings.findings.some(
        (f) =>
          f.kind === "temporary-password-window-expired" &&
          f.signInIdentifier === "ops-b@example.test",
      ),
    ).toBe(true)
  })

  test("an account inside its window is reported as a live credential, not as stranded", async () => {
    const readings = await load()
    const roster = rosterOf(readings)
    if (roster.state !== "ACTUAL") throw new Error("narrowing")

    const pending = roster.value.operators.find((o) => o.signInIdentifier === "ops-c@example.test")
    expect(pending?.firstSignInWindow.kind).toBe("open")
    if (pending?.firstSignInWindow.kind !== "open") throw new Error("narrowing")
    expect(pending.firstSignInWindow.ageDays).toBe(2)

    const finding = readings.findings.find(
      (f) =>
        f.kind === "operator-awaiting-first-password-change" &&
        f.signInIdentifier === "ops-c@example.test",
    )
    expect(finding?.severity).toBe("warning")
    // Two accounts in the same status, two different findings: the arithmetic
    // is real, not a status lookup.
    expect(
      readings.findings.some(
        (f) =>
          f.kind === "temporary-password-window-expired" &&
          f.signInIdentifier === "ops-c@example.test",
      ),
    ).toBe(false)
  })

  test("an account confirmed seconds after creation is reported as never forced to change", async () => {
    const readings = await load()
    const roster = rosterOf(readings)
    if (roster.state !== "ACTUAL") throw new Error("narrowing")

    const seeded = roster.value.operators.find((o) => o.signInIdentifier === "ops-a@example.test")
    expect(seeded?.neverForcedAPasswordChange).not.toBeNull()
    expect(seeded?.neverForcedAPasswordChange?.confirmedWithinMs).toBe(3000)
    // The claim travels with what would disprove it.
    expect(seeded?.neverForcedAPasswordChange?.caveat).toContain("inference from two timestamps")

    // And a normal account — CONFIRMED a month after creation — does not fire it.
    const normal = roster.value.operators.find((o) => o.signInIdentifier === "ops-d@example.test")
    expect(normal?.status.code).toBe("CONFIRMED")
    expect(normal?.neverForcedAPasswordChange).toBeNull()

    const finding = readings.findings.find(
      (f) =>
        f.kind === "operator-never-forced-a-password-change" &&
        f.signInIdentifier === "ops-a@example.test",
    )
    expect(finding?.severity).toBe("critical")
  })

  test("the temporary-password window is reported, and a pool that declares none says so", async () => {
    const declared = await load()
    const pool = poolOf(declared)
    if (pool.detail.state !== "ACTUAL") throw new Error("narrowing")
    expect(pool.detail.value.temporaryPasswordWindow).toEqual({ kind: "declared", days: 7 })

    const undeclared = await load({
      pools: [{ ...consolePoolFixture(), temporaryPasswordValidityDays: null }],
    })
    const other = poolOf(undeclared)
    if (other.detail.state !== "ACTUAL") throw new Error("narrowing")
    expect(other.detail.value.temporaryPasswordWindow.kind).toBe("default")
    expect(
      undeclared.findings.some((f) => f.kind === "temporary-password-window-unknown"),
    ).toBe(true)
    expect(surfaceText(undeclared)).toContain("by AWS default")
  })

  test("self-signup being open is a critical finding", async () => {
    const readings = await load({
      pools: [{ ...consolePoolFixture(), adminCreateUserOnly: false }],
    })
    const finding = readings.findings.find((f) => f.kind === "self-signup-open")
    expect(finding?.severity).toBe("critical")
    expect(surfaceText(readings)).toContain("SELF-SIGNUP IS OPEN")
  })
})

/* ------------------------------------------- honest about what it cannot read -- */

describe("the module is explicit about the three facts it cannot read", () => {
  test("last sign-in is a rendered NOT_READABLE, and last-modified is never printed as it", async () => {
    const readings = await load()
    const roster = rosterOf(readings)
    if (roster.state !== "ACTUAL") throw new Error("narrowing")

    for (const operator of roster.value.operators) {
      expect(operator.lastSignIn.state).toBe("NOT_READABLE")
    }
    const text = surfaceText(readings)
    expect(text).toContain("last sign-in:")
    expect(text).toContain("no authentication timestamp")
    // The reassuring default this exists to prevent.
    expect(text).not.toMatch(/last sign-in: 20\d\d-/)
  })

  test("software-token enrolment is unknown, and SMS-absent is not reported as no MFA", async () => {
    const readings = await load()
    const roster = rosterOf(readings)
    if (roster.state !== "ACTUAL") throw new Error("narrowing")

    const withSms = roster.value.operators.find((o) => o.signInIdentifier === "ops-d@example.test")
    expect(withSms?.mfa.smsConfigured).toBe(true)
    expect(withSms?.mfa.smsDeliveryMedia).toEqual(["SMS"])

    const withoutSms = roster.value.operators.find((o) => o.signInIdentifier === "ops-a@example.test")
    expect(withoutSms?.mfa.smsConfigured).toBe(false)
    expect(withoutSms?.mfa.softwareToken.state).toBe("NOT_READABLE")
    expect(withoutSms?.mfa.why).toContain("NOT the same as no second factor")
  })

  test("a status AWS returns that this engine does not model is kept raw, never folded into CONFIRMED", async () => {
    const readings = await load({
      pools: [
        {
          ...consolePoolFixture(),
          users: [
            {
              username: "ops-x",
              email: "ops-x@example.test",
              status: "SOME_FUTURE_STATUS",
              created: "2026-05-01T00:00:00.000Z",
              lastModified: "2026-05-01T00:00:03.000Z",
            },
          ],
        },
      ],
    })
    const roster = rosterOf(readings)
    if (roster.state !== "ACTUAL") throw new Error("narrowing")
    expect(roster.value.operators[0].status).toEqual({
      code: "UNRECOGNISED",
      raw: "SOME_FUTURE_STATUS",
    })
    // An unmodelled status must not reach the permanent-password suspicion,
    // which only asks about CONFIRMED.
    expect(roster.value.operators[0].neverForcedAPasswordChange).toBeNull()
    expect(surfaceText(readings)).toContain("not modelled by this engine")
  })
})

/* --------------------------------------------------- nothing secret escapes -- */

describe("no credential material leaves this module", () => {
  test("the client secret is read to answer a boolean and never appears in any output", async () => {
    const readings = await load()
    const pool = poolOf(readings)
    if (pool.clients.state !== "ACTUAL") throw new Error("narrowing")
    const client = pool.clients.value.clients[0]
    if (client.detail.state !== "ACTUAL") throw new Error("narrowing")

    // The fact IS reported — `generate_secret = true` is real configuration.
    expect(client.detail.value.hasSecret).toBe(true)
    // And the value is not, anywhere in the object graph or the rendered text.
    expect(everything(readings)).not.toContain(CLIENT_SECRET)
    expect(surfaceText(readings)).toContain("has a client secret")
  })

  test("no attribute value beyond the sign-in identifier is carried out", async () => {
    const readings = await load()
    const dump = everything(readings)
    // The roster fixture carries a phone number on ops-a. It must not survive.
    expect(dump).not.toContain("+15550000000")
    expect(dump).not.toContain("phone_number")
    // The identifier itself is carried, and its provenance with it.
    expect(dump).toContain("ops-a@example.test")
    const roster = rosterOf(readings)
    if (roster.state !== "ACTUAL") throw new Error("narrowing")
    expect(roster.value.operators[0].identifierProvenance).toBe("email attribute")
  })

  test("an account with no email attribute falls back to the username, and says so", async () => {
    const readings = await load({
      pools: [
        {
          ...consolePoolFixture(),
          users: [
            {
              username: "ops-no-email",
              status: "CONFIRMED",
              created: "2026-05-01T00:00:00.000Z",
              lastModified: "2026-06-01T00:00:00.000Z",
            },
          ],
        },
      ],
    })
    const roster = rosterOf(readings)
    if (roster.state !== "ACTUAL") throw new Error("narrowing")
    expect(roster.value.operators[0].signInIdentifier).toBe("ops-no-email")
    expect(roster.value.operators[0].identifierProvenance).toBe("username")
  })
})

/* ------------------------------------------- sub-calls degrade independently -- */

describe("one refused sub-call does not collapse the row, and does not render as a default", () => {
  test("a refused MFA read falls back to the pool description, and names the fallback", async () => {
    const readings = await load({ mfaConfig: "denied" })
    const pool = poolOf(readings)
    expect(pool.mfa.state).toBe("DENIED")
    // The FACT survives — the description carries MfaConfiguration too — and the
    // posture says which call answered.
    expect(pool.mfaPosture.kind).toBe("optional")
    if (pool.mfaPosture.kind !== "optional") throw new Error("narrowing")
    expect(pool.mfaPosture.provenance).toContain("cognito-idp:DescribeUserPool")
    expect(pool.mfaPosture.provenance).toContain("GetUserPoolMfaConfig")

    // And the rest of the row is untouched.
    expect(pool.operators.state).toBe("ACTUAL")
    expect(pool.clients.state).toBe("ACTUAL")
  })

  test("both MFA reads refused is UNKNOWN — never enforced, never a silent blank", async () => {
    const readings = await load({ mfaConfig: "denied", describePool: "denied" })
    const pool = poolOf(readings)
    expect(pool.mfaPosture.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("MFA configuration unknown")
    expect(text).not.toContain("MFA is enforced")
    expect(readings.findings.some((f) => f.kind === "mfa-unknown")).toBe(true)
    // The roster is a separate call and still answered.
    expect(pool.operators.state).toBe("ACTUAL")
  })

  test("a refused roster leaves the MFA finding standing", async () => {
    const readings = await load({ listUsers: "denied" })
    expect(readings.findings.some((f) => f.kind === "mfa-not-enforced")).toBe(true)
    expect(readings.findings.some((f) => f.kind === "roster-unknown")).toBe(true)
    expect(rosterOf(readings).state).toBe("DENIED")
    // No arm of a refused read carries a value, so a surface cannot print "0
    // operators" for a pool it was not allowed to look inside.
    expect("value" in rosterOf(readings)).toBe(false)
  })

  test("a pool with no hosted domain is UNCONFIGURED with a reason, not a failed read", async () => {
    const readings = await load()
    const decoy = poolOf(readings, DECOY_POOL)
    expect(decoy.domain.state).toBe("UNCONFIGURED")
    if (decoy.domain.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(decoy.domain.why).toContain("no hosted-UI domain")

    // And when the description itself was refused, the reason is different: the
    // engine did not know what to ask about.
    const blind = await load({ describePool: "denied-for-console" })
    const pool = poolOf(blind)
    expect(pool.domain.state).toBe("UNCONFIGURED")
    if (pool.domain.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(pool.domain.why).toContain("cognito-idp:DescribeUserPool")
  })

  test("a refused description does not make the pool vanish or read as unattributed", async () => {
    const readings = await load({ describePool: "denied-for-console" })
    if (readings.pools.state !== "ACTUAL") throw new Error("narrowing")
    // Still two pools. The refused one is present, saying it was refused.
    expect(readings.pools.value.pools).toHaveLength(2)
    const pool = poolOf(readings)
    expect(pool.detail.state).toBe("DENIED")
    // Attribution falls back to the estate tag index rather than claiming the
    // pool is untagged.
    expect(pool.attribution.kind).toBe("shared")
    if (pool.attribution.kind !== "shared") throw new Error("narrowing")
    expect(pool.attribution.provenance).toContain("tag:GetResources")
  })

  test("a refused tag index plus a refused description is attribution UNKNOWN, not unattributed", async () => {
    const readings = await load({ describePool: "denied-for-console", tagsOutcome: "denied" })
    const pool = poolOf(readings)
    expect(pool.attribution.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("attribution unknown")
    expect(surfaceText(readings)).not.toContain("unattributable — missing tenure:tenant")
  })
})

/* ------------------------------------------------ pagination has a bound and a signal -- */

describe("paging is bounded, and a bounded read says so", () => {
  test("a pool listing that never ends stops at the bound and reports TRUNCATED", async () => {
    const readings = await load({ endlessPoolPages: true })
    if (readings.pools.state !== "ACTUAL") throw new Error("narrowing")
    const completeness = readings.pools.value.completeness
    expect(completeness.kind).toBe("truncated")
    if (completeness.kind !== "truncated") throw new Error("narrowing")
    expect(completeness.pagesWalked).toBe(MAX_POOL_PAGES)
    expect(surfaceText(readings)).toContain("TRUNCATED")
  })

  test("a roster that never ends stops at the bound and says the rest were not checked", async () => {
    const readings = await load({ endlessUserPages: true })
    const roster = rosterOf(readings)
    if (roster.state !== "ACTUAL") throw new Error("narrowing")
    expect(roster.value.completeness.kind).toBe("truncated")
    if (roster.value.completeness.kind !== "truncated") throw new Error("narrowing")
    expect(roster.value.completeness.pagesWalked).toBe(MAX_OPERATOR_PAGES)
    expect(roster.value.completeness.why).toContain("have not been checked")
  })

  test("a listing that ends is reported complete, with the page count", async () => {
    const readings = await load()
    if (readings.pools.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.pools.value.completeness).toEqual({ kind: "complete", pagesWalked: 1 })
    expect(surfaceText(readings)).toContain("complete — 1 page(s) walked")
  })
})

/* ---------------------------------------- identification, residency, provenance -- */

describe("the pool guarding this console is identified by tag, and located from AWS's own answer", () => {
  test("identification picks the tagged pool, not the one whose NAME looks right", async () => {
    const readings = await load()
    expect(readings.consolePool.kind).toBe("identified")
    if (readings.consolePool.kind !== "identified") throw new Error("narrowing")
    expect(readings.consolePool.poolId).toBe(CONSOLE_POOL)
    expect(readings.consolePool.how).toContain(CONSOLE_POOL_TAG_KEY)
    // The decoy is literally named `tenure-prod-operators`. Nothing chose it.
    expect(poolOf(readings, DECOY_POOL).listedName).toBe("tenure-prod-operators")
  })

  test("two tagged pools is AMBIGUOUS — the engine will not pick one by name", async () => {
    const readings = await load({
      pools: [
        consolePoolFixture(),
        { ...decoyPoolFixture(), tags: studioTags() },
      ],
    })
    expect(readings.consolePool.kind).toBe("ambiguous")
    expect(surfaceText(readings)).toContain("ambiguous")
  })

  test("no tagged pool is NOT-TAGGED, and a refused listing is UNKNOWN — two different sentences", async () => {
    const untagged = await load({ pools: [{ ...consolePoolFixture(), tags: {} }] })
    expect(untagged.consolePool.kind).toBe("not-tagged")

    const refused = await load({ listPools: "denied" })
    expect(refused.consolePool.kind).toBe("unknown")

    expect(surfaceText(untagged)).not.toEqual(surfaceText(refused))
  })

  test("region and partition come from the pool's own ARN, not from the resolved region", async () => {
    // The identity resolves one region; the pool's ARN says another. AWS's
    // answer wins, which is what makes a residency anomaly visible at all.
    const readings = await load({
      pools: [{ ...consolePoolFixture(), arn: poolArn(CONSOLE_POOL, OTHER_REGION) }],
    })
    const pool = poolOf(readings)
    expect(pool.region).toBe(OTHER_REGION)
    expect(pool.partition).toBe("aws")
    expect(pool.accountId).toBe(ACCOUNT)
    expect(pool.locationProvenance).toContain("the pool's own ARN")
  })

  test("with no ARN the location comes from the resolved identity, and names that", async () => {
    const readings = await load({ describePool: "denied-for-console" })
    const pool = poolOf(readings)
    expect(pool.region).toBe(REGION)
    expect(pool.partition).toBe("aws")
    expect(pool.locationProvenance).toContain("the resolved identity")
  })

  test("with neither an ARN nor an identity the engine states no region at all", async () => {
    const readings = await load({ describePool: "denied-for-console", identity: "denied" })
    const pool = poolOf(readings)
    expect(pool.region).toBeNull()
    expect(pool.partition).toBeNull()
    expect(pool.locationProvenance).toContain("will not state a region")
    expect(surfaceText(readings)).toContain("region unknown")
  })

  test("every capability's own cadence is carried, from the registry", async () => {
    const readings = await load()
    // Distinct numbers, not one global TTL: the roster moves when somebody is
    // hired and the pool's configuration moves when Terraform runs.
    expect(readings.refreshMs.operators).toBeLessThan(readings.refreshMs.pools)
    expect(readings.refreshMs.mfa).toBe(readings.refreshMs.pools)
    expect(readings.asOf).toBe(NOW.toISOString())
    expect(surfaceText(readings)).toContain(NOW.toISOString())
  })
})
