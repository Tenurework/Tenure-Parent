import crypto from "node:crypto"

/**
 * PAY-200-003 — financial identifiers: tokenized, encrypted, and shown only as
 * much as the purpose asking has earned.
 *
 * `packages/audit/src/secret-values.ts` already recognises CREDENTIALS by their
 * published prefixes and either redacts or refuses them. This is the other
 * class, and nothing looked for it: a card number, an IBAN, a routing number or
 * a provider object id is not a credential — it cannot be presented to an API
 * to act as anybody — but it identifies a person's money, it is regulated
 * (PAN storage is PCI scope), and it is exactly what ends up pasted into a
 * reimbursement note, echoed into an audit row that `ON DELETE RESTRICT` makes
 * impossible to remove, and posted to a model vendor inside a prompt.
 *
 * The three verbs in the requirement are three different mechanisms and this
 * module keeps them apart on purpose:
 *
 *   * **Tokenize** — `tokenFor` is a keyed, tenant-scoped HMAC. Deterministic,
 *     so two systems can agree that two records concern the same card without
 *     either of them holding the card; one-way, so the token is not a copy of
 *     the identifier wearing a hat. It is TENANT-scoped because a token that
 *     was stable across tenants would let anyone holding two tenants' exports
 *     join them on a customer's bank account.
 *   * **Encrypt** — `encryptIdentifier` is AES-256-GCM, for the case where the
 *     value has to come back (a payout file, a tax form). Authenticated, so a
 *     record edited in the database fails to decrypt instead of decrypting to
 *     something else, and stamped with a key id so a record encrypted under a
 *     retired key says so rather than failing as "corrupt".
 *   * **Mask** — `maskIdentifier` is what a human sees, and how much of it is
 *     decided by `revealFor` from the PURPOSE, not by the call site.
 *
 * ── Why every detector carries a checksum ───────────────────────────────────
 *
 * A sixteen-digit run is a card number, an order reference, a phone number with
 * the punctuation removed, or a row id. Claiming all of them redacts the
 * application's own identifiers out of its own logs, which is how a redactor
 * gets switched off. So `PAN` is Luhn-checked, `IBAN` is mod-97-checked, and
 * `US_ROUTING` is ABA-checked: a match is arithmetic, not a guess. The cost is
 * that a mistyped card number is not recognised, which is the correct trade —
 * the same one `secret-values.ts` makes when it says "tuned to be certain
 * rather than exhaustive".
 *
 * The one kind with no checksum available, `US_BANK_ACCOUNT`, is recognised
 * ONLY next to a label that names it. A bare run of digits is not claimed.
 */

export const FINANCIAL_IDENTIFIER_KINDS = [
  /** Card primary account number. PCI scope; never displayable in full. */
  "PAN",
  /** International bank account number. */
  "IBAN",
  /** US ABA routing / transit number. */
  "US_ROUTING",
  /** A domestic bank account number, recognised only beside a label. */
  "US_BANK_ACCOUNT",
  /** A provider-side financial object: connected account, customer, bank account, card, payment. */
  "PROVIDER_OBJECT",
] as const

export type FinancialIdentifierKind = (typeof FINANCIAL_IDENTIFIER_KINDS)[number]

/** How much of an identifier a reader may see. Ordered; `NONE` is the floor. */
export const REVEAL_LEVELS = ["NONE", "LAST4", "PREFIX_LAST4", "FULL"] as const
export type RevealLevel = (typeof REVEAL_LEVELS)[number]

const REVEAL_RANK: ReadonlyMap<RevealLevel, number> = new Map(
  REVEAL_LEVELS.map((level, index) => [level, index]),
)

/**
 * Why somebody is looking. A closed union, because the point of purpose-based
 * access is that the purposes are a reviewed list rather than a string a caller
 * invents at the moment it wants more.
 */
export const ACCESS_PURPOSES = [
  /** The person the identifier belongs to, looking at their own record. */
  "CUSTOMER_SELF_SERVICE",
  /** Matching Tenure's books against a provider's or a bank's. */
  "OPERATIONS_RECONCILIATION",
  /** A support agent working a ticket. */
  "SUPPORT_TROUBLESHOOTING",
  /** Producing a statutory form or filing that names the account. */
  "TAX_REPORTING",
  /** Text on its way to a model vendor. */
  "MODEL_PROMPT",
  /** A log line, a trace attribute, an error report. */
  "LOG_OR_TRACE",
  /** Metadata on an append-only audit record. */
  "AUDIT_EVIDENCE",
] as const

