/**
 * WRK-GATE-000 — no existing connector or AI capability is overstated.
 *
 * The gate had no check and the repository failed it in three named places, all
 * in one feature:
 *
 *   1. `apps/web/src/lib/calendar-sync.ts` opened with "When Microsoft Graph
 *      credentials are provided, a real two-way GraphCalendarSync implements the
 *      CalendarSyncProvider below and drops in with no change to callers." A
 *      repository-wide grep for `calendarSync|setCalendarSyncProvider|
 *      CalendarSyncProvider|IcsFeedSync` returned six hits and every one was
 *      inside that file. "No change to callers" was true because there were no
 *      callers, and the only implementation of the interface implemented neither
 *      of its two methods.
 *   2. `apps/web/src/components/CalendarSubscribe.tsx` repeated it to a student:
 *      "Two-way sync (edits made in Outlook flowing back into Tenure) turns on
 *      once your institution connects Microsoft 365." Nothing connects Microsoft
 *      365. The only Microsoft row in the catalog is `microsoft.outlook-mail` at
 *      `lifecycle: PLANNED`, whose own disclaimer says no connector code, app
 *      registration, scope set, certification or provider review exists.
 *   3. The same component called the ICS feed "the credential-free half of
 *      Outlook sync". There is no other half.
 *
 * Two rules, because those were two different failures.
 *
 * ## Rule (a): a capability claim must survive the catalog
 *
 * The brands are read out of `packages/provisioning/src/provider-packs.ts`, not
 * listed here, so a pack added tomorrow is covered without anybody remembering
 * to add it. A brand named beside a capability verb, with nothing negating it,
 * is an affirmative claim that Tenure does that thing — and it is refused unless
 * the catalog row for that provider is in a lifecycle `isUsable` can pass.
 *
 * That gating is what makes this a check rather than a ban. The day somebody
 * builds the Outlook connector, certifies it, and advances the row to
 * `PUBLISHED`, the claim becomes true and this rule stops objecting on its own.
 * Until then it objects, in the product's own words, at the line that says it.
 *
 * ## Rule (b): a doc comment may not claim a caller that does not exist
 *
 * A dead export is ordinary rot. A dead export whose comment asserts that
 * callers exist is a false statement about the system, and it is the one that
 * survives review — the reader takes the comment at its word and never greps.
 * `git grep -w` over every tracked and untracked source file is the same
 * evidence a reviewer would gather, run every time instead of never.
 *
 * ## Why this reads source text
 *
 * `tools/run-platform-tests.mjs` runs `node --test` with no TypeScript loader,
 * so the catalog cannot be imported and its lifecycle is parsed out of the
 * source — the arrangement `provider-packs-bind-requirements.test.mjs` already
 * uses, and the reason `provider-packs.ts` writes its fields by name.
 * Comments are deliberately NOT stripped: the claim in case (1) WAS a comment.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

const PACKS_FILE = "packages/provisioning/src/provider-packs.ts"
const CATALOGS_FILE = "packages/provisioning/src/catalogs.ts"
const CELL_ROOT = "apps/web/src"

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")

/**
 * Tracked AND untracked source files.
 *
 * `--others --exclude-standard` matters in both directions here: a new
 * component making a false claim would pass until it was committed, and a new
 * test file referencing an export would not count as a reference — so a live
 * symbol would be reported dead. `forbidden-clients.test.mjs` learned the first
 * half; this needs both.
 */
function sourceFiles(...roots) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...roots],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx)$/.test(f))

  assert.ok(
    files.length > 50,
    `only ${files.length} files found under ${roots.join(", ")} — the scan is broken, not the code`,
  )
  return files
}

function readIfPresent(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8")
  } catch (error) {
    // `--others` lists files that a concurrent build or generator can remove
    // between the listing and the read. A guard that crashes because a file it
    // was told about vanished fails for a reason unrelated to what it checks.
    if (error.code === "ENOENT") return ""
    throw error
  }
}

/* ------------------------------------------------ (a) capability claims -- */

/**
 * Every provider this platform has a catalog row for, and that row's lifecycle.
 *
 * Both the display name ("Microsoft Outlook Mail") and the provider slug
 * ("microsoft") map to the same lifecycle, because a claim can be written
 * either way and a rule that only understood one spelling would be trivially
 * avoidable.
 */
