#!/usr/bin/env node
/**
 * EXT-060-006 — the migration wave planner: a DAG, validated before it runs,
 * with bounded parallelism and a refusal where the sequence would orphan data.
 *
 * The requirement: *"Implement dependency DAG, precondition validation,
 * bounded parallelism, and reference/master/transaction/content/delta
 * ordering."* §8.6 of the extension says what that means and is unusually
 * concrete about it:
 *
 *   > A migration wave is a DAG, not a file list. […] The engine validates
 *   > dependencies before running, supports bounded parallelism where safe, and
 *   > refuses a sequence that would create unauditable orphaned data.
 *
 * followed by seven numbered dependency layers, which are the
 * reference/master/transaction/content/delta ordering the requirement names.
 * Those seven are parsed out of the extension rather than retyped here, so a
 * layer renamed in the authority renames it here and a layer added fails the
 * guard rather than being quietly ignored.
 *
 * ## It plans this product's own conversion, not an example
 *
 * The graph is read from `apps/web/prisma/schema.prisma` — 52 models, read
 * only, never written. That is the difference between an engine and a
 * demonstration: run it and it prints the order in which THIS tenant's data
 * would have to be loaded, and it fails when the schema grows a model nobody
 * classified.
 *
 * ## Three tiers of reference, and only one of them binds the order
 *
 * DECLARED — a `@relation(fields: […], references: […])`. The database enforces
 * it, so the planner treats it as an ordering constraint and a required one
 * loading after its target is a refusal, not a warning.
 *
 * INFERRED — a scalar `…Id` the schema never declares a relation for, whose
 * field name IS declared as a relation on some other model, unanimously, and
 * whose model carries no `…Type` companion. `institutionId` is the example:
 * most models declare it as a relation, a handful carry it as a bare string,
 * and they mean the same thing.
 *
 * UNRESOLVED — a scalar `…Id` nothing in the schema explains, and several are
 * not references at all (`externalId`, `correlationId`, `traceId`). The planner
 * does NOT guess: `accountId` on a provider receipt name-matches the NextAuth
 * `Account` model and is a provider-side connected-account string, and a
 * planner that resolved it by name would have produced a confidently wrong
 * order. Run the CLI for the current list and count rather than trusting a
 * number written into a comment.
 *
 * Neither INFERRED nor UNRESOLVED binds the wave order, and the plan says so:
 * it claims orphan-freedom for the declared graph and states, in the same
 * breath and with the count, the references for which it can claim nothing.
 * "The sequence is orphan-free" and "the sequence is orphan-free for the
 * constraints the schema declares" are different claims and the second is true.
 *
 *   node tools/ext-migration-order.mjs [maxParallel]
 */
import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./document-graph.mjs"

export const EXTENSION_PATH = "docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md"
export const SCHEMA_PATH = "apps/web/prisma/schema.prisma"

const abs = (p) => path.join(ROOT, p)

/**
 * §8.6's seven dependency layers, parsed from the extension.
 *
 * Retyping them would make this file a second authority on the ordering, and
 * the first thing that happens to a second authority is that it falls behind.
 */
export function layers(text = fs.readFileSync(abs(EXTENSION_PATH), "utf8")) {
  const section = /### 8\.6 Dependency sequencing\n([\s\S]*?)\n### /.exec(text)
  if (!section) throw new Error(`§8.6 not found in ${EXTENSION_PATH}`)
  const found = []
  for (const line of section[1].split("\n")) {
    const m = /^(\d+)\.\s+(.*\S)\s*$/.exec(line)
    if (m) found.push({ layer: Number(m[1]), description: m[2] })
  }
  return found
}

// ── the schema ───────────────────────────────────────────────────────────────

const MODEL_OPEN = /^model (\w+) \{/
const RELATION_FIELD = /^\s+(\w+)\s+(\w+)(\[\])?(\?)?\s+@relation\(([^)]*)\)/
const SCALAR_FIELD = /^\s+(\w+)\s+(String|Int|BigInt|Float|Decimal)(\?)?\s*(@.*)?$/

/**
 * Models, their declared relations and their scalar fields.
 *
 * A list-valued relation (`reminders DeliverableReminder[]`) is the *other* end
 * of somebody else's foreign key and carries no `fields:`, so it is not an
 * edge here. Reading it as one would double every edge and reverse half of them.
 */
