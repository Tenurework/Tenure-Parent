#!/usr/bin/env node
/**
 * WRK-000-001 — every provider logo, route, SDK, OAuth app, token, webhook,
 * sync, index, Relay tool, external action, environment, and public integration
 * claim this repository actually has.
 *
 * The Work Graph Bible opens WRK-000 with an inventory requirement, and it is
 * not paperwork. Invariant 3 of that Bible is "**No logo availability.** A
 * provider is not available because a UI card, SDK, API key, OAuth handshake,
 * or test webhook exists." That invariant is unfalsifiable until somebody lays
 * the twelve axes side by side per provider, because every one of them looks
 * like progress on its own. Twenty-four provider packs with an authorization
 * profile each is twenty-four OAuth flows on paper; the column that says
 * whether ANY of them has a client registration, a token, a sync, an index
 * entry, a Relay tool or one line of egress code is the column that turns a
 * roadmap back into a roadmap.
 *
 * ── Why this is not `int-integration-inventory.md` again ────────────────────
 *
 * The integration inventory is RESOURCE-oriented: queues, events, alarms,
 * buckets, and which of them has a producer. This one is PROVIDER-oriented: one
 * row per declared external provider, twelve columns, each derived from the
 * tree. The two answer different questions and neither substitutes for the
 * other — "the DLQ has no producer" and "Slack has an authorization profile, no
 * client registration and no egress" are not restatements of each other.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 *
 * The output is committed, so it has to be byte-identical on Linux and Windows:
 *
 *   * files come from `git ls-files --cached --others --exclude-standard`,
 *     which emits POSIX paths in a stable byte order — never `readdirSync`,
 *     whose order is the filesystem's;
 *   * every list is sorted explicitly on a POSIX string key before rendering;
 *   * every file is read with CRLF normalised to LF before matching, so a
 *     Windows checkout cannot produce a different capture or a different
 *     line number;
 *   * the document is joined with `\n`, and `.gitattributes` pins `* eol=lf`.
 *
 * ── What this can and cannot tell you ──────────────────────────────────────
 *
 * Every statement here is about the repository. "No token exists for Slack" is
 * a fact about committed code. It is NOT a statement about a deployed
 * environment: nothing here has authenticated to AWS, read Secrets Manager, or
 * listed a provider's app registrations, and the environment axis reports
 * variable NAMES found in source — never a value, and never a claim that a
 * value is or is not set in a running cell. Where the requirement's word
 * "environment" means a deployed one, that half is recorded as unmet rather
 * than approximated from source.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = 'docs/architecture/wrk-work-graph-inventory.md'

const PACKS = 'packages/provisioning/src/provider-packs.ts'
const CATALOGS = 'packages/provisioning/src/catalogs.ts'
const DEEP_LINKS = 'apps/web/src/lib/relay/citation.ts'
const MODULES = 'modules/index.ts'

/**
 * Tracked AND untracked-but-not-ignored, POSIX paths, git's byte order.
 *
 * `--others` for the reason `entry-point-inventory.mjs` records: a brand-new
 * provider route or a brand-new logo asset is precisely the row that must not
 * be invisible until after the commit that added it.
 */
function listFiles(...globs) {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', ...globs],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return out
    .split('\n')
    .filter(Boolean)
    // The index still lists a file deleted in the worktree; reading it throws
    // and would take down the inventory rather than dropping one row.
    .filter((f) => fs.existsSync(path.join(ROOT, f)))
    .sort()
}

/** File text with line endings normalised, so captures cannot vary by platform. */
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')

/**
 * Comments removed, string literals and line numbering preserved.
 *
 * This mirrors the stripper in `tests/architecture/no-uncertified-provider-claims.test.mjs`
 * and is written out again rather than imported: that file is a guard, not a
 * library, and importing a test into a generator would make the generator fail
 * whenever somebody edits an assertion. The properties that matter are the two
 * a regex stripper gets wrong — `https://…` must not be eaten at its `//`, and
 * a stripped comment must leave its newlines behind so `:line` stays true.
 */
function code(text) {
  let out = ''
  let state = 'code'
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const d = text[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') {
        state = 'line'
        i += 2
        continue
      }
      if (c === '/' && d === '*') {
        state = 'block'
        i += 2
        continue
      }
      if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
      out += c
      i += 1
      continue
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code'
        out += c
      }
      i += 1
      continue
    }
    if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code'
        i += 2
        continue
      }
      if (c === '\n') out += c
      i += 1
      continue
    }
    if (c === '\\') {
      out += c + (d ?? '')
      i += 2
      continue
    }
    if (c === '\n' && state !== 'tpl') {
      state = 'code'
      out += c
      i += 1
      continue
    }
    if (
      (state === 'sq' && c === "'") ||
      (state === 'dq' && c === '"') ||
      (state === 'tpl' && c === '`')
    ) {
      state = 'code'
    }
    out += c
    i += 1
  }
  return out
}

