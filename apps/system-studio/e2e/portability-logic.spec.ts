import { test, expect } from "@playwright/test"

import { REGISTRY } from "@tenure/platform-config"
import { MANIFEST_VERSION, type TenantManifest } from "@tenure/provisioning"

import {
  BUNDLE_VERSION,
  PortabilityRefused,
  bundleLeaks,
  bundleLines,
  exportBundle,
  importBundle,
  type PortableBundle,
} from "../src/lib/portability/bundle"
import { cloneLines, cloneTenant } from "../src/lib/portability/clone"

/**
 * STUDIO-040-008 and STUDIO-040-009, with no browser and no server.
 *
 * The definitions come from the REAL configuration registry wherever the
 * property should hold over what ships. `confidential` and `secret` keys are
 * supplied by hand for one reason, stated rather than hidden: the platform
 * registry declares none today, so a test that only used the real registry
 * would pass by never exercising the branch that withholds them — which is the
 * branch that matters.
 */

const REAL_PUBLIC_KEY = "platform.terminology.staffOfficeName"

function manifest(overrides: Partial<TenantManifest> = {}): TenantManifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    slug: "simon",
    legalName: "Simon Business School",
    displayName: "Simon",
    blueprintId: "graduate-business-school",
    modules: ["approvals", "memory"],
    entitlements: ["approvals.core"],
    region: "us-east-1",
    isolation: "pooled",
    coexistence: "TENURE_PRIMARY",
    systemOfRecord: {},
    configuration: { [REAL_PUBLIC_KEY]: "Student Engagement Office" },
    secretRefs: { stripe: "secretsmanager:tenure/simon/stripe" },
    initialAdminEmail: "dean@simon.example.edu",
    ...overrides,
  } as TenantManifest
}

const definitions = () =>
  REGISTRY.all().map((d) => ({ key: d.key, sensitivity: d.sensitivity }))

const exportOf = (m: TenantManifest, otherTenants: readonly string[] = []) =>
  exportBundle({
    manifest: m,
    definitions: definitions(),
    engineVersion: "1.4.0",
    otherTenants,
  })

/* ─────────────────────────────────────────────────────── what does not travel ── */

test.describe("the bundle refuses to carry what must not leave", () => {
  test("a secret reference becomes a slot NAME and the pointer is withheld", () => {
    const bundle = exportOf(manifest())
    expect(bundle.secretSlots).toEqual(["stripe"])
    expect(JSON.stringify(bundle.secretSlots)).not.toContain("secretsmanager")
    expect(bundle.withheld.map((w) => w.field)).toContain("secretRefs.stripe")
  })

  test("the administrator's email address does not travel", () => {
    const bundle = exportOf(manifest())
    expect(JSON.stringify(bundle)).not.toContain("dean@simon.example.edu")
    expect(bundle.withheld.map((w) => w.field)).toContain("initialAdminEmail")
  })

  test("a confidential value is withheld and a public one is carried", () => {
    const bundle = exportBundle({
      manifest: manifest({
        configuration: { "x.public": "keep me", "x.secret": "drop me" },
      }),
      definitions: [
        { key: "x.public", sensitivity: "public" },
        { key: "x.secret", sensitivity: "confidential" },
      ],
      engineVersion: "1.4.0",
      otherTenants: [],
    })
    expect(bundle.configuration).toEqual({ "x.public": "keep me" })
    expect(bundle.withheld.find((w) => w.field === "configuration.x.secret")?.reason).toContain(
      "confidential",
    )
  })

  test("a key with no definition anywhere is withheld, not trusted", () => {
    const bundle = exportOf(manifest({ configuration: { "nobody.declared.this": "value" } }))
    expect(bundle.configuration).toEqual({})
    expect(bundle.withheld.find((w) => w.field === "configuration.nobody.declared.this")?.reason).toContain(
      "no definition",
    )
  })

  test("every value that DOES travel is declared public or internal in the real registry", () => {
    const sensitivities = new Map(REGISTRY.all().map((d) => [d.key, d.sensitivity]))
    const bundle = exportOf(manifest())
    for (const key of Object.keys(bundle.configuration)) {
      expect(["public", "internal"]).toContain(sensitivities.get(key))
    }
    expect(Object.keys(bundle.configuration).length).toBeGreaterThan(0)
  })
})

/* ───────────────────────────────────────────────────────────── the self-check ── */

