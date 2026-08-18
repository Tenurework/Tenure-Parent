#!/usr/bin/env node
/**
 * CAT-050-001 / CAT-050-004 / CAT-060-001…004 — the §8 catalog register.
 *
 * §8 of
 * `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`
 * is "the mandatory planning inventory as of this version". CAT-050-001 and
 * CAT-060-001…004 each ask that one of its subsections be REGISTERED "with
 * exact lifecycle and capabilities". CAT-050-004 asks for proof that an
 * unbuilt entry "cannot generate connect/deploy/available states".
 *
 * Those are two different jobs and they are done here together on purpose,
 * because the failure mode of a catalog is registering a product and then
 * letting the registration read as an offer. §6 draws the line in one sentence:
 *
 *   "Catalog visibility and connector availability are different. All major
 *    applications may appear in the Deployer's planning catalog, but only exact
 *    `TENANT_ELIGIBLE` capabilities offer a connect/deploy path."
 *
 * So this module registers every product §8 names, and the same module decides
 * connect/deploy/available — from the registered lifecycle and nothing else.
 *
 * ## Nothing here is transcribed
 *
 *   * the twelve subsections, their capability families and their products are
 *     PARSED out of §8's own tables. A product added to the Bible appears in
 *     the register without anybody editing this file, and a product removed
 *     from it disappears.
 *   * the lifecycle vocabulary is `bibleLifecycles()` from
 *     `tools/cat-integration-inventory.mjs`, which reads §6's fenced block.
 *   * the per-entry field list is parsed from §6's "Every entry shows:" bullets,
 *     so "with … capabilities" means the bullet §6 wrote, not a field somebody
 *     thought of.
 *   * the connector evidence is `providerPacks()` and `classify()` from the
 *     same module — the twenty-four packs really declared in
 *     `packages/provisioning/src/provider-packs.ts`, classified by the rules
 *     that already ship, rather than a second opinion about the same rows.
 *
 * ## The one hand-written table, and why it is safe
 *
 * `PACK_BINDINGS` maps a §8 entry to the pack key that implements it. It has to
 * be written: §8 says "Jira" and the pack key is `atlassian.jira`, §8 says
 * "Monday.com" and the key is `monday.work`. A fuzzy match would silently bind
 * "Box" to `dropbox.files` the first time somebody reformatted a cell.
 *
 * It is safe because the test asserts it in BOTH directions: every key it names
 * must exist in `provider-packs.ts`, every entry it names must exist in §8, and
 * every one of the twenty-four packs must be bound to at least one §8 entry. A
 * binding to a renamed pack reds; a pack for a system the catalog does not list
 * reds; a binding that invents an entry reds.
 *
 * ## What this module refuses to do
 *
 * It never raises an entry above what the tree supports. An entry with no pack
 * is `INVENTORY_ONLY` — §6's own state for "a system recorded to plan migration
 * or coexistence without implying Tenure has an adapter" — and an entry with a
 * pack inherits exactly the state that pack's declaration supports, which is
 * `PLANNED` for all twenty-four today. Nothing in this file can produce
 * `TENANT_ELIGIBLE`, and `connectPath()` is the only reader of the lifecycle
 * that matters.
 *
 * Usage:  node tools/cat-catalog-registry.mjs [--check]
 *   --check  exit non-zero if the committed document is out of date
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  BIBLE,
  ROOT,
  byBytes,
  bibleLifecycles,
  classify,
  providerPacks,
  providerReviews,
  read,
} from "./cat-integration-inventory.mjs"

export const CATALOG_DOC = "docs/architecture/integration-catalog.md"

const PACKS_FILE = "packages/provisioning/src/provider-packs.ts"

/* ────────────────────────────────────────────────────── §8, parsed ─────── */

/** The Bible as one LF string, so Windows and Linux parse identically. */
function bible() {
  return read(BIBLE).replace(/\r\n/g, "\n")
}

