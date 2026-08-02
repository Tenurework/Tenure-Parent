import { createHash, timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { db } from "@/lib/db"
import { exportTenant } from "@/lib/platform/tenant-export"

export const dynamic = "force-dynamic"

/**
 * Everything one tenant owns, for the operator plane.
 *
 * ## Why this is not a session-authenticated route (GE-033-001)
 *
 * It used to authenticate with the customer app's own session and then check
 * the signed-in address against the platform-operator list. That made it a
 * **hidden super-admin route inside the customer application**, which Bible
 * §4.2 forbids in as many words — "It is not a hidden 'super admin' route in
 * the customer application."
 *
 * The concrete consequence, not the principle: a browser session on the tenant
 * origin could dump any tenant in the fleet. Anything that compromises a
 * customer-app session belonging to an operator — a stolen cookie, an XSS on a
 * tenant page, a shared laptop — becomes fleet-wide data access, through the
 * customer app's CSRF posture, on the customer app's deploy cadence, and
 * invisible to the operator plane's audit.
 *
 * The operator plane cannot simply own the endpoint instead: the export reads
 * the tenant's Postgres, and the Studio is control plane with no cell database.
 * That separation is deliberate (`cell-independence` enforces it). So the
 * endpoint stays where the data is, and what changes is who may call it — the
 * control plane as a service, not a person with a browser.
 *
 * `/api/platform/reconcile` already established this pattern for the inbound
 * direction, with the same reasoning. This is the outbound one.
 */

function secretsMatch(provided: string, expected: string): boolean {
  // Hashed to a fixed width first: `timingSafeEqual` throws on a length
  // mismatch, and the throw would itself leak the length of the secret.
  const a = createHash("sha256").update(provided).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const expected = process.env.PLATFORM_EXPORT_SECRET
  if (!expected) {
    // Fail closed, and say which variable. An operator seeing this needs to
    // know it is configuration rather than credentials — and a cell that has
    // not been given the secret must export nothing rather than fall back to
    // some other notion of who is allowed.
    return NextResponse.json(
      { error: "PLATFORM_EXPORT_SECRET is not configured; this cell exports nothing." },
      { status: 503 },
    )
  }

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  // 404, not 401: the existence of an endpoint that dumps a customer's data is
  // not something to confirm to whoever is asking.
  if (!provided || !secretsMatch(provided, expected)) {
    return new NextResponse("Not found", { status: 404 })
  }

  // Who asked, for the audit record inside the export. Required, because an
  // export is evidence and "some caller with the secret" is not an answer to
  // "who took a copy of this tenant's data".
  const requestedBy = request.headers.get("x-tenure-operator")?.trim()
  if (!requestedBy) {
    return NextResponse.json(
      { error: "x-tenure-operator is required; an export must record who took it." },
      { status: 400 },
    )
  }

  const { slug } = await params

  // Institution is platform-global, so this read needs no tenant scope — the
  // row IS the tenant, and resolving it is how the scope below is opened.
  const institution = await db.institution.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  })
  if (!institution) {
    return new NextResponse("Not found", { status: 404 })
  }

  // The export runs inside that tenant's scope, so the filtering is the
  // application's own chokepoint rather than clauses written for this route.
  // That matters more here than anywhere else: a leak in an export lands inside
  // a file that is about to be handed to someone outside the tenant.
  const dump = await exportTenant(institution.id, institution.slug, {
    at: new Date().toISOString(),
    requestedBy,
  })

  return new NextResponse(JSON.stringify(dump, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // A dated filename, because an export is evidence and two of them should
      // not overwrite each other in a downloads folder.
      "Content-Disposition": `attachment; filename="tenure-export-${institution.slug}-${dump.exportedAt.slice(0, 10)}.json"`,
      // Never cached: it is one tenant's data, and a shared cache keyed on the
      // URL alone would serve it to the next requester.
      "Cache-Control": "no-store, private",
    },
  })
}
