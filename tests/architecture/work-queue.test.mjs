import assert from "node:assert/strict"
import fs from "node:fs"
import { test } from "node:test"

import { RUN_LENGTH, coveringBatchSize, nextBatch } from "../../tools/loop/next-batch.mjs"

/**
 * The work queue is the only thing that answers "what is next", and every bug
 * it has had was silent.
 *
 * It has shipped two. A heading matcher that only recognised `## Phase N`
 * parsed the newer documents to zero items and reported that as an empty
 * queue — which reads as "all work complete", the worst possible shape for a
 * loop to fail in. A ledger matcher that could not recognise a range read six
 * BLOCKED_EXTERNAL items as not-started and put them at the front, so the loop
 * would have spun on work waiting for a human.
 *
 * Neither showed up as a failure. Both showed up as the loop doing the wrong
 * work confidently, which is why this file asserts on the queue's shape rather
 * than trusting it to look reasonable.
 */

const batch = (size) => nextBatch(size)
const sourcesIn = (items) => new Set(items.map((i) => i.source))

test("the queue is not empty", () => {
  // The failure this exists for: a parser change that silently matches nothing.
  // `nextBatch` would return `{batch: []}`, the loop would print "nothing left
  // — every item is decided", and it would be wrong by a thousand items.
  const result = batch(10)
  assert.ok(
    result.total > 2000,
    `expected every discovered authority to parse to >2000 items, got ${result.total}. ` +
      `It was 1219 while twelve Bibles sat outside the queue.`,
  )
  assert.ok(result.remaining > 0)
  assert.equal(result.batch.length, 10)
})

test("every binding document is represented in a default batch", () => {
  // Straight slice(0, size) walks the sources in order, and with 781 GE items
  // ahead of them nothing else would be touched for months — while SIMON carries
  // a Fall 2026 pilot date and twelve domain Bibles have zero PASS between them.
  // This is the assertion that fails if someone restores the slice.
  //
  // Asserted against the sources that actually have work rather than a hard-coded
  // four. The list WAS `["EXT", "GE", "SIMON", "STUDIO"]`, and it passed for a
  // year while twelve further Bibles sat outside the queue entirely — a fixed
  // expectation cannot notice a document it does not name. Whatever the graph
  // discovers must appear.
  const all = nextBatch(100_000)
  const withWork = sourcesIn(all.batch)
  const defaultBatch = nextBatch().batch

  assert.ok(withWork.size >= 14, `expected the discovered Bibles to carry work, saw ${withWork.size} sources`)
  assert.deepEqual(
    [...sourcesIn(defaultBatch)].sort(),
    [...withWork].sort(),
    "a default batch does not reach every document that still has work — the ones it misses starve",
  )
})

test("the default batch grows when a document is added", () => {
  // The starvation guard above is only as good as the batch size. A constant 10
  // covered four documents in runs of three and covers four of sixteen, so the
  // number has to be derived from the sources, not written down.
  const remaining = nextBatch(100_000).batch
  const sources = sourcesIn(remaining).size

  assert.ok(
    coveringBatchSize(remaining) >= RUN_LENGTH * sources,
    `a batch of ${coveringBatchSize(remaining)} cannot hold a run from each of ${sources} documents`,
  )
  assert.ok(
    coveringBatchSize(remaining.filter((i) => i.source === "GE")) < coveringBatchSize(remaining),
    "the batch size does not respond to how many documents have work",
  )
})

test("items are taken in runs, not one at a time", () => {
  // Consecutive items inside a document are usually one piece of work —
  // GE-040-001…005 are one identity model. Round-robin at depth 1 would pay the
  // context-switch on every item for no benefit.
  //
  // Asserted WITHOUT reference to RUN_LENGTH. The first version of this test
  // read `batch(RUN_LENGTH)` and expected `RUN_LENGTH` items from one source,
  // which is true for every possible value including 1 — so it used the
  // constant as both the input and the expectation and could not detect a
  // change to it. Setting RUN_LENGTH = 1 left it green. Four sources and a
  // batch of four is the fixed shape that actually distinguishes the two:
  // depth-1 round-robin gives four distinct sources, any real run gives fewer.
  const four = batch(4).batch
  assert.equal(four.length, 4)
  assert.ok(
    sourcesIn(four).size < 4,
    "a batch of four spanning four documents means the queue is round-robining one item at a time",
  )
  assert.ok(RUN_LENGTH > 1, "RUN_LENGTH of 1 is round-robin, not runs")
})

test("a batch never repeats an item", () => {
  const ids = batch(40).batch.map((i) => i.id)
  assert.equal(new Set(ids).size, ids.length)
})

