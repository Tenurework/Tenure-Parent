/**
 * What `/platform/security` says about COVERAGE, decided as data rather than in
 * JSX.
 *
 * ── The question this module answers ────────────────────────────────────────
 *
 * "What in this estate is exposed, unencrypted, unrotated or unwatched?"
 *
 * `./answer.ts` decides what to say about the findings Security Hub returned.
 * This decides the thing that has to be said FIRST and that a findings list can
 * never say on its own: **which of those four questions is being asked of this
 * account at all.**
 *
 * ── The rule, stated once ──────────────────────────────────────────────────
 *
 * **An absence of findings from a control that is not running is not a pass.**
 *
 * A GuardDuty detector that is switched off returns no findings. An account with
 * no Access Analyzer has no external-access findings. A repository with
 * `scanOnPush` off has no image findings. A Config rule sitting at
 * `INSUFFICIENT_DATA` has no non-compliant resources. Every one of those reads,
 * through a naive page, as a clean estate — and the difference between "checked
 * and clean" and "not being checked" is the entire value of this surface.
 *
 * So every control this page knows about carries a `ControlState`, only ONE of
 * which — `CHECKING` — counts as coverage, and `postureVerdict` cannot reach its
 * clear arm while a single control is in any of the other four. `PARTIAL` is a
 * gap for the same reason: a wildcard sweep that could not read an AWS-managed
 * policy document has not swept it, and reporting "no wildcards" off that is the
 * same defect one level down.
 *
 * ── Purity, and why it matters here ────────────────────────────────────────
 *
 * Everything below is a pure function of values a caller already read. The only
 * runtime import is `lib/aws/capabilities.ts`, which has NO imports of its own —
 * it is a data registry of IAM actions and their minimum statements — so nothing
 * here drags `server-only`, an SDK client or a live gateway into the module
 * graph. That is what lets the whole decision be driven at the node level, with
 * no browser, no server and no AWS account, through every arm including the four
 * an operator pointed at a healthy estate can never reach.
 *
 * `SEVERITY_SLA_HOURS`-style values stay parameters for the same reason: the
 * finding, wildcard and access-key types below are `import type` only.
 */

import { CAPABILITIES, minimumStatementText, type Capability } from "../../../lib/aws/capabilities"
import type { FindingSource, SecurityFinding, Severity } from "../../../lib/aws/findings"
import type { IamAccessKey, IamPosture, IamWildcard, WildcardKind } from "../../../lib/aws/iam"
import type { Severity as ChipSeverity } from "../../../components/md3/SeverityChip"
import type { Tone } from "./answer"

/* ────────────────────────────────────────────────────── the four words ──── */

/**
 * The four words in the page's own question, in the order it asks them.
 *
 * A closed union rather than free text: every control below declares which of
 * the four it answers, and the coverage summary is a count per word. A control
 * that answered nothing would be a control that cannot make the summary worse,
 * which is how a page ends up reassuring on the strength of a row nobody reads.
 */
export const QUESTIONS = ["exposed", "unencrypted", "unrotated", "unwatched"] as const

export type Question = (typeof QUESTIONS)[number]

/** What each word means here, so the summary is readable without a legend. */
export const QUESTION_MEANING: Readonly<Record<Question, string>> = {
  exposed: "reachable, or grantable, by somebody who should not reach it",
  unencrypted: "stored or moved without encryption this account controls",
  unrotated: "still trusting a key or credential nobody has replaced",
  unwatched: "changing with no control looking at it",
}

/* ─────────────────────────────────────────────────── control coverage ──── */

/**
 * What a control is doing, and only one of these is coverage.
 *
 *   * `CHECKING`     — it ran, over everything it claims to cover.
 *   * `PARTIAL`      — it ran, and its own coverage report says not over all of it.
 *   * `NOT_CHECKING` — the control is switched off in this account. This is a
 *                      fact about the ESTATE, and it is the arm a disabled
 *                      GuardDuty detector, a missing Access Analyzer and a
 *                      repository with `scanOnPush` off all land in.
 *   * `UNREADABLE`   — this engine was refused, throttled or errored. A fact
 *                      about this CONSOLE's grants, not about the estate.
 *   * `NOT_WIRED`    — nothing in this console reads it yet. Also a fact about
 *                      this console, and named rather than omitted: a control
 *                      left off the list is a blind spot nobody can see.
 *
 * The last three are deliberately separate words. They have different remedies —
 * enable the control, grant the statement, or go and look in the AWS console —
 * and a page that collapsed them into "unknown" would be telling every operator
 * to do the wrong one of the three.
 */
