#!/usr/bin/env node
/**
 * TTES-000-004 — audit the tenant product across personas, themes, viewports
 * and accessibility.
 *
 * The requirement says "current deployed tenant product", and the honest reading
 * of that phrase in this repository is narrower than it sounds. There are two
 * deployments: `Tenurework/Tenure`, which serves the live pilot and which
 * nothing here may touch, and this monorepo's own nonproduction stack. An audit
 * that claimed to have measured either would be a claim about a running system,
 * and this tool measures a checkout. So it says so, in the document, in §1 —
 * every row below is derived from `apps/web` at the commit it was generated on,
 * and the things that genuinely require a browser (computed contrast at a real
 * viewport, focus order under a screen reader, reflow at 400% zoom) are named in
 * §7 as NOT established rather than quietly folded into a passing table.
 *
 * The audit covers the TENANT experience only. `apps/system-studio` is the
 * deployer experience and is a different audience with different personas;
 * TTES-000-001 separated the two inventories precisely so that a claim about one
 * could not be read as a claim about both, and merging them back here would undo
 * that.
 *
 * ── Why a generator instead of a written audit ──────────────────────────────
 *
 * A written audit is a photograph of a tree that changed the same afternoon. Its
 * failure mode is not "wrong" but "was right once", which reads identically. So
 * every table here is derived, `--check` fails when the committed document has
 * drifted, and `tests/architecture/ttes-experience-audit.test.mjs` runs that
 * check plus floors under each section — because a staleness check alone passes
 * when the extractor breaks and compares an empty document against an empty one.
 *
 * Determinism: directories are read in sorted order, every path is compared and
 * printed POSIX-normalised, every file is read with CRLF collapsed before it is
 * scanned or measured, and nothing is stamped with a date, a host or a git
 * revision. The output must be byte-identical on Linux and on Windows or the
 * committed copy is "current here, stale in CI".
 *
 * Usage:  node tools/ttes-experience-audit.mjs [--check]
 *   --check  exit non-zero if the committed document is out of date
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { declarationsIn } from '../apps/web/src/lib/a11y/css-declarations.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = 'docs/architecture/ttes-experience-audit.md'

/** The tenant experience, and only it. See the header. */
const APP = 'apps/web'
const SRC = `${APP}/src`
const GLOBALS = `${APP}/src/app/globals.css`
const SCHEMA = `${APP}/prisma/schema.prisma`

/* ── Reading the tree ─────────────────────────────────────────────────────── */

const posix = (p) => p.split(path.sep).join('/')

/** File contents with CRLF collapsed. Every measurement below counts lines. */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
}

/**
 * Every file under `rel`, POSIX-relative to the repository root, sorted.
 *
 * `readdirSync` returns directory order, which is the filesystem's business and
 * differs between NTFS and ext4. Sorting the names before recursing and sorting
 * the result again makes the walk order a property of the names alone.
 */
function walk(rel, out = []) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return out
  const entries = fs.readdirSync(abs, { withFileTypes: true })
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of entries) {
    const child = `${rel}/${e.name}`
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue
      walk(child, out)
    } else out.push(child)
  }
  return out.sort()
}

const isTest = (f) => /\.(test|spec)\.[jt]sx?$/.test(f)

/**
 * Comments removed, so a sentence about a token is not counted as a use of it.
 *
 * This is not cosmetic. The first run of the undeclared-token check below
 * reported `--z-`, `--other`, `--x` and `--chart-N` as referenced-but-undeclared:
 * every one came from a prose comment in `globals.css` or from a test's
 * explanatory text. A checker whose first four findings are its own false
 * positives is a checker people learn to scroll past.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1')
}

/* ── §2 Personas ──────────────────────────────────────────────────────────── */

/**
 * The persona vocabulary, read out of the schema rather than listed here.
 *
 * A persona in this product is not one field. It is the intersection of the
 * institution role a person holds, the scope of the club seat they sit in, and
 * whether that seat is incoming, current or past — `SHADOW` is a persona, not a
 * status flag, because it is the one that can read a club it cannot yet change.
 * The three enums are therefore read together and the audit reports each value.
 */
const PERSONA_ENUMS = ['InstitutionRole', 'RoleScope', 'AssignmentStatus']

