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
}
