#!/usr/bin/env node
/**
 * INT-000-001 / INT-000-002 — what integration surface this repository actually
 * has, and which end of each one is connected to nothing.
 *
 * The integration Bible opens INT-000 with two requirements that look like
 * paperwork and are not:
 *
 *   * INT-000-001 — inventory current internal events, APIs, queues, jobs,
 *     webhooks, files, credential references, provider SDKs and connector
 *     claims;
 *   * INT-000-002 — map producer/consumer and actual traffic for every
 *     integration resource, and identify orphan/producerless queues and false
 *     green alarms.
 *
 * A hand-written answer to either is wrong within a week, and a wrong integration
 * inventory is worse than none: it is the document somebody consults when asking
 * "what talks to the outside world?" So this is derived from the tree — every
 * row names a file that is in `git ls-files`, and `--check` fails when the tree
 * and the document disagree.
 *
 * ── Why the second half is the point ────────────────────────────────────────
 *
 * An inventory alone answers "does it exist". The Bible's second requirement
 * asks the harder question — "does anything use it" — and this repository is a
 * live example of why. Terraform declares five SQS queues, two dead-letter
 * queues among them, with redrive policies and a CloudWatch alarm. No code in
 * `apps/web` sends a message to any of them; no code in either app receives
 * one. The only SQS caller in the repository is System Studio's read-only
 * observability path. So every queue is producerless, and the DLQ alarm — which
 * is set to `treat_missing_data = "notBreaching"` — is green because nothing has
 * ever arrived, not because delivery is healthy. That is exactly the "false
 * green alarm" the requirement names, and no amount of staring at a dashboard
 * finds it: it is a property of the tree, and the tree is what this reads.
 *
 * ── Determinism ─────────────────────────────────────────────────────────────
 *
 * The output is committed, so it must be byte-identical on Linux and Windows or
 * it is "current here, stale in CI":
 *
 *   * files come from `git ls-files`, which emits POSIX paths in a stable
 *     byte order — never `readdirSync`, whose order is the filesystem's;
 *   * every list is sorted explicitly on a POSIX string key before rendering,
 *     so nothing depends on the order rows happened to be discovered in;
 *   * every file is read with CRLF normalised to LF before matching, so a
 *     Windows checkout cannot produce different captures;
 *   * the document is joined with `\n` and `.gitattributes` pins `eol=lf`.
 *
 * ── What this can and cannot tell you ───────────────────────────────────────
 *
 * It reports static structure: what is declared, what is imported, what string
 * a producer names. It is not traffic measurement — nothing here has read a
 * CloudWatch metric — and it says so in the document rather than letting a
 * reader assume otherwise. "No producer in the tree" is a proof about the
 * repository; "no traffic in production" would be a claim about an account this
 * tool has never authenticated to, and the two must not be written as if they
 * were the same sentence.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = 'docs/architecture/int-integration-inventory.md'

/**
 * Tracked AND untracked-but-not-ignored, POSIX paths, git's byte order.
 *
 * `--others` matters for the same reason it does in `entry-point-inventory.mjs`:
 * a brand-new route or a brand-new connector is precisely the row that must not
 * be invisible until after the commit that added it.
 */
function listFiles(glob) {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', glob],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return out
    .split('\n')
    .filter(Boolean)
    // The index still lists a file deleted in the worktree; reading it throws
    // and would take down the whole inventory rather than dropping one row.
    .filter((f) => fs.existsSync(path.join(ROOT, f)))
    .sort()
}

/** File text with line endings normalised, so captures cannot vary by platform. */
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')

const exists = (f) => fs.existsSync(path.join(ROOT, f))

/** Comments stripped — a queue named in prose is not a queue that is written to. */
const code = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ── 1. HTTP surfaces ────────────────────────────────────────────────────────

const APPS = [
  { app: 'apps/web', experience: 'tenant', root: 'apps/web/src/app' },
  { app: 'apps/system-studio', experience: 'deployer', root: 'apps/system-studio/src/app' },
]

const VERB = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g

