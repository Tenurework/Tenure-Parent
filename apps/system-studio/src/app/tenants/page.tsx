import Link from "next/link"
import { redirect } from "next/navigation"

import { TENANT_BINDINGS } from "@tenure/blueprints"
import { RESIDUAL_COST, SERVING, nextStates } from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { authorizeCommand } from "@/lib/authorize"
import { listFleet, registryConfigured, type FleetRow } from "@/lib/registry"
import { INVENTORY_PAGE_ROWS, showingOf } from "@/lib/api/envelope"
import {
  describeFilter,
  isFiltered,
  matchesFilter,
  parseFleetFilter,
  type FleetFilter,
} from "@/lib/fleet-filter"
import { costSource } from "@/lib/cost-source"
import { controlPlaneIdentity } from "@/lib/authorize"
import { adoptableBindings } from "@/lib/adopt"
import { placeableRegions, primeEstate } from "@/lib/cells"
import { PLAN_CATALOG } from "@tenure/provisioning"
import { AdoptForm } from "./AdoptForm"
import {
  EmptyState,
  ErrorState,
  PartialDataState,
  PermissionDeniedState,
  RetryingState,
} from "@/components/states"
import { readWithBackoff, type ReadOutcome } from "@/lib/aws/throttle"
import { HEALTH_REFRESH_MS, observeFleet, type ObservationTarget } from "@/lib/aws/health"
import { fleet } from "@/lib/cells"
import { byUrgency, explainAttention, healthOf, summariseFleet } from "@/lib/fleet-health"

export const dynamic = "force-dynamic"

/**
 * STUDIO-120-003 — what each tenant's observations are taken against.
 *
 * The host and the backup record come from the cell, because that is where they
 * genuinely live: a tenant does not own a certificate, the cell that serves it
 * does, and `lib/cells.ts` already holds `routing.baseUrl` and
 * `backup.lastVerifiedAt`.
 *
 * With more than one cell this returns nulls rather than picking one. The fleet
 * projection (`listTenants`) does not carry placement — it reads STATE rows —
 * and observing a tenant against the wrong cell's certificate would produce a
 * green badge for a host it is not served from. A null renders as `unknown` with
 * the reason, which is the honest answer to a question this projection cannot
 * answer.
 */
function observationTargets(slugs: readonly string[]): readonly ObservationTarget[] {
  let host: string | null = null
  let cellId: string | null = null
  let backup: ObservationTarget["backup"] = null

  try {
    // GE-010-007. `fleet()` is synchronous and its estate facts come from
    // sts:GetCallerIdentity rather than from a compiled-in "us-east-1"/account
    // literal. `primeEstate()` resolves that identity once per process and is
    // awaited by the PAGE before this runs — it cannot be awaited here, because
    // this function is synchronous by construction so that `fleet()` and the
    // observation targets cannot disagree about which cell they describe.
    const cells = fleet()
    if (cells.length === 1) {
      const cell = cells[0]
      cellId = cell.cellId
      backup = { lastVerifiedAt: cell.backup.lastVerifiedAt, retentionDays: cell.backup.retentionDays }
      try {
        host = new URL(cell.routing.baseUrl).host
      } catch {
        host = null
      }
    }
  } catch {
    // FleetMisconfigured. The fleet page must still render — a console that
    // 500s when the cell record is wrong is a console nobody can use to see
    // that the cell record is wrong.
    host = null
  }

  return slugs.map((slug) => ({ slug, host, cellId, backup }))
}

/**
 * The fleet. GE-103-001.
 *
 * Two sources, shown as two sections rather than merged into one list. The
 * file-based bindings predate the registry and are how the live pilot is
 * configured; presenting them as if they had been provisioned through this
 * console would be a claim about how they got there that is not true.
 */
