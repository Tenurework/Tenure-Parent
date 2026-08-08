/**
 * @jest-environment jsdom
 */

/**
 * TTES-030-001 — the command palette, asserted on the DOM the PRODUCTION
 * component emits.
 *
 * Bible §5.1 requires "Global command/search (⌘/Ctrl K) with permission-aware
 * actions and recent objects". Three things were missing and each has a case
 * here, written so that removing the production line reddens it:
 *
 *   * **A keyboard route.** The only key handler in the whole shell was an
 *     `onKeyDown` on this input, so the palette could not be reached from the
 *     keyboard from any route. The listener under test is on `document`, which
 *     is the whole point — it has to fire while focus is somewhere else
 *     entirely, so the case below dispatches at `document.body`.
 *   * **Combobox semantics.** The `active` index used to move a background
 *     colour and nothing else. `aria-activedescendant` is what makes arrowing
 *     audible, and it is the one attribute a screen-reader user's experience
 *     depends on, so it gets an assertion that names the exact option id.
 *   * **Permission-aware actions.** The rows come from `sections` — the same
 *     `navigationForSystem(slug, capabilities)` result the layout hands
 *     `SideNav`. The negative case below is the load-bearing one: a capability
 *     the viewer does not hold is not in `sections`, so there is nothing to
 *     filter and nothing to forget to filter.
 *
 * The `sections` prop is REQUIRED on both `SearchCommand` and `ShellHeader`, so
 * `src/app/(app)/layout.tsx` — the one construction site — cannot ship an
 * action-less palette without `tsc` saying so.
 *
 * This is the DOM half. `e2e/shell.spec.ts` drives the same widget through a
 * real browser from a real route; neither replaces the other, and both read
 * what the component renders rather than calling a helper.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { SearchCommand } from "@/components/shell/SearchCommand"
import type { NavSectionView } from "@/components/shell/SideNav"

// The two Next runtime pieces jsdom cannot supply. `next/link` renders an
// `<a href>` in the browser, so an `<a href>` is what it is replaced with —
// nothing the assertions read changes.
const push = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => push(href) }),
}))
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// React 19 only treats `act` as an act-scope when this is set.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * What the layout resolves for a member who holds the club capabilities and
 * NOT the admin ones. `Admin console` is deliberately absent rather than
 * present-and-hidden: that absence is what "permission-aware" means here.
 */
const MEMBER_SECTIONS: readonly NavSectionView[] = [
  {
    label: "Overview",
    items: [
      { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
      { id: "clubs", label: "Clubs", href: "/orgs", icon: "Building2" },
    ],
  },
  {
    label: "Work",
    items: [
      { id: "approvals", label: "Approvals", href: "/approvals", icon: "CheckCircle" },
      // An entry that runs a UI behaviour rather than navigating. It has no
      // href worth pushing, so the palette must not offer it.
      { id: "ai", label: "Tenure AI", href: "", icon: "TenureAIMark", action: "openAiPanel" },
    ],
  },
]

let container: HTMLElement
let root: Root

beforeEach(() => {
  push.mockClear()
  window.sessionStorage.clear()
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

function input(): HTMLInputElement {
  const el = container.querySelector("input[name='q']")
  if (!el) throw new Error("the palette rendered no search input")
  return el as HTMLInputElement
}

/** A key pressed on the input itself — the arrow keys and Escape. */
function pressOnInput(key: string) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
  })
}

