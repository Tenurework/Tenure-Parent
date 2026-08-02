import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * Source files are text.
 *
 * Two files reached `main` containing raw NUL bytes, and nothing noticed. They
 * type-checked, they passed 148 tests, and the code was correct — the byte was
 * a separator in a composite map key, written as a literal instead of as the
 * `\u0000` escape:
 *
 *     const bucket = `${layerRank(layer.kind)}<NUL>${key}`
 *
 * What it broke was every tool that decides text-or-binary by looking for a
 * NUL. `git grep` and `rg` skip the file with "Binary file matches" and no
 * result, `git diff` refuses to show a patch, and code review sees "Binary
 * files differ". A file can be perfectly correct and unreviewable at the same
 * time, which is the failure this guard exists for — it was found by accident,
 * when a grep for a function name came back empty on a file that plainly
 * contained it.
 *
 * The separator itself was the right choice and is kept: a space or a dot can
 * occur inside a configuration key, and two different buckets colliding is a
 * real defect. Only the encoding was wrong.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/** Every tracked file git will show a textual diff for. */
function trackedTextFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mjs|cjs|js|jsx|json|css|scss|md|ya?ml|tf|sql|prisma|sh)$/.test(f))
}

test("no source file contains a raw NUL byte", () => {
  const binary = []

  for (const file of trackedTextFiles()) {
    const full = path.join(ROOT, file)
    let bytes
    try {
      bytes = fs.readFileSync(full)
    } catch {
      // Tracked and absent from the working tree — a staged deletion. Not this
      // guard's business.
      continue
    }
    if (bytes.includes(0)) binary.push(file)
  }

  assert.deepEqual(
    binary,
    [],
    `these are tracked as source and contain a NUL byte, so git and ripgrep treat them as binary:\n` +
      binary.map((f) => `  ${f}`).join("\n") +
      `\n\nA NUL in a template literal or string is almost always a separator that ` +
      `should have been written as the escape \\u0000. The code works; the file ` +
      `cannot be diffed, grepped or reviewed.`,
  )
})

test("the guard sees a NUL when there is one", () => {
  // A guard for an invisible property has to be shown failing, or it is
  // indistinguishable from one that reads nothing at all. This writes a real
  // NUL to a temporary file and checks the same test the guard uses.
  const probe = path.join(ROOT, ".nul-probe.tmp")
  try {
    fs.writeFileSync(probe, Buffer.from([0x61, 0x00, 0x62]))
    assert.ok(fs.readFileSync(probe).includes(0), "the detection itself does not work")
  } finally {
    fs.rmSync(probe, { force: true })
  }
})
