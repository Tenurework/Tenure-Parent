#!/usr/bin/env node
/**
 * EXT-000-002 — the seven baseline truths, bound to the artifacts that hold
 * them and to the proof that inventorying them changed nothing.
 *
 * The requirement: *"Current repository, AWS, environment, tenant, data,
 * integration, and release truth is inventoried read-only without exposing
 * secrets."* Three claims, and each fails in its own way:
 *
 *   - *inventoried* fails as a truth nobody wrote down. The binding below is
 *     what makes that checkable: a truth with no artifact is a named hole
 *     rather than a silence.
 *   - *read-only* fails as a generator that describes an estate by changing it.
 *     Every artifact names the program that produces it, and `readOnlyProblems`
 *     reads that program's source for a mutating call.
 *   - *without exposing secrets* fails as a credential value pasted into a
 *     committed document. That half is checked by
 *     `apps/web/src/lib/platform/inventories-carry-no-credential.test.ts`,
 *     which runs under Jest so it can import the platform's own
 *     `secretKindOf` rather than restating its patterns here. Two credential
 *     scanners in one repository would disagree eventually, and the one that
 *     disagreed quietly would be this one.
 *
 * Nothing here is a list of what SHOULD exist. Every artifact is opened, and a
 * declaration whose file is absent is reported rather than skipped.
 *
 *   node tools/ext-baseline-truth.mjs
 */
import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./document-graph.mjs"

const abs = (p) => path.join(ROOT, p)
const read = (p) => fs.readFileSync(abs(p), "utf8")

/**
 * The seven truths, in the requirement's own order.
 *
 * `generator` is the program that writes the artifact; `provenance` is a
 * pattern the artifact's own text must carry when no program does. One of the
 * two is required — an inventory that cannot say where it came from is a claim,
 * and this repository has an ADR about what those cost.
 */
export const TRUTHS = [
  {
    truth: "repository",
    word: "repository",
    artifacts: [
      { path: "docs/architecture/repository-map.json", generator: "tools/repository-map.mjs" },
      { path: "docs/architecture/entry-points.md", generator: "tools/entry-point-inventory.mjs" },
      { path: "docs/architecture/ownership.md", generator: "tools/ownership-map.mjs" },
    ],
  },
  {
    truth: "AWS",
    word: "AWS",
    artifacts: [
      { path: "docs/architecture/aws-inventory.json", generator: "tools/aws-inventory.mjs" },
      { path: "docs/architecture/aws-current-state.md", generator: "tools/aws-inventory.mjs" },
    ],
  },
  {
    truth: "environment",
    word: "environment",
    artifacts: [
      // The declared side. `tools/verify-environments.mjs` compares it to what
      // GitHub actually has and creates nothing — its own header says why
      // creating one would mean the check could never fail.
      { path: "infrastructure/oidc/environments.json", generator: "tools/verify-environments.mjs" },
      {
        path: "docs/architecture/github-current-state.md",
        provenance: /Generated [0-9T:Z-]+ from the GitHub API/,
      },
    ],
  },
  {
    truth: "tenant",
    word: "tenant",
    artifacts: [
      { path: "docs/architecture/cfg-configuration-truth.md", generator: "tools/cfg-configuration-truth.mjs" },
      {
        path: "docs/architecture/simon-repository-inventory.md",
        generator: "tools/simon-absorption-inventory.mjs",
      },
    ],
  },
  {
    truth: "data",
    word: "data",
    artifacts: [
      { path: "docs/migrations/duplicate-sources.json", provenance: /"fact"/ },
      { path: "docs/migrations/DUPLICATE-SOURCES.md", generator: "tools/duplicate-sources-doc.mjs" },
      { path: "docs/architecture/data-provenance.md", provenance: /GE-000-006/ },
    ],
  },
  {
    truth: "integration",
    word: "integration",
    artifacts: [
      { path: "docs/architecture/int-integration-inventory.md", generator: "tools/int-integration-inventory.mjs" },
      {
        path: "docs/architecture/int-connector-capability-matrix.md",
        generator: "tools/int-connector-capability-matrix.mjs",
      },
    ],
  },
  {
    truth: "release",
    word: "release",
    artifacts: [
      { path: "apps/system-studio/src/generated/platform-truth.json", generator: "tools/platform-truth.mjs" },
      { path: "docs/architecture/capability-completeness-registry.yaml", generator: "tools/document-graph.mjs" },
    ],
  },
]

