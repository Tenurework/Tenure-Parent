import { test, expect } from "@playwright/test"

import { MODULES } from "@tenure/modules"
import { domainOf, type ConfigRecord } from "@tenure/configuration"
import { MODEL_TOKEN_BUDGET_KEY } from "@tenure/platform-config"
import { parseChangeDiff, parseEstateResource, type ChangeDiff } from "@tenure/contracts"

import {
  changeDomainForKey,
  compareRevisions,
  configurationChangeDiff,
  dependantsOf,
  dependencyGraph,
  renderComparison,
  rollbackChangeDiff,
  rollbackSummary,
  summarise,
} from "../src/lib/revisions"
import { estateInventory, estateLines, type EstateResource } from "../src/lib/aws/inventory"
import {
  irreversibleEntries,
  resourceChangeDiff,
  type DriftReport,
} from "../src/lib/aws/drift"
import type { AwsGateway } from "../src/lib/aws/read"

/**
 * GE-032-003 / STUDIO-060-003 — comparing revisions, diffing the estate, and
 * reading the dependency graph.
 *
 * Pure, so no browser. The graph tests run against the REAL module catalogue as
 * well as fixtures: a blast-radius calculation that has only seen a hand-built
 * graph has never met the data an operator would act on.
 *
 * The diff tests assert on the DOCUMENT the production path emits and on the
 * string derived from it, in that order — because the string is derived, and a
 * test that only checked the string would stay green if the machine-readable
 * form lost half its entries.
 */

function record(revision: number, values: Record<string, unknown>): ConfigRecord {
  return {
    tenantId: "acme",
    revision,
    layers: [],
    provenance: `sha256:${revision}`,
    layerDigests: [],
    values,
    checksum: `sha256:c${revision}`,
    languageVersion: "1.0.0",
    publishedBy: "operator:one",
    publishedAt: "2026-08-02T00:00:00.000Z",
    activateAt: "2026-08-02T00:00:00.000Z",
    rollbackTo: revision === 1 ? null : revision - 1,
    plan: {
      blocked: false,
      blockers: [],
      rejections: [],
      violations: [],
      excused: [],
      lint: [],
      diff: [],
      humanDiff: "",
      impact: { keysAdded: 1, keysRemoved: 0, keysChanged: 2, modulesAffected: [], fixturesAffected: [] },
      simulations: [],
      rollbackTo: revision === 1 ? null : revision - 1,
      activateAt: "2026-08-02T00:00:00.000Z",
    },
  }
}

test.describe("comparing two revisions", () => {
  test("reports added, removed and changed keys", () => {
    const differences = compareRevisions(
      record(1, { kept: "same", gone: 1, moved: "before" }),
      record(2, { kept: "same", arrived: 2, moved: "after" }),
    )
    const byKey = Object.fromEntries(differences.map((d) => [d.key, d.change]))
    expect(byKey.gone).toBe("removed")
    expect(byKey.arrived).toBe("added")
    expect(byKey.moved).toBe("changed")
    expect(byKey.kept).toBeUndefined()
  })

  test("does not report a key-order change as a change", () => {
    // A value reserialised by a different writer must not read as a change, or
    // every comparison after a storage-format tweak is noise.
    expect(
      compareRevisions(record(1, { o: { a: 1, b: 2 } }), record(2, { o: { b: 2, a: 1 } })),
    ).toEqual([])
  })

  test("says plainly when two revisions resolve the same", () => {
    expect(renderComparison(configurationChangeDiff(record(1, { a: 1 }), record(2, { a: 1 })))).toBe(
      "These revisions resolve to the same configuration.",
    )
  })

  test("renders in the same style as the publication diff", () => {
    // Two diffs in one console that disagree about notation is one an operator
    // has to translate between.
    const text = renderComparison(configurationChangeDiff(record(1, { a: 1 }), record(2, { a: 2 })))
    expect(text).toBe("~ a: 1 -> 2")
  })

  test("compares resolved values, not layers", () => {
    // Two different layer stacks can resolve to the same configuration. An
    // operator comparing revisions asks what the system does differently;
    // `provenance` answers how the answer was assembled.
    const a = record(1, { same: true })
    const b = { ...record(2, { same: true }), provenance: "sha256:totally-different" }
    expect(compareRevisions(a, b)).toEqual([])
  })
})

