/**
 * IER-120-001 / IER-120-005 — what eligibility is decided *for*, as a type.
 *
 * Bible §17 ("Module, workflow, and data-scope eligibility") opens with the
 * sentence this file exists to make true: "Tenant entry is only the first
 * eligibility level." `tenure.tenant-entry.v1` answers one question — may this
 * person enter a workspace at all — and §17 then lists thirteen more targets
 * the same engine must be able to decide over.
 *
 * ## Why a target is a value and not a string
 *
 * `EligibilityPolicy.target` is a `string` today, and a free string is a target
 * nobody can enumerate: "finance" and "finance.module" and "Finance" are three
 * targets to a `===` and one target to a person. Worse, a free string cannot
 * carry the two things §17 requires a target to carry — the tenant capability
 * that must be entitled before the target can activate at all (§2.1 gate 1),
 * and the window a time-bound target is available in.
 *
 * So a target is a record with a `kind` drawn from a closed set, and
 * `formatTargetRef` / `parseTargetRef` are the only way one becomes text. A ref
 * that does not parse is refused rather than guessed at: a request naming a
 * target this deployment cannot resolve is a request nobody has read, and
 * treating it as "the workspace, probably" is how a scope check gets skipped.
 *
 * ## What is deliberately NOT here
 *
 * §17's list ends with two items that are conditions on a decision rather than
 * things decided about:
 *
 *   - "training/license/clearance-conditioned eligibility" — a condition over
 *     proofs, which is `proofs.ts` (IER-120-006), not a target kind. A forklift
 *     certificate is not a thing you are eligible *for*.
 *   - "device or authentication-assurance conditions **where owned by
 *     authorization**" — the Bible's own qualifier. That is
 *     `packages/authorization/src/assurance.ts`, which already exists and is
 *     already consulted by `decide()`. Restating it here would be a second
 *     opinion about step-up, and two opinions about step-up is one too many.
 *
 * Nothing in this file reads a clock, the network, or the environment. Every
 * time question takes the instant as an argument, for the same reason
 * `evaluate` does: a decision you cannot replay is a decision you cannot audit.
 */

/**
 * §17's targets, as a closed set.
 *
 * The ten IER-120-001 names in order — workspace, module, feature,
 * organization, workflow, report, seat candidacy, connector, jurisdiction,
 * time — plus the two §17 lists that IER-120-001's sentence compresses away:
 * privileged-access candidacy (which is NOT ordinary seat candidacy; §13.5
 * gives it a separate approval path) and environment.
 */
export const ELIGIBILITY_TARGET_KINDS = [
  "workspace",
  "module",
  "feature",
  "organization",
  "workflow",
  "report",
  "seat_candidacy",
  "privileged_access_candidacy",
  "connector",
  "jurisdiction",
  "environment",
  "time_window",
] as const

export type EligibilityTargetKind = (typeof ELIGIBILITY_TARGET_KINDS)[number]

/** An availability window on the target itself, distinct from any person's dates. */
export interface TargetWindow {
  /** ISO instant the target starts existing. */
  from: string
  /** ISO instant it stops, or null for open-ended. */
  to: string | null
}

export interface EligibilityTarget {
  kind: EligibilityTargetKind
  /**
   * The specific thing, within its kind. A module key, an org-unit id, a
   * workflow key, a report id, a connector id, an ISO-3166 code.
   *
   * Free of `:` and of whitespace so `formatTargetRef` is reversible; a target
   * whose id needs a colon is a target whose id is really two fields.
   */
  id: string
  /**
   * §2.1 gate 1 — the tenant capability that must be entitled before any
   * person can be eligible for this target.
   *
   * Required on every kind, including `workspace`. A target with no capability
   * behind it is a target that activates for a tenant that never bought it,
   * and "the workspace is free" is a commercial decision, not a default.
   */
  capability: string
  /** The org unit this target is scoped to. Required for `organization`. */
  orgUnitId?: string
  /** Required for `jurisdiction`; optional elsewhere as a bound. */
  jurisdiction?: string
  /** Required for `environment`. */
  environment?: string
  /** Required for `time_window`; optional elsewhere as a bound. */
  window?: TargetWindow
}

export interface TargetProblem {
  path: string
  message: string
}

const KINDS: ReadonlySet<string> = new Set(ELIGIBILITY_TARGET_KINDS)

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value))
}

/** `kind:id`. The canonical text form, and the only one. */
export function formatTargetRef(target: Pick<EligibilityTarget, "kind" | "id">): string {
  return `${target.kind}:${target.id}`
}

export type ParsedTargetRef =
  | { ok: true; kind: EligibilityTargetKind; id: string }
  | { ok: false; problem: string }

