import type { ExternalIdentity, Person, RecoveryMethod } from "./entities"
import { identityLiveness, usableRecoveryCount } from "./effective-state"
import { identityKey, keyOf, type IdentityAssertion } from "./keying"
import { REQUIREMENTS } from "./assurance"

/**
 * GE-040-004 — linking a credential to a person, unlinking one, and the two
 * things that must never happen quietly.
 *
 * Bible §9.1 lists "step-up/recent authentication for high-risk actions", and
 * §21.2 "strong recovery and enumeration resistance". Adding a way to sign in as
 * someone is the highest-risk action in an identity system that is not
 * impersonation — an attacker with a live session and nothing else can, if this
 * is careless, attach their own credential and keep the account after the
 * original is cleaned up.
 *
 * ## Recent authentication, not merely a session
 *
 * A session may be eight hours old and inherited from a laptop somebody walked
 * away from. Linking requires an authentication within
 * `LINK_STEP_UP_MINUTES` — the same principle as a support session's step-up
 * freshness, for the same reason: the question is not "was this person here
 * today" but "are they here now".
 *
 * ## A collision is never resolved by guessing
 *
 * Two people can arrive at the same credential — a shared departmental account,
 * a re-issued subject, a genuine duplicate. Whatever the cause, one of two
 * records is wrong, and picking one is a decision with a person's history on
 * the other side of it. `planLink` refuses and returns the collision; merging is
 * a reviewed flow with two identities and evidence, never a side effect of
 * signing in.
 *
 * ## The last way back in is not removable
 *
 * The requirement's own words: "deny unlinking the last recovery path". The
 * subtlety is that a *credential* can be a recovery path — if somebody has one
 * SSO login and no verified recovery method, unlinking it locks them out
 * permanently, and the system will have done it on request, politely.
 */

/**
 * How recently the person must have authenticated to link or unlink.
 *
 * Derived from `REQUIREMENTS["credential-change"]` rather than declared here.
 * It was a bare 10 sitting next to a bare 30 in `support-session.ts`, with
 * nothing saying why they differ — they differ for a good reason, and
 * `assurance.ts` is now where that reason is written down. Kept as an export
 * because callers and tests refer to it.
 */
export const LINK_STEP_UP_MINUTES = REQUIREMENTS["credential-change"].maxAgeMinutes!

export type LinkRefusal =
  | "STEP_UP_REQUIRED"
  | "STEP_UP_STALE"
  | "ALREADY_LINKED_HERE"
  | "COLLISION"
  | "RELINK_REVOKED"

export interface LinkCollision {
  /** The identity already holding this key. */
  existingIdentityId: string
  /** The person it belongs to — not the one asking. */
  heldByPersonId: string
}

export interface LinkRefused {
  linked: false
  reason: LinkRefusal
  detail: string
  /** Present only for COLLISION, so a reviewer has somewhere to start. */
  collision?: LinkCollision
}

export interface LinkGranted {
  linked: true
  identity: ExternalIdentity
}

export type LinkOutcome = LinkGranted | LinkRefused

export interface LinkRequest {
  person: Person
  assertion: IdentityAssertion
  /** A new identity id, minted by the caller. */
  newIdentityId: string
  /** When the person last actually authenticated. Null means never. */
  lastAuthenticatedAt: string | null
  at: Date
}

function stepUpProblem(lastAuthenticatedAt: string | null, at: Date): LinkRefused | null {
  if (lastAuthenticatedAt === null) {
    return {
      linked: false,
      reason: "STEP_UP_REQUIRED",
      detail: "Adding or removing a way to sign in requires authenticating again first.",
    }
  }
  const last = Date.parse(lastAuthenticatedAt)
  if (Number.isNaN(last)) {
    return {
      linked: false,
      reason: "STEP_UP_REQUIRED",
      detail: "Adding or removing a way to sign in requires authenticating again first.",
    }
  }
  if (at.getTime() - last > LINK_STEP_UP_MINUTES * 60_000) {
    return {
      linked: false,
      reason: "STEP_UP_STALE",
      // A session can be eight hours old and inherited from an unattended
      // laptop. The question is not whether they were here today.
      detail: `Authenticate again to continue. This was last confirmed more than ${LINK_STEP_UP_MINUTES} minutes ago.`,
    }
  }
  return null
}

/**
 * Attach a credential to a person, or refuse and say why.
 *
 * Pure: returns the identity to persist. The caller writes it and the audit
 * record together, or neither.
 */
