/**
 * GE-020-002. A raw client belongs to one module, or it belongs to nobody.
 *
 * Controllers, pages, server actions, connectors and general modules must reach
 * infrastructure through an owning adapter — never by constructing a database,
 * AWS or model-provider client of their own. The reason is not tidiness:
 *
 *   * A second `PrismaClient` is a second connection pool and, more seriously, a
 *     client with no tenancy extension attached. `apps/web/src/lib/db.ts` is the
 *     chokepoint the tenant filter hangs off; a page that builds its own client
 *     is a page the filter has never seen.
 *   * A locally constructed AWS client is a locally chosen region, a locally
 *     chosen credential chain and a call site no adapter can add encryption,
 *     retry or audit to later. `apps/web/src/lib/s3.ts` already says so in its
 *     own doc comment — "callers should never construct their own" — and until
 *     this test existed, one page did anyway.
 *   * A literal provider endpoint is the ModelGateway gap made concrete. There
 *     is no gateway, no per-tenant key, no cost accounting and no prompt audit;
 *     `lib/ai.ts` holds the one direct call. This does not close that gap
 *     (GE-090 does). It stops it spreading to a second call site meanwhile.
 *
 * The shape — an import survey with a reasoned, size-asserted allowlist — is the
 * one `tests/security/cell-independence.test.mjs` already uses. What is added
 * here is that the allowlist entries are *exemptions with stated reasons*
 * distinct from the *owners*, so "who is allowed to hold this client" and "who
 * has been let off" cannot be confused for each other.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

/* ------------------------------------------------------------------ scope -- */

const SCAN_ROOTS = ['apps', 'packages', 'modules', 'blueprints']
const SOURCE = /\.(ts|tsx|mjs|cjs|jsx?)$/

/**
 * Every source file in the workspace, tracked or merely present.
 *
 * `--others --exclude-standard` matters: a plain `git ls-files` sees only what
 * has been `git add`ed, so a new page with a raw client would pass locally right
 * up until the commit that puts it in CI's reach. `tools/platform-truth.mjs`
 * learned the same lesson from the other direction.
 */
function sourceFiles() {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', ...SCAN_ROOTS],
    { encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean)
    .filter((f) => SOURCE.test(f))

  // A survey that silently finds nothing reports "no violations". This suite is
  // worthless if the file list breaks, so it fails instead of passing emptily.
  assert.ok(
    files.length > 100,
    `only ${files.length} source files found under ${SCAN_ROOTS.join(', ')} — the scan is broken, not the code`
  )
  return files
}

/**
 * Comments removed, line numbering and string literals preserved.
 *
 * A client named in prose is not a client: `lib/s3.ts` describes the rule in a
 * doc comment and `db.ts` names `PrismaClient` in two. Strings must survive
 * intact because the provider rule reads URLs out of them — a regex-based
 * stripper eats `https://…` at the `//`, which silently disables that rule.
 *
 * A string state is closed at a newline (JS string literals cannot span lines
 * unquoted), so a quote character inside a regex literal — `replace(/"/g, "")`
 * in `lib/s3.ts` is a real example — desynchronises this for at most one line,
 * and in the safe direction: it under-strips, so a comment might be read as
 * code, never the reverse.
 */
/**
 * A source file's text, or "" if it has vanished.
 *
 * `sourceFiles()` lists untracked files too, and an untracked file can vanish
 * between the listing and the read — an editor, a build, a generator running
 * beside this one. A guard that crashes when a file it was told about
 * disappears is a guard that fails for a reason unrelated to what it checks:
 * this one went red roughly half the time under `npm run test:platform` and
 * never once on its own.
 *
 * The worst offender was another guard writing a probe file into the source
 * tree. That is gone, and `guards-do-not-write-into-the-tree` keeps it gone —
 * but the tolerance stays, because the race was never only about that one.
 */
