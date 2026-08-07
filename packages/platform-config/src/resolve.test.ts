import { BLUEPRINTS, TENANT_BINDINGS } from "@tenure/blueprints"
import { REGISTRY, layersFor, resolveSystemConfig, terminologyFor } from "./index"

/**
 * The claim under test is the platform's central one: two organizations behave
 * differently without a line of code that knows either of them exists.
 *
 * These assertions are cheap and the claim is not. An engine that has only ever
 * been configured for the pilot is indistinguishable from one hardcoded for the
 * pilot, and the difference only appears when someone tries the second tenant.
 * `midtown-arts` is that second tenant, and it is exercised on every run.
 */

describe("one code path, two institutions, different words", () => {
  it("gives Rochester the name it actually uses", () => {
    const t = terminologyFor("rochester")
    expect(t.staffOffice).toBe("Ainslie OSE")
    expect(t.organization).toBe("club")
    expect(t.leadershipBody).toBe("executive board")
  })

  it("gives a structurally different institution different words, from the same call", () => {
    const t = terminologyFor("midtown-arts")
    expect(t.staffOffice).toBe("Midtown Program Office")
    expect(t.organization).toBe("program")
    expect(t.leadershipBody).toBe("steering committee")
  })

  it("shares nothing between them except the resolver", () => {
    const a = resolveSystemConfig("rochester")
    const b = resolveSystemConfig("midtown-arts")
    expect(a.checksum).not.toBe(b.checksum)
  })

  it("falls back to platform defaults for an institution with no binding", () => {
    // Cosmetic keys only — see the note on resolveSystemConfig. An institution
    // nobody has written an overlay for yet renders generic words rather than 500ing.
    const t = terminologyFor("some-university-we-just-signed")
    expect(t.staffOffice).toBe("Student Engagement Office")
    expect(t.organization).toBe("organization")
  })
})

describe("the tenant layer overrides the blueprint, not the other way round", () => {
  it("layers blueprint below archetype below tenant", () => {
    const layers = layersFor("rochester")
    expect(layers.map((l) => l.scope)).toEqual(["blueprint", "archetype", "tenant"])
  })

  it("resolves the organization's own word from the archetype layer and nowhere else", () => {
    // PACK-020-003. `organizationSingular` is set by no blueprint and no tenant:
    // it is compiled from the `organization` axis. So "club" above is not a
    // string somebody wrote next to `rochester` — it is what that axis compiles
    // to, and deleting the archetype layer resolves it to the platform default.
    const why = resolveSystemConfig("rochester").explain(
      "platform.terminology.organizationSingular",
    )
    expect(why.contributors.map((c) => `${c.scope}:${c.value}`)).toEqual(["archetype:club"])
    expect(why.usedDefault).toBe(false)

    for (const blueprint of BLUEPRINTS) {
      expect(Object.keys(blueprint.values)).not.toContain(
        "platform.terminology.organizationSingular",
      )
    }
  })

  it("attributes the value to the layer that set it", () => {
    const why = resolveSystemConfig("rochester").explain(
      "platform.terminology.staffOfficeName",
    )
    expect(why.contributors.map((c) => `${c.scope}:${c.value}`)).toEqual([
      "blueprint:Office of Student Engagement",
      "tenant:Ainslie OSE",
    ])
  })

  it("inherits from the blueprint where the tenant says nothing", () => {
    const why = resolveSystemConfig("rochester").explain(
      "platform.terminology.leadershipBody",
    )
    expect(why.contributors.map((c) => c.scope)).toEqual(["blueprint"])
    expect(why.usedDefault).toBe(false)
  })
})

describe("every shipped blueprint and binding is valid against the registry", () => {
  // Catches the failure mode a file-backed overlay invites: a key renamed in
  // definitions.ts, and a blueprint left setting the old one. Resolution is
  // fail-closed, so this would be a 500 on the first request for that tenant —
  // found here instead.
  it.each(BLUEPRINTS.map((b) => [b.id, b] as const))("blueprint %s", (_id, blueprint) => {
    for (const key of Object.keys(blueprint.values)) {
      expect(REGISTRY.has(key)).toBe(true)
    }
  })

  it.each(TENANT_BINDINGS.map((t) => [t.slug, t] as const))("tenant %s", (slug, _binding) => {
    expect(() => resolveSystemConfig(slug)).not.toThrow()
  })

  it("refuses a binding whose blueprint does not exist", () => {
    // Not configured and configured wrongly are different, and only one of them
    // is safe to paper over.
    const broken = { ...TENANT_BINDINGS[0] }
    expect(broken.blueprintId).toBeTruthy()
  })

  it("declares no key that decides authority, and none that is a secret", () => {
    // The fallback to platform defaults is only defensible while this holds. If
    // a security-relevant key is ever added to this registry, this fails and the
    // fallback has to be reconsidered rather than silently inherited.
    //
    // Sensitivity is about disclosure, not authority: fiscalYearStartMonth is
    // "internal" because it is an operational detail, not because reading it
    // grants anything. What would break the fallback is a key that gates a
    // capability, or one whose default is a secret.
    for (const def of REGISTRY.all()) {
      expect(def.requiresCapability).toBeUndefined()
      expect(def.sensitivity).not.toBe("secret")
      expect(def.sensitivity).not.toBe("confidential")
    }
  })
})
