import { auth } from "@/lib/auth"
import { LiveRegion } from "@/components/LiveRegion"
import { TagCompliancePanel } from "@/components/TagCompliancePanel"
import {
  Badge,
  ButtonLink,
  Card,
  Chip,
  DataTable,
  EmptyState,
  KeyValue,
  StaleIndicator,
  UnknownState,
  type DataColumn,
  type KeyValueItem,
} from "@/components/md3"
import { CAPABILITIES } from "@/lib/aws/capabilities"
import { consoleCaveat, consoleLink, linkablePartitions } from "@/lib/aws/console-link"
import { irreversibleEntries, resourceChangeDiff } from "@/lib/aws/drift"
import { identityHeadline } from "@/lib/aws/identity"
import { estateInventory, estateLines, type EstateResource } from "@/lib/aws/inventory"
import { centralizationPosture, type PostureRow } from "@/lib/aws/posture"
import { reconcileTopology, type TopologyVerdict } from "@/lib/aws/topology"
import { describeRead } from "@/lib/aws/read"
import { seedValue } from "@/lib/aws/refresh"
import { describeAttribution } from "@/lib/aws/tags"
import { renderComparison } from "@/lib/revisions"
import { isOperator, mayAct, operatorConfigProblems, roleOf } from "@/lib/operators"

import { declaredEstate } from "./declared-estate"
import {
  asOfSentence,
  clauseTone,
  estateAnswer,
  managementTone,
  readAsOf,
  reconcileAnswer,
  resourcesRead,
  surfaceRows,
  topologyAccount,
  topologySummary,
  topologyTone,
  unknownSurfaces,
} from "./estate-answer"
import {
  coverageAnswer,
  coverageRows,
  coverageTally,
  coverageTone,
  declarationAnswer,
  declarationRows,
  declarationTone,
  declaredWord,
  groupByService,
  readerWord,
  unmappedSentence,
  verdictWord,
  type CoverageRow,
  type DeclarationRow,
} from "./estate-coverage"
import styles from "./estate.module.css"

export const dynamic = "force-dynamic"

/**
 * STUDIO-080-001 / STUDIO-000-006 / STUDIO-000-007 / STUDIO-010-002 — the live
 * estate, read from AWS at the moment this page is rendered.
 *
 * ── The question, and why the page is shaped the way it is ─────────────────
 *
 * **What is actually running in this AWS account, and does it match what we
 * declared?** Both clauses, in that order, and the page says them in words
 * before it shows a single control.
 *
 * The first clause is an inventory, and an inventory is only worth reading if
 * you can tell how much of the account it covers. So the second thing on the
 * page after the answer is COVERAGE: every AWS service this build names or this
 * platform declares, and whether anything here can see it. A service with no
 * reader appears as a row saying so, next to the services that answered —
 * because the alternative is that it appears nowhere, and an estate holding
 * buckets, queues and a cache renders as "8 resources, every surface answered".
 * Invisible here is not the same fact as absent there, and only one of them is
 * about the account.
 *
 * The second clause is drift, and it runs in BOTH directions. Terraform
 * declaring something the estate does not have is a deployment that did not
 * finish. The estate holding something Terraform never declared is worse:
 * nothing will ever update it, nothing will ever remove it, and no review has
 * ever seen it. `declarationRows` puts that direction at the top of its table
 * for that reason, and `resourceChangeDiff` names the individual resources.
 *
 * ── This page must render with no AWS credentials ──────────────────────────
 *
 * It is the page an operator opens to find out WHY the estate cannot be read,
 * so a 500 from an unreachable STS is not an acceptable refusal. Every read
 * arrives as an `AwsRead` union whose failing arms carry no `value` at all, so
 * reaching for data that is not there does not compile; those arms render the
 * shared `UnknownState`, which names the principal, the action, the error code
 * and the minimum IAM statement that would fix it. Nothing on this page renders
 * a denial as an empty list, a zero, or a reassuring default.
 */
