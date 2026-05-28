import { SectionCard } from '../ui/SectionCard.jsx'
import { PLAN_OPTIONS } from '../../lib/plans.js'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'

export function ManageClubsSection({
  createdInviteUrl = '',
  form,
  isSaving,
  onChange,
  onSubmit,
}) {
  const handleCopyInviteUrl = async () => {
    if (!createdInviteUrl || !navigator?.clipboard?.writeText) {
      return
    }

    await navigator.clipboard.writeText(createdInviteUrl)
  }

  return (
    <SectionCard
      title="Manage clubs"
      description="Create clubs, choose billing access, and send the first club admin invite."
    >
      <form onSubmit={onSubmit} className="grid gap-4 xl:grid-cols-3">
        <label className="block">
          <span className={labelClass}>Club name</span>
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
            {PLAN_OPTIONS.map((plan) => (
              <option key={plan.key} value={plan.key} disabled={form.billingMode === 'paid' && plan.key === 'individual'}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Billing access</span>
          <select
            value={form.billingMode}
            onChange={(event) => onChange('billingMode', event.target.value)}
            className={fieldClass}
          >
            <option value="paid">Paid, show payments</option>
            <option value="unpaid">Unpaid, hide payments</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={isSaving}
          title={isSaving ? 'Please wait while the club is being added.' : undefined}
          className={`${primaryButtonClass} xl:self-end`}
        >
          {isSaving ? 'Sending invite...' : 'Add club and invite'}
        </button>
      </form>
      {createdInviteUrl ? (
        <div className="mt-4 rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-4">
          <p className="text-sm font-black text-[#101828]">Staging invite link</p>
          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
            Emails are skipped on staging. Send this link manually to test setup.
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
    </SectionCard>
  )
}
