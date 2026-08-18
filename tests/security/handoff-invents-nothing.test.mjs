import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-043-006 — the handoff package invents nothing, and is current.
 *
 * Every value in `docs/handoff/simon-sso.md` is pasted into a production
 * identity provider by a university's IT team. A plausible-looking endpoint is
 * not a smaller version of the real one: it is configured, tested, and cannot be
 * debugged, because both sides believe they are correct.
 *
 * A stale document is the same failure with a delay. It carries values that were
 * true when somebody generated it, which is exactly the document a person trusts
 * without re-checking.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const DOCUMENT = "docs/handoff/simon-sso.md"

function read(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return ""
    throw error
  }
}

/**
 * Values the document actually offers, from the "Ready to configure" table.
 *
 * Only that table. The "Not available yet" rows carry prose explaining what is
 * missing, and that prose legitimately names things — `example` appears in
 * sentences about placeholders. Scanning it would fire on the explanation of the
 * rule rather than on a breach of it, which is how four guards in this
 * repository have been caught out.
 */
function offeredValues(markdown) {
  const start = markdown.indexOf("## Ready to configure")
  if (start === -1) return []
  const end = markdown.indexOf("\n## ", start + 1)
  const section = markdown.slice(start, end === -1 ? markdown.length : end)

  return [...section.matchAll(/\|\s*[^|]+\|\s*`([^`]+)`\s*\|/g)].map((match) => match[1].trim())
}

/** The same pattern the engine refuses on, read from it rather than copied. */
function placeholderPattern() {
  const source = read("packages/identity/src/handoff.ts")
  const match = /const PLACEHOLDER =\n\s*(\/.+\/[a-z]*)/.exec(source)
  assert.ok(match, "PLACEHOLDER not found in packages/identity/src/handoff.ts")
  // eslint-disable-next-line no-eval
  return eval(match[1])
}

/** A synthetic inventory on disk, for the flags that take `--inventory`. */
function writeInventory(inventory) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "handoff-")), "inventory.json")
  fs.writeFileSync(file, JSON.stringify(inventory))
  return file
}

const inventoryWith = (certificates, cloudfront) => ({
  region: "us-east-1",
  generatedAt: "2026-08-03T00:00:00.000Z",
  edge: { certificates, cloudfront },
  identityProvider: { cognitoUserPools: [] },
})

test("the handoff package exists", () => {
  const markdown = read(DOCUMENT)
  assert.ok(markdown.length > 0, `${DOCUMENT} is missing. Run: node tools/simon-sso-handoff.mjs`)
  assert.match(markdown, /GE-043-006/)
})

test("no value it offers is a placeholder", () => {
  const invented = placeholderPattern()
  const offenders = offeredValues(read(DOCUMENT)).filter((value) => invented.test(value))

  assert.deepEqual(
    offenders,
    [],
    `these are offered as configuration and are placeholders:\n  ${offenders.join("\n  ")}\n` +
      `A made-up endpoint is configured by a university's IT team, tested, and cannot be debugged.`,
  )
})

test("the detector reads real values out of the document the generator writes", () => {
  // Asserted because the failure mode is silence: a matcher that found nothing
  // would report the document clean whatever it contained.
  //
  // It used to be asserted against the COMMITTED document — `offeredValues(...)
  // .length > 0` — and that conflated two different things. "The matcher works"
  // and "the estate has something deployed" come apart the moment nothing is
  // deployed, which is a state `render()` has a whole prose branch for. The
  // committed document now offers nothing because the inventory it is generated
  // from is empty, so the old floor could only be satisfied by putting a value
  // in a handoff package that no deployment backs — the exact failure the rest
  // of this file exists to prevent. A guard whose only remedy is the defect it
  // guards against is measuring the wrong thing.
  //
  // What has to be true is that the matcher can still read the table the
  // generator writes. So render one, through the real `render()`, from an
  // inventory that has a live origin. If a column is added, the backticks are
  // dropped, or the heading is renamed, the matcher stops finding the value and
  // this fails — which is the drift the floor was there to catch, now measured
  // against the renderer rather than against today's AWS account.
  const rendered = execFileSync("node", ["tools/simon-sso-handoff.mjs", "--render", "--inventory", writeInventory(
    inventoryWith(
      [{ domain: "live.tenurework.com", status: "ISSUED" }],
      [{ domain: "d1.cloudfront.net", aliases: ["live.tenurework.com"], enabled: true }],
    ),
  )], { cwd: ROOT, encoding: "utf8" })

  assert.deepEqual(
    offeredValues(rendered),
    ["https://live.tenurework.com"],
    "the table matcher is not reading the document the generator renders",
  )

  // And nothing the committed document does offer is too short to be a real
  // endpoint. Vacuous only when the estate is empty, which is why the line
  // above no longer depends on it.
  const values = offeredValues(read(DOCUMENT))
  assert.ok(
    values.every((value) => value.length > 3),
    `an offered value is suspiciously short: ${values.join(", ")}`,
  )
})

