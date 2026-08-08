import { REQUIRED_RESOURCE_TAGS } from "@tenure/provisioning"

// Relative, not `@/`. This component is rendered inside a jest run whose `@/`
// alias belongs to `apps/web`, and `EvidencePanel.tsx` beside it keeps the same
// rule for the same reason.
import {
  describeAttribution,
  tagCompliance,
  type TaggedResource,
} from "../lib/aws/tags"

/**
 * STUDIO-070-002 — where the twelve-key tag contract stops being a computation
 * and becomes something an operator has to look at.
 *
 * `taggedResources` calls `tagProblems` on every result the Resource Groups
 * Tagging API returns, and until this panel existed the answer went nowhere:
 * `TaggedResource.problems` was populated on every resource in the estate and
 * read by exactly one caller, a unit test. A contract that is evaluated and
 * then discarded is not a contract — a resource missing `tenure:cost-center`
 * was detected on every page load and never once reported.
 *
 * The same was true of `tagCompliance`, which had no production caller at all.
 * It has one now, and it is this file.
 *
 * ── What is deliberately NOT collapsed ─────────────────────────────────────
 *
 * `unattributable` and `shared` are counted separately and rendered as separate
 * rows, for the reason `resource-tags.ts` gives at length: a resource somebody
 * decided is platform overhead and a resource nobody has looked at are
 * different facts, and folding them is how an untagged NAT gateway becomes
 * every customer's line item.
 *
 * The non-compliant table lists resources, not a count. A count tells an
 * operator that something is wrong; the ARN and the missing key tell them what
 * to go and fix, which is the difference between a dashboard and a work queue.
 */

/** How many offending resources to name before the list stops being readable. */
const MAX_LISTED = 25

export function TagCompliancePanel({ resources }: { resources: readonly TaggedResource[] }) {
  const compliance = tagCompliance(resources)
  const offenders = resources.filter((r) => r.problems.length > 0)
  const listed = offenders.slice(0, MAX_LISTED)

  return (
    <section className="system" data-surface="tag-compliance">
      <header>
        <h2>Tag contract</h2>
        <span
          className={compliance.nonCompliant === 0 ? "badge ok" : "badge"}
          data-testid="tag-compliance-badge"
        >
          {compliance.nonCompliant} of {compliance.total} non-compliant
        </span>
      </header>
      <p>
        Every provisioned resource must carry {REQUIRED_RESOURCE_TAGS.length} tags —{" "}
        {REQUIRED_RESOURCE_TAGS.map((key, i) => (
          <span key={key}>
            {i > 0 ? ", " : ""}
            <code>{key}</code>
          </span>
        ))}
        . Cost attribution, blast-radius questions and &ldquo;who answers for this&rdquo; all
        resolve through them, so a resource that ships untagged is one no bill can charge and no
        purge can find.
      </p>

      <dl className="kv" data-testid="tag-compliance-counts">
        <dt>attributed to a tenant</dt>
        <dd>{compliance.attributed}</dd>
        <dt>explicitly shared</dt>
        <dd>{compliance.shared}</dd>
        <dt>unattributable</dt>
        <dd>
          {compliance.unattributable}
          {compliance.unattributable > 0
            ? " — counted apart from shared on purpose: nobody decided these belong to the platform, nobody has looked at them"
            : ""}
        </dd>
      </dl>

      {offenders.length === 0 ? (
        <p data-testid="tag-compliance-summary">
          {compliance.total === 0
            ? "No resources were read, so nothing was checked. This is not a pass."
            : `All ${compliance.total} resource(s) carry every required tag.`}
        </p>
      ) : (
        <>
          <p data-testid="tag-compliance-summary">
            {offenders.length} resource(s) fail the contract
            {offenders.length > listed.length ? `; the first ${listed.length} are named` : ""}.
          </p>
          <div className="scroll-x">
            <table className="grid">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Attribution</th>
                  <th>What is missing or wrong</th>
                </tr>
              </thead>
              <tbody>
                {listed.map((r) => (
                  <tr key={r.arn} data-tag-problem="">
                    <td className="id">{r.arn}</td>
                    <td>{describeAttribution(r.attribution)}</td>
                    <td className="slug">
                      {r.problems.map((p) => `${p.key}: ${p.detail}`).join(" ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
