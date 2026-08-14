import {
  CHIP_SEVERITY,
  CONTROL_STATES,
  CONTROL_TONE,
  CONTROL_WORDS,
  KEY_SEVERE_DAYS,
  QUESTIONS,
  UNWIRED_CONTROLS,
  WILDCARD_SEVERITY,
  controlsFor,
  controlsFromIam,
  controlsFromSources,
  coverageByQuestion,
  covering,
  exposuresFromFindings,
  exposuresFromKeys,
  exposuresFromWildcards,
  gaps,
  isCovering,
  postureVerdict,
  rankExposures,
  sortControls,
  unwiredControls,
  type ControlRow,
  type Exposure,
} from "./posture"
import type { FindingSource, SecurityFinding } from "../../../lib/aws/findings"
import type { IamAccessKey, IamPosture, IamWildcard } from "../../../lib/aws/iam"

/**
 * The coverage half of `/platform/security`, driven with no browser, no server
 * and no AWS account.
 *
 * `e2e/security-page-logic.spec.ts` covers `./answer.ts` — what the page says
 * about the findings Security Hub returned. This covers the thing that has to be
 * decided first and that a findings list can never decide on its own: **which of
 * "exposed, unencrypted, unrotated, unwatched" is being asked of this account at
 * all.**
 *
 * Every assertion below is one rule, stated another way:
 *
 *   **an absence of findings from a control that is not running is not a pass.**
 *
 * The arms that matter cannot be reached from a browser pointed at a healthy
 * estate — they need GuardDuty switched off, an access-key read refused
 * mid-sweep, or an account where every single control answers, which no account
 * with an unwired control can ever be. A suite that only drove the browser would
 * leave the wording an operator sees on their worst morning untested, and would
 * leave the one arm this page must never reach by accident — "Clear" — asserted
 * by nothing.
 */

/* ────────────────────────────────────────────────────────── fixtures ────── */

const source = (over: Partial<FindingSource> = {}): FindingSource => ({
  product: "GuardDuty",
  state: "AGGREGATED",
  detail: "read through Security Hub's aggregated findings.",
  ...over,
})

const finding = (over: Partial<SecurityFinding> = {}): SecurityFinding => ({
  key: "finding-1::arn:aws:securityhub:eu-west-2::product/aws/guardduty::i-1",
  id: "finding-1",
  productArn: "arn:aws:securityhub:eu-west-2::product/aws/guardduty",
  product: "GuardDuty",
  title: "UnauthorizedAccess:EC2/SSHBruteForce",
  severity: "HIGH",
  firstObservedAt: "2026-08-01T09:00:00.000Z",
  recordState: "ACTIVE",
  resourceIds: ["arn:aws:ec2:eu-west-2:123456789012:instance/i-1"],
  affects: { kind: "tenant", tenantSlug: "seed-deployed" },
  ageHours: 100,
  pastSla: false,
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
  detail: "every action on every resource.",
  ...over,
})

const accessKey = (over: Partial<IamAccessKey> = {}): IamAccessKey => ({
  userName: "ci",
  accessKeyId: "AKIAEXAMPLEEXAMPLE01",
  status: "Active",
  createdAt: "2025-01-01T00:00:00.000Z",
  ageDays: 120,
  longLived: true,
  detail: "active and 120 days old.",
  ...over,
})

const posture = (over: Partial<IamPosture> = {}): IamPosture => ({
  roles: [],
  users: [],
  wildcards: [],
  longLivedKeys: [],
  accessKeys: [],
  unmanaged: [],
  unswept: [],
  unreadableDocuments: [],
  keyCoverage: {
    usersAsked: 3,
    usersAnswered: 3,
    usersDenied: 0,
    usersThrottled: 0,
    usersErrored: 0,
    complete: true,
    detail: "all 3 users answered.",
  },
  sweepCoverage: {
    policiesSwept: 9,
    policiesUnreadable: 0,
    policiesUnswept: 0,
    complete: true,
    detail: "all 9 policy documents were swept.",
  },
  ...over,
})

