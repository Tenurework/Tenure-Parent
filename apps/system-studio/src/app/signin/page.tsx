import { redirect } from "next/navigation"

import { AuthError } from "next-auth"

import { auth, signIn } from "@/lib/auth"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

export const dynamic = "force-dynamic"

/**
 * Operator sign-in.
 *
 * One form, two fields, and a single failure message for every way it can fail.
 * Distinguishing "that address is not an operator" from "that secret is wrong"
 * would turn this page into an oracle for which Tenure staff exist, which is a
 * list worth having if you are trying to phish one of them.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const misconfigured = operatorConfigProblems()
  if (misconfigured.length > 0) {
    return (
      <div className="misconfigured">
        <h1>Not configured</h1>
        <p>Sign-in is unavailable until these are set:</p>
        <ul>
          {misconfigured.map((p) => (
            <li key={p.variable}>
              <b>{p.variable}</b> — {p.detail}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const session = await auth()
  if (isOperator(session?.user?.email)) redirect("/")

  const { error } = await searchParams

  return (
    <>
      <h1>Tenure staff</h1>
      <p>This console shows every tenant&rsquo;s configuration.</p>

      {error && <p className="error">Those credentials were not accepted.</p>}

      <form
        className="signin"
        action={async (formData: FormData) => {
          "use server"
          try {
            await signIn("operator", {
              email: String(formData.get("email") ?? ""),
              secret: String(formData.get("secret") ?? ""),
              redirectTo: "/",
            })
          } catch (err) {
            // Catch ONLY an authentication failure, and rethrow everything else.
            //
            // The previous version did the opposite — it tried to recognise the
            // success case by looking for "NEXT_REDIRECT" in `err.message`. Next
            // puts that marker on `err.digest`, not on the message, so the check
            // never matched: `signIn` signals SUCCESS by throwing a redirect,
            // that redirect fell through to the line below, and a correct email
            // and secret were answered with "Those credentials were not
            // accepted". The credentials were fine; the handler discarded them.
            //
            // Matching on the failure instead of guessing at the success removes
            // the string-matching entirely. AuthError is what next-auth throws
            // when `authorize` returns null; a redirect is not an AuthError, so
            // it propagates and the browser follows it.
            if (err instanceof AuthError) redirect("/signin?error=1")
            throw err
          }
        }}
      >
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Operator secret
          <input name="secret" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </>
  )
}
