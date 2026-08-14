import { __resetIdentity } from "./identity"
import type { AwsGateway, AwsRead } from "./read"
import type { Identity } from "./identity"
import type { IamPostureSurface } from "./iam"
import {
  controlRowsFor,
  isCleanScore,
  foldIamKeyAge,
  foldIamWildcards,
  managementAccountVerdict,
  rankPostureItems,
  scorePosture,
  securityPosture,
  type PostureScore,
  type PostureSeverity,
  type SecurityPostureItem,
} from "./posture"

/**
 * STUDIO-110-009 — the security posture aggregate, and the one property it
 * exists to hold: a check that did not RUN is not a check that PASSED.
 *
 * ## What is asserted, and why it is asserted THERE
 *
 * The end-to-end cases drive `securityPosture(gateway)` — the function the
 * surface calls — through the twelve real readers. Not a fold in isolation: a
 * test that only exercised `securityPostureFrom` would stay green on the day
 * this module stopped calling `guardDutyReadings`, which is the failure this
 * repository has already paid for. The gateway is a stand-in for AWS, not for
 * the readers; every SDK shape below is the shape the SDK really returns.
 *
 * Two gateways, and the difference between them is the whole point:
 *
 *   * `denyEverything()` refuses every call with `AccessDeniedException`. Every
 *     one of the sixteen items must come back UNKNOWN carrying a pasteable
 *     statement, and the score must not be CLEAN.
 *   * `answerEmpty()` SUCCEEDS on every call and returns an empty response —
 *     no detector, no bucket, no key, no trail. This is the gateway that
 *     separates this module from a naive one: a disabled GuardDuty detector
 *     returns exactly this, and a three-valued model renders it as a quiet
 *     account. Here the GuardDuty item must be NOT_CHECKED and the score must
 *     still not be CLEAN.
 *
 * The score's own arms are then driven directly, because `CLEAN` is not
 * reachable from any real estate this repository can point a test at and the
 * arm that must never fire is the one worth the most assertions.
 *
 * ## Nothing here is a real AWS identifier
 *
 * The account is `123456789012`, AWS's own documentation placeholder. No ARN,
 * bucket, key id or pool id below names a resource that exists. Nothing in this
 * file opens a socket: every reader takes the gateway it is handed.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const ROLE_ARN = `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-system-studio/session`
const AT = () => new Date("2026-08-13T09:00:00.000Z")

/** The sixteen keys this module answers, so a dropped fold is a failing test. */
const EVERY_KEY = [
  "analyzer::exists",
  "cloudtrail::logging",
  "cognito::mfa",
  "config::rule-compliance",
  "ecr::image-findings",
  "ecr::scan-on-push",
  "guardduty::detectors",
  "iam::key-age",
  "iam::wildcards",
  "kms::rotation",
  "network::internet-ingress",
  "s3::encryption",
  "s3::public-access",
  "s3::versioning",
  "secrets::rotation",
  "waf::web-acls",
] as const

function accessDenied(): Error {
  const error = new Error("User is not authorized to perform this operation")
  error.name = "AccessDeniedException"
  return error
}

/**
 * A gateway that refuses everything except identity.
 *
 * Identity answers so the denial context carries a principal — a refusal that
 * cannot name who was refused is a worse refusal, and this is the shape
 * production is in when the task role exists and the policy is short.
 */
function denyEverything(): AwsGateway {
  return {
    async call(capability) {
      if (capability === "sts:GetCallerIdentity") {
        return { Account: ACCOUNT, Arn: ROLE_ARN, UserId: "AROAEXAMPLE:session" }
      }
      throw accessDenied()
    },
    async resolvedRegion() {
      return REGION
    },
  }
}

/**
 * A gateway that SUCCEEDS at everything and has nothing to report.
 *
 * `{}` is what the SDK hands back for a list call against an estate with none
 * of that resource — and it is also, exactly, what a switched-off control hands
 * back. Telling those apart is this module's whole job.
 */
function answerEmpty(): AwsGateway {
  return {
    async call(capability) {
      if (capability === "sts:GetCallerIdentity") {
        return { Account: ACCOUNT, Arn: ROLE_ARN, UserId: "AROAEXAMPLE:session" }
      }
      return {}
    },
    async resolvedRegion() {
      return REGION
    },
  }
}

