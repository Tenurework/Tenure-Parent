"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { TENANT_BINDINGS, getBlueprint } from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import { resolveConfig } from "@tenure/configuration"
import { resolveModules } from "@tenure/module-runtime"
import { validateTopology } from "@tenure/organization-model"
import { REGISTRY, layersFor } from "@tenure/platform-config"
import {
  MANIFEST_VERSION,
  LifecycleError,
  deploymentManifest,
  executeStep,
  validateManifest,
  type ExecutionContext,
  type IsolationTier,
  type TenantManifest,
  type TenantState,
} from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { SlugTaken, advanceTenant, getTenant, registerTenant, takenSlugs } from "@/lib/registry"
import { deliverToCell } from "@/lib/deliver"

/**
 * Every action here re-checks the operator, in the action.
 *
 * The pages check too, but a server action is a POST endpoint reachable by its
 * id — rendering the page is not a precondition for calling it. A guard that
 * lives only in the page protects the page.
 */
async function operator(): Promise<string> {
  const session = await auth()
  const email = session?.user?.email
  if (!isOperator(email)) {
    // 404-shaped, like the rest of the console: the existence of an endpoint
    // that provisions tenants is not something to confirm to a stranger.
    throw new Error("Not found")
  }
  return email!
}

const now = () => new Date().toISOString()

/**
 * The engines the executor runs against.
 *
 * Built here, from the real catalogs, and passed in — so the executor stays
 * free of them and the console cannot accidentally verify a tenant against a
 * different configuration engine than the one that will build it.
 */
function executionContext(): ExecutionContext {
  return {
    resolveConfiguration(manifest) {
      // A tenant composed in this console has no file binding, so `layersFor`
      // returns nothing for it and every value would fall back to a platform
      // default — a system that looks configured and is not. The blueprint
      // layer is therefore built from the manifest, and the file binding is
      // used only when one exists (the pilot, which predates the registry).
      const fileLayers = layersFor(manifest.slug)
      const blueprint = getBlueprint(manifest.blueprintId)
      const layers =
        fileLayers.length > 0
          ? fileLayers
          : blueprint
            ? [
                {
                  scope: "blueprint" as const,
                  id: blueprint.id,
                  label: blueprint.name,
                  values: blueprint.values,
                },
                {
                  scope: "tenant" as const,
                  id: manifest.slug,
                  label: manifest.displayName,
                  values: manifest.configuration,
                },
              ]
            : []

      const { config, problems } = resolveConfig(REGISTRY, layers, { collectProblems: true })
      return {
        checksum: config?.checksum ?? "",
        values: config?.values ?? {},
        problems: problems ?? [],
      }
    },
    resolveModules(manifest) {
      const resolved = resolveModules(MODULE_CATALOG, {
        requested: manifest.modules,
        entitlements: manifest.entitlements,
      })
      return {
        ordered: resolved.ordered.map((m) => ({ key: m.key, version: m.version })),
        problems: resolved.problems,
      }
    },
    validateTopology(manifest) {
      const blueprint = getBlueprint(manifest.blueprintId)
      if (!blueprint) return { valid: false, problems: [`No blueprint "${manifest.blueprintId}".`] }
      try {
        validateTopology(blueprint.topology)
        return { valid: true, problems: [] }
      } catch (err) {
        return { valid: false, problems: [err instanceof Error ? err.message : String(err)] }
      }
    },
    // Pinned to the migration the cell is expected to be at. Read from the
    // build rather than hardcoded so a stale engine cannot publish an artifact
    // claiming a schema it does not know about.
    schemaVersion: () => process.env.SCHEMA_VERSION ?? "unpinned",
  }
}

export interface ComposeResult {
  problems: Array<{ field: string; reason: string; detail: string }>
}

/**
 * Compose a tenant from the form and register it in DRAFT.
 *
 * Validation happens here rather than only in the browser, because the browser
 * is not where trust lives — and because the same function is what the plan
 * preview calls, so what an operator was shown is what gets written.
 */
