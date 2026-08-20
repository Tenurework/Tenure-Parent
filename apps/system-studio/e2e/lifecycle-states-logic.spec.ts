import { test, expect } from "@playwright/test"

import fs from "fs"
import path from "path"

import {
  ALL_STATES,
  RESIDUAL_COST,
  SERVING,
  advance,
  canAdvance,
  needsApproval,
  nextStates,
  type LifecycleStep,
  type TenantState,
} from "@tenure/provisioning"

import { isOperator } from "@/lib/operators"

/**
 * GE-102-001 — the state machine, asserted against the requirement's own list.
 *
 * > "Implement `DRAFT → VALIDATING → PLANNED → AWAITING_APPROVAL → PROVISIONING
 * > → CONFIGURING → MIGRATING → VERIFYING → READY → ACTIVATING → ACTIVE` plus
 * > explicit `IDLE`, `SUSPENDING`, `SUSPENDED_LOGICAL`, `HIBERNATING`,
 * > `HIBERNATED_ZERO_RUNTIME`, `REACTIVATING`, `EXPORTING`, `OFFBOARDING`,
 * > `LEGAL_HOLD`, `PURGE_PENDING`, `PURGING`, `PURGED_ZERO_INCREMENTAL_COST`,
 * > and failure states. **Do not reduce lifecycle to a misleading active
 * > boolean.**"
 *
 * `provisioning.test.ts` already proves the graph's own properties — that the
 * happy path walks, that a jump is refused, that every state is reachable and
 * that all 69 edges are declared. What was never asserted is the requirement's
 * SENTENCE: that these twenty-three names, spelled this way, are the states the
 * engine has, and that the last clause holds.
 *
 * The last clause is the one worth writing a test for, because it is the only
 * one that can be satisfied on paper and violated in practice. A twenty-five
 * state enum with a console that renders `active: true | false` over it has
 * implemented the list and reduced the lifecycle, which is exactly what the
 * sentence forbids. So the two closing tests ask what a boolean would COST:
 * which distinctions the product acts on would be destroyed by it, and what the
 * registry actually persists.
 */

const HAPPY_PATH: readonly TenantState[] = [
  "DRAFT",
  "VALIDATING",
  "PLANNED",
  "AWAITING_APPROVAL",
  "PROVISIONING",
  "CONFIGURING",
  "MIGRATING",
  "VERIFYING",
  "READY",
  "ACTIVATING",
  "ACTIVE",
]

/** The twelve the requirement names after "plus explicit". */
const EXPLICIT_OTHERS: readonly TenantState[] = [
  "IDLE",
  "SUSPENDING",
  "SUSPENDED_LOGICAL",
  "HIBERNATING",
  "HIBERNATED_ZERO_RUNTIME",
  "REACTIVATING",
  "EXPORTING",
  "OFFBOARDING",
  "LEGAL_HOLD",
  "PURGE_PENDING",
  "PURGING",
  "PURGED_ZERO_INCREMENTAL_COST",
]

const OPERATOR = { principalId: "operator@tenure.example", at: "2026-08-19T10:00:00.000Z" }
const SECOND = "second@tenure.example"

/**
 * The allowlist the approver is looked up in, installed for the duration of
 * this file.
 *
 * The chain below has to get past the four-eyes gate on PROVISIONING and
 * ACTIVATING, and there are exactly two ways to do that: assert the answer, or
 * make it true. Asserting it — `approverIsOperator: true` — is what this spec
 * did until `tests/security/approver-is-looked-up.test.mjs` caught it, and it
 * is the whole failure that guard exists for: a literal in that position walks
 * the eleven steps green while `advance()`'s operator refusal has stopped
 * refusing anything, because nothing in the run ever consults an allowlist.
 *
 * So the approver is a real entry, and `isOperator` really reads it. Two
 * distinct addresses with distinct roles, because the actor and the approver
 * must not be the same person.
 *
 * Restored afterwards rather than assigned at module scope: `PLATFORM_OPERATORS`
 * is process-wide, this project runs `workers: 1`, and several specs in this
 * directory read the variable at import time.
 */
const ALLOWLIST = `${OPERATOR.principalId}:platform-super-admin,${SECOND}:release-manager`

let priorAllowlist: string | undefined

test.beforeAll(() => {
  priorAllowlist = process.env.PLATFORM_OPERATORS
  process.env.PLATFORM_OPERATORS = ALLOWLIST
})

test.afterAll(() => {
  if (priorAllowlist === undefined) delete process.env.PLATFORM_OPERATORS
  else process.env.PLATFORM_OPERATORS = priorAllowlist
})

