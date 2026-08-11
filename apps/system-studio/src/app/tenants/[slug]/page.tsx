import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { getTenantBinding } from "@tenure/blueprints"
import { buildSystem, compatibilityFor, planPromotion } from "@tenure/platform-config"
import {
  REQUIRES_OWNER,
  classify,
  needsApproval,
  nextStates,
  planFor,
  requirementsFor,
} from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { authorizeCommand, controlPlaneIdentity } from "@/lib/authorize"
import { ArchivedState, PendingDeletionState, PermissionDeniedState } from "@/components/states"
import {
  ARCHIVED_STATES,
  NO_RETAINED_AWS_OBSERVATION,
  PURGE_STATES,
  observedFor,
  residualFindings,
  riskOf,
} from "@/lib/tenant-state"
import { fleet, primeEstate } from "@/lib/cells"
import { observeFleet } from "@/lib/aws/health"
import { compareDesiredToActual, desiredFromDeployment } from "@/lib/aws/drift"
import { estateInventory } from "@/lib/aws/inventory"
import { retainedObservation, retainedReadingsForTenant } from "@/lib/aws/retained"
import { getTenant, registryConfigured } from "@/lib/registry"
import { dynamoAuditLedger } from "@/lib/audit-ledger"
import { DeploymentPanel } from "@/components/DeploymentPanel"
import { EvidencePanel } from "@/components/EvidencePanel"
import { REFUSED_OPERATIONS } from "@/lib/command-handlers"
import { AdvanceControls } from "./AdvanceControls"

export const dynamic = "force-dynamic"

/** The host part of a cell's base URL, or null when there is not one to read. */
function hostOf(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null
  try {
    return new URL(baseUrl).host
  } catch {
    return null
  }
}

const money = (cents: number) =>
  cents === 0 ? "$0 marginal" : `$${(cents / 100).toFixed(2)}/month`

/**
 * What would happen if this tenant's system were released right now.
 *
 * Assembled through `buildSystem` — the same function the cell uses — rather
 * than re-derived here. The console used to compute its own module and
 * configuration resolution for a tenant, which is how a preview and a
 * production system come to differ while both look correct.
 *
 * A projection, and nothing more: no artifact is written and no state is
 * advanced. `planPromotion` walks the real state machine and reports where it
 * stops, so the gates shown are the gates that would actually refuse — not a
 * second list maintained beside them.
 *
 * Returns null for a tenant with no file binding. Every tenant composed in this
 * console is one: `buildSystem` reads `blueprints/`, and a tenant that lives
 * only in the registry has nothing there to read. Saying so beats a caught
 * exception that renders as an empty panel.
 */
