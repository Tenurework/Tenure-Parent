/**
 * STUDIO-080-003 — the escape hatch, built from the resolved estate rather than
 * from a habit.
 *
 * There was no console link anywhere in the Studio. That is not the safe state:
 * an operator who needs the console and has no link pastes an ARN into a search
 * box in whatever account their browser is already signed into, which is the
 * unsafe path this exists to replace.
 *
 * Two properties make it safe rather than convenient:
 *
 *   * **The host comes from the partition, and an unknown partition gets `null`.**
 *     `console.aws.amazon.com` is not where a GovCloud or a China resource
 *     lives, and a link that points at the commercial console for a `aws-us-gov`
 *     ARN is the GE-010-007 residency defect in miniature — it invites an
 *     operator to look for a resource in the wrong jurisdiction, decide it does
 *     not exist, and act on that. Returning `null` makes the surface say "no
 *     console link for partition X" instead.
 *   * **It is gated on a role, not on being an operator.** `isOperator` is one
 *     boolean for every role family; break-glass is not.
 *
 * And it says what it is: actions taken in the console happen outside this
 * engine's audit. That sentence is the honest form of "never depend on them for
 * normal operation" — it is the reason not to, stated where the link is.
 */

/** Console hosts, by partition. Nothing is derived by pattern; each is named. */
const CONSOLE_HOSTS: Readonly<Record<string, string>> = {
  aws: "console.aws.amazon.com",
  "aws-us-gov": "console.amazonaws-us-gov.com",
  "aws-cn": "console.amazonaws.cn",
}

export interface ConsoleTarget {
  /** The partition the resource is in, from its ARN or from the resolved identity. */
  partition: string
  /** The region the resource is in. */
  region: string
  /**
   * Which console page to open. A closed set, because a caller-supplied path
   * is an open redirect with extra steps.
   */
  service: "ecs" | "rds" | "cloudfront" | "acm" | "cloudwatch" | "securityhub" | "resource-groups"
}

/**
 * A console URL, or null when this partition has no console we can name.
 *
 * Null rather than a guess. Every caller renders "no console link for partition
 * X" for null, which is a true statement; a guessed URL is a false one.
 */
export function consoleLink(target: ConsoleTarget): string | null {
  const host = CONSOLE_HOSTS[target.partition]
  if (!host) return null
  if (!target.region) return null
  return `https://${target.region}.${host}/${target.service}/home?region=${encodeURIComponent(target.region)}`
}

/** Partitions this module can build a link for, for a surface to explain itself. */
export function linkablePartitions(): readonly string[] {
  return Object.keys(CONSOLE_HOSTS).sort()
}

/**
 * The sentence that must accompany every console link.
 *
 * Exported rather than written at each call site so it cannot be dropped from
 * one of them — a link without it is a link that looks like part of the product.
 */
export function consoleCaveat(accountId: string): string {
  return (
    `Read-only view of account ${accountId}. Actions taken here are outside Tenure's audit: ` +
    `nothing done in the AWS console appears in this engine's evidence, and no approval gate applies to it.`
  )
}