/**
 * `export const { GET, POST } = handlers` — the shape both NextAuth routes use.
 *
 * The first version of this read only `export function GET`, and both
 * authentication routes — the two entry points in the platform that accept
 * credentials — came out with no verbs at all. An inventory that renders the
 * most security-relevant endpoints as serving nothing is worse than one that
 * omits them, because the row looks answered.
 */
const DESTRUCTURED_VERBS = /export\s+const\s+\{([^}]*)\}\s*=/g

/**
 * Every HTTP route handler, with the verbs it exports and the direction the
 * traffic runs in.
 *
 * `direction` is the integration-relevant half and is derived from the path
 * rather than asserted: a route under `/api/jobs/` is invoked BY the estate's
 * scheduler, a route named `provider-events` or `callback` is invoked by a
 * provider, and everything else is invoked by a browser session. Getting this
 * wrong in either direction is the classic integration-inventory error —
 * counting a page as an ingress, or missing the one endpoint an outside system
 * can reach.
 */
function httpSurfaces() {
  const rows = []
  for (const { app, experience, root } of APPS) {
    for (const file of listFiles(`${root}/**`)) {
      if (!/(^|\/)route\.ts$/.test(file)) continue
      const text = code(read(file))
      const found = [...text.matchAll(VERB)].map((m) => m[1])
      for (const d of text.matchAll(DESTRUCTURED_VERBS)) {
        for (const name of d[1].split(',').map((s) => s.trim())) {
          if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name)) found.push(name)
        }
      }
      const verbs = [...new Set(found)].sort()
      const route = file
        .replace(`${root}`, '')
        .replace(/\/route\.ts$/, '')
        .replace(/\/\(.*?\)/g, '')
      let direction = 'tenant-session'
      if (/\/api\/jobs\//.test(route)) direction = 'inbound-scheduler'
      else if (/provider-events|webhook|\/callback$/.test(route)) direction = 'inbound-provider'
      else if (/\/api\/aws\//.test(route)) direction = 'outbound-aws'
      rows.push({ app, experience, route: route || '/', verbs, direction, file })
    }
  }
  return rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

// ── 2. Internal events ──────────────────────────────────────────────────────

/**
 * Event types, from three independent readings of the tree, kept apart on
 * purpose.
 *
 *   * `declaredEmit` / `declaredConsume` — what `modules/index.ts` says.
 *   * `producers` — where `outboxEventRow({ type: "X" })` is actually called.
 *   * `consumers` — what `apps/web/src/lib/outbox/consumers.ts` registers.
 *
 * Collapsing them into one column would erase the only interesting question:
 * whether the declaration and the code agree. `ApprovalRequested` is declared
 * emitted AND declared consumed, is produced in code, and has no registered
 * consumer — an event with a producer and no runtime subscriber. That is the
 * event-side twin of a producerless queue and it is invisible in either list
 * alone.
 */
function events() {
  const byType = new Map()
  const at = (type) => {
    if (!byType.has(type)) {
      byType.set(type, {
        type,
        declaredEmit: [],
        declaredConsume: [],
        producers: [],
        consumers: [],
      })
    }
    return byType.get(type)
  }

  // Declared, per module manifest.
  const manifest = read('modules/index.ts')
  let moduleKey = null
  for (const line of manifest.split('\n')) {
    const decl = /^const\s+\w+\s*:\s*ModuleManifest\s*=\s*\{/.exec(line)
    if (decl) moduleKey = null
    const key = /^\s{2}key:\s*"([\w.-]+)"/.exec(line)
    if (key) moduleKey = key[1]
    for (const field of ['emits', 'consumes']) {
      const m = new RegExp(`^\\s*${field}:\\s*\\[([^\\]]*)\\]`).exec(line)
      if (!m || !moduleKey) continue
      for (const t of m[1].match(/"([A-Za-z0-9]+)"/g) ?? []) {
        const type = t.slice(1, -1)
        at(type)[field === 'emits' ? 'declaredEmit' : 'declaredConsume'].push(moduleKey)
      }
    }
  }

  // Produced, in code. `outboxEventRow` is the only mapper into the outbox
  // table, so its call sites are the complete producer set for domain events.
  for (const file of listFiles('apps/web/src/**')) {
    if (!/\.tsx?$/.test(file) || /\.(test|itest|spec)\.tsx?$/.test(file)) continue
    const text = code(read(file))
    if (!text.includes('outboxEventRow(')) continue
    for (const m of text.matchAll(/outboxEventRow\(\{[\s\S]{0,400}?type:\s*"([A-Za-z0-9]+)"/g)) {
      const row = at(m[1])
      if (!row.producers.includes(file)) row.producers.push(file)
    }
  }

  // Consumed, in code.
  const consumerFile = 'apps/web/src/lib/outbox/consumers.ts'
  if (exists(consumerFile)) {
    const text = code(read(consumerFile))
    for (const m of text.matchAll(/eventType:\s*"([A-Za-z0-9]+)"/g)) {
      const row = at(m[1])
      if (!row.consumers.includes(consumerFile)) row.consumers.push(consumerFile)
    }
  }

  return [...byType.values()]
    .map((r) => ({
      ...r,
      declaredEmit: [...new Set(r.declaredEmit)].sort(),
      declaredConsume: [...new Set(r.declaredConsume)].sort(),
      producers: [...r.producers].sort(),
      consumers: [...r.consumers].sort(),
    }))
    .map((r) => ({
      ...r,
      verdict:
        r.producers.length === 0
          ? 'declared, never produced'
          : r.consumers.length === 0
            ? 'produced, no registered consumer'
            : 'producer and consumer both present',
    }))
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
}

// ── 3–5. Terraform-declared integration resources ───────────────────────────

const TF_RESOURCE = /^resource\s+"([a-z0-9_]+)"\s+"([a-z0-9_]+)"\s*\{/gm

/** Every terraform resource of the given types, with the block body. */
function terraformResources(types) {
  const wanted = new Set(types)
  const rows = []
  for (const file of listFiles('infrastructure/**')) {
    if (!file.endsWith('.tf')) continue
    const text = read(file)
    for (const m of text.matchAll(TF_RESOURCE)) {
      if (!wanted.has(m[1])) continue
      const start = m.index + m[0].length
      let depth = 1
      let i = start
      for (; i < text.length && depth > 0; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') depth--
      }
      rows.push({
        type: m[1],
        label: m[2],
        file,
        line: text.slice(0, m.index).split('\n').length,
        body: text.slice(start, i - 1),
      })
    }
  }
  return rows.sort((a, b) =>
    `${a.file}:${a.label}` < `${b.file}:${b.label}`
      ? -1
      : `${a.file}:${a.label}` > `${b.file}:${b.label}`
        ? 1
        : 0,
  )
}

/**
 * One `key = value` from a terraform block, with the surrounding quotes and any
 * trailing comment removed.
 *
 * The quotes are stripped so a value and an interpolation render the same way —
 * `AWS/SQS` and `${local.name_prefix}-default` are both just what terraform will
 * name the thing, and leaving `"` on one of them makes a table column that looks
 * like two different kinds of fact.
 */
const attr = (body, key) => {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm').exec(body)
  if (!m) return ''
  return m[1]
    .trim()
    .replace(/\s+#.*$/, '')
    .replace(/^"(.*)"$/, '$1')
}

/**
 * Whether ANY module outside the observability path can send to or receive
 * from SQS.
 *
 * Deliberately a repository-wide question rather than a per-queue one: the
 * producer of a queue is whoever holds an SQS client, and no code that does not
 * import one can be a producer of any queue. Returned as the evidence rather
 * than as a boolean so the document can name the files a reader should open.
 */
function sqsCallers() {
  const senders = []
  const receivers = []
  const holders = []
  for (const glob of ['apps/**', 'packages/**', 'modules/**']) {
    for (const file of listFiles(glob)) {
      if (!/\.(ts|tsx|mjs)$/.test(file)) continue
      if (/\.(test|itest|spec)\.(ts|tsx|mjs)$/.test(file)) continue
      const text = code(read(file))
      // The v3 command classes and nothing looser. The first version of this
      // also matched a bare `sendMessage(` and found one: an unrelated server
      // action in the messaging module named `sendMessage`, which has never
      // touched SQS. That single false positive flipped all five queues from
      // "orphan" to "has a producer" and the DLQ alarm from "cannot fire" to
      // healthy — the inventory reported the exact opposite of the truth, and
      // it reported it confidently. A name is not a call to a queue.
      if (/\bSendMessage(?:Batch)?Command\b/.test(text)) senders.push(file)
      if (/\bReceiveMessageCommand\b/.test(text)) receivers.push(file)
      if (/@aws-sdk\/client-sqs/.test(text)) holders.push(file)
    }
  }
  return {
    senders: [...new Set(senders)].sort(),
    receivers: [...new Set(receivers)].sort(),
    holders: [...new Set(holders)].sort(),
  }
}

function queues(callers) {
  return terraformResources(['aws_sqs_queue']).map((q) => ({
    label: q.label,
    name: attr(q.body, 'name'),
    file: q.file,
    line: q.line,
    redrive: /redrive_policy/.test(q.body) ? 'yes' : 'no',
    producers: callers.senders,
    consumers: callers.receivers,
    verdict:
      callers.senders.length === 0 && callers.receivers.length === 0
        ? 'orphan — no producer and no consumer in the tree'
        : callers.senders.length === 0
          ? 'producerless — a consumer exists, nothing enqueues'
          : 'has a producer in the tree',
  }))
}

function schedules() {
  const rules = terraformResources(['aws_cloudwatch_event_rule']).filter((r) =>
    /schedule_expression/.test(r.body),
  )
  const destinations = new Map(
    terraformResources(['aws_cloudwatch_event_api_destination']).map((d) => [
      d.label,
      attr(d.body, 'http_method'),
    ]),
  )
  const targets = terraformResources(['aws_cloudwatch_event_target'])
  return rules.map((r) => {
    const target = targets.find((t) => attr(t.body, 'rule').includes(r.label))
    const arn = target ? attr(target.body, 'arn') : ''
    const dest = /aws_cloudwatch_event_api_destination\.(\w+)/.exec(arn)?.[1] ?? ''
    return {
      label: r.label,
      schedule: attr(r.body, 'schedule_expression'),
      file: r.file,
      line: r.line,
      target: arn || '(no target declared)',
      method: destinations.get(dest) ?? '',
    }
  })
}

function alarms(callers) {
  return terraformResources(['aws_cloudwatch_metric_alarm']).map((a) => {
    const namespace = attr(a.body, 'namespace')
    const metric = attr(a.body, 'metric_name')
    const missing = attr(a.body, 'treat_missing_data')
    const sqsBacked = namespace.includes('AWS/SQS')
    return {
      label: a.label,
      namespace,
      metric,
      missing: missing || '(default: missing)',
      file: a.file,
      line: a.line,
      verdict:
        sqsBacked && callers.senders.length === 0
          ? 'CANNOT FIRE — SQS metric over a queue nothing in the tree enqueues to'
          : 'metric has a producer or is not queue-backed',
    }
  })
}

function buckets() {
  return terraformResources(['aws_s3_bucket']).map((b) => ({
    label: b.label,
    file: b.file,
    line: b.line,
  }))
}

// ── 6. File-exchange surfaces ───────────────────────────────────────────────

/** Modules that move bytes over object storage — the file half of INT-000-001. */
function fileSurfaces() {
  const rows = []
  for (const glob of ['apps/**', 'packages/**']) {
    for (const file of listFiles(glob)) {
      if (!/\.(ts|tsx)$/.test(file) || /\.(test|itest|spec)\.tsx?$/.test(file)) continue
      const text = code(read(file))
      const uses = []
      if (/@aws-sdk\/client-s3/.test(text)) uses.push('s3-client')
      if (/s3-request-presigner|getSignedUrl/.test(text)) uses.push('presigned-url')
      if (/\bjszip\b|new JSZip/.test(text)) uses.push('zip')
      if (uses.length) rows.push({ file, uses: uses.sort() })
    }
  }
  return rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

// ── 7. Credential references — NAMES ONLY ───────────────────────────────────

/**
 * Every credential this platform references, by NAME.
 *
 * The Bible's invariant is that secrets are "stored in approved AWS secret/token
 * systems and referenced by opaque IDs" and never appear "in tenant
 * configuration, connector package, database field, URL, log, event, DLQ,
 * screenshot or evidence". A generated inventory IS evidence, so this reads
 * declarations and identifiers and never a value:
 *
 *   * a terraform `aws_secretsmanager_secret` contributes its `name` expression,
 *     which is an interpolated path like `${local.name_prefix}/app` — a name;
 *   * source contributes the IDENTIFIER in `process.env.X`, never `X`'s value,
 *     which this process does not read and could not know for a deployed
 *     environment anyway.
 *
 * `int-integration-inventory.test.mjs` asserts the rendered table contains no
 * token-shaped literal, so the rule is enforced rather than intended.
 */
const CREDENTIALISH = /^[A-Z][A-Z0-9_]*(SECRET|TOKEN|KEY|PASSWORD|CREDENTIALS?|DSN|URL)$/

function credentialReferences() {
  const rows = []
  for (const s of terraformResources(['aws_secretsmanager_secret'])) {
    rows.push({
      reference: attr(s.body, 'name') || s.label,
      kind: 'aws_secretsmanager_secret',
      where: `${s.file}:${s.line}`,
    })
  }
  const seen = new Set()
  for (const glob of ['apps/**', 'packages/**', 'tools/**']) {
    for (const file of listFiles(glob)) {
      if (!/\.(ts|tsx|mjs)$/.test(file) || /\.(test|itest|spec)\.tsx?$/.test(file)) continue
      const text = code(read(file))
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        if (!CREDENTIALISH.test(m[1])) continue
        const key = `${m[1]} :: ${file}`
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({ reference: m[1], kind: 'process.env identifier', where: file })
      }
    }
  }
  return rows.sort((a, b) =>
    `${a.reference}${a.where}` < `${b.reference}${b.where}`
      ? -1
      : `${a.reference}${a.where}` > `${b.reference}${b.where}`
        ? 1
        : 0,
  )
}

// ── 8. Provider SDKs ────────────────────────────────────────────────────────

/**
 * A dependency that speaks to a network service somebody else operates.
 *
 * An allowlist would silently miss the next one, so every direct dependency of
 * every workspace is scanned and the total is reported next to the matched
 * count — a reader can therefore see the denominator this was selected from
 * rather than trusting that the matcher is complete.
 */
const PROVIDER_SDK =
  /^(@aws-sdk\/|@smithy\/|@azure\/|@microsoft\/|@slack\/|@octokit\/|@sendgrid\/|@auth\/|googleapis$|stripe$|twilio$|nodemailer$|next-auth$)/

function providerSdks() {
  const rows = []
  let scanned = 0
  for (const file of listFiles('**/package.json')) {
    if (file.includes('node_modules/')) continue
    let pkg
    try {
      pkg = JSON.parse(read(file))
    } catch {
      continue
    }
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        scanned++
        if (!PROVIDER_SDK.test(name)) continue
        rows.push({ name, range: String(range), field, manifest: file })
      }
    }
  }
  rows.sort((a, b) =>
    `${a.manifest}${a.name}` < `${b.manifest}${b.name}`
      ? -1
      : `${a.manifest}${a.name}` > `${b.manifest}${b.name}`
        ? 1
        : 0,
  )
  return { rows, scanned }
}

// ── 9. Connector claims ─────────────────────────────────────────────────────

const PACKS = 'packages/provisioning/src/provider-packs.ts'

/**
 * Every connector the platform names, and the status it names it at.
 *
 * The Bible's first prohibition is a logo catalog: "do not claim an integration
 * works because OAuth succeeds". The check that makes the claim falsifiable is
 * the last column — a pack declaring a `redirectPath` that no route file serves
 * cannot complete an authorization, whatever its status says. For a `PLANNED`
 * pack that is consistent; for anything past `PLANNED` it is a false claim, and
 * the guard test refuses it.
 */
function connectorClaims() {
  if (!exists(PACKS)) return []
  const text = read(PACKS)
  const rows = []
  // Brace-matched, not `[\s\S]*?` to the first `\n  }),`. The lazy version
  // stopped at the first line that happened to close at that indent, so the
  // eleven packs carrying a nested `setup` schema were silently skipped: the
  // table rendered 13 connectors where the file declares 24. A parser that
  // drops rows without erroring is the failure mode an inventory exists to
  // prevent, so `packCount` below is asserted against the literal call count.
  for (const m of text.matchAll(/\n {2}pack\(\{\n/g)) {
    const start = m.index + m[0].length
    let depth = 1
    let i = start
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
    }
    const body = text.slice(start, i - 1)
    const field = (k) => new RegExp(`^\\s*${k}:\\s*"([^"]*)"`, 'm').exec(body)?.[1] ?? ''
    const redirect = /redirectPath:\s*"([^"]*)"/.exec(body)?.[1] ?? ''
    rows.push({
      key: field('key'),
      provider: field('provider'),
      capability: field('capability'),
      direction: /direction:\s*"([^"]*)"/.exec(body)?.[1] ?? '',
      lifecycle: /lifecycle:\s*"([A-Z_]+)"/.exec(body)?.[1] ?? 'PLANNED',
      status: /capabilityStatus:\s*"([A-Z_]+)"/.exec(body)?.[1] ?? 'PLANNED',
      redirect,
      redirectServed: redirect ? servedRoutes().has(redirect) : null,
      line: text.slice(0, m.index).split('\n').length + 1,
    })
  }

  // The literal number of `pack(` calls in the file, counted a second, simpler
  // way. If the two disagree the block parser has dropped something and the
  // right answer is to stop, not to write a shorter table that agrees with
  // itself on the next `--check`.
  const declared = (text.match(/^ {2}pack\(\{$/gm) ?? []).length
  if (declared !== rows.length) {
    throw new Error(
      `${PACKS} declares ${declared} connector packs and the parser extracted ${rows.length}. ` +
        `An inventory that silently drops rows is the defect it exists to prevent.`,
    )
  }
  for (const r of rows) {
    if (!r.key || !r.provider || !r.capability) {
      throw new Error(`A connector pack near line ${r.line} of ${PACKS} parsed without a key, provider or capability.`)
    }
  }

  return rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

let SERVED = null
function servedRoutes() {
  if (SERVED) return SERVED
  SERVED = new Set(httpSurfaces().map((r) => r.route))
  return SERVED
}

// ── Rendering ───────────────────────────────────────────────────────────────

const cell = (v) => (v === '' || v === null || v === undefined ? '—' : String(v))

function table(headers, rows) {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`]
  for (const r of rows) lines.push(`| ${r.map(cell).join(' | ')} |`)
  return lines.join('\n')
}

export function collect() {
  const callers = sqsCallers()
  const sdks = providerSdks()
  return {
    http: httpSurfaces(),
    events: events(),
    queues: queues(callers),
    sqsCallers: callers,
    schedules: schedules(),
    alarms: alarms(callers),
    buckets: buckets(),
    files: fileSurfaces(),
    credentials: credentialReferences(),
    sdks: sdks.rows,
    sdksScanned: sdks.scanned,
    connectors: connectorClaims(),
  }
}

export function render(i) {
  const orphanQueues = i.queues.filter((q) => q.verdict.startsWith('orphan'))
  const deadAlarms = i.alarms.filter((a) => a.verdict.startsWith('CANNOT FIRE'))
  const unconsumed = i.events.filter((e) => e.verdict === 'produced, no registered consumer')
  const unbuiltRedirects = i.connectors.filter((c) => c.redirect && c.redirectServed === false)

  return `<!-- Generated by tools/int-integration-inventory.mjs. Do not edit by hand. -->

# Integration inventory and producer/consumer map

This document ANSWERS two requirements the integration Bible STATES:
\`INT-000-001\` (inventory the current internal events, APIs, queues, jobs,
webhooks, files, credential references, provider SDKs and connector claims) and
\`INT-000-002\` (map producer/consumer for every integration resource, naming
orphan and producerless resources and alarms that cannot fire).

It deliberately does not restate either one in requirement form. A line that
opens \`ID — text\` is how \`tools/document-graph.mjs\` recognises a document
STATING a requirement, and this file trips its authority markers by discussing
the Bible — so the earlier header transferred ownership of both ids from the
Bible to this generated answer. The work queue then printed a truncated line of
this file's own prose as the requirement, and the answer became its own
authority. \`tests/architecture/int-requirements-are-imported.test.mjs\` reds on
that, and the guard test for this file refuses the shape directly.

Generated from the working tree by \`tools/int-integration-inventory.mjs\`.
\`node tools/int-integration-inventory.mjs --check\` fails when this file and the
tree disagree, and \`tests/architecture/int-integration-inventory.test.mjs\` runs
it.

**What this is not.** Every statement here is about the repository. "No producer
in the tree" is a fact about code that is committed. It is NOT a traffic
measurement: nothing in this tool has authenticated to an AWS account or read a
CloudWatch datapoint, and a row saying a queue has no producer does not become a
claim about message counts in a deployed environment. Where the Bible asks for
"actual traffic", that half is unmet and is recorded as unmet rather than
approximated from structure.

## Summary

${table(
  ['category', 'count'],
  [
    ['HTTP route handlers', i.http.length],
    ['— inbound from a provider', i.http.filter((r) => r.direction === 'inbound-provider').length],
    ['— inbound from the scheduler', i.http.filter((r) => r.direction === 'inbound-scheduler').length],
    ['internal event types', i.events.length],
    ['SQS queues declared', i.queues.length],
    ['SQS queues with a producer in the tree', i.queues.filter((q) => !q.verdict.startsWith('orphan')).length],
    ['scheduled rules', i.schedules.length],
    ['CloudWatch alarms', i.alarms.length],
    ['alarms that cannot fire', deadAlarms.length],
    ['S3 buckets declared', i.buckets.length],
    ['file-exchange modules', i.files.length],
    ['credential references (names)', i.credentials.length],
    ['provider SDK dependencies', i.sdks.length],
    ['direct dependencies scanned', i.sdksScanned],
    ['connector claims', i.connectors.length],
  ],
)}

## 1. HTTP surfaces

Every \`route.ts\` in either application, with the verbs it exports and who can
reach it. \`direction\` is derived from the route path, not asserted.

${table(
  ['experience', 'route', 'verbs', 'direction', 'file'],
  i.http.map((r) => [r.experience, `\`${r.route}\``, r.verbs.join(', '), r.direction, `\`${r.file}\``]),
)}

## 2. Internal events — producer and consumer

Three independent readings, kept apart: what \`modules/index.ts\` declares, where
\`outboxEventRow\` is actually called, and what \`apps/web/src/lib/outbox/consumers.ts\`
registers.

${table(
  ['event', 'declared emitters', 'declared consumers', 'producers in code', 'consumers in code', 'verdict'],
  i.events.map((e) => [
    e.type,
    e.declaredEmit.join(', '),
    e.declaredConsume.join(', '),
    e.producers.map((p) => `\`${p}\``).join('<br>'),
    e.consumers.map((c) => `\`${c}\``).join('<br>'),
    e.verdict,
  ]),
)}

