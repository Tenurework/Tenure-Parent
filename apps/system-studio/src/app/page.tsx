import type { ReactNode } from "react"
import { redirect } from "next/navigation"

import { CUSTOMER_TENANT_BINDINGS, getBlueprint } from "@tenure/blueprints"
import { resolveConfig } from "@tenure/configuration"
import { validateTopology } from "@tenure/organization-model"
import {
  CATALOG_ENTRIES,
  availabilityDecisions,
  type ClassifiedCapability,
  type ConnectorCredentialRequirement,
} from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { authorizeCommand } from "@/lib/authorize"
import { FleetMisconfigured, fleet, primeEstate } from "@/lib/cells"
import { operatorConfigProblems } from "@/lib/operators"
import { ErrorState, PermissionDeniedState } from "@/components/states"
import {
  Badge,
  ButtonLink,
  Card,
  Chip,
  DataTable,
  EmptyState,
  type DataColumn,
} from "@/components/md3"
import {
  REGISTRY,
  layersFor,
  modulesFor,
  type ModulePaymentCapability,
} from "@tenure/platform-config"

export const dynamic = "force-dynamic"

/**
 * STUDIO-030-011 — what this index shows before it is asked for more.
 *
 * Named per list rather than as one number, for the reason `INVENTORY_PAGE_ROWS`
 * and `LEDGER_PAGE_ROWS` are named separately in `lib/api/envelope.ts`: a
 * refusal is one sentence and a capability is a six-cell row, and one budget
 * would be wrong for one of them without saying which.
 *
 * This page had no budget at all. It rendered every catalog refusal, every
 * classified capability, and then — for EVERY configured system at once — the
 * full payments table and all twenty-three resolved configuration values with
 * their provenance: 1,024 DOM elements against a 400-element ceiling, most of
 * it detail about one system printed on a page whose job is to list four.
 *
 * So each long list keeps its first page here and says what it is holding back,
 * and `?show=` opens exactly one of them. Nothing is unreachable and nothing is
 * silently truncated — a list that stops short without saying so is the defect
 * `showingOf` exists to prevent.
 */
const CATALOG_REFUSALS_SHOWN = 6
const CATALOG_CAPABILITIES_SHOWN = 8

/**
 * The word this console uses when it does not know, and the only one.
 *
 * Never an empty cell, never a dash, never a plausible default. STUDIO-000-007
 * is about exactly one confusion — a refused or unresolved read rendered as an
 * absence — and the same rule holds for facts this page reads out of its own
 * environment rather than out of AWS. Every use below is paired with the
 * sentence that says what would make it known.
 */
const UNKNOWN = "UNKNOWN"

/**
 * A timestamp a reader can compare against a clock, from the ISO string.
 *
 * Sliced rather than formatted through `Intl`: a locale-dependent rendering is
 * a different string on a different machine, and this stamp is the thing an
 * operator quotes in an incident channel. UTC because the estate is.
 */
