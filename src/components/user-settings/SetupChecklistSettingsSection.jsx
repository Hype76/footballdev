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
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-5 py-3 text-sm font-black text-[#0f172a] shadow-sm shadow-[#2563eb]/10 transition hover:border-[#3b82f6] hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isRestarting ? 'Opening setup...' : 'Open setup checklist'}
        </button>
        <p className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-xs font-semibold leading-5 text-[#475569] shadow-sm shadow-[#2563eb]/10">
          This clears skipped setup for this {scopeLabel} and shows the checklist again above the page.
        </p>
      </div>
    </SectionCard>
  )
}
