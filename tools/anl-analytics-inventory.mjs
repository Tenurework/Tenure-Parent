/**
 * ANL-000-001 — derive the analytics inventory from the tree.
 *
 * The Analytics Bible §17 asks for an inventory of "every dashboard/report/
 * chart/client-side metric" classified by "source/owner/truth". Half of that is
 * a claim about what exists, and a hand-written list of what exists is stale the
 * day after it is written. So the half a machine can settle is settled here: a
 * deterministic scan of the first-party source tree that finds every analytics
 * artefact and records the exact tokens that made it one.
 *
 * The other half — which rows a number came from, who owns the definition, and
 * whether the surface is telling the truth about freshness — is judgement, and
 * lives in `docs/architecture/anl-analytics-inventory.md`. The guard test
 * `tests/architecture/anl-analytics-inventory.test.mjs` holds the two together:
 * the markdown must classify exactly the artefact ids this script derives, so a
 * new chart cannot appear without somebody stating where its numbers come from.
 *
 * DETERMINISM. This output is committed, and a committed generated file that
 * differs between a Linux CI runner and a Windows checkout is worse than no file
 * at all — it is "current here, stale there". Three rules, all enforced below:
 *
 *   1. Directories are read with `readdirSync(...).sort()`, never in filesystem
 *      order, and every emitted path is POSIX (`/`), never `path.join`'s native
 *      separator.
 *   2. File text is normalised CRLF -> LF before ANY matching or counting, so a
 *      checkout with `core.autocrlf=true` derives the same tokens and the same
 *      line numbers as one without.
 *   3. Arrays are sorted by a stable key before serialising, and the JSON ends
 *      with exactly one newline.
 *
 * Usage:
 *   node tools/anl-analytics-inventory.mjs          # write the JSON
 *   node tools/anl-analytics-inventory.mjs --check  # exit 1 if it would change
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { classify as classifyOwnership } from "./ownership-map.mjs"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const OUTPUT = "docs/architecture/anl-analytics-inventory.json"

/** Source roots scanned. Anything outside these is not first-party product code. */
const SCAN_ROOTS = ["apps/system-studio/src", "apps/web/src"]

/** Directory names never descended into. */
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", "__snapshots__"])

const SOURCE_EXT = new Set([".ts", ".tsx"])

/**
 * Marks and frames the platform draws numbers with. A file living in a
 * `components/charts/` directory IS the chart kit; nothing else is needed to
 * classify it, which is why this rule has no token list.
 */
const CHART_KIT_DIR = "/components/charts/"

/**
 * Import specifiers that reach the chart kit. A component importing one of these
 * renders a governed mark, which makes it part of the analytics surface even
 * when it lives under `components/finance/`.
 */
const CHART_KIT_IMPORTS = ["@/components/charts", "/charts\"", "/charts'", "../ChartFrame", "./ChartFrame"]

/**
 * Aggregation performed by the database. These are the calls that turn rows into
 * a number, and a route or page containing one is publishing a metric whether or
 * not it calls itself a report.
 */
const SERVER_AGGREGATE_TOKENS = [".count(", ".aggregate(", ".groupBy("]

/**
 * Numeric primitives the product renders a metric through. A page containing one
 * is showing somebody a number.
 *
 * `StaleIndicator` is the Studio's, and it is here for the same reason the
 * others are: a page that declares how fresh its numbers are is a page with
 * numbers on it. Without it the scan found nine tenant-side surfaces and zero
 * operator ones, and the FinOps Center — the page from which somebody approves
 * an Aurora cluster — was outside an inventory that claimed to cover every
 * dashboard. `DataTable` is deliberately NOT in this list: a table of tenant
 * names is a list, not a metric, and adding it would classify the tenant
 * directory as analytics.
 */
const METRIC_PRIMITIVE_TOKENS = ["StatTile", "LiveStats", "<Meter", "Sparkline", "ChartFrame", "StaleIndicator"]

/**
 * Aggregation performed in the browser, after the server already answered.
 *
 * This is the list the Bible's §19 prohibition is about — "do not calculate
 * canonical metrics independently in clients" — so it is deliberately the
 * arithmetic shapes, not the React ones. A component that merely renders a
 * server number matches none of these.
 *
 * `Math.round(` and `Math.floor(` were in this list and are not any more. They
 * matched `${Math.round(n / 1024)} KB` in an attachment chip and seven pieces of
 * pixel arithmetic in the calendar grid — unit formatting and layout, not a
 * metric anybody governs. A rule that reports four false artefacts is a rule
 * whose ninety true ones stop being read.
 */
