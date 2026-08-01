/**
 * Generates scripts/roster-data.mjs from the Ainslie OSE spreadsheets.
 *
 *   node scripts/generate-roster.mjs
 *
 * Sources (<monorepo-root>/Tier1/):
 *   2026.2027 Club Org Student Leadership 7.17.xlsx  — current boards
 *   2025.2026 Club Org Student Leadership.xlsx       — predecessors
 *
 * Tier1/ is institutional source data and stays at the monorepo root, not
 * inside apps/web. Both the reads and the write below are resolved against this
 * module's own URL rather than process.cwd(), so the generator works from any
 * directory — a cwd-relative write in particular would silently create a stray
 * <root>/scripts/roster-data.mjs and report success while the real file went
 * untouched.
 *
 * The generated file is committed so the container seed never needs the
 * spreadsheets. Re-run this whenever OSE publishes an updated roster.
 */
import XLSX from "xlsx"
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { CLUBS as LEGACY_CLUBS, slugify as legacySlugify } from "./clubs-data.mjs"

// apps/web/scripts/ -> ../../../ is the monorepo root
const tier1 = (name) => fileURLToPath(new URL(`../../../Tier1/${name}`, import.meta.url))

const CURRENT_FILE = tier1("2026.2027 Club Org Student Leadership 7.17.xlsx")
const PRIOR_FILE = tier1("2025.2026 Club Org Student Leadership.xlsx")
const CURRENT_TERM = "2026-2027"
const PRIOR_TERM = "2025-2026"

const SHEETS = [
  ["Professional Clubs", "PROFESSIONAL"],
  ["Community Enrichment Clubs", "COMMUNITY"],
  ["Social Clubs", "SOCIAL"],
  ["Organizations", "ORGANIZATION"],
]

// The spreadsheet misspells this club; the official Transition Process deck
// spells it correctly. Don't propagate a typo into the system of record.
const NAME_CORRECTIONS = {
  "Simon Entreprenuership Association": "Simon Entrepreneurship Association",
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim()
const lower = (v) => clean(v).toLowerCase()

/** "Simon Consulting Club (SCC)" -> "SCC" */
function acronymOf(name) {
  const hits = [...name.matchAll(/\(([A-Za-z]{2,6})\)/g)].map((m) => m[1])
  return hits.length === 1 ? hits[0].toUpperCase() : null
}

/** Display name without the parenthetical acronym. */
function shortNameOf(name) {
  return clean(name.replace(/\(([A-Za-z]{2,6})\)/g, " "))
}

function readSheet(file, sheet) {
  const wb = XLSX.readFile(file)
  if (!wb.Sheets[sheet]) return null
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" })
}

/**
 * Walks a category sheet. A non-empty first column starts a new club block,
 * except for "Board formed ..." which is a second line of the club-name cell
 * (a note on the preceding club, not a new club).
 */
function parseSheet(rows, { advisorNameCol, advisorEmailCol, notesCol }) {
  const clubs = []
  let current = null

  for (const row of rows.slice(1)) {
    const first = clean(row[0])
    const position = clean(row[1])
    const student = clean(row[2])
    const email = clean(row[3])
    const notes = notesCol != null ? clean(row[notesCol]) : ""
    const advisorName = advisorNameCol != null ? clean(row[advisorNameCol]) : ""
    const advisorEmail = advisorEmailCol != null ? clean(row[advisorEmailCol]) : ""

    if (first && !/^board formed/i.test(first)) {
      current = { rawName: first, note: "", seats: [], advisors: [] }
      clubs.push(current)
    } else if (first && current) {
      current.note = first // "Board formed Fall 2026"
    }
    if (!current) continue

    if (advisorName || advisorEmail) {
      current.advisors.push({ name: advisorName, email: advisorEmail })
    }
    if (position) {
      current.seats.push({ position, student, email, notes })
    }
  }

  return clubs
}

function parseWorkbook(file, layout) {
  const out = []
  for (const [sheet, category] of SHEETS) {
    const rows = readSheet(file, sheet)
    if (!rows) continue
    const isOrgSheet = sheet === "Organizations"
    const parsed = parseSheet(rows, isOrgSheet ? layout.orgs : layout.standard)
    for (const club of parsed) out.push({ ...club, category })
  }
  return out
}

// ── Advisor master list (canonical emails, incl. ones missing from the
//    Organizations sheet which has no advisor-email column) ──────────────────
function parseAdvisorMaster(file) {
  const rows = readSheet(file, "Board Advisors No Duplicates") ?? []
  const byName = new Map()
  for (const row of rows.slice(1)) {
    const name = clean(row[0])
    const email = clean(row[1])
    if (name && email) byName.set(lower(name), email)
  }
  return byName
}

/** "Jordan Avery (Ainslie OSE)" -> { name, affiliation }. Invented example: a
 *  real advisor's name in a comment is a real advisor's name in a public repo. */
function splitAdvisor(raw) {
  const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  return m
    ? { name: clean(m[1]), affiliation: clean(m[2]) }
    : { name: clean(raw), affiliation: null }
}

// ── Position identity ────────────────────────────────────────────────────────
const STOP = new Set(["the", "and", "of", "in", "for", "as", "a"])

function significantWords(name) {
  return shortNameOf(name)
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()))
}

