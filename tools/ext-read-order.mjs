#!/usr/bin/env node
/**
 * EXT-000-001 — the read-order contract, as data something can check.
 *
 * The extension's §0 states a required reading order in five numbered tiers,
 * and EXT-000-001 asks that the canonical Bible, this extension, the prompt,
 * the ADRs, the repository rules, the contracts and the applicable specialist
 * source documents be *located, versioned, and included* in it.
 *
 * A reading order written as five sentences in a document is the definition.
 * This is the enforcement, and without it the definition is a snapshot of the
 * afternoon somebody wrote it: `ADR-0008` records exactly this failure at the
 * scale of a whole programme — twenty-three authorities uploaded, twelve
 * domains reachable by nothing, and "nothing was red".
 *
 * ── Why the tiers are DERIVED and not typed ────────────────────────────────
 *
 * Every obligation resolves through a `locate()` that reads the filesystem or
 * the document graph. A list of paths typed here would be a second declaration
 * of which documents exist, and the two would disagree the first time somebody
 * adds an ADR — at which point the contract reports itself complete because its
 * own list is short. `apps/system-studio/src/app/platform/estate/declared-estate.ts`
 * made the same choice for the Terraform estate and says why at length.
 *
 * The strongest property here is the last one the guard checks: EVERY authority
 * the document graph knows about has a place in exactly one tier. That is the
 * `ADR-0008` failure mode held shut — a Bible dropped into the repository
 * cannot be outside the reading order without reddening a test.
 *
 * ── Why this writes no document ────────────────────────────────────────────
 *
 * A rendered Markdown copy would list the Bible paths, `tools/document-graph.mjs`
 * classifies any `.md` whose first 4,000 characters carry `\bBible\b` as an
 * authority, and the graph would then contain a generated file that exists to
 * describe the graph. The contract is data in one module and its reader is
 * `tests/architecture/ext-read-order-contract.test.mjs`.
 *
 *   node tools/ext-read-order.mjs          # print the resolved contract
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { ROOT, classify } from "./document-graph.mjs"

const abs = (p) => path.join(ROOT, p)
const exists = (p) => fs.existsSync(abs(p))

/** The ones of a candidate list that are actually here. Absence is an answer. */
const present = (candidates) => candidates.filter(exists)

/** Files directly under `dir` matching `re`, repository-relative and sorted. */
function filesIn(dir, re) {
  if (!fs.existsSync(abs(dir))) return []
  return fs
    .readdirSync(abs(dir), { withFileTypes: true })
    .filter((e) => e.isFile() && re.test(e.name))
    .map((e) => `${dir}/${e.name}`)
    .sort()
}

/**
 * The document graph, keyed by canonical path, computed live.
 *
 * Live rather than from the committed YAML: a contract that reads a generated
 * file inherits that file's staleness, and the one fact this needs from the
 * graph — a document's version — is the fact a stale copy gets wrong.
 */
let graphCache = null
export function graphByPath() {
  if (graphCache) return graphCache
  graphCache = new Map(classify().map((d) => [d.canonical_path, d]))
  return graphCache
}

/** Authorities in the graph, canonical paths only. */
export const authorityPaths = () =>
  [...graphByPath().values()].filter((d) => d.role === "authority").map((d) => d.canonical_path)

const BIBLE_FAMILY = "Tenure_Global_System_Architecture_Bible"
const EXTENSION = "docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md"

/** Every physical copy of the canonical Architecture Bible, highest version first. */
function bibleCopies() {
  return [...graphByPath().values()]
    .filter((d) => d.family === BIBLE_FAMILY)
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
    .map((d) => d.canonical_path)
}

const PROMPT_FAMILY = /Master_Prompt|Execution_Prompt/

/**
 * The unified execution prompt, current version only.
 *
 * Current means "nothing supersedes it", and the graph is what says so —
 * `ADR-0008` §3 settled the Unified-vs-standalone line and recorded it as an
 * explicit map in `document-graph.mjs` rather than as a version comparison here.
 * Sorting by version number would be a second, weaker answer to a question that
 * already has an authoritative one, and it would silently disagree the moment a
 * supersession crosses families again.
 */
const currentPrompts = () =>
  [...graphByPath().values()]
    .filter((d) => PROMPT_FAMILY.test(d.canonical_path) && !d.superseded_by)
    .map((d) => d.canonical_path)
    .sort()

