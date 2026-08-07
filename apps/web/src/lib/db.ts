import { PrismaClient } from "@prisma/client"
import { auditAppendOnlyExtension } from "@/lib/audit-append-only"
import { tenancyExtension } from "@/lib/tenancy/extension"

/**
 * Every query in the application goes through this client, which is why the
 * tenancy extension is attached here rather than offered as an opt-in: an
 * isolation control that a caller can decline to use is a suggestion.
 *
 * It currently runs in observe mode (see extension.ts) — it applies the tenant
 * filter wherever a scope is open, and records where none is, without refusing.
 * Enforcement is switched on with TENANCY_ENFORCE=true once the recording is
 * empty. The tests build their own enforcing client, so the rule itself is
 * verified under enforcement today.
 *
 * The append-only extension attached alongside it has no such staging: it
 * refuses every mutation of `AuditEvent` from the first commit, because no
 * product code has ever performed one. See audit-append-only.ts for what that
 * does and does not cover.
 */

const basePrisma = (datasourceUrl?: string) =>
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    // Omitted entirely rather than passed as `undefined`, so the default
    // resolution from `DATABASE_URL` is untouched for every existing caller.
    ...(datasourceUrl ? { datasourceUrl } : {}),
  })

/**
 * Order is deliberate, and verified in audit-append-only.test.ts rather than
 * assumed: Prisma runs query extensions in the order they are attached, so the
 * first one attached is the outermost. Append-only goes first so an attempt to
 * erase the audit trail is refused outright, rather than being carefully scoped
 * to the right tenant on the way to being refused — which would also file it in
 * the tenancy coverage report as an ordinary uncovered call site for someone to
 * "fix" by opening a scope. Either order refuses; this one refuses without
 * pretending the request was ordinary.
 */
const createClient = (datasourceUrl?: string) =>
  basePrisma(datasourceUrl).$extends(auditAppendOnlyExtension()).$extends(tenancyExtension())

// Extended clients are a distinct type from PrismaClient, so the cache has to
// be typed off the factory rather than off PrismaClient itself.
type ExtendedClient = ReturnType<typeof createClient>

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedClient | undefined
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db

/**
 * The client handed to a `$transaction` callback.
 *
 * `Prisma.TransactionClient` describes the *unextended* client and no longer
 * matches once an extension is attached, so it is derived from `db` instead —
 * which also means it keeps matching if further extensions are added. The
 * omitted members are the ones Prisma withholds inside a transaction.
 */
export type TxClient = Omit<
  typeof db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>
