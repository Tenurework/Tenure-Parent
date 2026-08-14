#!/usr/bin/env node
/**
 * HCM-000-001 — what people, member, seat, role and onboarding logic actually
 * exists in this repository, and which claims about it are backed.
 *
 * The People, HR and Workforce source document
 * (`Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`) names 45
 * canonical objects and ten core distinctions. This repository has a student
 * organisation roster. Both statements are true, and the distance between them
 * is the thing an inventory is for: not a list of what is missing, which anyone
 * can write from the source document alone, but a list of what is HERE, at a
 * path a reader can open, with the concept it half-serves named next to it.
 *
 * ── Why this is generated and not written ───────────────────────────────────
 *
 * A hand-written inventory is wrong the week after it is written and cannot be
 * distinguished from a correct one by reading it. Every row below is either
 *
 *   * DERIVED from the tree — the models in `schema.prisma`, the models that
 *     carry a relation into the workforce core, the symbols
 *     `@tenure/organization-model` exports, and who imports them; or
 *   * DECLARED here and VERIFIED against the tree — a path that must exist and
 *     an anchor string that must appear inside it.
 *
 * So corrupting one row reds `--check`. That is the difference between an
 * inventory and a paragraph, and it is the only reason this file is executable
 * rather than markdown.
 *
 * ── Byte-identical on Linux and Windows ─────────────────────────────────────
 *
 * Every read is normalised to `\n` BEFORE it is searched or compared, every
 * directory is walked in sorted order, every path is emitted POSIX-normalised,
 * and every table is sorted on a normalised key. The generated document
 * therefore describes the repository and not the checkout — a distinction this
 * repository has been burned by, in `document-graph.mjs` (raw-CRLF hashing) and
 * in `ownership-map.mjs` (native-separator sorting), both of which produced a
 * file that was current locally and stale in CI.
 *
 * Nothing here is a claim about capability. `PARTIAL` means a table or a module
 * exists that a reader could mistake for the object; it does not mean the
 * object works.
 *
 * Usage:  node tools/hcm-people-inventory.mjs [--check]
 *   --check  exit non-zero if the committed document is stale or a row no
 *            longer verifies.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")

export const OUT = "docs/architecture/hcm-people-inventory.md"
export const SCHEMA = "apps/web/prisma/schema.prisma"
export const SOURCE_DOC = "Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md"
export const ORG_MODEL_INDEX = "packages/organization-model/src/index.ts"

/** POSIX-normalised repository-relative path. Never a native separator. */
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/")

/**
 * Read normalised. CRLF is a property of the checkout, not of the file, and
 * every comparison below would otherwise be platform-dependent.
 */
export function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").split("\r\n").join("\n")
}

export const exists = (relPath) => fs.existsSync(path.join(ROOT, relPath))

/**
 * Does this file still contain this anchor, as a token rather than a substring?
 *
 * `includes()` was the first version and it could not fail in the one direction
 * that matters. Renaming `releaseToSuccessor` to `releaseToSuccessorRENAMED`
 * leaves the substring intact, so the anchor check stayed green through a
 * mutation that removed the exported symbol the row is about — a guard reading
 * GREEN over a repository that had changed underneath it.
 *
 * So an anchor that begins or ends with a word character is bounded on that
 * side. Prose anchors ending in `.` are bounded only on the left, which is
 * correct: a sentence is not extended by suffixing an identifier to it.
 */
export function anchorPresent(text, anchor) {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const left = /[\w$]/.test(anchor[0]) ? "(?<![\\w$])" : ""
  const right = /[\w$]/.test(anchor[anchor.length - 1]) ? "(?![\\w$])" : ""
  return new RegExp(`${left}${escaped}${right}`).test(text)
}

// ── Derivation 1: the models, and which of them touch the workforce core ─────

/**
 * The four tables that ARE the workforce core here. `User` is deliberately not
 * one of them: it is the tenant-wide principal, every domain in the platform
 * legitimately points at it, and including it would classify messaging and
 * notifications as people logic.
 */
export const WORKFORCE_CORE = ["DirectoryPerson", "InstitutionMembership", "Role", "Seat"]

/** Every `model X { … }` in the Prisma schema, in declaration order. */
export function prismaModels(text = read(SCHEMA)) {
  const out = []
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)\n\}/gm
  let m
  while ((m = re.exec(text)) !== null) out.push({ name: m[1], body: m[2] })
  return out
}

/**
 * Models that declare a relation INTO the workforce core — the owning side of
 * the foreign key, which is the direction that means "this row is about a
 * person's place in the organisation".
 */
