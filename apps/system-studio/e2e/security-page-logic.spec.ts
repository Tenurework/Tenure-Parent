import fs from "fs"
import path from "path"

import { test, expect } from "@playwright/test"

import {
  answeredSources,
  asOf,
  countBySeverity,
  countPastSla,
  leadAnswer,
  provenanceOf,
  readAnswered,
  scopeOf,
  scopeSentence,
  slaRows,
  statedAsOf,
  SEVERITY_RANK,
  SEVERITY_TONE,
  SOURCE_TONE,
} from "../src/app/platform/security/answer"
import type { FindingSource, SecurityFinding, Severity } from "../src/lib/aws/findings"

/**
 * The security page's derivations, exercised without a browser, a server or an
 * AWS account.
 *
 * `aws-unknown-is-not-absent.spec.ts` is the surface half: it proves
 * `securityFindings()` classifies a denial, a throttle, a disabled hub and a
 * duplicate correctly. This is the PAGE half — what the console then SAYS about
 * each of those, which is a separate decision and was, until this file, made in
 * ternaries nothing could reach.
 *
 * Four of the six lead arms cannot be reached from a browser at all: they need
 * Security Hub to refuse, to throttle, to be switched off, or to hold an open
 * CRITICAL. A suite that only drove the browser would leave the wording of the
 * arm an operator sees on their worst morning completely untested.
 *
 * The rule these enforce is one rule, stated six ways: a read that did not
 * happen is never rendered as a read that found nothing, six switched-off
 * products are never rendered as a clean estate, and the reason travels with
 * the absence.
 */

/* ────────────────────────────────────────────────────────── fixtures ────── */

const NOW = "2026-08-13T09:00:00.000Z"

const finding = (over: Partial<SecurityFinding> = {}): SecurityFinding => ({
  key: "finding-1::arn:aws:securityhub:eu-west-2::product/aws/guardduty::i-1",
  id: "finding-1",
  productArn: "arn:aws:securityhub:eu-west-2::product/aws/guardduty",
  product: "GuardDuty",
  title: "Unusual API call",
  severity: "HIGH",
  firstObservedAt: "2026-08-01T09:00:00.000Z",
  recordState: "ACTIVE",
  resourceIds: ["arn:aws:ec2:eu-west-2:123456789012:instance/i-1"],
  affects: { kind: "tenant", tenantSlug: "seed-deployed" },
  ageHours: 12,
  pastSla: false,
  ...over,
})

const PRODUCTS = [
  "Security Hub",
  "GuardDuty",
  "Inspector",
  "Macie",
  "Config",
  "IAM Access Analyzer",
] as const

const sources = (
  state: FindingSource["state"],
  detail = "read through Security Hub's aggregated findings.",
): readonly FindingSource[] => PRODUCTS.map((product) => ({ product, state, detail }))

/* ────────────────────────────────────── a read that did not answer ─────── */

test.describe("the answer when the read did not answer", () => {
  /**
   * The arm this whole page exists to get right.
   *
   * Every non-answering state must produce the UNKNOWN arm, and the arm must
   * never be phrased as an absence. A suite asserting only that *something* was
   * said stays green when the wording flips to "no open findings".
   */
  for (const state of ["DENIED", "THROTTLED", "ERROR", "UNCONFIGURED"]) {
    test(`${state} is unknown, not clear`, () => {
      const answer = leadAnswer(state, [], sources("AGGREGATED"))
      expect(answer.verdict).toBe("Unknown")
      expect(answer.tone).toBe("warn")
      expect(answer.because).toContain(state)
      // The three phrases a refused read must never produce.
      expect(answer.headline).not.toContain("no open findings")
      expect(answer.headline).not.toContain("Clear")
      expect(answer.verdict).not.toBe("Clear")
    })
  }

  test("the three answering states are not treated as refusals", () => {
    for (const state of ["ACTUAL", "STALE", "EMPTY"]) {
      expect(readAnswered(state), state).toBe(true)
    }
    for (const state of ["DENIED", "THROTTLED", "ERROR", "UNCONFIGURED"]) {
      expect(readAnswered(state), state).toBe(false)
    }
  })

  test("a refused read outranks findings that arrived with it", () => {
    // Belt and braces on the ordering. A surface that somehow carried findings
    // AND a denial must still report unknown: the list cannot be known to be
    // complete, and a count off an incomplete list is worse than no count.
    const answer = leadAnswer("DENIED", [finding({ severity: "CRITICAL" })], sources("AGGREGATED"))
    expect(answer.verdict).toBe("Unknown")
  })
})

