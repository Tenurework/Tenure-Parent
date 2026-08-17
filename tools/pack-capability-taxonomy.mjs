#!/usr/bin/env node
/**
 * PACK-040-001 and PACK-050-002 — the capability registry.
 *
 * Two things the pack Bible asks for, and one generator, because they are the
 * same act performed over two of its sections:
 *
 *   * **PACK-040-001** — "Create canonical registry entries for all functional
 *     capabilities in Section 8."
 *   * **PACK-050-002** — "Create registry taxonomy for Section 9 without
 *     claiming implementation."
 *
 * Bible §9 states the rule both of them live under, in its own first line:
 * "Treat this as a maintained capability registry, not a claim that every pack
 * is implemented." A registry is therefore useful precisely to the extent that
 * it can be WRONG about something, and there are exactly two ways this one can
 * be:
 *
 *   1. it can omit or invent a capability, and
 *   2. it can claim more implementation than the module catalog supports.
 *
 * Both are checked, by `tests/architecture/pack-capability-taxonomy.test.mjs`.
 *
 * ── Why a generator rather than a written document ───────────────────────────
 *
 * A hand-written registry of three hundred capabilities is accurate the day it
 * is typed and plausible from the next commit onward. Every entry below is
 * PARSED out of the Bible's own §8 and §9 text, carries the bullet it came from
 * verbatim, and the guard searches the Bible for that bullet independently of
 * this parser. An entry naming a capability the Bible does not state cannot
 * survive, and a bullet the Bible states that produces no entry cannot either.
 *
 * ── The one authored thing, and why it is authored ───────────────────────────
 *
 * `COVERED_BY` is judgement: which of the twelve shipped modules, if any,
 * covers a stated capability. That cannot be computed — no string in
 * `modules/index.ts` says "this is Bible §8.1's Budgeting" — so it is declared
 * here, with a reason, and everything ABOUT it is checked: the module key must
 * exist in the catalog, and the entry's status is read from that module's own
 * `lifecycle` rather than written beside it. All twelve are `certified-limited`
 * (PACK-000-002), so no registry entry can say `available` while that is true,
 * and an entry nothing covers says `not-implemented` rather than nothing.
 *
 * Section 9 has no `COVERED_BY` at all. Not one industry pack exists, and the
 * requirement's own words are "without claiming implementation", so the
 * generator refuses to accept a coverage claim for an industry entry — the
 * table is keyed by functional id and an industry key would be rejected as
 * unknown.
 *
 * Usage:  node tools/pack-capability-taxonomy.mjs [--check]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// One parser for the module catalog, not a second one. `modules()` is the
// reader `tools/pack-surface-inventory.mjs` already owns (PACK-000-001), and a
// second copy of "what does modules/index.ts declare" is how the inventory and
// this registry would eventually disagree about the same twelve manifests.
import { ROOT, modules } from './pack-surface-inventory.mjs'

export const BIBLE = 'Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md'
export const JSON_PATH = 'docs/architecture/pack-capability-taxonomy.json'
export const MD_PATH = 'docs/architecture/pack-capability-taxonomy.md'

/** CRLF collapsed before anything matches or compares. */
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const exists = (p) => fs.existsSync(path.join(ROOT, p))

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** id-safe form of a capability name. */
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// ── reading the authority ───────────────────────────────────────────────────

/**
 * The lines of one `## n.` section, up to the next `## ` heading.
 *
 * Anchored on the heading text rather than a line number so that editing the
 * Bible's prose cannot silently shift which section is read.
 */
function section(text, heading) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trim() === heading)
  if (start === -1) throw new Error(`${BIBLE} has no heading ${JSON.stringify(heading)}`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^## /.test(l))
  return end === -1 ? rest : rest.slice(0, end)
}

/** `- item` or `1. item` — the two list forms §8 and §9 use. */
const ENTRY_LINE = /^(?:-|\d+\.)\s+(.*)$/

/**
 * A section's subsections, each with its entry bullets and its prose.
 *
 * Prose matters as much as the bullets here: §9.6 says Tenure "must not claim
 * to replace an EHR … without a separately certified scope" and §9.8 says it
 * must not imply it is a core banking system. Dropping those paragraphs would
 * turn a taxonomy that carries its own limits into a list of industries Tenure
 * appears to serve, which is the exact claim PACK-050-002 forbids.
 */
