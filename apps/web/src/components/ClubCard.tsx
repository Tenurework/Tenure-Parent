import Link from "next/link"
import { Users, Archive, ArchiveRestore } from "@/components/ui/icons"
import type { OrgStatus, OrgCategory } from "@prisma/client"
import { Badge } from "@/components/ui/Badge"
import { Avatar } from "@/components/ui/Avatar"
import { ConfirmSubmit } from "@/components/ui/ConfirmDialog"
import { setClubStatus } from "@/app/(app)/orgs/actions"

const clubActionBtn =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-text-3 outline-none transition-colors hover:bg-base hover:text-text-1 focus-visible:ring-2 focus-visible:ring-[--primary]"

const CATEGORY_LABEL: Record<OrgCategory, string> = {
  ORGANIZATION: "Organization",
  PROFESSIONAL: "Professional",
  COMMUNITY: "Community",
  SOCIAL: "Social",
}

export interface ClubCardStats {
  filledSeats: number
  boardSeats: number
  vacancies: number
  president?: string | null
}

/**
 * The single, uniform club card. Every card is the same structure and height:
 * an optional image banner (only when the club has one — otherwise a clean,
 * uncoloured header with a muted monogram), the category lozenge, name, a
 * two-line description, a seats summary, and a dedicated footer action row so
 * the archive control never overlaps the content.
 */
export function ClubCard({
  org,
  stats,
  canArchive,
}: {
  org: {
    id: string
    slug: string
    name: string
    description?: string | null
    category: OrgCategory
    status: OrgStatus
    logoUrl?: string | null
  }
  stats: ClubCardStats
  canArchive: boolean
}) {
  return (
    <article className="tile-float group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface hover:border-[--border-strong]">
      {org.logoUrl && (
        <div className="h-28 shrink-0 overflow-hidden border-b border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={org.logoUrl} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex items-center gap-3">
          {!org.logoUrl && <Avatar name={org.name} size="lg" />}
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-subtle px-2 py-1 text-[12px] font-semibold leading-none text-text-2">
              {CATEGORY_LABEL[org.category]}
            </span>
            {org.status !== "ACTIVE" && (
              <Badge variant={org.status === "ARCHIVED" ? "default" : "warning"}>
                {org.status.toLowerCase()}
              </Badge>
            )}
          </div>
        </div>

        <h3 className="font-display text-base font-semibold text-text-1">
          <Link
            href={`/orgs/${org.slug}/members`}
            className="text-text-1 no-underline outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-[--primary] focus-visible:underline"
          >
            {org.name}
          </Link>
        </h3>
        <p className="mt-1.5 line-clamp-2 min-h-[2.7em] text-sm text-text-2">
          {org.description || "No description yet."}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-text-3">
          <span className="inline-flex items-center gap-1.5">
            <Users size={14} /> {stats.filledSeats}/{stats.boardSeats} seats filled
          </span>
          {stats.vacancies > 0 && <span className="text-[--warning]">{stats.vacancies} vacant</span>}
        </div>
        {stats.president && (
          <p className="mt-1 truncate text-[13px] text-text-3">President · {stats.president}</p>
        )}
      </div>

      {/* Footer action row — above the stretched link, so no overlap */}
      <div className="relative z-10 flex items-center justify-between gap-2 border-t border-border px-5 py-3">
        <span className="text-[13px] font-medium text-text-link">View roster →</span>
        {canArchive &&
          (org.status === "ARCHIVED" ? (
            <form action={setClubStatus}>
              <input type="hidden" name="organizationId" value={org.id} />
              <input type="hidden" name="status" value="ACTIVE" />
              <button className={clubActionBtn} aria-label={`Reactivate ${org.name}`}>
                <ArchiveRestore size={14} /> Reactivate
              </button>
            </form>
          ) : (
            <ConfirmSubmit
              action={setClubStatus}
              hiddenFields={{ organizationId: org.id, status: "ARCHIVED" }}
              title={`Archive ${org.name}?`}
              description={`${org.name} disappears from the active clubs list and stops surfacing in day-to-day views. Nothing is deleted and its full history stays intact — you can reactivate it here whenever you like.`}
              confirmLabel="Archive club"
              variant="danger"
              triggerClassName={clubActionBtn}
              triggerAriaLabel={`Archive ${org.name}`}
            >
              <Archive size={14} /> Archive
            </ConfirmSubmit>
          ))}
      </div>
    </article>
  )
}
