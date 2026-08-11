#!/usr/bin/env node
/**
 * WF-01 — discover every Bible-like document, and compile what it requires.
 *
 * The defect this exists to prevent is not hypothetical; it is the state the
 * repository was in when this was written. Twenty-three Bibles sat at the root
 * carrying 1,696 requirements, and the execution system could see 970 of them.
 * Twelve whole domains — payments, the work graph, the configurator, the
 * connector catalog, pack factory, finance, tenant experience, HCM, operations,
 * analytics, planning — had no representation anywhere: not a ledger row, not a
 * checkbox, not a failing test. Nothing was red. The queue simply did not know
 * they existed, and "1219 items, 123 decided" was a denominator computed from
 * the documents somebody had remembered to wire up.
 *
 * So discovery is dynamic and repo-wide. A document is not skipped because an
 * older Constitution failed to list it; a prefix is not skipped because an older
 * master prompt was written before that Bible existed. Both of those are
 * document-wiring defects, and this file's job is to make them fail loudly.
 *
 * ## Why parsing, not reading
 *
 * Every Bible states its requirements in one shape:
 *
 *     - [ ] PAY-000-002 — Record the approved merchant-of-record default …
 *
 * That is machine-readable, so the import is exact and reproducible rather than
 * a summary somebody's judgement produced. A requirement's text comes from the
 * document verbatim. Nothing here interprets, and nothing here decides whether a
 * requirement is done — status is read from the ledgers, which are the record of
 * work, not from the Bible, which is the record of intent.
 *
 * Usage:
 *   node tools/document-graph.mjs            # write both artifacts
 *   node tools/document-graph.mjs --check    # fail if the committed copies drift
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")

export const GRAPH_PATH = "docs/architecture/architecture-document-graph.yaml"
export const REGISTRY_PATH = "docs/architecture/capability-completeness-registry.yaml"

/**
 * What makes a file a Bible-like authority.
 *
 * Deliberately broad, and matched against the *content* as well as the name. A
 * document that renames itself is still an authority; a document somebody drops
 * in without the word "Bible" in its filename is still an authority. Being
 * over-inclusive costs a classification line. Being under-inclusive is how 726
 * requirements went missing.
 */
const AUTHORITY_MARKERS = [
  /\bBible\b/,
  /\bConstitution\b/,
  /\bMaster (?:Execution )?Prompt\b/,
  /\bImplementation Extension\b/,
  /\bControl Plane\b/,
  /\bDocument Graph\b/,
  /\bCompleteness Audit\b/,
  /BEGIN [A-Z][A-Z \-]+ (?:PROMPT|CONSTITUTION)/,
]

/** Directories that hold copies, builds or dependencies rather than sources. */
// Artefact directories, not source.
//
// `test-results/` is the one that mattered: Playwright writes an
// `error-context.md` per failed test, and this walk collects every `.md` under
// ROOT — so the document graph's content depended on whether the person
// regenerating it had recently run a failing suite. Eight of them were in the
// walk locally and none in CI, which is why `--check` reported the committed
// graph stale on a Linux runner while it was current here, twice, pointing at
// content nobody had edited. They are also `.md` files full of assertion text,
// so a requirement-shaped string inside a failure snapshot could have been
// parsed into the graph as a real requirement.
//
// `.next-visual` and `playwright-report` are the same class, listed before they
// cost anybody the same afternoon.
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".next-visual",
  ".git",
  "dist",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
])

/**
 * A requirement, as the document states it.
 *
 * The `- [ ]` prefix is deliberately not required: some documents state a
 * requirement as a checklist item and some as a bare line, and a parser that
 * insisted on the checkbox would silently drop the second kind — the same class
 * of miss this whole file exists to prevent.
 */
/**
 * Gates are requirements too, and leaving them out understated every
 * denominator this file produces.
 *
 * This matched only `\d{3}-\d{3}`, so it was structurally incapable of emitting
 * `WRK-GATE-000` — while `ledgerStatuses` below happily *read* gate rows, and
 * `global-engine-execution-ledger.md` already carried `GE-GATE-0` through
 * `GE-GATE-4` with decided statuses. The extractor and the reader disagreed,
 * and the extractor was the one nobody checked.
 *
 * The cost: the Work Graph Bible states 88 requirements — 74 numbered and 14
 * gates — and the graph recorded `states_requirements: 74`. Across the root
 * Bibles, 164 gate requirements existed and the registry carried none of them.
 * That is exactly the understated-denominator failure this file's header says
 * it exists to prevent, sitting inside the file that says it.
 *
 * Found by an adversarial reviewer instructed to refute, not by reading.
 */
