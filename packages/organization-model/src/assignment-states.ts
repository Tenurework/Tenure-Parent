/**
 * GE-050-004 — assignment states, configured rather than enumerated.
 *
 * Bible §7.2 lists "assignment categories" as a configuration domain, and §645
 * names eleven: active, future, interim, acting, shadow, delegate, leave,
 * former, alumni, contractor, advisor.
 *
 * The tempting reading is "make the enum longer". It is the wrong one twice
 * over. A twelfth state then needs a code change and a migration — which is
 * precisely what configuration exists to avoid — and, worse, an enum says
 * nothing about what a state *means*. `INTERIM` and `ACTING` are different
 * words for arrangements that differ in one respect a reader cannot recover
 * from the name, and code that switches on the name has to encode that
 * difference somewhere else, where it will drift.
 *
 * So a state is a record of decisions:
 *
 *   * what authority it carries,
 *   * whether its holder occupies the seat — which is what makes the seat not
 *     vacant, and is *not* the same as being able to act in it,
 *   * whether it is live before its window opens,
 *   * whether it must be bounded.
 *
 * That last one is the one with teeth. An interim appointment with no end date
 * is a permanent appointment nobody called permanent, and it is how a temporary
 * arrangement becomes the org chart.
 */

/** What a holder in this state may do. */
export type StateAuthority = "NONE" | "READ_ONLY" | "FULL"

export interface AssignmentState {
  /** Stable key. Stored against the assignment; referenced by the catalog. */
  id: string
  label: string
  authority: StateAuthority
  /**
   * Whether this holder occupies the seat.
   *
   * Deliberately separate from authority. Somebody on leave occupies their seat
   * and can do nothing in it: the seat is not vacant, a successor is not
   * appointed, and a vacancy report that counted them as a gap would send
   * somebody to fill a post that is taken. A former holder is the reverse —
   * no occupancy, and the seat is genuinely open.
   */
  occupies: boolean
  /**
   * Whether the assignment is live before `effectiveFrom`.
   *
   * True only for a preview state. An incoming president shadowing for a week
   * before the term starts is the reason this exists; the window still bounds
   * the end, so the preview does not outlive the handover.
   */
  liveBeforeStart?: boolean
  /**
   * Whether the assignment must carry an end date.
   *
   * An interim, acting or delegate arrangement without one is a permanent
   * appointment nobody called permanent.
   */
  requiresEnd?: boolean
  description?: string
}

export interface AssignmentStateCatalog {
  id: string
  version: string
  states: readonly AssignmentState[]
}

/**
 * The states the platform ships, which a tenant may narrow or extend.
 *
 * Every one of the eleven the Bible names, with its decisions stated. The
 * differences that a name alone cannot carry are here: `interim` and `acting`
 * both hold a seat temporarily and only one of them occupies it — an acting
 * holder is covering a post that is still somebody else's, an interim holder is
 * in a post that is genuinely empty.
 */
export const PLATFORM_ASSIGNMENT_STATES: AssignmentStateCatalog = {
  id: "platform",
  version: "1.0.0",
  states: [
    { id: "active", label: "Active", authority: "FULL", occupies: true },
    {
      id: "future",
      label: "Future",
      authority: "NONE",
      occupies: false,
      description: "Appointed, not yet started. Holds nothing until the window opens.",
    },
    {
      id: "interim",
      label: "Interim",
      authority: "FULL",
      occupies: true,
      requiresEnd: true,
      description: "Holds a genuinely empty post until it is filled.",
    },
    {
      id: "acting",
      label: "Acting",
      authority: "FULL",
      occupies: false,
      requiresEnd: true,
      description:
        "Covers a post that is still somebody else's — the substantive holder is on leave or absent, and the seat is not vacant.",
    },
    {
      id: "shadow",
      label: "Shadow",
      authority: "READ_ONLY",
      occupies: false,
      liveBeforeStart: true,
      requiresEnd: true,
      description: "Previews the seat before taking it. Reads; does not act.",
    },
    {
      id: "delegate",
      label: "Delegate",
      authority: "FULL",
      occupies: false,
      requiresEnd: true,
      description: "Exercises named authority lent by the holder. See Delegation for the bounds.",
    },
    {
      id: "leave",
      label: "On leave",
      authority: "NONE",
      occupies: true,
      description: "Still the holder; the seat is not vacant and no successor is appointed.",
    },
    { id: "former", label: "Former", authority: "NONE", occupies: false },
    {
      id: "alumni",
      label: "Alumni",
      authority: "NONE",
      occupies: false,
      description: "A past holder kept for handover and history. Access is revoked.",
    },
    {
      id: "advisor",
      label: "Advisor",
      authority: "READ_ONLY",
      occupies: false,
      description: "Staff or faculty oversight. Sees the seat's work; does not hold the post.",
    },
    {
      id: "contractor",
      label: "Contractor",
      authority: "FULL",
      occupies: true,
      requiresEnd: true,
      description: "Engaged for a bounded period. An unbounded contract is employment by another name.",
    },
  ],
}

export type CatalogProblem = { stateId: string; detail: string }

