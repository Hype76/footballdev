import { isClubAdmin } from './auth-permissions.js'
import { isPlanAccessActive } from './plans.js'
import { canUseFeature, CAPABILITIES } from './paywall-access.js'

export const TV_PAGE_SIZE = 8
export const TV_ROTATION_SECONDS = 30
export const TV_REFRESH_MS = 10000
export const CLUB_TV_VIEW_PATH = '/club-matchday-tv/view/'
export const CLUB_TV_VIEW_HOST = 'v1.fpmd.online'
const reservedTvSlugs = new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'club-admin', 'club-matchday-tv', 'club-settings',
  'coach', 'dashboard', 'favicon', 'health', 'help', 'home', 'index', 'login', 'logout',
  'manifest', 'matchday', 'netlify', 'parent', 'preview', 'privacy', 'robots', 'settings',
  'sign-in', 'sign-out', 'sign-up', 'sitemap', 'status', 'support', 'terms', 'viewer',
])
const text = (value) => String(value ?? '').trim()
const number = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(999, Math.floor(Number(value)))) : 0
const liveStatuses = new Set(['live', 'half_time', 'second_half', 'extra_time', 'penalties'])

export function canViewClubMatchdayTv(user) {
  return isClubAdmin(user) && isPlanAccessActive(user)
    && canUseFeature(user, CAPABILITIES.clubAdministration)
}

