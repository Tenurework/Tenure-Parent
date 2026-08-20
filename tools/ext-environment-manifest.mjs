#!/usr/bin/env node
/**
 * EXT-020-002 — the environment manifest: its field contract taken from §4.2,
 * a validator, and this repository's five real environments declared through it.
 *
 * The requirement: *"Implement environment manifests with AWS placement,
 * versions, data rules, access, connections, cost, expiry, entry/exit, and
 * destruction."* §4.2 lists eight bullets of fields; the requirement's own
 * sentence names nine groups. `GROUPS` binds each of the nine to the bullet
 * that supplies it, so neither list is dropped: a manifest satisfies the
 * requirement when every one of the nine groups has every field its bullet
 * names.
 *
 * ## The field names come from the document, not from taste
 *
 * §4.2's bullets are comma-separated field lists. `manifestSchema()` splits
 * them and slugs each phrase into a key — "AWS partition/account/region/cell"
 * becomes `awsPartitionAccountRegionCell`. The keys are ugly and that is the
 * point: they are derived, so a manifest cannot quietly answer a different
 * question than the one §4.2 asked. Reword a bullet and every manifest fails
 * validation until a person reconciles it, which is the correct cost of
 * changing a contract.
 *
 * ## Three states, not two
 *
 * A field can be answered, or absent, or answered `null` with a stated reason.
 * The third is the one that matters and it is why this exists at all: nobody
 * has told this repository what the ECS task's cost budget is, and
 * `costBudget: null, unknown: { costBudget: "…" }` says that, while an absent
 * key says the manifest was never asked. `UNSTATED_UNKNOWN` is the failure for
 * a `null` with no reason — "we looked and found nothing" and "we could not
 * look" are different answers and collapsing them is the bug this codebase
 * most often finds.
 *
 * ## It is bound to what the repository actually has
 *
 * Three checks reach outside the JSON:
 *
 *   - Every GitHub environment declared in `infrastructure/oidc/environments.json`
 *     is claimed by exactly one manifest. Add an environment there and this
 *     fails until somebody writes what it is for.
 *   - Every workflow a manifest names as its provisioning path exists.
 *   - Every manifest whose class is `PRODUCTION` and whose workflow touches AWS
 *     carries the `if: github.repository == …` guard that keeps this repository
 *     from rolling production. CLAUDE.md calls that guard non-negotiable; here
 *     it is also a manifest field with a test behind it.
 *
 * The class of every manifest is resolved through `ext-environment-classes.mjs`
 * (EXT-020-001), and its allowed data classifications are checked against that
 * class's §4.1 ceiling — a `LOCAL_DEV` manifest claiming production data is a
 * refusal, not a note.
 *
 *   node tools/ext-environment-manifest.mjs [--schema]
 */
import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./document-graph.mjs"
import { DATA_RUNGS, classRegistry } from "./ext-environment-classes.mjs"

export const EXTENSION_PATH = "docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md"
export const SECTION = "### 4.2 Environment manifest"
export const LANDSCAPE_PATH = "infrastructure/environments/manifests.json"
export const GITHUB_ENVIRONMENTS_PATH = "infrastructure/oidc/environments.json"
export const WORKFLOW_DIR = ".github/workflows"

const abs = (p) => path.join(ROOT, p)

/**
 * §4.2's eight bullets, each bound to the group of EXT-020-002's own sentence
 * that it supplies. One entry per bullet, in the document's order.
 *
 * `quote` is the whole bullet, verbatim. `manifestSchema()` compares it with
 * what it read, so a reworded or reordered §4.2 fails loudly instead of
 * silently rebinding a group to somebody else's fields.
 *
 * `group` is where the bullet's fields land by default. `claims` moves named
 * phrases to another group: the requirement names `expiry` and `destruction`
 * separately, and §4.2 supplies both inside a bullet that is mostly about
 * something else. Without `claims` those two groups would have no fields and
 * the requirement's sentence would be half-answered.
 *
 * `phrases` overrides the comma split where the bullet is not a plain list —
 * bullet 5's "and whether they are simulated, certified-test, or live" is one
 * qualifier of one field, and splitting it on commas invents three.
 */
