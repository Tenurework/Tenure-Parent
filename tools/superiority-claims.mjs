#!/usr/bin/env node
/**
 * TTES-050-005 — a superiority claim may not ship before the measurement that
 * would make it true.
 *
 * The Bible states the rule twice. §20 asks to "block 'best' claims until
 * measured release gates pass", and §22 lists "claim modern/best from
 * screenshots alone" among the prohibited shortcuts. §18 says what a measured
 * claim would rest on: a per-persona task scorecard (TTES-050-001) and a lawful
 * competitor comparison (TTES-050-002). Neither is decided, so today the
 * honest number of superiority claims Tenure may ship is zero.
 *
 * ── Why this is a gate and not a ban ────────────────────────────────────────
 *
 * The blocking condition is READ, not written here: `gateState` takes the
 * ledger's own statuses for the requirements in `MEASUREMENT_REQUIREMENTS` and
 * lifts the block when every one of them is PASS. The day somebody records
 * eight measured journey budgets and a lawful comparison, "Tenure is faster
 * than the tool you use today" becomes a sentence with evidence behind it and
 * this stops objecting on its own — the same shape
 * `tests/architecture/no-overstated-connectors.test.mjs` uses for provider
 * claims, where the catalog's lifecycle decides rather than a list of banned
 * words.
 *
 * ── Two tiers, because "best" has an innocent reading and "best-in-class" does
 *    not ────────────────────────────────────────────────────────────────────
 *
 * A single word list fails immediately in this repository. `apps/web/src`
 * contains `let best = -1` in a scoring loop, "generation is best-effort" in a
 * doc comment, and "best practice is to cc the club advisor" in real product
 * copy that advises a user about THEIR conduct. None of those is a claim that
 * Tenure is better than anything, and a check that reported them would be
 * triaged into silence within a week — which is how a real claim survives.
 *
 * So:
 *
 *   * HARD phrases (`best-in-class`, `world-class`, `industry-leading`,
 *     `state-of-the-art`, `#1`, …) have no non-claim reading in shipped copy.
 *     Whose product would be best-in-class in Tenure's own interface?
 *   * SOFT phrases (`best`, `modern`, `faster than`, `superior`, …) are claims
 *     only when the same copy string also names the subject — Tenure, Relay,
 *     "this platform". "The fastest refresh window is ten seconds" is a fact
 *     about a cadence; "Tenure is the fastest" is the thing §22 forbids.
 *
 * BENIGN spans are removed before either tier is matched, each for a stated
 * reason, so the exclusion is auditable rather than a bag of words.
 *
 * ── What counts as shipped copy ─────────────────────────────────────────────
 *
 * String literals, template-literal chunks and JSX text — what a reader can
 * actually see — in the surfaces `PUBLISHED_SURFACES` declares. Comments are
 * deliberately STRIPPED, which is the opposite of what
 * `no-overstated-connectors.test.mjs` does, and for a stated reason: that check
 * exists because a doc comment asserting a caller that does not exist misleads
 * the next engineer. This one is about what a USER is told. "The fastest way to
 * leak a provider's token" in a route comment is engineering prose and is not a
 * claim to anybody.
 *
 * Usage:  node tools/superiority-claims.mjs
 *   Prints every claim found and the state of the gate. Exit 1 if a claim is
 *   shipping while the gate is closed. Writes nothing.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

import { ROOT, ledgerStatuses } from "./document-graph.mjs"

/**
 * Where a claim would reach a reader.
 *
 * Each entry is a directory or a file, with the reason it is in scope. This is
 * deliberately NOT "the whole repository": the Bibles, the ledgers and the
 * architecture documents are working papers between engineers, and the one
 * governing this requirement uses the words "world-class" and "best" itself
 * while telling you not to ship them. A checker that scanned them would fail on
 * its own authority document, which is the fastest possible route to being
 * switched off.
 */
export const PUBLISHED_SURFACES = [
  {
    at: "apps/web/src",
    why: "The tenant product. Every string here is something a person doing their job is shown.",
  },
  {
    at: "packages",
    why:
      "Tenant-facing copy that the product renders but does not own — branding, module manifests, " +
      "connector descriptions. A claim placed here reaches every tenant at once.",
  },
  {
    at: "modules",
    why: "The module catalog: section names, entry labels and module summaries render in the tenant shell.",
  },
  {
    at: "README.md",
    why: "The repository's public front page. This repository is public (see its own sign-in note), so this is published.",
  },
]

/** Files inside a surface that are not shipped copy. */
const NOT_SHIPPED = /\.(test|itest|spec)\.[jt]sx?$/

