import {
  ACCESS_PURPOSES,
  FINANCIAL_IDENTIFIER_KINDS,
  MIN_TOKEN_KEY_LENGTH,
  PURPOSES_NO_GRANT_CAN_RAISE,
  abaPrefixIsAssigned,
  containsFinancialIdentifier,
  decryptIdentifier,
  encryptIdentifier,
  findFinancialIdentifiers,
  grantProblems,
  keyIdOf,
  maskIdentifier,
  passesAbaCheck,
  passesIbanCheck,
  passesLuhn,
  redactFinancialIdentifiers,
  redactFinancialIdentifiersDeep,
  revealFor,
  tokenFor,
  type PurposeGrant,
} from "./financial-identifiers"

/** 64 hex characters. Long enough to be a key; a literal so nothing derives it. */
const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const OTHER_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"

/** A Visa test PAN. Luhn-valid, issued by nobody. */
const PAN = "4111111111111111"
/** The IBAN in ISO 13616's own example. */
const IBAN = "GB33BUKB20201555555555"
/** A Federal Reserve routing number: ABA-valid, prefix 02 is assigned. */
const ROUTING = "021000021"

const AT = "2026-03-01T12:00:00.000Z"

function liveGrant(overrides: Partial<PurposeGrant> = {}): PurposeGrant {
  return {
    purpose: "TAX_REPORTING",
    grantedTo: "user_finance_officer",
    grantedBy: "user_ose_director",
    justification: "1099 preparation for the 2026 filing season",
    expiresAt: "2026-04-01T00:00:00.000Z",
    kinds: ["IBAN", "US_ROUTING"],
    ...overrides,
  }
}

describe("the checksums, because a match has to be arithmetic and not a guess", () => {
  it("accepts a Luhn-valid card number and refuses the same number with one digit changed", () => {
    expect(passesLuhn(PAN)).toBe(true)
    expect(passesLuhn("4111111111111112")).toBe(false)
  })

  it("refuses a run of digits that is too short or too long to be a PAN", () => {
    expect(passesLuhn("41111111111")).toBe(false) // 11
    expect(passesLuhn("41111111111111111111")).toBe(false) // 20
  })

  it("accepts a mod-97-valid IBAN and refuses one with transposed characters", () => {
    expect(passesIbanCheck(IBAN)).toBe(true)
    expect(passesIbanCheck("GB33BUKB20201555555556")).toBe(false)
  })

  it("reads an IBAN written with spaces the way a person types one", () => {
    expect(passesIbanCheck("GB33 BUKB 2020 1555 5555 55")).toBe(true)
  })

  it("accepts an ABA-valid routing number and refuses an ABA-invalid one", () => {
    expect(passesAbaCheck(ROUTING)).toBe(true)
    expect(passesAbaCheck("021000022")).toBe(false)
  })

  it("treats an unassigned Federal Reserve prefix as not a routing number", () => {
    // 40 is in the unassigned 33-60 band; the checksum is irrelevant to that.
    expect(abaPrefixIsAssigned("021000021")).toBe(true)
    expect(abaPrefixIsAssigned("401000023")).toBe(false)
  })
})

