/**
 * CAT-050-001, CAT-050-004, CAT-060-001…004 — the §8 register is checked, not
 * described.
 *
 * Five of these six requirements say "register" and one says "prove". A
 * register is a claim about the Bible plus a claim about the repository, so
 * nothing here reads the committed document for its content: every assertion
 * re-derives the answer with `tools/cat-catalog-registry.mjs` and then holds
 * the committed file to it.
 *
 * What each test is designed to catch, stated so a reader can go and try it:
 *
 *   * delete a capability-family row from a §8 table in the Bible — the family
 *     set for that subsection reds, and so does document freshness.
 *   * add a product to a §8 cell — the register gains an entry and freshness
 *     reds. A system added to the catalog cannot land unregistered.
 *   * remove a `PACK_BINDINGS` line — "every pack is bound to a §8 entry" reds,
 *     naming the pack. A connector for a system the catalog does not list is
 *     the exact shape of an integration nobody planned.
 *   * make `connectPath` return `connect: true` — the CAT-050-004 tests red on
 *     412 entries at once.
 *   * make `connectPath` return `connect: false` unconditionally — the
 *     "the refusal is computed" test reds, because a function that refuses
 *     everything proves nothing about the gate.
 *   * claim a capability for an entry with no pack — "a capability is never
 *     invented" reds.
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
  ROOT,
  bibleLifecycles,
  providerPacks,
  read,
} from "../../tools/cat-integration-inventory.mjs"
import {
  AVAILABLE_STATES,
  CATALOG_DOC,
  CONNECT_STATE,
  ENTRY_FIELDS,
  PACK_BINDINGS,
  bibleEntryFields,
  bibleSections,
  connectPath,
  registry,
  render,
} from "../../tools/cat-catalog-registry.mjs"

const reg = registry()
const sorted = (xs) => [...xs].sort()

/**
 * The capability families each subsection declares, written out literally.
 *
 * This is the one list in this file that is not derived, and it is deliberate:
 * CAT-050-001 says "register every provider/product FAMILY in section 8.1", so
 * a derived list would be the register checking itself. These strings are read
 * off §8's own left column. Delete a row from the Bible and the corresponding
 * assertion reds with the family named.
 */
const FAMILIES = {
  "8.1": [
    "Chat and collaboration",
    "Content/file platforms",
    "E-signature",
    "Google work suite",
    "Knowledge/wiki",
    "Meetings/voice/contact",
    "Microsoft work suite",
    "Personal task/calendar feeds",
    "Project/work management",
    "Whiteboard/design",
  ],
  "8.2": [
    "CDP/customer data",
    "CPQ/revenue/subscription",
    "Customer service/IT-facing support",
    "Enterprise CRM",
    "Marketing automation",
    "Messaging/delivery",
    "Social/customer listening",
  ],
  "8.3": [
    "AP/payables",
    "Accounting/bookkeeping",
    "Close/reconciliation",
    "Expense/travel/cards",
    "Mid-market/cloud ERP",
    "Payments/merchant/acquiring",
    "Planning/EPM",
    "Spend/procurement",
    "Tax",
    "Tier-1 ERP suites",
    "Treasury/banking connectivity",
  ],
  "8.4": [
    "Benefits",
    "Engagement/performance",
    "Enterprise HCM",
    "Learning/talent",
    "Recruiting/ATS",
    "Scheduling/time",
    "Workforce/payroll",
  ],
  "8.5": [
    "CI/CD",
    "Cloud/platform",
    "Endpoint/cloud security",
    "ITSM/CMDB",
    "Identity/directory",
    "Incident/on-call",
    "MFA/device/access",
    "Observability",
    "SIEM/security operations",
    "Source/code",
  ],
  "8.6": [
    "BI",
    "Databases",
    "Object/file",
    "Streaming/messaging",
    "Transformation/orchestration",
    "Warehouses/lakehouses",
    "iPaaS coexistence",
  ],
}

const familiesOf = (id) => sorted(new Set(reg.entries.filter((e) => e.section === id).map((e) => e.family)))
const entriesOf = (id) => reg.entries.filter((e) => e.section === id)
const fieldOf = (entry, id) => entry.fields.find((f) => f.id === id).reading

