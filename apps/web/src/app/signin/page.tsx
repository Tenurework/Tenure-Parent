import { redirect } from "next/navigation"
import { SIGN_IN_FAILED_MESSAGE } from "@tenure/identity"
import { auth, signIn } from "@/lib/auth"
import { cellConnections, cellLoginMethods, connectionRefusals } from "@/lib/auth-connections"
import { TenureLogo, TenureWordmark } from "@/components/brand/TenureLogo"

const DEMO_USERS = [
  { email: "director@tenure.demo", name: "Dana Whitfield", role: "OSE Director" },
  { email: "staff@tenure.demo", name: "Sam Ortiz", role: "OSE Staff" },
  { email: "president@tenure.demo", name: "Priya Raman", role: "President · Consulting Club" },
  { email: "vp.finance@tenure.demo", name: "Victor Chen", role: "VP Finance · Consulting Club" },
  { email: "member@tenure.demo", name: "Maya Johnson", role: "Member · Consulting Club" },
  { email: "incoming.president@tenure.demo", name: "Isaiah Brooks", role: "Incoming President (Shadow)" },
  { email: "alumni@tenure.demo", name: "Alex Kim", role: "Past President (Alumni)" },
]

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (session?.user) redirect("/dashboard")

  /**
   * WRK-030-005 — what this page draws comes from the identity REGISTRY.
   *
   * It used to read `process.env.AUTH_DEV_LOGIN` directly, which is one of the
   * checks `cellConnections` makes and none of the others — the same gap
   * `auth-connections.ts` was written to close for `auth.ts`. `cellLoginMethods`
   * and `connectionRefusals` had been exported with ZERO production callers
   * since, so the projection a tenant's sign-in page will use was exercised only
   * by its own unit test. This is the caller.
   *
   * The consequence is real rather than cosmetic: an Okta connection with a
   * missing client id, or with a secret pasted as a value instead of a
   * reference, is refused by `loginMethods` and therefore is not drawn — and
   * `connectionRefusals` says WHY, on the page, instead of the connection
   * silently vanishing and being reported as "SSO is broken".
   */
  // The `detail` strings name a field and a shape ("must be a Secrets Manager
  // ARN … not a value") and never a credential's value — see
  // `validateConnection` in @tenure/provisioning.
  const refusals = connectionRefusals()
  const refusedIds = new Set(refusals.map((r) => r.connectionId))
  // `loginMethods` projects a connection's PRESENCE and status; it does not run
  // `validateConnection`, so an Okta connection with an empty client id is
  // still projected. Offering it would put a button on this page whose
  // authorization request goes out with no client_id and is rejected at the
  // callback — visibly to a student, invisibly to anybody watching. So the
  // refused connections are subtracted from what is drawn, and the reason is
  // shown instead.
  const refusedKinds = new Set(
    cellConnections()
      .filter((c) => refusedIds.has(c.connectionId))
      .map((c) => c.kind),
  )
  const methods = cellLoginMethods().filter((m) => !refusedKinds.has(m.kind))
  const devLoginEnabled = methods.some((m) => m.kind === "COGNITO_LOCAL")
  const ssoMethods = methods.filter((m) => m.kind !== "COGNITO_LOCAL")
  // Only ask for what is actually enforced, so the field never looks decorative.
  const passphraseRequired = Boolean(process.env.DEV_LOGIN_PASSPHRASE)
  const failed = Boolean((await searchParams).error)

  async function devSignIn(formData: FormData) {
    "use server"
    await signIn("dev-login", {
      email: formData.get("email"),
      passphrase: formData.get("passphrase"),
      redirectTo: "/dashboard",
    })
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-base px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-lg">
        <div className="flex items-center gap-2.5">
          <TenureLogo size={26} color="var(--primary)" />
          <h1 className="text-2xl font-bold tracking-tight text-text-1">Tenure</h1>
        </div>
        <p className="mt-1 text-sm text-text-2">
          Institutional knowledge that survives every leadership transition.
        </p>

        {devLoginEnabled ? (
          // One form for every account: the passphrase is asked for once, and
          // each button carries its own email as the submitted value.
          <form action={devSignIn} className="mt-6">
            {passphraseRequired ? (
              <div className="mb-5">
                <label htmlFor="passphrase" className="micro-label mb-1.5 block">
                  Access passphrase
                </label>
                <input
                  id="passphrase"
                  name="passphrase"
                  type="password"
                  autoComplete="off"
                  required
                  aria-describedby="passphrase-help"
                  className="w-full rounded-md border border-border bg-base px-3 py-2 text-sm text-text-1 focus:border-[--border-focus] focus:outline-none"
                />
                <p id="passphrase-help" className="mt-1.5 text-xs text-text-3">
                  This pilot is not yet behind your university&apos;s SSO. Ask the OSE team for the
                  passphrase.
                </p>
              </div>
            ) : null}

            {failed ? (
              /*
               * GE-042-007. One sentence for every failure.
               *
               * This said "That passphrase is not correct", which names which
               * check failed — and once this page is behind a real provider,
               * the same shape says "no account with that address" or "your
               * account is suspended" to whoever is holding the credential. At
               * that moment they are more likely to be the attacker than the
               * owner. Bible §9.1 asks for enumeration resistance; the message
               * lives in the engine so the wording cannot drift per surface.
               *
               * `role="alert"` announces it without moving focus, which is
               * right here: focus belongs on the field the person will use
               * next, and yanking it to a message they have already heard is
               * the accessible-looking version of losing their place.
               *
               * TTES-GATE-010 — the colours. This read `--danger`, which
               * globals.css declares in no theme; it was the only reference to
               * that name in the product. An undefined custom property with no
               * fallback is invalid at computed-value time, so `color` fell back
               * to the inherited body ink and `border-color` to `currentColor`:
               * the one message telling somebody their sign-in failed rendered
               * with no danger semantics at all, in the ordinary text colour.
               * Every audit missed it because all of them enumerate FROM
               * globals.css, so a name a component invents and the stylesheet
               * never declares was invisible to all of them.
               *
               * `--error-text` is the step that carries words (4.5:1 on
               * --bg-surface, the card this sits in) and `--error` is the fill
               * step held to 1.4.11's 3:1 for the edge. Both are in PAIRINGS
               * against this exact surface.
               */
              <p
                role="alert"
                className="mb-4 rounded-md border border-[--error] px-3 py-2 text-sm text-[--error-text]"
              >
                {SIGN_IN_FAILED_MESSAGE}
              </p>
            ) : null}

            <p className="micro-label mb-3">Pilot demo — sign in as</p>
            <ul className="space-y-2">
              {DEMO_USERS.map((u) => (
                <li key={u.email}>
                  <button
                    type="submit"
                    name="email"
                    value={u.email}
                    className="w-full rounded-md border border-border px-4 py-2.5 text-left transition-colors hover:border-[--primary] hover:bg-[--primary-light]"
                  >
                    <span className="block text-sm font-medium text-text-1">{u.name}</span>
                    <span className="block text-xs text-text-2">{u.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </form>
        ) : ssoMethods.length > 0 ? (
          <p className="mt-6 text-sm text-text-2" data-testid="signin-methods">
            Sign in with your university account via{" "}
            {ssoMethods.map((m) => m.displayName).join(" or ")}.
          </p>
        ) : (
          // No method at all, said plainly. "Use your SSO portal" printed over
          // a cell that offers nothing sends somebody to look for a button that
          // is not there.
          <p className="mt-6 text-sm text-text-2" data-testid="signin-methods">
            No sign-in method is configured for this workspace yet.
          </p>
        )}

        {/* A configured connection that is NOT being offered, and why. This is
            the failure that otherwise arrives as "SSO is broken" with nothing
            further: the provider is silently absent and only the registry knows
            it was refused. Field names and shapes only — never a value. */}
        {refusals.length > 0 ? (
          <div
            className="mt-6 rounded-md border border-border bg-base px-3 py-2"
            data-testid="signin-refusals"
          >
            <p className="text-xs font-semibold text-text-1">
              A configured sign-in connection is not being offered
            </p>
            <ul className="mt-1 space-y-0.5">
              {refusals.map((r) => (
                <li key={r.connectionId} className="text-xs text-text-2">
                  {r.connectionId}: {r.problems.join("; ")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="mt-8 flex flex-col items-center gap-1.5">
        <TenureWordmark size={14} textClassName="text-text-3" />
        <p className="text-xs text-text-3">
          © {new Date().getFullYear()} Tenure. All rights reserved.
        </p>
      </div>
    </main>
  )
}
