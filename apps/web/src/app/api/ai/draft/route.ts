import { auth } from "@/lib/auth"
import { withTenantScope } from "@/lib/tenant-scope"
import { flagDecisionForInstitution } from "@/lib/config/server"
import { aiConfigured, draftText } from "@/lib/ai"

/**
 * Tenure AI drafting — the instruction and the generated text both cross to the
 * model vendor, so the `aiAssistant` flag gates the whole route rather than
 * degrading it. There is no useful sources-only version of "write me a draft".
 *
 * 403 and 503 are kept distinct on purpose: 403 is "this institution has turned
 * the assistant off", 503 is "no model is configured anywhere". One is a policy
 * a person chose and the other is an operational gap, and a caller that cannot
 * tell them apart will file the wrong ticket.
 *
 * Tenancy is resolved here where it previously was not. That is not incidental:
 * a flag is per-tenant, so a route with no tenant has no flag to check, and the
 * only alternative to resolving one is to send the content anyway. It matches
 * what /api/ai/chat already does, including its failure mode for an account
 * with no institution at all.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 })
  const userId = session.user.id

  return withTenantScope(userId, async (scope) => {
    const flag = await flagDecisionForInstitution(scope.institutionId, "aiAssistant", userId)
    if (!flag.enabled) {
      return Response.json(
        { error: "feature_disabled", flag: flag.flag, reason: flag.reason },
        { status: 403 },
      )
    }

    if (!aiConfigured()) return Response.json({ error: "ai_disabled" }, { status: 503 })

    const { kind, instruction } = (await req.json().catch(() => ({}))) as {
      kind?: string
      instruction?: string
    }
    if (!instruction?.trim() || !["message", "memory", "event"].includes(kind ?? ""))
      return Response.json({ error: "bad_request" }, { status: 400 })

    // WRK-120-004. The tenant this draft is charged to comes from the open
    // scope, which is the same value the flag above was decided for — a route
    // that resolved one tenant for the switch and another for the bill would be
    // metering somebody else's spend.
    const text = await draftText(
      kind as "message" | "memory" | "event",
      instruction.trim(),
      scope.institutionId,
    )
    if (!text) return Response.json({ error: "generation_failed" }, { status: 502 })
    return Response.json({ text })
  })
}
