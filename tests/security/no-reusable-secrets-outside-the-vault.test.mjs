import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { credentialWrites } from "./no-tokens-in-browser-storage.test.mjs"

/**
 * WRK-040-005 — a reusable provider secret leaves the vault through six sinks,
 * and each one is guarded by a named call site this file resolves.
 *
 * ## What "guarded" has to mean, and why a source assertion is the right shape
 *
 * `findSecretValues` is one function with one rule. Its value is entirely in
 * WHO CALLS IT: a scanner with one caller protects one sink, and the other five
 * are unprotected while the package's own unit tests stay green — which is
 * exactly the state this item opened in. So the property under test here is not
 * "the scanner works" (that is `packages/audit/src/audit.test.ts`) but "the
 * scanner is still reached from each of the six places a secret can get out".
 *
 * That property cannot be proved by calling the scanner. It has to be proved
 * against the sink's own module, which is why five of the six checks below
 * resolve a (file, symbol) pair in comment-stripped source: delete
 * `findSecretValues` from `aiComplete` and the model check reds, replace
 * `safeLogText(err)` with `${err}` and the log check reds, drop the
 * `blockers.push` after the configuration scan and the config check reds. A
 * green suite over a deleted guard is the failure mode this file exists to
 * prevent.
 *
 * Comments are stripped before every match, and that is load-bearing rather
 * than tidiness: `packages/audit/src/secret-values.ts` documents all five of
 * its callers by name in its own header, so a matcher that read comments would
 * be satisfied by prose describing a call site that had been deleted.
 *
 * ## The sixth sink is scanned, not resolved
 *
 * `evidence` has no single call site to point at. The ledgers and the generated
 * capability registry are written by hand and by `tools/document-graph.mjs`,
 * they are committed, they are public, and nothing on the way in scans them —
 * so a session that pasted a real webhook secret into an evidence string would
 * publish it and the value would then be in git history, where it cannot be
 * deleted. The scan below IS that sink's guard, run over the same patterns the
 * other five sinks refuse on, read out of the production module rather than
 * copied — a ninth format added to `PATTERNS` extends this sweep on the same
 * commit, instead of being a rule the docs are exempt from.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/** Source with comments stripped, so prose about a guard is not the guard. */
function code(file) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8")
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // The `[^:]` guard keeps `https://…` from being read as a line comment.
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/* ────────────────────────────────── the patterns, read from the production module */

const SECRET_VALUES = "packages/audit/src/secret-values.ts"

/**
 * The credential formats `secret-values.ts` refuses on, parsed out of it.
 *
 * Not a copy. A copy is a second list, and a second list is one somebody
 * extends without extending the first — at which point the evidence sink is
 * quietly exempt from the rule the other five enforce. Parsing the literal
 * means the two cannot drift, at the cost of a parser that has to fail loudly
 * when the shape changes, which is what `the patterns are readable at all`
 * below is for.
 */
function productionPatterns() {
  const source = fs.readFileSync(path.join(ROOT, SECRET_VALUES), "utf8")
  const start = source.indexOf("const PATTERNS")
  assert.notEqual(start, -1, `${SECRET_VALUES} no longer declares PATTERNS`)
  // The array's closing bracket, found as a line of its own. NOT the next `]`:
  // the declaration's own type annotation is `{ … }[]`, and slicing to that
  // bracket yields a block with no entries in it — which parses to zero
  // patterns and reports every document as clean. That is the exact silence
  // this parser has to fail loudly on, and it is how this first ran.
  const end = source.indexOf("\n]", start)
  assert.notEqual(end, -1, `${SECRET_VALUES}'s PATTERNS array does not close on a line of its own`)
  const block = source.slice(start, end)

  return [...block.matchAll(/kind:\s*"([^"]+)",\s*re:\s*\/(.+?)\/([gimsuy]*)\s*\}/g)].map((m) => ({
    kind: m[1],
    // `g` is dropped deliberately: a sticky `lastIndex` shared across files
    // makes a sweep skip lines, which reads as "clean".
    re: new RegExp(m[2], m[3].replace(/g/g, "")),
  }))
}

