import {
  BAND_SEVERITY,
  CONFIG_RECORDER_KEY,
  GUARDDUTY_CONFIGURATION_KEY,
  UNWIRED_CONTROLS,
  complianceBadge,
  controlsFor,
  controlsFromCompliance,
  controlsFromGuardDuty,
  covering,
  exposuresFromConfigRules,
  exposuresFromGuardDuty,
  gaps,
  guardDutyBadge,
  postureVerdict,
  rankExposures,
  type ComplianceSentences,
  type ControlRow,
  type Exposure,
} from "./posture"
import type { ComplianceReadings, ConfigRuleReading, RuleHealth } from "../../../lib/aws/compliance"
import type {
  DetectorConfiguration,
  GuardDutyCoverage,
  GuardDutyFinding,
  SeverityBand,
} from "../../../lib/aws/guardduty"
import type { Severity } from "../../../lib/aws/findings"
import type { AwsRead } from "../../../lib/aws/read"

/**
 * The two readers `/platform/security` was refuted for not having, and the
 * mapping that puts them on the page.
 *
 * `lib/aws/guardduty.ts` and `lib/aws/compliance.ts` were real, tested modules
 * with a capability and an IAM grant that **no page imported**. The work they did
 * reached no screen, which is the same reachability failure the services wave was
 * refuted for. This file covers the half that was missing: the pure mapping from
 * each reader's own answer to a row on this page.
 *
 * Every assertion below is the page's one rule, stated another way:
 *
 *   **an absence of findings from a control that is not running is not a pass.**
 *
 * Which here means, concretely, three things a naive page gets wrong:
 *
 *   * a GuardDuty detector this console cannot prove is RUNNING may never render
 *     as coverage, however many findings it returned — `guardduty:GetDetector`
 *     is not a capability this build holds, and `ListDetectors` lists a SUSPENDED
 *     detector identically to a live one;
 *   * a Config rule at `INSUFFICIENT_DATA` has evaluated nothing and reports no
 *     non-compliant resource, exactly like a rule that passed, so an estate of
 *     them is `NOT_CHECKING` rather than compliant; and
 *   * a verdict read over a configuration recorder nobody has looked at is
 *     conditional on an unread fact, so the recorder is its own row.
 *
 * None of this needs a browser, a server or an AWS account: everything under test
 * is a pure function of values a reader already returned, and the arms that
 * matter — a suspended detector, a refused rule listing, a truncated one — cannot
 * be reached from a browser pointed at a healthy estate at all.
 */

/* ────────────────────────────────────────────────────────── fixtures ────── */

const NOW = new Date("2026-08-14T12:00:00.000Z")

const unconfigured = <T,>(capability: AwsRead<T>["capability"]): AwsRead<T> => ({
  state: "UNCONFIGURED",
  capability,
  why: "not read in this fixture",
})

/** `guardDutyCoverage`'s own output shape, as the reader would return it. */
const coverage = (over: Partial<GuardDutyCoverage> = {}): GuardDutyCoverage => ({
  key: "guardduty::detectors",
  question: "unwatched",
  control: "GuardDuty detector state",
  state: "NOT_CHECKING",
  answers: "whether a detector exists in this region and what it has found",
  detail: "guardduty:ListDetectors answered, and there is NO detector in this region.",
  remedy: "Enable a GuardDuty detector in this region.",
  action: "guardduty:ListDetectors",
  ...over,
})

/**
 * The reader's own `DETECTOR_CONFIGURATION_NOT_READABLE`, restated here.
 *
 * Restated rather than imported because importing it would pull `guardduty.ts`,
 * and with it `client.ts` and the SDK, into a suite whose whole value is that it
 * runs with no AWS anywhere in its module graph. The production page passes the
 * real constant; this fixture keeps its shape and its seven unknowns.
 */
const configuration: DetectorConfiguration = {
  state: "NOT_READABLE",
  needs: "guardduty:GetDetector",
  iamAction: "guardduty:GetDetector",
  unknown: [
    "whether the detector is ENABLED or SUSPENDED — ListDetectors lists a suspended detector identically",
    "the finding publishing frequency (FIFTEEN_MINUTES / ONE_HOUR / SIX_HOURS)",
    "whether S3 Protection is on",
    "whether EKS Protection (audit logs and runtime monitoring) is on",
    "whether Malware Protection for EC2 and for S3 is on",
    "whether RDS Protection (login-event monitoring) is on",
    "whether Lambda Protection (network activity monitoring) is on",
  ],
  why: "a detector's status, publishing frequency, data sources and protection plans are returned by guardduty:GetDetector, and that capability is not in this engine's registry.",
}

