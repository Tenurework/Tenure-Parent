import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { Sparkles } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canViewOrg, getUserContext } from "@/lib/rbac"
import { aiConfigured, summarizeDocument } from "@/lib/ai"
import { documentsBucket } from "@/lib/s3"
import { Card, CardHeader } from "@/components/ui/Card"

export const dynamic = "force-dynamic"

const TEXTUAL = /^(text\/|application\/(json|csv|xml))/
const MAX_BYTES = 200 * 1024

export default async function DocumentSummaryPage({
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
  if (!doc || doc.organization.slug !== slug) notFound()

  const ctx = await getUserContext(session.user.id)
  if (!canViewOrg(ctx, doc.organization)) notFound()

  let summary: string | null = null
  let note: string | null = null

  if (!aiConfigured()) {
    note = "Tenure AI is not enabled."
  } else if (!TEXTUAL.test(doc.mimeType)) {
    note = `Summaries currently support text documents (this is ${doc.mimeType}). PDF and Office support arrives with the document pipeline.`
  } else if ((doc.sizeBytes ?? 0) > MAX_BYTES) {
    note = "This document is too large to summarize in the pilot (200 KB limit)."
  } else if (documentsBucket) {
    const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" })
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: documentsBucket, Key: doc.objectKey })
    )
    const content = await obj.Body!.transformToString()
    summary = await summarizeDocument(doc.title, content)
    if (!summary) note = "Summarization was unavailable — try again shortly."
    else {
      await db.auditEvent.create({
        data: {
          institutionId: doc.institutionId,
          organizationId: doc.organizationId,
          actorId: session.user.id,
          action: "Document.Summarized",
          resourceType: "Document",
          resourceId: doc.id,
          outcome: "ALLOW",
        },
      })
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-3 flex items-center gap-1.5">
          <Sparkles size={12} style={{ color: "var(--primary)" }} /> Tenure AI summary
        </p>
        <h1 className="text-text-1 mt-0.5">{doc.title}</h1>
        <Link
          href={`/orgs/${slug}/documents`}
          className="text-xs text-[--primary] hover:underline"
        >
          ← Back to documents
        </Link>
      </div>

      <Card>
        <CardHeader
          title={summary ? "Summary" : "Not available"}
          subtitle={summary ? "Generated from the document contents" : undefined}
        />
        <p className="text-sm text-text-1 whitespace-pre-wrap">{summary ?? note}</p>
      </Card>
    </div>
  )
}
