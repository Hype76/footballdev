import { SectionCard } from '../ui/SectionCard.jsx'

export function SetupChecklistSettingsSection({
  isHidden,
  isLoading,
  isOpening,
  nextStep,
  onOpen,
  plan,
  progress,
  scopeLabel,
}) {
  const completedCount = Number(progress?.completedCount ?? 0)
  const totalCount = Number(progress?.totalCount ?? 0)
  const progressPercent = totalCount ? (completedCount / totalCount) * 100 : 0
  const title = plan?.title || 'Team setup'
  const nextStepTitle = nextStep?.title || 'No required step left'
  const nextStepAction = nextStep?.actionLabel || 'Open setup'

  return (
    <SectionCard
      title="Team setup"
      description="Review setup progress and reopen the checklist from Settings without pushing normal pages down."
      tourId="setup-checklist-settings"
    >
      <div className="space-y-4" data-testid="settings-team-setup">
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 shadow-sm shadow-[#047857]/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#4b5f55]">
                {isHidden ? 'Setup hidden' : 'Setup status'}
              </p>
              <h3 className="mt-2 text-xl font-black tracking-tight text-[#101828]">{title}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                {isLoading ? 'Refreshing setup progress.' : `${completedCount} of ${totalCount} setup steps complete.`}
              </p>
            </div>
            <span className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-3 text-xs font-black uppercase tracking-[0.12em] text-[#065f46]">
              Settings
            </span>
          </div>

          <div className="mt-4 h-3 overflow-hidden rounded-lg bg-[#ccfbf1] ring-1 ring-[#d7e5dc]">
            <div
              className="h-full rounded-lg bg-[#047857] transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">Next setup step</p>
            <p className="mt-2 text-sm font-black leading-6 text-[#101828]">{nextStepTitle}</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-[#66756c]">
              Use the setup checklist to continue this {scopeLabel} without changing saved progress.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpen}
          disabled={isOpening}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isOpening ? 'Opening setup...' : isHidden ? 'Reopen setup' : nextStepAction}
        </button>
        <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-xs font-semibold leading-5 text-[#4b5f55] shadow-sm shadow-[#047857]/10">
          Settings is now the home for setup progress and setup reopening. Normal app pages stay focused on their own work.
        </p>
      </div>
    </SectionCard>
  )
}
