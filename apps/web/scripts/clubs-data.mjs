/**
 * Simon Business School clubs + board positions.
 * Source of truth: "Clubs and Board Position.xlsx" (Proceed Phase 1).
 * Positions are seats — each gets a permanent position code so knowledge
 * attaches to the job, not the person.
 */

// Pre-existing slugs that must not change (bookmarks, demo data, tests)
const SLUG_OVERRIDES = { "Simon Consulting Club": "consulting-club" }

export function slugify(name) {
  if (SLUG_OVERRIDES[name]) return SLUG_OVERRIDES[name]
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const STOP = new Set(["the", "and", "of", "in", "for", "as", "a"])

export function clubCode(name) {
  const words = name.split(/[^A-Za-z0-9]+/).filter((w) => w && !STOP.has(w.toLowerCase()))
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map((w) => w[0].toUpperCase()).join("").slice(0, 5)
}

export function roleCode(name) {
  // Parenthesized qualifiers (e.g. "(SDAC)") disambiguate twin seats — keep them
  const qualifier = (name.match(/\(([^)]+)\)/)?.[1] ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  const cleaned = name.replace(/\([^)]*\)/g, " ").replace(/[()/]/g, " ").replace(/&/g, " ")
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

/** Permanent, human-readable position ID, e.g. "SCC-PRES". */
export function positionCode(club, role) {
  return `${clubCode(club)}-${roleCode(role)}`
}

// club -> { category, positions[] } (deduped; multi-holder seats appear once)
export const CLUBS = {
  "Latin American Students of Simon": {
    category: "COMMUNITY",
    positions: ["President", "VP Marketing & Communications", "VP Events & Partnerships", "VP Finance & Operations"],
  },
  "Net Impact": {
    category: "PROFESSIONAL",
    positions: ["President", "VP Finance & Operations", "VP Marketing & Communications", "VP Events & Partnerships"],
  },
  "Simon Black Student Alliance": {
    category: "COMMUNITY",
    positions: ["President", "VP Events & Partnerships", "VP Marketing & Communications", "VP Finance & Operations"],
  },
  "Simon Entrepreneurship Association": {
    category: "PROFESSIONAL",
    positions: ["President", "VP Partnerships & Engagement", "VP Events & Communications"],
  },
  "Simon School Venture Fund": {
    category: "ORGANIZATION",
    positions: ["President", "Chief Operating Officer (COO)", "VP of External Partnerships", "VP of Portfolio Management", "VP Deal Sourcing", "VP Deal Execution", "VP of Learning and Development"],
  },
  "Simon Marketing & Analytics Association": {
    category: "PROFESSIONAL",
    positions: ["President (SMA)", "President (SDAC)", "VP Club Strategy (SMA)", "VP Club Strategy (SDAC)", "VP Marketing & Communications", "VP Finance & Operations", "VP Events & Partnerships (SMA)", "VP Events & Partnerships (SDAC)"],
  },
  "Gaming Club": {
    category: "SOCIAL",
    positions: ["President", "VP Marketing & Communications", "VP Events & Partnerships"],
  },
  "Outdoor Adventure Club": {
    category: "SOCIAL",
    positions: ["President", "VP Finance & Operations", "VP Marketing & Communications"],
  },
  "Simon Finance and Investment Club": {
    category: "PROFESSIONAL",
    positions: ["President", "VP Finance & Operations", "VP Events & Partnerships", "VP Marketing & Communications", "Meliora Fund CIO", "Meliora Fund COO"],
  },
  "Uncorked": {
    category: "SOCIAL",
    positions: ["President", "VP Events & Partnerships", "VP Marketing & Communications", "VP Finance & Operations"],
  },
  "Asians in America": {
    category: "COMMUNITY",
    positions: ["President", "VP Marketing & Communications", "VP Finance & Operations", "VP Events & Partnerships"],
  },
  "Graduate Business Council": {
    category: "ORGANIZATION",
    positions: ["President", "VP Academic Affairs & Operations", "VP Community Enrichment", "VP Student Wellbeing & Leadership", "VP Events & Communications", "VP BENET QMC", "Liaison for International Students"],
  },
  "Product Management Club": {
    category: "PROFESSIONAL",
    positions: ["President", "VP Marketing & Communications", "VP Finance & Operations", "VP Events & Partnerships"],
  },
  "Simon Africa Business Club": {
    category: "COMMUNITY",
    positions: ["President", "VP Events & Partnerships", "VP Marketing & Communications", "VP Finance & Operations"],
  },
  "Simon Consulting Club": {
    category: "PROFESSIONAL",
    positions: ["President", "VP Finance & Operations", "VP Events & Partnerships", "VP Casing"],
  },
  "Simon Life Sciences": {
    category: "PROFESSIONAL",
    positions: ["President", "VP Events & Partnerships", "VP Marketing & Communications", "VP Finance & Operations", "VP MD/MBA Liaison"],
  },
  "Simon Pricing Club": {
    category: "PROFESSIONAL",
    positions: ["President", "VP Finance & Operations", "VP Marketing & Communications", "VP Events & Partnerships"],
  },
  "Simon Pride Alliance": {
    category: "COMMUNITY",
    positions: ["President", "VP Marketing & Communications", "VP Events & Partnerships", "VP Finance & Operations"],
  },
  "Simon Says": {
    category: "SOCIAL",
    positions: ["President", "VP Finance & Operations", "VP Marketing & Communications / VP Events & Partnership"],
  },
  "Simon Sports Club": {
    category: "SOCIAL",
    positions: ["President", "VP Finance & Operations", "VP Marketing & Communications", "VP Events & Partnerships"],
  },
  "Simon Vision Consulting": {
    category: "ORGANIZATION",
    positions: ["President", "Managing Director", "Marketing Director", "Engagement Director"],
  },
  "Simon Women in Business": {
    category: "COMMUNITY",
    positions: ["President", "VP Finance & Operations", "VP Marketing & Communications", "VP Events & Partnerships", "VP Men as Allies"],
  },
}
