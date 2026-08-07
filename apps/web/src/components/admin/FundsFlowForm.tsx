"use client"

import { useState, useTransition } from "react"

import {
  saveFundsFlowConfiguration,
  type FundsFlowFormResult,
} from "@/app/(app)/admin/payments/actions"

/**
 * PAY-070-003 — the form the liability gate refuses.
 *
 * Every responsibility axis is a select with a blank option, and the blank one
 * is the default. That is deliberate: Bible §6 requires an explicit decision
 * per axis, so the form must be capable of submitting an unanswered one and the
 * server must be what refuses it. A form that pre-filled "TENANT" would make
 * the gate untestable through the UI and would put the default back exactly
 * where the requirement takes it out.
 *
 * The result is rendered rather than thrown away: a refusal names the code, the
 * reason and every blocker, and when the refusal raised an exception request it
 * says which one, so the operator's next action is a link rather than a guess.
 */
export function FundsFlowForm({
  organizations,
  capabilities,
  axes,
  parties,
}: {
  organizations: { id: string; name: string }[]
  capabilities: { id: string; state: string }[]
  axes: string[]
  parties: string[]
}) {
  const [result, setResult] = useState<FundsFlowFormResult | null>(null)
  const [pending, start] = useTransition()
  const [flow, setFlow] = useState<"direct" | "destination" | "separate_charges_and_transfers">(
    "direct",
  )

  return (
    <form
      className="space-y-4 px-5 py-4"
      action={(formData: FormData) => {
        const organizationId = String(formData.get("organizationId") ?? "")
        start(async () => {
          setResult(await saveFundsFlowConfiguration(organizationId, formData))
        })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Club
          <select name="organizationId" className="mt-1 w-full" required>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          Capability
          <select name="capabilityId" className="mt-1 w-full" required>
            {capabilities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} — {c.state}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          Seller legal entity
          <input name="legalEntityId" className="mt-1 w-full" required />
        </label>

        <label className="text-sm">
          Connected account
          <input name="connectedAccountId" className="mt-1 w-full" />
        </label>

        <label className="text-sm">
          Seller country
          <input name="sellerCountry" className="mt-1 w-full" maxLength={2} required />
        </label>

        <label className="text-sm">
          Buyer country
          <input name="buyerCountry" className="mt-1 w-full" maxLength={2} required />
        </label>

        <label className="text-sm">
          Acquiring region
          <input name="region" className="mt-1 w-full" maxLength={2} required />
        </label>

        <label className="text-sm">
          Currency
          <input name="currency" className="mt-1 w-full" maxLength={3} required />
        </label>

        <label className="text-sm">
          Gross (minor units)
          <input name="grossCents" type="number" className="mt-1 w-full" defaultValue={0} />
        </label>

        <label className="text-sm">
          Platform fee (minor units)
          <input name="platformFeeCents" type="number" className="mt-1 w-full" defaultValue={0} />
        </label>

        <label className="text-sm">
          Loss is carried by
          <select name="lossBearer" className="mt-1 w-full" defaultValue="">
            <option value="">— not decided —</option>
            {parties.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          Configure the axes for
          <select
            className="mt-1 w-full"
            value={flow}
            onChange={(e) => setFlow(e.target.value as typeof flow)}
          >
            <option value="direct">direct</option>
            <option value="destination">destination</option>
            <option value="separate_charges_and_transfers">separate charges and transfers</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="chargesEnabled" defaultChecked /> charges enabled
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="payoutsEnabled" defaultChecked /> payouts enabled
      </label>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="text-sm text-text-2">
          Responsibility — all eight, for the {flow.replace(/_/g, " ")} flow
        </legend>
        {axes.map((axis) => (
          <label className="text-sm" key={axis}>
            {axis}
            <select name={`${flow}.${axis}`} className="mt-1 w-full" defaultValue="">
              <option value="">— not decided —</option>
              {parties.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      <button type="submit" disabled={pending}>
        {pending ? "Deciding…" : "Decide and save"}
      </button>

      {result && !result.ok && (
        <div data-testid="funds-flow-refusal" className="rounded-lg border border-border px-4 py-3 text-sm">
          <p className="text-text-1">{result.code}</p>
          <p className="text-text-2">{result.reason}</p>
          {result.approvalId && (
            <p className="text-text-2">Exception request: {result.approvalId}</p>
          )}
          <ul className="mt-2 list-disc pl-5 text-text-3">
            {result.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {result && result.ok && (
        <div data-testid="funds-flow-saved" className="rounded-lg border border-border px-4 py-3 text-sm">
          <p className="text-text-1">
            {result.chargeModel} — loss carried by {result.liableParty}
          </p>
          <ul className="mt-2 list-disc pl-5 text-text-3">
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  )
}
