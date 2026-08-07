import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import { stableStringify } from "@tenure/configuration"

/**
 * An immutable, citable statement of what one organization system *is*.
 *
 * The problem it solves: a running system is currently the sum of a blueprint,
 * a set of enabled modules, a resolved configuration, an org topology and a set
 * of policies — five things that can each change independently, with nothing
 * recording which combination was live when a workflow ran, an approval was
 * decided, or an audit record was written.
 *
 * A release is that combination, frozen and hashed. Everything downstream cites
 * a release id instead of "whatever was configured at the time", and rollback
 * becomes "publish the previous artifact again" rather than an attempt to
 * reverse five independent edits in the right order.
 *
 * Deliberately not a deployment. A release says what a system is; deploying it
 * is a separate act with its own gates. Conflating them is how a configuration
 * mistake becomes an outage instead of a rejected candidate.
 */

export type ReleaseState =
  | "draft"
  | "validated"
  | "approved"
  | "scheduled"
  | "canary"
  | "active"
  | "superseded"
  | "rolled-back"
  | "rejected"

/**
 * Legal transitions. Anything absent is refused, with both states named.
 *
 * `active` is reachable only through `canary`, and `canary` only through
 * `scheduled`. Approval says a release *may* go out; it does not say it went out
 * to everyone at once. Before this, `approved → active` meant every tenant on
 * the release took the change simultaneously, so the first evidence that a
 * release was bad was the whole fleet having it — which is the same reason
 * rollback exists and the reason it should rarely be needed.
 */
export const TRANSITIONS: Readonly<Record<ReleaseState, readonly ReleaseState[]>> = {
  draft: ["validated", "rejected"],
  validated: ["approved", "rejected", "draft"],
  approved: ["scheduled", "rejected"],
  scheduled: ["canary", "rejected"],
  canary: ["active", "rejected"],
  active: ["superseded", "rolled-back"],
  superseded: [],
  "rolled-back": [],
  rejected: [],
}

export interface ModulePin {
  key: string
  version: string
  /**
   * What the module's lifecycle was WHEN IT WAS PINNED.
   *
   * A release is a frozen statement of what a system is, and until this existed
   * it could not say that a module it shipped was deprecated at the time —
   * `{key, version}` was the whole pin, so "was this tenant knowingly put onto a
   * deprecated module?" had no answer six months later. `validateSystem` also
   * refuses a release that pins a `retired` one, which is the case a version
   * number alone cannot express.
   *
   * Optional so an artifact written before this stays readable; supplied by
   * every producer in the tree (`packages/platform-config/src/build-system.ts`).
   */
  lifecycle?: string
  /** The capability mode it was in when pinned — Bible §11. */
  mode?: string
}

/**
 * Who produced this artifact, provable without trusting whoever delivered it.
 *
 * A checksum proves the bytes are internally consistent. It does not prove
 * anyone in particular produced them: anyone able to alter the artifact can
 * recompute the checksum over their alteration and it will verify. Adoption
 * binds exact versions through a *signed* manifest for that reason — the same
 * reason the package catalog refuses a version whose `signatureRef` is null.
 *
 * HMAC rather than a public-key signature because both ends of this are Tenure:
 * the engine signs and the engine verifies, so there is no third party who
 * needs to check without holding the key. When there is, this gains an
 * `algorithm` value and `verifyRelease` gains a branch; the shape does not
 * change.
 */
export interface ReleaseSignature {
  /** Which key signed. Present so a key can be rotated without invalidating history. */
  readonly keyId: string
  readonly algorithm: "hmac-sha256"
  /** Hex MAC over exactly the bytes the checksum covers. */
  readonly value: string
}

export interface ReleaseInput {
  tenantId: string
  blueprintId: string
  blueprintVersion: string
  topologyId: string
  topologyVersion: string
  /** Enabled modules, pinned to the versions this release ships. */
  modules: readonly ModulePin[]
  /** Checksum of the resolved configuration — see @tenure/configuration. */
  configurationChecksum: string
  /** Ids of the policies in force. */
  policyIds: readonly string[]
  /**
   * The database shape this system runs on: the latest applied migration.
   *
   * Inside the checksum, not attached beside it. Two releases whose modules,
   * configuration and policies are identical but which run against different
   * migration states are not the same system — one of them has a column the
   * other does not — and until this was covered, they hashed identically and
   * `diffReleases` could not show an approver that the schema had moved.
   */
  schemaVersion: string
  notes: string
  createdBy: string
  /** Supplied, never read from a clock, so an artifact is reproducible in a test. */
  createdAt: string
  /** The currently active release for this tenant, if any. */
  previous?: SystemRelease | null
}

