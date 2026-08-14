import fs from "fs"
import path from "path"

import { test, expect } from "@playwright/test"

import {
  answeredOf,
  asOf,
  leadAnswer,
  marginalCost,
  observationTone,
  outcomeTone,
  reading,
  readingAsync,
  statedAsOf,
  unreadable,
} from "../src/app/tenants/[slug]/summary"
import { healthOf, type HealthObservation } from "../src/lib/fleet-health"

/**
 * The tenant page's derivations, exercised without a browser, a table or an
 * estate.
 *
 * `tenant-surface.spec.ts` is the browser half and it proves the PAGE calls
 * these. This file proves what they decide — and specifically the arms a
 * browser cannot reach, because every one of them is about what happens when
 * DynamoDB, STS or an IAM policy says no. A page needs a working registry to
 * render at all, so a suite that only drove the browser could never see the
 * wording of "the ledger could not be read".
 *
 * The rule these enforce is one rule, stated five ways: a read that did not
 * happen is never rendered as a read that found nothing, and the reason travels
 * with the absence together with the thing that fixes it.
 */

/** An error shaped the way the AWS SDK v3 shapes one. */
function awsError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

const observation = (over: Partial<HealthObservation> = {}): HealthObservation => ({
  source: "tls",
  status: "ok",
  asOf: "2026-08-01T00:00:00.000Z",
  detail: "the certificate expires in 61 days",
  ...over,
})

/* ─────────────────────────────────────── a refusal is not an absence ────── */

test.describe("why a read did not answer", () => {
  /**
   * The five arms, and that no two of them say the same thing.
   *
   * This is the assertion the whole group exists for. A console whose every
   * failure reads "could not be read" sends an operator to check an IAM policy
   * that was never wrong, and — worse — a suite asserting only that SOMETHING
   * was said stays green when four of the five arms stop working.
   */
  test("five different failures produce five different explanations and five different fixes", () => {
    const cases = {
      misconfigured: unreadable(
        awsError("FleetMisconfigured", "AWS_ACCOUNT_ID — the AWS account this cell runs in"),
        "the cell registry",
        "sts:GetCallerIdentity",
      ),
      denied: unreadable(
        awsError("AccessDeniedException", "User is not authorized to perform: dynamodb:Query"),
        "this tenant's audit ledger",
        "dynamodb:Query",
      ),
      throttled: unreadable(
        awsError("ThrottlingException", "Rate exceeded"),
        "this tenant's audit ledger",
        "dynamodb:Query",
      ),
      unavailable: unreadable(
        awsError("AuditUnavailable", "The audit ledger could not be read: no such table"),
        "this tenant's audit ledger",
        "dynamodb:Query",
      ),
      unrecognised: unreadable(new Error("socket hang up"), "the AWS estate", "ecs:DescribeServices"),
    }

    const because = Object.values(cases).map((c) => c.because)
    const fixes = Object.values(cases).map((c) => c.fix)

    expect(new Set(because).size, "two failures explained themselves identically").toBe(5)
    expect(new Set(fixes).size, "two failures offered the same remedy").toBe(5)

    // And each one names the thing that would actually fix IT.
    expect(cases.misconfigured.fix).toContain("AWS_ACCOUNT_ID")
    expect(cases.misconfigured.fix).toContain("sts:GetCallerIdentity")
    expect(cases.denied.fix).toContain("dynamodb:Query")
    expect(cases.denied.because).toContain("AccessDeniedException")
    expect(cases.throttled.fix).toMatch(/reload|back off|seconds/i)
    expect(cases.throttled.fix).not.toContain("Grant")
    expect(cases.unavailable.fix).toContain("TENANT_TABLE")
    expect(cases.unrecognised.because).toContain("socket hang up")
  })

  test("a denial says it is a refusal, and never that there is nothing there", () => {
    const denied = unreadable(
      awsError("AccessDeniedException", "not authorized"),
      "the AWS resources this tenant still holds",
      "tag:GetResources",
    )
    expect(denied.because).toMatch(/refused/i)
    expect(`${denied.because} ${denied.fix}`).not.toMatch(/\bnone\b|\bempty\b|\bno resources\b/i)
  })

  test("the message is normalised and bounded, so a payload cannot ride out on it", () => {
    const noisy = unreadable(new Error(`a\n b\t c ${"x".repeat(2000)}`), "a surface", "an:action")
    expect(noisy.because).not.toContain("\n")
    expect(noisy.because.length).toBeLessThan(400)
  })
})

