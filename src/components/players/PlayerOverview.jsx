import { formatTrendDate } from '../../hooks/players/playerProfileUtils.js'
import { MicIcon } from '../icons/MicIcon.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const metricCardClass = 'rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#067a46]'

export function PlayerOverview({
  evaluationCount,
  fieldMovement,
  isRecordingVoiceNote,
  isSavingVoiceNote,
  lastSection,
  onStartVoiceNote,
  onStopVoiceNote,
  overallAverage,
  playerName,
  primaryPlayer,
  ratingTrend,
  ratingTrendMax,
}) {
  const voiceNoteDisabledReason = isSavingVoiceNote
    ? 'Please wait while the voice note is being saved.'
    : !primaryPlayer?.id
      ? 'Open a saved player before recording a voice note.'
      : undefined

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className={metricCardClass}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={eyebrowClass}>Player name</p>
              <p className="mt-3 break-words text-2xl font-black text-[#101828]">{playerName}</p>
            </div>
            <button
              type="button"
              onClick={isRecordingVoiceNote ? onStopVoiceNote : onStartVoiceNote}
              disabled={isSavingVoiceNote || !primaryPlayer?.id}
              aria-label={isRecordingVoiceNote ? `Stop voice note recording for ${playerName}` : `Record voice note for ${playerName}`}
              title={voiceNoteDisabledReason || (isRecordingVoiceNote ? 'Stop recording' : 'Voice note')}
              className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border px-3 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
                isRecordingVoiceNote
                  ? 'border-red-500/50 bg-red-600 text-white hover:bg-red-700'
                  : 'border-slate-200 bg-[#f9fafb] text-[#101828] hover:bg-slate-100'
              }`}
            >
              <MicIcon />
              <span className="sr-only">
                {isRecordingVoiceNote ? 'Stop Recording' : isSavingVoiceNote ? 'Saving Voice Note...' : 'Voice Note'}
              </span>
            </button>
          </div>
        </div>
        <div className={metricCardClass}>
          <p className={eyebrowClass}>Total records</p>
          <p className="mt-3 text-2xl font-black text-[#101828]">{evaluationCount}</p>
        </div>
        <div className={metricCardClass}>
          <p className={eyebrowClass}>Average score</p>
          <p className="mt-3 text-2xl font-black text-[#101828]">
            {overallAverage !== null ? overallAverage.toFixed(1) : '-'}
          </p>
        </div>
        <div className={metricCardClass}>
          <p className={eyebrowClass}>Latest section</p>
          <p className="mt-3 text-2xl font-black text-[#101828]">{lastSection}</p>
        </div>
      </div>

      <SectionCard
        title="Rating trend"
        description="Shows how the player's development scores are moving over time."
      >
        {ratingTrend.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-[#f9fafb] px-4 py-6 text-sm font-bold text-[#667085]">
            No scored development records yet.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {ratingTrend.map((evaluation) => {
                const scorePercent = Math.max(0, Math.min(100, (Number(evaluation.averageScore) / ratingTrendMax) * 100))

                return (
                  <div key={evaluation.id} className="rounded-lg border border-slate-200 bg-[#f9fafb] p-4 shadow-sm shadow-slate-200/60">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-[#101828]">{formatTrendDate(evaluation)}</p>
                      <p className="text-sm font-black text-[#101828]">{evaluation.averageScore.toFixed(1)}</p>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#e7f8ee]">
                      <div
                        className="h-full rounded-full bg-[#067a46]"
                        style={{ width: `${scorePercent}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">
                      {evaluation.section || 'Trial'}
                    </p>
                  </div>
                )
              })}
            </div>

            {fieldMovement.length > 0 ? (
              <div className="rounded-lg border border-slate-200 bg-[#f9fafb] p-4 shadow-sm shadow-slate-200/60">
                <p className="text-sm font-black text-[#101828]">Field movement</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {fieldMovement.map((item) => (
                    <div key={item.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-200/60">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">{item.label}</p>
                      <p className="mt-2 text-sm font-black text-[#101828]">
                        {item.firstValue} to {item.latestValue}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[#667085]">
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