describe("detection", () => {
  it("finds a card number in a sentence, with its span", () => {
    const text = `Card ${PAN} was declined.`
    const [found, ...rest] = findFinancialIdentifiers(text)
    expect(rest).toHaveLength(0)
    expect(found.kind).toBe("PAN")
    expect(found.raw).toBe(PAN)
    expect(text.slice(found.start, found.end)).toBe(PAN)
  })

  it("finds a card number written in groups of four and normalises it", () => {
    const [found] = findFinancialIdentifiers("paid with 4111 1111 1111 1111 yesterday")
    expect(found.kind).toBe("PAN")
    expect(found.raw).toBe("4111 1111 1111 1111")
    expect(found.normalized).toBe(PAN)
  })

  it("does not claim a sixteen-digit number that fails Luhn", () => {
    expect(findFinancialIdentifiers("order 4111111111111112 shipped")).toHaveLength(0)
  })

  it("reads an IBAN as an IBAN and not as the card number hiding in its digits", () => {
    const found = findFinancialIdentifiers(`transfer to ${IBAN} please`)
    expect(found.map((f) => f.kind)).toEqual(["IBAN"])
    expect(found[0].raw).toBe(IBAN)
  })

  it("claims a labelled account number and leaves a bare run of digits alone", () => {
    const labelled = findFinancialIdentifiers("account number: 000123456789")
    expect(labelled.map((f) => f.kind)).toEqual(["US_BANK_ACCOUNT"])
    expect(labelled[0].raw).toBe("000123456789")

    expect(findFinancialIdentifiers("invoice 000123456789 is open")).toHaveLength(0)
  })

  it("claims a routing number both labelled and bare, but not a nine-digit id in an unassigned range", () => {
    expect(findFinancialIdentifiers(`routing ${ROUTING}`).map((f) => f.kind)).toEqual([
      "US_ROUTING",
    ])
    expect(findFinancialIdentifiers(`wire to ${ROUTING} today`).map((f) => f.kind)).toEqual([
      "US_ROUTING",
    ])
    // ABA-valid but prefix 40 is unassigned, so it is an ordinary identifier.
    expect(passesAbaCheck("401000023")).toBe(true)
    expect(findFinancialIdentifiers("ticket 401000023 reopened")).toHaveLength(0)
  })

  it("claims provider financial objects", () => {
    const found = findFinancialIdentifiers("acct_1QxYzAbCdEfGhI owes ba_1Rz9KkLmNoPqRs")
    expect(found.map((f) => f.kind)).toEqual(["PROVIDER_OBJECT", "PROVIDER_OBJECT"])
    expect(found.map((f) => f.raw)).toEqual(["acct_1QxYzAbCdEfGhI", "ba_1Rz9KkLmNoPqRs"])
  })

  it("leaves a provider CLIENT SECRET to the credential scanner rather than tokenizing it", () => {
    // `pi_…_secret_…` is a credential. Replacing it with a token here would
    // report a leaked secret as handled.
    expect(
      findFinancialIdentifiers("pi_3Abc123Def456_secret_9ZyXwVuTsRqPoNmL"),
    ).toHaveLength(0)
  })

  it("returns nothing for text that carries nothing", () => {
    expect(findFinancialIdentifiers("The budget line has 42 dollars left.")).toHaveLength(0)
    expect(findFinancialIdentifiers("")).toHaveLength(0)
  })

  it("answers containsFinancialIdentifier over a nested structure", () => {
    expect(containsFinancialIdentifier({ note: { detail: [`paid ${PAN}`] } })).toBe(true)
    expect(containsFinancialIdentifier({ note: { detail: ["paid in cash"] } })).toBe(false)
  })
})

