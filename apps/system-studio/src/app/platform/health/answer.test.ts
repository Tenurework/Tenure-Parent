import type { HealthEventRow, HealthVerdict } from "../../../lib/aws/aws-health"
import type { AlarmRow } from "../../../lib/aws/alarms"
import type { AwsRead } from "../../../lib/aws/read"

import {
  HEALTH_TONE,
  SECTIONS,
  WHOSE_WORD,
  awsSide,
  fleetVerdict,
  leadAnswer,
  provenanceOf,
  sectionOrder,
  unknownArm,
  type AwsSide,
} from "./answer"

/**
 * The second half of `/platform/health`'s question — "is it us or is it AWS" —
 * decided without a browser, a server or an estate.
 *
 * `e2e/health-page-logic.spec.ts` proves the alarm-side ordering, which is the
 * half that answers "is anything broken". This proves the half that ATTRIBUTES
 * it, and the failure it exists to catch is the expensive one: a refused
 * `health:DescribeEvents` turning into "so it must be us". A console that says
 * that during an AWS-side impairment sends the on-call engineer to re-read our
 * own deploys for the first twenty minutes of somebody else's outage — which is
 * exactly the defect `lib/aws/aws-health.ts` was written against, one level up,
 * in the file that composes the two readings.
 *
 * It runs under `apps/web`'s jest, whose `roots` include
 * `apps/system-studio/src`. The Studio has no jest of its own, deliberately; see
 * the comment in `apps/web/jest.config.js`.
 */

/* ─────────────────────────────────────────────────────────────── fixtures ── */

const event = (verdict: HealthVerdict, over: Partial<HealthEventRow> = {}): HealthEventRow => ({
  // Obviously constructed, and never a plausible ARN: nothing in this file may
  // read as evidence about a real estate.
  arn: `arn:aws:health:us-east-1::event/EXAMPLE/${verdict}`,
  service: "EXAMPLE",
  eventTypeCode: `AWS_EXAMPLE_${verdict}`,
  category: "issue",
  region: "example-region-1",
  availabilityZone: null,
  statusCode: "open",
  scope: "PUBLIC",
  startTime: null,
  endTime: null,
  lastUpdatedTime: null,
  verdict,
  detail: "a constructed event",
  entities: [],
  entitiesKnown: true,
  entitiesDetail: "0 affected resource(s) in this account",
  tenants: [],
  ...over,
})

const alarm = (over: Partial<AlarmRow> = {}): AlarmRow => ({
  name: "example-alb-5xx",
  verdict: "OK",
  detail: "in OK.",
  type: "MetricAlarm",
  ...over,
})

/** AWS answered, and answered that nothing is happening. */
const awsClean = (): AwsSide =>
  awsSide({ state: "EMPTY", rows: [], because: "AWS Health answered with no events." })

/** AWS was not readable at all. */
const awsRefused = (): AwsSide =>
  awsSide({
    state: "DENIED",
    rows: [event("UNAUTHORIZED")],
    because: "health:DescribeEvents was refused.",
  })

/** AWS says it is having an event against resources in this account. */
const awsOnUs = (): AwsSide =>
  awsSide({ state: "ACTUAL", rows: [event("AFFECTING_US")], because: "" })

const firing = () => leadAnswer("ACTUAL", [alarm({ verdict: "ALARM" })])
const healthy = () => leadAnswer("ACTUAL", [alarm({ verdict: "OK" })])

/* ══════════════════════════════════════════════════════ 1. AWS's own side ══ */