/**
 * Split a §8 products cell into items.
 *
 * Comma-separated is the cell's own grammar. A `;` inside an item introduces a
 * pattern note rather than another product — "IBM Sterling; X12/EDIFACT/AS2/
 * SFTP patterns" is one vendor and a note about protocols — so it is split off
 * as `note` instead of producing a row nobody could bind.
 *
 * A trailing conditional clause is separated as `condition`, because §8 uses it
 * to narrow the listing ("Viva where an exact use case is certified") and a
 * register that swallowed it into the product name would lose the narrowing.
 */
const CONDITION = /\s(?:where|only as|only through|only with|subject to|under|via|through)\s/

export function splitProducts(cell) {
  const out = []
  for (const raw of cell.split(",")) {
    const piece = raw.trim()
    if (!piece) continue
    const semi = piece.indexOf(";")
    const head = (semi === -1 ? piece : piece.slice(0, semi)).trim()
    const note = semi === -1 ? null : piece.slice(semi + 1).trim() || null
    const m = CONDITION.exec(head)
    const product = m ? head.slice(0, m.index).trim() : head
    const condition = m ? head.slice(m.index).trim() : null
    if (!product) continue
    out.push({ text: piece, product, condition, note })
  }
  return out
}

/**
 * Every `### 8.N …` subsection: its families, its products, and the prose
 * boundary paragraphs that follow its table.
 *
 * The boundaries are captured because §8 states most of its refusals there —
 * "one commerce connection is not blanket money authorization", "PHI/clinical
 * data is excluded by default" — and a register that dropped them would be a
 * list of logos with the constraints removed.
 */
export function bibleSections() {
  const text = bible()
  const at = text.indexOf("## 8. Major application and system catalog")
  if (at === -1) throw new Error(`${BIBLE} no longer has a "## 8. Major application and system catalog"`)
  const end = text.indexOf("\n## 9.", at)
  if (end === -1) throw new Error(`${BIBLE} §8 is no longer followed by a "## 9."`)
  const body = text.slice(at, end)

  const sections = []
  let current = null
  for (const line of body.split("\n")) {
    const head = /^### (8\.\d+)\s+(.*)$/.exec(line)
    if (head) {
      current = { id: head[1], title: head[2].trim(), families: [], boundaries: [] }
      sections.push(current)
      continue
    }
    if (!current) continue
    if (/^\|/.test(line)) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim())
      if (cells.length < 2) continue
      if (/^-+$/.test(cells[0].replace(/[\s:]/g, "-"))) continue
      if (/^Capability family$/i.test(cells[0])) continue
      current.families.push({ family: cells[0], products: splitProducts(cells[1]) })
      continue
    }
    const prose = line.trim()
    if (prose) current.boundaries.push(prose)
  }
  if (sections.length === 0) throw new Error(`${BIBLE} §8 no longer contains any "### 8.N" subsection`)
  return sections
}

/**
 * §6's "Every entry shows:" bullets — the fields a catalog entry must carry.
 *
 * Parsed rather than copied for the same reason the lifecycle list is: "with
 * exact lifecycle and capabilities" is a claim about what §6 asks for, so §6 is
 * where it is read from.
 */
export function bibleEntryFields() {
  const text = bible()
  const at = text.indexOf("Every entry shows:")
  if (at === -1) throw new Error(`${BIBLE} §6 no longer says "Every entry shows:"`)
  const out = []
  for (const line of text.slice(at).split("\n").slice(1)) {
    const m = /^- (.*)$/.exec(line.trim())
    if (!m) {
      if (out.length > 0) break
      continue
    }
    out.push(m[1].replace(/[;.]$/, "").trim())
  }
  if (out.length === 0) throw new Error(`${BIBLE} §6 "Every entry shows:" is no longer a bullet list`)
  return out
}

/* ────────────────────────────────────────────── connector evidence ─────── */

