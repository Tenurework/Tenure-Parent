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
 */

export {
  AuditRecordError,
  REDACTED,
  buildAuditRecord,
  redactMetadata,
} from "./record"
export type {
  AuditActor,
  AuditOutcome,
  AuditRecord,
  AuditRecordInput,
  FieldSensitivity,
} from "./record"