describe("what AWS says about itself", () => {
  test("a refused read is not 'no events', and every count stays out of it", () => {
    const side = awsRefused()
    expect(side.known).toBe(false)
    expect(side.open).toBe(0)
    expect(side.affectingUs).toBe(0)
    expect(side.sentence).toContain("NOT known")
    // The sentence must never be worded as a clean bill of health.
    expect(side.sentence).not.toContain("nothing open")
    // Fixable, so it belongs above the alarms rather than under them.
    expect(side.hoist).toBe(true)
  })

  test("a successful read of no events rules AWS out, and says whose answer that is", () => {
    const side = awsClean()
    expect(side.known).toBe(true)
    expect(side.open).toBe(0)
    expect(side.sentence).toContain("AWS reports nothing open")
    expect(side.sentence).toContain("not a permission")
    expect(side.hoist).toBe(false)
  })

  /**
   * The two zero-count states are opposite facts, and this is the assertion
   * that keeps them distinguishable: every counter agrees, and only `known`
   * separates "AWS says nothing is wrong" from "AWS was never asked".
   */
  test("refused and clean produce identical counts and must not produce identical prose", () => {
    const refused = awsRefused()
    const clean = awsClean()
    expect(refused.open).toBe(clean.open)
    expect(refused.affectingUs).toBe(clean.affectingUs)
    expect(refused.known).not.toBe(clean.known)
    expect(refused.sentence).not.toBe(clean.sentence)
  })

  test("no support plan is never hoisted — no operator action during an incident fixes it", () => {
    const side = awsSide({
      state: "UNCONFIGURED",
      rows: [],
      because: "this account's AWS Support plan does not include the Health API.",
    })
    expect(side.known).toBe(false)
    expect(side.hoist).toBe(false)
    expect(side.sentence).toContain("Support plan")
  })

  test("only the verdicts that are open on THIS estate count towards 'open'", () => {
    const side = awsSide({
      state: "ACTUAL",
      rows: [
        event("AFFECTING_US"),
        event("OPEN_IN_OUR_REGION"),
        event("OPEN_REGION_UNKNOWN"),
        event("OPEN_ELSEWHERE"),
        event("UPCOMING"),
        event("NOTIFICATION"),
      ],
      because: "",
    })
    expect(side.affectingUs).toBe(1)
    expect(side.inOurRegion).toBe(1)
    expect(side.regionUnknown).toBe(1)
    expect(side.open).toBe(3)
    // Informational and scheduled rows are counted and do NOT make the page
    // shout: an event in another region is not this estate's incident.
    expect(side.elsewhere).toBe(1)
    expect(side.upcoming).toBe(1)
    expect(side.notices).toBe(1)
    expect(side.total).toBe(6)
    expect(side.hoist).toBe(true)
    expect(side.sentence).toContain("THIS account")
  })

  test("public events in our region are open without claiming AWS raised them against us", () => {
    const side = awsSide({
      state: "ACTUAL",
      rows: [event("OPEN_IN_OUR_REGION"), event("OPEN_REGION_UNKNOWN")],
      because: "",
    })
    expect(side.affectingUs).toBe(0)
    expect(side.open).toBe(2)
    expect(side.sentence).toContain("no event against this account's own resources")
    expect(side.sentence).toContain("not ruled out")
    expect(side.sentence).toContain("sts:GetCallerIdentity has not answered")
  })

  test("every AWS Health verdict has a tone, so no row can render without one", () => {
    for (const verdict of Object.keys(HEALTH_TONE) as HealthVerdict[]) {
      expect(HEALTH_TONE[verdict]).toBeTruthy()
    }
    // Colour is never the carrier: the tone repeats on purpose and the word
    // does not. `HEALTH_WORDS` in aws-health.ts is the word.
    expect(HEALTH_TONE.AFFECTING_US).toBe("bad")
    expect(HEALTH_TONE.OPEN_ELSEWHERE).toBe("neutral")
  })
})

/* ═════════════════════════════════════════════════════════ 2. attribution ══ */

