#!/usr/bin/env node
/**
 * The Simon absorption baseline inventory — SIMON-000-001, -002 and -003.
 *
 * Three requirements of the absorption bible's §4.1 ask for the same thing at
 * three levels of zoom, across BOTH repositories:
 *
 *   SIMON-000-001  remotes, branches, tags, default branches, active PRs, dirty
 *                  state, commit history, contributors, releases, environments
 *                  and deployment workflows.
 *   SIMON-000-002  file / package / application / service / module / workspace
 *                  maps and dependency graphs.
 *   SIMON-000-003  frontend frameworks, routes, components, styles, tokens,
 *                  backend handlers, services, APIs, databases, schemas,
 *                  migrations, events, queues, jobs, identity, file storage,
 *                  search/AI, integrations, observability, IaC and tests.
 *
 * WHY A GENERATOR AND NOT THREE HAND-WRITTEN DOCUMENTS.
 *
 * A hand-written inventory is a claim nobody can re-check, and the single most
 * likely way to fail this programme is a plausible document describing code
 * nobody has. Every row below names a path that was READ out of a real tree at
 * generation time — `git ls-tree` for the source repository and `git ls-files`
 * for this one — and `tests/simon-absorption-inventory.test.mjs` reds when a row
 * names something that is not there.
 *
 * WHY THE SOURCE REPOSITORY IS READ FROM REFS AND NOT CLONED.
 *
 * `Tenurework/Tenure` is a live pilot carrying real student records, and its
 * `deploy.yml` rolls production ECS on every push to `main`. It is never pushed
 * to and it is never checked out here. Everything the source side of this
 * inventory says is derived from the remote-tracking refs already fetched into
 * this clone (`refs/remotes/live/*`) with read-only plumbing commands, pinned to
 * one commit that the snapshot records.
 *
 * NO STUDENT, STAFF OR APPLICANT DATA. Nothing read out of a file is copied
 * into the output. Content is read from `package.json` (declared names and
 * versions), `tsconfig.json` (path aliases), `.github/workflows/*.yml` (name,
 * triggers, repository guard) and source files (import specifiers only) — and
 * every one of those yields a name or a count, never a value. `Tier1/`, the
 * spreadsheets and the PDFs are listed by path and never opened.
 *
 * DETERMINISM. The output must be byte-identical on Linux and Windows:
 *   - every path is POSIX-normalised before it is sorted or written;
 *   - every sort uses an explicit codepoint comparator, never `localeCompare`;
 *   - git output is CRLF-stripped before parsing;
 *   - files are written with `\n` only.
 * The one thing that is NOT stable across runs is the observation block —
 * dirty state, open PRs, commit counts — because those are facts about a moment.
 * They are recorded as an `observed_at` snapshot and the guard test does not
 * re-derive them; it checks the structural claims, which are stable.
 *
 * Usage: node tools/simon-absorption-inventory.mjs           (refresh the baseline)
 *        node tools/simon-absorption-inventory.mjs --check   (documents vs snapshot)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const SNAPSHOT = 'docs/architecture/simon-absorption-inventory.json'
export const DOC_REPOSITORIES = 'docs/architecture/simon-repository-inventory.md'
export const DOC_MAPS = 'docs/architecture/simon-repository-maps.md'
export const DOC_STACK = 'docs/architecture/simon-stack-inventory.md'

/** The remote-tracking ref the source repository is read from. */
export const SOURCE_REF = 'refs/remotes/live/main'

/**
 * Codepoint order, on both platforms.
 *
 * `Array.prototype.sort()` without a comparator is already codepoint order, but
 * being explicit is the point: an inventory that sorts differently on Windows
 * and Linux is "current here, stale in CI", which is exactly the failure this
 * repository has shipped before.
 */
export const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Native separators out, forward slashes in — before anything is sorted. */
export const posix = (p) => p.split(path.sep).join('/')

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\r\n')
      .join('\n')
  } catch (err) {
    return null
  }
}

const gitLines = (args) => {
  const out = git(args)
  if (out === null) return null
  return out.split('\n').map((l) => l.trim()).filter(Boolean)
}

/**
 * A read that failed is UNKNOWN, never absent.
 *
 * The Studio ledger's STUDIO-000-007 settled this for AWS: a denied call is
 * rendered as UNKNOWN with the command that would answer it, because an empty
 * list is a claim and a refusal is not. The same rule governs `gh` here — if the
 * token cannot see a repository's environments, this records that it could not,
 * not that there are none.
 */
const gh = (args, describe) => {
  try {
    const out = execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    return { ok: true, value: out.split('\r\n').join('\n').trim() }
  } catch (err) {
    return { ok: false, unknown_because: `\`gh ${args.join(' ')}\` failed`, command: `gh ${args.join(' ')}`, of: describe }
  }
}

const jsonOf = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ───────────────────────────── repository facts ─────────────────────────────

function remotes() {
  const lines = gitLines(['remote', '-v']) ?? []
  const seen = new Map()
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    if (!m) continue
    const [, name, url, dir] = m
    const entry = seen.get(name) ?? { name, fetch_url: null, push_url: null }
    if (dir === 'fetch') entry.fetch_url = url
    else entry.push_url = url
    seen.set(name, entry)
  }
  return [...seen.values()].sort((a, b) => byCodepoint(a.name, b.name))
}

function branchesUnder(prefix) {
  const lines = gitLines(['for-each-ref', '--format=%(refname:short)\t%(objectname)', prefix]) ?? []
  return lines
    .map((l) => {
      const [ref, sha] = l.split('\t')
      return { ref, commit: sha }
    })
    .filter((b) => b.ref && !b.ref.endsWith('/HEAD'))
    .sort((a, b) => byCodepoint(a.ref, b.ref))
}

function historyOf(rev) {
  const count = git(['rev-list', '--count', rev])
  const newest = git(['log', '-1', '--format=%H\t%ad', '--date=short', rev])
  const oldestLine = gitLines(['log', '--format=%H\t%ad', '--date=short', rev])?.slice(-1)[0] ?? null
  const authors = gitLines(['log', '--format=%an', rev]) ?? []
  return {
    commits: count === null ? null : Number(count.trim()),
    newest_commit: newest ? newest.trim().split('\t')[0] : null,
    newest_commit_date: newest ? newest.trim().split('\t')[1] : null,
    oldest_commit: oldestLine ? oldestLine.split('\t')[0] : null,
    oldest_commit_date: oldestLine ? oldestLine.split('\t')[1] : null,
    // Names, not addresses. Both repositories are public, so authorship is
    // already world-readable; commit email addresses are not recorded because
    // nothing in this inventory needs them.
    contributors: [...new Set(authors)].sort(byCodepoint),
  }
}

