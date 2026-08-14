import { test, expect } from "@playwright/test"

import fs from "fs"
import path from "path"

import {
  computeAnswer,
  correlationFor,
  countsFor,
  exitCodeLine,
  imageSummary,
  rawStopReason,
  runtimeHeadline,
  statedAsOf,
  stoppedSummary,
  unknownArm,
  worstSeverity,
  type RegistryIndex,
  type StoppedTaskRow,
} from "../src/app/platform/compute/compute-answer"
import { classifyStopReason, type FleetState } from "../src/lib/aws/containers"

/**
 * What `/platform/compute` says, decided without a browser and without an estate.
 *
 * `layout.spec.ts` measures the page's geometry at 1440, 1180, 900 and 320 CSS
 * pixels and `preferences.spec.ts` measures its contrast; those two need a
 * running console and an operator secret. This one needs neither, because the
 * thing it is guarding is a SENTENCE rather than a rectangle: the ordering that
 * decides what the page leads with, and the three absences it must not print as
 * findings.
 *
 * `src/app/platform/compute/compute-answer.test.ts` drives the same functions
 * through the real AWS readers under this repository's jest. This spec drives
 * the branches that need no reader at all — the ordering itself, from
 * hand-built `FleetState` values — and asserts the source-file properties no
 * runtime test can see: that the route contains no colour literal, no Prisma
 * client, and no inline style.
 *
 * No AWS account, ARN, cluster, service, repository or function name in this
 * file is real, and no approval, review, certification or verification date is
 * recorded anywhere in it.
 */

/* ─────────────────────────────────────────────────────────── fixtures ──── */

const row = (over: Partial<StoppedTaskRow> = {}): StoppedTaskRow => ({
  key: "cluster::task",
  cluster: "tenure-prod",
  taskArn: "arn:aws:ecs:eu-west-2:123456789012:task/tenure-prod/aaaa1111",
  taskName: "aaaa1111",
  service: "tenure-prod-app",
  group: "service:tenure-prod-app",
  stoppedAt: "2026-08-13T08:50:00.000Z",
  startedAt: "2026-08-13T08:01:00.000Z",
  cause: { kind: "out-of-memory", raw: "OutOfMemoryError: Container killed due to memory usage" },
  stoppedReason: "OutOfMemoryError: Container killed due to memory usage",
  stopCode: "EssentialContainerExited",
  exitCodes: "app=137",
  exitCode: 137,
  incident: true,
  digests: [],
  ...over,
})

const steady = (over: Partial<Extract<FleetState, { kind: "steady" }>> = {}): FleetState => ({
  kind: "steady",
  clusters: 1,
  services: 2,
  runningTasks: 3,
  ...over,
})

const emptyIndex: RegistryIndex = {
  known: true,
  why: null,
  byDigest: new Map(),
  blind: [],
  unscanned: [],
}

/* ═══════════════════════════════════════════ 1. the order it decides in ══ */

