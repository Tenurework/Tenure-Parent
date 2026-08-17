#!/usr/bin/env node
/**
 * EXT-000-003 — the artifacts this repository already has, mapped to the
 * canonical implementation objects, and the places two of them claim the same
 * fact.
 *
 * The requirement: *"Existing implementation/migration/localization/payroll/
 * bank/cutover/support artifacts are mapped to canonical objects; conflicting
 * sources of truth are identified."*
 *
 * Two halves. The map is the first, and it is deliberately a map of what IS
 * here — a ledger is a `Requirement` record whatever it is called, and calling
 * it one is what lets EXT-010 replace it with the object rather than add a
 * seventeenth place to write requirements down. A kind with nothing behind it
 * says so in a sentence naming the requirement that would create it; "no
 * artifact of this kind exists" and "this kind was not looked at" are different
 * answers and collapsing them is the failure this programme keeps paying for.
 *
 * The second half is the conflict scan, and it is derived rather than listed:
 *
 *   - two ADRs issued the same number (`ADR-0008` is issued twice today);
 *   - one document reachable at two paths;
 *   - supersessions the document graph already resolved, carried through with
 *     the winner named — an identified conflict is still a conflict;
 *   - the duplicate-fact families already registered in
 *     `docs/migrations/duplicate-sources.json`, cited rather than re-derived,
 *     because that register is maintained and a second derivation of it would
 *     be the very defect it exists over.
 *
 *   node tools/ext-artifact-map.mjs
 */
import fs from "node:fs"
import path from "node:path"

import { ROOT, classify } from "./document-graph.mjs"

const abs = (p) => path.join(ROOT, p)
const exists = (p) => fs.existsSync(abs(p))
const present = (candidates) => candidates.filter(exists)

function filesIn(dir, re, { dirs = false } = {}) {
  if (!exists(dir)) return []
  return fs
    .readdirSync(abs(dir), { withFileTypes: true })
    .filter((e) => (dirs ? e.isDirectory() : e.isFile()) && re.test(e.name))
    .map((e) => `${dir}/${e.name}`)
    .sort()
}

/**
 * The seven artifact kinds, each with the rules that discover them.
 *
 * `canonical` names the object from §3.2 the artifact is an instance of, and
 * `why` is the judgement — because every one of these is a judgement, and a
 * mapping table with no reasons is a table nobody can disagree with.
 */
