import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * The ledger's statuses have to be ones the loop can act on.
 *
 * `next-batch.mjs` reads each entry's `Status:` line and treats `PASS`,
 * `BLOCKED_EXTERNAL` and `NOT_APPLICABLE` as decided. Anything else is
 * undecided, which is correct for `FAIL` and silently wrong for a status
 * somebody invents.
 *
 * GE-042-007 was recorded `PARTIAL` — half shipped, half waiting on the Cognito
 * cutover. It read as undecided, so the item returned to the front of the queue
 * every tick: the loop spinning on work that is waiting for a human, which is
 * the exact failure the parser's own comments describe having fixed twice
 * before. The word was honest and the tooling could not act on it, and a status
 * the tooling cannot act on is not a status.
 *
 * "Half done" is expressible without a new word. Either the item can reach PASS
 * with work available now — in which case it is `FAIL` and still queued — or it
 * cannot, and it is `BLOCKED_EXTERNAL` with the commands that would unblock it.
 * Which of those is true is exactly the judgement this repository must not
 * fudge.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/** Kept identical to the set `next-batch.mjs` acts on. Asserted below. */
const KNOWN_STATUSES = ["PASS", "FAIL", "BLOCKED_EXTERNAL", "NOT_APPLICABLE"]

const LEDGERS = [
  "docs/implementation/global-engine-execution-ledger.md",
  "docs/implementation/system-studio-aws-control-plane-execution-ledger.md",
  "docs/implementation/simon-ose-absorption-execution-ledger.md",
]

function read(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return ""
    throw error
  }
}

/** Every status value a ledger declares, with the line it is on. */
function statusesIn(text) {
  const found = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*[-*]\s*Status:\s*\*{0,2}([A-Za-z_]+)/.exec(lines[i])
    if (match) found.push({ status: match[1], line: i + 1 })
  }
  return found
}

