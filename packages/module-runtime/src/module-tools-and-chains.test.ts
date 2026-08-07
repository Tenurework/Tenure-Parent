/**
 * PACK-070-004 and PACK-060-001 — what a manifest may declare about tools and
 * about the events that join modules into a process.
 *
 * Every test below removes or corrupts one declaration and asserts the refusal,
 * because the reason these live on the manifest at all is that catalog
 * construction is the last moment they can be caught cheaply. A tool with a
 * permission nothing can grant, or a consumer with no emitter, does not fail at
 * runtime — it waits, or it is never offered, and both look exactly like a
 * quiet system.
 *
 * Fixtures are `lifecycle: "development"` on purpose. That lifecycle claims
 * nothing about completeness, so these assertions are about the tool and event
 * rules and cannot pass or fail for an unrelated reason from the seventeen-
 * dimension contract.
 */
import { describe, expect, it } from "@jest/globals"

import { ModuleManifestError, validateManifest, type ModuleManifest } from "./manifest"
import { ModuleCatalog, type CatalogGovernance } from "./resolve"

/**
 * These fixtures are two modules, not the platform's twelve.
 *
 * `ModuleCatalog.of` reconciles a catalog against the permission catalog's
 * MODULE_KEYS and against the shipped role templates, and it is right to: a
 * manifest set missing a governed key is a real defect. Neither of those is
 * what these tests are about, and leaving them on would mean every assertion
 * below passed or failed on the completeness of a fixture rather than on the
 * rule under test. `modules.test.ts` holds the real catalog to both.
 */
const UNGOVERNED: CatalogGovernance = { governedKeys: null, roles: null }

const mod = (over: Partial<ModuleManifest> = {}): ModuleManifest => ({
  key: "search",
  version: "1.0.0",
  name: "Search",
  description: "Assisted search.",
  owner: "platform",
  lifecycle: "development",
  // PAY-160-002. Free, with the reason stated — the rule `validateManifest`
  // holds the real catalog to applies to a fixture too.
  price: {
    perSeatMinor: 0,
    perOrgMinor: 0,
    currency: "USD",
    rounding: "half-up",
    includedBecause: "Fixture module declared in module-tools-and-chains.test.ts; it ships nowhere.",
  },
  ...over,
})

const tool = (over: Record<string, unknown> = {}) => ({
  toolKey: "search.corpus",
  module: "search",
  description: "Retrieve passages from the principal's own permission-scoped corpus.",
  requiredPermission: "search.index.query",
  readOnly: true,
  reauthorizesPerCall: true,
  ...over,
})

function problemsOf(m: ModuleManifest): string[] {
  try {
    validateManifest(m)
  } catch (err) {
    if (err instanceof ModuleManifestError) return [...err.problems]
    throw err
  }
  return []
}

describe("a module's tool registrations", () => {
  it("accepts a tool gated on a permission this module owns", () => {
    expect(problemsOf(mod({ tools: [tool()] as never }))).toEqual([])
  })

  it("refuses a writing tool that does not reauthorize per call", () => {
    // The ToolRegistration contract's own rule, enforced at the moment the
    // catalog is built rather than at the first invocation: the permission may
    // have been revoked since the session began.
    const problems = problemsOf(
      mod({ tools: [tool({ readOnly: false, reauthorizesPerCall: false })] as never }),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/does not satisfy the ToolRegistration contract/)
    expect(problems[0]).toMatch(/may have been revoked/)
  })

  it("refuses a tool gated on a permission the catalog does not define", () => {
    const problems = problemsOf(
      mod({ tools: [tool({ requiredPermission: "search.index.telepathy" })] as never }),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/not in the permission catalog/)
  })

  it("refuses a tool gated on another module's permission", () => {
    // Turning this module on would not grant it, so the tool could never be
    // offered — and nothing else would ever say why.
    const problems = problemsOf(
      mod({ tools: [tool({ requiredPermission: "finance.budget.read" })] as never }),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/gates on module "budgeting"/)
  })

  it("refuses a module registering a tool on another module's behalf", () => {
    const problems = problemsOf(
      mod({ tools: [tool({ module: "budgeting" })] as never }),
    )
    expect(problems.some((p) => /owned by module "budgeting"/.test(p))).toBe(true)
  })

  it("refuses the same tool key twice", () => {
    const problems = problemsOf(mod({ tools: [tool(), tool()] as never }))
    expect(problems.some((p) => /"search\.corpus" twice/.test(p))).toBe(true)
  })
})

describe("a module's event declarations", () => {
  it("refuses an event name DomainEvent would refuse", () => {
    const problems = problemsOf(mod({ emits: ["DecideApproval"] }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/not a past-tense event type/)
  })

  it("refuses the same event declared twice", () => {
    const problems = problemsOf(mod({ consumes: ["ApprovalDecided", "ApprovalDecided"] }))
    expect(problems.some((p) => /consumes "ApprovalDecided" twice/.test(p))).toBe(true)
  })
})

describe("the catalog, across modules", () => {
  const emitter = mod({ key: "approvals", owner: "platform", emits: ["ApprovalDecided"] })
  const consumer = mod({ key: "memory", owner: "platform", consumes: ["ApprovalDecided"] })

  it("accepts a consumer whose event some module emits", () => {
    expect(ModuleCatalog.of([emitter, consumer], [], UNGOVERNED).size).toBe(2)
  })

  it("refuses a consumer with no emitter anywhere in the catalog", () => {
    // The failure this exists for: it does not throw at runtime, it waits, and
    // a wait is indistinguishable from a quiet system.
    expect(() => ModuleCatalog.of([consumer], [], UNGOVERNED)).toThrow(/consumes "ApprovalDecided", which no module/)
  })

  it("refuses a chain step naming a module the catalog does not ship", () => {
    expect(() =>
      ModuleCatalog.of(
        [emitter, consumer],
        [
          {
            chainId: "c1",
            name: "C1",
            steps: [
              { module: "approvals", consumes: null, emits: "ApprovalDecided" },
              { module: "ghost", consumes: "ApprovalDecided", emits: null },
            ],
          },
        ],
        UNGOVERNED,
      ),
    ).toThrow(/names module "ghost", which is not in the catalog/)
  })

  it("refuses a chain claiming a module emits something its manifest does not", () => {
    // A chain is data, and data that contradicts the manifests it describes is
    // a declaration of a process nobody implements.
    expect(() =>
      ModuleCatalog.of(
        [emitter, consumer],
        [
          {
            chainId: "c1",
            name: "C1",
            steps: [
              { module: "approvals", consumes: null, emits: "ApprovalRequested" },
              { module: "memory", consumes: "ApprovalRequested", emits: null },
            ],
          },
        ],
        UNGOVERNED,
      ),
    ).toThrow(/does not declare in its manifest/)
  })

  it("exposes the chains it validated, for release validation to hold a system to", () => {
    const chain = {
      chainId: "request-to-approval-to-memory",
      name: "Request → approval → memory",
      steps: [
        { module: "approvals", consumes: null, emits: "ApprovalDecided" },
        { module: "memory", consumes: "ApprovalDecided", emits: null },
      ],
    }
    expect(ModuleCatalog.of([emitter, consumer], [chain], UNGOVERNED).chains()).toEqual([chain])
  })
})
