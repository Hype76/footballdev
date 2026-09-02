import {
  getParentProductDateTimeParts,
  getParentProductSortTimestamp,
  getParentProductWallTimeSortTimestamp,
} from '../../mobile-core/src/parentDateTimeCore.js'
import { getDateInTimeZone } from '../../mobile-core/src/parentCalendarCore.js'
import { getMatchDayShirtChoiceLabel } from '../../../src/lib/matchday-model.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function toTimestamp(value) {
  const timestamp = getParentProductSortTimestamp(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function getMatchTimestamp(match) {
  const date = normalizeText(match?.matchDate)
  const time = normalizeText(match?.kickoffTime)

  if (!date) {
    return Number.POSITIVE_INFINITY
  }

  return toTimestamp(`${date}T${time || '23:59:59'}`)
}

function addWallTimeMinutes(date, time, minutes) {
  const normalizedDate = normalizeText(date)
  const normalizedTime = normalizeText(time).slice(0, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || !/^\d{2}:\d{2}$/.test(normalizedTime)) return ''
  const value = new Date(`${normalizedDate}T${normalizedTime}:00Z`)
  if (!Number.isFinite(value.getTime())) return ''
  value.setUTCMinutes(value.getUTCMinutes() + Number(minutes || 0))
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}T${String(value.getUTCHours()).padStart(2, '0')}${String(value.getUTCMinutes()).padStart(2, '0')}00`
}

function nextCalendarDate(value) {
  const normalized = normalizeText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return ''
  const date = new Date(`${normalized}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + 1)
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

export function enrichParentMatchInvitations(invitations = [], matches = []) {
  const matchesById = new Map((Array.isArray(matches) ? matches : []).map((match) => [normalizeText(match?.id), match]))

  return (Array.isArray(invitations) ? invitations : []).map((invitation) => {
    if (!['match_attendance', 'match_role'].includes(normalizeText(invitation?.invitationType))) return invitation
    const match = matchesById.get(normalizeText(invitation?.eventId))
    if (!match) return invitation

    const matchDate = normalizeText(match.matchDate || invitation.eventDate).slice(0, 10)
    const kickoffTime = normalizeText(match.kickoffTime).slice(0, 5)
    const kickoffTimeTbc = match.kickoffTimeTbc === true
    const eventStart = normalizeText(invitation.eventStart)
      || (matchDate ? (kickoffTime && !kickoffTimeTbc ? `${matchDate}T${kickoffTime}:00` : matchDate) : '')
    const eventLocation = normalizeText(invitation.eventLocation)
      || normalizeText(match.venueAddress)
      || normalizeText(match.venueName)

    return {
      ...invitation,
      arrivalTime: normalizeText(match.arrivalTime),
      eventDate: normalizeText(invitation.eventDate) || matchDate,
      eventLocation,
      eventStart,
      kickoffTime,
      kickoffTimeTbc,
      matchDate,
      matchDurationMinutes: Number(match.matchDurationMinutes || 120),
      opponent: normalizeText(match.opponent),
      shirtChoice: normalizeText(match.shirtChoice || invitation.shirtChoice),
      teamName: normalizeText(match.teamName || invitation.teamName),
      venueAddress: normalizeText(match.venueAddress),
      venueName: normalizeText(match.venueName),
    }
  })
}

export function isParentDefinitelyOffline(networkState = {}) {
  return networkState.isConnected === false
}

export function canParentRegisterScorerInterest(match, now = new Date()) {
  if (!match?.requestScorer || match?.isScorer || match?.hasInterest) return false
  const today = getDateInTimeZone(now)
  const matchDate = normalizeText(match?.matchDate).slice(0, 10)
  if (!matchDate || matchDate < today) return false
  return ['scheduled', 'scorer_request', 'live'].includes(normalizeText(match?.status).toLowerCase())
}

function getParentCalendarTemplate(item = {}) {
  const matchDate = normalizeText(item.matchDate ?? item.calendarDate ?? item.eventDate).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) return ''
  const rawTime = normalizeText(item.kickoffTime ?? item.calendarTime).slice(0, 5)
  const eventStart = compactCalendarDateTime(item.startsAt ?? item.eventStart)
  const timed = item.kickoffTimeTbc !== true && (/^\d{2}:\d{2}$/.test(rawTime) || eventStart.includes('T'))
  const start = timed
    ? (/^\d{2}:\d{2}$/.test(rawTime) ? `${matchDate.replaceAll('-', '')}T${rawTime.replace(':', '')}00` : eventStart)
    : matchDate.replaceAll('-', '')
  const end = timed
    ? addWallTimeMinutes(
        matchDate,
        /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : `${eventStart.slice(9, 11)}:${eventStart.slice(11, 13)}`,
        Math.max(60, Number(item.matchDurationMinutes || 120)),
      )
    : nextCalendarDate(matchDate)
  if (!start || !end) return ''
  const title = normalizeText(item.title ?? item.eventTitle)
    || `${normalizeText(item.teamName) || 'Team'} v ${normalizeText(item.opponent) || 'Opponent'}`
  const location = normalizeText(item.location)
    || [...new Set([normalizeText(item.venueName), normalizeText(item.venueAddress), normalizeText(item.eventLocation)].filter(Boolean))].join(', ')
  const details = normalizeText(item.notes)
    || (item.shirtChoice ? `Kits: ${getMatchDayShirtChoiceLabel(item.shirtChoice)}` : 'Football Player event')

  return { details, end, location, start, timed, title }
}

