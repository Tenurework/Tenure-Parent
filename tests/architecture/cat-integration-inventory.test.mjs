/**
 * CAT-000-002 / CAT-000-003 — the inventory and its classification are checked,
 * not described.
 *
 * An inventory is a claim about the repository, and the failure mode of every
 * inventory ever written is that it was true once. So nothing here reads the
 * committed documents for their content: every assertion re-derives the answer
 * from the tree with `tools/cat-integration-inventory.mjs` and then holds the
 * committed file to it.
 *
 * What each test is designed to catch, stated so a reader can go and try it:
 *
 *   * delete a `pack({ … })` from `provider-packs.ts` — the generated table
 *     loses a row and the freshness test reds.
 *   * corrupt a `declaredAt` line number or a provider name in the committed
 *     markdown — the freshness test reds, and so does the "every row points at
 *     a line that really declares it" test.
 *   * add a new `https://` host anywhere in tracked source — the host table
 *     gains a row and the freshness test reds. That is the entire point: an
 *     integration nobody catalogued cannot be added silently.
 *   * edit the Bible's §6 state list — the vocabulary is re-read from §6, so a
 *     classification naming a state §6 no longer has reds.
 *
 * Runner: `npm run test:platform` (plain `node --test`, no TypeScript loader),
 * which is why the generator parses source as text rather than importing it.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

import {
  BIBLE,
  CLASSIFICATION_DOC,
  INVENTORY_DOC,
  ROOT,
  RULES,
  awsServices,
  bibleLifecycles,
  classify,
  codedHosts,
  inventory,
  providerPacks,
  read,
  renderClassification,
  renderInventory,
} from "../../tools/cat-integration-inventory.mjs"

const committed = (file) => {
  const abs = path.join(ROOT, file)
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : ""
}

test("the committed inventory is what the tree produces today", () => {
  const inv = inventory()
  assert.equal(
    committed(INVENTORY_DOC),
    renderInventory(inv),
    `${INVENTORY_DOC} is stale. Run: node tools/cat-integration-inventory.mjs`,
  )
})

test("the committed classification is what the tree produces today", () => {
  const inv = inventory()
  assert.equal(
    committed(CLASSIFICATION_DOC),
    renderClassification(inv),
    `${CLASSIFICATION_DOC} is stale. Run: node tools/cat-integration-inventory.mjs`,
  )
})

test("every catalog row points at a line that really declares it", () => {
  const rows = inventory().catalogRows
  // A floor, not an equality: the number grows. Below it the parser is broken
  // rather than the code, and an empty inventory that passes every other
  // assertion is the shape this whole file exists to refuse.
  assert.ok(rows.length >= 50, `only ${rows.length} catalog rows parsed — the scan is broken`)

  const missing = []
  for (const row of rows) {
    const [file, lineNo] = row.declaredAt.split(":")
    const abs = path.join(ROOT, file)
    if (!fs.existsSync(abs)) {
      missing.push(`${row.key} — ${file} does not exist`)
      continue
    }
    const fileLines = read(file).split(/\r?\n/)
    // The declaration site is the block's first line, so the identifying token
    // is on it or within the few lines that follow. Ten lines is enough for
    // every shape in the tree and tight enough that a stale line number fails.
    const window = fileLines.slice(Number(lineNo) - 1, Number(lineNo) + 10).join("\n")
    if (!window.includes(row.key)) {
      missing.push(`${row.key} — not found at ${row.declaredAt}`)
    }
  }
  assert.deepEqual(missing, [], `catalog rows whose declaration site is wrong:\n  ${missing.join("\n  ")}`)
})

test("every provider pack in the source reaches the inventory", () => {
  // Counted independently of the block scanner, so a parser that silently drops
  // packs — the failure that would make this inventory quietly incomplete —
  // disagrees with the source instead of agreeing with itself.
  const source = read("packages/provisioning/src/provider-packs.ts")
  const declared = (source.match(/^ {2}pack\(\{$/gm) ?? []).length
  assert.ok(declared > 20, `only ${declared} pack({ blocks found — the count is broken`)
  assert.equal(
    providerPacks().length,
    declared,
    "the provider-pack parser dropped or invented a pack",
  )
})

test("every host row is a host the tree really names", () => {
  const hosts = codedHosts()
  assert.ok(hosts.length >= 40, `only ${hosts.length} hosts found — the scan is broken`)

  const wrong = []
  for (const h of hosts) {
    assert.ok(h.areas.length > 0, `${h.host} is listed with no area`)
    if (!["url", "egress declaration", "prose only"].includes(h.evidence)) {
      wrong.push(`${h.host} — unknown evidence "${h.evidence}"`)
    }
    if (h.evidence === "egress declaration" && h.declaredBy === null) {
      wrong.push(`${h.host} — claimed as an egress declaration with no declaring row`)
    }
  }
  assert.deepEqual(wrong, [], `host rows that do not hold up:\n  ${wrong.join("\n  ")}`)

  // The two ends of the range have to be present, or the scan is finding one
  // kind of evidence and reporting the other.
  assert.ok(
    hosts.some((h) => h.evidence === "url"),
    "no host is backed by a live URL — the source scan found nothing",
  )
  assert.ok(
    hosts.some((h) => h.declaredBy === null),
    "every host has a catalog row, which would mean the uncatalogued-host column is dead",
  )
})

test("every AWS package listed is one tracked source really imports", () => {
  const services = awsServices()
  assert.ok(services.length >= 30, `only ${services.length} AWS clients found — the scan is broken`)
  for (const s of services) {
    assert.match(
      s.pkg,
      /^@aws-sdk\/client-[a-z0-9]+(-[a-z0-9]+)*$/,
      `${s.pkg} is not a well-formed package name — the specifier scan is matching prose`,
    )
    assert.ok(s.areas.length > 0, `${s.pkg} is listed with no importing area`)
  }
})

/* ─────────────────────────────────────────────────────────── CAT-000-003 ── */

