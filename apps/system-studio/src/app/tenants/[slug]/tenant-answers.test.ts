/**
 * The two decisions behind `/tenants/[slug]`, driven without a browser, a
 * registry table or an AWS credential.
 *
 * `e2e/tenant-surface.spec.ts` is the browser half and it proves the PAGE
 * renders these. This proves what they DECIDE — and specifically the arms the
 * browser cannot reach against a seeded fleet, because a seeded tenant is in one
 * state at a time and there are twenty-five of them.
 *
 * Two rules, stated many ways:
 *
 *   1. A move the transition graph forbids has no row, and a move it permits
 *      but gates does not read like a routine one.
 *   2. A resource belongs to a tenant because of its TAG. Never its name, never
 *      a default, and never by folding "nobody claimed this" into "this is
 *      shared".
 *
 * Run from the repository root:
 *   npm run test --workspace apps/web -- --ci tenant-answers
 */

import {
  REQUIRES_OWNER,
  TERMINAL,
  classify,
  needsApproval,
  nextStates,
  requirementsFor,
  type TenantState,
} from "@tenure/provisioning"

import { attributionOf, type TaggedResource } from "../../../lib/aws/tags"

import { REGION_NOT_IN_ARN, describeFootprint, footprintOf } from "./footprint"
import { WEIGHT_WORD, permittedMoves, whatMovingDoes } from "./next-moves"

/* ─────────────────────────────────────────── what can happen next ───────── */

/** Every state in the graph, taken from the graph rather than typed out here. */
const ALL_STATES: readonly TenantState[] = [
  "DRAFT",
  "VALIDATING",
  "PLANNED",
  "AWAITING_APPROVAL",
  "PROVISIONING",
  "CONFIGURING",
  "MIGRATING",
  "VERIFYING",
  "READY",
  "ACTIVATING",
  "ACTIVE",
  "IDLE",
  "SUSPENDING",
  "SUSPENDED_LOGICAL",
  "HIBERNATING",
  "HIBERNATED_ZERO_RUNTIME",
  "REACTIVATING",
  "EXPORTING",
  "OFFBOARDING",
  "LEGAL_HOLD",
  "PURGE_PENDING",
  "PURGING",
  "PURGED_ZERO_INCREMENTAL_COST",
  "FAILED",
  "ROLLING_BACK",
]

describe("the moves this page offers are the moves the engine permits", () => {
  test("every state's offered destinations are exactly nextStates, with nothing added and nothing dropped", () => {
    // Collected rather than asserted per state: jest's `expect` takes no
    // message, so the failing STATE has to be in the compared value or the red
    // says only that two arrays differ.
    const offered = ALL_STATES.map((from) => `${from}: ${[...permittedMoves(from, "acme")]
      .map((m) => m.to)
      .sort()
      .join(",")}`)
    const graph = ALL_STATES.map(
      (from) => `${from}: ${[...nextStates(from)].sort().join(",")}`,
    )
    expect(offered).toEqual(graph)
  })

  test("a destination the graph forbids has no row at all", () => {
    // DRAFT reaches VALIDATING and OFFBOARDING. ACTIVE, PURGING and READY are
    // all real states and none of them is reachable from here; offering any of
    // them would be a button whose only possible outcome is a refusal.
    const fromDraft = permittedMoves("DRAFT", "acme").map((m) => m.to)
    expect(fromDraft).not.toContain("ACTIVE")
    expect(fromDraft).not.toContain("PURGING")
    expect(fromDraft).not.toContain("READY")
    expect(fromDraft).toContain("VALIDATING")
  })

  test("a terminal state offers nothing, and says so rather than rendering an absence", () => {
    const terminal = ALL_STATES.filter((s) => TERMINAL.has(s))
    expect(terminal.length).toBeGreaterThan(0)
    expect(terminal.map((state) => `${state}: ${permittedMoves(state, "acme").length}`)).toEqual(
      terminal.map((state) => `${state}: 0`),
    )
    const sentence = whatMovingDoes(permittedMoves(terminal[0], "acme"))
    expect(sentence).toMatch(/terminal state/i)
    expect(sentence).toMatch(/none is hidden/i)
  })

  test("the page says a move records rather than performs, because that is the thing operators get wrong", () => {
    const sentence = whatMovingDoes(permittedMoves("ACTIVE", "acme"))
    expect(sentence).toMatch(/RECORDS/)
    expect(sentence).toMatch(/None of them provisions/i)
    expect(sentence).toMatch(/reconciling toward the published artifact/i)
  })
})

