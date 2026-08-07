import { universityStudentOrganizations } from "./university-student-organizations/blueprint"
import { nonprofitProgramOperations } from "./nonprofit-program-operations/blueprint"
import { corporateDivisions } from "./corporate-divisions/blueprint"
import type { ModuleEdits, SystemBlueprint, TenantBinding } from "./types"
import {
  compileArchetype,
  mergeArchetype,
  type ArchetypeSelection,
  type CompiledArchetype,
} from "./archetype"

export type { ModuleEdits, SystemBlueprint, TenantBinding }
export { ModuleEditError, applyModuleEdits, moduleEditsBetween } from "./types"

export {
  ALWAYS_ON_MODULES,
  ARCHETYPE_AXES,
  ARCHETYPE_AXIS_IDS,
  ARCHETYPE_AXIS_VALUES,
  ARCHETYPE_COMPILED_KEYS,
  ArchetypeError,
  FUNCTIONAL_SUITES,
  OPERATING_MODELS,
  ORGANIZATION_ARCHETYPES,
  archetypeProblems,
  compileArchetype,
  mergeArchetype,
} from "./archetype"
export type {
  ArchetypeAxis,
  ArchetypeAxisId,
  ArchetypeAxisValue,
  ArchetypeOverride,
  ArchetypeSelection,
  CompiledArchetype,
  FunctionalSuite,
  OperatingModel,
  OrganizationArchetype,
} from "./archetype"

export const BLUEPRINTS: readonly SystemBlueprint[] = [
  universityStudentOrganizations,
  nonprofitProgramOperations,
  corporateDivisions,
]

const BY_ID = new Map(BLUEPRINTS.map((b) => [b.id, b]))

export function getBlueprint(id: string): SystemBlueprint | undefined {
  return BY_ID.get(id)
}

/**
 * Which system each institution runs, and the words it uses for it.
 *
 * Data, not code. Nothing branches on a tenant's name; a lookup returns that
 * tenant's layers and the same resolver folds them. `rochester` and
 * `midtown-arts` differ only in what comes back from here.
 *
 * `midtown-arts` is a fixture, not a customer. It is bound to the second
 * blueprint so that "the engine is configurable rather than university-specific"
 * is a statement a test can fail, rather than one a README asserts.
 */