export function getParentGoogleCalendarUrl(item = {}) {
  const event = getParentCalendarTemplate(item)
  if (!event) return ''
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    dates: `${event.start}/${event.end}`,
    details: event.details,
    location: event.location,
    text: event.title,
  })
  if (event.timed) params.set('ctz', 'Europe/London')
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function getParentMatchCalendarUrl(match) {
  return getParentGoogleCalendarUrl(match)
}

function escapeCalendarText(value) {
  return normalizeText(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;')
}

function compactCalendarDateTime(value) {
  const normalized = normalizeText(value)
  if (!normalized) return ''
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!match) return ''
  return `${match[1]}${match[2]}${match[3]}${match[4] ? `T${match[4]}${match[5]}${match[6] || '00'}` : ''}`
}

export function buildParentCalendarIcs(item = {}) {
  const event = getParentCalendarTemplate(item)
  if (!event) return ''
  const matchDate = normalizeText(item.matchDate ?? item.calendarDate ?? item.eventDate).slice(0, 10)
  const uid = `${normalizeText(item.id ?? item.eventId ?? item.sourceRecordId) || `${matchDate}-${event.title}`}@footballplayer.online`
  const startLine = event.timed ? `DTSTART;TZID=Europe/London:${event.start}` : `DTSTART;VALUE=DATE:${event.start}`
  const endLine = event.timed ? `DTEND;TZID=Europe/London:${event.end}` : `DTEND;VALUE=DATE:${event.end}`
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Football Player//Parent Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeCalendarText(uid)}`,
    `DTSTAMP:${new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z')}`,
    startLine,
    endLine,
    `SUMMARY:${escapeCalendarText(event.title)}`,
    `DESCRIPTION:${escapeCalendarText(event.details)}`,
    `LOCATION:${escapeCalendarText(event.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

export function getParentMatchDirectionsUrl(match, platform = 'android') {
  const location = [normalizeText(match?.venueName), normalizeText(match?.venueAddress)].filter(Boolean).join(', ')
  return getParentLocationDirectionsUrl(location, platform)
}

export function getParentCalendarDirectionsUrl(event, platform = 'android') {
  return getParentLocationDirectionsUrl(event?.location, platform)
}

export function getParentLocationDirectionsUrl(location, platform = 'android') {
  const normalizedLocation = normalizeText(location)
  if (!normalizedLocation) return ''
  const query = encodeURIComponent(normalizedLocation)
  return platform === 'ios'
    ? `https://maps.apple.com/?q=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`
}

