import {
  ADMINISTERING_WILDCARDS,
  administeringPrincipals,
  administratorCount,
  administratorHeadline,
  allGuards,
  consolePool,
  GUARD_STATES,
  GUARD_TONE,
  GUARD_WORDS,
  guardFromAnalyzer,
  guardFromConsoleMfa,
  guardFromKeys,
  guardFromOperatorRoster,
  guardFromPasswordPolicy,
  guardFromSecrets,
  guardsFromIam,
  identityVerdict,
  isPass,
  keysNotRotating,
  mfaEnrolmentSentence,
  notPassing,
  operatorDoor,
  passing,
  rankKeys,
  rankWildcards,
  sortGuards,
  statusWord,
  unknownArm,
  wildcardKey,
  type GuardRow,
} from "./doors"
import type { AnalyzerReadings, ExternalAccessState } from "../../../lib/aws/analyzer"
import type {
  CognitoReadings,
  OperatorReading,
  PoolDetail,
  PoolReading,
} from "../../../lib/aws/cognito"
import type {
  IamAccessKey,
  IamPosture,
  IamPostureSurface,
  IamPrincipal,
  IamWildcard,
} from "../../../lib/aws/iam"
import type { KeyReading, KeyRotationPosture, KmsReadings } from "../../../lib/aws/keys"
import type { Identity } from "../../../lib/aws/identity"
import type { AwsRead } from "../../../lib/aws/read"
import type { SecretsReadings } from "../../../lib/aws/secrets"

/**
 * `/platform/identity`'s decision layer, driven with no browser, no server and
 * no AWS account.
 *
 * Every assertion below is one rule, stated another way:
 *
 *   **an absence of findings from a control that is not running is NOT a pass.**
 *
 * The arms that matter cannot be reached from a browser pointed at a healthy
 * estate. They need an account with no Access Analyzer, a Cognito pool with MFA
 * set to OPTIONAL, a roster read refused mid-walk, a KMS listing truncated at
 * its page bound, and an estate where every single guard answers — which no
 * account with an unwired control can ever be. A suite that only drove the
 * browser would leave the wording an operator sees on their worst morning
 * untested, and would leave the one arm this page must never reach by accident —
 * "Clear" — asserted by nothing.
 *
 * The 2026-08-13 audit has its own block below: a pool with MFA OPTIONAL and an
 * operator suspected of holding an administrator-set permanent password. Both
 * were true of this platform, and nothing in the console could see either. Both
 * are `FINDINGS` here, and the test that says so is the one that would have gone
 * red.
 */

/* ────────────────────────────────────────────────────────────── fixtures ── */

const ASOF = "2026-08-13T09:00:00.000Z"

/*
 * Account 123456789012 is AWS's own documentation account. Every ARN, key id,
 * pool id and secret name below is constructed from it and corresponds to no
 * real resource; nothing here is a reading of any account.
 */
const identityRead: AwsRead<Identity> = {
  state: "ACTUAL",
  capability: "sts:GetCallerIdentity",
  value: {
    accountId: "123456789012",
    arn: "arn:aws:sts::123456789012:assumed-role/studio-reader/session",
    partition: "aws",
    region: "eu-west-2",
  },
  asOf: ASOF,
  fresh: true,
}

const denied = <T,>(capability: Parameters<typeof unknownArm>[0]["capability"], action: string): AwsRead<T> => ({
  state: "DENIED",
  capability,
  action,
  principal: "arn:aws:sts::123456789012:assumed-role/studio-reader/session",
  accountId: "123456789012",
  region: "eu-west-2",
  partition: "aws",
  errorCode: "AccessDeniedException",
  minimumStatement: `{"Effect":"Allow","Action":"${action}","Resource":"*"}`,
})

const empty = <T,>(capability: Parameters<typeof unknownArm>[0]["capability"]): AwsRead<T> => ({
  state: "EMPTY",
  capability,
  asOf: ASOF,
})

const operator = (over: Partial<OperatorReading> = {}): OperatorReading => ({
  signInIdentifier: "operator@example.com",
  identifierProvenance: "email attribute",
  status: { code: "CONFIRMED" },
  enabled: true,
  mfa: {
    smsConfigured: false,
    smsDeliveryMedia: [],
    softwareToken: {
      state: "NOT_READABLE",
      needs: "cognito-idp:AdminGetUser",
      why: "software-token enrolment is not returned by the roster read.",
    },
    why: "only the SMS half of this account's MFA is readable from the roster.",
  },
  lastSignIn: {
    state: "NOT_READABLE",
    needs: "cognito-idp:AdminListUserAuthEvents",
    why: "Cognito's roster read returns no authentication timestamp.",
    notThis: "last-modified is NOT last sign-in.",
  },
  createdAt: "2026-08-01T09:00:00.000Z",
  lastModifiedAt: "2026-08-01T09:00:00.000Z",
  firstSignInWindow: { kind: "not-pending", why: "the account is CONFIRMED." },
  neverForcedAPasswordChange: null,
  ...over,
})

