import type { ChangeClass, ChangeOperation, TenantState } from "@tenure/provisioning"

import { dependantsOf, type GraphModule } from "../revisions"
import type { TenantUsers } from "./tenant-users"
import type { Reading } from "../../app/tenants/[slug]/summary"

/**
 * STUDIO-060-004 — what a change actually reaches, on all twelve axes the
 * requirement names.
 *
 * > "Calculate blast radius: tenants, users, seats, workflows, modules,
 * >  records, resources, regions, integrations, SLOs, downtime, and downstream
 * >  releases."
 *
 * ## What existed, and why it was not this
 *
 * `dependantsOf` in `../revisions` already walked the module graph transitively
 * and the tenant page already rendered the estate footprint. One axis of twelve
 * had a producer, and the other eleven had nothing — so an operator about to
 * suspend a tenant could see which modules break and could not see that the
 * tenant shares a cell with nine others, that its plan entitles 250 seats, that
 * two process chains cross the module being disabled, or that the move ends
 * service. This calls the existing walk rather than repeating it; the module
 * axis below is `dependantsOf` with the affected keys unioned in.
 *
 * ## The reading, not a number
 *
 * Every axis is a `Reading`, the console's own union for "a fact, or the reason
 * there isn't one" (`app/tenants/[slug]/summary.ts`). A blast radius is the
 * one report where `0` and "we could not look" must never collapse: an operator
 * reading `tenants: 0` proceeds, and an operator reading "the cell registry
 * refused" does not. `Reading` is imported as a TYPE rather than redefined —
 * a second union with the same shape is two vocabularies for one fact.
 *
 * ## Where an axis is derived from another, and the axis fails with it
 *
 * `regions` could be answered partially — the manifest names one region and the
 * cell registry names another, both known even when the estate read fails. It
 * is reported UNREADABLE anyway when the estate could not be enumerated,
 * because a blast radius that UNDERSTATES is the dangerous direction: "two
 * regions" read as complete is a confident wrong answer, and "we could not
 * enumerate the estate" is not. The same rule makes `tenants` and
 * `downstreamReleases` fail with the cell reading they come from.
 *
 * ## The axis this file used to refuse to count
 *
 * `users` was a `push(unreadable(...))` with no input behind it and no field on
 * `BlastInput` a caller could have filled — a constant return for a named axis,
 * justified on the grounds that "this control plane holds no user table". It
 * holds no user ROWS, which is a different statement: `lib/aws/cognito.ts`
 * already reads `EstimatedNumberOfUsers` for every pool and already resolves a
 * pool to a tenant from its tags. `../change/tenant-users` does that
 * derivation, and this file now takes its `Reading` like every other axis. A
 * count is not a person, so nothing about `no-personal-data` changes.
 *
 * Nothing here reads a clock, a network or an environment variable. Every
 * input is passed in, so the report a test renders is the report the page
 * renders.
 */

/** The twelve axes, in the requirement's own order. */
export const BLAST_DIMENSIONS = [
  "tenants",
  "users",
  "seats",
  "workflows",
  "modules",
  "records",
  "resources",
  "regions",
  "integrations",
  "slos",
  "downtime",
  "downstreamReleases",
] as const

export type BlastDimension = (typeof BLAST_DIMENSIONS)[number]

/**
 * A measured axis.
 *
 * `items` may be shorter than `count` — the cell registry knows how many
 * tenants a cell holds and does not list them — and when it is, `itemsWithheld`
 * says why. It is never null in that case, which `blastRadiusProblems` checks:
 * a list silently shorter than its own count is how a report is read as an
 * enumeration when it is a total.
 */
export interface BlastCount {
  count: number
  /** What the number counts, in words an operator can hold to. */
  unit: string
  items: readonly string[]
  itemsWithheld: string | null
}

export interface BlastMeasure {
  dimension: BlastDimension
  reading: Reading<BlastCount>
}

export interface BlastRadius {
  slug: string
  /** The change this was calculated for, restated so a stored report is self-describing. */
  change: { surface: string; action: string; target: string; changeClass: ChangeClass }
  measures: readonly BlastMeasure[]
  /** Axes that answered. */
  measured: readonly BlastDimension[]
  /** Axes that could not be looked at, which is not the same as axes that are zero. */
  unreadable: readonly BlastDimension[]
}

