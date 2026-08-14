#!/usr/bin/env node
/**
 * CAT-000-002 / CAT-000-003 — the integration inventory, derived from the tree.
 *
 * CAT-000-002 asks for "every integration/app/system currently named,
 * displayed, configured, coded, deployed, marketed, or used by a tenant".
 * CAT-000-003 asks that each provider/product/capability/direction/region/
 * version be classified "with the exact catalog lifecycle" — the sixteen-state
 * vocabulary printed in §6 of
 * `Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md`.
 *
 * Both are claims about the repository, so both are DERIVED here rather than
 * written by hand. A hand-written list of integrations is wrong the first time
 * anybody adds an OAuth host, and a wrong list is worse than none: it is what a
 * reviewer trusts when asking "what leaves this platform?".
 *
 * ## What is read, and why each source counts as an integration record
 *
 *   * `packages/provisioning/src/provider-packs.ts` — the twenty-four connector
 *     packs. NAMED and DISPLAYED: `availabilityDecisions` renders them in the
 *     System Studio under "not available, and why".
 *   * `packages/provisioning/src/catalogs.ts` — every `ConnectorEntry` declared
 *     at module scope. CODED: the Relay egress has a call site in
 *     `apps/web/src/lib/ai.ts`.
 *   * `packages/platform-config/src/model-policy.ts` — the allowed-model
 *     catalog. USED: `modelIsAllowed` gates what goes on the wire.
 *   * `packages/payments/src/capability-registry.ts` — the Stripe capability
 *     leaves. CONFIGURED: eligibility is simulated against this matrix.
 *   * every third-party host named in tracked, non-test `.ts`/`.tsx` source.
 *     This is the row that catches an integration NOBODY put in a catalog, and
 *     it is the only reason this file scans source at all.
 *   * every `@aws-sdk/client-*` module specifier imported by tracked source.
 *     DEPLOYED: the AWS services the platform actually runs on.
 *
 * ## What is deliberately NOT claimed
 *
 * The Bible's §6 lifecycle is defined for "each provider product/capability".
 * The AWS substrate is the RUNTIME ("Tenure vendor cloud in Tenure-owned AWS
 * only", Bible header), not a catalog provider product a tenant connects to, so
 * AWS rows are inventoried and carry no §6 lifecycle. Saying `TENANT_ACTIVE` of
 * `@aws-sdk/client-s3` would be a claim about a tenant connection that does not
 * exist.
 *
 * No row is advanced past what its own declaration supports. `IN_DEVELOPMENT`
 * is the ceiling for everything built here, because `SANDBOX_VALIDATED`,
 * `PROVIDER_REVIEW_PENDING`, `TENURE_CERTIFIED` and everything above them
 * assert a sandbox run, a submission or a certification, and there is no record
 * of any of the three in this tree. Inventing one is the exact failure the
 * programme has already shipped once.
 *
 * ## Determinism (Linux and Windows must produce the same bytes)
 *
 *   * the file list comes from `git ls-files`, which emits POSIX paths, and is
 *     sorted with a byte comparator — never `localeCompare`, whose order
 *     depends on the machine's locale.
 *   * every file is read as text and split on `/\r?\n/`, so a CRLF checkout
 *     yields the same line numbers and the same parsed values as an LF one.
 *   * output is joined with `\n` only. `.gitattributes` pins `* text=auto
 *     eol=lf`, so the committed document is LF on both platforms.
 *   * tracked files only. An untracked scratch file on one machine is not part
 *     of the repository CI checks out, and counting it would make the document
 *     "current here, stale in CI".
 *
 * Usage:  node tools/cat-integration-inventory.mjs [--check]
 *   --check  exit non-zero if either committed document is out of date
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")

export const INVENTORY_DOC = "docs/architecture/cat-integration-inventory.md"
export const CLASSIFICATION_DOC = "docs/architecture/cat-lifecycle-classification.md"

export const BIBLE =
  "Tenure_Global_Deployer_Integration_Catalog_and_Tenant_Connection_Composer_Claude_Bible_v1.0.md"

const PACKS_FILE = "packages/provisioning/src/provider-packs.ts"
const CATALOGS_FILE = "packages/provisioning/src/catalogs.ts"
const MODELS_FILE = "packages/platform-config/src/model-policy.ts"
const REVIEWS_FILE = "packages/platform-config/src/provider-review.ts"
const PAYMENTS_FILE = "packages/payments/src/capability-registry.ts"
const PAYMENTS_VERSION_FILE = "packages/payments/src/api-version.ts"

/** Byte order, not locale order. `localeCompare` sorts differently per machine. */
export const byBytes = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8")
}