test.describe("the configuration diff as a document", () => {
  test("survives a round trip through the published contract", () => {
    // The document, not the sentence. This is what a route, a ticket or another
    // process would receive, and it has to be admitted by the same parser a
    // foreign producer would be held to.
    const diff = configurationChangeDiff(
      record(1, { kept: "same", gone: 1, moved: "before" }),
      record(2, { kept: "same", arrived: 2, moved: "after" }),
    )
    const round = parseChangeDiff(JSON.parse(JSON.stringify(diff)))
    expect(round).toEqual(diff)
    expect(round.entries.map((e) => `${e.effect} ${e.path}`).sort()).toEqual([
      "create arrived",
      "delete gone",
      "update moved",
    ])
  })

  test("prices nothing rather than pricing it at zero", () => {
    // `null` and `0` are different answers. Nothing prices a configuration key
    // today, and an approval threshold must not read "not computed" as "free".
    const diff = configurationChangeDiff(record(1, { a: 1 }), record(2, { a: 2 }))
    expect(diff.entries[0].monthlyCostDeltaMinor).toBeNull()
  })

  test("every configuration change is reversible, because rollback republishes forward", () => {
    const diff = configurationChangeDiff(record(1, { a: 1 }), record(2, {}))
    expect(diff.entries[0].effect).toBe("delete")
    expect(diff.entries[0].reversible).toBe(true)
  })
})

/* -------------------------------------------------------- the relay arm -- */

test.describe("the Relay arm of a change diff", () => {
  test("puts a Relay allowance in its own domain, from the engine's own table", () => {
    // `MODEL_TOKEN_BUDGET_KEY` is the real key, imported rather than typed out,
    // so renaming it in `@tenure/platform-config` reds this rather than leaving
    // a spec asserting a string nothing uses. It is the per-tenant model-spend
    // ceiling enforced in `apps/web/src/app/api/ai/chat/route.ts`, which is why
    // it is not "some app setting moved".
    const diff = configurationChangeDiff(
      record(1, { [MODEL_TOKEN_BUDGET_KEY]: 250_000, "platform.branding.wordmark": "Tenure" }),
      record(2, { [MODEL_TOKEN_BUDGET_KEY]: 1_000_000, "platform.branding.wordmark": "Tenure" }),
    )
    expect(diff.entries).toHaveLength(1)
    expect(diff.entries[0].domain).toBe("relay")
    expect(diff.entries[0].path).toBe(MODEL_TOKEN_BUDGET_KEY)
  })

  test("leaves every other governed namespace as app config", () => {
    // The classifier lifts out exactly one domain, because exactly one governed
    // domain outside plain configuration has a definition today. A branding or a
    // payments key reading as anything but `app-config` would be the enum
    // growing by aspiration.
    const diff = configurationChangeDiff(
      record(1, { "platform.branding.wordmark": "a", "platform.payments.mode": "test" }),
      record(2, { "platform.branding.wordmark": "b", "platform.payments.mode": "live" }),
    )
    expect(diff.entries.map((e) => e.domain)).toEqual(["app-config", "app-config"])
  })

  test("names both domains in the rendering when a publication touches both", () => {
    // The derived string, not the document. A diff spanning two domains has to
    // say which lines are which, or an operator reads a model-spend increase as
    // a colour change.
    const text = renderComparison(
      configurationChangeDiff(
        record(1, { [MODEL_TOKEN_BUDGET_KEY]: 250_000, "platform.branding.wordmark": "a" }),
        record(2, { [MODEL_TOKEN_BUDGET_KEY]: 1_000_000, "platform.branding.wordmark": "b" }),
      ),
    )
    expect(text).toContain("Configuration:")
    expect(text).toContain("Relay:")
    expect(text).toContain(`~ ${MODEL_TOKEN_BUDGET_KEY}: 250000 -> 1000000`)
  })

  test("classifies by the configuration engine's table, not by a prefix of its own", () => {
    // `domainOf` is the same function that decides who may WRITE the key. Two
    // opinions about what `platform.relay.` means is how the thing an approver
    // sees and the thing authority is enforced on come apart.
    expect(changeDomainForKey(MODEL_TOKEN_BUDGET_KEY)).toBe("relay")
    expect(changeDomainForKey(domainOf(MODEL_TOKEN_BUDGET_KEY)!.prefixes[0] + "anything")).toBe("relay")
    // The trailing dot matters: `platform.relayed…` is not a Relay key.
    expect(changeDomainForKey("platform.relayedThing.x")).toBe("app-config")
  })
})

/* ----------------------------------------------------- the rollback arm -- */

