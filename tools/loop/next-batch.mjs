#!/usr/bin/env node
/**
 * The next batch of work, read from the ledger and the execution prompt.
 *
 * The loop needs to answer "what is next" the same way on every tick, in a new
 * session, with no memory of the last one. Deriving it from the two documents
 * means the answer is a property of the repository rather than of whoever is
 * running — and it cannot drift, because the ledger is also what the Studio
 * renders and what `platform-truth.mjs` checks.
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
import fs from "node:fs"

/**
 * The ledgers, in no particular order — they are read as one map.
 *
 * There is one queue but several ledgers, and that is not a contradiction I
 * chose. Both bibles added on 2026-08-02 name their own file in an imperative
 * sentence: "Create `docs/implementation/simon-ose-absorption-execution-ledger.md`
 * and copy every `SIMON-*` item into it", and the same for STUDIO. A binding
 * prompt that says where its record lives does not get to be tidied into
 * somebody else's file.
 *
 * v2.0's "one traceable verification system" is still satisfied, because the
 * thing that has to be single is the *queue* — the answer to "what is next" —
 * and that is computed here across all of them. Splitting the queue would give
 * you a second one nobody runs; splitting the record just gives each document
 * its own page.
 */
const LEDGERS = [
  "docs/implementation/global-engine-execution-ledger.md",
  "docs/implementation/system-studio-aws-control-plane-execution-ledger.md",
  "docs/implementation/simon-ose-absorption-execution-ledger.md",
]

/**
 * The sources of requirements, in the order they are worked.
 *
 * v2.0 SUPERSEDES the v1.1 execution prompt (2026-08-02). It does not replace
 * it destructively: every one of v1.1's 534 GE ids survives into v2.0's 675,
 * verified by set difference, so nothing already decided in the ledger was
 * invalidated by the upgrade. v1.1 is left in the repository as the record of
 * what the first 60 decisions were made against.
 *
 * The extension's EXT items are read into the SAME queue rather than a second
 * one. v2.0 §"Mandatory document ingestion" requires one traceable verification
 * system and forbids duplicating requirements into divergent documents — two
 * queues would be exactly that, and the second would be the one nobody ran.
 */
const SOURCES = [
  { path: "docs/implementation/Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v2.0.md", prefix: "GE" },
  { path: "docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md", prefix: "EXT" },
  // Added 2026-08-02. Both are binding execution prompts in their own right,
  // with their own id namespaces, and they go into the SAME queue for the same
  // reason EXT did: v2.0 requires one traceable verification system, and a
  // second queue is the one nobody runs.
  { path: "docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md", prefix: "STUDIO" },
  { path: "docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md", prefix: "SIMON" },
]

export const DEFAULT_BATCH = 10

/**
 * Every GE item the prompt declares, in order, with its phase.
 *
 * The prompt is the checklist; the ledger is what has been done about it. Read
 * separately because an item that exists in the ledger and not the prompt is a
 * bug in the ledger, and one that exists in the prompt and not the ledger is
 * simply not started — and those need different answers.
 */
function promptItems() {
  return SOURCES.flatMap((source) => itemsFrom(source))
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
  return { items: promptItems(), state: ledgerState(), sources: SOURCES.map((s) => s.path) }
}

