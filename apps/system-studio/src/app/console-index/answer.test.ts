/**
 * The console index's verdict, proven against the real drift engine.
 *
 * `apps/system-studio` has no jest of its own; its unit tests are collected by
 * `apps/web`'s runner, whose `roots` include `<rootDir>/../system-studio/src`.
 * Run from the repository root:
 *
 *     npm run test --workspace apps/web -- --ci apps/system-studio/src/app/console-index/answer.test.ts
 *
 * ## What is deliberately NOT faked here
 *
 * `DriftReport` is never hand-built. Every report below comes out of the real
 * `desiredFromDeployment` → `compareDesiredToActual` pair that `page.tsx`
 * calls, driven by real `AwsRead` values. A fixture report would agree with
 * whatever this module happened to expect — and the specific defect being
 * guarded against is a page that reports agreement because a read was refused,
 * which is a property of how `compareDesiredToActual` marks blind surfaces, not
 * of a literal somebody typed into a test.
 *
 * The one thing that is constructed by hand is the `AwsRead` union itself, and
 * that is the input side: a DENIED reading is what a refused describe becomes,
 * and building one is how a denial gets into the test at all without an AWS
 * account.
 */

import { compareDesiredToActual, desiredFromDeployment } from "../../lib/aws/drift"
import type { EstateResource } from "../../lib/aws/inventory"
import type { AwsRead } from "../../lib/aws/read"

import {
  UNKNOWN,
  fleetAnswer,
  placementOf,
  unknownSurfaces,
  type FootprintAnswer,
  type PlacementInput,
  type RegistryAnswer,
  type SystemPlacement,
} from "./answer"

const NOW = new Date("2026-08-13T09:30:00.000Z")
const ASOF = NOW.toISOString()

type Reading = AwsRead<readonly EstateResource[]>

/** A surface that answered and holds nothing. An answer, not a refusal. */
function empty(capability: Reading["capability"]): Reading {
  return { state: "EMPTY", capability, asOf: ASOF }
}

/** A surface this engine was not allowed to look at. */
function denied(capability: Reading["capability"], action: string): Reading {
  return {
    state: "DENIED",
    capability,
    action,
    principal: "arn:aws:sts::000000000000:assumed-role/studio/task",
    accountId: "000000000000",
    region: "us-east-1",
    partition: "aws",
    errorCode: "AccessDeniedException",
    minimumStatement: `{"Effect":"Allow","Action":"${action}","Resource":"*"}`,
  }
}

const ALL_EMPTY: Reading[] = [
  empty("ecs:ListServices"),
  empty("rds:DescribeDBInstances"),
  empty("cloudfront:ListDistributions"),
  empty("acm:ListCertificates"),
]

/** The comparison `page.tsx` performs, run for real. */
function compare(
  input: { slug: string; serving: boolean; isolation: string },
  actual: readonly Reading[],
): FootprintAnswer {
  return {
    compared: true,
    report: compareDesiredToActual(
      desiredFromDeployment({
        slug: input.slug,
        serving: input.serving,
        isolation: input.isolation,
        ownerSeat: input.isolation === "pooled" ? "platform" : `tenant-lead:${input.slug}`,
      }),
      actual,
      { now: NOW, slug: input.slug },
    ),
  }
}

function registered(over: Partial<{
  state: string
  isolation: string
  hasDeployment: boolean
  serving: boolean
}> = {}): RegistryAnswer {
  return {
    known: true,
    record: {
      state: "ACTIVE",
      isolation: "pooled",
      hasDeployment: true,
      serving: true,
      cellId: "cell-us-east-1-a",
      region: "us-east-1",
      ...over,
    },
  }
}

function input(over: Partial<PlacementInput> = {}): PlacementInput {
  return {
    slug: "rochester",
    displayName: "Simon Business School — Ainslie OSE",
    blueprint: { id: "university-student-organizations", version: "3" },
    baseUrl: "https://platform.tenurework.com",
    registry: registered(),
    footprint: compare({ slug: "rochester", serving: true, isolation: "pooled" }, ALL_EMPTY),
    ...over,
  }
}

/* ───────────────────────────────────────────────────────── the six verdicts */

