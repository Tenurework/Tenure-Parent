import { test, expect } from "@playwright/test"

import fs from "fs"
import path from "path"

import { ALARM_VERDICTS, ALARM_WORDS, type AlarmRow } from "../src/lib/aws/alarms"
import {
  VERDICT_RANK,
  VERDICT_TONE,
  asOf,
  countByVerdict,
  coverageOf,
  leadAnswer,
  partitionAlarms,
  provenanceOf,
  readAnswered,
  statedAsOf,
} from "../src/app/platform/health/answer"

/**
 * What `/platform/health` says, decided without a browser and without an estate.
 *
 * `layout.spec.ts` measures the page's geometry and `aws-unknown-is-not-absent.spec.ts`
 * proves the alarm SURFACE — this proves the sentence the page leads with, which
 * is the part neither of those can see. The failure it exists to catch is a page
 * that reads "healthy" while four alarms have their actions switched off:
 * `lib/aws/alarms.ts` already decided that DISABLED outranks OK for one row, and
 * a headline derived from "is anything in ALARM" would undo that decision one
 * level up, in a file nobody would think to point the alarm suite at.
 *
 * No browser, no server, no AWS. `answer.ts` imports nothing but types.
 */

const row = (over: Partial<AlarmRow> = {}): AlarmRow => ({
  name: "tenure-alb-5xx",
  verdict: "OK",
  detail: "in OK.",
  type: "MetricAlarm",
  ...over,
})

/* ═══════════════════════════════════════════════════ 1. the lead answer ══ */

test.describe("the lead answer, and the order it decides in", () => {
  test("a read that did not answer is UNKNOWN, never healthy and never empty", () => {
    // Every arm of `AwsRead` that carries no value. A page that derived its
    // headline from `rows.length === 0` would call each of these an estate
    // with nothing wrong.
    for (const state of ["DENIED", "THROTTLED", "UNCONFIGURED", "ERROR"]) {
      const answer = leadAnswer(state, [])
      expect(answer.verdict, `${state} should not be answerable`).toBe("Unknown")
      expect(answer.tone).toBe("warn")
      expect(answer.headline).toContain("Nothing is known")
      expect(answer.because).toContain(state)
      expect(readAnswered(state)).toBe(false)
    }
    for (const state of ["ACTUAL", "STALE", "EMPTY"]) {
      expect(readAnswered(state), `${state} carries an answer`).toBe(true)
    }
  })

  test("a firing alarm outranks everything else on the page", () => {
    const answer = leadAnswer("ACTUAL", [
      row({ name: "a", verdict: "ALARM" }),
      row({ name: "b", verdict: "DISABLED" }),
      row({ name: "c", verdict: "MISSING" }),
      row({ name: "d", verdict: "STALE" }),
    ])
    expect(answer.verdict).toBe("Firing")
    expect(answer.tone).toBe("bad")
    expect(answer.headline).toContain("1 alarm is firing")
  })

  /**
   * The one this whole module exists for.
   *
   * Four alarms, none of them firing, all four either muted or never created.
   * CloudWatch calls three of them OK. A headline keyed on `ALARM` reads
   * "healthy"; this one does not, and says which half is which.
   */
  test("muted and never-created alarms are not a healthy page", () => {
    const answer = leadAnswer("ACTUAL", [
      row({ name: "a", verdict: "DISABLED" }),
      row({ name: "b", verdict: "DISABLED" }),
      row({ name: "c", verdict: "MISSING", type: "expected" }),
      row({ name: "d", verdict: "OK" }),
    ])
    expect(answer.verdict).toBe("Nobody would be told")
    expect(answer.tone).toBe("bad")
    expect(answer.headline).toContain("3 alarms would not tell anybody")
    expect(answer.because).toContain("1 declared in the estate's Terraform")
    expect(answer.because).toContain("2 that exist with their actions switched off")
  })

  test("stale and no-data are uncertain rather than healthy, and rank below muted", () => {
    const uncertain = leadAnswer("ACTUAL", [
      row({ name: "a", verdict: "STALE" }),
      row({ name: "b", verdict: "INSUFFICIENT_DATA" }),
      row({ name: "c", verdict: "OK" }),
    ])
    expect(uncertain.verdict).toBe("Not certain")
    expect(uncertain.tone).toBe("warn")
    expect(uncertain.headline).toContain("2 alarms are not reporting")

    // Add one muted alarm and the page must stop saying "not certain".
    const muted = leadAnswer("ACTUAL", [
      row({ name: "a", verdict: "STALE" }),
      row({ name: "b", verdict: "INSUFFICIENT_DATA" }),
      row({ name: "c", verdict: "DISABLED" }),
    ])
    expect(muted.verdict).toBe("Nobody would be told")
  })

  test("a successful read of zero alarms is unmonitored, not healthy", () => {
    const answer = leadAnswer("EMPTY", [])
    expect(answer.verdict).toBe("Nothing is watching")
    expect(answer.tone).toBe("warn")
    expect(answer.headline).toContain("no alarms at all")
    expect(answer.because).toContain("real absence")
    // The specific confusion: an unmonitored account and a clean one.
    expect(answer.verdict).not.toBe("Healthy")
  })

  test("healthy is only ever said about alarms that were actually found", () => {
    const answer = leadAnswer("ACTUAL", [
      row({ name: "a", verdict: "OK" }),
      row({ name: "b", verdict: "OK" }),
    ])
    expect(answer.verdict).toBe("Healthy")
    expect(answer.tone).toBe("ok")
    expect(answer.headline).toContain("All 2 alarms")
  })
})

/* ════════════════════════════════════════════════ 2. counting + sorting ══ */

