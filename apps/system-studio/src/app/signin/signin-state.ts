import type { StudioAuthMode } from "@/lib/auth-config"

/**
 * STUDIO-030-006, for the one surface that has every state in the list.
 *
 * ── Why a sign-in form is an asynchronous surface ───────────────────────────
 *
 * It looks like the least asynchronous thing in the console: two fields and a
 * button. It is the opposite. Every other surface reads AWS and reports what
 * came back; this one is the only surface that can be *unusable before anybody
 * touches it* — because it is the only one whose configuration is what decides
 * whether it works at all, and the only one an unauthenticated stranger can
 * reach. The requirement names ten states, and this page reaches all ten:
 *
 *   skeleton       the submission is in flight and the answer is not known yet
 *   empty          nothing is configured; no address on earth can sign in here
 *   partial        some of what the chosen mode needs is set and some is not
 *   error          all of it is set and one value is wrong
 *   no-permission  a federated identity was accepted and is not Tenure staff
 *   stale          this form has been open long enough to have expired under it
 *   conflict       a session for a NON-operator is already held in this browser
 *   retrying       too many refusals from here; the next attempt has a time
 *   offline        the browser has no network, so submitting would lose input
 *   degraded       a production build is authenticating by shared secret
 *
 * ── What lives here and what does not ───────────────────────────────────────
 *
 * This module is pure. No React, no `next/*`, no `process.env` read of its own,
 * no I/O. It is given facts and it returns which states are true, so the
 * decision can be exercised without a browser, a build or a server — and so the
 * page below it has no branching left to get wrong.
 *
 * ── The one rule this module exists to make checkable ───────────────────────
 *
 * **A value from the environment never enters the returned view.** Only
 * variable NAMES. `PLATFORM_OPERATORS` is the list of every Tenure operator's
 * address, and this page is served to anyone who can reach the host: a
 * "misconfigured" panel that helpfully printed the value it found would publish
 * the allowlist to the internet. `configFacts` therefore takes an environment
 * and returns names, never values, and `signin.spec.ts` asserts exactly that by
 * feeding it a sentinel value and searching the whole serialized view for it.
 */

/** One problem, in the shape `lib/auth-config` and `lib/operators` both emit. */
export interface ConfigProblem {
  variable: string
  detail: string
}

/**
 * The environment variables a mode cannot work without.
 *
 * Derived from what `authConfigProblems` and `operatorConfigProblems` actually
 * demand, and deliberately not one name longer. A list with an extra "required"
 * variable on it would render "Not configured" for a deployment that is in fact
 * configured — a refusal invented here rather than by the validator that owns
 * the question.
 */
export function requiredVariables(mode: StudioAuthMode): readonly string[] {
  return mode === "cognito"
    ? ["PLATFORM_OPERATORS", "COGNITO_CLIENT_ID", "COGNITO_CLIENT_SECRET", "COGNITO_ISSUER"]
    : ["PLATFORM_OPERATORS", "PLATFORM_OPERATOR_SECRET"]
}

export interface ConfigFacts {
  mode: StudioAuthMode
  /** Every variable this mode needs. Names only. */
  required: readonly string[]
  /** Those that carry a non-blank value. Names only — never the values. */
  present: readonly string[]
  /** Those that do not. Names only. */
  absent: readonly string[]
  /** Whatever the real validators said. Their `detail` is authored text. */
  problems: readonly ConfigProblem[]
}

/**
 * Presence, and nothing else.
 *
 * `Boolean(String(value).trim())` is the whole reading. Length is not recorded,
 * a prefix is not recorded, and no value is copied into the result, because a
 * "the secret starts with `ci-`" hint on an unauthenticated page is a hint
 * about the secret.
 */
export function configFacts(
  mode: StudioAuthMode,
  problems: readonly ConfigProblem[],
  env: Record<string, string | undefined>,
): ConfigFacts {
  const required = requiredVariables(mode)
  const present = required.filter((name) => (env[name] ?? "").trim() !== "")
  const absent = required.filter((name) => !present.includes(name))
  return { mode, required, present, absent, problems }
}

/**
 * Which of the three configuration states this deployment is in, or null when
 * it is in none of them.
 *
 * The distinction is the point. Before this, all three rendered one panel
 * headed "Not configured", which is true of an untouched deployment and
 * misleading for the other two — an operator three variables into a four
 * variable setup was told the same thing as one who had set none, and an
 * operator whose issuer URL had a typo was told to "set" a variable that was
 * already set.
 *
 *   empty    nothing at all is present. This is a deployment nobody has
 *            configured, and the remedy is the whole list.
 *   partial  some are present. The remedy is the ones that are not, by name.
 *   error    all are present and a validator still objects. The remedy is a
 *            value, and only the validator's own sentence can say which.
 */
export type ConfigBlockKind = "empty" | "partial" | "error"

export interface ConfigBlock {
  kind: ConfigBlockKind
  /** Names still to set. Empty for `error`, where everything is set. */
  missing: readonly string[]
  problems: readonly ConfigProblem[]
}

export function configBlock(facts: ConfigFacts): ConfigBlock | null {
  if (facts.problems.length === 0) return null
  if (facts.present.length === 0) {
    return { kind: "empty", missing: facts.required, problems: facts.problems }
  }
  if (facts.absent.length > 0) {
    return { kind: "partial", missing: facts.absent, problems: facts.problems }
  }
  return { kind: "error", missing: [], problems: facts.problems }
}

/* ─────────────────────────────────────────────── the refusal, and its cousins ──
 *
 * `?error=` is attacker-controlled: anyone can type any value into it. So this
 * mapping is deliberately CLOSED — an unrecognised value is treated as an
 * ordinary refusal rather than passed through, because a page that renders what
 * the query string tells it to is a page that can be linked to a colleague
 * showing whatever sentence the linker chose.
 */

