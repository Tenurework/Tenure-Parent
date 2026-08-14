import Link from "next/link"

import { Card, DataTable, EmptyState, type DataColumn } from "@/components/md3"
import { auth } from "@/lib/auth"
import { PermissionDeniedState } from "@/components/states"
import { operatorConfigProblems } from "@/lib/operators"
import { authorizeCommand } from "@/lib/authorize"

import {
  PLATFORM_PANELS,
  QUARANTINED,
  UNLINKED,
  type PlatformPanel,
  type QuarantinedRoute,
  type UnlinkedRoute,
} from "./register"
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
  // STUDIO-020-006. A command decision, not a membership test: `isOperator` is
  // exactly `roleOf(...) !== null`, so it carries no resource and no verb and
  // every operator family — auditor-read-only included — decides the same.
  // `platform.read` is what /platform itself decides with, and this is one of
  // its surfaces.
  const decision = authorizeCommand("platform.read", { principalId: session?.user?.email })
  if (decision.reason === "NO_PRINCIPAL") {
    const { redirect } = await import("next/navigation")
    redirect("/signin")
  }
  if (!decision.allowed) return <PermissionDeniedState />

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