test("the detector would catch a planted placeholder", () => {
  // The matcher and the pattern, exercised together on a document shaped like
  // the real one. Testing them separately leaves their composition unproven —
  // which is how GE-042-005's sweep was found to be neuterable.
  const planted = [
    "## Ready to configure",
    "",
    "| Field | Value | Source |",
    "|---|---|---|",
    "| Tenure service origin | `https://tenure.example.edu` | invented |",
    "",
  ].join("\n")

  const invented = placeholderPattern()
  const found = offeredValues(planted).filter((value) => invented.test(value))
  assert.equal(found.length, 1, "the composition of matcher and pattern does not catch an obvious placeholder")
})

test("every blocked field says what would unblock it", () => {
  // The document's whole value when nothing is deployed. A gap with no reason
  // is indistinguishable from an oversight, and the IT team cannot plan around
  // it.
  const markdown = read(DOCUMENT)
  const start = markdown.indexOf("## Not available yet")
  if (start === -1) return // Everything is available; nothing to check.

  const end = markdown.indexOf("\n## ", start + 1)
  const section = markdown.slice(start, end === -1 ? markdown.length : end)

  const rows = [...section.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)].filter(
    (match) => !/^-+$/.test(match[1]) && match[1] !== "Field",
  )

  assert.ok(rows.length > 0, "the blocked-field table has no rows the matcher can read")
  for (const [, field, reason] of rows) {
    assert.ok(
      reason.length > 30,
      `"${field}" is blocked with no usable reason: "${reason}"`,
    )
  }
})

test("the document is current", () => {
  // A stale package carries values that were true when somebody generated it,
  // which is exactly the document a person trusts without re-checking.
  execFileSync("node", ["tools/simon-sso-handoff.mjs", "--check"], { cwd: ROOT, stdio: "pipe" })
})

/**
 * Run the generator's fact-gathering against a synthetic inventory.
 *
 * The origin rules — an ISSUED certificate, an enabled distribution — happen to
 * be true of the one real inventory, so removing either changed nothing and both
 * mutations survived. These feed inventories where the rules matter.
 */
function factsFrom(inventory) {
  const output = execFileSync(
    "node",
    ["tools/simon-sso-handoff.mjs", "--facts", "--inventory", writeInventory(inventory)],
    { cwd: ROOT, encoding: "utf8" },
  )
  return JSON.parse(output.trim())
}

test("an alias whose certificate failed is not a live origin", () => {
  // A name with a FAILED certificate does not serve traffic. Handing it over is
  // handing over a broken endpoint that looks exactly like a working one.
  const facts = factsFrom(
    inventoryWith(
      [{ domain: "broken.tenurework.com", status: "FAILED" }],
      [{ domain: "d1.cloudfront.net", aliases: ["broken.tenurework.com"], enabled: true }],
    ),
  )
  assert.equal(facts.serviceOrigin, null)
})

test("an alias on a disabled distribution is not a live origin", () => {
  const facts = factsFrom(
    inventoryWith(
      [{ domain: "off.tenurework.com", status: "ISSUED" }],
      [{ domain: "d1.cloudfront.net", aliases: ["off.tenurework.com"], enabled: false }],
    ),
  )
  assert.equal(facts.serviceOrigin, null)
})

test("an enabled alias with an issued certificate is a live origin", () => {
  // Without this the two refusals above could come from a function that always
  // returns null.
  const facts = factsFrom(
    inventoryWith(
      [{ domain: "live.tenurework.com", status: "ISSUED" }],
      [{ domain: "d1.cloudfront.net", aliases: ["live.tenurework.com"], enabled: true }],
    ),
  )
  assert.equal(facts.serviceOrigin, "https://live.tenurework.com")
})

test("it picks the alias that is actually live, not the first one", () => {
  const facts = factsFrom(
    inventoryWith(
      [
        { domain: "broken.tenurework.com", status: "FAILED" },
        { domain: "live.tenurework.com", status: "ISSUED" },
      ],
      [
        { domain: "d1.cloudfront.net", aliases: ["broken.tenurework.com"], enabled: true },
        { domain: "d2.cloudfront.net", aliases: ["live.tenurework.com"], enabled: true },
      ],
    ),
  )
  assert.equal(facts.serviceOrigin, "https://live.tenurework.com")
})

test("the generator and the engine refuse on the same pattern", () => {
  // Two copies of a rule is how they come to disagree. The tool reads the
  // engine's pattern rather than holding its own, and this proves it still can.
  const tool = read("tools/simon-sso-handoff.mjs")

  assert.match(
    tool,
    /packages\/identity\/src\/handoff\.ts/,
    "the generator no longer reads the engine's placeholder pattern",
  )
  assert.ok(
    !/const PLACEHOLDER\s*=\s*\//.test(tool),
    "the generator now defines its own placeholder pattern, which will drift from the engine's",
  )
})
