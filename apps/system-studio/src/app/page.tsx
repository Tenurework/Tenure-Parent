import { redirect } from "next/navigation"

import { TENANT_BINDINGS, getBlueprint } from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import { resolveConfig } from "@tenure/configuration"
import { validateTopology } from "@tenure/organization-model"
import { resolveModules } from "@tenure/module-runtime"

import { auth } from "@/lib/auth"
import { isOperator, operatorConfigProblems } from "@/lib/operators"
import { REGISTRY, layersFor } from "@tenure/platform-config"

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

  const systems = TENANT_BINDINGS.map((binding) => {
    const blueprint = getBlueprint(binding.blueprintId)
    if (!blueprint) {
      return { binding, error: `Blueprint "${binding.blueprintId}" does not exist.` as const }
    }

    const { config, problems: configProblems } = resolveConfig(REGISTRY, layersFor(binding.slug), {
      collectProblems: true,
    })
    const modules = resolveModules(MODULE_CATALOG, {
      requested: blueprint.modules,
      entitlements: binding.entitlements ?? [],
    })

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
                {s.modules.ordered.map((m) => (
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