test("the patterns are readable at all", () => {
  // Asserted because the failure mode of a parser is SILENCE: an extractor that
  // matched nothing would report every document as clean forever, and the
  // evidence sweep below would be decorative rather than a guard.
  const patterns = productionPatterns()

  assert.ok(
    patterns.length >= 8,
    `expected to parse at least the 8 credential formats ${SECRET_VALUES} ships, parsed ` +
      `${patterns.length}. The literal's shape changed and this sweep is now reading fewer ` +
      `formats than the code refuses on.`,
  )

  // The extracted regexes must behave like the production ones, so the sweep is
  // not matching a corrupted transcription of them.
  const positives = [
    ["whsec_" + "a".repeat(10), "webhook signing secret"],
    ["sk_live_" + "a".repeat(16), "provider secret key"],
    ["AKIA" + "A".repeat(16), "AWS access key id"],
  ]
  for (const [sample, kind] of positives) {
    assert.ok(
      patterns.some((p) => p.kind === kind && p.re.test(sample)),
      `the parsed "${kind}" pattern does not match the format it names`,
    )
  }

  // And must not fire on the identifiers a ledger is made of — a guard that
  // reds on every cuid and checksum gets an exemption added, not a bug fixed.
  for (const ordinary of [
    "cmf3k2h9x0001qw8v6b2z9abc",
    "sha256:4f2a9c1b8e7d6f5a4b3c2d1e0f9a8b7c",
    "WRK-040-005",
    "20260807220000_model_usage_meter",
  ]) {
    const hit = patterns.find((p) => p.re.test(ordinary))
    assert.equal(hit, undefined, `"${ordinary}" is matched as a ${hit?.kind}`)
  }
})

/* ─────────────────────────────────────────── sink 1 of 6: browser storage */

test("sink: browser — the storage guard still tells a credential from a preference", () => {
  // Resolved by IMPORTING the guard rather than reading it, because this one is
  // a function and can be asked. Deleting `credentialWrites` from
  // no-tokens-in-browser-storage.test.mjs fails this file at import time.
  assert.equal(typeof credentialWrites, "function", "the browser sink's guard has been removed")
  assert.equal(
    credentialWrites('window.localStorage.setItem("access_token", token)').length,
    1,
    "the browser guard no longer detects a token written to local storage",
  )
  assert.deepEqual(
    credentialWrites('window.localStorage.setItem("tenure-theme", "dark")'),
    [],
    "the browser guard now fires on an ordinary preference",
  )
})

/* ────────────────────────────────────────── sink 2 of 6: the model prompt */

const AI = "apps/web/src/lib/ai.ts"

test("sink: model — aiComplete scans the prompt before it reaches the vendor", () => {
  const source = code(AI)

  const scan = source.indexOf("findSecretValues(")
  assert.notEqual(
    scan,
    -1,
    `${AI} no longer calls findSecretValues. This is the one request in this application that ` +
      `leaves the account: a whsec_ pasted into a club's note field retrieves like any other ` +
      `document body and would be posted to a third party in the prompt.`,
  )

  const send = source.indexOf('fetch("https://api.anthropic.com')
  assert.notEqual(send, -1, `${AI} no longer posts to the vendor; this guard is asserting on nothing`)
  assert.ok(
    scan < send,
    `${AI} scans the prompt AFTER posting it. A scan downstream of the request is not a guard.`,
  )

  // REFUSE, not redact — and refusing means returning, not logging and
  // continuing. Without this, deleting the `return null` would leave the call
  // to `findSecretValues` in place and the prompt still on the wire.
  const between = source.slice(scan, send)
  assert.match(
    between,
    /return null/,
    `${AI} finds secrets in the prompt and does not return before the fetch. A redacted prompt ` +
      `asks the model a question with a hole in it and returns an answer built on it.`,
  )
})

/* ──────────────────────────────────────────────── sink 3 of 6: the logs */

/**
 * The two widest log sinks, and the binding that carries foreign text in each.
 *
 * `bus.ts` logs an arbitrary handler failure over a caller-supplied payload;
 * `ai.ts` logs a provider's own response body and its own thrown request
 * failures. Both are text this process did not author, which is the whole
 * reason they need scanning — the messages beside them that interpolate
 * `model` or `res.status` are values this application produced.
 */
const LOG_SINKS = [
  { file: "apps/web/src/lib/commands/bus.ts", foreign: [/\berr\b/] },
  { file: AI, foreign: [/\bdetail\b/, /\berr\b/] },
]

