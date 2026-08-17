/**
 * GE-143-025 — one shape for what a destructive or cross-organization action is
 * about to do.
 *
 * The requirement names nine disclosures: "exact target, tenant/org/seat scope,
 * affected count, downstream effects, approvals, recovery/undo window,
 * retention/legal-hold impact, cost impact, and audit consequence."
 *
 * What existed is `ConfirmDialog`'s `details?: ReactNode` — a slot. Every caller
 * wrote its own prose into it, most wrote nothing, and nothing anywhere said
 * which questions a confirmation has to answer. Prose in a slot cannot be
 * checked, cannot be counted, and cannot be missing in a way anyone notices.
 *
 * ## The one design decision worth arguing about
 *
 * Every disclosure is `{ known: … }` or `{ unavailable: reason }`. There is no
 * third option and no optional field, because the two answers this codebase most
 * often confuses are "we looked and there is nothing" and "we could not look":
 *
 *     affected: { known: { count: 0, noun: "assignment" } }   → nothing is lost
 *     affected: { unavailable: "the count query timed out" }   → unknown risk
 *
 * Rendered as a blank, an em-dash or a zero, those two are the same pixel — and
 * they are opposite advice about whether to press the button. A preview that
 * cannot compute a disclosure must SAY so, in the reason, and the panel prints
 * the reason where the value would have been.
 *
 * `undefined` is not accepted for any field: TypeScript stops a caller omitting
 * one, and `validateDestructivePreview` stops a preview that arrives as data —
 * from a server action, a JSON payload, a test fixture — from being rendered
 * with holes in it.
 */

/** A disclosure that was computed, or an explicit account of why it was not. */
export type Disclosure<T> = { known: T } | { unavailable: string }

export function isKnown<T>(disclosure: Disclosure<T>): disclosure is { known: T } {
  return typeof disclosure === "object" && disclosure !== null && "known" in disclosure
}

/** The exact thing being acted on. A name alone is not exact — two seats share one. */
export interface DestructiveTarget {
  /** What kind of record: "seat", "budget line", "document". */
  kind: string
  /** The name a human recognises. */
  label: string
  /** The identifier that disambiguates it from the one beside it. */
  identifier: string
}

/** Where the action lands. `seat` is null when the action is not seat-scoped. */
export interface DestructiveScope {
  tenant: string
  organization: string
  seat: string | null
  /**
   * Whether the effect crosses organization boundaries — the second half of the
   * requirement's "destructive AND cross-organization previews". A tenant-wide
   * action reads differently from one inside a single club, and the reader
   * cannot infer which from the target's name.
   */
  crossOrganization: boolean
}

/** How many records go, and what they are called. */
export interface AffectedCount {
  count: number
  /** Singular noun; the panel pluralises. */
  noun: string
}

/** Whether the action can be taken back, and for how long. */
export type Recovery =
  | { kind: "undo-window"; minutes: number; how: string }
  | { kind: "restore-from-archive"; how: string }
  | { kind: "irreversible"; why: string }

/** What the audit trail will hold afterwards. */
export type AuditConsequence =
  | { kind: "recorded"; event: string }
  /** Recorded because it is true, not because it is comfortable. */
  | { kind: "not-recorded"; why: string }

export interface DestructivePreview {
  target: Disclosure<DestructiveTarget>
  scope: Disclosure<DestructiveScope>
  affected: Disclosure<AffectedCount>
  /** Each string is one consequence elsewhere. `[]` means: looked, none found. */
  downstream: Disclosure<string[]>
  /** Approvals this needs before it takes effect. `[]` means none are required. */
  approvals: Disclosure<string[]>
  recovery: Disclosure<Recovery>
  /** Retention and legal-hold impact, in a sentence. */
  retention: Disclosure<string>
  /** Cost impact. `{ known: null }` means there is none — not that none was computed. */
  cost: Disclosure<string | null>
  audit: Disclosure<AuditConsequence>
}

/** The disclosures, in the order the requirement names them and the panel prints them. */
export const DISCLOSURE_ORDER = [
  "target",
  "scope",
  "affected",
  "downstream",
  "approvals",
  "recovery",
  "retention",
  "cost",
  "audit",
] as const

export type DisclosureKey = (typeof DISCLOSURE_ORDER)[number]

/** The label the panel prints beside each disclosure. */
export const DISCLOSURE_LABELS: Record<DisclosureKey, string> = {
  target: "Exactly what",
  scope: "Where",
  affected: "How many records",
  downstream: "What else changes",
  approvals: "Approvals",
  recovery: "Can this be undone",
  retention: "Retention and legal hold",
  cost: "Cost",
  audit: "Audit trail",
}

/**
 * Everything wrong with a preview, as sentences.
 *
 * `[]` is a preview that may be shown. Called by the panel itself, which prints
 * the problems in place of the confirmation rather than rendering an incomplete
 * one: a confirmation missing a disclosure is worse than no confirmation, because
 * the reader believes they have been told everything.
 */