const REQUIREMENT = /^\s*(?:[-*]\s*\[[ xX]\]\s*|[-*]\s+)?\*{0,2}([A-Z]{2,8}-(?:\d{3}-\d{3}|GATE-\d+))\*{0,2}\s*[—–\-:]\s*(.+?)\s*$/
const ANY_ID = /\b([A-Z]{2,8}-(?:\d{3}-\d{3}|GATE-\d+))\b/g
/**
 * A requirement id, in every shape the Bibles use.
 *
 * `GE-051-005` is the common one; `GE-GATE-4` numbers a release gate and
 * `GE-IDENTITY-014` names a sub-series. All three belong to GE, so the prefix is
 * the FIRST segment and nothing else. Splitting on any capitalised segment
 * invented an `IDENTITY` prefix that no document owns, and the orphan-prefix
 * check then reported a missing Bible that was never missing.
 */
const ANY_REQUIREMENT_ID = /\b([A-Z]{2,8})-(?:\d{3}-\d{3}|GATE-\d+|[A-Z]{2,12}-\d{2,3})\b/g

export function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".md")) out.push(full)
    }
  }
  walk(ROOT)
  // Sorted on the NORMALIZED relative path, not the native absolute one.
  //
  // `path.join` uses the platform separator, and `\` (0x5C) and `/` (0x2F) sort
  // differently against the characters that can follow a directory name — so
  // `docs/a.md` vs `docsX/b.md` orders one way on Linux and the other on
  // Windows. The generated graph lists documents in this order, which made the
  // output platform-dependent: `--check` passed on the machine that wrote the
  // file and failed in CI with "is stale", pointing at content nobody had
  // changed.
  return out.sort((a, b) => (rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0))
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/")

