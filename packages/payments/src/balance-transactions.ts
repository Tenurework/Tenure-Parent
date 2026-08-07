/**
 * PAY-130-004 — ingesting provider balance transactions, with a replay guard
 * that can tell a retry from a conflict.
 *
 * The only replay machinery the platform had was OUTBOUND (src/lib/outbox).
 * Inbound had none: a provider redelivering a webhook batch, or an operator
 * re-running a day's reconciliation, had nothing to compare against, so the
 * choices were "insert it twice" or "drop anything whose id we have seen".
 *
 * Both are wrong, and the second is the one that looks right. An id seen before
 * is a retry ONLY if it carries the same content. A provider that corrects a
 * transaction reuses the id with a different amount, and an ingest that treats
 * that as an idempotent no-op silently keeps the superseded figure — the books
 * then disagree with the provider and nothing reports it. So this returns three
 * buckets, and `conflicting` is the one that matters: it is not an error the
 * ingest can resolve, it is a fact somebody has to look at.
 *
 * `ingest` is pure. It takes what is already stored and the batch, and returns
 * what to do — so the rule is testable without a database and the same rule
 * runs whether the batch came from a webhook, a nightly file or a backfill.
 */

import type { ProviderMode } from "./external-reference"

/** A balance transaction as it arrives, already qualified by its account. */
export interface BalanceTransactionInput {
  institutionId: string
  provider: string
  mode: ProviderMode
  /** The provider account it was billed to — `acct_…` under Connect. */
  providerAccountId: string
  externalId: string
  currency: string
  grossMinorUnits: number
  feeMinorUnits: number
  netMinorUnits: number
  occurredAt: string
  /**
   * A stable digest of the provider's payload.
   *
   * This is what separates a retry from a correction. It must be computed from
   * the CONTENT, not from the id — a digest of the id alone makes every
   * redelivery a retry, including the ones that changed.
   */
  payloadDigest: string
}

/** What is already stored, keyed the same way. */
export interface StoredBalanceTransaction {
  provider: string
  mode: ProviderMode
  providerAccountId: string
  externalId: string
  payloadDigest: string
}

export interface IngestConflict {
  transaction: BalanceTransactionInput
  storedDigest: string
  detail: string
}

export interface IngestOutcome {
  /** New to us. Write these. */
  inserted: BalanceTransactionInput[]
  /** Seen before, identical content. Write nothing; this is the retry case. */
  replayed: BalanceTransactionInput[]
  /**
   * Seen before with DIFFERENT content, or contradicting itself inside one
   * batch. Never written, always reported: an ingest that resolves this on its
   * own has picked which of two provider figures to believe.
   */
  conflicting: IngestConflict[]
}

/**
 * The key. All four parts, and dropping any one of them is a real defect:
 *
 *   - drop `mode` and `txn_1` in test replays over `txn_1` in live;
 *   - drop `providerAccountId` and two connected accounts collide;
 *   - drop `provider` and two providers that both count from 1 collide.
 *
 * The same tuple is the database's `@@unique` on ProviderBalanceTransaction, so
 * the in-memory decision and the constraint that ultimately enforces it cannot
 * disagree about what "the same transaction" means.
 */
export function balanceTransactionKey(
  txn: Pick<
    BalanceTransactionInput,
    "provider" | "mode" | "providerAccountId" | "externalId"
  >,
): string {
  return [txn.provider, txn.mode, txn.providerAccountId, txn.externalId].join("|")
}

/**
 * Decide what to do with a batch.
 *
 * `existingRefs` is what the store already holds — the caller reads it back for
 * the batch's keys rather than this module reaching for a database, so the same
 * function serves the webhook path and an offline backfill.
 *
 * Duplicates WITHIN one batch are handled the same way as duplicates against
 * the store: the first occurrence is inserted, an identical repeat is a replay,
 * and a differing repeat is a conflict. A batch that contradicts itself is
 * exactly as unresolvable as one that contradicts the store.
 */
export function ingest(
  existingRefs: readonly StoredBalanceTransaction[],
  batch: readonly BalanceTransactionInput[],
): IngestOutcome {
  const known = new Map<string, string>()
  for (const ref of existingRefs) known.set(balanceTransactionKey(ref), ref.payloadDigest)

  const outcome: IngestOutcome = { inserted: [], replayed: [], conflicting: [] }

  for (const txn of batch) {
    const key = balanceTransactionKey(txn)
    const storedDigest = known.get(key)

    if (storedDigest === undefined) {
      outcome.inserted.push(txn)
      // Record it so a second copy later in the same batch is compared against
      // this one rather than being inserted twice.
      known.set(key, txn.payloadDigest)
      continue
    }

    if (storedDigest === txn.payloadDigest) {
      outcome.replayed.push(txn)
      continue
    }

    outcome.conflicting.push({
      transaction: txn,
      storedDigest,
      detail:
        `${txn.provider} ${txn.mode} ${txn.providerAccountId} ${txn.externalId} was already ` +
        `ingested with a different payload. The same id carrying different content is a ` +
        `correction or a mis-keyed record, never a retry — accepting it as one keeps the ` +
        `superseded figure and reports nothing.`,
    })
  }

  return outcome
}
