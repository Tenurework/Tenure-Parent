import {
  CHANGE_DOMAINS,
  CONTROL_PLANE_SCHEMA_VERSIONS,
  parseChangeDiff,
  type ChangeDiff,
  type ChangeDiffEntry,
  type ChangeDomain,
} from "@tenure/contracts"
import { domainOf, stableStringify, type ConfigRecord } from "@tenure/configuration"

/**
 * GE-032-003 — comparing and rolling back configuration revisions.
 *
 * The publication path (GE-031-006/007) can already plan, block and commit.
 * What an operator could not do afterwards was look at what happened: which
 * revisions exist, what changed between any two of them, and how to get back.
 *
 * ## Rolling back publishes forward
 *
 * A rollback here republishes an earlier revision's layers as a NEW revision.
 * It never rewinds the history, and that is not a technicality — the record of
 * what was live has to survive the decision to stop living with it. An incident
 * review asking "what was the configuration at 14:20" gets an answer either
 * way; only one of them is the truth.
 *
 * The consequence is visible in the UI and worth stating there too: rolling
 * back to revision 3 produces revision 7, not revision 3.
 */

export interface RevisionSummary {
  revision: number
  publishedBy: string
  publishedAt: string
  checksum: string
  /** What this revision could itself return to. Null for the first. */
  rollbackTo: number | null
  /** How many keys its plan changed, for a list an operator scans. */
  changed: number
}

export function summarise(records: readonly ConfigRecord[]): readonly RevisionSummary[] {
  return records.map((record) => ({
    revision: record.revision,
    publishedBy: record.publishedBy,
    publishedAt: record.publishedAt,
    checksum: record.checksum,
    rollbackTo: record.rollbackTo,
    changed: record.plan.impact.keysChanged + record.plan.impact.keysAdded + record.plan.impact.keysRemoved,
  }))
}

export type ChangeKind = "added" | "removed" | "changed"

export interface ValueDifference {
  key: string
  change: ChangeKind
  before?: unknown
  after?: unknown
}

/**
 * What differs between two revisions' resolved values.
 *
 * Deliberately compares RESOLVED values rather than layers. Two different layer
 * stacks can resolve to the same configuration, and an operator comparing
 * revisions is asking what the system does differently — not how the answer was
 * assembled. `provenance` on each record answers the second question.
 *
 * Key order is normalised through `stableStringify`, so a value reserialised by
 * a different writer does not read as a change.
 */
export function compareRevisions(before: ConfigRecord, after: ConfigRecord): readonly ValueDifference[] {
  const keys = [...new Set([...Object.keys(before.values), ...Object.keys(after.values)])].sort()
  const out: ValueDifference[] = []

  for (const key of keys) {
    const inBefore = key in before.values
    const inAfter = key in after.values

    if (inBefore && !inAfter) out.push({ key, change: "removed", before: before.values[key] })
    else if (!inBefore && inAfter) out.push({ key, change: "added", after: after.values[key] })
    else if (stableStringify(before.values[key]) !== stableStringify(after.values[key])) {
      out.push({ key, change: "changed", before: before.values[key], after: after.values[key] })
    }
  }
  return out
}

/**
 * STUDIO-060-003 — the same comparison as a `ChangeDiff` document.
 *
 * The machine-readable form is the PRIMARY one and the string below is derived
 * from it, rather than the other way round. That ordering is the whole decision:
 * two renderings computed independently from the same inputs disagree the first
 * time one of them is changed, and the one nobody validates is always the one on
 * the screen.
 *
 * `reversible` is true for every entry here and that is a fact about
 * configuration rather than an optimism: a rollback in this product republishes
 * an earlier revision's layers as a NEW revision, so any value can be put back.
 * `monthlyCostDeltaMinor` is `null` — not zero. Nothing prices a configuration
 * key today, and "we did not compute this" must not reach an approval threshold
 * as "this is free".
 */
/**
 * Which change domain a configuration key belongs to.
 *
 * Answered by the configuration engine's OWN domain table (`domainOf`), not by
 * a prefix list kept here. The table is what already governs who may write the
 * key and whether a tenant administrator may touch it, so a second list would
 * be a second opinion about what `platform.relay.` means — and the one that
 * decides what an approver SEES is the one nobody validates.
 *
 * Only `relay` is lifted out today, because it is the only governed domain
 * outside plain application configuration that has a definition:
 * `platform.relay.modelTokenBudgetPerMonth`, the per-tenant model-spend ceiling
 * enforced at `apps/web/src/app/api/ai/chat/route.ts`. Raising it is a Relay
 * change with a bill attached, and reading it as "some app setting moved" is
 * exactly the mistake the domain split exists to prevent.
 *
 * `platform.entities.` (data/schema), `platform.permissions.` and
 * `platform.identity.` (IAM), `platform.connectors.` (integrations),
 * `platform.deployment.` (domains/placement) and `platform.observability.`
 * (operations) are all RESERVED in the same table — declared, governed, and
 * carrying no definition yet. They are deliberately NOT mapped: a branch that
 * can never be taken is a domain the enum would advertise and nothing would
 * ever emit.
 */