test.describe("counting and grouping", () => {
  test("every verdict is counted, and the tally covers the whole vocabulary", () => {
    const counts = countByVerdict([
      row({ name: "a", verdict: "ALARM" }),
      row({ name: "b", verdict: "ALARM" }),
      row({ name: "c", verdict: "OK" }),
    ])
    expect(counts.ALARM).toBe(2)
    expect(counts.OK).toBe(1)
    // A verdict added to `alarms.ts` and forgotten here would be undefined,
    // and `undefined + 1` is NaN — which renders as "NaN Firing".
    for (const verdict of ALARM_VERDICTS) {
      expect(Number.isFinite(counts[verdict]), `${verdict} is not counted`).toBe(true)
    }
  })

  test("the split is 'not OK', so a verdict added later cannot hide in the quiet half", () => {
    const rows = ALARM_VERDICTS.map((verdict, i) => row({ name: `alarm-${i}`, verdict }))
    const { attention, quiet } = partitionAlarms(rows)
    expect(quiet.map((r) => r.verdict)).toEqual(["OK"])
    expect(attention.length).toBe(ALARM_VERDICTS.length - 1)
    expect(attention.some((r) => r.verdict === "OK")).toBe(false)
  })

  test("worst first, then by name — the same estate draws the same page twice", () => {
    const rows = [
      row({ name: "z-stale", verdict: "STALE" }),
      row({ name: "a-ok", verdict: "OK" }),
      row({ name: "m-missing", verdict: "MISSING" }),
      row({ name: "b-alarm", verdict: "ALARM" }),
      row({ name: "a-missing", verdict: "MISSING" }),
    ]
    const forward = partitionAlarms(rows).attention.map((r) => r.name)
    const reversed = partitionAlarms([...rows].reverse()).attention.map((r) => r.name)
    expect(forward).toEqual(["b-alarm", "a-missing", "m-missing", "z-stale"])
    expect(reversed).toEqual(forward)
  })

  test("every verdict has a rank and a tone, and no tone is the only carrier", () => {
    for (const verdict of ALARM_VERDICTS) {
      expect(VERDICT_RANK, `${verdict} has no rank`).toContain(verdict)
      expect(VERDICT_TONE[verdict], `${verdict} has no tone`).toBeTruthy()
      expect(ALARM_WORDS[verdict], `${verdict} has no word`).toBeTruthy()
    }
    expect(VERDICT_RANK.length).toBe(ALARM_VERDICTS.length)
    // Bible §26.3.2 — the desaturated palette means a tone repeats; the word
    // is what must not.
    expect(new Set(Object.values(ALARM_WORDS)).size).toBe(ALARM_VERDICTS.length)
  })
})

/* ═══════════════════════════════════════════════════════════ 3. coverage ══ */

test.describe("coverage says when it does not know", () => {
  test("no declaration is 'not known', never 'nothing is missing'", () => {
    const coverage = coverageOf([], [row()], "ACTUAL")
    expect(coverage.known).toBe(false)
    expect(coverage.missing).toBe(0)
    expect(coverage.because).toContain("NAME_PREFIX")
    expect(coverage.because).toContain("cloudwatch.tf")
  })

  test("a refused read cannot produce a coverage figure at all", () => {
    const coverage = coverageOf(["tenure-alb-5xx"], [], "DENIED")
    expect(coverage.known).toBe(false)
    expect(coverage.present).toBe(0)
    expect(coverage.because).toContain("did not answer")
  })

  test("declared against found, from a successful response", () => {
    const coverage = coverageOf(
      ["tenure-alb-5xx", "tenure-dlq", "tenure-rds-cpu"],
      [
        row({ name: "tenure-alb-5xx", verdict: "OK" }),
        row({ name: "tenure-dlq", verdict: "OK" }),
        row({ name: "tenure-rds-cpu", verdict: "MISSING", type: "expected" }),
      ],
      "ACTUAL",
    )
    expect(coverage).toEqual({
      known: true,
      declared: 3,
      present: 2,
      missing: 1,
      because: null,
    })
  })
})

/* ═════════════════════════════════════════════════ 4. as-of + provenance ══ */

test.describe("every panel says when, and names its unknowns", () => {
  test("an as-of that is not known is a finding, not an empty string", () => {
    expect(asOf(null)).toContain("unknown time")
    expect(asOf("")).toContain("unknown time")
    expect(asOf("2026-08-13T00:00:00.000Z")).toBe("As of 2026-08-13T00:00:00.000Z.")
    expect(statedAsOf("What this is", "2026-08-13T00:00:00.000Z")).toBe(
      "What this is. As of 2026-08-13T00:00:00.000Z.",
    )
    // One full stop, not two.
    expect(statedAsOf("What this is.", null)).toContain("What this is. As of an unknown time")
  })

  test("with no identity, provenance prints the reason rather than a default estate", () => {
    const facts = provenanceOf({
      identityState: "DENIED",
      accountId: null,
      region: null,
      partition: null,
      principal: null,
      readState: "DENIED",
      refreshMs: 60_000,
      asOf: null,
    })
    const byLabel = Object.fromEntries(facts.map((f) => [f.label, f.value]))
    for (const label of ["Account", "Region", "Partition", "As"]) {
      expect(byLabel[label], `${label} invented a value`).toContain("Not known")
      expect(byLabel[label]).toContain("sts:GetCallerIdentity came back DENIED")
    }
    // The residency defect this whole console is built against.
    expect(JSON.stringify(facts)).not.toContain("us-east-1")
    expect(byLabel["Refreshed"]).toBe("every 60s")
    expect(byLabel["This reading"]).toContain("unknown time")
  })

  test("with an identity, provenance prints what STS answered", () => {
    const facts = provenanceOf({
      identityState: "ACTUAL",
      accountId: "047385673922",
      region: "eu-west-1",
      partition: "aws-us-gov",
      principal: "arn:aws-us-gov:sts::047385673922:assumed-role/studio/task",
      readState: "ACTUAL",
      refreshMs: 60_000,
      asOf: "2026-08-13T00:00:00.000Z",
    })
    const byLabel = Object.fromEntries(facts.map((f) => [f.label, f.value]))
    expect(byLabel["Region"]).toBe("eu-west-1")
    expect(byLabel["Partition"]).toBe("aws-us-gov")
    expect(byLabel["Account"]).toBe("047385673922")
    expect(byLabel["As"]).toContain("assumed-role/studio/task")
  })
})

/* ══════════════════════════════════════════════ 5. the page's own rules ══ */

const HEALTH_DIR = path.join(__dirname, "..", "src", "app", "platform", "health")
const readHealth = (file: string) => fs.readFileSync(path.join(HEALTH_DIR, file), "utf8")

