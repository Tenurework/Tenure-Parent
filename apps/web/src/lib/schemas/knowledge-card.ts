import { z } from "zod"

export const KnowledgeCardTypeEnum = z.enum([
  "CONTACT",
  "PLAYBOOK",
  "BUDGET",
  "VENDOR",
  "LESSON",
  "THREAD",
  "CREDENTIAL",
  "DEADLINE",
])

export type KnowledgeCardType = z.infer<typeof KnowledgeCardTypeEnum>

export const knowledgeCardSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be 200 characters or fewer"),
  type: KnowledgeCardTypeEnum,
  content: z.record(z.unknown()),
  roleId: z.string().cuid().optional(),
})

export type KnowledgeCardInput = z.infer<typeof knowledgeCardSchema>
