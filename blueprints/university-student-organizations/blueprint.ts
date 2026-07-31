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
    "platform.terminology.organizationSingular": "club",
    "platform.terminology.organizationPlural": "clubs",
    "platform.terminology.leadershipBody": "executive board",
    "platform.terminology.seatSingular": "seat",
  },
  // Everything the pilot runs today. reimbursements and budgeting need the
  // finance entitlement, which the tenant binding grants.
  modules: [
    "dashboard",
    "organizations",
    "feed",
    "messaging",
    "approvals",
    "events",
    "resources",
    "search",
    "memory",
    "budgeting",
    "reimbursements",
    "administration",
  ],
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