/** What the query string is allowed to say happened. */
export type Outcome = "refused" | "noPermission" | "stale" | null

/**
 * `1` is what this page's own action redirects with. `CredentialsSignin` is
 * next-auth's name for the same thing when the framework redirects instead.
 * `AccessDenied` is emitted only after a federated identity has already been
 * proven and the `signIn` callback then refused it — which is genuinely a
 * different sentence to write, because that person authenticated successfully
 * and is not staff. `SessionRequired` is next-auth's "you had a session and it
 * is gone".
 */
export function outcomeOf(errorParam: string | undefined | null): Outcome {
  const raw = (errorParam ?? "").trim()
  if (!raw) return null
  if (raw === "AccessDenied") return "noPermission"
  if (raw === "SessionRequired") return "stale"
  return "refused"
}

/* ───────────────────────────────────────────────────────── the whole answer ── */

/** Everything a rendered sign-in page needs to know, decided in one place. */
export interface SignInInput {
  mode: StudioAuthMode
  /** `process.env.NODE_ENV` of the running server. */
  nodeEnv: string | undefined
  facts: ConfigFacts
  /** The raw `?error=` value, exactly as it arrived. */
  errorParam: string | undefined | null
  /**
   * The email on the session cookie this browser presented, when that address
   * is NOT an operator. `null` when there is no session, and `null` when the
   * session is an operator's — that case never reaches this module, because the
   * page redirects an operator to the console before it asks anything else.
   */
  strandedSession: string | null
  /** Whether this client is currently locked out, and until when. */
  lock: { locked: boolean; retryAt: number | null; failures: number }
}

/**
 * The one state that replaces the form entirely.
 *
 * There is at most one, and the order below is the order of remedies: a
 * deployment that is not configured cannot be signed into no matter who is
 * knocking, so it outranks a lockout, which outranks nothing.
 */
export type BlockingState =
  | { kind: "empty" | "partial" | "error"; config: ConfigBlock }
  | { kind: "retrying"; retryAt: number | null; failures: number }

/** The states that sit ABOVE the form and leave it usable. */
export type NoticeKind = "refused" | "noPermission" | "stale" | "conflict" | "degraded"

export interface Notice {
  kind: NoticeKind
  /**
   * Whether a screen reader should be interrupted for it. Only the two that
   * describe something that just happened to this person: a refusal, and a
   * session that ended under them. `degraded` and `conflict` are conditions,
   * not events, and interrupting for a condition on every page load is how
   * people learn to ignore the live region.
   */
  assertive: boolean
}

export interface SignInView {
  blocking: BlockingState | null
  notices: readonly Notice[]
  /** Which sign-in path the form offers when there is no blocking state. */
  path: "credentials" | "federated"
}

export function signInView(input: SignInInput): SignInView {
  const config = configBlock(input.facts)
  const outcome = outcomeOf(input.errorParam)

  const blocking: BlockingState | null = config
    ? { kind: config.kind, config }
    : input.lock.locked
      ? { kind: "retrying", retryAt: input.lock.retryAt, failures: input.lock.failures }
      : null

  const notices: Notice[] = []
  /*
   * A refusal is suppressed while a blocking state is shown, and that is not
   * tidiness. "Those credentials were not accepted" beside "PLATFORM_OPERATORS
   * is not set" tells an operator their password was wrong when in fact nothing
   * could have been right — the single most expensive minute this page can cost
   * anyone. When the form is gone, the reason the form is gone is the message.
   */
  if (!blocking && outcome === "refused") notices.push({ kind: "refused", assertive: true })
  if (outcome === "noPermission") notices.push({ kind: "noPermission", assertive: true })
  if (outcome === "stale") notices.push({ kind: "stale", assertive: true })
  if (input.strandedSession) notices.push({ kind: "conflict", assertive: false })
  if (isDegraded(input.mode, input.nodeEnv)) notices.push({ kind: "degraded", assertive: false })

  return {
    blocking,
    notices,
    path: input.mode === "cognito" ? "federated" : "credentials",
  }
}

/**
 * A production build authenticating by shared secret.
 *
 * `lib/auth.ts` says it in as many words — credentials mode is "retained only
 * as an explicit local/CI harness" — and `auth-config.ts` defaults production
 * to Cognito for the same reason. A shared secret has no per-person identity,
 * no revocation short of rotating it for everybody, and no MFA. When a
 * production image is nonetheless running on it, the sign-in page is the one
 * place every operator will see, so it says so there rather than in a log
 * nobody reads.
 *
 * It is a NOTICE and not a refusal: refusing to authenticate would take the
 * console away from the people who need it, over a condition they cannot fix
 * from the sign-in page.
 */
export function isDegraded(mode: StudioAuthMode, nodeEnv: string | undefined): boolean {
  return mode === "credentials" && nodeEnv === "production"
}

/**
 * How long a rendered sign-in form is trusted before it calls itself stale.
 *
 * Thirty minutes. Long enough that nobody signing in is ever interrupted by it,
 * short enough that a tab left open over lunch is reloaded rather than posting
 * into a build that has since been replaced.
 */
export const STALE_AFTER_MS = 30 * 60_000

/**
 * Is this the exception Next throws to perform a redirect?
 *
 * The marker is on `digest`, and this predicate exists because of what happened
 * when it was read off `message` instead: `signIn` signals SUCCESS by throwing
 * a redirect, the check never matched, the redirect was swallowed, and a
 * correct email and secret were answered with "Those credentials were not
 * accepted". Written here, as a pure function over an object shape, so it is
 * exercised by a test rather than only by the one path in production that
 * notices when it is wrong.
 */
export function isRedirectError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const digest = (err as { digest?: unknown }).digest
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")
}