export default async function TenantsPage({
  searchParams,
}: {
  /**
   * The filter, and the page. STUDIO-100-002 keeps both in the URL so a filter
   * is a link an operator can send during an incident rather than component
   * state nobody else can see.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // GE-010-007. Resolved once per process, before anything reads `fleet()`
  // synchronously — the estate's account and region come from
  // sts:GetCallerIdentity, and a page that skipped this would fall back to the
  // environment alone.
  await primeEstate()
  const params = await searchParams
  const filter: FleetFilter = parseFleetFilter(params)
  const pageNumber = Math.max(1, Number(params.page ?? 1) || 1)
  const session = await auth()
  // GE-022-006. Two different facts, told apart. Nobody signed in goes to the
  // sign-in page; somebody signed in who may not read the fleet is refused, with
  // a reason and without naming what they were refused. Sending the second case
  // to /signin told them to go and do the thing they had already done.
  if (!session?.user?.email) redirect("/signin")
  const principalId = session.user.email
  const read = authorizeCommand("tenants.read", { principalId })
  if (!read.allowed) return <PermissionDeniedState />

  /*
   * STUDIO-020-005. Whether the MUTATING controls on this page exist at all.
   *
   * Not "disabled": absent. A disabled control is markup an Auditor's browser
   * still holds, and the form it belongs to still posts — the server action
   * re-decides, so the refusal is real either way, but a console that shows a
   * read-only operator a button they can never use is a console that teaches
   * them to ignore what it says. `authorizeCommand` is asked the same question
   * `composeTenant` and `adoptTenantAction` ask it, so the two cannot disagree.
   */
  const mayCompose = authorizeCommand("tenants.compose", { principalId }).allowed
  const mayAdopt = authorizeCommand("tenants.adopt", { principalId }).allowed


  const configured = registryConfigured()

  // A registry that cannot be read must say so, not 500. In production Next
  // replaces a thrown server error with "Application error: a server-side
  // exception has occurred" and a digest — which tells an operator nothing they
  // can act on, and hides whether the table is missing, the role lacks a
  // permission, or the query is malformed.
  //
  // STUDIO-030-006. And a read that was THROTTLED is not a read that failed.
  // Until this existed both arrived here as `failure` and rendered the sentence
  // below — "the task role is missing an action on the table, or the table does
  // not exist in this region" — which is a good guess for a
  // `ResourceNotFoundException` and completely wrong for a
  // `ProvisionedThroughputExceededException`. The second resolves itself in
  // milliseconds; the message sent an operator to the IAM console.
  //
  // `readWithBackoff` retries only what is worth retrying and reports which of
  // the two it was, so the page renders `RetryingState` for one and
  // `ErrorState` for the other.
  let tenants: FleetRow[] = []
  let failure: string | null = null
  let throttled: Extract<ReadOutcome<never>, { state: "retrying" }> | null = null
  if (configured) {
    // STUDIO-100-001. `listFleet` reads BOTH the STATE and the REGISTRY rows in
    // one pass, plus the DEPLOYMENT sort key and the newest CONFIG revision, so
    // the eleven columns below have a source. Its predecessor projected five
    // attributes and filtered the Scan to STATE rows, which meant the page
    // COULD NOT render owner, plan, cell, release or config revision even if the
    // columns existed — and the one derived signal it did show was fed a
    // literal `hasDeployment: true`.
    const outcome = await readWithBackoff(() => listFleet())
    if (outcome.state === "ok") tenants = outcome.value
    else if (outcome.state === "retrying") throttled = outcome
    else failure = outcome.why
  }

  // A binding is adoptable until it is in the registry. Derived from what the
  // registry actually returned rather than from a flag, so a failed read shows
  // nothing as adoptable instead of offering to adopt something twice.
  const registeredSlugs = tenants.map((t) => t.slug)
  // A throttled read returned nothing, so it is exactly as unsafe a basis for
  // "this binding has not been adopted" as a failed one.
  const adoptable = failure || throttled ? [] : adoptableBindings(registeredSlugs)
  const planOptions = PLAN_CATALOG.map((p) => ({ planId: p.planId, displayName: p.displayName }))

  /*
   * STUDIO-120-003. Health stops being a report on the lifecycle row here.
   *
   * Two AWS reads for the whole fleet, not two per tenant, held for
   * `HEALTH_REFRESH_MS` — so this page costs the same whether it lists one
   * tenant or fifty, and a role that has been refused is refused once per
   * window rather than once per row.
   *
   * Awaited before the tree renders because `healthOf` takes the observations as
   * an argument; computing them inside the JSX would mean a Promise in a
   * synchronous derivation, and the field is required precisely so that a caller
   * cannot quietly skip this and report a fleet healthy on the strength of
   * having asked nothing.
   */
  const observedAt = new Date()
  const observed = await observeFleet(observationTargets(registeredSlugs), { now: observedAt })

  /*
   * Health, computed once and used twice — by the attention panel and by the
   * fleet table's own Health/SLO column and `?signal=` filter.
   *
   * `hasDeployment` is the field this whole change is about. It was the literal
   * `true` for every tenant, which made the `never-deployed` branch in
   * `fleet-health.ts` unreachable from the only production caller there is: the
   * helper's unit test passed because it built its own input, and the page
   * quietly reported every tenant as having a signed artifact. It now comes off
   * the DEPLOYMENT sort key.
   *
   * The two configuration revisions are the drift column's source, and they are
   * the same two records of one fact GE-020-005 is about: what the registry
   * believes the cell applied, and what the configuration store actually holds.
   */
  const health = byUrgency(
    tenants.map((t) =>
      healthOf(
        {
          slug: t.slug,
          state: t.state,
          updatedAt: t.updatedAt,
          hasDeployment: t.hasDeployment,
          observations: observed.get(t.slug) ?? [],
          ...(t.registryConfigRevision !== null
            ? { registryConfigRevision: t.registryConfigRevision }
            : {}),
          ...(t.storeConfigRevision !== null ? { storeConfigRevision: t.storeConfigRevision } : {}),
        },
        observedAt,
      ),
    ),
  )
  const healthBySlug = new Map(health.map((h) => [h.slug, h]))

  // STUDIO-100-002 / STUDIO-030-011. Filter first, then page — paging a
  // filtered list is the only order that lets "showing 25 of 61 matching
  // \"acme\"" be a true sentence.
  const matching = tenants.filter((t) => matchesFilter(t, filter, healthBySlug.get(t.slug)))
  const pageCount = Math.max(1, Math.ceil(matching.length / INVENTORY_PAGE_ROWS))
  const page = Math.min(pageNumber, pageCount)
  const rows = matching.slice((page - 1) * INVENTORY_PAGE_ROWS, page * INVENTORY_PAGE_ROWS)
  /*
   * STUDIO-100-002. Cost per tenant is deliberately NOT charted.
   *
   * `costSource()` returns NOT_CONFIGURED until a Cost and Usage Report exists,
   * and an empty chart in a column headed "actual / forecast" is a chart that
   * says zero. The honest arm renders the reason in the cell instead, so a
   * reader can tell "this tenant costs nothing" from "nobody has connected the
   * bill".
   */
  const cost = await costSource()
  const costNote = cost.state === "CONNECTED" ? "see FinOps" : "no bill connected"

  // The account this control plane holds credentials for. Rendered beside the
  // cell so the cell/account/region column is a placement rather than a name.
  const { accountId } = controlPlaneIdentity()

  const queryFor = (overrides: Record<string, string>) => {
    const next = new URLSearchParams()
    if (filter.q) next.set("q", filter.q)
    if (filter.signal) next.set("signal", filter.signal)
    if (filter.state) next.set("state", filter.state)
    for (const [k, v] of Object.entries(overrides)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    const query = next.toString()
    return query ? `?${query}` : ""
  }

  return (
    <>

      <h1>Tenants</h1>

      {/*
        GE-033-002 / STUDIO-120-003. Fleet health, from the registry AND from
        what was observed of the running system — certificate expiry, alarm
        state, when a backup was last verified. No tenant content is read to
        answer any of it, and a guard fails if that changes.
      */}
      {!failure && configured && tenants.length > 0 && (() => {
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

            {/* The as-of and the cadence, together. A health panel with neither
                is a set of claims that were true at some point. */}
            <p className="slug">
              Observed {observedAt.toISOString()}, re-read every {Math.round(HEALTH_REFRESH_MS / 1000)}s.
              Certificate expiry and alarm state come from AWS; a source that could not be read is
              reported as unobserved rather than counted healthy.
            </p>

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
                  {needing.map((h) => {
                    // Why the badge says what it says. A row reading
                    // "dependency failing" and nothing else is a row an operator
                    // has to leave the page to act on.
                    const why = explainAttention(h)
                    return (
                      <tr key={h.slug}>
                        <td className="id">
                          <Link href={`/tenants/${h.slug}`}>{h.slug}</Link>
                        </td>
                        <td className="slug">{h.state}</td>
                        <td>
                          <span className="badge warn">{h.attention?.replace(/-/g, " ")}</span>
                          {why && (
                            <>
                              <br />
                              <span className="slug">{why}</span>
                            </>
                          )}
                        </td>
                        <td className="num">
                          {h.hoursSinceChange === null ? "unknown" : h.hoursSinceChange.toFixed(0)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
        )
      })()}

      {throttled ? (
        // STUDIO-030-006. The first throttled AWS panel in this console. The
        // registry answered with a "slow down", not a fault, so the remedy is
        // to look again — and the next-attempt time is what makes that a
        // decision rather than a guess. Rendering `ErrorState` here would send
        // the operator to check an IAM policy that was never wrong.
        <RetryingState
          attempt={throttled.attempt}
          of={throttled.of}
          nextAttemptAt={throttled.nextAttemptAt}
          why={`The tenant registry asked this console to back off — ${throttled.why}. Nothing is wrong with the table or the role.`}
        />
      ) : failure ? (
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

          {/*
            STUDIO-100-002. Search and filter, submitted as a GET so the result
            is a URL. Saving a filter is saving the link, which needs no storage
            and makes every filter shareable — the thing an operator actually
            wants from a "saved filter" during an incident.
          */}
          <form className="fleet-filter" method="get" action="/tenants">
            <div className="field">
              <label htmlFor="q">Search</label>
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={filter.q}
                placeholder="slug, name, owner, plan or cell"
              />
            </div>
            <div className="field">
              <label htmlFor="signal">Signal</label>
              <select id="signal" name="signal" defaultValue={filter.signal ?? ""}>
                <option value="">any</option>
                {Object.keys(summariseFleet(health).bySignal).map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/-/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="state">State</label>
              <input id="state" name="state" defaultValue={filter.state ?? ""} placeholder="ACTIVE" />
            </div>
            <button type="submit">Apply</button>
            {isFiltered(filter) && (
              <Link className="slug" href="/tenants">
                Clear
              </Link>
            )}
          </form>

          {tenants.length === 0 ? (
            <EmptyState
              what="tenants composed through this console"
              because="Composing one registers it in DRAFT: nothing is built, nothing is billed, and no routing changes until its plan is read and approved."
              actions={
                mayCompose ? (
                  <Link className="primary-action" href="/tenants/new">
                    Compose a tenant
                  </Link>
                ) : undefined
              }
            />
          ) : matching.length === 0 ? (
            // Two nothings, told apart. `because` is what distinguishes "no
            // tenants exist" from "none match what you asked for", which are the
            // same screen and completely different facts.
            <EmptyState
              what={`tenants ${describeFilter(filter)}`}
              because={`${tenants.length} tenants are registered; none match this filter. Clear it to see them.`}
              actions={
                <Link className="primary-action" href="/tenants">
                  Clear the filter
                </Link>
              }
            />
          ) : (
            <>
              {/* Never let a truncated table read as a complete one. */}
              <p className="slug" data-testid="fleet-count">
                {showingOf(rows.length, matching.length, isFiltered(filter) ? "matching tenants" : "tenants")}
                {isFiltered(filter) ? ` (${describeFilter(filter)}, of ${tenants.length} registered)` : ""}
              </p>

              {/*
                STUDIO-100-001 — sixteen columns, every one of them from the
                registry rather than from a tenant's own database. Three are
                deliberately Probe states rather than blanks: data volume,
                resource count and cost are not facts this control plane holds
                yet, and a blank cell reads as zero.

                Wrapped in `table-scroll` so a table this wide scrolls inside its
                own container rather than scrolling the page, which
                `layout.spec.ts` treats as a defect in its own right at 1440,
                1180, 900 and 320px.
              */}
              <div className="table-scroll">
                <table className="grid fleet">
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th>Owner</th>
                      <th>Lifecycle</th>
                      <th>Plan</th>
                      <th>Cell / account / region</th>
                      <th>Isolation</th>
                      <th>Release / config / schema</th>
                      <th>Health / SLO</th>
                      <th>Last activity</th>
                      <th className="num">Data volume</th>
                      <th className="num">Resources</th>
                      <th className="num">Actual / forecast</th>
                      <th>Drift</th>
                      <th>Blockers</th>
                      <th>Next action</th>
                      <th>Cost note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => {
                      const h = healthBySlug.get(t.slug)
                      const drift =
                        t.registryConfigRevision === null || t.storeConfigRevision === null
                          ? "—"
                          : t.registryConfigRevision === t.storeConfigRevision
                            ? "in step"
                            : `registry ${t.registryConfigRevision} · store ${t.storeConfigRevision}`
                      const next = nextStates(t.state)
                      return (
                        <tr key={t.slug}>
                          <td className="id">
                            <Link href={`/tenants/${t.slug}`}>{t.slug}</Link>
                            <br />
                            <span className="slug">{t.displayName}</span>
                          </td>
                          <td className="slug">
                            {t.owner ?? "not recorded"}
                            {t.ownerSource && (
                              <>
                                <br />
                                <span className="slug">{t.ownerSource.replace(/-/g, " ")}</span>
                              </>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${SERVING.has(t.state) ? "ok" : "warn"}`}>
                              {t.state}
                            </span>
                            {t.lifecycle && <span className="slug"> · {t.lifecycle}</span>}
                          </td>
                          <td className="slug">{t.planId ?? "—"}</td>
                          <td className="slug">
                            {t.cellId ?? "unplaced"}
                            <br />
                            {accountId} · {t.region ?? "—"}
                          </td>
                          <td className="slug">{t.isolation}</td>
                          <td className="slug">
                            {t.release ?? "—"} · rev {t.registryConfigRevision ?? "—"} ·{" "}
                            {t.schemaVersion ?? "not published"}
                          </td>
                          <td>
                            {h ? (
                              <>
                                <span className="badge">{h.attention ?? "nothing to do"}</span>
                                <br />
                                <span className="slug">{h.signals.join(", ")}</span>
                              </>
                            ) : (
                              <span className="slug">unobserved</span>
                            )}
                          </td>
                          <td className="slug">{t.updatedAt || "—"}</td>
                          {/* STUDIO-000-007 probe states. Not blanks: a blank
                              column in a cost table reads as zero, and this
                              console has never measured either of these. */}
                          <td className="num slug">not measured</td>
                          <td className="num slug">not inventoried</td>
                          <td className="num slug">{costNote}</td>
                          <td className="slug">{drift}</td>
                          <td className="slug">
                            {h?.attention
                              ? explainAttention(h) || h.attention.replace(/-/g, " ")
                              : "none"}
                          </td>
                          <td className="slug">
                            {next.length === 0 ? "terminal" : next.join(" / ")}
                          </td>
                          {/* Never render a paused tenant as free. GE-103-012. */}
                          <td className="slug">{RESIDUAL_COST[t.state] ?? ""}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {pageCount > 1 && (
                <p className="slug">
                  Page {page} of {pageCount}
                  {page > 1 && (
                    <>
                      {" · "}
                      <Link href={`/tenants${queryFor({ page: String(page - 1) })}`}>previous</Link>
                    </>
                  )}
                  {page < pageCount && (
                    <>
                      {" · "}
                      <Link href={`/tenants${queryFor({ page: String(page + 1) })}`}>next</Link>
                    </>
                  )}
                </p>
              )}

              {/*
                STUDIO-100-002. The export carries only what THIS operator is
                authorized to see, and writes an audit row naming what left. The
                projection is server-side, in the route — a link that filtered
                client-side would be a link anyone could edit.
              */}
              <p className="slug">
                <a href={`/api/aws/fleet${queryFor({ format: "csv" })}`} download>
                  Export this view as CSV
                </a>{" "}
                — only the tenants your role may read, with an audit row naming what was exported.
              </p>
            </>
          )}

          {tenants.length > 0 && mayCompose && (
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

        {adoptable.length > 0 && registryConfigured() && mayAdopt && (
          <AdoptForm bindings={adoptable} plans={planOptions} regions={placeableRegions()} />
        )}
      </section>
    </>
  )
}
