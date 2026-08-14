import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  COMPLIANCE_BATCH_SIZE,
  MAX_COMPLIANCE_RULES,
  MAX_RULES,
  MAX_RULE_PAGES,
  RECORDER_CAPABILITY_GAP,
  complianceLines,
  complianceReadings,
  describeVerdict,
  type ComplianceReadings,
} from "./compliance"

/**
 * STUDIO-070-006 (AWS Config) — the compliance surface tells four AWS answers
 * apart, tells "we were refused" apart from "there are no rules", and never
 * reports a rule that has evaluated nothing as passing.
 *
 * The assertions are on `complianceReadings` and `complianceLines` — the
 * functions a surface renders — rather than on `readAws` or on a parser. A test
 * that drove a private helper would stay green on the day this module stopped
 * calling it, which is the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers five capabilities with the shapes the real SDK returns —
 * `{ConfigRules, NextToken}` from DescribeConfigRules,
 * `{ComplianceByConfigRules, NextToken}` from DescribeComplianceByConfigRule,
 * `{ConfigurationAggregators}` from DescribeConfigurationAggregators,
 * `{ResourceTagMappingList}` from the Tagging API and `{Account, Arn}` from STS
 * — and each can fail INDEPENDENTLY with `AccessDeniedException`,
 * `ThrottlingException`, an empty-but-successful answer, or a populated one. A
 * stand-in that returned `[]` regardless of what was asked would prove nothing
 * about code whose entire job is telling those four apart, and it is the fake
 * this repository has already been burnt by.
 *
 * The fake also honours `ConfigRuleNames`, so a batch that asks for 25 names
 * gets 25 answers and a rule the fixture does not carry gets none — which is how
 * the "AWS answered without answering" path is reached without hand-building the
 * result.
 *
 * ## Every identifier here is obviously constructed
 *
 * The account is `123456789012` — the documentation placeholder — and no ARN,
 * rule name or Lambda in this file names a real resource. Nothing in this suite
 * opens a socket, and nothing here is an approval, a verification date or a
 * sign-off.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
/** A second region, so a rule whose ARN disagrees with the caller can be caught. */
const OTHER_REGION = "us-east-1"

function ruleArn(name: string, region: string = REGION): string {
  return `arn:aws:config:${region}:${ACCOUNT}:config-rule/config-rule-${name}`
}

const PASSING = "encrypted-volumes"
const FAILING = "rds-storage-encrypted"
const INERT = "s3-bucket-public-read-prohibited"
const INAPPLICABLE = "iam-user-mfa-enabled"
const DYING = "tenure-legacy-tag-check"

const AT = () => new Date("2026-08-13T09:15:00.000Z")

/** The DescribeConfigRules shape AWS returns. */
function configRule(
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ConfigRuleName: name,
    ConfigRuleArn: ruleArn(name),
    ConfigRuleId: `config-rule-${name}`,
    ConfigRuleState: "ACTIVE",
    Description: `managed rule ${name}`,
    Source: { Owner: "AWS", SourceIdentifier: name.toUpperCase().replace(/-/g, "_") },
    EvaluationModes: [{ Mode: "DETECTIVE" }],
    ...overrides,
  }
}

/** The five rules this suite reasons about. Four verdicts and one being deleted. */
function estateRules(): Record<string, unknown>[] {
  return [
    configRule(PASSING),
    configRule(FAILING, {
      Scope: { ComplianceResourceTypes: ["AWS::RDS::DBInstance"] },
      MaximumExecutionFrequency: "TwentyFour_Hours",
    }),
    configRule(INERT),
    configRule(INAPPLICABLE),
    configRule(DYING, { ConfigRuleState: "DELETING" }),
  ]
}