export const GROUPS = [
  {
    bullet: 0,
    group: "awsPlacement",
    quote: "Immutable environment ID, tenant/program scope, class, AWS partition/account/region/cell, owner seat, creation reason, and expiry.",
    claims: { expiry: ["expiry"] },
  },
  {
    bullet: 1,
    group: "versions",
    quote: "Release digest, IaC version, database/config schema versions, industry/localization pack versions, connector versions, Relay model/prompt/tool/evaluation versions, and fixture version.",
  },
  { bullet: 2, group: "dataRules", quote: "Allowed data classifications and explicit prohibited data." },
  { bullet: 3, group: "access", quote: "Identity issuer, access groups/policies, step-up requirements, support policy, and break-glass path." },
  {
    bullet: 4,
    group: "connections",
    quote: "Network/egress allowlist, secrets namespace, KMS keys, domains, integrations, and outbound-notification suppression policy.",
  },
  {
    bullet: 5,
    group: "connections",
    quote: "Inbound/outbound integration endpoints and whether they are simulated, certified-test, or live.",
    phrases: ["Inbound/outbound integration endpoints", "whether they are simulated, certified-test, or live"],
    why: "Two fields, not four: the second is a qualifier of the first, and a comma split invents `certifiedTest` and `orLive` as fields §4.2 never asked for.",
  },
  {
    bullet: 6,
    group: "cost",
    quote: "Cost budget, anomaly threshold, schedule/scale-to-zero policy, retention, backup, refresh, snapshot, and destruction rules.",
    claims: { destruction: ["retention", "backup", "refresh", "snapshot", "destruction rules"] },
  },
  { bullet: 7, group: "entryExit", quote: "Entry criteria, exit criteria, health checks, evidence requirements, and responsible approvers." },
]

/** The nine group names from the requirement's own sentence, in its order. */
export const GROUP_NAMES = [
  "awsPlacement", "versions", "dataRules", "access", "connections", "cost", "expiry", "entryExit", "destruction",
]

let cachedText = null
function extensionText() {
  if (cachedText === null) cachedText = fs.readFileSync(abs(EXTENSION_PATH), "utf8")
  return cachedText
}

/** §4.2's bullets, in order, without the leading marker. */
export function manifestBullets(text = extensionText()) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === SECTION)
  if (start < 0) throw new Error(`${EXTENSION_PATH}: no "${SECTION}" heading — the manifest contract has no authority to read`)
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^### /.test(lines[i])) break
    if (/^- /.test(lines[i])) out.push(lines[i].replace(/^- /, "").trim())
  }
  if (out.length === 0) throw new Error(`${EXTENSION_PATH}: "${SECTION}" lists no fields`)
  return out
}

/**
 * A bullet split into the field phrases it names.
 *
 * Splitting is on commas and the final ", and"/" and " — the shape every bullet
 * in §4.2 has. A phrase containing an internal " and " that is not a separator
 * would split wrongly, so `fieldPhrases` is exercised on every real bullet in
 * the test rather than trusted.
 */
export function fieldPhrases(bullet) {
  return bullet
    .replace(/\.$/, "")
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
}

/** "AWS partition/account/region/cell" → `awsPartitionAccountRegionCell`. Deterministic; no judgement. */
export function fieldKey(phrase) {
  const words = phrase
    .replace(/[^A-Za-z0-9/\- ]/g, " ")
    .split(/[\s/\-]+/)
    .filter((w) => w !== "")
  if (words.length === 0) throw new Error(`no field key can be made from ${JSON.stringify(phrase)}`)
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("")
}

