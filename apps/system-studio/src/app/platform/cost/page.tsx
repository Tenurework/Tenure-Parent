import Link from "next/link"

import { Badge, Card, Chip, DataTable, EmptyState as EmptyRegion, type DataColumn } from "@/components/md3"
import { EmptyState, ErrorState, PermissionDeniedState } from "@/components/states"
import { auth } from "@/lib/auth"
import { authorizeCommand } from "@/lib/authorize"
import { budgetReadings } from "@/lib/aws/budgets"
import { denialContextFrom, resolveIdentity } from "@/lib/aws/identity"
import { taggedResources } from "@/lib/aws/tags"
import { costSource, type CostSource } from "@/lib/cost-source"

import { CostAnswer, type CostFigure } from "./CostAnswer"
import { CostAttribution } from "./CostAttribution"
import { CostBudgets } from "./CostBudgets"
import { CostReportView } from "./CostReportView"
import { formatAmount, thresholdRows, type ThresholdRow } from "./cost-decisions"
import styles from "./cost.module.css"

/**
 * The FinOps Center — STUDIO-120-008/009/010.
 *
 * ## The question, and the order of the answers
 *
 *   > What is this fleet costing, who is it costing it for, and is anything
 *   > running away?
 *
 * Three questions, three panels, in that order, each leading with its answer in
 * a sentence before any table. The page used to answer only the first, and only
 * when a Cost and Usage Report existed — which is never, today — so an operator
 * arriving here read a paragraph about allocation methodology and left knowing
 * nothing. The second and third questions have real answers right now:
 *
 *   * **Who for** comes from the `tenure:tenant` resource tag, read live through
 *     the Resource Groups Tagging API. Attribution is a property of the ESTATE,
 *     not of the bill; the CUR merely carries the tag through. So the shape of
 *     what a bill would be charged to is knowable before the first bill, which
 *     is the only time the gaps are still cheap to close.
 *   * **Running away** comes from AWS Budgets — AWS's own forecast against a
 *     limit somebody set, read live. And from the thing every console gets
 *     wrong: a budget whose alert thresholds have no subscriber breaches in
 *     silence, and renders identically to a budget that is fine.
 *
 * ## Three properties are load-bearing, and each is asserted in `e2e/cost.spec.ts`
 *
 *   1. **No figure is invented.** There is deliberately no arm showing sample
 *      data: the bible's prohibited-shortcut list names "fake cost", and this is
 *      the page from which someone approves an Aurora cluster. An empty page is
 *      obviously empty; `$4,182.55` is actionable and wrong. Unknown renders as
 *      the word `Unknown`, never as a zero.
 *   2. **Every panel says what it is AS OF.** The answer says when the bill was
 *      last read, or that it never has been. The two AWS panels carry a
 *      `StaleIndicator` over their capability's own refresh cadence. The
 *      thresholds say they are constants in this build and therefore cannot be
 *      stale — and equally cannot reflect a threshold change nobody deployed.
 *   3. **The console keeps booting.** `costSource()` throws by design when a CUR
 *      is configured but the reader for it does not exist yet, and an uncaught
 *      throw in a server component is a 500 on the whole route. A page that
 *      500s is not an acceptable refusal, so the read is wrapped and the failure
 *      is rendered as the governed `ErrorState` with the engine's own message.
 *      The two AWS reads cannot take the route down either: every failure inside
 *      `readAws` becomes an arm of `AwsRead`, and this page renders the four
 *      valueless arms through the shared `UnknownState` — with the principal,
 *      the action and a pasteable minimum IAM statement — rather than as an
 *      empty list. Verified by rendering this route with no credentials set.
 *
 * ## Money
 *
 * Integer minor units with an explicit currency, everywhere, through
 * `@tenure/finops`. Every figure on this page carries its own minor-unit integer
 * in its `title`, so `$120.00` and `12000 minor units of USD` are the same
 * assertion and there is no float between them.
 */
export const dynamic = "force-dynamic"

/**
 * The read failed. A third arm, and not a third *presentation* of the data.
 *
 * `CostSource` has exactly two states and that is right — either a bill was read
 * or none is connected. This is neither: it is the engine failing to answer, and
 * it is kept out of `CostSource` so nothing downstream can mistake a failure for
 * a source.
 */
type CostRead = CostSource | { state: "UNREADABLE"; detail: string }

async function readCostSource(): Promise<CostRead> {
  try {
    return await costSource()
  } catch (error) {
    /*
     * `error.message`, not the stack and not a swallowed generic. `cost-source`
     * throws deliberately rather than returning `[]` — "a configured-but-
     * unimplemented source can never render as $0.00 spent" — and its message
     * names the requirement that is blocked. That message is the operator's only
     * lead, and `ErrorState`'s contract is never to swallow it.
     */
    return { state: "UNREADABLE", detail: error instanceof Error ? error.message : String(error) }
  }
}