export function personaValues(schema) {
  const out = []
  const lines = schema.split('\n')
  for (const name of PERSONA_ENUMS) {
    const start = lines.findIndex((l) => new RegExp(`^enum ${name} \\{`).test(l))
    if (start === -1) continue
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\}/.test(lines[i])) break
      const m = /^\s{2}([A-Z][A-Z_0-9]*)\b/.exec(lines[i])
      if (m) out.push({ enumName: name, value: m[1], line: i + 1 })
    }
  }
  return out
}

/**
 * The tenant source files that name a persona value, excluding tests.
 *
 * Tests are excluded deliberately: a persona that only a test mentions is a
 * persona the product does not distinguish, and counting the test would hide
 * exactly the finding this column exists to surface.
 */
function personaReferences(files, values) {
  const bodies = files
    .filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f))
    .map((f) => ({ file: f, text: stripComments(read(f)) }))
  return values.map((p) => {
    const hits = bodies.filter((b) => new RegExp(`\\b${p.value}\\b`).test(b.text)).map((b) => b.file)
    return { ...p, files: hits.length, first: hits[0] ?? null }
  })
}

/* ── §3 Themes ────────────────────────────────────────────────────────────── */

/** `[start, end]` of the brace-balanced block opening at `open`. */
function extentOf(css, open) {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return [open, i]
  }
  return [open, css.length]
}

/**
 * Every rule in the stylesheet that declares at least one custom property,
 * with the media query it sits under and the line it opens on.
 *
 * "Theme" is not a word the stylesheet uses, so it is not a word this reads for.
 * A theme here is a scope that redefines tokens: `html.dark`, the
 * `prefers-contrast: more` overrides, `:root[data-density="compact"]`, and the
 * two viewport-conditional `:root` blocks. Reading the SHAPE rather than a list
 * of names is what makes a new theme appear in this table without anyone
 * remembering to add it — and what makes the ACTIVATION map below able to fail.
 */