/**
 * A gateway describing an estate with something genuinely wrong in it.
 *
 * Three answers differ from `answerEmpty()` and each one is deliberate:
 *
 *   * `guardduty:ListDetectors` returns a detector and `guardduty:ListFindings`
 *     returns none. That pair is the exact shape a SUSPENDED detector produces —
 *     it exists, it is describable, and it reports nothing — and it is the
 *     failure named in this module's header. It must be NOT_CHECKED, not PASS.
 *   * `ec2:DescribeSecurityGroups` returns one group admitting 0.0.0.0/0 on 22.
 *     A control that RAN and found something, which must be FAIL and must not be
 *     confused with either gap state.
 *   * `s3:GetBucketPublicAccessBlock` raises the error S3 itself raises when no
 *     block exists, over a bucket `s3:ListBuckets` really returned.
 *
 * Together they put a FAIL and a NOT_CHECKED in the same posture, which is the
 * only way to prove the score carries the gap counts ALONGSIDE the failure count
 * rather than letting the loudest state swallow the others.
 */
function absentConfiguration(code: string): Error {
  const error = new Error(`S3 has no such configuration on this bucket`)
  error.name = code
  return error
}

function exposedEstate(): AwsGateway {
  return {
    async call(capability) {
      switch (capability) {
        case "sts:GetCallerIdentity":
          return { Account: ACCOUNT, Arn: ROLE_ARN, UserId: "AROAEXAMPLE:session" }
        case "guardduty:ListDetectors":
          return { DetectorIds: ["00000000000000000000000000000000"] }
        case "guardduty:ListFindings":
          return { FindingIds: [] }
        case "ec2:DescribeSecurityGroups":
          return {
            SecurityGroups: [
              {
                GroupId: "sg-00000000000000001",
                GroupName: "legacy-bastion",
                VpcId: "vpc-00000000000000001",
                Description: "a bastion nobody decommissioned",
                IpPermissions: [
                  {
                    IpProtocol: "tcp",
                    FromPort: 22,
                    ToPort: 22,
                    IpRanges: [{ CidrIp: "0.0.0.0/0" }],
                  },
                ],
                IpPermissionsEgress: [],
              },
            ],
          }
        case "s3:ListBuckets":
          return { Buckets: [{ Name: "tenure-example-artifacts" }] }
        case "s3:GetBucketPublicAccessBlock":
          throw absentConfiguration("NoSuchPublicAccessBlockConfiguration")
        default:
          return {}
      }
    },
    async resolvedRegion() {
      return REGION
    },
  }
}

function byKey(items: readonly SecurityPostureItem[], key: string): SecurityPostureItem {
  const found = items.find((item) => item.key === key)
  if (!found) throw new Error(`no posture item keyed ${key}`)
  return found
}

/* ------------------------------------------------- items built by hand --- */

function passItem(key: string): SecurityPostureItem {
  return {
    key,
    service: "s3",
    question: "unencrypted",
    control: `control ${key}`,
    answers: "what it answers",
    state: "PASS",
    basis: "it ran over everything it claims to cover",
    checked: 3,
    limits: [],
  }
}

function failItem(key: string, severity: PostureSeverity): SecurityPostureItem {
  return {
    key,
    service: "s3",
    question: "exposed",
    control: `control ${key}`,
    answers: "what it answers",
    state: "FAIL",
    severity,
    detail: "it ran and found something",
    remedy: "fix the thing it found",
    subjects: ["a-subject"],
  }
}

function notCheckedItem(key: string): SecurityPostureItem {
  return {
    key,
    service: "guardduty",
    question: "unwatched",
    control: `control ${key}`,
    answers: "what it answers",
    state: "NOT_CHECKED",
    reason: "the control is switched off in this account",
    remedy: "switch it on",
  }
}

function unknownItem(key: string): SecurityPostureItem {
  return {
    key,
    service: "kms",
    question: "unrotated",
    control: `control ${key}`,
    answers: "what it answers",
    state: "UNKNOWN",
    reason: "this engine's role was refused",
    action: "kms:ListKeys",
    minimumStatement: '{"Effect":"Allow","Action":["kms:ListKeys"],"Resource":"*"}',
  }
}

