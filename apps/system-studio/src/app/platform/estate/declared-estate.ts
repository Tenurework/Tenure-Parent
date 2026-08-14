import "server-only"

import fs from "node:fs"
import path from "node:path"

import { parseTerraformDeclarations, unknownDeclaration, type DeclaredEstate, type TerraformFile } from "./estate-coverage"

/**
 * What this platform DECLARES it runs, read from the Terraform that declares
 * it.
 *
 * The estate page's second clause — *does it match what we declared?* — needs a
 * declared side, and there are only two places one could come from. A list
 * typed into this repository would be a second declaration of the same fact,
 * and the two would disagree the first time somebody adds a resource to
 * `infrastructure/terraform/` — at which point the console reports the estate
 * as matching because its own list is short. So the declaration is parsed out
 * of the source of truth, exactly as `lib/aws/expected-alarms.ts` already does
 * for the alarm set.
 *
 * ── A missing file is a normal answer, and it is NOT "nothing is declared" ──
 *
 * The container image ships the application, not the infrastructure. When no
 * `.tf` is reachable this returns `known: false` with a sentence saying where
 * it looked, and every consumer renders that as "this cannot be compared here".
 * The alternative — an empty declaration set — would report every live resource
 * in the account as undeclared drift, which is the loudest false finding this
 * page could possibly produce, on the one surface whose value is being trusted
 * about absences.
 *
 * ── Why it searches upward rather than trusting `process.cwd()` ────────────
 *
 * `process.cwd()` is the repository root under `next dev` from the workspace
 * root, `apps/system-studio` under a workspace-scoped script, and `/app` in the
 * image. Anchoring on any one of those makes the comparison work in exactly one
 * of the three and silently degrade to `known: false` in the others — which is
 * a safe failure, but a needless one that would leave the drift table blank in
 * the environment an operator most often runs the console from.
 */

/** Where the estate is declared. Repository-relative. */
const SOURCE_DIRECTORIES = ["infrastructure/terraform", "infrastructure/studio"] as const

/** How far up to look for the repository root before giving up. */
const MAX_ASCENT = 6

/**
 * Cached for the life of the process.
 *
 * The files do not change under a running container, and re-reading two
 * directories of Terraform on every render of a page an operator refreshes
 * during an incident is I/O bought for nothing.
 */
let cached: DeclaredEstate | null = null

export function declaredEstate(from: string = process.cwd()): DeclaredEstate {
  if (cached) return cached
  cached = readDeclaredEstate(from)
  return cached
}

function readDeclaredEstate(from: string): DeclaredEstate {
  const searched: string[] = []
  let directory = path.resolve(from)

  for (let ascent = 0; ascent <= MAX_ASCENT; ascent += 1) {
    const files = collect(directory)
    searched.push(directory)
    if (files.length > 0) return parseTerraformDeclarations(files)

    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  return unknownDeclaration(
    "No Terraform source was reachable from this process, so what is running cannot be compared against " +
      `what was declared. ${SOURCE_DIRECTORIES.join(" and ")} were looked for in ${searched.length} ` +
      "directory(ies) from the working directory upwards. This is the normal case in the deployed " +
      "container, which ships the application and not the infrastructure that provisions it — it is not " +
      "a statement that nothing is declared.",
  )
}

/** Every `.tf` under the declared directories of one candidate root. */
function collect(root: string): readonly TerraformFile[] {
  const files: TerraformFile[] = []

  for (const relative of SOURCE_DIRECTORIES) {
    const directory = path.join(root, relative)
    let entries: string[]
    try {
      entries = fs.readdirSync(directory)
    } catch {
      // Absent is the expected case for every candidate root but one, and for
      // every root in the deployed image. Not an error.
      continue
    }

    for (const entry of entries.sort()) {
      if (!entry.endsWith(".tf")) continue
      const full = path.join(directory, entry)
      try {
        files.push({ path: `${relative}/${entry}`, text: fs.readFileSync(full, "utf8") })
      } catch {
        // A file that listed and then would not read is one declaration this
        // process cannot see. Skipping it is right; the count of files read is
        // rendered beside the verdict, so the omission is visible.
        continue
      }
    }
  }

  return files
}

/** For tests, which need the next call to look at the filesystem again. */
export function __resetDeclaredEstate(): void {
  cached = null
}