/** 1-indexed line of `index` in `text`. */
const lineOf = (text, index) => text.slice(0, index).split('\n').length

/**
 * Whether `text` names `token` as a whole word, case-insensitively.
 *
 * Substring matching is what makes an inventory prose. The first run of this
 * tool reported that Box has a route — the route was `/api/jobs/outbox` — and
 * that Adobe has an SDK, because `@aws-sdk/s3-request-presigner` contains the
 * word `Sign` from the display name `Adobe Acrobat Sign`. Both rows read as
 * evidence of a connector and neither was. A word boundary kills the first
 * class of error; dropping display-name WORDS in favour of the provider id and
 * the full display-name PHRASE kills the second.
 */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const names = (text, token) =>
  new RegExp(`(^|[^A-Za-z0-9])${escape(token)}([^A-Za-z0-9]|$)`, 'i').test(text)

// ── 1. Declared providers ───────────────────────────────────────────────────

/**
 * The `pack({...})` blocks in `provider-packs.ts`.
 *
 * Brace-counted rather than regex-matched over the whole file: a pack body
 * contains nested object literals (`authorization: oidc({...})`) and a lazy
 * `pack\(\{[\s\S]*?\}\)` stops at the first `})` inside the authorization
 * helper, which silently truncates every row's redirect path — the field this
 * inventory most needs.
 */
function packBlocks(text) {
  const blocks = []
  const needle = 'pack({'
  let from = 0
  for (;;) {
    const start = text.indexOf(needle, from)
    if (start === -1) break
    let depth = 0
    let i = start + needle.length - 1
    let inString = null
    for (; i < text.length; i += 1) {
      const c = text[i]
      if (inString) {
        if (c === '\\') i += 1
        else if (c === inString) inString = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') inString = c
      else if (c === '{') depth += 1
      else if (c === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    blocks.push({ body: text.slice(start, i + 1), line: lineOf(text, start) })
    from = i + 1
  }
  return blocks
}

const field = (body, name) => {
  const m = new RegExp(`\\b${name}:\\s*"([^"]*)"`).exec(body)
  return m ? m[1] : null
}

const arrayField = (body, name) => {
  const m = new RegExp(`\\b${name}:\\s*\\[([^\\]]*)\\]`).exec(body)
  if (!m) return []
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).sort()
}

/**
 * Every external provider this repository declares, from the three independent
 * places that declare one. Kept apart on purpose: a provider named in the
 * catalog but absent from the packs, or a deep-link policy for a provider with
 * no pack, is exactly the kind of drift a merged list hides.
 */
function providers() {
  const rows = []

  const packText = code(read(PACKS))
  for (const { body, line } of packBlocks(packText)) {
    const provider = field(body, 'provider')
    if (!provider) continue
    const authorize = field(body, 'authorize')
    rows.push({
      provider,
      source: PACKS,
      line,
      // Same line for a pack: `key` is declared inside the `pack({…})` block
      // this row was cut from. The catalog rows below differ, which is why this
      // is a field rather than an assumption.
      keyLine: line,
      key: field(body, 'key') ?? '',
      displayName: field(body, 'displayName') ?? '',
      product: field(body, 'product') ?? '',
      capability: field(body, 'capability') ?? '',
      direction: field(body, 'direction') ?? '',
      lifecycle: field(body, 'lifecycle') ?? 'PLANNED',
      status: field(body, 'capabilityStatus') ?? 'PLANNED',
      requirementIds: arrayField(body, 'requirementIds'),
      egressHosts: arrayField(body, 'egressHosts'),
      authorizeEndpoint: authorize ?? '',
      redirectPath: field(body, 'redirectPath') ?? '',
      pkce: /\bpkce:\s*true\b/.test(body),
    })
  }

  const catalogText = code(read(CATALOGS))
  const CAP =
    /provider:\s*"([^"]+)",\s*product:\s*"([^"]+)",\s*capability:\s*"([^"]+)",\s*direction:\s*"([^"]+)",\s*status:\s*"([^"]+)"/g
  for (const m of catalogText.matchAll(CAP)) {
    const before = catalogText.slice(0, m.index)
    const keyMatch = [...before.matchAll(/\bkey:\s*"([^"]+)"/g)].pop()
    const hostsMatch = [...before.matchAll(/\begressHosts:\s*\[([^\]]*)\]/g)].pop()
    rows.push({
      provider: m[1],
      source: CATALOGS,
      line: lineOf(catalogText, m.index),
      // A catalog entry declares its `key` well above its `capabilities:`
      // array — 28 lines above, for the one entry that exists — so the key's
      // line is genuinely a different citation from the capability's, and
      // collapsing the two would have this row cite text that is not there.
      keyLine: keyMatch ? lineOf(catalogText, keyMatch.index) : lineOf(catalogText, m.index),
      key: keyMatch ? keyMatch[1] : '',
      displayName: '',
      product: m[2],
      capability: m[3],
      direction: m[4],
      lifecycle: '',
      status: m[5],
      requirementIds: [],
      egressHosts: hostsMatch
        ? [...hostsMatch[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).sort()
        : [],
      authorizeEndpoint: '',
      redirectPath: '',
      pkce: false,
    })
  }

  return rows.sort((a, b) =>
    a.provider !== b.provider
      ? a.provider < b.provider
        ? -1
        : 1
      : a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0,
  )
}

