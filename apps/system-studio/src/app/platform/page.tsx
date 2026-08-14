import type { ReactNode } from "react"

import Link from "next/link"

import { fleetCompatibility, moduleAdoption } from "@tenure/platform-config"

import { auth } from "@/lib/auth"
import { authorizeCommand } from "@/lib/authorize"
import { FleetMisconfigured, fleet, primeEstate } from "@/lib/cells"
import { operatorConfigProblems } from "@/lib/operators"
import truth from "@/generated/platform-truth.json"
import { ALL_CAPABILITIES, CAPABILITIES, IDENTITY_REFRESH_MS, minimumStatementText } from "@/lib/aws/capabilities"
import { identityHeadline, resolveIdentity } from "@/lib/aws/identity"
import { organizationSurface } from "@/lib/aws/organization"
import {
  DEFAULT_QUOTA_NOT_READABLE,
  QUOTA_PRESSURE_FRACTION,
  describeQuotaPressure,
  quotaReadings,
  type QuotaPressure,
} from "@/lib/aws/quotas"
import {
  Badge,
  ButtonLink,
  Card,
  Chip,
  DataTable,
  EmptyState,
  KeyValue,
  ProgressIndicator,
  StaleIndicator,
  UnknownState as AwsUnknownState,
  formatAge,
  type BadgeTone,
  type UnknownRead,
} from "@/components/md3"
import {
  DegradedState,
  ErrorState,
  PermissionDeniedState,
  UnknownState as FleetUnknownState,
  degradationOf,
} from "@/components/states"

import {
  ORGANIZATION_WORD,
  PRESSURE_WORD,
  VERDICT_WORD,
  buildProvenance,
  customerTenantsOnly,
  declaredActionCount,
  declaredBySurface,
  engineAnswer,
  maskAccountId,
  maskArn,
  maskUnknownRead,
  orgAccountRows,
  organizationAnswer,
  quotaCoverage,
  quotaRows,
  refusedReads,
  unknownArm,
  unreadableQuotas,
  type EngineVerdict,
  type OrganizationAnswer,
} from "./engine-answer"
import styles from "./platform.module.css"

export const dynamic = "force-dynamic"

