import { notFound, redirect } from "next/navigation"
import { AlertCircle, FileText, Mail } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { Card, CardHeader } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { BackButton } from "@/components/BackButton"
import { EmailLink } from "@/components/EmailLink"
import { policyBySlug } from "@/lib/policies"
import { SEAT_LABELS } from "@/lib/resources"

// Auth-gated and session-aware, so it is rendered per request rather than
// prerendered — generateStaticParams would contradict that.
export const dynamic = "force-dynamic"

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  const policy = policyBySlug(slug)
  if (!policy) notFound()

  return (
    <div className="w-full">
      <BackButton />

      <div className="mb-6 mt-2">
        <h1 className="text-text-1">{policy.title}</h1>
        <p className="prose-measure mt-2 text-sm text-text-2">{policy.summary}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {policy.seats.map((seat) => (
            <Badge key={seat} variant="info">
              {SEAT_LABELS[seat]}
            </Badge>
          ))}
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-xs text-text-3">
          <FileText size={12} className="mt-0.5 shrink-0" aria-hidden />
          Source: {policy.source}
        </p>

        {policy.sourceNote && (
          <p className="mt-2 flex max-w-prose items-start gap-1.5 rounded bg-[--warning-light] px-3 py-2 text-xs text-text-1">
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-[--warning]" aria-hidden />
            {policy.sourceNote}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {policy.sections.map((section) => (
          <Card key={section.heading}>
            <CardHeader title={section.heading} />

            {section.body && (
              <p className="text-sm text-text-2">{section.body}</p>
            )}

            {section.rules && section.rules.length > 0 && (
              <ul className="mt-3 space-y-2">
                {section.rules.map((rule) => (
                  <li
                    key={rule}
                    className="flex items-start gap-2 rounded bg-[--warning-light] px-3 py-2 text-xs text-text-1"
                  >
                    <AlertCircle
                      size={13}
                      className="mt-0.5 shrink-0 text-[--warning]"
                      aria-hidden
                    />
                    {rule}
                  </li>
                ))}
              </ul>
            )}

            {section.items && section.items.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {section.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-text-2">
                    <span
                      className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[--text-3]"
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      {policy.contacts && policy.contacts.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Who to contact" />
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {policy.contacts.map((c) => (
              <li key={c.name} className="rounded border border-border p-3">
                <p className="text-sm font-medium text-text-1">{c.name}</p>
                {c.role && <p className="text-xs text-text-3">{c.role}</p>}
                {c.email && (
                  <p className="mt-1 text-xs">
                    <EmailLink email={c.email} showIcon />
                  </p>
                )}
                {!c.email && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-text-3">
                    <Mail size={11} aria-hidden /> Reach out via your club advisor
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
