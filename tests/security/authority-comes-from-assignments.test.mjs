import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * GE-051-006 — authority comes from an assignment, and from nothing that looks
 * like one.
 *
 * Bible §"Decisions" 3: authority "comes from an active, scoped assignment or
 * explicit delegation, not from a title string, email domain, Cognito group, or
 * UI state."
 *
 * Every one of those four is a shortcut that works. That is what makes them
 * dangerous — none of them is a bug on the day it is written:
 *
 *   - **A title string** works until a tenant renames Treasurer to Finance
 *     Lead, and then it fails open or closed depending on which way the
 *     comparison ran.
 *   - **An email domain** works until somebody's address changes, or a partner
 *     institution shares one, or an attacker registers a lookalike.
 *   - **A Cognito group** works until somebody edits the group in the console,
 *     which is a place with different approvals and no effective dating.
 *   - **UI state** works until somebody sends the request without the UI.
 *
 * All four also share the property that the resulting grant has no start date,
 * no end date and no record of who conferred it — so it cannot be reviewed,
 * cannot expire, and does not appear in any answer to "what could this person
 * do in March".
 *
 * The codebase is clean on all four today. This is the test that keeps it that
 * way, which is the whole of what the item asks for.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/** Where authorization can actually be decided: server code, not markup. */
const SCANNED = ["apps/web/src", "packages", "apps/system-studio/src"]

/**
 * Files allowed to contain a pattern, and why.
 *
 * Named and reasoned. Every one is asserted to still exist, so an exemption
 * cannot outlive the file it excused.
 */
const EXEMPT = {
  "apps/web/src/lib/clubs.ts":
    "Builds a slug from a seat title for display and URLs. It decides what a link says, never " +
    "what anybody may do, and the comparison is against the platform's own seeded title rather " +
    "than a tenant's word for it.",
  "packages/identity/src/provider.ts":
    "Declares IGNORED_CLAIMS — the list of group and role claims the platform refuses to read. " +
    "The names appear here precisely because this is the module that throws them away.",
}

const PATTERNS = [
  {
    id: "title-string",
    // `roleName === "President"`, `role.name.includes("Treasurer")`. A seat's
    // title is a tenant's word for it and changes without notice.
    re: /\b(?:roleName|role\.name|seatName|title)\s*(?:===|==|!==|!=)\s*["'`]|\b(?:roleName|role\.name|seatName)\s*\.\s*(?:includes|startsWith|endsWith)\s*\(\s*["'`]/,
    why: "authority read from a seat title",
  },
  {
    id: "email-domain",
    // `email.endsWith("@x.edu")`, `email.split("@")[1] === ...`. Not the same as
    // an email *appearing* — a placeholder or a contact address is fine, and
    // `split("@")[0]` is the local part, which several places use as a default
    // display name when creating a person and which decides nothing.
    re: /\bemail\b[^\n]{0,40}\.(?:endsWith|startsWith|includes)\s*\(\s*["'`]@|\bemail\b[^\n]{0,20}\.split\(["'`]@["'`]\)\s*\[\s*1\s*\]/,
    why: "authority read from an email domain",
  },
  {
    id: "provider-group",
    // Reading a group claim at all, outside the module that refuses them.
    re: /["'`](?:cognito:groups|cognito:roles|custom:role)["'`]|\bclaims\s*\.\s*groups\b/,
    why: "authority read from a provider group claim",
  },
  {
    id: "ui-state",
    // A server path taking the *caller's own* authority from the request.
    //
    // Deliberately not `role` or `scope`. A form saying which role to grant
    // somebody is the ordinary shape of an assignment screen, and the caller's
    // authority to make that grant is checked separately. What is never
    // legitimate is the browser telling the server what the browser may do.
    // Any receiver, because the variable holding the request payload is named
    // whatever the author felt like — `f`, `data`, `input`. Anchoring on the
    // receiver made the detector depend on a naming convention nobody agreed
    // to, which is how a guard passes on code it was written to catch.
    re: /\.\s*get\s*\(\s*["'`](?:capability|capabilities|permission|permissions|isAdmin|canApprove|canManage)["'`]/,
    why: "authority read from a value the browser supplied",
  },
]

function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "generated") {
        continue
      }
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.[cm]?tsx?$/.test(entry.name) && !/\.(test|itest|spec)\.[cm]?tsx?$/.test(entry.name)) {
        out.push(full)
      }
    }
  }
  for (const dir of SCANNED) {
    const abs = path.join(ROOT, dir)
    if (fs.existsSync(abs)) walk(abs)
  }
  return out
}

/** Shared by the real scan and its self-test, so a blind detector fails a test. */
export function shortcuts(lines, where) {
  const found = []
  lines.forEach((line, i) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return // prose about the rule is not the rule
    for (const pattern of PATTERNS) {
      if (pattern.re.test(line)) {
        found.push({ id: pattern.id, at: `${where}:${i + 1}`, why: pattern.why, line: line.trim().slice(0, 90) })
      }
    }
  })
  return found
}

