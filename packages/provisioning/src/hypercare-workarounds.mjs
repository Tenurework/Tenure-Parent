/**
 * EXT-110-006 — the workaround lifecycle, and the facts a workaround must carry.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §13.4
 * states the whole requirement in one sentence:
 *
 *   "A workaround has owner, instructions, risk, affected population, expiry,
 *    communication, and permanent-fix link."
 *
 * Seven facts, and the requirement id adds the word the sentence leaves
 * implicit: *lifecycle*. A workaround is not a row somebody wrote during an
 * incident; it is a thing that is proposed, adopted, communicated, and then
 * either superseded by the permanent fix or allowed to expire. §13.3 asks for
 * "workaround age" as a hypercare metric, which is only measurable if the state
 * and the clock are both explicit.
 *
 * ── Why the expiry is a state and not a warning ────────────────────────────
 *
 * The failure this module exists over is the workaround that quietly becomes
 * the process. It has an expiry, the expiry passes, nobody looks, and eighteen
 * months later the manual step is in the training material. So `stateOf` moves
 * a workaround to `EXPIRED` on the clock the caller supplies rather than on a
 * flag somebody sets — an expired workaround cannot be `ACTIVE` because nobody
 * got round to changing its status.
 *
 * ── Three answers, not two ─────────────────────────────────────────────────
 *
 * `permanentFix` has three shapes and they are deliberately distinguishable:
 * a linked defect id (the fix is tracked), the literal `NONE_REQUIRED` with a
 * reason (somebody decided this is now the process and said so), and absent
 * (nobody has decided). The third is a finding. `purge-gate.ts` makes the same
 * argument about `unknown` for tenant purge, in a different domain: "we looked
 * and there is no permanent fix planned" and "nobody was asked" are different
 * answers, and collapsing them is how a workaround becomes permanent without a
 * decision.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * Same reason as `cutover-runbook.mjs` and `cutover-command-roles.mjs`: Node 20,
 * which CI pins, cannot load TypeScript, and both readers — `node --test` and
 * the generator under `tools/` — run there.
 */

/**
 * §13.4's seven facts, each with the document's own word.
 *
 * `phrase` exists so the list can be checked against §13.4 by a reader rather
 * than trusted, exactly as `REQUIRED_SEAT_FACTS` does for §12.2. `list: true`
 * marks the two facts that are meaningless as a single string — one instruction
 * is a step, one audience is not a communication plan.
 */
export const WORKAROUND_FACTS = Object.freeze([
  Object.freeze({ key: "owner", phrase: "owner" }),
  Object.freeze({ key: "instructions", phrase: "instructions", list: true }),
  Object.freeze({ key: "risk", phrase: "risk" }),
  Object.freeze({ key: "affectedPopulation", phrase: "affected population" }),
  Object.freeze({ key: "expiry", phrase: "expiry" }),
  Object.freeze({ key: "communication", phrase: "communication", list: true }),
  Object.freeze({ key: "permanentFix", phrase: "permanent-fix link" }),
])

/**
 * The lifecycle states.
 *
 * `PROPOSED` and `ACTIVE` are separated because §13.4's sentence is about a
 * workaround that people are being told to follow; one drafted during triage and
 * not yet communicated has an audience of nobody, and holding it to the
 * communication fact would make the draft a finding.
 *
 * `EXPIRED` is terminal-but-unhappy: it means the deadline passed with neither a
 * permanent fix nor a renewed decision, and it is the state §13.3's "workaround
 * age" metric is really counting.
 */
export const WORKAROUND_STATES = Object.freeze([
  "PROPOSED",
  "ACTIVE",
  "SUPERSEDED",
  "WITHDRAWN",
  "EXPIRED",
])

/** Risk levels. Declared, never inferred from prose. */
export const RISK_LEVELS = Object.freeze(["LOW", "MEDIUM", "HIGH"])

/**
 * The permanent-fix value that means a decision was taken not to build one.
 *
 * §13.4 requires a permanent-fix *link*. The one case where no link can exist is
 * where the workaround has been accepted as the process, and that is a decision
 * somebody makes — so it is stated, with a reason, rather than left blank. A
 * blank field and an accepted process are the two answers this constant exists
 * to keep apart.
 */
export const NO_PERMANENT_FIX = "NONE_REQUIRED"

const named = (value) => typeof value === "string" && value.trim().length > 0
const filled = (value) => (Array.isArray(value) ? value.filter(named).length > 0 : named(value))