const poolDetail = (over: Partial<PoolDetail> = {}): PoolDetail => ({
  poolId: "eu-west-2_Console01",
  name: "studio-operators",
  arn: "arn:aws:cognito-idp:eu-west-2:123456789012:userpool/eu-west-2_Console01",
  mfaConfigurationRaw: "ON",
  passwordPolicy: {
    minimumLength: 14,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: true,
    temporaryPasswordValidityDays: 1,
  },
  temporaryPasswordWindow: { kind: "declared", days: 1 },
  adminCreateUserOnly: true,
  accountRecoveryMechanisms: ["verified_email"],
  usernameAttributes: ["email"],
  autoVerifiedAttributes: ["email"],
  hostedDomain: null,
  customDomain: null,
  deletionProtection: "ACTIVE",
  estimatedUsers: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastModifiedAt: "2026-08-01T09:00:00.000Z",
  tags: { "tenure:module": "system-studio" },
  ...over,
})

const pool = (over: Partial<PoolReading> = {}): PoolReading => ({
  poolId: "eu-west-2_Console01",
  listedName: "studio-operators",
  arn: "arn:aws:cognito-idp:eu-west-2:123456789012:userpool/eu-west-2_Console01",
  arnProvenance: "AWS returned the ARN on DescribeUserPool",
  region: "eu-west-2",
  partition: "aws",
  accountId: "123456789012",
  locationProvenance: "from the pool's own ARN",
  attribution: { kind: "shared", provenance: "tenure:tenant = shared" },
  detail: {
    state: "ACTUAL",
    capability: "cognito-idp:DescribeUserPool",
    value: poolDetail(),
    asOf: ASOF,
    fresh: true,
  },
  mfa: {
    state: "ACTUAL",
    capability: "cognito-idp:GetUserPoolMfaConfig",
    value: {
      mfaConfigurationRaw: "ON",
      softwareTokenEnabled: true,
      smsConfigured: false,
      emailConfigured: false,
    },
    asOf: ASOF,
    fresh: true,
  },
  mfaPosture: {
    kind: "enforced",
    factors: ["software token"],
    provenance: "cognito-idp:GetUserPoolMfaConfig",
  },
  clients: empty("cognito-idp:ListUserPoolClients"),
  domain: empty("cognito-idp:DescribeUserPoolDomain"),
  operators: {
    state: "ACTUAL",
    capability: "cognito-idp:ListUsers",
    value: { operators: [operator()], completeness: { kind: "complete", pagesWalked: 1 } },
    asOf: ASOF,
    fresh: true,
  },
  guardsThisConsole: true,
  asOf: ASOF,
  ...over,
})

const cognito = (over: Partial<CognitoReadings> = {}): CognitoReadings => {
  const pools = over.pools ?? {
    state: "ACTUAL",
    capability: "cognito-idp:ListUserPools",
    value: {
      pools: [pool()],
      completeness: { kind: "complete", pagesWalked: 1 },
      scope: "the pools in eu-west-2",
    },
    asOf: ASOF,
    fresh: true,
  }
  return {
    identity: identityRead,
    tagged: empty("tag:GetResources"),
    pools,
    consolePool: {
      kind: "identified",
      poolId: "eu-west-2_Console01",
      how: "it carries tenure:module = system-studio",
    },
    findings: [],
    asOf: ASOF,
    refreshMs: {
      pools: 60_000,
      detail: 60_000,
      mfa: 60_000,
      clients: 60_000,
      clientDetail: 60_000,
      domain: 60_000,
      operators: 60_000,
    },
    ...over,
  }
}

/** A cognito reading whose single pool is `over`-patched. The common case below. */
const cognitoWithPool = (over: Partial<PoolReading>): CognitoReadings =>
  cognito({
    pools: {
      state: "ACTUAL",
      capability: "cognito-idp:ListUserPools",
      value: {
        pools: [pool(over)],
        completeness: { kind: "complete", pagesWalked: 1 },
        scope: "the pools in eu-west-2",
      },
      asOf: ASOF,
      fresh: true,
    },
  })

const principal = (over: Partial<IamPrincipal> = {}): IamPrincipal => ({
  kind: "role",
  name: "deploy",
  arn: "arn:aws:iam::123456789012:role/deploy",
  path: "/",
  createdAt: "2026-01-01T00:00:00.000Z",
  tags: {},
  attribution: { kind: "shared" },
  attributionSource: "iam-resource-tags",
  attributionDetail: "tenure:tenant = shared",
  management: { kind: "terraform", isConsoleOrUnmanaged: false, detail: "tenure:managed-by = terraform" },
  tagProblems: [],
  attachedPolicies: [],
  inlinePolicyNames: [],
  hasPermissionsBoundary: false,
  wildcards: [],
  lastUsedAt: null,
  accessKeys: null,
  ...over,
})

