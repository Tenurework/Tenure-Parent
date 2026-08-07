"use server"

import { revalidatePath } from "next/cache"

import {
  commit,
  planPublication,
  resolveVersionedLayers,
  type PublicationPlan,
  type VersionedLayer,
} from "@tenure/configuration"
import { REGISTRY } from "@tenure/platform-config"
import { MODULES } from "@tenure/modules"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { DynamoConfigStore } from "@/lib/config-store"
import { editableDomains, parseField } from "@/lib/editable-config"

/**
 * GE-032-001 — the tenant configuration editor's write path.
 *
 * Two steps, deliberately. `review` produces a `PublicationPlan` and writes
 * nothing; `publish` commits a plan that was produced this way. A one-step save
 * would make the diff, the lint, the impact preview and the four-eyes check
 * (GE-031-006) into things that happened somewhere the operator did not look.
 *
 * Everything goes through `commit` (GE-031-007). There is no second write path,
 * and `tests/security/one-config-writer.test.mjs` fails if one appears.
 */

const store = new DynamoConfigStore()

/**
 * When the change takes effect (GE-032-003).
 *
 * Empty means now. A past instant is passed through unchanged rather than
 * clamped, because `planPublication` refuses it with a reason and silently
 * moving it to now would publish something the operator did not ask for.
 */
