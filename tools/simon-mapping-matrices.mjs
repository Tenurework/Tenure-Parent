#!/usr/bin/env node
/**
 * SIMON-000-015 — the route / API / event / workflow / permission / role /
 * report / integration mapping matrices, for BOTH systems.
 *
 *   node tools/simon-mapping-matrices.mjs           # write
 *   node tools/simon-mapping-matrices.mjs --check   # fail if stale
 *
 * "Both systems" is the pilot (`Tenurework/Tenure`) and this repository, each
 * read at the commit `tools/simon-absorption-inventory.mjs` pinned. The commits
 * are taken out of that generator's own snapshot rather than resolved again,
 * for the reason the rest of this family states: an analysis that re-pins the
 * baseline underneath itself produces two documents that describe three trees.
 *
 * ── What makes this a MATRIX rather than a second file list ─────────────────
 *
 * `docs/architecture/simon-repository-maps.md` (SIMON-000-002) already lists
 * every path in both trees, and `simon-capability-disposition.md`
 * (SIMON-000-006) already compares them path by path. Neither is a mapping
 * matrix, because both key on the PATH. A matrix has to key on the thing's own
 * IDENTITY — the URL a route answers on, the method an API exposes, the state
 * a workflow can be in, the name of a role — or all it can report is that a
 * file moved. So every matrix below derives an identity, maps the two sides by
 * that identity, and only then cites the paths.
 *
 * Each row lands in one of four states, and the vocabulary is closed:
 *
 *   BOTH — same implementation   both sides carry it and every file backing it
 *                                is byte-identical after line-ending normalisation
 *   BOTH — differs               both sides carry it and at least one backing
 *                                file differs in content
 *   SOURCE ONLY                  the pilot has it and this repository does not —
 *                                the absorption items
 *   TARGET ONLY                  this repository has it and the pilot does not
 *
 * A side that could not be read at all is `UNKNOWN` with the command that would
 * answer it, never an empty matrix. "We looked and found nothing" and "we could
 * not look" are different answers.
 *
 * ── Nothing here reads a row ────────────────────────────────────────────────
 *
 * Ledger rule 8: the source repository carries a live pilot's real student
 * records. This reads declarations, paths, exported names and enum members.
 * `Tier1/` is never opened. Every token printed comes from a closed set —
 * a declared name or a member of a declared enumeration — so there is no
 * pattern here that could print a value out of somebody's row.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROOT, SNAPSHOT as BASELINE_SNAPSHOT, byCodepoint, readBlobs } from './simon-absorption-inventory.mjs'
import { parseSchema } from './simon-data-dictionary.mjs'

export { ROOT }

export const SNAPSHOT = 'docs/architecture/simon-mapping-matrices.json'
export const DOC = 'docs/architecture/simon-mapping-matrices.md'

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

/** The same digest the disposition analysis uses: content, with the line ending normalised away. */
export const digestOf = (text) => crypto.createHash('sha256').update(text.split('\r\n').join('\n'), 'utf8').digest('hex').slice(0, 16)

export const STATES = ['BOTH — same implementation', 'BOTH — differs', 'SOURCE ONLY', 'TARGET ONLY']

/** Where the app-router trees live. Both repositories carry both apps at the same paths. */
export const APP_ROOTS = [
  { app: 'web', prefix: 'apps/web/src/app/' },
  { app: 'system-studio', prefix: 'apps/system-studio/src/app/' },
]

/**
 * A Next.js app-router file path → the URL it answers on.
 *
 * `(group)` segments are routing groups and contribute nothing to the URL —
 * dropping them is what turns a path into an identity, and it is why
 * `apps/web/src/app/(app)/orgs/[slug]/page.tsx` and a hypothetical
 * `apps/web/src/app/(dash)/orgs/[slug]/page.tsx` are correctly the SAME route
 * rather than two. `[param]` and `[...rest]` are kept, because a parameter is
 * part of the URL's shape.
 */