const wildcard = (over: Partial<IamWildcard> = {}): IamWildcard => ({
  principalArn: "arn:aws:iam::123456789012:role/deploy",
  principalName: "deploy",
  policyName: "deploy-inline",
  policyArn: null,
  source: "inline",
  statementIndex: 0,
  statementSid: null,
  kind: "ADMIN",
  actionScope: "all-actions",
  resourceScope: "all-resources",
  actions: ["*"],
  resources: ["*"],
  conditioned: false,
  detail: "every action on every resource",
  ...over,
})

const accessKey = (over: Partial<IamAccessKey> = {}): IamAccessKey => ({
  userName: "ci",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  status: "Active",
  createdAt: "2026-01-01T00:00:00.000Z",
  ageDays: 220,
  longLived: true,
  detail: "active and 220 days old",
  ...over,
})

const posture = (over: Partial<IamPosture> = {}): IamPosture => ({
  roles: [principal()],
  users: [],
  wildcards: [],
  longLivedKeys: [],
  accessKeys: [],
  unmanaged: [],
  unswept: [],
  unreadableDocuments: [],
  keyCoverage: {
    usersAsked: 0,
    usersAnswered: 0,
    usersDenied: 0,
    usersThrottled: 0,
    usersErrored: 0,
    complete: true,
    detail: "every user answered",
  },
  sweepCoverage: {
    policiesSwept: 4,
    policiesUnreadable: 0,
    policiesUnswept: 0,
    complete: true,
    detail: "every attached policy document was returned and parsed",
  },
  ...over,
})

const iam = (over: Partial<IamPostureSurface> = {}): IamPostureSurface => {
  const value = over.posture === undefined ? posture() : over.posture
  return {
    identity: identityRead,
    scope: {
      accountId: "123456789012",
      partition: "aws",
      region: "eu-west-2",
      arnPrefix: "arn:aws:iam::123456789012:",
      global: true,
      detail: "account 123456789012, partition aws",
    },
    read:
      value === null
        ? denied<IamPosture>("iam:GetAccountAuthorizationDetails", "iam:GetAccountAuthorizationDetails")
        : {
            state: "ACTUAL",
            capability: "iam:GetAccountAuthorizationDetails",
            value,
            asOf: ASOF,
            fresh: true,
          },
    posture: value,
    tagIndexRead: empty("tag:GetResources"),
    headline: "1 role(s) and 0 user(s) in account 123456789012",
    asOf: ASOF,
    refreshMs: 300_000,
    ...over,
  }
}

const analyzer = (externalAccess: ExternalAccessState): AnalyzerReadings => ({
  identity: identityRead,
  tagged: empty("tag:GetResources"),
  analyzers:
    externalAccess.kind === "no-analyzer"
      ? empty("access-analyzer:ListAnalyzers")
      : {
          state: "ACTUAL",
          capability: "access-analyzer:ListAnalyzers",
          value: { analyzers: [], truncated: false, pagesRead: 1, truncationNote: null },
          asOf: ASOF,
          fresh: true,
        },
  externalAccess,
  asOf: ASOF,
  refreshMs: { analyzers: 300_000, findings: 300_000 },
})

const kmsPosture = (over: Partial<KeyRotationPosture> = {}): KeyRotationPosture => ({
  customerManagedRead: 2,
  rotating: 2,
  notRotating: [],
  notApplicable: [],
  rotationUnknown: [],
  awsManagedExcluded: 1,
  unrecognisedManagement: [],
  pendingDeletion: [],
  unreadable: [],
  complete: true,
  ...over,
})

const keyReading = (over: Partial<KeyReading> = {}): KeyReading => ({
  keyId: "1234abcd-12ab-34cd-56ef-1234567890ab",
  arn: "arn:aws:kms:eu-west-2:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab",
  arnProvenance: "AWS returned the ARN on ListKeys",
  region: "eu-west-2",
  partition: "aws",
  accountId: "123456789012",
  attribution: { kind: "shared" },
  detail: empty("kms:DescribeKey"),
  rotation: { kind: "disabled", why: "automatic rotation is off on this customer-managed key" },
  lifecycle: { kind: "active" },
  aliases: {
    state: "NOT_READABLE",
    needs: "kms:ListAliases",
    iamAction: "kms:ListAliases",
    why: "kms:ListAliases is not in this engine's capability registry.",
  },
  refreshMs: 300_000,
  asOf: ASOF,
  ...over,
})

const kms = (over: Partial<KmsReadings> = {}): KmsReadings => ({
  identity: identityRead,
  tagged: empty("tag:GetResources"),
  keys: {
    state: "ACTUAL",
    capability: "kms:ListKeys",
    value: [keyReading({ rotation: { kind: "enabled", periodDays: 365, nextRotationAt: null } })],
    asOf: ASOF,
    fresh: true,
  },
  truncation: { kind: "complete", keysRead: 1 },
  posture: kmsPosture(),
  asOf: ASOF,
  refreshMs: { keys: 300_000, detail: 300_000, rotation: 300_000 },
  ...over,
})

