/**
 * PACK-040-002 — a capability, the data it governs, and the team accountable.
 *
 * A `ModuleManifest` used to carry ten fields and none of them answered either
 * question. `budgeting` did not name `Budget`, `BudgetLine` or `LedgerEntry`;
 * `approvals` did not name `ApprovalRequest`; nothing anywhere said which team
 * was paged when one broke. `docs/architecture/ownership.md` existed and
 * `ownership.test.mjs` enforced it, but it maps FILES to domains — nothing
 * joined a module key to either.
 *
 * The consequence is not bookkeeping. With no model→module map, PACK-010-003 —
 * "no pack reaches into another pack's private storage" — has no definition of
 * "another pack's storage" to enforce, so it cannot be built either.
 *
 * ## Why the join lives here and not in the package
 *
 * `@tenure/module-runtime` is dependency-free by design: it must be importable
 * from a server component, from the Studio and from a node test, so it does not
 * read the Prisma schema and must not start. `validateManifest` therefore checks
 * that `owner` is non-empty and that `objects` is a list of strings, and this
 * file checks those strings against the two real catalogs — the same precedent
 * `manifest.ts` sets for permissions, which it validates against the actual
 * permission catalog rather than against a naming convention.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { DOMAINS } from "../../tools/ownership-map.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

/**
 * Every model the schema declares.
 *
 * Parsed rather than imported: the generated Prisma client is a build artifact
 * that may not exist in a fresh checkout, and the schema is the source either
 * way.
 */
function schemaModels() {
  return [...read("apps/web/prisma/schema.prisma").matchAll(/^model\s+(\w+)\s*\{/gm)].map(
    (m) => m[1],
  )
}

/**
 * The manifests, read as source.
 *
 * `modules/index.ts` is TypeScript that imports `@tenure/module-runtime`, and
 * this suite runs under `node --test` with no transform — so the declarations
 * are parsed out of the text. That is a real constraint of the harness rather
 * than a shortcut, and it fails loudly below if the shape it expects is gone.
 */
function manifests() {
  const source = read("modules/index.ts")
  const out = []
  // `const <name>: ModuleManifest = { ... }` up to the next top-level `}`.
  for (const match of source.matchAll(/const (\w+): ModuleManifest = \{([\s\S]*?)\n\}/g)) {
    const body = match[2]
    const key = /\bkey:\s*"([^"]+)"/.exec(body)?.[1]
    const owner = /\bowner:\s*"([^"]+)"/.exec(body)?.[1]
    const objectsBlock = /\bobjects:\s*\[([\s\S]*?)\]/.exec(body)?.[1] ?? ""
    const objects = [...objectsBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    out.push({ declaration: match[1], key, owner, objects })
  }
  return out
}

/**
 * Models no module claims.
 *
 * **May only fall.** Asserted as an equality in both directions, exactly like
 * `UNIMPORTED = 0` in `document-graph.test.mjs`: a ceiling can be raised to make
 * a build pass, which is the failure this exists to prevent, and a declaration
 * nobody maintains is worse than none.
 *
 * The eleven are the platform's own tables rather than any module's — the
 * NextAuth trio (`Account`, `Session`, `VerificationToken`), the identity
 * spine (`User`, `Institution`, `InstitutionMembership`), the notification pair,
 * the deliverables pair, and the transactional outbox. Each belongs to a domain
 * that ships no module manifest today. Claiming them for a module to make this
 * number smaller would be the wrong kind of smaller.
 */
const UNCLAIMED = 11

test("the readers actually read something", () => {
  // Every assertion below passes on an empty list, and both lists come from
  // regexes over source files.
  const models = schemaModels()
  const declared = manifests()

  assert.ok(models.length > 30, `parsed ${models.length} Prisma models — the schema regex is stale`)
  assert.equal(
    declared.length,
    12,
    `parsed ${declared.length} module manifests, expected 12 — the manifest regex is stale`,
  )
  assert.ok(
    declared.every((m) => m.key),
    "a parsed manifest has no key, so the body regex is matching the wrong thing",
  )
})