export function changeDomainForKey(key: string): ChangeDomain {
  return domainOf(key)?.id === "relay" ? "relay" : "app-config"
}

export function configurationChangeDiff(before: ConfigRecord, after: ConfigRecord): ChangeDiff {
  const entries: ChangeDiffEntry[] = compareRevisions(before, after).map((d) => ({
    domain: changeDomainForKey(d.key),
    path: d.key,
    before: d.change === "added" ? null : (d.before ?? null),
    after: d.change === "removed" ? null : (d.after ?? null),
    effect: d.change === "added" ? ("create" as const) : d.change === "removed" ? ("delete" as const) : ("update" as const),
    reversible: true,
    monthlyCostDeltaMinor: null,
  }))

  return parseChangeDiff({ schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS.ChangeDiff, entries })
}

/**
 * STUDIO-060-003 — the rollback arm: what returning to an earlier revision
 * would actually change.
 *
 * A different question from `configurationChangeDiff`, and the one asked under
 * pressure. That one answers "what did the last publication do"; this answers
 * "what would undoing it do", and until now the console asked an operator to
 * pick a revision from a dropdown and press a button with no statement of the
 * consequence anywhere on the page.
 *
 * The direction is `live → target`, deliberately. An operator reading this is
 * about to move the system, so `before` is what is running now and `after` is
 * what would be running afterwards. Computing it the other way round produces
 * the same set of keys with every arrow reversed, which is the kind of mistake
 * nobody catches by reading.
 *
 * Every entry is `reversible: true`, and that is a fact rather than optimism —
 * a rollback here republishes the target's values as a NEW revision and leaves
 * the history intact, so the state being left behind is still on the record and
 * can be published again in turn. `parseChangeDiff` enforces exactly this, so a
 * future producer that marked a rollback irreversible would be refused rather
 * than rendered.
 */
export function rollbackChangeDiff(live: ConfigRecord, target: ConfigRecord): ChangeDiff {
  const entries: ChangeDiffEntry[] = compareRevisions(live, target).map((d) => ({
    domain: "rollback" as const,
    path: d.key,
    before: d.change === "added" ? null : (d.before ?? null),
    after: d.change === "removed" ? null : (d.after ?? null),
    effect: d.change === "added" ? ("create" as const) : d.change === "removed" ? ("delete" as const) : ("update" as const),
    reversible: true,
    // Nothing prices a configuration key, and a rollback is not an estate
    // change. `null` rather than `0`: "not computed" must not reach an approval
    // threshold as "free".
    monthlyCostDeltaMinor: null,
  }))

  return parseChangeDiff({ schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS.ChangeDiff, entries })
}

/**
 * The one sentence a rollback control puts beside its target.
 *
 * Derived from the document above rather than counted separately, for the same
 * reason `renderComparison` is: a count computed beside a diff is a count that
 * disagrees with it the first time either changes.
 */
export function rollbackSummary(diff: ChangeDiff, targetRevision: number): string {
  if (diff.entries.length === 0) {
    return `Revision ${targetRevision} resolves to exactly what is live. Rolling back would change nothing.`
  }
  const n = diff.entries.length
  return `Rolling back to revision ${targetRevision} changes ${n} ${n === 1 ? "key" : "keys"}.`
}

/** How each domain's entries are introduced, in the order an operator reads them. */
const DOMAIN_HEADINGS: Readonly<Record<(typeof CHANGE_DOMAINS)[number], string>> = {
  "app-config": "Configuration",
  relay: "Relay",
  "aws-resource": "AWS resources",
  cost: "Cost",
  rollback: "Rollback",
}

/**
 * The human rendering, derived from the document.
 *
 * The configuration lines keep the publication plan's exact notation (`+`, `-`,
 * `~`), because two diffs in one console that disagree about notation is one an
 * operator has to translate between. The AWS and cost lines are new and say the
 * two things a sentence about a resource must never omit: whether it can be
 * undone, and what it costs a month.
 *
 * There is no arm for the five domains this product does not compute. An
 * "Integrations: no changes" heading is a claim about the change; silence is a
 * claim about the product, and only one of them is true.
 *
 * The heading only appears when more than one domain is present, so a
 * single-domain diff — which every configuration comparison is — reads as the
 * bare list it always did.
 */
