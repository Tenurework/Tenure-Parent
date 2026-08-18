import { TENANT_BINDINGS, getBlueprint } from "@tenure/blueprints"
import {
  buildOrgGraph,
  typeHoldsSeats,
  type OrgGraph,
  type OrgTopology,
  type OrgUnitInput,
} from "@tenure/organization-model"

/**
 * GE-052-002 — the corporate fixture, as data the shipped engine can build.
 *
 * "Company → Region → Business Unit → Department → Team; Analyst → Manager →
 * Director → Executive" is two claims, and they fail in different ways.
 *
 * The first is structural: a spine five levels deep, with a geographic rung
 * (`region`) and a trading rung (`business-unit`) that the education blueprint
 * has no analogue for. Its falsifiable form is that `buildOrgGraph` — the same
 * function the pilot's hierarchy goes through, not a corporate copy of it —
 * accepts these units against the SHIPPED `corporate-divisions` topology and
 * refuses ones that break its rules.
 *
 * The second is an authority ladder. A rank is not decoration: it is what makes
 * "a manager may approve this and an analyst may not" a comparison rather than
 * a string match on a job title, and it is what the purchase chain in
 * `corporate-purchase.ts` resolves its gates from.
 *
 * Nothing here is a customer. `fixture-corporate` is bound in
 * `blueprints/index.ts` with `fixture: true` and is deliberately not seeded
 * into any database.
 */

/**
 * The blueprint this fixture is a tenant of.
 *
 * A blueprint id, deliberately, and never a tenant slug. A shipped module that
 * spells out a customer's slug is the first shape a tenant fork takes, and
 * `tests/architecture/no-tenant-fork-or-branch.test.mjs` refuses one — rightly,
 * and it refused an earlier draft of this file. Which SLUG runs this system is
 * the bindings' business; what the system IS belongs here.
 */
export const CORPORATE_BLUEPRINT_ID = "corporate-divisions"

/**
 * Every institution bound to the corporate blueprint, by slug.
 *
 * Derived from the bindings rather than named, for the reason above. Empty
 * means nobody runs this system — which is what `corporate-divisions` was
 * before GE-052-002, and is a different answer from "we could not tell".
 */
export function corporateTenantSlugs(): readonly string[] {
  return TENANT_BINDINGS.filter((b) => b.blueprintId === CORPORATE_BLUEPRINT_ID).map((b) => b.slug)
}

/**
 * The shipped topology this fixture is built against.
 *
 * Read from the blueprint rather than restated. A fixture carrying its own copy
 * of the topology proves that the fixture is internally consistent and nothing
 * about the configuration the platform would actually provision.
 */
export function corporateTopology(): OrgTopology {
  const blueprint = getBlueprint(CORPORATE_BLUEPRINT_ID)
  if (!blueprint) {
    throw new Error(
      `The corporate fixture is built on blueprint "${CORPORATE_BLUEPRINT_ID}", which does not exist.`,
    )
  }
  return blueprint.topology
}

/**
 * The spine GE-052-002 names, top to bottom.
 *
 * Exported so a test can assert the CHAIN rather than the presence of five
 * type ids in any order — "the topology declares a region" and "a region sits
 * between the company and its business units" are different claims, and only
 * the second is what the requirement says.
 */
export const CORPORATE_SPINE = [
  "company",
  "region",
  "business-unit",
  "department",
  "team",
] as const

export type CorporateSpineType = (typeof CORPORATE_SPINE)[number]

/** Everything in the fixture is dated from here; nothing in it has ended. */
export const CORPORATE_EPOCH = "2026-01-01"

const unit = (
  id: string,
  typeId: string,
  name: string,
  parentId?: string,
): OrgUnitInput => ({
  id,
  typeId,
  name,
  effectiveFrom: CORPORATE_EPOCH,
  ...(parentId ? { parentage: [{ parentId, effectiveFrom: CORPORATE_EPOCH }] } : {}),
})

/**
 * Northwind Industrial: one company, two regions, and a full spine down one of
 * them.
 *
 * Two regions rather than one on purpose. A single-region company cannot tell
 * apart "the engine walked the spine" from "the engine returned everything it
 * had", so `descendants(emea)` returning the APAC business unit would pass a
 * one-region fixture and fails this one.
 *
 * The head-office `location` is not decoration either: `corporate-divisions`
 * declares `company → location` with `minChildren: 1, maxChildren: 1`, so a
 * fixture without it does not build at all — which is the cardinality
 * constraint doing its job on the first configuration that has to satisfy it.
 */
export const CORPORATE_UNITS: readonly OrgUnitInput[] = [
  unit("northwind", "company", "Northwind Industrial"),
  unit("northwind-hq", "location", "Chicago head office", "northwind"),

  unit("emea", "region", "EMEA", "northwind"),
  unit("emea-industrial", "business-unit", "EMEA Industrial Systems", "emea"),
  unit("emea-industrial-procurement", "department", "Sourcing", "emea-industrial"),
  unit("emea-industrial-procurement-sourcing", "team", "Strategic sourcing", "emea-industrial-procurement"),
  unit("emea-industrial-finance", "department", "Finance", "emea-industrial"),
  unit("emea-industrial-finance-controls", "team", "Financial controls", "emea-industrial-finance"),

  unit("apac", "region", "APAC", "northwind"),
  unit("apac-industrial", "business-unit", "APAC Industrial Systems", "apac"),
  unit("apac-industrial-procurement", "department", "Sourcing", "apac-industrial"),
]