export function coreLinkedModels(models = prismaModels()) {
  const out = []
  for (const { name, body } of models) {
    const hits = new Set()
    for (const line of body.split("\n")) {
      if (!line.includes("@relation")) continue
      for (const c of WORKFORCE_CORE) if (new RegExp(`\\b${c}\\b`).test(line)) hits.add(c)
    }
    if (hits.size > 0) out.push({ name, links: [...hits].sort() })
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1))
}

/**
 * The classification. Every model that is core, or links into the core, must
 * appear in exactly one of these two tables — that is the completeness property
 * the guard holds, and it is why a new table hung off `Seat` cannot be added
 * without somebody deciding whether it is people logic.
 */
export const PEOPLE_MODELS = [
  ["DirectoryPerson", "Person", "The roster of real people, seeded from the office spreadsheets. Name, email, kind, affiliation — no identity resolution, no privacy subject, no duplicate handling."],
  ["InstitutionMembership", "Member", "Membership of an institution with a role, a status and an effective window (`effectiveFrom`/`effectiveUntil`/`status`). The closest thing here to an employment relationship, and it is not one."],
  ["Role", "Job + Seat, conflated", "Carries the seat's title AND the authority it confers (`templateKey`). The source document keeps `Job` (reusable classification) and `Seat` (durable responsibility) apart; this row is both."],
  ["Seat", "Position / Seat", "The durable position, split out of `Role` so renaming a title cannot move authority. Effective-dated: `effectiveFrom`, `effectiveUntil`, `retiredAt`, plus `positionCode`."],
  ["SeatHolding", "Assignment (term-grained)", "Who held a seat in an academic year — `term` is a string like \"2026-2027\", not a date range. Past terms are kept rather than overwritten."],
  ["RoleAssignment", "Assignment (date-grained)", "The second, incompatible assignment shape: `startDate`/`endDate` and a SHADOW/ACTIVE/ALUMNI status. Two assignment tables with different time grains is the single largest defect in the people model here."],
  ["OrganizationAdvisor", "Member (advisory)", "A staff advisor attached to an organisation. A relationship, not an assignment: no dates, no status, no authority."],
  ["MemoryRecord", "Seat memory", "Institutional memory attached to a `Role`. This is the mechanism the source document's continuity chapter needs, wired to the conflated row rather than to `Seat`."],
  ["LedgerEntry", "Seat attribution", "Finance rows carry `postedBySeat` and `attributedSeat` so a posting outlives its author. People logic reaching into another domain, deliberately."],
]

export const CORE_LINKED_NOT_PEOPLE = [
  // Nothing today: every model that links into the workforce core is people
  // logic. The table exists so that the first one that is not has a place to be
  // recorded with a reason, rather than being quietly added to PEOPLE_MODELS.
]

/**
 * People-domain tables that do NOT link into the workforce core and so cannot
 * be derived — they hang off `User`. Declared, and verified to exist.
 */
export const PEOPLE_MODELS_OFF_CORE = [
  ["User", "Person (authenticated)", "The second person table. A `User` and a `DirectoryPerson` describing the same human are joined by email and nothing else."],
  ["RoleTransfer", "TransitionPlan", "A person-to-person handover of an institution role with PENDING/COMPLETED/DECLINED/CANCELLED and a `stepDownRole`. Institution-level only — it cannot transfer a club seat."],
  ["ApprovalDelegation", "Delegation", "Temporary scoped authority that is not a new assignment, exactly as the source document requires — for approval gates only."],
]

// ── Derivation 2: the workforce modelling package, and who calls it ──────────

/** Roots scanned for importers. Sorted walk; POSIX paths; TypeScript only. */
const SCAN_ROOTS = ["apps/web/src", "apps/system-studio/src", "packages", "modules", "blueprints"]

export function scannedFiles() {
  const out = []
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel(full))
    }
  }
  for (const r of SCAN_ROOTS) {
    const abs = path.join(ROOT, r)
    if (fs.existsSync(abs)) walk(abs)
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

const isTestFile = (p) => /\.(test|itest|spec)\.tsx?$/.test(p)

/** Symbols re-exported by the package barrel, values and types alike. */
export function organizationModelExports(text = read(ORG_MODEL_INDEX)) {
  const names = new Set()
  const re = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"[^"]+"/g
  let m
  while ((m = re.exec(text)) !== null) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim()
      if (name) names.add(name)
    }
  }
  return [...names].sort()
}

/**
 * Named imports of a module specifier, per importing file.
 *
 * Specifier-based, so a relative import from a sibling directory is not
 * counted. That limit is stated in the generated document rather than papered
 * over: the question this answers is "does anything ACROSS the codebase reach
 * this", and cross-directory imports in this repository are written through the
 * `@/` alias or a `@tenure/` package name.
 */