export type AccessPurpose = (typeof ACCESS_PURPOSES)[number]

/**
 * The most any purpose may ever see, per kind, with no grant in play.
 *
 * `PAN` tops out at `PREFIX_LAST4` in every row and there is no row that says
 * otherwise: PCI DSS 3.3 permits at most the first six and last four digits on
 * display, so "the whole card number" is not a thing a purpose can be granted
 * here. That ceiling is enforced in `revealFor` by the kind, so a future
 * purpose added to this table cannot accidentally acquire it.
 */
const BASE_REVEAL: Readonly<
  Record<AccessPurpose, Readonly<Record<FinancialIdentifierKind, RevealLevel>>>
> = {
  CUSTOMER_SELF_SERVICE: {
    PAN: "LAST4",
    IBAN: "LAST4",
    US_ROUTING: "LAST4",
    US_BANK_ACCOUNT: "LAST4",
    PROVIDER_OBJECT: "NONE",
  },
  OPERATIONS_RECONCILIATION: {
    PAN: "PREFIX_LAST4",
    IBAN: "PREFIX_LAST4",
    US_ROUTING: "LAST4",
    US_BANK_ACCOUNT: "LAST4",
    PROVIDER_OBJECT: "PREFIX_LAST4",
  },
  SUPPORT_TROUBLESHOOTING: {
    PAN: "LAST4",
    IBAN: "LAST4",
    US_ROUTING: "LAST4",
    US_BANK_ACCOUNT: "LAST4",
    PROVIDER_OBJECT: "PREFIX_LAST4",
  },
  TAX_REPORTING: {
    PAN: "LAST4",
    IBAN: "LAST4",
    US_ROUTING: "LAST4",
    US_BANK_ACCOUNT: "LAST4",
    PROVIDER_OBJECT: "NONE",
  },
  MODEL_PROMPT: {
    PAN: "NONE",
    IBAN: "NONE",
    US_ROUTING: "NONE",
    US_BANK_ACCOUNT: "NONE",
    PROVIDER_OBJECT: "NONE",
  },
  LOG_OR_TRACE: {
    PAN: "NONE",
    IBAN: "NONE",
    US_ROUTING: "NONE",
    US_BANK_ACCOUNT: "NONE",
    PROVIDER_OBJECT: "NONE",
  },
  AUDIT_EVIDENCE: {
    PAN: "NONE",
    IBAN: "NONE",
    US_ROUTING: "NONE",
    US_BANK_ACCOUNT: "NONE",
    PROVIDER_OBJECT: "NONE",
  },
}

/**
 * Purposes no grant can raise.
 *
 * These three are not "sensitive surfaces an operator should be careful with";
 * they are surfaces where the data leaves the place the grant was reasoned
 * about. A prompt goes to a third party, a log goes to a shared aggregator, an
 * audit row is append-only and cannot be edited afterwards. A grant is a
 * decision about a PERSON's access; none of these three has a person on the
 * other end at the moment it happens, so there is nobody for the grant to be
 * about.
 */
export const PURPOSES_NO_GRANT_CAN_RAISE: readonly AccessPurpose[] = [
  "MODEL_PROMPT",
  "LOG_OR_TRACE",
  "AUDIT_EVIDENCE",
]

/**
 * A recorded decision that one principal may see more, for one purpose, until
 * one moment.
 *
 * `justification` is required and length-checked for the same reason
 * `support-session.ts` checks its reason: a grant whose stated cause is "work"
 * is a grant nobody can review, and the review is the entire control.
 */
export interface PurposeGrant {
  purpose: AccessPurpose
  grantedTo: string
  grantedBy: string
  justification: string
  /** ISO-8601. A grant with no end is refused — see `grantProblems`. */
  expiresAt: string
  /** Kinds this grant covers. Empty covers nothing; there is no "all". */
  kinds: readonly FinancialIdentifierKind[]
}

export interface GrantProblem {
  field: string
  detail: string
}

