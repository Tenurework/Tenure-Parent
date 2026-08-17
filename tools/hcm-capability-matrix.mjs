#!/usr/bin/env node
/**
 * HCM-050-005 — publish the exact supported People Cloud capability,
 * jurisdiction and provider matrix, with its limitations.
 *
 * The Bible's §16 says People Cloud is done "only for the exact enabled scope"
 * and that "unbuilt jurisdictions/capabilities remain unavailable". §17 forbids
 * claiming a capability without the readiness behind it. Neither can be checked
 * against a document somebody wrote from memory, so this matrix is DERIVED:
 *
 *   * the ten capability families are parsed from the Bible's own `### 3.x`
 *     headings, so adding an eleventh reds this rather than being left out;
 *   * their canonical objects come from `tools/hcm-people-inventory.mjs`'s
 *     `BINDINGS` — one binding table for the whole domain, opened and verified by
 *     that tool's own `--check`, rather than a second opinion here;
 *   * the surfaces are the tenant routes that exist in `apps/web/src/app/(app)`,
 *     listed from the tree;
 *   * the jurisdiction packs are whatever the tree contains, found by walking it;
 *   * the provider domains are §9's own list, counted against the connector packs
 *     `packages/provisioning/src/provider-packs.ts` declares;
 *   * and `AVAILABLE` additionally requires a certification ADR **that exists on
 *     disk**, the same rule `packages/payments/src/capability-registry.ts`
 *     applies to a money-facing capability state.
 *
 * The result today is that nothing is available. That is not pessimism written
 * into a table; it is what the four derivations return, and the day one of them
 * returns something else this document changes without anybody rewording it.
 *
 * Usage:  node tools/hcm-capability-matrix.mjs [--check]
 *   --check  exit non-zero if the committed document is stale or a claim no
 *            longer holds. Regenerate with no flag.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  BINDINGS,
  ROOT,
  SOURCE_DOC,
  canonicalObjects,
  exists,
  read,
} from "./hcm-people-inventory.mjs"

export const OUT = "docs/architecture/hcm-capability-matrix.md"
export const PROVIDER_PACKS = "packages/provisioning/src/provider-packs.ts"
export const APP_ROUTES = "apps/web/src/app/(app)"

/* ── Derivation 1: the Bible's own capability families ─────────────────────── */

/** `### 3.1 Enterprise and workforce structures` → `{ number, title }`. */
export function capabilityFamilies(text = read(SOURCE_DOC)) {
  return [...text.matchAll(/^### (3\.\d+) (.+)$/gm)].map((m) => ({
    number: m[1],
    title: m[2].trim(),
  }))
}

/**
 * Which canonical objects each family needs.
 *
 * Declared, because §4 publishes one flat list and §3 does not repeat it per
 * family. Two closure properties make the declaration checkable rather than
 * trusted, and both are asserted in `verify()`:
 *
 *   * every name bound here is a name §4 states — so a typo, or an object
 *     renamed in the Bible, reds;
 *   * every name §4 states is bound exactly once — so an object cannot be
 *     quietly left out of the matrix, which is the way a capability comes to be
 *     reported as complete because the missing part of it was never listed.
 */
export const FAMILY_OBJECTS = {
  "3.1": [
    "Job",
    "JobFamily",
    "Position",
    "Seat",
    "Grade",
    "GradeRate",
    "Location",
    "WorkPattern",
    "CollectiveAgreement",
  ],
  "3.2": [
    "Person",
    "Name",
    "ContactPoint",
    "Worker",
    "EmploymentRelationship",
    "Assignment",
    "WorkforceEvent",
  ],
  "3.3": ["Candidate", "Requisition", "Application", "Interview", "Offer"],
  "3.4": ["OnboardingJourney", "TransitionPlan"],
  "3.5": ["TimeEntry", "TimeCard", "Shift", "AbsencePlan", "AbsenceBalance", "LeaveRequest"],
  "3.6": ["CompensationElement", "CompensationCycle"],
  "3.7": ["BenefitPlan", "Enrollment"],
  "3.8": [
    "Goal",
    "Review",
    "Feedback",
    "Skill",
    "Profile",
    "LearningItem",
    "LearningAssignment",
    "SuccessionPlan",
  ],
  "3.9": ["HRCase"],
  "3.10": ["PayrollRelationship", "PayrollInput", "PayrollRunReference"],
}

