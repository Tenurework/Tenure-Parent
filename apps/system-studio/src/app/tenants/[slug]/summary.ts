/**
 * The derivations behind one tenant's page, with no React and no AWS client in
 * them.
 *
 * ── Why these are here rather than inline in `page.tsx` ────────────────────
 *
 * `page.tsx` is an async server component. Nothing can render it without a
 * DynamoDB table, an operator session and an estate, so every rule inside it is
 * a rule only an end-to-end run can reach — and the rules that matter most here
 * are the ones about what happens when those things are ABSENT. A function that
 * decides how to word "the audit ledger could not be read" cannot have its four
 * wordings proven by a page that needs a working ledger to render at all.
 *
 * So the decisions live here, take their inputs as arguments, and are driven
 * directly by `e2e/tenant-page-logic.spec.ts`. `page.tsx` is the only
 * production caller of every export in this file.
 *
 * There is deliberately no `server-only` import and no `@/lib/*` import that
 * pulls one: this module must be importable by a spec that has no AWS
 * credentials, which is the same rule the repository already applies to
 * `lib/fleet-filter.ts` and `lib/config-sort-key.ts`.
 */

import type { TenantState } from "@tenure/provisioning"

/*
 * Relative, not `@/lib/…`, and that is load-bearing rather than a style choice.
 * `e2e/tenant-page-logic.spec.ts` imports this module directly, and Playwright's
 * TypeScript loader resolves relative specifiers without a `baseUrl` while the
 * `@/*` alias in `tsconfig.json` has none to resolve against. An alias here
 * would make the whole logic spec unrunnable, which is the one thing this file
 * exists to keep possible.
 */
import { explainAttention, type TenantHealth } from "../../../lib/fleet-health"

/* ─────────────────────────────────────────────── a reading, or the reason ── */

/**
 * Something the console could not read, and what would fix it.
 *
 * Both fields are required. A panel that says "unknown" and stops is a panel
 * that turns into a support ticket; the whole value of admitting ignorance is
 * that the admission carries the next action. `fix` is an instruction — an
 * environment variable to set, an IAM action to grant — never a restatement of
 * `because`.
 */
export interface Unreadable {
  because: string
  fix: string
}

/**
 * A fact, or the reason there isn't one.
 *
 * Deliberately NOT `T | null`. A null is indistinguishable from "there is
 * genuinely nothing", and those two are the pair of facts this whole console
 * exists to keep apart — `lib/aws/read.ts` makes the same argument at the AWS
 * boundary and this is the same union one level up, for the readings that are
 * not AWS calls (the cell registry, the audit ledger).
 */
export type Reading<T> = { known: true; value: T } | ({ known: false } & Unreadable)

/** Every AWS action this module can be asked to explain a denial of. */
const DENIAL_FIX: Readonly<Record<string, string>> = {
  "dynamodb:Query":
    "Grant this engine's task role dynamodb:Query on the tenant registry table named by TENANT_TABLE.",
  "sts:GetCallerIdentity":
    "Grant this engine's task role sts:GetCallerIdentity, or set AWS_ACCOUNT_ID, AWS_REGION and AWS_PARTITION.",
}

/**
 * The name AWS put on an error, without assuming there is one.
 *
 * `name` rather than `code`: the v3 SDK sets `name` to the modelled error shape
 * (`AccessDeniedException`, `ThrottlingException`) and leaves `code` unset on
 * most clients. Reading `code` is why a denial reads as a generic failure.
 */
function errorName(error: unknown): string {
  const named = error as { name?: unknown } | null
  return typeof named?.name === "string" ? named.name : ""
}

/** The message, trimmed to something that fits in a panel and cannot carry a payload. */
function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, " ").trim().slice(0, 240) || "no message"
}

/**
 * Why a read did not answer, worded for the thing that actually went wrong.
 *
 * Five arms, and they must not collapse into one. A refusal is an IAM statement,
 * a throttle is a retry, a misconfigured estate is three environment variables,
 * an unavailable ledger is a table that does not exist, and an unrecognised
 * failure is a message an operator has to read. Sending an operator to fix an
 * IAM policy that was never wrong is the specific waste this exists to prevent —
 * and a single "could not be read" message is how every console arrives there.
 *
 * `action` is the AWS action the caller was making, so a denial can quote the
 * one to grant rather than the surface's friendly name.
 */
