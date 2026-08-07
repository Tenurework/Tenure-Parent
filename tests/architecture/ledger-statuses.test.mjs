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

const LEDGER_DIR = "docs/implementation"

/**
 * Every ledger on disk, not a hand-written list of three.
 *
 * The list was written when three ledgers existed. Twelve more arrived with the
 * Bible import and none of them were guarded — so the twelve ledgers carrying
 * 1,600 of the 2,046 requirements were the ones a status the loop cannot act on
 * could land in silently. A guard aimed away from where the work is happening is
 * worth roughly nothing, and this one was.
 */
const LEDGERS = fs
  .readdirSync(path.join(ROOT, LEDGER_DIR))
  .filter((n) => n.endsWith("-execution-ledger.md"))
  .sort()
  .map((n) => `${LEDGER_DIR}/${n}`)

/** The engine ledger specifically, for the tests that assert on its volume. */
const ENGINE_LEDGER = `${LEDGER_DIR}/global-engine-execution-ledger.md`

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
  const text = read(ENGINE_LEDGER)
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
  const found = statusesIn(read(ENGINE_LEDGER))

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

/**
 * The vocabulary an agent is *told* to use, not just the one it used.
 *
 * Every ledger opens with a `Statuses:` line, and that line is what an agent
 * reads before writing an entry. Twelve of them advertised
 * `BLOCKED_ARCHITECTURE`, which `next-batch.mjs` does not decide on — so an
 * agent following the instructions at the top of the file would have written a
 * status that reads as undecided, returning its item to the queue every tick
 * forever. That is the `PARTIAL` defect this whole file was written about,
 * reintroduced through the one channel nothing was checking: the documentation
 * telling agents what to write.
 *
 * The tests above catch the word once an entry uses it. This catches the
 * instruction that would produce it, which is a tick earlier and far cheaper.
 */
function advertisedStatuses(text) {
  const line = /^Statuses:.*$/m.exec(text)
  if (!line) return null
  return [...line[0].matchAll(/`([A-Z_]+)`/g)].map((m) => m[1])
}

test("no ledger advertises a status the loop cannot act on", () => {
  const offenders = []

  for (const ledger of LEDGERS) {
    const advertised = advertisedStatuses(read(ledger))
    if (advertised === null) continue
    for (const status of advertised) {
      if (!KNOWN_STATUSES.includes(status)) offenders.push(`${ledger} — ${status}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these ledgers tell an agent to write a status the queue treats as undecided:\n  ` +
      `${offenders.join("\n  ")}\n` +
      `The header of a ledger is the instruction an agent follows. It may only name ` +
      `${KNOWN_STATUSES.join(" | ")}.`,
  )
})

test("every ledger states its vocabulary at all", () => {
  // A ledger with no `Statuses:` header is exempt from the rule above by
  // omission, which is the cheapest way to defeat it.
  const silent = LEDGERS.filter((l) => advertisedStatuses(read(l)) === null)

  assert.deepEqual(
    silent,
    [],
    `these ledgers declare no status vocabulary, so nothing constrains what an agent writes ` +
      `in them:\n  ${silent.join("\n  ")}`,
  )
})

test("the tools that generate and read ledgers share one vocabulary", () => {
  // Three copies of the list is how they came to disagree in the first place:
  // `document-graph.mjs` exported five statuses, `import-requirements.mjs`
  // stamped five into every generated header, and the queue acted on three.
  const graph = read("tools/document-graph.mjs")
  const declared = /export const STATUSES = \[([^\]]*)\]/.exec(graph)

  assert.ok(declared, "tools/document-graph.mjs no longer exports STATUSES — this guard is not reading it")

  const statuses = [...declared[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1])
  assert.deepEqual(
    [...statuses].sort(),
    [...KNOWN_STATUSES].sort(),
    "document-graph.mjs's STATUSES and the queue's vocabulary disagree. Whichever is right, an " +
      "agent reading one and a queue acting on the other is how an item spins forever.",
  )

  const template = read("tools/import-requirements.mjs")
  const stamped = /^Statuses:.*$/m.exec(template)
  assert.ok(stamped, "import-requirements.mjs no longer stamps a Statuses: header — this guard is not reading it")

  const inTemplate = [...stamped[0].matchAll(/`{1,2}([A-Z_]+)/g)].map((m) => m[1])
  for (const status of inTemplate) {
    assert.ok(
      KNOWN_STATUSES.includes(status),
      `import-requirements.mjs stamps '${status}' into every generated ledger header, and the ` +
        `queue does not act on it. Every ledger it creates would teach the next agent the wrong word.`,
    )
  }
})