export const KINDS = [
  {
    kind: "implementation",
    word: "implementation",
    rules: [
      {
        rule: "execution ledgers",
        canonical: "Requirement",
        why:
          "Each row is a stable id, a statement, a status, evidence and a decision — the Requirement " +
          "object written as Markdown. EXT-010-001 replaces the file with the object; until then this " +
          "IS the requirement store, and 2,265 of them live here.",
        find: () => filesIn("docs/implementation", /-ledger\.md$/),
      },
      {
        rule: "the capability completeness registry",
        canonical: "Requirement",
        why:
          "The generated index of every requirement and its status. A projection of the ledgers rather " +
          "than a second store — tools/document-graph.mjs derives it, and nothing writes it by hand.",
        find: () => present(["docs/architecture/capability-completeness-registry.yaml"]),
      },
      {
        rule: "architecture decision records",
        canonical: "Decision",
        why:
          "Question, options, rationale, effective date and supersession, which is §3.2's Decision " +
          "semantics almost word for word. What they lack is the accountable seat.",
        find: () => filesIn("docs/decisions", /^(ADR-|pay-adr-).*\.md$/i),
      },
      {
        rule: "product decisions of record",
        canonical: "Decision",
        why: "The same object at product scope; PD-007 is cited from code the way a decision id should be.",
        find: () => present(["docs/decisions/PRODUCT-DECISIONS.md"]),
      },
    ],
  },
  {
    kind: "migration",
    word: "migration",
    rules: [
      {
        rule: "the live-application import plan",
        canonical: "ObjectMapping",
        why:
          "Source objects and fields mapped onto this platform's, which is ObjectMapping's whole " +
          "semantics. It is prose rather than executable, so EXT-060-003's contract is not met by it.",
        find: () => present(["docs/migrations/LIVE-APP-IMPORT-PLAN.md"]),
      },
      {
        rule: "baseline validation",
        canonical: "TestScenario",
        why:
          "Seventeen checks, each with its command, exit code and result, run before the import — " +
          "expected outcomes and evidence against a fixture, recorded once and not re-run.",
        find: () => present(["docs/migrations/BASELINE-VALIDATION.md"]),
      },
      {
        rule: "schema migrations",
        canonical: "Deliverable",
        why:
          "Immutable, versioned, ordered artifacts with an approval gate in CI. The migration folder " +
          "is the deliverable; ADR-0001 is the decision behind it.",
        find: () => filesIn("apps/web/prisma/migrations", /^\d{14}_/, { dirs: true }),
      },
      {
        rule: "the duplicate-source register",
        canonical: "ObjectMapping",
        why:
          "Which of two models holds a fact, and which is the copy. That is the lineage half of " +
          "ObjectMapping, kept as data so a guard reads it and a person reads the rendering.",
        find: () => present(["docs/migrations/duplicate-sources.json"]),
      },
    ],
  },
  {
    kind: "localization",
    word: "localization",
    rules: [
      {
        rule: "locale, currency, calendar and direction configuration",
        canonical: "ConfigurationWorkbook",
        why:
          "Structured, validated, defaulted configuration values with an owner — a workbook expressed " +
          "as Zod rather than a spreadsheet, which is the form §3.2 asks for. It is NOT a localization " +
          "pack: no signature, no effective date, no authoritative source, no certification state. " +
          "EXT-040-001 is the contract that adds those and it is FAIL.",
        find: () =>
          present([
            "packages/platform-config/src/localization.ts",
            "packages/platform-config/src/business-calendar.ts",
            "packages/platform-config/src/direction.ts",
          ]),
      },
    ],
  },
  {
    kind: "payroll",
    word: "payroll",
    absent:
      "No payroll artifact exists. The word appears in packages/payments/src/capability-registry.ts " +
      "only to name a payroll provider as a party in the responsibility model, which is a statement " +
      "about who Tenure is not. EXT-050 is the family that creates payroll objects and all ten of its " +
      "requirements are FAIL; EXT-050-009 requires the capability to read UNAVAILABLE until certified.",
    rules: [],
  },
  {
    kind: "bank",
    word: "bank",
    rules: [
      {
        rule: "the payment authority and regulatory boundary",
        canonical: "Decision",
        why:
          "It records who may move money and who may not, with its rationale — a Decision, and the " +
          "one EXT-080-010 depends on. It is not bank connectivity: there is no ISO 20022 registry, " +
          "no bank master and no payment file in this repository, and EXT-080's ten items are FAIL.",
        find: () => present(["docs/payments/payment-authority-and-regulatory-boundary.md"]),
      },
    ],
  },
  {
    kind: "cutover",
    word: "cutover",
    rules: [
      {
        rule: "the pilot runbook",
        canonical: "CutoverTask",
        why:
          "Ordered steps with an executor, a verification and a rollback boundary — CutoverTask's " +
          "semantics, at deployment scope. There is no minute-level plan, no command roles and no " +
          "go/no-go gate: EXT-100 is the family that adds those and it is outside this band.",
        find: () => present(["docs/RUNBOOK.md"]),
      },
    ],
  },
  {
    kind: "support",
    word: "support",
    rules: [
      {
        rule: "operational runbooks",
        canonical: "HypercareCase",
        why:
          "Detection, workaround, owner and permanent fix for one failure mode each — the case, " +
          "written ahead of the incident rather than after it.",
        find: () => filesIn("docs/runbooks", /\.md$/),
      },
      {
        rule: "handoff notes",
        canonical: "Deliverable",
        why:
          "A scoped, owned, reviewable artifact handed to somebody else — which is what a Deliverable " +
          "is. Knowledge transfer, not an incident.",
        find: () => filesIn("docs/handoff", /\.md$/),
      },
    ],
  },
]

/** The canonical objects §3.2 defines, read from the extension itself. */
export function canonicalObjects(
  extension = "docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md",
) {
  const lines = fs.readFileSync(abs(extension), "utf8").split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith("### 3.2 "))
  const end = lines.findIndex((l, i) => i > start && l.startsWith("### 3.3 "))
  const objects = []
  for (const line of lines.slice(start, end)) {
    const m = /^\|\s*`([A-Za-z]+)`\s*\|/.exec(line)
    if (m) objects.push(m[1])
  }
  return objects
}

/** The map, resolved against the tree. */
export function resolveArtifactMap() {
  return KINDS.map((k) => ({
    kind: k.kind,
    word: k.word,
    absent: k.absent ?? null,
    rules: (k.rules ?? []).map((r) => ({
      rule: r.rule,
      canonical: r.canonical,
      why: r.why,
      artifacts: r.find(),
    })),
  }))
}

const ADR_NUMBER = /^(ADR|pay-adr)-(\d{4})-/i