/** Whether a grant is well-formed. Separate from whether it is live. */
export function grantProblems(grant: PurposeGrant): readonly GrantProblem[] {
  const problems: GrantProblem[] = []
  if (!(ACCESS_PURPOSES as readonly string[]).includes(grant.purpose)) {
    problems.push({
      field: "purpose",
      detail: `"${grant.purpose}" is not a purpose. The list is reviewed; a caller cannot add to it by naming one.`,
    })
  }
  if (!grant.grantedTo.trim()) {
    problems.push({ field: "grantedTo", detail: "A grant to nobody is a grant to everybody." })
  }
  if (!grant.grantedBy.trim()) {
    problems.push({ field: "grantedBy", detail: "No granter. An access nobody granted is one nobody can be asked about." })
  }
  if (grant.justification.trim().length < 12) {
    problems.push({
      field: "justification",
      detail: "A justification short enough to be a placeholder is one nobody can review against.",
    })
  }
  if (Number.isNaN(Date.parse(grant.expiresAt))) {
    problems.push({
      field: "expiresAt",
      detail: `"${grant.expiresAt}" is not a date. A grant whose end nobody can compute never ends.`,
    })
  }
  if (grant.kinds.length === 0) {
    problems.push({
      field: "kinds",
      detail: "A grant naming no kind of identifier permits nothing; state what is needed.",
    })
  }
  return problems
}

/**
 * How much of `kind` a reader acting for `purpose` may see.
 *
 * Order of the three rules matters and each is doing separate work:
 *
 *   1. An unrecognised purpose sees `NONE`. Not an error thrown at the caller —
 *      a caller that mistypes a purpose must get the SAFE answer, because the
 *      alternative is a crash on a display path and somebody removing the check.
 *   2. A well-formed, live, in-scope grant naming a purpose that is not one of
 *      `PURPOSES_NO_GRANT_CAN_RAISE` lifts the level to `FULL`.
 *   3. The PAN ceiling is applied LAST, so it survives every other rule.
 */
export function revealFor(
  kind: FinancialIdentifierKind,
  purpose: string,
  grant: PurposeGrant | null,
  at: string,
): RevealLevel {
  const row = BASE_REVEAL[purpose as AccessPurpose]
  if (!row) return "NONE"

  let level = row[kind] ?? "NONE"

  if (
    grant &&
    grant.purpose === purpose &&
    grant.kinds.includes(kind) &&
    grantProblems(grant).length === 0 &&
    !PURPOSES_NO_GRANT_CAN_RAISE.includes(grant.purpose as AccessPurpose) &&
    Date.parse(at) < Date.parse(grant.expiresAt)
  ) {
    level = "FULL"
  }

  // PCI DSS 3.3. Not a policy row, because a row can be edited by somebody who
  // has not read the standard; a ceiling in code is a ceiling.
  if (kind === "PAN" && (REVEAL_RANK.get(level) ?? 0) > (REVEAL_RANK.get("PREFIX_LAST4") ?? 0)) {
    level = "PREFIX_LAST4"
  }

  return level
}

// ── Detection ───────────────────────────────────────────────────────────────

/** Digits only, uppercase — what a checksum and a token are computed over. */
export function normalizeIdentifier(value: string, kind: FinancialIdentifierKind): string {
  if (kind === "PROVIDER_OBJECT") return value.trim()
  return value.replace(/[\s-]/g, "").toUpperCase()
}

/** Luhn. A card number that fails it is not a card number. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

/**
 * ISO 13616 mod-97. Move the first four characters to the end, map letters to
 * two-digit numbers, and the remainder mod 97 must be 1.
 *
 * Computed in chunks rather than with BigInt so a 34-character IBAN does not
 * depend on an allocation to be checkable.
 */
export function passesIbanCheck(value: string): boolean {
  const iban = value.replace(/[\s-]/g, "").toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const mapped = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch
    for (const digit of mapped) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97
    }
  }
  return remainder === 1
}

/** ABA: 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10). */
export function passesAbaCheck(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "")
  if (!/^\d{9}$/.test(digits)) return false
  const d = [...digits].map((c) => c.charCodeAt(0) - 48)
  const sum =
    3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])
  return sum % 10 === 0
}

/**
 * Whether the first two digits name an assigned Federal Reserve routing
 * symbol range.
 *
 * 00 is reserved (and appears on no live institution), 13–20, 33–60 and 73–79
 * are unassigned, and 80 is a traveller's-cheque range. Everything outside the
 * assigned ranges is a nine-digit number that happens to checksum.
 */
