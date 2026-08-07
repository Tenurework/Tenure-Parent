/**
 * Destructive development and e2e fixture. NOT safe to run on every container
 * start, and NOT idempotent in the sense that word usually carries.
 *
 * Most of this file upserts. Four statements do not: it deletes approval
 * delegations with no filter whatsoever (:422), budget lines outside the demo
 * set, this club's whole ledger, and the demo archived document — all to reset
 * state a previous e2e run left behind. On a live database those deletes remove
 * rows a customer created. scripts/entrypoint.sh says the same thing, and
 * infrastructure/terraform/ecs.tf deliberately leaves SEED_ON_BOOT unset for
 * it; scripts/seed-guard.mjs is the refusal that travels with the deletes
 * themselves, so neither of those has to be the only thing standing between a
 * redeploy and the data.
 *
 * Seeds the demo institution, the real Simon club roster (from
 * scripts/roster-data.mjs, generated from the OSE spreadsheets), and the
 * seven demo login accounts.
 *
 * Real board members are seeded as DirectoryPerson records, NOT Users: while
 * dev sign-in is enabled anyone with the URL could otherwise impersonate a
 * real student. They are visible, searchable and emailable; they just are not
 * accounts you can sign in as.
 */
import { PrismaClient } from "@prisma/client"

// Via roster-source, not roster-data directly: the real roster is 172 named
// students with their university addresses, and it should not stay committed in
// a repository whose visibility is the only thing protecting it. The
// indirection means removing it is `git rm --cached` plus a .gitignore line,
// with no code change — CI and local development fall through to the synthetic
// fixture, and production refuses to seed from that fixture by accident.
import { ROSTER, ADVISORS, CURRENT_TERM, PRIOR_TERM } from "./roster-source.mjs"
import { decideSeedAllowed } from "./seed-guard.mjs"
import { deliverablesWithTerms } from "./deliverables-data.mjs"
import { RESOURCES } from "./resources-data.mjs"

const db = new PrismaClient()

function scopeFor(position) {
  const p = position.toLowerCase()
  if (p.startsWith("president")) return "PRESIDENT"
  if (p.startsWith("managing director")) return "PRESIDENT" // SVC's top seat
  return "FUNCTIONAL"
}

/**
 * GE-051-005. Which authority bundle a seeded seat carries.
 *
 * Seed data is the one place a title may still be read, because interpreting a
 * position name is exactly what seeding *is* — turning a roster somebody wrote
 * into rows. The difference from the old `isFinanceRole` is that the answer is
 * written down in a column afterwards, so a seat renamed next term keeps the
 * authority it was given rather than silently gaining or losing it.
 */
function templateFor(position) {
  if (scopeFor(position) === "PRESIDENT") return "unit.lead"
  const p = position.toLowerCase()
  if (/financ|treasur|cfo|chief operating|coo/.test(p)) return "finance.officer"
  return "unit.member"
}

