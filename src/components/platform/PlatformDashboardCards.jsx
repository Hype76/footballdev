import { SectionCard } from '../ui/SectionCard.jsx'

export function PlatformPlanMixSection({ planBreakdown, platformTotals }) {
  return (
    <SectionCard
      title="Plan mix"
      description="How active club workspaces are currently distributed."
    >
      <div className="space-y-3">
        {Object.entries(planBreakdown).length > 0 ? (
          Object.entries(planBreakdown).map(([planName, count]) => (
            <div key={planName} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{planName}</p>
                <p className="text-lg font-semibold text-[var(--accent)]">{count}</p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel-bg)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all duration-700"
                  style={{
                    width: `${Math.max(8, Math.round((count / Math.max(1, platformTotals.clubs ?? 1)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 text-sm text-[var(--text-muted)]">
            No plan data is available yet.
          </p>
        )}
      </div>
    </SectionCard>
  )
}

export function PlatformDataHygieneSection({ platformTotals }) {
  return (
    <SectionCard
      title="Data hygiene"
      description="Separated live records from archived and internal platform records."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Active players</p>
          <p className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{platformTotals.players ?? 0}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{platformTotals.archivedPlayers ?? 0} archived records excluded</p>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Share rows</p>
          <p className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{platformTotals.communications ?? 0}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{platformTotals.communicationRows ?? 0} total communication rows</p>
        </div>
      </div>
    </SectionCard>
  )
}