/* ───────────────────────────────── a successful read of nothing ────────── */

test.describe("an empty list is not automatically a clean estate", () => {
  test("Security Hub switched off reads as nothing looking, never as clear", () => {
    const answer = leadAnswer(
      "ACTUAL",
      [],
      sources("NOT_ENABLED", "Security Hub is not enabled in this account."),
    )
    expect(answer.verdict).toBe("Nothing is looking")
    expect(answer.tone).toBe("warn")
    expect(answer.because).toContain("not enabled")
    expect(answer.verdict).not.toBe("Clear")
  })

  test("every source UNKNOWN reads as nothing looking, with a different reason", () => {
    const off = leadAnswer("ACTUAL", [], sources("NOT_ENABLED"))
    const unknown = leadAnswer("ACTUAL", [], sources("UNKNOWN", "not read — refused."))
    expect(unknown.verdict).toBe("Nothing is looking")
    // Same verdict, different because. Two estates in genuinely different
    // trouble must not produce one sentence.
    expect(unknown.because).not.toBe(off.because)
  })

  test("all six answering and nothing open is the only arm that reads clear", () => {
    const answer = leadAnswer("ACTUAL", [], sources("AGGREGATED"))
    expect(answer.verdict).toBe("Clear")
    expect(answer.tone).toBe("ok")
    expect(answer.headline).toContain("6 of 6")
  })

  test("clear from SOME sources is not tone ok, and says what it excludes", () => {
    const partial = [
      ...sources("AGGREGATED").slice(0, 4),
      ...sources("UNKNOWN", "not read — refused.").slice(4),
    ]
    const answer = leadAnswer("ACTUAL", [], partial)
    expect(answer.verdict).toBe("Clear")
    // The tone is the difference. A clean result off four of six sources is not
    // the same fact as a clean result off six, and `ok` would say it is.
    expect(answer.tone).toBe("warn")
    expect(answer.headline).toContain("4 of 6")
    expect(answer.because).toContain("did not")
  })

  test("DIRECT counts as answered and UNKNOWN does not", () => {
    // The positive list. `!== "UNKNOWN"` would make a seventh state added later
    // count as answered by default, and the arm it would land in is the one
    // that prints a clean bill of health.
    expect(answeredSources(sources("DIRECT"))).toHaveLength(6)
    expect(answeredSources(sources("AGGREGATED"))).toHaveLength(6)
    expect(answeredSources(sources("UNKNOWN"))).toHaveLength(0)
    expect(answeredSources(sources("NOT_ENABLED"))).toHaveLength(0)
  })
})

/* ─────────────────────────────────────────── what is actually open ─────── */