/** Lines, CRLF-insensitive, so a Windows checkout parses identically. */
function lines(file) {
  return read(file).split(/\r?\n/)
}

/**
 * Tracked source files under the given roots, POSIX-sorted.
 *
 * Cached only — no `--others`. See the determinism note in the header: an
 * untracked file is not in the tree CI reads.
 */
export function trackedSources(...roots) {
  const out = execFileSync("git", ["ls-files", "--cached", "--", ...roots], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx)$/.test(f))
  return out.sort(byBytes)
}

const IS_TEST_FILE = (f) => /\.(test|itest|spec)\.tsx?$/.test(f)

/* ─────────────────────────────────────────────── block-scanning helpers ── */

/**
 * Slices of a file delimited by an opening line and a closing line at a known
 * indentation, with the 1-based line number the slice starts on.
 *
 * Indentation rather than brace counting, because these files nest helper calls
 * (`authorization: oidc({ … })`) whose `})` would end a brace-counting scan
 * early — which is exactly the bug that would silently drop every field
 * declared after `authorization`.
 */
function blocks(fileLines, openRe, closeRe) {
  const out = []
  let start = -1
  for (let i = 0; i < fileLines.length; i += 1) {
    if (start === -1) {
      if (openRe.test(fileLines[i])) start = i
      continue
    }
    if (closeRe.test(fileLines[i])) {
      out.push({ line: start + 1, text: fileLines.slice(start, i + 1).join("\n") })
      start = -1
    }
  }
  return out
}

/** A `name: "value"` field at exactly `indent` spaces. */
function field(text, name, indent = 4) {
  const re = new RegExp(String.raw`^ {${indent}}${name}: "([^"]*)"`, "m")
  return re.exec(text)?.[1] ?? null
}

/** A `name: [ … ]` string array, single or multi line. */
function stringArray(text, name) {
  const at = text.indexOf(`${name}: [`)
  if (at === -1) return []
  const close = text.indexOf("]", at)
  if (close === -1) return []
  return [...text.slice(at, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort(byBytes)
}

/* ──────────────────────────────────────────────────── connector packs ──── */

/**
 * The provider packs.
 *
 * `pack({` … `}),` at two-space indentation is the array element boundary. The
 * fields are read at four spaces so a nested `authorize:` inside `oidc({ … })`
 * (six spaces) can never be mistaken for a pack field.
 */
export function providerPacks() {
  const rows = []
  for (const b of blocks(lines(PACKS_FILE), /^ {2}pack\(\{\s*$/, /^ {2}\}\),\s*$/)) {
    const key = field(b.text, "key")
    if (!key) continue
    rows.push({
      source: "connector-pack",
      key,
      displayName: field(b.text, "displayName"),
      provider: field(b.text, "provider"),
      product: field(b.text, "product"),
      capability: field(b.text, "capability"),
      direction: field(b.text, "direction"),
      // `pack()` defaults both. An absent override IS the declared value.
      lifecycle: field(b.text, "lifecycle") ?? "PLANNED",
      capabilityStatus: field(b.text, "capabilityStatus") ?? "PLANNED",
      egressHosts: stringArray(b.text, "egressHosts"),
      requirementIds: stringArray(b.text, "requirementIds"),
      // The packs declare no region and no engine range of their own; `pack()`
      // stamps every one with the same `ENGINE` constant.
      regions: [],
      engine: engineRangeOf(read(PACKS_FILE)),
      review: null,
      declaredAt: `${PACKS_FILE}:${b.line}`,
    })
  }
  rows.sort((a, b) => byBytes(a.key, b.key))
  return rows
}

/** `const ENGINE = { minEngine: "x", maxEngine: null }` — the packs' one range. */
function engineRangeOf(text) {
  const min = /minEngine:\s*"([^"]+)"/.exec(text)?.[1]
  const max = /maxEngine:\s*(?:"([^"]+)"|null)/.exec(text)
  if (!min) return "—"
  return `>=${min}${max && max[1] ? ` <=${max[1]}` : ""}`
}