const CLIENT_AGGREGATE_TOKENS = [".reduce(", "Map<string, number>"]

/**
 * Files that are tests, not artefacts.
 *
 * `.itest.` is here because `money-path.itest.ts` sits beside the club finance
 * page and aggregates cents, so the co-location rule classified an integration
 * test as a metric module. A test is evidence ABOUT an artefact, never one.
 */
function isTest(posixPath) {
  return /\.(i?test|spec)\.[a-z]+$/.test(posixPath)
}

/** Native path -> repository-relative POSIX path. Never emit a `\` anywhere. */
function toPosix(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join("/")
}

/** Read a source file with line endings normalised, so Windows derives Linux's answer. */
export function readNormalised(absolute) {
  return fs.readFileSync(absolute, "utf8").replace(/\r\n/g, "\n")
}

/** Every source file under the scan roots, in sorted POSIX order. */
export function sourceFiles(root = ROOT) {
  const out = []
  const walk = (dirAbsolute) => {
    let entries
    try {
      entries = fs.readdirSync(dirAbsolute, { withFileTypes: true })
    } catch {
      return
    }
    // Sorted by name: `readdirSync` order is filesystem order and differs
    // between ext4 and NTFS, which is exactly how a generated file becomes
    // checkout-dependent.
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const child = path.join(dirAbsolute, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(child)
      } else if (SOURCE_EXT.has(path.extname(entry.name))) {
        out.push(child)
      }
    }
  }
  for (const scanRoot of SCAN_ROOTS) walk(path.join(root, scanRoot))
  return out.map((absolute) => path.relative(root, absolute).split(path.sep).join("/")).sort()
}

/** Tokens from `list` present in `text`, in list order. */
function matched(text, list) {
  return list.filter((token) => text.includes(token))
}

/**
 * Classify one file. Returns null when it is not an analytics artefact.
 *
 * `kinds` is the set of rules it matched and `signals` records the literal
 * tokens that fired, so a reader can re-run the match by hand rather than
 * trusting the classification.
 */
