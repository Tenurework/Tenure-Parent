import { auth } from "@/lib/auth"
import { AwsReadPanel, UnknownState } from "@/components/states"
import { TagCompliancePanel } from "@/components/TagCompliancePanel"
import { consoleCaveat, consoleLink, linkablePartitions } from "@/lib/aws/console-link"
import { irreversibleEntries, resourceChangeDiff } from "@/lib/aws/drift"
import { identityHeadline } from "@/lib/aws/identity"
import { estateInventory, estateLines } from "@/lib/aws/inventory"
import { renderComparison } from "@/lib/revisions"
import { centralizationPosture } from "@/lib/aws/posture"
import { reconcileTopology } from "@/lib/aws/topology"
import { describeAttribution } from "@/lib/aws/tags"
import { isOperator, mayAct, operatorConfigProblems, roleOf } from "@/lib/operators"

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
 * The header band is the point of the whole surface: an operator must be able to
 * answer "which account am I looking at" without scrolling, and when the answer
 * is not known the band says so rather than going blank or printing a default.
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

  const link =
    mayOpenConsole && partition && region
      ? consoleLink({ partition, region, service: "resource-groups" })
      : null

  return (
    <>
      <h1>AWS estate</h1>

      {/* ── Who am I ───────────────────────────────────────────────────── */}
      <section className="system" data-surface="identity">
        <header>
          <h2>Identity</h2>
        </header>
        <p data-testid="identity-headline">{identityHeadline(identity)}</p>
        {!identityOk && (
          <UnknownState
            principal="not resolved"
            action="sts:GetCallerIdentity"
            minimumStatement={'{"Effect":"Allow","Action":["sts:GetCallerIdentity"],"Resource":"*"}'}
            what="the account this engine is running in"
          />
        )}

        {mayOpenConsole && accountId && (
          <div className="console-escape" data-testid="console-escape">
            <h3>Console</h3>
            {link ? (
              <p>
                <a href={link} rel="noreferrer noopener" target="_blank">
                  Open the AWS console for this account
                </a>
              </p>
            ) : (
              <p>
                No console link: this engine could not resolve a partition it knows a console host
                for. Known partitions are {linkablePartitions().join(", ")}.
              </p>
            )}
            <p className="slug">{consoleCaveat(accountId)}</p>
          </div>
        )}
      </section>

      {/* ── Resources ──────────────────────────────────────────────────── */}
      <section className="system" data-surface="resources">
        <header>
          <h2>Resources</h2>
        </header>
        <p>
          Read live through the Resource Groups Tagging API and each service&rsquo;s own describe
          call. A surface the engine&rsquo;s role cannot read says <em>unknown</em> and names the
          action it was refused — never an empty list.
        </p>

        <p data-testid="tagged-line">
          {readings.tagged.state === "DENIED"
            ? `unknown — ${readings.tagged.action} was refused (${readings.tagged.errorCode}). ` +
              `Minimum statement: ${readings.tagged.minimumStatement}`
            : readings.tagged.state === "ACTUAL"
              ? `${readings.tagged.value.length} tagged resource(s), as of ${readings.tagged.asOf}`
              : readings.tagged.state === "EMPTY"
                ? `none — tag:GetResources returned no tagged resources, as of ${readings.tagged.asOf}`
                : `unknown — the tag index could not be read (${readings.tagged.state})`}
        </p>

        {lines.map((line) => (
          <div key={line.surface} data-surface-line={line.surface}>
            <h3>{line.surface}</h3>
            <p data-testid={`line-${line.surface}`}>{line.text}</p>
            {line.resources.length > 0 && (
              <div className="scroll-x">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>State</th>
                      <th>Attribution</th>
                      <th>Depends on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {line.resources.map((r) => (
                      <tr key={r.arn}>
                        <td className="id">{r.name}</td>
                        <td>{r.state}</td>
                        <td>{describeAttribution(r.attribution)}</td>
                        <td className="slug">{r.dependsOn.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <AwsReadPanel read={line.read} what={line.surface} />
          </div>
        ))}
      </section>

      {/* ── The tag contract ───────────────────────────────────────────────
          STUDIO-070-002. `taggedResources` evaluates `tagProblems` on every
          result; this is where the answer reaches a person. Rendered only from
          an ACTUAL read: a DENIED tag index has no resources to judge, and
          printing "0 non-compliant" over a read that failed would report the
          estate as clean because nobody could look at it. */}
      {readings.tagged.state === "ACTUAL" && (
        <TagCompliancePanel resources={readings.tagged.value} />
      )}

      {/* ── What reconciling would do ──────────────────────────────────── */}
      <section className="system" data-surface="reconcile">
        <header>
          <h2>What reconciling this estate would do</h2>
          <span className="badge quiet" data-testid="reconcile-approval">
            approval: {reconcile.cost.level}
          </span>
        </header>
        <p>
          Every resource the read plane found that carries no <code>tenure:managed-by</code> tag,
          and what removing it would cost or save each month. The estimate is a list price for a
          change that has not happened — never a billed figure; the FinOps Center is the only
          surface that shows what was actually charged.
        </p>

        {reconcile.diff.entries.length === 0 ? (
          <p data-testid="reconcile-summary">
            Nothing to reconcile: every resource that was read is claimed by something.
          </p>
        ) : (
          <pre className="state-detail" data-testid="reconcile-summary">
            {renderComparison(reconcile.diff)}
          </pre>
        )}

        {refused.length > 0 && (
          <div className="refusal" data-testid="reconcile-refusal">
            <h3>Refused — {refused.length} of these cannot be undone</h3>
            <p>
              No reconcile action is offered for a deletion that destroys data. Putting an ECS
              service back is a deployment; putting a database back is a new, empty database with
              the same name. These need a typed target and an approval through the lifecycle, not a
              button on a read-only page.
            </p>
            <ul>
              {refused.map((entry) => (
                <li key={entry.path} className="id">
                  {entry.path}
                </li>
              ))}
            </ul>
          </div>
        )}

        {reconcile.cost.unpriced.length > 0 && (
          <p className="slug" data-testid="reconcile-unpriced">
            {reconcile.cost.unpriced.length} change(s) could not be priced by this build, and are
            counted as unknown rather than as free: {reconcile.cost.unpriced.join(", ")}.
          </p>
        )}

        <details>
          <summary>Machine-readable diff (schema {reconcile.diff.schemaVersion})</summary>
          <pre className="state-detail" data-testid="reconcile-json">
            {JSON.stringify(reconcile.diff, null, 2)}
          </pre>
        </details>
      </section>

      {/* ── Where authority lives ──────────────────────────────────────── */}
      <section className="system" data-surface="posture">
        <header>
          <h2>Where authority and evidence live</h2>
        </header>
        <p data-testid="management-verdict">
          <b>{management.verdict}</b> — {management.detail}
        </p>

        <div className="scroll-x">
          <table className="grid">
            <thead>
              <tr>
                <th>Clause</th>
                <th>Verdict</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {posture.rows.map((row) => (
                <tr key={row.clause} data-clause={row.clause}>
                  <td className="id">{row.clause}</td>
                  <td>{row.verdict}</td>
                  <td>
                    {row.detail}
                    {row.minimumStatement ? (
                      <>
                        {" "}
                        <code>{row.minimumStatement}</code>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Account topology ───────────────────────────────────────────── */}
      <section className="system" data-surface="topology">
        <header>
          <h2>Account topology</h2>
        </header>
        <p>
          The account roles this platform declares, against the accounts that actually exist. A role
          nothing fills in a single-account estate is reported as filled by that account, not as a
          finding — and when the Organization could not be read every row says so.
        </p>
        <div className="scroll-x">
          <table className="grid">
            <thead>
              <tr>
                <th>Role</th>
                <th>Verdict</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {topology.map((t) => (
                <tr key={t.role.key}>
                  <td className="id">{t.role.key}</td>
                  <td>
                    {t.state}
                    {t.state === "SINGLE_ACCOUNT" ? ` — ${t.accountId}` : ""}
                    {t.state === "FILLED" ? ` — ${t.accountId}` : ""}
                    {t.state === "UNKNOWN" ? ` — ${t.because}` : ""}
                  </td>
                  <td>{t.role.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
