import type { SystemBlueprint } from "../types"

/**
 * A company with divisions, departments, teams, locations and projects.
 *
 * GE-050-003 names two structures. The education one shipped
 * (`university-student-organizations`); this is the other, and until now the
 * platform had no representation of it at all — which meant the claim that the
 * topology engine supports "arbitrary configured types" rested on two
 * configurations that happen to look alike.
 *
 * The two constraint kinds GE-050-003 added exist because this shape needs them:
 * a company has exactly one head office, and a location is a place rather than a
 * body that employs.
 */
export const corporateDivisions: SystemBlueprint = {
  id: "corporate-divisions",
  version: "1.0.0",
  name: "Corporate divisions",
  description:
    "A company organised into divisions, departments and teams, with locations and cross-cutting projects.",
  values: {
    "platform.terminology.staffOfficeName": "People Operations",
    "platform.terminology.staffOfficeShortName": "People Ops",
    "platform.terminology.organizationSingular": "department",
    "platform.terminology.organizationPlural": "departments",
    "platform.terminology.leadershipBody": "leadership team",
    "platform.terminology.seatSingular": "role",
    "platform.localization.locale": "en-US",
    "platform.localization.currency": "USD",
    "platform.localization.firstDayOfWeek": 1,
    // A calendar fiscal year, which is the common corporate default and
    // deliberately different from the university blueprint's July opening —
    // a blueprint that copied the other's calendar would prove nothing.
    "platform.localization.fiscalYearStartMonth": 1,
  },
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
    "administration",
  ],
  topology: {
    id: "corporate-divisions",
    version: "1.0.0",
    rootType: "company",
    // company → division → department → team is four levels; a project or
    // location sits under the company or a division, so nothing legal exceeds
    // this. An import with a self-referential row would, which is the point.
    maxDepth: 4,
    types: [
      { id: "company", label: "Company", pluralLabel: "Companies" },
      { id: "division", label: "Division", pluralLabel: "Divisions" },
      { id: "department", label: "Department", pluralLabel: "Departments" },
      { id: "team", label: "Team", pluralLabel: "Teams" },
      {
        id: "location",
        label: "Location",
        pluralLabel: "Locations",
        description:
          "An office, site or warehouse. A place people work at, not a body that employs them.",
        // A seat here would be authority attached to an address, which nobody
        // can succeed to.
        holdsSeats: false,
      },
      {
        id: "project",
        label: "Project",
        pluralLabel: "Projects",
        description:
          "A cross-cutting effort with a start and an end. People are seconded to it from the seats they already hold.",
        // Modelling a secondment as a second seat gives one person two
        // positions where they have one. A tenant that genuinely staffs
        // projects as posts can set this true in its own topology.
        holdsSeats: false,
      },
    ],
    containment: [
      // Exactly one head office. Two is a data error somebody would otherwise
      // discover from a report that double-counts headcount by site.
      { parent: "company", child: "location", minChildren: 1, maxChildren: 1 },
      { parent: "company", child: "division" },
      { parent: "company", child: "project" },
      { parent: "division", child: "department" },
      { parent: "division", child: "location" },
      { parent: "division", child: "project" },
      { parent: "department", child: "team" },
    ],
    relationTypes: [
      {
        id: "matrix-reports-to",
        label: "Matrix reports to",
        description: "A dotted line: a team serving a division it does not sit under.",
        from: ["team", "department"],
        to: ["division", "department"],
      },
      {
        id: "based-at",
        label: "Based at",
        from: ["division", "department", "team"],
        to: ["location"],
      },
      {
        id: "collaborates-with",
        label: "Collaborates with",
        from: ["team", "department"],
        to: ["team", "department"],
        symmetric: true,
      },
    ],
  },
}