test.describe("the answer when something is open", () => {
  test("an open CRITICAL outranks everything else that is true", () => {
    const answer = leadAnswer(
      "ACTUAL",
      [finding({ severity: "CRITICAL" }), finding({ key: "b", severity: "LOW" })],
      sources("AGGREGATED"),
    )
    expect(answer.verdict).toBe("Critical open")
    expect(answer.tone).toBe("bad")
    expect(answer.headline).toContain("1 CRITICAL")
  })

  test("past SLA is its own arm, louder than a count", () => {
    const answer = leadAnswer(
      "ACTUAL",
      [finding({ severity: "HIGH", ageHours: 400, pastSla: true })],
      sources("AGGREGATED"),
    )
    expect(answer.verdict).toBe("Past SLA")
    expect(answer.tone).toBe("bad")
    expect(answer.headline).toContain("Nothing CRITICAL")
  })

  test("a CRITICAL that is also past SLA says both, in the CRITICAL arm", () => {
    const answer = leadAnswer(
      "ACTUAL",
      [finding({ severity: "CRITICAL", ageHours: 40, pastSla: true })],
      sources("AGGREGATED"),
    )
    expect(answer.verdict).toBe("Critical open")
    expect(answer.because).toContain("past the hours")
  })

  test("open and inside its allowance names the worst severity present", () => {
    const answer = leadAnswer(
      "ACTUAL",
      [finding({ severity: "LOW" }), finding({ key: "b", severity: "MEDIUM" })],
      sources("AGGREGATED"),
    )
    expect(answer.verdict).toBe("Open findings")
    expect(answer.tone).toBe("warn")
    expect(answer.headline).toContain("MEDIUM")
    expect(answer.headline).not.toContain("LOW")
  })

  test("all six arms produce six different sentences", () => {
    const sentences = [
      leadAnswer("DENIED", [], sources("AGGREGATED")).headline,
      leadAnswer("ACTUAL", [], sources("NOT_ENABLED")).headline,
      leadAnswer("ACTUAL", [finding({ severity: "CRITICAL" })], sources("AGGREGATED")).headline,
      leadAnswer("ACTUAL", [finding({ pastSla: true })], sources("AGGREGATED")).headline,
      leadAnswer("ACTUAL", [finding()], sources("AGGREGATED")).headline,
      leadAnswer("ACTUAL", [], sources("AGGREGATED")).headline,
    ]
    expect(new Set(sentences).size).toBe(6)
  })
})

/* ─────────────────────────────────────────────────── counting, sorting ─── */

test.describe("counting and ordering", () => {
  test("every severity is present in the count, including the zeroes", () => {
    const counts = countBySeverity([finding({ severity: "HIGH" })])
    expect(Object.keys(counts).sort()).toEqual(
      ["CRITICAL", "HIGH", "INFORMATIONAL", "LOW", "MEDIUM"].sort(),
    )
    expect(counts.HIGH).toBe(1)
    expect(counts.CRITICAL).toBe(0)
  })

  test("past-SLA is counted from the flag the surface set, never re-derived", () => {
    expect(countPastSla([finding({ pastSla: true }), finding({ key: "b" })])).toBe(1)
  })

  /*
   * The four ordering cases that used to sit here — worst severity first, past
   * its allowance first inside a band, then oldest, then by key, and not
   * mutating the input — moved to
   * `src/app/platform/security/posture.test.ts`, against `rankExposures`.
   *
   * They moved because the thing they described moved. The page no longer draws
   * a Security-Hub-only table: it draws ONE ranked list across Security Hub's
   * findings, the IAM wildcards this console sweeps for and the access keys it
   * ages, so `sortFindings` had no renderer left and `rankExposures` is the
   * comparator an operator actually sees. Every assertion is carried over
   * verbatim in behaviour, over the merged row type, with the cross-source
   * cases this file could not have expressed added beside them.
   */

  test("every severity has a tone, and none of them is the accent", () => {
    for (const severity of SEVERITY_RANK) {
      expect(SEVERITY_TONE[severity], severity).toBeTruthy()
      expect(["neutral", "info", "ok", "warn", "bad"]).toContain(SEVERITY_TONE[severity])
    }
    // A severity that is not good news must never be tone `ok`.
    expect(SEVERITY_TONE.CRITICAL).toBe("bad")
    expect(SEVERITY_TONE.HIGH).toBe("bad")
  })

  test("no source state is tone ok unless it actually reported", () => {
    expect(SOURCE_TONE.AGGREGATED).toBe("ok")
    expect(SOURCE_TONE.DIRECT).toBe("ok")
    expect(SOURCE_TONE.NOT_ENABLED).not.toBe("ok")
    expect(SOURCE_TONE.UNKNOWN).not.toBe("ok")
  })
})

