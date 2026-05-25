import { SectionCard } from '../ui/SectionCard.jsx'

export function WalkthroughSettingsSection({
  isRestarting,
  onRestart,
  scopeLabel,
}) {
  return (
    <SectionCard
      title="Onboarding"
      description="Restart the first-run setup flow for this workspace or account."
      tourId="walkthrough-settings"
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={onRestart}
          disabled={isRestarting}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
        >
          {isRestarting ? 'Restarting...' : 'Restart onboarding'}
        </button>
        <p className="text-xs leading-5 text-[var(--text-muted)]">
          This reopens the {scopeLabel} setup checklist and clears skipped onboarding for your current role.
        </p>
      </div>
    </SectionCard>
  )
}