export function unreadable(error: unknown, what: string, action: string): Unreadable {
  const name = errorName(error)

  if (name === "FleetMisconfigured") {
    return {
      because:
        `${what} could not be read: this process cannot say which AWS estate it is in. ` +
        safeMessage(error),
      fix:
        "Set AWS_REGION, AWS_ACCOUNT_ID and AWS_PARTITION on this console, or grant its task " +
        "role sts:GetCallerIdentity so it can answer for itself. It will not invent an estate.",
    }
  }

  if (name === "AccessDeniedException" || name === "AccessDenied" || name === "UnauthorizedException") {
    return {
      because: `${what} was refused: AWS answered ${name} to ${action}.`,
      fix:
        DENIAL_FIX[action] ??
        `Grant this engine's task role ${action}. This is a refusal, not an absence — nothing is known about ${what} until it is granted.`,
    }
  }

  if (name === "ThrottlingException" || name === "ProvisionedThroughputExceededException") {
    return {
      because: `${what} was rate-limited: AWS answered ${name} to ${action} and asked this console to back off.`,
      fix: "Nothing is wrong with the role or the table. Reload in a few seconds.",
    }
  }

  if (name === "AuditUnavailable" || name === "ResourceNotFoundException") {
    return {
      because: `${what} could not be read. ${safeMessage(error)}`,
      fix:
        "Check that TENANT_TABLE names a table that exists in this region, and that this engine's " +
        `task role holds ${action} on it.`,
    }
  }

  return {
    because: `${what} could not be read: ${name || "an unrecognised failure"}. ${safeMessage(error)}`,
    fix: `Read this console's logs for the ${action} call. Nothing about ${what} is known until it succeeds.`,
  }
}

/**
 * Run a synchronous read and keep the reason when it throws.
 *
 * The reader is a parameter rather than an import so that the refusal paths are
 * reachable from a test without breaking an AWS client. `page.tsx` passes
 * `fleet` — the real one — so what a spec drives is the real branch.
 */
export function reading<T>(read: () => T, what: string, action: string): Reading<T> {
  try {
    return { known: true, value: read() }
  } catch (error) {
    return { known: false, ...unreadable(error, what, action) }
  }
}

/** The same, awaited. */
export async function readingAsync<T>(
  read: () => Promise<T>,
  what: string,
  action: string,
): Promise<Reading<T>> {
  try {
    return { known: true, value: await read() }
  } catch (error) {
    return { known: false, ...unreadable(error, what, action) }
  }
}

/* ────────────────────────────────────────────────────────── stated as-of ── */

/**
 * The sentence a panel ends with.
 *
 * Every panel on this page says when what it shows was true. A panel with no
 * as-of is a set of claims that were correct at some point, and an operator
 * cannot tell it from one that stopped refreshing — which is the difference
 * between an outage and a stale tab.
 *
 * `null` is spelled out rather than rendered as an empty string, because "we do
 * not know when this was read" is itself a finding.
 */
export function asOf(at: Date | string | null): string {
  if (at === null) return "As of an unknown time — nothing recorded when this was read."
  const stamp = typeof at === "string" ? at : at.toISOString()
  return `As of ${stamp}.`
}

/** A panel's supporting line: what it is, then when it was true. */
export function statedAsOf(what: string, at: Date | string | null): string {
  const trimmed = what.trim()
  const sentence = trimmed.endsWith(".") ? trimmed : `${trimmed}.`
  return `${sentence} ${asOf(at)}`
}

/* ─────────────────────────────────────────────────────── the lead answer ── */

/** The tone vocabulary `components/md3/Badge.tsx` accepts, narrowed to what a verdict uses. */
export type VerdictTone = "neutral" | "info" | "ok" | "warn" | "bad"

/**
 * The one thing an operator opened this page to learn.
 *
 * It is derived from `healthOf` — the same function `/tenants` ranks the fleet
 * with — rather than from a second reading of the lifecycle row, so the badge on
 * the fleet listing and the answer at the top of this page cannot disagree. That
 * was the actual failure this replaces: the tenant page led with the lifecycle
 * state, which says ACTIVE for the whole duration of an expired certificate.
 */
export interface LeadAnswer {
  /** The word in the badge. Never the only carrier of the meaning (Bible §26.3.2). */
  verdict: string
  tone: VerdictTone
  /** One sentence, in the operator's language, saying what is true right now. */
  headline: string
  /** The detail behind the verdict, or null when the verdict says everything. */
  because: string | null
}

/**
 * The order matters and is the same order `fleet-health.ts` ranks by: a failure
 * has already happened, a broken dependency is happening now, a stall might
 * still resolve, and "nobody is watching" ranks below every fact and above a
 * bookkeeping discrepancy.
 */