export function importersOf(specifier, files = scannedFiles()) {
  const out = []
  const re = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*["']${specifier.replace(/[/@]/g, (c) => `\\${c}`)}["']`,
    "g",
  )
  for (const f of files) {
    if (f.startsWith("packages/organization-model/")) continue
    const text = read(f)
    let m
    const names = new Set()
    re.lastIndex = 0
    while ((m = re.exec(text)) !== null) {
      for (const raw of m[1].split(",")) {
        const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim()
        if (name) names.add(name)
      }
    }
    if (names.size > 0) out.push({ file: f, test: isTestFile(f), names: [...names].sort() })
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : 1))
}

// ── Derivation 3: the source document's own object list ─────────────────────

/** The 45 objects §4 names, parsed from the document rather than copied. */
export function canonicalObjects(text = read(SOURCE_DOC)) {
  const line = text.split("\n").find((l) => l.startsWith("At minimum:"))
  if (!line) return []
  return [...line.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1])
}

/** The ten distinctions §2 requires be kept apart. */
export function coreDistinctions(text = read(SOURCE_DOC)) {
  const lines = text.split("\n")
  const start = lines.indexOf("## 2. Core people model")
  const end = lines.indexOf("## 3. Required domain families")
  if (start < 0 || end < 0) return []
  return lines
    .slice(start, end)
    .filter((l) => /^- `/.test(l))
    .map((l) => l.match(/^- `([^`]+)`/)[1])
}

/**
 * Where each canonical object stands. `PRESENT` means a durable record of that
 * object exists and something reads it; `PARTIAL` means something a reader
 * could mistake for it exists; `ABSENT` means nothing does.
 *
 * Every non-ABSENT binding names an evidence path, and the guard opens it.
 */
export const BINDINGS = {
  Person: ["PARTIAL", "apps/web/src/lib/directory.ts", "Two person tables — `DirectoryPerson` and `User` — joined by email. No identity resolution and no privacy subject."],
  Name: ["PARTIAL", SCHEMA, "A single `name String` column. No parts, no locale, no preferred/legal distinction."],
  ContactPoint: ["PARTIAL", SCHEMA, "An `email` column, unique per table. No object, no type, no verification state."],
  Worker: ["ABSENT", "", "No employment relationship to a legal employer exists anywhere in the schema."],
  EmploymentRelationship: ["ABSENT", "", "No legal employer is modelled, so nothing can relate a person to one."],
  Assignment: ["PARTIAL", "packages/organization-model/src/assignment-states.ts", "Two incompatible tables (`RoleAssignment` dates, `SeatHolding` terms) and one unwired state catalogue."],
  Job: ["ABSENT", "", "`Role` carries the title, but there is no reusable classification shared across organisations."],
  JobFamily: ["ABSENT", "", "Nothing groups jobs."],
  Position: ["PARTIAL", "packages/organization-model/src/position-lifecycle.ts", "`Seat` is an effective-dated position with a `positionCode`. No headcount, no FTE, no funding, no hierarchy."],
  Seat: ["PRESENT", "apps/web/src/lib/seat-is-not-a-role.itest.ts", "A durable position separated from the authority it confers, with a test that fails when the two are re-merged."],
  Grade: ["ABSENT", "", "No grade, ladder or rate exists."],
  GradeRate: ["ABSENT", "", "No grade, ladder or rate exists."],
  Location: ["ABSENT", "", "No location table. Events carry a free-text location string."],
  WorkPattern: ["ABSENT", "", "No work pattern, shift or availability model."],
  CollectiveAgreement: ["ABSENT", "", "No union or collective group is modelled."],
  Candidate: ["ABSENT", "", "No recruiting relationship, and no purpose-limited data partition to hold one."],
  Requisition: ["ABSENT", "", "Nothing authorises a vacancy."],
  Application: ["ABSENT", "", "No application record."],
  Interview: ["ABSENT", "", "No interview record."],
  Offer: ["ABSENT", "", "No offer record."],
  OnboardingJourney: ["ABSENT", "", "The handoff page assembles a packet at read time; nothing persists a journey, its tasks or its readiness."],
  TransitionPlan: ["PARTIAL", "apps/web/src/app/(app)/orgs/[slug]/handoff/page.tsx", "A handover packet rendered from live data, plus an unwired `planTermTransition` in the organisation model. `RoleTransfer` covers institution roles only."],
  TimeEntry: ["ABSENT", "", "No time capture of any kind."],
  TimeCard: ["ABSENT", "", "No time capture of any kind."],
  Shift: ["ABSENT", "", "No scheduling model."],
  AbsencePlan: ["ABSENT", "", "No absence or leave model."],
  AbsenceBalance: ["ABSENT", "", "No absence or leave model."],
  LeaveRequest: ["ABSENT", "", "No absence or leave model. `ApprovalRequest` is about club activity, not leave."],
  CompensationElement: ["ABSENT", "", "No compensation model. The platform records club budgets, not pay."],
  CompensationCycle: ["ABSENT", "", "No compensation model."],
  BenefitPlan: ["ABSENT", "", "No benefits model."],
  Enrollment: ["ABSENT", "", "No benefits model."],
  Goal: ["ABSENT", "", "No goals, check-ins or reviews."],
  Review: ["ABSENT", "", "No goals, check-ins or reviews."],
  Feedback: ["ABSENT", "", "No feedback record."],
  Skill: ["ABSENT", "", "No skills, competencies, licences or certifications."],
  Profile: ["ABSENT", "", "No requirement profile separate from a person profile."],
  LearningItem: ["ABSENT", "", "No learning catalogue."],
  LearningAssignment: ["ABSENT", "", "No learning catalogue."],
  SuccessionPlan: ["PARTIAL", "packages/organization-model/src/succession-release.ts", "`planHandover` and `releaseToSuccessor` decide what a successor may inherit — in memory, with no table and no caller."],
  HRCase: ["ABSENT", "", "No confidential case intake, classification or investigation record."],
  PayrollRelationship: ["ABSENT", "", "No payroll object, and the architecture document forbids building one — see the contradiction recorded below."],
  PayrollInput: ["ABSENT", "", "No payroll object."],
  PayrollRunReference: ["ABSENT", "", "No payroll object."],
  WorkforceEvent: ["ABSENT", "", "`AuditEvent` records who did what to a row; it is not a workforce event and carries no effective date."],
}

/** §2's ten distinctions, and whether this repository keeps them apart. */
export const DISTINCTIONS = {
  Person: ["SPLIT WRONGLY", "`DirectoryPerson` and `User` are two person records for one human, joined by email."],
  Worker: ["ABSENT", "No employment relationship exists to distinguish from membership."],
  Member: ["PRESENT", "`InstitutionMembership` with status and an effective window; `packages/identity/src/effective-state.ts` is the one definition of live."],
  Candidate: ["ABSENT", "No recruiting relationship exists."],
  Dependent: ["ABSENT", "No related-person data, and no partition that could hold it."],
  Job: ["CONFLATED", "`Role` is the job classification and the authority grant in one row."],
  Position: ["PRESENT", "`Seat`, separated from `Role` so a rename cannot move authority."],
  Seat: ["PRESENT", "`Seat` plus `MemoryRecord` as the continuity anchor."],
  Assignment: ["SPLIT WRONGLY", "`RoleAssignment` (dates) and `SeatHolding` (academic-year strings) are two answers to one question."],
  Delegation: ["PRESENT", "`ApprovalDelegation` is scoped, revocable and never becomes an assignment."],
}

// ── Declaration 4: modules, verified by anchor ───────────────────────────────

/**
 * [path, anchor, concept, note]. The anchor is a string that must appear in the
 * file. It is what turns "this file is about seats" from an assertion into a
 * check: delete the function and `--check` reds.
 */
export const MODULES = [
  ["apps/web/src/lib/directory.ts", "DirectoryProvider", "Person", "The seam the roster is read through, so an LDAP/SCIM source can replace the seeded spreadsheet."],
  ["apps/web/src/lib/identity/live-membership.ts", "membershipLiveness", "Member", "\"Is a member right now\" as a Prisma `where` fragment, checked against the package definition by its own test."],
  ["apps/web/src/lib/identity/access-report.ts", "accessReportFor", "Member", "What one principal can currently reach, assembled for a privacy answer."],
  ["apps/web/src/lib/seat-is-not-a-role.itest.ts", "the database agrees that a seat is not a role", "Seat", "The integration test that fails if the position identity is merged back into the authority row."],
  ["apps/web/src/lib/org/projection.ts", "buildOrgGraph", "Org structure", "Projects `Institution` + `Organization` onto the configurable org graph. Imported by nothing but its own test."],
  ["apps/web/src/lib/delegation.ts", "effectiveApprovalContext", "Delegation", "Resolves who may act on an approval gate once delegations are applied."],
  ["apps/web/src/lib/clubs.ts", "uniquePositionCode", "Position", "Allocates the permanent position code a seat keeps across holders."],
  ["apps/web/src/app/(app)/orgs/[slug]/members/actions.ts", "transitionAssignment", "Assignment", "The server action that moves a person between SHADOW, ACTIVE and ALUMNI on a club seat."],
  ["apps/web/src/app/(app)/orgs/[slug]/handoff/page.tsx", "The term-transition handoff packet", "Transition", "The term-transition packet: open work, finances, deadlines and contacts for a successor, assembled at read time."],
  ["apps/web/src/app/(app)/admin/people/page.tsx", "RoleTransferPanel", "Transition", "The institution-level people console where a role transfer is started."],
  ["apps/web/src/components/admin/RoleTransferPanel.tsx", "RoleTransferPanel", "Transition", "The transfer UI: propose, accept, decline, cancel."],
  ["packages/identity/src/effective-state.ts", "membershipLiveness", "Member", "The authority on whether a membership, identity or session is live at an instant."],
  ["packages/identity/src/seats.ts", "GE-040-003", "Assignment", "Simultaneous seats across tenants, and the overlap boundary a handover turns on."],
  ["packages/identity/src/transitions.ts", "reviseMembership", "Member", "The only way to change a membership state, returning the audit record with it so the write cannot be made without one."],
  ["packages/identity/src/scim.ts", "interpretScimPatch", "Person (inbound)", "SCIM filter, patch and paging semantics — the shape an external HR system would push people through. No route serves it."],
  ["packages/organization-model/src/continuity.ts", "succeedsTo", "Seat continuity", "What survives turnover: which resources follow the seat and which stay with the person."],
  ["packages/organization-model/src/assignment-states.ts", "PLATFORM_ASSIGNMENT_STATES", "Assignment", "The assignment state catalogue and the authority each state carries."],
  ["packages/organization-model/src/bitemporal.ts", "resolveAsOf", "Historical reconstruction", "Valid-time and record-time resolution, corrections that preserve prior truth, and drift detection."],
  ["packages/organization-model/src/position-lifecycle.ts", "planTermTransition", "Position", "Freeze, archive, split, merge, transfer and term-transition a position."],
  ["packages/organization-model/src/succession-release.ts", "releaseToSuccessor", "Succession", "Classifies each resource a leaver holds and decides what the successor receives."],
  ["packages/organization-model/src/graph.ts", "asOf", "Org structure", "Structure is asked of a dated snapshot, never of the graph — so an approval routed in March is explicable against March's structure."],
  ["packages/authorization/src/role-templates.ts", "ROLE_TEMPLATES", "Job/authority", "The named authority bundles a seat's `templateKey` points at, which is what replaced a regex over the seat title."],
  ["modules/index.ts", "The organizations themselves, their rosters, and the seats people hold on them.", "Module manifest", "The roster module's own 17-axis assessment, including the gaps it declares."],
]

// ── Declaration 5: the claims audit ─────────────────────────────────────────

/**
 * [path, anchor, verdict, note]. `BACKED` — the code does what the words say.
 * `HONEST_GAP` — the words say a capability is missing and it is.
 * `CONTRADICTED` — two documents in this repository disagree, and nobody has
 * decided. No claim is recorded as false unless the file was opened.
 */
export const CLAIMS = [
  ["modules/index.ts", "lifecycle: \"certified-limited\"", "BACKED", "The roster module ships `certified-limited`, not certified. It does not claim general availability."],
  ["modules/index.ts", "No payment rail, card feed or payroll connector", "HONEST_GAP", "The reimbursement module declares the absence of a payroll connector rather than implying one."],
  ["blueprints/corporate-divisions/blueprint.ts", "which this platform does not run", "HONEST_GAP", "The corporate blueprint states that payroll is out of scope where a reader would otherwise assume it."],
  ["modules/index.ts", "No domain event is published for a seat change", "HONEST_GAP", "The roster module declares that a retried seat write is a second write. The source document requires idempotent people commands."],
  ["modules/index.ts", "no duplicate-person or orphan-seat data-quality check", "HONEST_GAP", "Declared. The source document's data-quality requirement is unmet and says so."],
  ["apps/web/prisma/schema.prisma", "The durable organizational position, separate from the authority it carries.", "BACKED", "`Seat` really is separate from `Role`, and an integration test fails if they are merged."],
  ["apps/web/prisma/schema.prisma", "Past terms are kept rather than overwritten", "BACKED", "`SeatHolding` is unique on `(roleId, personId, term)` and prior terms survive."],
  ["docs/architecture/PLATFORM-ARCHITECTURE.md", "Do not build payroll. Ever.", "CONTRADICTED", "The People source document §3.10 defines five payroll modes including `TENURE_NATIVE_CERTIFIED` for an exact legal entity. The architecture document forbids the mode outright. Nobody has decided which governs."],
  ["docs/architecture/REVIEW-FINDINGS.md", "Three mutually exclusive target schemas, all marked MVP", "CONTRADICTED", "P0-8 finds `Role`→`Seat`, a `position`/`person`/`role_assignment` rewrite, and \"do not rename\" all marked build-now. Every people model this domain would add lands on top of that unresolved choice."],
  ["docs/architecture/REVIEW-FINDINGS.md", "grants full authority to suspended and disabled people", "CONTRADICTED", "P0-4 finds the effective-permission rule omits membership state, so a suspended member keeps every capability. The people model cannot be called correct while the rule that reads it is not."],
]

// ── Verification ────────────────────────────────────────────────────────────

/** Every problem found, as a sentence a reader can act on. Empty is the goal. */
export function verify() {
  const problems = []
  const models = prismaModels()
  const names = new Set(models.map((m) => m.name))

  const classified = new Map()
  for (const [name] of PEOPLE_MODELS) classified.set(name, "people")
  for (const [name] of CORE_LINKED_NOT_PEOPLE) classified.set(name, "other")

  for (const [name] of [...PEOPLE_MODELS, ...PEOPLE_MODELS_OFF_CORE, ...CORE_LINKED_NOT_PEOPLE]) {
    if (!names.has(name)) problems.push(`${SCHEMA} has no model \`${name}\`, but this inventory lists one.`)
  }
  for (const core of WORKFORCE_CORE) {
    if (!names.has(core)) problems.push(`${SCHEMA} has no model \`${core}\`, which this inventory treats as the workforce core.`)
  }
  for (const { name, links } of coreLinkedModels(models)) {
    if (!classified.has(name)) {
      problems.push(
        `\`${name}\` declares a relation into the workforce core (${links.join(", ")}) and is classified by neither ` +
          `PEOPLE_MODELS nor CORE_LINKED_NOT_PEOPLE in tools/hcm-people-inventory.mjs. Decide which it is.`,
      )
    }
  }

  for (const [p, anchor] of MODULES) {
    if (!exists(p)) problems.push(`${p} is listed as people logic and does not exist.`)
    else if (!anchorPresent(read(p), anchor)) problems.push(`${p} no longer contains its anchor "${anchor}".`)
  }
  for (const [p, anchor] of CLAIMS) {
    if (!exists(p)) problems.push(`${p} carries a claim in this audit and does not exist.`)
    else if (!anchorPresent(read(p), anchor)) problems.push(`${p} no longer contains the claim "${anchor}".`)
  }

  const objects = canonicalObjects()
  if (objects.length === 0) problems.push(`No canonical objects parsed from ${SOURCE_DOC}; the "At minimum:" line has moved.`)
  for (const o of objects) {
    if (!(o in BINDINGS)) problems.push(`${SOURCE_DOC} names canonical object \`${o}\` and this inventory does not bind it.`)
  }
  for (const o of Object.keys(BINDINGS)) {
    if (!objects.includes(o)) problems.push(`This inventory binds \`${o}\`, which ${SOURCE_DOC} no longer names.`)
  }
  for (const [o, [status, evidence]] of Object.entries(BINDINGS)) {
    if (status !== "ABSENT" && !exists(evidence)) problems.push(`\`${o}\` is ${status} on evidence ${evidence || "(none)"}, which does not exist.`)
    if (status === "ABSENT" && evidence) problems.push(`\`${o}\` is ABSENT and still cites evidence ${evidence}.`)
  }

  const distinctions = coreDistinctions()
  if (distinctions.length === 0) problems.push(`No core distinctions parsed from ${SOURCE_DOC} §2.`)
  for (const d of distinctions) {
    if (!(d in DISTINCTIONS)) problems.push(`${SOURCE_DOC} §2 requires \`${d}\` be kept distinct and this inventory does not say whether it is.`)
  }
  for (const d of Object.keys(DISTINCTIONS)) {
    if (!distinctions.includes(d)) problems.push(`This inventory answers for \`${d}\`, which ${SOURCE_DOC} §2 no longer names.`)
  }

  return problems.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

// ── Rendering ───────────────────────────────────────────────────────────────

const cell = (s) => String(s).split("|").join("\\|")

export function render() {
  const models = prismaModels()
  const linked = coreLinkedModels(models)
  const objects = canonicalObjects()
  const distinctions = coreDistinctions()
  const exported = organizationModelExports()
  const importers = importersOf("@tenure/organization-model")

  const importedNames = new Set()
  const productionNames = new Set()
  for (const i of importers) {
    for (const n of i.names) {
      importedNames.add(n)
      if (!i.test) productionNames.add(n)
    }
  }
  const unreached = exported.filter((n) => !importedNames.has(n))

  const counted = (status) => objects.filter((o) => BINDINGS[o][0] === status).length

  const L = []
  L.push(`<!-- Generated by tools/hcm-people-inventory.mjs. Do not edit by hand. -->`)
  L.push(``)
  L.push(`# People, member, seat, role and onboarding logic that exists today`)
  L.push(``)
  L.push(`HCM-000-001. Derived from the tree by \`tools/hcm-people-inventory.mjs\` and held`)
  L.push(`current by \`tests/architecture/hcm-people-inventory-is-current.test.mjs\`.`)
  L.push(``)
  L.push(`The People, HR and Workforce source document names ${objects.length} canonical objects and`)
  L.push(`${distinctions.length} distinctions it requires be kept apart. This repository runs a student`)
  L.push(`organisation roster. Both are true; the tables below are the distance between`)
  L.push(`them, measured rather than described.`)
  L.push(``)
  L.push(`**Of the ${objects.length} canonical objects: ${counted("PRESENT")} PRESENT, ${counted("PARTIAL")} PARTIAL, ${counted("ABSENT")} ABSENT.**`)
  L.push(``)
  L.push(`Every row names a path that exists, and every declared row names an anchor string`)
  L.push(`that must still appear inside that path. \`PARTIAL\` means something a reader could`)
  L.push(`mistake for the object exists — never that it works.`)
  L.push(``)
  L.push(`## 1. Tables that hold people, membership, seat or assignment data`)
  L.push(``)
  L.push(`\`${SCHEMA}\` declares ${models.length} models. ${WORKFORCE_CORE.length} of them ARE the workforce core`)
  L.push(`(\`${WORKFORCE_CORE.join("`, `")}\`) and ${linked.length} own a relation into it`)
  L.push(`— ${PEOPLE_MODELS.length} distinct tables, since \`Seat\` is both. Every one is classified below, and a`)
  L.push(`new table hung off any of the four reds the guard until somebody classifies it.`)
  L.push(``)
  L.push(`| Model | Concept it serves | What it actually is |`)
  L.push(`| --- | --- | --- |`)
  for (const [name, concept, note] of [...PEOPLE_MODELS].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    L.push(`| \`${cell(name)}\` | ${cell(concept)} | ${cell(note)} |`)
  }
  L.push(``)
  L.push(`${PEOPLE_MODELS_OFF_CORE.length} more people tables hang off \`User\` rather than off the workforce core, so`)
  L.push(`they cannot be derived and are declared:`)
  L.push(``)
  L.push(`| Model | Concept it serves | What it actually is |`)
  L.push(`| --- | --- | --- |`)
  for (const [name, concept, note] of [...PEOPLE_MODELS_OFF_CORE].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    L.push(`| \`${cell(name)}\` | ${cell(concept)} | ${cell(note)} |`)
  }
  L.push(``)
  L.push(`Derived relations into the core, for the reader who wants to check the`)
  L.push(`classification rather than trust it:`)
  L.push(``)
  L.push(`| Model | Relation into |`)
  L.push(`| --- | --- |`)
  for (const { name, links } of linked) L.push(`| \`${cell(name)}\` | ${links.map((l) => `\`${l}\``).join(", ")} |`)
  if (CORE_LINKED_NOT_PEOPLE.length === 0) {
    L.push(``)
    L.push(`No model links into the workforce core and belongs to another domain. The first`)
    L.push(`one that does gets a row with a reason rather than being folded in silently.`)
  }
  L.push(``)
  L.push(`## 2. Code that decides membership, authority, seats and transitions`)
  L.push(``)
  L.push(`${MODULES.length} modules, each verified to exist and to still contain its anchor.`)
  L.push(``)
  L.push(`| Path | Concept | Anchor | What it does |`)
  L.push(`| --- | --- | --- | --- |`)
  for (const [p, anchor, concept, note] of [...MODULES].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    L.push(`| \`${cell(p)}\` | ${cell(concept)} | \`${cell(anchor)}\` | ${cell(note)} |`)
  }
  L.push(``)
  L.push(`## 3. The workforce modelling package, and what reaches it`)
  L.push(``)
  L.push(`\`packages/organization-model\` exports ${exported.length} symbols covering effective-dated`)
  L.push(`structure, assignment states, bitemporal correction, position lifecycle and`)
  L.push(`succession release. Importers are counted by module specifier across`)
  L.push(`\`${SCAN_ROOTS.join("`, `")}\`; a relative import from a sibling`)
  L.push(`file is not counted, which is stated here rather than papered over.`)
  L.push(``)
  L.push(`| Importer | Test only | Symbols taken |`)
  L.push(`| --- | --- | --- |`)
  for (const i of importers) {
    L.push(`| \`${cell(i.file)}\` | ${i.test ? "yes" : "no"} | ${i.names.map((n) => `\`${n}\``).join(", ")} |`)
  }
  L.push(``)
  L.push(`**${unreached.length} of the ${exported.length} exported symbols are imported by nothing outside the package.**`)
  L.push(`The ${productionNames.size} that non-test code does reach are all topology and graph construction.`)
  L.push(`Every assignment-state, bitemporal-correction, position-lifecycle and`)
  L.push(`succession-release symbol is unreached — so the modelling that would answer`)
  L.push(`"what did the organisation look like in March" is written, tested inside its own`)
  L.push(`package, and connected to no caller. That is the finding this section exists for.`)
  L.push(``)
  L.push(`Reached by nothing outside \`packages/organization-model\`:`)
  L.push(``)
  for (const n of unreached) L.push(`- \`${n}\``)
  L.push(``)
  L.push(`## 4. The ${objects.length} canonical objects against what exists`)
  L.push(``)
  L.push(`Parsed from the source document's own §4 list, so an edit there reds this rather`)
  L.push(`than silently shrinking the denominator.`)
  L.push(``)
  L.push(`| Object | Status | Evidence | Note |`)
  L.push(`| --- | --- | --- | --- |`)
  for (const o of objects) {
    const [status, evidence, note] = BINDINGS[o]
    L.push(`| \`${cell(o)}\` | ${status} | ${evidence ? `\`${cell(evidence)}\`` : "—"} | ${cell(note)} |`)
  }
  L.push(``)
  L.push(`## 5. The ${distinctions.length} distinctions §2 requires be kept apart`)
  L.push(``)
  L.push(`| Distinction | Here | Why |`)
  L.push(`| --- | --- | --- |`)
  for (const d of distinctions) {
    const [verdict, note] = DISTINCTIONS[d]
    L.push(`| \`${cell(d)}\` | ${verdict} | ${cell(note)} |`)
  }
  L.push(``)
  L.push(`\`SPLIT WRONGLY\` is the finding worth acting on first. One human is a`)
  L.push(`\`DirectoryPerson\` and a \`User\`, joined by email — and \`email-is-not-a-key\` is`)
  L.push(`already a standing security guard in this repository. One placement is a`)
  L.push(`\`RoleAssignment\` with dates and a \`SeatHolding\` with an academic-year string,`)
  L.push(`and no code reconciles them.`)
  L.push(``)
  L.push(`## 6. Claims audit`)
  L.push(``)
  L.push(`What the repository says about people and HR capability, each verified by opening`)
  L.push(`the file. \`BACKED\` — the code does what the words say. \`HONEST_GAP\` — the words`)
  L.push(`declare an absence and the absence is real. \`CONTRADICTED\` — two documents here`)
  L.push(`disagree and nobody has decided.`)
  L.push(``)
  L.push(`| Path | Claim | Verdict | Note |`)
  L.push(`| --- | --- | --- | --- |`)
  for (const [p, anchor, verdict, note] of [...CLAIMS].sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1))) {
    L.push(`| \`${cell(p)}\` | \`${cell(anchor)}\` | ${verdict} | ${cell(note)} |`)
  }
  L.push(``)
  L.push(`No surface in \`apps/web\` claims payroll, benefits, time, absence, compensation,`)
  L.push(`recruiting or performance. The false-claim risk in this domain is not in the`)
  L.push(`product; it is in the three contradictions above, which a reader resolves by`)
  L.push(`picking whichever document they opened.`)
  L.push(``)
  L.push(`## 7. What this inventory does not tell you`)
  L.push(``)
  L.push(`- It reports that a module exists and still contains its anchor. It does not`)
  L.push(`  report that the module is correct, and \`PARTIAL\` never means working.`)
  L.push(`- Importers are found by module specifier. A relative import between siblings`)
  L.push(`  is invisible to it, so section 3's "reached by nothing" is a claim about`)
  L.push(`  cross-directory reach, not about every possible reference.`)
  L.push(`- Only models that own a relation into the workforce core are derived. A future`)
  L.push(`  people table that points at \`User\` alone has to be declared by hand, exactly`)
  L.push(`  as the three in section 1 are.`)
  L.push(``)
  return L.join("\n").replace(/\n+$/, "") + "\n"
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main() {
  const check = process.argv.includes("--check")
  const problems = verify()
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error::${p}`)
    console.error(`\n${problems.length} row(s) in ${OUT} no longer describe the repository.`)
    process.exit(1)
  }
  const next = render()
  const target = path.join(ROOT, OUT)
  if (check) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8").split("\r\n").join("\n") : ""
    if (current !== next) {
      console.error(`::error::${OUT} is stale. Run: node tools/hcm-people-inventory.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is current.`)
    return
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, next, "utf8")
  console.log(`Wrote ${OUT}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
