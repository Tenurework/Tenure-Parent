import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { getTenant, registryConfigured } from "@/lib/registry"
import { DynamoConfigStore } from "@/lib/config-store"
import { editableDomains, reservedDomains, withheldDomains } from "@/lib/editable-config"
import { compareRevisions, dependantsOf, dependencyGraph, renderComparison, summarise } from "@/lib/revisions"
import { MODULES } from "@tenure/modules"
import { resolveConfig, type ConfigLayer, type OptionPrice } from "@tenure/configuration"
import { REGISTRY, layersFor } from "@tenure/platform-config"
import { toDecimal, type Money } from "@tenure/finops"
import { EmptyState } from "@/components/states"
import { RollbackControls } from "./RollbackControls"
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
/** Amount as a decimal string. `half-even` because this is a display total. */
function amount(value: Money): string {
  return `${toDecimal(value, "half-even")} ${value.currency}`
}

/**
 * A field's price, as one line an operator reads without doing arithmetic.
 *
 * Both halves are always shown, even the zero one: §7 asks for a per-seat AND a
 * whole-organisation figure, and dropping the zero would leave the reader to
 * guess whether it is nothing or unstated.
 */
function priceLabel(price: OptionPrice): string {
  if (price.perSeatMinor === 0 && price.perOrgMinor === 0) {
    return `included — ${price.includedBecause ?? "no reason recorded"}`
  }
  const seat = `${(price.perSeatMinor / 100).toFixed(2)} ${price.currency} per seat`
  const org = `${(price.perOrgMinor / 100).toFixed(2)} ${price.currency} for the organisation`
  return `${seat} · ${org}, per month`
}

/**
 * How many seats the running total is quoted for.
 *
 * Off the query string, because there is nowhere else it could honestly come
 * from: no seat count is recorded against a tenant anywhere in the registry, and
 * a number invented here would be a number on a quote that nobody chose. The
 * form below lets the operator state it, and `runningCost.seats` echoes back
 * whichever number was used.
 */
function seatsFrom(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : 1
}

