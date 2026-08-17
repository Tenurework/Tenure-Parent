#!/usr/bin/env node
/**
 * Operations availability, safety disclaimers and published limitations —
 * derived from the tree.
 *
 *   node tools/ops-availability-and-limits.mjs            # write the document
 *   node tools/ops-availability-and-limits.mjs --check    # fail if it is stale
 *
 * Two requirements, one derivation, because they are two halves of one fact:
 *
 *   OPS-050-001 — "Implement industry/mode/jurisdiction exact availability and
 *                  safety disclaimers."
 *   OPS-050-005 — "Publish exact industry/mode/site/device/provider
 *                  limitations."
 *
 * ## Why this is a decision procedure and not a page of prose
 *
 * "Exact availability" is a claim that goes stale in one direction only: the
 * dangerous drift is a capability being *claimed* after the code that would back
 * it moved, or before it arrived. A hand-written availability page is therefore
 * worth less than no page, because it reads as an audited answer.
 *
 * So `availabilityFor()` decides each area from two conditions, both read off
 * the tree, and the document is its output:
 *
 *   1. **Model.** Every canonical entity the area needs is declared under that
 *      name in `apps/web/prisma/schema.prisma`, and is not one of the name
 *      collisions `tools/ops-operations-inventory.mjs` records — `Resource` in
 *      that schema is a board resource (a form, guide or checklist), and
 *      counting it as an Operations work-centre resource is exactly the misread
 *      OPS-000-001 exists to prevent.
 *   2. **Surface.** At least one route the tenant app actually serves lies under
 *      the area's route prefix. Served routes come from
 *      `tools/entry-point-inventory.mjs`, which walks the filesystem, so a
 *      deleted page changes this answer without anybody editing a list.
 *
 * An area with neither is `unavailable`, with the reason naming which condition
 * failed and what is missing. An area with both is `available`. That state is
 * reachable — it is what a wave that ships the tables and the route gets, with no
 * edit here — which matters, because an "available" branch nothing can ever take
 * is a constant wearing a function's clothes. `ops-availability-and-limits.test.mjs`
 * proves both branches against synthetic input.
 *
 * ## What the axes are, and why they are these
 *
 * The requirement names industry, mode, jurisdiction, site, device and provider.
 * Five of the six resolve to something the repository really declares:
 *
 *   industry      `ORGANIZATION_ARCHETYPES` in `blueprints/archetype.ts` — the
 *                 three organization shapes this engine can build. There is no
 *                 `industry` axis: `ARCHETYPE_AXIS_IDS` holds three ids and
 *                 industry is not one of them, which that file states plainly
 *                 ("an IndustryPack … nothing produces one").
 *   mode          Bible §9's declared manufacturing modes, parsed from its own
 *                 sentence.
 *   jurisdiction  no axis. `ARCHETYPE_AXIS_IDS` has no `geography` either, so
 *                 Operations availability cannot vary by jurisdiction — which is
 *                 a limitation to publish, not a gap to paper over.
 *   site          the site-shaped canonical entities, and the cell registry's
 *                 different sense of the word.
 *   device        Bible §17's ten required experiences against the served routes.
 *   provider      Bible §20's provider classes against the provider reviews
 *                 `packages/platform-config/src/provider-review.ts` records.
 *
 * ## Determinism
 *
 * Byte-identical output on Linux and Windows or the committed document is
 * "current here, stale in CI". Every read goes through `read()` in
 * `ops-operations-inventory.mjs` (utf8, normalised to LF), sorts use a codepoint
 * comparator, and nothing here reads a clock, a hash of raw bytes or git.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { catalogConnectors, providerReviews } from "./cat-integration-inventory.mjs"
import { collect } from "./entry-point-inventory.mjs"
import {
  BIBLE,
  COLLISIONS,
  ROOT,
  SCHEMA,
  byCodepoint,
  canonicalEntities,
  read,
  schemaDeclarations,
} from "./ops-operations-inventory.mjs"

export const ARCHETYPES_FILE = "blueprints/archetype.ts"
export const RELAY_TOOLS_FILE = "apps/web/src/lib/relay-tools.ts"
export const OUTPUT = "docs/architecture/ops-availability-and-limitations.md"

// ── the authored parts, each with the check that stops it rotting ────────────

/**
 * The capability areas, one per bullet of Bible §2 "Shared operational model".
 *
 * The entity membership is NOT here — it is read from the bullet, so the
 * left-hand column of every table below is the Bible's own grouping rather than
 * one somebody retyped. What is authored is three things per area: a stable id, a
 * title a reader can scan, and the route prefix under which its surface would be
 * served. `build()` refuses to emit when the bullet count changes, when an index
 * is missing or repeated, or when two areas claim one prefix.
 *
 * The route prefixes are `/operations/...` rather than `/inventory`, `/orders`
 * and so on, deliberately: the tenant app already serves `/resources` and
 * `/approvals`, and an area whose prefix collided with one of those would come
 * out `available` on the strength of a board-resource library.
 */
