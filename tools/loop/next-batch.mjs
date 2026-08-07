#!/usr/bin/env node
/**
 * The next batch of work, read from every authority and every ledger.
 *
 * The loop needs to answer "what is next" the same way on every tick, in a new
 * session, with no memory of the last one. Deriving it from the document graph
 * means the answer is a property of the repository rather than of whoever is
 * running — and it cannot drift, because the graph is also what the registry
 * publishes, what the Studio renders, and what `platform-truth.mjs` checks.
 *
 * A batch is DEFAULT_BATCH items by default. That is a push cadence, not a
 * verification cadence: every item inside a batch is still implemented,
 * mutation-proven and verified on its own before the next one starts. Batching
 * the push is a trade — fewer CI cycles, later discovery of a CI-only failure —
 * and it is only safe because `batch-gate.mjs` runs the same checks CI runs
 * before anything is pushed.
 *
 * Usage:
 *   node tools/loop/next-batch.mjs [--size N] [--json]
 */
import { buildRegistry, classify, importedIds, ledgerStatuses } from "../document-graph.mjs"

/**
 * The queue's universe is the document graph, not a list of four documents.
 *
 * This file used to name four prompts and three ledgers by hand. Twenty-three
 * authorities exist and fifteen ledgers exist, so twelve prefixes — ANL, CAT,
 * CFG, FIN, HCM, INT, OPS, PACK, PAY, PLN, TTES, WRK, **755 requirements, and
 * every one of the thirteen domains with zero PASS** — were not in the queue at
 * all. Not failing, not blocked, not counted: invisible. The registry had
 * already been fixed to say `unimported: 0`, so the accounting was honest while
 * the thing that decides what gets *worked on* still could not see three
 * quarters of the remaining programme.
 *
 * That is the defect ADR-0008 and the whole document-graph programme exist to
 * kill, surviving in the one tool where it does the most damage — and it is the
 * second parser this file's own comments warn about, at lines that read: "Two
 * parsers of the same documents will disagree; the only question is how long
 * before anyone notices, and the answer here was months."
 *
 * So there is now one parser. `document-graph.mjs` discovers authorities from
 * the filesystem, discovers ledgers from the filesystem, resolves a requirement
 * stated by two documents to a single owner, and reads status from the ledger
 * rather than from a Bible's own checkbox. Adding a Bible or a ledger now adds
 * its work to this queue with no edit here, which is the property that failed.
 *
 * Read live rather than from the generated YAML: a ledger edited during a
 * session must change the next tick's answer, and the artifact is only rewritten
 * when somebody runs the generator.
 */
export const DEFAULT_BATCH = 10

/**
 * Every requirement every authority states, with the section it is stated under.
 *
 * The Bibles are the checklist; the ledgers are what has been done about them.
 * Both come from the graph, so an id stated by two documents is one item and an
 * id decided in any ledger is decided for the queue.
 */
function registryRows() {
  return buildRegistry(classify(), ledgerStatuses(), importedIds())
}

function promptItems() {
  return registryRows().map((r) => ({
    id: r.id,
    title: r.statement,
    phase: r.section,
    source: r.prefix,
  }))
}

/**
 * The whole programme, for anything that needs to report on it.
 *
 * Exported so `tools/platform-truth.mjs` can render progress without
 * reimplementing this parsing — which it did, against the superseded v1.1
 * prompt, and so the Studio published "65 of 552 — 11.8%" when the true figure
 * was 76 of 1219. Two parsers of the same documents will disagree; the only
 * question is how long before anyone notices, and the answer here was months.
 */
export function programme() {
  const rows = registryRows()
  return {
    items: rows.map((r) => ({ id: r.id, title: r.statement, phase: r.section, source: r.prefix })),
    state: new Map(rows.map((r) => [r.id, r.status])),
    sources: [...new Set(rows.map((r) => r.source_document))].sort(),
  }
}

