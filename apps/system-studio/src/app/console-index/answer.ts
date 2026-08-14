/**
 * The console index's one question, as a function.
 *
 * `/` asks: **what systems are configured, and is each one where it should be?**
 * "Where it should be" is not one fact. It is the agreement between three
 * records that are written in three different places and can disagree in six
 * different ways:
 *
 *   1. the **binding** — compiled into this build, from `blueprints/`;
 *   2. the **registry** — a DynamoDB record the control plane owns, which says
 *      what lifecycle state the system is in and whether a deployment artifact
 *      was ever published for it;
 *   3. the **estate** — what AWS actually holds, read live.
 *
 * The verdict lives here rather than inside `page.tsx` for one reason: the
 * failure this module exists to prevent is not a rendering bug. It is a page
 * that reports "all systems are where they should be" because a read was
 * refused and the refusal was folded into the healthy count. That is a decision,
 * it is expressible as a pure function of three inputs, and a pure function can
 * be mutated and proven to fail. A `<Badge>` cannot.
 *
 * Nothing here imports AWS, Next or React. The two type-only imports are erased
 * at compile time, so this file can be unit-tested from `apps/web`'s jest with
 * no credentials, no table and no DOM.
 *
 * ## The rule the whole file turns on
 *
 * **A system whose state could not be read is a system in the count.** It is
 * never dropped, never folded into "agrees", and never rendered as a zero. Four
 * of the six verdicts below exist only because collapsing them into two would
 * make one of them silent — `unregistered` and `unknown` in particular are the
 * pair a console gets wrong: "the registry holds no record of this system" and
 * "the registry could not be asked" look identical from the outside and have
 * opposite next actions.
 */

import type { DriftItem, DriftReport, DriftSeverity } from "../../lib/aws/drift"
import type { AwsRead } from "../../lib/aws/read"
import type { UnknownRead } from "../../components/md3/UnknownState"

/**
 * The word this console uses when it does not know, and the only one.
 *
 * Never an empty cell, never a dash, never a plausible default. Exported so
 * `page.tsx` and this module cannot spell it two ways.
 */
export const UNKNOWN = "UNKNOWN"

/* ------------------------------------------------------------- inputs -- */

/** What the registry holds about one configured system. Never inferred. */
export interface RegistryFacts {
  /** The lifecycle state, in the lifecycle's own vocabulary. */
  state: string
  isolation: string
  /** Whether a signed deployment artifact exists. Read, never assumed. */
  hasDeployment: boolean
  /** Whether that artifact routes traffic at this system. */
  serving: boolean
  cellId: string | null
  region: string | null
}

/**
 * The registry's answer for one slug.
 *
 * Three states, not two. `known: true, record: null` is "the registry answered
 * and holds nothing for this binding" — a real, actionable finding, because a
 * binding compiled into the build that the control plane has never registered
 * is a system nobody can advance, suspend or deploy. `known: false` is "the
 * registry could not be asked", which is not a finding about the system at all.
 */
export type RegistryAnswer =
  | { known: true; record: RegistryFacts | null }
  | { known: false; because: string; fix: string }

/**
 * The estate half.
 *
 * `compared: false` carries WHY no comparison was made, and that covers two
 * genuinely different cases which the sentence has to tell apart: the estate
 * could not be read, and there was nothing to compare it against. Both are
 * honest; neither may render as agreement.
 */
export type FootprintAnswer =
  | { compared: true; report: DriftReport }
  | { compared: false; because: string }

export interface PlacementInput {
  slug: string
  displayName: string
  /** Resolved from the binding's `blueprintId`, or null when that id names nothing. */
  blueprint: { id: string; version: string } | null
  /** Where this system is served from, when the cell registry could say. */
  baseUrl: string | null
  registry: RegistryAnswer
  footprint: FootprintAnswer
}

/* ------------------------------------------------------------ verdicts -- */

export type PlacementVerdict =
  /** Every resource the registry says should exist was read and found. */
  | "agrees"
  /** At least one was read and is not there. A finding, with an owner. */
  | "drifted"
  /** Registered, no published deployment — nothing is expected in AWS yet. */
  | "awaiting-deployment"
  /** Compiled into this build; the registry holds no record of it. */
  | "unregistered"
  /** Something could not be read. Not a verdict about the system. */
  | "unknown"
  /** The binding names a blueprint that does not exist. */
  | "broken"