test.describe("the surface consumes the design system rather than forking it", () => {
  test("the page still calls the live surface with a falsifiable expectation", () => {
    // The assertion `aws-unknown-is-not-absent.spec.ts` also makes. Repeated
    // here because this is the file that restructured the page, and a
    // restructure that dropped the expected set would make MISSING unreachable
    // while every layout check stayed green.
    const page = readHealth("page.tsx")
    expect(page).toContain("await alarmSurface(")
    expect(page).toContain("expectedAlarmNames()")
  })

  /**
   * The half of the page's question that CloudWatch cannot answer.
   *
   * "Is it us or is it AWS" is answered from `health:DescribeEvents` and from
   * nothing else, and the failure this guards is silent: drop the call and the
   * page still renders, every layout check stays green, and the AWS card
   * quietly becomes an unreadable-forever panel — or disappears — while an
   * operator reads a firing alarm as this estate's fault during somebody
   * else's outage.
   *
   * The identity hand-over is asserted for a second reason: `resolveIdentity`
   * caches only an ACTUAL answer, so an estate where STS is unreachable — the
   * estate this console must keep booting in — pays for two failing STS calls
   * per load without it, and the two surfaces can name different accounts.
   */
  test("the page asks AWS about itself, on the identity the alarm read already resolved", () => {
    const page = readHealth("page.tsx")
    expect(page).toContain("await awsHealthSurface(")
    expect(page).toContain("identity: surface.identity")
    // The question itself, in the operator's words, above the apparatus.
    expect(page).toContain("Is anything broken right now, and is it us or is it AWS?")
  })

  test("the page imports the MD3 primitives and hand-rolls none of them", () => {
    const page = readHealth("page.tsx")
    expect(page).toContain('from "@/components/md3"')
    for (const primitive of [
      "Card",
      "Badge",
      "DataTable",
      "EmptyState",
      "Chip",
      // The shared AWS-reading set. `KeyValue` replaced this route's own
      // two-column `<dl>` and the media query that stacked it at 320 CSS
      // pixels; `UnknownState` replaced the older `AwsReadPanel` markup, so a
      // refused read on this page prints the same principal, action, error code
      // and pasteable statement as every other AWS-backed surface.
      "KeyValue",
      "StaleIndicator",
      "UnknownState",
    ]) {
      expect(page, `${primitive} is not used`).toContain(primitive)
    }
    // The ad-hoc class strings this page carried before.
    for (const legacy of ['className="system"', 'className="slug"', 'className="grid"', "inline-verdict"]) {
      expect(page, `${legacy} survived the conversion`).not.toContain(legacy)
    }
  })

  test("neither the page nor its stylesheet contains a literal colour", () => {
    /*
     * The rule `docs/architecture/studio-design-system.md` states, applied to a
     * route rather than to a primitive: a colour here is a pair
     * `md3-tokens-logic.spec.ts` cannot find, in the file nobody would point it
     * at. `--md-sys-color-*` is a ROLE and is allowed; a value is not.
     */
    const named = /\b(?:aqua|black|blue|brown|coral|crimson|cyan|fuchsia|gold|gray|grey|green|indigo|ivory|khaki|lime|magenta|maroon|navy|olive|orange|orchid|pink|plum|purple|red|salmon|silver|tan|teal|tomato|turquoise|violet|wheat|white|yellow)\b/i

    for (const file of ["page.tsx", "answer.ts", "health.module.css"]) {
      // Comments are prose and may say "green"; code and declarations may not.
      const source = readHealth(file)
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
    const css = readHealth("health.module.css").replace(/\/\*[\s\S]*?\*\//g, " ")
    for (const forbidden of ["font-size", "font-weight", "letter-spacing", "border-radius", "box-shadow"]) {
      expect(css, `health.module.css sets ${forbidden}`).not.toContain(`${forbidden}:`)
    }
    // And it does not undo the closed-<details> rule `layout.spec.ts` depends on.
    expect(css).not.toMatch(/details:not\(\[open\]\)/)
  })

  test("no Prisma client reaches the operator plane", () => {
    // `tests/security/operator-plane-content.test.mjs` asserts this across the
    // Studio; asserted here too because this route was rewritten wholesale.
    for (const file of ["page.tsx", "answer.ts"]) {
      expect(readHealth(file)).not.toContain("@prisma/client")
    }
  })
})

/* ═══════════════════════ 6. the subtraction: what nothing is watching ══ */

/**
 * The join `lib/aws/dashboards.ts` and `lib/aws/logs.ts` were each built to make
 * possible and neither can perform.
 *
 * `dashboards.ts` knows what every widget REFERENCES and does not know what
 * exists. `logs.ts` knows every log group and every metric filter and never
 * opens a dashboard. `alarms.ts` knows every alarm by name and knows nothing
 * about either. The subtraction is the only place the estate's blind spots
 * become a value, and it is also the only place a set difference can be taken
 * against an incomplete set and produce a confident lie — so most of what
 * follows is about the refusals rather than about the findings.
 *
 * Node level, no browser, no estate: `watch.ts` imports one function and a
 * handful of types, and the readers dynamically import `client.ts` rather than
 * loading the SDK at module scope.
 */

import {
  CANDIDATES_WHY,
  FRESHNESS_TONE,
  FRESHNESS_WORD,
  RETENTION_TONE,
  RETENTION_WORD,
  SILENCE_WINDOW_MS,
  WATCH_TONE,
  WATCH_WORD,
  dashboardCensus,
  emittedNamespaces,
  formatBytes,
  retentionCensus,
  silenceCensus,
  silenceWarning,
  watchHeadline,
  watchJoin,
} from "../src/app/platform/health/watch"
import {
  classifyEncryption,
  classifyLogGroupSensitivity,
  classifyRetention,
  type LastEventAge,
  type LogGroupReading,
  type LogsReadings,
  type MetricFilter,
} from "../src/lib/aws/logs"
import type {
  DashboardContent,
  DashboardCoverage,
  DashboardReadings,
  DashboardRow,
} from "../src/lib/aws/dashboards"
import type { AwsRead } from "../src/lib/aws/read"

const AT = "2026-08-13T12:00:00.000Z"

/** A refusal in the exact shape `read.ts` produces, so a fixture cannot drift. */
const denied = <T,>(capability: string, action: string): AwsRead<T> =>
  ({
    state: "DENIED",
    capability,
    action,
    principal: "arn:aws:sts::047385673922:assumed-role/studio/task",
    accountId: "047385673922",
    region: "eu-west-1",
    partition: "aws",
    errorCode: "AccessDeniedException",
    minimumStatement: `{"Effect":"Allow","Action":"${action}","Resource":"*"}`,
  }) as AwsRead<T>

const unconfigured = <T,>(capability: string, why: string): AwsRead<T> =>
  ({ state: "UNCONFIGURED", capability, why }) as AwsRead<T>

const actual = <T,>(capability: string, value: T): AwsRead<T> =>
  ({ state: "ACTUAL", capability, value, asOf: AT, fresh: true }) as AwsRead<T>

const filter = (namespace: string, metricName = "ErrorCount"): MetricFilter => ({
  filterName: `to-${namespace}-${metricName}`,
  filterPattern: "?ERROR",
  logGroupName: null,
  createdAt: AT,
  transformations: [{ metricName, metricNamespace: namespace, metricValue: "1", defaultValue: null }],
})

/**
 * One log group, in the exact shape `logGroupReadings` returns.
 *
 * Retention, encryption and sensitivity go through the reader's OWN classifiers
 * rather than being hand-written objects, so the fixture cannot drift into a
 * shape production never produces — which is how a test of a subtraction stays
 * green on the day the subtraction stops working.
 */
const group = (
  name: string,
  over: {
    retentionInDays?: number
    filters?: AwsRead<readonly MetricFilter[]>
    lastEvent?: LastEventAge
    storedBytes?: number | null
    kmsKeyId?: string
  } = {},
): LogGroupReading => ({
  logGroupName: name,
  arn: `arn:aws:logs:eu-west-1:047385673922:log-group:${name}`,
  arnProvenance: "the log group ARN AWS returned, with the trailing marker removed",
  region: "eu-west-1",
  partition: "aws",
  accountId: "047385673922",
  attribution: { kind: "shared" },
  retention: classifyRetention(over.retentionInDays),
  encryption: classifyEncryption(over.kmsKeyId),
  sensitivity: classifyLogGroupSensitivity(name),
  storedBytes: over.storedBytes === undefined ? 1024 : over.storedBytes,
  createdAt: AT,
  logGroupClass: "STANDARD",
  dataProtectionStatus: null,
  metricFilters: {
    declaredCount: null,
    filters: over.filters ?? { state: "EMPTY", capability: "logs:DescribeMetricFilters", asOf: AT },
    provenance: "logs:DescribeMetricFilters, paged to the end",
    discrepancy: null,
  },
  lastEvent: over.lastEvent ?? { state: "NOT_PROBED", why: "no probeSilenceWindowMs was given." },
  refreshMs: 60_000,
  asOf: AT,
})

const logsOf = (groups: AwsRead<readonly LogGroupReading[]>): LogsReadings => ({
  identity: unconfigured("sts:GetCallerIdentity", "not needed by this fixture"),
  tagged: unconfigured("tag:GetResources", "not needed by this fixture"),
  groups,
  completeness: { kind: "complete", pagesWalked: 1 },
  asOf: AT,
  refreshMs: { groups: 60_000, metricFilters: 300_000, events: 60_000 },
})

const dashboardRow = (name: string, content: DashboardContent): DashboardRow => ({
  name,
  arn: `arn:aws:cloudwatch::047385673922:dashboard/${name}`,
  lastModified: AT,
  sizeBytes: 400,
  content,
  attribution: { kind: "shared" },
  region: "eu-west-1",
  partition: "aws",
  accountId: "047385673922",
  refreshMs: 300_000,
  asOf: AT,
})

const dashboardsOf = (
  coverage: DashboardCoverage,
  rows: readonly DashboardRow[] = [],
): DashboardReadings => ({
  identity: unconfigured("sts:GetCallerIdentity", "not needed by this fixture"),
  tagged: unconfigured("tag:GetResources", "not needed by this fixture"),
  dashboards:
    rows.length > 0
      ? actual("cloudwatch:ListDashboards", rows)
      : { state: "EMPTY", capability: "cloudwatch:ListDashboards", asOf: AT },
  coverage,
  truncation: { kind: "complete" },
  asOf: AT,
  refreshMs: 300_000,
})

const complete = (
  over: Partial<Extract<DashboardCoverage, { kind: "complete" }>> = {},
): DashboardCoverage => ({
  kind: "complete",
  namespaces: [],
  alarmNames: [],
  logGroups: [],
  ...over,
})

const partialCoverage = (over: { alarmNames?: readonly string[] } = {}): DashboardCoverage => ({
  kind: "partial",
  namespaces: [],
  alarmNames: over.alarmNames ?? [],
  logGroups: [],
  incompleteDashboards: ["tenure-ops"],
  why: "this coverage set is INCOMPLETE, so nothing can be concluded: tenure-ops: its body was not read.",
})

const subtract = (input: {
  groups?: AwsRead<readonly LogGroupReading[]>
  coverage?: DashboardCoverage
  alarms?: readonly AlarmRow[]
  alarmState?: string
}) =>
  watchJoin({
    logs: logsOf(input.groups ?? actual("logs:DescribeLogGroups", [])),
    dashboards: dashboardsOf(input.coverage ?? complete()),
    alarmRows: input.alarms ?? [],
    alarmReadState: input.alarmState ?? "ACTUAL",
  })

/* ── the log-group half of the subtraction ─────────────────────────────── */

test.describe("a log group is unwatched only when that can actually be established", () => {
  test("nothing reads it and nothing measures it — the finding", () => {
    const result = subtract({
      groups: actual("logs:DescribeLogGroups", [group("/aws/lambda/importer")]),
    })
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].verdict).toBe("UNWATCHED")
    expect(result.unwatched).toBe(1)
    expect(result.groups[0].detail).toContain("no metric filter turns a line in it into a metric")
    expect(result.decidable).toBe(true)
  })

  test("a dashboard that queries it by name is watching it", () => {
    const result = subtract({
      groups: actual("logs:DescribeLogGroups", [group("/ecs/tenure-prod")]),
      coverage: complete({ logGroups: ["/ecs/tenure-prod"] }),
    })
    expect(result.groups[0].verdict).toBe("WATCHED")
    expect(result.unwatched).toBe(0)
    expect(result.groups[0].detail).toContain("queries this group by name")
  })

  /**
   * The second mechanism, and the one a name-only join misses: no widget
   * mentions the group, but a metric filter on it emits into a namespace a
   * widget plots. The sentence names the namespace, because "it is watched" with
   * no reason is a claim nobody can check.
   */
  test("a metric filter feeding a namespace a dashboard draws is also watching it", () => {
    const result = subtract({
      groups: actual("logs:DescribeLogGroups", [
        group("/aws/lambda/importer", {
          filters: actual("logs:DescribeMetricFilters", [filter("Tenure/Importer")]),
        }),
      ]),
      coverage: complete({ namespaces: ["Tenure/Importer"] }),
    })
    expect(result.groups[0].verdict).toBe("WATCHED")
    expect(result.groups[0].detail).toContain("Tenure/Importer")
    expect(result.groups[0].detail).toContain("which a dashboard draws")
  })

  test("a filter emitting into a namespace nobody plots is still unwatched, and says which", () => {
    const result = subtract({
      groups: actual("logs:DescribeLogGroups", [
        group("/aws/lambda/importer", {
          filters: actual("logs:DescribeMetricFilters", [filter("Tenure/Importer")]),
        }),
      ]),
      coverage: complete({ namespaces: ["AWS/ECS"] }),
    })
    expect(result.groups[0].verdict).toBe("UNWATCHED")
    expect(result.groups[0].detail).toContain("Tenure/Importer")
    expect(result.namespaces.kind).toBe("decidable")
    if (result.namespaces.kind === "decidable") {
      expect(result.namespaces.namespaces).toEqual(["Tenure/Importer"])
    }
  })

  /**
   * The dangerous direction, per group.
   *
   * `logs.ts` returns UNCONFIGURED — never EMPTY — for groups past its own
   * metric-filter budget, precisely so "this group has no filters" and "nobody
   * read this group's filters" stay apart. Collapsing them here is one `?? []`,
   * and it would report a measured group as watched by nothing.
   */
  test("filters that were not read make it undecidable, never unwatched", () => {
    for (const filters of [
      denied<readonly MetricFilter[]>("logs:DescribeMetricFilters", "logs:DescribeMetricFilters"),
      unconfigured<readonly MetricFilter[]>(
        "logs:DescribeMetricFilters",
        "past the 100-group budget",
      ),
    ]) {
      const result = subtract({
        groups: actual("logs:DescribeLogGroups", [group("/aws/lambda/importer", { filters })]),
      })
      expect(result.groups[0].verdict).toBe("UNDECIDABLE")
      expect(result.unwatched).toBe(0)
      expect(result.groups[0].detail).toContain("not the same as its feeding none")
    }
  })

  /**
   * The dangerous direction, for the whole load.
   *
   * A group on a dashboard nobody was allowed to open must not be reported as
   * unwatched — somebody would go and build a second dashboard for it. Partial
   * coverage therefore makes every group UNDECIDABLE and the load undecidable.
   */
  test("an incomplete coverage set cannot produce a single unwatched row", () => {
    const result = subtract({
      groups: actual("logs:DescribeLogGroups", [
        group("/ecs/tenure-prod"),
        group("/aws/lambda/importer"),
      ]),
      coverage: partialCoverage(),
    })
    expect(result.unwatched).toBe(0)
    expect(result.undecidable).toBe(2)
    expect(result.decidable).toBe(false)
    expect(result.because).toContain("INCOMPLETE")
    for (const item of result.groups) {
      expect(item.verdict).toBe("UNDECIDABLE")
      expect(item.detail).toContain("is not a claim this load can make")
    }
  })

  test("dashboards that were not read at all cannot make anything unwatched", () => {
    const result = subtract({
      groups: actual("logs:DescribeLogGroups", [group("/ecs/tenure-prod")]),
      coverage: {
        kind: "not-read",
        why: "cloudwatch:ListDashboards was refused (AccessDeniedException).",
      },
    })
    expect(result.groups[0].verdict).toBe("UNDECIDABLE")
    expect(result.groups[0].detail).toContain("AccessDeniedException")
    expect(result.decidable).toBe(false)
  })

  /**
   * The defect a live render of this page found, before it was fixed.
   *
   * With `logs:DescribeLogGroups` failing, every count is 0 and the card printed
   * "0 of 0 — no dashboard queries them", which is the most reassuring sentence
   * on the page and describes an estate nobody looked at. `groupsKnown` is the
   * flag that stops the counts being rendered at all, and it is separate from
   * `decidable` because a load can have a perfectly complete dashboard coverage
   * set and no log groups to subtract from it.
   */
  test("a refused log-group read produces no rows, no counts and no reassurance", () => {
    const result = subtract({ groups: denied("logs:DescribeLogGroups", "logs:DescribeLogGroups") })
    expect(result.groups).toEqual([])
    expect(result.unwatched).toBe(0)
    expect(result.groupsKnown).toBe(false)
    expect(result.groupsBecause).toContain("logs:DescribeLogGroups")
    expect(result.decidable).toBe(false)
    expect(result.because).toContain("logs:DescribeLogGroups")
    expect(watchHeadline(result).tone).not.toBe("ok")
  })

  test("a successful read of an account with no log group IS a denominator", () => {
    const result = subtract({
      groups: { state: "EMPTY", capability: "logs:DescribeLogGroups", asOf: AT },
    })
    expect(result.groupsKnown).toBe(true)
    expect(result.groupsBecause).toBeNull()
    expect(result.unwatched).toBe(0)
  })

  test("a silent group carries that into the subtraction rather than losing it", () => {
    const result = subtract({
      groups: actual("logs:DescribeLogGroups", [
        group("/aws/lambda/importer", {
          lastEvent: {
            state: "SILENT",
            forAtLeastMs: SILENCE_WINDOW_MS,
            silentSince: AT,
            why: "stopped.",
            asOf: AT,
          },
        }),
      ]),
    })
    expect(result.groups[0].silent).toBe(true)
    expect(result.groups[0].detail).toContain("received nothing in the last 24 hours")
  })

  test("the finding sorts first, and the same estate draws the same table twice", () => {
    /*
     * The names are deliberately in the OPPOSITE order to the verdicts, so a
     * comparator that lost its rank term and fell back to sorting by name
     * cannot produce the expected array by accident. An earlier version of this
     * fixture named them alphabetically in rank order and a mutation that
     * deleted the rank survived it.
     */
    const rows = [
      group("a-watched"),
      group("c-unwatched"),
      group("b-undecidable", {
        filters: denied<readonly MetricFilter[]>(
          "logs:DescribeMetricFilters",
          "logs:DescribeMetricFilters",
        ),
      }),
      group("d-unwatched"),
    ]
    const coverage = complete({ logGroups: ["a-watched"] })
    const forward = subtract({
      groups: actual("logs:DescribeLogGroups", rows),
      coverage,
    }).groups.map((r) => r.logGroupName)
    const reversed = subtract({
      groups: actual("logs:DescribeLogGroups", [...rows].reverse()),
      coverage,
    }).groups.map((r) => r.logGroupName)
    expect(forward).toEqual(["c-unwatched", "d-unwatched", "b-undecidable", "a-watched"])
    expect(reversed).toEqual(forward)
  })

  test("every watch verdict has a word and a tone, and no two words are the same", () => {
    const verdicts = ["WATCHED", "UNWATCHED", "UNDECIDABLE"] as const
    for (const verdict of verdicts) {
      expect(WATCH_WORD[verdict], `${verdict} has no word`).toBeTruthy()
      expect(WATCH_TONE[verdict], `${verdict} has no tone`).toBeTruthy()
    }
    expect(new Set(verdicts.map((v) => WATCH_WORD[v])).size).toBe(verdicts.length)
    expect(WATCH_TONE.UNDECIDABLE).not.toBe(WATCH_TONE.WATCHED)
  })
})

