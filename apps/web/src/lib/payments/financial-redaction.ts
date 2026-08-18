import {
  redactFinancialIdentifiers,
  redactFinancialIdentifiersDeep,
  type RedactionFinding,
  type RedactionResult,
} from "@tenure/payments"

import { currentScope } from "@/lib/tenancy/context"

/**
 * PAY-180-004 — the financial identifiers leaving this process, on the three
 * paths they leave by.
 *
 * `@tenure/payments`' `financial-identifiers.ts` decides WHAT a financial
 * identifier is and how much of one a purpose may see. This is the adapter that
 * supplies it the two facts it cannot know from inside a package: which tenant
 * is in scope, and whether this deployment holds a tokenization key.
 *
 * ── Redact, not refuse, and why that is the opposite answer to a credential ──
 *
 * `ai.ts` REFUSES a prompt carrying a credential, and that is right: a
 * `whsec_…` in a prompt is a leak with no upside, and the answer the model
 * would have given is not worth the rotation. A card number is different. It
 * arrives in the ordinary course of the product — a treasurer pastes a receipt,
 * a reimbursement note quotes the last line of a statement — and refusing every
 * question whose sources happen to contain one would take the assistant away
 * from exactly the people asking about money. So the identifier is removed and
 * a TOKEN is left in its place: the model can still reason about "the same
 * card" appearing twice, and the value itself never crosses the boundary.
 *
 * ── The key, and what happens without one ───────────────────────────────────
 *
 * `PAYMENTS_TOKENIZATION_KEY` is read here and nowhere else. A deployment
 * without one still redacts — the identifier is masked and removed — but the
 * replacement SAYS it could not be tokenized rather than looking like a
 * successful tokenization. "We removed this and can tell you it is the same
 * card as the other one" and "we removed this" are different answers, and a
 * reader who cannot tell them apart will assume the first.
 *
 * It is deliberately not in `lib/env.ts`'s boot contract: absent is a supported
 * state (the pilot runs without it), and a boot-time schema entry for an
 * optional variable would suggest the opposite.
 */

/** The minimum a key must be before `tokenFor` will use it. */
export const TOKENIZATION_KEY_VAR = "PAYMENTS_TOKENIZATION_KEY"

/**
 * The configured tokenization key, or null.
 *
 * `env` is a parameter rather than a read of `process.env` inside, for the same
 * reason `borrowProviderCredential` takes one: a test describes a deployment
 * without mutating the process.
 */
export function tokenizationKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env[TOKENIZATION_KEY_VAR]
  return value && value.trim().length > 0 ? value : null
}

/**
 * The tenant a token is scoped to, or the empty string.
 *
 * Empty rather than a fallback: `tokenFor` refuses an empty tenant, which is
 * the correct outcome for text produced outside any tenant scope. A sentinel
 * like `"unknown"` would tokenize every unscoped value into one namespace
 * shared by every tenant, which is the join the scoping exists to prevent.
 */
function tenantInScope(): string {
  return currentScope()?.institutionId ?? ""
}

export interface ScrubOptions {
  /** Overrides the ambient scope. For callers that hold the tenant explicitly. */
  tenantId?: string
  env?: Record<string, string | undefined>
}

/**
 * Text on its way to the model vendor, scrubbed.
 *
 * `MODEL_PROMPT` is one of `PURPOSES_NO_GRANT_CAN_RAISE`, so there is no grant,
 * seat or configuration that makes this return an identifier in the clear. That
 * is a property of the package's table rather than of this function, which is
 * what stops a later caller here from passing a grant and widening it.
 */
export function scrubForModel(text: string, options: ScrubOptions = {}): RedactionResult {
  return redactFinancialIdentifiers(text, {
    purpose: "MODEL_PROMPT",
    tenantId: options.tenantId ?? tenantInScope(),
    key: tokenizationKey(options.env),
  })
}

/**
 * A log line or a trace attribute, scrubbed.
 *
 * Separate from `scrubForModel` because the purposes are separate: a log goes
 * to an aggregator several teams read, a prompt goes to a third party, and one
 * day one of those two will be allowed something the other is not.
 */
export function scrubForLog(text: string, options: ScrubOptions = {}): RedactionResult {
  return redactFinancialIdentifiers(text, {
    purpose: "LOG_OR_TRACE",
    tenantId: options.tenantId ?? tenantInScope(),
    key: tokenizationKey(options.env),
  })
}

/**
 * A value on its way into the append-only audit trail.
 *
 * The tenant is a PARAMETER here, not the ambient scope: `recordAuditEvent` is
 * called from the provisioning reconciler and from jobs that run before a scope
 * is open, and it always knows its `institutionId`. Taking it from the argument
 * means the token is correctly tenant-scoped on every one of those paths rather
 * than only the ones that happen to be inside a request.
 *
 * `AUDIT_EVIDENCE` is one of `PURPOSES_NO_GRANT_CAN_RAISE`: nothing may write a
 * financial identifier into a table this application cannot delete from.
 */
export function scrubForAudit<T>(value: T, tenantId: string, env?: ScrubOptions["env"]): T {
  return redactFinancialIdentifiersDeep(value, {
    purpose: "AUDIT_EVIDENCE",
    tenantId,
    key: tokenizationKey(env),
  })
}

/** The same treatment for a structured trace payload or an error object's fields. */
export function scrubStructuredForLog<T>(value: T, options: ScrubOptions = {}): T {
  return redactFinancialIdentifiersDeep(value, {
    purpose: "LOG_OR_TRACE",
    tenantId: options.tenantId ?? tenantInScope(),
    key: tokenizationKey(options.env),
  })
}

/**
 * What to write in a log line ABOUT a scrub, carrying no value.
 *
 * A count by kind, and the key state. Nothing here is derived from an
 * identifier, so the sentence that reports a redaction cannot itself be the
 * leak — which is the failure mode of every "we redacted: <the thing>" message
 * anybody has ever written.
 */
export function describeScrub(findings: readonly RedactionFinding[]): string {
  if (findings.length === 0) return "none"
  const counts = new Map<string, number>()
  for (const finding of findings) {
    counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1)
  }
  const untokenized = findings.filter((f) => f.token === null)
  const parts = [...counts.entries()].sort().map(([kind, count]) => `${count}×${kind}`)
  if (untokenized.length > 0) {
    const reasons = [...new Set(untokenized.map((f) => f.tokenRefusal))].join(", ")
    parts.push(`${untokenized.length} not tokenized (${reasons})`)
  }
  return parts.join(", ")
}