test.describe("running a read that can throw", () => {
  test("keeps the value when it works and the reason when it does not", () => {
    const ok = reading(() => [1, 2, 3], "the cell registry", "sts:GetCallerIdentity")
    expect(ok.known && ok.value).toEqual([1, 2, 3])

    const bad = reading(
      () => {
        throw awsError("FleetMisconfigured", "AWS_PARTITION is unset")
      },
      "the cell registry",
      "sts:GetCallerIdentity",
    )
    expect(bad.known).toBe(false)
    expect(bad.known === false && bad.fix).toContain("AWS_PARTITION")
  })

  test("an empty answer is KNOWN, and is not the same shape as a refused one", async () => {
    // The distinction the whole `Reading` union exists for: an AWS call that
    // succeeded and returned nothing is a fact, and the page renders "there is
    // nothing" for it. A call that was refused is not.
    const empty = await readingAsync(async () => [], "the audit ledger", "dynamodb:Query")
    const refused = await readingAsync(
      async () => {
        throw awsError("AccessDeniedException", "no")
      },
      "the audit ledger",
      "dynamodb:Query",
    )

    expect(empty.known).toBe(true)
    expect(empty.known && empty.value).toEqual([])
    expect(refused.known).toBe(false)
  })
})

/* ──────────────────────────────────────────────── every panel says when ── */

test.describe("stating what a panel is as of", () => {
  test("an absent time is spelled out rather than rendered blank", () => {
    expect(asOf(null)).toMatch(/unknown time/i)
    expect(asOf(null)).not.toBe("")
  })

  test("a time is an ISO instant, not a locale rendering", () => {
    // Rendered on the server. A locale-formatted date is a different string in
    // CI and on an operator's machine, which is the one difference nobody
    // notices until they are comparing two consoles during an incident.
    expect(asOf(new Date("2026-08-01T09:30:00.000Z"))).toBe("As of 2026-08-01T09:30:00.000Z.")
    expect(asOf("2026-08-01T09:30:00.000Z")).toBe("As of 2026-08-01T09:30:00.000Z.")
  })

  test("a supporting line always ends in the as-of, whether or not the sentence had a stop", () => {
    const withStop = statedAsOf("What was seen.", "2026-08-01T00:00:00.000Z")
    const without = statedAsOf("What was seen", "2026-08-01T00:00:00.000Z")
    expect(withStop).toBe(without)
    expect(without.endsWith("As of 2026-08-01T00:00:00.000Z.")).toBe(true)
    expect(without).not.toContain("..")
  })
})

/* ─────────────────────────────────────────────────────── the lead answer ── */