export function routeUrlOf(file) {
  const root = APP_ROOTS.find((r) => file.startsWith(r.prefix))
  if (!root) return null
  const rel = file.slice(root.prefix.length)
  const segments = rel.split('/').slice(0, -1).filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('_'))
  return { app: root.app, url: '/' + segments.join('/') }
}

/** The HTTP methods a route module exports, read off the declarations. */
export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
export function methodsOf(text) {
  if (!text) return []
  const found = new Set()
  for (const m of text.matchAll(/^\s*export\s+(?:async\s+)?(?:function|const)\s+([A-Z]+)\b/gm)) {
    if (HTTP_METHODS.includes(m[1])) found.add(m[1])
  }
  for (const m of text.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop().trim()))
      if (HTTP_METHODS.includes(name)) found.add(name)
  }
  // `export const { GET, POST } = handlers` — how NextAuth mounts its catch-all
  // route, and the shape the first version of this scan missed entirely. Its row
  // read `NONE-EXPORTED` for the one endpoint the whole session depends on.
  for (const m of text.matchAll(/^\s*export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=/gm)) {
    for (const name of m[1].split(',').map((s) => s.trim().split(':').pop().trim()))
      if (HTTP_METHODS.includes(name)) found.add(name)
  }
  return [...found].sort(byCodepoint)
}

/**
 * The permission-deciding symbols a module exports.
 *
 * A permission in this codebase is a FUNCTION that answers "may this actor do
 * this", so the matrix keys on the exported name. The shapes are stated rather
 * than guessed at: `can…`, `may…`, `assert…`, `require…`, `is…Role`,
 * `…Authority`, `decide…`, `guard…`. A name that only mentions permissions
 * without deciding one (`APPROVAL_DIGEST_FIELDS`) is not a permission, which is
 * why this is a list of verbs rather than a substring search for "permission".
 */
export const PERMISSION_NAME = /^(?:can|may|assert|require|guard|decide)[A-Z]|^is[A-Z][A-Za-z0-9]*(?:Role|Admin|Owner|Member|Allowed|Authorized)$|Authority(?:For)?$|^hasPermission$/
export function permissionExportsOf(text) {
  if (!text) return []
  const names = new Set()
  for (const m of text.matchAll(/^\s*export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of text.matchAll(/^\s*export\s*\{([^}]*)\}/gm))
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop().trim()))
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
  return [...names].filter((n) => PERMISSION_NAME.test(n)).sort(byCodepoint)
}

/**
 * The scheduled and queued work each tree declares.
 *
 * Three sources, because "event" is three different things in this platform and
 * reporting only one of them would be the same defect as reporting none:
 *   cron endpoint   a route under `app/api/jobs/`, which is how this codebase
 *                   expresses a scheduled job that something else triggers
 *   workflow cron   a `cron:` line in a GitHub Actions workflow — the thing
 *                   that does the triggering
 *   queue / rule    an `aws_sqs_queue` or `aws_cloudwatch_event_rule` resource
 *                   in Terraform, which is the deployed half
 */
export const EVENT_KINDS = ['cron endpoint', 'workflow cron', 'queue or rule']
export function eventsOf(files, contentOf) {
  const out = []
  for (const f of files.filter((x) => /\/app\/api\/jobs\/.*\/route\.tsx?$/.test(x)).sort(byCodepoint)) {
    const url = routeUrlOf(f)
    if (url) out.push({ identity: `cron endpoint ${url.url}`, kind: 'cron endpoint', files: [f] })
  }
  for (const f of files.filter((x) => /^\.github\/workflows\/.*\.ya?ml$/.test(x)).sort(byCodepoint)) {
    const text = contentOf(f)
    if (!text) continue
    for (const m of text.matchAll(/-\s*cron:\s*['"]([^'"]+)['"]/g))
      out.push({ identity: `workflow cron ${f.split('/').pop()} @ ${m[1]}`, kind: 'workflow cron', files: [f] })
  }
  for (const f of files.filter((x) => /\.tf$/.test(x)).sort(byCodepoint)) {
    const text = contentOf(f)
    if (!text) continue
    for (const m of text.matchAll(/^resource\s+"(aws_sqs_queue|aws_cloudwatch_event_rule|aws_sns_topic)"\s+"([A-Za-z0-9_-]+)"/gm))
      out.push({ identity: `${m[1]}.${m[2]}`, kind: 'queue or rule', files: [f] })
  }
  return out
}