/** An IAM surface whose read is in an arm no live estate reaches on demand. */
function iamSurface(read: AwsRead<never>): IamPostureSurface {
  const identity: AwsRead<Identity> = {
    state: "ACTUAL",
    capability: "sts:GetCallerIdentity",
    value: { accountId: ACCOUNT, arn: ROLE_ARN, region: REGION, partition: "aws" },
    asOf: AT().toISOString(),
    fresh: true,
  }
  return {
    identity,
    scope: {
      accountId: ACCOUNT,
      partition: "aws",
      region: REGION,
      arnPrefix: `arn:aws:iam::${ACCOUNT}:`,
      global: true,
      detail: "account-wide",
    },
    read,
    posture: null,
    tagIndexRead: { state: "EMPTY", capability: "tag:GetResources", asOf: AT().toISOString() },
    headline: "not read",
    asOf: AT().toISOString(),
    refreshMs: 60_000,
  }
}

beforeEach(() => {
  // `resolveIdentity` caches per process. Every case supplies its own gateway,
  // which bypasses the cache, but a stale cache from another suite in the same
  // worker would make the denial context somebody else's.
  __resetIdentity()
})

/* ═══════════════════════════ the rule, end to end ═══════════════════════ */

describe("securityPosture — a refused read is UNKNOWN, never a pass", () => {
  it("returns every one of the sixteen items as UNKNOWN when AWS refuses everything", async () => {
    const posture = await securityPosture(denyEverything(), { now: AT })

    expect(posture.items.map((item) => item.key).sort()).toEqual([...EVERY_KEY])
    expect(posture.items.map((item) => item.state)).toEqual(EVERY_KEY.map(() => "UNKNOWN"))
    expect(posture.score.verdict).toBe("INCOMPLETE")
    expect(posture.score.unknown).toBe(16)
    expect(posture.score.pass).toBe(0)
    expect(posture.score.fail).toBe(0)
    expect(posture.score.notChecked).toBe(0)
    expect(isCleanScore(posture.score)).toBe(false)
  })

  it("carries a pasteable statement and the refused action on every UNKNOWN item", async () => {
    const posture = await securityPosture(denyEverything(), { now: AT })

    for (const item of posture.items) {
      if (item.state !== "UNKNOWN") throw new Error(`${item.key} was ${item.state}, not UNKNOWN`)
      expect(item.action).toMatch(/^[a-z0-9-]+:[A-Za-z]/)
      expect(item.minimumStatement).toContain('"Effect":"Allow"')
      expect(item.minimumStatement).toContain(item.action)
      expect(item.reason.length).toBeGreaterThan(0)
    }
  })

  it("never reports a zero as a pass: an empty-but-successful estate is not clean", async () => {
    const posture = await securityPosture(answerEmpty(), { now: AT })

    // THE case. `guardduty:ListDetectors` answered and there is no detector,
    // which is exactly what a switched-off control looks like, and it returns
    // the same empty finding list as an account with nothing wrong.
    const guardduty = byKey(posture.items, "guardduty::detectors")
    expect(guardduty.state).toBe("NOT_CHECKED")
    if (guardduty.state !== "NOT_CHECKED") throw new Error("narrowing")
    expect(guardduty.reason).toContain("NO detector")
    expect(guardduty.remedy).toContain("guardduty:CreateDetector")

    // And the account as a whole cannot be called clean off the back of it.
    expect(posture.score.verdict).not.toBe("CLEAN")
    expect(isCleanScore(posture.score)).toBe(false)
    expect(posture.score.notChecked + posture.score.unknown).toBeGreaterThan(0)
  })

  it("degrades per service: one refusal does not take the other fifteen with it", async () => {
    const posture = await securityPosture(answerEmpty(), { now: AT })
    // Every item is one of the four states and none is missing.
    expect(posture.items).toHaveLength(16)
    for (const item of posture.items) {
      expect(["PASS", "FAIL", "NOT_CHECKED", "UNKNOWN"]).toContain(item.state)
    }
    // A reading's own stamp, never a clock this module read.
    expect(posture.asOf).toBe(AT().toISOString())
  })
})

/* ══════════════ a failing estate: FAIL and a gap in one posture ═════════ */

