import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { releasedAreas } from "../../tools/ops-availability-and-limits.mjs"
import { ROOT, TERMS, byCodepoint } from "../../tools/ops-operations-inventory.mjs"

/**
 * OPS-GATE-050 — "“Best” is claimed only for measured released scope."
 *
 * Bible §26 puts the same rule as a prohibition: do not "claim best without
 * operational metrics". Both are about the sentence a reader ends up believing,
 * so the check has to be about sentences, and it has to be lexical: the failure
 * shape is a string literal or a line of a document, which type-checks, renders,
 * and is invisible to every unit test that builds its own fixture. That is the
 * same reason `certified-is-derived.test.mjs` is lexical and says so.
 *
 * ## What "permitted" means here, and why it is derived
 *
 * The permitted set is not a list in this file. It is `releasedAreas()` from
 * `tools/ops-availability-and-limits.mjs` — the Operations areas that are
 * `available` on both conditions of that document's §1 (the canonical model is
 * declared, and a surface is served). It is empty today, so every Operations
 * superlative is refused. It is empty because the tree is empty, not because zero
 * was written down: `ops-availability-and-limits.test.mjs` drives the same
 * decision procedure to an `available` result against synthetic input, and
 * `permittedFor()` below is driven both ways here. A guard whose allow-list can
 * never have a member is a guard that cannot be right for the right reason.
 *
 * A released area is still not enough on its own. §22 asks for baseline, target
 * and result, and OPS-050-004 records that none of them is instrumented — so the
 * second half of the rule is that a claim must cite a measurement. That branch is
 * unreachable from the tree today and is proven against synthetic input instead,
 * which is the honest way to ship half a rule: state which half the tree
 * exercises.
 *
 * ## What is scanned, and what is deliberately not
 *
 *   * String literals and JSX text under `apps/web/src` and
 *     `apps/system-studio/src` — text a person can end up reading. Comments are
 *     not scanned: a comment arguing that Tenure must not claim to be the best
 *     warehouse system is the opposite of the violation.
 *   * `docs/architecture/ops-*.md` — the Operations documents this domain
 *     publishes, which is where an overclaim would be most authoritative.
 *
 * NOT scanned, with the reason, because an unexplained exclusion is how a guard
 * quietly stops guarding:
 *
 *   * the Bible, which states the rule and therefore contains the word;
 *   * `docs/implementation/operations-cloud-execution-ledger.md`, which must be
 *     able to record "this claim was refused" and name what was refused. A ledger
 *     that cannot quote the thing it rejected cannot explain the rejection.
 *
 * The scan floors below exist because this whole file passes vacuously against a
 * walk that finds nothing, and a walk that finds nothing reports exactly the
 * conclusion the document draws.
 */

const CODE_ROOTS = ["apps/web/src", "apps/system-studio/src"]
const DOC_DIR = "docs/architecture"
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", ".turbo"])

/**
 * Superlative forms, lower-cased.
 *
 * Each is a claim of rank rather than a claim of fact: "fast" is measurable and
 * arguable, "fastest" is a ranking against everything else. `#1` and `number one`
 * are included because they are how a marketing string says `best` without the
 * word.
 */
export const SUPERLATIVES = [
  "#1",
  "best-in-class",
  "best in class",
  "best",
  "fastest",
  "industry-leading",
  "industry leading",
  "market-leading",
  "market leading",
  "most accurate",
  "most advanced",
  "most complete",
  "number one",
  "state-of-the-art",
  "state of the art",
  "superior",
  "unmatched",
  "unrivaled",
  "unrivalled",
  "world-class",
  "world class",
]

const SUPERLATIVE_RE = new RegExp(
  `(?<![a-z-])(${SUPERLATIVES.map((s) => s.replace(/[#]/g, "\\#").replace(/ /g, "\\s+")).join("|")})(?![a-z])`,
  "i",
)

const TERM_RE = new RegExp(`\\b(${TERMS.map((t) => t.replace(/ /g, "\\s+")).join("|")})\\b`, "i")

/**
 * Is this one unit of text an Operations superlative claim?
 *
 * Both halves required. "the best approach is to fail closed" is not an
 * Operations claim, and "the inventory transaction is idempotent" is not a
 * superlative — refusing either alone would produce a guard nobody could keep
 * green, and a guard nobody can keep green gets deleted.
 */
export function isOperationsSuperlative(unit) {
  const superlative = SUPERLATIVE_RE.exec(unit)
  if (!superlative) return null
  const term = TERM_RE.exec(unit)
  if (!term) return null
  return { superlative: superlative[1].toLowerCase(), term: term[1].toLowerCase() }
}

