import { createHash, randomUUID } from "node:crypto"
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { parseFileRef, type FileRef } from "@tenure/contracts"
import { cellContext } from "@/lib/cell-context"
import { requireService } from "@/lib/partition-services"
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
  if (!client) {
    // GE-010-007 — ask whether S3 exists where this process is running before
    // building a client that assumes it does. S3 is in all three partitions, so
    // the case this catches is the one that was silent: an `AWS_PARTITION` this
    // build does not recognise. `cellContext()` reports that in `unresolved`
    // and still hands the string back typed as a partition, so without this the
    // client is constructed for a partition nobody has made a decision about.
    requireService("s3")
    client = new S3Client({ region: cellContext().region })
  }
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
 *
 * Reads take a key, not a `FileRef`, and that is deliberate rather than an
 * oversight the writes half fixed. A read is given a key that came out of the
 * database — including rows written before `parseFileRef` governed the write
 * path, whose keys have no tenant prefix. Demanding a valid ref here would not
 * make those objects safe; it would make them unreadable, which is a data-loss
 * bug dressed as a security control. What the tenant prefix protects is the key
 * being *minted*, and that is where it is now enforced.
 */
export async function getDocumentBytes(key: string): Promise<Buffer> {
  if (!documentsBucket) throw new Error("Document storage is not configured")
  const obj = await s3Client().send(new GetObjectCommand({ Bucket: documentsBucket, Key: key }))
  return Buffer.from(await obj.Body!.transformToByteArray())
}

/**
 * PACK-010-001 — describe an object about to be stored, in the kernel's shape.
 *
 * `FileRef` is one of the fourteen contracts the platform declares as its
 * boundary, and until this existed nothing produced one: file handling had its
 * own shape (a bare `key: string`) and the kernel had another. Two shapes for
 * one concern is exactly the drift "one platform kernel" exists to prevent, and
 * the cost of it here was concrete — three of this application's five upload
 * paths wrote keys with no tenant prefix at all, which `parseFileRef` refuses
 * outright and nothing else was checking.
 *
 * The size and the checksum are computed from the bytes rather than accepted
 * from the caller. A ref that describes different bytes than the ones uploaded
 * is worse than no ref: it is a checksum somebody would later verify against
 * and believe.
 *
 * `fileId` defaults to a fresh identifier. Callers with a stable one — the
 * document row being overwritten in place, say — should pass it, so two
 * versions of one document are recognisably the same file.
 */
export function fileRef(input: {
  tenantId: string
  objectKey: string
  mimeType: string
  body: Buffer
  fileId?: string
}): FileRef {
  return parseFileRef({
    fileId: input.fileId ?? randomUUID(),
    tenantId: input.tenantId,
    objectKey: input.objectKey,
    mimeType: input.mimeType,
    sizeBytes: input.body.length,
    checksum: `sha256:${createHash("sha256").update(input.body).digest("hex")}`,
  })
}

/**
 * Store an object, described by a `FileRef`.
 *
 * Takes the ref rather than a key and a content type, which is the whole point:
 * the contract refuses an `objectKey` that does not begin with the tenant id,
 * so a key that could address another tenant's object cannot reach `PutObject`
 * from here. That is the failure mode of shared storage, and it used to be
 * enforced by nothing but the shape of the template literal at each call site.
 *
 * Re-parsed on the way in even though `fileRef` already validated. A ref can
 * cross a boundary the compiler checked and the runtime did not — and this
 * function is the last thing between it and a bucket.
 */
export async function uploadDocument(ref: FileRef, body: Buffer): Promise<FileRef> {
  // Before the configuration check, deliberately. A ref that could address
  // another tenant's object is wrong whether or not this deployment has storage
  // configured, and refusing it only when a bucket happens to be set would mean
  // the one environment where it is never caught is the one used to develop the
  // call site.
  const valid = parseFileRef(ref)

  // The ref describes these bytes or it describes nothing. A caller that built
  // a ref from one buffer and uploaded another would store an object whose
  // recorded checksum is a lie, and the lie is only discovered by whoever
  // trusts it. Before the configuration check for the same reason as above.
  if (valid.sizeBytes !== body.length) {
    throw new Error(
      `FileRef describes ${valid.sizeBytes} bytes and ${body.length} were supplied. The ref must ` +
        `describe the bytes being stored.`,
    )
  }

  if (!documentsBucket) throw new Error("Document storage is not configured")

  await s3Client().send(
    new PutObjectCommand({
      Bucket: documentsBucket,
      Key: valid.objectKey,
      Body: body,
      ContentType: valid.mimeType,
      ServerSideEncryption: "AES256",
    })
  )
  return valid
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