/** Provider deep-link policies — a fourth declaration site, and its own row set. */
function deepLinkPolicies() {
  const text = code(read(DEEP_LINKS))
  const start = text.indexOf('PROVIDER_DEEP_LINK_POLICIES')
  if (start === -1) return []
  const slice = text.slice(start, text.indexOf('\n}\n', start) + 1)
  const rows = []
  for (const m of slice.matchAll(/providerId:\s*"([^"]+)",[\s\S]{0,400}?host:\s*"([^"]+)"/g)) {
    rows.push({ providerId: m[1], host: m[2], line: lineOf(text, start + m.index) })
  }
  return rows.sort((a, b) => (a.providerId < b.providerId ? -1 : 1))
}

// ── 2. The twelve axes ──────────────────────────────────────────────────────

const IMAGE = /\.(svg|png|jpe?g|gif|ico|webp|avif)$/i

/** Every image asset in the tree. The logo axis is a claim about this set. */
function imageAssets() {
  return listFiles().filter((f) => IMAGE.test(f))
}

const VERB =
  /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g
const DESTRUCTURED_VERBS = /export\s+const\s+\{([^}]*)\}\s*=/g

const APP_ROOTS = [
  { app: 'apps/web', root: 'apps/web/src/app' },
  { app: 'apps/system-studio', root: 'apps/system-studio/src/app' },
]

/** Every HTTP route, with its served path — the set a redirect must land in. */
function routes() {
  const rows = []
  for (const { app, root } of APP_ROOTS) {
    for (const file of listFiles(`${root}/**`)) {
      if (!/(^|\/)route\.ts$/.test(file)) continue
      const text = code(read(file))
      const found = [...text.matchAll(VERB)].map((m) => m[1])
      for (const d of text.matchAll(DESTRUCTURED_VERBS)) {
        for (const name of d[1].split(',').map((s) => s.trim())) {
          if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name)) found.push(name)
        }
      }
      const route =
        file
          .replace(root, '')
          .replace(/\/route\.ts$/, '')
          .replace(/\/\(.*?\)/g, '') || '/'
      rows.push({ app, route, verbs: [...new Set(found)].sort(), file })
    }
  }
  return rows.sort((a, b) => (a.file < b.file ? -1 : 1))
}

/**
 * Whether a route file could serve a concrete path, honouring Next's dynamic
 * segments.
 *
 * `/api/connections/[key]/callback` would serve
 * `/api/connections/slack.workspace/callback`; `/api/connections/opportunity`
 * would not. Segment-wise rather than by string equality, because a redirect
 * that "matches" only as a prefix is a redirect the provider will refuse.
 */
function servesPath(routePath, concrete) {
  const a = routePath.split('/').filter(Boolean)
  const b = concrete.split('/').filter(Boolean)
  if (a.length !== b.length) return false
  return a.every((seg, i) => /^\[.*\]$/.test(seg) || seg === b[i])
}

/** Direct dependencies of every workspace manifest. Names and ranges only. */
function dependencies() {
  const rows = []
  for (const manifest of listFiles('**/package.json')) {
    if (manifest.includes('node_modules/')) continue
    let json
    try {
      json = JSON.parse(read(manifest))
    } catch {
      continue
    }
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, range] of Object.entries(json[field] ?? {})) {
        rows.push({ name, range: String(range), field, manifest })
      }
    }
  }
  return rows.sort((a, b) =>
    a.name !== b.name ? (a.name < b.name ? -1 : 1) : a.manifest < b.manifest ? -1 : 1,
  )
}