export interface SystemRelease {
  readonly releaseId: string
  readonly tenantId: string
  readonly revision: number
  readonly state: ReleaseState

  readonly blueprintId: string
  readonly blueprintVersion: string
  readonly topologyId: string
  readonly topologyVersion: string
  readonly modules: readonly ModulePin[]
  readonly configurationChecksum: string
  readonly policyIds: readonly string[]
  /** The migration this system's database is expected to be at. */
  readonly schemaVersion: string

  /** Content hash of everything above. Two identical systems hash identically. */
  readonly checksum: string

  /**
   * Present once `signRelease` has run. Absent means unsigned, and `transition`
   * refuses to approve an unsigned release — the gate lives in the state machine
   * rather than in a caller that can forget it.
   */
  readonly signature?: ReleaseSignature

  readonly notes: string
  readonly createdBy: string
  readonly createdAt: string
  readonly approvedBy?: string
  readonly approvedAt?: string

  /** The revision this replaced. */
  readonly supersedes: number | null
  /** For a rolled-back release, the revision restored. */
  readonly rolledBackTo?: number
}

export class ReleaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReleaseError"
  }
}

/**
 * Everything a release is, minus how it got there.
 *
 * Satisfied by both `ReleaseInput` and `SystemRelease`, so the checksum and the
 * signature are computed over one definition of "the content" rather than two
 * that could drift — a signature covering different bytes than the checksum
 * would verify artifacts the checksum rejects, and vice versa.
 */
export interface ReleaseContent {
  tenantId: string
  blueprintId: string
  blueprintVersion: string
  topologyId: string
  topologyVersion: string
  modules: readonly ModulePin[]
  configurationChecksum: string
  policyIds: readonly string[]
  schemaVersion: string
}

