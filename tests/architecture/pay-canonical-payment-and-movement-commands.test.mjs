import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * PAY-060-001 / PAY-080-001 / PAY-090-001 — the state machines and the command
 * types, held against the Bible's own sentences rather than against a copy.
 *
 * The failure this guards is the one that makes a state machine worthless: the
 * Bible's list changes, or the code's does, and the two drift while every unit
 * test stays green because it asserts the code against itself. So every list
 * below is parsed out of
 * `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`
 * and compared with the list parsed out of the TypeScript.
 *
 * Test 1 pins BOTH sides by value first. A reader that silently returned `[]`
 * would make every comparison below vacuously true, which is the failure this
 * repository has shipped more than once.
 *
 * Text parsing rather than import: this file runs under bare `node --test`,
 * which cannot load the package's TypeScript. It is the same approach
 * `pay-authority-boundary-and-adrs.test.mjs` takes for the responsibility axes.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const BIBLE = "Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md"
const ORDER_STATE_MODULE = "packages/payments/src/payment-order-state.ts"
const MOVEMENT_MODULE = "packages/payments/src/movement-commands.ts"
const PAYOUT_MODULE = "packages/payments/src/payout-commands.ts"
const APPROVAL_ACTION = "apps/web/src/app/(app)/approvals/actions.ts"
const EVENT_ROUTE = "apps/web/src/app/api/payments/provider-events/route.ts"

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8")
}

