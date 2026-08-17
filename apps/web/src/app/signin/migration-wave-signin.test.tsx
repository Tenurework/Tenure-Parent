import { renderToStaticMarkup } from "react-dom/server"

/**
 * IER-100-008 and IER-100-011 — asserted on the MARKUP THE SIGN-IN PAGE EMITS.
 *
 * `sso-migration.test.ts` proves the engine's rules and `migration-wave.test.ts`
 * proves the environment is read correctly. Both of those stay green the day the
 * page stops asking, which is the failure mode this file exists for: a wave
 * ladder nothing draws is a wave ladder that does not restrict anybody.
 *
 * The load-bearing case is `RETIRED`. The page must not print "your
 * administrator can restore the previous method", because after retirement
 * there is nothing to restore and the thing a support process reaches for
 * instead is a fresh local account — a second way to be somebody, established
 * without the evidence the first one needed.
 */

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(async () => null),
  signIn: jest.fn(),
}))

import SignInPage from "./page"

async function render(env: Record<string, string | undefined>): Promise<string> {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const element = await SignInPage({ searchParams: Promise.resolve({}) })
  return renderToStaticMarkup(element)
}

/** Everything this file sets, cleared between cases. */
const TOUCHED = [
  "AUTH_DEV_LOGIN",
  "OKTA_ISSUER",
  "OKTA_CLIENT_ID",
  "OKTA_CLIENT_SECRET_REF",
  "DEV_LOGIN_PASSPHRASE",
  "SSO_MIGRATION_WAVE",
]

const OKTA = {
  OKTA_ISSUER: "https://example.okta.com",
  OKTA_CLIENT_ID: "0oa1b2c3d4e5f6g7h8i9",
  OKTA_CLIENT_SECRET_REF: "/tenure/okta/client-secret",
}

const original = { ...process.env }

beforeEach(() => {
  for (const key of TOUCHED) delete process.env[key]
})

afterAll(() => {
  process.env = original
})

/** The heading of the local method's form. Its presence is the local method. */
const LOCAL_FORM = "Pilot demo — sign in as"

describe("the wave decides which methods the page draws", () => {
  it("draws the local method when no migration is configured", async () => {
    const html = await render({ AUTH_DEV_LOGIN: "true" })
    expect(html).toContain(LOCAL_FORM)
    expect(html).not.toContain('data-testid="signin-recovery"')
  })

  it("still draws it during the hybrid period", async () => {
    const html = await render({ AUTH_DEV_LOGIN: "true", SSO_MIGRATION_WAVE: "HYBRID" })
    expect(html).toContain(LOCAL_FORM)
  })

  it("stops drawing it once SSO is required, even though the connection is still registered", async () => {
    const html = await render({ AUTH_DEV_LOGIN: "true", SSO_MIGRATION_WAVE: "SSO_REQUIRED" })
    expect(html).not.toContain(LOCAL_FORM)
    // And not merely blank: the page has to say what to do instead.
    expect(html).toContain('data-testid="signin-recovery"')
  })

  it("stops drawing it at local disablement and through the rollback window", async () => {
    for (const wave of ["LOCAL_DISABLED", "ROLLBACK_WINDOW", "RETIRED"]) {
      const html = await render({ AUTH_DEV_LOGIN: "true", SSO_MIGRATION_WAVE: wave })
      expect(html).not.toContain(LOCAL_FORM)
    }
  })

  it("withholds the federated button during the back-office stages", async () => {
    const html = await render({ ...OKTA, SSO_MIGRATION_WAVE: "PRE_LINK" })
    expect(html).not.toContain("Okta")
    expect(html).toContain("No sign-in method is configured for this workspace yet.")
  })

  it("draws the federated button from the pilot onward", async () => {
    const html = await render({ ...OKTA, SSO_MIGRATION_WAVE: "PILOT" })
    expect(html).toContain("Okta")
  })
})

describe("what the page tells somebody who cannot get in", () => {
  it("points at the old method while it still works", async () => {
    const html = await render({ AUTH_DEV_LOGIN: "true", SSO_MIGRATION_WAVE: "HYBRID" })
    expect(html).toContain("Your previous sign-in method still works")
  })

  it("offers an operator rollback while one is possible", async () => {
    const html = await render({ ...OKTA, SSO_MIGRATION_WAVE: "SSO_REQUIRED" })
    expect(html).toContain("can restore the previous method")
  })

  it("offers no rollback and no new account after retirement", async () => {
    const html = await render({ ...OKTA, SSO_MIGRATION_WAVE: "RETIRED" })
    expect(html).toContain("has been retired")
    expect(html).not.toContain("can restore the previous method")
  })
})

describe("a wave nobody can read", () => {
  it("withholds the local method and prints why, rather than the control evaporating", async () => {
    const html = await render({ AUTH_DEV_LOGIN: "true", ...OKTA, SSO_MIGRATION_WAVE: "sso_required" })
    expect(html).not.toContain(LOCAL_FORM)
    expect(html).toContain('data-testid="signin-wave-problem"')
    expect(html).toContain("is not a migration wave")
    // The federated method survives, so a typo is not an outage.
    expect(html).toContain("Okta")
  })
})
