import { TENANT_BINDINGS, archetypeFor, compiledArchetypeFor, getBlueprint, getTenantBinding } from "@tenure/blueprints"
import {
  CORPORATE_PURCHASE_WORKFLOW,
  CORPORATE_UNITS,
  buildCorporateOrg,
  corporateTopology,
} from "@tenure/generality-fixtures"
import {
  ROLE_TEMPLATES,
  decide,
  lookupRoleTemplate,
  type AuthorizationWorld,
  type Membership,
  type Principal,
  type RoleGrant,
} from "@tenure/authorization";
import {
  buildOrgGraph,
  validateTopology,
  type OrgUnitInput,
} from "@tenure/organization-model";
import { layersFor, modulesFor, resolveSystemConfig, tiersFor } from "@tenure/platform-config";
import { applyAction, availableActions, validateDefinition } from "@tenure/workflow";

import { APPROVAL_WORKFLOW } from "@/lib/workflows/approval-definition";

/**
 * GE-052-004 — "Prove both fixtures use identical schemas, services,
 * authorization, workflows, and deployment paths."
 *
 * The proof this suite can honestly give is a NEGATIVE one, and it is the only
 * kind worth having: for each of the five axes, one exported function is called
 * with each fixture in turn, and both answers are real, tenant-specific and
 * different. A platform that had forked for either of them could not produce
 * that — it would either need a second function, or return the same answer
 * twice.
 *
 * The two fixtures are deliberately as unalike as the platform can currently
 * express: a four-level education hierarchy with a two-gate approval whose
 * escalation is one published ceiling, against a five-level corporate spine
 * with a three-gate purchase chain whose escalation is a priced ladder.
 *
 * This file lives in `apps/web` for one reason: the pilot's approval definition
 * does. `@tenure/generality-fixtures` cannot import it, so the only place the
 * two flows can be driven through one engine in one file is here.
 */

const EDUCATION = "rochester";
const CORPORATE = "fixture-corporate";
const FIXTURES = [EDUCATION, CORPORATE] as const;
const AT = "2026-06-01T00:00:00Z";

/** The education hierarchy, in the same input shape the corporate one uses. */
const EDUCATION_UNITS: readonly OrgUnitInput[] = [
  { id: "rochester", typeId: "institution", name: "University", effectiveFrom: "2026-01-01" },
  {
    id: "simon",
    typeId: "school",
    name: "Business school",
    effectiveFrom: "2026-01-01",
    parentage: [{ parentId: "rochester", effectiveFrom: "2026-01-01" }],
  },
  {
    id: "consulting-club",
    typeId: "club",
    name: "Consulting club",
    effectiveFrom: "2026-01-01",
    parentage: [{ parentId: "simon", effectiveFrom: "2026-01-01" }],
  },
];

const UNITS: Readonly<Record<string, readonly OrgUnitInput[]>> = {
  [EDUCATION]: EDUCATION_UNITS,
  [CORPORATE]: CORPORATE_UNITS,
};

/** The unit a `unit.lead` grant is scoped to, per fixture. */
const LEAD_UNIT: Readonly<Record<string, string>> = {
  [EDUCATION]: "consulting-club",
  [CORPORATE]: "emea-industrial-procurement",
};

