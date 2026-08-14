import type { ReactNode } from "react"

import {
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState,
  KeyValue,
  SeverityChip,
  StaleIndicator,
  UnknownState,
} from "@/components/md3"
import {
  ECS_STOPPED_WINDOW,
  containerReadings,
  describeCountGap,
  describeStopCause,
  describeTaskDefinition,
  describeTruncation,
  type StopCause,
} from "@/lib/aws/containers"
import {
  SEVERITIES,
  describeScanOnPush,
  describeVulnerability,
  ecrReadings,
  type Severity,
} from "@/lib/aws/ecr"
import { identityHeadline } from "@/lib/aws/identity"
import {
  RUNTIME_CALENDAR_AS_OF,
  RUNTIME_CALENDAR_SOURCE,
  lambdaInventory,
} from "@/lib/aws/lambda"
import { auth } from "@/lib/auth"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

import {
  RUNTIME_TONE,
  RUNTIME_WORD,
  STOP_TONE,
  STOP_WORD,
  computeAnswer,
  deployedImageRows,
  imageSummary,
  provenanceOf,
  readFailures,
  registryIndex,
  runningServiceRows,
  runtimeHeadline,
  runtimeRows,
  runtimeTally,
  statedAsOf,
  stoppedSummary,
  stoppedTaskRows,
  unknownArm,
  type DeployedImageRow,
  type RunningServiceRow,
  type RuntimeRow,
  type StoppedTaskRow,
} from "./compute-answer"
import styles from "./compute.module.css"

export const dynamic = "force-dynamic"

/**
 * STUDIO-070-004 (compute) — "what is running, what is it running, and why did
 * anything stop?"
 *
 * That question is at the top of the page in those words, because it is the one
 * an operator opens this route with and every card below is an instalment of the
 * answer. Three live reads produce it, and none of them can answer it alone:
 *
 *   * `containerReadings()` — every ECS cluster, the services under it, the task
 *     definition revision each one actually runs, and every task ECS has
 *     retained with the reason it stopped. The third clause of the question has
 *     no other source: `stoppedReason` lives on a stopped task and nowhere else,
 *     and until this route existed nothing in the console had ever rendered it.
 *     A crash-looping service and a slow one were indistinguishable.
 *   * `ecrReadings()` — the repository each running DIGEST came from and what
 *     ECR found in it. Joined by digest rather than by tag, because both
 *     repositories in this estate are `MUTABLE` and a tag re-pushed onto
 *     different bytes names one thing while the running task is another.
 *   * `lambdaInventory()` — the other half of "what is running". A function on a
 *     runtime AWS has already deprecated cannot be redeployed, which is an
 *     outage that arrives on a date somebody could have read months earlier.
 *
 * ── What each card refuses to say ─────────────────────────────────────────
 *
 * Every panel states what it is AS OF, and says plainly when it does not know
 * something. A refused or throttled read renders through the shared
 * `UnknownState` — the principal, the action, the error code and a pasteable
 * minimum IAM statement — never as an empty table and never as a zero. The three
 * specific absences this surface is careful about are documented on
 * `./compute-answer.ts`: a refused `ecs:DescribeTasks` is not "nothing stopped",
 * a digest missing from a registry whose image lists were refused is not a
 * digest from outside the registry, and zero findings in a repository that does
 * not scan on push is not a clean image.
 *
 * ── Why the decisions are next door ────────────────────────────────────────
 *
 * The ordering that produces the headline is in `./compute-answer.ts` — pure, no
 * client, no React — so `./compute-answer.test.ts` and
 * `e2e/compute-page-logic.spec.ts` drive every branch at the node level. The
 * ordering is the part that matters: it is where a fleet at its desired count
 * with forty OOM kills behind it stops being renderable as "Steady".
 */