/** A control row, so a verdict case can be written without a whole estate. */
const control = (over: Partial<ControlRow> = {}): ControlRow => ({
  key: "control-1",
  question: "unwatched",
  control: "GuardDuty",
  state: "CHECKING",
  answers: "threat detection",
  detail: "read through Security Hub.",
  remedy: "Nothing to do for coverage.",
  ...over,
})

const exposure = (over: Partial<Exposure> = {}): Exposure => ({
  key: "exposure-1",
  severity: "HIGH",
  severitySource: "product",
  type: "UnauthorizedAccess:EC2/SSHBruteForce",
  detail: "shared",
  resource: "arn:aws:ec2:eu-west-2:123456789012:instance/i-1",
  source: "GuardDuty",
  ageHours: 10,
  pastSla: false,
  remedy: "Open this finding in Security Hub.",
  ...over,
})

/* ──────────────────── a switched-off control is not a clean bill of health ─ */

describe("a control that is not running is never coverage", () => {
  test("only CHECKING counts, and every other state is a gap", () => {
    expect(isCovering("CHECKING")).toBe(true)
    for (const state of CONTROL_STATES) {
      if (state === "CHECKING") continue
      // PARTIAL is in here on purpose. A wildcard sweep that could not read an
      // AWS-managed policy document has not swept it, and reporting "no
      // wildcards" off that is the same defect one level down.
      // The state travels into the assertion so a failing iteration names
      // itself: jest's `expect` takes one argument, unlike Playwright's.
      expect([state, isCovering(state)]).toEqual([state, false])
    }
  })

  test("a NOT_ENABLED product renders as not being checked, never as clean", () => {
    const [row] = controlsFromSources([
      source({
        product: "GuardDuty",
        state: "NOT_ENABLED",
        detail: "not readable — GuardDuty publishes through Security Hub, which is not enabled here.",
      }),
    ])
    expect(row.state).toBe("NOT_CHECKING")
    expect(isCovering(row.state)).toBe(false)
    expect(CONTROL_WORDS[row.state]).toBe("Not being checked")
    // The reader's own sentence, not a rewording of it: two sentences describing
    // one fact drift, and the one that drifts is the one nobody reruns.
    expect(row.detail).toContain("which is not enabled here")
    // And a remedy that names the action, rather than "investigate".
    expect(row.remedy).toContain("guardduty:CreateDetector")
  })

  test("a refused product is UNREADABLE and carries the statement that would fix it", () => {
    const [row] = controlsFromSources([
      source({
        product: "Macie",
        state: "UNKNOWN",
        deniedAction: "securityhub:GetFindings",
        minimumStatement: '{"Effect":"Allow","Action":["securityhub:GetFindings"],"Resource":"*"}',
        detail: "not read — securityhub:GetFindings was refused (AccessDeniedException).",
      }),
    ])
    expect(row.state).toBe("UNREADABLE")
    expect(row.action).toBe("securityhub:GetFindings")
    expect(row.minimumStatement).toContain("securityhub:GetFindings")
  })

  test("a product that reported is the only arm that is CHECKING", () => {
    expect(controlsFromSources([source({ state: "AGGREGATED" })])[0].state).toBe("CHECKING")
    expect(controlsFromSources([source({ state: "DIRECT" })])[0].state).toBe("CHECKING")
  })

  test("no control state is toned ok unless it is actually checking", () => {
    for (const state of CONTROL_STATES) {
      if (state === "CHECKING") continue
      expect([state, CONTROL_TONE[state]]).not.toEqual([state, "ok"])
    }
    expect(CONTROL_TONE.CHECKING).toBe("ok")
    // A control switched off in the account and a control nothing here reads are
    // equally blinding, and both are the loud tone for that reason.
    expect(CONTROL_TONE.NOT_CHECKING).toBe("bad")
    expect(CONTROL_TONE.NOT_WIRED).toBe("bad")
  })
})

/* ───────────────────────────── this console's own two checks, and honesty ── */