export function validateDestructivePreview(preview: unknown): string[] {
  if (typeof preview !== "object" || preview === null) {
    return ["The preview is not an object, so nothing about this action can be shown."]
  }

  const record = preview as Record<string, unknown>
  const problems: string[] = []

  for (const key of DISCLOSURE_ORDER) {
    const disclosure = record[key]
    if (typeof disclosure !== "object" || disclosure === null) {
      problems.push(`${DISCLOSURE_LABELS[key]} was not disclosed at all.`)
      continue
    }

    const value = disclosure as Record<string, unknown>
    const hasKnown = "known" in value
    const hasUnavailable = "unavailable" in value

    if (hasKnown && hasUnavailable) {
      problems.push(
        `${DISCLOSURE_LABELS[key]} claims both a value and a reason it could not be computed.`,
      )
      continue
    }
    if (!hasKnown && !hasUnavailable) {
      problems.push(
        `${DISCLOSURE_LABELS[key]} is neither a value nor a reason one could not be computed.`,
      )
      continue
    }
    if (hasUnavailable) {
      const reason = value.unavailable
      if (typeof reason !== "string" || reason.trim().length < 4) {
        // "Unavailable" with no reason is the blank this whole type exists to
        // outlaw, wearing a different name.
        problems.push(
          `${DISCLOSURE_LABELS[key]} says it is unavailable without saying why, which tells the reader nothing.`,
        )
      }
      continue
    }
    if (value.known === undefined) {
      problems.push(`${DISCLOSURE_LABELS[key]} was disclosed as undefined.`)
    }
  }

  return problems
}

// ─── The sentences the panel prints ──────────────────────────────────────────

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

export function targetSentence(target: DestructiveTarget): string {
  return `The ${target.kind} “${target.label}” (${target.identifier})`
}

export function scopeSentence(scope: DestructiveScope): string {
  const parts = [scope.tenant, scope.organization]
  if (scope.seat) parts.push(scope.seat)
  return (
    parts.join(" · ") +
    (scope.crossOrganization
      ? " — and this reaches beyond this organization"
      : " — inside this organization only")
  )
}

export function affectedSentence(affected: AffectedCount): string {
  // "0 assignments" and "not counted" must never render the same, so the zero
  // says out loud that it was looked for.
  return affected.count === 0
    ? `None — checked, and no ${affected.noun}s are attached`
    : plural(affected.count, affected.noun)
}

export function listSentence(items: string[], nothing: string): string {
  return items.length === 0 ? nothing : items.join("; ")
}

export function recoverySentence(recovery: Recovery): string {
  switch (recovery.kind) {
    case "undo-window":
      return `Yes, for ${plural(recovery.minutes, "minute")}. ${recovery.how}`
    case "restore-from-archive":
      return `Yes, from the archive. ${recovery.how}`
    case "irreversible":
      return `No. ${recovery.why}`
  }
}

export function auditSentence(audit: AuditConsequence): string {
  return audit.kind === "recorded"
    ? `Recorded as ${audit.event}.`
    : `Nothing is recorded. ${audit.why}`
}

export function costSentence(cost: string | null): string {
  return cost === null ? "No cost impact." : cost
}

/** The one line each disclosure renders as, or the reason it could not. */
export function disclosureSentence(preview: DestructivePreview, key: DisclosureKey): string {
  const disclosure = preview[key] as Disclosure<unknown>
  if (!isKnown(disclosure)) return `Not determined — ${disclosure.unavailable}`

  switch (key) {
    case "target":
      return targetSentence(disclosure.known as DestructiveTarget)
    case "scope":
      return scopeSentence(disclosure.known as DestructiveScope)
    case "affected":
      return affectedSentence(disclosure.known as AffectedCount)
    case "downstream":
      return listSentence(disclosure.known as string[], "Nothing else — checked.")
    case "approvals":
      return listSentence(disclosure.known as string[], "None required.")
    case "recovery":
      return recoverySentence(disclosure.known as Recovery)
    case "retention":
      return disclosure.known as string
    case "cost":
      return costSentence(disclosure.known as string | null)
    case "audit":
      return auditSentence(disclosure.known as AuditConsequence)
  }
}

// ─── The migration this standard is in the middle of ─────────────────────────

/**
 * Destructive confirmations that do not carry a preview yet.
 *
 * GE-143-045 asks for incremental migration with a deprecation ledger rather
 * than an all-at-once rewrite, and this is that ledger. Every entry is a real
 * call site with the reason it has not moved; the test asserts the file still
 * contains an unmigrated confirmation, so an entry cannot outlive its call site,
 * and asserts nothing outside this list is unmigrated, so a NEW destructive
 * dialog cannot be written without either a preview or a decision recorded here.
 *
 * The list is the honest part of this item: one migrated call site and a
 * standard is a standard nine surfaces do not follow yet, and saying which nine
 * is worth more than implying none.
 */
