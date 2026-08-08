/**
 * PAY-020-006 — a secret recognised by its VALUE, not by the key it sits under.
 *
 * `redactMetadata` redacts by key name, which is the right first line and is
 * blind to the case that actually happens: a provider's webhook body copied
 * wholesale into `metadata`, or an operator pasting a live key into a `note`
 * field. The key is `note`, so a key-name rule sees nothing; the value is
 * `sk_live_…`, so a value rule sees it immediately.
 *
 * ── Why prefixes and not entropy ────────────────────────────────────────────
 *
 * An entropy heuristic redacts cuids, hashes and base64 attachments — every
 * identifier an audit row exists to carry — and the audit trail stops being
 * readable. Every pattern below is a credential format whose issuer publishes
 * the prefix, so a match is a fact rather than a guess. The cost of a miss is a
 * secret in an append-only table that `ON DELETE RESTRICT` makes impossible to
 * remove; the cost of a false positive is an unreadable field, so the rule is
 * tuned to be certain rather than exhaustive.
 *
 * Callers, deliberately different in what they do with the answer:
 *   - `packages/audit/src/record.ts` REDACTS, because an audit row that loses a
 *     field is still evidence and a refused write is not.
 *   - `apps/web/src/lib/outbox/outbox.ts` REFUSES, because an outbox row is
 *     written inside a business transaction and will later be handed to a
 *     dispatcher that logs it — redacting there would silently corrupt the
 *     event a consumer is about to act on.
 *   - `apps/web/src/lib/ai.ts` REFUSES the prompt, because that is the one
 *     request that leaves the account (WRK-040-005). A redacted prompt would
 *     ask the model a question with a hole in it and return an answer built on
 *     it, and nobody downstream could tell.
 *   - `packages/configuration/src/publication.ts` REFUSES the publish, because
 *     a `sk_live_…` in a ConfigValue is resolved into every snapshot the
 *     application reads and cannot be un-published from the revision history.
 *   - `apps/web/src/lib/commands/bus.ts` and `ai.ts` REDACT their log lines,
 *     through `safeLogText` below — a log is evidence of a failure, and losing
 *     the whole line to protect one substring loses the incident with it, so
 *     the replacement says what happened.
 */

export interface SecretMatch {
  /** Dotted path to the offending value, e.g. `body.data.object.secret`. */
  path: string
  /** Which credential format matched, for a message that says what to fix. */
  kind: string
}

/**
 * Credential formats, by the prefix their issuer publishes.
 *
 * `whsec_` is first because it is the one this repository will meet most: it is
 * the signing secret on every payment-provider webhook, and a webhook body
 * echoed into a log is the single likeliest way one leaves the process.
 */
const PATTERNS: readonly { kind: string; re: RegExp }[] = [
  { kind: "webhook signing secret", re: /\bwhsec_[A-Za-z0-9]{8,}/ },
  { kind: "provider secret key", re: /\b[sr]k_(live|test)_[A-Za-z0-9]{8,}/ },
  { kind: "provider client secret", re: /\b(pi|seti|cs)_[A-Za-z0-9]{8,}_secret_[A-Za-z0-9]{8,}/ },
  { kind: "AWS access key id", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { kind: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { kind: "private key", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  // A JWT is three base64url segments; the first decodes to a JSON header, so
  // the `eyJ` prefix is structural rather than a guess about randomness.
  { kind: "bearer JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
]

/** The credential format a single string carries, or null. */
export function secretKindOf(value: string): string | null {
  for (const { kind, re } of PATTERNS) {
    if (re.test(value)) return kind
  }
  return null
}

const MAX_DEPTH = 8

/**
 * Every secret-looking value inside a structure, with the path that reaches it.
 *
 * Depth-bounded for the same reason `redactMetadata` is: the input comes from
 * callers, and a cyclic or pathologically deep object must not take out the
 * write that records what somebody just did.
 */
export function findSecretValues(value: unknown, basePath = ""): SecretMatch[] {
  const found: SecretMatch[] = []

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > MAX_DEPTH) return
    if (typeof node === "string") {
      const kind = secretKindOf(node)
      if (kind) found.push({ path: path || "(root)", kind })
      return
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1))
      return
    }
    if (node === null || typeof node !== "object") return
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, path ? `${path}.${k}` : k, depth + 1)
    }
  }

  walk(value, basePath, 0)
  return found
}

/** True when anything inside `value` matches a credential format. */
export function containsSecretValue(value: unknown): boolean {
  return findSecretValues(value).length > 0
}

/**
 * The same structure with every secret-looking string replaced.
 *
 * The whole string goes, not just the matched substring: a value that carries a
 * key inside a longer sentence carries it in whatever the sentence's remaining
 * words describe, and half a leaked credential in an append-only row is still a
 * leaked credential worth rotating.
 */
export function redactSecretValues<T>(value: T, replacement: string): T {
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) return node
    if (typeof node === "string") return secretKindOf(node) ? replacement : node
    if (Array.isArray(node)) return node.map((v) => walk(v, depth + 1))
    if (node === null || typeof node !== "object") return node

    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v, depth + 1)
    return out
  }

  return walk(value, 0) as T
}

/**
 * WRK-040-005 — what replaces a log line that carried a credential.
 *
 * Says what happened rather than being blank. A log with a silently missing
 * message is an incident nobody can reconstruct; a log that says the message
 * was withheld, and why, is one somebody can act on — starting with rotating
 * the key that got there.
 */
export const REDACTED_LOG_VALUE = "[redacted: this text carried a reusable credential]"

/**
 * An arbitrary thrown value or response body, safe to hand to `console.error`.
 *
 * The log sink named by WRK-040-005, and the reason it needs its own function:
 * `redactSecretValues` walks OBJECTS, and an `Error`'s `message` and `stack` are
 * not own enumerable properties, so passing one straight through returns `{}` —
 * a redactor that appears to work and in fact discards the entire error. The
 * flattening has to happen first, and it has to happen in one place rather than
 * at each `console.error`, or the next call site does it slightly differently.
 *
 * `${name}: ${message}` and not the stack: a stack names file paths in the
 * container and adds nothing a correlation id does not already give.
 */
export function safeLogText(value: unknown): string {
  const text =
    value instanceof Error
      ? `${value.name}: ${value.message}`
      : typeof value === "string"
        ? value
        : (() => {
            try {
              return JSON.stringify(value) ?? String(value)
            } catch {
              // Cyclic, or a getter that throws. The failure to serialise must
              // not become the failure to log that something went wrong.
              return String(value)
            }
          })()

  return redactSecretValues(text, REDACTED_LOG_VALUE)
}
