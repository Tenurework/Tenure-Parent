import Link from "next/link"

import {
  EXECUTIVE_THRESHOLD_MINOR,
  PEER_THRESHOLD_MINOR,
  TWO_PERSON_THRESHOLD_MINOR,
  approvalFor,
  money,
  type ApprovalLevel,
} from "@tenure/finops"

import {
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState as EmptyRegion,
  type DataColumn,
} from "@/components/md3"
import { EmptyState, ErrorState, PermissionDeniedState } from "@/components/states"
import { costSource, type CostSource } from "@/lib/cost-source"
import { auth } from "@/lib/auth"
import { authorizeCommand } from "@/lib/authorize"
import { CostAnswer, type CostFigure } from "./CostAnswer"
import { CostReportView, formatAmount } from "./CostReportView"
import styles from "./cost.module.css"

/**
 * The FinOps Center — STUDIO-120-008/009/010.
 *
 * What the fleet costs, who it costs it for, and how much approval a new
 * commitment needs.
 *
 * ── What changed, and why the shape matters more than the styling ───────────
 *
 * This page used to open with a paragraph about allocation methodology and then
 * put a status badge on a bordered `<section>`. An operator arriving here wants
 * one number and then, immediately, whether it is trustworthy. So the page now
 * leads with `CostAnswer` — three tiles, in both states — and everything that
 * explains HOW the number is produced moved underneath the number it explains.
 *
 * Three properties are load-bearing and each is asserted in `e2e/cost.spec.ts`:
 *
 *   1. **No figure is invented.** There is deliberately no arm showing sample
 *      data: the bible's prohibited-shortcut list names "fake cost", and this is
 *      the page from which someone approves an Aurora cluster. An empty page is
 *      obviously empty; `$4,182.55` is actionable and wrong. Unknown renders as
 *      the word `Unknown`, never as a zero.
 *   2. **Every panel says what it is AS OF.** The answer says when the bill was
 *      last read, or that it never has been. The connection panel says when the
 *      configuration was checked. The thresholds say they are constants in this
 *      build and therefore cannot be stale — and equally cannot reflect a
 *      threshold change nobody deployed.
 *   3. **The console keeps booting.** `costSource()` throws by design when a CUR
 *      is configured but the reader for it does not exist yet, and an uncaught
 *      throw in a server component is a 500 on the whole route. A page that
 *      500s is not an acceptable refusal, so the read is wrapped and the failure
 *      is rendered as the governed `ErrorState` with the engine's own message.
 *      No AWS call happens on this route at all, so an absent credential cannot
 *      take it down either.
 */
export const dynamic = "force-dynamic"

// The approval thresholds are USD policy constants, so they are formatted as
// USD. Everything that renders a BILLED figure goes through formatAmount with
// the currency the Money is carrying — see CostReportView.
const usd = (units: number) => formatAmount(money(units, "USD"))

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

/** What each verdict is called, once. `approvalFor` decides which one applies. */
const APPROVAL_LABEL: Record<ApprovalLevel, string> = {
  NONE: "none",
  PEER: "one reviewer",
  TWO_PERSON: "two people",
  EXECUTIVE: "executive",
}

/**
 * Why each verdict is what it is, in the voice of a policy table.
 *
 * Written here rather than taken from `approvalFor`'s own `detail`, which is
 * deliberately phrased about a PARTICULAR change — "…adds a material recurring
 * cost. Two people must agree, and neither may be the requester." Rendering that
 * in a policy table repeats the verdict inside its own justification, and it
 * repeats it in the cell beside the cell that already says it: `e2e/cost.spec.ts`
 * resolves `getByRole("cell", { name: "two people" })` to exactly one element,
 * and a justification containing the words "Two people" makes that two.
 */
const APPROVAL_WHY: Record<ApprovalLevel, string> = {
  NONE: "Recorded but not gated, so the pattern is visible even when each instance is not.",
  PEER: "Small but recurring. One reviewer, so that it is at least seen.",
  TWO_PERSON: "Material. Neither approver may be the requester.",
  EXECUTIVE: "A budget decision, not an engineering one.",
}

interface ThresholdRow {
  band: string
  approval: string
  why: string
}

/**
 * The thresholds table, DERIVED rather than transcribed.
 *
 * The previous version wrote the four rows out by hand and interpolated the
 * three constants into them. That is a table which agrees with the policy on the
 * day it is written: raising `TWO_PERSON_THRESHOLD_MINOR` moved the number in
 * the cell and left the verdict beside it — "two people" — sitting on whatever
 * row it had always been on, with nothing to notice. Here the boundary amount is
 * fed to `approvalFor`, the same function `previewPlanCost` uses to gate a real
 * plan, and the verdict and its justification are its answer. The page cannot
 * disagree with the policy, because it is reading it.
 */
function thresholdRows(): readonly ThresholdRow[] {
  const bands = [
    { at: 0, band: `under ${usd(PEER_THRESHOLD_MINOR)}` },
    {
      at: PEER_THRESHOLD_MINOR,
      band: `${usd(PEER_THRESHOLD_MINOR)} to under ${usd(TWO_PERSON_THRESHOLD_MINOR)}`,
    },
    {
      at: TWO_PERSON_THRESHOLD_MINOR,
      band: `${usd(TWO_PERSON_THRESHOLD_MINOR)} to under ${usd(EXECUTIVE_THRESHOLD_MINOR)}`,
    },
    { at: EXECUTIVE_THRESHOLD_MINOR, band: `${usd(EXECUTIVE_THRESHOLD_MINOR)} and above` },
  ]

  return bands.map(({ at, band }) => {
    const decision = approvalFor({
      change: "A commitment in this band",
      estimated: money(at, "USD"),
    })
    return {
      band,
      approval: APPROVAL_LABEL[decision.level],
      why: APPROVAL_WHY[decision.level],
    }
  })
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
        note: "Not known until a bill is read. Untagged spend is reported unallocated when it is — never spread across tenants.",
      },
      {
        label: "Tenants with attributed spend",
        value: null,
        note: "Not known until a bill is read. Attribution comes from the tenure:tenant resource tag.",
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
        <p className="md3-body-medium">
          What the fleet costs, and which tenant it costs it for.
        </p>
      </header>

      {/* ── The answer, first ──────────────────────────────────────────── */}
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

      {/* ── Approval thresholds ──────────────────────────────────────────
          Shown whatever the read returned, because they govern what a plan may
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