test.describe("the rollback arm of a change diff", () => {
  const live = record(4, { kept: "same", added_since: 9, moved: "now" })
  const target = record(2, { kept: "same", moved: "then", only_then: 1 })

  test("states what returning to an earlier revision would do, in its own domain", () => {
    const diff = rollbackChangeDiff(live, target)
    expect(new Set(diff.entries.map((e) => e.domain))).toEqual(new Set(["rollback"]))
    expect(diff.entries.map((e) => `${e.effect} ${e.path}`).sort()).toEqual([
      "create only_then",
      "delete added_since",
      "update moved",
    ])
  })

  test("runs live -> target, so before is what is running now", () => {
    // The direction is the whole value of the preview. Computed the other way
    // round it produces the same keys with every arrow reversed, and an operator
    // acting on it would restore the wrong half.
    const moved = rollbackChangeDiff(live, target).entries.find((e) => e.path === "moved")!
    expect(moved.before).toBe("now")
    expect(moved.after).toBe("then")
  })

  test("is admitted by the published contract, and refuses to call itself irreversible", () => {
    const diff = rollbackChangeDiff(live, target)
    expect(parseChangeDiff(JSON.parse(JSON.stringify(diff)))).toEqual(diff)
    expect(diff.entries.every((e) => e.reversible)).toBe(true)
    // The contract, not just the producer: a future writer that emitted an
    // irreversible rollback is refused at the boundary rather than rendered.
    expect(() =>
      parseChangeDiff({
        schemaVersion: diff.schemaVersion,
        entries: [{ ...diff.entries[0], reversible: false }],
      }),
    ).toThrow(/republishes forward/)
  })

  test("summarises for the control, and says plainly when nothing would change", () => {
    expect(rollbackSummary(rollbackChangeDiff(live, target), 2)).toBe(
      "Rolling back to revision 2 changes 3 keys.",
    )
    const same = rollbackChangeDiff(record(4, { a: 1 }), record(2, { a: 1 }))
    expect(rollbackSummary(same, 2)).toBe(
      "Revision 2 resolves to exactly what is live. Rolling back would change nothing.",
    )
    expect(same.entries).toHaveLength(0)
  })

  test("the summary counts the document, not the records", () => {
    // Derived, so a diff that lost entries cannot keep a confident count beside
    // it. One key differs; the sentence must say one, singular.
    expect(rollbackSummary(rollbackChangeDiff(record(4, { a: 1 }), record(3, { a: 2 })), 3)).toBe(
      "Rolling back to revision 3 changes 1 key.",
    )
  })
})

/* ------------------------------------------------------- the estate arm -- */

const NOW = new Date("2026-08-07T10:00:00.000Z")

/**
 * A live resource in the shape `inventory.ts` produces, contract projection and
 * all. Built through the real mapping rather than by hand so that `stateful` —
 * the field `reversible` is derived from — comes from the same place the
 * production path gets it.
 */
function live(over: {
  arn: string
  resourceType: string
  name: string
  stateful: boolean
  tags?: Record<string, string>
}): EstateResource {
  const [service, kind] = over.resourceType.split(":")
  const parts = over.arn.split(":")
  const tags = over.tags ?? {}
  return {
    arn: over.arn,
    resourceType: over.resourceType,
    name: over.name,
    state: "ACTIVE",
    region: parts[3],
    accountId: parts[4],
    partition: parts[1],
    tags,
    attribution: { kind: "unattributed" },
    dependsOn: [],
    asOf: NOW.toISOString(),
    contract: {
      schemaVersion: "1.0",
      arn: over.arn,
      service,
      resourceType: kind,
      name: over.name,
      accountId: parts[4],
      region: parts[3] || "global",
      partition: parts[1],
      tenantId: null,
      cell: null,
      environment: null,
      stateful: over.stateful,
      tags,
      observedAt: NOW.toISOString(),
    },
  }
}

const DATABASE = live({
  arn: "arn:aws:rds:us-east-1:012345678901:db:tenure-orphan",
  resourceType: "rds:db",
  name: "tenure-orphan",
  stateful: true,
})

const SERVICE = live({
  arn: "arn:aws:ecs:us-east-1:012345678901:service/tenure-prod/stray",
  resourceType: "ecs:service",
  name: "stray",
  stateful: false,
})

const MANAGED = live({
  arn: "arn:aws:ecs:us-east-1:012345678901:service/tenure-prod/web",
  resourceType: "ecs:service",
  name: "web",
  stateful: false,
  tags: { "tenure:managed-by": "terraform:studio" },
})

