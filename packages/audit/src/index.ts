/**
 * @tenure/audit — an audit record that cannot be built wrong.
 *
 * The application writes good audit rows from 33 places; what was missing is
 * anything that makes them good. Each call site assembles the object itself, so
 * a forgotten `outcome` is a runtime discovery and a metadata blob carrying a
 * token is nobody's job to notice.
 *
 *   const record = buildAuditRecord({
 *     tenantId, actor: { principalId, role, impersonatedBy },
 *     action: "Admin.role.assign", resourceType: "RoleAssignment",
 *     outcome: "DENY", reason: "NO_ROLE_GRANTING",
 *     metadata: { targetEmail, sessionToken: "…" },   // redacted by rule
 *     occurredAt,
 *   })
 *
 * Refusing to build is the point. A write that cannot be attributed is worse
 * than no write: it occupies a row that looks like evidence and is not.
 *
 * The read side is the other half, and until now it did not exist. Every record
 * carries a `recordHash`, and a writer that supplies `previous` chains them, so
 * the log can be checked rather than trusted:
 *
 *   const result = verifyChain(records)        // altered content, broken
 *   result.tampered                            // links, gaps, duplicates
 *
 *   projectForQuery(records, { sensitivity })  // export, re-redacted on read
 *   applyRetention(records, { retainDays, asOf }, holds)
 *
 * `applyRetention` plans a deletion; it never performs one. A record under an
 * active legal hold is never in `expire`, and expiry stops at the first record
 * that must be kept, because cutting a hole in a hash chain is indistinguishable
 * from someone removing the record that mattered.
 */

export {
  AuditRecordError,
  CHAIN_METADATA_KEYS,
  REDACTED,
  buildAuditRecord,
  hashRecord,
  redactMetadata,
} from "./record"
export type {
  AuditActor,
  AuditOutcome,
  AuditRecord,
  AuditRecordInput,
  FieldSensitivity,
  HashableRecord,
} from "./record"

export { projectForQuery, verifyChain } from "./verify"
export type {
  AuditProjection,
  ChainBreak,
  ChainDuplicate,
  ChainGap,
  ChainVerification,
  ProjectionOptions,
} from "./verify"

export { RetentionError, applyRetention } from "./retention"
export type {
  HeldRecord,
  LegalHold,
  RetentionAnchor,
  RetentionPlan,
  RetentionPolicy,
} from "./retention"