const secrets = (over: Partial<SecretsReadings> = {}): SecretsReadings => ({
  identity: identityRead,
  tagged: empty("tag:GetResources"),
  secrets: empty("secretsmanager:ListSecrets"),
  pagination: { kind: "no-secrets", why: "the listing answered and there are no secrets" },
  posture: {
    kind: "assessed",
    noRotation: [],
    overdue: [],
    pendingDeletion: [],
    undetermined: [],
    secretsAssessed: 0,
    pagination: { kind: "complete", pages: 1, secrets: 0 },
  },
  asOf: ASOF,
  refreshMs: { inventory: 300_000, detail: 300_000 },
  ...over,
})

/** The healthy estate every "not a pass" test below perturbs by exactly one fact. */
const healthy = () => ({
  cognito: cognito(),
  iam: iam(),
  analyzer: analyzer({
    kind: "none-found",
    analyzersRead: ["account-analyzer"],
    unreadable: [],
    truncated: false,
  }),
  keys: kms(),
  secrets: secrets(),
})

/* ──────────────────────────────────────────────────── the governing rule ── */

describe("only a control that ran over everything is a pass", () => {
  test("isPass admits CHECKED_CLEAN and nothing else", () => {
    for (const state of GUARD_STATES) {
      expect(isPass(state)).toBe(state === "CHECKED_CLEAN")
    }
  })

  test("every guard state has its own word and NOT_RUNNING is not a reassuring tone", () => {
    const words = GUARD_STATES.map((state) => GUARD_WORDS[state])
    expect(new Set(words).size).toBe(GUARD_STATES.length)
    // The two that produce an identical empty findings list must not look alike.
    expect(GUARD_WORDS.NOT_RUNNING).not.toBe(GUARD_WORDS.CHECKED_CLEAN)
    expect(GUARD_TONE.NOT_RUNNING).not.toBe(GUARD_TONE.CHECKED_CLEAN)
    expect(GUARD_TONE.CHECKED_CLEAN).toBe("ok")
    // Exactly one state may carry the reassuring tone.
    expect(GUARD_STATES.filter((state) => GUARD_TONE[state] === "ok")).toEqual(["CHECKED_CLEAN"])
  })

  test("an account with NO Access Analyzer is NOT_RUNNING, never CHECKED_CLEAN", () => {
    const guard = guardFromAnalyzer(
      analyzer({
        kind: "no-analyzer",
        why: "this account has no analyzer.",
        remedy: "Create an account or organization analyzer.",
      }),
    )
    expect(guard.state).toBe("NOT_RUNNING")
    expect(isPass(guard.state)).toBe(false)
    // And it carries no count: a zero here is the number this page exists to
    // stop printing.
    expect(guard.findings).toBeNull()
    expect(guard.remedy).toContain("analyzer")
  })

  test("analyzers that exist but ask a different question are NOT_RUNNING too", () => {
    const guard = guardFromAnalyzer(
      analyzer({
        kind: "not-answering",
        analyzersSeen: 1,
        why: "1 analyzer(s) exist and not one answers the external-access question.",
        remedy: "Create an account or organization analyzer.",
      }),
    )
    expect(guard.state).toBe("NOT_RUNNING")
    expect(guard.findings).toBeNull()
  })

  test("an analyzer that answered in part is PARTIAL, not clean", () => {
    const guard = guardFromAnalyzer(
      analyzer({
        kind: "none-found",
        analyzersRead: ["a"],
        unreadable: ["b"],
        truncated: false,
      }),
    )
    expect(guard.state).toBe("PARTIAL")
    expect(isPass(guard.state)).toBe(false)
  })

  test("an analyzer that answered in full and found nothing is the one pass", () => {
    const guard = guardFromAnalyzer(
      analyzer({ kind: "none-found", analyzersRead: ["a"], unreadable: [], truncated: false }),
    )
    expect(guard.state).toBe("CHECKED_CLEAN")
    expect(guard.findings).toBe(0)
  })
})

/* ───────────────────────────────────────────── the 2026-08-13 audit ─────── */

