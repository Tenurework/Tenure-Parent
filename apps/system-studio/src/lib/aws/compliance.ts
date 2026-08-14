/**
 * STUDIO-070-006 (AWS Config) — whether anything in this account is actually
 * being EVALUATED, and what the evaluation said.
 *
 * The Studio could not answer this. The only Config read that existed anywhere
 * in this repository is `config:DescribeConfigurationAggregators`, issued by
 * `posture.ts` to fill one "Config aggregation" row on the estate page. An
 * aggregator is a pipe. It says configuration state is being collected
 * somewhere central; it says nothing whatsoever about whether a single rule
 * exists, whether any rule has ever run, or whether anything failed. An account
 * can hold a beautifully organization-wide aggregator over exactly zero rules
 * and the estate page renders CENTRALIZED.
 *
 * So this module reads the two calls that answer the question — which rules
 * exist (`config:DescribeConfigRules`) and what each one's verdict is
 * (`config:DescribeComplianceByConfigRule`) — and it keeps apart the four
 * answers Config can give, because folding any two of them is how a console
 * lies.
 *
 * ## INSUFFICIENT_DATA is the dangerous one
 *
 * A rule that has evaluated NOTHING is not passing. `INSUFFICIENT_DATA` is what
 * Config returns for a rule whose scope matched no resource, whose Lambda has
 * never been invoked, or whose recorder is not recording the resource type it
 * watches. Every one of those is a hole in the control, and every one of them
 * renders as "not NON_COMPLIANT" to anything that checks for failures by looking
 * for the string `NON_COMPLIANT`. `NOT_APPLICABLE` is different again — the rule
 * ran and correctly decided it had nothing to say — and it is also not a pass.
 *
 * Four verdicts, four `RuleHealth` arms, four visibly different sentences out of
 * `describeRuleHealth`, and only ONE of them is the arm a surface may render as
 * healthy. There is a fifth arm, `verdict-unstated`, for a response where AWS
 * returned a compliance object with no `ComplianceType` or one this engine does
 * not recognise: defaulting that to COMPLIANT would be the reassuring default
 * this whole vocabulary exists to prevent, and defaulting it to NON_COMPLIANT
 * would be an invented failure.
 *
 * ## A rule being deleted still returns its last verdict
 *
 * `ConfigRuleState` is `ACTIVE`, `EVALUATING`, `DELETING` or `DELETING_RESULTS`,
 * and `DescribeComplianceByConfigRule` keeps answering `COMPLIANT` for a rule in
 * `DELETING` right up until it is gone. So the rule's state takes precedence
 * over its verdict: a rule that is going away is reported as `inactive`, not as
 * passing. `EVALUATING` is treated as live — it is the transient state a rule
 * passes through on its way to a verdict, not a teardown.
 *
 * ## The recorder is NOT readable from this registry, and this module says so
 *
 * The question "is configuration recording actually ON, and is it recording all
 * resource types or a subset" is answered by
 * `config:DescribeConfigurationRecorders` and
 * `config:DescribeConfigurationRecorderStatus`. NEITHER is in `capabilities.ts`
 * and neither has an arm in `client.ts`'s `call()` switch, and this module does
 * not get to add them — the registry is the review boundary and a capability
 * added at a call site is a permission nobody reviewed.
 *
 * The honest consequence is `RecorderReading`, a union with one arm today
 * (`not-readable`) carrying the exact capability keys and IAM actions that would
 * make it answerable. A single-arm union is deliberate: it is a type a surface
 * must handle, it renders as "unknown", and it cannot be mistaken for "the
 * recorder is on". When the registry grows those keys this union grows the arms
 * that state a real answer, and every consumer's switch fails to compile until
 * it handles them. See `RECORDER_CAPABILITY_GAP`.
 *
 * `ruleScope` is the readable neighbour of that question and is NOT a substitute
 * for it: `Scope.ComplianceResourceTypes` says which resource types one RULE
 * watches, not which ones the RECORDER records. A rule scoped to all types over
 * a recorder recording one type evaluates one type. Both facts are printed, and
 * the second is printed as unknown.
 *
 * ## Zero rules is a finding, not an empty table
 *
 * `DescribeConfigRules` against an account where Config was never set up
 * succeeds and returns an empty list. That is EMPTY — the read worked — but the
 * FINDING is `not-evaluating`, with a named remedy, because "we looked and
 * nothing is being checked" is a sentence about the estate and not about the
 * table's row count. It is emphatically not the same as DENIED, and both are
 * different again from a rule list this engine truncated.
 *
 * ## Every sub-call degrades on its own
 *
 * `config:DescribeConfigRules` and `config:DescribeComplianceByConfigRule` are
 * separate IAM actions and a role is routinely granted the first without the
 * second. Folding the compliance read into the listing would make a refused
 * `DescribeComplianceByConfigRule` render as "refused DescribeConfigRules", so
 * the statement an operator pastes would not contain the action that is actually
 * missing — they would grant it, redeploy, and be refused identically. So the
 * listing is one `AwsRead`, and EVERY rule carries its own `AwsRead` for its
 * verdict. A rule whose verdict was refused still appears, saying it was
 * refused. It does not vanish and it does not render as compliant.
 *
 * The same applies across BATCHES. `DescribeComplianceByConfigRule` accepts at
 * most 25 rule names per call, so a hundred rules is four calls, and one of them
 * being throttled must not collapse the other three.
 *
 * ## Bounded, and it says when it stopped
 *
 * `MAX_RULE_PAGES` pages of rules, `MAX_RULES` rules, `MAX_COMPLIANCE_RULES`
 * verdicts and `MAX_COMPLIANCE_PAGES` pages per batch. Hitting any of them
 * produces `truncation.kind === "more-available"` with the continuation token
 * where AWS gave one — a truncated answer that looked complete is the same lie
 * as an empty list, and an unbounded page loop is how one reader takes the
 * console down.
 *
 * ## Region, partition and attribution
 *
 * From the rule's own `ConfigRuleArn` where AWS returned one, and otherwise from
 * the resolved identity. There is no literal region in this file: GE-010-007 was
 * a data-residency defect caused by exactly that fallback, and a Config rule
 * reported under the wrong region is a claim about which jurisdiction's
 * resources were evaluated.
 *
 * Attribution goes through `tags.ts` and the Resource Groups Tagging API as
 * every other service read here does, with the same fourth answer `unknown` for
 * when the tag index itself could not be read — "we could not look up this
 * rule's tags" is not "this rule has no tenant tag".
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
 * How many pages of `DescribeConfigRules` to walk before stopping and SAYING so.
 *
 * `client.ts` sends no `Limit`, so the page size is whatever Config chooses
 * (25 by default). Hitting this bound is not an error — a conformance-pack-heavy
 * account legitimately has more — which is why it produces a truncation signal
 * and a continuation token rather than a throw.
 */
