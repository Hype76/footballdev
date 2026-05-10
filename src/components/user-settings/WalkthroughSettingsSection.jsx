import { SectionCard } from '../ui/SectionCard.jsx'

export function WalkthroughSettingsSection({
  disabled,
  onDisabledChange,
  onRestart,
}) {
  return (
    <SectionCard
      title="Walkthrough"
      description="Control guided page walkthroughs for this account."
    >
      <div className="space-y-4">
        <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={disabled}
            onChange={onDisabledChange}
            className="h-4 w-4 rounded border-[var(--border-color)]"
          />
          <span>Disable walkthroughs</span>
        </label>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
        >
          Restart walkthrough
        </button>
        <p className="text-xs leading-5 text-[var(--text-muted)]">
          Walkthroughs only show information that matches your current role, plan, and page access.
        </p>
      </div>
    </SectionCard>
  )
}