describe("securityPosture — a control that ran and found something, beside one that did not run", () => {
  it("calls a live-but-silent GuardDuty detector NOT_CHECKED, which is the named failure", async () => {
    const posture = await securityPosture(exposedEstate(), { now: AT })

    const guardduty = byKey(posture.items, "guardduty::detectors")
    // A detector EXISTS here and returned zero findings. A three-valued model
    // prints that as a quiet account; a SUSPENDED detector is indistinguishable
    // from a running one through ListDetectors alone, so zero is not evidence.
    expect(guardduty.state).toBe("NOT_CHECKED")
    if (guardduty.state !== "NOT_CHECKED") throw new Error("narrowing")
    expect(guardduty.reason).toContain("detector(s) exist and returned no finding")
    expect(guardduty.remedy).toContain("guardduty:GetDetector")
  })

  it("fails the open security group at CRITICAL, naming the group and the CIDR", async () => {
    const posture = await securityPosture(exposedEstate(), { now: AT })

    const ingress = byKey(posture.items, "network::internet-ingress")
    expect(ingress.state).toBe("FAIL")
    if (ingress.state !== "FAIL") throw new Error("narrowing")
    expect(ingress.severity).toBe("CRITICAL")
    expect(ingress.detail).toContain("0.0.0.0/0")
    expect(ingress.subjects).toEqual(["sg-00000000000000001"])
  })

  it("fails the bucket with no public access block, over a bucket S3 really listed", async () => {
    const posture = await securityPosture(exposedEstate(), { now: AT })

    const publicAccess = byKey(posture.items, "s3::public-access")
    expect(publicAccess.state).toBe("FAIL")
    if (publicAccess.state !== "FAIL") throw new Error("narrowing")
    expect(publicAccess.subjects).toEqual(["tenure-example-artifacts"])
  })

  it("scores FAILING and still carries both gap counts beside the failures", async () => {
    const posture = await securityPosture(exposedEstate(), { now: AT })
    const score = posture.score

    expect(score.verdict).toBe("FAILING")
    if (score.verdict !== "FAILING") throw new Error("narrowing")
    expect(score.worst).toBe("CRITICAL")
    expect(score.fail).toBeGreaterThan(0)
    // The whole clause: the loudest state does not swallow the quiet ones.
    expect(score.notChecked).toBeGreaterThan(0)
    expect(score.pass + score.fail + score.notChecked + score.unknown).toBe(score.total)
    expect(score.total).toBe(16)
    expect(isCleanScore(score)).toBe(false)
    expect(score.because).toContain("cannot produce a failure here at all")
  })

  it("ranks the failures above the gaps, and the gaps above the passes", async () => {
    const posture = await securityPosture(exposedEstate(), { now: AT })
    const states = posture.items.map((item) => item.state)
    const rank = { FAIL: 0, NOT_CHECKED: 1, UNKNOWN: 2, PASS: 3 } as const
    for (let index = 1; index < states.length; index += 1) {
      expect(rank[states[index]]).toBeGreaterThanOrEqual(rank[states[index - 1]])
    }
  })

  it("renders the failure as CHECKING and the silent detector as NOT_CHECKING", async () => {
    const posture = await securityPosture(exposedEstate(), { now: AT })
    const rows = controlRowsFor(posture.items)

    const ingress = rows.find((row) => row.key === "network::internet-ingress")
    const guardduty = rows.find((row) => row.key === "guardduty::detectors")
    // A control that found something RAN. The finding belongs on the exposure
    // list; the coverage word for it is CHECKING and never NOT_CHECKING.
    expect(ingress?.state).toBe("CHECKING")
    expect(guardduty?.state).toBe("NOT_CHECKING")
  })
})

/* ═════════════════════════════ the score's arms ═════════════════════════ */

