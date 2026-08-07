/**
 * @jest-environment jsdom
 */

/**
 * TTES-GATE-020 / TTES-020-003 — the owned wrapper layer, asserted on what the
 * product actually renders.
 *
 * `scripts/design-token-lint.test.mjs` proves the ESLint boundary fires and that
 * no shipping module names a vendor primitive. That is the negative half. This
 * is the positive half: the wrappers those modules were pointed at are really
 * rendering, and the token classes the domain modules used to hand-write now
 * arrive from the wrapper.
 *
 * Every assertion below reads the DOM a *production component* produced —
 * `CalendarSubscribe`, `TenantSwitcher`. Asserting on `Button({variant})`
 * directly would stay green the day a caller stopped using it, which is the
 * failure this file is written to avoid.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { CalendarSubscribe } from "@/components/CalendarSubscribe"
import { AIProvider } from "@/components/ai/AIProvider"
import { NotificationBell } from "@/components/shell/NotificationBell"
import { SideNav } from "@/components/shell/SideNav"
import { TenantSwitcher } from "@/components/shell/TenantSwitcher"

// The two Next runtime pieces SideNav needs and jsdom cannot supply: an app
// router for `usePathname`, and next/link's router context. `next/link` renders
// an <a href> in the browser, so an <a href> is what it is replaced with — the
// substitution changes nothing the assertions below read.
jest.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }))
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// react-aria's overlays measure their trigger before positioning. jsdom has no
// layout engine and no ResizeObserver, so without this the Popover throws on
// open rather than rendering — the stub is jsdom plumbing, not a stand-in for
// anything under test.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver

// React 19 only treats `act` as an act-scope when this is set; without it every
// state update warns and the queue is flushed outside the scope.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(node: React.ReactNode) {
  act(() => {
    root.render(node)
  })
}

/** react-aria opens a MenuTrigger on pointer press, not on click alone. */
function press(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1 }))
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, detail: 1 }))
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }))
  })
}

