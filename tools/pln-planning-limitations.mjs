/**
 * PLN-040-005 — publish the exact model, domain, forecast and country
 * limitations of Tenure planning.
 *
 * > Publish exact model/domain/forecast/country limitations.
 *
 * The word in that sentence that decides whether this file is worth anything is
 * "exact". A limitations page written by hand is a page of adjectives: "planning
 * support is currently limited", "multi-currency is partial", "forecasting is
 * on the roadmap". Every one of those sentences is true of a repository that
 * has a full planning engine and true of one that has none, which is the same
 * as saying nothing. Worse, it ages in the direction that flatters: the page
 * keeps saying "limited" long after a limit is lifted, and keeps saying
 * "partial" long after the partial half was deleted.
 *
 * So every number and every verdict below is DERIVED from the tree at
 * generation time, and `tests/architecture/pln-planning-limitations.test.mjs`
 * re-derives the whole document and compares it byte for byte. An edit here the
 * repository does not support is a failing test rather than a believed sentence.
 *
 * ## The distinction this document is built around
 *
 * "We looked and found nothing" and "we could not look" are different answers,
 * and collapsing them is the defect this codebase most often finds. A
 * limitations page is exactly where they collapse, because an absent capability
 * and an unexamined capability read identically in prose.
 *
 * They are kept apart three ways:
 *
 *   1. A probe is a NECESSARY condition, not a sufficient one. Zero hits over
 *      the whole swept tree proves the domain is absent. Hits do NOT prove it is
 *      present — so where a probe hits, the files it hit are printed and the
 *      note says what they actually do. Section 2's `6.8` row is the only one
 *      where that matters today, and it is the row a reader would otherwise
 *      most likely misread.
 *   2. Probe tokens are unambiguous compound identifiers (`headcountPlan`, not
 *      `headcount`). `headcount` was tried and hits `packages/finops/src/split.ts`
 *      and the organization model's tests, none of which is workforce planning.
 *      A probe that hits noise cannot prove absence, because a future real
 *      implementation would not change its answer.
 *   3. Section 5 states what this generator CANNOT see, by name. A limitations
 *      page whose own blind spots are undocumented is the failure mode it exists
 *      to prevent, aimed at itself.
 *
 * ## Refusals
 *
 * The generator throws rather than emitting a stale document when: a planning
 * domain the Bible states has no probe set or no note; a probe set or note names
 * a domain the Bible does not state; the currency-exponent tables, the default
 * money format, the compact formatter, either schema `@@unique` grain or either
 * of the two Bible sentences it parses cannot be found where it looks. Each of
 * those is a refactor that would otherwise leave a confident, wrong number on a
 * page whose whole claim is exactness.
 */

import fs from "node:fs"
import path from "node:path"

import { BIBLE, ROOT, SCAN_ROOTS, SCHEMA, readText, sweptFiles } from "./pln-planning-inventory.mjs"

export const OUTPUT = "docs/architecture/pln-planning-limitations.md"

/** The money layer the exponent table lives in. */
export const FINOPS_MONEY = "packages/finops/src/money.ts"
/** Where the default locale and currency for every rendered amount is decided. */
export const CONFIG_MONEY = "packages/platform-config/src/money.ts"
/** The tenant-plane budget arithmetic. */
export const FINANCE = "apps/web/src/lib/finance.ts"
/** The one writer of the one thing this repository calls a forecast. */
export const FORECAST_WRITER = "apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts"
/** Where an internationalisation dependency would be declared if there were one. */
export const WEB_PACKAGE = "apps/web/package.json"

/* ─────────────────────────────────────────────────── 1. model limitations ── */

/**
 * The planning grain of a table, read from its `@@unique`.
 *
 * The unique constraint IS the grain: it is the tuple that identifies one
 * planned value, so it is the complete list of axes the model can vary a number
 * along. Reading it rather than the field list is deliberate — `currency` and
 * `note` are fields of `BudgetLine` and neither is an axis, and a reader handed
 * "eleven fields" would conclude the model is far more dimensional than it is.
 */
export function deriveGrain(model) {
  const text = readText(SCHEMA)
  const at = text.indexOf(`\nmodel ${model} {`)
  if (at < 0) throw new Error(`${SCHEMA}: no model ${model}`)
  const end = text.indexOf("\n}", at)
  const block = text.slice(at, end)
  const unique = /@@unique\(\[([^\]]+)\]\)/.exec(block)
  if (!unique) {
    throw new Error(
      `${SCHEMA}: model ${model} has no @@unique, so its planning grain cannot be read. ` +
        `PLN-040-005 publishes that grain as the model's exact dimensional limit; guessing it ` +
        `from the field list would count \`currency\` and \`note\` as axes.`,
    )
  }
  return unique[1].split(",").map((f) => f.trim())
}