function catalogBrands() {
  const text = read(PACKS_FILE)
  const brands = new Map()

  // `pack({ ... })` blocks, split on the closing `})` so each brand is paired
  // with ITS OWN lifecycle rather than with the file's last one.
  for (const block of text.split(/\bpack\(\{/).slice(1)) {
    const body = block.slice(0, block.indexOf("})"))
    const displayName = /displayName:\s*"([^"]+)"/.exec(body)?.[1]
    const provider = /provider:\s*"([^"]+)"/.exec(body)?.[1]
    // `pack()` defaults `lifecycle` to PLANNED; an explicit one overrides.
    const lifecycle = /lifecycle:\s*"([A-Z_]+)"/.exec(body)?.[1] ?? "PLANNED"
    if (displayName) brands.set(displayName, lifecycle)
    if (provider) brands.set(provider, lifecycle)
  }

  assert.ok(brands.size >= 20, `parsed only ${brands.size} provider brands from ${PACKS_FILE}`)
  return brands
}

/**
 * The lifecycles `isUsable` can pass.
 *
 * Read out of `catalogs.ts` rather than hardcoded, so that if the gate ever
 * starts offering another lifecycle this rule learns about it instead of
 * silently continuing to refuse a claim that has become true.
 */
function usableLifecycles() {
  const text = read(CATALOGS_FILE)
  assert.match(
    text,
    /entry\.lifecycle !== "PUBLISHED" && entry\.lifecycle !== "DEPRECATED"/,
    `${CATALOGS_FILE} no longer refuses every lifecycle except PUBLISHED/DEPRECATED — ` +
      `this rule derives "could be usable" from that line and must be updated with it`,
  )
  return new Set(["PUBLISHED", "DEPRECATED"])
}

/** Verbs that turn a brand name into a claim about what Tenure does with it. */
const CAPABILITY_VERB =
  /\b(two-way|bi-?directional|syncs?|syncing|synced|sends?|sending|creates?|creating|flows? back|flowing back|writes? back|writing back|pushes?|pulls?|connects? to|connecting to)\b/i

/**
 * Words that turn the same sentence into a denial.
 *
 * "There is no Microsoft Graph connector" and "Two-way sync turns on once your
 * institution connects Microsoft 365" contain the same brand and the same verb
 * and are opposites, so a rule that could not tell them apart would either pass
 * the lie or ban the truth. This is a heuristic and it is a deliberate one: it
 * fails SAFE for honesty (a denial is allowed) and it is the affirmative claim —
 * the one that misleads a student — that has to earn its place.
 */
