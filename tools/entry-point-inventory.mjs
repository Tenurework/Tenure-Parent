#!/usr/bin/env node
/**
 * GE-000-004 — enumerate every way a request can enter the application.
 *
 * Generated from the filesystem rather than written from memory, for the same
 * reason `repository-map.md` is: a hand-maintained list of entry points is
 * wrong within a week, and a wrong list of entry points is worse than none —
 * it is the thing a reviewer trusts when asking "what is exposed?".
 *
 * What this can and cannot tell you:
 *
 *   * It reports the guards a handler *mentions*. That is a strong signal and a
 *     weak proof. `tests/security/entry-points.test.mjs` turns the important
 *     half into a proof by failing when a new handler appears with no guard at
 *     all, so an unguarded route cannot be added silently.
 *   * A guard named in a route's own file is not the only way a route can be
 *     protected — Next.js layouts guard everything nested under them. The
 *     classifier therefore walks up the directory tree and attributes an
 *     ancestor layout's guard to the page, which is why every `(app)` page
 *     reports `session` even though most page files never call `auth()`.
 *
 * Usage:  node tools/entry-point-inventory.mjs [--check]
 *   --check  exit non-zero if the committed document is out of date
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const APP_ROOT = 'apps/web/src/app'
const OUT = 'docs/architecture/entry-points.md'

/**
 * A guard is a mechanism that can refuse a request, keyed by what it proves.
 * Order matters only for display.
 */
const GUARDS = [
  { key: 'session', label: 'signed in', pattern: /\bauth\(\)|requireSession|getServerSession/ },
  { key: 'operator', label: 'platform operator', pattern: /isPlatformOperator|requireOperator/ },
  { key: 'capability', label: 'capability', pattern: /requireCapability|assertCapability|\bcan[A-Z]\w*\(|guardAdmin|requireAdmin/ },
  { key: 'tenant', label: 'tenant scope', pattern: /withTenant|resolveTenantScope|forEachInstitution|tenantScope/ },
  // Any bearer-secret comparison, not two names someone thought of once. The
  // reconcile endpoint was correctly guarded by PLATFORM_RECONCILE_SECRET and
  // reported as unguarded, because the pattern was a list rather than a shape.
  {
    key: 'shared-secret',
    label: 'shared secret',
    pattern: /process\.env\.[A-Z0-9_]*SECRET|JOB_SECRET|CRON_SECRET/,
  },
  { key: 'url-token', label: 'unguessable URL token', pattern: /params.*token|\btoken\b.*findUnique/s },
]

/**
 * Tracked AND untracked-but-not-ignored.
 *
 * Plain `git ls-files` lists only tracked files, which made this blind to the
 * one file that matters most: a brand-new route. It could not be seen until the
 * commit that introduced it had already passed the guard, so the check ran
 * against every entry point except the one being added. A security check that
 * only inspects code it has seen before is not a security check.
 */
const listFiles = (glob) =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', glob], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)

const read = (f) => fs.readFileSync(f, 'utf8')

/** Strip comments — a guard named in prose is not a guard. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')

/**
 * Guards that apply to a file, including those inherited from ancestor layouts.
 * This is what makes the table honest about Next.js: `(app)/orgs/[slug]/page.tsx`
 * calls no guard of its own and is nonetheless behind a session.
 */
function guardsFor(file) {
  const found = new Set()
  const sources = [file]

  let dir = path.dirname(file)
  while (dir.startsWith(APP_ROOT)) {
    const layout = path.join(dir, 'layout.tsx')
    if (layout !== file && fs.existsSync(layout)) sources.push(layout)
    dir = path.dirname(dir)
  }

  for (const src of sources) {
    const text = code(read(src))
    for (const g of GUARDS) if (g.pattern.test(text)) found.add(g.key)
  }
  return [...found]
}

const routeOf = (file) =>
  file
    .replace(`${APP_ROOT}`, '')
    .replace(/\/(page|route)\.tsx?$/, '')
    .replace(/^$/, '/') || '/'

const verbsOf = (file) =>
  [...read(file).matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm)]
    .map((m) => m[1])

