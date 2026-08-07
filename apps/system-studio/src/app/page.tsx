import { redirect } from "next/navigation"

import { TENANT_BINDINGS, getBlueprint } from "@tenure/blueprints"
import { resolveConfig } from "@tenure/configuration"
import { validateTopology } from "@tenure/organization-model"
import { CATALOG_ENTRIES, availabilityDecisions } from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { fleet } from "@/lib/cells"
import { isOperator, operatorConfigProblems } from "@/lib/operators"
import {
  REGISTRY,
  layersFor,
  modulesFor,
  type ModulePaymentCapability,
} from "@tenure/platform-config"

export const dynamic = "force-dynamic"

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
 */
export default async function StudioPage() {
  const misconfigured = operatorConfigProblems()
  if (misconfigured.length > 0) {
    // Before authentication, because a console whose access control is not
    // configured has no safe page to show — including a sign-in form that would
    // accept nothing and say nothing useful.
    return (
      <div className="misconfigured">
        <h1>Not configured</h1>
        <p>The Studio refuses to serve until its access control is set up.</p>
        <ul>
          {misconfigured.map((p) => (
            <li key={p.variable}>
              <b>{p.variable}</b> — {p.detail}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const session = await auth()
  if (!isOperator(session?.user?.email)) redirect("/signin")

  // The exact scope every availability decision below is made for. Bible §5:
  // Studio may show `Available` only when a decision passes for the exact
  // tenant/environment/region/version — so the region comes from the cell that
  // would actually serve these tenants, and the engine version from the build.
  // An engine that cannot say what version it is fails every compatibility
  // range closed, which is the correct answer and not a fallback.
  const availabilityScope = {
    region: fleet()[0]?.region ?? "",
    // The partition too, because an egress restriction is a partition fact
    // before it is a region one. Read from the cell registry, which reads the
    // environment and validates it — never a literal here.
    partition: fleet()[0]?.partition,
    engineVersion: process.env.ENGINE_VERSION ?? process.env.SCHEMA_VERSION ?? "unpinned",
    // The marketplace is closed as a property of the code, not of a flag
    // somebody forgot to set. Passing `false` here is the deliberate act the
    // parameter exists to require.
    marketplaceEnabled: false,
    now: new Date().toISOString(),
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

  const systems = TENANT_BINDINGS.map((binding) => {
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

  return (
    <>

      <h1>Organization systems</h1>
      <p>
        {systems.length} configured. Read-only — tenant overlays are files until the configuration
        store lands.
      </p>

      {/* Bible §5. Nothing here is labelled available except what a
          CapabilityAvailabilityDecision passed for the scope printed below, and
          nothing is silently missing: what was refused is listed with its
          reason. One scope rather than one per system because these bindings
          carry no region of their own — inventing a per-tenant scope out of the
          same cell region would be three copies of one decision wearing three
          labels. */}
      <section className="system">
        <header>
          <h2>Extensions, connectors and models</h2>
          <span className="slug">
            {availabilityScope.region || "no cell"} · engine {availabilityScope.engineVersion} ·
            marketplace closed
          </span>
        </header>

        <h3>Available — {offered.length} of {capabilities.length}</h3>
        {offered.length === 0 ? (
          <p className="refused">Nothing in the catalog passes for this scope.</p>
        ) : (
          <div className="chips">
            {offered.map((d) => (
              <span className="chip" key={d.entry.key} title={d.disclaimer ?? d.entry.displayName}>
                <b>{d.entry.key}</b> {d.entry.kind}
                {d.resolvedVersion ? ` v${d.resolvedVersion}` : ""}
                {d.certification === "expiring" ? " — re-certification due" : ""}
              </span>
            ))}
          </div>
        )}

        {refused.length > 0 && (
          <>
            <h3>Not available, and why</h3>
            {refused.map((d) => (
              <p className="refused" key={d.entry.key}>
                <b>{d.entry.key}</b> — {d.reason}
                {/* The provider's own answer, where the refusal is about them.
                    `provider-review-missing` covers NOT_SUBMITTED, IN_REVIEW
                    and REJECTED, and those send an operator to three different
                    places — so the state travels with the reason. */}
                {d.providerReview ? ` (${d.providerReview.program}: ${d.providerReview.state})` : ""}
                {/* The disclaimer is carried on the decision, so this cannot
                    render an availability verdict without the text that
                    qualifies it. */}
                {d.disclaimer ? ` — ${d.disclaimer}` : ""}
              </p>
            ))}
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
            <h3>
              Capabilities — {classified.filter((c) => c.status === "AVAILABLE").length} available of{" "}
              {classified.length}
            </h3>
            <table className="grid">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Product</th>
                  <th>Capability</th>
                  <th>Direction</th>
                  <th>Status</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {classified.map((c) => (
                  <tr key={`${c.entryKey}:${c.provider}/${c.product}/${c.capability}/${c.direction}`}>
                    <td className="id">{c.provider}</td>
                    <td>{c.product}</td>
                    <td>{c.capability}</td>
                    <td className="slug">{c.direction}</td>
                    <td>
                      {c.status}
                      {c.problems.map((p) => (
                        <span className="badge bad" key={p.reason}>
                          {" "}
                          {p.reason}
                        </span>
                      ))}
                    </td>
                    {/* An AVAILABLE or DEGRADED row with nothing here is a
                        claim nobody can retrace, and `capabilityProblems` has
                        already flagged it in the column to the left. */}
                    <td className="slug">{c.evidenceRefs.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {classified.flatMap((c) => c.problems).length > 0 && (
              <p className="error">
                {classified.flatMap((c) => c.problems).length} capability claims do not hold up.
                {classified
                  .flatMap((c) => c.problems)
                  .map((p) => ` ${p.capability}: ${p.detail}`)
                  .join("")}
              </p>
            )}
          </>
        )}
      </section>

      {systems.map((s) => (
        <section className="system" key={s.binding.slug}>
          <header>
            <h2>{s.binding.displayName}</h2>
            <span className="slug">/{s.binding.slug}</span>
            {s.error ? (
              <span className="badge bad">broken</span>
            ) : s.configProblems!.length > 0 || !s.topologyOk ? (
              <span className="badge warn">problems</span>
            ) : (
              <span className="badge ok">valid</span>
            )}
          </header>

          {s.error ? (
            <p className="error">{s.error}</p>
          ) : (
            <>
              <h3>Definition</h3>
              <dl className="kv">
                <dt>blueprint</dt>
                <dd>
                  {s.blueprint!.id} v{s.blueprint!.version}
                </dd>
                <dt>topology</dt>
                <dd>
                  {s.blueprint!.topology.id} — root {s.blueprint!.topology.rootType},{" "}
                  {s.blueprint!.topology.types.length} node types
                </dd>
                <dt>entitlements</dt>
                <dd>{(s.binding.entitlements ?? []).join(", ") || "none"}</dd>
                <dt>configuration</dt>
                <dd>{s.config?.checksum ?? "did not resolve"}</dd>
              </dl>

              <h3>Modules — {s.modules.keys.length} enabled</h3>
              <div className="chips">
                {s.modules.enabled.map((m) => (
                  <span className="chip" key={m.key} title={m.description}>
                    <b>{m.key}</b> v{m.version}
                  </span>
                ))}
              </div>
              {s.modules.problems.map((p) => (
                <p className="refused" key={`${p.moduleKey}:${p.reason}`}>
                  {p.moduleKey} — not enabled: {p.detail}
                </p>
              ))}

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
              {s.modules.paymentCapabilities.length > 0 && (
                <>
                  <h3>
                    Payments capabilities —{" "}
                    {s.modules.paymentCapabilities.filter((c) => c.transactable).length} transactable
                    of {s.modules.paymentCapabilities.length}
                  </h3>
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>Module</th>
                        <th>Capability</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.modules.paymentCapabilities.map((c: ModulePaymentCapability) => (
                        <tr key={`${c.moduleKey}:${c.capabilityId}`}>
                          <td className="id">{c.moduleKey}</td>
                          <td className="slug" title={c.summary}>
                            {c.capabilityId}
                          </td>
                          <td>
                            {c.state}
                            {!c.transactable && (
                              <span className="badge bad"> not transactable</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <h3>Configuration, and where each value came from</h3>
              <dl className="kv">
                {s.config &&
                  Object.keys(s.config.values)
                    .sort()
                    .map((key) => {
                      const why = s.config!.explain(key)
                      return (
                        <div key={key} style={{ display: "contents" }}>
                          <dt>{key}</dt>
                          <dd>
                            {JSON.stringify(s.config!.values[key])}{" "}
                            <span className="slug">
                              ({why.usedDefault ? "platform default" : why.contributors.map((c) => c.scope).join(" → ")})
                            </span>
                          </dd>
                        </div>
                      )
                    })}
              </dl>

              {s.configProblems!.length > 0 && (
                <>
                  <h3>Configuration problems</h3>
                  {s.configProblems!.map((p, i) => (
                    <p className="error" key={i}>
                      {p.key}: {p.reason} — {p.detail}
                    </p>
                  ))}
                </>
              )}
            </>
          )}
        </section>
      ))}
    </>
  )
}