/** `key` → `oidc` | `oauth2` | `adminConsent`, read per pack at four spaces. */
export function packAuthClasses() {
  const out = new Map()
  let key = null
  for (const line of read(PACKS_FILE).replace(/\r\n/g, "\n").split("\n")) {
    const k = /^ {4}key: "([^"]+)",/.exec(line)
    if (k) {
      key = k[1]
      continue
    }
    const a = /^ {4}authorization: (oidc|oauth2|adminConsent)\(\{/.exec(line)
    if (a && key) {
      out.set(key, a[1])
      key = null
    }
  }
  return out
}

/** The lifecycle literal each pack declares, so a pack advanced by hand shows. */
export function packLifecycles() {
  const out = new Map()
  for (const row of providerPacks()) out.set(row.key, row.lifecycle)
  return out
}

/* ─────────────────────────────────────────────────────── the bindings ──── */

/**
 * §8 entry → the connector pack that implements it.
 *
 * Keyed `"<section>|<family>|<product>"`, which is the entry key this module
 * builds, so a binding cannot drift onto a different family's product of the
 * same name.
 */
export const PACK_BINDINGS = {
  "8.1|Microsoft work suite|Outlook Mail": "microsoft.outlook-mail",
  "8.1|Google work suite|Gmail": "google.gmail",
  "8.1|Chat and collaboration|Slack": "slack.workspace",
  "8.1|Chat and collaboration|Webex": "cisco.webex",
  "8.1|Chat and collaboration|RingCentral": "ringcentral.messaging",
  "8.1|Meetings/voice/contact|Zoom Meetings/Webinars/Phone/Contact Center": "zoom.meetings",
  "8.1|Knowledge/wiki|Notion": "notion.workspace",
  "8.1|Knowledge/wiki|Confluence": "atlassian.confluence",
  "8.1|Knowledge/wiki|Coda": "coda.docs",
  "8.1|Content/file platforms|Box": "box.content",
  "8.1|Content/file platforms|Dropbox Business": "dropbox.files",
  "8.1|Content/file platforms|Egnyte": "egnyte.content",
  "8.1|Content/file platforms|Citrix ShareFile": "sharefile.content",
  "8.1|Project/work management|Jira": "atlassian.jira",
  "8.1|Project/work management|Asana": "asana.work",
  "8.1|Project/work management|Monday.com": "monday.work",
  "8.1|Project/work management|Linear": "linear.issues",
  "8.1|Project/work management|ClickUp": "clickup.work",
  "8.1|Project/work management|Trello": "trello.boards",
  "8.1|Project/work management|Smartsheet": "smartsheet.sheets",
  "8.1|Project/work management|Airtable": "airtable.bases",
  "8.1|Whiteboard/design|Miro": "miro.boards",
  "8.1|E-signature|DocuSign": "docusign.esignature",
  "8.1|E-signature|Adobe Acrobat Sign": "adobe.acrobat-sign",
}

/* ─────────────────────────────────────────────────── lifecycle rules ───── */

/**
 * How an entry's §6 state is decided. Two rules, both about evidence.
 *
 * There is deliberately no rule that reads §7's build waves. §7 says outright
 * that "priorities … are not availability claims", and a wave listing is a
 * priority; turning it into a lifecycle state would be exactly the overstatement
 * §6 separates visibility from availability to prevent. Wave prioritisation is
 * CAT-050-002 and CAT-050-003, and neither is claimed here.
 */
export const LIFECYCLE_RULES = [
  {
    id: "C1",
    when: "a connector pack in `packages/provisioning/src/provider-packs.ts` declares this product",
    how: "the pack's own declaration is classified by `classify()` — the rules already shipped for CAT-000-003 — so this register cannot hold a second opinion about a pack's state",
  },
  {
    id: "C2",
    when: "no pack declares this product",
    how: "`INVENTORY_ONLY` — §6's state for a system recorded to plan migration or coexistence without implying Tenure has an adapter, which is precisely what a §8 planning row is",
  },
]

/* ───────────────────────────────────────────────────────── readings ────── */

const known = (value) => ({ known: true, value })
const unknown = (why) => ({ known: false, why })