const idFor = (basename) => basename.replace(/\.md$/, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()

/** Lower sorts first. A ` (1)` suffix is a copy; a shorter path is the original. */
const uploadCopyRank = (p) => (/\(\d+\)\.md$/.test(p) ? 1 : 0) * 1000 + p.length

/** The first ATX heading, which every one of these documents leads with. */
function titleOf(text, fallback) {
  const heading = text.split("\n").find((l) => /^#\s+\S/.test(l))
  return heading ? heading.replace(/^#\s+/, "").trim() : fallback
}

function versionOf(name, text) {
  const fromName = name.match(/_v(\d+\.\d+)/)?.[1]
  const fromText = text.match(/^\s*(?:\*\*)?Version(?:\*\*)?\s*[:|]\s*(?:\*\*)?\s*v?(\d+\.\d+)/im)?.[1]
  return fromText ?? fromName ?? "unversioned"
}

/**
 * Requirements stated by a document, in file order.
 *
 * Deduplicated **within** a document: a Bible often restates an id in a summary
 * table after stating it in a checklist, and counting it twice would inflate
 * every denominator the registry produces. The first statement wins, because
 * that is the one carrying the full text.
 */
export function requirementsIn(text) {
  const found = []
  const seen = new Set()

  // The section a requirement is stated under, carried so the work queue can
  // print it without parsing these documents a second time. `next-batch.mjs`
  // had its own parser for exactly this field, over four of the twenty-three
  // authorities, and the divergence is the defect its own comments describe:
  // "Two parsers of the same documents will disagree; the only question is how
  // long before anyone notices."
  let section = ""

  // Fenced blocks are pictures of items, not items. The prompts show the
  // evidence format inside a fence, and the example is a checkbox line like any
  // other — counting it puts a phantom at the head of the queue.
  let inFence = false

  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const heading = /^#{2,4}\s+(.+?)\s*$/.exec(line)
    if (heading) section = heading[1].trim()

    const m = line.match(REQUIREMENT)
    if (!m) continue
    const [, id, statement] = m
    if (seen.has(id)) continue
    seen.add(id)
    found.push({ id, statement: statement.replace(/\s+/g, " ").trim(), section })
  }
  return found
}

export function classify() {
  const documents = []
  const byDigest = new Map()

  for (const file of sourceFiles()) {
    const raw = fs.readFileSync(file)
    // Line endings normalized BEFORE hashing, and the byte count taken from the
    // normalized form.
    //
    // Git converts CRLF to LF on commit and back on checkout, so the same
    // document is 12,761 bytes in a Windows working tree and 12,537 in a Linux
    // one — the difference being exactly its line count. Hashing the raw bytes
    // therefore recorded a property of the CHECKOUT rather than of the
    // document, and `--check` called the committed graph stale in CI while it
    // was current on the machine that wrote it. A digest whose value depends on
    // who generated it also cannot do the job it is here for: `byDigest` uses
    // it to recognise one logical document reached by two paths.
    const bytes = Buffer.from(raw.toString("utf8").split("\r\n").join("\n"), "utf8")
    const text = bytes.toString("utf8")
    const name = path.basename(file)
    const relative = rel(file)
    const isExecutionLedger = /^docs\/implementation\/.+-ledger\.md$/.test(relative)
    const isAuthority =
      !isExecutionLedger && AUTHORITY_MARKERS.some((re) => re.test(name) || re.test(text.slice(0, 4000)))
    if (!isAuthority) continue

    const digest = crypto.createHash("sha256").update(bytes).digest("hex")
    const existing = byDigest.get(digest)
    if (existing) {
      // Byte-identical: one logical document, two physical paths. Registering it
      // twice would double-count every requirement it states.
      //
      // The cleaner path wins the canonical slot. A browser upload of a file that
      // already exists lands as `Name (1).md`, and alphabetical order puts the
      // parenthesis first — so without this the copy becomes the canonical
      // document and the real one becomes its alias, which reads as though
      // somebody had deliberately made the duplicate authoritative.
      const candidate = relative
      if (uploadCopyRank(candidate) < uploadCopyRank(existing.canonical_path)) {
        existing.aliases.push(existing.canonical_path)
        existing.canonical_path = candidate
        existing.id = idFor(path.basename(file))
      } else {
        existing.aliases.push(candidate)
      }
      continue
    }

    const requirements = requirementsIn(text)
    const mentioned = new Set()
    let m
    ANY_ID.lastIndex = 0
    while ((m = ANY_ID.exec(text)) !== null) mentioned.add(m[1])
    const prefixes = new Set()
    ANY_REQUIREMENT_ID.lastIndex = 0
    while ((m = ANY_REQUIREMENT_ID.exec(text)) !== null) prefixes.add(m[1])

    const doc = {
      id: idFor(name),
      title: titleOf(text, name),
      version: versionOf(name, text),
      canonical_path: relative,
      aliases: [],
      sha256: digest,
      bytes: bytes.length,
      // An authority STATES requirements; a reference informs without stating
      // any. Both belong in the graph — a design document nobody classified is
      // how a Bible goes missing — but only an authority can have unimported
      // requirements, so only an authority is held to that.
      role: requirements.length > 0 ? "authority" : "reference",
      requirement_prefixes: [...prefixes].sort(),
      states_requirements: requirements.length,
      mentions_requirement_ids: mentioned.size,
      requirements,
    }
    byDigest.set(digest, doc)
    documents.push(doc)
  }

  // Supersession a document declares about a document outside its own version
  // family, which no filename can express.
  //
  // The Unified Master Prompt v3.0 says of itself: "It supersedes the Version
  // 2.0 execution prompt but does not replace any owning domain Bible." The
  // standalone Execution Prompt v1.0 is the line the Unified prompts replaced,
  // and it states GE-022-002 differently from both v2.0 and v3.0 — a revision
  // the graph must read as history rather than as a live disagreement.
  //
  // Written here rather than parsed out of prose on purpose. A regex over
  // English is a guess about what a sentence meant, and this decides which of
  // two documents governs a requirement. ADR-0008 records the reasoning; this
  // map is the machine-readable half of it, and it is short enough to review.
  const DECLARED_SUPERSESSION = {
    "docs/implementation/Tenure_Claude_Code_Global_Engine_Execution_Prompt_v1.0.md":
      "Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md",
  }

  // Supersession, derived rather than declared. Two documents whose names differ
  // only by version are one family, and the highest version is current. Without
  // this, an older prompt restating a requirement the newer one revised reads as
  // a conflict — which it is not. It is history, and history is supposed to
  // disagree with the present. `GE-022-002` is the live example: the v1.0
  // execution prompt states one thing, and v2.0 and v3.0 agree on another.
  const familyOf = (d) =>
    path.basename(d.canonical_path).replace(/_v\d+\.\d+.*$/, "").replace(/\.md$/, "")
  const versionRank = (v) => {
    const [maj, min] = String(v).split(".").map((n) => parseInt(n, 10) || 0)
    return maj * 1000 + min
  }
  const byFamily = new Map()
  for (const d of documents) {
    d.family = familyOf(d)
    if (!byFamily.has(d.family)) byFamily.set(d.family, [])
    byFamily.get(d.family).push(d)
  }
  for (const siblings of byFamily.values()) {
    const ordered = [...siblings].sort((a, b) => versionRank(a.version) - versionRank(b.version))
    ordered.forEach((d, i) => {
      d.supersedes = ordered.slice(0, i).map((o) => o.canonical_path)
      d.superseded_by = i === ordered.length - 1 ? null : ordered[ordered.length - 1].canonical_path
    })
  }

  for (const [older, newer] of Object.entries(DECLARED_SUPERSESSION)) {
    const from = documents.find((d) => d.canonical_path === older)
    const to = documents.find((d) => d.canonical_path === newer)
    if (!from || !to) {
      throw new Error(
        `DECLARED_SUPERSESSION names "${!from ? older : newer}", which is not a discovered ` +
          `document. An unresolvable supersession would silently do nothing, leaving two live ` +
          `documents disagreeing about the same requirement.`,
      )
    }
    from.superseded_by = newer
    if (!to.supersedes.includes(older)) to.supersedes.push(older)
  }

  documents.sort((a, b) => a.canonical_path.localeCompare(b.canonical_path))
  for (const d of documents) {
    d.aliases.sort()
    d.supersedes.sort()
  }
  return documents
}

/**
 * Status for every requirement, read from the ledgers rather than the Bibles.
 *
 * A Bible says what must be true. A ledger says what somebody built and proved.
 * Deriving status from the Bible's own checkbox would let a document mark its
 * own homework, which is the failure this repository's ledger rules already
 * name: "the evidence generator must derive checked states from verified ledger
 * records."
 */
/**
 * The vocabulary, and only it. `BLOCKED_ARCHITECTURE` used to be here and is
 * not a status: `tools/loop/next-batch.mjs` decides on PASS, BLOCKED_EXTERNAL
 * and NOT_APPLICABLE, so anything else reads as undecided and respins its item
 * every tick. `tests/architecture/ledger-statuses.test.mjs` pins this list
 * against the queue's own source.
 */
export const STATUSES = ["PASS", "FAIL", "BLOCKED_EXTERNAL", "NOT_APPLICABLE"]

const LEDGER_DIR = "docs/implementation"

/**
 * Requirement ids that appear anywhere in the execution system.
 *
 * Distinct from having a ledger record. An id listed in an execution prompt has
 * been *imported* — somebody wired the document in, and the queue can reach it.
 * An id nowhere in `docs/implementation` is invisible: not queued, not counted,
 * not failing. Both are unproven, and only one of them is a wiring defect, so
 * the registry says which.
 */
export function importedIds() {
  const seen = new Set()
  const dir = path.join(ROOT, LEDGER_DIR)
  if (!fs.existsSync(dir)) return seen
  const walk = (d) => {
    // Sorted for the same reason the ledger read below is: `readdirSync` makes
    // no ordering promise, and it differs between NTFS and ext4.
    const entries = fs.readdirSync(d, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".md")) {
        const text = fs.readFileSync(full, "utf8")
        let m
        ANY_ID.lastIndex = 0
        while ((m = ANY_ID.exec(text)) !== null) seen.add(m[1])
      }
    }
  }
  walk(dir)
  return seen
}

