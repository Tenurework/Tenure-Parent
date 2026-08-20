#!/usr/bin/env node
/**
 * EXT-020-007 — environment compare, across the nine axes the requirement
 * names, in one view.
 *
 * The requirement: *"Implement environment compare for release, IaC, schema,
 * config, mappings, packs, connectors, data class, and Relay versions."* §4.4
 * asks for the same thing in a sentence:
 *
 *   > Environment comparison showing code, schema, configuration, data
 *   > contract, pack, connector, and Relay differences in one view.
 *
 * The comparison reads the manifests EXT-020-002 declares
 * (`tools/ext-environment-manifest.mjs`), so it compares this repository's five
 * real environments rather than an example, and a field the manifest contract
 * gains is a field this sees.
 *
 * ## Four outcomes per axis, not two
 *
 * SAME and DIFFERENT are the easy ones. The other two are the reason this file
 * is worth having:
 *
 *   UNCOMPARABLE — one side or both says `null` with a stated reason. Nobody
 *   has recorded the IaC version of the local-dev class, so the compare cannot
 *   say whether it matches production. Reporting that as "different" would be a
 *   fabricated difference and reporting it as "same" would be worse.
 *
 *   NO_FIELD — §4.2's manifest supplies no field for the axis at all. This is
 *   true of exactly one of the nine: **mappings**. §4.4 says mappings are
 *   "independently versioned and bound into a signed environment release
 *   manifest", but §4.2's field list never names a mapping version. The compare
 *   says so, per axis, with the sentence; it does not quietly compare eight
 *   things and call it nine.
 *
 * ## Two axes, one field, said out loud
 *
 * The requirement names `schema` and `config` separately. §4.2 supplies one
 * field for both — "database/config schema versions". Binding each axis to it
 * and reporting `sharedField` is the honest reading: the two axes have the same
 * evidence, so they can never disagree here, and a reader who thinks they were
 * independently checked would be wrong.
 *
 *   node tools/ext-environment-compare.mjs [ENV_A ENV_B]
 */
import { classRegistry } from "./ext-environment-classes.mjs"
import { landscape, manifestSchema } from "./ext-environment-manifest.mjs"

/**
 * The nine axes of EXT-020-007's own sentence, in its order, each bound to the
 * §4.2 manifest field that carries it.
 *
 * `field: null` means §4.2 supplies nothing. That is a finding, not a gap to
 * paper over, and `AXES_WITHOUT_FIELD` reports it.
 */
export const AXES = [
  { axis: "release", field: "releaseDigest", why: "§4.4: code is built once, signed, and promoted by immutable digest." },
  { axis: "IaC", field: "iacVersion", why: "§4.2 names an IaC version per environment." },
  { axis: "schema", field: "databaseConfigSchemaVersions", why: "§4.2's 'database/config schema versions' — the same field the config axis reads.", sharedWith: "config" },
  { axis: "config", field: "databaseConfigSchemaVersions", why: "§4.2 supplies no field separating configuration version from schema version; both axes read one value.", sharedWith: "schema" },
  { axis: "mappings", field: null, why: "§4.4 says mappings are independently versioned and bound into the release manifest, but §4.2's field list names no mapping version. Nothing in a manifest can answer this axis." },
  { axis: "packs", field: "industryLocalizationPackVersions", why: "§4.2 names industry/localization pack versions." },
  { axis: "connectors", field: "connectorVersions", why: "§4.2 names connector versions." },
  { axis: "dataClass", field: "allowedDataClassifications", why: "§4.2's allowed data classifications; §4.1 sets the ceiling the manifest may claim." },
  { axis: "relay", field: "relayModelPromptToolEvaluationVersions", why: "§4.2 names Relay model/prompt/tool/evaluation versions." },
]

export const AXES_WITHOUT_FIELD = AXES.filter((a) => a.field === null).map((a) => a.axis)

export const OUTCOMES = ["SAME", "DIFFERENT", "UNCOMPARABLE", "NO_FIELD"]

/**
 * Version fields §4.2 carries that EXT-020-007's sentence does not name.
 *
 * Reported rather than compared, so a field nobody asked about is visible
 * instead of dropped. `fixtureVersion` is the one this currently finds.
 */
export function unnamedVersionFields(schema = manifestSchema()) {
  const bound = new Set(AXES.map((a) => a.field).filter(Boolean))
  return schema.filter((f) => f.group === "versions" && !bound.has(f.key)).map((f) => f.key)
}

export function manifestsById(land = landscape()) {
  return new Map(land.manifests.map((m) => [m.immutableEnvironmentId, m]))
}

/** One axis, for one pair. */
export function compareAxis(axis, a, b) {
  const spec = AXES.find((x) => x.axis === axis)
  if (!spec) throw new Error(`${axis} is not one of EXT-020-007's nine axes`)
  const base = { axis, field: spec.field, sharedWith: spec.sharedWith }
  if (spec.field === null) return { ...base, outcome: "NO_FIELD", why: spec.why }

  const has = (m) => Object.prototype.hasOwnProperty.call(m, spec.field)
  if (!has(a) || !has(b)) {
    return { ...base, outcome: "UNCOMPARABLE", why: `${!has(a) ? a.immutableEnvironmentId : b.immutableEnvironmentId} carries no ${spec.field}; the manifest was never asked.` }
  }
  const av = a[spec.field]
  const bv = b[spec.field]
  const unknownSide = []
  if (av === null) unknownSide.push(`${a.immutableEnvironmentId}: ${a.unknown?.[spec.field] ?? "null with no stated reason"}`)
  if (bv === null) unknownSide.push(`${b.immutableEnvironmentId}: ${b.unknown?.[spec.field] ?? "null with no stated reason"}`)
  if (unknownSide.length) return { ...base, outcome: "UNCOMPARABLE", why: unknownSide.join(" / ") }

  return { ...base, outcome: av === bv ? "SAME" : "DIFFERENT", a: av, b: bv }
}

