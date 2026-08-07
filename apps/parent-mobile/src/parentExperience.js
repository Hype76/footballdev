function normalizeText(value) {
  return String(value ?? '').trim()
}

function toTimestamp(value) {
  const date = new Date(value || 0)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function getMatchTimestamp(match) {
  const date = normalizeText(match?.matchDate)
  const time = normalizeText(match?.kickoffTime)

  if (!date) {
    return Number.POSITIVE_INFINITY
  }

  return toTimestamp(`${date}T${time || '23:59:59'}`)
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

  if (code.includes('parent_push_api_') || message.includes('parent_push_api_')) {
    return 'Notification settings could not reach the test service. Try again.'
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
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const todayTimestamp = today.getTime()
  const upcoming = []
  const recent = []

  for (const match of Array.isArray(matches) ? matches : []) {
    const status = normalizeText(match?.status) || 'scheduled'
    const matchTimestamp = getMatchTimestamp(match)
    const isFinished = status === 'full_time'
    const isPastScheduledMatch = matchTimestamp !== Number.POSITIVE_INFINITY
      && matchTimestamp < todayTimestamp
      && !['extra_time', 'half_time', 'live', 'penalties', 'second_half'].includes(status)

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
  const upcoming = []
  const recent = []

  for (const event of Array.isArray(events) ? events : []) {
    const eventTimestamp = toTimestamp(event?.startsAt)
    const isCancelled = Boolean(event?.cancelledAt) || normalizeText(event?.status) === 'cancelled'

    if (isCancelled || (eventTimestamp > 0 && eventTimestamp < nowTimestamp)) {
      recent.push(event)
    } else {
      upcoming.push(event)
    }
  }

  upcoming.sort((left, right) => toTimestamp(left?.startsAt) - toTimestamp(right?.startsAt))
  recent.sort((left, right) => toTimestamp(right?.startsAt) - toTimestamp(left?.startsAt))

  return { recent, upcoming }
}

export function getParentHomeModel({ calendarEvents, matches, messages, polls }) {
  const matchGroups = getParentMatchGroups(matches)
  const calendarGroups = getParentCalendarGroups(calendarEvents)
  const nextMatch = matchGroups.upcoming[0] || null
  const nextCalendarEvent = calendarGroups.upcoming[0] || null
  const nextMatchTime = getMatchTimestamp(nextMatch)
  const nextCalendarTime = toTimestamp(nextCalendarEvent?.startsAt) || Number.POSITIVE_INFINITY
  const nextActivity = nextMatchTime <= nextCalendarTime
    ? nextMatch && { item: nextMatch, type: 'match' }
    : nextCalendarEvent && { item: nextCalendarEvent, type: 'calendar' }
  const messageList = Array.isArray(messages) ? messages : []
  const pollList = Array.isArray(polls) ? polls : []

  return {
    activePoll: pollList.find((poll) => poll.status === 'open') || null,
    latestMessage: messageList[0] || null,
    nextActivity: nextActivity || null,
    recentMatches: matchGroups.recent,
    unreadMessages: messageList.filter((message) => !message.readAt).length,
    unansweredPolls: pollList.filter((poll) => {
      const answers = Array.isArray(poll.currentOptionIds) ? poll.currentOptionIds : []
      return poll.status === 'open' && !poll.currentOptionId && answers.length === 0
    }).length,
    upcomingCalendarEvents: calendarGroups.upcoming,
    upcomingMatches: matchGroups.upcoming,
  }
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

  const currentOptionId = normalizeText(poll.currentOptionId || poll.currentOptionIds?.[0])
  if (!currentOptionId) {
    return true
  }

  return poll.allowVoteChanges === true && currentOptionId !== normalizeText(draftOptionId)
}

export function getBuildClassification(buildProfile) {
  const profile = normalizeText(buildProfile).toLowerCase()

  if (profile === 'store-test') {
    return 'TestFlight test build'
  }

  if (profile === 'internal') {
    return 'Internal test build'
  }

  return 'Development test build'
}
