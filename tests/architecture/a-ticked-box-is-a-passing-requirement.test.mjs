import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const REGISTRY = path.join(ROOT, 'docs/architecture/capability-completeness-registry.yaml')

/**
 * A ticked checkbox in an authority document must be a requirement the LEDGER
 * records as PASS.
 *
 * The registry's own header states the rule this enforces: "Status is read from
 * the ledger, never from the Bible's own checkbox — a document must not mark its
 * own homework." Until now nothing checked the other direction. A checkbox could
 * be ticked while every ledger row for that id said FAIL, and the two documents
 * would disagree in the one place a reader looks first.
 *
 * WRITTEN BECAUSE IT HAPPENED. `STUDIO-030-003` — "Build accessible primitives
 * for button, link, input, select, combobox, command menu, dialog, drawer,
 * tooltip, popover, tabs, accordion, menu, toast, table, tree, code/diff,
 * date/time, stepper, file upload, chart, and status" — was ticked on the
 * strength of ONE ledger row that passed, for the twenty-two primitives. Two
 * other rows carry the same id: one titled "this row does NOT close the
 * requirement" with Status: FAIL, and one marked "(partial)". The registry
 * resolved the id to FAIL, correctly, and the tick claimed otherwise.
 *
 * That is the failure mode worth catching, because it is invisible: the Bible is
 * what somebody reads to answer "is this done", and a wrong tick there survives
 * every test that only reads the ledger. One passing lane out of three is not a
 * closed requirement, and the arithmetic of "how much is left" is only as honest
 * as the boxes.
 */

/** id -> status, straight from the generated registry. */
function registryStatus() {
  const lines = fs.readFileSync(REGISTRY, 'utf8').split('\n')
  const status = new Map()
  let id = null
  for (const line of lines) {
    const idMatch = line.match(/^\s*-\s*id:\s*"([^"]+)"/)
    if (idMatch) {
      id = idMatch[1]
      continue
    }
    const statusMatch = line.match(/^\s*status:\s*([A-Z_]+)/)
    if (statusMatch && id) {
      status.set(id, statusMatch[1])
      id = null
    }
  }
  return status
}

/**
 * Ticked boxes that CLAIM A REQUIREMENT, which is not every ticked box.
 *
 * These documents use the same syntax for two different things, and the
 * difference is the whole correctness of this test:
 *
 *   · A REQUIREMENT ROW states the requirement and carries a `- Status:` line
 *     underneath. Ticking it says "this requirement is closed".
 *   · A LANE CHECKLIST is a list of what one piece of work finished, and its
 *     lines are often prefixed with the requirement they serve. Ticking one says
 *     "this lane did its part", which is not the same claim at all.
 *
 * `system-studio-…-ledger.md` holds both. Line 2285 reads
 * `- [x] STUDIO-000-009 — region and partition resolve from the trail's own ARN`
 * inside a checklist for `trail.ts`, and it is TRUE: that lane did that. Line
 * 7218 is the requirement's own row — "Identify all console-created/unmanaged
 * resources, long-lived AWS keys, wildcard policies…" — correctly UNTICKED with
 * `Status: FAIL`, because identifying all of that is a much larger job than one
 * ARN parse.
 *
 * A first version of this test read every ticked box and reported line 2285 as a
 * lie. It was not. Counting lane checkboxes as requirement claims would push
 * somebody to untick honest work, which is the opposite of the point.
 *
 * The discriminator is the `- Status:` line, because that is what the registry
 * itself parses to decide the requirement's verdict. An authority document has
 * no Status lines — its checkbox list IS the requirement list — so every ticked
 * box there counts.
 */
const AUTHORITY = /Bible|Prompt/i

function tickedBoxes() {
  const dir = path.join(ROOT, 'docs/implementation')
  const ticked = []
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n')
    const authority = AUTHORITY.test(file)
    lines.forEach((line, i) => {
      const m = line.match(/^- \[x\]\s+\**([A-Z][A-Z0-9]*(?:-[0-9]+)+)\**/)
      if (!m) return
      // In a ledger, only a row that carries a verdict is a requirement row.
      const carriesVerdict = lines.slice(i + 1, i + 7).some((l) => /^\s+-\s*Status:/.test(l))
      if (authority || carriesVerdict) ticked.push({ file, id: m[1] })
    })
  }
  return ticked
}

test('the registry can be read at all', () => {
  const status = registryStatus()
  assert.ok(
    status.size > 2000,
    `only ${status.size} requirements parsed out of the registry — the reader is broken, ` +
      'and a broken reader makes every assertion below vacuously true.',
  )
})

test('a ticked box is a requirement the ledger records as PASS', () => {
  const status = registryStatus()
  const ticked = tickedBoxes()

  assert.ok(
    ticked.length > 0,
    'no ticked checkboxes found anywhere in docs/implementation — the scanner is looking in the ' +
      'wrong place, or matching the wrong shape.',
  )

  const lying = ticked
    .filter(({ id }) => status.has(id))
    .filter(({ id }) => status.get(id) !== 'PASS')
    .map(({ file, id }) => `${file}: ${id} is ticked, ledger says ${status.get(id)}`)

  assert.deepEqual(
    lying,
    [],
    'These boxes claim a requirement is done that the ledger does not:\n  ' +
      lying.join('\n  ') +
      '\n\nEither the work is finished and the ledger row is missing, or the box was ticked too ' +
      'early. Untick it — the ledger is the record, the checkbox is only a summary of it.',
  )
})

test('a ticked box names a requirement that exists', () => {
  // The other way the summary drifts: a tick against an id no authority states.
  // Cheap to check while the registry is already parsed, and it catches a typo
  // that would otherwise make a requirement look closed by making it look like a
  // different requirement.
  const status = registryStatus()
  const unknown = tickedBoxes()
    .filter(({ id }) => !status.has(id))
    .map(({ file, id }) => `${file}: ${id}`)

  assert.deepEqual(
    unknown,
    [],
    'These ticked boxes name ids no authority document states:\n  ' + unknown.join('\n  '),
  )
})