describe("the panel that would have shown the 2026-08-13 audit", () => {
  test("MFA OPTIONAL on the console's pool is a FINDING, not a footnote", () => {
    const guard = guardFromConsoleMfa(
      cognitoWithPool({
        mfaPosture: {
          kind: "optional",
          factors: ["software token"],
          provenance: "cognito-idp:GetUserPoolMfaConfig",
          why: "a second factor nobody enrolled is the same protection as none",
        },
      }),
    )
    expect(guard.state).toBe("FINDINGS")
    expect(guard.findings).toBe(1)
    expect(guard.detail).toContain("OPTIONAL")
    expect(guard.remedy).toContain("ON")
  })

  test("MFA OFF is a finding and MFA enforced is the only clean arm", () => {
    expect(
      guardFromConsoleMfa(
        cognitoWithPool({
          mfaPosture: { kind: "off", provenance: "DescribeUserPool", why: "MfaConfiguration is OFF" },
        }),
      ).state,
    ).toBe("FINDINGS")
    expect(guardFromConsoleMfa(cognito()).state).toBe("CHECKED_CLEAN")
  })

  test("an MFA configuration this engine cannot read is UNREADABLE, never enforced", () => {
    for (const posture of [
      { kind: "unknown" as const, why: "GetUserPoolMfaConfig was refused" },
      { kind: "unrecognised" as const, raw: "SOMETHING_NEW", provenance: "DescribeUserPool" },
    ]) {
      const guard = guardFromConsoleMfa(cognitoWithPool({ mfaPosture: posture }))
      expect(guard.state).toBe("UNREADABLE")
      expect(guard.findings).toBeNull()
    }
  })

  test("an account suspected of holding an administrator-set password is a FINDING, with its caveat", () => {
    const suspected = operator({
      signInIdentifier: "migrated@example.com",
      status: { code: "CONFIRMED" },
      neverForcedAPasswordChange: {
        suspected: true,
        createdAt: "2026-08-13T08:00:00.000Z",
        confirmedWithinMs: 4_000,
        windowMs: 900_000,
        why: "the account was confirmed 4s after it was created",
        caveat: "This is an inference from two timestamps, not a read of the create call.",
      },
    })
    const guard = guardFromOperatorRoster(
      cognitoWithPool({
        operators: {
          state: "ACTUAL",
          capability: "cognito-idp:ListUsers",
          value: {
            operators: [operator(), suspected],
            completeness: { kind: "complete", pagesWalked: 1 },
          },
          asOf: ASOF,
          fresh: true,
        },
      }),
    )
    expect(guard.state).toBe("FINDINGS")
    expect(guard.findings).toBe(1)
    expect(guard.detail).toContain("permanently")
  })

  test("an open temporary-password window and an expired one are both findings", () => {
    const rosterOf = (...operators: OperatorReading[]) =>
      guardFromOperatorRoster(
        cognitoWithPool({
          operators: {
            state: "ACTUAL",
            capability: "cognito-idp:ListUsers",
            value: { operators, completeness: { kind: "complete", pagesWalked: 1 } },
            asOf: ASOF,
            fresh: true,
          },
        }),
      )
    expect(
      rosterOf(
        operator({
          status: { code: "FORCE_CHANGE_PASSWORD" },
          firstSignInWindow: {
            kind: "open",
            ageDays: 2,
            windowDays: 7,
            since: "2026-08-11T09:00:00.000Z",
            sinceMeans: "the account was created",
          },
        }),
      ).state,
    ).toBe("FINDINGS")
    expect(
      rosterOf(
        operator({
          status: { code: "FORCE_CHANGE_PASSWORD" },
          firstSignInWindow: {
            kind: "expired",
            ageDays: 40,
            windowDays: 7,
            since: "2026-07-04T09:00:00.000Z",
            sinceMeans: "the account was created",
            why: "the account can no longer complete its first sign-in",
          },
        }),
      ).state,
    ).toBe("FINDINGS")
  })

  test("a truncated roster is PARTIAL — a clean page one is not a clean pool", () => {
    const guard = guardFromOperatorRoster(
      cognitoWithPool({
        operators: {
          state: "ACTUAL",
          capability: "cognito-idp:ListUsers",
          value: {
            operators: [operator()],
            completeness: {
              kind: "truncated",
              pagesWalked: 20,
              seen: 1200,
              why: "the walk stopped at this engine's page bound",
            },
          },
          asOf: ASOF,
          fresh: true,
        },
      }),
    )
    expect(guard.state).toBe("PARTIAL")
    expect(isPass(guard.state)).toBe(false)
  })

  test("a refused roster is UNREADABLE and is never a report that nobody can sign in", () => {
    const guard = guardFromOperatorRoster(
      cognitoWithPool({ operators: denied("cognito-idp:ListUsers", "cognito-idp:ListUsers") }),
    )
    expect(guard.state).toBe("UNREADABLE")
    expect(guard.findings).toBeNull()
    expect(guard.remedy).toContain("cognito-idp:ListUsers")
  })

  test("self sign-up left open on the operator pool is a finding", () => {
    const guard = guardFromPasswordPolicy(
      cognitoWithPool({
        detail: {
          state: "ACTUAL",
          capability: "cognito-idp:DescribeUserPool",
          value: poolDetail({ adminCreateUserOnly: false }),
          asOf: ASOF,
          fresh: true,
        },
      }),
    )
    expect(guard.state).toBe("FINDINGS")
    expect(guard.detail).toContain("allow_admin_create_user_only")
  })

  test("a temporary-password window nobody declared is PARTIAL, not clean", () => {
    const guard = guardFromPasswordPolicy(
      cognitoWithPool({
        detail: {
          state: "ACTUAL",
          capability: "cognito-idp:DescribeUserPool",
          value: poolDetail({
            temporaryPasswordWindow: {
              kind: "default",
              days: 7,
              why: "the pool declares no TemporaryPasswordValidityDays",
            },
          }),
          asOf: ASOF,
          fresh: true,
        },
      }),
    )
    expect(guard.state).toBe("PARTIAL")
  })

  test("an unidentified console pool makes every front-door guard UNREADABLE", () => {
    const unidentified = cognito({
      consolePool: { kind: "not-tagged", poolsRead: 3, why: "no pool carries the tag" },
    })
    expect(consolePool(unidentified)).toBeNull()
    for (const guard of [
      guardFromConsoleMfa(unidentified),
      guardFromOperatorRoster(unidentified),
      guardFromPasswordPolicy(unidentified),
    ]) {
      expect(guard.state).toBe("UNREADABLE")
      expect(guard.findings).toBeNull()
    }
  })

  test("no operator row carries anything but the sign-in identifier", () => {
    const row = operator({ signInIdentifier: "a@example.com" })
    // The reader's own type is the guarantee; this asserts the shape the page
    // renders from has no second attribute to print.
    expect(Object.keys(row).sort()).toEqual(
      [
        "createdAt",
        "enabled",
        "firstSignInWindow",
        "identifierProvenance",
        "lastModifiedAt",
        "lastSignIn",
        "mfa",
        "neverForcedAPasswordChange",
        "signInIdentifier",
        "status",
      ].sort(),
    )
    // And the MFA sentence always says the half it cannot read.
    expect(mfaEnrolmentSentence(row)).toContain("software-token")
  })
})