/**
 * What a workflow file declares, without executing or trusting it.
 *
 * Three facts matter for absorption and each is a literal string match against
 * the file's own text: what it is called, when it fires, and whether it carries
 * the repository guard that stops a fork from acting on production. The guard is
 * the one that decides whether importing this workflow into the parent is safe.
 */
export function workflowFacts(text, file) {
  const flat = text.split('\r\n').join('\n')
  const name = flat.match(/^name:\s*(.+?)\s*$/m)?.[1] ?? path.basename(file)

  // A line scanner, not a multi-line regex.
  //
  // The first version of this used `/^on:\s*\n((?:[ \t]+.*\n|\n)*)/m`, which is
  // an alternation under a star — catastrophic backtracking on any file where
  // the block does not terminate the way it guesses, and it turned a two-second
  // generator into a two-minute one. It also silently missed `on: workflow_dispatch`
  // in scalar form, which is how six of the twelve source workflows are written,
  // so half the table read "no triggers" and looked like a finding. Scanning
  // lines handles all three YAML shapes and is linear.
  const triggers = []
  const lines = flat.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(/^on:\s*(.*)$/)
    if (!head) continue
    const rest = head[1].trim()
    if (rest.startsWith('[')) {
      for (const t of rest.replace(/^\[|\].*$/g, '').split(',')) if (t.trim()) triggers.push(t.trim())
    } else if (rest && !rest.startsWith('#')) {
      triggers.push(rest.split('#')[0].trim())
    } else {
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j]
        if (line.trim() === '' || line.trimStart().startsWith('#')) continue
        if (!/^\s/.test(line)) break
        const key = line.match(/^ {2}([a-z_]+):/)
        if (key) triggers.push(key[1])
      }
    }
    break
  }
  const guards = [...flat.matchAll(/github\.repository\s*==\s*'([^']+)'/g)].map((m) => m[1])

  // Comments are stripped before the capability match, and the reason is a
  // false positive this generator actually produced.
  //
  // The first version matched `terraform ` anywhere in the file. It therefore
  // reported `ci.yml` as reaching AWS on the strength of a code comment, and
  // `platform-plan.yml` as a DEPLOYMENT workflow on the strength of the line
  // "no `terraform apply`, no `-auto-approve`" — a comment whose entire purpose
  // is to say the workflow does not do that. An inventory that reads a file's
  // prose as its behaviour is the "plausible document" failure in miniature.
  //
  // `#` is treated as a comment when it starts a line or follows whitespace.
  // That is not a YAML parser and it can mis-handle a `#` inside a quoted
  // string; no workflow in either repository has one, and the alternative is a
  // dependency this tool does not need.
  const code = flat
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'))
    .join('\n')
  // "Reaches AWS" means it AUTHENTICATES to AWS or calls the AWS CLI.
  //
  // Terraform deliberately is not part of this test. `ci.yml` runs
  // `terraform init -backend=false` and `terraform validate`, which never open a
  // socket to AWS, and a rule that counted any `terraform` verb reported CI as
  // an AWS-touching workflow. Since terraform cannot reach an account without
  // credentials, and credentials in both repositories come from
  // `aws-actions/configure-aws-credentials`, testing for the credential step is
  // both narrower and sound.
  const reachesAws = /aws-actions\/configure-aws-credentials|(^|\s)aws\s+[a-z0-9-]+\s/m.test(code)
  const deploys = /terraform\s+apply|ecs\s+update-service|force-new-deployment|docker\s+push|ecr\s+get-login/.test(code)
  return {
    file: posix(file),
    name,
    triggers: [...new Set(triggers)].sort(byCodepoint),
    reaches_aws: reachesAws,
    is_deployment: deploys,
    repository_guards: [...new Set(guards)].sort(byCodepoint),
  }
}

// ───────────────────────────── stack probes ─────────────────────────────

/**
 * Every capability SIMON-000-003 names, as a probe over a real file list.
 *
 * A probe never asserts that a capability is absent. It asserts that no tracked
 * path matched its pattern, which is a statement about this inventory's own
 * search and can be re-run. The distinction matters: `NO MATCH` here has cost
 * this programme nothing yet, and a row that said "the source has no search"
 * would have been wrong the moment somebody looked at `search-data.ts`.
 */
