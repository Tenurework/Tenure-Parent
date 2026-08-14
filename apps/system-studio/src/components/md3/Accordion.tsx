"use client"

import { useCallback, useId, useRef, useState, type ReactNode } from "react"

import "./primitives.css"
import { Surface } from "./Surface"
import { listCommand, type ListState } from "./interaction"

/**
 * Sections that open and close in place: a long configuration form broken into
 * named parts, a resource's twelve property groups, a nav sub-level.
 *
 * ## Buttons and regions, not `<details>`
 *
 * `<details>`/`<summary>` needs no JavaScript, which is a real advantage, and
 * it is not used here for two reasons. The first is in this console's own
 * stylesheet: a collapsed `<details>` still reports a bounding rectangle in
 * Chrome, which `layout.spec.ts` has already been bitten by. The second is that
 * a `<summary>` cannot be given the keyboard model below — arrow keys between
 * headers — without fighting the element's built-in behaviour.
 *
 * So a header is a `<button aria-expanded aria-controls>` inside a heading of
 * the caller's level, and a panel is a `role="region"` named by its header.
 * That is the APG pattern exactly, and it is what makes a screen reader
 * announce "Networking, collapsed, button" rather than "Networking".
 *
 * ## The heading level is a prop because it is a document decision
 *
 * An accordion inside a page whose sections are `<h2>` needs `<h3>` headers,
 * and one used as a nav sub-level may need `<h2>`. Hard-coding it produces the
 * heading-order failure that a screen-reader user navigating by heading feels
 * immediately and that no screenshot shows.
 *
 * ## Collapsed content is `hidden`
 *
 * Not unmounted. A half-typed value inside a section that has been collapsed
 * and reopened must still be there, and `hidden` keeps the DOM while removing
 * the content from the accessibility tree and the tab order.
 *
 * ## One open at a time is not the default
 *
 * `multiple` defaults to true. A console reader comparing two sections should
 * not have the first close when the second opens — the accordion that closes
 * what you were reading is the one people stop using.
 */

export interface AccordionSection {
  key: string
  heading: string
  children: ReactNode
  /** A short status beside the heading — "3 findings", "not configured". */
  hint?: ReactNode
  disabled?: boolean
}

export interface AccordionProps {
  sections: readonly AccordionSection[]
  /** The heading element the buttons sit inside. */
  headingLevel?: 2 | 3 | 4 | 5
  /** May several be open at once. True, deliberately. */
  multiple?: boolean
  /** Keys open on first render. */
  defaultOpen?: readonly string[]
  id?: string
  /** Names the group for a screen reader — "Configuration sections". */
  label: string
}

export function Accordion({
  sections,
  headingLevel = 3,
  multiple = true,
  defaultOpen = [],
  id,
  label,
}: AccordionProps) {
  const generatedId = useId()
  const baseId = id ?? generatedId
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(defaultOpen))
  const [active, setActive] = useState(0)
  const headerRefs = useRef<(HTMLButtonElement | null)[]>([])
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4" | "h5"

  const state: ListState = {
    index: active,
    count: sections.length,
    disabled: sections.flatMap((section, index) => (section.disabled ? [index] : [])),
    loop: true,
  }

  const toggle = useCallback(
    (key: string) => {
      setOpen((current) => {
        const next = new Set(multiple ? current : [])
        if (current.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [multiple],
  )

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const command = listCommand(event.key, { ...state, index })
    // Only movement is claimed. Enter and Space are the button's own job, and
    // Escape belongs to whatever overlay this accordion is inside.
    if (command.type !== "move" || command.index < 0) return
    event.preventDefault()
    setActive(command.index)
    headerRefs.current[command.index]?.focus()
  }

  return (
    <div data-md3="accordion" role="group" aria-label={label}>
      {sections.map((section, index) => {
        const headerId = `${baseId}-${section.key}-header`
        const panelId = `${baseId}-${section.key}-panel`
        const isOpen = open.has(section.key)
        return (
          <Surface
            key={section.key}
            container="low"
            level={0}
            shape="small"
            outlined
            data-md3="accordion-item"
          >
            <Heading data-md3="accordion-heading" className="md3-title-small">
              <button
                ref={(node) => {
                  headerRefs.current[index] = node
                }}
                id={headerId}
                type="button"
                className="md3-state"
                data-md3="accordion-trigger"
                aria-expanded={isOpen}
                aria-controls={panelId}
                aria-disabled={section.disabled ? true : undefined}
                onFocus={() => setActive(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
                onClick={() => {
                  if (!section.disabled) toggle(section.key)
                }}
              >
                {/*
                  The marker is a word-free shape, so it carries no meaning on
                  its own; `aria-expanded` is what says open or closed, and it
                  says it to everyone rather than to whoever can see a rotation.
                */}
                <span data-md3="accordion-marker" aria-hidden="true" />
                <span data-md3="accordion-label">{section.heading}</span>
                {section.hint ? (
                  <span data-md3="accordion-hint" className="md3-label-small">
                    {section.hint}
                  </span>
                ) : null}
              </button>
            </Heading>
            <div
              id={panelId}
              role="region"
              aria-labelledby={headerId}
              data-md3="accordion-panel"
              hidden={!isOpen}
            >
              {section.children}
            </div>
          </Surface>
        )
      })}
    </div>
  )
}