describe("placementOf — a system is in exactly one bucket, and unknown is one of them", () => {
  test("a blueprint that does not exist is broken, and nothing below it is claimed", () => {
    const placement = placementOf(input({ blueprint: null }))

    expect(placement.verdict).toBe("broken")
    expect(placement.blueprint).toBe(UNKNOWN)
    expect(placement.lifecycle).toBe(UNKNOWN)
    // The registry was NOT consulted for a system this build cannot describe,
    // and the row says so rather than showing a state it did not read.
    expect(placement.lifecycleBecause).toContain("blueprint did not resolve")
    expect(placement.footprint).toContain("Not compared")
  })

  test("a registry that did not answer is UNKNOWN, never agreement", () => {
    const registry: RegistryAnswer = {
      known: false,
      because: "The registry did not answer: ResourceNotFoundException.",
      fix: "Set TENANT_TABLE.",
    }
    const placement = placementOf(input({ registry }))

    expect(placement.verdict).toBe("unknown")
    expect(placement.lifecycle).toBe(UNKNOWN)
    // Both halves travel to the row: what happened, and what would fix it.
    expect(placement.lifecycleBecause).toContain("ResourceNotFoundException")
    expect(placement.lifecycleBecause).toContain("TENANT_TABLE")
    // AWS is not asked when nothing can say what should be there. The sentence
    // says that, rather than reporting an estate with nothing in it.
    expect(placement.footprint).toContain("Not compared")
    expect(placement.footprint).not.toContain("Every declared resource was found")
  })

  test("a registry that answered and holds nothing is unregistered, not unknown", () => {
    const placement = placementOf(input({ registry: { known: true, record: null } }))

    // The pair a console usually loses. "Never registered" is actionable;
    // "could not be read" is not, and they must not share a word.
    expect(placement.verdict).toBe("unregistered")
    expect(placement.lifecycle).toBe("not registered")
    expect(placement.lifecycle).not.toBe(UNKNOWN)
    expect(placement.lifecycleBecause).toContain("answered")
  })

  test("registered with no deployment expects nothing in AWS, and says so", () => {
    const placement = placementOf(
      input({ registry: registered({ state: "PROVISIONING", hasDeployment: false }) }),
    )

    expect(placement.verdict).toBe("awaiting-deployment")
    expect(placement.lifecycle).toBe("PROVISIONING")
    expect(placement.lifecycleBecause).toBe("")
    expect(placement.footprint).toContain("no deployment artifact")
    expect(placement.disagreements).toEqual([])
  })

  test("a serving deployment whose ECS service is not in AWS is drifted, with an owner", () => {
    const placement = placementOf(
      input({
        footprint: compare({ slug: "rochester", serving: true, isolation: "pooled" }, ALL_EMPTY),
      }),
    )

    expect(placement.verdict).toBe("drifted")
    expect(placement.disagreements).toHaveLength(1)
    expect(placement.disagreements[0]).toMatchObject({
      resourceKey: "ecs:service/rochester",
      severity: "serving",
      owner: "platform",
    })
    expect(placement.because).toContain("1 resource")
    expect(placement.footprint).toContain("1 declared resource not found in AWS")
  })

  test("a refused ECS read is UNKNOWN, and is NOT reported as a missing service", () => {
    const placement = placementOf(
      input({
        footprint: compare({ slug: "rochester", serving: true, isolation: "pooled" }, [
          denied("ecs:ListServices", "ecs:ListServices"),
          ...ALL_EMPTY.slice(1),
        ]),
      }),
    )

    // This is the whole point of the module. A denied describe produces a drift
    // item with severity `unknown`; folding that into `drifted` would send an
    // operator to recreate a service that may be running, and folding it into
    // `agrees` would report a fleet nobody looked at as healthy.
    expect(placement.verdict).toBe("unknown")
    expect(placement.disagreements).toEqual([])
    expect(placement.partial).toBe(true)
    expect(placement.because).toContain(UNKNOWN)
    expect(placement.footprint).toContain("could not be checked at all")
  })

  test("everything declared, everything found, nothing refused — agrees", () => {
    // A pooled tenant that does not serve declares nothing, and all four
    // surfaces answered. That is the only shape that may say the two agree.
    const placement = placementOf(
      input({
        registry: registered({ serving: false }),
        footprint: compare({ slug: "rochester", serving: false, isolation: "pooled" }, ALL_EMPTY),
      }),
    )

    expect(placement.verdict).toBe("agrees")
    expect(placement.partial).toBe(false)
    expect(placement.footprint).toContain("Every declared resource was found in AWS")
  })

  test("a partial estate read is UNKNOWN even when nothing was found missing", () => {
    const placement = placementOf(
      input({
        registry: registered({ serving: false }),
        footprint: compare({ slug: "rochester", serving: false, isolation: "pooled" }, [
          denied("acm:ListCertificates", "acm:ListCertificates"),
          ...ALL_EMPTY.slice(0, 3),
        ]),
      }),
    )

    // Nothing was declared, so nothing could be missing — and a surface still
    // did not answer. "0 problems found" over an estate half of which was
    // refused is the reassuring default this console refuses to print.
    expect(placement.verdict).toBe("unknown")
    expect(placement.partial).toBe(true)
  })

  test("an estate that could not be reached at all is UNKNOWN, carrying the reason", () => {
    const footprint: FootprintAnswer = {
      compared: false,
      because: `The AWS estate could not be read, so whether this system's footprint matches is ${UNKNOWN}: Region is missing.`,
    }
    const placement = placementOf(input({ footprint }))

    expect(placement.verdict).toBe("unknown")
    expect(placement.footprint).toContain("Region is missing")
  })
})

