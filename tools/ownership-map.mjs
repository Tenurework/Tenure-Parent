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
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// TTES-000-001. The experience list is declared once, in the entry-point
// inventory, and read here. Two copies of "which app is the deployer console"
// is how the two documents would eventually disagree about it — and the whole
// point of both is that they cannot.
import { EXPERIENCES } from './entry-point-inventory.mjs'

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
      // GE-040-001. The canonical model — a durable person, effective-dated
      // memberships, and the rule that no status change is expressible without
      // its audit record.
      'packages/identity/',
      'apps/web/src/lib/identity/',
      'apps/web/src/app/api/me/',
      'apps/web/src/types/next-auth.d.ts',

      'apps/web/src/lib/auth.ts',
      'apps/web/src/lib/auth-session-lifetime.test.ts',
      // IER-040-004/005. What a roster workbook has to be before a parser sees
      // it: configured formats only, no macros or active content, and file,
      // sheet, row, column, cell and decompression limits enforced. It sits with
      // identity because a roster is how this product learns who someone is —
      // the admission check is the first gate on that, not a general file
      // utility. The prefix covers `__fixtures__/`, which holds a ZIP writer
      // deliberately able to lie so the decompression limit can be proven.
      'apps/web/src/lib/ingestion/',
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
      // TTES-030-001's club-record anatomy. It composes `OrgTabs` above and is
      // rendered by the six `orgs/[slug]/*` surfaces, all of which this domain
      // already owns — the org graph is what it renders the identity of.
      'apps/web/src/components/OrgRecordHeader.tsx',
      'apps/web/src/components/ProfileImageEditor.tsx',
      'apps/web/src/components/EmailLink.tsx',
      'apps/web/src/app/api/profile-image/',

      'apps/web/src/lib/org/',
      // HCM-040-003. The seat-memory boundary: what a successor inherits from a
      // seat and what stays with the person who held it. It belongs to the org
      // graph for the same reason `seat-is-not-a-role.itest.ts` does — the claim
      // it enforces is about seats and succession, not about tenancy or privacy
      // machinery in general.
      'apps/web/src/lib/people/',
      'apps/web/src/lib/clubs.ts',
      // GE-050-002. Proves the seat/role split against a real database, which
      // is an organization-graph claim rather than a tenancy one.
      'apps/web/src/lib/seat-is-not-a-role.itest.ts',
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
      // Which AWS services the running partition actually offers. It answers a
      // question only cellContext() can raise, so it belongs beside it.
      'apps/web/src/lib/partition-services',
      // Prefix, not the exact file: `institution-time.test.ts` proves the
      // React.cache() tenant-key invariant (REVIEW-FINDINGS.md:54) and belongs
      // to the same domain as the loader it is about.
      'apps/web/src/lib/institution-time',
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
      // The digest an approval is notified with. `lib/approvals` above is a
      // prefix that catches `approvals.ts` and `approvals-sla.ts`, but not this
      // file, whose name breaks the pattern at the hyphen.
      'apps/web/src/lib/approval-digest.itest.ts',
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
      'apps/web/src/lib/s3.test.ts',
      'apps/web/src/app/api/documents/',
      'apps/web/src/app/api/attachment/',
      // Images are attachments with a different viewer. The gallery reads the
      // same storage this domain owns.
      'apps/web/src/app/(app)/gallery/',
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
      'apps/web/src/lib/notify.test.ts',
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
      // TTES-030-001's work inbox. It genuinely straddles: it merges approvals
      // and exceptions (`workflow`) with mentions and due items (here). It falls
      // to this domain because what it does is deliver awareness of what needs
      // attention — it decides no gate and advances no state machine, it orders
      // and buckets for presentation, which is `(app)/feed/` above with a
      // deadline. The prefix, not the file: `work-inbox.ts` has a sibling test
      // and the route it names as its production caller does not exist yet.
      'apps/web/src/lib/inbox/',
      'apps/web/src/app/(app)/inbox/',
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
      // ANL-000-002. The semantic half of the same subsystem: metric
      // definitions the reports page, the dashboard, the admin overview and
      // the pulse endpoint all agree on, so none of them defines its own.
      'apps/web/src/lib/analytics/',
      'packages/audit/',
      // The cell-side half of the same subsystem: the append-only extension
      // on the shared client, and the validated record builder it enforces.
      'apps/web/src/lib/audit-append-only',
      'apps/web/src/lib/audit-record',
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
      // PLN-030-001. Planning arithmetic — spreading, allocation and
      // top-down/bottom-up reconciliation. Beside finance rather than inside it:
      // finance records what happened, planning distributes what is intended,
      // and `docs/architecture/pln-planning-limitations.md` §2 is the record of
      // how far apart those two are here.
      'apps/web/src/lib/planning/',
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
'apps/web/src/lib/ai.ts', 'apps/web/src/lib/http/', 'apps/web/src/app/api/ai/',
      // Matching is by prefix and `…/ai.ts` does not prefix `…/ai.test.ts`, so
      // the vendor call's own test had to be named or it was an orphan.
      'apps/web/src/lib/ai.test.ts',
      // The tools an assistant may invoke, and who may invoke them. Here rather
      // than under `authorization` because the domain question this answers is
      // "what may we hand to a model vendor", which is this domain's whole
      // subject — the authorization engine it calls is owned where it lives.
      'apps/web/src/lib/relay-tools.ts',
      'apps/web/src/lib/relay-tools.test.ts',
      // What may be projected to a model vendor and where the assistant's
      // surface stops — the same question as `relay-tools.ts` above, asked of
      // the payload rather than of the tool.
      'apps/web/src/lib/relay/',
      // Whether a capability is connected, and the card shown when it is not.
      // This domain's subject exactly: a connection to something Tenure does
      // not run.
      'apps/web/src/lib/connections/',
      'apps/web/src/components/connections/',
      // WRK-030-002. Where a connection opportunity is opened — the POST target
      // the card above submits to. It belongs beside the library and the card
      // rather than under whichever domain happens to own `app/api/`, because
      // all three answer one question: what happens when a capability this
      // platform does not run is not connected.
      'apps/web/src/app/api/connections/',
    ],
  },
  {
    key: 'billing-metering',
    what: 'What a tenant consumes and what it is charged for.',
    // No longer `unbuilt`: the cost half of this domain is real code with real
    // tests. Metering — what a tenant consumes, and charging for it — still is
    // not, and the note says so rather than the marker, because a domain that
    // owns working code and calls itself unbuilt is a claim nobody can check.
    note:
      'Metering has started and billing has not. WRK-120-004 landed the first real meter: ' +
      'apps/web/src/lib/metering records one row per model call from the vendor\'s own reported ' +
      'token counts and refuses a call whose tenant is over its published ceiling. That is ONE ' +
      'kind of consumption — model tokens — measured in tokens rather than dollars, and nothing ' +
      'bills for it (GE-160s). This note used to read "metering does not exist", which stopped ' +
      'being true the moment that directory was added and would have gone on reading that way ' +
      'because nothing checks a prose note. Cost allocation is real — packages/finops ' +
      'attributes CUR lines to tenants by resource tag, splits shared spend by a documented ' +
      'driver and reports the rest unallocated — but there is no CUR to read, so no figure ' +
      'has ever been produced from a bill. Per-tenant attribution by tag is a convention ' +
      'rather than a boundary; an account per tenant is what makes it exact, and that needs ' +
      'GE-010. The Studio surface at apps/system-studio/src/app/platform/cost belongs to ' +
      'control-plane, which owns that whole tree — the engine is here, the console is there.',
    owns: [
      'packages/finops/',
      // WRK-120-004. What a tenant consumes, measured: one row per model call
      // carrying the vendor's own token counts, and the ceiling that refuses
      // the next one. This domain's subject exactly, and it is here rather than
      // under `integrations` — which owns the vendor CALL in lib/ai.ts —
      // because the question it answers is "how much did this tenant use",
      // not "what may we hand to a vendor".
      'apps/web/src/lib/metering/',
      // The provider-neutral payments kernel: charge model, eligibility,
      // capability registry, pinned API version, balance transactions. Quoting
      // and control-plane only — NEXT-SESSION §0.3 forbids money movement, and
      // nothing here moves any.
      'packages/payments/',
      // Money leaving or arriving: how a ledger entry is attributed, and the
      // provider's own event feed. Here rather than under `erp-modules` because
      // what these decide is what a tenant is charged and by whom, which is
      // this domain's subject; the budget the charge lands against is not.
      'apps/web/src/lib/payments/',
      'apps/web/src/app/api/payments/',
    ],
  },
]