export const PROBES = [
  { capability: 'Frontend framework', pattern: /^(apps\/[^/]+\/)?next\.config\.(ts|mjs|js)$/ },
  { capability: 'Frontend routes (pages)', pattern: /\/src\/app\/.*\/page\.tsx$|\/src\/app\/page\.tsx$/ },
  { capability: 'Frontend layouts', pattern: /\/src\/app\/.*layout\.tsx$/ },
  { capability: 'Frontend components', pattern: /\/src\/components\/.*\.tsx$/ },
  { capability: 'Styles', pattern: /\.css$/ },
  { capability: 'Design tokens / theme config', pattern: /tailwind\.config\.(ts|js|mjs)$|\/tokens?\.(ts|css|json)$/ },
  { capability: 'HTTP API handlers', pattern: /\/src\/app\/api\/.*\/route\.ts$/ },
  { capability: 'Backend services / domain libraries', pattern: /\/src\/lib\/[^/]+\.ts$/, exclude: /\.(test|itest|spec)\.ts$/ },
  // The requirement names "databases" and "schemas" separately, so they are two
  // rows: the engine somebody provisions and pays for, and the schema the
  // application declares against it.
  { capability: 'Database engine (provisioned)', pattern: /(^|\/)(rds|elasticache)\.tf$/ },
  { capability: 'Database schema', pattern: /prisma\/schema\.prisma$/ },
  { capability: 'Database migrations', pattern: /prisma\/migrations\/.*\.(sql|toml)$/ },
  { capability: 'Events / scheduled jobs', pattern: /scheduler\.tf$|\/api\/jobs\/.*\/route\.ts$|eventbridge/i },
  { capability: 'Queues', pattern: /sqs\.tf$|\/queue[^/]*\.ts$/ },
  { capability: 'Identity and authentication', pattern: /\/src\/lib\/auth\.ts$|\/api\/auth\/.*\/route\.ts$|\/src\/lib\/dev-login\.ts$|cognito/i },
  { capability: 'Authorization', pattern: /\/rbac\.ts$|\/authorization\/src\/.*\.ts$|\/admin\/guard\.ts$/, exclude: /\.(test|itest|spec)\.ts$/ },
  { capability: 'Tenancy isolation', pattern: /\/tenancy\/[^/]+\.ts$|\/tenant-scope\.ts$/, exclude: /\.(test|itest|spec)\.ts$/ },
  { capability: 'File storage', pattern: /\/s3\.ts$|s3\.tf$/ },
  { capability: 'Search', pattern: /\/search[^/]*\.ts$|\/search\/.*\.ts$/, exclude: /\.(test|itest|spec)\.ts$/ },
  { capability: 'AI', pattern: /\/ai\.ts$|\/api\/ai\/.*\/route\.ts$|bedrock/i },
  { capability: 'Outbound integrations (email)', pattern: /ses\.tf$|\/notify\.ts$/ },
  { capability: 'Observability', pattern: /cloudwatch\.tf$|instrumentation\.ts$|\/api\/health\/route\.ts$/ },
  { capability: 'Infrastructure as code', pattern: /^infrastructure\/.*\.tf$/ },
  { capability: 'Unit tests', pattern: /\.(test|itest)\.(ts|tsx|mjs|js)$/ },
  { capability: 'End-to-end tests', pattern: /\/e2e\/.*\.spec\.ts$/ },
  { capability: 'CI / deployment workflows', pattern: /^\.github\/workflows\/.*\.ya?ml$/ },
]

/** Evidence is capped so the document stays readable; the count is never capped. */
const EVIDENCE_CAP = 6

export function probeSide(files) {
  return PROBES.map((probe) => {
    const matched = files
      .filter((f) => probe.pattern.test(f) && !(probe.exclude && probe.exclude.test(f)))
      .sort(byCodepoint)
    return {
      capability: probe.capability,
      matches: matched.length,
      evidence: matched.slice(0, EVIDENCE_CAP),
      pattern: String(probe.pattern),
    }
  })
}

// ───────────────────────── the import dependency graph ─────────────────────────

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

/** Node's own modules, so `fs` is not reported as a package nobody declared. */
const BUILTINS = new Set(builtinModules)

/**
 * Every module specifier a file imports, however it spells it.
 *
 * Four spellings, all static text: `import … from 'x'`, side-effect `import 'x'`,
 * `export … from 'x'`, dynamic `import('x')` and `require('x')`. A specifier
 * computed at runtime is invisible to this and is supposed to be — the graph is
 * a claim about what the source text says, not about what the module system
 * eventually resolves.
 */
