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

function isPastFixture(match) {
  if (match.status === 'full_time') {
    return false
  }

  if (!match.matchDate) {
    return false
  }

  const endOfMatchDay = new Date(`${match.matchDate}T23:59:59`)
  return !Number.isNaN(endOfMatchDay.getTime()) && endOfMatchDay.getTime() < Date.now()
}

function formatPreviousMatchStatus(match) {
  if (isPastFixture(match)) {
    return 'Past fixture'
  }

  return String(match.status ?? 'shared').replace(/_/g, ' ')
}

function formatGoalLine(event) {
  const scorer = event.scorerInitials || event.scorerName || 'Player'
  const assist = event.assistInitials || event.assistName
  const score = Number.isFinite(Number(event.homeScore)) && Number.isFinite(Number(event.awayScore))
    ? ` / ${event.homeScore} - ${event.awayScore}`
    : ''

  return [
    event.minute !== null && event.minute !== undefined ? `${event.minute} min` : '',
    `Goal: ${scorer}${event.scorerShirtNumber ? ` #${event.scorerShirtNumber}` : ''}`,
    assist ? `Assist ${assist}${event.assistShirtNumber ? ` #${event.assistShirtNumber}` : ''}` : '',
    score,
  ].filter(Boolean).join(' / ')
}

const panelClass = 'rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 shadow-sm shadow-[#067a46]/10'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.16em] text-[#456653]'
const bodyClass = 'text-sm font-semibold leading-6 text-[#456653]'

export function PreviousGameCard({ match, onOpen }) {
  const goals = getGoalEvents(match)

  return (
    <button
      type="button"
      onClick={() => onOpen(match)}
      className="block w-full rounded-lg border border-[#bddcca] bg-white p-4 text-left shadow-sm shadow-[#067a46]/10 transition hover:-translate-y-0.5 hover:border-[#20a464] hover:bg-[#f6fbf8] focus:outline-none focus:ring-2 focus:ring-[#20a464]"
    >
      <p className={eyebrowClass}>{formatPreviousMatchDate(match)}</p>
      <h4 className="mt-2 text-base font-black text-[#10231a]">{match.teamName || 'Our team'} v {match.opponent}</h4>
      <p className="mt-2 text-3xl font-black text-[#10231a]">
        {getClubScore(match)} - {getOpponentScore(match)}
      </p>
      {goals.length > 0 ? (
        <div className="mt-3 space-y-2">
          {goals.slice(0, 4).map((event) => (
            <p key={event.id} className="text-xs font-semibold text-[#456653]">{formatGoalLine(event)}</p>
          ))}
          {goals.length > 4 ? (
            <p className="text-xs font-black text-[#067a46]">View {goals.length - 4} more</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs font-semibold text-[#456653]">{formatPreviousMatchStatus(match)}</p>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#10231a]/55 px-3 py-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Previous game details">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#bddcca] bg-white p-4 shadow-xl sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className={eyebrowClass}>{formatPreviousMatchDate(match)}</p>
            <h3 className="mt-2 text-xl font-black text-[#10231a]">{match.teamName || 'Our team'} v {match.opponent}</h3>
            <p className="mt-2 text-4xl font-black text-[#10231a]">
              {getClubScore(match)} - {getOpponentScore(match)}
            </p>
            <p className="mt-1 text-sm font-semibold text-[#456653]">{formatPreviousMatchStatus(match)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-2 text-sm font-black text-[#10231a] transition hover:border-[#20a464] hover:bg-[#f0fdf6]"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className={panelClass}>
            <p className={eyebrowClass}>Venue</p>
            <p className="mt-2 text-sm font-black text-[#10231a]">{match.venueName || 'Venue not set'}</p>
            {match.venueAddress ? <p className={`mt-1 ${bodyClass}`}>{match.venueAddress}</p> : null}
          </div>
          <div className={panelClass}>
            <p className={eyebrowClass}>Result</p>
            <p className="mt-2 text-sm font-black text-[#10231a]">{match.homeAway} game</p>
            <p className={`mt-1 ${bodyClass}`}>{goals.length} {goals.length === 1 ? 'goal recorded' : 'goals recorded'}</p>
          </div>
        </div>

        <div className="mt-5">
          <h4 className="text-sm font-black text-[#10231a]">Goal details</h4>
          {goals.length > 0 ? (
            <div className="mt-3 space-y-2">
              {goals.map((event) => (
                <div key={event.id} className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 shadow-sm shadow-[#067a46]/10">
                  <p className="text-sm font-black text-[#10231a]">{formatGoalLine(event)}</p>
                  {event.notes ? <p className="mt-1 text-xs font-semibold text-[#456653]">{event.notes}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-5">
              <p className="text-sm font-black text-[#10231a]">No goals were recorded for this match.</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">
                Score updates can still exist without scorer detail if staff only tracked the final result.
              </p>
            </div>
          )}
        </div>

        {match.notes ? (
          <div className={`mt-5 ${panelClass}`}>
            <p className={eyebrowClass}>Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#456653]">{match.notes}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
