/**
 * STUDIO-010-003 — the hierarchy, the inheritance, the lifecycle, and the four
 * ways a live read can fail without any of them becoming a finding.
 *
 * Every assertion drives the production functions. The reconciliation is fed
 * through `organizationTree` — the real reader, with a stand-in `AwsGateway` at
 * the same seam `topology.test.ts` and `aws-unknown-is-not-absent.spec.ts` use —
 * rather than by hand-building an `AwsRead`, so a reader that stopped walking
 * the tree reds here instead of staying green against a fixture.
 */

import {
  ACCOUNT_MOVES,
  ORGANIZATIONAL_UNITS,
  ROOT_GUARDRAILS,
  TERMINAL_UNIT,
  ancestry,
  canMoveAccount,
  deniedActionCount,
  guardrailDefects,
  inheritedGuardrails,
  organizationTree,
  organizationalUnit,
  reconcileOrganizationalUnits,
  unitSummary,
  type Guardrail,
  type ObservedOrganizationTree,
  type OrganizationalUnit,
  type OrganizationalUnitKey,
} from "./organization-units"
import type { AwsGateway, AwsRead } from "./read"

/* ------------------------------------------------------------ the gateway -- */

interface Fixture {
  rootId: string
  ous: Array<{ id: string; name: string; parentId: string }>
  policies?: Record<string, string[]>
  /** Capabilities that should throw AccessDenied instead of answering. */
  denied?: Set<string>
}

class AccessDenied extends Error {
  constructor() {
    super("not authorized")
    this.name = "AccessDeniedException"
  }
}

function gatewayFor(fixture: Fixture): AwsGateway {
  const denied = fixture.denied ?? new Set<string>()
  return {
    async call(capability, input = {}) {
      if (denied.has(capability)) throw new AccessDenied()
      switch (capability) {
        case "organizations:ListRoots":
          return { Roots: [{ Id: fixture.rootId }] }
        case "organizations:ListOrganizationalUnitsForParent":
          return {
            OrganizationalUnits: fixture.ous
              .filter((o) => o.parentId === input.ParentId)
              .map((o) => ({ Id: o.id, Name: o.name })),
          }
        case "organizations:ListPoliciesForTarget":
          return {
            Policies: (fixture.policies?.[String(input.TargetId)] ?? []).map((name) => ({ name, Name: name })),
          }
        default:
          throw new Error(`the fixture was asked for ${capability}`)
      }
    },
    async resolvedRegion() {
      return "us-east-1"
    },
  }
}

/** The estate exactly as declared: every unit, under the right parent. */
const COMPLIANT: Fixture = {
  rootId: "r-root",
  ous: [
    { id: "ou-sec", name: "Security", parentId: "r-root" },
    { id: "ou-inf", name: "Infrastructure", parentId: "r-root" },
    { id: "ou-wl", name: "Workloads", parentId: "r-root" },
    { id: "ou-sb", name: "Sandbox", parentId: "r-root" },
    { id: "ou-sus", name: "Suspended", parentId: "r-root" },
    { id: "ou-qua", name: "Quarantine", parentId: "ou-sus" },
    { id: "ou-clo", name: "Closure", parentId: "ou-sus" },
  ],
  policies: {
    "ou-sec": ["TenureRootBaseline", "TenureSecurityArchive"],
    "ou-qua": ["TenureQuarantineFreeze"],
  },
}

const NOW = () => new Date("2026-08-17T00:00:00.000Z")

async function read(fixture: Fixture): Promise<AwsRead<ObservedOrganizationTree>> {
  return organizationTree(gatewayFor(fixture), { now: NOW })
}

/* ------------------------------------------------------ the declaration -- */