export function ledgerStatuses() {
  const status = new Map()
  const dir = path.join(ROOT, LEDGER_DIR)
  if (!fs.existsSync(dir)) return status

  // `.sort()` because `readdirSync` gives no ordering guarantee at all: NTFS
  // hands back names roughly sorted and ext4 hands back whatever the directory
  // hash produces. Ledgers are read into a Map here, and a later file can
  // overwrite an earlier one's entry for the same id — so the iteration order
  // is not cosmetic, it decides which status wins.
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith("-ledger.md")) continue
    const text = fs.readFileSync(path.join(dir, name), "utf8")
    // A ledger entry opens with the id and states `Status: X` before the next
    // entry begins. Anything else in the file — prose, evidence, a mention of a
    // neighbouring id — must not be read as a status.
    const entries = text.split(/\n(?=- \[[ xX]\] \*\*)/)
    for (const entry of entries) {
      const id = entry.match(/^- \[[ xX]\] \*\*([A-Z]{2,8}-\d{3}-\d{3}|[A-Z]{2,8}-GATE-\d+)\*\*/)?.[1]
      if (!id) continue
      // `Status: **BLOCKED_EXTERNAL**` — eleven entries bold it, and a pattern
      // that only matched bare uppercase read every one of them as FAIL. That
      // put work waiting on a human back at the front of the queue every tick,
      // and understated the registry by the same eleven. `next-batch.mjs` hit
      // this exact bug and fixed it in its own parser; the graph kept it, which
      // is what having two parsers costs.
      const declared = entry.match(/^\s*[-*]\s*Status:\s*\*{0,2}([A-Z_]+)/m)?.[1]
      const checked = /^- \[x\]/i.test(entry)
      status.set(id, {
        status: declared && STATUSES.includes(declared) ? declared : checked ? "PASS" : "FAIL",
        source_ledger: `${LEDGER_DIR}/${name}`,
      })
    }
  }
  return status
}