## 3. Queues — producer and consumer

The only SQS client in the repository:

${table(
  ['role', 'files'],
  [
    ['holds `@aws-sdk/client-sqs`', i.sqsCallers.holders.map((f) => `\`${f}\``).join('<br>')],
    ['sends a message', i.sqsCallers.senders.map((f) => `\`${f}\``).join('<br>')],
    ['receives a message', i.sqsCallers.receivers.map((f) => `\`${f}\``).join('<br>')],
  ],
)}

${table(
  ['queue', 'terraform name', 'redrive', 'producers', 'consumers', 'verdict', 'declared in'],
  i.queues.map((q) => [
    q.label,
    `\`${q.name}\``,
    q.redrive,
    q.producers.length,
    q.consumers.length,
    q.verdict,
    `\`${q.file}:${q.line}\``,
  ]),
)}

## 4. Scheduled jobs

${table(
  ['rule', 'schedule', 'method', 'target', 'declared in'],
  i.schedules.map((s) => [s.label, `\`${s.schedule}\``, s.method, `\`${s.target}\``, `\`${s.file}:${s.line}\``]),
)}

## 5. Alarms over integration resources

An alarm whose metric namespace is \`AWS/SQS\` while no module in the tree
enqueues is green because nothing has arrived, not because delivery is healthy —
the Bible's "false green alarm", made structural.

${table(
  ['alarm', 'namespace', 'metric', 'treat_missing_data', 'verdict', 'declared in'],
  i.alarms.map((a) => [
    a.label,
    a.namespace,
    a.metric,
    `\`${a.missing}\``,
    a.verdict,
    `\`${a.file}:${a.line}\``,
  ]),
)}

