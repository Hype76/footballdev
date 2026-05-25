import { testerPlanOptions } from '../../lib/platform-billing-utils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

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
          <span className="mb-2 block text-sm font-semibold text-slate-950">Label</span>
          <input
            value={testerCodeForm.label}
            onChange={(event) => onTesterCodeChange('label', event.target.value)}
            placeholder="Cambourne tester"
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Access code</span>
          <input
            required
            value={testerCodeForm.code}
            onChange={(event) => onTesterCodeChange('code', event.target.value)}
            placeholder="TESTER-30"
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm uppercase text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Plan level</span>
          <select
            value={testerCodeForm.planKey}
            onChange={(event) => onTesterCodeChange('planKey', event.target.value)}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          >
            {testerPlanOptions.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {plan.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Runs for days</span>
          <input
            required
            type="number"
            min="1"
            value={testerCodeForm.expiresInDays}
            onChange={(event) => onTesterCodeChange('expiresInDays', event.target.value)}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Max uses</span>
          <input
            required
            type="number"
            min="1"
            value={testerCodeForm.maxUses}
            onChange={(event) => onTesterCodeChange('maxUses', event.target.value)}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <label className="block xl:col-span-2">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Assigned email</span>
          <input
            type="email"
            value={testerCodeForm.assignedEmail}
            onChange={(event) => onTesterCodeChange('assignedEmail', event.target.value)}
            placeholder="Optional. Leave blank for any email."
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <div className="xl:col-span-4">
          <button
            type="submit"
            disabled={isSavingTesterCode}
            title={isSavingTesterCode ? 'Please wait while this tester code is being created.' : undefined}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSavingTesterCode ? 'Creating...' : 'Create Tester Code'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}