const gdFinding = (over: Partial<GuardDutyFinding> = {}): GuardDutyFinding => ({
  id: "f-1",
  arn: "arn:aws:guardduty:eu-west-2:123456789012:detector/d-1/finding/f-1",
  detectorId: "d-1",
  type: "UnauthorizedAccess:EC2/SSHBruteForce",
  title: "SSH brute force attacks against i-1",
  description: "…",
  severity: 8,
  band: "HIGH",
  accountId: "123456789012",
  region: "eu-west-2",
  partition: "aws",
  resource: {
    resourceType: "Instance",
    arn: "arn:aws:ec2:eu-west-2:123456789012:instance/i-1",
    identifier: "i-1",
    provenance: "the finding's own resource block",
  },
  firstSeen: "2026-08-13T12:00:00.000Z",
  lastSeen: "2026-08-14T11:00:00.000Z",
  createdAt: "2026-08-13T12:00:00.000Z",
  updatedAt: "2026-08-14T11:00:00.000Z",
  occurrences: 4,
  archived: false,
  serviceName: "guardduty",
  featureName: null,
  attribution: { kind: "tenant", tenantSlug: "seed-deployed" },
  ...over,
})

const SLA: Readonly<Record<Severity, number>> = {
  CRITICAL: 24,
  HIGH: 72,
  MEDIUM: 168,
  LOW: 720,
  INFORMATIONAL: Number.POSITIVE_INFINITY,
}

const recorder = {
  kind: "not-readable" as const,
  why: "whether the configuration recorder is running, and whether it records all supported resource types or a named subset, is answered by config:DescribeConfigurationRecorders and config:DescribeConfigurationRecorderStatus.",
  neededCapabilities: [
    "config:DescribeConfigurationRecorders",
    "config:DescribeConfigurationRecorderStatus",
  ],
  neededIamActions: [
    "config:DescribeConfigurationRecorders",
    "config:DescribeConfigurationRecorderStatus",
  ],
}

const rule = (over: Partial<ConfigRuleReading> = {}): ConfigRuleReading => ({
  name: "s3-bucket-server-side-encryption-enabled",
  arn: "arn:aws:config:eu-west-2:123456789012:config-rule/config-rule-abcdef",
  region: "eu-west-2",
  partition: "aws",
  accountId: "123456789012",
  description: null,
  ruleState: "ACTIVE",
  owner: "AWS",
  sourceIdentifier: "S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED",
  maximumExecutionFrequency: null,
  scope: { kind: "all-supported-types" },
  evaluationModes: ["DETECTIVE"],
  compliance: unconfigured("config:DescribeComplianceByConfigRule"),
  health: { kind: "passing" },
  attribution: { kind: "shared" },
  refreshMs: 300_000,
  asOf: NOW.toISOString(),
  ...over,
})

const readings = (over: Partial<ComplianceReadings> = {}): ComplianceReadings => ({
  identity: unconfigured("sts:GetCallerIdentity"),
  tagged: unconfigured("tag:GetResources"),
  rules: {
    state: "ACTUAL",
    capability: "config:DescribeConfigRules",
    value: [rule()],
    asOf: NOW.toISOString(),
    fresh: true,
  },
  enablement: {
    kind: "rules-present",
    ruleCount: 1,
    liveRuleCount: 1,
    recorder,
    why: "1 Config rule(s) exist, 1 of them live.",
  },
  health: { kind: "compliant", passing: ["s3-bucket-server-side-encryption-enabled"], notApplicable: [], unreadable: [] },
  aggregation: unconfigured("config:DescribeConfigurationAggregators"),
  truncation: { kind: "complete" },
  asOf: NOW.toISOString(),
  refreshMs: { rules: 300_000, compliance: 300_000, aggregators: 900_000 },
  ...over,
})

const sentences: ComplianceSentences = {
  enablement: "1 Config rule(s) exist, 1 of them live.",
  health: "compliant — 1 rule(s) evaluated and passed.",
  recorder: `RECORDER UNKNOWN — ${recorder.why}`,
  truncation: "complete — every Config rule in this account was listed",
}