/**
 * Each exported async function in a "use server" module, with the guards its
 * own body reaches — directly, or through a helper defined in the same module.
 *
 * The body is taken by brace-matching from the opening `{`. That is not a
 * parser and would not survive a brace inside a string or regex literal in
 * these files; it survives the ones that are here, and the test that consumes
 * this fails loudly rather than silently under-reporting if it ever stops
 * matching (an unbalanced body yields the rest of the file, which over-reports
 * guards — so the failure direction is a false *pass* on this function alone,
 * caught by the module-level guard assertion that runs alongside it).
 */
function exportedActionsOf(file) {
  const text = code(read(file))
  const out = []

  // Helpers defined in the module, and the guards each reaches. An action that
  // calls `requireOfficer(...)` is guarded by whatever that helper checks.
  const helpers = new Map()
  for (const m of text.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)) {
    const body = braceBody(text, m.index)
    helpers.set(m[1], GUARDS.filter((g) => g.pattern.test(body)).map((g) => g.key))
  }

  for (const m of text.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) {
    const body = braceBody(text, m.index)
    const guards = new Set(GUARDS.filter((g) => g.pattern.test(body)).map((g) => g.key))
    for (const [name, keys] of helpers) {
      if (name !== m[1] && new RegExp(`\\b${name}\\s*\\(`).test(body)) keys.forEach((k) => guards.add(k))
    }
    out.push({ name: m[1], guards: [...guards] })
  }
  return out
}

/** The `{...}` block that follows `from`, by brace matching. */
function braceBody(text, from) {
  const open = text.indexOf('{', from)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1)
  }
  return text.slice(open)
}

export function collect() {
  const apiRoutes = listFiles(`${APP_ROOT}/**/route.ts`).sort().map((file) => ({
    kind: 'api',
    file,
    route: routeOf(file),
    verbs: verbsOf(file),
    guards: guardsFor(file),
  }))

  const pages = listFiles(`${APP_ROOT}/**/page.tsx`).sort().map((file) => ({
    kind: 'page',
    file,
    route: routeOf(file),
    verbs: ['GET'],
    guards: guardsFor(file),
  }))

  const actionFiles = listFiles(`${APP_ROOT}/**/*.ts`)
    .concat(listFiles(`${APP_ROOT}/**/*.tsx`))
    .filter((f) => /^\s*["']use server["']/m.test(read(f)))
    .sort()

  // Every exported async function in a "use server" file is a POST endpoint
  // reachable by anyone who can guess its action id. They are enumerated one at
  // a time, not per file: a module where one of twenty-one actions checks a
  // capability would otherwise report "capability" for all twenty-one, which is
  // precisely the mistake this inventory exists to prevent.
  const actions = actionFiles.map((file) => ({
    kind: 'action',
    file,
    route: file.replace(`${APP_ROOT}/`, ''),
    exported: exportedActionsOf(file),
    guards: guardsFor(file),
  }))

  return { apiRoutes, pages, actions }
}

/** Entry points reachable with no proof of anything. Deliberately explicit. */
export const INTENTIONALLY_PUBLIC = new Set([
  '/api/auth/[...nextauth]', // NextAuth's own handler — sign-in cannot require sign-in
  '/api/health', // ALB target-group probe, pre-authentication by necessity
  '/signin', // the sign-in page
])

/**
 * Server actions that legitimately guard nothing.
 *
 * Sign-out is the only one, and it is safe for the reason that generalises: it
 * takes no argument, reads no tenant row, and its effect on someone with no
 * session is to leave them with no session. An action qualifies here only if
 * calling it anonymously is indistinguishable from not calling it.
 */
export const PUBLIC_ACTIONS = new Set(['(app)/actions.ts → signOutAction'])

function render({ apiRoutes, pages, actions }) {
  const row = (e) =>
    `| \`${e.route}\` | ${e.verbs?.join(', ') ?? 'POST'} | ${e.guards.length ? e.guards.map((g) => `\`${g}\``).join(' + ') : '**none**'} |`

  const unguarded = [...apiRoutes, ...pages].filter((e) => e.guards.length === 0)
  const totalActions = actions.reduce((n, a) => n + a.exported.length, 0)

  // An action reachable by anyone who can guess its id. Layout guards do NOT
  // apply to server actions: a POST to an action id never renders the layout.
  const unguardedActions = actions.flatMap((a) =>
    a.exported.filter((fn) => fn.guards.length === 0).map((fn) => ({ module: a.route, name: fn.name }))
  )

  return `<!-- Generated by tools/entry-point-inventory.mjs. Do not edit by hand. -->
# Entry points

GE-000-004. Every way a request can enter \`apps/web\`, and what refuses it.

Generated from the filesystem. \`npm run test:platform\` regenerates this and
fails if the committed copy is stale, so it cannot quietly go out of date, and
fails if a handler appears with no guard and no entry on the public allowlist.

**${apiRoutes.length} API routes · ${pages.length} pages · ${actions.length} server-action modules exporting ${totalActions} actions.**

## What a guard means here

| Guard | Proves |
|---|---|
${GUARDS.map((g) => `| \`${g.key}\` | ${g.label} |`).join('\n')}