const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/
const PROSE = /\.md$/

/**
 * Spans that contain a superlative and are not a claim about Tenure.
 *
 * Removed from the copy string before matching, so `best practice is to cc the
 * club advisor` contributes no `best` at all rather than being matched and then
 * argued about. Every entry names a real occurrence or a real idiom:
 *
 *   * `best-effort` / `best effort` — an engineering qualifier meaning the
 *     opposite of a guarantee. `apps/web/src/lib/ai.ts:279`.
 *   * `best practice(s)` — advice about the READER's conduct.
 *     `apps/web/src/lib/policies.ts:217` and `:286`.
 *   * `at best` — a hedge, and always a downgrade.
 *   * `best guess`, `best match`, `best available`, `best fit` — the winner of a
 *     comparison inside the product, not a comparison against a competitor.
 *   * `modern browser(s)` — a statement about what the reader needs, not about
 *     what Tenure is.
 */
const BENIGN = [
  { pattern: /\bbest[-\s]?effort(s)?\b/gi, why: "an engineering qualifier: the opposite of a guarantee" },
  { pattern: /\bbest[-\s]practices?\b/gi, why: "advice about the reader's conduct" },
  { pattern: /\bat best\b/gi, why: "a hedge" },
  { pattern: /\bbest (guess|match|available|fit|candidate|option for)\b/gi, why: "the winner of an internal comparison" },
  { pattern: /\bmodern browsers?\b/gi, why: "a statement about what the reader needs" },
]

/**
 * Phrases with no non-claim reading in shipped copy.
 *
 * `#1` is NOT here on its own, and the reason is a false positive this check
 * produced on its first run: `README.md:14` reads "Simon OSE (tenant #1)",
 * meaning the first tenant. `#1` is an ordinal at least as often as it is a
 * boast, so the claim shape is the ranking one — "the #1", or "#1 in/for" — and
 * a bare `#1` is left alone. Recorded rather than quietly fixed, because a
 * findings list that has to be triaged is how a real finding gets ignored.
 */
export const HARD_CLAIMS = [
  /\bbest[-\s]in[-\s](class|breed)\b/i,
  /\bworld[-\s]?class\b/i,
  /\b(industry|market|category)[-\s]leading\b/i,
  /\bstate[-\s]of[-\s]the[-\s]art\b/i,
  /\bcutting[-\s]edge\b/i,
  /\bgold standard\b/i,
  /\bsecond to none\b/i,
  /\bunrivall?ed\b/i,
  /\bmost (advanced|powerful|complete|intuitive|sophisticated)\b/i,
  /\bthe (only|first) (true|real) \w+/i,
  /\bthe #\s?1\b/i,
  /#\s?1\s+(in|for|rated|ranked)\b/i,
  /\bnumber one\b/i,
]

/** Phrases that are claims when the same copy string names the subject. */
export const SOFT_CLAIMS = [
  /\bbest\b/i,
  /\bbetter than\b/i,
  /\b(faster|smarter|simpler|cleaner|easier) than\b/i,
  /\bfastest\b/i,
  /\bsuperior\b/i,
  /\bmodern\b/i,
  /\bseamless(ly)?\b/i,
  /\beffortless(ly)?\b/i,
  /\bpowerful\b/i,
  /\bleading\b/i,
]

/**
 * The subject a soft superlative has to be about.
 *
 * Naming the product, not "the app you are looking at": a soft superlative in a
 * string with no subject is a fact about something else — a refresh cadence, a
 * sort order, a route matcher — and this repository is full of those.
 */
export const CLAIM_SUBJECT = /\bTenure\b|\bRelay\b|\bthis (product|platform|app|system|experience)\b|\bour (product|platform|system)\b/i

/**
 * Every claim in one copy string.
 *
 * Returns `[{ phrase, tier }]`, empty when there is nothing to report.
 */
export function claimsIn(text) {
  let scrubbed = text
  for (const { pattern } of BENIGN) scrubbed = scrubbed.replace(pattern, " ")

  const found = []
  for (const rx of HARD_CLAIMS) {
    const m = rx.exec(scrubbed)
    if (m) found.push({ phrase: m[0].trim(), tier: "hard" })
  }
  if (CLAIM_SUBJECT.test(scrubbed)) {
    for (const rx of SOFT_CLAIMS) {
      const m = rx.exec(scrubbed)
      if (m) found.push({ phrase: m[0].trim(), tier: "soft" })
    }
  }
  return found
}

