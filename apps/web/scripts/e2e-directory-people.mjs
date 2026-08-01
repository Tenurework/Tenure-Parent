#!/usr/bin/env node
/**
 * Prints the directory people the e2e suite should act on, as JSON.
 *
 * This exists as a separate process rather than an import because Playwright
 * compiles specs to CommonJS, and `roster-source.mjs` is ESM with top-level
 * await — importing it from a spec fails with "Cannot use 'import.meta'
 * outside a module". Resolving the roster is genuinely ESM work (it may load a
 * file named by ROSTER_FILE at runtime), so the fix is to keep it here and
 * hand the answer across as data.
 *
 * The alternative — parsing the roster module with a regex from the spec —
 * would resolve a *different* roster than the one `seed.mjs` used, which is the
 * bug this whole indirection exists to prevent.
 *
 * Usage:  node scripts/e2e-directory-people.mjs
 */
import { ROSTER } from "./roster-source.mjs"

const everyone = ROSTER.flatMap((club) =>
  (club.seats ?? []).flatMap((seat) => [seat.holder, seat.predecessor])
).filter((p) => p?.email && p?.name)

/** How many roster people a directory search for `term` would match. */
const matchCount = (term) =>
  everyone.filter(
    (p) =>
      p.email.toLowerCase().includes(term.toLowerCase()) ||
      p.name.toLowerCase().includes(term.toLowerCase())
  ).length

/**
 * A search term matching this person and nobody else.
 *
 * The specs click `.first()` on the search results, so a term matching two
 * people silently drives the test against the wrong one. The email local part
 * is the most specific handle; fall back to the whole address if even that is
 * shared.
 */
function searchTerm(person) {
  const local = person.email.split("@")[0]
  return matchCount(local) === 1 ? local : person.email
}

const byEmail = new Map()
for (const p of everyone) {
  const key = p.email.toLowerCase()
  if (!byEmail.has(key)) byEmail.set(key, { name: p.name.trim(), email: key })
}

// Sorted, so a reordered roster does not silently change which people a failing
// test was about.
const sorted = [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email))

// The specs build regexes from these names. One containing a regex
// metacharacter would not match itself.
const usable = sorted.filter((p) => !/[\\^$.*+?()[\]{}|]/.test(p.name))

if (usable.length < 2) {
  console.error(
    `The roster yielded ${usable.length} usable directory people; the admin-console transfer test needs two.`
  )
  process.exit(1)
}

const consulting = ROSTER.find((c) => c.slug === "simon-consulting-club")
const withPredecessor = (consulting?.seats ?? []).find((s) => s.predecessor?.name && s.predecessor?.email)

if (!withPredecessor) {
  console.error("No seat on simon-consulting-club has a predecessor; roster.spec.ts needs one.")
  process.exit(1)
}

const person = (p) => ({
  name: p.name.trim(),
  email: p.email.toLowerCase(),
  searchTerm: searchTerm(p),
})

process.stdout.write(
  JSON.stringify(
    {
      assignee: { ...usable[0], searchTerm: searchTerm(usable[0]) },
      transferee: { ...usable[1], searchTerm: searchTerm(usable[1]) },
      consultingPredecessor: person(withPredecessor.predecessor),
    },
    null,
    2
  )
)