test.describe("the lead answer, and the order it decides in", () => {
  /**
   * The one this whole route exists for.
   *
   * ECS replaces a task that dies, so a service that dies every ninety seconds
   * reports `running === desired` at almost every instant somebody looks. A
   * headline derived from the counts alone reads "Steady" while the estate is
   * on fire.
   */
  test("a steady count with tasks dying under it is never Steady", () => {
    const stops = stoppedSummary([row(), row({ key: "b", stoppedAt: "2026-08-13T08:40:00.000Z" })])
    expect(stops.incidents).toBe(2)

    const answer = computeAnswer(steady(), stops)
    expect(answer.verdict).toBe("Restarting")
    expect(answer.tone).toBe("bad")
    expect(answer.headline).toContain("crash-looping")
    expect(answer.because).toContain("tenure-prod-app")
  })

  test("a steady count with only deployments behind it is Steady", () => {
    const stops = stoppedSummary([
      row({
        incident: false,
        cause: { kind: "scaling", raw: "Scaling activity initiated by deployment ecs-svc/1234" },
      }),
    ])
    expect(stops.incidents).toBe(0)
    expect(stops.benign).toBe(1)

    const answer = computeAnswer(steady(), stops)
    expect(answer.verdict).toBe("Steady")
    expect(answer.tone).toBe("ok")
  })

  test("an unreadable cluster listing outranks everything, including a crash loop", () => {
    const answer = computeAnswer(
      { kind: "unknown", why: "unknown — this engine's role was refused ecs:ListClusters" },
      stoppedSummary([row()]),
    )
    expect(answer.verdict).toBe("Unknown")
    expect(answer.tone).toBe("warn")
    expect(answer.headline).toContain("Nothing is known")
    // And it never presents itself as an empty estate.
    expect(answer.headline).not.toContain("Nothing is running")
  })

  test("a shortfall nothing explains outranks one that stopped tasks account for", () => {
    const degraded: FleetState = {
      kind: "degraded",
      services: [
        {
          cluster: "tenure-prod",
          service: "tenure-prod-app",
          gap: {
            kind: "unexplained",
            desired: 3,
            running: 1,
            missing: 2,
            why: "2 task(s) short and NOTHING stopped in ECS's retention window.",
          },
        },
      ],
      unexplained: 1,
      unreadable: [],
    }
    const answer = computeAnswer(degraded, stoppedSummary([]))
    expect(answer.verdict).toBe("Not being placed")
    expect(answer.headline).toContain("scheduler is not placing them")
    expect(answer.because).toContain("tenure-prod/tenure-prod-app")
  })

  test("a degraded fleet outranks a crash loop, and still mentions the crash loop", () => {
    const degraded: FleetState = {
      kind: "degraded",
      services: [
        {
          cluster: "tenure-prod",
          service: "tenure-prod-app",
          gap: { kind: "explained", desired: 3, running: 2, missing: 1, incidents: [] },
        },
      ],
      unexplained: 0,
      unreadable: [],
    }
    const answer = computeAnswer(degraded, stoppedSummary([row()]))
    expect(answer.verdict).toBe("Short of tasks")
    expect(answer.because).toContain("1 task(s) stopped for a reason")
  })

  test("no reported gap plus an unreadable read is Unverified, not Steady", () => {
    const answer = computeAnswer(
      {
        kind: "unverified",
        why: "no service reported a gap, and 1 read(s) did not answer.",
        unreadable: ["tenure-prod: running tasks"],
        servicesConsidered: 2,
      },
      stoppedSummary([]),
    )
    expect(answer.verdict).toBe("Unverified")
    expect(answer.tone).toBe("warn")
    expect(answer.headline).toContain("could not look for is not a gap it did not find")
  })

  test("an account with no cluster is a fact about the estate, not a verdict", () => {
    const answer = computeAnswer({ kind: "no-clusters" }, stoppedSummary([]))
    expect(answer.verdict).toBe("Nothing deployed")
    expect(answer.tone).toBe("neutral")
    expect(answer.headline).toContain("not a statement about its health")
  })

  test("every verdict carries a headline, and no verdict is the empty string", () => {
    const fleets: FleetState[] = [
      { kind: "unknown", why: "refused" },
      { kind: "no-clusters" },
      { kind: "unverified", why: "why", unreadable: [], servicesConsidered: 0 },
      steady(),
    ]
    for (const fleet of fleets) {
      for (const stops of [stoppedSummary([]), stoppedSummary([row()])]) {
        const answer = computeAnswer(fleet, stops)
        expect(answer.verdict.length, JSON.stringify(fleet)).toBeGreaterThan(0)
        expect(answer.headline.length, JSON.stringify(fleet)).toBeGreaterThan(20)
      }
    }
  })
})

/* ═══════════════════════════════════════ 2. why anything stopped ═════════ */

test.describe("the reason ECS gave, carried rather than summarised", () => {
  test("a classified cause still carries ECS's verbatim string", () => {
    const cause = classifyStopReason(
      "OutOfMemoryError: Container killed due to memory usage",
      "EssentialContainerExited",
      137,
    )
    expect(cause.kind).toBe("out-of-memory")
    expect(rawStopReason(cause)).toBe("OutOfMemoryError: Container killed due to memory usage")
  })

  test("a stop ECS never explained has no verbatim string, and says so with null", () => {
    const cause = classifyStopReason(null, null, null)
    expect(cause.kind).toBe("unreported")
    // Null, not "". A page rendering an empty string would print a blank cell
    // where the most important fact on it was supposed to be.
    expect(rawStopReason(cause)).toBeNull()
  })

  test("exit codes name every container, including the ones ECS did not report", () => {
    expect(
      exitCodeLine([
        { name: "app", exitCode: 137 },
        { name: "log-router", exitCode: null },
      ]),
    ).toBe("app=137, log-router=unreported")
    // Zero is a real exit code. Printing it as "unreported" would hide a clean
    // exit inside a crash-loop table.
    expect(exitCodeLine([{ name: "app", exitCode: 0 }])).toBe("app=0")
  })

  test("an unreported stop is counted as something to act on", () => {
    const stops = stoppedSummary([
      row({
        cause: classifyStopReason(null, null, null),
        stoppedReason: null,
        incident: true,
      }),
    ])
    expect(stops.incidents).toBe(1)
    expect(computeAnswer(steady(), stops).verdict).toBe("Restarting")
  })
})

