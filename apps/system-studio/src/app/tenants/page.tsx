import Link from "next/link"
import { redirect } from "next/navigation"

import { CUSTOMER_TENANT_BINDINGS } from "@tenure/blueprints"
import { PLAN_CATALOG, RESIDUAL_COST, nextStates } from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { authorizeCommand, controlPlaneIdentity } from "@/lib/authorize"
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
import { adoptableBindings } from "@/lib/adopt"
import { fleet, placeableRegions, primeEstate } from "@/lib/cells"
import { AdoptForm } from "./AdoptForm"
import {
  EmptyState as GovernedEmptyState,
  ErrorState,
  PartialDataState,
  PermissionDeniedState,
  RetryingState,
} from "@/components/states"
import { readWithBackoff, type ReadOutcome } from "@/lib/aws/throttle"
import {
  HEALTH_REFRESH_MS,
  fleetReadings,
  observeFleet,
  type ObservationTarget,
} from "@/lib/aws/health"
import { byUrgency, explainAttention, healthOf, summariseFleet, type TenantHealth } from "@/lib/fleet-health"
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Chip,
  DataTable,
  EmptyState,
  Select,
  StaleIndicator,
  TextField,
  UnknownState,
  type DataColumn,
} from "@/components/md3"
import {
  THE_QUESTION,
  attentionTone,
  describeSignals,
  leadAnswer,
  lifecycleTone,
  observedCount,
  provenanceOf,
  rankFleetRows,
  unknownReadings,
} from "./fleet-view"

import styles from "./fleet.module.css"

export const dynamic = "force-dynamic"

/**
 * STUDIO-120-003 — what each tenant's observations are taken against, and the
 * sentence that says so on the page.
 *
 * The host and the backup record come from the cell, because that is where they
 * genuinely live: a tenant does not own a certificate, the cell that serves it
 * does, and `lib/cells.ts` already holds `routing.baseUrl` and
 * `backup.lastVerifiedAt`.
 *
 * With more than one cell this returns nulls rather than picking one. The fleet
 * projection (`listTenants`) does not carry placement — it reads STATE rows —
 * and observing a tenant against the wrong cell's certificate would produce a
 * green badge for a host it is not served from.
 *
 * `against` is the half that was missing. A null target renders every tenant as
 * `unobserved`, which is honest about the tenant and silent about the console:
 * an operator reading a fleet of unobserved tenants could not tell a role that
 * has been refused from an estate whose cell record this page could not read.
 * The sentence names which, and it is rendered on the panel rather than logged.
 */
interface ObservationScope {
  targets: readonly ObservationTarget[]
  /** Plain prose: what these observations were taken against, or why there were none. */
  against: string
}

function observationScope(slugs: readonly string[]): ObservationScope {
  let host: string | null = null
  let cellId: string | null = null
  let backup: ObservationTarget["backup"] = null
  let against: string

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
      against = host
        ? `Taken against ${cellId} at ${host}.`
        : `Taken against ${cellId}. Its routing base URL is not a URL this console can parse, so no certificate was checked.`
    } else if (cells.length === 0) {
      against =
        "This estate holds no cell record, so no tenant could be observed against a host. Every tenant below reads unobserved for that reason, not because a check came back bad."
    } else {
      against = `This estate holds ${cells.length} cells and the fleet projection does not carry placement, so no tenant could be observed against a specific one. Every tenant below reads unobserved for that reason, not because a check came back bad.`
    }
  } catch {
    // FleetMisconfigured. The fleet page must still render — a console that
    // 500s when the cell record is wrong is a console nobody can use to see
    // that the cell record is wrong.
    host = null
    cellId = null
    backup = null
    against =
      "The cell record could not be read, so nothing was observed against a host. Every tenant below reads unobserved for that reason, not because a check came back bad."
  }

  return { targets: slugs.map((slug) => ({ slug, host, cellId, backup })), against }
}

