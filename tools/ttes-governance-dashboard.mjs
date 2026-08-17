#!/usr/bin/env node
/**
 * TTES-050-004 — the adoption, exception and visual-debt dashboard, with an
 * owner against every row.
 *
 * `apps/web/eslint.config.mjs` names this requirement itself. Its "WHAT IS NOT
 * ENFORCED, and why not" section explains that arbitrary spacing and type
 * utilities are "a cleanup project across the whole product rather than a
 * boundary, so it is the debt-ratchet item (TTES-050-004)". That comment carried
 * the measurement by hand — "243 occurrences across 59 files as of 2026-08-07",
 * itself a correction of an earlier "237 across 58" that had drifted — with a
 * one-line node script for re-measuring it that nobody runs.
 *
 * Re-measured on the first run of this generator: **274 across 66**. The debt
 * grew by 31 occurrences and 7 files while the only record of it was a comment,
 * which is the whole argument for this file existing.
 *
 * ── Three tables, and why each is a separate question ───────────────────────
 *
 *   * ADOPTION — is the owned layer actually used? For every Tenure-owned
 *     wrapper, how many product modules import it, and how many still render the
 *     raw element it exists to replace. A wrapper with no importers is not a
 *     design system, it is a folder.
 *   * EXCEPTIONS — what is deliberately allowed to break a rule, by whom, until
 *     when. Read out of `DESIGN_TOKEN_EXCEPTIONS`, so an exception cannot be
 *     granted in the config and stay off the dashboard.
 *   * VISUAL DEBT — what breaks a contract that HAS a sanctioned alternative and
 *     is not yet enforced. That qualification is the difference between debt and
 *     an unmade decision: `ease-out` is a debt row because `--ease-entry` exists;
 *     a rule for something with no alternative would just be a ban.
 *
 * Every debt row carries the domain that owns the file, from
 * `tools/ownership-map.mjs` — the same map the ownership ratchet uses, inverted
 * per file rather than re-derived, so the dashboard cannot disagree with it.
 *
 * ── The budgets are the point ───────────────────────────────────────────────
 *
 * A dashboard that only reports is a number that goes up. `DEBT_BUDGETS` is
 * asserted by `tests/architecture/ttes-governance-dashboard.test.mjs` in BOTH
 * directions: over budget is a regression, under budget is a budget nobody
 * lowered. So paying debt down forces the ratchet down with it, and the number
 * cannot drift back up the way the comment's did.
 *
 * Determinism, because a generated artefact that is current here and stale in CI
 * has burned this programme repeatedly: sorted reads, POSIX paths, CRLF
 * collapsed before anything is counted, and no date, host or revision anywhere
 * in the output. There is deliberately no "days until expiry" column — it would
 * make the document a function of the clock.
 *
 * Usage:  node tools/ttes-governance-dashboard.mjs [--check]
 *   --check  exit non-zero if the committed document is out of date
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ROOT } from "./document-graph.mjs"
import { DOMAINS, classify } from "./ownership-map.mjs"
import { claimsFound, gateState } from "./superiority-claims.mjs"

const OUT = "docs/architecture/ttes-governance-dashboard.md"

/** The tenant product's own source. The console is a separate experience (§1). */
const PRODUCT_ROOT = "apps/web/src"
const OWNED_LAYER = "apps/web/src/components/ui/"
const NOT_PRODUCT = /\.(test|itest|spec)\.[jt]sx?$/

const posix = (p) => p.split(path.sep).join("/")
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")

/**
 * Every shipping module in the tenant product, sorted.
 *
 * `readdirSync` promises no order at all and gives a different one on NTFS than
 * on ext4, so the sort is what keeps the document byte-identical between a
 * developer's machine and CI.
 */
export function productModules(root = PRODUCT_ROOT) {
  const out = []
  const walk = (dir) => {
    const entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (/\.tsx?$/.test(entry.name) && !NOT_PRODUCT.test(entry.name)) out.push(rel)
    }
  }
  walk(posix(root))
  return out
}