test("a batch contains only work items and gates", () => {
  // Both shapes count. Anything else — a new heading convention, a stray
  // reference — must not quietly become a work item.
  for (const item of batch(40).batch) {
    // Any prefix the graph discovers, not a list of four. The shape is what is
    // being asserted — an id is a work item or a gate and nothing else.
    assert.match(item.id, /^[A-Z]{2,8}-(\d{3}-\d{3}|GATE-\d+)$/)
  }
})

test("gates are queued, not dropped", () => {
  // The bug this exists for: a filter written as "leaf items only" excluded
  // every one of the 80 phase gates, silently. Three were already decided and
  // recorded in the ledger while the queue said they were not items at all.
  const all = nextBatch(100_000)
  const gates = all.batch.filter((i) => i.id.includes("-GATE-"))
  assert.ok(gates.length > 60, `expected the documents' phase gates in the queue, found ${gates.length}`)
})

test("asking for more than exists terminates and returns what there is", () => {
  // The interleave drains four queues of different lengths. A loop guarded only
  // by `batch.length < size` spins forever once they empty; this is the test for
  // the `took === 0` break.
  const all = nextBatch(100_000)
  assert.equal(all.batch.length, all.remaining)
})

test("decided items are excluded, and blocked ones count as decided", () => {
  // BLOCKED_EXTERNAL must not come back round. Re-attempting something waiting
  // on a human every tick buries the items that could actually be finished.
  const result = nextBatch(100_000)
  const queued = new Set(result.batch.map((i) => i.id))
  assert.equal(queued.size + result.decided, result.total)
  // Real, specific, and already decided — a regression in ledger parsing shows
  // up here as one of these reappearing.
  for (const done of ["GE-033-004", "GE-031-002", "GE-020-005"]) {
    assert.ok(!queued.has(done), `${done} is recorded in the ledger and must not be re-queued`)
  }
})

test("a bolded status is still a status", () => {
  // `Status: **BLOCKED_EXTERNAL**` — eleven entries write it bolded, and a
  // pattern matching only bare uppercase reads every one as FAIL and puts work
  // that is waiting on a human back at the front of the queue.
  //
  // This has now regressed twice. `next-batch.mjs` hit it, fixed it in its own
  // parser, and wrote the fix up in a comment; `document-graph.mjs` — a second
  // parser of the same ledgers — still had it, so consolidating onto the graph
  // reintroduced the bug the first fix had retired. Asserted on real entries
  // because that is what a regex change actually breaks.
  const queued = new Set(nextBatch(100_000).batch.map((i) => i.id))

  for (const blocked of ["GE-012-002", "GE-041-003", "GE-042-007"]) {
    assert.ok(
      !queued.has(blocked),
      `${blocked} is recorded BLOCKED_EXTERNAL in bold and is back in the queue — ` +
        `the status parser has stopped accepting '**'`,
    )
  }
})

test("every ledger on disk reaches the queue", () => {
  // The queue named three ledgers and four prompts by hand. Fifteen ledgers and
  // twenty-three authorities exist, so twelve prefixes — every domain with zero
  // PASS — were not in it: not failing, not blocked, invisible. A count is not
  // enough to catch that, because the twelve missing documents made the total
  // *smaller* and nothing asserted what it should have been.
  const sources = new Set(nextBatch(100_000).batch.map((i) => i.source))

  for (const prefix of ["ANL", "CAT", "CFG", "FIN", "HCM", "INT", "OPS", "PACK", "PAY", "PLN", "TTES", "WRK"]) {
    assert.ok(sources.has(prefix), `${prefix} states requirements and none of them are queued`)
  }
})

test("the console's programme figures are the queue's, not a second parser's", () => {
  // `tools/platform-truth.mjs` used to parse the documents itself, pointed at
  // the superseded v1.1 prompt, and so the deployed console published
  // "65 of 552 — 11.8%" while the true figure was 76 of 1219 — 6.2%. Nothing
  // failed; it just quietly reported against a document that had been replaced.
  //
  // This asserts the generated artifact the Studio ships agrees with the queue.
  // If someone reintroduces a local parser, these diverge and this test says so.
  const truth = JSON.parse(
    fs.readFileSync(new URL("../../apps/system-studio/src/generated/platform-truth.json", import.meta.url)),
  )
  const all = nextBatch(100_000)
  assert.equal(truth.programme.totalItems, all.total, "console total disagrees with the queue")
  assert.equal(truth.programme.decided, all.decided, "console decided-count disagrees with the queue")
  assert.equal(
    truth.programme.totalItems - truth.programme.decided,
    all.remaining,
    "console arithmetic does not close",
  )
})

test("every item carries the fields the loop prints", () => {
  for (const item of batch(10).batch) {
    assert.equal(typeof item.id, "string")
    assert.ok(item.title.length > 0, `${item.id} has no title`)
    assert.ok(item.phase.length > 0, `${item.id} has no phase`)
    assert.ok(item.source.length > 0, `${item.id} has no source`)
  }
})
