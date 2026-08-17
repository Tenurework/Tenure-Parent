/**
 * TTES-050-004 — the governance dashboard is current, its numbers are derived,
 * and the debt budgets only ever tighten.
 *
 * The failure this exists to prevent is documented in the subject it measures.
 * `apps/web/eslint.config.mjs` carried the arbitrary-spacing count as a comment
 * — "243 occurrences across 59 files as of 2026-08-07", itself a correction of
 * "237 across 58" — with a one-line re-measurement script nobody ran. It was
 * 275 across 66 when this generator first ran. A number in a comment is a number
 * that goes up.
 *
 * Every assertion here is one of three shapes:
 *
 *   1. the committed document is what the generator produces now (staleness);
 *   2. the generator's readers still read something (floors), because every
 *      finding is a count and a reader that returned nothing would publish a
 *      clean product;
 *   3. the budgets hold in BOTH directions — over is a regression, under is a
 *      budget somebody forgot to lower after paying debt down.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../../tools/document-graph.mjs"
import { DOMAINS } from "../../tools/ownership-map.mjs"
import {
  DEBT_BUDGETS,
  DEBT_CLASSES,
  OUT,
  adoption,
  debtMeasurements,
  designTokenExceptions,
  ownedWrappers,
  ownerOfFile,
  productModules,
  render,
} from "../../tools/ttes-governance-dashboard.mjs"

const committed = () => fs.readFileSync(path.join(ROOT, OUT), "utf8")

test("the committed dashboard matches what the generator produces now", () => {
  assert.equal(
    committed(),
    render(),
    `${OUT} is stale. Run: node tools/ttes-governance-dashboard.mjs — and read the diff before committing it, ` +
      "because a change in these numbers is either debt paid down or debt added.",
  )
})

test("the dashboard is deterministic and its paths are POSIX", () => {
  // Two renders in one process, byte-compared: a Map iteration order that
  // depended on insertion, or a directory read that depended on the filesystem,
  // would be "current here, stale in CI" — the failure that has burned this
  // programme repeatedly.
  assert.equal(render(), render(), "two renders in the same process disagree; something in the generator is ordered by chance.")
  const text = committed()
  assert.ok(!text.includes("\r"), "the dashboard contains a CR byte, so it will differ between platforms.")
  assert.ok(
    !/`[A-Za-z0-9_.@/-]*\\[A-Za-z0-9_.@/-]*`/.test(text),
    "the dashboard cites a Windows-separated path; every path must be POSIX-normalised.",
  )
  // No clock. The only dates in the document are the exception expiries, which
  // are copied out of the config and do not move on their own. Anything else —
  // "generated on", "days remaining", "as of" — makes the document a function of
  // the date, so it goes stale by sitting still and every reader learns to
  // ignore the staleness check.
  const dates = [...new Set([...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((m) => m[0]))].sort()
  const expiries = [...new Set(designTokenExceptions().map((e) => e.expires))].sort()
  assert.deepEqual(dates, expiries, "The dashboard states a date that is not an exception expiry.")
})

test("every path the dashboard cites exists", () => {
  // A row naming a file nobody has is the fabricated-inventory failure: it reads
  // as measurement and cannot be checked by a reader who trusts it.
  const text = committed()
  const cited = [...text.matchAll(/`((?:apps|packages|tools|tests|docs|modules)\/[\w./@()[\]-]+)`/g)].map((m) => m[1])
  assert.ok(cited.length >= 20, `Only ${cited.length} repository paths are cited; the document has lost its evidence.`)
  const missing = [...new Set(cited)].filter((p) => !fs.existsSync(path.join(ROOT, p)))
  assert.deepEqual(missing, [], "The dashboard cites paths that do not exist.")
})

test("the readers still read: modules, wrappers, exceptions and owners", () => {
  const modules = productModules()
  assert.ok(modules.length >= 200, `Only ${modules.length} product modules were read; the walk has collapsed.`)
  assert.ok(
    !modules.some((f) => /\.(test|itest|spec)\./.test(f)),
    "a test file was counted as a product module, so its fixtures would appear as debt.",
  )

  const wrappers = ownedWrappers()
  assert.ok(wrappers.length >= 15, `Only ${wrappers.length} owned wrappers were read; the owned layer has moved.`)
  const button = wrappers.find((w) => w.module === "Button")
  assert.ok(button, "the owned Button was not found; the wrapper reader is looking in the wrong place.")
  assert.ok(button.exports.includes("Button"), "the export reader no longer sees Button's own export.")

  // Adoption has to be a real count, not a constant. `Card` is imported by
  // dozens of surfaces and `Tabs` by none — if those two came back equal the
  // importer matcher has stopped matching.
  const adopted = adoption(modules)
  const card = adopted.find((w) => w.module === "Card")
  assert.ok(card.importers >= 10, `Card reports ${card.importers} importers; the import matcher has stopped matching.`)

  const exceptions = designTokenExceptions()
  assert.ok(exceptions.length >= 4, `Only ${exceptions.length} exceptions parsed; the config's table has been reformatted.`)
  for (const e of exceptions) {
    assert.ok(e.files.length >= 1, `An exception names no file: ${JSON.stringify(e)}`)
    assert.match(e.expires, /^\d{4}-\d{2}-\d{2}$/, `An exception has no ISO expiry: ${JSON.stringify(e)}`)
    assert.ok(e.allow.length >= 1, `An exception suspends no named rule: ${JSON.stringify(e)}`)
    assert.ok(e.reason.length > 40, `An exception's reason is too short to be one: ${JSON.stringify(e)}`)
  }

  const owner = ownerOfFile()
  assert.ok(owner.size >= 300, `Only ${owner.size} files have an owner; the ownership map is not being read.`)
  const keys = new Set(DOMAINS.map((d) => d.key))
  const unknown = [...new Set(owner.values())].filter((d) => !keys.has(d))
  assert.deepEqual(unknown, [], "The owner column names something that is not a domain.")
})

test("no exception has silently expired", () => {
  // ESLint enforces this at lint time, and a lint run takes five minutes. This
  // is the same fact in a second: an expired exception is a rule that stopped
  // being suspended and a file that is now reporting, which is a thing somebody
  // has to decide about rather than discover in CI.
  const today = new Date().toISOString().slice(0, 10)
  const expired = designTokenExceptions()
    .filter((e) => e.expires < today)
    .map((e) => `${e.files.join(", ")} (expired ${e.expires})`)
  assert.deepEqual(
    expired,
    [],
    "A design-token exception has expired. Either the file no longer needs it — delete the entry — or the " +
      "reason still holds and somebody has to say so with a new date.",
  )
})

test("the debt detectors fire on the markup they are about", () => {
  // Exercised on literals, because every real assertion here is a count and a
  // detector that had been switched off would report a smaller number and pass.
  const fires = (key, sample) => {
    const cls = DEBT_CLASSES.find((c) => c.key === key)
    cls.pattern.lastIndex = 0
    return (sample.match(cls.pattern) ?? []).length
  }
  assert.equal(fires("arbitrary-spacing-type", '<div className="p-[7px] text-[13px]">'), 2)
  assert.equal(fires("arbitrary-spacing-type", '<div className="text-[--error] bg-[#fff]">'), 0, "a token reference and a colour are owned by other rules")
  assert.equal(fires("raw-button-element", "<button type=\"submit\">Go</button>"), 1)
  assert.equal(fires("raw-button-element", "<Button variant=\"primary\">Go</Button>"), 0, "the owned wrapper is not debt")
  assert.equal(fires("raw-text-input-element", '<input type="text" /><textarea />'), 2)
  assert.equal(
    fires("raw-text-input-element", '<input type="checkbox" /><input type="hidden" /><input type="file" />'),
    0,
    "no owned wrapper exists for these, so counting them would be a ban rather than debt",
  )
  assert.equal(fires("raw-select-element", "<select><option/></select>"), 1)
  assert.equal(fires("hand-rolled-page-heading", "<h1>Approvals</h1>"), 1)
  assert.equal(fires("easing-keyword", 'className="transition ease-out duration-fast"'), 1)
})

test("the debt budgets hold, and hold in both directions", () => {
  const measured = debtMeasurements()
  assert.equal(measured.length, DEBT_CLASSES.length)

  const regressed = []
  const slack = []
  for (const cls of measured) {
    assert.equal(
      typeof DEBT_BUDGETS[cls.key],
      "number",
      `${cls.key} has no budget; a debt class with no budget is a number that goes up.`,
    )
    if (cls.occurrences > cls.budget) {
      regressed.push(`${cls.key}: ${cls.occurrences} occurrences against a budget of ${cls.budget}`)
    } else if (cls.occurrences < cls.budget) {
      slack.push(`${cls.key}: ${cls.occurrences} occurrences against a budget of ${cls.budget} — lower it to ${cls.occurrences}`)
    }
  }

  assert.deepEqual(
    regressed,
    [],
    "Visual debt has grown. Use the sanctioned alternative named in " +
      OUT +
      " §3, or argue the budget up in DEBT_BUDGETS where a reviewer can see it.",
  )
  assert.deepEqual(
    slack,
    [],
    "Debt was paid down and the budget was not lowered with it. A ratchet only ratchets when it is tightened; " +
      "a budget left above the measurement is room for the next regression to hide in.",
  )

  // Floor: the classes are only worth budgeting if they are measuring something.
  const total = measured.reduce((n, c) => n + c.occurrences, 0)
  assert.ok(total >= 100, `Only ${total} debt occurrences across the whole product; the detectors have gone quiet.`)
  assert.ok(
    measured.every((c) => c.perFile.every((f) => f.domain)),
    "a debt row has no owner, so nobody answers for it.",
  )
})
