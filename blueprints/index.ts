import { universityStudentOrganizations } from "./university-student-organizations/blueprint"
import { nonprofitProgramOperations } from "./nonprofit-program-operations/blueprint"
import { corporateDivisions } from "./corporate-divisions/blueprint"
import type { SystemBlueprint, TenantBinding } from "./types"

export type { SystemBlueprint, TenantBinding }

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
    // Simon OSE — the live pilot, and the system that `satvikOS/Tenure` deploys.
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
]

const BY_SLUG = new Map(TENANT_BINDINGS.map((t) => [t.slug, t]))

export function getTenantBinding(slug: string): TenantBinding | undefined {
  return BY_SLUG.get(slug)
}