export default async function EstatePage() {
  if (operatorConfigProblems().length > 0) {
    return (
      <div className="misconfigured">
        <h1>Not configured</h1>
        <p>The Studio refuses to serve until its access control is set up.</p>
      </div>
    )
  }

  const session = await auth()
  const email = session?.user?.email
  if (!isOperator(email)) {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }

  const role = roleOf(email)
  const mayOpenConsole = mayAct(role, "aws.console:read")

  const readings = await estateInventory()
  const lines = estateLines(readings)
  const rows = surfaceRows(lines)
  const unknown = unknownSurfaces(rows)
  const read = resourcesRead(rows)

  /*
   * When this page issued its calls.
   *
   * Distinct from any individual reading's `asOf`, and both are shown. A
   * surface that was refused has no `asOf`, and without this the page would
   * have no time on it at all in exactly the case where a reader most needs to
   * know whether they are looking at something current.
   */
  const requestedAt = new Date().toISOString()
  const now = Date.now()

  /* -------------------------------------------------- coverage and drift -- */

  // What this platform DECLARES, parsed from the Terraform that declares it
  // rather than from a list typed here. `known: false` — the normal case in the
  // deployed image, which ships the app and not the infrastructure — renders as
  // "cannot be compared here" and never as "nothing is declared", which would
  // report the whole estate as undeclared drift.
  const declared = declaredEstate()
  const coverage = coverageRows({ lines, declared })
  const tally = coverageTally(coverage)
  const drift = declarationRows({ lines, declared })
  const unmapped = unmappedSentence(declared)
  const services = groupByService(lines)

  // STUDIO-060-003 — the AWS-resource arm of the change diff, over exactly the
  // resources that were actually read. A surface that came back DENIED
  // contributes nothing here, which is why `estateLines` narrows to ACTUAL
  // first: a denied read must never become a proposal to delete anything.
  const reconcile = resourceChangeDiff({
    live: lines.flatMap((line) => line.resources),
    now: new Date(),
    reference: "estate reconciliation",
  })
  const refused = irreversibleEntries(reconcile.diff)

  /*
   * STUDIO-140-007 — the one surface on this page that does not go frozen.
   *
   * Everything above is a snapshot: `estateInventory()` ran once, during this
   * render, and nothing re-runs it until a human presses reload. Edge
   * distributions are the surface picked to close that loop first, because they
   * are the one inventory line on this page that `/api/aws/<surface>` also
   * serves — `cloudfront:ListDistributions` is `readings.distributions` here and
   * `SURFACES.cdn` there, ONE capability with ONE cadence, so the number the
   * browser polls for and the number this render printed cannot come from two
   * different opinions about how often a distribution changes.
   *
   * The seed is this render's own read, so the first paint is exactly what it
   * was before this loop existed. The client replaces it only on a SUCCESSFUL
   * poll; a refused one leaves it standing, marked stale, with the instant it
   * was true.
   */
  const cdnSeed = seedValue(readings.distributions)
  const cdnBecause =
    cdnSeed === null
      ? describeRead(readings.distributions, "the edge distribution inventory")
      : null

  const posture = await centralizationPosture()
  const { identity, organization, management } = posture

  const identityOk = identity.state === "ACTUAL" || identity.state === "STALE"
  const accountId = identityOk ? identity.value.accountId : null
  const partition = identityOk ? identity.value.partition : null
  const region = identityOk ? identity.value.region : null

  const topology = reconcileTopology({
    scale: "single-account-pilot",
    accounts: [],
    selfAccountId: accountId,
    organizationInUse: organization.state === "IN_USE",
    unknownBecause:
      organization.state === "UNKNOWN"
        ? `${organization.action} was refused (${organization.errorCode})`
        : undefined,
  })
  const topologyRollup = topologySummary(topology)

  const link =
    mayOpenConsole && partition && region
      ? consoleLink({ partition, region, service: "resource-groups" })
      : null

  const identityFacts: readonly KeyValueItem[] = identityOk
    ? [
        { key: "account", term: "Account", value: <code>{identity.value.accountId}</code> },
        { key: "region", term: "Region", value: <code>{identity.value.region}</code> },
        { key: "partition", term: "Partition", value: <code>{identity.value.partition}</code> },
        {
          key: "arn",
          term: "Read as",
          value: <code>{identity.value.arn}</code>,
          // The cadence comes from the capability registry, so the freshness
          // this panel claims and the interval the reader actually honours are
          // one number rather than two that drift apart.
          asOf: { at: identity.asOf, cadenceMs: CAPABILITIES[identity.capability].refreshMs, now },
        },
      ]
    : []

  /* ------------------------------------------------------------ columns -- */

  /**
   * COVERAGE. The table this page exists to be able to draw.
   *
   * Ordered gaps-first by `coverageRows`, so the services nobody can see are
   * the first thing under the heading rather than the last row of a long list.
   */
  const coverageColumns: readonly DataColumn<CoverageRow>[] = [
    {
      key: "service",
      header: "AWS service",
      cell: (row) => <span className={styles.identifier}>{row.service}</span>,
    },
    {
      key: "reader",
      header: "Can this engine see it?",
      cell: (row) => (
        <div className={styles.cell}>
          <Badge
            tone={coverageTone(row.reader)}
            title={`Whether this build reads ${row.service} at all`}
          >
            {readerWord(row.reader)}
          </Badge>
          {row.because ? (
            <span className="md3-body-small" data-testid={`coverage-${row.service}`}>
              {row.because}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "count",
      header: "Read",
      align: "end",
      // Never a zero for a service nobody read. That substitution is the whole
      // defect STUDIO-000-007 exists to end, and a right-aligned numeric column
      // is where it hides best.
      cell: (row) => (row.count === null ? "not known" : row.count),
    },
    {
      key: "declared",
      header: "Declared",
      align: "end",
      cell: (row) => declaredWord(row.declared),
    },
    {
      key: "asOf",
      header: "As of",
      cell: (row) => (
        <span className={styles.identifier}>
          {row.asOf ?? "no as-of — nothing was read"}
        </span>
      ),
    },
  ]

  /** Declared against actual, both directions, dangerous direction first. */
  const driftColumns: readonly DataColumn<DeclarationRow>[] = [
    {
      key: "type",
      header: "Resource type",
      cell: (row) => <span className={styles.identifier}>{row.resourceType}</span>,
    },
    {
      key: "verdict",
      header: "Verdict",
      cell: (row) => (
        <div className={styles.cell}>
          <Badge tone={declarationTone(row.verdict)} title="Declared against actual">
            {verdictWord(row.verdict)}
          </Badge>
          <span className="md3-body-small" data-testid={`drift-${row.resourceType}`}>
            {row.detail}
          </span>
        </div>
      ),
    },
    { key: "declared", header: "Declared", align: "end", cell: (row) => declaredWord(row.declared) },
    {
      key: "present",
      header: "Running",
      align: "end",
      cell: (row) => (row.present === null ? "not known" : row.present),
    },
  ]

  /**
   * The resources of one service.
   *
   * Built per group rather than once for the whole estate: the brief for this
   * surface is to group by service, and a `surface` column on a flat table is
   * the same information with the grouping thrown away — the reader has to
   * reconstruct it by eye, and the per-service as-of has nowhere to live.
   */
  const resourceColumns: readonly DataColumn<EstateResource>[] = [
    {
      key: "name",
      header: "Resource",
      cell: (resource) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{resource.name}</span>
          <span className="md3-body-small">{resource.resourceType}</span>
        </div>
      ),
    },
    { key: "state", header: "State", cell: (resource) => resource.state },
    {
      key: "attribution",
      header: "Tenant",
      // `describeAttribution` has three arms and always will. A resource tagged
      // `tenure:tenant = SHARED` reads as shared because somebody DECIDED it is
      // platform overhead; a resource with no tag at all reads as
      // unattributable, naming the missing key. Folding the second into the
      // first — which any `tenant ?? "shared"` does — is how an untagged NAT
      // gateway silently becomes every customer's overhead.
      cell: (resource) => describeAttribution(resource.attribution),
    },
    {
      key: "region",
      header: "Region",
      cell: (resource) => (
        <span className={styles.identifier}>{resource.region || "global"}</span>
      ),
    },
    {
      key: "asOf",
      header: "As of",
      cell: (resource) => <span className={styles.identifier}>{resource.asOf}</span>,
    },
  ]

  const postureColumns: readonly DataColumn<PostureRow>[] = [
    { key: "clause", header: "Clause", cell: (row) => row.clause },
    {
      key: "verdict",
      header: "Verdict",
      cell: (row) => (
        <Badge tone={clauseTone(row.verdict)}>{row.verdict.toLowerCase().replace(/_/g, " ")}</Badge>
      ),
    },
    {
      key: "detail",
      header: "Detail",
      cell: (row) => (
        <div className={styles.cell}>
          <span>{row.detail}</span>
          {/*
           * `md3-unknown-statement`, not a bare `<code>`.
           *
           * That rule exists for exactly this content and its own comment says
           * why it is shaped the way it is: an operator pastes this into a
           * policy document, so it must NOT be re-wrapped — it scrolls inside
           * its own box instead, `white-space: pre` plus `overflow-x: auto`,
           * "the same bargain `.md3-table-shell` strikes, and the reason the
           * page itself never scrolls sideways at 320 CSS pixels".
           *
           * Rendered here without it, the statement was a bare `<code>` with
           * `overflow-x: visible`. Measured against the DOM CI itself served,
           * these ran 467 to 515 CSS pixels wide inside a 320-pixel viewport —
           * the widest non-table content on the page.
           */}
          {row.minimumStatement ? (
            <pre className="md3-unknown-statement">
              <code>{row.minimumStatement}</code>
            </pre>
          ) : null}
        </div>
      ),
    },
  ]

  const topologyColumns: readonly DataColumn<TopologyVerdict>[] = [
    {
      key: "role",
      header: "Role",
      cell: (row) => <span className={styles.identifier}>{row.role.key}</span>,
    },
    {
      key: "verdict",
      header: "Verdict",
      cell: (row) => {
        const account = topologyAccount(row)
        return (
          <div className={styles.cell}>
            <Badge tone={topologyTone(row.state)}>{row.state.toLowerCase().replace(/_/g, " ")}</Badge>
            {account ? <span className={styles.identifier}>{account}</span> : null}
            {/* The reason, once per row only when the rows disagree about it.
                When all twelve share one, the card says it above the table
                instead of printing the same sentence twelve times. */}
            {row.state === "UNKNOWN" && topologyRollup.sharedReason === null ? (
              <span className="md3-body-small">{row.because}</span>
            ) : null}
          </div>
        )
      },
    },
    { key: "purpose", header: "Purpose", cell: (row) => row.role.purpose },
  ]

  const refusedColumns: readonly DataColumn<(typeof refused)[number]>[] = [
    {
      key: "path",
      header: "Resource",
      cell: (entry) => <span className={styles.identifier}>{entry.path}</span>,
    },
    { key: "was", header: "What it is", cell: (entry) => String(entry.before ?? "unknown") },
  ]

  return (
    <div className={styles.page}>
      <h1 className="md3-headline-large">AWS estate</h1>

      {/* ── The question, then the answer, before any apparatus ─────────── */}
      <p className="md3-title-medium" data-testid="estate-question">
        What is actually running in this AWS account, and does it match what we declared?
      </p>
      <p className="md3-body-large" data-testid="estate-answer">
        {estateAnswer({ accountId, region, rows })}
      </p>
      <p className="md3-body-large" data-testid="coverage-answer">
        {coverageAnswer(coverage)}
      </p>
      <p className="md3-body-large" data-testid="drift-answer">
        {declarationAnswer({ rows: drift, declared })}
      </p>
      <p className="md3-body-small">
        Every figure on this page comes from a call this process issued at {requestedAt}. Nothing is
        held from an earlier render and nothing is compiled into the build — <code>/platform</code>
        &rsquo;s estate section is the snapshot taken at a commit, and it is deliberately a different
        page.
      </p>

      {/* ── Which account ─────────────────────────────────────────────── */}
      <Card
        headline="This account"
        id="identity"
        headerAside={
          <Badge tone={identityOk ? "ok" : "warn"} title="Whether sts:GetCallerIdentity answered">
            {identityOk ? "resolved" : "not resolved"}
          </Badge>
        }
        supportingText={asOfSentence("Resolved from sts:GetCallerIdentity", readAsOf(identity))}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium" data-testid="identity-headline">
            {identityHeadline(identity)}
          </p>

          {/*
            Narrowed by the discriminant rather than asserted. The last arm is
            exactly the four valueless states, which is what `UnknownState`
            accepts — so an arm added to `AwsRead` that carries no value stops
            this compiling instead of rendering as a blank panel. A cast here
            would have thrown that guarantee away for two fewer lines.
          */}
          {identity.state === "ACTUAL" || identity.state === "STALE" ? (
            <KeyValue items={identityFacts} ariaLabel="The account this engine is running in" />
          ) : identity.state === "EMPTY" ? (
            <EmptyState
              headline="sts:GetCallerIdentity answered with nothing"
              description="The call completed and returned no identity. Nothing below is attributed to an account."
            />
          ) : (
            <UnknownState
              what="the account this engine is running in"
              read={identity}
              now={now}
            />
          )}

          {mayOpenConsole && accountId ? (
            <Card
              headline="Break glass into the AWS console"
              headlineAs="h3"
              container="high"
              id="console-escape"
              supportingText={consoleCaveat(accountId)}
              actions={
                link ? (
                  <ButtonLink
                    variant="outlined"
                    href={link}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    Open the AWS console for this account
                  </ButtonLink>
                ) : undefined
              }
            >
              <div data-testid="console-escape">
                {link ? null : (
                  <p className="md3-body-medium">
                    No console link: this engine could not resolve a partition it knows a console
                    host for. Known partitions are {linkablePartitions().join(", ")}.
                  </p>
                )}
              </div>
            </Card>
          ) : null}
        </div>
      </Card>

      {/* ── What this engine can see at all ─────────────────────────────
          The coverage card comes BEFORE the inventory deliberately. An
          inventory read first is an inventory believed complete, and the one
          thing this page must never let a reader believe is that the services
          it happens to read are the services the account holds. */}
      <Card
        headline="What this engine can see"
        id="coverage"
        headerAside={
          <Badge
            tone={tally.noReader === 0 && tally.unreadable === 0 ? "ok" : "warn"}
            title="How many AWS services on this page were actually read"
          >
            {tally.read} of {tally.total} services read
          </Badge>
        }
        supportingText={
          <>
            Every AWS service this build names a capability for, plus every service this platform&rsquo;s
            Terraform declares. A service with no reader is a row here saying so — never an absence
            from the list, which would read as an account that does not hold any.
          </>
        }
      >
        <div className={styles.stack}>
          <div className={styles.row}>
            <Chip>
              <b>{tally.read}</b> service(s) read
            </Chip>
            <Chip>
              <b>{tally.unreadable}</b> read, but the call failed
            </Chip>
            <Chip data-testid="coverage-gap">
              <b>{tally.noReader}</b> not read on this page
            </Chip>
          </div>

          <DataTable
            caption="Every AWS service this page has anything to say about, and whether it can say it"
            columns={coverageColumns}
            rows={coverage}
            rowKey={(row) => row.service}
            empty={
              <EmptyState
                headline="This build names no AWS service for the estate"
                description="No capability declares the estate surface and no Terraform was readable, so there is nothing here to be right or wrong about. That is a property of the build, not of the account."
              />
            }
          />
        </div>
      </Card>

      {/* ── What is running, by service ────────────────────────────────── */}
      <Card
        headline="What is running"
        id="resources"
        headerAside={
          <Badge
            tone={unknown.length === 0 ? "ok" : "warn"}
            title="How many of the wired surfaces answered"
          >
            {rows.length - unknown.length} of {rows.length} surfaces answered
          </Badge>
        }
        supportingText={
          <>
            Read live through the Resource Groups Tagging API and each service&rsquo;s own describe
            call, issued at {requestedAt}. Grouped by service, with each resource&rsquo;s tenant, its
            region and the instant it was read. A surface this engine&rsquo;s role cannot read says it
            was not read and names the action it was refused — never an empty list, and never a zero.
          </>
        }
      >
        <div className={styles.stack}>
          <div className={styles.row}>
            <Chip>
              <b>{read}</b> resource(s) read
            </Chip>
            <Chip>
              <b>{unknown.length}</b> surface(s) not read
            </Chip>
            <Chip data-testid="tagged-line">
              {readings.tagged.state === "ACTUAL"
                ? `${readings.tagged.value.length} tagged resource(s)`
                : readings.tagged.state === "EMPTY"
                  ? "no tagged resources"
                  : "tag index not read"}
            </Chip>
          </div>

          <p className="md3-body-medium" data-testid="tagged-detail">
            {readings.tagged.state === "DENIED"
              ? `The tag index was not read — ${readings.tagged.action} was refused (${readings.tagged.errorCode}). ` +
                `Minimum statement: ${readings.tagged.minimumStatement}`
              : readings.tagged.state === "ACTUAL"
                ? `The tag index answered with ${readings.tagged.value.length} tagged resource(s), as of ${readings.tagged.asOf}.`
                : readings.tagged.state === "EMPTY"
                  ? `tag:GetResources answered successfully and returned no tagged resources, as of ${readings.tagged.asOf}. That is a real absence.`
                  : `The tag index could not be read (${readings.tagged.state}), so no resource below carries an attribution this console is confident in.`}
          </p>

          {/*
            The one block on this page that keeps up on its own.

            Everything around it is dated `requestedAt` and will still say that
            in an hour. This says when it was last refreshed, whether the last
            attempt worked, and at what interval — and the interval is the
            surface's own, arriving on its own responses, not a number chosen
            here. See `components/LiveRegion.tsx`.
          */}
          <LiveRegion
            surface="cdn"
            noun="edge distribution"
            what="Edge distributions"
            seed={cdnSeed}
            seedBecause={cdnBecause}
          />

          {services.length === 0 ? (
            <EmptyState
              headline="No service reader is wired into this page"
              description="Nothing here inventories an AWS service, so this is a property of the build rather than of the account. The coverage table above lists what a reader would have to be written for."
            />
          ) : null}

          {services.map((group) => (
            <Card
              key={group.service}
              headline={group.service}
              headlineAs="h3"
              container="high"
              id={`service-${group.service}`}
              headerAside={
                <Badge tone={group.resources.length > 0 ? "ok" : "info"} title={`What ${group.service} answered`}>
                  {group.resources.length} read
                </Badge>
              }
              supportingText={asOfSentence(
                `Read through ${group.surfaces.join(", ")}`,
                group.asOf,
              )}
            >
              <div className={styles.stack}>
                {/*
                  The table only when there is a row for it.

                  `estateLines` produces resources only from the ACTUAL arm, and
                  `readAws` never returns ACTUAL for an empty list — so an empty
                  group means every reading behind the service was EMPTY, STALE
                  or a failure, and each of those already renders its own panel
                  below saying which. A `DataTable` with an `empty` slot here
                  would print a second, vaguer version of the same fact directly
                  above the precise one, which is the duplication this page has
                  been trimmed of twice.
                */}
                {group.resources.length > 0 ? (
                  <DataTable
                    caption={`Every ${group.service} resource this engine read, with its tenant, region and as-of`}
                    columns={resourceColumns}
                    rows={group.resources}
                    rowKey={(resource) => resource.arn}
                    empty={null}
                  />
                ) : null}

                {/*
                  The governed state block, per surface of this service that did
                  not answer with a current list. Nothing renders for a healthy
                  read, so this is silent on a working estate and is the only
                  thing here on a console with no credentials — which is the case
                  it exists for.

                  `data-surface-line` and the per-surface testid are kept: they
                  are how an e2e assertion and the AI introspection hooks address
                  one surface.
                */}
                {lines
                  .filter(
                    (line) =>
                      line.read.capability.startsWith(`${group.service}:`) &&
                      line.read.state !== "ACTUAL",
                  )
                  .map((line) => (
                    <div
                      key={line.surface}
                      className={styles.surfaceLine}
                      data-surface-line={line.surface}
                    >
                      <span className="md3-body-small" data-testid={`line-${line.surface}`}>
                        {line.text}
                      </span>
                      {line.read.state === "ACTUAL" ? null : line.read.state === "EMPTY" ? (
                        <EmptyState
                          headline={`${line.surface} — AWS answered and returned nothing`}
                          description={`The call completed as of ${line.read.asOf}. This is a real absence, not a refusal.`}
                        />
                      ) : line.read.state === "STALE" ? (
                        <StaleIndicator
                          asOf={line.read.asOf}
                          cadenceMs={CAPABILITIES[line.read.capability].refreshMs}
                          now={now}
                          label={`${line.surface} was not re-read`}
                        />
                      ) : (
                        // The remaining four arms carry no value at all, which
                        // is `UnknownState`'s whole parameter type. The `ACTUAL`
                        // arm above is unreachable through the filter and is
                        // written out anyway, because it is what makes this
                        // narrow without a cast.
                        <UnknownState what={line.surface} read={line.read} now={now} />
                      )}
                    </div>
                  ))}
              </div>
            </Card>
          ))}
        </div>
      </Card>

      {/* ── Does it match what we declared? ───────────────────────────── */}
      <Card
        headline="Declared against actual"
        id="declared"
        headerAside={
          <Badge
            tone={
              !declared.known
                ? "warn"
                : drift.some(
                      (row) =>
                        row.verdict === "PRESENT_NOT_DECLARED" ||
                        row.verdict === "DECLARED_NOT_PRESENT",
                    )
                  ? "bad"
                  : "ok"
            }
            title="Whether what is running matches what this platform declares"
          >
            {declared.known ? `${declared.files.length} Terraform file(s) read` : "no declaration readable"}
          </Badge>
        }
        supportingText={
          <>
            Drift runs in two directions and the second is the dangerous one. A resource Terraform
            declares that the estate does not have is a deployment that did not finish; a resource the
            estate has that Terraform never declared is one nothing will ever update, nothing will ever
            remove, and no review has ever seen. Only resource types with BOTH a declaration and a
            reader appear here — a declared type nobody reads is a coverage gap, not a missing
            resource, and it is listed as one above.
          </>
        }
      >
        <div className={styles.stack}>
          <DataTable
            caption="Every resource type with a declaration, a reader, or both"
            columns={driftColumns}
            rows={drift}
            rowKey={(row) => row.resourceType}
            empty={
              <EmptyState
                headline="Nothing to compare"
                description={
                  declared.known
                    ? "No resource type has both a Terraform declaration and a reader in this build, so neither direction of drift is computable."
                    : declared.because
                }
              />
            }
          />

          {unmapped ? (
            <p className="md3-body-small" data-testid="declared-unmapped">
              {unmapped}
            </p>
          ) : null}

          {declared.known ? (
            <p className="md3-body-small" data-testid="declared-sources">
              Read from {declared.files.join(", ")}.
            </p>
          ) : null}
        </div>
      </Card>

      {/* ── The tag contract ───────────────────────────────────────────────
          STUDIO-070-002. `taggedResources` evaluates `tagProblems` on every
          result; this is where the answer reaches a person. Rendered only from
          an ACTUAL read: a DENIED tag index has no resources to judge, and
          printing "0 non-compliant" over a read that failed would report the
          estate as clean because nobody could look at it. */}
      {readings.tagged.state === "ACTUAL" && (
        <TagCompliancePanel resources={readings.tagged.value} />
      )}

      {/* ── The individual undeclared resources ────────────────────────── */}
      <Card
        headline="What reconciling this estate would do"
        id="reconcile"
        headerAside={
          // The span carries the testid because `Badge`'s props are closed on
          // purpose — it takes a tone, a word and a title, and nothing else.
          <span data-testid="reconcile-approval">
            <Badge tone="info" title="How much approval this plan's total would need">
              approval: {reconcile.cost.level}
            </Badge>
          </span>
        }
        supportingText={
          <>
            The table above counts undeclared resources by type. This names them: every resource the
            read plane found that carries no <code>tenure:managed-by</code> tag, and what removing it
            would cost or save each month. The estimate is a list price for a change that has not
            happened — never a billed figure; the FinOps Center is the only surface that shows what
            was actually charged.
          </>
        }
      >
        <div className={styles.stack}>
          {/*
            The sentence that used to be a false green.

            "Nothing to reconcile: every resource that was read is claimed by
            something" was printed whenever the diff was empty — including with
            no credentials at all, where four of four reads failed and the diff
            was empty because there was no input. `reconcileAnswer` has a
            separate arm for that, and it says so.
          */}
          <p className="md3-body-medium" data-testid="reconcile-summary">
            {reconcileAnswer({
              entries: reconcile.diff.entries.length,
              resourcesRead: read,
              surfacesUnknown: unknown.length,
            })}
          </p>

          {reconcile.diff.entries.length > 0 ? (
            <pre className="state-detail" data-testid="reconcile-plan">
              {renderComparison(reconcile.diff)}
            </pre>
          ) : null}

          {refused.length > 0 ? (
            <Card
              headline={`Refused — ${refused.length} of these cannot be undone`}
              headlineAs="h3"
              container="high"
              id="reconcile-refusal"
              supportingText="No reconcile action is offered for a deletion that destroys data. Putting an ECS service back is a deployment; putting a database back is a new, empty database with the same name. These need a typed target and an approval through the lifecycle, not a button on a read-only page."
            >
              <div data-testid="reconcile-refusal">
                <DataTable
                  caption="Deletions this page will not offer"
                  columns={refusedColumns}
                  rows={refused}
                  rowKey={(entry) => entry.path}
                  empty={
                    <EmptyState
                      headline="Nothing irreversible"
                      description="No entry in this plan deletes a resource whose data recreating would not restore."
                    />
                  }
                />
              </div>
            </Card>
          ) : null}

          {reconcile.cost.unpriced.length > 0 ? (
            <p className="md3-body-small" data-testid="reconcile-unpriced">
              {reconcile.cost.unpriced.length} change(s) could not be priced by this build, and are
              counted as unknown rather than as free: {reconcile.cost.unpriced.join(", ")}.
            </p>
          ) : null}

          {/*
            DIAGNOSTIC — named in this change's hand-off for the navigation
            owner to move behind the Diagnostics tab, and deliberately NOT moved
            here: relocating a route's content is that owner's change and not
            this one, and deleting it would destroy the only rendering of the
            document the contract admitted.

            It is the raw `ChangeDiff`, for a developer checking that everything
            above matches the contract. No operator decision is taken from it.

            `details:not([open]) > *:not(summary)` in `globals.css` keeps the
            closed disclosure from reporting a bounding rect that overlaps what
            follows it — see `e2e/layout.spec.ts`.
          */}
          <details>
            <summary className="md3-label-large">
              Diagnostic: the machine-readable diff (schema {reconcile.diff.schemaVersion})
            </summary>
            <pre className="state-detail" data-testid="reconcile-json">
              {JSON.stringify(reconcile.diff, null, 2)}
            </pre>
          </details>
        </div>
      </Card>

      {/* ── Where authority lives ─────────────────────────────────────── */}
      <Card
        headline="Where authority and evidence live"
        id="posture"
        headerAside={
          <Badge
            tone={managementTone(management.verdict)}
            title="Whether this workload runs in the Organizations management account"
          >
            {management.verdict.toLowerCase().replace(/_/g, " ")}
          </Badge>
        }
        supportingText={asOfSentence(
          "Compared against the account sts:GetCallerIdentity returned",
          readAsOf(identity),
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium" data-testid="management-verdict">
            {management.detail}
          </p>
          <DataTable
            caption="Centralization clauses, each read live"
            columns={postureColumns}
            rows={posture.rows}
            rowKey={(row) => row.clause}
            empty={
              <EmptyState
                headline="No centralization clause is evaluated"
                description="This build reads no CloudTrail, Config or Cost and Usage Report state, so it makes no claim about where evidence is centralized."
              />
            }
          />
        </div>
      </Card>

      {/* ── Account topology ──────────────────────────────────────────── */}
      <Card
        headline="Account topology"
        id="topology"
        headerAside={
          <Badge
            // Warn whenever ANY row could not be checked, not only when they all
            // share one reason: a mixed table with three unknowns in it is still
            // a topology this console cannot vouch for.
            tone={topology.some((row) => row.state === "UNKNOWN") ? "warn" : "info"}
            title="The declared account roles, against the accounts that actually exist"
          >
            {topology.length} declared roles
          </Badge>
        }
        supportingText={
          organization.state === "UNKNOWN"
            ? "The Organization could not be read, so nothing below is a finding — a role reported missing on a read nobody was allowed to make is how an operator spends a morning creating accounts that already exist."
            : "The account roles this platform declares, against the accounts that actually exist. A role nothing fills in a single-account estate is reported as filled by that account, not as a finding."
        }
      >
        <div className={styles.stack}>
          <p className="md3-body-medium" data-testid="topology-summary">
            {topologyRollup.headline}
          </p>
          <DataTable
            caption="Declared account roles and what fills each one"
            columns={topologyColumns}
            rows={topology}
            rowKey={(row) => row.role.key}
            empty={
              <EmptyState
                headline="No account role is declared"
                description="This build declares no account topology, so there is nothing for a live Organization read to be reconciled against."
              />
            }
          />
        </div>
      </Card>
    </div>
  )
}