export default async function ComputePage() {
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
   * Three loads, sequential rather than raced. `resolveIdentity` caches only an
   * ACTUAL answer for the process, so the first of these resolves the principal
   * and the other two reuse it; issued in parallel, an estate where STS is
   * unreachable — the exact estate this console must keep booting in — would pay
   * for three failing identity calls instead of one.
   */
  const containers = await containerReadings()
  const ecr = await ecrReadings()
  const lambda = await lambdaInventory()

  const stopped = stoppedTaskRows(containers.clusters)
  const stops = stoppedSummary(stopped)
  const answer = computeAnswer(containers.fleet, stops)

  const services = runningServiceRows(containers.clusters)
  const registry = registryIndex(ecr)
  const images = deployedImageRows(services, registry)
  const imageCounts = imageSummary(images)

  const runtimes = runtimeRows(lambda.functions)
  const tally = runtimeTally(lambda.functions)

  const failures = readFailures(containers.clusters)
  const clustersUnknown = unknownArm(containers.clusters)
  const repositoriesUnknown = unknownArm(ecr.repositories)
  const functionsUnknown = unknownArm(lambda.functions)

  const incidents = stopped.filter((row) => row.incident)
  const benign = stopped.filter((row) => !row.incident)

  const provenance = provenanceOf({
    identityLine: identityHeadline(containers.identity),
    clusters: containers.clusters,
    repositories: ecr.repositories,
    functions: lambda.functions,
    containersAsOf: containers.asOf,
    ecrAsOf: ecr.asOf,
    lambdaAsOf: lambda.asOf,
    refreshMs: containers.refreshMs,
    calendarSource: RUNTIME_CALENDAR_SOURCE,
    calendarAsOf: RUNTIME_CALENDAR_AS_OF,
  })

  return (
    <div className={styles.page} data-surface="compute">
      <header className={styles.lead}>
        <h1 className="md3-headline-large">Compute</h1>
        {/* The question, in the words an operator would use, above every piece
            of apparatus that answers it. */}
        <p className="md3-title-medium" data-testid="page-question">
          What is running, what is it running, and why did anything stop?
        </p>
        <p className="md3-body-medium">
          Every ECS service against the count it was asked for, every task ECS has retained with
          the reason it stopped, the revision and image digest each service actually runs, and the
          Lambda functions on a runtime with a date on it.
        </p>
        {/* Which estate this is. Prose rather than a chip because on a refusal it
            is a whole IAM statement, and a pill four lines tall has stopped
            being a pill. */}
        <p className={`md3-body-small ${styles.identifier}`}>
          {identityHeadline(containers.identity)}
        </p>
      </header>

      {/* ── The answer ─────────────────────────────────────────────────── */}
      <Card
        id="running-against-desired"
        headline="Running against desired"
        headerAside={
          <span className={styles.row}>
            <Badge tone={answer.tone} title={answer.headline}>
              {answer.verdict}
            </Badge>
            <StaleIndicator
              asOf={containers.asOf}
              cadenceMs={containers.refreshMs.services}
              label="the container reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          "The gap between what each ECS service was asked to run and what is running, from one live ecs:ListClusters call and the DescribeServices, DescribeTasks and DescribeTaskDefinition calls under it",
          containers.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-large" data-testid="compute-headline">
            {answer.headline}
          </p>
          {answer.because ? <p className="md3-body-medium">{answer.because}</p> : null}

          {/* The tally, as chips rather than a second table. Only counts that
              are actually present — a row of zeroes is a row an operator has to
              read before discovering it says nothing. */}
          <div className={styles.row}>
            {stops.incidents > 0 ? (
              <Chip title="Tasks that stopped for a reason somebody has to act on, inside ECS's retention window">
                {stops.incidents} stopped for a reason
              </Chip>
            ) : null}
            {stops.benign > 0 ? (
              <Chip title="Tasks replaced by a deployment or stopped deliberately">
                {stops.benign} replaced or stopped by hand
              </Chip>
            ) : null}
            {services.length > 0 ? (
              <Chip title="ECS services this page could read">{services.length} service(s)</Chip>
            ) : null}
          </div>

          {clustersUnknown ? (
            <UnknownState read={clustersUnknown} what="the ECS clusters in this account" />
          ) : (
            <ServiceGapTable rows={services} />
          )}

          {containers.truncation.kind === "truncated" ? (
            <p className="md3-body-small">
              This cluster listing is incomplete{describeTruncation(containers.truncation)}. Nothing
              below is a statement about the clusters this read did not reach.
            </p>
          ) : null}
        </div>
      </Card>

      {/* ── Why anything stopped. The reason this route exists. ─────────── */}
      <Card
        id="why-it-stopped"
        headline="Why anything stopped"
        headerAside={
          <Badge
            tone={stops.incidents > 0 ? "bad" : stops.total > 0 ? "neutral" : "ok"}
            title="Tasks that stopped for a reason somebody has to act on"
          >
            {stops.incidents} of {stops.total}
          </Badge>
        }
        supportingText={statedAsOf(
          "Every task ECS has retained, with the stoppedReason ECS itself gave and the exit code of every container in it",
          containers.asOf,
        )}
      >
        <div className={styles.stack}>
          <StoppedTaskTable
            caption="Tasks that stopped for a reason somebody has to act on"
            rows={incidents}
            empty={
              clustersUnknown ? (
                <EmptyState
                  headline="This list is not empty — it is unknown"
                  description="The cluster listing did not answer, so this page cannot say whether anything stopped. The panel below names the principal, the action and the statement that would fix it."
                />
              ) : (
                <EmptyState
                  headline="Nothing stopped for a reason anybody has to act on"
                  description={`Every task that stopped in the window was replaced by a deployment or stopped deliberately. ${ECS_STOPPED_WINDOW.why}`}
                />
              )
            }
          />

          {/*
            The honest limit of this table, stated where somebody would otherwise
            assume the opposite. It is the reader's own sentence, carried on
            every cluster rather than written here, so the window this page
            claims and the window the reader can see are one fact.
          */}
          <p className="md3-body-small">{ECS_STOPPED_WINDOW.why}</p>

          {clustersUnknown ? (
            <UnknownState read={clustersUnknown} what="the ECS clusters in this account" />
          ) : null}

          {/*
            Per-cluster reads that did not answer. Without these, a refused
            `ecs:DescribeTasks` on one cluster contributes no rows and the table
            above reads as an estate where nothing has stopped.
          */}
          {failures.map((failure) => (
            <UnknownState
              key={failure.key}
              read={failure.read}
              what={`${failure.what} (${failure.scope})`}
            />
          ))}

          {benign.length > 0 ? (
            <details className={styles.disclosure}>
              <summary className="md3-label-large">
                Show the {benign.length} task{benign.length === 1 ? "" : "s"} replaced by a
                deployment or stopped deliberately
              </summary>
              <StoppedTaskTable
                caption="Tasks the system stopped on purpose"
                rows={benign}
                empty={
                  <EmptyState
                    headline="No task was stopped on purpose"
                    description="Nothing in the window was replaced by a deployment or stopped by hand."
                  />
                }
              />
            </details>
          ) : null}

          <details className={styles.disclosure}>
            <summary className="md3-label-large">What each stop word on this page means</summary>
            <StopLegend />
          </details>
        </div>
      </Card>

      {/* ── The revision each service actually runs ─────────────────────── */}
      <Card
        id="what-each-runs"
        headline="What each service is running"
        headerAside={
          <Badge
            tone={services.some((row) => row.credentialNames.length > 0) ? "bad" : "neutral"}
            title="Services whose task definition declares a plain-text environment variable whose NAME looks like a credential"
          >
            {services.filter((row) => row.credentialNames.length > 0).length} with credential-shaped
            environment
          </Badge>
        }
        supportingText={statedAsOf(
          "The task definition revision each service points at, the digest its tasks are actually running, the cpu and memory the revision declares, and any plain-text environment variable whose NAME looks like a credential",
          containers.asOf,
        )}
      >
        <div className={styles.stack}>
          {/*
            Names only, and this sentence is why. `containers.ts` does not read
            `environment[].value` at all — there is no field on this path that
            could carry one — so a name here is a name and nothing else.
          */}
          <p className="md3-body-medium">
            A credential-shaped name below is a variable declared in plain text in the task
            definition rather than through <code>secrets</code>. Only the NAME is read: no value is
            fetched, held or rendered anywhere on this path.
          </p>

          {clustersUnknown ? (
            <UnknownState read={clustersUnknown} what="the ECS clusters in this account" />
          ) : (
            <RevisionTable rows={services} />
          )}
        </div>
      </Card>

      {/* ── Where the running images came from ──────────────────────────── */}
      <Card
        id="where-images-came-from"
        headline="Where the running images came from"
        headerAside={
          <span className={styles.row}>
            <Badge
              tone={
                imageCounts.vulnerable > 0
                  ? "bad"
                  : imageCounts.unknown > 0 || imageCounts.unscanned > 0
                    ? "warn"
                    : "ok"
              }
              title="Digests running right now with at least one CRITICAL or HIGH finding"
            >
              {imageCounts.vulnerable} of {imageCounts.digests}
            </Badge>
            <StaleIndicator
              asOf={ecr.asOf}
              cadenceMs={ecr.refreshMs.scan}
              label="the registry reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          "Every digest running in this account, correlated to the repository it came from, with the findings ECR reports for it by severity",
          ecr.asOf,
        )}
      >
        <div className={styles.stack}>
          {/* The registry-wide caveat, from the reader's own value. Basic
              scanning finds OS package CVEs only, and whether this registry runs
              enhanced scanning is a read this engine does not hold. */}
          <p className="md3-body-small">{ecr.enhancedScanning.why}</p>

          {registry.unscanned.length > 0 ? (
            <p className="md3-body-medium" data-testid="scanning-off">
              Scanning is off here: {registry.unscanned.join(", ")}. An absence of findings from
              those repositories is an absence of scanning, not an absence of vulnerabilities.
            </p>
          ) : null}

          {repositoriesUnknown ? (
            <UnknownState read={repositoriesUnknown} what="the container registry" />
          ) : (
            <ImageTable rows={images} />
          )}
        </div>
      </Card>

      {/* ── The other half of "what is running" ─────────────────────────── */}
      <Card
        id="lambda-runtimes"
        headline="Lambda runtimes with a date on them"
        headerAside={
          <span className={styles.row}>
            <Badge
              tone={
                tally.known
                  ? tally.deprecated > 0
                    ? "bad"
                    : tally.approaching > 0 || tally.unknown > 0
                      ? "warn"
                      : "ok"
                  : "warn"
              }
              title="Functions on a runtime AWS has already deprecated"
            >
              {tally.known ? `${tally.deprecated} deprecated` : "Not known"}
            </Badge>
            <StaleIndicator
              asOf={lambda.asOf}
              cadenceMs={lambda.refreshMs}
              label="the Lambda reading"
            />
          </span>
        }
        supportingText={statedAsOf(
          `Every function whose runtime AWS has deprecated, is about to deprecate, or that this engine's calendar cannot place — against a calendar transcribed from ${RUNTIME_CALENDAR_SOURCE} as of ${RUNTIME_CALENDAR_AS_OF}`,
          lambda.asOf,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium" data-testid="runtime-headline">
            {runtimeHeadline(tally)}
          </p>

          {/* The calendar is a transcription, and it says so out loud once it is
              too old for a SUPPORTED verdict to be defensible from it. The
              reader carries the age; this page does not compute one of its own. */}
          <p className="md3-body-small">
            {lambda.calendar.stale
              ? `This engine's runtime calendar was transcribed from ${lambda.calendar.source} on ${lambda.calendar.asOf} and is ${lambda.calendar.ageDays} days old. A "supported" verdict is no longer defensible from a stamp that old, so every function on a runtime the calendar calls current is listed below as unplaceable rather than as safe.`
              : `This engine's runtime calendar was transcribed from ${lambda.calendar.source} on ${lambda.calendar.asOf}, ${lambda.calendar.ageDays} days ago. Every verdict below is derived from it and is checkable against that source.`}
          </p>

          {functionsUnknown ? (
            <UnknownState read={functionsUnknown} what="the Lambda functions in this account" />
          ) : (
            <RuntimeTable rows={runtimes} />
          )}
        </div>
      </Card>

      {/* ── Where all of it came from ───────────────────────────────────── */}
      <Card
        id="provenance"
        headline="Where this came from"
        supportingText={statedAsOf(
          "The three loads this page made, the principal it made them as, and the estate that answered",
          containers.asOf,
        )}
      >
        <KeyValue
          ariaLabel="What produced this page"
          items={provenance.map((fact) => ({
            key: fact.label,
            term: fact.label,
            value: <code className={styles.identifier}>{fact.value}</code>,
          }))}
        />
      </Card>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────── the tables ── */

/**
 * Running against desired, per service.
 *
 * `describeCountGap` is the reader's own renderer, so the sentence here and the
 * sentence the read-only API prints are one string. A gap worded two ways is two
 * facts an operator has to reconcile.
 */
function ServiceGapTable({ rows }: { rows: readonly RunningServiceRow[] }) {
  return (
    <DataTable
      caption="Every ECS service, and whether it is running what it was asked to run"
      rowKey={(row) => row.key}
      rows={rows}
      columns={[
        {
          key: "service",
          header: "Service",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>{row.service}</span>
              <span className="md3-label-small">{row.cluster}</span>
            </span>
          ),
        },
        {
          key: "count",
          header: "Running / desired",
          align: "end",
          cell: (row) => (
            <span className={styles.identifier}>
              {row.running}/{row.desired}
            </span>
          ),
        },
        {
          key: "gap",
          header: "What that means",
          cell: (row) => <span className={styles.cell}>{describeCountGap(row.gap)}</span>,
        },
      ]}
      empty={
        <EmptyState
          headline="No ECS service was readable"
          description="Either this account runs no ECS service, or every cluster's DescribeServices call is reported separately below. An empty table here is not a claim that nothing is deployed."
        />
      }
    />
  )
}

/**
 * The stopped tasks.
 *
 * The `stoppedReason` column carries ECS's verbatim string, not only the
 * classification. The classification is this console's reading of it and the raw
 * string is AWS's own words; an operator debugging a stop needs both, and the
 * verbatim one is the one they will paste into a search.
 */
function StoppedTaskTable({
  caption,
  rows,
  empty,
}: {
  caption: string
  rows: readonly StoppedTaskRow[]
  empty: ReactNode
}) {
  return (
    <DataTable
      caption={caption}
      rowKey={(row) => row.key}
      rows={rows}
      empty={empty}
      columns={[
        {
          key: "task",
          header: "Task",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>{row.taskName}</span>
              <span className="md3-label-small">
                {row.service ? `${row.cluster}/${row.service}` : `${row.cluster} — no service`}
              </span>
            </span>
          ),
        },
        {
          key: "cause",
          header: "Cause",
          cell: (row) => (
            <Badge tone={STOP_TONE[row.cause.kind]} title={describeStopCause(row.cause)}>
              {STOP_WORD[row.cause.kind]}
            </Badge>
          ),
        },
        {
          key: "reason",
          header: "What ECS said",
          cell: (row) => (
            <span className={styles.cell}>
              {row.stoppedReason === null ? (
                <span>
                  ECS returned no stoppedReason for this task. Why it stopped is not readable from
                  the ECS API, which is not the same as its having stopped for no reason.
                </span>
              ) : (
                <span className={styles.identifier}>{row.stoppedReason}</span>
              )}
              <span className="md3-label-small">
                stopCode: {row.stopCode ?? "not reported"}
              </span>
            </span>
          ),
        },
        {
          key: "exit",
          header: "Exit codes",
          cell: (row) => <span className={styles.identifier}>{row.exitCodes}</span>,
        },
        {
          key: "when",
          header: "Stopped",
          cell: (row) => (
            <span className={styles.identifier}>{row.stoppedAt ?? "not reported"}</span>
          ),
        },
      ]}
    />
  )
}

/** The revision each service points at, and what that revision declares. */
function RevisionTable({ rows }: { rows: readonly RunningServiceRow[] }) {
  return (
    <DataTable
      caption="The task definition revision each service runs, the digest its tasks carry, and what the revision declares"
      rowKey={(row) => row.key}
      rows={rows}
      columns={[
        {
          key: "service",
          header: "Service",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>{row.service}</span>
              <span className="md3-label-small">{row.cluster}</span>
            </span>
          ),
        },
        {
          key: "revision",
          header: "Revision",
          cell: (row) => (
            <span className={styles.cell}>
              {row.revision === null ? (
                <span>{describeTaskDefinition(row.revisionRead)}</span>
              ) : (
                <span className={styles.identifier}>{row.revision}</span>
              )}
            </span>
          ),
        },
        {
          key: "size",
          header: "cpu / memory",
          align: "end",
          cell: (row) => (
            <span className={styles.identifier}>
              {row.cpu ?? "unstated"} / {row.memory ?? "unstated"}
            </span>
          ),
        },
        {
          key: "digest",
          header: "Digest actually running",
          cell: (row) => (
            <span className={styles.cell}>
              {row.containers.length === 0 ? (
                <span>
                  No running task of this service was readable, so which build is running is not
                  known. That is not a statement that nothing is running.
                </span>
              ) : (
                row.containers.map((container) => (
                  <span key={`${container.containerName}:${container.digest ?? "none"}`}>
                    <span className="md3-label-small">{container.containerName}: </span>
                    <span className={styles.identifier}>
                      {container.digest ??
                        "ECS reported no imageDigest for this container — the tag it names is not an identity"}
                    </span>
                  </span>
                ))
              )}
            </span>
          ),
        },
        {
          key: "credentials",
          header: "Plain-text credential-shaped names",
          cell: (row) => (
            <span className={styles.cell}>
              {row.credentialNames.length === 0 ? (
                <span className="md3-label-small">
                  {row.revision === null
                    ? "not known — the revision was not readable"
                    : "none in this revision"}
                </span>
              ) : (
                row.credentialNames.map((name) => (
                  <span key={name} className={styles.identifier}>
                    {name}
                  </span>
                ))
              )}
            </span>
          ),
        },
      ]}
      empty={
        <EmptyState
          headline="No service's revision was readable"
          description="Either this account runs no ECS service, or every DescribeServices call was refused. An empty table here is not a claim that nothing is deployed."
        />
      }
    />
  )
}

/** The digests actually running, and what the registry says about each one. */
function ImageTable({ rows }: { rows: readonly DeployedImageRow[] }) {
  return (
    <DataTable
      caption="Every image digest running in this account, the repository it came from, and its scan findings by severity"
      rowKey={(row) => row.key}
      rows={rows}
      columns={[
        {
          key: "digest",
          header: "Digest",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>{row.digest}</span>
              <span className="md3-label-small">
                {row.tags.length > 0 ? `tags: ${row.tags.join(", ")}` : "no tag on this digest"}
              </span>
            </span>
          ),
        },
        {
          key: "repository",
          header: "Repository",
          cell: (row) => (
            <span className={styles.cell}>
              {row.correlation.kind === "matched" ? (
                <>
                  <span className={styles.identifier}>{row.correlation.repositoryName}</span>
                  {row.repositoryUri ? (
                    <span className={`md3-label-small ${styles.identifier}`}>
                      {row.repositoryUri}
                    </span>
                  ) : null}
                </>
              ) : (
                <span>{row.correlation.why}</span>
              )}
            </span>
          ),
        },
        {
          key: "findings",
          header: "Findings",
          cell: (row) => <FindingCell row={row} />,
        },
        {
          key: "scanning",
          header: "Scanning",
          cell: (row) => (
            <span className={styles.cell}>
              {row.scanOnPush === null ? (
                <span>
                  not known — this digest was not traced to a repository, so whether anything scans
                  it cannot be stated
                </span>
              ) : (
                <span>{describeScanOnPush(row.scanOnPush)}</span>
              )}
            </span>
          ),
        },
        {
          key: "where",
          header: "Running in",
          cell: (row) => (
            <span className={styles.cell}>
              {row.usedBy.map((where) => (
                <span key={where} className={styles.identifier}>
                  {where}
                </span>
              ))}
            </span>
          ),
        },
      ]}
      empty={
        <EmptyState
          headline="No running digest was readable"
          description="No task this page could read reported an imageDigest. Without a digest there is nothing to correlate — a tag is not an identity in a repository whose images are mutable."
        />
      }
    />
  )
}

