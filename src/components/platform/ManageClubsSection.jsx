import { useState } from 'react'
import { SectionCard } from '../ui/SectionCard.jsx'
import { PLAN_KEYS, getAdminAssignablePlanOptions } from '../../lib/plans.js'
import { getWorkspaceScope } from '../../lib/workspace-scope.js'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const adminAssignablePlanOptions = getAdminAssignablePlanOptions()

function isPlanUnavailableForBillingMode(plan, billingArrangement) {
  return billingArrangement !== 'complimentary' && plan.key === PLAN_KEYS.individual
}

export function ManageClubsSection({
  accessToken = '',
  createdInvite = null,
  form,
  isSaving,
  onChange,
  onSubmit,
}) {
  const [transferForm, setTransferForm] = useState({ teamId: '', destinationClubId: '' })
  const [transfer, setTransfer] = useState(null)
  const [transferError, setTransferError] = useState('')
  const [isTransferSaving, setIsTransferSaving] = useState(false)
  const createdInviteUrl = String(createdInvite?.url ?? '').trim()
  const deliveryStatus = String(createdInvite?.deliveryStatus ?? '').trim()
  const deliveryReason = String(createdInvite?.deliveryReason ?? '').trim()
  const inviteWasSent = Boolean(createdInvite?.sent)
  const inviteEmailFailed = Boolean(createdInvite?.emailFailed)
  const selectedScope = getWorkspaceScope(form.planKey)
  const createdScopeLabel = createdInvite?.scope === 'team'
    ? 'Team'
    : createdInvite?.scope === 'individual' ? 'Individual' : 'Club'
  const inviteTitle = inviteWasSent
    ? 'Invite link backup'
    : deliveryStatus === 'skipped' || inviteEmailFailed || deliveryStatus === 'configuration_error'
      ? 'Manual invite link'
      : `${createdScopeLabel} invite link`
  const inviteDescription = createdInvite?.deliveryMessage || (
    deliveryStatus === 'configuration_error' || deliveryReason === 'missing_email_configuration'
      ? 'Invite email could not be sent because production email is not configured. Use the manual invite link below and contact platform support.'
      : inviteEmailFailed
        ? 'Invite email could not be sent. Use the manual invite link below.'
      : inviteWasSent
        ? 'Invite email accepted for delivery.'
        : 'Email delivery was skipped by environment policy. Send this link manually to test setup.'
  )

  const handleCopyInviteUrl = async () => {
    if (!createdInviteUrl || !navigator?.clipboard?.writeText) {
      return
    }

    await navigator.clipboard.writeText(createdInviteUrl)
  }

  const runTransferAction = async (action, values = {}) => {
    setIsTransferSaving(true)
    setTransferError('')

    try {
      const response = await fetch('/.netlify/functions/manage-workspace-team-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action, ...values }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'The controlled Team transfer could not be updated.')
      }

      setTransfer(result.transfer)
    } catch (error) {
      setTransferError(error.message || 'The controlled Team transfer could not be updated.')
    } finally {
      setIsTransferSaving(false)
    }
  }

  const handleCreateTransfer = async (event) => {
    event.preventDefault()
    await runTransferAction('create', transferForm)
  }

  return (
    <SectionCard
      title="Manage workspaces"
      description="Create an Individual, Team, or Club workspace from the selected plan and send the correct owner invite."
    >
      <form onSubmit={onSubmit} className="grid gap-4 xl:grid-cols-3">
        <label className="block">
          <span className={labelClass}>{selectedScope.entityLabel} name</span>
          <input
            required
            value={form.name}
            onChange={(event) => onChange('name', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Owner invite email</span>
          <input
            required
            type="email"
            value={form.ownerEmail}
            onChange={(event) => onChange('ownerEmail', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Contact email</span>
          <input
            type="email"
            value={form.contactEmail}
            onChange={(event) => onChange('contactEmail', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Contact phone</span>
          <input
            value={form.contactPhone}
            onChange={(event) => onChange('contactPhone', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Plan</span>
          <select
            value={form.planKey}
            onChange={(event) => onChange('planKey', event.target.value)}
            className={fieldClass}
          >
            {adminAssignablePlanOptions.map((plan) => (
              <option key={plan.key} value={plan.key} disabled={isPlanUnavailableForBillingMode(plan, form.billingArrangement)}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Billing access</span>
          <select
            value={form.billingArrangement}
            onChange={(event) => onChange('billingArrangement', event.target.value)}
            className={fieldClass}
          >
            <option value="immediate" disabled={[PLAN_KEYS.individual, PLAN_KEYS.pilot].includes(form.planKey)}>Payment starts immediately</option>
            <option value="deferred" disabled={[PLAN_KEYS.individual, PLAN_KEYS.pilot].includes(form.planKey)}>Payment starts on a future date</option>
            <option value="complimentary">Complimentary access</option>
          </select>
        </label>
        {form.billingArrangement === 'deferred' ? (
          <label className="block">
            <span className={labelClass}>Billing start date</span>
            <input
              required
              type="date"
              value={form.billingStartDate}
              onChange={(event) => onChange('billingStartDate', event.target.value)}
              className={fieldClass}
            />
          </label>
        ) : null}
        <button
          type="submit"
          disabled={isSaving}
          title={isSaving ? 'Please wait while the workspace is being added.' : undefined}
          className={`${primaryButtonClass} xl:self-end`}
        >
          {isSaving ? 'Sending invite...' : `Add ${selectedScope.entityLabelLower} and invite`}
        </button>
      </form>
      {createdInviteUrl ? (
        <div className="mt-4 rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-4">
          <p className="text-sm font-black text-[#101828]">{inviteTitle}</p>
          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
            {inviteDescription}
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
            <input
              readOnly
              value={createdInviteUrl}
              className={fieldClass}
              onFocus={(event) => event.target.select()}
            />
            <button
              type="button"
              onClick={() => void handleCopyInviteUrl()}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#f7faf8]"
            >
              Copy link
            </button>
            <a
              href={createdInviteUrl}
              target="_blank"
              rel="noreferrer"
              className={primaryButtonClass}
            >
              Open invite
            </a>
          </div>
        </div>
      ) : null}
      <div className="mt-6 border-t border-[#d7e5dc] pt-6">
        <h3 className="text-lg font-black text-[#101828]">Controlled Team transfer</h3>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
          Start a transfer only after identifying the existing Single Team and destination Club. The source Team Admin and destination Club Admin must both approve before Platform Admin can complete it.
        </p>
        <form className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_auto]" onSubmit={handleCreateTransfer}>
          <label className="block">
            <span className={labelClass}>Existing Team ID</span>
            <input
              required
              value={transferForm.teamId}
              onChange={(event) => setTransferForm((current) => ({ ...current, teamId: event.target.value }))}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Destination Club ID</span>
            <input
              required
              value={transferForm.destinationClubId}
              onChange={(event) => setTransferForm((current) => ({ ...current, destinationClubId: event.target.value }))}
              className={fieldClass}
            />
          </label>
          <button type="submit" disabled={isTransferSaving || !accessToken} className={`${primaryButtonClass} xl:self-end`}>
            {isTransferSaving ? 'Checking...' : 'Create approval request'}
          </button>
        </form>
        {transferError ? <p className="mt-3 text-sm font-bold text-[#b42318]">{transferError}</p> : null}
        {transfer ? (
          <div className="mt-4 rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-4 text-sm font-semibold text-[#4b5f55]">
            <p className="font-black text-[#101828]">{transfer.teamName}: {transfer.status}</p>
            <p className="mt-1">Source approval: {transfer.sourceApproved ? 'Approved' : 'Pending'}</p>
            <p>Destination approval: {transfer.destinationApproved ? 'Approved' : 'Pending'}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <a
                href={`/team-transfer/${transfer.id}`}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#047857] bg-white px-4 py-2 font-black text-[#047857]"
              >
                Open approval page
              </a>
              <button
                type="button"
                disabled={isTransferSaving}
                onClick={() => void runTransferAction('view', { requestId: transfer.id })}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-2 font-black text-[#101828]"
              >
                Refresh
              </button>
              {transfer.status === 'ready' ? (
                <button
                  type="button"
                  disabled={isTransferSaving}
                  onClick={() => void runTransferAction('complete', { requestId: transfer.id })}
                  className={primaryButtonClass}
                >
                  Complete preserved transfer
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  )
}
