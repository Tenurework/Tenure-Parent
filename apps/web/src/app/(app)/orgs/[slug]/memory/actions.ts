"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canContribute, getUserContext } from "@/lib/rbac"
import { knowledgeCardSchema } from "@/lib/schemas/knowledge-card"

export async function createMemoryCard(slug: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  const userId = session.user.id

  const org = await db.organization.findUnique({ where: { slug } })
  if (!org) throw new Error("Organization not found")

  const ctx = await getUserContext(userId)
  if (!canContribute(ctx, org)) throw new Error("You need an active role to add memory")

  const roleIdRaw = String(formData.get("roleId") ?? "")
  const parsed = knowledgeCardSchema.safeParse({
    title: String(formData.get("title") ?? "").trim(),
    type: String(formData.get("type") ?? ""),
    content: { body: String(formData.get("body") ?? "").trim() },
    roleId: roleIdRaw || undefined,
  })
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid card")

  if (parsed.data.roleId) {
    const role = await db.role.findFirst({
      where: { id: parsed.data.roleId, organizationId: org.id },
    })
    if (!role) throw new Error("Role not found in this club")
  }

  await db.$transaction([
    db.memoryRecord.create({
      data: {
        institutionId: org.institutionId,
        organizationId: org.id,
        roleId: parsed.data.roleId ?? null,
        title: parsed.data.title,
        type: parsed.data.type,
        content: parsed.data.content as object,
        authorId: userId,
      },
    }),
    db.auditEvent.create({
      data: {
        institutionId: org.institutionId,
        organizationId: org.id,
        actorId: userId,
        action: "Memory.CardCreated",
        resourceType: "MemoryRecord",
        outcome: "ALLOW",
      },
    }),
  ])

  revalidatePath(`/orgs/${slug}/memory`)
}