/** Superseded prompts, which a reader may need for history and must not read as current. */
const supersededPrompts = () =>
  [...graphByPath().values()]
    .filter((d) => PROMPT_FAMILY.test(d.canonical_path) && d.superseded_by)
    .map((d) => d.canonical_path)
    .sort()

/**
 * The specialist domain authorities: every authority that is not the Bible, not
 * this extension, and not a prompt.
 *
 * A judgement, named rather than patterned: §0 tier 4 lists the commercial and
 * jurisdictional inputs and does not name the domain Bibles, but the
 * requirement's own sentence does ("applicable specialist source documents") and
 * they are accepted architecture material rather than repository rules. So they
 * are read at tier 4, alongside the ADRs, and this comment is the record of who
 * decided that.
 */
function specialistAuthorities() {
  const taken = new Set([EXTENSION, ...bibleCopies(), ...currentPrompts(), ...supersededPrompts()])
  return authorityPaths()
    .filter((p) => !taken.has(p) && !graphByPath().get(p).superseded_by)
    .sort()
}

/**
 * Specialist authorities another physical copy supersedes.
 *
 * Two of them: the Simon absorption Bible and the Studio control-plane Bible
 * each exist twice — once at the repository root and once under
 * `docs/implementation/` — and the two copies are NOT byte-identical, so the
 * graph registers both and records which wins. A reading order that listed them
 * beside the current copies would send a reader to whichever they opened first,
 * which is the whole of what "conflicting sources of truth" means.
 */
const supersededSpecialists = () => {
  const taken = new Set([EXTENSION, ...bibleCopies(), ...currentPrompts(), ...supersededPrompts()])
  return authorityPaths()
    .filter((p) => !taken.has(p) && graphByPath().get(p).superseded_by)
    .sort()
}

/**
 * The five tiers, in the extension's own order.
 *
 * `sourceText` is the document's line, byte for byte. The guard compares it to
 * §0 of the extension, so rewording the authority reds this file rather than
 * leaving a contract that quotes a sentence nobody wrote any more.
 */
