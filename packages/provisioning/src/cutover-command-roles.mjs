/**
 * EXT-100-002 — the cutover command roster, by durable seat.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §12.2
 * lists the seats and then, in one closing sentence, the seven facts each one
 * must carry: "Authority, handoff, time-zone coverage, contact channel, backup,
 * escalation, and decision rights are explicit." It adds one absolute: "Relay is
 * never assigned an accountable command role."
 *
 * The word this module is built around is **seat**. A roster of people is a
 * roster that goes stale the first time somebody changes job; a roster of seats
 * with occupants is one where the vacancy is visible. So `COMMAND_SEATS` is the
 * document's list, frozen, and a roster is checked against it rather than a
 * roster being allowed to define its own shape. A seat nobody filled is
 * `seat-unfilled` — a finding, not an absent row.
 *
 * Three refusals here are the ones that make it worth running:
 *
 *   · `relay-accountable` — §12.2's prohibition, enforced on the occupant of an
 *     accountable seat rather than on a checkbox somebody sets. Relay may be a
 *     named participant; it may not be the authority.
 *   · `coverage-gap` — time-zone coverage is arithmetic, not a promise. Windows
 *     that do not tile the command window leave an hour with nobody in the seat,
 *     and every roster ever written claims "24x7" in prose.
 *   · `escalation-cycle` — an escalation path that loops is a path with no
 *     terminal authority, and at 03:00 it reads as an escalation.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * Same reason as `cutover-runbook.mjs` and `connection-cardinality.mjs`: Node 20
 * (which CI pins) cannot load TS, and both readers — `node --test` and the doc
 * generator under `tools/` — run there.
 */

/**
 * §12.2's seats, in the document's order.
 *
 * `accountable` marks the seats that hold authority over an irreversible
 * decision — go-live, command, rollback, and the recording of both. §12.2's
 * Relay prohibition is written against exactly this notion ("an accountable
 * command role"), so it has to be a property of the seat rather than a judgement
 * made per roster.
 *
 * `scope` marks the seats §12.2 qualifies with "as applicable": a cutover with
 * no bank channel has no banking lead, and requiring one would make the roster
 * lie in the other direction. A scoped seat is required exactly when the program
 * declares that scope applicable, which is why `rosterProblems` takes the
 * applicable scopes as an argument instead of guessing them.
 */
export const COMMAND_SEATS = Object.freeze([
  Object.freeze({ key: "executive-sponsor", title: "Executive sponsor / go-live authority", accountable: true }),
  Object.freeze({ key: "cutover-commander", title: "Cutover commander", accountable: true }),
  Object.freeze({ key: "cutover-deputy", title: "Deputy cutover commander", accountable: true }),
  Object.freeze({ key: "technical-release-lead", title: "Technical release lead", accountable: false }),
  Object.freeze({ key: "data-conversion-lead", title: "Data conversion lead", accountable: false }),
  Object.freeze({ key: "domain-reconciliation-owner", title: "Domain reconciliation owner", accountable: false }),
  Object.freeze({ key: "business-process-owner", title: "Business process / domain owner", accountable: false }),
  Object.freeze({ key: "identity-lead", title: "Identity lead", accountable: false }),
  Object.freeze({ key: "security-lead", title: "Security lead", accountable: false }),
  Object.freeze({ key: "privacy-lead", title: "Privacy lead", accountable: false }),
  Object.freeze({ key: "integration-lead", title: "Integration lead", accountable: false, scope: "integration" }),
  Object.freeze({ key: "payroll-provider-lead", title: "Payroll-provider lead", accountable: false, scope: "payroll" }),
  Object.freeze({ key: "banking-lead", title: "Banking lead", accountable: false, scope: "banking" }),
  Object.freeze({ key: "finance-lead", title: "Finance lead", accountable: false, scope: "finance" }),
  Object.freeze({ key: "relay-search-lead", title: "Relay / search lead", accountable: false, scope: "relay" }),
  Object.freeze({ key: "infrastructure-lead", title: "Infrastructure lead", accountable: false, scope: "infrastructure" }),
  Object.freeze({ key: "test-validation-lead", title: "Test / validation lead", accountable: false }),
  Object.freeze({ key: "communications-support-lead", title: "Communications / customer support lead", accountable: false }),
  Object.freeze({ key: "incident-commander", title: "Incident commander", accountable: true }),
  Object.freeze({ key: "scribe", title: "Scribe / timeline keeper", accountable: false }),
  Object.freeze({ key: "decision-recorder", title: "Decision recorder", accountable: true }),
  Object.freeze({ key: "rollback-authority", title: "Rollback authority", accountable: true }),
  Object.freeze({ key: "recovery-lead", title: "Recovery lead", accountable: false }),
])