test("each detector catches its own shortcut and leaves ordinary code alone", () => {
  const caught = shortcuts(
    [
      '  if (roleName === "President") return true',
      '  if (email.endsWith("@rochester.edu")) grant()',
      '  const groups = token["cognito:groups"]',
      '  const allowed = formData.get("capabilities")',
      // Ordinary code the detectors must leave alone. `role` from a form is an
      // assignment screen saying which role to grant, not the caller claiming
      // one; `split("@")[0]` is a display name; a placeholder is markup.
      '  const role = formData.get("role")',
      '  const note = formData.get("note")',
      '  create: { email, name: email.split("@")[0] },',
      '  <input placeholder="student@rochester.edu" />',
      '  const label = seatTitle(role)',
    ],
    "synthetic",
  )
  assert.deepEqual(
    caught.map((c) => c.id),
    ["title-string", "email-domain", "provider-group", "ui-state"],
    `expected one hit per detector and nothing else, got ${JSON.stringify(caught, null, 2)}`,
  )
})

test("prose describing the rule is not mistaken for the rule", () => {
  // Otherwise this file, and every comment explaining why the shortcut is
  // forbidden, becomes a violation of itself.
  const caught = shortcuts(
    [
      '  // never do `roleName === "President"`',
      '   * authority must not come from `cognito:groups`',
      '  /* if (email.endsWith("@x.edu")) */',
    ],
    "synthetic",
  )
  assert.deepEqual(caught, [])
})

test("the scan reaches the code that could do this", () => {
  const files = sourceFiles()
  assert.ok(
    files.length >= 200,
    `Scanned ${files.length} source files, expected at least 200. A scan that stops finding ` +
      `files reports no violations and passes.`,
  )
  for (const dir of SCANNED) {
    assert.ok(
      files.some((f) => path.relative(ROOT, f).split(path.sep).join("/").startsWith(dir)),
      `Nothing under "${dir}" was scanned.`,
    )
  }
})

test("no authorization is decided from a title, a domain, a group claim or the browser", () => {
  const violations = []
  for (const file of sourceFiles()) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/")
    if (rel in EXEMPT) continue
    const lines = fs.readFileSync(file, "utf8").split(String.fromCharCode(10))
    violations.push(...shortcuts(lines, rel))
  }

  assert.deepEqual(
    violations.map((v) => `${v.at} — ${v.why}: ${v.line}`),
    [],
    "Authority is being read from something that is not an assignment:" +
      String.fromCharCode(10) +
      violations.map((v) => `  ${v.at} — ${v.why}`).join(String.fromCharCode(10)) +
      String.fromCharCode(10) +
      "All four shortcuts produce a grant with no start date, no end date and no record of who " +
      "conferred it. Decide it from a seat assignment or a delegation, both of which are dated " +
      "and reviewable.",
  )
})

/**
 * Everything wrong with the exemption list.
 *
 * Extracted so the self-test below exercises it. An exemption check only ever
 * run against a currently-correct list is a check nobody has seen work.
 */
export function exemptionProblems(exempt, exists, tripsDetector) {
  const problems = []
  for (const [file, reason] of Object.entries(exempt)) {
    if (!exists(file)) {
      problems.push(
        `"${file}" is exempted and does not exist. An exemption outliving the thing it excused ` +
          `is a hole nobody knows is open.`,
      )
      continue
    }
    if ((reason ?? "").length <= 80) {
      problems.push(
        `"${file}" is excused with ${(reason ?? "").length} characters. An exemption nobody ` +
          `explained is one nobody can argue with.`,
      )
    }
    if (!tripsDetector(file)) {
      problems.push(
        `"${file}" is exempted and no longer trips any detector. Remove it — an exemption that ` +
          `is not needed is one that will quietly cover the next real violation.`,
      )
    }
  }
  return problems
}

test("the exemption check catches a missing file, a thin reason and a stale entry", () => {
  const long = "x".repeat(81)
  assert.deepEqual(exemptionProblems({ a: long }, () => true, () => true), [])
  assert.match(
    exemptionProblems({ a: long }, () => false, () => true).join(" "),
    /does not exist/,
  )
  assert.match(exemptionProblems({ a: "short" }, () => true, () => true).join(" "), /nobody/)
  assert.match(
    exemptionProblems({ a: long }, () => true, () => false).join(" "),
    /no longer trips/,
  )
})

test("every exemption names a real file, says why, and is still needed", () => {
  assert.ok(Object.keys(EXEMPT).length > 0, "Nothing is exempted, so this proves nothing.")
  assert.deepEqual(
    exemptionProblems(
      EXEMPT,
      (file) => fs.existsSync(path.join(ROOT, file)),
      (file) =>
        shortcuts(
          fs.readFileSync(path.join(ROOT, file), "utf8").split(String.fromCharCode(10)),
          file,
        ).length > 0,
    ),
    [],
  )
})