export const TIERS = [
  {
    tier: 1,
    sourceText:
      "1. Repository `CLAUDE.md`, `AGENTS.md`, security policy, contribution rules, and protected-workflow instructions.",
    obligations: [
      {
        obligation: "repository instructions",
        category: "repository-rules",
        locate: () => present(["CLAUDE.md"]),
      },
      {
        obligation: "agent instructions (`AGENTS.md`)",
        category: "repository-rules",
        locate: () => present(["AGENTS.md"]),
        unmet:
          "No AGENTS.md exists. CLAUDE.md is this repository's agent instruction file and carries " +
          "the two non-negotiable rules; adding a second one would create two answers to 'what may " +
          "an agent do here', which is the defect docs/migrations/DUPLICATE-SOURCES.md exists over.",
      },
      {
        obligation: "security policy",
        category: "repository-rules",
        locate: () => present(["SECURITY.md", "docs/SECURITY.md", ".github/SECURITY.md"]),
        unmet:
          "No security policy document exists. Security is enforced here rather than stated — " +
          "tests/security/ holds 38 guards — but an enforced property is not a disclosure policy, " +
          "and a reader looking for how to report a vulnerability finds nothing.",
      },
      {
        obligation: "contribution rules",
        category: "repository-rules",
        locate: () => present(["CONTRIBUTING.md", "docs/CONTRIBUTING.md", ".github/CONTRIBUTING.md"]),
        unmet:
          "No CONTRIBUTING.md exists. CLAUDE.md states the verification commands and the pushing " +
          "rule, which is the part that gates a change; what is missing is the review and branch " +
          "protocol a human contributor would need.",
      },
      {
        obligation: "protected-workflow instructions",
        category: "repository-rules",
        locate: () =>
          present([
            "CLAUDE.md",
            "tools/disarm-production-workflows.mjs",
            "tests/security/production-workflows-disarmed.test.mjs",
          ]),
      },
      {
        obligation: "the engine constitution",
        category: "repository-rules",
        locate: () =>
          [...graphByPath().values()]
            .filter((d) => /Constitution/.test(d.canonical_path))
            .map((d) => d.canonical_path)
            .sort(),
      },
    ],
  },
  {
    tier: 2,
    sourceText:
      "2. `docs/architecture/tenure-global-system-architecture-bible.md` or the repository's canonical copy of the Tenure Global System Architecture Bible v1.1 or later.",
    obligations: [
      {
        obligation: "the canonical Architecture Bible, v1.1 or later",
        category: "canonical-bible",
        locate: bibleCopies,
      },
    ],
  },
  {
    tier: 3,
    sourceText: "3. This extension.",
    obligations: [
      {
        obligation: "this extension",
        category: "this-extension",
        locate: () => present([EXTENSION]),
      },
    ],
  },
  {
    tier: 4,
    sourceText:
      "4. Accepted architecture decision records, tenant contracts, data-processing terms, jurisdiction opinions, bank implementation guides, certified-provider contracts, and implementation statements of work.",
    obligations: [
      {
        obligation: "accepted architecture decision records",
        category: "adrs",
        locate: () => filesIn("docs/decisions", /^(ADR-|pay-adr-).*\.md$/i),
      },
      {
        obligation: "product and platform decisions of record",
        category: "adrs",
        locate: () => present(["docs/decisions/PRODUCT-DECISIONS.md"]),
      },
      {
        obligation: "machine-readable interface contracts",
        category: "contracts",
        locate: () => filesIn("docs/contracts", /\.json$/),
      },
      {
        obligation: "applicable specialist source documents",
        category: "specialist-source-documents",
        locate: specialistAuthorities,
      },
      {
        obligation: "specialist source documents a second copy supersedes",
        category: "specialist-source-documents",
        history: true,
        locate: supersededSpecialists,
      },
      {
        obligation: "tenant contracts, data-processing terms and statements of work",
        category: "commercial-instruments",
        locate: () => filesIn("docs/contracts", /\.(md|pdf)$/i),
        unmet:
          "No executed tenant contract, data-processing agreement or statement of work is in " +
          "version control. These are signed commercial instruments held outside the repository; " +
          "what is absent is a pointer to where the authoritative copy lives, not the copy itself.",
      },
      {
        obligation: "jurisdiction opinions, bank implementation guides and certified-provider contracts",
        category: "commercial-instruments",
        locate: () => filesIn("docs/jurisdictions", /\.md$/).concat(filesIn("docs/banking", /\.md$/)),
        unmet:
          "None exist. EXT-040 and EXT-080 are the requirements that create them, and both are " +
          "FAIL; §23's reference links are published sources, which the extension itself says are " +
          "not proof their content is unchanged.",
      },
    ],
  },
  {
    tier: 5,
    sourceText: "5. The unified Claude Code execution prompt and current execution ledger.",
    obligations: [
      {
        obligation: "the unified execution prompt, current version",
        category: "prompt",
        locate: currentPrompts,
      },
      {
        obligation: "superseded prompts, read as history and never as current",
        category: "prompt",
        history: true,
        locate: supersededPrompts,
      },
      {
        obligation: "current execution ledgers",
        category: "prompt",
        locate: () => filesIn("docs/implementation", /-ledger\.md$/),
      },
    ],
  },
]

/**
 * Obligations §0 names that this repository cannot satisfy today.
 *
 * MAY ONLY SHRINK. A number that can be raised to make a build pass is the
 * failure the number exists to prevent, and the guard asserts both directions.
 */
export const UNMET_OBLIGATIONS = 5

/** The seven categories EXT-000-001's own sentence names. */
export const REQUIRED_CATEGORIES = [
  "canonical-bible",
  "this-extension",
  "prompt",
  "adrs",
  "repository-rules",
  "contracts",
  "specialist-source-documents",
]

const digest = (p) =>
  crypto
    .createHash("sha256")
    .update(Buffer.from(fs.readFileSync(abs(p)).toString("utf8").split("\r\n").join("\n"), "utf8"))
    .digest("hex")

/**
 * A path in the contract that is not on disk is a finding for the guard that
 * looks for exactly that, and nothing else here should turn it into a thrown
 * exception first — an exception makes seven tests fail with a stack instead of
 * one test failing with the file name.
 */
const MISSING = { version: "MISSING", from: "the file is not in the tree", role: "missing" }

/**
 * What version of an artifact a reader would be reading.
 *
 * Three sources, in order of how much they prove. A document the graph knows
 * carries a stated version. A JSON contract states its own. Anything else is
 * identified by the digest of the bytes — which is a version: it says exactly
 * which content the contract located, and it changes when the content does.
 * Returning "unversioned" for the third case would have made the requirement's
 * word "versioned" unfalsifiable for every file that is not a Bible.
 */
