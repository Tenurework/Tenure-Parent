"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { FileText, RotateCw } from "@/components/ui/icons"

/**
 * Closer error boundary for the documents segment — the riskiest read path
 * (unguarded S3 reads plus mammoth/XLSX parsing of user-uploaded files). A
 * corrupt or renamed file, a missing S3 object, or a credentials blip lands
 * here instead of unmounting the whole shell. The honest steer is to download
 * the file rather than preview it.
 */
export default function DocumentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[documents-error]", error.digest, error)
  }, [error])

  const params = useParams<{ slug?: string | string[] }>()
  const slug = Array.isArray(params?.slug) ? params.slug[0] : params?.slug

  return (
    <div className="max-w-xl py-12">
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm">
        <span className="grid h-11 w-11 place-items-center rounded-full border border-border text-text-3">
          <FileText size={22} />
        </span>

        <h1 className="mt-5 text-lead font-semibold text-text-1">
          This document couldn&rsquo;t be opened
        </h1>
        <p className="mt-2 text-sm text-text-2">
          The preview didn&rsquo;t load — try downloading it instead. Your data is safe; nothing
          was changed.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-md bg-[--primary] px-4 py-2 text-sm font-medium text-[--primary-text] hover:bg-[--primary-hover]"
          >
            <RotateCw size={15} />
            Try again
          </button>
          <Link
            href={slug ? `/orgs/${slug}/documents` : "/dashboard"}
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium text-text-1 no-underline hover:bg-base"
          >
            {slug ? "Back to documents" : "Back to dashboard"}
          </Link>
        </div>

        {error.digest && (
          <p className="mt-6 font-mono text-xs text-text-3">Reference: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
