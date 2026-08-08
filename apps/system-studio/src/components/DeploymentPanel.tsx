import type { DeploymentManifest } from "@tenure/provisioning"

/**
 * STUDIO-070-009 — the deployment artifact, including the two facts about it
 * that used to be claimed in comments and rendered nowhere.
 *
 * The panel this replaces printed five fields under the heading "The signed
 * artifact a cell reconciles toward" and never showed whether it was signed. It
 * also never showed `rollbackDigest`, which is the artifact's answer to "what
 * would we go back to" — the field that spent a whole requirement being
 * permanently null because the one caller held the previous artifact and did not
 * forward it.
 *
 * A rollback target nobody can see is a rollback nobody performs, so the field
 * is rendered here and asserted through the real producer in
 * `src/lib/deployment-provenance.test.tsx`.
 *
 * ── Absent is said, never blank ────────────────────────────────────────────
 *
 * Every nullable field prints a sentence rather than an em-dash. `iacDigest`
 * being null means "this artifact does not state which infrastructure revision
 * it belongs to", which is a real and reportable fact; a blank cell reads as a
 * rendering bug and gets ignored. The same rule `EvidencePanel` follows, for the
 * same reason.
 */

/** Fields whose absence is a problem worth colouring, not merely worth stating. */
function problems(d: DeploymentManifest): readonly string[] {
  const out: string[] = []
  if (!d.signature) {
    out.push(
      "unsigned — its origin is not established, and deliverToCell refuses to hand an unsigned " +
        "artifact to a cell. Set DEPLOYMENT_SIGNING_KEY_ID and DEPLOYMENT_SIGNING_SECRET and re-publish.",
    )
  }
  return out
}

export function DeploymentPanel({ deployment }: { deployment: DeploymentManifest }) {
  const faults = problems(deployment)

  return (
    <section className="system" data-surface="deployment">
      <header>
        <h2>Deployment manifest</h2>
        <span className={faults.length === 0 ? "badge ok" : "badge"}>{deployment.digest}</span>
      </header>
      <p>
        The artifact a cell reconciles toward. Its digest covers every field below, so a cell can
        verify it received what the engine published; its signature is what establishes who
        published it, which the digest alone cannot.
      </p>

      {faults.map((detail) => (
        <p key={detail} data-deployment-problem="">
          {detail}
        </p>
      ))}

      <dl className="kv">
        <dt>signature</dt>
        <dd data-testid="deployment-signature">
          {deployment.signature
            ? `${deployment.signature.algorithm} by ${deployment.signature.keyId}`
            : "none — unsigned, and undeliverable to a cell"}
        </dd>
        <dt>rolls back to</dt>
        <dd className="id" data-testid="deployment-rollback">
          {deployment.rollbackDigest ??
            "nothing — this is the first artifact published for this tenant, so there is no earlier one to return to"}
        </dd>
        <dt>configuration</dt>
        <dd>{deployment.configurationChecksum}</dd>
        <dt>modules</dt>
        <dd>{deployment.modules.join(", ")}</dd>
        <dt>schema</dt>
        <dd>{deployment.schemaVersion}</dd>
        <dt>evidence</dt>
        <dd>{deployment.evidenceDigest}</dd>
        <dt>infrastructure</dt>
        <dd className="id">
          {deployment.iacDigest ?? "not stated — this artifact names no infrastructure revision"}
        </dd>
        <dt>models</dt>
        <dd className="id">
          {deployment.modelDigest ?? "not stated — this artifact names no model revision"}
        </dd>
        <dt>policy</dt>
        <dd className="id">
          {deployment.policyDigest ?? "not stated — this artifact names no policy revision"}
        </dd>
        <dt>published</dt>
        <dd>
          {deployment.createdAt} by {deployment.createdBy}
        </dd>
      </dl>
    </section>
  )
}
