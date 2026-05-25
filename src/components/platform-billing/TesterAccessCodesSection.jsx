import { formatDate, testerPlanOptions } from '../../lib/platform-billing-utils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function TesterAccessCodesSection({
  currentTime,
  onToggleTesterCode,
  sortedTesterCodes,
  updatingTesterCodeId,
}) {
  return (
    <SectionCard
      title="Tester access codes"
      description="These codes grant temporary access. Expired tester accounts keep their data and must choose a paid plan to continue."
    >
      {sortedTesterCodes.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
          No tester access codes have been created yet.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedTesterCodes.map((code) => {
            const planLabel = testerPlanOptions.find((plan) => plan.key === code.planKey)?.label || code.planKey
            const hasExpired = code.expiresAt && new Date(code.expiresAt).getTime() <= currentTime

            return (
              <div key={code.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{code.label || code.code}</p>
                    <p className="mt-1 text-sm font-semibold uppercase tracking-[0.14em] text-emerald-700">{code.code}</p>
                  </div>
                  <span className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                    {hasExpired ? 'Expired' : code.isActive ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <p><span className="font-semibold text-slate-950">Plan:</span> {planLabel}</p>
                  <p><span className="font-semibold text-slate-950">Email:</span> {code.assignedEmail || 'Any email'}</p>
                  <p><span className="font-semibold text-slate-950">Uses:</span> {code.redeemedCount} of {code.maxUses}</p>
                  <p><span className="font-semibold text-slate-950">Expires:</span> {formatDate(code.expiresAt)}</p>
                </div>
                <button
                  type="button"
                  disabled={updatingTesterCodeId === code.id}
                  title={updatingTesterCodeId === code.id ? 'Please wait while this tester code is being updated.' : undefined}
                  onClick={() => onToggleTesterCode(code)}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {updatingTesterCodeId === code.id ? 'Saving...' : code.isActive ? 'Disable Code' : 'Enable Code'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}