/**
 * The strings a reader can see, with the line each is on.
 *
 * A single pass over the source, tracking which of five states it is in, so a
 * `//` inside a URL string does not start a comment and a `"` inside a comment
 * does not start a string. A regex-based comment stripper gets both wrong, and
 * the second one is the dangerous direction: it would splice comment prose into
 * a literal and report a claim nobody wrote.
 *
 * JSX text is taken after the pass, as the runs between `>` and `<` that
 * contain no brace — `<p>Tenure is the best</p>`. Limitation, stated because a
 * silent one reads as coverage: text interpolated through an expression
 * (`<p>{blurb}</p>`) is found where `blurb` is defined, as a string literal, or
 * not at all if it comes from the database. This checks the copy in the
 * repository, which is the copy anyone can review.
 */
export function copyStringsIn(source, file = "") {
  const out = []
  const lineStarts = [0]
  for (let k = 0; k < source.length; k++) if (source[k] === "\n") lineStarts.push(k + 1)
  // Binary search rather than `slice(0, i).split()`: the latter is O(n) per
  // call over a 900-line file, and it is the reason the first version of this
  // function reported a claim on line 46 of a file where it was on line 79 —
  // the offsets it was given came from a shortened copy of the source.
  const lineOf = (index) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  const n = source.length
  let i = 0

  // Blanked, NOT shortened, and this is the whole reason the mask exists as a
  // separate array: JSX text is matched against it and its match offsets are
  // reported as line numbers in the ORIGINAL file. A mask that dropped comments
  // and literals would shift every offset after the first one.
  // `.fill(" ")` because `join("")` renders a hole as the empty string, and one
  // hole would shift every offset after it — the exact defect the line-number
  // note above records.
  const mask = new Array(n).fill(" ")
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) mask[k] = source[k] === "\n" ? "\n" : " "
  }

  const push = (text, index, kind) => {
    if (text.trim().length === 0) return
    out.push({ file, line: lineOf(index), kind, text })
  }

  while (i < n) {
    const c = source[i]
    const next = source[i + 1]

    if (c === "/" && next === "/") {
      const start = i
      while (i < n && source[i] !== "\n") i++
      blank(start, i)
      continue
    }
    if (c === "/" && next === "*") {
      const start = i
      i += 2
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++
      i += 2
      blank(start, i)
      continue
    }
    if (c === '"' || c === "'") {
      const quote = c
      const start = i
      i++
      let value = ""
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          value += source[i + 1] ?? ""
          i += 2
          continue
        }
        if (source[i] === "\n") break // an unterminated literal: stop rather than run away
        value += source[i]
        i++
      }
      i++
      push(value, start, "string")
      blank(start, i)
      continue
    }
    if (c === "`") {
      const start = i
      i++
      let value = ""
      let depth = 0
      while (i < n) {
        if (source[i] === "\\") {
          value += source[i + 1] ?? ""
          i += 2
          continue
        }
        if (depth === 0 && source[i] === "$" && source[i + 1] === "{") {
          depth = 1
          i += 2
          continue
        }
        if (depth > 0) {
          if (source[i] === "{") depth++
          else if (source[i] === "}") depth--
          i++
          continue
        }
        if (source[i] === "`") break
        value += source[i]
        i++
      }
      i++
      push(value, start, "template")
      blank(start, i)
      continue
    }
    mask[i] = c
    i++
  }

  // JSX text, out of the masked source, so `"a > b"` inside a string cannot
  // open a text run.
  //
  // A run is text when it sits between `>` or `}` on the left and `<` or `{` on
  // the right. `}` and `{` are in those sets because of a claim this check
  // missed on its first run: planting "Tenure. Better than the software your
  // office runs today." into the sign-in footer, which reads
  // `© {new Date().getFullYear()} Tenure. Better than …`, was NOT caught — the
  // run begins after an interpolation, and a `>`-to-`<` reader sees nothing.
  // Interpolated copy is the normal case in this product, so a reader that only
  // handles uninterpolated text covers the easy half.
  //
  // It over-reads in one direction, deliberately: a run between the `}` and `{`
  // of two adjacent code blocks (`} else if (x) {`) is also collected. Code
  // cannot contain a hard claim — `world-class` is not an identifier — and a
  // soft claim needs the product named in the same run, so the cost is a few
  // hundred harmless fragments and the benefit is every interpolated string.
  const masked = mask.join("")
  const DELIMITER = /[<>{}]/g
  let previous = null
  let from = 0
  let hit
  while ((hit = DELIMITER.exec(masked)) !== null) {
    const opensText = previous === ">" || previous === "}"
    const closesText = hit[0] === "<" || hit[0] === "{"
    if (opensText && closesText) push(masked.slice(from, hit.index), from, "jsx-text")
    previous = hit[0]
    from = hit.index + 1
  }
  return out
}