export function leadAnswer(input: {
  health: TenantHealth
  serving: boolean
  state: TenantState
}): LeadAnswer {
  const because = explainAttention(input.health)

  switch (input.health.attention) {
    case "failed":
      return {
        verdict: "Failed",
        tone: "bad",
        headline: "Provisioning failed. This tenant is not serving and nothing has moved it since.",
        because,
      }
    case "dependency-failing":
      return {
        verdict: "Dependency failing",
        tone: "bad",
        headline:
          "Something this tenant depends on was observed to be broken. The lifecycle row will not say so.",
        because,
      }
    case "stalled":
      return {
        verdict: "Stalled",
        tone: "warn",
        headline: `It has been in ${input.state} longer than that state should take.`,
        because,
      }
    case "never-deployed":
      return {
        verdict: "Never deployed",
        tone: "warn",
        headline: `It is in ${input.state} and no signed artifact has ever been published for it.`,
        because,
      }
    case "unobserved":
      return {
        verdict: "Unobserved",
        tone: "warn",
        headline:
          "It is supposed to be serving and not one source could say anything definite about it.",
        because,
      }
    case "config-behind":
      return {
        verdict: "Configuration behind",
        tone: "warn",
        headline:
          "The registry and the configuration store disagree about which revision is live, so the console is showing one and the cell is running the other.",
        because,
      }
    default:
      break
  }

  if (input.serving) {
    return {
      verdict: "Serving",
      tone: "ok",
      headline: "It is serving, and nothing observed of it needs an operator.",
      because: null,
    }
  }

  if (input.health.signals.includes("terminal")) {
    return {
      verdict: "Terminal",
      tone: "neutral",
      headline: `${input.state} is the end of the lifecycle graph. There is no move out of it.`,
      because: null,
    }
  }

  return {
    verdict: "Not serving",
    tone: "neutral",
    headline: `It is in ${input.state} and is not routing for anybody. Nothing observed of it needs an operator.`,
    because: null,
  }
}

/* ─────────────────────────────────────────────── what the estate answered ── */

/**
 * How many of a tenant's observation sources answered with a fact.
 *
 * Rendered as "3 of 5 sources answered" rather than as a health colour, because
 * the count is the thing an operator argues with. `unknown` is never folded into
 * `ok`: STUDIO-000-007 is about exactly that fold.
 */
export function answeredOf(
  observations: readonly { status: string }[],
): { answered: number; total: number; unobserved: readonly string[] } {
  const unobserved = observations
    .filter((o) => o.status === "unknown")
    .map((o) => (o as { source?: string }).source ?? "an unnamed source")
  return {
    answered: observations.filter((o) => o.status !== "unknown").length,
    total: observations.length,
    unobserved,
  }
}

/**
 * The tone of an observation's status pill.
 *
 * `unknown` is `warn` and never `neutral`: a source nobody could read is a
 * finding, and the quietest tone on the ramp is how a page of unreadable
 * sources comes to look like a page of uninteresting ones. It is never `ok`
 * for the reason `fleet-health.ts` states at length — STUDIO-000-007.
 *
 * The tone is decoration. `Badge` requires its text, and the status word is
 * what carries the meaning (Bible §26.3.2); this only decides which of five
 * desaturated containers it sits in.
 */
export function observationTone(status: string): VerdictTone {
  if (status === "ok") return "ok"
  if (status === "failing") return "bad"
  if (status === "degraded" || status === "unknown") return "warn"
  return "neutral"
}

/**
 * The tone of one audit row's outcome code.
 *
 * An intent with no outcome yet is `neutral` rather than `ok`: somebody started
 * this and nothing has recorded how it ended, which is the row an incident
 * review is actually about and is not a success.
 *
 * The positive codes are listed rather than inferred from a prefix. `outcomeOf`
 * in `lib/audit-ledger.ts` decides ALLOW/DENY from the same four words, and a
 * prefix rule here would silently disagree with it the first time a code is
 * added — the point of writing them out is that adding one makes this wrong
 * VISIBLY, in a list, rather than quietly, in a regex.
 */
const ALLOWED_OUTCOMES: ReadonlySet<string> = new Set(["APPLIED", "ALLOWED", "SUCCEEDED", "OK"])

export function outcomeTone(code: string | null): VerdictTone {
  if (code === null) return "neutral"
  return ALLOWED_OUTCOMES.has(code) ? "ok" : "bad"
}

/**
 * Money, or the fact that it is free.
 *
 * `$0.00/month` and "nothing extra" are read differently by the person deciding
 * whether to leave a tenant hibernated, and only the second is true of a pooled
 * tenant that adds no dedicated resource.
 */
export function marginalCost(cents: number): string {
  return cents === 0 ? "$0 marginal" : `$${(cents / 100).toFixed(2)}/month`
}