describe("the console's own IAM checks report their own coverage", () => {
  test("an incomplete sweep is PARTIAL, never CHECKING", () => {
    const rows = controlsFromIam(
      "ACTUAL",
      posture({
        sweepCoverage: {
          policiesSwept: 8,
          policiesUnreadable: 0,
          policiesUnswept: 1,
          complete: false,
          detail: "1 attached policy document was never returned — AdministratorAccess.",
        },
      }),
    )
    const sweep = rows.find((row) => row.key === "iam::wildcards")!
    expect(sweep.state).toBe("PARTIAL")
    expect(sweep.detail).toContain("AdministratorAccess")
    expect(sweep.remedy).toContain("floor")
  })

  test("an incomplete key read is PARTIAL, and says the count is a floor", () => {
    const rows = controlsFromIam(
      "ACTUAL",
      posture({
        keyCoverage: {
          usersAsked: 20,
          usersAnswered: 19,
          usersDenied: 1,
          usersThrottled: 0,
          usersErrored: 0,
          complete: false,
          detail: "19 of 20 users answered; 1 refused iam:ListAccessKeys.",
        },
      }),
    )
    const keys = rows.find((row) => row.key === "iam::key-age")!
    expect(keys.state).toBe("PARTIAL")
    expect(keys.remedy).toContain("floor")
    expect(keys.minimumStatement).toContain("iam:ListAccessKeys")
  })

  test("complete coverage on both is the only way either reaches CHECKING", () => {
    const rows = controlsFromIam("ACTUAL", posture())
    expect(rows.map((row) => row.state)).toEqual(["CHECKING", "CHECKING"])
  })

  test("a read that did not answer is UNREADABLE, and names the state it came back as", () => {
    for (const state of ["DENIED", "THROTTLED", "UNCONFIGURED", "ERROR"]) {
      const rows = controlsFromIam(state, null)
      expect([state, ...rows.map((row) => row.state)]).toEqual([state, "UNREADABLE", "UNREADABLE"])
      expect(rows[0].detail).toContain(state)
      expect(rows[0].minimumStatement).toContain("iam:GetAccountAuthorizationDetails")
    }
  })

  test("an account that answered with no principals is checked, not unreadable", () => {
    // EMPTY is a successful read of nothing, which is a different claim from a
    // read that never happened — and collapsing the two is the whole failure
    // this page exists to avoid, in the direction that costs coverage rather
    // than the direction that fakes it.
    const rows = controlsFromIam("EMPTY", null)
    expect(rows.map((row) => row.state)).toEqual(["CHECKING", "CHECKING"])
    expect(rows[0].detail).toContain("no role and no user")
  })
})

/* ─────────────────────────────── the controls nothing here reads yet ────── */