/**
 * Every `ConnectorEntry` declared at module scope in `catalogs.ts`.
 *
 * Written as a scan rather than a lookup of the one name that exists today, so
 * a second connector added beside `RELAY_ANTHROPIC_CONNECTOR` lands in the
 * inventory without anybody remembering this file.
 */
export function catalogConnectors() {
  const fileLines = lines(CATALOGS_FILE)
  const reviews = providerReviews()
  const rows = []
  for (const b of blocks(
    fileLines,
    /^export const [A-Z0-9_]+: ConnectorEntry = \{\s*$/,
    /^\}\s*$/,
  )) {
    const key = field(b.text, "key", 2)
    if (!key) continue
    const reviewRef = /^ {2}providerReview:\s*([A-Za-z0-9_]+),/m.exec(b.text)?.[1] ?? null
    rows.push({
      source: "catalog-connector",
      key,
      displayName: field(b.text, "displayName", 2),
      provider: field(b.text, "provider", 6),
      product: field(b.text, "product", 6),
      capability: field(b.text, "capability", 6),
      direction: field(b.text, "direction", 6),
      lifecycle: field(b.text, "lifecycle", 2) ?? "PLANNED",
      capabilityStatus: field(b.text, "status", 6) ?? "PLANNED",
      egressHosts: stringArray(b.text, "egressHosts"),
      requirementIds: [],
      // `restrictions.partition` is the region statement these carry: which AWS
      // partition the endpoint exists in. A region list would be the hardcoded
      // estate `tests/security/no-hardcoded-estate.test.mjs` refuses.
      regions: stringArray(b.text, "partition").map((p) => `partition:${p}`),
      engine: engineRangeOf(b.text),
      review: reviewRef ? (reviews.get(reviewRef) ?? "UNKNOWN") : null,
      declaredAt: `${CATALOGS_FILE}:${b.line}`,
    })
  }
  rows.sort((a, b) => byBytes(a.key, b.key))
  return rows
}

/** Every `ProviderReview` constant, by name, with the state it records. */
export function providerReviews() {
  const map = new Map()
  const fileLines = lines(REVIEWS_FILE)
  for (const b of blocks(
    fileLines,
    /^export const [A-Z0-9_]+: ProviderReview = \{\s*$/,
    /^\}\s*$/,
  )) {
    const name = /^export const ([A-Z0-9_]+):/.exec(b.text)?.[1]
    const state = field(b.text, "state", 2)
    if (name && state) map.set(name, state)
  }
  return map
}

/* ───────────────────────────────────────────────────── model catalog ───── */

export function modelCatalog() {
  const fileLines = lines(MODELS_FILE)
  const rows = []
  for (const b of blocks(fileLines, /^ {2}\{\s*$/, /^ {2}\},\s*$/)) {
    const key = field(b.text, "key")
    if (!key || field(b.text, "kind") !== "model") continue
    rows.push({
      source: "model",
      key,
      displayName: field(b.text, "displayName"),
      provider: field(b.text, "provider"),
      product: field(b.text, "modelId"),
      capability: "completion",
      direction: "write",
      lifecycle: field(b.text, "lifecycle") ?? "PLANNED",
      // A model row carries no capability status of its own: it is an allowlist
      // entry for the connector that invokes it, and `modelIsAllowed` is the
      // only thing that reads it.
      capabilityStatus: null,
      egressHosts: [],
      requirementIds: [],
      regions: stringArray(b.text, "regions"),
      engine: "—",
      review: null,
      declaredAt: `${MODELS_FILE}:${b.line}`,
    })
  }
  rows.sort((a, b) => byBytes(a.key, b.key))
  return rows
}

/* ────────────────────────────────────────────── payments capabilities ──── */

/**
 * The Stripe capability leaves.
 *
 * `planned(` and `unsupported(` are the registry's two constructors and the
 * first two arguments of each are the leaf id and its Stripe program, on the
 * same line or the next — which is why the pattern spans whitespace rather than
 * assuming a formatter.
 */
