/**
 * What a file upload accepts, and what it says about the ones it does not.
 *
 * The rules are here rather than in the component for the reason the keyboard
 * models are: a rejection is a decision, decisions are where the defects are,
 * and a decision expressed as a pure function can be enumerated in a node spec
 * with no DOM and no file picker.
 *
 * ## A rejection is a sentence, not a boolean
 *
 * "That file is not allowed" is the message that makes an operator try the same
 * file three times. Every rejection here names the file, says which rule it
 * broke, and says what would satisfy it — which is the difference between an
 * error and an instruction.
 */

export interface FileCandidate {
  name: string
  size: number
  /** The browser's guess. Empty for many files, which is why the extension is checked too. */
  type: string
}

export interface FileRejection {
  file: FileCandidate
  reason: string
}

export interface FileCheckResult<T extends FileCandidate> {
  accepted: readonly T[]
  rejected: readonly FileRejection[]
}

export interface FileRules {
  /**
   * The `accept` list, in the attribute's own syntax: extensions (`.json`),
   * concrete types (`application/json`), or wildcards (`text/*`).
   */
  accept?: string
  /** In bytes. */
  maxBytes?: number
  maxFiles?: number
}

/**
 * Bytes as a person reads them.
 *
 * Base ten, because storage and every AWS console page are base ten, and a
 * console that reports 1.05 MB where the provider's bill says 1.1 MB starts an
 * argument nobody can win.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size"
  if (bytes < 1000) return `${bytes} B`
  const units = ["kB", "MB", "GB", "TB"]
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

function extensionOf(name: string): string {
  const at = name.lastIndexOf(".")
  return at === -1 ? "" : name.slice(at).toLowerCase()
}

/** Whether one file satisfies one `accept` list. Exported because the rule is worth testing alone. */
export function matchesAccept(file: FileCandidate, accept: string): boolean {
  const rules = accept
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean)
  if (rules.length === 0) return true
  const type = file.type.toLowerCase()
  const extension = extensionOf(file.name)
  return rules.some((rule) => {
    if (rule.startsWith(".")) return extension === rule
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1))
    return type === rule
  })
}

/**
 * Sort a selection into what may be uploaded and what may not.
 *
 * The count rule is applied LAST and against the already-accepted files, so a
 * selection of six where two are the wrong type reports the two type problems
 * rather than silently keeping the first four and calling it a limit.
 */
export function checkFiles<T extends FileCandidate>(
  files: readonly T[],
  rules: FileRules,
): FileCheckResult<T> {
  const accepted: T[] = []
  const rejected: FileRejection[] = []

  for (const file of files) {
    if (rules.accept && !matchesAccept(file, rules.accept)) {
      rejected.push({
        file,
        reason: `${file.name} is not one of the accepted types (${rules.accept}).`,
      })
      continue
    }
    if (rules.maxBytes !== undefined && file.size > rules.maxBytes) {
      rejected.push({
        file,
        reason: `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(rules.maxBytes)}.`,
      })
      continue
    }
    if (file.size === 0) {
      rejected.push({ file, reason: `${file.name} is empty.` })
      continue
    }
    accepted.push(file)
  }

  if (rules.maxFiles !== undefined && accepted.length > rules.maxFiles) {
    for (const file of accepted.slice(rules.maxFiles)) {
      rejected.push({
        file,
        reason: `${file.name} exceeds the limit of ${rules.maxFiles} file${rules.maxFiles === 1 ? "" : "s"}.`,
      })
    }
    return { accepted: accepted.slice(0, rules.maxFiles), rejected }
  }

  return { accepted, rejected }
}

/** The sentence the live region announces after a selection. */
export function describeSelection(result: FileCheckResult<FileCandidate>): string {
  const kept = result.accepted.length
  const lost = result.rejected.length
  if (kept === 0 && lost === 0) return "No file chosen."
  const parts = [`${kept} file${kept === 1 ? "" : "s"} ready`]
  if (lost) parts.push(`${lost} rejected`)
  return `${parts.join(", ")}.`
}
