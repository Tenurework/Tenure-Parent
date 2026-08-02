import assert from "node:assert/strict"
import fs from "node:fs"
import { test } from "node:test"

import { RUN_LENGTH, nextBatch } from "../../tools/loop/next-batch.mjs"

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
  assert.ok(result.total > 1000, `expected the four documents to parse to >1000 items, got ${result.total}`)
  assert.ok(result.remaining > 0)
  assert.equal(result.batch.length, 10)
})

test("every binding document is represented in a full batch", () => {
  // Straight slice(0, size) walks the sources in order, and with hundreds of GE
  // items ahead of them the two bibles added on 2026-08-02 would not be touched
  // for months — while SIMON carries a Fall 2026 pilot date. This is the
  // assertion that fails if someone restores the slice.
  assert.deepEqual(
    [...sourcesIn(batch(10).items ?? batch(10).batch)].sort(),
    ["EXT", "GE", "SIMON", "STUDIO"],
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
    assert.match(item.id, /^(GE|EXT|STUDIO|SIMON)-(\d{3}-\d{3}|GATE-\d+)$/)
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