/** A module, as much of one as the blast radius needs. */
export interface BlastModule extends GraphModule {
  /** Object classes the module governs. `objects` on `ModuleManifest`. */
  objects?: readonly string[]
  /** Service objectives the module is held to. `slo` on `ModuleManifest`. */
  slo?: readonly { objective: string }[]
}

/** A cross-module process, from `PROCESS_CHAINS`. */
export interface BlastChain {
  chainId: string
  steps: readonly { module: string }[]
}

/** The cell a tenant sits on, as much of one as the blast radius needs. */
export interface BlastCell {
  cellId: string
  region: string
  release: string
  capacity: { tenants: number }
}

export interface BlastInput {
  slug: string
  /** Where the tenant is now. Decides whether a move interrupts service. */
  currentState: TenantState
  /** The change, already classified by `@tenure/provisioning`. */
  operation: ChangeOperation
  changeClass: ChangeClass
  /** Module keys this change adds, removes or reconfigures. Empty for a pure lifecycle move. */
  changedModules: readonly string[]
  /** The catalogue, for the dependency walk. */
  modules: readonly BlastModule[]
  /** The declared cross-module processes. */
  chains: readonly BlastChain[]
  /** The cell this tenant is placed on, `null` for a tenant with no placement yet. */
  cell: Reading<BlastCell | null>
  /**
   * People in the identity stores attributed to this tenant, from
   * `../change/tenant-users`. Unreadable rather than zero whenever any of a
   * tenant's pools did not answer — see that module.
   */
  users: Reading<TenantUsers>
  /** Seats the tenant's plan entitles. `null` means the plan says unlimited. */
  seats: Reading<number | null>
  /** Estate resources attributed to this tenant. */
  resources: Reading<readonly { handle: string; region: string }[]>
  /** Business domains an external system owns for this tenant. */
  externalDomains: readonly string[]
  /** The region the manifest asks for. */
  region: string
}

/** Tenant states in which somebody is being served. Leaving one is an interruption. */
const SERVING_STATES: ReadonlySet<TenantState> = new Set<TenantState>([
  "ACTIVE",
  "IDLE",
  "READY",
])

const known = (count: BlastCount): Reading<BlastCount> => ({ known: true, value: count })

/**
 * Carry a failed reading forward onto an axis derived from it.
 *
 * The wording is the source reading's own, prefixed with the axis that cannot
 * be answered because of it — so an operator is sent to the one thing to fix
 * rather than to four separate mysteries.
 */
function derivedFailure(source: Reading<unknown>, axis: string): Reading<BlastCount> {
  if (source.known) throw new Error("derivedFailure called on a reading that answered")
  return { known: false, because: `${axis} is derived from a read that failed: ${source.because}`, fix: source.fix }
}

/** Every module the change reaches: the ones it touches, and everything downstream of them. */
export function affectedModules(input: BlastInput): readonly string[] {
  const reached = new Set<string>(input.changedModules)
  for (const key of input.changedModules) {
    for (const dependant of dependantsOf(input.modules, key)) reached.add(dependant)
  }
  return [...reached].sort()
}

