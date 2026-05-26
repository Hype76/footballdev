import { formatTrendDate } from '../../hooks/players/playerProfileUtils.js'
import { MicIcon } from '../icons/MicIcon.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'
import { PlayerStatePanel } from './PlayerStatePanel.jsx'

const metricCardClass = 'rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-sm shadow-[#2563eb]/10'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]'

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
              <p className="mt-3 break-words text-2xl font-black text-[#0f172a]">{playerName}</p>
            </div>
            <button
              type="button"
              onClick={isRecordingVoiceNote ? onStopVoiceNote : onStartVoiceNote}
              disabled={isSavingVoiceNote || !primaryPlayer?.id}
              aria-label={isRecordingVoiceNote ? `Stop voice note recording for ${playerName}` : `Record voice note for ${playerName}`}
              title={voiceNoteDisabledReason || (isRecordingVoiceNote ? 'Stop recording' : 'Voice note')}
              className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border px-3 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
                isRecordingVoiceNote
                  ? 'border-[#fecdca] bg-[#b42318] text-white hover:bg-[#912018]'
                  : 'border-[#cbd5e1] bg-[#f8fafc] text-[#0f172a] hover:bg-[#eff6ff]'
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
          <p className="mt-3 text-2xl font-black text-[#0f172a]">{evaluationCount}</p>
        </div>
        <div className={metricCardClass}>
          <p className={eyebrowClass}>Average score</p>
          <p className="mt-3 text-2xl font-black text-[#0f172a]">
            {overallAverage !== null ? overallAverage.toFixed(1) : '-'}
          </p>
        </div>
        <div className={metricCardClass}>
          <p className={eyebrowClass}>Latest section</p>
          <p className="mt-3 text-2xl font-black text-[#0f172a]">{lastSection}</p>
        </div>
      </div>

      <SectionCard
        title="Rating trend"
        description="Shows how the player's development scores are moving over time."
      >
        {ratingTrend.length === 0 ? (
          <PlayerStatePanel
            action="Create or complete a development record with numeric scores to start the trend."
            body="The trend needs at least one scored development record. Notes, messages, and profile details can exist before the first score."
            eyebrow="Profile trend"
            title="No scored development records are available yet."
          />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {ratingTrend.map((evaluation) => {
                const scorePercent = Math.max(0, Math.min(100, (Number(evaluation.averageScore) / ratingTrendMax) * 100))

                return (
                  <div key={evaluation.id} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-[#0f172a]">{formatTrendDate(evaluation)}</p>
                      <p className="text-sm font-black text-[#0f172a]">{evaluation.averageScore.toFixed(1)}</p>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-lg bg-[#dbeafe]">
                      <div
                        className="h-full rounded-lg bg-[#2563eb]"
                        style={{ width: `${scorePercent}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">
                      {evaluation.section || 'Trial'}
                    </p>
                  </div>
                )
              })}
            </div>

            {fieldMovement.length > 0 ? (
              <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10">
                <p className="text-sm font-black text-[#0f172a]">Field movement</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {fieldMovement.map((item) => (
                    <div key={item.label} className="rounded-lg border border-[#cbd5e1] bg-white px-4 py-3 shadow-sm shadow-[#2563eb]/10">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">{item.label}</p>
                      <p className="mt-2 text-sm font-black text-[#0f172a]">
                        {item.firstValue} to {item.latestValue}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[#475569]">
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
