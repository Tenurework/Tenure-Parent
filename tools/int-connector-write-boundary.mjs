#!/usr/bin/env node
/**
 * Which domain owns each piece of the integration plane, and what that plane is
 * allowed to write — the two halves of the integration Bible's INT-000-004,
 * derived from the tree rather than asserted about it.
 *
 * The Bible states the prohibition as an invariant in §2: "No connector can
 * directly write private domain tables or post ledger rows. It invokes
 * authorized typed commands." §26 repeats it as a prohibited shortcut ("let
 * connectors write domain tables or ledger rows"). Both sentences are about a
 * boundary, and a boundary that is described in a document is a boundary that
 * holds until the next commit. So this computes it.
 *
 * ── Why "domain ownership" is derived and not declared here ─────────────────
 *
 * `tools/ownership-map.mjs` already assigns every source file in the repository
 * to exactly one of fourteen platform domains, and
 * `tests/architecture/ownership.test.mjs` fails the build on an orphan. A second
 * ownership table for the integration plane would be a second authority on the
 * same question, and the repository has already paid for having two parsers of
 * one thing. So the plane's ownership is READ from that map: this file adds no
 * ownership of its own, and its first check is that every module in the plane
 * has exactly one owning domain there.
 *
 * ── What "the integration plane" means, exactly ─────────────────────────────
 *
 * Two derivations and no list of favourites:
 *
 *   1. every module the ownership map assigns to the `integrations` domain —
 *      "outbound connections to anything Tenure does not run";
 *   2. every HTTP entry point that AUTHENTICATES A PROVIDER, detected by the
 *      thing such an entry point must do: read a provider signature header off
 *      the request. A webhook route cannot avoid that and still verify anything,
 *      which is what makes the detector hard to walk around by accident.
 *
 * (2) is separate from (1) because the ownership map puts the provider-event
 * receiver under `billing-metering` — it is the payments provider's ingress, and
 * the map is right that payments owns it. It is still connector code for the
 * purposes of this boundary, and a plane defined only as "the integrations
 * domain" would have excluded the one route in this repository that a provider
 * can actually POST to.
 *
 * ── The three rules ─────────────────────────────────────────────────────────
 *
 *   · **Outbound.** A plane module may write only a model the plane owns. Every
 *     other model in `apps/web/prisma/schema.prisma` — the ledger, the approval
 *     graph, the org graph, the audit trail — is reachable from the plane only
 *     through the typed command bus at `apps/web/src/lib/commands/bus.ts`.
 *   · **Inbound.** A module that writes a plane-owned model must BE in the
 *     plane. Ownership that only stops the owner writing outward is not
 *     ownership; it is a one-way fence with a gate on the other side.
 *   · **No raw SQL in the plane.** `$executeRaw` and friends carry no model
 *     name, so a plane module using one is a write nothing above can classify.
 *     Refused by shape rather than read hopefully.
 *
 * ── Reads are not writes, and tests are not production ──────────────────────
 *
 * `findMany`, `findUnique` and `count` are untouched: the platform export path
 * legitimately READS connection tokens, and forbidding that would be a different
 * requirement about tenant data access, enforced elsewhere. Test and
 * integration-test files are excluded from the write scan and the document says
 * so — a test's `db` is a fixture or a mock, and a fake write to a domain model
 * in a test is exactly how the negative case gets proven. A violation that only
 * exists in a test file does not run in production, and counting it would push
 * somebody to weaken the test rather than the code.
 *
 * ── Determinism ─────────────────────────────────────────────────────────────
 *
 * The output is committed, so it is byte-identical on Linux and Windows or it is
 * "current here, stale in CI": files come from `git ls-files` (POSIX paths,
 * git's byte order), every list is sorted on an explicit key, every file is read
 * with CRLF normalised to LF before matching, and the document is joined with
 * `\n` under `.gitattributes`' `eol=lf`.
 *
 * Usage:  node tools/int-connector-write-boundary.mjs [--check]
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { classify } from './ownership-map.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = 'docs/architecture/int-connector-write-boundary.md'

const SCHEMA = 'apps/web/prisma/schema.prisma'
const COMMAND_BUS = 'apps/web/src/lib/commands/bus.ts'

/** File text with line endings normalised, so captures cannot vary by platform. */
export const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')