/**
 * The findings cell.
 *
 * `counts === null` is every arm of `ImageVulnerability` that is not a completed
 * scan, and it prints the reader's own sentence rather than a zero. A zero here
 * for a repository that does not scan on push would be the most reassuring wrong
 * number on this page.
 */
function FindingCell({ row }: { row: DeployedImageRow }) {
  if (row.counts === null) {
    return (
      <span className={styles.cell}>
        <span>
          {row.vulnerability
            ? describeVulnerability(row.vulnerability)
            : "not known — this digest was not traced to a repository this engine could read"}
        </span>
      </span>
    )
  }
  const present = SEVERITIES.filter((severity) => (row.counts as Record<Severity, number>)[severity] > 0)
  return (
    <span className={styles.cell}>
      {present.length === 0 ? (
        <span>{row.vulnerability ? describeVulnerability(row.vulnerability) : "no findings"}</span>
      ) : (
        <span className={styles.row}>
          {present.map((severity) =>
            /*
             * `SeverityChip` carries five severities and ECR reports six.
             * `UNDEFINED` is a finding AWS could not rank, which is not the same
             * as one it ranked as low, so it renders as a badge with its own word
             * rather than being folded into a severity it does not have.
             */
            severity === "UNDEFINED" ? (
              <Badge key={severity} tone="warn" title="ECR reported findings it could not rank">
                {(row.counts as Record<Severity, number>)[severity]} unranked
              </Badge>
            ) : (
              <SeverityChip
                key={severity}
                severity={
                  severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "informational"
                }
                title={`${severity} findings ECR reports for this digest`}
              >
                {(row.counts as Record<Severity, number>)[severity]}
              </SeverityChip>
            ),
          )}
        </span>
      )}
      <span className="md3-label-small">
        {row.total === null ? "" : `${row.total} finding(s) in total`}
      </span>
    </span>
  )
}