export function tokenScopes(css) {
  const media = [...css.matchAll(/@media([^{]*)\{/g)].map((m) => {
    const open = css.indexOf('{', m.index + m[0].length - 1)
    return { query: m[1].trim(), extent: extentOf(css, open) }
  })
  const queriesAt = (i) =>
    media.filter(({ extent: [s, e] }) => i > s && i < e).map((m) => m.query)

  const scopes = []
  for (const m of css.matchAll(/(^|\n)([^\n{}]+)\{/g)) {
    const selector = m[2].trim()
    if (selector.startsWith('@') || selector.startsWith('*')) continue
    const open = css.indexOf('{', m.index + m[0].length - 1)
    if (open === -1) continue
    const names = Object.keys(declarationsIn(css, open)).sort()
    if (names.length === 0) continue
    scopes.push({
      selector,
      media: queriesAt(open),
      line: css.slice(0, open).split('\n').length,
      names,
    })
  }
  return scopes
}

/** A scope's stable key: what it prints and what ACTIVATION is keyed on. */
const scopeKey = (s) => (s.media.length ? `${s.selector} @media ${s.media.join(' and ')}` : s.selector)

/**
 * How each token scope is entered, and by what.
 *
 * This is the one DECLARED table in the file, and it is declared because the
 * answer is not in the stylesheet: CSS says a scope exists, not who turns it on.
 * It is still checkable in both directions — the audit fails when a scope in the
 * stylesheet has no entry here, and each `caller` is a path plus a probe that
 * must still match that file. A theme nobody can enter and a caller that has
 * been deleted are the two failures, and neither can hide.
 */
const ACTIVATION = [
  {
    key: ':root',
    by: 'default',
    caller: null,
    probe: null,
    note: 'the base palette; in force whenever nothing else is',
  },
  {
    key: 'html.dark',
    by: 'user choice',
    caller: `${SRC}/components/ThemeSwitcher.tsx`,
    probe: /classList\.toggle\("dark"/,
    note: 'toggled on the document element and persisted',
  },
  {
    key: ':root[data-density="compact"]',
    by: 'user choice',
    caller: `${SRC}/components/DensitySwitcher.tsx`,
    probe: /setAttribute\("data-density"/,
    note: 'the density contract; inert until this writes the attribute',
  },
  {
    key: 'html.nav-collapsed',
    by: 'user choice',
    caller: `${SRC}/components/shell/NavDrawerToggle.tsx`,
    probe: /nav-collapsed/,
    note: 'rail width; a layout scope rather than a colour theme',
  },
  {
    key: ':root @media (max-width: 700px)',
    by: 'viewport',
    caller: null,
    probe: null,
    note: 'entered by the browser; see §4',
  },
  {
    key: 'html.nav-collapsed @media (max-width: 700px)',
    by: 'viewport',
    caller: `${SRC}/components/shell/NavDrawerToggle.tsx`,
    probe: /nav-collapsed/,
    note: 'the collapsed rail below the drawer breakpoint',
  },
  {
    key: ':root @media (prefers-contrast: more)',
    by: 'operating system',
    caller: null,
    probe: null,
    note: 'high contrast, light; no in-product switch exists',
  },
  {
    key: 'html.dark @media (prefers-contrast: more)',
    by: 'operating system + user choice',
    caller: `${SRC}/components/ThemeSwitcher.tsx`,
    probe: /classList\.toggle\("dark"/,
    note: 'high contrast, dark',
  },
  {
    key: ':root @media (max-width: 900px)',
    by: 'viewport',
    caller: null,
    probe: null,
    note: 'entered by the browser; see §4',
  },
]

/* ── §4 Viewports ─────────────────────────────────────────────────────────── */

const TAILWIND_PREFIXES = ['sm', 'md', 'lg', 'xl', '2xl']

/** Every width breakpoint the stylesheet actually conditions on. */
export function cssBreakpoints(css) {
  const out = new Map()
  for (const m of css.matchAll(/@media[^{]*\((min|max)-width:\s*(\d+)px\)/g)) {
    const key = `${m[1]}-width: ${m[2]}px`
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([q, uses]) => ({ q, uses }))
}

/**
 * Resolve one local import specifier to a file under `apps/web/src`.
 *
 * Only local ones. A package import leaves the tenant tree and cannot carry a
 * responsive class this audit could read, so following it would add work and no
 * answer.
 */
function resolveImport(fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = `${SRC}/${spec.slice(2)}`
  else if (spec.startsWith('.')) base = posix(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec)))
  else return null
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (fs.existsSync(path.join(ROOT, cand)) && fs.statSync(path.join(ROOT, cand)).isFile()) return cand
  }
  return null
}

/**
 * Every file a page renders through, transitively.
 *
 * Measuring responsiveness on the page file alone is the wrong measurement and
 * would have produced a headline finding that is simply false: a page whose
 * markup is three components deep carries no class of its own and would report
 * as fixed-width while rendering a fully responsive layout. So the closure is
 * walked, and a page counts as responsive if ANY file in it is.
 */
function closureOf(page, cache = new Map()) {
  const seen = new Set()
  const stack = [page]
  while (stack.length) {
    const file = stack.pop()
    if (seen.has(file)) continue
    seen.add(file)
    if (!cache.has(file)) {
      const text = stripComments(read(file))
      const specs = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1])
      cache.set(file, specs.map((s) => resolveImport(file, s)).filter(Boolean))
    }
    for (const dep of cache.get(file)) stack.push(dep)
  }
  return [...seen].sort()
}

const RESPONSIVE = new RegExp(`\\b(${TAILWIND_PREFIXES.join('|')}):`)

/**
 * Does anything in this closure emit markup at all?
 *
 * Asked because the first run of the fixed-width finding named three pages and
 * two of them were wrong: `app/page.tsx` and `orgs/[slug]/page.tsx` are four-
 * and ten-line `redirect()` stubs that render nothing. "Renders the same at
 * 320px as at 1440px" is true of them and meaningless, and a findings list whose
 * majority is meaningless is how a real finding gets ignored. A page that emits
 * no element is reported as `redirect only` and is not asked the question.
 */
const EMITS_MARKUP = /<[A-Za-z][\w.]*(\s|\/|>)/

/* ── §5 Accessibility ─────────────────────────────────────────────────────── */

/**
 * Static accessibility checks over the tenant tree.
 *
 * Every one of these is a defect a browser would also find; none of them is the
 * whole of accessibility, and §7 says which parts a static reader cannot reach
 * at all. Each check is written to be quiet when it is right — the cost of a
 * noisy accessibility check is that the real finding arrives in a list nobody
 * reads.
 */
const A11Y_CHECKS = [
  {
    id: 'img-without-alt',
    what: 'an `<img>` with no `alt` attribute',
    why: 'a screen reader announces the file name, or nothing',
    // The tag may span lines, so the body is taken up to the first `>` that is
    // not inside braces. `[\s\S]` rather than the dotAll flag: apps/web targets
    // ES2017 and this file is read by tools that share its lint rules.
    find(text) {
      const out = []
      for (const m of text.matchAll(/<img\b([\s\S]*?)\/?>/g)) {
        if (!/\balt\s*=/.test(m[1])) out.push(m[0].split('\n')[0].trim())
      }
      return out
    },
  },
  {
    id: 'positive-tabindex',
    what: 'a `tabIndex` greater than zero',
    why: 'it reorders the tab sequence away from the reading order for everyone',
    find: (text) => [...text.matchAll(/tabIndex=\{\s*[1-9]\d*\s*\}/g)].map((m) => m[0]),
  },
  {
    id: 'click-on-non-interactive',
    what: 'an `onClick` on a `div`/`span`/`li`/`td`/`tr` with no `role` and no `aria-hidden`',
    why: 'the keyboard cannot reach it and assistive technology is not told it acts',
    find(text) {
      const out = []
      for (const m of text.matchAll(/<(div|span|li|td|tr)\b([\s\S]*?)>/g)) {
        const attrs = m[2]
        if (!/\bonClick\s*=/.test(attrs)) continue
        if (/\brole\s*=/.test(attrs) || /\baria-hidden\b/.test(attrs)) continue
        out.push(m[0].split('\n')[0].trim())
      }
      return out
    },
  },
  {
    id: 'new-tab-without-rel',
    what: 'a `target="_blank"` with no `rel` on the same element',
    why: 'the opened page keeps a handle on the opener, and nothing announces that a new tab opened',
    find(text) {
      const out = []
      for (const m of text.matchAll(/<(a|Link)\b([\s\S]*?)>/g)) {
        if (!/target="_blank"/.test(m[2])) continue
        if (/\brel\s*=/.test(m[2])) continue
        out.push(`<${m[1]} target="_blank"> with no rel`)
      }
      return out
    },
  },
  {
    id: 'autofocus-outside-a-modal',
    what: 'an `autoFocus` in a file that renders no dialog',
    why: 'focus moves on load, before a screen-reader user has heard where they are (WCAG 3.2.1)',
    // Scoped, because the naive version was a false positive and this document
    // is worth less than nothing if its findings have to be triaged. Inside a
    // modal, moving focus in is REQUIRED, not a defect —
    // `components/ui/ConfirmDialog.tsx` autofocuses its confirmation input
    // inside an `<Overlay>` and is correct to. So a file that renders a dialog
    // is not asked the question.
    find(text) {
      if (/aria-modal|role="dialog"|<Overlay\b/.test(text)) return []
      return [...text.matchAll(/\bautoFocus\b/g)].map((m) => m[0])
    },
  },
]

/**
 * `var(--token)` references, split into declared and not.
 *
 * A reference with a fallback (`var(--x, 1000)`) is deliberately safe and is not
 * reported. A name that a TSX inline style sets — `Avatar.tsx` computes
 * `--avatar-bg` per person — is a declaration, so the declared set is the union
 * of what the stylesheet declares and what the tree assigns.
 */
export function tokenIntegrity(css, files) {
  const declared = new Set()
  for (const m of css.matchAll(/^\s*(--[\w-]+)\s*:\s*[^;]+;/gm)) declared.add(m[1])

  const referenced = new Map()
  for (const f of files) {
    if (!/\.(ts|tsx|css)$/.test(f) || isTest(f)) continue
    const text = stripComments(read(f))
    for (const m of text.matchAll(/"(--[\w-]+)"\s*:/g)) declared.add(m[1])
    for (const m of text.matchAll(/var\((--[\w-]+)\s*([,)])/g)) {
      if (m[2] === ',') continue // has a fallback; absence is by design
      if (!referenced.has(m[1])) referenced.set(m[1], [])
      referenced.get(m[1]).push(f)
    }
  }
  const undeclared = [...referenced.keys()].filter((n) => !declared.has(n)).sort()
  return { declared: declared.size, referenced: referenced.size, undeclared, referenced_at: referenced }
}

/* ── Collection ───────────────────────────────────────────────────────────── */

export function collect() {
  const files = walk(SRC)
  const css = read(GLOBALS)
  const schema = read(SCHEMA)

  const personas = personaReferences(files, personaValues(schema))

  const scopes = tokenScopes(css)
  const base = new Set(scopes.filter((s) => s.selector === ':root' && !s.media.length).flatMap((s) => s.names))
  const themes = scopes.map((s) => {
    const key = scopeKey(s)
    const activation = ACTIVATION.find((a) => a.key === key) ?? null
    return {
      key,
      line: s.line,
      declares: s.names.length,
      orphans: s.names.filter((n) => !base.has(n)),
      activation,
      callerLives:
        activation && activation.caller
          ? fs.existsSync(path.join(ROOT, activation.caller)) &&
            activation.probe.test(read(activation.caller))
          : null,
    }
  })

  const pages = files.filter((f) => /\/page\.tsx$/.test(f))
  const cache = new Map()
  const viewports = pages.map((p) => {
    const closure = closureOf(p, cache)
    const bodies = closure.map((f) => stripComments(read(f)))
    const responsiveIn = closure.filter((f, i) => RESPONSIVE.test(bodies[i]))
    return {
      page: p,
      closure: closure.length,
      renders: bodies.some((b) => EMITS_MARKUP.test(b)),
      responsive: responsiveIn.length > 0,
      via: responsiveIn[0] ?? null,
    }
  })

  const tsx = files.filter((f) => f.endsWith('.tsx') && !isTest(f))
  const a11y = A11Y_CHECKS.map((c) => {
    const hits = []
    for (const f of tsx) {
      for (const sample of c.find(stripComments(read(f)))) hits.push({ file: f, sample })
    }
    return { id: c.id, what: c.what, why: c.why, hits }
  })

  return {
    fileCount: files.length,
    personas,
    themes,
    baseTokens: base.size,
    breakpoints: cssBreakpoints(css),
    tailwind: TAILWIND_PREFIXES.map((p) => ({
      prefix: p,
      uses: tsx.reduce((n, f) => n + [...stripComments(read(f)).matchAll(new RegExp(`\\b${p}:`, 'g'))].length, 0),
    })),
    viewports,
    a11y,
    tokens: tokenIntegrity(css, files),
  }
}

/* ── Rendering ────────────────────────────────────────────────────────────── */

const table = (headers, rows) =>
  [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')

export function render(a) {
  const unreferencedPersonas = a.personas.filter((p) => p.files === 0)
  const orphanScopes = a.themes.filter((t) => t.orphans.length > 0)
  const unmapped = a.themes.filter((t) => !t.activation)
  const deadCallers = a.themes.filter((t) => t.callerLives === false)
  const rendering = a.viewports.filter((v) => v.renders)
  const fixedWidth = rendering.filter((v) => !v.responsive)
  const a11yTotal = a.a11y.reduce((n, c) => n + c.hits.length, 0)

  return `# Tenant experience audit — personas, themes, viewports, accessibility

<!-- Generated by tools/ttes-experience-audit.mjs. Do not edit by hand. -->

## 1. What this is, and what it is not

TTES-000-004 asks for an audit of the current tenant product across personas,
themes, viewports and accessibility. This document is that audit, derived from
\`${APP}\` — the tenant experience — at the commit it was generated on.

It is **not** a measurement of a running deployment. There are two: the live
pilot at \`Tenurework/Tenure\`, which nothing in this repository may reach, and
this monorepo's nonproduction stack. Everything below is read out of the
checkout, and §7 names the questions a checkout cannot answer, rather than
letting a green table imply they were asked.

It covers the tenant experience only. \`apps/system-studio\` is the deployer
experience, audited separately, and TTES-000-001 split the two inventories so a
claim about one could not be read as a claim about both.

Scope read: **${a.fileCount} files** under \`${SRC}\`.

## 2. Personas

A persona in this product is not one column. It is the institution role a person
holds, the scope of the seat they sit in, and whether that seat is incoming,
current or past — \`SHADOW\` is a persona rather than a flag, because it is the
one that can read a club it cannot yet change. All three enums are read from
\`${SCHEMA}\`; the file count is tenant source files that name the value, tests
excluded, because a persona only a test mentions is a persona the product does
not distinguish.

${table(
  ['Persona', 'Enum', 'Declared at', 'Tenant files naming it', 'First'],
  a.personas.map((p) => [
    `\`${p.value}\``,
    p.enumName,
    `\`${SCHEMA}:${p.line}\``,
    String(p.files),
    p.first ? `\`${p.first}\`` : '—',
  ]),
)}