/**
 * Comments stripped, for the write scan only.
 *
 * A doc comment that SPELLS a write is not a write, and one of them is load
 * bearing: `apps/web/src/lib/outbox/outbox.ts` explains itself with
 * "the caller spreads this into `db.outboxEvent.create({ data })`", which a
 * scanner that reads comments reports as the outbox writing itself. The reverse
 * error is impossible — code inside a comment does not execute — so stripping
 * can only remove false positives here.
 */
export const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/**
 * What the write scan reads: comments gone AND string contents blanked.
 *
 * Separate from `code()` because the ingress detector needs the strings — the
 * header a webhook route reads is a string literal, and blanking it would make
 * the plane's second derivation match nothing at all, which is the shape of
 * failure that reads as success.
 */
export const calls = (text) => blankStrings(code(text))

/**
 * Quoted string contents blanked, length and newlines preserved.
 *
 * Not fastidiousness — a real false positive. This repository's permission
 * vocabulary is dotted and reads exactly like a Prisma call: `finance.budget.
 * update` is a permission string, `budget` IS a model property and `update` IS a
 * mutator, so a scanner that reads string literals reports
 * `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` as writing the Budget
 * model on a line that only NAMES a permission. It reported four such handles
 * before this existed. Blanking with spaces rather than deleting keeps every line
 * number in the document pointing at the line it came from.
 *
 * Single- and double-quoted only. A template literal can span lines and carry
 * `${…}` expressions, and a Prisma write inside one would be code this must not
 * blind itself to.
 */
export const blankStrings = (text) =>
  text.replace(/(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0])

/** Tracked AND untracked-but-not-ignored: a brand-new connector must not be invisible. */
function listFiles(glob) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', glob], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => fs.existsSync(path.join(ROOT, f)))
    .sort()
}

const isTest = (f) => /\.(test|itest)\.(ts|tsx|mjs|js)$/.test(f)

/** Every source file the write rules apply to: production TypeScript in the apps and packages. */
export function productionSources() {
  return [
    ...listFiles('apps/web/src'),
    ...listFiles('apps/system-studio/src'),
    ...listFiles('packages'),
  ]
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !isTest(f))
    .filter((f) => !f.endsWith('.d.ts'))
    .sort()
}

// ── The models, from the schema ─────────────────────────────────────────────

/**
 * Every model the schema declares, with the property name the Prisma client
 * exposes it as.
 *
 * Read from `schema.prisma` rather than listed here for the reason the whole
 * file exists: a model added tomorrow is forbidden to the plane the moment it is
 * declared, without anybody remembering to come here.
 */
