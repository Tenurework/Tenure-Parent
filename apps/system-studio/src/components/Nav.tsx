"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

import styles from "./nav.module.css"

/**
 * One navigation, in the layout, as a tree: the Bible's domains as sections,
 * the routes inside them, and sub-items inside the routes that have real
 * sub-surfaces.
 *
 * It used to be re-declared in every page, which meant each page decided which
 * siblings existed and a new page was reachable only from wherever someone
 * remembered to add a link. Declared once here, every page gets the same set and
 * the active entry is derived from the path rather than passed in and
 * occasionally wrong.
 *
 * ## Why there are groups, and where the group names come from
 *
 * The console was eight equal tabs in a flat row, ordered by an argument about
 * an operator's workflow. Nothing in that row said which of them were finished
 * operator surfaces and which were a build report, and nothing tied any of them
 * to the document that says what this console is for. An operator's words for
 * it: "cluttered, and it looks like a construction site".
 *
 * So the group names are not chosen here. They are the left-navigation domains
 * of the System Studio Bible section 7.2 — Fleet, Implementations, Blueprints,
 * Modules, Releases, Changes, AWS, Identity, Data, Relay, Integrations, Domains,
 * Security, Operations, FinOps, Evidence, Marketplace — in the order that
 * section lists them, narrowed to the domains this console actually serves a
 * surface for. The reasoning for every inclusion, every exclusion and every
 * domain that has no surface at all is written down once, in
 * docs/architecture/studio-information-architecture.md, and this table is that
 * document compiled. Change one and change the other.
 *
 * ## A group holds a LIST, because a domain can have more than one surface
 *
 * It held exactly one entry when it was written, which made "group" and "entry"
 * the same row. Then `/platform/network`, `/platform/compute` and
 * `/platform/messaging` landed — three surfaces over Bible section 12's service
 * families, all of them the AWS domain. Flattening them back into peers of
 * Fleet and FinOps is how the flat row got built the first time: one page at a
 * time, each addition defensible on its own.
 *
 * ## Level two: sub-items, and how one is addressed
 *
 * A route earns sub-items when it renders several separately-readable
 * surfaces and an operator arrives wanting one of them specifically — the rule
 * is section 4.2 of the information architecture. A sub-item is
 * `{ label, anchor }` where `anchor` is the `id` of a top-level `<Card>` on that
 * route's page, and the destination is COMPOSED at render:
 * `` `${entry.href}#${sub.anchor}` ``, never written as a literal.
 *
 * That is not a style preference. `tests/architecture/shell-separation.test.mjs`
 * reads every `href="/…"` and `href: "/…"` literal in this file and requires
 * each to be a route the console serves, and `/platform/network#security-groups`
 * is not one — a fragment written as a literal reds the build. Because a
 * composed destination is invisible to that reader, the same guard reads the
 * `anchor` values directly and fails when one of them is not the `id` of a
 * `<Card>` on that page. A sub-item that scrolls nowhere is the defect a table
 * of sub-items in prose always ends up with.
 *
 * Only anchors that exist today are declared. `/platform/network`,
 * `/platform/identity` and `/platform/security` render no card with an `id`, so
 * they carry no sub-items here; those pages belong to other lanes in this run
 * and a sub-item pointing into one of them would be a promise this navigation
 * cannot keep. `/platform/cost` has none deliberately (three cards, one
 * question), and neither does anything behind Diagnostics — an expanded tree
 * reads as a finished area.
 *
 * ## Level three: the contextual sub-tree inside a tenant
 *
 * `/tenants/[slug]` and `/tenants/[slug]/configuration` are dynamic: there is no
 * one tenant to link to, so they are declared UNLINKED and are not entries. When
 * the path is already inside a tenant they become reachable siblings, derived
 * from `usePathname()` rather than from a table — a table of tenants in the
 * navigation would be a second fleet list that goes stale. The tenant is named
 * by its slug because the rail is a client component with no session and no
 * registry read, and because the slug is what the fleet table, the breadcrumb
 * and the URL all already say.
 *
 * `reserved` is load-bearing and is not decoration. `/tenants/new` is a served
 * route — the compose form — and not an object id. MEASURED, by removing the
 * reservation and rendering `/tenants/new`: the navigation invents a tenant
 * called "new" and offers `/tenants/new/configuration`, a route this console
 * does not serve, as a link in the chrome of every role; five sub-items
 * addressing cards the compose form does not have; and the current-page marker
 * moves off `Tenants` onto a fabricated "Overview".
 *
 * It does NOT render the literal `href="/tenants/new"`, which is the string
 * `e2e/operator-roles.spec.ts` refuses to find in an auditor's markup — on that
 * path the leaf IS the current page, so it renders as a span with no href at
 * all. That spec would therefore stay green while the shell was wrong, which is
 * the reason the reserved set has a guard of its own rather than being left to
 * the one that looks nearby. The guard derives the set from the routes the
 * console serves, so a second static route under `/tenants` fails the build
 * until it is named here.
 *
 * ## The last group is a quarantine, and it is the whole mechanism
 *
 * Everything before Diagnostics is a finished, Bible-defined operator surface.
 * Diagnostics holds what is unfinished, diagnostic, or exists to prove
 * something to a developer. Nothing is deleted and no route stops being served
 * — moving it behind the last group is the entire device, because a half-built
 * surface sitting between two finished ones is what made the console read as a
 * construction site. `tail` is what draws the rule, so the line is visible
 * rather than implied by ordering that nobody reads as ordering.
 *
 * The group's first entry is `/platform/diagnostics`, which is the register of
 * what is behind the line and what is unfinished about each of them. A tab that
 * quarantines things and then does not say what it is holding is a drawer.
 *
 * ## What is deliberately NOT here
 *
 * Four routes this console serves are not navigation destinations — `/signin`,
 * `/tenants/new` and the two dynamic tenant routes. Each is named with its
 * reason in `UNLINKED`, on `app/platform/diagnostics/register.ts`. Not in this
 * file, because it carries `"use client"` and a Server Component importing a
 * constant out of a client module receives a client reference rather than the
 * value; not in the page that renders it either, because the App Router rejects
 * a route file exporting anything outside its reserved set. A sibling module is
 * neither, so the list lives once.
 *
 * That list is not commentary. `tests/architecture/shell-separation.test.mjs`
 * reads it, and a route that appears in neither the table above nor that list
 * fails the build. A route nobody can reach is the defect this file exists to
 * make impossible.
 *
 * ## Why the element is still called `tabs`
 *
 * It is a tree now and `tabs` is a poor name for one. The class is retained as a
 * test contract anchor: `e2e/cost.spec.ts` asserts that exactly one element
 * inside `nav.tabs` carries `aria-current="page"` and that its text is exactly
 * the entry label. Renaming it means editing a passing spec for a cosmetic
 * reason, and the compensating cost is this paragraph.
 */