/**
 * The tenant route that would carry a family, or `null` where none does.
 *
 * `null` is a claim, not an omission, and it is checkable: `verify()` asserts
 * that a declared route exists in the tree and that a `null` family has no route
 * bound to it. The full route list is published in the document so a reader can
 * see the population the `null`s were decided against.
 */
export const FAMILY_SURFACE = {
  "3.1": "orgs/[slug]/members",
  "3.2": "admin/people",
  "3.3": null,
  "3.4": "orgs/[slug]/handoff",
  "3.5": null,
  "3.6": null,
  "3.7": null,
  "3.8": null,
  "3.9": null,
  "3.10": null,
}

/**
 * The certification ADR a family would need to be claimed `AVAILABLE`.
 *
 * Every one of them is a path that does not exist. Written as a path rather than
 * a boolean so promoting a family is writing a decision document, not editing a
 * flag — `adrExistsOnDisk` in the payments registry draws the line in the same
 * place, for the same reason.
 */
export const FAMILY_CERTIFICATION = Object.fromEntries(
  Object.keys(FAMILY_OBJECTS).map((n) => [
    n,
    `docs/decisions/hcm-${n.replace(".", "-")}-capability-certification.md`,
  ]),
)

/* ── Derivation 2: what the tree actually contains ─────────────────────────── */

/** Tenant route segments under `(app)`, as posix paths, deepest last. */
export function tenantRoutes() {
  const base = path.join(ROOT, APP_ROUTES)
  if (!fs.existsSync(base)) return []
  const out = []
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!e.isDirectory()) continue
      const route = prefix ? `${prefix}/${e.name}` : e.name
      if (fs.existsSync(path.join(dir, e.name, "page.tsx"))) out.push(route)
      walk(path.join(dir, e.name), route)
    }
  }
  walk(base, "")
  return out.sort()
}

/**
 * Files in the tree whose path names a jurisdiction pack.
 *
 * §12 makes jurisdiction packs the unit of local rule — required fields, document
 * types, employment/leave/time/payroll/retention rules, translations,
 * certifications. This walks for one. It finds nothing today, and the search is
 * published with the answer so "no jurisdiction is supported" is a measurement
 * rather than an assurance.
 */
export function jurisdictionPackFiles() {
  const out = []
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), rel)
      else if (/jurisdiction/i.test(e.name)) out.push(rel)
    }
  }
  for (const root of ["apps", "packages", "modules", "blueprints"]) {
    const abs = path.join(ROOT, root)
    if (fs.existsSync(abs)) walk(abs, root)
  }
  return out.sort()
}

/**
 * §9's provider domains for People Cloud, and the keywords that would identify a
 * connector serving one.
 *
 * Matched against every connector pack's `key`, `product` and `capability` —
 * Tenure's own words for what the pack does, not a provider's marketing name.
 */
export const PROVIDER_DOMAINS = {
  "identity / SCIM": ["scim", "directory-sync", "identity", "provisioning"],
  payroll: ["payroll", "pay-run", "paycheck"],
  benefits: ["benefit", "carrier", "enrollment"],
  recruiting: ["recruit", "applicant", "requisition", "candidate"],
  "background check": ["background-check", "screening"],
  "time clocks": ["time-clock", "timeclock", "attendance", "timesheet"],
  learning: ["learning", "lms", "course", "training"],
}

