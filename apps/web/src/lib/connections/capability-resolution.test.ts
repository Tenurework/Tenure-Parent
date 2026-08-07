import { resolveCapability, type CapabilityState } from "@/lib/connections/capability-resolution"

const base: CapabilityState = {
  key: "ai.model",
  label: "Tenure AI model",
  certified: true,
  configured: false,
  connectableBy: "admin",
}

describe("resolveCapability", () => {
  it("a non-certified capability never yields a connect action", () => {
    // The rule from WRK-030-005, and the one this table exists to keep. Every
    // other field is set to the most connect-shaped values there are — the
    // viewer could connect it themselves, it is unconfigured, it is reachable
    // — so the only thing stopping a connect action is the certification flag.
    const resolved = resolveCapability({
      ...base,
      certified: false,
      connectableBy: "user",
      reachable: true,
    })

    expect(resolved.outcome).toBe("NOT_CERTIFIED")
    expect(resolved.action.kind).toBe("none")
    expect(resolved.action.kind).not.toBe("connect")
    expect(resolved.action.label).toBe("")
  })

  it("an unconfigured tenant-wide capability sends the viewer to an administrator", () => {
    const resolved = resolveCapability(base)
    expect(resolved.outcome).toBe("NEEDS_ADMIN")
    expect(resolved.action.kind).toBe("ask-admin")
    expect(resolved.owner).toMatch(/administrator/i)
  })

  it("an unconfigured per-user capability is the viewer's own to connect", () => {
    const resolved = resolveCapability({ ...base, key: "calendar.feed", connectableBy: "user" })
    expect(resolved.outcome).toBe("NEEDS_USER_CONNECT")
    expect(resolved.action.kind).toBe("connect")
  })

  it("configured and reachable is CONNECTED", () => {
    const resolved = resolveCapability({ ...base, configured: true, reachable: true })
    expect(resolved.outcome).toBe("CONNECTED")
    expect(resolved.action.kind).toBe("none")
  })

  it("configured but out of partition is UNAVAILABLE, and offers no connect", () => {
    // src/lib/ai.ts aiConfigured(): a key is set and api.anthropic.com is not
    // in this cell's partition. Offering "Connect" would ask someone to fix a
    // setting that is already correct.
    const resolved = resolveCapability({ ...base, configured: true, reachable: false })
    expect(resolved.outcome).toBe("UNAVAILABLE")
    expect(resolved.action.kind).toBe("none")
    expect(resolved.explanation).toMatch(/cannot be reached/i)
  })
})