function asOf(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

/** One row of a two-column fact table: what it is, and what it currently is. */
interface Fact {
  key: string
  label: string
  value: ReactNode
}

const FACT_COLUMNS: readonly DataColumn<Fact>[] = [
  { key: "fact", header: "Fact", cell: (f) => f.label },
  { key: "value", header: "What it currently is", cell: (f) => f.value },
]

/**
 * Every configured organization system, and what each one currently is.
 *
 * Read-only. The engines underneath support editing — configuration publishes
 * immutable versions, releases move through a state machine with an approval
 * gate — but tenant overlays are files until the schema programme lands a
 * configuration store, and a write surface over files would produce a system
 * that survives until the next deploy.
 *
 * This is the whole reason the app exists separately: it shows EVERY tenant's
 * configuration, so it must not be served from a host that serves any one of
 * them. See PD-007.
 *
 * ## The order of this page is the answer first
 *
 * The systems come before the catalog, which is the reverse of what shipped.
 * The catalog is the apparatus a system is assembled from; an operator opening
 * this page has come to find out what the configured systems currently are, and
 * reading twenty-five refusals about connectors nobody has built before
 * reaching the one real pilot is what "looks like a construction site" means
 * measured in scroll distance.
 *
 * ## Only the customers
 *
 * `CUSTOMER_TENANT_BINDINGS`, not `TENANT_BINDINGS`. Three of the four bindings
 * are fixtures that exercise the platform — right-to-left conventions, external
 * ERP coexistence, a second blueprint — and rendering them here reported "4
 * configured" and drew three organisations that do not exist beside the one
 * real pilot, with nothing telling them apart. They stay reachable by slug
 * through `getTenantBinding`, which is what the suites use.
 * `tests/architecture/no-fixture-tenants-on-operator-surfaces.test.mjs` is the
 * guard.
 */
export default async function StudioPage({
  searchParams,
}: {
  /**
   * Which one long list is open, if any: `catalog` for the integration
   * catalog's refusals and capability rows, or a system's slug for that
   * system's configuration and payments detail.
   *
   * In the URL rather than in component state, for the reason the fleet's
   * filter is: it makes "look at this system's configuration" a link an
   * operator can send during an incident, and it keeps the page a server
   * component.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = params.show
  const show = typeof raw === "string" ? raw : ""
  const catalogExpanded = show === "catalog"

  const misconfigured = operatorConfigProblems()
  if (misconfigured.length > 0) {
    // Before authentication, because a console whose access control is not
    // configured has no safe page to show — including a sign-in form that would
    // accept nothing and say nothing useful.
    return (
      <Card
        headline="Not configured"
        headerAside={<Badge tone="bad">refusing</Badge>}
        supportingText="The Studio refuses to serve until its access control is set up. Each variable below is read from this process's environment; none of them has a default, because a default here decides who may read every tenant's configuration."
        container="high"
        level={1}
      >
        <ul className="md3-body-medium">
          {misconfigured.map((p) => (
            <li key={p.variable}>
              <code>{p.variable}</code> — {p.detail}
            </li>
          ))}
        </ul>
      </Card>
    )
  }

  // STUDIO-020-006. A permission decision, not a membership test: the resource
  // is named, the action is named, and the account/region/environment the
  // decision is made in come from what this control plane resolved for itself.
  const session = await auth()
  const decision = authorizeCommand("platform.read", { principalId: session?.user?.email })
  // Two different facts, told apart. Nobody signed in goes to the sign-in page;
  // somebody signed in who may not read this is refused without being told to
  // go and do the thing they already did.
  if (decision.reason === "NO_PRINCIPAL") redirect("/signin")
  if (!decision.allowed) return <PermissionDeniedState />

  // The exact scope every availability decision below is made for. Bible §5:
  // Studio may show `Available` only when a decision passes for the exact
  // tenant/environment/region/version — so the region comes from the cell that
  // would actually serve these tenants, and the engine version from the build.
  // An engine that cannot say what version it is fails every compatibility
  // range closed, which is the correct answer and not a fallback.
  // GE-010-007. `fleet()` is synchronous and its estate facts now come from
  // sts:GetCallerIdentity rather than from a compiled-in "us-east-1"/account
  // literal. Priming resolves that identity once per process before the first
  // synchronous read; a page that skipped it would fall back to the environment
  // alone, and refuse rather than guess if that is unset too.
  //
  // STUDIO-000-006. Priming reaches STS, and STS is not always reachable — no
  // credentials in a local checkout, a task role without
  // `sts:GetCallerIdentity`, a partition with no endpoint. None of those is a
  // reason for this page to 500: `primeEstate` already returns quietly when the
  // identity does not resolve, and `fleet()` then answers from the environment
  // or refuses with a message naming the two variables. The `catch` is here so
  // a THROWN transport error takes the same path as an unresolved one.
  try {
    await primeEstate()
  } catch {
    // Deliberately swallowed and deliberately not logged as a page failure. The
    // consequence shows up below as UNKNOWN, or as the FleetMisconfigured
    // refusal, both of which say what to set.
  }
  let cells: ReturnType<typeof fleet>
  try {
    cells = fleet()
  } catch (err) {
    if (err instanceof FleetMisconfigured) {
      return <ErrorState what="the cell registry" detail={err.message} />
    }
    throw err
  }

  const now = new Date().toISOString()
  const pinnedEngineVersion = process.env.ENGINE_VERSION ?? process.env.SCHEMA_VERSION ?? ""
  const availabilityScope = {
    region: cells[0]?.region ?? "",
    // The partition too, because an egress restriction is a partition fact
    // before it is a region one. Read from the cell registry, which reads the
    // environment and validates it — never a literal here.
    partition: cells[0]?.partition,
    // `unpinned` is what the compatibility gate is given, and it is not a
    // version — it is the absence of one, and it fails every range closed. The
    // gate keeps the word; the reader gets UNKNOWN and the sentence below.
    engineVersion: pinnedEngineVersion || "unpinned",
    // The marketplace is closed as a property of the code, not of a flag
    // somebody forgot to set. Passing `false` here is the deliberate act the
    // parameter exists to require.
    marketplaceEnabled: false,
    now,
  }
  const capabilities = availabilityDecisions(CATALOG_ENTRIES, availabilityScope)
  const offered = capabilities.filter((d) => d.available)
  const refused = capabilities.filter((d) => !d.available)

  // WRK-000-002. Flattened out of the decisions rather than gathered from the
  // catalog: the classification only means anything alongside the artifact
  // verdict it was checked against, and reading the entries directly would
  // produce rows nobody had reconciled with the gate.
  const classified = capabilities.flatMap((d) =>
    (d.capabilities ?? []).map((c) => ({ ...c, entryKey: d.entry.key })),
  )
  const capabilityProblems = classified.flatMap((c) => c.problems)
  const setupReferences = capabilities.flatMap((d) => {
    const entry = d.entry
    if (entry.kind !== "connector" || !entry.setup) return []
    return entry.setup.credentialRefs.map((ref) => ({
      entryKey: entry.key,
      displayName: entry.displayName,
      notes: entry.setup?.notes ?? "",
      ...ref,
    }))
  })

  const systems = CUSTOMER_TENANT_BINDINGS.map((binding) => {
    const blueprint = getBlueprint(binding.blueprintId)
    if (!blueprint) {
      return { binding, error: `Blueprint "${binding.blueprintId}" does not exist.` as const }
    }

    const { config, problems: configProblems } = resolveConfig(REGISTRY, layersFor(binding.slug), {
      collectProblems: true,
    })
    // Through `modulesFor`, not a second `resolveModules` call of its own. The
    // second call was already answering a different question: it resolved the
    // blueprint's raw list, so it ignored the tenant's `moduleEdits` and — once
    // axes arrived — its `operatingModel`, and the console would have shown a
    // module set the application does not run. One resolver, one answer.
    const modules = modulesFor(binding.slug)

    let topologyOk = true
    try {
      validateTopology(blueprint.topology)
    } catch {
      topologyOk = false
    }

    return { binding, blueprint, config, configProblems, modules, topologyOk, error: null }
  })

  // The three verdicts, counted once, so the headline and the badges cannot
  // disagree with the cards underneath them.
  const broken = systems.filter((s) => s.error !== null).length
  const withProblems = systems.filter(
    (s) => s.error === null && (s.configProblems!.length > 0 || !s.topologyOk),
  ).length
  const valid = systems.length - broken - withProblems

  const overallTone = broken > 0 ? "bad" : withProblems > 0 ? "warn" : "ok"
  const overallWord =
    broken > 0
      ? `${broken} broken`
      : withProblems > 0
        ? `${withProblems} with problems`
        : "all resolved"

  return (
    <>
      <h1 className="md3-headline-large">Organization systems</h1>

      {/* ── The answer ─────────────────────────────────────────────────────
          What an operator came for, above everything this page had to read to
          work it out. The counts are the same three the badges below use. */}
      <Card
        id="summary"
        headline={
          systems.length === 1
            ? "1 organization system is configured"
            : `${systems.length} organization systems are configured`
        }
        headerAside={<Badge tone={overallTone}>{overallWord}</Badge>}
        container="high"
        level={1}
        supportingText={
          <>
            Every system this control plane configures, with the blueprint that produced it, the
            modules it runs and where each configuration value came from. Resolved from the layers
            compiled into this build at <time dateTime={now}>{asOf(now)}</time>.
          </>
        }
      >
        {systems.length === 0 ? (
          <EmptyState
            headline="No organization system is configured"
            description="Nothing is bound in this build. That is not a filtered view — there are no customer bindings at all, so no configuration was resolved. A system appears here once it is bound in blueprints/."
          />
        ) : (
          <div className="chips">
            <Chip>{valid} resolved cleanly</Chip>
            <Chip>{withProblems} with configuration problems</Chip>
            <Chip>{broken} broken</Chip>
            <Chip>Read-only</Chip>
          </div>
        )}
      </Card>

      {/* ── One card per system ────────────────────────────────────────── */}
      {systems.map((s) => {
        // Exactly one system's detail is open at a time, and it is in the URL.
        // Rendering all four at once is what put 705 of this page's elements on
        // screen: two thirds of the index was the inside of things it lists.
        const open = show === s.binding.slug
        const values = s.config ? Object.keys(s.config.values).length : 0
        const payments = s.error ? 0 : s.modules.paymentCapabilities.length
        // Modules, not advisories: `search` carries two, and "13 modules run
        // with a limitation" of a twelve-module system is a sentence that
        // cannot be true.
        const advisedModules = s.error
          ? []
          : Array.from(new Set(s.modules.advisories.map((a) => a.moduleKey)))
        const advisoryKinds = s.error
          ? []
          : Array.from(new Set(s.modules.advisories.map((a) => a.kind))).sort()

        if (s.error) {
          return (
            <Card
              key={s.binding.slug}
              headline={s.binding.displayName}
              headerAside={<Badge tone="bad">broken</Badge>}
              supportingText={
                <>
                  <code>/{s.binding.slug}</code> — read at{" "}
                  <time dateTime={now}>{asOf(now)}</time>.
                </>
              }
            >
              <EmptyState
                headline="This system did not resolve"
                description={`${s.error} Nothing below it could be worked out, so nothing below it is shown — an empty module list here would read as a system with no modules rather than as a system that could not be read.`}
              />
            </Card>
          )
        }

        const definition: Fact[] = [
          {
            key: "blueprint",
            label: "Blueprint",
            value: `${s.blueprint!.id} v${s.blueprint!.version}`,
          },
          {
            key: "topology",
            label: "Topology",
            value: (
              <>
                {s.blueprint!.topology.id} — root {s.blueprint!.topology.rootType},{" "}
                {s.blueprint!.topology.types.length} node types
                {s.topologyOk ? "" : " — does not validate"}
              </>
            ),
          },
          {
            key: "entitlements",
            label: "Entitlements",
            value: (s.binding.entitlements ?? []).join(", ") || "none",
          },
          {
            key: "checksum",
            label: "Configuration checksum",
            value: s.config ? (
              <code>{s.config.checksum}</code>
            ) : (
              <>
                {UNKNOWN} — the configuration did not resolve, so there is no checksum to compare a
                later resolution against.
              </>
            ),
          },
        ]

        return (
          <Card
            key={s.binding.slug}
            headline={s.binding.displayName}
            headerAside={
              <Badge tone={s.configProblems!.length > 0 || !s.topologyOk ? "warn" : "ok"}>
                {s.configProblems!.length > 0 || !s.topologyOk ? "problems" : "valid"}
              </Badge>
            }
            supportingText={
              <>
                <code>/{s.binding.slug}</code> — {s.modules.keys.length} modules enabled, {values}{" "}
                configuration values, {payments} payments capabilities.
              </>
            }
            actions={
              <ButtonLink
                variant={open ? "outlined" : "tonal"}
                href={open ? "/" : `/?show=${s.binding.slug}`}
                data-testid={`detail-${s.binding.slug}`}
              >
                {open
                  ? "Hide this system's full detail"
                  : `Show all ${values} configuration values, ${payments} payments capabilities and ${s.modules.advisories.length} module limitations`}
              </ButtonLink>
            }
          >
            <DataTable
              caption={
                <>
                  Definition — resolved at <time dateTime={now}>{asOf(now)}</time>
                </>
              }
              columns={FACT_COLUMNS}
              rows={definition}
              rowKey={(f) => f.key}
              empty={
                <EmptyState
                  headline="Nothing to define"
                  description="No blueprint resolved for this binding."
                />
              }
            />

            <h3 className="md3-label-large">Modules — {s.modules.keys.length} enabled</h3>
            <div className="chips">
              {s.modules.enabled.map((m) => (
                <Chip key={m.key} title={m.description}>
                  {m.key} v{m.version}
                </Chip>
              ))}
            </div>

            {/* Running WITH a limitation, which is neither enabled-and-fine nor
                not-enabled. `SystemModules.advisories` has carried this since
                PAY-000-008 and this page rendered none of it, so a module in
                read-only mode was the same chip as one with no caveat at all.

                The COUNT is on the index and never folded away — a caveat an
                operator has to ask for is a caveat nobody reads — and the
                thirteen paragraphs behind it are in the same disclosure as the
                configuration values, for the reason stated at the top of this
                file: this page's job is to say what each system is, and a
                thirteen-paragraph digression about declared gaps is the inside
                of one of the things it lists. */}
            {advisedModules.length > 0 && (
              <p className="md3-body-medium">
                <Badge tone="warn">enabled with limits</Badge> {advisedModules.length} of{" "}
                {s.modules.keys.length} enabled modules carry a declared limitation —{" "}
                {s.modules.advisories.length} in total, of {advisoryKinds.join(", ")}. That is
                neither a refusal nor a clean bill; each one is listed with its detail in the
                disclosure below.
              </p>
            )}

            {s.modules.problems.length > 0 && (
              <>
                <h3 className="md3-label-large">
                  Asked for and not enabled — {s.modules.problems.length}
                </h3>
                <ul className="md3-body-medium">
                  {s.modules.problems.map((p) => (
                    <li key={`${p.moduleKey}:${p.reason}`}>
                      <code>{p.moduleKey}</code> — {p.reason}: {p.detail}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* PAY-000-008 / PAY-010-005. A module being enabled says the
                tenant bought it. It says nothing about whether Tenure has
                certified the PAYMENTS the module's surfaces would use, and
                before this the two were indistinguishable because there was
                no third value between on and off.

                Every row is a STATE, never a tick: `PLANNED` and
                `UNSUPPORTED` are different answers with different fixes, and
                a provider documenting something is not Tenure having approved
                it. `capabilityAvailabilityForModules` validates the approving
                ADR against the filesystem on each read, so a registry edited
                to claim GA without writing the decision down fails here
                rather than rendering as available. */}
            {open && s.modules.advisories.length > 0 && (
              <DataTable
                caption={`Module limitations — ${s.modules.advisories.length}`}
                columns={ADVISORY_COLUMNS}
                rows={s.modules.advisories}
                rowKey={(a) => `${a.moduleKey}:${a.kind}`}
                empty={
                  <EmptyState
                    headline="No module declares a limitation"
                    description="Every enabled module runs without a declared caveat. Nothing was withheld here."
                  />
                }
              />
            )}

            {open && (
              <DataTable
                caption={
                  <>
                    Payments capabilities —{" "}
                    {s.modules.paymentCapabilities.filter((c) => c.transactable).length} transactable
                    of {s.modules.paymentCapabilities.length}
                  </>
                }
                columns={PAYMENT_COLUMNS}
                rows={s.modules.paymentCapabilities}
                rowKey={(c) => `${c.moduleKey}:${c.capabilityId}`}
                empty={
                  <EmptyState
                    headline="No payments capability is in scope"
                    description="None of this system's enabled modules declares a payments capability. That is an absence of claims, not a refusal — nothing was checked and denied."
                  />
                }
              />
            )}

            {open && s.config && (
              <DataTable
                caption={`Configuration — ${values} values, each with the layer it came from`}
                columns={CONFIG_COLUMNS}
                rows={Object.keys(s.config.values)
                  .sort()
                  .map((key) => {
                    const why = s.config!.explain(key)
                    return {
                      key,
                      value: JSON.stringify(s.config!.values[key]),
                      from: why.usedDefault
                        ? "platform default"
                        : why.contributors.map((c) => c.scope).join(" → "),
                    }
                  })}
                rowKey={(row) => row.key}
                empty={
                  <EmptyState
                    headline="No configuration value resolved"
                    description="The registry produced no values for this system. That is a resolution failure, not an empty configuration."
                  />
                }
              />
            )}

            {s.configProblems!.length > 0 && (
              <>
                <h3 className="md3-label-large">
                  Configuration problems — {s.configProblems!.length}
                </h3>
                <ul className="md3-body-medium">
                  {s.configProblems!.map((p, i) => (
                    <li key={`${p.key}:${i}`}>
                      <code>{p.key}</code> — {p.reason}: {p.detail}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        )
      })}

      {/* ── The catalog a system is assembled from ──────────────────────────
          Bible §5. Nothing here is labelled available except what a
          CapabilityAvailabilityDecision passed for the scope printed below, and
          nothing is silently missing: what was refused is listed with its
          reason. One scope rather than one per system because these bindings
          carry no region of their own — inventing a per-tenant scope out of the
          same cell region would be three copies of one decision wearing three
          labels. */}
      <Card
        id="catalog"
        headline="Extensions, connectors and models"
        headerAside={
          <Badge tone="info">
            {offered.length} of {capabilities.length} available
          </Badge>
        }
        supportingText={
          <>
            Decided at <time dateTime={now}>{asOf(now)}</time> for region{" "}
            {availabilityScope.region || UNKNOWN}, partition{" "}
            {availabilityScope.partition || UNKNOWN}, engine version{" "}
            {pinnedEngineVersion || UNKNOWN}, with the marketplace closed. A decision is only true
            for the scope it was made in, so the scope travels with it.
          </>
        }
      >
        <div className="chips">
          <Chip>region {availabilityScope.region || UNKNOWN}</Chip>
          <Chip>partition {availabilityScope.partition || UNKNOWN}</Chip>
          <Chip>engine {pinnedEngineVersion || UNKNOWN}</Chip>
          <Chip>marketplace closed</Chip>
        </div>

        {/* The one unknown on this page that changes every verdict below it, so
            it is stated rather than left to be inferred from the word
            `unpinned` in a chip. */}
        {!pinnedEngineVersion && (
          <p className="md3-body-medium">
            The engine version is {UNKNOWN}: neither <code>ENGINE_VERSION</code> nor{" "}
            <code>SCHEMA_VERSION</code> is set in this process. Every compatibility range below was
            therefore failed closed rather than guessed, which is the correct answer and not a
            fallback — set one of the two in the task definition to get a real verdict.
          </p>
        )}

        <h3 className="md3-label-large">
          Available — {offered.length} of {capabilities.length}
        </h3>
        {offered.length === 0 ? (
          <EmptyState
            headline="Nothing in the catalog passes for this scope"
            description="Every entry was decided and every one was refused. This is not an empty catalog: the refusals and their reasons are listed below, and the count above is what was checked."
          />
        ) : (
          <div className="chips">
            {offered.map((d) => (
              <Chip key={d.entry.key} title={d.disclaimer ?? d.entry.displayName}>
                {d.entry.key} {d.entry.kind}
                {d.resolvedVersion ? ` v${d.resolvedVersion}` : ""}
                {d.certification === "expiring" ? " — re-certification due" : ""}
              </Chip>
            ))}
          </div>
        )}

        {refused.length > 0 && (
          <>
            <h3 className="md3-label-large">Not available, and why — {refused.length}</h3>
            <ul className="md3-body-medium">
              {(catalogExpanded ? refused : refused.slice(0, CATALOG_REFUSALS_SHOWN)).map((d) => (
                <li key={d.entry.key}>
                  <code>{d.entry.key}</code> <Badge tone="warn">{d.reason}</Badge>{" "}
                  {/* The provider's own answer, where the refusal is about them.
                      `provider-review-missing` covers NOT_SUBMITTED, IN_REVIEW
                      and REJECTED, and those send an operator to three different
                      places — so the state travels with the reason. */}
                  {d.providerReview
                    ? `(${d.providerReview.program}: ${d.providerReview.state}) `
                    : ""}
                  {/* The disclaimer is carried on the decision, so this cannot
                      render an availability verdict without the text that
                      qualifies it — and where the decision carries none, the row
                      says that rather than trailing off after a status word. */}
                  {d.disclaimer ||
                    "No further explanation is recorded on this decision; the reason above is all the gate returned."}
                </li>
              ))}
            </ul>
            {refused.length > CATALOG_REFUSALS_SHOWN && (
              <div className="md3-card-actions" data-testid="catalog-count">
                <ButtonLink
                  variant="text"
                  href={catalogExpanded ? "/#catalog" : "/?show=catalog#catalog"}
                >
                  {catalogExpanded
                    ? `All ${refused.length} refusals shown — collapse the catalog`
                    : `Showing ${CATALOG_REFUSALS_SHOWN} of ${refused.length} refusals — open the whole catalog`}
                </ButtonLink>
              </div>
            )}
          </>
        )}

        {/* WRK-000-002. One row per (provider, product, capability, direction),
            in the seven-state vocabulary the Bible names, with its evidence.
            The entry rows above answer "may this pack be offered"; these answer
            "what does it actually do", and a pack refused as `planned` at the
            artifact level still has to say which capabilities were promised.

            Rendered from the decision's own `capabilities`, not from a second
            lookup, so an availability verdict and the claims underneath it
            cannot come apart. */}
        {classified.length > 0 && (
          <>
            <DataTable
              caption={`Capabilities — ${
                classified.filter((c) => c.status === "AVAILABLE").length
              } available of ${classified.length}`}
              columns={CAPABILITY_COLUMNS}
              rows={catalogExpanded ? classified : classified.slice(0, CATALOG_CAPABILITIES_SHOWN)}
              rowKey={(c) =>
                `${c.entryKey}:${c.provider}/${c.product}/${c.capability}/${c.direction}`
              }
              empty={
                <EmptyState
                  headline="No capability is classified"
                  description="No entry in the catalog declares a capability. Models and extensions declare none by design; a connector that declares none has not been described yet."
                />
              }
            />
            {classified.length > CATALOG_CAPABILITIES_SHOWN && (
              <div className="md3-card-actions" data-testid="capability-count">
                <ButtonLink
                  variant="text"
                  href={catalogExpanded ? "/#catalog" : "/?show=catalog#catalog"}
                >
                  {catalogExpanded
                    ? `All ${classified.length} capability rows shown — collapse the catalog`
                    : `Showing ${CATALOG_CAPABILITIES_SHOWN} of ${classified.length} capability rows — open the whole catalog`}
                </ButtonLink>
              </div>
            )}
            {capabilityProblems.length > 0 && (
              <>
                <h3 className="md3-label-large">
                  Capability claims that do not hold up — {capabilityProblems.length}
                </h3>
                <ul className="md3-body-medium">
                  {capabilityProblems.map((p, i) => (
                    <li key={`${p.capability}:${i}`}>
                      <code>{p.capability}</code> — {p.reason}: {p.detail}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {setupReferences.length > 0 && (
          <>
            <p className="md3-body-medium">
              Reference names only. This console renders where a credential must live; it never
              reads a secret value and never displays one, so a name below is not evidence that
              anything has been set.
            </p>
            <DataTable
              caption={`Setup references — ${setupReferences.length}`}
              columns={SETUP_COLUMNS}
              rows={setupReferences}
              rowKey={(ref) => `${ref.entryKey}:${ref.key}`}
              empty={
                <EmptyState
                  headline="No connector declares a credential"
                  description="No entry in the catalog has a setup block. Nothing has been withheld here — there is nothing to name."
                />
              }
            />
          </>
        )}
      </Card>
    </>
  )
}

/* ── Column declarations ─────────────────────────────────────────────────────
 *
 * Outside the component because they are constants, and declaring them inside
 * would rebuild four arrays of closures on every request for no reason. They
 * are `DataColumn` arrays rather than markup so the header and the body come
 * from ONE declaration — a column added to the header and forgotten in the body
 * is not expressible, which in a table printing capability states and
 * credential locations is the difference between a wrong row and a missing one.
 */

const PAYMENT_COLUMNS: readonly DataColumn<ModulePaymentCapability>[] = [
  { key: "module", header: "Module", cell: (c) => <code>{c.moduleKey}</code> },
  {
    key: "capability",
    header: "Capability",
    cell: (c) => <code title={c.summary}>{c.capabilityId}</code>,
  },
  {
    key: "state",
    header: "State",
    cell: (c) => (
      <>
        {c.state} {c.transactable ? null : <Badge tone="warn">not transactable</Badge>}
      </>
    ),
  },
]

/**
 * `SystemModules.advisories`, which has no exported row type of its own.
 *
 * Written out rather than imported because `ModuleAdvisory` lives in
 * `@tenure/module-runtime`, which this console does not depend on and should not
 * start depending on for one table's column types. `kind` is widened to `string`
 * on purpose: the union is the resolver's, and a console that pinned it here
 * would fail to compile the day a sixth kind is added rather than rendering it.
 */
interface AdvisoryRow {
  moduleKey: string
  kind: string
  detail: string
}

const ADVISORY_COLUMNS: readonly DataColumn<AdvisoryRow>[] = [
  { key: "module", header: "Module", cell: (a) => <code>{a.moduleKey}</code> },
  { key: "kind", header: "Limitation", cell: (a) => a.kind },
  { key: "detail", header: "What it means", cell: (a) => a.detail },
]

interface ConfigRow {
  key: string
  value: string
  from: string
}

const CONFIG_COLUMNS: readonly DataColumn<ConfigRow>[] = [
  { key: "key", header: "Key", cell: (r) => <code>{r.key}</code> },
  { key: "value", header: "Value", cell: (r) => <code>{r.value}</code> },
  { key: "from", header: "Where it came from", cell: (r) => r.from },
]

/**
 * The catalog's own type, widened by the one field this page adds.
 *
 * Restating the shape by hand here would type-check today and drift the moment
 * `ClassifiedCapability` gains a state — an intersection cannot go stale.
 */
type CapabilityRow = ClassifiedCapability & { entryKey: string }

const CAPABILITY_COLUMNS: readonly DataColumn<CapabilityRow>[] = [
  { key: "provider", header: "Provider", cell: (c) => <code>{c.provider}</code> },
  { key: "product", header: "Product", cell: (c) => c.product },
  { key: "capability", header: "Capability", cell: (c) => c.capability },
  { key: "direction", header: "Direction", cell: (c) => c.direction },
  {
    key: "status",
    header: "Status",
    cell: (c) => (
      <>
        {c.status}
        {c.problems.map((p) => (
          <Badge tone="bad" key={p.reason}>
            {p.reason}
          </Badge>
        ))}
      </>
    ),
  },
  {
    key: "evidence",
    header: "Evidence",
    // An AVAILABLE or DEGRADED row with nothing here is a claim nobody can
    // retrace, and `capabilityProblems` has already flagged it in the column to
    // the left. "none recorded" rather than an em dash: a dash is a character an
    // operator has to interpret, and the two readings — nothing was recorded,
    // and nothing is required — are different facts.
    cell: (c) => c.evidenceRefs.join(", ") || "none recorded",
  },
]

/** Same reasoning as `CapabilityRow`: the catalog's type, plus what this page joins on. */
type SetupRow = ConnectorCredentialRequirement & {
  entryKey: string
  displayName: string
  notes: string
}

const SETUP_COLUMNS: readonly DataColumn<SetupRow>[] = [
  {
    key: "connector",
    header: "Connector",
    cell: (r) => <code title={r.displayName}>{r.entryKey}</code>,
  },
  { key: "field", header: "Field", cell: (r) => r.label },
  {
    key: "reference",
    header: "Reference",
    cell: (r) => <code title={r.notes || r.referenceName}>{r.referenceName}</code>,
  },
  { key: "source", header: "Source", cell: (r) => r.source },
  { key: "required", header: "Required", cell: (r) => (r.required ? "yes" : "no") },
]