/** A section of a route's own page, reachable from the navigation. */
export interface SubItem {
  /** The operator's word for the surface. Never the entry's own label. */
  label: string
  /** The `id` of a top-level `<Card>` on that route's page. */
  anchor: string
  hint: string
}

export interface Entry {
  href: string
  /** The page's own name. The domain is already printed above it. */
  label: string
  hint: string
  subItems?: readonly SubItem[]
}

export interface Group {
  /** The Bible's own name for the domain these surfaces serve. */
  domain: string
  entries: readonly Entry[]
  /** Set on the quarantine group so the rule before it is drawn from data. */
  tail?: true
}

export const GROUPS: readonly Group[] = [
  {
    domain: "Fleet",
    entries: [
      {
        href: "/tenants",
        label: "Tenants",
        hint: "every tenant, its lifecycle state, health, drift and cost — and the way in to composing one",
      },
    ],
  },
  {
    domain: "Blueprints",
    entries: [
      {
        href: "/",
        label: "Systems",
        hint: "what each configured system is made of, and which layer every effective value came from",
        subItems: [
          {
            label: "Configured systems",
            anchor: "summary",
            hint: "how many systems are configured, and how many of them resolved",
          },
          {
            label: "Extensions and connectors",
            anchor: "catalog",
            hint: "the catalog a system is assembled from: what is available for this scope and what was refused",
          },
        ],
      },
    ],
  },
  {
    domain: "AWS",
    entries: [
      {
        href: "/platform/estate",
        label: "Estate",
        hint: "what is actually running in AWS right now, read live, with refused reads shown as unknown",
        subItems: [
          { label: "This account", anchor: "identity", hint: "the account, region and partition this console resolved" },
          { label: "What is running", anchor: "resources", hint: "the live resource inventory, service by service" },
          {
            label: "Declared against actual",
            anchor: "declared",
            hint: "where the declared estate and the observed estate disagree",
          },
          {
            label: "Reconcile",
            anchor: "reconcile",
            hint: "what reconciling this estate would do, and how much approval it would need",
          },
          {
            label: "Where authority lives",
            anchor: "posture",
            hint: "whether this workload runs in the Organizations management account",
          },
          { label: "Account topology", anchor: "topology", hint: "the declared account roles against the accounts that exist" },
        ],
      },
      {
        href: "/platform/network",
        label: "Network",
        hint: "what can reach this estate from the internet, and whether traffic is getting to the services",
      },
      {
        href: "/platform/compute",
        label: "Compute",
        hint: "what is running, what image it is running, and why anything stopped",
        subItems: [
          {
            label: "Running against desired",
            anchor: "running-against-desired",
            hint: "how many tasks are running against how many were asked for",
          },
          { label: "Why anything stopped", anchor: "why-it-stopped", hint: "the stop reasons AWS returned, verbatim" },
          {
            label: "What each service runs",
            anchor: "what-each-runs",
            hint: "the task definition and image behind every service",
          },
          { label: "Lambda runtimes", anchor: "lambda-runtimes", hint: "runtimes with a deprecation date on them" },
        ],
      },
      {
        href: "/platform/messaging",
        label: "Messaging",
        hint: "whether the platform can reach people, and whether anything is queued that nobody is processing",
        subItems: [
          { label: "Right now", anchor: "answer", hint: "the one sentence this page exists to answer" },
          { label: "Queues", anchor: "queues", hint: "every queue, its depth, and whether anything consumes it" },
          { label: "Failed deliveries", anchor: "failed-deliveries", hint: "dead-letter queues and what is sitting in them" },
          { label: "Schedules and rules", anchor: "schedules", hint: "EventBridge rules and schedules, and what they target" },
          { label: "Sending", anchor: "sending", hint: "SES identities, send rate and suppression" },
        ],
      },
      {
        href: "/platform/identity",
        label: "Identity",
        hint: "who can get into this control plane and this account, and what is protecting those doors",
      },
      {
        href: "/platform/data",
        label: "Data",
        hint: "where this platform keeps state, whether it is protected, and what is about to interrupt it",
        subItems: [
          { label: "The tenant registry", anchor: "registry", hint: "the registry table and the tables around it" },
          { label: "Object storage", anchor: "buckets", hint: "buckets, their public-access posture and their encryption" },
          { label: "Cache", anchor: "cache", hint: "cache clusters and what depends on them" },
          { label: "Protection", anchor: "protection", hint: "what is backed up, and what is not" },
          { label: "Restore points", anchor: "restore-points", hint: "the most recent point each store could be restored to" },
          { label: "About to interrupt", anchor: "interruptions", hint: "pending maintenance windows and version deadlines" },
        ],
      },
    ],
  },
  {
    domain: "Security",
    entries: [
      {
        href: "/platform/security",
        label: "Findings",
        hint: "open findings, their severity and SLA, and which of the six products answered",
      },
    ],
  },
  {
    domain: "Operations",
    entries: [
      {
        href: "/platform/health",
        label: "Health",
        hint: "every alarm, and whether it would actually tell anybody",
        subItems: [
          { label: "Right now", anchor: "right-now", hint: "what is alarming at this moment" },
          { label: "Needs attention", anchor: "needs-attention", hint: "alarms in ALARM or INSUFFICIENT_DATA" },
          { label: "Watching quietly", anchor: "watching-quietly", hint: "alarms in OK, and what each one watches" },
          { label: "Coverage", anchor: "coverage", hint: "how much of the estate has an alarm at all" },
          { label: "What nothing is watching", anchor: "unwatched", hint: "resources no alarm covers" },
          { label: "Log groups", anchor: "log-groups", hint: "log groups, retention, and what is never expired" },
        ],
      },
    ],
  },
  {
    domain: "FinOps",
    entries: [
      {
        href: "/platform/cost",
        label: "Cost",
        hint: "what the fleet costs, who it costs it for, and how much approval a new commitment needs",
      },
    ],
  },
  {
    domain: "Evidence",
    entries: [
      {
        href: "/platform/audit",
        label: "Audit",
        hint: "whether the trail of what this console did is intact, and what retention would destroy",
        subItems: [
          { label: "Who did what, when", anchor: "entries", hint: "the ledger itself, filterable by actor, action and outcome" },
          { label: "Chain by chain", anchor: "chains", hint: "every hash chain and whether it verifies" },
          { label: "What could not be read", anchor: "not-known", hint: "the part of the trail this page could not reach" },
          { label: "Retention plan", anchor: "retention", hint: "what retention would destroy, and when" },
          { label: "Legal holds", anchor: "holds", hint: "what is held back from deletion, and by whom" },
        ],
      },
    ],
  },
  {
    domain: "Diagnostics",
    tail: true,
    entries: [
      {
        href: "/platform/diagnostics",
        label: "Diagnostics",
        hint: "what sits behind this line, what is unfinished about each of them, and what now covers it",
      },
      {
        href: "/platform",
        label: "Platform",
        hint: "not an operator surface: the engine's own build report, compiled at a commit",
      },
    ],
  },
] as const