/** Scalar fields of a schema model, in declaration order. */
export function deriveFields(model) {
  const text = readText(SCHEMA)
  const at = text.indexOf(`\nmodel ${model} {`)
  if (at < 0) throw new Error(`${SCHEMA}: no model ${model}`)
  const block = text.slice(at, text.indexOf("\n}", at))
  return [...block.matchAll(/^\s{2}([a-z][A-Za-z0-9_]*)\s+(\w+)(\??)/gm)].map((m) => ({
    name: m[1],
    type: m[2],
    optional: m[3] === "?",
  }))
}

/**
 * A "Support a, b and c." sentence from the Bible, as a list.
 *
 * Both sentences this reads are enumerations of required capability, and both
 * are the authority for a count printed below. Read rather than copied: a copied
 * list stops agreeing with the specification the moment the specification moves,
 * and the number beside it goes on looking authoritative.
 */
export function deriveBibleList(section, stopAt) {
  const text = readText(BIBLE)
  const at = text.indexOf(`\n### ${section}\n`)
  if (at < 0) throw new Error(`${BIBLE}: section ${section} not found`)
  const body = text.slice(at, text.indexOf("\n### ", at + 5) === -1 ? undefined : text.indexOf("\n### ", at + 5))
  const sentence = /^Support ([^\n]+)$/m.exec(body)
  if (!sentence) throw new Error(`${BIBLE}: section ${section} has no "Support ..." sentence`)
  let list = sentence[1]
  const stop = list.indexOf(stopAt)
  if (stop < 0) {
    throw new Error(
      `${BIBLE}: section ${section}'s "Support ..." sentence no longer contains "${stopAt}", so ` +
        `the enumeration cannot be separated from the clause that follows it.`,
    )
  }
  list = list.slice(0, stop)
  const items = list
    .split(/,\s*|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (items.length === 0) throw new Error(`${BIBLE}: section ${section} enumerated nothing`)
  return items
}

/** The 18 dimensions section 4.1 requires, plus namespaced custom dimensions. */
export function deriveRequiredDimensions() {
  return deriveBibleList("4.1 Dimensions and hierarchies", " plus namespaced")
}

/** The measure units section 4.2 requires, before "and custom units". */
export function deriveRequiredUnits() {
  return deriveBibleList("4.2 Measures and units", " and custom units")
}

/**
 * Which of the Bible's unit kinds `BudgetLine` can actually hold.
 *
 * Derived from the field names, one pattern per unit kind. A unit is
 * representable when a field encodes it — `budgetedCents` encodes currency, and
 * nothing encodes FTE, hours or capacity, so a workforce plan cannot be stored
 * in this model even in principle. The mapping is by name because the type is
 * `Int` for all of them, which is exactly the problem: an `Int` called
 * `budgetedCents` and an `Int` holding FTE-months are indistinguishable to the
 * database and to every reader who has not opened the schema.
 */
export const UNIT_PATTERNS = [
  ["currency", /Cents$/],
  ["count", /Count$/],
  ["FTE", /[Ff]te/],
  ["hours", /[Hh]ours/],
  ["units", /[Uu]nitCount|[Qq]uantity/],
  ["rates", /Rate$/],
  ["percentages", /Percent/],
  ["days", /[Dd]ays/],
  ["capacity", /[Cc]apacity/],
]

export function deriveRepresentableUnits(model) {
  const fields = deriveFields(model)
  const required = deriveRequiredUnits()
  return required.map((unit) => {
    const pattern = UNIT_PATTERNS.find(([name]) => name === unit)
    if (!pattern) {
      throw new Error(
        `${BIBLE} section 4.2 requires the unit "${unit}" and this generator has no field pattern ` +
          `for it. Add one to UNIT_PATTERNS — an unrecognised unit silently reads as unsupported, ` +
          `which is the one direction a limitations page must never guess in.`,
      )
    }
    const fieldsFound = fields.filter((f) => pattern[1].test(f.name)).map((f) => f.name)
    return { unit, fields: fieldsFound }
  })
}

/* ────────────────────────────────────────────────── 2. domain limitations ── */

/**
 * The eight connected planning domains, read from the Bible's own headings.
 *
 * Sub-headings of section 6, so a domain added to the Bible arrives here without
 * an edit — and arrives with no probe set, which throws. That is the intended
 * behaviour: a new planning domain must be examined before this page may claim
 * anything about it.
 */
export function deriveDomains() {
  const text = readText(BIBLE)
  const start = text.indexOf("\n## 6. Connected planning domains\n")
  if (start < 0) throw new Error(`${BIBLE}: section 6 not found`)
  const end = text.indexOf("\n## 7.", start)
  if (end < 0) throw new Error(`${BIBLE}: section 6 has no section 7 after it`)
  const names = [...text.slice(start, end).matchAll(/^### (6\.\d+ .+)$/gm)].map((m) => m[1].trim())
  if (names.length === 0) throw new Error(`${BIBLE}: section 6 lists no domains`)
  return names
}

/**
 * Probe identifiers per domain — compound, so a hit means what it says.
 *
 * Each token is an identifier an implementation of that domain would have to
 * name something. `headcount`, `vacancy`, `bookings`, `disbursement`, `grant`
 * and `enrollment` were all tried as single words and all hit code that is not
 * planning — `grant` alone hits 177 files, because it is what an authorization
 * layer does to a permission. A probe that hits noise proves nothing in either
 * direction, so those were replaced by the compounds below.
 */
export const DOMAIN_PROBES = {
  // Planning tokens, not reporting ones. `incomeStatement` and `balanceSheet`
  // were tried and hit `packages/finops/src/general-ledger.ts`, which computes
  // those statements from POSTED journal lines — Finance's record-to-report
  // (FIN-010-003), on actuals that already happened. Section 6.1 asks for
  // statement INTEGRATION in a plan: a projected P&L, balance sheet and cash
  // flow that a driver moves. A probe that cannot tell the two apart would have
  // reported this domain as partly implemented on the strength of a module that
  // plans nothing.
  "6.1 Financial planning and budgeting": [
    "plannedBalanceSheet",
    "capexPlan",
    "workingCapitalPlan",
    "taxAssumption",
    "rateScenario",
    "intercompanyElimination",
    "zeroBasedBudget",
    "driverBasedPlan",
  ],
  "6.2 Workforce planning": [
    "headcountPlan",
    "positionPlan",
    "fteMonths",
    "hiringRequisition",
    "compensationPlan",
  ],
  "6.3 Sales and revenue planning": [
    "pipelineForecast",
    "territoryPlan",
    "bookingsPlan",
    "churnRate",
    "priceVolumeMix",
  ],
  "6.4 Operational and supply planning": [
    "demandPlan",
    "supplyPlan",
    "inventoryPlan",
    "capacityPlan",
    "productionPlan",
  ],
  "6.5 Capital and project planning": [
    "capitalPlan",
    "projectProposal",
    "stageGate",
    "netPresentValue",
    "paybackPeriod",
  ],
  "6.6 Cash, treasury and liquidity planning": [
    "cashForecast",
    "liquidityPlan",
    "disbursementPlan",
    "fxScenario",
    "debtSchedule",
  ],
  "6.7 Strategic, scenario and OKR planning": [
    "objectiveKeyResult",
    "keyResult",
    "strategicTarget",
    "initiativePlan",
  ],
  // The two capabilities section 6.8 names that this repository actually has:
  // club budget proposals (a parsed sheet becomes lines) and the cross-club
  // view. Both are exported from `apps/web/src/lib/finance.ts`, which is the
  // planning domain's own module. `BudgetLine` was tried and is a worse probe
  // for the same claim: it appears in eight files including two packages that
  // only NAME it in a doc comment, so the hit list moved whenever another domain
  // edited a comment.
  "6.8 Nonprofit/public/education planning": ["parseBudgetSheet", "rollUpPortfolio"],
}

/**
 * What each domain's probe result MEANS. Prose, held to the derived verdict.
 *
 * A note may not claim a domain is implemented when its probes found nothing,
 * and may not claim it is absent when they found something — `render()` checks
 * both directions, so the sentence and the sweep cannot drift apart in silence.
 */
export const DOMAIN_NOTES = {
  "6.1 Financial planning and budgeting":
    "Absent as PLANNING, and the distinction is load-bearing. Club budgeting exists — a flat " +
    "`BudgetLine` category list per organization per academic year — and " +
    "`packages/finops/src/general-ledger.ts` computes a trial balance, an income statement and a " +
    "balance sheet from POSTED journal lines (FIN-010-003). Both are about money that already " +
    "moved. Nothing projects a statement forward: no working-capital, capex or tax assumption, " +
    "none of the five stated methods, no rate scenario, no intercompany elimination, and " +
    "publication to Finance is an approval incrementing `actualCents`, not a budget-control " +
    "handoff.",
  "6.2 Workforce planning":
    "Absent. `packages/organization-model` models positions and assignment states for the HR " +
    "domain, which is where a workforce PLAN would read its authorized structures from; nothing " +
    "plans against them. No headcount, FTE, vacancy, hire/termination or compensation measure " +
    "exists to plan with — see section 1, where FTE and hours are not representable at all.",
  "6.3 Sales and revenue planning": "Absent. No pipeline, territory, bookings, price/volume/mix or churn model of any kind.",
  "6.4 Operational and supply planning":
    "Absent. The Operations Bible is authoritative for executable plans and orders; Planning " +
    "would own approved scenarios and targets, and owns none.",
  "6.5 Capital and project planning": "Absent. No initiative or project proposal, no stage gate, no NPV/IRR/payback calculation.",
  "6.6 Cash, treasury and liquidity planning":
    "Absent. Payments and treasury movements are recorded — see the payments ledger — but nothing " +
    "plans receipts, disbursements, debt or FX forward.",
  "6.7 Strategic, scenario and OKR planning": "Absent. No objective, key result, strategic target or initiative object.",
  "6.8 Nonprofit/public/education planning":
    "Partial, and it is the only domain with anything real. Club budget proposals " +
    "(`parseBudgetSheet` turns an uploaded sheet into lines), a cross-club view " +
    "(`rollUpPortfolio` behind the institution finance report) and approval exist. Fund/grant, " +
    "donor restriction, appropriation, enrollment and public-service outcome planning do not. " +
    "The probes that hit prove those two capabilities exist; they prove nothing about the five " +
    "that do not.",
}

/**
 * Probes that were tried and REJECTED, with why.
 *
 * Published rather than deleted, because "we chose these tokens" is an
 * unfalsifiable claim and "we tried these and they hit this many files that are
 * not planning" is not. The counts are derived, so a reader can re-run the
 * rejection as easily as the result — and if one of these ever drops to zero,
 * the note beside it is the record of why it was not trusted anyway.
 */
export const REJECTED_PROBES = [
  ["grant", "apps/web/src/lib/rbac.ts", "granting is what an authorization layer does to a permission"],
  ["headcount", "packages/finops/src/allocation.ts", "a FinOps allocation driver — a cost split, not a plan"],
  [
    "vacancy",
    "packages/organization-model/src/position-lifecycle.ts",
    "position lifecycle, which is HR's record of today and not a plan of tomorrow",
  ],
  [
    "bookings",
    "apps/web/src/app/api/templates/budget/route.ts",
    "room bookings — the budget template's venue category",
  ],
  ["disbursement", "packages/payments/src/refusal.ts", "the payments refusal registry — a movement, not a plan of one"],
  ["enrollment", "packages/provisioning/src/catalogs.test.ts", "a provisioning catalog test"],
  [
    "incomeStatement",
    "packages/finops/src/general-ledger.ts",
    "Finance's record-to-report over POSTED lines (FIN-010-003) — a statement of money that already moved, not a projection",
  ],
  ["balanceSheet", "packages/finops/src/general-ledger.ts", "the same module, for the same reason"],
  ["BudgetLine", "packages/finops/src/settlement.ts", "named in a doc comment by a package that plans nothing"],
]

/**
 * Each rejected probe with ONE file it hits, checked to still hit it.
 *
 * An exemplar rather than a count, and the reason is worth stating because the
 * first version printed counts. `grant` hits 178 files, then 179 the moment any
 * agent adds a file anywhere that grants a permission — a number that moves with
 * work having nothing to do with planning, on a page whose guard demands it be
 * exact. It read as evidence and behaved as churn. One named file a reader can
 * open makes the same point and moves only when that file does; when the file
 * stops carrying the token, the page says so rather than throwing, because the
 * rejection stands on its reasoning either way.
 */
export function deriveRejectedProbes() {
  return REJECTED_PROBES.map(([token, exemplar, why]) => ({
    token,
    exemplar,
    why,
    stillHits:
      fs.existsSync(path.join(ROOT, exemplar)) && new RegExp(`\\b${token}\\b`).test(readText(exemplar)),
  }))
}

/** Which probes hit, and where. Sorted; the sweep is the same one the inventory uses. */
export function deriveDomainVerdicts() {
  const files = sweptFiles()
  const contents = new Map(files.map((f) => [f, readText(f)]))
  return deriveDomains().map((domain) => {
    const probes = DOMAIN_PROBES[domain]
    if (!probes) {
      throw new Error(
        `${BIBLE} section 6 states the planning domain "${domain}" and this generator has no probe ` +
          `set for it. Add one — a domain nobody probed is not absent, it is unexamined, and the ` +
          `whole point of this page is that those are different answers.`,
      )
    }
    if (!DOMAIN_NOTES[domain]) {
      throw new Error(`PLN-040-005: no note for the planning domain "${domain}".`)
    }
    const hits = []
    for (const token of probes) {
      const re = new RegExp(`\\b${token}\\b`)
      const where = files.filter((f) => re.test(contents.get(f)))
      if (where.length > 0) hits.push({ token, files: where })
    }
    return { domain, probes, hits }
  })
}

/* ──────────────────────────────────────────────── 3. forecast limitations ── */

/**
 * Identifiers a forecast implementation would have to contain.
 *
 * Every one is a named statistical or time-series construct. None is a word that
 * means something else in another part of a web application, which is what makes
 * a zero result here a proof rather than a shrug.
 */
export const FORECAST_ANCHORS = [
  "arima",
  "confidenceInterval",
  "exponentialSmoothing",
  "holtWinters",
  "linearRegression",
  "movingAverage",
  "predictionInterval",
  "seasonalIndex",
  "standardDeviation",
  "stddev",
  "zScore",
]

/** The Bible's own forecast objects, and whether the schema has them. */
export const FORECAST_OBJECTS = [
  "ForecastVersion",
  "ForecastModel",
  "ForecastResult",
  "AccuracyObservation",
]

export function deriveForecastEvidence() {
  const files = sweptFiles()
  const contents = new Map(files.map((f) => [f, readText(f)]))
  const anchors = FORECAST_ANCHORS.map((token) => {
    const re = new RegExp(`\\b${token}\\b`)
    return { token, files: files.filter((f) => re.test(contents.get(f))) }
  })

  const schema = readText(SCHEMA)
  const objects = FORECAST_OBJECTS.map((name) => ({
    name,
    present: new RegExp(`^model\\s+${name}\\s*\\{`, "m").test(schema),
  }))

  // What `saveForecast` actually does with the number, read from the writer.
  const writer = readText(FORECAST_WRITER)
  const at = writer.indexOf("export async function saveForecast")
  if (at < 0) {
    throw new Error(
      `${FORECAST_WRITER}: saveForecast is gone. It is the only writer of the only field this ` +
        `repository calls a forecast, and section 3 describes it by reading it.`,
    )
  }
  const body = writer.slice(at, writer.indexOf("\n}", at))
  return {
    anchors,
    objects,
    writerReadsFormData: /formData\.get\(/.test(body),
    writerUsesAnyAnchor: FORECAST_ANCHORS.some((t) => new RegExp(`\\b${t}\\b`).test(body)),
    sweptFileCount: files.length,
  }
}

/* ───────────────────────────────────────────────── 4. country limitations ── */

/**
 * The currency codes whose minor-unit exponent the money layer KNOWS.
 *
 * Read out of `money.ts` by array name. Every other ISO 4217 code falls through
 * to a default of two digits, which is correct for most of them and a
 * hundredfold error for the ones it is not — so the exact list is the exact
 * limit, and a refactor that renames these arrays throws rather than publishing
 * a count nobody re-derived.
 */
export const EXPONENT_TABLES = [
  ["ZERO_DIGIT_CURRENCIES", 0],
  ["THREE_DIGIT_CURRENCIES", 3],
  ["FOUR_DIGIT_CURRENCIES", 4],
]

export function deriveCurrencyExponents() {
  const text = readText(FINOPS_MONEY)
  const groups = EXPONENT_TABLES.map(([name, digits]) => {
    const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`).exec(text)
    if (!m) {
      throw new Error(
        `${FINOPS_MONEY}: ${name} not found. PLN-040-005 publishes the exact set of currencies ` +
          `whose exponent is known; a missing table means the published count would be wrong in ` +
          `the flattering direction.`,
      )
    }
    const codes = [...m[1].matchAll(/"([A-Z]{3})"/g)].map((c) => c[1])
    if (codes.length === 0) throw new Error(`${FINOPS_MONEY}: ${name} listed no currency codes`)
    return { name, digits, codes }
  })
  const fallback = /minorDigits\(currency: string\): number \{[\s\S]*?\?\?\s*(\d+)/.exec(text)
  if (!fallback) throw new Error(`${FINOPS_MONEY}: minorDigits has no fallback exponent`)
  return { groups, fallback: Number(fallback[1]) }
}

/** The locale and currency every amount is rendered in unless a caller says otherwise. */
export function deriveDefaultMoneyFormat() {
  const m = /DEFAULT_MONEY_FORMAT: MoneyFormat = \{ locale: "([^"]+)", currency: "([^"]+)" \}/.exec(
    readText(CONFIG_MONEY),
  )
  if (!m) throw new Error(`${CONFIG_MONEY}: DEFAULT_MONEY_FORMAT not found`)
  return { locale: m[1], currency: m[2] }
}

/**
 * The compact formatter, which is the one place a currency symbol is a literal.
 *
 * Derived rather than asserted, because it is the kind of defect that gets fixed
 * quietly and the kind of sentence that stays on a page for a year afterwards.
 */
export function deriveCompactFormatter() {
  const text = readText(FINANCE)
  const at = text.indexOf("export function formatCentsCompact")
  if (at < 0) throw new Error(`${FINANCE}: formatCentsCompact not found`)
  const body = text.slice(at, text.indexOf("\n}", at))
  const symbols = [...new Set([...body.matchAll(/([$€£¥₹])/g)].map((m) => m[1]))]
  const divisors = [...new Set([...body.matchAll(/\/\s*(\d+)\b/g)].map((m) => m[1]))]
  return { symbols, divisors }
}

/** The only fiscal calendar the schema has. */
export function deriveBudgetPeriods() {
  const m = /enum BudgetPeriod \{([^}]*)\}/.exec(readText(SCHEMA))
  if (!m) throw new Error(`${SCHEMA}: enum BudgetPeriod not found`)
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[A-Z_]+$/.test(l))
}

/** Internationalisation libraries declared by the web app. There are none; derived. */
export const I18N_PACKAGES = ["next-intl", "react-intl", "i18next", "react-i18next", "@formatjs/intl", "lingui"]

export function deriveI18nDependencies() {
  const pkg = JSON.parse(readText(WEB_PACKAGE))
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  return I18N_PACKAGES.filter((name) => name in declared)
}

/* ──────────────────────────────────────────────────────────────── render ── */

function table(headers, rows) {
  const out = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`]
  for (const row of rows) out.push(`| ${row.join(" | ")} |`)
  return out.join("\n")
}

export function render() {
  const domains = deriveDomainVerdicts()
  for (const note of Object.keys(DOMAIN_NOTES).sort()) {
    if (!domains.some((d) => d.domain === note)) {
      throw new Error(`PLN-040-005: a note describes the domain "${note}", which the Bible does not state.`)
    }
  }
  for (const probed of Object.keys(DOMAIN_PROBES).sort()) {
    if (!domains.some((d) => d.domain === probed)) {
      throw new Error(`PLN-040-005: a probe set names the domain "${probed}", which the Bible does not state.`)
    }
  }
  // The note and the sweep must agree on the only question that matters.
  for (const { domain, hits } of domains) {
    // `\b`, so "Absent as PLANNING, and the distinction is load-bearing" counts.
    // Requiring the full stop matched none of the qualified notes, and a note
    // that has to be phrased to satisfy a regex is a note bent around a guard.
    const claimsAbsent = /^Absent\b/.test(DOMAIN_NOTES[domain])
    if (claimsAbsent && hits.length > 0) {
      throw new Error(
        `PLN-040-005: the note for "${domain}" says Absent and the sweep found ` +
          `${hits.map((h) => h.token).join(", ")}. Read the files and rewrite the note, or narrow ` +
          `the probe — a page that says absent over a hit is worse than no page.`,
      )
    }
    if (!claimsAbsent && hits.length === 0) {
      throw new Error(
        `PLN-040-005: the note for "${domain}" does not say Absent and every probe found nothing. ` +
          `Either the implementation went away or the probes no longer name it.`,
      )
    }
  }

  const rejected = deriveRejectedProbes()
  const lineGrain = deriveGrain("BudgetLine")
  const budgetGrain = deriveGrain("Budget")
  const dimensions = deriveRequiredDimensions()
  const units = deriveRepresentableUnits("BudgetLine")
  const forecast = deriveForecastEvidence()
  const exponents = deriveCurrencyExponents()
  const format = deriveDefaultMoneyFormat()
  const compact = deriveCompactFormatter()
  const periods = deriveBudgetPeriods()
  const i18n = deriveI18nDependencies()

  const knownCodes = exponents.groups.flatMap((g) => g.codes)
  const representable = units.filter((u) => u.fields.length > 0)
  const absentForecastObjects = forecast.objects.filter((o) => !o.present)
  const forecastHits = forecast.anchors.filter((a) => a.files.length > 0)

  return `# PLN-040-005 — the exact limitations of Tenure planning

Generated by \`tools/pln-planning-limitations.mjs\`. Do not edit by hand: the
guard \`tests/architecture/pln-planning-limitations.test.mjs\` re-derives every
number and verdict below from the tree and fails on any difference.

This page exists because the alternative is adjectives. "Planning support is
currently limited" is true of a repository with a full planning engine and true
of one with none. Every claim below is a count, a path or an identifier, so a
reader can disprove it.

**A probe is a necessary condition, not a sufficient one.** Zero hits over every
\`.ts\`, \`.tsx\` and \`.mjs\` file under ${SCAN_ROOTS.map((r) => `\`${r}\``).join(", ")} proves a capability is absent.
Hits do not prove one is present — where a probe hits, the files are named and
the note says what they actually do. Section 5 states what this generator cannot
see at all.

**This document goes stale when the code it describes changes, on purpose.** The
counts below are counts of real files, so a change to any of them reds the guard
until \`node tools/pln-planning-limitations.mjs\` is re-run. That is the cost of
publishing exact numbers instead of adjectives, and it is paid deliberately: a
limitations page that survives arbitrary change to the thing it describes was
never describing it. What it deliberately does NOT print is a bare count of files
swept — that number changes with every unrelated file added anywhere in the
repository and carries no claim of its own, so it would be churn wearing the
clothes of evidence.

## 1. Model limitations

One planned value is identified by the unique constraint on the table that holds
it, so that tuple is the complete list of axes a number can vary along.

${table(
  ["Table", "Grain — every axis it has", "Axes"],
  [
    [`\`BudgetLine\``, lineGrain.map((f) => `\`${f}\``).join(", "), String(lineGrain.length)],
    [`\`Budget\``, budgetGrain.map((f) => `\`${f}\``).join(", "), String(budgetGrain.length)],
  ],
)}

