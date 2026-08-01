import { createHash, timingSafeEqual } from "node:crypto"

import { db } from "@/lib/db"
import { runUnscoped } from "@/lib/tenancy/context"
import {
  ReconcileRefused,
  reconcile,
  type DeploymentManifest,
} from "@/lib/provisioning/reconcile"

export const dynamic = "force-dynamic"

/**
 * Where a signed deployment manifest arrives.
 *
 * The engine composes and signs; this cell verifies and applies. The transport
 * between them is a push rather than a pull, deliberately:
 *
 *   * a pull would mean this cell holding read access to the engine's registry,
 *     which is a registry of EVERY tenant. A cell serves one of them, and
 *     handing it a key to the list of all of them inverts the isolation the
 *     whole design rests on.
 *   * a push means the cell's only inbound dependency is this endpoint, and the
 *     artifact it receives is self-verifying — the digest covers every field, so
 *     the cell trusts the artifact rather than whoever delivered it.
 *
 * The shared secret authenticates the *caller*; the digest authenticates the
 * *content*. Neither substitutes for the other: a stolen secret still cannot
 * make the cell apply an altered manifest, and a valid manifest from an
 * unauthenticated caller is still refused.
 */

function secretsMatch(a: string, b: string): boolean {
  // Hashed before comparing so the compare is over equal-length buffers —
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length of the expected value.
  const digest = (v: string) => createHash("sha256").update(v, "utf8").digest()
  return timingSafeEqual(digest(a), digest(b))
}

interface ReconcileRequest {
  manifest: DeploymentManifest
  displayName: string
  initialAdminEmail: string
}

export async function POST(request: Request) {
  const expected = process.env.PLATFORM_RECONCILE_SECRET
  if (!expected) {
    // Fail closed and say which variable, rather than 401 with no explanation.
    // An operator seeing this needs to know it is configuration, not credentials.
    return Response.json(
      { error: "PLATFORM_RECONCILE_SECRET is not configured; this cell accepts no deployments." },
      { status: 503 },
    )
  }

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (!provided || !secretsMatch(provided, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: ReconcileRequest
  try {
    body = (await request.json()) as ReconcileRequest
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 })
  }

  if (!body?.manifest?.slug || !body.displayName || !body.initialAdminEmail) {
    return Response.json(
      { error: "manifest, displayName and initialAdminEmail are all required" },
      { status: 400 },
    )
  }

  try {
    // Provisioning a tenant is platform work that legitimately precedes any
    // tenant existing, so it runs unscoped — with a reason and a detail, both
    // recorded, rather than by bypassing the extension.
    const report = await runUnscoped("control-plane", `reconcile ${body.manifest.slug}`, () =>
      reconcile(db, {
        manifest: body.manifest,
        displayName: body.displayName,
        initialAdminEmail: body.initialAdminEmail,
        // The cell's own version, never taken from the request — an artifact
        // that could declare the schema it is applied against could declare any.
        cellSchemaVersion: process.env.SCHEMA_VERSION ?? "unpinned",
        at: new Date().toISOString(),
      }),
    )

    // 200 for a first apply and for a repeat alike. A retry is a success with
    // nothing to do, not a conflict — `changes: []` is how the caller tells
    // them apart without either being an error.
    return Response.json(report, { status: 200 })
  } catch (err) {
    if (err instanceof ReconcileRefused) {
      // 422: the request was well-formed and authenticated, and the cell
      // declines to apply it. The reason is safe to return — it names a digest
      // mismatch or a schema boundary, never any tenant's data.
      return Response.json({ error: err.message, reason: err.reason }, { status: 422 })
    }
    console.error("[reconcile] unexpected failure:", err)
    return Response.json({ error: "reconcile failed" }, { status: 500 })
  }
}