function readSource(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

function code(text) {
  let out = ''
  let state = 'code'
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const d = text[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue }
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue }
      if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
      out += c; i += 1; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c }
      i += 1; continue
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; i += 2; continue }
      if (c === '\n') out += c
      i += 1; continue
    }
    // inside a string literal
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    if (c === '\n' && state !== 'tpl') { state = 'code'; out += c; i += 1; continue }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code'
    }
    out += c; i += 1
  }
  return out
}

/** Every module this file pulls in, with the import clause so `import type` can be told apart. */
function moduleRefs(text) {
  const refs = []
  for (const m of text.matchAll(/(?:^|[\s;})])import\s+([^;]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    refs.push({ spec: m[2], clause: m[1] })
  }
  for (const m of text.matchAll(/(?:^|[\s;})])import\s*['"]([^'"]+)['"]/g)) {
    refs.push({ spec: m[1], clause: '' }) // side-effect import
  }
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)) {
    refs.push({ spec: m[1], clause: '' }) // dynamic
  }
  for (const m of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g)) {
    refs.push({ spec: m[1], clause: '' })
  }
  return refs
}

/**
 * True when the clause imports `name` as a value.
 *
 * Type positions are not clients. `@prisma/client` is imported by thirty-odd
 * files for enums and `Prisma.*` types; forbidding that would forbid the schema,
 * not the client. Both `import type { X }` and the inline `{ type X }` modifier
 * are therefore excluded.
 */
function bindsValue(clause, name) {
  if (/^\s*type\b/.test(clause)) return false
  const withoutInlineTypes = clause.replace(/\btype\s+[A-Za-z_$][\w$]*/g, '')

  // A namespace import binds EVERY export of the module, including this one,
  // under another name. Searching the clause for the literal identifier let
  // `import * as p from "@prisma/client"` + `new p.PrismaClient()` straight
  // through — an adversarial review found it by trying exactly that. The clause
  // does not mention PrismaClient and never will, so the clause is the wrong
  // thing to search: what matters is that the module was imported for its
  // values at all.
  if (/^\s*\*\s+as\s+[A-Za-z_$][\w$]*/.test(withoutInlineTypes)) return true

  return new RegExp(String.raw`\b${name}\b`).test(withoutInlineTypes)
}

/** file:line for every line matching `re`. */
function hits(file, text, re) {
  const found = []
  text.split('\n').forEach((line, n) => {
    if (re.test(line)) found.push(`${file}:${n + 1}`)
  })
  return found
}

/* ------------------------------------------------------------------ rules -- */

/** The module that owns each client, and what it exposes instead. */
const OWNERS = {
  database: new Map([
    [
      'apps/web/src/lib/db.ts',
      'the one client the tenancy extension is attached to; every request query goes through it',
    ],
  ]),
  aws: new Map([
    [
      'apps/web/src/lib/s3.ts',
      'the document-storage adapter — one client, with byte reads and presigning behind exported functions',
    ],
    [
      'apps/system-studio/src/lib/registry.ts',
      'the tenant-registry adapter — the only module that talks to DynamoDB, and `server-only` so it cannot be bundled',
    ],
  ]),
  provider: new Map([
    [
      'apps/web/src/lib/ai.ts',
      'holds the single direct model-provider call. It is not correct that it does: there is no ModelGateway, no per-tenant key, no cost accounting and no prompt audit (GE-090). Owning it here bounds it to one call site until there is.',
    ],
  ]),
}

/**
 * Files that construct a raw database client and may. Each is outside the
 * request lifecycle, and each already explains itself in its own header.
 */
