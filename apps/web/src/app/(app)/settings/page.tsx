import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { actingInstitutions, withTenantScope } from "@/lib/tenant-scope"
import { BrandPreview } from "@/components/brand/BrandPreview"
import { storageConfigured } from "@/lib/s3"
import { aiConfigured } from "@/lib/ai"
import { cellConnections, credentialExpiry } from "@/lib/auth-connections"
import {
  capabilityAdministrators,
  certifiedCapabilityState,
  resolveCapability,
  type CapabilityState,
  type ConnectionResolution,
} from "@/lib/connections/capability-resolution"
import { ConnectionActionControl } from "@/components/connections/MissingConnectionCard"
import { Card, CardHeader, Attribute } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { PageHeader } from "@/components/ui/PageHeader"
import { ThemeSwitcher } from "@/components/ThemeSwitcher"
import { DensitySwitcher } from "@/components/DensitySwitcher"
import { ProfileImageEditor } from "@/components/ProfileImageEditor"
import { updateProfile, setDelegation, revokeDelegation } from "./actions"

export const dynamic = "force-dynamic"

/**
 * The OIDC scopes this application asks an identity provider for.
 *
 * NextAuth's Okta provider requests `openid profile email` — the three claims
 * `sessionCallbacks` and the Prisma adapter need to create and identify a user.
 * Written down here rather than left implicit in the library's defaults so the
 * Connection Center can say WHICH permission is missing when a tenant's
 * administrator granted fewer, instead of "sign-in is broken".
 */
