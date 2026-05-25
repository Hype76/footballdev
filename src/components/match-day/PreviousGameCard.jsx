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
      className="block w-full rounded-md border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
    >
      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{formatPreviousMatchDate(match)}</p>
      <h4 className="mt-2 text-base font-black text-slate-950">{match.teamName || 'Our team'} v {match.opponent}</h4>
      <p className="mt-2 text-3xl font-black text-slate-950">
        {getClubScore(match)} - {getOpponentScore(match)}
      </p>
      {goals.length > 0 ? (
        <div className="mt-3 space-y-2">
          {goals.slice(0, 4).map((event) => (
            <p key={event.id} className="text-xs text-slate-600">{formatGoalLine(event)}</p>
          ))}
          {goals.length > 4 ? (
            <p className="text-xs font-bold text-slate-500">View {goals.length - 4} more</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-600">{match.status.replace(/_/g, ' ')}</p>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 px-3 py-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Previous game details">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-slate-200 bg-white p-4 shadow-xl sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{formatPreviousMatchDate(match)}</p>
            <h3 className="mt-2 text-xl font-black text-slate-950">{match.teamName || 'Our team'} v {match.opponent}</h3>
            <p className="mt-2 text-4xl font-black text-slate-950">
              {getClubScore(match)} - {getOpponentScore(match)}
            </p>
            <p className="mt-1 text-sm text-slate-600">{match.status.replace(/_/g, ' ')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Venue</p>
            <p className="mt-2 text-sm font-bold text-slate-950">{match.venueName || 'Venue not set'}</p>
            {match.venueAddress ? <p className="mt-1 text-sm text-slate-600">{match.venueAddress}</p> : null}
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Result</p>
            <p className="mt-2 text-sm font-bold text-slate-950">{match.homeAway} game</p>
            <p className="mt-1 text-sm text-slate-600">{goals.length} {goals.length === 1 ? 'goal recorded' : 'goals recorded'}</p>
          </div>
        </div>

        <div className="mt-5">
          <h4 className="text-sm font-black text-slate-950">Goal details</h4>
          {goals.length > 0 ? (
            <div className="mt-3 space-y-2">
              {goals.map((event) => (
                <div key={event.id} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-bold text-slate-950">{formatGoalLine(event)}</p>
                  {event.notes ? <p className="mt-1 text-xs text-slate-600">{event.notes}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
              No goals were recorded for this match.
            </p>
          )}
        </div>

        {match.notes ? (
          <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{match.notes}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