const describeRule = (reading: ConfigRuleReading) => `${reading.name} — ${reading.health.kind}`

const rowFor = (rows: readonly ControlRow[], key: string): ControlRow => {
  const found = rows.find((row) => row.key === key)
  if (!found) throw new Error(`no control row keyed ${key}`)
  return found
}

/* ─────────────── GuardDuty: a detector that exists is not a detector running ─ */

describe("GuardDuty reaches the page as coverage, and never as a reassurance", () => {
  test("the reader's row displaces its own placeholder rather than doubling it", () => {
    const rows = controlsFor([...controlsFromGuardDuty(coverage(), configuration)])
    expect(rows.filter((row) => row.key === "guardduty::detectors")).toHaveLength(1)
    expect(rowFor(rows, "guardduty::detectors").state).toBe("NOT_CHECKING")
    expect(rowFor(rows, "guardduty::detectors").detail).toContain("NO detector in this region")
    // The placeholder is gone and one genuinely new row — the configuration
    // question, which `UNWIRED_CONTROLS` never declared — has arrived.
    expect(rows.length).toBe(UNWIRED_CONTROLS.length + 1)
  })

  test("detectors present is PARTIAL at best — a listed detector may be SUSPENDED", () => {
    const rows = controlsFromGuardDuty(
      coverage({
        state: "PARTIAL",
        detail: "2 detector(s) exist and 7 finding(s) were read, but a detector exists, and whether it is ENABLED or SUSPENDED was NOT verified",
      }),
      configuration,
    )
    const detectorRow = rowFor(rows, "guardduty::detectors")
    // The one thing this row may never be while `guardduty:GetDetector` is
    // outside the registry.
    expect(detectorRow.state).not.toBe("CHECKING")
    expect(covering(rows)).toHaveLength(0)
    expect(gaps(rows)).toHaveLength(2)
  })

  test("every protection plan is named individually, not summarised", () => {
    const row = rowFor(controlsFromGuardDuty(coverage(), configuration), GUARDDUTY_CONFIGURATION_KEY)
    for (const plan of ["S3 Protection", "EKS Protection", "Malware Protection", "RDS Protection", "Lambda Protection"]) {
      expect([plan, row.answers.includes(plan)]).toEqual([plan, true])
    }
    // And the status question itself, which is the one that decides whether any
    // finding count on this page means anything.
    expect(row.answers).toContain("ENABLED or SUSPENDED")
  })

  test("the configuration row is NOT_WIRED, and carries a pasteable grant for an action no registry holds", () => {
    const row = rowFor(controlsFromGuardDuty(coverage(), configuration), GUARDDUTY_CONFIGURATION_KEY)
    // NOT_WIRED, not NOT_CHECKING: this is a fact about this console, and the
    // remedy is a capability, not a detector.
    expect(row.state).toBe("NOT_WIRED")
    expect(row.action).toBe("guardduty:GetDetector")
    const statement = JSON.parse(row.minimumStatement ?? "{}")
    expect(statement.Statement[0].Effect).toBe("Allow")
    expect(statement.Statement[0].Action).toContain("guardduty:GetDetector")
  })

  test("a refused detector listing carries the listing's own action and statement", () => {
    const row = rowFor(
      controlsFromGuardDuty(
        coverage({
          state: "UNREADABLE",
          detail: "guardduty:ListDetectors was refused",
          action: "guardduty:ListDetectors",
          minimumStatement: '{"Effect":"Allow","Action":["guardduty:ListDetectors"]}',
        }),
        configuration,
      ),
      "guardduty::detectors",
    )
    expect(row.state).toBe("UNREADABLE")
    expect(row.minimumStatement).toContain("guardduty:ListDetectors")
  })

  test("no arm of the GuardDuty summary is ever the reassuring tone", () => {
    for (const kind of ["unknown", "not-enabled", "detectors-present"] as const) {
      const badge = guardDutyBadge({ kind })
      expect([kind, badge.tone]).not.toEqual([kind, "ok"])
      expect([kind, badge.word.trim() !== ""]).toEqual([kind, true])
    }
  })
})

/* ─────────── Config: INSUFFICIENT_DATA is a hole, and the recorder is unread ─ */

