"use client"

import { RadioGroup, Radio } from "react-aria-components"

/**
 * Pill segmented control (Monthly | Quarterly | Yearly pattern). Built on
 * react-aria's RadioGroup so it is fully keyboard operable (arrow keys move
 * between segments) with correct radio semantics. Controlled via value/onChange.
 *
 *   <Segmented
 *     aria-label="Range"
 *     value={range}
 *     onChange={setRange}
 *     items={[{ key: "m", label: "Monthly" }, { key: "q", label: "Quarterly" }]}
 *   />
 */

export interface SegmentedItem {
  key: string
  label: string
}

export function Segmented({
  items,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  items: SegmentedItem[]
  value: string
  onChange: (value: string) => void
  className?: string
  "aria-label"?: string
}) {
  return (
    <RadioGroup
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      orientation="horizontal"
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-subtle p-1 ${className ?? ""}`}
    >
      {items.map((item) => (
        <Radio
          key={item.key}
          value={item.key}
          className="cursor-pointer select-none rounded-full px-3.5 py-1.5 text-[13px] font-medium text-text-2 outline-none transition-colors data-[hovered]:text-text-1 data-[selected]:bg-[--segment-active-bg] data-[selected]:text-text-1 data-[selected]:shadow-xs data-[focus-visible]:ring-2 data-[focus-visible]:ring-[--primary]"
        >
          {item.label}
        </Radio>
      ))}
    </RadioGroup>
  )
}