describe("scorePosture — clean is unreachable while anything is unanswered", () => {
  it("says CLEAN only when every item passed", () => {
    const score = scorePosture([passItem("a"), passItem("b")])
    expect(score.verdict).toBe("CLEAN")
    expect(score.pass).toBe(2)
    expect(score.fail).toBe(0)
    expect(score.notChecked).toBe(0)
    expect(score.unknown).toBe(0)
    expect(isCleanScore(score)).toBe(true)
  })

  it("cannot say CLEAN with one NOT_CHECKED item, however many passed", () => {
    const score = scorePosture([passItem("a"), passItem("b"), notCheckedItem("c")])
    expect(score.verdict).toBe("INCOMPLETE")
    expect(score.notChecked).toBe(1)
    expect(score.pass).toBe(2)
    expect(isCleanScore(score)).toBe(false)
  })

  it("cannot say CLEAN with one UNKNOWN item, however many passed", () => {
    const score = scorePosture([passItem("a"), passItem("b"), unknownItem("c")])
    expect(score.verdict).toBe("INCOMPLETE")
    expect(score.unknown).toBe(1)
    expect(isCleanScore(score)).toBe(false)
  })

  it("says FAILING at the worst severity open, and carries the gap counts beside it", () => {
    const score = scorePosture([
      passItem("a"),
      failItem("b", "MEDIUM"),
      failItem("c", "CRITICAL"),
      notCheckedItem("d"),
      unknownItem("e"),
    ])
    expect(score.verdict).toBe("FAILING")
    if (score.verdict !== "FAILING") throw new Error("narrowing")
    expect(score.worst).toBe("CRITICAL")
    expect(score.fail).toBe(2)
    // The point of the clause: the gap counts travel WITH the failure count.
    expect(score.notChecked).toBe(1)
    expect(score.unknown).toBe(1)
  })

  it("ranks an unreadable severity above CRITICAL rather than below LOW", () => {
    const score = scorePosture([failItem("a", "CRITICAL"), failItem("b", "UNRANKED")])
    if (score.verdict !== "FAILING") throw new Error("narrowing")
    expect(score.worst).toBe("UNRANKED")
  })

  it("carries counts that sum to the total, and names both gap counts in its sentence", () => {
    const items = [passItem("a"), failItem("b", "HIGH"), notCheckedItem("c"), unknownItem("d")]
    const score: PostureScore = scorePosture(items)
    expect(score.pass + score.fail + score.notChecked + score.unknown).toBe(score.total)
    expect(score.total).toBe(items.length)
    expect(score.because).toContain("were not checked at all")
    expect(score.because).toContain("could not be read by this engine")
  })

  it("says INCOMPLETE, not CLEAN, for an estate with nothing but gaps", () => {
    const score = scorePosture([notCheckedItem("a"), unknownItem("b")])
    expect(score.verdict).toBe("INCOMPLETE")
    expect(score.pass).toBe(0)
  })
})

/* ══════════════════════════ the throttled arm, folded ═══════════════════ */

describe("folds — a throttle is UNKNOWN, with the capability's own statement", () => {
  it("maps a THROTTLED IAM read to UNKNOWN on both IAM items", () => {
    const throttled = iamSurface({
      state: "THROTTLED",
      capability: "iam:GetAccountAuthorizationDetails",
      retryAfterMs: 400,
      asOf: AT().toISOString(),
    })

    const wildcards = foldIamWildcards(throttled)
    const keyAge = foldIamKeyAge(throttled)

    expect(wildcards.state).toBe("UNKNOWN")
    expect(keyAge.state).toBe("UNKNOWN")
    if (wildcards.state !== "UNKNOWN" || keyAge.state !== "UNKNOWN") throw new Error("narrowing")
    // A throttle carries no action of its own, so the fold names the capability
    // rather than leaving the operator with a blank remedy.
    expect(wildcards.action).toBe("iam:GetAccountAuthorizationDetails")
    expect(keyAge.action).toBe("iam:ListAccessKeys")
    expect(wildcards.minimumStatement).toContain("iam:GetAccountAuthorizationDetails")
    expect(keyAge.minimumStatement).toContain("iam:ListAccessKeys")
  })

  it("maps an EMPTY IAM read to PASS with zero checked, which is a different claim", () => {
    const empty = iamSurface({
      state: "EMPTY",
      capability: "iam:GetAccountAuthorizationDetails",
      asOf: AT().toISOString(),
    })
    const wildcards = foldIamWildcards(empty)
    expect(wildcards.state).toBe("PASS")
    if (wildcards.state !== "PASS") throw new Error("narrowing")
    expect(wildcards.checked).toBe(0)
    expect(wildcards.basis).toContain("no role and no user")
  })
})

/* ══════════════════════════════ ordering, rendering ═════════════════════ */

