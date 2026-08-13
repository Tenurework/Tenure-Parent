import { Fragment, type ReactNode } from "react"

import { auth } from "@/lib/auth"
import { AwsReadPanel } from "@/components/states"
import { Badge, Card, Chip, DataTable, EmptyState } from "@/components/md3"
import { ALARM_WORDS, alarmSurface, type AlarmRow } from "@/lib/aws/alarms"
import { expectedAlarmNames } from "@/lib/aws/expected-alarms"
import { identityHeadline } from "@/lib/aws/identity"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

import {
  VERDICT_TONE,
  coverageOf,
  countByVerdict,
  leadAnswer,
  partitionAlarms,
  provenanceOf,
  readAnswered,
  statedAsOf,
} from "./answer"
import styles from "./health.module.css"

export const dynamic = "force-dynamic"

/**
 * STUDIO-080-008 — alarms, with the four verdicts CloudWatch does not return.
 *
 * `/platform` printed four green chips out of a compiled JSON file, and told the
 * operator in prose that one of them "is green because nothing can write to the
 * queue it watches". This page replaces that with a live read where the word
 * beside each alarm is a verdict rather than a state: a disabled alarm reads
 * DISABLED even while CloudWatch calls it OK, and an alarm that has not moved in
 * a week reads STALE with the date.
 *
 * The expected set comes from the Terraform, so MISSING is falsifiable — an
 * alarm the estate is supposed to have and does not is a row here rather than an
 * absence nobody notices.
 *
 * ── What this page is arranged around ──────────────────────────────────────
 *
 * It used to be one flat wall: a heading, an identity line, a headline sentence,
 * a paragraph arguing for the verdict model, and then every alarm in the account
 * in one table sorted by whatever order CloudWatch paginated in. An operator
 * opening it during an incident had to read the whole table to find out whether
 * anything was firing, and the loudest thing on the screen was a paragraph
 * explaining the design to a developer.
 *
 * So the shape is now: the ANSWER, then the alarms that need somebody, then the
 * ones that do not, then whether this console can even say what SHOULD exist,
 * then where all of it came from. Every card states what it is as of, and every
 * card that does not know something says so in the place the fact would have
 * gone rather than leaving a blank or a zero.
 *
 * The decision itself is in `./answer.ts` — pure, no client, no React — so
 * `e2e/health-page-logic.spec.ts` drives all six branches of the lead answer at
 * the node level. A ternary chain inside this render would be an ordering
 * nothing could test, and the ordering is the part that matters: it is where
 * "four alarms are muted" stops being renderable as "healthy".
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

  const answer = leadAnswer(surface.read.state, surface.rows)
  const counts = countByVerdict(surface.rows)
  const { attention, quiet } = partitionAlarms(surface.rows)
  const coverage = coverageOf(expected, surface.rows, surface.read.state)
  const answered = readAnswered(surface.read.state)

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
  })

  return (
    <div className={styles.page} data-surface="alarms">
      <header className={styles.lead}>
        <h1 className="md3-headline-large">Health</h1>
        <p className="md3-body-medium">
          Every CloudWatch alarm in this account, and whether it would actually tell anybody.
        </p>
        {/* Which estate this is. Rendered as prose rather than in a chip because
            on a refusal it is a whole IAM statement, and a pill four lines tall
            is a pill that has stopped being a pill. */}
        <p className={`md3-body-small ${styles.identifier}`}>{identityHeadline(identity)}</p>
      </header>

      {/* ── The answer ───────────────────────────────────────────────────────
          The fact an operator came for, above everything that explains it. */}
      <Card
        id="right-now"
        headline="Right now"
        headerAside={
          <Badge tone={answer.tone} title={answer.headline}>
            {answer.verdict}
          </Badge>
        }
        supportingText={statedAsOf(
          "What an operator should act on first, from one live cloudwatch:DescribeAlarms call and the alarm set the estate's Terraform declares",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          {/* The testid predates this layout and is kept on the sentence it has
              always named: the one-line answer this surface leads with. */}
          <p className="md3-body-large" data-testid="alarm-headline">
            {answer.headline}
          </p>
          {answer.because ? <p className="md3-body-medium">{answer.because}</p> : null}

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
            The governed state block for the arm this read came back in. It
            renders nothing for ACTUAL — a banner saying "the read succeeded"
            above a populated table is noise — and for DENIED it is the whole
            answer: principal, action, error code, account/region/partition and
            the minimum statement, in the one component every AWS-backed surface
            in this console uses, so a refusal cannot be worded as an absence
            here and correctly somewhere else.
          */}
          <AwsReadPanel read={surface.read} what="the alarm inventory" />
        </div>
      </Card>

      {/* ── The alarms that need somebody ────────────────────────────────── */}
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
      </Card>

      {/* ── The ones that do not ─────────────────────────────────────────── */}
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

      {/* ── Whether this page can say what SHOULD exist ──────────────────── */}
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
              <dl className={styles.facts}>
                <dt>Declared</dt>
                <dd>{coverage.declared}</dd>
                <dt>Found</dt>
                <dd>{coverage.present}</dd>
                <dt>Not created</dt>
                <dd>{coverage.missing}</dd>
              </dl>
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

      {/* ── Where all of it came from ────────────────────────────────────── */}
      <Card
        id="provenance"
        headline="Where this came from"
        headlineAs="h2"
        supportingText={statedAsOf(
          "The call this page made, the principal it made it as, and the estate that answered",
          surface.asOf,
        )}
      >
        <div className={styles.stack}>
          <dl className={styles.facts}>
            {/* A Fragment with a key, not `<>`: a term and its definition are
                two siblings of the same `<dl>` grid, so they cannot be wrapped
                in an element, and the shorthand fragment cannot carry the key
                React needs to keep the pairs matched across a re-render. */}
            {provenance.map((fact) => (
              <Fragment key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>
                  <span className={styles.identifier}>{fact.value}</span>
                </dd>
              </Fragment>
            ))}
          </dl>

          {/*
            The legend. Collapsed, because it is reference rather than news —
            but on the page rather than in a doc, because Bible §26.3.2 makes
            the WORD the carrier of the meaning and a vocabulary of seven words
            an operator cannot look up is a vocabulary of seven guesses.
          */}
          <details className={styles.disclosure}>
            <summary className="md3-label-large">What each verdict means</summary>
            <DataTable
              caption="The seven verdicts, and what each one is telling you"
              rowKey={(row) => row.verdict}
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
                  description="The verdict vocabulary is empty, which cannot happen while alarms.ts declares one."
                />
              }
            />
          </details>
        </div>
      </Card>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────── the table ── */

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