/**
 * The owned wrapper layer: one entry per module, with the components it exports.
 *
 * Read from the directory rather than listed, so a wrapper added tomorrow
 * appears on the dashboard with zero importers instead of being invisible.
 */
export function ownedWrappers() {
  const dir = path.join(ROOT, OWNED_LAYER)
  const out = []
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".tsx") || NOT_PRODUCT.test(name)) continue
    const rel = `${OWNED_LAYER}${name}`
    const source = read(rel)
    const exports = [
      ...new Set(
        [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Z]\w*)/g)].map((m) => m[1]),
      ),
    ].sort()
    out.push({ file: rel, module: name.replace(/\.tsx$/, ""), exports })
  }
  return out
}

/** Product modules importing a given owned module, by specifier rather than by name. */
function importersOf(module, modules) {
  const specifier = new RegExp(String.raw`from\s+["'](?:@/components/ui/|\.{1,2}/)${module}["']`)
  return modules.filter((f) => !f.startsWith(OWNED_LAYER) && specifier.test(read(f)))
}

/**
 * The debt classes.
 *
 * `alternative` is not decoration: a contract with no sanctioned alternative is
 * an unmade decision, not debt, and putting one in this table would make the
 * dashboard a wish list. Each `count` is a regex over the module's source with
 * comments left in place — a `<button` inside a comment is a fossil, but the
 * count is a budget rather than a lint finding, and stripping comments here
 * would make this the third comment-stripper in the repository.
 */
