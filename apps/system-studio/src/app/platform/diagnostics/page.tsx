import Link from "next/link"

import { Card, DataTable, EmptyState, type DataColumn } from "@/components/md3"
import { auth } from "@/lib/auth"
import { isOperator, operatorConfigProblems } from "@/lib/operators"

import styles from "./diagnostics.module.css"

/**
 * `/platform/diagnostics` — what sits behind the last group in the navigation,
 * why each of them is there, and what now covers the work it was standing in
 * for.
 *
 * ── Why this route exists ──────────────────────────────────────────────────
 *
 * The console was eight equal tabs in one flat row. An operator's words for the
 * result: it "is cluttered and looks like a construction site, all messed up and
 * confusing … put all these mess in one last tab". The last tab is
 * `Diagnostics`, and everything before it is a finished, Bible-defined operator
 * surface.
 *
 * A quarantine that does not say what it is holding is a drawer. This page is
 * the register: every route behind the line, what it is, what is unfinished
 * about it, and — the part that changes as real surfaces land — which live
 * surface now answers the question the diagnostic panel was answering badly.
 *
 * ── Why nothing here is deleted ────────────────────────────────────────────
 *
 * Moving a surface behind the last group is the entire mechanism. Deleting a
 * route to tidy a navigation is how work becomes invisible again, and the
 * compiled snapshot on `/platform` is the only record of some reads. Every row
 * below links to the route it names and the route still serves.
 *
 * ── Why the tables are data and not markup ─────────────────────────────────
 *
 * `tests/architecture/shell-separation.test.mjs` reads all three tables out of
 * this file:
 *
 *   · `QUARANTINED` must be exactly the destinations in the `Diagnostics` group
 *     of `components/Nav.tsx`, so the register and the quarantine cannot drift;
 *   · `UNLINKED` plus the navigation must cover every route this console serves,
 *     and every route in `UNLINKED` must be one the console actually serves, so
 *     neither a surface nobody can find nor a stale excuse can survive a commit;
 *   · every `headline` in `PLATFORM_PANELS` must be a panel that literally
 *     exists in `../page.tsx`, and every top-level panel there must be listed
 *     here, so a panel cannot be added, renamed or removed without the register
 *     saying what it is.
 *
 * The alternative is prose, and prose about thirteen panels is prose that is
 * wrong within a month.
 *
 * ── Why the declarations are here rather than beside the navigation ────────
 *
 * `components/Nav.tsx` carries `"use client"`. A Server Component that imports a
 * plain constant out of a client module receives a client reference, not the
 * value — so a single shared table is not available, and a copy in each place
 * is a copy that drifts. The declaration therefore lives once, on the page whose
 * whole job is to publish it, and the guard above is what ties the navigation to
 * it.
 */

/** A route the navigation keeps behind its last group. */
interface QuarantinedRoute {
  route: string
  /** What the surface is, in the words its own header uses. */
  what: string
  /** Why it is behind the line. Never "it is not finished" alone. */
  unfinished: string
  /** Live operator surfaces that now answer what it was answering. */
  covered: readonly string[]
}

export const QUARANTINED: readonly QuarantinedRoute[] = [
  {
    route: "/platform",
    what: "The engine's own build report: which commit is serving this, what the process resolved for itself, the execution ledger's progress, and an AWS estate snapshot compiled at that commit.",
    unfinished:
      "It serves no operator requirement. Its own header says what it is — compiled from the execution ledger, the execution prompt and the read-only inventory at a commit — and its own source comment says it was built so that twelve commits of work would be visible to a developer. That is a true reason to build a page and it is a reason addressed to a developer.",
    covered: ["/platform/estate", "/platform/health", "/platform/messaging", "/platform/security"],
  },
  {
    route: "/platform/diagnostics",
    what: "This register.",
    unfinished:
      "It reads nothing about the estate and answers no operator question. It exists so that the line the navigation draws is legible instead of implied, which is a fact about this console rather than about the platform it operates.",
    covered: [],
  },
]

/** A route this console serves that is deliberately not a navigation entry. */
interface UnlinkedRoute {
  route: string
  reason: string
}

