"use client"

import { Button as AriaButton } from "react-aria-components"
import { ImagePlus, Trash2, Link2, Upload } from "@/components/ui/icons"
import { Overlay } from "@/components/ui/Overlay"
import { Avatar } from "@/components/ui/Avatar"
import { setOrgImageUrl, uploadOrgImage, removeOrgImage } from "@/app/(app)/orgs/actions"

/**
 * Lets an administrator (any club) or a club leader (their own) set a club's
 * image. Pasting an image URL always works; uploading a file is offered when
 * object storage is configured. Rendered only for users who can manage the
 * club, so the control itself is the permission surface.
 */
export function ClubImageEditor({
  orgId,
  orgName,
  logoUrl,
  canUpload,
  compact,
}: {
  orgId: string
  orgName: string
  logoUrl?: string | null
  canUpload: boolean
  compact?: boolean
}) {
  const trigger = (
    <AriaButton
      className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 h-9 text-[13px] font-medium text-text-1 outline-none transition-colors data-[hovered]:bg-base data-[focus-visible]:ring-2 data-[focus-visible]:ring-[--primary]"
      aria-label={`${logoUrl ? "Change" : "Add"} image for ${orgName}`}
    >
      <ImagePlus size={15} className="text-text-3" />
      {compact ? "Image" : logoUrl ? "Change image" : "Add image"}
    </AriaButton>
  )

  return (
    <Overlay trigger={trigger} title={`${orgName} — club image`} size="sm">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar name={orgName} imageUrl={logoUrl ?? undefined} size="xl" />
          <p className="text-sm text-text-2">
            {logoUrl ? "This club has an image." : "No image yet — a monogram is shown until you add one."}
          </p>
        </div>

        <form action={setOrgImageUrl} className="space-y-2">
          <input type="hidden" name="organizationId" value={orgId} />
          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-text-2">
            <Link2 size={14} /> Image URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              name="imageUrl"
              required
              placeholder="https://…/logo.png"
              defaultValue={logoUrl && !logoUrl.startsWith("/api/") ? logoUrl : ""}
              className="h-10 flex-1 rounded-md border border-border px-3.5 text-[15px] text-text-1 bg-surface outline-none focus:border-[--border-focus] placeholder:text-text-3"
            />
            <button className="h-10 shrink-0 rounded-md bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:bg-[--primary-hover]">
              Use URL
            </button>
          </div>
        </form>

        {canUpload && (
          <form action={uploadOrgImage} className="space-y-2 border-t border-border pt-5">
            <input type="hidden" name="organizationId" value={orgId} />
            <label className="flex items-center gap-1.5 text-[13px] font-semibold text-text-2">
              <Upload size={14} /> Upload an image
            </label>
            <div className="flex gap-2">
              <input
                type="file"
                name="file"
                accept="image/*"
                required
                className="h-10 flex-1 rounded-md border border-border px-3 py-1.5 text-[13px] text-text-2 file:mr-3 file:rounded file:border-0 file:bg-base file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-text-1"
              />
              <button className="h-10 shrink-0 rounded-md bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:bg-[--primary-hover]">
                Upload
              </button>
            </div>
            <p className="text-meta text-text-3">PNG, JPG, or GIF up to 5 MB.</p>
          </form>
        )}

        {logoUrl && (
          <form action={removeOrgImage} className="border-t border-border pt-5">
            <input type="hidden" name="organizationId" value={orgId} />
            <button className="inline-flex items-center gap-1.5 rounded-md px-3 h-9 text-[13px] font-medium text-[--error] outline-none transition-colors hover:bg-[--error-light]">
              <Trash2 size={15} /> Remove image
            </button>
          </form>
        )}
      </div>
    </Overlay>
  )
}