/** Every `process.env.NAME` in source. NAMES only — no value is ever read. */
function environmentNames() {
  const names = new Map()
  for (const file of listFiles('apps/**', 'packages/**', 'modules/**', 'tools/**', 'scripts/**')) {
    if (!/\.(ts|tsx|mjs|js|cjs)$/.test(file)) continue
    const text = code(read(file))
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (!names.has(m[1])) names.set(m[1], file)
    }
    for (const m of text.matchAll(/process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g)) {
      if (!names.has(m[1])) names.set(m[1], file)
    }
  }
  return [...names.entries()]
    .map(([name, first]) => ({ name, first }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
}

/**
 * Every literal occurrence of an egress host in code, comments stripped.
 *
 * This is the external-action axis and it is the sharpest one, because it
 * cannot be argued with: a provider Tenure never names outside a comment is a
 * provider Tenure has never called. Comments must be stripped or the tool
 * certifies the very sentences that exist to record an absence — the header of
 * `calendar-sync.ts` contains `grep -rn graph.microsoft.com apps/web/src`,
 * which is a documented absence, not a call site.
 */
function egressUses(hosts) {
  const wanted = [...new Set(hosts)].sort()
  const byHost = new Map(wanted.map((h) => [h, []]))
  if (wanted.length === 0) return byHost
  for (const file of listFiles('apps/**', 'packages/**', 'modules/**', 'infrastructure/**')) {
    if (!/\.(ts|tsx|mjs|js|cjs|tf|json)$/.test(file)) continue
    if (file === PACKS || file === CATALOGS) continue
    // An action is something production does. A spec that names a host is
    // asserting about the declaration, not calling it, and counting it would
    // let a suite make a provider look connected.
    if (/\.(test|itest|spec)\.[a-z]+$/.test(file)) continue
    const text = /\.(ts|tsx|mjs|js|cjs)$/.test(file) ? code(read(file)) : read(file)
    for (const host of wanted) {
      let from = 0
      for (;;) {
        const at = text.indexOf(host, from)
        if (at === -1) break
        byHost.get(host).push({ file, line: lineOf(text, at) })
        from = at + host.length
      }
    }
  }
  // File then NUMERIC line: a string sort puts `:208` before `:56`, which is
  // deterministic and unreadable.
  for (const list of byHost.values())
    list.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
  return byHost
}

/** Relay tool registrations contributed by the module catalog. */
function relayTools() {
  const text = code(read(MODULES))
  const rows = []
  for (const m of text.matchAll(
    /toolKey:\s*"([^"]+)",\s*module:\s*"([^"]+)",[\s\S]{0,600}?requiredPermission:\s*"([^"]+)",\s*readOnly:\s*(true|false)/g,
  )) {
    rows.push({
      toolKey: m[1],
      module: m[2],
      requiredPermission: m[3],
      readOnly: m[4] === 'true',
      line: lineOf(text, m.index),
    })
  }
  return rows.sort((a, b) => (a.toolKey < b.toolKey ? -1 : 1))
}

/**
 * The credential plane: every file whose path says credential, token, vault or
 * secret, with the declared provider ids its code names.
 *
 * This is the token axis, and it is derived the same way as the egress axis
 * rather than asserted, because "is there a stored token for Slack" is a
 * question about whether the broker has ever heard of Slack. Comments are
 * stripped: a broker header that explains which providers it does NOT yet
 * handle must not be read as handling them.
 */
const BROKER = 'apps/web/src/lib/connections/credential-broker.ts'

function credentialSites(providerIds) {
  const rows = []
  for (const file of listFiles('apps/**', 'packages/**', 'modules/**')) {
    if (!/\.(ts|tsx)$/.test(file)) continue
    if (/\.(test|itest|spec)\.tsx?$/.test(file)) continue
    if (!/(credential|token|vault|secret)/i.test(file)) continue
    const text = code(read(file))
    const naming = providerIds.filter((p) => names(text, p)).sort()
    rows.push({ file, providers: naming, broker: file === BROKER })
  }
  return rows.sort((a, b) => (a.file < b.file ? -1 : 1))
}

/**
 * Files whose job is a provider synchronisation or an external index, and
 * whether any of them names a provider egress host.
 *
 * Path-selected then content-checked, in that order, because the interesting
 * answer is not "is there a file called sync" — there is — but "does the file
 * called sync talk to anything outside".
 */
