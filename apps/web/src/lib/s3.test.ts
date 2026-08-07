/**
 * PACK-010-001 — the file kernel has one shape, and it refuses.
 *
 * `fileRef` is what every upload path in this application now goes through, so
 * these assertions are about the rule that stands between a call site's
 * template literal and a `PutObject`: an object key must begin with the tenant
 * that owns it. Three of the five upload paths did not, and nothing anywhere
 * said so.
 *
 * `uploadDocument` itself is not exercised here — it talks to S3 — but it takes
 * the value `fileRef` produces and re-parses it, so what is proven below is
 * exactly what it enforces.
 */
import { describe, expect, it } from "@jest/globals"

import { ContractViolation, parseFileRef } from "@tenure/contracts"

import { fileRef, uploadDocument } from "./s3"

const BODY = Buffer.from("a receipt, as bytes")

describe("describing an object before storing it", () => {
  it("produces a FileRef the contract accepts", () => {
    const ref = fileRef({
      tenantId: "inst_roch",
      objectKey: "inst_roch/org_1/receipt.pdf",
      mimeType: "application/pdf",
      body: BODY,
    })

    // Round-trip: what this produces is what the kernel's own parser accepts,
    // which is the whole claim — one shape, not two that resemble each other.
    expect(parseFileRef(ref)).toEqual(ref)
    expect(ref.tenantId).toBe("inst_roch")
    expect(ref.sizeBytes).toBe(BODY.length)
  })

  it("refuses a key that does not begin with the tenant", () => {
    // The failure mode of shared storage, and the one three upload paths had:
    // `profile-images/...`, `org-images/...` and `message-attachments/...` all
    // named no tenant at all.
    expect(() =>
      fileRef({
        tenantId: "inst_roch",
        objectKey: "profile-images/user_1/avatar.png",
        mimeType: "image/png",
        body: BODY,
      }),
    ).toThrow(ContractViolation)

    expect(() =>
      fileRef({
        tenantId: "inst_roch",
        objectKey: "inst_other/org_9/secret.pdf",
        mimeType: "application/pdf",
        body: BODY,
      }),
    ).toThrow(/must begin with the tenant id/)
  })

  it("refuses a ref with no tenant at all", () => {
    expect(() =>
      fileRef({
        tenantId: "",
        objectKey: "inst_roch/org_1/receipt.pdf",
        mimeType: "application/pdf",
        body: BODY,
      }),
    ).toThrow(/FileRef\.tenantId/)
  })

  it("computes size and checksum from the bytes rather than believing a caller", () => {
    // A ref that described different bytes than the ones stored would be a
    // checksum somebody later verifies against and believes.
    const a = fileRef({
      tenantId: "t",
      objectKey: "t/a.txt",
      mimeType: "text/plain",
      body: Buffer.from("one"),
    })
    const b = fileRef({
      tenantId: "t",
      objectKey: "t/a.txt",
      mimeType: "text/plain",
      body: Buffer.from("two"),
    })

    expect(a.checksum).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(a.checksum).not.toBe(b.checksum)
    expect(a.sizeBytes).toBe(3)
  })

  it("is refused at the store, not only at the producer", () => {
    // The accept half. A ref can cross a boundary the compiler checked and the
    // runtime did not, and `uploadDocument` is the last thing between it and a
    // bucket — so it re-parses, and it does so BEFORE looking at whether
    // storage is configured. `S3_DOCUMENTS_BUCKET` is unset in this suite,
    // which is exactly the environment in which a bucket-first check would
    // never catch anything.
    const smuggled = {
      fileId: "f1",
      tenantId: "inst_roch",
      objectKey: "inst_other/org_9/secret.pdf",
      mimeType: "application/pdf",
      sizeBytes: BODY.length,
      checksum: "sha256:whatever",
    }

    return expect(uploadDocument(smuggled, BODY)).rejects.toThrow(/must begin with the tenant id/)
  })

  it("refuses a ref that describes different bytes than the ones being stored", async () => {
    const ref = fileRef({
      tenantId: "t",
      objectKey: "t/a.txt",
      mimeType: "text/plain",
      body: BODY,
    })
    // A stored checksum that does not match the object is worse than none: it
    // is a value somebody later verifies against and believes.
    await expect(uploadDocument(ref, Buffer.concat([BODY, BODY]))).rejects.toThrow(
      /must describe the bytes being stored/,
    )
  })

  it("keeps a caller's stable file id when there is one", () => {
    // The in-place document save passes the document's own id, so two versions
    // of one file are recognisably the same file.
    const ref = fileRef({
      fileId: "doc_abc",
      tenantId: "t",
      objectKey: "t/a.txt",
      mimeType: "text/plain",
      body: BODY,
    })
    expect(ref.fileId).toBe("doc_abc")
  })
})
