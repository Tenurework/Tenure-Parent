import type { ReactNode } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AccountMenu, SearchTrigger } from "./AccountMenu"
import { Chip, Surface } from "./md3"
import { Logo } from "./md3/Logo"
import { auth, signOut } from "@/lib/auth"
import { cognitoProviderConfig, studioAuthMode } from "@/lib/auth-config"
import { roleOf, type OperatorRole } from "@/lib/operators"
import { identityHeadline, resolveIdentity } from "@/lib/aws/identity"

import styles from "./topbar.module.css"

/**
 * STUDIO-030-003 — the console's top bar: the mark, the estate, global search,
 * and the account menu that holds the only sign-out this application has.
 *
 * ## What was here before
 *
 * `layout.tsx` rendered four spans: the word "Tenure" in a pill with a 10px
 * square beside it, the words "System Studio", the preferences control, and an
 * "Internal" badge. The operator's own list of what was missing was "no logout,
 * back and forth, global search and interactions", and three of those four are
 * this file's:
 *
 *   * **Sign-out did not exist anywhere.** `grep -rn "signOut" src` returned one
 *     line — the re-export in `lib/auth.ts` — and nothing consumed it. An
 *     operator who reached this console on a shared machine could not leave it.
 *   * **Global search was invisible.** `components/Launcher.tsx` has been
 *     mounted in the layout since GE-022-007 and opens on Ctrl/Cmd-K. A
 *     keyboard shortcut with no visible affordance is a feature only its author
 *     uses. This file gives it a trigger that says its own shortcut; it does
 *     NOT build a second palette.
 *   * **The mark was a placeholder.** `components/md3/Logo` draws the real
 *     rosette and wordmark, and it links home — which is also the cheapest
 *     "back" a console has.
 *
 * ## Three things this bar refuses to guess
 *
 * 1. **The role.** `PLATFORM_OPERATORS` is `email:role` and an entry with no
 *    role is REFUSED rather than defaulted (`lib/operators.ts`). So this bar
 *    prints `roleOf(email)` and, when that is null, says the address holds no
 *    operator role instead of showing a blank chip that reads as "fine".
 *    Five families with different grants exist; an operator who cannot see
 *    which one they are cannot predict which controls will refuse them.
 * 2. **The estate.** Account and region come from `sts:GetCallerIdentity` via
 *    `resolveIdentity()`, which has no fallback by design. A read that did not
 *    answer renders `UNKNOWN`, never blank and never `us-east-1` — the string
 *    that module's own header calls "the single most dangerous string this
 *    console could show".
 * 3. **The federated sign-out.** See `federatedLogoutUrl` below: it is built
 *    only from configuration that is actually present, and returns null rather
 *    than assembling a Cognito hosted-UI host out of a naming convention.
 *
 * ## Why the estate is not shown before sign-in
 *
 * The AWS account number is an identifier worth having if you are trying to
 * reach that account. Pre-auth, `/signin` is served to anybody who can resolve
 * the hostname, so the signed-out bar carries the mark and nothing else. This
 * also keeps `/signin` off the STS path entirely.
 */

/* ── The estate read ───────────────────────────────────────────────────────
 *
 * A chrome element renders on EVERY route, so it cannot pay an unbounded round
 * trip per request. `resolveIdentity` caches successes for `IDENTITY_REFRESH_MS`
 * and deliberately caches nothing else — a role rotated under a running
 * container has to be picked up without a deploy. That is right for the pages
 * that read it once; it is wrong for a bar on every response, where a failing
 * STS call would be re-attempted on every navigation by every operator.
 *
 * So this module bounds the wait and remembers a FAILURE for half a minute. It
 * remembers no success — `resolveIdentity` already does that, and a second
 * success cache would be a second thing to invalidate.
 */

/** Longer than a healthy STS call by an order of magnitude, and still a bound. */
const ESTATE_TIMEOUT_MS = 2_500

/** How long a failed read is allowed to stand before it is attempted again. */
const ESTATE_FAILURE_TTL_MS = 30_000

/** The word this bar prints when it does not know. Never blank, never a guess. */
export const ESTATE_UNKNOWN = "UNKNOWN"

interface Estate {
  account: string
  region: string
  /** The honest sentence: what was read, or why it could not be. */
  detail: string
  known: boolean
}

let cachedFailure: { at: number; estate: Estate } | null = null

/** Test seam: drops the negative cache so a spec is not answered by a prior one. */
export function __resetEstateCache(): void {
  cachedFailure = null
}

