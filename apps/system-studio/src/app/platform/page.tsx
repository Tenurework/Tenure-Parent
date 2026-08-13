import type { ReactNode } from "react"

import Link from "next/link"

import { fleetCompatibility, moduleAdoption } from "@tenure/platform-config"

import { auth } from "@/lib/auth"
import { authorizeCommand } from "@/lib/authorize"
import { FleetMisconfigured, fleet, primeEstate } from "@/lib/cells"
import { operatorConfigProblems } from "@/lib/operators"
import truth from "@/generated/platform-truth.json"
import { Badge, ButtonLink, Card, Chip, DataTable, EmptyState } from "@/components/md3"
import {
  DegradedState,
  ErrorState,
  PermissionDeniedState,
  StaleState,
  UnknownState,
  degradationOf,
} from "@/components/states"

import styles from "./platform.module.css"

export const dynamic = "force-dynamic"

/**
 * What the engine currently knows about itself.
 *
 * Most of this page comes from `apps/system-studio/src/generated/platform-truth.json`,
 * which `tools/platform-truth.mjs` compiles from the execution ledger, the
 * execution prompts, and the sanitized read-only AWS inventory. Nothing there is
 * illustrative and nothing is entered by hand — a test fails the build if the
 * generated file drifts from those sources.
 *
 * The rest — module adoption and release compatibility — is resolved at render
 * time from the module catalog and the tenant bindings in THIS build, not from
 * the snapshot. The two have different as-of times and every panel below says
 * which one it is on, because a page that mixes a compiled snapshot with a live
 * resolution and labels neither is a page whose numbers cannot be dated.
 *
 * The reason this page exists: twelve commits of Phase 0 and Phase 1 work
 * produced an inventory, an entry-point trace, a contradictions list and a set
 * of guards, and none of it was visible in the product. Work that cannot be
 * seen is indistinguishable from work that did not happen.
 *
 * ── What this page is, in the information architecture ─────────────────────
 *
 * A diagnostic surface, and it says so. `docs/architecture/studio-information-architecture.md`
 * places `/platform` behind the Diagnostics group — it serves no Bible operator
 * requirement, and four of its panels are build reports or compiled duplicates
 * of pages that now read AWS live. That document is the authority on which
 * panels move where; this file does not move any of them. What it does is stop
 * them reading as one flat wall: every panel is a Card with a real heading, an
 * AS-OF line, and a line naming what it does not know.
 *
 * ── Layout constraints this file is written against ────────────────────────
 *
 * `e2e/layout.spec.ts` runs this route at 1440, 1180, 900 and 320 CSS pixels,
 * and again under `dir="rtl"`, asserting that no text is drawn over other text,
 * that nothing overflows its container, and that the page never scrolls
 * sideways (WCAG 2.2 AA 1.4.10). Every table on this page is a `DataTable`,
 * whose shell is `overflow-x: auto`, so a wide table scrolls inside its own
 * border instead of widening the page. Long identifiers carry
 * `styles.identifier`, which is `overflow-wrap: anywhere` — the defect no
 * overlap check can see, because the element stays inside its box while its
 * text runs out of it.
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

  // STUDIO-020-006. `platform:read` — every role family holds it, but the
  // decision is still a decision: it names the resource, the action and the
  // account/region this control plane resolved, and it is refused when the
  // allowlist itself does not parse.
  const session = await auth()
  const decision = authorizeCommand("platform.read", { principalId: session?.user?.email })
  if (decision.reason === "NO_PRINCIPAL") {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }
  if (!decision.allowed) return <PermissionDeniedState />

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
  // GE-010-007. `fleet()` is synchronous and its estate facts now come from
  // sts:GetCallerIdentity rather than from a compiled-in "us-east-1"/account
  // literal. Priming resolves that identity once per process before the first
  // synchronous read; a page that skipped it would fall back to the environment
  // alone, and refuse rather than guess if that is unset too.
  await primeEstate()

  /*
   * And the refusal is caught, because a refusal is not a crash.
   *
   * `fleet()` THROWS `FleetMisconfigured` when neither the environment nor
   * `sts:GetCallerIdentity` can say which account, region and partition this
   * process is in. That is the correct behaviour for the function — it must not
   * invent an estate — but an uncaught throw in a server component renders a
   * 500, and a console that cannot be opened at all because STS was unreachable
   * has told its operator nothing. It is caught here and rendered as UNKNOWN,
   * naming the two ways to supply what is missing, which is the same
   * distinction `components/states.tsx` draws everywhere else: a read that was
   * refused is not a fact that is absent.
   */
  let cells: ReturnType<typeof fleet> | null = null
  let fleetProblems: readonly { field: string; detail: string }[] = []
  try {
    cells = fleet()
  } catch (error) {
    if (!(error instanceof FleetMisconfigured)) throw error
    fleetProblems = error.problems
  }
  const compatibility = (cells ?? []).map((cell) => ({
    cell,
    tenants: fleetCompatibility(cell.release),
  }))

  // The inventory records denials as {call, reason}; a count alone would lose
  // the reason, which is the part that matters.
  const denied = Array.isArray(estate.deniedCalls) ? estate.deniedCalls : []
  const percent = ((programme.decided / programme.totalItems) * 100).toFixed(1)
  const percentValue = Number(percent)
  const untranscribed = programme.totalItems - ledger.total
  const decidedNotBuilt = programme.decided - ledger.done

  const sourceSummaries = [...new Set(programme.phases.map((p) => p.source))]
    .map((source) => {
      const rows = programme.phases.filter((p) => p.source === source)
      const sum = (pick: (p: (typeof rows)[number]) => number) =>
        rows.reduce((n, p) => n + pick(p), 0)
      const items = sum((p) => p.items)
      const gates = sum((p) => p.gates)
      const decided = sum((p) => p.done)
      return {
        source,
        items,
        gates,
        decided,
        remaining: items - decided,
        percent: items === 0 ? "0.0" : ((decided / items) * 100).toFixed(1),
      }
    })
    // Most work outstanding first — the ordering that answers "where is the
    // programme heaviest". Sorted with a plain comparison rather than
    // `localeCompare`, which is ICU-dependent and would order this table
    // differently on a machine with a different collation than in CI.
    .sort((a, b) =>
      b.remaining !== a.remaining
        ? b.remaining - a.remaining
        : a.source < b.source
          ? -1
          : a.source > b.source
            ? 1
            : 0,
    )

  // Set by the deploy workflow. Unset locally, which correctly means "cannot
  // tell" — an unknown build must claim neither freshness nor staleness.
  const buildCommit = process.env.BUILD_COMMIT
  const snapshot = `commit ${truth.commit}`
  const inventoryDate = new Date(estate.generatedAt).toISOString().slice(0, 10)

  /*
   * STUDIO-030-006, applied to the estate's service reads.
   *
   * `working` is the service reads that produced a count; `failing` is what the
   * inventory recorded as denied. Derived rather than written down: a hand-kept
   * list would say "9 of 12" on the day it was typed and keep saying it after
   * the tenth service was added.
   */
  const answeredReads = Object.keys(estate.summary)
    // Not a read. It is the count of the failing half, and including it would
    // let one refusal be counted on both sides of the ratio.
    .filter((key) => key !== "deniedCalls")
    .map(humanise)
  const readState = degradationOf(
    answeredReads,
    denied.map((d) => ({ source: d.call, why: d.reason })),
  )

  const alarmsUnavailable = "alarmsUnavailable" in estate && Boolean(estate.alarmsUnavailable)

  return (
    <div className={styles.page}>
      <header>
        <h1 className="md3-headline-large">Platform</h1>
        <p className={`${styles.line} md3-body-medium`}>
          The engine&rsquo;s own state. Every figure is traceable to a file in this repository, and
          every panel below says what it is as of and what it does not know.
        </p>
      </header>

      {/*
        GE-022-006. Every figure from the snapshot was compiled at a commit.
        When the running build knows its own commit and it differs, this page is
        describing an older repository — which is worse than showing nothing,
        because the numbers still look authoritative.

        Keyed on a commit mismatch rather than an age threshold: a page whose
        output changes with the clock cannot be tested deterministically, and a
        staleness warning that appears on a timer is one people learn to ignore.
      */}
      {buildCommit && buildCommit !== truth.commit && (
        <StaleState
          asOf={snapshot}
          why={
            `This console is running commit ${buildCommit}. Run "npm run generate" and redeploy; ` +
            `until then every figure compiled from the snapshot describes an older repository.`
          }
        />
      )}

      {/* ── The answer ────────────────────────────────────────────────────
        First, and deliberately: the number an operator opens this page for is
        how much of the programme is settled. Everything below it is the working
        that produced it.
      */}
      <Card
        headline="Where the programme stands"
        headerAside={
          <Badge
            tone="warn"
            title={`${programme.decided} of ${programme.totalItems} programme items are settled`}
          >
            {programme.decided} of {programme.totalItems} — {percent}%
          </Badge>
        }
        supportingText={
          <>
            {programme.totalItems} items across {programme.phases.length} phases of{" "}
            {programme.sources.length} binding execution prompts, with {programme.totalGates} phase
            gates. Counted against the whole programme, not against the phase currently open.
          </>
        }
      >
        <div className={styles.stack}>
          <div
            aria-label={`Programme settled ${percent}%`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percentValue}
            className="progress-meter"
            role="meter"
          >
            <span style={{ inlineSize: `${percent}%` }} />
          </div>

          <p className={`${styles.line} md3-body-medium`}>
            {/*
              Two numerators, and they measure different things. `done` is a
              checked box: implemented, tested, evidenced. `decided` also counts
              items validly recorded BLOCKED_EXTERNAL or NOT_APPLICABLE —
              settled, but not built. Showing only the larger would overstate
              what exists; showing only the smaller would imply the loop is
              still due to revisit work that is waiting on a human. Both, named.
            */}
            {ledger.done} implemented. {decidedNotBuilt} more are decided without being built —
            blocked on an external dependency, or not applicable — for {programme.decided} of{" "}
            {programme.totalItems} settled in total.
          </p>

          {/*
            Grouped by document, not listed by phase. `programme.phases` runs to
            several hundred rows and a table that long is a wall; the question
            this panel answers is "how much of each document is left", which is
            one row per document. The count is not written down here for the
            reason the figures are not either — it would be a number in a
            comment that stops being true the next time the prompts change.
          */}
          <DataTable
            caption="Progress by execution prompt, heaviest remaining first"
            columns={[
              {
                key: "source",
                header: "Prompt",
                // The item-id prefix the prompt's own items carry — GE-010-007
                // is a GE item. Rendered alone in its own cell rather than
                // beside a prose title, because the prefix IS the identifier an
                // operator matches a ledger id against.
                cell: (row) => <span className={styles.identifier}>{row.source}</span>,
              },
              { key: "items", header: "Items", align: "end", cell: (row) => row.items },
              { key: "gates", header: "Gates", align: "end", cell: (row) => row.gates },
              { key: "decided", header: "Decided", align: "end", cell: (row) => row.decided },
              { key: "remaining", header: "Remaining", align: "end", cell: (row) => row.remaining },
              { key: "percent", header: "Settled", align: "end", cell: (row) => `${row.percent}%` },
            ]}
            rows={sourceSummaries}
            rowKey={(row) => row.source}
            empty={
              <EmptyState
                headline="No phases in the snapshot"
                description="The generated file records no phases at all. That is a defect in tools/platform-truth.mjs — a programme with no work in it is not a state this repository can be in."
              />
            }
          />

          <Provenance
            asOf={
              <>
                the execution ledgers and the execution prompts at <Commit sha={truth.commit} />.
              </>
            }
            unknown={
              <>
                the state of {untranscribed} of the {programme.totalItems}{" "}
                items in any detail. {ledger.total} are transcribed into a ledger item by item; the
                rest are counted from the prompts&rsquo; own phase headings, and nothing here claims
                to know more about them than that they are not settled.
              </>
            }
          />
        </div>
      </Card>

      {/* ── Findings ──────────────────────────────────────────────────────── */}
      <Card
        headline="Open findings"
        headerAside={
          <Badge tone="bad" title="Open architecture-versus-inventory findings">
            {findings.length} open
          </Badge>
        }
        supportingText="Differences between the estate as inventoried and the architecture it is meant to be. Each carries the item that closes it, so a finding cannot sit in a document with nobody owning it."
      >
        <div className={styles.stack}>
          <DataTable
            caption="Every open finding, and the requirement item that owns it"
            columns={[
              { key: "finding", header: "Finding", cell: (row) => row.finding },
              {
                key: "owner",
                header: "Owned by",
                cell: (row) => <span className={styles.identifier}>{row.owner}</span>,
              },
            ]}
            rows={findings}
            rowKey={(row) => row.finding}
            empty={
              <EmptyState
                headline="No findings are open in this snapshot"
                description="A real absence, and a narrow one: it says the inventory found no difference in what it compared. It does not say the estate matches the architecture in the respects the inventory did not look at."
              />
            }
          />
          <Provenance
            asOf={
              <>
                the read-only inventory of {inventoryDate}, compiled at <Commit sha={truth.commit} />
                .
              </>
            }
            unknown={
              <>
                how urgent any of these are. These carry no severity, no SLA and no affected tenant
                — they are documentation and architecture gaps. The findings that DO carry severity
                and an SLA are on <Link href="/platform/security">Findings</Link>.
              </>
            }
          />
        </div>
      </Card>

      {/* ── Estate ────────────────────────────────────────────────────────── */}
      <Card
        headline="AWS estate"
        headerAside={
          /*
            The account and region as ONE text node inside the chip, with no
            inner span. `e2e/platform.spec.ts` locates the masked account with
            `getByText`, whose text engine resolves to the smallest element
            carrying the string; a chip wrapping a span wrapping the same string
            is two elements with identical text and a strict-mode violation, not
            a styling detail.
          */
          <Chip title="The account and region this inventory was taken in">
            account {estate.account} · {estate.region}
          </Chip>
        }
        supportingText="A read-only inventory, compiled at a commit. The account id is masked at the point the inventory is written, because this repository is public."
        actions={
          <ButtonLink href="/platform/estate" variant="text">
            The live estate read
          </ButtonLink>
        }
      >
        <div className={styles.stack}>
          <div className={styles.chips}>
            {Object.entries(estate.summary)
              // `deniedCalls` is not a resource count. Printing "3 denied calls"
              // in a row of service counts is how nine counts beside three
              // refusals read as complete-with-footnotes; the refusals get the
              // governed state block below instead, which is the shape that
              // says what the refusal LEFT.
              .filter(([key]) => key !== "deniedCalls")
              .map(([key, value]) => (
                <Chip key={key}>
                  {String(value)} {humanise(key)}
                </Chip>
              ))}
          </div>

          <DataTable
            caption="The facts the findings above refer to"
            columns={[
              { key: "fact", header: "Fact", cell: (row) => row.fact },
              { key: "state", header: "What the inventory found", cell: (row) => row.state },
            ]}
            rows={[
              {
                fact: "AWS Organization",
                state: estate.organizationInUse
                  ? "in use"
                  : "not in use — a single-account estate",
              },
              {
                fact: "OIDC providers",
                state:
                  estate.oidcProviders === 0
                    ? "none — every AWS workflow authenticates with a long-lived key"
                    : String(estate.oidcProviders),
              },
              {
                fact: "Cognito user pools",
                state: estate.cognitoUserPools === 0 ? "none" : String(estate.cognitoUserPools),
              },
              {
                fact: "Backup vaults",
                state: estate.backupVaults === 0 ? "none" : String(estate.backupVaults),
              },
            ]}
            rowKey={(row) => row.fact}
            empty={
              <EmptyState
                headline="The snapshot carries none of these facts"
                description="Not an estate with no Organization and no vaults — a snapshot in which those four reads are missing entirely. Regenerate it with npm run generate."
              />
            }
          />

          {/*
            STUDIO-030-006. This was a table of the three refusals and nothing
            else, which said what failed and never said what that left. An
            estate panel listing counts for nine services beside a list of three
            refused calls reads as complete-with-footnotes; it is not, and
            `degraded` is the word for it. `partialData` would be the wrong one
            — that names fields missing from ONE answer, and these are whole
            reads that never returned.
          */}
          {readState.kind === "whole" ? (
            <p className={`${styles.line} md3-body-medium`}>
              Every service read answered; nothing was refused.
            </p>
          ) : readState.kind === "down" ? (
            <ErrorState
              what="the AWS inventory"
              detail={readState.failing.map((f) => `${f.source} — ${f.why}`).join("\n")}
            />
          ) : (
            <DegradedState
              what="AWS inventory"
              working={readState.working}
              failing={readState.failing}
            />
          )}

          <Provenance
            asOf={
              <>
                the read-only inventory of {inventoryDate}, compiled at <Commit sha={truth.commit} />
                . It is a snapshot, not a live read.
              </>
            }
            unknown={
              <>
                anything the inventory was refused, and anything that has changed in the estate
                since {inventoryDate}. The refusals are named above rather than counted, because a
                refusal is evidence about the role that made it — all three here are Organizations
                calls, and their refusal is what says no Organization exists.
              </>
            }
          />
        </div>
      </Card>

      {/* ── Orphaned delivery path ────────────────────────────────────────── */}
      <Card
        headline="Queues with no producer and no consumer"
        headerAside={
          <Badge tone="warn" title="Provisioned queues that no package can write to or read from">
            {estate.sqsQueues.length} orphaned
          </Badge>
        }
        supportingText="The clearest infrastructure-versus-code drift in the estate, and the reason it is on a console rather than only in a document."
      >
        <div className={styles.stack}>
          <p className={`${styles.line} md3-body-medium`}>
            {estate.sqsQueues.length} queues and an SES identity are provisioned for a delivery path
            no package implements — nothing in the repository declares an SQS or an SES client. The
            dead-letter alarm below is in OK because nothing can write to the queue it watches.
          </p>
          {/*
            One text node per chip, no inner span. `e2e/platform.spec.ts`
            asserts each queue name with `getByText(queue, { exact: true })`,
            and a chip wrapping a span wrapping the same string resolves to two
            elements with identical text — a strict-mode violation rather than a
            styling detail.
          */}
          <div className={styles.chips}>
            {estate.sqsQueues.map((queue) => (
              <Chip key={queue}>{queue}</Chip>
            ))}
          </div>
          <Provenance
            asOf={
              <>
                the read-only inventory of {inventoryDate}, cross-read against the packages at{" "}
                <Commit sha={truth.commit} />.
              </>
            }
            unknown={
              <>
                whether anything OUTSIDE this repository writes to them. The claim here is that no
                package in this monorepo declares a client, which is what was searched — not that
                nothing on the internet can reach the queue.
              </>
            }
          />
        </div>
      </Card>

      {/* ── Alarms ────────────────────────────────────────────────────────── */}
      <Card
        headline="Alarms in this snapshot"
        supportingText="Deliberately thin. An alarm's STATE is not a verdict on whether it would tell anybody."
        actions={
          <ButtonLink href="/platform/health" variant="text">
            Alarms, read live, with verdicts
          </ButtonLink>
        }
      >
        <div className={styles.stack}>
          {/*
            STUDIO-080-008. Two things had to be true even in a snapshot.

            `alarmsUnavailable` distinguishes "the collector was refused" from
            "the account has no alarms". Before it existed, `aws()` returned null
            on a denial, `list(null)` was `[]`, and this rendered as no alarms at
            all — an operator reading a green console off a permission they did
            not have.

            And an alarm whose actions are disabled is reported as such rather
            than as its state. A disabled alarm in OK notifies nobody; printing
            OK for it is the most reassuring thing this page could get wrong.
          */}
          {alarmsUnavailable ? (
            <p className={`${styles.line} md3-body-medium`} data-testid="alarms-unavailable">
              Unknown — the inventory was refused <code>cloudwatch:DescribeAlarms</code>. This is not
              an estate with no alarms; it is an estate nobody was allowed to look at.
            </p>
          ) : (
            <DataTable
              caption="Every alarm the inventory could read, and what it was reporting"
              columns={[
                {
                  key: "name",
                  header: "Alarm",
                  cell: (row) => <span className={styles.identifier}>{row.name}</span>,
                },
                {
                  key: "state",
                  header: "In the snapshot",
                  cell: (row) =>
                    "actionsEnabled" in row && row.actionsEnabled === false
                      ? "ACTIONS OFF — it notifies nobody"
                      : row.state,
                },
              ]}
              rows={estate.alarms}
              rowKey={(row) => row.name}
              empty={
                <EmptyState
                  headline="No alarms"
                  description="CloudWatch answered and returned nothing. This is the real absence, not the refusal above it: an estate with nothing watching it."
                />
              }
            />
          )}
          <Provenance
            asOf={
              <>
                the read-only inventory of {inventoryDate}, compiled at <Commit sha={truth.commit} />
                .
              </>
            }
            unknown={
              <>
                whether any of these would actually tell anybody. A snapshot carries a state;{" "}
                <Link href="/platform/health">Health</Link> reads CloudWatch live and reports seven
                verdicts, including the four this table cannot express — disabled, stale, missing
                and unauthorized.
              </>
            }
          />
        </div>
      </Card>

      {/* ── Module adoption ───────────────────────────────────────────────── */}
      <Card
        headline="Module adoption"
        headerAside={
          <Badge tone="info" title="Modules in the catalog with at least one tenant running them">
            {adoption.filter((m) => m.tenants.length > 0).length} of {adoption.length} adopted
          </Badge>
        }
        supportingText="The blast radius of a lifecycle change, before it is made. Each row is a module in the catalog and the tenants that actually run it — resolved the same way each tenant resolves it, so a module a blueprint asks for and an entitlement refuses does not appear here. A row with no tenants is the one that can be retired for nothing."
      >
        <div className={styles.stack}>
          <p className={`${styles.line} md3-body-medium`}>
            <code>preset</code> means the tenant&rsquo;s archetype compiled to it; <code>edit</code>{" "}
            means that tenant added it on top. Deprecating a module nobody chose deliberately is a
            different conversation from deprecating one somebody asked for.
          </p>

          <DataTable
            caption="Every module in the catalog, and the tenants it would take with it"
            columns={[
              {
                key: "module",
                header: "Module",
                cell: (row) => (
                  <div className={styles.cell}>
                    <span className={styles.identifier}>{row.key}</span>
                    <span>{row.name}</span>
                  </div>
                ),
              },
              { key: "lifecycle", header: "Lifecycle", cell: (row) => row.lifecycle },
              {
                key: "commands",
                header: "Commands it contributes",
                cell: (row) =>
                  row.commands.length === 0 ? (
                    "none"
                  ) : (
                    <div className={styles.chips}>
                      {row.commands.map((command) => (
                        <Chip key={command.id} title={`Risk class: ${command.riskClass}`}>
                          {command.riskClass} · {command.label}
                        </Chip>
                      ))}
                    </div>
                  ),
              },
              {
                key: "tenants",
                header: "Tenants running it",
                cell: (row) =>
                  row.tenants.length === 0 ? (
                    "nobody"
                  ) : (
                    <div className={styles.chips}>
                      {row.tenants.map((tenant) => (
                        <Chip
                          key={tenant.slug}
                          title={`${tenant.displayName} — from the ${tenant.from}`}
                        >
                          <span className={styles.identifier}>{tenant.slug}</span> ·{" "}
                          {tenant.from === "preset" ? "preset" : "edit"}
                        </Chip>
                      ))}
                    </div>
                  ),
              },
            ]}
            rows={adoption}
            rowKey={(row) => row.key}
            empty={
              <EmptyState
                headline="The module catalog is empty in this build"
                description="Not a fleet that has adopted nothing — a build that resolves no modules for anyone. Nothing below can be read as a lifecycle decision until the catalog loads."
              />
            }
          />

          <Provenance
            asOf={
              <>
                this build — the module catalog and the tenant bindings compiled into the running
                console, resolved when this page was rendered. Not the snapshot.
              </>
            }
            unknown={
              <>
                whether a tenant&rsquo;s deployed cell has the module the binding says it should.
                This is what the bindings RESOLVE to; what a running cell has is a different
                question, and it is the one the row below answers.
              </>
            }
          />
        </div>
      </Card>

      {/* ── Release compatibility ─────────────────────────────────────────── */}
      <Card
        headline="Release compatibility"
        supportingText="Each tenant's published configuration against the engine version its cell reports. A cell older than the configuration it is asked to serve refuses rather than half-applying it: ignoring an unknown key would leave a setting the Studio shows as published quietly doing nothing, and applying one whose meaning has moved is worse."
      >
        <div className={styles.stack}>
          {fleetProblems.length > 0 ? (
            <>
              {/*
                The estate could not be resolved. Rendered as UNKNOWN rather
                than crashing the route: `fleet()` is right to refuse to invent
                an account, and a 500 turns that correct refusal into a console
                nobody can open.
              */}
              <UnknownState
                what="the fleet this engine runs in"
                principal="not known — sts:GetCallerIdentity did not answer"
                action="sts:GetCallerIdentity"
                minimumStatement={
                  '{"Effect":"Allow","Action":["sts:GetCallerIdentity"],"Resource":"*"}'
                }
              />
              <p className={`${styles.line} md3-body-medium`}>
                Set these in the console&rsquo;s environment, or grant the statement above to its
                task role so it can answer for itself:
              </p>
              <div className={styles.chips}>
                {fleetProblems.map((problem) => (
                  <Chip key={problem.field} title={problem.detail}>
                    <span className={styles.identifier}>{problem.field}</span>
                  </Chip>
                ))}
              </div>
            </>
          ) : (
            compatibility.map(({ cell, tenants }) => (
              <DataTable
                key={cell.cellId}
                caption={
                  <>
                    <span className={styles.identifier}>{cell.cellId}</span>, running release{" "}
                    <span className={styles.identifier}>{cell.release}</span>
                  </>
                }
                columns={[
                  {
                    key: "tenant",
                    header: "Tenant",
                    cell: (row) => (
                      <div className={styles.cell}>
                        <span className={styles.identifier}>{row.slug}</span>
                        <span>{row.displayName}</span>
                      </div>
                    ),
                  },
                  { key: "keys", header: "Keys set", align: "end", cell: (row) => row.keys.length },
                  {
                    key: "verdict",
                    header: "Verdict",
                    cell: (row) =>
                      row.verdict.compatible ? (
                        "compatible"
                      ) : (
                        <>
                          {row.verdict.problems.length} key
                          {row.verdict.problems.length === 1 ? "" : "s"} refused —{" "}
                          {[...new Set(row.verdict.problems.map((p) => p.reason))].join(", ")}
                        </>
                      ),
                  },
                ]}
                rows={tenants}
                rowKey={(row) => row.slug}
                empty={
                  <EmptyState
                    headline="No tenant is bound to this cell"
                    description="In this build's bindings, nothing is placed here — so there is no configuration to check against the release it reports. Not a cell that refused every tenant."
                  />
                }
              />
            ))
          )}

          <Provenance
            asOf={
              <>
                this build&rsquo;s tenant bindings, checked against the release each cell reports
                for itself when this page was rendered. Not the snapshot.
              </>
            }
            unknown={
              <>
                {fleetProblems.length > 0
                  ? "which account, region and partition this console is in, so no cell can be described at all — see above."
                  : cells && cells.some((cell) => cell.release === "unpinned")
                    ? "what release a cell reporting `unpinned` is actually running. SCHEMA_VERSION is not set in its environment, so every verdict beside it is a comparison against a version nobody declared."
                    : "whether the cell is serving the release it reports. This compares configuration against a cell's own claim about itself; nothing here re-reads the running engine to confirm it."}
              </>
            }
          />
        </div>
      </Card>

      {/* ── Ledger ────────────────────────────────────────────────────────
        The apparatus, and it goes last but one. Every transcribed ledger item,
        one row each, is the wall the answer at the top of this page is compiled
        FROM; behind a disclosure it is still one click away and no longer the
        first thing a reader meets. The summary states the count from the data
        rather than from a number written here.
        `globals.css` makes a closed `<details>` display:none its contents, so a
        collapsed wall does not leave a bounding box over the card below it.
      */}
      <Card
        headline="Execution ledger, item by item"
        headerAside={
          <Badge tone="neutral" title="Ledger items transcribed, and how many are implemented">
            {ledger.done} of {ledger.total} implemented
          </Badge>
        }
        supportingText="The transcribed half of the programme: the items that have a ledger entry, in the phase that owns them. This is the working behind the figure at the top of this page."
      >
        <div className={styles.stack}>
          <details className={styles.disclosure}>
            <summary className={`${styles.summary} md3-state md3-label-large`}>
              Show all {ledger.total} ledger items, phase by phase
            </summary>

            {ledger.phases.map((phase) => (
              <DataTable
                key={phase.phase}
                caption={`${phase.phase} — ${phase.items.filter((i) => i.done).length} of ${phase.items.length} implemented`}
                columns={[
                  { key: "state", header: "Done", cell: (item) => (item.done ? "yes" : "no") },
                  {
                    key: "id",
                    header: "Item",
                    cell: (item) => (
                      <span className={styles.identifier}>
                        {item.id}
                        {item.isGate ? " (gate)" : ""}
                      </span>
                    ),
                  },
                  { key: "title", header: "What it is", cell: (item) => item.title },
                ]}
                rows={phase.items.map((item, position) => ({ ...item, position }))}
                /*
                 * The id, DISAMBIGUATED BY POSITION, and not the id alone.
                 *
                 * The generated ledger genuinely repeats ids: `GE-051-005`
                 * appears four times in one phase because three of them are
                 * `*(continued)*` continuation lines of the fourth, and
                 * `GE-020-005` appears twice. Keying on the id alone made React
                 * log "Encountered two children with the same key" on every
                 * render of this page — which `e2e/platform.spec.ts` collects as
                 * an uncaught browser error and fails EVERY test in the file on,
                 * so the whole suite was red for a duplicate key nobody had
                 * looked at.
                 *
                 * The index is part of the identity here rather than a shortcut
                 * around one: within a phase whose ids repeat, "the third row"
                 * is the only thing that distinguishes two rows that share an
                 * id, and this list is a static server render with no
                 * reordering, filtering or selection state for a positional key
                 * to attach to the wrong row.
                 */
                rowKey={(item) => `${item.id}#${item.position}`}
                empty={
                  <EmptyState
                    headline="No transcribed items in this phase"
                    description="The phase exists in the prompt and has no ledger entries yet. Nothing here says the phase is empty of work."
                  />
                }
              />
            ))}
          </details>

          <Provenance
            asOf={
              <>
                the execution ledgers at <Commit sha={truth.commit} />.
              </>
            }
            unknown={
              <>
                anything about the {untranscribed} items that have no ledger
                entry yet. A missing row here is an item nobody has transcribed, not an item nobody
                has to do.
              </>
            }
          />
        </div>
      </Card>

      {/* ── Tests ─────────────────────────────────────────────────────────── */}
      <Card
        headline="Test suites"
        supportingText="The suites this repository runs, and what each of them is for."
      >
        <div className={styles.stack}>
          <DataTable
            caption="Every suite, its size, and what it covers"
            columns={[
              { key: "name", header: "Suite", cell: (row) => row.name },
              { key: "files", header: "Files", align: "end", cell: (row) => row.files },
              { key: "what", header: "What it covers", cell: (row) => row.what },
            ]}
            rows={suites}
            rowKey={(row) => row.name}
            empty={
              <EmptyState
                headline="The snapshot records no suites"
                description="The generator found no test directories to count. That is a fact about the generator's walk, not about whether this repository has tests."
              />
            }
          />
          <Provenance
            asOf={<>the repository at <Commit sha={truth.commit} />.</>}
            unknown={
              <>
                whether any of them pass. These are file counts taken by walking directories; no run
                is behind this table, and a suite with 90 files and 90 failures looks identical here
                to one that is green.
              </>
            }
          />
        </div>
      </Card>
    </div>
  )
}

