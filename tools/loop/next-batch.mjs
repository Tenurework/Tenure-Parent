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

const LEDGER = "docs/implementation/global-engine-execution-ledger.md"

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
    // Leaf items only. A section id like `EXT-050` heads a group and is not
    // itself a unit of work; counting one would put an unfinishable entry at
    // the front of a queue that is meant to be worked to zero.
    if (!/^[A-Z]+-\d{3}-\d{3}$/.test(item[2])) continue
    items.push({ id: item[2], title: item[3].trim(), phase })
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
  const text = fs.readFileSync(LEDGER, "utf8")
  const state = new Map()

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
    const range = /\*\*((?:GE|EXT)-[\w-]+)\s*(?:…|\.\.\.)\s*(\d+)\*\*/.exec(lines[i])
    const single = /^- \[[ x]\]\s+\*\*((?:GE|EXT)-[\w-]+)\*\*/.exec(lines[i])
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

  return state
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
    batch: remaining.slice(0, size),
  }
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
