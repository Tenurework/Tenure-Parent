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
 * ## Why there are groups now, and where the group names come from
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
 * ## What is deliberately NOT here
 *
 * Composing a tenant. It is a permission-gated action, not a section: an
 * Auditor holds no `tenant:write`, and `e2e/operator-roles.spec.ts` asserts the
 * string does not appear in an Auditor's markup at all — "not disabled: absent".
 * A global nav entry renders for every role on every route and would put it
 * there. It stays the primary action on Fleet, where the page can decide.
 */
interface Entry {
  /** The Bible's own name for the domain this surface serves. */
  domain: string
  href: string
  label: string
  hint: string
  /** Set on the quarantine group so the rule before it is drawn from data. */
  tail?: true
}

const ENTRIES: readonly Entry[] = [
  {
    domain: "Fleet",
    href: "/tenants",
    label: "Tenants",
    hint: "every tenant, its lifecycle state, health, drift and cost — and the way in to composing one",
  },
  {
    domain: "Blueprints",
    href: "/",
    label: "Systems",
    hint: "what each configured system is made of, and which layer every effective value came from",
  },
  {
    domain: "AWS",
    href: "/platform/estate",
    label: "Estate",
    hint: "what is actually running in AWS right now, read live, with refused reads shown as unknown",
  },
  {
    domain: "Security",
    href: "/platform/security",
    label: "Findings",
    hint: "open findings, their severity and SLA, and which of the six products answered",
  },
  {
    domain: "Operations",
    href: "/platform/health",
    label: "Health",
    hint: "every alarm, and whether it would actually tell anybody",
  },
  {
    domain: "FinOps",
    href: "/platform/cost",
    label: "Cost",
    hint: "what the fleet costs, who it costs it for, and how much approval a new commitment needs",
  },
  {
    domain: "Evidence",
    href: "/platform/audit",
    label: "Audit",
    hint: "whether the trail of what this console did is intact, and what retention would destroy",
  },
  {
    domain: "Diagnostics",
    href: "/platform",
    label: "Platform",
    hint: "not an operator surface: the programme's own progress, its test suites, and a snapshot compiled at a commit",
    tail: true,
  },
] as const

/**
 * The navigation's own styling, carried with the navigation.
 *
 * `app/globals.css` already styles `.tabs`, `.tabs a` and `.tabs .here`, and
 * those rules are kept — a pill still looks like a pill and the current one is
 * still the filled one. Only what grouping adds is declared here.
 *
 * Every selector is at least `nav.tabs .x`, which outranks the single-class
 * rules in the stylesheet whichever order the two are inserted in. That matters
 * because one of the stylesheet's rules is inside a `max-width: 640px` media
 * query and this file has to win there too: `.tabs a` is given
 * `flex: 1 1 calc(50% - gap)` so that eight equal tabs wrap two-up, and a link
 * that is now a flex child of its own group must size to its content instead.
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
  // reader nothing about where they are. This became reachable the moment an
  // entry sat underneath another one, so it is fixed here rather than by
  // flattening the nav around the problem.
  const active = ENTRIES.map((entry) => entry.href)
    .filter(matches)
    .sort((left, right) => right.length - left.length)[0]

  const isActive = (href: string) => href === active

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

      {ENTRIES.map((e) => {
        const here = isActive(e.href)
        const labelId = `nav-domain-${e.domain.toLowerCase()}`
        return (
          <div
            key={e.href}
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
            {...(e.tail ? { "data-tail": "true" } : {})}
          >
            <span className="nav-group-name" id={labelId}>
              {e.domain}
            </span>
            {here ? (
              <span className="here" aria-current="page" title={e.hint}>
                {e.label}
              </span>
            ) : (
              <Link href={e.href} title={e.hint}>
                {e.label}
              </Link>
            )}
          </div>
        )
      })}
    </nav>
  )
}
