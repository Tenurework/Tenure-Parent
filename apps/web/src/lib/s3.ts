import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { cellContext } from "@/lib/cell-context"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

// Uses the ECS task role in production; local dev needs AWS_* env vars.
// Lazily, and through the cell context.
//
// `?? "us-east-1"` at module scope did two wrong things at once: it chose a
// region nobody asked for, and it chose it at import time, before any error
// boundary exists. An object written to the wrong region is a residency
// breach that does not error.
let client: S3Client | null = null
function s3Client(): S3Client {
  if (!client) client = new S3Client({ region: cellContext().region })
  return client
}

export const documentsBucket = process.env.S3_DOCUMENTS_BUCKET

/** True when document storage is configured (unset in CI e2e). */
export function storageConfigured(): boolean {
  return !!documentsBucket
}

/**
 * Fetch a stored object's raw bytes, reusing the shared S3 client (callers
 * should never construct their own). Access must be permission-checked first.
 */
export async function getDocumentBytes(key: string): Promise<Buffer> {
  if (!documentsBucket) throw new Error("Document storage is not configured")
  const obj = await s3Client().send(new GetObjectCommand({ Bucket: documentsBucket, Key: key }))
  return Buffer.from(await obj.Body!.transformToByteArray())
}

export async function uploadDocument(key: string, body: Buffer, contentType: string) {
  if (!documentsBucket) throw new Error("Document storage is not configured")
  await s3Client().send(
    new PutObjectCommand({
      Bucket: documentsBucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    })
  )
}

/** Short-lived download link — access is checked before generating it. */
export async function documentDownloadUrl(key: string, filename: string) {
  if (!documentsBucket) throw new Error("Document storage is not configured")
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({
      Bucket: documentsBucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
    }),
    { expiresIn: 600 }
  )
}

/** Short-lived inline link — opens in the browser instead of downloading. */
export async function documentViewUrl(key: string) {
  if (!documentsBucket) throw new Error("Document storage is not configured")
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({
      Bucket: documentsBucket,
      Key: key,
      ResponseContentDisposition: "inline",
    }),
    { expiresIn: 600 }
  )
}