export function parseSchema(text = fs.readFileSync(abs(SCHEMA_PATH), "utf8")) {
  const models = new Map()
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const open = MODEL_OPEN.exec(line)
    if (open) {
      current = { name: open[1], relations: [], scalars: [], relationFieldNames: new Set() }
      models.set(current.name, current)
      continue
    }
    if (line === "}") {
      current = null
      continue
    }
    if (!current) continue

    const rel = RELATION_FIELD.exec(line)
    if (rel) {
      const args = rel[5]
      const fields = /fields:\s*\[([^\]]*)\]/.exec(args)
      if (fields && !rel[3]) {
        const names = fields[1].split(",").map((s) => s.trim()).filter(Boolean)
        for (const n of names) current.relationFieldNames.add(n)
        current.relations.push({ field: rel[1], target: rel[2], optional: Boolean(rel[4]), holds: names })
      }
      continue
    }
    const scalar = SCALAR_FIELD.exec(line)
    if (scalar) current.scalars.push({ name: scalar[1], optional: Boolean(scalar[3]) })
  }
  return models
}

/** DECLARED edges: `from` cannot load before `to`. */
export function declaredEdges(models) {
  const edges = []
  for (const m of models.values()) {
    for (const r of m.relations) {
      // An optional foreign key can be satisfied by a second pass; a required
      // one cannot, and that difference is the whole of the refusal below.
      const required = !r.optional && r.holds.every((h) => !(m.scalars.find((s) => s.name === h)?.optional ?? false))
      edges.push({ from: m.name, to: r.target, field: r.field, required, basis: "DECLARED" })
    }
  }
  return edges
}

/**
 * Every scalar `…Id` the schema declares no relation for, classified.
 *
 * The resolution rule is the schema's own evidence: a field name is resolved
 * only if some model declares a relation holding exactly that field name, and
 * every model that declares it agrees on the target. Name similarity is not
 * evidence — see the header on `accountId`.
 *
 * A model carrying a `<stem>Type` companion is polymorphic and is never
 * resolved, whatever the rest of the schema says. `Recusal.resourceId` points
 * at whatever `resourceType` names at runtime — its own default is
 * `ApprovalRequest` — and `Resource` is a real model in this schema, so a
 * name-matching resolver resolves it wrongly today, and the day somebody
 * declares a relation on a field called `resourceId` the unanimity rule would
 * resolve it wrongly too. The companion field is checked first for that reason.
 */
export function undeclaredReferences(models) {
  const declaredBy = new Map()
  for (const m of models.values()) {
    for (const r of m.relations) {
      for (const h of r.holds) {
        if (!declaredBy.has(h)) declaredBy.set(h, new Set())
        declaredBy.get(h).add(r.target)
      }
    }
  }
  const out = []
  for (const m of models.values()) {
    const fieldNames = new Set(m.scalars.map((s) => s.name))
    for (const s of m.scalars) {
      if (s.name === "id" || !/Id$/.test(s.name)) continue
      if (m.relationFieldNames.has(s.name)) continue
      const stem = s.name.slice(0, -2)
      const polymorphic = fieldNames.has(`${stem}Type`)
      const targets = declaredBy.get(s.name)
      const unanimous = targets && targets.size === 1 ? [...targets][0] : null
      out.push({
        model: m.name,
        field: s.name,
        optional: s.optional,
        basis: polymorphic ? "UNRESOLVED" : unanimous ? "INFERRED" : "UNRESOLVED",
        target: polymorphic ? null : unanimous,
        why: polymorphic
          ? `polymorphic — ${stem}Type names the target at runtime, so the schema cannot say what this points at`
          : unanimous
            ? `${[...targets][0]} — every declared relation holding a field named ${s.name} points there`
            : targets
              ? `ambiguous — declared relations holding ${s.name} point at ${[...targets].sort().join(" and ")}`
              : "nothing in the schema declares a relation for a field of this name",
      })
    }
  }
  return out
}

// ── classification ───────────────────────────────────────────────────────────

/**
 * Every model in the schema against §8.6's layers, with the reading that put it
 * there. A layer table with no reasons is a table nobody can disagree with.
 *
 * `NOT_MIGRATED` is a decision, not a gap. Loading a source system's outbox
 * re-delivers every event it already delivered; loading its sessions carries
 * live credentials across a cutover. Saying so is different from forgetting the
 * model, and `UNCLASSIFIED_MODEL` below is what forgetting one looks like.
 */