const listFiles = () =>
  ROOTS.flatMap((root) =>
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', `${root}/**`], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean),
  ).filter((f) => /\.(ts|tsx|mjs|css)$/.test(f))

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
  // `apps/system-studio/src/components/` USED TO BE HERE, and the line was
  // false (TTES-000-001). Those six files — the command palette, the nav, the
  // offline banner, the preferences menu, the state components — are not "what
  // every domain renders through". Nothing outside the operator console imports
  // one; they cannot be imported from `apps/web` at all, since the two apps are
  // deliberately separate origins (PD-007), and they are styled from a
  // stylesheet that shares nine token names with the product's and disagrees
  // with it on four of them. They belong to `control-plane`, which already owns
  // `apps/system-studio/src/`, and now fall there.
  //
  // The distinction the old line elided is exactly the one the experience
  // section below draws: shared BY DOMAIN (every domain renders through it)
  // versus shared BY EXPERIENCE (both audiences see it). This was the second.
  //
  // Accessibility is a property of the design system, not of any one domain.
  // Giving it to a domain would mean the contrast audit belonged to whoever
  // happened to add it, and the next domain would grow its own.
  'apps/web/src/lib/a11y/',
]

/**
 * TTES-000-001 — which AUDIENCE a source file is rendered to.
 *
 * A second axis, not a replacement for the domain map. A Studio configuration
 * page and a tenant settings page are both `configuration`; only one of them may
 * be reached by a customer, and the domain column cannot say so. Answering both
 * questions from one file is what stops them drifting apart.
 *
 * `engine` is deliberately its own answer rather than "both". `packages/` is
 * library code with no surface of its own: it does not render to anybody, it is
 * rendered THROUGH by whichever app imports it. Calling that "both" would put
 * the authorization engine in the same bucket as a component two apps import,
 * and only one of those is a boundary question.
 */