/* ─────────────────────────────────────────────── who can get in, counted ── */

describe("the count of principals who can administer this platform", () => {
  test("both halves complete gives a total, not a floor", () => {
    const count = administratorCount(
      cognito(),
      iam({ posture: posture({ wildcards: [wildcard()], roles: [principal()] }) }),
    )
    expect(count.kind).toBe("counted")
    if (count.kind !== "counted") throw new Error("unreachable")
    expect(count.consoleOperators).toBe(1)
    expect(count.accountAdministrators).toBe(1)
    expect(count.total).toBe(2)
    expect(administratorHeadline(count)).toContain("2 principal(s)")
  })

  test("an incomplete policy sweep makes the number a FLOOR and says why", () => {
    const count = administratorCount(
      cognito(),
      iam({
        posture: posture({
          sweepCoverage: {
            policiesSwept: 2,
            policiesUnreadable: 0,
            policiesUnswept: 1,
            complete: false,
            detail: "1 attached policy document was never returned.",
          },
        }),
      }),
    )
    expect(count.kind).toBe("floor")
    if (count.kind !== "floor") throw new Error("unreachable")
    expect(count.qualifiers.join(" ")).toContain("AdministratorAccess")
    expect(administratorHeadline(count)).toContain("At least")
  })

  test("a truncated roster makes the number a FLOOR", () => {
    const count = administratorCount(
      cognitoWithPool({
        operators: {
          state: "ACTUAL",
          capability: "cognito-idp:ListUsers",
          value: {
            operators: [operator()],
            completeness: { kind: "truncated", pagesWalked: 20, seen: 1200, why: "page bound" },
          },
          asOf: ASOF,
          fresh: true,
        },
      }),
      iam(),
    )
    expect(count.kind).toBe("floor")
  })

  test("neither door answering is UNKNOWN, and never zero", () => {
    const count = administratorCount(
      cognito({
        pools: denied("cognito-idp:ListUserPools", "cognito-idp:ListUserPools"),
        consolePool: { kind: "unknown", why: "the user-pool listing was refused" },
      }),
      iam({ posture: null }),
    )
    expect(count.kind).toBe("unknown")
    const headline = administratorHeadline(count)
    expect(headline).toContain("UNKNOWN")
    expect(headline).toContain("not a report that nobody can")
    expect(headline).not.toMatch(/\b0 principal/)
  })

  test("a disabled or archived account is not a way in; an unread flag is uncertain", () => {
    expect(operatorDoor(operator({ enabled: false })).kind).toBe("closed")
    expect(operatorDoor(operator({ status: { code: "ARCHIVED" } })).kind).toBe("closed")
    expect(operatorDoor(operator({ enabled: null })).kind).toBe("uncertain")
    expect(
      operatorDoor(operator({ status: { code: "ABSENT", why: "no status returned" } })).kind,
    ).toBe("uncertain")
    // The 2026-08-13 case: an account still holding a seeded password IS a way in.
    expect(operatorDoor(operator({ status: { code: "FORCE_CHANGE_PASSWORD" } })).kind).toBe("open")
  })

  test("an uncertain account makes the count a floor rather than dropping out of it", () => {
    const count = administratorCount(
      cognitoWithPool({
        operators: {
          state: "ACTUAL",
          capability: "cognito-idp:ListUsers",
          value: {
            operators: [operator(), operator({ signInIdentifier: "b@example.com", enabled: null })],
            completeness: { kind: "complete", pagesWalked: 1 },
          },
          asOf: ASOF,
          fresh: true,
        },
      }),
      iam(),
    )
    expect(count.kind).toBe("floor")
    if (count.kind !== "floor") throw new Error("unreachable")
    expect(count.consoleOperators).toBe(1)
    expect(count.qualifiers.join(" ")).toContain("could not be classified")
  })

  test("only ADMIN and ALL_ACTIONS count as administering", () => {
    expect([...ADMINISTERING_WILDCARDS].sort()).toEqual(["ADMIN", "ALL_ACTIONS"])
    const withNarrow = posture({
      roles: [principal(), principal({ name: "reader", arn: "arn:aws:iam::123456789012:role/reader" })],
      wildcards: [
        wildcard(),
        wildcard({
          principalArn: "arn:aws:iam::123456789012:role/reader",
          kind: "ALL_RESOURCES",
          actions: ["s3:GetObject"],
          resources: ["*"],
        }),
      ],
    })
    expect(administeringPrincipals(withNarrow).map((p) => p.name)).toEqual(["deploy"])
  })
})