## 3. Themes

A theme here is a scope that redefines design tokens. The scopes are read out of
\`${GLOBALS}\` by shape rather than by name, so a new one appears in this table
without anyone remembering to add it. **Orphans** are tokens a scope declares
that the base \`:root\` does not — a token defined only inside \`html.dark\` is
undefined in light mode, and \`var()\` resolves it to nothing rather than to an
error. Base \`:root\` declares **${a.baseTokens}** tokens.

**Entered by** is a declared mapping, not a derived one: CSS states that a scope
exists, never who turns it on. It is checkable in both directions — a scope with
no entry is a finding, and each named caller must still exist and still match its
probe.

${table(
  ['Scope', 'globals.css', 'Declares', 'Orphans', 'Entered by', 'Caller', 'Caller still matches'],
  a.themes.map((t) => [
    `\`${t.key}\``,
    String(t.line),
    String(t.declares),
    t.orphans.length ? t.orphans.map((o) => `\`${o}\``).join(', ') : '—',
    t.activation ? t.activation.by : '**UNMAPPED**',
    t.activation && t.activation.caller ? `\`${t.activation.caller}\`` : '—',
    t.callerLives === null ? 'n/a' : t.callerLives ? 'yes' : '**NO**',
  ]),
)}

### Token integrity

\`var(--token)\` references across the tenant tree, excluding tests, comments
stripped. A reference carrying a fallback is safe by design and not counted. The
declared set is the union of what the stylesheet declares and what the tree
assigns inline — \`Avatar.tsx\` computes \`--avatar-bg\` per person, and reading
the stylesheet alone would report it missing.

- Declared: **${a.tokens.declared}**
- Distinct tokens referenced without a fallback: **${a.tokens.referenced}**
- Referenced but declared nowhere: **${a.tokens.undeclared.length}**${
    a.tokens.undeclared.length
      ? ` — ${a.tokens.undeclared.map((t) => `\`${t}\``).join(', ')}`
      : ''
  }

## 4. Viewports

Breakpoints the stylesheet actually conditions on, and the responsive prefixes
the tenant markup actually uses. Responsiveness is measured over each page's
transitive import closure, not over the page file: a page whose markup is three
components deep carries no class of its own and would otherwise report as
fixed-width while rendering a fully responsive layout.

${table(
  ['CSS breakpoint', 'Media queries using it'],
  a.breakpoints.map((b) => [`\`${b.q}\``, String(b.uses)]),
)}

