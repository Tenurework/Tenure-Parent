"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/lib/auth"
import { requireCapability } from "@/lib/admin/guard"
import { withTenantScope } from "@/lib/tenant-scope"
import { replay } from "@/lib/outbox/outbox"
import { prismaOutboxPorts } from "@/lib/outbox/prisma-ports"

/**
 * PAY-020-005 / PAY-140-007 — the operator half of the dead-letter path.
 *
 * `replay()` in outbox.ts has enforced explicit-ids-only since it was written,
 * and had no caller: no route, no action, no page. A dead-letter queue nobody
 * can act on is a table, not a control — and "replay everything" is the button
 * an operator reaches for at 2am, which is why the function refuses it and this
 * action can only ever pass the one id the form submitted.
 *
 * Gated on `outbox.redrive` rather than on "is an admin": redriving re-runs
 * whatever the event causes, so it is a Director's decision, and
 * `requireCapability` writes the audit row for the allow and for the deny.
 */
export async function redriveOutboxEvent(formData: FormData): Promise<void> {
  const outboxId = String(formData.get("outboxId") ?? "").trim()
  if (!outboxId) throw new Error("An event id is required.")

  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")

  await withTenantScope(session.user.id, async () => {
    const { institutionId } = await requireCapability("outbox.redrive", {
      resourceType: "OutboxEvent",
      resourceId: outboxId,
      // The id and nothing else. The event's payload is precisely what
      // PAY-020-006 keeps out of an append-only table, and an audit row that
      // carried it would be the leak the refusal in `outboxEventRow` prevents,
      // arriving by a different door.
      metadata: { redrive: "single" },
    })

    const ports = prismaOutboxPorts({ institutionId })
    const outcome = await replay(ports, [outboxId], { at: new Date().toISOString() })

    // Refused means the record is not dead — someone else already redrove it,
    // or it never died. Requeuing it anyway would duplicate a record that is
    // pending or in flight, the one duplication the outbox refuses.
    if (outcome.refused.length > 0) {
      throw new Error(
        "That event is no longer dead-lettered — it may already have been redriven. Reload to see where it stands.",
      )
    }
  })

  revalidatePath("/admin")
}