export function normalizeClubTvSlug(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function clubTvSlugStatus(slug) {
  // V2 codes are 22-character base64url strings ending in A, Q, g or w.
  if (reservedTvSlugs.has(slug) || /^[a-z0-9-]{21}[aqgw]$/.test(slug)) return 'reserved'
  if (slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || (slug.match(/[a-z]/g) || []).length < 4) return 'invalid'
  return 'valid'
}

export function clubTvViewerUrl(slug, origin = window.location.origin, configuredOrigin = import.meta.env?.VITE_CLUB_MATCHDAY_TV_ORIGIN) {
  const customOrigin = typeof configuredOrigin === 'string' ? configuredOrigin.trim().replace(/\/$/, '') : ''
  if (customOrigin === 'https://fpmd.online' || customOrigin === `https://${CLUB_TV_VIEW_HOST}`) return `${customOrigin}/${slug}`
  return `${origin}${CLUB_TV_VIEW_PATH}${slug}`
}

export function clubTvStorageKey(user) {
  return `fp:club-matchday-tv:${user.id}:${user.clubId}`
}

export function clubTvDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function validTvDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function tvDateAfter(value, days) {
  if (!validTvDate(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  const result = date.toISOString().slice(0, 10)
  return validTvDate(result) ? result : null
}

export function tvPeriodWindow(date, period = 'day') {
  if (!validTvDate(date) || !['day', 'weekend', 'week', 'month'].includes(period)) return null
  if (period === 'day') return { kind: 'day', startDate: date, endDate: date }
  const selected = new Date(`${date}T12:00:00Z`), weekday = selected.getUTCDay()
  let startDate, endDate
  if (period === 'weekend') {
    startDate = tvDateAfter(date, weekday === 0 ? -1 : 6 - weekday)
    endDate = startDate && tvDateAfter(startDate, 1)
  } else if (period === 'week') {
    startDate = tvDateAfter(date, -((weekday + 6) % 7))
    endDate = startDate && tvDateAfter(startDate, 6)
  } else {
    startDate = `${date.slice(0, 7)}-01`
    selected.setUTCMonth(selected.getUTCMonth() + 1, 0)
    endDate = selected.toISOString().slice(0, 10)
  }
  return validTvDate(startDate) && validTvDate(endDate) ? { kind: period, startDate, endDate } : null
}

export function activeTvSponsors(ads, today = clubTvDate()) {
  if (!validTvDate(today)) return []
  return ads.filter(ad => ad.enabled !== false && (!ad.startDate || (validTvDate(ad.startDate) && ad.startDate <= today)) && (!ad.endDate || (validTvDate(ad.endDate) && ad.endDate >= today)) && (!ad.startDate || !ad.endDate || ad.startDate <= ad.endDate))
}

// Explicit display DTO: never spread raw match/event records into the TV response.
export function toClubTvMatch(row, clubId) {
  if (row?.club_id !== clubId || row.deleted_at || text(row.status).toLowerCase() === 'cancelled') return null
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
    shootoutWinner: ['home', 'away'].includes(row.shootout_winner) ? row.shootout_winner : '',
    timerStatus: text(row.timer_status), elapsed: Number.isFinite(Number(row.timer_elapsed_seconds)) ? Math.max(0, Math.min(86400, Number(row.timer_elapsed_seconds))) : 0,
    timerStartedAt: text(row.timer_started_at), concluded: Boolean(row.concluded_at), events,
  }
}

export function tvMatchSides(match) {
  return match.homeAway === 'away'
    ? { home: match.opponent, away: match.teamName, clubHome: false }
    : { home: match.teamName, away: match.opponent, clubHome: true }
}

export function tvMatchStatus(match) {
  if (match.status === 'cancelled' || match.status === 'postponed') {
    return { label: match.status.toUpperCase(), kind: 'inactive' }
  }
  if (match.concluded || match.status === 'full_time' || match.timerStatus === 'full_time') {
    const winner = match.homeScore === match.awayScore
      ? match.shootoutWinner
      : match.homeScore > match.awayScore ? 'home' : 'away'
    const clubSide = tvMatchSides(match).clubHome ? 'home' : 'away'
    const result = winner ? (winner === clubSide ? 'win' : 'loss') : 'draw'
    return { label: 'FULL TIME', kind: 'finished', result }
  }
  if (liveStatuses.has(match.status) || ['half_time', 'hydration'].includes(match.timerStatus)) {
    return { label: 'LIVE', kind: 'live' }
  }
  return { label: match.kickoffTbc || !match.kickoff ? 'KO TBC' : `KO ${match.kickoff}`, kind: 'upcoming' }
}

export function tvPitchNumber(venue) {
  const value = text(venue)
  const match = /^(\d{1,3}[a-z]?)$/i.exec(value)
    || /\bpitch\s+(?:no\.?\s*|#\s*)?(\d{1,3}[a-z]?)(?=$|[\s,;)])/i.exec(value)
  return match?.[1].toUpperCase() ?? ''
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
    return normalizeTvPreferences(JSON.parse(localStorage.getItem(key) || 'null'))
  } catch { return normalizeTvPreferences() }
}

export function hasLocalTvPreferences(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null')
    return Boolean(saved && typeof saved === 'object' && !Array.isArray(saved))
  } catch { return false }
}

export function validTvSponsorSchedule({ startDate, endDate }) {
  return (!startDate || validTvDate(startDate)) && (!endDate || validTvDate(endDate))
    && (!startDate || !endDate || startDate <= endDate)
}

const isTvArtwork = (value, limit) => typeof value === 'string' && value.length < limit
  && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)

export function normalizeTvPreferences(value) {
  const saved = value ?? {}
  const map = isTvArtwork(saved.map, 2850000) ? saved.map : ''
  const sponsorAds = (Array.isArray(saved.sponsorAds) ? saved.sponsorAds : []).slice(0, 3)
    .filter(ad => isTvArtwork(ad?.image, 750000))
    .map(ad => ({ image: ad.image, name: text(ad.name).slice(0, 80), enabled: ad.enabled !== false, startDate: text(ad.startDate), endDate: text(ad.endDate) }))
  const sponsorSeconds = [10, 15, 30, 60].includes(saved.sponsorSeconds) ? saved.sponsorSeconds : 30
  return { appearance: saved.appearance === 'dark' ? 'dark' : 'light', bigGoal: saved.bigGoal !== false, showMap: saved.showMap !== false, weatherPostcode: text(saved.weatherPostcode).slice(0, 10), map, sponsorAds, sponsorSeconds, showPitchsideOrdering: saved.showPitchsideOrdering === true }
}
