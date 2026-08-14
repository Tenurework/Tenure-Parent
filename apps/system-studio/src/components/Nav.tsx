"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

/**
 * One navigation, in the layout, grouped by the domains the Bible names.
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
 */
interface Entry {
  href: string
  /** The page's own name. The domain is already printed above it. */
  label: string
  hint: string
}

interface Group {
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
      },
      {
        href: "/platform/messaging",
        label: "Messaging",
        hint: "whether the platform can reach people, and whether anything is queued that nobody is processing",
      },
    ],
  },
  {
    domain: "Identity",
    entries: [
      {
        href: "/platform/identity",
        label: "Identity",
        hint: "who can get into this control plane and this account, and what is protecting those doors",
      },
    ],
  },
  {
    domain: "Data",
    entries: [
      {
        href: "/platform/data",
        label: "Data",
        hint: "where this platform keeps state, whether it is protected, and what is about to interrupt it",
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

/**
 * The navigation's own styling, carried with the navigation.
 *
 * `app/globals.css` already styles `.tabs`, `.tabs a` and `.tabs .here`, and
 * those rules are kept — a pill still looks like a pill and the current one is
 * still the filled one. Only what grouping adds is declared here. Every value is
 * an MD3 alias token (`--space-*`, `--muted`, `--text`, `--accent`, `--border`),
 * each of which resolves to a `--md-sys-*` role in globals.css: a literal here
 * is a colour pair `e2e/md3-tokens-logic.spec.ts` does not know exists, in the
 * file it is least likely to be pointed at.
 *
 * Every selector is at least `nav.tabs .x`, which outranks the single-class
 * rules in the stylesheet whichever order the two are inserted in. The
 * stylesheet's narrow-width rules — `.tabs a { flex: 1 1 calc(50% - gap) }` at
 * 640, `flex-basis: 100%` at 420, `min-inline-size: min(9rem, 100%)` — were
 * written to wrap eight equal tabs two-up, and `flex: 0 0 auto` is what stops a
 * link that is now a flex child of its own group inheriting that.
 *
 * MEASURED, in Chromium at 320, 900, 1180 and 1440 with the real stylesheet:
 * removing that override changes nothing. Making the group `flex-direction:
 * column` moves the main axis, so `flex-basis` on a link is a HEIGHT the group
 * has no free space to distribute, and `min(9rem, 100%)` resolves its percentage
 * against a shrink-to-fit containing block, which is the link's own used width.
 * The override is kept as the explicit statement of intent — the next engine or
 * the next stylesheet edit need not share that accident — but it is not load
 * bearing, and this paragraph says so rather than claiming a defect it prevents.
 * A `min-inline-size: auto` was tried here for the same reason and removed when
 * the measurement showed it moved nothing.
 *
 * Physical directions are not used anywhere below — `padding-inline`,
 * `margin-inline-start`, `border-inline-start`. `e2e/layout.spec.ts` flips `dir`
 * to `rtl` on the live document and re-runs the overlap detector, so a
 * `margin-left` here would red it.
 *
 * No `min-inline-size: 0` on a group. A flex item defaults to `min-width: auto`,
 * which is what stops a group being squeezed narrower than its own label — and
 * a label narrower than its text is precisely the defect layout.spec.ts's
 * `scrollWidth > clientWidth` check exists to catch.
 */
const NAV_CSS = `
nav.tabs {
  gap: var(--space-2) var(--space-4);
  align-items: flex-start;
}
nav.tabs .nav-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
nav.tabs .nav-group-name {
  font-size: 0.68rem;
  line-height: 1.5;
  font-weight: 650;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
  padding-inline: var(--space-3);
  white-space: nowrap;
  border-block-end: 2px solid transparent;
}
nav.tabs .nav-group[aria-current="true"] .nav-group-name {
  color: var(--text);
  border-block-end-color: var(--accent);
}
nav.tabs .nav-group a,
nav.tabs .nav-group .here {
  flex: 0 0 auto;
  white-space: nowrap;
}
nav.tabs .nav-group[data-tail="true"] {
  margin-inline-start: auto;
  padding-inline-start: var(--space-4);
  border-inline-start: 1px solid var(--border);
}
`

export function Nav() {
  const pathname = usePathname() ?? "/"

  // `/` must match only itself; every other entry matches its subtree, so a
  // tenant detail page keeps Fleet lit rather than dropping the highlight.
  const matches = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)

  // The most specific match wins, and only it. Subtree matching alone lit both
  // "Platform" and "Cost" on /platform/cost — two current pages, which tells a
  // reader nothing about where they are. Six more routes now sit under
  // `/platform`, so this is load-bearing rather than a corner: on
  // /platform/network both `/platform` and `/platform/network` match and only
  // the longer one may light.
  const active = GROUPS.flatMap((group) => group.entries.map((entry) => entry.href))
    .filter(matches)
    .sort((left, right) => right.length - left.length)[0]

  // The sign-in page has no sections to navigate between.
  if (pathname.startsWith("/signin")) return null

  return (
    <nav className="tabs" aria-label="Console sections">
      {/*
        Hoisted into <head> by React 19 and deduplicated on `href`, so it is one
        stylesheet however many times this renders. It is here rather than in
        globals.css because grouping is this component's structure: a rule for a
        class that only this file emits, kept beside the markup that emits it.
      */}
      <style href="tenure-studio-nav" precedence="high">
        {NAV_CSS}
      </style>

      {GROUPS.map((group) => {
        const here = group.entries.some((entry) => entry.href === active)
        const labelId = `nav-domain-${group.domain.toLowerCase()}`
        return (
          <div
            key={group.domain}
            className="nav-group"
            role="group"
            aria-labelledby={labelId}
            /*
              The current SECTION, distinct from the current PAGE below.
              Deliberately not `page`: `e2e/cost.spec.ts` asserts that exactly
              one element inside this nav carries `aria-current="page"`, because
              two current pages tell a reader nothing about where they are. A
              group is a location within the console, not the page itself, and
              `true` is the token that says so without joining that count.
            */
            {...(here ? { "aria-current": true as const } : {})}
            {...(group.tail ? { "data-tail": "true" } : {})}
          >
            <span className="nav-group-name" id={labelId}>
              {group.domain}
            </span>
            {group.entries.map((entry) =>
              entry.href === active ? (
                <span key={entry.href} className="here" aria-current="page" title={entry.hint}>
                  {entry.label}
                </span>
              ) : (
                <Link key={entry.href} href={entry.href} title={entry.hint}>
                  {entry.label}
                </Link>
              ),
            )}
          </div>
        )
      })}
    </nav>
  )
}
