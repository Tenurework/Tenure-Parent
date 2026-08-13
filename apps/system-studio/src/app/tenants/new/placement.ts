/**
 * Where the composer may place a tenant — and what it says when it cannot find
 * out.
 *
 * ## Why this is a module and not four lines in `page.tsx`
 *
 * `placeableRegions()` reads the cell registry, and the cell registry THROWS.
 * `lib/cells.ts` refuses to invent an estate: a missing `AWS_REGION`,
 * `AWS_ACCOUNT_ID` or `AWS_PARTITION` that `sts:GetCallerIdentity` cannot answer
 * for either is a `FleetMisconfigured`, deliberately, because a default there
 * would place a tenant in an estate nobody chose.
 *
 * The compose page called it bare. So a console with no AWS credentials — the
 * exact case the Studio is supposed to survive — served a 500 on this route. A
 * stack trace is not a refusal an operator can act on, and "the page is down" and
 * "the fleet cannot be read" are different facts with different next moves.
 *
 * So the throw is caught here and turned into one of four STATES, and the
 * wording for each lives beside them rather than in the JSX. Two reasons:
 *
 *   * the four are then renderable by one component and testable without one,
 *     and a test can assert the four say four different things — which is the
 *     only thing that distinguishes a real refusal from a catch-all;
 *   * `UNKNOWN` is not `NO_CELL`. A fleet that answered and describes no cell is
 *     a fact about the estate; a fleet that did not answer is a fact about this
 *     process's permissions. Rendering the second as the first is exactly the
 *     defect `components/states.tsx` exists to end.
 *
 * Nothing here imports `@/lib/cells`: the reader is injected. That keeps the
 * module free of `server-only` so `placement.test.tsx` can drive all four arms,
 * and it is what lets that test throw the REAL `FleetMisconfigured` rather than
 * a hand-made lookalike.
 */

/** One reason the fleet could not be described, as `lib/cells` reports them. */
export interface PlacementProblem {
  field: string
  detail: string
}

export type PlacementOffer =
  /** The registry answered and named at least one region. */
  | { state: "OFFERED"; regions: readonly string[] }
  /** The registry answered and describes no cell at all. */
  | { state: "NO_CELL" }
  /**
   * The registry did not answer.
   *
   * `MISCONFIGURED` is `FleetMisconfigured` — the estate is neither configured
   * nor resolvable, and the problems name which variable. `UNREADABLE` is
   * anything else that came out of the read, carried verbatim rather than
   * summarised, because a message nobody kept is a message nobody can act on.
   */
  | {
      state: "UNKNOWN"
      reason: "MISCONFIGURED" | "UNREADABLE"
      problems: readonly PlacementProblem[]
    }

/**
 * `lib/cells.ts` refuses with this class. Matched by name rather than by
 * `instanceof` because importing the class would import `server-only` with it.
 *
 * The name is checked against the real error in `placement.test.tsx`, which
 * imports `FleetMisconfigured` itself and throws one — so renaming the class
 * turns this arm into `UNREADABLE` and reds that test, rather than silently
 * degrading the message an operator gets.
 */
const MISCONFIGURED = "FleetMisconfigured"

function problemsOf(error: unknown): readonly PlacementProblem[] | null {
  if (typeof error !== "object" || error === null) return null
  const carried = (error as { problems?: unknown }).problems
  if (!Array.isArray(carried)) return null
  return carried
    .filter((p): p is PlacementProblem => typeof p?.field === "string" && typeof p?.detail === "string")
    .map((p) => ({ field: p.field, detail: p.detail }))
}

export function placementOffer(read: () => readonly string[]): PlacementOffer {
  let regions: readonly string[]
  try {
    regions = read()
  } catch (error) {
    const named = error instanceof Error ? error.name : ""
    const problems = problemsOf(error)
    if (named === MISCONFIGURED && problems && problems.length > 0) {
      return { state: "UNKNOWN", reason: "MISCONFIGURED", problems }
    }
    return {
      state: "UNKNOWN",
      reason: "UNREADABLE",
      problems: [
        {
          field: "the cell registry",
          detail:
            error instanceof Error && error.message
              ? error.message
              : "The read failed and threw a value that carries no message.",
        },
      ],
    }
  }

  // An empty answer is an answer. It is not the same as no answer, and the two
  // are the pair a caught exception is most often flattened into.
  if (regions.length === 0) return { state: "NO_CELL" }
  return { state: "OFFERED", regions }
}

/**
 * Can a composition be registered against this offer?
 *
 * A region is not optional — `composeTenant` refuses a manifest without one, and
 * placement then puts the tenant in a cell. So the answer is no whenever the
 * fleet did not name a region, and the form says so beside a disabled control
 * rather than accepting a composition the server will refuse.
 */
export function canPlace(offer: PlacementOffer): boolean {
  return offer.state === "OFFERED"
}

/**
 * The one line the summary panel prints for "where it would run".
 *
 * Four states, four sentences, none of them a shrug. `placement.test.tsx`
 * asserts they are four DISTINCT strings, because a refusal that reads the same
 * however it failed is a refusal nobody can act on.
 */
export function placementSummary(offer: PlacementOffer): string {
  switch (offer.state) {
    case "OFFERED":
      return offer.regions.length === 1
        ? `In ${offer.regions[0]}, the only region the fleet serves.`
        : `In one of ${offer.regions.length} regions the fleet serves: ${offer.regions.join(", ")}.`
    case "NO_CELL":
      return "Nowhere. The cell registry answered and describes no cell, so there is nothing to place a tenant in."
    case "UNKNOWN":
      return offer.reason === "MISCONFIGURED"
        ? "Unknown. This engine cannot say what estate it is in, so it will not offer a region to place a tenant in."
        : "Unknown. Reading the cell registry failed, so no region can be offered."
  }
}

/**
 * The headline of the panel that replaces the region control when there is
 * none. `null` when there is a control to show instead.
 */
export function placementRefusal(offer: PlacementOffer): {
  headline: string
  detail: string
  remedy: string
} | null {
  switch (offer.state) {
    case "OFFERED":
      return null
    case "NO_CELL":
      return {
        headline: "No cell can take a tenant",
        detail:
          "The cell registry was read successfully and describes no cell. This is a fact about the fleet, not a failed read: nothing was refused and nothing timed out.",
        remedy:
          "A cell has to exist before a tenant can be placed in one. Until then this form can register nothing, because a manifest with no region is refused by composeTenant.",
      }
    case "UNKNOWN":
      return offer.reason === "MISCONFIGURED"
        ? {
            headline: "Unknown — the fleet's cell registry could not be described",
            detail:
              "This is not an empty fleet. The engine was unable to establish which estate it is running in, and it will not guess one: a guessed region places a tenant in an account nobody chose.",
            remedy: `Set the variables named below on this deployment, or grant this engine's task role sts:GetCallerIdentity so it can answer for itself: ${offer.problems
              .map((p) => p.field)
              .join(", ")}.`,
          }
        : {
            headline: "Unknown — reading the cell registry failed",
            detail:
              "The read did not refuse and did not return an empty fleet. It threw, and what it threw is carried below verbatim rather than summarised.",
            remedy:
              "Nothing about placement is known until that read succeeds. Composing is disabled rather than defaulted, because a region chosen by this form would not be a region the fleet agreed to.",
          }
  }
}