/* ─────────────────────────────────────────────────────────── the two facts */

describe("placementOf — the address, and the refusal to invent one", () => {
  test("the URL is the cell's base address joined to the slug, with no double slash", () => {
    expect(placementOf(input({ baseUrl: "https://platform.tenurework.com/" })).url).toBe(
      "https://platform.tenurework.com/rochester",
    )
    expect(placementOf(input({ baseUrl: "https://platform.tenurework.com" })).url).toBe(
      "https://platform.tenurework.com/rochester",
    )
  })

  test("no base address renders UNKNOWN and names what to set — never a guessed host", () => {
    const placement = placementOf(input({ baseUrl: null }))

    expect(placement.url).toBe(UNKNOWN)
    expect(placement.urlBecause).toContain("CELL_BASE_URL")
    expect(placement.url).not.toContain("http")
  })

  test("a registry row with no lifecycle state is a malformed record, not a system at rest", () => {
    const placement = placementOf(input({ registry: registered({ state: "" }) }))

    expect(placement.lifecycle).toBe(UNKNOWN)
    expect(placement.lifecycleBecause).toContain("malformed")
  })
})

/* ─────────────────────────────────────────────────────── the leading line */

describe("fleetAnswer — the one line, and the arithmetic underneath it", () => {
  function placementsOf(...verdicts: SystemPlacement["verdict"][]): SystemPlacement[] {
    return verdicts.map((verdict, i) => {
      switch (verdict) {
        case "broken":
          return placementOf(input({ slug: `s${i}`, blueprint: null }))
        case "unknown":
          return placementOf(
            input({
              slug: `s${i}`,
              registry: { known: false, because: "no answer", fix: "set TENANT_TABLE" },
            }),
          )
        case "unregistered":
          return placementOf(input({ slug: `s${i}`, registry: { known: true, record: null } }))
        case "awaiting-deployment":
          return placementOf(
            input({ slug: `s${i}`, registry: registered({ hasDeployment: false }) }),
          )
        case "drifted":
          return placementOf(
            input({
              slug: `s${i}`,
              footprint: compare({ slug: `s${i}`, serving: true, isolation: "pooled" }, ALL_EMPTY),
            }),
          )
        case "agrees":
          return placementOf(
            input({
              slug: `s${i}`,
              registry: registered({ serving: false }),
              footprint: compare({ slug: `s${i}`, serving: false, isolation: "pooled" }, ALL_EMPTY),
            }),
          )
      }
    })
  }

  test("the buckets partition the fleet — the counts always add up to the total", () => {
    const placements = placementsOf(
      "agrees",
      "drifted",
      "unknown",
      "unregistered",
      "awaiting-deployment",
      "broken",
    )
    const answer = fleetAnswer(placements)

    expect(answer.total).toBe(6)
    const summed = Object.values(answer.counts).reduce((a, b) => a + b, 0)
    expect(summed).toBe(answer.total)
    expect(answer.counts).toEqual({
      agrees: 1,
      drifted: 1,
      unknown: 1,
      unregistered: 1,
      "awaiting-deployment": 1,
      broken: 1,
    })
  })

  test("a system that could not be read is NAMED in the sentence, never dropped", () => {
    const answer = fleetAnswer(placementsOf("agrees", "agrees", "unknown"))

    expect(answer.sentence).toContain("Of 3 configured systems")
    expect(answer.sentence).toContain(UNKNOWN)
    expect(answer.sentence).toContain("1 could not be read")
    // The failure this whole module exists to prevent.
    expect(answer.sentence).not.toContain("All 3")
    expect(answer.tone).toBe("warn")
  })

  test("only a fleet where every system agrees may say so", () => {
    const answer = fleetAnswer(placementsOf("agrees", "agrees"))

    expect(answer.sentence).toBe(
      "All 2 configured systems are where the registry says they should be.",
    )
    expect(answer.tone).toBe("ok")
  })

  test("one system reads as a singular sentence, not '1 systems'", () => {
    expect(fleetAnswer(placementsOf("agrees")).sentence).toBe(
      "All 1 configured system is where the registry says it should be.",
    )
    expect(fleetAnswer(placementsOf("unregistered")).sentence).toBe(
      "Of 1 configured system: 1 is not in the registry at all.",
    )
  })

  test("drift and a broken blueprint are bad; not-yet-deployed alone is not", () => {
    expect(fleetAnswer(placementsOf("drifted")).tone).toBe("bad")
    expect(fleetAnswer(placementsOf("broken")).tone).toBe("bad")
    expect(fleetAnswer(placementsOf("awaiting-deployment")).tone).toBe("warn")
  })

  test("an empty fleet says it is empty rather than saying everything is fine", () => {
    const answer = fleetAnswer([])

    expect(answer.total).toBe(0)
    expect(answer.tone).not.toBe("ok")
    expect(answer.sentence).toContain("No organization system is configured")
  })
})

