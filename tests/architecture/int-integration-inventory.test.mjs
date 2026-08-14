import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * INT-000-001 / INT-000-002 — the inventory is a claim about the repository,
 * and this is what makes the claim falsifiable.
 *
 * Four distinct failures, and the third is the one that matters most:
 *
 *   1. **Stale.** The document describes a tree that no longer exists. Caught by
 *      re-running the generator and comparing bytes.
 *   2. **Fictional.** A row names a file nobody has. Caught by opening every
 *      path the document cites.
 *   3. **Empty.** The generator's extractor breaks, produces nothing, writes an
 *      empty document, and `--check` compares empty against empty and passes.
 *      This is the "guard that cannot fail" shape, and a staleness check ALONE
 *      has it — so every section carries a floor. The floors are pinned to the
 *      structures they read (five terraform queues, twenty-four connector
 *      packs), not to round numbers.
 *   4. **Leaky.** An inventory of credentials that prints a credential. Caught
 *      by refusing token-shaped literals in the rendered document.
 *
 * Run under `node --test` (`npm run test:platform`): no TypeScript, no jest
 * globals, bare node only.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const DOC = "docs/architecture/int-integration-inventory.md"
const TOOL = "tools/int-integration-inventory.mjs"

const doc = () => fs.readFileSync(path.join(ROOT, DOC), "utf8").replace(/\r\n/g, "\n")

/**
 * Every backticked repository path in the document.
 *
 * A directory separator is required. Without it the prose "every `route.ts` in
 * either application" is read as a path, reported missing, and the failure
 * points at the sentence rather than at anything wrong — a guard whose first
 * finding is its own false positive is a guard people learn to ignore.
 */
export function citedPaths(text) {
  const out = new Set()
  for (const m of text.matchAll(/`([\w.[\]@-]+(?:\/[\w.[\]@-]+)+\.(?:ts|tsx|mjs|tf|json|md|prisma|sql))(?::\d+)?`/g)) {
    out.add(m[1])
  }
  return [...out].sort()
}

test("the committed inventory matches what the generator produces now", () => {
  // A document generated from the tree is only worth reading if something
  // re-derives it. Deliberately the subprocess with `--check`, which does not
  // write: a test that regenerated the file would heal the staleness it exists
  // to report, and pass against a tree whose guards had just been deleted.
  execFileSync("node", [TOOL, "--check"], { cwd: ROOT, stdio: "pipe" })
})

test("every path the inventory cites is a file that exists", () => {
  const missing = citedPaths(doc()).filter((p) => !fs.existsSync(path.join(ROOT, p)))
  assert.deepEqual(
    missing,
    [],
    `The integration inventory names files that are not in the tree. A row nobody can open is ` +
      `prose. Regenerate with \`node ${TOOL}\`.`,
  )
})

test("the inventory cites enough of the tree to be an inventory", () => {
  const paths = citedPaths(doc())
  assert.ok(
    paths.length >= 50,
    `The inventory cites ${paths.length} paths, which is fewer than the ${50} an intact ` +
      `extraction produces. An extractor that returns nothing writes an empty document, and ` +
      `\`--check\` then compares empty against empty and passes.`,
  )
})

/**
 * Per-section floors.
 *
 * Each is tied to a structure a reader can count independently: `sqs.tf`
 * declares five queues, `provider-packs.ts` makes twenty-four `pack(` calls,
 * `cloudwatch.tf` declares four alarms. If one of those genuinely shrinks, the
 * floor and the tree change in the same commit — which is a visible edit rather
 * than a silent one.
 */
const FLOORS = [
  { label: "HTTP route handlers", min: 25 },
  { label: "internal event types", min: 2 },
  { label: "SQS queues declared", min: 5 },
  { label: "CloudWatch alarms", min: 4 },
  { label: "S3 buckets declared", min: 2 },
  { label: "credential references (names)", min: 20 },
  { label: "provider SDK dependencies", min: 40 },
  { label: "connector claims", min: 24 },
]

