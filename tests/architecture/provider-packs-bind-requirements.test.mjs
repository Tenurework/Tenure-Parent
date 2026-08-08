import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * WRK-100-003 — a provider pack's binding to the requirement that asks for it,
 * and the rule that an unbuilt pack stays PLANNED.
 *
 * Two failures this catches, and both of them are the same failure at different
 * ends of the document graph.
 *
 * **A binding to nothing.** `packages/provisioning/src/provider-packs.ts` names
 * a requirement id per pack. An id that no longer exists — renamed, retired,
 * mistyped — looks exactly like a correct one, and the pack goes on claiming to
 * satisfy something. The registry is generated from the Bibles and the ledgers,
 * so it is the only list that can say whether an id is real.
 *
 * **A pack that advanced past its evidence.** Moving `atlassian.jira` to
 * `PUBLISHED` while WRK-100-001 is `FAIL` in the ledger is the overstatement
 * WRK-GATE-000 exists to stop: the catalog would offer a pack the execution
 * record says nobody has built. The ledger decides, never the catalog — a
 * document must not mark its own homework.
 *
 * ## Why this reads source text
 *
 * `tools/run-platform-tests.mjs` runs `node --test` with no TypeScript loader,
 * so this cannot import the module. It parses the named fields instead, which
 * is why `provider-packs.ts` writes them as named fields rather than positional
 * arguments — a guard that has to count commas breaks on the first reformat.
 * The parser asserts it found packs at all, because every check below passes
 * vacuously on an empty list.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const PACKS_FILE = "packages/provisioning/src/provider-packs.ts"
const CAPABILITY_FILE = "packages/provisioning/src/connector-capability.ts"
const ACCELERATORS_FILE = "packages/provisioning/src/work-accelerators.ts"
const REGISTRY_FILE = "docs/architecture/capability-completeness-registry.yaml"
const LEDGER_FILE = "docs/implementation/universal-work-graph-execution-ledger.md"

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")

/** Every requirement id the generated registry knows about. */
function registryIds() {
  const text = read(REGISTRY_FILE)
  return new Set([...text.matchAll(/^ {2}- id: "([\w-]+)"$/gm)].map((m) => m[1]))
}

/** Each WRK requirement's status, as the ledger records it. */
function ledgerStatuses() {
  const lines = read(LEDGER_FILE).split("\n")
  const statuses = new Map()
  let current = null
  for (const line of lines) {
    const heading = /^- \[[ xX]\] \*\*([\w-]+)\*\*/.exec(line)
    if (heading) {
      current = heading[1]
      continue
    }
    const status = /^\s*[-*]\s*Status:\s*\*{0,2}([A-Z_]+)/.exec(line)
    if (status && current) {
      // First status line under a heading wins, so a later mention inside a
      // narrative cannot silently redefine an entry.
      if (!statuses.has(current)) statuses.set(current, status[1])
      current = null
    }
  }
  return statuses
}

/**
 * Everything up to the `}` that closes the object `pack({` opened.
 *
 * Counts braces rather than looking for a terminator, because the row now
 * contains nested object literals and a terminator search finds the inner one.
 */
function balancedBody(block) {
  let depth = 1
  for (let i = 0; i < block.length; i += 1) {
    if (block[i] === "{") depth += 1
    else if (block[i] === "}") {
      depth -= 1
      if (depth === 0) return block.slice(0, i)
    }
  }
  return block
}

/**
 * The packs, as `{ key, lifecycle, requirementIds }`.
 *
 * `lifecycle` falls back to the helper's own literal, which is where the
 * default lives — so the default is read out of the code rather than repeated
 * here, and changing it in one place cannot leave this guard checking the old
 * value.
 */
