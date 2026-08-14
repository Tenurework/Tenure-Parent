import { Fragment, type ReactNode } from "react"

import { auth } from "@/lib/auth"
import {
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState,
  KeyValue,
  StaleIndicator,
  UnknownState,
} from "@/components/md3"
import { identityHeadline } from "@/lib/aws/identity"
import { metricReadings } from "@/lib/aws/metrics"
import {
  RULE_WORDS,
  describeRuleAttribution,
  eventBridgeSurface,
  type RuleRow,
} from "@/lib/aws/eventbridge"
import {
  SES_ACCOUNT_TTL_MS,
  describeSesAttribution,
  describeStated,
  mailabilityVerdict,
  sesReadings,
  type SesConfigurationSet,
  type SesIdentity,
} from "@/lib/aws/ses"
import {
  describeDeadLetterState,
  describeQueueAttribution,
  describeRedrive,
  queueReadings,
  type DeliveryFailure,
} from "@/lib/aws/sqs"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

import {
  METRIC_WINDOW_MS,
  PROCESSING_TONE,
  PROCESSING_WORD,
  REACH_TONE,
  REACH_WORD,
  RULE_TONE,
  STALLED_AFTER_SECONDS,
  composeQueues,
  describeAge,
  describeSendRate,
  formatSeconds,
  messagingMetricSpecs,
  metricWindow,
  processingAnswer,
  provenanceOf,
  quotaFacts,
  rankedRules,
  reachAnswer,
  sectionOrder,
  sendRateFrom,
  statedAsOf,
  unknownArm,
  type QueueRow,
  type SectionId,
} from "./reach"
import styles from "./messaging.module.css"

export const dynamic = "force-dynamic"

/**
 * STUDIO-070-004 — "can this platform actually reach people, and is anything
 * queued that nobody is processing?"
 *
 * That question is at the top of the page in those words, because it is the one
 * an operator opens this route with, and every card below is an instalment of
 * the answer. Four live reads produce it and no one of them can answer it alone:
 *
 *   * `ses.ts` — whether SES will accept a message at all, and for whom. Its
 *     sandbox arm is the highest-value fact on this page: a sandboxed account
 *     delivers only to recipients that are themselves verified identities and
 *     silently refuses every other address, so a student never receives their
 *     reminder and nothing in the application ever hears about it.
 *   * `sqs.ts` — every queue's depth, its in-flight count and its redrive
 *     policy, and the dead-letter state it derives from those policies rather
 *     than from any queue's name.
 *   * `metrics.ts` — the one number `sqs.ts` says out loud that it cannot read:
 *     `AWS/SQS ApproximateAgeOfOldestMessage`. Without it a queue being drained
 *     and a queue nothing has consumed since Tuesday are the same depth. It also
 *     carries `AWS/SES Send`, which is the send RATE the 24-hour quota is spent
 *     against.
 *   * `eventbridge.ts` — the schedules. A disabled scheduled rule raises no
 *     alarm, logs no error and appears in no failure count, so it is ranked
 *     first in the rules table and it is one of the two things that can hoist a
 *     card to the top of this page.
 *
 * ── What this page will not do ─────────────────────────────────────────────
 *
 * It will not print a suppressed address. `ses.ts` carries them, deliberately,
 * because "why did this one person not get their mail" is the question the
 * suppression list answers — but the DEFAULT rendering is counts by reason and
 * by domain, which is the shape of the problem with nobody's address in it. A
 * surface that wants the addresses has to reach for `entries` on purpose, and
 * this one does not.
 *
 * It will not render a refused read as an empty list, a zero or a default.
 * Every unreadable reading goes through the shared `UnknownState`, which prints
 * the principal, the action, the error code and a pasteable minimum statement.
 *
 * The decisions are in `./reach.ts` — pure, no client, no React — so
 * `./reach.test.ts` and `e2e/messaging-page-logic.spec.ts` drive every branch at
 * the node level. The ordering is the part that matters: it is where a sandbox
 * account stops being renderable as "mail works", and where a refused
 * `sqs:ListQueues` stops being renderable as "nothing is waiting".
 */
