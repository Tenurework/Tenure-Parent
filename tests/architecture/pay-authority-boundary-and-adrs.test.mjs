import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * PAY-000-001 / PAY-000-002 / PAY-000-003 — the boundary document and the two
 * ADRs are checked against the code they describe, not read for tone.
 *
 * A boundary document is a claim about the repository: that these are the
 * parties, that these are the responsibilities, that these pairs are refused.
 * Written as prose it is true on the day it is written and unfalsifiable
 * afterwards — the failure mode this programme keeps hitting is a plausible
 * document assembled from a Bible's own wording, describing code nobody has.
 *
 * So every fact this file checks is DERIVED from `packages/payments/src/*.ts`
 * and then looked for in the documents. Add a ninth responsibility axis, a
 * fourth funds flow, or a forbidden pair, and the documents go red until
 * somebody writes the new row. Delete a row and they go red too.
 *
 * The one thing it deliberately cannot check is §5, §6 and §9 of the boundary
 * document — the bank, the network, and the gaps — because those describe what
 * is NOT modelled, and there is no code to compare them to. The document says
 * so in those words rather than letting a green test imply otherwise.
 *
 * Runs under bare `node --test` (`npm run test:platform`): no TypeScript, no
 * jest globals. The TypeScript is read as text.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const BOUNDARY = "docs/payments/payment-authority-and-regulatory-boundary.md"
const ADR_MOR = "docs/decisions/pay-adr-0001-merchant-of-record-default-and-exception-paths.md"
const ADR_ALGO = "docs/decisions/pay-adr-0002-responsibility-selection-algorithm.md"
const DOCS = [BOUNDARY, ADR_MOR, ADR_ALGO]

const RESPONSIBILITY = "packages/payments/src/responsibility.ts"
const CHARGE_MODEL = "packages/payments/src/charge-model.ts"
const LIABILITY = "packages/payments/src/liability.ts"
const REGISTRY = "packages/payments/src/capability-registry.ts"

/**
 * Read a repository file with line endings normalised.
 *
 * Windows checkouts hand back CRLF and Linux LF. Every comparison below is over
 * text, so normalising here is what stops this file passing on one platform and
 * failing on the other — the checkout-dependent-artefact failure, in its
 * cheapest form.
 */
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n")
}

/**
 * The quoted strings of a `const NAME … = [ … ]` array literal, in source order.
 *
 * The `= [` is found separately from the name because two of these declarations
 * carry a type annotation — `const DIRECT_CHARGE_NOT_TENURE: readonly
 * ResponsibilityAxis[] = [` — and a reader keyed on `NAME = [` returns an empty
 * list for them. Silently. Which is exactly the shape of a guard that cannot
 * fail, so the first test in this file pins every one of these lists by value.
 */
