#!/usr/bin/env node
/**
 * GE-143-001 — inventory every current UI stack, component library, CSS
 * strategy, font, icon set, table/grid, chart library, editor, calendar,
 * dialog, theme, breakpoint and copied component; and record the duplication,
 * accessibility debt, visual drift and migration risk that inventory exposes.
 *
 * Derived from the tree on every run, never written from memory. A hand-written
 * inventory of a front end is wrong the week after it is written, and the wrong
 * week is the one somebody uses it to plan a migration.
 *
 * ── What each section is measured from ──────────────────────────────────────
 *
 *   §2 CONCERNS.        The requirement's own list, one row each. A concern is
 *                       located by a DETECTOR — vendor packages declared in a
 *                       `package.json`, plus a probe run over every source file
 *                       — so a new implementation appears in the table without
 *                       anybody remembering to add it, and a deleted one stops
 *                       being claimed.
 *   §3 VENDOR STACK.    Every package a concern's detector names, with the
 *                       version range declared, in which app, and whether any
 *                       source file imports it. A dependency nothing imports is
 *                       a migration liability with no migration: it ships in
 *                       the lockfile, is audited, and buys nothing.
 *   §4 DUPLICATION.     Three kinds, kept apart because they cost differently:
 *                       a concern implemented separately in both applications;
 *                       a package declared and never imported; and pairs of
 *                       modules whose normalised token shingles overlap past
 *                       `NEAR_DUPLICATE`, which is the "copied component" the
 *                       requirement asks about.
 *   §5 ACCESSIBILITY.   Counted signals with citations, each one a shape a
 *                       reader with a keyboard or a screen reader loses on.
 *                       `new-tab-without-rel` and `autofocus-outside-a-modal`
 *                       are NOT here: they are measured by
 *                       `tools/ttes-experience-audit.mjs`, and two counters of
 *                       one thing is the duplication this document is about.
 *   §6 VISUAL DRIFT.    Values that bypass the token system — a literal colour,
 *                       an arbitrary length in a class, an inline style object.
 *                       Drift is not "ugly": it is the measure of how much of
 *                       the surface a token change does NOT reach.
 *   §7 MIGRATION RISK.  Per concern, from the two numbers that actually decide
 *                       it: how many implementations would have to be replaced,
 *                       and how many modules import them. The banding rule is
 *                       stated in the document rather than applied invisibly.
 *
 * ── Determinism ─────────────────────────────────────────────────────────────
 *
 * Output must be byte-identical on Linux and Windows. Directories are read then
 * sorted by Unicode code point (never `localeCompare`); paths are joined with
 * `/` and compared as POSIX strings; every file is read utf8 and CRLF-normalised
 * before it is counted or scanned. Nothing shells out to git.
 *
 * Usage:  node tools/tes-ui-stack-inventory.mjs [--check]
 *   --check  exit non-zero if the committed document is out of date
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")
export const OUT = "docs/architecture/tes-ui-stack-inventory.md"

/** The two applications with a user interface, and where each keeps its source. */
export const APPS = [
  { id: "web", label: "Tenant experience", dir: "apps/web", src: "apps/web/src" },
  { id: "studio", label: "Operator plane", dir: "apps/system-studio", src: "apps/system-studio/src" },
]

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo", "coverage", ".cache", "generated"])

/** Similarity at which two modules are reported as one copied from the other. */
export const NEAR_DUPLICATE = 0.7

/* ------------------------------------------------------------------ reading */

export function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n")
}

/** Every source file under a directory, POSIX-relative to ROOT, sorted. */
export function sourceFiles(relativeDir) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(rel)
      } else if (/\.(tsx?|css)$/.test(entry.name)) {
        out.push(rel)
      }
    }
  }
  walk(relativeDir)
  return out
}

/** A source file that ships: not a test, not a spec fixture. */
export function ships(file) {
  return !/\.(test|itest|spec)\.tsx?$/.test(file)
}

/* --------------------------------------------------------------- detectors */

/**
 * The fourteen concerns GE-143-001 names, in the requirement's own order.
 *
 * `packages` is matched against declared dependency names. `probe(file, text)`
 * decides whether a source file IMPLEMENTS the concern — implements, not uses:
 * a page that renders `<DataTable>` is a call site, the module that defines it
 * is the implementation, and conflating the two is how an inventory reports
 * forty table libraries.
 */
