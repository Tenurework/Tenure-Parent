#!/usr/bin/env node
/**
 * The Operations-domain code inventory, derived from the tree.
 *
 *   node tools/ops-operations-inventory.mjs            # write the document
 *   node tools/ops-operations-inventory.mjs --check    # fail if it is stale
 *
 * OPS-000-001 asks for an inventory of "current operations/inventory/project/
 * event code and false claims". An inventory is a claim about the repository,
 * and a hand-written one is stale the day after it is written — so this derives
 * every row from a file that exists and the guard
 * `tests/architecture/ops-operations-inventory.test.mjs` re-derives it and
 * compares. A row nobody can re-derive is prose.
 *
 * Three sources, all read-only:
 *
 *   1. `Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md`
 *      §2 "Shared operational model" — the canonical entity names, parsed from
 *      the backticked identifiers in that section's bullet list. The Bible is
 *      the spec, so the left-hand column of the coverage table is not a list
 *      somebody typed.
 *   2. `apps/web/prisma/schema.prisma` — every `model` and `enum` it declares,
 *      with the line it is declared on.
 *   3. The tenant product source — `apps/web/src`, `packages/` and
 *      `modules/` — scanned for Operations vocabulary, which is where a false
 *      Operations claim would live if there were one.
 *
 * ## Why the verdicts are authored and still cannot rot
 *
 * Whether `inventory` in `apps/web/src/lib/partition-services.ts` means stock
 * on hand or a list of AWS dependencies is a judgement, and a judgement has to
 * be written by somebody. What must not be possible is for the judgement to
 * drift away from the code it judges. So `VERDICTS` below is authored, and
 * `build()` refuses to emit when a scanned file has no verdict or a verdict
 * names a file with no matches — the same shape as `validateManifest` refusing
 * a module manifest whose dimensions and gaps disagree. Adding a line that says
 * `warehouse` to `apps/web/src` makes this generator throw, not shrug.
 *
 * ## Determinism
 *
 * The output has to be byte-identical on Linux and Windows or the committed
 * document is "current here, stale in CI". So: directories are read and sorted
 * with a codepoint comparator (never `localeCompare`), paths are emitted
 * POSIX-separated, every file is read as utf8 and normalised to LF before it is
 * parsed or measured, the document is joined with LF, and nothing here reads a
 * clock, a hash of raw bytes, or git.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")

export const BIBLE = "Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md"
export const SCHEMA = "apps/web/prisma/schema.prisma"
export const OUTPUT = "docs/architecture/ops-operations-code-inventory.md"

/** The tenant product surface. A tenant-facing Operations claim could only be here. */
export const PRODUCT_ROOTS = ["apps/web/src", "modules", "packages"]

/**
 * The operator plane, scanned separately and reported as a count.
 *
 * Its `inventory` is the AWS estate inventory — `apps/system-studio/src/lib/aws/inventory.ts`
 * is literally the module that lists AWS resources — and listing two hundred
 * rows of it beside four rows of tenant product would bury the finding. It is
 * counted rather than dropped, because a scope exclusion nobody can measure is
 * indistinguishable from not having looked.
 */
export const OPERATOR_ROOTS = ["apps/system-studio/src"]

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", ".turbo"])

/**
 * Operations vocabulary.
 *
 * Words whose ordinary software meaning is the Operations meaning, so a hit is
 * worth reading. Deliberately excludes `resource`, `delivery`, `task`, `order`,
 * `routing` and `dispatch`: every one of them is a general-purpose word in a
 * Next.js application, and a scan that reported them would produce a thousand
 * rows nobody reads, which is the same as no scan.
 */
export const TERMS = [
  "bill of material",
  "bill of materials",
  "cycle count",
  "field service",
  "fulfilment",
  "fulfillment",
  "inventory",
  "logistics",
  "manufacture",
  "manufacturing",
  "nonconformance",
  "procurement",
  "production run",
  "purchase order",
  "putaway",
  "shipment",
  "shop floor",
  "subinventory",
  "supply chain",
  "unit of measure",
  "warehouse",
  "work order",
]

