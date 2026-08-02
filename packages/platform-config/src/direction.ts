/**
 * GE-022-004 — text direction, derived rather than configured.
 *
 * There is deliberately no `platform.localization.direction` key. Direction is a
 * property of a writing system, not a preference: Arabic is right-to-left and
 * English is not, and a setting that let an administrator disagree would only
 * ever be used to get it wrong. It is computed from the locale that is already
 * configured, so the two cannot drift apart.
 *
 * No dependency on `Intl.Locale.prototype.getTextInfo()`. It is the correct API
 * and it is used when present, but it reached Node only recently and the answer
 * has to be the same on every runtime the engine is deployed to — a shell that
 * lays out left-to-right on one container and right-to-left on the next is worse
 * than one that is consistently wrong.
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

  // The standard answer, where the runtime has it.
  const withTextInfo = parsed as Intl.Locale & {
    getTextInfo?: () => { direction?: string }
    textInfo?: { direction?: string }
  }
  const reported =
    typeof withTextInfo.getTextInfo === "function"
      ? withTextInfo.getTextInfo().direction
      : withTextInfo.textInfo?.direction
  if (reported === "rtl" || reported === "ltr") return reported

  return directionFromScript(locale)
}

/**
 * The fallback, exported so it can be tested on its own.
 *
 * On a runtime that has `getTextInfo()` — which this one does — nothing above
 * ever reaches this, so a test that only calls `textDirectionFor` proves
 * nothing about it. Two mutations demonstrated exactly that: replacing the
 * script table with a list of "RTL languages", and dropping the `maximize()`
 * call, both left the whole suite green. The path only runs where the standard
 * API is missing, which is precisely where nobody is watching.
 */
export function directionFromScript(locale: string): TextDirection {
  let parsed: Intl.Locale
  try {
    parsed = new Intl.Locale(locale)
  } catch {
    return "ltr"
  }

  // `maximize()` fills in what the tag left out: "ar" carries no script subtag,
  // and "ar-Arab-EG" does.
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
