/**
 * TTES-GATE-000 — the tenant experience has a distinct documented architecture,
 * and the document stays true.
 *
 * The gate's four children (`TTES-000-001` … `TTES-000-004`) are all PASS and
 * carry their own evidence. What none of them produced is the thing the gate is
 * named for: the operator console has
 * `docs/architecture/studio-information-architecture.md` and
 * `docs/architecture/studio-design-system.md`, and the tenant experience had no
 * equivalent at all. `docs/architecture/tenant-experience-architecture.md` is
 * that document and this is its ratchet.
 *
 * Four properties, and the last one is the one that found a real defect:
 *
 *   1. the document is what the generator produces now, deterministically;
 *   2. every path and every citation in it resolves — including the navigation
 *      authority it deliberately cites instead of re-parsing;
 *   3. it is DISTINCT: no tenant route it maps sits under a control-plane prefix,
 *      and both experiences are named with their own stylesheet;
 *   4. the tenant experience's own record — this family's ledger — cites files
 *      that exist. On its first run it found three: `TTES-030-002` is PASS and
 *      its `Code:` line named `(app)/admin/audit/loading.tsx`,
 *      `(app)/resources/loading.tsx` and `(app)/orgs/loading.tsx`, all three of
 *      which were deleted in `a8ceb8b` because a `loading.tsx` on those subtrees
 *      aborts the App Router's RSC fetch mid-flight and wedged twelve e2e cases.
 *      A PASS citing files nobody has is not documentation.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT, classify as classifyDocuments } from "../../tools/document-graph.mjs"
import {
  NAVIGATION_AUTHORITY,
  OUT,
  controlPlaneRoutes,
  render,
  tenantLayouts,
  tokenTiers,
} from "../../tools/tenant-experience-architecture.mjs"

const LEDGER = "docs/implementation/tenant-experience-execution-ledger.md"

const committed = () => fs.readFileSync(path.join(ROOT, OUT), "utf8")

test("the committed architecture document matches what the generator produces now", () => {
  assert.equal(
    committed(),
    render(),
    `${OUT} is stale. Run: node tools/tenant-experience-architecture.mjs`,
  )
  // Two renders, byte-compared: a Map ordered by insertion or a directory read
  // ordered by the filesystem is "current here, stale in CI".
  assert.equal(render(), render(), "two renders in one process disagree; something in the generator is ordered by chance.")
  const text = committed()
  assert.ok(!text.includes("\r"), "the document contains a CR byte and will differ between platforms.")
  assert.ok(
    !/`[A-Za-z0-9_.@/()[\]-]*\\[A-Za-z0-9_.@/()[\]-]*`/.test(text),
    "the document cites a Windows-separated path; every path must be POSIX-normalised.",
  )
  assert.ok(
    !/\b\d{4}-\d{2}-\d{2}\b/.test(text),
    "the document states a date, which makes it a function of the clock rather than of the code.",
  )
})

test("a generated description does not enter the document graph as an authority", () => {
  // `tools/document-graph.mjs` classifies any `.md` whose first 4,000 characters
  // contain a bare authority word — `Bible`, `Constitution`, `Control Plane` — as
  // an authority document. This one describes a product; it states no
  // requirement and must not be counted as stating any, or the registry's
  // denominators move because somebody wrote a paragraph. Caught before it
  // shipped: the first render said "Bible §1" in §1 and WAS classified, which is
  // why §1 now cites the authority by filename (`_Bible_` has no word boundary).
  const graphed = classifyDocuments().map((d) => d.canonical_path)
  assert.ok(graphed.length >= 20, `Only ${graphed.length} documents classified; the reader is not reading.`)
  assert.ok(!graphed.includes(OUT), `${OUT} is being classified as a platform authority document.`)
  assert.ok(
    !graphed.includes("docs/architecture/ttes-governance-dashboard.md"),
    "the governance dashboard is being classified as a platform authority document.",
  )
})

test("the document describes a real shell, route map and token pipeline", () => {
  // Floors. Every interesting assertion below is about the CONTENT of a derived
  // table, and a derivation that returned nothing would render a short document
  // that passes every one of them.
  const text = committed()
  const layouts = tenantLayouts()
  assert.ok(layouts.length >= 3, `Only ${layouts.length} tenant layouts found; the shell walk has collapsed.`)
  assert.ok(
    layouts.includes("apps/web/src/app/(app)/layout.tsx"),
    "the layout that mounts the tenant shell is not among the layouts read.",
  )

  const tiers = tokenTiers()
  assert.equal(tiers.length, 3, `Expected the three declared tiers, got ${tiers.map(([t]) => t).join(", ")}.`)
  const total = tiers.reduce((n, [, count]) => n + count, 0)
  assert.ok(total >= 200, `Only ${total} tokens in the catalog; the tier reader has stopped reading.`)
  const primitive = tiers.find(([t]) => t === "primitive")
  assert.ok(primitive[1] >= 100, `Only ${primitive[1]} primitives; the tier reader is miscounting.`)

  // The route map has to be the whole map. 40 pages ship today.
  const routeRows = [...text.matchAll(/^\| `(\/[^`]*)` \| /gm)].map((m) => m[1])
  assert.ok(routeRows.length >= 30, `Only ${routeRows.length} routes in the map; the inventory is not being read.`)
  assert.ok(
    routeRows.some((r) => r.startsWith("/(app)/orgs")),
    "the organization surfaces are absent from the route map.",
  )
  // Every experience is named with its own stylesheet, or "distinct" is a word
  // in a title rather than a property of the document.
  for (const globals of ["apps/web/src/app/globals.css", "apps/system-studio/src/app/globals.css"]) {
    assert.ok(text.includes(globals), `${globals} is not named, so the two experiences are not distinguished.`)
  }
})

test("the tenant route map contains no control-plane surface", () => {
  // The distinctness property, asserted rather than asserted-about. The prefixes
  // are derived from the ownership map's control-plane domain, so
  // `apps/web/src/app/api/platform/` — an operator surface served by the
  // customer application — is covered without anybody listing it.
  const prefixes = controlPlaneRoutes()
  assert.ok(prefixes.length >= 1, "no control-plane prefix was derived; the distinctness check cannot fail.")
  const text = committed()
  const mapped = [...text.matchAll(/^\| `(\/[^`]*)` \| /gm)].map((m) => m[1])
  const leaked = mapped.filter((route) => prefixes.some((p) => route === p || route.startsWith(`${p}/`)))
  assert.deepEqual(leaked, [], `A control-plane route appears in the tenant route map: prefixes ${prefixes.join(", ")}.`)
})

test("the navigation authority the document cites instead of re-parsing resolves", () => {
  // §4 deliberately does not copy the nav numbers: three readers of
  // `modules/index.ts` already exist and a fourth parser is the defect this
  // repository has paid for. A citation is only better than a copy if it is
  // checked, so each file is read and each identifier grepped.
  assert.ok(NAVIGATION_AUTHORITY.length >= 3, "the navigation authority list has been emptied.")
  const broken = []
  for (const entry of NAVIGATION_AUTHORITY) {
    const full = path.join(ROOT, entry.file)
    if (!fs.existsSync(full)) {
      broken.push(`${entry.file} does not exist`)
      continue
    }
    const source = fs.readFileSync(full, "utf8")
    for (const name of entry.names) {
      if (!source.includes(name)) broken.push(`${entry.file} no longer declares ${name}`)
    }
    if (!committed().includes(entry.file)) broken.push(`${entry.file} is cited in the code and not in the document`)
  }
  assert.deepEqual(broken, [], "The document cites a navigation authority that has moved.")
})

/**
 * Paths a ledger entry claims as its own code or its own tests.
 *
 * Scoped to the `Code:` / `Code/config:` / `Tests:` bullets on purpose. Evidence
 * prose is full of paths that are *supposed* to be absent — a mutation created
 * and removed (`packages/platform-config/src/ShellChrome.tsx`), a blocker's
 * `ls … # absent` claim (`docs/decisions/ADR-0009-…`) — and a check that
 * reported those would produce a findings list that has to be triaged, which is
 * how the one real finding gets ignored. Measured: naively, seven findings of
 * which three were real; scoped this way, three of three.
 */