function yamlScalar(v) {
  if (v === null || v === undefined) return "null"
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  const s = String(v)
  // Quote anything that could be read as another type or that carries syntax.
  if (s === "" || /^[\s]|[\s]$|[:#\-?{}[\],&*!|>'"%@`]|^\d|^(true|false|null|yes|no|on|off)$/i.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return s
}

function yamlList(items, indent) {
  if (items.length === 0) return " []"
  return "\n" + items.map((i) => `${indent}- ${yamlScalar(i)}`).join("\n")
}

export function renderGraph(documents) {
  const lines = [
    "# Generated by tools/document-graph.mjs. Do not edit by hand.",
    "#",
    "# WF-01. Every Bible-like authority in this repository, discovered from the",
    "# filesystem rather than from a list somebody maintains. Byte-identical",
    "# copies are ONE logical document with several physical paths, so a",
    "# duplicate upload cannot double-count the requirements it states.",
    "",
    `generated_from: tools/document-graph.mjs`,
    `document_count: ${documents.length}`,
    `alias_count: ${documents.reduce((n, d) => n + d.aliases.length, 0)}`,
    `requirement_statements: ${documents.reduce((n, d) => n + d.requirements.length, 0)}`,
    "# Statements, not distinct requirements: two documents may both state one id,",
    "# and the registry is where each is resolved to a single owner.",
    `authorities: ${documents.filter((d) => d.role === "authority").length}`,
    `references: ${documents.filter((d) => d.role === "reference").length}`,
    "documents:",
  ]
  for (const d of documents) {
    lines.push(`  - id: ${yamlScalar(d.id)}`)
    lines.push(`    title: ${yamlScalar(d.title)}`)
    lines.push(`    version: ${yamlScalar(d.version)}`)
    lines.push(`    canonical_path: ${yamlScalar(d.canonical_path)}`)
    lines.push(`    role: ${yamlScalar(d.role)}`)
    lines.push(`    family: ${yamlScalar(d.family)}`)
    lines.push(`    superseded_by: ${yamlScalar(d.superseded_by)}`)
    lines.push(`    supersedes:${yamlList(d.supersedes ?? [], "      ")}`)
    lines.push(`    sha256: ${yamlScalar(d.sha256)}`)
    lines.push(`    bytes: ${d.bytes}`)
    lines.push(`    aliases:${yamlList(d.aliases, "      ")}`)
    lines.push(`    requirement_prefixes:${yamlList(d.requirement_prefixes, "      ")}`)
    lines.push(`    states_requirements: ${d.requirements.length}`)
    lines.push(`    mentions_requirement_ids: ${d.mentions_requirement_ids}`)
  }
  return lines.join("\n") + "\n"
}

export function buildRegistry(documents, statuses, imported = new Set()) {
  const owners = new Map()
  for (const d of documents) {
    for (const r of d.requirements) {
      // The current version of a family owns what it states; a superseded copy
      // keeps its history and loses the claim. Without this, whichever document
      // the walker reached first would decide what a requirement means, and the
      // walker is alphabetical.
      const held = owners.get(r.id)
      const superseded = Boolean(d.superseded_by)
      if (!held || (held.superseded && !superseded)) {
        owners.set(r.id, { ...r, document: d.canonical_path, superseded })
      }
    }
  }
  const rows = [...owners.values()].sort((a, b) => a.id.localeCompare(b.id))
  return rows.map((r) => {
    const known = statuses.get(r.id)
    return {
      id: r.id,
      prefix: r.id.split("-")[0],
      source_document: r.document,
      // Falls back to the document itself so the field is never empty: the work
      // queue prints it, and a blank phase reads as a parsing failure.
      section: r.section || r.document,
      statement: r.statement,
      status: known?.status ?? "FAIL",
      imported: known ? true : imported.has(r.id),
      reason: known
        ? "decided in the execution ledger"
        : imported.has(r.id)
          ? "imported into the execution system, not yet decided"
          : "NOT IMPORTED — no execution document mentions this requirement",
      ledger: known?.source_ledger ?? null,
    }
  })
}

export function renderRegistry(rows) {
  const byPrefix = new Map()
  const byStatus = new Map()
  for (const r of rows) {
    byPrefix.set(r.prefix, (byPrefix.get(r.prefix) ?? 0) + 1)
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)
  }
  const lines = [
    "# Generated by tools/document-graph.mjs. Do not edit by hand.",
    "#",
    "# Every requirement stated by every discovered authority, with the status the",
    "# execution ledgers record for it. A Bible says what must be true; a ledger",
    "# says what somebody built and proved. Status is read from the ledger, never",
    "# from the Bible's own checkbox — a document must not mark its own homework.",
    "#",
    "# A requirement no ledger mentions is FAIL, not missing. That is the whole",
    "# point: an unimported requirement used to be invisible, and invisible reads",
    "# exactly like done.",
    "",
    `requirement_count: ${rows.length}`,
    "by_prefix:",
    ...[...byPrefix.entries()].sort().map(([k, v]) => `  ${k}: ${v}`),
    "by_status:",
    ...[...byStatus.entries()].sort().map(([k, v]) => `  ${k}: ${v}`),
    `unimported: ${rows.filter((r) => !r.imported).length}`,
    "# Requirements no execution document mentions. Not queued, not counted, not",
    "# failing — invisible, which reads exactly like done. This number is the",
    "# document-wiring defect, and it must reach zero before any completeness",
    "# claim means anything.",
    "requirements:",
  ]
  for (const r of rows) {
    lines.push(`  - id: ${yamlScalar(r.id)}`)
    lines.push(`    prefix: ${yamlScalar(r.prefix)}`)
    lines.push(`    source_document: ${yamlScalar(r.source_document)}`)
    lines.push(`    section: ${yamlScalar(r.section)}`)
    lines.push(`    status: ${yamlScalar(r.status)}`)
    lines.push(`    imported: ${r.imported}`)
    lines.push(`    reason: ${yamlScalar(r.reason)}`)
    lines.push(`    ledger: ${yamlScalar(r.ledger)}`)
    lines.push(`    statement: ${yamlScalar(r.statement)}`)
  }
  return lines.join("\n") + "\n"
}

export function compile() {
  const documents = classify()
  const statuses = ledgerStatuses()
  const rows = buildRegistry(documents, statuses, importedIds())
  return { documents, rows, graph: renderGraph(documents), registry: renderRegistry(rows) }
}

function main() {
  const check = process.argv.includes("--check")
  const { documents, rows, graph, registry } = compile()

  let stale = false
  for (const [file, content] of [[GRAPH_PATH, graph], [REGISTRY_PATH, registry]]) {
    const abs = path.join(ROOT, file)
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null
    if (current === content) continue
    if (check) {
      console.error(`::error::${file} is stale. Run: node tools/document-graph.mjs`)
      stale = true
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content)
      console.log(`Wrote ${file}`)
    }
  }
  if (check && stale) process.exit(1)

  if (!check) {
    const undecided = rows.filter((r) => r.ledger === null).length
    const unimported = rows.filter((r) => !r.imported).length
    console.log(
      `${documents.length} documents (${documents.filter((d) => d.role === "authority").length} authorities, ` +
        `${documents.reduce((n, d) => n + d.aliases.length, 0)} aliases), ${rows.length} requirements: ` +
        `${undecided} undecided, ${unimported} NOT IMPORTED.`,
    )
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
}

export { execFileSync }
