import { auth } from "@/lib/auth"
import { AwsReadPanel, UnknownState } from "@/components/states"
import { TagCompliancePanel } from "@/components/TagCompliancePanel"
import {
  Badge,
  ButtonLink,
  Card,
  Chip,
  DataTable,
  EmptyState,
  type DataColumn,
} from "@/components/md3"
import { consoleCaveat, consoleLink, linkablePartitions } from "@/lib/aws/console-link"
import { irreversibleEntries, resourceChangeDiff } from "@/lib/aws/drift"
import { identityHeadline } from "@/lib/aws/identity"
import { estateInventory, estateLines, type EstateResource } from "@/lib/aws/inventory"
import { renderComparison } from "@/lib/revisions"
import { centralizationPosture, type PostureRow } from "@/lib/aws/posture"
import { reconcileTopology, type TopologyVerdict } from "@/lib/aws/topology"
import { describeAttribution } from "@/lib/aws/tags"
import { isOperator, mayAct, operatorConfigProblems, roleOf } from "@/lib/operators"

import {
  asOfSentence,
  clauseTone,
  estateAnswer,
  managementTone,
  readAsOf,
  reconcileAnswer,
  resourcesRead,
  surfaceRows,
  surfaceTone,
  topologyAccount,
  topologySummary,
  topologyTone,
  unknownSurfaces,
} from "./estate-answer"
import styles from "./estate.module.css"

export const dynamic = "force-dynamic"

