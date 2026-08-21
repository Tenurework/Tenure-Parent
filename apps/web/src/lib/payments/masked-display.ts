import {
  findFinancialIdentifiers,
  maskIdentifier,
  revealFor,
  type AccessPurpose,
  type FinancialIdentifierKind,
  type PurposeGrant,
  type RevealLevel,
} from "@tenure/payments"

import { isOseDirector, carriesFinanceAuthority, type UserContext } from "@/lib/rbac"

/**
 * PAY-200-003 — the SHOWN half: masked display with purpose-based access.
 *
 * `@tenure/payments`' `financial-identifiers.ts` already decides how much of a
 * card number, an IBAN, a routing number or a provider object id a given
 * PURPOSE may see (`revealFor`), and what the permitted amount looks like on a
 * screen (`maskIdentifier`). Until this module existed, nothing in the
 * application asked either question: `revealFor`, `maskIdentifier` and
 * `grantProblems` had no caller outside their own tests.
 *
 * The three paths that DID call into that file all leave the process —
 * `scrubForModel` (a prompt), `scrubForLog` (a log line), `scrubForAudit` (an
 * append-only row) — and all three answer the same way, because the destination
 * is a third party or a table nobody can edit afterwards: remove the value and
 * leave a tenant-scoped token. A screen is the case those three do not cover
 * and the one the requirement names. It has a PERSON on the other end, that
 * person has a REASON for looking, and the reason is what decides how much of
 * the value belongs on the screen. Tokenizing there would be strictly worse
 * than masking: `tok_a91f…` tells a treasurer reconciling a statement nothing,
 * where `411111••••••1111` tells her whether this is the card she is holding.
 *
 * ── What was actually leaking ───────────────────────────────────────────────
 *
 * `approvals/[id]/page.tsx` rendered `approval.description` and every decision
 * step's `reason` verbatim. Both are free text a club officer types. A
 * reimbursement note reading "paid on the club Visa 4111 1111 1111 1111" was
 * shown in full to every seat that could open the request — which, by design,
 * is a wide audience: the submitter, the club's officers, the president, and
 * the staff office. The value was already stored raw; this is the read side,
 * and it is the side a person sees.
 *
 * ── Why a reader with no stated purpose sees NOTHING, not "the usual mask" ──
 *
 * `displayPurposeFor` returns `null` for a reader whose relationship to the
 * record matches no purpose, and `maskForDisplay` renders every identifier at
 * `NONE` for that reader. Not `LAST4` "because they can see the page anyway":
 * being able to read a note is a different permission from being able to read
 * the account number inside it, and collapsing the two is how a PCI scope grows
 * by accident. The notice this produces says which of the two happened, because
 * "we masked this because your purpose does not earn it" and "there was nothing
 * here" must not read the same.
 */

/** What `displayPurposeFor` decided, and the sentence explaining it. */
export interface DisplayPurposeDecision {
  /** `null` means no purpose applies — every identifier renders at `NONE`. */
  purpose: AccessPurpose | null
  /** Why. Shown to nobody by default; carried so a caller can explain itself. */
  because: string
}

export interface DisplayPurposeInput {
  ctx: UserContext
  /** The club the record belongs to. */
  org: { id: string; institutionId: string }
  /** The person the record is ABOUT — a claim's submitter. `null` if unknown. */
  subjectUserId: string | null
}

/**
 * Which purpose a reader of an approval record is acting under.
 *
 * Two purposes can apply on this surface and they are not ordered against each
 * other, so the tie is broken deliberately rather than incidentally:
 *
 *   - `CUSTOMER_SELF_SERVICE` — the record is about the person reading it.
 *   - `OPERATIONS_RECONCILIATION` — the reader is accountable for the money:
 *     an ACTIVE finance seat or the club's ACTIVE president, or the staff
 *     office's director for the institution.
 *
 * A treasurer reading HER OWN claim satisfies both. She gets the narrower one,
 * `CUSTOMER_SELF_SERVICE`, which in `BASE_REVEAL` shows strictly less of every
 * kind than the operational purpose does. The reasoning is not politeness: an
 * operational reveal exists so a reconciler can match Tenure's books against a
 * bank's, and nobody reconciles their own reimbursement. Taking the wider
 * purpose whenever both apply would mean the way to see more of an account
 * number is to file the claim yourself.
 *
 * A SHADOW seat — an incoming officer during a handoff — carries no purpose
 * here. It can already read the request; that is a different question from
 * whether the account number inside it is part of the handover.
 */