export const CLASSIFICATION = {
  Institution: [1, "the tenant record every other row is scoped to — layer 1 is tenant configuration"],
  Deliverable: [1, "the institutional calendar: OSE-derived deadlines keyed by term, which is layer 1's calendar content"],

  Organization: [2, "the legal/organizational entity"],
  Role: [2, "security reference object"],
  Seat: [2, "the durable position, which layer 2 names explicitly"],
  BudgetLine: [2, "chart/dimension: the account line a transaction is coded to"],
  Resource: [2, "locations and bookable institutional resources"],
  PaymentsFundsFlowConfig: [2, "organization-level funds-flow configuration, effective-dated against the entity"],

  User: [3, "person"],
  DirectoryPerson: [3, "person as the directory knows them, before any account exists"],
  InstitutionMembership: [3, "person-to-tenant assignment"],
  Account: [3, "the identity-provider link for a person"],
  SeatHolding: [3, "assignment of a person to a seat"],
  OrganizationAdvisor: [3, "assignment of an advisor to an organization"],
  RoleAssignment: [3, "assignment of a person to a role"],
  Vendor: [3, "supplier master, which layer 3 names"],
  ExternalReference: [3, "payment reference record — layer 3's bank/payment reference objects"],
  NotificationPreference: [3, "person-level preference travelling with the person"],
  ApprovalDelegation: [3, "delegated authority, an assignment of a person to a power"],
  RoleTransfer: [3, "the handoff record between two people holding one role"],
  ConflictDeclaration: [3, "a declared interest attached to a person"],
  Recusal: [3, "a standing withdrawal attached to a person"],

  Budget: [4, "opening balances"],
  ApprovalRequest: [4, "open operational document"],
  ApprovalStep: [4, "the decision line of an open operational document"],
  Event: [4, "open operational document"],
  ConflictRecord: [4, "the conflict decision taken on an event"],
  Conversation: [4, "open operational thread"],
  Participant: [4, "membership of an open thread"],
  Document: [4, "operational document with source lineage"],
  Settlement: [4, "open settlement against an external reference"],
  LedgerEntry: [4, "opening balances and open entries with source lineage"],
  ReceiptAllocation: [4, "the allocation line of an open ledger entry"],
  DeliverableReminder: [4, "scheduled operational item outstanding against a calendar deadline"],

  Transaction: [5, "historical posted transaction"],
  Message: [5, "closed historical content in a thread"],
  Delivery: [5, "the per-participant delivery record of a historical message"],
  ProviderBalanceTransaction: [5, "historical provider-side balance movement"],
  ProviderEventReceipt: [5, "historical provider webhook receipt"],

  Attachment: [6, "attachment — layer 6 names it"],
  MemoryRecord: [6, "institutional-memory record — layer 6 names it"],
  AuditEvent: [6, "evidence record retained for audit rather than operation"],
  FeedPost: [6, "content"],
  FeedComment: [6, "content"],
  CollabInterest: [6, "content-derived expression of interest"],
  Notification: [6, "projection of something that already happened"],

  Session: [null, "browser session state — re-established at first sign-in, and carrying it carries live credentials across a cutover"],
  VerificationToken: [null, "single-use short-lived token, expired before any cutover completes"],
  ConnectionLaunchToken: [null, "short-lived launch token for an external connection"],
  OutboxEvent: [null, "integration transport state — loading it re-delivers every event the source already delivered"],
  InboxEvent: [null, "inbound idempotency ledger, rebuilt by the receiving side"],
  ModelUsageMeter: [null, "metering counters, re-accumulated after cutover; carrying them double-counts"],
}

/**
 * `null` for a model deliberately not migrated, `undefined` for a model nobody
 * classified. Collapsing those two with `?? undefined` is exactly the bug this
 * repository keeps finding: it turned six recorded decisions into six unknowns
 * and the validator reported all six as being in a layer §8.6 does not declare.
 */
export const layerOf = (model) => (model in CLASSIFICATION ? CLASSIFICATION[model][0] : undefined)
export const migrated = (model) => typeof layerOf(model) === "number"

// ── precondition validation ──────────────────────────────────────────────────