function syncAndIndexSurfaces(hosts) {
  const wanted = [...new Set(hosts)]
  const rows = []
  for (const file of listFiles('apps/**', 'packages/**', 'modules/**')) {
    if (!/\.(ts|tsx)$/.test(file)) continue
    if (/\.(test|itest|spec)\.tsx?$/.test(file)) continue
    const base = file.slice(file.lastIndexOf('/') + 1)
    const kind = /sync/i.test(base) ? 'sync' : /(search|index|corpus)/i.test(base) ? 'index' : null
    if (!kind) continue
    const text = code(read(file))
    const naming = wanted.filter((h) => text.includes(h)).sort()
    rows.push({ file, kind, egress: naming })
  }
  return rows.sort((a, b) => (a.file < b.file ? -1 : 1))
}

/**
 * Brand names in text a user can read, beside a verb that turns the brand into
 * a claim about what Tenure does.
 *
 * The grammar is deliberately the same shape as
 * `tests/architecture/no-uncertified-provider-claims.test.mjs`'s, so this
 * inventory counts the thing that guard refuses rather than a different thing
 * with a similar name. Restricted to a capability verb in the same literal for
 * a reason a bare brand scan cannot dodge: `Monday`, `Box`, `Notion`, `Linear`
 * and `Zoom` are ordinary English words, and a scan that counts every
 * occurrence of them reports a weekday as an integration claim.
 */
const CAPABILITY_VERB =
  /\b(two-way|bi-?directional|syncs?|syncing|synced|writes? back|writing back|flows? back|flowing back|pushes?|pushing|pulls?|pulling|connects? to|connecting to|sends? to|reads? from|imports? from|exports? to|integrat\w+)\b/i

function publicClaims(brands) {
  const rows = []
  const files = listFiles('apps/web/src/**', 'apps/system-studio/src/**').filter(
    (f) => /\.(ts|tsx)$/.test(f) && !/\.(test|itest|spec)\.tsx?$/.test(f),
  )
  for (const file of files) {
    const text = code(read(file))
    for (const m of text.matchAll(/"([^"\n]{4,400})"|'([^'\n]{4,400})'|`([^`]{4,400})`/g)) {
      const literal = m[1] ?? m[2] ?? m[3] ?? ''
      if (!CAPABILITY_VERB.test(literal)) continue
      for (const brand of brands) {
        if (names(literal, brand)) {
          rows.push({ file, line: lineOf(text, m.index), brand, literal: literal.trim() })
        }
      }
    }
  }
  return rows.sort((a, b) =>
    a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.line - b.line || (a.brand < b.brand ? -1 : 1),
  )
}

// ── 3. Collect ──────────────────────────────────────────────────────────────

function collect() {
  const providerRows = providers()
  const deepLinks = deepLinkPolicies()
  const allHosts = [...new Set(providerRows.flatMap((p) => p.egressHosts))].sort()
  const routeRows = routes()
  const deps = dependencies()
  const envNames = environmentNames()
  const egress = egressUses(allHosts)
  const tools = relayTools()
  const surfaces = syncAndIndexSurfaces(allHosts)
  const images = imageAssets()

  const distinct = [...new Set(providerRows.map((p) => p.provider))].sort()
  const credentials = credentialSites(distinct)

  // Brand vocabulary for the claim scan: the provider id, plus each distinct
  // word of the declared display name. Derived, so a new pack is scanned for
  // without anybody remembering to extend a list.
  const brands = [
    ...new Set(
      providerRows.flatMap((p) => [p.provider, p.displayName].filter((b) => b && b.length > 2)),
    ),
  ].sort()
  const claims = publicClaims(brands)

  const perProvider = distinct.map((provider) => {
    const packs = providerRows.filter((p) => p.provider === provider)
    const hosts = [...new Set(packs.flatMap((p) => p.egressHosts))].sort()
    // The provider id and the pack keys only — never a WORD of a display name.
    // `Adobe Acrobat Sign` contributing `Sign` is how `@aws-sdk/s3-request-presigner`
    // came out as an Adobe SDK on the first run.
    const tokens = [provider, ...packs.map((p) => p.key).filter(Boolean)]
    const has = (s) => tokens.some((t) => names(s, t))

    const redirects = packs.map((p) => p.redirectPath).filter(Boolean)
    return {
      provider,
      packs: packs.length,
      logos: images.filter((f) => has(f.slice(f.lastIndexOf('/') + 1))),
      providerRoutes: routeRows.filter((r) => has(r.route)).map((r) => r.route),
      redirectsServed: redirects.filter((rp) =>
        routeRows.some((r) => servesPath(r.route, rp)),
      ),
      redirects,
      sdks: deps.filter((d) => has(d.name)).map((d) => d.name),
      authorizationProfiles: packs.filter((p) => p.authorizeEndpoint).length,
      clientEnvNames: envNames
        .filter((e) => new RegExp(`(^|_)${provider.toUpperCase()}(_|$)`).test(e.name))
        .map((e) => e.name),
      // The credential BROKER only. Every credential-plane file is listed in §7,
      // and two of the matches there are an English weekday inside a cron
      // explanation and a leak-detector regex for a provider token format —
      // neither is a stored credential, and counting a mention as one is how a
      // token axis comes to say a provider is connected.
      tokenSites: credentials
        .filter((c) => c.broker && c.providers.includes(provider))
        .map((c) => c.file),
      webhooks: routeRows
        .filter((r) => /webhook|provider-events|\/callback$/.test(r.route) && has(r.route))
        .map((r) => r.route),
      syncs: surfaces.filter((s) => s.kind === 'sync' && s.egress.some((h) => hosts.includes(h))),
      indexes: surfaces.filter((s) => s.kind === 'index' && s.egress.some((h) => hosts.includes(h))),
      relayTools: tools.filter((t) => has(t.toolKey) || has(t.module)),
      egressSites: hosts
        .flatMap((h) => egress.get(h) ?? [])
        .map((s) => `${s.file}:${s.line}`)
        .sort(),
      claims: claims.filter((c) => has(c.brand)),
      hosts,
    }
  })

  return {
    providerRows,
    deepLinks,
    routeRows,
    deps,
    envNames,
    egress,
    allHosts,
    tools,
    surfaces,
    credentials,
    images,
    claims,
    brands,
    perProvider,
  }
}

