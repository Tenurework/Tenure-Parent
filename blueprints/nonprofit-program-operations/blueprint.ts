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
    // A UK-registered charity: sterling, ISO weeks starting Monday, and an
    // April fiscal year. None of this is a translation of the university's
    // settings — it is a different organisation with different obligations.
    "platform.localization.locale": "en-GB",
    "platform.localization.currency": "GBP",
    "platform.localization.firstDayOfWeek": 1,
    "platform.localization.fiscalYearStartMonth": 4,
  },
  // A different system, not the same system renamed: no community feed, no
  // student-facing messaging, no reimbursements. Programs are coordinated, not
  // socialised.
  modules: ["dashboard", "organizations", "approvals", "events", "memory", "budgeting"],
  topology: {
    id: "nonprofit-program-operations",
    version: "1.0.0",
    rootType: "nonprofit",
    maxDepth: 4,
    types: [
      { id: "nonprofit", label: "Nonprofit", pluralLabel: "Nonprofits" },
      {
        id: "portfolio",
        label: "Portfolio",
        pluralLabel: "Portfolios",
        description: "A funded area of work holding several programs. No equivalent in the university shape.",
      },
      { id: "program", label: "Program", pluralLabel: "Programs" },
      { id: "committee", label: "Steering committee", pluralLabel: "Steering committees" },
      {
        id: "site",
        label: "Delivery site",
        pluralLabel: "Delivery sites",
        description: "Where a program is actually delivered. Programs run at several sites at once.",
      },
    ],
    containment: [
      { parent: "nonprofit", child: "portfolio" },
      { parent: "portfolio", child: "program" },
      { parent: "program", child: "committee" },
      { parent: "program", child: "site" },
    ],
    relationTypes: [
      // A funder relationship has no analogue in the university topology, which
      // is the point: these are not the same organization with different words.
      { id: "funds", label: "Funds", from: ["nonprofit"], to: ["portfolio", "program"] },
      { id: "delivers-jointly-with", label: "Delivers jointly with", from: ["site"], to: ["site"], symmetric: true },
    ],
  },
}