export const CONTROL_STATES = [
  "NOT_CHECKING",
  "NOT_WIRED",
  "UNREADABLE",
  "PARTIAL",
  "CHECKING",
] as const

export type ControlState = (typeof CONTROL_STATES)[number]

/**
 * The word each state prints. Never the tone alone — Bible §26.3.2.
 *
 * `NOT_CHECKING` and `NOT_WIRED` say different things because they are different
 * things, and an operator has to be able to tell "AWS is not running this check"
 * from "this console does not read the check AWS is running".
 */
export const CONTROL_WORDS: Readonly<Record<ControlState, string>> = {
  NOT_CHECKING: "Not being checked",
  NOT_WIRED: "Nothing here checks it",
  UNREADABLE: "Not readable from here",
  PARTIAL: "Checked in part",
  CHECKING: "Checking",
}

/**
 * How loud each state is.
 *
 * `NOT_CHECKING` and `NOT_WIRED` are both `bad`, and that is not a mistake: the
 * operator's exposure is identical either way — the question is unanswered — and
 * the difference between them is carried by the word and by the remedy, which is
 * where a difference an operator has to act on belongs.
 */
export const CONTROL_TONE: Readonly<Record<ControlState, Tone>> = {
  NOT_CHECKING: "bad",
  NOT_WIRED: "bad",
  UNREADABLE: "warn",
  PARTIAL: "warn",
  CHECKING: "ok",
}

/** Coverage is one state, and it is the narrow one. */
export function isCovering(state: ControlState): boolean {
  return state === "CHECKING"
}

export interface ControlRow {
  /** Stable across a merge, so an arriving reader replaces its own placeholder. */
  key: string
  question: Question
  /** The control's own name, as AWS spells it. */
  control: string
  state: ControlState
  /** What an answer from it would tell an operator. */
  answers: string
  /** Why it is in this state — the reader's own sentence wherever there is one. */
  detail: string
  /** What to do about it. Never "try again", never "investigate". */
  remedy: string
  /** The IAM action behind it, when there is one to name. */
  action?: string
  /** Pasteable JSON, on the arms where a grant is the remedy. */
  minimumStatement?: string
}

const STATE_ORDER: Readonly<Record<ControlState, number>> = {
  NOT_CHECKING: 0,
  NOT_WIRED: 1,
  UNREADABLE: 2,
  PARTIAL: 3,
  CHECKING: 4,
}

/**
 * Worst first, then by the question, then by key.
 *
 * The last tiebreak compares with `<` and `>` rather than `localeCompare`, which
 * is locale-dependent and would order the same two controls differently on two
 * machines.
 */
export function sortControls(rows: readonly ControlRow[]): readonly ControlRow[] {
  return rows.slice().sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state]
    if (byState !== 0) return byState
    const byQuestion = QUESTIONS.indexOf(a.question) - QUESTIONS.indexOf(b.question)
    if (byQuestion !== 0) return byQuestion
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

/* ──────────────────────────────── the six products, as control coverage ── */

/** What each Security Hub product answers, and what switching it on costs. */
const PRODUCT_ROLE: Readonly<
  Record<string, { question: Question; answers: string; enable: string }>
> = {
  "Security Hub": {
    question: "unwatched",
    answers:
      "whether anything at all is aggregating security findings for this account, which is the precondition for the other five",
    enable:
      "Enable Security Hub in this region (securityhub:EnableSecurityHub) and turn on the standards this estate is held to. Until it is on, the five products below cannot be read through it.",
  },
  GuardDuty: {
    question: "unwatched",
    answers:
      "threat detection over CloudTrail management events, VPC flow logs and DNS queries — an empty answer from a disabled detector is not a quiet account",
    enable:
      "Enable a GuardDuty detector in this region (guardduty:CreateDetector). A detector that does not exist produces the same empty finding list as an account with nothing wrong.",
  },
  Inspector: {
    question: "exposed",
    answers: "known CVEs in running container images, EC2 instances and Lambda functions",
    enable:
      "Enable Inspector for this account (inspector2:Enable) and choose the scan types. Image scanning also needs scanOnPush on each ECR repository.",
  },
  Macie: {
    question: "exposed",
    answers: "sensitive data — student records included — sitting in S3 where it should not be",
    enable:
      "Enable Macie for this account (macie2:EnableMacie) and give it the buckets to classify. No job means no finding, not no sensitive data.",
  },
  Config: {
    question: "unencrypted",
    answers:
      "each configuration rule's verdict, including the encryption-at-rest rules — and a rule sitting at INSUFFICIENT_DATA has evaluated nothing",
    enable:
      "Turn on the Config recorder and deploy the conformance pack this estate is held to (config:PutConfigurationRecorder, config:PutConfigRule). A recorder with no rules checks nothing.",
  },
  "IAM Access Analyzer": {
    question: "exposed",
    answers: "resources this account shares with another account, an organization, or the public",
    enable:
      "Create an account or organization analyzer (access-analyzer:CreateAnalyzer). With no analyzer there are no external-access findings, which is not the same as no external access.",
  },
}

