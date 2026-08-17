import { MIGRATION_WAVE_VARIABLE, cellMigrationWave } from "./migration-wave"

/**
 * IER-100-008 — reading the cell's wave, and the three states it can be in.
 *
 * The case worth writing is the third one. An unrecognised value is not "no
 * migration": somebody set it meaning to restrict something, and a reader that
 * treats an unparseable restriction as no restriction turns a typo into the
 * password form reappearing during `SSO_REQUIRED`.
 */

describe("no migration configured", () => {
  it("imposes nothing, and says nothing is wrong", () => {
    expect(cellMigrationWave({})).toEqual({
      wave: null,
      problem: null,
      localLoginPermitted: true,
      ssoOffered: true,
      recovery: null,
    })
  })

  it("treats blank and whitespace as unset", () => {
    expect(cellMigrationWave({ [MIGRATION_WAVE_VARIABLE]: "   " }).localLoginPermitted).toBe(true)
    expect(cellMigrationWave({ [MIGRATION_WAVE_VARIABLE]: "   " }).problem).toBeNull()
  })
})

describe("a recognised wave", () => {
  it("permits both methods in the hybrid period", () => {
    const state = cellMigrationWave({ [MIGRATION_WAVE_VARIABLE]: "HYBRID" })
    expect(state).toMatchObject({ wave: "HYBRID", localLoginPermitted: true, ssoOffered: true })
    expect(state.recovery?.path).toBe("LOCAL_LOGIN")
  })

  it("withholds the local method once SSO is required", () => {
    const state = cellMigrationWave({ [MIGRATION_WAVE_VARIABLE]: "SSO_REQUIRED" })
    expect(state).toMatchObject({ localLoginPermitted: false, ssoOffered: true, problem: null })
    expect(state.recovery?.path).toBe("OPERATOR_ROLLBACK")
  })

  it("offers a reviewed re-link, not a rollback, after retirement", () => {
    expect(cellMigrationWave({ [MIGRATION_WAVE_VARIABLE]: "RETIRED" }).recovery?.path).toBe("REVIEWED_RELINK")
  })

  it("draws no federated button during the back-office stages", () => {
    expect(cellMigrationWave({ [MIGRATION_WAVE_VARIABLE]: "DISCOVERY" }).ssoOffered).toBe(false)
    expect(cellMigrationWave({ [MIGRATION_WAVE_VARIABLE]: "PRE_LINK" }).ssoOffered).toBe(false)
  })

  it("treats a person at the public page as production, so a test IdP is not offered to them", () => {
    expect(cellMigrationWave({ [MIGRATION_WAVE_VARIABLE]: "TEST_IDP" }).ssoOffered).toBe(false)
  })
})

describe("a value that is not a wave", () => {
  const state = cellMigrationWave({ [MIGRATION_WAVE_VARIABLE]: "sso_required" })

  it("is not read as no migration", () => {
    expect(state.problem).not.toBeNull()
    expect(state.wave).toBeNull()
  })

  it("withholds the method the migration is retiring", () => {
    expect(state.localLoginPermitted).toBe(false)
  })

  it("keeps the method it is moving to, so a typo is not an outage", () => {
    expect(state.ssoOffered).toBe(true)
  })

  it("quotes the value and lists what would have been accepted", () => {
    expect(state.problem).toContain('"sso_required"')
    expect(state.problem).toContain("SSO_REQUIRED")
  })
})