/* ─────────────────────────────────────────────── the refusals, grouped once */

describe("unknownSurfaces — every refusal named, each remedy printed once", () => {
  test("four surfaces refused for one reason are one panel naming all four", () => {
    const groups = unknownSurfaces([
      { what: "ECS services", read: denied("ecs:ListServices", "ecs:ListServices") },
      { what: "databases", read: denied("ecs:ListServices", "ecs:ListServices") },
      { what: "edge distributions", read: denied("ecs:ListServices", "ecs:ListServices") },
      { what: "certificates", read: denied("ecs:ListServices", "ecs:ListServices") },
    ])

    expect(groups).toHaveLength(1)
    // Grouped, and still complete: no surface is dropped on the way in.
    expect(groups[0].what).toBe("ECS services, databases, edge distributions and certificates")
    expect(groups[0].read.state).toBe("DENIED")
  })

  test("two different refusals stay two panels, because the remedies differ", () => {
    const groups = unknownSurfaces([
      { what: "ECS services", read: denied("ecs:ListServices", "ecs:ListServices") },
      {
        what: "certificates",
        read: { state: "THROTTLED", capability: "acm:ListCertificates", retryAfterMs: 400, asOf: ASOF },
      },
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.read.state).sort()).toEqual(["DENIED", "THROTTLED"])
  })

  test("a surface that answered is not a refusal — including one that answered EMPTY", () => {
    const groups = unknownSurfaces([
      { what: "ECS services", read: empty("ecs:ListServices") },
      {
        what: "databases",
        read: {
          state: "ACTUAL",
          capability: "rds:DescribeDBInstances",
          value: [],
          asOf: ASOF,
          fresh: true,
        },
      },
      {
        what: "certificates",
        read: { state: "STALE", capability: "acm:ListCertificates", value: [], asOf: ASOF, ageMs: 10 },
      },
    ])

    // EMPTY is an answer. Rendering it as a refusal is the same confusion in
    // the opposite direction, and it would put a pasteable IAM statement under
    // a surface whose policy is already correct.
    expect(groups).toEqual([])
  })

  test("an ERROR and an UNCONFIGURED are both carried, with their own words", () => {
    const groups = unknownSurfaces([
      {
        what: "edge distributions",
        read: { state: "ERROR", capability: "cloudfront:ListDistributions", code: "TimeoutError", safeDetail: "socket hang up" },
      },
      {
        what: "certificates",
        read: { state: "UNCONFIGURED", capability: "acm:ListCertificates", why: "no region is set" },
      },
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.what).sort()).toEqual(["certificates", "edge distributions"])
  })
})