describe("AWS Config reaches the page, and an unevaluated rule is never a pass", () => {
  test("rules that all returned INSUFFICIENT_DATA are NOT_CHECKING, not compliant", () => {
    const rows = controlsFromCompliance(
      readings({
        health: {
          kind: "nothing-evaluated",
          notEvaluated: ["rule-a", "rule-b"],
          unreadable: [],
          why: "2 rule(s) exist and every one of them returned INSUFFICIENT_DATA.",
        },
      }),
      sentences,
    )
    const row = rowFor(rows, "config::rule-compliance")
    // Zero rules said NON_COMPLIANT. A page counting failures would print green.
    expect(row.state).toBe("NOT_CHECKING")
    expect(covering(rows)).toHaveLength(0)
    expect(row.remedy).toContain("unplugged smoke alarm")
  })

  test("compliant plus one unreadable verdict is PARTIAL — never the passing arm", () => {
    const rows = controlsFromCompliance(
      readings({
        health: { kind: "compliant", passing: ["a"], notApplicable: [], unreadable: ["b"] },
      }),
      sentences,
    )
    expect(rowFor(rows, "config::rule-compliance").state).toBe("PARTIAL")
  })

  test("a truncated listing is PARTIAL however good the verdicts were", () => {
    const rows = controlsFromCompliance(
      readings({
        truncation: { kind: "more-available", returned: 500, reason: "the rule cap", nextToken: "t" },
      }),
      sentences,
    )
    expect(rowFor(rows, "config::rule-compliance").state).toBe("PARTIAL")
  })

  test("CHECKING is reachable, and only when every rule evaluated, passed and was listed", () => {
    const rows = controlsFromCompliance(readings(), sentences)
    expect(rowFor(rows, "config::rule-compliance").state).toBe("CHECKING")
    // …and the recorder row is still a gap, so the page as a whole is not clean.
    expect(gaps(rows).map((row) => row.key)).toEqual([CONFIG_RECORDER_KEY])
  })

  test("a refused rule listing is UNREADABLE and names the listing's own action", () => {
    const rows = controlsFromCompliance(
      readings({
        rules: {
          state: "DENIED",
          capability: "config:DescribeConfigRules",
          action: "config:DescribeConfigRules",
          principal: "arn:aws:iam::123456789012:role/studio",
          accountId: "123456789012",
          region: "eu-west-2",
          partition: "aws",
          errorCode: "AccessDeniedException",
          minimumStatement: '{"Action":["config:DescribeConfigRules"]}',
        },
        health: { kind: "unknown", why: "the Config rule listing was refused" },
        enablement: { kind: "unknown", why: "refused", recorder },
      }),
      sentences,
    )
    const row = rowFor(rows, "config::rule-compliance")
    expect(row.state).toBe("UNREADABLE")
    // The action that actually failed — not the verdict action, which the role
    // may well already hold.
    expect(row.action).toBe("config:DescribeConfigRules")
    expect(row.minimumStatement).toContain("config:DescribeConfigRules")
  })

  test("a successful listing with no rules is NOT_CHECKING — an estate nothing evaluates", () => {
    const rows = controlsFromCompliance(
      readings({
        rules: { state: "EMPTY", capability: "config:DescribeConfigRules", asOf: NOW.toISOString() },
        health: { kind: "no-rules", why: "no rules at all" },
        enablement: { kind: "not-evaluating", why: "no rules", remedy: "enable AWS Config", recorder },
      }),
      sentences,
    )
    expect(rowFor(rows, "config::rule-compliance").state).toBe("NOT_CHECKING")
  })

  test("the recorder is its own row on every arm, and names both actions that would answer it", () => {
    for (const health of [
      { kind: "compliant", passing: ["a"], notApplicable: [], unreadable: [] },
      { kind: "no-rules", why: "none" },
      { kind: "unknown", why: "refused" },
    ] as ComplianceReadings["health"][]) {
      const rows = controlsFromCompliance(readings({ health }), sentences)
      const row = rowFor(rows, CONFIG_RECORDER_KEY)
      expect([health.kind, row.state]).toEqual([health.kind, "NOT_WIRED"])
      expect([health.kind, row.detail]).toEqual([health.kind, sentences.recorder])
      for (const action of recorder.neededIamActions) {
        expect([health.kind, action, row.minimumStatement?.includes(action)]).toEqual([
          health.kind,
          action,
          true,
        ])
      }
    }
  })

  test("a clean Config summary is uncomputable while anything is unread or unevaluated", () => {
    const clean = complianceBadge(
      { kind: "compliant", passing: ["a"], notApplicable: [], unreadable: [] },
      { kind: "complete" },
    )
    expect(clean).toEqual({ word: "Compliant", tone: "ok" })

    // Each of these three, alone, is enough to withhold it.
    const withUnreadable = complianceBadge(
      { kind: "compliant", passing: ["a"], notApplicable: [], unreadable: ["b"] },
      { kind: "complete" },
    )
    const withNotApplicable = complianceBadge(
      { kind: "compliant", passing: ["a"], notApplicable: ["b"], unreadable: [] },
      { kind: "complete" },
    )
    const truncated = complianceBadge(
      { kind: "compliant", passing: ["a"], notApplicable: [], unreadable: [] },
      { kind: "more-available", returned: 500, reason: "cap", nextToken: null },
    )
    for (const badge of [withUnreadable, withNotApplicable, truncated]) {
      expect(badge.tone).toBe("warn")
      expect(badge.word).toBe("Compliant in part")
    }

    // And the arm this reader exists for is never quiet.
    expect(
      complianceBadge(
        { kind: "nothing-evaluated", notEvaluated: ["a"], unreadable: [], why: "…" },
        { kind: "complete" },
      ),
    ).toEqual({ word: "Nothing evaluated", tone: "bad" })
  })
})

