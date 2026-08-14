/**
 * The Diagnostics register: what sits behind the navigation's last group, why
 * each is there, and what now covers the work it was standing in for.
 *
 * Declared here rather than in `page.tsx` because `next build` refuses a route
 * file that exports anything outside Next's reserved set. The constraint lives
 * in the generated `.next/types/**` shim, so `tsc --noEmit` passes on a route
 * that the build then rejects — which is why `npm run build` is one of the ten
 * checks rather than a formality.
 *
 * `tests/architecture/shell-separation.test.mjs` parses these three tables out
 * of THIS file, by path, and ties them to the navigation — so the register an
 * operator reads and the nav they click cannot disagree.
 *
 * Not in `components/Nav.tsx`: that module carries a `use client` directive,
 * and a Server Component importing a plain constant out of a client module
 * receives a client reference rather than the value. One declaration, imported
 * by both.
 */

export interface QuarantinedRoute {
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
export interface UnlinkedRoute {
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
export interface PlatformPanel {
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

  // The two live estate readings on this page. Unlike everything above them
  // they are read from AWS on the render rather than compiled into the build,
  // which is why neither is `covered` by another surface: no operator page
  // answers either question yet, so quarantining them would delete the answer
  // rather than move it.
  {
    headline: "The ceilings this engine provisions into",
    what: "Applied service quotas and the headroom left in them, read live via quotaReadings() and rendered through quotaRows / unreadableQuotas / quotaCoverage. A quota that could not be read is listed as unread, never as headroom.",
    covered: [],
  },
  {
    headline: "Whether this estate has an AWS Organization",
    what: "Whether this account sits in an Organization and which accounts it holds, read live via organizationSurface() and rendered through organizationAnswer / orgAccountRows. A refused read says so; it does not report a standalone account.",
    covered: [],
  },
]
