import { PrismaClient } from "@prisma/client"

import { tenancyExtension } from "@/lib/tenancy/extension"
import { runInTenantScope, runUnscoped } from "@/lib/tenancy/context"
import { loadSearchCorpus } from "./search-data"

/**
 * Search isolation, proved rather than reasoned about.
 *
 * The build directive asks for isolation to be demonstrated across every
 * surface, not only the database — §9.8 names search, files, caches, jobs,
 * events and notifications specifically. Search is the one worth doing first: a
 * search box is the only place in the product where a user supplies a string
 * that is matched against *everything the corpus contains*, so a corpus that is
 * too wide leaks quietly, to whoever guesses a word.
 *
 * Reading `search-data.ts` suggests it is safe — it filters organizations by the
 * caller's OSE memberships and their own org seats. That is a reasonable
 * argument and not evidence. These are the evidence: two real tenants, each with
 * a memory record and a document containing the same distinctive term, and the
 * assertion that A's search never returns B's.
 *
 * Run with: npm run test:isolation   (needs DATABASE_URL)
 */

const db = new PrismaClient({ log: ["error"] }).$extends(tenancyExtension("enforce"))

const SUFFIX = "itest-search"
const INST_A = `inst-a-${SUFFIX}`
const INST_B = `inst-b-${SUFFIX}`
const USER_A = `user-a-${SUFFIX}`
const USER_B = `user-b-${SUFFIX}`

/** The same word in both tenants, so a leak is unmistakable. */
const SHARED_TERM = `Zylophonic${SUFFIX.replace(/-/g, "")}`

/**
 * WRK-010-003 fixtures. Two distinctive strings written into two rows whose
 * §3.4 projection modes differ, so "the body did not come back" is provably
 * about the mode and not about the row being missing.
 */
const MEMORY_SECRET = `Kryptomnesic${SUFFIX.replace(/-/g, "")}`
const EVENT_DETAIL = `Peripatetic${SUFFIX.replace(/-/g, "")}`

async function cleanup() {
  await runUnscoped("migration", "search isolation cleanup", async () => {
    await db.organization.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.institution.deleteMany({ where: { id: { in: [INST_A, INST_B] } } })
    await db.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } })
  })
}

