#!/usr/bin/env node
/**
 * TTES-GATE-000 — the tenant experience's own architecture, written down.
 *
 * The gate is "Tenant experience has a distinct documented architecture", and
 * the asymmetry that made it fail was findable in one `ls`: the OPERATOR
 * experience has `docs/architecture/studio-information-architecture.md` and
 * `docs/architecture/studio-design-system.md`, and the tenant experience — the
 * one this Bible governs, the one a student and a director actually sign into —
 * had neither. What it had was three generated inventories that each answer a
 * different narrower question (`entry-points.md`: what is exposed;
 * `ownership.md`: which domain owns a file; `ttes-experience-audit.md`: what the
 * current product measures) and no document that says what the experience IS.
 *
 * ── Generated, not written ──────────────────────────────────────────────────
 *
 * The console's document is a hand-written normative spec, and that is right for
 * a thing being built. This one describes a product that exists, and a
 * hand-written description of an existing product has one failure mode — "was
 * right once" — which reads identically to "is right". So every section is
 * derived from the code by a reader that already exists:
 *
 *   * the experiences and the route map from `tools/entry-point-inventory.mjs`
 *     (`EXPERIENCES`, `collect`);
 *   * the token tiers from the generated catalog `apps/web/src/lib/a11y/tokens.ts`;
 *   * ownership from `tools/ownership-map.mjs` (`classify`), inverted per file so
 *     this cannot disagree with the ownership ratchet;
 *   * the shell and the owned component layer from the directories themselves.
 *
 * One thing is deliberately NOT re-derived: the navigation catalog. Three
 * separate readers of `modules/index.ts` already exist in `tests/architecture/`,
 * and a fourth would be the defect this repository has already paid for once —
 * "which is what having two parsers costs", as `tools/document-graph.mjs` puts
 * it. §4 therefore cites the catalog and the guard that closes its vocabulary,
 * by file and identifier, and the guard for this document checks the citation
 * resolves rather than copying the numbers out of it.
 *
 * Usage:  node tools/tenant-experience-architecture.mjs [--check]
 *   --check  exit non-zero if the committed document is out of date
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ROOT } from "./document-graph.mjs"
import { DOMAINS, classify } from "./ownership-map.mjs"
import { EXPERIENCES, collect } from "./entry-point-inventory.mjs"

const OUT = "docs/architecture/tenant-experience-architecture.md"

const TENANT = "tenant"
const TENANT_APP = "apps/web"
const SHELL_DIR = "apps/web/src/components/shell"
const OWNED_DIR = "apps/web/src/components/ui"
const TOKEN_CATALOG = "apps/web/src/lib/a11y/tokens.ts"

/**
 * The navigation authority, cited rather than re-parsed. Each entry is a file
 * and an identifier the guard greps for, so a rename reds this document instead
 * of leaving it pointing at a decision that has moved.
 */
export const NAVIGATION_AUTHORITY = [
  { file: "modules/index.ts", names: ["ModuleManifest", "navigation"], what: "the catalog every tenant nav entry comes from" },
  {
    file: "tests/architecture/nav-hrefs-are-served.test.mjs",
    names: ["SECTIONS", "MAX_ENTRIES_PER_SECTION"],
    what: "the closed section vocabulary and the per-section entry budget that keep the nav from accreting",
  },
  {
    file: "tests/architecture/shell-separation.test.mjs",
    names: ["hardcodedDestinations", "HREF_LITERAL"],
    what: "the guard that refuses a control-plane destination in the tenant shell, in either href syntax",
  },
]

const posix = (p) => p.split(path.sep).join("/")
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")

/**
 * `tools/entry-point-inventory.mjs` resolves its paths relative to the process's
 * working directory and shells out to `git ls-files`, so it answers correctly
 * only from the repository root. Every platform test already runs from there;
 * this fails loudly rather than rendering a document with an empty route map,
 * which is the shape a reader would trust.
 */
function requireRootCwd() {
  if (!fs.existsSync(path.join(process.cwd(), "apps/web/src/app"))) {
    throw new Error(
      `Run this from the repository root: the route inventory reads relative paths and git. cwd=${process.cwd()}`,
    )
  }
}

/** Files directly under a directory, sorted, ignoring tests. */
function modulesIn(dir) {
  return fs
    .readdirSync(path.join(ROOT, dir))
    .sort()
    .filter((n) => /\.tsx?$/.test(n) && !/\.(test|itest|spec)\./.test(n))
    .map((n) => `${dir}/${n}`)
}