/**
 * Which declared enumerations are workflow states and which are roles.
 *
 * The same selector discipline `tools/simon-convergence-inventory.mjs` states
 * for its derived probes, and for the same reason: a hand-typed list of role
 * names went stale the moment the schema changed, and two of the six names in
 * it occurred nowhere in either tree. `Status` is the workflow axis, `Role` and
 * `Scope` the role axis. `Kind`, `Type` and `Category` are structural
 * discriminators the requirement does not name, and are left out deliberately.
 */
export const WORKFLOW_ENUM = /Status$/
export const ROLE_ENUM = /(?:Role|Scope)$/

/** A path that presents or produces a report. Stated as a pattern, printed beside the table. */
export const REPORT_PATH = /report/i

/**
 * Outbound integrations, by the thing each one integrates WITH.
 *
 * Keyed on the provider, not on the file, so "the pilot mails through SES and
 * this repository does too" is one row rather than two file lists. Detected two
 * ways — a declared dependency in a manifest, and a module that imports or
 * names the provider's SDK — because an integration can exist as either.
 */
export const INTEGRATIONS = [
  { provider: 'Amazon SES (email)', match: /@aws-sdk\/client-ses|\bSESv?2?Client\b|\bSendEmailCommand\b/ },
  { provider: 'Amazon S3 (object storage)', match: /@aws-sdk\/client-s3|\bS3Client\b/ },
  { provider: 'Amazon SQS (queue)', match: /@aws-sdk\/client-sqs|\bSQSClient\b/ },
  { provider: 'Amazon Cognito (identity)', match: /@aws-sdk\/client-cognito|\bCognitoIdentityProviderClient\b/ },
  { provider: 'AWS Secrets Manager', match: /@aws-sdk\/client-secrets-manager|\bSecretsManagerClient\b/ },
  { provider: 'Anthropic (AI)', match: /@anthropic-ai\/|\bAnthropic\(/ },
  { provider: 'Amazon Bedrock (AI)', match: /@aws-sdk\/client-bedrock|\bBedrockRuntimeClient\b/ },
  { provider: 'Stripe (payments)', match: /['"]stripe['"]|\bnew Stripe\(/ },
  { provider: 'Google Calendar / OAuth', match: /googleapis|accounts\.google\.com|\bGoogleProvider\b/ },
  { provider: 'Microsoft / Azure AD', match: /@azure\/|login\.microsoftonline\.com|\bAzureADProvider\b/ },
  { provider: 'Slack', match: /@slack\/|hooks\.slack\.com/ },
  { provider: 'Prisma (database client)', match: /@prisma\/client/ },
  { provider: 'NextAuth (session)', match: /\bnext-auth\b/ },
]

/** The commit each side is read at — the baseline's own key, never re-resolved here. */
export const commitOf = (baselineSide) => baselineSide.pinned_commit ?? baselineSide.head_commit ?? null

const SCANNABLE = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|tf|prisma)$/
const NEVER_OPENED = /^Tier1\//

/**
 * One side, read at its pinned commit.
 *
 * Returns `{ unknown }` rather than empty matrices when the tree cannot be read,
 * so a row can never say "the pilot does not have this" because a git object was
 * missing.
 */
export function side(label, pinned) {
  const commit = commitOf(pinned)
  if (!commit) {
    return {
      label,
      pinned_commit: null,
      unknown: {
        value: 'UNKNOWN',
        why: `${BASELINE_SNAPSHOT} records neither pinned_commit nor head_commit for the ${label} side`,
        command: 'node tools/simon-absorption-inventory.mjs',
      },
    }
  }
  const files = pinned.files.filter((f) => !NEVER_OPENED.test(f))
  const wanted = files.filter((f) => SCANNABLE.test(f))
  const blobs = readBlobs(commit, wanted)
  if (blobs.size === 0) {
    return {
      label,
      pinned_commit: commit,
      unknown: {
        value: 'UNKNOWN',
        why: `no file of the ${label} tree is readable at ${commit} — the commit is not in this clone`,
        command: `git fetch --no-tags --depth=1 live ${commit}`,
      },
    }
  }
  const contentOf = (f) => blobs.get(f)
  const items = { routes: [], apis: [], events: [], workflow_states: [], permissions: [], roles: [], reports: [], integrations: [] }

  // Routes — every app-router page, keyed on the URL it answers on.
  for (const f of files.filter((x) => /\/page\.tsx?$/.test(x)).sort(byCodepoint)) {
    const r = routeUrlOf(f)
    if (r) items.routes.push({ identity: `${r.app} ${r.url}`, files: [f] })
  }

  // APIs — every route handler, keyed on URL and the methods it exposes.
  for (const f of files.filter((x) => /\/app\/api\/.*\/route\.tsx?$/.test(x)).sort(byCodepoint)) {
    const r = routeUrlOf(f)
    if (!r) continue
    const methods = methodsOf(contentOf(f))
    // A handler that exports no method at all is still a row: "we looked and
    // found no method" is a finding about that file, not a reason to drop it.
    for (const method of methods.length ? methods : ['NONE-EXPORTED'])
      items.apis.push({ identity: `${method} ${r.url}`, files: [f], detail: r.app })
  }

  // Events. The per-kind counts are recorded including the zeros, so a kind
  // that found nothing reads as a search that ran rather than as one nobody did.
  const events = eventsOf(files, contentOf)
  for (const e of events) items.events.push(e)
  const eventKinds = Object.fromEntries(EVENT_KINDS.map((k) => [k, events.filter((e) => e.kind === k).length]))

  // Workflow states and roles — declared enumerations, member by member.
  for (const f of files.filter((x) => /schema\.prisma$/.test(x)).sort(byCodepoint)) {
    const text = contentOf(f)
    if (!text) continue
    for (const e of parseSchema(text).enums) {
      const axis = WORKFLOW_ENUM.test(e.name) ? 'workflow_states' : ROLE_ENUM.test(e.name) ? 'roles' : null
      if (!axis) continue
      // Compared as a DECLARATION, not through the digest of the file it lives
      // in. `ApprovalStatus.APPROVED` is declared identically on both sides; the
      // schema file around it differs, and letting the file decide would report
      // every state in the platform as divergent for a reason that has nothing
      // to do with the state.
      for (const member of e.values) items[axis].push({ identity: `${e.name}.${member}`, files: [f], detail: e.name, compare: 'declaration' })
    }
  }

  // Permissions — the deciding symbols, keyed on the exported name.
  for (const f of files.filter((x) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(x)).sort(byCodepoint)) {
    for (const name of permissionExportsOf(contentOf(f))) items.permissions.push({ identity: name, files: [f], detail: f })
  }

  // Reports.
  for (const f of files.filter((x) => REPORT_PATH.test(x)).sort(byCodepoint)) items.reports.push({ identity: f, files: [f] })

  // Integrations — keyed on the provider, with every file that evidences it.
  for (const spec of INTEGRATIONS) {
    const hits = wanted.filter((f) => spec.match.test(contentOf(f) ?? '')).sort(byCodepoint)
    if (hits.length) items.integrations.push({ identity: spec.provider, files: hits, detail: `${hits.length} file(s)` })
  }

  const digests = new Map()
  for (const [f, text] of blobs) digests.set(f, digestOf(text))
  return { label, pinned_commit: commit, files_read: blobs.size, event_kinds: eventKinds, items, digests }
}

/** Collapse rows that share an identity — an identity is a key, so it appears once. */
function byIdentity(list) {
  const out = new Map()
  for (const row of list ?? []) {
    const at = out.get(row.identity)
    if (at) {
      at.files = [...new Set([...at.files, ...row.files])].sort(byCodepoint)
      continue
    }
    out.set(row.identity, {
      identity: row.identity,
      files: [...row.files].sort(byCodepoint),
      detail: row.detail ?? null,
      kind: row.kind ?? null,
      compare: row.compare ?? 'files',
    })
  }
  return out
}

/**
 * One matrix: the two sides joined on identity, with a state per row.
 *
 * `BOTH — same implementation` requires every backing file to be byte-identical
 * after line-ending normalisation AND to be present on both sides. Where a file
 * is on one side only, the row differs — a route backed by an extra component
 * here is not the same implementation as one that is not.
 */
export function matrixOf(axis, sourceItems, targetItems, sourceDigests, targetDigests) {
  const s = byIdentity(sourceItems)
  const t = byIdentity(targetItems)
  const rows = []
  for (const identity of [...new Set([...s.keys(), ...t.keys()])].sort(byCodepoint)) {
    const a = s.get(identity)
    const b = t.get(identity)
    let state
    let why
    if (a && !b) {
      state = 'SOURCE ONLY'
      why = 'the pilot carries it and this repository does not'
    } else if (!a && b) {
      state = 'TARGET ONLY'
      why = 'this repository carries it and the pilot does not'
    } else if (a.compare === 'declaration') {
      state = 'BOTH — same implementation'
      why = 'both trees declare it, in the same enumeration, with the same name'
    } else {
      const shared = a.files.filter((f) => b.files.includes(f))
      const onlySource = a.files.filter((f) => !b.files.includes(f))
      const onlyTarget = b.files.filter((f) => !a.files.includes(f))
      const divergent = shared.filter((f) => sourceDigests.get(f) !== targetDigests.get(f))
      if (onlySource.length === 0 && onlyTarget.length === 0 && divergent.length === 0) {
        state = 'BOTH — same implementation'
        why = `all ${shared.length} backing file(s) are byte-identical after line-ending normalisation`
      } else {
        state = 'BOTH — differs'
        why =
          [
            divergent.length ? `${divergent.length} shared file(s) differ in content` : null,
            onlySource.length ? `${onlySource.length} backing file(s) only in the pilot` : null,
            onlyTarget.length ? `${onlyTarget.length} only here` : null,
          ]
            .filter(Boolean)
            .join(', ') || 'the backing files differ'
      }
    }
    rows.push({
      axis,
      identity,
      state,
      why,
      // Which rule decided this row: the digests of its backing files, or the
      // declaration itself. Recorded so the guard can check that only the two
      // enumeration axes are compared as declarations.
      compare: (a ?? b).compare ?? 'files',
      source_files: a ? a.files.slice(0, 4) : [],
      target_files: b ? b.files.slice(0, 4) : [],
      source_file_count: a ? a.files.length : 0,
      target_file_count: b ? b.files.length : 0,
      detail: (a ?? b).detail ?? null,
    })
  }
  return rows
}

export const AXES = [
  { axis: 'route', key: 'routes', title: 'Routes', what: 'every app-router page, keyed on the URL it answers on' },
  { axis: 'API', key: 'apis', title: 'APIs', what: 'every route handler, keyed on HTTP method and URL' },
  { axis: 'event', key: 'events', title: 'Events', what: 'cron endpoints, workflow cron schedules, and deployed queues, topics and rules' },
  { axis: 'workflow', key: 'workflow_states', title: 'Workflow states', what: 'every member of every declared `*Status` enumeration' },
  { axis: 'permission', key: 'permissions', title: 'Permissions', what: 'every exported symbol that decides whether an actor may act' },
  { axis: 'role', key: 'roles', title: 'Roles', what: 'every member of every declared `*Role` / `*Scope` enumeration' },
  { axis: 'report', key: 'reports', title: 'Reports', what: 'every path that presents or produces a report' },
  { axis: 'integration', key: 'integrations', title: 'Integrations', what: 'every outbound system, keyed on the provider' },
]

export function collect() {
  const baseline = readJson(BASELINE_SNAPSHOT)
  const source = side('source', baseline.source)
  const target = side('target', baseline.target)
  const matrices = {}
  for (const a of AXES) {
    matrices[a.key] =
      source.unknown || target.unknown
        ? []
        : matrixOf(a.axis, source.items[a.key], target.items[a.key], source.digests, target.digests)
  }
  const totals = {}
  for (const a of AXES) {
    const rows = matrices[a.key]
    totals[a.key] = Object.fromEntries(STATES.map((st) => [st, rows.filter((r) => r.state === st).length]))
    totals[a.key].rows = rows.length
  }
  return {
    schema: 1,
    generated_by: 'tools/simon-mapping-matrices.mjs',
    closes: ['SIMON-000-015'],
    baseline_snapshot: BASELINE_SNAPSHOT,
    states: STATES,
    axes: AXES.map((a) => ({ ...a })),
    selectors: {
      workflow_enum: String(WORKFLOW_ENUM),
      role_enum: String(ROLE_ENUM),
      permission_name: String(PERMISSION_NAME),
      report_path: String(REPORT_PATH),
      http_methods: HTTP_METHODS,
      integrations: INTEGRATIONS.map((i) => ({ provider: i.provider, match: String(i.match) })),
    },
    source: { label: 'source', pinned_commit: source.pinned_commit, files_read: source.files_read ?? 0, event_kinds: source.event_kinds ?? null, unknown: source.unknown ?? null },
    target: { label: 'target', pinned_commit: target.pinned_commit, files_read: target.files_read ?? 0, event_kinds: target.event_kinds ?? null, unknown: target.unknown ?? null },
    matrices,
    totals,
  }
}

// ───────────────────────────────── render ─────────────────────────────────

const esc = (s) => String(s).split('|').join('\\|')
const cell = (list) => (list.length ? list.map((x) => `\`${esc(x)}\``).join('<br>') : '—')

export function render(d) {
  const L = []
  L.push('# Simon absorption — route, API, event, workflow, permission, role, report and integration matrices')
  L.push('')
  L.push('<!-- Generated by tools/simon-mapping-matrices.mjs. Do not edit by hand. -->')
  L.push('')
  L.push('SIMON-000-015. Both systems, each at the commit `tools/simon-absorption-inventory.mjs` pinned.')
  L.push('')
  L.push(
    'Every matrix keys on the thing’s own IDENTITY — the URL a route answers on, the method an API exposes, ' +
      'the state a workflow can be in, the name of a role — and not on the file path. A table keyed on the path ' +
      'can only report that a file moved, which the repository maps already say.',
  )
  L.push('')
  L.push('No row of anybody’s data is read. Declarations, paths, exported names and enum members only; `Tier1/` is never opened.')
  L.push('')
  L.push('## The two trees')
  L.push('')
  L.push('| Side | Commit | Files read |')
  L.push('| --- | --- | ---: |')
  for (const s of [d.source, d.target]) {
    L.push(
      `| ${s.label} | \`${s.pinned_commit ?? 'UNKNOWN'}\` | ` +
        `${s.unknown ? `**UNKNOWN** — ${esc(s.unknown.why)}. Answer it with \`${esc(s.unknown.command)}\`.` : s.files_read} |`,
    )
  }
  L.push('')
  L.push('## The four states')
  L.push('')
  L.push('| State | Meaning |')
  L.push('| --- | --- |')
  L.push('| `BOTH — same implementation` | both sides carry it and every backing file is byte-identical after line-ending normalisation |')
  L.push('| `BOTH — differs` | both sides carry it and at least one backing file differs, or exists on one side only |')
  L.push('| `SOURCE ONLY` | the pilot has it and this repository does not — the absorption items |')
  L.push('| `TARGET ONLY` | this repository has it and the pilot does not |')
  L.push('')
  L.push('## Summary')
  L.push('')
  L.push('| Matrix | Rows | ' + STATES.map((s) => `\`${s}\``).join(' | ') + ' |')
  L.push('| --- | ---: | ' + STATES.map(() => '---:').join(' | ') + ' |')
  for (const a of AXES) {
    const t = d.totals[a.key]
    L.push(`| ${a.title} | ${t.rows} | ` + STATES.map((s) => t[s]).join(' | ') + ' |')
  }
  L.push('')
  for (const a of AXES) {
    const rows = d.matrices[a.key]
    L.push(`## ${a.title}`)
    L.push('')
    L.push(`${a.what}. ${rows.length} row(s).`)
    L.push('')
    if (a.key === 'workflow_states') L.push(`Selector: \`${esc(d.selectors.workflow_enum)}\` over declared enumerations.`)
    if (a.key === 'roles') L.push(`Selector: \`${esc(d.selectors.role_enum)}\` over declared enumerations.`)
    if (a.key === 'permissions') L.push(`Selector: \`${esc(d.selectors.permission_name)}\` over exported names.`)
    if (a.key === 'reports') L.push(`Selector: \`${esc(d.selectors.report_path)}\` over paths.`)
    if (a.key === 'events') {
      const line = (s) =>
        s.event_kinds ? EVENT_KINDS.map((k) => `${k} **${s.event_kinds[k]}**`).join(', ') : '**UNKNOWN** — the tree could not be read'
      L.push(`Kinds probed, source: ${line(d.source)}. Target: ${line(d.target)}. A zero is a search that ran.`)
    }
    if (a.key === 'permissions' || a.key === 'roles' || a.key === 'reports' || a.key === 'workflow_states' || a.key === 'events') L.push('')
    if (rows.length === 0) {
      L.push('**UNKNOWN** — a side could not be read, so this matrix is not a finding of "nothing". See the table above.')
      L.push('')
      continue
    }
    L.push('| Identity | State | Why | Source | Target |')
    L.push('| --- | --- | --- | --- | --- |')
    for (const r of rows) {
      L.push(
        `| \`${esc(r.identity)}\` | \`${r.state}\` | ${esc(r.why)} | ` +
          `${cell(r.source_files)}${r.source_file_count > r.source_files.length ? ` (+${r.source_file_count - r.source_files.length})` : ''} | ` +
          `${cell(r.target_files)}${r.target_file_count > r.target_files.length ? ` (+${r.target_file_count - r.target_files.length})` : ''} |`,
      )
    }
    L.push('')
  }
  L.push('## Honest limits')
  L.push('')
  L.push('- Every scan here is TEXTUAL, like the rest of this family. A route mounted at runtime, a handler re-exported through a barrel, or a permission function reached through a variable is invisible to it.')
  L.push('- `BOTH — same implementation` is a claim about the BACKING FILES of a row, not about behaviour. Two byte-identical route modules can still behave differently if what they import differs, and the disposition matrix is where that is compared capability by capability.')
  L.push('- The permission axis keys on the exported NAME. A permission decided inline inside a handler, with no exported symbol, is not a row here — it is a finding of `docs/architecture/simon-hardcoded-assumptions.md` instead.')
  L.push('- The integration axis detects a provider by its SDK or endpoint appearing in a scannable file. A provider reached only through an environment variable read at runtime would not be detected, and would be `SOURCE ONLY`/absent rather than reported as unknown.')
  L.push('')
  return L.join('\n') + '\n'
}

function main() {
  const d = collect()
  const check = process.argv.includes('--check')
  const files = [
    [DOC, render(d)],
    [SNAPSHOT, JSON.stringify(d, null, 2) + '\n'],
  ]
  if (check) {
    for (const [rel, want] of files) {
      const full = path.join(ROOT, rel)
      const have = fs.existsSync(full) ? fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n') : ''
      if (have !== want) {
        console.error(`stale — ${rel} is not what the pinned trees now say. Re-run without --check.`)
        process.exit(1)
      }
    }
    console.log('ok — 2 artifacts match the pinned trees')
  } else {
    for (const [rel, want] of files) {
      fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true })
      fs.writeFileSync(path.join(ROOT, rel), want)
    }
    console.log(`wrote ${DOC} and ${SNAPSHOT}`)
  }
  console.log(
    'mapping matrices: ' +
      AXES.map((a) => `${a.axis} ${d.totals[a.key].rows}`).join(', ') +
      `; source-only ${AXES.reduce((n, a) => n + d.totals[a.key]['SOURCE ONLY'], 0)}`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
