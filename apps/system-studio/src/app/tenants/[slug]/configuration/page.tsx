import { notFound, redirect } from "next/navigation"

import { auth } from "@/lib/auth"
import { authorizeCommand } from "@/lib/authorize"
import { getTenant, registryConfigured } from "@/lib/registry"
import { DynamoConfigStore } from "@/lib/config-store"
import { editableDomains, reservedDomains, withheldDomains } from "@/lib/editable-config"
import {
  configurationChangeDiff,
  dependantsOf,
  dependencyGraph,
  renderComparison,
  rollbackChangeDiff,
  rollbackSummary,
  summarise,
} from "@/lib/revisions"
import { MODULES } from "@tenure/modules"
import {
  CONFIG_DOMAINS,
  domainOf,
  isChargeable,
  resolveConfig,
  type ConfigLayer,
  type ConfigRecord,
  type OptionPrice,
} from "@tenure/configuration"
import { REGISTRY, layersFor } from "@tenure/platform-config"
import { toDecimal, type Money, type RunningTotal } from "@tenure/finops"
import {
  EmptyState as GovernedEmptyState,
  PartialDataState,
  PermissionDeniedState,
  UnknownState,
} from "@/components/states"
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Chip,
  DataTable,
  EmptyState,
  KeyValue,
  TextField,
} from "@/components/md3"
import {
  billDelta,
  changeCostsByDomain,
  changeSpread,
  signedAmount,
  type ChangeSpread,
  type ConfigurableOption,
  type DomainChangeCosts,
} from "./change-cost"
import { RollbackControls } from "./RollbackControls"
import { ConfigurationEditor } from "./ConfigurationEditor"

export const dynamic = "force-dynamic"

/**
 * GE-032-001 — the tenant configuration editor and its priced running total.
 *
 * Which fields exist is derived from the domain registry and the platform
 * definitions, never listed here. Three of the fourteen surfaces the item names
 * have keys today; the other eleven are shown as reserved or withheld with the
 * reason, because an administrator who cannot find where to change something
 * deserves to be told it is not theirs to change rather than left searching.
 *
 * ── The question this page answers ─────────────────────────────────────────
 *
 *   *What is this tenant configured to do, what does that cost, and what would
 *   changing it cost?*
 *
 * It is written at the top in words, and then answered in that order:
 *
 *   1. **What it is configured to do** — the live revision, when it was
 *      published, and how many keys it overrides.
 *   2. **What that costs** — the running total, per seat and per organisation,
 *      the resolver's figure and not a sum of the rows below it.
 *   3. **What changing it would cost** — the DELTA, per option, against what
 *      this tenant is paying today. An edit to a live tenant is a change to a
 *      bill, and a form that prices each option but never says which way the
 *      bill moves makes the operator do that arithmetic themselves, in their
 *      head, immediately before pressing Publish.
 *
 * The apparatus that CHANGES the configuration comes after all three, because
 * an editor is apparatus. Six flat `section.system` blocks, each a wall of
 * rows, is the shape an operator called "a construction site".
 *
 * ── Grouped by domain, not by schema shape ─────────────────────────────────
 *
 * Options are grouped by the domain that GOVERNS them — `organization`,
 * `modules`, `relay` — which is the vocabulary the bible names and the same
 * vocabulary the withheld list, the diff and the authority checks use. Grouping
 * by input type (three text boxes, then two numbers) would be grouping by an
 * implementation detail of the form.
 *
 * ── Three clocks, not one ──────────────────────────────────────────────────
 *
 * Every card states what it is AS OF, and they genuinely differ:
 *
 *   * the REGISTRY read — a DynamoDB Query made when this request was served;
 *   * the published REVISION — a fact frozen at `publishedAt`, which is what
 *     the running total is priced from;
 *   * the DEPLOYMENT — the option prices, the module graph and the withheld
 *     list are compiled into this build and change only when it is replaced.
 *
 * Collapsing those into one "last updated" would put a fresh timestamp on a
 * price list that has not been re-read since the container started.
 *
 * ── Material 3 ─────────────────────────────────────────────────────────────
 *
 * Every primitive comes from `components/md3`. This file declares no colour, no
 * shadow and no font size: the type scale is the `md3-*` role classes, elevation
 * is `Surface`'s `level`, and hover/focus/pressed is the `md3-state` layer those
 * primitives already carry. The only CSS this page owns is the handful of
 * LAYOUT rules below, which is the same device `components/Nav.tsx` uses — a
 * rule for a class only this file emits, kept beside the markup that emits it.
 */

/**
 * Layout only, and tokens only.
 *
 * Hoisted into `<head>` by React 19 and deduplicated on `href`, so it is one
 * stylesheet however many times this renders. There are no physical directions
 * here — `layout.spec.ts` flips `dir` to `rtl` on the live document and re-runs
 * its overlap detector, so a `margin-left` would red it — and no literal
 * colours, because the contrast audit can only measure what it can find.
 *
 * `min-inline-size: 0` on the quote row's items is load-bearing rather than
 * defensive: a flex item defaults to `min-width: auto`, so a long hint sets the
 * track's minimum to its own intrinsic width and pushes the form past the card
 * edge at 320 CSS pixels, which is exactly the spill `layout.spec.ts` measures.
 */