/* ────────────────────────────────────────────────────── SLA rendering ──── */

test.describe("the service-level table", () => {
  const HOURS: Readonly<Record<Severity, number>> = {
    CRITICAL: 24,
    HIGH: 72,
    MEDIUM: 336,
    LOW: 720,
    INFORMATIONAL: Number.POSITIVE_INFINITY,
  }

  test("an unbounded severity says so in words rather than printing Infinity", () => {
    const rows = slaRows(HOURS)
    const informational = rows.find((row) => row.severity === "INFORMATIONAL")
    expect(informational?.limit).not.toContain("Infinity")
    expect(informational?.limit).toContain("no limit")
  })

  test("a bounded severity carries the hours and the days", () => {
    const critical = slaRows(HOURS).find((row) => row.severity === "CRITICAL")
    expect(critical?.limit).toContain("24h")
    expect(critical?.limit).toContain("1 day")
    expect(critical?.limit).not.toContain("1 days")
  })

  test("the rows are the severity ladder, worst first", () => {
    expect(slaRows(HOURS).map((row) => row.severity)).toEqual([...SEVERITY_RANK])
  })
})

/* ──────────────────────────────────────────── as of, scope, provenance ─── */

test.describe("what the page says it does not know", () => {
  test("a missing as-of is a sentence, not a blank", () => {
    expect(asOf(null)).toContain("unknown time")
    expect(asOf("")).toContain("unknown time")
    expect(asOf(NOW)).toBe(`As of ${NOW}.`)
  })

  test("statedAsOf punctuates without doubling the full stop", () => {
    expect(statedAsOf("Read live", NOW)).toBe(`Read live. As of ${NOW}.`)
    expect(statedAsOf("Read live.", NOW)).toBe(`Read live. As of ${NOW}.`)
  })

  test("a denied identity names why the account is unknown, and invents nothing", () => {
    const scope = scopeOf({ identityState: "DENIED" })
    const account = scope.find((fact) => fact.label === "Account")
    expect(account?.value).toContain("Not known")
    expect(account?.value).toContain("sts:GetCallerIdentity came back DENIED")
    // The console refuses to boot without AWS_ACCOUNT_ID precisely so it never
    // invents an estate. A plausible-looking default here would undo that.
    expect(account?.value).not.toMatch(/[0-9]{12}/)
  })

  test("an identity that answered but carried nothing says which of the two it is", () => {
    const scope = scopeOf({ identityState: "ACTUAL", accountId: "", region: "eu-west-2" })
    expect(scope.find((f) => f.label === "Account")?.value).toContain(
      "answered but did not carry it",
    )
    expect(scope.find((f) => f.label === "Region")?.value).toBe("eu-west-2")
  })

  test("an unknown estate is one sentence naming the read, not three pills of prose", () => {
    const sentence = scopeSentence({ identityState: "UNCONFIGURED" })
    expect(sentence).toContain("cannot say which estate")
    expect(sentence).toContain("sts:GetCallerIdentity came back UNCONFIGURED")
    expect(sentence).toContain("rather than defaulted")
    expect(sentence).not.toMatch(/[0-9]{12}/)
  })

  test("provenance states the read, its answer, and the duplicates it collapsed", () => {
    const facts = provenanceOf({
      identityState: "ACTUAL",
      accountId: "123456789012",
      region: "eu-west-2",
      partition: "aws",
      principal: "arn:aws:sts::123456789012:assumed-role/tenure-studio/x",
      readState: "ACTUAL",
      refreshMs: 900_000,
      asOf: NOW,
      duplicatesRemoved: 3,
    })
    const value = (label: string) => facts.find((fact) => fact.label === label)?.value ?? ""
    expect(value("Read")).toContain("securityhub:GetFindings")
    expect(value("Answer")).toBe("ACTUAL")
    expect(value("Refreshed")).toBe("every 15 min")
    expect(value("Duplicates collapsed")).toContain("3 records")
    expect(value("This reading")).toContain(NOW)
  })

  test("no duplicates says none, rather than printing a zero", () => {
    const facts = provenanceOf({
      identityState: "DENIED",
      readState: "DENIED",
      refreshMs: 900_000,
      asOf: NOW,
      duplicatesRemoved: 0,
    })
    expect(facts.find((f) => f.label === "Duplicates collapsed")?.value).toBe("none in this read")
    expect(facts.find((f) => f.label === "As")?.value).toContain("Not known")
  })
})

