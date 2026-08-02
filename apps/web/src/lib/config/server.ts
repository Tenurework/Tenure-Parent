import "server-only"
import { cache } from "react"

import { db } from "@/lib/db"
import {
  decideFlag,
  recordFlagExposure,
  resolveSystemConfig,
  terminologyFor,
  type FlagDecision,
  type FlagName,
  type Terminology,
} from "@tenure/platform-config"

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

/**
 * A feature flag's decision for one subject in one institution.
 *
 * The same id→slug bridge as above, for the same reason: call sites carry a
 * cuid, the configuration engine is keyed by slug, and one file should know
 * that rather than every route.
 *
 * `subjectId` is what the cohort bucket is computed from — the acting user, so
 * a rollout percentage means "this fraction of people", stable across their
 * requests and sessions.
 *
 * An institution with no binding resolves to platform defaults, which under the
 * restrict-only law in `flags.ts` is the most a tenant could ever be granted and
 * is exactly what every tenant had before flags existed. It is not a fail-open:
 * this decision runs *after* the caller's own `auth()` and capability checks and
 * can only subtract from them.
 *
 * `React.cache` keyed on (institutionId, flag, subjectId) — tenant-keyed, so it
 * is a request-scoped memo rather than the cross-tenant hazard ADR-0002 warns
 * about, same as `terminologyForInstitution`.
 */
export const flagDecisionForInstitution = cache(
  async (institutionId: string, flag: FlagName, subjectId: string): Promise<FlagDecision> => {
    const institution = await db.institution.findUnique({
      where: { id: institutionId },
      select: { slug: true },
    })

    const decision = decideFlag(resolveSystemConfig(institution?.slug ?? ""), flag, subjectId)

    // Counted here rather than at each route, so a new consumer of a flag
    // cannot forget to. Counts only — (flag, reason) — never who; see
    // exposure.ts for why an exposure log keyed by person is not built.
    recordFlagExposure(decision)

    return decision
  },
)
