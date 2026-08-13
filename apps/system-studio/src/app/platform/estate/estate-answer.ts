/**
 * The sentences `/platform/estate` leads with, derived from the reads rather
 * than written beside them.
 *
 * ── Why this is a module and not four ternaries in the page ────────────────
 *
 * Every function here answers a question an operator arrived with, and each of
 * them has an arm that must NOT be reachable by accident. The page it serves
 * used to print
 *
 *     Nothing to reconcile: every resource that was read is claimed by something.
 *
 * whenever the change diff was empty — including the case this console is in
 * with no credentials at all, where four of four AWS reads failed, nothing was
 * read, and the diff was empty *because there was no input*. That sentence is
 * true and reads as reassurance, which is the exact shape of the failure
 * `states.tsx` exists to prevent: an absence of an answer rendered as an answer
 * of "fine". `reconcileAnswer` below has a distinct arm for it, and
 * `e2e/estate-answer-logic.spec.ts` drives all four.
 *
 * Nothing here calls AWS, imports React, or imports anything at runtime — every
 * import is `import type`, so the Playwright logic spec can require this module
 * directly with no server, no browser and no credentials. That is deliberate:
 * a test that drove a copy of these rules would stay green the day the page
 * stopped using them.
 */

import type { BadgeTone } from "@/components/md3"
import type { EstateLine } from "@/lib/aws/inventory"
import type { ClauseVerdict, ManagementAccountVerdict } from "@/lib/aws/posture"
import type { TopologyVerdict } from "@/lib/aws/topology"

/* ------------------------------------------------------------- as-of ----- */

/**
 * The instant a reading describes, or null.
 *
 * Structural rather than `AwsRead<T>` because three of the seven arms carry no
 * `asOf` at all — `DENIED`, `UNCONFIGURED` and `ERROR` never completed, so
 * there is no instant they are true at. Null is that fact, and
 * `asOfSentence` is what turns it into something a person can read. Defaulting
 * to "now" would date a panel to the moment its call FAILED.
 *
 * `state` is required in the parameter and unused in the body, deliberately. A
 * parameter whose every property is optional is a WEAK TYPE: `tsc` accepts any
 * object with no overlapping property, so `readAsOf(someUnrelatedThing)`
 * compiles and returns null forever. Requiring the one field every `AwsRead`
 * arm carries is what makes passing the wrong object a compile error — and it
 * is not hypothetical, `tsc` rejected `AwsRead<Identity>` against the weak
 * version of this signature at all three call sites in this route.
 */
export function readAsOf(read: { readonly state: string; readonly asOf?: string }): string | null {
  const asOf = read.asOf
  return typeof asOf === "string" && asOf.trim() !== "" ? asOf : null
}

/**
 * What a panel is AS OF, in words — including when it is as of nothing.
 *
 * Required by the console's own structure rule: a panel that does not say when
 * it was true is a panel a reader has to assume is live, and the assumption is
 * wrong exactly when it matters.
 */
export function asOfSentence(what: string, asOf: string | null): string {
  return asOf === null
    ? `${what}. The call did not complete, so this panel has no as-of and is not a snapshot of anything.`
    : `${what}, as of ${asOf}.`
}

/* ------------------------------------------------------- the surfaces ---- */

/**
 * What one AWS surface answered with.
 *
 * Four values and not three. `STALE` is separated from `ANSWERED` because
 * `estateLines` narrows its `resources` to the `ACTUAL` arm — a stale reading
 * carries a value the page does not render, so counting its rows would report
 * "0 databases" for a surface that holds some. It is separated from `UNREAD`
 * because a held reading is not a refusal and has a different remedy.
 */
export type SurfaceAnswer = "ANSWERED" | "EMPTY" | "STALE" | "UNREAD"

export interface SurfaceRow {
  surface: string
  answer: SurfaceAnswer
  /** How many resources this surface reported, or null when that is not known. */
  count: number | null
  /** `estateLines`'s own sentence. One funnel, so DENIED cannot be worded as absence. */
  said: string
  asOf: string | null
}

