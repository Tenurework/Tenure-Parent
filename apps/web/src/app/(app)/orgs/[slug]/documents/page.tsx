import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canContribute, canManageRoster, canViewOrg, getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { storageConfigured } from "@/lib/s3"
import { aiConfigured } from "@/lib/ai"
import { Card, CardHeader } from "@/components/ui/Card"
import { OrgTabs } from "@/components/OrgTabs"
import { DocumentRow } from "@/components/documents/DocumentRow"
import { ArchiveRestore } from "@/components/ui/icons"
import {
  deleteDocumentAction,
  downloadDocumentAction,
  restoreDocumentAction,
  uploadDocumentAction,
} from "./actions"

export const dynamic = "force-dynamic"

function formatBytes(n?: number | null) {
  if (!n) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  return withTenantScope(session.user.id, async () => {
    const org = await db.organization.findUnique({ where: { slug } })
    if (!org) notFound()

    const ctx = await getUserContext(session.user.id)
    if (!canViewOrg(ctx, org)) notFound()
    const canUpload = canContribute(ctx, org) && storageConfigured()

    const [docs, archivedDocs] = await Promise.all([
      db.document.findMany({
        where: { organizationId: org.id, isArchived: false },
        orderBy: { createdAt: "desc" },
      }),
      db.document.findMany({
        where: { organizationId: org.id, isArchived: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
    ])

    const uploaderIds = [
      ...new Set([...docs, ...archivedDocs].map((d) => d.createdById).filter((x): x is string => !!x)),
    ]
    const uploaders = new Map(
      (
        await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true } })
      ).map((u) => [u.id, u.name ?? "Unknown"])
    )

    const uploadWithSlug = uploadDocumentAction.bind(null, slug)
    const downloadWithSlug = downloadDocumentAction.bind(null, slug)
    const deleteWithSlug = deleteDocumentAction.bind(null, slug)
    const restoreWithSlug = restoreDocumentAction.bind(null, slug)
    const canManage = canManageRoster(ctx, org)
    const userId = session.user.id
    const restorableArchived = archivedDocs.filter((d) => canManage || d.createdById === userId)

    return (
      <div className="w-full">
        <div className="mb-4">
          <h1 className="text-text-1">{org.name}</h1>
          <p className="text-sm text-text-2 mt-1">
            Club documents — contracts, templates, and records in one durable place.
          </p>
        </div>
        <OrgTabs slug={slug} />

        <div className="space-y-4">
          {canUpload && (
            <Card>
              <CardHeader title="Upload a document" subtitle="Up to 15 MB during the pilot." />
              <form action={uploadWithSlug} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-text-2">
                  File
                  <input
                    type="file"
                    name="file"
                    required
                    className="text-sm text-text-1 file:mr-3 file:h-9 file:rounded file:border file:border-border file:bg-surface file:px-3 file:text-sm file:text-text-1"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-2 flex-1 min-w-44">
                  Title (optional)
                  <input
                    name="title"
                    maxLength={200}
                    placeholder="Defaults to the file name"
                    className="h-9 w-full rounded border border-border px-3 text-sm text-text-1 bg-surface placeholder:text-text-3"
                  />
                </label>
                <button className="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90">
                  Upload
                </button>
              </form>
            </Card>
          )}

          {docs.length === 0 ? (
            <Card>
              <p className="text-sm text-text-2 py-4 text-center">
                No documents yet.{canUpload ? " Upload the first one above." : ""}
              </p>
            </Card>
          ) : (
            <Card padding="none">
              <ul className="divide-y divide-border">
                {docs.map((d) => (
                  <DocumentRow
                    key={d.id}
                    slug={slug}
                    docId={d.id}
                    title={d.title}
                    sizeLabel={formatBytes(d.sizeBytes)}
                    uploaderName={
                      d.createdById ? uploaders.get(d.createdById) ?? "Unknown" : "Unknown"
                    }
                    dateLabel={d.createdAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    initialMeta={{
                      title: d.title,
                      mimeType: d.mimeType,
                      sizeBytes: d.sizeBytes,
                      orgName: org.name,
                      updatedAt: d.updatedAt.toISOString(),
                    }}
                    canDelete={canManage || d.createdById === userId}
                    showSummarize={aiConfigured()}
                    downloadAction={downloadWithSlug}
                    deleteAction={deleteWithSlug}
                  />
                ))}
              </ul>
            </Card>
          )}

          {restorableArchived.length > 0 && (
            <Card padding="none">
              <div className="border-b border-border p-5">
                <CardHeader
                  title="Archived documents"
                  subtitle="Soft-deleted — restore to bring one back to the club."
                />
              </div>
              <ul className="divide-y divide-border">
                {restorableArchived.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-text-2 line-through">{d.title}</p>
                      <p className="mt-0.5 text-xs text-text-3">
                        {d.createdById ? uploaders.get(d.createdById) ?? "Unknown" : "Unknown"} · archived{" "}
                        {d.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                    </div>
                    <form action={restoreWithSlug}>
                      <input type="hidden" name="documentId" value={d.id} />
                      <button className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-base hover:text-[--primary]">
                        <ArchiveRestore size={14} /> Restore
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    )
  })
}