/**
 * What each matched file's Operations vocabulary actually means there.
 *
 * `sense` is the reading; `claim` is the verdict that matters to OPS-000-001 —
 * `unrelated-word` or `operations-capability`. Every file the scan finds must
 * appear here and every entry here must be found by the scan; `build()` throws
 * otherwise.
 */
export const VERDICTS = [
  [
    "apps/web/src/lib/a11y/theme-tokens.ts",
    "unrelated-word",
    "the design token inventory in `tools/entry-point-inventory.mjs` — a list of CSS custom properties",
  ],
  [
    "apps/web/src/lib/dev-login.ts",
    "unrelated-word",
    "an institution's purchasing timetable for Okta, in a comment about when the dev door can be removed",
  ],
  [
    "apps/web/src/lib/partition-services.ts",
    "unrelated-word",
    "\"an inventory of *this app's* dependencies\" — which AWS services the application calls",
  ],
  [
    "apps/web/src/lib/policies.ts",
    "unrelated-word",
    "OSE policy text shown to a club: \"All logistics, planning and expenses are managed by students\"",
  ],
  [
    "packages/identity/src/handoff.ts",
    "unrelated-word",
    "`docs/architecture/aws-inventory.json`, the source a handoff field cites",
  ],
  [
    "packages/identity/src/handoff.test.ts",
    "unrelated-word",
    "the same `source: \"inventory\"` string, in a fixture",
  ],
  [
    "packages/identity/src/session.ts",
    "unrelated-word",
    "the \"device/session inventory\" of Bible §21.2 — a person's live sessions",
  ],
  [
    "packages/identity/src/session.test.ts",
    "unrelated-word",
    "`sessionInventory`, the same list of sessions",
  ],
  [
    "packages/organization-model/src/organization-model.test.ts",
    "unrelated-word",
    "a department named `logistics` in an org-topology fixture",
  ],
  [
    "packages/organization-model/src/position-lifecycle.test.ts",
    "unrelated-word",
    "`unit-warehouse`, a fixture unit type that holds no seats",
  ],
  [
    "packages/organization-model/src/topology.ts",
    "unrelated-word",
    "\"a warehouse has people *at* it and no seats *in* it\" — the GE-050-003 argument for `holdsSeats`",
  ],
  [
    "packages/platform-config/src/module-permissions.test.ts",
    "unrelated-word",
    "`key: \"procurement\"`, a deliberately foreign manifest key the catalog must refuse",
  ],
  [
    "packages/provisioning/src/provisioning.test.ts",
    "unrelated-word",
    "`systemOfRecord: { procurement: \"external\" }`, a deliberately unknown domain the validator must refuse",
  ],
  [
    "packages/provisioning/src/resource-tags.ts",
    "unrelated-word",
    "`apps/system-studio/src/lib/aws/inventory.ts` calling `tagProblems` on AWS resources",
  ],
]

/**
 * What the three same-named Tenure records actually are.
 *
 * A name collision is the most expensive kind of absence: `Resource` exists, so
 * a reader skimming the schema for Operations coverage sees a canonical entity
 * and moves on. `evidence` is a substring of `apps/web/prisma/schema.prisma`,
 * checked by `build()`, so the description cannot drift from the declaration it
 * describes.
 */
export const COLLISIONS = [
  [
    "Deliverable",
    "a compliance deadline an institution places on a board seat, with reminders",
    "/// Which board seat owns it, matching SeatKey in src/lib/resources.ts",
    "an OPS `Deliverable` is a contracted project output that is accepted and billed",
  ],
  [
    "Delivery",
    "the record that one message reached one participant on one channel",
    "channel       String      // \"in_app\" | \"email\" | \"push\"",
    "an OPS `Delivery` is goods arriving at a ship-to location",
  ],
  [
    "Resource",
    "a board resource — a form, guide, policy, tool or checklist, routed to seats",
    "/// A board resource — a form, guide, policy, tool or checklist, routed to the",
    "an OPS `Resource` is a work-centre resource: labour, machine or tool capacity",
  ],
]

// ── reading ─────────────────────────────────────────────────────────────────

