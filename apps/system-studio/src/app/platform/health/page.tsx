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
import { ALARM_WORDS, alarmSurface, type AlarmRow } from "@/lib/aws/alarms"
import { HEALTH_WORDS, awsHealthSurface, tenantsAffected, type HealthEventRow } from "@/lib/aws/aws-health"
import {
  dashboardReadings,
  describeContent,
  describeCoverage,
  describeDashboardAttribution,
  describeTruncation,
  type DashboardRow,
} from "@/lib/aws/dashboards"
import { expectedAlarmNames } from "@/lib/aws/expected-alarms"
import { identityHeadline } from "@/lib/aws/identity"
import {
  describeCompleteness,
  describeLastEvent,
  describeLogGroupAttribution,
  describeMetricFilters,
  describeRetention,
  logGroupReadings,
  type LogGroupReading,
} from "@/lib/aws/logs"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

import {
  HEALTH_TONE,
  VERDICT_TONE,
  WHOSE_WORD,
  awsSide,
  coverageOf,
  countByVerdict,
  fleetVerdict,
  leadAnswer,
  partitionAlarms,
  provenanceOf,
  readAnswered,
  sectionOrder,
  statedAsOf,
  unknownArm,
  type SectionId,
} from "./answer"
import styles from "./health.module.css"
import {
  CANDIDATES_WHY,
  FRESHNESS_TONE,
  FRESHNESS_WORD,
  RETENTION_TONE,
  RETENTION_WORD,
  SILENCE_PROBE_WHY,
  SILENCE_WINDOW_MS,
  WATCH_TONE,
  WATCH_WORD,
  dashboardCensus,
  formatBytes,
  retentionCensus,
  silenceCensus,
  silenceWarning,
  watchHeadline,
  watchJoin,
  type LogGroupWatch,
} from "./watch"

export const dynamic = "force-dynamic"

/**
 * STUDIO-080-008 / STUDIO-070-004 — "is anything broken right now, and is it us
 * or is it AWS?"
 *
 * That question is at the top of the page in those words, because it is the one
 * an operator opens this route with and every panel below is an instalment of
 * the answer. Two live reads produce it and neither can answer it alone:
 *
 *   * `cloudwatch:DescribeAlarms` — this estate's own symptoms. It is the only
 *     source of "is anything broken", and it is structurally incapable of
 *     telling a bad deploy from an AWS-side impairment.
 *   * `health:DescribeEvents` — AWS's account of itself. It is the only source
 *     of "or is it AWS", and until it was wired here a firing alarm during an
 *     AWS networking event looked exactly like a firing alarm caused by us.
 *
 * The word beside each alarm is a VERDICT rather than a state: a disabled alarm
 * reads DISABLED even while CloudWatch calls it OK, an alarm that has not moved
 * in a week reads STALE with the date, and an alarm the Terraform declares and
 * the response did not contain reads MISSING — falsifiable, and only ever
 * produced from a successful response.
 *
 * ── The shape, and why the AWS card moves ──────────────────────────────────
 *
 * The answer, then whichever of the two sides has something open, then the
 * alarms that need somebody, then the ones that do not, then whether this
 * console can even say what SHOULD exist, then where all of it came from.
 * `sectionOrder` puts the AWS Health card directly under the answer when
 * anything is open or when that read was refused, and below the alarms when AWS
 * has answered that nothing is happening: during an incident the attribution is
 * the second thing read and cannot be under forty rows of alarms, and outside
 * one a negative answer is not worth the top of the page.
 *
 * Every card says what it is AS OF, and every card that does not know something
 * says so in the place the fact would have gone. A refused or throttled read
 * renders through the shared `UnknownState`, which prints the principal, the
 * action, the error code and a pasteable minimum statement — never an empty
 * table, never a zero.
 *
 * The decisions are in `./answer.ts` — pure, no client, no React — so
 * `./answer.test.ts` and `e2e/health-page-logic.spec.ts` drive every branch at
 * the node level. A ternary chain inside this render would be an ordering
 * nothing could test, and the ordering is the part that matters: it is where
 * "four alarms are muted" stops being renderable as "healthy", and where a
 * refused AWS Health call stops being renderable as "so it must be us".
 */