describe("a control this console cannot read is declared, not omitted", () => {
  test("every unwired control is NOT_WIRED and carries a real minimum statement", () => {
    const rows = unwiredControls()
    expect(rows.length).toBe(UNWIRED_CONTROLS.length)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect([row.key, row.state]).toEqual([row.key, "NOT_WIRED"])
      expect([row.key, Boolean(row.action)]).toEqual([row.key, true])
      // Pasteable JSON naming the action, from the same registry every other
      // refusal on this console is answered from.
      expect([row.key, row.minimumStatement?.includes(row.action!.split(":")[0])]).toEqual([
        row.key,
        true,
      ])
      expect([row.key, row.minimumStatement?.includes("Effect")]).toEqual([row.key, true])
      expect([row.key, row.remedy.trim() !== ""]).toEqual([row.key, true])
      expect([row.key, row.answers.trim() !== ""]).toEqual([row.key, true])
    }
  })

  test("the four controls the requirement names by hand are all on the list", () => {
    const keys = unwiredControls().map((row) => row.key)
    // A disabled GuardDuty detector, an account with no Access Analyzer, a
    // repository with scanOnPush off, a Config rule at INSUFFICIENT_DATA.
    expect(keys).toContain("guardduty::detectors")
    expect(keys).toContain("analyzer::exists")
    expect(keys).toContain("ecr::scan-on-push")
    expect(keys).toContain("config::rule-compliance")
  })

  test("a reader landing later displaces its own placeholder rather than doubling it", () => {
    const live = control({
      key: "guardduty::detectors",
      state: "NOT_CHECKING",
      control: "GuardDuty detector state",
      detail: "guardduty:ListDetectors answered with no detector in this region.",
    })
    const rows = controlsFor([live])
    const matching = rows.filter((row) => row.key === "guardduty::detectors")
    expect(matching).toHaveLength(1)
    expect(matching[0].state).toBe("NOT_CHECKING")
    expect(matching[0].detail).toContain("no detector")
    // And nothing else was dropped by the merge.
    expect(rows.length).toBe(UNWIRED_CONTROLS.length)
  })

  test("worst first: switched off, then unwired, then refused, then partial, then checking", () => {
    const rows = sortControls([
      control({ key: "e", state: "CHECKING" }),
      control({ key: "d", state: "PARTIAL" }),
      control({ key: "c", state: "UNREADABLE" }),
      control({ key: "b", state: "NOT_WIRED" }),
      control({ key: "a", state: "NOT_CHECKING" }),
    ])
    expect(rows.map((row) => row.state)).toEqual([
      "NOT_CHECKING",
      "NOT_WIRED",
      "UNREADABLE",
      "PARTIAL",
      "CHECKING",
    ])
  })

  test("sorting does not mutate what it was given", () => {
    const input = [control({ key: "b", state: "CHECKING" }), control({ key: "a", state: "NOT_CHECKING" })]
    sortControls(input)
    expect(input.map((row) => row.key)).toEqual(["b", "a"])
  })

  test("gaps and covering are complements — no row can be in both or neither", () => {
    const rows = controlsFor(controlsFromSources([source({ state: "NOT_ENABLED" })]))
    expect(gaps(rows).length + covering(rows).length).toBe(rows.length)
    for (const row of gaps(rows)) expect(covering(rows)).not.toContain(row)
  })
})

/* ──────────────────────────────────────────── coverage, per question word ── */

describe("coverage is counted per question, and only from controls that ran", () => {
  test("a question whose only control is switched off reads as nobody checking it", () => {
    const rows = [
      control({ key: "a", question: "unencrypted", state: "NOT_CHECKING" }),
      control({ key: "b", question: "exposed", state: "CHECKING" }),
    ]
    const byQuestion = coverageByQuestion(rows)
    const unencrypted = byQuestion.find((entry) => entry.question === "unencrypted")!
    expect(unencrypted.checking).toBe(0)
    expect(unencrypted.detail).toContain("no control is checking it")
    const exposed = byQuestion.find((entry) => entry.question === "exposed")!
    expect(exposed.checking).toBe(1)
    expect(exposed.detail).toContain("all 1")
  })

  test("a question with no control at all says so rather than printing 0 of 0", () => {
    const entry = coverageByQuestion([])[0]
    // `0 of 0` is the one fraction a reader can mistake for complete.
    expect(entry.total).toBe(0)
    expect(entry.detail).toBe("nothing on this page asks it")
  })

  test("every one of the four words is always present, in the order the page asks them", () => {
    expect(coverageByQuestion([]).map((entry) => entry.question)).toEqual([...QUESTIONS])
    expect([...QUESTIONS]).toEqual(["exposed", "unencrypted", "unrotated", "unwatched"])
  })

  test("a PARTIAL control does not count towards its question's coverage", () => {
    const entry = coverageByQuestion([control({ question: "unrotated", state: "PARTIAL" })]).find(
      (row) => row.question === "unrotated",
    )!
    expect(entry.checking).toBe(0)
    expect(entry.total).toBe(1)
  })
})

/* ────────────────────────────────────────────────── everything that ranks ── */