${table(
  ['Tailwind prefix', 'Occurrences in tenant .tsx'],
  a.tailwind.map((t) => [`\`${t.prefix}:\``, String(t.uses)]),
)}

**${rendering.length - fixedWidth.length} of ${rendering.length} tenant pages that render markup**
have at least one responsive declaration somewhere in their closure. The other
${a.viewports.length - rendering.length} page(s) emit no element — they are
\`redirect()\` stubs — and are not asked the question.

${table(
  ['Page', 'Files in closure', 'Renders markup', 'Responsive', 'First responsive file'],
  a.viewports.map((v) => [
    `\`${v.page}\``,
    String(v.closure),
    v.renders ? 'yes' : 'redirect only',
    !v.renders ? 'n/a' : v.responsive ? 'yes' : '**no**',
    v.via ? `\`${v.via}\`` : '—',
  ]),
)}

## 5. Accessibility

Static checks over the ${a.a11y.length ? '' : ''}tenant \`.tsx\` tree, comments stripped, tests
excluded. Each is a defect a browser would also find; none is the whole of
accessibility, and §7 says what a static reader cannot reach.

${table(
  ['Check', 'What it looks for', 'Why it matters', 'Hits'],
  a.a11y.map((c) => [`\`${c.id}\``, c.what, c.why, String(c.hits.length)]),
)}

