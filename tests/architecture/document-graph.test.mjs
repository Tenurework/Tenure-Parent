import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { test } from "node:test"

import {
  buildRegistry,
  classify,
  GRAPH_PATH,
  importedIds,
  ledgerStatuses,
  REGISTRY_PATH,
  requirementsIn,
  ROOT,
  STATUSES,
} from "../../tools/document-graph.mjs"

/**
 * WF-01 — a Bible cannot be silently skipped.
 *
 * The state this was written in: twenty-three authorities at the repository
 * root stating 1,696 requirements, and an execution system that could see 970
 * of them. Twelve whole domains — payments, work graph, configurator, connector
 * catalog, pack factory, finance, tenant experience, HCM, operations, analytics,
 * planning — had no ledger row, no checkbox, and no failing test. Nothing was
 * red. The queue did not know they existed.
 *
 * That is the failure this file exists to make impossible: not a wrong answer,
 * an absent question. A requirement nobody imported is invisible, and invisible
 * reads exactly like done.
 */

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

/**
 * Requirements no execution document mentions.
 *
 * **Zero, and it stays zero.** It was 895 when this was written — twelve whole
 * domains the queue could not see. `tools/import-requirements.mjs` closed it,
 * and because the assertion below is an equality rather than a ceiling, the
 * next Bible somebody uploads without importing it turns this red on the commit
 * that added it, rather than in six months when the denominator stops adding up.
 *
 * MAY ONLY SHRINK. Raising it to make a build pass is the exact failure it
 * exists to prevent, and the assertion says so in both directions.
 */
const UNIMPORTED = 0

test("the compiled artifacts are current", () => {
  // Generated from the filesystem, so they cannot describe a repository that no
  // longer exists — but only if something re-runs the generator and compares.
  execFileSync("node", ["tools/document-graph.mjs", "--check"], { cwd: ROOT, stdio: "pipe" })
})

test("discovery finds the authorities that are actually there", () => {
  const documents = classify()
  const authorities = documents.filter((d) => d.role === "authority")

  assert.ok(
    documents.length >= 25,
    `Classified ${documents.length} documents. A discovery pass that stops finding files reports ` +
      `no unimported requirements and passes.`,
  )
  assert.ok(
    authorities.length >= 15,
    `Only ${authorities.length} documents state any requirement. The Bibles state theirs as ` +
      `"- [ ] PREFIX-000-001 — text"; if that shape changed, this is now measuring nothing.`,
  )
})

test("a byte-identical upload is one document, not two", () => {
  // A browser upload of a file that already exists lands as `Name (1).md`.
  // Registering both would double-count every requirement the document states,
  // inflating the denominator of every completeness claim derived from it.
  const documents = classify()
  const digests = documents.map((d) => d.sha256)
  assert.equal(new Set(digests).size, digests.length, "two registered documents share a digest")

  const withAliases = documents.filter((d) => d.aliases.length > 0)
  assert.ok(
    withAliases.length > 0,
    "No document has an alias, so the duplicate-collapsing path is not exercised by real data.",
  )
  for (const d of withAliases) {
    assert.ok(
      !/\(\d+\)\.md$/.test(d.canonical_path),
      `"${d.canonical_path}" is the canonical path and looks like an upload copy. The original ` +
        `must win the canonical slot, or the copy reads as the authoritative document.`,
    )
  }
})

test("the requirement parser reads a statement and rejects a mention", () => {
  // Exercised directly, because a parser that silently matched nothing would
  // make every count below zero and every assertion vacuous.
  const parsed = requirementsIn(
    [
      "- [ ] PAY-000-002 — Record the approved merchant-of-record default in an ADR.",
      "- [x] WRK-000-001 — Inventory every current provider logo and route.",
      "**FIN-001-004** — Implement the immutable balanced journal.",
      "See PAY-000-002 for the merchant-of-record decision.", // a mention, not a statement
      "Some prose about GE-051-005 and what it changed.",
    ].join("\n"),
  )
  assert.deepEqual(
    parsed.map((r) => r.id),
    ["PAY-000-002", "WRK-000-001", "FIN-001-004"],
  )
  assert.match(parsed[0].statement, /merchant-of-record/)
})

test("one requirement has one owner", () => {
  // Two documents stating the same id is a precedence question. Two REGISTRY
  // rows for it is a counting error, and it would let a domain appear twice as
  // complete as it is.
  const rows = buildRegistry(classify(), ledgerStatuses(), importedIds())
  const ids = rows.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length, "a requirement id appears twice in the registry")
  assert.ok(rows.length >= 1500, `Registry holds ${rows.length} requirements, expected at least 1500.`)
})