describe("purpose-based access", () => {
  it("shows a support agent the last four of a card and an operations reader the issuer range too", () => {
    expect(revealFor("PAN", "SUPPORT_TROUBLESHOOTING", null, AT)).toBe("LAST4")
    expect(revealFor("PAN", "OPERATIONS_RECONCILIATION", null, AT)).toBe("PREFIX_LAST4")
  })

  it("shows a model prompt nothing, for every kind there is", () => {
    for (const kind of FINANCIAL_IDENTIFIER_KINDS) {
      expect(revealFor(kind, "MODEL_PROMPT", null, AT)).toBe("NONE")
      expect(revealFor(kind, "LOG_OR_TRACE", null, AT)).toBe("NONE")
      expect(revealFor(kind, "AUDIT_EVIDENCE", null, AT)).toBe("NONE")
    }
  })

  it("lifts a granted purpose to FULL for the kinds the grant names, and only those", () => {
    const grant = liveGrant()
    expect(revealFor("IBAN", "TAX_REPORTING", grant, AT)).toBe("FULL")
    expect(revealFor("US_ROUTING", "TAX_REPORTING", grant, AT)).toBe("FULL")
    // Not named by the grant.
    expect(revealFor("US_BANK_ACCOUNT", "TAX_REPORTING", grant, AT)).toBe("LAST4")
  })

  it("does not apply a grant to a different purpose than the one it names", () => {
    const grant = liveGrant()
    expect(revealFor("IBAN", "SUPPORT_TROUBLESHOOTING", grant, AT)).toBe("LAST4")
  })

  it("stops applying a grant the moment it expires", () => {
    const grant = liveGrant({ expiresAt: "2026-03-01T12:00:00.000Z" })
    // At exactly the expiry, and after it.
    expect(revealFor("IBAN", "TAX_REPORTING", grant, AT)).toBe("LAST4")
    expect(revealFor("IBAN", "TAX_REPORTING", grant, "2026-02-28T23:59:59.000Z")).toBe("FULL")
  })

  it("ignores a malformed grant instead of honouring it", () => {
    for (const broken of [
      liveGrant({ justification: "work" }),
      liveGrant({ grantedTo: "  " }),
      liveGrant({ grantedBy: "" }),
      liveGrant({ expiresAt: "whenever" }),
      liveGrant({ kinds: [] }),
    ]) {
      expect(grantProblems(broken).length).toBeGreaterThan(0)
      expect(revealFor("IBAN", "TAX_REPORTING", broken, AT)).toBe("LAST4")
    }
  })

  it("refuses to let ANY grant raise a prompt, a log or an audit row", () => {
    for (const purpose of PURPOSES_NO_GRANT_CAN_RAISE) {
      const grant = liveGrant({ purpose, kinds: ["IBAN"] })
      expect(grantProblems(grant)).toHaveLength(0)
      expect(revealFor("IBAN", purpose, grant, AT)).toBe("NONE")
    }
  })

  it("never shows a whole card number, whatever purpose asks and whatever is granted", () => {
    for (const purpose of ACCESS_PURPOSES) {
      const grant = liveGrant({ purpose, kinds: ["PAN"] })
      const level = revealFor("PAN", purpose, grant, AT)
      expect(level).not.toBe("FULL")
    }
  })

  it("gives an unrecognised purpose nothing rather than throwing at a display path", () => {
    expect(revealFor("IBAN", "WHATEVER_I_TYPED", liveGrant(), AT)).toBe("NONE")
  })
})

describe("masking", () => {
  it("keeps the issuer range and the last four for a card at PREFIX_LAST4", () => {
    expect(maskIdentifier(PAN, "PAN", "PREFIX_LAST4")).toBe("411111••••••1111")
    expect(maskIdentifier(PAN, "PAN", "LAST4")).toBe("••••1111")
    expect(maskIdentifier(PAN, "PAN", "NONE")).toBe("••••••••••••")
  })

  it("keeps the country and check digits of an IBAN at PREFIX_LAST4", () => {
    expect(maskIdentifier(IBAN, "IBAN", "PREFIX_LAST4")).toBe("GB33••••••••••••••5555")
  })

  it("keeps a provider object's prefix so a reader can still tell an account from a card", () => {
    expect(maskIdentifier("acct_1QxYzAbCdEfGhI", "PROVIDER_OBJECT", "PREFIX_LAST4")).toBe(
      "acct_••••••••••fGhI",
    )
  })

  it("masks a card written with spaces to the same thing as one without", () => {
    expect(maskIdentifier("4111 1111 1111 1111", "PAN", "LAST4")).toBe(
      maskIdentifier(PAN, "PAN", "LAST4"),
    )
  })

  it("returns the value itself only at FULL", () => {
    expect(maskIdentifier(IBAN, "IBAN", "FULL")).toBe(IBAN)
  })
})