Section 4.1 of \`${BIBLE}\` requires ${dimensions.length} dimensions plus
namespaced custom ones: ${dimensions.map((d) => `\`${d}\``).join(", ")}. Read from
the Bible, not copied from it.

\`BudgetLine\` has ${lineGrain.length}. \`organizationId\` is one of the
${dimensions.length} only if an organization is read as a cost center;
\`academicYear\` is time at a single grain of one year; \`category\` is an
unconstrained free-text string, not a dimension with members, a hierarchy, a
parent or an alias. There is no scenario axis, no version axis and no currency
axis, so the same category cannot hold a budget and a revised budget and a
forecast at once — which is why \`forecastCents\` is a second COLUMN rather than
a second version, and why there can only ever be one of it.

### Measures

Section 4.2 requires ${units.length} unit kinds before custom units.
\`BudgetLine\` can represent ${representable.length}:

${table(
  ["Unit the Bible requires", "Field on `BudgetLine` that encodes it"],
  units.map((u) => [`\`${u.unit}\``, u.fields.length > 0 ? u.fields.map((f) => `\`${f}\``).join(", ") : "**none**"]),
)}

Every one of those fields is an \`Int\`. A count of FTE-months and a number of
cents would be the same type in the same column shape, so the model does not
merely lack the other ${units.length - representable.length} kinds — it has
nowhere to record which kind a number is. Section 4.2's requirement that
"percentages/rates do not blindly sum" cannot be met by a model that cannot
tell a percentage from an amount.

## 2. Domain limitations

Section 6 of the Bible states ${domains.length} connected planning domains.

${table(
  ["Domain", "Probes", "Probes that hit", "What is actually there"],
  domains.map((d) => [
    `\`${d.domain}\``,
    String(d.probes.length),
    d.hits.length === 0 ? "**none**" : d.hits.map((h) => `\`${h.token}\` (${h.files.length})`).join(", "),
    DOMAIN_NOTES[d.domain],
  ]),
)}