describe("is it us, or is it AWS", () => {
  /**
   * The one this file exists for.
   *
   * Our alarms are firing and AWS Health could not be read. The tempting
   * answer — "AWS reported nothing, so it is ours" — is a claim assembled out
   * of a missing IAM grant.
   */
  test("a refused AWS Health read never attributes an incident to us", () => {
    const verdict = fleetVerdict(firing(), awsRefused(), true)
    expect(verdict.whose).toBe("UNKNOWN")
    expect(verdict.whose).not.toBe("US")
    expect(verdict.attribution).toContain("not established")
    expect(WHOSE_WORD[verdict.whose]).toBe("Not established")
  })

  test("firing alarms with AWS answering clean IS ours, and says AWS was asked", () => {
    const verdict = fleetVerdict(firing(), awsClean(), true)
    expect(verdict.whose).toBe("US")
    expect(verdict.attribution).toContain("AWS reports nothing open")
    expect(verdict.attribution).toContain("this estate's")
  })

  test("an AWS event against our resources is theirs even while our alarms are quiet", () => {
    const verdict = fleetVerdict(healthy(), awsOnUs(), true)
    expect(verdict.whose).toBe("AWS")
    expect(verdict.whoseTone).toBe("bad")
    // The alarm-side verdict is untouched: nothing of ours has crossed a
    // threshold, and the page must not manufacture one.
    expect(verdict.verdict).toBe("Healthy")
    expect(verdict.attribution).toContain("not the same as being unaffected")
  })

  test("both sides in trouble reads as one incident rather than two", () => {
    const verdict = fleetVerdict(firing(), awsOnUs(), true)
    expect(verdict.whose).toBe("BOTH")
    expect(verdict.attribution).toContain("one incident")
    expect(WHOSE_WORD.BOTH).toBe("Ours and AWS")
  })

  test("neither side readable is stated as such, not as either side being fine", () => {
    const unread = leadAnswer("DENIED", [])
    const verdict = fleetVerdict(unread, awsRefused(), false)
    expect(verdict.whose).toBe("UNKNOWN")
    expect(verdict.attribution).toContain("Neither side answered")
    expect(verdict.verdict).toBe("Unknown")
  })

  test("quiet alarms with AWS unreadable is not a clean bill of health", () => {
    const verdict = fleetVerdict(healthy(), awsRefused(), true)
    expect(verdict.whose).toBe("UNKNOWN")
    expect(verdict.whose).not.toBe("NEITHER")
    expect(verdict.attribution).toContain("cannot be ruled out")
  })

  test("both halves asked and both clean is the only NEITHER", () => {
    const verdict = fleetVerdict(healthy(), awsClean(), true)
    expect(verdict.whose).toBe("NEITHER")
    expect(verdict.whoseTone).toBe("ok")
    expect(verdict.attribution).toContain("Both halves of the question were asked")
  })

  test("a muted alarm is 'ours' even though CloudWatch calls it OK", () => {
    // `leadAnswer` already ranks DISABLED above OK. This is the same decision
    // one level up: the attribution must not read NEITHER because nothing is
    // literally in ALARM.
    const muted = leadAnswer("ACTUAL", [alarm({ verdict: "DISABLED" })])
    const verdict = fleetVerdict(muted, awsClean(), true)
    expect(verdict.whose).toBe("US")
    expect(verdict.verdict).toBe("Nobody would be told")
  })

  test("the alarm verdict, tone and headline pass through untouched", () => {
    const answer = firing()
    const verdict = fleetVerdict(answer, awsOnUs(), true)
    expect(verdict.verdict).toBe(answer.verdict)
    expect(verdict.tone).toBe(answer.tone)
    expect(verdict.headline).toBe(answer.headline)
  })

  test("every value of Whose has a word, and none of them is a colour", () => {
    for (const whose of ["US", "AWS", "BOTH", "NEITHER", "UNKNOWN"] as const) {
      expect(WHOSE_WORD[whose]).toBeTruthy()
    }
    expect(new Set(Object.values(WHOSE_WORD)).size).toBe(5)
  })
})

/* ═════════════════════════════════════════════════════════════ 3. layout ══ */