/** The compliance entries AWS returns for them. */
function estateCompliance(): Record<string, Record<string, unknown>> {
  return {
    [PASSING]: { ComplianceType: "COMPLIANT" },
    [FAILING]: {
      ComplianceType: "NON_COMPLIANT",
      ComplianceContributorCount: { CappedCount: 3, CapExceeded: false },
    },
    [INERT]: { ComplianceType: "INSUFFICIENT_DATA" },
    [INAPPLICABLE]: { ComplianceType: "NOT_APPLICABLE" },
    // Deleted rules keep answering with their last verdict. That is the trap.
    [DYING]: { ComplianceType: "COMPLIANT" },
  }
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  /** How `config:DescribeConfigRules` behaves. The four cases this suite separates. */
  describeRules?: Outcome
  /** Pages returned in order; the fake follows its own NextToken between them. */
  rulePages?: Array<{ ConfigRules: Record<string, unknown>[]; NextToken?: string }>
  rules?: Record<string, unknown>[]
  /** How `config:DescribeComplianceByConfigRule` behaves, independently. */
  describeCompliance?: Outcome
  compliance?: Record<string, Record<string, unknown>>
  aggregators?: Outcome
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
  /** Every input the fake was handed, so a test can assert what was SENT. */
  inputs?: Record<string, unknown>[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function fakeAws(options: FakeOptions = {}): AwsGateway {
  const rulesOutcome = options.describeRules ?? "populated"
  const complianceOutcome = options.describeCompliance ?? "populated"
  const rules = options.rules ?? estateRules()
  const compliance = options.compliance ?? estateCompliance()
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []
  const inputs = options.inputs ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
      if (input) inputs.push({ capability: String(capability), ...input })

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

        case "config:DescribeConfigurationAggregators": {
          const outcome = options.aggregators ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          // The real API returns the key with an empty list when there are none.
          if (outcome === "empty") return { ConfigurationAggregators: [] }
          return {
            ConfigurationAggregators: [
              {
                ConfigurationAggregatorName: "tenure-org-aggregator",
                ConfigurationAggregatorArn: `arn:aws:config:${REGION}:${ACCOUNT}:config-aggregator/config-aggregator-abcdef`,
                OrganizationAggregationSource: {
                  RoleArn: `arn:aws:iam::${ACCOUNT}:role/tenure-config-aggregator`,
                  AllAwsRegions: true,
                },
              },
            ],
          }
        }

        case "config:DescribeConfigRules": {
          if (rulesOutcome === "denied") throwing("AccessDeniedException")
          if (rulesOutcome === "throttled") throwing("ThrottlingException")
          // The real API returns `ConfigRules: []` for an account where Config
          // was never set up. It does NOT raise.
          if (rulesOutcome === "empty") return { ConfigRules: [] }
          const pages = options.rulePages ?? [{ ConfigRules: rules }]
          const token = (input as { NextToken?: unknown } | undefined)?.NextToken
          const index =
            typeof token === "string" ? pages.findIndex((p, i) => i > 0 && pageToken(i) === token) : 0
          const page = pages[index === -1 ? 0 : index]
          return { ConfigRules: page.ConfigRules, NextToken: page.NextToken }
        }

        case "config:DescribeComplianceByConfigRule": {
          if (complianceOutcome === "denied") throwing("AccessDeniedException")
          if (complianceOutcome === "throttled") throwing("ThrottlingException")
          // A successful call that carries nothing. Config returns this shape
          // for a batch it has no evaluation state for at all.
          if (complianceOutcome === "empty") return { ComplianceByConfigRules: [] }
          const asked = ((input as { ConfigRuleNames?: unknown } | undefined)?.ConfigRuleNames ??
            []) as string[]
          // 25 is the API's own documented limit, written as a literal on
          // purpose. Comparing against the module's `COMPLIANCE_BATCH_SIZE`
          // would make this fake agree with the module by construction, so
          // raising the constant would raise the fake's tolerance with it and
          // the check would prove nothing.
          if (asked.length > 25) throwing("InvalidParameterValueException")
          return {
            ComplianceByConfigRules: asked
              .filter((name) => compliance[name] !== undefined)
              .map((name) => ({ ConfigRuleName: name, Compliance: compliance[name] })),
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

function pageToken(index: number): string {
  return `rules-page-${index}`
}

async function load(options: FakeOptions = {}): Promise<ComplianceReadings> {
  return complianceReadings(fakeAws(options), { now: AT })
}

/** The whole rendered surface as one string, so "says something different" is testable. */
function rendered(readings: ComplianceReadings): string {
  return complianceLines(readings)
    .map((l) => `${l.label}: ${l.text}`)
    .join("\n")
}

function lineFor(readings: ComplianceReadings, label: string): string {
  const line = complianceLines(readings).find((l) => l.label === label)
  if (!line) throw new Error(`no line labelled ${label} — lines: ${complianceLines(readings).map((l) => l.label).join(", ")}`)
  return line.text
}

beforeEach(() => {
  __resetIdentity()
})

/* ================================================================ the four -- */

describe("the four cases a Config read can produce say four different things", () => {
  /**
   * The whole point of `AwsRead`. These four loads are the same code against
   * four AWS behaviours, and no two of them may render the same sentence.
   */
  it("renders DENIED, THROTTLED, EMPTY and populated as four distinct surfaces", async () => {
    const denied = rendered(await load({ describeRules: "denied" }))
    const throttled = rendered(await load({ describeRules: "throttled" }))
    const empty = rendered(await load({ describeRules: "empty" }))
    const populated = rendered(await load())

    const all = [denied, throttled, empty, populated]
    expect(new Set(all).size).toBe(4)

    // And each says the RIGHT thing, not merely a different thing.
    expect(denied).toContain("config:DescribeConfigRules")
    expect(denied).toContain("AccessDeniedException")
    expect(denied).toContain('"Action":["config:DescribeConfigRules"]')
    expect(denied).not.toContain("NO RULES")
    expect(denied).not.toMatch(/\bcompliant —/)

    expect(throttled).toContain("throttled")
    expect(throttled).toContain("retrying in")
    expect(throttled).not.toContain("NO RULES")

    expect(empty).toContain("NOT EVALUATING")
    expect(empty).toContain("NO RULES")
    expect(empty).toContain("Remedy:")
    expect(empty).not.toContain("AccessDeniedException")

    expect(populated).toContain("NON-COMPLIANT")
    expect(populated).toContain(FAILING)
  })

  it("a denied listing is UNKNOWN carrying principal, action and a pasteable statement", async () => {
    const readings = await load({ describeRules: "denied" })
    expect(readings.rules.state).toBe("DENIED")
    if (readings.rules.state !== "DENIED") throw new Error("narrowing")

    expect(readings.rules.action).toBe("config:DescribeConfigRules")
    expect(readings.rules.principal).toBe(
      `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    )
    expect(readings.rules.accountId).toBe(ACCOUNT)
    expect(readings.rules.region).toBe(REGION)
    expect(readings.rules.partition).toBe("aws")
    expect(JSON.parse(readings.rules.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["config:DescribeConfigRules"],
      Resource: "*",
    })

    // Not an empty list, at every level that a surface could read.
    expect(readings.health.kind).toBe("unknown")
    expect(readings.enablement.kind).toBe("unknown")
    expect(describeOf(readings, "Config enablement")).toContain('NOT "no rules"')
  })

  it("a throttle is its own state — not a failure and not an empty result", async () => {
    const readings = await load({ describeRules: "throttled" })
    expect(readings.rules.state).toBe("THROTTLED")
    if (readings.rules.state !== "THROTTLED") throw new Error("narrowing")
    // `throttle.ts`'s schedule, not a literal: backoffMs(2) is 200, doubled twice.
    expect(readings.rules.retryAfterMs).toBe(800)
    expect(readings.health.kind).toBe("unknown")
    expect(readings.enablement.kind).toBe("unknown")
  })

  it("an empty-but-successful listing is a finding with a remedy, not a blank table", async () => {
    const readings = await load({ describeRules: "empty" })
    expect(readings.rules.state).toBe("EMPTY")
    expect(readings.health.kind).toBe("no-rules")
    expect(readings.enablement.kind).toBe("not-evaluating")
    if (readings.enablement.kind !== "not-evaluating") throw new Error("narrowing")
    expect(readings.enablement.remedy).toContain("configuration recorder")
    expect(readings.enablement.remedy).toContain("at least one rule")
  })

  it("a populated listing carries every rule with its own verdict", async () => {
    const readings = await load()
    expect(readings.rules.state).toBe("ACTUAL")
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.rules.value.map((r) => r.name).sort()).toEqual(
      [PASSING, FAILING, INERT, INAPPLICABLE, DYING].sort(),
    )
  })
})

function describeOf(readings: ComplianceReadings, label: string): string {
  return lineFor(readings, label)
}

/* ========================================================= the four verdicts -- */

describe("NOT_APPLICABLE, INSUFFICIENT_DATA, COMPLIANT and NON_COMPLIANT render differently", () => {
  it("gives each rule a visibly different health sentence", async () => {
    const readings = await load()
    const byName = new Map(complianceLines(readings).map((l) => [l.label, l.text]))

    const passing = byName.get(PASSING)!
    const failing = byName.get(FAILING)!
    const inert = byName.get(INERT)!
    const inapplicable = byName.get(INAPPLICABLE)!

    expect(new Set([passing, failing, inert, inapplicable]).size).toBe(4)

    expect(passing).toContain("COMPLIANT — evaluated, and every resource in scope passed")
    expect(failing).toContain("FAILING")
    expect(failing).toContain("3 non-compliant resource(s)")
    expect(inert).toContain("NOT EVALUATED")
    expect(inert).toContain("INSUFFICIENT_DATA")
    expect(inert).toContain("has evaluated nothing")
    expect(inapplicable).toContain("NOT APPLICABLE")
    expect(inapplicable).toContain("Not a pass")

    // The two that are NOT failures and are NOT passes must not read as passes.
    expect(inert).not.toContain("every resource in scope passed")
    expect(inapplicable).not.toContain("every resource in scope passed")
  })

  it("gives all five verdicts five distinct sentences, and only COMPLIANT reads as a pass", () => {
    // `describeVerdict` is exported for a surface to call directly, so it is
    // asserted directly. Going only through `describeRuleHealth` left three of
    // its five arms unreached, and an unreached renderer can say anything.
    const sentences = (
      ["COMPLIANT", "NON_COMPLIANT", "NOT_APPLICABLE", "INSUFFICIENT_DATA", "UNSTATED"] as const
    ).map((v) => describeVerdict(v))
    expect(new Set(sentences).size).toBe(5)

    expect(describeVerdict("COMPLIANT")).toContain("every resource in scope passed")
    expect(describeVerdict("NON_COMPLIANT")).toContain("resources are failing")
    expect(describeVerdict("NOT_APPLICABLE")).toContain("NOT_APPLICABLE")
    expect(describeVerdict("NOT_APPLICABLE")).toContain("Not a pass")
    expect(describeVerdict("INSUFFICIENT_DATA")).toContain("evaluated NOTHING")
    expect(describeVerdict("INSUFFICIENT_DATA")).toContain("Not a pass")
    expect(describeVerdict("UNSTATED")).toContain("no readable ComplianceType")

    // The three that are not passes must not borrow the pass's words.
    for (const v of ["NOT_APPLICABLE", "INSUFFICIENT_DATA", "UNSTATED"] as const) {
      expect(describeVerdict(v)).not.toContain("every resource in scope passed")
    }
  })

  it("INSUFFICIENT_DATA everywhere is NOTHING EVALUATED, never compliant", async () => {
    const readings = await load({
      rules: [configRule(PASSING), configRule(INERT)],
      compliance: {
        [PASSING]: { ComplianceType: "INSUFFICIENT_DATA" },
        [INERT]: { ComplianceType: "INSUFFICIENT_DATA" },
      },
    })
    expect(readings.health.kind).toBe("nothing-evaluated")
    const text = lineFor(readings, "Compliance")
    expect(text).toContain("NOTHING EVALUATED")
    expect(text).toContain("Not one has evaluated a resource")
    expect(text).not.toMatch(/^compliant/)
  })

  it("some passing and some inert is PARTLY EVALUATED, not a clean bill", async () => {
    const readings = await load({
      rules: [configRule(PASSING), configRule(INERT)],
      compliance: {
        [PASSING]: { ComplianceType: "COMPLIANT" },
        [INERT]: { ComplianceType: "INSUFFICIENT_DATA" },
      },
    })
    expect(readings.health.kind).toBe("partly-evaluated")
    expect(lineFor(readings, "Compliance")).toContain("PARTLY EVALUATED")
  })

  it("only COMPLIANT and NOT_APPLICABLE together reach the compliant arm", async () => {
    const readings = await load({
      rules: [configRule(PASSING), configRule(INAPPLICABLE)],
      compliance: {
        [PASSING]: { ComplianceType: "COMPLIANT" },
        [INAPPLICABLE]: { ComplianceType: "NOT_APPLICABLE" },
      },
    })
    expect(readings.health.kind).toBe("compliant")
    const text = lineFor(readings, "Compliance")
    expect(text).toContain("compliant — 1 rule(s) evaluated and passed")
    // …and it still says out loud that one of them checked nothing.
    expect(text).toContain("NOT_APPLICABLE and checked nothing")
  })

  it("a verdict AWS did not state is UNSTATED, never a default pass", async () => {
    const readings = await load({
      rules: [configRule(PASSING)],
      compliance: { [PASSING]: { ComplianceContributorCount: { CappedCount: 0 } } },
    })
    const text = lineFor(readings, PASSING)
    expect(text).toContain("VERDICT UNSTATED")
    expect(text).not.toContain("every resource in scope passed")
    expect(readings.health.kind).toBe("no-verdicts")
  })

  it("a capped contributor count is marked as a floor, not printed as a total", async () => {
    const readings = await load({
      rules: [configRule(FAILING)],
      compliance: {
        [FAILING]: {
          ComplianceType: "NON_COMPLIANT",
          ComplianceContributorCount: { CappedCount: 25, CapExceeded: true },
        },
      },
    })
    expect(lineFor(readings, FAILING)).toContain("count capped by AWS — this is a floor")
  })

  it("a rule being deleted reports INACTIVE, not the stale COMPLIANT it still returns", async () => {
    const readings = await load()
    const text = lineFor(readings, DYING)
    expect(text).toContain("INACTIVE")
    expect(text).toContain("DELETING")
    expect(text).toContain("going away")
    expect(text).not.toContain("every resource in scope passed")
  })
})

/* ================================================= independent degradation -- */

describe("a denied verdict read does not collapse the row, and does not read as a pass", () => {
  it("names DescribeComplianceByConfigRule — not the listing action — on every rule", async () => {
    const readings = await load({ describeCompliance: "denied" })

    // The listing still worked: the rules are all there.
    expect(readings.rules.state).toBe("ACTUAL")
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.rules.value).toHaveLength(5)

    for (const rule of readings.rules.value) {
      expect(rule.compliance.state).toBe("DENIED")
      if (rule.compliance.state !== "DENIED") throw new Error("narrowing")
      expect(rule.compliance.action).toBe("config:DescribeComplianceByConfigRule")
      expect(JSON.parse(rule.compliance.minimumStatement).Action).toEqual([
        "config:DescribeComplianceByConfigRule",
      ])
      expect(rule.health.kind).toBe("unreadable")
    }

    const text = rendered(readings)
    expect(text).toContain("VERDICT UNREADABLE")
    expect(text).toContain("config:DescribeComplianceByConfigRule")
    // The estate answer is unknown, and it is NOT the reassuring default.
    expect(readings.health.kind).toBe("no-verdicts")
    expect(lineFor(readings, "Compliance")).toContain("unknown")
  })

  it("the four verdict-read cases are four different surfaces too", async () => {
    const denied = rendered(await load({ describeCompliance: "denied" }))
    const throttled = rendered(await load({ describeCompliance: "throttled" }))
    const empty = rendered(await load({ describeCompliance: "empty" }))
    const populated = rendered(await load())
    expect(new Set([denied, throttled, empty, populated]).size).toBe(4)

    expect(throttled).toContain("AWS rate-limited config:DescribeComplianceByConfigRule")
    // An empty-but-successful batch is a call that answered without answering.
    expect(empty).toContain("NoComplianceReturned")
    expect(empty).toContain("No verdict is inferred from silence")
  })

  it("a denied tag index does not make a rule read as unattributed", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    expect(readings.rules.state).toBe("ACTUAL")
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")
    for (const rule of readings.rules.value) {
      expect(rule.attribution.kind).toBe("unknown")
    }
    const text = rendered(readings)
    expect(text).toContain("attribution unknown")
    expect(text).not.toContain("unattributable — missing tenure:tenant")
    // …and the compliance verdicts are unaffected: one denial, one degradation.
    expect(readings.health.kind).toBe("non-compliant")
  })

  it("a denied aggregator read does not touch the rules or the verdicts", async () => {
    const readings = await load({ aggregators: "denied" })
    expect(readings.aggregation.state).toBe("DENIED")
    expect(readings.rules.state).toBe("ACTUAL")
    expect(readings.health.kind).toBe("non-compliant")
    expect(lineFor(readings, "Aggregation")).toContain("config:DescribeConfigurationAggregators")
  })

  it("an aggregator that exists is not evidence that anything is evaluated", async () => {
    const readings = await load({ describeRules: "empty" })
    expect(readings.aggregation.state).toBe("ACTUAL")
    expect(lineFor(readings, "Aggregation")).toContain("organization-wide")
    // …and the compliance answer is still that nothing is being checked.
    expect(lineFor(readings, "Compliance")).toContain("NO RULES")
    expect(lineFor(readings, "Config enablement")).toContain("NOT EVALUATING")
  })
})

/* =========================================================== the recorder -- */

describe("the recorder question is answered as UNKNOWN with the exact remedy", () => {
  it("never claims recording is on, and names the capabilities it would need", async () => {
    const readings = await load()
    const text = lineFor(readings, "Configuration recorder")
    expect(text).toContain("RECORDER UNKNOWN")
    for (const capability of RECORDER_CAPABILITY_GAP.capabilities) {
      expect(text).toContain(capability)
    }
    expect(readings.enablement.recorder.kind).toBe("not-readable")
    // The engine never asked, so it never claims an answer either way.
    const calls: string[] = []
    await complianceReadings(fakeAws({ calls }), { now: AT })
    expect(calls.filter((c) => c.includes("Recorder"))).toEqual([])
  })

  it("says the unread recorder qualifies every verdict below it", async () => {
    const readings = await load()
    expect(lineFor(readings, "Configuration recorder")).toContain(
      "a rule reporting COMPLIANT over a type nothing is recording has checked nothing",
    )
  })
})

/* ============================================================ boundedness -- */

describe("paginating to completion, with a bound that says when it stopped", () => {
  it("walks every page and merges them", async () => {
    const inputs: Record<string, unknown>[] = []
    const readings = await load({
      inputs,
      rulePages: [
        { ConfigRules: [configRule("rule-a")], NextToken: pageToken(1) },
        { ConfigRules: [configRule("rule-b")], NextToken: pageToken(2) },
        { ConfigRules: [configRule("rule-c")] },
      ],
      compliance: {
        "rule-a": { ComplianceType: "COMPLIANT" },
        "rule-b": { ComplianceType: "COMPLIANT" },
        "rule-c": { ComplianceType: "COMPLIANT" },
      },
    })
    expect(readings.rules.state).toBe("ACTUAL")
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.rules.value.map((r) => r.name)).toEqual(["rule-a", "rule-b", "rule-c"])
    expect(readings.truncation.kind).toBe("complete")

    // The token was actually SENT, rather than the fake merely offering one.
    const tokens = inputs
      .filter((i) => i.capability === "config:DescribeConfigRules")
      .map((i) => i.NextToken)
    expect(tokens).toEqual([undefined, pageToken(1), pageToken(2)])
  })

  it("stops at the page bound and says there were more, with the token", async () => {
    const pages = Array.from({ length: MAX_RULE_PAGES + 4 }, (_, i) => ({
      ConfigRules: [configRule(`rule-${String(i).padStart(3, "0")}`)],
      NextToken: pageToken(i + 1),
    }))
    const readings = await load({ rulePages: pages, describeCompliance: "empty" })

    expect(readings.truncation.kind).toBe("more-available")
    if (readings.truncation.kind !== "more-available") throw new Error("narrowing")
    expect(readings.truncation.returned).toBe(MAX_RULE_PAGES)
    expect(readings.truncation.reason).toContain(`${MAX_RULE_PAGES} pages`)
    expect(readings.truncation.nextToken).toBe(pageToken(MAX_RULE_PAGES))
    expect(lineFor(readings, "Coverage")).toContain("TRUNCATED")
  })

  it("stops at the rule cap when one page carries more than the cap", async () => {
    const many = Array.from({ length: MAX_RULES + 10 }, (_, i) =>
      configRule(`bulk-${String(i).padStart(4, "0")}`),
    )
    const readings = await load({ rules: many, describeCompliance: "empty" })

    expect(readings.truncation.kind).toBe("more-available")
    if (readings.truncation.kind !== "more-available") throw new Error("narrowing")
    expect(readings.truncation.returned).toBe(MAX_RULES)
    expect(readings.truncation.reason).toContain(`${MAX_RULES}-rule cap`)
    // AWS gave no further token, and the answer says so rather than claiming complete.
    expect(readings.truncation.nextToken).toBeNull()
    expect(lineFor(readings, "Coverage")).toContain("dropped")
  })

  it("a truncation signal never survives onto a read that produced no rules", async () => {
    const readings = await load({ describeRules: "denied" })
    expect(readings.truncation.kind).toBe("complete")
  })

  it("rules past the verdict cap say the verdict was not read, not that they passed", async () => {
    const many = Array.from({ length: MAX_COMPLIANCE_RULES + 3 }, (_, i) =>
      configRule(`bulk-${String(i).padStart(4, "0")}`),
    )
    const readings = await load({
      rules: many,
      compliance: Object.fromEntries(
        many.map((r) => [String(r.ConfigRuleName), { ComplianceType: "COMPLIANT" }]),
      ),
    })
    expect(readings.rules.state).toBe("ACTUAL")
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")

    const last = readings.rules.value[readings.rules.value.length - 1]
    expect(last.compliance.state).toBe("UNCONFIGURED")
    expect(last.health.kind).toBe("unreadable")
    const text = lineFor(readings, last.name)
    expect(text).toContain("not the same as its passing")
    expect(text).not.toContain("every resource in scope passed")
  })

  it("never sends more rule names than DescribeComplianceByConfigRule accepts", async () => {
    const inputs: Record<string, unknown>[] = []
    const many = Array.from({ length: 60 }, (_, i) => configRule(`bulk-${String(i).padStart(4, "0")}`))
    await load({
      inputs,
      rules: many,
      compliance: Object.fromEntries(
        many.map((r) => [String(r.ConfigRuleName), { ComplianceType: "COMPLIANT" }]),
      ),
    })
    const batches = inputs.filter((i) => i.capability === "config:DescribeComplianceByConfigRule")
    // Literals, not the module's own constant: an expectation computed from the
    // value under test agrees with any value it is given. 60 names at the API's
    // 25-per-call limit is three calls.
    expect(batches.length).toBe(3)
    for (const batch of batches) {
      expect((batch.ConfigRuleNames as string[]).length).toBeLessThanOrEqual(25)
    }
    // And the constant itself is the API's limit, not a tuning knob: raising it
    // makes AWS raise InvalidParameterValueException on a real account.
    expect(COMPLIANCE_BATCH_SIZE).toBe(25)
  })
})

/* ================================================== residency and identity -- */

describe("region and partition come from the resolved identity or the ARN, never a literal", () => {
  it("takes region and partition from the rule's own ARN", async () => {
    const readings = await load({
      rules: [configRule(PASSING, { ConfigRuleArn: ruleArn(PASSING, OTHER_REGION) })],
      compliance: { [PASSING]: { ComplianceType: "COMPLIANT" } },
    })
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.rules.value[0].region).toBe(OTHER_REGION)
    expect(readings.rules.value[0].partition).toBe("aws")
    expect(readings.rules.value[0].accountId).toBe(ACCOUNT)
  })

  it("honours a non-commercial partition rather than assuming aws", async () => {
    const govArn = `arn:aws-us-gov:config:us-gov-west-1:${ACCOUNT}:config-rule/config-rule-x`
    const readings = await load({
      rules: [configRule(PASSING, { ConfigRuleArn: govArn })],
      compliance: { [PASSING]: { ComplianceType: "COMPLIANT" } },
    })
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.rules.value[0].partition).toBe("aws-us-gov")
    expect(readings.rules.value[0].region).toBe("us-gov-west-1")
  })

  it("leaves region null when there is no ARN and identity is unresolved", async () => {
    const readings = await load({
      identity: "denied",
      rules: [configRule(PASSING, { ConfigRuleArn: undefined })],
      compliance: { [PASSING]: { ComplianceType: "COMPLIANT" } },
    })
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.rules.value[0].region).toBeNull()
    expect(readings.rules.value[0].partition).toBeNull()
    expect(lineFor(readings, PASSING)).toContain("region unknown")
    expect(rendered(readings)).not.toContain("us-east-1")
  })

  it("falls back to the resolved identity's region when AWS returned no ARN", async () => {
    const readings = await load({
      rules: [configRule(PASSING, { ConfigRuleArn: undefined })],
      compliance: { [PASSING]: { ComplianceType: "COMPLIANT" } },
    })
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.rules.value[0].region).toBe(REGION)
  })
})

/* ================================================================ tenancy -- */

describe("attribution comes from a tag, and shared is not the same as untagged", () => {
  it("attributes a tagged rule and marks a deliberately shared one shared", async () => {
    const readings = await load({
      tags: {
        [ruleArn(FAILING)]: [{ Key: "tenure:tenant", Value: "acme-university" }],
        [ruleArn(PASSING)]: [{ Key: "tenure:tenant", Value: "tenure:shared" }],
      },
    })
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")
    const byName = new Map(readings.rules.value.map((r) => [r.name, r]))
    expect(byName.get(FAILING)!.attribution).toEqual({
      kind: "tenant",
      tenantSlug: "acme-university",
    })
    expect(byName.get(PASSING)!.attribution).toEqual({ kind: "shared" })
    // A rule nobody tagged is unattributed — a THIRD answer, not folded into shared.
    expect(byName.get(INERT)!.attribution).toEqual({ kind: "unattributed" })

    const text = rendered(readings)
    expect(text).toContain("acme-university")
    expect(text).toContain("shared — platform overhead, decided")
    expect(text).toContain("unattributable — missing tenure:tenant")
  })
})

/* ============================================================ rule detail -- */

describe("what a rule watches is stated, and is not confused with what is recorded", () => {
  it("prints a narrowed scope as a limitation of that rule", async () => {
    const readings = await load()
    const text = lineFor(readings, FAILING)
    expect(text).toContain("scoped to 1 resource type(s): AWS::RDS::DBInstance")
    expect(text).toContain("anything else is unchecked by this rule")
    expect(text).toContain("periodic every TwentyFour_Hours")
  })

  it("prints an unscoped rule as reaching every type its source supports", async () => {
    const readings = await load()
    expect(lineFor(readings, PASSING)).toContain("scoped to every resource type its source supports")
    expect(lineFor(readings, PASSING)).toContain("change-triggered")
  })

  it("calls out a PROACTIVE-only rule as evaluating nothing already deployed", async () => {
    const readings = await load({
      rules: [configRule(PASSING, { EvaluationModes: [{ Mode: "PROACTIVE" }] })],
      compliance: { [PASSING]: { ComplianceType: "COMPLIANT" } },
    })
    expect(lineFor(readings, PASSING)).toContain("PROACTIVE ONLY")
  })
})

/* ================================================================ cadence -- */

describe("every reading states when it was taken and how often it refreshes", () => {
  it("carries an explicit asOf and the capability's own cadence", async () => {
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    expect(readings.refreshMs.rules).toBe(3_600_000)
    expect(readings.refreshMs.compliance).toBe(900_000)
    if (readings.rules.state !== "ACTUAL") throw new Error("narrowing")
    for (const rule of readings.rules.value) {
      expect(rule.asOf).toBe("2026-08-13T09:15:00.000Z")
      expect(rule.refreshMs).toBe(900_000)
    }
    expect(lineFor(readings, "Config rules")).toContain("refreshed every 3600s")
    expect(lineFor(readings, PASSING)).toContain("refreshed every 900s")
  })
})