function missingReport(items: DriftReport["items"]): DriftReport {
  return { items, partial: false, asOf: NOW.toISOString() }
}

function missing(resourceKey: string, resourceType: string, severity: "serving" | "unknown"): DriftReport["items"][number] {
  return {
    resourceKey,
    severity,
    owner: "seat:platform",
    desired: {
      resourceKey,
      resourceType,
      owner: "seat:platform",
      severityIfMissing: "serving",
      detail: "The artifact declares it.",
    },
    actual: severity === "unknown" ? { unknown: true, because: "the read was refused" } : ({} as never),
    firstSeenAt: NOW.toISOString(),
    occurrences: 1,
  }
}

test.describe("the AWS-resource arm of a change diff", () => {
  test("proposes deleting only what nothing manages", () => {
    const { diff } = resourceChangeDiff({
      live: [DATABASE, SERVICE, MANAGED],
      now: NOW,
      reference: "estate reconciliation",
    })
    const deleted = diff.entries.filter((e) => e.effect === "delete").map((e) => e.path)
    expect(deleted).toEqual([DATABASE.arn, SERVICE.arn])
    expect(deleted).not.toContain(MANAGED.arn)
  })

  test("sets reversible from what the resource is, not from the effect", () => {
    const { diff } = resourceChangeDiff({ live: [DATABASE, SERVICE], now: NOW, reference: "r" })
    const byPath = Object.fromEntries(diff.entries.map((e) => [e.path, e]))
    // Putting an ECS service back is a deployment. Putting a database back is a
    // new, empty database with the same name.
    expect(byPath[SERVICE.arn].reversible).toBe(true)
    expect(byPath[DATABASE.arn].reversible).toBe(false)
  })

  test("refuses the irreversible deletions, and only those", () => {
    // The value the estate page branches on to withhold a reconcile action.
    const { diff } = resourceChangeDiff({ live: [DATABASE, SERVICE], now: NOW, reference: "r" })
    expect(irreversibleEntries(diff).map((e) => e.path)).toEqual([DATABASE.arn])
  })

  test("carries the monthly cost of each change, and refuses to invent one it has no price for", () => {
    const unpriceable = live({
      arn: "arn:aws:sqs:us-east-1:012345678901:tenure-unknown",
      resourceType: "sqs:queue",
      name: "tenure-unknown",
      stateful: false,
    })
    const { diff, cost } = resourceChangeDiff({
      live: [DATABASE, unpriceable],
      now: NOW,
      reference: "r",
    })
    const byPath = Object.fromEntries(diff.entries.map((e) => [e.path, e]))
    // Deleting the database saves its list price, so the delta is negative.
    expect(byPath[DATABASE.arn].monthlyCostDeltaMinor).toBe(-5895)
    expect(byPath[unpriceable.arn].monthlyCostDeltaMinor).toBeNull()
    expect(cost.unpriced).toEqual(["delete sqs:queue tenure-unknown"])
  })

  test("assesses the plan's total through the published threshold bands", () => {
    // Ten databases at $58.95 a month is $589.50 a month. Approving them one at
    // a time as "peer" is how a fleet's bill grows with no decision to grow it.
    const ten = Array.from({ length: 10 }, (_, i) => missing(`rds:db/tenant-${i}`, "rds:db", "serving"))
    const { diff, cost } = resourceChangeDiff({
      live: [],
      missing: missingReport(ten),
      now: NOW,
      reference: "provision ten tenants",
    })
    expect(cost.totalMinor).toBe(58_950)
    expect(cost.level).toBe("TWO_PERSON")
    // Published as a figure, not a loose number: something outside this process
    // has to be able to read it.
    expect(cost.figure.kind).toBe("FORECAST")
    expect(cost.figure.currency).toBe("USD")
    expect(cost.figure.amountMinor).toBe(58_950)

    const total = diff.entries.find((e) => e.domain === "cost")
    expect(total?.monthlyCostDeltaMinor).toBe(58_950)
    expect(total?.after).toBe("TWO_PERSON")
  })

  test("a resource whose state could not be read is counted, never proposed", () => {
    // "We were not allowed to look" must not become a plan to create something
    // that already exists. The count is reported so the omission is visible.
    const { diff, unreadable } = resourceChangeDiff({
      live: [],
      missing: missingReport([missing("rds:db/blind", "rds:db", "unknown")]),
      now: NOW,
      reference: "r",
    })
    expect(unreadable).toBe(1)
    expect(diff.entries).toEqual([])
  })

  test("the document it emits is admitted by the published contract", () => {
    const { diff } = resourceChangeDiff({ live: [DATABASE, SERVICE], now: NOW, reference: "r" })
    expect(parseChangeDiff(JSON.parse(JSON.stringify(diff)))).toEqual(diff)
  })
})

