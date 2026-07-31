"use client"

import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components"
import { cva, type VariantProps } from "class-variance-authority"

const button = cva(
  [
    "inline-flex items-center justify-center gap-2 font-medium transition-colors cursor-default",
    "outline-none rounded-md",
    "data-[focus-visible]:ring-2 data-[focus-visible]:ring-[--primary] data-[focus-visible]:ring-offset-2",
    "data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-[--primary] text-[--primary-text] shadow-xs",
          "data-[hovered]:bg-[--primary-hover]",
          "data-[pressed]:bg-[--primary-press]",
        ],
        accent: [
          "bg-[--accent] text-[--accent-text] shadow-xs",
          "data-[hovered]:bg-[--accent-hover]",
          "data-[pressed]:bg-[--accent-strong]",
        ],
        secondary: [
          "bg-surface text-[--text-1] border border-[--border-strong]",
          "data-[hovered]:bg-[--bg-base] data-[hovered]:border-[--text-3]",
          "data-[pressed]:bg-[--bg-subtle]",
        ],
        ghost: [
          "text-[--text-2]",
          "data-[hovered]:bg-[--bg-base] data-[hovered]:text-[--text-1]",
          "data-[pressed]:bg-[--bg-subtle]",
        ],
        destructive: [
          "bg-[--error] text-white shadow-xs",
          "data-[hovered]:opacity-90",
          "data-[pressed]:opacity-80",
        ],
        link: [
          "text-[--text-link] underline-offset-4 rounded-none",
          "data-[hovered]:underline",
        ],
      },
      size: {
        sm: "h-8 px-3.5 text-[13px]",
        md: "h-10 px-4 text-sm",
        lg: "h-11 px-6 text-[15px]",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

export interface ButtonProps
  extends AriaButtonProps,
    VariantProps<typeof button> {
  className?: string
}

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={button({ variant, size, className })}
    />
  )
}