describe("the declared hierarchy", () => {
  it("declares exactly the seven units the requirement names", () => {
    expect(ORGANIZATIONAL_UNITS.map((u) => u.key).sort()).toEqual([
      "closure",
      "infrastructure",
      "quarantine",
      "sandbox",
      "security",
      "suspended",
      "workloads",
    ])
  })

  it("has no defect in it", () => {
    expect(guardrailDefects()).toEqual([])
  })

  it("names a purpose that says something on every unit", () => {
    for (const unit of ORGANIZATIONAL_UNITS) {
      expect(unit.purpose.length).toBeGreaterThan(60)
    }
  })

  it("gives every declared guardrail at least one denied action and a reason", () => {
    for (const guardrail of [...ROOT_GUARDRAILS, ...ORGANIZATIONAL_UNITS.flatMap((u) => u.guardrails)]) {
      expect(guardrail.denies.length).toBeGreaterThan(0)
      expect(guardrail.why.length).toBeGreaterThan(40)
    }
  })

  it("throws rather than returning undefined for a unit nobody declared", () => {
    expect(() => organizationalUnit("policy-staging" as OrganizationalUnitKey)).toThrow(
      /No organizational unit is declared/,
    )
  })
})

/* -------------------------------------------------------- the inheritance -- */

describe("guardrail inheritance", () => {
  it("puts the root guardrails in force at every unit", () => {
    for (const unit of ORGANIZATIONAL_UNITS) {
      const ids = inheritedGuardrails(unit.key).map((g) => g.id)
      for (const root of ROOT_GUARDRAILS) expect(ids).toContain(root.id)
    }
  })

  it("makes a child's effective set a strict superset of its parent's", () => {
    for (const unit of ORGANIZATIONAL_UNITS) {
      if (unit.parent === null) continue
      const child = new Set(inheritedGuardrails(unit.key).map((g) => g.id))
      const parent = inheritedGuardrails(unit.parent).map((g) => g.id)
      for (const id of parent) expect(child.has(id)).toBe(true)
      expect(child.size).toBeGreaterThan(parent.length)
    }
  })

  it("never lets the denied-action count fall going down the tree", () => {
    for (const unit of ORGANIZATIONAL_UNITS) {
      if (unit.parent === null) continue
      expect(deniedActionCount(unit.key)).toBeGreaterThan(deniedActionCount(unit.parent))
    }
  })

  it("orders the effective set root-first, which is the order AWS evaluates it in", () => {
    const effective = inheritedGuardrails("quarantine").map((g) => g.id)
    expect(effective.slice(0, ROOT_GUARDRAILS.length)).toEqual(ROOT_GUARDRAILS.map((g) => g.id))
    expect(effective.indexOf("deny-new-spend")).toBeLessThan(
      effective.indexOf("deny-evidence-destruction-in-quarantine"),
    )
  })

  it("walks root to unit, inclusive", () => {
    expect(ancestry("closure").map((u) => u.key)).toEqual(["suspended", "closure"])
    expect(ancestry("security").map((u) => u.key)).toEqual(["security"])
  })
})

describe("guardrailDefects — the edits it exists to refuse", () => {
  const g = (id: string, denies: string[] = ["ec2:RunInstances"]): Guardrail => ({
    id,
    denies,
    why: "a reason long enough to be a reason and not a label on a field",
  })

  const tree = (over: Partial<Record<OrganizationalUnitKey, Guardrail[]>>): OrganizationalUnit[] => [
    { key: "suspended", name: "Suspended", parent: null, purpose: "p", guardrails: over.suspended ?? [g("deny-new-spend")] },
    { key: "quarantine", name: "Quarantine", parent: "suspended", purpose: "p", guardrails: over.quarantine ?? [g("deny-forensic-destruction")] },
  ]

  it("passes a tree that only adds", () => {
    expect(guardrailDefects(tree({}), [g("deny-leave-organization")])).toEqual([])
  })

  it("refuses a child that redeclares an ancestor's guardrail id", () => {
    const defects = guardrailDefects(tree({ quarantine: [g("deny-new-spend", ["s3:DeleteObject"])] }), [])
    expect(defects).toHaveLength(1)
    expect(defects[0]).toMatch(/quarantine redeclares guardrail deny-new-spend/)
  })

  it("refuses a child that redeclares a ROOT guardrail id", () => {
    const defects = guardrailDefects(tree({ quarantine: [g("deny-leave-organization", [])] }), [
      g("deny-leave-organization"),
    ])
    expect(defects.some((d) => /root already declares/.test(d))).toBe(true)
  })

  it("refuses a guardrail that denies nothing", () => {
    const defects = guardrailDefects(tree({ quarantine: [g("deny-nothing", [])] }), [])
    expect(defects).toEqual([expect.stringMatching(/deny-nothing with nothing denied/)])
  })

  it("refuses a parent that is not a declared unit", () => {
    const orphan: OrganizationalUnit[] = [
      { key: "closure", name: "Closure", parent: "suspended", purpose: "p", guardrails: [] },
    ]
    expect(guardrailDefects(orphan, [])).toEqual([
      expect.stringMatching(/closure names parent suspended, which is not a declared unit/),
    ])
  })
})