export function schemaModels() {
  const text = read(SCHEMA)
  const models = [...text.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)].map((m) => m[1])
  return models
    .map((name) => ({ name, property: name[0].toLowerCase() + name.slice(1) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
}

/**
 * The models the integration plane owns, and may therefore write directly.
 *
 * Two, and both are records OF an integration rather than records the business
 * runs on — which is the test for whether something belongs on this list. A
 * provider event receipt is the minimal evidence that a provider said something
 * (Bible §12: "store minimal receipt metadata before async processing"); a
 * connection launch token is the state of an authorization attempt this platform
 * started. Neither is authority, neither is money, and nothing downstream treats
 * either as a business fact.
 *
 * Adding a third entry is a visible edit here, next to the reason, rather than a
 * `db.` call appearing in a connector — which is the whole difference between an
 * owned table and an ungoverned one.
 */
export const PLANE_OWNED_MODELS = Object.freeze({
  ProviderEventReceipt:
    'The minimal immutable receipt of one inbound provider event — id, type, sequence, ' +
    'API version, dedupe verdict and which rotation secret verified it. Evidence that a ' +
    'provider spoke, never permission for a business effect.',
  ConnectionLaunchToken:
    'The state of one authorization attempt this platform started: a single-use launch ' +
    'token, its expiry and whether it has been redeemed. Owned by the connection flow ' +
    'because nothing else can know whether the flow is still open.',
})

/** The Prisma calls that change data. Reads are deliberately absent — see the header. */
const MUTATORS = [
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]

const RAW_SQL = /\$(?:execute|query)Raw(?:Unsafe)?\b/

/**
 * Every Prisma write in one file's code, with the line it is on.
 *
 * `db`, `tx` and `client` because all three appear as the handle in this
 * repository: `db` is the module-scoped client, `tx` is the transaction handle
 * inside `$transaction`, and `client` is the injected one in the port
 * implementations. A handle this does not know about is a write this does not
 * see, so `writeHandles()` below re-derives the set from the tree and the test
 * asserts it has not grown.
 */
export function writesIn(text, models) {
  const property = new Map(models.map((m) => [m.property, m.name]))
  const stripped = calls(text)
  const lines = stripped.split('\n')
  const found = []

  const call = new RegExp(
    `\\b(?:db|tx|client|prisma)\\.([A-Za-z0-9_]+)\\.(${MUTATORS.join('|')})\\b`,
    'g',
  )

  lines.forEach((line, index) => {
    for (const m of line.matchAll(call)) {
      const model = property.get(m[1])
      // A property that is not a model is not a write: `db.$transaction`,
      // `ports.claimDue`, a local named `client`. Recording it as an unknown
      // model would make the document's verdict column meaningless.
      if (!model) continue
      found.push({ model, mutator: m[2], line: index + 1 })
    }
    if (RAW_SQL.test(line)) found.push({ model: null, mutator: 'raw-sql', line: index + 1 })
  })

  return found
}

/**
 * Every handle a Prisma model call is made through, anywhere in the tree.
 *
 * Derived so that the four names in `writesIn` are a claim the test can check
 * rather than a guess that silently stops covering a fifth. A handle named
 * `database` appearing tomorrow shows up here and reds the assertion, instead of
 * quietly carrying writes past the boundary.
 */
export function writeHandles(files, models) {
  const property = new Set(models.map((m) => m.property))
  const handles = new Set()
  const call = new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)\\.([A-Za-z0-9_]+)\\.(${MUTATORS.join('|')})\\b`, 'g')
  for (const f of files) {
    for (const m of calls(read(f)).matchAll(call)) {
      if (property.has(m[2])) handles.add(m[1])
    }
  }
  return [...handles].sort()
}

// ── The plane ───────────────────────────────────────────────────────────────

/**
 * A file that authenticates a provider: it reads a provider signature header off
 * the inbound request.
 *
 * Narrow on purpose. `headers.get("stripe-signature")` is what a webhook route
 * does and what a route pretending to verify cannot skip; the definition site of
 * the verifier itself (`packages/payments/src/webhook.ts`) is NOT ingress — it
 * is a pure function with no request and no database, and calling it ingress
 * would make the plane the whole payments package.
 */
const PROVIDER_SIGNATURE_HEADER = /\.headers\.get\(\s*["'][a-z0-9]+-signature["']\s*\)/i

export const authenticatesProvider = (text) => PROVIDER_SIGNATURE_HEADER.test(code(text))

export function providerIngress(files) {
  return files.filter((f) => authenticatesProvider(read(f))).sort()
}

/**
 * The integration plane, and the domain that owns each part of it.
 *
 * `owner` comes from `classify()` and is `null` when the ownership map places
 * the file in no domain — which the rules below treat as a failure, because a
 * connector module nobody owns is the state INT-000-004's first clause exists to
 * forbid.
 */
export function plane(files) {
  const { byDomain } = classify()
  const owner = new Map()
  for (const [domain, list] of byDomain) for (const f of list) owner.set(f, domain)

  const integrations = new Set(byDomain.get('integrations') ?? [])
  const ingress = new Set(providerIngress(files))

  const members = [...new Set([...integrations, ...ingress])]
    .filter((f) => !isTest(f))
    .sort()
    .map((f) => ({
      file: f,
      owner: owner.get(f) ?? null,
      why: integrations.has(f)
        ? ingress.has(f)
          ? 'integrations domain; authenticates a provider'
          : 'integrations domain'
        : 'authenticates a provider',
    }))

  return { members, files: new Set(members.map((m) => m.file)), ingress: [...ingress].sort() }
}

// ── The rules ───────────────────────────────────────────────────────────────

export function collect() {
  const files = productionSources()
  const models = schemaModels()
  const owned = new Set(Object.keys(PLANE_OWNED_MODELS))
  const p = plane(files)

  /** Every write in the tree, once, so both rules read the same evidence. */
  const writes = []
  for (const f of files) {
    for (const w of writesIn(read(f), models)) writes.push({ file: f, ...w })
  }

  const planeWrites = writes.filter((w) => p.files.has(w.file))

  const outbound = planeWrites.filter((w) => w.model !== null && !owned.has(w.model))
  const rawSql = planeWrites.filter((w) => w.model === null)
  const inbound = writes.filter((w) => w.model !== null && owned.has(w.model) && !p.files.has(w.file))
  const unowned = p.members.filter((m) => m.owner === null)

  return {
    models,
    files,
    plane: p,
    writes,
    planeWrites,
    ownedWrites: writes.filter((w) => w.model !== null && owned.has(w.model)),
    outbound,
    inbound,
    rawSql,
    unowned,
    handles: writeHandles(files, models),
    commandBusExists: fs.existsSync(path.join(ROOT, COMMAND_BUS)),
  }
}

export function violations(c = collect()) {
  return [
    ...c.outbound.map((w) => ({
      rule: 'outbound',
      what: `${w.file}:${w.line} writes ${w.model}.${w.mutator}, which the integration plane does not own`,
    })),
    ...c.rawSql.map((w) => ({
      rule: 'no-raw-sql',
      what: `${w.file}:${w.line} uses raw SQL from inside the integration plane`,
    })),
    ...c.inbound.map((w) => ({
      rule: 'inbound',
      what: `${w.file}:${w.line} writes ${w.model}.${w.mutator} from outside the integration plane`,
    })),
    ...c.unowned.map((m) => ({
      rule: 'ownership',
      what: `${m.file} is in the integration plane and the ownership map assigns it to no domain`,
    })),
  ]
}

// ── The document ────────────────────────────────────────────────────────────

const table = (headers, rows) =>
  [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')

export function render(c) {
  const owned = new Set(Object.keys(PLANE_OWNED_MODELS))
  const v = violations(c)
  const byDomain = new Map()
  for (const m of c.plane.members) {
    byDomain.set(m.owner ?? '(none)', (byDomain.get(m.owner ?? '(none)') ?? 0) + 1)
  }

  return `<!-- Generated by tools/int-connector-write-boundary.mjs. Do not edit by hand. -->
# The integration plane: who owns it, and what it may write

Generated. The integration Bible's INT-000 section asks for domain ownership to
be established and for direct connector table writes to be prohibited; this is
the computed answer to both, re-derived from the working tree on every run and
checked in CI by \`tests/architecture/int-connector-write-boundary.test.mjs\`.

Nothing here is asserted. Ownership is read from \`tools/ownership-map.mjs\`, the
map \`tests/architecture/ownership.test.mjs\` already enforces; the model list is
read from \`${SCHEMA}\`; the writes are read from the files themselves.

**${c.plane.members.length} modules in the plane · ${byDomain.size} owning domain(s) · ${c.models.length} models in the schema · ${owned.size} of them owned by the plane · ${c.planeWrites.length} write(s) from inside the plane · ${v.length} violation(s).**

## 1. The plane, and the domain that owns each module

Two derivations: every module the ownership map assigns to the \`integrations\`
domain, and every HTTP entry point that authenticates a provider by reading a
provider signature header off the request. Test files are excluded — see §6.

${table(
  ['Module', 'Owning domain', 'In the plane because'],
  c.plane.members.map((m) => [`\`${m.file}\``, m.owner ? `\`${m.owner}\`` : '**none**', m.why]),
)}