export const MAX_RULE_PAGES = 20

/** The hard ceiling on rules returned from one load, whatever the pages say. */
export const MAX_RULES = 500

/**
 * How many rule names `DescribeComplianceByConfigRule` takes in one call.
 *
 * Twenty-five, fixed by the API. Sending twenty-six is
 * `InvalidParameterValueException`, which would surface as ERROR on an account
 * whose only problem is having a lot of rules.
 */
export const COMPLIANCE_BATCH_SIZE = 25

/**
 * How many rules get a verdict read in one load.
 *
 * Rules past this cap are NOT dropped and do NOT render as compliant: they carry
 * an UNCONFIGURED verdict whose `why` says the engine stopped, which is a
 * different sentence from "this rule is passing".
 */
export const MAX_COMPLIANCE_RULES = 250

/** How many pages one compliance batch may walk. A batch of 25 needs one. */
export const MAX_COMPLIANCE_PAGES = 10

/** How many compliance batches are in flight at once, so one load is not a burst. */
const COMPLIANCE_CONCURRENCY = 4

/** The retry schedule is `throttle.ts`'s, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; `readAws` doubles it.
  backoffMs: backoffMs(2),
}

/* ------------------------------------------------------- the missing read -- */

/**
 * What this engine would need in order to answer the recorder question.
 *
 * Stated as data rather than prose so a surface can print the exact keys, and so
 * the day somebody adds them to `capabilities.ts` the diff is obvious. Nothing
 * here grants anything: `capabilities.ts` is the registry and `client.ts` is the
 * only place a command is constructed.
 */
export const RECORDER_CAPABILITY_GAP = {
  capabilities: [
    "config:DescribeConfigurationRecorders",
    "config:DescribeConfigurationRecorderStatus",
  ],
  iamActions: [
    "config:DescribeConfigurationRecorders",
    "config:DescribeConfigurationRecorderStatus",
  ],
  resource: "*",
} as const

/**
 * Whether configuration recording is on, and over which resource types.
 *
 * One arm today, because the two capabilities that answer it are not in the
 * registry. It is a union rather than a boolean or a nullable so that adding the
 * real arms later is a compile error at every consumer instead of a silent
 * behaviour change, and so that no consumer can read a `false` that was never
 * measured.
 */
export type RecorderReading = {
  kind: "not-readable"
  why: string
  neededCapabilities: readonly string[]
  neededIamActions: readonly string[]
}

/** The recorder answer this engine can give today: none, and why. */
export function recorderReading(): RecorderReading {
  return {
    kind: "not-readable",
    why:
      "whether the configuration recorder is running, and whether it records all supported " +
      "resource types or a named subset, is answered by " +
      `${RECORDER_CAPABILITY_GAP.capabilities.join(" and ")}. Neither is in this engine's ` +
      "capability registry, so the call is not made and no answer is invented. A rule can only " +
      "evaluate a resource type the recorder is recording, so an unread recorder qualifies every " +
      "verdict below: a rule reporting COMPLIANT over a type nothing is recording has checked nothing.",
    neededCapabilities: RECORDER_CAPABILITY_GAP.capabilities,
    neededIamActions: RECORDER_CAPABILITY_GAP.iamActions,
  }
}

/* ---------------------------------------------------------------- shapes -- */

/** The API's shapes, declared rather than imported — see `client.ts`'s one-owner rule. */
interface DescribeConfigRulesResponse {
  ConfigRules?: Array<{
    ConfigRuleName?: string
    ConfigRuleArn?: string
    ConfigRuleId?: string
    Description?: string
    ConfigRuleState?: string
    MaximumExecutionFrequency?: string
    CreatedBy?: string
    Scope?: {
      ComplianceResourceTypes?: string[]
      ComplianceResourceId?: string
      TagKey?: string
      TagValue?: string
    }
    Source?: {
      Owner?: string
      SourceIdentifier?: string
    }
    EvaluationModes?: Array<{ Mode?: string }>
  }>
  NextToken?: string
}

interface DescribeComplianceResponse {
  ComplianceByConfigRules?: Array<{
    ConfigRuleName?: string
    Compliance?: {
      ComplianceType?: string
      ComplianceContributorCount?: { CappedCount?: number; CapExceeded?: boolean }
    }
  }>
  NextToken?: string
}

interface AggregatorsResponse {
  ConfigurationAggregators?: Array<{
    ConfigurationAggregatorName?: string
    ConfigurationAggregatorArn?: string
    OrganizationAggregationSource?: { RoleArn?: string; AllAwsRegions?: boolean }
    AccountAggregationSources?: Array<{ AccountIds?: string[]; AllAwsRegions?: boolean }>
  }>
}

/* --------------------------------------------------------------- verdicts -- */

/**
 * The four answers Config gives, plus the one this engine gives when AWS gave
 * none it recognises.
 *
 * `UNSTATED` is ours. It is not a Config value and it never renders as a
 * verdict — it renders as "AWS returned a compliance object this engine could
 * not read", which is a bug report, not a pass.
 */
export type ComplianceVerdict =
  | "COMPLIANT"
  | "NON_COMPLIANT"
  | "NOT_APPLICABLE"
  | "INSUFFICIENT_DATA"
  | "UNSTATED"

/** The four strings Config actually returns, so an unknown one is caught rather than trusted. */
const AWS_VERDICTS: ReadonlySet<string> = new Set([
  "COMPLIANT",
  "NON_COMPLIANT",
  "NOT_APPLICABLE",
  "INSUFFICIENT_DATA",
])

export function verdictOf(raw: unknown): ComplianceVerdict {
  return typeof raw === "string" && AWS_VERDICTS.has(raw) ? (raw as ComplianceVerdict) : "UNSTATED"
}

/** One rule's verdict, as Config stated it. Nothing derived lives here. */
export interface RuleCompliance {
  verdict: ComplianceVerdict
  /**
   * How many resources are contributing to a NON_COMPLIANT verdict.
   *
   * Null rather than zero when AWS did not state one: `0 non-compliant
   * resources` next to a NON_COMPLIANT verdict is a contradiction an operator
   * has to spend time on, and Config genuinely omits the field for COMPLIANT
   * rules.
   */
  nonCompliantResources: number | null
  /**
   * AWS's own `CapExceeded`. When true the count is a floor and not a total, and
   * a surface printing "25 resources" over an estate with four hundred failing
   * ones is a number that gets planned against.
   */
  countCapped: boolean
}