/** utf8, normalised to LF. Every read in this file goes through here. */
export function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
}

/** Codepoint order. `localeCompare` is locale-dependent and would reorder rows per machine. */
export function byCodepoint(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

const posix = (p) => p.split(path.sep).join("/")

/**
 * The canonical entity names, from Bible §2's bullet list.
 *
 * Distinct and sorted — the section names `Reservation` twice (once under
 * demand/supply, once under facilities), and a coverage table with a duplicate
 * row is a table nobody can total.
 */
export function canonicalEntities(bibleText = read(BIBLE)) {
  const section = bibleText.split("\n## ").find((s) => s.startsWith("2. Shared operational model"))
  if (!section) throw new Error(`${BIBLE} no longer has a "## 2. Shared operational model" section.`)
  const names = new Set()
  for (const line of section.split("\n")) {
    if (!line.startsWith("- ")) continue
    for (const m of line.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)) names.add(m[1])
  }
  return [...names].sort(byCodepoint)
}

/** Every `model`/`enum` the tenant schema declares, by name, with its line. */
export function schemaDeclarations(schemaText = read(SCHEMA)) {
  const out = new Map()
  schemaText.split("\n").forEach((line, i) => {
    const m = /^(model|enum)\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/.exec(line)
    if (m) out.set(m[2], { kind: m[1], line: i + 1 })
  })
  return out
}

/** Source files under a root, POSIX-relative to ROOT, in codepoint order. */
export function sourceFiles(roots) {
  const out = []
  const walk = (rel) => {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) return
    const entries = fs.readdirSync(abs, { withFileTypes: true })
    for (const name of entries.map((e) => e.name).sort(byCodepoint)) {
      const child = `${rel}/${name}`
      if (fs.statSync(path.join(ROOT, child)).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(child)
      } else if (/\.(ts|tsx)$/.test(name)) {
        out.push(child)
      }
    }
  }
  for (const r of [...roots].sort(byCodepoint)) walk(posix(r))
  return out
}

const TERM_RE = new RegExp(`\\b(${TERMS.map((t) => t.replace(/ /g, "\\s+")).join("|")})\\b`, "gi")

/**
 * Vocabulary matches, one row per file/line/term.
 *
 * Deduplicated on that triple: `not an inventory of AWS, it is an inventory of`
 * matches twice on one line and is one occurrence of one word to a reader.
 */
export function vocabularyHits(files) {
  const seen = new Set()
  const hits = []
  for (const file of files) {
    read(file)
      .split("\n")
      .forEach((line, i) => {
        for (const m of line.matchAll(TERM_RE)) {
          const term = m[1].toLowerCase().replace(/\s+/g, " ")
          const key = `${file}:${i + 1}:${term}`
          if (seen.has(key)) continue
          seen.add(key)
          hits.push({ file, line: i + 1, term })
        }
      })
  }
  return hits.sort((a, b) => byCodepoint(a.file, b.file) || a.line - b.line || byCodepoint(a.term, b.term))
}

// ── the document ────────────────────────────────────────────────────────────

const PREAMBLE = [
  "# Operations, Supply, Manufacturing and Service — code inventory",
  "",
  "**Generated. Do not edit by hand.**",
  "Run `node tools/ops-operations-inventory.mjs`;",
  "`tests/architecture/ops-operations-inventory.test.mjs` re-derives every row below",
  "from the tree and fails when this file disagrees with it.",
  "",
  "OPS-000-001 asks what operations, inventory, project, event and service code",
  "this repository actually has, and what it falsely claims to have. The answer,",
  "derived below rather than asserted, is that it has none and claims none.",
  "",
  "That second half is the part worth having in writing. The expensive failure",
  "mode for an Operations Cloud is not an empty schema, which nobody can",
  "misread — it is a product that says `inventory` in a dozen places and a",
  "reader who concludes some of it is stock on hand. Section 3 reads every one",
  "of those places and records what the word means there.",
  "",
]