async function main() {
  // Before the first write, not after it. Everything below this line is either
  // an upsert or a delete against whatever database DATABASE_URL names.
  const verdict = decideSeedAllowed({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    seedDestructive: process.env.SEED_DESTRUCTIVE,
  })
  if (!verdict.allowed) {
    console.error(`⛔ Refusing to seed: ${verdict.reason}`)
    // Non-zero, so `set -e` in scripts/entrypoint.sh stops the container rather
    // than serving on from a boot that quietly skipped a step it was told to
    // take. A task that was configured to seed and did not is misconfigured.
    process.exit(1)
  }

  const institution = await db.institution.upsert({
    where: { slug: "rochester" },
    update: {},
    create: {
      serving: true,
      name: "University of Rochester",
      slug: "rochester",
      domain: "rochester.edu",
    },
  })

  async function user(email, name) {
    return db.user.upsert({
      where: { email },
      update: {},
      create: { email, name, emailVerified: new Date() },
    })
  }

  // Demo login accounts are a development affordance, not reference data: the
  // `dev-login` provider (src/lib/auth.ts) signs in any of these emails with no
  // password, and director@tenure.demo holds OSE_DIRECTOR — the highest role in
  // the system. Creating them in a production database is only defensible while
  // AUTH_DEV_LOGIN is deliberately on, so they are off by default there.
  const seedDemoLogins =
    process.env.SEED_DEMO_ACCOUNTS !== undefined
      ? process.env.SEED_DEMO_ACCOUNTS === "true"
      : process.env.NODE_ENV !== "production"

  let director, staff, president, vpFinance, memberUser, incoming, pastPresident

  if (seedDemoLogins) {
    director = await user("director@tenure.demo", "Dana Whitfield")
    staff = await user("staff@tenure.demo", "Sam Ortiz")
    president = await user("president@tenure.demo", "Priya Raman")
    vpFinance = await user("vp.finance@tenure.demo", "Victor Chen")
    memberUser = await user("member@tenure.demo", "Maya Johnson")
    incoming = await user("incoming.president@tenure.demo", "Isaiah Brooks")
    pastPresident = await user("alumni@tenure.demo", "Alex Kim")

    for (const [u, role] of [
      [director, "OSE_DIRECTOR"],
      [staff, "OSE_STAFF"],
    ]) {
      await db.institutionMembership.upsert({
        where: { userId_institutionId: { userId: u.id, institutionId: institution.id } },
        update: { role },
        create: { userId: u.id, institutionId: institution.id, role },
      })
    }
  } else {
    console.log(
      "🔒 Skipping demo login accounts (NODE_ENV=production and SEED_DEMO_ACCOUNTS is not \"true\").",
    )
  }

  // ── Directory people (board members + advisors) ────────────────────────────
  const personIdByEmail = new Map()

  async function directoryPerson({ name, email, kind, affiliation }) {
    const key = email.toLowerCase()
    if (personIdByEmail.has(key)) return personIdByEmail.get(key)
    const person = await db.directoryPerson.upsert({
      where: { email: key },
      update: { name, kind, affiliation },
      create: { email: key, name, kind, affiliation },
    })
    personIdByEmail.set(key, person.id)
    return person.id
  }

  for (const advisor of ADVISORS) {
    await directoryPerson({ ...advisor, kind: "ADVISOR" })
  }

  // ── Clubs, seats, holders (2026-2027 roster) ───────────────────────────────
  for (const club of ROSTER) {
    // A club that already exists under its previous slug is renamed in place,
    // so its documents, memory and history follow it to the new name.
    // Prefer a row already on the new slug (this seed runs on every boot);
    // otherwise adopt the row on the legacy slug and rename it.
    const existing =
      (await db.organization.findUnique({ where: { slug: club.slug } })) ??
      (club.legacySlug
        ? await db.organization.findUnique({ where: { slug: club.legacySlug } })
        : null)

    const data = {
      name: club.name,
      shortName: club.shortName,
      acronym: club.acronym,
      category: club.category,
      rosterNote: club.note,
      status: "ACTIVE",
    }

    const org = existing
      ? await db.organization.update({
          where: { id: existing.id },
          data: { ...data, slug: club.slug },
        })
      : await db.organization.create({
          data: { ...data, slug: club.slug, institutionId: institution.id },
        })

    // Advisors for this club
    for (const advisor of club.advisors) {
      const personId = await directoryPerson({ ...advisor, kind: "ADVISOR" })
      await db.organizationAdvisor.upsert({
        where: { organizationId_personId: { organizationId: org.id, personId } },
        update: {},
        create: { organizationId: org.id, personId },
      })
    }

    const desiredCodes = new Set(club.seats.map((s) => s.positionCode))
    const desiredNames = new Set([...club.seats.map((s) => s.name), "Member"])

    // Position codes are globally unique. A renamed seat ("VP Casing" ->
    // "VP of Casing") reduces to the same code, so release the code from the
    // old row before the new one claims it.
    // GE-050-002. The position code lives on Seat now; the release still has
    // to happen before the new row claims it.
    const stale = await db.seat.findMany({
      where: { organizationId: org.id, positionCode: { in: [...desiredCodes] } },
      include: { role: { select: { name: true } } },
    })
    for (const seat of stale) {
      if (!desiredNames.has(seat.role.name)) {
        await db.seat.update({ where: { id: seat.id }, data: { positionCode: null } })
      }
    }

    for (const [index, seat] of club.seats.entries()) {
      const position = {
        positionCode: seat.positionCode,
        positionNote: seat.positionNote,
        vacancyNote: seat.holder ? null : seat.vacancyNote || null,
        seatOrder: index,
      }
      const role = await db.role.upsert({
        where: { organizationId_name: { organizationId: org.id, name: seat.name } },
        update: {
          scope: scopeFor(seat.basePosition),
          templateKey: templateFor(seat.basePosition),
          seat: { upsert: { update: position, create: { organizationId: org.id, ...position } } },
        },
        create: {
          organizationId: org.id,
          name: seat.name,
          scope: scopeFor(seat.basePosition),
          templateKey: templateFor(seat.basePosition),
          seat: { create: { organizationId: org.id, ...position } },
        },
      })

      async function hold(person, term, isCurrent) {
        const personId = await directoryPerson({
          name: person.name,
          email: person.email,
          kind: "STUDENT",
          affiliation: null,
        })
        await db.seatHolding.upsert({
          where: { roleId_personId_term: { roleId: role.id, personId, term } },
          update: { isCurrent },
          create: { roleId: role.id, personId, term, isCurrent },
        })
      }

      if (seat.holder) await hold(seat.holder, CURRENT_TERM, true)
      // Last year's holder — the person to call during a handoff
      if (seat.predecessor) await hold(seat.predecessor, PRIOR_TERM, false)
    }

    // Generic membership seat, used by the demo accounts
    await db.role.upsert({
      where: { organizationId_name: { organizationId: org.id, name: "Member" } },
      update: {},
      create: {
        organizationId: org.id,
        name: "Member",
        scope: "MEMBER",
        templateKey: "unit.member",
        seat: {
          create: {
            organizationId: org.id,
            // club.code, not the legacy helper: initials alone collide
            // (Simon Says and Simon Sports both reduce to "SS")
            positionCode: `${club.code}-MEMB`,
          },
        },
      },
    })

    // Drop seats that no longer exist on the roster, but only when nothing is
    // attached to them — never delete a seat that carries history.
    const obsolete = await db.role.findMany({
      where: { organizationId: org.id, name: { notIn: [...desiredNames] } },
      include: {
        _count: { select: { assignments: true, memoryRecords: true, holdings: true } },
      },
    })
    for (const role of obsolete) {
      const { assignments, memoryRecords, holdings } = role._count
      if (assignments + memoryRecords + holdings === 0) {
        await db.role.delete({ where: { id: role.id } })
      }
    }
  }

  // ── Club deliverables & deadlines (2026-2027) ──────────────────────────────
  for (const d of deliverablesWithTerms()) {
    const data = {
      title: d.title,
      description: d.description,
      // Deadlines land end-of-day local; storing noon UTC keeps the calendar
      // date stable regardless of the viewer's timezone.
      dueAt: new Date(`${d.date}T12:00:00.000Z`),
      term: d.term,
      seat: d.seat,
      kind: d.kind,
      source: d.source,
    }
    await db.deliverable.upsert({
      where: { key: d.key },
      update: data,
      create: { ...data, key: d.key, institutionId: institution.id },
    })
  }

  // ── Board resources ────────────────────────────────────────────────────────
  // Bootstrap-only, like the demo BudgetLines below: `update: {}` so re-seeding
  // adds any newly shipped resource without touching rows that already exist.
  //
  // This MUST NOT write on update. entrypoint.sh runs this seed on every
  // container start — every deploy, every ECS task replacement, every
  // health-check restart — not just first boot. Passing the launch content as
  // the update payload therefore reverted anything OSE had edited through
  // /resources, silently and with no audit record of the reversion, usually
  // hours or days after the edit was made. Resource is operator-writable
  // (src/lib/resources-data.ts updateResource), which is the whole point of
  // moving these out of a hardcoded array; Deliverable can safely use
  // `update: data` above only because nothing in the app writes to it.
  for (const r of RESOURCES) {
    const data = {
      title: r.title,
      description: r.description,
      href: r.href,
      external: r.external,
      ready: r.ready,
      kind: r.kind,
      seats: r.seats,
      rule: r.rule ?? null,
      sortOrder: r.sortOrder,
    }
    await db.resource.upsert({
      where: { institutionId_key: { institutionId: institution.id, key: r.key } },
      update: {},
      create: { ...data, key: r.key, institutionId: institution.id },
    })
  }

  // Clubs from earlier scaffolds that the 2026-2027 roster does not list
  const currentSlugs = new Set(ROSTER.map((c) => c.slug))
  await db.organization.updateMany({
    where: { institutionId: institution.id, slug: { notIn: [...currentSlugs] } },
    data: { status: "ARCHIVED" },
  })

  // ── Demo assignments (the only accounts that can actually sign in) ─────────
  const consulting = await db.organization.findUniqueOrThrow({
    where: { slug: "simon-consulting-club" },
  })

  async function findRole(organizationId, name) {
    return db.role.findUniqueOrThrow({
      where: { organizationId_name: { organizationId, name } },
    })
  }

  const cPresident = await findRole(consulting.id, "President")
  const cVpFinance = await findRole(consulting.id, "VP Finance & Operations")
  const cMember = await findRole(consulting.id, "Member")

  async function assign(userId, roleId, status, extra = {}) {
    const existing = await db.roleAssignment.findFirst({ where: { userId, roleId } })
    if (existing) {
      return db.roleAssignment.update({ where: { id: existing.id }, data: { status } })
    }
    return db.roleAssignment.create({ data: { userId, roleId, status, ...extra } })
  }

  if (seedDemoLogins) {
    await assign(president.id, cPresident.id, "ACTIVE")
    await assign(vpFinance.id, cVpFinance.id, "ACTIVE")
    await assign(memberUser.id, cMember.id, "ACTIVE")
    await assign(incoming.id, cPresident.id, "SHADOW")
    await assign(pastPresident.id, cPresident.id, "ALUMNI", {
      startDate: new Date("2024-08-01"),
      endDate: new Date("2025-05-15"),
    })
    // Priya also chairs Simon Women in Business (real multi-club leadership)
    const swib = await db.organization.findUniqueOrThrow({
      where: { slug: "simon-women-in-business" },
    })
    await assign(president.id, (await findRole(swib.id, "President")).id, "ACTIVE")
  }

  // ── Demo budget lines for the consulting club finance dashboard ────────────
  const demoBudget = [
    { category: "Catering & Food", budgetedCents: 250000, actualCents: 187500 },
    { category: "Venue & Space", budgetedCents: 120000, actualCents: 135000 },
    { category: "Speaker Honoraria", budgetedCents: 180000, actualCents: 90000 },
    { category: "Marketing & Print", budgetedCents: 60000, actualCents: 42000 },
    { category: "Travel (Career Treks)", budgetedCents: 200000, actualCents: 0, forecastCents: 175000 },
    { category: "Club Swag", budgetedCents: 80000, actualCents: 88000 },
    { category: "Software & Tools", budgetedCents: 45000, actualCents: 45000 },
  ]
  for (const [i, line] of demoBudget.entries()) {
    await db.budgetLine.upsert({
      where: {
        organizationId_academicYear_category: {
          organizationId: consulting.id,
          academicYear: "2026-2027",
          category: line.category,
        },
      },
      update: {},
      create: {
        organizationId: consulting.id,
        academicYear: "2026-2027",
        category: line.category,
        budgetedCents: line.budgetedCents,
        actualCents: line.actualCents,
        forecastCents: line.forecastCents ?? null,
        sortOrder: i,
        source: "manual",
      },
    })
  }

  // Clear approval delegations from prior e2e runs so the delegation test always
  // finds the "set a backup" form rather than an existing grant.
  await db.approvalDelegation.deleteMany({})

  // Remove budget lines left over from prior e2e runs (e.g. "Test Line …" from
  // the add-line test, or imported rows) so a fresh seed is a clean slate;
  // otherwise they accumulate locally and skew the club's totals.
  await db.budgetLine.deleteMany({
    where: {
      organizationId: consulting.id,
      academicYear: "2026-2027",
      category: { notIn: demoBudget.map((l) => l.category) },
    },
  })

  // ── Demo general ledger — the transactions behind two lines' actuals, so the
  //    drill-down shows real source detail and "actual = Σ ledger" holds. ──────
  const cateringLine = await db.budgetLine.findFirst({
    where: { organizationId: consulting.id, academicYear: "2026-2027", category: "Catering & Food" },
  })
  const venueLine = await db.budgetLine.findFirst({
    where: { organizationId: consulting.id, academicYear: "2026-2027", category: "Venue & Space" },
  })
  if (cateringLine && venueLine) {
    let vendor = await db.vendor.findFirst({
      where: { organizationId: consulting.id, name: "Rochester Catering Co." },
    })
    if (!vendor) {
      vendor = await db.vendor.create({
        data: {
          institutionId: consulting.institutionId,
          organizationId: consulting.id,
          name: "Rochester Catering Co.",
          contactEmail: "sales@rochestercatering.example",
        },
      })
    }
    // Idempotent: clear this club's ledger, then repost the demo entries.
    await db.ledgerEntry.deleteMany({ where: { organizationId: consulting.id } })
    const demoLedger = [
      { line: cateringLine.id, kind: "SPEND", amountCents: 120000, description: "Kickoff mixer catering", vendorId: vendor.id, daysAgo: 40 },
      { line: cateringLine.id, kind: "SPEND", amountCents: 82500, description: "Case competition lunch", vendorId: vendor.id, daysAgo: 18 },
      { line: cateringLine.id, kind: "REIMBURSEMENT", amountCents: -15000, description: "Refund — over-ordered trays", vendorId: vendor.id, daysAgo: 12 },
      { line: venueLine.id, kind: "SPEND", amountCents: 90000, description: "Ballroom deposit", daysAgo: 30 },
      { line: venueLine.id, kind: "SPEND", amountCents: 45000, description: "AV rental + setup", daysAgo: 9 },
    ]
    for (const e of demoLedger) {
      const occurredAt = new Date(Date.now() - e.daysAgo * 86_400_000)
      // PAY-130-002. Demo postings are journals like every other posting: the
      // expense against the line, and the counter-side that does not carry a
      // budget dimension. Seeding only the expense half would leave the
      // development database in a shape production can no longer be in.
      const journalId = `jrn_seed_${e.line}_${e.daysAgo}`
      const debitToExpense = e.amountCents >= 0
      await db.ledgerEntry.create({
        data: {
          organizationId: consulting.id,
          budgetLineId: e.line,
          academicYear: "2026-2027",
          kind: e.kind,
          amountCents: e.amountCents,
          description: e.description,
          vendorId: e.vendorId ?? null,
          occurredAt,
          journalId,
          templateId: debitToExpense ? "ledger.manual-spend" : "ledger.manual-recovery",
          account: "6000-program-expense",
          side: debitToExpense ? "DEBIT" : "CREDIT",
          effectiveAt: occurredAt,
        },
      })
      await db.ledgerEntry.create({
        data: {
          organizationId: consulting.id,
          budgetLineId: null,
          academicYear: "2026-2027",
          kind: e.kind,
          amountCents: -e.amountCents,
          description: e.description,
          vendorId: e.vendorId ?? null,
          occurredAt,
          journalId,
          templateId: debitToExpense ? "ledger.manual-spend" : "ledger.manual-recovery",
          account: debitToExpense ? "2100-reimbursement-payable" : "1000-cash-clearing",
          side: debitToExpense ? "CREDIT" : "DEBIT",
          effectiveAt: occurredAt,
        },
      })
    }
    for (const lineId of [cateringLine.id, venueLine.id]) {
      const agg = await db.ledgerEntry.aggregate({ where: { budgetLineId: lineId }, _sum: { amountCents: true } })
      await db.budgetLine.update({ where: { id: lineId }, data: { actualCents: agg._sum.amountCents ?? 0 } })
    }
  }

  // Lightweight budgets for a few more clubs so the OSE finance portfolio
  // roll-up has real breadth (not just the consulting club).
  const otherClubs = await db.organization.findMany({
    where: { institutionId: consulting.institutionId, status: "ACTIVE", slug: { not: "simon-consulting-club" } },
    take: 4,
    orderBy: { name: "asc" },
  })
  const budgetTemplates = [
    [["Events & Programming", 300000, 214000], ["Marketing", 80000, 52000], ["Operations", 120000, 61000]],
    [["Conference & Travel", 250000, 188000], ["Workshops", 150000, 96000]],
    [["Socials", 180000, 141000], ["Supplies", 60000, 47000], ["Guest Speakers", 100000, 72000]],
    [["Community Outreach", 90000, 28000], ["Print & Materials", 70000, 66000]],
  ]
  for (const [ci, club] of otherClubs.entries()) {
    const tmpl = budgetTemplates[ci % budgetTemplates.length]
    for (const [si, [category, budgetedCents, actualCents]] of tmpl.entries()) {
      await db.budgetLine.upsert({
        where: {
          organizationId_academicYear_category: {
            organizationId: club.id,
            academicYear: "2026-2027",
            category,
          },
        },
        update: {},
        create: {
          organizationId: club.id,
          academicYear: "2026-2027",
          category,
          budgetedCents,
          actualCents,
          sortOrder: si,
          source: "manual",
        },
      })
    }
  }

  // A demo archived document so soft-delete/restore is visible + testable
  // locally (archive/restore only flip isArchived; the S3 object needn't exist).
  // Reset to archived each seed so the restore test is repeatable.
  await db.document.deleteMany({
    where: { organizationId: consulting.id, title: "Old Sponsor Deck" },
  })
  await db.document.create({
    data: {
      institutionId: consulting.institutionId,
      organizationId: consulting.id,
      title: "Old Sponsor Deck",
      objectKey: `${consulting.institutionId}/${consulting.id}/seed-old-sponsor-deck.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 204800,
      isArchived: true,
    },
  })

  const counts = {
    clubs: ROSTER.length,
    seats: await db.role.count(),
    people: await db.directoryPerson.count(),
    deliverables: await db.deliverable.count(),
    resources: await db.resource.count(),
    holdings: await db.seatHolding.count(),
  }
  console.log(
    `✅ Seed complete — ${counts.clubs} clubs, ${counts.seats} seats, ` +
      `${counts.people} directory people, ${counts.holdings} seat holdings, ` +
      `${counts.deliverables} deliverables, ${counts.resources} board resources`
  )
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