/* ───────────────────────────────────── CAT-050-001 / CAT-060-001…004 ───── */

test("§8's twelve subsections are all registered, and only those", () => {
  assert.deepEqual(
    reg.sections.map((s) => s.id),
    bibleSections().map((s) => s.id),
  )
  assert.deepEqual(
    sorted(new Set(reg.entries.map((e) => e.section))),
    sorted(reg.sections.map((s) => s.id)),
    "every subsection the Bible declares has at least one registered entry",
  )
})

for (const [id, families] of Object.entries(FAMILIES)) {
  test(`§${id} — every provider/product family is registered, and no extra`, () => {
    assert.deepEqual(familiesOf(id), sorted(families))
    for (const family of families) {
      const rows = entriesOf(id).filter((e) => e.family === family)
      assert.ok(rows.length > 0, `§${id} family "${family}" registered no products`)
    }
  })
}

test("every registered product is a string the Bible actually contains", () => {
  const text = read(BIBLE).replace(/\r\n/g, "\n")
  for (const e of reg.entries) {
    assert.ok(
      text.includes(e.product),
      `${e.key}: "${e.product}" appears nowhere in ${BIBLE} — the register invented it`,
    )
    assert.ok(text.includes(e.family), `${e.key}: family "${e.family}" appears nowhere in ${BIBLE}`)
  }
})

test("every entry carries exactly §6's 'Every entry shows' bullets, in §6's order", () => {
  const bullets = bibleEntryFields()
  assert.deepEqual(
    ENTRY_FIELDS.map((f) => f.bullet),
    bullets,
    "the field list is §6's, in §6's order — a field invented here or a bullet dropped both red",
  )
  for (const e of reg.entries) {
    assert.deepEqual(
      e.fields.map((f) => f.bullet),
      bullets,
      `${e.key} does not carry every §6 field`,
    )
    for (const f of e.fields) {
      const r = f.reading
      assert.equal(typeof r.known, "boolean", `${e.key}/${f.id} has no known flag`)
      if (r.known) assert.ok(r.value, `${e.key}/${f.id} is known with no value`)
      else assert.ok(r.why, `${e.key}/${f.id} is unknown with no reason`)
    }
  }
})

test("every entry's lifecycle is one of §6's sixteen states", () => {
  const states = new Set(bibleLifecycles())
  assert.ok(states.size >= 16, "§6 no longer declares the lifecycle vocabulary")
  for (const e of reg.entries) {
    assert.ok(states.has(e.lifecycle), `${e.key} is ${e.lifecycle}, which §6 does not declare`)
  }
})

test("a capability is never invented: no pack means the capability is unknown, and says why", () => {
  const bare = reg.entries.filter((e) => !e.packKey)
  // Arithmetic, not a number measured on one machine: an entry is bound or it
  // is bare, and the bound ones are exactly the bindings.
  assert.equal(bare.length, reg.entries.length - Object.keys(PACK_BINDINGS).length)
  assert.ok(bare.length > 0, "every §8 product is bound to a pack — check the fixture, not the code")
  for (const e of bare) {
    const cap = fieldOf(e, "capabilities")
    assert.equal(cap.known, false, `${e.key} claims a capability with no connector pack`)
    assert.ok(
      cap.why.includes(e.family),
      `${e.key}: the reason does not name the planning family it came from`,
    )
  }
})