export async function composeTenant(_prev: ComposeResult | null, form: FormData): Promise<ComposeResult> {
  const principalId = await operator()

  const manifest: TenantManifest = {
    manifestVersion: MANIFEST_VERSION,
    slug: String(form.get("slug") ?? "").trim().toLowerCase(),
    legalName: String(form.get("legalName") ?? "").trim(),
    displayName: String(form.get("displayName") ?? "").trim(),
    blueprintId: String(form.get("blueprintId") ?? ""),
    modules: form.getAll("modules").map(String),
    entitlements: String(form.get("entitlements") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    region: String(form.get("region") ?? "us-east-1"),
    isolation: String(form.get("isolation") ?? "pooled") as IsolationTier,
    configuration: {},
    secretRefs: {},
    initialAdminEmail: String(form.get("initialAdminEmail") ?? "").trim(),
    notes: String(form.get("notes") ?? "").trim() || undefined,
  }

  const { valid, problems } = validateManifest(manifest, {
    knownBlueprints: [...new Set(TENANT_BINDINGS.map((b) => b.blueprintId))],
    knownModules: MODULE_CATALOG.keys(),
    // Both sources of truth for an existing slug: registered tenants, and the
    // file-based bindings that predate the registry. Missing the second would
    // let someone register "rochester" over the live pilot.
    takenSlugs: [...(await takenSlugs()), ...TENANT_BINDINGS.map((b) => b.slug)],
  })

  // Module dependencies are resolved here, not only at VALIDATING. A manifest
  // that cannot build should not be registrable: catching it at composition
  // puts the message in front of the checkbox that caused it, rather than in
  // front of an operator wondering why a registered tenant will not advance.
  const moduleProblems = resolveModules(MODULE_CATALOG, {
    requested: manifest.modules,
    entitlements: manifest.entitlements,
  }).problems.map((p) => ({
    field: "modules",
    reason: p.reason,
    detail: `${p.moduleKey}: ${p.detail}`,
  }))

  if (!valid || moduleProblems.length > 0) {
    return { problems: [...problems, ...moduleProblems] }
  }

  try {
    await registerTenant(manifest, { principalId, at: now() })
  } catch (err) {
    if (err instanceof SlugTaken) {
      // Lost the race between validation and the conditional write. Reported as
      // the same problem shape rather than a 500, because it is a form error.
      return {
        problems: [
          { field: "slug", reason: "taken", detail: `"${manifest.slug}" was registered a moment ago.` },
        ],
      }
    }
    throw err
  }

  revalidatePath("/tenants")
  redirect(`/tenants/${manifest.slug}`)
}

export interface AdvanceResult {
  error?: string
}

/**
 * Move a tenant one state along.
 *
 * The button an operator clicks names the destination; whether that move is
 * legal, and whether it needs a second person, is decided by the lifecycle
 * engine. This action does not know the rules and must not — a UI that encodes
 * them separately is a UI that will disagree with them.
 */
export async function advanceState(_prev: AdvanceResult | null, form: FormData): Promise<AdvanceResult> {
  const principalId = await operator()

  const slug = String(form.get("slug") ?? "")
  const to = String(form.get("to") ?? "") as TenantState
  const approvedBy = String(form.get("approvedBy") ?? "").trim() || undefined
  const reason = String(form.get("reason") ?? "").trim() || undefined

  const at = now()

  try {
    // Run the work for the destination state BEFORE recording the move. A step
    // that fails must not leave a tenant claiming to be in a state it never
    // reached — which is precisely what the lifecycle looked like before the
    // executor existed.
    const tenant = await getTenant(slug)
    if (!tenant) return { error: `No tenant "${slug}".` }

    const ctx = executionContext()
    const evidence = executeStep(to, tenant.manifest, ctx)

    // MIGRATING is the hand-off. The artifact is delivered here, and the
    // evidence records what the cell actually did — or that nothing received
    // it, which must not read as success.
    if (to === "MIGRATING" && tenant.deployment) {
      const outcome = await deliverToCell(tenant.deployment, tenant.manifest)
      evidence.detail = `${evidence.detail} ${outcome.detail}`
      evidence.checks = [
        ...(evidence.checks ?? []),
        {
          name: "delivered to the cell",
          ok: outcome.delivered,
          detail: outcome.detail,
        },
      ]
      if (!outcome.delivered) evidence.ok = false
    }

    if (!evidence.ok) {
      const failed = (evidence.checks ?? []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)
      return {
        error: `${to} did not complete. ${evidence.detail}${failed.length ? ` — ${failed.join("; ")}` : ""}`,
      }
    }

    // The signed artifact is written once, when configuring succeeds, because
    // that is the step that computes what a cell reconciles toward.
    const deployment =
      to === "CONFIGURING"
        ? deploymentManifest(tenant.manifest, [...tenant.evidence, evidence], ctx, {
            createdAt: at,
            createdBy: principalId,
          })
        : undefined

    await advanceTenant(
      slug,
      to,
      { actor: { principalId, at }, approvedBy, reason },
      evidence,
      deployment,
    )
  } catch (err) {
    if (err instanceof LifecycleError) return { error: err.message }
    if ((err as { name?: string }).name === "TransactionCanceledException") {
      return {
        error:
          "This tenant moved while the page was open — someone else advanced it. Reload to see where it is now.",
      }
    }
    throw err
  }

  revalidatePath(`/tenants/${slug}`)
  revalidatePath("/tenants")
  return {}
}
