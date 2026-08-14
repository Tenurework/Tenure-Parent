import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { AuthError } from "next-auth"

import { Logo } from "@/components/md3/Logo"
import { auth, signIn, signOut } from "@/lib/auth"
import { authConfigProblems, studioAuthMode } from "@/lib/auth-config"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

import { Announce } from "./Announce"
import { RetryCountdown } from "./RetryCountdown"
import { SignInSubmit } from "./SignInSubmit"
import {
  FREE_ATTEMPTS,
  attemptStore,
  clearKey,
  clientKeyFrom,
  recordFailure,
  verdictFor,
} from "./attempts"
import {
  STALE_AFTER_MS,
  configFacts,
  isRedirectError,
  signInView,
  type ConfigBlock,
  type SignInView,
} from "./signin-state"
import styles from "./signin.module.css"

/**
 * The door.
 *
 * ── What this page was, and what the operator said about it ─────────────────
 *
 * A hundred and eleven lines: an `<h1>`, a sentence, two unlabelled-by-anything
 * inputs, a button, and one failure message. No mark, no product name, one
 * state, and a "Not configured" panel that said the same thing to a deployment
 * nobody had configured, a deployment three-quarters configured, and a
 * deployment whose issuer URL had a typo in it. It is also the first — often
 * the only — thing anybody sees of this product.
 *
 * ── STUDIO-030-006, and why this surface is the one that has all ten ────────
 *
 * "Implement skeleton, empty, no-permission, stale, partial, error, retrying,
 * offline, degraded, and conflict states for every asynchronous surface." Every
 * other surface in this console reads AWS and reports what came back. This one
 * is the only one a stranger can reach, the only one whose own configuration
 * decides whether it can work at all, and the only one where the difference
 * between two states is a security property rather than a nicety. All ten are
 * implemented here; `signin-state.ts` names what each one MEANS on a sign-in
 * form, and `signin.spec.ts` drives every one of them in a browser.
 *
 * ── Two properties that are not cosmetic ────────────────────────────────────
 *
 * **1. The refusal says nothing about which half was wrong.** A wrong address
 * and a wrong secret produce the same sentence, from the same code path, at the
 * same speed — `authenticateOperator` evaluates both halves regardless, and
 * this page has exactly one refusal message. Distinguishing them would make
 * this page an oracle for which addresses are Tenure staff, which is a list
 * worth having if you are trying to phish one of them. The lock-out is keyed on
 * the CLIENT and never on the submitted address, for the same reason and with
 * the same care — see `attempts.ts`.
 *
 * **2. It is a server component, and the allowlist never leaves the server.**
 * `PLATFORM_OPERATORS` is read here, by `operatorConfigProblems` and
 * `isOperator`, in a module that ships no JavaScript to the browser. The three
 * client components under this directory are handed a timestamp, a duration and
 * a label, and nothing else; none of them is passed a value read from the
 * environment, and `signin-state.ts` returns variable NAMES rather than values
 * precisely so that a misconfiguration panel cannot become a way to read the
 * allowlist off an unauthenticated page. `e2e/signin.spec.ts` greps the built
 * client bundle for an operator address and fails if it finds one.
 */

export const dynamic = "force-dynamic"

/* ─────────────────────────────────────────────────────────── the state words ──
 *
 * The vocabulary of `components/states.tsx`, applied to this surface. It is
 * repeated as data rather than imported because `states.tsx` renders MD3 blocks
 * for a console panel and this page renders a line inside a form; what has to
 * stay identical is the WORD, so the word is what is written down.
 */
const STATE_WORD = {
  empty: "Empty",
  partial: "Partial",
  error: "Error",
  retrying: "Retrying",
  refused: "Refused",
  noPermission: "Denied",
  stale: "Stale",
  conflict: "Conflict",
  degraded: "Degraded",
} as const

