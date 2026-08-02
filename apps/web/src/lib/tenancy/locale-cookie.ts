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