describe("tokenization", () => {
  it("is deterministic for the same value, kind and tenant", () => {
    const a = tokenFor(PAN, { kind: "PAN", tenantId: "inst_1", key: KEY })
    const b = tokenFor("4111 1111 1111 1111", { kind: "PAN", tenantId: "inst_1", key: KEY })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.token).toBe(b.token)
  })

  it("gives two tenants different tokens for the same card", () => {
    const a = tokenFor(PAN, { kind: "PAN", tenantId: "inst_1", key: KEY })
    const b = tokenFor(PAN, { kind: "PAN", tenantId: "inst_2", key: KEY })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.token).not.toBe(b.token)
  })

  it("gives different tokens under different keys, and names the key it used", () => {
    const a = tokenFor(PAN, { kind: "PAN", tenantId: "inst_1", key: KEY })
    const b = tokenFor(PAN, { kind: "PAN", tenantId: "inst_1", key: OTHER_KEY })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.token).not.toBe(b.token)
      expect(a.keyId).toBe(keyIdOf(KEY))
      expect(a.keyId).not.toBe(b.keyId)
    }
  })

  it("does not contain the value it tokenized", () => {
    const result = tokenFor(PAN, { kind: "PAN", tenantId: "inst_1", key: KEY })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.token).not.toContain(PAN)
      expect(result.token).not.toContain("1111")
    }
  })

  it("refuses to tokenize with no key, and says that is why", () => {
    const result = tokenFor(PAN, { kind: "PAN", tenantId: "inst_1", key: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("no-key")
      expect(result.detail).toContain("cannot be tokenized")
    }
  })

  it("refuses to tokenize with no tenant in scope rather than producing a global token", () => {
    const result = tokenFor(PAN, { kind: "PAN", tenantId: "", key: KEY })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("no-tenant")
      expect(result.detail).toContain("identical in every tenant")
    }
  })

  it("refuses a key shorter than the minimum rather than producing a weak token", () => {
    const short = "a".repeat(MIN_TOKEN_KEY_LENGTH - 1)
    const result = tokenFor(PAN, { kind: "PAN", tenantId: "inst_1", key: short })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("key-too-short")
  })
})

describe("encryption", () => {
  it("round-trips an identifier", () => {
    const sealed = encryptIdentifier(IBAN, { kind: "IBAN", key: KEY })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return
    expect(sealed.record).not.toContain(IBAN)
    const opened = decryptIdentifier(sealed.record, { kind: "IBAN", key: KEY })
    expect(opened).toEqual({ ok: true, value: IBAN })
  })

  it("produces a different record every time, so two equal values are not equal ciphertext", () => {
    const a = encryptIdentifier(IBAN, { kind: "IBAN", key: KEY })
    const b = encryptIdentifier(IBAN, { kind: "IBAN", key: KEY })
    expect(a.ok && b.ok && a.record !== b.record).toBe(true)
  })

  it("refuses a record written under another key as a rotation, not as corruption", () => {
    const sealed = encryptIdentifier(IBAN, { kind: "IBAN", key: KEY })
    if (!sealed.ok) throw new Error("setup failed")
    const opened = decryptIdentifier(sealed.record, { kind: "IBAN", key: OTHER_KEY })
    expect(opened.ok).toBe(false)
    if (!opened.ok) {
      expect(opened.reason).toBe("wrong-key")
      expect(opened.detail).toContain("rotation")
    }
  })

  it("refuses a record whose ciphertext was altered", () => {
    const sealed = encryptIdentifier(IBAN, { kind: "IBAN", key: KEY })
    if (!sealed.ok) throw new Error("setup failed")
    const parts = sealed.record.split(".")
    const bytes = Buffer.from(parts[3], "base64url")
    bytes[0] ^= 0x01
    parts[3] = bytes.toString("base64url")
    const opened = decryptIdentifier(parts.join("."), { kind: "IBAN", key: KEY })
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.reason).toBe("tampered")
  })

  it("does not open a record under the wrong kind's derived key", () => {
    const sealed = encryptIdentifier(ROUTING, { kind: "US_ROUTING", key: KEY })
    if (!sealed.ok) throw new Error("setup failed")
    const opened = decryptIdentifier(sealed.record, { kind: "IBAN", key: KEY })
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.reason).toBe("tampered")
  })

  it("refuses to encrypt with no key rather than storing the value in the clear", () => {
    const result = encryptIdentifier(IBAN, { kind: "IBAN", key: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("no-key")
  })

  it("refuses text that is not one of its records instead of reading it as plaintext", () => {
    const opened = decryptIdentifier(IBAN, { kind: "IBAN", key: KEY })
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.reason).toBe("malformed-record")
  })
})