// ── 4. Render ───────────────────────────────────────────────────────────────

const cell = (v) => String(v).replace(/\|/g, '\\|')

function table(headers, rows) {
  if (rows.length === 0) return '_None._'
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n')
}

const yn = (n) => (n === 0 ? 'no' : String(n))

function render(i) {
  const withEgress = i.perProvider.filter((p) => p.egressSites.length > 0)
  const withClient = i.perProvider.filter((p) => p.clientEnvNames.length > 0)
  const withLogo = i.perProvider.filter((p) => p.logos.length > 0)
  const servedRedirects = i.perProvider.reduce((n, p) => n + p.redirectsServed.length, 0)
  const declaredRedirects = i.perProvider.reduce((n, p) => n + p.redirects.length, 0)

  return `<!-- Generated by tools/wrk-work-graph-inventory.mjs. Do not edit by hand. -->

# Work graph and workspace connector inventory

**WRK-000-001** — inventory every current provider logo, route, SDK, OAuth app,
token, webhook, sync, index, Relay tool, external action, environment, and
public integration claim.

Generated from the working tree by \`tools/wrk-work-graph-inventory.mjs\`.
\`node tools/wrk-work-graph-inventory.mjs --check\` fails when this file and the
tree disagree, and \`tests/architecture/wrk-work-graph-inventory.test.mjs\` runs it.

**What this is not.** Every statement here is about the repository. "No token
for Slack" is a fact about committed code, not about a deployed cell: nothing
here has authenticated to AWS, read Secrets Manager, or listed a provider's app
registrations. The environment axis reports variable NAMES found in source. No
value is read by the generator and none appears here. Where WRK-000-001's word
"environment" means a running environment, that half is unmet and is recorded as
unmet rather than approximated from source.

## Summary

| axis | count |
| --- | --- |
| distinct providers declared | ${i.perProvider.length} |
| provider pack / capability rows | ${i.providerRows.length} |
| provider deep-link policies | ${i.deepLinks.length} |
| distinct declared egress hosts | ${i.allHosts.length} |
| providers with any egress call in code | ${withEgress.length} |
| providers with a client-registration environment name | ${withClient.length} |
| providers with a logo asset | ${withLogo.length} |
| image assets in the whole repository | ${i.images.length} |
| declared OAuth redirect paths | ${declaredRedirects} |
| — served by a route file | ${servedRedirects} |
| HTTP routes in both apps | ${i.routeRows.length} |
| Relay tool registrations | ${i.tools.length} |
| — bound to an external provider | ${i.perProvider.reduce((n, p) => n + p.relayTools.length, 0)} |
| sync/index surfaces named in the tree | ${i.surfaces.length} |
| — naming a provider egress host | ${i.surfaces.filter((s) => s.egress.length > 0).length} |
| environment variable names in source | ${i.envNames.length} |
| public integration claims in user-visible text | ${i.claims.length} |

## 1. The twelve axes, per provider

One row per declared provider. This is the table invariant 3 of
\`Tenure_Universal_Work_Graph_and_Workspace_Connector_Cloud_Claude_Bible_v1.0.md\`
— "no logo availability" — cannot be checked without: each column on its own
looks like a connector, and the row as a whole says whether one exists.

${table(
  [
    'provider',
    'packs',
    'logo',
    'routes',
    'SDK',
    'OAuth profile',
    'client env',
    'token',
    'webhook',
    'sync',
    'index',
    'Relay tool',
    'external action',
    'public claim',
  ],
  i.perProvider.map((p) => [
    p.provider,
    p.packs,
    yn(p.logos.length),
    yn(p.providerRoutes.length),
    yn(p.sdks.length),
    yn(p.authorizationProfiles),
    yn(p.clientEnvNames.length),
    yn(p.tokenSites.length),
    yn(p.webhooks.length),
    yn(p.syncs.length),
    yn(p.indexes.length),
    yn(p.relayTools.length),
    yn(p.egressSites.length),
    yn(p.claims.length),
  ]),
)}

## 2. Declared provider packs and capabilities

Parsed from \`${PACKS}\` and \`${CATALOGS}\`. \`redirect served\` is the
falsifier: a pack whose \`redirectPath\` no route file serves cannot complete an
authorization, whatever its status says.

${table(
  [
    'provider',
    'key',
    'product',
    'capability',
    'direction',
    'lifecycle',
    'status',
    'requirements',
    'redirect path',
    'redirect served',
    'declared in',
  ],
  i.providerRows.map((p) => {
    const served = p.redirectPath
      ? i.routeRows.some((r) => servesPath(r.route, p.redirectPath))
        ? 'yes'
        : 'no'
      : 'n/a'
    return [
      p.provider,
      `\`${p.key}\``,
      p.product,
      p.capability,
      p.direction,
      p.lifecycle || 'n/a',
      p.status,
      p.requirementIds.join(', ') || '—',
      p.redirectPath ? `\`${p.redirectPath}\`` : '—',
      served,
      p.keyLine === p.line
        ? `\`${p.source}:${p.line}\``
        : `\`${p.source}:${p.keyLine}\` (capability at \`:${p.line}\`)`,
    ]
  }),
)}

