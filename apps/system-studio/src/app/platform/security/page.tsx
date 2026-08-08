import { auth } from "@/lib/auth"
import { AwsReadPanel } from "@/components/states"
import { securityFindings, SEVERITY_SLA_HOURS } from "@/lib/aws/findings"
import { identityHeadline } from "@/lib/aws/identity"
import { describeAttribution } from "@/lib/aws/tags"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

export const dynamic = "force-dynamic"

/**
 * STUDIO-110-006 — security findings, and the per-source table that makes an
 * empty list mean something.
 *
 * The only "findings" this console had were architecture-versus-inventory
 * discrepancies compiled out of `docs/architecture` — documentation gaps with an
 * owning requirement id, no severity, no affected tenant and no SLA. Those are
 * still on `/platform`, correctly, under "Open findings". These are different
 * findings and belong on their own page rather than in the same table.
 *
 * The sources table is not decoration. With six products behind one aggregator,
 * "no open findings" is only a fact if the page can also say which of the six
 * answered — and when the call was refused, all six read UNKNOWN and no findings
 * table is drawn at all.
 */
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
  const denied = surface.read.state === "DENIED"

  return (
    <>
      <h1>Security findings</h1>
      <p className="slug">{identityHeadline(surface.identity)}</p>

      <section className="system" data-surface="finding-sources">
        <header>
          <h2>Sources</h2>
          <span className="slug">refreshed every {Math.round(surface.refreshMs / 60_000)} min</span>
        </header>
        <p>
          Six products publish through Security Hub. An empty findings list means nothing without
          this table: it could be a clean estate, five products switched off, or a role that cannot
          call <code>securityhub:GetFindings</code>.
        </p>
        <div className="scroll-x">
          <table className="grid">
            <thead>
              <tr>
                <th>Product</th>
                <th>State</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {surface.sources.map((source) => (
                <tr key={source.product} data-source-state={source.state}>
                  <td className="id">{source.product}</td>
                  <td>{source.state}</td>
                  <td>
                    {source.detail}
                    {source.minimumStatement ? (
                      <>
                        {" "}
                        <code>{source.minimumStatement}</code>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="system" data-surface="findings">
        <header>
          <h2>Open findings</h2>
        </header>
        <p data-testid="security-headline">{surface.headline}</p>

        {/*
          Not rendered at all when the read was refused. An empty table under a
          heading that says "Open findings" is read as "there are none", which is
          the one thing this page must never say about an estate it could not
          look at.
        */}
        {denied ? null : (
          <>
            <p>
              Deduplicated on finding id, product ARN and affected resources —
              {surface.duplicatesRemoved > 0
                ? ` ${surface.duplicatesRemoved} duplicate record(s) collapsed.`
                : " no duplicates in this read."}{" "}
              Severity is the product&rsquo;s own label, never a guess from a numeric score. A
              finding is past its SLA at {SEVERITY_SLA_HOURS.CRITICAL}h for CRITICAL and{" "}
              {SEVERITY_SLA_HOURS.HIGH}h for HIGH.
            </p>
            <div className="scroll-x">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Finding</th>
                    <th>Product</th>
                    <th>Affects</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {surface.findings.map((finding) => (
                    <tr key={finding.key} data-severity={finding.severity}>
                      <td>
                        <b>{finding.severity}</b>
                        {finding.pastSla ? <span className="slug"> past SLA</span> : null}
                      </td>
                      <td>{finding.title}</td>
                      <td className="slug">{finding.product}</td>
                      <td>{describeAttribution(finding.affects)}</td>
                      <td className="num">{Math.round(finding.ageHours)}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <AwsReadPanel read={surface.read} what="the security findings" />
      </section>
    </>
  )
}
