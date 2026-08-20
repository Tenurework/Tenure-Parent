import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { SNAPSHOT as BASELINE_SNAPSHOT, SOURCE_REF, readBlobs } from "../../tools/simon-absorption-inventory.mjs"
import {
  AXES,
  DOC,
  EVENT_KINDS,
  HTTP_METHODS,
  PERMISSION_NAME,
  ROLE_ENUM,
  ROOT,
  SNAPSHOT,
  STATES,
  WORKFLOW_ENUM,
  commitOf,
  render,
} from "../../tools/simon-mapping-matrices.mjs"

/**
 * SIMON-000-015 — the route/API/event/workflow/permission/role/report/integration
 * mapping matrices.
 *
 * The rule the rest of this family is kept under: nothing below re-runs the
 * generator's decision and agrees with itself. Route URLs are re-derived from
 * the cited paths with this file's OWN derivation, states are re-decided from
 * the file counts and from digests this file computes, and the two enumeration
 * axes are re-read out of the schema at the pinned commit.
 *
 * Neither pinned commit is present on every machine — the source pin lives only
 * in a clone that has `live` fetched, and `actions/checkout@v4` clones at depth
 * 1 — so every git-backed check degrades to a diagnostic there and every case
 * carries checks that need no git at all. "We could not look" and "we looked and
 * found nothing" are different answers.
 */

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
const snapshot = JSON.parse(read(SNAPSHOT))
const baseline = JSON.parse(read(BASELINE_SNAPSHOT))
const allRows = AXES.flatMap((a) => snapshot.matrices[a.key])

const digest = (text) => crypto.createHash("sha256").update(text.split("\r\n").join("\n"), "utf8").digest("hex").slice(0, 16)

const blobsOrSkip = (t, which, commit, files) => {
  const got = readBlobs(commit, files)
  if (got.size === 0 && files.length > 0) {
    t.diagnostic(
      `${which}: no blob is readable at ${commit} in this clone (CI checks out at depth 1, and ` +
        `${SOURCE_REF} is only present where \`git fetch live\` has run). Re-derivation from git ` +
        `skipped; the snapshot-internal checks in this case still ran.`,
    )
    return null
  }
  return got
}

test("the document is exactly what the snapshot renders", () => {
  assert.equal(render(snapshot), read(DOC))
})

test("both sides are the commits the baseline pinned, not commits re-resolved here", () => {
  assert.equal(snapshot.source.pinned_commit, commitOf(baseline.source))
  assert.equal(snapshot.target.pinned_commit, commitOf(baseline.target))
  assert.match(snapshot.source.pinned_commit, /^[0-9a-f]{40}$/)
  assert.match(snapshot.target.pinned_commit, /^[0-9a-f]{40}$/)
  assert.notEqual(snapshot.source.pinned_commit, snapshot.target.pinned_commit)
  assert.equal(snapshot.source.unknown, null, "the source tree was not read; every row would be a false TARGET ONLY")
  assert.equal(snapshot.target.unknown, null)
})

test("all eight matrices the requirement names exist and none is empty", () => {
  // The requirement's own sentence, noun by noun. A matrix that renders as an
  // empty table is the failure this case exists to catch: the SIMON-000-004
  // review overturned a claim precisely because one of its rows read zero while
  // the tree carried the thing the row was for.
  const nouns = ["route", "API", "event", "workflow", "permission", "role", "report", "integration"]
  assert.deepEqual(AXES.map((a) => a.axis), nouns)
  for (const a of AXES) {
    const rows = snapshot.matrices[a.key]
    assert.ok(Array.isArray(rows) && rows.length > 0, `the ${a.axis} matrix is empty`)
    assert.equal(snapshot.totals[a.key].rows, rows.length)
    for (const state of STATES)
      assert.equal(snapshot.totals[a.key][state], rows.filter((r) => r.state === state).length, `${a.axis}/${state} roll-up`)
  }
  // Identities are keys: one row each, per matrix.
  for (const a of AXES) {
    const ids = snapshot.matrices[a.key].map((r) => r.identity)
    assert.equal(ids.length, new Set(ids).size, `the ${a.axis} matrix carries the same identity twice`)
  }
})