async function readEstate(now: () => number = Date.now): Promise<Estate> {
  if (cachedFailure && now() - cachedFailure.at < ESTATE_FAILURE_TTL_MS) {
    return cachedFailure.estate
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = Symbol("timed-out")
  const deadline = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), ESTATE_TIMEOUT_MS)
  })

  let estate: Estate
  try {
    // `resolveIdentity` classifies every failure into the AwsRead union rather
    // than throwing, so the catch below is for the one thing it cannot catch
    // for us: constructing the gateway at all.
    const read = await Promise.race([resolveIdentity(), deadline])
    if (read === timedOut) {
      estate = {
        account: ESTATE_UNKNOWN,
        region: ESTATE_UNKNOWN,
        detail: `unknown — sts:GetCallerIdentity did not answer within ${ESTATE_TIMEOUT_MS}ms`,
        known: false,
      }
    } else if (read.state === "ACTUAL" || read.state === "STALE") {
      estate = {
        account: read.value.accountId,
        region: read.value.region,
        detail: identityHeadline(read),
        known: true,
      }
    } else {
      estate = {
        account: ESTATE_UNKNOWN,
        region: ESTATE_UNKNOWN,
        detail: identityHeadline(read),
        known: false,
      }
    }
  } catch (error) {
    estate = {
      account: ESTATE_UNKNOWN,
      region: ESTATE_UNKNOWN,
      detail: `unknown — the AWS gateway could not be constructed (${
        error instanceof Error ? error.name : "non-Error"
      })`,
      known: false,
    }
  } finally {
    if (timer) clearTimeout(timer)
  }

  cachedFailure = estate.known ? null : { at: now(), estate }
  return estate
}

/* ── Sign-out ──────────────────────────────────────────────────────────────
 *
 * Two halves, and the order between them is the whole of it.
 *
 * `signOut()` from `lib/auth` is NextAuth's, and it ends the session where the
 * session actually lives: the JWT cookie is cleared by a `Set-Cookie` written
 * on the SERVER's response, inside a server action. A client-side
 * `document.cookie = …` would leave the httpOnly cookie untouched, which is
 * what "signed out" looks like until the next navigation proves otherwise.
 *
 * In Cognito mode that is still only half. The Studio's own cookie is gone but
 * the user pool's hosted-UI session is not, so "Continue with Cognito" would
 * sign the same person straight back in without a prompt — the failure that
 * makes a shared machine dangerous. `infrastructure/studio/cognito.tf` already
 * declares `logout_urls`, so the pool is configured to accept a federated
 * logout back to `/signin`; this sends the browser there after clearing the
 * local cookie.
 */

function clean(value: string | undefined): string {
  return (value ?? "").trim()
}

/**
 * The AWS region a Cognito issuer names, or null.
 *
 * `https://cognito-idp.<region>.amazonaws.com/<poolId>` is the shape
 * `auth-config.ts` already validates. Parsed rather than assumed, because the
 * hosted-UI host is `<domain>.auth.<region>.amazoncognito.com` and a region
 * guessed from `AWS_REGION` would point a GovCloud deployment's logout at a
 * commercial host.
 */