const DATABASE_EXEMPT = new Map([
  [
    'apps/web/src/lib/audit-append-only.test.ts',
    'the subject under test IS the extension: it builds a client, attaches auditAppendOnlyExtension() and asserts that delete/update/deleteMany/updateMany on AuditEvent are refused. Reaching for the shared `db` would be asserting against the very wiring the case exists to prove, so a failure could mean the extension broke or that lib/db.ts stopped attaching it — two different bugs with one signal',
  ],
  [
    'apps/web/src/lib/tenant-switching.itest.ts',
    'an unextended client on purpose: it asserts that the MEMBERSHIP ROW decides which tenants a user may act in, and an extended client would answer from the scope under test',
  ],
  [
    'apps/web/src/lib/tenancy/isolation.itest.ts',
    'builds an enforcing client deliberately: lib/db.ts attaches the extension in observe mode, and an isolation proof that runs unenforced proves nothing',
  ],
  [
    'apps/web/src/lib/search-data.itest.ts',
    'same reason — search isolation is asserted against a client running the extension in enforce mode',
  ],
  [
    'apps/web/src/lib/platform/tenant-export.itest.ts',
    'same reason — the export must be filtered by the chokepoint, which requires enforcing it',
  ],
  [
    'apps/web/src/lib/jobs/reminders-isolation.itest.ts',
    'same reason — a cron has no session, so the enforcing client is the only thing the assertion can lean on',
  ],
  [
    'apps/web/src/lib/provisioning/reconcile.itest.ts',
    'an unextended client on purpose: it asserts the DATABASE refuses duplicates, over control-plane rows that belong to no single tenant',
  ],
  [
    'apps/web/src/lib/identity/live-membership.itest.ts',
    'an unextended client on purpose: it asserts the SQL live-membership filter agrees with the engine row by row, which means reading rows of every status including revoked ones — an extended client would filter the fixtures the assertion is about',
  ],
  [
    'apps/web/scripts/seed.mjs',
    'control-plane script: it creates the institution a tenant scope would have to name, and runs with no session at container start',
  ],
  [
    'apps/web/scripts/census.mjs',
    'read-only pre-migration census across every tenant; a scoped client could not see the rows it exists to count',
  ],
  [
    'apps/web/scripts/ci-two-tenant-fixture.mjs',
    'creates a second tenant, so by definition it writes across both; its own header states this and why the extension is not attached',
  ],
  [
    'apps/web/scripts/duplicate-source-report.mjs',
    'GE-020-005 read-only divergence report across every tenant; the counts it exists to produce are estate-wide, and a scoped client would report one tenant and call it the database',
  ],
  [
    'apps/web/src/lib/outbox/prisma-ports.itest.ts',
    'PAY-020-005: it constructs the client but attaches `tenancyExtension("enforce")` to it, so the hazard this rule exists to stop — an unextended client no isolation test covers — is not present. It builds its own rather than importing `@/lib/db` because it proves properties of PostgreSQL rather than of TypeScript: that FOR UPDATE SKIP LOCKED stops two dispatchers claiming one row, and that a UNIQUE index stops a redelivery running a handler twice. Both need a second, independently-connected client to observe a concurrent claim, which a single shared module-level instance cannot provide',
  ],
  [
    'apps/web/src/lib/payments/ledger-attribution.itest.ts',
    'an unextended client on purpose: every claim in it is a property of the DDL rather than of any function — that the tenant-scoped idempotency index admits two institutions and refuses one, that six financial foreign keys RESTRICT, that a qualified provider key separates test from live. An extended client would filter or stamp the very rows the constraints are being asserted over, and a failure could then mean the constraint broke or that the scope did',
  ],
  [
    'apps/web/scripts/person-reach.itest.ts',
    'GE-020-005: it builds one person reaching TWO institutions and asserts a census query sees them, which a client scoped to either one could not set up or observe',
  ],
])

/** No file is exempt from the AWS or provider rules. Both lists exist so growth is visible. */
const AWS_EXEMPT = new Map()
const PROVIDER_EXEMPT = new Map()

/**
 * AWS client constructors, named explicitly for the services this estate has
 * (`docs/architecture/aws-inventory.json`) plus the ones the Bible adds.
 *
 * Explicit rather than `/new \w+Client\(/`: that wildcard matches PrismaClient,
 * QueryClient and every HTTP wrapper anyone ever writes, and a rule that cries
 * wolf gets deleted. The import check below is the primary detector; this
 * catches a construction whose import was aliased or re-exported.
 */
