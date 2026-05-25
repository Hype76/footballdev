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
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 sm:w-auto"
        >
          {isRestarting ? 'Opening setup...' : 'Open setup checklist'}
        </button>
        <p className="text-xs leading-5 text-slate-600">
          This clears skipped setup for this {scopeLabel} and shows the checklist again above the page.
        </p>
      </div>
    </SectionCard>
  )
}
