import Link from "next/link"
import { redirect } from "next/navigation"

import { TENANT_BINDINGS } from "@tenure/blueprints"
import { RESIDUAL_COST, SERVING } from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { listTenants, registryConfigured } from "@/lib/registry"
import { adoptableBindings } from "@/lib/adopt"
import { placeableRegions } from "@/lib/cells"
import { PLAN_CATALOG } from "@tenure/provisioning"
import { AdoptForm } from "./AdoptForm"
import { EmptyState, ErrorState, PartialDataState, PermissionDeniedState } from "@/components/states"
import { byUrgency, healthOf, summariseFleet } from "@/lib/fleet-health"

export const dynamic = "force-dynamic"

/**
 * The fleet. GE-103-001.
 *
 * Two sources, shown as two sections rather than merged into one list. The
 * file-based bindings predate the registry and are how the live pilot is
 * configured; presenting them as if they had been provisioned through this
 * console would be a claim about how they got there that is not true.
 */
export default async function TenantsPage() {
  const session = await auth()
  // GE-022-006. Two different facts, told apart. Nobody signed in goes to the
  // sign-in page; somebody signed in who is NOT an operator is refused, with a
  // reason and without naming what they were refused. Sending the second case
  // to /signin told them to go and do the thing they had already done.
  if (!session?.user?.email) redirect("/signin")
  if (!isOperator(session.user.email)) return <PermissionDeniedState />


  const configured = registryConfigured()

  // A registry that cannot be read must say so, not 500. In production Next
  // replaces a thrown server error with "Application error: a server-side
  // exception has occurred" and a digest — which tells an operator nothing they
  // can act on, and hides whether the table is missing, the role lacks a
  // permission, or the query is malformed.
  let tenants: Awaited<ReturnType<typeof listTenants>> = []
  let failure: string | null = null
  if (configured) {
    try {
      tenants = await listTenants()
    } catch (err) {
      failure = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    }
  }

  // A binding is adoptable until it is in the registry. Derived from what the
  // registry actually returned rather than from a flag, so a failed read shows
  // nothing as adoptable instead of offering to adopt something twice.
  const registeredSlugs = tenants.map((t) => t.slug)
  const adoptable = failure ? [] : adoptableBindings(registeredSlugs)
  const planOptions = PLAN_CATALOG.map((p) => ({ planId: p.planId, displayName: p.displayName }))

  return (
    <>

      <h1>Tenants</h1>

      {/*
        GE-033-002. Fleet health, derived entirely from the registry — lifecycle
        state, when it last moved, whether a manifest exists. No tenant content
        is read to answer any of it, and a guard fails if that changes.
      */}
      {!failure && configured && tenants.length > 0 && (() => {
        const now = new Date()
        const health = byUrgency(
          tenants.map((t) =>
            healthOf(
              { slug: t.slug, state: t.state, updatedAt: t.updatedAt, hasDeployment: true },
              now,
            ),
          ),
        )
        const summary = summariseFleet(health)
        const needing = health.filter((h) => h.attention !== null)

        return (
          <section className="system">
            <header>
              <h2>Fleet health</h2>
              <span className={`badge ${summary.needingAttention === 0 ? "ok" : "warn"}`}>
                {summary.needingAttention === 0
                  ? "nothing needs attention"
                  : `${summary.needingAttention} need attention`}
              </span>
            </header>

            <div className="chips">
              <span className="chip">
                <b>{summary.serving}</b> serving
              </span>
              {Object.entries(summary.bySignal)
                .filter(([signal, count]) => count > 0 && signal !== "serving")
                .map(([signal, count]) => (
                  <span className="chip" key={signal}>
                    <b>{count}</b> {signal.replace(/-/g, " ")}
                  </span>
                ))}
            </div>

            {needing.length > 0 && (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>State</th>
                    <th>Needs</th>
                    <th className="num">Hours since it moved</th>
                  </tr>
                </thead>
                <tbody>
                  {needing.map((h) => (
                    <tr key={h.slug}>
                      <td className="id">
                        <Link href={`/tenants/${h.slug}`}>{h.slug}</Link>
                      </td>
                      <td className="slug">{h.state}</td>
                      <td>
                        <span className="badge warn">{h.attention?.replace(/-/g, " ")}</span>
                      </td>
                      <td className="num">
                        {h.hoursSinceChange === null ? "unknown" : h.hoursSinceChange.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })()}

      {failure ? (
        // GE-022-006. This page used to render its own failure block and the
        // platform page rendered a different one, so "no tenants" and "the
        // registry could not be read" looked alike — the specific confusion
        // that gets an operator to act on an empty list as an empty fleet.
        <ErrorState
          what="the tenant registry"
          detail={failure}
          actions={
            <span className="slug">
              Most likely: the task role is missing an action on the table, or the table does not
              exist in this region.
            </span>
          }
        />
      ) : !configured ? (
        // GE-022-006. Not an error — a deliberate degradation. The file-bound
        // tenants below are real and complete; what is missing is the registry,
        // and naming it is the difference between "the fleet is these four" and
        // "the fleet is these four PLUS whatever the registry holds".
        <PartialDataState what="The fleet" missing={["TENANT_TABLE — the tenant registry"]} />
      ) : (
        <section className="system">
          <header>
            <h2>Provisioned through this console</h2>
            <span className="badge ok">{tenants.length}</span>
          </header>

          {tenants.length === 0 ? (
            <EmptyState
              what="tenants composed through this console"
              because="Composing one registers it in DRAFT: nothing is built, nothing is billed, and no routing changes until its plan is read and approved."
              actions={
                <Link className="primary-action" href="/tenants/new">
                  Compose a tenant
                </Link>
              }
            />
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Slug</th>
                  <th>Name</th>
                  <th>State</th>
                  <th>Isolation</th>
                  <th>Cost note</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.slug}>
                    <td className="id">
                      <Link href={`/tenants/${t.slug}`}>{t.slug}</Link>
                    </td>
                    <td>{t.displayName}</td>
                    <td>
                      <span className={`badge ${SERVING.has(t.state) ? "ok" : "warn"}`}>{t.state}</span>
                    </td>
                    <td>{t.isolation}</td>
                    {/* Never render a paused tenant as free. GE-103-012. */}
                    <td className="slug">{RESIDUAL_COST[t.state] ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tenants.length > 0 && (
            <Link className="primary-action" href="/tenants/new">
              Compose a tenant
            </Link>
          )}
        </section>
      )}

      <section className="system">
        <header>
          <h2>Configured by file</h2>
          <span className="badge">{TENANT_BINDINGS.length}</span>
        </header>
        <p>
          These predate the registry and are bound in <code>blueprints/</code>. They are listed
          separately because they were not provisioned through this console, and showing them in the
          same table would imply a lifecycle they never went through.
        </p>
        <table className="grid">
          <tbody>
            {TENANT_BINDINGS.map((b) => (
              <tr key={b.slug}>
                <td className="id">{b.slug}</td>
                <td>{b.displayName}</td>
                <td className="slug">{b.blueprintId}</td>
                <td className="slug">
                  {registeredSlugs.includes(b.slug) ? "in the registry" : "not adopted"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {adoptable.length > 0 && registryConfigured() && (
          <AdoptForm bindings={adoptable} plans={planOptions} regions={placeableRegions()} />
        )}
      </section>
    </>
  )
}