export function getParentFriendlyError(error, fallback = 'This information could not be loaded.') {
  const code = normalizeText(error?.code).toLowerCase()
  const message = normalizeText(error?.message || error).toLowerCase()
  const status = Number(error?.status || error?.statusCode || 0)

  if (message.includes('minute must be')) return 'Enter a match minute of zero or greater.'
  if (message.includes('training response window has closed')) return 'This training response window has closed.'

  if (/cannot (record goals|correct|change|manage)|selected scorer|scorer access/.test(message)) {
    return 'Your scorer access for this match could not be confirmed. Refresh Matchday or ask a coach to check your selection.'
  }
  if (message.includes('fixture has closed') || message.includes('match has closed') || message.includes('concluded match')) {
    return 'This match is closed, so this change cannot be saved.'
  }
  if (message.includes('start or resume the match') || message.includes('start the match before')) {
    return 'Start or resume the match before recording this change.'
  }
  if (message.includes('timed out') || message.includes('timeout')) {
    return 'The server took too long to respond. Refresh to check whether your change was saved before trying again.'
  }

  if (
    code.includes('parent_push_device_firebase_configuration')
    || code.includes('parent_push_expo_app_configuration')
    || message.includes('parent_push_device_firebase_configuration')
    || message.includes('parent_push_expo_app_configuration')
  ) {
    return 'Notifications are not ready for this test build.'
  }

  if (code.includes('parent_push_device_') || message.includes('parent_push_device_')) {
    return 'This device could not create a notification token. Try again.'
  }

  if (code.includes('parent_push_expo_') || message.includes('parent_push_expo_')) {
    return 'The notification service could not be reached. Try again.'
  }

  if (code.includes('parent_push_permission_') || message.includes('parent_push_permission_')) {
    return 'Notification permission could not be checked. Try again.'
  }

  if (code.includes('parent_push_local_') || message.includes('parent_push_local_')) {
    return 'Notification settings could not be saved on this device. Try again.'
  }

  if (code.includes('parent_push_api_signed_out') || message.includes('parent_push_api_signed_out')) {
    return 'Your session has expired. Sign in again before changing notifications.'
  }

  if (code.includes('parent_push_api_parent_authority') || message.includes('parent_push_api_parent_authority')) {
    return 'Choose a linked child before changing notifications.'
  }

  if (code.includes('parent_push_api_forbidden') || message.includes('parent_push_api_forbidden')) {
    return 'This Parent account cannot register notifications for the selected child.'
  }

  if (code.includes('parent_push_api_network') || message.includes('parent_push_api_network')) {
    return 'No connection. Notification settings were not changed.'
  }

  if (code.includes('parent_push_api_service') || message.includes('parent_push_api_service')) {
    return 'The notification service is temporarily unavailable. Try again.'
  }

  if (code.includes('parent_push_api_') || message.includes('parent_push_api_')) {
    return 'Notification preferences could not be saved. Try again.'
  }

  if (
    message.includes('network request failed')
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('offline')
    || message.includes('timed out')
  ) {
    return 'No connection. Check your network and try again.'
  }

  if (
    status === 401
    || code === 'pgrst301'
    || message.includes('jwt expired')
    || message.includes('session expired')
    || message.includes('refresh token')
  ) {
    return 'Your session has expired. Sign in again to continue.'
  }

  if (
    status === 403
    || code === '42501'
    || message.includes('row-level security')
    || message.includes('not authorised')
    || message.includes('not authorized')
    || message.includes('permission denied')
  ) {
    return 'You do not have access to this information.'
  }

  if (message.includes('poll') && (message.includes('closed') || message.includes('expired'))) {
    return 'This poll is no longer available.'
  }

  return fallback
}

export function getParentMatchGroups(matches, now = new Date()) {
  const today = getDateInTimeZone(now)
  const upcoming = []
  const recent = []

  for (const match of Array.isArray(matches) ? matches : []) {
    const status = normalizeText(match?.status) || 'scheduled'
    const isFinished = status === 'full_time'
    const isPastScheduledMatch = normalizeText(match?.matchDate)
      && normalizeText(match.matchDate) < today

    if (isFinished || isPastScheduledMatch) {
      recent.push(match)
    } else {
      upcoming.push(match)
    }
  }

  upcoming.sort((left, right) => getMatchTimestamp(left) - getMatchTimestamp(right))
  recent.sort((left, right) => getMatchTimestamp(right) - getMatchTimestamp(left))

  return { recent, upcoming }
}

export function getParentCalendarGroups(events, now = new Date()) {
  const nowTimestamp = now.getTime()
  const today = getDateInTimeZone(now)
  const upcoming = []
  const recent = []

  for (const event of Array.isArray(events) ? events : []) {
    const eventBoundaryTimestamp = toTimestamp(event?.endsAt || event?.startsAt)
    const parts = getParentProductDateTimeParts(event?.startsAt || event?.calendarDate)
    const isTerminal = Boolean(event?.cancelledAt)
      || ['cancelled', 'closed', 'expired'].includes(normalizeText(event?.status).toLowerCase())
    const isPast = parts.isAllDay
      ? parts.date < today
      : eventBoundaryTimestamp > 0 && eventBoundaryTimestamp <= nowTimestamp

    if (isTerminal || isPast) {
      recent.push(event)
    } else {
      upcoming.push(event)
    }
  }

  upcoming.sort((left, right) => toTimestamp(left?.startsAt) - toTimestamp(right?.startsAt))
  recent.sort((left, right) => toTimestamp(right?.startsAt) - toTimestamp(left?.startsAt))

  return { recent, upcoming }
}