/**
 * What the ledgers say about each requirement.
 *
 * `BLOCKED_EXTERNAL` counts as decided, not as pending: the loop must not spin
 * on something waiting for a human, and re-attempting it every tick would bury
 * the items it could actually finish. `FAIL` is deliberately NOT decided — a
 * failed item stays queued.
 */
function ledgerState() {
  return new Map(registryRows().map((r) => [r.id, r.status]))
}


export function nextBatch(size) {
  // One walk of the graph, not two. `promptItems()` and `ledgerState()` each
  // classify twenty-three documents and read fifteen ledgers; calling both per
  // tick did that work twice for one answer.
  const rows = registryRows()
  const items = rows.map((r) => ({ id: r.id, title: r.statement, phase: r.section, source: r.prefix }))

  const decided = new Set(
    rows
      .filter((r) => r.status === "PASS" || r.status === "BLOCKED_EXTERNAL" || r.status === "NOT_APPLICABLE")
      .map((r) => r.id),
  )

  const remaining = items.filter((i) => !decided.has(i.id))
  return {
    total: items.length,
    decided: decided.size,
    remaining: remaining.length,
    batch: interleave(remaining, size ?? coveringBatchSize(remaining)),
  }
}

/**
 * A default batch large enough that every document with work appears in it.
 *
 * Fixed at 10 while four documents were binding, which comfortably covered all
 * four in runs of three. Sixteen prefixes are binding now, so a fixed 10 reaches
 * the first four and leaves the other twelve — every zero-PASS domain — waiting
 * behind 781 GE items. That is precisely the starvation `interleave` exists to
 * prevent, and a constant is what would have reintroduced it silently.
 */
export function coveringBatchSize(remaining) {
  const sources = new Set(remaining.map((i) => i.source)).size
  return Math.max(DEFAULT_BATCH, RUN_LENGTH * sources)
}

/** How many consecutive items to take from one document before moving on. */
export const RUN_LENGTH = 3

/**
 * A batch drawn from every document that still has work, not just the first.
 *
 * Straight `slice(0, size)` walks the sources in order, and with 781 GE items
 * ahead of them nothing else would be touched for months — while SIMON carries a
 * Fall 2026 pilot date, STUDIO is the contract the Studio is built against, and
 * twelve domain Bibles have zero PASS between them. Sixteen prefixes are binding
 * right now, so sixteen advance; `coveringBatchSize` is what keeps that true as
 * documents are added.
 *
 * Taken in runs rather than one-at-a-time round-robin because consecutive items
 * inside a document are usually one piece of work — GE-040-001…005 are one
 * identity model — and interleaving at depth 1 would mean paying the
 * context-switch on every single item for no benefit.
 */
function interleave(remaining, size) {
  const queues = new Map()
  for (const item of remaining) {
    if (!queues.has(item.source)) queues.set(item.source, [])
    queues.get(item.source).push(item)
  }

  const batch = []
  // Deliberately not `while (batch.length < size)`: when every queue empties
  // this must terminate, and a length test alone would spin forever on the last
  // partial batch.
  while (batch.length < size) {
    let took = 0
    for (const queue of queues.values()) {
      for (let n = 0; n < RUN_LENGTH && queue.length > 0 && batch.length < size; n++) {
        batch.push(queue.shift())
        took++
      }
    }
    if (took === 0) break
  }
  return batch
}

if (process.argv[1] && process.argv[1].endsWith("next-batch.mjs")) {
  const sizeArg = process.argv.indexOf("--size")
  const size = sizeArg === -1 ? DEFAULT_BATCH : Number(process.argv[sizeArg + 1])
  const result = nextBatch(size)

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(
      `${result.decided}/${result.total} decided · ${result.remaining} remaining\n`,
    )
    for (const item of result.batch) {
      console.log(`  ${item.id}  ${item.title}`)
    }
    if (result.batch.length === 0) console.log("  nothing left — every item is decided")
  }
}
