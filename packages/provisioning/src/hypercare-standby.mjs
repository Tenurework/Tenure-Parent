/**
 * EXT-110-010 — who holds a seat when its occupant is unavailable, proven rather
 * than asserted.
 *
 * The requirement: *"Prove on-call/escalation/handoff when a primary seat
 * occupant is unavailable."* The word is **prove**. §12.2 already requires every
 * seat to declare a backup, an escalation and a handoff, and
 * `cutover-command-roles.mjs` already refuses a roster that omits them. What
 * that check cannot tell you is whether the declarations WORK: a roster where
 * every seat names a backup, and where three seats name the same person as
 * backup, satisfies §12.2 and collapses the moment that person is on a plane.
 *
 * So this module runs the outage. Given a roster, a set of unavailable people
 * and a UTC minute, it resolves who actually holds each seat — and the answer is
 * either a named person with the route that reached them, or a refusal naming
 * the seat that nobody can cover.
 *
 * ── Reuse, deliberately ────────────────────────────────────────────────────
 *
 * `escalationChain`, `coverageGaps` and `COMMAND_SEATS` come from
 * `cutover-command-roles.mjs`. None of them is restated here. A second
 * escalation walker would be the repository's second answer to "who is above
 * this seat", and the two would disagree the first time either was tightened.
 *
 * ── Unavailability is by PERSON, not by seat ───────────────────────────────
 *
 * The failure mode being modelled is a person being unreachable — asleep,
 * boarding, ill — and one person can occupy a seat, back up a second, and be on
 * the rota of a third. Marking the *seat* unavailable would let the same person
 * answer for the other two, which is the exact fiction this module exists to
 * break.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * Same reason as `cutover-command-roles.mjs`, which this imports: Node 20, which
 * CI pins, cannot load TypeScript, and both readers run there.
 */

import {
  COMMAND_SEATS,
  coverageGaps,
  escalationChain,
} from "./cutover-command-roles.mjs"

const named = (value) => typeof value === "string" && value.trim().length > 0
const norm = (value) => (named(value) ? value.trim() : null)