const SSO_REQUIRED_SCOPES = ["openid", "profile", "email"] as const

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  // `null` means "no user row behind this session" — the scope returns it and
  // the redirect happens after the scope has closed. `redirect()` is a throw,
  // and a throw crossing `runInTenantScope` aborts anything in flight; the guard
  // in src/lib/tenancy/context.ts now refuses it outright rather than letting it
  // pass on the pages that happen to have no write open.
  const page = await withTenantScope(session.user.id, async () => {
    const [user, ctx] = await Promise.all([
      db.user.findUnique({ where: { id: session.user.id } }),
      getUserContext(session.user.id),
    ])
    if (!user) return null

    /**
     * TTES-030-005. The connections that genuinely exist in this deployment,
     * with their REAL health — each `configured` is read from the same
     * function the feature gates on, so this page cannot say "connected" about
     * something the feature would refuse.
     *
     * The provider half of the requirement (a certified third-party
     * `Connection` with a launch token and a pending-action intent) is not
     * here, and its absence is deliberate rather than an oversight: no
     * `Connection` model exists in the schema, so a row claiming one would be
     * a canned value.
     */
    // WRK-030-004. The identity connection this cell actually holds, read from
    // the registry record `auth.ts` gates sign-in on rather than from a second
    // reading of the environment.
    const ssoConnection = cellConnections().find((c) => c.connectionId === "cell-okta")
    const ssoCredential = ssoConnection
      ? credentialExpiry(
          ssoConnection.credentials.find((c) => c.purpose === "oidc-client-secret")?.expiresAt ??
            null,
        )
      : null
    // Unset means "nobody has recorded what was granted", and the honest read
    // of that is the assumption sign-in already makes: that the grant covers
    // what NextAuth asks for. Defaulting to the empty set would show every
    // deployment a permanent "Limited" nobody can clear, which is the alarm
    // that teaches people to ignore the page.
    const recordedScopes = (process.env.OKTA_GRANTED_SCOPES ?? "").split(/[\s,]+/).filter(Boolean)
    const ssoGrantedScopes = recordedScopes.length > 0 ? recordedScopes : [...SSO_REQUIRED_SCOPES]

    const declaredConnections: {
      state: CapabilityState
      whereToFix: string
      manageHref: string
    }[] = [
      {
        state: {
          // WRK-030-005. `certified` is DERIVED, never asserted. This used to be
          // the literal `true` — and for the model connector it was false:
          // `RELAY_ANTHROPIC_REVIEW` is NOT_SUBMITTED, `/api/ai/chat` refuses
          // every vendor call because of it, and this row said "connected and
          // working" about a capability the request path will not call.
          // `certifiedCapabilityState` reads the same record the route reads.
          ...certifiedCapabilityState("ai.model"),
          ...capabilityAdministrators("ai.model"),
          label: "Tenure AI model",
          configured: aiConfigured(),
          reachable: true,
          connectableBy: "admin",
          // Configured by an environment variable rather than by a scoped
          // grant, so there is no scope subset to test. Empty on both sides is
          // the honest answer; naming scopes nobody granted would invent a
          // NEEDS_SCOPE_UPGRADE nothing could clear.
          requiredScopes: [],
          grantedScopes: [],
          credential: null,
          alternative:
            "Search your workspace — the same records, returned as cited sources instead of prose.",
        },
        // Named the environment variable, for the same reason and with the same
        // problem as the single sign-on row below: nobody reading this page can
        // set one. Who turns it on, then what still works without it.
        whereToFix:
          "Turned on by your Tenure operator; there is nothing on your side to set up. Retrieval and search keep working without it — answers arrive as cited sources instead of prose.",
        // Where a person goes IN TENURE. Never a provider console: the point of
        // WRK-110-005 is that somebody who has never seen one can finish the
        // job, and "open the Azure portal" is the failure it names.
        manageHref: "/messages/compose",
      },
      {
        state: {
          ...certifiedCapabilityState("documents.storage"),
          ...capabilityAdministrators("documents.storage"),
          label: "Document storage",
          configured: storageConfigured(),
          reachable: true,
          connectableBy: "admin",
          requiredScopes: [],
          grantedScopes: [],
          credential: null,
          alternative:
            "Documents already stored still open; only new uploads are unavailable.",
        },
        whereToFix:
          "Turned on by your Tenure operator; there is nothing on your side to set up. Without it, document upload is hidden rather than broken — existing documents still open.",
        manageHref: "/messages/compose",
      },
      {
        state: {
          ...certifiedCapabilityState("calendar.feed"),
          ...capabilityAdministrators("calendar.feed"),
          label: "Calendar subscription (ICS)",
          /**
           * WRK-030-005 / WRK-110-005. False, and it is the honest value.
           *
           * This was `true` with the note "per-user and always available", which
           * is a statement about the FEED and not about this account: the URL is
           * a stateless signed link that expires 180 days after it is issued,
           * Tenure stores no record that anybody pasted one into a calendar app,
           * and it therefore cannot know whether this person is subscribed. The
           * row printed "Calendar subscription (ICS) is connected and working"
           * to a student who had never opened the dialog — the same
           * working-looking claim `certified: true` was making one row above.
           *
           * Unconnected until they connect it is the claim the platform can
           * support, and it produces the control that actually helps: Connect,
           * which opens the calendar where Subscribe issues the link.
           */
          configured: false,
          reachable: true,
          connectableBy: "user",
          requiredScopes: [],
          grantedScopes: [],
          credential: null,
          alternative: "Open the calendar in Tenure — every event is there without a subscription.",
        },
        whereToFix:
          "Managed from the calendar: Subscribe issues your private feed link, and removing the calendar in Outlook, Google or Apple ends the subscription — the link is stateless, so Tenure holds nothing to switch off on its side.",
        manageHref: "/calendar",
      },
      {
        /**
         * WRK-030-004 — the row that PRODUCES the reauth and scope-upgrade
         * paths, from state this deployment genuinely holds.
         *
         * Every field is read from the identity connection `cellConnections()`
         * already builds and `auth.ts` already gates sign-in on. Nothing here is
         * a literal:
         *
         *   * `configured` is whether a connection is DESCRIBED at all, not
         *     whether it is usable. That distinction is the whole point of the
         *     reauth path: a connection whose client secret expired is
         *     configured and broken, and collapsing it into "not connected"
         *     sends an administrator to set up something that is already set up.
         *   * `credential` is `OKTA_CLIENT_SECRET_EXPIRES_AT` through
         *     `credentialExpiry`, which is `connectionHealth`'s verdict — the
         *     same rule `oktaIsUsable()` applies at boot.
         *   * `grantedScopes` is `OKTA_GRANTED_SCOPES`, which an operator sets
         *     from what the tenant's Okta administrator actually granted the app
         *     registration. Unset means "assume it covers what we ask for",
         *     which is exactly the assumption sign-in makes today; writing it
         *     down turns an invisible assumption into a row somebody can
         *     correct.
         */
        state: {
          ...certifiedCapabilityState("identity.sso"),
          ...capabilityAdministrators("identity.sso"),
          label: "Single sign-on",
          configured: ssoConnection !== undefined,
          reachable: true,
          connectableBy: "admin",
          requiredScopes: SSO_REQUIRED_SCOPES,
          grantedScopes: ssoGrantedScopes,
          credential: ssoCredential,
          alternative:
            "Sign-in still works through the methods your institution has already enabled.",
        },
        // WRK-110-005. This used to read "…against your institution's identity
        // provider (OKTA_ISSUER, OKTA_CLIENT_ID and the client secret's
        // reference)", which is the failure the requirement names, printed to
        // every club member who opens Settings: a person who cannot act is
        // handed the credential list instead of the people who can. The row
        // already names them one line up — `Owned by {resolved.owner}`, which
        // is `capabilityAdministrators` resolving real shipped roles — so the
        // fix sentence points at that answer rather than at a secret store.
        whereToFix:
          "Set up for your whole institution by the people named above, working with your Tenure operator. There is nothing on your side to change, and nothing about your account changes while it is being set up.",
        manageHref: "/messages/compose",
      },
    ]
    const connections: {
      state: CapabilityState
      resolved: ConnectionResolution
      whereToFix: string
      manageHref: string
    }[] = declaredConnections.map((c) => ({ ...c, resolved: resolveCapability(c.state) }))

    const seats = await db.roleAssignment.findMany({
      where: { userId: user.id, status: { in: ["ACTIVE", "SHADOW"] } },
      include: { role: { include: { seat: true, organization: { select: { name: true } } } } },
      orderBy: { startDate: "desc" },
    })

    // The tenant whose branding this account actually renders under — the same
    // resolution the shell layout uses, so the preview cannot show one
    // institution's accent to somebody browsing under another's.
    const activeSlug = (await actingInstitutions(session.user.id)).active?.slug ?? ""

    // Delegation: only gate owners (a president or OSE member) can name a backup.
    const isOse = ctx.institutionRoles.length > 0
    const presidentOrgIds = ctx.orgRoles
      .filter((r) => r.scope === "PRESIDENT" && r.status === "ACTIVE")
      .map((r) => r.organizationId)
    const canDelegate = isOse || presidentOrgIds.length > 0
    let eligibleBackups: { id: string; name: string }[] = []
    let currentDelegation:
      | { id: string; note: string | null; toUser: { name: string | null; email: string | null } }
      | null = null
    if (canDelegate) {
      let institutionId: string | undefined = ctx.institutionRoles[0]?.institutionId
      if (!institutionId && presidentOrgIds.length) {
        const org = await db.organization.findFirst({
          where: { id: presidentOrgIds[0] },
          select: { institutionId: true },
        })
        institutionId = org?.institutionId
      }
      const instId = institutionId // const narrows reliably across the awaits below
      const or: object[] = []
      if (isOse && instId) or.push({ institutionMembership: { some: { institutionId: instId } } })
      if (presidentOrgIds.length)
        or.push({ roleAssignments: { some: { status: "ACTIVE", role: { organizationId: { in: presidentOrgIds } } } } })
      if (or.length) {
        const users = await db.user.findMany({
          where: { id: { not: user.id }, OR: or },
          select: { id: true, name: true, email: true },
          take: 50,
        })
        eligibleBackups = users.map((u) => ({ id: u.id, name: u.name ?? u.email ?? "Unknown" }))
      }
      if (instId) {
        currentDelegation = await db.approvalDelegation.findFirst({
          where: { fromUserId: user.id, revokedAt: null, institutionId: instId },
          select: { id: true, note: true, toUser: { select: { name: true, email: true } } },
        })
      }
    }

    return (
      <div className="max-w-3xl">
        <PageHeader
          title="Settings"
          subtitle="Your profile, appearance, and access at a glance."
        />

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Profile picture"
              subtitle="Shown in the header, messages, and wherever you appear."
            />
            <ProfileImageEditor
              name={user.name ?? user.email ?? "You"}
              image={user.image}
              canUpload={storageConfigured()}
            />
          </Card>

          <Card>
            <CardHeader
              title="Appearance"
              subtitle="Choose a theme — System follows your device."
            />
            <ThemeSwitcher />
          </Card>

          {/* TTES-010-004. Beside Appearance because it answers the same
              question from the other end: Appearance is the theme this person
              chose, this is the accent their institution set and what it
              measures against every theme the product ships. Rendered only for
              an account with a tenant — there is nothing to preview without
              one. */}
          {activeSlug && (
            <Card>
              <CardHeader
                title="Institution branding"
                subtitle="Your institution's accent, as it is actually painted — and anything the contrast gate refused."
              />
              <BrandPreview institutionSlug={activeSlug} />
            </Card>
          )}

          <Card>
            <CardHeader
              title="Density"
              subtitle="How much of a long table fits on screen. Compact tightens rows, buttons and inputs; nothing else changes."
            />
            <DensitySwitcher />
          </Card>

          <Card>
            <CardHeader title="Profile" />
            <form action={updateProfile} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-text-2 flex-1 min-w-52">
                Display name
                <input
                  name="name"
                  defaultValue={user.name ?? ""}
                  required
                  maxLength={120}
                  className="h-9 w-full rounded border border-border px-3 text-sm text-text-1 bg-surface"
                />
              </label>
              <button className="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90">
                Save
              </button>
            </form>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <Attribute label="Email" value={user.email} />
              <Attribute
                label="Institution role"
                value={
                  ctx.institutionRoles[0]
                    ? ctx.institutionRoles[0].role.replace(/_/g, " ").toLowerCase()
                    : "club member"
                }
              />
            </div>
          </Card>

          <Card padding="none">
            <div className="p-5 border-b border-border">
              <CardHeader
                title="Your seats"
                subtitle="Positions you currently hold or are inheriting"
              />
            </div>
            {seats.length === 0 ? (
              <p className="px-5 py-6 text-sm text-text-3 text-center">No club seats.</p>
            ) : (
              <ul className="divide-y divide-border">
                {seats.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-1">
                        {s.role.name} · {s.role.organization.name}
                      </p>
                      {s.role.seat?.positionCode && (
                        <p className="text-xs text-text-3 mt-0.5">
                          Position ID {s.role.seat.positionCode}
                        </p>
                      )}
                    </div>
                    <Badge variant={s.status === "ACTIVE" ? "success" : "info"}>
                      {s.status === "ACTIVE" ? "Active" : "Shadow"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canDelegate && (
            <Card>
              <CardHeader
                title="Backup approver"
                subtitle="Name someone who can act on your approval gate while you're away — every action they take is recorded “on behalf of” you."
              />
              {currentDelegation ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-base px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-text-1">
                      <span className="font-medium">
                        {currentDelegation.toUser.name ?? currentDelegation.toUser.email}
                      </span>{" "}
                      can approve on your behalf.
                    </p>
                    {currentDelegation.note && (
                      <p className="mt-0.5 text-[13px] text-text-3">{currentDelegation.note}</p>
                    )}
                  </div>
                  <form action={revokeDelegation}>
                    <input type="hidden" name="id" value={currentDelegation.id} />
                    <button className="h-8 rounded border border-border px-3 text-[13px] font-medium text-text-2 hover:bg-surface hover:text-[--error]">
                      Revoke
                    </button>
                  </form>
                </div>
              ) : eligibleBackups.length === 0 ? (
                <p className="text-sm text-text-3">
                  No eligible backups yet — a backup must be a fellow OSE member or an active board
                  member of your club.
                </p>
              ) : (
                <form action={setDelegation} className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs text-text-2">
                    Backup approver
                    <select
                      name="toUserId"
                      required
                      className="h-9 rounded border border-border bg-surface px-2 text-sm text-text-1"
                    >
                      {eligibleBackups.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-text-2">
                    Note (optional)
                    <input
                      name="note"
                      maxLength={140}
                      placeholder="e.g. Covering while I'm on the career trek"
                      className="h-9 w-full rounded border border-border bg-surface px-3 text-sm text-text-1"
                    />
                  </label>
                  <button className="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90">
                    Set backup
                  </button>
                </form>
              )}
            </Card>
          )}

          {/* TTES-030-005 — the Connection Centre, for the connections that
              genuinely exist today. Each row's status is READ from the same
              function the feature itself gates on (aiConfigured,
              storageConfigured), never from a stored flag that could be stale,
              and the outcome + the one available path come from
              resolveCapability so a non-certified capability can never grow a
              Connect button. */}
          <Card padding="none">
            <div className="border-b border-border p-5">
              <CardHeader
                title="Connections"
                subtitle="What this workspace is wired to, who owns each one, and where to fix it."
              />
            </div>
            <ul className="divide-y divide-border">
              {connections.map(({ state, resolved, whereToFix, manageHref }) => (
                <li
                  key={state.key}
                  className="px-5 py-4"
                  data-connection={state.key}
                  data-connection-outcome={resolved.outcome}
                  data-connection-status={resolved.statusWord}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-1">{state.label}</p>
                      <p className="mt-0.5 text-[13px] text-text-2">{resolved.explanation}</p>
                      <p className="mt-1 text-meta uppercase tracking-wide text-text-3">
                        Owned by {resolved.owner}
                      </p>
                    </div>
                    <Badge variant={resolved.outcome === "CONNECTED" ? "success" : "default"}>
                      {resolved.statusWord}
                    </Badge>
                  </div>
                  {/* WRK-110-005 — the row's one control, and the fix beside it.
                      `resolved.action` is the decision `resolveCapability` was
                      already making and this page was throwing away: a
                      CONNECTED per-user feed offered no Disconnect, and an
                      admin-owned capability offered no way to ask one. The
                      control comes from the resolution and never from this call
                      site; only WHERE it goes is declared here, and it is
                      always a page of Tenure. `whereToFix` is promoted beside
                      it rather than buried under the row, because a control
                      with no explanation of what it will do is the thing a
                      nontechnical person stops at. */}
                  <p className="mt-2 text-[13px] text-text-3">{whereToFix}</p>
                  <ConnectionActionControl action={resolved.action} href={manageHref} />
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Notifications" subtitle="Delivery preferences" />
            <p className="text-sm text-text-2">
              In-app notifications are always on. Email digests arrive with the
              university SSO rollout.
            </p>
          </Card>
        </div>
      </div>
    )
  })

  if (!page) redirect("/signin")
  return page
}