/** One row of the summary table, by its label. */
export function summaryCount(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const m = new RegExp(`^\\| ${escaped} \\| (\\d+) \\|$`, "m").exec(text)
  return m ? Number(m[1]) : null
}

test("no section of the inventory is silently empty", () => {
  const text = doc()
  const thin = []
  for (const { label, min } of FLOORS) {
    const n = summaryCount(text, label)
    if (n === null) thin.push(`${label}: no summary row — the section was renamed or removed`)
    else if (n < min) thin.push(`${label}: ${n}, floor ${min}`)
  }
  assert.deepEqual(
    thin,
    [],
    `A section of the integration inventory is thinner than the tree it reads:\n${thin.join("\n")}`,
  )
})

test("the summary counts agree with the tables they summarise", () => {
  // The summary is the part a reader believes without scrolling, so it is
  // derived here a second time — by counting the rows of the tables — rather
  // than trusted. A summary that disagrees with its own document is the number
  // that ends up in a status report.
  const text = doc()
  const section = (heading) => {
    const start = text.indexOf(`\n## ${heading}`)
    assert.ok(start !== -1, `The inventory has no "## ${heading}" section.`)
    const rest = text.slice(start + 1)
    const end = rest.indexOf("\n## ")
    return end === -1 ? rest : rest.slice(0, end)
  }
  const dataRows = (body) =>
    body.split("\n").filter((l) => l.startsWith("| ") && !/^\|[\s-|]+\|$/.test(l)).length - 1

  assert.equal(
    summaryCount(text, "connector claims"),
    dataRows(section("9. Connector claims")),
    "The connector count in the summary is not the number of connector rows.",
  )
  assert.equal(
    summaryCount(text, "CloudWatch alarms"),
    dataRows(section("5. Alarms over integration resources")),
    "The alarm count in the summary is not the number of alarm rows.",
  )
})

