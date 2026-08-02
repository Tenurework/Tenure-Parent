import { textDirectionFor } from "./direction"

/**
 * GE-022-004 — text direction.
 *
 * The cases that matter are the ones a hand-written "RTL languages" list gets
 * wrong: a language whose direction depends on its script, and a tag that does
 * not carry the script at all.
 */
describe("direction is a property of the script, not of the language", () => {
  it("reads left-to-right languages left-to-right", () => {
    for (const tag of ["en-US", "fr-FR", "de-DE", "ja-JP", "zh-Hans-CN", "ru-RU", "hi-IN"]) {
      expect(textDirectionFor(tag)).toBe("ltr")
    }
  })

  it("reads right-to-left languages right-to-left", () => {
    for (const tag of ["ar", "ar-EG", "he-IL", "fa-IR", "ur-PK", "dv-MV"]) {
      expect(textDirectionFor(tag)).toBe("rtl")
    }
  })

  it("follows the script when one language is written in two", () => {
    // The case that makes a list of "RTL languages" wrong. Azerbaijani is
    // written in both, and only one of them runs right to left.
    expect(textDirectionFor("az-Arab")).toBe("rtl")
    expect(textDirectionFor("az-Latn")).toBe("ltr")
    expect(textDirectionFor("az-Cyrl")).toBe("ltr")
    // Same for Kurdish and Punjabi.
    expect(textDirectionFor("ku-Arab")).toBe("rtl")
    expect(textDirectionFor("ku-Latn")).toBe("ltr")
    expect(textDirectionFor("pa-Arab")).toBe("rtl")
    expect(textDirectionFor("pa-Guru")).toBe("ltr")
  })

  it("infers the script when the tag does not carry one", () => {
    // "ar" has no script subtag. Anything that only reads `parsed.script`
    // returns undefined here and answers ltr — a right-to-left tenant rendered
    // left to right, which is the whole failure this exists to prevent.
    expect(textDirectionFor("ar")).toBe("rtl")
    expect(textDirectionFor("he")).toBe("rtl")
    expect(textDirectionFor("en")).toBe("ltr")
  })
})

describe("a bad tag is not an outage", () => {
  it("falls back to ltr rather than throwing", () => {
    // The locale config key already refuses tags the runtime cannot format in,
    // so anything reaching here has been accepted once. A malformed one should
    // still not take the document down.
    for (const bad of ["", "not a locale", "!!!", "e"]) {
      expect(textDirectionFor(bad)).toBe("ltr")
    }
  })
})

/**
 * The same answer on every runtime.
 *
 * An earlier version of `direction.ts` preferred
 * `Intl.Locale.prototype.getTextInfo()`, and CI — which runs Node 20 — failed
 * on exactly these tags. Node 20 has only the older `textInfo` getter, and that
 * getter reports the LANGUAGE's default direction rather than the tag's: it
 * calls `dv-MV` and `az-Arab` left-to-right, while Node 22's `getTextInfo()`
 * gets both right. Two runtimes, two answers, same tenant — and a shell that
 * lays out one way on a container and the other way on the next.
 *
 * These cases are kept together and named so that anyone tempted to reintroduce
 * the runtime call sees what it costs.
 */
describe("the tags where the runtime APIs disagree with each other", () => {
  it("reads the script's direction, not the language's default", () => {
    // Thaana. Node 20's textInfo answers ltr here.
    expect(textDirectionFor("dv-MV")).toBe("rtl")
    expect(textDirectionFor("dv")).toBe("rtl")
    // Azerbaijani in Arabic script. Node 20 answers ltr here too, because
    // Azerbaijani's default script is Latin.
    expect(textDirectionFor("az-Arab")).toBe("rtl")
    expect(textDirectionFor("az-Latn")).toBe("ltr")
  })

  it("prefers an explicit script subtag over anything inferred", () => {
    // The subtag is the tag's own statement about itself, and it is the only
    // thing that can tell these two apart.
    expect(new Intl.Locale("az-Arab").script).toBe("Arab")
    expect(new Intl.Locale("az-Latn").script).toBe("Latn")
    expect(textDirectionFor("az-Arab")).not.toBe(textDirectionFor("az-Latn"))
  })

  it("maximizes a tag that carries no script subtag", () => {
    // Anything reading only `parsed.script` gets undefined for these and
    // answers ltr — a right-to-left tenant rendered left to right.
    expect(new Intl.Locale("ar").script).toBeUndefined()
    expect(textDirectionFor("ar")).toBe("rtl")
    expect(new Intl.Locale("he").script).toBeUndefined()
    expect(textDirectionFor("he")).toBe("rtl")
  })
})