export function specifiersOf(text) {
  const src = text.split('\r\n').join('\n')
  const out = []
  const patterns = [
    /(?:^|[\n;])\s*import\s+[^'"\n;]*from\s*['"]([^'"]+)['"]/g,
    /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g,
    /(?:^|[\n;])\s*export\s+[^'"\n;]*from\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) for (const m of src.matchAll(re)) out.push(m[1])
  return out
}

/** The area a path belongs to — the same rule the module map uses. */
export const areaOf = (file) => {
  const dir = file.split('/').slice(0, -1)
  return dir.length === 0 ? '(repository root)' : dir.slice(0, 2).join('/')
}

/**
 * A finer area, for the import graph only.
 *
 * Two segments is the right grain for "how big is each part of the tree" and
 * the wrong one for "what depends on what": it collapses `apps/web/src/app`,
 * `apps/web/src/lib` and `apps/web/src/components` into a single node, and the
 * first run of this graph duly reported that the pilot had ZERO edges — true
 * under that grain, and useless. Four segments separates the layers that
 * actually import each other.
 */
export const moduleAreaOf = (file) => {
  const dir = file.split('/').slice(0, -1)
  return dir.length === 0 ? '(repository root)' : dir.slice(0, 4).join('/')
}

/**
 * `tsconfig.json` with comments, which is what TypeScript actually writes.
 *
 * `JSON.parse` rejects `apps/web/tsconfig.json` outright. Comments are stripped
 * outside string literals only — stripping them everywhere would eat the `//` in
 * any URL the file contains.
 */
export function parseJsonc(text) {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    const next = text[i + 1]
    if (inLine) {
      if (c === '\n') {
        inLine = false
        out += c
      }
      continue
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false
        i += 1
      }
      continue
    }
    if (inString) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i += 1
      } else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      continue
    }
    if (c === '/' && next === '/') {
      inLine = true
      i += 1
      continue
    }
    if (c === '/' && next === '*') {
      inBlock = true
      i += 1
      continue
    }
    out += c
  }
  // Trailing commas are legal in tsconfig and not in JSON.
  return jsonOf(out.replace(/,(\s*[}\]])/g, '$1'))
}

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`; `node:fs` → `node:builtin`. */
export function packageOf(spec) {
  if (spec.startsWith('node:')) return 'node:builtin'
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * A relative specifier resolved to a real file in the list, or null.
 *
 * TypeScript lets `./x` mean `./x.ts`, `./x.tsx` or `./x/index.ts`, and this
 * inventory only knows the file list, so it tries the extensions in a fixed
 * order. Fixed, because trying them in whatever order a Set happened to iterate
 * is exactly how a generated artifact becomes platform-dependent.
 */
const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs']

export function resolveRelative(fromFile, spec, known) {
  const base = path.posix.normalize(`${path.posix.dirname(fromFile)}/${spec}`)
  for (const ext of EXTENSIONS) if (known.has(base + ext)) return base + ext
  return null
}

/**
 * The import graph of one side, rolled up to areas, plus external package use.
 *
 * Rolled up because a file-level graph of 1,343 nodes is not something anybody
 * reads, and the question absorption actually asks is which parts of the pilot
 * depend on which — `apps/web/src/app` on `apps/web/src/lib`, and whether
 * anything in `apps/web` reaches into a package that only the parent has.
 *
 * `declared` on an external edge is the one that finds defects: an import of a
 * package no manifest in that workspace declares works locally through npm's
 * flat `node_modules` and breaks the day the transitive dependency that hoisted
 * it is removed.
 */
export function importGraph(files, contentOf, manifests) {
  const known = new Set(files)
  const code = files.filter((f) => CODE.test(f)).sort(byCodepoint)

  /**
   * The tsconfig path aliases in force for a file, nearest config first.
   *
   * Without these the graph is worse than incomplete, it is WRONG: `@/lib` and
   * `@tenure/platform-config` are aliases this repository maps to real
   * directories, and the first run reported 1,000-odd imports of them as
   * "undeclared external packages". Sixty-four of the seventy-four undeclared
   * rows were aliases resolving perfectly well.
   */
  const aliasConfigs = files
    .filter((f) => f === 'tsconfig.json' || f.endsWith('/tsconfig.json'))
    .sort(byCodepoint)
    .map((f) => {
      const parsed = parseJsonc(contentOf(f) ?? '') ?? {}
      const dir = f.includes('/') ? path.posix.dirname(f) : ''
      const paths = parsed.compilerOptions?.paths ?? {}
      return { dir, paths }
    })
    .filter((c) => Object.keys(c.paths).length > 0)

  const aliasFor = (file) => {
    let best = null
    for (const c of aliasConfigs) {
      if (c.dir === '' || file.startsWith(`${c.dir}/`)) {
        if (best === null || c.dir.length > best.dir.length) best = c
      }
    }
    return best
  }

  /** `@/x` under `paths: {"@/*": ["./src/*"]}` → `<configDir>/src/x`, unresolved otherwise. */
  const resolveAlias = (file, spec) => {
    matched = false
    const cfg = aliasFor(file)
    if (!cfg) return null
    for (const [pattern, targets] of Object.entries(cfg.paths).sort((a, b) => byCodepoint(a[0], b[0]))) {
      const star = pattern.indexOf('*')
      let tail = null
      if (star === -1) {
        if (spec !== pattern) continue
        tail = ''
      } else {
        const head = pattern.slice(0, star)
        const rest = pattern.slice(star + 1)
        if (!spec.startsWith(head) || !spec.endsWith(rest)) continue
        tail = spec.slice(head.length, spec.length - rest.length)
      }
      matched = true
      for (const target of targets) {
        const substituted = target.replace('*', tail)
        const base = path.posix.normalize(`${cfg.dir ? `${cfg.dir}/` : ''}${substituted}`)
        for (const ext of EXTENSIONS) if (known.has(base + ext)) return base + ext
      }
    }
    return null
  }

  /**
   * Did a specifier match an alias PATTERN even though it resolved to no file?
   *
   * Set by `resolveAlias` on the way through. Without it, `@/lib/something-that-
   * moved` is reported as an undeclared npm package called `@/lib`, which is not
   * a package and never was — it is a broken alias, a different defect with a
   * different fix, and lumping the two together is how an inventory misleads.
   */
  let matched = false

  const declaredByArea = new Map()
  for (const m of manifests) {
    const area = areaOf(m.file) === '(repository root)' ? '(repository root)' : path.posix.dirname(m.file)
    const names = new Set(Object.keys({ ...(m.json.dependencies ?? {}), ...(m.json.devDependencies ?? {}) }))
    declaredByArea.set(area, names)
  }
  /** Nearest declaring manifest walking up from a file's directory, then the root. */
  const declaredFor = (file) => {
    const parts = file.split('/')
    for (let i = parts.length - 1; i > 0; i -= 1) {
      const dir = parts.slice(0, i).join('/')
      if (declaredByArea.has(dir)) return declaredByArea.get(dir)
    }
    return declaredByArea.get('(repository root)') ?? new Set()
  }

  const internal = new Map()
  const external = new Map()
  let unresolved = 0
  let unresolvedAliases = 0
  let builtins = 0

  for (const file of code) {
    const text = contentOf(file)
    if (text === null) continue
    const from = moduleAreaOf(file)
    for (const spec of specifiersOf(text)) {
      // A builtin is neither an internal edge nor a dependency anyone declares.
      // `node:fs` and bare `fs` are the same module, and counting the bare form
      // as an undeclared package produced five false rows on each side.
      if (spec.startsWith('node:') || BUILTINS.has(spec)) {
        builtins += 1
        continue
      }
      const target = spec.startsWith('.') ? resolveRelative(file, spec, known) : resolveAlias(file, spec)
      if (target !== null) {
        const to = moduleAreaOf(target)
        if (to === from) continue
        const key = `${from}|${to}`
        internal.set(key, (internal.get(key) ?? 0) + 1)
        continue
      }
      if (spec.startsWith('.')) {
        unresolved += 1
        continue
      }
      if (matched) {
        unresolvedAliases += 1
        continue
      }
      const pkg = packageOf(spec)
      const key = `${from}|${pkg}`
      const declared = declaredFor(file).has(pkg)
      const entry = external.get(key) ?? { from, package: pkg, imports: 0, declared }
      entry.imports += 1
      external.set(key, entry)
    }
  }

  return {
    code_files: code.length,
    builtin_imports: builtins,
    unresolved_relative_specifiers: unresolved,
    unresolved_alias_specifiers: unresolvedAliases,
    internal_edges: [...internal.entries()]
      .map(([k, imports]) => {
        const [from, to] = k.split('|')
        return { from, to, imports }
      })
      .sort((a, b) => byCodepoint(a.from, b.from) || byCodepoint(a.to, b.to)),
    external_edges: [...external.values()].sort(
      (a, b) => byCodepoint(a.from, b.from) || byCodepoint(a.package, b.package),
    ),
  }
}

// ───────────────────────────── maps ─────────────────────────────

/**
 * Files rolled up to the first two segments of their DIRECTORY — the module map.
 *
 * Rolling up the first two segments of the FILE path, which is what this did
 * first, gives every root-level file its own row: the target's twenty Bibles
 * produced twenty one-file "areas" and buried the twenty real ones. Rolling up
 * the directory puts `package.json` and `CLAUDE.md` in `(repository root)` and
 * keeps `apps/web`, `packages/identity`, `.github/workflows` intact.
 */
export function areaMap(files) {
  const counts = new Map()
  for (const f of files) {
    const dir = f.split('/').slice(0, -1)
    const area = dir.length === 0 ? '(repository root)' : dir.slice(0, 2).join('/')
    counts.set(area, (counts.get(area) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([area, files]) => ({ area, files }))
    .sort((a, b) => byCodepoint(a.area, b.area))
}

/**
 * The workspace map and the dependency graph, from the manifests themselves.
 *
 * An edge exists when one workspace declares another workspace's package name in
 * `dependencies` or `devDependencies`. Nothing is inferred from imports, because
 * an import that no manifest declares is a defect rather than an edge.
 */
export function workspaceMap(manifests) {
  const names = new Set(manifests.map((m) => m.name).filter(Boolean))
  return manifests
    .map((m) => {
      const declared = { ...(m.json.dependencies ?? {}), ...(m.json.devDependencies ?? {}) }
      const keys = Object.keys(declared).sort(byCodepoint)
      return {
        manifest: m.file,
        directory: posix(path.posix.dirname(m.file)),
        name: m.name ?? '(unnamed)',
        private: m.json.private === true,
        scripts: Object.keys(m.json.scripts ?? {}).filter((s) => !s.startsWith('//')).sort(byCodepoint),
        depends_on_workspaces: keys.filter((k) => names.has(k)),
        external_dependencies: keys.filter((k) => !names.has(k)).length,
        // The names, not just the count, because the import graph flags an
        // import of a package no manifest declares and the guard test has to be
        // able to recompute that flag rather than take the generator's word.
        declared_dependencies: keys,
      }
    })
    .sort((a, b) => byCodepoint(a.manifest, b.manifest))
}

// ───────────────────────────── collection ─────────────────────────────

/**
 * Read many blobs out of one commit in ONE git process.
 *
 * `git show <sha>:<path>` per file is 200-odd process spawns, and on Windows a
 * spawn costs more than the read. `cat-file --batch` takes the whole list on
 * stdin and answers `<oid> <type> <size>\n<contents>\n` for each, in the order
 * asked. Parsed as bytes, then decoded, because the size in the header is in
 * bytes and slicing a decoded string by a byte count corrupts anything non-ASCII.
 *
 * Exported because `tools/simon-convergence-inventory.mjs` (SIMON-000-004 to
 * -007) analyses the CONTENT of the same two pinned commits this file inventories.
 * A second batch reader there would be a second implementation of the one thing
 * in this file that is genuinely fiddly — the byte-accurate header parse.
 */
export function readBlobs(sha, files) {
  const out = new Map()
  if (files.length === 0) return out
  const stdout = execFileSync('git', ['cat-file', '--batch'], {
    cwd: ROOT,
    // No `encoding`, so stdout comes back as a Buffer. Setting `encoding:
    // 'buffer'` looks like the way to ask for that and is not — the option is
    // applied to `input` as well, and Buffer.from rejects it as an unknown
    // encoding before git is ever spawned.
    input: `${files.map((f) => `${sha}:${f}`).join('\n')}\n`,
    maxBuffer: 512 * 1024 * 1024,
  })
  let at = 0
  for (const file of files) {
    const nl = stdout.indexOf(0x0a, at)
    if (nl === -1) break
    const header = stdout.slice(at, nl).toString('utf8')
    at = nl + 1
    const parts = header.split(' ')
    if (parts.length < 3) continue // "missing" — recorded by omission, not invented
    const size = Number(parts[2])
    out.set(file, stdout.slice(at, at + size).toString('utf8'))
    at += size + 1
  }
  return out
}

