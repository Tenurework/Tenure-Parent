import {
  planPublication,
  resolveVersionedLayers,
  requiresApproval,
  type PublicationPlan,
  type VersionedLayer,
} from "@tenure/configuration"
import { MODULES } from "@tenure/modules"
import { REGISTRY } from "@tenure/platform-config"

import { consequenceLines } from "./consequences"
import { publicationModules } from "./publication-modules"

/**
 * CFG-020-004 / CFG-030-003 — the operator-facing half.
 *
 * Every plan here is built by `planPublication` over the LIVE registry and the
 * LIVE module catalogue, in the shape `actions.ts` builds it. A hand-written
 * plan object would keep these green on the day the publication path stopped
 * evaluating anything, which is the exact failure this file exists to catch.
 */

const NOW = new Date("2026-08-02T00:00:00Z")
const LATER = new Date("2026-08-03T00:00:00Z")

// The production list, not a copy of it. A copy would keep this file green on
// the day `actions.ts` changed what it passes.
const modules = publicationModules()

function layer(values: Record<string, unknown>, id = "acme"): VersionedLayer {
  const kind: VersionedLayer["kind"] = "tenantOverlay"
  return {
    kind,
    id,
    values,
    metadata: {
      version: 1,
      schemaVersion: "1.0.0",
      signer: "arn:aws:kms:us-east-1:000000000000:key/test",
      origin: "consequences.test.ts",
      compatibility: { minEngine: "2026.7.0", maxEngine: null },
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveUntil: null,
      changeReason: "a reason long enough to be a reason",
      approvedBy: requiresApproval(kind) ? "operator:approver" : null,
    },
  }
}

const current = (() => {
  const resolved = resolveVersionedLayers(
    REGISTRY,
    [layer({ "platform.terminology.leadershipBody": "Council" }, "acme-baseline")],
    LATER,
    { collectProblems: true },
  )
  if (!resolved.config) throw new Error("fixture does not resolve")
  return resolved.config.values
})()

const plan = (over: Partial<Parameters<typeof planPublication>[0]> = {}): PublicationPlan =>
  planPublication({
    registry: REGISTRY,
    current: { values: current, revision: 7 },
    proposed: [layer({ "platform.terminology.leadershipBody": "Board of Trustees" })],
    publishedBy: "operator:publisher",
    activateAt: LATER,
    now: NOW,
    modules,
    enabledModules: [],
    entitlements: [],
    ...over,
  })

const lineFor = (p: PublicationPlan, id: string) => consequenceLines(p).find((l) => l.id === id)

describe("the module closure the Studio publishes", () => {
  it("carries every module, with its version", () => {
    // CFG-030-005. Unversioned packages make the graph digest unable to tell
    // the same declarations republished as 2.0.0 from the ones that were
    // approved.
    expect(modules.map((m) => m.key).sort()).toEqual(MODULES.map((m) => m.key).sort())
    for (const module of modules) {
      expect(typeof module.version).toBe("string")
      expect(module.version).toBe(MODULES.find((m) => m.key === module.key)!.version)
    }
    expect(plan().graph!.unversionedPackages).toEqual(["platform"])
  })

  it("gives a republished package a different digest, and the same values", () => {
    const bumped = modules.map((m) => (m.key === "budgeting" ? { ...m, version: "2.0.0" } : m))
    const before = plan()
    const after = plan({ modules: bumped })
    expect(after.graph!.digest).not.toBe(before.graph!.digest)
    expect(after.evaluation!.outputDigest).not.toBe(before.evaluation!.outputDigest)
    expect(after.evaluation!.values).toEqual(before.evaluation!.values)
  })
})

describe("the review panel shows what the graph decided", () => {
  it("names the field a change moves", () => {
    const line = lineFor(plan(), "fields-moved")
    expect(line?.detail).toBe("platform.terminology.leadershipBody")
  })

  it("says nothing moved, in words that cannot be mistaken for not having looked", () => {
    // Proposing exactly the current value moves no node. The line has to say the
    // graph WAS evaluated — "None." on its own reads identically to a plan that
    // never evaluated anything, and those are opposite answers.
    const unchanged = plan({ proposed: [layer({ "platform.terminology.leadershipBody": "Council" })] })
    expect(unchanged.nodesAffected).toEqual([])
    expect(lineFor(unchanged, "fields-moved")?.detail).toContain("the graph was evaluated and found nothing moved")
  })

  it("shows the digest pair an approval would bind to", () => {
    const p = plan()
    const line = lineFor(p, "bound-to")
    expect(line?.detail).toContain(p.evaluation!.outputDigest)
    expect(line?.detail).toContain(p.graph!.digest)
  })

  it("names the configured keys that are outside the graph, and why", () => {
    const line = lineFor(plan(), "no-node")
    expect(line?.detail).toContain("platform.payments.approvalThresholds")
    expect(line?.detail).toContain("an object")
  })

  it("reports that nothing is withheld from the browser, rather than omitting the question", () => {
    expect(lineFor(plan(), "withheld")?.detail).toContain("None")
  })

  it("says why there is no evaluation, and shows no field lines at all", () => {
    const broken = plan({ modules: [...modules, { key: "ghost", dependsOn: [{ module: "nothing-provides-this" }] }] })
    const lines = consequenceLines(broken)
    expect(lines.map((l) => l.id)).toEqual(["not-evaluated"])
    expect(lines[0].detail).toContain("did not compile")
  })

  it("says so when a plan carries no graph at all", () => {
    const p = { ...plan(), graph: undefined } as PublicationPlan
    expect(consequenceLines(p).map((l) => l.id)).toEqual(["graph"])
  })
})