export default async function ConfigurationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (!session?.user?.email) redirect("/signin")
  if (!isOperator(session.user.email)) return <PermissionDeniedState />

  const { slug } = await params
  const seats = seatsFrom((await searchParams).seats)
  if (!registryConfigured()) {
    return <PartialDataState what="Configuration" missing={["TENANT_TABLE — the tenant registry"]} />
  }

  const tenant = await getTenant(slug)
  if (!tenant) notFound()

  const store = new DynamoConfigStore()
  const history = await store.history(slug)
  const latest = history.length === 0 ? null : history[history.length - 1]
  const domains = editableDomains()
  const revisions = summarise(history)
  const graph = dependencyGraph(MODULES)

  // The most recent change, compared. Two revisions is the common question —
  // "what did the last publication actually do" — and it needs no controls.
  const previous = history.length >= 2 ? history[history.length - 2] : null
  const lastChange = previous && latest ? renderComparison(compareRevisions(previous, latest)) : null

  /* ------------------------------------------------------------- §7 pricing --
   * What this tenant's configuration costs, per seat and for the organisation.
   *
   * The number comes from the RESOLVER, not from summing the fields rendered
   * below. Two places that both compute a total are two totals, and the one on
   * the screen would be the one nobody validated — while the engine's is the one
   * a contract would be written against.
   *
   * `collectProblems`, because a tenant whose published overlay no longer
   * validates must still see a page: the problems are already surfaced by the
   * editor, and a 500 here would take the whole configuration screen out over a
   * pricing panel.
   */
  const fileLayers = layersFor(slug)
  const layers: ConfigLayer[] = [
    ...fileLayers,
    ...(latest
      ? [
          {
            scope: "tenant" as const,
            id: slug,
            label: `revision ${latest.revision}`,
            values: latest.values,
          },
        ]
      : []),
  ]
  const { config: resolved } = resolveConfig(REGISTRY, layers, { collectProblems: true, seats })
  const runningCost = resolved?.runningCost ?? null

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
              // NEXT-SESSION §7 — every option carries its price, at the moment
              // it is being chosen rather than on a summary somebody has to go
              // and find.
              price: priceLabel(f.price),
            })),
          }))}
        />
      </section>

      <section className="system">
        <header>
          <h2>What this costs</h2>
          <span className="badge">{runningCost ? amount(runningCost.total) : "not resolved"}</span>
        </header>
        <p>
          Every option carries a price — per seat and for the whole organisation — and this is the
          running total for the configuration as published, so the cost is never a surprise at the
          end. The figures come from the configuration resolver, not from adding up the boxes above:
          two places that both compute a total are two totals.
        </p>

        {!runningCost ? (
          <PartialDataState
            what="The running total"
            missing={[
              "a configuration that resolves — the published revision has problems, listed by the editor above",
            ]}
          />
        ) : (
          <>
            <form method="get" className="field">
              <label htmlFor="seats">Seats</label>
              <input id="seats" name="seats" type="number" min="1" defaultValue={runningCost.seats} />
              <button type="submit">Re-quote</button>
              <p className="hint">
                No seat count is recorded against a tenant anywhere in the registry, so this one is
                stated rather than guessed. The total below is for exactly{" "}
                <b>{runningCost.seats}</b> seat{runningCost.seats === 1 ? "" : "s"}.
              </p>
            </form>

            <div className="chips">
              <span className="chip">
                <b>{amount(runningCost.perSeat)}</b> per seat
              </span>
              <span className="chip">
                <b>{amount(runningCost.organization)}</b> for the organisation
              </span>
              <span className="chip">
                <b>{amount(runningCost.total)}</b> running total, per month
              </span>
            </div>

            {runningCost.lines.length === 0 ? (
              <EmptyState
                what="charged options"
                because="This tenant is on the platform defaults for every option that carries a charge, so there is nothing on the quote yet."
              />
            ) : (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Option</th>
                    <th className="num">Per seat</th>
                    <th className="num">Organisation</th>
                    <th className="num">At {runningCost.seats} seats</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {runningCost.lines.map((line) => (
                    <tr key={line.key}>
                      <td className="id">{line.key}</td>
                      <td className="num">{amount(line.perSeat)}</td>
                      <td className="num">{amount(line.organization)}</td>
                      <td className="num">{amount(line.total)}</td>
                      <td className="slug">{line.includedBecause ?? "charged"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="system">
        <header>
          <h2>History</h2>
          <span className="badge">{revisions.length}</span>
        </header>
        {revisions.length === 0 ? (
          <EmptyState
            what="published revisions"
            because="Nothing has been published for this tenant yet. The first publication has nothing to roll back to, and says so."
          />
        ) : (
          <>
            <table className="grid">
              <thead>
                <tr>
                  <th>Revision</th>
                  <th>Published</th>
                  <th>By</th>
                  <th className="num">Keys touched</th>
                  <th>Rolls back to</th>
                </tr>
              </thead>
              <tbody>
                {[...revisions].reverse().map((r) => (
                  <tr key={r.revision}>
                    <td className="id">{r.revision}</td>
                    <td className="slug">{r.publishedAt}</td>
                    <td className="slug">{r.publishedBy}</td>
                    <td className="num">{r.changed}</td>
                    <td className="slug">{r.rollbackTo ?? "nothing — the first"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {lastChange && (
              <>
                <h3>What the last publication changed</h3>
                <pre className="state-detail">{lastChange}</pre>
              </>
            )}

            <RollbackControls slug={slug} revisions={revisions.map((r) => r.revision)} live={latest!.revision} />
          </>
        )}
      </section>

      <section className="system">
        <header>
          <h2>Module dependencies</h2>
          <span className="badge">{graph.edges.length} edges</span>
        </header>
        <p>
          Rendered as text rather than a canvas: a drawn graph has no keyboard
          path, no screen-reader description and nothing the layout suite can
          measure. For a graph this small the accessible rendering is the better
          one.
        </p>
        <dl className="kv">
          {graph.nodes.map((node) => {
            const breaks = dependantsOf(MODULES, node)
            return (
              <div key={node} style={{ display: "contents" }}>
                <dt>{node}</dt>
                <dd>
                  {graph.edges.filter((e) => e.from === node).map((e) => e.to).join(", ") || "no dependencies"}
                  {breaks.length > 0 && (
                    <span className="slug"> · disabling it breaks {breaks.join(", ")}</span>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
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
