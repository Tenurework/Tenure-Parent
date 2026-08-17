import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"
import {
  TRUTHS,
  readOnlySourceProblems,
  resolveTruths,
  withoutComments,
} from "../../tools/ext-baseline-truth.mjs"

/**
 * EXT-000-002 — the seven baseline truths are inventoried, and inventorying
 * them writes nothing.
 *
 * *"Current repository, AWS, environment, tenant, data, integration, and
 * release truth is inventoried read-only without exposing secrets."*
 *
 * The seven words are taken from the statement itself rather than from a
 * reading of it, so a truth cannot be quietly renamed out of scope. Every
 * artifact is opened. Every generator is read for a call that would change what
 * it is describing — and the detector is exercised against sources that DO
 * mutate, because a detector nobody proved can fail reports zero forever.
 *
 * The third clause, "without exposing secrets", is checked in Jest by
 * `apps/web/src/lib/platform/inventories-carry-no-credential.test.ts`: the
 * credential patterns live in `packages/audit/src/secret-values.ts` and a
 * second copy of them here would be the duplicate-source defect this repository
 * keeps a register of.
 */

const REGISTRY = "docs/architecture/capability-completeness-registry.yaml"

test("the seven truths are the seven the requirement names", () => {
  const statement = fs
    .readFileSync(path.join(ROOT, REGISTRY), "utf8")
    .split(/\r?\n/)
    .find((l) => l.includes("truth is inventoried read-only without exposing secrets"))
  assert.ok(statement, `EXT-000-002's statement was not found in ${REGISTRY}`)

  assert.equal(TRUTHS.length, 7, "the requirement names seven truths")
  for (const t of TRUTHS) {
    assert.ok(
      statement.includes(t.word),
      `"${t.word}" is declared as a truth and does not appear in EXT-000-002's statement`,
    )
  }
  assert.equal(new Set(TRUTHS.map((t) => t.truth)).size, 7, "two truths share a name")
})

test("every truth has at least one artifact, and every artifact is on disk and not empty", () => {
  const problems = []
  for (const t of resolveTruths()) {
    if (t.artifacts.length === 0) problems.push(`${t.truth}: nothing inventories it`)
    for (const a of t.artifacts) {
      if (!a.exists) problems.push(`${t.truth}: ${a.path} is declared and not here`)
      else if (a.bytes === 0) problems.push(`${t.truth}: ${a.path} is empty`)
    }
  }
  assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}`)
})

test("every artifact says where it came from — a generator that exists, or provenance in its own text", () => {
  const problems = []
  for (const t of resolveTruths()) {
    for (const a of t.artifacts) {
      if (a.generator === null && a.provenanceStated === null) {
        problems.push(`${a.path} declares neither a generator nor a provenance pattern`)
        continue
      }
      if (a.generator !== null && a.generatorExists === false) {
        problems.push(`${a.path} names ${a.generator}, which is not in the tree`)
      }
      if (a.provenanceStated === false) {
        problems.push(`${a.path} does not carry the provenance line it declares`)
      }
    }
  }
  assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}`)
})

test("no generator of a baseline inventory writes to what it inventories", () => {
  const problems = []
  for (const t of resolveTruths()) {
    for (const a of t.artifacts) {
      for (const p of a.readOnlyProblems) problems.push(`${a.generator} (for ${a.path}): ${p}`)
    }
  }
  assert.deepEqual(problems, [], `read-only is the claim; these are the writes:\n  ${problems.join("\n  ")}`)
})

test("the read-only detector fails on sources that do mutate", () => {
  // Without this the previous test proves only that the regexes never match.
  // One mutation per fixture, and each is a literal call a generator could
  // plausibly acquire.
  const cases = [
    ['await client.send(new PutObjectCommand({ Bucket: b }))', /PutObjectCommand/],
    ['await client.send(new DeleteBucketCommand({ Bucket: b }))', /DeleteBucketCommand/],
    ['await fetch(url, { method: "POST", body })', /HTTP POST/],
    ['execFileSync("git", ["add", "-A"])', /git add/],
    ['execFileSync("git", ["commit", "-m", "x"])', /git commit/],
  ]
  for (const [source, expected] of cases) {
    const found = readOnlySourceProblems(source)
    assert.ok(found.length > 0, `the detector saw nothing wrong with: ${source}`)
    assert.match(found.join(" | "), expected)
  }

  // And the reads it must NOT report, which is the half that gets a detector
  // switched off: every one of these appears in a generator in this repository.
  for (const source of [
    'await client.send(new ListBucketsCommand({}))',
    'await client.send(new DescribeStacksCommand({}))',
    'execFileSync("git", ["ls-files"])',
    'for (const t of ["push", "pull_request"]) {}',
    'await fetch(url, { headers: { accept: "application/json" } })',
  ]) {
    assert.deepEqual(readOnlySourceProblems(source), [], `false positive on: ${source}`)
  }
})

test("the detector reads code and not prose", () => {
  // `tools/platform-truth.mjs` has the words `git commit` in a comment
  // explaining when to regenerate. The first version of this reported it.
  const commented = ' * moment of `git commit` — so generating, verifying and committing in that\n'
  assert.deepEqual(withoutComments(`/*${commented}*/`).trim(), "")
  assert.deepEqual(readOnlySourceProblems(`/*${commented}*/`), [])

  // A URL keeps its line: stripping from `//` would hide anything after it.
  assert.match(withoutComments('fetch("https://api.github.com", { method: "DELETE" })'), /DELETE/)
  assert.equal(readOnlySourceProblems('fetch("https://api.github.com", { method: "DELETE" })').length, 1)
})