export const CONCERNS = [
  {
    id: "ui-stack",
    label: "UI stack",
    packages: ["next", "react", "react-dom"],
    probe: (f, t) => /\/app\/layout\.tsx$/.test(f) && /<html/.test(t),
    note: "The framework and its root document. One per application by construction.",
  },
  {
    id: "component-library",
    label: "Component library",
    packages: ["react-aria-components", "class-variance-authority", "@radix-ui/react-dialog", "@mui/material", "@chakra-ui/react"],
    // By USE, not by folder. `apps/web` keeps its primitives in `components/ui`
    // and `apps/system-studio` keeps them in `components/md3`, and a probe naming
    // either directory would have reported the other application as having no
    // component library at all — the exact false ABSENT this inventory exists to
    // avoid. A shared primitive is a component three or more modules import.
    probe: (f, t, ctx) =>
      /\/components\/.*[A-Z][A-Za-z]*\.tsx$/.test(f) &&
      /export (function|const) [A-Z]/.test(t) &&
      (ctx.importers.get(f) ?? 0) >= 3,
    note: "Owned wrappers over a behaviour library, counted by use: a component three or more modules import. GE-143-002 asks for ONE library, consumed by every surface.",
  },
  {
    id: "css-strategy",
    label: "CSS strategy",
    packages: ["tailwindcss", "postcss", "autoprefixer", "styled-components", "@emotion/react", "sass"],
    probe: (f, t) => /\.css$/.test(f) && /@layer|:root/.test(t),
    note: "A global token stylesheet plus utility classes. Every additional strategy is a second place a colour can be decided.",
  },
  {
    id: "font",
    label: "Font",
    packages: ["next/font", "@fontsource/inter"],
    probe: (f, t) => /\.css$/.test(f) && /(--font-[a-z-]+|font-family)\s*:/.test(t),
    note: "Families are declared in CSS so no build step fetches a remote file. A stylesheet that names a family is a place a font decision lives.",
  },
  {
    id: "icon-set",
    label: "Icon set",
    packages: ["@phosphor-icons/react", "lucide-react", "react-icons", "@heroicons/react"],
    probe: (f, t) => /\/components\/ui\/icons\.tsx$/.test(f) || (/\.tsx$/.test(f) && /<svg/.test(t) && !/\/charts\//.test(f)),
    note: "One barrel aliasing one family, plus every module that draws its own glyph inline.",
  },
  {
    id: "table-grid",
    label: "Table / grid",
    packages: ["@tanstack/react-table", "ag-grid-react", "react-data-grid"],
    probe: (f, t) => /\.tsx$/.test(f) && /<table[\s>]/.test(t),
    note: "GE-143-023 asks for an owned virtualized grid contract. Every module that writes its own <table> is a surface that contract does not cover.",
  },
  {
    id: "chart-library",
    label: "Chart library",
    packages: ["recharts", "chart.js", "d3", "victory", "nivo"],
    probe: (f, t) => /\.tsx$/.test(f) && /<svg/.test(t) && /(chart|spark|graph|meter|gauge|legend|tooltip)/i.test(f.split("/").pop()),
    note: "Owned SVG marks, no vendor chart engine. GE-143-027 is the decision to select one.",
  },
  {
    id: "editor",
    label: "Editor",
    packages: ["@tiptap/react", "slate", "quill", "@lexical/react"],
    probe: (f, t) => /Editor\.tsx$/.test(f) || (/\.tsx$/.test(f) && /contentEditable/.test(t)),
    note: "Structured editing surfaces. A plain `<textarea>` is not one — it is a surface with NO editor module behind it, which is counted separately below because it is the same migration question asked from the other end.",
  },
  {
    id: "calendar",
    label: "Calendar",
    packages: ["@fullcalendar/react", "react-big-calendar", "rrule"],
    probe: (f) => /\/(components|lib)\/[A-Za-z/]*[Cc]alendar[A-Za-z]*\.tsx?$/.test(f),
    note: "Owned grid, recurrence and conflict code rather than a calendar package.",
  },
  {
    id: "dialog",
    label: "Dialog",
    packages: ["@radix-ui/react-dialog", "react-modal"],
    probe: (f, t) => /\.tsx$/.test(f) && (/role="dialog"/.test(t) || /<Modal\b/.test(t) || /\bDialogTrigger\b/.test(t)),
    note: "GE-143-008 owns the layering; this row is about how many things open one.",
  },
  {
    id: "theme",
    label: "Theme",
    packages: ["next-themes"],
    probe: (f, t) => /\.css$/.test(f) && /(html\.dark|\[data-theme|prefers-color-scheme)/.test(t),
    note: "Theme scopes are CSS, resolved before first paint by the root layout's script.",
  },
  {
    id: "breakpoint",
    label: "Breakpoint",
    packages: [],
    probe: (f, t) => /\.css$/.test(f) && /@media[^{]*\((min|max)-width/.test(t),
    note: "Widths at which the layout changes. Two stylesheets with different widths is a drift nobody sees until a screenshot.",
  },
]

/* ------------------------------------------------------------- measurement */

/** Dependencies declared by an app, name → range, sorted by name. */
export function declaredPackages(app) {
  const manifest = JSON.parse(read(`${app.dir}/package.json`))
  const all = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) }
  return Object.fromEntries(Object.entries(all).sort((a, b) => (a[0] < b[0] ? -1 : 1)))
}

/** Runtime dependencies only — the ones a module is expected to import. */
export function runtimeDependencies(app) {
  const manifest = JSON.parse(read(`${app.dir}/package.json`))
  return new Set(Object.keys(manifest.dependencies ?? {}))
}

/** Whether any shipping source file in an app imports a package. */
export function importsPackage(files, texts, name) {
  const rx = new RegExp(`from ["']${name.replace(/[/@.]/g, "\\$&")}(["'/])`)
  return files.filter((f) => ships(f) && rx.test(texts.get(f) ?? "")).length
}

/** Every module specifier a file imports, by basename. Side-effect imports included. */
export function importedBasenames(text) {
  const out = []
  for (const m of text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) out.push(m[1].split("/").pop())
  return out
}

/**
 * How many shipping modules import each file, keyed by the file.
 *
 * Basename matching, which is what an alias import (`@/components/ui/Button`)
 * and a relative one (`./Button`) have in common. A basename shared by two
 * modules over-counts both, and that is the safe direction for a number used to
 * decide "is this a shared primitive": it can only make a rarely-used component
 * look popular, never hide a popular one.
 */
export function importerCounts(files, texts) {
  const byBase = new Map()
  for (const file of files) {
    const base = file.split("/").pop().replace(/\.tsx?$/, "")
    if (!byBase.has(base)) byBase.set(base, [])
    byBase.get(base).push(file)
  }
  const counts = new Map(files.map((f) => [f, 0]))
  for (const file of files) {
    if (!ships(file)) continue
    for (const base of new Set(importedBasenames(texts.get(file) ?? ""))) {
      for (const target of byBase.get(base.replace(/\.tsx?$/, "")) ?? []) {
        if (target !== file) counts.set(target, (counts.get(target) ?? 0) + 1)
      }
    }
  }
  return counts
}

/**
 * Every module that imports one of a concern's implementations.
 *
 * Import specifiers are matched on the module's basename, which is what an
 * alias import (`@/components/ui/DataTable`) and a relative one (`./DataTable`)
 * have in common. A file never counts as its own call site.
 */
export function callSites(implementations, files, texts) {
  const names = new Set(implementations.map((f) => f.split("/").pop().replace(/\.tsx?$/, "")))
  if (names.size === 0) return []
  const out = []
  for (const file of files) {
    if (!ships(file) || implementations.includes(file)) continue
    for (const base of importedBasenames(texts.get(file) ?? "")) {
      if (names.has(base) || names.has(base.replace(/\.tsx?$/, ""))) {
        out.push(file)
        break
      }
    }
  }
  return out
}

/* ------------------------------------------------- accessibility and drift */

/** One accessibility signal: what it is, and how a file is found to have it. */
export const A11Y_SIGNALS = [
  {
    id: "icon-only-control-without-a-name",
    why: "a control whose whole label is a glyph is announced as 'button' and nothing else",
    find: (text) =>
      [...text.matchAll(/<(button|a)\b([^>]*)>\s*(<(?:svg|[A-Z][A-Za-z0-9]*)[^>]*\/>)\s*<\/\1>/g)]
        .filter((m) => !/aria-label|aria-labelledby|title=/.test(m[2]))
        .map((m) => m[0].replace(/\s+/g, " ").slice(0, 90)),
  },
  {
    id: "image-without-alt-text",
    why: "an image with no alt attribute is either decorative or unreadable, and the markup does not say which",
    find: (text) =>
      [...text.matchAll(/<img\b[^>]*>/g)].filter((m) => !/\balt=/.test(m[0])).map((m) => m[0].slice(0, 90)),
  },
  {
    id: "positive-tabindex",
    why: "a positive tabindex re-orders the whole document's focus sequence, not just this control's",
    find: (text) => [...text.matchAll(/tabIndex=\{?["']?[1-9]/g)].map((m) => m[0]),
  },
  {
    id: "click-handler-on-a-non-interactive-element",
    why: "a div that responds to a mouse does not respond to a keyboard unless it is given a role and a tab stop",
    find: (text) =>
      [...text.matchAll(/<(div|span|li|td|tr)\b([^>]*\bonClick=[^>]*)>/g)]
        .filter((m) => !/role=/.test(m[2]) || !/tabIndex/.test(m[2]))
        .map((m) => m[0].replace(/\s+/g, " ").slice(0, 90)),
  },
]

/** One visual-drift signal: a value decided outside the token system. */
export const DRIFT_SIGNALS = [
  {
    id: "literal-colour",
    why: "a colour a theme change cannot reach",
    find: (text) =>
      [...text.matchAll(/#[0-9a-fA-F]{6}\b|rgba?\(\s*\d+\s*,/g)].map((m) => m[0]),
  },
  {
    id: "arbitrary-length-in-a-class",
    why: "a size chosen beside the scale rather than from it",
    find: (text) => [...text.matchAll(/\b[a-z-]+-\[\d+(?:\.\d+)?(px|rem|em|vh|vw)\]/g)].map((m) => m[0]),
  },
  {
    id: "inline-style-object",
    why: "a declaration no stylesheet, audit or theme can see",
    find: (text) => [...text.matchAll(/style=\{\{/g)].map((m) => m[0]),
  },
]

/* -------------------------------------------------------- copied components */

/** Identifier and JSX-tag tokens, lower-cased, comments and strings removed. */
export function shingles(text) {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, " ")
  const tokens = [...code.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)].map((m) => m[0].toLowerCase())
  const out = new Set()
  for (let i = 0; i + 4 < tokens.length; i++) out.add(tokens.slice(i, i + 5).join(" "))
  return out
}

export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const s of a) if (b.has(s)) shared++
  return shared / (a.size + b.size - shared)
}

/**
 * Pairs of modules similar enough that one was plausibly copied from the other.
 *
 * Compared over five-token shingles of identifiers, so formatting, comments and
 * copy do not count as similarity and a renamed component still matches. Only
 * `.tsx` under a components directory is compared: two route pages sharing a
 * layout are a template, not a copy.
 */
export function copiedComponents(files, texts) {
  const candidates = files.filter((f) => ships(f) && /\/components\/.*\.tsx$/.test(f))
  const sets = new Map(candidates.map((f) => [f, shingles(texts.get(f) ?? "")]))
  const pairs = []
  let closest = null
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const similarity = jaccard(sets.get(candidates[i]), sets.get(candidates[j]))
      const pair = { a: candidates[i], b: candidates[j], similarity: Math.round(similarity * 100) }
      if (similarity >= NEAR_DUPLICATE) pairs.push(pair)
      // The closest pair is reported even when nothing crosses the threshold, so
      // "none found" can be checked rather than taken on trust: a broken
      // comparator reports 0% for the closest pair as well as for every other.
      if (!closest || similarity > closest.similarity / 100) closest = pair
    }
  }
  return { pairs: pairs.sort((x, y) => y.similarity - x.similarity || (x.a < y.a ? -1 : 1)), closest }
}

/* ------------------------------------------------------------ risk banding */

/**
 * Migration risk from the two numbers that decide it.
 *
 * Stated as a rule rather than a judgement so the same inputs always produce
 * the same band, and so a reader can disagree with the rule rather than with
 * the row.
 */
export function riskBand(implementations, sites) {
  if (implementations === 0) return "NONE — nothing to migrate"
  if (implementations === 1 && sites <= 20) return "LOW — one module, contained blast radius"
  if (implementations === 1) return "MEDIUM — one module, but every consumer moves with it"
  if (implementations <= 5) return "MEDIUM — a handful of implementations to reconcile first"
  return "HIGH — the concern is spread across the tree, so migration is a survey before it is a change"
}

/* ---------------------------------------------------------------- collect */

export function collect() {
  const apps = APPS.map((app) => {
    const files = sourceFiles(app.src)
    const texts = new Map(files.map((f) => [f, read(f)]))
    const packages = declaredPackages(app)
    const ctx = { importers: importerCounts(files, texts) }

    const concerns = CONCERNS.map((concern) => {
      const implementations = files.filter((f) => ships(f) && concern.probe(f, texts.get(f) ?? "", ctx))
      const vendors = concern.packages
        .filter((name) => name in packages)
        .map((name) => ({ name, range: packages[name], importedBy: importsPackage(files, texts, name) }))
      const sites = callSites(implementations, files, texts)
      return { id: concern.id, implementations, vendors, callSites: sites.length }
    })

    const a11y = A11Y_SIGNALS.map((signal) => {
      const hits = []
      for (const file of files) {
        if (!ships(file) || !/\.tsx$/.test(file)) continue
        for (const example of signal.find(texts.get(file) ?? "")) hits.push({ file, example })
      }
      return { id: signal.id, count: hits.length, files: [...new Set(hits.map((h) => h.file))], first: hits[0] ?? null }
    })

    const drift = DRIFT_SIGNALS.map((signal) => {
      const hits = []
      for (const file of files) {
        if (!ships(file) || !/\.tsx?$/.test(file)) continue
        for (const example of signal.find(texts.get(file) ?? "")) hits.push({ file, example })
      }
      return { id: signal.id, count: hits.length, files: [...new Set(hits.map((h) => h.file))], first: hits[0] ?? null }
    })

    // Runtime dependencies only. `tailwindcss`, `postcss` and `autoprefixer` are
    // build tools: no module imports them and none should, so reporting them as
    // unused would be a finding that is false in exactly the same way every time.
    const runtime = runtimeDependencies(app)
    const unimported = Object.entries(packages)
      .filter(([name]) => runtime.has(name) && CONCERNS.some((c) => c.packages.includes(name)))
      .filter(([name]) => importsPackage(files, texts, name) === 0)
      .map(([name, range]) => ({ name, range }))

    return {
      id: app.id,
      label: app.label,
      dir: app.dir,
      fileCount: files.filter(ships).length,
      // The editor question from the other end: surfaces where authored text is
      // typed into a bare control, with no editor module behind them at all.
      rawTextareas: files.filter((f) => ships(f) && /\.tsx$/.test(f) && /<textarea/.test(texts.get(f) ?? "")),
      concerns,
      a11y,
      drift,
      unimported,
      copied: copiedComponents(files, texts),
    }
  })

  return { apps }
}

/* ----------------------------------------------------------------- render */

const bar = (n) => (n === 0 ? "—" : String(n))

/** An example safe inside a markdown table cell and a code span. */
const clean = (text) => text.replace(/\|/g, "\|").replace(/`/g, "'")

function concernRows(app) {
  return CONCERNS.map((concern) => {
    const found = app.concerns.find((c) => c.id === concern.id)
    const vendor = found.vendors.length
      ? found.vendors.map((v) => `\`${v.name}\` ${v.range}`).join(", ")
      : "none — owned"
    return `| ${concern.label} | ${bar(found.implementations.length)} | ${vendor} | ${bar(found.callSites)} | ${riskBand(found.implementations.length, found.callSites)} |`
  })
}

export function render(data) {
  const out = []
  out.push("# TES foundation inventory — the UI stack as it exists")
  out.push("")
  out.push("<!-- Generated by tools/tes-ui-stack-inventory.mjs. Do not edit by hand. -->")
  out.push("")
  out.push("## 1. What this is, and what it is not")
  out.push("")
  out.push(
    "GE-143-001 asks for an inventory of every current UI stack, component library, CSS strategy,",
    "font, icon set, table/grid, chart library, editor, calendar, dialog, theme, breakpoint and",
    "copied component, and for the duplication, accessibility debt, visual drift and migration risk",
    "that inventory exposes. This document is that inventory, derived from the checkout on the commit",
    "it was generated on.",
  )
  out.push("")
  out.push(
    "It is a measurement of SOURCE. It does not open a browser, so it cannot tell you that a control",
    "is hard to hit or that a contrast pair fails in practice — `apps/web/src/lib/a11y/contrast.test.ts`",
    "computes the second and §8 names the rest. Both applications with a user interface are scanned;",
    "reading a number here as a statement about only the tenant product would be wrong, which is why",
    "every table is per application.",
  )
  out.push("")
  for (const app of data.apps) {
    out.push(`* **${app.label}** — \`${app.dir}\`, ${app.fileCount} shipping source files scanned.`)
  }
  out.push("")

  out.push("## 2. The concerns the requirement names")
  out.push("")
  out.push(
    "**Implementations** are modules that DEFINE the concern; **call sites** are modules that import",
    "one. A page rendering a table is a call site of the table it imports and an implementation only",
    "if it writes its own — which several do, and that is the finding rather than an accident of",
    "counting.",
  )
  out.push("")
  for (const app of data.apps) {
    out.push(`### ${app.label} (\`${app.dir}\`)`)
    out.push("")
    out.push("| Concern | Implementations | Vendor packages | Call sites | Migration risk |")
    out.push("| --- | --- | --- | --- | --- |")
    out.push(...concernRows(app))
    out.push("")
  }
  out.push("Where each concern is implemented, in full:")
  out.push("")
  for (const app of data.apps) {
    for (const concern of CONCERNS) {
      const found = app.concerns.find((c) => c.id === concern.id)
      if (found.implementations.length === 0) continue
      out.push(
        `* **${app.id} / ${concern.label}** — ${found.implementations.map((f) => `\`${f}\``).join(", ")}`,
      )
    }
  }
  out.push("")
  for (const app of data.apps) {
    out.push(
      `* **${app.label}** renders a bare \`<textarea>\` in ${app.rawTextareas.length} module${app.rawTextareas.length === 1 ? "" : "s"}` +
        `${app.rawTextareas.length ? `: ${app.rawTextareas.map((f) => `\`${f}\``).join(", ")}` : ""}.`,
    )
  }
  out.push("")
  for (const concern of CONCERNS) {
    out.push(`* **${concern.label}.** ${concern.note}`)
  }
  out.push("")

  out.push("## 3. The vendor stack")
  out.push("")
  out.push(
    "Every package a concern's detector names that the application actually declares, with the range",
    "declared and the number of shipping modules that import it.",
  )
  out.push("")
  out.push("| App | Package | Declared | Concern | Importing modules |")
  out.push("| --- | --- | --- | --- | --- |")
  for (const app of data.apps) {
    for (const concern of CONCERNS) {
      const found = app.concerns.find((c) => c.id === concern.id)
      for (const vendor of found.vendors) {
        out.push(
          `| ${app.id} | \`${vendor.name}\` | ${vendor.range} | ${concern.label} | ${bar(vendor.importedBy)} |`,
        )
      }
    }
  }
  out.push("")

  out.push("## 4. Duplication")
  out.push("")
  out.push("### 4.1 Concerns implemented separately in both applications")
  out.push("")
  out.push(
    "This is the structural duplication GE-143-002 exists to end: there is no shared, versioned TES",
    "package, so each application carries its own answer to the same question. The count is the number",
    "of modules on each side, not a similarity claim — §4.3 is where similarity is measured.",
  )
  out.push("")
  out.push("| Concern | Tenant experience | Operator plane |")
  out.push("| --- | --- | --- |")
  for (const concern of CONCERNS) {
    const counts = data.apps.map((a) => a.concerns.find((c) => c.id === concern.id).implementations.length)
    if (counts.every((n) => n > 0)) out.push(`| ${concern.label} | ${counts[0]} | ${counts[1]} |`)
  }
  out.push("")
  out.push("### 4.2 Declared and never imported")
  out.push("")
  const anyUnimported = data.apps.some((a) => a.unimported.length > 0)
  if (anyUnimported) {
    out.push("| App | Package | Declared |")
    out.push("| --- | --- | --- |")
    for (const app of data.apps) {
      for (const p of app.unimported) out.push(`| ${app.id} | \`${p.name}\` | ${p.range} |`)
    }
    out.push("")
    out.push(
      "A UI dependency nothing imports is the cheapest duplication to remove and the easiest to miss:",
      "it is installed, audited, resolved and shipped in the lockfile, and no surface uses it.",
    )
  } else {
    out.push("None. Every UI package either application declares is imported by at least one module.")
  }
  out.push("")
  out.push("### 4.3 Copied components")
  out.push("")
  out.push(
    `Pairs of modules under a \`components/\` directory whose five-token identifier shingles overlap by`,
    `at least ${Math.round(NEAR_DUPLICATE * 100)}%. Formatting, comments and copy are stripped first, so`,
    "this measures structure rather than prose.",
  )
  out.push("")
  const copied = data.apps.flatMap((a) => a.copied.pairs.map((p) => ({ ...p, app: a.id })))
  if (copied.length === 0) {
    out.push(
      "None above the threshold. That is a real result and a narrow one: it says no two components in",
      "one application are near-identical, not that no logic is duplicated. The closest pair in each",
      "application is named so the answer can be checked rather than trusted:",
    )
    out.push("")
    for (const app of data.apps) {
      const closest = app.copied.closest
      out.push(
        closest
          ? `* **${app.label}** — closest pair ${closest.similarity}%: \`${closest.a}\` and \`${closest.b}\`.`
          : `* **${app.label}** — fewer than two components to compare.`,
      )
    }
  } else {
    out.push("| App | Similarity | Module | Module |")
    out.push("| --- | --- | --- | --- |")
    for (const p of copied) out.push(`| ${p.app} | ${p.similarity}% | \`${p.a}\` | \`${p.b}\` |`)
  }
  out.push("")

  out.push("## 5. Accessibility debt")
  out.push("")
  out.push(
    "Counted from the markup, with the first example of each so the number can be checked rather than",
    "believed. These are shapes, not verdicts: a `div` with an `onClick` MAY be reachable another way.",
    "A signal with a count of zero is stated, because a scan that only prints what it found cannot be",
    "told apart from a scan that found nothing.",
  )
  out.push("")
  out.push("| App | Signal | Occurrences | Files | First example |")
  out.push("| --- | --- | --- | --- | --- |")
  for (const app of data.apps) {
    for (const signal of app.a11y) {
      const example = signal.first ? "`" + clean(signal.first.example) + "`" : "—"
      out.push(`| ${app.id} | ${signal.id} | ${bar(signal.count)} | ${bar(signal.files.length)} | ${example} |`)
    }
  }
  out.push("")
  for (const signal of A11Y_SIGNALS) out.push(`* **${signal.id}** — ${signal.why}.`)
  out.push("")

  out.push("## 6. Visual drift")
  out.push("")
  out.push(
    "Values decided outside the token system. Drift is not an aesthetic judgement: it is the measure",
    "of how much of the surface a token change does not reach.",
  )
  out.push("")
  out.push("| App | Signal | Occurrences | Files | First example |")
  out.push("| --- | --- | --- | --- | --- |")
  for (const app of data.apps) {
    for (const signal of app.drift) {
      const example = signal.first ? "`" + clean(signal.first.example) + "`" : "—"
      out.push(`| ${app.id} | ${signal.id} | ${bar(signal.count)} | ${bar(signal.files.length)} | ${example} |`)
    }
  }
  out.push("")
  for (const signal of DRIFT_SIGNALS) out.push(`* **${signal.id}** — ${signal.why}.`)
  out.push("")

  out.push("## 7. Migration risk")
  out.push("")
  out.push("The band in §2 comes from this rule and nothing else:")
  out.push("")
  out.push("* **NONE** — no implementation found.")
  out.push("* **LOW** — one implementation, twenty or fewer call sites.")
  out.push("* **MEDIUM** — one implementation with more than twenty call sites, or up to five implementations.")
  out.push("* **HIGH** — more than five implementations: the concern is spread, so migrating it is a survey first.")
  out.push("")
  out.push(
    "The rule is deliberately crude. A band is an ordering of where to look, and a formula nobody can",
    "recompute in their head is a judgement wearing arithmetic's clothes.",
  )
  out.push("")

  out.push("## 8. What this inventory does NOT establish")
  out.push("")
  out.push(
    "* **That a surface is accessible.** §5 counts markup shapes. Screen-reader behaviour, focus order",
    "  and live-region correctness are not derivable from source and are not claimed.",
    "* **That a token is used correctly.** §6 counts values that bypass the system; it says nothing",
    "  about whether the tokens that ARE used are the right ones.",
    "* **That two applications' components behave alike.** §4.1 counts implementations of a concern on",
    "  each side. Two dialogs are two dialogs whether or not they agree.",
    "* **Anything about a running deployment.** Nothing here opens a browser or reaches a URL.",
  )
  out.push("")
  return out.join("\n")
}

/* ------------------------------------------------------------------ command */

const isCommand = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const generated = render(collect())
  const abs = path.join(ROOT, OUT)
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : ""
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/tes-ui-stack-inventory.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(abs, generated)
    console.log(`Wrote ${OUT} (${generated.split("\n").length} lines)`)
  }
}