/* ── the alarm half of the subtraction ─────────────────────────────────── */

test.describe("alarms against the dashboards that are supposed to show them", () => {
  const shown = complete({ alarmNames: ["tenure-alb-5xx", "tenure-deleted-alarm"] })

  test("an alarm on no dashboard, and a dashboard naming an alarm that is gone", () => {
    const result = subtract({
      coverage: shown,
      alarms: [
        row({ name: "tenure-alb-5xx", verdict: "OK" }),
        row({ name: "tenure-dlq-depth", verdict: "OK" }),
      ],
    })
    expect(result.alarms.decidable).toBe(true)
    expect(result.alarms.existing).toBe(2)
    expect(result.alarms.onNoDashboard).toEqual(["tenure-dlq-depth"])
    // The widget pointing at nothing. On a wall it renders as an empty box,
    // which reads as "not firing".
    expect(result.alarms.referencedAndAbsent).toEqual(["tenure-deleted-alarm"])
  })

  /**
   * MISSING and the two synthesised surface rows are NOT alarms that exist.
   * Counting them would make a declared-and-never-created alarm look like one a
   * dashboard is happily showing, and would empty the second list.
   */
  test("a MISSING alarm is not an alarm this account has", () => {
    const result = subtract({
      coverage: complete({ alarmNames: ["tenure-rds-cpu"] }),
      alarms: [
        row({ name: "tenure-rds-cpu", verdict: "MISSING", type: "expected" }),
        row({ name: "every alarm in this account", verdict: "UNREADABLE", type: "surface" }),
      ],
    })
    expect(result.alarms.existing).toBe(0)
    expect(result.alarms.referencedAndAbsent).toEqual(["tenure-rds-cpu"])
    expect(result.alarms.onNoDashboard).toEqual([])
  })

  test("a refused alarm read makes both lists unstatable rather than empty", () => {
    const result = subtract({ coverage: shown, alarms: [], alarmState: "DENIED" })
    expect(result.alarms.decidable).toBe(false)
    expect(result.alarms.because).toContain("does not know which alarms exist")
    expect(result.alarms.onNoDashboard).toEqual([])
    expect(result.alarms.referencedAndAbsent).toEqual([])
    expect(result.decidable).toBe(false)
  })

  test("partial coverage keeps the shortlist but refuses to call it a finding", () => {
    const result = subtract({
      coverage: partialCoverage({ alarmNames: ["tenure-alb-5xx"] }),
      alarms: [row({ name: "tenure-alb-5xx" }), row({ name: "tenure-dlq-depth" })],
    })
    expect(result.alarms.decidable).toBe(false)
    expect(result.alarms.onNoDashboard).toEqual(["tenure-dlq-depth"])
    expect(result.alarms.because).toContain("INCOMPLETE")
  })
})