function sourceSide() {
  const sha = git(['rev-parse', SOURCE_REF])?.trim() ?? null
  if (!sha) {
    throw new Error(
      `${SOURCE_REF} is not present in this clone. The source side of this inventory is derived ` +
        `from remote-tracking refs and cannot be regenerated without them. Run ` +
        `\`git fetch live\` (read-only) first. The source repository is NEVER cloned or pushed to.`,
    )
  }
  const files = (gitLines(['ls-tree', '-r', '--name-only', sha]) ?? []).map(posix).sort(byCodepoint)
  const manifests = files
    .filter((f) => f === 'package.json' || f.endsWith('/package.json'))
    .map((f) => {
      const json = jsonOf(git(['show', `${sha}:${f}`]) ?? '') ?? {}
      return { file: f, name: json.name ?? null, json }
    })
  const workflows = files
    .filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f))
    .map((f) => workflowFacts(git(['show', `${sha}:${f}`]) ?? '', f))
  const blobs = readBlobs(
    sha,
    files.filter((f) => CODE.test(f) || f === 'tsconfig.json' || f.endsWith('/tsconfig.json')),
  )
  const contentOf = (f) => blobs.get(f) ?? null
  return { sha, files, manifests, workflows, contentOf }
}

function targetSide() {
  // `git ls-tree -r HEAD`, not `git ls-files`.
  //
  // Both answer "what is tracked", but only one is pinned. `ls-files` reads the
  // index, which moves the moment anyone stages anything — and this repository
  // is worked by many agents at once, so an inventory equal to the index is
  // stale before it is committed. Reading HEAD's tree gives a baseline pinned to
  // a commit the snapshot records and the guard test can re-derive, which is
  // what §4.3 of the bible means by a baseline artifact. Content is still read
  // from disk: for a tracked, unmodified file the two are the same bytes, and
  // reading from disk keeps the manifest and workflow parsing simple.
  const head = git(['rev-parse', 'HEAD'])?.trim() ?? null
  const files = (gitLines(['ls-tree', '-r', '--name-only', 'HEAD']) ?? []).map(posix).sort(byCodepoint)
  const manifests = files
    .filter((f) => f === 'package.json' || f.endsWith('/package.json'))
    .filter((f) => !f.includes('node_modules/'))
    .map((f) => {
      const json = jsonOf(fs.readFileSync(path.join(ROOT, f), 'utf8')) ?? {}
      return { file: f, name: json.name ?? null, json }
    })
  const workflows = files
    .filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f))
    .map((f) => workflowFacts(fs.readFileSync(path.join(ROOT, f), 'utf8'), f))
  const contentOf = (f) => {
    try {
      return fs.readFileSync(path.join(ROOT, f), 'utf8')
    } catch {
      return null
    }
  }
  return { head, files, manifests, workflows, contentOf }
}