export function paymentCapabilities() {
  const text = read(PAYMENTS_FILE).replace(/\r\n/g, "\n")
  const provider = /provider:\s*"([a-z0-9-]+)"/.exec(text)?.[1] ?? "unknown"
  const apiVersion =
    /PROVIDER_API_VERSION\s*=\s*"([0-9-]+)"/.exec(read(PAYMENTS_VERSION_FILE))?.[1] ?? "—"

  const rows = []
  const re = /\b(planned|unsupported)\(\s*"([^"]+)",\s*"([^"]+)"/g
  for (const m of text.matchAll(re)) {
    const line = text.slice(0, m.index).split("\n").length
    rows.push({
      source: "payment-capability",
      key: m[2],
      displayName: m[2],
      provider,
      product: m[3],
      capability: m[2],
      direction: "bidirectional",
      lifecycle: m[1] === "planned" ? "PLANNED" : "UNSUPPORTED",
      capabilityStatus: m[1] === "planned" ? "PLANNED" : "UNSUPPORTED",
      egressHosts: [],
      requirementIds: [],
      regions: [],
      engine: `api ${apiVersion}`,
      review: null,
      declaredAt: `${PAYMENTS_FILE}:${line}`,
    })
  }
  rows.sort((a, b) => byBytes(a.key, b.key))
  return rows
}

/* ──────────────────────────────────────────── third-party hosts in code ── */

/**
 * Reserved names, which are not systems.
 *
 * RFC 2606 and RFC 6761 set `.test`, `.example`, `.invalid` and `.localhost`
 * aside precisely so a document like this can tell a fixture from a vendor, and
 * a label of `example` anywhere in the name is the same convention one level in
 * (`tenure.example.edu`). Everything else is listed, including this platform's
 * own domains: "named in code" is the claim, and first-party hosts satisfy it.
 */
const RESERVED = /(^|\.)(test|example|invalid|localhost)$|(^|\.)example(\.|$)/

/**
 * A public hostname has a dot and an alphabetic top label.
 *
 * `apps/system-studio/src/lib/aws/drift.ts` explains its comment parser with
 * the string `"https://x"`, and without this filter the inventory grew a system
 * called `x`. A single-label name is a placeholder, never a vendor.
 */
const IS_HOSTNAME = /\.[a-z]{2,}$/

/** Which part of the tree a path belongs to, for a churn-free area column. */
function areaOf(file) {
  if (file.startsWith("apps/web/")) return "apps/web"
  if (file.startsWith("apps/system-studio/")) return "apps/system-studio"
  if (file.startsWith("packages/")) return `packages/${file.split("/")[1]}`
  if (file.startsWith("modules/")) return "modules"
  return "other"
}

/**
 * Every third-party host named in tracked, non-test source.
 *
 * The row records the host, the AREAS that name it and whether the occurrences
 * are all inside comment text — not the individual call sites. That is a
 * deliberate stability choice: the unit of this inventory is the SYSTEM, so
 * moving a URL between two files in the same package must not churn a committed
 * document, while a host nobody had contacted before must.
 */
export function codedHosts() {
  // Keyed by host, valued with the FIRST catalog row that declares it in key
  // order — `api.atlassian.com` is declared by both Atlassian packs, and an
  // attribution that depended on iteration order would not be reproducible.
  const declared = new Map()
  for (const row of [...providerPacks(), ...catalogConnectors()]) {
    for (const host of row.egressHosts) {
      if (!declared.has(host)) declared.set(host, row.key)
    }
  }

  const found = new Map()
  const at = (host) => {
    const row = found.get(host) ?? { host, areas: new Set(), url: false }
    found.set(host, row)
    return row
  }

  for (const file of trackedSources("apps", "packages", "modules")) {
    if (IS_TEST_FILE(file)) continue
    const area = areaOf(file)
    for (const line of lines(file)) {
      const trimmed = line.trim()
      const isComment =
        trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")
      for (const m of line.matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g)) {
        const host = m[1].toLowerCase().replace(/\.$/, "")
        if (RESERVED.test(host) || !IS_HOSTNAME.test(host)) continue
        const row = at(host)
        row.areas.add(area)
        if (!isComment) row.url = true
      }
    }
  }

  // Declared egress hosts that no URL spells out — `graph.microsoft.com` is
  // declared by the Microsoft pack and appears in no `https://` literal — are
  // systems this platform has committed to reaching, so they are rows too.
  for (const host of declared.keys()) at(host).areas.add(areaOf(PACKS_FILE))

  return [...found.values()]
    .map((r) => ({
      host: r.host,
      areas: [...r.areas].sort(byBytes),
      // Precedence: a live URL beats an egress declaration beats prose. A host
      // that only ever appears inside a comment is a documented example, and
      // saying so is the difference between an inventory and a scare.
      evidence: r.url ? "url" : declared.has(r.host) ? "egress declaration" : "prose only",
      declaredBy: declared.get(r.host) ?? null,
    }))
    .sort((a, b) => byBytes(a.host, b.host))
}

