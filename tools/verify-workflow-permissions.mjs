#!/usr/bin/env node
/**
 * GE-011-007 — the repository's default workflow permission is read-only.
 *
 * Ten workflows declare no `permissions:` block and inherit this default.
 * `workflow-drift.test.mjs` ratchets that count down; it cannot check what the
 * default IS, because that is a setting in a web form and no file in the
 * repository records it. Flip it to "read and write" and every one of those ten
 * silently gains the ability to push to the repository — with no diff, no
 * review, and nothing in CI to notice.
 *
 * So this is the drift check for a value that lives outside the repository.
 * Read-only; it reports and does not correct, because a check that fixes what
 * it finds can never fail.
 *
 * Usage:
 *   GH_TOKEN=… REPO=satvikOS/Tenure-Parent node tools/verify-workflow-permissions.mjs
 */
const repo = process.env.REPO ?? "satvikOS/Tenure-Parent"
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN

if (!token) {
  console.error("::error::no GH_TOKEN — this check needs the API and will not guess")
  process.exit(1)
}

const res = await fetch(`https://api.github.com/repos/${repo}/actions/permissions/workflow`, {
  headers: {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  },
})

if (!res.ok) {
  console.error(`::error::GitHub returned ${res.status} reading workflow permissions for ${repo}`)
  process.exit(1)
}

const { default_workflow_permissions: perms, can_approve_pull_request_reviews: canApprove } =
  await res.json()

const problems = []

if (perms !== "read") {
  problems.push(
    `default_workflow_permissions is "${perms}", not "read". ` +
      `Every workflow with no permissions block just gained write access to the repository.`,
  )
}

if (canApprove) {
  // A workflow that can approve a pull request can approve its own — which
  // turns a required review into a formality.
  problems.push(
    "GITHUB_TOKEN can approve pull request reviews. A workflow that can approve " +
      "a pull request can approve one that changes it.",
  )
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`)
  console.error(
    "::error::Fix at Settings → Actions → General → Workflow permissions, " +
      "or with: gh api --method PUT repos/" +
      repo +
      "/actions/permissions/workflow -F default_workflow_permissions=read -F can_approve_pull_request_reviews=false",
  )
  process.exit(1)
}

console.log(`${repo}: default workflow permission is read-only, and workflows cannot approve reviews`)