test.describe("the export checks its own output and refuses a leak", () => {
  const leaking = (value: string) =>
    exportBundle({
      manifest: manifest({ configuration: { "x.public": value } }),
      definitions: [{ key: "x.public", sensitivity: "public" }],
      engineVersion: "1.4.0",
      otherTenants: ["other-school"],
    })

  test("an AWS ARN in a public value stops the export", () => {
    expect(() => leaking("arn:aws:s3:::tenure-uploads")).toThrow(PortabilityRefused)
  })

  test("an access key id stops the export", () => {
    expect(() => leaking("AKIAIOSFODNN7EXAMPLE")).toThrow(/access key id/)
  })

  test("a twelve-digit account id stops the export", () => {
    expect(() => leaking("047385673922")).toThrow(/account id/)
  })

  test("another tenant's slug stops the export", () => {
    expect(() => leaking("mirrors other-school settings")).toThrow(/names another tenant/)
  })

  test("a private key block stops the export", () => {
    expect(() => leaking("-----BEGIN RSA PRIVATE KEY-----")).toThrow(/private key/)
  })

  test("the refusal carries the leaks rather than only a sentence", () => {
    try {
      leaking("arn:aws:s3:::tenure-uploads")
      throw new Error("expected a refusal")
    } catch (err) {
      expect(err).toBeInstanceOf(PortabilityRefused)
      expect((err as PortabilityRefused).leaks[0].kind).toBe("aws-arn")
      expect((err as PortabilityRefused).leaks[0].at).toBe("configuration.x.public")
    }
  })

  test("the reasons recorded in `withheld` are not themselves read as leaks", () => {
    // Every reason names the shape it removed ("a pointer into this platform's
    // secret store"), and a scanner that read them would report the redaction.
    const bundle = exportOf(manifest())
    expect(bundleLeaks(bundle, ["other-school"])).toEqual([])
    expect(bundle.withheld.length).toBeGreaterThan(0)
  })
})

/* ─────────────────────────────────────────────────────────────── coming back ── */

test.describe("import", () => {
  test("reads back what export wrote", () => {
    const bundle = exportOf(manifest())
    const outcome = importBundle(JSON.parse(JSON.stringify(bundle)))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.bundle.slug).toBe("simon")
    expect(outcome.bundle.bundleVersion).toBe(BUNDLE_VERSION)
  })

  test("refuses a format version this engine does not read", () => {
    const bundle = { ...exportOf(manifest()), bundleVersion: 99 }
    const outcome = importBundle(JSON.parse(JSON.stringify(bundle)))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.problems[0].reason).toBe("unsupported-version")
  })

  test("refuses a bundle missing a required field", () => {
    const bundle = JSON.parse(JSON.stringify(exportOf(manifest()))) as Record<string, unknown>
    delete bundle.blueprintId
    const outcome = importBundle(bundle)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.problems.map((p) => p.field)).toContain("blueprintId")
  })

  test("refuses a foreign bundle carrying another estate's ARNs", () => {
    const bundle = JSON.parse(JSON.stringify(exportOf(manifest()))) as PortableBundle
    ;(bundle.configuration as Record<string, unknown>).sneaky = "arn:aws:iam::047385673922:role/admin"
    const outcome = importBundle(bundle)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.problems.map((p) => p.reason)).toContain("leak:aws-arn")
  })

  test("refuses something that is not an object at all", () => {
    expect(importBundle("a string").ok).toBe(false)
    expect(importBundle([]).ok).toBe(false)
  })
})

/* ────────────────────────────────────────────────────────────────────── clone ── */

const CONTEXT = { existingSlugs: ["simon", "other-school"] }

