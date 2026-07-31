import { isPlatformOperator, platformOperatorCount } from "./operator"

// `as unknown as` because next-env types NODE_ENV as required on ProcessEnv, and
// these fixtures deliberately supply only the one variable under test.
const env = (PLATFORM_OPERATORS?: string) =>
  ({ PLATFORM_OPERATORS }) as unknown as NodeJS.ProcessEnv

describe("the platform operator gate fails closed", () => {
  it("admits nobody when the variable is unset", () => {
    // The Studio shows every tenant's system. An unset variable meaning "open"
    // would be the worst possible default.
    expect(isPlatformOperator("someone@tenure.com", env(undefined))).toBe(false)
    expect(platformOperatorCount(env(undefined))).toBe(0)
  })

  it("admits nobody when the variable is empty or only separators", () => {
    expect(isPlatformOperator("a@b.com", env(""))).toBe(false)
    expect(isPlatformOperator("a@b.com", env("  , , "))).toBe(false)
  })

  it("refuses a missing email rather than treating it as a match", () => {
    expect(isPlatformOperator(null, env("a@b.com"))).toBe(false)
    expect(isPlatformOperator(undefined, env("a@b.com"))).toBe(false)
    expect(isPlatformOperator("", env("a@b.com"))).toBe(false)
  })

  it("admits an exact listed address", () => {
    expect(isPlatformOperator("ops@tenure.com", env("ops@tenure.com"))).toBe(true)
  })

  it("normalises case and surrounding whitespace on both sides", () => {
    expect(isPlatformOperator("  OPS@Tenure.com ", env("ops@tenure.com"))).toBe(true)
    expect(isPlatformOperator("ops@tenure.com", env(" OPS@TENURE.COM , other@x.com"))).toBe(true)
  })

  it("does not match a domain, only an address", () => {
    // "@tenure.com" as a rule is one typo'd DNS record away from being everybody.
    expect(isPlatformOperator("attacker@tenure.com", env("ops@tenure.com"))).toBe(false)
    expect(isPlatformOperator("ops@tenure.com.evil.test", env("ops@tenure.com"))).toBe(false)
  })

  it("does not match a prefix or substring", () => {
    expect(isPlatformOperator("ops@tenure.co", env("ops@tenure.com"))).toBe(false)
    expect(isPlatformOperator("xops@tenure.com", env("ops@tenure.com"))).toBe(false)
  })

  it("handles several operators", () => {
    const e = env("a@t.com,b@t.com , c@t.com")
    expect(platformOperatorCount(e)).toBe(3)
    for (const who of ["a@t.com", "b@t.com", "c@t.com"]) {
      expect(isPlatformOperator(who, e)).toBe(true)
    }
    expect(isPlatformOperator("d@t.com", e)).toBe(false)
  })
})
