import { getMatchDayDisplayName, getMatchDayDisplayScore } from '../../lib/matchday-display.js'
import { getParentResultDateForDisplay } from '../../lib/parent-results-order.js'
import { formatFixtureDateTime, isFixtureKickoffTimeTbc } from '../../lib/calendar-datetime-integrity.js'

function formatPreviousMatchDate(match) {
  if (isFixtureKickoffTimeTbc(match.kickoffTimeTbc)) {
    return formatFixtureDateTime(match)
  }

  const resolvedDate = getParentResultDateForDisplay(match)

  if (!resolvedDate) {
    if (match.matchDate) {
      return match.matchDate
    }

    return 'Date not set'
  }

  const date = new Date(resolvedDate.value)

  if (Number.isNaN(date.getTime())) {
    return match.matchDate || resolvedDate.value
  }

  return date.toLocaleString([], {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: resolvedDate.hasTime ? '2-digit' : undefined,
    minute: resolvedDate.hasTime ? '2-digit' : undefined,
  })
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
    ? `Score: ${event.homeScore} - ${event.awayScore}`
    : ''

  return [
    event.minute !== null && event.minute !== undefined ? `Minute: ${event.minute}` : '',
    `Goal: ${scorer}${event.scorerShirtNumber ? ` #${event.scorerShirtNumber}` : ''}`,
    assist ? `Assist: ${assist}${event.assistShirtNumber ? ` #${event.assistShirtNumber}` : ''}` : '',
    score,
  ].filter(Boolean).join(', ')
}

const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]'
const bodyClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'

export function PreviousGameCard({ match, onOpen }) {
  const goals = getGoalEvents(match)

  return (
    <button
      type="button"
      onClick={() => onOpen(match)}
      className="block w-full rounded-lg border border-[#d7e5dc] bg-white p-4 text-left shadow-sm shadow-[#047857]/10 transition hover:-translate-y-0.5 hover:border-[#0f9f6e] hover:bg-[#f7faf8] focus:outline-none focus:ring-2 focus:ring-[#0f9f6e]"
    >
      <p className={eyebrowClass}>{formatPreviousMatchDate(match)}</p>
      <h4 className="mt-2 text-base font-black text-[#101828]">{getMatchDayDisplayName(match)}</h4>
      <p className="mt-2 text-3xl font-black text-[#101828]">
        {getMatchDayDisplayScore(match)}
      </p>
      {goals.length > 0 ? (
        <div className="mt-3 space-y-2">
          {goals.slice(0, 4).map((event) => (
            <p key={event.id} className="text-xs font-semibold text-[#4b5f55]">{formatGoalLine(event)}</p>
          ))}
          {goals.length > 4 ? (
            <p className="text-xs font-black text-[#047857]">View {goals.length - 4} more</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs font-semibold text-[#4b5f55]">{formatPreviousMatchStatus(match)}</p>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#101828]/55 px-3 py-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Previous game details">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-xl sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className={eyebrowClass}>{formatPreviousMatchDate(match)}</p>
            <h3 className="mt-2 text-xl font-black text-[#101828]">{getMatchDayDisplayName(match)}</h3>
            <p className="mt-2 text-4xl font-black text-[#101828]">
              {getMatchDayDisplayScore(match)}
            </p>
            <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{formatPreviousMatchStatus(match)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-2 text-sm font-black text-[#101828] transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5]"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className={panelClass}>
            <p className={eyebrowClass}>Venue</p>
            <p className="mt-2 text-sm font-black text-[#101828]">{match.venueName || 'Venue not set'}</p>
            {match.venueAddress ? <p className={`mt-1 ${bodyClass}`}>{match.venueAddress}</p> : null}
          </div>
          <div className={panelClass}>
            <p className={eyebrowClass}>Result</p>
            <p className="mt-2 text-sm font-black text-[#101828]">{match.homeAway} game</p>
            <p className={`mt-1 ${bodyClass}`}>{goals.length} {goals.length === 1 ? 'goal recorded' : 'goals recorded'}</p>
          </div>
        </div>

        <div className="mt-5">
          <h4 className="text-sm font-black text-[#101828]">Goal details</h4>
          {goals.length > 0 ? (
            <div className="mt-3 space-y-2">
              {goals.map((event) => (
                <div key={event.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10">
                  <p className="text-sm font-black text-[#101828]">{formatGoalLine(event)}</p>
                  {event.notes ? <p className="mt-1 text-xs font-semibold text-[#4b5f55]">{event.notes}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5">
              <p className="text-sm font-black text-[#101828]">No goals were recorded for this match.</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                Score updates can still exist without scorer detail if staff only tracked the final result.
              </p>
            </div>
          )}
        </div>

        {match.notes ? (
          <div className={`mt-5 ${panelClass}`}>
            <p className={eyebrowClass}>Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4b5f55]">{match.notes}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