function itemsFrom({ path, prefix }) {
  const text = fs.readFileSync(path, "utf8")
  const items = []
  let phase = "Phase 0"

  // The prompt shows the evidence format inside a fenced block before the
  // phases begin, and that example is a checkbox line like any other —
  // `GE-IDENTITY-014` is not an item, it is a picture of one. Counting it put a
  // phantom at the head of the queue. Fences are tracked rather than the id
  // pattern narrowed, because the next example will use a plausible id.
  let inFence = false
  let seenFirstPhase = false

  for (const line of text.split("\n")) {
    if (/^```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    // v1.1 used `## Phase N`. v2.0 and the extension use their own section
    // headings — `### GE-031: Configuration engine`, `## 6. Migration factory`.
    // Matching only "Phase" dropped every item in both new documents, and
    // dropped them as an empty queue rather than an error, which is the worst
    // shape for a loop to fail in: it reads as "nothing left to do".
    const heading = /^#{2,3}\s+(.+?)\s*$/.exec(line)
    if (heading) {
      phase = heading[1].trim()
      seenFirstPhase = true
    }

    // Nothing before the first section heading is an item — that region is the
    // rules, and a checkbox there is prose.
    if (!seenFirstPhase) continue

    const item = new RegExp(`^- \\[([ x])\\]\\s+(${prefix}-[\\w-]+)\\s+—\\s+(.*)$`).exec(line)
    if (!item) continue
    // Two shapes of work, and both count.
    //
    // This filter was written as "leaf items only", to exclude a section id
    // like `EXT-050` that heads a group rather than being a unit of work. No
    // such checkbox exists in any of the four documents — checked, all 80
    // non-leaf ids are gates. So the filter was not excluding section heads, it
    // was excluding every phase gate, and it did that silently: three gates were
    // already decided and recorded in the ledger while the queue said they were
    // not items at all. That is how `decided` came to exceed
    // `total - remaining` by exactly three.
    //
    // A gate is real work — it is the checkpoint that certifies the phase before
    // it, and it carries its own evidence. It appears in document order, after
    // the items it gates, so reaching it in the queue is exactly when it should
    // be evaluated. Anything that is neither shape is still skipped, so a new
    // heading convention cannot quietly become a work item.
    if (!/^[A-Z]+-\d{3}-\d{3}$/.test(item[2]) && !/^[A-Z]+-GATE-\d+$/.test(item[2])) continue
    items.push({ id: item[2], title: item[3].trim(), phase, source: prefix })
  }

  if (items.length === 0) throw new Error(`Parsed no items from ${path} — the format changed.`)
  return items
}

/**
 * What the ledger says about each item.
 *
 * `BLOCKED_EXTERNAL` counts as decided, not as pending: the loop must not spin
 * on something waiting for a human, and re-attempting it every tick would bury
 * the items it could actually finish.
 */
function ledgerState() {
  const state = new Map()
  for (const ledger of LEDGERS) {
    // A ledger that does not exist yet is not an error — it means that
    // document's first item has not been worked. Throwing here would make
    // adding a binding prompt break the loop that is supposed to execute it.
    if (fs.existsSync(ledger)) readLedgerInto(state, fs.readFileSync(ledger, "utf8"))
  }
  return state
}

function readLedgerInto(state, text) {
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    // Two shapes, and the range has to be recognised on its own.
    //
    // A single item is `- [x] **GE-030-001** — …`; a range is
    // `- [ ] **GE-010-002 … 007** — …`. The single-item pattern requires `**`
    // straight after the id, so it does not match a range at all — which made
    // the range branch below unreachable, and every id inside a range came back
    // as "not started" however the ledger described it. That put six
    // BLOCKED_EXTERNAL items at the front of the queue.
    const checkbox = /^- \[([ x])\]\s+\*\*/.exec(lines[i])
    if (!checkbox) continue

    // Both prefixes. The ledger records GE and EXT decisions in one file
    // because they are one verification system — v2.0 forbids splitting
    // requirements across divergent documents, and a second ledger would be
    // exactly that.
    const range = /\*\*((?:GE|EXT|STUDIO|SIMON)-[\w-]+)\s*(?:…|\.\.\.)\s*(\d+)\*\*/.exec(lines[i])
    const single = /^- \[[ x]\]\s+\*\*((?:GE|EXT|STUDIO|SIMON)-[\w-]+)\*\*/.exec(lines[i])
    if (!range && !single) continue

    const done = checkbox[1] === "x"

    // Look ahead for a status line, which is where BLOCKED_EXTERNAL lives.
    let status = done ? "PASS" : "FAIL"
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      // `Status: **BLOCKED_EXTERNAL**` — the ledger bolds it. A pattern that
      // only matched bare uppercase read every blocked item as FAIL and put it
      // straight back in the queue, which is how a loop spins on work that is
      // waiting for a human instead of finishing what it can.
      const s = /Status:\s*\*{0,2}([A-Z_]+)\*{0,2}/.exec(lines[j])
      if (s) {
        status = s[1]
        break
      }
      if (/^- \[[ x]\]/.test(lines[j])) break
    }

    if (range) {
      const [, first, lastNum] = range
      const prefix = first.replace(/\d+$/, "")
      const from = Number(first.slice(prefix.length))
      for (let n = from; n <= Number(lastNum); n++) {
        state.set(`${prefix}${String(n).padStart(first.length - prefix.length, "0")}`, status)
      }
    } else if (single) {
      state.set(single[1], status)
    }
  }
}

export function nextBatch(size = DEFAULT_BATCH) {
  const items = promptItems()
  const state = ledgerState()

  const decided = new Set(
    [...state.entries()].filter(([, s]) => s === "PASS" || s === "BLOCKED_EXTERNAL" || s === "NOT_APPLICABLE").map(([id]) => id),
  )

  const remaining = items.filter((i) => !decided.has(i.id))
  return {
    total: items.length,
    decided: decided.size,
    remaining: remaining.length,
    batch: interleave(remaining, size),
  }
}

/** How many consecutive items to take from one document before moving on. */
export const RUN_LENGTH = 3

/**
 * A batch drawn from every document that still has work, not just the first.
 *
 * Straight `slice(0, size)` walks SOURCES in order, and with 675 GE items ahead
 * of them the two bibles added on 2026-08-02 would not be touched for months —
 * while SIMON carries a Fall 2026 pilot date and STUDIO is the contract the
 * Studio is being built against. Four documents are binding right now, so four
 * documents advance.
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
