"use client"

import { useEffect, useState } from "react"

import { OfflineState } from "@/components/states"

/**
 * GE-022-006 — the connection state, shown where it changes what a click does.
 *
 * An operator who submits a lifecycle transition with no connection sees the
 * form clear and nothing happen, which is indistinguishable from a refusal. The
 * banner is the difference between "the platform said no" and "the platform
 * never heard you".
 *
 * `navigator.onLine` is read on mount rather than during render: it is false in
 * every server render, so rendering from it directly would flash the banner on
 * every page load for everyone.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  if (!offline) return null
  return <OfflineState what="The Tenure platform" />
}