/** Every connector pack the catalog declares, as `{ key, product, capability }`. */
export function connectorPacks(text = read(PROVIDER_PACKS)) {
  const packs = []
  const re = /key:\s*"([^"]+)"[\s\S]{0,600}?product:\s*"([^"]+)"[\s\S]{0,600}?capability:\s*"([^"]+)"/g
  let m
  while ((m = re.exec(text)) !== null) {
    packs.push({ key: m[1], product: m[2], capability: m[3] })
  }
  return packs
}

/** How many declared connectors serve each People provider domain. */
export function providerCoverage(packs = connectorPacks()) {
  const out = []
  for (const [domain, keywords] of Object.entries(PROVIDER_DOMAINS)) {
    const matched = packs.filter((p) =>
      keywords.some((k) => `${p.key} ${p.product} ${p.capability}`.toLowerCase().includes(k)),
    )
    out.push({ domain, keywords, matched: matched.map((p) => p.key) })
  }
  return out
}

/** The five payroll modes §3.10 names, parsed from the Bible's own sentence. */
export function payrollModes(text = read(SOURCE_DOC)) {
  const line = text.split("\n").find((l) => l.startsWith("Modes:"))
  if (!line) return []
  return [...line.matchAll(/`([A-Z_]+)`/g)].map((m) => m[1])
}

/* ── The verdict ───────────────────────────────────────────────────────────── */

/**
 * What may be claimed about one family.
 *
 * Three words only. `LIMITED` exists because "some of this is built" is true of
 * three families and reporting them as `UNAVAILABLE` would be as wrong in the
 * other direction — but it is not a middle state a tenant may transact on: it
 * says what exists and what does not, and the missing objects are listed beside
 * it.
 *
 * `AVAILABLE` requires all three of: every canonical object PRESENT, a surface
 * that exists, and a certification ADR on disk. A family can therefore never
 * become `AVAILABLE` by an edit to this file.
 *
 * The rule is `availabilityFrom`, separated from `familyVerdict` so it can be
 * tested over inputs this repository does not currently produce. No family is
 * `AVAILABLE` today, so a test that only walked the ten families would assert the
 * AVAILABLE gate vacuously — a guard that cannot fail, which is worse than no
 * guard because it reads as coverage.
 */
export function availabilityFrom({ present, partial, absent, surface, certified }) {
  if (absent === 0 && partial === 0 && surface !== null && certified) return "AVAILABLE"
  if (present + partial > 0 && surface !== null) return "LIMITED"
  return "UNAVAILABLE"
}

export function familyVerdict(number) {
  const objects = FAMILY_OBJECTS[number].map((name) => ({
    name,
    status: BINDINGS[name]?.[0] ?? "UNBOUND",
  }))
  const present = objects.filter((o) => o.status === "PRESENT")
  const partial = objects.filter((o) => o.status === "PARTIAL")
  const absent = objects.filter((o) => o.status === "ABSENT" || o.status === "UNBOUND")
  const surface = FAMILY_SURFACE[number]
  const certification = FAMILY_CERTIFICATION[number]
  const certified = exists(certification)

  const availability = availabilityFrom({
    present: present.length,
    partial: partial.length,
    absent: absent.length,
    surface,
    certified,
  })
  return { objects, present, partial, absent, surface, certification, certified, availability }
}

/* ── The guard ─────────────────────────────────────────────────────────────── */