export function claimedPaths(text) {
  const EXTENSION = /\.(ts|tsx|mjs|cjs|js|jsx|css|md|json|prisma|yml|yaml|sql|tf)$/
  const KEY = /^\s*[-*]\s*\*{0,2}(?:Code(?:\/config)?|Tests?)\*{0,2}\s*:/
  const lines = text.split("\n")
  const blocks = []
  let buffer = null
  for (const line of lines) {
    if (KEY.test(line)) {
      if (buffer) blocks.push(buffer)
      buffer = line
      continue
    }
    if (buffer === null) continue
    // A new bullet, a numbered evidence item, or a blank line ends the claim.
    if (/^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line) || line.trim() === "") {
      blocks.push(buffer)
      buffer = null
    } else buffer += ` ${line.trim()}`
  }
  if (buffer) blocks.push(buffer)

  // Paths the ledger itself claims are absent are the other guard's business:
  // `tests/architecture/pass-requires-evidence.test.mjs` asserts they are STILL
  // absent, and the two must not contradict each other.
  const claimedAbsent = new Set([...text.matchAll(/^\s*ls\s+([\w./@-]+)\s*#\s*absent/gm)].map((m) => m[1]))

  const out = new Set()
  for (const block of blocks) {
    for (const m of block.matchAll(/`([\w./@()[\]$-]+)`/g)) {
      const cited = m[1].replace(/:\d+(?:-\d+)?$/, "")
      if (!cited.includes("/") || cited.includes("*")) continue
      if (!EXTENSION.test(cited) && !cited.endsWith("/")) continue
      if (claimedAbsent.has(cited)) continue
      out.add(cited)
    }
  }
  return [...out].sort()
}

test("the tenant experience's own record cites files that exist", () => {
  // The roots this ledger writes paths relative to. `(app)/orgs/loading.tsx` and
  // `src/lib/a11y/contrast.ts` are both how somebody working inside `apps/web`
  // writes a path, and a reader resolves them the same way.
  const ROOTS = ["", "apps/web/", "apps/web/src/", "apps/web/src/app/"]
  const text = fs.readFileSync(path.join(ROOT, LEDGER), "utf8")
  const claimed = claimedPaths(text)
  assert.ok(claimed.length >= 40, `Only ${claimed.length} path claims parsed out of the ledger; the reader has gone quiet.`)

  const missing = claimed.filter((p) => !ROOTS.some((r) => fs.existsSync(path.join(ROOT, r + p))))
  assert.deepEqual(
    missing,
    [],
    "The tenant-experience ledger claims code or tests that do not exist. A row citing a file nobody has is not " +
      "evidence — correct the citation, or withdraw the status it supports.",
  )
})