/**
 * Read a `kind:id` ref, or say why it is not one.
 *
 * Refuses rather than repairs: no trimming, no case folding, no defaulting the
 * kind. A ref that arrived with a trailing space is a ref some caller built by
 * string concatenation, and quietly accepting it means the same target has two
 * spellings for the rest of its life.
 */
export function parseTargetRef(ref: unknown): ParsedTargetRef {
  if (typeof ref !== "string" || ref.length === 0) {
    return { ok: false, problem: "target ref must be a non-empty string" }
  }
  const separator = ref.indexOf(":")
  if (separator === -1) return { ok: false, problem: `"${ref}" has no "kind:id" separator` }
  const kind = ref.slice(0, separator)
  const id = ref.slice(separator + 1)
  if (!KINDS.has(kind)) return { ok: false, problem: `"${kind}" is not an eligibility target kind` }
  if (id.length === 0) return { ok: false, problem: `"${ref}" names a kind but no target` }
  if (id.includes(":")) return { ok: false, problem: `"${ref}" has more than one separator` }
  if (/\s/.test(id)) return { ok: false, problem: `"${ref}" has whitespace in its id` }
  return { ok: true, kind: kind as EligibilityTargetKind, id }
}

/**
 * Every way a target is malformed, with the field it lives in.
 *
 * An empty array means the target is well-formed — it does NOT mean anybody is
 * eligible for it. Validation and eligibility are different questions and this
 * function answers only the first.
 */
export function validateTarget(target: EligibilityTarget): TargetProblem[] {
  const problems: TargetProblem[] = []

  if (!KINDS.has(target.kind)) {
    problems.push({ path: "kind", message: `"${target.kind}" is not an eligibility target kind` })
  }
  if (typeof target.id !== "string" || target.id.length === 0) {
    problems.push({ path: "id", message: "a target must name the thing it is about" })
  } else if (target.id.includes(":") || /\s/.test(target.id)) {
    problems.push({ path: "id", message: `"${target.id}" is not usable in a "kind:id" ref` })
  }
  if (typeof target.capability !== "string" || target.capability.length === 0) {
    problems.push({
      path: "capability",
      message: "a target with no tenant capability behind it would activate for a tenant that never bought it",
    })
  }

  if (target.kind === "organization" && !target.orgUnitId) {
    problems.push({ path: "orgUnitId", message: "an organization target must name its org unit" })
  }
  if (target.kind === "jurisdiction" && !target.jurisdiction) {
    problems.push({ path: "jurisdiction", message: "a jurisdiction target must name its jurisdiction" })
  }
  if (target.kind === "environment" && !target.environment) {
    problems.push({ path: "environment", message: "an environment target must name its environment" })
  }
  if (target.kind === "time_window" && !target.window) {
    problems.push({ path: "window", message: "a time-window target must carry its window" })
  }

  if (target.window) {
    if (!isIsoInstant(target.window.from)) {
      problems.push({ path: "window.from", message: "window.from is not an ISO instant" })
    }
    if (target.window.to !== null && !isIsoInstant(target.window.to)) {
      problems.push({ path: "window.to", message: "window.to is neither null nor an ISO instant" })
    }
    if (
      isIsoInstant(target.window.from) &&
      target.window.to !== null &&
      isIsoInstant(target.window.to) &&
      Date.parse(target.window.to) <= Date.parse(target.window.from)
    ) {
      problems.push({
        path: "window.to",
        message: "a window that closes before it opens is never open",
      })
    }
  }

  return problems
}

/**
 * IER-120-005 — where the evaluation instant falls relative to the target's
 * own window.
 *
 * Four states, not two. "Not yet" and "no longer" are different sentences to
 * show a person and different tickets to raise, and a boolean `available`
 * collapses them into the one answer that helps nobody. `UNBOUNDED` is the
 * fourth: a target with no window is not "always active by default", it is a
 * target nobody dated, and saying so keeps the absence visible.
 */
export type TargetWindowState = "UNBOUNDED" | "NOT_YET_ACTIVE" | "ACTIVE" | "EXPIRED"

export function targetWindowState(target: EligibilityTarget, now: Date): TargetWindowState {
  const window = target.window
  if (!window) return "UNBOUNDED"
  const at = now.getTime()
  const from = Date.parse(window.from)
  if (Number.isNaN(at) || Number.isNaN(from)) return "NOT_YET_ACTIVE"
  if (at < from) return "NOT_YET_ACTIVE"
  if (window.to !== null) {
    const to = Date.parse(window.to)
    // An unparseable close is treated as closed, not as open-ended: the one
    // reading that cannot accidentally widen access.
    if (Number.isNaN(to) || at >= to) return "EXPIRED"
  }
  return "ACTIVE"
}
