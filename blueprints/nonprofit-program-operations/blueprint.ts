import type { SystemBlueprint } from "../types"

/**
 * A nonprofit's programs.
 *
 * Structurally different from the university blueprint on purpose. Programs are
 * not clubs: they are run by steering committees rather than elected boards,
 * their leaders are appointed coordinators rather than presidents, and the
 * central function is a program office accountable for outcomes rather than a
 * student-engagement office accountable for compliance.
 *
 * It exists to keep the engine honest. An engine configured only ever for one
 * customer is indistinguishable from an engine hardcoded for that customer, and
 * the difference surfaces the first time someone tries a second. This is that
 * second, checked on every test run.
 */
export const nonprofitProgramOperations: SystemBlueprint = {
  id: "nonprofit-program-operations",
  version: "1.0.0",
  name: "Nonprofit program operations",
  description:
    "Programs run by steering committees, coordinated by a central program office within a nonprofit.",
  values: {
    "platform.terminology.staffOfficeName": "Program Office",
    "platform.terminology.staffOfficeShortName": "programs",
    "platform.terminology.organizationSingular": "program",
    "platform.terminology.organizationPlural": "programs",
    "platform.terminology.leadershipBody": "steering committee",
    "platform.terminology.seatSingular": "post",
  },
}
