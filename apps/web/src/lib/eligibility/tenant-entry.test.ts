import { readFileSync } from "node:fs"
import { join } from "node:path"

import { grantsAccess } from "./evaluate"
import { compilePolicy } from "./policy"
import {
  COMPILED_TENANT_ENTRY_POLICY,
  TENANT_ENTRY_CATALOG,
  TENANT_ENTRY_POLICY,
  tenantEntryEligibility,
  tenantEntryFacts,
} from "./tenant-entry"

/**
 * The policy this deployment actually decides with, over the six states
 * `accessState` can conclude — the ones `/api/me` reports.
 */

const NOW = new Date("2026-06-01T12:00:00.000Z")
const VERIFIED = new Date("2026-01-01T00:00:00.000Z")
const CAPABILITIES = ["dashboard", "clubs"]

function decide(
  accessState: Parameters<typeof tenantEntryFacts>[0]["accessState"],
  emailVerifiedAt: Date | null = VERIFIED,
  capabilities: readonly string[] = CAPABILITIES,
) {
  return tenantEntryEligibility("person-1", {
    accessState,
    emailVerifiedAt,
    tenantCapabilities: capabilities,
    now: NOW,
  })
}

describe("tenure.tenant-entry.v1", () => {
  it("compiles against the catalog it ships with", () => {
    expect(compilePolicy(TENANT_ENTRY_POLICY, TENANT_ENTRY_CATALOG).ok).toBe(true)
    expect(COMPILED_TENANT_ENTRY_POLICY.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(COMPILED_TENANT_ENTRY_POLICY.referencedAttributes).toEqual([
      "affiliation.status",
      "identity.email.verified",
    ])
  })

  it("admits a live member with a verified address", () => {
    const decision = decide("ACTIVE")
    expect(decision.outcome).toBe("ELIGIBLE")
    expect(grantsAccess(decision)).toBe(true)
  })

  it("asks a live member with an unverified address to verify, rather than denying them", () => {
    const decision = decide("ACTIVE", null)
    expect(decision.outcome).toBe("CONDITIONALLY_ELIGIBLE")
    expect(decision.remediation).toEqual(["EMAIL_NOT_VERIFIED"])
    expect(grantsAccess(decision)).toBe(false)
  })

  it("distinguishes the five ways access can be absent", () => {
    expect(decide("SUSPENDED").outcome).toBe("SUSPENDED")
    expect(decide("SUSPENDED").reasonCodes).toEqual(["AFFILIATION_SUSPENDED"])
    expect(decide("REVOKED").outcome).toBe("INELIGIBLE")
    expect(decide("REVOKED").reasonCodes).toEqual(["AFFILIATION_REVOKED"])
    expect(decide("ENDED").outcome).toBe("INELIGIBLE")
    expect(decide("NOT_YET_STARTED").outcome).toBe("INELIGIBLE")
    // Nobody has asserted an affiliation for this person at all, which is not
    // the same fact as asserting they have none.
    expect(decide("NEVER_PLACED").outcome).toBe("INDETERMINATE")
    // Both halves of the sentence: the deny rule could not be decided, and the
    // reason is that the attribute it reads was never asserted. A code saying
    // only "not suspended" would be a claim the engine cannot support.
    expect(decide("NEVER_PLACED").reasonCodes).toEqual([
      "DENY_UNDECIDABLE:AFFILIATION_SUSPENDED",
      "MISSING:affiliation.status",
    ])
  })

  it("refuses gate 2 when the tenant is not entitled to a workspace at all", () => {
    const decision = decide("ACTIVE", VERIFIED, ["clubs"])
    expect(decision.outcome).toBe("INELIGIBLE")
    expect(decision.reasonCodes).toEqual(["TENANT_CAPABILITY_NOT_ENTITLED"])
  })

  it("maps the bootstrap read to typed facts with their source and observation time", () => {
    expect(tenantEntryFacts({ accessState: "ACTIVE", emailVerifiedAt: null, tenantCapabilities: [], now: NOW }))
      .toEqual([
        {
          attribute: "affiliation.status",
          presence: "PRESENT",
          value: "ACTIVE",
          sourceId: "tenure.membership",
          sourceRole: "SYSTEM_OF_RECORD",
          observedAt: NOW.toISOString(),
        },
        {
          attribute: "identity.email.verified",
          presence: "PRESENT",
          value: false,
          sourceId: "tenure.user",
          sourceRole: "SYSTEM_OF_RECORD",
          observedAt: NOW.toISOString(),
        },
      ])
  })

  it("is called by the bootstrap route, and its decision reaches the response", () => {
    // The engine's own tests prove it decides correctly; this proves it is
    // wired. A policy engine nothing calls is a document, not a gate, and the
    // wiring is exactly what a later refactor removes without any unit test
    // noticing. `/api/me` cannot be imported here — it pulls NextAuth and
    // Prisma — so the assertion is over the shipped source of the caller.
    const route = readFileSync(
      join(__dirname, "..", "..", "app", "api", "me", "route.ts"),
      "utf8",
    )
    expect(route).toContain('from "@/lib/eligibility/tenant-entry"')
    expect(route).toContain("tenantEntryEligibility(userId, {")
    expect(route).toContain("accessState: access.state")
    expect(route).toContain("emailVerifiedAt: me?.emailVerified ?? null")
    expect(route).toContain("tenantCapabilities: enabledModules")
    expect(route).toContain("eligibility: {")
    expect(route).toContain("outcome: eligibility.outcome")
    expect(route).toContain("policyDigest: eligibility.receipt.policyDigest")
  })

  it("carries a receipt naming the policy version and the sources read", () => {
    const receipt = decide("ACTIVE").receipt
    expect(receipt.policyId).toBe("tenure.tenant-entry.v1")
    expect(receipt.policyVersion).toBe("1")
    expect(receipt.policyDigest).toBe(COMPILED_TENANT_ENTRY_POLICY.digest)
    expect(receipt.sourceRevisions.map((revision) => revision.sourceId).sort()).toEqual([
      "tenure.membership",
      "tenure.user",
    ])
  })
})