test("every state is one of the four, and it is the state the two file lists give", () => {
  // Re-decided here from the counts, with the rule written out again, so a
  // mutation inside the generator cannot move both sides at once.
  const problems = []
  for (const r of allRows) {
    if (!STATES.includes(r.state)) problems.push(`${r.axis}/${r.identity}: state "${r.state}" is not one of the four`)
    const hasSource = r.source_file_count > 0
    const hasTarget = r.target_file_count > 0
    if (!hasSource && !hasTarget) problems.push(`${r.axis}/${r.identity}: a row backed by no file on either side`)
    if (hasSource && !hasTarget && r.state !== "SOURCE ONLY") problems.push(`${r.axis}/${r.identity}: only the pilot backs it and it says ${r.state}`)
    if (!hasSource && hasTarget && r.state !== "TARGET ONLY") problems.push(`${r.axis}/${r.identity}: only this repository backs it and it says ${r.state}`)
    if (hasSource && hasTarget && !r.state.startsWith("BOTH")) problems.push(`${r.axis}/${r.identity}: both sides back it and it says ${r.state}`)
    if (r.state === "SOURCE ONLY" && r.target_files.length) problems.push(`${r.axis}/${r.identity}: SOURCE ONLY with target files`)
    if (r.state === "TARGET ONLY" && r.source_files.length) problems.push(`${r.axis}/${r.identity}: TARGET ONLY with source files`)
    // A declaration-compared row is an enumeration member and nothing else.
    if (r.compare === "declaration" && !["workflow", "role"].includes(r.axis))
      problems.push(`${r.axis}/${r.identity}: compared as a declaration, which only the two enumeration axes may be`)
  }
  assert.deepEqual(problems, [], problems.slice(0, 12).join("\n  "))
  // Non-vacuity: the matrices really do carry each of the four states somewhere,
  // so the rule above is being exercised rather than trivially satisfied.
  for (const state of STATES)
    assert.ok(allRows.some((r) => r.state === state), `no row anywhere is ${state} — the state machine has collapsed`)
})