export function classify(posixPath, text) {
  if (isTest(posixPath)) return null

  const kinds = []
  const signals = []

  if (posixPath.includes(CHART_KIT_DIR)) {
    kinds.push("chart-kit")
  } else {
    const imports = matched(text, CHART_KIT_IMPORTS)
    if (imports.length > 0) {
      kinds.push("chart-panel")
      for (const token of imports) signals.push(`imports:${token}`)
    }
  }

  const isRoute = /\/app\/.*\/route\.ts$/.test(posixPath)
  const isPage = /\/app\/.*\/page\.tsx$/.test(posixPath)

  const serverAggregates = matched(text, SERVER_AGGREGATE_TOKENS)
  if (isRoute && serverAggregates.length > 0) {
    kinds.push("metric-endpoint")
    for (const token of serverAggregates) signals.push(`aggregate:${token}`)
  }

  if (isPage) {
    const primitives = matched(text, METRIC_PRIMITIVE_TOKENS)
    // A server component that folds rows into a total in plain JavaScript is
    // publishing a metric just as much as one that asks the database for a
    // COUNT. The Studio's audit page does exactly that — `readable.reduce(...)`
    // over every trail — and was outside the inventory until this line existed.
    const pageAggregates = [...serverAggregates, ...matched(text, CLIENT_AGGREGATE_TOKENS)]
    if (primitives.length > 0 || pageAggregates.length > 0 || kinds.includes("chart-panel")) {
      kinds.push("analytics-surface")
      for (const token of primitives) signals.push(`primitive:${token}`)
      for (const token of serverAggregates) signals.push(`aggregate:${token}`)
      for (const token of matched(text, CLIENT_AGGREGATE_TOKENS)) signals.push(`page-math:${token}`)
    }
  }

  // "use client" as the module's first statement, allowing either quote style.
  const isClientModule = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use client["']/.test(text)
  if (isClientModule) {
    const clientAggregates = matched(text, CLIENT_AGGREGATE_TOKENS)
    if (clientAggregates.length > 0) {
      kinds.push("client-side-metric")
      for (const token of clientAggregates) signals.push(`client-math:${token}`)
    }
  }

  if (kinds.length === 0) return null
  return { id: posixPath, kinds: [...new Set(kinds)].sort(), signals: [...new Set(signals)].sort() }
}

/**
 * A module co-located with an analytics surface that does arithmetic on data.
 *
 * The Studio computes its headline figures in `answer.ts`, `posture.ts`,
 * `reach.ts` and friends, sitting beside the `page.tsx` that renders them — so a
 * scan that only classified pages would have recorded the FinOps Center while
 * missing the module that decides what its number IS. Second pass, because the
 * rule is defined relative to the surfaces the first pass found.
 *
 * Deliberately requires the arithmetic as well as the co-location: `styles`
 * modules and a hold-button live in those directories too, and neither is a
 * metric.
 */
function classifyCoLocated(posixPath, text, surfaceDirs) {
  if (isTest(posixPath)) return null
  const base = posixPath.slice(posixPath.lastIndexOf("/") + 1)
  if (base === "page.tsx" || base === "route.ts" || base === "layout.tsx") return null
  if (!surfaceDirs.has(posixPath.slice(0, posixPath.lastIndexOf("/")))) return null
  const signals = [
    ...matched(text, SERVER_AGGREGATE_TOKENS).map((t) => `aggregate:${t}`),
    ...matched(text, CLIENT_AGGREGATE_TOKENS).map((t) => `client-math:${t}`),
  ]
  if (signals.length === 0) return null
  return { id: posixPath, kinds: ["metric-module"], signals: signals.sort() }
}

/** The whole inventory, derived. */
export function derive(root = ROOT) {
  const files = sourceFiles(root)
  const texts = new Map(files.map((f) => [f, readNormalised(path.join(root, f))]))

  const artefacts = []
  for (const posixPath of files) {
    const artefact = classify(posixPath, texts.get(posixPath))
    if (artefact) artefacts.push(artefact)
  }

  const surfaceDirs = new Set(
    artefacts
      .filter((a) => a.kinds.includes("analytics-surface"))
      .map((a) => a.id.slice(0, a.id.lastIndexOf("/"))),
  )
  const already = new Set(artefacts.map((a) => a.id))
  for (const posixPath of files) {
    if (already.has(posixPath)) continue
    const artefact = classifyCoLocated(posixPath, texts.get(posixPath), surfaceDirs)
    if (artefact) artefacts.push(artefact)
  }

  // OWNER is not re-decided here. `tools/ownership-map.mjs` already assigns
  // every source file to exactly one of the platform domains and
  // `tests/architecture/ownership.test.mjs` fails the build on an orphan — so
  // an analytics inventory that invented its own owner column would be a second
  // answer to a question the repository has already settled, free to drift from
  // it. `(shared)` is what the map itself says about a design-system file no
  // domain owns; it is a real answer, not a gap.
  const ownerOf = new Map()
  for (const [domain, files] of classifyOwnership().byDomain) {
    for (const file of files) ownerOf.set(file, domain)
  }
  for (const artefact of artefacts) artefact.owner = ownerOf.get(artefact.id) ?? "(shared)"

  artefacts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const byKind = {}
  for (const artefact of artefacts) {
    for (const kind of artefact.kinds) byKind[kind] = (byKind[kind] ?? 0) + 1
  }

  return {
    requirement: "ANL-000-001",
    generator: "tools/anl-analytics-inventory.mjs",
    classification: "docs/architecture/anl-analytics-inventory.md",
    scanRoots: [...SCAN_ROOTS].sort(),
    rules: {
      "chart-kit": `path contains ${CHART_KIT_DIR}`,
      "chart-panel": `imports one of ${JSON.stringify(CHART_KIT_IMPORTS)}`,
      "metric-endpoint": `app/**/route.ts containing one of ${JSON.stringify(SERVER_AGGREGATE_TOKENS)}`,
      "analytics-surface": `app/**/page.tsx rendering one of ${JSON.stringify(METRIC_PRIMITIVE_TOKENS)}, aggregating server-side, or importing the chart kit`,
      "client-side-metric": `"use client" module containing one of ${JSON.stringify(CLIENT_AGGREGATE_TOKENS)}`,
      "metric-module": "non-page, non-route module in an analytics-surface directory that aggregates",
    },
    counts: { artefacts: artefacts.length, byKind: Object.fromEntries(Object.entries(byKind).sort()) },
    artefacts,
  }
}

/** Serialise exactly the way the committed file is written. LF, one trailing newline. */
export function serialise(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`
}

function main() {
  const inventory = derive()
  const text = serialise(inventory)
  const target = path.join(ROOT, OUTPUT)
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : null

  if (process.argv.includes("--check")) {
    if (current !== text) {
      process.stderr.write(`${OUTPUT} is stale. Re-run: node tools/anl-analytics-inventory.mjs\n`)
      process.exit(1)
    }
    process.stdout.write(`${OUTPUT} is current — ${inventory.counts.artefacts} artefacts.\n`)
    return
  }

  fs.writeFileSync(target, text)
  process.stdout.write(`Wrote ${OUTPUT} — ${inventory.counts.artefacts} artefacts.\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