/** The word each verdict wears, and the tone it carries. */
export const VERDICT_WORD: Readonly<Record<PlacementVerdict, string>> = {
  agrees: "where it should be",
  drifted: "not where it should be",
  "awaiting-deployment": "not deployed",
  unregistered: "not registered",
  unknown: UNKNOWN,
  broken: "broken",
}

export const VERDICT_TONE: Readonly<Record<PlacementVerdict, "ok" | "warn" | "bad" | "neutral">> = {
  agrees: "ok",
  drifted: "bad",
  "awaiting-deployment": "neutral",
  unregistered: "warn",
  unknown: "warn",
  broken: "bad",
}

/** One resource the registry expected and the estate does not hold. */
export interface Disagreement {
  resourceKey: string
  severity: DriftSeverity
  owner: string
  detail: string
}

export interface SystemPlacement {
  slug: string
  displayName: string
  verdict: PlacementVerdict
  /**
   * One sentence saying what the verdict means for THIS system, always present.
   *
   * A status word on its own sends an operator nowhere — the same defect the
   * catalog's refusal rows were fixed for.
   */
  because: string
  /** The lifecycle state, or `UNKNOWN`. Never blank, never a dash. */
  lifecycle: string
  /** Why the lifecycle is not a state. Empty exactly when it is one. */
  lifecycleBecause: string
  /** `<id> v<version>`, or `UNKNOWN`. */
  blueprint: string
  blueprintBecause: string
  /** The address this system is served at, or `UNKNOWN`. */
  url: string
  urlBecause: string
  /** The estate sentence, always present. */
  footprint: string
  /** Resources expected and not found. Empty unless the verdict is `drifted`. */
  disagreements: readonly Disagreement[]
  /**
   * True when SOME estate surface could not be read while others could.
   *
   * Carried beside `drifted` rather than collapsing into `unknown`, because a
   * confirmed missing database is worth reporting even though the certificate
   * read was refused — and hiding it behind the refusal is how a real outage
   * waits for an IAM ticket.
   */
  partial: boolean
}

/* ------------------------------------------------------- the decision -- */

/**
 * Is this one system where it should be?
 *
 * Ordered so that the least knowable thing wins. A blueprint that does not
 * resolve makes every fact below it meaningless; a registry that could not be
 * read makes the estate comparison meaningless, because the estate is only
 * interesting relative to what the registry said should be there.
 */
