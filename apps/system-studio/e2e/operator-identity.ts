/**
 * Reading an operator address out of `PLATFORM_OPERATORS`.
 *
 * The variable's grammar is `email:role` per entry (STUDIO-020-005), so a spec
 * that fills `process.env.PLATFORM_OPERATORS` straight into the Email field
 * types an address, a colon, a role and possibly four more entries — and the
 * sign-in refuses, correctly, for a reason that has nothing to do with what the
 * spec is testing.
 *
 * `operatorFor()` returns the first entry's address, which is what every spec
 * that just needs "an operator" wants. `operatorFor(role)` returns the address
 * of a particular family, which is what the role-separation specs need.
 *
 * Deliberately not exported from `src/`: this parses an environment variable
 * for a test harness, and the production parser refuses malformed entries with
 * problems attached. Two parsers, two jobs.
 */
export function operatorFor(role?: string): string {
  const entries = (process.env.PLATFORM_OPERATORS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)

  for (const entry of entries) {
    const parts = entry.split(":")
    if (parts.length !== 2) continue
    const email = parts[0].trim()
    const entryRole = parts[1].trim()
    if (!email || !entryRole) continue
    if (role === undefined || entryRole === role) return email
  }
  return ""
}