/** A leaf of a contextual sub-tree: a dynamic route, filled in from the path. */
export interface ContextualLeaf {
  /** The route template, exactly as the console serves it. */
  template: string
  label: string
  hint: string
  subItems: readonly SubItem[]
}

export interface ContextualBranch {
  /** The entry the sub-tree hangs under. */
  parent: string
  /**
   * Segments directly under `parent` that are NOT an object id.
   *
   * `/tenants/new` is a served route, not a tenant. See the header for what
   * removing this actually renders — measured, not assumed. The guard derives
   * this set from the routes the console serves, so it cannot fall behind a new
   * static sibling.
   */
  reserved: readonly string[]
  leaves: readonly ContextualLeaf[]
}

export const CONTEXTUAL: readonly ContextualBranch[] = [
  {
    parent: "/tenants",
    reserved: ["new"],
    leaves: [
      {
        template: "/tenants/[slug]",
        label: "Overview",
        hint: "this tenant's state, footprint, drift and what can happen to it next",
        subItems: [
          { label: "State", anchor: "state", hint: "the lifecycle state, and what it is allowed to become" },
          { label: "Where it is in AWS", anchor: "aws-footprint", hint: "the account, cell and region this tenant sits in" },
          { label: "Drift", anchor: "drift", hint: "where the observed tenant and the declared tenant disagree" },
          { label: "How it got here", anchor: "history", hint: "every recorded lifecycle advance, most recent first" },
          { label: "What can happen next", anchor: "next", hint: "the moves this console will let an operator make" },
        ],
      },
      {
        template: "/tenants/[slug]/configuration",
        label: "Configuration",
        hint: "every effective configuration value, the layer it came from, and what changing it costs",
        /*
          No sub-item repeats the leaf's own label. The page's first card is
          headed "Configuration" and a sub-item called Configuration under a
          leaf called Configuration is two things in one navigation answering to
          one name — which the guard refuses, because every spec that clicks
          this navigation addresses it by accessible name.
        */
        subItems: [
          { label: "History", anchor: "configuration-history", hint: "published revisions of this tenant's configuration" },
          { label: "What this costs", anchor: "running-total", hint: "the running total this configuration implies" },
          { label: "Module dependencies", anchor: "module-dependencies", hint: "which modules this configuration requires" },
          {
            label: "Settings you will not find above",
            anchor: "not-editable-here",
            hint: "what this surface deliberately does not let an operator change",
          },
        ],
      },
    ],
  },
] as const