/**
 * What one rule is actually doing.
 *
 * Ordered by how bad it is. Note that three of these seven arms have a verdict
 * that is not the string `NON_COMPLIANT`, and only ONE of the seven is the arm a
 * surface may render as healthy.
 */
export type RuleHealth =
  /** Evaluated, and resources are failing. The loudest arm. */
  | { kind: "failing"; nonCompliantResources: number | null; countCapped: boolean }
  /**
   * `INSUFFICIENT_DATA`. The rule has evaluated NOTHING. Not a pass — a hole.
   * Its scope matched no resource, its Lambda has never run, or the recorder is
   * not recording the type it watches.
   */
  | { kind: "not-evaluated"; why: string }
  /** The rule is being deleted. Its last verdict is still returned and is stale. */
  | { kind: "inactive"; ruleState: string; lastVerdict: ComplianceVerdict; why: string }
  /** AWS answered with a compliance object this engine could not read a verdict from. */
  | { kind: "verdict-unstated"; why: string }
  /** The verdict read was refused, throttled, capped or broken. Never "compliant". */
  | { kind: "unreadable"; why: string }
  /** `NOT_APPLICABLE`. The rule ran and correctly had nothing to say. Not a pass. */
  | { kind: "not-applicable"; why: string }
  /** `COMPLIANT`. The only arm a surface may render as healthy. */
  | { kind: "passing" }

/** Which resource types one RULE watches. NOT what the recorder records — see the header. */
export type RuleScope =
  /** The rule states no resource-type filter: it watches every type its source supports. */
  | { kind: "all-supported-types" }
  /** The rule is narrowed to named types. Anything outside them is unchecked by it. */
  | { kind: "resource-types"; types: readonly string[] }
  /** Narrowed to one resource id, or to a tag. The narrowest scopes there are. */
  | { kind: "single-resource"; resourceId: string }
  | { kind: "tag"; tagKey: string; tagValue: string | null }

/**
 * Which tenant a rule belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express — the
 * tag index is its own AWS read and it can be denied, throttled or broken. A
 * rule whose tags were never read must not render as "unattributable — missing
 * tenure:tenant", because that sentence sends an operator to add a tag that is
 * probably already there.
 */
export type ComplianceAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/** One Config rule, its verdict, and what that verdict actually means. */
export interface ConfigRuleReading {
  name: string
  /** AWS's own `ConfigRuleArn`, or null when it returned none. Never assembled. */
  arn: string | null
  /** From the ARN when there is one, else the resolved identity. Never a literal. */
  region: string | null
  partition: string | null
  accountId: string | null
  description: string | null
  /** `ACTIVE`, `EVALUATING`, `DELETING`, `DELETING_RESULTS`, or null when unstated. */
  ruleState: string | null
  /** `AWS`, `CUSTOM_LAMBDA` or `CUSTOM_POLICY`. Who wrote the check. */
  owner: string | null
  /** The managed rule identifier, or the Lambda ARN for a custom rule. */
  sourceIdentifier: string | null
  /** `One_Hour`, `TwentyFour_Hours`, … for a periodic rule. Null for change-triggered. */
  maximumExecutionFrequency: string | null
  scope: RuleScope
  /** `DETECTIVE`, `PROACTIVE`, or both. A proactive-only rule evaluates nothing deployed. */
  evaluationModes: readonly string[]
  /**
   * The verdict, per rule, with its own action named. DENIED here is a refused
   * `config:DescribeComplianceByConfigRule` and is never a COMPLIANT default.
   */
  compliance: AwsRead<RuleCompliance>
  /** Derived from the verdict AND the rule state. See `ruleHealthOf`. */
  health: RuleHealth
  attribution: ComplianceAttribution
  /** This rule's verdict cadence, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/* ------------------------------------------------------------- enablement -- */

/**
 * Whether AWS Config is doing anything in this account at all.
 *
 * The arm that matters is `not-evaluating`: the listing SUCCEEDED and returned
 * no rules, which is a finding with a remedy and not an empty table. `unknown`
 * is when the listing itself could not be read, which is a different remedy
 * (grant the action) and must never be shown as "no rules".
 */
export type ConfigEnablement =
  | { kind: "unknown"; why: string; recorder: RecorderReading }
  | { kind: "not-evaluating"; why: string; remedy: string; recorder: RecorderReading }
  | {
      kind: "rules-present"
      ruleCount: number
      /** How many of those rules are live rather than being deleted. */
      liveRuleCount: number
      recorder: RecorderReading
      why: string
    }

/**
 * Whether configuration state is aggregated centrally.
 *
 * Read here as well as in `posture.ts` because the two answer different
 * questions with the same call and a compliance surface that had to import a
 * posture row would be coupling two pages together. It carries `firstPageOnly`
 * because `client.ts` sends no pagination token for this capability, so a count
 * from it is a floor and this engine says so rather than implying a total.
 */
export interface AggregationReading {
  organizationWide: boolean
  names: readonly string[]
  firstPageOnly: true
  why: string
}

/* --------------------------------------------------------------- overall -- */

/** A rule named in a summary, with the number that makes it worth naming. */
export interface NamedRule {
  name: string
  detail: string
}

/**
 * Whether the estate is compliant, across every rule.
 *
 * Lifted out of the per-rule table because it is the one Config fact that is an
 * incident rather than a row. Every arm carries `unreadable` — the rules whose
 * verdict could not be read — so `compliant` never quietly means "compliant as
 * far as we bothered to look.
 */
export type ComplianceHealth =
  /** The rule LISTING itself was not readable, so nothing can be said at all. */
  | { kind: "unknown"; why: string }
  /** The listing succeeded and there are no rules. Nothing is being checked. */
  | { kind: "no-rules"; why: string }
  /** At least one rule is failing. The loudest arm. */
  | { kind: "non-compliant"; failing: readonly NamedRule[]; unreadable: readonly string[]; notEvaluated: readonly string[] }
  /**
   * Rules exist, none is failing, and NOT ONE has evaluated anything.
   *
   * The state this module exists for. A naive reader sees zero NON_COMPLIANT and
   * renders green over an account where every control is inert.
   */
  | { kind: "nothing-evaluated"; notEvaluated: readonly string[]; unreadable: readonly string[]; why: string }
  /** Some rules pass and some have evaluated nothing. Not a clean pass. */
  | {
      kind: "partly-evaluated"
      passing: readonly string[]
      notEvaluated: readonly string[]
      unreadable: readonly string[]
      why: string
    }
  /**
   * Rules exist and NOT ONE verdict was readable.
   *
   * Separate from `unknown` because the listing DID succeed: the operator knows
   * rules exist and knows nothing about any of them, which is a different remedy
   * (grant `config:DescribeComplianceByConfigRule`) from a refused listing.
   */
  | { kind: "no-verdicts"; unreadable: readonly string[]; why: string }
  /** Every rule that answered passed or was correctly not applicable. */
  | {
      kind: "compliant"
      passing: readonly string[]
      notApplicable: readonly string[]
      unreadable: readonly string[]
    }

/** Whether the rule listing was complete, and how to continue if it was not. */
export type ComplianceTruncation =
  | { kind: "complete" }
  | {
      kind: "more-available"
      /** How many rules were returned before the engine stopped asking. */
      returned: number
      /** Which bound stopped it, named, so raising the right one is obvious. */
      reason: string
      /**
       * Config's continuation token, or null when the cap was reached PART WAY
       * THROUGH the last page AWS sent and there is no further token. The rules
       * past the cap on that page were still dropped, so this is still
       * `more-available`: `complete` there would be an answer that lost rules and
       * said it had them all.
       */
      nextToken: string | null
    }

/** Everything a compliance surface needs, in one load. */
export interface ComplianceReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The rules. DENIED here is a refused `config:DescribeConfigRules` and is
   * NEVER `[]` — an operator reading "no rules" when the truth is "we were not
   * allowed to look" is the single most dangerous thing this surface can say.
   */
  rules: AwsRead<readonly ConfigRuleReading[]>
  /** Whether Config is doing anything at all, with the recorder gap stated. */
  enablement: ConfigEnablement
  /** The estate verdict, worst-first. */
  health: ComplianceHealth
  /** Whether configuration state is aggregated centrally. Degrades on its own. */
  aggregation: AwsRead<AggregationReading>
  truncation: ComplianceTruncation
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { rules: number; compliance: number; aggregators: number }
}