/* ═══════════════════════════════════ 3. the absences, kept apart ═════════ */

test.describe("three absences this page must not print as findings", () => {
  test("a refused registry listing makes no claim about any digest", () => {
    const index: RegistryIndex = {
      known: false,
      why: "unknown — this engine's role was refused ecr:DescribeRepositories",
      byDigest: new Map(),
      blind: [],
      unscanned: [],
    }
    const correlation = correlationFor(`sha256:${"a1".repeat(32)}`, index)
    expect(correlation.kind).toBe("registry-unreadable")
  })

  test("a repository whose images were refused is named, not silently excluded", () => {
    const index: RegistryIndex = { ...emptyIndex, blind: ["tenure-prod-app"] }
    const correlation = correlationFor(`sha256:${"a1".repeat(32)}`, index)
    expect(correlation.kind).toBe("not-found")
    if (correlation.kind === "not-found") {
      expect(correlation.why).toContain("tenure-prod-app")
      expect(correlation.why).toContain("not a statement")
    }
  })

  test("a digest genuinely absent says something different from one that is unreadable", () => {
    const absent = correlationFor(`sha256:${"a1".repeat(32)}`, emptyIndex)
    const blind = correlationFor(`sha256:${"a1".repeat(32)}`, { ...emptyIndex, blind: ["repo"] })
    expect(absent.kind).toBe("not-found")
    expect(blind.kind).toBe("not-found")
    // Same arm, provably different sentence. If these ever collapse into one
    // string, an operator can no longer tell a supply-chain question from an
    // IAM one.
    if (absent.kind === "not-found" && blind.kind === "not-found") {
      expect(absent.why).not.toBe(blind.why)
      expect(absent.why).not.toContain("did not answer")
    }
  })

  test("only a completed scan yields counts; nothing else yields a zero", () => {
    expect(countsFor({ kind: "clean", completedAt: null, source: "detail" })).not.toBeNull()
    expect(countsFor({ kind: "not-scanned", why: "scan on push is off" })).toBeNull()
    expect(
      countsFor({ kind: "scan-incomplete", status: "IN_PROGRESS", description: null, why: "running" }),
    ).toBeNull()
    expect(countsFor({ kind: "unknown", why: "refused" })).toBeNull()
  })

  test("an image with no counts is counted as unknown, never as clean", () => {
    const summary = imageSummary([
      {
        key: "a",
        digest: `sha256:${"a1".repeat(32)}`,
        usedBy: [],
        correlation: { kind: "matched", repositoryName: "repo" },
        repositoryName: "repo",
        repositoryUri: null,
        tags: [],
        pushedAt: null,
        scanOnPush: { kind: "disabled", why: "scan on push is off" },
        scanningOff: true,
        vulnerability: { kind: "not-scanned", why: "scan on push is off" },
        counts: null,
        total: null,
      },
    ])
    expect(summary.unknown).toBe(1)
    expect(summary.clean).toBe(0)
    expect(summary.vulnerable).toBe(0)
    expect(summary.unscanned).toBe(1)
  })

  test("the worst severity is CRITICAL-first, and null is not a clean bill", () => {
    expect(
      worstSeverity({ CRITICAL: 0, HIGH: 2, MEDIUM: 9, LOW: 0, INFORMATIONAL: 0, UNDEFINED: 0 }),
    ).toBe("HIGH")
    expect(
      worstSeverity({ CRITICAL: 1, HIGH: 2, MEDIUM: 9, LOW: 0, INFORMATIONAL: 0, UNDEFINED: 0 }),
    ).toBe("CRITICAL")
    expect(worstSeverity(null)).toBeNull()
  })

  test("a refused Lambda listing is never worded as zero deprecated functions", () => {
    const headline = runtimeHeadline({
      known: false,
      why: "unknown — this engine's role was refused lambda:ListFunctions",
      total: 0,
      deprecated: 0,
      approaching: 0,
      unknown: 0,
      supported: 0,
      containerImages: 0,
    })
    expect(headline).toContain("Nothing is known")
    expect(headline).not.toContain("All ")
    expect(headline).not.toContain("0 ")
  })

  test("every valueless arm of a reading renders through UnknownState", () => {
    for (const state of ["DENIED", "THROTTLED", "UNCONFIGURED", "ERROR"] as const) {
      expect(unknownArm({ state } as never), state).not.toBeNull()
    }
    for (const state of ["ACTUAL", "EMPTY", "STALE"] as const) {
      expect(unknownArm({ state } as never), state).toBeNull()
    }
  })

  test("every panel states when it was true", () => {
    expect(statedAsOf("What is running", "2026-08-13T09:00:00.000Z")).toBe(
      "What is running. As of 2026-08-13T09:00:00.000Z.",
    )
    expect(statedAsOf("What is running", null)).toContain("As of an unknown time")
  })
})

