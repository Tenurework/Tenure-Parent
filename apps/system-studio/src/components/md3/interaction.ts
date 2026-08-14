/**
 * The keyboard models the interactive primitives share, as pure functions.
 *
 * ## Why the model is not inside the components
 *
 * "Accessible" is where these primitives are normally wrong, and it is wrong in
 * a place a screenshot cannot reach: what happens when End is pressed on a menu
 * whose last two items are disabled, whether ArrowLeft on an expanded tree node
 * collapses it or walks to its parent, whether Home is swallowed or handled.
 * Every one of those is a decision with a right answer in WAI-ARIA APG, and
 * every one of them is a branch.
 *
 * A branch inside a `useState` closure inside a client component can only be
 * proven by rendering the component, dispatching a key and reading the DOM —
 * which is worth doing and `Primitives.test.tsx` does it, but it is slow, it
 * needs jsdom, and it cannot practically enumerate the twenty-odd cases each
 * widget has. So the DECISION lives here, as a function from (key, state) to a
 * command, and the component is the adapter that applies the command. The
 * enumeration then runs in `e2e/md3-primitives-logic.spec.ts` at node speed
 * with no DOM at all, and the component test proves the adapter is wired to it.
 *
 * ## Direction is a parameter, not an assumption
 *
 * STUDIO-030-007 names RTL readiness. In a right-to-left document ArrowRight
 * means *previous* on a horizontal list and *collapse* on a tree, because those
 * keys are physical and the reading order is not. Every function that consults
 * a left/right key takes `dir` and resolves it once, here, rather than in six
 * components that would each get it right at different times.
 *
 * ## Nothing here touches the DOM
 *
 * No `document`, no `window`, no element references — indices and ids only.
 * That is what lets the spec import this module in a Playwright worker (which
 * has no DOM) and what stops a keyboard rule from quietly depending on layout.
 */

export type Orientation = "vertical" | "horizontal"
export type Direction = "ltr" | "rtl"

/** Keys that mean "do the thing". Space is included; it is not a synonym for scroll inside a widget. */
export const ACTIVATION_KEYS = ["Enter", " "] as const
/** The one key that means "give up and put me back". */
export const DISMISS_KEY = "Escape"

export function isActivation(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar"
}

export function isDismiss(key: string): boolean {
  return key === DISMISS_KEY || key === "Esc"
}

/**
 * A single printable character, which is what starts a typeahead.
 *
 * `key.length === 1` alone would treat a space as typeahead and steal
 * activation, so space is excluded by name.
 */
export function isTypeaheadKey(key: string): boolean {
  return key.length === 1 && key !== " " && !/\s/.test(key)
}

export interface ListState {
  /** The active option. `-1` means nothing is active yet, which is a real state on an unopened menu. */
  index: number
  count: number
  /** Indices that may not become active. Disabled options stay rendered and stay announced; they just cannot be landed on. */
  disabled?: readonly number[]
  orientation?: Orientation
  /** Whether moving off the end wraps. Menus wrap; a stepper does not. */
  loop?: boolean
  dir?: Direction
}

export type ListCommand =
  | { type: "move"; index: number }
  | { type: "activate" }
  | { type: "dismiss" }
  | { type: "none" }

function enabledIndices(state: ListState): number[] {
  const disabled = new Set(state.disabled ?? [])
  const out: number[] = []
  for (let i = 0; i < state.count; i += 1) if (!disabled.has(i)) out.push(i)
  return out
}

/** The first index that can hold focus, or `-1` when every option is disabled. */
export function firstEnabled(state: ListState): number {
  const enabled = enabledIndices(state)
  return enabled.length ? enabled[0] : -1
}

/** The last index that can hold focus, or `-1`. */
export function lastEnabled(state: ListState): number {
  const enabled = enabledIndices(state)
  return enabled.length ? enabled[enabled.length - 1] : -1
}

/**
 * Step `delta` positions through the enabled options.
 *
 * Walking the ENABLED list rather than the raw one is what makes "the next
 * item" mean the next item an operator can actually choose. A loop that skipped
 * disabled entries by re-entering itself would spin forever on an all-disabled
 * list; this one cannot, because the list it walks contains only landable
 * indices.
 */
export function step(state: ListState, delta: number): number {
  const enabled = enabledIndices(state)
  if (enabled.length === 0) return -1
  const here = enabled.indexOf(state.index)
  if (here === -1) {
    // Nothing active yet: forward starts at the first option, backward at the last.
    return delta > 0 ? enabled[0] : enabled[enabled.length - 1]
  }
  const next = here + delta
  if (next < 0) return state.loop === false ? enabled[0] : enabled[enabled.length - 1]
  if (next >= enabled.length) return state.loop === false ? enabled[enabled.length - 1] : enabled[0]
  return enabled[next]
}