/**
 * Decision-record numbers issued more than once, as `[number, paths]`.
 *
 * Pure, and separate from the directory read, so the detector can be shown
 * failing on a collision and NOT failing on a series — a detector nobody has
 * seen fire reports zero for the same reason a disconnected smoke alarm does.
 * `pay-adr-0001` and `ADR-0001` are different series, so the series name is
 * part of the key.
 */
export function duplicateDecisionNumbers(files) {
  const byNumber = new Map()
  for (const file of files) {
    const m = ADR_NUMBER.exec(path.basename(file))
    if (!m) continue
    const key = `${m[1].toLowerCase()}-${m[2]}`
    if (!byNumber.has(key)) byNumber.set(key, [])
    byNumber.get(key).push(file)
  }
  return [...byNumber]
    .filter(([, files]) => files.length > 1)
    .map(([number, files]) => [number, [...files].sort()])
    .sort(([a], [b]) => (a < b ? -1 : 1))
}

/**
 * Where two artifacts claim one fact.
 *
 * `resolution` is null when nothing in the repository says which wins. That is
 * the only field a reader needs to act on, and `UNRESOLVED_CONFLICTS` holds the
 * count shut.
 */
export function conflicts() {
  const found = []

  // 1. Two ADRs issued the same number. The number is the citation — code and
  //    ledgers refer to "ADR-0008" — so two of them make every citation ambiguous.
  for (const [number, files] of duplicateDecisionNumbers(filesIn("docs/decisions", /\.md$/))) {
    found.push({
      conflict: `${files.length} decision records are numbered ${number}`,
      paths: files,
      resolution: null,
    })
  }

  // 2. One document at two paths, and 3. the supersessions the graph resolved.
  const docs = classify()
  const byBase = new Map()
  for (const d of docs) {
    const base = path.basename(d.canonical_path)
    if (!byBase.has(base)) byBase.set(base, [])
    byBase.get(base).push(d)
  }
  for (const [base, group] of [...byBase].sort()) {
    if (group.length < 2) continue
    const winner = group.find((d) => !d.superseded_by)
    found.push({
      conflict: `${base} exists at ${group.length} paths with different content`,
      paths: group.map((d) => d.canonical_path).sort(),
      resolution: winner ? `docs/architecture/architecture-document-graph.yaml names ${winner.canonical_path} current` : null,
    })
  }
  for (const d of docs) {
    if (!d.superseded_by) continue
    if ([...byBase.values()].some((g) => g.length > 1 && g.includes(d))) continue
    found.push({
      conflict: `${d.canonical_path} is superseded and still states requirements`,
      paths: [d.canonical_path, d.superseded_by],
      resolution: `the document graph names ${d.superseded_by} current`,
    })
  }

  // 4. The duplicate-fact register, cited.
  const register = JSON.parse(fs.readFileSync(abs("docs/migrations/duplicate-sources.json"), "utf8"))
  for (const family of register.families ?? []) {
    found.push({
      conflict: `${family.fact}: ${family.sources.map((s) => s.model).join(" / ")}`,
      paths: ["docs/migrations/duplicate-sources.json"],
      resolution: `registered as ${family.verdict}`,
    })
  }

  return found
}

/**
 * Conflicts nothing in the repository resolves.
 *
 * MAY ONLY SHRINK, and the guard asserts both directions: a number raised to
 * make a build pass is the failure the number exists to prevent.
 */
export const UNRESOLVED_CONFLICTS = 1

if (process.argv[1] && path.basename(process.argv[1]) === "ext-artifact-map.mjs") {
  const objects = new Set(canonicalObjects())
  let mapped = 0
  for (const k of resolveArtifactMap()) {
    console.log(`\n${k.kind}`)
    if (k.rules.length === 0) console.log(`  (none) ${k.absent}`)
    for (const r of k.rules) {
      mapped += r.artifacts.length
      console.log(
        `  ${r.canonical}${objects.has(r.canonical) ? "" : "  ← NOT A §3.2 OBJECT"} ← ${r.rule} (${r.artifacts.length})`,
      )
      for (const a of r.artifacts) console.log(`      ${a}`)
    }
  }
  const c = conflicts()
  console.log(`\n${mapped} artifacts mapped to ${objects.size} canonical objects.`)
  console.log(`${c.length} conflicting sources of truth, ${c.filter((x) => !x.resolution).length} unresolved:`)
  for (const x of c) console.log(`  ${x.resolution ? "·" : "✗"} ${x.conflict}\n      ${x.paths.join("\n      ")}`)
}
