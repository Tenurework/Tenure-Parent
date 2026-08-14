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
