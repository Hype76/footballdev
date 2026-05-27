import { testerPlanOptions } from '../../lib/platform-billing-utils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const primaryButtonClass = 'inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto'

export function CreateTesterCodeSection({
  isSavingTesterCode,
  onCreateTesterCode,
  onTesterCodeChange,
  testerCodeForm,
}) {
  return (
    <SectionCard
      title="Create tester access code"
      description="Give selected testers temporary plan access without asking for a payment card."
    >
      <form onSubmit={onCreateTesterCode} className="grid gap-4 xl:grid-cols-4">
        <label className="block">
          <span className={labelClass}>Label</span>
          <input
            value={testerCodeForm.label}
            onChange={(event) => onTesterCodeChange('label', event.target.value)}
            placeholder="Cambourne tester"
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Access code</span>
          <input
            required
            value={testerCodeForm.code}
            onChange={(event) => onTesterCodeChange('code', event.target.value)}
            placeholder="TESTER-30"
            className={`${fieldClass} uppercase`}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Plan level</span>
          <select
            value={testerCodeForm.planKey}
            onChange={(event) => onTesterCodeChange('planKey', event.target.value)}
            className={fieldClass}
          >
            {testerPlanOptions.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {plan.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Runs for days</span>
          <input
            required
            type="number"
            min="1"
            value={testerCodeForm.expiresInDays}
            onChange={(event) => onTesterCodeChange('expiresInDays', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Max uses</span>
          <input
            required
            type="number"
            min="1"
            value={testerCodeForm.maxUses}
            onChange={(event) => onTesterCodeChange('maxUses', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block xl:col-span-2">
          <span className={labelClass}>Assigned email</span>
          <input
            type="email"
            value={testerCodeForm.assignedEmail}
            onChange={(event) => onTesterCodeChange('assignedEmail', event.target.value)}
            placeholder="Optional. Leave blank for any email."
            className={fieldClass}
          />
        </label>
        <div className="xl:col-span-4">
          <button
            type="submit"
            disabled={isSavingTesterCode}
            title={isSavingTesterCode ? 'Please wait while this tester code is being created.' : undefined}
            className={primaryButtonClass}
          >
            {isSavingTesterCode ? 'Creating...' : 'Create tester code'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}
