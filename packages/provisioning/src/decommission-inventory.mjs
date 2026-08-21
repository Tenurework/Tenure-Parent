/**
 * EXT-120-001 — the legacy decommission inventory and the retirement state
 * machine it moves through.
 *
 * `docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md` §14.1
 * lists twenty-one kinds of thing to inventory and eight facts to record about
 * each; §14.2 gives the eleven-state lifecycle and five control states. This
 * module is both, and nothing else — the individual §14.3 gates are EXT-120-002
 * through -009 and are not claimed here.
 *
 * ── "we looked and found none" is a fact; "we did not look" is a finding ───
 *
 * §14.1's verb is *inventory each*. The failure that verb is written against is
 * a decommission that lists thirty applications, two databases and no service
 * accounts — not because there are none, but because nobody went and looked, and
 * an absent row is indistinguishable from an absent asset. So `kindCoverage`
 * requires every one of the twenty-one kinds to be either populated or
 * explicitly surveyed-and-empty with a reason. A kind nobody mentions is
 * `kind-not-surveyed`, which is the whole point of the check.
 *
 * ── Control states are flags, not stations ─────────────────────────────────
 *
 * §14.2 states the lifecycle as an arrow chain and then says "Control states
 * *include* LEGAL_HOLD, RETENTION_ONLY, BLOCKED_DEPENDENCY, ROLLBACK_WINDOW, and
 * ABORTED". They are not points on the chain — an asset under legal hold is
 * still at whatever lifecycle state it reached — so modelling them as states
 * would lose the position the moment a hold landed, and losing the position is
 * how an asset resumes from the wrong place when the hold lifts.
 *
 * They are therefore concurrent flags, each of which BLOCKS a specific span of
 * the chain. The spans are not invented: each is the sentence §14.3 states about
 * that control, cited on the rule.
 *
 * ── Nothing here destroys anything ─────────────────────────────────────────
 *
 * This is the register and its transition rules. §14.3's own text says of
 * hardware "do not direct Claude to physically destroy hardware", and the same
 * restraint applies to every other disposition: `transitionProblems` decides
 * whether a move is permitted, and no function in this file performs one.
 *
 * ── Why JavaScript in a TypeScript package ─────────────────────────────────
 *
 * Same reason as `cutover-runbook.mjs`: Node 20, which CI pins, cannot load
 * TypeScript, and both readers — `node --test` and the generator under `tools/`
 * — run there.
 */

/**
 * §14.1's twenty-one kinds, in the document's order.
 *
 * `phrase` is the document's own word so the list can be checked against §14.1
 * by a reader rather than trusted, exactly as `REQUIRED_SEAT_FACTS` does for
 * §12.2 and `WORKAROUND_FACTS` for §13.4.
 */
export const ASSET_KINDS = Object.freeze([
  Object.freeze({ key: "APPLICATION", phrase: "application" }),
  Object.freeze({ key: "DATABASE", phrase: "database" }),
  Object.freeze({ key: "SERVER", phrase: "server" }),
  Object.freeze({ key: "STORAGE_VOLUME", phrase: "storage volume" }),
  Object.freeze({ key: "FILE_SHARE", phrase: "file share" }),
  Object.freeze({ key: "INTEGRATION", phrase: "integration" }),
  Object.freeze({ key: "BATCH_JOB", phrase: "batch job" }),
  Object.freeze({ key: "SERVICE_ACCOUNT", phrase: "service account" }),
  Object.freeze({ key: "CERTIFICATE_OR_KEY", phrase: "certificate/key" }),
  Object.freeze({ key: "DNS_ENTRY", phrase: "DNS entry" }),
  Object.freeze({ key: "FIREWALL_RULE", phrase: "firewall rule" }),
  Object.freeze({ key: "QUEUE_OR_TOPIC", phrase: "queue/topic" }),
  Object.freeze({ key: "REPORT", phrase: "report" }),
  Object.freeze({ key: "DESKTOP_CLIENT", phrase: "desktop client" }),
  Object.freeze({ key: "MOBILE_APP", phrase: "mobile app" }),
  Object.freeze({ key: "ARCHIVE", phrase: "archive" }),
  Object.freeze({ key: "BACKUP", phrase: "backup" }),
  Object.freeze({ key: "MONITORING_RULE", phrase: "monitoring rule" }),
  Object.freeze({ key: "VENDOR_CONTRACT_OR_LICENSE", phrase: "vendor contract/license" }),
  Object.freeze({ key: "CLOUD_RESOURCE", phrase: "cloud resource" }),
  Object.freeze({ key: "PHYSICAL_DEVICE", phrase: "physical device" }),
])

