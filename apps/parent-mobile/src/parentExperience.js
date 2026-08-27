import {
  getParentProductDateTimeParts,
  getParentProductSortTimestamp,
  getParentProductWallTimeSortTimestamp,
} from '../../mobile-core/src/parentDateTimeCore.js'
import { getDateInTimeZone } from '../../mobile-core/src/parentCalendarCore.js'

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

function compactDate(value) {
  return normalizeText(value).replaceAll('-', '')
}

function nextCalendarDate(value) {
  const normalized = normalizeText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return ''
  const date = new Date(`${normalized}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + 1)
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
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

export function getParentMatchCalendarUrl(match) {
  const matchDate = normalizeText(match?.matchDate).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) return ''
  const kickoffTime = normalizeText(match?.kickoffTime).slice(0, 5)
  const timed = !match?.kickoffTimeTbc && /^\d{2}:\d{2}$/.test(kickoffTime)
  const start = timed ? addWallTimeMinutes(matchDate, kickoffTime, 0) : compactDate(matchDate)
  const end = timed
    ? addWallTimeMinutes(matchDate, kickoffTime, Math.max(90, Number(match?.matchDurationMinutes || 120)))
    : nextCalendarDate(matchDate)
  if (!start || !end) return ''
  const title = `${normalizeText(match?.teamName) || 'Team'} v ${normalizeText(match?.opponent) || 'Opponent'}`
  const location = [normalizeText(match?.venueName), normalizeText(match?.venueAddress)].filter(Boolean).join(', ')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    dates: `${start}/${end}`,
    details: `Football Player Match Day\nShirts: ${match?.shirtChoice === 'away' ? 'Away shirts' : 'Home shirts'}`,
    location,
    text: title,
  })
  if (timed) params.set('ctz', 'Europe/London')
  return `https://calendar.google.com/calendar/render?${params.toString()}`
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