/* ----------------------------------------------------- the closure lifecycle -- */

describe("the closure lifecycle", () => {
  it("makes Closure terminal", () => {
    expect(ACCOUNT_MOVES[TERMINAL_UNIT]).toEqual([])
    for (const key of Object.keys(ACCOUNT_MOVES) as OrganizationalUnitKey[]) {
      expect(canMoveAccount(TERMINAL_UNIT, key)).toBe(false)
    }
  })

  it("refuses reinstatement straight out of Quarantine", () => {
    expect(canMoveAccount("quarantine", "workloads")).toBe(false)
    expect(canMoveAccount("quarantine", "suspended")).toBe(true)
    expect(canMoveAccount("suspended", "workloads")).toBe(true)
  })

  it("routes every exit through Suspended", () => {
    expect(canMoveAccount("workloads", "closure")).toBe(false)
    expect(canMoveAccount("security", "closure")).toBe(false)
    expect(canMoveAccount("suspended", "closure")).toBe(true)
  })

  it("declares a move set for every unit and names only declared units in it", () => {
    const keys = new Set(ORGANIZATIONAL_UNITS.map((u) => u.key))
    expect(new Set(Object.keys(ACCOUNT_MOVES))).toEqual(keys)
    for (const [from, tos] of Object.entries(ACCOUNT_MOVES)) {
      for (const to of tos) {
        expect(keys.has(to)).toBe(true)
        expect(to).not.toBe(from)
      }
    }
  })
})

/* ------------------------------------------------------- the reconciliation -- */

describe("reconcileOrganizationalUnits against a live read", () => {
  it("finds every declared unit in a compliant estate", async () => {
    const verdicts = reconcileOrganizationalUnits({ tree: await read(COMPLIANT) })
    expect(verdicts).toHaveLength(ORGANIZATIONAL_UNITS.length)
    expect(verdicts.every((v) => v.presence.state === "PRESENT")).toBe(true)
    expect(unitSummary(verdicts).present).toBe(7)
  })

  it("walks below the root, so a nested unit is found rather than reported missing", async () => {
    const verdicts = reconcileOrganizationalUnits({ tree: await read(COMPLIANT) })
    const quarantine = verdicts.find((v) => v.unit.key === "quarantine")!
    expect(quarantine.presence).toEqual({ state: "PRESENT", unitId: "ou-qua" })
  })

  it("reports a unit under the wrong parent as MISPLACED, not as present", async () => {
    const moved: Fixture = {
      ...COMPLIANT,
      ous: COMPLIANT.ous.map((o) => (o.name === "Quarantine" ? { ...o, parentId: "r-root" } : o)),
    }
    const verdicts = reconcileOrganizationalUnits({ tree: await read(moved) })
    const quarantine = verdicts.find((v) => v.unit.key === "quarantine")!
    expect(quarantine.presence).toEqual({
      state: "MISPLACED",
      unitId: "ou-qua",
      observedParentId: "r-root",
      expectedParentId: "ou-sus",
    })
    expect(unitSummary(verdicts).misplaced).toBe(1)
  })

  it("reports a unit that is genuinely absent as MISSING", async () => {
    const without: Fixture = { ...COMPLIANT, ous: COMPLIANT.ous.filter((o) => o.name !== "Sandbox") }
    const verdicts = reconcileOrganizationalUnits({ tree: await read(without) })
    const sandbox = verdicts.find((v) => v.unit.key === "sandbox")!
    expect(sandbox.presence.state).toBe("MISSING")
    expect(sandbox.guardrails.state).toBe("UNREAD")
    expect(unitSummary(verdicts).missing).toBe(1)
  })

  it("says a unit with no policy attached has none, and one with policies names them", async () => {
    const verdicts = reconcileOrganizationalUnits({ tree: await read(COMPLIANT) })
    expect(verdicts.find((v) => v.unit.key === "security")!.guardrails).toEqual({
      state: "ATTACHED",
      policies: ["TenureRootBaseline", "TenureSecurityArchive"],
    })
    expect(verdicts.find((v) => v.unit.key === "workloads")!.guardrails).toEqual({
      state: "NONE_ATTACHED",
    })
  })

  it("carries the effective guardrails onto every row, including a missing one", async () => {
    const without: Fixture = { ...COMPLIANT, ous: [] }
    const verdicts = reconcileOrganizationalUnits({ tree: await read(without) })
    for (const verdict of verdicts) {
      expect(verdict.effective).toEqual(inheritedGuardrails(verdict.unit.key))
      expect(verdict.deniedActions).toBe(deniedActionCount(verdict.unit.key))
    }
  })
})