/** The content a release's checksum covers. Order-independent by construction. */
function contentOf(input: ReleaseContent) {
  return {
    tenantId: input.tenantId,
    blueprintId: input.blueprintId,
    blueprintVersion: input.blueprintVersion,
    topologyId: input.topologyId,
    topologyVersion: input.topologyVersion,
    // Sorted, so the same system assembled in a different order hashes the same.
    modules: [...input.modules]
      // Lifecycle and mode are part of the content, not metadata beside it: two
      // releases pinning the same versions of the same modules are NOT the same
      // system if one of those modules was deprecated in between. Omitted when
      // absent so an artifact that never carried them hashes as it always did.
      .map((m) => ({
        key: m.key,
        version: m.version,
        ...(m.lifecycle ? { lifecycle: m.lifecycle } : {}),
        ...(m.mode ? { mode: m.mode } : {}),
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    configurationChecksum: input.configurationChecksum,
    policyIds: [...input.policyIds].sort(),
    schemaVersion: input.schemaVersion,
  }
}

/** The exact bytes both the checksum and the signature are taken over. */
function contentBytes(input: ReleaseContent): string {
  return stableStringify(contentOf(input))
}

export function checksumOfRelease(input: ReleaseContent): string {
  return `sha256:${createHash("sha256").update(contentBytes(input)).digest("hex")}`
}

export interface SigningKey {
  keyId: string
  /** Never stored on the artifact, never logged. Only its MAC is published. */
  secret: string
}

/**
 * Sign a release.
 *
 * Returns a new frozen artifact rather than mutating: a reference already held
 * elsewhere keeps meaning what it meant, which is the property every other
 * function here preserves.
 *
 * The MAC covers `contentBytes`, the same bytes the checksum covers, so a
 * signature can never end up attesting to a different system than the checksum
 * names. Changing what `contentOf` includes changes both at once.
 */
export function signRelease(release: SystemRelease, key: SigningKey): SystemRelease {
  if (!key.keyId) throw new ReleaseError("A signature must name the key that produced it.")
  if (!key.secret) {
    throw new ReleaseError(
      "Refusing to sign with an empty key. A signature anyone can reproduce proves nothing, " +
        "and would be worse than being visibly unsigned.",
    )
  }

  const value = createHmac("sha256", key.secret).update(contentBytes(release)).digest("hex")

  return Object.freeze({
    ...release,
    signature: Object.freeze({ keyId: key.keyId, algorithm: "hmac-sha256" as const, value }),
  })
}

export type ReleaseVerification =
  | { valid: true; keyId: string }
  | { valid: false; reason: "unsigned" | "unknown-key" | "content-altered"; detail: string }

/**
 * Check a release's signature against the key that claims to have produced it.
 *
 * `resolveKey` is supplied rather than a key: this package must not hold a
 * secret store, and rotation means the key that signed r3 is not necessarily the
 * one signing r7. Fails closed at every branch — an unresolvable key id is not
 * "no requirement", it is a release nobody can attribute.
 */
export function verifyRelease(
  release: SystemRelease,
  resolveKey: (keyId: string) => string | undefined,
): ReleaseVerification {
  const signature = release.signature
  if (!signature) {
    return {
      valid: false,
      reason: "unsigned",
      detail: `Release ${release.releaseId} carries no signature.`,
    }
  }

  const secret = resolveKey(signature.keyId)
  if (!secret) {
    return {
      valid: false,
      reason: "unknown-key",
      detail: `Release ${release.releaseId} is signed by "${signature.keyId}", which this engine cannot resolve.`,
    }
  }

  const expected = createHmac("sha256", secret).update(contentBytes(release)).digest("hex")
  const a = Buffer.from(expected, "hex")
  const b = Buffer.from(signature.value, "hex")
  // Length-checked first: timingSafeEqual throws on a mismatch, and a thrown
  // error is a verification that neither passed nor failed.
  const ok = a.length === b.length && a.length > 0 && timingSafeEqual(a, b)

  if (!ok) {
    return {
      valid: false,
      reason: "content-altered",
      detail:
        `Release ${release.releaseId} does not verify under key "${signature.keyId}". ` +
        `Either the content changed after signing or the signature is not this engine's.`,
    }
  }

  return { valid: true, keyId: signature.keyId }
}

/**
 * Create a release candidate. Always starts as a draft.
 *
 * Refuses a candidate identical to the active release: publishing one would
 * create a revision that changed nothing, so "which release introduced this?"
 * stops having a single answer.
 */
export function createRelease(input: ReleaseInput): SystemRelease {
  if (!input.tenantId) throw new ReleaseError("A release must name a tenant.")
  if (!input.createdBy) throw new ReleaseError("A release must name who created it.")
  if (!input.notes.trim()) {
    throw new ReleaseError(
      "A release needs notes. The diff shows what changed; only the notes say why.",
    )
  }
  if (input.modules.length === 0) {
    throw new ReleaseError("A release with no modules would produce a system that does nothing.")
  }
  if (!input.configurationChecksum.startsWith("sha256:")) {
    throw new ReleaseError(
      `configurationChecksum must be a resolved configuration's checksum, got ` +
        `${JSON.stringify(input.configurationChecksum)}.`,
    )
  }
  if (!input.schemaVersion.trim()) {
    throw new ReleaseError(
      "A release must pin the schema it runs on. Without it, two artifacts with the same " +
        "checksum can run against different migration states and nothing can tell them apart.",
    )
  }

  const previous = input.previous ?? null
  if (previous && previous.tenantId !== input.tenantId) {
    throw new ReleaseError(
      `Previous release belongs to tenant "${previous.tenantId}", not "${input.tenantId}".`,
    )
  }

  const checksum = checksumOfRelease(input)
  if (previous && previous.checksum === checksum && previous.state === "active") {
    throw new ReleaseError(
      `Nothing changed: the active release r${previous.revision} already has checksum ${checksum}.`,
    )
  }

  const revision = (previous?.revision ?? 0) + 1

  return Object.freeze({
    releaseId: `${input.tenantId}@r${revision}`,
    tenantId: input.tenantId,
    revision,
    state: "draft" as const,
    blueprintId: input.blueprintId,
    blueprintVersion: input.blueprintVersion,
    topologyId: input.topologyId,
    topologyVersion: input.topologyVersion,
    modules: Object.freeze([...input.modules].map((m) => Object.freeze({ ...m }))),
    configurationChecksum: input.configurationChecksum,
    policyIds: Object.freeze([...input.policyIds]),
    schemaVersion: input.schemaVersion,
    checksum,
    notes: input.notes,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    supersedes: previous?.revision ?? null,
  })
}

/**
 * Move a release to another state, or refuse.
 *
 * Every transition returns a new frozen object. Nothing mutates, so a reference
 * held elsewhere — in a workflow instance, an audit row — keeps meaning what it
 * meant when it was taken.
 */
export function transition(
  release: SystemRelease,
  to: ReleaseState,
  by?: { actor: string; at: string },
): SystemRelease {
  const allowed = TRANSITIONS[release.state]
  if (!allowed.includes(to)) {
    throw new ReleaseError(
      `Cannot move release ${release.releaseId} from "${release.state}" to "${to}". ` +
        `Legal from "${release.state}": ${allowed.length ? allowed.join(", ") : "(terminal)"}.`,
    )
  }

  if (to === "approved") {
    if (!by?.actor) {
      throw new ReleaseError("Approving a release requires an approver; that is the point of the gate.")
    }
    // The gate is here rather than in whoever calls this, because a gate in a
    // caller is a gate the next caller does not have. Adoption binds exact
    // versions through a SIGNED manifest: approving an unsigned artifact would
    // approve bytes nobody can be held to.
    if (!release.signature) {
      throw new ReleaseError(
        `Release ${release.releaseId} is unsigned and cannot be approved. Its checksum proves ` +
          `the content is internally consistent, not who produced it — and adoption binds exact ` +
          `versions through a signed release manifest. Call signRelease first.`,
      )
    }
    if (by.actor === release.createdBy) {
      // The same separation of duties the approval module enforces for spend.
      throw new ReleaseError(
        `${by.actor} created this release and cannot also approve it. ` +
          `A release that only one person has seen has not been reviewed.`,
      )
    }
    return Object.freeze({ ...release, state: to, approvedBy: by.actor, approvedAt: by.at })
  }

  return Object.freeze({ ...release, state: to })
}

/**
 * Roll back to an earlier release.
 *
 * Produces a NEW release carrying the old content, rather than reactivating the
 * old artifact. Reactivating would make revision numbers non-monotonic and make
 * "what was live at 14:05?" ambiguous — two periods with the same revision. The
 * history stays append-only, which is the only way it can be trusted.
 */
export function rollbackTo(
  active: SystemRelease,
  target: SystemRelease,
  by: { actor: string; at: string; notes: string },
): { rolledBack: SystemRelease; restored: SystemRelease } {
  if (active.tenantId !== target.tenantId) {
    throw new ReleaseError(`Cannot roll back across tenants.`)
  }
  if (active.state !== "active") {
    throw new ReleaseError(`Only an active release can be rolled back; this one is "${active.state}".`)
  }
  if (target.revision >= active.revision) {
    throw new ReleaseError(
      `Rollback target r${target.revision} is not earlier than the active r${active.revision}.`,
    )
  }

  const rolledBack = Object.freeze({
    ...transition(active, "rolled-back"),
    rolledBackTo: target.revision,
  })

  const restored = createRelease({
    tenantId: target.tenantId,
    blueprintId: target.blueprintId,
    blueprintVersion: target.blueprintVersion,
    topologyId: target.topologyId,
    topologyVersion: target.topologyVersion,
    modules: target.modules,
    configurationChecksum: target.configurationChecksum,
    policyIds: target.policyIds,
    // Carried, not recomputed. A rollback that silently retargeted the schema
    // would restore the old configuration onto a new database shape, which is
    // the one combination nobody validated.
    schemaVersion: target.schemaVersion,
    notes: by.notes,
    createdBy: by.actor,
    createdAt: by.at,
    previous: rolledBack,
  })

  // The restored release must be byte-identical in content to its target — that
  // is what "rollback" means, and asserting it here beats discovering later that
  // a field was dropped in the copy.
  if (restored.checksum !== target.checksum) {
    throw new ReleaseError(
      `Rollback produced content differing from r${target.revision}. ` +
        `Expected ${target.checksum}, got ${restored.checksum}.`,
    )
  }

  return { rolledBack, restored }
}

export interface ReleaseDiffEntry {
  field: string
  change: "added" | "removed" | "changed"
  before?: unknown
  after?: unknown
}

/** What changed between two releases. What an approver reads before saying yes. */
export function diffReleases(before: SystemRelease, after: SystemRelease): ReleaseDiffEntry[] {
  const out: ReleaseDiffEntry[] = []

  const scalar = (field: keyof SystemRelease) => {
    if (before[field] !== after[field]) {
      out.push({ field, change: "changed", before: before[field], after: after[field] })
    }
  }

  scalar("blueprintId")
  scalar("blueprintVersion")
  scalar("topologyId")
  scalar("topologyVersion")
  scalar("configurationChecksum")
  scalar("schemaVersion")

  const beforeModules = new Map(before.modules.map((m) => [m.key, m.version]))
  const afterModules = new Map(after.modules.map((m) => [m.key, m.version]))

  for (const key of [...new Set([...beforeModules.keys(), ...afterModules.keys()])].sort()) {
    const b = beforeModules.get(key)
    const a = afterModules.get(key)
    if (b === a) continue
    if (b === undefined) out.push({ field: `modules.${key}`, change: "added", after: a })
    else if (a === undefined) out.push({ field: `modules.${key}`, change: "removed", before: b })
    else out.push({ field: `modules.${key}`, change: "changed", before: b, after: a })
  }

  const beforePolicies = new Set(before.policyIds)
  const afterPolicies = new Set(after.policyIds)
  for (const id of [...new Set([...beforePolicies, ...afterPolicies])].sort()) {
    if (beforePolicies.has(id) && !afterPolicies.has(id)) {
      out.push({ field: `policies.${id}`, change: "removed", before: id })
    } else if (!beforePolicies.has(id) && afterPolicies.has(id)) {
      out.push({ field: `policies.${id}`, change: "added", after: id })
    }
  }

  return out
}

/**
 * Changes that remove capability from a running system.
 *
 * Surfaced separately because they are the ones that break a tenant rather than
 * merely change it: a module removed takes its routes and its data surfaces with
 * it, and a policy removed silently widens who can do what.
 *
 * A module whose pin moves *backwards* belongs here too, and did not used to.
 * Only removals were flagged, so `budgeting 2.0.0 → 1.0.0` read as an ordinary
 * "changed" line an approver would scroll past — while it takes away every
 * capability 2.0.0 added, exactly like removing the module, and leaves data
 * written by the newer code behind.
 *
 * `compare` is required rather than optional. The comparator lives in
 * `@tenure/platform-config` (one copy, so nothing can disagree about whether
 * 1.10.0 is newer than 1.9.0) and this package imports nothing, so it has to be
 * passed in — and defaulting it would mean a caller that forgot silently got no
 * downgrade detection, which is the failure this exists to end.
 */
export function breakingChanges(
  diff: readonly ReleaseDiffEntry[],
  compare: (a: string, b: string) => number,
): ReleaseDiffEntry[] {
  /** Fails closed: a version pair nothing can order is treated as breaking. */
  const movedBackwards = (before: unknown, after: unknown): boolean => {
    if (typeof before !== "string" || typeof after !== "string") return true
    try {
      return compare(before, after) > 0
    } catch {
      return true
    }
  }

  return diff.filter((d) => {
    if (d.change === "removed") {
      return d.field.startsWith("modules.") || d.field.startsWith("policies.")
    }
    if (d.change !== "changed") return false
    if (d.field === "topologyId") return true
    if (d.field.startsWith("modules.")) return movedBackwards(d.before, d.after)
    if (d.field === "schemaVersion") {
      // Compared as strings on purpose: a schema version is a Prisma migration
      // directory, and those are timestamp-prefixed, so lexicographic order IS
      // chronological order. Running the semver comparator over
      // `20260806180000_activation_gates_serving` would throw.
      return typeof d.before === "string" && typeof d.after === "string" && d.after < d.before
    }
    return false
  })
}
