import { ROLE_TEMPLATES } from "@tenure/authorization"

import { credentialExpiry } from "@/lib/auth-connections"
import {
  capabilityAdministrators,
  resolveCapability,
  statusWord,
  type CapabilityState,
  type ConnectionOutcome,
} from "@/lib/connections/capability-resolution"

/**
 * WRK-030-004 / WRK-110-001 — the decision vocabulary, and the word each
 * outcome earns.
 *
 * The credential fixtures go through `credentialExpiry`, which is the only
 * function that can mint a `CapabilityCredential`: a test that hand-wrote
 * `{ expired: true }` would prove the resolver reads a boolean and prove
 * nothing about the expiry rule the application actually applies.
 */
const NOW = new Date("2026-08-07T00:00:00.000Z")

const base: CapabilityState = {
  key: "ai.model",
  label: "Tenure AI model",
  certified: true,
  configured: false,
  connectableBy: "admin",
  requiredScopes: [],
  grantedScopes: [],
  credential: null,
  ...capabilityAdministrators("ai.model"),
  alternative: null,
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

  it("names the alternative source rather than leaving a dead end", () => {
    // WRK-030-004's alternative-source path. The prose used to be hand-written
    // beside the card in settings/page.tsx, where it could contradict the
    // outcome it sat under; the resolution carries it now.
    const resolved = resolveCapability({
      ...base,
      certified: false,
      alternative: "Retrieval and search keep working without it.",
    })

    expect(resolved.outcome).toBe("NOT_CERTIFIED")
    expect(resolved.alternative).toBe("Retrieval and search keep working without it.")
  })

  it("says nothing about alternatives for a capability that is working", () => {
    const resolved = resolveCapability({
      ...base,
      configured: true,
      alternative: "Retrieval and search keep working without it.",
    })

    expect(resolved.outcome).toBe("CONNECTED")
    expect(resolved.alternative).toBeNull()
  })

  it("an unconfigured tenant-wide capability sends the viewer to an administrator", () => {
    const resolved = resolveCapability(base)
    expect(resolved.outcome).toBe("NEEDS_ADMIN")
    expect(resolved.action.kind).toBe("ask-admin")
    expect(resolved.owner).toMatch(/administrator/i)
  })

  // ── WRK-110-005: ask-admin names a role that exists ───────────────────────

  it("names the shipped roles that can actually clear it, per capability", () => {
    // Resolved through `rolesGranting` over ROLE_TEMPLATES — the same catalog
    // `invokeRelayTool` resolves `grantedByRoles` from. Two capabilities, two
    // DIFFERENT answers, which is what makes this a derivation rather than a
    // constant: `config.setting.update` is `platform.administrator`'s, and
    // `identity.connection.configure` was split out of that bundle by the
    // duties matrix into `identity.administrator`.
    const model = resolveCapability(base)
    expect(model.action.kind).toBe("ask-admin")
    expect(model.owner).toContain("platform.administrator")
    expect(model.owner).not.toContain("identity.administrator")

    const sso = resolveCapability({
      ...base,
      key: "identity.sso",
      label: "Single sign-on",
      ...capabilityAdministrators("identity.sso"),
    })
    expect(sso.action.kind).toBe("ask-admin")
    expect(sso.owner).toContain("identity.administrator")
    expect(sso.owner).not.toContain("platform.administrator")
  })

  it("every role it names is one the shipped catalog actually carries", () => {
    // The property the requirement is: "so it can never name a nonexistent
    // role". Read off the resolution and checked against the catalog itself, so
    // a table that drifted to a role somebody deleted fails here rather than in
    // front of a student trying to find that person.
    for (const key of ["ai.model", "documents.storage", "identity.sso"]) {
      const resolved = resolveCapability({ ...base, key, ...capabilityAdministrators(key) })
      const named = ROLE_TEMPLATES.map((t) => t.key).filter((k) => resolved.owner.includes(k))
      expect(named.length).toBeGreaterThan(0)
    }
  })

  it("offers no ask-admin at all when no shipped role can connect it", () => {
    // Fail closed, and it is the same rule NOT_CERTIFIED enforces one branch
    // up: a control nobody is behind teaches somebody that the button is the
    // answer when the button cannot work. `documents.archive` is not a
    // capability this deployment declares, so nothing governs it.
    const resolved = resolveCapability({
      ...base,
      key: "documents.archive",
      ...capabilityAdministrators("documents.archive"),
    })

    expect(resolved.outcome).toBe("NEEDS_ADMIN")
    expect(resolved.action.kind).toBe("none")
    expect(resolved.action.kind).not.toBe("ask-admin")
    expect(resolved.owner).toBe("Your Tenure operator")
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

  // ── WRK-030-004: the paths that had no representation at all ──────────────

  it("a grant that does not cover what the capability needs asks for a scope upgrade", () => {
    const resolved = resolveCapability({
      ...base,
      configured: true,
      requiredScopes: ["calendar.read", "calendar.write"],
      grantedScopes: ["calendar.read"],
    })

    expect(resolved.outcome).toBe("NEEDS_SCOPE_UPGRADE")
    expect(resolved.action.kind).toBe("upgrade-scope")
    // Named, not counted: "one permission is missing" sends somebody to a
    // provider console to guess which.
    expect(resolved.missingScopes).toEqual(["calendar.write"])
    expect(resolved.explanation).toContain("calendar.write")
  })

  it("a grant carrying MORE than is needed is not a scope problem", () => {
    // Membership of the granted set, not equality of the two lists — the same
    // test `providerActivation` applies to a vendor's approved scopes. Without
    // this case a resolver that compared lengths would look correct.
    const resolved = resolveCapability({
      ...base,
      configured: true,
      requiredScopes: ["calendar.read"],
      grantedScopes: ["calendar.read", "calendar.write", "mail.read"],
    })

    expect(resolved.outcome).toBe("CONNECTED")
    expect(resolved.missingScopes).toEqual([])
  })

  it("an expired credential asks for reauthorisation, by the registry's rule", () => {
    const resolved = resolveCapability({
      ...base,
      configured: true,
      credential: credentialExpiry("2026-07-01T00:00:00.000Z", NOW),
    })

    expect(resolved.outcome).toBe("NEEDS_REAUTH")
    expect(resolved.action.kind).toBe("reauthorize")
    expect(resolved.explanation).toContain("2026-07-01")
  })

  it("a credential that expires soon is not a reauth prompt", () => {
    const resolved = resolveCapability({
      ...base,
      configured: true,
      credential: credentialExpiry("2026-08-12T00:00:00.000Z", NOW),
    })
    expect(resolved.outcome).toBe("CONNECTED")
  })

  it("asks for reauthorisation before it asks for more scopes", () => {
    // An expired credential cannot be granted more scopes: sending somebody to
    // a consent screen for a credential that will be rejected is a dead end.
    const resolved = resolveCapability({
      ...base,
      configured: true,
      credential: credentialExpiry("2026-07-01T00:00:00.000Z", NOW),
      requiredScopes: ["calendar.write"],
      grantedScopes: [],
    })
    expect(resolved.outcome).toBe("NEEDS_REAUTH")
  })
})

describe("statusWord", () => {
  it("gives every outcome exactly one of §13.3's words", () => {
    // The mapping is total by construction (a Record over the union), so this
    // asserts the CHOICES rather than the coverage — a table that quietly
    // renamed "Waiting for admin" would still be total.
    const expected: Record<ConnectionOutcome, string> = {
      CONNECTED: "Ready",
      NEEDS_USER_CONNECT: "Disconnected",
      NEEDS_ADMIN: "Waiting for admin",
      NEEDS_SCOPE_UPGRADE: "Limited",
      NEEDS_REAUTH: "Needs your attention",
      NOT_CERTIFIED: "Not available yet",
      UNAVAILABLE: "Temporarily unavailable",
    }

    for (const [outcome, word] of Object.entries(expected)) {
      expect(statusWord(outcome as ConnectionOutcome)).toBe(word)
    }
  })

  it("puts the word on the resolution, so a surface cannot invent its own", () => {
    // The defect WRK-110-001 names: settings/page.tsx printed
    // `outcome === "CONNECTED" ? "Connected" : "Not connected"`, collapsing
    // four different outcomes into one phrase.
    expect(resolveCapability(base).statusWord).toBe("Waiting for admin")
    expect(resolveCapability({ ...base, certified: false }).statusWord).toBe("Not available yet")
    expect(resolveCapability({ ...base, configured: true }).statusWord).toBe("Ready")
    expect(
      resolveCapability({ ...base, configured: true, reachable: false }).statusWord,
    ).toBe("Temporarily unavailable")
  })
})
