import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { openConnectionOpportunity, type ConnectionScope } from "@/lib/connections/pending-intent"
import { withTenantScope } from "@/lib/tenant-scope"
import { TenantContextError } from "@/lib/tenancy/context"

/**
 * WRK-030-002 — where a connection opportunity is opened.
 *
 * The single production minting caller. `ConnectionActionControl`
 * (`src/components/connections/MissingConnectionCard.tsx`) posts an ordinary
 * HTML form here whenever a surface asks it to carry something, and this
 * answers with a 303 to the control's own destination plus an opaque `?launch=`
 * token. Two live paths reach it today, both asserted by
 * `apps/web/e2e/journeys.spec.ts`: the Connection Centre's "Connect Calendar
 * subscription (ICS)" control (J05) and its "Ask an administrator" control for
 * document storage (J06).
 *
 * ## Why a route handler and a real form, not a server action
 *
 * The control has to work identically in three places that do not share a
 * rendering model: the Connection Centre (a server component), the Relay panel
 * (a client component built from a fetch response), and
 * `MissingConnectionCard.test.tsx`, which renders the component to static
 * markup with `renderToStaticMarkup`. A `<form method="post" action="/path">`
 * is a string in all three. It also degrades to a plain browser POST with no
 * JavaScript, which a connect flow — the thing you reach when something is
 * already not working — should.
 *
 * ## Why POST, and why the intent is not in the URL
 *
 * The pending intent is the person's own question. Bible §5.2 forbids raw
 * prompt content in the redirect URL and this is the reason: a URL travels
 * through browser history, the `Referer` header, and every access log between
 * here and the browser. It arrives in a POST body and is stored server-side;
 * what comes back in the URL is an opaque token that means nothing outside the
 * `ConnectionLaunchToken` table.
 */
export const dynamic = "force-dynamic"

/** The person's own words. Bounded here as well as at the column. */
const MAX_INTENT = 2000

export async function POST(request: Request) {
  const session = await auth()
  // Bible §5.3: "redeemable only after current Tenure authentication". The mint
  // side is the same rule — an unauthenticated caller has no session to bind a
  // token to, so there is nothing to open.
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/signin", request.url), 303)
  }
  const userId = session.user.id

  const form = await request.formData()
  const capabilityKey = String(form.get("capabilityKey") ?? "").slice(0, 120)
  const returnPath = String(form.get("returnPath") ?? "")
  const raw = form.get("intent")
  const intent = typeof raw === "string" && raw.trim().length > 0 ? raw.trim().slice(0, MAX_INTENT) : null

  // An in-app path, checked here as well as inside `openConnectionOpportunity`.
  // Both are load-bearing: this one decides what to answer a bad request with
  // (a redirect home, not a 500), and the one in the library is what stops a
  // future caller opening a redirect through a different door.
  if (!capabilityKey || !returnPath.startsWith("/") || returnPath.startsWith("//")) {
    return NextResponse.redirect(new URL("/", request.url), 303)
  }

  let token: string
  try {
    token = await withTenantScope(userId, async (scope) => {
      // Named rather than passed as a bare literal: `ConnectionScope` is two
      // strings, and two strings in the wrong order type-check silently at an
      // argument position. Annotating the object is what makes the compiler
      // check the shape here, where the ids are read, rather than at the
      // boundary where both are already `string`.
      const opportunityScope: ConnectionScope = {
        institutionId: scope.institutionId,
        userId,
      }
      const opened = await openConnectionOpportunity(
        opportunityScope,
        capabilityKey,
        intent,
        returnPath,
      )
      return opened.token
    })
  } catch (error) {
    // A person with no tenant cannot open an opportunity in one. That is a
    // refusal, not a fault, so it lands them where they asked to go rather than
    // paging somebody with a 500.
    if (error instanceof TenantContextError) {
      return NextResponse.redirect(new URL(returnPath, request.url), 303)
    }
    throw error
  }

  // The redirect is built OUTSIDE the tenant scope body, deliberately: a
  // `redirect()` thrown across `runInTenantScope` aborts whatever the scope had
  // in flight, which is why `src/lib/tenancy/context.ts` refuses one outright.
  const destination = new URL(returnPath, request.url)
  destination.searchParams.set("launch", token)
  // 303, not 307: the browser must follow a POST with a GET, or the destination
  // page receives a POST it has no handler for.
  return NextResponse.redirect(destination, 303)
}
