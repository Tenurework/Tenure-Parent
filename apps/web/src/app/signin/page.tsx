import { redirect } from "next/navigation"
import { SIGN_IN_FAILED_MESSAGE } from "@tenure/identity"
import { auth, signIn } from "@/lib/auth"
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

  const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true"
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
               */
              <p
                role="alert"
                className="mb-4 rounded-md border border-[--danger] px-3 py-2 text-sm text-[--danger]"
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
        ) : (
          <p className="mt-6 text-sm text-text-2">
            Sign in with your university account via your institution&apos;s SSO portal.
          </p>
        )}
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
