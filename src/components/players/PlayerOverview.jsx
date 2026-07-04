import { formatTrendDate } from '../../hooks/players/playerProfileUtils.js'
import { MicIcon } from '../icons/MicIcon.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'
import { PlayerStatePanel } from './PlayerStatePanel.jsx'

const metricCardClass = 'rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'

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
                  ? 'border-[#fecdca] bg-[#b42318] text-white hover:bg-[#912018]'
                  : 'border-[#d7e5dc] bg-[#f7faf8] text-[#101828] hover:bg-[#ecfdf5]'
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
                  <div key={evaluation.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-[#101828]">{formatTrendDate(evaluation)}</p>
                      <p className="text-sm font-black text-[#101828]">{evaluation.averageScore.toFixed(1)}</p>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-lg bg-[#d1fae5]">
                      <div
                        className="h-full rounded-lg bg-[#047857]"
                        style={{ width: `${scorePercent}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs font-black uppercase tracking-[0.16em] text-[#047857]">
                      {evaluation.section || 'Trial'}
                    </p>
                  </div>
                )
              })}
            </div>

            {fieldMovement.length > 0 ? (
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
                <p className="text-sm font-black text-[#101828]">Field movement</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {fieldMovement.map((item) => (
                    <div key={item.label} className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">{item.label}</p>
                      <dl className="mt-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <dt className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">First recorded</dt>
                          <dd className="text-right text-sm font-black text-[#101828]">
                            {item.firstValue}
                            <span className="block text-xs font-semibold text-[#4b5f55]">{item.firstDateLabel}</span>
                          </dd>
                        </div>
                        {item.previousValue !== null ? (
                          <div className="flex items-start justify-between gap-3">
                            <dt className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Previous record</dt>
                            <dd className="text-right text-sm font-black text-[#101828]">
                              {item.previousValue}
                              <span className="block text-xs font-semibold text-[#4b5f55]">{item.previousDateLabel}</span>
                            </dd>
                          </div>
                        ) : null}
                        <div className="flex items-start justify-between gap-3">
                          <dt className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Current record</dt>
                          <dd className="text-right text-sm font-black text-[#101828]">
                            {item.currentValue}
                            <span className="block text-xs font-semibold text-[#4b5f55]">{item.currentDateLabel}</span>
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-3 border-t border-[#d7e5dc] pt-3 text-sm font-semibold text-[#4b5f55]">
                        {item.change > 0 ? '+' : ''}{item.change.toFixed(1)} change since first recorded
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