describe("one ranked list, across every source", () => {
  test("worst severity first", () => {
    const ordered = rankExposures([
      exposure({ key: "low", severity: "LOW" }),
      exposure({ key: "crit", severity: "CRITICAL" }),
      exposure({ key: "med", severity: "MEDIUM" }),
    ])
    expect(ordered.map((e) => e.severity)).toEqual(["CRITICAL", "MEDIUM", "LOW"])
  })

  test("inside one severity, past its allowance comes first", () => {
    const ordered = rankExposures([
      exposure({ key: "inside", severity: "HIGH", ageHours: 10, pastSla: false }),
      exposure({ key: "past", severity: "HIGH", ageHours: 9, pastSla: true }),
    ])
    expect(ordered.map((e) => e.key)).toEqual(["past", "inside"])
  })

  test("then oldest, then by key — the same input draws the same page twice", () => {
    const input = [
      exposure({ key: "b", severity: "HIGH", ageHours: 5 }),
      exposure({ key: "a", severity: "HIGH", ageHours: 5 }),
      exposure({ key: "c", severity: "HIGH", ageHours: 9 }),
    ]
    const once = rankExposures(input).map((e) => e.key)
    const twice = rankExposures(input.slice().reverse()).map((e) => e.key)
    expect(once).toEqual(["c", "a", "b"])
    // Reversing the input must not reorder the output. A comparator that fell
    // through to insertion order would pass the first assertion and fail this.
    expect(twice).toEqual(once)
  })

  test("ranking does not mutate what it was given", () => {
    const input = [exposure({ key: "b", severity: "LOW" }), exposure({ key: "a", severity: "CRITICAL" })]
    rankExposures(input)
    expect(input.map((e) => e.key)).toEqual(["b", "a"])
  })

  test("an undated console row does not outrank a dated one of the same severity", () => {
    // The cross-source case `sortFindings` could not express: an IAM wildcard
    // carries no first-observed time, and treating a missing age as zero would
    // be fine, while treating it as Infinity would float every wildcard above
    // every genuinely old finding.
    const ordered = rankExposures([
      exposure({ key: "undated", severity: "HIGH", ageHours: null }),
      exposure({ key: "old", severity: "HIGH", ageHours: 900 }),
    ])
    expect(ordered.map((e) => e.key)).toEqual(["old", "undated"])
  })

  test("a console CRITICAL and a product CRITICAL rank together", () => {
    const ordered = rankExposures([
      ...exposuresFromFindings([finding({ severity: "MEDIUM" })], () => "shared"),
      ...exposuresFromWildcards([wildcard({ kind: "ADMIN" })]),
    ])
    expect(ordered[0].severity).toBe("CRITICAL")
    expect(ordered[0].severitySource).toBe("console")
  })
})

/* ─────────────────────────────────────── the type, and whose severity it is ─ */

