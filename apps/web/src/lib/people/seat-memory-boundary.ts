import type { MemoryRecordType } from "@prisma/client"
import {
  planHandover,
  releaseToSuccessor,
  type Classification,
  type ClassifiedResource,
  type HandoverSummary,
  type InheritanceClass,
  type ReleaseDecision,
  type SuccessionContext,
} from "@tenure/organization-model"
import { sensitivityRank } from "@/lib/search"

/**
 * HCM-040-003 — the line between a person's private history and a seat's
 * inheritable memory, for the one object this platform actually inherits.
 *
 * The People Bible states the rule twice and in the strongest terms it uses
 * anywhere. §2: "Private person data never automatically becomes successor
 * memory. Seat memory contains eligible work artifacts, decisions,
 * responsibilities, controls, playbooks, relationships and status, with privacy
 * filtering and provenance." §3.4: "Never transfer another person's private
 * messages, performance, health, compensation or unrestricted files to a
 * successor." §17 lists "expose private data to successors" among the
 * prohibited shortcuts.
 *
 * Before this file, `canSeeMemoryCard` gave an incoming holder — status
 * `SHADOW`, a person whose term has not begun — **every** card scoped to the
 * seat they are shadowing, including cards of type `CREDENTIAL` ("Login /
 * access info", `schema.prisma`) and cards labelled `restricted`. The visibility
 * rule knew who was standing at the door and nothing at all about what was
 * behind it, so "the handoff" and "hand over everything" were the same code.
 *
 * ## The decision is not made here
 *
 * `@tenure/organization-model`'s `releaseToSuccessor` already decides what a
 * successor gets for one resource, in the vocabulary the Bible uses —
 * `TRANSFER` / `ROTATE` / `WITHHOLD`, unconditional refusals first, default deny
 * for an unclassified controlled resource. It was written for GE-050-007 and,
 * until now, was imported by nothing outside its own package
 * (`docs/architecture/hcm-people-inventory.md` §3 measured it). Re-deciding the
 * same question here would be a second answer to it, and the one that drifts is
 * whichever nobody looks at.
 *
 * What this file does is the part that cannot live in the package: map THIS
 * schema's `MemoryRecord` onto that vocabulary, and say honestly where the
 * schema cannot answer.
 *
 * ## Where the schema cannot answer
 *
 * `MemoryRecord` has no owner-vs-seat column. There is `authorId`, and
 * authorship is not ownership — the outgoing president writes the playbook the
 * seat keeps. So `PERSONAL` is a class this mapping can never produce, and the
 * private half of the boundary is enforced the only way the stored data
 * supports: by classification, and by refusing what it cannot classify. A
 * mapping that guessed `PERSONAL` from `authorId` would withhold the seat's own
 * playbooks and let a genuinely private card through the moment somebody else
 * filed it, which is worse than both failure modes it replaces.
 *
 * That gap is recorded, not papered over:
 * `docs/implementation/people-hr-workforce-execution-ledger.md` names the column
 * that would let `PERSONAL` be represented.
 */

/**
 * What the boundary needs to know about one memory card.
 *
 * `type` and `sensitivity` are **required**, not optional. An optional
 * classification would mean a caller that forgot to select the columns got the
 * permissive answer by omission — which is the precise failure
 * `apps/web/src/lib/search-data.ts` already carries a comment about for
 * `Document.sensitivity` ("Dropping it from this projection silently
 * reclassifies every document as `standard`"). Required means `tsc` names every
 * read path that has not answered.
 */
export interface SeatMemoryCard {
  /** The card's own id. Used as the resource id in the handover plan. */
  id: string
  /** The seat the card is scoped to. `null` is an org-wide card, not seat memory. */
  roleId: string | null
  type: MemoryRecordType
  /** `MemoryRecord.sensitivity` — a free `String` column, ranked, never trusted. */
  sensitivity: string | null
  /**
   * Who wrote it. `MemoryRecord.authorId`, nullable because older rows have none.
   *
   * Carried so that the inheritance rules below cannot hide a card from the
   * person who created it. Tightening the handoff window did exactly that: an
   * officer whose seat row is SHADOW wrote a CREDENTIAL card and then could not
   * find it in her own search, because CREDENTIAL is precisely what does NOT
   * transfer to an incoming holder. The rule was right about inheritance and
   * wrong about authorship — what you wrote is not something you inherit.
   */
  authorId?: string | null
}

/** Where one card stands in relation to the seat, before its label is read. */
export interface SeatStanding {
  inheritance: InheritanceClass
  classification: Classification | null
}

/**
 * Every `MemoryRecordType`, mapped to what it is to a seat.
 *
 * A `Record` keyed by the enum rather than a `switch` with a default: a ninth
 * memory type is then a compile error here instead of quietly inheriting the
 * most permissive branch somebody else wrote. The same reason
 * `relay/projection-policy.ts` states `MODE_BY_KIND` exhaustively.
 *
 * Both fields are stated here and nowhere else. A first version of this file
 * kept the inheritance in the map and re-derived `CREDENTIAL`'s classification in
 * an `if` inside `classifySeatMemory`, which made this row's value dead code:
 * changing `CREDENTIAL: "CONTROLLED"` to `"SEAT_RECORD"` left all 22 tests
 * green, because the branch below never read it. Two places encoding one fact,
 * and the unverifiable one is the one that drifts. Found by mutating it.
 *
 * `CREDENTIAL` is the one type that is `CONTROLLED` on its face. The others are
 * the "eligible work artifacts, decisions, responsibilities, controls,
 * playbooks, relationships and status" §2 lists as seat memory — a vendor deal,
 * a compliance deadline, a recurring-event playbook and a hard-won lesson are
 * the seat's, and losing them at every turnover is the problem the product
 * exists to solve. Their *sensitivity label* can still take them out of the
 * successor's reach; see `classifySeatMemory`.
 */
