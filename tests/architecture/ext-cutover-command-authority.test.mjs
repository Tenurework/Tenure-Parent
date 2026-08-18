/**
 * EXT-100-002 / -003 / -008 — command authority, plan levels, and activation.
 *
 * Authority: `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md`
 * §12.2 (command roles), §12.3 (cutover plan levels), §12.7 (activation and
 * validation).
 *
 * Companion to `ext-cutover-command-center.test.mjs`, which covers §12.4–§12.8.
 * The worked cutover this asserts over is declared once, in
 * `tools/cutover-command-authority.mjs`, and read twice — by that generator,
 * which writes `docs/architecture/cutover-command-authority.md`, and by this
 * file.
 *
 * Two kinds of assertion, and the second is the one that would catch a rule that
 * had quietly stopped refusing anything:
 *
 *   · the valid fixtures produce ZERO findings from all three modules;
 *   · each refusal scenario produces EXACTLY the code it is about, and no other.
 *     `deepEqual` on the code set rather than `ok(problems.length > 0)`, because
 *     "something refused it" is satisfied by a rule firing for the wrong reason.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

import {
  COMMAND_SEATS,
  REQUIRED_SEAT_FACTS,
  SCOPED_SEATS,
  TERMINAL_ESCALATION,
  contactMatrix,
  coverageGaps,
  escalationChain,
  rosterProblems,
} from '../../packages/provisioning/src/cutover-command-roles.mjs'
import {
  COMMUNICATION_ELEMENTS,
  DECISION_ELEMENTS,
  PLAN_LEVELS,
  PLAN_PHASES,
  STRATEGY_ELEMENTS,
  levelCoverage,
  planProblems,
} from '../../packages/provisioning/src/cutover-plan-levels.mjs'
import {
  ACTIVATION_MANIFESTS,
  ISOLATION_ASSERTIONS,
  PROGRESSIVE_CHANGES,
  VALIDATION_CHECKS,
  VERDICTS,
  activationCommandProblems,
  activationVerdict,
  deviationProblems,
  progressiveChangeProblems,
  smokeProblems,
  validationProblems,
} from '../../packages/provisioning/src/cutover-activation.mjs'
import {
  ACTIVATION,
  ACTIVATION_COMMAND,
  APPLICABLE_SCOPES,
  CHANGES,
  DEVIATIONS,
  PLAN,
  REFUSALS,
  ROSTER,
  SMOKE_RECORDS,
  TENANT,
  VALIDATION,
} from '../../tools/cutover-command-authority.mjs'
import { TASKS } from '../../tools/cutover-command-center.mjs'

const codes = (problems) => [...new Set(problems.map((p) => p.reason))].sort()
const patch = (seatKey, over) => ({
  ...ROSTER,
  seats: ROSTER.seats.map((s) => (s.seat === seatKey ? { ...s, ...over } : s)),
})

// ── the generated document ────────────────────────────────────────────────

test('the committed cutover-command-authority document is not stale', () => {
  const out = execFileSync('node', ['tools/cutover-command-authority.mjs', '--check'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.match(out, /up to date/)
})

// ── the valid fixtures ────────────────────────────────────────────────────

test('the worked roster, plan set and activation satisfy §12.2, §12.3 and §12.7', () => {
  assert.deepEqual(rosterProblems(ROSTER, APPLICABLE_SCOPES), [], 'roster')
  assert.deepEqual(planProblems(PLAN, { runbookTasks: TASKS, roster: ROSTER }), [], 'plan levels')
  const verdict = activationVerdict(ACTIVATION)
  assert.deepEqual(verdict.problems, [], 'activation')
  assert.equal(verdict.result, 'RELEASE')
})

test('each refusal scenario is refused for exactly the reason it is about', () => {
  const expected = {
    'relay-in-an-accountable-seat': ['relay-accountable'],
    'relay-as-the-backup-for-an-accountable-seat': ['relay-accountable'],
    'an-hour-with-nobody-in-the-seat': ['coverage-gap'],
    'an-escalation-that-loops': ['escalation-cycle'],
    'a-backup-who-is-the-occupant': ['backup-is-occupant'],
    'an-empty-seat': ['seat-unstaffed'],
    'a-decision-that-changed-a-task-nobody-has': ['decision-affects-unknown-task'],
    'a-decision-taken-by-a-seat-with-no-authority': ['decision-authority-not-accountable'],
    'an-audience-owned-by-a-person': ['communication-owner-not-a-seat'],
    'a-plan-that-stops-at-cutover': ['phase-uncovered'],
    'a-decision-log-read-without-the-runbook': ['runbook-not-supplied'],
    'activation-bound-to-latest': ['manifest-version-not-exact'],
    'activation-pressed-twice': ['not-idempotent'],
    'activation-approved-by-its-executor': ['self-approved'],
    'a-flip-nobody-explained': ['not-progressive-and-unexplained'],
    'a-canary-in-another-tenant': ['wrong-tenant'],
    'a-canary-deleted-by-hand': ['cleanup-unaudited'],
    'a-validation-nobody-ran': ['check-not-run'],
    'isolation-unverified-is-not-isolation-clean': ['isolation-unverified'],
  }
  assert.equal(REFUSALS.length, Object.keys(expected).length)
  for (const refusal of REFUSALS) {
    assert.deepEqual(codes(refusal.run()), expected[refusal.id], refusal.id)
  }
})

// ── EXT-100-002: the command roster ───────────────────────────────────────

test("§12.2's seats and seven facts are the roster's vocabulary", () => {
  assert.equal(COMMAND_SEATS.length, 23)
  assert.equal(REQUIRED_SEAT_FACTS.length, 7)
  assert.deepEqual(
    REQUIRED_SEAT_FACTS.map((f) => f.phrase),
    ['authority', 'handoff', 'time-zone coverage', 'contact channel', 'backup', 'escalation', 'decision rights'],
  )
  // §12.2's accountable seats: the go-live authority, command, incident command,
  // the decision record, and rollback. The Relay prohibition hangs off exactly
  // this set, so it is asserted rather than left to the flag.
  assert.deepEqual(
    COMMAND_SEATS.filter((s) => s.accountable).map((s) => s.key),
    ['executive-sponsor', 'cutover-commander', 'cutover-deputy', 'incident-commander', 'decision-recorder', 'rollback-authority'],
  )
})

test("each of §12.2's seven facts is individually required", () => {
  for (const fact of REQUIRED_SEAT_FACTS) {
    const problems = rosterProblems(patch('security-lead', { [fact.key]: undefined }), APPLICABLE_SCOPES)
    const missing = problems.filter((p) => p.reason === 'seat-fact-missing' && p.seat === 'security-lead')
    assert.equal(missing.length, 1, `removing ${fact.key} is not refused exactly once`)
    assert.ok(missing[0].detail.includes(fact.phrase), `${fact.key} refused without naming "${fact.phrase}"`)
  }
})

test('Relay may not occupy or back an accountable seat, and may hold an unaccountable one', () => {
  // Each spelling exercises a DIFFERENT alternative of the rule, so that
  // removing any one of them is a failure rather than a smaller list: "Relay
  // Copilot" would still be caught by the `relay` alternative, which is exactly
  // how an untested alternative survives a mutation.
  const spellings = ['Relay', 'Copilot', 'relay-agent', 'AI assistant', 'autonomous agent']
  for (const seat of COMMAND_SEATS.filter((s) => s.accountable)) {
    for (const occupant of spellings) {
      assert.deepEqual(
        codes(rosterProblems(patch(seat.key, { occupant }), APPLICABLE_SCOPES)),
        ['relay-accountable'],
        `${occupant} accepted as ${seat.key}`,
      )
      assert.deepEqual(
        codes(rosterProblems(patch(seat.key, { backup: occupant }), APPLICABLE_SCOPES)),
        ['relay-accountable'],
        `${occupant} accepted as backup for ${seat.key}`,
      )
    }
  }
  // §12.2 prohibits an accountable COMMAND ROLE, not participation. The
  // Relay/search lead is not accountable, and a rule that refused it too would
  // be refusing something the document permits.
  assert.deepEqual(
    rosterProblems(patch('relay-search-lead', { occupant: 'Relay Copilot' }), APPLICABLE_SCOPES),
    [],
  )
  // And a person whose name merely contains the letters is not Relay.
  assert.deepEqual(
    rosterProblems(patch('rollback-authority', { occupant: 'Relayton Consulting' }), APPLICABLE_SCOPES),
    [],
  )
})

test('time-zone coverage is arithmetic over the day, not a claim about it', () => {
  const day = 24 * 60

  // The worked rota tiles the day, including the window that wraps midnight.
  const full = coverageGaps([
    { from: '00:00', to: '08:00', occupant: 'a' },
    { from: '08:00', to: '16:00', occupant: 'b' },
    { from: '16:00', to: '00:00', occupant: 'c' },
  ])
  assert.equal(full.coveredMinutes, day)
  assert.deepEqual(full.gaps, [])

  // One hour missing is one gap, named by its own boundaries.
  const gap = coverageGaps([
    { from: '00:00', to: '08:00', occupant: 'a' },
    { from: '09:00', to: '00:00', occupant: 'b' },
  ])
  assert.deepEqual(
    gap.gaps.map((g) => `${g.from}-${g.to}`),
    ['08:00-09:00'],
  )
  assert.equal(gap.coveredMinutes, day - 60)

  // A gap that runs to the end of the day closes at 24:00, and does not appear
  // on a day that is fully covered.
  assert.deepEqual(
    coverageGaps([{ from: '00:00', to: '22:00', occupant: 'a' }]).gaps.map((g) => `${g.from}-${g.to}`),
    ['22:00-24:00'],
  )

  // "We could not read the rota" is not "nobody is on it".
  const unreadable = coverageGaps([{ from: '25:00', to: '08:00', occupant: 'a' }])
  assert.equal(unreadable.malformed.length, 1)
  assert.equal(unreadable.coveredMinutes, 0)
  assert.deepEqual(
    codes(rosterProblems(patch('scribe', { coverage: [{ from: '25:00', to: '08:00', occupant: 'a' }] }), APPLICABLE_SCOPES)),
    ['coverage-unreadable'],
  )
})

test('an escalation path must reach an accountable seat, and may not loop', () => {
  const clean = escalationChain(ROSTER, 'banking-lead')
  assert.deepEqual([...clean.chain], ['banking-lead', 'cutover-commander', 'executive-sponsor'])
  assert.equal(clean.reason, 'authority')

  assert.deepEqual(
    codes(rosterProblems(patch('executive-sponsor', { escalation: 'cutover-commander' }), APPLICABLE_SCOPES)),
    ['escalation-cycle'],
  )
  assert.deepEqual(
    codes(rosterProblems(patch('privacy-lead', { escalation: 'chief-of-staff' }), APPLICABLE_SCOPES)),
    ['escalation-to-unknown-seat'],
  )
  // A lead who declares itself the top of the tree absorbs a decision it has no
  // authority to take; the same declaration on an accountable seat is correct.
  assert.deepEqual(
    codes(rosterProblems(patch('finance-lead', { escalation: TERMINAL_ESCALATION }), APPLICABLE_SCOPES)),
    ['terminal-escalation-without-authority'],
  )
  assert.deepEqual(
    rosterProblems(patch('incident-commander', { escalation: TERMINAL_ESCALATION }), APPLICABLE_SCOPES),
    [],
  )
})

test('a scoped seat is required exactly when its scope is applicable — both directions', () => {
  assert.equal(SCOPED_SEATS.length, 6)
  for (const seat of SCOPED_SEATS) {
    const withoutScope = APPLICABLE_SCOPES.filter((s) => s !== seat.scope)
    // Staffed but out of scope.
    assert.deepEqual(
      codes(rosterProblems(ROSTER, withoutScope)),
      ['seat-out-of-scope'],
      `${seat.key} staffed for an inapplicable scope is not refused`,
    )
    // In scope but unstaffed.
    assert.deepEqual(
      codes(rosterProblems({ ...ROSTER, seats: ROSTER.seats.filter((s) => s.seat !== seat.key) }, APPLICABLE_SCOPES)),
      ['seat-unstaffed'],
      `${seat.key} unstaffed for an applicable scope is not refused`,
    )
  }
})

test('an unstaffed seat, an invented seat and a vacant seat are three different findings', () => {
  assert.deepEqual(
    codes(rosterProblems({ ...ROSTER, seats: ROSTER.seats.filter((s) => s.seat !== 'scribe') }, APPLICABLE_SCOPES)),
    ['seat-unstaffed'],
  )
  assert.deepEqual(
    codes(rosterProblems({ ...ROSTER, seats: [...ROSTER.seats, { seat: 'chief-vibes-officer' }] }, APPLICABLE_SCOPES)),
    ['unknown-seat'],
  )
  assert.deepEqual(codes(rosterProblems(patch('scribe', { occupant: '  ' }), APPLICABLE_SCOPES)), ['seat-unfilled'])
  assert.deepEqual(
    codes(rosterProblems({ ...ROSTER, seats: [...ROSTER.seats, ROSTER.seats[3]] }, APPLICABLE_SCOPES)),
    ['seat-filled-twice'],
  )
})

test('the contact matrix prints the vacancy rather than omitting the row', () => {
  const thin = { ...ROSTER, seats: ROSTER.seats.filter((s) => s.seat !== 'recovery-lead') }
  const matrix = contactMatrix(thin, APPLICABLE_SCOPES)
  assert.equal(matrix.length, COMMAND_SEATS.length)
  const vacancy = matrix.find((r) => r.seat === 'recovery-lead')
  assert.equal(vacancy.occupant, null)
  assert.equal(vacancy.backup, null)
  assert.equal(vacancy.coveredMinutes, 0)
  // And a scope nobody declared drops out of the matrix entirely, because §12.2
  // qualifies those seats "as applicable".
  assert.equal(contactMatrix(ROSTER, []).length, COMMAND_SEATS.length - SCOPED_SEATS.length)
})

// ── EXT-100-003: the six plan levels ──────────────────────────────────────

test("§12.3's six levels are each individually required, and two are checked elsewhere", () => {
  assert.equal(PLAN_LEVELS.length, 6)
  assert.deepEqual(
    PLAN_LEVELS.map((l) => l.key),
    ['strategy', 'integratedPlan', 'runbook', 'contactMatrix', 'communicationsPlan', 'decisionLog'],
  )
  assert.deepEqual(
    PLAN_LEVELS.filter((l) => l.owner !== 'cutover-plan-levels.mjs').map((l) => l.owner),
    ['cutover-runbook.mjs', 'cutover-command-roles.mjs'],
  )
  for (const level of PLAN_LEVELS) {
    const problems = planProblems({ ...PLAN, [level.key]: undefined }, { runbookTasks: TASKS, roster: ROSTER })
    assert.ok(
      problems.some((p) => p.reason === 'level-absent' && p.level === level.key),
      `dropping ${level.key} is not refused`,
    )
  }
  assert.deepEqual(
    levelCoverage(PLAN).filter((l) => !l.maintained),
    [],
  )
})

test("each element §12.3 names in a bullet is individually required", () => {
  for (const element of STRATEGY_ELEMENTS) {
    const problems = planProblems(
      { ...PLAN, strategy: { ...PLAN.strategy, [element.key]: undefined } },
      { runbookTasks: TASKS, roster: ROSTER },
    )
    assert.deepEqual(codes(problems), ['strategy-element-missing'], `strategy.${element.key}`)
    assert.ok(problems[0].detail.includes(element.phrase))
  }
  for (const element of COMMUNICATION_ELEMENTS) {
    const problems = planProblems(
      { ...PLAN, communicationsPlan: [{ ...PLAN.communicationsPlan[0], [element.key]: undefined }, ...PLAN.communicationsPlan.slice(1)] },
      { runbookTasks: TASKS, roster: ROSTER },
    )
    assert.ok(
      problems.some((p) => p.reason === 'communication-element-missing' && p.detail.includes(element.phrase)),
      `communications.${element.key}`,
    )
  }
  for (const element of DECISION_ELEMENTS) {
    const problems = planProblems(
      { ...PLAN, decisionLog: [{ ...PLAN.decisionLog[0], [element.key]: undefined }, PLAN.decisionLog[1]] },
      { runbookTasks: TASKS, roster: ROSTER },
    )
    assert.ok(
      problems.some((p) => p.reason === 'decision-element-missing' && p.detail.includes(element.phrase)),
      `decision.${element.key}`,
    )
  }
  assert.equal(STRATEGY_ELEMENTS.length, 9)
  assert.equal(COMMUNICATION_ELEMENTS.length, 8)
  assert.equal(DECISION_ELEMENTS.length, 7)
})

test('a decision cites a real task, a real accountable seat, and a real staffed one', () => {
  const withDecision = (over) => ({ ...PLAN, decisionLog: [{ ...PLAN.decisionLog[0], ...over }, PLAN.decisionLog[1]] })
  const ctx = { runbookTasks: TASKS, roster: ROSTER }

  assert.deepEqual(codes(planProblems(withDecision({ affectedTasks: ['activation-v2'] }), ctx)), [
    'decision-affects-unknown-task',
  ])
  assert.deepEqual(codes(planProblems(withDecision({ authority: 'scribe' }), ctx)), [
    'decision-authority-not-accountable',
  ])
  // Accountable but nobody is in the seat — a different finding, because one is
  // "that seat cannot take this decision" and the other is "that seat is empty".
  assert.deepEqual(
    codes(
      planProblems(withDecision({ authority: 'incident-commander' }), {
        runbookTasks: TASKS,
        roster: { ...ROSTER, seats: ROSTER.seats.filter((s) => s.seat !== 'incident-commander') },
      }),
    ),
    ['decision-authority-unstaffed'],
  )
  assert.deepEqual(codes(planProblems(withDecision({ options: ['big-bang activation'] }), ctx)), [
    'decision-had-one-option',
  ])
  assert.deepEqual(codes(planProblems(withDecision({ timestamp: '2026-08-14' }), ctx)), [
    'decision-timestamp-not-an-instant',
  ])
})

test('a join that could not run is reported, not skipped', () => {
  assert.deepEqual(codes(planProblems(PLAN, { roster: ROSTER })), ['runbook-not-supplied'])
  assert.deepEqual(codes(planProblems(PLAN, { runbookTasks: TASKS })), ['roster-not-supplied'])
  assert.deepEqual(codes(planProblems(PLAN, {})), ['roster-not-supplied', 'runbook-not-supplied'])
})

test("the integrated plan spans §12.3's preparation-through-hypercare and has an order", () => {
  assert.deepEqual([...PLAN_PHASES], ['PREPARATION', 'BUILD', 'REHEARSAL', 'CUTOVER', 'HYPERCARE'])
  for (const phase of PLAN_PHASES) {
    const problems = planProblems(
      { ...PLAN, integratedPlan: PLAN.integratedPlan.filter((m) => m.phase !== phase) },
      { runbookTasks: TASKS, roster: ROSTER },
    )
    assert.ok(
      problems.some((p) => p.reason === 'phase-uncovered' && p.detail.includes(phase)),
      `a plan with no ${phase} milestone is not refused`,
    )
  }
  assert.deepEqual(
    codes(
      planProblems(
        { ...PLAN, integratedPlan: [...PLAN.integratedPlan, { id: 'later', workstream: 'x', phase: 'HYPERCARE', dependsOn: ['never'] }] },
        { runbookTasks: TASKS, roster: ROSTER },
      ),
    ),
    ['milestone-dependency-unknown'],
  )
  // The cycle finder is the runbook's, reused rather than reimplemented.
  assert.deepEqual(
    codes(
      planProblems(
        {
          ...PLAN,
          integratedPlan: PLAN.integratedPlan.map((m) =>
            m.id === 'readiness-baseline' ? { ...m, dependsOn: ['hypercare-exit'] } : m,
          ),
        },
        { runbookTasks: TASKS, roster: ROSTER },
      ),
    ),
    ['milestone-dependency-cycle'],
  )
})

// ── EXT-100-008: activation and validation ────────────────────────────────

test("§12.7's manifests, changes, checks and absolutes are the activation's vocabulary", () => {
  assert.equal(ACTIVATION_MANIFESTS.length, 7)
  assert.equal(PROGRESSIVE_CHANGES.length, 5)
  assert.equal(VALIDATION_CHECKS.length, 14)
  assert.equal(ISOLATION_ASSERTIONS.length, 2)
  assert.deepEqual([...VERDICTS], ['PASSED', 'FAILED', 'NOT_RUN'])
  assert.deepEqual(
    VALIDATION_CHECKS.map((c) => c.phrase),
    [
      'sign-in',
      'tenant resolution',
      'authorization',
      'seat context',
      'core transactions',
      'audit',
      'memory',
      'files',
      'workflow',
      'notifications',
      'reporting',
      'search/Relay degradation boundaries',
      'integrations',
      'financial effects',
    ],
  )
})

test('each manifest is individually required, exactly versioned, digested and reversible', () => {
  for (const kind of ACTIVATION_MANIFESTS) {
    const dropped = { ...ACTIVATION_COMMAND.manifests }
    delete dropped[kind]
    assert.deepEqual(
      codes(activationCommandProblems({ ...ACTIVATION_COMMAND, manifests: dropped })),
      ['manifest-unbound'],
      `dropping the ${kind} manifest is not refused`,
    )
  }
  const bind = (over) => ({
    ...ACTIVATION_COMMAND,
    manifests: { ...ACTIVATION_COMMAND.manifests, config: { ...ACTIVATION_COMMAND.manifests.config, ...over } },
  })
  for (const version of ['latest', 'main', 'HEAD', '^2.1.0', '2.1.x', '*']) {
    assert.deepEqual(codes(activationCommandProblems(bind({ version }))), ['manifest-version-not-exact'], version)
  }
  assert.deepEqual(codes(activationCommandProblems(bind({ digest: undefined }))), ['manifest-digest-absent'])
  assert.deepEqual(codes(activationCommandProblems(bind({ digest: 'sha256:not-hex' }))), ['manifest-digest-malformed'])
  assert.deepEqual(codes(activationCommandProblems(bind({ rollbackId: undefined }))), ['manifest-rollback-id-absent'])
})

test('activation is idempotent, protected, and approved by somebody who did not run it', () => {
  assert.deepEqual(codes(activationCommandProblems({ ...ACTIVATION_COMMAND, idempotencyKey: undefined })), [
    'not-idempotent',
  ])
  assert.deepEqual(codes(activationCommandProblems({ ...ACTIVATION_COMMAND, protected: false })), ['unprotected'])
  assert.deepEqual(codes(activationCommandProblems({ ...ACTIVATION_COMMAND, approvedBy: undefined })), ['unapproved'])
  assert.deepEqual(
    codes(activationCommandProblems({ ...ACTIVATION_COMMAND, approvedBy: ACTIVATION_COMMAND.executedBy })),
    ['self-approved'],
  )
})

test('progressive where possible means an unexplained flip is refused and an explained one is not', () => {
  for (const kind of PROGRESSIVE_CHANGES) {
    assert.deepEqual(
      codes(progressiveChangeProblems(CHANGES.filter((c) => c.kind !== kind))),
      ['change-unplanned'],
      `omitting the ${kind} change is not refused`,
    )
    assert.deepEqual(
      codes(progressiveChangeProblems(CHANGES.map((c) => (c.kind === kind ? { ...c, observedBy: undefined } : c)))),
      ['not-observable'],
      `${kind} without an observation signal is not refused`,
    )
    assert.deepEqual(
      codes(progressiveChangeProblems(CHANGES.map((c) => (c.kind === kind ? { ...c, reversal: undefined } : c)))),
      ['no-reversal'],
      `${kind} without a reversal is not refused`,
    )
  }
  // The DNS change in the fixture is genuinely not progressive and says why; the
  // rule refuses the absence of a reason, not the flip.
  assert.deepEqual(progressiveChangeProblems(CHANGES), [])
  assert.deepEqual(
    codes(progressiveChangeProblems(CHANGES.map((c) => (c.kind === 'dns' ? { ...c, whyNotProgressive: undefined } : c)))),
    ['not-progressive-and-unexplained'],
  )
})

test('a smoke record is synthetic, in this tenant, and cleaned through an audited workflow', () => {
  assert.deepEqual(smokeProblems(SMOKE_RECORDS, TENANT), [])
  const mutate = (over) => SMOKE_RECORDS.map((r) => (r.id === 'canary-journal' ? { ...r, ...over } : r))

  assert.deepEqual(codes(smokeProblems(mutate({ synthetic: false }), TENANT)), ['not-synthetic'])
  assert.deepEqual(codes(smokeProblems(mutate({ tenant: 'example-other' }), TENANT)), ['wrong-tenant'])
  assert.deepEqual(codes(smokeProblems(mutate({ cleanup: undefined }), TENANT)), ['no-cleanup'])
  assert.deepEqual(codes(smokeProblems(mutate({ cleanup: { audited: true, completed: true } }), TENANT)), [
    'cleanup-not-a-workflow',
  ])
  assert.deepEqual(
    codes(smokeProblems(mutate({ cleanup: { workflow: 'w', audited: false, completed: true } }), TENANT)),
    ['cleanup-unaudited'],
  )
  assert.deepEqual(
    codes(smokeProblems(mutate({ cleanup: { workflow: 'w', audited: true, completed: false } }), TENANT)),
    ['cleanup-incomplete'],
  )
  // "We could not check the tenant" is its own answer.
  assert.deepEqual(codes(smokeProblems(SMOKE_RECORDS, undefined)), ['tenant-unstated'])
})

test('NOT_RUN, FAILED and PASSED are three answers and the module will not collapse them', () => {
  assert.deepEqual(validationProblems(VALIDATION).problems, [])

  for (const check of VALIDATION_CHECKS) {
    const absent = validationProblems(VALIDATION.filter((v) => v.check !== check.key))
    assert.deepEqual(codes(absent.problems), ['check-not-run'], `${check.key} absent`)
    assert.deepEqual([...absent.notRun], [check.key])
    assert.deepEqual([...absent.failed], [])

    const failed = validationProblems(VALIDATION.map((v) => (v.check === check.key ? { ...v, verdict: 'FAILED' } : v)))
    assert.deepEqual(codes(failed.problems), ['check-failed'], `${check.key} failed`)
    assert.deepEqual([...failed.failed], [check.key])
    assert.deepEqual([...failed.notRun], [])
  }

  // PASSED with no evidence is a slide, not a result.
  assert.deepEqual(
    codes(validationProblems(VALIDATION.map((v) => (v.check === 'audit' ? { check: 'audit', verdict: 'PASSED' } : v))).problems),
    ['check-without-evidence'],
  )
  assert.deepEqual(
    codes(validationProblems([...VALIDATION, { check: 'vibes', verdict: 'PASSED', evidence: 'x' }]).problems),
    ['check-unknown'],
  )
})

test("§12.7's two isolation assertions stop the release, and unverified is not clean", () => {
  for (const assertion of ISOLATION_ASSERTIONS) {
    const unverified = validationProblems(VALIDATION.filter((v) => v.check !== assertion.key))
    assert.deepEqual(codes(unverified.problems), ['isolation-unverified'], `${assertion.key} absent`)
    assert.deepEqual([...unverified.stops], [assertion.key])

    const breached = validationProblems(
      VALIDATION.map((v) => (v.check === assertion.key ? { ...v, verdict: 'FAILED' } : v)),
    )
    assert.deepEqual(codes(breached.problems), ['isolation-breached'], `${assertion.key} failed`)
    assert.deepEqual([...breached.stops], [assertion.key])

    // Either one ends the release; neither is weighed against the other twelve.
    for (const validation of [
      VALIDATION.filter((v) => v.check !== assertion.key),
      VALIDATION.map((v) => (v.check === assertion.key ? { ...v, verdict: 'FAILED' } : v)),
    ]) {
      assert.equal(activationVerdict({ ...ACTIVATION, validation }).result, 'STOP')
    }
  }
})

test('every deviation opens an event AND evaluates the rollback threshold', () => {
  assert.deepEqual(deviationProblems(DEVIATIONS), [])
  assert.deepEqual(codes(deviationProblems([{ ...DEVIATIONS[0], commandCenterEvent: undefined }])), [
    'no-command-center-event',
  ])
  assert.deepEqual(codes(deviationProblems([{ ...DEVIATIONS[0], rollbackThreshold: undefined }])), [
    'rollback-threshold-not-evaluated',
  ])
  assert.deepEqual(
    codes(deviationProblems([{ ...DEVIATIONS[0], rollbackThreshold: { decidedBy: 'cutover-commander' } }])),
    ['rollback-threshold-undecided'],
  )
  assert.deepEqual(codes(deviationProblems([{ ...DEVIATIONS[0], rollbackThreshold: { crossed: false } }])), [
    'rollback-threshold-unattributed',
  ])
})

test('the release verdict is derived, and STOP outranks HOLD outranks RELEASE', () => {
  assert.equal(activationVerdict(ACTIVATION).result, 'RELEASE')

  // A crossed rollback threshold goes to the board, not to the release.
  const crossed = activationVerdict({
    ...ACTIVATION,
    deviations: [{ ...DEVIATIONS[0], rollbackThreshold: { crossed: true, decidedBy: 'rollback-authority' } }],
  })
  assert.equal(crossed.result, 'STOP')
  assert.match(crossed.why, /rollback threshold/)

  // §12.7's day-one bullet applies only when risk requires it — and then a
  // scenario nobody executed holds the broad release.
  assert.equal(activationVerdict({ ...ACTIVATION, dayOneScenarios: [] }).result, 'HOLD')
  assert.equal(
    activationVerdict({ ...ACTIVATION, riskRequiresDayOne: false, dayOneScenarios: [] }).result,
    'RELEASE',
  )
  assert.equal(
    activationVerdict({
      ...ACTIVATION,
      dayOneScenarios: [{ id: 'day-one-payroll-preview', executedBy: 'business-process-owner', result: 'FAILED' }],
    }).result,
    'HOLD',
  )

  // An ordinary finding holds; it does not stop.
  const held = activationVerdict({ ...ACTIVATION, command: { ...ACTIVATION_COMMAND, idempotencyKey: undefined } })
  assert.equal(held.result, 'HOLD')
  assert.deepEqual(codes(held.problems), ['not-idempotent'])
})