export const UNLINKED: readonly UnlinkedRoute[] = [
  {
    route: "/signin",
    reason:
      "Pre-session chrome. The navigation returns null on it, so an entry pointing at it could not render on the one page it applies to.",
  },
  {
    route: "/tenants/new",
    reason:
      "A permission-gated write, not a section. e2e/operator-roles.spec.ts asserts that an Auditor's markup contains the string nowhere at all — absent, not disabled — and a global navigation entry renders for every role on every route. It stays the primary action on /tenants, where the page holds the session and can decide.",
  },
  {
    route: "/tenants/[slug]",
    reason:
      "Dynamic: there is no one tenant to link to. Reached from the fleet table and from the command palette, and the Fleet group stays lit inside it because the active-entry rule matches a subtree.",
  },
  {
    route: "/tenants/[slug]/configuration",
    reason:
      "Dynamic, and scoped to a tenant that has to be chosen first. Reached from that tenant's own page, for the same reason.",
  },
]

/**
 * Every top-level panel on `/platform`, and what it actually is.
 *
 * `headline` is the string the panel is rendered with, not a paraphrase, because
 * that is what makes the guard able to check this list against the page.
 */
interface PlatformPanel {
  headline: string
  what: string
  /** Live operator surfaces that now answer this better. Empty when none does. */
  covered: readonly string[]
}

export const PLATFORM_PANELS: readonly PlatformPanel[] = [
  {
    headline: "What this page found",
    what: "The engine's verdict on itself, in a sentence. A self-report, not a reading of the estate.",
    covered: [],
  },
  {
    headline: "This build, and the figures compiled into it",
    what: "Which commit is serving this, and whether the compiled figures describe that commit. Build provenance.",
    covered: [],
  },
  {
    headline: "The identity this engine is running as",
    what: "The account, region, partition and principal this process resolved for itself, read live from STS.",
    covered: ["/platform/estate", "/platform/identity"],
  },
  {
    headline: "What this engine may read, and what it was refused",
    what: "Refusals recorded in the committed inventory, with the minimum IAM statement that would grant each one. It reports what a past run was refused, not what this render was.",
    covered: ["/platform/estate", "/platform/identity"],
  },
  {
    headline: "Where the programme stands",
    what: "The execution ledger's own checkbox count per phase, with a percentage. A build report.",
    covered: [],
  },
  {
    headline: "Open findings",
    what: "Architecture-versus-inventory discrepancies with an owning requirement id, no severity, no affected tenant and no SLA. Documentation gaps, not security findings.",
    covered: ["/platform/security", "/platform/identity"],
  },
  {
    headline: "AWS estate",
    what: "A resource snapshot compiled at a commit. Kept as a separate page from the live read rather than one page that sometimes lies about which it is showing.",
    covered: ["/platform/estate", "/platform/network", "/platform/compute", "/platform/data"],
  },
  {
    headline: "Queues with no producer and no consumer",
    what: "Orphan detection over that same compiled snapshot: which provisioned queues no package writes to or reads from.",
    covered: ["/platform/messaging"],
  },
  {
    headline: "Alarms in this snapshot",
    what: "The alarm list as the snapshot recorded it. Deliberately thin: an alarm's state is not a verdict on whether it would tell anybody.",
    covered: ["/platform/health"],
  },
  {
    headline: "Module adoption",
    what: "Which catalog modules at least one tenant runs. A fragment of the Modules domain, which has no operator surface.",
    covered: [],
  },
  {
    headline: "Release compatibility",
    what: "Each customer's published configuration against the engine version its cell reports. A fragment of the Releases domain, which has no operator surface.",
    covered: [],
  },
  {
    headline: "Execution ledger, item by item",
    what: "Every transcribed ledger item and whether it is implemented. A build report.",
    covered: [],
  },
  {
    headline: "Test suites",
    what: "The suites this repository runs and what each is for. A build report.",
    covered: [],
  },
]