## 6. Files

Object-storage buckets, and the modules that move bytes through them.

${table(['bucket', 'declared in'], i.buckets.map((b) => [b.label, `\`${b.file}:${b.line}\``]))}

${table(['module', 'uses'], i.files.map((f) => [`\`${f.file}\``, f.uses.join(', ')]))}

## 7. Credential references — names only

Names and identifiers. No value is read by the generator and none appears here.

${table(
  ['reference', 'kind', 'declared in'],
  i.credentials.map((c) => [`\`${c.reference}\``, c.kind, `\`${c.where}\``]),
)}

## 8. Provider SDKs

Selected from ${i.sdksScanned} direct dependencies across every workspace manifest.

${table(
  ['package', 'range', 'field', 'manifest'],
  i.sdks.map((s) => [`\`${s.name}\``, `\`${s.range}\``, s.field, `\`${s.manifest}\``]),
)}

## 9. Connector claims

Declared by \`${PACKS}\`. The last column is the falsifier: a pack whose
\`redirectPath\` no route file serves cannot complete an authorization, whatever
its status says.

${table(
  ['connector', 'provider', 'capability', 'direction', 'lifecycle', 'capability status', 'redirect path', 'redirect served'],
  i.connectors.map((c) => [
    `\`${c.key}\``,
    c.provider,
    c.capability,
    c.direction,
    c.lifecycle,
    c.status,
    c.redirect ? `\`${c.redirect}\`` : '',
    c.redirectServed === null ? 'n/a' : c.redirectServed ? 'yes' : 'no',
  ]),
)}