/* ─────────────────────────── what the two readers actually found, as rows ── */

describe("a finding keeps its source's own words, and an unstated severity is not a low one", () => {
  test("the GuardDuty finding type is verbatim, never the title and never a paraphrase", () => {
    const [row] = exposuresFromGuardDuty([gdFinding()], {
      describeAttribution: (finding) => `tenant ${finding.attribution.kind}`,
      slaHours: SLA,
      now: NOW,
    })
    expect(row.type).toBe("UnauthorizedAccess:EC2/SSHBruteForce")
    expect(row.severity).toBe("HIGH")
    expect(row.severitySource).toBe("product")
    expect(row.source).toBe("GuardDuty detector d-1")
    expect(row.resource).toBe("arn:aws:ec2:eu-west-2:123456789012:instance/i-1")
    // 24 hours since `firstSeen`, measured against the reader's own `asOf`.
    expect(row.ageHours).toBe(24)
    expect(row.pastSla).toBe(false)
    expect(row.remedy).toContain("UnauthorizedAccess:EC2/SSHBruteForce")
  })

  test("past its allowance is measured, not assumed", () => {
    const [row] = exposuresFromGuardDuty(
      [gdFinding({ firstSeen: "2026-08-10T12:00:00.000Z" })],
      { describeAttribution: () => "shared", slaHours: SLA, now: NOW },
    )
    // 96h against HIGH's 72h.
    expect(row.ageHours).toBe(96)
    expect(row.pastSla).toBe(true)
  })

  test("an UNRANKED band becomes UNSTATED, and outranks an open CRITICAL in the table", () => {
    const [unranked] = exposuresFromGuardDuty(
      [gdFinding({ id: "f-2", band: "UNRANKED", severity: null })],
      { describeAttribution: () => "shared", slaHours: SLA, now: NOW },
    )
    expect(unranked.severity).toBe("UNSTATED")
    expect(unranked.severitySource).toBe("unstated")
    expect(unranked.pastSla).toBe(false)
    expect(unranked.detail).toContain("no usable severity")

    const ordered = rankExposures([
      {
        key: "crit",
        severity: "CRITICAL",
        severitySource: "product",
        type: "Backdoor:EC2/C&CActivity.B",
        detail: "…",
        resource: null,
        source: "GuardDuty",
        ageHours: 1,
        pastSla: false,
        remedy: "…",
      },
      unranked,
    ])
    // The reader ranks UNRANKED first, above CRITICAL, and this page must not
    // disagree with it — a finding nobody has ranked is one somebody must read.
    expect(ordered.map((row) => row.key)).toEqual([unranked.key, "crit"])
  })

  test("every band maps to something, and only UNRANKED loses its rank", () => {
    const bands: readonly SeverityBand[] = [
      "UNRANKED",
      "CRITICAL",
      "HIGH",
      "MEDIUM",
      "LOW",
      "INFORMATIONAL",
    ]
    for (const band of bands) {
      const mapped = BAND_SEVERITY[band]
      expect([band, mapped === "UNSTATED"]).toEqual([band, band === "UNRANKED"])
    }
  })

  test("only a FAILING Config rule is something that was found", () => {
    const healths: readonly RuleHealth[] = [
      { kind: "failing", nonCompliantResources: 3, countCapped: false },
      { kind: "not-evaluated", why: "INSUFFICIENT_DATA" },
      { kind: "passing" },
      { kind: "not-applicable", why: "nothing in scope" },
      { kind: "unreadable", why: "refused" },
    ]
    const rows = exposuresFromConfigRules(
      healths.map((health, index) => rule({ name: `rule-${index}`, health })),
      describeRule,
    )
    // One row, from the one failing rule. An INSUFFICIENT_DATA rule is a hole and
    // belongs to the control table, never to the list of things that were found.
    expect(rows.map((row) => row.source)).toEqual(["AWS Config rule rule-0"])
  })

  test("a failing rule carries AWS's own rule identifier and no invented severity", () => {
    const [row] = exposuresFromConfigRules(
      [rule({ health: { kind: "failing", nonCompliantResources: 3, countCapped: true } })],
      describeRule,
    )
    expect(row.type).toBe("S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED")
    // Config returns a verdict and a contributor count and NO severity. This
    // console does not supply one.
    expect(row.severity).toBe("UNSTATED")
    expect(row.severitySource).toBe("unstated")
    expect(row.remedy).toContain("config:GetComplianceDetailsByConfigRule")
  })

  test("the invariant: no row carries a severity of UNSTATED under any other source", () => {
    const rows: readonly Exposure[] = [
      ...exposuresFromGuardDuty(
        [gdFinding(), gdFinding({ id: "f-2", band: "UNRANKED", severity: null })],
        { describeAttribution: () => "shared", slaHours: SLA, now: NOW },
      ),
      ...exposuresFromConfigRules(
        [rule({ health: { kind: "failing", nonCompliantResources: 1, countCapped: false } })],
        describeRule,
      ),
    ]
    for (const row of rows) {
      expect([row.key, row.severity === "UNSTATED"]).toEqual([
        row.key,
        row.severitySource === "unstated",
      ])
    }
  })
})