export function getParentHomeModel({ calendarEvents, matches, messages, now = new Date(), polls }) {
  const matchGroups = getParentMatchGroups(matches, now)
  const calendarGroups = getParentCalendarGroups(calendarEvents, now)
  const nextMatch = matchGroups.upcoming[0] || null
  const nextCalendarEvent = calendarGroups.upcoming[0] || null
  const nextMatchTime = getParentProductWallTimeSortTimestamp(
    nextMatch?.matchDate ? `${nextMatch.matchDate}T${nextMatch.kickoffTime || '23:59:59'}` : '',
  )
  const nextCalendarTime = getParentProductWallTimeSortTimestamp(
    nextCalendarEvent?.startsAt || nextCalendarEvent?.calendarDate,
  )
  const nextActivity = nextMatchTime <= nextCalendarTime
    ? nextMatch && { item: nextMatch, type: 'match' }
    : nextCalendarEvent && { item: nextCalendarEvent, type: 'calendar' }
  const messageList = Array.isArray(messages) ? messages : []
  const pollList = Array.isArray(polls) ? polls : []
  const activePolls = pollList.filter((poll) => isParentPollActive(poll, now))

  return {
    activePoll: activePolls[0] || null,
    latestMessage: messageList[0] || null,
    nextActivity: nextActivity || null,
    recentMatches: matchGroups.recent,
    unreadMessages: messageList.filter((message) => !message.readAt).length,
    unansweredPolls: activePolls.filter((poll) => {
      const answers = Array.isArray(poll.currentOptionIds) ? poll.currentOptionIds : []
      return !poll.currentOptionId && answers.length === 0
    }).length,
    upcomingCalendarEvents: calendarGroups.upcoming,
    upcomingMatches: matchGroups.upcoming,
  }
}

export function getParentHomeFixtureCards(homeModel = {}, limit = 3) {
  const nextMatch = homeModel?.nextActivity?.type === 'match'
    ? homeModel.nextActivity.item
    : null
  const nextMatchId = normalizeText(nextMatch?.id)
  const fixtureLimit = Math.max(0, Number(limit) || 0)

  return [...(Array.isArray(homeModel?.upcomingMatches) ? homeModel.upcomingMatches : [])]
    .sort((left, right) => getMatchTimestamp(left) - getMatchTimestamp(right))
    .filter((match) => !nextMatch || !(
      match === nextMatch
      || (nextMatchId && normalizeText(match?.id) === nextMatchId)
    ))
    .slice(0, fixtureLimit)
}

export function isParentPollActive(poll = {}, now = new Date()) {
  if (normalizeText(poll.status).toLowerCase() !== 'open' || poll.isExpired === true) return false
  const closesAt = toTimestamp(poll.closesAt)
  return closesAt === 0 || closesAt > now.getTime()
}

export function getPollDraftOption(poll, drafts) {
  return normalizeText(drafts?.[poll?.id])
    || normalizeText(poll?.currentOptionId)
    || normalizeText(poll?.currentOptionIds?.[0])
}

export function canSubmitParentPoll(poll, draftOptionId) {
  if (!poll || poll.status !== 'open' || poll.isExpired || !normalizeText(draftOptionId)) {
    return false
  }

  const optionId = normalizeText(draftOptionId)
  const currentOptionIds = Array.isArray(poll.currentOptionIds)
    ? poll.currentOptionIds.map(normalizeText).filter(Boolean)
    : normalizeText(poll.currentOptionId) ? [normalizeText(poll.currentOptionId)] : []

  if (poll.allowMultiple === true) {
    if (currentOptionIds.includes(optionId)) {
      return poll.allowVoteChanges === true
    }

    const maximumChoices = Number(poll.maxChoices || 0)
    return maximumChoices <= 0 || currentOptionIds.length < maximumChoices
  }

  const currentOptionId = currentOptionIds[0] || ''
  if (!currentOptionId) {
    return true
  }

  return poll.allowVoteChanges === true && currentOptionId !== optionId
}

export function rankParentPollResults(options = [], votes = []) {
  const resultCounts = new Map()

  for (const vote of Array.isArray(votes) ? votes : []) {
    const optionId = normalizeText(vote?.optionId)
    if (!optionId) continue
    resultCounts.set(optionId, Number(vote?.count || 0))
  }

  const sortedResults = (Array.isArray(options) ? options : [])
    .map((option, sourceIndex) => ({
      ...option,
      count: resultCounts.get(normalizeText(option?.id)) || 0,
      sourceIndex,
    }))
    .sort((left, right) => right.count - left.count || left.sourceIndex - right.sourceIndex)

  let previousCount = null
  let previousRank = 0

  return sortedResults.map((option, index) => {
    const rank = index > 0 && option.count === previousCount
      ? previousRank
      : index + 1
    previousCount = option.count
    previousRank = rank
    const { sourceIndex: _sourceIndex, ...result } = option
    return { ...result, rank }
  })
}

export function getBuildClassification(buildProfile) {
  const profile = normalizeText(buildProfile).toLowerCase()

  if (profile === 'store-live') {
    return 'Production TestFlight build'
  }

  if (profile === 'internal-live') {
    return 'Production internal build'
  }

  if (profile === 'store-test') {
    return 'TestFlight test build'
  }

  if (profile === 'internal') {
    return 'Internal test build'
  }

  return 'Development test build'
}