test("a bound entry carries the pack's own capability and direction, not a restatement", () => {
  const packs = new Map(providerPacks().map((p) => [p.key, p]))
  const bound = reg.entries.filter((e) => e.packKey)
  assert.equal(bound.length, Object.keys(PACK_BINDINGS).length)
  for (const e of bound) {
    const pack = packs.get(e.packKey)
    const cap = fieldOf(e, "capabilities")
    assert.equal(cap.known, true, `${e.key} has a pack and no capability`)
    assert.equal(cap.value, `${pack.capability} · ${pack.direction}`)
    assert.equal(
      e.lifecycle,
      pack.lifecycle,
      `${e.key} does not hold the state its pack declares (${pack.lifecycle})`,
    )
    const auth = fieldOf(e, "auth_install")
    assert.equal(auth.known, true, `${e.key} has a pack and no auth/install class`)
    assert.match(auth.value, /^(oidc|oauth2|adminConsent) \(declared at /)
  }
})

test("PACK_BINDINGS binds in both directions — no orphan key, no unbound pack", () => {
  const entryKeys = new Set(reg.entries.map((e) => e.key))
  const packKeys = new Set(providerPacks().map((p) => p.key))
  for (const [entryKey, packKey] of Object.entries(PACK_BINDINGS)) {
    assert.ok(entryKeys.has(entryKey), `binding names "${entryKey}", which §8 does not register`)
    assert.ok(packKeys.has(packKey), `binding names pack "${packKey}", which provider-packs.ts lacks`)
  }
  const bound = new Set(Object.values(PACK_BINDINGS))
  for (const key of sorted(packKeys)) {
    assert.ok(bound.has(key), `pack "${key}" is bound to no §8 entry — a connector for a system the catalog does not list`)
  }
})

/* ────────────────────────────────────────────────────────── CAT-050-004 ── */

test("no unbuilt entry generates a connect, deploy or available state", () => {
  const offered = reg.entries.filter((e) => e.path.connect || e.path.deploy || e.path.available)
  assert.deepEqual(
    offered.map((e) => `${e.key} (${e.lifecycle})`),
    [],
    "an entry that is not TENANT_ELIGIBLE was offered a connect, deploy or available state",
  )
  for (const e of reg.entries) {
    assert.ok(e.path.reason.includes(e.lifecycle), `${e.key}'s refusal does not name its state`)
  }
})

test("the refusal is computed from the lifecycle, not returned as a constant", () => {
  const eligible = connectPath({ lifecycle: CONNECT_STATE })
  assert.deepEqual(eligible, { connect: true, deploy: true, available: true, reason: null })

  const connected = connectPath({ lifecycle: "TENANT_CONNECTED" })
  assert.equal(connected.available, true, "an already-connected capability is not unavailable")
  assert.equal(connected.connect, false, "§6 gives the connect path to TENANT_ELIGIBLE only")

  for (const state of bibleLifecycles()) {
    const path = connectPath({ lifecycle: state })
    assert.equal(path.connect, state === CONNECT_STATE, `connect for ${state}`)
    assert.equal(path.deploy, path.connect, `deploy must track connect for ${state}`)
    assert.equal(path.available, AVAILABLE_STATES.includes(state), `available for ${state}`)
  }
})

test("TENANT_ELIGIBLE is a state §6 declares, and the register cannot reach it", () => {
  assert.ok(bibleLifecycles().includes(CONNECT_STATE), `§6 no longer declares ${CONNECT_STATE}`)
  for (const state of AVAILABLE_STATES) {
    assert.ok(bibleLifecycles().includes(state), `§6 no longer declares ${state}`)
    assert.equal(
      reg.entries.some((e) => e.lifecycle === state),
      false,
      `an entry reached ${state} — nothing in this tree evidences a certified, tenant-eligible connector`,
    )
  }
})

test("an unbuilt entry has no row in the production connector catalog at all", () => {
  const packKeys = new Set(providerPacks().map((p) => p.key))
  const bound = new Set(Object.values(PACK_BINDINGS))
  assert.deepEqual(
    sorted([...packKeys].filter((k) => !bound.has(k))),
    [],
    "provider-packs.ts declares a connector the §8 register does not account for",
  )
  for (const e of reg.entries.filter((x) => !x.packKey)) {
    assert.equal(
      packKeys.has(e.key),
      false,
      `${e.key} is unbuilt and yet appears as a production catalog key`,
    )
  }
})

/* ──────────────────────────────────────────────────── the document ────── */

test("the register is deterministic — the same tree twice is the same register", () => {
  assert.equal(JSON.stringify(registry()), JSON.stringify(registry()))
})

test("the committed integration catalog is what the register produces today", () => {
  const committed = fs.readFileSync(path.join(ROOT, CATALOG_DOC), "utf8")
  assert.equal(
    committed,
    render(reg),
    `${CATALOG_DOC} is stale. Run: node tools/cat-catalog-registry.mjs`,
  )
})