/**
 * STUDIO-080-001 / STUDIO-000-006 / STUDIO-010-002 — the estate, read from AWS
 * at the moment this page is rendered.
 *
 * Every number here comes from a call this process just made. `/platform`'s
 * estate section is a snapshot compiled at a commit; this is the live one, and
 * the two are deliberately separate pages rather than one page that sometimes
 * lies about which it is showing.
 *
 * ── Structure ──────────────────────────────────────────────────────────────
 *
 * The lead paragraph is the point of the whole surface, and it comes before any
 * apparatus. An operator opening this route arrives with two questions — which
 * account is this, and what is running in it — and both have to be answerable
 * without scrolling and without reading a table. `estateAnswer` composes them
 * into one sentence with an arm for every combination of known and not known,
 * so a page that cannot answer says so in the same place a page that can does.
 *
 * Everything after it is a Card with a real heading, and every Card states what
 * it is AS OF. Four of the seven `AwsRead` arms carry no `asOf` at all, because
 * the call never completed, and `asOfSentence` prints that rather than dating
 * the panel to the moment its read failed.
 *
 * ── This page must render with no AWS credentials ──────────────────────────
 *
 * It is the page an operator opens to find out WHY the estate cannot be read,
 * so a 500 from an unreachable STS is not an acceptable refusal. Every read
 * arrives as an `AwsRead` union; the failing arms render `AwsReadPanel`, which
 * names the principal, the action and the minimum IAM statement that would fix
 * it. Verified by rendering this route with no credentials in the environment.
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

  /* ------------------------------------------------------------ columns -- */

  /**
   * Every surface, and what it answered. The table an operator reads first
   * inside the inventory card, because it is the one that distinguishes an
   * empty estate from an estate nobody was allowed to look at.
   */
  const surfaceColumns: readonly DataColumn<(typeof rows)[number]>[] = [
    { key: "surface", header: "Surface", cell: (row) => row.surface },
    {
      key: "answer",
      header: "What AWS said",
      cell: (row) => (
        <div className={styles.cell}>
          <Badge
            tone={surfaceTone(row.answer)}
            title={`The ${row.surface} read came back ${row.answer}`}
          >
            {row.answer === "UNREAD" ? "not read" : row.answer.toLowerCase()}
          </Badge>
          {/*
            `estateLines`'s own sentence, and the ONLY place it is printed.
            It used to appear three times per surface — here, again as a
            paragraph below, and a third time inside the state panel — which is
            how four failed reads filled a screen with twelve copies of one
            error. The testid stays on the text so an assertion still addresses
            the production render path rather than a helper.
          */}
          <span className="md3-body-small" data-testid={`line-${row.surface}`}>
            {row.said}
          </span>
        </div>
      ),
    },
    {
      key: "count",
      header: "Resources",
      align: "end",
      // Never a zero for a surface nobody could read. That substitution is the
      // whole defect STUDIO-000-007 exists to end, and a right-aligned numeric
      // column is where it hides best.
      cell: (row) => (row.count === null ? "not known" : row.count),
    },
    {
      key: "asOf",
      header: "As of",
      cell: (row) => (
        <span className={styles.identifier}>{row.asOf ?? "no as-of — the call did not complete"}</span>
      ),
    },
  ]

  /**
   * The resources themselves, from every surface that answered, in one table.
   *
   * One table rather than one per surface: four headings over four tables of
   * two rows each is the flat wall this page had, and the surface is a COLUMN —
   * a fact about the row, not a reason to start a new region.
   */
  interface InventoryRow {
    surface: string
    resource: EstateResource
  }
  const inventory: readonly InventoryRow[] = lines.flatMap((line) =>
    line.resources.map((resource) => ({ surface: line.surface, resource })),
  )

  const inventoryColumns: readonly DataColumn<InventoryRow>[] = [
    {
      key: "name",
      header: "Resource",
      cell: (row) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{row.resource.name}</span>
          <span className="md3-body-small">{row.surface}</span>
        </div>
      ),
    },
    { key: "state", header: "State", cell: (row) => row.resource.state },
    {
      key: "placement",
      header: "Account / region",
      cell: (row) => (
        <span className={styles.identifier}>
          {row.resource.accountId || "unknown"} / {row.resource.region || "global"}
        </span>
      ),
    },
    {
      key: "attribution",
      header: "Attribution",
      cell: (row) => describeAttribution(row.resource.attribution),
    },
    {
      key: "dependsOn",
      header: "Depends on",
      cell: (row) => (
        <div className={styles.cell}>
          {row.resource.dependsOn.length === 0 ? (
            <span>nothing it names itself</span>
          ) : (
            row.resource.dependsOn.map((edge) => (
              <span key={edge} className={styles.identifier}>
                {edge}
              </span>
            ))
          )}
        </div>
      ),
    },
  ]

  const postureColumns: readonly DataColumn<PostureRow>[] = [
    { key: "clause", header: "Clause", cell: (row) => row.clause },
    {
      key: "verdict",
      header: "Verdict",
      cell: (row) => <Badge tone={clauseTone(row.verdict)}>{row.verdict.toLowerCase().replace(/_/g, " ")}</Badge>,
    },
    {
      key: "detail",
      header: "Detail",
      cell: (row) => (
        <div className={styles.cell}>
          <span>{row.detail}</span>
          {row.minimumStatement ? <code>{row.minimumStatement}</code> : null}
        </div>
      ),
    },
  ]

  const topologyColumns: readonly DataColumn<TopologyVerdict>[] = [
    { key: "role", header: "Role", cell: (row) => <span className={styles.identifier}>{row.role.key}</span> },
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
    { key: "path", header: "Resource", cell: (entry) => <span className={styles.identifier}>{entry.path}</span> },
    { key: "was", header: "What it is", cell: (entry) => String(entry.before ?? "unknown") },
  ]

  return (
    <div className={styles.page}>
      <h1 className="md3-headline-large">AWS estate</h1>

      {/* ── The answer, before any apparatus ───────────────────────────── */}
      <p className="md3-body-large" data-testid="estate-answer">
        {estateAnswer({ accountId, region, rows })}
      </p>
      <p className="md3-body-small">
        Every figure on this page comes from a call this process issued at {requestedAt}. Nothing is
        held from an earlier render, and nothing is compiled into the build — <code>/platform</code>
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
          <p className="md3-body-medium" data-testid="identity-headline">{identityHeadline(identity)}</p>

          {identityOk ? (
            <dl className={`${styles.facts} md3-body-medium`}>
              <dt>Account</dt>
              <dd className={styles.identifier}>{identity.value.accountId}</dd>
              <dt>Region</dt>
              <dd className={styles.identifier}>{identity.value.region}</dd>
              <dt>Partition</dt>
              <dd className={styles.identifier}>{identity.value.partition}</dd>
              <dt>Read as</dt>
              <dd className={styles.identifier}>{identity.value.arn}</dd>
            </dl>
          ) : (
            <UnknownState
              principal="not resolved"
              action="sts:GetCallerIdentity"
              minimumStatement={'{"Effect":"Allow","Action":["sts:GetCallerIdentity"],"Resource":"*"}'}
              what="the account this engine is running in"
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

      {/* ── What is running ───────────────────────────────────────────── */}
      <Card
        headline="What is running"
        id="resources"
        headerAside={
          <Badge
            tone={unknown.length === 0 ? "ok" : "warn"}
            title="How many of the surfaces this console inventories answered"
          >
            {rows.length - unknown.length} of {rows.length} surfaces answered
          </Badge>
        }
        supportingText={
          <>
            Read live through the Resource Groups Tagging API and each service&rsquo;s own describe
            call, issued at {requestedAt}. A surface this engine&rsquo;s role cannot read says it was
            not read and names the action it was refused — never an empty list, and never a zero.
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

          <DataTable
            caption="Every AWS surface this console inventories, and what it answered"
            columns={surfaceColumns}
            rows={rows}
            rowKey={(row) => row.surface}
            empty={
              <EmptyState
                headline="This build inventories no AWS surface"
                description="No service read is wired into this page, so there is nothing here to be right or wrong about. That is a property of the build, not of the account."
              />
            }
          />

          {inventory.length > 0 ? (
            <DataTable
              caption={`The ${inventory.length} resource(s) the surfaces above returned`}
              columns={inventoryColumns}
              rows={inventory}
              rowKey={(row) => row.resource.arn}
              empty={
                <EmptyState
                  headline="No resource was returned"
                  description="Every surface that answered returned an empty list."
                />
              }
            />
          ) : null}

          {/*
            The governed state block, per surface that did not answer with a
            current list. `AwsReadPanel` renders nothing for ACTUAL, so this is
            silent on a healthy estate and is the only thing here on a console
            with no credentials — which is the case it exists for.

            `data-surface-line` and the per-surface testid are kept: they are how
            an e2e assertion and the AI introspection hooks address one surface.
          */}
          {lines
            .filter((line) => line.read.state !== "ACTUAL")
            .map((line) => (
              <div key={line.surface} data-surface-line={line.surface}>
                <AwsReadPanel read={line.read} what={line.surface} />
              </div>
            ))}
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

      {/* ── What reconciling would do ─────────────────────────────────── */}
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
            Every resource the read plane found that carries no <code>tenure:managed-by</code> tag,
            and what removing it would cost or save each month. The estimate is a list price for a
            change that has not happened — never a billed figure; the FinOps Center is the only
            surface that shows what was actually charged.
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
            DIAGNOSTIC. This disclosure is the raw ChangeDiff document, and it is
            here for a developer checking that the rendering above matches the
            contract — no operator decision is taken from it. It is named in the
            hand-off so the information-architecture owner can move it behind the
            Diagnostics tab; it is not moved here, because moving a route's
            content is that owner's change and not this one.
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
          <Badge tone={managementTone(management.verdict)} title="Whether this workload runs in the Organizations management account">
            {management.verdict.toLowerCase().replace(/_/g, " ")}
          </Badge>
        }
        supportingText={asOfSentence(
          "Compared against the account sts:GetCallerIdentity returned",
          readAsOf(identity),
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-medium" data-testid="management-verdict">{management.detail}</p>
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
          <p className="md3-body-medium" data-testid="topology-summary">{topologyRollup.headline}</p>
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
