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
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
          No tester access codes have been created yet.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedTesterCodes.map((code) => {
            const planLabel = testerPlanOptions.find((plan) => plan.key === code.planKey)?.label || code.planKey
            const hasExpired = code.expiresAt && new Date(code.expiresAt).getTime() <= currentTime

            return (
              <div key={code.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">{code.label || code.code}</p>
                    <p className="mt-1 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">{code.code}</p>
                  </div>
                  <span className="rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    {hasExpired ? 'Expired' : code.isActive ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-sm text-[var(--text-muted)]">
                  <p><span className="font-semibold text-[var(--text-primary)]">Plan:</span> {planLabel}</p>
                  <p><span className="font-semibold text-[var(--text-primary)]">Email:</span> {code.assignedEmail || 'Any email'}</p>
                  <p><span className="font-semibold text-[var(--text-primary)]">Uses:</span> {code.redeemedCount} of {code.maxUses}</p>
                  <p><span className="font-semibold text-[var(--text-primary)]">Expires:</span> {formatDate(code.expiresAt)}</p>
                </div>
                <button
                  type="button"
                  disabled={updatingTesterCodeId === code.id}
                  onClick={() => onToggleTesterCode(code)}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
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
