import { formatTrendDate } from '../../hooks/players/playerProfileUtils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function PlayerOverview({
  evaluationCount,
  fieldMovement,
  lastSection,
  overallAverage,
  playerName,
  ratingTrend,
  ratingTrendMax,
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Player name</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{playerName}</p>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Total evaluations</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{evaluationCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Average score</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
            {overallAverage !== null ? overallAverage.toFixed(1) : '-'}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Latest section</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{lastSection}</p>
        </div>
      </div>

      <SectionCard
        title="Rating trend"
        description="Shows how the player's assessment scores are moving over time."
      >
        {ratingTrend.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No scored evaluations yet.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {ratingTrend.map((evaluation) => {
                const scorePercent = Math.max(0, Math.min(100, (Number(evaluation.averageScore) / ratingTrendMax) * 100))

                return (
                  <div key={evaluation.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{formatTrendDate(evaluation)}</p>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{evaluation.averageScore.toFixed(1)}</p>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--panel-soft)]">
                      <div
                        className="h-full rounded-full bg-[var(--button-primary)]"
                        style={{ width: `${scorePercent}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      {evaluation.section || 'Trial'}
                    </p>
                  </div>
                )
              })}
            </div>

            {fieldMovement.length > 0 ? (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Field movement</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {fieldMovement.map((item) => (
                    <div key={item.label} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{item.label}</p>
                      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                        {item.firstValue} to {item.latestValue}
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {item.change > 0 ? '+' : ''}{item.change.toFixed(1)} change
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>
    </>
  )
}
