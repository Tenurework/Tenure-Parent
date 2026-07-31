import "server-only"
import { cache } from "react"

import { db } from "@/lib/db"
import { terminologyFor, type Terminology } from "./system-config"

/**
 * Terminology for an institution, looked up by its database id.
 *
 * Call sites carry `institutionId` (a cuid) because that is what the schema
 * uses; configuration is keyed by slug because a slug is what a human writes in
 * a blueprint binding. This is the one place that bridges the two, rather than
 * every caller learning to.
 *
 * `Institution` is platform-global in `tenancy/registry.ts`, so reading it needs
 * no tenant scope and no unscoped grant — the row *is* the tenant.
 *
 * `React.cache` deduplicates within a request. That is safe here specifically
 * because the memo key is the institution id: a per-request cache holding
 * tenant-derived data would otherwise be exactly the leak ADR-0002 warns about,
 * where a cached loader returns one tenant's rows to another. Keying on the
 * tenant is what makes it a cache rather than a cross-tenant hazard.
 */
export const terminologyForInstitution = cache(
  async (institutionId: string): Promise<Terminology> => {
    const institution = await db.institution.findUnique({
      where: { id: institutionId },
      select: { slug: true },
    })

    // An id with no row is a caller bug, not a tenant without configuration, but
    // it resolves the same way: platform defaults. These keys are words on a
    // screen — see the note on resolveSystemConfig — so the failure mode is
    // generic wording, not a broken page.
    return terminologyFor(institution?.slug ?? "")
  },
)
