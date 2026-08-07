import Link from "next/link"
import { redirect } from "next/navigation"

import {
  ALWAYS_ON_MODULES,
  ARCHETYPE_AXES,
  FUNCTIONAL_SUITES,
  TENANT_BINDINGS,
  compileArchetype,
  getBlueprint,
} from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import { ENABLEABLE } from "@tenure/module-runtime"
import {
  BUSINESS_DOMAINS,
  COEXISTENCE_PROFILES,
  PLAN_CATALOG,
  type CoexistenceProfile,
} from "@tenure/provisioning"

/**
 * What each coexistence profile means, in an operator's words — bible §2.
 *
 * Beside the form rather than inside the type: the constant is the closed list
 * the validator checks against, and prose belongs on the surface that renders
 * it. Typed as a total record, so adding a profile does not compile until
 * somebody writes what it means.
 */
const COEXISTENCE_MEANING: Record<CoexistenceProfile, string> = {
  TENURE_CLOUD_PRIMARY: "Tenure is authoritative for the selected domains",
  EXTERNAL_ERP_PRIMARY: "an external ERP is authoritative; Tenure augments it",
  TWO_TIER_SUBSIDIARY: "Tenure runs local domains and consolidates to a corporate ERP",
  HYBRID_PROCESS_SPLIT: "the system of record is assigned per domain",
  COEXISTENCE_TRANSITION: "temporary controlled coexistence during a transformation",
  MIGRATION_IN_PROGRESS: "Tenure becomes authoritative after reconciliation and cutover",
  ARCHIVE_AND_MEMORY: "legacy records retained and searchable, read-only",
}

import { placeableRegions } from "@/lib/cells"

import { auth } from "@/lib/auth"
import { isOperator } from "@/lib/operators"
import { ComposeForm } from "./ComposeForm"

export const dynamic = "force-dynamic"

/**
 * Compose a tenant.
 *
 * The form is a client component only because it needs `useActionState` to show
 * validation problems without losing what was typed. Everything it offers —
 * blueprints, modules — is read here, on the server, from the same catalogs
 * provisioning will use. A hardcoded list in the form would drift from what can
 * actually be built.
 */
export default async function NewTenantPage() {
  const session = await auth()
  if (!isOperator(session?.user?.email)) redirect("/signin")

  const blueprints = [...new Set(TENANT_BINDINGS.map((b) => b.blueprintId))].map((id) => ({
    id,
    // The blueprint's own point on every axis, so opening the form shows the
    // preset rather than an empty composition the operator has to reconstruct.
    axes: getBlueprint(id)!.axes,
  }))

  // PACK-000-004. `lifecycle` used to be dropped here, so a module in
  // `development` or `retired` was offered to an operator as a plain checkbox
  // with no state shown — an `Available` claim made by omission. It is carried
  // through and rendered, and `enableable` is decided by the same
  // `ENABLEABLE` set the resolver refuses with, rather than by a second list.
  const modules = MODULE_CATALOG.all().map((m) => ({
    key: m.key,
    description: m.description,
    version: m.version,
    lifecycle: m.lifecycle,
    enableable: ENABLEABLE.has(m.lifecycle),
    // PAY-160-002. The manifest's own list price, carried through rather than
    // restated: the composer quotes what `validateManifest` admitted, so a
    // price shown here and a price the catalog accepted cannot disagree.
    price: m.price,
  }))

  /**
   * What each functional suite contributes, projected out of the compiler.
   *
   * Not a second copy of the suite→module mapping. Each entry is what
   * `compileArchetype` actually returns for a selection containing only that
   * suite, minus the modules every system runs — so the table the form defaults
   * its checkboxes from and the set the server compiles cannot disagree. A
   * literal here would be the second answer that drifts.
   */
  const suiteModules = Object.fromEntries(
    FUNCTIONAL_SUITES.map((suite) => [
      suite,
      compileArchetype({
        // Neither of these affects the module set; `functional` is the axis that
        // compiles it. They are supplied because a selection is complete or it
        // is refused.
        organization: blueprints[0].axes.organization,
        operatingModel: blueprints[0].axes.operatingModel,
        functional: [suite],
      }).modules.filter((key) => !ALWAYS_ON_MODULES.includes(key)),
    ]),
  )
  const plans = PLAN_CATALOG.map((plan) => ({
    planId: plan.planId,
    displayName: plan.displayName,
    grants:
      plan.entitlements.length > 0
        ? plan.entitlements.join(", ")
        : "blueprint modules only",
  }))

  return (
    <>

      <p className="breadcrumb">
        <Link href="/tenants">Tenants</Link> <span aria-hidden="true">/</span> Compose
      </p>

      <h1>Compose a tenant</h1>
      <p>
        This registers the tenant in <code>DRAFT</code>. Nothing is built, nothing is billed, and no
        routing changes — provisioning is a separate, approved step you take from the tenant&rsquo;s
        page once you have read its plan.
      </p>

      {/* The axis table, from the engine that compiles it. A hard-coded list of
          axis values in the form would offer an operator a composition the
          compiler refuses. */}
      <ComposeForm
        blueprints={blueprints}
        modules={modules}
        plans={plans}
        regions={placeableRegions()}
        alwaysOnModules={[...ALWAYS_ON_MODULES]}
        suiteModules={suiteModules}
        // PACK-020-004. From the closed lists the validator checks against, so
        // the form cannot offer a profile or a domain the server refuses.
        coexistenceProfiles={COEXISTENCE_PROFILES.map((id) => ({
          id,
          meaning: COEXISTENCE_MEANING[id],
        }))}
        businessDomains={BUSINESS_DOMAINS}
        axes={ARCHETYPE_AXES.map((axis) => ({
          id: axis.id,
          label: axis.label,
          cardinality: axis.cardinality,
          effect: axis.effect,
          values: axis.values.map((v) => ({
            id: v.id,
            label: v.label,
            description: v.description,
          })),
        }))}
      />
    </>
  )
}