Guards are attributed from the handler **and every ancestor layout**, because a
Next.js layout guards everything nested beneath it. Most \`(app)\` pages contain
no guard of their own; they are behind \`(app)/layout.tsx\`.

## API routes

| Route | Verbs | Guards |
|---|---|---|
${apiRoutes.map(row).join('\n')}

## Pages

| Route | Verbs | Guards |
|---|---|---|
${pages.map(row).join('\n')}

## Server actions

Each exported async function in a \`"use server"\` module is a POST endpoint.
They do not appear in \`next build\` output and are easy to forget when reasoning
about exposure, which is why they are counted here.

**A layout guard does not protect a server action.** A POST to an action id
never renders the layout, so unlike the pages above, each action carries its own
guard or carries none. They are therefore listed individually rather than by
module — a module where one of twenty-one actions checks a capability would
otherwise report \`capability\` for all twenty-one.

${actions
  .filter((a) => a.exported.length)
  .map(
    (a) => `### \`${a.route}\`

| Action | Guards |
|---|---|
${a.exported.map((fn) => `| \`${fn.name}\` | ${fn.guards.length ? fn.guards.map((g) => `\`${g}\``).join(' + ') : '**none**'} |`).join('\n')}`
  )
  .join('\n\n')}

### Actions with no guard of their own

${
  unguardedActions.length === 0
    ? '_None._'
    : unguardedActions.map((a) => `- \`${a.module}\` → \`${a.name}\``).join('\n')
}

## Reachable without authentication

${unguarded.length === 0 ? '_None beyond the allowlist below._' : unguarded.map((e) => `- \`${e.route}\``).join('\n')}

Allowlisted as necessarily public:

${[...INTENTIONALLY_PUBLIC].map((r) => `- \`${r}\``).join('\n')}

## Scheduled, and non-HTTP

| Path | Trigger | Auth |
|---|---|---|
| \`POST /api/jobs/reminders\` | EventBridge rule \`tenure-pilot-deliverable-reminders\`, \`cron(0 13 * * ? *)\`, via API destination (\`infrastructure/terraform/scheduler.tf\`) | \`JOB_SECRET\` bearer token |

There are no webhooks, no realtime/WebSocket paths and no queue consumers.
See \`subsystem-paths.md\` for what that last one implies about the five SQS
queues that exist in AWS.

## Import and export

| Path | Direction | Guard |
|---|---|---|
| \`GET /api/platform/export/[slug]\` | export, whole tenant, JSON | \`operator\`; 404 rather than 403 for everyone else |
| \`GET /api/calendar/ics/[token]\` | export, one calendar, iCal | unguessable per-user token, no session |
| \`GET /api/templates/budget\` | export, CSV template | \`session\` |
| \`apps/web/scripts/seed.mjs\` | import, offline | none — it is a script, not an endpoint |

There is no import endpoint. A tenant's data can leave the product but cannot
be loaded into it over HTTP, which is a gap against the Bible's tenant
provisioning and is owned by GE-060.
`
}

const generated = render(collect())

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (current !== generated) {
    console.error(`::error::${OUT} is stale. Run: node tools/entry-point-inventory.mjs`)
    process.exit(1)
  }
  console.log(`${OUT} is up to date.`)
} else {
  fs.writeFileSync(OUT, generated)
  console.log(`Wrote ${OUT}`)
}