/* ── the namespace half, reusing the reader's own arithmetic ───────────── */

test.describe("namespaces this estate emits into, against the ones anybody draws", () => {
  test("the candidate set comes from the estate's own metric filters", () => {
    const groups = actual<readonly LogGroupReading[]>("logs:DescribeLogGroups", [
      group("/a", {
        filters: actual("logs:DescribeMetricFilters", [filter("Tenure/B"), filter("Tenure/A")]),
      }),
      group("/b", { filters: actual("logs:DescribeMetricFilters", [filter("Tenure/A")]) }),
    ])
    // Deduped, in code-unit order, so two loads of one estate render alike.
    expect(emittedNamespaces(groups)).toEqual(["Tenure/A", "Tenure/B"])
    // A refused listing contributes no candidates and, crucially, no claim.
    expect(emittedNamespaces(denied("logs:DescribeLogGroups", "logs:DescribeLogGroups"))).toEqual([])
  })

  test("partial coverage makes the namespace difference undecidable, not empty", () => {
    const result = subtract({
      groups: actual("logs:DescribeLogGroups", [
        group("/a", { filters: actual("logs:DescribeMetricFilters", [filter("Tenure/A")]) }),
      ]),
      coverage: partialCoverage(),
    })
    expect(result.namespaces.kind).toBe("undecidable")
    if (result.namespaces.kind === "undecidable") {
      expect(result.namespaces.notOnAnyDashboardRead).toEqual(["Tenure/A"])
    }
  })
})