/**
 * The per-entry fields, one per §6 "Every entry shows" bullet.
 *
 * `bullet` is asserted set-equal to §6's parsed bullets in both directions, so
 * a field this register invents and a bullet it drops both red.
 *
 * Several are `known: false` for every entry today. That is the answer, not a
 * gap in the code: "no pricing assumption is declared anywhere in this
 * repository" and "the pricing is zero" are different statements, and a
 * register that collapsed them would be the defect this codebase most often
 * finds.
 */
export const ENTRY_FIELDS = [
  {
    id: "provider_product_edition",
    bullet: "provider, product, edition/API where relevant",
    of: (e, pack) =>
      known(
        pack
          ? `${pack.provider} / ${pack.product} · edition/API: ${e.condition ?? "not stated in §8"}`
          : `§${e.section} "${e.product}" · edition/API: ${e.condition ?? "not stated in §8"}`,
      ),
  },
  {
    id: "capabilities",
    bullet: "capability list and directions",
    of: (e, pack) =>
      pack
        ? known(`${pack.capability} · ${pack.direction}`)
        : unknown(
            `no connector pack declares a capability for this product; §${e.section}'s family "${e.family}" is a planning family, not a connector capability list`,
          ),
  },
  {
    id: "auth_install",
    bullet: "auth/install classes",
    of: (e, pack, ctx) =>
      pack
        ? known(`${ctx.auth.get(pack.key) ?? "not declared"} (declared at ${pack.declaredAt})`)
        : unknown("no pack, so no authorization or install profile is declared for this product"),
  },
  {
    id: "regions_data_classes",
    bullet: "countries/regions/data classes",
    of: (e, pack) =>
      unknown(
        pack
          ? "the pack declares no region and no data class; `pack()` stamps only an engine range"
          : "no row in this repository declares a country, region or data class for this product",
      ),
  },
  {
    id: "connector_certification_release",
    bullet: "connector and certification release",
    of: (e, pack) =>
      unknown(
        pack
          ? `the pack declares engine compatibility ${pack.engine}; there is no connector release and no certification release, because the capability status is ${pack.capabilityStatus}`
          : "no connector exists, so there is no connector release and no certification release",
      ),
  },
  {
    id: "provider_review",
    bullet: "provider review/marketplace status",
    // "We looked and found nothing" — a known answer, and a different one from
    // "we could not look". `providerReviews()` reads the review records that do
    // exist, so an added review for one of these products changes this value.
    of: (e, pack, ctx) => {
      const token = pack ? pack.provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_") : null
      const hit = token ? [...ctx.reviews].find(([name]) => name.includes(token)) : null
      if (hit) return known(`${hit[0]}: ${hit[1]}`)
      return known(
        "no provider review record names this product (searched packages/platform-config/src/provider-review.ts); marketplace status: not listed",
      )
    },
  },
  {
    id: "known_limits",
    bullet: "known limits and unsupported objects/actions",
    of: (e, pack) =>
      pack
        ? known(
            "planned pack: no object, action, event or direction is supported — the limit is total",
          )
        : known("no adapter exists: no object, action, event or direction is supported"),
  },
  {
    id: "pricing_entitlement",
    bullet: "pricing/licensing and Tenure entitlement assumptions",
    of: () =>
      unknown(
        "no pricing, licensing or entitlement assumption is declared anywhere in this repository for this product; CAT-090-001 and CAT-090-002 own it",
      ),
  },
  {
    id: "lifecycle_support_owner",
    bullet: "lifecycle and support owner",
    of: (e) => known(`${e.lifecycle} (rule ${e.lifecycleRule}); support owner: not declared`),
  },
  {
    id: "evidence_expiry",
    bullet: "evidence expiry and recertification trigger",
    of: () =>
      unknown(
        "no evidence has been produced for this product, so nothing has an expiry; the recertification trigger set is CAT-080-002",
      ),
  },
]

/* ─────────────────────────────────────────────── availability gate ─────── */