/** An ISO instant, or null if it is not one. Comparison is on the parsed value. */
function instant(value) {
  if (!named(value)) return null
  const ms = Date.parse(value.trim())
  return Number.isNaN(ms) ? null : ms
}

/**
 * The state a workaround is in at `at`, derived rather than stored.
 *
 * `at` is a parameter and nothing here reads a clock, for the reason
 * `change-class.ts` gives about cooling-off periods: a caller that supplies both
 * the start and the "now" can satisfy any deadline instantly, so the caller
 * supplies the now and the recorded facts supply everything else.
 *
 * Returns `{ state, ageDays, why }`. `state` is null when the record cannot be
 * placed at all — no `adoptedAt`, or an unparseable expiry — because "this
 * workaround is fine" and "this record has no clock" are different answers.
 */
export function stateOf(workaround, at) {
  const now = instant(at)
  const adopted = instant(workaround?.adoptedAt)
  const expiry = instant(workaround?.expiry)

  const answer = (state, why, ageDays = null) =>
    Object.freeze({ state, ageDays, why })

  if (now === null) {
    return answer(
      null,
      "No evaluation time was supplied, so no deadline can be compared against anything. " +
        "An unreadable clock is not an unexpired workaround.",
    )
  }
  if (workaround?.withdrawnAt !== undefined) {
    return instant(workaround.withdrawnAt) === null
      ? answer(null, "The workaround records a withdrawal with an unreadable time.")
      : answer("WITHDRAWN", `Withdrawn at ${workaround.withdrawnAt}.`)
  }
  if (workaround?.supersededAt !== undefined) {
    const superseded = instant(workaround.supersededAt)
    return superseded === null
      ? answer(null, "The workaround records a supersession with an unreadable time.")
      : answer(
          "SUPERSEDED",
          `The permanent fix shipped at ${workaround.supersededAt}; the workaround stopped being ` +
            `the instruction then.`,
          // Age runs from adoption to the supersession, not to now: a closed
          // workaround that keeps ageing is a number that grows after the thing
          // it measures has stopped.
          adopted === null ? null : Math.floor((superseded - adopted) / 86400000),
        )
  }
  if (adopted === null) {
    return answer(
      "PROPOSED",
      "No adoption time, so nobody has been told to follow this yet. §13.4's communication fact " +
        "applies from adoption, not from drafting.",
    )
  }

  const ageDays = Math.floor((now - adopted) / 86400000)

  if (expiry === null) {
    return answer(
      null,
      "The workaround is adopted and its expiry cannot be read. §13.4 requires an expiry, and a " +
        "workaround whose deadline nobody can evaluate is the one that becomes the process.",
      ageDays,
    )
  }
  if (now >= expiry) {
    return answer(
      "EXPIRED",
      `The expiry ${workaround.expiry} has passed and neither a permanent fix nor a renewed ` +
        `decision is recorded. This is the state §13.3's "workaround age" metric exists to count.`,
      ageDays,
    )
  }
  return answer("ACTIVE", `In force until ${workaround.expiry}.`, ageDays)
}

/**
 * Every way one workaround fails §13.4, in a stable order.
 *
 * `at` is required for the same reason `stateOf` requires it, and its absence is
 * reported as `no-evaluation-time` rather than skipped: a check that quietly
 * does not run is the defect this repository keeps paying for.
 */
