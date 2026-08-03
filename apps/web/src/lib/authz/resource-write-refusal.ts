import type { Decision } from "@tenure/authorization"

/**
 * GE-051-005 — turning a decision about the board into something to read.
 *
 * Its own function because the mapping is the part worth testing, and the
 * function it came out of also does a database lookup — which would have made
 * every assertion about the wording an integration test.
 *
 * Two refusals, deliberately not one. "Only the Office of Student Engagement
 * can publish board resources" is a good message when the answer is *wrong
 * role*: it names the office rather than the permission, which is what the
 * reader can act on. It is a bad message when the resource module is switched
 * off, because then it blames the reader for something no role would fix. The
 * previous check could not tell those apart — it only knew a boolean.
 */
export function resourceWriteRefusal(
  decision: Pick<Decision, "allowed" | "reason" | "detail">,
  staffOffice: string,
  verb: string,
): string | null {
  if (decision.allowed) return null
  if (decision.reason === "MODULE_NOT_ENABLED") return decision.detail
  return `Only ${staffOffice} can ${verb} board resources.`
}