export default async function HealthPage() {
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

  const expected = expectedAlarmNames()
  const surface = await alarmSurface(undefined, { expected })

  /*
   * The identity read is handed over rather than taken again. `resolveIdentity`
   * only caches an ACTUAL answer, so an estate where STS is unreachable — the
   * exact estate this console must keep booting in — would otherwise pay for a
   * second failing call, and the two surfaces could disagree about which
   * account they are describing.
   */
  const aws = await awsHealthSurface(undefined, { identity: surface.identity })

  /*
   * The two standing-posture reads.
   *
   * `dashboardReadings` opens every dashboard body and parses out the metric
   * namespaces, alarm names and log groups its widgets reference.
   * `logGroupReadings` reads every log group's retention, bytes, key and metric
   * filters — and, because `probeSilenceWindowMs` is passed, asks each group
   * once whether anything arrived in the last day.
   *
   * That probe is the one deliberate cost on this page. `logs.ts` makes it
   * opt-in precisely so a caller has to choose it: `logs:FilterLogEvents` is
   * billed for the bytes it scans over the window, and a console left open on a
   * page that probed every group is a line on the bill nobody chose. It is
   * chosen HERE because the finding it produces is invisible everywhere else on
   * this page — a service whose writer has stopped leaves its error-count alarm
   * sitting in OK forever, and every panel above reads calm. The probe never
   * returns a log line; `logs.ts` discards the messages inside itself and only a
   * timestamp leaves it.
   *
   * Sequential rather than `Promise.all`: these two are the LAST reads on the
   * page and they are the expensive ones, and issuing them alongside the alarm
   * and Health calls would put four concurrent multi-page walks against the same
   * per-account CloudWatch throttle — which turns a slow page into a throttled
   * one, and a throttled read into an UNKNOWN panel.
   */
  const dashboards = await dashboardReadings()
  const logs = await logGroupReadings(undefined, { probeSilenceWindowMs: SILENCE_WINDOW_MS })

  const answer = leadAnswer(surface.read.state, surface.rows)
  const answered = readAnswered(surface.read.state)
  const side = awsSide({ state: aws.events.state, rows: aws.rows, because: aws.headline })
  const fleet = fleetVerdict(answer, side, answered)

  const counts = countByVerdict(surface.rows)
  const { attention, quiet } = partitionAlarms(surface.rows)
  const coverage = coverageOf(expected, surface.rows, surface.read.state)
  const blast = tenantsAffected(aws)

  /*
   * The join. `watch.ts` does the subtracting; nothing here decides anything.
   *
   * It is computed from the three readings this page already holds and reads
   * nothing further, which is what keeps the arithmetic testable at the node
   * level with no estate.
   */
  const join = watchJoin({
    logs,
    dashboards,
    alarmRows: surface.rows,
    alarmReadState: surface.read.state,
  })
  const watch = watchHeadline(join)
  const silence = silenceCensus(logs.groups)
  const stopped = silenceWarning(silence)
  const retention = retentionCensus(logs.groups)
  const boards = dashboardCensus(dashboards.dashboards)

  /*
   * Account, region and partition come from the identity read and from nowhere
   * else. The DENIED arm of the alarm read carries its own copy of them —
   * `read.ts` attaches the denial context so a refusal can be fixed without
   * leaving the page — and that copy is preferred when identity itself is the
   * thing that failed, because it is the same fact from the same process.
   */
  const identity = surface.identity
  const identified = identity.state === "ACTUAL" || identity.state === "STALE"
  const denied = surface.read.state === "DENIED" ? surface.read : null

  const provenance = provenanceOf({
    identityState: identity.state,
    accountId: identified ? identity.value.accountId : (denied?.accountId ?? null),
    region: identified ? identity.value.region : (denied?.region ?? null),
    partition: identified ? identity.value.partition : (denied?.partition ?? null),
    principal: identified ? identity.value.arn : (denied?.principal ?? null),
    readState: surface.read.state,
    refreshMs: surface.refreshMs,
    asOf: surface.asOf,
    healthReadState: aws.events.state,
    healthRefreshMs: aws.refreshMs,
    dashboardsReadState: dashboards.dashboards.state,
    logsReadState: logs.groups.state,
  })

  const alarmsUnknown = unknownArm(surface.read)
  const eventsUnknown = unknownArm(aws.events)
  const entitiesUnknown = unknownArm(aws.entities)
  const dashboardsUnknown = unknownArm(dashboards.dashboards)
  const logsUnknown = unknownArm(logs.groups)

  /* ── The cards, keyed by the id `sectionOrder` arranges them under ─────── */

  const sections: Record<SectionId, ReactNode> = {
    /* ── The answer ─────────────────────────────────────────────────────── */
    "right-now": (
      <Card
        id="right-now"
        headline="Right now"
        headerAside={
          <span className={styles.row}>
            <Badge tone={fleet.tone} title={fleet.headline}>
              {fleet.verdict}
            </Badge>
            <Badge tone={fleet.whoseTone} title={fleet.attribution}>
              {WHOSE_WORD[fleet.whose]}
            </Badge>
          </span>
        }
        supportingText={statedAsOf(
          "What an operator should act on first, from one live cloudwatch:DescribeAlarms call, one live health:DescribeEvents call, and the alarm set the estate's Terraform declares",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          {/* The testid predates this layout and is kept on the sentence it has
              always named: the one-line answer this surface leads with. */}
          <p className="md3-body-large" data-testid="alarm-headline">
            {fleet.headline}
          </p>
          {/* The second half of the question, always present — including when
              the answer to it is "not established". */}
          <p className="md3-body-medium" data-testid="attribution">
            {fleet.attribution}
          </p>
          {answer.because ? <p className="md3-body-medium">{answer.because}</p> : null}

          {/*
            The finding that is invisible everywhere else on this page.
            A log group that has received nothing since before the last deploy
            has a writer that has stopped, and the alarm over its error count
            sits in OK forever because zero errors is what a stopped service
            produces. It is printed here, beside the answer, rather than only
            in the log card below — a stopped writer is not a footnote.

            It does NOT enter `fleetVerdict`: silence is a bounded observation
            ("nothing in the last 24 hours"), and a group that is legitimately
            idle overnight would otherwise flip the page's whole verdict on a
            schedule. The sentence names the groups and lets a person decide.
          */}
          {stopped ? (
            <p className="md3-body-medium" data-testid="silence">
              {stopped}
            </p>
          ) : null}

          {/* The verdict tally, as chips rather than as a second table. Only
              verdicts that are actually present appear — a row of zeroes is a
              row an operator has to read before discovering it says nothing. */}
          {answered && surface.rows.length > 0 ? (
            <div className={styles.row}>
              {(Object.keys(counts) as Array<keyof typeof counts>)
                .filter((verdict) => counts[verdict] > 0)
                .map((verdict) => (
                  <Chip key={verdict} title={`${counts[verdict]} alarm(s) with verdict ${verdict}`}>
                    {counts[verdict]} {ALARM_WORDS[verdict]}
                  </Chip>
                ))}
            </div>
          ) : null}

          {/*
            The governed panel for a read that did not answer. It is absent for
            a successful read — a banner saying "the read succeeded" above a
            populated table is noise — and for a refusal it is the whole answer:
            principal, action, error code, account/region/partition and the
            minimum statement, in the one component every AWS-backed surface in
            this console uses, so a refusal cannot be worded as an absence here
            and correctly somewhere else.
          */}
          {alarmsUnknown ? (
            <UnknownState read={alarmsUnknown} what="the alarm inventory" />
          ) : null}
        </div>
      </Card>
    ),

    /* ── AWS's own account of itself ────────────────────────────────────── */
    "aws-health": (
      <Card
        id="aws-health"
        headline="Is it AWS?"
        headerAside={
          <span className={styles.row}>
            <Badge
              tone={side.known ? (side.open > 0 ? "bad" : "ok") : "warn"}
              title="Open AWS Health events that are not ruled out for this estate"
            >
              {side.known ? `${side.open} open` : "Not known"}
            </Badge>
            <StaleIndicator
              asOf={aws.asOf}
              cadenceMs={aws.refreshMs}
              label="the AWS Health reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          "Open and upcoming events AWS has raised for this account, and which of this estate's resources AWS named in them",
          aws.asOf,
        )}
      >
        <div className={styles.stack}>
          {/*
            The surface's own headline rather than `side.sentence`, which is
            already the second paragraph of "Right now" — and when there is an
            open event these two cards are adjacent, so a repeat would be the
            same sentence twice on one screen. This one carries what the other
            cannot: the counts per verdict, and the account and region AWS
            answered for. On an unreadable read there is no headline worth
            printing here, because the panel below IS the answer.
          */}
          {eventsUnknown ? (
            <UnknownState read={eventsUnknown} what="AWS Health events for this account" />
          ) : (
            <>
              <p className="md3-body-medium">{aws.headline}</p>

              <HealthEventTable
                rows={aws.rows}
                empty={
                  <EmptyState
                    headline="AWS named no open or upcoming event"
                    description="There is nothing to list because AWS answered that there is nothing, which is a different fact from this console being unable to ask."
                  />
                }
              />

              {/* Which of OUR resources AWS named. A separate grant, so a
                  separate reading, and its refusal is its own panel rather
                  than a count of zero folded into the table above.

                  Only when there is an event to attribute: with nothing open,
                  the entity read is deliberately never made, and a panel
                  reporting that it was not made would be apparatus about a
                  question nobody asked. */}
              {aws.rows.length === 0 ? null : entitiesUnknown ? (
                <UnknownState
                  read={entitiesUnknown}
                  what="the resources AWS Health named in these events"
                />
              ) : (
                <KeyValue
                  ariaLabel="What these events touch in this account"
                  items={[
                    {
                      key: "entities",
                      term: "What AWS named",
                      value: aws.entityHeadline,
                    },
                    {
                      key: "tenants",
                      term: "Tenants named",
                      value:
                        blast.tenants.length > 0
                          ? blast.tenants.join(", ")
                          : "none of the affected resources carries a tenure:tenant tag",
                    },
                    {
                      key: "unattributed",
                      term: "Resources nobody owns",
                      value: `${blast.unattributedEntities} affected resource(s) have no tenure:tenant tag at all`,
                    },
                    {
                      key: "unknown-entities",
                      term: "Events not looked into",
                      value:
                        blast.eventsWithUnknownEntities === 0
                          ? "none — the affected resources were read for every event"
                          : `${blast.eventsWithUnknownEntities} event(s) whose affected resources could not be read; this is not a claim that they touch nothing`,
                    },
                  ]}
                />
              )}
            </>
          )}
        </div>
      </Card>
    ),

    /* ── The alarms that need somebody ──────────────────────────────────── */
    "needs-attention": (
      <Card
        id="needs-attention"
        headline="Needs attention"
        headerAside={
          <Badge
            tone={attention.length > 0 ? "warn" : "ok"}
            title="Alarms whose verdict is anything other than OK"
          >
            {attention.length}
          </Badge>
        }
        supportingText={statedAsOf(
          "Every alarm that is firing, muted, missing, stale, refused or without enough data — worst first",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          <AlarmTable
            caption="Alarms not in OK"
            rows={attention}
            empty={
              answered ? (
                <EmptyState
                  headline="Nothing needs attention"
                  description={
                    surface.rows.length === 0
                      ? "There are no alarms in this account at all, so there is nothing here to be wrong. That is the finding above, not a clean bill of health."
                      : "Every alarm the read returned is in OK, with its actions enabled and its state recently evaluated. They are listed under Watching quietly."
                  }
                />
              ) : (
                <EmptyState
                  headline="This list is not empty — it is unknown"
                  description="The alarm read did not answer, so this console cannot say whether anything needs attention. The card above names the principal, the action and the statement that would fix it."
                />
              )
            }
          />

          {/*
            The honest limit of this table, stated where somebody would
            otherwise assume the opposite.
          */}
          <p className="md3-body-small">
            Whether any of these numbers is climbing is not on this page: nothing here reads the
            datapoints behind an alarm (cloudwatch:GetMetricData), so an alarm minutes from
            crossing its threshold looks exactly like one that is nowhere near it. A gap in a
            metric is not a zero either — an alarm sitting in OK because its metric stopped being
            published reads STALE above rather than healthy, which is the only part of that
            distinction this page can currently make.
          </p>
        </div>
      </Card>
    ),

    /* ── The ones that do not ───────────────────────────────────────────── */
    "watching-quietly": (
      <Card
        id="watching-quietly"
        headline="Watching quietly"
        headerAside={
          <Badge tone="neutral" title="Alarms in OK with their actions enabled">
            {quiet.length}
          </Badge>
        }
        supportingText={statedAsOf(
          "Alarms that are evaluating, have their actions enabled, and have nothing to report",
          surface.asOf,
        )}
      >
        {quiet.length === 0 ? (
          <EmptyState
            headline="No alarm is quietly working"
            description={
              answered
                ? "Nothing in this account is currently in OK. Either every alarm has something to say, or there are no alarms."
                : "The alarm read did not answer, so this console cannot say what is quietly working."
            }
          />
        ) : (
          /* Collapsed by default: this is the half of the page nobody opened it
             for. `globals.css` makes a closed <details> display:none rather
             than merely unpainted, so the rows below do not report a rectangle
             over the card that follows. */
          <details className={styles.disclosure}>
            <summary className="md3-label-large">
              Show the {quiet.length} alarm{quiet.length === 1 ? "" : "s"} with nothing to report
            </summary>
            <AlarmTable
              caption="Alarms in OK"
              rows={quiet}
              empty={
                <EmptyState
                  headline="No alarm is quietly working"
                  description="Nothing in this account is currently in OK."
                />
              }
            />
          </details>
        )}
      </Card>
    ),

    /* ── Whether this page can say what SHOULD exist ────────────────────── */
    coverage: (
      <Card
        id="coverage"
        headline="Coverage"
        headerAside={
          <Badge
            tone={coverage.known ? (coverage.missing > 0 ? "bad" : "ok") : "warn"}
            title="Whether the alarms the estate declares were all found"
          >
            {coverage.known ? `${coverage.present} of ${coverage.declared}` : "Not known"}
          </Badge>
        }
        supportingText={statedAsOf(
          "What the estate's Terraform declares, against what a successful DescribeAlarms response actually contained",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          {coverage.known ? (
            <>
              <p className="md3-body-medium">
                {coverage.missing === 0
                  ? `Every one of the ${coverage.declared} alarm(s) this estate declares was found in the response.`
                  : `${coverage.missing} of the ${coverage.declared} alarm(s) this estate declares ${
                      coverage.missing === 1 ? "was" : "were"
                    } not in the response. They are listed above with the verdict ${ALARM_WORDS.MISSING}.`}
              </p>
              <KeyValue
                ariaLabel="Declared against found"
                items={[
                  { key: "declared", term: "Declared", value: String(coverage.declared) },
                  { key: "found", term: "Found", value: String(coverage.present) },
                  { key: "missing", term: "Not created", value: String(coverage.missing) },
                ]}
              />
            </>
          ) : (
            /* The panel saying plainly that it does not know, and what would
               make it know. A zero here would read as "nothing is missing". */
            <div className={styles.tight}>
              <p className="md3-body-medium">
                This console cannot say whether the estate&rsquo;s alarms are all present.
              </p>
              <p className="md3-body-small">{coverage.because}</p>
            </div>
          )}
        </div>
      </Card>
    ),

    /* ── The intersection nobody is watching ────────────────────────────── */
    unwatched: (
      <Card
        id="unwatched"
        headline="What nothing is watching"
        headerAside={
          <span className={styles.row}>
            <Badge tone={watch.tone} title={watch.sentence}>
              {watch.verdict}
            </Badge>
            <StaleIndicator
              asOf={dashboards.asOf}
              cadenceMs={dashboards.refreshMs}
              label="the dashboard reading this subtracts from"
            />
          </span>
        }
        supportingText={statedAsOf(
          "Every log group and every alarm this account holds, subtracted from what the dashboards actually reference — the part of the estate no screen and no metric is looking at",
          dashboards.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-large" data-testid="watch-headline">
            {watch.sentence}
          </p>

          {/*
            The honest boundary of the candidate set, printed before the counts
            rather than after them. "3 things are unwatched" reads as a claim
            about the fleet; it is a claim about two inventories.
          */}
          <p className="md3-body-small">{CANDIDATES_WHY}</p>

          {/*
            Why the subtraction is not a finding, when it is not. This is the
            sentence that stops an operator building a second dashboard for a
            service that is already on one nobody could open.
          */}
          {join.because ? (
            <p className="md3-body-medium" data-testid="watch-undecidable">
              This subtraction is INCOMPLETE. {join.because}
            </p>
          ) : null}

          <KeyValue
            ariaLabel="What the subtraction found"
            items={[
              /*
                Both of these print a COUNT, and a count of zero out of zero is
                the most reassuring sentence on the page. So neither is rendered
                unless the log group listing actually answered: with no listing
                there is no denominator, and "0 of 0 log groups are unwatched"
                describes an estate nobody looked at as an estate with nothing
                wrong in it.
              */
              {
                key: "dark-groups",
                term: "Log groups nobody reads",
                value: !join.groupsKnown
                  ? `not known — ${join.groupsBecause ?? "the log group listing did not answer"}`
                  : `${join.unwatched} of ${join.groups.length} — no dashboard queries them and no metric filter on them feeds a namespace any dashboard draws`,
              },
              {
                key: "undecidable-groups",
                term: "Log groups this cannot decide",
                value: !join.groupsKnown
                  ? "not known — there is no list of log groups to decide anything about"
                  : join.undecidable === 0
                    ? "none — every group was compared against a complete coverage set"
                    : `${join.undecidable} — either their metric filters were not read or the dashboard coverage set is incomplete. Not a claim that they are unwatched, and not a claim that they are fine`,
              },
              {
                key: "namespaces",
                term: "Namespaces no dashboard draws",
                value:
                  join.namespaces.kind === "decidable"
                    ? join.namespaces.namespaces.length === 0
                      ? `none — every one of the ${join.candidateNamespaces.length} namespace(s) this estate's metric filters emit into appears on a dashboard`
                      : `${join.namespaces.namespaces.join(", ")} — a metric filter writes into ${join.namespaces.namespaces.length === 1 ? "it" : "them"} and nothing plots ${join.namespaces.namespaces.length === 1 ? "it" : "them"}`
                    : `not decidable — ${join.namespaces.why} Shortlist to check by hand: ${join.namespaces.notOnAnyDashboardRead.length > 0 ? join.namespaces.notOnAnyDashboardRead.join(", ") : "none"}`,
              },
              {
                key: "alarms-off-dashboard",
                term: "Alarms on no dashboard",
                value: !join.alarms.decidable
                  ? `not decidable — ${join.alarms.because ?? "one side of the join did not answer"}`
                  : join.alarms.onNoDashboard.length === 0
                    ? `none — all ${join.alarms.existing} alarm(s) that exist are named by a dashboard widget`
                    : `${join.alarms.onNoDashboard.length} of ${join.alarms.existing}: ${join.alarms.onNoDashboard.join(", ")}. They can still page somebody; nobody looking at a wall would see them`,
              },
              {
                key: "alarms-dangling",
                term: "Alarms a dashboard names that are not there",
                /*
                  "none" here is a claim that every widget points at something
                  real, and it can only be made when BOTH sides answered. With
                  a refused alarm read the list is empty because nothing was
                  compared, and printing "none" would turn that into the
                  reassurance the whole read plane exists against.
                */
                value: !join.alarms.decidable
                  ? `not decidable — ${join.alarms.because ?? "one side of the join did not answer"}`
                  : join.alarms.referencedAndAbsent.length === 0
                    ? "none — every alarm a widget names was in the DescribeAlarms response"
                    : `${join.alarms.referencedAndAbsent.join(", ")} — a widget points at ${join.alarms.referencedAndAbsent.length === 1 ? "an alarm" : "alarms"} this account does not have, so it renders as an empty box, which on a wall reads as “not firing”. A cross-account widget would look the same, and this join is by name only`,
              },
            ]}
          />

          <WatchTable
            rows={join.groups}
            empty={
              <EmptyState
                headline={
                  logsUnknown ? "This list is not empty — it is unknown" : "No log group to compare"
                }
                description={
                  logsUnknown
                    ? "The log group read did not answer, so there is nothing to subtract the dashboards from. The panel below names the principal, the action and the statement that would fix it."
                    : "logs:DescribeLogGroups answered and this account holds no log group at all. Nothing is unwatched because nothing is writing — which is a finding about the estate, not a clean bill of health."
                }
              />
            }
          />

          {logsUnknown ? (
            <UnknownState read={logsUnknown} what="the log groups this subtraction starts from" />
          ) : null}
          {dashboardsUnknown ? (
            <UnknownState
              read={dashboardsUnknown}
              what="the dashboards this subtraction compares against"
            />
          ) : null}
        </div>
      </Card>
    ),

    /* ── The dashboards themselves ──────────────────────────────────────── */
    dashboards: (
      <Card
        id="dashboards"
        headline="What the dashboards look at"
        headerAside={
          <span className={styles.row}>
            <Badge
              tone={boards.known ? (boards.unknownContent > 0 ? "warn" : "neutral") : "warn"}
              title="Dashboards this account holds, and how many of their bodies could be parsed"
            >
              {boards.known ? `${boards.watching} of ${boards.total} parsed` : "Not known"}
            </Badge>
            <StaleIndicator
              asOf={dashboards.asOf}
              cadenceMs={dashboards.refreshMs}
              label="the dashboard reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          "Every CloudWatch dashboard in this account, when each was last changed, and the metrics, alarms and log groups its widgets reference — parsed out of the body, not guessed at",
          dashboards.asOf,
        )}
      >
        <div className={styles.stack}>
          {dashboardsUnknown ? (
            <UnknownState read={dashboardsUnknown} what="the CloudWatch dashboards in this account" />
          ) : (
            <>
              <p className="md3-body-medium">{describeCoverage(dashboards.coverage)}</p>
              <p className="md3-body-small">{describeTruncation(dashboards.truncation)}</p>
              {boards.watchingNothing > 0 ? (
                <p className="md3-body-medium">
                  {boards.watchingNothing} dashboard(s) parsed and declare no widget at all. A
                  dashboard somebody emptied still opens, and an operator who opens it sees a page
                  with nothing wrong on it.
                </p>
              ) : null}
              <DashboardTable
                rows={
                  dashboards.dashboards.state === "ACTUAL" ||
                  dashboards.dashboards.state === "STALE"
                    ? dashboards.dashboards.value
                    : []
                }
                empty={
                  <EmptyState
                    headline="This account has no CloudWatch dashboard"
                    description="cloudwatch:ListDashboards answered and returned nothing. Nothing in this account is displayed on a wall, which is why every log group above is unwatched unless a metric filter and an alarm carry it."
                  />
                }
              />
            </>
          )}
        </div>
      </Card>
    ),

    /* ── The log groups, their retention, and whether anything arrives ──── */
    "log-groups": (
      <Card
        id="log-groups"
        headline="Log groups"
        headerAside={
          <span className={styles.row}>
            <Badge
              tone={
                retention.known
                  ? retention.neverExpires + retention.tooShort > 0
                    ? "bad"
                    : "ok"
                  : "warn"
              }
              title="Log groups whose retention is either unbounded or shorter than an on-call rotation"
            >
              {retention.known
                ? `${retention.neverExpires + retention.tooShort} of ${retention.groups} misretained`
                : "Not known"}
            </Badge>
            <Badge
              tone={silence.known ? (silence.silent > 0 ? "bad" : "ok") : "warn"}
              title="Log groups that received nothing in the last 24 hours"
            >
              {silence.known ? `${silence.silent} silent` : "Not known"}
            </Badge>
            <StaleIndicator
              asOf={logs.asOf}
              cadenceMs={logs.refreshMs.groups}
              label="the log group reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          "Every log group in this account: how long it keeps what it is given, what it is billing for, whose key it is under, what turns its lines into metrics, and whether anything is still writing to it",
          logs.asOf,
        )}
      >
        <div className={styles.stack}>
          {logsUnknown ? (
            <UnknownState read={logsUnknown} what="the log groups in this account" />
          ) : (
            <>
              <p className="md3-body-small">{describeCompleteness(logs.completeness)}</p>
              <KeyValue
                ariaLabel="The account's log retention posture"
                items={[
                  {
                    key: "never-expires",
                    term: "Never expire",
                    value:
                      retention.neverExpires === 0
                        ? "none — every group has a retention somebody set"
                        : `${retention.neverExpires} of ${retention.groups}. AWS defines a missing retentionInDays as Never expire: the group only grows, nothing in it ages out, and for a group carrying tenant data that is a retention-policy breach as well as an unbounded bill`,
                  },
                  {
                    key: "too-short",
                    term: "Shorter than an on-call rotation",
                    value:
                      retention.tooShort === 0
                        ? "none — no group deletes its evidence inside a week"
                        : `${retention.tooShort} of ${retention.groups}. An incident that starts on a Saturday has no evidence left when it is reviewed on the Friday`,
                  },
                  {
                    key: "bytes",
                    term: "Stored",
                    value: `${formatBytes(retention.storedBytes)} across ${retention.groups - retention.groupsNotReportingBytes} group(s)${
                      retention.groupsNotReportingBytes === 0
                        ? ""
                        : `, plus ${retention.groupsNotReportingBytes} group(s) for which AWS reported no size at all — not counted as zero`
                    }`,
                  },
                  {
                    key: "keys",
                    term: "Under a key this estate cannot revoke",
                    value:
                      retention.withoutCustomerKey === 0
                        ? "none — every group names a customer-managed KMS key"
                        : `${retention.withoutCustomerKey} of ${retention.groups} carry no kmsKeyId, so they are encrypted with the AWS-owned CloudWatch Logs key. That is encryption at rest and it is not a key this estate holds, audits or can revoke`,
                  },
                  {
                    key: "tenant-data",
                    term: "Named as carrying tenant data",
                    value: `${retention.markedTenantData} of ${retention.groups} have a name that marks them as carrying tenant data. This page prints no log line from any group; the absence of a marker is a statement about the NAME and is not a certification`,
                  },
                  {
                    key: "arriving",
                    term: "Still receiving",
                    value: `${silence.receiving} receiving · ${silence.silent} silent · ${silence.unreadable} not established · ${silence.notProbed} not probed`,
                  },
                ]}
              />
              <p className="md3-body-small">{SILENCE_PROBE_WHY}</p>
              <LogGroupTable
                rows={
                  logs.groups.state === "ACTUAL" || logs.groups.state === "STALE"
                    ? logs.groups.value
                    : []
                }
                empty={
                  <EmptyState
                    headline="This account holds no log group"
                    description="logs:DescribeLogGroups answered and returned nothing. Nothing in this account is writing a log anywhere CloudWatch can see, which is a finding rather than a tidy estate."
                  />
                }
              />
            </>
          )}
        </div>
      </Card>
    ),

    /* ── Where all of it came from ──────────────────────────────────────── */
    provenance: (
      <Card
        id="provenance"
        headline="Where this came from"
        supportingText={statedAsOf(
          "The two calls this page made, the principal it made them as, and the estate that answered",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          <KeyValue
            ariaLabel="What produced this page"
            items={provenance.map((fact) => ({
              key: fact.label,
              term: fact.label,
              value: <code>{fact.value}</code>,
            }))}
          />

          {/*
            The legend. Collapsed, because it is reference rather than news —
            but on the page rather than in a doc, because Bible §26.3.2 makes
            the WORD the carrier of the meaning and a vocabulary an operator
            cannot look up is a vocabulary of guesses.
          */}
          <details className={styles.disclosure}>
            <summary className="md3-label-large">What each word on this page means</summary>
            <DataTable
              caption="The verdicts this page prints, and what each one is telling you"
              rowKey={(row) => `${row.source}:${row.verdict}`}
              columns={[
                {
                  key: "word",
                  header: "Word",
                  cell: (row) => (
                    <Badge tone={row.tone} title={row.verdict}>
                      {row.word}
                    </Badge>
                  ),
                },
                { key: "source", header: "From", cell: (row) => row.source },
                {
                  key: "means",
                  header: "What it means",
                  cell: (row) => <span className={styles.cell}>{row.means}</span>,
                },
              ]}
              rows={LEGEND}
              empty={
                <EmptyState
                  headline="No verdicts"
                  description="The verdict vocabulary is empty, which cannot happen while alarms.ts and aws-health.ts each declare one."
                />
              }
            />
          </details>
        </div>
      </Card>
    ),
  }

  /*
   * `data-surface="health"`, where it used to say `alarms`. The surface is both
   * readings now, and an attribute naming half of it is an attribute somebody
   * will key a selector on and be wrong about. No spec pins the old value —
   * grepped across `src/`, `e2e/` and the monorepo `tests/`.
   */
  return (
    <div className={styles.page} data-surface="health">
      <header className={styles.lead}>
        <h1 className="md3-headline-large">Health</h1>
        {/* The question, in the words an operator would use, above every piece
            of apparatus that answers it. */}
        <p className="md3-title-medium" data-testid="page-question">
          Is anything broken right now, and is it us or is it AWS?
        </p>
        <p className="md3-body-medium">
          Every CloudWatch alarm in this account and whether it would actually tell anybody, beside
          what AWS says about its own estate.
        </p>
        {/* Which estate this is. Rendered as prose rather than in a chip because
            on a refusal it is a whole IAM statement, and a pill four lines tall
            is a pill that has stopped being a pill. */}
        <p className={`md3-body-small ${styles.identifier}`}>{identityHeadline(identity)}</p>
      </header>

      {sectionOrder(side).map((id) => (
        <Fragment key={id}>{sections[id]}</Fragment>
      ))}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────── the tables ── */

/**
 * One alarm table.
 *
 * Three columns rather than four: the alarm's kind — `MetricAlarm`,
 * `CompositeAlarm`, or the two this console synthesises — sits under the name
 * instead of taking a column of its own. At 320 CSS pixels a fourth `<th>` is
 * `white-space: nowrap` on a table that is already scrolling inside its shell,
 * and the kind is the least likely of the four facts to be what somebody is
 * scanning for.
 *
 * `DataTable` supplies the bounded scroll region, so the PAGE never scrolls
 * sideways — `layout.spec.ts` measures that at every width. The cells opt back
 * into `overflow-wrap: anywhere`, which `globals.css` withholds from `td` so a
 * wide table can scroll rather than collapse its columns.
 */
function AlarmTable({
  caption,
  rows,
  empty,
}: {
  caption: string
  rows: readonly AlarmRow[]
  empty: ReactNode
}) {
  return (
    <DataTable
      caption={caption}
      rowKey={(row) => `${row.type}:${row.name}`}
      columns={[
        {
          key: "alarm",
          header: "Alarm",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>{row.name}</span>
              <span className="md3-label-small">{row.type}</span>
            </span>
          ),
        },
        {
          key: "verdict",
          header: "Verdict",
          cell: (row) => (
            <Badge tone={VERDICT_TONE[row.verdict]} title={row.verdict}>
              {ALARM_WORDS[row.verdict]}
            </Badge>
          ),
        },
        {
          key: "detail",
          header: "What it means",
          cell: (row) => <span className={styles.cell}>{row.detail}</span>,
        },
      ]}
      rows={rows}
      empty={empty}
    />
  )
}

/**
 * The AWS Health events, in the same three-column shape as the alarms.
 *
 * The service and the event type are one cell rather than two: `EC2` beside
 * `AWS_EC2_OPERATIONAL_ISSUE` is one identifier as far as scanning goes, and a
 * fourth column at 320 CSS pixels is a column nobody reads. `entitiesDetail` is
 * printed under the detail because "what it touches here" is the half of an AWS
 * event that decides whether anybody acts — and it is a sentence rather than a
 * count precisely so that "not looked into" cannot render as "touches nothing".
 */
function HealthEventTable({ rows, empty }: { rows: readonly HealthEventRow[]; empty: ReactNode }) {
  return (
    <DataTable
      caption="Open and upcoming AWS Health events for this account"
      rowKey={(row) => row.arn}
      columns={[
        {
          key: "event",
          header: "Event",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>{row.eventTypeCode}</span>
              <span className="md3-label-small">
                {row.service} · {row.region}
                {row.availabilityZone ? ` · ${row.availabilityZone}` : ""}
              </span>
            </span>
          ),
        },
        {
          key: "verdict",
          header: "Verdict",
          cell: (row) => (
            <Badge tone={HEALTH_TONE[row.verdict]} title={row.verdict}>
              {HEALTH_WORDS[row.verdict]}
            </Badge>
          ),
        },
        {
          key: "detail",
          header: "What it means",
          cell: (row) => (
            <span className={styles.cell}>
              <span>{row.detail}</span>
              <span className="md3-label-small">{row.entitiesDetail}</span>
            </span>
          ),
        },
      ]}
      rows={rows}
      empty={empty}
    />
  )
}

/**
 * The subtraction, one row per log group.
 *
 * `watch.ts` has already ordered them — the finding first, then the doubt, then
 * the ones that are fine — because a table an operator has to scan for the bad
 * rows is a table whose bad rows get missed. The verdict word is a Badge and the
 * reason is prose beside it, in the same three-column shape as every other table
 * on this page.
 */
function WatchTable({ rows, empty }: { rows: readonly LogGroupWatch[]; empty: ReactNode }) {
  return (
    <DataTable
      caption="Every log group, and whether anything at all is looking at it"
      rowKey={(row) => row.logGroupName}
      columns={[
        {
          key: "group",
          header: "Log group",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>{row.logGroupName}</span>
              {row.silent ? (
                <span className="md3-label-small">received nothing in the last 24 hours</span>
              ) : null}
            </span>
          ),
        },
        {
          key: "verdict",
          header: "Verdict",
          cell: (row) => (
            <Badge tone={WATCH_TONE[row.verdict]} title={row.verdict}>
              {WATCH_WORD[row.verdict]}
            </Badge>
          ),
        },
        {
          key: "detail",
          header: "What it means",
          cell: (row) => <span className={styles.cell}>{row.detail}</span>,
        },
      ]}
      rows={rows}
      empty={empty}
    />
  )
}

/**
 * The dashboards, and what each one's body actually references.
 *
 * `describeContent` is `dashboards.ts`'s own renderer rather than a sentence
 * this page assembles: it is the single funnel through which `watching`,
 * `watching-nothing`, `malformed` and `not-read` are worded, and a second
 * wording here is how a dashboard nobody could open ends up reading like a
 * dashboard watching nothing.
 */
function DashboardTable({ rows, empty }: { rows: readonly DashboardRow[]; empty: ReactNode }) {
  return (
    <DataTable
      caption="Every CloudWatch dashboard in this account and what its widgets reference"
      rowKey={(row) => row.name}
      columns={[
        {
          key: "dashboard",
          header: "Dashboard",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>{row.name}</span>
              <span className="md3-label-small">{describeDashboardAttribution(row.attribution)}</span>
            </span>
          ),
        },
        {
          key: "changed",
          header: "Last changed",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>
                {row.lastModified ?? "not known — the listing carried no parseable timestamp"}
              </span>
            </span>
          ),
        },
        {
          key: "references",
          header: "What it references",
          cell: (row) => <span className={styles.cell}>{describeContent(row.content)}</span>,
        },
      ]}
      rows={rows}
      empty={empty}
    />
  )
}

/**
 * One log group's posture: how long it keeps things, and whether anything still
 * arrives.
 *
 * Both badges come from the reader's own classification — `RetentionPosture` and
 * `LastEventAge` — and both keep their four arms apart. In particular NOT_PROBED
 * and SILENT are different words with different tones: one is this console
 * having decided not to spend a billed call, the other is an observation that
 * nothing arrived, and a table that rendered them alike would let a probe this
 * page skipped read as a service that has gone quiet.
 */
function LogGroupTable({ rows, empty }: { rows: readonly LogGroupReading[]; empty: ReactNode }) {
  return (
    <DataTable
      caption="Every log group in this account, its retention posture and its freshness"
      rowKey={(row) => row.logGroupName}
      columns={[
        {
          key: "group",
          header: "Log group",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>{row.logGroupName}</span>
              <span className="md3-label-small">{describeLogGroupAttribution(row.attribution)}</span>
            </span>
          ),
        },
        {
          key: "retention",
          header: "Retention",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.row}>
                <Badge tone={RETENTION_TONE[row.retention.kind]} title={row.retention.kind}>
                  {RETENTION_WORD[row.retention.kind]}
                </Badge>
                <Badge tone={FRESHNESS_TONE[row.lastEvent.state]} title={row.lastEvent.state}>
                  {FRESHNESS_WORD[row.lastEvent.state]}
                </Badge>
              </span>
              <span className="md3-label-small">{describeRetention(row.retention)}</span>
            </span>
          ),
        },
        {
          key: "detail",
          header: "What it holds, and whether anything is arriving",
          cell: (row) => (
            <span className={styles.cell}>
              <span>{describeLastEvent(row.lastEvent)}</span>
              <span className="md3-label-small">{describeMetricFilters(row.metricFilters)}</span>
              <span className="md3-label-small">
                {row.storedBytes === null
                  ? "stored bytes not reported by AWS — not counted as zero"
                  : formatBytes(row.storedBytes)}
                {" · "}
                {row.encryption.kind === "customer-key"
                  ? `customer key ${row.encryption.kmsKeyArn}`
                  : "AWS-owned key, which this estate cannot revoke"}
                {row.sensitivity.kind === "tenant-data"
                  ? ` · name marks it as carrying tenant data (${row.sensitivity.marker})`
                  : ""}
              </span>
            </span>
          ),
        },
      ]}
      rows={rows}
      empty={empty}
    />
  )
}

/* ──────────────────────────────────────────────────────────────── legend ── */

/**
 * The vocabulary of this page, in the operator's language.
 *
 * Both halves of it: the eight alarm verdicts, which describe THIS estate, and
 * the AWS Health verdicts, which describe AWS's. They are one table with a
 * "From" column rather than two tables, because the question an operator has is
 * "what does that word mean", not "which reader produced it" — and because two
 * legends is where a word ends up meaning two things.
 */
const LEGEND: ReadonlyArray<{
  verdict: string
  word: string
  source: string
  tone: (typeof VERDICT_TONE)[keyof typeof VERDICT_TONE]
  means: string
}> = [
  {
    verdict: "ALARM",
    word: ALARM_WORDS.ALARM,
    source: "Our alarms",
    tone: VERDICT_TONE.ALARM,
    means: "CloudWatch has crossed the threshold and the alarm's actions have run.",
  },
  {
    verdict: "MISSING",
    word: ALARM_WORDS.MISSING,
    source: "Our alarms",
    tone: VERDICT_TONE.MISSING,
    means:
      "The estate's Terraform declares this alarm and a successful DescribeAlarms response did not contain it. Nothing is watching what it was written to watch.",
  },
  {
    verdict: "DISABLED",
    word: ALARM_WORDS.DISABLED,
    source: "Our alarms",
    tone: VERDICT_TONE.DISABLED,
    means:
      "The alarm exists and its actions are switched off, so it cannot notify anybody whatever its metric says. This outranks OK: an alarm nobody hears protects nothing.",
  },
  {
    verdict: "UNAUTHORIZED",
    word: ALARM_WORDS.UNAUTHORIZED,
    source: "Our alarms",
    tone: VERDICT_TONE.UNAUTHORIZED,
    means:
      "This engine's role was refused the read. It describes the whole surface rather than one alarm, and it is not a claim that anything is wrong.",
  },
  {
    // Beside UNAUTHORIZED, because the pair is what an operator has to tell
    // apart: both say nothing was learnt, and only the one above names a
    // statement to grant. Absent from this legend, the word this console
    // prints for a throttled or unconfigured read is the one word on the page
    // with no entry explaining it.
    verdict: "UNREADABLE",
    word: ALARM_WORDS.UNREADABLE,
    source: "Our alarms",
    tone: VERDICT_TONE.UNREADABLE,
    means:
      "cloudwatch:DescribeAlarms was rate-limited, is not configured for this account, or failed. Like a refusal it describes the whole surface rather than one alarm, and unlike a refusal there is no permission to grant — the next move is to retry or to configure.",
  },
  {
    verdict: "STALE",
    word: ALARM_WORDS.STALE,
    source: "Our alarms",
    tone: VERDICT_TONE.STALE,
    means:
      "The alarm has not changed state for longer than this surface allows. A metric that stopped being published leaves its alarm in OK forever.",
  },
  {
    verdict: "INSUFFICIENT_DATA",
    word: ALARM_WORDS.INSUFFICIENT_DATA,
    source: "Our alarms",
    tone: VERDICT_TONE.INSUFFICIENT_DATA,
    means: "There are not enough data points to evaluate. This is not the same as healthy.",
  },
  {
    verdict: "OK",
    word: ALARM_WORDS.OK,
    source: "Our alarms",
    tone: VERDICT_TONE.OK,
    means: "Evaluating, actions enabled, below the threshold, and recently updated.",
  },
  {
    verdict: "AFFECTING_US",
    word: HEALTH_WORDS.AFFECTING_US,
    source: "AWS Health",
    tone: HEALTH_TONE.AFFECTING_US,
    means:
      "AWS raised this event against resources in THIS account and it is open. The loudest thing AWS Health can say, and the one that makes an incident theirs rather than ours.",
  },
  {
    verdict: "OPEN_IN_OUR_REGION",
    word: HEALTH_WORDS.OPEN_IN_OUR_REGION,
    source: "AWS Health",
    tone: HEALTH_TONE.OPEN_IN_OUR_REGION,
    means:
      "A public event in the region this process resolved for itself, or one AWS did not scope to a region at all. Not raised against this account, and not ruled out for it.",
  },
  {
    verdict: "OPEN_REGION_UNKNOWN",
    word: HEALTH_WORDS.OPEN_REGION_UNKNOWN,
    source: "AWS Health",
    tone: HEALTH_TONE.OPEN_REGION_UNKNOWN,
    means:
      "A public event this console could not place, because sts:GetCallerIdentity has not answered and there is no resolved region to compare against. Not a claim that it is somebody else's.",
  },
  {
    verdict: "OPEN_ELSEWHERE",
    word: HEALTH_WORDS.OPEN_ELSEWHERE,
    source: "AWS Health",
    tone: HEALTH_TONE.OPEN_ELSEWHERE,
    means:
      "Open in a region this account did not resolve to. Informational, and still worth reading if anything this estate depends on is cross-region.",
  },
  {
    verdict: "UPCOMING",
    word: HEALTH_WORDS.UPCOMING,
    source: "AWS Health",
    tone: HEALTH_TONE.UPCOMING,
    means:
      "Scheduled and not started — a retirement or a mandatory upgrade window. Nothing is broken yet and somebody still has to act.",
  },
  {
    verdict: "NOTIFICATION",
    word: HEALTH_WORDS.NOTIFICATION,
    source: "AWS Health",
    tone: HEALTH_TONE.NOTIFICATION,
    means: "AWS telling this account something. Not an impairment.",
  },
]