/** Two environments, all nine axes, in one result. */
export function compareEnvironments(idA, idB, land = landscape()) {
  const by = manifestsById(land)
  const a = by.get(idA)
  const b = by.get(idB)
  const missing = [!a && idA, !b && idB].filter(Boolean)
  if (missing.length) return { ok: false, error: { kind: "UNKNOWN_ENVIRONMENT", ids: missing } }
  const axes = AXES.map((spec) => compareAxis(spec.axis, a, b))
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, axes.filter((x) => x.outcome === o).length]))
  return {
    ok: true,
    a: idA,
    b: idB,
    classes: { [idA]: a.class, [idB]: b.class },
    axes,
    counts,
    /**
     * `comparable` is the honest denominator: how many of the nine this pair
     * could actually be compared on. A view reporting "8 of 9 the same" when
     * six were unknown is the failure this number exists to prevent.
     */
    comparable: counts.SAME + counts.DIFFERENT,
  }
}

/** Every environment against every other, in one view. §4.4 asks for one view. */
export function compareLandscape(land = landscape()) {
  const ids = land.manifests.map((m) => m.immutableEnvironmentId)
  const pairs = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) pairs.push(compareEnvironments(ids[i], ids[j], land))
  }
  return { ids, pairs }
}

/**
 * The problems in the compare itself, as opposed to differences it found.
 *
 * A bound field §4.2 no longer has would make an axis silently UNCOMPARABLE
 * forever, which looks like an unknown environment rather than a broken
 * binding, so it is checked against the schema rather than assumed.
 */
export function compareProblems(schema = manifestSchema()) {
  const problems = []
  const keys = new Set(schema.map((f) => f.key))
  for (const a of AXES) {
    if (a.field !== null && !keys.has(a.field)) problems.push({ kind: "AXIS_BINDS_MISSING_FIELD", axis: a.axis, field: a.field })
    if (!a.why || a.why.length < 20) problems.push({ kind: "AXIS_WITHOUT_REASON", axis: a.axis })
  }
  const registry = classRegistry()
  for (const m of landscape().manifests) {
    if (!registry.has(m.class)) problems.push({ kind: "UNKNOWN_CLASS", id: m.immutableEnvironmentId, class: m.class })
  }
  return problems
}

export function render(idA, idB) {
  const out = []
  const schema = manifestSchema()
  out.push(`EXT-020-007 compare: ${AXES.length} axes; ${AXES_WITHOUT_FIELD.length} that §4.2 supplies no field for (${AXES_WITHOUT_FIELD.join(", ") || "none"})`)
  const unnamed = unnamedVersionFields(schema)
  out.push(`Version fields §4.2 carries that the requirement does not name: ${unnamed.join(", ") || "none"}`)
  out.push("")
  if (idA && idB) {
    const r = compareEnvironments(idA, idB)
    if (!r.ok) {
      out.push(`${r.error.kind}: ${r.error.ids.join(", ")}`)
      return out.join("\n")
    }
    out.push(`${r.a} (${r.classes[r.a]})  vs  ${r.b} (${r.classes[r.b]})`)
    for (const x of r.axes) {
      out.push(`  ${x.axis.padEnd(12)} ${x.outcome.padEnd(13)} ${x.outcome === "DIFFERENT" ? `${String(x.a).slice(0, 40)} | ${String(x.b).slice(0, 40)}` : (x.why ?? "")}`)
    }
    out.push(`  comparable on ${r.comparable} of ${AXES.length}: ${r.counts.SAME} same, ${r.counts.DIFFERENT} different, ${r.counts.UNCOMPARABLE} unknown, ${r.counts.NO_FIELD} unanswerable`)
    return out.join("\n")
  }
  const { ids, pairs } = compareLandscape()
  out.push(`${ids.length} environments, ${pairs.length} pairs, in one view:`)
  out.push(`  ${"pair".padEnd(50)} same diff unknown unanswerable`)
  for (const p of pairs) {
    out.push(`  ${`${p.a} ↔ ${p.b}`.padEnd(50)} ${String(p.counts.SAME).padStart(4)} ${String(p.counts.DIFFERENT).padStart(4)} ${String(p.counts.UNCOMPARABLE).padStart(7)} ${String(p.counts.NO_FIELD).padStart(12)}`)
  }
  const problems = compareProblems(schema)
  out.push("")
  out.push(`${problems.length} compare problem(s).`)
  for (const p of problems) out.push(`  ${p.kind} ${p.axis ?? p.id ?? ""} ${p.field ?? p.class ?? ""}`)
  return out.join("\n")
}

if (process.argv[1]?.endsWith("ext-environment-compare.mjs")) {
  const [a, b] = process.argv.slice(2)
  console.log(render(a, b))
  process.exit(compareProblems().length === 0 ? 0 : 1)
}
