/**
 * EXT-100-004 / -005 / -006 / -007 / -009 — the Cutover Command Center's rules.
 *
 * Authority: `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md`
 * §12.3 (runbook bindings), §12.4 (horizons), §12.5 (freeze and dual writes),
 * §12.6 (go/no-go), §12.8 (last reversible point and boundary plans).
 *
 * The worked cutover this asserts over is declared once, in
 * `tools/cutover-command-center.mjs`, and read twice — by that generator, which
 * writes `docs/architecture/cutover-command-center.md`, and by this file. A
 * worked example that lives only in a document is a claim; one a test re-runs is
 * evidence, and §12.1's warning that cutover "never becomes an unchecked
 * spreadsheet with stale copies" applies to the document about cutover too.
 *
 * Two kinds of assertion, and the second is the one that would catch a rule that
 * had quietly stopped refusing anything:
 *
 *   · the valid plan produces ZERO findings from all five modules;
 *   · each refusal scenario produces EXACTLY the code it is about, and no other.
 *     `deepEqual` on the code set rather than `ok(problems.length > 0)`, because
 *     "something refused it" is satisfied by a rule firing for the wrong reason.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

import {
  DUAL_OPERATION_PROOFS,
  DUAL_WRITE_PROOFS,
  FREEZE_CLASSES,
  classifyObject,
  dualWriteVerdict,
  freezeProblems,
} from '../../packages/provisioning/src/cutover-freeze.mjs'
import {
  HORIZONS,
  horizonOf,
  horizonProblems,
  horizonWindows,
} from '../../packages/provisioning/src/cutover-horizons.mjs'
import {
  REQUIRED_TASK_BINDINGS,
  dependencyCycles,
  plannedDuration,
  runbookProblems,
  taskProblems,
} from '../../packages/provisioning/src/cutover-runbook.mjs'
import {
  DECISIONS,
  GO_NO_GO_DIMENSIONS,
  boardReadiness,
  decide,
  decisionProblems,
  defectBlockers,
} from '../../packages/provisioning/src/cutover-go-no-go.mjs'
import {
  BOUNDARY_PLAN_CONTRACT,
  boundaryPlanProblems,
  forwardRecoveryProblems,
  lastReversiblePoint,
} from '../../packages/provisioning/src/cutover-rollback.mjs'
import {
  BOARD_TIME,
  BOUNDARY_PLANS,
  DECISION,
  DEFECTS,
  EVIDENCE,
  EXECUTED_BEFORE_CONVERSION,
  EXECUTED_THROUGH_CONVERSION,
  FREEZE_PLAN,
  REFUSALS,
  T0,
  TASKS,
} from '../../tools/cutover-command-center.mjs'

const codes = (problems) => [...new Set(problems.map((p) => p.reason ?? p.verdict ?? p.result))].sort()

// ── the generated document ────────────────────────────────────────────────

test('the committed cutover-command-center document is not stale', () => {
  const out = execFileSync('node', ['tools/cutover-command-center.mjs', '--check'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.match(out, /up to date/)
})

// ── the valid plan ────────────────────────────────────────────────────────

test('the worked plan satisfies all five §12 rule sets', () => {
  assert.deepEqual(freezeProblems(FREEZE_PLAN), [], 'freeze')
  assert.deepEqual(horizonProblems({ t0: T0, tasks: TASKS }), [], 'horizons')
  assert.deepEqual(runbookProblems(TASKS), [], 'runbook')
  assert.deepEqual(boundaryPlanProblems(TASKS, BOUNDARY_PLANS), [], 'boundaries')

  const readiness = boardReadiness(EVIDENCE, BOARD_TIME)
  assert.deepEqual(
    readiness.filter((r) => r.verdict !== 'SATISFIED'),
    [],
    'every §12.6 dimension satisfied',
  )
  assert.equal(decide({ readiness, defects: DEFECTS }).result, 'GO')
  assert.deepEqual(decisionProblems(DECISION, { readiness, defects: DEFECTS }), [], 'decision record')
})

test('each refusal scenario is refused for exactly the reason it is about', () => {
  const expected = {
    'unclassified-object': ['unclassified'],
    'undeclared-dual-write': ['dual-write-prohibited'],
    'dual-operation-unproven': ['dual-operation-unproven'],
    'soft-freeze-without-delta-capture': ['soft-freeze-no-delta-capture'],
    'horizon-not-covered': ['horizon-not-covered'],
    'prerequisite-runs-later': ['prerequisite-runs-later'],
    'no-tenant-t0': ['no-t0'],
    'floating-version': ['version-not-exact'],
    'self-approved-task': ['self-approved'],
    'retry-without-idempotency': ['retry-without-idempotency'],
    'dependency-cycle': ['dependency-cycle'],
    'stale-evidence': ['STALE'],
    'go-on-unsupported-evidence': ['go-not-supported-by-evidence'],
    's2-without-permitted-risk': ['NO_GO'],
    'down-migration-rollback': ['unsafe-database-rollback'],
    'uncovered-boundary': ['no-plan'],
    'forward-recovery-unrecorded': ['no-explicit-move'],
  }

  assert.deepEqual(
    REFUSALS.map((r) => r.id).sort(),
    Object.keys(expected).sort(),
    'every declared scenario is asserted, and every assertion has a scenario',
  )

  for (const refusal of REFUSALS) {
    const out = refusal.run()
    const actual = Array.isArray(out) ? codes(out) : [out.result]
    assert.deepEqual(actual, expected[refusal.id], `${refusal.id} (${refusal.requirement})`)
  }
})

// ── EXT-100-004: horizons ─────────────────────────────────────────────────

test('§12.4 horizons are computed from the tenant\'s own T0, not from a calendar', () => {
  const a = horizonWindows('2026-09-15')
  const b = horizonWindows('2027-03-01')
  assert.equal(a.windows[0].start, '2026-06-17') // T0 − 90 days, UTC
  assert.equal(b.windows[0].start, '2026-12-01')
  assert.notEqual(a.windows[3].start, b.windows[3].start)

  // §12.4 names five horizons and the T+ one has no end.
  assert.equal(HORIZONS.length, 5)
  assert.equal(a.windows.at(-1).end, null)
})

test('a plan with no T0 is unknown, not empty', () => {
  const missing = horizonWindows(undefined)
  assert.equal(missing.known, false)
  assert.match(missing.why, /tenant-specific/)
  // An impossible calendar date is refused rather than rolled over.
  assert.equal(horizonWindows('2026-02-30').known, false)
})

test('the horizon windows are contiguous and half-open', () => {
  // A boundary date belongs to exactly one horizon — the later one. Closed
  // windows would put T0−30 in two, and a tie-break rule is a rule a reader has
  // to know.
  assert.equal(horizonOf('2026-08-16', T0).horizon, 'T_MINUS_30')
  assert.equal(horizonOf('2026-08-15', T0).horizon, 'T_MINUS_90')
  assert.equal(horizonOf('2026-09-14', T0).horizon, 'T_MINUS_7')
  assert.equal(horizonOf('2026-09-15', T0).horizon, 'T0')
  assert.equal(horizonOf('2026-09-16', T0).horizon, 'T_PLUS')
  assert.equal(horizonOf('2030-01-01', T0).horizon, 'T_PLUS')

  // Earlier than every window §12.4 requires: unscheduled, not "early".
  const early = horizonOf('2026-01-01', T0)
  assert.equal(early.known, false)
  assert.match(early.why, /unscheduled, not early/)
})

test('a horizon label that disagrees with the task date is refused, not corrected', () => {
  const problems = horizonProblems({
    t0: T0,
    tasks: TASKS.map((t) => (t.id === 'change-freeze' ? { ...t, horizon: 'T0' } : t)),
  })
  assert.deepEqual(codes(problems), ['horizon-contradicts-date'])
})

// ── EXT-100-005: freeze and dual writes ───────────────────────────────────

test('§12.5\'s five classes are the classes, and an unknown one is refused', () => {
  assert.deepEqual(FREEZE_CLASSES, [
    'HARD_FREEZE',
    'SOFT_FREEZE',
    'READ_ONLY_COEXISTENCE',
    'DUAL_OPERATION',
    'DEFERRED_MIGRATION',
  ])
  const problems = freezeProblems({
    scopeObjects: ['X'],
    objects: [{ object: 'X', class: 'FROZEN_ISH', cutoff: '2026-09-15T02:00:00Z' }],
  })
  assert.deepEqual(codes(problems), ['unknown-class'])
})

test('a dual write is prohibited by default and permitted only with all six proofs', () => {
  assert.equal(DUAL_WRITE_PROOFS.length, 6)
  assert.equal(DUAL_OPERATION_PROOFS.length, 6)

  const permitted = FREEZE_PLAN.objects.find((o) => o.object === 'PersonDirectory')
  assert.equal(dualWriteVerdict(permitted).allowed, true)

  // Each proof removed on its own, one at a time: six mutations, six refusals.
  for (const proof of DUAL_WRITE_PROOFS) {
    const without = {
      ...permitted,
      dualWriteProofs: { ...permitted.dualWriteProofs, [proof.key]: undefined },
    }
    const verdict = dualWriteVerdict(without)
    assert.equal(verdict.allowed, false, `${proof.key} removed`)
    assert.deepEqual([...verdict.missing], [proof.key])
  }

  // The class is part of the permission: the same six proofs under a class that
  // is not DUAL_OPERATION are still prohibited.
  const wrongClass = dualWriteVerdict({ ...permitted, class: 'SOFT_FREEZE' })
  assert.equal(wrongClass.allowed, false)
  assert.equal(wrongClass.wrongClass, true)

  // Silence is not permission, and it is not a refusal either.
  const single = dualWriteVerdict({ object: 'Y', class: 'HARD_FREEZE', writesTo: ['tenure'] })
  assert.deepEqual({ ...single }, { allowed: false, dualWrite: false, writers: ['tenure'] })
})

test('a hard freeze with a source change after cutoff is a violated classification', () => {
  const problems = freezeProblems({
    scopeObjects: ['GeneralLedger'],
    objects: [
      {
        object: 'GeneralLedger',
        class: 'HARD_FREEZE',
        cutoff: '2026-09-15T02:00:00Z',
        writesTo: ['tenure'],
        sourceChangesAfterCutoff: ['JE-9001 posted at 02:14Z'],
      },
    ],
  })
  assert.deepEqual(codes(problems), ['hard-freeze-violated'])
})

test('read-only coexistence that names legacy as a writer is refused', () => {
  const problems = freezeProblems({
    scopeObjects: ['LegacyReportArchive'],
    objects: [
      {
        object: 'LegacyReportArchive',
        class: 'READ_ONLY_COEXISTENCE',
        cutoff: '2026-09-15T02:00:00Z',
        writesTo: ['legacy'],
      },
    ],
  })
  assert.deepEqual(codes(problems), ['read-only-coexistence-writes'])
})

test('a deferred migration with no governed link and no retirement plan is refused twice', () => {
  const problems = freezeProblems({
    scopeObjects: ['BankStatement'],
    objects: [
      { object: 'BankStatement', class: 'DEFERRED_MIGRATION', cutoff: '2026-09-15T02:00:00Z' },
    ],
  })
  assert.deepEqual(codes(problems), [
    'deferred-migration-never-retires',
    'deferred-migration-ungoverned',
  ])
})

test('an object nobody classified is reported as unclassified, never defaulted', () => {
  const answer = classifyObject(FREEZE_PLAN, 'GrantAward')
  assert.equal(answer.classified, false)
  assert.equal(answer.class, undefined)
  assert.equal(classifyObject(FREEZE_PLAN, 'GeneralLedger').class, 'HARD_FREEZE')
})

// ── EXT-100-006: runbook bindings ─────────────────────────────────────────

test('§12.3\'s nine bindings are each individually required', () => {
  assert.equal(REQUIRED_TASK_BINDINGS.length, 9)
  const valid = TASKS.find((t) => t.id === 'activation')
  assert.deepEqual(taskProblems(valid), [])

  for (const binding of REQUIRED_TASK_BINDINGS) {
    const without = { ...valid, [binding.key]: undefined }
    const problems = taskProblems(without)
    assert.ok(
      problems.some((p) => p.reason === 'unbound' && p.detail.includes(binding.phrase)),
      `removing ${binding.key} is not refused`,
    )
  }
})

test('a floating version is not an exact version', () => {
  const valid = TASKS.find((t) => t.id === 'activation')
  for (const version of ['latest', 'main', 'HEAD', '^2.1.0', '~2.1.0', '2.1.x', '*']) {
    assert.deepEqual(
      codes(taskProblems({ ...valid, version })),
      ['version-not-exact'],
      `"${version}" accepted as exact`,
    )
  }
  // A pinned artifact is not refused.
  assert.deepEqual(taskProblems({ ...valid, version: 'rel-2026.09.1+sha.4f21c0' }), [])
})

test('verification needs both thresholds and evidence, and they are three separate findings', () => {
  const valid = TASKS.find((t) => t.id === 'smoke-and-isolation')
  assert.deepEqual(codes(taskProblems({ ...valid, verification: { failure: 'x', evidence: 'y' } })), [
    'no-success-threshold',
  ])
  assert.deepEqual(codes(taskProblems({ ...valid, verification: { success: 'x', evidence: 'y' } })), [
    'no-failure-threshold',
  ])
  assert.deepEqual(codes(taskProblems({ ...valid, verification: { success: 'x', failure: 'y' } })), [
    'no-evidence',
  ])
})

test('a zero-duration task is refused because it sums into a window that fits', () => {
  const valid = TASKS.find((t) => t.id === 'activation')
  assert.deepEqual(codes(taskProblems({ ...valid, durationMinutes: 0 })), ['duration-not-positive'])

  // And a duration the plan does not carry is named, not silently omitted.
  const { total, unbound } = plannedDuration([
    { id: 'a', durationMinutes: 30 },
    { id: 'b' },
  ])
  assert.equal(total, 30)
  assert.deepEqual([...unbound], ['b'])
})

test('a prerequisite cycle is found and reported once, from its lowest-sorting member', () => {
  const cycles = dependencyCycles([
    { id: 'c', prerequisites: ['b'] },
    { id: 'b', prerequisites: ['a'] },
    { id: 'a', prerequisites: ['c'] },
    { id: 'z', prerequisites: [] },
  ])
  assert.equal(cycles.length, 1)
  assert.deepEqual([...cycles[0]], ['a', 'c', 'b'])

  // A long chain is data, so it must not end the process instead of reporting.
  const chain = Array.from({ length: 20_000 }, (_, i) => ({
    id: `t${i}`,
    prerequisites: i === 0 ? [] : [`t${i - 1}`],
  }))
  assert.deepEqual(dependencyCycles(chain), [])
})

// ── EXT-100-007: go/no-go ─────────────────────────────────────────────────

test('§12.6\'s eight dimensions and four results are the board\'s vocabulary', () => {
  assert.equal(GO_NO_GO_DIMENSIONS.length, 8)
  assert.deepEqual(DECISIONS, ['GO', 'NO_GO', 'PAUSE_AND_REASSESS', 'ROLLBACK'])
})

test('absent, stale and failing evidence are three different verdicts', () => {
  const dimension = GO_NO_GO_DIMENSIONS.find((d) => d.key === 'smoke_isolation')
  const verdictFor = (record) =>
    boardReadiness({ ...EVIDENCE, smoke_isolation: record }, BOARD_TIME).find(
      (r) => r.key === 'smoke_isolation',
    ).verdict

  assert.equal(verdictFor(undefined), 'NOT_PRESENTED')
  assert.equal(verdictFor({ ready: true }), 'NOT_PRESENTED') // no timestamp: cannot be current
  assert.equal(verdictFor({ ready: false, asOf: '2026-09-15T13:20:00Z' }), 'NOT_SATISFIED')
  assert.equal(verdictFor({ ready: true, asOf: '2026-09-15T13:20:00Z' }), 'SATISFIED')

  // Exactly at the budget is current; one minute past it is not. The budget is
  // the module's own declared number, read from the dimension rather than
  // duplicated here, so the assertion cannot drift from the rule.
  const at = Date.parse(BOARD_TIME)
  const exactly = new Date(at - dimension.freshnessHours * 3_600_000).toISOString()
  const past = new Date(at - dimension.freshnessHours * 3_600_000 - 60_000).toISOString()
  assert.equal(verdictFor({ ready: true, asOf: exactly }), 'SATISFIED')
  assert.equal(verdictFor({ ready: true, asOf: past }), 'STALE')

  // Evidence dated after the board is a clock error, not fresh evidence.
  assert.equal(verdictFor({ ready: true, asOf: '2026-09-16T00:00:00Z' }), 'STALE')
})

test('the derived result distinguishes what can be resolved tonight from what cannot', () => {
  const all = boardReadiness(EVIDENCE, BOARD_TIME)
  assert.equal(decide({ readiness: all, defects: DEFECTS }).result, 'GO')

  // Evidence not yet presented is a pause: the board can go and get it.
  const { smoke_isolation: _absent, ...partial } = EVIDENCE
  assert.equal(
    decide({ readiness: boardReadiness(partial, BOARD_TIME), defects: DEFECTS }).result,
    'PAUSE_AND_REASSESS',
  )

  // Evidence that positively says not-ready is a NO_GO.
  const refuted = { ...EVIDENCE, smoke_isolation: { ready: false, asOf: '2026-09-15T13:20:00Z' } }
  assert.equal(
    decide({ readiness: boardReadiness(refuted, BOARD_TIME), defects: DEFECTS }).result,
    'NO_GO',
  )

  // After activation has begun the honest option is ROLLBACK, not NO_GO.
  assert.equal(
    decide({
      readiness: boardReadiness(refuted, BOARD_TIME),
      defects: DEFECTS,
      activationStarted: true,
    }).result,
    'ROLLBACK',
  )
})

test('§12.6\'s defect rule: S0/S1 block absolutely, S2 only with a permitted risk', () => {
  assert.deepEqual(defectBlockers(DEFECTS), [])

  const s1 = defectBlockers([{ id: 'D-1', severity: 'S1', resolved: false }])
  assert.deepEqual(codes(s1), ['unresolved-critical'])

  // An S0 with a fully specified accepted risk still blocks — §12.6 gives the
  // exceptional-risk authority to S2 only.
  const s0 = defectBlockers([
    {
      id: 'D-2',
      severity: 'S0',
      resolved: false,
      acceptedRisk: { authority: 'executive-sponsor', compensatingControl: 'x', expiry: '2026-10-01' },
    },
  ])
  assert.deepEqual(codes(s0), ['unresolved-critical'])

  // An S2 needs all three; each missing one refuses.
  for (const field of ['authority', 'compensatingControl', 'expiry']) {
    const risk = { authority: 'a', compensatingControl: 'c', expiry: '2026-10-01', [field]: undefined }
    assert.deepEqual(
      codes(defectBlockers([{ id: 'D-3', severity: 'S2', resolved: false, acceptedRisk: risk }])),
      ['s2-without-permitted-risk'],
      `S2 accepted without ${field}`,
    )
  }

  // Unassessed is not minor.
  assert.deepEqual(codes(defectBlockers([{ id: 'D-4', resolved: false }])), ['unclassified-defect'])
})

test('a recorded GO the evidence refuses is refused, and so is an incomplete record', () => {
  const refuted = { ...EVIDENCE, defects: { ready: false, asOf: '2026-09-15T13:45:00Z' } }
  assert.deepEqual(
    codes(
      decisionProblems(DECISION, {
        readiness: boardReadiness(refuted, BOARD_TIME),
        defects: DEFECTS,
      }),
    ),
    ['go-not-supported-by-evidence'],
  )

  const context = { readiness: boardReadiness(EVIDENCE, BOARD_TIME), defects: DEFECTS }
  const missing = {
    evidenceDigest: 'no-evidence-digest',
    expiry: 'no-expiry',
    at: 'no-decision-time',
  }
  for (const [field, reason] of Object.entries(missing)) {
    const problems = decisionProblems({ ...DECISION, [field]: undefined }, context)
    assert.ok(problems.some((p) => p.reason === reason), `${field} removed: got ${codes(problems)}`)
  }

  // Attendance is not a position.
  assert.deepEqual(
    codes(
      decisionProblems(
        { ...DECISION, participants: [{ seat: 'cutover-commander' }] },
        context,
      ),
    ),
    ['participant-without-vote'],
  )

  // An authorization with no live window.
  assert.deepEqual(
    codes(decisionProblems({ ...DECISION, expiry: DECISION.at }, context)),
    ['expiry-not-after-decision'],
  )

  // A conditional GO whose condition nobody owns.
  assert.deepEqual(
    codes(
      decisionProblems(
        { ...DECISION, conditions: [{ condition: 'run the export', dueBy: '2026-09-21T17:00:00Z' }] },
        context,
      ),
    ),
    ['condition-without-owner'],
  )
})

// ── EXT-100-009: last reversible point and boundary plans ─────────────────

test('the last reversible point moves as the cutover advances', () => {
  const nothing = lastReversiblePoint(TASKS, [])
  assert.equal(nothing.reversible, true)
  assert.equal(nothing.taskId, null)
  assert.equal(nothing.nextIrreversible, 'conversion-load')

  const early = lastReversiblePoint(TASKS, ['stop-integrations'])
  assert.equal(early.taskId, 'stop-integrations')

  const before = lastReversiblePoint(TASKS, EXECUTED_BEFORE_CONVERSION)
  assert.equal(before.reversible, true)
  assert.equal(before.taskId, 'final-extracts')
  assert.equal(before.forwardRecoveryRequired, false)

  // The same function, one more executed task: the point is gone.
  const after = lastReversiblePoint(TASKS, EXECUTED_THROUGH_CONVERSION)
  assert.equal(after.reversible, false)
  assert.equal(after.forwardRecoveryRequired, true)
  assert.equal(after.crossedAt, 'conversion-load')
  assert.equal(after.lastReversibleTaskId, 'final-extracts')

  // Reversible work completed AFTER the crossing does not resurrect the point.
  const later = lastReversiblePoint(TASKS, [...EXECUTED_THROUGH_CONVERSION, 'reconciliation'])
  assert.equal(later.reversible, false)
  assert.equal(later.lastReversibleTaskId, 'final-extracts')
})

test('a task with no declared reversibility is undeclared, never assumed reversible', () => {
  const undeclared = lastReversiblePoint(
    TASKS.map((t) => (t.id === 'conversion-load' ? { ...t, reversibility: undefined } : t)),
    EXECUTED_THROUGH_CONVERSION,
  )
  assert.ok(undeclared.undeclared.includes('conversion-load'))
  // And the point does not silently include it: nothing was crossed, because
  // nothing said it could not be crossed back.
  assert.equal(undeclared.reversible, true)
})

test('§12.8\'s seven boundaries each carry a plan contract, and the database one refuses down migrations', () => {
  assert.equal(BOUNDARY_PLAN_CONTRACT.length, 7)
  assert.deepEqual(boundaryPlanProblems(TASKS, BOUNDARY_PLANS), [])

  for (const method of ['DOWN_MIGRATION', 'down migration', 'prisma migrate resolve --rolled-back']) {
    assert.deepEqual(
      codes(
        boundaryPlanProblems(
          TASKS,
          BOUNDARY_PLANS.map((p) => (p.boundary === 'DATABASE' ? { ...p, method } : p)),
        ),
      ),
      ['unsafe-database-rollback'],
      `"${method}" accepted`,
    )
  }
  for (const method of ['FORWARD_FIX', 'RESTORE', 'COMPATIBILITY_SWITCH']) {
    assert.deepEqual(
      boundaryPlanProblems(
        TASKS,
        BOUNDARY_PLANS.map((p) => (p.boundary === 'DATABASE' ? { ...p, method } : p)),
      ),
      [],
      `"${method}" refused`,
    )
  }

  // Every required field of every boundary, one at a time.
  for (const contract of BOUNDARY_PLAN_CONTRACT) {
    for (const field of contract.requires) {
      const problems = boundaryPlanProblems(
        TASKS,
        BOUNDARY_PLANS.map((p) => (p.boundary === contract.key ? { ...p, [field]: undefined } : p)),
      )
      assert.ok(
        problems.some((p) => p.reason === 'incomplete-plan' && p.detail.includes(field)),
        `${contract.key}.${field} removed but not refused`,
      )
    }
  }
})

test('the touched boundaries come from the tasks, so a plan cannot be complete by omission', () => {
  // IDENTITY is touched by two tasks. Dropping its plan is refused even though
  // the remaining plan list is internally consistent.
  assert.deepEqual(
    codes(boundaryPlanProblems(TASKS, BOUNDARY_PLANS.filter((p) => p.boundary !== 'IDENTITY'))),
    ['no-plan'],
  )
  // A cutover that touches nothing needs no plans.
  assert.deepEqual(boundaryPlanProblems([], []), [])
})

test('moving to forward recovery is an explicit record, and its absence is the finding', () => {
  const crossed = lastReversiblePoint(TASKS, EXECUTED_THROUGH_CONVERSION)
  assert.deepEqual(codes(forwardRecoveryProblems(null, crossed)), ['no-explicit-move'])

  const record = {
    authority: 'executive-sponsor',
    impact: 'transactions posted after the T0 snapshot cannot be reversed; delta-set 7 is re-keyed',
    evidence: 'evidence://cutover/reconciliation',
    at: '2026-09-15T19:40:00Z',
  }
  assert.deepEqual(forwardRecoveryProblems(record, crossed), [])

  for (const field of ['authority', 'impact', 'evidence', 'at']) {
    const problems = forwardRecoveryProblems({ ...record, [field]: undefined }, crossed)
    assert.equal(problems.length, 1, `${field}: got ${codes(problems)}`)
  }

  // Recorded while rollback is still available: giving up a reversal the plan has.
  const stillReversible = lastReversiblePoint(TASKS, EXECUTED_BEFORE_CONVERSION)
  assert.deepEqual(codes(forwardRecoveryProblems(record, stillReversible)), ['premature-move'])
})