export function renderComparison(diff: ChangeDiff): string {
  if (diff.entries.length === 0) return "These revisions resolve to the same configuration."

  const lines: string[] = []
  for (const domain of CHANGE_DOMAINS) {
    const entries = diff.entries.filter((e) => e.domain === domain)
    if (entries.length === 0) continue
    if (diff.entries.length !== entries.length) lines.push(`${DOMAIN_HEADINGS[domain]}:`)
    for (const entry of entries) lines.push(renderEntry(entry))
  }
  return lines.join("\n")
}

function renderEntry(entry: ChangeDiffEntry): string {
  const cost =
    entry.monthlyCostDeltaMinor === null
      ? ""
      : `  [${entry.monthlyCostDeltaMinor >= 0 ? "+" : "-"}$${(Math.abs(entry.monthlyCostDeltaMinor) / 100).toFixed(2)}/month]`
  // Stated on every irreversible entry and on no other. An operator scanning
  // this must not have to know which AWS resources hold data.
  const undo = entry.reversible ? "" : "  IRREVERSIBLE"

  switch (entry.effect) {
    case "create":
      return `+ ${entry.path} = ${stableStringify(entry.after)}${cost}${undo}`
    case "delete":
      return `- ${entry.path}  (was ${stableStringify(entry.before)})${cost}${undo}`
    case "replace":
      return `! ${entry.path}: ${stableStringify(entry.before)} -> ${stableStringify(entry.after)}${cost}${undo}`
    default:
      return `~ ${entry.path}: ${stableStringify(entry.before)} -> ${stableStringify(entry.after)}${cost}${undo}`
  }
}

export interface DependencyEdge {
  from: string
  to: string
}

export interface DependencyGraph {
  nodes: readonly string[]
  edges: readonly DependencyEdge[]
  /** Modules nothing depends on — the roots an operator can disable freely. */
  roots: readonly string[]
  /** Modules with no dependencies of their own. */
  leaves: readonly string[]
}

/**
 * The module dependency graph, as data.
 *
 * Rendered as a list rather than a canvas, on purpose: a `<canvas>` graph has
 * no keyboard path, no screen-reader text, no selectable labels and nothing the
 * layout suite can measure. Bible §26.4 requires an equivalent non-pointer path
 * for every graph view, and for a graph this small the accessible rendering is
 * simply the better one.
 */
export interface GraphModule {
  key: string
  /**
   * `dependsOn` gained a version range, a kind and the ability to name a
   * CAPABILITY rather than a module key (PACK-010-002, PACK-030-003).
   */
  dependsOn?: readonly { module: string }[]
  provides?: readonly string[]
}

/**
 * Every module that could satisfy a dependency target: the key itself, or every
 * module declaring it in `provides`.
 *
 * Resolving here rather than drawing the capability as a node is what keeps the
 * blast radius true. `reimbursements` depends on `finance.ledger` and
 * `budgeting` provides it — an unresolved edge would draw a node nobody can
 * disable and would answer "what breaks if budgeting goes?" with silence.
 */
function satisfiers(modules: readonly GraphModule[], target: string): string[] {
  if (modules.some((m) => m.key === target)) return [target]
  return modules.filter((m) => (m.provides ?? []).includes(target)).map((m) => m.key)
}

export function dependencyGraph(modules: readonly GraphModule[]): DependencyGraph {
  const nodes = modules.map((m) => m.key).sort()
  const edges = modules
    .flatMap((m) =>
      (m.dependsOn ?? []).flatMap((dependency) =>
        satisfiers(modules, dependency.module).map((to) => ({ from: m.key, to })),
      ),
    )
    .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)))

  const dependedUpon = new Set(edges.map((e) => e.to))
  const hasDependencies = new Set(edges.map((e) => e.from))

  return {
    nodes,
    edges,
    roots: nodes.filter((n) => !dependedUpon.has(n)),
    leaves: nodes.filter((n) => !hasDependencies.has(n)),
  }
}

/**
 * Everything that would break if a module were disabled.
 *
 * Transitive, because disabling `organizations` breaks `feed`, and whatever
 * depends on `feed`. A list that stopped at the direct dependants would
 * under-report exactly when the blast radius matters most.
 */
export function dependantsOf(
  modules: readonly GraphModule[],
  moduleKey: string,
): readonly string[] {
  const direct = new Map<string, string[]>()
  for (const module of modules) {
    for (const dependency of module.dependsOn ?? []) {
      for (const satisfier of satisfiers(modules, dependency.module)) {
        direct.set(satisfier, [...(direct.get(satisfier) ?? []), module.key])
      }
    }
  }

  const found = new Set<string>()
  const queue = [moduleKey]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const dependant of direct.get(current) ?? []) {
      if (found.has(dependant)) continue
      found.add(dependant)
      queue.push(dependant)
    }
  }
  return [...found].sort()
}