/**
 * The six aggregated products, as control coverage rather than as a footnote.
 *
 * `NOT_ENABLED` becomes `NOT_CHECKING` — the arm that says a switched-off
 * control is not a pass — and `UNKNOWN` becomes `UNREADABLE`, carrying the
 * refused action and the minimum statement the reader already worked out. The
 * detail is the reader's own sentence, not a rewording of it: two sentences
 * describing one fact drift, and the one that drifts is the one nobody reruns.
 */
export function controlsFromSources(
  sources: readonly FindingSource[],
): readonly ControlRow[] {
  return sources.map((source): ControlRow => {
    const role = PRODUCT_ROLE[source.product]
    const answers = role?.answers ?? `findings published by ${source.product}`
    const question: Question = role?.question ?? "unwatched"
    const key = `product::${source.product}`

    if (source.state === "AGGREGATED" || source.state === "DIRECT") {
      return {
        key,
        question,
        control: source.product,
        state: "CHECKING",
        answers,
        detail: source.detail,
        remedy:
          "Nothing to do for coverage. What it found, if anything, is in the ranked list on this page.",
      }
    }

    if (source.state === "NOT_ENABLED") {
      return {
        key,
        question,
        control: source.product,
        state: "NOT_CHECKING",
        answers,
        detail: source.detail,
        remedy:
          role?.enable ??
          `Enable ${source.product} in this account. Until it is on, it reports nothing and this page can prove nothing from its silence.`,
      }
    }

    return {
      key,
      question,
      control: source.product,
      state: "UNREADABLE",
      answers,
      detail: source.detail,
      remedy:
        "Grant the statement below to this engine's task role. Until it is granted nothing is known here, and this is not a report that there is nothing.",
      action: source.deniedAction,
      minimumStatement: source.minimumStatement,
    }
  })
}

/* ───────────────────────────────── this console's own two IAM controls ─── */

/**
 * The two checks this console performs itself, and how honest each one is being.
 *
 * `iam.ts` reports its own coverage — `sweepCoverage` counts the policies whose
 * documents it never received, `keyCoverage` counts the users whose keys were
 * refused — and both are the reason this page can say "checked in part" instead
 * of printing a floor as if it were a total. `AdministratorAccess` is an
 * AWS-managed policy whose document `iam:GetAccountAuthorizationDetails` does not
 * return, so a sweep reporting zero wildcards while `sweepCoverage.complete` is
 * false is a guard that cannot fail.
 */
