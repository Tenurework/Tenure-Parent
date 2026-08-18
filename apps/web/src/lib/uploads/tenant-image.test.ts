/**
 * GE-143-007 — the sanitation rule for tenant-supplied imagery, tested against
 * bytes rather than against file names.
 *
 * Every fixture here is a real signature: the eight-byte PNG header, `FF D8 FF`,
 * `GIF89a`, `RIFF….WEBP`. A test that fed the sanitizer a string called
 * "png bytes" would pass against a sniffer that returned PNG for everything,
 * which is the mutation that matters.
 *
 * The last case reads the shipped tree: it is what stops the next upload path
 * from taking the client's word for the content type again.
 */
import fs from "node:fs"
import path from "node:path"

import {
  CLIENT_DECLARED_TYPE_BACKLOG,
  IMAGE_FORMATS,
  TENANT_IMAGE_MAX_BYTES,
  looksLikeActiveContent,
  sanitizeTenantImage,
  sniffImageFormat,
} from "./tenant-image"

const APP_ROOT = path.resolve(__dirname, "../../..")

const png = (extra = 32) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra)])
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])
const gif = () => Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(16)])
const webp = () =>
  Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WEBP", "latin1"), Buffer.alloc(16)])

describe("the format is read from the bytes", () => {
  it("recognises each format it accepts, and nothing else", () => {
    expect(sniffImageFormat(png())?.id).toBe("png")
    expect(sniffImageFormat(jpeg())?.id).toBe("jpeg")
    expect(sniffImageFormat(gif())?.id).toBe("gif")
    expect(sniffImageFormat(webp())?.id).toBe("webp")
    expect(sniffImageFormat(Buffer.from("just some text"))).toBeNull()
    // Four formats, four signatures — a fifth entry without a signature would
    // be a format nothing can produce.
    expect(IMAGE_FORMATS.map((f) => f.id)).toEqual(["png", "jpeg", "gif", "webp"])
  })

  it("does not accept a GIF whose version byte is something else", () => {
    // `GIF8` alone would admit `GIF8<script>`; the version and the `a` are part
    // of the signature for that reason.
    expect(sniffImageFormat(Buffer.from("GIF8<script>alert(1)</script>", "latin1"))).toBeNull()
  })

  it("does not accept RIFF that is not WEBP", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF", "latin1"),
      Buffer.from([0x20, 0, 0, 0]),
      Buffer.from("WAVE", "latin1"),
    ])
    expect(sniffImageFormat(wav)).toBeNull()
  })
})