/**
 * Whether a catalog is one the engine can decide from.
 *
 * A catalog with two states sharing an id is one where the second silently
 * wins, and which one that is depends on array order — a decision nobody made.
 */
export function validateAssignmentCatalog(
  catalog: AssignmentStateCatalog,
): readonly CatalogProblem[] {
  const problems: CatalogProblem[] = []
  const seen = new Set<string>()

  if (catalog.states.length === 0) {
    problems.push({ stateId: "", detail: "A catalog with no states leaves every assignment unclassified." })
  }

  for (const state of catalog.states) {
    if (!state.id.trim()) {
      problems.push({ stateId: state.id, detail: "A state with no id cannot be stored against an assignment." })
      continue
    }
    if (seen.has(state.id)) {
      problems.push({ stateId: state.id, detail: "Two states share this id; the second would silently win." })
    }
    seen.add(state.id)

    if (!state.label.trim()) {
      problems.push({ stateId: state.id, detail: "A state with no label is one nobody can choose in a form." })
    }
    // A state that grants nothing and occupies nothing is a record of the past,
    // and requiring it to end would make history expire. The combination worth
    // refusing is the opposite: authority with no bound.
    if (state.authority === "FULL" && state.requiresEnd === false) {
      problems.push({
        stateId: state.id,
        detail:
          "Explicitly unbounded full authority. Leave requiresEnd unset for a substantive appointment; " +
          "setting it false says a temporary arrangement need not end, which is how one becomes the org chart.",
      })
    }
    if (state.liveBeforeStart && state.authority === "FULL") {
      problems.push({
        stateId: state.id,
        detail:
          "Live before its window and holding full authority: this acts before the term it was granted for.",
      })
    }
  }

  return problems
}

/** Look a state up. Unknown ids are not resolved to anything. */
export function findAssignmentState(
  catalog: AssignmentStateCatalog,
  stateId: string,
): AssignmentState | undefined {
  return catalog.states.find((state) => state.id === stateId)
}

/**
 * What an assignment in this state may do, at this instant.
 *
 * **Fails closed on an unknown state.** A key the catalog does not declare is a
 * key nobody configured — a typo, a state removed from the catalog while rows
 * still carry it, a value written by an older version. Defaulting to the
 * catalog's most common answer would grant authority on the strength of a
 * spelling mistake.
 */
export function stateAuthorityAt(
  catalog: AssignmentStateCatalog,
  input: { stateId: string; effectiveFrom: string; effectiveTo: string | null; at: Date },
): StateAuthority {
  const state = findAssignmentState(catalog, input.stateId)
  if (!state) return "NONE"

  const now = input.at.getTime()
  const from = Date.parse(input.effectiveFrom)
  if (Number.isNaN(from)) return "NONE"

  if (now < from && !state.liveBeforeStart) return "NONE"

  if (input.effectiveTo !== null) {
    const to = Date.parse(input.effectiveTo)
    // Half-open, matching memberships and seats: one term ending exactly where
    // the next begins leaves no gap and no overlap.
    if (Number.isNaN(to) || now >= to) return "NONE"
  }

  return state.authority
}

/**
 * Whether a seat is vacant, given every assignment against it.
 *
 * Vacancy is about occupancy, not authority. A seat whose holder is on leave is
 * not vacant — appointing a successor to it would put two people in one post —
 * and a seat covered by an acting holder is not filled, because the acting
 * holder is covering somebody else's.
 */
export function seatIsVacant(
  catalog: AssignmentStateCatalog,
  assignments: readonly { stateId: string; effectiveFrom: string; effectiveTo: string | null }[],
  at: Date,
): boolean {
  return !assignments.some((assignment) => {
    const state = findAssignmentState(catalog, assignment.stateId)
    if (!state || !state.occupies) return false

    const now = at.getTime()
    const from = Date.parse(assignment.effectiveFrom)
    if (Number.isNaN(from) || now < from) return false

    if (assignment.effectiveTo !== null) {
      const to = Date.parse(assignment.effectiveTo)
      if (Number.isNaN(to) || now >= to) return false
    }
    return true
  })
}

/**
 * Whether an assignment as written satisfies its state's rules.
 *
 * Checked at write time rather than read time, because the failure it catches —
 * an interim appointment with no end — is invisible afterwards. It looks exactly
 * like a substantive one.
 */
export function assignmentProblems(
  catalog: AssignmentStateCatalog,
  assignment: { stateId: string; effectiveFrom: string; effectiveTo: string | null },
): readonly string[] {
  const state = findAssignmentState(catalog, assignment.stateId)
  if (!state) {
    return [`"${assignment.stateId}" is not a state this catalog declares, so nothing can say what it permits.`]
  }

  const problems: string[] = []
  if (state.requiresEnd && assignment.effectiveTo === null) {
    problems.push(
      `A "${state.label}" assignment must end. Without a date it is a permanent appointment nobody called permanent.`,
    )
  }
  if (Number.isNaN(Date.parse(assignment.effectiveFrom))) {
    problems.push("The start of the assignment is not a time.")
  }
  if (assignment.effectiveTo !== null && Number.isNaN(Date.parse(assignment.effectiveTo))) {
    problems.push("The end of the assignment is not a time.")
  }
  return problems
}
