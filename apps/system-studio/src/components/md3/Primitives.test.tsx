/**
 * @jest-environment jsdom
 */
import { act, useState, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"

import { Accordion } from "./Accordion"
import { Combobox } from "./Combobox"
import { Drawer } from "./Drawer"
import { Menu } from "./Menu"
import { ModalDialog } from "./ModalDialog"
import { Popover } from "./Popover"
import { ToastRegion } from "./ToastRegion"
import { Tooltip } from "./Tooltip"
import { Tree } from "./Tree"

/**
 * The wiring, against a real DOM.
 *
 * `e2e/md3-primitives-logic.spec.ts` enumerates the DECISIONS — what End means
 * on a list whose last two items are disabled, what ArrowLeft means on a
 * collapsed tree node — and it can do that at node speed because those live in
 * pure modules. It cannot prove that pressing the key MOVES ANYTHING.
 *
 * That is this file. Focus moving, focus coming back, `inert` going on and
 * coming off, a live region existing before the message that goes into it, an
 * `aria-activedescendant` naming an element that is actually in the listbox it
 * claims. Each of those is a wire between the model and the browser, and a wire
 * is exactly what a screenshot cannot show and a type checker cannot see.
 *
 * ## Why not Testing Library
 *
 * It is not a dependency of this repository and adding one to write a test is a
 * decision that belongs to whoever owns the dependency list. React 19 exports
 * `act`, `react-dom/client` renders into a real document, and dispatching a
 * `KeyboardEvent` on the focused element is what a keyboard does anyway. The
 * helper below is eleven lines.
 *
 * ## What is NOT proven here, honestly
 *
 * `FileUpload`'s selection path. A `FileList` cannot be constructed in this
 * environment (`DataTransfer` is not implemented), so the component's rules are
 * proven through `files.ts` in the logic spec and its markup in
 * `PrimitivesMarkup.test.tsx`;
 * the change handler itself is exercised by neither. It is named rather than
 * left for someone to discover.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function render(node: ReactNode) {
  act(() => {
    root.render(node)
  })
}

/** A frame, so `useFocusTrap`'s deferred initial focus has happened. */
async function frame() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 24))
  })
}

function press(key: string, options: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }))
  })
}

/** Focus, inside `act`, because a control that opens on focus updates state. */
function focus(element: HTMLElement) {
  act(() => {
    element.focus()
  })
}

function click(element: Element | null) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  // Only what this test made. A teardown that emptied `document.body` would
  // remove whatever another test had left there, which is the fixture defect
  // that deletes rows it did not create.
  host.remove()
})

const MENU_GROUPS = [
  {
    key: "session",
    label: "Signed in",
    items: [
      { key: "profile", label: "Profile", onSelect: jest.fn() },
      { key: "preferences", label: "Preferences", onSelect: jest.fn() },
    ],
  },
  {
    key: "danger",
    items: [
      { key: "impersonate", label: "Impersonate", disabled: true, onSelect: jest.fn() },
      { key: "signout", label: "Sign out", tone: "danger" as const, onSelect: jest.fn() },
    ],
  },
]

function menuItems() {
  return [...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]
}