/**
 * §6, quoted: "only exact `TENANT_ELIGIBLE` capabilities offer a connect/deploy
 * path."
 *
 * `connect` and `deploy` are therefore exactly one state. `available` admits
 * the two states that are downstream of it — a tenant that is already connected
 * is not offered a connect path and is plainly not unavailable either.
 */
export const CONNECT_STATE = "TENANT_ELIGIBLE"
export const AVAILABLE_STATES = ["TENANT_ELIGIBLE", "TENANT_CONNECTED", "TENANT_ACTIVE"]

export function connectPath(entry) {
  const state = entry.lifecycle
  const connect = state === CONNECT_STATE
  const available = AVAILABLE_STATES.includes(state)
  return {
    connect,
    deploy: connect,
    available,
    reason: connect
      ? null
      : `${state}: §6 gives a connect/deploy path to ${CONNECT_STATE} capabilities only`,
  }
}

/* ─────────────────────────────────────────────────────────── register ──── */

export function registry() {
  const sections = bibleSections()
  const packs = new Map(providerPacks().map((p) => [p.key, p]))
  const ctx = { auth: packAuthClasses(), reviews: providerReviews() }
  const lifecycles = bibleLifecycles()

  const entries = []
  for (const section of sections) {
    for (const fam of section.families) {
      for (const item of fam.products) {
        const key = `${section.id}|${fam.family}|${item.product}`
        const packKey = PACK_BINDINGS[key] ?? null
        const pack = packKey ? (packs.get(packKey) ?? null) : null
        const classified = pack ? classify(pack) : null
        const entry = {
          key,
          section: section.id,
          sectionTitle: section.title,
          family: fam.family,
          product: item.product,
          condition: item.condition,
          note: item.note,
          packKey,
          lifecycle: classified ? classified.state : "INVENTORY_ONLY",
          lifecycleRule: classified ? `C1/${classified.rule}` : "C2",
        }
        entry.fields = ENTRY_FIELDS.map((f) => ({
          id: f.id,
          bullet: f.bullet,
          reading: f.of(entry, pack, ctx),
        }))
        entry.path = connectPath(entry)
        entries.push(entry)
      }
    }
  }
  entries.sort((a, b) => byBytes(a.key, b.key))
  return { sections, entries, lifecycles, entryFields: bibleEntryFields() }
}

/* ────────────────────────────────────────────────────────── rendering ──── */

function tableRow(cells) {
  return `| ${cells.join(" | ")} |`
}

