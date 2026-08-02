#!/usr/bin/env node
/**
 * GE-020-001 — who owns what.
 *
 * The execution prompt names fourteen platform domains and asks that module
 * ownership be *defined and enforced*. Defining it is a table; enforcing it is
 * the part that matters, and the enforcement here is deliberately blunt:
 *
 *   * every source file belongs to **exactly one** domain
 *   * a file matching no domain is an orphan and fails
 *   * a file matching two domains is ambiguous and fails
 *
 * An orphan is not a formatting problem. It means code was added that nobody
 * decided the ownership of, which is precisely how a codebase stops having
 * boundaries — one unclaimed file at a time, each individually defensible.
 *
 * ── On the domains that do not exist yet ────────────────────────────────────
 *
 * Four of the fourteen have no code. They are declared with `unbuilt: true` and
 * the item that builds them, rather than omitted. A map showing ten domains
 * would read as a complete map of a ten-domain system; the gap is the useful
 * information.
 *
 * Usage:  node tools/ownership-map.mjs [--check]
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const OUT = 'docs/architecture/ownership.md'

/** Roots the map governs. Everything else is not source. */
const ROOTS = ['apps/web/src', 'apps/system-studio/src', 'packages']

/**
 * The fourteen domains, each owning path prefixes.
 *
 * Order matters: the FIRST domain whose prefix matches wins, and a second match
 * is reported as ambiguity rather than silently resolved. That makes the
 * ordering a decision someone made rather than an accident of iteration.
 */