test.describe("the rendering, derived from the document", () => {
  const mixed = (): ChangeDiff =>
    resourceChangeDiff({ live: [DATABASE, SERVICE], now: NOW, reference: "estate reconciliation" }).diff

  test("names the AWS resources it would remove", () => {
    const text = renderComparison(mixed())
    expect(text).toContain("AWS resources:")
    expect(text).toContain(DATABASE.arn)
    expect(text).toContain(SERVICE.arn)
  })

  test("marks an irreversible line and leaves the reversible one unmarked", () => {
    const lines = renderComparison(mixed()).split("\n")
    const database = lines.find((l) => l.includes(DATABASE.arn))!
    const service = lines.find((l) => l.includes(SERVICE.arn))!
    expect(database).toContain("IRREVERSIBLE")
    expect(service).not.toContain("IRREVERSIBLE")
  })

  test("puts the money on the line an operator reads", () => {
    expect(renderComparison(mixed())).toContain("-$58.95/month")
  })
})

/* -------------------------------------- the contract at the read boundary -- */

/**
 * A stand-in for the AWS gateway that answers each capability with a real
 * response shape. Not a mock of the module under test: `estateInventory` maps,
 * validates and wraps exactly as it does against AWS, and only the transport is
 * replaced.
 */
function gateway(overrides: Record<string, unknown>): AwsGateway {
  return {
    async call(capability: string) {
      if (capability in overrides) return overrides[capability]
      switch (capability) {
        case "sts:GetCallerIdentity":
          return { Account: "012345678901", Arn: "arn:aws:iam::012345678901:role/studio", UserId: "AROA" }
        case "tag:GetResources":
          return { ResourceTagMappingList: [] }
        case "ecs:ListClusters":
          return { clusterArns: ["arn:aws:ecs:us-east-1:012345678901:cluster/tenure-prod"] }
        case "ecs:ListServices":
          return { serviceArns: ["arn:aws:ecs:us-east-1:012345678901:service/tenure-prod/web"] }
        case "rds:DescribeDBInstances":
          return { DBInstances: [] }
        case "cloudfront:ListDistributions":
          return { DistributionList: { Items: [] } }
        case "acm:ListCertificates":
          return { CertificateSummaryList: [] }
        default:
          return {}
      }
    },
    async resolvedRegion() {
      return "us-east-1"
    },
  } as AwsGateway
}

test.describe("the inventory refuses a resource the contract does not admit", () => {
  test("maps a well-formed service into the published shape", async () => {
    const readings = await estateInventory(
      gateway({
        "ecs:DescribeServices": {
          services: [
            {
              serviceArn: "arn:aws:ecs:us-east-1:012345678901:service/tenure-prod/web",
              serviceName: "web",
              status: "ACTIVE",
              clusterArn: "arn:aws:ecs:us-east-1:012345678901:cluster/tenure-prod",
              desiredCount: 2,
              runningCount: 2,
              tags: [{ key: "tenure:tenant", value: "acme" }],
            },
          ],
        },
      }),
      { now: () => NOW },
    )
    expect(readings.ecsServices.state).toBe("ACTUAL")
    const [resource] = estateLines(readings).find((l) => l.surface === "ECS services")!.resources
    expect(resource.contract.schemaVersion).toMatch(/^\d+\.\d+$/)
    expect(resource.contract.service).toBe("ecs")
    expect(resource.contract.tenantId).toBe("acme")
    expect(resource.contract.stateful).toBe(false)
  })

  test("a service whose handle is not an ARN never reaches the page", async () => {
    // The failure this exists for. ECS names a service by ARN in one API and by
    // bare name in another; an adapter that maps the wrong one produces a
    // resource whose account, region and partition are all empty strings — and
    // an empty account renders as a resource in no account rather than as a
    // mapping fault. The contract refuses it at the boundary, so the surface
    // reads ERROR and names the refusal instead of showing the row.
    const readings = await estateInventory(
      gateway({
        "ecs:DescribeServices": {
          services: [{ serviceArn: "tenure-prod/web", serviceName: "web", status: "ACTIVE" }],
        },
      }),
      { now: () => NOW },
    )
    expect(readings.ecsServices.state).toBe("ERROR")
    expect(readings.ecsServices.state === "ERROR" && readings.ecsServices.code).toBe("ContractViolation")
    const line = estateLines(readings).find((l) => l.surface === "ECS services")!
    expect(line.resources).toEqual([])
  })

  test("a foreign producer's resource is refused when its ARN disagrees with its fields", () => {
    // The same gate, from the other direction. This adapter derives every field
    // FROM the ARN, so it cannot produce a disagreement — but the contract is a
    // process boundary, and anything reading a resource over HTTP can. Asserted
    // directly rather than through the adapter, because pretending the adapter
    // could emit it would be a test of a path that does not exist.
    expect(() =>
      parseEstateResource({
        ...SERVICE.contract,
        arn: "arn:aws:ecs:us-east-1:999999999999:service/tenure-prod/stray",
      }),
    ).toThrow(/names a different account/)
  })

  test("a database is mapped as stateful, which is what makes deleting it irreversible", async () => {
    const readings = await estateInventory(
      gateway({
        "rds:DescribeDBInstances": {
          DBInstances: [
            {
              DBInstanceArn: "arn:aws:rds:us-east-1:012345678901:db:tenure-prod",
              DBInstanceIdentifier: "tenure-prod",
              DBInstanceStatus: "available",
            },
          ],
        },
      }),
      { now: () => NOW },
    )
    expect(readings.databases.state).toBe("ACTUAL")
    const [db] = estateLines(readings).find((l) => l.surface === "Databases")!.resources
    expect(db.contract.stateful).toBe(true)
  })
})