${
  a11yTotal === 0
    ? 'No hit on any check. That is a statement about these four checks and nothing wider.'
    : a.a11y
        .filter((c) => c.hits.length)
        .map(
          (c) =>
            `### \`${c.id}\`\n\n${c.hits
              .map((h) => `- \`${h.file}\` — \`${h.sample.replace(/\|/g, '\\|')}\``)
              .join('\n')}`,
        )
        .join('\n\n')
}

## 6. Findings

${[
  `**${unreferencedPersonas.length} of ${a.personas.length} declared personas are named by no tenant source file**${
    unreferencedPersonas.length
      ? `: ${unreferencedPersonas.map((p) => `\`${p.value}\``).join(', ')}. A persona the schema declares and the product never branches on is a persona the product does not have.`
      : '. Every persona the schema declares is branched on somewhere in the tenant tree.'
  }`,
  `**${orphanScopes.length} of ${a.themes.length} token scopes declare a token the base \`:root\` does not**${
    orphanScopes.length ? `: ${orphanScopes.map((s) => `\`${s.key}\``).join(', ')}` : ''
  }.`,
  `**${unmapped.length} token scope(s) have no entry in the activation map**${
    unmapped.length
      ? `: ${unmapped.map((s) => `\`${s.key}\``).join(', ')}. A scope nobody can enter is dead CSS; a scope whose caller is unknown is worse, because it looks live.`
      : '.'
  }`,
  `**${deadCallers.length} activation caller(s) no longer match their probe**${
    deadCallers.length ? `: ${deadCallers.map((s) => `\`${s.key}\``).join(', ')}` : ''
  }.`,
  `**${fixedWidth.length} of ${rendering.length} rendering tenant pages carry no responsive declaration anywhere in their closure**${
    fixedWidth.length
      ? `: ${fixedWidth.map((v) => `\`${v.page}\``).join(', ')}. Read precisely: no breakpoint CONDITIONS anything on those pages. It does not follow that they break on a phone — a fluid \`w-full max-w-md\` adapts without a prefix, and the sign-in card does exactly that — only that nothing about them changes with the viewport, and that no run of this repository's tests has ever looked at them narrow.`
      : '.'
  }`,
  `**${a.tokens.undeclared.length} token(s) are referenced without a fallback and declared nowhere.**`,
  `**${a11yTotal} static accessibility hit(s)** across ${a.a11y.length} checks.`,
  `**High contrast has no in-product switch.** The \`prefers-contrast: more\` overrides are entered by the operating system only; a user on a machine that cannot express the preference cannot reach them from the product. This is a product gap, not a defect in the CSS.`,
]
  .map((f) => `- ${f}`)
  .join('\n')}

