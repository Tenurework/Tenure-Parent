/**
 * EXT-120-001 — the legacy decommission inventory and its retirement state
 * machine.
 *
 * Authority: `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md`
 * §14.1 (inventory each of twenty-one kinds; record eight facts) and §14.2 (the
 * eleven-state lifecycle and its five control states).
 *
 * The worked estate is declared once, in `tools/legacy-retirement.mjs`, and read
 * twice — by that generator, which writes `docs/architecture/legacy-retirement.md`,
 * and by this file.
 *
 * The assertion this file is really about is the one nobody writes: that a kind
 * NOBODY LOOKED AT is a finding. Every other check here can be satisfied by a
 * complete-looking register, and a complete-looking register over an estate half
 * of which was never surveyed is the exact failure §14.1's "inventory each" is
 * written against.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

import {
  ASSET_FACTS,
  ASSET_KINDS,
  CONTROL_STATES,
  RETIREMENT_STATES,
  assetProblems,
  dependencyCycles,
  inventoryProblems,
  kindCoverage,
  nextState,
  transitionProblems,
} from '../../packages/provisioning/src/decommission-inventory.mjs'
import {
  INVENTORY,
  REFUSALS,
  SURVEYED,
  TRANSITIONS,
} from '../../tools/legacy-retirement.mjs'

const codes = (rows) => [...new Set(rows.map((p) => p.reason))].sort()

const without = (object, key) => {
  const copy = { ...object }
  delete copy[key]
  return copy
}

// ── the generated document ────────────────────────────────────────────────

test('the committed legacy-retirement document is not stale', () => {
  const out = execFileSync('node', ['tools/legacy-retirement.mjs', '--check'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.match(out, /up to date/)
})

// ── the valid estate ──────────────────────────────────────────────────────

test('the worked estate satisfies §14.1 and §14.2', () => {
  assert.deepEqual(inventoryProblems(INVENTORY), [])
  assert.deepEqual(kindCoverage(INVENTORY, SURVEYED).problems, [])
  assert.deepEqual(dependencyCycles(INVENTORY), [])
})

// ── §14.1: inventory each ─────────────────────────────────────────────────

test('every one of §14.1\'s twenty-one kinds must be surveyed, one at a time', () => {
  assert.equal(ASSET_KINDS.length, 21)

  // Remove each kind's only asset in turn. Twenty-one mutations, twenty-one
  // `kind-not-surveyed` findings — and each asserted to name THAT kind, so a
  // finding raised about a different kind would not be counted as this working.
  for (const kind of ASSET_KINDS) {
    const reduced = INVENTORY.filter((a) => a.kind !== kind.key)
    const problems = kindCoverage(reduced, SURVEYED).problems
    const mine = problems.filter((p) => p.kind === kind.key)
    assert.equal(mine.length, 1, `removing ${kind.key} produced ${mine.length} findings about it`)
    assert.equal(mine[0].reason, 'kind-not-surveyed')
  }
})

test('"we looked and found none" is a fact and "we did not look" is a finding', () => {
  const withoutServiceAccounts = INVENTORY.filter((a) => a.kind !== 'SERVICE_ACCOUNT')

  // Not surveyed at all.
  assert.deepEqual(codes(kindCoverage(withoutServiceAccounts, []).problems), ['kind-not-surveyed'])

  // Surveyed, empty, and no reason: still a finding, and a different one.
  assert.deepEqual(
    codes(kindCoverage(withoutServiceAccounts, [{ kind: 'SERVICE_ACCOUNT' }]).problems),
    ['survey-unreasoned'],
  )

  // Surveyed, empty, with the reason. This is the only shape that passes, and
  // the row records the reason rather than swallowing the emptiness.
  const answered = kindCoverage(withoutServiceAccounts, [
    { kind: 'SERVICE_ACCOUNT', foundNoneBecause: 'the estate authenticates through the directory; no local service accounts exist' },
  ])
  assert.deepEqual(answered.problems, [])
  const row = answered.rows.find((r) => r.kind === 'SERVICE_ACCOUNT')
  assert.equal(row.count, 0)
  assert.equal(row.surveyed, true)
  assert.match(row.note, /no local service accounts/)
})

test('each of §14.1\'s eight facts is required, one at a time', () => {
  assert.equal(ASSET_FACTS.length, 8)
  const base = INVENTORY.find((a) => a.id === 'legacy-sis')
  assert.deepEqual(assetProblems(base), [])

  for (const fact of ASSET_FACTS) {
    // `dependencies` is the one fact judged against §14.2's chain rather than on
    // its own, and it is checked by the register test below instead. Asserting
    // that here would be asserting the wrong rule.
    if (fact.stateDependent) continue
    const problems = assetProblems(without(base, fact.key))
    assert.deepEqual(codes(problems), ['fact-missing'], `removing ${fact.key}`)
    assert.equal(problems[0].field, fact.key)
  }

  assert.equal(ASSET_FACTS.filter((f) => f.stateDependent).length, 1)
})

test('a dependency list that was never made is not an empty one', () => {
  // At DISCOVERED the asset has been found and not yet mapped, so an absent list
  // is honest. Past it, §14.2's second state is DEPENDENCY_MAPPED and the claim
  // needs the work behind it.
  const discovered = INVENTORY.find((a) => a.id === 'legacy-event-queue')
  assert.equal(discovered.state, 'DISCOVERED')
  assert.deepEqual(
    inventoryProblems([without(discovered, 'dependencies')]).filter(
      (p) => p.reason === 'dependency-unmapped',
    ),
    [],
  )

  const mapped = INVENTORY.find((a) => a.id === 'legacy-shared-drive')
  assert.equal(mapped.state, 'ARCHIVING')
  assert.deepEqual(
    codes(inventoryProblems(INVENTORY.map((a) => (a.id === mapped.id ? without(a, 'dependencies') : a)))),
    ['dependency-unmapped'],
  )

  // And an empty list at the same state is fine, because it says somebody looked.
  assert.deepEqual(
    inventoryProblems(INVENTORY.map((a) => (a.id === mapped.id ? { ...a, dependencies: [] } : a))),
    [],
  )
})

test('a dependency pointing outside the register, and a circle inside it, are both found', () => {
  assert.deepEqual(
    codes(
      inventoryProblems(
        INVENTORY.map((a) =>
          a.id === 'legacy-sis' ? { ...a, dependencies: [...a.dependencies, 'legacy-unknown-box'] } : a,
        ),
      ),
    ),
    ['dangling-dependency'],
  )

  const circular = INVENTORY.map((a) =>
    a.id === 'legacy-db-host' ? { ...a, dependencies: ['legacy-db-volume'] } : a,
  )
  const cycles = dependencyCycles(circular)
  assert.equal(cycles.length, 1)
  assert.deepEqual([...new Set(cycles[0])].sort(), ['legacy-db-host', 'legacy-db-volume'])
  assert.equal(codes(inventoryProblems(circular)).includes('dependency-cycle'), true)

  // A three-node circle is one finding, not three: reported once from its
  // canonical member so a cycle does not inflate the count by its own length.
  const three = [
    { ...INVENTORY[0], id: 'a', dependencies: ['b'] },
    { ...INVENTORY[0], id: 'b', dependencies: ['c'] },
    { ...INVENTORY[0], id: 'c', dependencies: ['a'] },
  ]
  assert.equal(dependencyCycles(three).length, 1)
})

// ── §14.2: the state machine ──────────────────────────────────────────────

test('§14.2\'s chain advances one step, never two and never back', () => {
  assert.equal(RETIREMENT_STATES.length, 11)

  // Every adjacent pair is permitted with no control held: eleven states, ten
  // transitions, and the whole chain walked rather than sampled.
  for (let i = 0; i < RETIREMENT_STATES.length - 1; i += 1) {
    assert.deepEqual(
      transitionProblems(RETIREMENT_STATES[i], RETIREMENT_STATES[i + 1], []),
      [],
      `${RETIREMENT_STATES[i]} → ${RETIREMENT_STATES[i + 1]}`,
    )
    assert.equal(nextState(RETIREMENT_STATES[i]), RETIREMENT_STATES[i + 1])
  }
  // The end of the chain is `null`, which is a different answer from an unknown
  // state and is asserted as such.
  assert.equal(nextState(RETIREMENT_STATES[RETIREMENT_STATES.length - 1]), null)
  assert.equal(nextState('NOT_A_STATE'), null)

  // Every skip of two or more, from every state.
  for (let i = 0; i < RETIREMENT_STATES.length; i += 1) {
    for (let j = i + 2; j < RETIREMENT_STATES.length; j += 1) {
      assert.deepEqual(
        codes(transitionProblems(RETIREMENT_STATES[i], RETIREMENT_STATES[j], [])),
        ['skipped-states'],
        `${RETIREMENT_STATES[i]} → ${RETIREMENT_STATES[j]}`,
      )
    }
  }

  // And every backwards move.
  for (let i = 1; i < RETIREMENT_STATES.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      assert.deepEqual(
        codes(transitionProblems(RETIREMENT_STATES[i], RETIREMENT_STATES[j], [])),
        ['backwards-transition'],
        `${RETIREMENT_STATES[i]} → ${RETIREMENT_STATES[j]}`,
      )
    }
  }

  assert.deepEqual(codes(transitionProblems('READ_ONLY', 'READ_ONLY', [])), ['no-transition'])
})

test('each control state blocks exactly the span §14.3 gives it', () => {
  assert.equal(CONTROL_STATES.length, 5)

  for (const control of CONTROL_STATES) {
    const blockFrom = control.blocksFrom === null ? 0 : RETIREMENT_STATES.indexOf(control.blocksFrom)
    assert.equal(blockFrom >= 0, true, `${control.key} names a state not on the chain`)

    for (let i = 0; i < RETIREMENT_STATES.length - 1; i += 1) {
      const problems = transitionProblems(
        RETIREMENT_STATES[i],
        RETIREMENT_STATES[i + 1],
        [control.key],
      )
      if (i >= blockFrom) {
        assert.deepEqual(
          codes(problems),
          ['blocked-by-control-state'],
          `${control.key} did not block ${RETIREMENT_STATES[i]} → ${RETIREMENT_STATES[i + 1]}`,
        )
      } else {
        assert.deepEqual(
          problems,
          [],
          `${control.key} blocked ${RETIREMENT_STATES[i]} → ${RETIREMENT_STATES[i + 1]}, which §14.3 does not`,
        )
      }
    }
  }

  // LEGAL_HOLD lets an asset be archived and made read-only and stops the
  // destruction — the sentence §14.3 actually states, asserted directly.
  assert.deepEqual(transitionProblems('CHANGE_FROZEN', 'READ_ONLY', ['LEGAL_HOLD']), [])
  assert.deepEqual(transitionProblems('READ_ONLY', 'ARCHIVING', ['LEGAL_HOLD']), [])
  assert.deepEqual(codes(transitionProblems('ACCESS_REVOKING', 'DESTROYING', ['LEGAL_HOLD'])), [
    'blocked-by-control-state',
  ])
})

test('a control state is a flag beside the chain, never a position on it', () => {
  for (const control of CONTROL_STATES) {
    assert.equal(
      RETIREMENT_STATES.includes(control.key),
      false,
      `${control.key} is both a control state and a lifecycle state`,
    )
    assert.deepEqual(codes(transitionProblems('READ_ONLY', control.key, [])), [
      'control-state-is-not-a-lifecycle-state',
    ])
    assert.deepEqual(codes(transitionProblems(control.key, 'ARCHIVING', [])), [
      'control-state-is-not-a-lifecycle-state',
    ])
  }
  assert.deepEqual(codes(transitionProblems('NOT_A_STATE', 'ARCHIVING', [])), ['unknown-state'])
  assert.deepEqual(codes(transitionProblems('READ_ONLY', 'ARCHIVING', ['MADE_UP_FLAG'])), [
    'unknown-control-state',
  ])
})

test('the worked transitions land on the verdicts the document publishes', () => {
  const expected = {
    'archive-after-window': [],
    'archive-inside-rollback-window': ['blocked-by-control-state'],
    'destroy-under-legal-hold': ['blocked-by-control-state'],
    'destroy-under-retention': ['blocked-by-control-state'],
    'approve-with-blocked-dependency': ['blocked-by-control-state'],
    'skip-to-verified': ['skipped-states'],
    'resurrect-a-destroyed-asset': ['backwards-transition'],
    'advance-while-aborted': ['blocked-by-control-state'],
  }
  assert.equal(TRANSITIONS.length, Object.keys(expected).length)
  for (const attempt of TRANSITIONS) {
    assert.deepEqual(
      codes(transitionProblems(attempt.from, attempt.to, attempt.controls)),
      expected[attempt.id],
      attempt.id,
    )
  }
})

// ── every refusal scenario, re-run ────────────────────────────────────────

test('every refusal scenario produces exactly the code it is about', () => {
  const expected = {
    'kind-not-surveyed': ['kind-not-surveyed'],
    'survey-unreasoned': ['survey-unreasoned'],
    'fact-missing': ['fact-missing'],
    'dangling-dependency': ['dangling-dependency'],
    'dependency-unmapped': ['dependency-unmapped'],
    'dependency-cycle': ['dependency-cycle'],
    'duplicate-asset': ['duplicate-asset'],
    'unknown-kind': ['unknown-kind'],
    'control-state-as-lifecycle-state': ['control-state-is-not-a-lifecycle-state'],
  }

  assert.equal(REFUSALS.length, Object.keys(expected).length)
  for (const refusal of REFUSALS) {
    assert.deepEqual(codes(refusal.run()), expected[refusal.id].slice().sort(), refusal.id)
  }
})