function baseClubCode(name) {
  const acr = acronymOf(name)
  if (acr) return acr
  const words = significantWords(name)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map((w) => w[0].toUpperCase()).join("").slice(0, 5)
}

/**
 * Club codes must be globally unique — they prefix positionCode, which is a
 * unique key. Initials alone collide ("Simon Says" and "Simon Sports" are both
 * SS), so colliding clubs fall back to a syllable code (SIMSAY / SIMSPO).
 */
function buildClubCodes(names) {
  const byBase = new Map()
  for (const name of names) {
    const base = baseClubCode(name)
    byBase.set(base, [...(byBase.get(base) ?? []), name])
  }

  const codes = new Map()
  const taken = new Set()
  for (const [base, group] of byBase) {
    if (group.length === 1) {
      codes.set(group[0], base)
      taken.add(base)
      continue
    }
    for (const name of group) {
      const syllables = significantWords(name)
        .map((w) => w.slice(0, 3).toUpperCase())
        .join("")
        .slice(0, 8)
      let code = syllables
      let n = 2
      while (taken.has(code)) code = `${syllables}${n++}`
      codes.set(name, code)
      taken.add(code)
    }
  }
  return codes
}

function roleCode(name) {
  const qualifier = (name.match(/\(([^)]+)\)/)?.[1] ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
  const cleaned = name
    .replace(/\([^)]*\)/g, " ")
    .replace(/[()/]/g, " ")
    .replace(/&/g, " ")
  const words = cleaned.split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase()))
  const parts = words.slice(0, 3).map((w) => {
    const u = w.toUpperCase()
    if (u === "PRESIDENT") return "PRES"
    if (u === "VP" || u.length <= 4) return u
    return u.slice(0, 4)
  })
  if (qualifier) parts.push(qualifier)
  return parts.join("-")
}

/**
 * Splits a spreadsheet position into a title and a note.
 *
 * Short parentheticals disambiguate twin seats and belong in the title
 * ("President (SMA)" vs "President (SDAC)"). Long ones are editorial notes
 * ("President (Interim oversee marketing and Comms)") and must come out: they
 * produce garbage position codes, and leaving them in stops the title from
 * reading as "President" for role detection.
 */
function splitPosition(raw) {
  let note = null
  const title = clean(
    raw.replace(/\(([^)]*)\)/g, (match, inner) => {
      const text = clean(inner)
      if (text.length <= 6 && /^[A-Za-z0-9 ]+$/.test(text)) return match
      note = note ? `${note}; ${text}` : text
      return " "
    })
  )
  return { title: title || clean(raw), note }
}

// Placeholders that appear in the holder column but are not people.
const NOT_A_PERSON = /^(none|n\/?a|tbd|tba|vacant|open|-|—)$/i