## 2. Provider ingress

The entry points a provider can reach, and the only files in the plane that
authenticate one.

${
  c.plane.ingress.length === 0
    ? 'None. No file in the tree reads a provider signature header off an inbound request.'
    : table(
        ['Entry point', 'Owning domain'],
        c.plane.ingress.map((f) => {
          const m = c.plane.members.find((x) => x.file === f)
          return [`\`${f}\``, m?.owner ? `\`${m.owner}\`` : '**none**']
        }),
      )
}

## 3. The models the plane owns

Every other model in the schema is off-limits to the plane, and reachable from it
only through the typed command bus (§5).

${table(
  ['Model', 'Why the plane owns it'],
  Object.entries(PLANE_OWNED_MODELS).map(([m, why]) => [`\`${m}\``, why]),
)}

## 4. Every write from inside the plane

${
  c.planeWrites.length === 0
    ? 'None.'
    : table(
        ['Where', 'Model', 'Call', 'Verdict'],
        c.planeWrites.map((w) => [
          `\`${w.file}:${w.line}\``,
          w.model ? `\`${w.model}\`` : '— (raw SQL)',
          `\`${w.mutator}\``,
          w.model === null
            ? '**refused** — raw SQL carries no model to classify'
            : owned.has(w.model)
              ? 'owned by the plane'
              : '**refused** — not a model the plane owns',
        ]),
      )
}