test.describe("the list the requirement writes out", () => {
  test("every named state exists, spelled exactly as the requirement spells it", () => {
    const known = new Set<string>(ALL_STATES)
    for (const state of [...HAPPY_PATH, ...EXPLICIT_OTHERS]) {
      expect(known.has(state), `the lifecycle has no state called ${state}`).toBe(true)
    }
  })

  test("failure states are states, not a flag on another state", () => {
    // "and failure states" — plural, and the machine has two: the one it lands
    // in, and the one it passes through undoing the attempt.
    expect(new Set<string>(ALL_STATES).has("FAILED")).toBe(true)
    expect(new Set<string>(ALL_STATES).has("ROLLING_BACK")).toBe(true)
    expect(nextStates("ROLLING_BACK").length).toBeGreaterThan(0)
  })

  test("the eleven-step chain is walkable in the order it is written", () => {
    let state: TenantState = "DRAFT"
    const history: LifecycleStep[] = []
    for (const to of HAPPY_PATH.slice(1)) {
      // Shaped exactly like the production call site, `runAdvance` in
      // `apps/system-studio/src/lib/command-handlers.ts`: the approver's
      // address goes in, and whether that address is an operator is LOOKED UP
      // against the same allowlist that admits a requester. Undefined where no
      // approver is named, which `advance()` treats as a refusal.
      const approvedBy = needsApproval(state, to) ? SECOND : undefined
      const result = advance(
        state,
        to,
        {
          actor: OPERATOR,
          approvedBy,
          approverIsOperator: approvedBy ? isOperator(approvedBy) : undefined,
        },
        history,
      )
      history.push(result.step)
      state = result.state
    }
    expect(state).toBe("ACTIVE")
    expect(history.map((s) => s.to)).toEqual(HAPPY_PATH.slice(1))
  })

  test("no step in the chain can be skipped — every one-ahead jump is refused", () => {
    // The arrow in the requirement is a sequence, not a suggestion. This is the
    // property that makes it one: for every position, the state two ahead is
    // NOT reachable in a single move.
    for (let i = 0; i + 2 < HAPPY_PATH.length; i += 1) {
      const from = HAPPY_PATH[i]
      const skipped = HAPPY_PATH[i + 2]
      expect(canAdvance(from, skipped), `${from} → ${skipped} skips ${HAPPY_PATH[i + 1]}`).toBe(
        false,
      )
    }
  })
})

test.describe("the clause a paper implementation cannot satisfy", () => {
  test("a boolean cannot carry this lifecycle: two states serve, twenty-three do not", () => {
    const notServing = ALL_STATES.filter((s) => !SERVING.has(s))
    expect([...SERVING].sort()).toEqual(["ACTIVE", "IDLE"])
    expect(notServing.length).toBe(ALL_STATES.length - 2)
  })

  test("the states a boolean would merge are ones the engine treats differently", () => {
    /*
     * Four states that a `active: false` field renders identically, and every
     * one of them is a different operational answer:
     *
     *   SUSPENDED_LOGICAL          — paused, full infrastructure, full bill
     *   HIBERNATED_ZERO_RUNTIME    — no runtime, still paying for retention
     *   LEGAL_HOLD                 — may not be deleted at all
     *   PURGED_ZERO_INCREMENTAL_COST — gone, and terminal
     *
     * The distinctions asserted are ones the product ACTS on: what it costs,
     * and where it may go next. Two states that agreed on both would be a
     * genuine argument for merging them.
     */
    const merged: readonly TenantState[] = [
      "SUSPENDED_LOGICAL",
      "HIBERNATED_ZERO_RUNTIME",
      "LEGAL_HOLD",
      "PURGED_ZERO_INCREMENTAL_COST",
    ]

    const fingerprints = merged.map(
      (s) => `${RESIDUAL_COST[s] ?? "(no residual claim)"}||${[...nextStates(s)].sort().join(",")}`,
    )
    expect(new Set(fingerprints).size).toBe(merged.length)

    // And the two that a "paused" boolean would most obviously merge disagree
    // about the thing that shows up on a bill.
    expect(RESIDUAL_COST.SUSPENDED_LOGICAL).not.toBe(RESIDUAL_COST.HIBERNATED_ZERO_RUNTIME)
    // Terminal really is terminal: nothing follows a purge.
    expect(nextStates("PURGED_ZERO_INCREMENTAL_COST")).toEqual([])
  })

  test("the registry persists the state by name, under optimistic concurrency on that name", () => {
    // A helper's own test cannot see a producer that stopped using it. The
    // lifecycle is only un-reduced if what is STORED is the state — a store
    // holding a boolean beside a 25-state enum is the reduction the sentence
    // forbids, and it would be invisible to every test above.
    const registry = fs.readFileSync(
      path.join(__dirname, "..", "src", "lib", "registry.ts"),
      "utf8",
    )
    expect(registry).toContain("const { state, step } = advance(current.state, to, options, current.history)")
    // The STATE row carries the name, and the write is conditional on the name
    // it is replacing — which is only possible because the name is what is kept.
    expect(registry).toContain('ExpressionAttributeNames: { "#s": "state" }')
    expect(registry).toContain('ExpressionAttributeValues: { ":expected": current.state }')
    // No boolean stands in for it anywhere in the registry.
    expect(registry).not.toMatch(/\bactive:\s*(true|false)\b/)
  })
})