export function planLink(request: LinkRequest, existing: readonly ExternalIdentity[]): LinkOutcome {
  const { person, assertion, at } = request

  const stale = stepUpProblem(request.lastAuthenticatedAt, at)
  if (stale) return stale

  const key = identityKey(assertion)
  const held = existing.find((identity) => keyOf(identity) === key)

  if (held) {
    if (held.personId === person.id) {
      if (held.status === "REVOKED") {
        return {
          linked: false,
          reason: "RELINK_REVOKED",
          detail:
            "This credential was unlinked from this account. Linking it again creates a new link rather than " +
            "reviving the old one, so that the record of it having been removed survives.",
        }
      }
      return {
        linked: false,
        reason: "ALREADY_LINKED_HERE",
        detail: "This credential is already attached to this account.",
      }
    }

    // Two people, one credential. One of the two records is wrong, and picking
    // one has somebody's history on the other side of it.
    return {
      linked: false,
      reason: "COLLISION",
      detail:
        "This credential already belongs to a different account. That is not something signing in can " +
        "resolve — it needs a reviewed merge, because one of the two records is wrong and the other has a history.",
      collision: { existingIdentityId: held.id, heldByPersonId: held.personId },
    }
  }

  return {
    linked: true,
    identity: {
      id: request.newIdentityId,
      personId: person.id,
      connectionId: assertion.connectionId,
      issuer: assertion.issuer,
      subject: assertion.subject,
      assertedEmail: assertion.assertedEmail,
      emailVerified: assertion.emailVerified,
      status: "ACTIVE",
      linkedAt: at.toISOString(),
      lastAuthenticatedAt: null,
    },
  }
}

export type UnlinkRefusal = "STEP_UP_REQUIRED" | "STEP_UP_STALE" | "NOT_LINKED" | "LAST_WAY_IN" | "ALREADY_UNLINKED"

export interface UnlinkRefused {
  unlinked: false
  reason: UnlinkRefusal
  detail: string
}

export interface UnlinkGranted {
  unlinked: true
  identity: ExternalIdentity
  /** What the person has left. Shown so the decision is visible, not implied. */
  remainingCredentials: number
  remainingRecoveryMethods: number
}

export type UnlinkOutcome = UnlinkGranted | UnlinkRefused

export interface UnlinkRequest {
  identityId: string
  person: Person
  lastAuthenticatedAt: string | null
  at: Date
}

/**
 * Detach a credential, unless it is the last way back in.
 *
 * The floor is *credentials plus verified recovery methods*, not credentials
 * alone. Somebody with one SSO login and no verified recovery has exactly one
 * way in, and removing it locks them out permanently — the system having done
 * it on request, politely, is not a defence.
 *
 * Verified methods only, because an unverified one is an address somebody
 * typed. Counting it would let a person satisfy the floor with a mailbox they
 * cannot read, or one somebody else can.
 */
export function planUnlink(
  request: UnlinkRequest,
  identities: readonly ExternalIdentity[],
  recoveryMethods: readonly RecoveryMethod[],
): UnlinkOutcome {
  const { at } = request

  const stale = stepUpProblem(request.lastAuthenticatedAt, at)
  if (stale) return { unlinked: false, reason: stale.reason as UnlinkRefusal, detail: stale.detail }

  const mine = identities.filter((identity) => identity.personId === request.person.id)
  const target = mine.find((identity) => identity.id === request.identityId)

  if (!target) {
    return { unlinked: false, reason: "NOT_LINKED", detail: "That credential is not attached to this account." }
  }
  if (target.status === "REVOKED") {
    return { unlinked: false, reason: "ALREADY_UNLINKED", detail: "That credential is already unlinked." }
  }

  const otherLiveCredentials = mine.filter(
    (identity) => identity.id !== target.id && identityLiveness(identity, at).live,
  ).length
  const recovery = usableRecoveryCount(
    recoveryMethods.filter((method) => method.personId === request.person.id),
    at,
  )

  if (otherLiveCredentials + recovery === 0) {
    return {
      unlinked: false,
      reason: "LAST_WAY_IN",
      detail:
        "This is the only way into this account. Removing it would lock the account permanently — add another " +
        "credential or verify a recovery method first. A recovery method that has not been verified does not " +
        "count, because nobody has shown they can receive anything at it.",
    }
  }

  return {
    unlinked: true,
    identity: { ...target, status: "REVOKED" },
    remainingCredentials: otherLiveCredentials,
    remainingRecoveryMethods: recovery,
  }
}

export type MergeVerdict = "APPROVED" | "REJECTED"

