import type { DirectoryKind } from "@prisma/client"
import { db } from "@/lib/db"

/**
 * The University directory seam.
 *
 * Administrators pick real people when assigning roles. Today that data comes
 * from the seeded `DirectoryPerson` roster (imported from the OSE spreadsheets);
 * tomorrow it comes from the University of Rochester directory over LDAP / SCIM
 * / a REST API. Everything above this file talks to `DirectoryProvider`, so
 * swapping the source is a one-line change here with zero UI impact.
 */
export interface DirectoryEntry {
  id: string
  name: string
  email: string
  kind: DirectoryKind
  affiliation: string | null
}

export interface DirectoryProvider {
  /** Typeahead search over name + email. */
  search(query: string, opts?: { limit?: number; kind?: DirectoryKind }): Promise<DirectoryEntry[]>
  /** Exact lookup by email. */
  getByEmail(email: string): Promise<DirectoryEntry | null>
}

/**
 * Default provider — the seeded directory. Reads DirectoryPerson, which is
 * displayed/searchable/emailable but is deliberately NOT a login account
 * (see prisma/schema.prisma). A real UoR provider implements this same shape.
 */
class SeededDirectoryProvider implements DirectoryProvider {
  async search(query: string, opts?: { limit?: number; kind?: DirectoryKind }): Promise<DirectoryEntry[]> {
    const q = query.trim()
    const people = await db.directoryPerson.findMany({
      where: {
        ...(opts?.kind ? { kind: opts.kind } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      take: opts?.limit ?? 12,
      select: { id: true, name: true, email: true, kind: true, affiliation: true },
    })
    return people
  }

  async getByEmail(email: string): Promise<DirectoryEntry | null> {
    return db.directoryPerson.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, name: true, email: true, kind: true, affiliation: true },
    })
  }
}

let provider: DirectoryProvider = new SeededDirectoryProvider()

/** The active directory provider. Swap here to integrate a real UoR source. */
export function directory(): DirectoryProvider {
  return provider
}

/** Test/integration hook to inject an alternate provider. */
export function setDirectoryProvider(p: DirectoryProvider) {
  provider = p
}