/** Every layout that frames a tenant route, walked from the app root. */
export function tenantLayouts() {
  const out = []
  const walk = (dir) => {
    const entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (entry.name === "layout.tsx") out.push(rel)
    }
  }
  walk(`${TENANT_APP}/src/app`)
  return out
}

/** Token counts per tier, out of the generated catalog rather than the stylesheet. */
export function tokenTiers() {
  const source = read(TOKEN_CATALOG)
  const tiers = new Map()
  for (const m of source.matchAll(/layer:\s*"(\w+)"/g)) tiers.set(m[1], (tiers.get(m[1]) ?? 0) + 1)
  return [...tiers.entries()].sort((a, b) => b[1] - a[1])
}

/**
 * The control-plane prefixes a tenant route may not sit under.
 *
 * Derived from the ownership map's `control-plane` domain rather than written
 * here, which is the same derivation `tests/architecture/shell-separation.test.mjs`
 * makes: `apps/web/src/app/api/platform/` is a control-plane surface SERVED BY
 * the customer application, and a hand-written list of prefixes misses exactly
 * that case.
 */
export function controlPlaneRoutes() {
  const domain = DOMAINS.find((d) => d.key === "control-plane")
  const prefix = `${TENANT_APP}/src/app/`
  return domain.owns
    .filter((o) => o.startsWith(prefix))
    .map((o) => `/${o.slice(prefix.length).replace(/\/$/, "")}`)
    .sort()
}

/** Tenant routes, grouped by their first real segment. */
function routeGroups(pages) {
  const groups = new Map()
  for (const page of pages) {
    // `/(app)/orgs/[slug]` → `orgs`. Route groups are parentheses and are not a
    // URL segment, so they are not a grouping a reader would recognise.
    const segment = page.route.split("/").filter((s) => s && !s.startsWith("("))[0] ?? "(root)"
    const list = groups.get(segment) ?? []
    list.push(page)
    groups.set(segment, list)
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

const table = (header, rows) =>
  [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows].join("\n")

export function render() {
  requireRootCwd()
  const { pages, apiRoutes, actions } = collect()
  const tenantPages = pages.filter((p) => p.experience === TENANT).sort((a, b) => (a.route < b.route ? -1 : 1))
  const tenantApi = apiRoutes.filter((r) => r.experience === TENANT)
  const tenantActions = actions.filter((a) => a.experience === TENANT)
  const layouts = tenantLayouts()
  const shell = modulesIn(SHELL_DIR)
  const owned = modulesIn(OWNED_DIR)
  const tiers = tokenTiers()
  const groups = routeGroups(tenantPages)
  const controlPlane = controlPlaneRoutes()

  const { byDomain, byExperience } = classify()
  const tenantFiles = new Set((byExperience.get(TENANT) ?? []).map(posix))
  const domainRows = DOMAINS.map((d) => ({
    key: d.key,
    what: d.what,
    files: (byDomain.get(d.key) ?? []).map(posix).filter((f) => tenantFiles.has(f)).length,
  }))
    .filter((d) => d.files > 0)
    .sort((a, b) => b.files - a.files || (a.key < b.key ? -1 : 1))

  return `# The tenant experience — architecture

TTES-GATE-000. Generated by \`tools/tenant-experience-architecture.mjs\`; run it
with \`--check\` to fail on a stale copy, which
\`tests/architecture/tenant-experience-architecture.test.mjs\` does in CI.

The operator console had a documented architecture
(\`docs/architecture/studio-information-architecture.md\`,
\`docs/architecture/studio-design-system.md\`) and the tenant experience had none.
It had three generated inventories that each answer a narrower question —
\`entry-points.md\` (what is exposed), \`ownership.md\` (which domain owns a file),
\`ttes-experience-audit.md\` (what the current product measures) — and nothing that
says what the experience IS. This is that document, and it is derived rather than
written, because a hand-written description of a product that exists fails by
being right once.

## 1. Two experiences, and the boundary between them

\`Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md\` §1 — cited
by filename deliberately: \`tools/document-graph.mjs\` classifies any \`.md\` whose
first 4,000 characters contain the bare word that names an authority as an
authority document itself, and a generated description of a product must not
enter the document graph as one. \`docs/architecture/ttes-experience-audit.md\`
avoids the same trap.

They share token TOOLING, accessibility primitives and secure
components; they do not share navigation, page templates, information
architecture, terminology or default density.

${table(
  ["Experience", "Application", "Stylesheet", "What it is"],
  EXPERIENCES.map((e) => `| \`${e.key}\` | \`${e.app}\` | \`${e.globals}\` | ${e.what} |`),
)}