/* ──────────────────────────────────────────────────────────────── legend ── */

/**
 * The seven verdicts in the operator's language.
 *
 * This replaces a paragraph that argued the design to a developer — "Seven
 * verdicts, not three", and a sentence about which code path MISSING can be
 * produced from. Both facts are true and neither is what somebody opens an
 * alarms page to read. What survives is the operational half: why a muted alarm
 * outranks a healthy one, and why "no data" is not "fine".
 */
const LEGEND: ReadonlyArray<{
  verdict: string
  word: string
  tone: (typeof VERDICT_TONE)[keyof typeof VERDICT_TONE]
  means: string
}> = [
  {
    verdict: "ALARM",
    word: ALARM_WORDS.ALARM,
    tone: VERDICT_TONE.ALARM,
    means: "CloudWatch has crossed the threshold and the alarm's actions have run.",
  },
  {
    verdict: "MISSING",
    word: ALARM_WORDS.MISSING,
    tone: VERDICT_TONE.MISSING,
    means:
      "The estate's Terraform declares this alarm and a successful DescribeAlarms response did not contain it. Nothing is watching what it was written to watch.",
  },
  {
    verdict: "DISABLED",
    word: ALARM_WORDS.DISABLED,
    tone: VERDICT_TONE.DISABLED,
    means:
      "The alarm exists and its actions are switched off, so it cannot notify anybody whatever its metric says. This outranks OK: an alarm nobody hears protects nothing.",
  },
  {
    verdict: "UNAUTHORIZED",
    word: ALARM_WORDS.UNAUTHORIZED,
    tone: VERDICT_TONE.UNAUTHORIZED,
    means:
      "This engine's role was refused the read. It describes the whole surface rather than one alarm, and it is not a claim that anything is wrong.",
  },
  {
    verdict: "STALE",
    word: ALARM_WORDS.STALE,
    tone: VERDICT_TONE.STALE,
    means:
      "The alarm has not changed state for longer than this surface allows. A metric that stopped being published leaves its alarm in OK forever.",
  },
  {
    verdict: "INSUFFICIENT_DATA",
    word: ALARM_WORDS.INSUFFICIENT_DATA,
    tone: VERDICT_TONE.INSUFFICIENT_DATA,
    means: "There are not enough data points to evaluate. This is not the same as healthy.",
  },
  {
    verdict: "OK",
    word: ALARM_WORDS.OK,
    tone: VERDICT_TONE.OK,
    means: "Evaluating, actions enabled, below the threshold, and recently updated.",
  },
]