/* ────────────────────────────────────────────────── the account's guards ── */

describe("IAM, KMS and Secrets guards", () => {
  test("a refused IAM read makes BOTH IAM guards UNREADABLE with no count", () => {
    const rows = guardsFromIam(iam({ posture: null }))
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.state).toBe("UNREADABLE")
      expect(row.findings).toBeNull()
    }
  })

  test("an incomplete sweep with no wildcard found is PARTIAL, and names AdministratorAccess", () => {
    const rows = guardsFromIam(
      iam({
        posture: posture({
          unswept: [
            {
              principalArn: "arn:aws:iam::123456789012:role/deploy",
              principalName: "deploy",
              policyName: "AdministratorAccess",
              policyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
              why: "AWS-managed policy documents are not in this read",
            },
          ],
          sweepCoverage: {
            policiesSwept: 3,
            policiesUnreadable: 0,
            policiesUnswept: 1,
            complete: false,
            detail: "1 attached policy document was never returned.",
          },
        }),
      }),
    )
    const wildcards = rows.find((row) => row.key === "iam-wildcards") as GuardRow
    expect(wildcards.state).toBe("PARTIAL")
    expect(wildcards.remedy).toContain("AdministratorAccess")
  })

  test("an incomplete access-key sweep with no long-lived key is PARTIAL", () => {
    const rows = guardsFromIam(
      iam({
        posture: posture({
          keyCoverage: {
            usersAsked: 20,
            usersAnswered: 19,
            usersDenied: 1,
            usersThrottled: 0,
            usersErrored: 0,
            complete: false,
            detail: "1 of 20 users refused iam:ListAccessKeys.",
          },
        }),
      }),
    )
    expect((rows.find((row) => row.key === "iam-access-keys") as GuardRow).state).toBe("PARTIAL")
  })

  test("a refused KMS listing is UNREADABLE, and an incomplete posture is PARTIAL", () => {
    expect(guardFromKeys(kms({ keys: denied("kms:ListKeys", "kms:ListKeys") })).state).toBe(
      "UNREADABLE",
    )
    expect(
      guardFromKeys(
        kms({ posture: kmsPosture({ complete: false, rotationUnknown: ["k1"] }) }),
      ).state,
    ).toBe("PARTIAL")
    expect(
      guardFromKeys(kms({ posture: kmsPosture({ notRotating: ["k1", "k2"] }) })).findings,
    ).toBe(2)
  })

  test("keysNotRotating joins posture ids back to readings and returns [] off a valueless arm", () => {
    const flagged = keyReading({ keyId: "k1", rotation: { kind: "disabled", why: "off" } })
    const readings = kms({
      keys: {
        state: "ACTUAL",
        capability: "kms:ListKeys",
        value: [flagged, keyReading({ keyId: "k2" })],
        asOf: ASOF,
        fresh: true,
      },
      posture: kmsPosture({ notRotating: ["k1"] }),
    })
    expect(keysNotRotating(readings).map((key) => key.keyId)).toEqual(["k1"])
    expect(
      keysNotRotating(
        kms({ keys: denied("kms:ListKeys", "kms:ListKeys"), posture: kmsPosture({ notRotating: ["k1"] }) }),
      ),
    ).toEqual([])
  })

  test("an unknown secrets posture is UNREADABLE, never a clean estate", () => {
    const guard = guardFromSecrets(
      secrets({ posture: { kind: "unknown", why: "secretsmanager:ListSecrets was refused" } }),
    )
    expect(guard.state).toBe("UNREADABLE")
    expect(guard.findings).toBeNull()
  })

  test("secrets whose posture could not be decided make the guard PARTIAL", () => {
    const guard = guardFromSecrets(
      secrets({
        posture: {
          kind: "assessed",
          noRotation: [],
          overdue: [],
          pendingDeletion: [],
          undetermined: ["tenure/db/password"],
          secretsAssessed: 4,
          pagination: { kind: "complete", pages: 1, secrets: 4 },
        },
      }),
    )
    expect(guard.state).toBe("PARTIAL")
  })
})