The separation is enforced, not described: \`tests/architecture/shell-separation.test.mjs\`
refuses a cross-application import, a shared shell component either application
renders through, and a control-plane destination in the tenant navigation —
including one written in the JSX attribute form, which was the syntax that got a
\`/platform/cost\` link past it once.

Routes a tenant surface may never be, derived from the \`control-plane\` domain of
\`tools/ownership-map.mjs\` rather than listed here: ${controlPlane.map((r) => `\`${r}\``).join(", ")}.

## 2. The shell — what frames every tenant route

${layouts.length} layouts frame the tenant application, and ${shell.length} shell modules
compose them. The masthead, the primary navigation, the tenant switcher, the
command palette, the notification bell and the offline boundary are shell
concerns; a domain surface renders inside them and never replaces them.

${table(["Layout", "Depth"], layouts.map((l) => `| \`${l}\` | ${l.split("/").length - 4} |`))}

Shell modules: ${shell.map((f) => `\`${path.basename(f, ".tsx")}\``).join(", ")}.

## 3. The route map — every surface the tenant application serves

${tenantPages.length} pages, ${tenantApi.length} API routes and ${tenantActions.reduce((n, a) => n + a.exported.length, 0)} server
actions, from \`tools/entry-point-inventory.mjs\`. Guards are the ones the handler
or an ancestor layout names; \`tests/security/entry-points.test.mjs\` is what makes
an unguarded new surface fail rather than merely appear here.

${groups
  .map(
    ([segment, list]) => `### \`/${segment}\` — ${list.length} page${list.length === 1 ? "" : "s"}

${table(
  ["Route", "Guards"],
  list.map((p) => `| \`${p.route}\` | ${p.guards.length ? p.guards.map((g) => `\`${g}\``).join(" + ") : "**none**"} |`),
)}`,
  )
  .join("\n\n")}

## 4. Navigation — cited, not re-parsed

The tenant navigation is decided in one place and constrained by two guards.
This document does not copy their numbers: three readers of \`modules/index.ts\`
already exist under \`tests/architecture/\`, and a fourth parser of the same file
is the defect this repository has already paid for. What is checked instead is
that the citation resolves — the guard for this document greps each file below
for each identifier.

${table(
  ["Authority", "Identifiers", "What it decides"],
  NAVIGATION_AUTHORITY.map((a) => `| \`${a.file}\` | ${a.names.map((n) => `\`${n}\``).join(", ")} | ${a.what} |`),
)}

## 5. The token layers

From the generated catalog \`${TOKEN_CATALOG}\`, which
\`apps/web/src/lib/a11y/tokens.test.ts\` re-derives from \`globals.css\` so it cannot
disagree with the stylesheet the product ships.

${table(["Tier", "Tokens"], tiers.map(([tier, n]) => `| \`${tier}\` | ${n} |`))}

Only the primitive tier declares a raw colour; every colour-valued semantic and
component token references a primitive (TTES-010-001). Four themes resolve
through the same pool — light, dark, high contrast light and high contrast dark —
and every pairing is measured for WCAG 2.2 AA by
\`apps/web/src/lib/a11y/contrast.ts\` rather than reviewed.

## 6. Who owns what inside the tenant experience

Domains from \`tools/ownership-map.mjs\`, restricted to files the map places in the
tenant experience. Counts are files, not lines.

${table(["Domain", "Tenant files", "What the domain is"], domainRows.map((d) => `| \`${d.key}\` | ${d.files} | ${d.what} |`))}

## 7. What this document does not decide, and does not establish

- **It is not a specification.** The console's information architecture document
  is normative — sections of it say what must be built. This one is descriptive:
  it says what the tenant experience currently is, and the requirements that
  change it are the \`TTES-*\` rows in
  \`docs/implementation/tenant-experience-execution-ledger.md\`.
- **Nothing here is rendered.** Every number comes from the repository. What a
  browser does with it — focus order, screen-reader output, reflow at 400% zoom —
  is \`TTES-040-*\` work and \`docs/architecture/ttes-experience-audit.md\` §7 lists
  it as NOT ESTABLISHED for the same reason.
- **Guards named here are named, not summarised.** Where this document says a
  property is enforced it cites the file that enforces it, because a document
  that describes an enforcement it does not link to is how a check gets deleted
  without anybody noticing.
- **The deployer experience is out of scope** beyond §1's boundary. It has its
  own two documents and its own ledger.
`
}

const isCommand = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const generated = render()
  const target = path.join(ROOT, OUT)
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/tenant-experience-architecture.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(target, generated)
    console.log(`Wrote ${OUT}.`)
  }
}

export { OUT, TENANT_APP, TOKEN_CATALOG }