export function abaPrefixIsAssigned(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "")
  if (!/^\d{9}$/.test(digits)) return false
  const prefix = Number(digits.slice(0, 2))
  return (
    (prefix >= 1 && prefix <= 12) ||
    (prefix >= 21 && prefix <= 32) ||
    (prefix >= 61 && prefix <= 72) ||
    prefix === 80
  )
}

/**
 * Provider object prefixes that name a financial object.
 *
 * Deliberately not every prefix a provider issues: an event id or a request id
 * identifies a MESSAGE, and redacting those out of a log removes the one handle
 * an engineer uses to find the message. These five identify an account, a
 * customer, a stored instrument or a movement of money.
 */
const PROVIDER_OBJECT_PREFIXES = ["acct", "cus", "ba", "card", "py", "pi", "ch", "po"] as const

export interface IdentifierOccurrence {
  kind: FinancialIdentifierKind
  /** Exactly as it appeared, punctuation included. */
  raw: string
  /** Checksum-normalised: what `tokenFor` hashes. */
  normalized: string
  start: number
  end: number
}

interface Detector {
  kind: FinancialIdentifierKind
  re: RegExp
  /** Which capture group holds the value. 0 is the whole match. */
  group: number
  accept: (value: string) => boolean
}

const DETECTORS: readonly Detector[] = [
  {
    kind: "IBAN",
    re: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){2,7}(?:[ -]?[A-Z0-9]{1,4})?\b/g,
    group: 0,
    accept: passesIbanCheck,
  },
  {
    kind: "PAN",
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    group: 0,
    accept: (v) => passesLuhn(v.replace(/[\s-]/g, "")),
  },
  {
    // A labelled account number. The label is part of the match so a bare run
    // of digits is never claimed, and the capture keeps only the number.
    kind: "US_BANK_ACCOUNT",
    re: /\b(?:account|acct|a\/c)(?:\s+(?:number|no\.?|#))?\s*[:#]?\s*(\d{6,17})\b/gi,
    group: 1,
    accept: (v) => /^\d{6,17}$/.test(v),
  },
  {
    kind: "US_ROUTING",
    re: /\b(?:routing|aba|rtn)(?:\s+(?:number|no\.?|#))?\s*[:#]?\s*(\d{9})\b/gi,
    group: 1,
    accept: passesAbaCheck,
  },
  {
    // An UNLABELLED nine-digit run. The ABA checksum alone lets one in ten
    // random nine-digit numbers through, which would redact ordinary
    // identifiers out of the application's own logs — so the assigned Federal
    // Reserve prefix is required as well. That is still not a proof, and the
    // residual is stated rather than hidden: a nine-digit number that both
    // checksums and begins in an assigned range is treated as a routing number.
    kind: "US_ROUTING",
    re: /\b\d{9}\b/g,
    group: 0,
    accept: (v) => passesAbaCheck(v) && abaPrefixIsAssigned(v),
  },
  {
    kind: "PROVIDER_OBJECT",
    re: new RegExp(`\\b(?:${PROVIDER_OBJECT_PREFIXES.join("|")})_[A-Za-z0-9]{6,}\\b`, "g"),
    group: 0,
    // `pi_…_secret_…` is a CLIENT SECRET, which is `secret-values.ts`'s subject
    // and a different answer (refuse, not tokenize). Claiming it here would let
    // a credential be replaced by a token and reported as handled.
    accept: (v) => !v.includes("_secret_"),
  },
]

/**
 * Every financial identifier in `text`, non-overlapping, left to right.
 *
 * Where two detectors claim overlapping spans the LONGER span wins, and a tie
 * goes to the earlier detector in `DETECTORS`. That order is why `IBAN` is
 * listed first: `GB33BUKB20201555555555` contains a 16-digit run, and the
 * digits of an IBAN are not a card number.
 */
export function findFinancialIdentifiers(text: string): readonly IdentifierOccurrence[] {
  if (typeof text !== "string" || text.length === 0) return []

  const found: (IdentifierOccurrence & { rank: number })[] = []

  DETECTORS.forEach((detector, rank) => {
    const re = new RegExp(detector.re.source, detector.re.flags)
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      // A zero-width match would spin forever; regexes here cannot produce one,
      // but the guard costs nothing and the failure mode is a hung process.
      if (match[0].length === 0) {
        re.lastIndex += 1
        continue
      }
      const captured = detector.group === 0 ? match[0] : match[detector.group]
      if (!captured) continue
      if (!detector.accept(captured)) continue
      const offsetInMatch = detector.group === 0 ? 0 : match[0].indexOf(captured)
      const start = match.index + offsetInMatch
      found.push({
        kind: detector.kind,
        raw: captured,
        normalized: normalizeIdentifier(captured, detector.kind),
        start,
        end: start + captured.length,
        rank,
      })
    }
  })

  found.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    const lengthDiff = b.end - b.start - (a.end - a.start)
    if (lengthDiff !== 0) return lengthDiff
    return a.rank - b.rank
  })

  const kept: IdentifierOccurrence[] = []
  let consumedTo = -1
  for (const candidate of found) {
    if (candidate.start < consumedTo) continue
    const { rank: _rank, ...occurrence } = candidate
    kept.push(occurrence)
    consumedTo = candidate.end
  }
  return kept
}

