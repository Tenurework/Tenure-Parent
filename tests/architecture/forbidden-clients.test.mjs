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
 *
 * ## What the survey covers, and why it is not a list
 *
 * The whole repository. It used to be four named roots, and the difference was
 * six AWS clients: `tools/` was outside the scan, and the header of
 * `tools/dev/tamper-audit-row.mjs` said so in as many words, as the reason for
 * putting a DynamoDB client there. Nobody smuggled anything — the entry was
 * honest and the script is defensible — but the rule had published its own
 * boundary, and a boundary a rule publishes is one people build against.
 *
 * The estate is not going to stop growing, and neither is the set of places a
 * client can be constructed. So nothing here names a directory it expects a
 * violation in: `sourceFiles()` takes no pathspec, `the scan still reaches the
 * whole tree` reds if anybody gives it one, and `every AWS service the
 * repository depends on is a name this rule knows` reads the constructor names
 * back off the package manifests so the WHAT axis cannot fall behind either.
 * The only lists are of files explicitly let off, each with its reason and its
 * count pinned.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

/* ------------------------------------------------------------------ scope -- */

const SOURCE = /\.(ts|tsx|mts|cts|mjs|cjs|jsx?)$/

/**
 * Every source file in the repository, tracked or merely present.
 *
 * NO PATHSPEC, deliberately. This scan used to name four roots — `apps`,
 * `packages`, `modules`, `blueprints` — and a rule that lists where it looks
 * only ever finds what somebody already suspected. That was not a theoretical
 * hole. The header of `tools/dev/tamper-audit-row.mjs` said in as many words
 * that a tamper helper "inside `apps/` would also trip `forbidden-clients` …
 * `tools/` is outside that scan": an author read the rule, saw where its
 * attention stopped, and put a DynamoDB client on the far side of the line. Six
 * files had done the same, two of them reaching services — IAM, and DynamoDB
 * table DDL — that no adapter in this estate owns at all.
 *
 * So the universe is the repository. A violator in a directory nobody has
 * thought of yet — `services/`, `workers/`, a root added next month — fails
 * this suite on the day it lands, and `the scan still reaches the whole tree`
 * below fails if anybody narrows it again.
 *
 * `--others --exclude-standard` matters: a plain `git ls-files` sees only what
 * has been `git add`ed, so a new page with a raw client would pass locally right
 * up until the commit that puts it in CI's reach. `tools/platform-truth.mjs`
 * learned the same lesson from the other direction.
 */