## 10. Findings

${[
  `**${orphanQueues.length} of ${i.queues.length} SQS queues are orphans** — no module in the tree sends to them and none receives from them: ${orphanQueues.map((q) => `\`${q.label}\``).join(', ') || 'none'}.`,
  `**${deadAlarms.length} of ${i.alarms.length} alarms cannot fire.** ${deadAlarms.map((a) => `\`${a.label}\` (${a.namespace} ${a.metric}, treat_missing_data ${a.missing})`).join('; ') || 'none'}.`,
  `**${unconsumed.length} event type(s) are produced with no registered consumer**: ${unconsumed.map((e) => `\`${e.type}\``).join(', ') || 'none'}.`,
  `**${unbuiltRedirects.length} of ${i.connectors.length} connector claims declare a redirect path no route serves**${unbuiltRedirects.length ? ` — consistent only while every one of them is PLANNED, which is what column 5 above must keep saying` : ''}.`,
  `**Actual traffic is not measured.** The Bible's INT-000-002 asks for producer/consumer *and* actual traffic. Structure is answered above; traffic is not, and requires read-only CloudWatch access this tool does not have.`,
]
  .map((f) => `- ${f}`)
  .join('\n')}
`
}

const isCommand =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const generated = render(collect())
  const target = path.join(ROOT, OUT)
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : ''
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/int-integration-inventory.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(target, generated)
    console.log(`Wrote ${OUT}`)
  }
}

export { OUT, ROOT }