function packs() {
  const text = read(PACKS_FILE)
  const fallback = /lifecycle:\s*p\.lifecycle\s*\?\?\s*"([A-Z_]+)"/.exec(text)
  assert.ok(fallback, `${PACKS_FILE} no longer declares a default lifecycle — this guard is not reading it`)

  const out = []
  for (const block of text.split("pack({").slice(1)) {
    // Balanced, not `indexOf("})")`. A pack's `authorization` is built by a
    // nested call whose own argument object closes with exactly that sequence,
    // so the naive scan stopped in the middle of every row — which passed,
    // because everything it needed happened to be written above the nested
    // call. A guard whose reach depends on field order is a guard that stops
    // reading the day somebody reorders a row.
    const body = balancedBody(block)
    const key = /key:\s*"([^"]+)"/.exec(body)
    const ids = /requirementIds:\s*\[([^\]]*)\]/.exec(body)
    if (!key || !ids) continue
    const lifecycle = /lifecycle:\s*"([A-Z_]+)"/.exec(body)
    const capabilityStatus = /capabilityStatus:\s*"([A-Z_]+)"/.exec(body)
    out.push({
      key: key[1],
      lifecycle: lifecycle ? lifecycle[1] : fallback[1],
      // WRK-100-004. The capability's own status, which is a different fact
      // from the entry's lifecycle: a PUBLISHED pack whose one capability is
      // still PLANNED is honest, and an AVAILABLE capability on any lifecycle
      // is a claim the certification contract has to answer for.
      capabilityStatus: capabilityStatus ? capabilityStatus[1] : "PLANNED",
      body,
      requirementIds: [...ids[1].matchAll(/"([\w-]+)"/g)].map((m) => m[1]),
      provider: /provider:\s*"([^"]+)"/.exec(body)?.[1] ?? "",
      product: /product:\s*"([^"]+)"/.exec(body)?.[1] ?? "",
      capability: /capability:\s*"([^"]+)"/.exec(body)?.[1] ?? "",
      direction: /direction:\s*"([^"]+)"/.exec(body)?.[1] ?? "",
    })
  }
  return out
}

/**
 * The eight certification clauses, read out of the code that declares them.
 *
 * Read rather than repeated here: a list written twice is a list that disagrees
 * with itself the first time somebody adds a ninth clause, and the copy that
 * drifts is whichever nobody is looking at.
 */
function certificationClauses() {
  const text = read(CAPABILITY_FILE)
  const block = /export const CERTIFICATION_CLAUSES = \[([\s\S]*?)\] as const/.exec(text)
  assert.ok(block, `${CAPABILITY_FILE} no longer declares CERTIFICATION_CLAUSES as a const array`)
  return [...block[1].matchAll(/^\s*"([a-z-]+)",$/gm)].map((m) => m[1])
}

/** The ten accelerators, as `{ key, requiresCapabilities }`. */
function accelerators() {
  const text = read(ACCELERATORS_FILE)
  const list = /export const WORK_ACCELERATORS[^=]*=\s*\[([\s\S]*)\n\]/.exec(text)
  assert.ok(list, `${ACCELERATORS_FILE} no longer declares WORK_ACCELERATORS as an array`)

  // The capability keys are written as `const` aliases at the top of the file so
  // the ten agree with each other; resolve them here rather than asserting on
  // the alias names, which would prove nothing about what a pack is called.
  const aliases = new Map(
    [...text.matchAll(/^const (\w+) = "([^"]+)"$/gm)].map((m) => [m[1], m[2]]),
  )

  const out = []
  for (const block of list[1].split(/\n  \{\n/).slice(1)) {
    const key = /key:\s*"([\w-]+)"/.exec(block)
    const requires = /requiresCapabilities:\s*\[([^\]]*)\]/.exec(block)
    if (!key || !requires) continue
    out.push({
      key: key[1],
      requiresCapabilities: requires[1]
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => aliases.get(token) ?? token.replace(/^"|"$/g, "")),
    })
  }
  return out
}

test("the parser finds the packs at all", () => {
  // Every assertion below passes on an empty list, and this list comes from
  // splitting TypeScript on a call shape.
  const found = packs()
  assert.ok(
    found.length >= 24,
    `Parsed ${found.length} provider packs from ${PACKS_FILE}, expected at least the 24 the ` +
      `WRK-080/090/100 requirements name.`,
  )
  assert.ok(
    found.some((p) => p.key === "microsoft.outlook-mail"),
    "microsoft.outlook-mail was not parsed — the field names in provider-packs.ts have changed",
  )
  // And the readers it depends on are reading something.
  assert.ok(registryIds().size > 1000, "the capability registry parsed to almost nothing")
  assert.ok(ledgerStatuses().size > 50, "the work-graph ledger parsed to almost nothing")
})

