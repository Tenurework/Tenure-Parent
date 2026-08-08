import { type ReactNode } from "react"

import { Avatar } from "@/components/ui/Avatar"
import { PageHeader } from "@/components/ui/PageHeader"
import { OrgTabs } from "@/components/OrgTabs"

/**
 * TTES-030-001, Bible §5.3 — the club record's anatomy, in one place.
 *
 * §5.3 says every important record uses a STABLE anatomy, and names its order:
 *
 * ```text
 * identity + status + primary actions
 * summary and key facts
 * work/content tabs
 * ```
 *
 * A club is the product's central record and it had six surfaces — members,
 * finance, documents, memory, handoff, impact — that each hand-rolled their
 * own. Five emitted a bare `<h1>{org.name}</h1>` with a lead paragraph under
 * it, no breadcrumb, no statement of which section you were in, and, crucially,
 * NOWHERE TO PUT THE STATE: a reader landing on `/orgs/x/members` could not
 * tell from the header whether the board was fully seated, and one landing on
 * `/orgs/x/finance` could not tell whether the ledger reconciled without
 * hunting down the page for it. The sixth (handoff) had adopted `PageHeader`
 * and so was the only one with an anatomy at all — which is worse than none,
 * because the anatomy §5.3 asks for is a STABLE one and six surfaces of the
 * same record disagreed about where identity ended and state began.
 *
 * This composes the three bands in the specified order and nothing else. It
 * deliberately does NOT own the "summary and key facts" band: each surface's
 * facts are its own (a budget percentage on finance, a card count on memory),
 * and a component that tried to own them would end up with six optional slots,
 * five of them unset on any given page.
 *
 * ## `status` is required
 *
 * No default, and not optional. An optional `status` is the exact
 * optional-field-nobody-sets failure this repository has shipped twice: it
 * type-checks at every call site, every test keeps passing because tests build
 * their own fixtures, and the product quietly keeps the header it already had —
 * an identity band with no state in it, which is the whole defect. Required
 * means `tsc` names every surface and each one has to answer what state it is
 * showing.
 *
 * The tabs are rendered HERE rather than left to the caller for the same
 * reason: they are the third band of the anatomy, and a caller that forgot them
 * (or put them above the status row) would be a surface out of order again.
 */
export function OrgRecordHeader({
  slug,
  org,
  section,
  subtitle,
  status,
  actions,
}: {
  slug: string
  /** Structural, not the Prisma row — the header needs an identity, not a club. */
  org: { name: string; logoUrl?: string | null }
  /** Which section of the record this is, shown above the name. */
  section: string
  subtitle: ReactNode
  /**
   * The record's STATE — badges, a lifecycle chip, a count of what is
   * outstanding. REQUIRED; see the header above for why it has no default.
   */
  status: ReactNode
  /** The record's primary actions, right-aligned beside the identity. */
  actions?: ReactNode
}) {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Clubs", href: "/orgs" }, { label: org.name }]}
        eyebrow={section}
        title={
          <span className="flex items-center gap-3">
            <Avatar
              name={org.name}
              imageUrl={org.logoUrl ?? undefined}
              size="lg"
              className="hidden shrink-0 sm:grid"
            />
            <span className="min-w-0">{org.name}</span>
          </span>
        }
        subtitle={subtitle}
        status={status}
        actions={actions}
      />
      <OrgTabs slug={slug} />
    </>
  )
}