/**
 * Build the fixture's hierarchy through the shipped graph engine.
 *
 * Throws `OrgGraphError` if the fixture ever stops satisfying the shipped
 * topology — which is the point of building it rather than declaring it.
 */
export function buildCorporateOrg(): OrgGraph {
  return buildOrgGraph(corporateTopology(), CORPORATE_UNITS)
}

/* ─────────────────────────────────────────────────────── the seat ladder ── */

/**
 * One rung of the corporate authority ladder.
 *
 * `rank` is the load-bearing field. Job titles are strings and strings do not
 * compare — the whole reason `looksLikeARoleTitle` exists in the permission
 * catalog is that authority encoded as a title is authority nobody can order.
 * A rank makes "at least a director" a comparison the purchase chain can make
 * without knowing what this tenant calls a director.
 *
 * `unitType` is where the rung sits on the spine, and it is checked against the
 * topology: a rung placed in a unit type that holds no seats is authority
 * attached to an address.
 */
export interface CorporateRung {
  key: string
  label: string
  /** 0 is the bottom. Strictly ascending across the ladder. */
  rank: number
  /** The spine type a holder of this rung occupies a seat in. */
  unitType: CorporateSpineType
}

/**
 * GE-052-002's ladder: Analyst → Manager → Director → Executive.
 *
 * Each rung sits one level up the spine from the one below it, which is what
 * makes the ladder a property of the ORGANISATION rather than a list of four
 * words: an analyst is in a team, their manager runs the department that team
 * is in, the director runs the business unit, and the executive sits at the
 * company. `ladderIsWellFormed` checks exactly that against the topology, so a
 * later edit that renames a rung into a unit type nothing can hold a seat in
 * fails rather than silently conferring nothing.
 */
export const CORPORATE_SEAT_LADDER: readonly CorporateRung[] = [
  { key: "analyst", label: "Analyst", rank: 0, unitType: "team" },
  { key: "manager", label: "Manager", rank: 1, unitType: "department" },
  { key: "director", label: "Director", rank: 2, unitType: "business-unit" },
  { key: "executive", label: "Executive", rank: 3, unitType: "company" },
]

export type LadderProblemKind =
  | "EMPTY"
  | "DUPLICATE_KEY"
  | "NOT_ASCENDING"
  | "UNKNOWN_UNIT_TYPE"
  | "UNIT_TYPE_HOLDS_NO_SEATS"
  | "NOT_A_SPINE_STEP"

export interface CorporateLadderProblem {
  kind: LadderProblemKind
  detail: string
}

/**
 * Everything wrong with a ladder, against a topology.
 *
 * Returns problems rather than throwing so a caller can report all of them at
 * once; `buildCorporateOrg` is the thing that throws, because a hierarchy that
 * does not satisfy its topology cannot be partially used.
 */
export function ladderProblemsAgainst(
  ladder: readonly CorporateRung[],
  topology: OrgTopology,
): readonly CorporateLadderProblem[] {
  const problems: CorporateLadderProblem[] = []
  if (ladder.length === 0) return [{ kind: "EMPTY", detail: "A ladder with no rungs orders nothing." }]

  const keys = new Set<string>()
  for (const rung of ladder) {
    if (keys.has(rung.key)) {
      problems.push({ kind: "DUPLICATE_KEY", detail: `Two rungs are called "${rung.key}".` })
    }
    keys.add(rung.key)

    const declared = topology.types.some((t) => t.id === rung.unitType)
    if (!declared) {
      problems.push({
        kind: "UNKNOWN_UNIT_TYPE",
        detail: `Rung "${rung.key}" sits in "${rung.unitType}", which this topology does not declare.`,
      })
      continue
    }
    if (!typeHoldsSeats(topology, rung.unitType)) {
      problems.push({
        kind: "UNIT_TYPE_HOLDS_NO_SEATS",
        detail:
          `Rung "${rung.key}" sits in "${rung.unitType}", which holds no seats. ` +
          `Authority attached to a type nobody can occupy is authority nobody can succeed to.`,
      })
    }
  }

  for (let i = 1; i < ladder.length; i += 1) {
    if (ladder[i].rank <= ladder[i - 1].rank) {
      problems.push({
        kind: "NOT_ASCENDING",
        detail: `"${ladder[i].key}" ranks ${ladder[i].rank}, at or below "${ladder[i - 1].key}".`,
      })
    }
    // Each rung must sit strictly higher up the spine than the one below it.
    const below = CORPORATE_SPINE.indexOf(ladder[i - 1].unitType)
    const here = CORPORATE_SPINE.indexOf(ladder[i].unitType)
    if (below === -1 || here === -1 || here >= below) {
      problems.push({
        kind: "NOT_A_SPINE_STEP",
        detail:
          `"${ladder[i].key}" sits in "${ladder[i].unitType}", which is not above ` +
          `"${ladder[i - 1].unitType}" on the spine.`,
      })
    }
  }

  return problems
}

const BY_KEY = new Map(CORPORATE_SEAT_LADDER.map((r) => [r.key, r]))

/**
 * The rung with this key, or `null`.
 *
 * `null` rather than a default rung, and the distinction is the one this
 * codebase keeps losing: "this person holds no rung we know" and "this person
 * holds the bottom rung" are different answers, and collapsing them hands the
 * analyst's authority to somebody whose title was misspelt.
 */
export function rungByKey(key: string): CorporateRung | null {
  return BY_KEY.get(key) ?? null
}

/** Does this rung reach at least `minimumRank`? `null` never does. */
export function rungReaches(rung: CorporateRung | null, minimumRank: number): boolean {
  return rung !== null && rung.rank >= minimumRank
}
