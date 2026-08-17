import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"
import {
  REQUIRED_CATEGORIES,
  TIERS,
  UNMET_OBLIGATIONS,
  resolveReadOrder,
} from "../../tools/ext-read-order.mjs"

/**
 * EXT-000-001 — the read-order contract is held to the document it comes from
 * and to the tree it describes.
 *
 * The requirement: *"Canonical Bible, this extension, prompt, ADRs, repository
 * rules, contracts, and applicable specialist source documents are located,
 * versioned, and included in the read-order contract."*
 *
 * Three verbs, each checked separately below, because they fail differently.
 * *Located* fails as a path that does not exist. *Versioned* fails as an
 * artifact nobody can cite a version of. *Included* fails as an authority
 * sitting outside the reading order — which is the failure `ADR-0008` records
 * costing 726 requirements, and the one nothing would report on its own.
 *
 * The tier text is compared to §0 of the extension byte for byte. That coupling
 * is deliberate: rewording the authority must red this file rather than leave a
 * contract quoting a sentence that no longer exists.
 */

const EXTENSION = "docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md"
const REGISTRY = "docs/architecture/capability-completeness-registry.yaml"

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")

/** §0's numbered reading order, as the extension writes it. */
function statedReadOrder() {
  const lines = read(EXTENSION).split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith("## 0. "))
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## 1. "))
  assert.ok(start >= 0 && end > start, "§0 of the extension could not be found")
  return lines.slice(start, end).filter((l) => /^\d+\. /.test(l))
}

test("the tiers are the extension's own numbered reading order, in order", () => {
  const stated = statedReadOrder()
  assert.equal(
    TIERS.length,
    stated.length,
    `the extension states ${stated.length} tiers and the contract declares ${TIERS.length}`,
  )
  assert.deepEqual(
    TIERS.map((t) => t.sourceText),
    stated,
    "a tier's text is not the extension's. Copy the line, do not paraphrase it.",
  )
  assert.deepEqual(
    TIERS.map((t) => t.tier),
    stated.map((_, i) => i + 1),
    "the tiers are not numbered 1..n in order — a reading ORDER whose order is not asserted is a list",
  )
})

test("every artifact the contract locates exists", () => {
  const missing = []
  for (const tier of resolveReadOrder().tiers) {
    for (const o of tier.obligations) {
      for (const a of o.artifacts) {
        if (!fs.existsSync(path.join(ROOT, a.path))) missing.push(`tier ${tier.tier}: ${a.path}`)
      }
    }
  }
  assert.deepEqual(missing, [], `the contract names files that are not here:\n  ${missing.join("\n  ")}`)
})

test("every located artifact carries a version somebody could cite", () => {
  // Either a version the artifact states, or the digest of the bytes that were
  // read. Deliberately not "a non-empty string": `unversioned` is a non-empty
  // string, and four ADRs carry exactly that word in the document graph.
  const STATED = /^\d+(\.\d+)+$/
  const DIGEST = /^sha256:[0-9a-f]{12}$/
  const bad = []
  for (const tier of resolveReadOrder().tiers) {
    for (const o of tier.obligations) {
      for (const a of o.artifacts) {
        if (!STATED.test(a.version) && !DIGEST.test(a.version)) {
          bad.push(`${a.path} — version "${a.version}" (${a.from})`)
        }
      }
    }
  }
  assert.deepEqual(bad, [], `unversioned artifacts:\n  ${bad.join("\n  ")}`)
})

