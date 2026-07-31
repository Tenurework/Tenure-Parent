"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft } from "@/components/ui/icons"

export function BackButton({ label = "Back" }: { label?: string }) {
  const router = useRouter()
  return (
    <button
      onClick={() => router.back()}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-text-2 hover:text-text-1 mb-3"
      aria-label="Go back"
    >
      <ArrowLeft size={13} /> {label}
    </button>
  )
}