test.describe("clone", () => {
  test("copies the blueprint, the modules and the portable configuration", () => {
    const bundle = exportOf(manifest())
    const outcome = cloneTenant(
      bundle,
      {
        slug: "warwick",
        displayName: "Warwick",
        legalName: "Warwick Business School",
        initialAdminEmail: "dean@warwick.example.ac.uk",
      },
      CONTEXT,
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.manifest.blueprintId).toBe(bundle.blueprintId)
    expect(outcome.manifest.modules).toEqual(bundle.modules)
    expect(outcome.manifest.configuration[REAL_PUBLIC_KEY]).toBe("Student Engagement Office")
  })

  test("binds no secret, and says every slot it did not bind", () => {
    const outcome = cloneTenant(
      exportOf(manifest()),
      {
        slug: "warwick",
        displayName: "Warwick",
        legalName: "Warwick Business School",
        initialAdminEmail: "dean@warwick.example.ac.uk",
      },
      CONTEXT,
    )
    if (!outcome.ok) throw new Error("expected a clone")
    expect(outcome.manifest.secretRefs).toEqual({})
    expect(outcome.dropped.map((d) => d.field)).toContain("secretRefs.stripe")
  })

  test("takes the administrator from the request, never from the source", () => {
    const outcome = cloneTenant(
      exportOf(manifest()),
      {
        slug: "warwick",
        displayName: "Warwick",
        legalName: "Warwick Business School",
        initialAdminEmail: "dean@warwick.example.ac.uk",
      },
      CONTEXT,
    )
    if (!outcome.ok) throw new Error("expected a clone")
    expect(outcome.manifest.initialAdminEmail).toBe("dean@warwick.example.ac.uk")
    expect(JSON.stringify(outcome.manifest)).not.toContain("dean@simon.example.edu")
  })

  test("drops a configuration value that names the source tenant", () => {
    const bundle = exportBundle({
      manifest: manifest({ configuration: { "x.public": "https://simon.tenurework.com" } }),
      definitions: [{ key: "x.public", sensitivity: "public" }],
      engineVersion: "1.4.0",
      otherTenants: [],
    })
    const outcome = cloneTenant(
      bundle,
      {
        slug: "warwick",
        displayName: "Warwick",
        legalName: "Warwick Business School",
        initialAdminEmail: "dean@warwick.example.ac.uk",
      },
      CONTEXT,
    )
    if (!outcome.ok) throw new Error("expected a clone")
    expect(outcome.manifest.configuration["x.public"]).toBeUndefined()
    expect(outcome.dropped.find((d) => d.field === "configuration.x.public")?.reason).toContain(
      "names the source tenant",
    )
  })

  test("names data, placement and domains as things it did not copy", () => {
    const outcome = cloneTenant(
      exportOf(manifest()),
      {
        slug: "warwick",
        displayName: "Warwick",
        legalName: "Warwick Business School",
        initialAdminEmail: "dean@warwick.example.ac.uk",
      },
      CONTEXT,
    )
    if (!outcome.ok) throw new Error("expected a clone")
    const fields = outcome.dropped.map((d) => d.field)
    expect(fields).toContain("data")
    expect(fields).toContain("placement")
    expect(fields).toContain("domains")
  })

  test("refuses to reuse the source's slug", () => {
    const outcome = cloneTenant(
      exportOf(manifest()),
      {
        slug: "simon",
        displayName: "Simon Two",
        legalName: "Simon Business School",
        initialAdminEmail: "dean@warwick.example.ac.uk",
      },
      CONTEXT,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.problems.map((p) => p.reason)).toContain("same-slug")
  })

  test("refuses a slug this installation already uses", () => {
    const outcome = cloneTenant(
      exportOf(manifest()),
      {
        slug: "other-school",
        displayName: "Other",
        legalName: "Other School",
        initialAdminEmail: "dean@warwick.example.ac.uk",
      },
      CONTEXT,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.problems.map((p) => p.reason)).toContain("slug-taken")
  })

  test("refuses an unsanitised source rather than sanitising it", () => {
    const bundle = JSON.parse(JSON.stringify(exportOf(manifest()))) as PortableBundle
    ;(bundle.configuration as Record<string, unknown>).sneaky = "AKIAIOSFODNN7EXAMPLE"
    const outcome = cloneTenant(
      bundle,
      {
        slug: "warwick",
        displayName: "Warwick",
        legalName: "Warwick Business School",
        initialAdminEmail: "dean@warwick.example.ac.uk",
      },
      CONTEXT,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.problems.map((p) => p.reason)).toContain("leak:aws-access-key")
  })

  test("refuses a bundle written by a newer engine", () => {
    const bundle = { ...exportOf(manifest()), manifestVersion: MANIFEST_VERSION + 1 }
    const outcome = cloneTenant(
      bundle,
      {
        slug: "warwick",
        displayName: "Warwick",
        legalName: "Warwick Business School",
        initialAdminEmail: "dean@warwick.example.ac.uk",
      },
      CONTEXT,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.problems.map((p) => p.reason)).toContain("from-the-future")
  })
})

test("the lines an operator reads say what travelled and what did not", () => {
  const bundle = exportOf(manifest())
  expect(bundleLines(bundle).join("\n")).toContain("withheld secretRefs.stripe")
  const outcome = cloneTenant(
    bundle,
    {
      slug: "warwick",
      displayName: "Warwick",
      legalName: "Warwick Business School",
      initialAdminEmail: "dean@warwick.example.ac.uk",
    },
    CONTEXT,
  )
  expect(cloneLines(outcome).join("\n")).toContain("not copied: data")
})
