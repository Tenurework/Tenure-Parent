/**
 * PACK-010-001 — configuration crosses the boundary as a `ConfigSnapshot`.
 *
 * The database read is the only thing faked. The registry, the layers, the
 * resolver and the blueprint bindings are the shipped ones, because the claim
 * under test is that a resolved configuration becomes the kernel's own shape
 * without anything in between inventing a field — `/api/ai/chat` puts
 * `snapshot.revision` on the `TenantContext` every tool decision is made
 * against, so a blank or wrong revision there is a decision nobody can explain
 * afterwards.
 */

const findUnique = jest.fn(async (_args: unknown) => ({ slug: "rochester" }) as { slug: string } | null)

jest.mock("@/lib/db", () => ({ db: { institution: { findUnique: (a: unknown) => findUnique(a) } } }))

import { parseConfigSnapshot } from "@tenure/contracts"

import { configSnapshotForInstitution, institutionSlugFor } from "./server"

beforeEach(() => {
  findUnique.mockReset()
  findUnique.mockImplementation(async () => ({ slug: "rochester" }))
})

describe("the resolved configuration, as a boundary value", () => {
  it("produces a snapshot the kernel's own parser accepts", async () => {
    const snapshot = await configSnapshotForInstitution("inst_roch")

    // Round-trip. One shape, not two that resemble each other.
    expect(parseConfigSnapshot(snapshot)).toEqual(snapshot)
    expect(snapshot.tenantId).toBe("inst_roch")
    expect(snapshot.checksum).toMatch(/^sha256:/)
    // The definition it came from, which is a different fact from what it
    // resolved to: the same values under a new blueprint version is a story,
    // and a snapshot carrying only a checksum cannot tell it.
    expect(snapshot.revision).toBe("university-student-organizations@1.0.0")
  })

  it("carries the resolved values, not an empty object", async () => {
    // A snapshot with a valid checksum over nothing would satisfy the contract
    // and be useless, so the values are asserted against one the registry
    // actually defines for this tenant.
    const snapshot = await configSnapshotForInstitution("inst_roch")
    expect(snapshot.values["platform.terminology.staffOfficeName"]).toBe("Ainslie OSE")
  })

  it("says platform-defaults for an institution nothing has bound", async () => {
    // Not a blank revision, and not a throw. An unconfigured tenant resolves to
    // platform defaults, and the snapshot has to be able to say that was what
    // happened — `parseConfigSnapshot` refuses an empty revision outright.
    findUnique.mockImplementation(async () => null)

    const snapshot = await configSnapshotForInstitution("inst_unknown")
    expect(snapshot.revision).toBe("platform-defaults@0")
    expect(parseConfigSnapshot(snapshot)).toEqual(snapshot)
  })

  it("bridges id to slug in one place, so callers do not each learn to", async () => {
    expect(await institutionSlugFor("inst_roch")).toBe("rochester")
    findUnique.mockImplementation(async () => null)
    expect(await institutionSlugFor("inst_unknown")).toBe("")
  })
})
