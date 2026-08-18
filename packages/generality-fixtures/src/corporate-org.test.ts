import { getBlueprint, getTenantBinding } from "@tenure/blueprints"
import { OrgGraphError, buildOrgGraph, typeHoldsSeats } from "@tenure/organization-model"

import {
  CORPORATE_BLUEPRINT_ID,
  CORPORATE_EPOCH,
  CORPORATE_SEAT_LADDER,
  CORPORATE_SPINE,
  CORPORATE_UNITS,
  buildCorporateOrg,
  corporateTenantSlugs,
  corporateTopology,
  ladderProblemsAgainst,
  rungByKey,
  rungReaches,
} from "./corporate-org"

const AT = "2026-06-01T00:00:00Z"

/**
 * GE-052-002 — "Implement corporate fixture: Company → Region → Business Unit →
 * Department → Team; Analyst → Manager → Director → Executive."
 */
describe("GE-052-002 — the corporate fixture", () => {
  it("is a bound tenant, not a test constant", () => {
    // `corporate-divisions` shipped with nothing bound to it, so every claim
    // about supporting a company was a claim about a topology object no
    // resolver had ever been asked to serve.
    const slugs = corporateTenantSlugs()
    expect(slugs).toEqual(["fixture-corporate"])

    const binding = getTenantBinding(slugs[0])!
    expect(binding.blueprintId).toBe(CORPORATE_BLUEPRINT_ID)
    // A fixture, and marked as one: the operator console must not offer it as a
    // customer to advance a lifecycle on.
    expect(binding.fixture).toBe(true)
  })

  it("declares the whole spine the requirement names, as a chain", () => {
    const topology = corporateTopology()
    const types = topology.types.map((t) => t.id)
    for (const step of CORPORATE_SPINE) expect(types).toContain(step)

    // The claim is a CHAIN, not five words in a list: each step must be a
    // legal child of the one above it.
    for (let i = 1; i < CORPORATE_SPINE.length; i += 1) {
      const parent = CORPORATE_SPINE[i - 1]
      const child = CORPORATE_SPINE[i]
      expect(
        topology.containment.some((rule) => rule.parent === parent && rule.child === child),
      ).toBe(true)
    }
  })

  it("builds through the shipped graph engine, five levels deep", () => {
    const now = buildCorporateOrg().asOf(AT)

    expect(now.get("northwind")!.depth).toBe(0)
    expect(now.get("emea")!.depth).toBe(1)
    expect(now.get("emea-industrial")!.depth).toBe(2)
    expect(now.get("emea-industrial-procurement")!.depth).toBe(3)
    expect(now.get("emea-industrial-procurement-sourcing")!.depth).toBe(4)

    expect(now.ancestors("emea-industrial-procurement-sourcing").map((u) => u.id)).toEqual([
      "emea-industrial-procurement",
      "emea-industrial",
      "emea",
      "northwind",
    ])
  })

  it("keeps the two regions apart", () => {
    // A single-region fixture cannot tell "walked the spine" from "returned
    // everything", which is what makes the second region load-bearing.
    const now = buildCorporateOrg().asOf(AT)
    const emea = now.descendants("emea").map((u) => u.id)
    expect(emea).toContain("emea-industrial-procurement-sourcing")
    expect(emea).not.toContain("apac-industrial")
    expect(now.isAncestorOf("apac", "emea-industrial")).toBe(false)
  })

  it("refuses a business unit hung straight off the company", () => {
    // The spine is the claim. A business unit that skips its region is the
    // import row that quietly flattens a five-level company into four.
    const topology = corporateTopology()
    expect(() =>
      buildOrgGraph(topology, [
        ...CORPORATE_UNITS,
        {
          id: "orphan-bu",
          typeId: "business-unit",
          name: "Unregioned",
          effectiveFrom: CORPORATE_EPOCH,
          parentage: [{ parentId: "northwind", effectiveFrom: CORPORATE_EPOCH }],
        },
      ]),
    ).toThrow(OrgGraphError)
  })

  it("refuses a team nested one level past the spine", () => {
    const topology = corporateTopology()
    expect(() =>
      buildOrgGraph(topology, [
        ...CORPORATE_UNITS,
        {
          id: "sub-team",
          typeId: "team",
          name: "Sub-team",
          effectiveFrom: CORPORATE_EPOCH,
          parentage: [
            { parentId: "emea-industrial-procurement-sourcing", effectiveFrom: CORPORATE_EPOCH },
          ],
        },
      ]),
    ).toThrow(OrgGraphError)
  })

  it("puts the ladder's four rungs on four ascending levels of the spine", () => {
    expect(CORPORATE_SEAT_LADDER.map((r) => r.key)).toEqual([
      "analyst",
      "manager",
      "director",
      "executive",
    ])
    expect(CORPORATE_SEAT_LADDER.map((r) => r.unitType)).toEqual([
      "team",
      "department",
      "business-unit",
      "company",
    ])
    expect(ladderProblemsAgainst(CORPORATE_SEAT_LADDER, corporateTopology())).toEqual([])
  })

  it("refuses a rung placed where no seat can exist", () => {
    const topology = corporateTopology()
    // `location` holds no seats — authority attached to an address.
    expect(typeHoldsSeats(topology, "location")).toBe(false)
    const problems = ladderProblemsAgainst(
      [
        { key: "analyst", label: "Analyst", rank: 0, unitType: "team" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { key: "site-lead", label: "Site lead", rank: 1, unitType: "location" as any },
      ],
      topology,
    )
    expect(problems.map((p) => p.kind)).toContain("UNIT_TYPE_HOLDS_NO_SEATS")
  })

  it("refuses a ladder whose rungs do not ascend", () => {
    const problems = ladderProblemsAgainst(
      [
        { key: "manager", label: "Manager", rank: 2, unitType: "department" },
        { key: "director", label: "Director", rank: 1, unitType: "business-unit" },
      ],
      corporateTopology(),
    )
    expect(problems.map((p) => p.kind)).toContain("NOT_ASCENDING")
  })

  it("answers an unknown rung with null rather than the bottom rung", () => {
    // "We do not recognise this rung" and "this is the lowest rung" are
    // different answers; the second hands an analyst's authority to a typo.
    expect(rungByKey("analyst")!.rank).toBe(0)
    expect(rungByKey("Analyst")).toBeNull()
    expect(rungByKey("")).toBeNull()
    expect(rungReaches(rungByKey("manger"), 0)).toBe(false)
    expect(rungReaches(rungByKey("director"), 2)).toBe(true)
    expect(rungReaches(rungByKey("manager"), 2)).toBe(false)
  })

  it("is built against the shipped blueprint, not a copy of it", () => {
    const blueprint = getBlueprint(CORPORATE_BLUEPRINT_ID)!
    expect(corporateTopology()).toBe(blueprint.topology)
  })
})