/**
 * §12.2's closing sentence, one entry per fact, with the document's own word.
 *
 * `phrase` exists so this list can be checked against §12.2 by a reader rather
 * than trusted, exactly as `REQUIRED_TASK_BINDINGS` does for §12.3.
 */
export const REQUIRED_SEAT_FACTS = Object.freeze([
  Object.freeze({ key: "authority", phrase: "authority" }),
  Object.freeze({ key: "handoff", phrase: "handoff" }),
  Object.freeze({ key: "coverage", phrase: "time-zone coverage" }),
  Object.freeze({ key: "contact", phrase: "contact channel" }),
  Object.freeze({ key: "backup", phrase: "backup" }),
  Object.freeze({ key: "escalation", phrase: "escalation" }),
  Object.freeze({ key: "decisionRights", phrase: "decision rights" }),
])

/** The scopes §12.2's "as applicable" seats hang off, derived rather than restated. */
export const SCOPED_SEATS = Object.freeze(COMMAND_SEATS.filter((s) => s.scope !== undefined))

/**
 * Occupant names that are Relay wearing a person's clothes.
 *
 * §12.2 prohibits assigning Relay an accountable command role. The prohibition
 * is only worth anything if it survives the obvious spellings, because nobody
 * writes `occupant: "Relay"` in the roster they intend to sneak past a review —
 * they write "Relay Copilot", "relay-agent", or "AI assistant".
 */
const RELAY_OCCUPANT = /(^|[^a-z])(relay|copilot|ai[- ]?(assistant|agent)|autonomous[- ]?agent)([^a-z]|$)/i

/**
 * The escalation value that means "there is nobody above this seat".
 *
 * §12.2 requires escalation to be *explicit*, and the top of the tree has the
 * only escalation that cannot name another seat. Leaving the field empty would
 * make the terminal authority indistinguishable from a seat whose escalation
 * nobody decided — which is exactly the collapse `seat-fact-missing` exists to
 * prevent — so the terminal authority states it.
 */
export const TERMINAL_ESCALATION = "TERMINAL"

const named = (value) => typeof value === "string" && value.trim().length > 0