describe("every row names its type verbatim and says whose severity it carries", () => {
  test("a Security Hub row keeps the product's title and label untouched", () => {
    const [row] = exposuresFromFindings(
      [finding({ title: "UnauthorizedAccess:EC2/SSHBruteForce", severity: "HIGH" })],
      () => "tenant seed-deployed",
    )
    expect(row.type).toBe("UnauthorizedAccess:EC2/SSHBruteForce")
    expect(row.severity).toBe("HIGH")
    expect(row.severitySource).toBe("product")
    expect(row.source).toBe("GuardDuty")
    expect(row.detail).toContain("tenant seed-deployed")
    // Security Hub's own Remediation.Recommendation is not requested by
    // `lib/aws/findings.ts`, so the remedy says where it is rather than
    // inventing one that sounds plausible.
    expect(row.remedy).toContain("Remediation.Recommendation")
  })

  test("an IAM wildcard row keeps the classifier's own word as its type", () => {
    const [row] = exposuresFromWildcards([wildcard({ kind: "ANY_PRINCIPAL" })])
    expect(row.type).toBe("ANY_PRINCIPAL")
    expect(row.severity).toBe("CRITICAL")
    expect(row.severitySource).toBe("console")
    expect(row.remedy).toContain("trust policy")
  })

  test("a Condition is stated on the row and never used to downgrade it", () => {
    const [plain] = exposuresFromWildcards([wildcard({ kind: "ADMIN", conditioned: false })])
    const [conditioned] = exposuresFromWildcards([wildcard({ kind: "ADMIN", conditioned: true })])
    expect(conditioned.severity).toBe(plain.severity)
    expect(conditioned.detail).toContain("does not remove the wildcard")
  })

  test("every wildcard kind has a severity and a remedy, and admin is the loudest", () => {
    for (const [kind, severity] of Object.entries(WILDCARD_SEVERITY)) {
      const [row] = exposuresFromWildcards([wildcard({ kind: kind as IamWildcard["kind"] })])
      expect([kind, row.severity]).toEqual([kind, severity])
      expect([kind, row.remedy.trim() !== ""]).toEqual([kind, true])
      // The fallback sentence, which every kind must have displaced with its own.
      expect([
        kind,
        row.remedy === "Narrow the statement to the actions and resources this principal uses.",
      ]).toEqual([kind, false])
    }
    expect(WILDCARD_SEVERITY.ADMIN).toBe("CRITICAL")
    expect(WILDCARD_SEVERITY.ANY_PRINCIPAL).toBe("CRITICAL")
  })

  test("a long-lived key carries the key id and a pasteable remedy, never a secret", () => {
    const [row] = exposuresFromKeys([accessKey({ userName: "ci", accessKeyId: "AKIAEXAMPLEEXAMPLE01" })])
    expect(row.type).toBe("Long-lived IAM access key")
    expect(row.resource).toBe("AKIAEXAMPLEEXAMPLE01")
    expect(row.remedy).toContain("aws iam update-access-key --user-name ci")
    expect(row.remedy).toContain("--status Inactive")
    expect(row.severitySource).toBe("console")
  })

  test("a key past a year is louder than a key past the threshold", () => {
    const [recent] = exposuresFromKeys([accessKey({ ageDays: KEY_SEVERE_DAYS - 1 })])
    const [ancient] = exposuresFromKeys([accessKey({ ageDays: KEY_SEVERE_DAYS })])
    expect(recent.severity).toBe("MEDIUM")
    expect(ancient.severity).toBe("HIGH")
  })

  test("every severity has a chip vocabulary the primitive accepts", () => {
    expect(Object.values(CHIP_SEVERITY).sort()).toEqual(
      ["critical", "high", "informational", "low", "medium"].sort(),
    )
  })
})

/* ──────────────────────────────────────────────────────── the verdict ───── */