function releaseReadiness(slug: string, cellId: string | undefined) {
  if (!getTenantBinding(slug)) return null

  const cells = fleet()
  const cell = cells.find((c) => c.cellId === cellId) ?? cells[0]
  if (!cell) return null

  const at = new Date().toISOString()

  // The console assembled this, not the operator reading the page. Recording
  // the operator as the author would make them the author AND the approver, and
  // the release state machine correctly refuses that — producing a gate that
  // can never be passed by whoever is looking at it.
  const author = "system-studio@tenure"

  const assembled = buildSystem(slug, {
    actor: author,
    at,
    notes: `Release readiness for ${slug}, computed by the System Studio.`,
    // What the CELL says it is migrated to. A candidate pinning a migration the
    // cell has not applied is refused here rather than discovered by the cell.
    appliedMigrations: [cell.schemaVersion],
  })

  // The same system as the cell is actually running it: identical in every
  // respect except the schema it is pinned to. When the cell is behind the
  // engine, that is the drift an approver has to see before promoting, and it
  // is invisible in every other panel on this page.
  const running = buildSystem(slug, {
    actor: author,
    at,
    notes: `The system as ${cell.cellId} is running it.`,
    schemaVersion: cell.schemaVersion,
  }).candidate

  /**
   * The engine version the cell reports.
   *
   * `CellRecord.release` is what the fleet records, and in this estate it is
   * the schema version — which is not an engine version and will not parse.
   * `checkCompatibility` then fails closed, which is correct and is the point:
   * a cell that cannot say how old it is cannot claim to be new enough. The
   * override exists so setting the fact fixes it, rather than the check being
   * softened until it passes.
   */
  const engineVersion = process.env.CELL_ENGINE_VERSION?.trim() || cell.release

  const compatibility = compatibilityFor(slug, engineVersion)

  const plan = assembled.candidate
    ? planPromotion({
        candidate: assembled.candidate,
        validation: assembled.validation,
        compatibility,
        approver: "an operator other than the author",
        at,
        previous: running,
      })
    : null

  return { assembled, cell, engineVersion, compatibility, plan }
}

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
  // STUDIO-000-006. `fleet()` used to default the account, region and partition
  // to `us-east-1` and a literal account id; it now THROWS `FleetMisconfigured`
  // rather than inventing an estate. That is the right behaviour and it made
  // every unprimed caller a runtime failure — this page reaches `fleet()` twice,
  // at :66 through `releaseReadiness` and at :220, and was never primed. Awaited
  // here, once, before anything reads it, exactly as app/page.tsx:93 and
  // platform/page.tsx:84 do.
  await primeEstate()

  const session = await auth()
  const principalId = session?.user?.email
  const { slug } = await params

  // STUDIO-020-006. Named resource, named action, named tenant. The read is
  // decided before anything is fetched, and the WRITE is decided separately
  // below — against the account and region the registry says this tenant is
  // actually placed in, which is the whole point of the axes existing.
  const read = authorizeCommand("tenant.lifecycle.read", { principalId, tenantId: slug })
  if (read.reason === "NO_PRINCIPAL") redirect("/signin")
  if (!read.allowed) return <PermissionDeniedState />
  if (!registryConfigured()) notFound()

  const tenant = await getTenant(slug)

  if (!tenant) notFound()

  const plan = planFor(tenant.manifest)
  const moves = nextStates(tenant.state)
  /**
   * WRK-120-005 — what this tenant is holding, from facts the registry owns.
   *
   * `serving` is read off the published artifact rather than off the lifecycle
   * state, because the artifact IS the routing switch: `ACTIVATING` publishes
   * one with `serving: true` and that is what makes a cell answer for the
   * tenant. Reading the state instead would report a tenant as not serving the
   * moment somebody moved the row, while the cell was still routing at it.
   */
  const observed = observedFor({
    isolation: tenant.manifest.isolation,
    hasDeployment: tenant.deployment !== undefined,
    serving: tenant.deployment?.serving === true,
    evidenceRecords: tenant.evidence.length,
  })

  /**
   * STUDIO-080-006 — desired versus actual, computed here because this is where
   * the desired side already lives.
   *
   * `estateInventory()` is the same function `/platform/estate` calls, so the
   * two surfaces cannot disagree about what AWS said. The four readings are
   * passed as the `AwsRead` union rather than flattened to arrays: flattening
   * would turn a denied surface into "no resources", and `compareDesiredToActual`
   * would then report every desired resource as missing and offer a plan to
   * recreate it — the failure the whole module exists to refuse.
   */
  const estate = await estateInventory()
  const retained = retainedObservation(
    await retainedReadingsForTenant(tenant.slug, undefined, {
      identity: estate.identity,
      tagged: estate.tagged,
    }),
  )
  const residual = residualFindings(tenant.state, observed, retained)
  const driftReport = compareDesiredToActual(
    tenant.deployment
      ? desiredFromDeployment({
          slug: tenant.slug,
          serving: tenant.deployment.serving === true,
          isolation: tenant.manifest.isolation,
          // The seat, from the manifest's own ownership rather than a person's
          // name — a role can answer for a resource after somebody leaves.
          ownerSeat: tenant.manifest.isolation === "pooled" ? "platform" : `tenant-lead:${tenant.slug}`,
        })
      : [],
    [estate.ecsServices, estate.databases, estate.distributions, estate.certificates],
    { now: new Date(), slug: tenant.slug },
  )
  /*
   * STUDIO-140-006. Every attempt, not only every move that succeeded.
   *
   * Read here rather than lazily inside the section, because a ledger that
   * renders only when somebody scrolls is a ledger the layout suite never
   * measures and nobody notices going empty.
   */
  const ledger = (await dynamoAuditLedger().read(tenant.slug)).slice(-20).reverse()
  const readiness = releaseReadiness(tenant.slug, tenant.registry?.placement.cellId)

  /*
   * STUDIO-020-005/006 — the two decisions that make this page differ by role.
   *
   * Both are scoped to where this tenant actually lives: the region the
   * registry recorded at placement, and the AWS account of the cell holding it.
   * A tenant placed outside the account this control plane resolved for itself
   * is refused on the residency axis before the role is even consulted, which
   * is the cheap local half of GE-010-007 — the console holds credentials for
   * one account, so a mutation aimed at another is a bug or an attempt.
   */
  const identity = controlPlaneIdentity()
  const placement = tenant.registry?.placement
  const placedCell = fleet().find((c) => c.cellId === placement?.cellId)

  /**
   * STUDIO-120-003 — what was observed of the system serving this tenant, as
   * distinct from what the registry believes about it.
   *
   * This page can resolve the cell properly, which the fleet listing cannot: the
   * registry record carries `placement.cellId`, so the certificate and backup
   * observations are taken against the cell this tenant is actually on rather
   * than against whichever one the fleet happens to hold. `placedCell` is the
   * same one the authorization decisions above are scoped to, deliberately —
   * observing a tenant against a cell the console would refuse to act on would
   * be a health badge for a system nobody here can touch.
   *
   * Rendered whole, including the sources that came back `unknown`, because the
   * estate has three FAILED certificates and no verified backup and a page that
   * showed only the answers it had would present exactly the silence this item
   * exists to remove.
   */
  const observedAt = new Date()
  const estateObservations =
    (
      await observeFleet(
        [
          {
            slug: tenant.slug,
            host: hostOf(placedCell?.routing.baseUrl),
            cellId: placedCell?.cellId ?? null,
            backup: placedCell
              ? {
                  lastVerifiedAt: placedCell.backup.lastVerifiedAt,
                  retentionDays: placedCell.backup.retentionDays,
                }
              : null,
          },
        ],
        { now: observedAt },
      )
    ).get(tenant.slug) ?? []

  const advance = authorizeCommand("tenant.lifecycle.advance", {
    principalId,
    tenantId: tenant.slug,
    region: placement?.region,
    accountId: placedCell?.awsAccountId,
  })
  // STUDIO-080-003. Deep links to the AWS console, for the Cloud Platform
  // Engineer and the Emergency Responder only. Nothing on this page depends on
  // them: they are a shortcut for somebody already entitled to be in the
  // account, not a control surface.
  const awsConsole = authorizeCommand("aws.console.open", {
    principalId,
    region: placement?.region,
    accountId: placedCell?.awsAccountId,
  })
  // Null when neither the registry record nor this process can say where it is.
  // The section below is then not rendered at all, rather than linking at
  // `https://null.console.aws.amazon.com` — a deep link to nowhere is worse
  // than no deep link, because it looks like the console is telling you
  // something.
  const consoleRegion = placement?.region ?? identity.region

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

        {/* WRK-120-005. The note, and what it is wrong about. Rendering the
            sentence alone is what made the claim unfalsifiable: it says what
            this state is SUPPOSED to retain, and until the reconciliation
            existed nothing compared it to what this tenant actually holds. */}
        {residual && (
          <>
            <p className="refused">{residual.note}</p>
            {residual.unexplained.length > 0 && (
              <p className="error">
                Retained beyond that note, and still billing:{" "}
                {residual.unexplained.join(", ")}. Observed from{" "}
                {tenant.manifest.isolation} placement, the published artifact,{" "}
                {tenant.evidence.length} evidence records and live retained-resource AWS reads —
                not from anything inside the tenant.
              </p>
            )}
            {residual.overclaimed.length > 0 && (
              <p className="refused">
                Claimed by that note and not held here: {residual.overclaimed.join(", ")}. An
                operator told they are paying for something they are not stops believing the panel
                that carries the real finding.
              </p>
            )}
            {residual.retainedSources.length > 0 && (
              <p className="slug">
                Live retained-resource sources: {residual.retainedSources.join("; ")}.
              </p>
            )}
            {residual.retainedUnknown.length > 0 && (
              <p className="refused">
                Live retained-resource reads unobserved: {residual.retainedUnknown.join("; ")}.
              </p>
            )}
          </>
        )}

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

        {/* GE-032-001. The editor is a page rather than a panel here: a
            configuration change is planned, reviewed and approved, which does
            not fit beside a state machine. */}
        <p className="slug">
          <Link href={`/tenants/${tenant.slug}/configuration`}>Configuration →</Link>
        </p>

        {/*
          Absent, not disabled. An Auditor/Read Only operator holds
          `tenant.lifecycle:read` and nothing else, so the controls that move a
          tenant's lifecycle are not rendered into their page at all — and the
          server action re-decides the same command, so a hand-crafted POST is
          refused too. The sentence below says the refusal happened rather than
          leaving a reader wondering where the buttons went; it names no
          destination, because listing what somebody may not do is a map of the
          surface for whoever is looking for one.
        */}
        {advance.allowed ? (
          <AdvanceControls
            slug={tenant.slug}
            // STUDIO-060-002. What this page was looking at when it rendered.
            // `gate` compares both against the registry at submission time, so
            // a move decided against a page somebody left open is refused
            // rather than applied to a tenant that has since moved. The two are
            // exactly what the action's `current()` reads back.
            expectedVersion={tenant.history.length}
            expectedDigest={tenant.digest}
            moves={moves.map((to) => ({
              to,
              needsApproval: needsApproval(tenant.state, to),
              // WRK-120-005. The destinations that cannot be entered with
              // nobody named as responsible afterwards. Read from the engine,
              // like `needsApproval`, so the field an operator is shown is
              // exactly the field the engine will refuse without.
              needsOwner: REQUIRES_OWNER.has(to),
              // Computed here, on the server, from the transition graph itself.
              // Reversibility especially: a hand-written label saying "this can
              // be undone" is a claim, and the graph is the fact.
              risk: riskOf(tenant.slug, tenant.state, to, NO_RETAINED_AWS_OBSERVATION, observed),
              // STUDIO-060-007. The token the gate in `runAdvance` will compare,
              // produced by the same function that compares it. Null for a class
              // that needs none, which is what hides the field.
              typedConfirmation: requirementsFor(
                classify({ surface: "tenant-lifecycle", action: to, target: tenant.slug }),
                tenant.slug,
              ).typedConfirmation,
            }))}
          />
        ) : (
          <p className="refused" data-testid="lifecycle-read-only">
            Read only. Moving this tenant&rsquo;s lifecycle is not yours to do.
          </p>
        )}
      </section>

      {/* STUDIO-080-003 — console deep links, gated. */}
      {awsConsole.allowed && consoleRegion !== null && (
        <section className="system">
          <header>
            <h2>AWS console</h2>
            <span className="badge quiet">{awsConsole.role}</span>
          </header>
          <p>
            Shortcuts into the account this tenant is placed in, for an operator who is already
            entitled to be there. Nothing in the console depends on them: every change this platform
            makes goes through a typed command with a plan, an approval and evidence, and a link to
            a service page is a place to look rather than a place to act.
          </p>
          <dl className="kv">
            <dt>Account</dt>
            <dd className="id">{placedCell?.awsAccountId ?? identity.accountId}</dd>
            <dt>Region</dt>
            <dd className="id">{consoleRegion}</dd>
            <dt>Services</dt>
            <dd>
              <a
                href={`https://${consoleRegion}.console.aws.amazon.com/ecs/v2/clusters?region=${consoleRegion}`}
                rel="noreferrer noopener"
                target="_blank"
              >
                ECS clusters
              </a>{" "}
              ·{" "}
              <a
                href={`https://${consoleRegion}.console.aws.amazon.com/cloudwatch/home?region=${consoleRegion}#logsV2:log-groups`}
                rel="noreferrer noopener"
                target="_blank"
              >
                CloudWatch log groups
              </a>
            </dd>
          </dl>
        </section>
      )}

      {/* STUDIO-120-003. Every source, including the ones nobody can read. */}
      <section className="system">
        <header>
          <h2>Observed</h2>
          <span
            className={`badge ${
              estateObservations.some((o) => o.status === "failing")
                ? "warn"
                : estateObservations.every((o) => o.status === "unknown")
                  ? "warn"
                  : "ok"
            }`}
          >
            {estateObservations.filter((o) => o.status === "unknown").length} of{" "}
            {estateObservations.length} unobserved
          </span>
        </header>
        <p>
          What was seen of the system serving this tenant, as of {observedAt.toISOString()}. None of
          it is read from the tenant&apos;s database — a certificate&apos;s expiry, an alarm&apos;s
          state and a verified backup are all facts the control plane can establish from outside.
          Sources that could not be read say so; an unread source is never counted healthy.
        </p>
        <table className="grid">
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>What was seen</th>
            </tr>
          </thead>
          <tbody>
            {estateObservations.map((o) => (
              <tr key={o.source}>
                <td className="id">{o.source}</td>
                <td>
                  <span className={`badge ${o.status === "ok" ? "ok" : "warn"}`}>{o.status}</span>
                </td>
                <td className="slug">{o.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

      {readiness && (
        <section className="system">
          <header>
            <h2>Release</h2>
            <span className="badge">
              {readiness.plan ? `reaches ${readiness.plan.reachable}` : "no candidate"}
            </span>
          </header>
          <p>
            What would happen if this system were released now, assembled by the same function the
            cell uses. Nothing here publishes anything: the gates are walked, not passed.
          </p>

          <dl className="kv">
            <dt>candidate</dt>
            <dd className="id">{readiness.assembled.candidate?.releaseId ?? "— did not validate"}</dd>
            <dt>checksum</dt>
            <dd className="id">{readiness.assembled.candidate?.checksum ?? "—"}</dd>
            <dt>signature</dt>
            <dd>
              {readiness.assembled.candidate?.signature
                ? `${readiness.assembled.candidate.signature.algorithm} by ${readiness.assembled.candidate.signature.keyId}`
                : "unsigned — set RELEASE_SIGNING_KEY_ID and RELEASE_SIGNING_SECRET; an unsigned release cannot be approved"}
            </dd>
            <dt>schema</dt>
            <dd>
              {readiness.assembled.schemaVersion}
              {readiness.assembled.schemaVersion === readiness.cell.schemaVersion
                ? ""
                : ` · ${readiness.cell.cellId} is at ${readiness.cell.schemaVersion}`}
            </dd>
            <dt>engine</dt>
            <dd>
              {readiness.engineVersion} on {readiness.cell.cellId}
            </dd>
            <dt>modules</dt>
            <dd>{readiness.assembled.moduleKeys.join(", ")}</dd>
          </dl>

          {readiness.assembled.validation.problems.map((p) => (
            <p className="refused" key={`${p.area}-${p.detail}`}>
              [{p.area}] {p.detail}
            </p>
          ))}

          {!readiness.compatibility.compatible && (
            <>
              <p className="refused">
                The cell cannot honour this tenant&apos;s configuration, so the release is refused
                rather than half-applied.
              </p>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Needs</th>
                    <th>Running</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {readiness.compatibility.problems.map((p) => (
                    <tr key={p.key}>
                      <td className="id">{p.key}</td>
                      <td>{p.requires}</td>
                      <td>{p.running}</td>
                      <td className="slug">{p.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {readiness.plan && (
            <table className="grid">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Reached</th>
                </tr>
              </thead>
              <tbody>
                {readiness.plan.steps.map((s) => (
                  <tr key={s.to}>
                    <td className="id">{s.to}</td>
                    <td>
                      {s.reached ? (
                        "✓"
                      ) : (
                        <>
                          ✗<br />
                          <span className="slug">{s.refusedBecause}</span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {readiness.plan && readiness.plan.diff.length > 0 && (
            <>
              <h3>
                Against what {readiness.cell.cellId} is running{" "}
                <span className="badge">
                  {readiness.plan.breaking.length} breaking of {readiness.plan.diff.length}
                </span>
              </h3>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Change</th>
                    <th>Before</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {readiness.plan.diff.map((d) => (
                    <tr key={`${d.field}-${d.change}`}>
                      <td className="id">{d.field}</td>
                      <td>
                        {d.change}
                        {readiness.plan!.breaking.includes(d) && (
                          <span className="badge warn"> breaking</span>
                        )}
                      </td>
                      <td className="slug">{String(d.before ?? "—")}</td>
                      <td className="slug">{String(d.after ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {/*
        STUDIO-080-006 — what the artifact says should exist, against what AWS
        actually reports.

        The comparison takes the `AwsRead` union directly rather than a plain
        array, which is what makes the one rule below expressible: a surface the
        engine's role could not read produces severity `unknown` and NO
        remediation. "We were not allowed to look" must never turn into a plan to
        recreate a resource that already exists — that plan is how a denied
        DescribeServices becomes a second load balancer, or a CreateDBInstance
        beside a live database.
      */}
      {tenant.deployment && (
        <section className="system" data-surface="drift">
          <header>
            <h2>Drift</h2>
            <span className="badge warn">{driftReport.items.length}</span>
          </header>
          <p>
            Desired comes from the published artifact below; actual comes from a live read made
            when this page rendered.
            {driftReport.partial
              ? " At least one surface could not be read, so this report is partial and says which."
              : " Every surface answered."}
          </p>
          {driftReport.items.length === 0 ? (
            <p>Nothing desired by the artifact is missing from what AWS reports.</p>
          ) : (
            <div className="scroll-x">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>Severity</th>
                    <th>Owner</th>
                    <th>Seen</th>
                    <th>Remediation</th>
                  </tr>
                </thead>
                <tbody>
                  {driftReport.items.map((item) => (
                    <tr key={item.resourceKey} data-severity={item.severity}>
                      <td className="id">{item.resourceKey}</td>
                      <td>{item.severity}</td>
                      <td>{item.owner}</td>
                      <td className="num">
                        {item.occurrences}× since {item.firstSeenAt.slice(0, 10)}
                      </td>
                      <td>
                        {!item.remediation ? (
                          <>
                            No plan is offered.{" "}
                            {"unknown" in item.actual && item.actual.unknown
                              ? item.actual.because
                              : "the actual state could not be read"}
                            . Recreating a resource nobody was allowed to look at is how a denial
                            becomes a duplicate.
                          </>
                        ) : item.remediation.safe ? (
                          item.remediation.describe
                        ) : (
                          <>
                            {item.remediation.refusedBecause} A human runs this themselves:{" "}
                            <code>{item.remediation.awsCliCommand}</code>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* STUDIO-070-009. Moved into a component for the reason the evidence
          panel was: the projection an operator reads is then the one a test can
          render, so a producer that stops forwarding the previous artifact's
          digest reds a rendered surface rather than passing unnoticed. The
          signature and the rollback target were both absent from the block this
          replaces — the first while the heading called the artifact signed. */}
      {tenant.deployment && <DeploymentPanel deployment={tenant.deployment} />}

      {/* STUDIO-070-005. Moved into a component so the projection an operator
          reads is the one a test can render — and so a producer that stops
          threading AWS request ids reds the panel rather than silently showing
          an empty list. */}
      {tenant.evidence.length > 0 && <EvidencePanel evidence={tenant.evidence} />}

      {/* STUDIO-060-007. NEXT-SESSION §0.3's refusal list, rendered rather than
          discovered by being refused. Each entry is an operation `classify`
          puts in a class `requirementsFor` marks non-automatable, so this list
          and the gate that enforces it are the same fact. */}
      <section className="system">
        <header>
          <h2>What this console will not do</h2>
          <span className="badge">{REFUSED_OPERATIONS.length}</span>
        </header>
        <p>
          These are refused whatever the form says, and the refusal names the command a human runs
          under their own credentials. Not "hard" — refused: this engine holds credentials that can
          destroy a term of student records, and a console that will do that because a form was
          filled in correctly is the wrong shape of tool.
        </p>
        <table className="grid">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Class</th>
              <th>Instead</th>
            </tr>
          </thead>
          <tbody>
            {REFUSED_OPERATIONS.map((operation) => {
              const cls = classify({ ...operation, target: tenant.slug })
              const required = requirementsFor(cls, tenant.slug)
              return (
                <tr key={`${operation.surface}:${operation.action}`}>
                  <td className="id">
                    {operation.surface}:{operation.action}
                  </td>
                  <td>{cls}</td>
                  <td className="slug">{required.refusedWithCliCommand ?? "—"}</td>
                </tr>
              )
            })}
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

      {/* ── Audit ledger (STUDIO-140-006) ─────────────────────────────────
          History records the moves that HAPPENED. This records every move that
          was ATTEMPTED, including the ones that were refused — which is the
          half nobody could see before, and the half an incident review is
          actually about.

          Rendered rather than merely written, because a ledger with no reader
          is a table: the chain links are on the page, so `previousDigest`
          matching the row below it is something an operator (and
          `high-risk-fails-closed.spec.ts`) can check rather than take on
          trust. */}
      <section className="system">
        <header>
          <h2>Audit ledger</h2>
          <span className="badge">{ledger.length}</span>
        </header>
        {ledger.length === 0 ? (
          <p>Nothing has been attempted against this tenant through the Studio.</p>
        ) : (
          <table className="grid" data-testid="audit-ledger">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>When</th>
                <th>What</th>
                <th>Outcome</th>
                <th>Chain</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => {
                const phase = String(row.metadata.phase ?? "")
                const code = String(row.metadata.code ?? "")
                return (
                  <tr key={`${row.sequence}`} data-audit-seq={row.sequence ?? ""}>
                    <td className="num">{row.sequence ?? "—"}</td>
                    <td className="id">{row.occurredAt}</td>
                    <td>
                      {row.action}
                      {row.metadata.target ? ` · ${String(row.metadata.target)}` : ""}
                      <br />
                      <span className="slug">
                        {row.actorId} — {row.reason ?? "no reason given"}
                      </span>
                    </td>
                    <td>
                      {/* An intent with no outcome beside it is the state that
                          matters: somebody started this and nothing recorded how
                          it ended. `phase` is what says which row is which. */}
                      <span
                        className={`badge ${row.outcome === "ALLOW" ? "ok" : "bad"}`}
                        data-audit-outcome={code || phase || row.outcome}
                      >
                        {code || phase || row.outcome}
                      </span>
                    </td>
                    <td
                      className="id"
                      data-audit-hash={row.recordHash}
                      data-audit-previous={row.previousHash ?? ""}
                    >
                      {row.recordHash.slice(0, 16)}
                      <br />
                      <span className="slug">
                        after {row.previousHash ? row.previousHash.slice(0, 16) : "— chain head"}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