/** The argument text of every `console.*` call in a source, brace-matched. */
function consoleCalls(text) {
  const calls = []
  for (const match of text.matchAll(/console\s*\.\s*(error|warn|log|info)\s*\(/g)) {
    const open = text.indexOf("(", match.index)
    let depth = 0
    for (let i = open; i < text.length; i++) {
      if (text[i] === "(") depth++
      else if (text[i] === ")") {
        depth--
        if (depth === 0) {
          calls.push(text.slice(open + 1, i))
          break
        }
      }
    }
  }
  return calls
}

test("sink: log — every log line carrying foreign text goes through safeLogText", () => {
  const offenders = []

  for (const { file, foreign } of LOG_SINKS) {
    const calls = consoleCalls(code(file))
    assert.ok(calls.length > 0, `${file} has no console call; this guard is asserting on nothing`)

    for (const call of calls) {
      if (!foreign.some((re) => re.test(call))) continue
      if (/safeLogText\s*\(/.test(call)) continue
      offenders.push(`${file} — ${call.replace(/\s+/g, " ").slice(0, 110)}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these log text this process did not author, unscanned:\n  ${offenders.join("\n  ")}\n` +
      `A provider client that throws "Invalid API key: sk_live_…", or a driver echoing a row ` +
      `with a signing secret pasted into a note field, puts a reusable credential into ` +
      `CloudWatch — retained, widely readable, and outside every control the vault imposes.`,
  )

  // The other direction: at least one call in each file is actually wrapped, so
  // the sweep above cannot pass by matching nothing.
  for (const { file } of LOG_SINKS) {
    assert.ok(
      consoleCalls(code(file)).some((c) => /safeLogText\s*\(/.test(c)),
      `${file} no longer wraps any log line in safeLogText`,
    )
  }
})

/* ─────────────────────────────────────────────── sink 4 of 6: the events */

const OUTBOX = "apps/web/src/lib/outbox/outbox.ts"

test("sink: event — a provider-origin outbox payload is refused, not enqueued", () => {
  const source = code(OUTBOX)

  const scan = source.indexOf("findSecretValues(")
  assert.notEqual(scan, -1, `${OUTBOX} no longer scans provider payloads`)
  assert.match(
    source.slice(scan, scan + 600),
    /throw new ProviderPayloadRefused/,
    `${OUTBOX} scans the payload and does not refuse it. An outbox row is written inside a ` +
      `business transaction and handed to a dispatcher that logs it; a finding nobody throws on ` +
      `is a finding that ships.`,
  )
})

/* ────────────────────────────────────────── sink 5 of 6: the configuration */

const PUBLICATION = "packages/configuration/src/publication.ts"

test("sink: config — a published value carrying a credential is blocked", () => {
  const source = code(PUBLICATION)

  const scan = source.indexOf("findSecretValues(")
  assert.notEqual(
    scan,
    -1,
    `${PUBLICATION} no longer scans proposed values. "sensitivity: secret" is a LABEL on a ` +
      `definition — it decides display, never refusal — so an sk_live_ typed into any ordinary ` +
      `platform.* string resolves into every snapshot the application reads.`,
  )
  assert.match(
    source.slice(scan, scan + 800),
    /blockers\.push\(/,
    `${PUBLICATION} finds a secret in a proposed value and does not block the publish. This is ` +
      `the worst of the six sinks: a published value is checksummed into an immutable revision ` +
      `and cannot be un-published.`,
  )
})

/* ─────────────────────────────────────────── sink 6 of 6: the evidence trail */

/** The committed evidence: every execution ledger, and the registry generated from them. */
function evidenceFiles() {
  const ledgers = fs
    .readdirSync(path.join(ROOT, "docs/implementation"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/implementation/${name}`)

  // Generated by tools/document-graph.mjs FROM the ledgers, so a secret in an
  // evidence string is copied here too — scanned rather than assumed clean,
  // because a generator is not a redactor.
  return [...ledgers, "docs/architecture/capability-completeness-registry.yaml"]
}

test("sink: evidence — no ledger or capability-registry string carries a reusable credential", () => {
  const patterns = productionPatterns()
  const files = evidenceFiles()

  assert.ok(files.length > 5, `expected the execution ledgers, found ${files.length} file(s)`)

  const offenders = []
  for (const file of files) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n")
    lines.forEach((line, i) => {
      for (const { kind, re } of patterns) {
        // The line number and the KIND, never the value. A guard that printed
        // the match would put the credential into CI output, which is one more
        // place it does not belong.
        if (re.test(line)) offenders.push(`${file}:${i + 1} — ${kind}`)
      }
    })
  }

  assert.deepEqual(
    offenders,
    [],
    `these committed evidence strings carry a reusable credential:\n  ${offenders.join("\n  ")}\n` +
      `Rotate it first — it is in git history and cannot be deleted from there — then write the ` +
      `evidence with the format named rather than an instance of it.`,
  )
})

test("the evidence sweep would notice one", () => {
  // The sweep above passes today because the ledgers are clean, which is
  // indistinguishable from a sweep that matches nothing. This plants each
  // format in a synthetic document and asserts the same patterns catch it.
  const patterns = productionPatterns()

  const planted = [
    "whsec_" + "a".repeat(10),
    "sk_live_" + "b".repeat(16),
    "ghp_" + "c".repeat(24),
    "xoxb-" + "1".repeat(12),
  ]
  for (const value of planted) {
    const document = `- [x] **WRK-000-000** — done. Evidence: the endpoint secret is ${value}.`
    assert.ok(
      patterns.some((p) => p.re.test(document)),
      `a ledger line carrying ${value.slice(0, 6)}… would pass the evidence sweep`,
    )
  }

  // And an ordinary ledger line does not, so the sweep is not simply refusing
  // every document — which would be reverted rather than fixed.
  const ordinary =
    "- [x] **WRK-120-004** — Cost allocation. Evidence: ModelUsageMeter, migration 20260807220000."
  assert.ok(
    !patterns.some((p) => p.re.test(ordinary)),
    "the evidence sweep fires on an ordinary ledger line",
  )
})
