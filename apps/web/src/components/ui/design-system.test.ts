import {
  DEPRECATIONS,
  DESIGN_SYSTEM_VERSION,
  VERSIONS,
  currentRelease,
  tokenHashNow,
} from "@/components/ui/design-system"

/**
 * The mechanism, not the numbers.
 *
 * The load-bearing assertion is the first one: it recomputes the token hash
 * from the REAL `src/app/globals.css`, through the same `readThemes` reader the
 * contrast audit uses, and compares it with the current release's recorded
 * hash. Change any `--token` by one digit and this reds, naming the value it
 * read — and the only way back to green is a new entry in `VERSIONS` with
 * release notes and a migration.
 */
describe("design system version register", () => {
  it("the recorded token hash matches the stylesheet the product renders", () => {
    const release = currentRelease()
    const actual = tokenHashNow()
    expect(actual).toBe(
      release.tokenHash ||
        `<<< no hash recorded for ${release.version}; the live stylesheet hashes to ${actual} >>>`,
    )
  })

  it("the current release is the last entry and matches DESIGN_SYSTEM_VERSION", () => {
    expect(currentRelease().version).toBe(DESIGN_SYSTEM_VERSION)
  })

  it("versions are ordered oldest first and never repeat", () => {
    const versions = VERSIONS.map((v) => v.version)
    expect(new Set(versions).size).toBe(versions.length)
    const asNumbers = versions.map((v) => v.split(".").map(Number))
    for (let i = 1; i < asNumbers.length; i++) {
      const [pa, pb, pc] = asNumbers[i - 1]
      const [na, nb, nc] = asNumbers[i]
      const previous = pa * 1e6 + pb * 1e3 + pc
      const next = na * 1e6 + nb * 1e3 + nc
      expect(next).toBeGreaterThan(previous)
    }
  })

  it("every entry carries real release notes and a real migration", () => {
    // The reason `notes` and `migration` are required fields rather than
    // optional ones: an empty entry is the cheapest way to make the hash
    // assertion above go green, and it would record nothing.
    for (const v of VERSIONS) {
      expect(v.notes.trim().length).toBeGreaterThan(40)
      expect(v.migration.trim().length).toBeGreaterThan(10)
      expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it("every deprecation names a replacement and a removal version", () => {
    for (const [name, d] of Object.entries(DEPRECATIONS)) {
      expect(`${name}: ${d.replacement}`).not.toMatch(/: *$/)
      expect(d.deprecatedIn).toMatch(/^\d+\.\d+\.\d+$/)
      expect(d.removeIn).toMatch(/^\d+\.\d+\.\d+$/)
      expect(d.reason.trim().length).toBeGreaterThan(10)
      // A deprecation whose replacement is itself is a loop, and the ESLint
      // rule would tell people to keep importing the thing it is banning.
      expect(d.replacement).not.toBe(name)
    }
  })
})
