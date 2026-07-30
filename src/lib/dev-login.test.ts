import { checkDevLoginGate } from "./dev-login"

const PASSPHRASE = "correct-horse-battery-staple"

describe("checkDevLoginGate — production", () => {
  const inProd = (provided: string | undefined, expected: string | undefined) =>
    checkDevLoginGate({ provided, expected, isProduction: true })

  it("admits the correct passphrase", () => {
    expect(inProd(PASSPHRASE, PASSPHRASE)).toEqual({ allowed: true })
  })

  it("refuses a wrong passphrase", () => {
    expect(inProd("hunter2", PASSPHRASE)).toEqual({ allowed: false, reason: "passphrase-wrong" })
  })

  it("refuses a missing passphrase", () => {
    expect(inProd(undefined, PASSPHRASE)).toEqual({ allowed: false, reason: "passphrase-missing" })
    expect(inProd("", PASSPHRASE)).toEqual({ allowed: false, reason: "passphrase-missing" })
  })

  // The whole point. An unconfigured gate in production must not read as
  // "no gate needed" — that is the open public sign-in this exists to close.
  it("refuses everything when no passphrase is configured", () => {
    expect(inProd(undefined, undefined)).toEqual({ allowed: false, reason: "gate-not-configured" })
    expect(inProd("anything", undefined)).toEqual({ allowed: false, reason: "gate-not-configured" })
    expect(inProd("", "")).toEqual({ allowed: false, reason: "gate-not-configured" })
  })

  it("is not fooled by near-misses", () => {
    for (const attempt of [
      PASSPHRASE.slice(0, -1),
      PASSPHRASE + "x",
      PASSPHRASE.toUpperCase(),
      ` ${PASSPHRASE}`,
      `${PASSPHRASE} `,
      PASSPHRASE.replace("-", "_"),
    ]) {
      expect(inProd(attempt, PASSPHRASE).allowed).toBe(false)
    }
  })

  it("compares by value, not by length", () => {
    // A length-only check would admit any 28-character string.
    const sameLength = "x".repeat(PASSPHRASE.length)
    expect(sameLength).toHaveLength(PASSPHRASE.length)
    expect(inProd(sameLength, PASSPHRASE).allowed).toBe(false)
  })

  it("handles a much shorter and a much longer attempt without throwing", () => {
    // timingSafeEqual rejects differently-sized buffers, so the implementation
    // has to equalise them; a throw here would surface as a 500, not a denial.
    expect(() => inProd("a", PASSPHRASE)).not.toThrow()
    expect(() => inProd("z".repeat(5000), PASSPHRASE)).not.toThrow()
    expect(inProd("a", PASSPHRASE).allowed).toBe(false)
    expect(inProd("z".repeat(5000), PASSPHRASE).allowed).toBe(false)
  })

  it("accepts unicode passphrases by exact bytes", () => {
    expect(checkDevLoginGate({ provided: "naïve-π", expected: "naïve-π", isProduction: true })).toEqual({
      allowed: true,
    })
    expect(
      checkDevLoginGate({ provided: "naive-π", expected: "naïve-π", isProduction: true }).allowed,
    ).toBe(false)
  })
})

describe("checkDevLoginGate — outside production", () => {
  const outsideProd = (provided: string | undefined, expected: string | undefined) =>
    checkDevLoginGate({ provided, expected, isProduction: false })

  it("allows sign-in with no passphrase configured", () => {
    // Local runs and CI stay frictionless; there is no public URL to protect.
    expect(outsideProd(undefined, undefined)).toEqual({ allowed: true })
  })

  it("still enforces a passphrase once one is configured", () => {
    // So a developer can run the real gated flow, and so the e2e suite can.
    expect(outsideProd(PASSPHRASE, PASSPHRASE)).toEqual({ allowed: true })
    expect(outsideProd("wrong", PASSPHRASE)).toEqual({ allowed: false, reason: "passphrase-wrong" })
    expect(outsideProd(undefined, PASSPHRASE)).toEqual({ allowed: false, reason: "passphrase-missing" })
  })
})