/** `18:42:07 UTC`. Deterministic, and the same string in every locale. */
function utcClock(at: number): string {
  return `${new Date(at).toISOString().slice(11, 19)} UTC`
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const mode = studioAuthMode()

  /*
   * The existing validators, unchanged and uncopied. This page decides how to
   * PRESENT a misconfiguration; what counts as one is still owned by
   * `lib/auth-config.ts` and `lib/operators.ts`, and a second opinion about
   * that here is how a console ends up refusing a deployment the rest of it
   * considers fine.
   */
  const problems = [
    ...authConfigProblems(),
    ...operatorConfigProblems(undefined, { requireSharedSecret: mode === "credentials" }),
  ]
  const facts = configFacts(mode, problems, process.env)

  const session = await auth()
  const sessionEmail =
    typeof session?.user?.email === "string" ? session.user.email.trim().toLowerCase() : ""
  if (isOperator(sessionEmail)) redirect("/")

  const requestHeaders = await headers()
  const clientKey = clientKeyFrom((name) => requestHeaders.get(name))
  const lock = verdictFor(attemptStore(), clientKey, Date.now())

  const { error } = await searchParams

  const view = signInView({
    mode,
    nodeEnv: process.env.NODE_ENV,
    facts,
    errorParam: error,
    // Present only when a session exists AND it is not an operator's — the
    // operator case redirected above and never reaches here.
    strandedSession: sessionEmail || null,
    lock,
  })

  const renderedAt = Date.now()

  return (
    <div className={styles.page}>
      <section className={styles.identity} aria-labelledby="signin-task">
        {/*
          The mark at the size it is drawn for, with explicit width and height
          attributes so it occupies its space before the stylesheet lands.
          `decorative`, because the lockup draws the word "Tenure" and the
          heading below says it again — a named mark beside a visible name is
          read aloud twice.
        */}
        <Logo size={40} decorative className={styles.lockup} />
        <p className={`${styles.product} md3-label-large`}>System Studio</p>
        <h1 id="signin-task" className={`${styles.task} md3-headline-medium`}>
          Tenure staff
        </h1>
        <p className={`${styles.blurb} md3-body-large`}>
          This console holds every organization system Tenure runs — their configuration, their
          AWS estate and their cost. Sign in to reach it.
        </p>
        <ul className={styles.facts}>
          {[
            "Internal only. Nothing here is a customer surface.",
            "Access is by allowlist. Being able to authenticate is not being able to act.",
            "Every action taken here is written to the audit ledger, with who and when.",
          ].map((fact) => (
            <li key={fact} className={styles.fact}>
              <span className={styles.factMark} aria-hidden />
              <span className={`${styles.factText} md3-body-medium`}>{fact}</span>
            </li>
          ))}
        </ul>
      </section>

      {/*
        `aria-labelledby` is what `signin.spec.ts` scopes its state assertions
        to, and it is deliberately NOT a `data-testid`.

        The reason is that this console's other surfaces use `data-state` too —
        the shell's offline banner is one — so a bare `[data-state="offline"]`
        matches two elements on this page, and an unscoped assertion can pass on
        somebody else's component while this page's own state is missing. A
        test-only attribute would fix that and would also be a hook that can be
        deleted without anything else noticing. The accessible name cannot: if
        this attribute goes, the card stops announcing what it is, so the
        selector and the accessibility are the same fact.
      */}
      <section className={styles.card} aria-labelledby="signin-card-heading">
        <h2 id="signin-card-heading" className={`${styles.cardHeading} md3-title-large`}>
          {view.blocking ? "Sign-in unavailable" : "Operator sign-in"}
        </h2>

        <Notices view={view} sessionEmail={sessionEmail} />

        {view.blocking ? (
          <Blocked view={view} />
        ) : view.path === "federated" ? (
          <Federated />
        ) : (
          <Credentials renderedAt={renderedAt} />
        )}
      </section>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────── the states ── */

function Notices({ view, sessionEmail }: { view: SignInView; sessionEmail: string }) {
  if (view.notices.length === 0) return null
  return (
    <div className={styles.notices}>
      {view.notices.map((notice) => (
        <Announce
          key={notice.kind}
          takeFocus={notice.assertive}
          className={styles.notice}
          // The state is on the DOM as data, so a test asserts the STATE rather
          // than a sentence somebody will reword.
          dataState={notice.kind}
        >
          {notice.kind === "refused" ? (
            <>
              <p className={`${styles.stateLine} md3-body-medium`}>
                <span className={styles.stateWord}>{STATE_WORD.refused}</span> Those credentials
                were not accepted.
              </p>
              <p className={`${styles.stateLine} md3-body-small`}>
                The address and the secret are checked together and refused together. This page
                will not tell you which of the two was wrong, because that would tell anyone else
                which addresses are Tenure staff.
              </p>
            </>
          ) : notice.kind === "noPermission" ? (
            <>
              <p className={`${styles.stateLine} md3-body-medium`}>
                <span className={styles.stateWord}>{STATE_WORD.noPermission}</span> That identity
                signed in successfully and is not authorised for this console.
              </p>
              <p className={`${styles.stateLine} md3-body-small`}>
                Authenticating is not authorisation. An operator has to add the address to the
                allowlist, with a role, before it can reach anything here.
              </p>
            </>
          ) : notice.kind === "stale" ? (
            <p className={`${styles.stateLine} md3-body-medium`}>
              <span className={styles.stateWord}>{STATE_WORD.stale}</span> Your session ended and
              you were sent back here. Sign in again to carry on.
            </p>
          ) : notice.kind === "conflict" ? (
            <>
              <p className={`${styles.stateLine} md3-body-medium`}>
                <span className={styles.stateWord}>{STATE_WORD.conflict}</span> This browser is
                already signed in as <b>{sessionEmail}</b>, which is not an operator. Every page
                in the console will refuse that session.
              </p>
              {/*
                A remedy, not just a diagnosis. Without this the only fix is
                clearing a cookie by hand — which is exactly how the state
                arises in the first place.
              */}
              <form action={endSession}>
                <button type="submit" className={styles.secondaryAction}>
                  Sign out of that session
                </button>
              </form>
            </>
          ) : (
            <>
              <p className={`${styles.stateLine} md3-body-medium`}>
                <span className={styles.stateWord}>{STATE_WORD.degraded}</span> This is a
                production build authenticating with a shared secret rather than federated
                identity.
              </p>
              <p className={`${styles.stateLine} md3-body-small`}>
                A shared secret has no per-person identity, no revocation short of rotating it
                for everybody, and no second factor. It is the harness path. Set
                <code className={styles.variableName}> STUDIO_AUTH_MODE=cognito </code>
                to use the federated one.
              </p>
            </>
          )}
        </Announce>
      ))}
    </div>
  )
}

function Blocked({ view }: { view: SignInView }) {
  const blocking = view.blocking
  if (!blocking) return null

  if (blocking.kind === "retrying") {
    return (
      <div className={styles.blocked} data-state="retrying">
        <p className={`${styles.stateLine} md3-body-medium`}>
          <span className={styles.stateWord}>{STATE_WORD.retrying}</span> Too many refused
          attempts from this client. Sign-in from here is paused.
        </p>
        <p className={`${styles.stateLine} md3-body-medium`}>
          The next attempt is accepted after{" "}
          <span className={styles.lockClock}>{utcClock(blocking.retryAt ?? Date.now())}</span>
          {blocking.retryAt ? (
            <>
              {" — "}
              <RetryCountdown retryAt={blocking.retryAt} />
            </>
          ) : null}
        </p>
        <p className={`${styles.stateLine} md3-body-small`}>
          {blocking.failures} refusals recorded, after {FREE_ATTEMPTS} were allowed. The count is
          against this client, not against any address that was typed — nothing here says whether
          an address exists.
        </p>
      </div>
    )
  }

  return <Misconfigured block={blocking.config} kind={blocking.kind} />
}

/**
 * Three states that used to be one panel headed "Not configured".
 *
 * The distinction is the remedy. `empty` hands over the whole list, `partial`
 * hands over only what is still missing, and `error` says that everything is
 * set and one of the values is refused — which is a different afternoon.
 */
function Misconfigured({
  block,
  kind,
}: {
  block: ConfigBlock
  kind: "empty" | "partial" | "error"
}) {
  const headline =
    kind === "empty"
      ? "Nothing is configured. No address can sign in here."
      : kind === "partial"
        ? `Part-configured: ${block.missing.length} of the variables this console needs are still not set.`
        : "Everything is set, and one of the values is refused."

  return (
    <div className={styles.blocked} data-state={kind}>
      <p className={`${styles.stateLine} md3-body-medium`}>
        <span className={styles.stateWord}>{STATE_WORD[kind]}</span> {headline}
      </p>

      {block.missing.length > 0 ? (
        <>
          <p className={`${styles.stateLine} md3-body-small`}>Not set:</p>
          <ul className={styles.variables}>
            {block.missing.map((name) => (
              <li key={name} className={styles.variable}>
                <span className={`${styles.variableName} md3-label-large`}>{name}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className={`${styles.stateLine} md3-body-small`}>
        {block.problems.length === 1 ? "The check that refused:" : "The checks that refused:"}
      </p>
      <ul className={styles.variables}>
        {block.problems.map((problem, index) => (
          <li key={`${problem.variable}-${index}`} className={styles.variable}>
            <span className={`${styles.variableName} md3-label-large`}>{problem.variable}</span>
            <p className={`${styles.variableDetail} md3-body-small`}>{problem.detail}</p>
          </li>
        ))}
      </ul>

      <p className={`${styles.stateLine} md3-body-small`}>
        Values are never shown here. This page is served to anyone who can reach the host, and
        the variable holding the allowlist holds every operator&rsquo;s address.
      </p>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────── the two paths ── */

function Federated() {
  return (
    <form className={styles.federated} action={federatedSignIn}>
      <p className={`${styles.cardSupport} md3-body-medium`}>
        Sign-in is federated. You will be sent to the identity provider and back; this console
        never sees a password.
      </p>
      <button type="submit" className={styles.submit}>
        Continue with Cognito
      </button>
    </form>
  )
}

function Credentials({ renderedAt }: { renderedAt: number }) {
  return (
    <form className={styles.form} action={credentialsSignIn}>
      {/*
        The label is a real `<label for>` and it is persistent, never a
        placeholder that disappears when you type. `components/md3/TextField`
        argues the same case for the console's other forms; the fields here are
        written out rather than composed from it because this form is the one
        piece of the console that must keep working when the design system is
        being changed underneath it — twenty other specs sign in through these
        two labels to reach the pages they actually test.
      */}
      <div className="md3-field">
        <label className="md3-field-label md3-label-large" htmlFor="signin-email">
          Email
        </label>
        <input
          className="md3-field-input md3-body-medium"
          id="signin-email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-describedby="signin-email-support"
        />
        <p className="md3-field-support md3-body-small" id="signin-email-support">
          The address on the operator allowlist.
        </p>
      </div>

      <div className="md3-field">
        <label className="md3-field-label md3-label-large" htmlFor="signin-secret">
          Operator secret
        </label>
        <input
          className="md3-field-input md3-body-medium"
          id="signin-secret"
          name="secret"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby="signin-secret-support"
        />
        <p className="md3-field-support md3-body-small" id="signin-secret-support">
          Shared across Tenure staff. Not your Tenure password.
        </p>
      </div>

      {/*
        Nothing about the client is carried in the form. The lock-out key is
        read from the request headers by the action itself, because a value
        round-tripped through a hidden field is a value the client chooses —
        which would let anybody reset their own rate limit by editing the DOM.
      */}
      <SignInSubmit renderedAt={renderedAt} staleAfterMs={STALE_AFTER_MS} label="Sign in" />
    </form>
  )
}

/* ──────────────────────────────────────────────────────────────── the actions ── */

async function endSession() {
  "use server"
  await signOut({ redirectTo: "/signin" })
}

async function federatedSignIn() {
  "use server"
  await signIn("cognito", { redirectTo: "/" })
}

async function credentialsSignIn(formData: FormData) {
  "use server"

  const requestHeaders = await headers()
  const key = clientKeyFrom((name) => requestHeaders.get(name))
  const store = attemptStore()

  /*
   * The lock is enforced HERE, not only where it is drawn.
   *
   * Hiding the form is a courtesy to a person; it is nothing at all to a
   * script, which posts to the action directly and never renders anything. A
   * rate limit that lives in the view is not a rate limit.
   *
   * An attempt made while locked counts as another refusal, which is what makes
   * the backoff bite on exactly the client it is meant to: somebody who cannot
   * see the form has already been told to wait.
   */
  if (verdictFor(store, key, Date.now()).locked) {
    recordFailure(store, key, Date.now())
    redirect("/signin")
  }

  try {
    await signIn("operator", {
      email: String(formData.get("email") ?? ""),
      secret: String(formData.get("secret") ?? ""),
      redirectTo: "/",
    })
  } catch (err) {
    /*
     * Catch ONLY an authentication failure, and rethrow everything else.
     *
     * An earlier version tried to recognise the SUCCESS case by looking for
     * "NEXT_REDIRECT" in `err.message`. Next puts that marker on `err.digest`,
     * so the check never matched: `signIn` signals success by throwing a
     * redirect, that redirect fell through, and a correct email and secret were
     * answered with "Those credentials were not accepted". Matching on the
     * failure — `AuthError`, which is what next-auth throws when `authorize`
     * returns null — removes the guessing.
     */
    if (err instanceof AuthError) {
      recordFailure(store, key, Date.now())
      redirect("/signin?error=1")
    }

    /*
     * A redirect at this point is the SUCCESS signal, so the client's refusals
     * are forgiven: an operator who mistyped twice does not carry those two for
     * the next quarter of an hour, and this console's own end-to-end suite does
     * not slowly lock itself out of the machine it runs on. Checked by digest
     * rather than assumed, so an internal error is rethrown without quietly
     * clearing the brake.
     */
    if (isRedirectError(err)) clearKey(store, key)
    throw err
  }
}