function subsections(lines, prefix) {
  const out = []
  let current = null
  const preamble = []
  for (const line of lines) {
    const heading = /^### (\d+\.\d+)\s+(.*)$/.exec(line)
    if (heading) {
      if (!heading[1].startsWith(`${prefix}.`)) {
        throw new Error(`unexpected subsection ${heading[1]} under section ${prefix}`)
      }
      current = { id: heading[1], title: heading[2].trim(), entries: [], caveats: [] }
      out.push(current)
      continue
    }
    const entry = ENTRY_LINE.exec(line.trim())
    if (entry) {
      if (current === null) throw new Error(`entry before any subsection: ${line}`)
      current.entries.push(entry[1].trim())
      continue
    }
    if (line.trim() === '') continue
    if (current === null) preamble.push(line.trim())
    else current.caveats.push(line.trim())
  }
  return { preamble: preamble.join(' '), subsections: out }
}

/**
 * One §8 bullet, split into the capabilities it names.
 *
 * §8's own first line is "Track every capability separately", and its bullets
 * are comma lists of several: "Cash, treasury, banking, liquidity and
 * reconciliation" is five capabilities, not one. The split is mechanical — on
 * commas, and on the final "and" — so it cannot quietly drop one, and it makes
 * no attempt to be prettier than the source: "contingent and volunteer
 * workforce" yields "contingent" and "volunteer workforce" because that is what
 * the sentence says. Every entry carries `line`, the bullet it came from, so an
 * awkward fragment is always readable in its own context.
 *
 * §9 entries are NOT split: each of its bullets is one industry.
 */
export function capabilitiesOf(bullet) {
  const text = bullet.replace(/\.$/, '')
  const parts = text.split(/,\s*/)
  const out = []
  parts.forEach((part, i) => {
    if (i === parts.length - 1) out.push(...part.split(/\s+and\s+/))
    else out.push(part)
  })
  return out.map((s) => s.trim()).filter(Boolean)
}

// ── the one authored table ──────────────────────────────────────────────────

/**
 * Which shipped module covers a stated §8 capability, and why.
 *
 * Deliberately short. The temptation with a registry this wide is to map
 * generously — `budgeting` owns `LedgerEntry`, so why not claim §8.1's "General
 * ledger"? Because it has no journals, no period close and no subledgers, and a
 * registry that says otherwise is the false `Available` claim PACK-000-004
 * exists to remove. Nothing is mapped unless the module's own manifest
 * description is about that capability.
 *
 * `why` is required and is checked for being non-empty: a mapping without a
 * reason is a mapping nobody can review.
 */
export const COVERED_BY = {
  'FUN-8.1-budgeting': { module: 'budgeting', why: 'Budgets, lines and actuals with a portfolio roll-up.' },
  'FUN-8.1-expense': { module: 'reimbursements', why: 'Three-way matched expense claims that post on approval.' },
  'FUN-8.10-requests': { module: 'approvals', why: 'Approval requests are the module’s primary object.' },
  'FUN-8.10-approvals': { module: 'approvals', why: 'Multi-gate approval with delegation and a decision trail.' },
  'FUN-8.10-calendar': { module: 'events', why: 'Event scheduling with a subscribable calendar.' },
  'FUN-8.10-messaging': { module: 'messaging', why: 'Conversations, messages and attachments.' },
  'FUN-8.10-documents': { module: 'memory', why: 'Governs the Document model and its retrieval.' },
  'FUN-8.10-decisions': { module: 'memory', why: 'Knowledge cards that record what was decided.' },
  'FUN-8.10-handoffs': { module: 'memory', why: 'Records written to outlive the officers who wrote them.' },
  'FUN-8.10-playbooks': { module: 'resources', why: 'The staff office’s published guides, targeted by seat.' },
  'FUN-8.10-durable-seat-context': { module: 'organizations', why: 'Seats, seat holdings and role assignments.' },
  'FUN-8.10-successor-onboarding': { module: 'organizations', why: 'RoleTransfer is the successor hand-off object.' },
  'FUN-8.10-cross-module-search': { module: 'search', why: 'Search across everything the principal may already see.' },
  // `FUN-8.10-reporting` is deliberately absent. `dashboard` is a landing
  // surface and `budgeting` serves `/reports`, and neither is the cross-module
  // reporting §8.10 names beside lineage. Mapping one of them would be the
  // generous reading this table exists to refuse.
  'FUN-8.10-relay': { module: 'search', why: 'Declares the only registered Relay tool, search.corpus.' },
  'FUN-8.3-organization-assignments': {
    module: 'organizations',
    why: 'Rosters, roles and the assignments people hold.',
  },
}