test("every ledger status is one the loop can act on", () => {
  const offenders = []

  for (const ledger of LEDGERS) {
    for (const { status, line } of statusesIn(read(ledger))) {
      if (!KNOWN_STATUSES.includes(status)) offenders.push(`${ledger}:${line} — ${status}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these statuses are not in ${KNOWN_STATUSES.join(" | ")}:\n  ${offenders.join("\n  ")}\n` +
      `next-batch.mjs treats anything outside that set as undecided, so the item returns to the ` +
      `queue every tick. An item that is half done is FAIL if the rest can be built now, and ` +
      `BLOCKED_EXTERNAL — with the operator commands — if it cannot.`,
  )
})

test("the set here is the set next-batch acts on", () => {
  // Two copies of a list is how they come to disagree. This reads the queue's
  // own source, so a status added there without being added here fails rather
  // than quietly widening what the ledger may say.
  const source = read("tools/loop/next-batch.mjs")
  const decided = /s === "PASS" \|\| s === "BLOCKED_EXTERNAL" \|\| s === "NOT_APPLICABLE"/.test(source)

  assert.ok(
    decided,
    "next-batch.mjs no longer decides on PASS | BLOCKED_EXTERNAL | NOT_APPLICABLE — update KNOWN_STATUSES to match it",
  )
  // FAIL is deliberately not in the queue's decided set: a failed item must
  // stay queued. It is known here so the ledger may say it.
  assert.ok(KNOWN_STATUSES.includes("FAIL"), "FAIL is a legitimate ledger status")

  // Pinned exactly, not merely "contains". A widened set is how `PARTIAL` would
  // come back: adding it here fires nothing until somebody uses it, by which
  // point the guard has already been taught to allow the thing it exists to
  // refuse. A new status is a deliberate change to this line and to the queue.
  assert.deepEqual(
    [...KNOWN_STATUSES].sort(),
    ["BLOCKED_EXTERNAL", "FAIL", "NOT_APPLICABLE", "PASS"],
    "the ledger vocabulary changed — update next-batch.mjs in the same commit, or the new status " +
      "reads as undecided and its item returns to the queue every tick",
  )
})

/**
 * One entry's own body, stopping at the next entry.
 *
 * A fixed line window bleeds into the entry below, so an item that says nothing
 * about its blocker inherits its neighbour's. A mutation that replaced a
 * blocker's explanation with "not doing this one" survived on exactly that.
 */
const BODY_SEPARATOR = String.fromCharCode(10)

function entryBody(lines, statusIndex) {
  const body = []
  for (let i = statusIndex; i < lines.length && i < statusIndex + 40; i++) {
    if (i > statusIndex && /^- \[[ x]\]\s+\*\*/.test(lines[i])) break
    body.push(lines[i])
  }
  return body.join(BODY_SEPARATOR)
}

/** Whether an entry body carries commands an operator could actually run. */
function hasRunnableCommands(body) {
  return /```/.test(body) || /\b(aws|gh|terraform|docker|psql)\s+[a-z-]+\s/.test(body)
}

/** Whether it instead points at the thing that is blocking it. */
function namesItsBlocker(body) {
  // A dependency chain is a legitimate answer and the common one: six items are
  // blocked on one missing AWS Organization, and repeating the same four
  // commands under each would be six copies to keep in step. What matters is
  // that a reader can follow it to something runnable.
  return /\b(GE|EXT|STUDIO|SIMON)-[\w-]+/.test(body) || /\bADR-\d+/.test(body)
}

test("every BLOCKED_EXTERNAL entry leads to something an operator can run", () => {
  // The status exists so the loop skips the item. If it neither says what to run
  // nor names what is blocking it, it skips forever and nobody knows why —
  // indistinguishable from abandoning the work.
  const offenders = []

  for (const ledger of LEDGERS) {
    const lines = read(ledger).split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*[-*]\s*Status:\s*\*{0,2}BLOCKED_EXTERNAL/.test(lines[i])) continue

      const body = entryBody(lines, i)
      if (hasRunnableCommands(body) || namesItsBlocker(body)) continue

      const id = lines.slice(Math.max(0, i - 3), i).join(" ").match(/\*\*([\w-]+)/)
      offenders.push(`${ledger}:${i + 1}${id ? ` (${id[1]})` : ""}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these are BLOCKED_EXTERNAL and neither carry commands nor name what blocks them:\n  ${offenders.join("\n  ")}\n` +
      `The status tells the loop to skip the item. Give the commands, or name the item or ADR that ` +
      `carries them.`,
  )
})

test("the chain of blocked items terminates in real commands", () => {
  // The rule above lets an entry point at another. Followed far enough that has
  // to end somewhere runnable, or the whole chain is a set of items politely
  // deferring to each other and nothing is ever unblocked.
  const text = read(LEDGERS[0])
  const lines = text.split("\n")

  let withCommands = 0
  let blocked = 0
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*[-*]\s*Status:\s*\*{0,2}BLOCKED_EXTERNAL/.test(lines[i])) continue
    blocked++
    if (hasRunnableCommands(lines.slice(i, i + 40).join("\n"))) withCommands++
  }

  assert.ok(blocked > 0, "no BLOCKED_EXTERNAL entries found — the detector is not reading the ledger")
  assert.ok(
    withCommands > 0,
    `${blocked} items are blocked and not one carries commands. Every one defers to another, so ` +
      `nothing in the chain can actually be unblocked.`,
  )
})

test("the status detector finds statuses at all", () => {
  // Asserted because the failure mode is silence: a regex that stopped matching
  // would report every ledger as clean.
  const found = statusesIn(read(LEDGERS[0]))

  assert.ok(found.length > 50, `expected the engine ledger to carry many statuses, found ${found.length}`)
  assert.ok(
    found.some((f) => f.status === "PASS"),
    "no PASS found — the detector is not reading the ledger",
  )
  assert.ok(
    found.some((f) => f.status === "BLOCKED_EXTERNAL"),
    "no BLOCKED_EXTERNAL found — the bolded form is not being matched",
  )
})