test.describe("the answer at the top of the page", () => {
  const health = (
    over: {
      state?: Parameters<typeof healthOf>[0]["state"]
      updatedAt?: string
      hasDeployment?: boolean
      observations?: readonly HealthObservation[]
      registryConfigRevision?: number
      storeConfigRevision?: number
    } = {},
  ) =>
    healthOf(
      {
        slug: "acme",
        state: over.state ?? "ACTIVE",
        updatedAt: over.updatedAt ?? "2026-08-01T00:00:00.000Z",
        hasDeployment: over.hasDeployment ?? true,
        observations: over.observations ?? [observation()],
        ...(over.registryConfigRevision !== undefined
          ? { registryConfigRevision: over.registryConfigRevision }
          : {}),
        ...(over.storeConfigRevision !== undefined
          ? { storeConfigRevision: over.storeConfigRevision }
          : {}),
      },
      new Date("2026-08-01T01:00:00.000Z"),
    )

  test("a serving tenant with nothing wrong says so, in the calmest tone", () => {
    const answer = leadAnswer({ health: health(), serving: true, state: "ACTIVE" })
    expect(answer.verdict).toBe("Serving")
    expect(answer.tone).toBe("ok")
    expect(answer.because).toBeNull()
  })

  test("a broken dependency outranks the lifecycle row, which says ACTIVE throughout", () => {
    const answer = leadAnswer({
      health: health({
        observations: [observation({ status: "failing", detail: "the certificate expired" })],
      }),
      serving: true,
      state: "ACTIVE",
    })
    expect(answer.verdict).toBe("Dependency failing")
    expect(answer.tone).toBe("bad")
    // The badge is not the carrier. The sentence beneath it names the source.
    expect(answer.because).toContain("the certificate expired")
  })

  test("a tenant nobody could observe is a warning, never a pass", () => {
    const answer = leadAnswer({
      health: health({ observations: [observation({ status: "unknown", detail: "denied" })] }),
      serving: true,
      state: "ACTIVE",
    })
    expect(answer.verdict).toBe("Unobserved")
    expect(answer.tone).not.toBe("ok")
    expect(answer.headline).toMatch(/not one source/i)
  })

  test("the registry and the store disagreeing is reported here, not only on the fleet listing", () => {
    const answer = leadAnswer({
      health: health({ registryConfigRevision: 3, storeConfigRevision: 5 }),
      serving: true,
      state: "ACTIVE",
    })
    expect(answer.verdict).toBe("Configuration behind")
    expect(answer.headline).toMatch(/the cell is running the other/i)
  })

  test("a failure outranks everything else that is also true", () => {
    const answer = leadAnswer({
      health: health({
        state: "FAILED",
        hasDeployment: false,
        observations: [observation({ status: "failing" })],
      }),
      serving: false,
      state: "FAILED",
    })
    expect(answer.verdict).toBe("Failed")
  })

  test("a stalled transition names the state it has been sitting in", () => {
    const answer = leadAnswer({
      health: health({ state: "PROVISIONING", updatedAt: "2026-07-31T12:00:00.000Z" }),
      serving: false,
      state: "PROVISIONING",
    })
    expect(answer.verdict).toBe("Stalled")
    expect(answer.headline).toContain("PROVISIONING")
  })

  test("a terminal state says there is no move out of it, rather than reading as merely paused", () => {
    const answer = leadAnswer({
      health: health({ state: "PURGED_ZERO_INCREMENTAL_COST" }),
      serving: false,
      state: "PURGED_ZERO_INCREMENTAL_COST",
    })
    expect(answer.verdict).toBe("Terminal")
    expect(answer.headline).toMatch(/no move out of it/i)
  })

  /**
   * The assertion the rest of this group exists for.
   *
   * Nine states an operator would act on differently, and nine different words
   * for them. A page whose badge said "Attention" for all of them would pass
   * every other test in this file — and would be a page an operator has to read
   * in full to learn anything, which is the thing that made this console "look
   * like a construction site".
   */
  test("every arm produces its own verdict, so one word is never a synonym for nine states", () => {
    const verdicts = [
      leadAnswer({ health: health(), serving: true, state: "ACTIVE" }),
      leadAnswer({
        health: health({ observations: [observation({ status: "failing" })] }),
        serving: true,
        state: "ACTIVE",
      }),
      leadAnswer({
        health: health({ observations: [observation({ status: "unknown" })] }),
        serving: true,
        state: "ACTIVE",
      }),
      leadAnswer({
        health: health({ state: "FAILED", hasDeployment: false }),
        serving: false,
        state: "FAILED",
      }),
      leadAnswer({
        health: health({ state: "PROVISIONING", updatedAt: "2026-07-31T12:00:00.000Z" }),
        serving: false,
        state: "PROVISIONING",
      }),
      leadAnswer({
        health: health({ state: "READY", hasDeployment: false }),
        serving: false,
        state: "READY",
      }),
      leadAnswer({
        health: health({ state: "HIBERNATED_ZERO_RUNTIME" }),
        serving: false,
        state: "HIBERNATED_ZERO_RUNTIME",
      }),
      leadAnswer({
        health: health({ state: "PURGED_ZERO_INCREMENTAL_COST" }),
        serving: false,
        state: "PURGED_ZERO_INCREMENTAL_COST",
      }),
      leadAnswer({
        health: health({ registryConfigRevision: 1, storeConfigRevision: 2 }),
        serving: true,
        state: "ACTIVE",
      }),
    ].map((a) => a.verdict)

    expect(new Set(verdicts).size, `two states share a verdict: ${verdicts.join(", ")}`).toBe(
      verdicts.length,
    )
  })
})

/* ─────────────────────────────────────────────────── counting the silence ── */

test.describe("how many sources answered", () => {
  test("an unknown source is counted as unanswered and named", () => {
    const counted = answeredOf([
      observation({ source: "tls", status: "ok" }),
      observation({ source: "alarm", status: "unknown" }),
      observation({ source: "backup", status: "unknown" }),
      observation({ source: "queue-age", status: "degraded" }),
    ])
    expect(counted.total).toBe(4)
    expect(counted.answered).toBe(2)
    expect(counted.unobserved).toEqual(["alarm", "backup"])
  })

  test("nothing observed at all is zero of zero, not zero of some assumed set", () => {
    expect(answeredOf([])).toEqual({ answered: 0, total: 0, unobserved: [] })
  })
})