/** The string values of `export const <name> = [ … ] as const`. */
function constArray(source, name) {
  const opened = source.indexOf(`export const ${name} = [`)
  assert.notEqual(opened, -1, `${name} is not declared as an exported array literal.`)
  const start = opened + `export const ${name} = [`.length
  const end = source.indexOf("]", start)
  assert.notEqual(end, -1, `${name}'s array literal is unterminated.`)
  return [...source.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** One section of the Bible, from its heading to the next `### `. */
function section(bible, heading) {
  const start = bible.indexOf(heading)
  assert.notEqual(start, -1, `The Bible has no section "${heading}".`)
  const next = bible.indexOf("\n### ", start + heading.length)
  return bible.slice(start, next === -1 ? bible.length : next)
}

const bible = read(BIBLE)
const orderModule = read(ORDER_STATE_MODULE)
const movementModule = read(MOVEMENT_MODULE)
const payoutModule = read(PAYOUT_MODULE)

test("both sides of every comparison are non-empty and are what they claim", () => {
  const order = constArray(orderModule, "PAYMENT_ORDER_STATES")
  const control = constArray(orderModule, "PAYMENT_CONTROL_STATES")
  const attempts = constArray(orderModule, "PAYMENT_ATTEMPT_STATES")
  const commands = constArray(movementModule, "MOVEMENT_COMMAND_TYPES")
  const payouts = constArray(payoutModule, "PAYOUT_COMMANDS")

  assert.equal(order.length, 13, `parsed ${order.length} order states`)
  assert.equal(control.length, 13, `parsed ${control.length} control states`)
  assert.equal(attempts.length, 8, `parsed ${attempts.length} attempt states`)
  assert.deepEqual(commands, [
    "INTERNAL_ALLOCATION",
    "INTERNAL_LEDGER_TRANSFER",
    "INTERCOMPANY_TRANSFER",
    "EXTERNAL_PROVIDER_MOVEMENT",
  ])
  assert.deepEqual(payouts, [
    "SETTLEMENT_PAYOUT",
    "BALANCE_TRANSFER",
    "OUTBOUND_PAYMENT",
    "REFUND",
    "DISBURSEMENT",
  ])
  assert.ok(bible.length > 20_000, `the Bible read back as ${bible.length} characters`)
})

test("PAY-060-001 — the lifecycle is Bible §8's lifecycle, in §8's order", () => {
  const eight = section(bible, "### 8. Inbound payment acceptance")
  // The one backticked line built out of `→`. Splitting on the arrow and on
  // the `/` in "APPROVAL_REQUIRED/READY" and "CAPTURED/SUCCEEDED" gives the
  // states in the order the Bible writes them.
  const line = eight
    .split("\n")
    .find((l) => l.includes("→") && l.includes("DRAFT"))
  assert.ok(line, "Bible §8 no longer carries a lifecycle line containing DRAFT.")
  const stated = line
    .replace(/`/g, "")
    .split(/→|\//)
    .map((s) => s.trim())
    .filter(Boolean)

  assert.deepEqual(constArray(orderModule, "PAYMENT_ORDER_STATES"), stated)
})

test("PAY-060-001 — the control states are Bible §8's control states", () => {
  const eight = section(bible, "### 8. Inbound payment acceptance")
  const line = eight
    .split("\n")
    .find((l) => l.includes("`REQUIRES_PAYMENT_METHOD`"))
  assert.ok(line, "Bible §8 no longer lists REQUIRES_PAYMENT_METHOD.")
  const stated = [...line.matchAll(/`([A-Z_]+)`/g)].map((m) => m[1])

  assert.deepEqual(constArray(orderModule, "PAYMENT_CONTROL_STATES"), stated)
})

test("PAY-060-001 — a provider event is read as evidence and applies nothing", () => {
  // The route is the surface a provider event actually arrives at. If it stops
  // reading, the machine is a library nothing consults.
  const route = read(EVENT_ROUTE)
  assert.match(route, /observeProviderState/, `${EVENT_ROUTE} does not read the canonical state.`)
  assert.match(route, /applied: false/, `${EVENT_ROUTE} does not say it applied nothing.`)
  // And the reader itself must not be able to move anything: no transition
  // function may be called from inside the observation path.
  const observe = orderModule.slice(orderModule.indexOf("export function observeProviderState"))
  assert.doesNotMatch(
    observe,
    /advanceOrder\(|advanceAttempt\(/,
    "observeProviderState calls a transition function, which makes an inbound event authoritative.",
  )
})

test("PAY-080-001 — the four command types are Bible §10's four", () => {
  const ten = section(bible, "### 10. Internal organizational payment pipeline")
  const stated = [...ten.matchAll(/^- \*\*([^:*]+):\*\*/gm)].map((m) => m[1].trim())
  assert.deepEqual(stated, [
    "Memo allocation",
    "Internal ledger transfer",
    "Intercompany transfer",
    "External provider movement",
  ])

  const implemented = constArray(movementModule, "MOVEMENT_COMMAND_TYPES")
  assert.equal(implemented.length, stated.length)
  // "Memo allocation" is INTERNAL_ALLOCATION and the other three are their own
  // names upper-snaked. Deriving the comparison rather than restating it means
  // a fifth bullet in §10 fails this rather than being quietly ignored.
  const expected = stated.map((s) =>
    s === "Memo allocation" ? "INTERNAL_ALLOCATION" : s.toUpperCase().replace(/ /g, "_"),
  )
  assert.deepEqual(implemented, expected)
})

test("PAY-080-001 — the action that posts a journal asks which type it is", () => {
  const action = read(APPROVAL_ACTION)
  assert.match(action, /classifyMovementCommand/, `${APPROVAL_ACTION} never classifies the command.`)
  // It must refuse an undecided classification rather than post it.
  assert.match(
    action,
    /if \(!command\.decided\)/,
    `${APPROVAL_ACTION} does not refuse an unclassified command.`,
  )
  assert.match(action, /Payments\.COMMAND_UNCLASSIFIED/)
})

test("PAY-090-001 — the five outbound commands are the five the requirement names", () => {
  const eleven = section(bible, "### 11. Vendor, contractor, beneficiary, and marketplace payouts")
  assert.match(eleven, /Do not use one generic .payout. verb/)
  const line = eleven.split("\n").find((l) => l.includes("PAY-090-001"))
  assert.ok(line, "Bible §11 no longer states PAY-090-001.")
  // "…state machines for settlement payout, transfer, outbound payment, refund
  // and disbursement." Parsed out of the requirement, not restated.
  const after = line.slice(line.indexOf("state machines for") + "state machines for".length)
  const named = after
    .replace(/[.”"]+$/g, "")
    .split(/,| and /)
    .map((s) => s.trim().replace(/[.”"]+$/g, ""))
    .filter(Boolean)
  assert.deepEqual(named, [
    "settlement payout",
    "transfer",
    "outbound payment",
    "refund",
    "disbursement",
  ])

  const implemented = constArray(payoutModule, "PAYOUT_COMMANDS")
  assert.equal(implemented.length, named.length)
  const expected = named.map((n) =>
    n === "transfer" ? "BALANCE_TRANSFER" : n.toUpperCase().replace(/ /g, "_"),
  )
  assert.deepEqual(implemented, expected)
})

test("PAY-090-001 — the five machines are five, not one table with five names", () => {
  // Parsed from the source: each command's block, and the state keys in it.
  const perCommand = new Map()
  for (const command of constArray(payoutModule, "PAYOUT_COMMANDS")) {
    const at = payoutModule.indexOf(`  ${command}: {`)
    assert.notEqual(at, -1, `${command} has no machine.`)
    const transitionsAt = payoutModule.indexOf("transitions: {", at)
    assert.notEqual(transitionsAt, -1, `${command} has no transitions table.`)
    const end = payoutModule.indexOf("\n    },", transitionsAt)
    const block = payoutModule.slice(transitionsAt, end)
    const states = [...block.matchAll(/^      ([A-Z_]+):/gm)].map((m) => m[1]).sort()
    assert.ok(states.length >= 4, `${command} has ${states.length} states.`)
    perCommand.set(command, states)
  }

  const fingerprints = [...perCommand.values()].map((s) => s.join("|"))
  assert.equal(
    new Set(fingerprints).size,
    fingerprints.length,
    "two outbound commands have the same set of states, which makes them one verb wearing two names.",
  )

  // The two differences Bible §11 turns on, asserted by name.
  const withVerification = [...perCommand.entries()]
    .filter(([, states]) => states.includes("BENEFICIARY_VERIFIED"))
    .map(([c]) => c)
  assert.deepEqual(withVerification, ["OUTBOUND_PAYMENT"])

  assert.ok(!perCommand.get("REFUND").includes("RETURNED"), "a refund cannot be returned by a bank.")
  assert.ok(perCommand.get("SETTLEMENT_PAYOUT").includes("RETURNED"))
})
