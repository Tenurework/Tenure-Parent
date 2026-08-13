import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { getTenantBinding } from "@tenure/blueprints"
import { buildSystem, compatibilityFor, planPromotion } from "@tenure/platform-config"
import type { CellRecord } from "@tenure/provisioning"
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
import { healthOf } from "@/lib/fleet-health"
import { compareDesiredToActual, desiredFromDeployment } from "@/lib/aws/drift"
import { estateInventory } from "@/lib/aws/inventory"
import { retainedObservation, retainedReadingsForTenant } from "@/lib/aws/retained"
import { getTenant, registryConfigured } from "@/lib/registry"
import { DynamoConfigStore } from "@/lib/config-store"
import { readLedger, type AuditRow } from "@/lib/audit-ledger"
import { DeploymentPanel } from "@/components/DeploymentPanel"
import { EvidencePanel } from "@/components/EvidencePanel"
import { REFUSED_OPERATIONS } from "@/lib/command-handlers"
import { Badge, ButtonLink, Card, Chip, DataTable, EmptyState } from "@/components/md3"
import { AdvanceControls } from "./AdvanceControls"
import styles from "./tenant.module.css"
import {
  answeredOf,
  leadAnswer,
  marginalCost,
  observationTone,
  outcomeTone,
  reading,
  readingAsync,
  statedAsOf,
  type Reading,
} from "./summary"

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

/**
 * A reading this console could not make, said where the fact would have been.
 *
 * Two sentences, always: what could not be read, and the thing to do about it.
 * There is no tone class and no colour — the words are the carrier (Bible
 * §26.3.2), and `Badge` beside it names the state in one word for a reader
 * scanning rather than reading.
 */
function NotKnown({ because, fix }: { because: string; fix: string }) {
  return (
    <div className={styles.tight}>
      <p className="md3-body-medium">{because}</p>
      <p className="md3-body-small">{fix}</p>
    </div>
  )
}

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
 *
 * The fleet arrives as an ARGUMENT rather than being read here. `fleet()`
 * throws `FleetMisconfigured` when neither the environment nor
 * `sts:GetCallerIdentity` can say which estate this process is in, and a page
 * that 500s for that reason is a page an operator cannot use to find out why.
 * The caller reads it once, keeps the reason, and this function is simply not
 * called when there is no fleet to compute against.
 */
function releaseReadiness(slug: string, cells: readonly CellRecord[], cellId: string | undefined) {
  if (!getTenantBinding(slug)) return null

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

  return { assembled, cell, engineVersion, compatibility, plan, at }
}

/**
 * One tenant: what it is, where it is, how it got there, and what can happen
 * next — in that order, and with the answer first.
 *
 * ── The order is the design ────────────────────────────────────────────────
 *
 * An operator opens this page holding a question, and until this change the
 * first thing it answered was "what does the registry row say", which is the
 * question nobody has. So the page now leads with `leadAnswer` — the same
 * `healthOf` verdict `/tenants` ranks the fleet by, so the badge on the listing
 * and the sentence at the top of this page cannot disagree — and everything
 * that follows is grouped under a heading that says what kind of fact it is.
 *
 * ── Every panel says when it was true, and admits what it does not know ────
 *
 * Each card's supporting line ends in an as-of stamp, and each reading that
 * could fail is a `Reading<T>` rather than a `T | null`: the reason and the fix
 * travel with the absence. A console holding credentials for a live estate must
 * never render "we were not allowed to look" as "there is nothing there", and
 * the surfaces that can be refused are exactly the surfaces that matter.
 *
 * ── It boots without AWS ───────────────────────────────────────────────────
 *
 * `fleet()`, the estate inventory and the audit ledger each throw when the
 * estate is unresolvable or the table is unreachable. Every one of them is
 * wrapped, and every one of them renders the reason plus the environment
 * variable or IAM action that fixes it. A page that 500s because STS did not
 * answer is not a refusal, it is an outage of the tool an operator uses to
 * diagnose outages.
 *
 * ── "What can happen next" is read from the engine ─────────────────────────
 *
 * The buttons an operator sees are exactly the transitions the engine will
 * accept. A hardcoded set would drift and produce buttons that always fail.
 */