const PAGE_CSS = `
.configuration-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.configuration-page > header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-4);
}
.configuration-page > header > h1 {
  margin: 0;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.config-question {
  margin: 0;
  max-inline-size: 52rem;
  overflow-wrap: anywhere;
}
.config-answer {
  margin: var(--space-2) 0 0;
  max-inline-size: 52rem;
  color: var(--md-sys-color-on-surface-variant);
  overflow-wrap: anywhere;
}
.config-figure {
  margin: 0;
  overflow-wrap: anywhere;
}
.config-figure-note {
  margin: var(--space-1) 0 0;
  color: var(--md-sys-color-on-surface-variant);
  overflow-wrap: anywhere;
}
.config-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block: var(--space-3);
}
.config-quote {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3);
  margin-block: var(--space-3);
}
.config-quote > .md3-field {
  margin: 0;
  min-inline-size: 0;
  flex: 0 1 14rem;
}
.config-quote > .config-quote-hint {
  flex: 1 1 100%;
  min-inline-size: 0;
  margin: 0;
  max-inline-size: 46rem;
  color: var(--md-sys-color-on-surface-variant);
  overflow-wrap: anywhere;
}
.config-subhead {
  margin: var(--space-4) 0 var(--space-2);
  overflow-wrap: anywhere;
}
.config-note {
  margin: var(--space-2) 0 0;
  max-inline-size: 46rem;
  color: var(--md-sys-color-on-surface-variant);
  overflow-wrap: anywhere;
}
.config-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.config-domain-group {
  margin-block-start: var(--space-4);
}
.config-diagnostic > summary {
  cursor: pointer;
  min-block-size: var(--tap);
  color: var(--md-sys-color-on-surface-variant);
  overflow-wrap: anywhere;
}
/*
 * The configuration map is a column flex box with a max-block-size and
 * overflow:auto, and its links carry an explicit min-height of one tap target.
 * That explicit minimum REPLACES the automatic min-height:auto which is the
 * only thing stopping a column flex item from being squeezed below the height of
 * its own content — so once the map's content passes the cap, every link is
 * shrunk to the tap target and each one's wrapped description is painted out the
 * bottom of its own box, on top of the next link's domain name.
 *
 * It is only reachable in a middle band of widths: at 1440 and 1180 CSS pixels
 * the map's grid column is wide enough that a description is two lines, and
 * under 760 the media query in globals.css drops the cap entirely. At 900 the
 * column is clamped to its 13rem floor, every description wraps to ten lines or
 * more, and the map lands within a few dozen pixels of its own maximum — which
 * side of it depends on the platform's font metrics. CI is the side that
 * overlaps.
 *
 * What CI measured, in configuration-surface.spec.ts's overlap detector — the
 * test is named for 320 CSS pixels but walks four widths and threw at the third:
 *
 *     "Which modules and features are enabled, their rollout, and t" over "relay"
 *     "Locale, currency, calendar, working days, holidays, and text" over "branding"
 *
 * Both are a description painted over the NEXT link's domain name, which is the
 * signature of the squeeze above rather than of a margin.
 *
 * A scroll container scrolls its items; it does not compress them. Stated as a
 * child selector so it outranks the one-class rule in globals.css whichever
 * order the two sheets land in.
 */
.config-map > .config-map-link {
  flex-shrink: 0;
}
`

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
 * The capabilities this console publishes configuration WITH.
 *
 * Empty, and empty as a statement of fact rather than as a placeholder:
 * `review` and `publish` in `./actions.ts` call `planPublication` without
 * `publisherCapabilities`, and that parameter's documented default is the empty
 * set — "a definition declaring `requiresCapability` is unpublishable until a
 * caller says who is publishing and what they hold". Nothing in
 * `apps/system-studio` maps an operator role to a configuration capability
 * today; `PLATFORM_OPERATORS` carries `email:role`, and a role is not a
 * capability.
 *
 * So the honest thing for this page to render is that every capability-gated
 * option is locked, with the capability named. Inventing a set here — mapping
 * `platform-super-admin` to "holds everything", say — would make the page
 * disagree with the engine that actually refuses the publication, and the page
 * would be the optimistic one.
 *
 * The day the publish path passes real capabilities, this constant is where
 * they are read from, and the lock disappears on its own.
 */
const HELD_CAPABILITIES: readonly string[] = []

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

/** Whether the operator stated a seat count, as opposed to falling back to one. */
function seatsWereStated(raw: string | string[] | undefined): boolean {
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isInteger(value) && value > 0 && value <= 1_000_000
}

/**
 * The IAM statement that makes this page's registry reads possible.
 *
 * Written out rather than described, because `UnknownState` takes JSON an
 * operator pastes into a policy and a prose description is the version that
 * gets read, agreed with, and not acted on.
 */
function minimumRegistryStatement(): string {
  return JSON.stringify(
    {
      Effect: "Allow",
      Action: ["dynamodb:Query"],
      Resource: `arn:${process.env.AWS_PARTITION ?? "aws"}:dynamodb:*:${
        process.env.AWS_ACCOUNT_ID ?? "*"
      }:table/${process.env.TENANT_TABLE ?? "<TENANT_TABLE>"}`,
    },
    null,
    2,
  )
}