/**
 * The fleet. GE-103-001.
 *
 * Three cards, in the order an operator needs them: what needs doing, what is
 * registered, and what predates the registry. The file-based bindings stay a
 * card of their own because presenting them as if they had been provisioned
 * through this console would be a claim about how they got there that is not
 * true.
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
    // the sixteen columns below have a source. Its predecessor projected five
    // attributes and filtered the Scan to STATE rows, which meant the page
    // COULD NOT render owner, plan, cell, release or config revision even if the
    // columns existed — and the one derived signal it did show was fed a
    // literal `hasDeployment: true`.
    const outcome = await readWithBackoff(() => listFleet())
    if (outcome.state === "ok") tenants = outcome.value
    else if (outcome.state === "retrying") throttled = outcome
    else failure = outcome.why
  }
  /*
   * When the registry answered. Every panel on this page states what it is AS
   * OF, and this is the registry panel's: the inventory below is a projection
   * of rows read at one instant, not a live view, and a reader who cannot see
   * when it was taken cannot tell a quiet fleet from a stale page.
   */
  const readAt = new Date()

  // A binding is adoptable until it is in the registry. Derived from what the
  // registry actually returned rather than from a flag, so a failed read shows
  // nothing as adoptable instead of offering to adopt something twice.
  const registeredSlugs = tenants.map((t) => t.slug)
  // A throttled read returned nothing, so it is exactly as unsafe a basis for
  // "this binding has not been adopted" as a failed one.
  const adoptable = failure || throttled ? [] : adoptableBindings(registeredSlugs)
  const planOptions = PLAN_CATALOG.map((p) => ({ planId: p.planId, displayName: p.displayName }))

  /*
   * Which regions a tenant may be placed in — and what to do when that is not
   * knowable.
   *
   * `placeableRegions()` reads the cell record, which is derived from
   * `sts:GetCallerIdentity` when the estate is not pinned in the environment.
   * It THROWS when that record cannot be assembled, and the call used to be
   * made unguarded inside the returned tree — so a console with no AWS
   * credentials rendered "Application error: a server-side exception has
   * occurred" on the one page an operator would open to find out that the
   * estate is unreadable. A 500 is not an acceptable refusal; not knowing is,
   * as long as the page says so and names the fix.
   */
  let placeableRegionsOrNull: readonly string[] | null = null
  try {
    const regions = placeableRegions()
    placeableRegionsOrNull = regions.length > 0 ? regions : null
  } catch {
    placeableRegionsOrNull = null
  }

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
  const scope = observationScope(registeredSlugs)
  const observed = await observeFleet(scope.targets, { now: observedAt })
  /*
   * The same two readings `observeFleet` just took, as readings rather than as
   * per-tenant observations.
   *
   * NOT a second pair of AWS calls: `fleetReadings` holds its result for
   * `HEALTH_REFRESH_MS` and `observeFleet` has just populated that hold with
   * this exact `now`, so this returns the identical object. It is asked for
   * because a refused `acm:ListCertificates` reaches the table below as twenty
   * identical `unobserved` cells and nothing that says the remedy is one IAM
   * statement. `unknownReadings` picks out the arms that carry no value, and
   * `UnknownState` renders each with the principal, the action and a pasteable
   * minimum statement — never as an empty list, never as a zero.
   */
  const readings = await fleetReadings({ now: observedAt })
  const unreadable = unknownReadings(readings)

  /*
   * Health, computed once and used three times — by the lead sentence, by the
   * attention card and by the fleet inventory's own Health/SLO column and
   * `?signal=` filter.
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
  const summary = summariseFleet(health)
  const needing = health.filter((h) => h.attention !== null)

  // STUDIO-100-002 / STUDIO-030-011. Filter first, then RANK, then page.
  //
  // The order matters and each step is wrong in any other position. Filtering
  // after paging would page a list nobody asked for; ranking after paging would
  // sort twenty-five arbitrary rows and leave the stalled tenant on page three.
  // Paging a filtered, ranked list is the only order that lets "showing 25 of 61
  // matching \"acme\"" be a true sentence AND puts the tenant that needs an
  // operator on the first screen.
  //
  // `byUrgency` is the one ranking of urgency in this console; the attention
  // list above and the inventory below are both ordered by it, so they cannot
  // disagree about which tenant is worst.
  const matching = tenants.filter((t) => matchesFilter(t, filter, healthBySlug.get(t.slug)))
  const ranked = rankFleetRows(
    matching,
    health.map((h) => h.slug),
  )
  const pageCount = Math.max(1, Math.ceil(ranked.length / INVENTORY_PAGE_ROWS))
  const page = Math.min(pageNumber, pageCount)
  const rows = ranked.slice((page - 1) * INVENTORY_PAGE_ROWS, page * INVENTORY_PAGE_ROWS)
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

  /*
   * The account this control plane holds credentials for, rendered beside the
   * cell so that column is a placement rather than a name.
   *
   * `controlPlaneIdentity` returns null when `AWS_ACCOUNT_ID` is unset, and this
   * used to interpolate that null straight into the cell — which printed
   * `· us-east-1` with an empty space where the account belongs. A blank is the
   * one thing an unknown must never render as: it reads as "no account", which
   * is a different and much calmer fact than "this console does not know which
   * account it is looking at".
   */
  const { accountId } = controlPlaneIdentity()
  const accountLabel = accountId ?? "account unknown"

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

  /*
   * The attention list's columns.
   *
   * Declared as data rather than written as `<tr><td>` so the header and the
   * body are derived from one thing. In a console printing account ids and
   * lifecycle states, a row shifted by one column is worse than a missing table.
   */
  const attentionColumns: readonly DataColumn<TenantHealth>[] = [
    {
      key: "tenant",
      header: "Tenant",
      cell: (h) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{h.slug}</span>
          {/*
            The tenant is the cell's TEXT, and the link beside it is named for
            what it opens.

            It used to be `<Link>{h.slug}</Link>`, which put a second link called
            `seed-nodeploy` on this page — the inventory below renders one with
            that exact name for the same tenant. Two links, one name, and nothing
            in either name saying which list it belongs to: a screen reader
            pulling up the links on this page announced the same tenant twice
            with no way to tell the attention list from the inventory.
            (Playwright's strict mode refuses it for the same reason a person
            would.)
          */}
          <Link
            href={`/tenants/${h.slug}`}
            aria-label={`Open the system that needs attention: ${h.attention?.replace(/-/g, " ")}`}
          >
            open
          </Link>
        </div>
      ),
    },
    { key: "state", header: "State", cell: (h) => h.state },
    {
      key: "needs",
      header: "Needs",
      cell: (h) => {
        // Why the badge says what it says. A row reading "dependency failing"
        // and nothing else is a row an operator has to leave the page to act on.
        const why = explainAttention(h)
        return (
          <div className={styles.cell}>
            {/* The tone is the signal's, not a blanket "warn": a FAILED tenant
                and a certificate that has already expired are the estate's two
                worst facts and they are drawn differently from a stall that may
                still resolve. The word is always beside the tone. */}
            <Badge tone={attentionTone(h.attention)}>{h.attention?.replace(/-/g, " ")}</Badge>
            {/* Which of the two sources said so. An operator reading
                "dependency failing" needs to know it came from AWS and not from
                a DynamoDB row before they decide where to look. */}
            <span className="md3-body-small">{describeSignals(h.signals)}</span>
            {why ? <span className="md3-body-small">{why}</span> : null}
          </div>
        )
      },
    },
    {
      key: "hours",
      header: "Hours since it moved",
      align: "end",
      cell: (h) => (h.hoursSinceChange === null ? "unknown" : h.hoursSinceChange.toFixed(0)),
    },
  ]

  /*
   * STUDIO-100-001 — seventeen columns, every one of them from the registry or
   * from a read of the estate, and never from a tenant's own database. Three are
   * deliberately probe states rather than blanks: data volume, resource count
   * and cost are not facts this control plane holds yet, and a blank cell reads
   * as zero.
   *
   * The seventeenth is `State last read`, and it is the one that stops the other
   * sixteen being unreadable. Nine of them are registry facts and two are
   * readings of the live estate; a row that prints both with no attribution is a
   * row whose `ACTIVE` and whose `dependency failing` look like one verdict from
   * one place, when in fact one is a DynamoDB row somebody last wrote in March
   * and the other is a certificate that expired this morning.
   *
   * `DataTable` puts them in a bounded scroller, because seventeen columns fit
   * at none of the widths `layout.spec.ts` measures and the page itself must
   * never be the thing that scrolls sideways.
   */
  const registryReadAt = readAt.toISOString()
  const fleetColumns: readonly DataColumn<FleetRow>[] = [
    {
      key: "tenant",
      header: "Tenant",
      cell: (t) => (
        <div className={styles.cell}>
          <Link className={styles.identifier} href={`/tenants/${t.slug}`}>
            {t.slug}
          </Link>
          <span className="md3-body-small">{t.displayName}</span>
        </div>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (t) => (
        <div className={styles.cell}>
          <span>{t.owner ?? "not recorded"}</span>
          {t.ownerSource ? (
            <span className="md3-body-small">{t.ownerSource.replace(/-/g, " ")}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "lifecycle",
      header: "Lifecycle",
      cell: (t) => (
        <div className={styles.cell}>
          {/* The tone comes from the lifecycle's own sets — SERVING, TERMINAL
              and the transitional list — rather than from a serving/not-serving
              boolean that painted DRAFT, READY and LEGAL_HOLD in the same
              warning tone as FAILED. See `lifecycleTone`. */}
          <Badge tone={lifecycleTone(t.state)} title={`Lifecycle state: ${t.state}`}>
            {t.state}
          </Badge>
          {t.lifecycle ? <span className="md3-body-small">{t.lifecycle}</span> : null}
        </div>
      ),
    },
    { key: "plan", header: "Plan", cell: (t) => t.planId ?? "not on a plan" },
    {
      key: "placement",
      header: "Cell / account / region",
      cell: (t) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{t.cellId ?? "unplaced"}</span>
          <span className="md3-body-small">
            {accountLabel} · {t.region ?? "region unknown"}
          </span>
        </div>
      ),
    },
    { key: "isolation", header: "Isolation", cell: (t) => t.isolation },
    {
      key: "release",
      header: "Release / config / schema",
      cell: (t) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{t.release ?? "no release"}</span>
          <span className="md3-body-small">
            rev {t.registryConfigRevision ?? "unknown"} ·{" "}
            {t.schemaVersion ?? "schema not published"}
          </span>
        </div>
      ),
    },
    {
      key: "health",
      header: "Health / SLO",
      cell: (t) => {
        const h = healthBySlug.get(t.slug)
        // Not "unobserved", which is a health signal with a meaning of its own.
        // This arm is the health pass having no record for the row at all.
        if (!h) return "no health record for this row"
        return (
          <div className={styles.cell}>
            <Badge tone={attentionTone(h.attention)}>{h.attention ?? "nothing to do"}</Badge>
            {/* Grouped under the source that produced each signal, rather than
                one comma-separated list mixing a DynamoDB row with a CloudWatch
                alarm. */}
            <span className="md3-body-small">{describeSignals(h.signals)}</span>
          </div>
        )
      },
    },
    { key: "activity", header: "Last activity", cell: (t) => t.updatedAt || "never recorded" },
    {
      key: "read",
      header: "State last read",
      cell: (t) => {
        const provenance = provenanceOf({
          registryReadAt,
          movedAt: t.updatedAt,
          observations: healthBySlug.get(t.slug)?.observations ?? [],
        })
        return (
          <div className={styles.cell}>
            {/*
              Two lines, each naming its own source. The registry is a DynamoDB
              row this console writes; the live estate is AWS, read from outside
              the tenant. They have different clocks and they disagree
              routinely — the row says ACTIVE for as long as nobody moves it,
              while the certificate in front of the tenant expires — so a single
              undifferentiated timestamp here would be worse than none.
            */}
            <span className={`${styles.provenance} md3-body-small`}>
              <b>registry</b> — {provenance.registry}
            </span>
            <span className={`${styles.provenance} md3-body-small`}>
              <b>live estate</b> — {provenance.estate}
            </span>
          </div>
        )
      },
    },
    /* STUDIO-000-007 probe states. Not blanks: a blank column in a cost table
       reads as zero, and this console has never measured either of these. */
    { key: "volume", header: "Data volume", align: "end", cell: () => "not measured" },
    { key: "resources", header: "Resources", align: "end", cell: () => "not inventoried" },
    { key: "spend", header: "Actual / forecast", align: "end", cell: () => costNote },
    {
      key: "drift",
      header: "Drift",
      cell: (t) =>
        t.registryConfigRevision === null || t.storeConfigRevision === null
          ? "not comparable"
          : t.registryConfigRevision === t.storeConfigRevision
            ? "in step"
            : `registry ${t.registryConfigRevision} · store ${t.storeConfigRevision}`,
    },
    {
      key: "blockers",
      header: "Blockers",
      cell: (t) => {
        const h = healthBySlug.get(t.slug)
        if (!h?.attention) return "none"
        return explainAttention(h) || h.attention.replace(/-/g, " ")
      },
    },
    {
      key: "next",
      header: "Next action",
      cell: (t) => {
        const next = nextStates(t.state)
        return next.length === 0 ? "terminal" : next.join(" / ")
      },
    },
    // Never render a paused tenant as free. GE-103-012.
    {
      key: "residual",
      header: "Cost note",
      cell: (t) => RESIDUAL_COST[t.state] ?? "no residual cost in this state",
    },
  ]

  /*
   * The systems bound in `blueprints/`, and only the real ones.
   *
   * `CUSTOMER_TENANT_BINDINGS` rather than `TENANT_BINDINGS`: three of the four
   * declared bindings are fixtures that exist to exercise the platform, and this
   * is a page an operator adopts a tenant from.
   */
  const fileBindings = CUSTOMER_TENANT_BINDINGS

  /*
   * Whether the registry answered at all — the one fact the adoption column
   * below cannot render without. "Not adopted" derived from a read that failed
   * is a claim made on the strength of an empty list, and it is the claim that
   * would send an operator to adopt a tenant that is already registered.
   */
  const registryAnswered = configured && !failure && !throttled

  const bindingColumns: readonly DataColumn<(typeof fileBindings)[number]>[] = [
    {
      key: "slug",
      header: "Tenant",
      cell: (b) => (
        <div className={styles.cell}>
          <span className={styles.identifier}>{b.slug}</span>
          <span className="md3-body-small">{b.displayName}</span>
        </div>
      ),
    },
    {
      key: "blueprint",
      header: "Blueprint",
      cell: (b) => <span className={styles.identifier}>{b.blueprintId}</span>,
    },
    {
      key: "adopted",
      header: "In the registry",
      cell: (b) =>
        !configured ? (
          "unknown — no registry is configured"
        ) : !registryAnswered ? (
          "unknown — the registry did not answer"
        ) : registeredSlugs.includes(b.slug) ? (
          <Badge tone="ok">in the registry</Badge>
        ) : (
          <Badge tone="warn">not adopted</Badge>
        ),
    },
  ]

  return (
    <div className={styles.page}>
      <h1 className="md3-headline-large">Tenants</h1>

      {/*
        The question, then the answer, then the apparatus — in that order and
        before anything else on the page.

        A `<p>` rather than a second heading, deliberately: an accessible name is
        matched by case-insensitive substring, so a heading containing the word
        "tenants" would make this page's own `<h1>` ambiguous to
        `getByRole("heading", { name: "Tenants" })` and to anything else reading
        the page by name — including a person using a screen reader's heading
        list.
      */}
      <p className={`${styles.question} md3-title-medium`}>{THE_QUESTION}</p>

      <p className="md3-body-large">
        {leadAnswer({
          throttled: throttled !== null,
          failure: failure !== null,
          configured,
          registered: tenants.length,
          serving: summary.serving,
          needingAttention: summary.needingAttention,
        })}
      </p>

      {/*
        GE-033-002 / STUDIO-120-003. Fleet health, from the registry AND from
        what was observed of the running system — certificate expiry, alarm
        state, when a backup was last verified. No tenant content is read to
        answer any of it, and a guard fails if that changes.

        First card on the page, because it is the answer. The inventory below is
        how you look something up; this is what tells you whether you need to.
      */}
      {registryAnswered && tenants.length > 0 ? (
        <Card
          headline="Fleet health"
          headerAside={
            <Badge tone={summary.needingAttention === 0 ? "ok" : "warn"}>
              {summary.needingAttention === 0
                ? "nothing needs attention"
                : `${summary.needingAttention} need attention`}
            </Badge>
          }
          /* The as-of, the cadence and what the observations were taken
             against. A health panel with none of the three is a set of claims
             that were true at some point, about something unnamed. */
          supportingText={
            <>
              Observed {observedAt.toISOString()}, re-read every{" "}
              {Math.round(HEALTH_REFRESH_MS / 1000)}s. {scope.against} Certificate expiry and alarm
              state come from AWS; a source that could not be read is reported as unobserved rather
              than counted healthy.{" "}
              <StaleIndicator
                asOf={observedAt.toISOString()}
                /* The reader's own refresh window, not a number chosen here: a
                   page that supplied its own would be describing a cadence
                   nothing implements. */
                cadenceMs={HEALTH_REFRESH_MS}
                now={observedAt.getTime()}
                label="the fleet observation"
              />
            </>
          }
        >
          <div className={styles.chipRow}>
            <Chip>
              <b>{summary.serving}</b> serving
            </Chip>
            {Object.entries(summary.bySignal)
              .filter(([signal, count]) => count > 0 && signal !== "serving")
              .map(([signal, count]) => (
                <Chip key={signal}>
                  <b>{count}</b> {signal.replace(/-/g, " ")}
                </Chip>
              ))}
            {/*
              How much of the fleet the chips beside this are actually a
              measurement of. `12 serving` over a fleet nobody could observe is
              twelve DynamoDB rows wearing the clothes of a health check, and
              this is the number that says so.
            */}
            <Chip>
              <b>{observedCount(health)}</b> of {summary.total} observed
            </Chip>
          </div>

          {/*
            STUDIO-000-007. A read that could not be taken, named once — not
            twenty times as an `unobserved` cell whose remedy nobody can guess.
            `unknownReadings` returns only the arms of `AwsRead` that carry no
            value, so a reading that worked cannot reach this and produce a
            spurious denial; a denial that did happen renders the principal, the
            action, the account and the minimum IAM statement as pasteable JSON.
          */}
          {unreadable.map((reading) => (
            <UnknownState
              key={reading.key}
              what={reading.what}
              read={reading.read}
              now={observedAt.getTime()}
            />
          ))}

          {needing.length > 0 ? (
            <DataTable
              caption="Tenants needing an operator, worst first"
              columns={attentionColumns}
              rows={needing}
              rowKey={(h) => h.slug}
              /* Unreachable — this arm renders only when `needing` is non-empty
                 — and written out anyway, because the alternative is a `null`
                 that turns into a blank row the day the guard above changes. */
              empty={
                <EmptyState
                  headline="Nothing needs an operator"
                  description="No registered tenant carries a signal an operator should act on."
                />
              }
            />
          ) : (
            <EmptyState
              headline="Nothing needs an operator"
              description={`All ${summary.total} registered tenants are inside their lifecycle and nothing observable came back bad. That is a statement about the ${observed.size} tenants observed at ${observedAt.toISOString()}, not a promise about the next hour.`}
            />
          )}
        </Card>
      ) : null}

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
            <span className="md3-body-small">
              Most likely: the task role is missing an action on the table, or the table does not
              exist in this region.
            </span>
          }
        />
      ) : !configured ? (
        // GE-022-006. Not an error — a deliberate degradation. The file-bound
        // tenants below are real and complete; what is missing is the registry,
        // and naming it is the difference between "the fleet is the card below"
        // and "the fleet is the card below PLUS whatever the registry holds".
        <PartialDataState what="The fleet" missing={["TENANT_TABLE — the tenant registry"]} />
      ) : (
        <Card
          /*
           * Not "Registered tenants", which was the first draft and was a
           * defect. `getByRole("heading", { name: "Tenants" })` matches an
           * accessible name by case-insensitive SUBSTRING, so a card headline
           * containing the word made the page's own `<h1>` ambiguous — two
           * headings, one query, and `e2e/operator-roles.spec.ts:63` refusing
           * the page under strict mode. A heading is part of the page's API to
           * anything that reads it by name, including a person using a screen
           * reader's heading list.
           *
           * It is also the more accurate of the two: the card holds what came
           * through this console, and the card below it holds what did not.
           */
          headline="Provisioned through this console"
          headerAside={<Badge tone="info">{tenants.length}</Badge>}
          supportingText={
            <>
              As of {registryReadAt} — this request read the registry table directly, so nothing
              here is held from an earlier one. Listed worst first: the ranking is the same one the
              attention list above uses, so a tenant stuck mid-provision is on the first page rather
              than wherever its partition happened to hash to. Every column comes from a registry
              row or from a read of the estate, and the <b>State last read</b> column says which for
              each tenant; none of it is read from a tenant&rsquo;s own database. Data volume,
              resource count and spend are not facts this control plane holds, and those three
              columns say so rather than showing a zero.
            </>
          }
          actions={
            tenants.length > 0 && mayCompose ? (
              <ButtonLink variant="filled" href="/tenants/new">
                Compose a tenant
              </ButtonLink>
            ) : undefined
          }
        >
          {/*
            STUDIO-100-002. Search and filter, submitted as a GET so the result
            is a URL. Saving a filter is saving the link, which needs no storage
            and makes every filter shareable — the thing an operator actually
            wants from a "saved filter" during an incident.
          */}
          <form className={styles.filter} method="get" action="/tenants">
            {/*
              `TextField` and `Select`, not the console's older `.field` markup.
              The primitives carry the label placement, the focus ring and the
              state layer that `e2e/preferences.spec.ts` measures the contrast of
              in four theme and contrast combinations; a hand-rolled
              `<div class="field"><label><input>` is a control the audit cannot
              see, in the file it is least likely to be pointed at.
            */}
            {/*
              All three fields carry a supporting line, so all three are the
              same height and the row bottom-aligns cleanly against the buttons.
              One field taller than its neighbours pushes its own input out of
              line with theirs, which at 900 CSS pixels reads as a rendering
              fault rather than as a hint.
            */}
            <TextField
              id="q"
              name="q"
              type="search"
              label="Search"
              defaultValue={filter.q}
              supportingText="Matches slug, name, owner, plan and cell."
            />
            <Select
              id="signal"
              name="signal"
              label="Signal"
              supportingText="The signals counted above, from either source."
              defaultValue={filter.signal ?? ""}
              /*
               * The empty option is a real choice, not a placeholder. "Any
               * signal" is what an unset `?signal=` means, and a reader who has
               * narrowed to `stalled` must be able to choose it again — which a
               * disabled placeholder option would not let them do.
               */
              options={[
                { value: "", label: "any signal" },
                ...Object.keys(summary.bySignal).map((s) => ({
                  value: s,
                  label: s.replace(/-/g, " "),
                })),
              ]}
            />
            <TextField
              id="state"
              name="state"
              label="State"
              defaultValue={filter.state ?? ""}
              placeholder="ACTIVE"
              supportingText="One of the 25 lifecycle states, as the registry spells it."
            />
            <div className={styles.controls}>
              <Button variant="tonal" type="submit">
                Apply
              </Button>
              {isFiltered(filter) ? (
                <ButtonLink variant="text" href="/tenants">
                  Clear
                </ButtonLink>
              ) : null}
            </div>
          </form>

          {tenants.length === 0 ? (
            <GovernedEmptyState
              what="tenants composed through this console"
              because="Composing one registers it in DRAFT: nothing is built, nothing is billed, and no routing changes until its plan is read and approved."
              actions={
                mayCompose ? (
                  <ButtonLink variant="filled" href="/tenants/new">
                    Compose a tenant
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : matching.length === 0 ? (
            // Two nothings, told apart. `because` is what distinguishes "no
            // tenants exist" from "none match what you asked for", which are the
            // same screen and completely different facts.
            <GovernedEmptyState
              what={`tenants ${describeFilter(filter)}`}
              because={`${tenants.length} tenants are registered; none match this filter. Clear it to see them.`}
              actions={
                <ButtonLink variant="tonal" href="/tenants">
                  Clear the filter
                </ButtonLink>
              }
            />
          ) : (
            <>
              {/* Never let a truncated table read as a complete one. */}
              <p className="md3-body-small" data-testid="fleet-count">
                {showingOf(rows.length, matching.length, isFiltered(filter) ? "matching tenants" : "tenants")}
                {isFiltered(filter) ? ` (${describeFilter(filter)}, of ${tenants.length} registered)` : ""}
              </p>

              <DataTable
                caption="Tenants registered in this console"
                columns={fleetColumns}
                rows={rows}
                rowKey={(t) => t.slug}
                /* Unreachable while the two `EmptyState` arms above stand, and
                   written out rather than left `null` for the same reason. */
                empty={
                  <EmptyState
                    headline="No tenants on this page"
                    description="The filter and the page number together select nothing. Clear the filter, or go back a page."
                  />
                }
              />

              {pageCount > 1 ? (
                <div className={styles.controls}>
                  <span className="md3-label-large">
                    Page {page} of {pageCount}
                  </span>
                  {page > 1 ? (
                    <ButtonLink variant="outlined" href={`/tenants${queryFor({ page: String(page - 1) })}`}>
                      Previous page
                    </ButtonLink>
                  ) : null}
                  {page < pageCount ? (
                    <ButtonLink variant="outlined" href={`/tenants${queryFor({ page: String(page + 1) })}`}>
                      Next page
                    </ButtonLink>
                  ) : null}
                </div>
              ) : null}

              {/*
                STUDIO-100-002. The export carries only what THIS operator is
                authorized to see, and writes an audit row naming what left. The
                projection is server-side, in the route — a link that filtered
                client-side would be a link anyone could edit.

                A plain anchor rather than a Button: `next/link` navigates on the
                client, which cancels the download this is for.
              */}
              <p className="md3-body-small">
                <a href={`/api/aws/fleet${queryFor({ format: "csv" })}`} download>
                  Export this view as CSV
                </a>{" "}
                — only the tenants your role may read, with an audit row naming what was exported.
              </p>
            </>
          )}
        </Card>
      )}

      <Card
        headline="Configured by file"
        headerAside={<Badge tone="neutral">{fileBindings.length}</Badge>}
        supportingText={
          <>
            As of this build. These predate the registry, are bound in <code>blueprints/</code> and
            are compiled in rather than read at request time, so this card does not change until the
            console is rebuilt. They are listed apart from the registry because they were not
            provisioned through this console, and showing them in the same table would imply a
            lifecycle they never went through.
          </>
        }
      >
        <DataTable
          caption="Systems bound in blueprints/"
          columns={bindingColumns}
          rows={fileBindings}
          rowKey={(b) => b.slug}
          empty={
            <EmptyState
              headline="No systems are bound by file"
              description="Every configured system reached this console through the registry. Nothing here predates it."
            />
          }
        />

        {adoptable.length > 0 && configured && mayAdopt ? (
          placeableRegionsOrNull ? (
            <AdoptForm bindings={adoptable} plans={planOptions} regions={placeableRegionsOrNull} />
          ) : (
            <p className="md3-body-small">
              {adoptable.length} of these could be adopted into the registry, and the form is not
              drawn: this console could not read the cell record, so it does not know which regions
              a tenant may be placed in — and an adoption that guessed a region would write a
              registry row claiming a placement that may not exist. Set{" "}
              <code>AWS_ACCOUNT_ID</code>, <code>AWS_REGION</code> and <code>AWS_PARTITION</code>,
              or give the task role <code>sts:GetCallerIdentity</code>, and reload.
            </p>
          )
        ) : null}
      </Card>
    </div>
  )
}