test("every module names an owner the ownership map declares", () => {
  const domains = new Set(DOMAINS.map((d) => d.key))
  const doc = read("docs/architecture/ownership.md")

  const offenders = []
  for (const m of manifests()) {
    if (!m.owner) {
      offenders.push(`${m.key}: names no owner`)
      continue
    }
    if (!domains.has(m.owner)) {
      offenders.push(`${m.key}: owner "${m.owner}" is not one of the domains in tools/ownership-map.mjs`)
      continue
    }
    // And the generated document a human reads has a row for it. The map and
    // the document are generated from one source; this fails if they diverge.
    if (!doc.includes(`\`${m.owner}\``)) {
      offenders.push(`${m.key}: owner "${m.owner}" has no entry in docs/architecture/ownership.md`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these modules name an owner nothing recognises:\n  ${offenders.join("\n  ")}\n` +
      `The value is a domain key from tools/ownership-map.mjs. A capability nobody owns is one ` +
      `nobody is paged for.`,
  )
})

test("every governed object is a model that exists", () => {
  const models = new Set(schemaModels())

  const offenders = []
  for (const m of manifests()) {
    for (const object of m.objects) {
      if (!models.has(object)) offenders.push(`${m.key} claims "${object}"`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these manifests govern models the schema does not declare:\n  ${offenders.join("\n  ")}\n` +
      `A manifest naming a table that does not exist describes a boundary nothing is inside.`,
  )
})

test("no model is claimed by two modules", () => {
  const claimedBy = new Map()
  const offenders = []

  for (const m of manifests()) {
    for (const object of m.objects) {
      if (claimedBy.has(object)) {
        offenders.push(`${object}: claimed by both ${claimedBy.get(object)} and ${m.key}`)
        continue
      }
      claimedBy.set(object, m.key)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `two modules claim the same model:\n  ${offenders.join("\n  ")}\n` +
      `Shared ownership of a table is the state PACK-010-003 exists to make impossible — if both ` +
      `may write it, neither owns its invariants.`,
  )
})

test("the number of models no module claims may only fall", () => {
  const claimed = new Set(manifests().flatMap((m) => m.objects))
  const unclaimed = schemaModels().filter((model) => !claimed.has(model))

  // Equality, not a ceiling, and in both directions — the same ratchet shape
  // `document-graph.test.mjs` uses for UNIMPORTED. Raising the constant to make
  // a build pass is the exact failure it exists to prevent, and lowering it
  // without the claim is how the number stops describing the repository.
  assert.equal(
    unclaimed.length,
    UNCLAIMED,
    `${unclaimed.length} models are claimed by no module, expected ${UNCLAIMED}:\n  ` +
      `${unclaimed.join("\n  ")}\n` +
      `If a module now governs one, lower UNCLAIMED in the same commit. If a new model belongs ` +
      `to a module, add it to that manifest's \`objects\` rather than raising this.`,
  )
})

test("every file a dimension cites is a file that exists", () => {
  /**
   * The other five things PACK-040-002 asks a registry entry to map — states,
   * integrations and tests, beside the owner and objects above — are carried by
   * the seventeen-dimension assessments rather than by five more arrays, and an
   * assessment is only worth having if its evidence can be opened.
   *
   * `validateManifest` requires the evidence to be non-trivial; it cannot check
   * the paths, because `@tenure/module-runtime` may not read the filesystem.
   * This is what turns "state-machines: pass, see calendar-write.ts" from a
   * sentence into a claim that fails when the file is renamed.
   */
  const source = read("modules/index.ts")
  const cited = new Set(
    [...source.matchAll(/\b((?:apps|packages|tests|tools|docs|modules|blueprints)\/[\w./[\]-]*\.\w+)/g)].map(
      (m) => m[1],
    ),
  )

  assert.ok(cited.size > 25, `only ${cited.size} file citations found — the path regex is stale`)

  const missing = [...cited].filter((p) => !fs.existsSync(path.join(ROOT, p))).sort()
  assert.deepEqual(
    missing,
    [],
    `these manifests cite files that do not exist:\n  ${missing.join("\n  ")}\n` +
      `An assessment nobody can go and open is the hand-written availability claim it replaced.`,
  )
})

test("the modules that own data actually say which", () => {
  // The other direction, and the one that stops the ratchet being satisfied by
  // declaring nothing: a module with a navigation surface and a permission set
  // that governs no model at all is either wrong or worth stating.
  const withObjects = manifests().filter((m) => m.objects.length > 0)
  assert.ok(
    withObjects.length >= 9,
    `only ${withObjects.length} of 12 manifests govern any model; this was 9 when written, and a ` +
      `fall means a module stopped declaring what it owns`,
  )

  // The three that legitimately govern nothing, named so a fourth is a decision.
  const without = manifests()
    .filter((m) => m.objects.length === 0)
    .map((m) => m.key)
    .sort()
  assert.deepEqual(
    without,
    ["dashboard", "reimbursements", "search"],
    `these modules govern no model. dashboard and search store nothing, and a reimbursement is ` +
      `an ApprovalRequest carrying a payload — which its own manifest records as a gap. A new ` +
      `name here is a module that owns data and does not say so.`,
  )
})