/**
 * §14.1's eight recorded facts.
 *
 * `list: true` marks the three that are meaningless as a single string: one user
 * is not a user population, one dependency is not a dependency map, and one data
 * class is not a classification.
 */
export const ASSET_FACTS = Object.freeze([
  Object.freeze({ key: "owner", phrase: "owner" }),
  Object.freeze({ key: "users", phrase: "users", list: true }),
  // `stateDependent` — the ONLY fact whose absence is judged against §14.2's
  // chain rather than on its own, and it is therefore checked by
  // `inventoryProblems` and skipped by `assetProblems`. An asset at DISCOVERED
  // has been found and not yet mapped, so it legitimately has no dependency
  // list; one at DEPENDENCY_MAPPED or beyond must, and an EMPTY list is the
  // right answer for an asset with none because it says somebody looked.
  // Checking it in both places would report one absence as two defects.
  Object.freeze({ key: "dependencies", phrase: "dependencies", list: true, stateDependent: true }),
  Object.freeze({ key: "dataClasses", phrase: "data classes", list: true }),
  Object.freeze({ key: "retentionOrHold", phrase: "retention/hold" }),
  Object.freeze({ key: "authoritativeRecords", phrase: "authoritative records" }),
  Object.freeze({ key: "cost", phrase: "cost" }),
  Object.freeze({ key: "targetDisposition", phrase: "target disposition" }),
])

/** §14.2's lifecycle, in order. Position in this array IS the ordering rule. */
export const RETIREMENT_STATES = Object.freeze([
  "DISCOVERED",
  "DEPENDENCY_MAPPED",
  "RETIREMENT_APPROVED",
  "CHANGE_FROZEN",
  "READ_ONLY",
  "ARCHIVING",
  "ACCESS_REVOKING",
  "DESTROYING",
  "VERIFIED",
  "CONTRACT_CLOSED",
  "RETIRED_TOMBSTONE",
])

/**
 * §14.2's control states, each with the span of the chain it blocks and the
 * §14.3 sentence that says so.
 *
 * `blocksFrom` is the lifecycle state a flagged asset may not advance OUT of.
 * `null` means it blocks every forward move, wherever the asset is.
 */
export const CONTROL_STATES = Object.freeze([
  Object.freeze({
    key: "LEGAL_HOLD",
    blocksFrom: "ACCESS_REVOKING",
    because:
      '§14.3: "Reconciliation and record/legal-hold sign-offs pass." A hold is the record ' +
      "surviving the system, so the asset may be archived and made read-only and may not be " +
      "destroyed.",
  }),
  Object.freeze({
    key: "RETENTION_ONLY",
    blocksFrom: "ACCESS_REVOKING",
    because:
      '§14.3: "Backups, replicas, logs, caches, endpoints, snapshots, archives, and ' +
      'disaster-recovery copies follow approved disposition." An asset retained for a ' +
      "retention schedule is kept deliberately; destroying it is the schedule not being followed.",
  }),
  Object.freeze({
    key: "BLOCKED_DEPENDENCY",
    blocksFrom: "DEPENDENCY_MAPPED",
    because:
      '§14.3: "Downstream integrations/reports/users are migrated or formally retired." ' +
      "Approving retirement while something still depends on it approves the outage rather than " +
      "the retirement.",
  }),
  Object.freeze({
    key: "ROLLBACK_WINDOW",
    blocksFrom: "READ_ONLY",
    because:
      '§14.3: "Source becomes read-only for a defined rollback/reference period with monitored ' +
      'access." Archiving away from a source inside its own rollback window removes the fallback ' +
      "the window exists to be.",
  }),
  Object.freeze({
    key: "ABORTED",
    blocksFrom: null,
    because:
      "§14.2 lists ABORTED among the control states. A retirement somebody stopped does not " +
      "continue advancing; it stops where it was, so the decision to resume is visible as a " +
      "decision.",
  }),
])