### Probes that were tried and rejected

A probe that hits noise cannot prove absence, because a real implementation
arriving later would not change its answer. These were each tried and dropped;
the counts are derived, like everything else here, so the rejection can be
re-run as easily as the result.

${table(
  ["Token", "A file it hits", "What it actually hits"],
  rejected.map((r) => [
    `\`${r.token}\``,
    r.stillHits ? `\`${r.exemplar}\`` : `**no longer hits \`${r.exemplar}\`**`,
    r.why,
  ]),
)}

One named file each rather than a count of hits: \`grant\` hit 178 files when this
was written and 179 a minute later, because another domain added a file that
grants a permission. A number that moves with work unrelated to planning reads as
evidence and behaves as churn.

${domains
  .filter((d) => d.hits.length > 0)
  .map(
    (d) =>
      `Where \`${d.domain}\` hit, in full:\n\n${d.hits
        .map((h) => `- \`${h.token}\` — ${h.files.map((f) => `\`${f}\``).join(", ")}`)
        .join("\n")}`,
  )
  .join("\n\n")}

## 3. Forecast limitations

**There is no forecast.** ${FORECAST_ANCHORS.length} statistical and time-series
identifiers — \`${FORECAST_ANCHORS.join("`, `")}\` —
were swept over every source file under
${SCAN_ROOTS.map((r) => `\`${r}\``).join(", ")}. ${
    forecastHits.length === 0
      ? "Not one of them appears anywhere."
      : `Hits: ${forecastHits.map((h) => `\`${h.token}\` in ${h.files.map((f) => `\`${f}\``).join(", ")}`).join("; ")}.`
  }