describe("rankPostureItems", () => {
  /**
   * The keys are chosen so ALPHABETICAL order contradicts the intended order at
   * every step. A ranking that fell back to the key alone would produce
   * `a,b,c,d,e` and read as correct; this expects the exact reverse of it.
   */
  it("puts failures first, worst severity first, then unchecked, then unknown, then passes", () => {
    const ordered = rankPostureItems([
      passItem("a"),
      unknownItem("b"),
      notCheckedItem("c"),
      failItem("d", "MEDIUM"),
      failItem("e", "CRITICAL"),
    ])
    expect(ordered.map((item) => item.key)).toEqual(["e", "d", "c", "b", "a"])
  })

  it("orders identically whatever the input order, and without localeCompare", () => {
    const items = [
      failItem("b", "HIGH"),
      failItem("a", "HIGH"),
      passItem("d"),
      passItem("c"),
    ]
    const forward = rankPostureItems(items).map((item) => item.key)
    const backward = rankPostureItems([...items].reverse()).map((item) => item.key)
    expect(forward).toEqual(backward)
    expect(forward).toEqual(["a", "b", "c", "d"])
  })
})

describe("controlRowsFor — the two gap words stay apart on the way to the page", () => {
  it("maps a failure to CHECKING, because a control that found something ran", () => {
    const [row] = controlRowsFor([failItem("a", "HIGH")])
    expect(row.state).toBe("CHECKING")
    expect(row.detail).toContain("HIGH")
    expect(row.remedy).toBe("fix the thing it found")
  })

  it("maps NOT_CHECKED to NOT_CHECKING and UNKNOWN to UNREADABLE, never the same word", () => {
    const rows = controlRowsFor([notCheckedItem("a"), unknownItem("b")])
    expect(rows.map((row) => row.state)).toEqual(["NOT_CHECKING", "UNREADABLE"])
    // The remedies are the two opposite ones: switch the control on, versus
    // grant this engine a statement. A page that collapsed the states would
    // print one of them to an operator who needed the other.
    expect(rows[0].remedy).toBe("switch it on")
    expect(rows[1].minimumStatement).toContain("kms:ListKeys")
    expect(rows[0].minimumStatement).toBeUndefined()
  })

  it("carries a pass's limits into the row, so the qualification cannot be dropped", () => {
    const withLimit: SecurityPostureItem = {
      ...passItem("a"),
      state: "PASS",
      basis: "the scan ran",
      checked: 2,
      limits: ["basic scanning covers OS packages only"],
    }
    const [row] = controlRowsFor([withLimit])
    expect(row.state).toBe("CHECKING")
    expect(row.detail).toContain("basic scanning covers OS packages only")
  })
})

/* ═════════════════ the pre-existing half, still four-valued ═════════════ */

describe("managementAccountVerdict", () => {
  const identity: AwsRead<Identity> = {
    state: "ACTUAL",
    capability: "sts:GetCallerIdentity",
    value: { accountId: ACCOUNT, arn: ROLE_ARN, region: REGION, partition: "aws" },
    asOf: AT().toISOString(),
    fresh: true,
  }

  it("says UNKNOWN, not SEPARATED, when the organization read was refused", () => {
    const finding = managementAccountVerdict(identity, {
      state: "UNKNOWN",
      principal: ROLE_ARN,
      action: "organizations:DescribeOrganization",
      errorCode: "AccessDeniedException",
      minimumStatement: '{"Effect": "Allow", "Action": ["organizations:DescribeOrganization"]}',
    })
    expect(finding.verdict).toBe("UNKNOWN")
    expect(finding.detail).toContain("organizations:DescribeOrganization")
  })

  it("says WORKLOAD_IN_MANAGEMENT_ACCOUNT when the two account ids are the same", () => {
    const finding = managementAccountVerdict(identity, {
      state: "IN_USE",
      organizationId: "o-example",
      managementAccountId: ACCOUNT,
      managementAccountArn: `arn:aws:organizations::${ACCOUNT}:account/o-example/${ACCOUNT}`,
      featureSet: "ALL",
      asOf: AT().toISOString(),
    })
    expect(finding.verdict).toBe("WORKLOAD_IN_MANAGEMENT_ACCOUNT")
  })
})