const named = (value) => typeof value === "string" && value.trim().length > 0
const filled = (value) => (Array.isArray(value) ? value.filter(named).length > 0 : named(value))
const KIND_KEYS = new Set(ASSET_KINDS.map((k) => k.key))
const CONTROL_BY_KEY = new Map(CONTROL_STATES.map((c) => [c.key, c]))

/** The state after `state`, or null at the end of the chain. */
export function nextState(state) {
  const i = RETIREMENT_STATES.indexOf(named(state) ? state.trim() : "")
  if (i < 0 || i === RETIREMENT_STATES.length - 1) return null
  return RETIREMENT_STATES[i + 1]
}

/**
 * Whether one asset may move from `from` to `to` while holding `controls`.
 *
 * Forward exactly one step. Not "forward", one STEP: §14.2's chain is a sequence
 * of things that must each happen, and a jump from `READ_ONLY` straight to
 * `VERIFIED` is not a fast retirement, it is three of them that did not occur —
 * the archive, the revocation and the destruction. Skipping is therefore refused
 * by name rather than tolerated as progress.
 *
 * Backwards is refused for the same reason in the other direction: an asset that
 * was destroyed cannot return to READ_ONLY, and a register that lets it say so
 * is a register that can be made to agree with any story.
 */
export function transitionProblems(from, to, controls = []) {
  const problems = []
  const bad = (reason, detail) => problems.push(Object.freeze({ from, to, reason, detail }))

  const held = [...controls].map((c) => String(c).trim()).filter((c) => c.length > 0)

  for (const control of held) {
    if (!CONTROL_BY_KEY.has(control)) {
      bad(
        "unknown-control-state",
        `"${control}" is not one of §14.2's control states ` +
          `(${CONTROL_STATES.map((c) => c.key).join(", ")}). A flag nobody defined blocks nothing ` +
          `and reassures everybody.`,
      )
    }
  }

  const i = RETIREMENT_STATES.indexOf(named(from) ? from.trim() : "")
  const j = RETIREMENT_STATES.indexOf(named(to) ? to.trim() : "")

  for (const [label, value, index] of [
    ["from", from, i],
    ["to", to, j],
  ]) {
    if (index >= 0) continue
    const key = named(value) ? value.trim() : ""
    if (CONTROL_BY_KEY.has(key)) {
      bad(
        "control-state-is-not-a-lifecycle-state",
        `"${key}" is a §14.2 control state, used here as the ${label} of a transition. Control ` +
          `states are flags held ALONGSIDE a lifecycle state; moving an asset "into" one would ` +
          `discard the position it had reached, which is exactly what has to be remembered for ` +
          `the day the flag lifts.`,
      )
      continue
    }
    bad(
      "unknown-state",
      `"${value}" is not one of §14.2's ${RETIREMENT_STATES.length} lifecycle states.`,
    )
  }
  if (i < 0 || j < 0) return Object.freeze(problems)

  if (j === i) {
    bad("no-transition", `The asset is already at ${from}.`)
    return Object.freeze(problems)
  }
  if (j < i) {
    bad(
      "backwards-transition",
      `${from} → ${to} moves back down §14.2's chain. Retirement steps are things that happened; ` +
        `un-happening one in the register is how an asset ends up recorded as read-only after its ` +
        `storage was wiped.`,
    )
    return Object.freeze(problems)
  }
  if (j > i + 1) {
    bad(
      "skipped-states",
      `${from} → ${to} skips ${RETIREMENT_STATES.slice(i + 1, j).join(", ")}. §14.2's chain is a ` +
        `sequence of things that must each occur; skipping is not a faster retirement, it is that ` +
        `many that did not happen.`,
    )
    return Object.freeze(problems)
  }

  for (const control of held) {
    const rule = CONTROL_BY_KEY.get(control)
    if (!rule) continue
    const blocked =
      rule.blocksFrom === null ||
      RETIREMENT_STATES.indexOf(from.trim()) >= RETIREMENT_STATES.indexOf(rule.blocksFrom)
    if (blocked) {
      bad(
        "blocked-by-control-state",
        `${from} → ${to} is blocked while ${control} is held. ${rule.because}`,
      )
    }
  }

  return Object.freeze(problems)
}