export default async function MessagingPage() {
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

  /*
   * One clock for the whole load, so the four readings are AS OF the same
   * instant and the metric window ends where the SES reading was taken. Four
   * calls to `new Date()` would put four different timestamps on one page and
   * make the "as of" lines disagree by however long the reads took.
   */
  const now = new Date()
  const clock = () => now
  const nowIso = now.toISOString()

  const ses = await sesReadings(undefined, { now: clock })

  const sqs = await queueReadings(undefined, { now: clock })

  /*
   * The metric queries are DERIVED from the queue listing, so this read has to
   * follow it: `messagingMetricSpecs` names one `ApproximateAgeOfOldestMessage`
   * series per queue that was actually returned. A queue the listing never
   * produced is never asked about, and its age reads `not-read` rather than
   * being filled in with a zero.
   */
  const metrics = await metricReadings(
    messagingMetricSpecs(sqs.queues),
    metricWindow(now),
    undefined,
    { now: clock },
  )

  /*
   * The identity read is handed to EventBridge rather than taken again.
   * `resolveIdentity` only caches an ACTUAL answer, so an estate where STS is
   * unreachable — the exact estate this console must keep booting in — would
   * otherwise pay for another failing call, and the two surfaces could disagree
   * about which account they are describing.
   */
  const events = await eventBridgeSurface(undefined, { now: clock, identity: ses.identity })

  const reach = reachAnswer(mailabilityVerdict(ses))
  const rows = composeQueues(sqs.queues, sqs.deadLetters, metrics.series)
  const processing = processingAnswer({
    queues: sqs.queues,
    deadLetters: sqs.deadLetters,
    rows,
    rules: events.read,
    ruleRows: events.rows,
  })
  const rules = rankedRules(events.rows)
  const sendRate = sendRateFrom(metrics.series, METRIC_WINDOW_MS)

  const identity = ses.identity
  const identified = identity.state === "ACTUAL" || identity.state === "STALE"
  const denied = ses.account.state === "DENIED" ? ses.account : null

  const provenance = provenanceOf({
    identityState: identity.state,
    accountId: identified ? identity.value.accountId : (denied?.accountId ?? null),
    region: identified ? identity.value.region : (denied?.region ?? null),
    partition: identified ? identity.value.partition : (denied?.partition ?? null),
    principal: identified ? identity.value.arn : (denied?.principal ?? null),
    sesState: ses.account.state,
    queuesState: sqs.queues.state,
    rulesState: events.read.state,
    metricsState: metrics.series.state,
    asOf: nowIso,
    refreshMs: {
      ses: SES_ACCOUNT_TTL_MS,
      queues: sqs.refreshMs.queues,
      rules: events.refreshMs,
      metrics: metrics.refreshMs,
    },
  })

  const accountUnknown = unknownArm(ses.account)
  const identitiesUnknown = unknownArm(ses.identities)
  const suppressionUnknown = unknownArm(ses.suppressed)
  const configSetsUnknown = unknownArm(ses.configurationSets)
  const queuesUnknown = unknownArm(sqs.queues)
  const rulesUnknown = unknownArm(events.read)
  const metricsUnknown = unknownArm(metrics.series)

  const failures =
    sqs.deadLetters.kind === "failed-deliveries" ? sqs.deadLetters.failures : []
  const identities =
    ses.identities.state === "ACTUAL" || ses.identities.state === "STALE" ? ses.identities.value : []
  const configurationSets =
    ses.configurationSets.state === "ACTUAL" || ses.configurationSets.state === "STALE"
      ? ses.configurationSets.value
      : []
  const suppression =
    ses.suppressed.state === "ACTUAL" || ses.suppressed.state === "STALE"
      ? ses.suppressed.value
      : null

  /* ── The cards, keyed by the id `sectionOrder` arranges them under ─────── */

  const sections: Record<SectionId, ReactNode> = {
    /* ── The answer ─────────────────────────────────────────────────────── */
    answer: (
      <Card
        id="answer"
        headline="Right now"
        headerAside={
          <span className={styles.row}>
            <Badge tone={REACH_TONE[reach.verdict]} title={reach.headline}>
              {REACH_WORD[reach.verdict]}
            </Badge>
            <Badge tone={PROCESSING_TONE[processing.verdict]} title={processing.headline}>
              {PROCESSING_WORD[processing.verdict]}
            </Badge>
          </span>
        }
        supportingText={statedAsOf(
          "Both halves of the question, from one SES account read, one SQS listing with a depth read per queue, one CloudWatch metric load and one EventBridge listing",
          nowIso,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-large" data-testid="reach-headline">
            {reach.headline}
          </p>
          <p className="md3-body-medium">{reach.because}</p>
          <p className="md3-body-large" data-testid="processing-headline">
            {processing.headline}
          </p>
          {processing.qualifier ? (
            <p className="md3-body-medium" data-testid="processing-qualifier">
              {processing.qualifier}
            </p>
          ) : null}

          {/* The counts, as chips rather than a second table. Each one is a
              number this page actually read; a chip is absent rather than
              zeroed when the reading behind it did not answer. */}
          <div className={styles.row}>
            {reach.sendableFrom.length > 0 ? (
              <Chip title="SES identities that are both verified and sending-enabled">
                {reach.sendableFrom.length} identity/identities can send
              </Chip>
            ) : null}
            {sqs.queues.state === "ACTUAL" || sqs.queues.state === "STALE" ? (
              <Chip title="Queues sqs:ListQueues returned">{rows.length} queue(s)</Chip>
            ) : null}
            {failures.length > 0 ? (
              <Chip title="Dead-letter queues holding at least one message">
                {failures.length} dead-letter queue(s) holding messages
              </Chip>
            ) : null}
            {events.read.state === "ACTUAL" || events.read.state === "STALE" ? (
              <Chip title="EventBridge rules on the buses this page read">
                {events.rows.length} rule(s)
              </Chip>
            ) : null}
          </div>

          {/* The governed panel for a read that did not answer. Absent for a
              successful read — a banner saying "the read succeeded" above a
              populated card is noise. */}
          {accountUnknown ? (
            <UnknownState read={accountUnknown} what="this account's SES sending state" />
          ) : null}
        </div>
      </Card>
    ),

    /* ── A delivery that failed and nobody was told ─────────────────────── */
    "failed-deliveries": (
      <Card
        id="failed-deliveries"
        headline="Failed deliveries"
        headerAside={
          <span className={styles.row}>
            <Badge
              tone={
                sqs.deadLetters.kind === "failed-deliveries"
                  ? "bad"
                  : sqs.deadLetters.kind === "clear"
                    ? "ok"
                    : "warn"
              }
              title="Messages sitting in a dead-letter queue"
            >
              {sqs.deadLetters.kind === "failed-deliveries"
                ? `${sqs.deadLetters.totalMessages} message(s)`
                : sqs.deadLetters.kind === "clear"
                  ? "None"
                  : "Not known"}
            </Badge>
            <StaleIndicator
              asOf={sqs.asOf}
              cadenceMs={sqs.refreshMs.depth}
              label="the queue depth reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          "Every queue another queue's redrive policy names as its dead-letter target, and what is sitting in it — a message here has already failed its last retry and will never run",
          sqs.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium" data-testid="dead-letter-state">
            {describeDeadLetterState(sqs.deadLetters)}
          </p>

          <DataTable
            caption="Dead-letter queues holding messages"
            rowKey={(row: DeliveryFailure) => row.queueArn}
            columns={[
              {
                key: "queue",
                header: "Queue",
                cell: (row) => (
                  <span className={styles.cell}>
                    <span className={styles.identifier}>{row.queueName}</span>
                    <span className="md3-label-small">{describeQueueAttribution(row.attribution)}</span>
                  </span>
                ),
              },
              { key: "messages", header: "Waiting", align: "end", cell: (row) => row.messages },
              { key: "inflight", header: "In flight", align: "end", cell: (row) => row.inFlight },
              {
                key: "from",
                header: "Redriven from",
                cell: (row) => (
                  <span className={styles.cell}>
                    {row.sourceQueueArns.length === 0
                      ? "no source queue names this one in a RedrivePolicy; it declared itself a redrive target"
                      : row.sourceQueueArns.map((arn) => (
                          <span key={arn} className={styles.identifier}>
                            {arn}
                          </span>
                        ))}
                  </span>
                ),
              },
            ]}
            rows={failures}
            empty={
              queuesUnknown ? (
                <EmptyState
                  headline="This list is not empty — it is unknown"
                  description="The queue read did not answer, so this console cannot say whether anything has landed in a dead-letter queue. The panel below names the action that was refused."
                />
              ) : (
                <EmptyState
                  headline="No dead-letter queue is holding anything"
                  description={describeDeadLetterState(sqs.deadLetters)}
                />
              )
            }
          />

          {queuesUnknown ? (
            <UnknownState read={queuesUnknown} what="the SQS queue listing" />
          ) : null}
        </div>
      </Card>
    ),

    /* ── The schedules ──────────────────────────────────────────────────── */
    schedules: (
      <Card
        id="schedules"
        headline="Schedules and rules"
        headerAside={
          <span className={styles.row}>
            <Badge
              tone={
                rulesUnknown
                  ? "warn"
                  : rules.some((r) => r.verdict === "DISABLED" && r.schedule !== null)
                    ? "bad"
                    : "ok"
              }
              title="EventBridge rules on the buses this page read"
            >
              {rulesUnknown ? "Not known" : `${events.rows.length} rule(s)`}
            </Badge>
            <StaleIndicator
              asOf={events.asOf}
              cadenceMs={events.refreshMs}
              label="the EventBridge reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          "Every rule, its schedule or its pattern and what it invokes — switched-off schedules first, because a disabled rule raises no alarm, logs no error and appears in no failure count",
          events.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium">{events.headline}</p>
          <p className="md3-body-small">{events.scopeNote}</p>

          <DataTable
            caption="EventBridge rules, worst first"
            rowKey={(row: RuleRow) => `${row.busName}:${row.name}`}
            columns={[
              {
                key: "rule",
                header: "Rule",
                cell: (row) => (
                  <span className={styles.cell}>
                    <span className={styles.identifier}>{row.name}</span>
                    <span className="md3-label-small">
                      {row.busName} · {describeRuleAttribution(row.attribution)}
                    </span>
                  </span>
                ),
              },
              {
                key: "verdict",
                header: "Verdict",
                cell: (row) => (
                  <Badge tone={RULE_TONE[row.verdict]} title={row.verdict}>
                    {RULE_WORDS[row.verdict]}
                  </Badge>
                ),
              },
              {
                key: "trigger",
                header: "Fires on",
                cell: (row) => (
                  <span className={styles.cell}>
                    <span className={styles.identifier}>
                      {row.schedule ??
                        (row.eventDriven
                          ? "an event pattern"
                          : "nothing — neither a schedule nor a pattern")}
                    </span>
                    <span className="md3-label-small">
                      {row.targetCount === null
                        ? "targets unknown — this is not a count of zero"
                        : `${row.targetCount} target(s)`}
                    </span>
                  </span>
                ),
              },
              {
                key: "detail",
                header: "What it means",
                cell: (row) => <span className={styles.cell}>{row.detail}</span>,
              },
            ]}
            rows={rules}
            empty={
              <EmptyState
                headline="No rule on the buses this page read"
                description="events:ListRules answered with nothing on these buses. EventBridge rules are regional and per-bus, so this is not a claim about any other bus or region."
              />
            }
          />

          {/* The targets read is a SEPARATE grant from the rules read, and its
              refusal is carried per rule rather than folded into a count. Said
              here so a reader does not take "0 target(s)" for the whole story. */}
          <p className="md3-body-small">
            Whether each rule&rsquo;s targets could be read is a separate permission
            (events:ListTargetsByRule) and it is reported per rule above. A rule whose targets were
            refused reads &ldquo;targets unknown&rdquo; rather than &ldquo;0 targets&rdquo;: a rule
            that invokes nothing and a rule this console was not allowed to ask about are opposite
            facts.
          </p>

          {rulesUnknown ? (
            <UnknownState read={rulesUnknown} what="the EventBridge rules on these buses" />
          ) : null}
        </div>
      </Card>
    ),

    /* ── Can this account send at all, and to whom ──────────────────────── */
    sending: (
      <Card
        id="sending"
        headline="Sending"
        headerAside={
          <span className={styles.row}>
            <Badge tone={REACH_TONE[reach.verdict]} title={reach.headline}>
              {REACH_WORD[reach.verdict]}
            </Badge>
            <StaleIndicator
              asOf={nowIso}
              cadenceMs={SES_ACCOUNT_TTL_MS}
              label="the SES account reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          "The sandbox state, the identities SES will send from, the 24-hour quota against what this account actually sent, and the addresses SES refuses to deliver to",
          nowIso,
        )}
      >
        <div className={styles.stack}>
          {accountUnknown ? (
            <UnknownState read={accountUnknown} what="this account's SES account state" />
          ) : (
            <>
              <KeyValue
                ariaLabel="What SES says about this account"
                items={quotaFacts(ses.account).map((fact, index) => ({
                  key: `${index}-${fact.label}`,
                  term: fact.label,
                  value: fact.value,
                }))}
              />
              {/* The measured half of "quota against send rate". The quota comes
                  from SES; this comes from CloudWatch, and the two disagree in
                  the useful direction: an account that believes it is sending
                  and has published no Send datapoint in an hour is an account
                  that is not sending. */}
              <p className="md3-body-medium" data-testid="send-rate">
                {describeSendRate(sendRate)}
              </p>
            </>
          )}

          <DataTable
            caption="Identities SES holds for this account"
            rowKey={(row: SesIdentity) => row.name}
            columns={[
              {
                key: "identity",
                header: "Identity",
                cell: (row) => (
                  <span className={styles.cell}>
                    <span className={styles.identifier}>{row.name}</span>
                    <span className="md3-label-small">
                      {describeStated(row.identityType, (v) => v)} ·{" "}
                      {describeSesAttribution(row.attribution)}
                    </span>
                  </span>
                ),
              },
              {
                key: "verified",
                header: "Verification",
                cell: (row) => (
                  <Badge
                    tone={
                      row.verification.state === "VERIFIED"
                        ? "ok"
                        : row.verification.state === "NOT_VERIFIED"
                          ? "bad"
                          : "warn"
                    }
                    title={row.verification.state}
                  >
                    {row.verification.state === "VERIFIED"
                      ? "Verified"
                      : row.verification.state === "NOT_VERIFIED"
                        ? "Not verified"
                        : "Not stated"}
                  </Badge>
                ),
              },
              {
                key: "detail",
                header: "What it means",
                cell: (row) => (
                  <span className={styles.cell}>
                    <span>
                      {row.verification.state === "NOT_VERIFIED"
                        ? `${row.verification.sesStatus} — ${row.verification.consequence}`
                        : row.verification.state === "UNSTATED"
                          ? row.verification.why
                          : `SES reports ${row.verification.sesStatus}.`}
                    </span>
                    <span className="md3-label-small">
                      {describeStated(row.sendingEnabled, (v) =>
                        v ? "sending enabled" : "sending DISABLED on this identity",
                      )}
                    </span>
                  </span>
                ),
              },
            ]}
            rows={identities}
            empty={
              identitiesUnknown ? (
                <EmptyState
                  headline="This list is not empty — it is unknown"
                  description="The identity read did not answer, so this console cannot say what this account can send from. The panel below names the action that was refused."
                />
              ) : (
                <EmptyState
                  headline="SES holds no identity for this account"
                  description="ses:ListEmailIdentities answered, successfully, with nothing. There is no address this platform can send from, and mail queued against one is dropped at the API."
                />
              )
            }
          />

          {identitiesUnknown ? (
            <UnknownState read={identitiesUnknown} what="this account's SES sending identities" />
          ) : null}

          {/* ── The suppression list, as a shape rather than as people ──── */}
          {suppressionUnknown ? (
            <UnknownState
              read={suppressionUnknown}
              what="the account-level suppression list"
            />
          ) : suppression === null ? (
            <EmptyState
              headline="No address is suppressed"
              description="ses:ListSuppressedDestinations answered, successfully, with nothing. SES is not refusing to deliver to anybody at the account level."
            />
          ) : (
            <div className={styles.tight}>
              <p className="md3-body-medium" data-testid="suppression">
                {suppression.entries.length} address(es) are on this account&rsquo;s suppression
                list. SES will not deliver to any of them, whatever the application does.
                {suppression.truncated
                  ? " This list is TRUNCATED: the page budget ran out with SES still holding pages, so an address absent from these counts may still be suppressed."
                  : ""}
              </p>
              {/* Counts, never addresses. `ses.ts` carries the real addresses of
                  real people and this page deliberately does not print them. */}
              <details className={styles.disclosure}>
                <summary className="md3-label-large">
                  Show the breakdown by reason and by recipient domain
                </summary>
                <KeyValue
                  ariaLabel="Suppressed addresses by reason and by domain"
                  items={[
                    ...Object.keys(suppression.byReason)
                      .sort()
                      .map((reason) => ({
                        key: `reason-${reason}`,
                        term: `Suppressed because SES saw a ${reason}`,
                        value: `${suppression.byReason[reason]} address(es)`,
                      })),
                    ...Object.keys(suppression.byDomain)
                      .sort()
                      .map((domain) => ({
                        key: `domain-${domain}`,
                        term: `Recipients at ${domain}`,
                        value: `${suppression.byDomain[domain]} address(es)`,
                      })),
                  ]}
                />
                <p className="md3-body-small">
                  The addresses themselves are not printed here. They are real recipients&rsquo; and
                  the counts are the shape of the problem without them; a surface that needs one has
                  to ask for it on purpose.
                </p>
              </details>
            </div>
          )}

          {/* ── Configuration sets, collapsed: reference rather than news ── */}
          {configSetsUnknown ? (
            <UnknownState read={configSetsUnknown} what="this account's SES configuration sets" />
          ) : (
            <details className={styles.disclosure}>
              <summary className="md3-label-large">
                Show the {configurationSets.length} configuration set(s) this account holds
              </summary>
              <DataTable
                caption="SES configuration sets"
                rowKey={(row: SesConfigurationSet) => row.name}
                columns={[
                  {
                    key: "name",
                    header: "Set",
                    cell: (row) => (
                      <span className={styles.cell}>
                        <span className={styles.identifier}>{row.name}</span>
                        <span className="md3-label-small">
                          {describeSesAttribution(row.attribution)}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "tls",
                    header: "Transport",
                    cell: (row) => (
                      <span className={styles.cell}>
                        {describeStated(row.tlsPolicy, (v) => `TLS ${v}`)}
                      </span>
                    ),
                  },
                  {
                    key: "sending",
                    header: "Sending",
                    cell: (row) => (
                      <span className={styles.cell}>
                        <span>
                          {describeStated(row.sendingEnabled, (v) =>
                            v ? "enabled" : "DISABLED for this set",
                          )}
                        </span>
                        <span className="md3-label-small">
                          {describeStated(row.suppressedReasons, (v) =>
                            v.length > 0
                              ? `suppresses on ${v.join(", ")}`
                              : "suppresses on nothing of its own",
                          )}
                        </span>
                      </span>
                    ),
                  },
                ]}
                rows={configurationSets}
                empty={
                  <EmptyState
                    headline="No configuration set"
                    description="ses:ListConfigurationSets answered with nothing. Mail sent without a configuration set carries no per-message TLS policy and no reputation metrics."
                  />
                }
              />
            </details>
          )}
        </div>
      </Card>
    ),

    /* ── Every queue, its depth and how long its oldest message has waited ─ */
    queues: (
      <Card
        id="queues"
        headline="Queues"
        headerAside={
          <span className={styles.row}>
            <Badge tone={PROCESSING_TONE[processing.verdict]} title={processing.headline}>
              {PROCESSING_WORD[processing.verdict]}
            </Badge>
            <StaleIndicator
              asOf={sqs.asOf}
              cadenceMs={sqs.refreshMs.depth}
              label="the queue depth reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          `Every queue this account holds, its depth, its redrive policy, and how long its oldest message has been waiting — a queue is called stalled only when a measured age is past ${formatSeconds(STALLED_AFTER_SECONDS)}`,
          sqs.asOf,
        )}
      >
        <div className={styles.stack}>
          <DataTable
            caption="Queues, with the age of the oldest message in each"
            rowKey={(row: QueueRow) => row.queue.url}
            columns={[
              {
                key: "queue",
                header: "Queue",
                cell: (row) => (
                  <span className={styles.cell}>
                    <span className={styles.identifier}>{row.queue.name}</span>
                    <span className="md3-label-small">
                      {row.isDeadLetter ? "dead-letter target · " : ""}
                      {row.queue.region ?? "region unknown"} ·{" "}
                      {describeQueueAttribution(row.queue.attribution)}
                    </span>
                  </span>
                ),
              },
              {
                key: "depth",
                header: "Waiting",
                align: "end",
                cell: (row) =>
                  row.visible === null ? (
                    <span className={styles.cell}>not read</span>
                  ) : (
                    <span className={styles.cell}>{row.visible}</span>
                  ),
              },
              {
                key: "inflight",
                header: "In flight",
                align: "end",
                cell: (row) =>
                  row.inFlight === null ? (
                    <span className={styles.cell}>not read</span>
                  ) : (
                    <span className={styles.cell}>{row.inFlight}</span>
                  ),
              },
              {
                key: "age",
                header: "Oldest message",
                cell: (row) => (
                  <span className={styles.cell}>
                    <span>{describeAge(row.age)}</span>
                    {row.stalled ? (
                      <Badge tone="bad" title="Visible messages older than this page's threshold">
                        Not moving
                      </Badge>
                    ) : null}
                  </span>
                ),
              },
              {
                key: "redrive",
                header: "On failure",
                cell: (row) => (
                  <span className={styles.cell}>
                    {row.queue.depth.state === "ACTUAL" || row.queue.depth.state === "STALE"
                      ? describeRedrive(row.queue.depth.value.redrive)
                      : "unknown — this queue's attributes could not be read, so whether it has a dead-letter queue is not established"}
                  </span>
                ),
              },
            ]}
            rows={rows}
            empty={
              queuesUnknown ? (
                <EmptyState
                  headline="This list is not empty — it is unknown"
                  description="sqs:ListQueues did not answer, so this console cannot say what queues exist or what is in them. The panel below names the action that was refused."
                />
              ) : (
                <EmptyState
                  headline="This account holds no queue"
                  description="sqs:ListQueues answered, successfully, with nothing. Nothing in this account is queueing work, which is a different fact from nothing being queued."
                />
              )
            }
          />

          {queuesUnknown ? <UnknownState read={queuesUnknown} what="the SQS queue listing" /> : null}
          {metricsUnknown ? (
            <UnknownState
              read={metricsUnknown}
              what="the age of the oldest message in each queue (AWS/SQS ApproximateAgeOfOldestMessage)"
            />
          ) : null}
        </div>
      </Card>
    ),

    /* ── Where all of it came from ──────────────────────────────────────── */
    provenance: (
      <Card
        id="provenance"
        headline="Where this came from"
        supportingText={statedAsOf(
          "The calls this page made, the principal it made them as, and the estate that answered",
          nowIso,
        )}
      >
        <div className={styles.stack}>
          <KeyValue
            ariaLabel="What produced this page"
            items={provenance.map((fact, index) => ({
              key: `${index}-${fact.label}`,
              term: fact.label,
              value: <code>{fact.value}</code>,
            }))}
          />
          <p className="md3-body-small">
            The CloudWatch load cost {metrics.cost.requests} request(s) naming{" "}
            {metrics.cost.metricsRequested} metric(s) across {metrics.cost.batches} batch(es), over a{" "}
            {Math.round(METRIC_WINDOW_MS / 60_000)}-minute window. That is measured, not estimated:
            a refused batch is not counted here, because a refused request is not a metric this
            account was charged for.
          </p>
        </div>
      </Card>
    ),
  }

  return (
    <div className={styles.page} data-surface="messaging">
      <header className={styles.lead}>
        <h1 className="md3-headline-large">Messaging</h1>
        <p className="md3-title-medium" data-testid="page-question">
          Can this platform actually reach people, and is anything queued that nobody is processing?
        </p>
        <p className="md3-body-medium">
          Whether SES will accept a message and for whom, every queue and what is sitting in it, and
          every schedule that is supposed to be putting work into one.
        </p>
        <p className={`md3-body-small ${styles.identifier}`}>{identityHeadline(identity)}</p>
      </header>

      {sectionOrder(processing).map((id) => (
        <Fragment key={id}>{sections[id]}</Fragment>
      ))}
    </div>
  )
}