/** Normalized key for matching the same seat across years. */
export function positionKey(position) {
  return lower(position)
    .replace(/&/g, "and")
    .replace(/\bvp\b/g, "vp")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bof\b|\bthe\b|\bfor\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Keep URLs readable where the official name is unwieldy.
const SLUG_OVERRIDES = {
  "Simon Marketing Association (SMA) & Simon Data Analytics Club (SDAC)":
    "simon-marketing-and-data-analytics",
  "Consortium for Graduate Study in Management (CGSM)": "cgsm",
}

function slugify(name) {
  if (SLUG_OVERRIDES[name]) return SLUG_OVERRIDES[name]
  return shortNameOf(name)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Token-overlap match so legacy slugs survive the rename. */
function matchKey(name) {
  return new Set(
    shortNameOf(name)
      .toLowerCase()
      .replace(/&/g, " and ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !STOP.has(w) && w !== "simon" && w !== "club" && w !== "association")
  )
}

/**
 * Assigns each legacy slug to at most one new club, best match wins.
 *
 * Greedy global assignment rather than per-club search: "Simon Consulting
 * Club" and "Simon VISION Consulting" both match the legacy "Simon Consulting
 * Club" strongly, and letting both claim its slug would collide two clubs onto
 * one row.
 */
function assignLegacySlugs(newNames) {
  const pairs = []
  for (const newName of newNames) {
    const target = matchKey(newName)
    for (const legacyName of Object.keys(LEGACY_CLUBS)) {
      const tokens = matchKey(legacyName)
      let shared = 0
      for (const t of tokens) if (target.has(t)) shared++
      if (!shared) continue
      const score = shared / Math.max(1, Math.min(tokens.size, target.size))
      // Tie-break toward the closer-sized name so "Simon Consulting Club"
      // beats "Simon VISION Consulting" for the legacy consulting slug.
      const penalty = Math.abs(tokens.size - target.size) * 0.01
      if (score >= 0.6) pairs.push({ newName, legacyName, score: score - penalty })
    }
  }
  pairs.sort((a, b) => b.score - a.score)

  const byNew = new Map()
  const claimed = new Set()
  for (const p of pairs) {
    if (byNew.has(p.newName) || claimed.has(p.legacyName)) continue
    byNew.set(p.newName, legacySlugify(p.legacyName))
    claimed.add(p.legacyName)
  }
  return byNew
}

// ── Build ────────────────────────────────────────────────────────────────────
const advisorMaster = parseAdvisorMaster(CURRENT_FILE)

const currentClubs = parseWorkbook(CURRENT_FILE, {
  standard: { advisorNameCol: 5, advisorEmailCol: 6, notesCol: 4 },
  orgs: { advisorNameCol: 4, advisorEmailCol: null, notesCol: null },
})

const priorClubs = parseWorkbook(PRIOR_FILE, {
  standard: { advisorNameCol: 4, advisorEmailCol: null, notesCol: null },
  orgs: { advisorNameCol: 4, advisorEmailCol: null, notesCol: null },
})

// Predecessors keyed by club match-key + position key
const priorByClub = new Map()
for (const club of priorClubs) {
  const key = [...matchKey(club.rawName)].sort().join("-")
  const seats = priorByClub.get(key) ?? new Map()
  for (const seat of club.seats) {
    if (!seat.student || NOT_A_PERSON.test(seat.student)) continue
    const pk = positionKey(splitPosition(seat.position).title)
    const list = seats.get(pk) ?? []
    list.push({ name: seat.student, email: seat.email.toLowerCase(), position: seat.position })
    seats.set(pk, list)
  }
  priorByClub.set(key, seats)
}

const legacySlugByName = assignLegacySlugs(
  currentClubs.map((c) => NAME_CORRECTIONS[c.rawName] ?? c.rawName)
)

const clubCodes = buildClubCodes(
  currentClubs.map((c) => clean(NAME_CORRECTIONS[c.rawName] ?? c.rawName))
)
const clubCode = (name) => clubCodes.get(name) ?? baseClubCode(name)

const advisors = new Map() // email -> { name, affiliation, email }
const clubs = []

for (const club of currentClubs) {
  const rawName = NAME_CORRECTIONS[club.rawName] ?? club.rawName
  const name = clean(rawName)
  const slug = slugify(name)
  const legacySlug = legacySlugByName.get(name) ?? null
  const priorSeats = priorByClub.get([...matchKey(name)].sort().join("-")) ?? new Map()

  // Advisors: dedupe per club, fill missing emails from the master list
  const clubAdvisors = []
  const seenAdvisor = new Set()
  for (const raw of club.advisors) {
    const { name: aName, affiliation } = splitAdvisor(raw.name)
    if (!aName) continue
    const email = (raw.email || advisorMaster.get(lower(raw.name)) || "").toLowerCase()
    if (!email) continue
    if (seenAdvisor.has(email)) continue
    seenAdvisor.add(email)
    clubAdvisors.push({ name: aName, email, affiliation })
    if (!advisors.has(email)) advisors.set(email, { name: aName, email, affiliation })
  }

  // Seats: number parallel duplicates ("Associate PM" x4 -> 1..4)
  const parsedSeats = club.seats.map((seat) => ({ ...seat, ...splitPosition(seat.position) }))

  const counts = new Map()
  for (const seat of parsedSeats) {
    counts.set(seat.title, (counts.get(seat.title) ?? 0) + 1)
  }
  const running = new Map()
  const seats = []
  for (const seat of parsedSeats) {
    const total = counts.get(seat.title)
    const n = (running.get(seat.title) ?? 0) + 1
    running.set(seat.title, n)

    const displayName = total > 1 ? `${seat.title} ${n}` : seat.title
    const code = `${clubCode(name)}-${roleCode(seat.title)}${total > 1 ? `-${n}` : ""}`
    const pk = positionKey(seat.title)

    // Predecessor: nth holder of the same seat last year, if there was one
    const priorList = priorSeats.get(pk) ?? []
    const predecessor = priorList[Math.min(n - 1, priorList.length - 1)] ?? null

    const hasHolder = seat.student && seat.email && !NOT_A_PERSON.test(seat.student)

    seats.push({
      name: displayName,
      basePosition: seat.title,
      positionNote: seat.note,
      positionCode: code,
      holder: hasHolder
        ? { name: seat.student, email: seat.email.toLowerCase() }
        : null,
      vacancyNote: hasHolder ? "" : seat.notes,
      predecessor: predecessor
        ? { name: predecessor.name, email: predecessor.email, term: PRIOR_TERM }
        : null,
    })
  }

  clubs.push({
    name,
    shortName: shortNameOf(name),
    acronym: acronymOf(name),
    // Globally unique prefix for this club's position codes
    code: clubCode(name),
    slug,
    legacySlug: legacySlug && legacySlug !== slug ? legacySlug : null,
    category: club.category,
    note: club.note || null,
    advisors: clubAdvisors,
    seats,
  })
}

// ── Emit ─────────────────────────────────────────────────────────────────────
const totals = {
  clubs: clubs.length,
  seats: clubs.reduce((n, c) => n + c.seats.length, 0),
  filled: clubs.reduce((n, c) => n + c.seats.filter((s) => s.holder).length, 0),
  vacant: clubs.reduce((n, c) => n + c.seats.filter((s) => !s.holder).length, 0),
  withPredecessor: clubs.reduce((n, c) => n + c.seats.filter((s) => s.predecessor).length, 0),
  advisors: advisors.size,
}

const banner = `/**
 * GENERATED by scripts/generate-roster.mjs — do not edit by hand.
 * Source: "${CURRENT_FILE}" (current) + "${PRIOR_FILE}" (predecessors).
 *
 * ${totals.clubs} clubs · ${totals.seats} seats · ${totals.filled} filled ·
 * ${totals.vacant} vacant · ${totals.withPredecessor} with a predecessor ·
 * ${totals.advisors} advisors.
 *
 * Board members are directory records, NOT login accounts: seeding the real
 * roster as users would let anyone impersonate them while dev sign-in is on.
 */
export const CURRENT_TERM = ${JSON.stringify(CURRENT_TERM)}
export const PRIOR_TERM = ${JSON.stringify(PRIOR_TERM)}
export const VACANT_LABEL = "Vacant Position"

export const ADVISORS = ${JSON.stringify([...advisors.values()], null, 2)}

export const ROSTER = ${JSON.stringify(clubs, null, 2)}
`

writeFileSync(new URL("./roster-data.mjs", import.meta.url), banner)

console.log("Wrote apps/web/scripts/roster-data.mjs")
console.table(totals)

const legacySlugSet = new Set(Object.keys(LEGACY_CLUBS).map((n) => legacySlugify(n)))
const unmatched = [...legacySlugSet].filter(
  (s) => !clubs.some((c) => c.slug === s || c.legacySlug === s)
)
for (const c of clubs) {
  console.log(
    `  ${c.slug.padEnd(34)} ${String(c.category).padEnd(13)} seats=${String(c.seats.length).padStart(2)}` +
      ` filled=${String(c.seats.filter((s) => s.holder).length).padStart(2)}` +
      ` adv=${String(c.advisors.length).padStart(2)}  ` +
      (c.legacySlug
        ? `RENAMED from ${c.legacySlug}`
        : legacySlugSet.has(c.slug)
          ? "unchanged"
          : "NEW club")
  )
}

if (unmatched.length) {
  console.log(
    `\n⚠ ${unmatched.length} existing club(s) are absent from the 2026-2027 roster ` +
      `and will be archived, not deleted:\n   ${unmatched.join("\n   ")}`
  )
}