/**
 * Calls that would change the thing being inventoried.
 *
 * AWS SDK v3 names every operation `<Verb><Thing>Command`, so the mutating half
 * is recognisable without a list of services. The git half matters because two
 * of these generators shell out to git: `git ls-files` is a read and
 * `git add` is not, and the difference is one word inside an argv array.
 *
 * Deliberately not "any word that looks like a write". `push` appears in every
 * one of these files as a workflow trigger name and `commit` as a JSON key —
 * a looser rule reported both and would have been switched off within a week.
 */
const MUTATING_AWS = /\b(Create|Put|Delete|Update|Modify|Terminate|Detach|Attach|Tag|Untag|Start|Stop|Reboot|Invoke|Send|Publish)[A-Z][A-Za-z]*Command\b/
const MUTATING_HTTP = /method:\s*["'](POST|PUT|PATCH|DELETE)["']/
const GIT_CALL = /(?:execFileSync|execSync|spawnSync)\(\s*["']git["']\s*,\s*\[([^\]]*)\]/g
const GIT_INLINE = /["'`]git\s+(add|commit|push|checkout|reset|clean|rm|mv|tag|merge|rebase)\b/
const MUTATING_GIT_VERB = /["'](add|commit|push|checkout|reset|clean|rm|mv|tag|merge|rebase)["']/

/**
 * Source with its comments removed.
 *
 * `tools/platform-truth.mjs` explains its own `--check` ordering in a sentence
 * containing the words `git commit`, and the first version of this reported it
 * as a write. A rule that fires on prose is a rule somebody deletes, so the
 * scan reads code.
 *
 * Line comments are stripped only where `//` is not preceded by a colon, quote
 * or backslash — otherwise `"https://api.github.com"` would take the rest of
 * its line with it, which could hide a mutating call sitting after a URL.
 */
export function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
}

/** Why a source is not read-only, or an empty list. Pure, so it can be tested against fixtures. */
export function readOnlySourceProblems(rawSource) {
  const source = withoutComments(rawSource)
  const problems = []

  const aws = MUTATING_AWS.exec(source)
  if (aws) problems.push(`calls ${aws[0]} — that is a write to the estate it is inventorying`)

  const http = MUTATING_HTTP.exec(source)
  if (http) problems.push(`issues an HTTP ${http[1]} — an inventory reads`)

  if (GIT_INLINE.test(source)) problems.push(`runs "git ${GIT_INLINE.exec(source)[1]}" — that writes to the worktree`)

  GIT_CALL.lastIndex = 0
  let m
  while ((m = GIT_CALL.exec(source)) !== null) {
    const verb = MUTATING_GIT_VERB.exec(m[1])
    if (verb) problems.push(`runs git ${verb[1]} — that writes to the worktree`)
  }

  return problems
}

/** Why the generator at `generatorPath` is not read-only, or an empty list. */
export const readOnlyProblems = (generatorPath) => readOnlySourceProblems(read(generatorPath))

/** The binding, resolved against the tree. */
export function resolveTruths() {
  return TRUTHS.map((t) => ({
    truth: t.truth,
    word: t.word,
    artifacts: t.artifacts.map((a) => {
      const here = fs.existsSync(abs(a.path))
      const bytes = here ? fs.statSync(abs(a.path)).size : 0
      const generatorHere = a.generator ? fs.existsSync(abs(a.generator)) : null
      return {
        path: a.path,
        exists: here,
        bytes,
        generator: a.generator ?? null,
        generatorExists: generatorHere,
        provenanceStated:
          a.provenance == null ? null : here ? a.provenance.test(read(a.path)) : false,
        readOnlyProblems: a.generator && generatorHere ? readOnlyProblems(a.generator) : [],
      }
    }),
  }))
}

if (process.argv[1] && path.basename(process.argv[1]) === "ext-baseline-truth.mjs") {
  let artifacts = 0
  let problems = 0
  for (const t of resolveTruths()) {
    console.log(`\n${t.truth} truth`)
    for (const a of t.artifacts) {
      artifacts += 1
      const flags = [
        a.exists ? `${a.bytes} bytes` : "MISSING",
        a.generator ? `by ${a.generator}` : "provenance stated in the file",
        a.readOnlyProblems.length === 0 ? "read-only" : a.readOnlyProblems.join("; "),
      ]
      problems += a.readOnlyProblems.length + (a.exists ? 0 : 1)
      console.log(`  ${a.path}\n      ${flags.join(" · ")}`)
    }
  }
  console.log(`\n${TRUTHS.length} truths, ${artifacts} artifacts, ${problems} problems.`)
}