export function workaroundProblems(workaround, at) {
  const problems = []
  const bad = (field, reason, detail) =>
    problems.push(Object.freeze({ id: workaround?.id ?? "(unidentified)", field, reason, detail }))

  if (!named(workaround?.id)) {
    bad(
      "id",
      "unidentified-workaround",
      "A workaround with no id cannot be linked from an incident, counted in §13.3's workaround " +
        "age, or shown closed at §13.5's exit.",
    )
  }

  const { state } = stateOf(workaround, at)
  if (instant(at) === null) {
    bad(
      "at",
      "no-evaluation-time",
      "No evaluation time was supplied. The expiry, the age and the state are all relative to a " +
        "clock, and checking the other six facts while silently skipping those is a pass that " +
        "means nothing.",
    )
  }

  // A proposal has not been given to anybody, so the communication fact does not
  // yet apply to it. Every other fact does: a draft with no owner and no risk is
  // not a draft, it is a note.
  const applicable = WORKAROUND_FACTS.filter(
    (f) => !(state === "PROPOSED" && f.key === "communication"),
  )

  for (const fact of applicable) {
    if (!filled(workaround?.[fact.key])) {
      bad(
        fact.key,
        "fact-missing",
        `The workaround states no ${fact.phrase}. §13.4 requires all ${WORKAROUND_FACTS.length}; ` +
          `this one is absent, so it is settled by whoever is on shift.`,
      )
    }
  }

  if (named(workaround?.risk) && !RISK_LEVELS.includes(workaround.risk.trim())) {
    bad(
      "risk",
      "unrated-risk",
      `Risk is "${workaround.risk}", which is not one of ${RISK_LEVELS.join(", ")}. A risk stated ` +
        `as prose cannot be sorted, thresholded, or accepted by anybody at §13.5's exit.`,
    )
  }

  if (named(workaround?.permanentFix) && workaround.permanentFix.trim() === NO_PERMANENT_FIX) {
    if (!named(workaround?.permanentFixDecision)) {
      bad(
        "permanentFix",
        "accepted-without-decision",
        `The workaround declares ${NO_PERMANENT_FIX} and records no decision. Accepting a ` +
          `workaround as the permanent process is a decision; writing it as an absence is how one ` +
          `gets made by nobody.`,
      )
    }
  }

  if (workaround?.supersededAt !== undefined) {
    const link = named(workaround?.permanentFix) ? workaround.permanentFix.trim() : ""
    if (link === "" || link === NO_PERMANENT_FIX) {
      bad(
        "permanentFix",
        "superseded-by-nothing",
        `The workaround is recorded as superseded and names no permanent fix that superseded it. ` +
          `§13.4 pairs the two, and a supersession with no fix behind it removes the instruction ` +
          `without replacing the behaviour.`,
      )
    }
  }

  if (state === "EXPIRED") {
    bad(
      "expiry",
      "expired-and-still-listed",
      `The expiry ${workaround.expiry} has passed with no permanent fix and no renewal. §13.4 ` +
        `gives a workaround an expiry so that it stops; a listed expired workaround is one people ` +
        `are still being told to follow after the date somebody chose for it to end.`,
    )
  }

  // Reported only when the absence is not already reported. A workaround with no
  // expiry cannot be placed in the lifecycle AND is missing one of §13.4's seven
  // facts — one absence, and two findings for it would read as two defects and,
  // worse, would make a single-mutation refusal scenario trip two rules.
  if (state === null && instant(at) !== null && problems.length === 0) {
    bad(
      "state",
      "unplaceable",
      stateOf(workaround, at).why,
    )
  }

  return Object.freeze(problems)
}

/**
 * The register: every workaround, plus the findings that only exist across them.
 *
 * Two of §13.4's failures are not visible one row at a time — a duplicate id
 * makes every later reference ambiguous, and two workarounds naming the same
 * permanent fix means one of them will be closed by a supersession that was
 * never about it.
 */
export function registerProblems(workarounds, at) {
  const problems = []
  const list = Array.isArray(workarounds) ? workarounds : []

  for (const workaround of list) {
    problems.push(...workaroundProblems(workaround, at))
  }

  const seen = new Map()
  for (const workaround of list) {
    const id = named(workaround?.id) ? workaround.id.trim() : null
    if (!id) continue
    if (seen.has(id)) {
      problems.push(
        Object.freeze({
          id,
          field: "id",
          reason: "duplicate-workaround",
          detail: `Two workarounds are recorded as "${id}". Whichever is read first decides what ` +
            `the instruction, the expiry and the owner are.`,
        }),
      )
    }
    seen.set(id, workaround)
  }

  return Object.freeze(problems)
}

/**
 * §13.3's workaround-age metric, as arithmetic over the register.
 *
 * `unplaceable` is carried out separately rather than dropped from the counts:
 * an average age computed over the rows that happened to have a readable clock
 * is a number that gets prettier as the register gets worse.
 */
export function workaroundAges(workarounds, at) {
  const list = Array.isArray(workarounds) ? workarounds : []
  const byState = Object.fromEntries(WORKAROUND_STATES.map((s) => [s, 0]))
  const ages = []
  let unplaceable = 0

  for (const workaround of list) {
    const { state, ageDays } = stateOf(workaround, at)
    if (state === null) {
      unplaceable += 1
      continue
    }
    byState[state] += 1
    if (ageDays !== null && (state === "ACTIVE" || state === "EXPIRED")) ages.push(ageDays)
  }

  return Object.freeze({
    total: list.length,
    byState: Object.freeze(byState),
    unplaceable,
    oldestOpenDays: ages.length === 0 ? null : Math.max(...ages),
    openCount: ages.length,
  })
}
