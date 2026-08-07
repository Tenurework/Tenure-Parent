
import { fleetCompatibility, moduleAdoption } from "@tenure/platform-config"

import { auth } from "@/lib/auth"
import { fleet } from "@/lib/cells"
import { isOperator, operatorConfigProblems } from "@/lib/operators"
import truth from "@/generated/platform-truth.json"
import { StaleState } from "@/components/states"

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

  /**
   * PACK-GATE-080 — what a module lifecycle change would actually reach.
   *
   * Every lifecycle question the engine could answer used to take one slug, so
   * deprecating, suspending or retiring a module could not be evaluated against
   * the fleet before it was done. `moduleAdoption` folds every binding through
   * the same resolver each tenant runs, so this table cannot disagree with what
   * those tenants have — in particular it does not list a tenant whose blueprint
   * asks for a module its entitlement refuses.
   */
  const adoption = moduleAdoption()

  /**
   * And whether the cell holding each tenant can honour its configuration.
   *
   * `checkCompatibility` has existed since GE-022-005 with no caller outside its
   * own test — a gate that refuses nothing. This is the caller. The version
   * compared against is the cell's own `release`, so a fleet that cannot say
   * what it is running reports exactly that rather than a reassuring pass.
   */
  const cells = fleet()
  const compatibility = cells.map((cell) => ({
    cell,
    tenants: fleetCompatibility(cell.release),
  }))

  // The inventory records denials as {call, reason}; a count alone would lose
  // the reason, which is the part that matters.
  const denied = Array.isArray(estate.deniedCalls) ? estate.deniedCalls : []
  const percent = ((programme.decided / programme.totalItems) * 100).toFixed(1)
  // Set by the deploy workflow. Unset locally, which correctly means "cannot
  // tell" — an unknown build must claim neither freshness nor staleness.
  const buildCommit = process.env.BUILD_COMMIT

  return (
    <>

      <h1>Platform</h1>
      <p>
        Compiled from the execution ledger, the execution prompt and the read-only AWS inventory at
        commit <code>{truth.commit}</code>. Every figure is traceable to a file in the repository.
      </p>

      {/*
        GE-022-006. Every figure below comes from a snapshot compiled at a
        commit. When the running build knows its own commit and it differs, this
        page is describing an older repository — which is worse than showing
        nothing, because the numbers still look authoritative.

        Keyed on a commit mismatch rather than an age threshold: a page whose
        output changes with the clock cannot be tested deterministically, and a
        staleness warning that appears on a timer is one people learn to ignore.
      */}
      {buildCommit && buildCommit !== truth.commit && (
        <StaleState
          asOf={`commit ${truth.commit}`}
          why={
            `This console is running commit ${buildCommit}. Run "npm run generate" and redeploy; ` +
            `until then every figure below describes an older repository.`
          }
        />
      )}

      {/* ── Programme ─────────────────────────────────────────────────── */}
      <section className="system">
        <header>
          <h2>Programme</h2>
          <span className="badge warn">
            {programme.decided} of {programme.totalItems} — {percent}%
          </span>
        </header>

        <p>
          {programme.totalItems} items across {programme.phases.length} phases of four binding
          execution prompts, with {programme.totalGates} phase gates. Progress is counted against
          the whole programme, not against the phase currently open — {ledger.total} items are
          transcribed into the ledgers so far, and reporting {ledger.done}/{ledger.total} would be
          true of what has been written down and misleading about the rest.
        </p>

        <p>
          {/*
            Two numerators, and they measure different things. `done` is a
            checked box: implemented, tested, evidenced. `decided` also counts
            items validly recorded BLOCKED_EXTERNAL or NOT_APPLICABLE — settled,
            but not built. Showing only the larger would overstate what exists;
            showing only the smaller would imply the loop is still due to
            revisit work that is waiting on a human. Both, named.
          */}
          {ledger.done} implemented. {programme.decided - ledger.done} more are decided without
          being built — blocked on an external dependency, or not applicable — for{" "}
          {programme.decided} of {programme.totalItems} settled in total.
        </p>

        {/*
          Grouped by document, not listed by phase. There are 178 phases across
          the four prompts; a table with 178 rows is a wall, and the question
          this section answers is "how much of each document is left", which is
          four numbers.
        */}
        <table className="grid">
          <thead>
            <tr>
              <th>Document</th>
              <th className="num">Items</th>
              <th className="num">Gates</th>
              <th className="num">Decided</th>
            </tr>
          </thead>
          <tbody>
            {[...new Set(programme.phases.map((p) => p.source))].map((source) => {
              const rows = programme.phases.filter((p) => p.source === source)
              const sum = (pick: (p: (typeof rows)[number]) => number) =>
                rows.reduce((n, p) => n + pick(p), 0)
              return (
                <tr key={source}>
                  <td>{source}</td>
                  <td className="num">{sum((p) => p.items)}</td>
                  <td className="num">{sum((p) => p.gates)}</td>
                  <td className="num">{sum((p) => p.done)}</td>
                </tr>
              )
            })}
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

      {/* ── Module adoption ───────────────────────────────────────────── */}
      <section className="system">
        <header>
          <h2>Module adoption</h2>
          <span className="badge warn">
            {adoption.filter((m) => m.tenants.length > 0).length} of {adoption.length} adopted
          </span>
        </header>
        <p>
          The blast radius of a lifecycle change, before it is made. Each row is a module in the
          catalog and the tenants that <em>actually run it</em> — resolved the same way each tenant
          resolves it, so a module a blueprint asks for and an entitlement refuses does not appear
          here. A row with no tenants is the one that can be retired for nothing.
        </p>
        <p>
          <code>preset</code> means the tenant&rsquo;s archetype compiled to it; <code>edit</code>{" "}
          means that tenant added it on top. Deprecating a module nobody chose deliberately is a
          different conversation from deprecating one somebody asked for.
        </p>

        <table className="grid">
          <thead>
            <tr>
              <th>Module</th>
              <th>Lifecycle</th>
              <th>Commands</th>
              <th>Tenants running it</th>
            </tr>
          </thead>
          <tbody>
            {adoption.map((module) => (
              <tr key={module.key}>
                <td className="id">{module.key}</td>
                <td>{module.lifecycle}</td>
                <td>
                  {module.commands.length === 0 ? (
                    <span className="slug">—</span>
                  ) : (
                    module.commands.map((c) => (
                      <span className="chip" key={c.id}>
                        <b>{c.riskClass}</b> {c.label}
                      </span>
                    ))
                  )}
                </td>
                <td>
                  {module.tenants.length === 0 ? (
                    <span className="slug">nobody</span>
                  ) : (
                    module.tenants.map((t) => (
                      <span className="chip" key={t.slug}>
                        {t.slug} <b>{t.from === "preset" ? "preset" : "edit"}</b>
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Release compatibility ─────────────────────────────────────── */}
      <section className="system">
        <header>
          <h2>Release compatibility</h2>
        </header>
        <p>
          Each tenant&rsquo;s published configuration against the engine version its cell reports.
          A cell older than the configuration it is asked to serve <em>refuses</em> rather than
          half-applying it: ignoring an unknown key would leave a setting the Studio shows as
          published quietly doing nothing, and applying one whose meaning has moved is worse.
        </p>

        {compatibility.map(({ cell, tenants }) => (
          <div key={cell.cellId}>
            <h3>
              {cell.cellId} <span className="slug">running {cell.release}</span>
            </h3>
            <table className="grid">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th className="num">Keys</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.slug}>
                    <td className="id">{tenant.slug}</td>
                    <td className="num">{tenant.keys.length}</td>
                    <td>
                      {tenant.verdict.compatible ? (
                        "compatible"
                      ) : (
                        <>
                          {tenant.verdict.problems.length} key
                          {tenant.verdict.problems.length === 1 ? "" : "s"} refused —{" "}
                          {[...new Set(tenant.verdict.problems.map((p) => p.reason))].join(", ")}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

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