/**
 * Is the engine itself healthy, and what does it currently know?
 *
 * That is the question this page answers, it is the first thing on the page in
 * those words, and the order of the cards below is the order of the answer:
 *
 *   1. the verdict, in a sentence, with every condition that is true right now;
 *   2. the build — which commit is serving this, and whether the figures
 *      compiled into it describe that commit;
 *   3. the identity — which account, region, partition and principal this
 *      process resolved for ITSELF, read live from STS on this render;
 *   4. what it may read, and what it was refused, with the IAM statement that
 *      would grant each refusal. This is the most valuable panel here: it is the
 *      console naming precisely what it cannot see;
 *   5. the ceilings it provisions into — the applied Service Quotas for every
 *      step of tenant creation, and what is left of each;
 *   6. whether this estate is one AWS account or many, read live rather than
 *      taken from a boolean a refused call produced;
 *   7. the ledger's real progress, which is the engine's own build-out.
 *
 * Panels 5 and 6 are live AWS reads and are grouped with 3 and 4 for that
 * reason: everything from 7 down is compiled or resolved from this build.
 *
 * Everything after that is apparatus. It is still on the page, it is still
 * dated, and `docs/architecture/studio-information-architecture.md` is the
 * authority on where it eventually lives.
 *
 * ── What the engine currently knows about itself ───────────────────────────
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
  /*
   * Before authentication, and it names what is missing.
   *
   * This used to render two sentences and throw the problems away, so the one
   * screen an operator meets when the console will not serve told them nothing
   * they could act on. `operatorConfigProblems()` returns the variable and the
   * detail for each; `src/app/page.tsx` has printed them since it was written,
   * and this is the same shape rather than a second one.
   */
  const misconfigured = operatorConfigProblems()
  if (misconfigured.length > 0) {
    return (
      <Card
        headline="Not configured"
        headerAside={<Badge tone="bad">refusing</Badge>}
        supportingText="The Studio refuses to serve until its access control is set up. Each variable below is read from this process's environment; none of them has a default, because a default here decides who may read every tenant's configuration."
        container="high"
        level={1}
      >
        <ul className="md3-body-medium">
          {misconfigured.map((problem) => (
            <li key={problem.variable}>
              <code className={styles.identifier}>{problem.variable}</code> — {problem.detail}
            </li>
          ))}
        </ul>
      </Card>
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
  /*
   * And filtered to the tenants that exist.
   *
   * `moduleAdoption()` folds over `TENANT_BINDINGS`, which is the compiled set
   * INCLUDING the three fixtures that exercise the platform. This panel listed
   * them beside the one real pilot, presented identically, on a page an
   * operator decides a module's lifecycle from. `customerTenantsOnly` is the
   * same rule `CUSTOMER_TENANT_BINDINGS` states, applied at the surface —
   * see the note on it for why not at the source.
   */
  const adoption = moduleAdoption().map((module) => ({
    ...module,
    tenants: customerTenantsOnly(module.tenants),
  }))

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
  // Filtered for the same reason `adoption` is: `fleetCompatibility` folds over
  // the unfiltered bindings, and a fixture organisation's configuration
  // compared against a real cell's release is a verdict about nothing.
  const compatibility = (cells ?? []).map((cell) => ({
    cell,
    tenants: customerTenantsOnly(fleetCompatibility(cell.release)),
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

  /*
   * ── The engine describing itself ─────────────────────────────────────────
   *
   * One live AWS call, and it is the right one: `sts:GetCallerIdentity` is the
   * only read that answers "who am I" rather than "what is out there". Every
   * other figure on this page is a statement ABOUT an account, and until this
   * answers, none of them is attributed to one.
   *
   * It is awaited without a try/catch on purpose — `resolveIdentity` returns an
   * `AwsRead`, never throws, and its failing arms are rendered rather than
   * crashed on. That is what keeps this console booting with no AWS credentials
   * at all: the panel says UNKNOWN and names the principal, the action and the
   * statement, and the other nine cards still render.
   */
  const identity = await resolveIdentity()

  /*
   * ── And the two things about itself it could not previously say ──────────
   *
   * `quotas.ts` and `organization.ts` are real, tested readers, each with a
   * capability and an IAM grant, and until this render neither reached a
   * screen: `quotaReadings` fed `estateInventory` only as a coverage SIGNAL —
   * a section state, never a single applied value — and `organizationSurface`
   * was called from nothing at all. That is the same reachability failure this
   * page's own first paragraph is about.
   *
   * Both are awaited here rather than inside their cards, together, because
   * they are independent reads and serialising them would add the slower one's
   * latency to the faster one's for nothing. Neither throws: `quotaReadings`
   * returns `AwsRead`s per target and `organizationSurface` catches the one
   * exception that is an answer (`AWSOrganizationsNotInUseException`), so this
   * console still boots with no AWS credentials at all — every arm below is a
   * rendered state rather than a crash.
   */
  const [quotas, organization] = await Promise.all([quotaReadings(), organizationSurface()])

  /*
   * The account, region and partition this render resolved, or null.
   *
   * Passed into both cards so a refusal can name where it was refused, and —
   * the part that matters — so the account id can be MASKED before it reaches
   * `UnknownState`, which renders what it is given. `e2e/platform.spec.ts`
   * fails this whole page on twelve consecutive digits anywhere in its text.
   */
  const identityFacts =
    identity.state === "ACTUAL" || identity.state === "STALE"
      ? {
          accountId: identity.value.accountId,
          region: identity.value.region,
          partition: identity.value.partition,
        }
      : null

  /*
   * Every refusal that reaches `UnknownState` from this render goes through
   * here first.
   *
   * `UnknownState` renders the account and the principal it is given, which is
   * correct — deciding what a page may publish is not a presentational
   * component's business. The decision belongs to the page, and this is it: one
   * call site per card would be two places for the mask to be forgotten, and
   * the one that is forgotten is the one that prints twelve digits in
   * production while CI, which has no credentials and therefore no account id,
   * stays green.
   */
  const masked = (read: UnknownRead): UnknownRead =>
    maskUnknownRead(read, identityFacts?.accountId ?? null)

  const ceilings = quotaRows(quotas)
  const ceilingsUnread = unreadableQuotas(quotas, identityFacts?.accountId ?? null)
  const coverage = quotaCoverage(quotas)
  const org = organizationAnswer(organization.organization, identityFacts)
  const orgAccountsUnknown = unknownArm(organization.accounts)

  const provenance = buildProvenance({
    runningCommit: buildCommit,
    snapshotCommit: truth.commit,
  })
  const refusals = refusedReads(denied)
  const surfaces = declaredBySurface(refusals)
  const answer = engineAnswer({
    identityState: identity.state,
    build: provenance.verdict,
    refusedReads: refusals.length,
    answeredReads: answeredReads.length,
  })

  return (
    <div className={styles.page}>
      {/*
        The question, in words, before any apparatus — and then the answer to
        it. An operator who reads only the first two paragraphs of this page has
        been told whether to keep reading.
      */}
      <header>
        <h1 className="md3-headline-large">Platform</h1>
        <p className={`${styles.line} md3-title-medium`}>
          Is the engine itself healthy, and what does it currently know?
        </p>
        <p className={`${styles.line} md3-body-medium`}>{answer.headline}</p>
      </header>

      {/* ── The answer ────────────────────────────────────────────────────
        Every condition that is true right now, not just the worst one. The
        verdict and this list cannot disagree: `engineAnswer` defines the
        reassuring arm as the one in which this list is empty, and
        `engine-answer.test.ts` asserts that equivalence over every combination
        of identity state, build verdict and refusal count.
      */}
      <Card
        headline="What this page found"
        headerAside={
          <Badge tone={VERDICT_TONE[answer.verdict]} title="The verdict this page reached, in a word">
            {VERDICT_WORD[answer.verdict]}
          </Badge>
        }
        supportingText="Three things are checked here and nothing else is: whether this engine can name the account it is running as, whether the build serving this page is the commit its figures were compiled at, and whether every read behind those figures answered."
      >
        <div className={styles.stack}>
          {answer.findings.length === 0 ? (
            <p className={`${styles.line} md3-body-medium`}>
              Nothing was found by those three checks. That is a narrow statement and it is meant to
              be: it says the checks on this page passed, not that the platform is well.
            </p>
          ) : (
            <ul className="md3-body-medium">
              {answer.findings.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          )}
          <Provenance
            asOf={
              <>
                this render. The identity check is a live <code className={styles.identifier}>sts:GetCallerIdentity</code>;
                the build and refusal checks are this build&rsquo;s environment against the snapshot
                compiled at <Commit sha={truth.commit} />.
              </>
            }
            unknown={
              <>
                everything these three checks do not look at. This is not a health verdict on the
                fleet — <Link href="/platform/health">Health</Link> reads CloudWatch live for that —
                and it is not a security verdict; <Link href="/platform/security">Findings</Link> is.
              </>
            }
          />
        </div>
      </Card>

      {/* ── The build ─────────────────────────────────────────────────────
        GE-022-006. Every figure compiled into the snapshot was taken at a
        commit, and when the running build knows its own commit and it differs,
        this page is describing an older repository — which is worse than
        showing nothing, because the numbers still look authoritative.

        Keyed on a commit mismatch rather than an age threshold: a page whose
        output changes with the clock cannot be tested deterministically, and a
        staleness warning that appears on a timer is one people learn to ignore.

        The third state is the one this page used to be missing. An unstamped
        build cannot show drift AND cannot show freshness, and folding it into
        "no warning" published a freshness claim out of an absence of evidence
        on every machine whose pipeline had not set the variable.
      */}
      <Card
        headline="This build, and the figures compiled into it"
        headerAside={
          <Badge tone={BUILD_TONE[provenance.verdict]} title="Whether the compiled figures describe the running code">
            {provenance.verdict === "MATCHED"
              ? "snapshot matches this build"
              : provenance.verdict === "DRIFTED"
                ? "snapshot is from another commit"
                : "build not stamped"}
          </Badge>
        }
        supportingText="Nothing on this page is typed in. Every compiled figure comes from one generated artifact, and this card is the check that the artifact describes the code serving it."
      >
        <div className={styles.stack}>
          <KeyValue
            ariaLabel="This build and the artifact it reports"
            items={[
              {
                key: "running",
                term: "Commit this console is running",
                value: buildCommit ? (
                  <code className={styles.identifier}>{buildCommit}</code>
                ) : (
                  // Never a dash and never "unknown" alone. The variable that
                  // would supply it is named, because that is the whole remedy.
                  <>
                    not stamped — <code className={styles.identifier}>BUILD_COMMIT</code> is unset in
                    this process&rsquo;s environment
                  </>
                ),
              },
              {
                key: "snapshot",
                term: "Commit the snapshot was compiled at",
                value: <code className={styles.identifier}>{truth.commit}</code>,
              },
              {
                key: "generator",
                term: "Compiled by",
                value: <code className={styles.identifier}>{truth.generatedBy}</code>,
              },
              {
                key: "inventory",
                term: "Read-only AWS inventory taken",
                value: inventoryDate,
              },
              { key: "verdict", term: "Verdict", value: provenance.sentence },
            ]}
          />
          {provenance.fix ? (
            <p className={`${styles.line} md3-body-medium`}>{provenance.fix}</p>
          ) : null}
          <Provenance
            asOf={
              <>
                the artifact at <Commit sha={truth.commit} /> and this process&rsquo;s environment,
                read on this render.
              </>
            }
            unknown={
              <>
                {provenance.verdict === "UNSTAMPED"
                  ? "whether the snapshot describes the code serving this page. Without a build stamp there is no evidence either way, and this card claims neither."
                  : "how old the artifact is in wall-clock time. The check here is a commit comparison, which is exact and deterministic; an hours-old threshold would change this page's output with the clock."}
              </>
            }
          />
        </div>
      </Card>

      {/* ── Identity ──────────────────────────────────────────────────────
        STUDIO-000-006. The one live AWS read on this page, and the only one
        that answers "who am I" rather than "what is out there".

        The account id is masked here for the same reason the inventory writer
        masks it: `e2e/platform.spec.ts` asserts that no twelve consecutive
        digits appear anywhere in this page's text, and a live read returns the
        real thing. Masking one card and not the other would not be masking.
      */}
      <Card
        headline="The identity this engine is running as"
        headerAside={
          <Badge
            tone={identity.state === "ACTUAL" || identity.state === "STALE" ? "ok" : "bad"}
            title="Whether sts:GetCallerIdentity answered on this render"
          >
            {identity.state}
          </Badge>
        }
        supportingText="Resolved from AWS on this render, never from a compiled-in literal. Every account-scoped statement elsewhere on this console is a statement about whatever this says."
      >
        <div className={styles.stack}>
          {identity.state === "ACTUAL" || identity.state === "STALE" ? (
            <KeyValue
              ariaLabel="The account, region, partition and principal this engine resolved for itself"
              items={[
                {
                  key: "account",
                  term: "Account",
                  value: (
                    <code className={styles.identifier}>{maskAccountId(identity.value.accountId)}</code>
                  ),
                  asOf: { at: identity.asOf, cadenceMs: IDENTITY_REFRESH_MS },
                },
                {
                  key: "region",
                  term: "Region",
                  value: <code className={styles.identifier}>{identity.value.region}</code>,
                },
                {
                  key: "partition",
                  term: "Partition",
                  value: <code className={styles.identifier}>{identity.value.partition}</code>,
                },
                {
                  key: "principal",
                  term: "Principal",
                  value: (
                    <code className={styles.identifier}>
                      {maskArn(identity.value.arn, identity.value.accountId)}
                    </code>
                  ),
                },
              ]}
            />
          ) : identity.state === "EMPTY" ? (
            // Not reachable through `resolveIdentity`, which passes
            // `isEmpty: () => false` — but the union has the arm, so this file
            // says what it would mean rather than falling through to a blank.
            <p className={`${styles.line} md3-body-medium`}>{identityHeadline(identity)}</p>
          ) : (
            <AwsUnknownState what="the identity this engine is running as" read={identity} />
          )}
          <Provenance
            asOf={
              <>
                this render.{" "}
                {identity.state === "ACTUAL" || identity.state === "STALE"
                  ? `The reading is re-resolved at most every ${formatAge(IDENTITY_REFRESH_MS)}, and cleared on any denial so a role rotated underneath a running container is picked up on the next read.`
                  : "There is no reading — the arm above says why, and nothing here is held over from an earlier one."}
              </>
            }
            unknown={
              <>
                what this principal is actually PERMITTED to do. An ARN says who the call was made
                as, not what the policy attached to it allows; the card below reports only the reads
                that were attempted and refused, which is the only direct evidence this page has.
              </>
            }
          />
        </div>
      </Card>

      {/* ── Capabilities ──────────────────────────────────────────────────
        STUDIO-000-007 / STUDIO-070-004. The panel the operator came for.

        Two halves, and the order is deliberate: what was REFUSED first, with
        the statement that grants it, then what the engine declares it is able
        to ask for at all. A refusal rendered without its remedy is a refusal
        that stays, and a refusal rendered as an empty list is the defect the
        whole `AwsRead` union exists to prevent.
      */}
      <Card
        headline="What this engine may read, and what it was refused"
        headerAside={
          <Badge
            tone={refusals.length === 0 ? "ok" : "warn"}
            title="Reads the committed inventory recorded as refused"
          >
            {refusals.length} refused
          </Badge>
        }
        supportingText={`${ALL_CAPABILITIES.length} reads are declared in this engine's capability registry, needing ${declaredActionCount()} distinct IAM actions across ${surfaces.length} surfaces. The registry is a closed list compiled into this build — there is no endpoint that takes a service and an action, so what this console is able to ask AWS for is exactly what is counted here.`}
      >
        <div className={styles.stack}>
          <DataTable
            caption="Every read that was refused, and the statement that would grant it"
            columns={[
              {
                key: "call",
                header: "Call",
                cell: (row) => <span className={styles.identifier}>{row.call}</span>,
              },
              { key: "reason", header: "What was recorded", cell: (row) => row.reason },
              {
                key: "capability",
                header: "Capability",
                cell: (row) =>
                  row.capability ? (
                    <span className={styles.identifier}>{row.capability}</span>
                  ) : (
                    // The honest arm. The collector makes this call and the
                    // engine declares no capability for it, so no statement is
                    // derived — a plausible one that grants nothing is worse
                    // than none.
                    "not declared by this engine"
                  ),
              },
              {
                key: "statement",
                header: "Minimum IAM statement",
                cell: (row) =>
                  row.minimumStatement ? (
                    <div className={styles.cell}>
                      {/*
                        `<pre>` because an operator pastes this into a policy
                        document, and a statement re-wrapped by the layout is one
                        they have to repair by hand. `.md3-unknown-statement`
                        scrolls inside itself at 320 CSS pixels.
                      */}
                      <pre className="md3-unknown-statement">
                        <code>{row.minimumStatement}</code>
                      </pre>
                      <span>
                        {row.statementSource === "recorded"
                          ? "as the collector recorded it at the moment of the refusal"
                          : "derived from this engine's capability registry"}
                      </span>
                    </div>
                  ) : (
                    "none — this engine declares no capability for that call, so it derives no statement"
                  ),
              },
            ]}
            rows={refusals}
            rowKey={(row) => row.key}
            empty={
              <EmptyState
                headline="No read was recorded as refused"
                description="A real absence, and a narrow one: the inventory recorded no refusal for the calls it made. It says nothing about the reads it did not attempt — those are counted in the table below and are not evidence of a grant."
              />
            }
          />

          <DataTable
            caption="What this engine declares it can ask for, by the surface it feeds"
            columns={[
              {
                key: "surface",
                header: "Surface",
                cell: (row) => <span className={styles.identifier}>{row.surface}</span>,
              },
              { key: "reads", header: "Reads", align: "end", cell: (row) => row.capabilities },
              { key: "actions", header: "IAM actions", align: "end", cell: (row) => row.actions },
              {
                key: "cadence",
                header: "Fastest refresh",
                align: "end",
                // Rendered with the same formatter every "as of" line on this
                // console uses, so two panels cannot print one window two ways.
                cell: (row) => formatAge(row.fastestRefreshMs),
              },
              {
                key: "refused",
                header: "Refused",
                align: "end",
                cell: (row) => (row.refused === 0 ? "none recorded" : row.refused),
              },
            ]}
            rows={surfaces}
            rowKey={(row) => row.surface}
            empty={
              <EmptyState
                headline="The capability registry is empty in this build"
                description="Not an engine that may read nothing — a build in which src/lib/aws/capabilities.ts resolved to no entries at all. Nothing on this console can read AWS until it loads."
              />
            }
          />

          <Provenance
            asOf={
              <>
                the capability registry compiled into THIS build, and the refusals recorded by the
                read-only inventory of {inventoryDate}, compiled at <Commit sha={truth.commit} />.
              </>
            }
            unknown={
              <>
                whether the {ALL_CAPABILITIES.length - refusals.length} reads with no refusal
                recorded against them are actually granted. Nothing here probed them — a read that
                was never attempted is not evidence of a permission, and this table deliberately
                does not count it as one. The direct evidence this page holds is the identity read
                above and the {refusals.length} refusals below it.
              </>
            }
          />
        </div>
      </Card>

      {/* ── The ceilings ──────────────────────────────────────────────────
        STUDIO-120-011, the read half of it.

        A distribution engine that provisions a tenant stack — a VPC, security
        groups and their rules, an ECS service, an ALB and its target groups, an
        RDS instance, a CloudFront distribution, an ACM certificate, a Lambda
        concurrency reservation, a Cognito pool and an SES allowance — meets an
        account or regional ceiling on every one of those. Until this card
        existed the only way this platform discovered one was a `LimitExceeded`
        in the middle of a provisioning run with a half-created tenant behind
        it. `quotas.ts` has asked AWS since it was written; nothing rendered the
        answer.

        Two things this card is careful about, and both are the reader's rules
        rather than this page's:

          * an applied value never appears without "against the AWS default:
            not known" beside it, because the default is not in any response
            this engine may fetch and a value printed alone reads as the
            default;
          * a quota with no usage number prints "usage not known", never a
            headroom. A lower bound on usage is an upper bound on headroom, and
            only the upper bound is safe to show — "at most 1 VPC left" is a
            sentence an operator acts on.
      */}
      <Card
        headline="The ceilings this engine provisions into"
        headerAside={
          <Badge
            tone={PRESSURE_TONE[quotas.pressure.kind]}
            title="Whether any quota this estate provisions into is near its applied value"
          >
            {PRESSURE_WORD[quotas.pressure.kind]}
          </Badge>
        }
        supportingText={`Read live from Service Quotas on this render: ${coverage.targets} quotas across ${quotas.services.length} service codes, chosen because each one bounds a step of tenant provisioning. A quota is a limit rather than a resource, so nothing here is an inventory — it is the room this platform has left to grow.`}
      >
        <div className={styles.stack}>
          <p className={`${styles.line} md3-body-medium`}>
            {describeQuotaPressure(quotas.pressure)}
          </p>
          <p className={`${styles.line} md3-body-medium`}>{coverage.sentence}</p>

          <KeyValue
            ariaLabel="How this reading was taken, and what it cannot say"
            items={[
              {
                key: "raised",
                term: "Whether these values were raised from the AWS default",
                // Never "no". The one field on this card that is a statement
                // about this engine's own permissions rather than about AWS.
                value: `Not known. ${DEFAULT_QUOTA_NOT_READABLE.why} Grant ${DEFAULT_QUOTA_NOT_READABLE.iamAction} and add it to the capability registry to answer it.`,
              },
              {
                key: "calls",
                term: "How it was read",
                value: `${quotas.services.length} servicequotas:ListServiceQuotas calls, one per service code, with ${quotas.individualReads} individual servicequotas:GetServiceQuota call${quotas.individualReads === 1 ? "" : "s"} for targets a listing did not carry.`,
                asOf: { at: quotas.asOf, cadenceMs: quotas.refreshMs.listing },
              },
              {
                key: "pressure",
                term: "What counts as pressure",
                value: `${Math.round(QUOTA_PRESSURE_FRACTION * 100)}% of the applied value, measured against a usage number where there is one. It is the reader's own constant, not a threshold typed on this page.`,
              },
            ]}
          />

          <DataTable
            caption="Every quota that bounds tenant provisioning, and what is left of it"
            columns={[
              {
                key: "quota",
                header: "Quota",
                cell: (row) => (
                  <div className={styles.cell}>
                    <span>{row.quotaName}</span>
                    <span className={styles.identifier}>
                      {row.serviceCode}/{row.quotaCode}
                    </span>
                    <span>Running out of it means {row.bounds}.</span>
                  </div>
                ),
              },
              {
                key: "applied",
                header: "Applied value",
                cell: (row) => (
                  <div className={styles.cell}>
                    <span>{row.applied}</span>
                    <span>{row.raised}</span>
                    {row.truncated ? <span>Service listing {row.truncated}</span> : null}
                    <span>Resolved via {row.provenance}.</span>
                    <StaleIndicator
                      asOf={row.asOf}
                      cadenceMs={row.refreshMs}
                      label={`the applied value of ${row.quotaName}`}
                    />
                  </div>
                ),
              },
              { key: "scope", header: "Scope", cell: (row) => row.scope },
              { key: "usage", header: "In use", cell: (row) => row.usage },
              { key: "headroom", header: "Headroom", cell: (row) => row.headroom },
              { key: "owner", header: "Owned by", cell: (row) => row.attribution },
            ]}
            rows={ceilings}
            rowKey={(row) => row.key}
            empty={
              <EmptyState
                headline="No applied value was read on this render"
                description="Not an estate with no ceilings — every quota this platform provisions into still exists and still bounds a provisioning run. The reads that would have said what they are did not answer, and each one is named below with the principal, the action and the statement that would grant it."
              />
            }
          />

          {/*
            One block per way a read failed, not one per target: a denied
            listing for `vpc` is a single missing grant that answers for every
            `vpc` quota, and printing it three times would report three
            problems. `unreadableQuotas` groups on the service, the state AND
            the capability, so a denied listing and an errored individual
            fallback stay two blocks with two different remedies.
          */}
          {ceilingsUnread.map((group) => (
            <AwsUnknownState key={group.key} what={group.what} read={group.read} />
          ))}

          <Provenance
            asOf={
              <>
                this render — a live <code className={styles.identifier}>servicequotas:ListServiceQuotas</code>{" "}
                per service code, re-read at most every{" "}
                {formatAge(quotas.refreshMs.listing)}. Nothing on this card comes from the
                snapshot.
              </>
            }
            unknown={
              <>
                the AWS default behind every one of these values, so whether any of them was
                raised; and exact usage for the{" "}
                {coverage.usageUnknown} quota{coverage.usageUnknown === 1 ? "" : "s"} whose
                consumption is a CloudWatch metric this engine holds no{" "}
                <code className={styles.identifier}>cloudwatch:GetMetricData</code> capability to
                read. Where a usage number comes from the tag index it counts only resources
                carrying at least one tag, so it is a lower bound on usage and the headroom beside
                it is an upper bound — never a remainder.
              </>
            }
          />
        </div>
      </Card>

      {/* ── The Organization ──────────────────────────────────────────────
        STUDIO-010-001 and STUDIO-010-002, read live rather than asserted.

        The estate card below still renders this from the compiled snapshot,
        where the boolean came from a CI script whose `describe-organization`
        call was DENIED and whose helper turned the denial into a falsy value —
        the console told operators there was no Organization on the strength of
        not being allowed to ask. `organization.ts` has three states and no arm
        that permits that collapse, and this is the card that renders them.

        The estate here genuinely has no Organization, and that is a real
        answer with consequences rather than an empty table: `organizationAnswer`
        carries them, because "not in use" printed alone is technically correct
        and tells an operator nothing they can act on.
      */}
      <Card
        headline="Whether this estate has an AWS Organization"
        headerAside={
          <Badge
            tone={ORGANIZATION_TONE[org.kind]}
            title="What organizations:DescribeOrganization answered on this render"
          >
            {ORGANIZATION_WORD[org.kind]}
          </Badge>
        }
        supportingText="One account or many is the fact every account-scoped statement on this console rests on, and it is the fact three requirements in the account-topology group are graded against. Read live here; the estate card below is the compiled snapshot of the same question and says so."
      >
        <div className={styles.stack}>
          <p className={`${styles.line} md3-body-medium`}>{org.sentence}</p>

          {org.kind === "in-use" ? (
            <>
              <KeyValue
                ariaLabel="The Organization this account manages"
                items={[
                  {
                    key: "id",
                    term: "Organization",
                    value: <code className={styles.identifier}>{org.organizationId}</code>,
                    asOf: {
                      at: org.asOf,
                      cadenceMs: CAPABILITIES["organizations:DescribeOrganization"].refreshMs,
                    },
                  },
                  {
                    key: "management",
                    term: "Management account",
                    value: <code className={styles.identifier}>{org.managementAccountId}</code>,
                  },
                  {
                    key: "arn",
                    term: "Management account ARN",
                    value: <code className={styles.identifier}>{org.managementAccountArn}</code>,
                  },
                  { key: "features", term: "Feature set", value: org.featureSet },
                ]}
              />
              {orgAccountsUnknown ? (
                // The Organization answered and the account list did not. Two
                // reads, two grants, and the second one's failure is not
                // allowed to render as an Organization with no accounts.
                <AwsUnknownState
                  what="the accounts in this Organization"
                  read={masked(orgAccountsUnknown)}
                />
              ) : (
                <DataTable
                  caption="Every account in this Organization"
                  columns={[
                    {
                      key: "id",
                      header: "Account",
                      cell: (row) => <span className={styles.identifier}>{row.id}</span>,
                    },
                    { key: "name", header: "Name", cell: (row) => row.name },
                    { key: "status", header: "Status", cell: (row) => row.status },
                  ]}
                  rows={
                    organization.accounts.state === "ACTUAL" ||
                    organization.accounts.state === "STALE"
                      ? orgAccountRows(organization.accounts.value)
                      : []
                  }
                  rowKey={(row) => row.key}
                  empty={
                    <EmptyState
                      headline="Organizations answered with no accounts"
                      description="A real absence and a strange one: an Organization exists and contains no account, not even the management account that created it. This is the EMPTY reading, not a refusal — the refusal has its own block and does not reach here."
                    />
                  }
                />
              )}
            </>
          ) : org.kind === "none" ? (
            <>
              <ul className="md3-body-medium">
                {org.consequences.map((consequence) => (
                  <li key={consequence}>{consequence}</li>
                ))}
              </ul>
              {/*
                And the account read that was never made, rendered as the
                UNCONFIGURED reading it is rather than as an empty table. The
                distinction is the whole point of `AwsRead`: "there is no
                Organization to list accounts from" is a different sentence from
                "this Organization has no accounts", and only one of them is
                true here.
              */}
              {orgAccountsUnknown ? (
                <AwsUnknownState
                  what="the accounts in this Organization"
                  read={masked(orgAccountsUnknown)}
                />
              ) : null}
            </>
          ) : (
            <AwsUnknownState
              what="whether this estate has an AWS Organization"
              read={org.read}
            />
          )}

          <Provenance
            asOf={
              <>
                this render — a live{" "}
                <code className={styles.identifier}>organizations:DescribeOrganization</code>, re-read
                at most every{" "}
                {formatAge(CAPABILITIES["organizations:DescribeOrganization"].refreshMs)}.
              </>
            }
            unknown={
              <>
                the roots and the organizational units. This engine declares no{" "}
                <code className={styles.identifier}>organizations:ListRoots</code> capability, so
                the OU hierarchy STUDIO-010-003 asks for is not read at all — an empty root list
                here would be the absence of a read rather than a reading of an absence, and none
                is rendered for that reason. Whether workloads are kept OUT of a management
                account is a separate verdict; <Link href="/platform/estate">Estate</Link> reads it.
              </>
            }
          />
        </div>
      </Card>

      {/* ── The programme ─────────────────────────────────────────────────
        The engine's own build-out, and the last of the panels that answer the
        question at the top. Everything after this card is apparatus.
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
          {/*
            The MD3 primitive, which is a real `<progress>` element.

            This was a `<div role="meter">` whose fill was an inline
            `style={{ inlineSize }}`. Both halves of that were defects: an
            inline style in a product module is the hole the first literal
            colour arrives through, and `role="meter"` is the wrong role — a
            meter is a static gauge within a known range, and this is progress
            toward completion, which is `progressbar`. `<progress value max>`
            brings the role, `aria-valuenow` and a text fallback with no style
            attribute anywhere. `e2e/platform.spec.ts` was updated to match, and
            asserts the same two numbers it always did.
          */}
          <ProgressIndicator
            label="Programme settled"
            value={percentValue}
            valueText={`${percent}%`}
          />
          {/*
            `percentValue` is the number the bar carries and `percent` is the
            string beside it; both come from the same division, so the bar and
            the label cannot disagree.
          */}

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
                /*
                 * The one row on this page that used to state a fact it had not
                 * read. `estate.organizationInUse` is written by
                 * `tools/aws-inventory.mjs`, whose own note says "Organizations
                 * not in use, OR not visible to this principal" — the collector
                 * cannot tell those apart, and the falsy value it writes for
                 * both was rendered here as "not in use — a single-account
                 * estate". The console asserted an answer on the strength of
                 * not being allowed to ask.
                 *
                 * The boolean is still shown, because it is what the snapshot
                 * carries and this card is the snapshot. What changed is that
                 * it no longer speaks for AWS: the live three-state read is in
                 * the card above and it is the one that distinguishes them.
                 */
                fact: "AWS Organization",
                state: estate.organizationInUse
                  ? "in use, according to the snapshot"
                  : "the snapshot records no Organization — but its collector cannot tell that from a refused call, and it recorded organizations:DescribeOrganization as refused. See the live read above, which distinguishes the two.",
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
        supportingText="The blast radius of a lifecycle change, before it is made. Each row is a module in the catalog and the tenants that actually run it — resolved the same way each tenant resolves it, so a module a blueprint asks for and an entitlement refuses does not appear here. Only real customers are listed; the fixture organisations that exercise the platform are excluded, because a row an operator counts as adoption must be an organisation that exists. A row with no tenants is the one that can be retired for nothing."
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
        supportingText="Each real customer's published configuration against the engine version its cell reports — the fixture organisations are excluded here too. A cell older than the configuration it is asked to serve refuses rather than half-applying it: ignoring an unknown key would leave a setting the Studio shows as published quietly doing nothing, and applying one whose meaning has moved is worse."
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
              <FleetUnknownState
                what="the fleet this engine runs in"
                // The principal from the identity read taken at the top of this
                // render, not a sentence written here. When identity DID answer,
                // the fleet is unresolved for the other reason — the environment
                // — and saying "STS did not answer" would have sent an operator
                // to fix a read that is working.
                principal={
                  identity.state === "ACTUAL" || identity.state === "STALE"
                    ? maskArn(identity.value.arn, identity.value.accountId)
                    : identityHeadline(identity)
                }
                action="sts:GetCallerIdentity"
                // From the capability registry, not typed here. A statement
                // written into a page is one more copy to keep in step with the
                // grant and the guard, and the copy that drifts is the one an
                // operator pastes.
                minimumStatement={minimumStatementText("sts:GetCallerIdentity")}
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
 * The tone each verdict wears, in one place.
 *
 * A `Record` over the closed union rather than a chain of ternaries, so a
 * verdict added to `engine-answer.ts` fails to compile here until somebody
 * decides what it looks like — which is the only way a new failure state does
 * not silently inherit the reassuring default. The WORD is what carries the
 * meaning either way (`VERDICT_WORD`); the tone only tints the pill, because
 * meaning conveyed by colour alone is forbidden on this console.
 */
const VERDICT_TONE: Readonly<Record<EngineVerdict, BadgeTone>> = {
  BLIND: "bad",
  STALE_BUILD: "bad",
  UNVERIFIED_BUILD: "warn",
  PARTIAL: "warn",
  HEALTHY: "ok",
}

/**
 * And the build's, on the same principle.
 *
 * `UNSTAMPED` is `warn`, not `neutral`. A build that cannot say what it is is
 * not a neutral fact about the deployment — it is the reason nothing on this
 * page can be dated — and a grey pill beside it would read as "fine".
 */
const BUILD_TONE: Readonly<Record<ReturnType<typeof buildProvenance>["verdict"], BadgeTone>> = {
  MATCHED: "ok",
  DRIFTED: "bad",
  UNSTAMPED: "warn",
}

/**
 * And the quota pressure state's.
 *
 * `no-usage-known` is `warn` rather than `ok` deliberately, and it is the arm
 * this estate is actually in for most of its ceilings. Quotas were read and not
 * one of them was compared against a usage number: nothing was established, and
 * a green pill over "nothing was established" is the reassurance defect this
 * whole page is built against. `clear` is the only arm that earns `ok`, and the
 * reader only reaches it when at least one quota really was compared.
 */
const PRESSURE_TONE: Readonly<Record<QuotaPressure["kind"], BadgeTone>> = {
  unknown: "bad",
  "no-usage-known": "warn",
  clear: "ok",
  "at-risk": "bad",
}

/**
 * And the Organization answer's.
 *
 * `none` is `info`, not `warn`. A single-account estate is a legitimate answer
 * to STUDIO-010-001 — its own sentence ends "as justified by actual scale" —
 * and colouring it as a problem would push an operator to create eleven
 * accounts a pilot does not need. `unknown` is `bad` for the opposite reason:
 * it is the state in which the console cannot tell the two apart, which is
 * exactly the defect this card was built to end.
 */
const ORGANIZATION_TONE: Readonly<Record<OrganizationAnswer["kind"], BadgeTone>> = {
  "in-use": "ok",
  none: "info",
  unknown: "bad",
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