/** Functions on a runtime with a date on it, or one nothing here can place. */
function RuntimeTable({ rows }: { rows: readonly RuntimeRow[] }) {
  return (
    <DataTable
      caption="Lambda functions whose runtime AWS has deprecated, is about to deprecate, or that this engine's calendar cannot place"
      rowKey={(row) => row.key}
      rows={rows}
      columns={[
        {
          key: "function",
          header: "Function",
          cell: (row) => (
            <span className={styles.cell}>
              <span className={styles.identifier}>{row.name}</span>
              <span className="md3-label-small">
                {row.memoryMb === null ? "memory unstated" : `${row.memoryMb} MB`} ·{" "}
                {row.lastModified ?? "last modified unstated"}
              </span>
            </span>
          ),
        },
        {
          key: "verdict",
          header: "Verdict",
          cell: (row) => (
            <Badge tone={RUNTIME_TONE[row.status]} title={row.status}>
              {RUNTIME_WORD[row.status]}
            </Badge>
          ),
        },
        {
          key: "runtime",
          header: "Runtime",
          cell: (row) => (
            <span className={styles.identifier}>{row.runtime ?? row.packageType}</span>
          ),
        },
        {
          key: "means",
          header: "What that means",
          cell: (row) => <span className={styles.cell}>{row.sentence}</span>,
        },
      ]}
      empty={
        <EmptyState
          headline="No function is on a runtime with a date on it"
          description="Every function the read returned is on a runtime AWS still supports, and this engine's calendar is recent enough for that to mean something. The line above says how many that is."
        />
      }
    />
  )
}