test("every path any row cites is in that side's baseline file list", () => {
  const inSource = new Set(baseline.source.files)
  const inTarget = new Set(baseline.target.files)
  const problems = []
  for (const r of allRows) {
    for (const f of r.source_files) if (!inSource.has(f)) problems.push(`${r.axis}/${r.identity}: source cites ${f}`)
    for (const f of r.target_files) if (!inTarget.has(f)) problems.push(`${r.axis}/${r.identity}: target cites ${f}`)
    if (r.source_files.length > r.source_file_count) problems.push(`${r.axis}/${r.identity}: more source examples than files`)
    if (r.target_files.length > r.target_file_count) problems.push(`${r.axis}/${r.identity}: more target examples than files`)
    for (const f of [...r.source_files, ...r.target_files])
      if (/^Tier1\//.test(f)) problems.push(`${r.axis}/${r.identity}: cites ${f}, which is never opened`)
  }
  assert.deepEqual(problems, [], problems.slice(0, 12).join("\n  "))
})

test("a route identity is the URL its own path answers on, derived again here", () => {
  // An independent derivation: drop the app prefix and the file name, drop the
  // (group) segments, keep [param]. If this disagrees with the generator, one of
  // the two is wrong and the matrix is keyed on something that is not a URL.
  const urlOf = (file) => {
    const m = file.match(/^apps\/(web|system-studio)\/src\/app\/(.*)$/)
    if (!m) return null
    const segments = m[2]
      .split("/")
      .slice(0, -1)
      .filter((s) => s.length && !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("_"))
    return `${m[1]} /${segments.join("/")}`
  }
  const problems = []
  for (const r of snapshot.matrices.routes) {
    for (const f of [...r.source_files, ...r.target_files]) {
      assert.match(f, /\/page\.tsx?$/, `${r.identity} is backed by ${f}, which is not a page`)
      const got = urlOf(f)
      if (got !== r.identity) problems.push(`${f} answers on ${got}, and the row says ${r.identity}`)
    }
  }
  assert.deepEqual(problems, [], problems.slice(0, 12).join("\n  "))
  // The routing group really is dropped: every web route in this platform lives
  // under a group, so if groups leaked into the URL every identity would carry one.
  assert.ok(
    snapshot.matrices.routes.some((r) => r.identity === "web /dashboard"),
    "web /dashboard is not a route — the (app) routing group is leaking into the URL",
  )
  for (const r of snapshot.matrices.routes) assert.ok(!/[()]/.test(r.identity), `${r.identity} carries a routing group`)
})

test("an API identity is a real HTTP method on the URL its own handler answers on", () => {
  const problems = []
  for (const r of snapshot.matrices.apis) {
    const [method, url] = r.identity.split(" ")
    if (!HTTP_METHODS.includes(method) && method !== "NONE-EXPORTED") problems.push(`${r.identity}: ${method} is not an HTTP method`)
    for (const f of [...r.source_files, ...r.target_files]) {
      assert.match(f, /\/app\/api\/.*\/route\.tsx?$/, `${r.identity} is backed by ${f}, which is not a route handler`)
      if (!f.includes(url.replace(/^\//, "") + "/route.")) problems.push(`${r.identity}: ${f} does not answer on ${url}`)
    }
  }
  assert.deepEqual(problems, [], problems.slice(0, 12).join("\n  "))
  assert.ok(
    snapshot.matrices.apis.some((r) => r.identity.startsWith("GET ")) && snapshot.matrices.apis.some((r) => r.identity.startsWith("POST ")),
    "the API matrix carries no GET or no POST — the method scan is broken, not the tree",
  )
  // The named site, because "the matrix has methods" is satisfiable by noise.
  // Both trees mount NextAuth's catch-all as `export const { GET, POST } =
  // handlers`, a form the first version of this scan could not read at all — so
  // the endpoint every session in the platform depends on read `NONE-EXPORTED`.
  for (const method of ["GET", "POST"]) {
    const row = snapshot.matrices.apis.find((r) => r.identity === `${method} /api/auth/[...nextauth]`)
    assert.ok(row, `${method} on the NextAuth catch-all is in neither tree's API matrix`)
    assert.ok(row.source_file_count > 0 && row.target_file_count > 0, `${method} on the NextAuth catch-all is missing from a side`)
  }
  assert.ok(
    !snapshot.matrices.apis.some((r) => r.identity.startsWith("NONE-EXPORTED /api/auth/")),
    "an auth endpoint reads NONE-EXPORTED — the destructured-export form is not being read",
  )
})

test("every permission name really is one the stated selector admits", () => {
  const selector = new RegExp(PERMISSION_NAME.source, PERMISSION_NAME.flags)
  for (const r of snapshot.matrices.permissions) {
    assert.ok(selector.test(r.identity), `${r.identity} is in the permission matrix and the selector does not admit it`)
    for (const f of [...r.source_files, ...r.target_files])
      assert.match(f, /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, `${r.identity} is backed by ${f}, which is not a module`)
  }
  // The selector is a list of deciding verbs, not a substring search: a name
  // that merely mentions approvals is not a permission.
  assert.ok(!selector.test("APPROVAL_DIGEST_FIELDS"), "the selector admits a constant that decides nothing")
  assert.ok(!selector.test("approvalSummary"), "the selector admits a plain query")
  assert.ok(selector.test("canViewApproval") && selector.test("assertTenant") && selector.test("isFinanceRole"))
  // Corroborated across artifacts: the concept analysis found these two
  // source-only exports independently, from a different scan, in SIMON-000-005.
  for (const name of ["canViewApproval", "isFinanceRole"]) {
    const row = snapshot.matrices.permissions.find((r) => r.identity === name)
    assert.ok(row, `${name} is not in the permission matrix`)
    assert.equal(row.state, "SOURCE ONLY", `${name} is a pilot-only authorization export and the matrix says ${row.state}`)
  }
})

test("the report and integration matrices are searches that ran", () => {
  for (const r of snapshot.matrices.reports)
    for (const f of [...r.source_files, ...r.target_files]) assert.match(f, /report/i, `${r.identity} cites ${f}, which is not a report path`)
  const providers = snapshot.selectors.integrations.map((i) => i.provider)
  for (const r of snapshot.matrices.integrations)
    assert.ok(providers.includes(r.identity), `${r.identity} is not one of the declared providers`)
  // The finding this matrix exists to make visible, re-checkable from the
  // pilot's own manifest: the pilot integrates with S3 and not with SES, SQS,
  // Cognito or Stripe. Those are absorption items, not assumptions.
  const s3 = snapshot.matrices.integrations.find((r) => r.identity === "Amazon S3 (object storage)")
  assert.ok(s3 && s3.source_file_count > 0, "the pilot's S3 integration is located by nothing")
  for (const p of ["Amazon SES (email)", "Amazon SQS (queue)", "Stripe (payments)"]) {
    const row = snapshot.matrices.integrations.find((r) => r.identity === p)
    if (row) assert.equal(row.state, "TARGET ONLY", `${p} is reported as ${row.state}`)
  }
})

test("the event matrix reports each kind it probed, including the zeros", () => {
  for (const which of ["source", "target"]) {
    const kinds = snapshot[which].event_kinds
    assert.ok(kinds, `the ${which} side records no event-kind counts`)
    assert.deepEqual(Object.keys(kinds).sort(), [...EVENT_KINDS].sort())
    const rows = snapshot.matrices.events.filter((r) => (which === "source" ? r.source_file_count : r.target_file_count) > 0)
    const total = Object.values(kinds).reduce((n, x) => n + x, 0)
    assert.ok(total >= rows.length, `${which}: ${rows.length} rows are backed and only ${total} were found`)
  }
  // A zero is a claim, and this is the one that is currently zero: neither tree
  // schedules anything from GitHub Actions. If that changes the row fills in.
  assert.equal(snapshot.source.event_kinds["workflow cron"], 0)
  assert.ok(snapshot.source.event_kinds["queue or rule"] > 0, "the pilot deploys no queue at all — the Terraform scan is broken")
})

test("the two enumeration matrices re-read from the schemas at the pinned commits", (t) => {
  // These are the two axes compared as DECLARATIONS rather than through the
  // digest of the schema file, so this is where that rule is checked against
  // the schemas themselves.
  const schemaPath = "apps/web/prisma/schema.prisma"
  let checked = 0
  for (const [which, commit] of [
    ["source", snapshot.source.pinned_commit],
    ["target", snapshot.target.pinned_commit],
  ]) {
    const blobs = blobsOrSkip(t, which, commit, [schemaPath])
    if (!blobs) continue
    const text = blobs.get(schemaPath)
    assert.ok(text, `${schemaPath} is missing at ${commit} although other blobs read`)
    // This file's own enum read, deliberately simpler than the generator's.
    const declared = new Map()
    let open = null
    for (const raw of text.split("\r\n").join("\n").split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim()
      const m = line.match(/^enum\s+([A-Za-z0-9_]+)\s*\{/)
      if (m) { open = m[1]; declared.set(open, []); continue }
      if (!open) continue
      if (line.startsWith("}")) { open = null; continue }
      const v = line.match(/^([A-Za-z0-9_]+)\s*$/)
      if (v) declared.get(open).push(v[1])
    }
    for (const [axis, select] of [["workflow_states", WORKFLOW_ENUM], ["roles", ROLE_ENUM]]) {
      const want = []
      for (const [name, members] of declared) if (select.test(name)) for (const member of members) want.push(`${name}.${member}`)
      const got = snapshot.matrices[axis]
        .filter((r) => (which === "source" ? r.source_file_count : r.target_file_count) > 0)
        .map((r) => r.identity)
      assert.deepEqual(got.slice().sort(), want.slice().sort(), `${which}/${axis} is not what the schema declares`)
    }
    checked += 1
  }
  t.diagnostic(`${checked} of 2 schemas re-read from git in this environment`)
  // Runs everywhere: every enumeration row names an enum its selector admits.
  for (const r of snapshot.matrices.workflow_states) assert.match(r.identity.split(".")[0], WORKFLOW_ENUM)
  for (const r of snapshot.matrices.roles) assert.match(r.identity.split(".")[0], ROLE_ENUM)
  // The six the SIMON-000-004 review named by name, spanning BOTH declared
  // enumerations. Naming only the `InstitutionRole` three would let a selector
  // narrowed to /Role$/ drop `RoleScope` entirely and still pass, because the
  // re-derivation above uses the selector it is checking.
  for (const name of ["OSE_DIRECTOR", "OSE_STAFF", "OSE_ADVISOR", "PRESIDENT", "FUNCTIONAL", "MEMBER"])
    assert.ok(
      snapshot.matrices.roles.some((r) => r.identity.endsWith(`.${name}`)),
      `${name} is a role in both trees and the role matrix does not carry it`,
    )
  // Same argument on the workflow axis: two enumerations, named.
  for (const identity of ["ApprovalStatus.PENDING_OSE", "EventStatus.PENDING_APPROVAL", "RoleTransferStatus.PENDING"])
    assert.ok(
      snapshot.matrices.workflow_states.some((r) => r.identity === identity),
      `${identity} is a declared workflow state and the matrix does not carry it`,
    )
})

test("a BOTH row's verdict re-derives from digests computed here", (t) => {
  // The claim that costs the most if it is wrong — "the target already holds the
  // pilot's implementation" — so it is recomputed rather than trusted, for every
  // row whose backing file list is complete rather than truncated.
  const complete = allRows.filter(
    (r) =>
      r.compare === "files" &&
      r.state.startsWith("BOTH") &&
      r.source_files.length === r.source_file_count &&
      r.target_files.length === r.target_file_count,
  )
  const paths = [...new Set(complete.flatMap((r) => [...r.source_files, ...r.target_files]))].sort()
  const sourceBlobs = blobsOrSkip(t, "source", snapshot.source.pinned_commit, paths)
  const targetBlobs = sourceBlobs ? blobsOrSkip(t, "target", snapshot.target.pinned_commit, paths) : null
  if (!sourceBlobs || !targetBlobs) {
    // Git-free fallback: a BOTH row must still cite files on both sides.
    for (const r of complete) assert.ok(r.source_files.length && r.target_files.length, `${r.axis}/${r.identity}: a BOTH row citing one side`)
    return
  }
  const problems = []
  let checked = 0
  for (const r of complete) {
    const shared = r.source_files.filter((f) => r.target_files.includes(f))
    const onlyOneSide = r.source_files.length !== shared.length || r.target_files.length !== shared.length
    let divergent = 0
    let unreadable = 0
    for (const f of shared) {
      const a = sourceBlobs.get(f)
      const b = targetBlobs.get(f)
      if (a === undefined || b === undefined) { unreadable += 1; continue }
      if (digest(a) !== digest(b)) divergent += 1
    }
    if (unreadable) continue
    checked += 1
    const want = !onlyOneSide && divergent === 0 ? "BOTH — same implementation" : "BOTH — differs"
    if (want !== r.state) problems.push(`${r.axis}/${r.identity}: says ${r.state}, ${divergent} of ${shared.length} shared file(s) differ`)
  }
  assert.deepEqual(problems, [], problems.slice(0, 12).join("\n  "))
  assert.ok(checked >= 20, `only ${checked} BOTH rows were recomputed — this case is not exercising anything`)
  t.diagnostic(`${checked} BOTH rows recomputed from git`)
})

test("the artifacts carry no row of anybody's data", () => {
  // Ledger rule 8. This repository is public and the source tree carries a live
  // pilot's real records.
  const text = read(SNAPSHOT) + read(DOC)
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []
  assert.deepEqual(
    emails.filter((e) => !/^@(?:aws-sdk|anthropic-ai|azure|slack|prisma)\//.test(e)),
    [],
    "an email address reached a generated artifact",
  )
})
