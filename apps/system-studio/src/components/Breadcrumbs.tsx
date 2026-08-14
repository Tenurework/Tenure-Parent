"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { GROUPS } from "./Nav"

import styles from "./breadcrumbs.module.css"

/**
 * Where the operator is, and the way back.
 *
 * Implements §6 of `docs/architecture/studio-information-architecture.md` —
 * the document that decides where this renders and what a crumb may say. The
 * operator's own words for what was missing: "no logout, back and forth,
 * global search". This file is the "back and forth" half. Two of the three
 * mechanisms §6 names live here: **up** (every ancestor is a link, so the
 * fleet is one click from a tenant's configuration rather than the browser's
 * Back pressed twice) and **back** (at 320px the trail collapses to a single
 * `‹ Parent` link — the parent, not `history.back()`, which after a redirect
 * goes somewhere the operator never was). The third, **return**, is the
 * palette's recents and is not this component.
 *
 * ## The four rules a crumb obeys
 *
 * 1. **A crumb is the route's real name.** Static crumbs take the word the
 *    navigation uses (`GROUPS`, imported rather than copied, so the word in
 *    the rail and the word in the trail cannot drift apart). Fixed sub-routes
 *    take the word their own page's `<h1>` uses — `/tenants/new` is "Compose a
 *    tenant", never "New", which is what title-casing a URL segment would have
 *    produced.
 * 2. **A tenant is named by its binding.** `/tenants/rochester/configuration`
 *    reads *Tenants / Simon Business School — Ainslie OSE / Configuration*.
 *    The name arrives as `names`, from the registry record; it is never
 *    derived from the slug, because a slug is an address and title-casing one
 *    invents a name the registry never agreed to.
 * 3. **An unknown segment renders the segment itself**, unlinked, and says
 *    nothing else about it. A crumb that guesses is worse than a crumb that
 *    prints the address it actually has.
 * 4. **The last crumb is not a link.** It carries `aria-current="page"` and is
 *    a `<span>`. A link to where you already are is a control that does
 *    nothing, and a screen-reader user who follows it learns nothing.
 *
 * ## Why `names` is a prop and not a read
 *
 * This is a client component — it must be, because the trail is derived from
 * `usePathname()` and a server layout cannot see the path. So it cannot read
 * DynamoDB, and it deliberately does not fetch either: a crumb that says
 * `rochester` and then becomes `Simon Business School — Ainslie OSE` when a
 * request lands is layout shift, which is the first clause of STUDIO-030-008.
 * Everything here is rendered at its final width on the server and never
 * changes after hydration.
 *
 * The mount supplies the map. `components/Launcher.tsx` already calls
 * `listFleet()` once per render of every route, for the command palette's
 * destinations, so the names are already being read — the shell hoists that
 * read and passes it to both:
 *
 * ```tsx
 * // src/app/layout.tsx, inside <main>, above {children}
 * const fleet = registryConfigured() ? await listFleet() : []
 * <Breadcrumbs names={Object.fromEntries(fleet.map((t) => [t.slug, t.displayName]))} />
 * ```
 *
 * Mounted as a bare `<Breadcrumbs />` it still renders a correct trail, and a
 * tenant crumb then shows the slug — rule 3, applied to a tenant. That is the
 * honest degradation, not the intended one.
 *
 * ## Where it renders, and the two `aria-current` values that must not collide
 *
 * §6: in the content region, immediately above the page's `<h1>`, **not** in
 * the top bar and **not** inside `nav.tabs`. `e2e/cost.spec.ts` asserts that
 * `nav.tabs [aria-current="page"]` has count exactly 1 with text exactly
 * `Cost`; a trail inside that nav would add a second and red it. Outside, both
 * are true at once — the rail marks the current section, the trail marks the
 * current page.
 */

/** Where a crumb's word came from. Rendered as `data-crumb-source`. */
export type CrumbSource =
  /** The Bible domain the current entry's group is named for. */
  | "domain"
  /** An entry label from the navigation table. */
  | "nav"
  /** A tenant's display name, from its registry binding. */
  | "binding"
  /** A fixed sub-route's own name, from the table below. */
  | "fixed"
  /** The raw path segment, because nothing here can name it. */
  | "segment"

export interface Crumb {
  /** What the crumb says. */
  label: string
  /** Where it goes, or `null` when it is the current page or nothing serves it. */
  href: string | null
  source: CrumbSource
}

