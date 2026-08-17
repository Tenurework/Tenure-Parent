#!/usr/bin/env node
/**
 * The Simon absorption convergence inventory — SIMON-000-004, -005, -006, -007.
 *
 * Four requirements finish the absorption bible's §4.1. The first three
 * (`tools/simon-absorption-inventory.mjs`) answered "what is in each tree".
 * These four answer the harder question the bible actually needs before an
 * import begins:
 *
 *   SIMON-000-004  every hard-coded Simon/OSE/University/club/term/role/
 *                  workflow/domain/account/region/resource assumption,
 *                  INCLUDING the ones hidden in fixtures, CSS, route names,
 *                  reports, permission checks and deployment scripts.
 *   SIMON-000-005  duplicate business concepts under different names across the
 *                  two repositories, and the same name carrying different
 *                  semantics.
 *   SIMON-000-006  a package-by-package and capability-by-capability comparison
 *                  labelled from the bible's own disposition enumeration.
 *   SIMON-000-007  source licenses, generated artifacts, vendored code,
 *                  binaries, large files, secret history indicators, vulnerable
 *                  dependencies and unsupported runtimes.
 *
 * WHY THIS IS A SECOND GENERATOR AND NOT A FOURTH DOCUMENT IN THE FIRST ONE.
 *
 * `simon-absorption-inventory.mjs` is pinned: it reads two commits and answers
 * "what files exist". These four are ANALYSES of that baseline — they read the
 * CONTENT of those same two trees. Keeping them separate means the baseline can
 * never be silently re-pinned by an analysis run, and it means this file reads
 * the baseline's commits out of the baseline's own snapshot rather than resolving
 * refs again. The two artifacts therefore describe the same two trees by
 * construction; there is no way for them to drift.
 *
 * WHAT MAY AND MAY NOT APPEAR IN THE OUTPUT.
 *
 * The absorption ledger's rule 8 is absolute: nothing recorded may contain
 * Simon student, staff or applicant data. This repository is public and
 * everything a workflow prints is archived. So each probe declares how much of
 * its own match it is allowed to REVEAL:
 *
 *   reveal: 'literal'  the matched text is emitted. Only for probes whose
 *                      pattern is a closed set of literal tokens — a role name,
 *                      a season, an AWS region, an ARN service prefix. A person
 *                      cannot be hiding inside `us-east-1`.
 *   reveal: 'mask'     the match is emitted as `#` of the same length and
 *                      nothing else. Used for the 12-digit AWS account id, for
 *                      bucket/user-pool/queue identifiers, and for anything
 *                      whose pattern has an open capture. The location and the
 *                      shape are the finding; the value is not needed to fix it
 *                      and printing it would be a leak.
 *
 * There is deliberately no third mode. A probe that wants to print an open
 * capture has to be rewritten as a closed one first.
 *
 * DETERMINISM. Same rules as the baseline generator: POSIX paths, explicit
 * codepoint comparators, CRLF stripped before parsing, `\n` on write. The one
 * unstable input is `npm audit`, whose advisory database changes under us; it is
 * stamped `observed_at` and the guard test does not re-derive it.
 *
 * Usage: node tools/simon-convergence-inventory.mjs           (refresh)
 *        node tools/simon-convergence-inventory.mjs --check   (docs vs snapshot)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  ROOT,
  SNAPSHOT as BASELINE_SNAPSHOT,
  SOURCE_REF,
  PROBES,
  byCodepoint,
  posix,
  readBlobs,
} from './simon-absorption-inventory.mjs'

export { ROOT, BASELINE_SNAPSHOT }

export const SNAPSHOT = 'docs/architecture/simon-convergence-inventory.json'
export const DOC_ASSUMPTIONS = 'docs/architecture/simon-hardcoded-assumptions.md'
export const DOC_CONCEPTS = 'docs/architecture/simon-concept-collisions.md'
export const DOC_DISPOSITION = 'docs/architecture/simon-capability-disposition.md'
export const DOC_IMPORT_RISK = 'docs/architecture/simon-import-risk-inventory.md'

const git = (args, opts = {}) => {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      ...opts,
    })
      .split('\r\n')
      .join('\n')
  } catch {
    return null
  }
}

const gitLines = (args) => {
  const out = git(args)
  if (out === null) return null
  return out.split('\n').map((l) => l.trim()).filter(Boolean)
}

/** A read that failed is UNKNOWN with the command that would answer it, never absent. */
export const unknown = (command, of) => ({ ok: false, unknown_because: `\`${command}\` did not answer`, command, of })

// ══════════════════════ SIMON-000-004 — hard-coded assumptions ══════════════════════

/**
 * The files a content scan is allowed to open.
 *
 * Code, config and infrastructure — the places an assumption becomes runtime
 * behaviour. Three exclusions, each for a reason rather than for tidiness:
 *
 *   `docs/`        prose about Simon is not a hard-coded assumption, and the
 *                  generated inventories under docs/architecture mention the
 *                  tenant thousands of times. Including them would bury every
 *                  real finding under this programme's own paperwork.
 *   lockfiles      a lockfile is a machine record of resolved versions.
 *   `Tier1/`       the baseline generator's standing rule: listed by path,
 *                  never opened. It is where the pilot's real records live.
 */
