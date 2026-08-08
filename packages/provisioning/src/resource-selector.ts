/**
 * WRK-020-002 — versioned include/exclude resource selectors, and impact diffs.
 *
 * Before this a connection's scope was all-or-nothing.
 * `grep -rn 'Selector|selector' packages/provisioning/src packages/module-runtime/src
 * apps/web/src/lib` returned a CSS-parsing test and a Unicode range comment:
 * there was no selector, no include list, no exclude list, no version and no
 * diff anywhere. `catalogs.ts` modelled the scope a connector asks OF THE
 * PROVIDER (`requestedScopes`, gated by `providerActivation`) and nothing at all
 * about WHICH RESOURCES inside a connected workspace are in scope — which are
 * two different questions with two different blast radii. "Drive.file" says what
 * the app may do; it does not say which four folders it was pointed at.
 *
 * ## Three refusals, and each one is a question with two answers
 *
 * An EMPTY INCLUDE SET is the important one. It means "everything" to whoever
 * wrote the connect screen and "nothing" to whoever wrote the sync runner, and
 * both readings ship. That is the same single-valuedness argument
 * `relationships.ts` makes for `TWO_TARGETS`: a value that two readers resolve
 * differently is not a value. So it is refused, and a tenant who wants
 * everything says so with a recursive container pattern at the root.
 *
 * A DEAD EXCLUDE RULE is a rule somebody wrote to be safe that excludes nothing.
 * It reads on a review screen as protection that does not exist.
 *
 * A VERSION THAT DID NOT INCREASE is a scope change nobody can order. "Which
 * selection was live when that document was indexed" is the question an access
 * review asks, and two different selections carrying one version number cannot
 * answer it.
 *
 * ## Exclude always wins, stated once
 *
 * The precedence rule is here and nowhere else. A surface that re-derived it
 * would eventually derive it the other way round, and the direction it gets
 * wrong is the one where an excluded folder is indexed anyway.
 */

/** A resource inside the connected workspace, named the way the provider names it. */
export interface ResourcePattern {
  /**
   * A container (a folder, a channel, a space) or a single object.
   *
   * Load-bearing, not decoration: `recursive` only means anything on a
   * container, and an `object` pattern that matched a folder's children would
   * be a selection nobody wrote.
   */
  kind: "container" | "object"
  /** The provider's own id. Never a Tenure id — this is their namespace. */
  externalId: string
  /**
   * Whether a container carries its descendants with it.
   *
   * `false` selects the container itself and nothing inside it, which is a real
   * selection: "index this folder's metadata, not the thousand files in it".
   */
  recursive: boolean
}

export interface ResourceSelector {
  /**
   * Increases on every change. See the header — an unordered scope change
   * cannot answer "which selection was live when this was indexed".
   */
  version: number
  /** What is in scope. Refused when empty. */
  include: readonly ResourcePattern[]
  /** What is carved back out. Beats `include` wherever the two overlap. */
  exclude: readonly ResourcePattern[]
}

/**
 * A resource the platform already knows about — what a diff is computed over.
 *
 * `ancestors` is the container path from the root down to, and excluding, this
 * resource. Carried on the resource rather than looked up, because a diff that
 * had to resolve parents would need the whole tree in memory to answer a
 * question about four folders.
 */
export interface KnownResource {
  externalId: string
  kind: "container" | "object"
  ancestors: readonly string[]
}

export type SelectorReason =
  /** No include patterns. Means "everything" to one reader and "nothing" to another. */
  | "include-empty"
  /** An exclude rule no include pattern could ever have selected. */
  | "exclude-matches-nothing"
  /** A version that did not increase over the selection this one replaces. */
  | "version-not-increased"
  /** A version that is not a positive whole number, so nothing can be ordered by it. */
  | "version-invalid"
  /** A pattern naming no resource at all. */
  | "pattern-empty"

export interface SelectorProblem {
  field: string
  reason: SelectorReason
  detail: string
}

/**
 * Whether a pattern covers a resource.
 *
 * Two ways and only two: the pattern names it exactly, at the same kind, or the
 * pattern is a recursive container somewhere above it. `kind` has to match on
 * the exact case or an `object` pattern naming a folder id would quietly select
 * a folder, which is a selection nobody wrote.
 */
export function patternMatches(pattern: ResourcePattern, resource: KnownResource): boolean {
  if (pattern.kind === resource.kind && pattern.externalId === resource.externalId) return true
  return (
    pattern.kind === "container" &&
    pattern.recursive &&
    resource.ancestors.includes(pattern.externalId)
  )
}

/**
 * Whether a selector selects a resource. EXCLUDE ALWAYS WINS.
 *
 * The one implementation of the precedence rule — see the header. `some` on
 * exclude is evaluated after `some` on include and its result is what decides,
 * so an object matched by both is out.
 */
export function selectorSelects(selector: ResourceSelector, resource: KnownResource): boolean {
  const included = selector.include.some((p) => patternMatches(p, resource))
  const excluded = selector.exclude.some((p) => patternMatches(p, resource))
  return included && !excluded
}

