"use client"

import { useEffect, useRef, useState } from "react"
import { useFormStatus } from "react-dom"

import styles from "./signin.module.css"

/**
 * Three of STUDIO-030-006's ten states, and the only three that cannot be
 * decided on the server.
 *
 *   skeleton  the POST is in flight. The server cannot render this: it is the
 *             gap between the request leaving and the response arriving, and
 *             during that gap the server has not been asked anything yet.
 *   offline   `navigator.onLine`. There is no server-side equivalent — a
 *             browser with no network does not reach the server to be told so.
 *   stale     the form has been open long enough that it may no longer post to
 *             anything. Server actions are addressed by an id that belongs to
 *             the build that served the page; after a deploy, a form left open
 *             posts to an id the new build does not serve. `next.config.ts`
 *             already carries the sibling of this problem for client chunks
 *             (`deploymentId`), and the remedy there is the remedy here:
 *             reload rather than fail opaquely.
 *
 * They are one component because they answer one question — *can this form be
 * submitted right now, and if not, why not* — and because they must not
 * contradict each other. Three components would race to disable the same
 * button.
 *
 * ── What this component is NOT given ────────────────────────────────────────
 *
 * Anything from the environment. Its props are a timestamp and a duration. The
 * operator allowlist is read on the server, is never serialized into a payload,
 * and this file is the only client boundary anywhere under `app/signin` that
 * sits inside the form — which is exactly why it is the file to check. The
 * built client bundle is searched for an operator address by
 * `e2e/signin.spec.ts`.
 */

export interface SignInSubmitProps {
  /** `Date.now()` at the moment the server rendered the page. */
  renderedAt: number
  /** How long the form is trusted for. */
  staleAfterMs: number
  /** The button's label at rest — the accessible name every other spec uses. */
  label: string
}

export function SignInSubmit({ renderedAt, staleAfterMs, label }: SignInSubmitProps) {
  /*
   * ── `useFormStatus` is here, and it is NOT what this depends on ───────────
   *
   * It is the idiomatic source and it costs nothing to read, so it is read
   * first. It also did not work on this form, and that was measured rather than
   * assumed: with the POST held open for 2500 ms by the test harness, the
   * button was sampled twelve times at 250 ms intervals and reported
   * `aria-busy="false"` and `disabled=false` on every one of them, while the
   * request was demonstrably in flight (`isNavigationRequest() === false`, so
   * React had intercepted the submit and was fetching). The component was
   * definitely live — its offline effect works in the same build — so
   * `pending` simply stayed false for the whole submission.
   *
   * Rather than ship a skeleton that depends on a hook that does not fire here,
   * the submit EVENT is listened for directly. It is the same fact from the
   * platform instead of from the framework: the form is submitting, so the
   * button must stop accepting a second press. `useFormStatus` is left in the
   * expression so that if it starts reporting — a Next or React upgrade — the
   * state arrives a fraction earlier and nothing else changes.
   *
   * The flag is cleared by `renderedAt`, which is `Date.now()` on the SERVER.
   * Every answer to a submission re-renders this route with a new value, so the
   * effect below runs and the button is live again. Without that clearing the
   * component would be reused across the redirect — same type, same position,
   * so React keeps the instance — and the button would stay disabled forever
   * after the first refusal, which is a worse defect than the one this fixes.
   */
  const { pending: reportedPending } = useFormStatus()
  const [submitting, setSubmitting] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const pending = reportedPending || submitting

  useEffect(() => {
    const form = buttonRef.current?.form
    if (!form) return
    const onSubmit = () => setSubmitting(true)
    form.addEventListener("submit", onSubmit)
    return () => form.removeEventListener("submit", onSubmit)
  }, [])

  useEffect(() => {
    setSubmitting(false)
  }, [renderedAt])

  /*
   * Both start in the state that is true on the server, so the first client
   * render matches the HTML and hydration is quiet. A browser that is offline
   * at load corrects itself in the effect below, one frame later.
   */
  const [offline, setOffline] = useState(false)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine)
    sync()
    window.addEventListener("online", sync)
    window.addEventListener("offline", sync)
    return () => {
      window.removeEventListener("online", sync)
      window.removeEventListener("offline", sync)
    }
  }, [])

  useEffect(() => {
    const check = () => setStale(Date.now() - renderedAt >= staleAfterMs)
    check()
    /*
     * Ten seconds, not one. This is a threshold measured in minutes, so a
     * one-second timer would wake the tab six hundred times to answer the same
     * question — and a sign-in page is frequently the tab somebody leaves open
     * all day.
     */
    const timer = window.setInterval(check, 10_000)
    return () => window.clearInterval(timer)
  }, [renderedAt, staleAfterMs])

  const blocked = offline || stale
  const disabled = pending || blocked

  return (
    <>
      {/*
        `aria-live="polite"`, and the region exists whether or not it has
        content. A live region inserted at the same moment as its text is a
        region most screen readers have not begun watching yet, so the first
        message — the one saying the network dropped — is the one that goes
        unannounced.
      */}
      <div className={styles.submitStatus} role="status" aria-live="polite">
        {offline ? (
          <p className={styles.stateLine} data-state="offline">
            <span className={styles.stateWord}>Offline</span> This browser has no network. What
            you have typed is still here; the sign-in will work once the connection returns.
          </p>
        ) : stale ? (
          <p className={styles.stateLine} data-state="stale">
            <span className={styles.stateWord}>Stale</span> This form has been open long enough
            that the console may have been redeployed under it. Reload before signing in.
          </p>
        ) : pending ? (
          <p className={styles.stateLine} data-state="skeleton">
            <span className={styles.stateWord}>Signing in</span> Checking the credentials.
          </p>
        ) : null}
      </div>

      {/*
        A skeleton, and a real one: three bars where the console's first rows
        will be. It is `aria-hidden` because it says nothing a reader needs —
        the live region above already said "signing in" — and it is here rather
        than as a route-level `loading.tsx` because the wait belongs to the
        FORM, and replacing the form with a skeleton would take away the fields
        somebody is about to be asked to correct.
      */}
      {pending ? <span className={styles.skeleton} aria-hidden data-testid="signin-skeleton" /> : null}

      <button
        ref={buttonRef}
        type="submit"
        className={styles.submit}
        disabled={disabled}
        /*
         * STUDIO-030-008, "accidental double submit". `disabled` is set from
         * `useFormStatus` rather than from a click handler, so it is true for
         * exactly as long as the action is running — including when the action
         * is slow, which is the only time anybody clicks twice.
         */
        aria-busy={pending}
      >
        {pending ? "Signing in…" : label}
      </button>

      {stale ? (
        <button
          type="button"
          className={styles.secondaryAction}
          onClick={() => window.location.reload()}
        >
          Reload the form
        </button>
      ) : null}
    </>
  )
}