/**
 * Where the authored collision notes and the schema disagree.
 *
 * Both directions, because they fail differently. A canonical name arriving in
 * the schema with no note is the dangerous one — a reader sees `Asset` and
 * concludes Operations has assets. A note for a name that has gone is merely
 * wrong. Exported so the guard can exercise it against synthetic input: a
 * detector that returns `[]` for everything would leave `build()` looking
 * identical and checking nothing.
 */
export function collisionProblems(entities, declarations, collisions, schemaText) {
  const problems = []
  const noted = new Set(collisions.map(([name]) => name))
  const derived = entities.filter((e) => declarations.has(e))
  for (const name of derived) {
    if (!noted.has(name)) {
      problems.push(
        `\`${name}\` is a canonical OPS entity name that now exists in ${SCHEMA} with no note in COLLISIONS — ` +
          `read the declaration and say what the Tenure record actually is.`,
      )
    }
  }
  for (const [name, , evidence] of collisions) {
    if (!derived.includes(name)) {
      problems.push(`COLLISIONS describes \`${name}\`, which no longer collides with ${SCHEMA}.`)
      continue
    }
    if (!schemaText.includes(evidence)) {
      problems.push(`The evidence quoted for \`${name}\` is not in ${SCHEMA}: ${evidence}`)
    }
  }
  return problems.sort(byCodepoint)
}

/**
 * Where the authored verdicts and the vocabulary scan disagree.
 *
 * An unjudged file is the finding that matters: somebody added a line saying
 * `warehouse` to the tenant product and nobody read it. An orphaned verdict is
 * a judgement about code that has gone. Exported for the same reason as above.
 */
export function verdictProblems(hitFiles, verdicts) {
  const problems = []
  const judged = new Set(verdicts.map(([f]) => f))
  const hit = new Set(hitFiles)
  for (const f of [...hit].sort(byCodepoint)) {
    if (!judged.has(f)) {
      problems.push(
        `\`${f}\` uses Operations vocabulary and has no verdict in VERDICTS — read it and record ` +
          `whether the word is the Operations word or a different one.`,
      )
    }
  }
  for (const f of [...judged].sort(byCodepoint)) {
    if (!hit.has(f)) problems.push(`VERDICTS judges \`${f}\`, which the scan no longer matches.`)
  }
  return problems.sort(byCodepoint)
}

/**
 * Assemble the document, refusing when the authored parts have drifted from the
 * derived ones.
 */