export const DESTRUCTIVE_PREVIEW_BACKLOG: readonly {
  file: string
  /** How many destructive confirmations in that file still carry no preview. */
  unmigrated: number
  reason: string
}[] = [
  {
    file: "src/app/(app)/admin/approvals/page.tsx",
    unmigrated: 1,
    reason:
      "Approval decision. The affected count and downstream effects depend on the workflow definition, which is resolved per request; the preview needs those numbers threaded through the page loader first.",
  },
  {
    file: "src/app/(app)/admin/clubs/page.tsx",
    unmigrated: 1,
    reason:
      "Club deletion from the list page, which loads no per-club counts — it would have to state an affected count it has not computed, which is the failure this type exists to prevent.",
  },
  {
    file: "src/app/(app)/admin/clubs/[slug]/page.tsx",
    unmigrated: 2,
    reason:
      "Assignment removal and holder removal on the page whose seat deletion IS migrated. Both need the member's memory and history counts, which the roles query does not select; the seat delete could go first because its counts were already loaded to decide whether the control appears.",
  },
  {
    file: "src/app/(app)/admin/overrides/page.tsx",
    unmigrated: 2,
    reason:
      "Override grant and revocation; the downstream effect is an entitlement recomputation whose blast radius is not queryable from the page today.",
  },
  {
    file: "src/app/(app)/admin/people/page.tsx",
    unmigrated: 1,
    reason:
      "Directory-person removal; the affected count spans assignments and holdings across every organization and is not loaded here.",
  },
  {
    file: "src/app/(app)/feed/page.tsx",
    unmigrated: 1,
    reason:
      "Declining a collaboration request. Consequential and notifying three audiences, but the notification fan-out is decided in the server action, so the downstream list would have to be written by hand here and could drift from what the action does.",
  },
  {
    file: "src/app/(app)/orgs/[slug]/members/page.tsx",
    unmigrated: 1,
    reason:
      "Member removal; needs the member's assignment and memory counts, which the members loader does not select.",
  },
  {
    file: "src/components/admin/RoleTransferPanel.tsx",
    unmigrated: 2,
    reason:
      "Seat transfer between holders — consequential but not a deletion; the disclosure it wants is a before/after, which is GE-143-036's structured-preview work rather than this shape.",
  },
  {
    file: "src/components/ClubCard.tsx",
    unmigrated: 1,
    reason: "Leave-club control rendered inside a list card, with no counts in scope on that card.",
  },
  {
    file: "src/components/documents/DocumentRow.tsx",
    unmigrated: 1,
    reason:
      "Document deletion. Retention and legal-hold impact is real here and has to be resolved per document before it can be stated truthfully, which is exactly the disclosure that must not be guessed.",
  },
  {
    file: "src/components/finance/BudgetUpload.tsx",
    unmigrated: 1,
    reason:
      "Budget replacement on upload; the affected count is the parsed row count, known only after the file is read on the client.",
  },
  {
    file: "src/components/finance/FinanceDashboard.tsx",
    unmigrated: 1,
    reason:
      "Budget-line deletion; the ledger entries behind a line are loaded lazily by the drawer, so the count is not in scope at the confirmation.",
  },
]

/**
 * Confirmation elements in a module's source, and whether each carries a preview.
 *
 * A deliberately small scanner: it finds the opening tag of a confirmation
 * component and reads its attribute names. It does not parse JSX — it walks to
 * the matching `>` tracking quotes, braces and nested elements, which is enough
 * to answer "does this element have a `preview` prop" and nothing more.
 */
export const CONFIRMATION_COMPONENTS = ["ConfirmDialog", "ConfirmSubmit", "ConfirmInlineSubmit"]

export interface ConfirmationSite {
  component: string
  hasPreview: boolean
  /** `variant="danger"` explicitly, or by ConfirmSubmit's default. */
  destructive: boolean
}

export function confirmationSites(source: string): ConfirmationSite[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
  const sites: ConfirmationSite[] = []

  for (const component of CONFIRMATION_COMPONENTS) {
    const opening = new RegExp(`<${component}(?=[\\s/>])`, "g")
    for (const match of code.matchAll(opening)) {
      const start = match.index + match[0].length
      const tag = openingTagAt(code, start)
      if (tag === null) continue
      sites.push({
        component,
        hasPreview: /(^|\s)preview=/.test(tag),
        // ConfirmSubmit defaults to danger; ConfirmDialog defaults to "default",
        // so only an explicit variant makes it destructive.
        destructive:
          component === "ConfirmSubmit"
            ? !/variant="(?!danger)/.test(tag)
            : /variant="danger"/.test(tag),
      })
    }
  }

  return sites
}

/** The text of an opening tag starting at `from`, up to its unnested `>`. */
function openingTagAt(code: string, from: number): string | null {
  let depth = 0
  let quote: string | null = null

  for (let i = from; i < code.length; i++) {
    const ch = code[i]
    if (quote) {
      if (ch === "\\") i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      continue
    }
    if (ch === "{") depth++
    else if (ch === "}") depth--
    else if (ch === ">" && depth === 0) return code.slice(from, i)
  }
  return null
}
