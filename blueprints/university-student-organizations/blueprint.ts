import type { SystemBlueprint } from "../types"

/**
 * A university's student organizations.
 *
 * Clubs run by student executive boards, overseen by a staff office. This is the
 * shape the pilot is in, generalised: nothing here says Rochester, Simon or
 * Ainslie. Those are one tenant's overlay (`blueprints/tenants.ts`), which is
 * the whole distinction between a blueprint and a customer.
 */
export const universityStudentOrganizations: SystemBlueprint = {
  id: "university-student-organizations",
  version: "1.0.0",
  name: "University student organizations",
  description:
    "Student clubs and their executive boards, overseen by a central staff office within a university.",
  values: {
    "platform.terminology.staffOfficeName": "Office of Student Engagement",
    "platform.terminology.staffOfficeShortName": "the office",
    // organizationSingular/Plural are NOT here: they are compiled from the
    // `organization` axis, which sits above `blueprint` in the scope order, so
    // a value set here would be overridden without saying so.
    "platform.terminology.leadershipBody": "executive board",
    "platform.terminology.seatSingular": "seat",
    // A US university on an academic year: July opening, weeks starting Sunday.
    "platform.localization.locale": "en-US",
    "platform.localization.currency": "USD",
    "platform.localization.firstDayOfWeek": 0,
    "platform.localization.fiscalYearStartMonth": 7,
  },
  // Everything the pilot runs today, compiled rather than listed. The `finance`
  // and `expenses` suites both need the finance entitlement, which the tenant
  // binding grants; `compileArchetype(...).entitlements` is what says so.
  //
  // `centralized`: a single staff office sets policy, holds the budget and
  // decides every approval for every club. That is what makes budgeting's
  // portfolio roll-up meaningful here.
  axes: {
    organization: "university-student-organizations",
    operatingModel: "centralized",
    functional: [
      "community",
      "operations",
      "knowledge",
      "library",
      "assistedSearch",
      "finance",
      "expenses",
      "administration",
    ],
  },
  topology: {
    id: "university-student-organizations",
    version: "1.0.0",
    rootType: "institution",
    maxDepth: 3,
    types: [
      { id: "institution", label: "Institution", pluralLabel: "Institutions" },
      {
        id: "school",
        label: "School",
        pluralLabel: "Schools",
        description:
          "A school or college within the institution. Optional: the pilot has no school layer yet, which is why a club may sit directly under an institution.",
      },
      { id: "club", label: "Club", pluralLabel: "Clubs" },
      { id: "board", label: "Executive board", pluralLabel: "Executive boards" },
    ],
    containment: [
      { parent: "institution", child: "school" },
      // Both are allowed on purpose. The live data is flat — Institution holds
      // Organizations directly — and a school layer is what Simon would gain
      // when a second school onboards. Allowing both means introducing that
      // layer is a data change, not a topology migration.
      { parent: "institution", child: "club" },
      { parent: "school", child: "club" },
      { parent: "club", child: "board" },
    ],
    relationTypes: [
      { id: "advises", label: "Advises", from: ["institution", "school"], to: ["club"] },
      {
        id: "partners-with",
        label: "Partners with",
        from: ["club"],
        to: ["club"],
        symmetric: true,
      },
    ],
  },
}