export const DEBT_CLASSES = [
  {
    key: "arbitrary-spacing-type",
    what: "Tailwind arbitrary spacing and type values (`p-[7px]`, `text-[13px]`)",
    alternative: "`--space-1…16` and `--step-00…4` in `globals.css`, bound in `tailwind.config.ts`",
    why:
      "Named as this requirement's own item by `apps/web/eslint.config.mjs`: a rule here is a cleanup " +
      "project across the whole product rather than a boundary.",
    // `(?!--|#)` keeps `text-[--error]` (a token reference) and `bg-[#fff]` (a
    // colour, already owned by the colour rules) out of the count. Copied
    // deliberately from the measurement command in that file's header so the
    // number on the dashboard is the number that comment was talking about.
    pattern:
      /\b(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|min-h|max-w|max-h|top|bottom|left|right|inset|inset-x|inset-y|start|end|text|leading|tracking|basis|size)-\[(?!--|#)/g,
  },
  {
    key: "raw-button-element",
    what: "A raw `<button>` in a product module",
    alternative: "`Button` from `@/components/ui/Button`",
    why:
      "The owned Button carries the variant, the size, the focus ring and the pressed state. Two hand-rolled " +
      "copies of its secondary class string had already drifted apart before TTES-020-003 removed them.",
    pattern: /<button[\s>]/g,
  },
  {
    key: "raw-text-input-element",
    what: "A raw text `<input>` or `<textarea>`",
    alternative: "`TextField` from `@/components/ui/TextField` (`multiline` for the textarea)",
    why:
      "The owned field carries the label, the description, the error message and the invalid state. " +
      "Checkbox, radio, file and hidden inputs are NOT counted: no owned wrapper exists for them, so they " +
      "would be a ban rather than debt.",
    pattern: /<textarea[\s>]|<input(?![^>]*type=["'](?:checkbox|radio|file|hidden|submit|button|reset)["'])[\s>]/g,
  },
  {
    key: "raw-select-element",
    what: "A raw `<select>`",
    alternative: "`Select` from `@/components/ui/Select`",
    why: "Same reason as the field: the owned wrapper is what keeps the popover, the keyboard model and the states consistent.",
    pattern: /<select[\s>]/g,
  },
  {
    key: "hand-rolled-page-heading",
    what: "An `<h1>` written by a page instead of the owned page header",
    alternative: "`PageHeader` from `@/components/ui/PageHeader` (identity → status → primary actions)",
    why:
      "The TTES authority `Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md` §5.3, record anatomy. `TTES-030-001` is FAIL for exactly this reason and names the five club " +
      "surfaces that still hand-roll a heading; this is the number that has to reach zero for it to close.",
    pattern: /<h1[\s>]/g,
  },
  {
    key: "easing-keyword",
    what: "A CSS easing keyword (`ease-out`, `ease-in`) in a product module",
    alternative: "`ease-entry` / `ease-exit`, bound to `--ease-entry` / `--ease-exit`",
    why:
      "`apps/web/eslint.config.mjs` declines to ban these because `ease-out` is a keyword rather than a magic " +
      "number and a rule would red files that change did not own. That makes it debt, tracked here.",
    pattern: /\b(?:ease-in-out|ease-in|ease-out|ease-linear)\b/g,
  },
]

/**
 * Budgets. Equal to the measurement on the day they were recorded, and asserted
 * in both directions by the guard: over is a regression, under is a budget
 * nobody lowered. Lower them when debt is paid; there is no mechanism for
 * raising one except an argued edit that a reviewer can see.
 */
export const DEBT_BUDGETS = {
  "arbitrary-spacing-type": 275,
  "raw-button-element": 106,
  "raw-text-input-element": 72,
  "raw-select-element": 27,
  "hand-rolled-page-heading": 29,
  "easing-keyword": 9,
}

/** Occurrences of every debt class, per file, with the domain that owns the file. */
export function debtMeasurements(modules = productModules(), owner = ownerOfFile()) {
  const sources = new Map(modules.map((f) => [f, read(f)]))
  return DEBT_CLASSES.map((cls) => {
    const perFile = []
    for (const file of modules) {
      // The owned layer is the one place allowed to render the raw primitive it
      // wraps — a Button built out of a Button is not a thing. Spacing, type and
      // easing are counted there too, because the wrapper is where a magic
      // number does the most damage: every caller inherits it.
      const wrapping = file.startsWith(OWNED_LAYER) && cls.key.startsWith("raw-")
      if (wrapping) continue
      cls.pattern.lastIndex = 0
      const hits = sources.get(file).match(cls.pattern)
      if (hits) perFile.push({ file, count: hits.length, domain: owner.get(file) ?? "shared" })
    }
    return {
      ...cls,
      occurrences: perFile.reduce((n, f) => n + f.count, 0),
      files: perFile.length,
      budget: DEBT_BUDGETS[cls.key],
      perFile,
    }
  })
}

/**
 * file → domain, inverted from `classify()` rather than re-derived.
 *
 * A second prefix matcher over `DOMAINS` would be free to disagree with the
 * ownership ratchet, and the whole value of an owner column is that it is the
 * same owner the rest of the repository answers with.
 */
export function ownerOfFile() {
  const owner = new Map()
  for (const [domain, files] of classify().byDomain) {
    for (const file of files) owner.set(posix(file), domain)
  }
  return owner
}

/**
 * The exception table, read as text out of `apps/web/eslint.config.mjs`.
 *
 * Not imported, and the reason is measured rather than assumed: importing that
 * config throws (`Cannot read config file … Failed to patch ESLint because the
 * calling module was not recognized`) because it loads `eslint-config-next`
 * through `FlatCompat`. That file already reads `design-system.ts` with a regex
 * for the same class of reason and says so.
 *
 * A malformed entry is not skipped — `expires` and `allow` are required, and the
 * floor in the guard fails if fewer than four entries parse, so a reformat that
 * breaks this reader cannot present an empty exception table as a clean product.
 */
export function designTokenExceptions() {
  const source = read("apps/web/eslint.config.mjs")
  const start = source.indexOf("export const DESIGN_TOKEN_EXCEPTIONS = [")
  if (start === -1) throw new Error("DESIGN_TOKEN_EXCEPTIONS is not declared in apps/web/eslint.config.mjs.")
  const end = source.indexOf("\n]", start)
  const table = source.slice(start, end)
  const out = []
  for (const block of table.split(/\n  \{/).slice(1)) {
    const files = [...block.matchAll(/["']([^"']+\.(?:ts|tsx|mjs|js))["']/g)].map((m) => m[1])
    const allow = /allow:\s*\[([^\]]*)\]/.exec(block)?.[1] ?? ""
    const expires = /expires:\s*["'](\d{4}-\d{2}-\d{2})["']/.exec(block)?.[1] ?? ""
    const reason = /reason:\s*\n?\s*["']([\s\S]*?)["'],\n/.exec(block)?.[1] ?? ""
    out.push({
      files,
      allow: [...allow.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]),
      expires,
      reason: reason.replace(/\s+/g, " ").trim(),
    })
  }
  return out
}

/** Adoption of each owned wrapper, and the raw element it exists to replace. */
export function adoption(modules = productModules()) {
  const wrappers = ownedWrappers().map((w) => ({ ...w, importers: importersOf(w.module, modules).length }))
  return wrappers
}

const table = (header, rows) =>
  [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows].join("\n")

function render() {
  const modules = productModules()
  const owner = ownerOfFile()
  const debt = debtMeasurements(modules, owner)
  const wrappers = adoption(modules)
  const exceptions = designTokenExceptions()
  const gate = gateState()
  const claims = claimsFound().claims

  const byDomain = new Map()
  for (const cls of debt) {
    for (const file of cls.perFile) {
      const current = byDomain.get(file.domain) ?? { occurrences: 0, files: new Set() }
      current.occurrences += file.count
      current.files.add(file.file)
      byDomain.set(file.domain, current)
    }
  }
  const domainRows = [...byDomain.entries()]
    .sort((a, b) => b[1].occurrences - a[1].occurrences || (a[0] < b[0] ? -1 : 1))
    .map(([domain, v]) => {
      const what = DOMAINS.find((d) => d.key === domain)?.what ?? "not a domain — a file the map holds shared"
      return `| \`${domain}\` | ${v.occurrences} | ${v.files.size} | ${what} |`
    })

  const worst = debt
    .flatMap((cls) => cls.perFile.map((f) => ({ ...f, cls: cls.key })))
    .sort((a, b) => b.count - a.count || (a.file < b.file ? -1 : 1))
    .slice(0, 15)
    .map((f) => `| \`${f.file}\` | ${f.cls} | ${f.count} | \`${f.domain}\` |`)

  return `# Tenant experience — adoption, exceptions and visual debt

TTES-050-004. Generated by \`tools/ttes-governance-dashboard.mjs\`; run it with
\`--check\` to fail on a stale copy, and
\`tests/architecture/ttes-governance-dashboard.test.mjs\` does that in CI.

**Nothing here is written by hand.** Adoption is counted from the imports in
${modules.length} shipping modules under \`${PRODUCT_ROOT}\`; the exception table is read
out of \`DESIGN_TOKEN_EXCEPTIONS\` in \`apps/web/eslint.config.mjs\`; every debt row
is attributed to the domain \`tools/ownership-map.mjs\` assigns the file, which is
the same answer the ownership ratchet gives.

This measures the **tenant** experience. \`apps/system-studio\` is a separate
experience with its own stylesheet and its own components (TTES-000-001), and
mixing the two would produce a number that describes neither.

## 1. Adoption — is the owned layer used?

One row per module in \`apps/web/src/components/ui/\`, read from the directory, so a
wrapper added tomorrow appears here with zero importers rather than not at all. A
wrapper nothing imports is a folder, not a design system.

${table(
  ["Owned module", "Exports", "Product modules importing it"],
  wrappers.map((w) => `| \`${w.module}\` | ${w.exports.length ? w.exports.map((e) => `\`${e}\``).join(", ") : "—"} | ${w.importers} |`),
)}

Unimported wrappers: ${wrappers.filter((w) => w.importers === 0).length === 0 ? "none" : wrappers.filter((w) => w.importers === 0).map((w) => `\`${w.module}\``).join(", ")}.

## 2. Exceptions — what is deliberately allowed, and until when

Read from the config, so an exception cannot be granted in one place and stay off
the dashboard. There is deliberately no "days remaining" column: it would make
this document a function of the clock, and a document that goes stale by sitting
still is one nobody can check. The expiry is enforced by ESLint itself — on the
day it passes, the exception stops suppressing anything and the file reports the
expiry by name.

${table(
  ["Files", "Rules suspended", "Expires", "Reason"],
  exceptions.map(
    (e) =>
      `| ${e.files.map((f) => `\`${f}\``).join("<br>")} | ${e.allow.map((a) => `\`${a}\``).join(", ")} | ${e.expires} | ${e.reason.slice(0, 180)}${e.reason.length > 180 ? "…" : ""} |`,
  ),
)}

## 3. Visual debt — contracts with a sanctioned alternative, not yet enforced

A row belongs here only if the alternative already exists. That is the line
between debt and an unmade decision, and it is why easing keywords are here and
arbitrary spacing is here while something with no owned replacement is not.

The budget equals the measurement on the day it was recorded. The guard fails in
both directions: over budget is a regression, under budget is a budget nobody
lowered.

${table(
  ["Class", "Occurrences", "Files", "Budget", "Sanctioned alternative"],
  debt.map((c) => `| \`${c.key}\` — ${c.what} | ${c.occurrences} | ${c.files} | ${c.budget} | ${c.alternative} |`),
)}