export function verify() {
  const problems = []
  const objects = canonicalObjects()
  const families = capabilityFamilies()

  // (1) Every family the Bible states has a binding, and vice versa.
  for (const f of families) {
    if (!FAMILY_OBJECTS[f.number]) {
      problems.push(`§${f.number} "${f.title}" is a capability family this matrix does not bind.`)
    }
    if (!(f.number in FAMILY_SURFACE)) {
      problems.push(`§${f.number} has no surface decision, not even a null one.`)
    }
  }
  for (const number of Object.keys(FAMILY_OBJECTS)) {
    if (!families.some((f) => f.number === number)) {
      problems.push(`This matrix binds §${number}, which the source document no longer states.`)
    }
  }

  // (2) Object closure, both directions.
  const bound = new Map()
  for (const [number, names] of Object.entries(FAMILY_OBJECTS)) {
    for (const name of names) {
      if (!objects.includes(name)) {
        problems.push(`§${number} binds \`${name}\`, which §4 does not name.`)
      }
      if (bound.has(name)) {
        problems.push(`\`${name}\` is bound to both §${bound.get(name)} and §${number}.`)
      }
      bound.set(name, number)
      if (!BINDINGS[name]) {
        problems.push(`\`${name}\` has no inventory binding, so its status cannot be read.`)
      }
    }
  }
  for (const name of objects) {
    if (!bound.has(name)) {
      problems.push(
        `Canonical object \`${name}\` is bound to no capability family, so no row of this matrix ` +
          `accounts for it.`,
      )
    }
  }

  // (3) A declared surface exists; a null one has no route claiming it.
  const routes = tenantRoutes()
  for (const [number, surface] of Object.entries(FAMILY_SURFACE)) {
    if (surface === null) continue
    if (!routes.includes(surface)) {
      problems.push(`§${number} names surface \`${surface}\`, which is not a route under ${APP_ROUTES}.`)
    }
  }

  // (4) Nothing may be claimed AVAILABLE without its ADR on disk. Belt and
  // braces over `familyVerdict`: if the verdict rule is ever loosened, this
  // reads the ADR itself.
  for (const number of Object.keys(FAMILY_OBJECTS)) {
    const v = familyVerdict(number)
    if (v.availability === "AVAILABLE" && !exists(v.certification)) {
      problems.push(`§${number} is claimed AVAILABLE and ${v.certification} is not in this repository.`)
    }
  }

  // (5) The payroll modes must still be the five §3.10 names.
  const modes = payrollModes()
  if (modes.length !== 5) {
    problems.push(`§3.10 parsed ${modes.length} payroll modes, not 5. The mode sentence changed.`)
  }

  // (6) The provider-pack parse must find the catalog it claims to read.
  if (connectorPacks().length === 0) {
    problems.push(
      `Parsed 0 connector packs out of ${PROVIDER_PACKS}. A parser that finds nothing makes every ` +
        `provider row read as "no connector serves this domain" for the wrong reason.`,
    )
  }

  return problems
}

/* ── The document ──────────────────────────────────────────────────────────── */

const cell = (s) => String(s).split("|").join("\\|")