/* ── the headline the card leads with ──────────────────────────────────── */

test.describe("the subtraction's own one-line answer", () => {
  test("a blind spot is loud and names what was found", () => {
    const headline = watchHeadline(
      subtract({
        groups: actual("logs:DescribeLogGroups", [group("/aws/lambda/importer")]),
        coverage: complete({ alarmNames: ["tenure-gone"] }),
        alarms: [row({ name: "tenure-alb-5xx" })],
      }),
    )
    expect(headline.tone).toBe("bad")
    expect(headline.verdict).toBe("Blind spots")
    expect(headline.sentence).toContain("1 log group(s) nothing reads")
    expect(headline.sentence).toContain("this account does not have")
  })

  test("nothing found and nothing knowable is never the same as nothing wrong", () => {
    const headline = watchHeadline(
      subtract({
        groups: actual("logs:DescribeLogGroups", []),
        coverage: { kind: "not-read", why: "cloudwatch:ListDashboards was refused." },
      }),
    )
    expect(headline.tone).toBe("warn")
    expect(headline.verdict).toBe("Not known")
    expect(headline.sentence).toContain("cannot say what nothing is watching")
  })

  test("all accounted for is only said when every subtraction was decidable", () => {
    const headline = watchHeadline(
      subtract({
        groups: actual("logs:DescribeLogGroups", [group("/ecs/tenure-prod")]),
        coverage: complete({ logGroups: ["/ecs/tenure-prod"], alarmNames: ["tenure-alb-5xx"] }),
        alarms: [row({ name: "tenure-alb-5xx" })],
      }),
    )
    expect(headline.tone).toBe("ok")
    expect(headline.verdict).toBe("All accounted for")
  })

  test("the candidate set is described on the page rather than assumed", () => {
    // The sentence that stops "3 things are unwatched" reading as a claim about
    // the whole fleet.
    expect(CANDIDATES_WHY).toContain("log groups this account holds")
    expect(CANDIDATES_WHY).toContain("is not being claimed to be watched")
  })
})