/** An exception, reduced to the two things an operator can act on. */
function reasonOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/**
 * Where a key's domain sits in the registry's order.
 *
 * The order the bible declares, so the priced rows below come out grouped the
 * way the rest of this page talks about configuration. A key governed by no
 * domain sorts last rather than first — it is a defect in the build, and a
 * defect at the top of a cost table reads as the most important line in it.
 */
function domainRank(key: string): number {
  const domain = domainOf(key)
  if (!domain) return CONFIG_DOMAINS.length
  const index = CONFIG_DOMAINS.findIndex((candidate) => candidate.id === domain.id)
  return index === -1 ? CONFIG_DOMAINS.length : index
}

/** The domain that governs a key, in the operator's language. */
function domainLabel(key: string): string {
  return domainOf(key)?.id ?? "governed by no domain — a defect in this build"
}

/** The delta column, as a sentence rather than as a sign. */
function effectSentence(direction: "adds" | "removes" | "unchanged", delta: Money): string {
  if (direction === "unchanged") return "no change to the bill"
  return `${direction} ${signedAmount(delta)}`
}

/**
 * The lead answer, assembled from what was actually read.
 *
 * Every clause is guarded on the fact behind it existing. A sentence that says
 * "it costs nothing" because a read failed is the defect this whole console is
 * built against, so an unknown says unknown.
 */