export interface SelectorDiff {
  /** Selected by `next` and not by `previous`. Newly reachable. */
  added: readonly string[]
  /**
   * Selected by `previous` and not by `next`.
   *
   * This is the half the requirement exists for: "if I remove this folder from
   * the selection, which indexed objects and citations stop being reachable"
   * has to be answerable BEFORE somebody clicks Save.
   */
  removed: readonly string[]
  /** Selected by both. Not "in neither" — a resource nobody selected is not news. */
  unchanged: readonly string[]
}

/**
 * What changing a selection would do, over the resources the platform knows.
 *
 * `previous` may be `null` for the first selection ever made, which selects
 * nothing before and everything it names after — so every match is an addition
 * rather than the function having to invent a baseline.
 */
export function selectorDiff(
  previous: ResourceSelector | null,
  next: ResourceSelector,
  known: readonly KnownResource[],
): SelectorDiff {
  const added: string[] = []
  const removed: string[] = []
  const unchanged: string[] = []

  for (const resource of known) {
    const was = previous ? selectorSelects(previous, resource) : false
    const is = selectorSelects(next, resource)
    if (was && is) unchanged.push(resource.externalId)
    else if (!was && is) added.push(resource.externalId)
    else if (was && !is) removed.push(resource.externalId)
  }

  return { added, removed, unchanged }
}

/**
 * The universe a selector can be reasoned about with no catalogue of resources.
 *
 * Every id the selector itself names, with every recursive container include
 * treated as an ancestor of everything else it names. That assumption is
 * deliberately the pessimistic one for the dead-rule check below: a recursive
 * include COULD contain a folder nobody listed, so an exclude under it is live
 * even though no evidence here proves it. Assuming the other way would report a
 * legitimate sub-folder exclusion as dead, and a validator that deletes real
 * protections is worse than one that keeps a redundant rule.
 */
function namedUniverse(selector: ResourceSelector): readonly KnownResource[] {
  const recursiveRoots = selector.include
    .filter((p) => p.kind === "container" && p.recursive)
    .map((p) => p.externalId)

  return [...selector.include, ...selector.exclude].map((p) => ({
    externalId: p.externalId,
    kind: p.kind,
    ancestors: recursiveRoots.filter((root) => root !== p.externalId),
  }))
}

/**
 * What is wrong with a selection.
 *
 * `previous` is the selection this one replaces, when there is one. Absent means
 * a first selection, which cannot fail the version rule because there is nothing
 * for it to have failed to increase past.
 */
export function selectorProblems(
  selector: ResourceSelector,
  previous?: ResourceSelector,
): readonly SelectorProblem[] {
  const problems: SelectorProblem[] = []

  if (!Number.isInteger(selector.version) || selector.version < 1) {
    problems.push({
      field: "version",
      reason: "version-invalid",
      detail:
        `A selector version is a positive whole number and this one is ${selector.version}. ` +
        `Two selections nothing can order cannot answer "which one was live when this was ` +
        `indexed".`,
    })
  }

  if (selector.include.length === 0) {
    problems.push({
      field: "include",
      reason: "include-empty",
      detail:
        "An empty include set means everything to one reader and nothing to another, and both " +
        "readings ship. Select the root explicitly if everything is what was meant.",
    })
  }

  for (const [field, patterns] of [
    ["include", selector.include],
    ["exclude", selector.exclude],
  ] as const) {
    for (const pattern of patterns) {
      if (pattern.externalId.trim() === "") {
        problems.push({
          field,
          reason: "pattern-empty",
          detail: "A pattern that names no resource selects nothing and hides that it does.",
        })
      }
    }
  }

  // The dead-rule check, computed through `selectorDiff` rather than beside it.
  // An exclude rule is live exactly when deleting it would change the selection,
  // which is what a diff answers — so the gate and the impact preview a tenant
  // sees before clicking Save are the same function, and cannot disagree about
  // what an exclusion does.
  if (selector.exclude.length > 0 && selector.include.length > 0) {
    const universe = namedUniverse(selector)
    const withoutExcludes: ResourceSelector = { ...selector, exclude: [] }
    const live = new Set(selectorDiff(selector, withoutExcludes, universe).added)

    for (const pattern of selector.exclude) {
      if (live.has(pattern.externalId)) continue
      problems.push({
        field: "exclude",
        reason: "exclude-matches-nothing",
        detail:
          `Excluding ${pattern.externalId} removes nothing: no include pattern could ever have ` +
          `selected it. A rule somebody wrote to be safe, that reads on a review screen as ` +
          `protection which does not exist.`,
      })
    }
  }

  if (previous && selector.version <= previous.version) {
    problems.push({
      field: "version",
      reason: "version-not-increased",
      detail:
        `Version ${selector.version} does not increase on ${previous.version}. A scope change ` +
        `nobody can order cannot answer which selection was live when a document was indexed.`,
    })
  }

  return problems
}