export function controlsFromIam(
  readState: string,
  posture: IamPosture | null,
): readonly ControlRow[] {
  const wildcardAnswers =
    "which principals hold `Action: \"*\"`, `Resource: \"*\"`, a service-wide grant, a NotAction, or a trust policy any principal can assume"
  const keyAnswers =
    "which IAM users hold an ACTIVE access key older than this console's threshold, by key id and by age"

  if (posture === null) {
    if (readState === "EMPTY") {
      return [
        {
          key: "iam::wildcards",
          question: "exposed",
          control: "IAM policy wildcard sweep",
          state: "CHECKING",
          answers: wildcardAnswers,
          detail:
            "iam:GetAccountAuthorizationDetails answered and this account reported no role and no user, so there is no policy document to sweep.",
          remedy:
            "Nothing to do. An account with no principals is a real and checkable answer, not a blank.",
        },
        {
          key: "iam::key-age",
          question: "unrotated",
          control: "IAM access key age",
          state: "CHECKING",
          answers: keyAnswers,
          detail:
            "iam:GetAccountAuthorizationDetails answered and this account reported no user, so there is no user who could hold an access key.",
          remedy: "Nothing to do. No user means no long-lived key, rather than none found.",
        },
      ]
    }

    const detail = `not read — iam:GetAccountAuthorizationDetails came back ${readState}, so no policy was swept and no key was aged.`
    const remedy =
      "Grant the statement below to this engine's task role. Until it is granted this console has checked nothing here, which is not the same as having found nothing."
    return [
      {
        key: "iam::wildcards",
        question: "exposed",
        control: "IAM policy wildcard sweep",
        state: "UNREADABLE",
        answers: wildcardAnswers,
        detail,
        remedy,
        action: "iam:GetAccountAuthorizationDetails",
        minimumStatement: minimumStatementText("iam:GetAccountAuthorizationDetails"),
      },
      {
        key: "iam::key-age",
        question: "unrotated",
        control: "IAM access key age",
        state: "UNREADABLE",
        answers: keyAnswers,
        detail,
        remedy,
        action: "iam:ListAccessKeys",
        minimumStatement: minimumStatementText("iam:ListAccessKeys"),
      },
    ]
  }

  return [
    {
      key: "iam::wildcards",
      question: "exposed",
      control: "IAM policy wildcard sweep",
      state: posture.sweepCoverage.complete ? "CHECKING" : "PARTIAL",
      answers: wildcardAnswers,
      detail: posture.sweepCoverage.detail,
      remedy: posture.sweepCoverage.complete
        ? "Nothing to do for coverage. Every wildcard the sweep found is in the ranked list on this page."
        : "Read the unswept policies by name in the AWS console, or replace the AWS-managed policies they refer to with customer-managed copies this read can return. Until then the wildcard count on this page is a floor.",
      action: "iam:GetAccountAuthorizationDetails",
    },
    {
      key: "iam::key-age",
      question: "unrotated",
      control: "IAM access key age",
      state: posture.keyCoverage.complete ? "CHECKING" : "PARTIAL",
      answers: keyAnswers,
      detail: posture.keyCoverage.detail,
      remedy: posture.keyCoverage.complete
        ? "Nothing to do for coverage. Every long-lived key is in the ranked list on this page."
        : "Grant iam:ListAccessKeys on the users that refused, named in the detail. Until then the long-lived key count on this page is a floor and not a total.",
      action: "iam:ListAccessKeys",
      minimumStatement: minimumStatementText("iam:ListAccessKeys"),
    },
  ]
}

/* ─────────────────────────────────────── the controls nothing here reads ── */

interface UnwiredSpec {
  key: string
  question: Question
  control: string
  capability: Capability
  /** What a disabled instance of this control looks like, so it is recognisable. */
  detail: string
  remedy: string
}

/**
 * Controls this estate can have that NOTHING in this console reads yet.
 *
 * Declared rather than omitted, and this is the deliberate part. A page that
 * lists only the controls it happens to have a reader for is a page whose
 * coverage summary improves every time a reader is deleted. Each row names the
 * exact IAM action that would answer it and carries the same pasteable minimum
 * statement every other refusal on this console carries, so the remedy is the
 * operator's real one: go and read it in the AWS console, and know meanwhile
 * that this page is not answering that question.
 *
 * `controlsFor` merges live rows over these BY KEY, so a reader landing later
 * displaces its own placeholder with no edit here — which is why the keys match
 * the ones a live builder would produce.
 */
