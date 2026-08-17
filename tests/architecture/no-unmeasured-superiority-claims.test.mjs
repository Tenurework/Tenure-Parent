/**
 * TTES-050-005 — no superiority claim ships before the measurement behind it.
 *
 * The Bible asks for a block, not a promise: §20 "Block 'best' claims until
 * measured release gates pass", §22 "do not claim modern/best from screenshots
 * alone". Before this file nothing in the repository looked. `grep -rn` for the
 * marketing vocabulary across `apps/web/src` returns identifiers (`let best`),
 * an engineering qualifier ("generation is best-effort") and user advice ("best
 * practice is to cc the club advisor") — which is why a grep was never going to
 * be the answer, and why nobody had written one.
 *
 * The gate condition is read from the ledger by `tools/superiority-claims.mjs`,
 * so this is a gate rather than a ban: when `TTES-050-001` (per-persona measured
 * baselines) and `TTES-050-002` (a lawful competitor comparison) are both PASS,
 * the block lifts by itself and a measured claim may ship.
 *
 * Floors matter here more than usual, because every finding is an absence: a
 * detector that stopped recognising anything, or a file list that went empty,
 * would report a clean repository. Both are asserted against literals below.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT, ledgerStatuses } from "../../tools/document-graph.mjs"
import {
  CLAIM_SUBJECT,
  HARD_CLAIMS,
  MEASUREMENT_REQUIREMENTS,
  PUBLISHED_SURFACES,
  SOFT_CLAIMS,
  claimsFound,
  claimsIn,
  copyStringsIn,
  copyStringsInProse,
  gateState,
  shippedFiles,
} from "../../tools/superiority-claims.mjs"

test("the claim detector fires on claims and stays silent on the readings that are not claims", () => {
  // Exercised on literals, because the tree-wide assertion below is an absence
  // and would pass identically against a detector that had been switched off.
  const claimed = (s) => claimsIn(s).map((c) => `${c.tier}:${c.phrase.toLowerCase()}`)

  // Hard tier: no non-claim reading in shipped copy.
  assert.deepEqual(claimed("The best-in-class system for higher education."), ["hard:best-in-class"])
  assert.deepEqual(claimed("A world-class experience."), ["hard:world-class"])
  assert.deepEqual(claimed("Industry-leading approvals."), ["hard:industry-leading"])
  assert.deepEqual(claimed("The most advanced student operations suite."), ["hard:most advanced"])
  assert.deepEqual(claimed("The #1 platform for student organizations."), ["hard:the #1"])

  // Soft tier: a claim only when the same string names the subject.
  assert.deepEqual(claimed("Tenure is faster than the tools you use today."), ["soft:faster than"])
  assert.deepEqual(claimed("Relay is the best way to find a decision."), ["soft:best"])
  assert.deepEqual(claimed("A modern platform for student operations."), [], "no subject named")
  assert.deepEqual(
    claimed("the fastest refresh window on a surface is the smallest one declared"),
    [],
    "a fact about a cadence is not a claim",
  )

  // Benign spans, each a real occurrence in this repository.
  assert.deepEqual(
    claimed("Club leaders manage ongoing communication; best practice is to cc the club advisor for awareness."),
    [],
    "advice about the reader's own conduct",
  )
  assert.deepEqual(claimed("Callers degrade gracefully — Tenure generation is best-effort"), [], "a qualifier")
  assert.deepEqual(claimed("Tenure needs a modern browser."), [], "a statement about what the reader needs")
  assert.deepEqual(claimed("| Simon OSE (tenant #1) | https://example.invalid |"), [], "an ordinal, not a ranking")

  // The vocabulary itself has to be non-trivial, or every case above passes
  // against two patterns and a coincidence.
  assert.ok(HARD_CLAIMS.length >= 10, `Only ${HARD_CLAIMS.length} hard phrases; the vocabulary has been emptied.`)
  assert.ok(SOFT_CLAIMS.length >= 8, `Only ${SOFT_CLAIMS.length} soft phrases; the vocabulary has been emptied.`)
  assert.ok(CLAIM_SUBJECT.test("Tenure"), "the subject pattern no longer recognises the product's own name.")
})

test("the copy reader sees strings, templates and JSX text, and not comments", () => {
  // The direction that matters: a comment must not be read as copy. Half this
  // repository's superlatives are in engineering prose ("the fastest way to leak
  // a provider's token"), and reporting them would get the check switched off.
  // The two comments carry QUOTED superlatives, and that is deliberate: a
  // reader with comment handling removed does not merely include the comment
  // text, it reads the quoted span inside it as a string literal — which is how
  // engineering prose turns into a reported claim. Testing an unquoted comment
  // proved nothing, because nothing else in the reader would have picked it up.
  const source = [
    '// Tenure is a "world-class" platform — a comment, not copy.',
    '/* and see "best-in-class" — also a comment */',
    'const a = "Tenure is faster than the tools you use today."',
    "const b = `a ${x} world-class template`",
    'const url = "https://example.invalid/a//b"',
    "export const C = () => <p>Tenure is the best</p>",
  ].join("\n")

  const copy = copyStringsIn(source, "fixture.tsx")
  const texts = copy.map((c) => c.text)
  assert.ok(
    texts.some((t) => t.includes("faster than")),
    "a plain string literal was not read as copy.",
  )
  assert.ok(
    texts.some((t) => t.includes("world-class template")),
    "a template chunk was not read as copy.",
  )
  assert.ok(
    copy.some((c) => c.kind === "jsx-text" && c.text.includes("the best")),
    "JSX text was not read as copy.",
  )
  assert.ok(
    !texts.some((t) => t.includes("world-class") && !t.includes("template")),
    "a line comment's quoted superlative was read as copy.",
  )
  assert.ok(
    !texts.some((t) => t.includes("best-in-class")),
    "a block comment's quoted superlative was read as copy.",
  )
  // A `//` inside a string must not open a comment: everything after it on the
  // line would vanish, which is a silent under-read.
  assert.ok(
    texts.some((t) => t === "https://example.invalid/a//b"),
    "a URL literal was truncated by comment stripping.",
  )
  // Lines are reported, not guessed — and this assertion exists because the
  // first version of the reader got it wrong. It matched JSX text against a
  // SHORTENED copy of the source (comments and literals removed rather than
  // blanked), so a claim planted on line 79 of the real sign-in page was
  // reported on line 46. A finding with the wrong line is a finding the next
  // reader cannot confirm, and both the string case and the JSX case are pinned
  // here because only the second one was broken.
  const soft = copy.find((c) => c.text.includes("faster than"))
  assert.equal(soft.line, 3, "the reported line is not the line the string literal is on.")
  const jsx = copy.find((c) => c.kind === "jsx-text" && c.text.includes("the best"))
  assert.equal(jsx.line, 6, "the reported line is not the line the JSX text is on.")

  // Prose: fenced code is not copy, because a README's shell block is a command.
  const prose = copyStringsInProse(
    ["Tenure is measured.", "```", "echo world-class", "```", "The end."].join("\n"),
    "fixture.md",
  )
  assert.deepEqual(
    prose.map((p) => p.text),
    ["Tenure is measured.", "The end."],
  )
})

