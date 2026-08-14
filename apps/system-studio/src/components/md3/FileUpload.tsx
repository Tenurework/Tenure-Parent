"use client"

import { useId, useRef, useState } from "react"

import "./primitives.css"
import { Surface } from "./Surface"
import {
  checkFiles,
  describeSelection,
  formatBytes,
  type FileCandidate,
  type FileRejection,
} from "./files"

/**
 * Choosing files: a blueprint bundle, an evidence attachment, a bulk tenant CSV.
 *
 * ## The real `<input type="file">` is the control, and it is visible
 *
 * The usual pattern hides the input behind a styled label. It works, and it
 * costs the focus ring — a `display: none` input cannot be focused, so keyboard
 * users get no indication of where they are, and some screen readers stop
 * announcing the file name after a selection. Here the input is a real, visible,
 * focusable control inside the drop zone, and the drop zone is an ENHANCEMENT
 * around it rather than a replacement for it.
 *
 * That is also what makes drag-and-drop safe to offer: WCAG 2.2 AA 2.5.7
 * requires that anything achievable by dragging be achievable without, and here
 * the non-dragging path is the platform's own picker rather than a second
 * feature that has to be maintained.
 *
 * ## The rejections are on the screen, one line each
 *
 * `files.ts` returns a sentence per rejected file naming the file and the rule,
 * and every one of them is rendered. A single "some files were not accepted" is
 * the message that makes an operator try the same file three times.
 *
 * ## The summary is a live region, and it is visible
 *
 * `role="status"` on a line that is also on the screen. A screen-reader-only
 * announcement would leave a sighted operator unsure whether the drop worked;
 * a visible line with a polite live region tells both, once.
 *
 * ## Removing one file
 *
 * A file input's `files` list is read-only except through a `DataTransfer`,
 * which is why so many uploaders make "remove" mean "start again". This one
 * rebuilds the list where `DataTransfer` exists and says plainly what it did
 * where it does not — rather than showing a removal that the form then submits
 * anyway, which is the version that loses data.
 */

export interface FileUploadProps {
  /** The field name the form submits. */
  name: string
  /** What is being uploaded. The legend of the group. */
  legend: string
  /** Format, size limit, what happens next. */
  supportingText?: string
  /** `accept` in the attribute's own syntax — ".json,.zip" or "text/*". */
  accept?: string
  maxBytes?: number
  maxFiles?: number
  multiple?: boolean
  required?: boolean
  id?: string
}

export function FileUpload({
  name,
  legend,
  supportingText,
  accept,
  maxBytes,
  maxFiles,
  multiple = false,
  required,
  id,
}: FileUploadProps) {
  const generatedId = useId()
  const baseId = id ?? generatedId
  const inputId = `${baseId}-input`
  const supportId = `${baseId}-support`
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [chosen, setChosen] = useState<readonly FileCandidate[]>([])
  const [rejected, setRejected] = useState<readonly FileRejection[]>([])
  const [dragging, setDragging] = useState(false)
  const [note, setNote] = useState("No file chosen.")

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])]
    const result = checkFiles(files, { accept, maxBytes, maxFiles })
    setChosen(result.accepted.map((file) => ({ name: file.name, size: file.size, type: file.type })))
    setRejected(result.rejected)
    setNote(describeSelection(result))
  }

  const removeAt = (index: number) => {
    const input = inputRef.current
    const remaining = chosen.filter((_, at) => at !== index)
    // `DataTransfer` is how a file list is rebuilt. Where it is missing the
    // honest answer is to clear the input and say so, because a list that shows
    // three files while the form submits four is worse than starting again.
    if (input && typeof DataTransfer === "function" && input.files) {
      const transfer = new DataTransfer()
      ;[...input.files].forEach((file, at) => {
        if (at !== index) transfer.items.add(file)
      })
      input.files = transfer.files
      setChosen(remaining)
      setNote(`${remaining.length} file${remaining.length === 1 ? "" : "s"} ready.`)
      return
    }
    if (input) input.value = ""
    setChosen([])
    setNote("Selection cleared. This browser cannot remove one file at a time; choose the files again.")
  }

  return (
    <fieldset data-md3="upload">
      <legend className="md3-label-large" data-md3="upload-legend">
        {legend}
      </legend>
      {supportingText ? (
        <p id={supportId} className="md3-body-small" data-md3="upload-support">
          {supportingText}
        </p>
      ) : null}
      <Surface
        container="low"
        level={0}
        shape="medium"
        outlined
        data-md3="upload-drop"
        data-dragging={dragging ? "true" : "false"}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          take(event.dataTransfer?.files ?? null)
        }}
      >
        <label htmlFor={inputId} className="md3-label-large" data-md3="upload-label">
          Choose {multiple ? "files" : "a file"}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="file"
          className="md3-body-medium"
          data-md3="upload-input"
          accept={accept}
          multiple={multiple}
          required={required}
          aria-describedby={supportingText ? supportId : undefined}
          onChange={(event) => take(event.target.files)}
        />
        <p className="md3-body-small" data-md3="upload-hint">
          {/* Drag is the enhancement, so it is described second. */}
          Or drop {multiple ? "them" : "it"} here.
        </p>
      </Surface>
      <p role="status" data-md3="upload-status" className="md3-body-small">
        {note}
      </p>
      {chosen.length ? (
        <ul data-md3="upload-list">
          {chosen.map((file, index) => (
            <li key={`${file.name}-${index}`} data-md3="upload-item" className="md3-body-small">
              <span data-md3="upload-name">{file.name}</span>
              <span data-md3="upload-size">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="md3-button md3-state"
                data-variant="text"
                data-tone="neutral"
                onClick={() => removeAt(index)}
              >
                {/* Named, not an X: six of these in a column all say "Remove" otherwise. */}
                Remove {file.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {rejected.length ? (
        <ul data-md3="upload-rejected">
          {rejected.map((rejection, index) => (
            <li key={`${rejection.file.name}-${index}`} className="md3-body-small">
              <span className="md3-field-error-word">Error</span> {rejection.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  )
}