export const UNWIRED_CONTROLS: readonly UnwiredSpec[] = [
  {
    key: "guardduty::detectors",
    question: "unwatched",
    control: "GuardDuty detector state",
    capability: "guardduty:ListDetectors",
    detail:
      "read directly rather than through Security Hub. A detector that is disabled, or suspended, still aggregates as a product with no findings.",
    remedy:
      "Open GuardDuty in this region and confirm a detector exists and is enabled. An empty finding list from a disabled detector is indistinguishable, on this page, from a quiet account.",
  },
  {
    key: "analyzer::exists",
    question: "exposed",
    control: "Access Analyzer existence",
    capability: "access-analyzer:ListAnalyzers",
    detail:
      "whether an analyzer exists at all. An account with no analyzer has no external-access findings, and that is not the same as no external access.",
    remedy:
      "Open IAM Access Analyzer and confirm an account or organization analyzer exists in this region.",
  },
  {
    key: "config::rule-compliance",
    question: "unencrypted",
    control: "Config rule verdicts",
    capability: "config:DescribeComplianceByConfigRule",
    detail:
      "each rule's own verdict. A rule at INSUFFICIENT_DATA has evaluated nothing and reports no non-compliant resource, which reads exactly like a rule that passed.",
    remedy:
      "Open AWS Config and read the rule list, treating INSUFFICIENT_DATA as unchecked rather than as compliant.",
  },
  {
    key: "ecr::scan-on-push",
    question: "unwatched",
    control: "ECR image scanning",
    capability: "ecr:DescribeImageScanFindings",
    detail:
      "per-repository scan results. A repository with scanOnPush off returns no scan findings for every image in it.",
    remedy:
      "Open ECR and confirm scanOnPush is set on every repository this estate deploys from.",
  },
  {
    key: "s3::public-access",
    question: "exposed",
    control: "S3 public access block",
    capability: "s3:GetBucketPublicAccessBlock",
    detail:
      "whether each bucket blocks public access. A bucket with no block is not reported by anything on this page.",
    remedy:
      "Open S3 and confirm the account-level and bucket-level public access blocks are on.",
  },
  {
    key: "s3::encryption",
    question: "unencrypted",
    control: "S3 default encryption",
    capability: "s3:GetBucketEncryption",
    detail: "whether each bucket encrypts by default, and under which key.",
    remedy: "Open S3 and confirm default encryption is set on every bucket holding tenant data.",
  },
  {
    key: "kms::rotation",
    question: "unrotated",
    control: "KMS key rotation",
    capability: "kms:GetKeyRotationStatus",
    detail: "whether automatic annual rotation is on for each customer-managed key.",
    remedy: "Open KMS and confirm rotation is enabled on every customer-managed key.",
  },
  {
    key: "secrets::rotation",
    question: "unrotated",
    control: "Secrets Manager rotation",
    capability: "secretsmanager:ListSecrets",
    detail:
      "when each secret last changed and whether rotation is configured — never a value.",
    remedy:
      "Open Secrets Manager and confirm rotation is configured on every secret this platform reads.",
  },
  {
    key: "cloudtrail::logging",
    question: "unwatched",
    control: "CloudTrail delivery",
    capability: "cloudtrail:GetTrailStatus",
    detail:
      "whether a trail is logging right now. A trail that was created correctly and then stopped describes identically to one that is delivering.",
    remedy: "Open CloudTrail and confirm every trail is logging and delivering.",
  },
  {
    key: "waf::web-acls",
    question: "exposed",
    control: "WAF web ACL association",
    capability: "wafv2:ListWebACLs",
    detail:
      "which web ACLs exist and what they are attached to. An unassociated ACL blocks nothing.",
    remedy: "Open WAF and confirm a web ACL is associated with every public distribution and load balancer.",
  },
]

/** The unwired list, as rows, with the registry's own words for what it reads. */
export function unwiredControls(): readonly ControlRow[] {
  return UNWIRED_CONTROLS.map((spec): ControlRow => ({
    key: spec.key,
    question: spec.question,
    control: spec.control,
    state: "NOT_WIRED",
    answers: CAPABILITIES[spec.capability].reads,
    detail: `nothing in this console calls ${spec.capability} — ${spec.detail}`,
    remedy: spec.remedy,
    action: spec.capability,
    minimumStatement: minimumStatementText(spec.capability),
  }))
}

/**
 * Every control, live rows winning over placeholders, worst first.
 *
 * The merge is by key and the live row wins outright. That is what makes this
 * page compose rather than accumulate: a reader landing for GuardDuty detectors
 * emits a row keyed `guardduty::detectors`, and the placeholder disappears with
 * no edit to `UNWIRED_CONTROLS`.
 */
export function controlsFor(live: readonly ControlRow[]): readonly ControlRow[] {
  const byKey = new Map<string, ControlRow>()
  for (const row of unwiredControls()) byKey.set(row.key, row)
  for (const row of live) byKey.set(row.key, row)
  return sortControls([...byKey.values()])
}

/** The controls that are not covering anything. The point of the page. */
export function gaps(rows: readonly ControlRow[]): readonly ControlRow[] {
  return rows.filter((row) => !isCovering(row.state))
}

/** The controls that are. Kept separate so neither list can be read as the other. */
export function covering(rows: readonly ControlRow[]): readonly ControlRow[] {
  return rows.filter((row) => isCovering(row.state))
}

/* ────────────────────────────────────────────── coverage, per question ─── */

export interface QuestionCoverage {
  question: Question
  meaning: string
  checking: number
  total: number
  /** The sentence a chip prints. Never a bare fraction. */
  detail: string
}

/**
 * How much of each of the four words is actually being asked.
 *
 * A question with no control at all reads `0 of 0`, and that is stated as
 * "nothing on this page asks it" rather than as a fraction, because `0 of 0` is
 * the one fraction a reader can mistake for complete.
 */
