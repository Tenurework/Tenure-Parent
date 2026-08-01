import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { RESIDUAL_COST, needsApproval, nextStates, planFor } from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { getTenant, registryConfigured } from "@/lib/registry"
import { AdvanceControls } from "./AdvanceControls"

export const dynamic = "force-dynamic"

const money = (cents: number) =>
  cents === 0 ? "$0 marginal" : `$${(cents / 100).toFixed(2)}/month`

/**
 * One tenant: what it is, where it is, how it got there, and what can happen
 * next.
 *
 * The "what can happen next" is read from the lifecycle engine rather than
 * listed here, so the buttons an operator sees are exactly the transitions the
 * engine will accept. A hardcoded set would drift and produce buttons that
 * always fail.
 */
export default async function TenantPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth()
  if (!isOperator(session?.user?.email)) redirect("/signin")
  if (!registryConfigured()) notFound()

  const { slug } = await params
  const tenant = await getTenant(slug)
  if (!tenant) notFound()

  const plan = planFor(tenant.manifest)
  const moves = nextStates(tenant.state)
  const residual = RESIDUAL_COST[tenant.state]

  return (
    <>
      <nav className="tabs">
        <Link href="/tenants">Tenants</Link>
        <span className="here">{tenant.slug}</span>
      </nav>

      <h1>{tenant.manifest.displayName}</h1>
      <p className="slug">
        /{tenant.slug} · {tenant.manifest.legalName} · manifest {tenant.digest}
      </p>

      <section className="system">
        <header>
          <h2>State</h2>
          <span className="badge warn">{tenant.state}</span>
        </header>

        {residual && <p className="refused">{residual}</p>}

        <dl className="kv">
          <dt>blueprint</dt>
          <dd>{tenant.manifest.blueprintId}</dd>
          <dt>modules</dt>
          <dd>{tenant.manifest.modules.join(", ")}</dd>
          <dt>placement</dt>
          <dd>
            {tenant.manifest.isolation} · {tenant.manifest.region}
          </dd>
          <dt>first admin</dt>
          <dd>{tenant.manifest.initialAdminEmail}</dd>
          <dt>registered</dt>
          <dd>{tenant.createdAt}</dd>
        </dl>

        <AdvanceControls
          slug={tenant.slug}
          moves={moves.map((to) => ({ to, needsApproval: needsApproval(tenant.state, to) }))}
        />
      </section>

      <section className="system">
        <header>
          <h2>Plan</h2>
          <span className="badge">{money(plan.estimatedMonthlyCostCents)}</span>
        </header>
        <p className="slug">{plan.costBasis}</p>

        {plan.warnings.map((w) => (
          <p className="refused" key={w}>
            {w}
          </p>
        ))}

        <table className="grid">
          <thead>
            <tr>
              <th>During</th>
              <th>What</th>
            </tr>
          </thead>
          <tbody>
            {plan.steps.map((s) => (
              <tr key={s.what}>
                <td className="id">{s.during}</td>
                <td>
                  {s.what}
                  <br />
                  <span className="slug">{s.detail}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="system">
        <header>
          <h2>History</h2>
          <span className="badge">{tenant.history.length}</span>
        </header>
        {tenant.history.length === 0 ? (
          <p>Registered, and not yet moved.</p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>When</th>
                <th>Move</th>
                <th>Actor</th>
                <th>Approved by</th>
              </tr>
            </thead>
            <tbody>
              {tenant.history.map((s) => (
                <tr key={`${s.at}-${s.attempt}`}>
                  <td className="id">{s.at}</td>
                  <td>
                    {s.from} → {s.to}
                    {s.attempt > 1 && <span className="slug"> (attempt {s.attempt})</span>}
                    {s.reason && (
                      <>
                        <br />
                        <span className="slug">{s.reason}</span>
                      </>
                    )}
                  </td>
                  <td className="slug">{s.actor}</td>
                  <td className="slug">{s.approvedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