function stringArray(source, name) {
  const named = source.indexOf(`${name}`)
  if (named === -1) return []
  const start = source.indexOf("= [", named)
  if (start === -1) return []
  const end = source.indexOf("]", start + 3)
  if (end === -1) return []
  return [...source.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** A `const NAME: … = { key: [ … ], … }` record of string arrays, in source order. */
function recordOfStringArrays(source, name) {
  const start = source.indexOf(`${name}: `)
  if (start === -1) return new Map()
  const open = source.indexOf("{", start)
  const close = source.indexOf("\n}", open)
  if (open === -1 || close === -1) return new Map()
  const out = new Map()
  for (const m of source.slice(open, close).matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    out.set(m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((q) => q[1]))
  }
  return out
}

/**
 * A document with its line wrapping taken out, for prose searches.
 *
 * Markdown wraps at 80 columns and a blockquote prefixes every line with `> `,
 * so a phrase this file looks for is routinely split across two lines. Checking
 * raw text would make the guard a check on where somebody pressed return, which
 * is both wrong and the kind of brittleness that gets a guard deleted rather
 * than fixed. Table rows are still checked against the raw text, where the line
 * boundary is meaningful.
 */
function flat(text) {
  return text.replace(/\n>\s?/g, " ").replace(/\s+/g, " ")
}

const responsibility = read(RESPONSIBILITY)
const AXES = stringArray(responsibility, "RESPONSIBILITY_AXES")
const PARTIES = stringArray(responsibility, "RESPONSIBILITY_PARTIES")
const FLOWS = stringArray(responsibility, "FUNDS_FLOWS")
const FORBIDDEN = recordOfStringArrays(responsibility, "FORBIDDEN_PARTIES")
const DIRECT_NOT_TENURE = stringArray(responsibility, "DIRECT_CHARGE_NOT_TENURE")
const MODELS = stringArray(read(CHARGE_MODEL), "CHARGE_MODELS")
const SHIFTING = stringArray(read(LIABILITY), "LIABILITY_SHIFTING_MODELS")

/** `flow → MODEL`, from `MODEL_FOR_FLOW` in charge-model.ts. */
function modelForFlow() {
  const source = read(CHARGE_MODEL)
  const start = source.indexOf("MODEL_FOR_FLOW")
  const open = source.indexOf("{", start)
  const close = source.indexOf("\n}", open)
  const out = new Map()
  for (const m of source.slice(open, close).matchAll(/(\w+):\s*"(\w+)"/g)) out.set(m[1], m[2])
  return out
}

/** How many capability leaves the registry declares, by helper, without executing TypeScript. */
function capabilityCounts() {
  const source = read(REGISTRY)
  const start = source.indexOf("export const PAYMENT_CAPABILITIES")
  const end = source.indexOf("\n]", start)
  const body = source.slice(start, end)
  return {
    planned: (body.match(/(?:^|[\s,(])planned\(/g) ?? []).length,
    unsupported: (body.match(/(?:^|[\s,(])unsupported\(/g) ?? []).length,
  }
}

test("the readers find the code, so nothing below is vacuously green", () => {
  // Every assertion in this file is "the document contains what the code says".
  // A reader that returns nothing makes all of them pass while checking
  // nothing, and it looks identical in CI. Five of those shipped in this
  // repository already.
  assert.deepEqual(AXES, [
    "merchantDisplay",
    "feePayer",
    "lossPayer",
    "refundPayer",
    "disputeOwner",
    "kycUpdateOwner",
    "accountCollectionOwner",
    "supportOwner",
  ])
  assert.deepEqual(PARTIES, ["TENURE", "TENANT", "PROVIDER", "CUSTOMER"])
  assert.deepEqual(FLOWS, ["direct", "destination", "separate_charges_and_transfers"])
  assert.deepEqual(MODELS, ["DIRECT", "DESTINATION", "SEPARATE_CHARGE_AND_TRANSFER"])
  assert.deepEqual(SHIFTING, ["DESTINATION", "SEPARATE_CHARGE_AND_TRANSFER"])
  assert.deepEqual(DIRECT_NOT_TENURE, [
    "merchantDisplay",
    "lossPayer",
    "refundPayer",
    "disputeOwner",
    "accountCollectionOwner",
  ])
  assert.deepEqual([...FORBIDDEN.keys()], AXES, "FORBIDDEN_PARTIES must cover every axis, in order")
  assert.equal(FORBIDDEN.get("kycUpdateOwner").join(","), "TENURE,CUSTOMER")
  assert.equal(FORBIDDEN.get("feePayer").length, 0, "feePayer is the axis with no forbidden party")
  assert.equal(modelForFlow().size, FLOWS.length)
})

test("all three documents exist", () => {
  for (const doc of DOCS) {
    assert.ok(fs.existsSync(path.join(ROOT, doc)), `${doc} does not exist`)
  }
})

test("the boundary document's axis table is the code's, row for row", () => {
  const doc = read(BOUNDARY)
  const parties = (list) => (list.length === 0 ? "—" : list.map((p) => `\`${p}\``).join(", "))

  for (const axis of AXES) {
    const forbidden = FORBIDDEN.get(axis) ?? []
    const allowed = PARTIES.filter((p) => !forbidden.includes(p))
    const row = `| \`${axis}\` | ${parties(forbidden)} | ${parties(allowed)} |`
    assert.ok(
      doc.includes(row),
      `${BOUNDARY} has no row for ${axis} matching ${RESPONSIBILITY}.\n` +
        `Expected the line:\n  ${row}\n` +
        `A responsibility axis the code refuses a party for, and the boundary document does not ` +
        `say so, is a boundary nobody outside the code knows about.`,
    )
  }
})

test("the boundary document names every party, every flow and the direct-charge exclusions", () => {
  const doc = flat(read(BOUNDARY))
  for (const party of PARTIES) {
    assert.ok(doc.includes(`\`${party}\``), `${BOUNDARY} never names the party ${party}`)
  }
  for (const flow of FLOWS) {
    assert.ok(doc.includes(flow), `${BOUNDARY} never names the funds flow ${flow}`)
  }
  const exclusions = DIRECT_NOT_TENURE.map((a) => `\`${a}\``).join(", ")
  assert.ok(
    doc.includes(exclusions),
    `${BOUNDARY} does not list DIRECT_CHARGE_NOT_TENURE as ${exclusions}. ` +
      `That list is the only thing keeping Tenure off merchant display on the default flow.`,
  )
})

test("the boundary document's capability count is the registry's", () => {
  const { planned, unsupported } = capabilityCounts()
  assert.ok(planned > 0 && unsupported > 0, "the registry reader found nothing")
  const doc = flat(read(BOUNDARY))
  const claim = `${planned + unsupported} leaves: ${planned} \`PLANNED\`\nand ${unsupported} \`UNSUPPORTED\``
  assert.ok(
    doc.includes(claim) || doc.includes(claim.replace("\n", " ")),
    `${BOUNDARY} does not state the registry's actual composition.\n` +
      `Expected: "${claim.replace("\n", " ")}".\n` +
      `A document that says nothing is live while the registry has moved is the claim that ` +
      `matters most and rots fastest.`,
  )
})

test("Bible §2's list of what Tenure is not is answered item by item", () => {
  // The list is read out of the Bible rather than copied here, so a new item in
  // the spec reds the document that is supposed to answer it.
  const bible = read("Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md")
  const start = bible.indexOf("Tenure is not automatically:")
  assert.ok(start > 0, "the Bible's 'Tenure is not automatically' list moved or was renamed")
  const block = bible.slice(start, bible.indexOf("\n\n", bible.indexOf("- ", start) + 200))
  const items = [...block.matchAll(/^- (.+)$/gm)].map((m) => m[1].trim())
  assert.ok(items.length >= 7, `read ${items.length} items from Bible §2, expected at least 7`)

  const doc = flat(read(BOUNDARY))
  for (const item of items) {
    assert.ok(
      doc.includes(item),
      `${BOUNDARY} does not answer Bible §2's "${item}".\n` +
        `Every line of that list is a liability Tenure acquires by not mentioning it.`,
    )
  }
})

test("the merchant-of-record ADR names every liability-shifting model as an exception path", () => {
  const adr = flat(read(ADR_MOR))
  for (const model of SHIFTING) {
    assert.ok(
      adr.includes(`\`${model}\``),
      `${ADR_MOR} does not name ${model}, which ${LIABILITY} treats as liability-shifting. ` +
        `An exception path the code has and the ADR does not is an exception nobody approves.`,
    )
  }
  assert.ok(
    adr.includes("assertLiabilityApproved") && read(LIABILITY).includes("export function assertLiabilityApproved"),
    `${ADR_MOR} must name the gate, and ${LIABILITY} must export it`,
  )
  // The default itself, in the words the Bible approved it in.
  assert.ok(
    adr.includes("Tenure is not the merchant of record by default"),
    `${ADR_MOR} must quote Bible §1.1's default verbatim`,
  )
})

test("the selection-algorithm ADR states every axis, every flow and the model mapping", () => {
  const adr = flat(read(ADR_ALGO))
  for (const axis of AXES) {
    assert.ok(adr.includes(axis), `${ADR_ALGO} never mentions the axis ${axis}`)
  }
  // The order is the decision: FUNDS_FLOWS is ascending platform liability and
  // the algorithm takes the first complete matrix. An ADR that lists them in a
  // different order has recorded a different algorithm.
  const order = FLOWS.map((f) => `\`${f}\``).join(", ")
  assert.ok(
    adr.includes(order),
    `${ADR_ALGO} does not state the flow order as ${order}. That order IS the algorithm.`,
  )
  for (const [flow, model] of modelForFlow()) {
    assert.ok(
      adr.includes(`${flow} → ${model}`),
      `${ADR_ALGO} does not record the mapping ${flow} → ${model} from ${CHARGE_MODEL}`,
    )
  }
})

test("every repository path the three documents cite exists", () => {
  // The cheapest way to detect a document assembled from plausible wording
  // rather than from the tree: open every path it names.
  const missing = []
  for (const doc of DOCS) {
    for (const m of read(doc).matchAll(/`([\w@][\w./@-]*\.(?:ts|tsx|mjs|js|md|prisma|ya?ml|sql))`/g)) {
      const cited = m[1]
      if (!fs.existsSync(path.join(ROOT, cited))) missing.push(`${doc} cites ${cited}`)
    }
  }
  assert.deepEqual(
    missing.sort(),
    [],
    "These documents name files that are not in the tree:\n" + missing.sort().join("\n"),
  )
})
