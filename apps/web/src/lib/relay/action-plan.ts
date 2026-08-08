import { createHash, createHmac, timingSafeEqual } from "node:crypto"

/**
 * WRK-050-002 / WRK-GATE-050 — the plan a human confirmed, and the proof they did.
 *
 * Bible §7.3 is explicit and was, until this file, unimplemented in every
 * respect: *"The confirmation is bound to a digest of the exact plan. A changed
 * recipient, body, permission, attachment, target, or provider account
 * invalidates prior approval."* What stood in for that was a shape assertion in
 * `relay-tools.ts` — `typeof confirmationToken === "string" && length > 0` —
 * so the literal string `"y"` authorized any write, nothing minted a
 * confirmation, nothing bound one to a plan, and nothing expired one. A check
 * wearing the name of an authorization.
 *
 * ## What is bound, and why each field is in the digest
 *
 * An `ActionPlan` is not a description of an action; it is *the* action, in the
 * only form a person can be shown and a MAC can cover. Every argument the tool
 * will run with lands in exactly one field of it (`args` holds whatever the
 * projections below did not claim), so there is no argument a model can vary
 * between the moment a person says yes and the moment the tool runs. That is
 * the property being bought: not "a token was present" but "this exact thing
 * was approved".
 *
 * ## Why the refusal is typed rather than boolean
 *
 * `confirmationMatches` returns a reason. A token that expired, a token minted
 * for a different person, and a token minted for a plan whose recipient list has
 * since grown are three different things to tell somebody, and the third is a
 * security event while the first is a UI timeout. A boolean collapses all three
 * into "no", which is how a plan-substitution attack looks exactly like a slow
 * user.
 *
 * ## Callers
 *
 * `apps/web/src/lib/relay-tools.ts` — `planForInvocation` derives the plan from
 * the invocation's own resolved arguments (never from a plan the caller passed,
 * which would let a caller confirm one thing and run another) and
 * `verifyConfirmation` calls `confirmationMatches` from the `readOnly === false`
 * branch of `invokeRelayTool`, the single production door every proposal goes
 * through (`apps/web/src/app/api/ai/chat/route.ts`).
 *
 * ## Honest scope
 *
 * `issueConfirmation` has no production caller today and that is deliberate
 * rather than an oversight: minting is what a *person* does, and this platform
 * has no writing Relay surface yet — `/api/ai/chat` declares `read-only`, so its
 * writing branch is unreachable from a browser. The consequence is fail-closed
 * and is the right one: a writing surface added tomorrow cannot execute anything
 * until somebody wires a human confirmation step through `issueConfirmation`.
 * The verifying half is fully production-reached today.
 */

/** How long a confirmation is good for, unless a caller says otherwise. */
export const CONFIRMATION_TTL_MS = 5 * 60_000

/** The token format, so a future format can be rejected rather than misread. */
const TOKEN_VERSION = "tcf1"

/**
 * §7.3's plan, restricted to the facts this platform can actually answer today.
 *
 * `attachment` and `provider account` from the Bible's list are absent because
 * nothing in this application has either — a field that is always null reads
 * like provenance and is not. `args` is the catch-all and it is what stops the
 * named fields from being a partial cover: every resolved argument is in the
 * digest whether or not anybody thought to name it.
 */
export interface ActionPlan {
  /** Whose data. From the validated `TenantContext`, never from a proposal. */
  tenantId: string
  /** Who is acting. Same source, same reason. */
  actorId: string
  /** Which capability. */
  toolKey: string
  /** The thing acted on, when the arguments name one. */
  target: string | null
  /** Everybody this would reach outside the request. Set semantics; see below. */
  recipients: readonly string[]
  /** The text that would be written or sent. */
  body: string | null
  /** Whether executing tells somebody. */
  notifies: boolean
  /** Permissions this would grant or revoke. */
  permissionImpact: readonly string[]
  /** Every other argument the tool will run with, minus the confirmation itself. */
  args: Readonly<Record<string, unknown>>
}

/**
 * JSON with object keys sorted at every level, so two spellings of the same
 * plan produce the same bytes.
 *
 * The same discipline `apps/web/src/lib/provisioning/reconcile.ts` documents for
 * the deployment digest, and for the same reason: a plan that round-trips
 * through JSON, a queue or a form field comes back with its keys in whatever
 * order the transport felt like, and a digest that depended on that would refuse
 * its own confirmations.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`
}

/**
 * `sha256:…` over the whole plan.
 *
 * Every field is here, listed rather than spread, so removing one from the
 * cover is a visible edit in this function instead of a field quietly dropped
 * off an interface somewhere else. `recipients` is sorted and de-duplicated
 * because a recipient list is a set — sending to [a, b] and [b, a] is the same
 * disclosure — while ADDING one is a different plan, which is exactly what §7.3
 * says must invalidate a prior approval.
 */
export function planDigest(plan: ActionPlan): string {
  const body = {
    tenantId: plan.tenantId,
    actorId: plan.actorId,
    toolKey: plan.toolKey,
    target: plan.target,
    recipients: [...new Set(plan.recipients)].sort(),
    body: plan.body,
    notifies: plan.notifies,
    permissionImpact: [...new Set(plan.permissionImpact)].sort(),
    args: plan.args,
  }
  return `sha256:${createHash("sha256").update(canonical(body)).digest("hex")}`
}

const b64url = (buf: Buffer) => buf.toString("base64url")