/** Minutes since 00:00 UTC for `HH:MM`, or null. */
function minutesOfDay(value) {
  if (!named(value)) return null
  const m = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Whether a rota window covers a minute, wrapping midnight the way a rota does. */
function windowCovers(window, minute) {
  const from = minutesOfDay(window?.from)
  const to = minutesOfDay(window?.to)
  if (from === null || to === null || from === to) return false
  return from < to ? minute >= from && minute < to : minute >= from || minute < to
}

/**
 * How a seat came to be held. Ordered by §12.2's own precedence: the occupant,
 * then the declared backup, then the rota that covers this hour, then the
 * escalation path.
 */
export const HOLD_ROUTES = Object.freeze(["OCCUPANT", "BACKUP", "ROTA", "ESCALATION"])

/**
 * Who holds `seatKey` at `atUtc`, given `unavailable` people.
 *
 * Returns `{ seat, holder, route, via, why }` when somebody holds it, and
 * `{ seat, holder: null, reason, why }` when nobody does. The two shapes are
 * distinguishable on `holder === null` rather than on a boolean, because a
 * resolution that returns a person and a resolution that returns a refusal are
 * read by different code and a shared shape gets one of them wrong.
 *
 * `atUtc` is an `HH:MM` UTC minute rather than an instant: §12.2's coverage is
 * declared as a follow-the-sun rota over the 24-hour command day, so the only
 * part of an instant this can use is its minute-of-day. Taking a full timestamp
 * would imply this understood the date, which it does not.
 */
export function seatHolder(roster, seatKey, { unavailable = [], atUtc } = {}) {
  const key = norm(seatKey)
  const minute = minutesOfDay(atUtc)
  const out = new Set([...unavailable].map((p) => String(p).trim()).filter((p) => p.length > 0))

  const bySeat = new Map(
    (Array.isArray(roster?.seats) ? roster.seats : [])
      .filter((s) => named(s?.seat))
      .map((s) => [s.seat.trim(), s]),
  )

  const refuse = (reason, why) => Object.freeze({ seat: key, holder: null, reason, why })
  const hold = (holder, route, via, why) =>
    Object.freeze({ seat: key, holder, route, via, why })

  if (key === null || !bySeat.has(key)) {
    return refuse(
      "unknown-seat",
      `"${seatKey}" is not on the roster, so nobody can be shown to hold it during an outage.`,
    )
  }
  if (minute === null) {
    return refuse(
      "no-evaluation-time",
      `No UTC \`HH:MM\` was supplied. §12.2's coverage is a rota over the command day, so "who ` +
        `holds this seat" has no answer without the hour. An unreadable clock is not a covered hour.`,
    )
  }

  const entry = bySeat.get(key)

  if (named(entry.occupant) && !out.has(entry.occupant.trim())) {
    return hold(entry.occupant.trim(), "OCCUPANT", null, "The primary occupant is available.")
  }

  if (named(entry.backup) && !out.has(entry.backup.trim())) {
    return hold(
      entry.backup.trim(),
      "BACKUP",
      null,
      `The occupant is unavailable and §12.2's declared backup is not.`,
    )
  }

  const rota = Array.isArray(entry.coverage) ? entry.coverage : []
  const covering = rota.find((w) => windowCovers(w, minute) && named(w.occupant) && !out.has(w.occupant.trim()))
  if (covering) {
    return hold(
      covering.occupant.trim(),
      "ROTA",
      `${covering.from}–${covering.to} UTC`,
      `Neither the occupant nor the backup is available; the follow-the-sun window covering ` +
        `${atUtc} UTC is staffed.`,
    )
  }

  const path = escalationChain(roster, key)
  if (path.reason === "cycle") {
    return refuse(
      "escalation-cycle",
      `${path.chain.join(" → ")} escalates in a circle, so an outage on this seat escalates ` +
        `forever. §12.2 requires escalation to be explicit; a loop is explicit and useless.`,
    )
  }
  if (path.reason === "unknown-seat") {
    return refuse(
      "escalation-to-unknown-seat",
      `The escalation path leaves the roster at "${path.terminal}". An outage escalated to nobody ` +
        `is never reported unanswered.`,
    )
  }

  for (const up of path.chain.slice(1)) {
    const above = bySeat.get(up)
    for (const candidate of [above?.occupant, above?.backup]) {
      if (named(candidate) && !out.has(candidate.trim())) {
        return hold(
          candidate.trim(),
          "ESCALATION",
          up,
          `The seat, its backup and its rota are all unavailable at ${atUtc} UTC; the escalation ` +
            `path reaches "${up}", which is staffed.`,
        )
      }
    }
  }

  return refuse(
    "no-stand-in",
    `At ${atUtc} UTC the occupant, the backup, every rota window covering the hour and every seat ` +
      `on the escalation path (${path.chain.join(" → ")}) are unavailable. The seat is unheld, and ` +
      `during hypercare that is an unanswered page rather than a gap in a document.`,
  )
}

/**
 * The drill: run an outage across every seat and report the ones that fail.
 *
 * `scenarios` is a list of `{ id, unavailable, atUtc, expectHeld }`. Every seat
 * on the roster is resolved for every scenario, which is what makes this a proof
 * rather than a spot check — a roster where 22 seats have a working backup and
 * the 23rd does not passes any sampling and fails here.
 *
 * `accountableOnly` narrows the drill to §12.2's accountable seats, because
 * those are the ones whose vacancy stops a decision rather than delaying a task.
 */
export function handoffDrill(roster, scenarios, { accountableOnly = false } = {}) {
  const findings = []
  const results = []
  const accountable = new Set(COMMAND_SEATS.filter((s) => s.accountable).map((s) => s.key))

  const seats = (Array.isArray(roster?.seats) ? roster.seats : [])
    .filter((s) => named(s?.seat))
    .map((s) => s.seat.trim())
    .filter((s) => !accountableOnly || accountable.has(s))

  for (const scenario of Array.isArray(scenarios) ? scenarios : []) {
    const id = norm(scenario?.id) ?? "(unnamed scenario)"
    const out = new Set([...(scenario?.unavailable ?? [])].map((p) => String(p).trim()))

    for (const seat of seats) {
      const resolved = seatHolder(roster, seat, {
        unavailable: [...out],
        atUtc: scenario?.atUtc,
      })
      results.push(Object.freeze({ scenario: id, ...resolved }))

      if (resolved.holder === null) {
        findings.push(
          Object.freeze({
            scenario: id,
            seat,
            reason: resolved.reason,
            detail: resolved.why,
          }),
        )
        continue
      }
      if (out.has(resolved.holder)) {
        // Belt and braces on the resolver itself: if this ever fires, the
        // resolver has handed the seat back to somebody the scenario declared
        // unreachable, which is the failure the whole module exists to detect.
        findings.push(
          Object.freeze({
            scenario: id,
            seat,
            reason: "stand-in-is-unavailable",
            detail: `"${resolved.holder}" was resolved into "${seat}" and is on the unavailable list.`,
          }),
        )
      }
    }
  }

  return Object.freeze({ results: Object.freeze(results), findings: Object.freeze(findings) })
}

/**
 * Whether the handoff INSTRUCTIONS exist for the seats an outage moves.
 *
 * §12.2's seven facts include handoff, and `rosterProblems` already refuses a
 * seat that declares none — so this does not re-check that. What it checks is
 * the pair §12.2 leaves implicit and an outage makes real: the seat that changed
 * hands during the drill, and whether the person who picked it up was given the
 * handoff and the contact channel to be reached on. A handoff written for the
 * backup and a seat picked up over the escalation path are not the same handoff.
 */
export function handoffCoverageProblems(roster, drill) {
  const problems = []
  const bySeat = new Map(
    (Array.isArray(roster?.seats) ? roster.seats : [])
      .filter((s) => named(s?.seat))
      .map((s) => [s.seat.trim(), s]),
  )

  const moved = (drill?.results ?? []).filter((r) => r.holder !== null && r.route !== "OCCUPANT")

  for (const result of moved) {
    const entry = bySeat.get(result.seat)
    if (!named(entry?.handoff)) {
      problems.push(
        Object.freeze({
          scenario: result.scenario,
          seat: result.seat,
          reason: "handoff-undocumented",
          detail:
            `"${result.seat}" changed hands to ${result.holder} by ${result.route} and the seat ` +
            `declares no handoff. §12.2 requires one; an undocumented handoff is a seat that is ` +
            `formally occupied and practically empty.`,
        }),
      )
    }
    if (!named(entry?.contact)) {
      problems.push(
        Object.freeze({
          scenario: result.scenario,
          seat: result.seat,
          reason: "stand-in-unreachable",
          detail:
            `"${result.seat}" is held by ${result.holder} and the seat declares no contact ` +
            `channel. A stand-in nobody can reach is the outage continuing under a different name.`,
        }),
      )
    }
    if (result.route === "ESCALATION") {
      problems.push(
        Object.freeze({
          scenario: result.scenario,
          seat: result.seat,
          reason: "held-by-escalation",
          detail:
            `"${result.seat}" was covered only by escalating to "${result.via}". That is the path ` +
            `working, and it is also a seat with no local cover: §12.2's backup and rota both ` +
            `failed for this outage. Reported rather than refused — an escalation that answers is ` +
            `a pass, and one nobody notices becomes the rota.`,
        }),
      )
    }
  }

  return Object.freeze(problems)
}

/**
 * §12.2's coverage arithmetic, re-exported through the outage.
 *
 * `coverageGaps` answers "is this rota complete". This answers the question an
 * outage asks instead: which hours of the command day does this seat lose when
 * these people are unreachable. A rota with no gaps and one person in every
 * window has 24 hours of coverage and zero hours of resilience.
 */
export function coverageUnderOutage(entry, unavailable) {
  const out = new Set([...(unavailable ?? [])].map((p) => String(p).trim()))
  const rota = Array.isArray(entry?.coverage) ? entry.coverage : []
  const remaining = rota.filter((w) => named(w?.occupant) && !out.has(w.occupant.trim()))
  const before = coverageGaps(rota)
  const after = coverageGaps(remaining)

  return Object.freeze({
    coveredMinutesBefore: before.coveredMinutes,
    coveredMinutesAfter: after.coveredMinutes,
    lostMinutes: before.coveredMinutes - after.coveredMinutes,
    gapsAfter: after.gaps,
  })
}