export function render(reg = registry()) {
  const out = []
  out.push("# Integration catalog — the §8 planning register")
  out.push("")
  out.push(
    "<!-- Generated by `node tools/cat-catalog-registry.mjs`. Do not edit by hand:",
  )
  out.push(
    "     `tests/architecture/cat-catalog-registry.test.mjs` re-derives it and holds this file to it. -->",
  )
  out.push("")
  out.push(
    "CAT-050-001 and CAT-060-001…004 ask that each subsection of §8 of",
    `\`${BIBLE}\``,
    "be registered **with exact lifecycle and capabilities**. CAT-050-004 asks for proof",
    "that an unbuilt entry cannot generate a connect, deploy or available state.",
  )
  out.push("")
  out.push(
    "Every row below is parsed from §8's own tables. The lifecycle is derived from what",
    "the repository declares, never from the listing: §8's own header says listing means",
    '"must be considered and classifiable," not "available".',
  )
  out.push("")

  const byState = new Map()
  for (const e of reg.entries) byState.set(e.lifecycle, (byState.get(e.lifecycle) ?? 0) + 1)
  out.push(
    `**${reg.entries.length} entries** across **${reg.sections.length} subsections**, ` +
      `**${reg.entries.filter((e) => e.packKey).length}** bound to a connector pack.`,
  )
  out.push("")
  out.push("## Lifecycle distribution")
  out.push("")
  out.push(tableRow(["§6 state", "entries"]))
  out.push(tableRow(["---", "---:"]))
  for (const state of reg.lifecycles) {
    if (!byState.has(state)) continue
    out.push(tableRow([`\`${state}\``, String(byState.get(state))]))
  }
  out.push("")
  out.push("States with no entries are omitted. No rule in the generator can produce a state")
  out.push(
    `above \`IN_DEVELOPMENT\`, so \`${CONNECT_STATE}\` — the one state §6 gives a connect/deploy`,
  )
  out.push("path to — is unreachable from this register today.")
  out.push("")

  out.push("## Connect / deploy / available")
  out.push("")
  const offered = reg.entries.filter((e) => e.path.connect || e.path.available)
  out.push(
    `\`connectPath()\` offers a connect path to **${reg.entries.filter((e) => e.path.connect).length}** ` +
      `of ${reg.entries.length} entries and reports **${offered.length}** available.`,
  )
  out.push("")
  out.push("> " + "§6: “Catalog visibility and connector availability are different. All major")
  out.push("> applications may appear in the Deployer’s planning catalog, but only exact")
  out.push("> `TENANT_ELIGIBLE` capabilities offer a connect/deploy path.”")
  out.push("")

  out.push("## How a lifecycle is decided")
  out.push("")
  out.push(tableRow(["rule", "when", "state"]))
  out.push(tableRow(["---", "---", "---"]))
  for (const r of LIFECYCLE_RULES) out.push(tableRow([r.id, r.when, r.how]))
  out.push("")

  out.push("## Fields every entry carries")
  out.push("")
  out.push("One per §6 “Every entry shows” bullet, in §6's order.")
  out.push("")
  out.push(tableRow(["§6 bullet", "known for", "unknown for"]))
  out.push(tableRow(["---", "---:", "---:"]))
  for (const f of ENTRY_FIELDS) {
    let k = 0
    for (const e of reg.entries) if (e.fields.find((x) => x.id === f.id).reading.known) k += 1
    out.push(tableRow([f.bullet, String(k), String(reg.entries.length - k)]))
  }
  out.push("")

  for (const section of reg.sections) {
    const rows = reg.entries.filter((e) => e.section === section.id)
    out.push(`## §${section.id} ${section.title}`)
    out.push("")
    out.push(
      `${rows.length} entries · ${rows.filter((e) => e.packKey).length} with a connector pack · ` +
        `${rows.filter((e) => e.path.connect).length} with a connect path`,
    )
    out.push("")
    out.push(tableRow(["capability family", "product", "§8 condition", "pack", "lifecycle", "capability · direction", "connect"]))
    out.push(tableRow(["---", "---", "---", "---", "---", "---", "---"]))
    for (const e of rows) {
      const cap = e.fields.find((f) => f.id === "capabilities").reading
      out.push(
        tableRow([
          e.family,
          e.product,
          e.condition ?? "—",
          e.packKey ? `\`${e.packKey}\`` : "—",
          `\`${e.lifecycle}\``,
          cap.known ? `\`${cap.value}\`` : "not declared",
          e.path.connect ? "yes" : "no",
        ]),
      )
    }
    out.push("")
    if (section.boundaries.length > 0) {
      out.push("**Boundaries §" + section.id + " states in its own prose:**")
      out.push("")
      for (const b of section.boundaries) out.push(`> ${b}`)
      out.push("")
    }
  }

  return out.join("\n") + "\n"
}

/* ────────────────────────────────────────────────────────────── command ── */

const isCommand =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const text = render()
  const abs = path.join(ROOT, CATALOG_DOC)
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : ""
    if (current !== text) {
      console.error(`::error::${CATALOG_DOC} is stale. Run: node tools/cat-catalog-registry.mjs`)
      process.exit(1)
    }
    console.log(`${CATALOG_DOC} is up to date.`)
  } else {
    fs.writeFileSync(abs, text)
    const reg = registry()
    console.log(
      `Wrote ${CATALOG_DOC} — ${reg.entries.length} entries, ${reg.sections.length} subsections.`,
    )
  }
}
