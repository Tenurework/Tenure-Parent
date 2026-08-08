import { ROLE_TEMPLATES } from "@tenure/authorization"

/**
 * WRK-GATE-030 / WRK-110-005 — the shipped role templates that carry a
 * permission: "ask somebody who can grant this".
 *
 * Derived from `ROLE_TEMPLATES`, which is the same catalog `seat-world.ts:94`
 * hands the authorization engine, so the answer cannot name a role that does
 * not exist or miss one that was added.
 *
 * ## Why it lives here rather than in `relay-tools.ts`, where it was written
 *
 * Two surfaces need it and only one of them may import `relay-tools.ts`.
 * `invokeRelayTool` builds a `PERMISSION_NOT_HELD` remedy from it, and the
 * Connection Centre needs the same answer to say WHO can clear a
 * `NEEDS_ADMIN` — but `capability-resolution.ts` is reachable from a client
 * bundle (`components/connections/MissingConnectionCard.tsx` is `"use client"`)
 * and `relay-tools.ts` reaches `lib/relay/action-plan.ts`, which imports
 * `node:crypto`. Importing it from there would not degrade; it would fail the
 * build.
 *
 * So the rule moved into a module that holds nothing else and reaches nothing
 * but the catalog. `relay-tools.ts` re-exports it, so its own callers and its
 * own test are unchanged and there is still exactly ONE implementation — which
 * is the point: two answers to "who can grant this" is how a refusal comes to
 * name a role a person cannot find.
 */
export function rolesGranting(permission: string): readonly string[] {
  return ROLE_TEMPLATES.filter((t) => t.permissions.includes(permission)).map((t) => t.key)
}