/** §8.6: "The engine validates dependencies before running." These are the ways it refuses to. */
export function preconditionProblems(models, edges = declaredEdges(models), declaredLayers = layers(), { wholeSchema = true } = {}) {
  const problems = []
  const numbers = new Set(declaredLayers.map((l) => l.layer))

  for (const name of models.keys()) {
    if (!(name in CLASSIFICATION)) {
      problems.push({ kind: "UNCLASSIFIED_MODEL", detail: `${name} is in the schema and in no §8.6 layer` })
      continue
    }
    const l = layerOf(name)
    if (l !== null && !numbers.has(l)) {
      problems.push({ kind: "LAYER_NOT_IN_AUTHORITY", detail: `${name} is layer ${l}; §8.6 declares ${[...numbers].join(", ")}` })
    }
  }
  // Only against the whole schema. A fixture is a fragment by construction, and
  // reporting the other 50 models as deleted would bury the one thing it tests.
  if (wholeSchema) {
    for (const name of Object.keys(CLASSIFICATION)) {
      if (!models.has(name)) problems.push({ kind: "CLASSIFIED_MODEL_GONE", detail: `${name} is classified and no longer in the schema` })
    }
  }

  for (const e of edges) {
    if (!models.has(e.to)) {
      problems.push({ kind: "UNKNOWN_TARGET", detail: `${e.from}.${e.field} references ${e.to}, which is not a model` })
      continue
    }
    if (!e.required) continue
    if (!migrated(e.from)) continue
    if (!migrated(e.to)) {
      problems.push({
        kind: "DEPENDS_ON_NOT_MIGRATED",
        detail: `${e.from} requires ${e.to}, and ${e.to} is not migrated — every ${e.from} row would land orphaned`,
      })
      continue
    }
    if (layerOf(e.to) > layerOf(e.from)) {
      problems.push({
        kind: "LAYER_INVERSION",
        detail: `${e.from} (layer ${layerOf(e.from)}) requires ${e.to} (layer ${layerOf(e.to)}), which loads later`,
      })
    }
  }

  for (const cycle of requiredCycles(models, edges)) {
    problems.push({ kind: "REQUIRED_CYCLE", detail: cycle.join(" → ") })
  }
  return problems
}

/**
 * Cycles in the REQUIRED subgraph only.
 *
 * The optional subgraph has cycles by design — `ApprovalRequest` and `Event`
 * point at each other, both nullable — and they are not a problem: one loads,
 * the other loads, a second pass sets the nullable side. A required cycle has
 * no such pass and no order exists at all.
 */
export function requiredCycles(models, edges = declaredEdges(models)) {
  const out = new Map()
  const adj = new Map([...models.keys()].map((n) => [n, []]))
  for (const e of edges) {
    if (!e.required || !migrated(e.from) || !migrated(e.to) || e.from === e.to) continue
    if (adj.has(e.from)) adj.get(e.from).push(e.to)
  }
  const state = new Map()
  const stack = []
  const walk = (n) => {
    state.set(n, 1)
    stack.push(n)
    for (const next of adj.get(n) ?? []) {
      if (state.get(next) === 1) {
        const cycle = stack.slice(stack.indexOf(next)).concat(next)
        out.set([...cycle].sort().join("|"), cycle)
      } else if (!state.has(next)) walk(next)
    }
    stack.pop()
    state.set(n, 2)
  }
  for (const n of adj.keys()) if (!state.has(n)) walk(n)
  return [...out.values()]
}

// ── the plan ─────────────────────────────────────────────────────────────────

/**
 * Waves, in layer order, each wave a list of batches of at most `maxParallel`.
 *
 * "Bounded parallelism where safe" is two rules, not one:
 *
 *   safe   — nothing in a wave depends on anything else in that wave, which is
 *            what a topological level means, so the batch may run concurrently.
 *   bounded — a batch is capped, because the constraint at load time is the
 *            target's write capacity and not the shape of the graph.
 *
 * The layer is the outer key and the topological level the inner one, so a
 * model never loads before the layer §8.6 puts its dependencies in even where
 * the schema declares no foreign key to enforce it.
 */
export function planWaves(models, { maxParallel = 4, edges = declaredEdges(models) } = {}) {
  const nodes = [...models.keys()].filter(migrated)
  const deps = new Map(nodes.map((n) => [n, new Set()]))
  for (const e of edges) {
    if (!e.required || e.from === e.to) continue
    if (!deps.has(e.from) || !deps.has(e.to)) continue
    deps.get(e.from).add(e.to)
  }

  const waves = []
  const loaded = new Set()
  let remaining = [...nodes].sort()
  while (remaining.length > 0) {
    const lowestLayer = Math.min(...remaining.map(layerOf))
    const ready = remaining
      .filter((n) => layerOf(n) === lowestLayer)
      .filter((n) => [...deps.get(n)].every((d) => loaded.has(d)))
    if (ready.length === 0) {
      // Unreachable while `preconditionProblems` is clean; kept because a
      // planner that loops forever on a bad graph is worse than one that says so.
      throw new Error(`no model in layer ${lowestLayer} is loadable: ${remaining.filter((n) => layerOf(n) === lowestLayer).join(", ")}`)
    }
    const batches = []
    for (let i = 0; i < ready.length; i += maxParallel) batches.push(ready.slice(i, i + maxParallel))
    waves.push({ wave: waves.length + 1, layer: lowestLayer, models: ready, batches })
    for (const n of ready) loaded.add(n)
    remaining = remaining.filter((n) => !loaded.has(n))
  }
  return waves
}

