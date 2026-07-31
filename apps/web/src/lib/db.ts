import { PrismaClient } from "@prisma/client"
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
 */

const basePrisma = () =>
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  })

const createClient = () => basePrisma().$extends(tenancyExtension())

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
