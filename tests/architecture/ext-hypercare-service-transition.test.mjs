/**
 * EXT-110-005 / -006 / -007 / -010 — the hypercare rules of §13.
 *
 * Authority: `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md`
 * §13.4 (emergency change, configuration fixes, correction packages,
 * workarounds), §13.5 (exit and transition criteria), and §12.2's seat facts
 * where an outage moves a seat.
 *
 * The worked hypercare this asserts over is declared once, in
 * `tools/hypercare-service-transition.mjs`, and read twice — by that generator,
 * which writes `docs/architecture/hypercare-service-transition.md`, and by this
 * file. A worked example that lives only in a document is a claim; one a test
 * re-runs is evidence.
 *
 * Two kinds of assertion, and the second is the one that would catch a rule that
 * had quietly stopped refusing anything:
 *
 *   · the valid hypercare produces ZERO findings from all four modules;
 *   · each refusal scenario produces EXACTLY the code it is about and no other.
 *     `deepEqual` on the code set rather than `ok(problems.length > 0)`, because
 *     "something refused it" is satisfied by a rule firing for the wrong reason.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

import {
  CORRECTION_FACTS,
  EMERGENCY_STEPS,
  STEP_DISPOSITIONS,
  configurationFixProblems,
  dataFixProblems,
  directEditPosture,
  emergencyChangeProblems,
} from '../../packages/provisioning/src/hypercare-change-control.mjs'
import {
  EXIT_CRITERIA,
  HANDOVER_ITEMS,
  VERDICTS,
  exitReadiness,
  exitVerdict,
} from '../../packages/provisioning/src/hypercare-exit.mjs'
import {
  coverageUnderOutage,
  handoffCoverageProblems,
  handoffDrill,
  seatHolder,
} from '../../packages/provisioning/src/hypercare-standby.mjs'
import {
  NO_PERMANENT_FIX,
  RISK_LEVELS,
  WORKAROUND_FACTS,
  WORKAROUND_STATES,
  registerProblems,
  stateOf,
  workaroundAges,
  workaroundProblems,
} from '../../packages/provisioning/src/hypercare-workarounds.mjs'
import {
  CONFIG_FIXES,
  DATA_FIXES,
  EMERGENCY_CHANGE,
  EXIT_FACTS,
  NOW,
  OUTAGES,
  REFUSALS,
  ROSTER,
  WORKAROUNDS,
} from '../../tools/hypercare-service-transition.mjs'

const codes = (rows) =>
  [...new Set(rows.map((p) => p.reason ?? (p.criterion ? `${p.criterion}:${p.verdict}` : p.verdict)))].sort()

const without = (object, key) => {
  const copy = { ...object }
  delete copy[key]
  return copy
}

// ── the generated document ────────────────────────────────────────────────

test('the committed hypercare-service-transition document is not stale', () => {
  const out = execFileSync('node', ['tools/hypercare-service-transition.mjs', '--check'], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.match(out, /up to date/)
})

// ── the valid hypercare ───────────────────────────────────────────────────

test('the worked hypercare satisfies all four §13 rule sets', () => {
  assert.deepEqual(registerProblems(WORKAROUNDS, NOW), [])
  assert.deepEqual(emergencyChangeProblems(EMERGENCY_CHANGE), [])
  assert.deepEqual(CONFIG_FIXES.flatMap(configurationFixProblems), [])
  assert.deepEqual(DATA_FIXES.flatMap(dataFixProblems), [])
  assert.equal(exitVerdict(EXIT_FACTS, NOW).result, 'EXIT')
  assert.deepEqual(handoffDrill(ROSTER, OUTAGES).findings, [])
})

// ── EXT-110-006: the workaround lifecycle ─────────────────────────────────

test('§13.4\'s seven workaround facts are each required, one at a time', () => {
  assert.equal(WORKAROUND_FACTS.length, 7)
  const base = WORKAROUNDS.find((w) => w.id === 'WA-01')

  // The absence of each fact, in isolation. Seven mutations, seven refusals —
  // and each asserted to be `fact-missing` for THAT field, so a rule that
  // refused for some other reason would not be counted as this one working.
  for (const fact of WORKAROUND_FACTS) {
    const problems = workaroundProblems(without(base, fact.key), NOW)
    const mine = problems.filter((p) => p.field === fact.key)
    assert.equal(
      mine.length >= 1,
      true,
      `removing ${fact.key} produced no finding against that field: ${JSON.stringify(problems)}`,
    )
    assert.equal(mine[0].reason, 'fact-missing', `${fact.key} → ${mine[0].reason}`)
  }

  // And the whole record is clean when nothing is removed.
  assert.deepEqual(workaroundProblems(base, NOW), [])
})

test('a workaround moves through its lifecycle on the clock, not on a flag', () => {
  const w = WORKAROUNDS.find((x) => x.id === 'WA-01')
  assert.equal(w.expiry, '2026-11-30T00:00:00Z')

  // Same record, three different evaluation times. Nothing about the record
  // changes; the state does. That is the point of deriving it.
  assert.equal(stateOf(w, '2026-09-19T00:00:00Z').state, 'ACTIVE')
  assert.equal(stateOf(w, '2026-11-29T23:59:00Z').state, 'ACTIVE')
  assert.equal(stateOf(w, '2026-11-30T00:00:01Z').state, 'EXPIRED')

  // The age is arithmetic on the two instants the record and the caller supply,
  // not a number anybody stores.
  assert.equal(stateOf(w, '2026-09-30T00:00:00Z').ageDays, 10)
  assert.equal(stateOf(w, '2026-10-20T00:00:00Z').ageDays, 30)

  // An expired workaround cannot be reported ACTIVE by anybody setting a field.
  assert.equal(stateOf({ ...w, status: 'ACTIVE' }, '2026-12-01T00:00:00Z').state, 'EXPIRED')

  assert.deepEqual([...WORKAROUND_STATES].sort(), [
    'ACTIVE',
    'EXPIRED',
    'PROPOSED',
    'SUPERSEDED',
    'WITHDRAWN',
  ])
})

test('a workaround accepted as the process states the decision, and an unrated risk is refused', () => {
  const w = WORKAROUNDS.find((x) => x.id === 'WA-03')
  assert.equal(w.permanentFix, NO_PERMANENT_FIX)
  assert.deepEqual(workaroundProblems(w, NOW), [])
  assert.deepEqual(codes(workaroundProblems(without(w, 'permanentFixDecision'), NOW)), [
    'accepted-without-decision',
  ])

  // Risk stated as prose passes "is it filled in" and fails "can anybody sort,
  // threshold or accept it".
  assert.deepEqual(RISK_LEVELS, ['LOW', 'MEDIUM', 'HIGH'])
  assert.deepEqual(codes(workaroundProblems({ ...w, risk: 'quite low really' }, NOW)), ['unrated-risk'])
})

test('the workaround age metric separates what it could not place from what it counted', () => {
  const ages = workaroundAges(WORKAROUNDS, NOW)
  assert.equal(ages.total, 5)
  assert.equal(ages.byState.ACTIVE, 3)
  assert.equal(ages.byState.SUPERSEDED, 1)
  assert.equal(ages.byState.PROPOSED, 1)
  assert.equal(ages.unplaceable, 0)
  assert.equal(ages.openCount, 3)

  // A record with an unreadable expiry is carried out separately rather than
  // dropped: an average computed over the rows that happened to have a clock
  // gets prettier as the register gets worse.
  const broken = workaroundAges(
    WORKAROUNDS.map((w) => (w.id === 'WA-01' ? { ...w, expiry: 'next quarter' } : w)),
    NOW,
  )
  assert.equal(broken.unplaceable, 1)
  assert.equal(broken.openCount, 2)
  assert.equal(broken.total, 5)
})

// ── EXT-110-005: change control ───────────────────────────────────────────

test('each of §13.4\'s six emergency steps is refused when skipped, one at a time', () => {
  assert.equal(EMERGENCY_STEPS.length, 6)
  assert.deepEqual(STEP_DISPOSITIONS, ['FULL', 'COMPRESSED', 'SKIPPED'])

  for (const step of EMERGENCY_STEPS) {
    const skipped = emergencyChangeProblems({
      ...EMERGENCY_CHANGE,
      steps: { ...EMERGENCY_CHANGE.steps, [step.key]: { disposition: 'SKIPPED', detail: 'no time' } },
    })
    assert.deepEqual(codes(skipped), ['step-skipped'], `skipping ${step.key}`)
    assert.equal(skipped[0].step, step.key)

    const absent = emergencyChangeProblems({
      ...EMERGENCY_CHANGE,
      steps: without(EMERGENCY_CHANGE.steps, step.key),
    })
    assert.deepEqual(codes(absent), ['step-absent'], `omitting ${step.key}`)
  }
})

test('COMPRESSED is allowed and unrecorded compression is not', () => {
  // The whole tension of "expedited but complete" in two assertions: the same
  // change passes with the shortcut named and fails without it.
  assert.deepEqual(emergencyChangeProblems(EMERGENCY_CHANGE), [])
  assert.deepEqual(
    codes(
      emergencyChangeProblems({
        ...EMERGENCY_CHANGE,
        steps: {
          ...EMERGENCY_CHANGE.steps,
          approval: without(EMERGENCY_CHANGE.steps.approval, 'shortcut'),
        },
      }),
    ),
    ['compression-unstated'],
  )
})

test('Relay may not execute or approve a protected fix', () => {
  // §13.4's own sentence, tested against the spellings nobody writes in a
  // roster they intend to sneak past a review.
  for (const actor of ['Relay', 'Relay Copilot', 'relay-agent', 'AI assistant', 'autonomous agent']) {
    assert.deepEqual(
      codes(emergencyChangeProblems({ ...EMERGENCY_CHANGE, executor: actor })),
      ['relay-executed-fix'],
      actor,
    )
    assert.deepEqual(
      codes(emergencyChangeProblems({ ...EMERGENCY_CHANGE, approver: actor })),
      ['relay-approved-fix'],
      actor,
    )
  }
  // A human whose name merely contains the letters is not Relay.
  assert.deepEqual(emergencyChangeProblems({ ...EMERGENCY_CHANGE, executor: 'relayton-lead' }), [])
})

test('"direct production editing does not become normal" is measured, not asserted', () => {
  const posture = directEditPosture(CONFIG_FIXES)
  assert.equal(posture.total, 3)
  assert.equal(posture.directEdits, 1)
  assert.deepEqual(posture.ungoverned, [])

  // The measurement that matters: an ungoverned bypass is named.
  const loose = directEditPosture(
    CONFIG_FIXES.map((f) => (f.id === 'CF-13' ? without(f, 'authorisedBy') : f)),
  )
  assert.deepEqual(loose.ungoverned, ['CF-13'])

  // An empty register is not a posture of zero, and says so.
  assert.equal(directEditPosture([]).share, null)
  assert.match(directEditPosture([]).why, /not a posture of zero/)
})

test('each of the eight correction-package facts is required, one at a time', () => {
  assert.equal(CORRECTION_FACTS.length, 8)
  const pkg = DATA_FIXES.find((f) => f.id === 'DF-22')
  assert.deepEqual(dataFixProblems(pkg), [])

  for (const fact of CORRECTION_FACTS) {
    const problems = dataFixProblems(without(pkg, fact.key))
    assert.deepEqual(codes(problems), ['correction-fact-missing'], `removing ${fact.key}`)
    assert.equal(problems[0].field, fact.key)
  }

  // The route decides what is required, and is stated rather than guessed at
  // from which fields happen to be present.
  assert.deepEqual(codes(dataFixProblems({ ...pkg, route: 'DIRECT_SQL' })), ['unrouted-data-fix'])
  assert.deepEqual(dataFixProblems({ id: 'DF-99', route: 'DOMAIN_COMMAND', command: 'finance.reversePosting' }), [])
  assert.deepEqual(codes(dataFixProblems({ id: 'DF-99', route: 'DOMAIN_COMMAND' })), ['unnamed-command'])
})

// ── EXT-110-007: exit criteria ────────────────────────────────────────────

test('§13.5 is a conjunction: each of the seven criteria alone holds the exit', () => {
  assert.equal(EXIT_CRITERIA.length, 7)
  assert.deepEqual(VERDICTS, ['SATISFIED', 'BLOCKED', 'UNKNOWN'])
  assert.equal(exitVerdict(EXIT_FACTS, NOW).result, 'EXIT')

  // Remove each criterion's facts, one at a time. Every one of the seven must
  // move the verdict to HOLD by itself — a criterion that cannot block the exit
  // is a criterion that is not in the conjunction.
  for (const criterion of EXIT_CRITERIA) {
    const verdict = exitVerdict(without(EXIT_FACTS, criterion.key), NOW)
    assert.equal(verdict.result, 'HOLD', `${criterion.key} did not hold the exit`)
    assert.equal(
      [...verdict.blocked, ...verdict.unknown].includes(criterion.key),
      true,
      `${criterion.key} was not named as the reason`,
    )
    // And the result always carries all seven rows: six entries would read as
    // six criteria existing.
    assert.equal(verdict.readiness.length, 7)
  }
})

test('UNKNOWN blocks the exit and is reported apart from BLOCKED', () => {
  // "The reconciliations all passed" and "nobody said whether they ran" are
  // different answers, and only one of them is a bad number.
  const unknown = exitVerdict(without(EXIT_FACTS, 'thresholds'), NOW)
  assert.deepEqual(unknown.unknown, ['thresholds'])
  assert.deepEqual(unknown.blocked, [])
  assert.equal(unknown.result, 'HOLD')

  const blocked = exitVerdict(
    {
      ...EXIT_FACTS,
      thresholds: EXIT_FACTS.thresholds.map((t) =>
        t.dimension === 'cost' ? { ...t, withinThreshold: false } : t,
      ),
    },
    NOW,
  )
  assert.deepEqual(blocked.blocked, ['thresholds'])
  assert.deepEqual(blocked.unknown, [])
})

test('all eleven §13.5 handover items need a named accepting owner, one at a time', () => {
  assert.equal(HANDOVER_ITEMS.length, 11)
  for (const item of HANDOVER_ITEMS) {
    const readiness = exitReadiness(
      { ...EXIT_FACTS, handover: { ...EXIT_FACTS.handover, [item]: {} } },
      NOW,
    )
    const row = readiness.find((r) => r.criterion === 'handover')
    assert.equal(row.verdict, 'BLOCKED', `${item} was accepted with nobody on the receiving end`)
    assert.match(row.detail, new RegExp(item))
  }
})

test('the exit reads the EXT-110-006 register rather than re-checking workarounds', () => {
  // Reuse proven by consequence: breaking a workaround in the register moves the
  // exit's workaround criterion, which can only happen if the criterion is
  // reading that module.
  const readiness = exitReadiness(
    {
      ...EXIT_FACTS,
      workarounds: WORKAROUNDS.map((w) => (w.id === 'WA-01' ? without(w, 'owner') : w)),
    },
    NOW,
  )
  const row = readiness.find((r) => r.criterion === 'workarounds')
  assert.equal(row.verdict, 'BLOCKED')
  assert.match(row.detail, /fact-missing/)

  // And §13.5's own addition on top of §13.4: a HIGH-risk workaround still
  // active at the exit needs somebody named as accepting the risk.
  const high = exitReadiness(
    {
      ...EXIT_FACTS,
      workarounds: WORKAROUNDS.map((w) =>
        w.id === 'WA-01' ? without({ ...w, risk: 'HIGH' }, 'riskAcceptedBy') : w,
      ),
    },
    NOW,
  ).find((r) => r.criterion === 'workarounds')
  assert.equal(high.verdict, 'BLOCKED')
  assert.match(high.detail, /WA-01/)
})

// ── EXT-110-010: the outage ───────────────────────────────────────────────

test('a seat is held by occupant, backup, rota, then escalation — in that order', () => {
  const at = '10:00'
  assert.equal(seatHolder(ROSTER, 'identity-lead', { atUtc: at }).route, 'OCCUPANT')
  assert.equal(
    seatHolder(ROSTER, 'identity-lead', { atUtc: at, unavailable: ['identity-lead-primary'] }).route,
    'BACKUP',
  )
  const rota = seatHolder(ROSTER, 'identity-lead', {
    atUtc: at,
    unavailable: ['identity-lead-primary', 'identity-lead-deputy'],
  })
  assert.equal(rota.route, 'ROTA')
  assert.equal(rota.holder, 'emea-oncall')

  const escalated = seatHolder(ROSTER, 'identity-lead', {
    atUtc: at,
    unavailable: ['identity-lead-primary', 'identity-lead-deputy', 'emea-oncall'],
  })
  assert.equal(escalated.route, 'ESCALATION')
  assert.equal(escalated.via, 'incident-commander')

  // The hour decides which rota window answers, which is the whole reason the
  // resolver takes a time. At 03:00 the same outage lands on APAC.
  const night = seatHolder(ROSTER, 'identity-lead', {
    atUtc: '03:00',
    unavailable: ['identity-lead-primary', 'identity-lead-deputy'],
  })
  assert.equal(night.holder, 'apac-oncall')
})

test('unavailability is by person, so one person cannot answer for three seats', () => {
  // The failure the module exists over: a rota where the same name is the
  // backup for several seats reads as fully covered and collapses together.
  const shared = {
    ...ROSTER,
    seats: ROSTER.seats.map((s) => ({ ...s, backup: 'one-deputy-for-everything' })),
  }
  const out = ['identity-lead-primary', 'integration-lead-primary', 'one-deputy-for-everything']

  for (const seat of ['identity-lead', 'integration-lead']) {
    const held = seatHolder(shared, seat, { atUtc: '10:00', unavailable: out })
    assert.notEqual(held.holder, 'one-deputy-for-everything')
    assert.equal(held.route, 'ROTA')
  }
})

test('the drill resolves every seat for every outage and finds nobody unheld', () => {
  const drill = handoffDrill(ROSTER, OUTAGES)
  // 7 seats x 4 outages. A roster where six seats have cover and the seventh
  // does not passes any sampling and fails this.
  assert.equal(drill.results.length, ROSTER.seats.length * OUTAGES.length)
  assert.deepEqual(drill.findings, [])
  assert.equal(drill.results.every((r) => r.holder !== null), true)

  // No resolution ever hands a seat back to somebody the scenario declared
  // unreachable.
  for (const outage of OUTAGES) {
    const rows = drill.results.filter((r) => r.scenario === outage.id)
    for (const row of rows) assert.equal(outage.unavailable.includes(row.holder), false)
  }
})

test('an outage nobody can cover is refused by name rather than resolved to nobody', () => {
  const everyone = [
    'identity-lead-primary',
    'identity-lead-deputy',
    'emea-oncall',
    'incident-commander-primary',
    'incident-commander-deputy',
    'cutover-commander-primary',
    'cutover-commander-deputy',
    'executive-sponsor-primary',
    'executive-sponsor-deputy',
  ]
  const held = seatHolder(ROSTER, 'identity-lead', { atUtc: '10:00', unavailable: everyone })
  assert.equal(held.holder, null)
  assert.equal(held.reason, 'no-stand-in')

  // An unreadable clock is not a covered hour.
  assert.equal(seatHolder(ROSTER, 'identity-lead', {}).reason, 'no-evaluation-time')
  assert.equal(seatHolder(ROSTER, 'nobody-seat', { atUtc: '10:00' }).reason, 'unknown-seat')
})

test('coverage and resilience are different numbers', () => {
  const seat = ROSTER.seats.find((s) => s.seat === 'identity-lead')
  const lost = coverageUnderOutage(seat, ['emea-oncall'])
  // A rota with no gaps and one person per window has 24 hours of coverage and
  // zero hours of resilience: 480 minutes is exactly the 08:00–16:00 window.
  assert.equal(lost.coveredMinutesBefore, 1440)
  assert.equal(lost.coveredMinutesAfter, 960)
  assert.equal(lost.lostMinutes, 480)
  assert.deepEqual(
    lost.gapsAfter.map((g) => `${g.from}-${g.to}`),
    ['08:00-16:00'],
  )
})

test('a seat that changes hands must carry the handoff and the contact channel', () => {
  const drill = handoffDrill(ROSTER, [OUTAGES[0]])
  assert.deepEqual(
    codes(handoffCoverageProblems(ROSTER, drill)),
    [],
    'the complete roster produces no handoff findings for a backup pickup',
  )

  const noHandoff = {
    ...ROSTER,
    seats: ROSTER.seats.map((s) => (s.seat === 'identity-lead' ? without(s, 'handoff') : s)),
  }
  const problems = handoffCoverageProblems(noHandoff, handoffDrill(noHandoff, [OUTAGES[0]]))
  assert.deepEqual(codes(problems.filter((p) => p.seat === 'identity-lead')), ['handoff-undocumented'])

  // An escalation that answers is a pass and is still reported: the seat had no
  // local cover, and an escalation nobody notices becomes the rota.
  const escalated = handoffCoverageProblems(ROSTER, handoffDrill(ROSTER, [OUTAGES[2]]))
  assert.deepEqual(codes(escalated), ['held-by-escalation'])
})

// ── every refusal scenario, re-run ────────────────────────────────────────

test('every refusal scenario produces exactly the code it is about', () => {
  const expected = {
    'workaround-without-expiry': ['fact-missing'],
    'workaround-expired': ['expired-and-still-listed'],
    'workaround-accepted-without-decision': ['accepted-without-decision'],
    'workaround-superseded-by-nothing': ['superseded-by-nothing'],
    'emergency-step-skipped': ['step-skipped'],
    'emergency-compression-unstated': ['compression-unstated'],
    'emergency-self-approved': ['self-approved-change'],
    'relay-executed-fix': ['relay-executed-fix'],
    'direct-edit-not-backfilled': ['direct-edit-not-backfilled'],
    'correction-package-incomplete': ['correction-fact-missing'],
    'data-fix-unrouted': ['unrouted-data-fix'],
    'exit-with-open-s1': ['defects:BLOCKED'],
    'exit-with-unaccepted-s2': ['defects:BLOCKED'],
    'exit-with-unmeasured-threshold': ['thresholds:UNKNOWN'],
    'exit-with-short-observation': ['thresholds:BLOCKED'],
    'exit-with-unowned-handover': ['handover:BLOCKED'],
    'exit-with-one-signature': ['signoff:BLOCKED'],
    'no-stand-in': ['no-stand-in'],
    'escalation-cycle-under-outage': ['escalation-cycle'],
    'handoff-undocumented': ['handoff-undocumented'],
  }

  assert.equal(REFUSALS.length, Object.keys(expected).length)
  for (const refusal of REFUSALS) {
    assert.deepEqual(
      codes(refusal.run()),
      expected[refusal.id].slice().sort(),
      `${refusal.id} (${refusal.requirement})`,
    )
  }
})
