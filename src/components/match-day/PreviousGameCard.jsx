function formatPreviousMatchDate(match) {
  if (!match.matchDate) {
    return 'Date not set'
  }

  const date = new Date(`${match.matchDate}T${match.kickoffTime || '00:00'}`)

  if (Number.isNaN(date.getTime())) {
    return match.matchDate
  }

  return date.toLocaleString([], {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: match.kickoffTime ? '2-digit' : undefined,
    minute: match.kickoffTime ? '2-digit' : undefined,
  })
}

function getClubScore(match) {
  return match.homeAway === 'away' ? match.awayScore : match.homeScore
}

function getOpponentScore(match) {
  return match.homeAway === 'away' ? match.homeScore : match.awayScore
}

function getGoalEvents(match) {
  return Array.isArray(match.events)
    ? match.events.filter((event) => event.eventType === 'goal')
    : []
}

function formatGoalLine(event) {
  const scorer = event.scorerInitials || event.scorerName || 'Player'
  const assist = event.assistInitials || event.assistName
  const score = Number.isFinite(Number(event.homeScore)) && Number.isFinite(Number(event.awayScore))
    ? ` | ${event.homeScore} - ${event.awayScore}`
    : ''

  return [
    event.minute !== null && event.minute !== undefined ? `${event.minute} min` : '',
    `Goal: ${scorer}${event.scorerShirtNumber ? ` #${event.scorerShirtNumber}` : ''}`,
    assist ? `Assist ${assist}${event.assistShirtNumber ? ` #${event.assistShirtNumber}` : ''}` : '',
    score,
  ].filter(Boolean).join(' | ')
}

export function PreviousGameCard({ match, onOpen }) {
  const goals = getGoalEvents(match)

  return (
    <button
      type="button"
      onClick={() => onOpen(match)}
      className="block w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 text-left transition hover:border-[var(--accent)] hover:bg-[var(--panel-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{formatPreviousMatchDate(match)}</p>
      <h4 className="mt-2 text-base font-semibold text-[var(--text-primary)]">{match.teamName || 'Our team'} v {match.opponent}</h4>
      <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">
        {getClubScore(match)} - {getOpponentScore(match)}
      </p>
      {goals.length > 0 ? (
        <div className="mt-3 space-y-2">
          {goals.slice(0, 4).map((event) => (
            <p key={event.id} className="text-xs text-[var(--text-muted)]">{formatGoalLine(event)}</p>
          ))}
          {goals.length > 4 ? (
            <p className="text-xs font-semibold text-[var(--text-secondary)]">View {goals.length - 4} more</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--text-muted)]">{match.status.replace(/_/g, ' ')}</p>
      )}
    </button>
  )
}

export function PreviousGameDetailModal({ match, onClose }) {
  if (!match) {
    return null
  }

  const goals = getGoalEvents(match)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-3 py-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Previous game details">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 shadow-xl sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{formatPreviousMatchDate(match)}</p>
            <h3 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">{match.teamName || 'Our team'} v {match.opponent}</h3>
            <p className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">
              {getClubScore(match)} - {getOpponentScore(match)}
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{match.status.replace(/_/g, ' ')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Venue</p>
            <p className="mt-2 text-sm text-[var(--text-primary)]">{match.venueName || 'Venue not set'}</p>
            {match.venueAddress ? <p className="mt-1 text-sm text-[var(--text-muted)]">{match.venueAddress}</p> : null}
          </div>
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Result</p>
            <p className="mt-2 text-sm text-[var(--text-primary)]">{match.homeAway} game</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{goals.length} {goals.length === 1 ? 'goal recorded' : 'goals recorded'}</p>
          </div>
        </div>

        <div className="mt-5">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">Goal details</h4>
          {goals.length > 0 ? (
            <div className="mt-3 space-y-2">
              {goals.map((event) => (
                <div key={event.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{formatGoalLine(event)}</p>
                  {event.notes ? <p className="mt-1 text-xs text-[var(--text-muted)]">{event.notes}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
              No goals were recorded for this match.
            </p>
          )}
        </div>

        {match.notes ? (
          <div className="mt-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-muted)]">{match.notes}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