/**
 * The list keyboard model: what a key means to a menu, a listbox or a set of
 * accordion headers.
 *
 * Returns `{ type: "none" }` for anything it does not claim, and the caller
 * must NOT call `preventDefault` in that case — swallowing Tab, PageDown or a
 * browser shortcut because a widget had focus is the other half of the same
 * accessibility failure.
 */
export function listCommand(key: string, state: ListState): ListCommand {
  const horizontal = state.orientation === "horizontal"
  const rtl = state.dir === "rtl"
  const forward = horizontal ? (rtl ? "ArrowLeft" : "ArrowRight") : "ArrowDown"
  const backward = horizontal ? (rtl ? "ArrowRight" : "ArrowLeft") : "ArrowUp"

  if (key === forward) return { type: "move", index: step(state, 1) }
  if (key === backward) return { type: "move", index: step(state, -1) }
  if (key === "Home") return { type: "move", index: firstEnabled(state) }
  if (key === "End") return { type: "move", index: lastEnabled(state) }
  if (isDismiss(key)) return { type: "dismiss" }
  if (isActivation(key)) return { type: "activate" }
  return { type: "none" }
}

/**
 * Type-to-find, with the repeated-character behaviour APG describes.
 *
 * Two behaviours, and the difference matters on a region list where nine
 * entries begin with "u": typing "us" jumps to the first label starting "us",
 * while pressing "u" four times cycles through the four labels starting "u".
 * A component that only implements the first makes the second impossible, and
 * the second is how people actually use a long menu.
 *
 * Returns `-1` when nothing matches, which must leave the active option alone
 * rather than clearing it.
 */
export function typeaheadIndex(
  labels: readonly string[],
  buffer: string,
  from: number,
  disabled: readonly number[] = [],
): number {
  if (!buffer) return -1
  const skip = new Set(disabled)
  const chars = [...buffer.toLowerCase()]
  const repeated = chars.length > 1 && chars.every((c) => c === chars[0])
  const needle = repeated ? chars[0] : buffer.toLowerCase()
  // A repeated character cycles, so the search starts AFTER the current option.
  // A growing buffer refines, so it starts AT it — otherwise typing "u" then
  // "us" walks past the item the "u" just found.
  const start = repeated || buffer.length === 1 ? from + 1 : from
  const count = labels.length
  for (let offset = 0; offset < count; offset += 1) {
    const index = ((start + offset) % count + count) % count
    if (skip.has(index)) continue
    if (labels[index].toLowerCase().startsWith(needle)) return index
  }
  return -1
}

/**
 * How long a typeahead buffer survives before the next keystroke starts a new
 * search. One second is APG's stated convention.
 */
export const TYPEAHEAD_RESET_MS = 1000

export function typeaheadBuffer(previous: string, key: string, sinceMs: number): string {
  return sinceMs > TYPEAHEAD_RESET_MS ? key : previous + key
}

/* ── Focus containment ────────────────────────────────────────────────────── */

/**
 * Where Tab goes inside something that traps focus.
 *
 * Expressed over a COUNT and an INDEX rather than over elements, so the rule is
 * testable without a DOM and identical in the dialog, the drawer and the
 * command surface. `current === -1` means focus is somewhere the trap does not
 * own — which happens when an element is removed while focused — and the answer
 * is the first stop, not a crash.
 *
 * Returns `-1` when there is nothing focusable at all. A trap with no stops must
 * focus its own container rather than letting Tab escape to the page behind it.
 */
export function nextTrapStop(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1
  if (current < 0) return shift ? count - 1 : 0
  const next = shift ? current - 1 : current + 1
  if (next < 0) return count - 1
  if (next >= count) return 0
  return next
}

/**
 * The selector every focus trap uses to find its stops.
 *
 * `[tabindex]:not([tabindex="-1"])` is included because a roving-tabindex
 * widget inside a dialog exposes exactly one stop, and excluding programmatic
 * `-1` is what keeps the trap from stopping on the eleven options of a tree.
 * `:not([disabled])` and `:not([inert])` because neither can take focus, and a
 * trap that counts them lands on nothing and looks broken.
 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

/* ── Trees ───────────────────────────────────────────────────────────────── */

export interface TreeNode {
  id: string
  label: string
  children?: readonly TreeNode[]
  disabled?: boolean
  /** Anything the caller wants back when the node is activated. */
  href?: string
}

export interface TreeRow {
  id: string
  label: string
  href?: string
  /** 1-based, as `aria-level` is. */
  level: number
  posinset: number
  setsize: number
  hasChildren: boolean
  expanded: boolean
  disabled: boolean
  parentId: string | null
}