test("the gate is lifted by a measured PASS and by nothing else", () => {
  // Both branches exercised, so neither can rot: the real ledger decides the
  // live answer, and a synthetic all-PASS map proves the block is liftable
  // rather than permanent. A check that only ever ran the closed branch would
  // be a ban wearing a gate's clothes.
  const real = ledgerStatuses()
  const live = gateState(real)
  for (const requirement of MEASUREMENT_REQUIREMENTS) {
    const status = real.get(requirement.id)?.status
    assert.ok(status, `${requirement.id} has no ledger status at all; the gate cannot be evaluated.`)
    assert.equal(
      live.blocking.some((b) => b.id === requirement.id),
      status !== "PASS",
      `${requirement.id} is ${status} and the gate disagrees about whether it blocks.`,
    )
  }

  const allPass = new Map(MEASUREMENT_REQUIREMENTS.map((r) => [r.id, { status: "PASS" }]))
  assert.equal(gateState(allPass).open, true, "the block cannot be lifted by measurement; that makes it a ban.")

  // BLOCKED_EXTERNAL is not a pass. `TTES-050-002` is blocked on licensed
  // access and a human-subjects protocol, and a claim published while that is
  // true is exactly the unmeasured claim this requirement forbids.
  const blocked = new Map(MEASUREMENT_REQUIREMENTS.map((r) => [r.id, { status: "BLOCKED_EXTERNAL" }]))
  assert.equal(gateState(blocked).open, false, "a blocked measurement was treated as a measurement.")
})

test("every published surface exists and contributes copy", () => {
  // A surface that has been renamed contributes nothing and reports nothing,
  // which reads exactly like a clean surface.
  const missing = PUBLISHED_SURFACES.filter((s) => !fs.existsSync(path.join(ROOT, s.at))).map((s) => s.at)
  assert.deepEqual(missing, [], "A declared published surface does not exist.")
  assert.ok(
    PUBLISHED_SURFACES.every((s) => s.why && s.why.length > 20),
    "A published surface has no stated reason for being in scope.",
  )

  const files = shippedFiles()
  assert.ok(files.length >= 200, `Only ${files.length} shipped files were read; the surface list has collapsed.`)
  assert.ok(
    files.includes("README.md"),
    "README.md is not among the files read, so the repository's public front page is unchecked.",
  )
  assert.ok(
    files.some((f) => f.startsWith("apps/web/src/components/")),
    "no tenant component was read, so the product's own copy is unchecked.",
  )
  assert.ok(
    !files.some((f) => /\.(test|itest|spec)\./.test(f)),
    "a test file was read as shipped copy; this file's own fixtures would then be findings.",
  )
})

test("no superiority claim ships while the measurement that would prove it is undecided", () => {
  const gate = gateState()
  const { files, strings, claims } = claimsFound()

  // Floor first: 22,000 copy strings are read today. A reader that returned
  // nothing would make the assertion below vacuously true.
  assert.ok(strings >= 5000, `Only ${strings} copy strings across ${files.length} files; the reader has gone quiet.`)

  if (gate.open) {
    // The day both measurements are PASS this becomes the interesting branch:
    // claims are allowed, and what they must not be is unmeasured. There is
    // nothing to assert here yet that would not be a guess about how the
    // scorecard will be published, so it says so rather than pretending.
    assert.ok(true, "the gate is open; claims are permitted and must cite the scorecard.")
    return
  }

  const found = claims.map((c) => `${c.file}:${c.line} [${c.tier}] ${c.phrase} — ${c.text.trim().slice(0, 120)}`)
  assert.deepEqual(
    found,
    [],
    "Superiority claims are shipping with nothing measured behind them. Blocked by: " +
      gate.blocking.map((b) => `${b.id}=${b.status} (${b.establishes})`).join("; ") +
      String.fromCharCode(10) +
      found.join(String.fromCharCode(10)) +
      String.fromCharCode(10) +
      "Either remove the claim or record the measurement that makes it true. `node tools/superiority-claims.mjs` " +
      "prints this list with the gate's state.",
  )
})
