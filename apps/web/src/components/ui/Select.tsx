"use client"

import {
  Select as AriaSelect,
  SelectValue,
  Button,
  Popover,
  ListBox,
  ListBoxItem,
  Label,
  type Key,
} from "react-aria-components"
import { ChevronDown, CheckCircle } from "@/components/ui/icons"

export interface SelectOption {
  value: string
  label: string
}

/**
 * A premium, accessible select built on React Aria. Full keyboard support, a
 * styled popover list with a selected-item check, and a hidden input (`name`)
 * so it drops straight into server-action forms in place of a raw <select> —
 * the same API, a far better feel.
 */
export function Select({
  label,
  name,
  options,
  defaultSelectedKey,
  selectedKey,
  onSelectionChange,
  placeholder = "Select…",
  className,
}: {
  label?: string
  name?: string
  options: SelectOption[]
  defaultSelectedKey?: string
  selectedKey?: string | null
  onSelectionChange?: (key: Key | null) => void
  placeholder?: string
  className?: string
}) {
  return (
    <AriaSelect
      name={name}
      defaultSelectedKey={defaultSelectedKey}
      selectedKey={selectedKey ?? undefined}
      onSelectionChange={onSelectionChange}
      placeholder={placeholder}
      className={`flex flex-col gap-1.5 ${className ?? ""}`}
    >
      {label && <Label className="text-[13px] font-semibold text-text-2">{label}</Label>}
      <Button className="flex h-10 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3.5 text-[15px] text-text-1 outline-none transition-colors data-[hovered]:border-[--border-strong] data-[focus-visible]:border-[--border-focus] data-[focus-visible]:[box-shadow:var(--shadow-focus)]">
        <SelectValue className="truncate data-[placeholder]:text-text-3" />
        <ChevronDown size={16} className="shrink-0 text-text-3" />
      </Button>
      <Popover className="pop-panel w-[--trigger-width] overflow-auto rounded-lg border border-border bg-surface p-1 shadow-lg outline-none">
        <ListBox className="outline-none">
          {options.map((o) => (
            <ListBoxItem
              key={o.value}
              id={o.value}
              textValue={o.label}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-text-1 outline-none data-[focused]:bg-base data-[selected]:font-medium"
            >
              {({ isSelected }) => (
                <>
                  <span className="truncate">{o.label}</span>
                  {isSelected && <CheckCircle size={16} className="shrink-0 text-[--primary]" />}
                </>
              )}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  )
}