/** Files under a root, POSIX-relative to `base`, in codepoint order. */
function sourceFiles(roots, extensions, base = ROOT) {
  const out = []
  const walk = (rel) => {
    const abs = path.join(base, rel)
    if (!fs.existsSync(abs)) return
    for (const name of fs
      .readdirSync(abs, { withFileTypes: true })
      .map((e) => e.name)
      .sort(byCodepoint)) {
      const child = `${rel}/${name}`
      if (fs.statSync(path.join(base, child)).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(child)
      } else if (extensions.some((e) => name.endsWith(e))) {
        out.push(child)
      }
    }
  }
  for (const r of [...roots].sort(byCodepoint)) walk(r)
  return out
}

/**
 * Text a person could read, extracted from one source file.
 *
 * Comments first stripped, then string literals and JSX text nodes taken. This is
 * a lexical approximation and is meant to be: the alternative is a TypeScript
 * parse, and a guard nobody can run in a second is a guard that runs in nobody's
 * pre-push.
 */
export function readableText(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n")

  const units = []
  const push = (text, index) => {
    if (text.trim() !== "") units.push({ text, line: withoutComments.slice(0, index).split("\n").length })
  }
  for (const m of withoutComments.matchAll(/"([^"\n]{4,})"|'([^'\n]{4,})'|`([^`]{4,})`/g)) {
    push(m[1] ?? m[2] ?? m[3], m.index)
  }
  for (const m of withoutComments.matchAll(/>\s*([^<>{}\n]{4,}?)\s*</g)) {
    push(m[1], m.index)
  }
  return units
}

/**
 * Every Operations superlative claim in the scanned surface, with where it is.
 *
 * `base` is a parameter so the whole path — walk, comment strip, literal extract,
 * both-halves test, location report — can be driven end to end against a planted
 * file in `os.tmpdir()`. Without it the only proof that this function CAN find
 * something would be its parts, and a scan correctly assembled out of correct
 * parts is still the thing that has silently found nothing in this repository
 * before. Writing into a temp directory rather than the tree is required by
 * `guards-do-not-write-into-the-tree.test.mjs`, for a good reason: the suite runs
 * in parallel and a file that exists for 200ms is a file every other guard sees.
 */
export function claims(base = ROOT, codeRoots = CODE_ROOTS, docDir = DOC_DIR) {
  const found = []
  let codeUnits = 0
  const readAt = (file) => fs.readFileSync(path.join(base, file), "utf8").replace(/\r\n/g, "\n")
  const codeFiles = sourceFiles(codeRoots, [".ts", ".tsx"], base)
  for (const file of codeFiles) {
    for (const unit of readableText(readAt(file))) {
      codeUnits += 1
      const hit = isOperationsSuperlative(unit.text)
      if (hit) found.push({ file, line: unit.line, ...hit, text: unit.text.trim().slice(0, 120) })
    }
  }
  let docLines = 0
  const docs = fs
    .readdirSync(path.join(base, docDir))
    .filter((n) => n.startsWith("ops-") && n.endsWith(".md"))
    .sort(byCodepoint)
    .map((n) => `${docDir}/${n}`)
  for (const file of docs) {
    readAt(file)
      .split("\n")
      .forEach((line, i) => {
        docLines += 1
        const hit = isOperationsSuperlative(line)
        if (hit) found.push({ file, line: i + 1, ...hit, text: line.trim().slice(0, 120) })
      })
  }
  return { found, codeFiles, codeUnits, docs, docLines }
}

/**
 * May this claim stand?
 *
 * A claim is permitted only when the area it is about is released AND a
 * measurement exists for it. Both arguments are sets rather than reads so both
 * answers are reachable — the tree supplies an empty released set today, and a
 * rule whose permitting branch nothing can take is not a rule.
 */
export function permittedFor(area, released, measured) {
  if (!released.includes(area)) return { permitted: false, because: "not-released" }
  if (!measured.includes(area)) return { permitted: false, because: "not-measured" }
  return { permitted: true, because: null }
}

test("the scan reaches the surface a claim would live on", () => {
  const { codeFiles, codeUnits, docs, docLines } = claims()
  assert.ok(codeFiles.length >= 300, `Only ${codeFiles.length} source files were scanned, expected 300+.`)
  assert.ok(docs.length >= 2, `Only ${docs.length} Operations documents were scanned, expected 2+.`)
  // Files walked is not text read. A reader that returned [] for every file
  // would clear the two floors above and find nothing, which is exactly the
  // conclusion this file draws — so the units are counted too.
  assert.ok(codeUnits >= 20000, `Only ${codeUnits} readable text units were extracted, expected 20000+.`)
  assert.ok(docLines >= 300, `Only ${docLines} Operations document lines were read, expected 300+.`)
  assert.ok(
    codeFiles.includes("apps/web/src/lib/relay-tools.ts"),
    "The scan no longer reaches apps/web/src/lib/relay-tools.ts.",
  )
})