const NEGATION =
  /\b(no|not|never|nothing|cannot|can't|without|instead of|one[- ]way|publish(?:es|ing)?[- ]only|used to|would|refus|deleted|absent)\b/i

test("no file in the cell claims a provider capability the catalog cannot back", () => {
  const brands = catalogBrands()
  const usable = usableLifecycles()
  const brandRe = new RegExp(
    "\\b(" +
      [...brands.keys()]
        .sort((a, b) => b.length - a.length)
        .map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|") +
      ")\\b",
    "i",
  )

  const offenders = []
  for (const file of sourceFiles(CELL_ROOT)) {
    readIfPresent(file)
      .split("\n")
      .forEach((line, n) => {
        const brand = brandRe.exec(line)
        if (!brand) return
        if (!CAPABILITY_VERB.test(line)) return
        if (NEGATION.test(line)) return

        const lifecycle = brands.get(brand[1]) ?? brands.get(brand[1].toLowerCase()) ?? "PLANNED"
        if (usable.has(lifecycle)) return
        offenders.push(
          `${file}:${n + 1} — claims a ${brand[1]} capability; its catalog row is ${lifecycle}\n` +
            `      ${line.trim().slice(0, 140)}`,
        )
      })
  }

  assert.deepEqual(
    offenders,
    [],
    `a connector capability is claimed that the catalog does not back:\n  ${offenders.join("\n  ")}\n\n` +
      `Either build, certify and advance the pack in ${PACKS_FILE} — at which point this rule ` +
      `stops objecting by itself — or render the sentence from ` +
      `providerActivation() in @tenure/platform-config, which is what ` +
      `apps/web/src/components/CalendarSubscribe.tsx does.`,
  )
})

test("the sentence a student reads about calendar sync is derived, not written", () => {
  // The remedy the failure message above names has to actually be in place, or
  // the cheapest way to satisfy this suite is to delete the copy entirely and
  // tell the user nothing.
  for (const file of [
    "apps/web/src/components/CalendarSubscribe.tsx",
    "apps/web/src/app/(app)/calendar/page.tsx",
  ]) {
    assert.match(
      read(file),
      /calendarSyncSentence|providerActivation/,
      `${file} renders calendar-sync copy without reading the provider activation gate`,
    )
  }

  // And the indirection must still BE the gate rather than a constant that once
  // was. Freezing `calendarSyncSentence` to a literal would leave every
  // assertion above green.
  assert.match(
    read("packages/platform-config/src/provider-review.ts"),
    /export function calendarSyncSentence[\s\S]{0,600}providerActivation\(\s*GRAPH_CALENDAR_SCOPES/,
    "calendarSyncSentence no longer runs providerActivation over GRAPH_CALENDAR_SCOPES",
  )
})

/* ------------------------------------------- (b) a comment with no caller -- */

const EXPORTED =
  /^\s*export\s+(?:async\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/

/**
 * A doc comment ASSERTING that callers exist, as opposed to describing what a
 * caller must do.
 *
 * "What a caller must supply to reach the vendor" (`AiCompleteOptions`) is a
 * description of an obligation and says nothing about whether anyone has taken
 * it on. "Drops in with no change to callers" is a claim that they exist. Only
 * the second kind is checkable, so only the second kind is checked.
 */
const CLAIMS_A_CALLER = [
  /\bno change to (?:the |its )?callers?\b/i,
  /\bevery (?:existing )?caller\b/i,
  /\bdrops in\b/i,
  /\bthe (?:one|two|three|four|five|six|\d+) (?:production |existing )?call(?:ers?|[ -]sites?)\b/i,
  /\bis (?:called|invoked) by\b/i,
  /\bcallers? (?:already|all|both|each|go through|reach)\b/i,
  /\bimplement(?:s|ed by)\b/i,
]

/**
 * The comment block above a declaration, and every block that names it.
 *
 * BOTH, because the claim that started this item was in neither place the
 * obvious implementation looks. `calendar-sync.ts` carried it in the MODULE
 * header — "a real two-way GraphCalendarSync implements the CalendarSyncProvider
 * below and drops in with no change to callers" — separated from
 * `export interface CalendarSyncProvider` by a blank line. A rule that read only
 * the adjacent comment would have found nothing above the very symbol the
 * sentence names, and passed.
 *
 * So the adjacent block is read with blank lines skipped, and any other comment
 * block that mentions the symbol BY NAME is read too. A header that names a
 * symbol and claims callers in the same breath is making the claim about that
 * symbol; the name is what ties the two together and keeps an unrelated
 * paragraph elsewhere in the file from implicating it.
 */
function commentaryFor(lines, declarationLine, name) {
  const chunks = []

  let j = declarationLine - 1
  while (j >= 0 && lines[j].trim() === "") j -= 1
  const end = j
  while (j >= 0 && /^\s*(\*|\/\*|\/\/)/.test(lines[j])) j -= 1
  if (end > j) chunks.push(lines.slice(j + 1, end + 1).join("\n"))

  let block = null
  for (const line of lines) {
    const isComment = /^\s*(\*|\/\*|\/\/)/.test(line)
    if (isComment) {
      block = block ? `${block}\n${line}` : line
      continue
    }
    if (block) {
      if (new RegExp(String.raw`\b${name}\b`).test(block)) chunks.push(block)
      block = null
    }
  }
  if (block && new RegExp(String.raw`\b${name}\b`).test(block)) chunks.push(block)

  return chunks.join("\n")
}

/** Files whose claim is allowed to stand without a reference, and why. */
const CALLER_CLAIM_EXEMPT = new Map()

test("no exported symbol claims a caller that does not exist", () => {
  const libFiles = sourceFiles(`${CELL_ROOT}/lib`).filter(
    (f) => !/\.(test|itest|spec)\.tsx?$/.test(f),
  )
  /**
   * Every place a real reference could live — deliberately NOT `tests/`.
   *
   * The monorepo-level suites are `.mjs` text scanners with no TypeScript
   * loader (`tools/run-platform-tests.mjs`), so they cannot import a symbol;
   * a name appearing there is prose about it. That is not a hypothetical: THIS
   * file's own header names `CalendarSyncProvider` while explaining why it was
   * deleted, and counting that as a reference made the rule certify the exact
   * dead seam it exists to catch. A guard whose documentation keeps its subject
   * alive is a guard that can never fire.
   *
   * `apps/` is included whole, so an `e2e/` spec or a script referencing a
   * symbol does count — those are real importers.
   *
   * Matches are then filtered to SOURCE extensions for the same reason one more
   * time. `tools/loop/*.json` are the orchestrator's survey files: they quote
   * source text verbatim, so every symbol this rule is about appears in them,
   * and counting a quotation as a reference certified the dead seam a second
   * way. A `.json` file imports nothing.
   */
  const searchRoots = ["apps", "packages", "modules", "blueprints", "tools"]
  const IMPORTABLE = /\.(ts|tsx|mjs|cjs|jsx?)$/

  let scanned = 0
  const offenders = []

  for (const file of libFiles) {
    if (CALLER_CLAIM_EXEMPT.has(file)) continue
    const lines = readIfPresent(file).split("\n")

    for (let i = 0; i < lines.length; i += 1) {
      const match = EXPORTED.exec(lines[i])
      if (!match) continue
      scanned += 1

      const doc = commentaryFor(lines, i, match[1])
      if (!CLAIMS_A_CALLER.some((re) => re.test(doc))) continue

      let found = ""
      try {
        /*
         * `--untracked`, and it is the same word this file's header already
         * used: "`git grep -w` over every tracked and untracked source file is
         * the same evidence a reviewer would gather". It was not. `sourceFiles`
         * lists claims with `--others`, so an untracked module is SCANNED for a
         * claim, while a bare `git grep` searches only what is committed — so
         * an untracked CALLER did not count. The two halves disagreed about
         * which files exist, and the asymmetry only ever fires one way: it
         * reports a live symbol as dead.
         *
         * `apps/web/src/lib/connections/pending-intent.ts` is what found it.
         * `openConnectionOpportunity` has exactly one production caller,
         * `apps/web/src/app/api/connections/opportunity/route.ts`, and both
         * files are new — so the claim was read and the caller was invisible.
         */
        found = execFileSync(
          "git",
          ["grep", "--untracked", "-l", "-w", match[1], "--", ...searchRoots],
          { cwd: ROOT, encoding: "utf8" },
        )
      } catch {
        found = "" // git grep exits 1 when it matches nothing
      }
      const elsewhere = found
        .split("\n")
        .filter(Boolean)
        .filter((f) => f !== file && IMPORTABLE.test(f))
      if (elsewhere.length === 0) {
        offenders.push(`${file}:${i + 1} — ${match[1]} is referenced nowhere outside its own file`)
      }
    }
  }

  assert.ok(scanned > 200, `only ${scanned} exports scanned — the parser is broken, not the code`)

  assert.deepEqual(
    offenders,
    [],
    `a doc comment claims callers for a symbol nothing references:\n  ${offenders.join("\n  ")}\n\n` +
      `Either wire it to the caller the comment describes, or delete both. A seam with no ` +
      `implementer and no caller is a design somebody will read as shipped — which is exactly ` +
      `what CalendarSyncProvider, IcsFeedSync, calendarSync() and setCalendarSyncProvider() were.`,
  )
})

test("the exemption list is reasoned and has not grown silently", () => {
  for (const [file, why] of CALLER_CLAIM_EXEMPT) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is exempt but does not exist`)
    assert.ok(why.length > 40, `${file} is exempt without a real reason`)
  }
  assert.equal(CALLER_CLAIM_EXEMPT.size, 0, "a file was exempted from the caller-claim rule")
})