/** Every way one inventoried asset fails §14.1, in a stable order. */
export function assetProblems(asset) {
  const problems = []
  const bad = (field, reason, detail) =>
    problems.push(Object.freeze({ id: asset?.id ?? "(unidentified)", field, reason, detail }))

  if (!named(asset?.id)) {
    bad(
      "id",
      "unidentified-asset",
      "An asset with no id cannot be depended on, reconciled against a bill, or shown retired.",
    )
  }
  const kind = named(asset?.kind) ? asset.kind.trim() : null
  if (kind === null || !KIND_KEYS.has(kind)) {
    bad(
      "kind",
      "unknown-kind",
      `"${asset?.kind}" is not one of §14.1's ${ASSET_KINDS.length} kinds. A kind invented in the ` +
        `register is one no gate in §14.3 was written for.`,
    )
  }

  for (const fact of ASSET_FACTS) {
    const value = asset?.[fact.key]
    if (fact.stateDependent) continue
    if (!filled(value)) {
      bad(
        fact.key,
        "fact-missing",
        `The asset records no ${fact.phrase}. §14.1 requires all ${ASSET_FACTS.length}; without ` +
          `this one the gate in §14.3 that reads it cannot be evaluated, and an unevaluated gate ` +
          `passes.`,
      )
    }
  }

  const state = named(asset?.state) ? asset.state.trim() : null
  if (state === null || !RETIREMENT_STATES.includes(state)) {
    bad(
      "state",
      "unknown-state",
      `"${asset?.state}" is not one of §14.2's ${RETIREMENT_STATES.length} lifecycle states.`,
    )
  }

  for (const control of Array.isArray(asset?.controls) ? asset.controls : []) {
    if (!CONTROL_BY_KEY.has(String(control).trim())) {
      bad(
        "controls",
        "unknown-control-state",
        `"${control}" is not one of §14.2's control states.`,
      )
    }
  }

  return Object.freeze(problems)
}

/**
 * The findings that only exist across the register.
 *
 * Three of them, and each is a shape one row cannot show:
 *
 *   · a dependency pointing at an asset nobody inventoried — the register
 *     believes it has mapped a dependency onto something outside its own world;
 *   · an asset past `DISCOVERED` whose dependencies were never listed at all,
 *     which is `DEPENDENCY_MAPPED` claimed rather than performed;
 *   · a dependency cycle, which makes any retirement ORDER impossible and is
 *     found here rather than discovered when the first of the pair is switched
 *     off.
 */
export function inventoryProblems(assets) {
  const problems = []
  const list = Array.isArray(assets) ? assets : []

  for (const asset of list) {
    problems.push(...assetProblems(asset))
  }

  const byId = new Map()
  for (const asset of list) {
    const id = named(asset?.id) ? asset.id.trim() : null
    if (!id) continue
    if (byId.has(id)) {
      problems.push(
        Object.freeze({
          id,
          field: "id",
          reason: "duplicate-asset",
          detail: `Two assets are inventoried as "${id}". Two rows, one thing: whichever is read ` +
            `first decides its owner, its data classes and whether it can be destroyed.`,
        }),
      )
    }
    byId.set(id, asset)
  }

  for (const asset of list) {
    const id = named(asset?.id) ? asset.id.trim() : "(unidentified)"
    const deps = Array.isArray(asset?.dependencies) ? asset.dependencies : null
    const state = named(asset?.state) ? asset.state.trim() : null

    if (deps === null && state !== null && RETIREMENT_STATES.indexOf(state) > 0) {
      problems.push(
        Object.freeze({
          id,
          field: "dependencies",
          reason: "dependency-unmapped",
          detail:
            `"${id}" is at ${state}, past DISCOVERED, and lists no dependencies — not an empty ` +
            `list, no list. §14.2's second state is DEPENDENCY_MAPPED, and reaching it without a ` +
            `map is the claim without the work. An asset with genuinely no dependencies records ` +
            `an empty list, which says somebody looked.`,
        }),
      )
      continue
    }

    for (const dep of deps ?? []) {
      const key = named(dep) ? dep.trim() : null
      if (key === null) continue
      if (!byId.has(key)) {
        problems.push(
          Object.freeze({
            id,
            field: "dependencies",
            reason: "dangling-dependency",
            detail:
              `"${id}" depends on "${key}", which is not in the inventory. §14.1's verb is ` +
              `"inventory each"; a dependency on something outside the register is a retirement ` +
              `whose blast radius nobody has measured.`,
          }),
        )
      }
    }
  }

  for (const cycle of dependencyCycles(list)) {
    problems.push(
      Object.freeze({
        id: cycle[0],
        field: "dependencies",
        reason: "dependency-cycle",
        detail:
          `${cycle.join(" → ")} depend on each other in a circle. No retirement order exists, so ` +
          `whichever is switched off first takes the other with it.`,
      }),
    )
  }

  return Object.freeze(problems)
}