export function surfaceRows(lines: readonly EstateLine[]): readonly SurfaceRow[] {
  return lines.map((line): SurfaceRow => {
    const answer: SurfaceAnswer =
      line.read.state === "ACTUAL"
        ? "ANSWERED"
        : line.read.state === "EMPTY"
          ? "EMPTY"
          : line.read.state === "STALE"
            ? "STALE"
            : "UNREAD"
    return {
      surface: line.surface,
      answer,
      // Only the two arms whose rows the page actually renders carry a number.
      // A count taken from a reading the surface does not draw is a number that
      // disagrees with the table beneath it.
      count: answer === "ANSWERED" || answer === "EMPTY" ? line.resources.length : null,
      said: line.text,
      asOf: readAsOf(line.read),
    }
  })
}

/** Surfaces whose current contents this console does not know. */
export function unknownSurfaces(rows: readonly SurfaceRow[]): readonly SurfaceRow[] {
  return rows.filter((row) => row.count === null)
}

export function resourcesRead(rows: readonly SurfaceRow[]): number {
  return rows.reduce((total, row) => total + (row.count ?? 0), 0)
}

/* --------------------------------------------------------- the answer ---- */

/**
 * The one sentence this page exists to say, above every panel.
 *
 * Two halves, because an operator opening this route arrives with two questions
 * and the second is worthless without the first: WHICH account is this, and
 * WHAT is running in it. Both halves have an arm for not knowing, and neither
 * of those arms is allowed to read like a small caveat on an otherwise complete
 * answer — a partial inventory says the estate is *at least* this large.
 */
export function estateAnswer(input: {
  accountId: string | null
  region: string | null
  rows: readonly SurfaceRow[]
}): string {
  const where =
    input.accountId === null
      ? "This console could not resolve which AWS account it is running in, so nothing below is attributed to one."
      : `This is account ${input.accountId} in ${input.region ?? "a region this console could not resolve"}.`

  const rows = input.rows
  if (rows.length === 0) {
    return `${where} This build inventories no AWS surface at all, so there is nothing here to be right or wrong about.`
  }

  const unknown = unknownSurfaces(rows)
  const total = resourcesRead(rows)

  if (unknown.length === rows.length) {
    return (
      `${where} None of the ${rows.length} surfaces this console inventories could be read, so what is ` +
      `running here is not known. This page is short because the reads failed, not because the account is empty.`
    )
  }

  if (unknown.length > 0) {
    return (
      `${where} ${total} resource(s) across ${rows.length - unknown.length} of ${rows.length} surfaces. ` +
      `${unknown.map((row) => row.surface).join(", ")} could not be read, so the estate is at least this ` +
      `large and may be larger.`
    )
  }

  if (total === 0) {
    return (
      `${where} All ${rows.length} surfaces answered and none of them holds a resource. This account is ` +
      `empty — a read result, not a refusal.`
    )
  }

  return `${where} ${total} resource(s) are running across ${rows.length} surfaces, and every surface answered.`
}

/* ----------------------------------------------------- the reconcile ----- */

/**
 * What reconciling would do — and, when nothing would, WHY nothing would.
 *
 * The three no-op arms are three different facts with three different next
 * actions, and the page they replace collapsed all of them into the most
 * comfortable one. In order of how badly they were confused:
 *
 *   * a surface could not be read at all — the diff is empty because the read
 *     plane produced no input, and calling that "nothing to reconcile" reports
 *     an estate as clean on the strength of nobody having looked at it;
 *   * everything was read and there is genuinely nothing there;
 *   * everything was read, there is plenty there, and all of it is claimed.
 */
export function reconcileAnswer(input: {
  entries: number
  resourcesRead: number
  surfacesUnknown: number
}): string {
  if (input.entries > 0) {
    return (
      `${input.entries} change(s) would be made. Every line is a list price for a change that has not ` +
      `happened, never a billed figure.`
    )
  }
  if (input.surfacesUnknown > 0) {
    return (
      `Nothing to reconcile among what was read — but ${input.surfacesUnknown} surface(s) could not be ` +
      `read at all, so this is not a statement that the estate is clean.`
    )
  }
  if (input.resourcesRead === 0) {
    return "Every surface answered and none of them holds a resource, so there is nothing to reconcile."
  }
  return `Nothing to reconcile: all ${input.resourcesRead} resource(s) that were read are claimed by a tenure:managed-by tag.`
}

/* ------------------------------------------------------- the topology ---- */

