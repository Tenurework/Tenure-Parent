import Link from "next/link"
import { redirect } from "next/navigation"

import { TENANT_BINDINGS } from "@tenure/blueprints"
import { RESIDUAL_COST, SERVING } from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { listTenants, registryConfigured } from "@/lib/registry"

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
  if (!isOperator(session?.user?.email)) redirect("/signin")

  const configured = registryConfigured()
  const tenants = configured ? await listTenants() : []

  return (
    <>
      <nav className="tabs">
        <Link href="/">Organization systems</Link>
        <span className="here">Tenants</span>
        <Link href="/platform">Platform</Link>
      </nav>

      <h1>Tenants</h1>

      {!configured ? (
        <section className="system">
          <header>
            <h2>Registry unavailable</h2>
            <span className="badge warn">not configured</span>
          </header>
          <p>
            <code>TENANT_TABLE</code> is not set, so no tenant can be composed or read. The table is
            declared in <code>infrastructure/studio/dynamodb.tf</code>; this page degrades rather
            than failing so the rest of the console stays usable.
          </p>
        </section>
      ) : (
        <section className="system">
          <header>
            <h2>Provisioned through this console</h2>
            <span className="badge ok">{tenants.length}</span>
          </header>

          {tenants.length === 0 ? (
            <p>
              None yet. <Link href="/tenants/new">Compose one</Link> — it is registered in{" "}
              <code>DRAFT</code> and nothing is built until the plan is approved.
            </p>
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

          <p style={{ marginTop: "1rem" }}>
            <Link href="/tenants/new">Compose a new tenant →</Link>
          </p>
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
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