/** Minutes since 00:00 for `HH:MM`, or null if it is not one. */
function minutesOfDay(value) {
  if (!named(value)) return null
  const m = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * The hours of a 24-hour command day that a seat's coverage windows do not cover.
 *
 * Coverage is stated as UTC windows so that "time-zone coverage" is a fact and
 * not a claim about where somebody lives; a window may wrap midnight
 * (`22:00`→`06:00`), which is the normal shape of a follow-the-sun rota and the
 * case a naive `from < to` check silently drops.
 *
 * Returns `{ gaps, malformed, covered }`. `malformed` is separate from `gaps` on
 * purpose: a window nobody can parse is "we could not look", and reporting it as
 * an uncovered hour would be "we looked and found nobody" — different answers.
 */
export function coverageGaps(windows) {
  const minutes = new Uint8Array(24 * 60)
  const malformed = []

  for (const window of Array.isArray(windows) ? windows : []) {
    const from = minutesOfDay(window?.from)
    const to = minutesOfDay(window?.to)
    if (from === null || to === null || !named(window?.occupant)) {
      malformed.push(Object.freeze({ ...window }))
      continue
    }
    if (from === to) {
      // A zero-length window is not a rota entry; a full day is written 00:00→24:00
      // and rejected by the parser, so this is unambiguous.
      malformed.push(Object.freeze({ ...window }))
      continue
    }
    if (from < to) {
      minutes.fill(1, from, to)
    } else {
      minutes.fill(1, from, 24 * 60)
      minutes.fill(1, 0, to)
    }
  }

  const gaps = []
  let start = null
  for (let i = 0; i < 24 * 60; i += 1) {
    if (minutes[i] === 0 && start === null) start = i
    if (minutes[i] === 1 && start !== null) {
      gaps.push(Object.freeze({ from: hhmm(start), to: hhmm(i) }))
      start = null
    }
  }
  // A gap that runs to the end of the day is written `…–24:00`, which `hhmm`
  // cannot produce (it tops out at 23:59) and `minutesOfDay` deliberately will
  // not parse. Closing it here rather than by iterating one minute past the end
  // is what stops a fully covered day reporting a zero-length `24:00–24:00` gap.
  if (start !== null) gaps.push(Object.freeze({ from: hhmm(start), to: "24:00" }))

  let covered = 0
  for (let i = 0; i < 24 * 60; i += 1) covered += minutes[i]

  return Object.freeze({
    gaps: Object.freeze(gaps),
    malformed: Object.freeze(malformed),
    coveredMinutes: covered,
  })
}

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`

/**
 * The escalation path out of one seat, and why it ends.
 *
 * Returns `{ chain, terminal, reason }`. `terminal` is the seat the path ends
 * at; `reason` is `authority` when that seat escalates to nothing (the top of
 * the tree), `unknown-seat` when it escalates to something not in the roster, or
 * `cycle` when the path returns to a seat already on it.
 */
export function escalationChain(roster, seatKey) {
  const bySeat = new Map(
    (Array.isArray(roster?.seats) ? roster.seats : [])
      .filter((s) => named(s?.seat))
      .map((s) => [s.seat.trim(), s]),
  )
  const chain = []
  const seen = new Set()
  let current = named(seatKey) ? seatKey.trim() : ""

  while (true) {
    if (!bySeat.has(current)) {
      return Object.freeze({ chain: Object.freeze(chain), terminal: current, reason: "unknown-seat" })
    }
    if (seen.has(current)) {
      return Object.freeze({ chain: Object.freeze(chain), terminal: current, reason: "cycle" })
    }
    seen.add(current)
    chain.push(current)
    const next = bySeat.get(current).escalation
    if (!named(next) || next.trim() === TERMINAL_ESCALATION) {
      return Object.freeze({ chain: Object.freeze(chain), terminal: current, reason: "authority" })
    }
    current = next.trim()
  }
}

/**
 * Every way a roster fails §12.2, in a stable order.
 *
 * `applicableScopes` is what the program has declared in scope for this cutover.
 * It is required rather than defaulted: defaulting it to "all" would demand a
 * banking lead from a tenant with no bank channel, and defaulting it to "none"
 * would let a cutover that moves payroll run without a payroll-provider lead.
 * Neither default is safe, so the caller states it.
 */
export function rosterProblems(roster, applicableScopes = []) {
  const problems = []
  const bad = (seat, reason, detail) => problems.push(Object.freeze({ seat, reason, detail }))

  const scopes = new Set((Array.isArray(applicableScopes) ? applicableScopes : []).map(String))
  const entries = Array.isArray(roster?.seats) ? roster.seats : []

  const required = COMMAND_SEATS.filter((s) => s.scope === undefined || scopes.has(s.scope))
  const known = new Map(COMMAND_SEATS.map((s) => [s.key, s]))
  const filled = new Map()

  for (const entry of entries) {
    const key = named(entry?.seat) ? entry.seat.trim() : null
    if (!key) {
      bad("(unnamed)", "unidentified-seat", "A roster row with no seat cannot be filled, escalated to, or reported vacant.")
      continue
    }
    if (!known.has(key)) {
      bad(
        key,
        "unknown-seat",
        `"${key}" is not one of §12.2's ${COMMAND_SEATS.length} seats. A seat invented in the ` +
          `roster carries authority nobody granted it.`,
      )
      continue
    }
    if (filled.has(key)) {
      bad(key, "seat-filled-twice", `"${key}" appears twice. A durable seat has one occupant and one backup; two rows means the handoff is ambiguous.`)
      continue
    }
    filled.set(key, entry)

    const seat = known.get(key)
    if (seat.scope !== undefined && !scopes.has(seat.scope)) {
      bad(
        key,
        "seat-out-of-scope",
        `"${key}" is staffed but "${seat.scope}" is not a declared scope of this cutover. §12.2 ` +
          `qualifies these seats "as applicable"; a seat filled for work nobody is doing puts a ` +
          `name against a decision that will never be taken.`,
      )
    }

    if (!named(entry.occupant)) {
      bad(key, "seat-unfilled", `"${seat.title}" has no named occupant. §12.2 requires "named people occupying durable seats".`)
    }

    for (const fact of REQUIRED_SEAT_FACTS) {
      const value = entry[fact.key]
      const present =
        fact.key === "coverage" || fact.key === "decisionRights"
          ? Array.isArray(value) && value.length > 0
          : named(value)
      if (!present) {
        bad(
          key,
          "seat-fact-missing",
          `"${seat.title}" declares no ${fact.phrase}. §12.2 requires all ` +
            `${REQUIRED_SEAT_FACTS.length} to be explicit; this one is absent, so at T0 it is ` +
            `settled by whoever answers first.`,
        )
      }
    }

    if (named(entry.occupant) && named(entry.backup) && entry.occupant.trim() === entry.backup.trim()) {
      bad(
        key,
        "backup-is-occupant",
        `"${seat.title}" names ${entry.occupant} as their own backup. §12.2 requires a backup ` +
          `because the occupant may be unreachable; naming the same person records the ` +
          `requirement without meeting it.`,
      )
    }

    if (seat.accountable && named(entry.occupant) && RELAY_OCCUPANT.test(entry.occupant)) {
      bad(
        key,
        "relay-accountable",
        `"${entry.occupant}" occupies "${seat.title}", which is an accountable command role. ` +
          `§12.2: "Relay is never assigned an accountable command role."`,
      )
    }
    if (seat.accountable && named(entry.backup) && RELAY_OCCUPANT.test(entry.backup)) {
      bad(
        key,
        "relay-accountable",
        `"${entry.backup}" is the backup for "${seat.title}", an accountable command role. A ` +
          `backup exercises the seat's authority the moment it is used, so §12.2's prohibition ` +
          `applies to it identically.`,
      )
    }

    const coverage = coverageGaps(entry.coverage)
    for (const window of coverage.malformed) {
      bad(
        key,
        "coverage-unreadable",
        `"${seat.title}" has a coverage window that is not a named occupant between two UTC ` +
          `\`HH:MM\` times (${JSON.stringify(window)}). An unreadable rota is not an uncovered ` +
          `hour — it is an hour nobody has checked.`,
      )
    }
    if (Array.isArray(entry.coverage) && entry.coverage.length > 0 && coverage.malformed.length === 0) {
      for (const gap of coverage.gaps) {
        bad(
          key,
          "coverage-gap",
          `"${seat.title}" is unoccupied ${gap.from}–${gap.to} UTC. §12.2 requires time-zone ` +
            `coverage to be explicit, and a cutover window runs through every hour of the day.`,
        )
      }
    }
  }

  for (const seat of required) {
    if (!filled.has(seat.key)) {
      bad(
        seat.key,
        "seat-unstaffed",
        `"${seat.title}" is not on the roster. §12.2 names it${seat.scope ? ` for the "${seat.scope}" scope, which this cutover declares applicable` : ""}; ` +
          `an absent seat is not an unstaffed seat until somebody notices at T0.`,
      )
    }
  }

  for (const [key] of filled) {
    const path = escalationChain(roster, key)
    if (path.reason === "cycle") {
      bad(
        key,
        "escalation-cycle",
        `${path.chain.join(" → ")} → ${path.terminal} escalates in a circle. Every seat on it has ` +
          `an escalation and none of them reaches an authority.`,
      )
    } else if (path.reason === "authority" && path.terminal === key && !known.get(key).accountable) {
      bad(
        key,
        "terminal-escalation-without-authority",
        `"${key}" declares itself the end of the escalation path, but §12.2 does not make it an ` +
          `accountable command role. A lead who escalates to nobody absorbs a decision they have ` +
          `no authority to take.`,
      )
    } else if (path.reason === "unknown-seat") {
      bad(
        key,
        "escalation-to-unknown-seat",
        `"${key}" escalates to "${path.terminal}", which is not on the roster. An escalation to ` +
          `nobody is never reported unanswered.`,
      )
    }
  }

  return Object.freeze(problems)
}