function activationFrom(form: FormData): Date {
  const raw = String(form.get("activateAt") ?? "").trim()
  if (!raw) return new Date()
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

export interface ReviewResult {
  plan?: PublicationPlan
  layer?: VersionedLayer
  error?: string
}

async function requireOperator(): Promise<string> {
  const session = await auth()
  const email = session?.user?.email
  if (!isOperator(email)) {
    // The same refusal for "not signed in" and "signed in, not an operator".
    // Telling them apart tells an unauthenticated caller that an address is an
    // operator's, which is the fact worth protecting.
    throw new Error("Not authorised.")
  }
  return email!
}

/** Build the overlay a form submission describes. Only declared, editable keys. */
function layerFrom(slug: string, form: FormData, revision: number, changeReason: string, approvedBy: string): VersionedLayer {
  const values: Record<string, unknown> = {}

  for (const { fields } of editableDomains()) {
    for (const field of fields) {
      const parsed = parseField(field, form.get(field.key) as string | null)
      if (parsed !== undefined) values[field.key] = parsed
    }
  }

  return {
    kind: "tenantOverlay",
    id: slug,
    label: `${slug} overlay`,
    values,
    metadata: {
      // The next version, so an edit never rewrites a published one — the store
      // refuses that anyway (GE-031-003), and colliding here would surface as a
      // failed publish rather than as a form the operator can correct.
      version: revision + 1,
      schemaVersion: "1.0.0",
      signer: `operator:${approvedBy}`,
      origin: "system-studio/configuration-editor",
      compatibility: { minEngine: "2026.7.0", maxEngine: null },
      effectiveFrom: new Date().toISOString(),
      effectiveUntil: null,
      changeReason,
      approvedBy,
    },
  }
}

export async function review(_prev: ReviewResult | null, form: FormData): Promise<ReviewResult> {
  try {
    const publishedBy = await requireOperator()
    const slug = String(form.get("slug") ?? "")
    if (!slug) return { error: "No tenant." }

    const changeReason = String(form.get("changeReason") ?? "").trim()
    const approvedBy = String(form.get("approvedBy") ?? "").trim()
    if (!approvedBy) {
      return { error: "An approver is required. A configuration change needs a second identity." }
    }

    const latest = await store.latest(slug)
    const layer = layerFrom(slug, form, latest?.revision ?? 0, changeReason, approvedBy)

    const plan = planPublication({
      registry: REGISTRY,
      current: latest ? { values: latest.values, revision: latest.revision } : null,
      proposed: [layer],
      publishedBy,
      // Immediate. A scheduled activation is a separate control, and defaulting
      // to one would hide that this takes effect now.
      activateAt: activationFrom(form),
      now: new Date(),
      // GE-032-002. Without these the entitlement check never runs and a plan
      // can enable a module the contract does not cover — a console showing a
      // feature while every request for it is denied.
      // `provides` is not optional decoration. A dependency may name a
      // CAPABILITY another module supplies rather than a module key —
      // `reimbursements` depends on `finance.ledger`, which `budgeting`
      // provides — and without it the graph check cannot find a satisfier
      // and reports a dangling reference, which blocks EVERY publication.
      modules: MODULES.map((m) => ({
        key: m.key,
        dependsOn: m.dependsOn,
        provides: m.provides,
        entitlement: m.requiresEntitlement,
      })),
      // The editor does not enable modules yet — module enablement is a
      // separate surface. Passing the catalogue anyway means the check is live
      // the moment it does, rather than being wired later and forgotten.
      enabledModules: [],
      entitlements: [],
    })

    return { plan, layer }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export interface PublishResult {
  revision?: number
  error?: string
}

export async function publish(_prev: PublishResult | null, form: FormData): Promise<PublishResult> {
  try {
    const publishedBy = await requireOperator()
    const slug = String(form.get("slug") ?? "")

    // The layer is re-derived from the submitted form rather than trusted from
    // a hidden field. A hidden field carrying a serialised layer is a hidden
    // field carrying whatever the browser sends, and it would be the one input
    // this whole path does not validate.
    const changeReason = String(form.get("changeReason") ?? "").trim()
    const approvedBy = String(form.get("approvedBy") ?? "").trim()
    const latest = await store.latest(slug)
    const layer = layerFrom(slug, form, latest?.revision ?? 0, changeReason, approvedBy)

    const plan = planPublication({
      registry: REGISTRY,
      current: latest ? { values: latest.values, revision: latest.revision } : null,
      proposed: [layer],
      publishedBy,
      activateAt: activationFrom(form),
      now: new Date(),
      // `provides` is not optional decoration. A dependency may name a
      // CAPABILITY another module supplies rather than a module key —
      // `reimbursements` depends on `finance.ledger`, which `budgeting`
      // provides — and without it the graph check cannot find a satisfier
      // and reports a dangling reference, which blocks EVERY publication.
      modules: MODULES.map((m) => ({
        key: m.key,
        dependsOn: m.dependsOn,
        provides: m.provides,
        entitlement: m.requiresEntitlement,
      })),
      enabledModules: [],
      entitlements: [],
    })

    if (plan.blocked) {
      // Violations included: "this is not yours to change" is the answer an
      // operator most needs, and omitting it would report a refusal with no
      // reason attached to it.
      return {
        error: [
          ...plan.blockers,
          ...plan.violations.map((v) => v.detail),
          ...plan.rejections.map((r) => r.detail),
        ].join(" "),
      }
    }

    const resolved = resolveVersionedLayers(REGISTRY, [layer], new Date(), { collectProblems: true })
    if (!resolved.config) return { error: "The proposed configuration does not resolve." }

    const record = await commit({
      store,
      tenantId: slug,
      plan,
      layers: [layer],
      values: resolved.config.values,
      checksum: resolved.config.checksum,
      publishedBy,
      publishedAt: new Date(),
    })

    revalidatePath(`/tenants/${slug}/configuration`)
    return { revision: record.revision }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export interface RollbackResult {
  revision?: number
  error?: string
}

/**
 * GE-032-003 — roll back by publishing forward.
 *
 * The target revision's layers are republished as a NEW revision. History is
 * never rewound: the record of what was live has to survive the decision to
 * stop living with it, or an incident review asking "what was the configuration
 * at 14:20" gets a confident wrong answer.
 *
 * It goes through `planPublication` and `commit` like any other change, so the
 * four-eyes check, the invariants and the immutability check all apply. A
 * rollback is a publication, and treating it as a special case that skips them
 * is how the one change nobody reviewed becomes the one that breaks things.
 */
export async function rollback(_prev: RollbackResult | null, form: FormData): Promise<RollbackResult> {
  try {
    const publishedBy = await requireOperator()
    const slug = String(form.get("slug") ?? "")
    const to = Number(form.get("toRevision"))
    const approvedBy = String(form.get("approvedBy") ?? "").trim()
    if (!approvedBy) return { error: "A rollback needs an approver, like any other publication." }
    if (!Number.isInteger(to)) return { error: "No revision to roll back to." }

    const history = await store.history(slug)
    const target = history.find((r) => r.revision === to)
    if (!target) return { error: `Revision ${to} is not in this tenant's history.` }

    const latest = history[history.length - 1]
    if (latest.revision === to) return { error: `Revision ${to} is already live.` }

    // The target's values, republished under a new layer version. Its own
    // layers cannot be reused verbatim: their versions are already published,
    // and `commit` refuses a version that says something different — which,
    // after later edits, this would.
    const layer: VersionedLayer = {
      kind: "tenantOverlay",
      id: slug,
      label: `${slug} overlay`,
      values: target.layers.flatMap((l) => Object.entries(l.values)).reduce<Record<string, unknown>>(
        (acc, [k, v]) => ({ ...acc, [k]: v }),
        {},
      ),
      metadata: {
        version: latest.revision + 1,
        schemaVersion: "1.0.0",
        signer: `operator:${approvedBy}`,
        origin: "system-studio/rollback",
        compatibility: { minEngine: "2026.7.0", maxEngine: null },
        effectiveFrom: new Date().toISOString(),
        effectiveUntil: null,
        changeReason: `Roll back to revision ${to}.`,
        approvedBy,
      },
    }

    const plan = planPublication({
      registry: REGISTRY,
      current: { values: latest.values, revision: latest.revision },
      proposed: [layer],
      publishedBy,
      activateAt: activationFrom(form),
      now: new Date(),
      // `provides` is not optional decoration. A dependency may name a
      // CAPABILITY another module supplies rather than a module key —
      // `reimbursements` depends on `finance.ledger`, which `budgeting`
      // provides — and without it the graph check cannot find a satisfier
      // and reports a dangling reference, which blocks EVERY publication.
      modules: MODULES.map((m) => ({
        key: m.key,
        dependsOn: m.dependsOn,
        provides: m.provides,
        entitlement: m.requiresEntitlement,
      })),
      enabledModules: [],
      entitlements: [],
    })

    if (plan.blocked) {
      return {
        error: [
          ...plan.blockers,
          ...plan.violations.map((v) => v.detail),
          ...plan.rejections.map((r) => r.detail),
        ].join(" "),
      }
    }

    const resolved = resolveVersionedLayers(REGISTRY, [layer], new Date(), { collectProblems: true })
    if (!resolved.config) return { error: "The rolled-back configuration does not resolve." }

    const record = await commit({
      store,
      tenantId: slug,
      plan,
      layers: [layer],
      values: resolved.config.values,
      checksum: resolved.config.checksum,
      publishedBy,
      publishedAt: new Date(),
    })

    revalidatePath(`/tenants/${slug}/configuration`)
    return { revision: record.revision }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