/** Every field a manifest must carry, with the group and bullet it came from. */
export function manifestSchema(text = extensionText()) {
  const bullets = manifestBullets(text)
  if (bullets.length !== GROUPS.length) {
    throw new Error(`${SECTION}: ${bullets.length} bullets, ${GROUPS.length} bound. A bullet nobody bound is a field group nobody asked for.`)
  }
  const seen = new Set()
  const out = []
  for (const g of GROUPS) {
    const bullet = bullets[g.bullet]
    if (bullet === undefined) throw new Error(`${SECTION}: group ${g.group} binds bullet ${g.bullet}, which does not exist`)
    if (bullet !== g.quote) {
      throw new Error(`${SECTION}: bullet ${g.bullet} is no longer ${JSON.stringify(g.quote)} — it says ${JSON.stringify(bullet)}. Rebind ${g.group} deliberately.`)
    }
    const phrases = g.phrases ?? fieldPhrases(bullet)
    for (const phrase of phrases) {
      const key = fieldKey(phrase)
      if (seen.has(key)) throw new Error(`${SECTION}: two fields slug to ${key}; one of them would be invisible`)
      seen.add(key)
      let group = g.group
      for (const [claimant, claimed] of Object.entries(g.claims ?? {})) {
        if (claimed.includes(phrase)) group = claimant
      }
      out.push({ key, phrase, group, bullet: g.bullet })
    }
  }
  return out
}

export function landscape() {
  return JSON.parse(fs.readFileSync(abs(LANDSCAPE_PATH), "utf8"))
}

export function githubEnvironments() {
  return JSON.parse(fs.readFileSync(abs(GITHUB_ENVIRONMENTS_PATH), "utf8")).environments.map((e) => e.name)
}

/** The data classification a manifest claims, mapped onto §4.1's ceiling ladder. */
export function claimedDataRung(manifest) {
  const v = manifest.allowedDataClassifications
  if (v === null || v === undefined) return null
  return typeof v === "string" ? v : v.rung
}

/**
 * Every problem in one manifest.
 *
 * MISSING_FIELD — §4.2 names it and the manifest does not carry it.
 * UNSTATED_UNKNOWN — the manifest says `null` without saying why it could not
 * look. UNKNOWN_CLASS — a class §4.1 does not define. DATA_ABOVE_CEILING — the
 * manifest claims data its own class may not hold. UNKNOWN_WITHOUT_FIELD — a
 * reason for a field the manifest does not have, which is a stale reason.
 */
export function validateManifest(manifest, schema = manifestSchema(), registry = classRegistry()) {
  const problems = []
  const id = manifest?.immutableEnvironmentId ?? "(no immutableEnvironmentId)"
  for (const f of schema) {
    if (!Object.prototype.hasOwnProperty.call(manifest, f.key)) {
      problems.push({ kind: "MISSING_FIELD", id, key: f.key, phrase: f.phrase, group: f.group })
      continue
    }
    if (manifest[f.key] === null && !manifest.unknown?.[f.key]) {
      problems.push({ kind: "UNSTATED_UNKNOWN", id, key: f.key, phrase: f.phrase })
    }
  }
  for (const key of Object.keys(manifest.unknown ?? {})) {
    if (!schema.some((f) => f.key === key)) problems.push({ kind: "UNKNOWN_WITHOUT_FIELD", id, key })
    else if (manifest[key] !== null) problems.push({ kind: "UNKNOWN_BUT_ANSWERED", id, key })
  }
  const cls = registry.get(manifest.class)
  if (!cls) {
    problems.push({ kind: "UNKNOWN_CLASS", id, class: manifest.class })
  } else {
    const claimed = claimedDataRung(manifest)
    if (claimed !== null) {
      if (!DATA_RUNGS.includes(claimed)) problems.push({ kind: "UNKNOWN_DATA_RUNG", id, claimed })
      else if (DATA_RUNGS.indexOf(claimed) > DATA_RUNGS.indexOf(cls.data)) {
        problems.push({ kind: "DATA_ABOVE_CEILING", id, claimed, ceiling: cls.data, class: manifest.class })
      }
    }
  }
  return problems
}

