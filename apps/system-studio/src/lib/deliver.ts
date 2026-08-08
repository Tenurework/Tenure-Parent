import "server-only"

import type { DeploymentManifest, SigningKey, TenantManifest } from "@tenure/provisioning"

/**
 * Delivering a deployment artifact to the cell that will apply it.
 *
 * A push, not a pull. A pull would mean each cell holding read access to the
 * engine's registry — a registry of every tenant — and handing a single-tenant
 * cell the list of all of them inverts the isolation the design rests on.
 *
 * ── Three things authenticate, and they are not the same thing ─────────────
 *
 *   the shared secret   authenticates the CALLER
 *   the digest          proves the CONTENT arrived unaltered
 *   the signature       proves WHO PRODUCED it
 *
 * This file used to open with "Delivering a signed artifact", which was false:
 * `packages/provisioning/src/execute.ts` said in as many words that nothing
 * signed, and the only thing establishing origin was the bearer token on the
 * endpoint — the transport, which is exactly what a self-verifying artifact is
 * supposed to remove the need for. STUDIO-070-009 made the sentence true rather
 * than deleting it, and `deliverToCell` now REFUSES to send an unsigned
 * manifest, mirroring `transition(_, "approved")` in `@tenure/releases`
 * refusing to approve an unsigned release.
 */

/**
 * The key deployment artifacts are signed with.
 *
 * Read from the environment, and null when it is not configured — the same
 * shape and the same two-variable convention `packages/platform-config/src/
 * build-system.ts:184` already uses for release signing, so an operator
 * configuring one already knows how to configure the other.
 *
 * Null is not a fallback to "unsigned is fine". It produces an unsigned
 * artifact, which `deliverToCell` then refuses, so an unconfigured engine fails
 * loudly at the hand-off instead of publishing something nothing can attribute.
 */
export function deploymentSigningKey(): SigningKey | null {
  const keyId = process.env.DEPLOYMENT_SIGNING_KEY_ID?.trim()
  const secret = process.env.DEPLOYMENT_SIGNING_SECRET?.trim()
  if (!keyId || !secret) return null
  return { keyId, secret }
}

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
  // STUDIO-070-009. Before the transport is even considered.
  //
  // An unsigned artifact is one whose origin nothing establishes: any party able
  // to POST to the cell can compute a matching digest over a body of their
  // choosing, so the digest proves the bytes and says nothing about who wrote
  // them. Sending it anyway would mean the cell's only defence is the bearer
  // token, which is the property the signature exists to stop relying on.
  //
  // Refused here rather than warned about, because a warning on a hand-off is a
  // warning nobody is reading at the time.
  if (!deployment.signature) {
    return {
      delivered: false,
      detail:
        `The artifact for "${tenant.slug}" is unsigned, so it was not delivered. Its digest ` +
        `establishes that it has not been altered and nothing about who produced it, and a cell ` +
        `applying that is trusting the transport. Set DEPLOYMENT_SIGNING_KEY_ID and ` +
        `DEPLOYMENT_SIGNING_SECRET on the Studio service and re-publish the artifact.`,
    }
  }

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