/** Wave index by model, 1-based; undefined for a model that is not migrated. */
export function waveIndex(plan) {
  const at = new Map()
  for (const w of plan) for (const m of w.models) at.set(m, w.wave)
  return at
}

/**
 * §8.6: "refuses a sequence that would create unauditable orphaned data."
 *
 * A required reference loading before its target IS orphaned data, and this
 * refuses the plan. An optional one is a deferred reference: allowed, and only
 * because it is returned by `deferredReferences` and therefore auditable. An
 * optional forward reference nobody recorded is the unauditable case, which is
 * why the two functions exist rather than one.
 */
export function sequenceProblems(plan, edges) {
  const at = waveIndex(plan)
  const problems = []
  for (const e of edges) {
    if (!e.required || !migrated(e.from) || !migrated(e.to) || e.from === e.to) continue
    const from = at.get(e.from)
    const to = at.get(e.to)
    if (to === undefined) problems.push({ kind: "ORPHANED_REQUIRED_REFERENCE", detail: `${e.from}.${e.field} → ${e.to}, which the plan never loads` })
    else if (to >= from) {
      problems.push({
        kind: "ORPHANED_REQUIRED_REFERENCE",
        detail: `${e.from}.${e.field} → ${e.to}: ${e.to} loads in wave ${to}, ${e.from} in wave ${from}`,
      })
    }
  }
  return problems
}

/** Optional references whose target loads no earlier: each needs a second pass, and each is named. */
export function deferredReferences(plan, edges) {
  const at = waveIndex(plan)
  const out = []
  for (const e of edges) {
    if (e.required || !migrated(e.from) || !migrated(e.to)) continue
    const from = at.get(e.from)
    const to = at.get(e.to)
    if (to === undefined || to >= from) {
      out.push({ from: e.from, field: e.field, to: e.to, resolveAfterWave: to ?? at.size, why: e.from === e.to ? "self-reference" : "target loads in the same wave or later" })
    }
  }
  return out
}

if (process.argv[1] && path.basename(process.argv[1]) === "ext-migration-order.mjs") {
  const maxParallel = Number(process.argv[2] ?? 4)
  const models = parseSchema()
  const edges = declaredEdges(models)
  const pre = preconditionProblems(models, edges)
  console.log(`${models.size} models, ${edges.length} declared foreign keys, ${edges.filter((e) => e.required).length} of them required.`)
  console.log(`${pre.length} precondition problems.`)
  for (const p of pre) console.log(`  ✗ ${p.kind}: ${p.detail}`)
  if (pre.length > 0) process.exit(1)

  const plan = planWaves(models, { maxParallel, edges })
  for (const w of plan) {
    console.log(`\nwave ${w.wave} — layer ${w.layer}`)
    for (const b of w.batches) console.log(`  [${b.join(", ")}]`)
  }
  const seq = sequenceProblems(plan, edges)
  const deferred = deferredReferences(plan, edges)
  const undeclared = undeclaredReferences(models)
  const notMigrated = [...models.keys()].filter((m) => !migrated(m))
  console.log(`\n${plan.length} waves, max ${maxParallel} concurrent, ${notMigrated.length} models deliberately not migrated: ${notMigrated.join(", ")}.`)
  console.log(`${seq.length} orphaning refusals.`)
  for (const p of seq) console.log(`  ✗ ${p.kind}: ${p.detail}`)
  console.log(`${deferred.length} deferred references to resolve in a second pass:`)
  for (const d of deferred) console.log(`    ${d.from}.${d.field} → ${d.to} after wave ${d.resolveAfterWave} (${d.why})`)
  console.log(
    `\nOrphan-freedom is claimed for the ${edges.length} references the schema DECLARES. ` +
      `${undeclared.filter((u) => u.basis === "INFERRED").length} further scalar reference fields are inferred from the schema's own conventions and ` +
      `${undeclared.filter((u) => u.basis === "UNRESOLVED").length} cannot be resolved at all; the plan makes no orphan claim for either.`,
  )
  for (const u of undeclared.filter((x) => x.basis === "UNRESOLVED")) console.log(`    ? ${u.model}.${u.field} — ${u.why}`)
  process.exit(seq.length === 0 ? 0 : 1)
}
