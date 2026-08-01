import Link from "next/link"

import { auth } from "@/lib/auth"
import { isOperator, operatorConfigProblems } from "@/lib/operators"
import truth from "@/generated/platform-truth.json"

export const dynamic = "force-dynamic"

/**
 * What the engine currently knows about itself.
 *
 * Every number on this page comes from `apps/system-studio/src/generated/platform-truth.json`,
 * which `tools/platform-truth.mjs` compiles from the execution ledger, the
 * execution prompt, and the sanitized read-only AWS inventory. Nothing here is
 * illustrative and nothing is entered by hand — a test fails the build if the
 * generated file drifts from those sources.
 *
 * The reason this page exists: twelve commits of Phase 0 and Phase 1 work
 * produced an inventory, an entry-point trace, a contradictions list and a set
 * of guards, and none of it was visible in the product. Work that cannot be
 * seen is indistinguishable from work that did not happen.
 */
export default async function PlatformPage() {
  const misconfigured = operatorConfigProblems()
  if (misconfigured.length > 0) {
    return (
      <div className="misconfigured">
        <h1>Not configured</h1>
        <p>The Studio refuses to serve until its access control is set up.</p>
      </div>
    )
  }

  const session = await auth()
  if (!isOperator(session?.user?.email)) {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }

  const { programme, ledger, findings, estate, suites } = truth

  // The inventory records denials as {call, reason}; a count alone would lose
  // the reason, which is the part that matters.
  const denied = Array.isArray(estate.deniedCalls) ? estate.deniedCalls : []
  const percent = ((ledger.done / programme.totalItems) * 100).toFixed(1)

  return (
    <>
      <nav className="tabs">
        <Link href="/">Organization systems</Link>
        <span className="here">Platform</span>
      </nav>

      <h1>Platform</h1>
      <p>
        Compiled from the execution ledger, the execution prompt and the read-only AWS inventory at
        commit <code>{truth.commit}</code>. Every figure is traceable to a file in the repository.
      </p>

      {/* ── Programme ─────────────────────────────────────────────────── */}
      <section className="system">
        <header>
          <h2>Programme</h2>
          <span className="badge warn">
            {ledger.done} of {programme.totalItems} — {percent}%
          </span>
        </header>

        <p>
          {programme.totalItems} items across {programme.phases.length} phases, with{" "}
          {programme.totalGates} phase gates. Progress is counted against the whole programme, not
          against the phase currently open — {ledger.total} items are transcribed into the ledger so
          far, and reporting {ledger.done}/{ledger.total} would be true of Phase 0 and misleading
          about the rest.
        </p>

        <table className="grid">
          <thead>
            <tr>
              <th>Phase</th>
              <th className="num">Items</th>
              <th className="num">Gates</th>
            </tr>
          </thead>
          <tbody>
            {programme.phases.map((p) => (
              <tr key={p.phase}>
                <td>{p.phase}</td>
                <td className="num">{p.items}</td>
                <td className="num">{p.gates}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Ledger ────────────────────────────────────────────────────── */}
      {ledger.phases.map((phase) => (
        <section className="system" key={phase.phase}>
          <header>
            <h2>{phase.phase}</h2>
            <span className={`badge ${phase.items.every((i) => i.done) ? "ok" : "warn"}`}>
              {phase.items.filter((i) => i.done).length}/{phase.items.length}
            </span>
          </header>

          <table className="grid">
            <tbody>
              {phase.items.map((item) => (
                <tr key={item.id} className={item.isGate ? "gate" : undefined}>
                  <td className="state">{item.done ? "✓" : "○"}</td>
                  <td className="id">{item.id}</td>
                  <td>{item.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {/* ── Findings ──────────────────────────────────────────────────── */}
      <section className="system">
        <header>
          <h2>Open findings</h2>
          <span className="badge bad">{findings.length}</span>
        </header>
        <p>
          Differences between the estate as inventoried and the architecture it is meant to be.
          Each carries the item that closes it, so a finding cannot sit in a document with nobody
          owning it.
        </p>

        <table className="grid">
          <thead>
            <tr>
              <th>Finding</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.finding}>
                <td>{f.finding}</td>
                <td className="id">{f.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Estate ────────────────────────────────────────────────────── */}
      <section className="system">
        <header>
          <h2>AWS estate</h2>
          <span className="slug">
            account {estate.account} · {estate.region}
          </span>
        </header>
        <p>
          Read-only inventory of {new Date(estate.generatedAt).toISOString().slice(0, 10)}. The
          account id is masked at the point the inventory is written, because this repository is
          public.
        </p>

        <div className="chips">
          {Object.entries(estate.summary).map(([key, value]) => (
            <span className="chip" key={key}>
              <b>{String(value)}</b> {key.replace(/([A-Z])/g, " $1").toLowerCase()}
            </span>
          ))}
        </div>

        <h3>Facts the findings above refer to</h3>
        <dl className="kv">
          <dt>AWS Organization</dt>
          <dd>{estate.organizationInUse ? "in use" : "not in use — a single-account estate"}</dd>
          <dt>OIDC providers</dt>
          <dd>
            {estate.oidcProviders === 0
              ? "none — every AWS workflow authenticates with a long-lived key"
              : estate.oidcProviders}
          </dd>
          <dt>Cognito user pools</dt>
          <dd>{estate.cognitoUserPools === 0 ? "none" : estate.cognitoUserPools}</dd>
          <dt>Backup vaults</dt>
          <dd>{estate.backupVaults === 0 ? "none" : estate.backupVaults}</dd>
        </dl>

        <h3>Calls the inventory was refused</h3>
        <p>
          Recorded as findings rather than escalated to a wider role. All three are Organizations
          calls, and their refusal is the evidence that no Organization exists — the answer, not an
          obstacle.
        </p>
        <table className="grid">
          <tbody>
            {denied.map((d) => (
              <tr key={d.call}>
                <td className="id">{d.call}</td>
                <td>{d.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Queues with no producer and no consumer</h3>
        <p>
          {estate.sqsQueues.length} queues and an SES identity are provisioned for a delivery path
          no package implements — nothing declares an SQS or SES client. The dead-letter alarm below
          is green because nothing can write to the queue it watches.
        </p>
        <div className="chips">
          {estate.sqsQueues.map((q) => (
            <span className="chip" key={q}>
              {q}
            </span>
          ))}
        </div>

        <h3>Alarms</h3>
        <div className="chips">
          {estate.alarms.map((a) => (
            <span className="chip" key={a.name}>
              <b>{a.state}</b> {a.name}
            </span>
          ))}
        </div>
      </section>

      {/* ── Tests ─────────────────────────────────────────────────────── */}
      <section className="system">
        <header>
          <h2>Test suites</h2>
        </header>
        <dl className="kv">
          {suites.map((s) => (
            <div key={s.name} style={{ display: "contents" }}>
              <dt>{s.name}</dt>
              <dd>
                {s.files} files <span className="slug">— {s.what}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