export function versionOf(relPath) {
  if (!exists(relPath)) return { ...MISSING }
  const known = graphByPath().get(relPath)
  // `unversioned` is what the graph says about a document that states no version
  // of its own — four ADRs, which are dated and accepted rather than versioned.
  // Passing that word through as the version would make "versioned" a word the
  // contract satisfies by repeating it, so those fall through to the digest.
  if (known && known.version !== "unversioned") {
    return { version: known.version, from: "document graph", role: known.role }
  }
  if (relPath.endsWith(".json")) {
    try {
      const j = JSON.parse(fs.readFileSync(abs(relPath), "utf8"))
      const stated = j["x-contract-version"] ?? j.info?.version
      if (stated) return { version: String(stated), from: "stated in the artifact", role: "contract" }
    } catch {
      // A contract that does not parse is a finding, not a version. Fall through
      // to the digest so the guard reports the file rather than throwing here.
    }
  }
  return { version: `sha256:${digest(relPath).slice(0, 12)}`, from: "content digest", role: "file" }
}

/**
 * The contract, resolved against the tree as it is now.
 *
 * Returns everything a guard needs to disagree with it: the tiers with their
 * located artifacts and versions, the obligations that resolved to nothing, and
 * the authorities the graph knows that no tier placed.
 */
export function resolveReadOrder() {
  const tiers = TIERS.map((t) => ({
    tier: t.tier,
    sourceText: t.sourceText,
    obligations: t.obligations.map((o) => {
      const paths = o.locate()
      return {
        obligation: o.obligation,
        category: o.category,
        unmet: o.unmet ?? null,
        history: o.history === true,
        artifacts: paths.map((p) => ({
          path: p,
          supersededBy: graphByPath().get(p)?.superseded_by ?? null,
          ...versionOf(p),
        })),
      }
    }),
  }))

  const all = tiers.flatMap((t) => t.obligations.flatMap((o) => o.artifacts.map((a) => a.path)))
  // Counted by TIER, not by obligation. One file satisfying two obligations of
  // the same tier is normal — `CLAUDE.md` is both the repository instructions
  // and, in §2, the protected-workflow instructions — and it says nothing about
  // where in the order it is read. The same file at two tiers does: a reader
  // following the order would meet it twice, at two different priorities.
  const tiersOf = new Map()
  for (const t of tiers) {
    for (const o of t.obligations) {
      for (const a of o.artifacts) {
        if (!tiersOf.has(a.path)) tiersOf.set(a.path, new Set())
        tiersOf.get(a.path).add(t.tier)
      }
    }
  }

  const placed = new Set(all)
  const unplacedAuthorities = authorityPaths().filter((p) => !placed.has(p))

  return {
    tiers,
    unmet: tiers.flatMap((t) =>
      t.obligations.filter((o) => o.artifacts.length === 0).map((o) => ({ tier: t.tier, ...o })),
    ),
    /** An artifact read at two tiers has an ambiguous position in the order. */
    duplicated: [...tiersOf]
      .filter(([, ts]) => ts.size > 1)
      .map(([p, ts]) => `${p} (tiers ${[...ts].sort().join(", ")})`),
    unplacedAuthorities,
    categories: new Set(
      tiers.flatMap((t) => t.obligations.filter((o) => o.artifacts.length > 0).map((o) => o.category)),
    ),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const r = resolveReadOrder()
  for (const t of r.tiers) {
    console.log(`\nTier ${t.tier}: ${t.sourceText}`)
    for (const o of t.obligations) {
      if (o.artifacts.length === 0) {
        console.log(`  ✗ ${o.obligation} — UNMET: ${o.unmet ?? "(no reason recorded)"}`)
        continue
      }
      console.log(`  · ${o.obligation} [${o.category}]`)
      for (const a of o.artifacts) console.log(`      ${a.version.padEnd(22)} ${a.path}`)
    }
  }
  console.log(
    `\n${r.tiers.reduce((n, t) => n + t.obligations.reduce((m, o) => m + o.artifacts.length, 0), 0)} artifacts, ` +
      `${r.unmet.length} unmet obligations, ${r.unplacedAuthorities.length} authorities outside the order.`,
  )
}