/**
 * The workspace manifests the ROOT package.json claims, expanded against disk.
 *
 * Exported because the guard test needs the same expansion: comparing the
 * inventory's workspace list against a list derived from the inventory would be
 * the inventory agreeing with itself.
 */
export function declaredWorkspaceManifests() {
  const root = jsonOf(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) ?? {}
  const out = new Set(['package.json'])
  for (const glob of root.workspaces ?? []) {
    if (glob.endsWith('/*')) {
      const dir = glob.slice(0, -2)
      const full = path.join(ROOT, dir)
      if (!fs.existsSync(full)) continue
      for (const entry of fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => byCodepoint(a.name, b.name))) {
        if (!entry.isDirectory()) continue
        const manifest = `${dir}/${entry.name}/package.json`
        if (fs.existsSync(path.join(ROOT, manifest))) out.add(manifest)
      }
    } else {
      const manifest = `${glob}/package.json`
      if (fs.existsSync(path.join(ROOT, manifest))) out.add(manifest)
    }
  }
  return [...out].sort(byCodepoint)
}

function ghFacts(nwo) {
  const view = gh(['repo', 'view', nwo, '--json', 'nameWithOwner,defaultBranchRef,visibility,isFork'], `${nwo} repository`)
  const prs = gh(['pr', 'list', '-R', nwo, '--state', 'open', '--json', 'number,title,headRefName'], `${nwo} open pull requests`)
  const releases = gh(['api', `repos/${nwo}/releases`, '--jq', '[.[].tag_name]'], `${nwo} releases`)
  const envs = gh(['api', `repos/${nwo}/environments`, '--jq', '[.environments[].name]'], `${nwo} environments`)
  const tags = gh(['api', `repos/${nwo}/tags`, '--jq', '[.[].name]'], `${nwo} tags`)
  const viewJson = view.ok ? jsonOf(view.value) : null
  const listOr = (r) => (r.ok ? (jsonOf(r.value) ?? []).slice().sort(byCodepoint) : r)
  return {
    queried_as: nwo,
    canonical_name: viewJson ? viewJson.nameWithOwner : view,
    visibility: viewJson ? viewJson.visibility : view,
    is_fork: viewJson ? viewJson.isFork : view,
    default_branch: viewJson ? viewJson.defaultBranchRef?.name ?? null : view,
    open_pull_requests: prs.ok
      ? (jsonOf(prs.value) ?? [])
          .map((p) => ({ number: p.number, head: p.headRefName, title: p.title }))
          .sort((a, b) => a.number - b.number)
      : prs,
    releases: listOr(releases),
    environments: listOr(envs),
    tags: listOr(tags),
  }
}

export function collect() {
  const src = sourceSide()
  const tgt = targetSide()
  const remoteList = remotes()
  const sourceRemote = remoteList.find((r) => r.name === 'live') ?? null
  const targetRemote = remoteList.find((r) => r.name === 'origin') ?? null

  const nwoOf = (url) => (url ?? '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')

  const dirty = (gitLines(['status', '--porcelain']) ?? []).length
  const mergeBase = git(['merge-base', SOURCE_REF, 'refs/remotes/origin/main'])?.trim() ?? null
  const mergeBaseDate = mergeBase ? git(['log', '-1', '--format=%ad', '--date=short', mergeBase])?.trim() ?? null : null

  return {
    schema: 1,
    generated_by: 'tools/simon-absorption-inventory.mjs',
    closes: ['SIMON-000-001', 'SIMON-000-002', 'SIMON-000-003'],
    observed_at: new Date().toISOString().slice(0, 10),
    source: {
      role: 'source — the Simon OSE pilot application being absorbed',
      remote: sourceRemote,
      configured_url: sourceRemote?.fetch_url ?? null,
      queried: ghFacts(nwoOf(sourceRemote?.fetch_url)),
      pinned_ref: SOURCE_REF,
      pinned_commit: src.sha,
      branches: branchesUnder('refs/remotes/live'),
      local_tags: (gitLines(['tag', '--list']) ?? []).sort(byCodepoint),
      history: historyOf(SOURCE_REF),
      tracked_files: src.files.length,
      files: src.files,
      workspaces: workspaceMap(src.manifests),
      areas: areaMap(src.files),
      import_graph: importGraph(src.files, src.contentOf, src.manifests),
      workflows: src.workflows.sort((a, b) => byCodepoint(a.file, b.file)),
      stack: probeSide(src.files),
      working_tree: 'NOT CHECKED OUT — read from remote-tracking refs only; this repository never clones or pushes the pilot.',
    },
    target: {
      role: 'target — this repository, the Tenure parent platform',
      remote: targetRemote,
      configured_url: targetRemote?.fetch_url ?? null,
      queried: ghFacts(nwoOf(targetRemote?.fetch_url)),
      checked_out_branch: git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() ?? null,
      head_commit: tgt.head,
      branches: branchesUnder('refs/heads'),
      remote_branches: branchesUnder('refs/remotes/origin'),
      local_tags: (gitLines(['tag', '--list']) ?? []).sort(byCodepoint),
      history: historyOf('refs/remotes/origin/main'),
      tracked_files: tgt.files.length,
      files: tgt.files,
      workspaces: workspaceMap(tgt.manifests),
      areas: areaMap(tgt.files),
      import_graph: importGraph(tgt.files, tgt.contentOf, tgt.manifests),
      workflows: tgt.workflows.sort((a, b) => byCodepoint(a.file, b.file)),
      stack: probeSide(tgt.files),
      working_tree_dirty_paths: dirty,
    },
    relationship: {
      merge_base: mergeBase,
      merge_base_date: mergeBaseDate,
      note:
        'The two repositories share history: the parent was branched from the pilot. ' +
        'Absorption is therefore a convergence, not an import into an unrelated tree.',
    },
  }
}

// ───────────────────────────── rendering ─────────────────────────────

const esc = (s) => String(s).split('|').join('\\|')

const unknownCell = (v) =>
  v && typeof v === 'object' && v.ok === false
    ? `UNKNOWN — \`${v.command}\` failed`
    : Array.isArray(v)
      ? v.length
        ? v.map((x) => `\`${esc(x)}\``).join(' ')
        : 'none'
      : v === null || v === undefined
        ? 'UNKNOWN'
        : String(v)