/** A cell of route links. The path is its own label — a second name would drift. */
function Routes({ routes, none }: { routes: readonly string[]; none: string }) {
  if (routes.length === 0) return <span className="md3-body-small">{none}</span>
  return (
    <ul className={styles.routes}>
      {routes.map((route) => (
        <li key={route}>
          <Link href={route}>
            <code>{route}</code>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const QUARANTINE_COLUMNS: readonly DataColumn<QuarantinedRoute>[] = [
  {
    key: "route",
    header: "Route",
    cell: (row) => (
      <Link href={row.route}>
        <code>{row.route}</code>
      </Link>
    ),
  },
  { key: "what", header: "What it is", cell: (row) => row.what },
  { key: "unfinished", header: "Why it is behind the line", cell: (row) => row.unfinished },
  {
    key: "covered",
    header: "Now answered by",
    cell: (row) => <Routes routes={row.covered} none="Nothing — no operator surface covers this." />,
  },
]

const PANEL_COLUMNS: readonly DataColumn<PlatformPanel>[] = [
  { key: "headline", header: "Panel", cell: (row) => row.headline },
  { key: "what", header: "What it is", cell: (row) => row.what },
  {
    key: "covered",
    header: "Superseded by",
    cell: (row) => <Routes routes={row.covered} none="Nothing yet." />,
  },
]

const UNLINKED_COLUMNS: readonly DataColumn<UnlinkedRoute>[] = [
  {
    key: "route",
    header: "Route",
    // Not a link: two of the four are dynamic and one is pre-session, so there
    // is no single URL to send anybody to. A link that 404s teaches an operator
    // that this table is decorative.
    cell: (row) => <code>{row.route}</code>,
  },
  { key: "reason", header: "Why it is not a navigation entry", cell: (row) => row.reason },
]

export default async function DiagnosticsPage() {
  if (operatorConfigProblems().length > 0) {
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

  const supersededPanels = PLATFORM_PANELS.filter((panel) => panel.covered.length > 0)

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <h1 className="md3-headline-large">Diagnostics</h1>
        <p className="md3-body-medium">
          Everything before this group in the navigation is a finished operator surface over one of the
          domains the System Studio Bible names. Everything in it is unfinished, diagnostic, or exists to
          prove something to a developer. Nothing here is deleted and every route below still serves — moving
          it behind the last group is the whole mechanism.
        </p>
        <p className="md3-body-medium">
          Which surface belongs to which domain, and which side of this line each route falls on, is decided
          once in <code>docs/architecture/studio-information-architecture.md</code> and compiled into the
          table in <code>apps/system-studio/src/components/Nav.tsx</code>.
        </p>
      </div>

      <Card
        headline="What is behind this line"
        supportingText="Each route, what it is, what is unfinished about it, and which live surface now answers what it was answering."
      >
        <DataTable
          caption={`Routes behind the Diagnostics group — ${QUARANTINED.length}`}
          columns={QUARANTINE_COLUMNS}
          rows={QUARANTINED}
          rowKey={(row) => row.route}
          empty={
            <EmptyState
              headline="Nothing is quarantined"
              description="Every route this console serves is a finished operator surface. If that is true, this group should be removed from the navigation rather than left empty."
            />
          }
        />
      </Card>

      <Card
        headline="Panel by panel, what /platform is"
        supportingText={`Thirteen panels. ${supersededPanels.length} of them are now answered live by a real operator surface; the rest are build reports or fragments of a domain that has no surface yet.`}
      >
        <DataTable
          caption={`Panels on /platform — ${PLATFORM_PANELS.length}`}
          columns={PANEL_COLUMNS}
          rows={PLATFORM_PANELS}
          rowKey={(row) => row.headline}
          empty={
            <EmptyState
              headline="The page has no panels"
              description="This register is read against ../page.tsx by tests/architecture/shell-separation.test.mjs, so an empty list here means the reader stopped reading rather than that the page emptied."
            />
          }
        />
      </Card>

      <Card
        headline="Reachable, but not from the navigation"
        supportingText="These are not diagnostics. They are finished operator surfaces that are deliberately not navigation destinations, listed here because a route in the tree that appears in no navigation is a surface nobody finds by accident."
      >
        <DataTable
          caption={`Routes served but intentionally unlinked — ${UNLINKED.length}`}
          columns={UNLINKED_COLUMNS}
          rows={UNLINKED}
          rowKey={(row) => row.route}
          empty={
            <EmptyState
              headline="Every route is a navigation entry"
              description="No route this console serves is reached only from inside another page."
            />
          }
        />
      </Card>
    </div>
  )
}