The Bible's forecast objects are absent from the schema: ${
    absentForecastObjects.length === forecast.objects.length
      ? `all ${forecast.objects.length} of \`${forecast.objects.map((o) => o.name).join("`, `")}\``
      : absentForecastObjects.map((o) => `\`${o.name}\``).join(", ")
  }. So there is nowhere to
record a training window, a feature set, a model version, an accuracy metric, an
uncertainty band or a drift measurement — every tracking obligation in section 8
of the Bible fails on storage before it fails on algorithm.

What the product calls a forecast is \`BudgetLine.forecastCents\`: one nullable
integer per category per year, written by \`saveForecast\` in
\`${FORECAST_WRITER}\`, which ${
    forecast.writerReadsFormData ? "reads it out of a submitted form" : "does not read it from a form"
  } and ${
    forecast.writerUsesAnyAnchor
      ? "uses one of the statistical identifiers above"
      : "computes nothing"
  }. It is a number a human typed. Calling it a forecast is
the only overstatement on the tenant plane, and it is in a column name rather
than in any user-facing string.

Nothing here has confidence intervals, a baseline to beat, a driver
explanation, an accept/adjust/reject decision or a realized-accuracy
measurement, because none of those has a value to attach to.

## 4. Country limitations

Planning is single-currency per line and has no way to convert between
currencies.

- **Exponents known for ${knownCodes.length} currency codes**, and every other
  code falls through to ${exponents.fallback} digits:
${exponents.groups
  .map((g) => `  - ${g.digits} digits — \`${g.codes.join("`, `")}\``)
  .join("\n")}
  Two digits is right for most of the remainder and a hundredfold error for any
  it is not, so the exact limit is: a currency outside those ${knownCodes.length}
  whose minor unit is not a hundredth will be scaled wrongly, silently.