export const TENANT_BINDINGS: readonly TenantBinding[] = [
  {
    // Simon OSE — the live pilot, and the system that `Tenurework/Tenure` deploys.
    //
    // Worth being exact about what that repository is, because it changes how to
    // read this whole directory: it is not "the product" with Tenure-Parent as
    // an abstraction over it. It is *one tenant's system*. The Ainslie Office of
    // Student Engagement at Simon Business School is tenant #1, and the platform
    // has to be able to produce that system as configuration rather than as the
    // thing it was built around.
    //
    // The slug is `rochester` because that is what the database says today
    // (`apps/web/scripts/seed.mjs`). Simon is a school within the University of
    // Rochester, so the slug names the university and the terminology names the
    // office. Renaming the slug is a data migration and belongs to the schema
    // programme, not here.
    slug: "rochester",
    blueprintId: "university-student-organizations",
    displayName: "Simon Business School — Ainslie OSE",
    entitlements: ["finance"],
    // The pilot bought the ledger tier: budgets, and the postings behind them.
    // `finance.approver` requires it (packages/authorization/src/role-templates.ts),
    // so this line is what lets an approver put a budget into force — and
    // removing it is what stops them, with TIER_TOO_LOW rather than silence.
    currentTier: { budgeting: "ledger" },
    values: {
      // The name the institution actually uses, and the reason this file exists:
      // it was a literal in eight components.
      "platform.terminology.staffOfficeName": "Ainslie OSE",
      "platform.terminology.staffOfficeShortName": "OSE",
    },
  },
  {
    slug: "midtown-arts",
    blueprintId: "nonprofit-program-operations",
    displayName: "Midtown Arts Collective",
    // No finance entitlement: budgeting is in its blueprint and is refused for
    // this tenant, with that reason. Proves entitlement gating is real.
    entitlements: [],
    values: {
      "platform.terminology.staffOfficeName": "Midtown Program Office",
      "platform.terminology.staffOfficeShortName": "MPO",
    },
  },
  {
    // A fixture, like `midtown-arts` and for the same reason — not a customer,
    // and deliberately not seeded into any database.
    //
    // Both real bindings are English, Monday-to-Friday and left-to-right, so
    // every localization claim the engine makes is currently true by accident.
    // This one is written in a right-to-left script, works Sunday to Thursday,
    // and closes on dates neither other tenant observes. It exists so that
    // "the engine handles a locale and a working week that are not the pilot's"
    // is a statement a test can FAIL rather than one a comment asserts
    // (GE-022-004).
    slug: "fixture-rtl",
    blueprintId: "nonprofit-program-operations",
    displayName: "Right-to-left conventions fixture",
    entitlements: [],
    // Overrides ONE axis, and that is the point of it being here.
    //
    // `midtown-arts` runs the same blueprint with no override, so the pair is
    // the falsifiable form of "a blueprint is an editable preset, not a locked
    // tenant type": same blueprint, different compiled module set, with
    // `organization` and `operatingModel` still at the blueprint's default. An
    // implementation that bound a tenant to a frozen list cannot produce this.
    archetype: { functional: ["operations", "knowledge"] },
    // One module, which is the thing an axis cannot say.
    //
    // `feed` belongs to the `community` suite, and selecting that suite would
    // also bring `messaging`. This tenant wants announcements and not direct
    // messages, and the only honest ways to express that are a per-module edit
    // or a fourth blueprint — which is the fork the archetype exists to avoid.
    // So the two mechanisms are both here and both load-bearing: the axis moves
    // this tenant to a different KIND of system, the edit diverges it by one
    // module, and `modulesFor(...).provenance` reports which is which
    // (PACK-020-002).
    moduleEdits: { add: ["feed"], remove: [] },
    values: {
      "platform.localization.locale": "ar-AE",
      "platform.localization.currency": "AED",
      "platform.localization.firstDayOfWeek": 6,
      // Friday and Saturday are the weekend across much of the Gulf. This is
      // not a rotation of Monday-to-Friday, which is why `workingDays` is a
      // list rather than an index.
      "platform.localization.workingDays": [0, 1, 2, 3, 4],
      "platform.localization.holidays": ["2026-12-02", "2026-12-03"],
      "platform.terminology.staffOfficeName": "Programme Office",
      "platform.terminology.staffOfficeShortName": "PO",
    },
  },
  {
    // PACK-020-004. A fixture, like the two above and for the same reason: it
    // exists so that "the engine models coexistence with a customer's external
    // ERP" is a statement a test can FAIL rather than one a comment asserts.
    //
    // Every other binding is implicitly TENURE_CLOUD_PRIMARY — Tenure writes
    // everything — which made every coexistence claim the platform could make
    // true by accident. This one runs the same blueprint as the pilot, holds
    // the same `finance` entitlement, and still does not run `budgeting` or
    // `reimbursements`: the customer's ERP is the authoritative writer for
    // finance, so enabling a Tenure module that posts to a ledger would be the
    // dual write bible §2 prohibits. `modulesFor("fixture-external-erp")`
    // reports both with `system-of-record-external`.
    //
    // Deliberately NOT seeded into any database and not a customer.
    slug: "fixture-external-erp",
    blueprintId: "university-student-organizations",
    displayName: "External-ERP coexistence fixture",
    // Held, and still not enough. The entitlement is what the customer bought;
    // the system of record is who is allowed to write. A module refused on the
    // second would not start working if you sold them the first, which is why
    // the refusal is checked before the entitlement.
    entitlements: ["finance"],
    coexistence: {
      profile: "EXTERNAL_ERP_PRIMARY",
      systemOfRecord: {
        finance: "external",
        // Named rather than omitted. An absent domain is a domain nobody
        // decided, and "we never decided" must not read as "Tenure owns it".
        org: "tenure",
        approvals: "tenure",
        events: "tenure",
        communications: "tenure",
        resources: "tenure",
        memory: "tenure",
        search: "tenure",
        dashboard: "tenure",
        admin: "tenure",
        identity: "tenure",
        config: "tenure",
      },
      // WRK-020-004. The grain below the domain, and the reason this fixture
      // was extended rather than a second one invented: `finance: "external"`
      // says the customer's ERP owns the money. It does not say that Tenure
      // ever RECEIVES a posted entry, and until a direction was recordable the
      // honest reading of this binding was that the two systems never speak.
      //
      // `NONE` on the budget is not an omission either. The customer's ERP
      // holds its own budget and Tenure is not shown it; saying so out loud is
      // what stops somebody reading the blank as "not decided yet".
      objectAuthority: [
        {
          domain: "finance",
          object: "LedgerEntry",
          authority: "external",
          direction: "INBOUND",
          fields: [
            // Written in Tenure by the person who approved the spend, and never
            // sent back — which is exactly why the object needs a channel. A
            // field the other side owns with `direction: "NONE"` is refused.
            { field: "memo", authority: "tenure" },
          ],
        },
        {
          domain: "finance",
          object: "Budget",
          authority: "external",
          direction: "NONE",
        },
      ],
    },
    values: {
      "platform.terminology.staffOfficeName": "Shared Services",
      "platform.terminology.staffOfficeShortName": "SSC",
    },
  },
]

const BY_SLUG = new Map(TENANT_BINDINGS.map((t) => [t.slug, t]))

export function getTenantBinding(slug: string): TenantBinding | undefined {
  return BY_SLUG.get(slug)
}

/**
 * Where one tenant actually sits on every axis: its blueprint's selection, with
 * its own overrides applied.
 *
 * The single place that merge happens. Two call sites doing `binding.archetype
 * ?? blueprint.axes` would disagree the first time one of them forgot that an
 * override is per-axis rather than wholesale — which is exactly the bug that
 * turns an editable preset back into a locked type.
 *
 * Returns `undefined` for an institution with no binding. That is not "the
 * default archetype": an unconfigured institution has no system, and
 * `modulesFor` gives it the front door and nothing else.
 */
export function archetypeFor(slug: string): ArchetypeSelection | undefined {
  const binding = BY_SLUG.get(slug)
  if (!binding) return undefined

  const blueprint = BY_ID.get(binding.blueprintId)
  if (!blueprint) {
    throw new Error(
      `Institution "${slug}" is bound to blueprint "${binding.blueprintId}", which does not exist.`,
    )
  }

  return mergeArchetype(blueprint.axes, binding.archetype)
}

/**
 * The system one tenant's axes compile to.
 *
 * What `modulesFor` resolves, what `layersFor` inserts as the `archetype`
 * configuration layer, and what an adoption writes into a manifest — all from
 * here, so a tenant cannot be described one way by the console and built
 * another way by the engine.
 */
export function compiledArchetypeFor(slug: string): CompiledArchetype | undefined {
  const selection = archetypeFor(slug)
  return selection ? compileArchetype(selection) : undefined
}
