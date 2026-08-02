import {
  VersionError,
  checkCompatibility,
  compareVersions,
  parseVersion,
} from "./compatibility"

/**
 * GE-022-005 — configuration compatibility.
 *
 * Every test here is about failing CLOSED. The two ways to get this wrong —
 * ignoring an unknown key, and applying a value the running build predates —
 * are both silent, and a guard that is silently inert is worse than none
 * because it is believed.
 */
const KNOWN = new Set(["platform.localization.workingDays", "platform.localization.holidays"])

describe("versions", () => {
  it("parses and orders", () => {
    expect(parseVersion("2026.7.31")).toEqual({ major: 2026, minor: 7, patch: 31 })
    expect(compareVersions(parseVersion("1.2.3"), parseVersion("1.2.4"))).toBeLessThan(0)
    expect(compareVersions(parseVersion("1.3.0"), parseVersion("1.2.9"))).toBeGreaterThan(0)
    expect(compareVersions(parseVersion("2.0.0"), parseVersion("2.0.0"))).toBe(0)
  })

  it("compares numerically, not as strings", () => {
    // "10" < "9" as strings. A string comparison would report 1.10.0 as older
    // than 1.9.0 and let an incompatible config through on the tenth minor.
    expect(compareVersions(parseVersion("1.10.0"), parseVersion("1.9.0"))).toBeGreaterThan(0)
    expect(compareVersions(parseVersion("1.0.10"), parseVersion("1.0.9"))).toBeGreaterThan(0)
  })

  it("throws on an unparseable version rather than defaulting to 0.0.0", () => {
    // 0.0.0 compares older than everything, so every check would pass and the
    // guard would be inert while looking present.
    for (const bad of ["", "1.2", "v1.2.3", "1.2.3-rc1", "latest"]) {
      expect(() => parseVersion(bad)).toThrow(VersionError)
    }
  })
})

describe("a cell decides whether it can honour a configuration", () => {
  it("accepts what it is new enough for", () => {
    const verdict = checkCompatibility(
      "2026.8.0",
      { "platform.localization.workingDays": "2026.7.0" },
      KNOWN,
    )
    expect(verdict).toEqual({ compatible: true, problems: [] })
  })

  it("accepts the exact minimum", () => {
    expect(
      checkCompatibility("2026.7.0", { "platform.localization.workingDays": "2026.7.0" }, KNOWN)
        .compatible,
    ).toBe(true)
  })

  it("refuses a release that needs a newer engine", () => {
    // Applying it anyway is the silent failure: an older build reading
    // workingDays with no concept of a working week does not error, it computes
    // deadlines on the assumption the tenant explicitly overrode.
    const verdict = checkCompatibility(
      "2026.6.9",
      { "platform.localization.workingDays": "2026.7.0" },
      KNOWN,
    )
    expect(verdict.compatible).toBe(false)
    expect(verdict.problems).toEqual([
      {
        key: "platform.localization.workingDays",
        requires: "2026.7.0",
        running: "2026.6.9",
        reason: "engine-too-old",
      },
    ])
  })

  it("refuses a key the running build has never heard of", () => {
    // The other silent failure: the Studio shows the setting as published and
    // the cell quietly does something else.
    const verdict = checkCompatibility("2030.1.0", { "platform.some.futureKey": "2026.1.0" }, KNOWN)
    expect(verdict.compatible).toBe(false)
    expect(verdict.problems[0].reason).toBe("unknown-key")
  })

  it("refuses when the engine cannot say how old it is", () => {
    // It cannot claim to be new enough. `SCHEMA_VERSION` is "unpinned" on an
    // un-stamped build, and that is exactly the case this covers.
    const verdict = checkCompatibility(
      "unpinned",
      { "platform.localization.workingDays": "2026.7.0" },
      KNOWN,
    )
    expect(verdict.compatible).toBe(false)
    expect(verdict.problems[0].reason).toBe("engine-too-old")
  })

  it("refuses a requirement nobody can parse", () => {
    // Treating an unreadable requirement as "no requirement" would let a
    // malformed release through — the failure mode being guarded against,
    // reintroduced by the guard itself.
    const verdict = checkCompatibility(
      "2026.8.0",
      { "platform.localization.workingDays": "whenever" },
      KNOWN,
    )
    expect(verdict.compatible).toBe(false)
  })

  it("reports every problem, not the first", () => {
    // An operator who fixes one and redeploys to find a second has lost a
    // deploy cycle to a list that was already known.
    const verdict = checkCompatibility(
      "2026.6.0",
      {
        "platform.localization.workingDays": "2026.7.0",
        "platform.localization.holidays": "2026.7.0",
        "platform.some.futureKey": "2026.1.0",
      },
      KNOWN,
    )
    expect(verdict.problems).toHaveLength(3)
    expect(verdict.problems.filter((p) => p.reason === "unknown-key")).toHaveLength(1)
  })

  it("is compatible when nothing is required", () => {
    expect(checkCompatibility("2026.1.0", {}, KNOWN)).toEqual({ compatible: true, problems: [] })
  })
})