## 3. Provider deep-link policies

A fourth declaration site, in \`${DEEP_LINKS}\`. Listed separately from the packs
because a deep-link policy for a provider with no pack — or a pack with no
policy — is drift a merged list would hide.

${table(
  ['provider id', 'host', 'declared in'],
  i.deepLinks.map((d) => [`\`${d.providerId}\``, d.host, `\`${DEEP_LINKS}:${d.line}\``]),
)}

## 4. Logos and brand assets

Every image asset in the repository. The logo axis above is a claim about this
set, so the set is printed rather than summarised.

${table(['asset'], i.images.map((f) => [`\`${f}\``]))}

## 5. Routes

Every HTTP route in both applications, and every declared OAuth redirect path
with the route that would serve it.

${table(
  ['route', 'verbs', 'file'],
  i.routeRows.map((r) => [`\`${r.route}\``, r.verbs.join(', ') || '—', `\`${r.file}\``]),
)}

${table(
  ['pack', 'redirect path', 'served by'],
  i.providerRows
    .filter((p) => p.redirectPath)
    .map((p) => {
      const hit = i.routeRows.find((r) => servesPath(r.route, p.redirectPath))
      return [`\`${p.key}\``, `\`${p.redirectPath}\``, hit ? `\`${hit.file}\`` : 'nothing']
    }),
)}

## 6. Provider SDKs

Direct dependencies across every workspace manifest whose package name contains
a declared provider's token. ${i.deps.length} dependency declarations scanned.

${table(
  ['package', 'range', 'field', 'manifest'],
  i.perProvider.flatMap((p) =>
    i.deps
      .filter((d) => p.sdks.includes(d.name))
      .map((d) => [`\`${d.name}\``, `\`${d.range}\``, d.field, `\`${d.manifest}\``]),
  ),
)}

## 7. OAuth apps, tokens, and webhooks

An authorization PROFILE is a description of a flow. A client REGISTRATION is a
credential a provider issued. The difference is the whole of invariant 3, so the
two are separate columns and neither is inferred from the other.

${table(
  ['provider', 'authorization profiles', 'client environment names', 'webhook routes'],
  i.perProvider.map((p) => [
    p.provider,
    p.authorizationProfiles,
    p.clientEnvNames.join(', ') || 'none',
    p.webhooks.join(', ') || 'none',
  ]),
)}

Every environment variable name in source, so the "none" above is checkable.
Names only — no value is read.

${table(
  ['name', 'first referenced in'],
  i.envNames.map((e) => [`\`${e.name}\``, `\`${e.first}\``]),
)}