// ── Masking ─────────────────────────────────────────────────────────────────

const DOT = "•"

/**
 * What a reader at `level` sees.
 *
 * The masked form always states its kind implicitly by shape — a masked PAN is
 * still sixteen characters wide — because a mask that collapses everything to
 * one blob makes two different accounts look like the same redaction.
 */
export function maskIdentifier(
  value: string,
  kind: FinancialIdentifierKind,
  level: RevealLevel,
): string {
  const normalized = normalizeIdentifier(value, kind)
  if (level === "FULL") return value

  if (kind === "PROVIDER_OBJECT") {
    const underscore = normalized.indexOf("_")
    const prefix = underscore > 0 ? normalized.slice(0, underscore + 1) : ""
    const body = normalized.slice(prefix.length)
    if (level === "NONE") return `${prefix}${DOT.repeat(Math.min(body.length, 8))}`
    const last4 = body.slice(-4)
    if (level === "LAST4") return `${DOT.repeat(4)}${last4}`
    return `${prefix}${DOT.repeat(Math.max(body.length - 4, 0))}${last4}`
  }

  const last4 = normalized.slice(-4)
  if (level === "NONE") return DOT.repeat(Math.min(normalized.length, 12))
  if (level === "LAST4") return `${DOT.repeat(4)}${last4}`

  // PREFIX_LAST4. Six for a PAN — the issuer identification number, which is
  // the part reconciliation actually needs and the most PCI DSS 3.3 allows.
  const prefixLength = kind === "PAN" ? 6 : 4
  const prefix = normalized.slice(0, prefixLength)
  const middle = Math.max(normalized.length - prefixLength - 4, 0)
  return `${prefix}${DOT.repeat(middle)}${last4}`
}

// ── Tokenization ────────────────────────────────────────────────────────────

/**
 * The shortest key this will accept, in characters.
 *
 * 32 hex characters is 128 bits. Below that a token is brute-forceable by
 * enumerating the key, and the whole card space is only 10^16 — an attacker
 * holding tokens and a short key recovers the PANs, so a "tokenized" column
 * would be a PAN column with extra steps.
 */
export const MIN_TOKEN_KEY_LENGTH = 32

export type TokenizationRefusal =
  /** No key is configured for this deployment. */
  | "no-key"
  /** No tenant was in scope, so the token could not be tenant-scoped. */
  | "no-tenant"
  /** A key too short to be one. */
  | "key-too-short"
  /** Nothing to tokenize. */
  | "empty-value"

export type TokenResult =
  | { ok: true; token: string; keyId: string }
  | { ok: false; reason: TokenizationRefusal; detail: string }

/**
 * A short, stable name for the key a value was tokenized or encrypted under.
 *
 * Derived from the key rather than configured beside it, so a deployment cannot
 * label two different keys with the same id — which is the failure that makes a
 * rotation unrecoverable.
 */
export function keyIdOf(key: string): string {
  return crypto.createHash("sha256").update(`tenure-financial-identifier-key|${key}`).digest("hex").slice(0, 8)
}

/**
 * A deterministic, tenant-scoped, one-way token for one identifier.
 *
 * The tenant is inside the HMAC input, not appended to the output: appending it
 * would make the same card produce the same digest everywhere and merely label
 * which tenant it was seen in.
 */