/* ─────────────────────────────────────────────────────── AWS services ──── */

/**
 * The AWS services this platform is deployed on.
 *
 * Only quoted module specifiers count. `@aws-sdk/client-cognito-*` appears in a
 * prose comment in `apps/system-studio/src/lib/aws/cognito.ts`, and a bare
 * pattern scan turns that sentence into a package named `client-cognito-`.
 */
export function awsServices() {
  const found = new Map()
  for (const file of trackedSources("apps", "packages", "modules", "tools")) {
    const area = areaOf(file)
    for (const m of read(file).matchAll(/["'](@aws-sdk\/client-[a-z0-9]+(?:-[a-z0-9]+)*)["']/g)) {
      const row = found.get(m[1]) ?? { pkg: m[1], areas: new Set() }
      row.areas.add(area)
      found.set(m[1], row)
    }
  }
  return [...found.values()]
    .map((r) => ({ pkg: r.pkg, areas: [...r.areas].sort(byBytes) }))
    .sort((a, b) => byBytes(a.pkg, b.pkg))
}

/* ───────────────────────────────────────── the sixteen states, from §6 ── */

/**
 * The Bible's §6 lifecycle vocabulary, parsed out of the Bible.
 *
 * Not copied into this file. "The exact catalog lifecycle" is a claim about
 * what §6 says, so it is read from §6 — and if somebody edits the Bible's list,
 * every classification below is re-derived against the new one instead of
 * quietly continuing to use the old.
 */
export function bibleLifecycles() {
  const text = read(BIBLE).replace(/\r\n/g, "\n")
  const at = text.indexOf("## 6. Catalog truth and lifecycle")
  if (at === -1) throw new Error(`${BIBLE} no longer has a "## 6. Catalog truth and lifecycle"`)
  const fence = text.indexOf("```text", at)
  const end = text.indexOf("```", fence + 7)
  if (fence === -1 || end === -1) throw new Error(`${BIBLE} §6 no longer contains the state block`)
  return text
    .slice(fence + 7, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[A-Z_]+$/.test(l))
}

/**
 * The derivation, written as rules rather than as a column somebody typed.
 *
 * Each rule states the declared facts it reads and the §6 state they support.
 * The ceiling is `IN_DEVELOPMENT` and that is the honest ceiling: every state
 * above it asserts a sandbox run, a provider submission or a certification, and
 * no record of any of those exists in this tree. `RELAY_ANTHROPIC_REVIEW.state`
 * is literally `NOT_SUBMITTED`.
 */
export const RULES = [
  {
    id: "R1",
    when: "capability status PLANNED (or a pack that declared none, which `pack()` defaults to PLANNED)",
    state: "PLANNED",
    test: (r) => r.capabilityStatus === "PLANNED",
  },
  {
    id: "R2",
    when: "capability status DEVELOPMENT",
    state: "IN_DEVELOPMENT",
    test: (r) => r.capabilityStatus === "DEVELOPMENT",
  },
  {
    id: "R3",
    when: "capability status CERTIFICATION_PENDING and the provider review is NOT_SUBMITTED — code exists, nobody has approached the provider",
    state: "IN_DEVELOPMENT",
    test: (r) => r.capabilityStatus === "CERTIFICATION_PENDING" && r.review === "NOT_SUBMITTED",
  },
  {
    id: "R4",
    when: "capability status CERTIFICATION_PENDING and a provider review has been submitted",
    state: "PROVIDER_REVIEW_PENDING",
    test: (r) =>
      r.capabilityStatus === "CERTIFICATION_PENDING" &&
      r.review !== null &&
      r.review !== "NOT_SUBMITTED",
  },
  {
    id: "R5",
    when: "capability status UNSUPPORTED, or a payments leaf built by `unsupported()`",
    state: "UNSUPPORTED",
    test: (r) => r.capabilityStatus === "UNSUPPORTED",
  },
  {
    id: "R6",
    when: "a model-catalog row, which carries no capability status: it is an allowlist entry for the connector that invokes it and inherits that connector's state",
    state: "IN_DEVELOPMENT",
    test: (r) => r.source === "model" && r.capabilityStatus === null,
  },
]

/** The §6 state a row's own declaration supports, or `null` if no rule fits. */
export function classify(row) {
  for (const rule of RULES) if (rule.test(row)) return { state: rule.state, rule: rule.id }
  return { state: null, rule: null }
}

/* ─────────────────────────────────────────────────────────── assembly ──── */

export function inventory() {
  const catalogRows = [
    ...providerPacks(),
    ...catalogConnectors(),
    ...modelCatalog(),
    ...paymentCapabilities(),
  ]
  return {
    catalogRows,
    hosts: codedHosts(),
    aws: awsServices(),
    lifecycles: bibleLifecycles(),
  }
}

const HEADER = (doc, requirement) =>
  [
    `<!-- Generated by tools/cat-integration-inventory.mjs. Do not edit by hand. -->`,
    `<!-- Regenerate: node tools/cat-integration-inventory.mjs -->`,
    ``,
    `# ${doc}`,
    ``,
    `${requirement}`,
    ``,
  ].join("\n")

const cell = (v) => (v === null || v === undefined || v === "" ? "—" : String(v))
const list = (v) => (v.length === 0 ? "—" : v.map((x) => `\`${x}\``).join(" "))

export function renderInventory(inv = inventory()) {
  const out = []
  out.push(
    HEADER(
      "Integration inventory",
      `Closes **CAT-000-002** — every integration, app and system currently named, displayed, ` +
        `configured, coded, deployed or used by a tenant, derived from the tree by ` +
        `\`tools/cat-integration-inventory.mjs\`. Every row names the file that declares it. ` +
        `Nothing here is a statement that a connector works; the availability question is ` +
        `\`${CLASSIFICATION_DOC}\`.`,
    ),
  )

  out.push(`## 1. Catalog rows (${inv.catalogRows.length})`)
  out.push("")
  out.push("| Key | Provider | Product | Capability | Direction | Declared lifecycle | Declared at |")
  out.push("| --- | --- | --- | --- | --- | --- | --- |")
  for (const r of inv.catalogRows) {
    out.push(
      `| \`${r.key}\` | ${cell(r.provider)} | ${cell(r.product)} | ${cell(r.capability)} | ` +
        `${cell(r.direction)} | \`${r.lifecycle}\` | \`${r.declaredAt}\` |`,
    )
  }
  out.push("")

  out.push(`## 2. Third-party and first-party hosts named in tracked source (${inv.hosts.length})`)
  out.push("")
  out.push(
    "Reserved names (RFC 2606 / RFC 6761 `.test`, `.example`, `.invalid`, `.localhost`) are " +
      "fixtures, not systems, and are excluded. `Evidence` says how the host is present: a " +
      "live `https://` string, a catalog `egressHosts` declaration, or prose only.",
  )
  out.push("")
  out.push("| Host | Declared by catalog row | Evidence | Areas |")
  out.push("| --- | --- | --- | --- |")
  for (const h of inv.hosts) {
    out.push(
      `| \`${h.host}\` | ${h.declaredBy ? `\`${h.declaredBy}\`` : "— (no catalog row)"} | ` +
        `${h.evidence} | ${list(h.areas)} |`,
    )
  }
  out.push("")

  out.push(`## 3. AWS services the platform is deployed on (${inv.aws.length})`)
  out.push("")
  out.push(
    "Derived from quoted `@aws-sdk/client-*` module specifiers in tracked source. These are " +
      "the runtime the Bible pins (\"Tenure vendor cloud in Tenure-owned AWS only\"), not " +
      "catalog provider products, and they carry no §6 lifecycle for that reason.",
  )
  out.push("")
  out.push("| Package | Areas |")
  out.push("| --- | --- |")
  for (const a of inv.aws) out.push(`| \`${a.pkg}\` | ${list(a.areas)} |`)
  out.push("")

  return out.join("\n")
}

export function renderClassification(inv = inventory()) {
  const out = []
  out.push(
    HEADER(
      "Catalog lifecycle classification",
      `Closes **CAT-000-003** — every provider / product / capability / direction / region / version in ` +
        `\`${INVENTORY_DOC}\`, classified with the exact sixteen-state lifecycle printed in §6 ` +
        `of \`${BIBLE}\`. The state column is DERIVED from each row's own declaration by the ` +
        `rules below; it is not typed in.`,
    ),
  )

  out.push(`## The §6 vocabulary (${inv.lifecycles.length} states, read from the Bible)`)
  out.push("")
  out.push(inv.lifecycles.map((s) => `\`${s}\``).join(" · "))
  out.push("")

  out.push("## Derivation rules")
  out.push("")
  out.push("| Rule | Reads | §6 state |")
  out.push("| --- | --- | --- |")
  for (const r of RULES) out.push(`| ${r.id} | ${r.when} | \`${r.state}\` |`)
  out.push("")
  out.push(
    "No rule can produce a state above `IN_DEVELOPMENT`. `SANDBOX_VALIDATED`, " +
      "`PROVIDER_REVIEW_PENDING`, `TENURE_CERTIFIED`, `TENANT_ELIGIBLE` and everything after " +
      "them assert a sandbox run, a provider submission or a certification, and this tree " +
      "records none — `RELAY_ANTHROPIC_REVIEW.state` is `NOT_SUBMITTED`. A rule that emitted " +
      "one anyway would be a fabricated approval.",
  )
  out.push("")

  const counts = new Map()
  for (const r of inv.catalogRows) {
    const { state } = classify(r)
    counts.set(state ?? "UNCLASSIFIED", (counts.get(state ?? "UNCLASSIFIED") ?? 0) + 1)
  }
  out.push(`## Classification (${inv.catalogRows.length} rows)`)
  out.push("")
  out.push(
    [...counts.entries()]
      .sort((a, b) => byBytes(a[0], b[0]))
      .map(([s, n]) => `\`${s}\` ${n}`)
      .join(" · "),
  )
  out.push("")
  out.push(
    "| Key | Provider | Product | Capability | Direction | Region | Version | §6 lifecycle | Rule |",
  )
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
  for (const r of inv.catalogRows) {
    const { state, rule } = classify(r)
    out.push(
      `| \`${r.key}\` | ${cell(r.provider)} | ${cell(r.product)} | ${cell(r.capability)} | ` +
        `${cell(r.direction)} | ${r.regions.length ? list(r.regions) : "not declared"} | ` +
        `${cell(r.engine)} | \`${state ?? "UNCLASSIFIED"}\` | ${cell(rule)} |`,
    )
  }
  out.push("")

  return out.join("\n")
}

/* ────────────────────────────────────────────────────────────── command ── */

const isCommand =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const inv = inventory()
  const outputs = [
    [INVENTORY_DOC, renderInventory(inv)],
    [CLASSIFICATION_DOC, renderClassification(inv)],
  ]

  if (process.argv.includes("--check")) {
    let stale = false
    for (const [file, text] of outputs) {
      const abs = path.join(ROOT, file)
      const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : ""
      if (current !== text) {
        console.error(`::error::${file} is stale. Run: node tools/cat-integration-inventory.mjs`)
        stale = true
      }
    }
    if (stale) process.exit(1)
    console.log("cat integration inventory documents are up to date.")
  } else {
    for (const [file, text] of outputs) {
      fs.writeFileSync(path.join(ROOT, file), text)
      console.log(`Wrote ${file}`)
    }
    console.log(
      `${inv.catalogRows.length} catalog rows · ${inv.hosts.length} hosts · ${inv.aws.length} AWS services`,
    )
  }
}