describe("domain modules render the owned wrappers", () => {
  it("gives CalendarSubscribe's trigger the owned secondary button, pressed state and all", () => {
    render(<CalendarSubscribe feedPath="/api/calendar/feed/abc.ics" />)

    const trigger = container.querySelector("button")
    expect(trigger).not.toBeNull()
    expect(trigger!.textContent).toContain("Subscribe")

    const cls = trigger!.className
    // The hand-written copy this replaced had a hover state and no pressed
    // state at all, so a pressed state proves the classes came from Button.tsx
    // rather than from this file...
    expect(cls).toContain("data-[pressed]:bg-[--bg-subtle]")
    // ...and the hover border pins it to `secondary` specifically — `ghost`
    // carries the same pressed class, so the line above alone would not.
    expect(cls).toContain("data-[hovered]:border-[--text-3]")
    // ...and the shared size scale, which the two copies had already drifted
    // apart on (h-10 here vs h-9 in ClubImageEditor).
    expect(cls).toContain("h-control")
  })

  it("gives the tenant switcher the shell variant rather than a local class string", () => {
    render(
      <TenantSwitcher
        active={{ id: "inst-a", slug: "north", name: "North High" }}
        options={[
          { id: "inst-a", slug: "north", name: "North High" },
          { id: "inst-b", slug: "south", name: "South High" },
        ]}
        onSwitch={async () => {}}
      />
    )

    const trigger = container.querySelector("button")
    expect(trigger).not.toBeNull()
    const cls = trigger!.className
    expect(cls).toContain("data-[hovered]:bg-[--shell-item-hover]")
    expect(cls).toContain("data-[hovered]:text-[--shell-text]")
    expect(cls).toContain("rounded-lg")
  })

  it("opens that switcher's menu through MenuPopover / Menu / MenuItem", () => {
    const switched: string[] = []
    render(
      <TenantSwitcher
        active={{ id: "inst-a", slug: "north", name: "North High" }}
        options={[
          { id: "inst-a", slug: "north", name: "North High" },
          { id: "inst-b", slug: "south", name: "South High" },
        ]}
        onSwitch={async (id) => {
          switched.push(id)
        }}
      />
    )

    press(container.querySelector("button")!)

    // The popover portals to document.body, not into `container`.
    const panel = document.querySelector('[data-trigger="MenuTrigger"]')
    expect(panel).not.toBeNull()
    // Panel chrome from MenuPopover, list padding from Menu — neither is
    // written anywhere in TenantSwitcher.tsx any more.
    expect(panel!.className).toContain("pop-panel")
    expect(panel!.className).toContain("border-border")
    expect(panel!.querySelector('[role="menu"]')!.className).toContain("p-1.5")

    const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("North High"),
      expect.stringContaining("South High"),
    ])
    // Row chrome from MenuItem, plus the `split` layout the switcher asks for
    // so the "(current)" marker sits at the end of the row.
    expect(items[0].className).toContain("data-[focused]:bg-base")
    expect(items[0].className).toContain("justify-between")

    // And the menu still does the thing it exists for.
    press(items[1])
    expect(switched).toEqual(["inst-b"])
  })

  it("hangs the notification dropdown off the bell through the owned PopoverDialog", async () => {
    // Shaped like GET /api/notifications, because the component reads
    // `unread` and `items` off it and renders from both.
    const payload = {
      unread: 1,
      items: [
        {
          id: "ntf_1",
          title: "Budget request approved",
          body: null,
          href: null,
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      ],
    }
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => payload }))
    ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock

    render(<NotificationBell initialUnread={1} />)
    await act(async () => {})

    const bell = container.querySelector("button")!
    expect(bell.getAttribute("aria-label")).toBe("Notifications (1 unread)")
    // The bell is the owned Button's shell chrome, sized as an icon control.
    expect(bell.className).toContain("data-[hovered]:bg-[--shell-item-hover]")
    expect(bell.className).toContain("w-9")

    press(bell)
    await act(async () => {})

    const panel = document.querySelector('[data-trigger="DialogTrigger"]')
    expect(panel).not.toBeNull()
    // Panel chrome from PopoverDialog in ui/Overlay.tsx — NotificationBell no
    // longer states any of it.
    expect(panel!.className).toContain("pop-panel")
    expect(panel!.className).toContain("rounded-xl")
    expect(panel!.className).toContain("overflow-hidden")

    // The dialog inside it is labelled by PopoverDialog's `label`, and the
    // render-prop `close` still reaches the caller's list.
    const dialog = panel!.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute("aria-label")).toBe("Notifications")
    expect(dialog.textContent).toContain("Budget request approved")
    expect(dialog.textContent).toContain("See all notifications")
  })

  it("gives the collapsed side nav its labels back through the owned Tooltip", () => {
    // The tooltips only arm when the rail is collapsed to icons — SideNav reads
    // that off the class the pre-hydration script sets.
    document.documentElement.classList.add("nav-collapsed")
    jest.useFakeTimers()
    try {
      render(
        <AIProvider>
          <SideNav
            sections={[
              {
                label: "Work",
                items: [{ id: "platform.dashboard", label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" }],
              },
            ]}
          />
        </AIProvider>
      )

      const link = container.querySelector('a[href="/dashboard"]')!
      act(() => {
        link.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }))
        link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      })
      // TooltipTrigger's owned 250ms delay — the number SideNav used to repeat
      // at every trigger and now never states.
      act(() => {
        jest.advanceTimersByTime(400)
      })

      const tip = document.querySelector('[role="tooltip"]')
      expect(tip).not.toBeNull()
      expect(tip!.textContent).toBe("Dashboard")
      // Panel chrome from ui/Tooltip.tsx. SideNav's local TOOLTIP_CLASS is gone.
      expect(tip!.className).toContain("pop-panel")
      expect(tip!.className).toContain("bg-surface")
      // Placement is the wrapper's default too: away from the rail.
      expect(tip!.getAttribute("data-placement")).toBe("right")
    } finally {
      jest.useRealTimers()
      document.documentElement.classList.remove("nav-collapsed")
    }
  })
})
