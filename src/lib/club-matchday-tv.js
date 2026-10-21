import { isClubAdmin } from './auth-permissions.js'
import { isPlanAccessActive } from './plans.js'
import { canUseFeature, CAPABILITIES } from './paywall-access.js'

export const TV_PAGE_SIZE = 8
export const TV_ROTATION_SECONDS = 30
export const TV_REFRESH_MS = 10000
const text = (value) => String(value ?? '').trim()
const number = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(999, Math.floor(Number(value)))) : 0
const liveStatuses = new Set(['live', 'half_time', 'second_half', 'extra_time', 'penalties'])

export function canViewClubMatchdayTv(user) {
  return isClubAdmin(user) && isPlanAccessActive(user)
    && canUseFeature(user, CAPABILITIES.clubAdministration)
}

export function clubTvDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function validTvDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// Explicit display DTO: never spread raw match/event records into the TV response.
export function toClubTvMatch(row, clubId) {
  if (row?.club_id !== clubId || row.deleted_at) return null
  const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
  if (!team || team.club_id !== clubId) return null
  const events = (row.match_day_events ?? []).filter((event) =>
    ['goal', 'red_card'].includes(event.event_type)
    && ['club', 'opponent'].includes(event.team_side)
    && (!event.event_status || ['active', 'corrected'].includes(event.event_status))
    && event.match_phase !== 'penalties',
  ).map((event) => ({
    id: text(event.id), type: event.event_type, side: event.team_side,
    minute: event.minute == null ? null : number(event.minute),
    stoppage: event.stoppage_minute == null ? 0 : number(event.stoppage_minute),
    shirt: /^\d{1,3}$/.test(text(event.scorer_shirt_number)) ? text(event.scorer_shirt_number) : '',
    createdAt: text(event.created_at),
  })).sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || a.createdAt.localeCompare(b.createdAt))
  return {
    id: text(row.id), teamName: text(team.name) || 'Club team', opponent: text(row.opponent) || 'Opponent',
    homeAway: row.home_away === 'away' ? 'away' : row.home_away === 'neutral' ? 'neutral' : 'home',
    matchDate: text(row.match_date), kickoff: text(row.kickoff_time).slice(0, 5), kickoffTbc: row.kickoff_time_tbc === true,
    venue: text(row.venue_name), status: text(row.status) || 'scheduled',
    homeScore: number(row.home_score), awayScore: number(row.away_score),
    homeShootoutScore: number(row.home_shootout_score), awayShootoutScore: number(row.away_shootout_score),
    timerStatus: text(row.timer_status), elapsed: Number.isFinite(Number(row.timer_elapsed_seconds)) ? Math.max(0, Math.min(86400, Number(row.timer_elapsed_seconds))) : 0,
    timerStartedAt: text(row.timer_started_at), concluded: Boolean(row.concluded_at), events,
  }
}

export function tvMatchSides(match) {
  return match.homeAway === 'away'
    ? { home: match.opponent, away: match.teamName, clubHome: false }
    : { home: match.teamName, away: match.opponent, clubHome: true }
}

export function tvMatchStatus(match, now = Date.now()) {
  if (match.concluded || match.status === 'full_time' || match.timerStatus === 'full_time') return { label: 'FULL TIME', kind: 'finished' }
  if (match.status === 'cancelled') return { label: 'CANCELLED', kind: 'upcoming' }
  if (match.status === 'postponed') return { label: 'POSTPONED', kind: 'upcoming' }
  if (match.status === 'half_time' || match.timerStatus === 'half_time') return { label: 'HALF TIME', kind: 'live' }
  if (match.status === 'penalties') return { label: 'PENALTIES', kind: 'live' }
  if (match.timerStatus === 'hydration') return { label: 'WATER BREAK', kind: 'live' }
  if (liveStatuses.has(match.status)) {
    const started = Date.parse(match.timerStartedAt)
    const elapsed = match.elapsed + (match.timerStatus === 'running' && Number.isFinite(started) ? Math.max(0, (now - started) / 1000) : 0)
    return { label: `${Math.floor(elapsed / 60)}′${match.timerStatus === 'paused' ? ' PAUSED' : ' LIVE'}`, kind: 'live' }
  }
  return { label: match.kickoffTbc || !match.kickoff ? 'KO TBC' : `KO ${match.kickoff}`, kind: 'upcoming' }
}

export function newTvGoals(previous, next) {
  if (!previous) return []
  const prior = new Map(previous.map((match) => [match.id, match]))
  return next.flatMap((match) => {
    const old = prior.get(match.id)
    if (!old || (match.homeScore <= old.homeScore && match.awayScore <= old.awayScore)) return []
    const ids = new Set(old.events.map((event) => event.id))
    return match.events.filter((event) => event.type === 'goal' && !ids.has(event.id)).map((event) => ({ match, event }))
  })
}

export function readTvPreferences(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}')
    const map = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(saved.map ?? '') && saved.map.length < 2850000 ? saved.map : ''
    return { bigGoal: saved.bigGoal !== false, showMap: saved.showMap !== false, weatherPostcode: text(saved.weatherPostcode).slice(0, 10), map }
  } catch { return { bigGoal: true, showMap: true, weatherPostcode: '', map: '' } }
}