## 7. What this audit does NOT establish

Named rather than omitted, because an audit's silence reads as a pass.

- **No running system was measured.** Neither the pilot nor the nonproduction
  stack was reached. Every row is read out of the checkout.
- **No rendered contrast.** \`${SRC}/lib/a11y/contrast.ts\` and its test audit
  declared token PAIRS; neither they nor this document measures the contrast a
  browser actually composites, which depends on what is stacked over what.
- **No focus order, no screen-reader output, no reflow at 400% zoom.** These are
  properties of a rendered page. \`${APP}/e2e/visual-baselines.spec.ts\` is the
  suite shaped to hold them and it has no reference images — TTES-020-004, which
  is \`BLOCKED_EXTERNAL\` for exactly that reason.
- **Persona coverage is lexical.** The file count says a persona is named, not
  that the branch it drives is correct or reachable.
- **The responsive measure is binary, and it is a measure of BREAKPOINTS.** One
  \`sm:\` anywhere in a closure counts, and a fluid layout that adapts with no
  breakpoint at all counts as none. Whether a page is usable at 320px is a
  rendered question this cannot ask.
`
}

/* ── Command ──────────────────────────────────────────────────────────────── */

const isCommand =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const generated = render(collect())
  const target = path.join(ROOT, OUT)
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target)
      ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
      : ''
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/ttes-experience-audit.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(target, generated)
    console.log(`Wrote ${OUT}`)
  }
}

export { OUT, ROOT, SRC, GLOBALS, SCHEMA, ACTIVATION, A11Y_CHECKS }