test.describe("tone is decoration and the word is the carrier", () => {
  test("an unread source is never given the healthy tone", () => {
    expect(observationTone("unknown")).not.toBe("ok")
    expect(observationTone("unknown")).toBe("warn")
    expect(observationTone("ok")).toBe("ok")
    expect(observationTone("failing")).toBe("bad")
    expect(observationTone("degraded")).toBe("warn")
  })

  test("an attempt with no outcome yet is not a success", () => {
    expect(outcomeTone(null)).toBe("neutral")
    expect(outcomeTone("APPLIED")).toBe("ok")
    expect(outcomeTone("REFUSED_CONFIRMATION")).toBe("bad")
    expect(outcomeTone("REFUSED_IRREVERSIBLE")).toBe("bad")
    expect(outcomeTone("FAILED_PRECONDITION")).toBe("bad")
  })
})

test("free is said as free, not as a formatted zero", () => {
  expect(marginalCost(0)).toBe("$0 marginal")
  expect(marginalCost(1234)).toBe("$12.34/month")
})

/* ───────────────────────────────────────────── the route holds no colour ── */

/**
 * The rule `components/md3/index.ts` states, applied to this route's own files.
 *
 * A product module may not contain a colour. Every colour in this console is a
 * `--md-sys-color-*` role declared once in `globals.css`, and the contrast audit
 * in `md3-tokens-logic.spec.ts` can only compute a ratio for a pair it can find.
 * One literal in one route is a pair the audit does not know exists.
 *
 * That spec reads `components/md3/` and stops there, which is correct for what
 * it is and leaves every route unchecked. This checks the two files this route
 * owns.
 */
test.describe("this route declares no colour of its own", () => {
  const ROUTE_DIR = path.join(__dirname, "..", "src", "app", "tenants", "[slug]")
  /*
   * Every file this route owns, and the list is the point: a rule that covers
   * three of five files is a rule with two files' worth of holes in it.
   * `footprint.ts` and `next-moves.ts` are the two decisions extracted out of
   * `page.tsx` — "where it is" and "what can happen next" — and they are as
   * capable of carrying a literal as the page was.
   */
  const OWNED = [
    "page.tsx",
    "tenant.module.css",
    "summary.ts",
    "footprint.ts",
    "next-moves.ts",
  ]

  const COLOUR = [
    /#[0-9a-fA-F]{3,8}\b/,
    /\brgba?\s*\(/,
    /\bhsla?\s*\(/,
    /\boklch\s*\(/,
    /\bcolor-mix\s*\(/,
    /\b(?:background|color|border-color|fill|stroke)\s*:\s*(?!var\()/,
  ]

  for (const file of OWNED) {
    test(`${file} contains no literal colour`, () => {
      const source = fs.readFileSync(path.join(ROUTE_DIR, file), "utf8")
      for (const pattern of COLOUR) {
        expect(source, `${file} matches ${pattern}`).not.toMatch(pattern)
      }
    })
  }

  test("the stylesheet sets no type scale of its own either", () => {
    // Type is the token layer's answer and `md3-title-large` / `md3-body-medium`
    // are how a surface asks for it. A route that set its own font-size would
    // drift from the scale silently, and only a screenshot would show it.
    const css = fs.readFileSync(path.join(ROUTE_DIR, "tenant.module.css"), "utf8")
    expect(css).not.toMatch(/font-size\s*:/)
    expect(css).not.toMatch(/font-weight\s*:/)
    expect(css).not.toMatch(/box-shadow\s*:/)
  })

  test("every length in the stylesheet is a token, not a number somebody chose", () => {
    const css = fs.readFileSync(path.join(ROUTE_DIR, "tenant.module.css"), "utf8")
    // `gap`, `margin` and `padding` declarations must resolve through `var(`.
    // `0` is allowed — it is not a spacing decision.
    const spacing = [...css.matchAll(/(?:gap|margin|padding)[a-z-]*\s*:\s*([^;]+);/g)]
    expect(spacing.length, "the stylesheet declares no spacing at all").toBeGreaterThan(3)
    for (const [, value] of spacing) {
      const literal = value.trim()
      expect(literal === "0" || literal.includes("var("), `spacing "${literal}" is not a token`).toBe(
        true,
      )
    }
  })
})
