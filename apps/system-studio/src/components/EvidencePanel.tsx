import type { StepEvidence } from "@tenure/provisioning"

/**
 * STUDIO-070-005 — what a step ran against, what it produced, and how to check
 * that against the account.
 *
 * The panel this replaces rendered `state · step · ok/failed`, a sentence and an
 * optional digest. Of the twelve things an execution record is required to
 * carry, three reached an operator's eyes. The rest — the input digest, the AWS
 * request ids, the resource handles, the role session, the next retry, the
 * compensation — either did not exist or were not rendered, which for an
 * operator is the same thing.
 *
 * ── Why an absent request id is rendered as a PROBLEM ──────────────────────
 *
 * `awsRequestIds: []` is a legal value and means "this step made no AWS call",
 * which VALIDATING and PLANNED genuinely do not. But a step that WROTE
 * something and recorded no request id is a step whose claim cannot be checked
 * against CloudTrail, and the console has no way to tell the two apart except
 * by whether the step is one that reads the registry.
 *
 * So the rule is: a step whose evidence came from a run against the registry is
 * expected to name at least one request id, and one that names none renders as
 * `unverifiable — no AWS request id recorded`. That is what makes the field
 * real: a producer that stops threading the ids reds this panel rather than
 * quietly rendering an empty list nobody notices.
 */

/** Steps that necessarily touched the registry, and must therefore cite a read. */
const TOUCHES_AWS = new Set([
  "reserve",
  "configure",
  "cell-apply",
  "verify",
  "activate",
  "validate",
  "plan",
])

export function provenanceProblems(e: StepEvidence): readonly string[] {
  const problems: string[] = []
  if (TOUCHES_AWS.has(e.step) && e.awsRequestIds.length === 0) {
    problems.push(
      "unverifiable — no AWS request id recorded, so nothing here can be checked against CloudTrail",
    )
  }
  if (!e.outputDigest) {
    problems.push("no output digest — nothing says what this step produced")
  }
  if (!e.inputDigest) {
    problems.push("no input digest — nothing says what this step ran against")
  }
  if (e.resourceHandles.length === 0) {
    problems.push("no resource handle — nothing names what this step touched")
  }
  return problems
}

export function EvidencePanel({ evidence }: { evidence: readonly StepEvidence[] }) {
  return (
    <section className="system">
      <header>
        <h2>Evidence</h2>
        <span className="badge">{evidence.length} steps</span>
      </header>
      <p>
        What each step ran against, what it produced, and the request ids that let an operator
        check the claim against the account. A step that records having run without producing
        anything citable is a step that did not run.
      </p>
      {evidence.map((e) => {
        const problems = provenanceProblems(e)
        return (
          <div key={`${e.state}-${e.step}-${e.attempt}`} data-step={e.step}>
            <h3>
              {e.state} · {e.step} <span className="badge">{e.ok ? "ok" : "failed"}</span>
              {e.attempt > 1 && <span className="slug"> attempt {e.attempt}</span>}
            </h3>
            <p className="slug">{e.detail}</p>

            {problems.map((p) => (
              <p className="error" key={p} data-provenance-problem="">
                {p}
              </p>
            ))}

            <dl className="kv">
              <dt>input</dt>
              <dd className="id">{e.inputDigest}</dd>
              <dt>output</dt>
              <dd className="id">{e.outputDigest}</dd>
              <dt>aws request ids</dt>
              <dd className="id">
                {e.awsRequestIds.length > 0 ? e.awsRequestIds.join(", ") : "none recorded"}
              </dd>
              <dt>ran as</dt>
              <dd className="slug">
                {e.assumedRoleArn ??
                  "unknown — this engine cannot read its own identity, so no role session is claimed"}
              </dd>
              <dt>touched</dt>
              <dd className="id">{e.resourceHandles.join(", ") || "nothing recorded"}</dd>
              <dt>next retry</dt>
              <dd className="slug">
                {e.nextRetryAt
                  ? `${e.nextRetryAt} — due, not scheduled: nothing polls this, an operator retries`
                  : e.ok
                    ? "not applicable — the step succeeded"
                    : "none stated"}
              </dd>
              <dt>compensation</dt>
              <dd className="slug">
                {e.compensation
                  ? `${e.compensation.attempted ? "attempted" : "not attempted"}, ${
                      e.compensation.ok ? "nothing outstanding" : "OWED"
                    } — ${e.compensation.detail}`
                  : "none — nothing was owed"}
              </dd>
              <dt>correlation</dt>
              <dd className="id">{e.correlationId}</dd>
            </dl>

            {e.checks && (
              <table className="grid">
                <tbody>
                  {e.checks.map((c) => (
                    <tr key={c.name}>
                      <td className="state">{c.ok ? "✓" : "✗"}</td>
                      <td>{c.name}</td>
                      <td className="slug">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </section>
  )
}