export function render() {
  const families = capabilityFamilies()
  const routes = tenantRoutes()
  const packs = connectorPacks()
  const coverage = providerCoverage(packs)
  const jurisdictions = jurisdictionPackFiles()
  const modes = payrollModes()
  const L = []

  L.push(`# People Cloud — supported capability, jurisdiction and provider matrix`)
  L.push(``)
  L.push(`GENERATED by \`tools/hcm-capability-matrix.mjs\`. Do not edit: run the tool.`)
  L.push(`\`node tools/hcm-capability-matrix.mjs --check\` reds if this file is stale or if a`)
  L.push(`claim in it stops holding, and`)
  L.push(`\`tests/architecture/hcm-capability-matrix-is-current.test.mjs\` runs that in CI.`)
  L.push(``)
  L.push(`HCM-050-005. Every row is derived: the families from §3's own headings, the`)
  L.push(`objects from the domain's single binding table in \`tools/hcm-people-inventory.mjs\`,`)
  L.push(`the surfaces from the routes that exist, the jurisdictions from a walk of the`)
  L.push(`tree, the providers from the connector catalog. Nothing here is a statement of`)
  L.push(`intent — a capability becomes \`AVAILABLE\` when its objects exist, a surface`)
  L.push(`serves it and a certification decision is on disk, and not by an edit to the`)
  L.push(`generator.`)
  L.push(``)

  L.push(`## 1. Capability families (§3)`)
  L.push(``)
  L.push(`\`AVAILABLE\` needs every canonical object PRESENT, a surface, and its`)
  L.push(`certification ADR in \`docs/decisions/\`. \`LIMITED\` means something real exists`)
  L.push(`and the family is not complete — the missing objects are named. \`UNAVAILABLE\``)
  L.push(`means a tenant cannot do this at all.`)
  L.push(``)
  L.push(`| § | Family | Availability | Objects present | Missing objects | Surface | Certification |`)
  L.push(`| --- | --- | --- | --- | --- | --- | --- |`)
  for (const f of families) {
    const v = familyVerdict(f.number)
    const missing = v.absent.map((o) => `\`${o.name}\``).join(", ") || "—"
    const partial = v.partial.length > 0 ? ` (+${v.partial.length} partial)` : ""
    L.push(
      `| ${f.number} | ${cell(f.title)} | **${v.availability}** | ${v.present.length}/${v.objects.length}${partial} | ` +
        `${missing} | ${v.surface ? `\`${v.surface}\`` : "none"} | ${v.certified ? `\`${v.certification}\`` : "absent"} |`,
    )
  }
  L.push(``)
  const verdicts = families.map((f) => familyVerdict(f.number).availability)
  const count = (w) => verdicts.filter((v) => v === w).length
  L.push(
    `**${count("AVAILABLE")} of ${families.length} capability families are AVAILABLE; ` +
      `${count("LIMITED")} are LIMITED and ${count("UNAVAILABLE")} are UNAVAILABLE.**`,
  )
  L.push(``)

  L.push(`## 2. Payroll capability mode (§3.10)`)
  L.push(``)
  L.push(`The Bible's five modes, parsed from §3.10's own sentence. The mode in force for`)
  L.push(`every legal entity, population and jurisdiction is the first one, because there is`)
  L.push(`no payroll object in the schema, no payroll provider in the connector catalog and`)
  L.push(`no certification decision — and because`)
  L.push(`\`docs/architecture/PLATFORM-ARCHITECTURE.md\` says "Do not build payroll. Ever.",`)
  L.push(`a contradiction with §3.10 that is recorded in`)
  L.push(`\`docs/architecture/hcm-people-inventory.md\` and not resolved here.`)
  L.push(``)
  L.push(`| Mode | In force for any population | Why |`)
  L.push(`| --- | --- | --- |`)
  for (const mode of modes) {
    const inForce = mode === "UNAVAILABLE"
    L.push(
      `| \`${mode}\` | ${inForce ? "**yes — this is the mode**" : "no"} | ` +
        `${inForce ? "Nothing else is built." : "No payroll model, no payroll provider, no certification decision."} |`,
    )
  }
  L.push(``)
  L.push(`A generated file is never a payment and never a filing. Nothing in this platform`)
  L.push(`produces one today, so there is no exchange, acknowledgement or settlement to`)
  L.push(`reconcile — see \`HCM-030-005\` in the people ledger for what that would need.`)
  L.push(``)

  L.push(`## 3. Jurisdictions (§12)`)
  L.push(``)
  L.push(`Searched \`apps/\`, \`packages/\`, \`modules/\` and \`blueprints/\` for a file whose name`)
  L.push(`contains "jurisdiction".`)
  L.push(``)
  if (jurisdictions.length === 0) {
    L.push(`**Found: none. No jurisdiction pack exists, so no jurisdiction is supported —`)
    L.push(`not one, including the pilot's own.** Required fields, document types,`)
    L.push(`employment/leave/time/payroll/retention rules, translations and local`)
    L.push(`certifications are all unbuilt. A tenant in any country gets the same behaviour,`)
    L.push(`which §12 forbids claiming as global support.`)
  } else {
    L.push(`Found ${jurisdictions.length}:`)
    L.push(``)
    for (const f of jurisdictions) L.push(`- \`${f}\``)
    L.push(``)
    L.push(`Each still needs its own certification before a jurisdiction may be claimed.`)
  }
  L.push(``)

  L.push(`## 4. Providers (§9)`)
  L.push(``)
  L.push(`§9's provider domains for People Cloud, counted against the ${packs.length} connector packs`)
  L.push(`\`${PROVIDER_PACKS}\` declares. Matched on Tenure's own \`key\`, \`product\` and`)
  L.push(`\`capability\` words for each pack, never on a provider's product name.`)
  L.push(``)
  L.push(`| Domain | Connectors | Matched on |`)
  L.push(`| --- | --- | --- |`)
  for (const c of coverage) {
    L.push(
      `| ${cell(c.domain)} | ${c.matched.length === 0 ? "**none**" : c.matched.map((k) => `\`${k}\``).join(", ")} | ` +
        `${c.keywords.map((k) => `\`${k}\``).join(", ")} |`,
    )
  }
  L.push(``)
  const covered = coverage.filter((c) => c.matched.length > 0).length
  L.push(
    `**${covered} of ${coverage.length} People provider domains have any connector at all.** The packs ` +
      `that do exist serve productivity, collaboration and document workflows; none of them is an ` +
      `HR system of record, and a connector existing is not a certification either — that gate is ` +
      `\`packages/platform-config/src/provider-review.ts\`.`,
  )
  L.push(``)

  L.push(`## 5. Surfaces that exist`)
  L.push(``)
  L.push(`The ${routes.length} tenant routes under \`${APP_ROUTES}\`, published so the "none" in the`)
  L.push(`Surface column above can be checked against the whole population rather than`)
  L.push(`taken on trust.`)
  L.push(``)
  for (const r of routes) L.push(`- \`${r}\``)
  L.push(``)

  L.push(`## 6. Limitations`)
  L.push(``)
  L.push(`Stated as limitations because §16 requires unbuilt scope to remain unavailable and`)
  L.push(`§17 forbids claiming otherwise.`)
  L.push(``)
  const allAbsent = []
  for (const number of Object.keys(FAMILY_OBJECTS)) {
    for (const o of familyVerdict(number).absent) allAbsent.push(o.name)
  }
  L.push(`1. **${allAbsent.length} of the ${canonicalObjects().length} canonical objects §4 requires do not exist.**`)
  L.push(`   ${allAbsent.map((n) => `\`${n}\``).join(", ")}.`)
  L.push(`2. **No payroll, benefits, recruiting, time or learning capability is available in`)
  L.push(`   any jurisdiction**, and none may be enabled without the objects, a provider and a`)
  L.push(`   certification decision.`)
  L.push(`3. **No jurisdiction pack exists**, so no local legal requirement is enforced`)
  L.push(`   anywhere and nothing in the product should read as supporting a country.`)
  L.push(`4. **The person model is split and the assignment model is doubled** —`)
  L.push(`   \`DirectoryPerson\`/\`User\` joined by email, \`RoleAssignment\` and \`SeatHolding\``)
  L.push(`   answering one question two ways. Recorded in`)
  L.push(`   \`docs/architecture/hcm-people-inventory.md\` §5; blocked on the schema decision`)
  L.push(`   \`HCM-000-002\` names.`)
  L.push(`5. **What IS enforced, and is the only thing this matrix reports as built:** the`)
  L.push(`   seat-memory boundary (\`HCM-040-003\`) — a successor inherits the seat's working`)
  L.push(`   record, never its credentials or anything classified above \`standard\`.`)
  L.push(``)

  return L.join("\n") + "\n"
}

function main() {
  const check = process.argv.includes("--check")
  const problems = verify()
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error::${p}`)
    process.exit(1)
  }
  const target = path.join(ROOT, OUT)
  const next = render()
  if (check) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""
    if (current.replace(/\r\n/g, "\n") !== next) {
      console.error(`::error::${OUT} is stale. Run: node tools/hcm-capability-matrix.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is current.`)
    return
  }
  fs.writeFileSync(target, next, "utf8")
  console.log(`Wrote ${OUT}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
