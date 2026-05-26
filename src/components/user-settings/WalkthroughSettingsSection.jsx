import { SectionCard } from '../ui/SectionCard.jsx'

export function WalkthroughSettingsSection({
  isRestarting,
  onRestart,
  scopeLabel,
}) {
  return (
    <SectionCard
      title="Setup checklist"
      description="Reopen the first-run checklist for the current workspace or account."
      tourId="walkthrough-settings"
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={onRestart}
          disabled={isRestarting}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#bddcca] bg-white px-5 py-3 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10 transition hover:border-[#20a464] hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isRestarting ? 'Opening setup...' : 'Open setup checklist'}
        </button>
        <p className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-xs font-semibold leading-5 text-[#456653] shadow-sm shadow-[#067a46]/10">
          This clears skipped setup for this {scopeLabel} and shows the checklist again above the page.
        </p>
      </div>
    </SectionCard>
  )
}
