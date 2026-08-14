import type { Metadata } from "next"

import "./globals.css"
import { Nav } from "@/components/Nav"
import { TopBar } from "@/components/TopBar"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { PreferencesMenu } from "@/components/PreferencesMenu"
import { OfflineBanner } from "@/components/OfflineBanner"
import { Launcher } from "@/components/Launcher"
import { LOGO_ICONS } from "@/components/md3/Logo"
import { NO_FLASH_SCRIPT } from "@/lib/preferences"
import { auth } from "@/lib/auth"
import { listFleet, registryConfigured } from "@/lib/registry"

export const metadata: Metadata = {
  title: "Tenure System Studio",
  description: "Internal. Configure and inspect Tenure organization systems.",
  robots: { index: false, follow: false },
  /*
    Named by the component that draws the mark rather than typed here as a
    string. `components/md3/Logo.tsx`'s own test asserts that whatever
    `LOGO_ICONS` points at exists under `public/`, which a literal in this file
    would not be. Copied into a mutable array because that constant is declared
    `as const` and Next's `Icons` type asks for `Icon[]`; the VALUE still comes
    from there, so the path cannot drift.
  */
  icons: { icon: [...LOGO_ICONS.icon] },
}

/*
  STUDIO-030-008 / docs/architecture/studio-information-architecture.md §10(b).

  This layout decides a permission: it calls `auth()`, and what it renders — the
  navigation rail, the account menu inside `TopBar`, the breadcrumb trail —
  depends on the answer. Without this export Next is free to prerender the
  layout at build time, in a container with no operator environment, and then
  serve every visitor a shell rendered from a build-time session. That is the
  identical defect `tests/architecture/authorizing-routes-are-dynamic.test.mjs`
  exists for, one file to the left of the `page.tsx` filter it applies: widening
  its regex to `/\/(page|layout)\.tsx$/` is what would make it see this file,
  and that edit belongs to the lane that owns `tests/architecture/`.
*/
export const dynamic = "force-dynamic"