/* ────────────────────────────────────────────────────── the page itself ── */

const ROUTE_DIR = path.join(__dirname, "..", "src", "app", "platform", "security")

/**
 * Read a route file with its line endings normalised.
 *
 * A checked-in file is CRLF on a Windows checkout and LF on a Linux one, and a
 * regex written with `\n` matches on one and not the other — which is how an
 * assertion becomes "green here, red in CI".
 */
function routeFile(name: string): string {
  return fs.readFileSync(path.join(ROUTE_DIR, name), "utf8").split("\r\n").join("\n")
}

test.describe("the page consumes the design system rather than forking it", () => {
  test("it still calls the surface, live, on every load", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain("await securityFindings()")
    expect(page).toContain('export const dynamic = "force-dynamic"')
  })

  test("it is still an operator-only page", () => {
    const page = routeFile("page.tsx")
    // The guard the entry-point inventory reads, and the reason this route is
    // not counted as a naked mutator. Restyling a page is exactly the kind of
    // change that quietly drops it.
    expect(page).toContain("operatorConfigProblems()")
    expect(page).toContain("isOperator(session?.user?.email)")
    expect(page).toContain('redirect("/signin")')
  })

  test("it imports the MD3 primitives and no longer hand-rolls a panel", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain('from "@/components/md3"')
    for (const primitive of ["Card", "Badge", "DataTable", "Chip", "EmptyState"]) {
      expect(page, primitive).toContain(primitive)
    }
    // The ad-hoc class strings this page had accumulated. `table.grid` and
    // `.system` are the pre-MD3 shapes; `.slug` is a colour decision made in a
    // product module.
    expect(page).not.toContain('className="system"')
    expect(page).not.toContain('className="grid"')
    expect(page).not.toContain('className="slug"')
    expect(page).not.toContain('className="scroll-x"')
  })

  test("no literal colour and no inline style in the page", () => {
    const page = routeFile("page.tsx")
    // The same rule `md3-tokens-logic.spec.ts` applies to the primitives. A
    // colour in a product module is a pair the contrast audit cannot see.
    expect(page).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(page).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|color-mix)\(/)
    expect(page).not.toMatch(/style=\{\{/)
  })

  test("the route stylesheet is geometry only", () => {
    const css = routeFile("security.module.css")
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/)
    // Type, elevation and shape are the token layer's answers, asked for
    // through `components/md3/`. A page that sets its own is a page the
    // contrast and type audits cannot see.
    expect(css).not.toMatch(/font-size\s*:/)
    expect(css).not.toMatch(/font-weight\s*:/)
    expect(css).not.toMatch(/box-shadow\s*:/)
    expect(css).not.toMatch(/border-radius\s*:/)
  })

  test("the stylesheet has no physical directions in it", () => {
    // `layout.spec.ts` re-runs every route under dir="rtl". One `margin-left`
    // reds that while every LTR test stays green.
    const css = routeFile("security.module.css")
    expect(css).not.toMatch(/\b(margin|padding|border|inset)-(left|right)\s*:/)
    expect(css).not.toMatch(/\btext-align\s*:\s*(left|right)\b/)
    expect(css).not.toMatch(/\bfloat\s*:/)
    // `max-width` inside `@media (...)` is a media FEATURE and is how the
    // stylesheet reflows at 320px; a `width:` DECLARATION is the physical one.
    expect(css).not.toMatch(/^\s*(min-|max-)?(width|height)\s*:/m)
  })

  test("the findings table is not rendered when the read did not answer", () => {
    // The structural half of the first assertion group. `leadAnswer` says
    // "unknown"; this is what stops the page drawing an empty table underneath
    // a heading that says "Open findings", which reads as "there are none".
    const page = routeFile("page.tsx")
    const guarded = page.indexOf("{answered ? (")
    const table = page.indexOf("<DataTable")
    expect(guarded, "the findings table is no longer behind the answered check").toBeGreaterThan(-1)
    expect(table).toBeGreaterThan(guarded)
  })

  test("the question is asked in words, at the top, before any apparatus", () => {
    // The one sentence this route exists to answer. It is asserted on because a
    // restyle is exactly the kind of change that turns a question into a noun.
    const page = routeFile("page.tsx")
    const question = page.indexOf(
      "What in this estate is exposed, unencrypted, unrotated or unwatched?",
    )
    expect(question, "the page no longer asks its question in words").toBeGreaterThan(-1)
    expect(page.indexOf("<Card")).toBeGreaterThan(question)
  })

  test("what is NOT being checked is drawn above what was found", () => {
    // The ordering IS the argument of this page. A disabled control's silence
    // read as a pass is the defect; putting the coverage card below the findings
    // table is how a page quietly reintroduces it.
    const page = routeFile("page.tsx")
    const notChecking = page.indexOf('headline="Not being checked"')
    const found = page.indexOf('headline="What this console found"')
    expect(notChecking, "the coverage card is gone").toBeGreaterThan(-1)
    expect(found).toBeGreaterThan(notChecking)
  })

  test("a refused read renders through the shared UnknownState, never as a blank", () => {
    const page = routeFile("page.tsx")
    // Both reads, and both through the same primitive: the panel carries the
    // principal, the action, the error code and a pasteable minimum statement.
    expect(page).toContain("<UnknownState")
    expect(page).toContain('what="the Security Hub findings"')
    expect(page).toContain('what="this account\'s IAM policies and access keys"')
  })

  test("both readers are called, and neither is stubbed", () => {
    const page = routeFile("page.tsx")
    expect(page).toContain("await securityFindings()")
    // STUDIO-110-006's second half. `lib/aws/iam.ts` had no production caller at
    // all before this page: the wildcard sweep answers "exposed" and access-key
    // age answers "unrotated", and both report their own coverage.
    expect(page).toContain("await iamPosture()")
  })

  test("the coverage module is pure enough to drive at the node level", () => {
    // Same rule as `answer.ts`, one module along. `capabilities.ts` is a data
    // registry with no imports of its own, so a VALUE import of it is safe; a
    // value import of anything else in `lib/aws/` would drag `server-only`, the
    // SDK clients and a live gateway in behind it and `posture.test.ts` would
    // stop being runnable without an estate.
    const posture = routeFile("posture.ts")
    const valueImports = posture
      .split("\n")
      .filter((line) => line.startsWith("import ") && !line.startsWith("import type"))
    expect(valueImports).toHaveLength(1)
    expect(valueImports[0]).toContain("capabilities")
  })

  test("the decision module pulls no runtime dependency into the node-level tests", () => {
    // This file imports `./answer` directly. The moment that module imports a
    // VALUE out of `lib/aws/findings.ts`, it drags `server-only`, the AWS SDK
    // clients and a live gateway in behind it, and this whole spec stops being
    // runnable without an estate.
    const answer = routeFile("answer.ts")
    const imports = answer.split("\n").filter((line) => line.startsWith("import "))
    expect(imports).toHaveLength(1)
    expect(imports[0]).toContain("import type")
  })
})
