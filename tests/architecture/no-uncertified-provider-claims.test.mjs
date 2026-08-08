/**
 * WRK-GATE-080 — a Microsoft or Google capability may be claimed only where a
 * certification record backs it.
 *
 * The item this exists for: `apps/web/src/lib/calendar-sync.ts` opened with
 * "when Microsoft Graph credentials are provided, a real two-way
 * GraphCalendarSync implements the CalendarSyncProvider below and drops in with
 * no change to callers", and `CalendarSubscribe.tsx` repeated it to a student's
 * face as "Two-way sync (edits made in Outlook flowing back into Tenure) turns
 * on once your institution connects Microsoft 365". There was no connector:
 * `grep -rn graph.microsoft.com apps/web/src` found only that comment, the
 * `CalendarSyncProvider` seam had zero callers, and its single implementation
 * implemented neither of its two methods. Nothing anywhere recorded a
 * provider-side review, because nobody had asked for one.
 *
 * ## What this checks that its sibling does not
 *
 * `no-overstated-connectors.test.mjs` (WRK-GATE-000) asks a different question:
 * "does Tenure's own catalog lifecycle back this claim", and it lets a denial
 * through by heuristic so "there is no Microsoft Graph connector" may be
 * written down. This one asks the certification question — "is there a
 * PROVIDER-side approval, and is there any code it could be an approval OF" —
 * and it draws its line in a place a heuristic cannot be argued with:
 *
 *   * (A) In text a USER can read — JSX text and string literals, comments
 *     stripped — a gated brand beside a capability verb is refused outright.
 *     No negation escape, no per-file exemption. The only sanctioned way to
 *     put such a sentence on a screen is to render it from
 *     `providerActivation()`, which lives in `@tenure/platform-config` and is
 *     therefore not under `apps/web/src` at all. That is why zero is the right
 *     threshold rather than an awkward one: the compliant spelling produces no
 *     literal here by construction.
 *
 *   * (B) A review recorded as `APPROVED` must have a connector in the cell it
 *     could conceivably be an approval of. An approval for code that does not
 *     exist is the exact failure this item names, and it is the one that
 *     `providerActivation` cannot catch by itself — hand it an APPROVED record
 *     and it will happily activate a capability nobody built.
 *
 *   * (C) A comment describing a gated capability must, in its own block, name
 *     the record that says whether the capability exists. Stated plainly: this
 *     does NOT catch a false sentence added to a block that already cites the
 *     record — `no-overstated-connectors.test.mjs`'s caller-claim rule is what
 *     catches that, by greping for the callers a comment asserts. What (C)
 *     catches is prose about Microsoft Graph written with no pointer to the
 *     review at all, which is how the original claim read.
 *
 * Comments are read rather than stripped for (C) because the false claim in
 * this item WAS a comment. They are stripped for (A) and (B) because a user
 * cannot read a comment and a comment cannot make an HTTP request — the line
 * `grep -rn graph.microsoft.com apps/web/src` inside `calendar-sync.ts`'s own
 * header is a documented absence, and counting it as a call site would have
 * this rule certify the connector it exists to say does not exist.
 *
 * The shape — `git ls-files --cached --others`, a reasoned size assertion, a
 * string-preserving comment stripper — is `forbidden-clients.test.mjs`'s, which
 * is deliberately not edited here: it is dirty in a concurrent run.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

const CELL = 'apps/web/src'
const REVIEW_FILE = 'packages/platform-config/src/provider-review.ts'

/* ------------------------------------------------------------------ scope -- */

/**
 * Cell source files, tracked or merely present.
 *
 * `--others --exclude-standard` in both directions, for the reason
 * `forbidden-clients.test.mjs` records: a new component making a false claim
 * would otherwise pass until the commit that put it in CI's reach.
 */
