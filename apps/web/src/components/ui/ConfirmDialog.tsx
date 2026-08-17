"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useFormStatus } from "react-dom"
import { Loader2 } from "@/components/ui/icons"
import { Button, type ButtonProps } from "@/components/ui/Button"
import { DestructivePreviewPanel } from "@/components/ui/DestructivePreview"
import { Overlay } from "@/components/ui/Overlay"
import type { DestructivePreview } from "@/components/ui/destructive-preview"

/**
 * The product-wide confirmation primitive for destructive / consequential
 * actions. Built on the shared Overlay so every confirm feels identical.
 *
 * Two exports:
 *  - ConfirmDialog — a controlled dialog (isOpen/onOpenChange) that states, in
 *    context-specific words, what is about to happen and asks the user to
 *    confirm. Supports a typed-confirmation gate (`requireText`) and a
 *    blast-radius `details` slot for high-severity actions.
 *  - ConfirmSubmit — a client wrapper that renders a trigger, opens a
 *    ConfirmDialog, and on confirm submits an underlying server-action form —
 *    preserving the submitter's name/value and per-button formAction so the
 *    correct server action + payload fires.
 */

export type ConfirmVariant = "danger" | "primary" | "default"

function confirmButtonVariant(variant: ConfirmVariant): ButtonProps["variant"] {
  return variant === "danger" ? "destructive" : "primary"
}

export interface ConfirmDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** The context-specific explanation — what will happen, not "Are you sure". */
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  variant?: ConfirmVariant
  /** High-severity gate: the user must type this exact string to enable Confirm. */
  requireText?: string
  /** Optional slot to show what will happen / the blast radius. */
  details?: ReactNode
  /**
   * GE-143-025 — the standardized blast radius: nine disclosures in one shape,
   * rendered identically wherever a destructive or cross-organization action is
   * confirmed. Prefer this over `details`, which is free prose a caller writes
   * and nothing can check. Both may be supplied while surfaces migrate;
   * `destructive-preview.ts` carries the register of the ones that have not.
   */
  preview?: DestructivePreview
  onConfirm: () => void
  busy?: boolean
}

export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "default",
  requireText,
  details,
  preview,
  onConfirm,
  busy = false,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("")

  // Reset the typed gate whenever the dialog closes.
  useEffect(() => {
    if (!isOpen) setTyped("")
  }, [isOpen])

  const gateOk = !requireText || typed.trim() === requireText.trim()
  const confirmDisabled = busy || !gateOk

  return (
    <Overlay
      title={title}
      size="sm"
      isOpen={isOpen}
      onOpenChange={(open) => {
        // Don't let a click-away abandon an in-flight action.
        if (busy) return
        onOpenChange(open)
      }}
      isDismissable={!busy}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={busy}
            onPress={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmButtonVariant(variant)}
            size="sm"
            isDisabled={confirmDisabled}
            onPress={onConfirm}
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-sm leading-relaxed text-text-2">{description}</div>

        {preview && <DestructivePreviewPanel preview={preview} />}

        {details && (
          <div className="rounded-md border border-border bg-base px-4 py-3 text-[13px] leading-relaxed text-text-2">
            {details}
          </div>
        )}

        {requireText && (
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-text-2">
            To confirm, type{" "}
            <span className="font-mono font-bold text-text-1">{requireText}</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="h-10 rounded-md border border-border px-3.5 text-[15px] text-text-1 bg-surface outline-none focus:border-[--border-focus] placeholder:text-text-3"
            />
          </label>
        )}
      </div>
    </Overlay>
  )
}

// ─── ConfirmSubmit — wrap a server-action form in a confirmation ──────────────

type FieldValue = string | number | undefined

export interface ConfirmSubmitProps {
  /** Server action for the underlying form. Optional when every submit path
   *  supplies its own `formAction`. */
  action?: (formData: FormData) => void | Promise<void>
  /** Per-submitter server action (e.g. finance's per-button formAction). When
   *  set it overrides `action` for this submit. */
  formAction?: (formData: FormData) => void | Promise<void>
  /** Hidden inputs rendered into the form (undefined values are skipped). */
  hiddenFields?: Record<string, FieldValue>
  /** Submitter button name — preserved on submit (e.g. approvals' name="action"). */
  name?: string
  /** Submitter button value — preserved on submit (e.g. value="reject"). */
  value?: string

  // Confirm dialog copy.
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  variant?: ConfirmVariant
  requireText?: string
  details?: ReactNode
  /** GE-143-025 — the standardized blast radius. See ConfirmDialogProps. */
  preview?: DestructivePreview

  // Trigger. Provide `triggerClassName` for a bare styled <button> (to match a
  // bespoke row control) or omit it to render the shared Button.
  children: ReactNode
  triggerClassName?: string
  triggerVariant?: ButtonProps["variant"]
  triggerSize?: ButtonProps["size"]
  triggerAriaLabel?: string
  disabled?: boolean
}

/** Lives inside the form; surfaces the server action's pending state upward. */
function FormPending({ onPending }: { onPending: (pending: boolean) => void }) {
  const { pending } = useFormStatus()
  useEffect(() => {
    onPending(pending)
  }, [pending, onPending])
  return null
}

export function ConfirmSubmit({
  action,
  formAction,
  hiddenFields,
  name,
  value,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "danger",
  requireText,
  details,
  preview,
  children,
  triggerClassName,
  triggerVariant = "destructive",
  triggerSize = "sm",
  triggerAriaLabel,
  disabled,
}: ConfirmSubmitProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const wasBusy = useRef(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleConfirm = useCallback(() => {
    setBusy(true)
    // requestSubmit(submitter) preserves the submitter's name/value AND its
    // formAction — so approvals' name="action" value="reject" and finance's
    // per-button formAction both fire correctly.
    formRef.current?.requestSubmit(submitRef.current ?? undefined)
  }, [])

  const onPending = useCallback((pending: boolean) => {
    if (pending) {
      wasBusy.current = true
      setBusy(true)
    } else if (wasBusy.current) {
      // Action finished — close and reset.
      wasBusy.current = false
      setBusy(false)
      setOpen(false)
    }
  }, [])

  return (
    <>
      {triggerClassName ? (
        <button
          type="button"
          className={triggerClassName}
          aria-label={triggerAriaLabel}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {children}
        </button>
      ) : (
        <Button
          variant={triggerVariant}
          size={triggerSize}
          aria-label={triggerAriaLabel}
          isDisabled={disabled}
          onPress={() => setOpen(true)}
        >
          {children}
        </Button>
      )}

      <form ref={formRef} action={action} className="hidden">
        {hiddenFields &&
          Object.entries(hiddenFields).map(([k, v]) =>
            v === undefined ? null : (
              <input key={k} type="hidden" name={k} value={String(v)} />
            )
          )}
        <button
          ref={submitRef}
          type="submit"
          name={name}
          value={value}
          formAction={formAction}
          tabIndex={-1}
          aria-hidden="true"
        />
        <FormPending onPending={onPending} />
      </form>

      <ConfirmDialog
        isOpen={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        variant={variant}
        requireText={requireText}
        details={details}
        preview={preview}
        onConfirm={handleConfirm}
        busy={busy}
      />
    </>
  )
}