export function blastRadius(input: BlastInput): BlastRadius {
  const reached = affectedModules(input)
  const reachedSet = new Set(reached)
  const catalogue = new Map(input.modules.map((m) => [m.key, m]))

  const measures: BlastMeasure[] = []
  const push = (dimension: BlastDimension, reading: Reading<BlastCount>) =>
    measures.push({ dimension, reading })

  // ── tenants ──────────────────────────────────────────────────────────────
  //
  // The tenant itself, plus everyone else on its cell. A configuration change
  // is scoped to one tenant and still runs on shared infrastructure; a cell at
  // nine tenants is nine bystanders to a bad deploy.
  if (!input.cell.known) {
    push("tenants", derivedFailure(input.cell, "the set of tenants reached"))
  } else if (input.cell.value === null) {
    push(
      "tenants",
      known({
        count: 1,
        unit: "tenants — this one only; it has no cell placement, so it shares nothing",
        items: [input.slug],
        itemsWithheld: null,
      }),
    )
  } else {
    const cell = input.cell.value
    const others = Math.max(cell.capacity.tenants - 1, 0)
    push(
      "tenants",
      known({
        count: 1 + others,
        unit: `tenants on cell ${cell.cellId}`,
        items: [input.slug],
        itemsWithheld:
          others === 0
            ? null
            : `${others} co-tenant(s) on ${cell.cellId} are counted and not named — the cell registry records how many tenants a cell holds, not which`,
      }),
    )
  }

  // ── users ────────────────────────────────────────────────────────────────
  //
  // The reading is `tenantUsers`'s, carried through unchanged — its refusals
  // already name the pool that did not answer and the read that would fix it,
  // and restating them here would be a second vocabulary for one fact.
  if (!input.users.known) {
    push("users", input.users)
  } else {
    push(
      "users",
      known({
        count: input.users.value.count,
        unit:
          input.users.value.stores.length === 1
            ? `people in the identity store attributed to this tenant`
            : `people across the ${input.users.value.stores.length} identity stores attributed to this tenant`,
        // The POOLS, not the people. This control plane holds no user record
        // and this axis does not start it holding one.
        items: [...input.users.value.stores],
        itemsWithheld:
          `the identity stores are named and the people in them are not — this console reads ` +
          `EstimatedNumberOfUsers, which is a total, and holds no user record of any kind`,
      }),
    )
  }

  // ── seats ────────────────────────────────────────────────────────────────
  if (!input.seats.known) {
    push("seats", derivedFailure(input.seats, "the seat entitlement"))
  } else if (input.seats.value === null) {
    push(
      "seats",
      known({
        count: 0,
        unit: "seats — this plan sets no seat limit, so no seat ceiling is at risk",
        items: [],
        itemsWithheld: null,
      }),
    )
  } else {
    push(
      "seats",
      known({
        count: input.seats.value,
        unit: "seats entitled by the tenant's plan",
        items: [],
        itemsWithheld: "seats are a ceiling, not a list — the console does not hold who occupies them",
      }),
    )
  }

  // ── workflows ────────────────────────────────────────────────────────────
  //
  // A declared cross-module process breaks when any module on it does.
  const chains = input.chains
    .filter((chain) => chain.steps.some((step) => reachedSet.has(step.module)))
    .map((chain) => chain.chainId)
    .sort()
  push(
    "workflows",
    known({
      count: chains.length,
      unit: "declared cross-module processes crossing an affected module",
      items: chains,
      itemsWithheld: null,
    }),
  )

  // ── modules ──────────────────────────────────────────────────────────────
  push(
    "modules",
    known({
      count: reached.length,
      unit: "modules changed, and everything transitively depending on them",
      items: reached,
      itemsWithheld: null,
    }),
  )

  // ── records ──────────────────────────────────────────────────────────────
  //
  // Object CLASSES, and the unit says so. A row count would have to come from
  // the tenant's cell, and a number here labelled "records" that was really a
  // count of tables is exactly the confident wrong answer this report exists
  // to avoid.
  const objects = [
    ...new Set(reached.flatMap((key) => catalogue.get(key)?.objects ?? [])),
  ].sort()
  push(
    "records",
    known({
      count: objects.length,
      unit: "object classes governed by the affected modules — classes, not rows; this console holds no tenant rows",
      items: objects,
      itemsWithheld: null,
    }),
  )

  // ── resources ────────────────────────────────────────────────────────────
  if (!input.resources.known) {
    push("resources", derivedFailure(input.resources, "the AWS resources reached"))
  } else {
    const handles = [...input.resources.value].map((r) => r.handle).sort()
    push(
      "resources",
      known({
        count: handles.length,
        unit: "AWS resources attributed to this tenant",
        items: handles,
        itemsWithheld: null,
      }),
    )
  }

  // ── regions ──────────────────────────────────────────────────────────────
  if (!input.resources.known) {
    push("regions", derivedFailure(input.resources, "the set of regions reached"))
  } else {
    const regions = new Set<string>([input.region])
    if (input.cell.known && input.cell.value) regions.add(input.cell.value.region)
    for (const resource of input.resources.value) regions.add(resource.region)
    const list = [...regions].sort()
    push(
      "regions",
      known({
        count: list.length,
        unit: "regions holding something this change reaches",
        items: list,
        itemsWithheld: null,
      }),
    )
  }

  // ── integrations ─────────────────────────────────────────────────────────
  //
  // An integration is a domain some other system is authoritative for. Those
  // are exactly the domains a change here can contradict.
  const integrations = [...new Set(input.externalDomains)].sort()
  push(
    "integrations",
    known({
      count: integrations.length,
      unit: "business domains an external system is authoritative for",
      items: integrations,
      itemsWithheld: null,
    }),
  )

  // ── SLOs ─────────────────────────────────────────────────────────────────
  const slos = reached
    .flatMap((key) => (catalogue.get(key)?.slo ?? []).map((s) => `${key}: ${s.objective}`))
    .sort()
  push(
    "slos",
    known({
      count: slos.length,
      unit: "declared service objectives on the affected modules",
      items: slos,
      itemsWithheld: null,
    }),
  )

  // ── downtime ─────────────────────────────────────────────────────────────
  const downtime = interruption(input)
  push(
    "downtime",
    known({
      count: downtime === null ? 0 : 1,
      unit: "service interruptions this change causes",
      items: downtime === null ? [] : [downtime],
      itemsWithheld: null,
    }),
  )

  // ── downstream releases ──────────────────────────────────────────────────
  if (!input.cell.known) {
    push("downstreamReleases", derivedFailure(input.cell, "the releases downstream of this change"))
  } else if (input.cell.value === null) {
    push(
      "downstreamReleases",
      known({
        count: 0,
        unit: "engine releases downstream of this change — none; the tenant is on no cell",
        items: [],
        itemsWithheld: null,
      }),
    )
  } else {
    const cell = input.cell.value
    push(
      "downstreamReleases",
      known({
        count: 1,
        unit: "engine release this change lands on",
        items: [`${cell.release} on ${cell.cellId}`],
        itemsWithheld: null,
      }),
    )
  }

  return {
    slug: input.slug,
    change: {
      surface: input.operation.surface,
      action: String(input.operation.action),
      target: input.operation.target,
      changeClass: input.changeClass,
    },
    measures,
    measured: measures.filter((m) => m.reading.known).map((m) => m.dimension),
    unreadable: measures.filter((m) => !m.reading.known).map((m) => m.dimension),
  }
}