test("the classification vocabulary is the Bible's, read from the Bible", () => {
  const states = bibleLifecycles()
  assert.equal(states.length, 16, `§6 of ${BIBLE} lists ${states.length} states, not 16`)
  // Two anchors from opposite ends, so a truncated or reordered parse of the
  // fenced block fails rather than returning a shorter list that still looks
  // plausible.
  assert.equal(states[0], "INVENTORY_ONLY")
  assert.equal(states.at(-1), "UNSUPPORTED")
  assert.equal(new Set(states).size, states.length, "§6 lists a state twice")
})

test("every catalog row is classified, and only with a state the Bible has", () => {
  const states = new Set(bibleLifecycles())
  const unclassified = []
  const foreign = []
  for (const row of inventory().catalogRows) {
    const { state, rule } = classify(row)
    if (state === null) {
      unclassified.push(`${row.key} (${row.source}, status ${row.capabilityStatus})`)
      continue
    }
    if (!states.has(state)) foreign.push(`${row.key} → ${state} (rule ${rule})`)
  }
  assert.deepEqual(
    unclassified,
    [],
    `CAT-000-003 asks that EACH row be classified; these have no rule:\n  ${unclassified.join("\n  ")}`,
  )
  assert.deepEqual(
    foreign,
    [],
    `these rows are classified with a state §6 does not define:\n  ${foreign.join("\n  ")}`,
  )
})

test("no rule can classify a row above what this tree can evidence", () => {
  /*
   * The guard against the failure this programme has already shipped: an agent
   * writing an approval nobody gave. Everything from SANDBOX_VALIDATED onwards
   * asserts a sandbox run, a provider submission or a certification, and the
   * only provider review in the tree records NOT_SUBMITTED.
   *
   * R4 is the deliberate exception and it is gated on the review record itself,
   * so it cannot fire until somebody actually submits one — at which point the
   * classification becomes true and this rule stops objecting on its own.
   */
  const CEILING = ["INVENTORY_ONLY", "ROADMAP_CANDIDATE", "PLANNED", "SPECIFIED", "IN_DEVELOPMENT"]
  for (const rule of RULES) {
    if (rule.id === "R4") continue
    if (rule.state === "UNSUPPORTED") continue
    assert.ok(
      CEILING.includes(rule.state),
      `rule ${rule.id} emits ${rule.state}, which asserts a sandbox run, a provider ` +
        `submission or a certification that this repository does not record`,
    )
  }

  const reached = new Set(inventory().catalogRows.map((r) => classify(r).state))
  assert.ok(
    !reached.has("TENURE_CERTIFIED") && !reached.has("TENANT_ELIGIBLE"),
    "a row reached a certified or tenant-eligible state; no certification exists in this tree",
  )
})

test("the review state the ceiling argument rests on is still what it says", () => {
  // The paragraph in the classification document asserts a fact about another
  // file. If that fact changes, the paragraph becomes a false statement, and a
  // document nobody can falsify is the thing this repository refuses.
  assert.match(
    read("packages/platform-config/src/provider-review.ts"),
    /export const RELAY_ANTHROPIC_REVIEW: ProviderReview = \{[\s\S]{0,200}state: "NOT_SUBMITTED"/,
    "RELAY_ANTHROPIC_REVIEW no longer records NOT_SUBMITTED — re-derive the classification " +
      "ceiling in tools/cat-integration-inventory.mjs and the paragraph it prints",
  )
})