/**
 * The visible rows of a tree, flattened, with the ARIA relationship attributes
 * already computed.
 *
 * `aria-level`, `aria-setsize` and `aria-posinset` are what make a tree
 * navigable without sight — they are the "3 of 7, level 2" a screen reader
 * announces — and they are also the three attributes most often omitted,
 * because nothing on screen changes when they are missing. Computing them here
 * means the component cannot forget one.
 *
 * A collapsed node's children are ABSENT, not hidden: `aria-expanded="false"`
 * already tells assistive technology there is more, and a hidden subtree is a
 * subtree some renderer eventually announces anyway.
 */
export function treeRows(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (list: readonly TreeNode[], level: number, parentId: string | null) => {
    list.forEach((node, position) => {
      const hasChildren = !!node.children && node.children.length > 0
      const isOpen = hasChildren && expanded.has(node.id)
      rows.push({
        id: node.id,
        label: node.label,
        href: node.href,
        level,
        posinset: position + 1,
        setsize: list.length,
        hasChildren,
        expanded: isOpen,
        disabled: !!node.disabled,
        parentId,
      })
      if (isOpen && node.children) walk(node.children, level + 1, node.id)
    })
  }
  walk(nodes, 1, null)
  return rows
}

export type TreeCommand =
  | { type: "move"; index: number }
  | { type: "expand"; id: string }
  | { type: "collapse"; id: string }
  | { type: "activate"; id: string }
  | { type: "expandSiblings"; ids: readonly string[] }
  | { type: "none" }

/**
 * APG's tree keyboard model, including the two rules people leave out.
 *
 * The two: ArrowRight on an ALREADY expanded node moves to its first child
 * rather than doing nothing, and ArrowLeft on a collapsed node moves to its
 * PARENT rather than doing nothing. Without them a keyboard user can descend
 * into a subtree and has no way back up except Home, which in a fleet tree of
 * two hundred accounts means losing their place entirely.
 *
 * `*` expands every sibling of the focused node — the "show me this whole
 * level" key, which is in APG and almost never implemented.
 */
export function treeCommand(
  key: string,
  rows: readonly TreeRow[],
  index: number,
  dir: Direction = "ltr",
): TreeCommand {
  if (rows.length === 0) return { type: "none" }
  const row = rows[index]
  const state: ListState = {
    index,
    count: rows.length,
    disabled: rows.flatMap((r, i) => (r.disabled ? [i] : [])),
    loop: false,
  }
  const into = dir === "rtl" ? "ArrowLeft" : "ArrowRight"
  const outOf = dir === "rtl" ? "ArrowRight" : "ArrowLeft"

  if (key === "ArrowDown") return { type: "move", index: step(state, 1) }
  if (key === "ArrowUp") return { type: "move", index: step(state, -1) }
  if (key === "Home") return { type: "move", index: firstEnabled(state) }
  if (key === "End") return { type: "move", index: lastEnabled(state) }
  if (!row) return { type: "none" }
  if (key === into) {
    if (row.hasChildren && !row.expanded) return { type: "expand", id: row.id }
    if (row.hasChildren && row.expanded) {
      const child = rows.findIndex((r) => r.parentId === row.id)
      return child === -1 ? { type: "none" } : { type: "move", index: child }
    }
    return { type: "none" }
  }
  if (key === outOf) {
    if (row.hasChildren && row.expanded) return { type: "collapse", id: row.id }
    if (row.parentId) {
      const parent = rows.findIndex((r) => r.id === row.parentId)
      return parent === -1 ? { type: "none" } : { type: "move", index: parent }
    }
    return { type: "none" }
  }
  if (key === "*") {
    const ids = rows.filter((r) => r.parentId === row.parentId && r.hasChildren).map((r) => r.id)
    return ids.length ? { type: "expandSiblings", ids } : { type: "none" }
  }
  if (isActivation(key)) return { type: "activate", id: row.id }
  return { type: "none" }
}

/* ── Filtering ───────────────────────────────────────────────────────────── */

export interface FilterableOption {
  value: string
  label: string
  /** Extra words that should match — an ARN, an account number, an alias. */
  keywords?: readonly string[]
  disabled?: boolean
}

/**
 * The combobox filter: prefix matches first, then the rest of the substring
 * matches, each group keeping its original order.
 *
 * Ranking prefixes above substrings is what makes typing "us-e" put
 * `us-east-1` above `cluster-us-east-1`, and keeping the original order inside
 * each group is what stops the list reshuffling under a finger already moving
 * toward an option.
 *
 * Matching against `keywords` as well as the label is what lets an operator who
 * knows the account number find the tenant whose label is a name.
 */
export function filterOptions<T extends FilterableOption>(
  options: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...options]
  const prefix: T[] = []
  const contains: T[] = []
  for (const option of options) {
    const haystacks = [option.label, option.value, ...(option.keywords ?? [])].map((s) =>
      s.toLowerCase(),
    )
    if (haystacks.some((h) => h.startsWith(needle))) prefix.push(option)
    else if (haystacks.some((h) => h.includes(needle))) contains.push(option)
  }
  return [...prefix, ...contains]
}