/* ─────────────────────────────────────────────────────────── the verdict ── */

describe("the page's verdict", () => {
  test("a wholly healthy estate is the only route to Clear", () => {
    const input = healthy()
    const guards = allGuards(input)
    expect(guards.every((guard) => guard.state === "CHECKED_CLEAN")).toBe(true)
    const verdict = identityVerdict({
      admins: administratorCount(input.cognito, input.iam),
      guards,
    })
    expect(verdict.verdict).toBe("Clear")
    expect(verdict.tone).toBe("ok")
  })

  test("ONE guard that is not running takes Clear off the page", () => {
    const input = {
      ...healthy(),
      analyzer: analyzer({
        kind: "no-analyzer",
        why: "this account has no analyzer.",
        remedy: "Create an account or organization analyzer.",
      }),
    }
    const guards = allGuards(input)
    const verdict = identityVerdict({
      admins: administratorCount(input.cognito, input.iam),
      guards,
    })
    expect(verdict.verdict).toBe("Not fully checked")
    expect(verdict.verdict).not.toBe("Clear")
    expect(verdict.because).toContain("not a pass")
    expect(notPassing(guards).map((guard) => guard.key)).toEqual(["external-access"])
  })

  test("a finding outranks a gap and reaches At risk", () => {
    const input = {
      ...healthy(),
      cognito: cognitoWithPool({
        mfaPosture: {
          kind: "optional",
          factors: [],
          provenance: "cognito-idp:GetUserPoolMfaConfig",
          why: "a second factor nobody enrolled is the same protection as none",
        },
      }),
    }
    const guards = allGuards(input)
    const verdict = identityVerdict({
      admins: administratorCount(input.cognito, input.iam),
      guards,
    })
    expect(verdict.verdict).toBe("At risk")
    expect(verdict.tone).toBe("bad")
  })

  test("a clean guard list over an uncountable population is Unknown, not Clear", () => {
    const input = healthy()
    const guards = allGuards(input)
    const verdict = identityVerdict({
      admins: { kind: "unknown", qualifiers: ["IAM did not answer"] },
      guards,
    })
    expect(verdict.verdict).toBe("Unknown")
  })

  test("every guard is accounted for exactly once, in either list", () => {
    const guards = allGuards(healthy())
    expect(guards).toHaveLength(8)
    expect(notPassing(guards).length + passing(guards).length).toBe(guards.length)
    expect(new Set(guards.map((guard) => guard.key)).size).toBe(guards.length)
  })

  test("guards sort worst first", () => {
    const rows: GuardRow[] = GUARD_STATES.map((state, index) => ({
      key: `g${index}`,
      door: "account",
      control: `control ${index}`,
      question: "q",
      state,
      findings: null,
      detail: "d",
      remedy: "r",
    }))
    const shuffled = [...rows].reverse()
    expect(sortGuards(shuffled).map((row) => row.state)).toEqual([...GUARD_STATES])
  })
})

/* ────────────────────────────────────────────────────── smaller helpers ── */

describe("row helpers", () => {
  test("wildcards rank worst kind first and their keys are unique per statement", () => {
    const rows = rankWildcards([
      wildcard({ kind: "PREFIX", statementIndex: 1 }),
      wildcard({ kind: "ADMIN", statementIndex: 0 }),
    ])
    expect(rows.map((row) => row.kind)).toEqual(["ADMIN", "PREFIX"])
    expect(new Set(rows.map(wildcardKey)).size).toBe(2)
  })

  test("access keys rank oldest first and an undated key never leads", () => {
    const rows = rankKeys([
      accessKey({ accessKeyId: "A", ageDays: null }),
      accessKey({ accessKeyId: "B", ageDays: 10 }),
      accessKey({ accessKeyId: "C", ageDays: 400 }),
    ])
    expect(rows.map((row) => row.accessKeyId)).toEqual(["C", "B", "A"])
  })

  test("statusWord carries the raw value AWS returned rather than folding it into CONFIRMED", () => {
    expect(statusWord({ code: "UNRECOGNISED", raw: "SOMETHING_NEW" })).toContain("SOMETHING_NEW")
    expect(statusWord({ code: "ABSENT", why: "none" })).toContain("not returned")
    expect(statusWord({ code: "CONFIRMED" })).toBe("CONFIRMED")
  })

  test("unknownArm narrows to the valueless arms and to nothing else", () => {
    expect(unknownArm(denied("kms:ListKeys", "kms:ListKeys"))).not.toBeNull()
    expect(unknownArm(empty("kms:ListKeys"))).toBeNull()
    expect(
      unknownArm({
        state: "ACTUAL",
        capability: "kms:ListKeys",
        value: [],
        asOf: ASOF,
        fresh: true,
      }),
    ).toBeNull()
  })
})
