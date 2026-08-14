import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-010-002 — the landing-zone model is a claim about three real files, and
 * this is what holds them to each other.
 *
 * The requirement is "model or reconcile Management, Security, Log Archive,
 * Infrastructure, Tenure Parent, Nonproduction, Production Cells, Dedicated
 * Tenants, and Quarantine OUs/accounts". There is no AWS Organization — the
 * inventory of 2026-07-31 recorded three `organizations:*` calls denied and
 * `organization.inUse: false` — so nothing can be reconciled *in AWS*, and
 * ADR-0007 records why creating one is the operator's decision and not mine.
 * What can be done, and is what this guards, is the other verb: a model of the
 * nine nodes, with every resource the estate actually contains placed against
 * one of them.
 *
 * A model written as a paragraph rots the first time either side moves, and it
 * rots silently — the document still reads correctly. So the correspondence is
 * checked in three directions, each against a file somebody else maintains:
 *
 *   1. the nine names come from the requirement text itself, in
 *      `docs/implementation/Tenure_Claude_Code_Global_Engine_Execution_Prompt_v1.0.md`;
 *   2. the eight OUs come from the tree ADR-0007 fixed;
 *   3. the resources come from `docs/architecture/aws-inventory.json`, which the
 *      read-only inventory workflow rewrites.
 *
 * So an inventory run that finds a new bucket reds this file until the model
 * says where that bucket goes, which is the difference between a mapping and a
 * paragraph. And the last assertion is the one that matters most in this
 * repository: while the inventory says no Organization exists, no node in the
 * model may claim to exist and no placement may claim to have been applied. A
 * model that quietly promotes itself to a description of reality is the
 * fabrication this programme keeps paying for.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const MODEL = "docs/architecture/ge-landing-zone-model.json"
const DOC = "docs/architecture/ge-landing-zone-model.md"
const ADR = "docs/decisions/ADR-0007-tenure-owned-aws-organization.md"
const INVENTORY = "docs/architecture/aws-inventory.json"
const PROMPT = "docs/implementation/Tenure_Claude_Code_Global_Engine_Execution_Prompt_v1.0.md"

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")
const readJson = (file) => JSON.parse(read(file))

/**
 * The nine nodes the requirement names, read from the requirement.
 *
 * Hard-coding the nine here would mean the model is checked against a copy of
 * the requirement rather than against the requirement, and a copy is what goes
 * stale. The `and` before the last name is folded into the comma list so the
 * split is one rule rather than two.
 */
export function nodesTheRequirementNames(promptText) {
  const line = /^-\s*\[[ xX]\]\s*GE-010-002\s*[—–-]\s*(.+)$/m.exec(promptText)
  if (!line) return null
  const list = /\breconcile\s+([\s\S]+?)\s+OUs\/accounts\b/.exec(line[1])
  if (!list) return null
  return list[1]
    .replace(/,?\s+and\s+/g, ",")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
}

/**
 * The OU tree ADR-0007 fixed, read from the fenced block that draws it.
 *
 * Two spaces or more separate a name from its gloss in that block, which is
 * what lets "Tenure Parent" and "Log Archive" survive as single names.
 */
export function ouTreeIn(adrText) {
  const block = /```[^\n]*\nRoot\n([\s\S]*?)```/.exec(adrText)
  if (!block) return null
  const names = []
  for (const line of block[1].split("\n")) {
    const m = /^(?:├──|└──)\s+(.+?)(?:\s{2,}|\s*$)/.exec(line)
    if (m) names.push(m[1].trim())
  }
  return names
}

/**
 * Every named resource the AWS inventory records, as a stable key.
 *
 * Derived rather than listed, so the estate growing is what reds this file.
 * Certificates are deliberately not derived: the inventory identifies a
 * certificate only by domain and status, and three of the four share the domain
 * `app.tenurework.com`, so there is no key that is unique — a derivation that
 * silently collapsed three real resources into one would be worse than not
 * deriving them. Subnets, security groups and NAT gateways are counts in the
 * inventory, not names, and nothing can be placed by a count.
 */