const HEADER = (title, closes) => `# ${title}

**Generated** by \`node tools/simon-absorption-inventory.mjs\` from
\`${SNAPSHOT}\`. Do not edit by hand — \`tests/simon-absorption-inventory.test.mjs\`
re-renders this file from the snapshot and reds on any difference.

Closes ${closes}. Source repository read from \`${SOURCE_REF}\` only: the pilot is
never cloned, checked out or pushed to from here.

`

export function renderRepositories(d) {
  const side = (s, label) => {
    const q = s.queried
    return [
      `### ${label}`,
      '',
      '| Fact | Value |',
      '| --- | --- |',
      `| Role | ${s.role} |`,
      `| Configured remote | \`${s.remote?.name ?? 'UNKNOWN'}\` → \`${s.configured_url ?? 'UNKNOWN'}\` |`,
      `| Canonical name (GitHub) | ${unknownCell(q.canonical_name)} |`,
      `| Visibility | ${unknownCell(q.visibility)} |`,
      `| Fork | ${unknownCell(q.is_fork)} |`,
      `| Default branch | ${unknownCell(q.default_branch)} |`,
      `| Branches known here | ${s.branches.length} |`,
      `| Tags (GitHub) | ${unknownCell(q.tags)} |`,
      `| Tags (local refs) | ${s.local_tags.length ? s.local_tags.join(' ') : 'none'} |`,
      `| Releases | ${unknownCell(q.releases)} |`,
      `| Deployment environments | ${unknownCell(q.environments)} |`,
      `| Open pull requests | ${
        Array.isArray(q.open_pull_requests)
          ? q.open_pull_requests.length
            ? q.open_pull_requests.map((p) => `#${p.number} ${esc(p.title)}`).join('; ')
            : 'none open'
          : unknownCell(q.open_pull_requests)
      } |`,
      `| Commits on the recorded head | ${s.history.commits} |`,
      `| Oldest commit | \`${s.history.oldest_commit?.slice(0, 12)}\` (${s.history.oldest_commit_date}) |`,
      `| Newest commit | \`${s.history.newest_commit?.slice(0, 12)}\` (${s.history.newest_commit_date}) |`,
      `| Contributors | ${s.history.contributors.length} — ${s.history.contributors.join(', ')} |`,
      `| Tracked files | ${s.tracked_files} |`,
      `| Working tree | ${
        s.working_tree ?? `checked out on \`${s.checked_out_branch}\`, ${s.working_tree_dirty_paths} dirty path(s) at ${d.observed_at}`
      } |`,
      '',
      '| Branch | Commit |',
      '| --- | --- |',
      ...s.branches.map((b) => `| \`${b.ref}\` | \`${b.commit.slice(0, 12)}\` |`),
      '',
    ].join('\n')
  }

  const workflows = (s, label) =>
    [
      `### ${label} — workflows`,
      '',
      '| File | Name | Triggers | Reaches AWS | Deploys | Repository guard |',
      '| --- | --- | --- | ---: | ---: | --- |',
      ...s.workflows.map(
        (w) =>
          `| \`${w.file}\` | ${esc(w.name)} | ${w.triggers.join(', ') || '—'} | ${w.reaches_aws ? 'yes' : '—'} | ${
            w.is_deployment ? '**yes**' : '—'
          } | ${w.repository_guards.length ? w.repository_guards.map((g) => `\`${g}\``).join(' ') : '**none**'} |`,
      ),
      '',
    ].join('\n')

  return (
    HEADER('Simon absorption — repository inventory', '**SIMON-000-001**') +
    [
      'Two repositories, recorded at the same moment, from git plumbing and the',
      'GitHub API. A field this run could not read is `UNKNOWN` with the command',
      'that would answer it — never an empty list, because a refusal is not an',
      'absence.',
      '',
      `Observed at **${d.observed_at}**. Source pinned to \`${d.source.pinned_commit}\`.`,
      '',
      '## Repositories',
      '',
      side(d.source, 'Source'),
      side(d.target, 'Target'),
      '## Shared history',
      '',
      `| Merge base | \`${d.relationship.merge_base}\` (${d.relationship.merge_base_date}) |`,
      '| --- | --- |',
      '',
      d.relationship.note,
      '',
      '## Deployment workflows',
      '',
      workflows(d.source, 'Source'),
      workflows(d.target, 'Target'),
    ].join('\n')
  )
}

export function renderMaps(d) {
  const areas = (s, label) =>
    [
      `### ${label}`,
      '',
      '| Area | Tracked files |',
      '| --- | ---: |',
      ...s.areas.map((a) => `| \`${a.area}\` | ${a.files} |`),
      `| **total** | **${s.tracked_files}** |`,
      '',
    ].join('\n')

  const spaces = (s, label) =>
    [
      `### ${label}`,
      '',
      '| Manifest | Package | Private | Scripts | Depends on workspaces | External deps |',
      '| --- | --- | ---: | ---: | --- | ---: |',
      ...s.workspaces.map(
        (w) =>
          `| \`${w.manifest}\` | \`${w.name}\` | ${w.private ? 'yes' : '—'} | ${w.scripts.length} | ${
            w.depends_on_workspaces.length ? w.depends_on_workspaces.map((x) => `\`${x}\``).join(' ') : '—'
          } | ${w.external_dependencies} |`,
      ),
      '',
    ].join('\n')

  const graph = (s, label) => {
    const edges = s.workspaces.flatMap((w) => w.depends_on_workspaces.map((dep) => `  "${w.name}" -> "${dep}"`))
    return [
      `### ${label} — workspace dependency graph`,
      '',
      edges.length
        ? ['```', 'digraph workspaces {', ...edges, '}', '```'].join('\n')
        : 'No workspace declares another workspace as a dependency.',
      '',
    ].join('\n')
  }

  return (
    HEADER('Simon absorption — repository, package and module maps', '**SIMON-000-002**') +
    [
      'The complete file list for both sides lives in the snapshot JSON under',
      '`source.files` and `target.files`; this document is the rolled-up view.',
      'Every number here is a count of real tracked paths, and the guard test',
      'checks the roll-ups add up to the file lists they came from.',
      '',
      '## Module / area map',
      '',
      areas(d.source, 'Source'),
      areas(d.target, 'Target'),
      '## Workspace and package map',
      '',
      spaces(d.source, 'Source'),
      spaces(d.target, 'Target'),
      '## Dependency graphs',
      '',
      '### Declared — workspace to workspace',
      '',
      graph(d.source, 'Source'),
      graph(d.target, 'Target'),
      '### Observed — module imports, rolled up to areas',
      '',
      'Derived from the import, export-from, dynamic `import()` and `require()`',
      'specifiers in every tracked source file, resolved against that side’s own',
      'file list and its `tsconfig.json` path aliases. Node builtins are counted',
      'and not drawn. Edges within one area are not drawn. A relative specifier',
      'that resolves to no tracked file is counted as unresolved, never guessed at.',
      '',
      'The scan is textual, so a code sample written inside a string literal is',
      'counted as if it were an import — four fixtures under `tests/architecture`',
      'embed `from "x"` and `require("z")` and are the reason single-letter',
      'packages appear below. That is a stated limit of the method, not a package.',
      '',
      importSection(d.source, 'Source'),
      importSection(d.target, 'Target'),
      '### Observed — external packages, and whether a manifest declares them',
      '',
      'An **undeclared** row is a real defect rather than a curiosity: the import',
      'resolves today through npm’s flat `node_modules` and breaks on the day the',
      'transitive dependency that hoisted it is removed.',
      '',
      externalSection(d.source, 'Source'),
      externalSection(d.target, 'Target'),
    ].join('\n')
  )
}