/**
 * What the token carries, so a refusal can name which fact disagreed.
 *
 * `toolKey` is deliberately NOT here: it lives in the digest and nowhere else,
 * so a token minted for one tool and presented for another fails as
 * PLAN_CHANGED rather than passing because two copies of the same field
 * happened to agree. The tenant and the actor ARE duplicated, because
 * "somebody else's confirmation" and "a different plan" are worth telling
 * apart and a digest mismatch cannot say which it was.
 */
interface ConfirmationPayload {
  /** The plan digest this confirmation was given for. */
  d: string
  /** Tenant. */
  t: string
  /** Actor. */
  a: string
  /** Expiry, epoch milliseconds. */
  x: number
}

function sign(encoded: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(encoded).digest())
}

/**
 * Mint a confirmation for exactly this plan.
 *
 * Throws on an empty secret rather than signing with one: an HMAC under a blank
 * key is a token anybody can mint, which is the failure this whole file exists
 * to remove.
 */
export function issueConfirmation(
  plan: ActionPlan,
  secret: string,
  now: number,
  ttlMs: number = CONFIRMATION_TTL_MS,
): string {
  if (!secret) throw new Error("a confirmation cannot be signed without a secret")
  const payload: ConfirmationPayload = {
    d: planDigest(plan),
    t: plan.tenantId,
    a: plan.actorId,
    x: now + ttlMs,
  }
  const encoded = b64url(Buffer.from(canonical(payload), "utf8"))
  return `${TOKEN_VERSION}.${encoded}.${sign(encoded, secret)}`
}

/** Why a confirmation did not authorize this action. Never a bare `false`. */
export type ConfirmationRefusalReason =
  /** Not a token this platform issued: wrong shape, wrong version, bad signature. */
  | "MALFORMED"
  /** Issued for a different tenant. */
  | "WRONG_TENANT"
  /** Issued to a different person. */
  | "WRONG_ACTOR"
  /** Issued, valid, and too old. */
  | "EXPIRED"
  /** Issued for a plan that is not this plan. §7.3's whole subject. */
  | "PLAN_CHANGED"

export type ConfirmationVerdict =
  | { ok: true; digest: string; expiresAt: number }
  | { ok: false; reason: ConfirmationRefusalReason; detail: string }

/** The identity a confirmation must have been issued to. `TenantContext` satisfies it. */
export interface ConfirmingIdentity {
  tenantId: string
  actorId: string
}

/**
 * Whether this token authorizes this plan, for this person, right now.
 *
 * The signature is checked first and in constant time, so a caller cannot
 * distinguish "your token expired" from "your forged token is nearly right" by
 * timing, and so no unsigned field is ever read as if it were trustworthy.
 * Identity is checked against the CONTEXT rather than against the plan: the plan
 * is derived from the request too, so comparing it to itself would prove
 * nothing.
 */
export function confirmationMatches(
  token: unknown,
  plan: ActionPlan,
  context: ConfirmingIdentity,
  now: number,
  secret: string,
): ConfirmationVerdict {
  if (typeof token !== "string" || token.trim().length === 0) {
    return { ok: false, reason: "MALFORMED", detail: "no confirmation was presented" }
  }
  if (!secret) {
    // Fail closed. A process with no confirmation secret cannot verify one, and
    // treating "we cannot check" as "it checked out" is how an unsigned build
    // authorizes every write it is offered.
    return {
      ok: false,
      reason: "MALFORMED",
      detail: "no confirmation secret is configured, so no confirmation can be verified",
    }
  }

  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, reason: "MALFORMED", detail: "not a Tenure confirmation token" }
  }

  const [, encoded, mac] = parts
  const expected = sign(encoded, secret)
  const given = Buffer.from(mac, "base64url")
  const want = Buffer.from(expected, "base64url")
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: "MALFORMED", detail: "the confirmation's signature does not verify" }
  }

  let payload: ConfirmationPayload
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ConfirmationPayload
  } catch {
    return { ok: false, reason: "MALFORMED", detail: "the confirmation's payload is not readable" }
  }
  if (
    typeof payload?.d !== "string" ||
    typeof payload?.t !== "string" ||
    typeof payload?.a !== "string" ||
    typeof payload?.x !== "number"
  ) {
    return { ok: false, reason: "MALFORMED", detail: "the confirmation's payload is incomplete" }
  }

  if (payload.t !== context.tenantId) {
    return {
      ok: false,
      reason: "WRONG_TENANT",
      detail: "the confirmation was issued for a different institution",
    }
  }
  if (payload.a !== context.actorId) {
    return {
      ok: false,
      reason: "WRONG_ACTOR",
      detail: "the confirmation was issued to a different person",
    }
  }
  if (now > payload.x) {
    return {
      ok: false,
      reason: "EXPIRED",
      detail: `the confirmation expired at ${new Date(payload.x).toISOString()}`,
    }
  }

  const digest = planDigest(plan)
  if (payload.d !== digest) {
    return {
      ok: false,
      reason: "PLAN_CHANGED",
      detail: "the confirmation was given for a different plan than the one about to run",
    }
  }

  return { ok: true, digest, expiresAt: payload.x }
}

/**
 * The key confirmations are signed with.
 *
 * `RELAY_CONFIRMATION_SECRET` when the deployment separates it, and
 * `AUTH_SECRET` otherwise — the one secret `apps/web/src/lib/env.ts` already
 * requires of every process and refuses to start without in production, so
 * there is no new operational prerequisite and no silently-unsigned build. An
 * empty string is returned rather than thrown, because the refusal belongs at
 * the door where it becomes an answer somebody sees.
 */
export function confirmationSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.RELAY_CONFIRMATION_SECRET ?? env.AUTH_SECRET ?? ""
}