/* ═════════════════════════════════════ 4. what the source may contain ════ */

const ROUTE = path.join(__dirname, "..", "src", "app", "platform", "compute")
const readRoute = (file: string) => fs.readFileSync(path.join(ROUTE, file), "utf8")

test.describe("the route's source, and the two rules it is held to", () => {
  test("no colour lives in this route — every colour is a token role", () => {
    /*
     * One literal in one route file is a pair the contrast audit in
     * `md3-tokens-logic.spec.ts` cannot find, in the file nobody would point it
     * at. `--md-sys-color-*` is a ROLE and is allowed; a value is not.
     */
    const named =
      /\b(?:aqua|black|blue|brown|coral|crimson|cyan|fuchsia|gold|gray|grey|green|indigo|ivory|khaki|lime|magenta|maroon|navy|olive|orange|orchid|pink|plum|purple|red|salmon|silver|tan|teal|tomato|turquoise|violet|wheat|white|yellow)\b/i

    for (const file of ["page.tsx", "compute-answer.ts", "compute.module.css"]) {
      // Comments are prose and may name a colour; code and declarations may not.
      const source = readRoute(file)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1")

      expect(source, `${file} contains a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(source, `${file} contains an rgb()/hsl()/oklch()`).not.toMatch(
        /\b(?:rgba?|hsla?|oklch|oklab|color-mix)\s*\(/,
      )
      expect(source, `${file} contains a colour keyword`).not.toMatch(named)
      expect(source, `${file} carries an inline style`).not.toContain("style={{")
    }
  })

  test("the stylesheet sets no type, radius or shadow — those are the token layer's", () => {
    const css = readRoute("compute.module.css").replace(/\/\*[\s\S]*?\*\//g, " ")
    for (const forbidden of [
      "font-size",
      "font-weight",
      "letter-spacing",
      "border-radius",
      "box-shadow",
    ]) {
      expect(css, `compute.module.css sets ${forbidden}`).not.toContain(`${forbidden}:`)
    }
    // And it does not undo the closed-<details> rule `layout.spec.ts` depends on.
    expect(css).not.toMatch(/details:not\(\[open\]\)/)
  })

  test("long AWS identifiers wrap inside their column", () => {
    // A `sha256:` digest is 71 characters with no break opportunity. Without
    // this rule one cell sets the floor for the column's min-content width and
    // the page scrolls sideways at 320 CSS pixels — WCAG 2.2 AA 1.4.10 reflow,
    // measured by `layout.spec.ts`.
    const css = readRoute("compute.module.css")
    expect(css).toContain("overflow-wrap: anywhere")
    expect(readRoute("page.tsx")).toContain("styles.identifier")
  })

  test("no Prisma client reaches the operator plane", () => {
    // `tests/security/operator-plane-content.test.mjs` asserts this across the
    // Studio. Asserted here too, because this route is new.
    for (const file of ["page.tsx", "compute-answer.ts"]) {
      expect(readRoute(file)).not.toContain("@prisma/client")
      expect(readRoute(file)).not.toContain("@tenure/database")
    }
  })

  test("the surface reads AWS only through the readers, never through the SDK", () => {
    for (const file of ["page.tsx", "compute-answer.ts"]) {
      expect(readRoute(file), `${file} imports an AWS SDK package`).not.toContain("@aws-sdk/")
    }
  })

  test("the decisions are next door to the page, and the page imports them", () => {
    const page = readRoute("page.tsx")
    expect(page).toContain('from "./compute-answer"')
    expect(page).toContain("containerReadings")
    expect(page).toContain("ecrReadings")
    expect(page).toContain("lambdaInventory")
    // The question this route answers, in the operator's words, on the page.
    expect(page).toContain("What is running, what is it running, and why did anything stop?")
  })
})
