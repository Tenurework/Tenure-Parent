import { directionFromScript, textDirectionFor } from "./direction"

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
      expect(directionFromScript(bad)).toBe("ltr")
    }
  })
})

/**
 * The fallback, on its own.
 *
 * This runtime has `Intl.Locale.prototype.getTextInfo()`, so every case above
 * is answered before the script table is consulted and none of them proves
 * anything about it. Two mutations showed that outright: swapping the table for
 * a list of "RTL languages" and removing the `maximize()` call both left the
 * suite green. The fallback exists for runtimes WITHOUT the standard API, which
 * is exactly where a silent wrong answer would go unnoticed — so it is tested
 * directly rather than through the function that shadows it.
 */
describe("the script fallback, for runtimes with no getTextInfo", () => {
  it("answers the same as the standard API on every case above", () => {
    for (const ltr of ["en-US", "fr-FR", "ja-JP", "zh-Hans-CN", "az-Latn", "pa-Guru"]) {
      expect(directionFromScript(ltr)).toBe("ltr")
    }
    for (const rtl of ["ar", "ar-EG", "he-IL", "fa-IR", "ur-PK", "dv-MV", "az-Arab", "pa-Arab"]) {
      expect(directionFromScript(rtl)).toBe("rtl")
    }
  })

  it("maximizes a tag that carries no script subtag", () => {
    // Anything reading only `parsed.script` gets undefined for these and
    // answers ltr — a right-to-left tenant rendered left to right.
    expect(new Intl.Locale("ar").script).toBeUndefined()
    expect(directionFromScript("ar")).toBe("rtl")
    expect(new Intl.Locale("he").script).toBeUndefined()
    expect(directionFromScript("he")).toBe("rtl")
  })

  it("decides by script, not by language", () => {
    // A list of "RTL languages" cannot express this pair, and gets one wrong
    // whichever way it is written.
    expect(directionFromScript("az-Arab")).toBe("rtl")
    expect(directionFromScript("az-Latn")).toBe("ltr")
    expect(new Intl.Locale("az-Arab").language).toBe(new Intl.Locale("az-Latn").language)
  })
})
