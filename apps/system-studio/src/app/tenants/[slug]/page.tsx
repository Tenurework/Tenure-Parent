import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { RESIDUAL_COST, needsApproval, nextStates, planFor } from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { ArchivedState, PendingDeletionState } from "@/components/states"
import { ARCHIVED_STATES, PURGE_STATES, riskOf } from "@/lib/tenant-state"
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

      {/* The section nav names Tenants; this says which one, and how to get
          back. Two levels is the whole hierarchy — a breadcrumb longer than the
          hierarchy is decoration. */}
      <p className="breadcrumb">
        <Link href="/tenants">Tenants</Link> <span aria-hidden="true">/</span> {tenant.slug}
      </p>

      <h1>{tenant.manifest.displayName}</h1>
      <p className="slug">
        /{tenant.slug} · {tenant.manifest.legalName} · manifest {tenant.digest}
      </p>

      {tenant.registry && (
        <section className="system">
          <header>
            <h2>Registry</h2>
            <span className="badge">{tenant.registry.provenance}</span>
          </header>

          {/* Said plainly, and permanently. An adopted tenant must never present
              as one this console provisioned — the lifecycle history it does not
              have is the difference, and a reader who cannot see which is which
              will assume the steps were run. */}
          {tenant.registry.provenance === "adopted" && (
            <p className="refused">
              Adopted. This system was serving before the registry existed and was brought under
              it — no provisioning steps were run, and none are recorded.
            </p>
          )}

          <dl className="kv">
            <dt>Tenant id</dt>
            <dd className="id">{tenant.registry.tenantId}</dd>
            <dt>Lifecycle</dt>
            <dd>{tenant.registry.lifecycle}</dd>
            <dt>Cell</dt>
            <dd>
              {tenant.registry.placement.cellId} · {tenant.registry.placement.region}
            </dd>
            <dt>Permitted regions</dt>
            <dd>{tenant.registry.residency.join(", ")}</dd>
            <dt>Plan</dt>
            <dd>{tenant.registry.plan}</dd>
            <dt>Release</dt>
            <dd>{tenant.registry.release}</dd>
            <dt>Config revision</dt>
            <dd>{tenant.registry.configRevision}</dd>
            <dt>Administrator</dt>
            <dd>{tenant.registry.primaryContactEmail}</dd>
          </dl>
        </section>
      )}

      <section className="system">
        <header>
          <h2>State</h2>
          <span className="badge warn">{tenant.state}</span>
        </header>

        {/*
          GE-022-006. Archived and pending-deletion are read off the lifecycle
          state rather than a separate flag, so they cannot disagree with it.
          Both were previously indistinguishable from any other non-serving
          state: a tenant three days from purge looked exactly like one that was
          merely paused.
        */}
        {ARCHIVED_STATES.has(tenant.state) && (
          <ArchivedState what={tenant.manifest.displayName} since={tenant.updatedAt ?? tenant.createdAt} />
        )}
        {PURGE_STATES.has(tenant.state) && (
          <PendingDeletionState
            what={tenant.manifest.displayName}
            at={tenant.state === "PURGING" ? "now — it is running" : "when an operator advances it to PURGING"}
          />
        )}

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
          moves={moves.map((to) => ({
            to,
            needsApproval: needsApproval(tenant.state, to),
            // Computed here, on the server, from the transition graph itself.
            // Reversibility especially: a hand-written label saying "this can be
            // undone" is a claim, and the graph is the fact.
            risk: riskOf(tenant.slug, tenant.state, to),
          }))}
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

      {tenant.deployment && (
        <section className="system">
          <header>
            <h2>Deployment manifest</h2>
            <span className="badge ok">{tenant.deployment.digest}</span>
          </header>
          <p>
            The signed artifact a cell reconciles toward. Its digest covers every field below, so a
            cell can verify it received what the engine published rather than trusting the
            transport.
          </p>
          <dl className="kv">
            <dt>configuration</dt>
            <dd>{tenant.deployment.configurationChecksum}</dd>
            <dt>modules</dt>
            <dd>{tenant.deployment.modules.join(", ")}</dd>
            <dt>schema</dt>
            <dd>{tenant.deployment.schemaVersion}</dd>
            <dt>evidence</dt>
            <dd>{tenant.deployment.evidenceDigest}</dd>
            <dt>published</dt>
            <dd>
              {tenant.deployment.createdAt} by {tenant.deployment.createdBy}
            </dd>
          </dl>
        </section>
      )}

      {tenant.evidence.length > 0 && (
        <section className="system">
          <header>
            <h2>Evidence</h2>
            <span className="badge">{tenant.evidence.length} steps</span>
          </header>
          <p>
            What each step actually produced. A step that records having run without producing
            anything citable is a step that did not run.
          </p>
          {tenant.evidence.map((e) => (
            <div key={`${e.state}-${e.step}`}>
              <h3>
                {e.state} · {e.step} <span className="badge">{e.ok ? "ok" : "failed"}</span>
              </h3>
              <p className="slug">{e.detail}</p>
              {e.digest && <p className="slug">digest {e.digest}</p>}
              {e.checks && (
                <table className="grid">
                  <tbody>
                    {e.checks.map((c) => (
                      <tr key={c.name}>
                        <td className="state">{c.ok ? "✓" : "✗"}</td>
                        <td>{c.name}</td>
                        <td className="slug">{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </section>
      )}

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
