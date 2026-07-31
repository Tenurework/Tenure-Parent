/**
 * Produce a structurally identical, personally anonymous roster.
 *
 * `roster-data.mjs` carries 172 real `@simon.rochester.edu` addresses and the
 * names attached to them. That file is committed, and while the repository is
 * public `raw.githubusercontent.com` serves it to anyone — so the data is only
 * as private as the repository setting, which is not a control anybody chose.
 *
 * The fix is that the file should not be committed at all: the real roster
 * belongs at runtime (S3, or a local file a developer supplies), and the
 * repository should carry a synthetic stand-in for CI and local development.
 *
 * This produces that stand-in. Structure is preserved exactly — the same 26
 * clubs, the same 209 seats with the same names, codes, categories, notes,
 * vacancies and predecessor links — because the e2e suite asserts on that
 * structure and a fixture that changes it stops testing the product. Only the
 * people change: names become generated, addresses become @example.invalid
 * (RFC 2606 reserves .invalid, so nothing can ever be delivered to one).
 *
 *   node scripts/anonymize-roster.mjs > scripts/roster-data.sample.mjs
 *
 * Deterministic: the same input person always yields the same fake person, so
 * regenerating produces no diff and a seeded database stays stable across runs.
 */

import { createHash } from "node:crypto"
import { ROSTER, ADVISORS, CURRENT_TERM, PRIOR_TERM, VACANT_LABEL } from "./roster-data.mjs"

const FIRST = [
  "Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Gray", "Harper", "Indigo", "Jordan",
  "Kai", "Logan", "Marlow", "Noor", "Oakley", "Parker", "Quinn", "Rowan", "Sage", "Tatum",
  "Umber", "Vale", "Wren", "Xen", "Yuki", "Zephyr",
]
const LAST = [
  "Ashford", "Bellweather", "Carrow", "Danforth", "Ellery", "Fairbank", "Gallant", "Hollis",
  "Ingram", "Jessup", "Kingsley", "Lonsdale", "Merritt", "Norwood", "Oleander", "Pemberton",
  "Quill", "Ravensworth", "Sterling", "Thornbury", "Underhill", "Vance", "Whitlock", "Yarrow",
]

/** Stable pseudonym for a real name — same input, same output, forever. */
const pseudonymCache = new Map()
function pseudonym(realName) {
  if (!realName) return realName
  if (pseudonymCache.has(realName)) return pseudonymCache.get(realName)

  // Hash rather than index, so the mapping cannot be reversed by position and
  // adding a person does not renumber everyone after them.
  const h = createHash("sha256").update(realName).digest()
  const name = `${FIRST[h[0] % FIRST.length]} ${LAST[h[1] % LAST.length]}`

  // Collisions are fine for a fixture but confusing in a UI test, so widen
  // with a digit rather than letting two people share an identity.
  let unique = name
  let n = 2
  const taken = new Set(pseudonymCache.values())
  while (taken.has(unique)) unique = `${name} ${n++}`

  pseudonymCache.set(realName, unique)
  return unique
}

/** .invalid is reserved by RFC 2606 — mail to it can never be delivered. */
function fakeEmail(fakeName) {
  if (!fakeName) return fakeName
  const [first, last] = fakeName.toLowerCase().split(" ")
  return `${first}.${last}@example.invalid`
}

/** A seat holder, or a vacancy left exactly as it was. */
function anonPerson(person) {
  if (!person) return person
  if (typeof person === "string") {
    return person === VACANT_LABEL ? person : pseudonym(person)
  }
  const name = pseudonym(person.name)
  return {
    ...person,
    ...(person.name !== undefined ? { name } : {}),
    ...(person.email !== undefined ? { email: fakeEmail(name) } : {}),
  }
}

const roster = ROSTER.map((club) => ({
  ...club,
  // Club identity is not personal data and the e2e suite asserts on it.
  advisors: (club.advisors ?? []).map(anonPerson),
  seats: (club.seats ?? []).map((seat) => ({
    ...seat,
    holder: anonPerson(seat.holder),
    predecessor: anonPerson(seat.predecessor),
  })),
}))

const advisors = ADVISORS.map(anonPerson)

const banner = `/**
 * GENERATED — do not edit by hand. Regenerate with:
 *   node scripts/anonymize-roster.mjs > scripts/roster-data.sample.mjs
 *
 * A synthetic stand-in for the real roster, used by CI, the e2e suite and local
 * development. Structure is identical to the real data — same clubs, same
 * seats, same codes, same vacancies — so tests exercise the real shape. Every
 * person is generated, and every address is @example.invalid (RFC 2606), which
 * cannot receive mail.
 *
 * The real roster is NOT in this repository. See docs/RUNBOOK.md.
 */`

const out = [
  banner,
  "",
  `export const CURRENT_TERM = ${JSON.stringify(CURRENT_TERM)}`,
  `export const PRIOR_TERM = ${JSON.stringify(PRIOR_TERM)}`,
  `export const VACANT_LABEL = ${JSON.stringify(VACANT_LABEL)}`,
  "",
  `export const ADVISORS = ${JSON.stringify(advisors, null, 2)}`,
  "",
  `export const ROSTER = ${JSON.stringify(roster, null, 2)}`,
  "",
].join("\n")

process.stdout.write(out)

// Structural assertions to stderr, so piping stdout to a file still reports them.
const seats = roster.reduce((n, c) => n + c.seats.length, 0)
const leaked = /(@simon\.rochester\.edu|@rochester\.edu)/.test(out)
process.stderr.write(
  `clubs=${roster.length} seats=${seats} advisors=${advisors.length} people=${pseudonymCache.size}\n`,
)
if (leaked) {
  process.stderr.write("REFUSING: a real address survived anonymisation\n")
  process.exit(1)
}
if (roster.length !== ROSTER.length || seats !== ROSTER.reduce((n, c) => n + (c.seats ?? []).length, 0)) {
  process.stderr.write("REFUSING: structure changed during anonymisation\n")
  process.exit(1)
}
