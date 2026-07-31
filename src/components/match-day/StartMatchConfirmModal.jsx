import { ConfirmModal } from '../ui/ConfirmModal.jsx'
import { getMatchDayDisplayName } from '../../lib/matchday-display.js'
import { getFixtureKickoffLabel } from '../../lib/calendar-datetime-integrity.js'

function getScorerLabel(match, scorerLabel) {
  if (String(scorerLabel || '').trim()) {
    return String(scorerLabel).trim()
  }

  return match?.isScorer ? 'Selected parent scorer' : 'Authorised staff member'
}

export function StartMatchConfirmModal({
  isBusy = false,
  isOpen,
  match,
  onCancel,
  onConfirm,
  scorerLabel = '',
}) {
  if (!match) {
    return null
  }

  const kickoffLabel = getFixtureKickoffLabel(match) || 'To be confirmed'
  const durationLabel = `${Number(match.matchDurationMinutes || 90)} minutes`

  return (
    <ConfirmModal
      cancelLabel="Cancel"
      confirmLabel="Start match"
      isBusy={isBusy}
      isOpen={isOpen}
      items={[
        `Fixture: ${getMatchDayDisplayName(match)}`,
        `Scheduled kick-off: ${kickoffLabel}`,
        `Match duration: ${durationLabel}`,
        `Scorer: ${getScorerLabel(match, scorerLabel)}`,
      ]}
      itemsTitle="Match details"
      message="Starting the match will begin the game timer and make live scoring controls available."
      onCancel={onCancel}
      onClose={onCancel}
      onConfirm={onConfirm}
      title="Start this match?"
    >
      {match.isBeforeKickoff ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-900" role="status">
          This is before the scheduled kick-off time. Start only if the teams are ready to begin early.
        </div>
      ) : null}
    </ConfirmModal>
  )
}