/* ── retention, bytes, keys and silence ────────────────────────────────── */

test.describe("the log-group posture, counted rather than averaged", () => {
  test("an absent retentionInDays is Never expires — a finding, not a setting", () => {
    const census = retentionCensus(
      actual("logs:DescribeLogGroups", [
        group("/a"),
        group("/b", { retentionInDays: 1 }),
        group("/c", { retentionInDays: 30 }),
      ]),
    )
    expect(census.known).toBe(true)
    expect(census.neverExpires).toBe(1)
    expect(census.tooShort).toBe(1)
    expect(census.retained).toBe(1)
    expect(RETENTION_WORD["never-expires"]).toBe("Never expires")
    // Both misretentions are loud, and they are wrong in opposite directions.
    expect(RETENTION_TONE["never-expires"]).toBe("bad")
    expect(RETENTION_TONE["too-short"]).toBe("bad")
    expect(RETENTION_TONE.retained).toBe("ok")
  })

  test("a group AWS reported no size for is counted apart, never added as zero", () => {
    const census = retentionCensus(
      actual("logs:DescribeLogGroups", [
        group("/a", { storedBytes: 2048 }),
        group("/b", { storedBytes: null }),
      ]),
    )
    expect(census.storedBytes).toBe(2048)
    expect(census.groupsNotReportingBytes).toBe(1)
    expect(formatBytes(2048)).toContain("2.0 KiB")
    expect(formatBytes(2048)).toContain("2048 bytes")
  })

  test("a refused listing is not an account with nothing in it", () => {
    const census = retentionCensus(denied("logs:DescribeLogGroups", "logs:DescribeLogGroups"))
    expect(census.known).toBe(false)
    expect(census.because).toContain("logs:DescribeLogGroups")
    // Every count is zero AND `known` is false. A caller that read the counts
    // without the flag would print an estate with no log groups in it.
    expect(census.groups).toBe(0)
  })

  test("a successful read of an account with no log group IS knowable", () => {
    const census = retentionCensus({
      state: "EMPTY",
      capability: "logs:DescribeLogGroups",
      asOf: AT,
    })
    expect(census.known).toBe(true)
    expect(census.because).toBeNull()
  })

  test("a customer key and the AWS-owned key are counted apart", () => {
    const census = retentionCensus(
      actual("logs:DescribeLogGroups", [
        group("/a"),
        group("/b", { kmsKeyId: "arn:aws:kms:eu-west-1:047385673922:key/abc" }),
        group("/ecs/tenure-prod"),
      ]),
    )
    expect(census.withoutCustomerKey).toBe(2)
    // The name-based marker, which is explicitly not a claim about content.
    expect(census.markedTenantData).toBe(1)
  })

  test("silence and a probe that was never made are different words with different tones", () => {
    const census = silenceCensus(
      actual("logs:DescribeLogGroups", [
        group("/silent", {
          lastEvent: {
            state: "SILENT",
            forAtLeastMs: SILENCE_WINDOW_MS,
            silentSince: AT,
            why: "the thing that writes to this group has stopped.",
            asOf: AT,
          },
        }),
        group("/live", {
          lastEvent: {
            state: "RECEIVING",
            windowMs: SILENCE_WINDOW_MS,
            mostRecentSeenAt: AT,
            ageMsUpperBound: 1000,
            asOf: AT,
          },
        }),
        group("/refused", { lastEvent: { state: "UNREADABLE", why: "the probe was refused." } }),
        group("/skipped"),
      ]),
    )
    expect(census.silent).toBe(1)
    expect(census.receiving).toBe(1)
    expect(census.unreadable).toBe(1)
    expect(census.notProbed).toBe(1)
    expect(census.silentGroups).toEqual(["/silent"])
    // The distinction the whole probe exists for: a refused probe and a skipped
    // probe must not render as a service that has gone quiet.
    expect(FRESHNESS_TONE.SILENT).toBe("bad")
    expect(FRESHNESS_TONE.UNREADABLE).not.toBe(FRESHNESS_TONE.SILENT)
    expect(FRESHNESS_TONE.NOT_PROBED).not.toBe(FRESHNESS_TONE.SILENT)
    expect(new Set(Object.values(FRESHNESS_WORD)).size).toBe(4)
  })

  test("a stopped writer is a sentence on the lead card, and nothing else is", () => {
    const silent = silenceCensus(
      actual("logs:DescribeLogGroups", [
        group("/ecs/tenure-prod", {
          lastEvent: {
            state: "SILENT",
            forAtLeastMs: SILENCE_WINDOW_MS,
            silentSince: AT,
            why: "stopped.",
            asOf: AT,
          },
        }),
      ]),
    )
    const sentence = silenceWarning(silent)
    expect(sentence).toContain("/ecs/tenure-prod")
    expect(sentence).toContain("same flat line as having none")
    // Nothing silent, and a refused read, both produce no sentence — the second
    // because a probe that did not happen is not an observation of quiet.
    expect(silenceWarning(silenceCensus(actual("logs:DescribeLogGroups", [group("/a")])))).toBeNull()
    expect(
      silenceWarning(silenceCensus(denied("logs:DescribeLogGroups", "logs:DescribeLogGroups"))),
    ).toBeNull()
  })

  test("the dashboards are counted by what their bodies turned out to be", () => {
    const census = dashboardCensus(
      actual("cloudwatch:ListDashboards", [
        dashboardRow("tenure-ops", {
          kind: "watching",
          widgets: [],
          namespaces: ["AWS/ECS"],
          alarmNames: [],
          logGroups: [],
          regions: [],
          unresolved: [],
        }),
        dashboardRow("tenure-emptied", { kind: "watching-nothing", why: "no widgets." }),
        dashboardRow("tenure-refused", {
          kind: "not-read",
          why: "cloudwatch:GetDashboard was refused.",
        }),
      ]),
    )
    expect(census.known).toBe(true)
    expect(census.total).toBe(3)
    expect(census.watching).toBe(1)
    // A dashboard somebody emptied and one nobody could open are different
    // rows, and neither is a dashboard that is watching something.
    expect(census.watchingNothing).toBe(1)
    expect(census.unknownContent).toBe(1)
    expect(census.lastChanged).toBe(AT)
  })

  test("a refused dashboard listing is not an account with no dashboards", () => {
    const census = dashboardCensus(denied("cloudwatch:ListDashboards", "cloudwatch:ListDashboards"))
    expect(census.known).toBe(false)
    expect(census.total).toBe(0)
    expect(census.because).toContain("cloudwatch:ListDashboards")
  })
})

