/**
 * Directory people for tests, taken from whichever roster seeded the database.
 *
 * These tests used to name two real students. That broke the moment the real
 * roster stopped being committed — correctly, because the assertion was on a
 * person rather than on the behaviour, and CI now seeds from the synthetic
 * fixture. Hardcoding the *fixture's* names instead would have the same defect
 * pointed the other way: it would fail on a machine that does have the real
 * roster.
 *
 * The answer comes from `scripts/e2e-directory-people.mjs`, which resolves the
 * roster through the same module `seed.mjs` reads. It runs as a child process
 * because Playwright compiles specs to CommonJS and that module is ESM with
 * top-level await; see the comment at the top of the script.
 */
import { execFileSync } from "node:child_process"
import path from "node:path"

export type DirectoryPerson = {
  /** As rendered in the UI. */
  name: string
  email: string
  /** What to type into the directory search box to find exactly this person. */
  searchTerm: string
}

type DirectoryPeople = {
  assignee: DirectoryPerson
  transferee: DirectoryPerson
  consultingPredecessor: DirectoryPerson
}

function load(): DirectoryPeople {
  // Relative to this file, so the suite works whatever the working directory is.
  const script = path.resolve(__dirname, "../../scripts/e2e-directory-people.mjs")
  try {
    const out = execFileSync("node", [script], { encoding: "utf8" })

    // `roster-source.mjs` announces which roster it resolved on stdout, and
    // that line is worth keeping — it is how you tell a synthetic run from a
    // real one. So take the JSON rather than assuming it is alone.
    const start = out.indexOf("{")
    if (start === -1) throw new Error(`no JSON in output:\n${out}`)
    return JSON.parse(out.slice(start))
  } catch (err) {
    // stderr carries the script's own diagnosis — an empty roster, or one with
    // no predecessor. Losing it here would turn a clear message into "exit 1".
    const detail = (err as { stderr?: string }).stderr?.trim()
    throw new Error(
      `Could not resolve directory people for the e2e suite.\n${detail || String(err)}`
    )
  }
}

const people = load()

/** Assigned to a seat first. */
export const ASSIGNEE = people.assignee
/** The seat is then transferred to this person. */
export const TRANSFEREE = people.transferee
/**
 * The previous holder of a seat on the consulting club, for the roster page's
 * "Previously held by" assertion.
 */
export const CONSULTING_PREDECESSOR = people.consultingPredecessor