const SEAT_STANDING_BY_TYPE: Record<MemoryRecordType, SeatStanding> = {
  CONTACT: { inheritance: "SEAT_RECORD", classification: null },
  PLAYBOOK: { inheritance: "SEAT_RECORD", classification: null },
  BUDGET: { inheritance: "SEAT_RECORD", classification: null },
  VENDOR: { inheritance: "SEAT_RECORD", classification: null },
  LESSON: { inheritance: "SEAT_RECORD", classification: null },
  THREAD: { inheritance: "SEAT_RECORD", classification: null },
  DEADLINE: { inheritance: "SEAT_RECORD", classification: null },
  // schema.prisma: "Login / access info — stored encrypted". Never content to
  // hand over; `releaseToSuccessor` reads this classification and answers
  // ROTATE, which is the Bible's own word (§8.3, "rotated or reassigned").
  CREDENTIAL: { inheritance: "CONTROLLED", classification: "CREDENTIAL" },
}

/** What an unknown type resolves to: refused, and refused for a stated reason. */
const UNCLASSIFIABLE: SeatStanding = { inheritance: "CONTROLLED", classification: null }

/**
 * The classification of one card, in `releaseToSuccessor`'s vocabulary.
 *
 * Three cases, in this order:
 *
 *  1. **A type this build does not know** — a card whose `type` is not in the
 *     enum at all, which a stale read path or a hand-written row can produce.
 *     `CONTROLLED` with no classification, so the release decision is a default
 *     deny with a reason. This is the "could not look" case and it must not read
 *     like the "looked and found nothing" case.
 *  2. **A type that is controlled on its face** — returned as declared, whatever
 *     the sensitivity label says. A credential labelled `standard` is still a
 *     credential.
 *  3. **Anything above `standard` on the sensitivity ladder** — `CONTROLLED`
 *     with a `null` classification. `sensitivity` is a free `String`, and
 *     `sensitivityRank` (`lib/search.ts`, the ladder the search read path
 *     already uses) ranks an unrecognised label at the most restrictive known
 *     level. Mapping "restricted" onto one of `HR_RECORD` / `LEGAL_HOLD` /
 *     `INVESTIGATION` / `RESTRICTED_COMMUNICATION` would be an invention: the
 *     column does not say which, so no policy can be checked against it and the
 *     honest outcome is the package's own default deny.
 *
 * Reusing `sensitivityRank` rather than restating the ladder is deliberate. Two
 * ladders would be two answers to "is this card restricted", and search already
 * owns one.
 */
export function classifySeatMemory(card: SeatMemoryCard): SeatStanding {
  if (!Object.prototype.hasOwnProperty.call(SEAT_STANDING_BY_TYPE, card.type)) {
    return UNCLASSIFIABLE
  }
  const declared = SEAT_STANDING_BY_TYPE[card.type]
  if (declared.inheritance !== "SEAT_RECORD") return declared
  if (sensitivityRank(card.sensitivity) > 0) {
    return { inheritance: "CONTROLLED", classification: null }
  }
  return declared
}

/** One card as a resource the organization model can decide about. */
function asResource(card: SeatMemoryCard): ClassifiedResource {
  const { inheritance, classification } = classifySeatMemory(card)
  return {
    resourceId: card.id,
    // An org-wide card is not seat memory and never reaches here through
    // `canSeeMemoryCard`; the empty string keeps the shape total rather than
    // inventing a seat for it.
    seatId: card.roleId ?? "",
    inheritance,
    classification,
  }
}

/**
 * The handoff window, as a succession context.
 *
 * `successorHoldsSeat: true` — an incoming holder is placed in the seat
 * (`RoleAssignment.status = SHADOW`), so there is occupancy to release against.
 *
 * `transitionCompleted: false` — and this is the load-bearing half. The shadow
 * window is the period **before** the handover completes; when it completes the
 * assignment becomes `ACTIVE` and the reader is the seat's holder, answered by
 * an earlier branch of `canSeeMemoryCard` entirely. So there is no state in
 * which this context should claim a completed transition, and controlled
 * material is withheld from the shadow window by the package's own rule rather
 * than by a check written here.
 *
 * The policy releases nothing for the same reason: a release policy is the
 * output of a transition workflow, and this platform has no seat-transition
 * workflow that produces one. An empty allowlist is that fact written down.
 * Naming a classification here would be granting a release no workflow ever
 * authorized.
 */
export const SHADOW_WINDOW: SuccessionContext = {
  successorHoldsSeat: true,
  transitionCompleted: false,
  policy: { id: "seat-memory.shadow-window", releases: [] },
}

/**
 * What an incoming holder inherits for one card, and why.
 *
 * Returns the package's `ReleaseDecision` unchanged — including its sentence —
 * so a surface can say *why* something is not there. "3 cards withheld" with no
 * reason is how a successor spends a week discovering gaps one confused request
 * at a time.
 */
export function inheritsToSuccessor(card: SeatMemoryCard): ReleaseDecision {
  return releaseToSuccessor(asResource(card), SHADOW_WINDOW)
}

/**
 * The whole packet for a seat, so somebody can look at it before the term
 * starts.
 *
 * `planHandover`'s summary, unchanged: what transfers, what must be reissued to
 * the successor rather than handed over, and what is withheld with the reason.
 * The transition surface (`/orgs/[slug]/handoff`) renders these three counts
 * instead of `_count.memoryRecords`, which counted credentials and restricted
 * cards as knowledge the successor was about to receive.
 */
export function successorHandoffPacket(
  cards: readonly SeatMemoryCard[],
): HandoverSummary {
  return planHandover(cards.map(asResource), SHADOW_WINDOW)
}