function sourceFiles() {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => SOURCE.test(f))

  // A survey that silently finds nothing reports "no violations". This suite is
  // worthless if the file list breaks, so it fails instead of passing emptily.
  assert.ok(
    files.length > 100,
    `only ${files.length} source files found in the repository — the scan is broken, not the code`
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
    [
      'apps/system-studio/src/lib/aws/client.ts',
      'the estate-read adapter (STUDIO-070-004) — the only module holding a non-DynamoDB AWS client. Every client is built with an EMPTY config, so credentials come from the default provider chain and the region from the SDK, and moving account or partition needs no code change. Its surface is a closed `Capability` union rather than a service/action pair, so there is no path from a request to an arbitrary AWS call, and `server-only` keeps it out of any browser bundle',
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

/**
 * Operator scripts that hold an AWS client and may.
 *
 * This list was empty while the scan named four roots, and reading it as "no
 * file is exempt" was wrong — six files were not exempt, they were unexamined.
 * They are examined now, and each is here on its merits rather than on its
 * address. What they have in common is that none of them is reachable from a
 * request: every one is a `node tools/…` invocation an operator types, running
 * under that operator's own credentials with no session, no tenant and nothing
 * for an adapter to scope. Both Studio adapters begin `import "server-only"`,
 * which throws outside a React Server Component, so routing these through the
 * adapter is not a smaller change than this one — it is not a possible one.
 *
 * The exemption is per-file and counted below. A SEVENTH script in `tools/`
 * fails this suite, which is the difference that matters: the hazard was never
 * that these five DynamoDB clients exist, it was that `tools/` was a place a
 * client could be put without anybody being told.
 */
const AWS_EXEMPT = new Map([
  [
    'tools/create-registry-table.mjs',
    'creates the registry TABLE, which is DDL — `lib/registry.ts` reads and writes items and has no CreateTable path, so there is no adapter call this could become. It refuses to run without AWS_ENDPOINT_URL_DYNAMODB, so it cannot be aimed at an account by ambient credentials, and its own header explains why it uses the SDK rather than the `aws` CLI: shelling out to `aws` is what `production-workflows-disarmed` looks for',
  ],
  [
    'tools/dev/reset-registry-table.mjs',
    'drops and recreates that same table so the Studio e2e can run twice locally — DeleteTable and CreateTable, again DDL the adapter does not expose. It refuses to run without an explicit local endpoint, which is the guard that matters for a script whose whole purpose is deleting a table',
  ],
  [
    'tools/dev/seed-studio-fleet.mjs',
    'writes the three fleet shapes the Studio e2e asserts on, deliberately as raw items rather than through the adapter: the properties under test are properties of the DATA LAYOUT — a tenant is `never-deployed` precisely because the DEPLOYMENT sort key is absent — and seeding through the writer would make the fixture agree with the reader by construction instead of by evidence',
  ],
  [
    'tools/dev/show-config-history.mjs',
    'reads configuration revisions straight from the table in order to check a publish end to end WITHOUT trusting the page that claims it happened. Reading through the adapter would make it trust exactly the code path it exists to audit',
  ],
  [
    'tools/dev/tamper-audit-row.mjs',
    'the audit hash chain is only worth having if the tamper it detects is one somebody has actually performed against the table, behind the application. The Studio cannot do this — its IAM policy DENIES UpdateItem and DeleteItem on every `AUDIT#…` item, which is the property under test — so the tamper necessarily comes from outside the adapter. It refuses to run without an explicit local endpoint',
  ],
  [
    'tools/key-last-use.mjs',
    'GE-011-006 — reads `iam:GetAccessKeyLastUsed` to produce the evidence a key-disable decision needs. IAM is not a service any adapter in this estate owns: the Studio\'s estate reader imports `@aws-sdk/client-iam` but is `server-only` and answers a closed Capability union, and there is no capability for per-key last-use. Read-only by construction — the three calls it makes are the three the read role is granted',
  ],
])

/**
 * Files holding a literal provider endpoint that are not calling it.
 *
 * Also empty until the scan widened, and for the same reason rather than
 * because nothing was there.
 */
const PROVIDER_EXEMPT = new Map([
  [
    'tests/security/no-reusable-secrets-outside-the-vault.test.mjs',
    'the endpoint appears as a NEEDLE, not a destination: this guard reads the text of `lib/ai.ts` and asserts that the secret scan happens at a lower index than the post to the vendor — that a `whsec_` pasted into a club note is refused BEFORE it leaves the account rather than after. Deleting the literal is how that guard would be silently disabled, so this rule must not be the thing that pressures anybody into deleting it',
  ],
])

/**
 * AWS client constructors, named explicitly for the services this estate has
 * (`docs/architecture/aws-inventory.json`) plus the ones the Bible adds.
 *
 * Explicit rather than `/new \w+Client\(/`: that wildcard matches PrismaClient,
 * QueryClient and every HTTP wrapper anyone ever writes, and a rule that cries
 * wolf gets deleted. The import check below is the primary detector; this
 * catches a construction whose import was aliased or re-exported.
 *
 * IAM was missing until the scan widened, and the widening is how that was
 * found: `tools/key-last-use.mjs:42` does `new IAMClient({})`, and only the
 * import rule reported it. Had it reached the client through a local
 * re-export instead, both detectors would have been silent. That is the
 * failure mode a hand-kept name list has, so `every AWS service the
 * repository depends on is a name this rule knows` below reads the list back
 * off the SDK packages actually declared, rather than trusting this line to
 * have been maintained.
 */
const AWS_CLIENT_NAMES = [
  // Declared by a workspace today, and asserted complete against the manifests
  // by `every AWS service the repository depends on is a name this rule knows`.
  'AccessAnalyzer', 'ACM', 'Backup', 'Budgets', 'CloudFront', 'CloudTrail',
  'CloudWatch', 'CloudWatchLogs', 'CognitoIdentityProvider', 'ConfigService',
  'CostAndUsageReportService', 'CostExplorer', 'DynamoDB', 'DynamoDBDocument',
  'EC2', 'ECR', 'ECS', 'ElastiCache', 'ElasticLoadBalancingV2', 'EventBridge',
  'GuardDuty', 'Health', 'IAM', 'KMS', 'Lambda', 'Organizations', 'Pricing',
  'RDS', 'ResourceGroupsTaggingAPI', 'Route53', 'S3', 'SecretsManager',
  'SecurityHub', 'ServiceQuotas', 'SESv2', 'SQS', 'SSM', 'STS', 'WAFV2',
  // Not a dependency yet. The Bible names them, and a rule that only knows the
  // services already reached is a rule that arrives one commit after the first
  // use of each new one. Extras cost nothing: the coverage test asserts the
  // manifests are a SUBSET of this list, not that the two are equal.
  'Bedrock', 'BedrockRuntime', 'SES', 'SNS',
]

/**
 * Longest name first: `new DynamoDBDocumentClient(` must not be consumed by the
 * `DynamoDB` branch. Alternation backtracks and would find it anyway, but a
 * correctness that depends on backtracking is one an added name can break
 * silently, and this suite's whole subject is rules that stop looking.
 */
const AWS_CLIENT_CTORS = new RegExp(
  String.raw`\bnew\s+(` +
    [...AWS_CLIENT_NAMES].sort((a, b) => b.length - a.length).join('|') +
    String.raw`)Client\s*\(`
)

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
    // Deleting the estate adapter must red this suite, not quietly re-open every
    // page's right to build its own client. STS is the one it cannot be without:
    // identity is what every other read's denial names.
    ['apps/system-studio/src/lib/aws/client.ts', /\bnew\s+STSClient\s*\(/],
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
  // 0 -> 6 for AWS and 0 -> 1 for provider when the scan stopped naming four
  // roots and read the whole repository instead. Those seven files did not
  // appear; they were always there, on the far side of a boundary the rule had
  // drawn around itself. Recording them is the point — an unexamined file
  // reports as compliance, an exempt one reports as a decision somebody made.
  assert.equal(DATABASE_EXEMPT.size, 15, 'the raw-database-client exemption list changed')
  assert.equal(AWS_EXEMPT.size, 6, 'the AWS client exemption list changed')
  assert.equal(PROVIDER_EXEMPT.size, 1, 'the provider endpoint exemption list changed')

  // Nothing on the request path may be exempt from any of the three rules. A
  // page, a route handler, a server action or a connector appearing in any list
  // would mean the rule had been exempted rather than applied, and that is the
  // one shape of entry no reason can justify: these rules exist precisely
  // because a request must not be able to reach infrastructure unscoped.
  //
  // Stated as the ONE permitted shape rather than as a list of forbidden
  // directories — a test, or a script run from a shell — so a file in a place
  // nobody anticipated cannot be exempted by virtue of not having been thought
  // of. That is the same mistake the scan above just stopped making.
  const MAY_BE_EXEMPT = /(\.(itest|test|spec)\.(mjs|tsx?)|^(apps\/[\w-]+\/scripts|tools)\/[\w/-]+\.mjs)$/
  for (const [kind, list] of all) {
    for (const file of list.keys()) {
      assert.match(
        file,
        MAY_BE_EXEMPT,
        `${file} is ${kind}-exempt but is neither a test nor a script an operator runs — ` +
          `anything reachable from a request must go through the adapter, not around it`
      )
    }
  }
})

/* ------------------------------------------ the rule cannot narrow quietly -- */

test('the scan still reaches the whole tree', () => {
  // The defect this test exists to prevent is the one this suite shipped with:
  // `sourceFiles()` named four roots, `tools/` was not among them, and six AWS
  // clients lived there for months reported as compliance. Worse than missed —
  // `tools/dev/tamper-audit-row.mjs` records in its own header that `tools/` was
  // chosen BECAUSE it was outside the scan. A boundary a rule announces is a
  // boundary somebody will build on.
  //
  // So: every top-level directory git reports source in must be reached. The
  // expected set is computed here from a second, independent `git ls-files`
  // rather than written down, which is what makes this more than a restatement
  // of the scan — narrowing `sourceFiles()` to any pathspec reds this test and
  // names the root that went dark, while a NEW top-level directory is covered
  // the day it lands rather than the day somebody remembers to add it.
  const everything = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean)
    .filter((f) => SOURCE.test(f))

  const expected = new Set(everything.map((f) => f.split('/')[0]))
  const reached = new Set(sourceFiles().map((f) => f.split('/')[0]))

  // If this is ever 0 or 1 the comparison below is trivially satisfiable, and a
  // broken `git ls-files` would read as agreement between two empty sets.
  assert.ok(
    expected.size >= 4,
    `only ${expected.size} top-level source directories found — the listing is broken, not the tree`
  )

  const dark = [...expected].filter((root) => !reached.has(root)).sort()
  assert.deepEqual(
    dark,
    [],
    `the scan no longer reaches: ${dark.join(', ')}\n\n` +
      `A forbidden-client rule that lists where it looks finds only what somebody ` +
      `already suspected. Every root git reports source in must be read.`
  )
})