function cellFiles() {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', CELL],
    { cwd: ROOT, encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    // Not tests. This rule is about a sentence "where a user can read it", and
    // a spec renders to a test runner — but the sharper reason is that the only
    // way a test names one of these phrases is to assert it is ABSENT.
    // `owned-wrappers.test.tsx` reads
    // `expect(dialog.textContent).not.toMatch(/two-way|half of Outlook/i)`,
    // which is this rule's own property, checked at the DOM. Flagging it asked
    // for the deletion of the assertion that proves the claim is gone, and the
    // comment beside it explaining WHY it must be gone. Production files —
    // every surface a student can actually reach — stay fully in scope.
    .filter((f) => !/\.(test|itest|spec)\.tsx?$/.test(f))

  // A survey that finds nothing reports "no violations". This fails instead.
  assert.ok(
    files.length > 100,
    `only ${files.length} files found under ${CELL} — the scan is broken, not the code`
  )
  // And the exclusion above must not be what emptied it: the component this
  // rule exists for has to be in the set it actually scanned.
  assert.ok(
    files.some((f) => f.endsWith('components/CalendarSubscribe.tsx')),
    'CalendarSubscribe.tsx is not in the scanned set — the test-file exclusion has over-matched'
  )
  return files
}

/** A file's text, or "" if it vanished between the listing and the read. */
function readIfPresent(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

/**
 * Comments removed, string literals and line numbering preserved.
 *
 * Strings must survive intact because (A) is entirely about them and (B) reads
 * a URL out of one. A regex stripper eats `https://…` at the `//`.
 */
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
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    if (c === '\n' && state !== 'tpl') { state = 'code'; out += c; i += 1; continue }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code'
    }
    out += c; i += 1
  }
  return out
}

/* ------------------------------------------------------------ the grammar -- */

/**
 * The brands whose capabilities need provider-side certification.
 *
 * Named here rather than read from `provider-packs.ts` on purpose, and it is
 * the one place this rule differs from its sibling by design: WRK-GATE-080 is
 * about MICROSOFT AND GOOGLE specifically, whose review programmes (Publisher
 * Verification, OAuth app verification) gate the exact product/action/scope
 * tuple. A pack row is Tenure's opinion; these are the vendors who have one of
 * their own.
 */
const GATED_BRAND =
  /\b(microsoft(?:\s+(?:graph|365|outlook|entra))?|graph\.microsoft\.com|outlook|office\s*365|google\s+(?:calendar|workspace|drive|api)|gmail)\b/i

/**
 * Verbs that turn a brand name into an assertion about what Tenure does with
 * it.
 *
 * "Outlook (web)" is a heading and names no capability; "Add this calendar to
 * Outlook" describes what the READER does. Both are in `CalendarSubscribe.tsx`
 * today and both are true. "Two-way sync … flowing back into Tenure" is a
 * claim about Tenure's own code, and it is the kind that has to be earned.
 */
const CAPABILITY_VERB =
  /\b(two-way|bi-?directional|syncs?|syncing|synced|writes? back|writing back|flows? back|flowing back|pushes?|pushing|pulls?|pulling|connects? to|connecting to|sends? to|reads? from|imports? from|exports? to)\b/i

/**
 * The sentence this item deleted, kept as a fixture.
 *
 * (A) finds nothing in a clean tree, and a detector that has never matched
 * anything is indistinguishable from a broken one. This is the exact string
 * that stood at `CalendarSubscribe.tsx:83-84`; if the grammar above ever stops
 * recognising it, the rule has rotted and says so here rather than in six
 * months when somebody writes the sentence again.
 */
const THE_CLAIM_THIS_ITEM_DELETED =
  'Two-way sync (edits made in Outlook flowing back into Tenure) turns on once your ' +
  'institution connects Microsoft 365.'

test('the detector still recognises the claim this item deleted', () => {
  assert.match(THE_CLAIM_THIS_ITEM_DELETED, GATED_BRAND)
  assert.match(THE_CLAIM_THIS_ITEM_DELETED, CAPABILITY_VERB)

  // And does not fire on the honest copy that replaced it, or the rule would
  // be a ban on saying anything rather than a ban on overstating.
  const honest =
    'This feed publishes one way. Tenure sends your events out to your calendar app; ' +
    'anything you change there stays there and never reaches Tenure.'
  assert.ok(
    !(GATED_BRAND.test(honest) && CAPABILITY_VERB.test(honest)),
    'the replacement sentence trips the detector — it would be unfixable'
  )
})