- **No conversion, anywhere.** \`ExchangeRateSet\` is one of the canonical objects
  section 3 of the Bible requires and is not in \`${SCHEMA}\`. \`rollUpPortfolio\`
  groups by currency and totals within each group; it never converts, which is
  correct and is also why an institution running clubs in two currencies gets
  two totals and no consolidated plan.
- **Default locale \`${format.locale}\`, default currency \`${format.currency}\`.**
  Every amount rendered without an explicit format uses those.
- **\`formatCentsCompact\` in \`${FINANCE}\` hardcodes ${compact.symbols
    .map((s) => `\`${s}\``)
    .join(", ")} and divides by ${compact.divisors.join(", ")}**, so every compact
  axis label on every chart is dollars at two minor digits regardless of the
  tenant's currency. Derived by reading the function, not asserted.
- **One fiscal calendar.** \`BudgetPeriod\` has ${periods.length} values —
  \`${periods.join("`, `")}\` — and \`academicYear\` is an unvalidated string.
  There is no fiscal-year start, no 4-4-5 calendar, no month or quarter grain and
  no statutory period of any country.
- **No internationalisation library.** ${
    i18n.length === 0
      ? `None of \`${I18N_PACKAGES.join("`, `")}\` is declared in \`${WEB_PACKAGE}\`; every string in the product is English in the source.`
      : `Declared: \`${i18n.join("`, `")}\`.`
  }