const workflowText = (name) => {
  const p = abs(path.join(WORKFLOW_DIR, name))
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null
}

/**
 * The checks that reach outside the JSON, into what the repository has.
 *
 * A manifest file nobody can contradict is a document, not a control. These
 * three are the contradictions available without an AWS credential.
 */
export function landscapeProblems(land = landscape(), schema = manifestSchema(), registry = classRegistry()) {
  const problems = []
  const manifests = land.manifests
  const ids = manifests.map((m) => m.immutableEnvironmentId)
  for (const [i, id] of ids.entries()) {
    if (ids.indexOf(id) !== i) problems.push({ kind: "DUPLICATE_ENVIRONMENT_ID", id })
  }
  for (const m of manifests) problems.push(...validateManifest(m, schema, registry))

  const declared = githubEnvironments()
  const claimed = manifests.map((m) => m.githubEnvironment).filter((n) => n !== null && n !== undefined)
  for (const name of declared) {
    if (!claimed.includes(name)) problems.push({ kind: "GITHUB_ENVIRONMENT_WITHOUT_MANIFEST", githubEnvironment: name })
  }
  for (const name of claimed) {
    if (!declared.includes(name)) problems.push({ kind: "MANIFEST_NAMES_UNDECLARED_ENVIRONMENT", githubEnvironment: name })
  }

  for (const m of manifests) {
    for (const wf of m.provisioningWorkflows ?? []) {
      const text = workflowText(wf)
      if (text === null) {
        problems.push({ kind: "PROVISIONING_WORKFLOW_MISSING", id: m.immutableEnvironmentId, workflow: wf })
        continue
      }
      if (m.class === "PRODUCTION" && m.productionGuard) {
        if (!text.includes(m.productionGuard)) {
          problems.push({ kind: "PRODUCTION_GUARD_MISSING", id: m.immutableEnvironmentId, workflow: wf, guard: m.productionGuard })
        }
      }
    }
    if (m.class === "PRODUCTION" && !m.productionGuard) {
      problems.push({ kind: "PRODUCTION_WITHOUT_GUARD", id: m.immutableEnvironmentId })
    }
  }
  return problems
}

export function render(showSchema = false) {
  const schema = manifestSchema()
  const out = []
  const byGroup = new Map()
  for (const f of schema) byGroup.set(f.group, (byGroup.get(f.group) ?? 0) + 1)
  out.push(`§4.2 manifest contract: ${schema.length} fields across ${byGroup.size} of the requirement's nine groups`)
  for (const g of GROUP_NAMES) out.push(`  ${g.padEnd(14)} ${byGroup.get(g) ?? 0} field(s)`)
  if (showSchema) for (const f of schema) out.push(`    ${f.key.padEnd(46)} ${f.group.padEnd(14)} ${f.phrase}`)
  const land = landscape()
  out.push("")
  out.push(`${LANDSCAPE_PATH}: ${land.manifests.length} environment(s)`)
  for (const m of land.manifests) {
    const unknowns = Object.keys(m.unknown ?? {}).length
    out.push(`  ${m.immutableEnvironmentId.padEnd(20)} ${m.class.padEnd(20)} github=${m.githubEnvironment ?? "—"}  ${unknowns} stated unknown(s)`)
  }
  const problems = landscapeProblems(land, schema)
  out.push("")
  out.push(`${problems.length} landscape problem(s).`)
  for (const p of problems) out.push(`  ${p.kind} ${p.id ?? p.githubEnvironment ?? ""} ${p.key ?? p.workflow ?? ""}`)
  return out.join("\n")
}

if (process.argv[1]?.endsWith("ext-environment-manifest.mjs")) {
  console.log(render(process.argv.includes("--schema")))
  process.exit(landscapeProblems().length === 0 ? 0 : 1)
}