/* ------------------------------------ (A) no literal claim a user can read -- */

test('no user-visible string in the cell claims a gated provider capability', () => {
  const offenders = []

  for (const file of cellFiles()) {
    code(readIfPresent(file))
      .split('\n')
      .forEach((line, n) => {
        if (!GATED_BRAND.test(line)) return
        if (!CAPABILITY_VERB.test(line)) return
        offenders.push(`${file}:${n + 1}\n      ${line.trim().slice(0, 160)}`)
      })
  }

  assert.deepEqual(
    offenders,
    [],
    `a Microsoft or Google capability is stated as a literal where a user can read it:\n  ` +
      `${offenders.join('\n  ')}\n\n` +
      `There is no exemption for this. Render the sentence from providerActivation() — ` +
      `@tenure/platform-config exports calendarSyncSentence() for exactly this, and ` +
      `apps/web/src/components/CalendarSubscribe.tsx shows the shape. A sentence typed into ` +
      `a component outlives the record it describes; one derived from the gate cannot.`
  )
})

/* -------------------------------- (B) an approval needs code to approve of -- */

/**
 * Each `ProviderReview` constant, and the host a connector for it would call.
 *
 * The map is asserted complete below, so a review added without a host is a
 * failure rather than a silent pass — the shape `forbidden-clients.test.mjs`
 * uses for its owner lists, and for the same reason: growth has to be visible.
 */
const REVIEW_HOSTS = new Map([
  ['RELAY_ANTHROPIC_REVIEW', 'api.anthropic.com'],
  ['GRAPH_CALENDAR_REVIEW', 'graph.microsoft.com'],
])

/** Every `NAME: ProviderReview = { … }` in the review file, with its state. */
function declaredReviews() {
  const text = readIfPresent(REVIEW_FILE)
  const found = new Map()
  for (const m of text.matchAll(
    /export const ([A-Z_][A-Z0-9_]*)\s*:\s*ProviderReview\s*=\s*\{([\s\S]*?)\n\}/g
  )) {
    found.set(m[1], /state:\s*"([A-Z_]+)"/.exec(m[2])?.[1] ?? 'UNPARSED')
  }
  assert.ok(found.size >= 2, `parsed only ${found.size} ProviderReview constants from ${REVIEW_FILE}`)
  return found
}

/**
 * Where in the CELL a host is actually contacted.
 *
 * The cell, not the whole repository: `packages/provisioning/src/provider-packs.ts`
 * lists `graph.microsoft.com` as a declared `egressHosts` entry on a PLANNED
 * pack, which is metadata about an integration nobody has built. Counting that
 * as a connector would make this rule certify the absence it is checking for.
 * A request path lives in `apps/web/src`.
 */
function callSitesInCell(host) {
  const found = []
  for (const file of cellFiles()) {
    code(readIfPresent(file))
      .split('\n')
      .forEach((line, n) => {
        if (line.includes(host)) found.push(`${file}:${n + 1}`)
      })
  }
  return found
}

test('the call-site detector reports the truth about both directions', () => {
  // A real one. `apps/web/src/lib/ai.ts` fetches https://api.anthropic.com/v1/messages,
  // so a detector that cannot find this is broken and every (B) result below is
  // meaningless — including the ones that pass.
  assert.ok(
    callSitesInCell('api.anthropic.com').length > 0,
    'the detector cannot find the one outbound call this application actually makes'
  )

  // And an absent one. This is the state WRK-GATE-080 asserts: no Microsoft
  // Graph connector exists in the cell. If somebody builds one, this line is
  // the first thing that fails, which is the moment to record a real review.
  assert.deepEqual(
    callSitesInCell('graph.microsoft.com'),
    [],
    'a Microsoft Graph call site now exists in the cell. That is not forbidden — but the ' +
      'provider-side review in packages/platform-config/src/provider-review.ts must stop ' +
      'saying NOT_SUBMITTED before it can be reached, and this assertion must be updated ' +
      'with the certification that was actually obtained.'
  )
})