export interface TopologySummary {
  /** The sentence above the table. */
  headline: string
  /**
   * The reason EVERY row is unknown, when they all share one — so the table
   * prints it once instead of twelve times.
   *
   * Twelve identical cells reading `UNKNOWN — organizations:DescribeOrganization
   * was refused (CredentialsProviderError)` is the wall of rows the operator
   * called a construction site: the same sentence, repeated until the twelve
   * DIFFERENT purposes beside it stop being read. Null whenever the rows
   * disagree, which is when each row genuinely needs its own reason.
   */
  sharedReason: string | null
}

export function topologySummary(rows: readonly TopologyVerdict[]): TopologySummary {
  if (rows.length === 0) {
    return { headline: "This build declares no account role, so there is no topology to reconcile.", sharedReason: null }
  }

  const unknown = rows.filter((row) => row.state === "UNKNOWN")
  if (unknown.length === rows.length) {
    const reasons = new Set(unknown.map((row) => (row.state === "UNKNOWN" ? row.because : "")))
    const [reason] = [...reasons]
    if (reasons.size === 1) {
      return {
        headline: `None of the ${rows.length} declared account roles could be checked: ${reason}. Every row below is unknown for that one reason, and none of them is a finding.`,
        sharedReason: reason,
      }
    }
    return {
      headline: `None of the ${rows.length} declared account roles could be checked, for ${reasons.size} different reasons; each row carries its own.`,
      sharedReason: null,
    }
  }

  const single = rows.filter((row) => row.state === "SINGLE_ACCOUNT").length
  const filled = rows.filter((row) => row.state === "FILLED").length
  const missing = rows.filter((row) => row.state === "MISSING").length
  const notRequired = rows.filter((row) => row.state === "NOT_REQUIRED_AT_THIS_SCALE").length

  const parts: string[] = []
  if (filled > 0) parts.push(`${filled} filled by a named account`)
  if (single > 0) parts.push(`${single} filled by this single account`)
  if (missing > 0) parts.push(`${missing} required at this scale and missing`)
  if (notRequired > 0) parts.push(`${notRequired} not required at this scale`)
  if (unknown.length > 0) parts.push(`${unknown.length} not checkable`)

  return {
    headline: `${rows.length} declared account roles: ${parts.join(", ")}.`,
    sharedReason: null,
  }
}

/** The account a verdict names, when it names one. */
export function topologyAccount(row: TopologyVerdict): string | null {
  return row.state === "FILLED" || row.state === "SINGLE_ACCOUNT" ? row.accountId : null
}

/* ------------------------------------------------------------- tones ----- */

/**
 * Badge tones, as a total function of each verdict vocabulary.
 *
 * `Badge` requires its text, so the tone is never the carrier — Bible §26.3.2.
 * What the tone must not do is *contradict* the word, and the mapping that
 * would is the one worth naming: every UNKNOWN is `warn` and never `neutral`,
 * because `states.tsx` already settled that a read the engine was not allowed
 * to make is a thing to act on (an IAM statement) rather than a shrug.
 */
export function surfaceTone(answer: SurfaceAnswer): BadgeTone {
  switch (answer) {
    case "ANSWERED":
      return "ok"
    case "EMPTY":
      return "info"
    case "STALE":
    case "UNREAD":
      return "warn"
  }
}

export function managementTone(verdict: ManagementAccountVerdict): BadgeTone {
  switch (verdict) {
    case "SEPARATED":
      return "ok"
    case "WORKLOAD_IN_MANAGEMENT_ACCOUNT":
      return "bad"
    case "NO_ORGANIZATION":
      return "info"
    case "UNKNOWN":
      return "warn"
  }
}

export function clauseTone(verdict: ClauseVerdict): BadgeTone {
  switch (verdict) {
    case "CENTRALIZED":
      return "ok"
    case "LOCAL_ONLY":
      return "warn"
    // Looked for and not there. Distinct from UNKNOWN, which was never looked
    // for — the first is a gap to close, the second is a permission to grant.
    case "ABSENT":
      return "bad"
    case "UNKNOWN":
      return "warn"
  }
}

export function topologyTone(state: TopologyVerdict["state"]): BadgeTone {
  switch (state) {
    case "FILLED":
      return "ok"
    case "SINGLE_ACCOUNT":
      return "info"
    case "NOT_REQUIRED_AT_THIS_SCALE":
      return "neutral"
    case "MISSING":
      return "bad"
    case "UNKNOWN":
      return "warn"
  }
}