export default async function TenantPage({ params }: { params: Promise<{ slug: string }> }) {
  // STUDIO-000-006. `fleet()` used to default the account, region and partition
  // to `us-east-1` and a literal account id; it now THROWS `FleetMisconfigured`
  // rather than inventing an estate. Priming resolves those facts from
  // `sts:GetCallerIdentity` once, before anything reads the fleet.
  //
  // Wrapped, because priming reaches the network: a console whose FIRST
  // statement can throw is a console that cannot render the panel explaining
  // why it could not reach AWS. A failure here is not swallowed — it lands in
  // the `fleet()` reading below as `FleetMisconfigured`, which is exactly what
  // it means.
  try {
    await primeEstate()
  } catch {
    // Deliberately empty, and the only empty catch on this page. `primeEstate`
    // has no return value and no partial state: either the estate resolved or
    // the facts stay unset, and the unset case is reported — with its fix — by
    // the `cells` reading below rather than twice.
  }

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

  /** When the registry answered. Every panel fed by it states this. */
  const registryReadAt = new Date()

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
  const serving = tenant.deployment?.serving === true
  const observed = observedFor({
    isolation: tenant.manifest.isolation,
    hasDeployment: tenant.deployment !== undefined,
    serving,
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
   *
   * Wrapped because the inventory constructs AWS clients: a missing region or an
   * unresolvable endpoint throws before any read is attempted, and that is a
   * configuration fault rather than a denial. The readings themselves already
   * fail closed into the union.
   */
  const inventory = await readingAsync(
    () => estateInventory(),
    "the AWS estate this tenant is placed in",
    "sts:GetCallerIdentity",
  )
  const retainedRead = inventory.known
    ? await readingAsync(
        async () =>
          retainedObservation(
            await retainedReadingsForTenant(tenant.slug, undefined, {
              identity: inventory.value.identity,
              tagged: inventory.value.tagged,
            }),
          ),
        "the AWS resources this tenant still holds",
        "tag:GetResources",
      )
    : ({ known: false, because: inventory.because, fix: inventory.fix } as const)
  /*
   * `NO_RETAINED_AWS_OBSERVATION` when the read did not happen, and that is not
   * the same as "nothing is retained". The constant's own three fields say so:
   * it carries an empty `classes` AND an empty `unknown`, so a reconciliation
   * run against it reports the state's claim unverified rather than confirmed.
   * The reason the read failed is rendered beside the reconciliation below —
   * dropping it would turn "we could not look" into "there is nothing there",
   * which is the single failure this console is built around not making.
   */
  const retained = retainedRead.known ? retainedRead.value : NO_RETAINED_AWS_OBSERVATION
  const residual = residualFindings(tenant.state, observed, retained)
  const driftReport = inventory.known
    ? compareDesiredToActual(
        tenant.deployment
          ? desiredFromDeployment({
              slug: tenant.slug,
              serving,
              isolation: tenant.manifest.isolation,
              // The seat, from the manifest's own ownership rather than a
              // person's name — a role can answer for a resource after somebody
              // leaves.
              ownerSeat:
                tenant.manifest.isolation === "pooled" ? "platform" : `tenant-lead:${tenant.slug}`,
            })
          : [],
        [
          inventory.value.ecsServices,
          inventory.value.databases,
          inventory.value.distributions,
          inventory.value.certificates,
        ],
        { now: registryReadAt, slug: tenant.slug },
      )
    : null

  /*
   * STUDIO-140-006. Every attempt, not only every move that succeeded.
   *
   * `readLedger` rather than `dynamoAuditLedger().read()`, and that is a bug
   * fix rather than a tidy-up. The raw records carry their console metadata
   * under prefixed keys — `_phase`, `_outcomeCode` — and this page read
   * `metadata.phase` and `metadata.code`, which are always undefined. Every row
   * therefore fell through to the record-level ALLOW/DENY, so the outcome column
   * could never show `REFUSED_CONFIRMATION`, `REFUSED_IRREVERSIBLE` or any other
   * console code — the four refusals `high-risk-fails-closed.spec.ts` records
   * were on the page as an undifferentiated "DENY". `readLedger` returns the
   * `AuditRow` projection whose own doc comment says it is what this page reads,
   * and it does the key lookup in one place.
   *
   * Read here rather than lazily inside the section, because a ledger that
   * renders only when somebody scrolls is a ledger the layout suite never
   * measures and nobody notices going empty. Wrapped because an unreachable
   * table throws `AuditUnavailable`, and "the ledger could not be read" and
   * "nothing has been attempted" are opposite facts.
   */
  const ledger: Reading<readonly AuditRow[]> = await readingAsync(
    async () => (await readLedger(tenant.slug)).slice(-20).reverse(),
    "this tenant's audit ledger",
    "dynamodb:Query",
  )

  /*
   * The newest configuration revision the STORE holds, against what the
   * registry believes the cell applied.
   *
   * GE-020-005's two records of one fact. `/tenants` compares them for every row
   * and this page did not compare them at all, so the one surface dedicated to a
   * single tenant was the one surface that could not tell you its configuration
   * was behind.
   */
  const storeRevision = await readingAsync(
    async () => (await new DynamoConfigStore().latest(tenant.slug))?.revision ?? null,
    "the configuration store's newest revision for this tenant",
    "dynamodb:Query",
  )

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
  const cells = reading(
    () => fleet(),
    "the cell registry, and with it this tenant's placement",
    "sts:GetCallerIdentity",
  )
  const placedCell = cells.known
    ? (cells.value.find((c) => c.cellId === placement?.cellId) ?? null)
    : null

  /**
   * STUDIO-120-003 — what was observed of the system serving this tenant, as
   * distinct from what the registry believes about it.
   *
   * This page can resolve the cell properly, which the fleet listing cannot: the
   * registry record carries `placement.cellId`, so the certificate and backup
   * observations are taken against the cell this tenant is actually on rather
   * than against whichever one the fleet happens to hold. `placedCell` is the
   * same one the authorization decisions below are scoped to, deliberately —
   * observing a tenant against a cell the console would refuse to act on would
   * be a health badge for a system nobody here can touch.
   *
   * Rendered whole, including the sources that came back `unknown`, because the
   * estate has three FAILED certificates and no verified backup and a page that
   * showed only the answers it had would present exactly the silence this item
   * exists to remove.
   */
  const observedAt = new Date()
  const observations = await readingAsync(
    async () =>
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
      ).get(tenant.slug) ?? [],
    "what is observable of the system serving this tenant",
    "cloudwatch:DescribeAlarms",
  )
  const estateObservations = observations.known ? observations.value : []
  const answered = answeredOf(estateObservations)

  /*
   * The verdict, from the same function the fleet listing ranks by.
   *
   * `observations` is REQUIRED by `healthOf` rather than optional, precisely so
   * that a caller cannot report a tenant healthy on the strength of having asked
   * nothing. An unreadable observation surface passes `[]`, which produces
   * `unobserved` — true, and the opposite of reassuring.
   */
  const health = healthOf(
    {
      slug: tenant.slug,
      state: tenant.state,
      updatedAt: tenant.updatedAt,
      hasDeployment: tenant.deployment !== undefined,
      observations: estateObservations,
      ...(tenant.registry ? { registryConfigRevision: tenant.registry.configRevision } : {}),
      ...(storeRevision.known && storeRevision.value !== null
        ? { storeConfigRevision: storeRevision.value }
        : {}),
    },
    observedAt,
  )
  const answer = leadAnswer({ health, serving, state: tenant.state })

  const readiness = cells.known
    ? releaseReadiness(tenant.slug, cells.value, tenant.registry?.placement.cellId)
    : null

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
  // The card below is then not rendered at all, rather than linking at
  // `https://null.console.aws.amazon.com` — a deep link to nowhere is worse
  // than no deep link, because it looks like the console is telling you
  // something.
  const consoleRegion = placement?.region ?? identity.region

  /** Where this tenant runs, as one line, or the reason there isn't one. */
  const placementLine = placedCell
    ? `${placedCell.cellId} · ${placedCell.region} · account ${placedCell.awsAccountId}`
    : placement
      ? `${placement.cellId} · ${placement.region} — this console holds no record of that cell`
      : null

  return (
    <div className={styles.page}>
      {/* The section nav names Tenants; this says which one, and how to get
          back. Two levels is the whole hierarchy — a breadcrumb longer than the
          hierarchy is decoration. A link rather than a styled span, so
          middle-click and open-in-new-tab work, which is how an operator with
          six tenants open actually moves. */}
      <nav aria-label="Breadcrumb" className={styles.row}>
        <ButtonLink href="/tenants" variant="text">
          ← Tenants
        </ButtonLink>
      </nav>

      <header className={styles.lead}>
        <h1 className="md3-headline-large">{tenant.manifest.displayName}</h1>
        <p className="md3-body-medium">{tenant.manifest.legalName}</p>
        <div className={styles.row}>
          <Chip title="The slug this tenant is addressed by">
            <span className={styles.identifier}>/{tenant.slug}</span>
          </Chip>
          <Chip title="The digest of the manifest this page rendered">
            manifest <span className={styles.identifier}>{tenant.digest}</span>
          </Chip>
          {tenant.registry ? (
            <Chip
              title={
                tenant.registry.provenance === "adopted"
                  ? "Brought under the registry after it was already serving"
                  : "Composed and provisioned by this console"
              }
            >
              {tenant.registry.provenance}
            </Chip>
          ) : null}
        </div>
      </header>

      {/* ── The answer ─────────────────────────────────────────────────────
          The fact an operator came for, above everything that explains it. */}
      <Card
        id="right-now"
        headline="Right now"
        headerAside={<Badge tone={answer.tone} title={answer.headline}>{answer.verdict}</Badge>}
        supportingText={statedAsOf(
          "What an operator should act on first, from the registry and from what was observed of the running system — never from anything inside the tenant",
          observedAt,
        )}
      >
        <div className={styles.stack}>
          <p className="md3-body-large">{answer.headline}</p>
          {answer.because ? <p className="md3-body-medium">{answer.because}</p> : null}

          <dl className={styles.facts}>
            <dt>Lifecycle</dt>
            <dd>
              <span className={styles.identifier}>{tenant.state}</span>
            </dd>

            <dt>Serving</dt>
            <dd>
              {serving
                ? "Yes — a published artifact says so, which is what makes a cell answer for it."
                : tenant.deployment
                  ? "No — an artifact is published and its routing switch is off."
                  : "No — no artifact has been published, so no cell routes at it."}
            </dd>

            <dt>Placement</dt>
            <dd>
              {placementLine ? (
                <span className={styles.identifier}>{placementLine}</span>
              ) : cells.known ? (
                "Not placed. The registry holds no placement for this tenant."
              ) : (
                <NotKnown because={cells.because} fix={cells.fix} />
              )}
            </dd>

            <dt>Last moved</dt>
            <dd>
              <span className={styles.identifier}>{tenant.updatedAt}</span>
              {health.hoursSinceChange === null
                ? " — the timestamp could not be parsed, so how long it has sat here is unknown"
                : ` — ${health.hoursSinceChange.toFixed(0)} hours ago`}
            </dd>

            <dt>Sources answered</dt>
            <dd>
              {!observations.known ? (
                <NotKnown because={observations.because} fix={observations.fix} />
              ) : answered.total === 0 ? (
                "None. There is nothing observable about a tenant with no cell to observe it against."
              ) : (
                `${answered.answered} of ${answered.total}.${
                  answered.unobserved.length > 0
                    ? ` Nothing definite came back from ${answered.unobserved.join(", ")}.`
                    : ""
                }`
              )}
            </dd>

            <dt>Configuration</dt>
            <dd>
              {storeRevision.known ? (
                `registry ${tenant.registry?.configRevision ?? "—"} · store ${
                  storeRevision.value ?? "nothing published"
                }`
              ) : (
                <NotKnown because={storeRevision.because} fix={storeRevision.fix} />
              )}
            </dd>
          </dl>

          <div className={styles.row}>
            <ButtonLink href={`/tenants/${tenant.slug}/configuration`} variant="tonal">
              Configuration
            </ButtonLink>
          </div>
        </div>
      </Card>

      {/* ── Lifecycle ──────────────────────────────────────────────────────
          Where it is, and the only moves the engine will accept out of it. */}
      <Card
        id="state"
        headline="State"
        headerAside={<Badge tone="warn" title="The lifecycle state the registry holds">{tenant.state}</Badge>}
        supportingText={statedAsOf(
          "Where this tenant is in the lifecycle graph, and what the engine will accept next",
          registryReadAt,
        )}
      >
        <div className={styles.stack}>
          {/*
            GE-022-006. Archived and pending-deletion are read off the lifecycle
            state rather than a separate flag, so they cannot disagree with it.
            Both were previously indistinguishable from any other non-serving
            state: a tenant three days from purge looked exactly like one that
            was merely paused.
          */}
          {ARCHIVED_STATES.has(tenant.state) && (
            <ArchivedState
              what={tenant.manifest.displayName}
              since={tenant.updatedAt ?? tenant.createdAt}
            />
          )}
          {PURGE_STATES.has(tenant.state) && (
            <PendingDeletionState
              what={tenant.manifest.displayName}
              at={
                tenant.state === "PURGING"
                  ? "now — it is running"
                  : "when an operator advances it to PURGING"
              }
            />
          )}

          {/* WRK-120-005. The note, and what it is wrong about. Rendering the
              sentence alone is what made the claim unfalsifiable: it says what
              this state is SUPPOSED to retain, and until the reconciliation
              existed nothing compared it to what this tenant actually holds. */}
          {/* The reconciliation below compares the state's residual claim
              against what AWS actually shows this tenant holding. When that read
              did not happen, the comparison ran against nothing — and a
              reconciliation with no second side is a claim, not a check. Said
              here rather than omitted, because omitting it is what makes an
              unverified claim look verified. */}
          {!retainedRead.known && (
            <NotKnown because={retainedRead.because} fix={retainedRead.fix} />
          )}

          {residual && (
            <div className={styles.tight}>
              <p className="md3-body-medium">{residual.note}</p>
              {residual.unexplained.length > 0 && (
                <p className="md3-body-medium">
                  Retained beyond that note, and still billing:{" "}
                  {residual.unexplained.join(", ")}. Observed from {tenant.manifest.isolation}{" "}
                  placement, the published artifact, {tenant.evidence.length} evidence records and
                  live retained-resource AWS reads — not from anything inside the tenant.
                </p>
              )}
              {residual.overclaimed.length > 0 && (
                <p className="md3-body-medium">
                  Claimed by that note and not held here: {residual.overclaimed.join(", ")}. An
                  operator told they are paying for something they are not stops believing the panel
                  that carries the real finding.
                </p>
              )}
              {residual.retainedSources.length > 0 && (
                <p className="md3-body-small">
                  Live retained-resource sources: {residual.retainedSources.join("; ")}.
                </p>
              )}
              {residual.retainedUnknown.length > 0 && (
                <p className="md3-body-small">
                  Live retained-resource reads unobserved: {residual.retainedUnknown.join("; ")}.
                </p>
              )}
            </div>
          )}

          <dl className={styles.facts}>
            <dt>Blueprint</dt>
            <dd>
              <span className={styles.identifier}>{tenant.manifest.blueprintId}</span>
            </dd>
            <dt>Modules</dt>
            <dd>{tenant.manifest.modules.join(", ")}</dd>
            <dt>Isolation</dt>
            <dd>
              {tenant.manifest.isolation} · {tenant.manifest.region}
            </dd>
            <dt>First administrator</dt>
            <dd>{tenant.manifest.initialAdminEmail}</dd>
            <dt>Registered</dt>
            <dd>
              <span className={styles.identifier}>{tenant.createdAt}</span>
            </dd>
          </dl>

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
                //
                // `NO_RETAINED_AWS_OBSERVATION` and NOT the live `retained`
                // reading above, deliberately. `highRiskVerdict` in
                // `lib/tenant-state.ts` recomputes this risk server-side with the
                // same constant and compares the digest; feeding the live reading
                // here would produce a digest the gate cannot reproduce, and
                // every high-risk move would refuse with "the consequence
                // changed" for a consequence that had not.
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
            <p className="md3-body-medium" data-testid="lifecycle-read-only">
              Read only. Moving this tenant&rsquo;s lifecycle is not yours to do.
            </p>
          )}
        </div>
      </Card>

      {/* ── What the registry holds ────────────────────────────────────────── */}
      {tenant.registry && (
        <Card
          id="registry"
          headline="Registry"
          headerAside={<Badge tone="info" title="How this tenant came to be known to the registry">{tenant.registry.provenance}</Badge>}
          supportingText={statedAsOf(
            "What is TRUE about this tenant — its immutable id, where it is placed, what it may not leave — as opposed to the manifest, which is what was asked for",
            registryReadAt,
          )}
        >
          <div className={styles.stack}>
            {/* Said plainly, and permanently. An adopted tenant must never present
                as one this console provisioned — the lifecycle history it does not
                have is the difference, and a reader who cannot see which is which
                will assume the steps were run. */}
            {tenant.registry.provenance === "adopted" && (
              <p className="md3-body-medium">
                Adopted. This system was serving before the registry existed and was brought under
                it — no provisioning steps were run, and none are recorded.
              </p>
            )}

            <dl className={styles.facts}>
              <dt>Tenant id</dt>
              <dd>
                <span className={styles.identifier}>{tenant.registry.tenantId}</span>
              </dd>
              <dt>Lifecycle</dt>
              <dd>{tenant.registry.lifecycle}</dd>
              <dt>Cell</dt>
              <dd>
                <span className={styles.identifier}>
                  {tenant.registry.placement.cellId} · {tenant.registry.placement.region}
                </span>
              </dd>
              <dt>Permitted regions</dt>
              <dd>{tenant.registry.residency.join(", ")}</dd>
              <dt>Plan</dt>
              <dd>{tenant.registry.plan}</dd>
              <dt>Release</dt>
              <dd>
                <span className={styles.identifier}>{tenant.registry.release}</span>
              </dd>
              <dt>Config revision</dt>
              <dd>{tenant.registry.configRevision}</dd>
              <dt>Administrator</dt>
              <dd>{tenant.registry.primaryContactEmail}</dd>
            </dl>
          </div>
        </Card>
      )}

      {/* ── What was seen, including what could not be ─────────────────────── */}
      <Card
        id="observed"
        headline="Observed"
        headerAside={
          <Badge
            tone={
              estateObservations.some((o) => o.status === "failing")
                ? "bad"
                : answered.total === 0 || answered.answered === 0
                  ? "warn"
                  : "ok"
            }
            title="How many observation sources answered with a fact rather than a shrug"
          >
            {answered.answered} of {answered.total} answered
          </Badge>
        }
        supportingText={statedAsOf(
          "What was seen of the system serving this tenant. None of it is read from the tenant's database — a certificate's expiry, an alarm's state and a verified backup are all facts the control plane can establish from outside. A source that could not be read is never counted healthy",
          observedAt,
        )}
      >
        {observations.known ? (
          <DataTable
            caption="Observation sources, and what each one said"
            rows={estateObservations}
            rowKey={(o) => o.source}
            empty={
              <EmptyState
                headline="Nothing was observed"
                description="This tenant has no cell recorded against it, so there is no host to read a certificate from and no backup record to check. That is an absence of a target, not a healthy result."
              />
            }
            columns={[
              {
                key: "source",
                header: "Source",
                cell: (o) => <span className={styles.identifier}>{o.source}</span>,
              },
              {
                key: "status",
                header: "Status",
                cell: (o) => <Badge tone={observationTone(o.status)}>{o.status}</Badge>,
              },
              { key: "detail", header: "What was seen", cell: (o) => o.detail },
              {
                key: "asOf",
                header: "As of",
                cell: (o) => <span className={styles.identifier}>{o.asOf}</span>,
              },
            ]}
          />
        ) : (
          <NotKnown because={observations.because} fix={observations.fix} />
        )}
      </Card>

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
        <Card
          id="drift"
          headline="Drift"
          headerAside={
            <Badge
              tone={driftReport === null ? "warn" : driftReport.items.length === 0 ? "ok" : "warn"}
              title="Resources the published artifact wants that AWS did not report"
            >
              {driftReport === null ? "not compared" : `${driftReport.items.length} findings`}
            </Badge>
          }
          supportingText={statedAsOf(
            driftReport === null
              ? "Desired comes from the published artifact; actual comes from a live AWS read that could not be made, so nothing was compared"
              : driftReport.partial
                ? "Desired comes from the published artifact; actual comes from a live read made when this page rendered. At least one surface could not be read, so this report is partial and says which"
                : "Desired comes from the published artifact; actual comes from a live read made when this page rendered. Every surface answered",
            driftReport?.asOf ?? registryReadAt,
          )}
        >
          {driftReport === null ? (
            <NotKnown
              because={inventory.known ? "The estate was not read." : inventory.because}
              fix={inventory.known ? "Reload this page." : inventory.fix}
            />
          ) : (
            <DataTable
              caption="Desired by the artifact, against what AWS reported"
              rows={driftReport.items}
              rowKey={(item) => item.resourceKey}
              empty={
                <EmptyState
                  headline="No drift"
                  description="Nothing desired by the published artifact is missing from what AWS reports. Every surface that fed this comparison answered — this is a real absence of findings, not a read that was refused."
                />
              }
              columns={[
                {
                  key: "resource",
                  header: "Resource",
                  cell: (item) => <span className={styles.identifier}>{item.resourceKey}</span>,
                },
                { key: "severity", header: "Severity", cell: (item) => item.severity },
                { key: "owner", header: "Owner", cell: (item) => item.owner },
                {
                  key: "seen",
                  header: "Seen",
                  align: "end",
                  cell: (item) => `${item.occurrences}× since ${item.firstSeenAt.slice(0, 10)}`,
                },
                {
                  key: "remediation",
                  header: "Remediation",
                  cell: (item) =>
                    !item.remediation ? (
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
                      <span className={styles.cell}>
                        <span>{item.remediation.refusedBecause} A human runs this themselves:</span>
                        <code className={styles.identifier}>{item.remediation.awsCliCommand}</code>
                      </span>
                    ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {/* STUDIO-080-003 — console deep links, gated. */}
      {awsConsole.allowed && consoleRegion !== null && (
        <Card
          id="aws-console"
          headline="AWS console"
          headerAside={<Badge tone="info" title="The operator family this shortcut is offered to">{awsConsole.role}</Badge>}
          supportingText={statedAsOf(
            "Shortcuts into the account this tenant is placed in, for an operator who is already entitled to be there. Nothing in this console depends on them: every change this platform makes goes through a typed command with a plan, an approval and evidence, and a link to a service page is a place to look rather than a place to act",
            registryReadAt,
          )}
        >
          <dl className={styles.facts}>
            <dt>Account</dt>
            <dd>
              <span className={styles.identifier}>
                {placedCell?.awsAccountId ?? identity.accountId ?? "unknown — set AWS_ACCOUNT_ID"}
              </span>
            </dd>
            <dt>Region</dt>
            <dd>
              <span className={styles.identifier}>{consoleRegion}</span>
            </dd>
            <dt>Services</dt>
            <dd>
              <span className={styles.row}>
                <Link
                  href={`https://${consoleRegion}.console.aws.amazon.com/ecs/v2/clusters?region=${consoleRegion}`}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  ECS clusters
                </Link>
                <Link
                  href={`https://${consoleRegion}.console.aws.amazon.com/cloudwatch/home?region=${consoleRegion}#logsV2:log-groups`}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  CloudWatch log groups
                </Link>
              </span>
            </dd>
          </dl>
        </Card>
      )}

      {/* ── What it would take ─────────────────────────────────────────────── */}
      <Card
        id="provisioning-plan"
        headline="Provisioning plan"
        headerAside={
          <Badge tone="neutral" title="What this shape of tenant costs beyond the pooled baseline">
            {marginalCost(plan.estimatedMonthlyCostCents)}
          </Badge>
        }
        supportingText={statedAsOf(
          `What provisioning this tenant does, step by step, derived from its manifest. ${plan.costBasis}`,
          registryReadAt,
        )}
      >
        <div className={styles.stack}>
          {plan.warnings.map((w) => (
            <p className="md3-body-medium" key={w}>
              {w}
            </p>
          ))}

          <DataTable
            caption="Provisioning steps, in the order the lifecycle runs them"
            rows={plan.steps}
            rowKey={(s) => s.what}
            empty={
              <EmptyState
                headline="No steps"
                description="This blueprint declares no provisioning steps, which means nothing would be created for it. That is a fact about the blueprint, not a failed read."
              />
            }
            columns={[
              {
                key: "during",
                header: "During",
                cell: (s) => <span className={styles.identifier}>{s.during}</span>,
              },
              {
                key: "what",
                header: "What",
                cell: (s) => (
                  <span className={styles.cell}>
                    <span>{s.what}</span>
                    <span className="md3-body-small">{s.detail}</span>
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Card>

      {readiness && (
        <Card
          id="release"
          headline="Release"
          headerAside={
            <Badge
              // `active` is the end of the release graph — reachable only
              // through `canary`, which is reachable only through `scheduled`.
              // Anything short of it is a gate that refused, which is a warn.
              tone={readiness.plan?.reachable === "active" ? "ok" : "warn"}
              title="The furthest release state this candidate reaches before a gate refuses it"
            >
              {readiness.plan ? `reaches ${readiness.plan.reachable}` : "no candidate"}
            </Badge>
          }
          supportingText={statedAsOf(
            "What would happen if this system were released now, assembled by the same function the cell uses. Nothing here publishes anything: the gates are walked, not passed",
            readiness.at,
          )}
        >
          <div className={styles.stack}>
            <dl className={styles.facts}>
              <dt>Candidate</dt>
              <dd>
                <span className={styles.identifier}>
                  {readiness.assembled.candidate?.releaseId ?? "— did not validate"}
                </span>
              </dd>
              <dt>Signature</dt>
              <dd>
                {readiness.assembled.candidate?.signature
                  ? `${readiness.assembled.candidate.signature.algorithm} by ${readiness.assembled.candidate.signature.keyId}`
                  : "Unsigned. Set RELEASE_SIGNING_KEY_ID and RELEASE_SIGNING_SECRET — an unsigned release cannot be approved."}
              </dd>
              <dt>Schema</dt>
              <dd>
                <span className={styles.identifier}>{readiness.assembled.schemaVersion}</span>
                {readiness.assembled.schemaVersion === readiness.cell.schemaVersion
                  ? ""
                  : ` · ${readiness.cell.cellId} is at ${readiness.cell.schemaVersion}`}
              </dd>
              <dt>Engine</dt>
              <dd>
                <span className={styles.identifier}>{readiness.engineVersion}</span> on{" "}
                <span className={styles.identifier}>{readiness.cell.cellId}</span>
              </dd>
              <dt>Modules</dt>
              <dd>{readiness.assembled.moduleKeys.join(", ")}</dd>
            </dl>

            {readiness.assembled.validation.problems.length > 0 && (
              <div className={styles.tight}>
                {readiness.assembled.validation.problems.map((p) => (
                  <p className="md3-body-medium" key={`${p.area}-${p.detail}`}>
                    [{p.area}] {p.detail}
                  </p>
                ))}
              </div>
            )}

            {!readiness.compatibility.compatible && (
              <>
                <p className="md3-body-medium">
                  The cell cannot honour this tenant&apos;s configuration, so the release is refused
                  rather than half-applied.
                </p>
                <DataTable
                  caption="What the candidate needs against what the cell is running"
                  rows={readiness.compatibility.problems}
                  rowKey={(p) => p.key}
                  empty={
                    <EmptyState
                      headline="No incompatibilities"
                      description="Every capability the candidate needs is one the cell reports."
                    />
                  }
                  columns={[
                    {
                      key: "key",
                      header: "Key",
                      cell: (p) => <span className={styles.identifier}>{p.key}</span>,
                    },
                    { key: "needs", header: "Needs", cell: (p) => p.requires },
                    { key: "running", header: "Running", cell: (p) => p.running },
                    { key: "why", header: "Why", cell: (p) => p.reason },
                  ]}
                />
              </>
            )}

            {readiness.plan && (
              <DataTable
                caption="Release gates, in the order they are walked"
                rows={readiness.plan.steps}
                rowKey={(s) => s.to}
                empty={
                  <EmptyState
                    headline="No gates"
                    description="This candidate reached no gate at all, which means it did not validate."
                  />
                }
                columns={[
                  {
                    key: "to",
                    header: "State",
                    cell: (s) => <span className={styles.identifier}>{s.to}</span>,
                  },
                  {
                    key: "reached",
                    header: "Reached",
                    cell: (s) =>
                      s.reached ? (
                        <Badge tone="ok">reached</Badge>
                      ) : (
                        <span className={styles.cell}>
                          <Badge tone="warn">refused</Badge>
                          <span className="md3-body-small">{s.refusedBecause}</span>
                        </span>
                      ),
                  },
                ]}
              />
            )}

            {readiness.plan && readiness.plan.diff.length > 0 && (
              <DataTable
                caption={`Against what ${readiness.cell.cellId} is running — ${readiness.plan.breaking.length} breaking of ${readiness.plan.diff.length}`}
                rows={readiness.plan.diff}
                rowKey={(d) => `${d.field}-${d.change}`}
                empty={
                  <EmptyState
                    headline="No differences"
                    description="The candidate and the running system agree on every field compared."
                  />
                }
                columns={[
                  {
                    key: "field",
                    header: "Field",
                    cell: (d) => <span className={styles.identifier}>{d.field}</span>,
                  },
                  {
                    key: "change",
                    header: "Change",
                    cell: (d) => (
                      <span className={styles.row}>
                        <span>{d.change}</span>
                        {readiness.plan!.breaking.includes(d) && <Badge tone="bad">breaking</Badge>}
                      </span>
                    ),
                  },
                  { key: "before", header: "Before", cell: (d) => String(d.before ?? "—") },
                  { key: "after", header: "After", cell: (d) => String(d.after ?? "—") },
                ]}
              />
            )}
          </div>
        </Card>
      )}

      {/* STUDIO-070-009. Moved into a component for the reason the evidence
          panel was: the projection an operator reads is then the one a test can
          render, so a producer that stops forwarding the previous artifact's
          digest reds a rendered surface rather than passing unnoticed. The
          signature and the rollback target were both absent from the block this
          replaces — the first while the heading called the artifact signed.

          Still on the pre-Material markup, and deliberately not converted here:
          `components/DeploymentPanel.tsx` and `components/EvidencePanel.tsx` are
          shared with other surfaces and are not this route's to change. */}
      {tenant.deployment && <DeploymentPanel deployment={tenant.deployment} />}

      {/* STUDIO-070-005. Moved into a component so the projection an operator
          reads is the one a test can render — and so a producer that stops
          threading AWS request ids reds the panel rather than silently showing
          an empty list. */}
      {tenant.evidence.length > 0 && <EvidencePanel evidence={tenant.evidence} />}

      {/* ── How it got here ────────────────────────────────────────────────── */}
      <Card
        id="history"
        headline="History"
        headerAside={
          <Badge tone="neutral" title="Lifecycle moves this tenant has actually made">
            {tenant.history.length} moves
          </Badge>
        }
        supportingText={statedAsOf(
          "Every lifecycle move that HAPPENED, oldest first. The moves that were attempted and refused are on the audit ledger below, not here",
          registryReadAt,
        )}
      >
        <DataTable
          caption="Lifecycle moves, oldest first"
          rows={tenant.history}
          rowKey={(s) => `${s.at}-${s.attempt}`}
          empty={
            <EmptyState
              headline="Registered, and not yet moved"
              description="This tenant has taken no lifecycle step since it was composed. That is a real absence — the registry answered and there are no STEP rows."
            />
          }
          columns={[
            {
              key: "when",
              header: "When",
              cell: (s) => <span className={styles.identifier}>{s.at}</span>,
            },
            {
              key: "move",
              header: "Move",
              cell: (s) => (
                <span className={styles.cell}>
                  <span className={styles.identifier}>
                    {s.from} → {s.to}
                    {s.attempt > 1 ? ` (attempt ${s.attempt})` : ""}
                  </span>
                  {s.reason ? <span className="md3-body-small">{s.reason}</span> : null}
                </span>
              ),
            },
            { key: "actor", header: "Actor", cell: (s) => s.actor },
            { key: "approved", header: "Approved by", cell: (s) => s.approvedBy ?? "—" },
          ]}
        />
      </Card>

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
      <Card
        id="audit-ledger"
        headline="Audit ledger"
        headerAside={
          <Badge
            tone={ledger.known ? "neutral" : "warn"}
            title="Attempts recorded against this tenant, newest first"
          >
            {ledger.known ? `${ledger.value.length} attempts` : "unreadable"}
          </Badge>
        }
        supportingText={statedAsOf(
          "Every act ATTEMPTED against this tenant through the Studio, newest first, including the ones that were refused. Each row carries the hash of the row below it, so a dropped row is visible rather than silent",
          registryReadAt,
        )}
      >
        {ledger.known ? (
          <div data-testid="audit-ledger">
            <DataTable
              caption="Attempts, newest first, with the chain link each one carries"
              rows={ledger.value}
              rowKey={(row) => `${row.seq}`}
              empty={
                <EmptyState
                  headline="Nothing has been attempted"
                  description="The ledger answered and holds no row for this tenant. Nothing has been tried against it through the Studio — this is an empty ledger, not an unreadable one."
                />
              }
              columns={[
                { key: "seq", header: "#", align: "end", cell: (row) => row.seq },
                {
                  key: "when",
                  header: "When",
                  cell: (row) => <span className={styles.identifier}>{row.at}</span>,
                },
                {
                  key: "what",
                  header: "What",
                  cell: (row) => (
                    <span className={styles.cell}>
                      <span>
                        {row.action}
                        {row.target ? ` · ${row.target}` : ""}
                      </span>
                      <span className="md3-body-small">
                        {row.actor} — {row.detail || "no reason given"}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "outcome",
                  header: "Outcome",
                  cell: (row) => {
                    // An intent with no outcome beside it is the state that
                    // matters: somebody started this and nothing recorded how it
                    // ended. `AuditRow.outcome` is null for exactly that row.
                    const code = row.outcome ?? "INTENT"
                    return (
                      <span data-audit-outcome={code}>
                        <Badge tone={outcomeTone(row.outcome)}>{code}</Badge>
                      </span>
                    )
                  },
                },
                {
                  key: "chain",
                  header: "Chain",
                  cell: (row) => (
                    <span
                      className={styles.cell}
                      data-audit-hash={row.digest}
                      data-audit-previous={row.previousDigest ?? ""}
                    >
                      <span className={styles.identifier}>{row.digest.slice(0, 16)}</span>
                      <span className="md3-body-small">
                        after {row.previousDigest ? row.previousDigest.slice(0, 16) : "— chain head"}
                      </span>
                    </span>
                  ),
                },
              ]}
            />
          </div>
        ) : (
          <NotKnown because={ledger.because} fix={ledger.fix} />
        )}
      </Card>

      {/* STUDIO-060-007. NEXT-SESSION §0.3's refusal list, rendered rather than
          discovered by being refused. Each entry is an operation `classify`
          puts in a class `requirementsFor` marks non-automatable, so this list
          and the gate that enforces it are the same fact.

          This card is tenant-INDEPENDENT: `REFUSED_OPERATIONS` is a constant and
          this table is identical on every tenant's page. It is a policy
          reference rather than a fact about this tenant, and it is named in the
          hand-off notes as belonging behind the Diagnostics tab. Left in place
          rather than moved, because moving it is the IA agent's change to
          make. */}
      <Card
        id="refusals"
        headline="What this console will not do"
        headerAside={
          <Badge tone="neutral" title="Operations refused whatever the form says">
            {REFUSED_OPERATIONS.length} refused
          </Badge>
        }
        supportingText={statedAsOf(
          "These are refused whatever the form says, and the refusal names the command a human runs under their own credentials. Not “hard” — refused: this engine holds credentials that can destroy a term of student records, and a console that will do that because a form was filled in correctly is the wrong shape of tool. The same list on every tenant's page",
          registryReadAt,
        )}
      >
        <DataTable
          caption="Operations this console refuses to perform"
          rows={REFUSED_OPERATIONS}
          rowKey={(operation) => `${operation.surface}:${operation.action}`}
          empty={
            <EmptyState
              headline="Nothing is refused"
              description="No operation is currently classified as non-automatable, which would mean this console will attempt every command it offers."
            />
          }
          columns={[
            {
              key: "operation",
              header: "Operation",
              cell: (operation) => (
                <span className={styles.identifier}>
                  {operation.surface}:{operation.action}
                </span>
              ),
            },
            {
              key: "class",
              header: "Class",
              cell: (operation) => classify({ ...operation, target: tenant.slug }),
            },
            {
              key: "instead",
              header: "Instead",
              cell: (operation) => (
                <code className={styles.identifier}>
                  {requirementsFor(
                    classify({ ...operation, target: tenant.slug }),
                    tenant.slug,
                  ).refusedWithCliCommand ?? "—"}
                </code>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