/** Prose surfaces: everything outside a fenced code block. */
export function copyStringsInProse(source, file = "") {
  const out = []
  let fenced = false
  source.split("\n").forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      return
    }
    if (fenced) return
    if (line.trim().length === 0) return
    out.push({ file, line: index + 1, kind: "prose", text: line })
  })
  return out
}

/**
 * Files in scope, from git rather than from a directory walk, so a file added
 * in this commit is checked by the commit that adds it — the same reason
 * `tools/entry-point-inventory.mjs` lists files this way.
 */
export function shippedFiles(surfaces = PUBLISHED_SURFACES) {
  const seen = new Map()
  for (const surface of surfaces) {
    const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", surface.at], {
      encoding: "utf8",
      cwd: ROOT,
    })
      .split("\n")
      .filter(Boolean)
    for (const rel of listed) {
      if (NOT_SHIPPED.test(rel)) continue
      if (!SOURCE.test(rel) && !PROSE.test(rel)) continue
      if (!fs.existsSync(path.join(ROOT, rel))) continue
      if (!seen.has(rel)) seen.set(rel, surface.at)
    }
  }
  return [...seen.keys()].sort()
}

/** Every claim shipping in the declared surfaces, with the count of what was read. */
export function claimsFound(surfaces = PUBLISHED_SURFACES) {
  const files = shippedFiles(surfaces)
  const claims = []
  let strings = 0
  for (const rel of files) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
    const copy = PROSE.test(rel) ? copyStringsInProse(source, rel) : copyStringsIn(source, rel)
    strings += copy.length
    for (const entry of copy) {
      for (const claim of claimsIn(entry.text)) {
        claims.push({ ...entry, ...claim })
      }
    }
  }
  return { files, strings, claims }
}

/**
 * The requirements whose PASS lifts the block, and what each would establish.
 *
 * Both are named by the Bible, not chosen here: §18 is the per-persona
 * scorecard and §18's last paragraph is the lawful competitor benchmark. A
 * claim needs both — a measured Tenure number with nothing to compare it to is
 * not a superiority claim, and a competitor number with no measured baseline of
 * our own compares one number to nothing.
 */
export const MEASUREMENT_REQUIREMENTS = [
  { id: "TTES-050-001", establishes: "measured per-persona task baselines and targets (Bible §18)" },
  { id: "TTES-050-002", establishes: "a lawful competitor comparison of the same task (Bible §18)" },
]

/**
 * Whether claims are allowed to ship, from the ledger's own statuses.
 *
 * `open` is true only when every measurement requirement is PASS.
 * `BLOCKED_EXTERNAL` is not a pass: `TTES-050-002` is blocked on licensed
 * access and a human-subjects protocol, and a claim published while that is
 * true would be exactly the unmeasured claim the requirement forbids.
 */
export function gateState(statuses = ledgerStatuses()) {
  const blocking = MEASUREMENT_REQUIREMENTS.map((r) => ({
    ...r,
    status: statuses.get(r.id)?.status ?? "FAIL",
  })).filter((r) => r.status !== "PASS")
  return { open: blocking.length === 0, blocking }
}

function main() {
  const gate = gateState()
  const { files, strings, claims } = claimsFound()
  process.stdout.write(`Read ${strings} copy strings across ${files.length} shipped files.\n`)
  process.stdout.write(
    gate.open
      ? "Gate OPEN: every measurement requirement is PASS, so a measured claim may ship.\n"
      : `Gate CLOSED by ${gate.blocking.map((b) => `${b.id}=${b.status}`).join(", ")}.\n`,
  )
  for (const c of claims) {
    process.stdout.write(`${c.file}:${c.line} [${c.tier}] ${JSON.stringify(c.phrase)} in ${JSON.stringify(c.text.trim().slice(0, 120))}\n`)
  }
  if (!gate.open && claims.length > 0) {
    process.stdout.write(`\n${claims.length} superiority claim(s) shipping with no measurement behind them.\n`)
    process.exitCode = 1
  }
}

/**
 * The same shape `tools/entry-point-inventory.mjs` uses, and it is load-bearing
 * rather than idiomatic: `tools/ownership-map.mjs` once ran its CLI at module
 * scope, so importing it rewrote the document its own staleness test then
 * checked. This module writes nothing, but a `main()` that ran on import would
 * still set `process.exitCode` inside whatever imported it.
 */
const isCommand = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) main()