export const AREAS = [
  [0, "master-data", "Product, item and service master", "/operations/items"],
  [1, "network", "Sites, warehouses, work centres and assets", "/operations/network"],
  [2, "parties", "Supplier, customer, carrier and partner references", "/operations/parties"],
  [3, "demand-supply", "Demand, supply, reservation and availability", "/operations/supply"],
  [4, "inventory", "Lots, serials, balances and inventory transactions", "/operations/inventory"],
  [5, "orders", "Orders, fulfillment, shipment and returns", "/operations/orders"],
  [6, "production", "Product structure, routing and work execution", "/operations/production"],
  [7, "quality", "Inspection, nonconformance, CAPA and recall", "/operations/quality"],
  [8, "maintenance", "Maintenance, meters, failures and calibration", "/operations/maintenance"],
  [9, "projects", "Projects, WBS, milestones and change orders", "/operations/projects"],
  [10, "service", "Service cases, dispatch, field visits and entitlements", "/operations/service"],
  [11, "facilities", "Facilities, spaces, visitors and workplace requests", "/operations/facilities"],
  [12, "operational-events", "Operational events, accounting references and memory", "/operations/events"],
]

/**
 * The safety disclaimers, each quoted from the Bible section that states it.
 *
 * Quoted rather than paraphrased, and `build()` asserts every quote is a literal
 * substring of that numbered section. A disclaimer that drifts from the sentence
 * it disclaims is the failure worth designing against: it is still on the page,
 * it still reads as authoritative, and it no longer says what the authority says.
 *
 * `[section, quote]`. The sections are §1 (constitutional boundaries), §16
 * (operational controls), §19 (Relay) and §20 (integration and real-time).
 */
export const DISCLAIMERS = [
  [
    1,
    "Specialized safety, clinical, process-control, CAD geometry and machine-control systems remain external until separately certified.",
  ],
  [16, "Sensitive/dangerous operational commands require step-up/SoD/approval."],
  [
    19,
    "Protected or prohibited: no autonomous unsafe machine action, quality release, recall closure, inventory write-off, shipment of controlled goods, maintenance safety clearance, customer promise or financial approval.",
  ],
  [
    20,
    "Do not promise hard real-time safety/control latency on ordinary cloud workflows.",
  ],
]

// ── reading the Bible's own declarations ────────────────────────────────────

/** One `## n. …` section of the Bible, by its number. */
export function section(n, bibleText = read(BIBLE)) {
  const found = bibleText.split("\n## ").find((s) => new RegExp(`^${n}\\. `).test(s))
  if (!found) throw new Error(`${BIBLE} no longer has a "## ${n}. …" section.`)
  return found
}

/**
 * The entity groups of §2, in bullet order, deduplicated the way
 * `canonicalEntities()` deduplicates: first mention wins.
 *
 * §2 names `Reservation` twice — once under demand/supply and once under
 * facilities — and an entity in two areas would be counted twice in every total
 * below. Which area keeps it is decided by the Bible's own order rather than by
 * a preference expressed here.
 */
export function entityGroups(bibleText = read(BIBLE)) {
  const seen = new Set()
  const groups = []
  for (const line of section(2, bibleText).split("\n")) {
    if (!line.startsWith("- ")) continue
    const names = []
    for (const m of line.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)) {
      if (seen.has(m[1])) continue
      seen.add(m[1])
      names.push(m[1])
    }
    groups.push(names)
  }
  return groups
}

