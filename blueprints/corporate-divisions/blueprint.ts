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
    // organizationSingular/Plural come from the `organization` axis — see the
    // note in the university blueprint.
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
  // `matrix`: this topology declares `matrix-reports-to` as a relation, so the
  // operating model is not an opinion about this blueprint — it is the same
  // fact the topology already states, said on the axis that other subsystems
  // can read. Every suite except `expenses`: a company budgets centrally and
  // pays expenses through payroll, which this platform does not run.
  axes: {
    organization: "corporate-divisions",
    operatingModel: "matrix",
    functional: [
      "community",
      "operations",
      "knowledge",
      "library",
      "assistedSearch",
      "finance",
      "administration",
    ],
  },
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
      {
        // GE-052-002. The geographic rung of the enterprise spine
        // (company → region → business unit → department → team), which the
        // divisional spine (company → division → department → team) does not
        // have. Both converge on `department`, which is what makes this
        // topology a matrix rather than two topologies sharing a file: the
        // `matrix-reports-to` relation below already says a department may
        // serve a body it does not sit under, and a company that runs its P&L
        // by region and its craft by division is the ordinary shape that
        // relation exists for.
        id: "region",
        label: "Region",
        pluralLabel: "Regions",
        description:
          "A geography with its own P&L — EMEA, Americas, APAC. Contains the business units that trade in it.",
      },
      {
        // GE-052-002. A business unit is the smallest body with its own
        // revenue line; a department is a function inside one. Collapsing the
        // two is what makes a corporate import unable to say whether "Payments"
        // is a business a general manager runs or a function a head runs.
        id: "business-unit",
        label: "Business unit",
        pluralLabel: "Business units",
        description:
          "A trading unit with its own revenue line, inside a region. Departments are the functions within it.",
      },
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
      // GE-052-002 — the enterprise spine. company → region → business unit →
      // department → team is four edges, so `team` sits at depth 4 and the
      // existing `maxDepth: 4` is exactly satisfied rather than raised: a
      // deeper chain is still the self-referential import row it was before.
      { parent: "company", child: "region" },
      { parent: "region", child: "business-unit" },
      { parent: "region", child: "location" },
      { parent: "region", child: "project" },
      { parent: "business-unit", child: "department" },
      { parent: "business-unit", child: "location" },
    ],
    relationTypes: [
      {
        id: "matrix-reports-to",
        label: "Matrix reports to",
        description: "A dotted line: a team serving a division it does not sit under.",
        from: ["team", "department"],
        // GE-052-002 — a department inside one region's business unit serving
        // a division that spans every region is the dotted line this relation
        // was written for, and it could not be stated until `business-unit`
        // existed.
        to: ["division", "department", "business-unit"],
      },
      {
        id: "based-at",
        label: "Based at",
        from: ["division", "business-unit", "department", "team"],
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
