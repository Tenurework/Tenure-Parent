import { knowledgeCardSchema, KnowledgeCardTypeEnum } from "./knowledge-card"

describe("knowledgeCardSchema", () => {
  it("validates a valid contact card", () => {
    const result = knowledgeCardSchema.safeParse({
      title: "IBM Sponsor Contact",
      type: "CONTACT",
      content: { name: "Jane Doe", email: "jane@ibm.com", phone: "+1 555-0100" },
    })
    expect(result.success).toBe(true)
  })

  it("rejects an empty title", () => {
    const result = knowledgeCardSchema.safeParse({
      title: "",
      type: "CONTACT",
      content: {},
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Title is required")
    }
  })

  it("rejects a title over 200 characters", () => {
    const result = knowledgeCardSchema.safeParse({
      title: "a".repeat(201),
      type: "PLAYBOOK",
      content: {},
    })
    expect(result.success).toBe(false)
  })

  it("rejects an invalid card type", () => {
    const result = knowledgeCardSchema.safeParse({
      title: "Test Card",
      type: "INVALID_TYPE",
      content: {},
    })
    expect(result.success).toBe(false)
  })

  it("accepts all valid card types", () => {
    const types = KnowledgeCardTypeEnum.options
    for (const type of types) {
      const result = knowledgeCardSchema.safeParse({ title: "Test", type, content: {} })
      expect(result.success).toBe(true)
    }
  })

  it("accepts an optional roleId", () => {
    const withRole = knowledgeCardSchema.safeParse({
      title: "Annual Budget",
      type: "BUDGET",
      content: { total: 50000 },
      roleId: "cm0abc123def456ghi789jkl",
    })
    expect(withRole.success).toBe(true)
    const withoutRole = knowledgeCardSchema.safeParse({
      title: "Annual Budget",
      type: "BUDGET",
      content: { total: 50000 },
    })
    expect(withoutRole.success).toBe(true)
    // roleId must be a valid cuid if provided
    const withBadRole = knowledgeCardSchema.safeParse({
      title: "Annual Budget",
      type: "BUDGET",
      content: {},
      roleId: "not-a-cuid",
    })
    expect(withBadRole.success).toBe(false)
  })
})