describe("GE-052-004 — one engine, two organization systems", () => {
  it("has two fixtures on structurally different blueprints", () => {
    // Everything below is parameterised over these two, so a suite that
    // silently ran the same tenant twice would prove nothing.
    const bound = FIXTURES.map((slug) => getTenantBinding(slug));
    expect(bound.every(Boolean)).toBe(true);

    const [education, corporate] = bound.map((b) => getBlueprint(b!.blueprintId)!);
    expect(education.id).not.toBe(corporate.id);
    expect(education.topology.rootType).not.toBe(corporate.topology.rootType);
    expect(corporate.topology.types.length).toBeGreaterThan(education.topology.types.length);
  });

  describe("schemas", () => {
    it.each(FIXTURES)("%s validates through the one topology validator", (slug) => {
      const blueprint = getBlueprint(getTenantBinding(slug)!.blueprintId)!;
      expect(() => validateTopology(blueprint.topology)).not.toThrow();
    });

    it.each(FIXTURES)("%s builds through the one graph engine", (slug) => {
      const blueprint = getBlueprint(getTenantBinding(slug)!.blueprintId)!;
      const graph = buildOrgGraph(blueprint.topology, UNITS[slug]);
      const now = graph.asOf(AT);
      expect(now.roots()).toHaveLength(1);
      expect(now.all().length).toBe(UNITS[slug].length);
    });

    it("gives the two hierarchies genuinely different depths", () => {
      const deepest = (slug: string) =>
        Math.max(
          ...buildOrgGraph(
            getBlueprint(getTenantBinding(slug)!.blueprintId)!.topology,
            UNITS[slug],
          )
            .asOf(AT)
            .all()
            .map((u) => u.depth),
        );
      expect(deepest(EDUCATION)).toBe(2);
      expect(deepest(CORPORATE)).toBe(4);
    });

    it("builds the corporate hierarchy the same way the fixture package does", () => {
      // The fixture's own entry point and this suite's must not be two
      // different builds of the same organisation.
      expect(buildCorporateOrg().asOf(AT).all().length).toBe(
        buildOrgGraph(corporateTopology(), CORPORATE_UNITS).asOf(AT).all().length,
      );
    });
  });

  describe("services", () => {
    it.each(FIXTURES)("%s resolves configuration through the one registry", (slug) => {
      const resolved = resolveSystemConfig(slug);
      expect(typeof resolved.get<string>("platform.terminology.staffOfficeName")).toBe("string");
      expect(typeof resolved.get<string>("platform.localization.currency")).toBe("string");
    });

    it("resolves DIFFERENT words for the two, from the same call", () => {
      const word = (slug: string) =>
        resolveSystemConfig(slug).get<string>("platform.terminology.staffOfficeName");
      expect(word(EDUCATION)).not.toBe(word(CORPORATE));
    });

    it("stacks the same configuration layers, in the same order, for both", () => {
      // The deployment path. A tenant resolved through a different layer stack
      // is a tenant on a different platform, whatever the values say.
      const scopes = (slug: string) => layersFor(slug).map((l) => l.scope);
      expect(scopes(EDUCATION)).toEqual(scopes(CORPORATE));
      expect(scopes(CORPORATE).length).toBeGreaterThanOrEqual(2);
    });

    it.each(FIXTURES)("%s resolves modules through the one resolver", (slug) => {
      const modules = modulesFor(slug, AT);
      expect(modules.keys.length).toBeGreaterThan(0);
      expect(modules.provenance).toHaveLength(modules.keys.length);
      // Both hold `finance`, so budgeting is not refused for either — the pair
      // differs by SHAPE, not by what was bought.
      expect(modules.keys).toContain("budgeting");
    });

    it("compiles a different archetype for each, through the same compiler", () => {
      const education = compiledArchetypeFor(EDUCATION)!;
      const corporate = compiledArchetypeFor(CORPORATE)!;
      expect(archetypeFor(EDUCATION)!.organization).not.toBe(
        archetypeFor(CORPORATE)!.organization,
      );
      expect(education.modules).not.toEqual(corporate.modules);
    });
  });

  describe("authorization", () => {
    const worldFor = (slug: string): AuthorizationWorld => {
      const principals: Principal[] = [{ id: "lead", kind: "user" }];
      const memberships: Membership[] = [
        { principalId: "lead", tenantId: slug, state: "ACTIVE", effectiveFrom: "2026-01-01" },
      ];
      const grants: RoleGrant[] = [
        {
          principalId: "lead",
          tenantId: slug,
          roleKey: "unit.lead",
          scope: { kind: "orgUnit", orgUnitId: LEAD_UNIT[slug] },
          state: "CONFIRMED",
          effectiveFrom: "2026-01-01",
        },
      ];
      const graph = buildOrgGraph(
        getBlueprint(getTenantBinding(slug)!.blueprintId)!.topology,
        UNITS[slug],
      ).asOf(AT);
      const tiers = tiersFor(slug);

      return {
        principals,
        memberships,
        // The SHIPPED templates, for both. A tenant with its own role set is a
        // tenant whose "what can a lead do?" has a different answer.
        roles: ROLE_TEMPLATES,
        grants,
        enabledModules: modulesFor(slug, AT).keys,
        entitlements: [{ tenantId: slug, tiers: tiers.tiers, currentTier: tiers.currentTier }],
        ancestorsOf: (id) => graph.ancestors(id).map((u) => u.id),
      };
    };

    it("carries the same permission in both templates", () => {
      expect(lookupRoleTemplate("unit.lead")!.permissions).toContain("approvals.request.decide");
    });

    it.each(FIXTURES)("%s allows its own lead to decide in its own unit", (slug) => {
      const decision = decide(worldFor(slug), {
        principalId: "lead",
        tenantId: slug,
        permission: "approvals.request.decide",
        resource: { type: "ApprovalRequest", id: "r1", orgUnitId: LEAD_UNIT[slug] },
        at: AT,
      });
      expect(decision.allowed).toBe(true);
    });

    it.each(FIXTURES)("%s denies the same lead outside their scope", (slug) => {
      const other = slug === EDUCATION ? CORPORATE : EDUCATION;
      const decision = decide(worldFor(slug), {
        principalId: "lead",
        tenantId: slug,
        permission: "approvals.request.decide",
        resource: { type: "ApprovalRequest", id: "r1", orgUnitId: LEAD_UNIT[other] },
        at: AT,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("OUT_OF_SCOPE");
    });

    it.each(FIXTURES)("%s denies a principal whose membership is in the other tenant", (slug) => {
      const other = slug === EDUCATION ? CORPORATE : EDUCATION;
      const decision = decide(worldFor(slug), {
        principalId: "lead",
        tenantId: other,
        permission: "approvals.request.decide",
        resource: { type: "ApprovalRequest", id: "r1", orgUnitId: LEAD_UNIT[other] },
        at: AT,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("NO_MEMBERSHIP");
    });
  });

  describe("workflows", () => {
    const FLOWS = [
      ["education", APPROVAL_WORKFLOW],
      ["corporate", CORPORATE_PURCHASE_WORKFLOW],
    ] as const;

    it.each(FLOWS)("%s validates through the one validator", (_name, def) => {
      expect(() => validateDefinition(def)).not.toThrow();
    });

    it("runs two structurally different flows", () => {
      const states = (def: (typeof FLOWS)[number][1]) => def.states.map((s) => s.key).sort();
      expect(states(APPROVAL_WORKFLOW)).not.toEqual(states(CORPORATE_PURCHASE_WORKFLOW));
      expect(APPROVAL_WORKFLOW.key).not.toBe(CORPORATE_PURCHASE_WORKFLOW.key);
      // Two gates against three: the corporate chain has a state the pilot's
      // has no analogue for.
      expect(CORPORATE_PURCHASE_WORKFLOW.states.map((s) => s.key)).toContain(
        "PENDING_PROCUREMENT",
      );
      expect(APPROVAL_WORKFLOW.states.map((s) => s.key)).not.toContain("PENDING_PROCUREMENT");
    });

    it("routes each one's escalation through the same applyAction", () => {
      // The pilot: an over-threshold request needs the staff-office DIRECTOR.
      const pilotOrdinary = applyAction(
        APPROVAL_WORKFLOW,
        { state: "PENDING_OSE", roles: ["oseGate"], conditions: { exceedsThreshold: false } },
        "approve",
      );
      expect(pilotOrdinary).toMatchObject({ ok: true, to: "APPROVED" });

      const pilotLarge = applyAction(
        APPROVAL_WORKFLOW,
        { state: "PENDING_OSE", roles: ["oseGate"], conditions: { exceedsThreshold: true } },
        "approve",
      );
      expect(pilotLarge).toMatchObject({ ok: false, reason: "actor-not-permitted" });

      // The corporate chain: the same engine, the same refusal vocabulary, a
      // different escalation.
      const corporateOrdinary = applyAction(
        CORPORATE_PURCHASE_WORKFLOW,
        {
          state: "PENDING_DEPARTMENT",
          roles: ["departmentGate"],
          conditions: { withinDepartmentLimit: true, requiresProcurement: false },
        },
        "approve",
      );
      expect(corporateOrdinary).toMatchObject({ ok: true, to: "APPROVED" });

      const corporateLarge = applyAction(
        CORPORATE_PURCHASE_WORKFLOW,
        {
          state: "PENDING_FINANCE",
          roles: ["departmentGate"],
          conditions: { withinDepartmentLimit: false, requiresProcurement: true },
        },
        "approve",
      );
      expect(corporateLarge).toMatchObject({ ok: false, reason: "actor-not-permitted" });
    });

    it("offers actions for both through the same availableActions", () => {
      expect(
        availableActions(APPROVAL_WORKFLOW, {
          state: "DRAFT",
          roles: ["requester"],
          conditions: { requesterIsPresident: false },
        }).map((a) => a.action),
      ).toEqual(["submit", "cancel"]);

      expect(
        availableActions(CORPORATE_PURCHASE_WORKFLOW, {
          state: "DRAFT",
          roles: ["requester"],
          conditions: { withinDepartmentLimit: true, requiresProcurement: false },
        }).map((a) => a.action),
      ).toEqual(["submit", "cancel"]);
    });
  });

  describe("deployment paths", () => {
    it("registers both fixtures in the one binding list", () => {
      const slugs = TENANT_BINDINGS.map((b) => b.slug);
      for (const slug of FIXTURES) expect(slugs).toContain(slug);
    });

    it("keeps the corporate fixture off operator-facing customer surfaces", () => {
      // The pilot is a customer; the corporate fixture is not, and the console
      // that advances lifecycles must be able to tell them apart.
      expect(getTenantBinding(EDUCATION)!.fixture).toBeUndefined();
      expect(getTenantBinding(CORPORATE)!.fixture).toBe(true);
    });
  });
});