const THRESHOLD_COLUMNS: readonly DataColumn<ThresholdRow>[] = [
  { key: "band", header: "Monthly recurring cost", cell: (row) => row.band },
  { key: "approval", header: "Approval", cell: (row) => row.approval },
  { key: "why", header: "Why", cell: (row) => row.why },
]

/**
 * The three tiles, from whichever arm the read produced.
 *
 * The unknown arm names a reason PER FIGURE rather than repeating one sentence
 * three times, because the three are not unknown for interchangeable reasons —
 * and because a tile reading "Unknown" with no reason beside it is a defect
 * report rather than an answer.
 */
function figuresFor(read: CostRead): readonly CostFigure[] {
  if (read.state !== "CONNECTED") {
    const because =
      read.state === "UNREADABLE"
        ? "Not known: a billing source is configured but this engine could not read it."
        : "Not known: no Cost and Usage Report is connected, so no billed line has ever been read."

    return [
      { label: "Fleet total, month to date", value: null, note: because },
      {
        label: "Reached no tenant",
        value: null,
        note: "Not known until a bill is read. Untagged spend is reported unallocated when it is — never spread across tenants. Which resources are untagged today is answered below.",
      },
      {
        label: "Tenants with attributed spend",
        value: null,
        note: "Not known until a bill is read. Attribution comes from the tenure:tenant resource tag, and which tenants that tag names today is answered below.",
      },
    ]
  }

  /*
   * Reached only once a CUR is connected, which cannot happen before the AWS
   * Organization exists — STUDIO-120-008 is BLOCKED_EXTERNAL on it. Every value
   * here goes through the same production helpers the detail tables below use,
   * so there is nothing here that could format differently from the report it
   * summarises. It is not covered by a run, and that is stated rather than
   * implied.
   */
  const { summary, tenants } = read.report
  return [
    {
      label: "Fleet total, month to date",
      value: formatAmount(summary.actual.amount),
      note: `${Math.round(summary.actual.periodCompleteness * 100)}% through the billing period.`,
    },
    {
      label: "Reached no tenant",
      value: formatAmount(summary.unallocated),
      note: `${(summary.unallocatedShare * 100).toFixed(1)}% of spend. Reported, not spread.`,
    },
    {
      label: "Tenants with attributed spend",
      value: String(tenants.length),
      note: `Of the ${summary.lineCount} ingested lines, these carried a tenure:tenant tag or a driver share.`,
    },
  ]
}