describe("a read that failed is not an estate that is missing things", () => {
  it("reports every unit UNREAD when ListRoots is refused", async () => {
    const tree = await read({ ...COMPLIANT, denied: new Set(["organizations:ListRoots"]) })
    expect(tree.state).toBe("DENIED")

    const verdicts = reconcileOrganizationalUnits({ tree })
    expect(verdicts).toHaveLength(ORGANIZATIONAL_UNITS.length)
    expect(verdicts.every((v) => v.presence.state === "UNREAD")).toBe(true)
    expect(verdicts.some((v) => v.presence.state === "MISSING")).toBe(false)

    const summary = unitSummary(verdicts)
    expect(summary.missing).toBe(0)
    expect(summary.unread).toBe(ORGANIZATIONAL_UNITS.length)
    expect(summary.headline).toMatch(/organizations:ListRoots was refused \(AccessDeniedException\)/)
    expect(summary.headline).toMatch(/none of them is reported missing/)
  })

  it("fails the whole read when the CHILD listing is refused, rather than reporting a short tree", async () => {
    const tree = await read({
      ...COMPLIANT,
      denied: new Set(["organizations:ListOrganizationalUnitsForParent"]),
    })
    expect(tree.state).toBe("DENIED")
    expect(reconcileOrganizationalUnits({ tree }).every((v) => v.presence.state === "UNREAD")).toBe(
      true,
    )
  })

  it("keeps the hierarchy when only the POLICY listing is refused, and says that column is unread", async () => {
    const tree = await read({
      ...COMPLIANT,
      denied: new Set(["organizations:ListPoliciesForTarget"]),
    })
    expect(tree.state).toBe("ACTUAL")

    const verdicts = reconcileOrganizationalUnits({ tree })
    expect(verdicts.every((v) => v.presence.state === "PRESENT")).toBe(true)
    for (const verdict of verdicts) {
      expect(verdict.guardrails.state).toBe("UNREAD")
      if (verdict.guardrails.state === "UNREAD") {
        expect(verdict.guardrails.because).toMatch(/ListPoliciesForTarget was refused/)
      }
    }
  })

  it("carries the minimum IAM statement on an unread row so it can be fixed without leaving the page", async () => {
    const tree = await read({ ...COMPLIANT, denied: new Set(["organizations:ListRoots"]) })
    const first = reconcileOrganizationalUnits({ tree })[0].presence
    expect(first.state).toBe("UNREAD")
    if (first.state === "UNREAD") {
      expect(first.minimumStatement).toMatch(/organizations:ListRoots/)
    }
  })

  it("treats an UNCONFIGURED read as unread and prints its reason", () => {
    const verdicts = reconcileOrganizationalUnits({
      tree: {
        state: "UNCONFIGURED",
        capability: "organizations:ListRoots",
        why: "this build has no Organization to read",
      },
    })
    expect(verdicts.every((v) => v.presence.state === "UNREAD")).toBe(true)
    expect(unitSummary(verdicts).headline).toMatch(/this build has no Organization to read/)
  })
})