test("a requirement stated twice is stated identically", () => {
  // If two documents state the same id with different text, one of them is a
  // stale copy and picking either silently is how the easier version wins. The
  // mission calls for an ADR and the conflicting requirements held until it
  // lands; this is what notices.
  const statements = new Map()
  const conflicts = []
  // Superseded documents are excluded, and that is not a loophole. The v1.0
  // execution prompt states GE-022-002 one way; v2.0 and v3.0 agree on another.
  // That is a revision, not a disagreement, and treating history as a conflict
  // would make this test permanently red for the one thing it should never
  // complain about — a document being updated.
  const current = classify().filter((d) => d.superseded_by === null)
  for (const doc of current) {
    for (const r of doc.requirements) {
      const prior = statements.get(r.id)
      if (prior && prior.statement !== r.statement) {
        conflicts.push(
          `${r.id}: "${prior.document}" and "${doc.canonical_path}" state it differently`,
        )
      } else if (!prior) {
        statements.set(r.id, { statement: r.statement, document: doc.canonical_path })
      }
    }
  }
  assert.deepEqual(
    conflicts,
    [],
    "The same requirement is stated two different ways:" +
      String.fromCharCode(10) +
      conflicts.join(String.fromCharCode(10)) +
      String.fromCharCode(10) +
      "Resolve it in an ADR and mark the conflicting requirements BLOCKED_EXTERNAL, naming that " +
      "ADR. Never let the shorter version win by being parsed second.",
  )
})

test("every prefix a Bible uses owns at least one requirement", () => {
  // An orphan prefix means a document talks about a family of requirements it
  // never states — usually because the requirements live in a Bible nobody
  // wired in. That is the shape of the original defect.
  const rows = buildRegistry(classify(), ledgerStatuses(), importedIds())
  const owned = new Set(rows.map((r) => r.prefix))

  const orphans = new Set()
  for (const doc of classify()) {
    for (const prefix of doc.requirement_prefixes) {
      // A document may reference another domain's prefix without owning it, so
      // an orphan is a prefix NO document anywhere owns.
      //
      // There used to be a `GATE` skip here. It was wrong twice over: a gate id
      // is `WRK-GATE-000`, whose prefix is WRK, so `GATE` should never have
      // appeared — and while it did, the skip was quietly concealing that the
      // requirement extractor could not read gates at all. 164 of them were
      // missing from the registry behind that one line.
      if (!owned.has(prefix)) orphans.add(`${prefix} (referenced by ${doc.canonical_path})`)
    }
  }
  assert.deepEqual(
    [...orphans].sort(),
    [],
    "A requirement prefix is referenced and owned by nothing. Either the Bible that states it is " +
      "missing from the repository, or the parser cannot read the shape it states them in.",
  )
})

test("every registry status is one the loop can act on", () => {
  const rows = buildRegistry(classify(), ledgerStatuses(), importedIds())
  const unknown = [...new Set(rows.map((r) => r.status))].filter((s) => !STATUSES.includes(s))
  assert.deepEqual(unknown, [], `Statuses outside the declared vocabulary: ${unknown.join(", ")}`)
})

test("the unimported count only shrinks", () => {
  const rows = buildRegistry(classify(), ledgerStatuses(), importedIds())
  const unimported = rows.filter((r) => !r.imported)

  const byPrefix = new Map()
  for (const r of unimported) byPrefix.set(r.prefix, (byPrefix.get(r.prefix) ?? 0) + 1)

  assert.ok(
    unimported.length <= UNIMPORTED,
    `${unimported.length} requirements are in no execution document, up from ${UNIMPORTED}. ` +
      `By prefix: ${JSON.stringify(Object.fromEntries([...byPrefix].sort()))}. ` +
      `This ratchet may only shrink — import the new Bible rather than raising the number.`,
  )
  assert.equal(
    unimported.length,
    UNIMPORTED,
    `${unimported.length} unimported, and the ratchet says ${UNIMPORTED}. Lower UNIMPORTED to ` +
      `${unimported.length} — a ratchet that is not tightened when the debt is paid stops ` +
      `meaning anything.`,
  )
})

test("the registry does not claim more done than the ledgers prove", () => {
  // The one direction that must never drift. A registry that read a Bible's own
  // `- [ ]` checkbox would let a document mark its own homework; status comes
  // from the ledgers, which record work and evidence.
  const rows = buildRegistry(classify(), ledgerStatuses(), importedIds())
  const passing = rows.filter((r) => r.status === "PASS")
  const ledger = ledgerStatuses()

  for (const r of passing) {
    assert.equal(
      ledger.get(r.id)?.status,
      "PASS",
      `${r.id} is PASS in the registry and not PASS in any ledger. Status is derived, never asserted.`,
    )
  }
  assert.ok(passing.length > 0, "No requirement is PASS, so this comparison proves nothing.")
})

test("the committed artifacts say what the compiler says", () => {
  const registry = read(REGISTRY_PATH)
  const graph = read(GRAPH_PATH)
  const rows = buildRegistry(classify(), ledgerStatuses(), importedIds())

  assert.match(registry, new RegExp(`^requirement_count: ${rows.length}$`, "m"))
  assert.match(registry, new RegExp(`^unimported: ${rows.filter((r) => !r.imported).length}$`, "m"))
  assert.match(graph, /^document_count: \d+$/m)
})