export default async function CostPage() {
  /*
   * STUDIO-020-005/006. NOT the same gate every operator page uses — this is
   * the page that separation of duties is most obviously about.
   *
   * `cost:read` is held by the FinOps Analyst, the Auditor and the Platform
   * Super Admin. A Cloud Platform Engineer, a Support Engineer and a Release
   * Manager are refused: the fleet's bill and the approval thresholds below are
   * the inputs to a spend commitment, and the previous boolean gate meant
   * everyone with an address in the allowlist could read them.
   */
  const session = await auth()
  const decision = authorizeCommand("cost.read", { principalId: session?.user?.email })
  if (decision.reason === "NO_PRINCIPAL") {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }
  if (!decision.allowed) return <PermissionDeniedState />

  // One timestamp for the panels whose as-of IS this request. Read once so two
  // panels on the same page cannot disagree by a few milliseconds and make a
  // reader wonder which of them is later.
  const checkedAt = new Date().toISOString()
  const read = await readCostSource()

  /*
   * The estate, read once and shared.
   *
   * `budgetReadings` resolves identity and the tag inventory itself when it is
   * not given them, so calling it after `taggedResources` without threading
   * these through would make the same two calls twice on one page load — and
   * would let the attribution panel and the budgets panel disagree about the
   * account they are describing. Neither call can throw: every failure inside
   * `readAws` becomes an arm of the union.
   */
  const identity = await resolveIdentity()
  const tagged = await taggedResources(undefined, { denial: denialContextFrom(identity) })
  const budgets = await budgetReadings(undefined, { identity, tagged })

  /*
   * The build this console is running. Present when the image was stamped (the
   * Dockerfile bakes `DEPLOYMENT_ID` in, because `next.config.ts` needs the same
   * value at build and at run time); absent locally. Absent is SAID, not hidden
   * — an unstamped build is exactly the case where "as of" cannot be answered.
   */
  const build = process.env.DEPLOYMENT_ID?.trim()

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1 className="md3-headline-medium">Cost</h1>
        <p className="md3-body-large">
          What is this fleet costing, who is it costing it for, and is anything running away?
        </p>
        <p className="md3-body-medium">
          Three answers follow, in that order. Every figure is money in integer minor units with its
          currency named, taken from a system this engine read — the bill, the resource tags, or AWS
          Budgets. Where a figure is not known, this page says so and names what would make it
          knowable; it never stands a zero in its place.
        </p>
      </header>

      {/* ── 1. What is it costing ──────────────────────────────────────── */}
      <CostAnswer
        asOf={read.state === "CONNECTED" ? read.report.summary.freshness.asOf : null}
        supportingText={
          read.state === "CONNECTED"
            ? "Every figure traces to a billed line in the connected Cost and Usage Report."
            : "Nothing is estimated in place of a bill. This engine reports what it has read, and it has read nothing."
        }
        figures={figuresFor(read)}
      />

      {/* ── Why it says that ───────────────────────────────────────────── */}
      {read.state === "NOT_CONFIGURED" ? (
        <Card
          headline="No billing data is connected"
          headerAside={
            <>
              <Badge tone="warn" title="Two environment variables are unset, so no bill is ingested.">
                not configured
              </Badge>
              <Chip>as of {checkedAt}</Chip>
            </>
          }
          supportingText="The configuration was checked on this page load. Nothing here is cached, so this is what the engine can see right now."
        >
          <EmptyState what="cost data" because={read.why} />

          {/*
            Steps rather than a support link. This is a blocked dependency with
            an exact remedy, and the remedy belongs where the gap is visible —
            an operator who reaches this page should not have to find a runbook
            to learn that the missing piece is a CUR delivery and two
            environment variables.

            `className="steps"` is a locator `e2e/cost.spec.ts` reads, not a
            styling decision; the geometry is the module class beside it.
          */}
          <h3 className="md3-label-large">What connects it</h3>
          <ol className={`steps ${styles.steps}`}>
            {read.operatorSteps.map((step) => (
              <li key={step}>
                <code>{step}</code>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {read.state === "UNREADABLE" ? (
        <Card
          headline="The billing source could not be read"
          headerAside={
            <>
              <Badge tone="bad" title="A CUR is configured, and reading it failed.">
                unreadable
              </Badge>
              <Chip>as of {checkedAt}</Chip>
            </>
          }
          supportingText="A Cost and Usage Report is configured, so this engine tried to read a bill on this page load and failed. It reports the failure rather than an estimate, and rather than a zero."
        >
          <ErrorState what="cost data" detail={read.detail} />
        </Card>
      ) : null}

      {read.state === "CONNECTED" ? <CostReportView report={read.report} /> : null}

      {/* ── 2. Who is it costing it for ────────────────────────────────── */}
      <CostAttribution read={tagged} />

      {/* ── 3. Is anything running away ────────────────────────────────── */}
      <CostBudgets readings={budgets} />

      {/* ── What a new commitment needs ──────────────────────────────────
          Shown whatever the reads returned, because they govern what a plan may
          commit to and that is true before the first bill arrives.
          STUDIO-120-010. */}
      <Card
        headline="Approval thresholds"
        headerAside={
          <>
            <Badge title="Assessed on recurring monthly cost, not on a one-off price.">
              per month, recurring
            </Badge>
            <Chip>{build ? `as of build ${build}` : "as of this build — not stamped"}</Chip>
          </>
        }
        supportingText={
          <>
            Assessed on the <b>recurring monthly</b> cost of a change, not its one-off price. A NAT
            gateway costs about $32 to create and $390 a year to keep; a threshold applied to the
            former approves the latter without anyone seeing it. A plan&rsquo;s total is assessed as
            well as each change in it, so ten small commitments cannot add up to a large one nobody
            approved.
          </>
        }
      >
        <div className={styles.thresholds}>
          <DataTable
            caption="Approval required for a new recurring commitment, by its monthly cost"
            columns={THRESHOLD_COLUMNS}
            rows={thresholdRows()}
            rowKey={(row) => row.band}
            /*
             * Required by the shell, and unreachable while `thresholdRows()`
             * returns four bands. It is written as a real refusal anyway: the
             * state it describes — a console that cannot say what needs
             * approving — is one an operator must not read as "nothing needs
             * approving".
             */
            empty={
              <EmptyRegion
                headline="No approval thresholds are defined"
                description="This console could not read the spend policy. Treat every new recurring commitment as requiring executive approval until it can."
              />
            }
          />
        </div>
        <p className="md3-body-small">
          As of this build. These four bands are policy constants compiled into the console and read
          through <code>approvalFor</code> — the same function that gates a real plan — so they
          cannot be stale, and equally cannot reflect a threshold change nobody has deployed.
        </p>
      </Card>

      <p className="md3-body-small">
        <Link href="/platform">← back to Platform</Link>
      </p>
    </div>
  )
}
