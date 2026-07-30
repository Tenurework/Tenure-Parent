"use client"

import { Link2, Upload, Trash2 } from "@/components/ui/icons"
import { Avatar } from "@/components/ui/Avatar"
import {
  setProfileImageUrl,
  uploadProfileImage,
  removeProfileImage,
} from "@/app/(app)/settings/actions"

/**
 * Lets any user set their own profile picture — by pasting an image URL (works
 * everywhere) or uploading a file when object storage is configured. The
 * picture then follows them across the header, messaging and rosters.
 */
export function ProfileImageEditor({
  name,
  image,
  canUpload,
}: {
  name: string
  image?: string | null
  canUpload: boolean
}) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <Avatar name={name} imageUrl={image} size="xl" />

      <div className="min-w-0 flex-1 space-y-4">
        <form action={setProfileImageUrl} className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-text-2">
            <Link2 size={14} /> Image URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              name="imageUrl"
              required
              placeholder="https://…/me.jpg"
              defaultValue={image && !image.startsWith("/api/") ? image : ""}
              className="h-10 flex-1 rounded-md border border-border px-3.5 text-[15px] text-text-1 outline-none focus:border-[--border-focus]"
            />
            <button className="h-10 shrink-0 rounded-md bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:bg-[--primary-hover]">
              Use URL
            </button>
          </div>
        </form>

        {canUpload && (
          <form action={uploadProfileImage} className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[13px] font-semibold text-text-2">
              <Upload size={14} /> Upload a picture
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
          </form>
        )}

        {image && (
          <form action={removeProfileImage}>
            <button className="inline-flex items-center gap-1.5 rounded-md px-3 h-9 text-[13px] font-medium text-[--error] transition-colors hover:bg-[--error-light]">
              <Trash2 size={15} /> Remove picture
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
