import { Fragment } from "react"

import { auth } from "@/lib/auth"
import {
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState,
  SeverityChip,
  UnknownState,
  type DataColumn,
  type UnknownRead,
} from "@/components/md3"
import {
  complianceReadings,
  describeAggregationReading,
  describeComplianceAttribution,
  describeComplianceHealth,
  describeComplianceTruncation,
  describeConfigRule,
  describeEnablement,
  describeRecorder,
  describeRuleHealth,
  describeRuleScope,
  type ConfigRuleReading,
} from "@/lib/aws/compliance"
import {
  securityFindings,
  SEVERITY_SLA_HOURS,
  type SecurityFinding,
} from "@/lib/aws/findings"
import {
  DETECTOR_CONFIGURATION_NOT_READABLE,
  describeDetectorConfiguration,
  describeGuardDutyAttribution,
  describeGuardDutyPosture,
  describePageBound,
  guardDutyCoverage,
  guardDutyReadings,
  type DetectorReading,
} from "@/lib/aws/guardduty"
import { iamPosture } from "@/lib/aws/iam"
import type { AwsRead } from "@/lib/aws/read"
import { describeAttribution } from "@/lib/aws/tags"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

import styles from "./security.module.css"
import {
  asOf,
  leadAnswer,
  provenanceOf,
  readAnswered,
  scopeOf,
  scopeSentence,
  slaRows,
  statedAsOf,
  SEVERITY_RANK,
  countBySeverity,
  answeredSources,
} from "./answer"
import {
  CHIP_SEVERITY,
  CONTROL_TONE,
  CONTROL_WORDS,
  RULE_HEALTH_TONE,
  RULE_HEALTH_WORDS,
  UNSTATED_SEVERITY_WORD,
  complianceBadge,
  controlsFor,
  controlsFromCompliance,
  controlsFromGuardDuty,
  controlsFromIam,
  controlsFromSources,
  coverageByQuestion,
  covering,
  exposuresFromConfigRules,
  exposuresFromFindings,
  exposuresFromGuardDuty,
  exposuresFromKeys,
  exposuresFromWildcards,
  gaps,
  guardDutyBadge,
  postureVerdict,
  rankExposures,
  type ControlRow,
  type Exposure,
} from "./posture"

export const dynamic = "force-dynamic"

/**
 * STUDIO-110-006 — security posture: what in this estate is exposed,
 * unencrypted, unrotated or unwatched.
 *
 * ── The question, and why the shape of the page follows from it ────────────
 *
 * That sentence is at the top of the page in words before any apparatus,
 * because it is the only reason an operator opens this route. Everything below
 * it is arranged to answer it and nothing else: the verdict, then the controls
 * that are NOT answering it, then what the ones that are have found.
 *
 * ── The rule this page is built around ─────────────────────────────────────
 *
 * **An absence of findings from a control that is not running is not a pass.**
 *
 * A disabled GuardDuty detector returns no findings. An account with no Access
 * Analyzer has no external-access findings. A repository with `scanOnPush` off
 * has no image findings. A Config rule at `INSUFFICIENT_DATA` has no
 * non-compliant resources. Through a naive page every one of those renders as a
 * clean estate, and telling "checked and clean" from "not being checked" is the
 * entire value of this surface.
 *
 * So coverage is a first-class model — `ControlState` in `./posture.ts`, of
 * whose five arms only `CHECKING` counts — and the controls that are not
 * checking get their OWN CARD, above the findings, rather than a column in a
 * table nobody scrolls to. `postureVerdict` cannot reach its clear arm while a
 * single control sits in any other arm, which is the property
 * `posture.test.ts` mutates to prove.
 *
 * ── What it reads ──────────────────────────────────────────────────────────
 *
 *   * `securityFindings()` — Security Hub, and per-product whether each of the
 *     six actually reported. `NOT_ENABLED` becomes a not-checking control;
 *     `UNKNOWN` becomes an unreadable one carrying its minimum IAM statement.
 *   * `iamPosture()` — this console's own two checks, and the first production
 *     caller `lib/aws/iam.ts` has ever had: the policy wildcard sweep answers
 *     "exposed", access-key age answers "unrotated", and BOTH report their own
 *     coverage, so a sweep that could not read an AWS-managed policy document
 *     renders as "checked in part" rather than as zero wildcards.
 *
 * Controls nothing here reads yet — GuardDuty detector state, Access Analyzer
 * existence, Config rule verdicts, ECR scanning, S3 public access and
 * encryption, KMS and Secrets rotation, CloudTrail delivery, WAF association —
 * are DECLARED as not-checking rather than omitted. A page that lists only what
 * it has a reader for is a page whose coverage improves when a reader is
 * deleted. `controlsFor` merges live rows over those placeholders by key, so a
 * reader landing later displaces its own row with no edit to this file.
 *
 * ── It renders without AWS ─────────────────────────────────────────────────
 *
 * Nothing here throws when STS, Security Hub and IAM are unreachable. Every
 * refusal is an arm of `AwsRead`, every arm renders through the shared
 * `UnknownState` carrying the principal, the action and a pasteable minimum
 * statement, and neither table is drawn from a read that did not answer. A
 * console that 500s for want of credentials is not a refusal anyone can act on.
 */