// ── the registry ────────────────────────────────────────────────────────────

/**
 * The status vocabulary, and the reason it is this short.
 *
 * A registry entry may say `not-implemented`, or it may mirror the lifecycle of
 * the module that covers it. There is no third value it can be given by hand,
 * so no entry can be talked up: `available` is unreachable from here while all
 * twelve manifests are `certified-limited`, and it becomes reachable only by a
 * manifest passing `validateManifest`'s evidence gate.
 */
export const NOT_IMPLEMENTED = 'not-implemented'

export function registry() {
  const bible = read(BIBLE)
  const catalog = new Map(modules().map((m) => [m.key, m]))

  const functional = subsections(section(bible, '## 8. Functional suite map'), 8)
  const industry = subsections(section(bible, '## 9. Industry pack taxonomy'), 9)

  const usedIds = new Set()
  const id = (prefix, suite, name) => {
    const base = `${prefix}-${suite}-${slug(name)}`
    let candidate = base
    let n = 1
    while (usedIds.has(candidate)) candidate = `${base}-${++n}`
    usedIds.add(candidate)
    return candidate
  }

  const suites = functional.subsections.map((s) => ({
    id: s.id,
    title: s.title,
    caveats: s.caveats,
    entries: s.entries.flatMap((line) =>
      capabilitiesOf(line).map((capability) => {
        const entryId = id('FUN', s.id, capability)
        const claim = COVERED_BY[entryId] ?? null
        if (claim === null) {
          return { id: entryId, capability, line, status: NOT_IMPLEMENTED, coveredBy: null }
        }
        const module = catalog.get(claim.module)
        if (!module) {
          // Not a fallback: a coverage claim naming a module the catalog does
          // not declare is a broken claim, and the generator refuses to emit a
          // document that hides it.
          throw new Error(
            `COVERED_BY[${entryId}] names module "${claim.module}", which modules/index.ts does not declare`,
          )
        }
        if (!claim.why || claim.why.trim() === '') {
          throw new Error(`COVERED_BY[${entryId}] states no reason`)
        }
        return {
          id: entryId,
          capability,
          line,
          // Read from the manifest, never written here. This is the whole
          // mechanism that stops the registry claiming more than the catalog.
          status: module.lifecycle,
          coveredBy: { module: module.key, lifecycle: module.lifecycle, mode: module.mode, why: claim.why },
        }
      }),
    ),
  }))

  const families = industry.subsections.map((f) => ({
    id: f.id,
    title: f.title,
    caveats: f.caveats,
    entries: f.entries.map((line) => ({
      id: id('IND', f.id, line.replace(/\.$/, '')),
      industry: line.replace(/\.$/, ''),
      line,
      // Flat, and not derived from a table, because there is no table: no
      // industry pack exists. PACK-050-002's words are "without claiming
      // implementation" and this is that, expressed so that claiming otherwise
      // requires editing the generator rather than a data file.
      status: NOT_IMPLEMENTED,
      coveredBy: null,
    })),
  }))

  const unknownClaims = Object.keys(COVERED_BY).filter((k) => !usedIds.has(k))
  if (unknownClaims.length > 0) {
    throw new Error(
      `COVERED_BY names ${unknownClaims.length} entry id(s) the Bible does not produce: ${unknownClaims
        .sort(byString)
        .join(', ')}`,
    )
  }

  const functionalEntries = suites.flatMap((s) => s.entries)
  const industryEntries = families.flatMap((f) => f.entries)

  return {
    source: BIBLE,
    functional: {
      requirement: 'PACK-040-001',
      preamble: functional.preamble,
      suites,
    },
    industry: {
      requirement: 'PACK-050-002',
      preamble: industry.preamble,
      families,
    },
    counts: {
      suites: suites.length,
      functionalEntries: functionalEntries.length,
      functionalCovered: functionalEntries.filter((e) => e.coveredBy !== null).length,
      functionalNotImplemented: functionalEntries.filter((e) => e.status === NOT_IMPLEMENTED).length,
      families: families.length,
      industryEntries: industryEntries.length,
      industryImplemented: industryEntries.filter((e) => e.status !== NOT_IMPLEMENTED).length,
      modulesInCatalog: catalog.size,
      modulesCoveringSomething: new Set(
        functionalEntries.filter((e) => e.coveredBy !== null).map((e) => e.coveredBy.module),
      ).size,
    },
  }
}