/**
 * §12.3's contact/escalation matrix: current occupants and backups by seat.
 *
 * Built from the roster rather than maintained beside it, because §12.3 asks for
 * a matrix of "current occupants" and the only way a second copy stays current
 * is by not existing. Unstaffed seats appear with `occupant: null` — the vacancy
 * is the row most worth printing.
 */
export function contactMatrix(roster, applicableScopes = []) {
  const scopes = new Set((Array.isArray(applicableScopes) ? applicableScopes : []).map(String))
  const bySeat = new Map(
    (Array.isArray(roster?.seats) ? roster.seats : [])
      .filter((s) => named(s?.seat))
      .map((s) => [s.seat.trim(), s]),
  )
  return Object.freeze(
    COMMAND_SEATS.filter((seat) => seat.scope === undefined || scopes.has(seat.scope)).map((seat) => {
      const entry = bySeat.get(seat.key)
      return Object.freeze({
        seat: seat.key,
        title: seat.title,
        accountable: seat.accountable,
        occupant: named(entry?.occupant) ? entry.occupant.trim() : null,
        backup: named(entry?.backup) ? entry.backup.trim() : null,
        contact: named(entry?.contact) ? entry.contact.trim() : null,
        escalatesTo: named(entry?.escalation) ? entry.escalation.trim() : null,
        coveredMinutes: coverageGaps(entry?.coverage).coveredMinutes,
      })
    }),
  )
}