/* ──────────────────────────────────── and the verdict over all of it ────── */

describe("the page verdict absorbs both readers without going quiet", () => {
  const checking: readonly ControlRow[] = [
    { key: "a", question: "exposed", control: "x", state: "CHECKING", answers: "…", detail: "…", remedy: "…" },
    { key: "b", question: "unencrypted", control: "y", state: "CHECKING", answers: "…", detail: "…", remedy: "…" },
  ]

  const unstated: Exposure = {
    key: "guardduty::d-1::f-2",
    severity: "UNSTATED",
    severitySource: "unstated",
    type: "UnauthorizedAccess:EC2/SSHBruteForce",
    detail: "…",
    resource: null,
    source: "GuardDuty detector d-1",
    ageHours: null,
    pastSla: false,
    remedy: "…",
  }

  test("an exposure nobody ranked is loud, and is never summarised as informational", () => {
    const verdict = postureVerdict({ controls: checking, exposures: [unstated] })
    expect(verdict.verdict).toBe("Exposures open")
    expect(verdict.tone).toBe("bad")
    expect(verdict.headline).toContain("no severity from its source")
  })

  test("a CRITICAL still wins the headline, and the unranked row is named under it", () => {
    const verdict = postureVerdict({
      controls: checking,
      exposures: [
        unstated,
        { ...unstated, key: "crit", severity: "CRITICAL", severitySource: "product" },
      ],
    })
    expect(verdict.verdict).toBe("Critical exposure")
    expect(verdict.headline).toContain("1 CRITICAL")
    expect(verdict.headline).toContain("no severity from its source")
  })

  test("Clear stays unreachable once either reader has contributed a gap", () => {
    const withGuardDuty = postureVerdict({
      controls: [...checking, ...controlsFromGuardDuty(coverage(), configuration)],
      exposures: [],
    })
    const withConfig = postureVerdict({
      controls: [...checking, ...controlsFromCompliance(readings(), sentences)],
      exposures: [],
    })
    for (const verdict of [withGuardDuty, withConfig]) {
      expect(verdict.verdict).not.toBe("Clear")
      expect(verdict.tone).not.toBe("ok")
    }
  })
})