test("every pack binds to a requirement that exists", () => {
  const known = registryIds()
  const offenders = []

  for (const pack of packs()) {
    assert.ok(
      pack.requirementIds.length > 0,
      `${pack.key} names no requirement. A pack nobody asked for is a wish list entry.`,
    )
    for (const id of pack.requirementIds) {
      if (!known.has(id)) offenders.push(`${pack.key} → ${id}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these packs cite requirement ids the capability registry does not contain:\n  ` +
      `${offenders.join("\n  ")}\n` +
      `A binding to an id that does not exist looks exactly like a correct one, and the pack goes ` +
      `on claiming to satisfy something.`,
  )
})

test("a pack whose requirement is not PASS stays PLANNED", () => {
  const statuses = ledgerStatuses()
  const offenders = []

  for (const pack of packs()) {
    // The ledger decides, not the catalog. A requirement the ledger does not
    // mention is treated as not passed, which is the same rule the document
    // graph applies: an unimported requirement is FAIL, not missing.
    const unmet = pack.requirementIds.filter((id) => statuses.get(id) !== "PASS")
    if (unmet.length > 0 && pack.lifecycle !== "PLANNED") {
      offenders.push(`${pack.key} is ${pack.lifecycle} while ${unmet.join(", ")} is not PASS`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these packs have advanced past PLANNED while the requirement that asks for them is ` +
      `unproven:\n  ${offenders.join("\n  ")}\n` +
      `WRK-100-003: unbuilt packs remain PLANNED. Advancing one is a claim the execution ledger ` +
      `contradicts, and the ledger is the record of what somebody actually built.`,
  )
})

test("the twenty-four named providers are all present", () => {
  // The list the Bible names, spelled out. A pack quietly dropped is a
  // requirement that goes back to having no row anywhere — invisible, which
  // reads exactly like done.
  const keys = new Set(packs().map((p) => p.key))
  for (const key of [
    "microsoft.outlook-mail",
    "google.gmail",
    "slack.workspace",
    "zoom.meetings",
    "notion.workspace",
    "box.content",
    "dropbox.files",
    "atlassian.jira",
    "atlassian.confluence",
    "asana.work",
    "monday.work",
    "linear.issues",
    "clickup.work",
    "trello.boards",
    "smartsheet.sheets",
    "airtable.bases",
    "coda.docs",
    "miro.boards",
    "cisco.webex",
    "ringcentral.messaging",
    "docusign.esignature",
    "adobe.acrobat-sign",
    "egnyte.content",
    "sharefile.content",
  ]) {
    assert.ok(keys.has(key), `${key} is no longer declared in ${PACKS_FILE}`)
  }
})

test("no requirement id anywhere in the file is invented", () => {
  // Wider than the block parse above, and deliberately so: a pack added in some
  // other shape — an object literal, a spread, a second helper — would slip
  // past the parser entirely, and this catches its ids regardless.
  const known = registryIds()
  const cited = [...read(PACKS_FILE).matchAll(/"(WRK-[\w-]+)"/g)].map((m) => m[1])
  const unknown = [...new Set(cited)].filter((id) => !known.has(id))

  assert.ok(cited.length >= 24, `only ${cited.length} WRK ids appear in ${PACKS_FILE}`)
  assert.deepEqual(
    unknown,
    [],
    `these requirement ids appear in ${PACKS_FILE} and not in the capability registry: ` +
      `${unknown.join(", ")}`,
  )
})

/* ------------------------------------------------------------- WRK-100-004 --
 * A pack may not claim a running capability without the full certification
 * contract behind it.
 *
 * The gate that decides this at runtime is `capabilityProblems` in
 * `connector-capability.ts`, and `catalogs.test.ts` proves it emits one
 * `clause-unproven` per uncited clause per direction. What this adds is the
 * check on the DECLARED rows: a pack advanced in this file to `AVAILABLE` while
 * still carrying `NO_EVIDENCE` is a claim somebody wrote down, and it should
 * fail before anything runs it.
 */

test("the certification contract is eight named clauses", () => {
  const clauses = certificationClauses()
  assert.deepEqual(
    clauses,
    [
      "golden",
      "negative",
      "volume",
      "failure-outage",
      "throttling-and-deprecation",
      "deletion-propagation",
      "acl-change-propagation",
      "scope-exactness",
    ],
    `${CAPABILITY_FILE} declares ${clauses.length} certification clauses. WRK-100-004 is about ` +
      `the FULL contract, and a clause quietly removed from the list is a suite nothing asks ` +
      `for again.`,
  )
})

test("a pack claiming a running capability cites every clause", () => {
  const clauses = certificationClauses()
  const offenders = []

  for (const pack of packs()) {
    if (pack.capabilityStatus !== "AVAILABLE" && pack.capabilityStatus !== "DEGRADED") continue

    // `NO_EVIDENCE` is the eight-empty-arrays constant. A running capability
    // carrying it cites nothing at all.
    if (/clauseEvidence:\s*NO_EVIDENCE/.test(pack.body) || !/clauseEvidence:/.test(pack.body)) {
      offenders.push(`${pack.key} is ${pack.capabilityStatus} and cites nothing: ${clauses.join(", ")}`)
      continue
    }
    // A clause is cited when the row names it as a key, quoted or not —
    // `golden: [...]` and `"failure-outage": [...]` are both how TypeScript
    // spells one, and a guard that only accepted the quoted form would report a
    // fully-cited pack as citing nothing.
    const missing = clauses.filter(
      (clause) => !new RegExp(`"?${clause}"?\\s*:`).test(pack.body),
    )
    if (missing.length > 0) {
      offenders.push(`${pack.key} is ${pack.capabilityStatus} and cites nothing for ${missing.join(", ")}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these packs claim a capability runs against the provider today without the full ` +
      `certification contract behind it:\n  ${offenders.join("\n  ")}\n` +
      `WRK-100-004: prove every available pack against the FULL contract, not a generic happy ` +
      `path. One citation of any kind is the gate this replaced.`,
  )
})

/* ------------------------------------------------------------- WRK-130-001 --
 * The ten accelerators, and the set of capabilities selected for release.
 */

test("all ten work accelerators are declared", () => {
  const declared = accelerators()
  assert.equal(
    declared.length,
    10,
    `${ACCELERATORS_FILE} declares ${declared.length} accelerators. The Bible names ten at ` +
      `section 11, and one quietly dropped is a workflow that goes back to having no row ` +
      `anywhere — invisible, which reads exactly like done.`,
  )
  for (const accelerator of declared) {
    assert.ok(
      accelerator.requiresCapabilities.length > 0,
      `${accelerator.key} rests on no capability. A verdict that is always available is not a ` +
        `verdict.`,
    )
  }
})

test("every capability an accelerator rests on is one a declared pack provides", () => {
  // A key that no pack provides would make an accelerator permanently
  // unavailable for a reason nobody could see, which reads exactly like an
  // honest verdict.
  const provided = new Set(
    packs().map((p) => `${p.provider}/${p.product}/${p.capability}/${p.direction}`),
  )
  const offenders = []
  for (const accelerator of accelerators()) {
    for (const key of accelerator.requiresCapabilities) {
      if (!provided.has(key)) offenders.push(`${accelerator.key} → ${key}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these accelerators name capability keys no provider pack declares:\n  ` +
      `${offenders.join("\n  ")}`,
  )
})

test("no accelerator is available, because no capability is selected for release", () => {
  // The honest state of the platform, written where it can go red the moment
  // somebody overstates it. Every pack is PLANNED with a PLANNED capability, so
  // the set of connector capabilities selected for release is EMPTY.
  //
  // This composes with the two checks above it rather than repeating them: a
  // capability only counts as released once its pack has left PLANNED AND its
  // capability claims to run AND the clause contract above is satisfied.
  const running = new Set(
    packs()
      .filter((p) => p.capabilityStatus === "AVAILABLE")
      .map((p) => `${p.provider}/${p.product}/${p.capability}/${p.direction}`),
  )

  const available = accelerators().filter((a) =>
    a.requiresCapabilities.every((key) => running.has(key)),
  )

  assert.deepEqual(
    available.map((a) => a.key),
    [],
    `these accelerators are being claimed as available:\n  ` +
      `${available.map((a) => `${a.key} on ${a.requiresCapabilities.join(", ")}`).join("\n  ")}\n` +
      `WRK-130-001 is "implement all ten accelerators FOR THE EXACT CONNECTOR CAPABILITIES ` +
      `SELECTED FOR RELEASE". If a pack really has shipped, this test is the place that has to ` +
      `be updated deliberately — and WRK-130-005 asks for the capability matrix to say so too.`,
  )
})
