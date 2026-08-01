import "server-only"

import type { DeploymentManifest, TenantManifest } from "@tenure/provisioning"

/**
 * Delivering a signed artifact to the cell that will apply it.
 *
 * A push, not a pull. A pull would mean each cell holding read access to the
 * engine's registry — a registry of every tenant — and handing a single-tenant
 * cell the list of all of them inverts the isolation the design rests on.
 *
 * The shared secret authenticates the caller; the artifact's digest
 * authenticates the content. Neither substitutes for the other: a stolen secret
 * still cannot make a cell apply an altered manifest, because the cell
 * recomputes the digest with its own implementation before touching a row.
 */

export type DeliveryOutcome =
  | { delivered: true; changes: string[]; detail: string }
  | { delivered: false; detail: string }

/** Where a placement's cell accepts deployments. */
function endpointFor(region: string): string | null {
  // One cell today, named by environment rather than hardcoded, so a second
  // region is configuration rather than a code change. Absent means undelivered
  // — which is reported, never silently treated as success.
  const configured = process.env.CELL_RECONCILE_URL
  if (!configured) return null
  return configured.replace("{region}", region)
}

export async function deliverToCell(
  deployment: DeploymentManifest,
  tenant: TenantManifest,
): Promise<DeliveryOutcome> {
  const url = endpointFor(tenant.region)
  const secret = process.env.PLATFORM_RECONCILE_SECRET

  if (!url || !secret) {
    return {
      delivered: false,
      detail:
        "No cell endpoint is configured for this engine (CELL_RECONCILE_URL / " +
        "PLATFORM_RECONCILE_SECRET), so the artifact is published and waiting rather than applied. " +
        "This is reported rather than passed over: a hand-off nobody received is not a hand-off.",
    }
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        manifest: deployment,
        displayName: tenant.displayName,
        initialAdminEmail: tenant.initialAdminEmail,
      }),
      // A cell that cannot answer in 20s is a cell in trouble; waiting longer
      // just moves the failure to the operator's patience.
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    return {
      delivered: false,
      detail: `The cell did not answer: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const body = (await response.json().catch(() => ({}))) as {
    changes?: string[]
    error?: string
    reason?: string
  }

  if (!response.ok) {
    // 422 means the cell verified and declined — a different thing from a
    // transport failure, and worth saying so in the evidence.
    const declined = response.status === 422
    return {
      delivered: false,
      detail: declined
        ? `The cell refused the artifact (${body.reason}): ${body.error}`
        : `The cell answered ${response.status}: ${body.error ?? "no detail"}`,
    }
  }

  const changes = body.changes ?? []
  return {
    delivered: true,
    changes,
    detail:
      changes.length > 0
        ? `Applied by the cell: ${changes.join("; ")}.`
        : "The cell already held this state; nothing changed. A retry is a success with nothing to do.",
  }
}