export interface MergeProposal {
  id: string
  /** The record that survives. */
  keepPersonId: string
  /** The record that is superseded. Never deleted. */
  mergePersonId: string
  proposedBy: string
  /** Why these are believed to be one human. Required, and not an address. */
  evidence: string
  proposedAt: string
}

export interface MergeProblem {
  field: string
  detail: string
}

/**
 * Whether a merge proposal is one a reviewer can act on.
 *
 * The evidence requirement is the substance. "Same email" is not evidence —
 * GE-040-002 exists because an address is not proof of being the same human,
 * and a merge approved on that basis is the auto-merge vulnerability performed
 * by hand. So a proposal whose entire evidence is an address is refused here,
 * before a reviewer ever sees it, rather than relying on them to notice.
 */
export function validateMergeProposal(proposal: MergeProposal): readonly MergeProblem[] {
  const problems: MergeProblem[] = []

  if (proposal.keepPersonId === proposal.mergePersonId) {
    problems.push({ field: "mergePersonId", detail: "A record cannot be merged into itself." })
  }
  if (!proposal.proposedBy.trim()) {
    problems.push({ field: "proposedBy", detail: "No proposer. A merge nobody is attached to cannot be reviewed." })
  }

  const evidence = proposal.evidence.trim()
  if (evidence.length < 20) {
    problems.push({
      field: "evidence",
      detail: "A merge needs a stated reason to believe these are one person. It is what the reviewer is reviewing.",
    })
  } else if (/^\S+@\S+\.\S+$/.test(evidence) || /^(same|matching)\s+(e-?mail|address)\.?$/i.test(evidence)) {
    problems.push({
      field: "evidence",
      detail:
        "A shared address is not evidence of being the same human — that is the assumption GE-040-002 exists to " +
        "refuse, and approving on it is the auto-merge vulnerability performed by hand. State what else is known.",
    })
  }

  return problems
}

export interface MergeReview {
  proposalId: string
  reviewedBy: string
  reviewedAt: string
  verdict: MergeVerdict
  /** Recorded either way. A rejection nobody explained will be re-proposed. */
  finding: string
}

export interface MergeReviewProblem {
  field: string
  detail: string
}

/**
 * Whether a review is one.
 *
 * The reviewer may not be the proposer, for the same reason every other
 * approval in this system needs a second identity: a merge is irreversible in
 * the way that matters — the superseded record stops being the one anything
 * resolves to — and a self-approved irreversible change is a change nobody
 * reviewed.
 */
export function validateMergeReview(proposal: MergeProposal, review: MergeReview): readonly MergeReviewProblem[] {
  const problems: MergeReviewProblem[] = []

  if (review.proposalId !== proposal.id) {
    problems.push({ field: "proposalId", detail: "This review is for a different proposal." })
  }
  if (review.reviewedBy === proposal.proposedBy) {
    problems.push({
      field: "reviewedBy",
      detail: `${review.reviewedBy} proposed this merge. A merge approved by its proposer is one nobody reviewed.`,
    })
  }
  if (!review.reviewedBy.trim()) problems.push({ field: "reviewedBy", detail: "No reviewer." })
  if (review.finding.trim().length < 12) {
    problems.push({
      field: "finding",
      detail: "A review with no finding is a tick. A rejection nobody explained will simply be re-proposed.",
    })
  }

  return problems
}

export interface MergeResult {
  /** The surviving record, unchanged. */
  keepPersonId: string
  /** The superseded record, pointing at the survivor. Kept, never deleted. */
  superseded: Person
  /** Identities that move. Their keys are untouched — only `personId` changes. */
  reassignedIdentityIds: readonly string[]
}

/**
 * Apply an approved merge.
 *
 * The superseded person is marked, not removed: older references still have to
 * resolve, and an approval signed by that id must not become unreadable. That
 * is what `personLiveness` reports as `SUPERSEDED`.
 *
 * Identities move by `personId` alone. Their `connectionId`, `issuer` and
 * `subject` are untouched, because a merge is a statement about *people* and
 * changing a key would silently make the credential a different credential.
 */
export function applyMerge(
  proposal: MergeProposal,
  mergePerson: Person,
  identities: readonly ExternalIdentity[],
): MergeResult {
  const moving = identities.filter((identity) => identity.personId === proposal.mergePersonId)

  return {
    keepPersonId: proposal.keepPersonId,
    superseded: { ...mergePerson, mergedIntoPersonId: proposal.keepPersonId },
    reassignedIdentityIds: moving.map((identity) => identity.id).sort(),
  }
}