export function displayPurposeFor(input: DisplayPurposeInput): DisplayPurposeDecision {
  const { ctx, org, subjectUserId } = input

  if (subjectUserId && ctx.userId === subjectUserId) {
    return {
      purpose: "CUSTOMER_SELF_SERVICE",
      because: "the record is about the person reading it",
    }
  }

  if (isOseDirector(ctx, org.institutionId)) {
    return {
      purpose: "OPERATIONS_RECONCILIATION",
      because: "staff-office director for this institution",
    }
  }

  const operational = ctx.orgRoles.some(
    (role) =>
      role.organizationId === org.id &&
      role.status === "ACTIVE" &&
      (role.scope === "PRESIDENT" || carriesFinanceAuthority(role)),
  )
  if (operational) {
    return {
      purpose: "OPERATIONS_RECONCILIATION",
      because: "holds an active seat accountable for this club's money",
    }
  }

  return {
    purpose: null,
    because: "no access purpose applies to this reader",
  }
}

/** One identifier found in the text, and how much of it was rendered. */
export interface MaskedOccurrence {
  kind: FinancialIdentifierKind
  level: RevealLevel
}

export interface MaskedDisplay {
  /** What belongs on the screen. Identical to the input when nothing matched. */
  text: string
  occurrences: readonly MaskedOccurrence[]
  /**
   * A sentence for the reader, or `null` when there is nothing to say.
   *
   * Never `null` merely because everything was hidden: a reader who cannot see
   * that something was hidden will read the masked text as the whole text.
   */
  notice: string | null
}

export interface MaskForDisplayOptions {
  /** A recorded purpose grant held by this reader, if there is one. */
  grant?: PurposeGrant | null
  /** ISO-8601. Injected so a test describes a moment without moving the clock. */
  at?: string
}

const KIND_NOUNS: Readonly<Record<FinancialIdentifierKind, string>> = {
  PAN: "card number",
  IBAN: "IBAN",
  US_ROUTING: "routing number",
  US_BANK_ACCOUNT: "bank account number",
  PROVIDER_OBJECT: "provider object id",
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`
}

/**
 * The text as this reader may see it.
 *
 * Rebuilt by splicing rather than by `replace`, because the same account number
 * can appear twice in one note and a `replace` keyed on the value would collapse
 * the two into one edit — and because `findFinancialIdentifiers` already returns
 * non-overlapping occurrences in order, which is exactly the input a splice
 * wants and exactly what a regex pass over an already-partly-masked string is
 * not.
 */
export function maskForDisplay(
  text: string | null | undefined,
  decision: DisplayPurposeDecision,
  options: MaskForDisplayOptions = {},
): MaskedDisplay {
  if (typeof text !== "string" || text.length === 0) {
    return { text: "", occurrences: [], notice: null }
  }

  const at = options.at ?? new Date().toISOString()
  const grant = options.grant ?? null
  const found = findFinancialIdentifiers(text)
  if (found.length === 0) {
    return { text, occurrences: [], notice: null }
  }

  const occurrences: MaskedOccurrence[] = []
  let out = ""
  let cursor = 0
  for (const occurrence of found) {
    const level: RevealLevel =
      decision.purpose === null
        ? "NONE"
        : revealFor(occurrence.kind, decision.purpose, grant, at)
    out += text.slice(cursor, occurrence.start)
    out += maskIdentifier(occurrence.raw, occurrence.kind, level)
    cursor = occurrence.end
    occurrences.push({ kind: occurrence.kind, level })
  }
  out += text.slice(cursor)

  return { text: out, occurrences, notice: noticeFor(occurrences, decision) }
}

/**
 * What the reader is told about what they are not seeing.
 *
 * Three different sentences, because they are three different facts and a
 * single "some values are hidden" would make the first indistinguishable from
 * the second — which is the whole point of the control.
 */
function noticeFor(
  occurrences: readonly MaskedOccurrence[],
  decision: DisplayPurposeDecision,
): string | null {
  if (occurrences.length === 0) return null

  const kinds = new Set(occurrences.map((o) => o.kind))
  const nouns = [...kinds].map((kind) => KIND_NOUNS[kind]).join(", ")

  if (decision.purpose === null) {
    return `${pluralize(occurrences.length, "financial identifier")} (${nouns}) hidden entirely — ${decision.because}.`
  }

  const revealed = occurrences.filter((o) => o.level === "FULL").length
  if (revealed === occurrences.length) {
    return `${pluralize(occurrences.length, "financial identifier")} (${nouns}) shown in full under a recorded purpose grant.`
  }

  return `${pluralize(occurrences.length, "financial identifier")} (${nouns}) masked — shown as far as ${decision.purpose} allows.`
}
