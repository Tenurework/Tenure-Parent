#!/usr/bin/env node
/**
 * GE-011-005 — the declared GitHub environments exist, with the protection
 * they are declared to have.
 *
 * `oidc-trust.test.mjs` checks that `environments.json` and `roles.tf` name the
 * same set. It cannot check whether those environments exist, because that is a
 * fact about GitHub rather than about the repository — and the gap between
 * "declared" and "exists" is precisely where this fails silently: a role whose
 * trust names an environment nobody created is a role nothing can assume, and
 * nothing says so until a deploy needs it.
 *
 * Run in CI, where a token exists. Reads only; creates nothing. Creating an
 * environment here would mean the check could never fail, which is the same as
 * not having it.
 *
 * Usage:
 *   GH_TOKEN=… REPO=Tenurework/Tenure-Parent node tools/verify-environments.mjs
 */
import fs from "node:fs"

const DECLARED = "infrastructure/oidc/environments.json"
const repo = process.env.REPO ?? "Tenurework/Tenure-Parent"
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN

if (!token) {
  console.error("::error::no GH_TOKEN — this check needs the API and will not guess")
  process.exit(1)
}

const declared = JSON.parse(fs.readFileSync(DECLARED, "utf8")).environments

const res = await fetch(`https://api.github.com/repos/${repo}/environments`, {
  headers: {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  },
})

if (!res.ok) {
  console.error(`::error::GitHub returned ${res.status} listing environments for ${repo}`)
  process.exit(1)
}

const live = new Map(
  ((await res.json()).environments ?? []).map((e) => [
    e.name,
    (e.protection_rules ?? []).map((r) => r.type),
  ]),
)

const problems = []

for (const env of declared) {
  const rules = live.get(env.name)
  if (!rules) {
    problems.push(
      `${env.name} is declared and does not exist. Nothing can assume the role whose trust names it.`,
    )
    continue
  }
  if (env.requiresReviewers && !rules.includes("required_reviewers")) {
    // The distinction that matters. An environment with no reviewers satisfies
    // the AWS trust condition just as well as one with them — so binding a
    // deploy role to it looks like human approval and is not.
    problems.push(
      `${env.name} exists but carries no required_reviewers rule. ` +
        `Binding a deploy role to it would protect nothing.`,
    )
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`)
  process.exit(1)
}

console.log(
  `${declared.length} declared environment(s) exist with the protection they claim: ` +
    declared.map((e) => `${e.name}${e.requiresReviewers ? " (reviewers)" : ""}`).join(", "),
)