export function coverageByQuestion(
  rows: readonly ControlRow[],
): readonly QuestionCoverage[] {
  return QUESTIONS.map((question) => {
    const mine = rows.filter((row) => row.question === question)
    const checking = mine.filter((row) => isCovering(row.state)).length
    return {
      question,
      meaning: QUESTION_MEANING[question],
      checking,
      total: mine.length,
      detail:
        mine.length === 0
          ? "nothing on this page asks it"
          : checking === 0
            ? `no control is checking it — ${mine.length} listed, none of them running`
            : checking === mine.length
              ? `all ${mine.length} of its controls are checking`
              : `${checking} of ${mine.length} of its controls are checking`,
    }
  })
}

/* ──────────────────────────────────────────── everything that was found ── */

export interface Exposure {
  key: string
  severity: Severity
  /**
   * Whose severity this is.
   *
   * `product` means Security Hub's own label, passed through untouched.
   * `console` means this file's classification table, which is a policy of this
   * platform and is labelled as such wherever it is printed. Mixing the two
   * without saying which is which is how an operator ends up escalating a
   * severity nobody at AWS assigned.
   */
  severitySource: "product" | "console"
  /** The type, exactly as its source spells it. Never reworded, never mapped. */
  type: string
  /** The source's own sentence about this row. */
  detail: string
  /** What it is about: an ARN, a key id, a principal. Null when there is none. */
  resource: string | null
  /** Which product or check produced it. */
  source: string
  ageHours: number | null
  pastSla: boolean
  /** What to do about this one. Specific to the row, never "investigate". */
  remedy: string
}

const SEVERITY_ORDER: readonly Severity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFORMATIONAL",
]

/** The lowercase vocabulary `components/md3/SeverityChip.tsx` takes. */
export const CHIP_SEVERITY: Readonly<Record<Severity, ChipSeverity>> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFORMATIONAL: "informational",
}

function severityRank(severity: Severity): number {
  const at = SEVERITY_ORDER.indexOf(severity)
  // An unranked severity sorts LAST rather than first, for the same reason
  // `./answer.ts` does it: a row nobody has classified must not outrank an open
  // CRITICAL.
  return at === -1 ? SEVERITY_ORDER.length : at
}

/**
 * Security Hub's findings, as rows on the ranked list.
 *
 * `type` is the finding's own title and `source` is the product's own name, both
 * passed through untouched. Security Hub also carries an ASFF `Types[]`
 * taxonomy and a `Remediation.Recommendation`, and `lib/aws/findings.ts` does
 * not request either — so the remedy below says where the product's own
 * remediation text is rather than inventing one. Writing a plausible remedy for
 * a finding this console never read the remediation of would be a fabrication
 * with a helpful tone.
 *
 * `describeAffects` is a parameter rather than an import so this module stays
 * free of runtime dependencies; the page passes `describeAttribution`.
 */
export function exposuresFromFindings(
  findings: readonly SecurityFinding[],
  describeAffects: (finding: SecurityFinding) => string,
): readonly Exposure[] {
  return findings.map((finding): Exposure => ({
    key: `finding::${finding.key}`,
    severity: finding.severity,
    severitySource: "product",
    type: finding.title,
    detail: `${describeAffects(finding)} · record ${finding.recordState} · first observed ${finding.firstObservedAt}`,
    resource: finding.resourceIds[0] ?? null,
    source: finding.product,
    ageHours: finding.ageHours,
    pastSla: finding.pastSla,
    remedy:
      "Open this finding in Security Hub and apply the remediation it carries. Its Remediation.Recommendation text is not requested by this console's reader, so it is not reproduced here rather than guessed at.",
  }))
}

/**
 * How bad each kind of wildcard is, as a policy of this platform.
 *
 * Declared here, once, and labelled `console` on every row it produces. A trust
 * policy any principal can assume sits beside `Action: "*" on Resource: "*"`
 * because both hand the account to somebody who was never named; a prefix grant
 * is LOW because it is a real widening that has not widened yet.
 */
export const WILDCARD_SEVERITY: Readonly<Record<WildcardKind, Severity>> = {
  ADMIN: "CRITICAL",
  ANY_PRINCIPAL: "CRITICAL",
  ALL_ACTIONS: "HIGH",
  ALL_RESOURCES: "HIGH",
  NEGATED: "HIGH",
  SERVICE_WIDE: "MEDIUM",
  PREFIX: "LOW",
}