function leadAnswer(input: {
  historyError: string | null
  revision: number | null
  publishedAt: string | null
  publishedBy: string | null
  overriddenKeys: number
  total: Money | null
  seats: number
  seatsStated: boolean
  spread: ChangeSpread | null
}): string {
  const configured = input.historyError
    ? "What this tenant is configured to do is NOT KNOWN — the registry refused the read that would say."
    : input.revision === null
      ? "Nothing has ever been published for this tenant, so it runs on the platform defaults exactly."
      : `Revision ${input.revision}, published ${input.publishedAt} by ${input.publishedBy}, overriding ` +
        `${input.overriddenKeys} key${input.overriddenKeys === 1 ? "" : "s"}.`

  const costs = input.total
    ? `It costs ${amount(input.total)} a month at ${input.seats} seat${input.seats === 1 ? "" : "s"}` +
      `${input.seatsStated ? "" : ", a seat count nobody has stated"}.`
    : "What it costs is not known — the configuration below does not resolve, so there is no total to quote."

  const changing = !input.spread
    ? "What changing it would cost cannot be quoted until the configuration resolves."
    : input.spread.largestAddition
      ? `The most expensive single change available here would add ${amount(input.spread.largestAddition.amount)} ` +
        `a month; ${input.spread.locked} of ${input.spread.priced} option${input.spread.priced === 1 ? "" : "s"} ` +
        `are not this console's to change.`
      : `No option on this page moves the bill in either direction; ${input.spread.locked} of ` +
        `${input.spread.priced} are not this console's to change in any case.`

  return `${configured} ${costs} ${changing}`
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
  const principalId = session.user.email

  const { slug } = await params

  // STUDIO-020-006. Reading a tenant's configuration and changing it are two
  // permissions. A Support Engineer and an Auditor hold the first; the editor
  // and the rollback controls below belong to the second, and are not rendered
  // for anybody who does not hold it.
  const read = authorizeCommand("configuration.read", { principalId, tenantId: slug })
  if (!read.allowed) return <PermissionDeniedState />
  const mayPublish = authorizeCommand("configuration.publish", { principalId, tenantId: slug }).allowed

  const query = await searchParams
  const seats = seatsFrom(query.seats)
  const seatsStated = seatsWereStated(query.seats)
  if (!registryConfigured()) {
    return <PartialDataState what="Configuration" missing={["TENANT_TABLE — the tenant registry"]} />
  }

  /*
   * The clock every "read from the registry" line on this page is quoted
   * against. Taken once, before the reads, so two panels cannot disagree about
   * when the same Query happened.
   */
  const readAt = new Date().toISOString()

  /*
   * The console must keep booting without AWS credentials.
   *
   * Both reads below go to DynamoDB, and an unreachable or unauthorised
   * DynamoDB threw straight out of the component — which Next renders as a 500,
   * i.e. a blank page for a console whose entire job is to say what is and is
   * not known. A refusal is a FACT about the estate and belongs on the page as
   * UNKNOWN, with the statement that would fix it. Nothing here invents a
   * fallback value: an unknown tenant is not a tenant with no revisions.
   */
  let tenant: Awaited<ReturnType<typeof getTenant>> = null
  let tenantError: string | null = null
  try {
    tenant = await getTenant(slug)
  } catch (error) {
    tenantError = reasonOf(error)
  }
  // Outside the catch: `notFound()` signals by throwing, and swallowing that
  // would turn "no such tenant" into "AWS refused the read".
  if (!tenantError && !tenant) notFound()

  let history: readonly ConfigRecord[] = []
  let historyError: string | null = null
  if (!tenantError) {
    try {
      history = await new DynamoConfigStore().history(slug)
    } catch (error) {
      historyError = reasonOf(error)
    }
  }

  if (tenantError) {
    return (
      <div className="configuration-page">
        <style href="tenure-studio-configuration" precedence="high">
          {PAGE_CSS}
        </style>
        <header>
          <h1 className="md3-headline-large">{slug}</h1>
          <ButtonLink href={`/tenants/${slug}`} variant="text">
            ← Back to the tenant
          </ButtonLink>
        </header>
        <p className="config-question md3-title-medium">
          What is this tenant configured to do, what does that cost, and what would changing it
          cost?
        </p>
        <p className="config-answer md3-body-large">
          None of the three is known. The tenant registry could not be read at {readAt}, and a
          refused read is not an empty configuration.
        </p>
        <Card
          headline="Configuration"
          headerAside={<Badge tone="warn">unknown</Badge>}
          supportingText={`The tenant registry could not be read at ${readAt}. Nothing below is known — not the revision, not the running total, and not whether this tenant exists.`}
        >
          <UnknownState
            what="this tenant's registry record"
            principal="this engine's task role — the page does not call sts:GetCallerIdentity, so the ARN is not known here"
            action="dynamodb:Query"
            minimumStatement={minimumRegistryStatement()}
            errorCode={tenantError}
            accountId={process.env.AWS_ACCOUNT_ID ?? null}
            region={process.env.AWS_REGION ?? null}
            partition={process.env.AWS_PARTITION ?? null}
          />
        </Card>
      </div>
    )
  }

  const latest = history.length === 0 ? null : history[history.length - 1]
  const domains = editableDomains()
  const revisions = summarise(history)
  const graph = dependencyGraph(MODULES)

  // The most recent change, compared. Two revisions is the common question —
  // "what did the last publication actually do" — and it needs no controls.
  const previous = history.length >= 2 ? history[history.length - 2] : null
  // STUDIO-060-003. The document first, the sentence derived from it — so the
  // string an operator reads and the JSON anything else reads cannot disagree
  // about what changed.
  const lastChangeDiff = previous && latest ? configurationChangeDiff(previous, latest) : null
  const lastChange = lastChangeDiff ? renderComparison(lastChangeDiff) : null

  // STUDIO-060-003, the rollback arm. Every revision the control offers, with
  // what returning to it would actually do — computed here, from the live
  // revision, so the operator picking from the dropdown is told the consequence
  // BEFORE pressing the button rather than reading it in the history
  // afterwards. `live → target`, so `before` is what is running now.
  const rollbackPreviews = latest
    ? history
        .filter((record) => record.revision !== latest.revision)
        .map((record) => {
          const diff = rollbackChangeDiff(latest, record)
          return {
            revision: record.revision,
            summary: rollbackSummary(diff, record.revision),
            changed: diff.entries.length,
            rendered: renderComparison(diff),
          }
        })
    : []

  /* ------------------------------------------------------------- §7 pricing --
   * What this tenant's configuration costs, per seat and for the organisation,
   * and what each available change would do to that.
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
   *
   * The whole block is guarded. `layersFor` throws on a binding that names a
   * blueprint this build does not have, and `runningTotal` throws on a price in
   * a currency it refuses — both are defects in the DEPLOYMENT rather than facts
   * about this tenant, and neither is a reason for an operator to get a blank
   * page instead of a configuration screen.
   */
  let runningCost: RunningTotal | null = null
  let baselineTotal: Money | null = null
  let changeGroups: readonly DomainChangeCosts[] = []
  let spread: ChangeSpread | null = null
  let overriddenKeys = 0
  /** Monthly bill per published revision, at the stated seat count. */
  const revisionTotals = new Map<number, Money>()
  /** Keys the editor offers that the registry has no definition for. */
  const undefinedKeys: string[] = []
  let pricingError: string | null = null

  try {
    const fileLayers: ConfigLayer[] = layersFor(slug)
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
    runningCost = resolved?.runningCost ?? null
    overriddenKeys = latest ? Object.keys(latest.values).length : 0

    // What this tenant would be billed WITHOUT its own published revision —
    // the same file layers, the same seat count, the resolver's own figure. The
    // difference between the two is what this tenant's published choices cost,
    // which is a delta an operator can act on and cannot get anywhere else.
    baselineTotal = resolveConfig(REGISTRY, fileLayers, { collectProblems: true, seats }).config
      ?.runningCost.total ?? null

    // Every published revision, priced. A rollback IS an edit to a live tenant,
    // so it is a change to a bill, and the amount belongs beside the button that
    // performs it rather than on next month's invoice.
    for (const record of history) {
      const at = resolveConfig(
        REGISTRY,
        [
          ...fileLayers,
          { scope: "tenant" as const, id: slug, label: `revision ${record.revision}`, values: record.values },
        ],
        { collectProblems: true, seats },
      ).config
      if (at) revisionTotals.set(record.revision, at.runningCost.total)
    }

    if (resolved) {
      const options: ConfigurableOption[] = []
      for (const entry of domains) {
        for (const field of entry.fields) {
          const definition = REGISTRY.get(field.key)
          if (!definition) {
            // The editor offers a key the registry does not define. It cannot be
            // priced and it cannot be published; it is named rather than dropped.
            undefinedKeys.push(field.key)
            continue
          }
          options.push({
            key: field.key,
            description: field.description,
            domainId: entry.domain.id,
            domainGoverns: entry.domain.governs,
            price: field.price,
            // The ENGINE's rule for what is being charged, applied to the value
            // that actually resolved. A second copy of it here would be a second
            // answer to "why am I being billed for this".
            chargedToday: isChargeable(definition, resolved.values[field.key]),
            requiresCapability: definition.requiresCapability ?? null,
            input: field.input,
          })
        }
      }
      changeGroups = changeCostsByDomain(options, seats, HELD_CAPABILITIES)
      spread = changeSpread(changeGroups)
    }
  } catch (error) {
    pricingError = reasonOf(error)
  }

  /** What today's bill would move by if this tenant's revision were withdrawn. */
  const revisionBillDelta =
    baselineTotal && runningCost ? billDelta(baselineTotal, runningCost.total) : null

  /**
   * What the money on this page is priced FROM, in one sentence.
   *
   * Four cases and they are genuinely different: a pricing failure means no
   * figure is quoted at all; a refused history read means the tenant's own
   * overlay is unknown and the total below is the platform default rather than
   * this tenant's; no revision means the total is correct AND the tenant has
   * never published; a revision means the total is frozen at that publication.
   */
  const pricedAsOf = pricingError
    ? "Priced from NOTHING — the configuration for this tenant could not be resolved, so no figure " +
      "below is quoted. The reason is stated in the panel."
    : historyError
      ? "Priced from the platform defaults ALONE — this tenant's published revision could not be read, " +
        "so anything it changes is missing from the figure below."
      : latest
        ? `Priced from revision ${latest.revision}, published ${latest.publishedAt} by ${latest.publishedBy}. ` +
          "Option prices are compiled into this deployment and change only when it is replaced."
        : "Priced from the platform defaults. Nothing has ever been published for this tenant, which is a " +
          "real absence rather than a failed read."

  return (
    <div className="configuration-page">
      {/*
        Hoisted into <head> by React 19 and deduplicated on `href`. See PAGE_CSS
        above for why the layout for this route lives beside the route.
      */}
      <style href="tenure-studio-configuration" precedence="high">
        {PAGE_CSS}
      </style>

      <header>
        <h1 className="md3-headline-large">{tenant!.manifest.displayName}</h1>
        <ButtonLink href={`/tenants/${slug}`} variant="text">
          ← Back to the tenant
        </ButtonLink>
      </header>

      {/* ── The question, then the answer, before any apparatus ──────────── */}
      <p className="config-question md3-title-medium" data-testid="configuration-question">
        What is this tenant configured to do, what does that cost, and what would changing it cost?
      </p>
      <p className="config-answer md3-body-large" data-testid="configuration-answer">
        {leadAnswer({
          historyError,
          revision: latest?.revision ?? null,
          publishedAt: latest?.publishedAt ?? null,
          publishedBy: latest?.publishedBy ?? null,
          overriddenKeys,
          total: runningCost?.total ?? null,
          seats,
          seatsStated,
          spread,
        })}
      </p>

      {/* ── The answer, first ──────────────────────────────────────────────
          What an operator opens this page to learn: what this tenant is
          configured as, and what that costs per month. The form that CHANGES
          it is below, because an editor is apparatus. */}
      <Card
        id="running-total"
        headline="What this costs"
        headerAside={
          historyError ? (
            <Badge tone="warn" title="The published revision could not be read.">
              revision unknown
            </Badge>
          ) : (
            <Badge tone={latest ? "info" : "neutral"}>
              {latest ? `revision ${latest.revision}` : "never published"}
            </Badge>
          )
        }
        supportingText={pricedAsOf}
      >
        {!runningCost ? (
          <PartialDataState
            what="The running total"
            missing={[
              pricingError
                ? `the configuration did not resolve — ${pricingError}`
                : "a configuration that resolves — the published revision has problems, listed by the editor below",
            ]}
          />
        ) : (
          <>
            <p className="config-figure md3-headline-medium">{amount(runningCost.total)}</p>
            <p className="config-figure-note md3-body-medium">
              per month, for {runningCost.seats} seat{runningCost.seats === 1 ? "" : "s"}
              {seatsStated ? "" : " — a seat count nobody has stated"}
            </p>

            <div className="config-chip-row">
              <Chip>
                <b>{amount(runningCost.perSeat)}</b> per seat
              </Chip>
              <Chip>
                <b>{amount(runningCost.organization)}</b> for the organisation
              </Chip>
              <Chip>
                <b>{amount(runningCost.total)}</b> running total, per month
              </Chip>
            </div>

            <form method="get" className="config-quote">
              <TextField
                id="seats"
                name="seats"
                label="Seats"
                type="number"
                min="1"
                max="1000000"
                defaultValue={runningCost.seats}
              />
              <Button type="submit" variant="tonal">
                Re-quote
              </Button>
              <p className="config-quote-hint md3-body-small">
                No seat count is recorded against a tenant anywhere in the registry, so this one is
                stated rather than guessed. The total above is for exactly{" "}
                <b>{runningCost.seats}</b> seat{runningCost.seats === 1 ? "" : "s"}.
              </p>
            </form>

            <DataTable
              caption={`Every option that carries a charge, grouped by the domain that governs it, priced at ${
                runningCost.seats
              } seat${runningCost.seats === 1 ? "" : "s"}`}
              rows={[...runningCost.lines].sort(
                (left, right) =>
                  domainRank(left.key) - domainRank(right.key) || (left.key < right.key ? -1 : 1),
              )}
              rowKey={(line) => line.key}
              columns={[
                { key: "domain", header: "Domain", cell: (line) => domainLabel(line.key) },
                { key: "option", header: "Option", cell: (line) => line.key },
                {
                  key: "perSeat",
                  header: "Per seat",
                  align: "end",
                  cell: (line) => amount(line.perSeat),
                },
                {
                  key: "organisation",
                  header: "Organisation",
                  align: "end",
                  cell: (line) => amount(line.organization),
                },
                {
                  key: "total",
                  header: `At ${runningCost.seats} seats`,
                  align: "end",
                  cell: (line) => amount(line.total),
                },
                {
                  key: "why",
                  header: "Why",
                  cell: (line) => line.includedBecause ?? "charged",
                },
              ]}
              empty={
                <EmptyState
                  headline="No charged options"
                  description="This tenant is on the platform defaults for every option that carries a charge, so there is nothing on the quote yet. That is a real absence, not a failed read."
                />
              }
            />
          </>
        )}
      </Card>

      {/* ── What changing it would cost ─────────────────────────────────────
          The third question, and the one that was missing. Every figure here is
          a DELTA against the total above, because an edit to a live tenant is a
          change to a bill. */}
      <Card
        id="change-cost"
        headline="What changing it would cost"
        headerAside={
          spread ? (
            <Badge tone={spread.locked > 0 ? "warn" : "neutral"}>
              {spread.priced} priced · {spread.locked} locked
            </Badge>
          ) : (
            <Badge tone="warn">unknown</Badge>
          )
        }
        supportingText={
          `Each figure is the difference against the ${
            runningCost ? amount(runningCost.total) : "current"
          } above, at ${seats} seat${seats === 1 ? "" : "s"} — not the option's list price. ` +
          "Option prices are compiled into this deployment; what each option is SET to was read from " +
          `the registry at ${readAt}.`
        }
      >
        {pricingError ? (
          <PartialDataState
            what="What a change would cost"
            missing={[`the configuration did not resolve — ${pricingError}`]}
          />
        ) : changeGroups.length === 0 ? (
          <GovernedEmptyState
            what="options this console can price a change for"
            because="No domain a tenant administrator may write has a key in this build. That is a property of the deployment, not a failed read — the reserved domains below name the item that fills each one."
          />
        ) : (
          <div className="config-stack">
            <KeyValue
              ariaLabel="Today's bill, and what this tenant's own published choices account for"
              items={[
                {
                  key: "today",
                  term: "The monthly bill today",
                  value: runningCost
                    ? `${amount(runningCost.total)} at ${runningCost.seats} seat${
                        runningCost.seats === 1 ? "" : "s"
                      }`
                    : "not known — the configuration does not resolve",
                },
                {
                  key: "baseline",
                  term: "Without this tenant's published revision",
                  value: baselineTotal
                    ? `${amount(baselineTotal)} — the same blueprint and archetype layers, with nothing this tenant published`
                    : "not known — the platform layers for this tenant did not resolve",
                },
                {
                  key: "delta",
                  term: "What the published revision accounts for",
                  value: revisionBillDelta
                    ? `${effectSentence(revisionBillDelta.direction, revisionBillDelta.delta)} a month`
                    : baselineTotal && runningCost
                      ? "not known — the two figures are in different currencies, and the difference between them is not a number"
                      : "not known — one of the two figures above is missing",
                },
              ]}
            />

            {undefinedKeys.length > 0 && (
              <PartialDataState
                what="The priced options"
                missing={undefinedKeys.map(
                  (key) => `${key} — the editor offers it and the registry defines no such key`,
                )}
              />
            )}

            {changeGroups.map((group) => (
              <div className="config-domain-group" key={group.domainId}>
                <h3 className="config-subhead md3-title-medium">{group.domainId}</h3>
                <p className="config-note md3-body-medium">
                  {group.governs}
                  {group.locked > 0
                    ? ` ${group.locked} of these ${
                        group.locked === 1 ? "is" : "are"
                      } shown and locked below, with the capability that governs ${
                        group.locked === 1 ? "it" : "them"
                      }.`
                    : ""}
                </p>
                <DataTable
                  caption={`Every option ${group.domainId} governs, and what changing it would do to the monthly bill`}
                  rows={group.options}
                  rowKey={(option) => option.key}
                  columns={[
                    { key: "option", header: "Option", cell: (option) => option.key },
                    {
                      key: "now",
                      header: "Now",
                      cell: (option) =>
                        option.chargedToday ? "charged" : option.includedBecause ? "included" : "not charged",
                    },
                    { key: "change", header: "A change here means", cell: (option) => option.change },
                    {
                      key: "effect",
                      header: "Effect on the monthly bill",
                      align: "end",
                      cell: (option) => effectSentence(option.direction, option.delta),
                    },
                    {
                      key: "who",
                      header: "Who may change it",
                      cell: (option) =>
                        option.lockedReason ?? "Any operator holding configuration.publish for this tenant.",
                    },
                  ]}
                  empty={
                    <EmptyState
                      headline="No options"
                      description="This domain is listed because the registry governs it, and it has no keys in this build."
                    />
                  }
                />
              </div>
            ))}

            <p className="config-note md3-body-medium">
              A locked option is shown rather than hidden. The capability named beside it is checked
              when the publication is planned, so a change to it is a request to whoever holds that
              capability — not a setting that does not exist.
            </p>
          </div>
        )}
      </Card>

      {/* ── The apparatus that changes it ──────────────────────────────── */}
      <Card
        id="configuration"
        headline="Configuration"
        headerAside={
          mayPublish ? (
            <Badge tone="neutral">{domains.length} editable domains</Badge>
          ) : (
            <Badge tone="neutral">read only</Badge>
          )
        }
        supportingText={
          historyError
            ? "The current values could not be read, so the editor is not opened over a configuration " +
              "nobody can see. Fix the registry read first — the panel below says how."
            : latest
              ? `Showing revision ${latest.revision} exactly as it was published at ${latest.publishedAt}. ` +
                "Every change is planned before it is published: the diff, the lint findings and the impact " +
                "are shown for review, and a second identity must approve."
              : "Nothing has ever been published for this tenant, so every field below opens at its " +
                "platform default. Every change is planned before it is published, and a second identity " +
                "must approve."
        }
      >
        {historyError ? (
          <UnknownState
            what="this tenant's published configuration"
            principal="this engine's task role — the page does not call sts:GetCallerIdentity, so the ARN is not known here"
            action="dynamodb:Query"
            minimumStatement={minimumRegistryStatement()}
            errorCode={historyError}
            accountId={process.env.AWS_ACCOUNT_ID ?? null}
            region={process.env.AWS_REGION ?? null}
            partition={process.env.AWS_PARTITION ?? null}
          />
        ) : !mayPublish ? (
          <p className="config-note md3-body-medium" data-testid="configuration-read-only">
            Read only. This configuration is yours to read and not to change.
          </p>
        ) : (
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
                // GE-032-002. A key gated by a capability nobody here holds is
                // rendered and made uneditable WITH the reason, rather than
                // hidden or left enabled to be refused at publish time. The
                // reason is the one the change-cost card above states, from the
                // same computation, so the two cannot disagree.
                lockedReason:
                  changeGroups
                    .flatMap((group) => group.options)
                    .find((option) => option.key === f.key)?.lockedReason ?? null,
              })),
            }))}
          />
        )}
      </Card>

      {/* ── The record of what changed ─────────────────────────────────── */}
      <Card
        id="configuration-history"
        headline="History"
        headerAside={
          historyError ? (
            <Badge tone="warn">unknown</Badge>
          ) : (
            <Badge tone="neutral">
              {revisions.length} revision{revisions.length === 1 ? "" : "s"}
            </Badge>
          )
        }
        supportingText={
          historyError
            ? `The registry was queried at ${readAt} and refused. How many revisions exist is not known — ` +
              "which is not the same as none."
            : `Read from the tenant registry at ${readAt}. A published revision is immutable, so anything ` +
              "listed here is what was live, not a reconstruction."
        }
      >
        {historyError ? (
          <UnknownState
            what="this tenant's revision history"
            principal="this engine's task role — the page does not call sts:GetCallerIdentity, so the ARN is not known here"
            action="dynamodb:Query"
            minimumStatement={minimumRegistryStatement()}
            errorCode={historyError}
            accountId={process.env.AWS_ACCOUNT_ID ?? null}
            region={process.env.AWS_REGION ?? null}
            partition={process.env.AWS_PARTITION ?? null}
          />
        ) : revisions.length === 0 ? (
          <GovernedEmptyState
            what="published revisions"
            because="Nothing has been published for this tenant yet. The first publication has nothing to roll back to, and says so."
          />
        ) : (
          <div className="config-stack">
            <DataTable
              caption={`Every publication, newest first, as read at ${readAt} — and what returning to each would do to the monthly bill at ${seats} seat${
                seats === 1 ? "" : "s"
              }`}
              rows={[...revisions].reverse()}
              rowKey={(r) => String(r.revision)}
              columns={[
                { key: "revision", header: "Revision", cell: (r) => r.revision },
                { key: "publishedAt", header: "Published", cell: (r) => r.publishedAt },
                { key: "publishedBy", header: "By", cell: (r) => r.publishedBy },
                { key: "changed", header: "Keys touched", align: "end", cell: (r) => r.changed },
                {
                  key: "bill",
                  header: "Monthly bill",
                  align: "end",
                  cell: (r) => {
                    const total = revisionTotals.get(r.revision)
                    return total ? amount(total) : "not known — that revision does not resolve"
                  },
                },
                {
                  key: "billDelta",
                  header: "If restored",
                  align: "end",
                  cell: (r) => {
                    if (latest && r.revision === latest.revision) return "live now"
                    const total = revisionTotals.get(r.revision)
                    if (!total || !runningCost) return "not known"
                    const delta = billDelta(runningCost.total, total)
                    return delta ? effectSentence(delta.direction, delta.delta) : "not comparable"
                  },
                },
                {
                  key: "rollbackTo",
                  header: "Rolls back to",
                  cell: (r) => r.rollbackTo ?? "nothing — the first",
                },
              ]}
              empty={
                <EmptyState
                  headline="No published revisions"
                  description="Nothing has been published for this tenant yet."
                />
              }
            />

            {lastChange && lastChangeDiff && (
              <div>
                <h3 className="config-subhead md3-title-medium">What the last publication changed</h3>
                <pre className="state-detail" data-testid="last-change">
                  {lastChange}
                </pre>
                {/* DIAGNOSTIC — flagged for the IA agent, not moved here.
                    The machine-readable form is in the product rather than only
                    in a test so that an operator diffing two consoles and
                    anything that later reads it over HTTP get the document the
                    sentence above was rendered from. It is still a developer's
                    artefact on an operator's page, and it belongs behind the
                    Diagnostics tab. Left in place and collapsed. */}
                <details className="config-diagnostic">
                  <summary className="md3-label-large">
                    Machine-readable diff (schema {lastChangeDiff.schemaVersion})
                  </summary>
                  <pre className="state-detail" data-testid="last-change-json">
                    {JSON.stringify(lastChangeDiff, null, 2)}
                  </pre>
                  <p className="config-note md3-body-small">
                    Published as <code>ChangeDiff</code> — see{" "}
                    <code>docs/contracts/change-diff.schema.json</code>. Only the domains this
                    product computes appear; a domain it does not compute is absent rather than
                    empty, because an empty section reads as &ldquo;nothing changed&rdquo;.
                  </p>
                </details>
              </div>
            )}

            {/* A rollback IS a publication — it republishes forward through the
                same plan, four-eyes and immutability checks — so it takes the
                same permission, and an operator who may not publish does not
                get a control that publishes. */}
            {mayPublish && latest && (
              <RollbackControls
                slug={slug}
                revisions={revisions.map((r) => r.revision)}
                live={latest.revision}
                previews={rollbackPreviews}
              />
            )}
          </div>
        )}
      </Card>

      {/* ── What a change here would break ─────────────────────────────── */}
      <Card
        id="module-dependencies"
        headline="Module dependencies"
        headerAside={<Badge tone="neutral">{graph.edges.length} edges</Badge>}
        supportingText="What each module needs, and what turning it off would take down with it. As compiled into this deployment — the module graph is code rather than tenant state, so it is the same for every tenant and changes only when this build is replaced."
      >
        {/* Text rather than a canvas, deliberately: a drawn graph has no
            keyboard path, no screen-reader description and nothing the layout
            suite can measure. For a graph this small the accessible rendering
            is the better one. */}
        <DataTable
          caption="Every module, what it depends on, and what depends on it"
          rows={graph.nodes}
          rowKey={(node) => node}
          columns={[
            { key: "module", header: "Module", cell: (node) => node },
            {
              key: "dependsOn",
              header: "Depends on",
              cell: (node) =>
                graph.edges
                  .filter((e) => e.from === node)
                  .map((e) => e.to)
                  .join(", ") || "no dependencies",
            },
            {
              key: "breaks",
              header: "Disabling it breaks",
              cell: (node) => {
                const breaks = dependantsOf(MODULES, node)
                return breaks.length > 0 ? breaks.join(", ") : "nothing else"
              },
            },
          ]}
          empty={
            <EmptyState
              headline="No modules"
              description="This deployment was built with no module definitions at all, which is a defect in the build rather than a fact about this tenant."
            />
          }
        />
      </Card>

      {/* ── Why a setting an operator is looking for is not above ───────── */}
      <Card
        id="not-editable-here"
        headline="Settings you will not find above"
        headerAside={
          <Badge tone="neutral">
            {reservedDomains().length + withheldDomains().length} domains
          </Badge>
        }
        supportingText="Two different reasons, kept on one card because they answer one question. As compiled into this deployment: which domains are reserved and which are withheld is a property of this build, not of this tenant, and neither list is read from AWS."
      >
        <div className="config-stack">
          <DataTable
            caption={`Yours to configure, with no settings yet — ${reservedDomains().length} domains`}
            rows={reservedDomains()}
            rowKey={(d) => d.id}
            columns={[
              { key: "domain", header: "Domain", cell: (d) => d.id },
              { key: "governs", header: "Governs", cell: (d) => d.governs },
              { key: "reservedFor", header: "Reserved for", cell: (d) => d.reservedFor },
            ]}
            empty={
              <EmptyState
                headline="Nothing reserved"
                description="Every domain this build knows about is either editable above or withheld below."
              />
            }
          />
          <p className="config-note md3-body-medium">
            These appear rather than being hidden, so the gap is visible instead of looking like an
            omission.
          </p>

          <DataTable
            caption={`Platform invariants, not yours to change — ${withheldDomains().length} domains`}
            rows={withheldDomains()}
            rowKey={(w) => w.domain.id}
            columns={[
              { key: "domain", header: "Domain", cell: (w) => w.domain.id },
              { key: "why", header: "Why it is withheld", cell: (w) => w.why },
            ]}
            empty={
              <EmptyState
                headline="Nothing withheld"
                description="This build withholds no domain from a tenant administrator."
              />
            }
          />
          <p className="config-note md3-body-medium">
            Placement, recovery, observability and cost are platform invariants. They are shown with
            the reason rather than omitted, because an administrator searching for a setting that
            does not exist for them has no way to learn that from a blank page.
          </p>
        </div>
      </Card>
    </div>
  )
}