test("released Operations scope is empty, so no superlative is permitted", () => {
  const released = releasedAreas()
  assert.deepEqual(
    released,
    [],
    `Operations areas are now released (${released.join(", ")}). A superlative about one of them is ` +
      `permitted only once §22's baseline, target and result exist for it — instrument them and ` +
      `widen this test in the same commit.`,
  )
})

test("nothing claims an Operations superlative", () => {
  const released = releasedAreas()
  const measured = [] // OPS-050-004: no §22 metric is instrumented.
  const { found } = claims()

  const offenders = found
    .filter((c) => !permittedFor(c.term, released, measured).permitted)
    .map((c) => `${c.file}:${c.line} — "${c.superlative}" beside "${c.term}": ${c.text}`)

  assert.deepEqual(
    offenders,
    [],
    `An Operations superlative is claimed for scope that is neither released nor measured:\n  ` +
      `${offenders.join("\n  ")}\n` +
      `Bible §26 forbids claiming best without operational metrics. Either measure it or do not ` +
      `say it.`,
  )
})

test("the permission rule has both halves, and both are reachable", () => {
  // Neither branch is takeable from the tree today, so both are driven here. A
  // rule that only ever refuses is indistinguishable from a rule that always
  // refuses, and the difference is the whole point of a gate.
  assert.deepEqual(permittedFor("inventory", [], []), { permitted: false, because: "not-released" })
  assert.deepEqual(permittedFor("inventory", ["inventory"], []), {
    permitted: false,
    because: "not-measured",
  })
  assert.deepEqual(permittedFor("inventory", ["inventory"], ["inventory"]), {
    permitted: true,
    because: null,
  })
})

test("the detector needs both halves and finds them in real shapes", () => {
  // Synthetic, so the detector is proven against text it has never seen — and
  // against the two near-misses that would make it either useless or unkeepable.
  assert.deepEqual(isOperationsSuperlative("Tenure has the best warehouse in the world"), {
    superlative: "best",
    term: "warehouse",
  })
  assert.deepEqual(isOperationsSuperlative("World-class inventory accuracy"), {
    superlative: "world-class",
    term: "inventory",
  })
  assert.equal(isOperationsSuperlative("the best approach is to fail closed"), null)
  assert.equal(isOperationsSuperlative("the inventory transaction is idempotent"), null)
  // Not a superlative because it is a longer word: `bestow`, `superiority`.
  assert.equal(isOperationsSuperlative("bestow the inventory on somebody"), null)
})

test("the whole scan finds a planted claim, in code and in a document", () => {
  // End to end, against a filesystem this test builds. `nothing claims an
  // Operations superlative` above is the assertion that matters, and it passes
  // whether the scan works or reads nothing at all; this is what tells those two
  // apart. In os.tmpdir(), never in the tree.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-best-claim-"))
  try {
    fs.mkdirSync(path.join(dir, "src/ui"), { recursive: true })
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "src/ui/Banner.tsx"),
      [
        "// a comment saying we have the best warehouse must not be flagged",
        'export const copy = "the fastest warehouse picking in education"',
        "export const Node = () => <p>Best inventory accuracy anywhere</p>",
      ].join("\n"),
      "utf8",
    )
    fs.writeFileSync(
      path.join(dir, "docs/ops-marketing.md"),
      "Tenure runs world-class fulfillment operations.\nA line with no claim in it.\n",
      "utf8",
    )

    const { found, codeFiles, docs } = claims(dir, ["src"], "docs")
    assert.deepEqual(codeFiles, ["src/ui/Banner.tsx"])
    assert.deepEqual(docs, ["docs/ops-marketing.md"])
    assert.deepEqual(
      found.map((f) => `${f.file} — ${f.superlative}/${f.term}`).sort(byCodepoint),
      [
        "docs/ops-marketing.md — world-class/fulfillment",
        "src/ui/Banner.tsx — best/inventory",
        "src/ui/Banner.tsx — fastest/warehouse",
      ],
      "The scan did not find every planted claim, or found the comment.",
    )
    assert.deepEqual(
      found.filter((f) => f.text.includes("must not be flagged")),
      [],
      "The scan flagged a comment.",
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("the readable-text reader takes strings and JSX and leaves comments alone", () => {
  const source = [
    "// the best warehouse claim would go here and must not be flagged",
    "/* nor the best inventory claim in a block comment */",
    'const copy = "the best warehouse software"',
    "export const Node = () => <p>World-class inventory accuracy</p>",
  ].join("\n")

  const units = readableText(source).map((u) => u.text)
  assert.ok(
    units.includes("the best warehouse software"),
    `The string literal was not extracted, got: ${JSON.stringify(units)}`,
  )
  assert.ok(
    units.includes("World-class inventory accuracy"),
    `The JSX text was not extracted, got: ${JSON.stringify(units)}`,
  )
  assert.deepEqual(
    units.filter((u) => u.includes("must not be flagged") || u.includes("block comment")),
    [],
    "A comment was extracted as readable text.",
  )
})