export function placementOf(input: PlacementInput): SystemPlacement {
  const url = input.baseUrl ? `${trimSlash(input.baseUrl)}/${input.slug}` : UNKNOWN
  const urlBecause = input.baseUrl
    ? ""
    : "The cell registry could not say what base address serves this system. Set CELL_BASE_URL, " +
      "or give this engine sts:GetCallerIdentity so it can resolve its own estate."

  const blueprint = input.blueprint ? `${input.blueprint.id} v${input.blueprint.version}` : UNKNOWN

  const base = {
    slug: input.slug,
    displayName: input.displayName,
    url,
    urlBecause,
    blueprint,
    blueprintBecause: "",
    disagreements: [] as readonly Disagreement[],
    partial: false,
  }

  if (!input.blueprint) {
    return {
      ...base,
      verdict: "broken",
      because:
        "This binding names a blueprint that does not exist in this build, so nothing about the " +
        "system it should produce could be worked out. Nothing below it was checked.",
      lifecycle: UNKNOWN,
      lifecycleBecause:
        "The blueprint did not resolve, so the registry was not asked about a system this build " +
        "cannot describe.",
      blueprintBecause: "The binding's blueprintId names nothing this build carries.",
      footprint: "Not compared — there is no resolved system to compare AWS against.",
    }
  }

  if (!input.registry.known) {
    return {
      ...base,
      verdict: "unknown",
      because: `The registry could not be read, so this system's state is ${UNKNOWN}. It is counted here rather than dropped: a system nobody can read is not a system that is fine.`,
      lifecycle: UNKNOWN,
      lifecycleBecause: `${input.registry.because} ${input.registry.fix}`,
      footprint: `Not compared — the registry could not say what should exist, so AWS was not asked. An estate read with nothing to compare it against would report every resource as unmanaged.`,
    }
  }

  const record = input.registry.record
  if (record === null) {
    return {
      ...base,
      verdict: "unregistered",
      because:
        "This system is compiled into this build and the registry holds no record of it. It " +
        "cannot be advanced, suspended or deployed until it is registered or adopted.",
      lifecycle: "not registered",
      lifecycleBecause:
        "The registry answered and returned no row for this slug. That is an answer, not a " +
        "failed read — the system has never been registered or adopted.",
      footprint:
        "Not compared — the registry declares nothing for this system, so there is nothing AWS " +
        "could be checked against.",
    }
  }

  const lifecycle = record.state || UNKNOWN
  const lifecycleBecause = record.state
    ? ""
    : "The registry row carries no state. A row with no lifecycle is a malformed record, not a " +
      "system at rest."

  if (!record.hasDeployment) {
    return {
      ...base,
      verdict: "awaiting-deployment",
      lifecycle,
      lifecycleBecause,
      because:
        "The registry holds this system but no signed deployment artifact was ever published " +
        "for it, so nothing is expected to exist in AWS yet.",
      footprint:
        "Not compared — no deployment artifact declares what should exist. AWS was not asked, " +
        "and an empty answer here would be a claim rather than a reading.",
    }
  }

  if (!input.footprint.compared) {
    return {
      ...base,
      verdict: "unknown",
      lifecycle,
      lifecycleBecause,
      because: `This system has a published deployment, and whether AWS matches it is ${UNKNOWN}.`,
      footprint: input.footprint.because,
    }
  }

  const report = input.footprint.report
  const disagreements = report.items
    .filter((item) => item.severity !== "unknown")
    .map(toDisagreement)
  const blind = report.items.filter((item) => item.severity === "unknown")

  if (disagreements.length > 0) {
    return {
      ...base,
      verdict: "drifted",
      lifecycle,
      lifecycleBecause,
      disagreements,
      partial: report.partial,
      because: `${countOf(disagreements.length, "resource")} the published deployment declares ${disagreements.length === 1 ? "was" : "were"} not found in AWS.`,
      footprint: footprintSentence(report, disagreements.length, blind.length),
    }
  }

  if (blind.length > 0 || report.partial) {
    return {
      ...base,
      verdict: "unknown",
      lifecycle,
      lifecycleBecause,
      partial: true,
      because: `Whether this system's AWS footprint matches its deployment is ${UNKNOWN}: at least one estate read did not answer.`,
      footprint: footprintSentence(report, 0, blind.length),
    }
  }

  return {
    ...base,
    verdict: "agrees",
    lifecycle,
    lifecycleBecause,
    because:
      "Every resource the published deployment declares was read in AWS and found. The registry " +
      "and the estate agree.",
    footprint: footprintSentence(report, 0, 0),
  }
}

function toDisagreement(item: DriftItem): Disagreement {
  return {
    resourceKey: item.resourceKey,
    severity: item.severity,
    owner: item.owner,
    detail: item.desired.detail,
  }
}

/**
 * What the estate reading found, in one sentence that always says how much of
 * it was actually read.
 *
 * The blind count is never omitted when it is non-zero. "0 missing" over an
 * estate half of which was refused is the reassuring default this console
 * exists to refuse.
 */
function footprintSentence(report: DriftReport, missing: number, blind: number): string {
  const parts: string[] = []
  parts.push(
    missing === 0
      ? "Every declared resource was found in AWS"
      : `${countOf(missing, "declared resource")} not found in AWS`,
  )
  if (blind > 0) {
    parts.push(
      `${countOf(blind, "further resource")} could not be checked at all, because the surface that would answer for ${blind === 1 ? "it" : "them"} did not answer`,
    )
  }
  return `${parts.join("; ")}. Read at ${report.asOf}.`
}

/* --------------------------------------------------------- the answer -- */

export interface FleetAnswer {
  /** The one line that leads the page, in words, before any apparatus. */
  sentence: string
  tone: "ok" | "warn" | "bad"
  counts: Readonly<Record<PlacementVerdict, number>>
  total: number
}

/** The order the exceptions are read out in: worst first, unknown never last. */
const REPORT_ORDER: readonly PlacementVerdict[] = [
  "broken",
  "drifted",
  "unknown",
  "unregistered",
  "awaiting-deployment",
  "agrees",
]

const REPORT_PHRASE: Readonly<Record<PlacementVerdict, (n: number) => string>> = {
  broken: (n) => `${n} ${n === 1 ? "names a blueprint" : "name blueprints"} this build does not carry`,
  drifted: (n) => `${n} ${n === 1 ? "does" : "do"} not match what the registry says should exist in AWS`,
  unknown: (n) => `${n} could not be read, and ${n === 1 ? "is" : "are"} counted as ${UNKNOWN} rather than assumed well`,
  unregistered: (n) => `${n} ${n === 1 ? "is" : "are"} not in the registry at all`,
  "awaiting-deployment": (n) => `${n} ${n === 1 ? "has" : "have"} no published deployment yet`,
  agrees: (n) => `${n} ${n === 1 ? "is" : "are"} where the registry says ${n === 1 ? "it" : "they"} should be`,
}