/**
 * The System Studio shell.
 *
 * The frame — §3.1 of `docs/architecture/studio-information-architecture.md`.
 * What it replaced was a 1280px column centred in the viewport with a
 * four-item bar above it: no sign-out, no search anybody could see, no
 * account, no mark, and 320px of dead page down each side of a 1920px monitor.
 * The operator's words were "very weak, cluttered, and isolated in the centre
 * of the screen".
 *
 * ## Three regions, and which of them scrolls
 *
 *   TOP BAR   sticky at the block start, for the life of the session
 *   RAIL      sticky under it, full height, its tree scrolling inside itself
 *   CONTENT   fluid width, and it is still the PAGE that scrolls
 *
 * The last clause is a contract rather than a detail. `e2e/commands.spec.ts`
 * measures `window.scrollY` and `main`'s box before and after the command
 * palette opens and requires both unchanged, which is only meaningful while the
 * document itself is the scroll container. Making the content region
 * `overflow-y: auto` would move the scroll position onto a div, leave
 * `window.scrollY` permanently 0, and turn that assertion into one that can
 * never fail. The navigation tree is the single exception and it is bounded to
 * its own box (`components/nav.module.css`, `.panel`, against the
 * `--console-nav-offset` this shell sets in `globals.css`).
 *
 * ## What this file decides, and what it does not
 *
 * It decides where the three regions are and which of them exist. It decides
 * none of their contents: `TopBar` owns the bar's slots and its sign-out,
 * `Nav` owns the tree and its own disclosure below 901px, `Breadcrumbs` owns
 * the trail. Each of those is a separate lane's file in this run, and the
 * boundary is the point — a shell that also authored a mark, a second search
 * control or a second sign-out would be a shell that has to be edited whenever
 * any of them changes.
 *
 * ## Why the frame keys off the session rather than the path
 *
 * §9.1: `/signin` renders no rail and no session controls. A server layout
 * cannot read the pathname — there is no middleware here writing one into a
 * header, and `usePathname` is a client hook. It does not need to:
 *
 *   · `signin/page.tsx` redirects an operator who is already signed in to `/`;
 *   · every shell route redirects a visitor with no principal to `/signin`.
 *
 * So "no session" and "on the sign-in page" are the same state reached from two
 * directions, and the session is the honest thing to key off because it is what
 * the chrome is actually about. A signed-in address that is not on the operator
 * allowlist is the one case where they part: that visitor gets the frame, an
 * account menu that says so, and a refusal on every page — which is the truth,
 * rather than a shell that pretends they are nobody.
 *
 * ## No layout shift
 *
 * Everything here is server-rendered at its final size. The rail's inline size
 * is a CSS token rather than a measured value, the tree is in the first paint
 * at every width above 900px without hydration, both disclosures render closed
 * on the server, the mark carries explicit `width`/`height`, and the tenant
 * names the trail needs are read HERE and passed down rather than fetched by
 * the client component that draws them. `e2e/layout.spec.ts` proves it by
 * measuring the same boxes in a JavaScript-disabled context and comparing.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const signedIn = typeof session?.user?.email === "string" && session.user.email !== ""

  /*
    Slug → display name, for the tenant crumb.

    Read here, in the server component that mounts the trail, because
    `Breadcrumbs` is a client component: a crumb that says `rochester` and
    becomes "Simon Business School — Ainslie OSE" when a fetch lands is layout
    shift, which is the first clause of STUDIO-030-008. Rendered on the server,
    it is right in the first paint and never moves.

    A registry failure degrades to the slug and says nothing, which is the same
    trade `components/Launcher.tsx` makes for the palette's destinations and for
    the same reason: the pages themselves render an honest error when this read
    fails there, and taking the whole shell down because a label could not be
    resolved would be the wrong one.
  */
  let names: Record<string, string> = {}
  if (signedIn && registryConfigured()) {
    try {
      names = Object.fromEntries((await listFleet()).map((tenant) => [tenant.slug, tenant.displayName]))
    } catch {
      names = {}
    }
  }

  return (
    /*
      STUDIO-030-007. `dir` is written explicitly rather than left to the
      browser's default, because it is the attribute every logical property in
      globals.css resolves against and an attribute that is absent is an
      attribute the pre-paint script has nothing to flip. The script below
      replaces it with `rtl` when the stored preference says so, before the
      first paint — a direction changed after hydration reflows the whole page
      under the reader.
    */
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body>
        {/*
          First child of <body>, not inside <head>: the App Router does not
          render an arbitrary <script> placed in <head> — it was silently
          dropped from the served HTML, which is a flash nobody would have
          traced back to here. Parsed and executed before any content below it,
          so the attribute is set before the first paint either way.
        */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />

        {/*
          STUDIO-030-007, and the first thing in the tab order on every route.

          A persistent rail is fourteen tab stops between the top of the
          document and the page, on every navigation, and it is persistent
          precisely so it is not re-traversed. The target carries
          `tabIndex={-1}` because a browser will not move focus to an element
          that cannot hold it, and a skip link that scrolls without moving focus
          leaves the next Tab back at the top of the rail.
        */}
        <a className="skip-link" href="#console-main">
          Skip to content
        </a>

        {/*
          The bar, and the console's own display preferences as its utility
          slot — `TopBar` documents that slot as exactly this. Preferences are a
          control about the viewer rather than about the estate, so they sit
          beside the account menu and not in the middle of the brand.

          The `<header className="masthead">` around it is the SHELL's region,
          and it is not decoration. Two things need it:

            · It is the element the information architecture names (§3.1, "the
              top bar … `.masthead` is already sticky; what changes is what it
              carries"), and `e2e/breadcrumbs.spec.ts` measures
              `header.masthead` to assert the trail sits below the bar and above
              the page's `<h1>`. `TopBar` renders a `<div role="banner">`, so
              without this wrapper that assertion measures nothing and the test
              cannot fail.
            · A real `<header>` is the element a browser maps to the banner
              landmark, rather than a div that says it is one.

          `role="presentation"` because the bar inside already declares
          `role="banner"`, and two banner landmarks on one page is a defect of
          its own. The wrapper is a position in the frame; the bar is the
          landmark. It carries `position: sticky` in `globals.css` so the region
          is what stays, and the bar's own sticky inside it then resolves
          against a containing block of exactly its own height — which is a
          no-op rather than a fight.
        */}
        <header className="masthead" role="presentation">
          <TopBar>
            <PreferencesMenu />
          </TopBar>
        </header>

        <div className="console-shell" data-shell={signedIn ? "console" : "bare"}>
          {signedIn ? (
            /*
              The persistent navigation region.

              A plain container: `Nav` carries its own disclosure below 901px
              and its own scrolling panel, so a second disclosure here would be
              two controls for one tree and a second scroller would be a
              scrollbar inside a scrollbar. What this region supplies is the
              part the navigation cannot know — where it is, how wide it is, and
              that it stays with the operator as the page scrolls.
            */
            <div className="console-rail">
              <Nav />
            </div>
          ) : null}

          <div className="console-content">
            {/*
              `id` and `tabIndex` for the skip link above, and for the focus
              restoration at the end of this file. `main` is fluid: the width it
              gets is whatever the rail leaves, and `e2e/layout.spec.ts`
              measures that at 1440 and at 1920 rather than trusting it.
            */}
            <main id="console-main" tabIndex={-1}>
              <OfflineBanner />
              {/*
                §6. In the content region, immediately above the page's `<h1>`
                — not in the top bar and not inside `nav.tabs`.
                `e2e/cost.spec.ts` asserts that exactly one element inside that
                nav carries `aria-current="page"`; a trail inside it would add a
                second and red it. Out here both are true at once: the rail
                marks the current section, the trail marks the current page.
              */}
              <Breadcrumbs names={names} />
              {children}
            </main>
          </div>
        </div>

        {/* GE-022-007. In the layout so Ctrl/Cmd-K reaches it from every route. */}
        <Launcher />

        {/*
          STUDIO-030-008, the focus half — where a keyboard operator lands after
          a route change.

          The defect, measured rather than assumed: `Nav.tsx` renders the entry
          an operator is ON as a `<span class="here">` and every other entry as
          an `<a>`. Activating a rail link therefore makes React unmount the
          very anchor that has focus and mount a span in its place, and a
          browser whose focused element is removed puts focus on `<body>`. The
          next Tab then starts at the top of the document — past the skip link,
          the mark, the estate chip, the search control, the account menu and
          every rail entry — to reach the page that was just opened. That is the
          "focus loss" this requirement names, it happens on every navigation,
          and it is invisible to a mouse. The command palette drops focus the
          same way on `router.push` (`CommandPalette.tsx`, `returnFocusTo.current
          = null`), and so does any link inside a page that the new page does
          not also render.

          The shell is the right place to answer it, because focus management
          across a route transition belongs to whatever survives the transition
          and this layout is the only thing that does. When a navigation
          completes and focus has been dropped on `<body>`, it is moved to the
          content region — where the operator was going, and where the next Tab
          should continue from. `preventScroll`, because moving focus must not
          also move the page; `#console-main` carries `tabIndex={-1}` so it can
          hold focus at all.

          The window is bounded and the check is a condition rather than a
          timer: React commits the new route a frame or two after the URL
          changes, so a single check scheduled at the navigation would run while
          the dying anchor still holds focus and would conclude, wrongly, that
          nothing had been lost. Ten polls at 50ms cover the transition and then
          stop; if focus is on something real at any point in that window,
          nothing is touched.

          The URL poll is installed unconditionally and the Navigation API
          listener is added on top of it, rather than as an either/or. Whether
          `navigatesuccess` fires for the `history.pushState` the App Router
          uses is a detail of one browser's implementation of one spec, and a
          focus repair that silently stops working when that detail changes is
          worse than a 100ms interval comparing two strings.

          It is an inline script rather than a component because every component
          file in this shell belongs to another lane in this run, and because
          this has to be attached before the first navigation can happen rather
          than at hydration.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
var tries=0,timer=null;
function rescue(){
 tries++;
 if(document.activeElement===document.body){
  var m=document.getElementById("console-main");
  if(m){m.focus({preventScroll:true});clearInterval(timer);timer=null;return;}
 }
 if(tries>10){clearInterval(timer);timer=null;}
}
function watch(){tries=0;if(timer)clearInterval(timer);timer=setInterval(rescue,50);}
var last=location.href;
setInterval(function(){if(location.href!==last){last=location.href;watch();}},100);
if(window.navigation&&window.navigation.addEventListener){
 window.navigation.addEventListener("navigatesuccess",watch);
}
window.addEventListener("popstate",watch);})();`,
          }}
        />
      </body>
    </html>
  )
}