test("all seven categories the requirement names are located, and they are the requirement's words", () => {
  // The category list is bound to the requirement's own sentence rather than to
  // a reading of it: every category token has to appear in the statement the
  // registry carries. A category invented here would pass a check that only
  // looked at this file.
  const statement = read(REGISTRY)
    .split(/\r?\n/)
    .find((l) => l.includes("Canonical Bible, this extension, prompt, ADRs"))
  assert.ok(statement, `EXT-000-001's statement was not found in ${REGISTRY}`)

  const WORDS = {
    "canonical-bible": "Canonical Bible",
    "this-extension": "this extension",
    prompt: "prompt",
    adrs: "ADRs",
    "repository-rules": "repository rules",
    contracts: "contracts",
    "specialist-source-documents": "specialist source documents",
  }
  for (const category of REQUIRED_CATEGORIES) {
    assert.ok(
      statement.includes(WORDS[category]),
      `category ${category} is not named in EXT-000-001's statement`,
    )
  }

  const located = resolveReadOrder().categories
  const absent = REQUIRED_CATEGORIES.filter((c) => !located.has(c))
  assert.deepEqual(
    absent,
    [],
    `these categories are in the requirement and nothing in the contract locates them: ${absent.join(", ")}`,
  )
})

test("an obligation that resolves to nothing says why, and one that resolves does not", () => {
  const silent = []
  const stale = []
  for (const tier of resolveReadOrder().tiers) {
    for (const o of tier.obligations) {
      if (o.artifacts.length === 0) {
        // 80 characters is not a style rule. "Not applicable" fits in a reason
        // field and says nothing; a sentence that has to name what is absent and
        // what stands in for it does not fit in fewer.
        if ((o.unmet ?? "").length < 80) silent.push(`tier ${tier.tier}: ${o.obligation}`)
      } else if (o.unmet !== null) {
        stale.push(`tier ${tier.tier}: ${o.obligation} — ${o.artifacts.length} artifact(s)`)
      }
    }
  }
  assert.deepEqual(silent, [], `unmet with no reason:\n  ${silent.join("\n  ")}`)
  assert.deepEqual(
    stale,
    [],
    `these obligations are satisfied and still carry an "unmet" reason — delete the reason:\n  ${stale.join("\n  ")}`,
  )
})

test("the unmet-obligation count may only shrink", () => {
  const unmet = resolveReadOrder().unmet
  const named = unmet.map((o) => `tier ${o.tier}: ${o.obligation}`)
  assert.equal(
    unmet.length,
    UNMET_OBLIGATIONS,
    unmet.length > UNMET_OBLIGATIONS
      ? `${unmet.length} obligations are unmet and the contract admits ${UNMET_OBLIGATIONS}. Satisfy it or ` +
          `record it — raising the number to make this pass is the failure the number exists to prevent:\n  ` +
          named.join("\n  ")
      : `only ${unmet.length} obligations are unmet and the contract still admits ${UNMET_OBLIGATIONS}. ` +
          `Lower UNMET_OBLIGATIONS — a ratchet that is not tightened stops measuring anything.`,
  )
})

test("every authority in the document graph is placed in exactly one tier", () => {
  const { unplacedAuthorities, duplicated } = resolveReadOrder()
  assert.deepEqual(
    unplacedAuthorities,
    [],
    `these authorities state requirements and no tier of the reading order reaches them. That is the\n` +
      `ADR-0008 defect: an authority nobody is told to read is invisible, and invisible reads as done.\n  ` +
      unplacedAuthorities.join("\n  "),
  )
  assert.deepEqual(
    duplicated,
    [],
    `read at two tiers, so its position in the order is ambiguous:\n  ${duplicated.join("\n  ")}`,
  )
})

test("a superseded document is listed as history and never as current", () => {
  const wrong = []
  for (const tier of resolveReadOrder().tiers) {
    for (const o of tier.obligations) {
      for (const a of o.artifacts) {
        if (o.history && a.supersededBy === null) {
          wrong.push(`${a.path} is listed as history and nothing supersedes it`)
        }
        if (!o.history && a.supersededBy !== null) {
          wrong.push(`${a.path} is listed as current and is superseded by ${a.supersededBy}`)
        }
      }
    }
  }
  assert.deepEqual(wrong, [], `supersession and position disagree:\n  ${wrong.join("\n  ")}`)
})