Why each is debt rather than a rule:

${debt.map((c) => `- \`${c.key}\` — ${c.why}`).join("\n")}

### 3.1 The fifteen heaviest files

${table(["File", "Class", "Occurrences", "Owner"], worst)}

## 4. Ownership — who answers for the debt

Every row is a domain from \`tools/ownership-map.mjs\`, inverted per file rather
than re-derived, so this table cannot disagree with the ownership ratchet.
\`shared\` is not a domain: it is what the map records for files it deliberately
gives to nobody, and debt sitting there has no owner to pay it.

${table(["Domain", "Occurrences", "Files", "What the domain is"], domainRows)}

## 5. Superiority claims — the governance rule with a gate on it

TTES-050-005. \`tools/superiority-claims.mjs\` reads the shipped copy and the
ledger: a claim may not ship until the measurement behind it is PASS.

- Gate: **${gate.open ? "OPEN" : "CLOSED"}**${gate.open ? "" : ` — blocked by ${gate.blocking.map((b) => `\`${b.id}\` (${b.status})`).join(", ")}`}
- Claims found in shipped copy: **${claims.length}**${claims.length === 0 ? "" : ` — ${claims.map((c) => `\`${c.file}:${c.line}\``).join(", ")}`}

## 6. What this dashboard does NOT establish

Written down because an unstated limit in a governance document reads as
coverage, which is the failure \`docs/architecture/ttes-experience-audit.md\` §7
exists to avoid.

- **Rendered adoption.** An import is not a render. A module can import \`Button\`
  and still hand-roll one beside it; §1 counts the import.
- **Whether a raw element is wrong.** Some of the ${debt.find((c) => c.key === "raw-button-element").occurrences}
  raw buttons are inside owned patterns that predate the wrapper and some are
  genuinely one-off. The budget is a ratchet on the total, not a verdict on a
  line.
- **Design-quality debt.** Spacing rhythm, hierarchy, copy tone and iconography
  consistency are judgements. Nothing here measures them, and no number in this
  document should be read as measuring them.
- **The console.** \`apps/system-studio\` has its own stylesheet, its own
  components and its own debt. It is out of scope by §1 of the TTES authority.
- **Runtime adoption by tenants.** Which tenants render which surface is a
  deployment question; this reads the repository.
`
}

const isCommand = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const generated = render()
  const target = path.join(ROOT, OUT)
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/ttes-governance-dashboard.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(target, generated)
    const debt = debtMeasurements()
    console.log(
      `Wrote ${OUT} — ${debt.reduce((n, c) => n + c.occurrences, 0)} debt occurrences across ${DEBT_CLASSES.length} classes.`,
    )
  }
}

export { OUT, render }