const WILDCARD_REMEDY: Readonly<Record<WildcardKind, string>> = {
  ADMIN:
    "Replace the statement with the actions this principal actually calls, on the ARNs it actually touches. A policy named for a job and granting everything is administrator access under another name.",
  ALL_ACTIONS:
    "Replace `Action: \"*\"` with the actions this principal calls. A resource scope does not narrow an action list that already includes every action AWS will ever ship.",
  ALL_RESOURCES:
    "Replace `Resource: \"*\"` with the ARNs this principal touches. Every resource in the account includes the ones created after this policy was reviewed.",
  SERVICE_WIDE:
    "Replace the `service:*` grant with the exact actions. A service wildcard grows on its own every time AWS adds an API to that service.",
  PREFIX:
    "Replace the action prefix with the exact actions. `iam:Put*` widens the day AWS ships a new `Put` API, with no change to this policy and no review.",
  NEGATED:
    "Rewrite the NotAction or NotResource as an explicit Allow list. An Allow-everything-except is a grant nobody can enumerate, and it grows with the service.",
  ANY_PRINCIPAL:
    "Name the principals in the trust policy, or add a Condition that binds it to this account or organization. A trust policy any principal can assume is an account anybody can enter.",
}

/**
 * This console's own IAM sweep, as rows on the ranked list.
 *
 * `type` is the `WildcardKind` verbatim — `ADMIN`, `ANY_PRINCIPAL` — because
 * that is the word `lib/aws/iam.ts` classified it as and an operator comparing
 * this page against that module must be reading the same token. `conditioned` is
 * carried into the detail rather than used to downgrade the row: a Condition
 * narrows a wildcard, it does not remove it.
 */
export function exposuresFromWildcards(
  wildcards: readonly IamWildcard[],
): readonly Exposure[] {
  return wildcards.map((wildcard): Exposure => ({
    key: `wildcard::${wildcard.principalArn}::${wildcard.source}::${wildcard.policyName}::${wildcard.statementIndex}`,
    severity: WILDCARD_SEVERITY[wildcard.kind] ?? "MEDIUM",
    severitySource: "console",
    type: wildcard.kind,
    detail: `${wildcard.detail}${wildcard.conditioned ? " A Condition narrows this statement; it does not remove the wildcard." : ""}`,
    resource: wildcard.principalArn,
    source: `IAM ${wildcard.source} policy ${wildcard.policyName}`,
    ageHours: null,
    pastSla: false,
    remedy: WILDCARD_REMEDY[wildcard.kind] ?? "Narrow the statement to the actions and resources this principal uses.",
  }))
}

/**
 * A key this platform considers past rotating, and a key long past it.
 *
 * `LONG_LIVED_KEY_DAYS` in `lib/aws/iam.ts` decides which keys appear at all;
 * this decides how loud each one is once it has. A year is the second threshold
 * because a key older than the longest plausible review cycle has outlived every
 * process that might have caught it. Both numbers are this platform's policy and
 * every row they produce is labelled `console`.
 */
export const KEY_SEVERE_DAYS = 365

/** This console's IAM access keys, as rows on the ranked list. */
export function exposuresFromKeys(keys: readonly IamAccessKey[]): readonly Exposure[] {
  return keys.map((key): Exposure => ({
    key: `access-key::${key.accessKeyId}`,
    severity: key.ageDays !== null && key.ageDays >= KEY_SEVERE_DAYS ? "HIGH" : "MEDIUM",
    severitySource: "console",
    type: "Long-lived IAM access key",
    detail: key.detail,
    resource: key.accessKeyId,
    source: `IAM user ${key.userName}`,
    ageHours: key.ageDays === null ? null : key.ageDays * 24,
    pastSla: false,
    remedy: `Create a replacement key, move every caller onto it, then run \`aws iam update-access-key --user-name ${key.userName} --access-key-id ${key.accessKeyId} --status Inactive\` and delete it once nothing has broken.`,
  }))
}

/**
 * Worst first, then whatever is past its allowance, then oldest, then by key.
 *
 * The same ladder `./answer.ts` sorts findings by, applied across sources so a
 * CRITICAL from GuardDuty and an `ADMIN` wildcard this console found sit
 * together — an operator triaging by severity should not have to read two
 * tables to find the worst thing that is true.
 */
export function rankExposures(exposures: readonly Exposure[]): readonly Exposure[] {
  return exposures.slice().sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity)
    if (bySeverity !== 0) return bySeverity
    if (a.pastSla !== b.pastSla) return a.pastSla ? -1 : 1
    const ageA = a.ageHours ?? -1
    const ageB = b.ageHours ?? -1
    if (ageA !== ageB) return ageB - ageA
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

