import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPlatformOperator } from "@/lib/platform/operator"
import { exportTenant } from "@/lib/platform/tenant-export"

export const dynamic = "force-dynamic"

/**
 * Download everything one tenant owns.
 *
 * Platform-operator only, and 404 rather than 403 for everyone else — the same
 * reasoning as the Studio page: the existence of an endpoint that dumps another
 * customer's data is not something to confirm to a customer.
 *
 * The tenant is resolved from a slug and the export runs inside that tenant's
 * scope, so the filtering is the application's own chokepoint rather than
 * clauses written specially for this route. That matters more here than
 * anywhere else in the product: a leak in an export lands inside a file that is
 * about to be handed to someone outside the tenant.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth()
  if (!session?.user || !isPlatformOperator(session.user.email)) {
    return new NextResponse("Not found", { status: 404 })
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

  const dump = await exportTenant(institution.id, institution.slug, {
    at: new Date().toISOString(),
    requestedBy: session.user.email ?? "operator",
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
