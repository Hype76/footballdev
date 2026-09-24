const text = (value) => String(value ?? '').trim()
const list = (value) => [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))]

const FIELD_LABELS = [
  ['title', 'Event name', 'Event details'],
  ['opponent', 'Opponent', 'Fixture details'],
  ['eventType', 'Event type', 'Event details'],
  ['date', 'Date', 'Schedule'],
  ['startTime', 'Start time', 'Schedule'],
  ['endTime', 'End time', 'Schedule'],
  ['kickoffTimeTbc', 'Kick-off time to be confirmed', 'Schedule'],
  ['arrivalTime', 'Arrival time', 'Schedule'],
  ['location', 'Location', 'Venue'],
  ['notes', 'Notes', 'Event details'],
  ['notesPinned', 'Pinned notes', 'Event details'],
  ['pitchType', 'Pitch type', 'Venue'],
  ['teamId', 'Team', 'Event details'],
  ['notificationTeamName', 'Team notification name', 'Event details'],
  ['homeAway', 'Home or away', 'Fixture details'],
  ['fixtureType', 'Fixture type', 'Fixture details'],
  ['shirtChoice', 'Kit choice', 'Fixture details'],
  ['matchDurationMinutes', 'Match duration', 'Fixture details'],
  ['autoSelectAvailablePlayers', 'Automatic squad selection', 'Fixture details'],
  ['conclusionRule', 'Match conclusion rule', 'Fixture details'],
  ['extraTimeHalfMinutes', 'Extra time half length', 'Fixture details'],
  ['extraTimePeriodCount', 'Extra time periods', 'Fixture details'],
  ['recurrenceFrequency', 'Repeat', 'Schedule'],
  ['recurrenceUntil', 'Repeat until', 'Schedule'],
  ['parentAudience', 'Parent audience', 'Sharing'],
  ['shareWithParents', 'Visible to parents', 'Sharing'],
  ['requestTrainingAvailability', 'Availability requests', 'Availability'],
  ['trainingAvailabilitySendDaysBefore', 'Availability reminder', 'Availability'],
  ['requestScorer', 'Scorer request', 'Volunteers'],
  ['requestLinesman', 'Linesman request', 'Volunteers'],
  ['requestReferee', 'Referee request', 'Volunteers'],
]

function display(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return text(value).replaceAll('_', ' ') || 'None'
}

export function buildCalendarEditReview({ before = {}, after = {}, resourceNames = {}, playerNames = {} } = {}) {
  const changes = []
  for (const [key, label, category] of FIELD_LABELS) {
    if (display(before[key]) === display(after[key])) continue
    changes.push({ category, detail: `${label}: ${display(before[key])} to ${display(after[key])}` })
  }

  const beforePlayers = list(before.invitedPlayerIds)
  const afterPlayers = list(after.invitedPlayerIds)
  for (const id of afterPlayers.filter((value) => !beforePlayers.includes(value))) {
    changes.push({ category: 'Players', detail: `Player added: ${text(playerNames[id]) || 'Selected player'}` })
  }
  for (const id of beforePlayers.filter((value) => !afterPlayers.includes(value))) {
    changes.push({ category: 'Players', detail: `Player removed: ${text(playerNames[id]) || 'Selected player'}` })
  }

  const beforeResources = list(before.resourceIds)
  const afterResources = list(after.resourceIds)
  const eventTitle = text(after.title || after.opponent || before.title || before.opponent) || 'this event'
  for (const id of afterResources.filter((value) => !beforeResources.includes(value))) {
    changes.push({ category: 'Resources', detail: `New resource added to ${eventTitle}: ${text(resourceNames[id]) || 'Resource'}` })
  }
  for (const id of beforeResources.filter((value) => !afterResources.includes(value))) {
    changes.push({ category: 'Resources', detail: `Resource removed from ${eventTitle}: ${text(resourceNames[id]) || 'Resource'}` })
  }

  const categories = [...new Set(changes.map((change) => change.category))]
  const headline = changes.find((change) => change.category === 'Resources')
    || changes.find((change) => change.category === 'Schedule')
    || changes[0]
  const notificationTitle = headline?.category === 'Resources'
    ? 'Resource update'
    : headline?.category === 'Schedule' ? 'Event rescheduled' : 'Event updated'
  const notificationBody = headline
    ? `${headline.detail}${changes.length > 1 ? ` Plus ${changes.length - 1} other change${changes.length === 2 ? '' : 's'}.` : ''}`
    : 'No changes to notify.'

  return { categories, changes, notificationBody, notificationTitle }
}

export function getCalendarReviewAudience(form = {}, players = []) {
  if (form.shareWithParents === false || form.parentVisible === false || form.parentAudience === 'none') {
    return 'Previously involved parents, if any'
  }
  if (form.parentAudience === 'all_club_parents') return 'All active club parents'
  if (form.parentAudience === 'all_team_parents') return 'All active team parents'
  const ids = list(form.invitedPlayerIds || form.involvedPlayerIds)
  const names = players.filter((player) => ids.includes(text(player.id))).map((player) => text(player.playerName)).filter(Boolean)
  return names.length ? `Parents of ${names.join(', ')}` : `Parents of ${ids.length} selected player${ids.length === 1 ? '' : 's'}`
}