/* ──────────────────────────────────────────────────── the page's answer ── */

export interface PostureVerdict {
  verdict: string
  tone: Tone
  /** One sentence answering the question in the heading. */
  headline: string
  /** Why the verdict is that, naming the coverage it rests on. */
  because: string
}

function countStates(rows: readonly ControlRow[]): Readonly<Record<ControlState, number>> {
  const counts = { NOT_CHECKING: 0, NOT_WIRED: 0, UNREADABLE: 0, PARTIAL: 0, CHECKING: 0 }
  for (const row of rows) counts[row.state] += 1
  return counts
}

/**
 * The one thing an operator opened this page to learn.
 *
 * The order is the argument, and it is coverage-first on purpose:
 *
 *   1. is anything checking at all      — if not, nothing below it means anything
 *   2. is anything CRITICAL open        — the loudest thing that is true
 *   3. is anything open at all          — the count, and the worst severity in it
 *   4. is any control not checking      — clean FROM WHAT RAN, which is not clean
 *   5. otherwise                        — clear, and every control answered
 *
 * Step 4 is the one this whole module exists for. Without it, an account with a
 * disabled GuardDuty detector, no Access Analyzer and a Config rule sitting at
 * INSUFFICIENT_DATA renders exactly like an account somebody has been looking
 * after — the four controls return nothing, the findings list is empty, and the
 * page says so. Step 5 is unreachable while a single control is in any state but
 * CHECKING, which is the property `posture.test.ts` mutates to prove.
 */
export function postureVerdict(input: {
  controls: readonly ControlRow[]
  exposures: readonly Exposure[]
}): PostureVerdict {
  const counts = countStates(input.controls)
  const checking = counts.CHECKING
  const gapCount = input.controls.length - checking
  const coverage =
    `${checking} of ${input.controls.length} listed controls are checking: ` +
    `${counts.NOT_CHECKING} switched off in the account, ${counts.NOT_WIRED} that nothing here reads, ` +
    `${counts.UNREADABLE} this engine was not allowed to read, ${counts.PARTIAL} covering only part of what they claim.`

  if (checking === 0 && counts.PARTIAL === 0) {
    return {
      verdict: "Nothing is checking",
      tone: "bad",
      headline:
        "No control is asking whether anything in this estate is exposed, unencrypted, unrotated or unwatched.",
      because: `${coverage} Nothing on this page below this line is evidence of anything: an estate nobody is inspecting produces the same empty list as an estate with nothing wrong.`,
    }
  }

  const worst = SEVERITY_ORDER.find((severity) =>
    input.exposures.some((exposure) => exposure.severity === severity),
  )

  if (worst === "CRITICAL") {
    const critical = input.exposures.filter((e) => e.severity === "CRITICAL").length
    return {
      verdict: "Critical exposure",
      tone: "bad",
      headline: `${critical} CRITICAL ${critical === 1 ? "exposure is" : "exposures are"} open in this estate, out of ${input.exposures.length} in total.`,
      because: `${coverage} Everything else on this page is context for the critical rows at the top of the ranked list.`,
    }
  }

  if (worst !== undefined) {
    return {
      verdict: "Exposures open",
      tone: worst === "HIGH" ? "bad" : "warn",
      headline: `${input.exposures.length} ${input.exposures.length === 1 ? "exposure is" : "exposures are"} open in this estate, the worst of them ${worst}.`,
      because: `${coverage} Nothing here is a total: an exposure of a kind nobody is checking for cannot appear in this list at all.`,
    }
  }

  if (gapCount > 0) {
    return {
      verdict: "Partly answered",
      tone: "warn",
      headline: `Nothing was found by the ${checking} control${checking === 1 ? "" : "s"} that ${checking === 1 ? "is" : "are"} checking, and ${gapCount} of ${input.controls.length} controls ${gapCount === 1 ? "is" : "are"} not checking at all.`,
      because: `${coverage} This is a clean result from what ran, and it says nothing whatsoever about the ${gapCount} question${gapCount === 1 ? "" : "s"} nobody asked. It is not a clean bill of health and this page will not print one until every control answers.`,
    }
  }

  return {
    verdict: "Clear",
    tone: "ok",
    headline:
      "Every control on this page is checking, and none of them has found anything exposed, unencrypted, unrotated or unwatched.",
    because: `${coverage} This is coverage rather than an absence of bad news, which is the only condition under which this page says clear.`,
  }
}