export const EXPERIENCE_OF_SOURCE = [
  ...EXPERIENCES.map((e) => ({
    key: e.key,
    prefix: `${e.app}/src/`,
    what: e.what,
  })),
  {
    key: 'engine',
    prefix: 'packages/',
    what:
      'Library code with no surface of its own. It renders to nobody; it is rendered through by ' +
      'whichever app imports it, so it belongs to neither audience and is available to both.',
  },
]

/** The experience a source path is rendered to, or `null` if nothing claims it. */
export function experienceOf(file) {
  return EXPERIENCE_OF_SOURCE.find((e) => file.startsWith(e.prefix))?.key ?? null
}

const SHARED = new Map([
  ['apps/web/src/instrumentation.ts', 'the boot-time environment check'],
  ['apps/web/src/app/(app)/error.tsx', 'the application error boundary'],
  ['apps/web/src/app/(app)/not-found.tsx', 'the application 404'],
  ['apps/web/src/components/BackButton.tsx', 'a navigation primitive'],
  ['apps/web/src/components/ComingSoon.tsx', 'a placeholder surface for unbuilt modules'],
  ['apps/web/src/components/ThemeSwitcher.tsx', 'a shell control'],
  ['apps/web/src/components/DensitySwitcher.tsx', 'a shell control, beside ThemeSwitcher — it sets how tightly every domain renders and belongs to none of them'],
  ['apps/web/src/app/design-contracts.test.ts', 'asserts design contracts across every surface at once; scoping it to a domain would mean the other domains stopped being checked'],
  ['apps/web/src/lib/db.ts', 'the database client itself — owned by no domain because every domain reads through it'],
  ['apps/web/src/app/layout.tsx', 'the root document'],
  ['apps/web/src/app/(app)/layout.tsx', 'the application shell'],
  ['apps/web/src/app/(app)/actions.ts', 'sign-out only'],
  ['apps/web/src/app/page.tsx', 'the root redirect'],
  ['apps/web/src/app/error.tsx', 'the root error boundary'],
  ['apps/web/src/app/not-found.tsx', 'the root 404'],
  ['apps/web/src/app/manifest.ts', 'the PWA manifest'],
  [
    'apps/web/src/app/globals.css',
    'the tenant application\'s whole stylesheet — every domain in that app renders through it, so ' +
      'giving it to one would make the others its tenants',
  ],
  ['apps/web/src/app/apple-icon.tsx', 'the home-screen icon, generated at the document root'],
  ['apps/web/src/app/api/health/route.ts', 'the load-balancer probe — deliberately owned by nothing'],
])

