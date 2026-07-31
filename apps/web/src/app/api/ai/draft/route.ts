import { auth } from "@/lib/auth"
import { aiConfigured, draftText } from "@/lib/ai"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (!aiConfigured()) return Response.json({ error: "ai_disabled" }, { status: 503 })

  const { kind, instruction } = (await req.json().catch(() => ({}))) as {
    kind?: string
    instruction?: string
  }
  if (!instruction?.trim() || !["message", "memory", "event"].includes(kind ?? ""))
    return Response.json({ error: "bad_request" }, { status: 400 })

  const text = await draftText(kind as "message" | "memory" | "event", instruction.trim())
  if (!text) return Response.json({ error: "generation_failed" }, { status: 502 })
  return Response.json({ text })
}
