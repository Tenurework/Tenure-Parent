"use client"

import { ErrorState } from "@/components/states"

/**
 * GE-022-006. The route's error boundary.
 *
 * In production Next replaces a thrown server error with "Application error: a
 * server-side exception has occurred" and a digest — which tells an operator
 * nothing they can act on. This shows the message and offers the retry, because
 * a transient DynamoDB throttle and a missing IAM action look identical without
 * one.
 */
export default function TenantsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      what="tenants"
      detail={error.digest ? `${error.message}\n\ndigest: ${error.digest}` : error.message}
      actions={
        <button type="button" className="primary-action" onClick={reset}>
          Try again
        </button>
      }
    />
  )
}