/**
 * Dependency cycles in the inventory, each reported once from its lowest id.
 *
 * Deliberately not imported from `cutover-runbook.mjs`'s `dependencyCycles`:
 * that one walks a task's `prerequisites` and returns cycles among runbook
 * tasks. The graph shape is the same and the NOUN is not, and an import would
 * make a future change to how a runbook orders tasks silently change what a
 * legacy inventory calls a circular dependency. The note in `cutover-plan-levels`
 * makes the opposite call for milestones-vs-tasks because those two are the same
 * graph under a different word; an asset graph is a different graph.
 */
export function dependencyCycles(assets) {
  const list = Array.isArray(assets) ? assets : []
  const edges = new Map(
    list
      .filter((a) => named(a?.id))
      .map((a) => [
        a.id.trim(),
        (Array.isArray(a.dependencies) ? a.dependencies : []).filter(named).map((d) => d.trim()),
      ]),
  )

  const cycles = []
  const seen = new Set()
  const state = new Map()

  const walk = (node, path) => {
    if (state.get(node) === "done") return
    if (state.get(node) === "open") {
      const at = path.indexOf(node)
      if (at >= 0) {
        const cycle = [...path.slice(at), node]
        const canonical = [...cycle].sort().join("|")
        if (!seen.has(canonical)) {
          seen.add(canonical)
          cycles.push(Object.freeze(cycle))
        }
      }
      return
    }
    state.set(node, "open")
    for (const next of edges.get(node) ?? []) {
      if (edges.has(next)) walk(next, [...path, node])
    }
    state.set(node, "done")
  }

  for (const id of [...edges.keys()].sort()) walk(id, [])
  return Object.freeze(cycles)
}

/**
 * Whether every one of §14.1's twenty-one kinds was actually surveyed.
 *
 * `surveyed` is the caller's list of kinds it went and looked at, with a reason
 * for each that turned up nothing. A kind with assets is surveyed by having
 * them. A kind with neither assets nor a survey note is `kind-not-surveyed` —
 * and that is the finding this function exists for, because an empty row and an
 * unasked question look identical in every report ever printed.
 */
export function kindCoverage(assets, surveyed = []) {
  const list = Array.isArray(assets) ? assets : []
  const notes = new Map(
    (Array.isArray(surveyed) ? surveyed : [])
      .filter((s) => named(s?.kind))
      .map((s) => [s.kind.trim(), s]),
  )

  const counts = new Map(ASSET_KINDS.map((k) => [k.key, 0]))
  for (const asset of list) {
    const kind = named(asset?.kind) ? asset.kind.trim() : null
    if (kind !== null && counts.has(kind)) counts.set(kind, counts.get(kind) + 1)
  }

  const rows = []
  const problems = []

  for (const kind of ASSET_KINDS) {
    const count = counts.get(kind.key)
    const note = notes.get(kind.key)
    if (count > 0) {
      rows.push(Object.freeze({ kind: kind.key, count, surveyed: true, note: null }))
      continue
    }
    if (note && named(note.foundNoneBecause)) {
      rows.push(Object.freeze({ kind: kind.key, count: 0, surveyed: true, note: note.foundNoneBecause }))
      continue
    }
    rows.push(Object.freeze({ kind: kind.key, count: 0, surveyed: false, note: null }))
    problems.push(
      Object.freeze({
        kind: kind.key,
        reason: note ? "survey-unreasoned" : "kind-not-surveyed",
        detail: note
          ? `The ${kind.phrase} survey found nothing and does not say why. "There are none" and ` +
            `"we could not enumerate them" are different answers and this record gives neither.`
          : `§14.1 says to inventory each ${kind.phrase}. None is listed and no survey says there ` +
            `are none. An absent row reads exactly like an absent asset, and this is the one ` +
            `check that can tell them apart.`,
      }),
    )
  }

  return Object.freeze({ rows: Object.freeze(rows), problems: Object.freeze(problems) })
}