// ── rendering ───────────────────────────────────────────────────────────────

const table = (headers, rows) =>
  [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')

const cell = (s) => String(s).replace(/\|/g, '\\|')

function markdown(reg) {
  const c = reg.counts
  const out = []
  out.push('<!-- Generated by tools/pack-capability-taxonomy.mjs. Do not edit by hand. -->')
  out.push('# Pack capability registry')
  out.push('')
  out.push(
    `PACK-040-001 (§8, functional) and PACK-050-002 (§9, industry). Parsed from ` +
      `\`${reg.source}\`; every row carries the bullet it came from, and ` +
      '`tests/architecture/pack-capability-taxonomy.test.mjs` searches that Bible for it.',
  )
  out.push('')
  out.push(
    `**${c.functionalEntries} functional capabilities across ${c.suites} suites · ` +
      `${c.functionalCovered} covered by a shipped module · ` +
      `${c.industryEntries} industries across ${c.families} families · ` +
      `${c.industryImplemented} industry packs implemented.**`,
  )
  out.push('')
  out.push(
    'A registry is not a claim. Bible §9 opens with "Treat this as a maintained capability registry, ' +
      'not a claim that every pack is implemented", and the two numbers that matter above are the two ' +
      'small ones: a capability is `not-implemented` unless a module in `modules/index.ts` covers it, ' +
      'and no entry can carry a status better than that module’s own `lifecycle`. All twelve ' +
      'modules are `certified-limited` (PACK-000-002), so nothing here reads `available`.',
  )
  out.push('')
  out.push('## §8 — functional suites')
  out.push('')
  out.push(`> ${reg.functional.preamble}`)
  for (const suite of reg.functional.suites) {
    out.push('')
    out.push(`### ${suite.id} ${suite.title}`)
    out.push('')
    for (const caveat of suite.caveats) out.push(`> ${caveat}`)
    if (suite.caveats.length > 0) out.push('')
    out.push(
      table(
        ['Id', 'Capability', 'Status', 'Covered by', 'Why', 'Bible line'],
        suite.entries.map((e) => [
          `\`${e.id}\``,
          cell(e.capability),
          `\`${e.status}\``,
          e.coveredBy === null ? '—' : `\`${e.coveredBy.module}\``,
          e.coveredBy === null ? '—' : cell(e.coveredBy.why),
          cell(e.line),
        ]),
      ),
    )
  }
  out.push('')
  out.push('## §9 — industry pack taxonomy')
  out.push('')
  out.push(`> ${reg.industry.preamble}`)
  for (const family of reg.industry.families) {
    out.push('')
    out.push(`### ${family.id} ${family.title}`)
    out.push('')
    for (const caveat of family.caveats) out.push(`> ${caveat}`)
    if (family.caveats.length > 0) out.push('')
    out.push(
      table(
        ['Id', 'Industry', 'Status'],
        family.entries.map((e) => [`\`${e.id}\``, cell(e.industry), `\`${e.status}\``]),
      ),
    )
  }
  out.push('')
  out.push('## What this document is not')
  out.push('')
  out.push(
    `${c.modulesCoveringSomething} of the ${c.modulesInCatalog} modules in the catalog cover a §8 ` +
      'capability line. The rest cover none — not because they do nothing, but because §8 does not ' +
      'name what they do, and inventing a line for them would be editing the authority to fit the ' +
      'implementation. What each of the twelve actually does, per plane, is ' +
      '`docs/architecture/pack-surface-inventory.md` and the seventeen dimension assessments in ' +
      '`modules/index.ts`.',
  )
  out.push('')
  return out.join('\n')
}

export function render() {
  const reg = registry()
  return { json: JSON.stringify(reg, null, 2) + '\n', md: markdown(reg), reg }
}

function main() {
  const check = process.argv.includes('--check')
  const { json, md } = render()
  const targets = [
    [JSON_PATH, json],
    [MD_PATH, md],
  ]

  if (check) {
    const stale = targets.filter(([p, want]) => !exists(p) || read(p) !== want).map(([p]) => p)
    if (stale.length > 0) {
      for (const p of stale) {
        console.error(`::error::${p} is stale. Run: node tools/pack-capability-taxonomy.mjs`)
      }
      process.exit(1)
    }
    console.log('pack-capability-taxonomy: current')
    return
  }

  for (const [p, content] of targets) {
    fs.writeFileSync(path.join(ROOT, p), content)
    console.log(`wrote ${p}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