/* --------------------------------------------------------------- parsing -- */

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/** Truncated so a pathological AWS string cannot become an unbounded render. */
function shortText(raw: string, limit = 300): string {
  return raw.length > limit ? `${raw.slice(0, limit)}…` : raw
}

/**
 * Which resource types a rule watches.
 *
 * Exported and pure so the decision can be reasoned about alone. A rule with no
 * `Scope` at all is `all-supported-types`, which is what Config means by it —
 * but see the module header: that is the RULE's reach, not the recorder's.
 */
export function ruleScopeOf(
  scope:
    | {
        ComplianceResourceTypes?: string[]
        ComplianceResourceId?: string
        TagKey?: string
        TagValue?: string
      }
    | undefined,
): RuleScope {
  const resourceId = text(scope?.ComplianceResourceId)
  if (resourceId) return { kind: "single-resource", resourceId }
  const tagKey = text(scope?.TagKey)
  if (tagKey) return { kind: "tag", tagKey, tagValue: text(scope?.TagValue) }
  const types = (scope?.ComplianceResourceTypes ?? []).filter(
    (t): t is string => typeof t === "string" && t.trim() !== "",
  )
  if (types.length > 0) return { kind: "resource-types", types: [...types].sort() }
  return { kind: "all-supported-types" }
}

/**
 * What a rule is actually doing, from its verdict and its state.
 *
 * Exported and pure so the precedence is arguable on its own. The precedence IS
 * the argument: the verdict read failing beats everything (we know nothing), a
 * rule being torn down beats its stale verdict, then failing, then the two
 * "evaluated nothing" answers, and only a rule that clears all of them is called
 * passing.
 */
export function ruleHealthOf(
  compliance: AwsRead<RuleCompliance>,
  ruleState: string | null,
  ruleName: string,
): RuleHealth {
  if (compliance.state !== "ACTUAL" && compliance.state !== "STALE") {
    return {
      kind: "unreadable",
      why: describeRead(compliance, `the verdict for ${ruleName}`),
    }
  }
  const verdict = compliance.value.verdict

  // A rule being deleted keeps returning its last verdict until it is gone.
  // Reporting that verdict is reporting a control that no longer runs.
  if (ruleState === "DELETING" || ruleState === "DELETING_RESULTS") {
    return {
      kind: "inactive",
      ruleState,
      lastVerdict: verdict,
      why:
        `${ruleName} is in ${ruleState}. Config still returns its last verdict (${verdict}) and ` +
        `the rule is being torn down, so that verdict describes a control that is going away.`,
    }
  }

  switch (verdict) {
    case "NON_COMPLIANT":
      return {
        kind: "failing",
        nonCompliantResources: compliance.value.nonCompliantResources,
        countCapped: compliance.value.countCapped,
      }
    case "INSUFFICIENT_DATA":
      return {
        kind: "not-evaluated",
        why:
          `${ruleName} returned INSUFFICIENT_DATA, which means it has evaluated nothing. That is ` +
          `not a pass. Either its scope matched no resource, or its evaluation has never run, or ` +
          `the configuration recorder is not recording the resource type it watches.`,
      }
    case "NOT_APPLICABLE":
      return {
        kind: "not-applicable",
        why:
          `${ruleName} returned NOT_APPLICABLE: it ran and decided it had nothing to say about ` +
          `this account. Nothing was checked against it, so it is not evidence of a control. ` +
          `Not a pass.`,
      }
    case "UNSTATED":
      return {
        kind: "verdict-unstated",
        why:
          `config:DescribeComplianceByConfigRule answered for ${ruleName} with a compliance object ` +
          `carrying no ComplianceType this engine recognises. No verdict is inferred from that — a ` +
          `default here would be either an invented pass or an invented failure.`,
      }
    case "COMPLIANT":
      return { kind: "passing" }
  }
}

/**
 * A rule's identity fields, with region and partition from its own ARN.
 *
 * `arn:PARTITION:config:REGION:ACCOUNT:config-rule/config-rule-xxxxxx`. When AWS
 * returned no ARN the identity's values are used, and when identity is
 * unresolved the fields are null. Nothing here falls back to a literal.
 */
export function parseConfigRule(
  rule: NonNullable<DescribeConfigRulesResponse["ConfigRules"]>[number],
  identity: AwsRead<Identity>,
): Omit<ConfigRuleReading, "compliance" | "health" | "attribution" | "refreshMs" | "asOf"> {
  const arn = text(rule.ConfigRuleArn)
  const parts = arn ? arn.split(":") : []
  const fromArn = parts.length >= 6 && parts[0] === "arn"
  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"

  const modes = (rule.EvaluationModes ?? [])
    .map((m) => text(m?.Mode))
    .filter((m): m is string => m !== null)

  return {
    name: text(rule.ConfigRuleName) ?? text(rule.ConfigRuleId) ?? arn ?? "unnamed rule",
    arn,
    region: fromArn ? parts[3] : identityResolved ? identity.value.region : null,
    partition: fromArn ? parts[1] : identityResolved ? identity.value.partition : null,
    accountId: fromArn ? parts[4] : identityResolved ? identity.value.accountId : null,
    description: text(rule.Description) ? shortText(String(rule.Description)) : null,
    ruleState: text(rule.ConfigRuleState),
    owner: text(rule.Source?.Owner),
    sourceIdentifier: text(rule.Source?.SourceIdentifier),
    maximumExecutionFrequency: text(rule.MaximumExecutionFrequency),
    scope: ruleScopeOf(rule.Scope),
    evaluationModes: [...modes].sort(),
  }
}