/** The tenant sub-tree resolved against a real path, or `null` outside one. */
interface ResolvedContext {
  branch: ContextualBranch
  /** The object's own identifier, from the path. Its slug, not its name. */
  key: string
  leaves: Array<ContextualLeaf & { href: string }>
}

function resolveContext(pathname: string): ResolvedContext | null {
  for (const branch of CONTEXTUAL) {
    if (!pathname.startsWith(`${branch.parent}/`)) continue
    const [key] = pathname.slice(branch.parent.length + 1).split("/")
    if (!key || branch.reserved.includes(key)) return null
    return {
      branch,
      key,
      leaves: branch.leaves.map((leaf) => ({ ...leaf, href: leaf.template.replace("[slug]", key) })),
    }
  }
  return null
}

/** `/` matches only itself; everything else matches its own subtree. */
function matches(href: string, pathname: string) {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The one destination that is the current page.
 *
 * The most specific match wins, and only it. Subtree matching alone lit both
 * "Platform" and "Cost" on /platform/cost — two current pages, which tells a
 * reader nothing about where they are. Contextual leaves are candidates too, so
 * inside a tenant the leaf is current and `Tenants` above it goes back to being
 * a link on the trail rather than a second current page.
 */
function currentDestination(pathname: string, context: ResolvedContext | null): string | undefined {
  const candidates = [
    ...GROUPS.flatMap((group) => group.entries.map((entry) => entry.href)),
    ...(context?.leaves.map((leaf) => leaf.href) ?? []),
  ]
  return candidates.filter((href) => matches(href, pathname)).sort((left, right) => right.length - left.length)[0]
}

/** Breakpoint below which the tree is behind a disclosure. Matches the rail CSS. */
const EXPANDED = "(min-width: 901px)"

export function Nav() {
  const pathname = usePathname() ?? "/"

  /*
    The fragment, so a sub-item can say it is the one being read.

    `usePathname` does not carry it — a hash never reaches the server and is not
    part of the route. Read after mount and on every `hashchange`, which is what
    an in-page anchor fires. The first render therefore marks no sub-item, which
    is the truthful state for markup that was rendered without knowing.
  */
  const [fragment, setFragment] = useState("")
  useEffect(() => {
    const read = () => setFragment(window.location.hash.replace(/^#/, ""))
    read()
    window.addEventListener("hashchange", read)
    return () => window.removeEventListener("hashchange", read)
  }, [pathname])

  /*
    Whether the tree is showing.

    The CSS decides this on its own at wide widths — the disclosure button is
    `display: none` above the breakpoint and the panel is shown regardless of
    this state — so the tree is in the first paint and needs no JavaScript to
    appear. This state exists so `aria-expanded` is TRUE rather than a lie, and
    so the button actually works below the breakpoint. It starts closed, which
    is what the server renders and therefore what hydration expects.
  */
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(EXPANDED)
    const sync = () => setOpen(query.matches)
    sync()
    query.addEventListener("change", sync)
    return () => query.removeEventListener("change", sync)
  }, [])

  // Navigating closes it again on a narrow viewport, where it covers the page.
  useEffect(() => {
    if (!window.matchMedia(EXPANDED).matches) setOpen(false)
  }, [pathname])

  /*
    Which sub-menus the operator has opened, over the default.

    A destination's sub-menu defaults to open when it is the page being read and
    closed otherwise, which is the only default that does not make the tree a
    wall. This holds the overrides, so opening `Data`'s sections from
    `/platform/cost` — reading ahead before navigating, which is most of what a
    second level is FOR — survives a re-render. Cleared on navigation, because
    the defaults have changed and a stale override would leave the new current
    page's own sections collapsed.
  */
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  useEffect(() => setOpened({}), [pathname])

  const context = resolveContext(pathname)
  const active = currentDestination(pathname, context)

  // The sign-in page has no sections to navigate between.
  if (pathname.startsWith("/signin")) return null

  const activeLabel =
    context?.leaves.find((leaf) => leaf.href === active)?.label ??
    GROUPS.flatMap((group) => group.entries).find((entry) => entry.href === active)?.label ??
    ""

  /**
   * One entry, with its sub-menu.
   *
   * The disclosure is a button plus a sibling list, not a `<details>`. The
   * first version WAS a `<details>`, and rendering it showed why it cannot be:
   * the summary has to sit on the entry's line, so the `<details>` has to be
   * inside the row — and then its open list is a flex item on that same line
   * and squeezes the entry's own label to one character per line. Measured in
   * Chromium at 1280: "Health" rendered as H/ea/lt/h. A `<details>` is one
   * element and its content cannot leave it, so the row and the list have to be
   * siblings, which means the disclosure has to be a button.
   *
   * The list is rendered and `hidden` rather than unmounted, so `aria-controls`
   * always resolves to something. `hidden` computes to `display: none`, which is
   * what keeps a collapsed sub-item out of the accessibility tree and out of
   * every `getByRole` locator the existing specs use.
   */
  const destination = (
    href: string,
    label: string,
    hint: string,
    subItems: readonly SubItem[],
    isCurrent: boolean,
    onTrail: boolean,
  ) => {
    const expanded = opened[href] ?? isCurrent
    const listId = `nav-sub-${href.replace(/[^a-zA-Z0-9]+/g, "-")}`
    return (
      <>
        <div className={styles.entryRow}>
          {isCurrent ? (
            <span className="here" aria-current="page" title={hint}>
              {label}
            </span>
          ) : (
            <Link href={href} title={hint} {...(onTrail ? { "data-trail": "true" } : {})}>
              {label}
            </Link>
          )}
          {subItems.length > 0 ? (
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setOpened((was) => ({ ...was, [href]: !expanded }))}
            >
              <span className={styles.srOnly}>Sections of {label}</span>
            </button>
          ) : null}
        </div>
        {subItems.length > 0 ? subList(listId, href, subItems, expanded, isCurrent) : null}
      </>
    )
  }

  /** A sub-item list, for whichever destination it belongs to. */
  const subList = (
    id: string,
    href: string,
    subItems: readonly SubItem[],
    expanded: boolean,
    isCurrent: boolean,
  ) => (
    <ul id={id} className={styles.subList} hidden={!expanded}>
        {subItems.map((sub) => (
          <li key={sub.anchor}>
            <a
              className={styles.subLink}
              href={`${href}#${sub.anchor}`}
              title={sub.hint}
              /*
                `location`, never `page`. `e2e/cost.spec.ts` asserts that exactly
                one element inside this nav carries `aria-current="page"`,
                because two current pages tell a reader nothing about where they
                are. A section of the page being read is a location within it,
                and `location` is the token ARIA has for precisely that.
              */
              {...(isCurrent && expanded && fragment === sub.anchor
                ? { "aria-current": "location" as const }
                : {})}
            >
              {sub.label}
            </a>
          </li>
        ))}
    </ul>
  )

  return (
    <nav className={`tabs ${styles.rail}`} aria-label="Console sections">
      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={open}
        aria-controls="console-sections"
        onClick={() => setOpen((was) => !was)}
      >
        <span className={styles.disclosureWord}>Sections</span>
        {activeLabel ? <span className={styles.disclosureHere}>{activeLabel}</span> : null}
      </button>

      <div id="console-sections" className={styles.panel} data-open={open ? "true" : "false"}>
        {GROUPS.map((group) => {
          const owned = [
            ...group.entries.map((entry) => entry.href),
            ...(group.entries.some((entry) => entry.href === context?.branch.parent)
              ? (context?.leaves.map((leaf) => leaf.href) ?? [])
              : []),
          ]
          /*
            The current SECTION, distinct from the current PAGE below.

            `owned` is what makes a two-level tree feel whole rather than
            broken: inside `/tenants/<slug>` the current page is a contextual
            leaf, not the `Tenants` entry, and a section that stopped being
            marked because its child rather than itself was selected is exactly
            the defect. Deliberately `true` rather than `page` — a group is a
            location within the console, not the page itself, and `true` says so
            without joining the count `cost.spec.ts` pins at one.
          */
          const here = owned.includes(active ?? "")
          const labelId = `nav-domain-${group.domain.toLowerCase()}`
          return (
            <div
              key={group.domain}
              className={styles.section}
              role="group"
              aria-labelledby={labelId}
              {...(here ? { "aria-current": true as const } : {})}
              {...(group.tail ? { "data-tail": "true" } : {})}
            >
              <span className={styles.sectionName} id={labelId}>
                {group.domain}
              </span>
              <ul className={styles.entries}>
                {group.entries.map((entry) => {
                  const isCurrent = entry.href === active
                  const onTrail = Boolean(context) && entry.href === context?.branch.parent && !isCurrent
                  const subItems = entry.subItems ?? []
                  return (
                    <li key={entry.href} className={styles.entry}>
                      {destination(entry.href, entry.label, entry.hint, subItems, isCurrent, onTrail)}

                      {onTrail && context ? (
                        <ul className={styles.context}>
                          <li>
                            <span className={styles.contextKey} title="The tenant this path is inside, by its slug">
                              {context.key}
                            </span>
                            <ul className={styles.entries}>
                              {context.leaves.map((leaf) => (
                                <li key={leaf.href} className={styles.entry}>
                                  {destination(
                                    leaf.href,
                                    leaf.label,
                                    leaf.hint,
                                    leaf.subItems,
                                    leaf.href === active,
                                    false,
                                  )}
                                </li>
                              ))}
                            </ul>
                          </li>
                        </ul>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