/**
 * The stop vocabulary, on the page rather than in a document.
 *
 * Bible §26.3.2 makes the WORD the carrier of the meaning, and a vocabulary an
 * operator cannot look up is a vocabulary of guesses. Built from the real
 * `StopCause` kinds so a cause added to `containers.ts` and forgotten here is a
 * compile error rather than a missing row.
 */
const STOP_LEGEND: ReadonlyArray<{ kind: StopCause["kind"]; means: string }> = [
  {
    kind: "out-of-memory",
    means:
      "the kernel killed the container for memory. A revision with more memory is the remedy; a health check is not.",
  },
  {
    kind: "health-check-failed",
    means:
      "the container started and its health check refused it. More memory is not the remedy — the application answered wrongly or not at all.",
  },
  {
    kind: "essential-container-exited",
    means: "an essential container ended. The exit code beside it is the application's own.",
  },
  {
    kind: "cannot-start",
    means: "the image could not be pulled, or the container could not be created. It never ran.",
  },
  {
    kind: "initialisation-failed",
    means: "volumes, secrets or the log driver failed before the container ran.",
  },
  {
    kind: "host-terminated",
    means: "the instance under the task was reclaimed or terminated. Spot interruption looks like this.",
  },
  {
    kind: "other",
    means: "ECS said something and this engine will not guess what it means. The verbatim string is in the table.",
  },
  {
    kind: "unreported",
    means:
      "ECS gave neither a stoppedReason nor a stopCode. Counted as something to act on, because an unexplained stop is exactly the thing that must not be filed under probably fine.",
  },
  {
    kind: "scaling",
    means: "a deployment or a scale-in replaced this task. The system working.",
  },
  {
    kind: "user-initiated",
    means: "somebody, or something with an API key, stopped it. The system working.",
  },
]

function StopLegend() {
  return (
    <DataTable
      caption="The stop words this page prints, and what each one is telling you"
      rowKey={(row) => row.kind}
      rows={STOP_LEGEND}
      columns={[
        {
          key: "word",
          header: "Word",
          cell: (row) => (
            <Badge tone={STOP_TONE[row.kind]} title={row.kind}>
              {STOP_WORD[row.kind]}
            </Badge>
          ),
        },
        {
          key: "means",
          header: "What it means",
          cell: (row) => <span className={styles.cell}>{row.means}</span>,
        },
      ]}
      empty={
        <EmptyState
          headline="No stop vocabulary"
          description="The stop vocabulary is empty, which cannot happen while containers.ts declares one."
        />
      }
    />
  )
}
