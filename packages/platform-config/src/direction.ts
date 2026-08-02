/**
 * GE-022-004 — text direction, derived rather than configured.
 *
 * There is deliberately no `platform.localization.direction` key. Direction is a
 * property of a writing system, not a preference: Arabic is right-to-left and
 * English is not, and a setting that let an administrator disagree would only
 * ever be used to get it wrong. It is computed from the locale that is already
 * configured, so the two cannot drift apart.
 *
 * ## Why this does not ask the runtime
 *
 * `Intl.Locale.prototype.getTextInfo()` is the API for exactly this question,
 * and an earlier version of this file preferred it. CI caught what that costs:
 * the engine's containers run Node 20, which has only the older `textInfo`
 * getter — and that getter answers with the LANGUAGE's default direction, not
 * the tag's. On Node 20 it reports `dv-MV` (Thaana) and `az-Arab` as
 * left-to-right; on Node 22, `getTextInfo()` gets both right.
 *
 * So the standard API is not one answer available in two spellings. It is two
 * different answers, and the same tenant would lay out one way on a container
 * and the other way on the next one. Deriving from the script instead makes the
 * answer a property of this file, identical on every runtime the engine is
 * deployed to — which is worth more than deferring to an API that disagrees
 * with itself across versions.
 */

/**
 * The right-to-left scripts, by ISO 15924 code.
 *
 * Scripts rather than languages, because the language is not the deciding
 * factor: `az-Arab` is right-to-left and `az-Latn` is not, and any list of
 * "RTL languages" gets that pair wrong.
 */
const RTL_SCRIPTS = new Set([
  "Adlm", // Adlam
  "Arab", // Arabic
  "Aran", // Nastaliq
  "Armi", // Imperial Aramaic
  "Avst", // Avestan
  "Cprt", // Cypriot
  "Egyp", // Egyptian hieroglyphs
  "Hatr", // Hatran
  "Hebr", // Hebrew
  "Hung", // Old Hungarian
  "Khar", // Kharoshthi
  "Lydi", // Lydian
  "Mand", // Mandaic
  "Mani", // Manichaean
  "Mend", // Mende Kikakui
  "Merc", // Meroitic cursive
  "Mero", // Meroitic hieroglyphs
  "Narb", // Old North Arabian
  "Nbat", // Nabataean
  "Nkoo", // NKo
  "Orkh", // Old Turkic
  "Palm", // Palmyrene
  "Phli", // Inscriptional Pahlavi
  "Phlp", // Psalter Pahlavi
  "Phnx", // Phoenician
  "Prti", // Inscriptional Parthian
  "Rohg", // Hanifi Rohingya
  "Samr", // Samaritan
  "Sarb", // Old South Arabian
  "Sogd", // Sogdian
  "Sogo", // Old Sogdian
  "Syrc", // Syriac
  "Thaa", // Thaana
  "Yezi", // Yezidi
])

export type TextDirection = "ltr" | "rtl"

/**
 * The direction a locale is written in.
 *
 * Falls back to `ltr` for anything unparseable rather than throwing. A
 * malformed tag should not take the page down, and the locale key already
 * refuses tags the runtime cannot format in — so anything reaching here that
 * this cannot parse is a tag the platform has already accepted, and the
 * majority answer is the safe one.
 */
export function textDirectionFor(locale: string): TextDirection {
  let parsed: Intl.Locale
  try {
    parsed = new Intl.Locale(locale)
  } catch {
    return "ltr"
  }

  // `maximize()` fills in what the tag left out: "ar" carries no script subtag,
  // and "ar-Arab-EG" does. An explicit script always wins, which is what makes
  // az-Arab and az-Latn come out differently.
  let script = parsed.script
  if (!script) {
    try {
      script = parsed.maximize().script
    } catch {
      script = undefined
    }
  }
  return script && RTL_SCRIPTS.has(script) ? "rtl" : "ltr"
}