/**
 * The sentence describing the interruption this change causes, or `null` for a
 * change that causes none.
 *
 * Derived from the lifecycle move rather than from the class: `C6` is
 * "customer-visible", which a domain activation is without anybody losing
 * service, and a tenant is interrupted precisely when a serving state is left
 * for one that does not serve.
 */
export function interruption(input: BlastInput): string | null {
  if (input.operation.surface !== "tenant-lifecycle") return null
  const destination = input.operation.action as TenantState
  const wasServing = SERVING_STATES.has(input.currentState)
  const willServe = SERVING_STATES.has(destination)
  if (!wasServing || willServe) return null
  return `${input.currentState} → ${destination} stops serving this tenant's users`
}

/**
 * The report's own integrity, as a list of problems.
 *
 * Two properties, and both have been wrong in reports elsewhere in this
 * console: an axis missing entirely (a dimension added to the list and never
 * measured, which renders as silence) and a count with a shorter item list and
 * nothing saying why (which renders as an enumeration).
 */
export function blastRadiusProblems(report: BlastRadius): readonly string[] {
  const problems: string[] = []
  const seen = new Set(report.measures.map((m) => m.dimension))
  for (const dimension of BLAST_DIMENSIONS) {
    if (!seen.has(dimension)) problems.push(`${dimension}: no measure — the axis is declared and never calculated`)
  }
  for (const measure of report.measures) {
    if (!measure.reading.known) continue
    const value = measure.reading.value
    if (value.items.length !== value.count && value.itemsWithheld === null) {
      problems.push(
        `${measure.dimension}: counts ${value.count} and lists ${value.items.length} with nothing saying why`,
      )
    }
  }
  return problems
}

/** One line per axis, in the requirement's order, for the panel and for a test. */
export function blastRadiusLines(report: BlastRadius): readonly string[] {
  return report.measures.map((measure) => {
    if (!measure.reading.known) {
      return `${measure.dimension}: not measured — ${measure.reading.because}. Fix: ${measure.reading.fix}`
    }
    const value = measure.reading.value
    const withheld = value.itemsWithheld ? ` (${value.itemsWithheld})` : ""
    const items = value.items.length > 0 ? ` — ${value.items.join(", ")}` : ""
    return `${measure.dimension}: ${value.count} ${value.unit}${items}${withheld}`
  })
}
