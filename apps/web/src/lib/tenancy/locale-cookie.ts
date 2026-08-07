/**
 * GE-022-004 — resolving the document's language and direction.
 *
 * `<html lang>` is what a screen reader picks a voice from (WCAG 3.1.1) and
 * `<html dir>` is what every logical CSS property resolves against. Neither can
 * be set from a nested layout, so the root layout — which also renders
 * `/signin` for people who are not signed in — has to answer both.
 *
 * The config registry is keyed by slug and the acting-tenant cookie holds an
 * **id**, so something has to bridge them. Two sources, in this order:
 *
 *   1. `tenure.acting-slug`, written beside the id cookie when a user switches.
 *      A cache, not an authority.
 *   2. The database, one indexed lookup, when there is no such cookie — which
 *      is every user who has never switched tenants, i.e. most of them. Without
 *      this the first sign-in renders `lang="en"` regardless of configuration,
 *      and only switching would fix it.
 *
 * Reading step 1 from a cookie is safe for exactly one reason: it decides
 * **nothing**. A forged value changes date formatting and which way text runs.
 * It cannot select a tenant, reach a row, or widen a permission —
 * `resolveTenantScope` re-derives membership from the database on every request
 * and never consults this, which `lib/tenant-switching.itest.ts` proves from
 * the other side by revoking a membership mid-session.
 */
import "server-only"
import { cache } from "react"
import { cookies } from "next/headers"

import { localizationFor, type Localization } from "@tenure/platform-config"

import { db } from "@/lib/db"
import { ACTING_INSTITUTION_COOKIE } from "@/lib/tenant-scope"

export const ACTING_TENANT_SLUG_COOKIE = "tenure.acting-slug"

/**
 * Not httpOnly, deliberately: nothing depends on it being unreadable, and a
 * client formatting a date should be able to see what the server formatted it
 * as. Marking it httpOnly would imply it carries something worth hiding.
 */
export const LOCALE_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: "lax",
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
} as const

/**
 * Rule (1) of the `React.cache()` invariant stated beside `runInTenantScope`
 * (`./context.ts`, `docs/architecture/REVIEW-FINDINGS.md:54`): `Institution` is
 * PLATFORM_GLOBAL in `./registry.ts`, so the query layer applies no tenant
 * predicate to this read and the answer cannot vary with which scope happens to
 * be open when the memo is first filled. The `institutionId` in the key is what
 * the answer actually depends on.
 */
const slugForInstitution = cache(async (institutionId: string): Promise<string | null> => {
  const row = await db.institution.findUnique({
    where: { id: institutionId },
    select: { slug: true },
  })
  return row?.slug ?? null
})

/**
 * The localization the document should be rendered in.
 *
 * Falls back to the platform default rather than throwing, at every step.
 * Formatting is not an authority decision, and a visitor who is not signed in,
 * a slug with no binding, and a deleted institution should all produce a
 * correct document rather than a 500 on the root layout — which would take
 * every page down, including the sign-in page needed to recover.
 *
 * ## Why this one takes no key at all
 *
 * Rule (1) again, and it has to be said out loud because the shape looks like
 * the defect: a `cache()`d function with an EMPTY argument list memoises one
 * value for the whole request, so if it could reach a tenant-scoped row it would
 * be `viewerTimeZone`'s bug with no key to fix it. It cannot. The only database
 * read it reaches is `slugForInstitution` above, on PLATFORM_GLOBAL
 * `Institution`; everything else here is a cookie and a pure lookup in
 * `@tenure/platform-config`.
 *
 * Keying it would also be wrong rather than merely redundant. This resolves
 * `<html lang>` and `<html dir>` for the ROOT layout, and a Next request renders
 * exactly one document — so "the tenant this document is for" is a property of
 * the request, not an argument any caller could supply. If a second db read is
 * ever added here it must be on a platform-global model, or this function has to
 * take the institution and the root layout has to find one before it renders,
 * which is the deadlock ADR-0002 describes.
 */
export const documentLocalization = cache(async (): Promise<Localization> => {
  try {
    const jar = await cookies()

    const cached = jar.get(ACTING_TENANT_SLUG_COOKIE)?.value
    if (cached) return localizationFor(cached)

    const institutionId = jar.get(ACTING_INSTITUTION_COOKIE)?.value
    if (!institutionId) return localizationFor("")

    return localizationFor((await slugForInstitution(institutionId)) ?? "")
  } catch {
    // No request to read a cookie from — a static render, a script, a test.
    return localizationFor("")
  }
})