const DOMAINS = [
  {
    key: 'control-plane',
    what: 'Composing, provisioning and operating tenants. The engine, not any tenant.',
    owns: [
      'apps/system-studio/src/',
      'packages/provisioning/',
      'packages/releases/',
      'apps/web/src/lib/provisioning/',
      'apps/web/src/app/api/platform/',
      'apps/web/src/lib/platform/',
      'apps/web/src/lib/system/',
    ],
  },
  {
    key: 'identity',
    what: 'Who someone is: providers, sessions, the sign-in surface.',
    owns: [
      'apps/web/src/app/api/me/',
      'apps/web/src/types/next-auth.d.ts',

      'apps/web/src/lib/auth.ts',
      // The cell's own identity connections, described as registry records so
      // provider selection goes through the same checks a tenant's will.
      'apps/web/src/lib/auth-connections',
      'apps/web/src/lib/dev-login',
      'apps/web/src/app/api/auth/',
      'apps/web/src/app/signin/',
    ],
  },
  {
    key: 'authorization',
    what: 'What someone may do: capabilities, policy decisions, delegation.',
    owns: [
      'apps/web/src/components/admin/',

      'apps/web/src/lib/authz/',
      'apps/web/src/lib/admin/',
      'apps/web/src/lib/rbac',
      'apps/web/src/lib/delegation.ts',
      'apps/web/src/lib/policies.ts',
      'packages/authorization/',
    ],
  },
  {
    key: 'organization',
    what: 'The org graph: institutions, organizations, roles, seats, the directory.',
    owns: [
      'apps/web/src/components/ClubCard.tsx',
      'apps/web/src/components/ClubImageEditor.tsx',
      'apps/web/src/components/OrgTabs.tsx',
      'apps/web/src/components/ProfileImageEditor.tsx',
      'apps/web/src/components/EmailLink.tsx',
      'apps/web/src/app/api/profile-image/',

      'apps/web/src/lib/org/',
      'apps/web/src/lib/clubs.ts',
      'apps/web/src/lib/directory.ts',
      'apps/web/src/app/(app)/orgs/',
      'apps/web/src/app/api/org-image/',
      'apps/web/src/app/api/admin/directory/',
      'packages/organization-model/',
    ],
  },
  {
    key: 'configuration',
    what: 'Layered configuration, blueprints, module resolution, tenancy scoping.',
    owns: [
      'apps/web/src/middleware.ts',

      'apps/web/src/lib/config/',
      'apps/web/src/lib/tenancy/',
      'apps/web/src/lib/tenant-scope',
      'apps/web/src/lib/tenant-switching',
      'apps/web/src/lib/env',
      // Partition, account, region, environment, cell. The same question
      // `lib/env` answers, at the level the estate cares about.
      'apps/web/src/lib/cell-context',
      'apps/web/src/lib/institution-time.ts',
      'apps/web/src/lib/time',
      'packages/configuration/',
      'packages/platform-config/',
      'packages/module-runtime/',
      'packages/metadata/',
      'packages/contracts/',
      'apps/web/src/lib/envelopes/',
    ],
  },
  {
    key: 'workflow',
    what: 'Approvals, their gates and their state machine.',
    owns: [
      'apps/web/src/lib/workflows/',
      'apps/web/src/lib/commands/',
      'apps/web/src/lib/approvals',
      'apps/web/src/app/(app)/approvals/',
      'packages/workflow/',
    ],
  },
  {
    key: 'files',
    what: 'Documents and attachments: storage, retrieval, editing.',
    owns: [
      'apps/web/src/components/documents/',

      'apps/web/src/lib/s3.ts',
      'apps/web/src/app/api/documents/',
      'apps/web/src/app/api/attachment/',
      'apps/web/src/lib/forms/',
      'apps/web/src/lib/schemas/',
    ],
  },
  {
    key: 'search-memory',
    what: 'Retrieval across everything a principal may already see, and org memory.',
    owns: [
      'apps/web/src/lib/search',
      'apps/web/src/lib/memory',
      'apps/web/src/app/api/search/',
      'apps/web/src/app/(app)/search/',
    ],
  },
  {
    key: 'notifications',
    what: 'Telling someone something happened: in-app notices, calendars, messaging.',
    owns: [
      'apps/web/src/components/calendar/',
      'apps/web/src/components/Calendar',

      'apps/web/src/lib/notify.ts',
      'apps/web/src/lib/outbox/',
      'apps/web/src/lib/messaging',
      'apps/web/src/lib/calendar',
      'apps/web/src/lib/jobs/',
      'apps/web/src/app/api/notifications/',
      'apps/web/src/app/api/calendar/',
      'apps/web/src/app/api/jobs/',
      'apps/web/src/app/(app)/notifications/',
      'apps/web/src/app/(app)/messages/',
      'apps/web/src/app/(app)/calendar/',
      'apps/web/src/app/(app)/feed/',
    ],
  },
  {
    key: 'reporting',
    what: 'Reading the estate back: reports, dashboards, the audit trail.',
    owns: [
      'apps/web/src/components/charts/',

      'apps/web/src/app/(app)/reports/',
      'apps/web/src/app/(app)/dashboard/',
      'apps/web/src/app/api/reports/',
      'packages/audit/',
    ],
  },
  {
    key: 'erp-modules',
    what: 'The domain modules a tenant runs: finance, resources, and the module catalog.',
    owns: [
      'apps/web/src/components/finance/',
      'apps/web/src/components/resources/',
      'apps/web/src/components/ResourcesBrowser.tsx',
      'apps/web/src/components/QuickLinks',

      'apps/web/src/lib/finance',
      'apps/web/src/lib/resources',
      'apps/web/src/app/api/templates/',
      'apps/web/src/app/(app)/resources/',
      'apps/web/src/app/(app)/settings/',
      'apps/web/src/app/(app)/admin/',
    ],
  },

  // ── Not built. Declared so the gap is visible, not so it looks covered. ──
  {
    key: 'relay',
    what: 'Relay by Tenure: multimodal retrieval, drafting and automation.',
    unbuilt: 'GE-090s',
    note:
      'Today there is one direct call to a vendor API in lib/ai.ts, with no gateway, ' +
      'no per-tenant policy, no cost accounting and no prompt audit. That file is owned ' +
      'by `integrations` below until a gateway exists, because that is what it currently is.',
    owns: [],
  },
  {
    key: 'integrations',
    what: 'Outbound connections to anything Tenure does not run.',
    owns: [
      'apps/web/src/components/ai/',
      'apps/web/src/components/DraftAssist.tsx',
'apps/web/src/lib/ai.ts', 'apps/web/src/lib/http/', 'apps/web/src/app/api/ai/'],
  },
  {
    key: 'billing-metering',
    what: 'What a tenant consumes and what it is charged for.',
    // No longer `unbuilt`: the cost half of this domain is real code with real
    // tests. Metering — what a tenant consumes, and charging for it — still is
    // not, and the note says so rather than the marker, because a domain that
    // owns working code and calls itself unbuilt is a claim nobody can check.
    note:
      'Metering does not exist: nothing measures what a tenant consumes and nothing bills ' +
      'for it (GE-160s). Cost allocation does, and is real — packages/finops ' +
      'attributes CUR lines to tenants by resource tag, splits shared spend by a documented ' +
      'driver and reports the rest unallocated — but there is no CUR to read, so no figure ' +
      'has ever been produced from a bill. Per-tenant attribution by tag is a convention ' +
      'rather than a boundary; an account per tenant is what makes it exact, and that needs ' +
      'GE-010. The Studio surface at apps/system-studio/src/app/platform/cost belongs to ' +
      'control-plane, which owns that whole tree — the engine is here, the console is there.',
    owns: ['packages/finops/'],
  },
]

const listFiles = () =>
  ROOTS.flatMap((root) =>
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', `${root}/**`], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean),
  ).filter((f) => /\.(ts|tsx|mjs)$/.test(f))

/**
 * Files that are genuinely cross-cutting, with the reason.
 *
 * Kept tiny on purpose. Every entry here is a file the map cannot describe, and
 * a long list would mean the domains are wrong rather than that the code is
 * unusual.
 */
/**
 * Directories owned by no domain because they are the shell and the design
 * system — the things every domain renders through.
 *
 * A prefix rather than a file list: components/ui/ holds seventeen primitives
 * and will hold more, and enumerating them would make the shared list the
 * largest thing in this file, which would say the domains are wrong.
 */