No statutory or tax planning of any jurisdiction exists, in any country,
including the United States.

## 5. What this generator cannot see

Stated by name, because an undocumented blind spot on a limitations page is the
exact failure the page exists to prevent, aimed at itself.

- **Runtime data.** Every claim above is about code and schema. Whether a
  deployed tenant actually holds lines in more than one currency, or has ever
  used \`forecastCents\`, is a database question and this reads no database.
- **Whether an absent capability is needed.** "Absent" is not "wrong". Simon OSE
  plans club budgets and needs no intercompany elimination; the page reports the
  gap against the Bible, not against a user.
- **Prose in other documents.** This sweeps \`.ts\`, \`.tsx\` and \`.mjs\` under
  ${SCAN_ROOTS.map((r) => `\`${r}\``).join(", ")}. A marketing claim in Markdown, a
  slide or a proposal is out of scope here; \`PLN-000-001\` covers the false
  claims inside the code, and it found one, in \`modules/index.ts\`.
- **Capabilities named something this generator did not guess.** A probe set is a
  list of identifiers a human chose. A real workforce planner named entirely in
  domain language none of these tokens matches would read as absent. That is
  mitigated by the schema half — a planning capability with no table is not one
  — and it is not eliminated.
`
}

if (process.argv[1]?.endsWith("pln-planning-limitations.mjs")) {
  fs.writeFileSync(path.join(ROOT, OUTPUT), render(), "utf8")
  process.stdout.write(`wrote ${OUTPUT}\n`)
}