describe("where the AWS card goes", () => {
  test("an open event puts the attribution directly under the answer", () => {
    const order = sectionOrder(awsOnUs())
    expect(order[0]).toBe("right-now")
    expect(order[1]).toBe("aws-health")
    expect(order.indexOf("aws-health")).toBeLessThan(order.indexOf("needs-attention"))
  })

  test("nothing open drops it below the alarms rather than dropping it", () => {
    const order = sectionOrder(awsClean())
    expect(order[1]).toBe("needs-attention")
    expect(order.indexOf("aws-health")).toBeGreaterThan(order.indexOf("watching-quietly"))
    expect(order).toContain("aws-health")
  })

  test("both arrangements draw every card exactly once", () => {
    for (const order of [sectionOrder(awsOnUs()), sectionOrder(awsClean())]) {
      expect([...order].sort()).toEqual([...SECTIONS].sort())
      expect(new Set(order).size).toBe(SECTIONS.length)
    }
  })
})

/* ══════════════════════════════════════════════ 4. narrowing + provenance ══ */

describe("a read that did not answer is narrowed rather than cast", () => {
  const denied: AwsRead<readonly string[]> = {
    state: "DENIED",
    capability: "health:DescribeEvents",
    action: "health:DescribeEvents",
    principal: "arn:aws:iam::123456789012:role/example-studio-task-role",
    accountId: "123456789012",
    region: "example-region-1",
    partition: "aws",
    errorCode: "AccessDeniedException",
    minimumStatement: '{"Effect":"Allow"}',
  }

  test("the four valueless arms come back, so the shared panel can render them", () => {
    expect(unknownArm(denied)).toBe(denied)
    expect(
      unknownArm({ state: "THROTTLED", capability: "health:DescribeEvents", retryAfterMs: 1, asOf: "t" }),
    ).not.toBeNull()
    expect(
      unknownArm({ state: "UNCONFIGURED", capability: "health:DescribeEvents", why: "no plan" }),
    ).not.toBeNull()
    expect(
      unknownArm({ state: "ERROR", capability: "health:DescribeEvents", code: "X", safeDetail: "y" }),
    ).not.toBeNull()
  })

  test("a read that answered is null, so a populated table cannot render a refusal", () => {
    expect(
      unknownArm({
        state: "ACTUAL",
        capability: "health:DescribeEvents",
        value: ["one"],
        asOf: "t",
        fresh: true,
      }),
    ).toBeNull()
    expect(unknownArm({ state: "EMPTY", capability: "health:DescribeEvents", asOf: "t" })).toBeNull()
    expect(
      unknownArm({
        state: "STALE",
        capability: "health:DescribeEvents",
        value: ["one"],
        asOf: "t",
        ageMs: 1,
      }),
    ).toBeNull()
  })
})

describe("provenance names the second call", () => {
  const base = {
    identityState: "ACTUAL",
    accountId: "123456789012",
    region: "example-region-1",
    partition: "aws",
    principal: "arn:aws:iam::123456789012:role/example-studio-task-role",
    readState: "ACTUAL",
    refreshMs: 20_000,
    asOf: "2026-08-13T00:00:00.000Z",
  }

  test("the AWS Health rows appear only when that call was actually made", () => {
    const without = provenanceOf(base)
    expect(without.some((f) => f.label === "AWS Health answered")).toBe(false)

    const withHealth = provenanceOf({ ...base, healthReadState: "DENIED", healthRefreshMs: 25_000 })
    const byLabel = Object.fromEntries(withHealth.map((f) => [f.label, f.value]))
    expect(byLabel["AWS Health answered"]).toBe("DENIED")
    expect(byLabel["Also read"]).toContain("health:DescribeEvents")
    expect(byLabel["AWS Health refreshed"]).toBe("every 25s")
    // The alarm-side rows are unchanged by the addition.
    expect(byLabel["Answer"]).toBe("ACTUAL")
    expect(byLabel["Region"]).toBe("example-region-1")
  })

  test("no reading is invented for a call the page did not make", () => {
    const facts = provenanceOf(base)
    expect(JSON.stringify(facts)).not.toContain("health:DescribeEvents")
  })
})
