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
    const body = block.slice(0, block.indexOf("})"))
    const key = /key:\s*"([^"]+)"/.exec(body)
    const ids = /requirementIds:\s*\[([^\]]*)\]/.exec(body)
    if (!key || !ids) continue
    const lifecycle = /lifecycle:\s*"([A-Z_]+)"/.exec(body)
    out.push({
      key: key[1],
      lifecycle: lifecycle ? lifecycle[1] : fallback[1],
      requirementIds: [...ids[1].matchAll(/"([\w-]+)"/g)].map((m) => m[1]),
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
