import { TOMBSTONE_FIELDS, type TenantState } from "@tenure/provisioning"

/**
 * GE-103-019 — what is true of a tenant once it has been purged, said out loud.
 *
 * > "Make clear that a purged tenant has no recoverable content; it can only be
 * > onboarded anew from independently retained configuration/customer import."
 *
 * The console already tells an operator that a purge cannot be undone —
 * `riskOf` writes `IRREVERSIBLE. No path back to a serving state exists from
 * PURGING.` That sentence is about the LIFECYCLE, and it is not this one. The
 * transition graph has an edge `PURGING → FAILED → DRAFT`, and `DRAFT` reaches
 * `ACTIVE`; `canReachServing` refuses to follow it, and the reason it gives in
 * its own comment is precisely the fact this module renders: *"rebuilding from
 * DRAFT under the same slug produces a new, empty tenant."*
 *
 * That reasoning lived in a code comment. An operator looking at a purged
 * tenant saw `terminal`, `no residual cost in this state`, and a lifecycle card
 * that said there is no move out — none of which says whether the customer's
 * records still exist somewhere, and all of which are compatible with "somebody
 * in engineering can get it back". This is the sentence that closes that
 * question, and it is rendered rather than commented.
 *
 * ## Three standings, not a boolean
 *
 * `PURGE_PENDING`, `PURGING` and `PURGED_ZERO_INCREMENTAL_COST` are three
 * different answers and collapsing any two is a real harm:
 *
 *   * `PURGE_PENDING` — **nothing has been destroyed.** The tenant is still
 *     whole and the move away is still available. Telling an operator here that
 *     the content is gone is how a recoverable tenant gets abandoned.
 *   * `PURGING` — **destruction has begun.** A half-purged tenant is not a
 *     working tenant that can be talked back into service, so the recovery
 *     answer is already the same as `gone` even though the deletion is not
 *     finished. This is the state where an optimistic reading costs the most.
 *   * `PURGED_ZERO_INCREMENTAL_COST` — **gone.**
 *
 * Every other state returns `null`: this disclosure belongs where the question
 * arises, and a panel that appeared on an ACTIVE tenant would be noise, which
 * is how the ones that matter stop being read.
 *
 * ## Why the inputs carry `heldByPlatform`
 *
 * The requirement's second clause is "**independently** retained configuration/
 * customer import". Independent of what? Of Tenure. So each input names where
 * it comes from and whether the platform still holds it — and every input for a
 * purged tenant answers `false`, because an input the platform still held would
 * make the first clause of the sentence untrue. The flag is the check, not a
 * decoration: `purge-finality-logic.spec.ts` asserts it over every input.
 *
 * ## What the Parent does keep
 *
 * The tombstone, and only the tombstone. Its field list is read from
 * `TOMBSTONE_FIELDS` rather than written out again here, so the sentence a
 * human reads and the key set `tombstoneProblems` enforces (GE-103-015) cannot
 * drift apart. A disclosure that listed five fields of its own would be wrong
 * the first time the tombstone changed shape, in the paragraph whose entire job
 * is to be trusted.
 */

/** Whether the tenant's own content still exists. */
export type ContentStanding = "intact" | "being-destroyed" | "gone"

/** One thing a fresh onboarding under this name would need, and where it comes from. */
export interface RebuildInput {
  what: string
  from: string
  /**
   * The same thing in two or three words, with no apostrophe in it.
   *
   * Not a style preference. `purgeFinalitySentence` is appended to
   * `HighRisk.reversibility`, which `DangerZone` renders into markup and
   * `DangerZone.test.tsx` asserts against that markup verbatim — React escapes
   * `'` to `&#x27;`, so a possessive here fails a test in another requirement's
   * file for a reason that has nothing to do with either requirement. The long
   * `what` keeps the apostrophes and is rendered as a React child, where the
   * escaping is invisible.
   */
  short: string
  /**
   * Whether Tenure still holds it after the purge.
   *
   * Always `false` for a purged tenant. If any input were `true` the tenant
   * would be partly recoverable from the platform, and the disclosure would be
   * a false statement rather than an incomplete one.
   */
  heldByPlatform: boolean
}