/**
 * The two sentences every panel on this page ends with.
 *
 * A panel that states a number without stating when it was true is a panel that
 * will be believed after it stops being true, and a panel that is silent about
 * its blind spot is read as having none. Both are required of every card here,
 * so both are one component rather than a convention each card re-implements —
 * a convention is what the estate panel had and the test-suite panel did not.
 *
 * Neither prop is optional. "No as-of" and "nothing unknown" are claims, and a
 * card that has one of them has to write it down.
 */
function Provenance({ asOf, unknown }: { asOf: ReactNode; unknown: ReactNode }) {
  return (
    <div className={styles.provenance}>
      <p className={`${styles.line} md3-body-small`}>As of {asOf}</p>
      <p className={`${styles.line} md3-body-small`}>Not known: {unknown}</p>
    </div>
  )
}

/** A commit sha, in the mono stack, because it is compared character by character. */
function Commit({ sha }: { sha: string }) {
  return <code className={styles.identifier}>{sha}</code>
}

/**
 * `natGateways` → `nat gateways`.
 *
 * The inventory's summary keys are camel case because they are JSON keys. One
 * transform, in one place, so the chip row and the "sources answered" list in
 * the degraded state cannot spell the same read two different ways — which they
 * did, and which is what makes a working/failing ratio unverifiable by eye.
 */
function humanise(key: string): string {
  return key.replace(/([A-Z])/g, " $1").toLowerCase()
}