export const SCANNABLE = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|ya?ml|tf|tfvars|sql|prisma|sh|toml)$|(^|\/)Dockerfile$/
export const NOT_SCANNED = [
  { pattern: /^docs\//, why: 'prose and generated inventories, not runtime behaviour' },
  { pattern: /(^|\/)(node_modules|\.next|dist|build|coverage)\//, why: 'installed or generated' },
  { pattern: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/, why: 'a machine record of resolved versions' },
  { pattern: /^Tier1\//, why: 'the pilot’s real records — listed by path, never opened' },
]

/**
 * One probe per assumption the requirement names, plus the ones it implies.
 *
 * `kind` is taken from the requirement's own sentence so the coverage table can
 * be read against it word by word. Several probes may share a kind: "role"
 * hides both as a comparison against a string literal and as a bare enum
 * constant, and finding only one of the two would be the same defect as not
 * looking.
 */
export const ASSUMPTION_PROBES = [
  {
    id: 'tenant-token',
    kind: 'Simon / OSE',
    pattern: /\b(?:Simon|SIMON|simon|OSE|Ose|ose)\b/g,
    reveal: 'literal',
    why: 'a tenant name in core code is the specific §2 failure absorption exists to prevent',
  },
  {
    id: 'university-token',
    kind: 'University',
    pattern: /\bUniversit(?:y|ies)\b/gi,
    reveal: 'literal',
    why: 'the institution type is tenant configuration, not a platform concept',
  },
  {
    id: 'club-token',
    kind: 'club',
    pattern: /\bclubs?\b/gi,
    reveal: 'literal',
    why: '“club” is Simon’s word for an organisation unit; the platform term is configurable',
  },
  {
    id: 'term-with-year',
    kind: 'term',
    pattern: /\b(?:Fall|Spring|Summer|Winter)[ _-]?20\d{2}\b/gi,
    reveal: 'literal',
    why: 'a term baked into code expires; the pilot target is Fall 2026',
  },
  {
    id: 'term-season-enum',
    kind: 'term',
    pattern: /\b(?:FALL|SPRING|SUMMER|WINTER)\b/g,
    reveal: 'literal',
    why: 'a fixed season enumeration is an academic-calendar assumption',
  },
  {
    id: 'role-comparison',
    kind: 'role',
    pattern: /\brole\b\s*(?:===|!==|==|!=)\s*['"][^'"\n]{1,40}['"]/g,
    reveal: 'literal',
    why: 'SIMON-030-007: routing must come from workflow data, not hard-coded role checks',
  },
  {
    id: 'role-constant',
    kind: 'role',
    pattern: /\b(?:SUPER_ADMIN|OSE_ADMIN|ADVISOR|TREASURER|PRESIDENT|VICE_PRESIDENT)\b/g,
    reveal: 'literal',
    why: 'a role constant in code cannot be re-assigned by a tenant',
  },
  {
    id: 'workflow-shape',
    kind: 'workflow',
    pattern: /\b(?:six|6)[ _-]step\b|\bstep\s*(?:===|==)\s*\d+|\b(?:VP|PRESIDENT|OSE)_(?:APPROVAL|REVIEW|SIGNOFF)\b/gi,
    reveal: 'literal',
    why: 'the six-step OSE workflow must be data, so future variants need no code change',
  },
  {
    id: 'domain-literal',
    kind: 'domain',
    // Not preceded by `@` or by an identifier character, so this cannot capture
    // the domain half of somebody's email address — the one way this probe
    // could have leaked a person.
    pattern: /(?<![@\w])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:edu|com|org|net|gov)\b/g,
    reveal: 'literal',
    why: 'a hostname in code pins one tenant’s deployment',
  },
  {
    id: 'aws-account-id',
    kind: 'account',
    pattern: /(?<![\w.])\d{12}(?![\w.])/g,
    reveal: 'mask',
    why: 'an AWS account id in code pins one account; it is also semi-secret, so it is masked',
  },
  {
    id: 'aws-region',
    kind: 'region',
    pattern: /\b(?:us|eu|ap|sa|ca|me|af|il)-(?:east|west|north|south|northeast|northwest|southeast|southwest|central)-[1-9]\b/g,
    reveal: 'literal',
    why: 'a region in code pins one topology; the bible forbids Simon owning the AWS topology',
  },
  {
    id: 'aws-arn-prefix',
    kind: 'resource',
    // Stops at the service segment on purpose: `arn:aws:s3:` is the finding,
    // and everything after it is an account id and a resource name.
    pattern: /\barn:aws[a-z-]*:[a-z0-9-]+:/g,
    reveal: 'literal',
    why: 'a literal ARN is a resource this repository does not own the lifecycle of',
  },
  {
    id: 'resource-identifier',
    kind: 'resource',
    pattern:
      /\b(?:bucket|bucket_name|table_name|queue_url|topic_arn|distribution_id|hosted_zone_id|certificate_arn|cluster_name|user_pool_id|user_pool_client_id)\s*[:=]\s*['"][^'"\n]{1,120}['"]/g,
    reveal: 'mask',
    why: 'a named resource is a deployed thing with an owner; the name itself is masked',
  },
]

/** Path-shaped probes: the assumption is the route name, not anything inside the file. */
export const PATH_PROBES = [
  {
    id: 'tenant-in-path',
    kind: 'route name',
    pattern: /(?:^|\/)(?:simon|ose)(?:[-_.]|\/|$)/i,
    reveal: 'literal',
    why: 'a tenant-named route or module is a fork wearing a directory name',
  },
]

/**
 * The hiding places the requirement names, in the order it names them.
 *
 * A finding is attributed to the FIRST place that matches its path, so the
 * table partitions the findings exactly once and the counts add up to the
 * total. That is the property that makes it a coverage claim rather than six
 * overlapping searches.
 *
 * The order is deliberately specific-before-generic. `route names` matches
 * everything under `src/app/`, which in Next.js is every page — including the
 * report pages and the permission-checking server actions. Listing it first
 * emptied both of those rows and made the table look as though the requirement's
 * two most interesting hiding places were clean. They were not; they were
 * being absorbed by their neighbour.
 */
export const PLACES = [
  { place: 'fixtures', pattern: /(^|\/)(?:fixtures?|__fixtures__|__mocks__)\/|(^|\/)seed[^/]*\.(?:ts|mjs|js|sql)$/i },
  { place: 'CSS', pattern: /\.(?:css|scss)$/ },
  { place: 'reports', pattern: /report/i },
  { place: 'permission checks', pattern: /rbac|authoriz|permission|guard|entitle|tenancy|tenant-scope/i },
  { place: 'deployment scripts', pattern: /^\.github\/workflows\/|\.tf$|\.tfvars$|\.sh$|(^|\/)Dockerfile$/ },
  { place: 'route names', pattern: /(^|\/)src\/app\// },
  { place: 'elsewhere', pattern: null },
]

export const placeOf = (file) => (PLACES.find((p) => p.pattern === null || p.pattern.test(file)) ?? PLACES.at(-1)).place

/** `#` of the same length. The location and the shape survive; the value does not. */
const maskToken = (s) => '#'.repeat(s.length)

const lineIndex = (text) => {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

const lineAt = (starts, offset) => {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

const TOKEN_CAP = 8

/**
 * Every assumption a scan can see, grouped by (file, probe).
 *
 * Grouped rather than one row per hit because "every" is a claim about
 * LOCATION: the group carries every line number, exactly, and up to eight
 * distinct tokens. A file mentioning the tenant four hundred times produces one
 * row with four hundred line numbers instead of four hundred rows, and nothing
 * about where it is is lost.
 */
export function scanAssumptions(files, contentOf) {
  const skipped = []
  const scanned = []
  for (const f of files) {
    const excuse = NOT_SCANNED.find((n) => n.pattern.test(f))
    if (excuse) {
      skipped.push({ file: f, why: excuse.why })
      continue
    }
    if (SCANNABLE.test(f)) scanned.push(f)
  }

  const groups = []

  for (const probe of PATH_PROBES) {
    for (const f of files) {
      if (NOT_SCANNED.some((n) => n.pattern.test(f))) continue
      const m = f.match(probe.pattern)
      if (!m) continue
      groups.push({
        file: f,
        probe: probe.id,
        kind: probe.kind,
        place: placeOf(f),
        in_path: true,
        hits: 1,
        lines: [],
        tokens: [m[0]],
      })
    }
  }

  for (const f of scanned) {
    const text = contentOf(f)
    if (text === null || text === undefined) continue
    const flat = text.split('\r\n').join('\n')
    const starts = lineIndex(flat)
    for (const probe of ASSUMPTION_PROBES) {
      const re = new RegExp(probe.pattern.source, probe.pattern.flags.includes('g') ? probe.pattern.flags : `${probe.pattern.flags}g`)
      const lines = new Set()
      const tokens = new Set()
      let hits = 0
      let m
      while ((m = re.exec(flat)) !== null) {
        hits += 1
        lines.add(lineAt(starts, m.index))
        tokens.add(probe.reveal === 'mask' ? maskToken(m[0]) : m[0])
        if (m[0] === '') re.lastIndex += 1
      }
      if (hits === 0) continue
      groups.push({
        file: f,
        probe: probe.id,
        kind: probe.kind,
        place: placeOf(f),
        in_path: false,
        hits,
        lines: [...lines].sort((a, b) => a - b),
        tokens: [...tokens].sort(byCodepoint).slice(0, TOKEN_CAP),
      })
    }
  }

  groups.sort((a, b) => byCodepoint(a.file, b.file) || byCodepoint(a.probe, b.probe))

  const total = groups.reduce((n, g) => n + g.hits, 0)
  const byKind = [...new Set([...ASSUMPTION_PROBES, ...PATH_PROBES].map((p) => p.kind))].map((kind) => {
    const mine = groups.filter((g) => g.kind === kind)
    return {
      kind,
      hits: mine.reduce((n, g) => n + g.hits, 0),
      files: new Set(mine.map((g) => g.file)).size,
    }
  })
  const byPlace = PLACES.map(({ place }) => {
    const mine = groups.filter((g) => g.place === place)
    return {
      place,
      hits: mine.reduce((n, g) => n + g.hits, 0),
      files: new Set(mine.map((g) => g.file)).size,
      evidence: [...new Set(mine.map((g) => g.file))].sort(byCodepoint).slice(0, 6),
    }
  })
  const byFile = [...new Set(groups.map((g) => g.file))]
    .map((file) => {
      const mine = groups.filter((g) => g.file === file)
      return {
        file,
        hits: mine.reduce((n, g) => n + g.hits, 0),
        kinds: [...new Set(mine.map((g) => g.kind))].sort(byCodepoint),
        place: placeOf(file),
      }
    })
    .sort((a, b) => b.hits - a.hits || byCodepoint(a.file, b.file))

  return {
    files_offered: files.length,
    files_scanned: scanned.length,
    files_skipped: skipped.length,
    total_hits: total,
    groups,
    by_kind: byKind.sort((a, b) => byCodepoint(a.kind, b.kind)),
    by_place: byPlace,
    by_file: byFile,
  }
}

// ══════════════════════ SIMON-000-005 — duplicate concepts ══════════════════════

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const NOT_CODE_OF_INTEREST = /\.(test|itest|spec)\.[a-z]+$|(^|\/)node_modules\//

/**
 * What a module says it exports, and how it declares each one.
 *
 * Textual, like the baseline generator's import scan, and for the same reason:
 * this is a claim about what the source text says. The KIND matters as much as
 * the name — `export const decide` and `export type decide` are the same
 * identifier with different semantics, which is precisely half of what
 * SIMON-000-005 asks to be located.
 */
export function exportsOf(text) {
  const src = text.split('\r\n').join('\n')
  const out = new Map()
  const add = (name, kind) => {
    if (!name) return
    if (!out.has(name)) out.set(name, kind)
  }
  const patterns = [
    [/^\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm, 'function'],
    [/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm, 'value'],
    [/^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, 'class'],
    [/^\s*export\s+type\s+([A-Za-z_$][\w$]*)/gm, 'type'],
    [/^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/gm, 'interface'],
    [/^\s*export\s+(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/gm, 'enum'],
  ]
  for (const [re, kind] of patterns) {
    let m
    re.lastIndex = 0
    while ((m = re.exec(src)) !== null) add(m[1], kind)
  }
  if (/^\s*export\s+default\b/m.test(src)) add('default', 'default')
  const braced = /^\s*export\s*\{([^}]*)\}/gm
  let b
  while ((b = braced.exec(src)) !== null) {
    for (const piece of b[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) add(name, 're-export')
    }
  }
  return out
}

const jaccard = (a, b) => {
  if (a.size === 0 && b.size === 0) return 0
  let shared = 0
  for (const x of a) if (b.has(x)) shared += 1
  return shared / (a.size + b.size - shared)
}

export const SYNONYM_THRESHOLD = 0.6
const CANDIDATE_CAP = 25
const MIN_CANDIDATE_EXPORTS = 4

/**
 * Names the framework dictates, excluded from the similarity metric only.
 *
 * Every Next.js page exports `default`, and most export `metadata` and
 * `dynamic`; every route handler exports some subset of the HTTP verbs. Left in,
 * these produced eight candidate pairs at Jaccard 1.0 between unrelated admin
 * pages and a layout — a perfect score for agreeing about a framework contract,
 * which says nothing at all about whether two modules are one business concept.
 * They are excluded HERE and nowhere else: the decided tables still report them,
 * because a module that stopped exporting `default` genuinely changed shape.
 */
export const FRAMEWORK_CONTRACT_EXPORTS = new Set([
  'default',
  'dynamic',
  'dynamicParams',
  'fetchCache',
  'generateMetadata',
  'generateStaticParams',
  'metadata',
  'middleware',
  'revalidate',
  'runtime',
  'viewport',
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
])

/**
 * Where the two repositories disagree about a name or agree about a shape.
 *
 * Three findings, and they are three because they are three different claims
 * with three different strengths, which is the only honest way to report a
 * similarity metric:
 *
 *   same_name_different_shape  DECIDED. A module basename that exists on both
 *                              sides and exports different sets. Nothing is
 *                              inferred: two lists differ.
 *   same_symbol_different_kind DECIDED. One exported identifier declared as a
 *                              function on one side and a type on the other.
 *   candidate_synonyms         CANDIDATE, and labelled so everywhere. Different
 *                              basenames whose export-name sets overlap by
 *                              Jaccard ≥ 0.6. A metric proposes; a human
 *                              adjudicates. The threshold is printed beside the
 *                              table so the list can be reproduced.
 */
export function compareConcepts(sourceModules, targetModules) {
  const srcByBase = new Map()
  for (const [file, exps] of sourceModules) {
    const base = path.posix.basename(file)
    if (!srcByBase.has(base)) srcByBase.set(base, [])
    srcByBase.get(base).push({ file, exports: exps })
  }
  const tgtByBase = new Map()
  for (const [file, exps] of targetModules) {
    const base = path.posix.basename(file)
    if (!tgtByBase.has(base)) tgtByBase.set(base, [])
    tgtByBase.get(base).push({ file, exports: exps })
  }

  const sameName = []
  let identical = 0
  for (const base of [...srcByBase.keys()].sort(byCodepoint)) {
    if (!tgtByBase.has(base)) continue
    for (const s of srcByBase.get(base)) {
      for (const t of tgtByBase.get(base)) {
        const sNames = new Set(s.exports.keys())
        const tNames = new Set(t.exports.keys())
        const onlySource = [...sNames].filter((n) => !tNames.has(n)).sort(byCodepoint)
        const onlyTarget = [...tNames].filter((n) => !sNames.has(n)).sort(byCodepoint)
        if (onlySource.length === 0 && onlyTarget.length === 0) {
          if (s.file === t.file) identical += 1
          continue
        }
        // Only the pair at the same path, or where one side has exactly one
        // candidate: comparing every N x M basename pair produces noise that
        // says nothing about either repository.
        if (s.file !== t.file && (srcByBase.get(base).length > 1 || tgtByBase.get(base).length > 1)) continue
        sameName.push({
          basename: base,
          source_path: s.file,
          target_path: t.file,
          same_path: s.file === t.file,
          source_exports: sNames.size,
          target_exports: tNames.size,
          only_in_source: onlySource.slice(0, 12),
          only_in_target: onlyTarget.slice(0, 12),
          verdict: 'DECIDED — the same module name exports different things on the two sides',
        })
      }
    }
  }

  const symbolKinds = []
  const srcSymbols = new Map()
  for (const [file, exps] of sourceModules) for (const [n, k] of exps) if (!srcSymbols.has(n)) srcSymbols.set(n, { kind: k, file })
  const tgtSymbols = new Map()
  for (const [file, exps] of targetModules) for (const [n, k] of exps) if (!tgtSymbols.has(n)) tgtSymbols.set(n, { kind: k, file })
  for (const name of [...srcSymbols.keys()].sort(byCodepoint)) {
    const s = srcSymbols.get(name)
    const t = tgtSymbols.get(name)
    if (!t) continue
    if (s.kind === t.kind || s.kind === 're-export' || t.kind === 're-export') continue
    symbolKinds.push({
      symbol: name,
      source_path: s.file,
      source_kind: s.kind,
      target_path: t.file,
      target_kind: t.kind,
      verdict: 'DECIDED — one identifier, two declaration kinds',
    })
  }

  const own = (exps) => new Set([...exps.keys()].filter((n) => !FRAMEWORK_CONTRACT_EXPORTS.has(n)))
  const candidates = []
  const targetSets = [...targetModules].map(([file, exps]) => ({ file, base: path.posix.basename(file), names: own(exps) }))
  for (const [file, exps] of sourceModules) {
    const names = own(exps)
    if (names.size < MIN_CANDIDATE_EXPORTS) continue // a three-name module matches another by accident
    const base = path.posix.basename(file)
    for (const t of targetSets) {
      if (t.base === base) continue
      if (t.names.size < MIN_CANDIDATE_EXPORTS) continue
      const score = jaccard(names, t.names)
      if (score < SYNONYM_THRESHOLD) continue
      candidates.push({
        source_path: file,
        target_path: t.file,
        jaccard: Number(score.toFixed(3)),
        shared: [...names].filter((n) => t.names.has(n)).sort(byCodepoint).slice(0, 8),
        verdict: 'CANDIDATE — a metric proposed this pair; a human decides whether it is one concept',
      })
    }
  }
  candidates.sort((a, b) => b.jaccard - a.jaccard || byCodepoint(a.source_path, b.source_path) || byCodepoint(a.target_path, b.target_path))

  // One row per unordered pair of module names.
  //
  // Both repositories carry `generate-roster.mjs` and `roster-data.sample.mjs`,
  // so the same pair appears twice — once as source-A/target-B and once as
  // source-B/target-A. That is one question, not two, and reporting it twice
  // would inflate the count of a table whose whole value is its size.
  const seenPair = new Set()
  const deduped = candidates.filter((c) => {
    const key = [path.posix.basename(c.source_path), path.posix.basename(c.target_path)].sort(byCodepoint).join('::')
    if (seenPair.has(key)) return false
    seenPair.add(key)
    return true
  })

  return {
    source_modules: sourceModules.size,
    target_modules: targetModules.size,
    identical_modules: identical,
    same_name_different_shape: sameName.sort((a, b) => byCodepoint(a.basename, b.basename) || byCodepoint(a.target_path, b.target_path)),
    same_symbol_different_kind: symbolKinds,
    candidate_synonyms_total: deduped.length,
    candidate_synonyms: deduped.slice(0, CANDIDATE_CAP),
    candidate_pairs_before_dedupe: candidates.length,
    threshold: SYNONYM_THRESHOLD,
    minimum_exports: MIN_CANDIDATE_EXPORTS,
    excluded_from_similarity: [...FRAMEWORK_CONTRACT_EXPORTS].sort(byCodepoint),
  }
}

// ══════════════════════ SIMON-000-006 — disposition matrix ══════════════════════

/**
 * The bible's eight labels, and — stated rather than implied — which four a
 * file-list comparison can actually decide.
 *
 * `SOURCE_SUPERIOR`, `CONFIG_ONLY`, `DATA_ONLY` and `DEPRECATE_AFTER_PROOF` are
 * judgements about quality, intent and proof. Nothing derivable from two file
 * lists supports them, so this generator never assigns one. A row that needs
 * one is `UNKNOWN` with the reason printed — the bible's own eighth label, and
 * the honest answer. Collapsing "we looked and it is PARENT_CANONICAL" into
 * "we could not look" would be the exact defect this programme's central rule
 * names.
 */
export const DISPOSITIONS = [
  { label: 'PARENT_CANONICAL', assignable: true, meaning: 'the target holds this capability and every source path for it' },
  { label: 'MERGE_REQUIRED', assignable: true, meaning: 'both sides hold it and the source has paths the target does not' },
  { label: 'REIMPLEMENT_REQUIRED', assignable: true, meaning: 'the source holds it and the target’s probe matched nothing' },
  { label: 'UNKNOWN', assignable: true, meaning: 'neither side matched, or the label needs a judgement this evidence cannot make' },
  { label: 'SOURCE_SUPERIOR', assignable: false, meaning: 'a quality judgement — never auto-assigned' },
  { label: 'CONFIG_ONLY', assignable: false, meaning: 'a judgement about intent — never auto-assigned' },
  { label: 'DATA_ONLY', assignable: false, meaning: 'a judgement about intent — never auto-assigned' },
  { label: 'DEPRECATE_AFTER_PROOF', assignable: false, meaning: 'requires the proof to exist first — never auto-assigned' },
]

export function disposeCapability(sourceFiles, targetFiles, probe) {
  const match = (files) => files.filter((f) => probe.pattern.test(f) && !(probe.exclude && probe.exclude.test(f))).sort(byCodepoint)
  const s = match(sourceFiles)
  const t = match(targetFiles)
  const tSet = new Set(t)
  const sourceOnly = s.filter((f) => !tSet.has(f))
  let disposition
  let why
  if (s.length === 0 && t.length === 0) {
    disposition = 'UNKNOWN'
    why = 'the probe matched nothing on either side; a search that finds nothing is not a proof of absence'
  } else if (s.length > 0 && t.length === 0) {
    disposition = 'REIMPLEMENT_REQUIRED'
    why = 'the source has paths for this capability and the target has none'
  } else if (s.length === 0) {
    disposition = 'PARENT_CANONICAL'
    why = 'only the target has paths for this capability'
  } else if (sourceOnly.length === 0) {
    disposition = 'PARENT_CANONICAL'
    why = 'every source path for this capability is already present in the target tree at the same path'
  } else {
    disposition = 'MERGE_REQUIRED'
    why = `${sourceOnly.length} source path(s) for this capability are absent from the target tree`
  }
  return {
    capability: probe.capability,
    // Both patterns, as text, so the guard test can rebuild them and recount
    // from the baseline file lists with its own code rather than calling this
    // function and agreeing with itself.
    pattern: String(probe.pattern),
    exclude: probe.exclude ? String(probe.exclude) : null,
    source_matches: s.length,
    target_matches: t.length,
    source_only: sourceOnly.length,
    source_only_paths: sourceOnly.slice(0, 6),
    disposition,
    why,
  }
}

export function disposePackages(sourceWorkspaces, targetWorkspaces) {
  const tgt = new Map(targetWorkspaces.map((w) => [w.name, w]))
  const src = new Map(sourceWorkspaces.map((w) => [w.name, w]))
  const rows = []
  for (const name of [...src.keys()].sort(byCodepoint)) {
    const s = src.get(name)
    const t = tgt.get(name)
    if (!t) {
      rows.push({
        package: name,
        source_manifest: s.manifest,
        target_manifest: null,
        disposition: 'REIMPLEMENT_REQUIRED',
        why: 'no target workspace declares this package name',
      })
      continue
    }
    const missingScripts = s.scripts.filter((x) => !t.scripts.includes(x))
    const missingDeps = s.declared_dependencies.filter((x) => !t.declared_dependencies.includes(x))
    if (missingScripts.length === 0 && missingDeps.length === 0) {
      rows.push({
        package: name,
        source_manifest: s.manifest,
        target_manifest: t.manifest,
        disposition: 'PARENT_CANONICAL',
        why: 'the target manifest declares every script and dependency the source one does',
      })
    } else {
      rows.push({
        package: name,
        source_manifest: s.manifest,
        target_manifest: t.manifest,
        disposition: 'MERGE_REQUIRED',
        why: `the target manifest is missing ${missingScripts.length} script(s) and ${missingDeps.length} dependency(ies) the source declares`,
        missing_scripts: missingScripts.slice(0, 8),
        missing_dependencies: missingDeps.slice(0, 8),
      })
    }
  }
  for (const name of [...tgt.keys()].sort(byCodepoint)) {
    if (src.has(name)) continue
    rows.push({
      package: name,
      source_manifest: null,
      target_manifest: tgt.get(name).manifest,
      disposition: 'PARENT_CANONICAL',
      why: 'a target-only workspace; the source has nothing to merge',
    })
  }
  return rows
}

// ══════════════════════ SIMON-000-007 — import risk ══════════════════════

export const GENERATED_PATTERNS = [
  { pattern: /\.generated\.[a-z]+$/, why: 'named as generated' },
  { pattern: /(^|\/)(?:dist|build|out|coverage|\.next)\//, why: 'a build output directory' },
  { pattern: /\.min\.(?:js|css)$/, why: 'a minified artifact' },
  { pattern: /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/, why: 'a resolver lockfile' },
  { pattern: /(^|\/)prisma\/(?:generated|client)\//, why: 'a generated Prisma client' },
]

export const VENDORED_PATTERNS = [
  { pattern: /(^|\/)(?:vendor|third_party|third-party|external)\//, why: 'a conventional vendoring directory' },
  { pattern: /(^|\/)node_modules\//, why: 'installed dependencies committed into the tree' },
  { pattern: /^Tier1\//, why: 'the pilot’s own data directory — carried in the tree, never opened here' },
]

/**
 * Paths whose NAME says they carry credential material.
 *
 * Indicators, not values. Nothing matched here is ever opened: the finding is
 * that a path with this shape exists at all, and opening it to "confirm" would
 * be the leak. `.env.example` is deliberately not matched — its whole purpose
 * is names without values, and `tests/security/repository-hygiene.test.mjs`
 * already asserts it stays that way.
 */
export const SECRET_INDICATOR_PATTERNS = [
  { pattern: /(^|\/)\.env(?:\.local|\.production|\.development)?$/, why: 'an environment file carries values' },
  { pattern: /\.(?:pem|p12|pfx|jks|keystore|key)$/, why: 'private key or certificate material' },
  { pattern: /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/, why: 'an SSH private key' },
  { pattern: /\.tfstate(?:\.|$)/, why: 'Terraform state carries resource attributes and sometimes secrets' },
  { pattern: /(^|\/)(?:credentials|secrets?)\.(?:json|ya?ml|ini|txt)$/, why: 'named as credentials' },
  { pattern: /\.npmrc$/, why: 'may carry a registry auth token' },
]

export const BINARY_EXTENSIONS =
  /\.(?:png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|7z|rar|xls|xlsx|doc|docx|ppt|pptx|woff2?|ttf|eot|otf|mp4|mov|mp3|wav|so|dll|dylib|exe|node|wasm|jar|class|bin|db|sqlite3?)$/i

export const LARGE_FILE_BYTES = 1024 * 1024

/** Blob sizes at a commit, from `git ls-tree -r -l`. Sizes are safe evidence; contents are not. */
export function blobSizes(sha) {
  const lines = gitLines(['ls-tree', '-r', '-l', sha])
  if (lines === null) return null
  const out = new Map()
  for (const line of lines) {
    const m = line.match(/^\d{6}\s+blob\s+[0-9a-f]+\s+(\d+|-)\t(.+)$/)
    if (!m) continue
    out.set(posix(m[2]), m[1] === '-' ? null : Number(m[1]))
  }
  return out
}

/**
 * Every path ever ADDED on the source branch, with the commit that added it.
 *
 * This is what "secret history indicators" means: a `.env` deleted three
 * commits later is still in the history and still has to be rotated. Reading
 * the diff of added names answers that; opening any of them would not be
 * answering it, it would be repeating the leak.
 */
export function everAddedPaths(rev) {
  const out = git(['log', '--format=%x00%H %ad', '--date=short', '--diff-filter=A', '--name-only', rev])
  if (out === null) return null
  const added = new Map()
  for (const chunk of out.split('\u0000')) {
    if (!chunk.trim()) continue
    const [head, ...names] = chunk.split('\n')
    const [sha, date] = head.trim().split(' ')
    for (const n of names) {
      const p = posix(n.trim())
      if (!p) continue
      if (!added.has(p)) added.set(p, { first_added_commit: sha, first_added_date: date })
    }
  }
  return added
}

/**
 * `npm audit` against the source lockfile, without installing anything.
 *
 * `--package-lock-only` resolves the tree from `package-lock.json` and asks the
 * registry's advisory endpoint; it does not run an install and does not execute
 * a lifecycle script. The lockfile and manifest are extracted out of the pinned
 * commit into a temporary directory, so nothing in this repository is touched.
 *
 * A failure is UNKNOWN with the command, never "no vulnerabilities". Those are
 * different answers and this programme's central rule is that they must not be
 * collapsed.
 */
export function auditSource(sha) {
  const cmd = 'npm audit --package-lock-only --json'
  const dir = path.join(os.tmpdir(), `simon-audit-${sha.slice(0, 12)}`)
  try {
    fs.mkdirSync(dir, { recursive: true })
    for (const f of ['package.json', 'package-lock.json']) {
      const text = git(['show', `${sha}:${f}`])
      if (text === null) return unknown(`git show ${sha}:${f}`, 'the source lockfile')
      fs.writeFileSync(path.join(dir, f), text)
    }
    let stdout
    try {
      // `shell: true` on Windows, and only there.
      //
      // Node 22 refuses to `execFile` a `.cmd` without a shell — the fix for
      // CVE-2024-27980 — and `npm` on Windows is `npm.cmd`. Without this the
      // spawn fails with EINVAL before npm is ever reached, which reads exactly
      // like "the registry did not answer" and would have been recorded as
      // UNKNOWN forever. The argument vector is three fixed literals with no
      // interpolation, so the shell has nothing to re-parse.
      stdout = execFileSync('npm', ['audit', '--package-lock-only', '--json'], {
        cwd: dir,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 180_000,
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: process.platform === 'win32',
      })
    } catch (err) {
      // `npm audit` exits 1 when it finds something. That is a successful read.
      stdout = typeof err.stdout === 'string' ? err.stdout : null
      if (!stdout) return unknown(cmd, 'the source dependency advisories')
    }
    const report = JSON.parse(stdout)
    const counts = report.metadata?.vulnerabilities ?? {}
    const packages = Object.entries(report.vulnerabilities ?? {})
      .map(([name, v]) => ({
        package: name,
        severity: v.severity,
        direct: v.isDirect === true,
        advisories: [...new Set((v.via ?? []).filter((x) => typeof x === 'object' && x.url).map((x) => x.url))].sort(byCodepoint),
      }))
      .sort((a, b) => byCodepoint(a.package, b.package))
    return {
      ok: true,
      command: cmd,
      counts: {
        critical: counts.critical ?? 0,
        high: counts.high ?? 0,
        moderate: counts.moderate ?? 0,
        low: counts.low ?? 0,
        info: counts.info ?? 0,
        total: counts.total ?? 0,
      },
      dependencies_resolved: report.metadata?.dependencies?.total ?? null,
      packages,
    }
  } catch {
    return unknown(cmd, 'the source dependency advisories')
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* a temp directory that will not delete is not a finding about the repositories */
    }
  }
}

/**
 * Node's release schedule, as a stated reference rather than a derived fact.
 *
 * Everything else in this file is read out of the two repositories. This is
 * not: it is an external calendar, so it is labelled, dated and cited, and the
 * verdict it produces says which table it came from. A runtime is "unsupported"
 * here if its end-of-life date is before this table's `as_of`.
 */
export const NODE_RELEASE_TABLE = {
  as_of: '2026-08-17',
  source: 'https://github.com/nodejs/release#release-schedule',
  end_of_life: { 14: '2023-04-30', 16: '2023-09-11', 18: '2025-04-30', 20: '2026-04-30', 22: '2027-04-30', 24: '2028-04-30' },
}

const DECLARED_RUNTIME_PROBES = [
  { where: 'package.json engines.node', pattern: /"node"\s*:\s*"([^"]+)"/g, files: /(^|\/)package\.json$/ },
  { where: '.nvmrc', pattern: /^\s*v?(\d[\w.]*)\s*$/gm, files: /(^|\/)\.nvmrc$/ },
  { where: 'Dockerfile FROM node', pattern: /^\s*FROM\s+node:([\w.-]+)/gim, files: /(^|\/)Dockerfile$/ },
  { where: 'workflow node-version', pattern: /node-version:\s*'?"?([\w.x]+)'?"?/g, files: /^\.github\/workflows\/.*\.ya?ml$/ },
  { where: 'terraform lambda runtime', pattern: /runtime\s*=\s*"([^"]+)"/g, files: /\.tf$/ },
]

const majorOf = (spec) => {
  const m = String(spec).match(/(\d+)/)
  return m ? Number(m[1]) : null
}

export function declaredRuntimes(files, contentOf) {
  // Keyed, not appended: a Dockerfile with three build stages declares the same
  // `FROM node:22-alpine` three times and a CI workflow pins the same version in
  // every job. Three identical rows are one fact reported three times, and it
  // reads as three problems.
  const rows = new Map()
  for (const probe of DECLARED_RUNTIME_PROBES) {
    for (const f of files.filter((x) => probe.files.test(x) && !NOT_SCANNED.some((n) => n.pattern.test(x)))) {
      const text = contentOf(f)
      if (!text) continue
      const re = new RegExp(probe.pattern.source, probe.pattern.flags)
      let m
      while ((m = re.exec(text.split('\r\n').join('\n'))) !== null) {
        const isNode = /node|engines|nvmrc/i.test(probe.where)
        const major = majorOf(m[1])
        const eol = isNode && major !== null ? NODE_RELEASE_TABLE.end_of_life[major] ?? null : null
        const key = `${f}${probe.where}${m[1]}`
        const existing = rows.get(key)
        if (existing) {
          existing.declarations += 1
          continue
        }
        rows.set(key, {
          file: f,
          where: probe.where,
          declared: m[1],
          declarations: 1,
          node_major: isNode ? major : null,
          end_of_life: eol,
          unsupported: isNode && eol !== null ? eol < NODE_RELEASE_TABLE.as_of : false,
        })
      }
    }
  }
  return [...rows.values()].sort(
    (a, b) => byCodepoint(a.file, b.file) || byCodepoint(a.where, b.where) || byCodepoint(a.declared, b.declared),
  )
}

export function importRisk(baseline, src, tgt) {
  const sizes = blobSizes(baseline.source.pinned_commit)
  const added = everAddedPaths(SOURCE_REF)

  const matchAll = (files, patterns) =>
    files
      .flatMap((f) => {
        const hit = patterns.find((p) => p.pattern.test(f))
        return hit ? [{ path: f, why: hit.why }] : []
      })
      .sort((a, b) => byCodepoint(a.path, b.path))

  const licenseFiles = baseline.source.files.filter((f) => /(^|\/)(?:LICEN[CS]E|COPYING|NOTICE)(?:\.[a-z]+)?$/i.test(f))
  const manifestLicenses = src.manifests.map((m) => ({
    manifest: m.file,
    name: m.json.name ?? null,
    license: m.json.license ?? null,
    private: m.json.private === true,
    verdict:
      m.json.license
        ? 'declared'
        : m.json.private === true
          ? 'no license declared — private, so npm does not require one; an import still needs a stated basis'
          : 'no license declared and not marked private — unlicensed by default',
  }))

  const binaries = baseline.source.files
    .filter((f) => BINARY_EXTENSIONS.test(f))
    .map((f) => ({ path: f, bytes: sizes?.get(f) ?? null, classified_by: 'extension' }))
    .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || byCodepoint(a.path, b.path))

  const large = sizes
    ? [...sizes.entries()]
        .filter(([, n]) => n !== null && n >= LARGE_FILE_BYTES)
        .map(([p, n]) => ({ path: p, bytes: n }))
        .sort((a, b) => b.bytes - a.bytes || byCodepoint(a.path, b.path))
    : unknown(`git ls-tree -r -l ${baseline.source.pinned_commit}`, 'source blob sizes')

  const indicatorsNow = matchAll(baseline.source.files, SECRET_INDICATOR_PATTERNS)
  const indicatorsEver = added
    ? [...added.keys()]
        .flatMap((p) => {
          const hit = SECRET_INDICATOR_PATTERNS.find((s) => s.pattern.test(p))
          if (!hit) return []
          return [
            {
              path: p,
              why: hit.why,
              ...added.get(p),
              present_at_pinned_commit: baseline.source.files.includes(p),
            },
          ]
        })
        .sort((a, b) => byCodepoint(a.path, b.path))
    : unknown(`git log --diff-filter=A --name-only ${SOURCE_REF}`, 'paths ever added on the source branch')

  return {
    licenses: {
      license_files: licenseFiles,
      manifests: manifestLicenses,
      dependency_licenses: unknown(
        'npm view <package> license',
        'the license of each declared source dependency — resolvable only per package against the registry, and this generator does not install',
      ),
    },
    generated_artifacts: matchAll(baseline.source.files, GENERATED_PATTERNS),
    vendored_code: matchAll(baseline.source.files, VENDORED_PATTERNS),
    binaries: { total: binaries.length, bytes: binaries.reduce((n, b) => n + (b.bytes ?? 0), 0), files: binaries },
    large_files: { threshold_bytes: LARGE_FILE_BYTES, files: large },
    secret_history_indicators: {
      at_pinned_commit: indicatorsNow,
      ever_added: indicatorsEver,
      never_opened: true,
      note: 'Matched by path name only. No file in this list is opened by this generator or by its tests.',
    },
    vulnerable_dependencies: auditSource(baseline.source.pinned_commit),
    runtimes: {
      reference_table: NODE_RELEASE_TABLE,
      source: declaredRuntimes(baseline.source.files, src.contentOf),
      target: declaredRuntimes(baseline.target.files, tgt.contentOf),
    },
  }
}

// ══════════════════════ collection ══════════════════════

function sideFromCommit(sha, files) {
  const wanted = files.filter(
    (f) => (SCANNABLE.test(f) || /(^|\/)Dockerfile$/.test(f)) && !NOT_SCANNED.some((n) => n.pattern.test(f)),
  )
  const blobs = readBlobs(sha, wanted)
  const manifests = files
    .filter((f) => (f === 'package.json' || f.endsWith('/package.json')) && !/node_modules\//.test(f))
    .map((f) => {
      let json = {}
      try {
        json = JSON.parse(blobs.get(f) ?? '{}')
      } catch {
        json = {}
      }
      return { file: f, json }
    })
  return { sha, contentOf: (f) => blobs.get(f) ?? null, manifests }
}

export function collect() {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_SNAPSHOT), 'utf8'))
  const src = sideFromCommit(baseline.source.pinned_commit, baseline.source.files)
  const tgt = sideFromCommit(baseline.target.head_commit, baseline.target.files)

  const codeOf = (sha, files, contentOf) => {
    const out = new Map()
    for (const f of files) {
      if (!CODE.test(f) || NOT_CODE_OF_INTEREST.test(f)) continue
      const text = contentOf(f)
      if (!text) continue
      const exps = exportsOf(text)
      if (exps.size === 0) continue
      out.set(f, exps)
    }
    return out
  }

  return {
    schema: 1,
    generated_by: 'tools/simon-convergence-inventory.mjs',
    closes: ['SIMON-000-004', 'SIMON-000-005', 'SIMON-000-006', 'SIMON-000-007'],
    observed_at: new Date().toISOString().slice(0, 10),
    baseline: {
      snapshot: BASELINE_SNAPSHOT,
      source_commit: baseline.source.pinned_commit,
      target_commit: baseline.target.head_commit,
      source_files: baseline.source.files.length,
      target_files: baseline.target.files.length,
      note:
        'Both trees are read at the commits the baseline inventory pinned, not at whatever a ref ' +
        'resolves to now, so the two artifacts describe the same two trees by construction.',
    },
    assumptions: {
      probes: [...ASSUMPTION_PROBES, ...PATH_PROBES].map((p) => ({
        id: p.id,
        kind: p.kind,
        pattern: String(p.pattern),
        reveal: p.reveal,
        in_path: PATH_PROBES.includes(p),
        why: p.why,
      })),
      not_scanned: NOT_SCANNED.map((n) => ({ pattern: String(n.pattern), why: n.why })),
      source: scanAssumptions(baseline.source.files, src.contentOf),
      target: scanAssumptions(baseline.target.files, tgt.contentOf),
    },
    concepts: compareConcepts(
      codeOf(src.sha, baseline.source.files, src.contentOf),
      codeOf(tgt.sha, baseline.target.files, tgt.contentOf),
    ),
    disposition: {
      legend: DISPOSITIONS,
      capabilities: PROBES.map((p) => disposeCapability(baseline.source.files, baseline.target.files, p)),
      packages: disposePackages(baseline.source.workspaces, baseline.target.workspaces),
    },
    import_risk: importRisk(baseline, src, tgt),
  }
}

// ══════════════════════ rendering ══════════════════════

const esc = (s) => String(s).split('|').join('\\|')
const code = (s) => `\`${esc(s)}\``
const list = (xs) => (xs.length ? xs.map(code).join(' ') : '—')

const cell = (v) =>
  v && typeof v === 'object' && v.ok === false ? `UNKNOWN — ${code(v.command)} did not answer` : String(v)

const HEADER = (title, closes, lede) => `# ${title}

**Generated** by \`node tools/simon-convergence-inventory.mjs\` from
\`${SNAPSHOT}\`. Do not edit by hand — \`tests/simon-convergence-inventory.test.mjs\`
re-renders this file from the snapshot and reds on any difference.

Closes ${closes}. Both repositories are read at the commits pinned by
\`${BASELINE_SNAPSHOT}\`; the pilot is never cloned, checked out or pushed to
from here.

${lede}

`

export function renderAssumptions(d) {
  const a = d.assumptions
  const r = []
  r.push(
    HEADER(
      'Simon absorption — hard-coded tenant assumptions',
      '**SIMON-000-004**',
      `Every probe below is a pattern run over a real file list at a pinned commit, and every row
names a path and the line numbers inside it. A probe may print what it matched only when its
pattern is a closed set of literal tokens — a season, a role name, an AWS region, an ARN service
prefix — and the ones whose patterns have an open capture print \`#\` of the matched length
instead. So no student, staff or applicant data can reach this file, and no value appears for any
identifier a probe could not have enumerated in advance.`,
    ),
  )
  r.push(`Observed ${d.observed_at}. Source \`${d.baseline.source_commit}\`, target \`${d.baseline.target_commit}\`.\n`)

  r.push('## What was scanned\n')
  r.push('| Side | Files in tree | Scanned | Excluded | Hits |')
  r.push('| --- | --- | --- | --- | --- |')
  for (const which of ['source', 'target']) {
    const s = a[which]
    r.push(`| ${which} | ${s.files_offered} | ${s.files_scanned} | ${s.files_skipped} | ${s.total_hits} |`)
  }
  r.push('')
  r.push('Excluded on purpose, with the reason:\n')
  r.push('| Pattern | Why |')
  r.push('| --- | --- |')
  for (const n of a.not_scanned) r.push(`| ${code(n.pattern)} | ${n.why} |`)
  r.push('')

  r.push('## The assumptions the requirement names, one row each\n')
  r.push('| Assumption | Probes | Source hits | Source files | Target hits | Target files |')
  r.push('| --- | --- | --- | --- | --- | --- |')
  for (const k of a.source.by_kind) {
    const t = a.target.by_kind.find((x) => x.kind === k.kind)
    const probes = a.probes.filter((p) => p.kind === k.kind).map((p) => p.id)
    r.push(`| ${k.kind} | ${list(probes)} | ${k.hits} | ${k.files} | ${t?.hits ?? 0} | ${t?.files ?? 0} |`)
  }
  r.push('')

  r.push('## The hiding places the requirement names, one row each\n')
  r.push(
    'A finding is attributed to the **first** place whose pattern matches its path, so these rows\n' +
      'partition the hits exactly once and the column sums equal the totals above.\n',
  )
  r.push('| Place | Source hits | Source files | Target hits | Target files | Target evidence |')
  r.push('| --- | --- | --- | --- | --- | --- |')
  for (const p of a.source.by_place) {
    const t = a.target.by_place.find((x) => x.place === p.place)
    r.push(`| ${p.place} | ${p.hits} | ${p.files} | ${t?.hits ?? 0} | ${t?.files ?? 0} | ${list(t?.evidence ?? [])} |`)
  }
  r.push('')

  r.push('## Every probe, its pattern, and how much of a match it may print\n')
  r.push('| Probe | Assumption | Reveals | Pattern | Why it matters |')
  r.push('| --- | --- | --- | --- | --- |')
  for (const p of a.probes) {
    r.push(`| ${code(p.id)} | ${p.kind} | ${p.reveal}${p.in_path ? ' (path)' : ''} | ${code(p.pattern)} | ${p.why} |`)
  }
  r.push('')

  for (const which of ['source', 'target']) {
    const s = a[which]
    r.push(`## ${which} — the twenty files carrying the most assumptions\n`)
    r.push(`${s.by_file.length} files carry at least one. The complete per-file, per-line list is in the snapshot.\n`)
    r.push('| File | Place | Hits | Assumptions |')
    r.push('| --- | --- | --- | --- |')
    for (const f of s.by_file.slice(0, 20)) r.push(`| ${code(f.file)} | ${f.place} | ${f.hits} | ${f.kinds.join(', ')} |`)
    r.push('')
  }

  r.push('## Honest limits\n')
  r.push(
    '- A probe is a pattern, not a compiler. It locates a literal; it does not decide whether that\n' +
      '  literal is load-bearing. `club` in a comment and `club` in a permission check both count here,\n' +
      '  and separating them is adjudication, not search.\n' +
      '- A hit is not automatically a defect. The point of the table is that the list exists and is\n' +
      '  re-derivable, so `SIMON-GATE-010` can be argued from evidence instead of from memory.\n' +
      '- `docs/` is excluded. An assumption that exists only in prose is not runtime behaviour, and\n' +
      '  the generated inventories there mention the tenant thousands of times.\n' +
      '- Non-scannable extensions are not searched: spreadsheets, PDFs and images could hold an\n' +
      '  assumption and this scan would not see it. `Tier1/` is listed by path and never opened.\n' +
      '- `aws-account-id` matches any bare twelve-digit run. An AWS account id has that shape and so\n' +
      '  do other things, so a hit there is a shape to look at, not an account. It is masked either\n' +
      '  way, which is why the ambiguity costs nothing.\n' +
      '- `domain-literal` prints the hostname it matched. A hostname is a public DNS name, not a\n' +
      '  credential, and every one this found is already committed in this repository — the CloudFront\n' +
      '  domain is in `README.md` and six workflows. Anything account-scoped is caught by\n' +
      '  `resource-identifier` or `aws-account-id` instead, and both of those mask.\n',
  )
  return `${r.join('\n')}\n`
}

export function renderConcepts(d) {
  const c = d.concepts
  const r = []
  r.push(
    HEADER(
      'Simon absorption — duplicate and colliding business concepts',
      '**SIMON-000-005**',
      `Three findings, kept apart because they are three claims of different strength. Two are
decided by comparing two lists. The third is a similarity metric proposing candidates, labelled
\`CANDIDATE\` in every row, with its threshold printed so the list can be reproduced and argued
with.`,
    ),
  )
  r.push(
    `Observed ${d.observed_at}. ${c.source_modules} source modules and ${c.target_modules} target modules ` +
      `declare at least one export; ${c.identical_modules} pairs at the same path export exactly the same names.\n`,
  )

  r.push('## Same name, different shape — DECIDED\n')
  if (c.same_name_different_shape.length === 0) r.push('None.\n')
  else {
    r.push('| Module | Source | Target | Same path | Only in source | Only in target |')
    r.push('| --- | --- | --- | --- | --- | --- |')
    for (const x of c.same_name_different_shape) {
      r.push(
        `| ${code(x.basename)} | ${code(x.source_path)} | ${code(x.target_path)} | ${x.same_path ? 'yes' : 'no'} | ` +
          `${list(x.only_in_source)} | ${list(x.only_in_target)} |`,
      )
    }
    r.push('')
  }

  r.push('## One identifier, two declaration kinds — DECIDED\n')
  if (c.same_symbol_different_kind.length === 0) r.push('None.\n')
  else {
    r.push('| Symbol | Source kind | Source | Target kind | Target |')
    r.push('| --- | --- | --- | --- | --- |')
    for (const x of c.same_symbol_different_kind) {
      r.push(
        `| ${code(x.symbol)} | ${x.source_kind} | ${code(x.source_path)} | ${x.target_kind} | ${code(x.target_path)} |`,
      )
    }
    r.push('')
  }

  r.push('## Different names, overlapping shape — CANDIDATE\n')
  r.push(
    `Differently-named module pairs, each side exporting at least ${c.minimum_exports} names of its ` +
      `own, that share Jaccard ≥ ${c.threshold} of them: ${c.candidate_synonyms_total}. The ` +
      `${c.candidate_synonyms.length} strongest are below, and the full list is in the snapshot. ` +
      `**Nothing here is decided** — a metric cannot know whether two modules are one concept.\n`,
  )
  r.push(
    `Framework-dictated names are excluded from the metric and only from the metric: ` +
      `${list(c.excluded_from_similarity)}. Every Next.js page exports \`default\`, so leaving them in ` +
      `scored unrelated pages at 1.0 for agreeing about a framework contract. ` +
      `${c.candidate_pairs_before_dedupe} ordered pairs collapse to ${c.candidate_synonyms_total} once a ` +
      `pair carried by both trees is counted once.\n`,
  )
  if (c.candidate_synonyms.length === 0) r.push('None above the threshold.\n')
  else {
    r.push('| Jaccard | Source | Target | Shared exports |')
    r.push('| --- | --- | --- | --- |')
    for (const x of c.candidate_synonyms) {
      r.push(`| ${x.jaccard} | ${code(x.source_path)} | ${code(x.target_path)} | ${list(x.shared)} |`)
    }
    r.push('')
  }

  r.push('## Honest limits\n')
  r.push(
    '- The export scan is textual, like the baseline generator’s import scan. A name produced by a\n' +
      '  macro, a barrel re-export chain or a runtime assignment is invisible to it.\n' +
      '- The two repositories share history, so most same-named modules ARE the same module. That is\n' +
      '  why the decided tables report only the pairs that differ, and why the identical count is\n' +
      '  printed above rather than as rows.\n' +
      '- A Jaccard candidate is a question, not an answer. Adjudicating one belongs to SIMON-010-001,\n' +
      '  which selects the canonical implementation for each shared capability.\n',
  )
  return `${r.join('\n')}\n`
}

export function renderDisposition(d) {
  const s = d.disposition
  const r = []
  r.push(
    HEADER(
      'Simon absorption — capability and package disposition',
      '**SIMON-000-006**',
      `Every row carries one label from the bible's own enumeration. Four of the eight labels are
assignable from a file-list comparison and four are not; the legend says which, and a row needing
a judgement this evidence cannot make is \`UNKNOWN\` with the reason printed rather than a guess
wearing a label.`,
    ),
  )
  r.push(`Observed ${d.observed_at}.\n`)

  r.push('## The eight labels, and which of them this evidence can assign\n')
  r.push('| Label | Auto-assignable | Meaning here |')
  r.push('| --- | --- | --- |')
  for (const l of s.legend) r.push(`| ${code(l.label)} | ${l.assignable ? 'yes' : 'no — human adjudication'} | ${l.meaning} |`)
  r.push('')

  const tally = (rows) => {
    const counts = new Map()
    for (const x of rows) counts.set(x.disposition, (counts.get(x.disposition) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => byCodepoint(a[0], b[0])).map(([k, v]) => `${k} ${v}`).join(', ')
  }

  r.push('## Capability by capability\n')
  r.push(`${s.capabilities.length} capabilities: ${tally(s.capabilities)}.\n`)
  r.push('| Capability | Source | Target | Source-only | Disposition | Why | Source-only evidence |')
  r.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const x of s.capabilities) {
    r.push(
      `| ${x.capability} | ${x.source_matches} | ${x.target_matches} | ${x.source_only} | ${code(x.disposition)} | ` +
        `${x.why} | ${list(x.source_only_paths)} |`,
    )
  }
  r.push('')

  r.push('## Package by package\n')
  r.push(`${s.packages.length} workspaces across both repositories: ${tally(s.packages)}.\n`)
  r.push('| Package | Source manifest | Target manifest | Disposition | Why | What is missing |')
  r.push('| --- | --- | --- | --- | --- | --- |')
  for (const x of s.packages) {
    const missing = [...(x.missing_scripts ?? []), ...(x.missing_dependencies ?? [])]
    r.push(
      `| ${code(x.package)} | ${x.source_manifest ? code(x.source_manifest) : '—'} | ` +
        `${x.target_manifest ? code(x.target_manifest) : '—'} | ${code(x.disposition)} | ${x.why} | ${list(missing)} |`,
    )
  }
  r.push('')

  r.push('## Honest limits\n')
  r.push(
    '- A capability disposition is computed from PATHS, not from behaviour. `PARENT_CANONICAL` here\n' +
      '  means the target tree holds every path the source probe matched — it does not mean the target\n' +
      '  implementation is as good, and it never claims to.\n' +
      '- The two repositories share history, which is why so many rows land on `PARENT_CANONICAL`:\n' +
      '  the parent was branched from the pilot, so most source paths are literally present here.\n' +
      '- `SOURCE_SUPERIOR`, `CONFIG_ONLY`, `DATA_ONLY` and `DEPRECATE_AFTER_PROOF` are never assigned\n' +
      '  by this generator, and the guard test asserts that. Assigning one is `SIMON-010-001`’s job.\n',
  )
  return `${r.join('\n')}\n`
}

export function renderImportRisk(d) {
  const k = d.import_risk
  const r = []
  r.push(
    HEADER(
      'Simon absorption — what importing the source repository carries with it',
      '**SIMON-000-007**',
      `Eight inventories the bible requires before an import begins. Every one is either read out of
the pinned source tree or recorded as \`UNKNOWN\` with the command that would answer it. Nothing in
the secret-indicator list is opened: the finding is that a path with that shape exists, and
confirming it by reading the file would be repeating the leak.`,
    ),
  )
  r.push(`Observed ${d.observed_at}. Source tree \`${d.baseline.source_commit}\`, ${d.baseline.source_files} tracked files.\n`)

  r.push('## Licenses\n')
  r.push(`License, copying and notice files in the source tree: ${list(k.licenses.license_files)}.\n`)
  r.push('| Manifest | Package | License | Private | Verdict |')
  r.push('| --- | --- | --- | --- | --- |')
  for (const m of k.licenses.manifests) {
    r.push(`| ${code(m.manifest)} | ${m.name ? code(m.name) : '—'} | ${m.license ? code(m.license) : '**none**'} | ${m.private ? 'yes' : 'no'} | ${m.verdict} |`)
  }
  r.push('')
  r.push(`Dependency licenses: ${cell(k.licenses.dependency_licenses)} — ${k.licenses.dependency_licenses.of}.\n`)

  r.push('## Generated artifacts tracked in the source tree\n')
  if (k.generated_artifacts.length === 0) r.push('None.\n')
  else {
    r.push('| Path | Why it counts as generated |')
    r.push('| --- | --- |')
    for (const x of k.generated_artifacts) r.push(`| ${code(x.path)} | ${x.why} |`)
    r.push('')
  }

  r.push('## Vendored code\n')
  if (k.vendored_code.length === 0) r.push('None.\n')
  else {
    r.push(`${k.vendored_code.length} paths. First 20:\n`)
    r.push('| Path | Why |')
    r.push('| --- | --- |')
    for (const x of k.vendored_code.slice(0, 20)) r.push(`| ${code(x.path)} | ${x.why} |`)
    r.push('')
  }

  r.push('## Binaries\n')
  r.push(`${k.binaries.total} files by extension, ${k.binaries.bytes} bytes in total. Largest 15:\n`)
  if (k.binaries.total === 0) r.push('None.\n')
  else {
    r.push('| Path | Bytes |')
    r.push('| --- | --- |')
    for (const x of k.binaries.files.slice(0, 15)) r.push(`| ${code(x.path)} | ${x.bytes ?? 'UNKNOWN'} |`)
    r.push('')
  }

  r.push(`## Large files (≥ ${k.large_files.threshold_bytes} bytes)\n`)
  if (!Array.isArray(k.large_files.files)) r.push(`${cell(k.large_files.files)}.\n`)
  else if (k.large_files.files.length === 0) r.push('None.\n')
  else {
    r.push('| Path | Bytes |')
    r.push('| --- | --- |')
    for (const x of k.large_files.files) r.push(`| ${code(x.path)} | ${x.bytes} |`)
    r.push('')
  }

  r.push('## Secret history indicators\n')
  r.push(`${k.secret_history_indicators.note}\n`)
  const now = k.secret_history_indicators.at_pinned_commit
  r.push(`At the pinned commit: ${now.length === 0 ? 'none' : `${now.length}`}.\n`)
  if (now.length) {
    r.push('| Path | Why |')
    r.push('| --- | --- |')
    for (const x of now) r.push(`| ${code(x.path)} | ${x.why} |`)
    r.push('')
  }
  const ever = k.secret_history_indicators.ever_added
  if (!Array.isArray(ever)) r.push(`Ever added on the source branch: ${cell(ever)}.\n`)
  else {
    r.push(`Ever added anywhere in the source branch's history: ${ever.length === 0 ? 'none' : `${ever.length}`}.\n`)
    if (ever.length) {
      r.push('| Path | First added | Date | Still present | Why |')
      r.push('| --- | --- | --- | --- | --- |')
      for (const x of ever) {
        r.push(
          `| ${code(x.path)} | ${code(x.first_added_commit)} | ${x.first_added_date} | ` +
            `${x.present_at_pinned_commit ? 'yes' : 'no — but it is still in the history'} | ${x.why} |`,
        )
      }
      r.push('')
    }
  }

  r.push('## Vulnerable dependencies\n')
  const v = k.vulnerable_dependencies
  if (v.ok !== true) r.push(`${cell(v)} — ${v.of}.\n`)
  else {
    r.push(
      `\`${v.command}\` against the pinned source lockfile resolved ${v.dependencies_resolved ?? 'UNKNOWN'} ` +
        `dependencies and reported ${v.counts.total}: ${v.counts.critical} critical, ${v.counts.high} high, ` +
        `${v.counts.moderate} moderate, ${v.counts.low} low, ${v.counts.info} info. No install was run and no ` +
        `lifecycle script executed; the manifest and lockfile were extracted from the pinned commit into a ` +
        `temporary directory and deleted afterwards.\n`,
    )
    if (v.packages.length) {
      r.push('| Package | Severity | Direct | Advisories |')
      r.push('| --- | --- | --- | --- |')
      for (const p of v.packages) r.push(`| ${code(p.package)} | ${p.severity} | ${p.direct ? 'yes' : 'no'} | ${list(p.advisories)} |`)
      r.push('')
    }
    r.push(
      'This is a moment, not a property: the advisory database changes under us, so the counts are\n' +
        'stamped with `observed_at` and the guard test does not re-derive them.\n',
    )
  }

  r.push('## Declared runtimes\n')
  r.push(
    `Node end-of-life dates below come from a stated external table (${code(k.runtimes.reference_table.source)}, ` +
      `as of ${k.runtimes.reference_table.as_of}), not from either repository. Everything else on this page is\n` +
      `read out of the trees.\n`,
  )
  for (const which of ['source', 'target']) {
    const rows = k.runtimes[which]
    r.push(`### ${which}\n`)
    if (rows.length === 0) r.push('No declared runtime found.\n')
    else {
      r.push('| File | Where | Declared | Times | Node major | End of life | Unsupported |')
      r.push('| --- | --- | --- | --- | --- | --- | --- |')
      for (const x of rows) {
        r.push(
          `| ${code(x.file)} | ${x.where} | ${code(x.declared)} | ${x.declarations} | ${x.node_major ?? '—'} | ` +
            `${x.end_of_life ?? '—'} | ${x.unsupported ? '**yes**' : 'no'} |`,
        )
      }
      r.push('')
    }
  }

  r.push('## Honest limits\n')
  r.push(
    '- "Binary" is decided by extension. A text file with a binary extension would be misfiled here,\n' +
      '  and a binary with a `.txt` name would be missed.\n' +
      '- The secret-indicator lists are name-shaped. A credential pasted into a `.ts` file is not\n' +
      '  matched by either of them, and finding that needs a content scan this generator does not run.\n' +
      '- `git log --diff-filter=A` sees the branch reachable from the pinned ref. A path added on a\n' +
      '  branch that was never merged is not in it.\n' +
      '- Dependency licenses are `UNKNOWN`, not "permissive". Answering them needs a registry lookup\n' +
      '  per package, and this generator does not install or resolve a tree to get it.\n',
  )
  return `${r.join('\n')}\n`
}

export function renderAll(d) {
  return {
    [DOC_ASSUMPTIONS]: renderAssumptions(d),
    [DOC_CONCEPTS]: renderConcepts(d),
    [DOC_DISPOSITION]: renderDisposition(d),
    [DOC_IMPORT_RISK]: renderImportRisk(d),
  }
}

export function renderSnapshot(d) {
  return `${JSON.stringify(d, null, 2)}\n`
}

// ══════════════════════ entry point ══════════════════════

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('tools', 'simon-convergence-inventory.mjs'))

if (isMain) {
  const check = process.argv.includes('--check')
  if (check) {
    const snap = JSON.parse(fs.readFileSync(path.join(ROOT, SNAPSHOT), 'utf8'))
    let bad = 0
    for (const [file, expected] of Object.entries(renderAll(snap))) {
      const actual = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\r\n').join('\n')
      if (actual !== expected) {
        console.error(`STALE: ${file} is not what ${SNAPSHOT} renders`)
        bad += 1
      }
    }
    if (bad) process.exit(1)
    console.log(`ok — 4 documents match ${SNAPSHOT}`)
  } else {
    const d = collect()
    fs.writeFileSync(path.join(ROOT, SNAPSHOT), renderSnapshot(d))
    for (const [file, text] of Object.entries(renderAll(d))) fs.writeFileSync(path.join(ROOT, file), text)
    console.log(`wrote ${SNAPSHOT} and 4 documents`)
    console.log(
      `  assumptions: source ${d.assumptions.source.total_hits} hits in ${d.assumptions.source.by_file.length} files, ` +
        `target ${d.assumptions.target.total_hits} in ${d.assumptions.target.by_file.length}`,
    )
    console.log(
      `  concepts: ${d.concepts.same_name_different_shape.length} same-name-different-shape, ` +
        `${d.concepts.same_symbol_different_kind.length} symbol-kind collisions, ` +
        `${d.concepts.candidate_synonyms_total} candidates`,
    )
    console.log(`  disposition: ${d.disposition.capabilities.length} capabilities, ${d.disposition.packages.length} packages`)
    const v = d.import_risk.vulnerable_dependencies
    console.log(`  import risk: audit ${v.ok ? `${v.counts.total} advisories` : 'UNKNOWN'}`)
  }
}