describe("redaction, composed", () => {
  const options = { purpose: "MODEL_PROMPT" as const, tenantId: "inst_1", key: KEY, at: AT }

  it("removes the card number from the text and leaves a token in its place", () => {
    const result = redactFinancialIdentifiers(`Refund the charge on ${PAN} today.`, options)
    expect(result.text).not.toContain(PAN)
    expect(result.text).toMatch(/Refund the charge on •{12} \[tk_pan_[0-9a-f]{24}\] today\./)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].level).toBe("NONE")
    expect(result.degraded).toBe(false)
  })

  it("gives the same card the same token in two different sentences", () => {
    const one = redactFinancialIdentifiers(`charge ${PAN}`, options)
    const two = redactFinancialIdentifiers(`refund ${PAN}`, options)
    expect(one.findings[0].token).toBe(two.findings[0].token)
  })

  it("gives two different cards different tokens", () => {
    const other = "4012888888881881"
    const one = redactFinancialIdentifiers(`charge ${PAN}`, options)
    const two = redactFinancialIdentifiers(`charge ${other}`, options)
    expect(one.findings[0].token).not.toBe(two.findings[0].token)
  })

  it("handles several identifiers of different kinds in one string, in order", () => {
    const result = redactFinancialIdentifiers(
      `card ${PAN}, iban ${IBAN}, routing ${ROUTING}, account acct_1QxYzAbCdEfGhI`,
      options,
    )
    expect(result.findings.map((f) => f.kind)).toEqual([
      "PAN",
      "IBAN",
      "US_ROUTING",
      "PROVIDER_OBJECT",
    ])
    expect(result.text).not.toContain(PAN)
    expect(result.text).not.toContain(IBAN)
    expect(result.text).not.toContain(ROUTING)
    expect(result.text).not.toContain("acct_1QxYzAbCdEfGhI")
  })

  it("says the value was not tokenized when the deployment has no key, and still removes it", () => {
    const result = redactFinancialIdentifiers(`card ${PAN}`, { ...options, key: null })
    expect(result.text).not.toContain(PAN)
    expect(result.text).toContain("[not tokenized: no-key]")
    expect(result.degraded).toBe(true)
    expect(result.findings[0].tokenRefusal).toBe("no-key")
  })

  it("leaves text with nothing in it exactly as it was", () => {
    const text = "Reimburse the $42.00 catering claim."
    const result = redactFinancialIdentifiers(text, options)
    expect(result.text).toBe(text)
    expect(result.findings).toHaveLength(0)
    expect(result.degraded).toBe(false)
  })

  it("passes a granted FULL value through untouched, for the purpose that earned it", () => {
    const result = redactFinancialIdentifiers(`pay ${IBAN}`, {
      purpose: "TAX_REPORTING",
      tenantId: "inst_1",
      key: KEY,
      grant: liveGrant(),
      at: AT,
    })
    expect(result.text).toContain(IBAN)
    expect(result.findings[0].level).toBe("FULL")
  })

  it("hands back a Date rather than rebuilding it into an empty object", () => {
    const at = new Date("2026-03-01T12:00:00.000Z")
    const redacted = redactFinancialIdentifiersDeep({ at, note: `card ${PAN}` }, options)
    expect(redacted.at).toBeInstanceOf(Date)
    expect(redacted.at.toISOString()).toBe("2026-03-01T12:00:00.000Z")
    expect(redacted.note).not.toContain(PAN)
  })

  it("walks a structure, rewriting values and leaving keys alone", () => {
    const redacted = redactFinancialIdentifiersDeep(
      { iban: `pay ${IBAN}`, nested: { notes: [`card ${PAN}`] }, amountCents: 4200 },
      options,
    )
    expect(Object.keys(redacted)).toEqual(["iban", "nested", "amountCents"])
    expect(redacted.iban).not.toContain(IBAN)
    expect(redacted.nested.notes[0]).not.toContain(PAN)
    expect(redacted.amountCents).toBe(4200)
  })
})