export function issuerRegion(issuer: string): string | null {
  try {
    const host = new URL(issuer).hostname
    const match = /^cognito-idp\.([a-z0-9-]+)\.amazonaws\.com$/.exec(host)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Where a federated sign-out should send the browser, or null.
 *
 * Null is the ordinary answer in three real cases, and each falls back to the
 * local sign-out rather than to a constructed URL:
 *
 *   * credentials mode (the local and CI harness) — there is no IdP to leave;
 *   * `COGNITO_DOMAIN` unset — the hosted-UI host is a user-pool DOMAIN, and
 *     the only thing this application is told is the ISSUER, which is a
 *     different host. `cognito.tf` names the domain
 *     `${name_prefix}-${account_id}`; reproducing that expression here would be
 *     this console inventing an AWS hostname from a naming convention, which is
 *     precisely the class of guess the estate readout above refuses to make.
 *     `infrastructure/studio/ecs.tf` is where `COGNITO_DOMAIN` has to be added
 *     to the task definition — that file is not this change's to edit, and this
 *     function is written so that adding it is the only step needed.
 *   * no absolute origin (`AUTH_URL`/`NEXTAUTH_URL`) — `logout_uri` must match
 *     an entry in `logout_urls` exactly, and a relative path never will.
 *
 * Accepts either a bare domain prefix (`tenure-studio-000000000000`) or a full
 * `https://…` origin, because a pool with a custom domain has no prefix form.
 */
export function federatedLogoutUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (studioAuthMode(env) !== "cognito") return null

  const { clientId, issuer } = cognitoProviderConfig(env)
  const domain = clean(env.COGNITO_DOMAIN)
  const origin = clean(env.AUTH_URL) || clean(env.NEXTAUTH_URL)
  if (!clientId || !domain || !origin) return null

  const region = issuerRegion(issuer)
  if (!domain.startsWith("https://") && !region) return null

  try {
    const returnTo = new URL("/signin", origin)
    if (returnTo.protocol !== "https:") return null

    const base = domain.startsWith("https://")
      ? new URL("/logout", domain)
      : new URL(`https://${domain}.auth.${region}.amazoncognito.com/logout`)

    base.searchParams.set("client_id", clientId)
    base.searchParams.set("logout_uri", returnTo.toString())
    return base.toString()
  } catch {
    return null
  }
}

/** How a role slug reads in a sentence. `roleOf` stays the source of truth. */
export function roleLabel(role: OperatorRole): string {
  const words = role.split("-").join(" ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface TopBarProps {
  /**
   * The bar's utility slot, rendered between global search and the account
   * menu. `app/layout.tsx` passes `<PreferencesMenu />` here — it is a control
   * about the viewer rather than about the estate, so it belongs beside the
   * account and not in the middle of the brand.
   */
  children?: ReactNode
}

export async function TopBar({ children }: TopBarProps) {
  const session = await auth()
  const email = typeof session?.user?.email === "string" ? session.user.email : ""
  const role = roleOf(email)
  const signedIn = email !== ""

  const estate = signedIn
    ? await readEstate()
    : { account: ESTATE_UNKNOWN, region: ESTATE_UNKNOWN, detail: "", known: false }

  const federated = federatedLogoutUrl() !== null

  /*
    Declared here rather than in `AccountMenu` because `"use server"` and
    `"use client"` cannot share a module, and because this keeps the session-
    ending call on the server where the cookie is: the client is handed a
    reference it can invoke, never the ability to decide what signing out means.
  */
  async function endSession(): Promise<void> {
    "use server"
    const away = federatedLogoutUrl()
    if (away) {
      // Local first. If the redirect below never happens — the hosted UI is
      // down, the operator closes the tab — the Studio's own session is
      // already gone, which is the half that protects this console.
      await signOut({ redirect: false })
      redirect(away)
    }
    await signOut({ redirectTo: "/signin" })
  }

  return (
    <Surface
      as="div"
      role="banner"
      container="low"
      level={1}
      shape="none"
      className={styles.bar}
      data-topbar="true"
    >
      <div className={styles.lead}>
        {/*
          The mark, and the console's cheapest way back: every route is at most
          one click from the index. `Logo` is `decorative` because this link
          carries its own accessible name — a named mark inside a named link is
          read out twice.
        */}
        <Link href="/" className={styles.home} aria-label="Tenure System Studio, home">
          <Logo size={22} decorative />
          <span className={styles.product}>System Studio</span>
        </Link>

        {signedIn ? (
          <Chip
            title={estate.detail}
            data-estate-known={estate.known ? "true" : "false"}
            data-testid="topbar-estate"
          >
            {/*
              The spaces are real text nodes, not gaps from a `gap` property.
              Four adjacent spans with no whitespace between them have a
              `textContent` of "AWS123456789012·us-east-1", which is what a
              screen reader reads out and what anything copying the readout
              gets — the visual spacing is a lie the accessibility tree does not
              repeat.
            */}
            <span className={styles.estateLabel}>AWS</span>{" "}
            <span className={styles.estateValue}>{estate.account}</span>{" "}
            <span aria-hidden="true">·</span>{" "}
            <span className={styles.estateValue}>{estate.region}</span>
          </Chip>
        ) : null}
      </div>

      {signedIn ? (
        <div className={styles.search}>
          <SearchTrigger />
        </div>
      ) : null}

      <div className={styles.trail}>
        {children}
        {signedIn ? (
          <AccountMenu
            email={email}
            role={role}
            roleName={role ? roleLabel(role) : null}
            estateSummary={`AWS ${estate.account} · ${estate.region}`}
            estateDetail={estate.detail}
            federated={federated}
            signOutAction={endSession}
          />
        ) : (
          <span className={styles.signedOut}>Not signed in</span>
        )}
      </div>
    </Surface>
  )
}
