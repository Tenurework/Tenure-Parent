import { notFound, redirect } from "next/navigation"

import { auth } from "@/lib/auth"
import { TENANT_BINDINGS } from "@tenure/blueprints"
import { Card, CardHeader } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { PageHeader } from "@/components/ui/PageHeader"
import { isPlatformOperator, platformOperatorCount } from "@/lib/platform/operator"
import { buildSystem, type AssembledSystem } from "@/lib/system/build-system"
import { modulesFor } from "@/lib/config/system-modules"
import { resolveSystemConfig } from "@/lib/config/system-config"

export const dynamic = "force-dynamic"

/**
 * Tenure System Studio — what every configured organization system currently is.
 *
 * Read-only, deliberately. The engines underneath already support editing —
 * configuration publishes immutable versions, releases move through a state
 * machine with an approval gate — and wiring a write surface to them before
 * there is somewhere durable to store an edit would mean the Studio could
 * produce a system that survives until the next deploy. Tenant overlays are
 * files until ADR-0004's schema programme lands a configuration store; this
 * shows what those files resolve to, which is the half that is honest today.
 *
 * 404, not 403, for anyone who is not Tenure staff: the existence of the console
 * that configures other customers is not something to confirm to a customer.
 */
export default async function StudioPage() {
  const session = await auth()
  if (!session?.user) redirect("/signin")

  if (!isPlatformOperator(session.user.email)) notFound()

  const systems = TENANT_BINDINGS.map((binding) => {
    try {
      return {
        binding,
        system: buildSystem(binding.slug, {
          actor: session.user!.email ?? "operator",
          at: new Date().toISOString(),
          notes: "Studio preview — not published.",
        }),
        error: null as string | null,
      }
    } catch (err) {
      // One broken binding must not take out the console that would let someone
      // see it is broken.
      return {
        binding,
        system: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  return (
    <>
      <PageHeader
        eyebrow="Tenure platform"
        title="System Studio"
        subtitle={
          `${systems.length} configured organization ${systems.length === 1 ? "system" : "systems"}, ` +
          `assembled from blueprints, modules, topology and configuration. ` +
          `${platformOperatorCount()} platform operator${platformOperatorCount() === 1 ? "" : "s"} configured.`
        }
      />

      <div className="flex flex-col gap-5">
        {systems.map(({ binding, system, error }) => (
          <Card key={binding.slug}>
            <CardHeader
              title={binding.displayName}
              subtitle={`${binding.slug} · blueprint ${binding.blueprintId}`}
              action={
                error ? (
                  <Badge variant="error">Broken</Badge>
                ) : system!.validation.valid ? (
                  <Badge variant="success">Valid</Badge>
                ) : (
                  <Badge variant="warning">{system!.validation.problems.length} problems</Badge>
                )
              }
            />

            {error ? (
              <p className="mt-3 text-sm text-text-2">{error}</p>
            ) : (
              <SystemDetail slug={binding.slug} system={system!} />
            )}
          </Card>
        ))}
      </div>
    </>
  )
}

function SystemDetail({ slug, system }: { slug: string; system: AssembledSystem }) {
  const modules = modulesFor(slug)
  const config = resolveSystemConfig(slug)

  return (
    <div className="mt-4 flex flex-col gap-5">
      <Section title="Release candidate">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          <Row label="Blueprint" value={`${system.blueprintId} v${system.blueprintVersion}`} />
          <Row label="Configuration" value={system.configurationChecksum ?? "unresolved"} mono />
          <Row label="Release checksum" value={system.candidate?.checksum ?? "not built"} mono />
          <Row label="Policies" value={system.policyIds.join(", ") || "none"} />
        </dl>
      </Section>

      <Section title={`Modules — ${modules.keys.length} enabled`}>
        <div className="flex flex-wrap gap-1.5">
          {modules.enabled.map((m) => (
            <span
              key={m.key}
              className="rounded-md border border-border px-2 py-1 text-[12.5px] text-text-2"
              title={m.description}
            >
              {m.key}
              <span className="ml-1.5 text-text-3">v{m.version}</span>
            </span>
          ))}
        </div>

        {modules.problems.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {modules.problems.map((p) => (
              <li key={`${p.moduleKey}:${p.reason}`} className="text-[13px] text-text-3">
                <span className="font-medium text-text-2">{p.moduleKey}</span> — not enabled:{" "}
                {p.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Configuration, and where each value came from">
        <dl className="flex flex-col gap-1.5">
          {config.provenance &&
            Object.keys(config.values)
              .sort()
              .map((key) => {
                const why = config.explain(key)
                const source = why.usedDefault
                  ? "platform default"
                  : why.contributors.map((c) => c.scope).join(" → ")
                return (
                  <div key={key} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span className="font-mono text-text-3">{key}</span>
                    <span className="font-medium text-text-1">{String(config.values[key])}</span>
                    <span className="text-text-3">({source})</span>
                  </div>
                )
              })}
        </dl>
      </Section>

      {!system.validation.valid && (
        <Section title="Validation problems">
          <ul className="flex flex-col gap-1">
            {system.validation.problems.map((p, i) => (
              <li key={i} className="text-[13px] text-text-2">
                <span className="font-medium">{p.area}</span> — {p.detail}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="micro-label mb-2 text-text-3">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="text-[13px] text-text-3">{label}</dt>
      <dd className={`text-[13px] text-text-1 ${mono ? "break-all font-mono text-[12px]" : ""}`}>
        {value}
      </dd>
    </div>
  )
}