describe("the command palette", () => {
  it("opens and focuses on Ctrl-K pressed anywhere on the document", () => {
    render(<SearchCommand sections={MEMBER_SECTIONS} />)

    // Focus starts nowhere near the palette, which is the situation the
    // document-level listener exists for.
    expect(document.activeElement).not.toBe(input())
    expect(input().getAttribute("aria-expanded")).toBe("false")

    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.body.dispatchEvent(event)
    })

    // Mutation this catches: delete the `document.addEventListener("keydown")`
    // effect from SearchCommand and all three of these fail.
    expect(document.activeElement).toBe(input())
    expect(input().getAttribute("aria-expanded")).toBe("true")
    // Ctrl-K is the browser's own search shortcut on some builds; without
    // preventDefault the palette opens and the browser takes focus back.
    expect(event.defaultPrevented).toBe(true)
  })

  it("tracks the arrowed row in aria-activedescendant", () => {
    render(<SearchCommand sections={MEMBER_SECTIONS} />)

    act(() => {
      input().dispatchEvent(new FocusEvent("focus", { bubbles: false }))
      input().focus()
    })

    // Nothing arrowed yet: the attribute must be absent, not empty. An empty
    // string is a valid id reference target of "" and reads as a broken
    // pointer rather than as "no active option".
    expect(input().hasAttribute("aria-activedescendant")).toBe(false)

    pressOnInput("ArrowDown")

    // Mutation this catches: remove `aria-activedescendant` from the input and
    // this line fails while the visible highlight still works — which is
    // exactly the defect, since the highlight was all that ever moved.
    expect(input().getAttribute("aria-activedescendant")).toBe("shell-search-opt-0")

    // The id has to resolve to a real option, or the attribute points nowhere.
    const first = container.querySelector("#shell-search-opt-0")
    expect(first).not.toBeNull()
    expect(first!.getAttribute("role")).toBe("option")
    expect(first!.getAttribute("aria-selected")).toBe("true")

    pressOnInput("ArrowDown")
    expect(input().getAttribute("aria-activedescendant")).toBe("shell-search-opt-1")
    expect(
      container.querySelector("#shell-search-opt-0")!.getAttribute("aria-selected"),
    ).toBe("false")
    expect(
      container.querySelector("#shell-search-opt-1")!.getAttribute("aria-selected"),
    ).toBe("true")

    // Arrowing back off the top returns to "no active option" rather than
    // leaving a stale pointer behind.
    pressOnInput("ArrowUp")
    pressOnInput("ArrowUp")
    expect(input().hasAttribute("aria-activedescendant")).toBe(false)
  })

  it("wires the combobox to the listbox it actually renders", () => {
    render(<SearchCommand sections={MEMBER_SECTIONS} />)
    act(() => {
      input().focus()
    })

    expect(input().getAttribute("role")).toBe("combobox")
    expect(input().getAttribute("aria-autocomplete")).toBe("list")

    // aria-controls must name an element that exists — a dangling reference is
    // worse than none, because a reader follows it and lands nowhere.
    const controls = input().getAttribute("aria-controls")
    expect(controls).toBe("shell-search-listbox")
    const listbox = container.querySelector(`#${controls}`)
    expect(listbox).not.toBeNull()
    expect(listbox!.getAttribute("role")).toBe("listbox")
  })

  it("offers only actions the viewer's capabilities granted", () => {
    render(<SearchCommand sections={MEMBER_SECTIONS} />)
    act(() => {
      input().focus()
    })

    const labels = Array.from(container.querySelectorAll("[role='option']")).map((li) =>
      li.textContent ?? "",
    )

    expect(labels.join(" | ")).toContain("Go to Dashboard")
    expect(labels.join(" | ")).toContain("Go to Approvals")

    // The load-bearing negative. `Admin console` is not in MEMBER_SECTIONS
    // because `navigationForSystem` never put it there for this principal, so
    // the palette has nothing to offer. Mutation: add an admin item to
    // MEMBER_SECTIONS and this fails — which is the point, because it proves
    // the palette is showing `sections` and not a hardcoded command list.
    expect(labels.join(" | ")).not.toContain("Admin console")

    // The behaviour-only entry has no href to push, so it is not a row.
    expect(labels.join(" | ")).not.toContain("Go to Tenure AI")
  })

  it("offers recent objects before anything is typed", () => {
    window.sessionStorage.setItem(
      "tenure.command.recents",
      JSON.stringify([
        {
          title: "Simon Consulting Club",
          href: "/orgs/simon-consulting/members",
          kind: "organization",
          context: "Club",
        },
      ]),
    )

    render(<SearchCommand sections={MEMBER_SECTIONS} />)
    act(() => {
      input().focus()
    })

    const text = Array.from(container.querySelectorAll("[role='option']"))
      .map((li) => li.textContent ?? "")
      .join(" | ")
    expect(text).toContain("Simon Consulting Club")
  })
})
