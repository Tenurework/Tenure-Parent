import Link from "next/link"
import { redirect } from "next/navigation"

import {
  ALWAYS_ON_MODULES,
  ARCHETYPE_AXES,
  BLUEPRINTS,
  FUNCTIONAL_SUITES,
  compileArchetype,
  type ArchetypeSelection,
} from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import { ENABLEABLE, resolveModules } from "@tenure/module-runtime"
import { compareVersionStrings } from "@tenure/platform-config"
import { ENGINE_VERSION } from "@tenure/configuration"
import {
  BUSINESS_DOMAINS,
  COEXISTENCE_PROFILES,
  ISOLATION_CLASSES,
  PLAN_CATALOG,
  type CoexistenceProfile,
  type IsolationClass,
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

/**
 * What each isolation class means, in an operator's words — bible §5.
 *
 * Beside the constant for the same reason `COEXISTENCE_MEANING` is: the closed
 * list is the vocabulary the validator checks against, and prose belongs on the
 * surface that renders it. Typed as a total record, so adding a class does not
 * compile until somebody writes what it means.
 *
 * This replaced four `<option>` literals in the form, one of which asserted
 * "unavailable, needs GE-010" — a claim about the estate written into markup, a
 * second copy of a rule that already lives in `validateManifest`. The sentence
 * below names the same ADR the server's own refusal names, and the operator who
 * chooses it still meets that refusal itemised rather than being quietly
 * prevented from asking.
 */
const ISOLATION_MEANING: Record<IsolationClass, string> = {
  pooled: "shares the cell's database and cluster; separation is the application's tenant scope",
  bridge: "shares the cluster, with the tenant's own schema",
  silo: "dedicated resources inside the shared cell",
  "dedicated-account":
    "a Tenure-owned AWS account of its own, which needs an Organization to vend it; ADR-0007 / GE-010 records that none exists, so composeTenant refuses this today",
}

import { placeableRegions } from "@/lib/cells"

import { auth } from "@/lib/auth"
import { authorizeCommand } from "@/lib/authorize"
import { PermissionDeniedState } from "@/components/states"
import { ComposeForm } from "./ComposeForm"
import { placementOffer } from "./placement"

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
  // STUDIO-020-006. The same command `composeTenant` authorizes, so the form
  // cannot be reachable by somebody the action would refuse — and the action
  // still re-decides, because rendering the page is not a precondition for
  // posting to it.
  const session = await auth()
  const decision = authorizeCommand("tenants.compose", { principalId: session?.user?.email })
  if (decision.reason === "NO_PRINCIPAL") redirect("/signin")
  if (!decision.allowed) return <PermissionDeniedState />

  /*
   * Every blueprint, from the blueprint catalog.
   *
   * This used to be the distinct `blueprintId`s of `TENANT_BINDINGS` — the
   * blueprints somebody is already bound to — which had two defects at once.
   * `corporate-divisions` exists in `BLUEPRINTS` and no tenant is bound to it,
   * so the composer could not offer it at all: a blueprint nobody had used yet
   * was a blueprint nobody could use. And `TENANT_BINDINGS` carries the
   * FIXTURES, which is why `tests/architecture/no-fixture-tenants-on-operator-surfaces.test.mjs`
   * names this file — an operator surface has no business reading the
   * unfiltered bindings.
   *
   * The catalog answers the question that was actually being asked. Its first
   * entry is the same blueprint the bindings' first entry pointed at, so the
   * form still opens where it did.
   */
  const blueprints = BLUEPRINTS.map((b) => ({ id: b.id, axes: b.axes }))

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

  /*
   * The plan the form opens on, decided by the resolver that would refuse it.
   *
   * This used to be `defaultValue="institution-core"`, a literal in the markup,
   * and it made the composer's out-of-the-box state one the server always
   * rejected: the default blueprint's preset carries `budgeting` and
   * `reimbursements`, both of which require the `finance` entitlement, and
   * `institution-core` grants none. Opening the page and pressing Register —
   * which is what an operator does the first time, and what
   * `high-risk-fails-closed.spec.ts` does every time — produced three problems
   * and registered nothing.
   *
   * So it is derived, from the catalog order (cheapest commitment first) and
   * from `resolveModules` — the SAME call `composeTenant` makes, with the same
   * engine version and the same operating model. A default the form offers and
   * a default the action refuses can no longer disagree, because one function
   * decides both.
   *
   * The fallback is the first plan rather than none: if no plan can carry the
   * preset that is a fact about the catalog, and the operator should meet it as
   * the action's own itemised refusal — which names the modules and the
   * entitlement — rather than as an empty select with nothing to choose.
   */
  const presetModules = compileArchetype(blueprints[0].axes as ArchetypeSelection).modules
  const defaultPlanId =
    PLAN_CATALOG.find(
      (plan) =>
        resolveModules(MODULE_CATALOG, {
          requested: presetModules,
          entitlements: plan.entitlements,
          runningEngineVersion: ENGINE_VERSION,
          compareVersions: compareVersionStrings,
          operatingModel: blueprints[0].axes.operatingModel,
          // Every domain Tenure's own, which is what the form defaults
          // `coexistence` to (TENURE_CLOUD_PRIMARY, no external domain).
          systemOfRecord: Object.fromEntries(
            BUSINESS_DOMAINS.map((domain) => [domain, "tenure" as const]),
          ),
        }).problems.length === 0,
    )?.planId ?? PLAN_CATALOG[0].planId

  /*
   * STUDIO-000-007. Where the fleet will accept a tenant — or why it cannot say.
   *
   * `placeableRegions()` was called bare here, and it THROWS: `lib/cells.ts`
   * refuses to invent an estate, so a deployment with no `AWS_REGION`,
   * `AWS_ACCOUNT_ID` or `AWS_PARTITION` that `sts:GetCallerIdentity` cannot
   * answer for gets a `FleetMisconfigured` — and this route answered 500. A
   * stack trace is not a refusal an operator can act on, and the console is
   * required to boot without AWS credentials and say what is missing.
   *
   * `placementOffer` catches it and returns one of four states; the form
   * renders a region control for one of them and a named remedy for the other
   * three. The refusal to guess a region is unchanged — it is now stated
   * instead of thrown.
   */
  const placement = placementOffer(placeableRegions)
  const fleetReadAt = new Date().toISOString()

  return (
    <>
      <p className="breadcrumb">
        <Link href="/tenants">Tenants</Link> <span aria-hidden="true">/</span> Compose
      </p>

      <h1>Compose a tenant</h1>

      {/*
        The answer, in words, before any apparatus.

        The question this page exists to answer is "what am I about to create,
        and what will it cost". It used to open on a description of the FORM —
        which panel says what — and then on a seat-count box. That is the
        apparatus, and an operator who has to read the apparatus to find the
        answer has been handed a construction site.

        Two paragraphs, both of them the answer: what a composition IS and what
        registering one does, then where the money comes from and when it is
        known. Every figure they promise is computed below from the module
        catalog's own list prices, never estimated here.
      */}
      <p className="md3-body-large">
        You are about to create <b>one tenant system</b>: an organisation, the modules it runs, the
        plan it is contracted on, the cell it runs in and the one administrator who can sign into
        it. Registering it puts it in <b>DRAFT</b> — nothing is built, nothing is billed, no
        routing changes, and no AWS resource is created. Provisioning is a separate, approved step
        taken later from the tenant&rsquo;s own page.
      </p>
      <p className="md3-body-medium">
        <b>What it would cost is known before you decide, not after.</b> Every option below carries
        its list price per seat and for the whole organisation, and the running total at the top of
        the form moves as you configure — quoted in whole minor units of one stated currency from
        each module manifest&rsquo;s own price, the same prices the catalog validated. If any
        selected option&rsquo;s price cannot be resolved, no total is shown at all and the options
        at fault are named — the figure is never computed without them and never counted as zero,
        because a zero on this page would read as free.
      </p>

      <ComposeForm
        blueprints={blueprints}
        modules={modules}
        plans={plans}
        defaultPlanId={defaultPlanId}
        placement={placement}
        alwaysOnModules={[...ALWAYS_ON_MODULES]}
        suiteModules={suiteModules}
        engineVersion={ENGINE_VERSION}
        fleetReadAt={fleetReadAt}
        // PACK-020-004. From the closed lists the validator checks against, so
        // the form cannot offer a profile or a domain the server refuses.
        coexistenceProfiles={COEXISTENCE_PROFILES.map((id) => ({
          id,
          meaning: COEXISTENCE_MEANING[id],
        }))}
        // From `ISOLATION_CLASSES`, so the form cannot offer a class the server
        // has never heard of — and cannot fail to offer one it has.
        isolationClasses={ISOLATION_CLASSES.map((id) => ({ id, meaning: ISOLATION_MEANING[id] }))}
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