test.describe("the revision list", () => {
  test("carries what an operator scans for", () => {
    const [first] = summarise([record(3, { a: 1 })])
    expect(first.revision).toBe(3)
    expect(first.rollbackTo).toBe(2)
    // Total keys touched, so a list shows which revisions were large.
    expect(first.changed).toBe(3)
  })

  test("says null for the first revision rather than 0", () => {
    expect(summarise([record(1, {})])[0].rollbackTo).toBeNull()
  })
})

test.describe("the dependency graph, against the real catalogue", () => {
  test("has every module as a node", () => {
    const graph = dependencyGraph(MODULES)
    expect(graph.nodes.length).toBe(MODULES.length)
    expect([...graph.nodes].sort()).toEqual(graph.nodes)
  })

  test("every edge points at a module that exists", () => {
    const graph = dependencyGraph(MODULES)
    for (const edge of graph.edges) {
      expect(graph.nodes).toContain(edge.to)
      expect(graph.nodes).toContain(edge.from)
    }
  })

  test("names what breaks if a real module is disabled", () => {
    // `feed` depends on `organizations`, so disabling organizations breaks it.
    expect(dependantsOf(MODULES, "organizations")).toContain("feed")
  })

  test("follows a capability to whatever provides it", () => {
    // `reimbursements` depends on the capability `finance.ledger`, which
    // `budgeting` provides. A graph that drew the capability as its own node
    // would answer "what breaks if budgeting goes?" without naming the module
    // that would actually stop working.
    expect(dependantsOf(MODULES, "budgeting")).toContain("reimbursements")
  })

  test("a leaf breaks nothing", () => {
    expect(dependantsOf(MODULES, "feed")).toEqual([])
  })
})

test.describe("the dependency graph, on shapes the catalogue does not have", () => {
  const chain = [
    { key: "a", dependsOn: [{ module: "b" }] },
    { key: "b", dependsOn: [{ module: "c" }] },
    { key: "c" },
  ]

  test("blast radius is transitive", () => {
    // Disabling c breaks b, and whatever depends on b. A list that stopped at
    // the direct dependants would under-report exactly when it matters most.
    expect(dependantsOf(chain, "c")).toEqual(["a", "b"])
  })

  test("roots are what nothing depends on", () => {
    expect(dependencyGraph(chain).roots).toEqual(["a"])
  })

  test("leaves are what depends on nothing", () => {
    expect(dependencyGraph(chain).leaves).toEqual(["c"])
  })

  test("a cycle does not hang the blast-radius walk", () => {
    // The catalogue has no cycle and GE-031-004 refuses one, but this walk runs
    // on whatever it is given — including a catalogue mid-edit.
    const cyclic = [
      { key: "x", dependsOn: [{ module: "y" }] },
      { key: "y", dependsOn: [{ module: "x" }] },
    ]
    expect(dependantsOf(cyclic, "x")).toEqual(["x", "y"])
  })
})
