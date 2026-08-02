#!/usr/bin/env node
/**
 * GE-011-006 — what every long-lived access key was last used for, and when.
 *
 * GE-011-004 moved the read path to OIDC and left a ratchet listing the
 * workflows still on static keys. This is the other half of retiring them, and
 * it is deliberately separate: **surprise-revoking a credential breaks whatever
 * was quietly depending on it**, and the thing quietly depending on it is
 * almost never the thing you were thinking about.
 *
 * So this disables nothing. It reads `iam:GetAccessKeyLastUsed` — which AWS
 * populates from CloudTrail — and produces the evidence a disable decision
 * needs: which key, whose, how old, when it was last used, for which service,
 * from which region. A key with no recorded use is reported as exactly that,
 * because "never used" and "not used since AWS started recording" are different
 * claims and only one of them is safe to act on.
 *
 * Read-only by construction. The three calls it makes are the three the read
 * role is granted, and nothing here mutates.
 *
 * Usage:
 *   node tools/key-last-use.mjs [--json]
 */
import {
  GetAccessKeyLastUsedCommand,
  IAMClient,
  ListAccessKeysCommand,
  ListUsersCommand,
} from "@aws-sdk/client-iam"

const json = process.argv.includes("--json")

/**
 * How old a key is allowed to be before it is worth a look.
 *
 * Ninety days is a convention, not a rule anybody here has agreed — it is the
 * threshold used to SORT the report, not a threshold anything acts on. Acting
 * on a number nobody chose is how a rotation policy becomes an outage.
 */
const ATTENTION_DAYS = 90

const client = new IAMClient({})

/** ISO date → whole days ago, or null when there is no date. */
function daysAgo(value) {
  if (!value) return null
  const then = value instanceof Date ? value.getTime() : Date.parse(value)
  if (Number.isNaN(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

const users = []
let marker

do {
  const page = await client.send(new ListUsersCommand({ Marker: marker }))
  users.push(...(page.Users ?? []))
  marker = page.IsTruncated ? page.Marker : undefined
} while (marker)

const keys = []

for (const user of users) {
  const listed = await client.send(new ListAccessKeysCommand({ UserName: user.UserName }))
  for (const key of listed.AccessKeyMetadata ?? []) {
    const lastUsed = await client.send(
      new GetAccessKeyLastUsedCommand({ AccessKeyId: key.AccessKeyId }),
    )
    const used = lastUsed.AccessKeyLastUsed ?? {}

    keys.push({
      // The id is not a secret — it is the public half, and it is the only way
      // to say WHICH key without the report being unactionable. The secret half
      // is not obtainable through any call here.
      accessKeyId: key.AccessKeyId,
      user: user.UserName,
      status: key.Status,
      createdAt: key.CreateDate?.toISOString?.() ?? String(key.CreateDate ?? ""),
      ageDays: daysAgo(key.CreateDate),
      lastUsedAt: used.LastUsedDate?.toISOString?.() ?? null,
      lastUsedDaysAgo: daysAgo(used.LastUsedDate),
      // `N/A` is what AWS returns when it has no record. Reported as null and
      // described as "no recorded use" rather than "never used": AWS only began
      // recording in 2015 and does not record every service, so the two are
      // different claims and only one is safe to act on.
      lastUsedService: used.ServiceName && used.ServiceName !== "N/A" ? used.ServiceName : null,
      lastUsedRegion: used.Region && used.Region !== "N/A" ? used.Region : null,
    })
  }
}

// Oldest last-use first, and keys with no recorded use first of all — those are
// the ones a disable decision most needs a human to look at, not the ones it
// can most safely act on.
keys.sort((a, b) => {
  if (a.lastUsedDaysAgo === null && b.lastUsedDaysAgo !== null) return -1
  if (b.lastUsedDaysAgo === null && a.lastUsedDaysAgo !== null) return 1
  return (b.lastUsedDaysAgo ?? 0) - (a.lastUsedDaysAgo ?? 0)
})

const report = {
  takenAt: new Date().toISOString(),
  attentionDays: ATTENTION_DAYS,
  users: users.length,
  keys,
  summary: {
    total: keys.length,
    active: keys.filter((k) => k.status === "Active").length,
    noRecordedUse: keys.filter((k) => k.lastUsedDaysAgo === null).length,
    unusedBeyondAttention: keys.filter(
      (k) => k.lastUsedDaysAgo !== null && k.lastUsedDaysAgo > ATTENTION_DAYS,
    ).length,
  },
}

if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`${report.summary.total} key(s) across ${report.users} user(s), taken ${report.takenAt}`)
  console.log(
    `  ${report.summary.active} active · ${report.summary.noRecordedUse} with no recorded use · ` +
      `${report.summary.unusedBeyondAttention} unused beyond ${ATTENTION_DAYS} days\n`,
  )
  for (const k of keys) {
    const last =
      k.lastUsedDaysAgo === null
        ? "no recorded use"
        : `last used ${k.lastUsedDaysAgo}d ago (${k.lastUsedService ?? "?"}/${k.lastUsedRegion ?? "?"})`
    console.log(`  ${k.accessKeyId}  ${k.user}  ${k.status}  age ${k.ageDays}d  ${last}`)
  }
  console.log(
    `\nThis disables nothing. See docs/decisions/KEY-RETIREMENT-CHECKLIST.md for what a` +
      ` disable decision needs before it is safe.`,
  )
}
