import { renderToStaticMarkup } from "react-dom/server"

/**
 * WRK-030-005 — the sign-in page draws what the identity REGISTRY offers.
 *
 * `cellLoginMethods` and `connectionRefusals` were exported from
 * `src/lib/auth-connections.ts` with zero production callers: the only importer
 * of that file took `oktaIsUsable` alone, and this page decided what to render
 * from the raw `process.env.AUTH_DEV_LOGIN` string. So the projection a
 * tenant's sign-in page will use was exercised by its own unit test and by
 * nothing else, and a connection the registry refuses was silently absent from
 * the page with no way for anybody looking at it to find out why.
 *
 * These assertions are on the MARKUP THE PAGE EMITS. `auth-connections.test.ts`
 * already proves the registry refuses a connection with no client id; that test
 * stays green the day the page stops asking. This is the half that does not.
 */

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(async () => null),
  signIn: jest.fn(),
}))

import SignInPage from "./page"

/** The page's element tree, rendered. It is an async server component. */
async function render(env: Record<string, string | undefined>): Promise<string> {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const element = await SignInPage({ searchParams: Promise.resolve({}) })
  return renderToStaticMarkup(element)
}

/** Everything this file touches, cleared between cases. */
const CLEARED = {
  AUTH_DEV_LOGIN: undefined,
  OKTA_ISSUER: undefined,
  OKTA_CLIENT_ID: undefined,
  OKTA_CLIENT_SECRET_REF: undefined,
  OKTA_CLIENT_SECRET_EXPIRES_AT: undefined,
  DEV_LOGIN_PASSPHRASE: undefined,
}

const OKTA = {
  OKTA_ISSUER: "https://example.okta.com",
  OKTA_CLIENT_ID: "0oa1b2c3d4e5f6g7h8i9",
  OKTA_CLIENT_SECRET_REF: "/tenure/okta/client-secret",
}

const original = { ...process.env }

beforeEach(() => {
  for (const key of Object.keys(CLEARED)) delete process.env[key]
})

afterAll(() => {
  process.env = original
})

describe("the sign-in page offers what the registry offers", () => {
  it("draws the pilot demo accounts when dev login is a registered connection", async () => {
    const html = await render({ ...CLEARED, AUTH_DEV_LOGIN: "true" })
    expect(html).toContain("Pilot demo — sign in as")
    expect(html).toContain("director@tenure.demo")
  })

  it("names the SSO connection the registry actually offers", async () => {
    const html = await render({ ...CLEARED, ...OKTA })
    expect(html).toContain("Sign in with your university account via Okta.")
    expect(html).not.toContain("director@tenure.demo")
    expect(html).not.toContain("signin-refusals")
  })

  it("refuses to offer a broken connection, and says why on the page", async () => {
    // The case the raw-environment read could never produce: OKTA_ISSUER is
    // set, so `process.env.OKTA_ISSUER` is truthy and the old page would have
    // pointed somebody at an SSO button whose authorization request goes out
    // with an empty client_id and is rejected at the callback.
    const html = await render({ ...CLEARED, ...OKTA, OKTA_CLIENT_ID: "" })

    expect(html).toContain("No sign-in method is configured")
    expect(html).toContain("A configured sign-in connection is not being offered")
    expect(html).toContain("cell-okta")
    expect(html).toContain("pool or app client")
  })

  it("never prints a credential value, only the shape it should have had", async () => {
    const html = await render({
      ...CLEARED,
      ...OKTA,
      OKTA_CLIENT_SECRET_REF: "s3cr3t-client-secret-value",
      OKTA_CLIENT_SECRET: "super-secret-value",
    })

    expect(html).toContain("A configured sign-in connection is not being offered")
    expect(html).toContain("must be a Secrets Manager ARN")
    expect(html).not.toContain("s3cr3t-client-secret-value")
    expect(html).not.toContain("super-secret-value")
  })

  it("says plainly that nothing is configured rather than pointing at a portal", async () => {
    const html = await render({ ...CLEARED })
    expect(html).toContain("No sign-in method is configured")
    expect(html).not.toContain("director@tenure.demo")
  })
})