const SHARED_PREFIXES = [
  'apps/web/src/components/ui/',
  'apps/web/src/components/shell/',
  'apps/web/src/components/brand/',
  'apps/system-studio/src/components/',
  // Accessibility is a property of the design system, not of any one domain.
  // Giving it to a domain would mean the contrast audit belonged to whoever
  // happened to add it, and the next domain would grow its own.
  'apps/web/src/lib/a11y/',
]

const SHARED = new Map([
  ['apps/web/src/instrumentation.ts', 'the boot-time environment check'],
  ['apps/web/src/app/(app)/error.tsx', 'the application error boundary'],
  ['apps/web/src/app/(app)/not-found.tsx', 'the application 404'],
  ['apps/web/src/components/BackButton.tsx', 'a navigation primitive'],
  ['apps/web/src/components/ComingSoon.tsx', 'a placeholder surface for unbuilt modules'],
  ['apps/web/src/components/ThemeSwitcher.tsx', 'a shell control'],
  ['apps/web/src/lib/db.ts', 'the database client itself — owned by no domain because every domain reads through it'],
  ['apps/web/src/app/layout.tsx', 'the root document'],
  ['apps/web/src/app/(app)/layout.tsx', 'the application shell'],
  ['apps/web/src/app/(app)/actions.ts', 'sign-out only'],
  ['apps/web/src/app/page.tsx', 'the root redirect'],
  ['apps/web/src/app/error.tsx', 'the root error boundary'],
  ['apps/web/src/app/not-found.tsx', 'the root 404'],
  ['apps/web/src/app/manifest.ts', 'the PWA manifest'],
  ['apps/web/src/app/apple-icon.tsx', 'the home-screen icon, generated at the document root'],
  ['apps/web/src/app/api/health/route.ts', 'the load-balancer probe — deliberately owned by nothing'],
])

export function classify() {
  const files = listFiles()
  const byDomain = new Map(DOMAINS.map((d) => [d.key, []]))
  const orphans = []
  const ambiguous = []

  for (const file of files) {
    if (SHARED.has(file)) continue
    if (SHARED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue

    const matches = DOMAINS.filter((d) => d.owns.some((prefix) => file.startsWith(prefix)))
    if (matches.length === 0) {
      orphans.push(file)
    } else if (matches.length > 1) {
      ambiguous.push(`${file} — claimed by ${matches.map((m) => m.key).join(' and ')}`)
    } else {
      byDomain.get(matches[0].key).push(file)
    }
  }

  return { files, byDomain, orphans, ambiguous }
}

export { DOMAINS, SHARED, SHARED_PREFIXES }

function render() {
  const { files, byDomain, orphans, ambiguous } = classify()
  const built = DOMAINS.filter((d) => !d.unbuilt)
  const unbuilt = DOMAINS.filter((d) => d.unbuilt)

  return `<!-- Generated by tools/ownership-map.mjs. Do not edit by hand. -->
# Module ownership

GE-020-001. Every source file belongs to exactly one of the fourteen platform
domains, and \`tests/architecture/ownership.test.mjs\` fails the build when one
does not.

**${files.length} files · ${built.length} domains with code · ${unbuilt.length} declared and unbuilt · ${SHARED.size + SHARED_PREFIXES.length} shared.**

An orphan — a file matching no domain — is not a formatting problem. It means
code was added that nobody decided the ownership of, which is how a codebase
stops having boundaries: one unclaimed file at a time, each individually
defensible.

## Domains

| Domain | Files | What it owns |
|---|---:|---|
${built
  .map((d) => `| \`${d.key}\` | ${byDomain.get(d.key).length} | ${d.what} |`)
  .join('\n')}

## Declared, and not built

These have no code. They are listed rather than omitted, because a map showing
${built.length} domains would read as a complete map of a ${built.length}-domain system.

${unbuilt
  .map(
    (d) => `### \`${d.key}\` — ${d.unbuilt}

${d.what}

${d.note}`,
  )
  .join('\n\n')}

## Shared

Files owned by no domain, each with the reason. Kept short on purpose: a long
list here would mean the domains are wrong rather than that the code is unusual.

| Path | Why |
|---|---|
${SHARED_PREFIXES.map((p) => `| \`${p}\` | the shell and the design system — what every domain renders through |`).join('\n')}
${[...SHARED].map(([f, why]) => `| \`${f}\` | ${why} |`).join('\n')}

## Unclaimed

${orphans.length === 0 ? '_None._' : orphans.map((f) => `- \`${f}\``).join('\n')}

## Claimed twice

${ambiguous.length === 0 ? '_None._' : ambiguous.map((a) => `- ${a}`).join('\n')}
`
}

const generated = render()

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (current !== generated) {
    console.error(`::error::${OUT} is stale. Run: node tools/ownership-map.mjs`)
    process.exit(1)
  }
  console.log(`${OUT} is up to date.`)
} else {
  fs.writeFileSync(OUT, generated)
  const { orphans, ambiguous } = classify()
  console.log(
    `Wrote ${OUT} — ${orphans.length} unclaimed, ${ambiguous.length} claimed twice.`,
  )
}