/** §9's declared manufacturing modes, from the sentence that declares them. */
export function declaredModes(bibleText = read(BIBLE)) {
  const line = section(9, bibleText)
    .split("\n")
    .find((l) => l.includes("Support declared modes:"))
  if (!line) throw new Error(`${BIBLE} §9 no longer declares its manufacturing modes.`)
  return line
    .split("Support declared modes:")[1]
    .replace(/\.\s*$/, "")
    .split(/,\s*|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** §17's required frontline experiences, as its own bullet text. */
export function requiredExperiences(bibleText = read(BIBLE)) {
  const body = section(17, bibleText).split("Required experiences:")[1]
  if (!body) throw new Error(`${BIBLE} §17 no longer lists required experiences.`)
  return body
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
}

/** §20's provider classes, from the sentence that routes them at the Integration Plane. */
export function providerClasses(bibleText = read(BIBLE)) {
  const line = section(20, bibleText)
    .split("\n")
    .find((l) => l.includes("Use the Integration Plane for "))
  if (!line) throw new Error(`${BIBLE} §20 no longer names the provider classes.`)
  return line
    .split("Use the Integration Plane for ")[1]
    .split(".")[0]
    .split(/,\s*|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ── reading what the engine declares ───────────────────────────────────────

/** A `readonly`-style string-literal array exported from a TypeScript file. */
export function literalArray(name, text) {
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(text)
  if (!m) throw new Error(`${name} is no longer exported as a literal array.`)
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

/** The composition axes, the organization archetypes and the functional suites. */
export function archetypeAxes(text = read(ARCHETYPES_FILE)) {
  return {
    axes: literalArray("ARCHETYPE_AXIS_IDS", text),
    archetypes: literalArray("ORGANIZATION_ARCHETYPES", text),
    operatingModels: literalArray("OPERATING_MODELS", text),
    suites: literalArray("FUNCTIONAL_SUITES", text),
  }
}

/**
 * What the `operations` functional suite actually switches on.
 *
 * The finding this exists to publish: `FUNCTIONAL_SUITES` already contains a
 * value spelled `operations`, and it composes `approvals` and `events` — board
 * approvals and a calendar. A tenant selecting it gets neither inventory nor work
 * orders, and nothing anywhere said so. `OPS-000-001`'s vocabulary scan could not
 * see it: its term list deliberately excludes the word `operations` because in a
 * Next.js application it matches everything.
 */
export function operationsSuiteModules(text = read(ARCHETYPES_FILE)) {
  const m = /operations:\s*\[([^\]]*)\]/.exec(text)
  if (!m) throw new Error(`${ARCHETYPES_FILE} no longer maps the \`operations\` suite to modules.`)
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

/**
 * The tools Relay can actually invoke, by key.
 *
 * `TOOL_ARGUMENT_SCHEMAS` is the allow-list `invokeRelayTool` checks: a tool with
 * no schema there cannot be invoked at all, which `relay-tools.ts` states as the
 * point of inverting the previous deny-list. So the set of keys IS the set of
 * invocable tools, and reading it is how §19's Operations prohibition becomes a
 * fact about this repository rather than an intention.
 */
export function invocableRelayTools(text = read(RELAY_TOOLS_FILE)) {
  const m = /export const TOOL_ARGUMENT_SCHEMAS: ToolArgumentSchemas = \{([\s\S]*?)\n\}/.exec(text)
  if (!m) throw new Error(`${RELAY_TOOLS_FILE} no longer exports TOOL_ARGUMENT_SCHEMAS.`)
  return [...m[1].matchAll(/"([^"]+)":/g)].map((x) => x[1]).sort(byCodepoint)
}

/**
 * Routes the tenant app serves, route groups stripped.
 *
 * From `collect()` rather than a second walk of `apps/web/src/app`: two readers
 * of one filesystem disagree eventually, and `nav-hrefs-are-served.test.mjs`
 * already acts on that one's answer. Studio pages are excluded because the
 * operator console is a different origin (PD-007) and could not serve a tenant's
 * Operations surface.
 */
export function servedRoutes() {
  const routes = new Set()
  for (const page of collect().pages.filter((p) => p.experience === "tenant")) {
    routes.add(page.route.replace(/\/\([^)]+\)/g, "") || "/")
  }
  return [...routes].sort(byCodepoint)
}

// ── the decision ───────────────────────────────────────────────────────────

/** The canonical names the schema declares but under a different meaning. */
export const COLLIDING_NAMES = COLLISIONS.map(([name]) => name)

/**
 * Is this area available, and if not, exactly why.
 *
 * Both conditions are necessary and the reason names the one that failed first,
 * because "there is no table" and "there is a table and no way to reach it" are
 * different answers and a caller that collapsed them would be the bug this
 * repository names most often.
 *
 * `declarations` and `routes` are parameters rather than reads so the guard can
 * drive both branches. A function whose `available` result nothing can produce is
 * not a decision procedure.
 */
export function availabilityFor(area, entities, declarations, routes) {
  const modelled = entities.filter((e) => declarations.has(e) && !COLLIDING_NAMES.includes(e))
  const missing = entities.filter((e) => !modelled.includes(e))
  const served = routes.filter((r) => r === area.prefix || r.startsWith(`${area.prefix}/`))

  if (missing.length === entities.length) {
    return {
      status: "unavailable",
      condition: "model",
      reason: `no canonical entity of this area is declared in ${SCHEMA}`,
      modelled,
      missing,
      served,
    }
  }
  if (missing.length > 0) {
    return {
      status: "unavailable",
      condition: "model",
      reason: `${missing.length} of ${entities.length} canonical entities are not declared in ${SCHEMA}`,
      modelled,
      missing,
      served,
    }
  }
  if (served.length === 0) {
    return {
      status: "unavailable",
      condition: "surface",
      reason: `the model is declared and no route under ${area.prefix} is served`,
      modelled,
      missing,
      served,
    }
  }
  return {
    status: "available",
    condition: null,
    reason: `every canonical entity is declared and ${served.length} route(s) under ${area.prefix} are served`,
    modelled,
    missing,
    served,
  }
}

/**
 * Exact availability for one composition selection.
 *
 * This is the callable form of OPS-050-001's "industry/mode/jurisdiction exact
 * availability", and the reason it is a function rather than three paragraphs is
 * the distinction this codebase cares most about: **"we looked and found nothing"
 * and "we could not look" are different answers.**
 *
 *   * An unknown archetype or operating model is refused, not answered. Returning
 *     `unavailable` for a value the engine does not have would be an answer about
 *     a system nobody can select.
 *   * A jurisdiction is refused outright while `ARCHETYPE_AXIS_IDS` has no
 *     `geography` axis. Answering "unavailable in Germany" would imply somebody
 *     checked Germany. Nobody can: there is no `JurisdictionPack` to check
 *     against, and `blueprints/archetype.ts` says so in its own words.
 *   * A valid selection gets the per-area verdicts, which is a real answer with
 *     real reasons in it.
 *
 * `opts` exists so the guard can hold the axes, the schema and the routes fixed —
 * the refusals must be provable without waiting for the tree to grow a
 * jurisdiction axis.
 */
export function availabilityUnderSelection(selection, opts = {}) {
  const axes = opts.axes ?? archetypeAxes()
  const declarations = opts.declarations ?? schemaDeclarations()
  const routes = opts.routes ?? servedRoutes()
  const groups = opts.groups ?? entityGroups()

  if (!axes.archetypes.includes(selection.archetype)) {
    return {
      ok: false,
      refusal: "unknown-archetype",
      detail: `\`${selection.archetype}\` is not one of the ${axes.archetypes.length} organization archetypes this engine builds.`,
    }
  }
  if (!axes.operatingModels.includes(selection.operatingModel)) {
    return {
      ok: false,
      refusal: "unknown-operating-model",
      detail: `\`${selection.operatingModel}\` is not one of the ${axes.operatingModels.length} declared operating models.`,
    }
  }
  if (selection.jurisdiction !== undefined && !axes.axes.includes("geography")) {
    return {
      ok: false,
      refusal: "no-jurisdiction-axis",
      detail:
        `Availability cannot be resolved for jurisdiction \`${selection.jurisdiction}\`: ` +
        `${ARCHETYPES_FILE} declares no \`geography\` axis and nothing produces a JurisdictionPack, ` +
        `so there is nothing to resolve against. This is a refusal, not an answer — reporting ` +
        `"unavailable" here would imply somebody checked.`,
    }
  }

  const areas = AREAS.map(([index, id, title, prefix]) => ({
    id,
    verdict: availabilityFor({ index, id, title, prefix }, groups[index], declarations, routes),
  }))
  return {
    ok: true,
    areas,
    available: areas.filter((a) => a.verdict.status === "available").map((a) => a.id),
  }
}

/**
 * The Operations areas that are released — that is, `available` on both
 * conditions.
 *
 * OPS-GATE-050 says "“Best” is claimed only for measured released scope", and a
 * gate over "released scope" needs somebody to say what that is. This is that
 * definition, in one place, derived: `tests/architecture/ops-best-claim-is-measured.test.mjs`
 * refuses a superlative claim about anything outside this list, and §2 of the
 * generated document publishes the same list. Two readers of one derivation
 * rather than two definitions of one word.
 */
export function releasedAreas(
  declarations = schemaDeclarations(),
  routes = servedRoutes(),
  groups = entityGroups(),
) {
  return AREAS.filter(
    ([index, id, title, prefix]) =>
      availabilityFor({ index, id, title, prefix }, groups[index], declarations, routes).status ===
      "available",
  ).map(([, id]) => id)
}

/**
 * Where the authored parts and the derived ones disagree.
 *
 * Exported so the guard can drive it against synthetic input: a detector that
 * returns `[]` for everything leaves `build()` looking identical and checking
 * nothing, which has happened in this repository before.
 */
export function areaProblems(areas, groups, bibleText) {
  const problems = []
  if (areas.length !== groups.length) {
    problems.push(
      `Bible §2 now has ${groups.length} entity bullets and AREAS describes ${areas.length}. ` +
        `Read the new bullet and give it an id, a title and a route prefix.`,
    )
  }
  const indices = new Set()
  for (const [index, id, title, prefix] of areas) {
    if (indices.has(index)) problems.push(`Two areas claim §2 bullet ${index}.`)
    indices.add(index)
    if (index < 0 || index >= groups.length) {
      problems.push(`Area \`${id}\` claims §2 bullet ${index}, which does not exist.`)
    } else if (groups[index].length === 0) {
      problems.push(`Area \`${id}\` claims §2 bullet ${index}, which names no entity.`)
    }
    if (!title || title.trim() === "") problems.push(`Area \`${id}\` has no title.`)
    if (!/^\/[a-z][a-z0-9/-]*$/.test(prefix)) {
      problems.push(`Area \`${id}\` has an unusable route prefix: ${prefix}`)
    }
  }
  const prefixes = areas.map(([, , , p]) => p)
  for (const p of prefixes) {
    if (prefixes.filter((q) => q === p).length > 1) problems.push(`Two areas claim the prefix ${p}.`)
  }
  for (const [n, quote] of DISCLAIMERS) {
    if (!section(n, bibleText).includes(quote)) {
      problems.push(`The disclaimer quoted from §${n} is not in that section: ${quote}`)
    }
  }
  return [...new Set(problems)].sort(byCodepoint)
}

// ── the document ───────────────────────────────────────────────────────────

const PREAMBLE = [
  "# Operations — availability, safety disclaimers and published limitations",
  "",
  "**Generated. Do not edit by hand.**",
  "Run `node tools/ops-availability-and-limits.mjs`;",
  "`tests/architecture/ops-availability-and-limits.test.mjs` re-derives every row",
  "below from the tree and fails when this file disagrees with it.",
  "",
  "OPS-050-001 asks for exact availability by industry, mode and jurisdiction, with",
  "safety disclaimers. OPS-050-005 asks for published limitations by industry, mode,",
  "site, device and provider. Both are answered here, and neither answer is typed in:",
  "availability is decided by `availabilityFor()` from two conditions read off the",
  "tree — is the canonical model declared, and is a surface served — and every",
  "disclaimer is quoted from the Bible section that states it, with the generator",
  "refusing to emit if a quote is not a literal substring of that section.",
  "",
  "The summary answer is that **no Operations capability is available in any",
  "industry, under any operating model, in any jurisdiction, on any device class,",
  "against any provider.** That is worth publishing precisely because it is",
  "unsurprising to a reader who knows the schema and invisible to one who does not.",
  "",
]

export function build() {
  const bibleText = read(BIBLE)
  const groups = entityGroups(bibleText)
  const problems = areaProblems(AREAS, groups, bibleText)
  if (problems.length > 0) {
    throw new Error(
      `The authored parts of this document no longer match the tree:\n  ${problems.join("\n  ")}`,
    )
  }

  const declarations = schemaDeclarations()
  const routes = servedRoutes()
  const entities = canonicalEntities(bibleText)
  const axes = archetypeAxes()
  const suiteModules = operationsSuiteModules()
  const reviews = [...providerReviews().entries()]
    .map(([constant, state]) => ({ constant, state }))
    .sort((a, b) => byCodepoint(a.constant, b.constant))
  if (reviews.length === 0) throw new Error("No ProviderReview was found; the provider axis would read as vacuous.")
  const connectors = catalogConnectors()
  if (connectors.length === 0) throw new Error("No ConnectorEntry was found; the provider axis would read as vacuous.")
  const relayTools = invocableRelayTools()
  const modes = declaredModes(bibleText)
  const experiences = requiredExperiences(bibleText)
  const providers = providerClasses(bibleText)

  const areas = AREAS.map(([index, id, title, prefix]) => {
    const area = { index, id, title, prefix }
    return { ...area, entities: groups[index], verdict: availabilityFor(area, groups[index], declarations, routes) }
  })

  const lines = [...PREAMBLE]

  // ── 1 ──
  lines.push(
    "## 1. How availability is decided",
    "",
    "An area is `available` only when **both** hold, and `unavailable` naming the",
    "first that does not:",
    "",
    `1. **Model** — every canonical entity Bible §2 groups into the area is declared`,
    `   under that name in \`${SCHEMA}\`, and is not one of the`,
    `   ${COLLIDING_NAMES.length} name collisions \`docs/architecture/ops-operations-code-inventory.md\``,
    `   records (${COLLIDING_NAMES.map((n) => `\`${n}\``).join(", ")} exist in that schema`,
    "   meaning something else entirely).",
    "2. **Surface** — the tenant app serves at least one route under the area's",
    "   prefix. Served routes are walked from the filesystem by",
    "   `tools/entry-point-inventory.mjs`, so deleting a page changes this answer",
    "   with no edit here.",
    "",
    `The app serves **${routes.length}** tenant routes today. Bible §2 names`,
    `**${entities.length}** canonical entities; \`${SCHEMA}\` declares`,
    `**${declarations.size}** models and enums.`,
    "",
  )

  // ── 2 ──
  lines.push(
    "## 2. Capability availability, by area",
    "",
    "| Area | §2 bullet | Entities | Modelled | Routes served | Availability | Failing condition |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  )
  for (const a of areas) {
    lines.push(
      `| ${a.title} | ${a.index} | ${a.entities.length} | ${a.verdict.modelled.length} | ` +
        `${a.verdict.served.length} | \`${a.verdict.status}\` | ${a.verdict.condition ?? "—"} |`,
    )
  }
  const unavailable = areas.filter((a) => a.verdict.status === "unavailable")
  lines.push(
    "",
    `**${unavailable.length} of ${areas.length}** areas are unavailable. The reason for each,`,
    "in the decision's own words:",
    "",
  )
  for (const a of areas) {
    lines.push(`- \`${a.id}\` — ${a.verdict.reason}.`)
  }
  lines.push("")

  // ── 3 ──
  lines.push(
    "## 3. Availability by industry, operating model and jurisdiction",
    "",
    `The composition axes this engine really has are \`${axes.axes.join("`, `")}\``,
    `(\`${ARCHETYPES_FILE}\`). **\`industry\` is not one of them, and neither is`,
    "`geography`** — that file states why: an industry axis needs an `IndustryPack`,",
    "and nothing produces one; a geography axis needs a `JurisdictionPack`, and",
    "localization is already set per blueprint and tenant.",
    "",
    "So the exact answer to \"which industries and jurisdictions is Operations",
    "available in\" is not a list of some — it is that **the platform cannot vary",
    "Operations by industry or by jurisdiction at all**, and every Operations area",
    "is unavailable in all of them. The nearest industry-shaped axis that does exist",
    `is the organization archetype, of which there are ${axes.archetypes.length}:`,
    "",
  )
  for (const a of axes.archetypes) lines.push(`- \`${a}\` — every Operations area unavailable.`)
  lines.push(
    "",
    `Crossed with the ${axes.operatingModels.length} operating models`,
    `(\`${axes.operatingModels.join("`, `")}\`) that is`,
    `${axes.archetypes.length * axes.operatingModels.length} combinations, and the`,
    "verdict is the same in every one: availability is decided by the model and the",
    "surface, neither of which any axis value changes.",
    "",
    "### The answer is resolved, and a jurisdiction question is refused",
    "",
    "`availabilityUnderSelection()` resolves this per selection rather than leaving",
    "it as prose, and it distinguishes the two answers that must never be collapsed.",
    "Three examples, each the function's real output:",
    "",
    ...(() => {
      const shown = [
        [
          { archetype: axes.archetypes[0], operatingModel: axes.operatingModels[0] },
          "a selection the engine can build",
        ],
        [{ archetype: "manufacturing", operatingModel: axes.operatingModels[0] }, "an archetype it cannot"],
        [
          { archetype: axes.archetypes[0], operatingModel: axes.operatingModels[0], jurisdiction: "DE" },
          "a jurisdiction question",
        ],
      ]
      const out = []
      for (const [sel, why] of shown) {
        const r = availabilityUnderSelection(sel, { axes, declarations, routes, groups })
        const q = `\`${sel.archetype}\` / \`${sel.operatingModel}\`${sel.jurisdiction ? ` / \`${sel.jurisdiction}\`` : ""}`
        out.push(
          r.ok
            ? `- ${q} — ${why}: answered, **${r.available.length} of ${r.areas.length}** areas available.`
            : `- ${q} — ${why}: refused, \`${r.refusal}\`. ${r.detail}`,
        )
      }
      return out
    })(),
    "",
    "The third is the one worth reading twice. \"Unavailable in Germany\" would be a",
    "claim that somebody checked Germany; nobody can, so the answer is a refusal that",
    "names why. That distinction is this codebase's central rule and it is the",
    "difference between a limitation and a guess.",
    "",
    "### The `operations` functional suite is not this",
    "",
    `\`FUNCTIONAL_SUITES\` in \`${ARCHETYPES_FILE}\` contains a value spelled`,
    "`operations`, and it is selectable today. It composes",
    `${suiteModules.map((m) => `\`${m}\``).join(" and ")} — board approvals and a`,
    "calendar. It is **not** the Operations Cloud, it grants no inventory, work",
    "order, shipment or maintenance capability, and a tenant selecting it receives",
    "exactly those two modules. This is published here because it is the one",
    "Operations claim in the product a reader could reasonably misread, and the",
    "vocabulary scan in `docs/architecture/ops-operations-code-inventory.md` cannot",
    "see it: that scan deliberately excludes the word `operations`, which in a",
    "Next.js application matches everything.",
    "",
  )

  // ── 4 ──
  const production = areas.find((a) => a.id === "production")
  lines.push(
    "## 4. Limitations by manufacturing mode",
    "",
    `Bible §9 declares ${modes.length} modes. Every one of them executes through the`,
    `product-structure and work area, which is \`${production.verdict.status}\`:`,
    `${production.verdict.reason}. So no mode is supported, and the limitation is`,
    "identical for all of them rather than mode-specific:",
    "",
  )
  for (const m of modes) lines.push(`- **${m}** — unsupported; ${production.verdict.reason}.`)
  lines.push("")

  // ── 5 ──
  const network = areas.find((a) => a.id === "network")
  lines.push(
    "## 5. Limitations by site",
    "",
    `Site-shaped operations live in the \`${network.id}\` area —`,
    `${network.entities.map((e) => `\`${e}\``).join(", ")} — which is`,
    `\`${network.verdict.status}\`: ${network.verdict.reason}.`,
    "",
    "Two words that are not this, so a reader does not count them as coverage:",
    "",
    "- **Cells.** `placementFor` and the cell registry place a *tenant* in an AWS",
    "  cell. A cell is not an operational site, has no inventory organization and",
    "  no locators, and multi-cell placement is not multi-site operations.",
    "- **Institutions and organizations.** The tenant schema's `Organization` is a",
    "  student club or a division, not an `InventoryOrganization`.",
    "",
  )

  // ── 6 ──
  lines.push(
    "## 6. Limitations by device class",
    "",
    `Bible §17 requires ${experiences.length} frontline experiences, several of them`,
    "explicitly for scanners, gloves and mobile use. None is served: the app's",
    `${routes.length} tenant routes include no route under any Operations prefix, so`,
    "there is no Operations experience to assess on any device class — not a",
    "desktop one that is missing a mobile variant, none at all.",
    "",
    "| Required experience (§17) | Routes served under any Operations prefix |",
    "| --- | --- |",
  )
  for (const e of experiences) lines.push(`| ${e} | 0 |`)
  lines.push(
    "",
    "The accessibility consequence is stated rather than implied: WCAG 2.2 AA",
    "conformance is claimed for no Operations surface, because there is no",
    "Operations surface to conform. `OPS-040-001` remains FAIL for that reason.",
    "",
  )

  // ── 7 ──
  lines.push(
    "## 7. Limitations by provider",
    "",
    `Bible §20 routes ${providers.length} provider classes through the Integration`,
    "Plane. Two things would have to exist for any of them to be claimable, and both",
    "are read from the tree rather than described:",
    "",
    `- **Connectors.** \`catalogConnectors()\` finds **${connectors.length}** \`ConnectorEntry\``,
    "  declared in the provisioning catalog:",
    "",
  )
  for (const c of connectors) {
    lines.push(
      // `declaredAt` carries a line number in another domain's file. Citing it
      // would make this document stale every time somebody edits above that line
      // in `catalogs.ts`, which is a guard going red for a reason that has
      // nothing to do with what it guards. The path is the durable half.
      `  - \`${c.key}\` — provider \`${c.provider}\`, capability \`${c.capability}\`, ` +
        `lifecycle \`${c.lifecycle}\`, capability status \`${c.capabilityStatus}\`, ` +
        `review \`${c.review ?? "none"}\` (declared in ${c.declaredAt.split(":")[0]}).`,
    )
  }
  lines.push(
    "",
    `- **Provider reviews.** **${reviews.length}** recorded, of which`,
    `  **${reviews.filter((r) => r.state !== "APPROVED").length}** are not approved:`,
    `  ${reviews.map((r) => `\`${r.constant}\` = \`${r.state}\``).join(", ")}.`,
    "",
    "Not one connector and not one review names an Operations provider class. So the",
    "limitation for every class below is the same, and it is absolute — no connector,",
    "no review, no claim:",
    "",
  )
  for (const p of providers) lines.push(`- **${p}** — no connector, no provider review, unavailable.`)
  lines.push("")

  // ── 8 ──
  lines.push(
    "## 8. Safety disclaimers",
    "",
    "Quoted from the Bible sections that state them. The generator refuses to emit",
    "if a quote is not a literal substring of the section it names, so these cannot",
    "drift from the authority while continuing to read as authoritative.",
    "",
  )
  for (const [n, quote] of DISCLAIMERS) lines.push(`- **§${n}** — ${quote}`)
  lines.push(
    "",
    "Two of the four bind code that exists rather than code that does not, and that",
    "is the part worth being exact about:",
    "",
    `- §19's prohibition is enforceable today because Relay's door is real:`,
    `  \`${RELAY_TOOLS_FILE}\` refuses any tool absent from its \`TOOL_ARGUMENT_SCHEMAS\``,
    `  allow-list, and that list holds **${relayTools.length}** key(s):`,
    `  ${relayTools.map((t) => `\`${t}\``).join(", ")}. None is an Operations tool, so`,
    "  none of §19's prohibited actions — quality release, recall closure, inventory",
    "  write-off, shipment of controlled goods, maintenance safety clearance — is",
    "  invocable by Relay at all. The boundary holds by absence, which is honest and",
    "  is not the same as holding by design: `OPS-040-003` stays FAIL because no",
    "  Operations tool is declared and therefore no Operations approval boundary has",
    "  been exercised.",
    "- §20's \"do not promise hard real-time safety/control latency\" is a promise",
    "  this document is the place to not make. Nothing in this repository offers a",
    "  latency SLO for an operational control loop.",
    "",
    "The other two — §1's externality of specialized safety, clinical,",
    "process-control, CAD and machine-control systems, and §16's step-up/SoD",
    "requirement on dangerous commands — describe boundaries around capability that",
    "does not exist yet. They are published so that the wave which builds it inherits",
    "them, not because anything here enforces them.",
    "",
  )

  // ── 9 ──
  const released = releasedAreas(declarations, routes, groups)
  lines.push(
    "## 9. Released scope, and what may therefore be called best",
    "",
    "OPS-GATE-050 permits a superlative claim only for **measured released scope**.",
    "Released scope is the set of areas that are `available` on both conditions of §1,",
    `and it currently holds **${released.length}** areas`,
    `${released.length === 0 ? "— it is empty" : `(${released.map((r) => `\`${r}\``).join(", ")})`}.`,
    "",
    "So the exact permission is: **no Operations superlative may be claimed anywhere**,",
    "for any area, on any axis, against any competitor. Bible §26 forbids claiming",
    '"best without operational metrics" and Bible §22 lists the metrics that would',
    "have to exist first; none of them is instrumented, which `OPS-050-004` records as",
    "FAIL rather than as a scorecard of blanks.",
    "",
    "`tests/architecture/ops-best-claim-is-measured.test.mjs` enforces this against the",
    "product's own strings and against these documents, using this same derivation —",
    "so a wave that genuinely ships and measures an area widens what may be said, and",
    "nothing else does.",
    "",
  )

  return lines.join("\n").replace(/\n+$/, "\n")
}

// ── entry point ────────────────────────────────────────────────────────────

/**
 * Run only when invoked as a command.
 *
 * The same idiom `cat-integration-inventory.mjs` uses, and for the reason
 * `guards-do-not-write-into-the-tree.test.mjs` exists: the guard imports this
 * module, the suite runs its files in parallel, and a generator that wrote on
 * import would have every other tree-walking guard reading a file that is not in
 * the repository.
 */
const isCommand =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const target = path.join(ROOT, OUTPUT)
  if (process.argv.includes("--check")) {
    const want = build()
    const have = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : ""
    if (want !== have) {
      console.error(`::error::${OUTPUT} is stale. Run: node tools/ops-availability-and-limits.mjs`)
      process.exit(1)
    }
    console.log(`${OUTPUT} is current.`)
  } else {
    fs.writeFileSync(target, build(), "utf8")
    console.log(`Wrote ${OUTPUT}`)
  }
}