export function tokenFor(
  value: string,
  input: { kind: FinancialIdentifierKind; tenantId: string; key: string | null },
): TokenResult {
  if (!value || !value.trim()) {
    return { ok: false, reason: "empty-value", detail: "Nothing was passed to tokenize." }
  }
  if (!input.tenantId || !input.tenantId.trim()) {
    return {
      ok: false,
      reason: "no-tenant",
      detail:
        "No tenant is in scope, so this value cannot be tokenized. It has not been tokenized " +
        "under an empty tenant: that token would be identical in every tenant, which is exactly " +
        "the cross-tenant join tenant-scoping exists to prevent.",
    }
  }
  if (!input.key) {
    return {
      ok: false,
      reason: "no-key",
      detail:
        "No tokenization key is configured for this deployment, so this value cannot be tokenized. " +
        "It has not been tokenized under an empty key: an unkeyed hash of a card number is a card " +
        "number, because the space is small enough to enumerate.",
    }
  }
  if (input.key.length < MIN_TOKEN_KEY_LENGTH) {
    return {
      ok: false,
      reason: "key-too-short",
      detail: `The configured tokenization key is ${input.key.length} characters; ${MIN_TOKEN_KEY_LENGTH} is the minimum.`,
    }
  }

  const normalized = normalizeIdentifier(value, input.kind)
  const digest = crypto
    .createHmac("sha256", input.key)
    .update(`${input.kind}|${input.tenantId}|${normalized}`)
    .digest("hex")

  return {
    ok: true,
    token: `tk_${input.kind.toLowerCase()}_${digest.slice(0, 24)}`,
    keyId: keyIdOf(input.key),
  }
}

// ── Encryption ──────────────────────────────────────────────────────────────

export type EncryptionRefusal =
  | "no-key"
  | "key-too-short"
  | "malformed-record"
  | "wrong-key"
  | "tampered"

export type EncryptResult =
  | { ok: true; record: string; keyId: string }
  | { ok: false; reason: EncryptionRefusal; detail: string }

export type DecryptResult =
  | { ok: true; value: string }
  | { ok: false; reason: EncryptionRefusal; detail: string }

/** `fi1.<keyId>.<iv>.<ciphertext>.<tag>`, every part base64url. */
const RECORD_VERSION = "fi1"

function subKey(key: string, kind: FinancialIdentifierKind): Buffer {
  // Separate key material per kind, derived rather than configured: a key
  // recovered from one column then does not open the others.
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(key, "utf8"), Buffer.from("tenure-fi-v1"), Buffer.from(kind), 32),
  )
}

export function encryptIdentifier(
  value: string,
  input: { kind: FinancialIdentifierKind; key: string | null },
): EncryptResult {
  if (!input.key) {
    return {
      ok: false,
      reason: "no-key",
      detail:
        "No encryption key is configured, so this identifier cannot be stored recoverably. " +
        "Storing it in the clear is the alternative this refusal exists to prevent.",
    }
  }
  if (input.key.length < MIN_TOKEN_KEY_LENGTH) {
    return {
      ok: false,
      reason: "key-too-short",
      detail: `The configured key is ${input.key.length} characters; ${MIN_TOKEN_KEY_LENGTH} is the minimum.`,
    }
  }

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", subKey(input.key, input.kind), iv)
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  const keyId = keyIdOf(input.key)

  return {
    ok: true,
    keyId,
    record: [
      RECORD_VERSION,
      keyId,
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      tag.toString("base64url"),
    ].join("."),
  }
}

export function decryptIdentifier(
  record: string,
  input: { kind: FinancialIdentifierKind; key: string | null },
): DecryptResult {
  if (!input.key) {
    return { ok: false, reason: "no-key", detail: "No key is configured, so nothing can be read back." }
  }
  const parts = typeof record === "string" ? record.split(".") : []
  if (parts.length !== 5 || parts[0] !== RECORD_VERSION) {
    return {
      ok: false,
      reason: "malformed-record",
      detail: `Not a ${RECORD_VERSION} record. It was not decrypted, and it must not be read as plaintext either.`,
    }
  }

  const [, keyId, ivPart, ctPart, tagPart] = parts
  if (keyId !== keyIdOf(input.key)) {
    return {
      ok: false,
      reason: "wrong-key",
      detail:
        `This record was written under key ${keyId} and the configured key is ${keyIdOf(input.key)}. ` +
        `That is a rotation to complete, not a corrupt record.`,
    }
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      subKey(input.key, input.kind),
      Buffer.from(ivPart, "base64url"),
    )
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ctPart, "base64url")),
      decipher.final(),
    ])
    return { ok: true, value: plaintext.toString("utf8") }
  } catch {
    return {
      ok: false,
      reason: "tampered",
      detail:
        "The authentication tag does not match, so this record was altered after it was written. " +
        "GCM refuses rather than returning whatever the altered bytes decrypt to.",
    }
  }
}

