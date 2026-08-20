import { canonicalJson, type AttributeCatalog, type CompiledPolicy, type EligibilityPolicy } from "./policy"
import { createHash } from "node:crypto"

/**
 * IER-070-009 — "Preserve past policy versions needed for historical
 * explanations."
 *
 * Bible §12.2: "Retain historical policy versions needed to explain past
 * decisions." §12.3 then asks four different audiences "why was this decided?"
 * about a decision that may be months old. Both sentences are about the same
 * failure: a decision receipt carries a policy digest, and a digest that
 * resolves to nothing is a receipt nobody can read. Worse, a digest silently
 * resolved to the CURRENT version is a receipt that reads perfectly and is
 * wrong — the explanation would describe rules that were not in force when the
 * door was closed.
 *
 * So this archive has exactly two properties, and they are the whole point:
 *
 *  1. **Registering a new version never disturbs an old one.** There is no
 *     replace and no delete. `versionsOf` grows; `byDigest` on a superseded
 *     version keeps returning the body that made those decisions.
 *  2. **An unknown digest returns `null`, never a guess.** "We looked and found
 *     nothing" and "we could not look" are different answers, and an
 *     explanation layer that cannot tell them apart will assert the current
 *     policy over a historical decision without noticing.
 *
 * ## Why the catalog is archived alongside, with its own digest
 *
 * `canonicalDigest` hashes the policy document. The catalog is a separate
 * object — it carries each attribute's accepted source roles, freshness bound
 * and derivation — and narrowing a catalog entry changes what a policy decides
 * without changing the policy's digest at all. Archiving the catalog under
 * `catalogDigest` is what makes "these were the rules" a complete claim rather
 * than half of one.
 *
 * ## No clock
 *
 * `register` takes `archivedAt` as an argument. A module that read the wall
 * clock would make the archive contents differ between two processes that
 * loaded the same code, which is the property the whole engine is built to
 * avoid, and it would make this file fail the purity guard for good reason.
 */

export interface ArchivedPolicyVersion {
  policyId: string
  version: string
  /** `sha256:…` over the canonical policy. The value a receipt carries. */
  digest: string
  /** `sha256:…` over the canonical catalog the policy compiled against. */
  catalogDigest: string
  policy: EligibilityPolicy
  catalog: AttributeCatalog
  approvedBy: string
  activeFrom: string
  expiresAt: string | null
  rollbackTo: string | null
  /** ISO instant supplied by the registrar. Never overwritten. */
  archivedAt: string
}

export function catalogDigestOf(catalog: AttributeCatalog): string {
  return `sha256:${createHash("sha256").update(canonicalJson(catalog)).digest("hex")}`
}

/**
 * An append-only store of compiled policy versions, keyed by digest.
 *
 * A class rather than module-level state so a test can hold its own instance
 * and so nothing in this repository can accidentally share a mutable registry
 * between two tenants' policy sets. The one shared instance below is for the
 * policies this deployment itself ships.
 */
export class PolicyArchive {
  private readonly byDigestIndex = new Map<string, ArchivedPolicyVersion>()
  private readonly byPolicyIndex = new Map<string, ArchivedPolicyVersion[]>()

  /**
   * Record a compiled version. Idempotent by digest.
   *
   * Re-registering the same digest returns the entry that is already there,
   * with its ORIGINAL `archivedAt` — the second registration is a restart, not
   * a new fact, and rewriting the timestamp would quietly erase when the
   * version was first put into force.
   */
  register(compiled: CompiledPolicy, archivedAt: string): ArchivedPolicyVersion {
    const existing = this.byDigestIndex.get(compiled.digest)
    if (existing) return existing

    const entry: ArchivedPolicyVersion = {
      policyId: compiled.policy.policyId,
      version: compiled.policy.version,
      digest: compiled.digest,
      catalogDigest: catalogDigestOf(compiled.catalog),
      policy: compiled.policy,
      catalog: compiled.catalog,
      approvedBy: compiled.policy.approvedBy,
      activeFrom: compiled.policy.activeFrom,
      expiresAt: compiled.policy.expiresAt,
      rollbackTo: compiled.policy.rollbackTo,
      archivedAt,
    }
    this.byDigestIndex.set(entry.digest, entry)
    const siblings = this.byPolicyIndex.get(entry.policyId) ?? []
    siblings.push(entry)
    this.byPolicyIndex.set(entry.policyId, siblings)
    return entry
  }

  /** The version a receipt was written under, or `null` when it was never archived. */
  byDigest(digest: string): ArchivedPolicyVersion | null {
    return this.byDigestIndex.get(digest) ?? null
  }

  /** Every archived version of one policy, oldest activation first. */
  versionsOf(policyId: string): readonly ArchivedPolicyVersion[] {
    const siblings = this.byPolicyIndex.get(policyId) ?? []
    return [...siblings].sort((a, b) => {
      const byActivation = Date.parse(a.activeFrom) - Date.parse(b.activeFrom)
      if (byActivation !== 0) return byActivation
      return a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0
    })
  }

  size(): number {
    return this.byDigestIndex.size
  }
}

/**
 * The archive for policies this deployment ships in code.
 *
 * Populated at module load by whichever module owns a policy — see
 * `tenant-entry.ts`. Registration at import means a policy this build can
 * decide with is a policy this build can explain, with no step in between for
 * anybody to forget.
 */
export const SHIPPED_POLICY_ARCHIVE = new PolicyArchive()