/**
 * The state of the fleet, in one line.
 *
 * Every configured system is in exactly one bucket and every non-zero bucket is
 * named, so the sentence's numbers add up to the total by construction. A
 * sentence that mentioned only the good news would be true and useless, and one
 * that dropped the unreadable systems would be neither.
 */
export function fleetAnswer(placements: readonly SystemPlacement[]): FleetAnswer {
  const counts: Record<PlacementVerdict, number> = {
    agrees: 0,
    drifted: 0,
    "awaiting-deployment": 0,
    unregistered: 0,
    unknown: 0,
    broken: 0,
  }
  for (const placement of placements) counts[placement.verdict] += 1
  const total = placements.length

  if (total === 0) {
    return {
      sentence:
        "No organization system is configured in this build. That is not a filtered view — there " +
        "are no customer bindings at all.",
      tone: "warn",
      counts,
      total,
    }
  }

  if (counts.agrees === total) {
    return {
      sentence: `All ${total} configured ${total === 1 ? "system is" : "systems are"} where the registry says ${total === 1 ? "it" : "they"} should be.`,
      tone: "ok",
      counts,
      total,
    }
  }

  const parts = REPORT_ORDER.filter((verdict) => counts[verdict] > 0).map((verdict) =>
    REPORT_PHRASE[verdict](counts[verdict]),
  )

  return {
    sentence: `Of ${total} configured ${total === 1 ? "system" : "systems"}: ${parts.join("; ")}.`,
    tone: counts.broken > 0 || counts.drifted > 0 ? "bad" : "warn",
    counts,
    total,
  }
}

/* -------------------------------------------- the reads that did not -- */

/** One AWS surface this page read, with the operator's name for it. */
export interface NamedRead {
  what: string
  read: AwsRead<unknown>
}

export interface UnknownSurfaceGroup {
  /** The surfaces this one refusal covers, joined — "ECS services and databases". */
  what: string
  read: UnknownRead
}

/**
 * The four arms that carry no value, as a predicate the compiler checks.
 *
 * Written against the real union rather than as a set of strings so that a
 * fifth valueless arm added to `AwsRead` fails to narrow here rather than
 * quietly falling through to "this one read fine".
 */
function isValueless(read: AwsRead<unknown>): read is UnknownRead {
  return (
    read.state === "DENIED" ||
    read.state === "THROTTLED" ||
    read.state === "UNCONFIGURED" ||
    read.state === "ERROR"
  )
}

/** What makes two refusals the same refusal: the arm, the action, the code. */
function reasonKey(read: UnknownRead): string {
  switch (read.state) {
    case "DENIED":
      return `DENIED|${read.action}|${read.errorCode}`
    case "THROTTLED":
      return `THROTTLED|${read.capability}`
    case "UNCONFIGURED":
      return `UNCONFIGURED|${read.why}`
    case "ERROR":
      return `ERROR|${read.code}|${read.safeDetail}`
  }
}

/**
 * The refusals worth rendering, deduplicated by the reason they happened.
 *
 * A task role with no credentials fails all four estate surfaces with the same
 * `UnrecognizedClientException`, and four identical panels each carrying the
 * same pasteable IAM statement is four times the height and none of the extra
 * information. Grouping by the REASON keeps every surface named — the group's
 * `what` lists them all — while the remedy is rendered once.
 *
 * A surface that read fine is not in the result. A surface that read EMPTY is
 * not either: EMPTY is an answer, and rendering it as a refusal would be the
 * same confusion in the opposite direction.
 */
export function unknownSurfaces(named: readonly NamedRead[]): readonly UnknownSurfaceGroup[] {
  const groups = new Map<string, { surfaces: string[]; read: UnknownRead }>()
  for (const entry of named) {
    if (!isValueless(entry.read)) continue
    const key = reasonKey(entry.read)
    const existing = groups.get(key)
    if (existing) existing.surfaces.push(entry.what)
    else groups.set(key, { surfaces: [entry.what], read: entry.read })
  }
  return [...groups.values()].map((group) => ({
    what: joinList(group.surfaces),
    read: group.read,
  }))
}

/* ------------------------------------------------------------ writing -- */

function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

function joinList(items: readonly string[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}
