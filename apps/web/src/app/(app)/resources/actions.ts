"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import {
  createResource,
  resourceInstitutionFor,
  setResourceArchived,
  updateResource,
  type ResourceInput,
} from "@/lib/resources-data"
import { isSeatKey, RESOURCE_KINDS, type ResourceKind, type SeatKey } from "@/lib/resources"

/**
 * Board-resource authoring. Every action re-resolves the caller's institution
 * and permission server-side — the form never carries the institution id, so a
 * crafted submission cannot publish onto someone else's board.
 */

function readInput(formData: FormData): ResourceInput {
  const kindRaw = String(formData.get("kind") ?? "")
  const kind: ResourceKind = (RESOURCE_KINDS as string[]).includes(kindRaw)
    ? (kindRaw as ResourceKind)
    : "GUIDE"

  const seats = formData
    .getAll("seats")
    .map(String)
    .filter(isSeatKey) as SeatKey[]

  return {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    href: String(formData.get("href") ?? ""),
    kind,
    seats,
    rule: String(formData.get("rule") ?? "") || null,
    ready: formData.get("ready") !== "off",
  }
}

/** Returned to the client form so a validation failure keeps what was typed. */
export type ResourceFormState = { error?: string; ok?: boolean }

export async function publishResource(
  _prev: ResourceFormState,
  formData: FormData
): Promise<ResourceFormState> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Not signed in." }
  const userId = session.user.id

  // The form state comes back out of the scope and the caches are bumped after
  // it closes. A validation failure returns `{ error }` and revalidates nothing.
  const state = await withTenantScope(userId, async (): Promise<ResourceFormState> => {
    const ctx = await getUserContext(userId)
    const institutionId = await resourceInstitutionFor(ctx)
    if (!institutionId) return { error: "You are not attached to an institution." }

    const id = String(formData.get("id") ?? "")
    const input = readInput(formData)
    const result = id
      ? await updateResource(userId, id, input)
      : await createResource(userId, institutionId, input)

    if ("error" in result) return { error: result.error }

    return { ok: true }
  })

  if (state.ok) {
    revalidatePath("/resources")
    revalidatePath("/dashboard")
  }
  return state
}

export async function retireResource(formData: FormData): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  const userId = session.user.id

  await withTenantScope(userId, async () => {
    const id = String(formData.get("id") ?? "")
    const archived = formData.get("archived") === "1"
    const result = await setResourceArchived(userId, id, archived)
    if ("error" in result) throw new Error(result.error)
  })

  revalidatePath("/resources")
  revalidatePath("/dashboard")
}