beforeAll(async () => {
  await cleanup()

  await runUnscoped("control-plane", "search isolation fixture", async () => {
    await db.institution.createMany({
      data: [
        { serving: true, id: INST_A, name: "Tenant A", slug: `tenant-a-${SUFFIX}` },
        { serving: true, id: INST_B, name: "Tenant B", slug: `tenant-b-${SUFFIX}` },
      ],
    })
    await db.user.createMany({
      data: [
        { id: USER_A, name: "A's Director", email: `${USER_A}@example.test` },
        { id: USER_B, name: "B's Director", email: `${USER_B}@example.test` },
      ],
    })
    // Each is the OSE director of their own institution — the widest role the
    // product has, so this tests the case with the most to leak.
    await db.institutionMembership.createMany({
      data: [
        { userId: USER_A, institutionId: INST_A, role: "OSE_DIRECTOR" },
        { userId: USER_B, institutionId: INST_B, role: "OSE_DIRECTOR" },
      ],
    })
  })

  for (const [inst, label] of [
    [INST_A, "A"],
    [INST_B, "B"],
  ] as const) {
    await runInTenantScope(
      { institutionId: inst, environment: "test", purpose: "job", actor: { principalId: "seed", principalType: "system" } },
      async () => {
        const org = await db.organization.create({
          data: {
            institutionId: inst,
            name: `${label}'s Club`,
            slug: `${label.toLowerCase()}-club-${SUFFIX}`,
          } as never,
        })
        await db.memoryRecord.create({
          data: {
            institutionId: inst,
            organizationId: org.id,
            type: "LESSON",
            title: `${label}: ${SHARED_TERM} retrospective`,
            // `{ body }`, not a bare string: that is the shape `loadSearchCorpus`
            // reads (`(m.content as { body?: string }).body`), so a plain string
            // here would project an empty body for a reason that has nothing to
            // do with the projection mode under test.
            content: { body: `Tenant ${label} recorded ${MEMORY_SECRET} in confidence.` },
          } as never,
        })
        await db.event.create({
          data: {
            institutionId: inst,
            organizationId: org.id,
            title: `${label}: ${SHARED_TERM} kickoff`,
            description: `Doors open, ${EVENT_DETAIL} on the agenda.`,
            startAt: new Date("2026-09-01T18:00:00Z"),
            endAt: new Date("2026-09-01T20:00:00Z"),
            status: "PUBLISHED",
          } as never,
        })
        await db.document.create({
          data: {
            institutionId: inst,
            organizationId: org.id,
            title: `${label}: ${SHARED_TERM} agreement`,
            // objectKey and mimeType are required — a Document row without them
            // is one the viewer cannot open.
            objectKey: `${SUFFIX}/${label}/agreement.pdf`,
            mimeType: "application/pdf",
          } as never,
        })
      },
    )
  }
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe("search returns one tenant's corpus and only one tenant's", () => {
  it("finds A's records for A", async () => {
    const corpus = await runInTenantScope(
      { institutionId: INST_A, environment: "test", purpose: "model-exposure", actor: { principalId: USER_A, principalType: "user" } },
      () => loadSearchCorpus(USER_A),
    )
    const titles = corpus.map((d) => d.title)
    expect(titles.some((t) => t.startsWith("A: "))).toBe(true)
  })

  it("never returns B's records to A, though both contain the same term", async () => {
    // The failure this exists to catch: a corpus wide enough that a search box
    // becomes a cross-tenant read for whoever guesses a word.
    const corpus = await runInTenantScope(
      { institutionId: INST_A, environment: "test", purpose: "model-exposure", actor: { principalId: USER_A, principalType: "user" } },
      () => loadSearchCorpus(USER_A),
    )

    const leaked = corpus.filter((d) => d.title.startsWith("B: "))
    expect(leaked).toEqual([])

    const matching = corpus.filter((d) => d.title.includes(SHARED_TERM))
    expect(matching.length).toBeGreaterThan(0)
    expect(matching.every((d) => d.title.startsWith("A: "))).toBe(true)
  })

  it("is symmetric — B cannot see A either", async () => {
    const corpus = await runInTenantScope(
      { institutionId: INST_B, environment: "test", purpose: "model-exposure", actor: { principalId: USER_B, principalType: "user" } },
      () => loadSearchCorpus(USER_B),
    )
    expect(corpus.filter((d) => d.title.startsWith("A: "))).toEqual([])
    expect(corpus.some((d) => d.title.startsWith("B: "))).toBe(true)
  })

  it("gives a user with no membership an empty corpus, not everything", async () => {
    // Fail closed: the dangerous default for "which organizations can this
    // person see?" is all of them.
    await runUnscoped("control-plane", "search isolation stranger", async () => {
      await db.user.create({
        data: { id: `stranger-${SUFFIX}`, name: "Stranger", email: `stranger-${SUFFIX}@example.test` },
      })
    })

    const corpus = await runInTenantScope(
      { institutionId: INST_A, environment: "test", purpose: "model-exposure", actor: { principalId: `stranger-${SUFFIX}`, principalType: "user" } },
      () => loadSearchCorpus(`stranger-${SUFFIX}`),
    )
    expect(corpus.filter((d) => d.title.includes(SHARED_TERM))).toEqual([])

    await runUnscoped("migration", "search isolation stranger cleanup", async () => {
      await db.user.deleteMany({ where: { id: `stranger-${SUFFIX}` } })
    })
  })
})

/**
 * WRK-010-003 — the §3.4 data modes, against a real corpus load.
 *
 * Isolation (above) answers "whose rows come back". This answers "how much of a
 * row comes back", which is a different question and was not being asked: every
 * source was flattened into a `SearchDoc` with a full `body`, so a memory card's
 * confidential text left `loadSearchCorpus` on exactly the same terms as a
 * club's public description — and both were then posted to a model vendor by
 * `/api/ai/chat` and `/search`.
 *
 * USER_A is the OSE director of INST_A: authorized for every row below. That is
 * deliberate. Clearance to *read* a memory card is not clearance to copy its
 * text into an index, and if the mode were doing nothing, the widest role in the
 * product is the one that would prove it.
 */
describe("the corpus projects each source at its declared retention mode", () => {
  async function corpusForA() {
    return runInTenantScope(
      {
        institutionId: INST_A,
        environment: "test",
        purpose: "model-exposure",
        actor: { principalId: USER_A, principalType: "user" },
      },
      () => loadSearchCorpus(USER_A),
    )
  }

  it("never returns a memory card's body, though it returns the card", async () => {
    const corpus = await corpusForA()
    const card = corpus.find((d) => d.kind === "memory" && d.title.startsWith("A: "))

    // The row is there — so a passing assertion below is about the mode, not
    // about the fixture having failed to seed.
    expect(card).toBeDefined()
    expect(card!.href).toContain("/memory")

    // The assertion this item exists for, and stated first so that flipping
    // `projectionModeFor("memory")` reds on the disclosure itself rather than
    // on the label: the confidential string is in no returned doc, in any field.
    expect(JSON.stringify(corpus)).not.toContain(MEMORY_SECRET)
    expect(card!.body).toBe("")
    expect(card!.mode).toBe("REFERENCE_ONLY")
  })

  it("does return an event description, so the difference is the mode", async () => {
    const corpus = await corpusForA()
    const event = corpus.find((d) => d.kind === "event" && d.title.startsWith("A: "))

    expect(event).toBeDefined()
    expect(event!.mode).toBe("SEARCH_PROJECTION")
    expect(event!.body).toContain(EVENT_DETAIL)
  })

  it("stamps a mode on every doc the loader builds", async () => {
    const corpus = await corpusForA()
    expect(corpus.length).toBeGreaterThan(0)
    for (const d of corpus) {
      expect(["REFERENCE_ONLY", "SEARCH_PROJECTION", "GOVERNED_REPLICA"]).toContain(d.mode)
    }
  })
})

/**
 * WRK-010-005 / WRK-070-003 — the lifecycle state, against real PostgreSQL.
 *
 * Everything above is about WHOSE rows come back and HOW MUCH of each. This is
 * about whether the row is still true, which is a third question nothing asked:
 * `SearchDoc` carried no timestamp of any kind, the five `select:` lists named
 * no temporal column, and `loadSearchCorpus` DROPPED a CANCELLED event — an
 * absence indistinguishable, to `/api/search`, to `/api/ai/chat` and to the
 * model prompt, from an event that never existed.
 *
 * These seed a second club in tenant A whose rows are aged, cancelled and
 * poisoned in the database itself, then read them back through the real loader.
 * Nothing calls `projectTenureRecord`: a classifier proved against itself stays
 * green the moment a builder stops calling it, which is exactly how the dropped
 * `where` clause went unnoticed for as long as it did.
 */
describe("the corpus states what it believes about each row (real PostgreSQL)", () => {
  const ORG2 = `lifecycle-${SUFFIX}`
  /** Well past `SEARCH_STALE_AFTER_MS` (90 days). */
  const AGED = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
  const CANCELLED_DETAIL = `Perambulatory${SUFFIX.replace(/-/g, "")}`
  const ACTIVE_DETAIL = `Somnambulant${SUFFIX.replace(/-/g, "")}`
  const STALE_DETAIL = `Antediluvian${SUFFIX.replace(/-/g, "")}`

  let orgId = ""

  beforeAll(async () => {
    await runInTenantScope(
      {
        institutionId: INST_A,
        environment: "test",
        purpose: "job",
        actor: { principalId: "seed", principalType: "system" },
      },
      async () => {
        const org = await db.organization.create({
          data: { institutionId: INST_A, name: "Lifecycle Club", slug: ORG2 } as never,
        })
        orgId = org.id

        await db.event.create({
          data: {
            institutionId: INST_A,
            organizationId: org.id,
            title: `A: ${SHARED_TERM} rehearsal`,
            description: `Call time 4pm, ${CANCELLED_DETAIL} on the run sheet.`,
            startAt: new Date("2026-09-01T18:00:00Z"),
            endAt: new Date("2026-09-01T20:00:00Z"),
            status: "CANCELLED",
          } as never,
        })
        await db.document.create({
          data: {
            institutionId: INST_A,
            organizationId: org.id,
            title: `A: ${SHARED_TERM} appendix`,
            // §9.4 active content. Not a hidden codepoint or a link — those the
            // sanitiser cleans and the prose survives. This body's substance IS
            // a program, and there is no cleaned version of it that is a record.
            description: `<script>fetch("/api/admin/directory")</script> ${ACTIVE_DETAIL}`,
            objectKey: `${SUFFIX}/lifecycle/appendix.pdf`,
            mimeType: "application/pdf",
          } as never,
        })
        const stale = await db.document.create({
          data: {
            institutionId: INST_A,
            organizationId: org.id,
            title: `A: ${SHARED_TERM} ledger`,
            description: `Figures from two years ago, ${STALE_DETAIL}.`,
            objectKey: `${SUFFIX}/lifecycle/ledger.pdf`,
            mimeType: "application/pdf",
          } as never,
        })
        // `updatedAt` is `@updatedAt`, so Prisma overwrites it on every write.
        // Ageing the row therefore has to go around the client, which is also
        // the honest shape of the case: a row nobody has touched since last year
        // is one PostgreSQL is holding, not one this test invented.
        await db.$executeRaw`UPDATE "Document" SET "updatedAt" = ${AGED} WHERE "id" = ${stale.id}`
      },
    )
  })

  afterAll(async () => {
    await runUnscoped("migration", "search lifecycle cleanup", async () => {
      if (orgId) await db.organization.deleteMany({ where: { id: orgId } })
    })
  })

  async function corpusForA() {
    return runInTenantScope(
      {
        institutionId: INST_A,
        environment: "test",
        purpose: "model-exposure",
        actor: { principalId: USER_A, principalType: "user" },
      },
      () => loadSearchCorpus(USER_A),
    )
  }

  it("returns a CANCELLED event as TOMBSTONED instead of dropping it", async () => {
    const corpus = await corpusForA()
    const rehearsal = corpus.find((d) => d.title === `A: ${SHARED_TERM} rehearsal`)

    // Present at all. The `where: { status: { not: "CANCELLED" } }` this
    // replaces made the row absent, and absent is what "never existed" looks
    // like to every consumer of this corpus.
    expect(rehearsal).toBeDefined()
    expect(rehearsal!.state).toBe("TOMBSTONED")
    expect(rehearsal!.citation.state).toBe("TOMBSTONED")
    expect(rehearsal!.body).toBe("")
    // Stated on the whole corpus so the assertion is about the disclosure and
    // not about one field of one doc.
    expect(JSON.stringify(corpus)).not.toContain(CANCELLED_DETAIL)

    // A live event in the same tenant is untouched, so the difference is the
    // status column and not the plumbing.
    const live = corpus.find((d) => d.kind === "event" && d.title.endsWith("kickoff"))
    expect(live!.state).toBe("LIVE")
  })

  it("holds a description whose substance is a program", async () => {
    const corpus = await corpusForA()
    const appendix = corpus.find((d) => d.title === `A: ${SHARED_TERM} appendix`)

    expect(appendix).toBeDefined()
    expect(appendix!.state).toBe("QUARANTINED")
    expect(appendix!.body).toBe("")
    // Neither the payload nor the prose beside it: the row is held whole rather
    // than cleaned into a plausible-looking remainder and indexed.
    expect(JSON.stringify(corpus)).not.toContain("api/admin/directory")
    expect(JSON.stringify(corpus)).not.toContain(ACTIVE_DETAIL)
  })

  it("marks a row PostgreSQL has held untouched for two years STALE, and still projects it", async () => {
    const corpus = await corpusForA()
    const ledger = corpus.find((d) => d.title === `A: ${SHARED_TERM} ledger`)

    expect(ledger).toBeDefined()
    expect(ledger!.state).toBe("STALE")
    expect(ledger!.citation.state).toBe("STALE")
    // Not the clock: the row's own `updatedAt`, read back out of the database.
    expect(ledger!.citation.versionAt).toBe(AGED.toISOString())
    // Answerable and labelled. §3.5 asks that freshness be SHOWN; withholding
    // this would substitute "there is nothing" for "this may be out of date".
    expect(ledger!.body).toContain(STALE_DETAIL)
  })

  it("stamps a checkable citation on every row it builds", async () => {
    const corpus = await corpusForA()
    expect(corpus.length).toBeGreaterThan(0)

    for (const d of corpus) {
      // The tenant comes from the OPEN SCOPE, not from the row: a citation that
      // read the tenant off the row would be the row asserting its own tenancy,
      // which is what principle 15 refuses.
      expect(d.citation.ref.tenant).toBe(INST_A)
      expect(d.citation.ref.provider).toBe("tenure")
      expect(d.citation.ref.externalId).toBe(d.id)
      expect(d.citation.assertion).toBe("RECORD")
      expect(d.citation.state).toBe(d.state)
      expect(d.citation.versionAt).toBe(d.asOf.toISOString())
      // The governed deep link — an internal path, minted rather than copied.
      expect(d.citation.href).toBe(d.href)
    }
  })
})