test('no provider review is APPROVED for a connector that does not exist', () => {
  const reviews = declaredReviews()
  const offenders = []

  for (const [name, state] of reviews) {
    const host = REVIEW_HOSTS.get(name)
    assert.ok(
      host,
      `${name} is a ProviderReview with no registered host in this rule. Add it to ` +
        `REVIEW_HOSTS naming the endpoint a connector for it would call, so an APPROVED ` +
        `state can be checked against code rather than taken on trust.`
    )
    if (state !== 'APPROVED') continue
    if (callSitesInCell(host).length > 0) continue
    offenders.push(
      `${REVIEW_FILE} — ${name} is APPROVED, but nothing under ${CELL} contacts ${host}`
    )
  }

  assert.deepEqual(
    offenders,
    [],
    `a provider-side approval is recorded for an integration that does not exist:\n  ` +
      `${offenders.join('\n  ')}\n\n` +
      `providerActivation() will activate on this record and every surface reading it will ` +
      `start telling users the capability works. An approval is an approval OF something; ` +
      `set the state back to NOT_SUBMITTED until the connector is built.`
  )
})

test('the calendar gate names the exact scope a two-way sync would need', () => {
  const text = readIfPresent(REVIEW_FILE)

  // Product/action/scope, exactly — the certification tuple WRK-GATE-080 names.
  // A vaguer scope ("microsoft:Calendars") would be an approval nobody could
  // check a request against.
  assert.match(
    text,
    /export const GRAPH_CALENDAR_SCOPES[^\n]*=\s*\["microsoft:Calendars\.ReadWrite"\]/,
    'GRAPH_CALENDAR_SCOPES no longer names Calendars.ReadWrite — the scope a write-back needs'
  )
  assert.ok(
    REVIEW_HOSTS.has('GRAPH_CALENDAR_REVIEW') && declaredReviews().has('GRAPH_CALENDAR_REVIEW'),
    'GRAPH_CALENDAR_REVIEW is gone; the calendar surfaces would have nothing to derive from'
  )
})

/* ------------------------- (C) prose about a gated capability cites the record -- */

/** Line indices of every comment line, by comparing against the stripped text. */
function commentLines(raw) {
  const stripped = code(raw).split('\n')
  const lines = raw.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== stripped[i]) out.push(i)
  }
  return out
}

/** The contiguous run of comment lines containing `index`. */
function blockAround(lines, commentSet, index) {
  let start = index
  while (start > 0 && commentSet.has(start - 1)) start -= 1
  let end = index
  while (end < lines.length - 1 && commentSet.has(end + 1)) end += 1
  return lines.slice(start, end + 1).join('\n')
}

/** Naming the record: the gate, the derived sentence, or a review constant. */
const CITES_THE_RECORD = /providerActivation|calendarSyncSentence|[A-Z][A-Z0-9_]*_REVIEW\b|provider-review/

test('a comment describing a gated capability points at the review record', () => {
  const offenders = []

  for (const file of cellFiles()) {
    const raw = readIfPresent(file)
    if (!raw) continue
    const lines = raw.split('\n')
    const comments = commentLines(raw)
    if (comments.length === 0) continue
    const commentSet = new Set(comments)

    for (const i of comments) {
      if (!GATED_BRAND.test(lines[i])) continue
      if (!CAPABILITY_VERB.test(lines[i])) continue
      if (CITES_THE_RECORD.test(blockAround(lines, commentSet, i))) continue
      offenders.push(`${file}:${i + 1}\n      ${lines[i].trim().slice(0, 160)}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a comment describes a Microsoft or Google capability without naming the record that ` +
      `says whether it exists:\n  ${offenders.join('\n  ')}\n\n` +
      `Cite GRAPH_CALENDAR_REVIEW, RELAY_ANTHROPIC_REVIEW or providerActivation in the same ` +
      `comment block. The claim that started WRK-GATE-080 — "a real two-way GraphCalendarSync ` +
      `… drops in with no change to callers" — pointed at nothing, which is why a reader had ` +
      `no way to discover it was false.`
  )
})
