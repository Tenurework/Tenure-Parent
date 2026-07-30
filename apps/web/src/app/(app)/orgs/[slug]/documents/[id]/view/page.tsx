import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canViewOrg, getUserContext } from "@/lib/rbac"
import { buildDocContent } from "@/app/api/documents/_lib/content"
import { DocContentView } from "@/components/documents/DocContentView"
import { Card } from "@/components/ui/Card"
import { BackButton } from "@/components/BackButton"

export const dynamic = "force-dynamic"

/**
 * Standalone full-page document viewer (deep links + "Open full page"). Renders
 * the SAME content the overlay does by sharing `buildDocContent` — the single
 * server-side parser for pdf / docx / xlsx / pptx / text — so every format looks
 * identical here and in the modal. ACL + audit mirror the content route exactly.
 */
export default async function DocumentViewPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  const doc = await db.document.findUnique({
    where: { id },
    include: { organization: true },
  })
  if (!doc || doc.organization.slug !== slug || doc.isArchived) notFound()

  const ctx = await getUserContext(session.user.id)
  if (!canViewOrg(ctx, doc.organization)) notFound()

  await db.auditEvent.create({
    data: {
      institutionId: doc.institutionId,
      organizationId: doc.organizationId,
      actorId: session.user.id,
      action: "Document.Viewed",
      resourceType: "Document",
      resourceId: doc.id,
      outcome: "ALLOW",
    },
  })

  const content = await buildDocContent({
    objectKey: doc.objectKey,
    mime: doc.mimeType,
    sizeBytes: doc.sizeBytes,
  })

  return (
    <div className="max-w-screen-xl">
      <BackButton label="Back to documents" />
      <div className="mb-4">
        <h1 className="text-text-1">{doc.title}</h1>
        <p className="text-sm text-text-2 mt-0.5">
          {doc.organization.name} · {doc.mimeType}
        </p>
      </div>
      <Card>
        <DocContentView content={content} title={doc.title} />
      </Card>
    </div>
  )
}
