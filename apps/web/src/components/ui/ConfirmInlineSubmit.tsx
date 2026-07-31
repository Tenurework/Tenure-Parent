"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useFormStatus } from "react-dom"
import { ConfirmDialog, type ConfirmVariant } from "@/components/ui/ConfirmDialog"

/**
 * A confirmation gate for a destructive submit button that lives INSIDE an
 * existing server-action <form> — where the real form carries sibling fields
 * that must survive the confirm (a free-text reason/note, a directory picker's
 * hidden inputs, another non-destructive submit button, …).
 *
 * Unlike ConfirmSubmit (which owns an isolated hidden form), this renders its
 * submit button + a useFormStatus sensor into the SURROUNDING form, so on
 * confirm it submits that real form — preserving every sibling field exactly —
 * via requestSubmit(submitter), which keeps the submitter's name/value and
 * per-button formAction.
 *
 * Place it as a child of the form whose submission it should gate.
 */
export interface ConfirmInlineSubmitProps {
  /** Submitter name preserved on submit (e.g. name="action"). */
  name?: string
  /** Submitter value preserved on submit (e.g. value="reject"). */
  value?: string
  /** Per-submitter server action, when the form has no single action prop. */
  formAction?: (formData: FormData) => void | Promise<void>

  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  variant?: ConfirmVariant
  requireText?: string
  details?: ReactNode

  children: ReactNode
  /** Class string so the trigger matches the bespoke button it replaces. */
  triggerClassName: string
  triggerAriaLabel?: string
  disabled?: boolean
  /** Run native form validation before opening the dialog (default true). */
  validateBeforeOpen?: boolean
}

/** Lives inside the form; surfaces the server action's pending state upward. */
function FormPending({ onPending }: { onPending: (pending: boolean) => void }) {
  const { pending } = useFormStatus()
  useEffect(() => {
    onPending(pending)
  }, [pending, onPending])
  return null
}

export function ConfirmInlineSubmit({
  name,
  value,
  formAction,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "danger",
  requireText,
  details,
  children,
  triggerClassName,
  triggerAriaLabel,
  disabled,
  validateBeforeOpen = true,
}: ConfirmInlineSubmitProps) {
  const submitRef = useRef<HTMLButtonElement>(null)
  const wasBusy = useRef(false)
  // Set true only for the instant between confirming and the resulting submit,
  // so the guard below can tell a confirmed submit from an implicit one.
  const confirmedRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const openDialog = useCallback(() => {
    const form = submitRef.current?.form
    if (validateBeforeOpen && form && !form.reportValidity()) return
    setOpen(true)
  }, [validateBeforeOpen])

  const handleConfirm = useCallback(() => {
    setBusy(true)
    const btn = submitRef.current
    confirmedRef.current = true
    // requestSubmit(submitter) submits the REAL surrounding form — preserving
    // all its fields — while keeping this button's name/value + formAction.
    btn?.form?.requestSubmit(btn)
  }, [])

  // Guard against bypassing the dialog: if the enclosing form is submitted with
  // OUR button as the submitter but we didn't just confirm (e.g. an implicit
  // Enter-key submit when this is the form's first/only submit button), stop it
  // and open the dialog instead. Submissions by any other button pass through.
  useEffect(() => {
    const btn = submitRef.current
    const form = btn?.form
    if (!form) return
    const onSubmit = (e: SubmitEvent) => {
      if (e.submitter !== btn) return
      if (confirmedRef.current) {
        confirmedRef.current = false
        return
      }
      e.preventDefault()
      e.stopPropagation()
      openDialog()
    }
    form.addEventListener("submit", onSubmit)
    return () => form.removeEventListener("submit", onSubmit)
  }, [openDialog])

  const onPending = useCallback((pending: boolean) => {
    if (pending) {
      wasBusy.current = true
      setBusy(true)
    } else if (wasBusy.current) {
      wasBusy.current = false
      setBusy(false)
      setOpen(false)
    }
  }, [])

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        aria-label={triggerAriaLabel}
        disabled={disabled}
        onClick={openDialog}
      >
        {children}
      </button>

      <button
        ref={submitRef}
        type="submit"
        name={name}
        value={value}
        formAction={formAction}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      <FormPending onPending={onPending} />

      <ConfirmDialog
        isOpen={open}
        onOpenChange={(next) => {
          if (busy) return
          setOpen(next)
        }}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        variant={variant}
        requireText={requireText}
        details={details}
        onConfirm={handleConfirm}
        busy={busy}
      />
    </>
  )
}