/**
 * The arms of a reading that carry no value, narrowed.
 *
 * `isUnknown` in `lib/aws/read.ts` returns a boolean rather than a type
 * predicate, and `UnknownState` accepts only the four valueless arms — so the
 * narrowing happens here, as a `switch` the compiler can follow. Returning
 * `null` for the value-carrying arms is what makes "render the panel only when
 * there is something to say" a type-level fact rather than a convention.
 */
function unknownArm(read: AwsRead<unknown>): UnknownRead | null {
  switch (read.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return read
    default:
      return null
  }
}

export default async function SecurityPage() {
  if (operatorConfigProblems().length > 0) {
    return (
      <div className="misconfigured">
        <h1>Not configured</h1>
        <p>The Studio refuses to serve until its access control is set up.</p>
      </div>
    )
  }

  const session = await auth()
  if (!isOperator(session?.user?.email)) {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }

  const surface = await securityFindings()
  const iam = await iamPosture()
  /*
   * The two dark readers, read together.
   *
   * Both were real, tested modules with a capability and an IAM grant that no
   * page imported, so the work they do reached no screen. They are read in
   * parallel with each other because neither depends on the other's answer and
   * both resolve their own identity; they are read AFTER the two above because
   * an operator waiting on this page should get the Security Hub answer no later
   * than they did before this card existed.
   */
  const [guard, config] = await Promise.all([guardDutyReadings(), complianceReadings()])

  const identity = surface.identity
  const known = identity.state === "ACTUAL" || identity.state === "STALE" ? identity.value : null

  const hubAnswered = readAnswered(surface.read.state)
  const iamAnswered = readAnswered(iam.read.state)
  /**
   * Whether ANY source of rows answered.
   *
   * The ranked table is drawn only when this is true. Two reads feed it now, so
   * gating on the Security Hub read alone would drop real IAM wildcards off the
   * page the moment `securityhub:GetFindings` is refused — and gating on
   * neither would draw a table headed "what this console found" from an estate
   * nobody was allowed to look at, which reads as "there is nothing".
   */
  const guardAnswered = readAnswered(guard.detectors.state)
  const configAnswered = readAnswered(config.rules.state)
  const answered = hubAnswered || iamAnswered || guardAnswered || configAnswered

  const hubLead = leadAnswer(surface.read.state, surface.findings, surface.sources)
  const counts = countBySeverity(surface.findings)
  const reporting = answeredSources(surface.sources)

  /* ── the two dark readers, narrowed ─────────────────────────────────────
   *
   * `AwsRead` has no arm carrying an optional value, so these narrowings are the
   * only way to a `T` — and the `[]` fallbacks below are NOT the reassuring
   * default this console refuses. A refused detector listing is carried into the
   * page by `guard.detectors` itself, which is rendered through `UnknownState`
   * and drives `guardDutyCoverage` into its `UNREADABLE` arm; the empty array is
   * only ever the row source for a table that is not drawn in that case.
   */
  const detectors: readonly DetectorReading[] =
    guard.detectors.state === "ACTUAL" || guard.detectors.state === "STALE"
      ? guard.detectors.value
      : []
  const guardFindings = detectors.flatMap((detector) =>
    detector.findings.state === "ACTUAL" || detector.findings.state === "STALE"
      ? detector.findings.value
      : [],
  )
  const configRules: readonly ConfigRuleReading[] =
    config.rules.state === "ACTUAL" || config.rules.state === "STALE" ? config.rules.value : []

  const guardCoverage = guardDutyCoverage(guard)

  const controls = controlsFor([
    ...controlsFromSources(surface.sources),
    ...controlsFromIam(iam.read.state, iam.posture),
    // GuardDuty's own two rows: the detector listing's coverage, which the reader
    // itself derives, and the status-and-protection-plans question no capability
    // in this build can ask. The first displaces the `guardduty::detectors`
    // placeholder by key; the second is a row that was never even declared.
    ...controlsFromGuardDuty(guardCoverage, DETECTOR_CONFIGURATION_NOT_READABLE),
    // Config's two: the rule verdicts, and whether the recorder those verdicts
    // depend on is recording anything at all.
    ...controlsFromCompliance(config, {
      enablement: describeEnablement(config.enablement),
      health: describeComplianceHealth(config.health),
      recorder: describeRecorder(config.enablement.recorder),
      truncation: describeComplianceTruncation(config.truncation),
    }),
  ])
  const notChecking = gaps(controls)
  const checking = covering(controls)
  const coverage = coverageByQuestion(controls)

  const exposures = rankExposures([
    ...exposuresFromFindings(surface.findings, (finding) => describeAttribution(finding.affects)),
    ...exposuresFromWildcards(iam.posture?.wildcards ?? []),
    ...exposuresFromKeys(iam.posture?.longLivedKeys ?? []),
    // GuardDuty read DIRECTLY, not through Security Hub's aggregation: a finding
    // type is carried verbatim, and a finding AWS stated no severity for is
    // ranked first rather than filed as informational.
    ...exposuresFromGuardDuty(guardFindings, {
      describeAttribution: (finding) => describeGuardDutyAttribution(finding.attribution),
      slaHours: SEVERITY_SLA_HOURS,
      // The reader's own `asOf`, so every age on the page is measured from the
      // instant that load was assembled rather than from four different clocks.
      now: new Date(guard.asOf),
    }),
    // Only the rules that are FAILING. A rule at INSUFFICIENT_DATA is a hole and
    // is counted by the control row above, never as something that was found.
    ...exposuresFromConfigRules(configRules, describeConfigRule),
  ])

  const verdict = postureVerdict({ controls, exposures })

  const scope = scopeOf({
    identityState: identity.state,
    accountId: known?.accountId,
    region: known?.region,
    partition: known?.partition,
    principal: known?.arn,
  })

  const provenance = provenanceOf({
    identityState: identity.state,
    accountId: known?.accountId,
    region: known?.region,
    partition: known?.partition,
    principal: known?.arn,
    readState: surface.read.state,
    refreshMs: surface.refreshMs,
    asOf: surface.asOf,
    duplicatesRemoved: surface.duplicatesRemoved,
  })

  const hubUnknown = unknownArm(surface.read)
  const iamUnknown = unknownArm(iam.read)
  const detectorsUnknown = unknownArm(guard.detectors)
  const rulesUnknown = unknownArm(config.rules)
  const aggregationUnknown = unknownArm(config.aggregation)
  /*
   * The per-detector reads, each under its OWN action.
   *
   * `guarduty:ListFindings` and `guardduty:GetFindings` are separate IAM actions
   * and the reader keeps them apart, so a role granted the first and not the
   * second gets the statement it is actually missing. One panel per refused read,
   * named by detector, rather than one panel for "GuardDuty".
   */
  const detectorUnknowns = detectors.flatMap((detector) => {
    const ids = unknownArm(detector.findingIds)
    const findings = unknownArm(detector.findings)
    return [
      ...(ids ? [{ key: `${detector.detectorId}::ids`, what: `detector ${detector.detectorId}'s finding ids`, read: ids }] : []),
      ...(findings
        ? [{ key: `${detector.detectorId}::findings`, what: `detector ${detector.detectorId}'s findings`, read: findings }]
        : []),
    ]
  })

  /* ── the two tables, as data ─────────────────────────────────────────── */

  /**
   * A control, and why it is or is not answering.
   *
   * The state column carries the WORD as well as the tone — Bible §26.3.2, and
   * on this page in particular, because "not being checked" and "checking" are
   * the two things a reader must never confuse and colour alone cannot be the
   * carrier of that.
   */
  const controlColumns: readonly DataColumn<ControlRow>[] = [
    {
      key: "control",
      header: "Control",
      cell: (row) => (
        <div className={styles.cell}>
          <span>{row.control}</span>
          <span className="md3-body-small">answers: {row.question}</span>
        </div>
      ),
    },
    {
      key: "state",
      header: "State",
      cell: (row) => <Badge tone={CONTROL_TONE[row.state]}>{CONTROL_WORDS[row.state]}</Badge>,
    },
    {
      key: "answers",
      header: "What an answer would tell you",
      cell: (row) => <div className={styles.cell}>{row.answers}</div>,
    },
    {
      key: "why",
      header: "Why it is in that state",
      cell: (row) => (
        <div className={styles.cell}>
          <span>{row.detail}</span>
          {row.action ? (
            <span className={`md3-body-small ${styles.identifier}`}>{row.action}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "remedy",
      header: "Remedy",
      cell: (row) => (
        <div className={styles.cell}>
          <span>{row.remedy}</span>
          {row.minimumStatement ? (
            <code className={`md3-body-small ${styles.identifier}`}>{row.minimumStatement}</code>
          ) : null}
        </div>
      ),
    },
  ]

  /**
   * One exposure, ranked.
   *
   * The type is the source's own word — a Security Hub finding's title, or the
   * `WildcardKind` `lib/aws/iam.ts` classified a statement as — and is never
   * reworded, so an operator comparing this page against the AWS console or
   * against that module is reading the same token. The severity column says
   * WHOSE severity it is: `product` is Security Hub's own label, `console` is
   * this platform's classification table in `./posture.ts`.
   */
  const exposureColumns: readonly DataColumn<Exposure>[] = [
    {
      key: "severity",
      header: "Severity",
      cell: (exposure) => (
        <div className={styles.cell}>
          {/*
            A row with no severity is not given one. `SeverityChip` takes the
            five-word vocabulary and nothing else, so an unstated row renders as
            a badge carrying the WORD — Bible §26.3.2 — rather than borrowing the
            informational chip, which is how a rank nobody measured becomes the
            quietest one on the page.
          */}
          {exposure.severity === "UNSTATED" ? (
            <Badge tone="bad">{UNSTATED_SEVERITY_WORD}</Badge>
          ) : (
            <SeverityChip severity={CHIP_SEVERITY[exposure.severity]}>
              {exposure.severity}
            </SeverityChip>
          )}
          <span className="md3-body-small">
            {exposure.severitySource === "product"
              ? "the product's own label"
              : exposure.severitySource === "console"
                ? "this console's classification"
                : "its source stated none, and this console will not assign one"}
          </span>
          {exposure.pastSla ? <span className="md3-body-small">past SLA</span> : null}
        </div>
      ),
    },
    {
      key: "type",
      header: "Type, verbatim",
      cell: (exposure) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{exposure.type}</span>
          <span className="md3-body-small">{exposure.source}</span>
        </div>
      ),
    },
    {
      key: "about",
      header: "What it is about",
      cell: (exposure) => (
        <div className={styles.cell}>
          <span>{exposure.detail}</span>
          {exposure.resource === null ? (
            <span className="md3-body-small">
              no resource id came with this row, so nothing can be attributed from it
            </span>
          ) : (
            <span className={`md3-body-small ${styles.identifier}`}>{exposure.resource}</span>
          )}
        </div>
      ),
    },
    {
      key: "age",
      header: "Age",
      align: "end",
      cell: (exposure) => (
        <div className={styles.cell}>
          <span>{exposure.ageHours === null ? "not dated" : `${Math.round(exposure.ageHours)}h`}</span>
          <span className="md3-body-small">
            {exposure.ageHours === null
              ? "its source carries no first-observed time"
              : exposure.severity === "UNSTATED"
                ? // No severity means no allowance. Printing the CRITICAL limit
                  // here would be an SLA this console invented for a row it just
                  // said it could not rank.
                  "no allowance applies — its severity was never stated"
                : Number.isFinite(SEVERITY_SLA_HOURS[exposure.severity])
                  ? `of ${SEVERITY_SLA_HOURS[exposure.severity]}h allowed`
                  : "no limit"}
          </span>
        </div>
      ),
    },
    {
      key: "remedy",
      header: "Remedy",
      cell: (exposure) => <div className={styles.cell}>{exposure.remedy}</div>,
    },
  ]

  /**
   * One GuardDuty detector.
   *
   * The status column is the one that matters and it never says "enabled". AWS
   * returns a detector's status from `guardduty:GetDetector` and that capability
   * is not in this engine's registry, so `ListDetectors` listing an id proves a
   * detector EXISTS and proves nothing about whether it is running. The column
   * carries the reader's own sentence for that, verbatim.
   */
  const detectorColumns: readonly DataColumn<DetectorReading>[] = [
    {
      key: "detector",
      header: "Detector",
      cell: (detector) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{detector.detectorId}</span>
          <span className={`md3-body-small ${styles.identifier}`}>
            {detector.arn ?? "no ARN — identity is unresolved"}
          </span>
          <span className="md3-body-small">
            {describeGuardDutyAttribution(detector.attribution)}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status and protection plans",
      cell: (detector) => (
        <div className={styles.cell}>
          <Badge tone="warn">Not verified</Badge>
          <span className="md3-body-small">
            {describeDetectorConfiguration(detector.configuration)}
          </span>
        </div>
      ),
    },
    {
      key: "findings",
      header: "Findings read",
      cell: (detector) => (
        <div className={styles.cell}>
          <span>
            {detector.findings.state === "ACTUAL" || detector.findings.state === "STALE"
              ? `${detector.findings.value.length} read`
              : detector.findings.state === "EMPTY"
                ? "none — the listing answered and this detector holds no finding"
                : `not read — ${detector.findings.state}`}
          </span>
          <span className="md3-body-small">{describePageBound(detector.idPages)}</span>
          {detector.unhydrated.length > 0 ? (
            <span className="md3-body-small">
              {detector.unhydrated.length} finding id(s) were listed and not returned by
              guardduty:GetFindings, so this count is a floor
            </span>
          ) : null}
        </div>
      ),
    },
  ]

  /**
   * One AWS Config rule.
   *
   * `INSUFFICIENT_DATA` gets its own word — "Evaluated nothing" — and a tone that
   * is not the passing one, which is the entire reason this table is on the page:
   * that rule reports no non-compliant resource, exactly like a rule that passed.
   */
  const ruleColumns: readonly DataColumn<ConfigRuleReading>[] = [
    {
      key: "rule",
      header: "Rule",
      cell: (rule) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{rule.name}</span>
          <span className={`md3-body-small ${styles.identifier}`}>
            {rule.sourceIdentifier ?? "source identifier unstated"}
          </span>
          <span className="md3-body-small">
            {rule.owner ?? "owner unstated"} · {rule.ruleState ?? "rule state unstated"}
          </span>
        </div>
      ),
    },
    {
      key: "verdict",
      header: "What it is doing",
      cell: (rule) => (
        <div className={styles.cell}>
          <Badge tone={RULE_HEALTH_TONE[rule.health.kind]}>
            {RULE_HEALTH_WORDS[rule.health.kind]}
          </Badge>
          <span className="md3-body-small">{describeRuleHealth(rule.health)}</span>
        </div>
      ),
    },
    {
      key: "scope",
      header: "Over what",
      cell: (rule) => (
        <div className={styles.cell}>
          <span>{describeRuleScope(rule.scope)}</span>
          <span className="md3-body-small">
            {rule.evaluationModes.length === 0
              ? "evaluation mode unstated"
              : `evaluation ${rule.evaluationModes.join("+")}`}
          </span>
          <span className="md3-body-small">
            {describeComplianceAttribution(rule.attribution)}
          </span>
        </div>
      ),
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.lead}>
        <h1 className="md3-headline-large">Security posture</h1>
        {/*
          The question, in words, before any apparatus. It is the whole reason
          this route exists and it is the sentence every card below is arranged
          to answer.
        */}
        <p className="md3-title-medium">
          What in this estate is exposed, unencrypted, unrotated or unwatched?
        </p>
        <p className="md3-body-large">{verdict.headline}</p>
        {/*
          Which estate this is, before anything is claimed about it.

          Three chips when the identity read answered. When it did not, each of
          the three values is a SENTENCE, and three sentences in three pills is
          how a 320px viewport draws one over the next — so the row is replaced
          by the one line that says the estate is not known and why.
        */}
        {known ? (
          <div className={styles.row}>
            {scope.map((fact) => (
              <Chip key={fact.label}>
                <span>{fact.label}</span>
                <span className={styles.identifier}>{fact.value}</span>
              </Chip>
            ))}
          </div>
        ) : (
          <p className="md3-body-medium">{scopeSentence({ identityState: identity.state })}</p>
        )}
      </header>

      {/* 1 — the answer, and the coverage it rests on. */}
      <Card
        headline={verdict.verdict}
        headerAside={<Badge tone={verdict.tone}>{verdict.verdict}</Badge>}
        supportingText={statedAsOf(
          "Read live on every load: Security Hub across every page of the response, and this account's IAM policies and access keys",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{verdict.because}</p>

          {/*
            The four words in the heading, each with how much of it is actually
            being asked. This is the answer to the question in one row, and it
            is above every table on the page for that reason.
          */}
          <dl className={styles.facts}>
            {coverage.map((entry) => (
              <Fragment key={entry.question}>
                <dt>{entry.question}</dt>
                <dd>
                  {entry.detail} — {entry.meaning}.
                </dd>
              </Fragment>
            ))}
          </dl>

          {/*
            The severity breakdown of the Security Hub half, and only when THAT
            read answered — `hubAnswered`, never the page-wide `answered`, which
            is now true when any of four reads came back. A row of zeroes under a
            refused Security Hub read is a set of counts nobody measured, and it
            would be one this page drew because a different reader answered.
          */}
          {answered ? (
            hubAnswered ? (
              <div className={styles.row}>
                {SEVERITY_RANK.map((severity) => (
                  <Chip key={severity}>
                    <span>{severity}</span>
                    <span>{counts[severity]}</span>
                  </Chip>
                ))}
              </div>
            ) : (
              /*
                Something answered, and it was not Security Hub. The counts are
                its counts, so they are not drawn as zeroes under a read that was
                refused — the sentence says which reader is silent instead.
              */
              <p className="md3-body-medium">
                No severity breakdown is drawn: the Security Hub read came back{" "}
                {surface.read.state}, so these counts would be zeroes nobody measured. What the
                other readers found is in the ranked list below.
              </p>
            )
          ) : null}

          {/*
            The governed state of each read, through the shared primitive. It is
            rendered nowhere at all when a read succeeded, and on a denial it
            carries the principal, the action, the error code and the minimum
            IAM statement — which is why it sits with the answer rather than at
            the foot of the page: when the answer is "unknown", the fix is the
            rest of the answer.
          */}
          {hubUnknown ? (
            <UnknownState what="the Security Hub findings" read={hubUnknown} />
          ) : null}
          {iamUnknown ? (
            <UnknownState what="this account's IAM policies and access keys" read={iamUnknown} />
          ) : null}
          {detectorsUnknown ? (
            <UnknownState what="the GuardDuty detector listing" read={detectorsUnknown} />
          ) : null}
          {rulesUnknown ? (
            <UnknownState what="the AWS Config rule listing" read={rulesUnknown} />
          ) : null}
        </div>
      </Card>

      {/* 2 — what is NOT being checked. Above the findings, deliberately. */}
      <Card
        headline="Not being checked"
        headerAside={
          <Badge tone={notChecking.length === 0 ? "ok" : "bad"}>
            {notChecking.length} of {controls.length}
          </Badge>
        }
        supportingText={statedAsOf(
          "Worst first: switched off in the account, then not read by anything here, then refused to this engine, then covering only part of what it claims. Every row on this list is a question nobody is asking, and its silence is not a pass",
          surface.asOf,
        )}
      >
        <DataTable
          caption={`Controls that are not answering — ${asOf(surface.asOf)}`}
          columns={controlColumns}
          rows={notChecking}
          rowKey={(row) => row.key}
          empty={
            <EmptyState
              headline="Every listed control is checking"
              description="All of the controls this page knows about answered, over everything each of them claims to cover. That is the only condition under which an empty findings list on this page means the estate is clean."
            />
          }
        />
      </Card>

      {/* 3 — what the controls that ARE checking found, ranked. */}
      <Card
        headline="What this console found"
        headerAside={
          <Badge tone={answered ? (exposures.length === 0 ? "ok" : "bad") : "warn"}>
            {answered ? `${exposures.length} open` : "not read"}
          </Badge>
        }
        supportingText={statedAsOf(
          answered
            ? "A row whose severity its source never stated comes first, then worst severity, then whatever is past its allowance, then oldest. Security Hub and GuardDuty severities are the product's own label and never a guess from a numeric score; the IAM rows are this console's classification and say so in the row; a failing Config rule carries no severity from AWS at all and is never given one here"
            : "Not shown, because not one of the four reads answered",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">
            {hubLead.headline} {hubLead.because}
          </p>

          {answered ? (
            <>
              <DataTable
                caption={`Open exposures, ranked — ${asOf(surface.asOf)}`}
                columns={exposureColumns}
                rows={exposures}
                rowKey={(exposure) => exposure.key}
                empty={
                  <EmptyState
                    headline="Nothing found by the controls that are checking"
                    description={`Security Hub answered from ${reporting.length} of ${surface.sources.length} sources and returned nothing; this console's own IAM sweep found no wildcard and no long-lived key; GuardDuty ${describeGuardDutyPosture(guard.posture)}; and AWS Config ${describeComplianceHealth(config.health)} This is an absence of findings from the controls that ran, and the card above it is what says how many did not run.`}
                  />
                }
              />

              <details className={styles.disclosure}>
                <summary className="md3-label-large">
                  How long a finding of each severity may stay open
                </summary>
                <dl className={styles.facts}>
                  {slaRows(SEVERITY_SLA_HOURS).map((row) => (
                    <Fragment key={row.severity}>
                      <dt>{row.severity}</dt>
                      <dd>{row.limit}</dd>
                    </Fragment>
                  ))}
                </dl>
              </details>
            </>
          ) : (
            /*
              Deliberately not an empty table. An empty table under a heading
              that says what this console found is read as "there is nothing",
              which is the one thing this page must never say about an estate it
              could not look at.
            */
            <p className="md3-body-medium">
              No table is drawn. Not one of the four reads answered — Security Hub, this account&rsquo;s
              IAM, the GuardDuty detector listing and the AWS Config rule listing — so this console
              knows of no exposure and of no absence of one; the panels in the card above name what
              would have to be granted for that to change.
            </p>
          )}
        </div>
      </Card>

      {/* 4 — threat detection, read from GuardDuty itself rather than aggregated. */}
      <Card
        headline="Threat detection — GuardDuty"
        headerAside={
          <Badge tone={guardDutyBadge(guard.posture).tone}>{guardDutyBadge(guard.posture).word}</Badge>
        }
        supportingText={statedAsOf(
          "Read directly through guardduty:ListDetectors, not through Security Hub — a disabled detector aggregates as a product with no findings, which is indistinguishable there from a quiet account",
          guard.asOf,
        )}
      >
        <div className={styles.stack}>
          {/*
            The reader's own sentence for the top-line answer. It says "detectors
            exist" and never "threat detection is on", and it carries the caveat
            that has to travel with any count below it.
          */}
          <p className="md3-body-medium">{describeGuardDutyPosture(guard.posture)}</p>

          {/*
            Findings by severity band, in AWS's own vocabulary, and only when the
            detector listing answered. UNRANKED is a band this console added and
            is FIRST, above CRITICAL: a finding whose severity AWS did not state
            is one somebody has to look at.
          */}
          {guard.posture.kind === "detectors-present" ? (
            <div className={styles.row}>
              {guard.posture.severityCounts.map((count) => (
                <Chip key={count.band}>
                  <span>{count.band}</span>
                  <span>{count.count}</span>
                </Chip>
              ))}
            </div>
          ) : null}

          <DataTable
            caption={`GuardDuty detectors in this region — ${asOf(guard.asOf)}`}
            columns={detectorColumns}
            rows={detectors}
            rowKey={(detector) => detector.detectorId}
            empty={
              /*
                Deliberately not "no findings". `postureOf` turns an EMPTY
                detector listing into the `not-enabled` arm, and that arm is a
                FINDING with a remedy and a cost — the row above this table is
                where it is stated, and this empty state points at it rather than
                repeating it in weaker words.
              */
              <EmptyState
                headline={
                  guard.detectors.state === "EMPTY"
                    ? "No detector exists in this region"
                    : "No detector table is drawn"
                }
                description={
                  guard.detectors.state === "EMPTY"
                    ? "guardduty:ListDetectors answered, and there is none. Nothing is analysing this account's CloudTrail management events, VPC flow logs or DNS queries for a compromise, and every empty finding list on this page is explained by that rather than by a quiet account."
                    : "The detector listing did not answer, so this console does not know whether anything is watching this account. That is not the same as nothing being wrong; the panel below names what would have to be granted."
                }
              />
            }
          />

          {detectorsUnknown ? (
            <UnknownState what="the GuardDuty detector listing" read={detectorsUnknown} />
          ) : null}
          {detectorUnknowns.map((entry) => (
            <UnknownState key={entry.key} what={entry.what} read={entry.read} />
          ))}

          <details className={styles.disclosure}>
            <summary className="md3-label-large">
              Why no detector on this page is ever shown as enabled
            </summary>
            <p className="md3-body-medium">
              {describeDetectorConfiguration(DETECTOR_CONFIGURATION_NOT_READABLE)}
            </p>
          </details>
        </div>
      </Card>

      {/* 5 — configuration compliance, and whether anything is being recorded. */}
      <Card
        headline="Configuration compliance — AWS Config"
        headerAside={
          <Badge tone={complianceBadge(config.health, config.truncation).tone}>
            {complianceBadge(config.health, config.truncation).word}
          </Badge>
        }
        supportingText={statedAsOf(
          "Every rule's own verdict, and whether the configuration recorder those verdicts depend on is recording anything at all. A rule reporting COMPLIANT over a resource type nothing records has checked nothing",
          config.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{describeComplianceHealth(config.health)}</p>

          {/*
            The recorder question, above the rule table rather than under it.
            Every verdict below is conditional on this answer, and this engine
            does not hold the two capabilities that would give it — so it is
            stated as a named unknown with the exact actions that would close it,
            never assumed to be on.
          */}
          <dl className={styles.facts}>
            <Fragment key="recorder">
              <dt>Recorder</dt>
              <dd>{describeRecorder(config.enablement.recorder)}</dd>
            </Fragment>
            <Fragment key="enablement">
              <dt>Config in this account</dt>
              <dd>{describeEnablement(config.enablement)}</dd>
            </Fragment>
            <Fragment key="aggregation">
              <dt>Aggregation</dt>
              <dd>{describeAggregationReading(config.aggregation)}</dd>
            </Fragment>
            <Fragment key="truncation">
              <dt>Listing</dt>
              <dd>{describeComplianceTruncation(config.truncation)}</dd>
            </Fragment>
          </dl>

          <DataTable
            caption={`AWS Config rules and their verdicts — ${asOf(config.asOf)}`}
            columns={ruleColumns}
            rows={configRules}
            rowKey={(rule) => rule.name}
            empty={
              <EmptyState
                headline={
                  config.rules.state === "EMPTY"
                    ? "No Config rule exists in this account"
                    : "No rule table is drawn"
                }
                description={
                  config.rules.state === "EMPTY"
                    ? "config:DescribeConfigRules answered and returned nothing. No rule is evaluating anything in this account, so no rule can report a failure — which is why this reads as a finding here rather than as an empty table."
                    : "The rule listing did not answer, so this console knows of no rule and of no absence of one. An empty table here would be the single most dangerous thing this surface could say."
                }
              />
            }
          />

          {rulesUnknown ? (
            <UnknownState what="the AWS Config rule listing" read={rulesUnknown} />
          ) : null}
          {aggregationUnknown ? (
            <UnknownState what="the Config aggregator listing" read={aggregationUnknown} />
          ) : null}
        </div>
      </Card>

      {/* 6 — and what IS checking, so the list above can be read against it. */}
      <Card
        headline="Checking"
        headerAside={
          <Badge tone={checking.length === 0 ? "bad" : "ok"}>
            {checking.length} of {controls.length}
          </Badge>
        }
        supportingText={statedAsOf(
          "Controls that ran, over everything each of them claims to cover. A finding this list cannot produce cannot appear on this page at all",
          surface.asOf,
        )}
      >
        <DataTable
          caption={`Controls that are answering — ${asOf(surface.asOf)}`}
          columns={controlColumns}
          rows={checking}
          rowKey={(row) => row.key}
          empty={
            <EmptyState
              headline="Nothing is checking"
              description="Not one control on this page ran over this account. Every empty list on this surface is therefore an absence of checking rather than an absence of findings, and the card above names each one and what it would take to change that."
            />
          }
        />
      </Card>

      {/* 7 — the provenance. */}
      <Card
        headline="Where this reading came from"
        supportingText={statedAsOf(
          "Every value below is from a call this page made, or is named as unknown",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          <dl className={styles.facts}>
            {provenance.map((fact) => (
              <Fragment key={fact.label}>
                <dt>{fact.label}</dt>
                <dd className={styles.identifier}>{fact.value}</dd>
              </Fragment>
            ))}
            <Fragment key="iam-read">
              <dt>IAM read</dt>
              <dd className={styles.identifier}>
                iam:GetAccountAuthorizationDetails, then iam:ListAccessKeys per user
              </dd>
            </Fragment>
            <Fragment key="iam-answer">
              <dt>IAM answer</dt>
              <dd className={styles.identifier}>{iam.read.state}</dd>
            </Fragment>
            <Fragment key="iam-headline">
              <dt>IAM reading</dt>
              <dd>{iam.headline}</dd>
            </Fragment>
            <Fragment key="iam-scope">
              <dt>IAM scope</dt>
              <dd>{iam.scope.detail}</dd>
            </Fragment>
            <Fragment key="guardduty-read">
              <dt>GuardDuty read</dt>
              <dd className={styles.identifier}>
                guardduty:ListDetectors, then guardduty:ListFindings and guardduty:GetFindings per
                detector
              </dd>
            </Fragment>
            <Fragment key="guardduty-answer">
              <dt>GuardDuty answer</dt>
              <dd className={styles.identifier}>
                {guard.detectors.state} · detectors refreshed every{" "}
                {Math.round(guard.refreshMs.detectors / 1000)}s, findings every{" "}
                {Math.round(guard.refreshMs.findings / 1000)}s · {describePageBound(guard.detectorPages)}
              </dd>
            </Fragment>
            <Fragment key="config-read">
              <dt>Config read</dt>
              <dd className={styles.identifier}>
                config:DescribeConfigRules, then config:DescribeComplianceByConfigRule in batches,
                and config:DescribeConfigurationAggregators
              </dd>
            </Fragment>
            <Fragment key="config-answer">
              <dt>Config answer</dt>
              <dd className={styles.identifier}>
                {config.rules.state} · rules refreshed every{" "}
                {Math.round(config.refreshMs.rules / 1000)}s, verdicts every{" "}
                {Math.round(config.refreshMs.compliance / 1000)}s
              </dd>
            </Fragment>
            <Fragment key="config-recorder">
              <dt>Config recorder</dt>
              <dd>{describeRecorder(config.enablement.recorder)}</dd>
            </Fragment>
          </dl>

          <details className={styles.disclosure}>
            <summary className="md3-label-large">How this console counts a finding</summary>
            <p className="md3-body-medium">
              Findings are deduplicated on the finding id, the product ARN and the sorted resource
              ids together. Security Hub re-emits a finding on every update and the same GuardDuty
              finding arrives again through the aggregator, so keying on the id alone would merge
              two genuinely different findings that share an id across products, and keying on the
              whole record would merge nothing at all.
            </p>
          </details>
        </div>
      </Card>
    </div>
  )
}