export interface PurgeFinality {
  state: TenantState
  content: ContentStanding
  /** The one sentence. Rendered on its own, so it has to stand on its own. */
  headline: string
  /** What building a tenant under this slug again would actually produce. */
  rebuild: string
  /** Empty while nothing has been destroyed; otherwise what an onboarding needs. */
  inputs: readonly RebuildInput[]
  /** What the Parent still holds, named from the tombstone's own field list. */
  parentRetains: string
}

/**
 * What an onboarding under this name would have to be given.
 *
 * Three inputs, each naming a real artifact or a real holder. None of them is
 * "restore from backup", because after a purge there is no backup to restore
 * from — expiring them is what GE-103-014 requires the purge to do.
 */
const INPUTS_AFTER_DESTRUCTION: readonly RebuildInput[] = [
  {
    what: "The tenant's configuration",
    short: "the configuration",

    from:
      "a portable bundle exported before the purge (`exportBundle`, lib/portability/bundle.ts), or the customer's own copy of one. It is not regenerated from anything this console holds.",
    heldByPlatform: false,
  },
  {
    what: "The customer's records — people, organizations, documents, finance and history",
    short: "the customer records",
    from:
      "the tenant export the customer took while the tenant still existed, or the customer's own systems. Tenure holds no copy after a purge.",
    heldByPlatform: false,
  },
  {
    what: "The directory the people come from",
    short: "the directory the people come from",
    from:
      "the customer's identity provider, which was always theirs. The tenant's own user pool is destroyed with everything else.",
    heldByPlatform: false,
  },
]

export function purgeFinality(state: TenantState): PurgeFinality | null {
  const parentRetains =
    `After a purge the Parent keeps one record — a tombstone carrying ${TOMBSTONE_FIELDS.join(", ")} — ` +
    `and nothing else. None of those five fields is customer content, which is what makes them safe to keep ` +
    `and useless for recovery.`

  if (state === "PURGE_PENDING") {
    return {
      state,
      content: "intact",
      headline:
        "Nothing has been destroyed yet. The content of this tenant still exists and this decision can still be taken back.",
      rebuild:
        "Moving away from PURGE_PENDING — to LEGAL_HOLD or back to OFFBOARDING — leaves the tenant whole. Once PURGING starts, that stops being true.",
      // Deliberately empty. Listing what a rebuild would need here would read as
      // advice about a rebuild that is not necessary.
      inputs: [],
      parentRetains,
    }
  }

  if (state === "PURGING") {
    return {
      state,
      content: "being-destroyed",
      headline:
        "Destruction has started. A half-purged tenant is not a tenant that can be brought back, so treat its content as already unrecoverable.",
      rebuild:
        "There is no state to return to. If this tenant is needed again it is a new onboarding under a new registration, not a resumption of this one.",
      inputs: INPUTS_AFTER_DESTRUCTION,
      parentRetains,
    }
  }

  if (state === "PURGED_ZERO_INCREMENTAL_COST") {
    return {
      state,
      content: "gone",
      headline:
        "This tenant has no recoverable content. Tenure holds nothing that can put it back — not a backup, not a snapshot, not an export.",
      rebuild:
        "A tenant under this slug again would be onboarded anew: a fresh registration with a fresh, empty system. It would carry the same name and none of the history.",
      inputs: INPUTS_AFTER_DESTRUCTION,
      parentRetains,
    }
  }

  return null
}

/**
 * The disclosure as one paragraph, for a surface that has room for a sentence
 * and not a panel.
 *
 * `riskOf` appends this to the reversibility line so the operator reads it
 * BEFORE the purge, which is the only moment at which knowing it can change
 * anything. The panel on the tenant page says it afterwards, which is when
 * somebody asks whether it can be got back.
 */
export function purgeFinalitySentence(state: TenantState): string {
  const finality = purgeFinality(state)
  if (!finality) return ""
  if (finality.inputs.length === 0) return finality.headline
  return `${finality.headline} ${finality.rebuild} It would need: ${finality.inputs
    .map((i) => i.short)
    .join("; ")} — each retained independently of Tenure.`
}