test("the producer/consumer map names the orphans rather than averaging them away", () => {
  // INT-000-002's actual subject. A map that lists resources and stops has
  // answered the easy half; the requirement is specifically about the resources
  // whose other end is missing, so the document must state a verdict per queue
  // and a findings line that counts them.
  const text = doc()
  assert.match(
    text,
    /\*\*\d+ of \d+ SQS queues are orphans\*\*/,
    "The findings must state how many queues have no producer, as a ratio.",
  )
  assert.match(
    text,
    /\*\*\d+ of \d+ alarms cannot fire\.\*\*/,
    "The findings must state how many alarms cannot fire, as a ratio.",
  )
  assert.match(
    text,
    /Actual traffic is not measured/,
    "INT-000-002 asks for producer/consumer AND actual traffic. The half that was not done has " +
      "to be recorded as not done — an inventory that omits its own gap reads as complete.",
  )

  const queueSection = text.slice(text.indexOf("\n## 3. Queues"), text.indexOf("\n## 4."))
  const verdicts = queueSection
    .split("\n")
    .filter((l) => /^\| \w+ \| `/.test(l))
    .map((l) => l.split("|").map((c) => c.trim()))
  assert.ok(verdicts.length >= 5, `Only ${verdicts.length} queue rows; sqs.tf declares five.`)
  for (const row of verdicts) {
    assert.ok(
      /orphan|producerless|has a producer/.test(row.join(" ")),
      `A queue row states no producer/consumer verdict: ${row.join(" | ")}`,
    )
  }
})

/**
 * ── The three cross-checks ───────────────────────────────────────────────────
 *
 * Everything above proves the document is derived, complete and not stale. None
 * of it proves the document is RIGHT: a generator whose extractor is subtly
 * wrong produces a document that matches itself perfectly, and `--check` blesses
 * it forever. That is not hypothetical here. The first version of the generator
 * matched a bare `sendMessage(` and found an unrelated server action of that
 * name, which flipped all five queues from "orphan" to "has a producer" and the
 * DLQ alarm from "cannot fire" to healthy — the inventory stated the exact
 * opposite of the truth, and every check above passed.
 *
 * So the three load-bearing numbers are re-derived HERE, from the tree, by code
 * that shares nothing with the generator, and compared against what the document
 * says. Two independent readings that agree is a mapping. One reading compared
 * against itself is a tautology.
 */

const listed = (glob) =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", glob], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)

test("the orphan-queue verdict is re-derived and agrees", () => {
  const text = doc()
  const queues = summaryCount(text, "SQS queues declared")
  const withProducer = summaryCount(text, "SQS queues with a producer in the tree")

  // Independently: does anything in the shipped application enqueue?
  const senders = []
  for (const glob of ["apps/**", "packages/**", "modules/**"]) {
    for (const file of listed(glob)) {
      if (!/\.(ts|tsx|mjs)$/.test(file)) continue
      if (/\.(test|itest|spec)\.(ts|tsx|mjs)$/.test(file)) continue
      const full = path.join(ROOT, file)
      if (!fs.existsSync(full)) continue
      if (/\bSendMessage(?:Batch)?Command\b/.test(fs.readFileSync(full, "utf8"))) senders.push(file)
    }
  }

  const m = /\*\*(\d+) of (\d+) SQS queues are orphans\*\*/.exec(text)
  assert.ok(m, "The findings do not state the orphan ratio.")
  const [, orphans, total] = m.map(Number)

  assert.equal(Number(total), queues, "The orphan ratio's denominator is not the queue count.")
  if (senders.length === 0) {
    assert.equal(
      withProducer,
      0,
      `Nothing in apps/, packages/ or modules/ constructs an SQS SendMessageCommand, yet the ` +
        `inventory reports ${withProducer} queues with a producer.`,
    )
    assert.equal(
      orphans,
      queues,
      `No producer exists anywhere in the tree, so every declared queue is an orphan. The ` +
        `inventory says ${orphans} of ${queues}.`,
    )
  } else {
    assert.ok(
      withProducer > 0,
      `${senders.join(", ")} constructs an SQS send, yet the inventory reports no queue with a ` +
        `producer.`,
    )
  }
})

test("the connector count is re-derived from the pack file and agrees", () => {
  const packs = fs
    .readFileSync(path.join(ROOT, "packages/provisioning/src/provider-packs.ts"), "utf8")
    .replace(/\r\n/g, "\n")
  const declared = (packs.match(/^ {2}pack\(\{$/gm) ?? []).length
  assert.ok(declared > 0, "No `pack({` calls found — the cross-check itself has stopped working.")
  assert.equal(
    summaryCount(doc(), "connector claims"),
    declared,
    `provider-packs.ts declares ${declared} connectors and the inventory lists ` +
      `${summaryCount(doc(), "connector claims")}. A parser that drops rows without erroring is ` +
      `the defect an inventory exists to prevent.`,
  )
})

test("the route count is re-derived from the tree and agrees", () => {
  const routes = [
    ...listed("apps/web/src/app/**"),
    ...listed("apps/system-studio/src/app/**"),
  ].filter((f) => /(^|\/)route\.ts$/.test(f) && fs.existsSync(path.join(ROOT, f)))
  assert.ok(routes.length > 0, "No route.ts files found — the cross-check has stopped working.")
  assert.equal(
    summaryCount(doc(), "HTTP route handlers"),
    routes.length,
    `The tree has ${routes.length} route handlers and the inventory lists ` +
      `${summaryCount(doc(), "HTTP route handlers")}.`,
  )
})

/**
 * A line that opens `ID — text` is how `tools/document-graph.mjs` recognises a
 * document STATING a requirement. This file trips that tool's authority markers
 * simply by discussing the Bible, so a header of the form
 *
 *     **INT-000-001** — inventory of current internal events, APIs, queues, jobs,
 *
 * made the generated ANSWER the owning authority for the requirement instead of
 * the Bible: `classify()` sorts with `localeCompare`, which puts
 * `docs/architecture/…` ahead of `Tenure_…`, and the first non-superseded
 * document to state an id keeps it. `next-batch.mjs` then printed a truncated
 * line of this document's own prose as the requirement's statement.
 *
 * `int-requirements-are-imported.test.mjs` catches it too, at the registry. This
 * one catches it at the file that causes it, which is where the fix goes.
 */
export function statedRequirementLines(text) {
  return text
    .split("\n")
    .filter((l) =>
      /^\s*(?:[-*]\s*\[[ xX]\]\s*|[-*]\s+)?\*{0,2}[A-Z]{2,8}-(?:\d{3}-\d{3}|GATE-\d+)\*{0,2}\s*[—–:-]\s*\S/.test(l),
    )
}

test("the generated answer does not restate the requirement it answers", () => {
  assert.deepEqual(
    statedRequirementLines(doc()),
    [],
    "A generated document that opens a line with `ID — text` is read by the document graph as " +
      "STATING that requirement, which takes ownership away from the Bible and makes the answer " +
      "its own authority. Cite the id inline instead.",
  )
})

test("the stated-requirement detector detects", () => {
  // Assembled here, so the detector is proven against the exact shape that
  // caused the defect rather than against a document that no longer has it.
  const sample = [
    "**INT-000-001** — inventory of current internal events, APIs, queues, jobs,",
    "- [ ] INT-000-002 — map producer and consumer",
    "This document answers `INT-000-001` (inventory) and `INT-000-002` (map).",
    "webhooks, files, credential references, provider SDKs and connector claims.",
  ].join("\n")
  assert.deepEqual(statedRequirementLines(sample), [
    "**INT-000-001** — inventory of current internal events, APIs, queues, jobs,",
    "- [ ] INT-000-002 — map producer and consumer",
  ])
})

test("the inventory of credentials contains no credential", () => {
  // The Bible's invariant: secrets are referenced by name and never appear "in
  // configuration, events, logs or evidence". A generated inventory IS evidence.
  const text = doc()
  const leaks = []
  const SHAPES = [
    { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { name: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
    { name: "Stripe key", re: /\b[sr]k_(?:test|live)_[A-Za-z0-9]{16,}\b/ },
    { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: "bearer literal", re: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
  ]
  for (const { name, re } of SHAPES) if (re.test(text)) leaks.push(name)
  assert.deepEqual(leaks, [], `The generated inventory contains a ${leaks.join(", ")}.`)
})

test("the leak detector detects", () => {
  // Every assertion above passes trivially against a detector that matches
  // nothing, which is how a credential sweep ships returning empty for every
  // file. Proven against literals assembled here so the fixtures are not
  // themselves findings, and so the file this guard reads stays clean.
  const fake = ["AKIA", "ABCDEFGHIJKLMNOP"].join("")
  assert.match(fake, /\bAKIA[0-9A-Z]{16}\b/)
  const fakeGh = ["ghp", "_", "abcdefghijklmnopqrstuvwxyz012345"].join("")
  assert.match(fakeGh, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/)
})

test("the path extractor extracts", () => {
  // Same reason. A `citedPaths` that returns [] makes "every path exists" pass
  // against a document of pure invention.
  const sample = "see `tools/int-integration-inventory.mjs` and `infrastructure/terraform/sqs.tf:15` and `nope`"
  assert.deepEqual(citedPaths(sample), [
    "infrastructure/terraform/sqs.tf",
    "tools/int-integration-inventory.mjs",
  ])
})

test("the summary parser reads a number and not a heading", () => {
  assert.equal(summaryCount("| SQS queues declared | 5 |", "SQS queues declared"), 5)
  assert.equal(summaryCount("| SQS queues declared | 5 |", "connector claims"), null)
})
