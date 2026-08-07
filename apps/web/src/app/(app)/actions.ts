"use server"

import { revalidatePath } from "next/cache"
import { auth, signOut } from "@/lib/auth"
import { chooseActingInstitution, resolveTenantScope } from "@/lib/tenant-scope"

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" })
}

/**
 * Act in a different institution from now on.
 *
 * A server action rather than a route handler because it is a state change made
 * from a control in the shell, and because Next.js only permits cookie writes
 * from an action or a handler — a GET must not be able to move a user between
 * tenants.
 *
 * Three things have to be true and each is checked here or immediately below:
 *
 *   1. there is a session — a layout guard does NOT cover a server action, and
 *      this one is a POST endpoint reachable by anyone who can guess its id;
 *   2. the institution is one of *this* user's, proved by `resolveTenantScope`,
 *      which throws `TenantContextError` when it is not;
 *   3. every later request re-proves (2) rather than trusting the cookie —
 *      `actingInstitutionChoice` does that, and it, not this action, is what
 *      stands between a forged cookie and another tenant's rows.
 *
 * `revalidatePath("/", "layout")` because the acting institution decides the
 * enabled modules, the navigation, the branding and the contents of every
 * cached page — after a switch, nothing rendered for the previous tenant is
 * still true.
 */
export async function switchTenantAction(institutionId: string): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error("Not signed in.")
  }

  // Validated against this user's own memberships. A caller-supplied
  // institution is a request, not a fact.
  const scope = await resolveTenantScope(session.user.id, institutionId, "interactive")
  await chooseActingInstitution(session.user.id, scope.institutionId)

  revalidatePath("/", "layout")
}