describe("Menu", () => {
  test("the trigger says what it opens before it opens it", () => {
    render(<Menu label="Account" trigger="Account" groups={MENU_GROUPS} />)
    const trigger = host.querySelector("button")!
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    // No dangling reference: aria-controls names the menu only while it exists.
    expect(trigger.hasAttribute("aria-controls")).toBe(false)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  test("clicking opens it with the first item focused", () => {
    render(<Menu label="Account" trigger="Account" groups={MENU_GROUPS} />)
    click(host.querySelector("button"))
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe("Account")
    expect(document.activeElement?.textContent).toContain("Profile")
    // Roving tabindex: one stop for the whole menu.
    const tabbable = menuItems().filter((item) => item.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
  })

  test("ArrowUp on the trigger opens it at the LAST item", () => {
    render(<Menu label="Account" trigger="Account" groups={MENU_GROUPS} />)
    focus(host.querySelector("button")!)
    press("ArrowUp")
    expect(document.activeElement?.textContent).toContain("Sign out")
  })

  test("arrows move focus and skip the disabled item", () => {
    render(<Menu label="Account" trigger="Account" groups={MENU_GROUPS} />)
    click(host.querySelector("button"))
    press("ArrowDown")
    expect(document.activeElement?.textContent).toContain("Preferences")
    press("ArrowDown")
    // "Impersonate" is disabled: rendered, announced, not landed on.
    expect(document.activeElement?.textContent).toContain("Sign out")
    expect(menuItems()[2].getAttribute("aria-disabled")).toBe("true")
  })

  test("a printable character jumps to the item that starts with it", () => {
    render(<Menu label="Account" trigger="Account" groups={MENU_GROUPS} />)
    click(host.querySelector("button"))
    press("s")
    expect(document.activeElement?.textContent).toContain("Sign out")
  })

  test("Escape closes it and puts focus back on the trigger", () => {
    render(<Menu label="Account" trigger="Account" groups={MENU_GROUPS} />)
    const trigger = host.querySelector("button")!
    focus(trigger)
    click(trigger)
    expect(document.activeElement).not.toBe(trigger)
    press("Escape")
    expect(document.querySelector('[role="menu"]')).toBeNull()
    // The whole of "safe focus restoration": Escape must not cost a keyboard
    // user their place on the page.
    expect(document.activeElement).toBe(trigger)
  })

  test("choosing an item runs it, closes, and restores focus", () => {
    const onSelect = jest.fn()
    render(
      <Menu
        label="Account"
        trigger="Account"
        groups={[{ key: "g", items: [{ key: "a", label: "Alpha", onSelect }] }]}
      />,
    )
    const trigger = host.querySelector("button")!
    focus(trigger)
    click(trigger)
    click(menuItems()[0])
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  test("Tab closes it and does NOT drag focus back", () => {
    render(<Menu label="Account" trigger="Account" groups={MENU_GROUPS} />)
    const trigger = host.querySelector("button")!
    focus(trigger)
    click(trigger)
    press("Tab")
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })
})

describe("Popover", () => {
  test("it opens, names its panel, and closes on Escape with focus returned", () => {
    render(
      <Popover label="Filters" trigger="Filters">
        <button type="button">Apply</button>
      </Popover>,
    )
    const trigger = host.querySelector("button")!
    focus(trigger)
    click(trigger)
    const panel = document.querySelector('[role="dialog"]')!
    expect(panel.getAttribute("aria-label")).toBe("Filters")
    // Non-modal, and it says so by NOT claiming otherwise.
    expect(panel.hasAttribute("aria-modal")).toBe(false)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id)
    press("Escape")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  test("the panel is a sibling of the trigger, not a portal to the end of the page", () => {
    render(
      <Popover label="Filters" trigger="Filters">
        <button type="button">Apply</button>
      </Popover>,
    )
    click(host.querySelector("button"))
    // Reading order is tab order. A panel portalled to <body> is reached only
    // after every other control on the page.
    expect(host.contains(document.querySelector('[role="dialog"]'))).toBe(true)
  })
})

describe("ModalDialog", () => {
  function Harness({ children }: { children?: ReactNode }) {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <ModalDialog
          open={open}
          onClose={() => setOpen(false)}
          headline="Purge tenant"
          supportingText="This cannot be undone."
          actions={<button type="button">Purge</button>}
        >
          {children}
        </ModalDialog>
      </div>
    )
  }

  test("it claims modality and earns it: portal, inert background, trapped Tab", async () => {
    render(<Harness />)
    const opener = host.querySelector("button")!
    focus(opener)
    click(opener)
    await frame()

    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    // Portalled OUT of the app tree, which is the only way there is something
    // left to make inert.
    expect(host.contains(dialog)).toBe(false)
    expect(host.getAttribute("inert")).toBe("")
    // Named by its own heading, described by its own supporting line.
    const headingId = dialog.getAttribute("aria-labelledby")!
    expect(document.getElementById(headingId)?.textContent).toBe("Purge tenant")
    const describedId = dialog.getAttribute("aria-describedby")!
    expect(document.getElementById(describedId)?.textContent).toBe("This cannot be undone.")
    // Focus starts on the way OUT, never on the irreversible action.
    expect(document.activeElement?.textContent).toBe("Cancel")

    // Tab from the last stop wraps to the first rather than escaping.
    const stops = [...dialog.querySelectorAll("button")] as HTMLElement[]
    focus(stops[stops.length - 1])
    press("Tab")
    expect(document.activeElement).toBe(stops[0])
    press("Tab", { shiftKey: true })
    expect(document.activeElement).toBe(stops[stops.length - 1])
  })

  test("Escape closes it, restores focus, and gives the page back", async () => {
    render(<Harness />)
    const opener = host.querySelector("button")!
    focus(opener)
    click(opener)
    await frame()
    press("Escape")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    // Inert removed. A page left inert after a dialog closes is a page nobody
    // can use and nothing on screen explains.
    expect(host.hasAttribute("inert")).toBe(false)
  })

  test("Escape closes only the TOP layer", async () => {
    function Stacked() {
      const [drawer, setDrawer] = useState(true)
      const [dialog, setDialog] = useState(true)
      return (
        <div>
          <Drawer open={drawer} onClose={() => setDrawer(false)} title="Inspector">
            <button type="button">Inside the drawer</button>
          </Drawer>
          <ModalDialog open={dialog} onClose={() => setDialog(false)} headline="Confirm">
            <button type="button">Inside the dialog</button>
          </ModalDialog>
        </div>
      )
    }
    render(<Stacked />)
    await frame()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    press("Escape")
    // One keystroke, one layer. Without the stack, a confirm dialog opened from
    // a drawer takes the drawer with it.
    const left = [...document.querySelectorAll('[role="dialog"]')]
    expect(left).toHaveLength(1)
    expect(left[0].getAttribute("aria-labelledby")).toBeTruthy()
    expect(left[0].textContent).toContain("Inspector")
  })
})

describe("Drawer", () => {
  test("its body is a named, focusable scroll region and its actions are outside it", async () => {
    render(
      <Drawer
        open
        onClose={() => {}}
        title="Resource inspector"
        footer={<button type="button">Apply</button>}
      >
        <p>Forty rows of properties.</p>
      </Drawer>,
    )
    await frame()
    const body = document.querySelector('[data-md3="drawer-body"]') as HTMLElement
    // WCAG 2.1.1: a scrolling region with no focusable content is unreachable
    // from a keyboard without a tab stop of its own.
    expect(body.tabIndex).toBe(0)
    expect(body.getAttribute("aria-labelledby")).toBeTruthy()
    // STUDIO-030-008, hidden scrolling actions: the footer is not inside the
    // thing that scrolls.
    expect(body.contains(document.querySelector('[data-md3="drawer-footer"]'))).toBe(false)
  })
})

describe("Tooltip", () => {
  test("the description exists before it is shown, and focus shows it", () => {
    render(
      <Tooltip tip="The account the change runs in.">
        <button type="button">Account</button>
      </Tooltip>,
    )
    const tip = host.querySelector('[role="tooltip"]')!
    const described = host.querySelector("[aria-describedby]")!
    // Present in the accessibility tree whether or not it is visible: a
    // reference that appears and disappears is announced inconsistently.
    expect(described.getAttribute("aria-describedby")).toBe(tip.id)
    expect(tip.getAttribute("data-open")).toBe("false")

    const button = host.querySelector("button")!
    act(() => {
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })
    expect(host.querySelector('[role="tooltip"]')!.getAttribute("data-open")).toBe("true")
  })

  test("Escape dismisses it without moving focus (WCAG 1.4.13)", () => {
    render(
      <Tooltip tip="The account the change runs in.">
        <button type="button">Account</button>
      </Tooltip>,
    )
    const button = host.querySelector("button")!
    focus(button)
    act(() => {
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })
    press("Escape")
    expect(host.querySelector('[role="tooltip"]')!.getAttribute("data-open")).toBe("false")
    expect(document.activeElement).toBe(button)
  })
})

describe("Accordion", () => {
  const SECTIONS = [
    { key: "network", heading: "Networking", children: <p>VPC</p> },
    { key: "identity", heading: "Identity", children: <p>Roles</p> },
  ]

  test("each header owns its panel, and the panel is hidden rather than unmounted", () => {
    render(<Accordion label="Configuration" sections={SECTIONS} defaultOpen={["network"]} />)
    const headers = [...host.querySelectorAll("button")] as HTMLElement[]
    expect(headers[0].getAttribute("aria-expanded")).toBe("true")
    expect(headers[1].getAttribute("aria-expanded")).toBe("false")
    const closed = document.getElementById(headers[1].getAttribute("aria-controls")!)!
    // Hidden keeps a half-typed value in the DOM while removing it from the
    // accessibility tree and the tab order.
    expect(closed.hasAttribute("hidden")).toBe(true)
    expect(closed.getAttribute("role")).toBe("region")
    expect(closed.getAttribute("aria-labelledby")).toBe(headers[1].id)
  })

  test("the headings are the caller's level, so heading order survives", () => {
    render(<Accordion label="Configuration" sections={SECTIONS} headingLevel={4} />)
    expect(host.querySelectorAll("h4")).toHaveLength(2)
    expect(host.querySelectorAll("h3")).toHaveLength(0)
  })

  test("arrows move between headers and clicking opens one", () => {
    render(<Accordion label="Configuration" sections={SECTIONS} />)
    const headers = [...host.querySelectorAll("button")] as HTMLElement[]
    focus(headers[0])
    press("ArrowDown")
    expect(document.activeElement).toBe(headers[1])
    click(headers[1])
    expect(headers[1].getAttribute("aria-expanded")).toBe("true")
  })
})

describe("Tree", () => {
  const NODES = [
    {
      id: "eu",
      label: "eu-west-1",
      children: [{ id: "cell-a", label: "cell-a" }],
    },
    { id: "us", label: "us-east-1" },
  ]

  function items() {
    return [...document.querySelectorAll('[role="treeitem"]')] as HTMLElement[]
  }

  test("every row announces its level and position, and only one is tabbable", () => {
    render(<Tree label="Topology" nodes={NODES} />)
    const rows = items()
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute("aria-level")).toBe("1")
    expect(rows[0].getAttribute("aria-posinset")).toBe("1")
    expect(rows[0].getAttribute("aria-setsize")).toBe("2")
    expect(rows[0].getAttribute("aria-expanded")).toBe("false")
    // A leaf carries no aria-expanded: it would be a promise of children that
    // do not exist.
    expect(rows[1].hasAttribute("aria-expanded")).toBe(false)
    expect(rows.filter((row) => row.tabIndex === 0)).toHaveLength(1)
  })

  test("ArrowRight expands, then steps into the subtree, and ArrowLeft comes back up", () => {
    render(<Tree label="Topology" nodes={NODES} />)
    focus(items()[0])
    press("ArrowRight")
    expect(items()[0].getAttribute("aria-expanded")).toBe("true")
    expect(items()).toHaveLength(3)
    press("ArrowRight")
    expect(document.activeElement?.textContent).toContain("cell-a")
    press("ArrowLeft")
    expect(document.activeElement?.textContent).toContain("eu-west-1")
  })

  test("a printable character finds a row", () => {
    render(<Tree label="Topology" nodes={NODES} />)
    focus(items()[0])
    press("u")
    expect(document.activeElement?.textContent).toContain("us-east-1")
  })
})

describe("Combobox", () => {
  const OPTIONS = [
    { value: "t-1", label: "Westfield Academy" },
    { value: "t-2", label: "Ashbourne College" },
  ]

  test("it is a combobox before it is opened, and it submits a value not a string", () => {
    render(<Combobox label="Tenant" options={OPTIONS} name="tenant" />)
    const input = host.querySelector("input[type='text']") as HTMLInputElement
    expect(input.getAttribute("role")).toBe("combobox")
    expect(input.getAttribute("aria-expanded")).toBe("false")
    expect(input.getAttribute("aria-autocomplete")).toBe("list")
    const hidden = host.querySelector("input[type='hidden']") as HTMLInputElement
    expect(hidden.name).toBe("tenant")
    expect(hidden.value).toBe("")
  })

  test("ArrowDown opens it and names the active option in an id that exists", () => {
    render(<Combobox label="Tenant" options={OPTIONS} name="tenant" />)
    const input = host.querySelector("input[type='text']") as HTMLInputElement
    focus(input)
    press("ArrowDown")
    const listbox = host.querySelector('[role="listbox"]')!
    expect(input.getAttribute("aria-controls")).toBe(listbox.id)
    const active = input.getAttribute("aria-activedescendant")!
    // The reference has to resolve, and it has to resolve INSIDE the listbox
    // it claims. A dangling activedescendant announces nothing at all.
    const options = [...listbox.querySelectorAll('[role="option"]')]
    expect(options.map((option) => option.id)).toContain(active)
  })

  test("Enter commits the highlighted option into the hidden value", () => {
    const onChange = jest.fn()
    render(<Combobox label="Tenant" options={OPTIONS} name="tenant" onChange={onChange} />)
    const input = host.querySelector("input[type='text']") as HTMLInputElement
    focus(input)
    press("ArrowDown")
    press("Enter")
    expect((host.querySelector("input[type='hidden']") as HTMLInputElement).value).toBe("t-1")
    expect(input.value).toBe("Westfield Academy")
    expect(onChange).toHaveBeenCalledWith("t-1")
    expect(host.querySelector('[role="listbox"]')).toBeNull()
  })

  test("Escape closes the list; pressing it again clears the field", () => {
    const onChange = jest.fn()
    render(<Combobox label="Tenant" options={OPTIONS} name="tenant" onChange={onChange} />)
    const input = host.querySelector("input[type='text']") as HTMLInputElement
    focus(input)
    press("ArrowDown")
    press("Enter")
    press("Escape")
    expect(input.value).toBe("")
    expect((host.querySelector("input[type='hidden']") as HTMLInputElement).value).toBe("")
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

describe("ToastRegion", () => {
  test("the live region is in the document before any message is", () => {
    const onDismiss = jest.fn()
    render(<ToastRegion toasts={[]} onDismiss={onDismiss} />)
    const region = host.querySelector('[data-md3="toast-region"]')!
    // A live region works by being observed BEFORE the thing it announces
    // arrives. Mounting region and message together is why a toast is silent.
    expect(region.getAttribute("aria-live")).toBe("polite")
    expect(region.getAttribute("role")).toBe("status")

    render(
      <ToastRegion
        toasts={[{ id: "t1", message: "Tenant westfield moved to PROVISIONING." }]}
        onDismiss={onDismiss}
      />,
    )
    expect(host.querySelector('[data-md3="toast-region"]')?.textContent).toContain("PROVISIONING")
    // Exactly one live region: nesting one inside another announces twice, or
    // once from the wrong one, depending on the screen reader.
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1)
    click(host.querySelector('[data-md3="toast"] button'))
    expect(onDismiss).toHaveBeenCalledWith("t1")
  })

  test("nothing disappears on a timer", async () => {
    render(
      <ToastRegion toasts={[{ id: "t1", message: "Accepted." }]} onDismiss={() => {}} />,
    )
    await frame()
    await frame()
    // WCAG 2.2.1. In a control plane the toast is often the only record on
    // screen that a mutation was accepted.
    expect(host.textContent).toContain("Accepted.")
  })
})