describe("a gated move does not read like a routine one", () => {
  test("an ordinary advance is routine, and says it needs nothing beyond your own authority", () => {
    const validating = permittedMoves("DRAFT", "acme").find((m) => m.to === "VALIDATING")
    expect(validating).toBeDefined()
    expect(validating!.weight).toBe("routine")
    expect(validating!.approvers).toBe(1)
    expect(validating!.typedConfirmation).toBeNull()
    expect(validating!.reversible).toBe(true)
    expect(validating!.demands).toMatch(/Nothing beyond your own authority/i)
  })

  test("routing real users at a new system is gated, and names each thing it demands", () => {
    // READY -> ACTIVATING is the approval map's own entry AND a C6, so it wants
    // a second identity and the tenant slug typed. Both must be visible before
    // the click, not discovered by being refused after it.
    const activating = permittedMoves("READY", "acme").find((m) => m.to === "ACTIVATING")
    expect(activating).toBeDefined()
    expect(activating!.weight).toBe("gated")
    expect(activating!.needsApproval).toBe(true)
    expect(activating!.approvers).toBe(2)
    expect(activating!.typedConfirmation).toBe("acme")
    expect(activating!.demands).toMatch(/second operator's identity/i)
    expect(activating!.demands).toMatch(/the exact text acme, typed/i)
  })

  test("a move that leaves nobody answering for the tenant demands a successor, and says why", () => {
    const offboarding = permittedMoves("ACTIVE", "acme").find((m) => m.to === "OFFBOARDING")
    expect(offboarding).toBeDefined()
    expect(offboarding!.needsOwner).toBe(true)
    expect(offboarding!.weight).not.toBe("routine")
    expect(offboarding!.demands).toMatch(/successor owner/i)
    expect(offboarding!.demands).toMatch(/answers for this tenant afterwards/i)
  })

  test("the one action with no undo is refused outright, and the command travels with the refusal", () => {
    const purging = permittedMoves("PURGE_PENDING", "acme").find((m) => m.to === "PURGING")
    expect(purging).toBeDefined()
    expect(purging!.weight).toBe("refused")
    expect(purging!.automatable).toBe(false)
    expect(purging!.reversible).toBe(false)
    expect(purging!.coolingOffMs).toBeGreaterThan(0)
    // The remedy names the real table and the real tenant. A refusal with no
    // handover is a dead end an operator works around.
    expect(purging!.insteadRunYourself).toContain("aws dynamodb")
    expect(purging!.insteadRunYourself).toContain("acme")
    expect(purging!.demands).toMatch(/refuses to perform it whatever the form says/i)
    // And it is not described as merely difficult.
    expect(purging!.demands).not.toMatch(/\bhard\b|\bcareful\b/i)
  })

  test("weights are ordered heaviest-last, so rendering in order separates them", () => {
    const outOfOrder = ALL_STATES.filter((from) => {
      const ranks = permittedMoves(from, "acme").map((m) => m.rank)
      return ranks.some((rank, i) => i > 0 && rank < ranks[i - 1])
    })
    expect(outOfOrder).toEqual([])

    // And the heaviest really does land last, rather than the order being
    // vacuously correct because every move happens to weigh the same.
    const fromPurgePending = permittedMoves("PURGE_PENDING", "acme")
    expect(new Set(fromPurgePending.map((m) => m.weight)).size).toBeGreaterThan(1)
    expect(fromPurgePending.at(-1)!.to).toBe("PURGING")
  })

  test("every weight has its own word, so one label is never a synonym for four", () => {
    const words = Object.values(WEIGHT_WORD)
    expect(new Set(words).size).toBe(words.length)
    for (const word of words) expect(word.trim().length).toBeGreaterThan(3)
  })

  /**
   * The assertion the whole group exists for.
   *
   * Every field is read from the engine for every edge in the graph, so a row
   * that stops agreeing with `classify`, `requirementsFor`, `needsApproval` or
   * `REQUIRES_OWNER` reds here rather than becoming a form that always refuses.
   */
  test("no row disagrees with the engine about any edge in the whole graph", () => {
    const disagreements: string[] = []
    let edges = 0

    for (const from of ALL_STATES) {
      for (const move of permittedMoves(from, "acme")) {
        edges += 1
        const edge = `${from} -> ${move.to}`
        const cls = classify({ surface: "tenant-lifecycle", action: move.to, target: "acme" })
        const req = requirementsFor(cls, "acme")

        if (move.changeClass !== cls) disagreements.push(`${edge}: class`)
        if (move.approvers !== req.approvers) disagreements.push(`${edge}: approvers`)
        if (move.typedConfirmation !== req.typedConfirmation) disagreements.push(`${edge}: token`)
        if (move.coolingOffMs !== req.coolingOffMs) disagreements.push(`${edge}: cooling off`)
        if (move.automatable !== req.automatable) disagreements.push(`${edge}: automatable`)
        if (move.needsApproval !== needsApproval(from, move.to)) {
          disagreements.push(`${edge}: approval`)
        }
        if (move.needsOwner !== REQUIRES_OWNER.has(move.to)) disagreements.push(`${edge}: owner`)
        // A move that demands something must say so; a demand sentence that is
        // empty is a cell an operator reads as "nothing required".
        if (move.demands.trim().length <= 20) disagreements.push(`${edge}: empty demands`)
      }
    }

    // An absence over an empty walk is not a finding. This is what tells the
    // two apart.
    expect(edges).toBeGreaterThan(50)
    expect(disagreements).toEqual([])
  })
})

/* ──────────────────────────────────────────────────── where it is ───────── */

/** A resource as the Tagging API produced it, with attribution decided by `tags.ts`. */
function tagged(arn: string, tags: Record<string, string>): TaggedResource {
  return { arn, tags, attribution: attributionOf(tags), problems: [] }
}

const forAcme = (arn: string) => tagged(arn, { "tenure:tenant": "acme" })

describe("what a tenant holds, attributed by tag", () => {
  test("another tenant's resources are not this tenant's, however they are named", () => {
    // The name trap, on purpose. `acme-staging` is a DIFFERENT customer and the
    // bucket named `acme-backups` belongs to it — a console that grouped by name
    // prefix would charge both to `acme`.
    const footprint = footprintOf(
      [
        forAcme("arn:aws:s3:::acme-primary"),
        tagged("arn:aws:s3:::acme-backups", { "tenure:tenant": "acme-staging" }),
        tagged("arn:aws:rds:us-east-1:111122223333:db:acme-db", {
          "tenure:tenant": "acme-staging",
        }),
      ],
      "acme",
    )

    expect(footprint.total).toBe(1)
    expect(footprint.services.map((s) => s.service)).toEqual(["s3"])
    expect(footprint.services[0].arns).toEqual(["arn:aws:s3:::acme-primary"])
  })

  test("a resource nobody claimed is counted separately and never folded into the tenant's", () => {
    const footprint = footprintOf(
      [
        forAcme("arn:aws:ecs:us-east-1:111122223333:service/prod/acme"),
        // No `tenure:tenant` key at all. This is the resource that cannot be
        // charged to anybody and cannot be found when a tenant is deleted.
        tagged("arn:aws:ec2:us-east-1:111122223333:natgateway/nat-1", {
          "tenure:environment": "production",
        }),
      ],
      "acme",
    )

    expect(footprint.total).toBe(1)
    expect(footprint.unattributable).toBe(1)
    expect(footprint.services.flatMap((s) => s.arns)).not.toContain(
      "arn:aws:ec2:us-east-1:111122223333:natgateway/nat-1",
    )
    expect(describeFootprint(footprint, "acme")).toMatch(/no tenure:tenant tag at all/i)
    expect(describeFootprint(footprint, "acme")).toMatch(/cannot be charged to anybody/i)
  })

  test("a deliberately shared resource is neither this tenant's nor an unattributable finding", () => {
    // `tenure:shared` is a decision somebody made. Counting it as unattributed
    // would report platform overhead as a tagging failure every time.
    const footprint = footprintOf(
      [
        forAcme("arn:aws:ecs:us-east-1:111122223333:service/prod/acme"),
        tagged("arn:aws:ec2:us-east-1:111122223333:natgateway/nat-1", {
          "tenure:tenant": "tenure:shared",
        }),
      ],
      "acme",
    )

    expect(footprint.total).toBe(1)
    expect(footprint.unattributable).toBe(0)
    expect(describeFootprint(footprint, "acme")).toMatch(/attributed to a tenant or marked shared/i)
  })

  test("resources group by the ARN's service field, and regions are read from the ARN", () => {
    const footprint = footprintOf(
      [
        forAcme("arn:aws:ecs:us-east-1:111122223333:service/prod/acme-web"),
        forAcme("arn:aws:ecs:eu-west-2:111122223333:service/prod/acme-worker"),
        forAcme("arn:aws:rds:us-east-1:111122223333:db:acme"),
        // S3 ARNs carry no region. Reported as such rather than as "global":
        // the bucket IS regional, the ARN simply does not say where.
        forAcme("arn:aws:s3:::acme-primary"),
      ],
      "acme",
    )

    expect(footprint.total).toBe(4)
    expect(footprint.services.map((s) => s.service)).toEqual(["ecs", "rds", "s3"])
    expect(footprint.services[0].count).toBe(2)
    expect(footprint.services[0].regions).toEqual(["eu-west-2", "us-east-1"])
    expect(footprint.services[2].regions).toEqual([REGION_NOT_IN_ARN])
    expect(footprint.services[2].regions).not.toContain("global")
  })

  test("an ARN this console cannot parse is still something the tenant is holding", () => {
    const footprint = footprintOf(
      [forAcme("arn:aws:ecs:us-east-1:111122223333:service/prod/acme"), forAcme("not-an-arn")],
      "acme",
    )

    // Counted, because it is billed whether or not this console can read it.
    expect(footprint.total).toBe(2)
    expect(footprint.unreadableArns).toEqual(["not-an-arn"])
    // And not filed under a service called "".
    expect(footprint.services.map((s) => s.service)).toEqual(["ecs"])
    expect(footprint.services.map((s) => s.service)).not.toContain("")
    expect(describeFootprint(footprint, "acme")).toMatch(/could not parse/i)
  })

  test("an estate with nothing for this tenant says so, and does not read as a failed read", () => {
    const footprint = footprintOf([], "acme")
    expect(footprint).toEqual({
      services: [],
      total: 0,
      unattributable: 0,
      unreadableArns: [],
    })
    expect(describeFootprint(footprint, "acme")).toMatch(
      /Nothing in this estate carries tenure:tenant=acme/,
    )
  })

  test("the same estate renders in the same order twice, so two readings can be compared", () => {
    const estate = [
      forAcme("arn:aws:rds:us-east-1:111122223333:db:acme"),
      forAcme("arn:aws:ecs:us-east-1:111122223333:service/prod/b"),
      forAcme("arn:aws:ecs:us-east-1:111122223333:service/prod/a"),
    ]
    expect(footprintOf(estate, "acme")).toEqual(footprintOf([...estate].reverse(), "acme"))
    expect(footprintOf(estate, "acme").services[0].arns).toEqual([
      "arn:aws:ecs:us-east-1:111122223333:service/prod/a",
      "arn:aws:ecs:us-east-1:111122223333:service/prod/b",
    ])
  })
})