export function estateResources(inv) {
  const out = []
  const add = (kind, name) => out.push(`${kind}:${name}`)

  for (const vpc of inv.network.vpcs) add("vpc", vpc.name ?? vpc.cidr)
  for (const lb of inv.network.loadBalancers) add("alb", lb.name)
  for (const dist of inv.edge.cloudfront) add("cloudfront", dist.domain)
  for (const cluster of inv.compute.ecsClusters) add("ecs-cluster", cluster)
  for (const repo of inv.compute.ecrRepositories) add("ecr", repo)
  for (const fn of inv.compute.lambdaFunctions) add("lambda", fn)
  for (const db of inv.data.rds) add("rds", db.identifier)
  for (const table of inv.data.dynamoTables) add("dynamodb", table)
  for (const cache of inv.data.elasticache) add("elasticache", cache.id)
  for (const bucket of inv.data.s3Buckets) add("s3", bucket)
  for (const queue of inv.messaging.sqsQueues) add("sqs", queue)
  for (const secret of inv.keysAndSecrets.secrets) add("secret", secret.name)
  for (const group of inv.observability.logGroups) add("log-group", group.name)
  for (const alarm of inv.observability.alarms) add("alarm", alarm.name)
  for (const role of inv.iam.deploymentRoles) add("iam-role", role)

  // Sorted by code unit, which is the same on every platform. The model file is
  // compared against this list, so the order has to be a property of the data.
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

test("the derivations read the real files rather than matching nothing", () => {
  // Every assertion below is an equality between two derived lists, and two
  // empty lists are equal. These floors are what stop a regex that stopped
  // matching from reporting a clean repository.
  const named = nodesTheRequirementNames(read(PROMPT))
  assert.ok(named, `GE-010-002 was not found in ${PROMPT} — the requirement line's shape has changed.`)
  assert.equal(named.length, 9, `The requirement names ${named.length} nodes, expected 9: ${named.join(", ")}`)

  const tree = ouTreeIn(read(ADR))
  assert.ok(tree, `The OU tree was not found in ${ADR} — the fenced block's shape has changed.`)
  assert.equal(tree.length, 8, `ADR-0007 draws ${tree.length} OUs under Root, expected 8: ${tree.join(", ")}`)

  const resources = estateResources(readJson(INVENTORY))
  assert.ok(resources.length >= 35, `Only ${resources.length} resources derived from the inventory; expected at least 35.`)
  assert.ok(
    resources.includes("rds:tenure-pilot-db"),
    "The pilot database is not in the derived estate, so the derivation is not reading the inventory.",
  )
})

test("the model carries exactly the nodes the requirement names", () => {
  const model = readJson(MODEL)
  const modelled = model.nodes.map((n) => n.name).sort()
  const named = nodesTheRequirementNames(read(PROMPT)).sort()

  assert.deepEqual(
    modelled,
    named,
    "The landing-zone model and GE-010-002 disagree about which nodes exist. The requirement is the " +
      "source; add or remove the node rather than editing the requirement.",
  )
})

test("the OUs in the model are the ones ADR-0007 fixed", () => {
  const model = readJson(MODEL)
  const tree = ouTreeIn(read(ADR)).sort()
  const ous = model.nodes
    .filter((n) => n.kind === "ou")
    .map((n) => n.name)
    .sort()

  assert.deepEqual(
    ous,
    tree,
    "The model's OUs and the tree in ADR-0007 disagree. The ADR is the decision; the model is its " +
      "machine-readable form, so one of them was edited without the other.",
  )
})

test("the management account is modelled as an account, and still runs nothing", () => {
  const model = readJson(MODEL)
  const accounts = model.nodes.filter((n) => n.kind === "account")

  assert.deepEqual(
    accounts.map((n) => n.name),
    ["Management"],
    "Management is the one node that is an account rather than an OU — it is the account the " +
      "Organization is created from, and an OU cannot be one.",
  )
  assert.match(
    read(ADR),
    /The management account runs nothing/,
    "ADR-0007 no longer states that the management account runs nothing, and the model still assumes it.",
  )
  assert.deepEqual(
    accounts[0].workloads,
    [],
    "A workload is recorded in the management account. ADR-0007 fixes it as running nothing: no " +
      "workload, no pipeline, no application data.",
  )
})

test("every resource in the estate is placed exactly once, against a modelled node", () => {
  const model = readJson(MODEL)
  const nodes = new Set(model.nodes.map((n) => n.name))
  const placed = model.placements.map((p) => p.resource).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const derived = estateResources(readJson(INVENTORY))

  assert.deepEqual(
    placed,
    derived,
    "The estate and the model's placements disagree. Every resource the inventory records has to be " +
      "placed somewhere in the target landing zone; a resource nobody placed is one nobody decided " +
      "the blast radius of.",
  )

  const unknown = model.placements
    .filter((p) => p.node !== null && !nodes.has(p.node))
    .map((p) => `${p.resource} → ${p.node}`)
  assert.deepEqual(unknown, [], "A placement names a node the model does not carry.")
})

test("a resource the model cannot place yet says why, and the number of them may only fall", () => {
  const model = readJson(MODEL)
  const undecided = model.placements.filter((p) => p.node === null)

  const unreasoned = undecided
    .filter((p) => !/ADR-\d+/.test(p.undecided_reason ?? ""))
    .map((p) => p.resource)
  assert.deepEqual(
    unreasoned,
    [],
    "A placement is left undecided without naming the decision that would settle it. `node: null` is " +
      "how an honest gap is recorded; without a reason it is how a gap is hidden.",
  )

  // A ratchet, in the same shape as the ones in `oidc-trust.test.mjs`: it may
  // fall as decisions land and may not be raised to make an edit green.
  assert.ok(
    model.max_undecided_placements <= 2,
    `max_undecided_placements is ${model.max_undecided_placements}. It may only fall — raising it is ` +
      "how an unplaced resource becomes permanent.",
  )
  assert.ok(
    undecided.length <= model.max_undecided_placements,
    `${undecided.length} placements are undecided and the model allows ${model.max_undecided_placements}.`,
  )
})

test("nothing in the model claims to exist while the inventory says no Organization does", () => {
  // The assertion this file exists for. Everything above keeps the model honest
  // about its own shape; this keeps it honest about reality. An agent that
  // "completed" GE-010 by flipping these booleans would be recording an
  // Organization nobody created, in a repository whose measured history is
  // exactly that failure.
  const inv = readJson(INVENTORY)
  const model = readJson(MODEL)

  assert.equal(
    inv.organization.inUse,
    false,
    "The inventory now reports an Organization in use. Re-derive this model against it — the " +
      "assertions below assume there is nothing to reconcile against.",
  )
  assert.equal(model.organization.exists, false, "The model claims an Organization that the inventory does not see.")

  const claiming = model.nodes.filter((n) => n.exists_in_aws !== false).map((n) => n.name)
  assert.deepEqual(
    claiming,
    [],
    "A node claims to exist in AWS while the inventory records no Organization at all. Nothing about " +
      "this model has been applied; GE-010-004 is the requirement that applies it, and it is blocked.",
  )

  const applied = model.placements
    .filter((p) => p.disposition !== "proposed")
    .map((p) => `${p.resource}: ${p.disposition}`)
  assert.deepEqual(applied, [], "A placement claims a disposition other than `proposed`, and none has been applied.")
})

/**
 * The per-node counts the readable document states, from its own table.
 *
 *   | Production Cells | 26 |
 *   | *undecided* | 2 |
 */
export function statedCounts(docText) {
  const counts = new Map()
  for (const m of docText.matchAll(/^\|\s*\*?([A-Za-z][A-Za-z ]*?)\*?\s*\|\s*(\d+)\s*\|\s*$/gm)) {
    counts.set(m[1].trim(), Number(m[2]))
  }
  return counts
}

test("the readable model and the machine-readable one name the same nodes", () => {
  const model = readJson(MODEL)
  const doc = read(DOC)

  const missing = model.nodes.filter((n) => !doc.includes(n.name)).map((n) => n.name)
  assert.deepEqual(missing, [], `${DOC} does not mention every node in ${MODEL}.`)

  // The counts in the prose are the part that rots, and it rotted once while
  // this file was being written: two registries moved to Infrastructure and the
  // table still read 8 and 3. A number in a document is believed.
  const stated = statedCounts(doc)
  assert.ok(stated.size >= 4, `Only ${stated.size} counts parsed out of ${DOC}; its table's shape has changed.`)
  const actual = new Map()
  for (const p of model.placements) {
    const key = p.node ?? "undecided"
    actual.set(key, (actual.get(key) ?? 0) + 1)
  }
  const wrong = []
  for (const [node, count] of stated) {
    const real = actual.get(node) ?? 0
    if (real !== count) wrong.push(`${node}: document says ${count}, model has ${real}`)
  }
  assert.deepEqual(wrong, [], `${DOC} states a placement count the model disagrees with.`)

  for (const source of model.sources) {
    assert.ok(fs.existsSync(path.join(ROOT, source)), `${MODEL} cites \`${source}\`, which does not exist.`)
  }
})