describe("the verdict cannot print a clean bill of health over a gap", () => {
  const checkingRows = [
    control({ key: "a", question: "exposed" }),
    control({ key: "b", question: "unencrypted" }),
    control({ key: "c", question: "unrotated" }),
    control({ key: "d", question: "unwatched" }),
  ]

  test("nothing checking outranks everything, including an empty finding list", () => {
    const verdict = postureVerdict({
      controls: [control({ state: "NOT_CHECKING" }), control({ key: "b", state: "NOT_WIRED" })],
      exposures: [],
    })
    expect(verdict.verdict).toBe("Nothing is checking")
    expect(verdict.tone).toBe("bad")
    expect(verdict.headline).toContain("No control")
    expect(verdict.because).toContain("produces the same empty list")
  })

  test("a CRITICAL exposure outranks the coverage sentence but never replaces it", () => {
    const verdict = postureVerdict({
      controls: checkingRows,
      exposures: [exposure({ severity: "CRITICAL" })],
    })
    expect(verdict.verdict).toBe("Critical exposure")
    expect(verdict.tone).toBe("bad")
    expect(verdict.because).toContain("4 of 4 listed controls are checking")
  })

  test("an open exposure names the worst severity in it", () => {
    const verdict = postureVerdict({
      controls: checkingRows,
      exposures: [exposure({ key: "a", severity: "LOW" }), exposure({ key: "b", severity: "MEDIUM" })],
    })
    expect(verdict.verdict).toBe("Exposures open")
    expect(verdict.headline).toContain("MEDIUM")
    expect(verdict.because).toContain("cannot appear in this list at all")
  })

  test("THE RULE — nothing found, but a control switched off, is never Clear", () => {
    const verdict = postureVerdict({
      controls: [...checkingRows, control({ key: "off", state: "NOT_CHECKING" })],
      exposures: [],
    })
    expect(verdict.verdict).toBe("Partly answered")
    expect(verdict.verdict).not.toBe("Clear")
    expect(verdict.tone).not.toBe("ok")
    expect(verdict.because).toContain("not a clean bill of health")
  })

  test("THE RULE, once per gap state — each alone is enough to withhold Clear", () => {
    for (const state of CONTROL_STATES) {
      if (state === "CHECKING") continue
      const verdict = postureVerdict({
        controls: [...checkingRows, control({ key: "gap", state })],
        exposures: [],
      })
      expect([state, verdict.verdict]).toEqual([state, "Partly answered"])
      expect([state, verdict.tone]).toEqual([state, "warn"])
    }
  })

  test("Clear is reachable, and only when every control checked and nothing was found", () => {
    const verdict = postureVerdict({ controls: checkingRows, exposures: [] })
    expect(verdict.verdict).toBe("Clear")
    expect(verdict.tone).toBe("ok")
    expect(verdict.because).toContain("coverage rather than an absence of bad news")
  })

  test("a real estate cannot reach Clear today, because unwired controls are declared", () => {
    // Not a placeholder assertion: it is the reason `UNWIRED_CONTROLS` is a list
    // in the module rather than an omission. A page that listed only the
    // controls it has a reader for would print "Clear" the day a reader was
    // deleted.
    const verdict = postureVerdict({
      controls: controlsFor(controlsFromSources([source({ state: "AGGREGATED" })])),
      exposures: [],
    })
    expect(verdict.verdict).toBe("Partly answered")
  })

  test("every arm has a headline and a because, and neither is empty", () => {
    const cases = [
      { controls: [control({ state: "NOT_CHECKING" })], exposures: [] },
      { controls: checkingRows, exposures: [exposure({ severity: "CRITICAL" })] },
      { controls: checkingRows, exposures: [exposure({ severity: "LOW" })] },
      { controls: [...checkingRows, control({ key: "gap", state: "NOT_WIRED" })], exposures: [] },
      { controls: checkingRows, exposures: [] },
    ]
    for (const input of cases) {
      const verdict = postureVerdict(input)
      expect(verdict.headline.trim()).not.toBe("")
      expect(verdict.because.trim()).not.toBe("")
      expect(verdict.verdict.trim()).not.toBe("")
    }
  })
})

/* ─────────────────────────────────────────────── nothing renders as blank ── */

describe("no row on this page is a blank", () => {
  test("every control produced from a real surface has a remedy and a detail", () => {
    const rows = controlsFor([
      ...controlsFromSources([
        source({ product: "Security Hub", state: "NOT_ENABLED", detail: "Security Hub is not enabled in this account." }),
        source({ product: "Config", state: "UNKNOWN", detail: "not read — the aggregator call did not complete (THROTTLED)." }),
        source({ product: "Inspector", state: "AGGREGATED" }),
      ]),
      ...controlsFromIam("ACTUAL", posture()),
    ])
    for (const row of rows) {
      expect([row.key, row.detail.trim() !== ""]).toEqual([row.key, true])
      expect([row.key, row.remedy.trim() !== ""]).toEqual([row.key, true])
      expect([row.key, row.answers.trim() !== ""]).toEqual([row.key, true])
      expect([row.key, Boolean(CONTROL_WORDS[row.state])]).toEqual([row.key, true])
    }
  })

  test("a finding with no resource id keeps its row rather than being dropped", () => {
    const [row] = exposuresFromFindings([finding({ resourceIds: [] })], () => "shared")
    expect(row.resource).toBeNull()
    expect(row.type).not.toBe("")
  })
})