describe("active content is refused for what it is", () => {
  it("names an SVG, an XML-prologue SVG, an HTML document and an embedded script", () => {
    expect(looksLikeActiveContent(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("an SVG")
    expect(looksLikeActiveContent(Buffer.from('<?xml version="1.0"?><svg><script/></svg>'))).toBe("an SVG")
    expect(looksLikeActiveContent(Buffer.from("<!DOCTYPE html><html></html>"))).toBe("an HTML document")
    expect(looksLikeActiveContent(Buffer.from("  \n<div><script>x()</script></div>"))).toBe(
      "a document containing a script",
    )
    expect(looksLikeActiveContent(png())).toBeNull()
  })

  it("refuses an SVG logo with the reason, not with 'not an image'", () => {
    const verdict = sanitizeTenantImage({
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/me")</script></svg>'),
      declaredType: "image/svg+xml",
    })
    expect(verdict.accepted).toBeUndefined()
    expect(verdict.refused?.code).toBe("active-content")
    expect(verdict.refused?.explanation).toContain("an SVG")
    expect(verdict.refused?.explanation).toContain("PNG, JPG, GIF or WebP")
  })
})

describe("the declared type is a claim, never a permission", () => {
  it("accepts a PNG and stores the type its bytes prove, not the one it claimed", () => {
    const verdict = sanitizeTenantImage({ bytes: png(), declaredType: "image/png" })
    expect(verdict.accepted).toEqual({
      mimeType: "image/png",
      extension: "png",
      format: "png",
      sizeBytes: 40,
    })
  })

  it("refuses a PNG dressed as an SVG, and an SVG dressed as a PNG", () => {
    // The first is a mislabel that would have been STORED and SERVED as
    // image/svg+xml, because the stored content type came from the claim.
    expect(sanitizeTenantImage({ bytes: png(), declaredType: "image/svg+xml" }).refused?.code).toBe(
      "type-mismatch",
    )
    expect(
      sanitizeTenantImage({ bytes: Buffer.from("<svg/>"), declaredType: "image/png" }).refused?.code,
    ).toBe("active-content")
  })

  it("accepts a file with no declared type at all", () => {
    expect(sanitizeTenantImage({ bytes: gif() }).accepted?.mimeType).toBe("image/gif")
  })

  it("ignores the file name entirely — the extension comes from the bytes", () => {
    // There is no file-name parameter. That is the point: `logo.png` containing
    // a GIF is stored as `.gif`, and `../../evil` cannot reach the object key.
    expect(sanitizeTenantImage({ bytes: gif() }).accepted?.extension).toBe("gif")
    expect(sanitizeTenantImage({ bytes: jpeg() }).accepted?.extension).toBe("jpg")
  })
})

describe("size and emptiness", () => {
  it("refuses an empty file", () => {
    expect(sanitizeTenantImage({ bytes: Buffer.alloc(0) }).refused?.code).toBe("empty")
  })

  it("refuses one over the limit and states the limit and the size", () => {
    const verdict = sanitizeTenantImage({ bytes: png(TENANT_IMAGE_MAX_BYTES), maxBytes: TENANT_IMAGE_MAX_BYTES })
    expect(verdict.refused?.code).toBe("too-large")
    expect(verdict.refused?.explanation).toContain("5 MB")
  })

  it("accepts one exactly at the limit", () => {
    const bytes = png(TENANT_IMAGE_MAX_BYTES - 8)
    expect(bytes.length).toBe(TENANT_IMAGE_MAX_BYTES)
    expect(sanitizeTenantImage({ bytes, maxBytes: TENANT_IMAGE_MAX_BYTES }).accepted?.format).toBe("png")
  })
})

describe("every upload path uses it", () => {
  /** Every shipping .ts/.tsx under src. */
  function productModules(): string[] {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && !/\.(test|itest)\.tsx?$/.test(entry.name)) files.push(full)
      }
    }
    walk(path.join(APP_ROOT, "src"))
    return files
  }

  /** Files that record the client's declared type, and how many times. */
  function claimedTypeSites(): Record<string, number> {
    const found: Record<string, number> = {}
    for (const file of productModules()) {
      // Comments stripped: this module's own header quotes the defect it fixed,
      // and a scan that counted prose would report the fix as the bug.
      const source = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "")
      const hits = [...source.matchAll(/mimeType:\s*\w+\.type\b/g)].length
      if (hits > 0) found[path.relative(APP_ROOT, file).split(path.sep).join("/")] = hits
    }
    return found
  }

  it("neither tenant-image path stores the content type the client claimed", () => {
    // `mimeType: file.type` was the defect, in exactly these two places.
    const sites = claimedTypeSites()
    expect(sites["src/app/(app)/orgs/actions.ts"]).toBeUndefined()
    expect(sites["src/app/(app)/settings/actions.ts"]).toBeUndefined()
  })

  it("the paths that still trust it are the ones the register names, and no others", () => {
    const expected = Object.fromEntries(
      CLIENT_DECLARED_TYPE_BACKLOG.map((entry) => [entry.file, entry.occurrences]),
    )
    expect(claimedTypeSites()).toEqual(expected)
    for (const entry of CLIENT_DECLARED_TYPE_BACKLOG) {
      expect(entry.owner).toMatch(/^GE-\d/)
      expect(entry.what.length).toBeGreaterThan(20)
    }
  })

  it("both tenant-image uploads call the sanitizer", () => {
    // Named rather than derived: these are the two paths by which a tenant's
    // own imagery enters storage, and a test that "found none" would pass on a
    // tree where somebody deleted both.
    const uploads = ["src/app/(app)/orgs/actions.ts", "src/app/(app)/settings/actions.ts"]
    for (const relative of uploads) {
      const source = fs.readFileSync(path.join(APP_ROOT, relative), "utf8")
      expect(source).toContain("sanitizeTenantImage({")
      expect(source).toContain("verdict.accepted.mimeType")
      expect(source).toContain("verdict.accepted.extension")
    }
  })

  it("the control offers exactly the formats the server accepts", () => {
    // `accept="image/*"` invited an SVG the server now refuses, which is a
    // rejection the person only discovers after choosing the file.
    const accepted = IMAGE_FORMATS.map((f) => f.mimeType).join(",")
    for (const relative of ["src/components/ClubImageEditor.tsx", "src/components/ProfileImageEditor.tsx"]) {
      const source = fs.readFileSync(path.join(APP_ROOT, relative), "utf8")
      expect(source).toContain(`accept="${accepted}"`)
    }
  })
})
