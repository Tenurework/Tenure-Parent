import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { getTenant, registryConfigured } from "@/lib/registry"
import { DynamoConfigStore } from "@/lib/config-store"
import { editableDomains, reservedDomains, withheldDomains } from "@/lib/editable-config"
import { PartialDataState, PermissionDeniedState } from "@/components/states"
import { ConfigurationEditor } from "./ConfigurationEditor"

export const dynamic = "force-dynamic"

/**
 * GE-032-001 — the tenant configuration editor.
 *
 * Which fields exist is derived from the domain registry and the platform
 * definitions, never listed here. Three of the fourteen surfaces the item names
 * have keys today; the other eleven are shown as reserved or withheld with the
 * reason, because an administrator who cannot find where to change something
 * deserves to be told it is not theirs to change rather than left searching.
 */
export default async function ConfigurationPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth()
  if (!session?.user?.email) redirect("/signin")
  if (!isOperator(session.user.email)) return <PermissionDeniedState />

  const { slug } = await params
  if (!registryConfigured()) {
    return <PartialDataState what="Configuration" missing={["TENANT_TABLE — the tenant registry"]} />
  }

  const tenant = await getTenant(slug)
  if (!tenant) notFound()

  const latest = await new DynamoConfigStore().latest(slug)
  const domains = editableDomains()

  return (
    <>
      <h1>{tenant.manifest.displayName}</h1>
      <p className="slug">
        <Link href={`/tenants/${slug}`}>← back to the tenant</Link>
      </p>

      <section className="system">
        <header>
          <h2>Configuration</h2>
          <span className="badge">{latest ? `revision ${latest.revision}` : "never published"}</span>
        </header>
        <p>
          Every change is planned before it is published: the diff, the lint findings and the impact
          are shown for review, and a second identity must approve. Nothing is written except through
          the engine&rsquo;s one canonical path.
        </p>

        <ConfigurationEditor
          slug={slug}
          domains={domains.map((d) => ({
            id: d.domain.id,
            governs: d.domain.governs,
            fields: d.fields.map((f) => ({
              key: f.key,
              description: f.description,
              input: f.input,
              defaultValue: String(f.defaultValue),
              current: latest?.values[f.key] === undefined ? null : String(latest.values[f.key]),
            })),
          }))}
        />
      </section>

      <section className="system">
        <header>
          <h2>Not editable yet</h2>
          <span className="badge">{reservedDomains().length}</span>
        </header>
        <p>
          These are yours to configure and have no settings yet. They appear here rather than being
          hidden, so the gap is visible instead of looking like an omission.
        </p>
        <dl className="kv">
          {reservedDomains().map((d) => (
            <div key={d.id} style={{ display: "contents" }}>
              <dt>{d.id}</dt>
              <dd>
                {d.governs} <span className="slug">{d.reservedFor}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="system">
        <header>
          <h2>Not yours to change</h2>
          <span className="badge">{withheldDomains().length}</span>
        </header>
        <p>
          Placement, recovery, observability and cost are platform invariants. They are shown with
          the reason rather than omitted, because an administrator searching for a setting that does
          not exist for them has no way to learn that from a blank page.
        </p>
        <dl className="kv">
          {withheldDomains().map((w) => (
            <div key={w.domain.id} style={{ display: "contents" }}>
              <dt>{w.domain.id}</dt>
              <dd>{w.why}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