// ── The composed answer ─────────────────────────────────────────────────────

export interface RedactionOptions {
  purpose: AccessPurpose | string
  tenantId: string
  /** Null where the deployment has no key. The output says so rather than pretending. */
  key: string | null
  grant?: PurposeGrant | null
  at?: string
}

export interface RedactionFinding {
  kind: FinancialIdentifierKind
  level: RevealLevel
  masked: string
  /** The token, or null with `tokenRefusal` saying why there is not one. */
  token: string | null
  tokenRefusal: TokenizationRefusal | null
  start: number
  end: number
}

export interface RedactionResult {
  text: string
  findings: readonly RedactionFinding[]
  /** True when at least one identifier could not be tokenized. */
  degraded: boolean
}

/**
 * Rewrite `text` so every financial identifier in it is shown at the level the
 * purpose earns, with a token beside it where one can be computed.
 *
 * The token is in the output on purpose. A redaction that leaves `••••1111`
 * makes two log lines about two different cards ending 1111 indistinguishable,
 * so an engineer either cannot do the work or asks for the raw value. The token
 * restores exactly the property that was lost — "the same card" — and nothing
 * else.
 *
 * Where no key is configured the replacement SAYS the value was not tokenized.
 * Silently emitting the mask alone would make "we tokenized this" and "we could
 * not" look identical in the output, and only one of them is a working control.
 */
export function redactFinancialIdentifiers(
  text: string,
  options: RedactionOptions,
): RedactionResult {
  const occurrences = findFinancialIdentifiers(text)
  if (occurrences.length === 0) return { text, findings: [], degraded: false }

  const at = options.at ?? new Date().toISOString()
  const findings: RedactionFinding[] = []
  let out = ""
  let cursor = 0
  let degraded = false

  for (const occurrence of occurrences) {
    const level = revealFor(occurrence.kind, options.purpose, options.grant ?? null, at)
    const masked = maskIdentifier(occurrence.raw, occurrence.kind, level)
    const token = tokenFor(occurrence.raw, {
      kind: occurrence.kind,
      tenantId: options.tenantId,
      key: options.key,
    })

    let replacement: string
    if (level === "FULL") {
      replacement = occurrence.raw
    } else if (token.ok) {
      replacement = `${masked} [${token.token}]`
    } else {
      degraded = true
      replacement = `${masked} [not tokenized: ${token.reason}]`
    }

    out += text.slice(cursor, occurrence.start) + replacement
    cursor = occurrence.end

    findings.push({
      kind: occurrence.kind,
      level,
      masked,
      token: token.ok ? token.token : null,
      tokenRefusal: token.ok ? null : token.reason,
      start: occurrence.start,
      end: occurrence.end,
    })
  }

  out += text.slice(cursor)
  return { text: out, findings, degraded }
}

/**
 * Whether this is a plain object — a record, not an instance of something.
 *
 * The walk below rebuilds every object it descends into, and rebuilding a
 * `Date` from its enumerable properties produces `{}`. That is not a redaction,
 * it is silent data loss on a value that carried no identifier in the first
 * place. So the walk descends into records and arrays and hands everything else
 * back untouched: a `Date`, a `Buffer`, a `Map`, an `Error`, a Prisma `Decimal`.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * The same treatment, walked over a structure.
 *
 * Keys are left alone and values are rewritten: a key named `iban` is metadata
 * about the shape of the record, and rewriting it would make the record
 * unreadable while protecting nothing.
 */
export function redactFinancialIdentifiersDeep<T>(value: T, options: RedactionOptions): T {
  if (typeof value === "string") {
    return redactFinancialIdentifiers(value, options).text as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactFinancialIdentifiersDeep(entry, options)) as unknown as T
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactFinancialIdentifiersDeep(entry, options)
    }
    return out as unknown as T
  }
  return value
}

/** Whether `value` carries anything this module recognises. */
export function containsFinancialIdentifier(value: unknown): boolean {
  if (typeof value === "string") return findFinancialIdentifiers(value).length > 0
  if (Array.isArray(value)) return value.some(containsFinancialIdentifier)
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsFinancialIdentifier)
  }
  return false
}
