"use client"

import { useEffect, useState } from "react"
import { Monitor, Moon, Sun } from "@/components/ui/icons"

type Theme = "light" | "dark" | "system"

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("system")

  useEffect(() => {
    setTheme((localStorage.getItem("tenure-theme") as Theme) || "system")
    // Track OS changes while in system mode
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if ((localStorage.getItem("tenure-theme") || "system") === "system") apply("system")
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  function choose(next: Theme) {
    setTheme(next)
    localStorage.setItem("tenure-theme", next)
    apply(next)
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="flex gap-2">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => choose(o.value)}
          className={`flex-1 flex flex-col items-center gap-1.5 rounded-lg border px-4 py-3 text-sm transition-colors ${
            theme === o.value
              ? "border-[--primary] bg-[--primary-light] text-[--primary] font-medium"
              : "border-border text-text-2 hover:border-[--border-strong]"
          }`}
        >
          <o.icon size={18} />
          {o.label}
        </button>
      ))}
    </div>
  )
}