## 5. The door for everything else

A connector that needs a domain effect dispatches a typed command:
\`${COMMAND_BUS}\` ${c.commandBusExists ? 'exists' : '**IS MISSING**'}, and it is
the module that validates the command against its contract, records an
idempotency record and hands the write to a registered handler. That is the
"authorized typed commands" half of the Bible's invariant, and it is why the
prohibition above is a boundary rather than a dead end.

Reads are not writes. \`findMany\`, \`findUnique\` and \`count\` are untouched by
these rules: the platform export path legitimately reads connection tokens, and
what a plane module may READ is a tenant-data-access question enforced elsewhere.

## 6. Scope, stated rather than assumed

- **Production sources only.** Every \`.ts\`/\`.tsx\` file under
  \`apps/web/src\`, \`apps/system-studio/src\` and \`packages\`, excluding
  \`*.test.*\` and \`*.itest.*\`. A test's \`db\` is a fixture or a mock, and a
  fake write to a domain model inside a test is how the negative case gets
  proven; counting it would push somebody to weaken the test instead of the code.
- **Comments are stripped before the write scan.** A doc comment that spells a
  write is not a write, and one in \`apps/web/src/lib/outbox/outbox.ts\` says
  \`db.outboxEvent.create({ data })\` in prose. Code inside a comment does not
  execute, so stripping can only remove false positives.
- **Handles.** A write is a call on \`db\`, \`tx\`, \`client\` or \`prisma\`. Every
  handle actually used for a model call in this tree: ${c.handles.map((h) => `\`${h}\``).join(', ')}. The
  test asserts that set has not grown past what the scanner knows.
- **Static, not runtime.** This proves what the code says. It is not a database
  audit: nothing here has connected to Postgres, and a grant that let a connector
  write a domain table anyway would be invisible to it.

## 7. Findings

${
  v.length === 0
    ? `- **No violation.** ${c.planeWrites.length} write(s) issued from inside the integration plane, every one of them to a model the plane owns; ${c.ownedWrites.length} write(s) to a plane-owned model anywhere in the tree, every one of them from inside the plane; no raw SQL in the plane; every plane module owned by exactly one domain.`
    : v.map((x) => `- **${x.rule}** — ${x.what}`).join('\n')
}
- **${c.inbound.length} write(s) to a plane-owned model from outside the plane.**
- **Ownership is derived, not declared here.** ${c.plane.members.length} plane modules, ${c.unowned.length} of them owned by no domain.
`
}

const isCommand = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const generated = render(collect())
  const target = path.join(ROOT, OUT)
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : ''
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/int-connector-write-boundary.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(target, generated)
    console.log(`Wrote ${OUT}`)
  }
}

export { OUT, ROOT, SCHEMA, COMMAND_BUS }
