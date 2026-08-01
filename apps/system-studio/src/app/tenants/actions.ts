"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { TENANT_BINDINGS } from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import {
  MANIFEST_VERSION,
  LifecycleError,
  validateManifest,
  type IsolationTier,
  type TenantManifest,
  type TenantState,
} from "@tenure/provisioning"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { SlugTaken, advanceTenant, registerTenant, takenSlugs } from "@/lib/registry"

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

  if (!valid) return { problems }

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

  try {
    await advanceTenant(slug, to, { actor: { principalId, at: now() }, approvedBy, reason })
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