/** One compliance entry, normalised. Nothing is defaulted to a verdict. */
export function parseCompliance(
  entry: NonNullable<DescribeComplianceResponse["ComplianceByConfigRules"]>[number],
): RuleCompliance {
  const count = entry.Compliance?.ComplianceContributorCount
  const capped = count?.CappedCount
  return {
    verdict: verdictOf(entry.Compliance?.ComplianceType),
    nonCompliantResources: typeof capped === "number" && Number.isFinite(capped) ? capped : null,
    countCapped: count?.CapExceeded === true,
  }
}

/* ----------------------------------------------------------- the reading -- */

/** The listing, paged to a bound, with the truncation signal carried out of scope. */
async function describeConfigRules(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<{
  read: AwsRead<readonly NonNullable<DescribeConfigRulesResponse["ConfigRules"]>[number][]>
  truncation: ComplianceTruncation
}> {
  let truncation: ComplianceTruncation = { kind: "complete" }

  const read = await readAws<readonly NonNullable<DescribeConfigRulesResponse["ConfigRules"]>[number][]>(
    "config:DescribeConfigRules",
    async () => {
      // Reset per attempt. `readAws` re-runs this function after a throttle, and
      // a truncation signal left over from the attempt that was rate-limited
      // would describe a page walk that did not happen.
      truncation = { kind: "complete" }
      const collected: NonNullable<DescribeConfigRulesResponse["ConfigRules"]>[number][] = []
      let token: string | undefined
      /** Set when the cap cut a page short — rules AWS sent and this engine dropped. */
      let droppedWithinPage = false

      for (let page = 0; page < MAX_RULE_PAGES; page += 1) {
        const response = (await gw.call("config:DescribeConfigRules", {
          NextToken: token,
        })) as DescribeConfigRulesResponse

        for (const rule of response?.ConfigRules ?? []) {
          if (collected.length >= MAX_RULES) {
            droppedWithinPage = true
            break
          }
          collected.push(rule)
        }

        token = response?.NextToken || undefined

        if (collected.length >= MAX_RULES && (token || droppedWithinPage)) {
          truncation = {
            kind: "more-available",
            returned: collected.length,
            reason:
              `stopped at the ${MAX_RULES}-rule cap for one load. There are more Config rules in ` +
              `this account; continue from the token, or raise MAX_RULES.`,
            nextToken: token ?? null,
          }
          break
        }
        if (!token) break
        if (page === MAX_RULE_PAGES - 1) {
          truncation = {
            kind: "more-available",
            returned: collected.length,
            reason:
              `stopped after ${MAX_RULE_PAGES} pages, this engine's page bound. There are more ` +
              `Config rules in this account; continue from the token.`,
            nextToken: token,
          }
        }
      }

      // Sorted by name — present on every rule Config returns, stable and unique
      // within an account — so two loads of the same estate render in the same
      // order. `DescribeConfigRules` promises no ordering, and an order that
      // changes between renders makes a diff of two screenshots unreadable.
      return [...collected].sort((a, b) =>
        (a.ConfigRuleName ?? a.ConfigRuleArn ?? "").localeCompare(
          b.ConfigRuleName ?? b.ConfigRuleArn ?? "",
        ),
      )
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )

  // A read that produced no rules cannot have been truncated. Leaving a stale
  // `more-available` on a DENIED result would be a refusal wearing the clothes
  // of a partial answer.
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    truncation = { kind: "complete" }
  }
  return { read, truncation }
}

/**
 * One batch of at most `COMPLIANCE_BATCH_SIZE` rule names.
 *
 * Its own `readAws`, so a batch that is refused or throttled does not collapse
 * the batches beside it. `isEmpty` is pinned false deliberately: a batch that
 * answered with zero entries is a SUCCESSFUL read that said nothing about those
 * rules, and the per-rule "AWS returned no compliance for this rule" path below
 * is where that is reported. EMPTY here would leave a caller to invent what a
 * rule with no compliance state means.
 */
async function describeComplianceBatch(
  gw: AwsGateway,
  names: readonly string[],
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<ReadonlyMap<string, RuleCompliance>>> {
  return readAws<ReadonlyMap<string, RuleCompliance>>(
    "config:DescribeComplianceByConfigRule",
    async () => {
      const found = new Map<string, RuleCompliance>()
      let token: string | undefined
      for (let page = 0; page < MAX_COMPLIANCE_PAGES; page += 1) {
        const response = (await gw.call("config:DescribeComplianceByConfigRule", {
          ConfigRuleNames: [...names],
          NextToken: token,
        })) as DescribeComplianceResponse

        for (const entry of response?.ComplianceByConfigRules ?? []) {
          const name = text(entry.ConfigRuleName)
          if (!name) continue
          found.set(name, parseCompliance(entry))
        }

        token = response?.NextToken || undefined
        if (!token) break
      }
      return found
    },
    { now: options.now, denial: options.denial, isEmpty: () => false, ...RETRY },
  )
}

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): ComplianceAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this rule's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "config:DescribeConfigRules returned no ConfigRuleArn for this rule, so it cannot be " +
        "joined against the tag index. Unattributed would be a claim about its tags; this is a " +
        "claim about ours.",
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

/** Whether configuration state is aggregated centrally. Its own read, its own failure. */
async function describeAggregation(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<AggregationReading>> {
  return readAws<AggregationReading>(
    "config:DescribeConfigurationAggregators",
    async () => {
      const response = (await gw.call(
        "config:DescribeConfigurationAggregators",
      )) as AggregatorsResponse
      const list = response?.ConfigurationAggregators ?? []
      const names = list
        .map((a) => text(a?.ConfigurationAggregatorName))
        .filter((n): n is string => n !== null)
        .sort()
      return {
        organizationWide: list.some((a) => a?.OrganizationAggregationSource !== undefined),
        names,
        firstPageOnly: true,
        why:
          "this engine sends no pagination token for config:DescribeConfigurationAggregators — " +
          "client.ts constructs that command with no input — so this is the first page and the " +
          "count is a floor, not a total.",
      }
    },
    {
      now: options.now,
      denial: options.denial,
      // An account with no aggregator returns an object with an empty list, and
      // that object is not "nothing": `organizationWide: false` is the answer.
      // EMPTY here would be a successful read reported as an absence of read.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/* ----------------------------------------------------------- the surface -- */

/**
 * Every Config rule in this account, its verdict, and what the verdict means.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function complianceReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<ComplianceReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const [listed, aggregation] = await Promise.all([
    describeConfigRules(gw, { now, denial }),
    describeAggregation(gw, { now, denial }),
  ])

  const asOf = now().toISOString()
  const refreshMs = {
    rules: CAPABILITIES["config:DescribeConfigRules"].refreshMs,
    compliance: CAPABILITIES["config:DescribeComplianceByConfigRule"].refreshMs,
    aggregators: CAPABILITIES["config:DescribeConfigurationAggregators"].refreshMs,
  }
  const recorder = recorderReading()

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.read.state !== "ACTUAL" && listed.read.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they already ARE an `AwsRead<ConfigRuleReading[]>`. A
    // cast here would be the place a future empty array could be smuggled in.
    const rules: AwsRead<readonly ConfigRuleReading[]> = listed.read
    return {
      identity,
      tagged,
      rules,
      enablement: enablementOf(rules, recorder),
      health: complianceHealth(rules),
      aggregation,
      truncation: listed.truncation,
      asOf,
      refreshMs,
    }
  }

  const parsed = listed.read.value.map((rule) => parseConfigRule(rule, identity))

  // Only rules inside the verdict cap are asked about. The rest are not dropped
  // and do not default to passing — they get an UNCONFIGURED verdict below.
  const asked = parsed.slice(0, MAX_COMPLIANCE_RULES)
  const batches: string[][] = []
  for (let i = 0; i < asked.length; i += COMPLIANCE_BATCH_SIZE) {
    batches.push(asked.slice(i, i + COMPLIANCE_BATCH_SIZE).map((r) => r.name))
  }

  /** Per rule, so one refused batch cannot collapse the rules in another. */
  const verdicts = new Map<string, AwsRead<RuleCompliance>>()
  for (let start = 0; start < batches.length; start += COMPLIANCE_CONCURRENCY) {
    const slice = batches.slice(start, start + COMPLIANCE_CONCURRENCY)
    const results = await Promise.all(
      slice.map((names) => describeComplianceBatch(gw, names, { now, denial })),
    )
    for (let i = 0; i < results.length; i += 1) {
      const names = slice[i]
      const result = results[i]
      for (const name of names) {
        if (result.state === "ACTUAL" || result.state === "STALE") {
          const found = result.value.get(name)
          if (found) {
            verdicts.set(name, { ...result, value: found })
          } else {
            // The batch succeeded and AWS returned no entry for this rule. That
            // is not a verdict and it is not an absence of rules — it is a call
            // that answered without answering, which is the operator's lead.
            verdicts.set(name, {
              state: "ERROR",
              capability: "config:DescribeComplianceByConfigRule",
              code: "NoComplianceReturned",
              safeDetail:
                `config:DescribeComplianceByConfigRule succeeded for a batch containing ` +
                `${name} and returned no compliance entry for it. No verdict is inferred from ` +
                `silence.`,
            })
          }
        } else {
          // DENIED / THROTTLED / ERROR / UNCONFIGURED / EMPTY travel to every
          // rule in the batch unchanged, so the sentence a surface prints names
          // config:DescribeComplianceByConfigRule and not the listing action.
          const failed: AwsRead<RuleCompliance> = result
          verdicts.set(name, failed)
        }
      }
    }
  }

  const readings: ConfigRuleReading[] = parsed.map((rule, position) => {
    const compliance: AwsRead<RuleCompliance> =
      position < MAX_COMPLIANCE_RULES
        ? verdicts.get(rule.name) ?? {
            state: "ERROR",
            capability: "config:DescribeComplianceByConfigRule",
            code: "NoComplianceReturned",
            safeDetail:
              `no verdict was collected for ${rule.name}. Two rules sharing a name in one ` +
              `account is the only way this happens, and neither one's verdict can be trusted ` +
              `to be the other's.`,
          }
        : {
            state: "UNCONFIGURED",
            capability: "config:DescribeComplianceByConfigRule",
            why:
              `this engine reads at most ${MAX_COMPLIANCE_RULES} rule verdicts per load and this ` +
              `rule is number ${position + 1} of ${parsed.length}. Its verdict was not read — ` +
              `which is not the same as its passing.`,
          }
    return {
      ...rule,
      compliance,
      health: ruleHealthOf(compliance, rule.ruleState, rule.name),
      attribution: attributionFor(rule.arn, tagged, index),
      refreshMs: refreshMs.compliance,
      asOf,
    }
  })

  const rules: AwsRead<readonly ConfigRuleReading[]> = { ...listed.read, value: readings }
  return {
    identity,
    tagged,
    rules,
    enablement: enablementOf(rules, recorder),
    health: complianceHealth(rules),
    aggregation,
    truncation: listed.truncation,
    asOf,
    refreshMs,
  }
}

/**
 * Whether Config is doing anything in this account.
 *
 * Exported and pure so the derivation can be reasoned about on its own, but
 * `complianceReadings` is the only production caller and the tests drive it
 * through there.
 */
export function enablementOf(
  rules: AwsRead<readonly ConfigRuleReading[]>,
  recorder: RecorderReading,
): ConfigEnablement {
  if (rules.state === "EMPTY") {
    return {
      kind: "not-evaluating",
      why:
        "config:DescribeConfigRules succeeded and returned no rules at all. Nothing in this " +
        "account is being evaluated by AWS Config, whatever the recorder or an aggregator says.",
      remedy:
        "enable AWS Config in this region, switch the configuration recorder on for all supported " +
        "resource types, attach a delivery channel, and deploy at least one rule or conformance " +
        "pack. Until then every Config panel in this console is honestly blank.",
      recorder,
    }
  }
  if (rules.state !== "ACTUAL" && rules.state !== "STALE") {
    return {
      kind: "unknown",
      why:
        `${describeRead(rules, "the Config rule listing")} — so whether anything is being ` +
        `evaluated is not known. This is NOT "no rules".`,
      recorder,
    }
  }
  const live = rules.value.filter(
    (r) => r.ruleState !== "DELETING" && r.ruleState !== "DELETING_RESULTS",
  )
  if (rules.value.length === 0) {
    return {
      kind: "not-evaluating",
      why:
        "config:DescribeConfigRules succeeded and returned no rules at all. Nothing in this " +
        "account is being evaluated by AWS Config.",
      remedy:
        "enable AWS Config in this region, switch the configuration recorder on for all supported " +
        "resource types, attach a delivery channel, and deploy at least one rule.",
      recorder,
    }
  }
  return {
    kind: "rules-present",
    ruleCount: rules.value.length,
    liveRuleCount: live.length,
    recorder,
    why:
      `${rules.value.length} Config rule(s) exist, ${live.length} of them live. Whether each one ` +
      `has evaluated anything is a separate question, answered per rule.`,
  }
}

/**
 * Whether the estate is compliant, across every rule.
 *
 * Worst first, and deliberately so: an account with one failing rule and forty
 * passing ones must not render as compliant because the majority answered well,
 * and an account whose rules have all evaluated nothing must not render as
 * compliant because none of them said NON_COMPLIANT.
 */
export function complianceHealth(rules: AwsRead<readonly ConfigRuleReading[]>): ComplianceHealth {
  if (rules.state === "EMPTY") {
    return {
      kind: "no-rules",
      why:
        "config:DescribeConfigRules succeeded and returned no rules. Nothing is being checked, " +
        "so there is nothing to be compliant with.",
    }
  }
  if (rules.state !== "ACTUAL" && rules.state !== "STALE") {
    return { kind: "unknown", why: describeRead(rules, "the Config rule listing") }
  }
  const readings = rules.value
  if (readings.length === 0) {
    return {
      kind: "no-rules",
      why:
        "config:DescribeConfigRules succeeded and returned no rules. Nothing is being checked, " +
        "so there is nothing to be compliant with.",
    }
  }

  const failing: NamedRule[] = []
  const notEvaluated: string[] = []
  const unreadable: string[] = []
  const passing: string[] = []
  const notApplicable: string[] = []
  const inactive: string[] = []

  for (const reading of readings) {
    switch (reading.health.kind) {
      case "failing":
        failing.push({
          name: reading.name,
          detail:
            reading.health.nonCompliantResources === null
              ? "NON_COMPLIANT, resource count not stated"
              : `${reading.health.nonCompliantResources}${reading.health.countCapped ? "+" : ""} ` +
                `non-compliant resource(s)`,
        })
        break
      case "not-evaluated":
        notEvaluated.push(reading.name)
        break
      case "unreadable":
      case "verdict-unstated":
        unreadable.push(reading.name)
        break
      case "inactive":
        inactive.push(reading.name)
        break
      case "not-applicable":
        notApplicable.push(reading.name)
        break
      case "passing":
        passing.push(reading.name)
        break
    }
  }

  if (failing.length > 0) return { kind: "non-compliant", failing, unreadable, notEvaluated }

  if (notEvaluated.length > 0 && passing.length === 0 && notApplicable.length === 0) {
    return {
      kind: "nothing-evaluated",
      notEvaluated,
      unreadable,
      why:
        `${notEvaluated.length} rule(s) exist and every one of them returned INSUFFICIENT_DATA. ` +
        `Not one has evaluated a resource. A reader looking only for NON_COMPLIANT sees zero ` +
        `failures here and calls it compliant; nothing has been checked at all.`,
    }
  }
  if (notEvaluated.length > 0) {
    return {
      kind: "partly-evaluated",
      passing,
      notEvaluated,
      unreadable,
      why:
        `${passing.length} rule(s) passed and ${notEvaluated.length} returned INSUFFICIENT_DATA, ` +
        `having evaluated nothing. The second group is not a pass and this is not a clean bill.`,
    }
  }
  if (passing.length > 0 || notApplicable.length > 0) {
    return { kind: "compliant", passing, notApplicable, unreadable }
  }

  // Rules exist and not one verdict was readable. "Compliant" over an empty
  // passing list would be the reassuring default this module is built against.
  return {
    kind: "no-verdicts",
    unreadable: [...unreadable, ...inactive],
    why:
      `${readings.length} rule(s) exist and this engine could not read a usable verdict for any ` +
      `of them. Whether this account is compliant with its own controls is unknown.`,
  }
}

/* ------------------------------------------------------------ rendering -- */

/**
 * The sentence a surface prints for one verdict.
 *
 * Five verdicts, five visibly different strings, and only `COMPLIANT` reads as a
 * pass. The strings are asserted on in the tests, which is what stops two of them
 * quietly converging.
 */
export function describeVerdict(verdict: ComplianceVerdict): string {
  switch (verdict) {
    case "COMPLIANT":
      return "COMPLIANT — evaluated, and every resource in scope passed"
    case "NON_COMPLIANT":
      return "NON_COMPLIANT — evaluated, and resources are failing"
    case "NOT_APPLICABLE":
      return "NOT_APPLICABLE — evaluated, and nothing in this account was in scope. Not a pass."
    case "INSUFFICIENT_DATA":
      return "INSUFFICIENT_DATA — this rule has evaluated NOTHING. Not a pass."
    case "UNSTATED":
      return "verdict unstated — AWS returned a compliance object with no readable ComplianceType"
  }
}

/** The sentence a surface prints for what one rule is actually doing. */
export function describeRuleHealth(health: RuleHealth): string {
  switch (health.kind) {
    case "failing":
      return (
        `FAILING — ${describeVerdict("NON_COMPLIANT")}: ` +
        `${health.nonCompliantResources === null ? "resource count not stated by AWS" : `${health.nonCompliantResources}${health.countCapped ? "+ (count capped by AWS — this is a floor)" : ""} non-compliant resource(s)`}`
      )
    case "not-evaluated":
      return `NOT EVALUATED — ${health.why}`
    case "inactive":
      return `INACTIVE — ${health.why}`
    case "verdict-unstated":
      return `VERDICT UNSTATED — ${health.why}`
    case "unreadable":
      return `VERDICT UNREADABLE — ${health.why}`
    case "not-applicable":
      return `NOT APPLICABLE — ${health.why}`
    case "passing":
      return describeVerdict("COMPLIANT")
  }
}

/** The sentence a surface prints for which resource types a rule watches. */
export function describeRuleScope(scope: RuleScope): string {
  switch (scope.kind) {
    case "all-supported-types":
      return "scoped to every resource type its source supports"
    case "resource-types":
      return `scoped to ${scope.types.length} resource type(s): ${scope.types.join(", ")} — anything else is unchecked by this rule`
    case "single-resource":
      return `scoped to ONE resource (${scope.resourceId}) — this rule says nothing about any other`
    case "tag":
      return `scoped by tag ${scope.tagKey}${scope.tagValue === null ? "" : `=${scope.tagValue}`} — untagged resources are unchecked by this rule`
  }
}

/** The sentence a surface prints for one rule's attribution. */
export function describeComplianceAttribution(attribution: ComplianceAttribution): string {
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

/** The sentence a surface prints for the recorder question this engine cannot ask. */
export function describeRecorder(recorder: RecorderReading): string {
  switch (recorder.kind) {
    case "not-readable":
      return (
        `RECORDER UNKNOWN — ${recorder.why} Needed capabilities: ` +
        `${recorder.neededCapabilities.join(", ")}. Needed IAM actions: ` +
        `${recorder.neededIamActions.join(", ")} on ${RECORDER_CAPABILITY_GAP.resource}.`
      )
  }
}

/** The sentence a surface prints for whether Config is doing anything at all. */
export function describeEnablement(enablement: ConfigEnablement): string {
  switch (enablement.kind) {
    case "unknown":
      return `unknown — ${enablement.why}`
    case "not-evaluating":
      return `NOT EVALUATING — ${enablement.why} Remedy: ${enablement.remedy}`
    case "rules-present":
      return enablement.why
  }
}

/** The sentence a surface prints for one rule. One funnel, so states cannot drift. */
export function describeConfigRule(reading: ConfigRuleReading): string {
  const where =
    reading.region && reading.partition
      ? `${reading.region} (partition ${reading.partition})`
      : "region unknown — this rule returned no ARN and identity is unresolved"
  const source =
    `${reading.owner ?? "owner unstated"}${reading.sourceIdentifier ? `/${reading.sourceIdentifier}` : ""}`
  const cadence = reading.maximumExecutionFrequency
    ? `periodic every ${reading.maximumExecutionFrequency}`
    : "change-triggered"
  const modes =
    reading.evaluationModes.length === 0
      ? ""
      : ` — evaluation ${reading.evaluationModes.join("+")}` +
        (reading.evaluationModes.length === 1 && reading.evaluationModes[0] === "PROACTIVE"
          ? " (PROACTIVE ONLY — this rule evaluates proposed resources and nothing already deployed)"
          : "")
  return (
    `${reading.name} — ${where} — ${source} — ${cadence} — ${describeRuleScope(reading.scope)}` +
    `${modes} — ${describeComplianceAttribution(reading.attribution)} — ` +
    `${describeRuleHealth(reading.health)} · as of ${reading.asOf}, refreshed every ` +
    `${Math.round(reading.refreshMs / 1000)}s`
  )
}

/**
 * The sentence a surface prints for the estate's compliance.
 *
 * Seven arms, seven visibly different sentences, and only one of them says the
 * estate is compliant. One renderer for the same reason `describeRead` is one
 * renderer: an unevaluated control must not be worded as a pass on one surface
 * and correctly on another.
 */
export function describeComplianceHealth(health: ComplianceHealth): string {
  const qualifier = (unreadable: readonly string[]) =>
    unreadable.length === 0
      ? ""
      : ` A further ${unreadable.length} rule(s) had no readable verdict (${unreadable.join(", ")}), so this is qualified.`

  switch (health.kind) {
    case "unknown":
      return `unknown — ${health.why}`
    case "no-rules":
      return `NO RULES — ${health.why}`
    case "non-compliant":
      return (
        `NON-COMPLIANT — ${health.failing.length} rule(s) are failing: ` +
        health.failing.map((f) => `${f.name} (${f.detail})`).join("; ") +
        `.${health.notEvaluated.length > 0 ? ` ${health.notEvaluated.length} further rule(s) have evaluated nothing (${health.notEvaluated.join(", ")}).` : ""}` +
        qualifier(health.unreadable)
      )
    case "nothing-evaluated":
      return `NOTHING EVALUATED — ${health.why}${qualifier(health.unreadable)}`
    case "partly-evaluated":
      return `PARTLY EVALUATED — ${health.why}${qualifier(health.unreadable)}`
    case "no-verdicts":
      return `unknown — ${health.why} Rules: ${health.unreadable.join(", ")}.`
    case "compliant":
      return (
        `compliant — ${health.passing.length} rule(s) evaluated and passed` +
        `${health.passing.length > 0 ? `: ${health.passing.join(", ")}` : ""}` +
        `${health.notApplicable.length > 0 ? `. ${health.notApplicable.length} rule(s) were NOT_APPLICABLE and checked nothing (${health.notApplicable.join(", ")})` : ""}.` +
        qualifier(health.unreadable)
      )
  }
}

/** The sentence a surface prints for whether the rule listing was complete. */
export function describeComplianceTruncation(truncation: ComplianceTruncation): string {
  switch (truncation.kind) {
    case "complete":
      return "complete — every Config rule in this account was listed"
    case "more-available":
      return (
        `TRUNCATED — ${truncation.returned} rule(s) returned and there are more. ` +
        `${truncation.reason}${truncation.nextToken ? ` Continuation token available.` : ` AWS returned no further token; the rules past the cap on the last page were dropped.`}`
      )
  }
}

/** The sentence a surface prints for central aggregation. */
export function describeAggregationReading(read: AwsRead<AggregationReading>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return describeRead(read, "configuration aggregation")
  }
  const value = read.value
  if (value.names.length === 0) {
    return (
      "no configuration aggregator — configuration state is not collected anywhere central. " +
      value.why
    )
  }
  return (
    `${value.names.length} aggregator(s): ${value.names.join(", ")}` +
    `${value.organizationWide ? ", at least one organization-wide" : ", none organization-wide — configuration state is per account"}. ` +
    `An aggregator is a pipe and says nothing about whether any rule has evaluated anything. ${value.why}`
  )
}

export interface ComplianceLine {
  label: string
  text: string
}

/**
 * What a compliance surface prints.
 *
 * The surface agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function complianceLines(readings: ComplianceReadings): readonly ComplianceLine[] {
  const lines: ComplianceLine[] = [
    {
      label: "Config rules",
      text: describeRead(
        readings.rules,
        `Config rules read from AWS, refreshed every ${Math.round(readings.refreshMs.rules / 1000)}s`,
      ),
    },
    { label: "Config enablement", text: describeEnablement(readings.enablement) },
    { label: "Configuration recorder", text: describeRecorder(readings.enablement.recorder) },
    { label: "Compliance", text: describeComplianceHealth(readings.health) },
    { label: "Aggregation", text: describeAggregationReading(readings.aggregation) },
    { label: "Coverage", text: describeComplianceTruncation(readings.truncation) },
  ]
  if (readings.rules.state === "ACTUAL" || readings.rules.state === "STALE") {
    for (const reading of readings.rules.value) {
      lines.push({ label: reading.name, text: describeConfigRule(reading) })
    }
  }
  return lines
}
