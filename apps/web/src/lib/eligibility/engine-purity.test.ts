import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * IER-070-005 — "Prohibit network calls, arbitrary code, hidden defaults, and
 * nondeterminism in evaluation." IER-070-006 — no probabilistic output as a
 * final access condition.
 *
 * A behavioural test can show that today's engine is deterministic. It cannot
 * show that tomorrow's is: a `fetch` added to check a licence registry, or a
 * `Date.now()` substituted for the injected clock, would pass every test in
 * `evaluate.test.ts` while quietly making the decision unreproducible and the
 * receipt a claim nobody can re-derive. That is what this guard is for — the
 * prohibition is on the CODE, so it is checked against the code.
 *
 * It reads the shipped source rather than importing it, because the thing being
 * asserted is textual: that these constructs are not present.
 */

const ENGINE_FILES = [
  "policy.ts",
  "evaluate.ts",
  "tenant-entry.ts",
  // The post-decision path is held to the same rule. An explanation that read a
  // clock, a model or the network would make the account of a decision differ
  // from the decision, which is the same defect one step later.
  "policy-archive.ts",
  "receipt.ts",
  "explain.ts",
] as const

/**
 * Each rule is a pattern and the sentence explaining why the engine may not
 * contain it. `createHash` from `node:crypto` is deliberately NOT here: hashing
 * a policy document is deterministic and is how the digest is produced.
 */
const PROHIBITED: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bfetch\s*\(/, why: "a network call inside a decision (§12.2)" },
  { pattern: /XMLHttpRequest|node:https?\b|from ["']https?["']/, why: "a network client inside a decision" },
  { pattern: /\bnew Function\b|(^|[^.\w])eval\s*\(/m, why: "arbitrary code evaluation (§12.2)" },
  { pattern: /\bDate\.now\s*\(/, why: "a clock other than the explicit evaluation clock (§12.2)" },
  { pattern: /new Date\s*\(\s*\)/, why: "an implicit clock, which makes a decision unreproducible" },
  { pattern: /\bMath\.random\b|\bcrypto\.randomUUID\b|\brandomBytes\b/, why: "nondeterminism (§12.2)" },
  { pattern: /\bprocess\.env\b/, why: "an ambient default the policy did not declare (§12.2 hidden defaults)" },
  { pattern: /\bawait\b|\basync\b/, why: "an awaited effect, which is where a network call arrives" },
  {
    pattern: /\bembedding|\bllm\b|\banthropic\b|\bopenai\b|\bsimilarity\b|\bconfidence\b/i,
    why: "a probabilistic or model-derived signal as an access condition (invariant 8, IER-070-006)",
  },
]

describe("IER-070-005 / IER-070-006 — the evaluation path cannot reach the network, a clock, a model, or arbitrary code", () => {
  it.each(ENGINE_FILES)("%s contains none of the prohibited constructs", (file) => {
    const source = readFileSync(join(__dirname, file), "utf8")
    // Comments are stripped first: this file's own prose names every construct
    // it forbids, and so does the engine's, so a scan over raw text would fail
    // on the sentence explaining the rule rather than on a violation of it.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")

    const found = PROHIBITED.filter((rule) => rule.pattern.test(code)).map(
      (rule) => `${file}: ${rule.why} — matched ${rule.pattern}`,
    )
    expect(found).toEqual([])
  })

  it("the guard reads real source, not an empty string", () => {
    for (const file of ENGINE_FILES) {
      expect(readFileSync(join(__dirname, file), "utf8").length).toBeGreaterThan(1000)
    }
  })

  it("the guard would catch a violation if one were introduced", () => {
    // The scanner applied to a line that does violate the rule. Without this,
    // a regex that never matches anything would look identical to a clean file.
    const violating = "const at = Date.now()\nconst r = Math.random()\nawait fetch(url)"
    const caught = PROHIBITED.filter((rule) => rule.pattern.test(violating))
    expect(caught.map((rule) => rule.why)).toEqual([
      "a network call inside a decision (§12.2)",
      "a clock other than the explicit evaluation clock (§12.2)",
      "nondeterminism (§12.2)",
      "an awaited effect, which is where a network call arrives",
    ])
  })
})
