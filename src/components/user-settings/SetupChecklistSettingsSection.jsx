import { SectionCard } from '../ui/SectionCard.jsx'

export function SetupChecklistSettingsSection({
  isRestarting,
  onRestart,
  scopeLabel,
}) {
  return (
    <SectionCard
      title="Setup checklist"
      description="Reopen the first-run checklist for the current workspace or account."
      tourId="setup-checklist-settings"
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={onRestart}
          disabled={isRestarting}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isRestarting ? 'Opening setup...' : 'Open setup checklist'}
        </button>
        <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-xs font-semibold leading-5 text-[#4b5f55] shadow-sm shadow-[#047857]/10">
          This resets setup state for this {scopeLabel} and shows the checklist above the page again.
        </p>
      </div>
    </SectionCard>
  )
}
