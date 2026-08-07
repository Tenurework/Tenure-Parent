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
      { institutionId: inst, actor: { principalId: "seed", principalType: "system" } },
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
            content: `Tenant ${label} learned something about ${SHARED_TERM}.`,
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
      { institutionId: INST_A, actor: { principalId: USER_A, principalType: "user" } },
      () => loadSearchCorpus(USER_A),
    )
    const titles = corpus.map((d) => d.title)
    expect(titles.some((t) => t.startsWith("A: "))).toBe(true)
  })

  it("never returns B's records to A, though both contain the same term", async () => {
    // The failure this exists to catch: a corpus wide enough that a search box
    // becomes a cross-tenant read for whoever guesses a word.
    const corpus = await runInTenantScope(
      { institutionId: INST_A, actor: { principalId: USER_A, principalType: "user" } },
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
      { institutionId: INST_B, actor: { principalId: USER_B, principalType: "user" } },
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
      { institutionId: INST_A, actor: { principalId: `stranger-${SUFFIX}`, principalType: "user" } },
      () => loadSearchCorpus(`stranger-${SUFFIX}`),
    )
    expect(corpus.filter((d) => d.title.includes(SHARED_TERM))).toEqual([])

    await runUnscoped("migration", "search isolation stranger cleanup", async () => {
      await db.user.deleteMany({ where: { id: `stranger-${SUFFIX}` } })
    })
  })
})