export function build() {
  const entities = canonicalEntities()
  const declarations = schemaDeclarations()
  const schemaText = read(SCHEMA)
  const derivedCollisions = entities.filter((e) => declarations.has(e))

  const productHits = vocabularyHits(sourceFiles(PRODUCT_ROOTS))
  const hitFiles = [...new Set(productHits.map((h) => h.file))].sort(byCodepoint)

  const problems = [
    ...collisionProblems(entities, declarations, COLLISIONS, schemaText),
    ...verdictProblems(hitFiles, VERDICTS),
  ]
  if (problems.length > 0) {
    throw new Error(`The authored parts of this inventory no longer match the tree:\n  ${problems.join("\n  ")}`)
  }

  const lines = [...PREAMBLE]

  // ── 1 ──
  const covered = derivedCollisions.length
  lines.push(
    "## 1. Canonical entity coverage",
    "",
    `Bible §2 "Shared operational model" names **${entities.length}** distinct canonical`,
    `entities. \`${SCHEMA}\` declares **${declarations.size}** models and enums.`,
    `**${entities.length - covered}** of the ${entities.length} have no declaration of that name at all;`,
    `the remaining **${covered}** share a name with a Tenure record that is a different`,
    "thing, which section 2 sets out.",
    "",
    "| Canonical entity | `apps/web/prisma/schema.prisma` |",
    "| --- | --- |",
  )
  for (const e of entities) {
    const d = declarations.get(e)
    lines.push(`| \`${e}\` | ${d ? `\`${d.kind} ${e}\` at line ${d.line} — name only, see §2` : "absent"} |`)
  }
  lines.push("")

  // ── 2 ──
  lines.push(
    "## 2. The name collisions",
    "",
    "A missing model is obvious. A model with the right name and the wrong",
    "meaning is not, and it is the reason a coverage count on its own would",
    "overstate what is here. The `evidence` column is a literal substring of",
    "the schema, so a description cannot drift from the declaration it describes.",
    "",
    "| Name | What the Tenure record is | Evidence in the schema | What it is not |",
    "| --- | --- | --- | --- |",
  )
  for (const [name, isA, evidence, isNot] of COLLISIONS) {
    lines.push(`| \`${name}\` | ${isA} | \`${evidence.replace(/\|/g, "\\|")}\` | ${isNot} |`)
  }
  lines.push("")

  // ── 3 ──
  lines.push(
    "## 3. Operations vocabulary in the tenant product",
    "",
    `Scanned: \`${PRODUCT_ROOTS.join("`, `")}\` — every \`.ts\`/\`.tsx\` file, for`,
    `${TERMS.length} Operations terms. **${productHits.length}** matches in`,
    `**${hitFiles.length}** files.`,
    "",
    `Out of scope: the operator plane (\`${OPERATOR_ROOTS.join("`, `")}\`). Its Operations`,
    "vocabulary is the AWS estate sense — `apps/system-studio/src/lib/aws/inventory.ts`",
    "is the module that lists AWS resources — and the Studio reads AWS, never the",
    "tenant database, so nothing there is a claim about tenant operations. Its match",
    "count is deliberately not recorded: it is in the hundreds, it moves with work",
    "that has nothing to do with this domain, and a number in a committed file that",
    "somebody else's commit invalidates is a stale artefact waiting to happen. The",
    "guard holds it to a floor instead, so the exclusion cannot become an empty scan.",
    "",
    "| File | Line | Term |",
    "| --- | --- | --- |",
  )
  for (const h of productHits) lines.push(`| \`${h.file}\` | ${h.line} | ${h.term} |`)
  lines.push("", "### Verdicts", "", "| File | Verdict | The word means |", "| --- | --- | --- |")
  for (const [file, claim, sense] of [...VERDICTS].sort((a, b) => byCodepoint(a[0], b[0]))) {
    lines.push(`| \`${file}\` | ${claim} | ${sense} |`)
  }
  const claims = VERDICTS.filter(([, c]) => c === "operations-capability")
  lines.push(
    "",
    `**${claims.length}** of the ${VERDICTS.length} are Operations capability claims.`,
    claims.length === 0
      ? "No shipped file claims an Operations capability, so there is no false claim to withdraw — the finding is an absence, not an overstatement."
      : `Overstated: ${claims.map(([f]) => `\`${f}\``).join(", ")}.`,
    "",
  )

  // ── 4 ──
  lines.push(
    "## 4. What follows from this",
    "",
    "- OPS-000-002 (shared product/site/item/UOM/order/supply/inventory/work/asset/",
    `  project/service models) starts from zero: ${entities.length - covered} of ${entities.length} canonical entities`,
    "  have no declaration, and the three that share a name are not the entity.",
    "  Every one of them is a table, so the work lands in",
    `  \`${SCHEMA}\` and a migration beside it.`,
    "- OPS-000-003 (state machines, idempotency, concurrency, operational event",
    "  contracts) has nothing to sequence until those entities exist. The",
    "  platform does already carry the two mechanisms it would use —",
    "  `model OutboxEvent` and `model InboxEvent` in the same schema — so the",
    "  event half is a contract over existing machinery rather than new machinery.",
    "- No Operations claim is withdrawn by this inventory, because none was made.",
    "",
  )

  return lines.join("\n")
}

// ── cli ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const text = build()
  const target = path.join(ROOT, OUTPUT)
  if (process.argv.includes("--check")) {
    const committed = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : ""
    if (committed !== text) {
      console.error(`${OUTPUT} is stale. Run: node tools/ops-operations-inventory.mjs`)
      process.exit(1)
    }
    console.log(`${OUTPUT} is current.`)
  } else {
    fs.writeFileSync(target, text)
    console.log(`Wrote ${OUTPUT} (${text.split("\n").length} lines).`)
  }
}
