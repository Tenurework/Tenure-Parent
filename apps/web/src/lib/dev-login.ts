import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Interim access gate in front of passwordless pilot sign-in.
 *
 * `dev-login` authenticates by looking an email up and returning the row — no
 * password. The sign-in page lists the seeded accounts as buttons, one of which
 * holds OSE_DIRECTOR. On a public URL that is one click from the highest role
 * in the system.
 *
 * Okta is the real fix and is not descoped by this. But its arrival date is set
 * by an institution's procurement, and the exposure should not be tied to that
 * schedule. A shared passphrase turns "know an email" into "know an email and a
 * secret", which is the difference between a public door and a pilot.
 *
 * Removing this when Okta lands is one step: drop AUTH_DEV_LOGIN, and the
 * provider it guards disappears with it. It deliberately adds no second
 * sign-in path of its own.
 */

export type DevLoginDecision =
  | { allowed: true }
  | { allowed: false; reason: "gate-not-configured" | "passphrase-missing" | "passphrase-wrong" }

/**
 * Compare without leaking, via the length of the comparison or its duration.
 * Digesting first makes both inputs 32 bytes, so unequal lengths do not
 * short-circuit and the passphrase's length is not observable.
 */
function secretsMatch(a: string, b: string): boolean {
  const digest = (v: string) => createHash("sha256").update(v, "utf8").digest()
  return timingSafeEqual(digest(a), digest(b))
}

export function checkDevLoginGate({
  provided,
  expected,
  isProduction,
}: {
  provided: string | undefined
  expected: string | undefined
  isProduction: boolean
}): DevLoginDecision {
  if (!expected) {
    // No passphrase configured. Outside production that is the normal case and
    // keeps local runs and CI frictionless. Inside production it means the gate
    // was not provisioned, and an ungated public sign-in is the thing this
    // exists to prevent — so refuse rather than fall through to open.
    //
    // src/lib/env.ts also refuses to boot in that state; this is the second
    // line, so a misconfiguration cannot be served even if the first is bypassed.
    return isProduction ? { allowed: false, reason: "gate-not-configured" } : { allowed: true }
  }

  if (!provided) return { allowed: false, reason: "passphrase-missing" }
  if (!secretsMatch(provided, expected)) return { allowed: false, reason: "passphrase-wrong" }

  return { allowed: true }
}