/* ── the reachability guard: the readers must be reached by the PAGE ───── */

test.describe("the two dark readers are reached by a real production caller", () => {
  /**
   * The failure this whole slice exists against.
   *
   * `dashboards.ts` and `logs.ts` were tested, granted and correct, and no page
   * imported either — so the work they do reached no screen. A refactor that
   * dropped the calls would leave every layout check green, every unit test
   * green, and the surface silently back in the dark. This asserts the calls
   * themselves, on the file that has to make them.
   */
  test("the page calls both readers, and asks logs for the silence probe", () => {
    const page = readHealth("page.tsx")
    expect(page).toContain("await dashboardReadings(")
    expect(page).toContain("await logGroupReadings(")
    expect(page).toContain("probeSilenceWindowMs: SILENCE_WINDOW_MS")
    // The join, which is the only reason either reader belongs on this page.
    expect(page).toContain("watchJoin({")
  })

  test("a refused read on either new panel renders through the shared UnknownState", () => {
    const page = readHealth("page.tsx")
    for (const arm of ["unknownArm(dashboards.dashboards)", "unknownArm(logs.groups)"]) {
      expect(page, `${arm} is not narrowed`).toContain(arm)
    }
    // Both panels reach the shared component rather than a sentence this route
    // wrote for itself.
    expect(page).toContain('what="the log groups in this account"')
    expect(page).toContain('what="the CloudWatch dashboards in this account"')
  })

  /**
   * Three panels on the unwatched card print a COUNT or the word "none", and a
   * live render with both readers failing showed all three of them reassuring:
   * "0 of 0 log groups are unwatched", "none — every group was compared against
   * a complete coverage set", "none — every alarm a widget names was in the
   * DescribeAlarms response". Each is guarded by the flag from the side of the
   * join that would have to have answered for it to be true.
   */
  test("no panel prints a count or a 'none' the reads did not earn", () => {
    const page = readHealth("page.tsx")
    // The two log-group counts, guarded on the listing having answered.
    expect((page.match(/!join\.groupsKnown/g) ?? []).length).toBeGreaterThanOrEqual(2)
    /*
     * BOTH alarm panels, guarded. Counted rather than merely present: the
     * on-no-dashboard panel was already guarded, so a `toContain` check passed
     * while the dangling-alarm panel beside it printed "none" for a refused
     * read — which is exactly the mutation this assertion has to catch.
     */
    expect((page.match(/!join\.alarms\.decidable/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(page).toContain("not decidable —")
  })

  test("the page never reads AWS itself — the reader is the only path to the SDK", () => {
    const page = readHealth("page.tsx")
    for (const forbidden of ["@aws-sdk/", "liveGateway", "new CloudWatch"]) {
      expect(page, `${forbidden} reaches the page`).not.toContain(forbidden)
    }
  })

  test("watch.ts obeys the same rules as the rest of the route", () => {
    const named =
      /\b(?:aqua|black|blue|brown|coral|crimson|cyan|fuchsia|gold|gray|grey|green|indigo|ivory|khaki|lime|magenta|maroon|navy|olive|orange|orchid|pink|plum|purple|red|salmon|silver|tan|teal|tomato|turquoise|violet|wheat|white|yellow)\b/i
    const source = readHealth("watch.ts")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    expect(source, "watch.ts contains a hex colour").not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source, "watch.ts contains a colour keyword").not.toMatch(named)
    expect(source).not.toContain("@prisma/client")
    // Pure: the decisions are data, so this suite can drive them with no estate.
    expect(source).not.toContain("liveGateway")
    expect(source).not.toContain("@aws-sdk/")
  })
})