function importSection(s, label) {
  const g = s.import_graph
  return [
    `#### ${label} — ${g.internal_edges.length} area edge(s) over ${g.code_files} source file(s), ${g.builtin_imports} builtin import(s), ${g.unresolved_relative_specifiers} unresolved relative, ${g.unresolved_alias_specifiers} unresolved alias`,
    '',
    g.internal_edges.length
      ? ['```', 'digraph modules {', ...g.internal_edges.map((e) => `  "${e.from}" -> "${e.to}" [label="${e.imports}"]`), '}', '```'].join(
          '\n',
        )
      : 'No import crosses an area boundary.',
    '',
  ].join('\n')
}

function externalSection(s, label) {
  const rows = s.import_graph.external_edges
  const undeclared = rows.filter((e) => !e.declared)
  return [
    `#### ${label} — ${rows.length} area/package pair(s), ${undeclared.length} undeclared`,
    '',
    undeclared.length
      ? [
          '| Area | Package | Imports | Declared |',
          '| --- | --- | ---: | --- |',
          ...undeclared.map((e) => `| \`${e.from}\` | \`${esc(e.package)}\` | ${e.imports} | **no** |`),
        ].join('\n')
      : 'Every external package imported here is declared by a manifest above it.',
    '',
  ].join('\n')
}

export function renderStack(d) {
  const rows = d.source.stack.map((s, i) => {
    const t = d.target.stack[i]
    return { capability: s.capability, s, t }
  })
  const cell = (r) =>
    r.matches === 0 ? '**no match**' : `${r.matches} — ${r.evidence.map((e) => `\`${e}\``).join(' ')}`
  return (
    HEADER('Simon absorption — technology and capability inventory', '**SIMON-000-003**') +
    [
      'Each row is a probe: a pattern run over the tracked file list of each side,',
      'with the matched paths as evidence. A row reading **no match** says that no',
      'tracked path matched that pattern in that repository — it does not say the',
      'capability is absent, because a probe is a search and not a proof. Evidence',
      `is capped at ${EVIDENCE_CAP} paths per cell; the count is not capped.`,
      '',
      '| Capability | Source | Target |',
      '| --- | --- | --- |',
      ...rows.map((r) => `| ${r.capability} | ${cell(r.s)} | ${cell(r.t)} |`),
      '',
      '## Probe patterns',
      '',
      '| Capability | Pattern |',
      '| --- | --- |',
      ...rows.map((r) => `| ${r.capability} | \`${esc(r.s.pattern)}\` |`),
      '',
    ].join('\n')
  )
}

export function renderAll(d) {
  return {
    [DOC_REPOSITORIES]: renderRepositories(d),
    [DOC_MAPS]: renderMaps(d),
    [DOC_STACK]: renderStack(d),
  }
}

/** Stable JSON: keys in insertion order, two-space indent, one trailing newline. */
export function renderSnapshot(d) {
  return `${JSON.stringify(d, null, 2)}\n`
}

// ───────────────────────────── main ─────────────────────────────

/**
 * `--check` compares the DOCUMENTS to the COMMITTED snapshot, not to a fresh run.
 *
 * Re-running `collect()` and diffing would fail every time by design: the
 * snapshot records open pull requests, a dirty-path count and an observation
 * date, and those are facts about a moment rather than about the repository.
 * A check that reds on the clock teaches everyone to ignore it, which is how a
 * guard stops guarding. What must never drift is the rendering — that the three
 * markdown documents ARE what the snapshot says — and that is deterministic,
 * needs no git and no network, and is what this compares. Refreshing the
 * baseline is a deliberate re-run with no flag.
 */
function check() {
  const snapshotPath = path.join(ROOT, SNAPSHOT)
  if (!fs.existsSync(snapshotPath)) {
    console.error(`missing: ${SNAPSHOT} — run \`node tools/simon-absorption-inventory.mjs\``)
    process.exit(1)
  }
  const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8').split('\r\n').join('\n'))
  let bad = 0
  for (const [file, text] of Object.entries(renderAll(data))) {
    const full = path.join(ROOT, file)
    const have = fs.existsSync(full) ? fs.readFileSync(full, 'utf8').split('\r\n').join('\n') : ''
    if (have !== text) {
      console.error(`stale: ${file}`)
      bad += 1
    }
  }
  if (bad) process.exit(1)
  console.log(`inventory documents match ${SNAPSHOT} (observed ${data.observed_at})`)
}

function main() {
  if (process.argv.includes('--check')) return check()
  const data = collect()
  const outputs = { [SNAPSHOT]: renderSnapshot(data), ...renderAll(data) }
  for (const [file, text] of Object.entries(outputs)) {
    const full = path.join(ROOT, file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text)
    console.log(`wrote ${file} (${text.length} bytes)`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