const AWS_CLIENT_CTORS =
  /\bnew\s+(S3|DynamoDB|DynamoDBDocument|SQS|SES|SESv2|STS|KMS|SecretsManager|CloudFront|CloudWatch|CloudWatchLogs|EventBridge|Lambda|SNS|ECS|RDS|Bedrock|BedrockRuntime|CognitoIdentityProvider)Client\s*\(/

/**
 * Provider API hosts. These are endpoints the application calls, not issuer
 * strings in configuration — `OKTA_ISSUER` in an env fixture is a value under
 * test, not a client, and listing okta.com would make this rule noise.
 */
const PROVIDER_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'api.cohere.ai',
  'generativelanguage.googleapis.com',
  '.amazonaws.com',
]

const PROVIDER_URL = new RegExp(
  String.raw`https?://[^\s'"\`]*(` + PROVIDER_HOSTS.map((h) => h.replace(/\./g, String.raw`\.`)).join('|') + ')'
)

/* ------------------------------------------------------------------ tests -- */

test('no module outside lib/db.ts constructs a raw database client', () => {
  const offenders = []

  for (const file of sourceFiles()) {
    if (OWNERS.database.has(file) || DATABASE_EXEMPT.has(file)) continue
    const text = code(readSource(file))

    for (const at of hits(file, text, /\bnew\s+PrismaClient\s*\(/)) {
      offenders.push(`${at} — constructs PrismaClient`)
    }
    for (const ref of moduleRefs(text)) {
      if (ref.spec === '@prisma/client' && bindsValue(ref.clause, 'PrismaClient')) {
        offenders.push(`${file} — value-imports PrismaClient`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a raw database client outside its owning adapter:\n  ${offenders.join('\n  ')}\n\n` +
      `Import { db } from "@/lib/db". That client has the tenancy extension attached; ` +
      `one you build yourself does not, and no isolation test covers it.`
  )
})

test('no module outside its adapter imports or constructs an AWS client', () => {
  const offenders = []

  for (const file of sourceFiles()) {
    if (OWNERS.aws.has(file) || AWS_EXEMPT.has(file)) continue
    const text = code(readSource(file))

    for (const ref of moduleRefs(text)) {
      if (!ref.spec.startsWith('@aws-sdk/')) continue
      if (/^\s*type\b/.test(ref.clause)) continue // a type is not a credential path
      offenders.push(`${file} — imports ${ref.spec}`)
    }
    for (const at of hits(file, text, AWS_CLIENT_CTORS)) {
      offenders.push(`${at} — constructs an AWS client`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `an AWS client outside its owning adapter:\n  ${offenders.join('\n  ')}\n\n` +
      `Use the functions "@/lib/s3" exports (getDocumentBytes, uploadDocument, ` +
      `documentDownloadUrl, documentViewUrl) or, in the Studio, lib/registry.ts. ` +
      `A client built at the call site picks its own region and credential chain, ` +
      `and cannot be given encryption, retry or audit behaviour later.`
  )
})

test('no module outside its adapter holds a literal provider endpoint', () => {
  const offenders = []

  for (const file of sourceFiles()) {
    if (OWNERS.provider.has(file) || PROVIDER_EXEMPT.has(file)) continue
    const text = code(readSource(file))
    for (const at of hits(file, text, PROVIDER_URL)) {
      offenders.push(`${at} — calls a provider endpoint directly`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a provider endpoint outside its owning adapter:\n  ${offenders.join('\n  ')}\n\n` +
      `There is no ModelGateway yet (GE-090). Until there is, the direct call stays ` +
      `at exactly one call site, where a gateway can replace it in one edit.`
  )
})

/* ------------------------------------------- the rule cannot rot quietly -- */

test('every owning adapter exists and still holds the client it owns', () => {
  // Otherwise the cheapest way to make this suite green is to delete the
  // adapter, and every caller quietly grows its own client again.
  const proof = [
    ['apps/web/src/lib/db.ts', /\bnew\s+PrismaClient\s*\(/],
    ['apps/web/src/lib/s3.ts', /\bnew\s+S3Client\s*\(/],
    ['apps/system-studio/src/lib/registry.ts', /\bnew\s+DynamoDBClient\s*\(/],
    ['apps/web/src/lib/ai.ts', PROVIDER_URL],
  ]

  for (const [file, re] of proof) {
    assert.ok(fs.existsSync(file), `${file} owns a client but does not exist`)
    assert.match(
      code(readSource(file)),
      re,
      `${file} is listed as an owner but no longer holds the client — move the ownership, or drop it`
    )
  }
})

test('the S3 adapter exposes the read the summary page needs', () => {
  // The violation this item fixed was a page constructing its own S3Client to
  // fetch bytes that `getDocumentBytes` already returns. If that export is ever
  // removed, the rule above stops being followable and becomes an obstacle.
  const s3 = code(fs.readFileSync('apps/web/src/lib/s3.ts', 'utf8'))
  assert.match(s3, /export\s+async\s+function\s+getDocumentBytes\s*\(/)

  const page = code(
    fs.readFileSync('apps/web/src/app/(app)/orgs/[slug]/documents/[id]/summary/page.tsx', 'utf8')
  )
  assert.match(
    page,
    /getDocumentBytes\s*\(/,
    'the summary page no longer reads document bytes through the adapter'
  )
})

test('the exemption lists are reasoned, real, and have not grown silently', () => {
  const all = [
    ['database', DATABASE_EXEMPT],
    ['aws', AWS_EXEMPT],
    ['provider', PROVIDER_EXEMPT],
  ]

  for (const [kind, list] of all) {
    for (const [file, why] of list) {
      assert.ok(fs.existsSync(file), `${file} is ${kind}-exempt but does not exist`)
      assert.ok(why.length > 40, `${file} is ${kind}-exempt without a real reason`)
    }
  }

  // A client added to a page is a code review question. A file added to an
  // exemption list is the same question, asked where it is easier to miss.
  // 8 → 9 on 2026-08-01: tenant-switching.itest.ts (GE-022-001). It needs an
  // unextended client for the same reason the other integration tests do — the
  // property under test is that the MEMBERSHIP ROW decides which tenants a user
  // may act in, and an extended client would answer from the very scope being
  // tested. Raised deliberately, with the reason recorded, which is what this
  // assertion exists to force.
  // 11 → 12 on 2026-08-02: live-membership.itest.ts (GE-040-001). Membership
  // became effective-dated, and the SQL filter that expresses "is a member now"
  // is a second statement of a rule the engine also states. The test that keeps
  // those two from drifting has to read rows of every status, including revoked
  // ones, so an extended client would filter away the fixtures the assertion is
  // about. Raised deliberately, with the reason recorded.
  // 12 -> 13 on 2026-08-07: audit-append-only.test.ts, which builds a client
  // precisely to prove the append-only extension refuses a delete. Bumped
  // deliberately and with the reason recorded beside the entry, which is what
  // this assertion is for — it forbids the list GROWING SILENTLY, not growing.
  assert.equal(DATABASE_EXEMPT.size, 15, 'the raw-database-client exemption list changed')
  assert.equal(AWS_EXEMPT.size, 0, 'a file was exempted from the AWS client rule')
  assert.equal(PROVIDER_EXEMPT.size, 0, 'a file was exempted from the provider endpoint rule')

  // Every database exemption is a test or an operational script. A page or a
  // route appearing here would mean the rule had been exempted, not applied.
  for (const file of DATABASE_EXEMPT.keys()) {
    assert.match(
      file,
      /(\.(itest|test|spec)\.tsx?|^apps\/web\/scripts\/[\w-]+\.mjs)$/,
      `${file} is neither a test nor an operational script, and must not be exempt`
    )
  }
})
