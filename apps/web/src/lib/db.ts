import { PrismaClient } from "@prisma/client"
import { auditAppendOnlyExtension } from "@/lib/audit-append-only"
import { isNextNavigationThrow, TenantContextError } from "@/lib/tenancy/context"
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

/**
 * REVIEW-FINDINGS #16. A Next.js navigation throw must not escape a transaction.
 *
 * `redirect()` and `notFound()` do not return — they throw an Error carrying a
 * `digest`, and Prisma's interactive transaction treats any throw out of its
 * callback as "roll back". So
 *
 *     await db.$transaction(async (tx) => {
 *       const c = await tx.conversation.create({ ... })
 *       await tx.message.create({ ... })
 *       redirect(`/messages/${c.id}`)
 *     })
 *
 * writes nothing and navigates anyway: Next catches the digest at the request
 * boundary, answers 307, and the user lands on a conversation that was rolled
 * back a millisecond earlier. Nothing downstream can detect it — the request
 * succeeded, and the audit row that would have recorded the write was inside the
 * same transaction.
 *
 * This does NOT save the write; by the time the throw is visible here Prisma has
 * already aborted. What it does is make the failure loud instead of silent — a
 * `TenantContextError` and a 500, rather than a success page over missing rows.
 * A 500 the on-call engineer sees beats a 200 nobody ever will.
 *
 * Attached here rather than offered as a `withTenantTransaction()` helper for
 * the reason the tenancy extension is attached here: an opt-in control is one
 * every new call site can decline, and the thirty existing `db.$transaction`
 * call sites would each have had to be edited to gain it. This covers all of
 * them, and every future one, without anybody having to know it exists.
 *
 * `notFound()` is refused here although `runInTenantScope` deliberately permits
 * it — see `isNextNavigationThrow` for why the two boundaries answer differently.
 */
function guardedTransaction(
  original: (...args: never[]) => unknown,
  client: ExtendedClient,
): (...args: never[]) => unknown {
  return (...args: never[]) => {
    const rethrow = (err: unknown): never => {
      if (!isNextNavigationThrow(err)) throw err
      throw new TenantContextError(
        `A Next.js navigation (${String((err as { digest?: unknown }).digest)}) was thrown out of ` +
          `a db.$transaction callback. redirect() and notFound() are throws, so the transaction ` +
          `has been rolled back — every write in that callback is gone, while the browser would ` +
          `otherwise have followed the navigation and reported success. Return what the ` +
          `navigation needs from the transaction and navigate after it commits: ` +
          `const row = await db.$transaction(async (tx) => { ...; return created }); ` +
          `redirect(\`/x/\${row.id}\`). The lexical half of this rule is ` +
          `tests/architecture/navigation-outside-tenant-scope.test.mjs.`,
      )
    }

    // Both halves are needed. The array form settles synchronously into a
    // promise; the callback form can throw before it ever returns one, and a
    // guard that only attached `.catch` would miss that case entirely.
    let result: unknown
    try {
      result = (original as (...a: never[]) => unknown).apply(client, args)
    } catch (err) {
      return rethrow(err)
    }
    const thenable = result as { then?: unknown } | null | undefined
    if (typeof thenable?.then !== "function") return result
    return (result as Promise<unknown>).then(undefined, rethrow)
  }
}

/**
 * The client, with `$transaction` wrapped and everything else untouched.
 *
 * A `Proxy` rather than an assignment because Prisma's client is itself a proxy
 * whose model delegates are produced by its own `get` trap — reassigning a
 * method on it is not something the library supports. One property is
 * intercepted; every other access, including `db.user`, `db.$queryRaw` and the
 * extension chain, is forwarded unchanged.
 */
const withTransactionGuard = (client: ExtendedClient): ExtendedClient => {
  const original = Reflect.get(client, "$transaction") as (...args: never[]) => unknown
  const guarded = guardedTransaction(original, client)
  return new Proxy(client, {
    get: (target, prop, receiver) =>
      prop === "$transaction" ? guarded : Reflect.get(target, prop, receiver),
  }) as ExtendedClient
}

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedClient | undefined
}

export const db = globalForPrisma.prisma ?? withTransactionGuard(createClient())

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