test('the detectors find the clients the owning adapters really hold', () => {
  // Non-vacuity, and the kind that matters: the three rules above are searches,
  // and a search that has stopped matching reports a clean estate. `code()` is
  // a hand-written comment stripper and `moduleRefs()` a hand-written import
  // parser — either can be broken by an edit that still passes every other test
  // in this file, because every other test asserts an EMPTY result.
  //
  // This one asserts a NON-empty result, over exactly the pipeline the rules
  // use, against the constructions the owning adapters are known to hold.
  const found = { database: [], aws: [], provider: [] }

  for (const file of OWNERS.database.keys()) {
    const text = code(readSource(file))
    found.database.push(...hits(file, text, /\bnew\s+PrismaClient\s*\(/))
    for (const ref of moduleRefs(text)) {
      if (ref.spec === '@prisma/client' && bindsValue(ref.clause, 'PrismaClient')) {
        found.database.push(`${file} — value-imports PrismaClient`)
      }
    }
  }

  for (const file of OWNERS.aws.keys()) {
    const text = code(readSource(file))
    found.aws.push(...hits(file, text, AWS_CLIENT_CTORS))
    for (const ref of moduleRefs(text)) {
      if (ref.spec.startsWith('@aws-sdk/') && !/^\s*type\b/.test(ref.clause)) {
        found.aws.push(`${file} — imports ${ref.spec}`)
      }
    }
  }

  for (const file of OWNERS.provider.keys()) {
    found.provider.push(...hits(file, code(readSource(file)), PROVIDER_URL))
  }

  for (const [kind, sites] of Object.entries(found)) {
    assert.ok(
      sites.length > 0,
      `the ${kind} detector found nothing in its own owning adapter. The adapter ` +
        `holds that client by definition, so the detector is broken — and a broken ` +
        `detector reports every module in the repository as compliant.`
    )
  }

  // Both halves of the database rule, separately: a construction and a value
  // import. `bindsValue` alone has already shipped one hole (a namespace import
  // walked straight through it), and if it silently returned false forever the
  // construction half would still make the count above non-zero.
  assert.ok(
    found.database.some((s) => /value-imports PrismaClient$/.test(s)),
    'the import half of the database rule matched nothing in lib/db.ts — moduleRefs or bindsValue is broken'
  )
  assert.ok(
    found.database.some((s) => /:\d+$/.test(s)),
    'the construction half of the database rule matched nothing in lib/db.ts'
  )
  assert.ok(
    found.aws.some((s) => /:\d+$/.test(s)),
    'no AWS constructor matched inside an owning adapter — AWS_CLIENT_NAMES or the regex build is broken'
  )
})

test('every AWS service the repository depends on is a name this rule knows', () => {
  // The constructor rule is a name list, and a name list falls behind the
  // moment a workspace adds a dependency. It fell behind by IAM, which is how
  // `tools/key-last-use.mjs` came to be caught by the import rule alone.
  //
  // The manifests are the authority, and they are found rather than listed, so
  // a new workspace counts from the day it exists.
  const manifests = execFileSync('git', ['ls-files', '*package.json'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('node_modules/'))

  assert.ok(manifests.length > 3, `only ${manifests.length} package manifests found — the listing is broken`)

  const declared = new Set()
  for (const file of manifests) {
    const text = readSource(file)
    if (!text) continue
    const pkg = JSON.parse(text)
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        // `client-*` only. `lib-dynamodb` and `s3-request-presigner` are not
        // service clients: the first exports DynamoDBDocumentClient, which is
        // named above on its own, and the second exports no client at all.
        if (name.startsWith('@aws-sdk/client-')) declared.add(name)
      }
    }
  }

  assert.ok(
    declared.size > 5,
    `only ${declared.size} @aws-sdk service packages found across ${manifests.length} manifests — ` +
      `the manifests parsed but the dependency read did not, and an empty set agrees with any list`
  )

  // `@aws-sdk/client-elastic-load-balancing-v2` exports ElasticLoadBalancingV2Client
  // and `client-route-53` exports Route53Client: the package suffix and the
  // class name differ in punctuation and case but in nothing else, across all
  // thirty-eight of them. So compare on letters and digits alone.
  const plain = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const known = new Set(AWS_CLIENT_NAMES.map(plain))

  const unknown = [...declared].filter((p) => !known.has(plain(p.slice('@aws-sdk/client-'.length)))).sort()
  assert.deepEqual(
    unknown,
    [],
    `these AWS services are dependencies, but no name in AWS_CLIENT_NAMES matches them:\n  ` +
      `${unknown.join('\n  ')}\n\n` +
      `A construction of one of these, reached through a local re-export, would be ` +
      `invisible to both detectors. Add the client class name, without the trailing "Client".`
  )
})