The credential plane itself — every file whose path says credential, token,
vault or secret, and the declared provider ids its code names. A MENTION is not
a stored credential: a cron explanation that says "the first Monday" names the
\`monday\` provider id and a leak detector that recognises a provider's token
format names the provider it detects. The token column in §1 counts only
\`${BROKER}\`, which is the broker WRK-040-004 names.

${table(
  ['file', 'provider ids named', 'is the broker'],
  i.credentials.map((c) => [
    `\`${c.file}\``,
    c.providers.join(', ') || 'none',
    c.broker ? 'yes' : 'no',
  ]),
)}

## 8. Sync and index surfaces

Files whose name says sync, search, index or corpus, and the declared provider
egress hosts each one names in code with comments stripped.

${table(
  ['file', 'kind', 'provider hosts named'],
  i.surfaces.map((s) => [`\`${s.file}\``, s.kind, s.egress.join(', ') || 'none']),
)}

## 9. Relay tools

Registrations contributed by the module catalog in \`${MODULES}\`, which is what
\`relayToolsFor\` in \`apps/web/src/lib/relay-tools.ts\` offers a model.

${table(
  ['tool', 'module', 'required permission', 'read only', 'declared in'],
  i.tools.map((t) => [
    `\`${t.toolKey}\``,
    t.module,
    `\`${t.requiredPermission}\``,
    t.readOnly ? 'yes' : 'no',
    `\`${MODULES}:${t.line}\``,
  ]),
)}

## 10. External actions — egress to a declared provider host

Every literal occurrence of a declared egress host in code, comments stripped,
excluding the two files that declare the hosts. A provider Tenure never names
outside a comment is a provider Tenure has never called.

${table(
  ['host', 'occurrences in code'],
  i.allHosts.map((h) => [
    `\`${h}\``,
    (i.egress.get(h) ?? []).map((s) => `\`${s.file}:${s.line}\``).join('<br>') || 'none',
  ]),
)}

## 11. Public integration claims

Brand names in text a user can read — string literals and JSX text, comments
stripped — beside a verb that turns the brand into a claim about what Tenure
does. ${i.brands.length} brand tokens derived from the declared packs.

${table(
  ['file', 'line', 'brand', 'text'],
  i.claims.map((c) => [`\`${c.file}\``, c.line, c.brand, c.literal]),
)}

## 12. Findings

${[
  `**${i.perProvider.length} providers are declared; ${withEgress.length} ${withEgress.length === 1 ? 'is' : 'are'} called.** ${
    withEgress.length === 0
      ? 'No declared workspace-provider egress host appears anywhere in code outside the two files that declare it.'
      : `Called: ${withEgress.map((p) => p.provider).join(', ')}.`
  }`,
  `**${withClient.length} of ${i.perProvider.length} providers has a client-registration environment name.** An authorization profile exists for ${i.perProvider.reduce((n, p) => n + p.authorizationProfiles, 0)} pack rows; a profile describes a flow, and without a client id there is no application for the flow to run against.`,
  `**${servedRedirects} of ${declaredRedirects} declared OAuth redirect paths are served by a route.** A redirect no route serves cannot complete an authorization${servedRedirects === 0 ? ', so no declared pack can be authorized today' : ''}.`,
  `**${withLogo.length} of ${i.perProvider.length} providers have a logo asset**, out of ${i.images.length} image assets in the repository. Invariant 3 forbids reading availability off a logo; today there is no logo to misread.`,
  `**${i.tools.length} Relay tool registration(s) exist${i.tools.length ? `: ${i.tools.map((t) => `\`${t.toolKey}\``).join(', ')}` : ''}**, ${i.tools.every((t) => t.readOnly) ? 'all read-only' : 'not all read-only'}, and ${i.perProvider.every((p) => p.relayTools.length === 0) ? 'none is bound to an external provider' : 'at least one is bound to an external provider'}. There is no external-action tool.`,
  `**${i.surfaces.filter((s) => s.egress.length > 0).length} of ${i.surfaces.length} sync/index surfaces name a provider egress host.** The rest are Tenure-internal, which is what makes "sync" in a filename not evidence of a connector.`,
  `**${i.claims.length} public integration claim(s) survive in user-visible text.** \`tests/architecture/no-uncertified-provider-claims.test.mjs\` and \`tests/architecture/no-overstated-connectors.test.mjs\` are the guards that keep this number where it is; this inventory counts it, it does not enforce it.`,
  `**Deployed environments are not inspected.** WRK-000-001 names "environment"; source-declared names are answered above, and what is actually set in a running cell requires read-only AWS access this tool does not have.`,
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
    const current = fs.existsSync(target)
      ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
      : ''
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/wrk-work-graph-inventory.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(target, generated)
    console.log(`Wrote ${OUT}`)
  }
}

export { OUT, ROOT, collect, render, servesPath, code, packBlocks }