export function classify() {
  const files = listFiles()
  const byDomain = new Map(DOMAINS.map((d) => [d.key, []]))
  const byExperience = new Map(EXPERIENCE_OF_SOURCE.map((e) => [e.key, []]))
  // A source file no experience claims. Empty today by construction — ROOTS and
  // EXPERIENCE_OF_SOURCE describe the same three trees — and it stops being
  // empty the moment a fourth app is added to ROOTS without deciding who sees
  // it, which is the decision this axis exists to force.
  const unplaced = []
  const orphans = []
  const ambiguous = []
  /** domain key → Set of experience keys, so a domain that straddles is visible. */
  const domainExperiences = new Map(DOMAINS.map((d) => [d.key, new Set()]))

  for (const file of files) {
    const experience = experienceOf(file)
    if (experience === null) unplaced.push(file)
    else byExperience.get(experience).push(file)

    if (SHARED.has(file)) continue
    if (SHARED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue

    const matches = DOMAINS.filter((d) => d.owns.some((prefix) => file.startsWith(prefix)))
    if (matches.length === 0) {
      orphans.push(file)
    } else if (matches.length > 1) {
      ambiguous.push(`${file} — claimed by ${matches.map((m) => m.key).join(' and ')}`)
    } else {
      byDomain.get(matches[0].key).push(file)
      if (experience !== null) domainExperiences.get(matches[0].key).add(experience)
    }
  }

  return { files, byDomain, byExperience, domainExperiences, unplaced, orphans, ambiguous }
}

export { DOMAINS, SHARED, SHARED_PREFIXES }

function render() {
  const { files, byDomain, byExperience, domainExperiences, unplaced, orphans, ambiguous } =
    classify()
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

| Domain | Files | Experience | What it owns |
|---|---:|---|---|
${built
  .map(
    (d) =>
      `| \`${d.key}\` | ${byDomain.get(d.key).length} | ${[...domainExperiences.get(d.key)].sort().join(' + ') || '—'} | ${d.what} |`,
  )
  .join('\n')}

## Experience — who the code is rendered to

TTES-000-001. The table above says which platform **domain** a file belongs to.
This says which **audience** reaches it, and they are genuinely different
questions: a Studio configuration page and a tenant settings page are both
\`configuration\`, and only one of them may be opened by a customer.

Keeping only the domain answer is how \`apps/system-studio/src/components/\` came
to be filed under "the shell and the design system — what every domain renders
through". Nothing outside the operator console imports one of those six files,
and nothing in \`apps/web\` could — the two apps are separate origins on purpose
(PD-007). They are now owned by \`control-plane\`, and the claim that was false
is gone rather than reworded.

| Experience | Files | What it is |
|---|---:|---|
${EXPERIENCE_OF_SOURCE.map(
  (e) => `| \`${e.key}\` | ${byExperience.get(e.key).length} | ${e.what} |`,
).join('\n')}

### Rendered to no declared audience

${
  unplaced.length === 0
    ? '_None._'
    : unplaced.map((f) => `- \`${f}\``).join('\n')
}

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

/**
 * Only when run as a command — never on import.
 *
 * This body used to run on import, and an ESM import runs the whole module. Two
 * tests import `classify` from here (`ownership.test.mjs`, and TTES-000-001's
 * `experience-separation.test.mjs`), so merely importing it REWROTE
 * `ownership.md` — and then the staleness assertion's `--check` subprocess
 * compared the freshly healed file against the generator and reported it up to
 * date. It passed on every possible input, including a domain prefix somebody
 * had just deleted: the committed map would quietly change to agree with the
 * mutation and the test would confirm the map was current.
 *
 * `tools/entry-point-inventory.mjs` carries the same guard and documents the
 * same incident from the other side; this file was never given it. Found while
 * proving TTES-000-001's own staleness assertion could fail — it could not.
 */
const isCommand =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
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
}