export interface BreadcrumbsProps {
  /**
   * Tenant slug → the display name on that tenant's registry binding.
   *
   * Supplied by the server component that mounts this. A slug that is absent
   * from the map renders as itself: this component never invents a name.
   */
  names?: Readonly<Record<string, string>>
}

/** The one navigation entry that has routes beneath it (§9 of the IA). */
const TENANTS = "/tenants"

/**
 * Segments directly under `/tenants` that are NOT a tenant, with the word
 * their own page uses.
 *
 * `/tenants/new`'s `<h1>` is "Compose a tenant" (`tenants/new/page.tsx:226`).
 * A generic `capitalize(segment)` would render "New", which is not the name of
 * anything on that page. This map is the reason §6 forbids the generic form.
 */
const TENANT_SIBLINGS: Readonly<Record<string, string>> = {
  new: "Compose a tenant",
}

/**
 * Routes under one tenant, with the word their own page uses.
 *
 * `/tenants/[slug]/configuration` is the only one today. The trail grows a
 * leaf when a second lands, and an unlisted one prints its segment rather than
 * a guess.
 */
const TENANT_CHILDREN: Readonly<Record<string, string>> = {
  configuration: "Configuration",
}

/** `%20` and friends, for display. A segment that will not decode is shown raw. */
function readable(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** `/a/b/` and `/a/b` are the same place; `""` is `/`. */
function normalize(pathname: string): string {
  const trimmed = pathname.trim()
  if (trimmed === "" || trimmed === "/") return "/"
  const withoutTrailing = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed
  return withoutTrailing === "" ? "/" : withoutTrailing
}

/** Every navigation entry, flattened, each remembering its group. */
function entries() {
  return GROUPS.flatMap((group) =>
    group.entries.map((entry) => ({
      href: entry.href,
      label: entry.label,
      domain: group.domain,
      /** Where the domain crumb goes: the group's first entry (§6). */
      domainHref: group.entries[0]?.href ?? entry.href,
    })),
  )
}

/**
 * The trail for a path, deepest crumb last.
 *
 * Exported because it is the whole of the decision and `e2e/breadcrumbs.spec.ts`
 * exercises it directly on paths no seeded fleet contains — a malformed
 * segment, a route the navigation has never heard of, a tenant whose name the
 * map does not hold. Those are the branches a browser walk-through cannot
 * reach, and they are the ones where a breadcrumb invents things.
 *
 * `[]` means "render nothing": the sign-in page has no shell (§9.1) and no
 * sections to be between.
 */
export function trailFor(
  pathname: string,
  names: Readonly<Record<string, string>> = {},
): readonly Crumb[] {
  const path = normalize(pathname)
  if (path === "/signin" || path.startsWith("/signin/")) return []

  // The most specific entry whose subtree contains this path — the same rule
  // `Nav.tsx` lights the rail with, so the trail and the rail always agree
  // about which section the operator is in. `/` matches only itself; anything
  // else matches its subtree, so a tenant page still belongs to Fleet.
  const matched = entries()
    .filter((entry) =>
      entry.href === "/" ? path === "/" : path === entry.href || path.startsWith(`${entry.href}/`),
    )
    .sort((left, right) => right.href.length - left.href.length)[0]

  if (!matched) {
    /*
      No navigation entry owns this path. `tests/architecture/shell-separation.test.mjs`
      makes that unreachable for a served route — every route is an entry or a
      declared unlinked one under an entry — so this arm exists for the moment
      that guard is wrong, and it is deliberately the least confident thing this
      file can do: the segments, as they are, none of them linked. Linking an
      ancestor here would be this component asserting that `/reports` is served
      because `/reports/q3` was requested, which it has no way to know.
    */
    return path
      .split("/")
      .filter(Boolean)
      .map((segment) => ({ label: readable(segment), href: null, source: "segment" as const }))
  }

  const crumbs: Crumb[] = []

  /*
    The domain crumb, and the one case it is dropped.

    §6 puts the group's domain first, linked to the group's first entry. When
    the entry IS its group's first entry that crumb is a link to where the very
    next crumb goes — "Fleet › Tenants", both `/tenants`. Two adjacent controls
    with one destination is furniture, so it is dropped there and kept
    everywhere it says something the next crumb does not: `/platform/network`
    reads "AWS / Network", and `/platform` reads "Diagnostics / Platform",
    which is the line §8 draws made visible in the trail.

    DEVIATION from §6, deliberately: that section's own example renders
    "Fleet › Tenants › seed-deployed › Configuration". This renders
    "Tenants / … / Configuration".
  */
  if (matched.domainHref !== matched.href) {
    crumbs.push({ label: matched.domain, href: matched.domainHref, source: "domain" })
  }

  crumbs.push({ label: matched.label, href: matched.href, source: "nav" })

  // What is left of the path below the entry that owns it.
  const below = (matched.href === "/" ? path : path.slice(matched.href.length))
    .split("/")
    .filter(Boolean)

  let walked = matched.href === "/" ? "" : matched.href
  below.forEach((segment, index) => {
    walked = `${walked}/${segment}`
    crumbs.push(crumbBelow(matched.href, index, segment, walked, names))
  })

  // The current page is never a link, whatever the rule above decided.
  const last = crumbs[crumbs.length - 1]
  if (last) crumbs[crumbs.length - 1] = { ...last, href: null }

  return crumbs
}

/**
 * A crumb for a segment beneath a navigation entry.
 *
 * `href` is `null` unless this console is known to serve that exact shape.
 * `/tenants/<slug>` it serves; `/tenants/<slug>/<anything>/<more>` it does
 * not, and a link there would be a promise the router breaks.
 */
function crumbBelow(
  entryHref: string,
  index: number,
  segment: string,
  path: string,
  names: Readonly<Record<string, string>>,
): Crumb {
  const raw = readable(segment)

  if (entryHref === TENANTS && index === 0) {
    const fixed = TENANT_SIBLINGS[segment]
    // `/tenants/new` is a route, but it is never an ancestor of anything and
    // it is the last crumb wherever it appears, so it needs no href — and
    // `e2e/operator-roles.spec.ts:79` requires `href="/tenants/new"` to be
    // absent from an auditor's markup, shell included.
    if (fixed !== undefined) return { label: fixed, href: null, source: "fixed" }

    const named = names[segment]
    return named !== undefined && named !== ""
      ? { label: named, href: path, source: "binding" }
      : { label: raw, href: path, source: "segment" }
  }

  if (entryHref === TENANTS && index === 1) {
    const child = TENANT_CHILDREN[segment]
    return child !== undefined
      ? { label: child, href: null, source: "fixed" }
      : { label: raw, href: null, source: "segment" }
  }

  return { label: raw, href: null, source: "segment" }
}

export function Breadcrumbs({ names }: BreadcrumbsProps) {
  const pathname = usePathname() ?? "/"
  const trail = trailFor(pathname, names)

  // Nothing to say, so nothing is drawn — not an empty landmark a screen
  // reader still has to step through.
  if (trail.length === 0) return null

  const lastIndex = trail.length - 1

  return (
    /*
      A landmark with a name, so a screen reader can announce it and skip it.
      `aria-label="Breadcrumb"` is the name every assistive technology already
      has a behaviour for.
    */
    <nav aria-label="Breadcrumb" className={styles.trail} data-breadcrumbs="shell">
      {/*
        An ordered list, because the order is the meaning. `data-collapsible`
        is what the 320px rule keys off: with one crumb there is no parent to
        collapse to, and hiding the only crumb would leave an empty bar.
      */}
      <ol className={styles.list} data-collapsible={trail.length > 1 ? "true" : "false"}>
        {trail.map((crumb, index) => {
          const current = index === lastIndex
          const role = current ? "current" : index === lastIndex - 1 ? "parent" : "ancestor"
          return (
            <li
              key={`${index}-${crumb.href ?? crumb.label}`}
              className={styles.crumb}
              data-crumb-role={role}
              data-crumb-source={crumb.source}
            >
              {/* Decoration, and told so. A slash rather than a chevron: the
                  chevron points the wrong way under `dir="rtl"`, which
                  `e2e/layout.spec.ts` renders every route in. */}
              {index > 0 ? (
                <span className={styles.separator} aria-hidden="true">
                  /
                </span>
              ) : null}

              {current || crumb.href === null ? (
                <span
                  className={current ? styles.here : styles.unlinked}
                  {...(current ? { "aria-current": "page" as const } : {})}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link className={styles.link} href={crumb.href}>
                  {/* The 320px collapse: everything but the parent is
                      `display: none`, and the parent grows this mark. Hidden
                      by CSS at every other width, so it costs no JavaScript
                      and cannot shift the layout on hydration. */}
                  {role === "parent" ? (
                    <span className={styles.back} aria-hidden="true">
                      ‹
                    </span>
                  ) : null}
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
