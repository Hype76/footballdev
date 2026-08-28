import { getCalendarEvents } from './calendar-events.js'
import {
  applyEventPlayerChanges,
  EVENT_PLAYER_COMMUNICATION_MODES,
  previewEventPlayerChanges,
} from './event-player-management.js'
import { getMatchDays } from './match-day.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function createRequestToken() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('This browser cannot create a safe event request. Refresh or update the browser before retrying.')
  }

  return globalThis.crypto.randomUUID()
}

function getTodayDateValue(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isFutureCalendarEvent(event, now = new Date()) {
  const recurrenceFrequency = normalizeText(event?.recurrenceFrequency).toLowerCase()
  const recurrenceUntil = normalizeText(event?.recurrenceUntil)

  if (recurrenceFrequency && recurrenceFrequency !== 'none' && recurrenceUntil) {
    return recurrenceUntil >= getTodayDateValue(now)
  }

  const endTime = new Date(event?.endsAt || event?.startsAt || '').getTime()
  return Number.isFinite(endTime) && endTime > now.getTime()
}

function isFutureMatchDay(match, now = new Date()) {
  const status = normalizeText(match?.status || 'scheduled').toLowerCase()
  return ['scheduled', 'scorer_request'].includes(status)
    && normalizeText(match?.matchDate) >= getTodayDateValue(now)
}

export async function addPlayerToFutureTeamEvents({
  player,
  sendInvitations = false,
  user,
} = {}) {
  const playerId = normalizeText(player?.id)
  const teamId = normalizeText(player?.teamId)

  if (!playerId || !teamId) {
    throw new Error('A saved player and team are required before adding future events.')
  }

  const scopedUser = {
    ...user,
    activeTeamId: teamId,
    activeTeamName: player?.team || user?.activeTeamName || '',
  }
  const [calendarEvents, matchDays] = await Promise.all([
    getCalendarEvents({ user: scopedUser }),
    getMatchDays({ user: scopedUser }),
  ])
  const sources = [
    ...calendarEvents
      .filter((event) => normalizeText(event.teamId) === teamId && isFutureCalendarEvent(event))
      .map((event) => ({ eventId: event.id, sourceType: 'calendar', startsAt: event.startsAt })),
    ...matchDays
      .filter((match) => normalizeText(match.teamId) === teamId && isFutureMatchDay(match))
      .map((match) => ({ eventId: match.id, sourceType: 'match-day', startsAt: match.matchDate })),
  ].sort((left, right) => normalizeText(left.startsAt).localeCompare(normalizeText(right.startsAt)))

  const result = {
    addedCount: 0,
    alreadyIncludedCount: 0,
    failedCount: 0,
    invitationFailureCount: 0,
    totalFutureEventCount: sources.length,
  }

  for (const source of sources) {
    try {
      const preview = await previewEventPlayerChanges({
        eventId: source.eventId,
        selectedPlayerIds: [],
        sourceType: source.sourceType,
        user: scopedUser,
      })

      if (preview.currentPlayerIds.includes(playerId)) {
        result.alreadyIncludedCount += 1
        continue
      }

      const applied = await applyEventPlayerChanges({
        communicationMode: sendInvitations
          ? EVENT_PLAYER_COMMUNICATION_MODES.notifyAdded
          : EVENT_PLAYER_COMMUNICATION_MODES.none,
        eventId: source.eventId,
        requestToken: createRequestToken(),
        selectedPlayerIds: [...preview.currentPlayerIds, playerId],
        sourceType: source.sourceType,
        user: scopedUser,
      })

      result.addedCount += applied.addedPlayerIds.includes(playerId) ? 1 : 0
      if (applied.communicationFailure) {
        result.invitationFailureCount += 1
      }
    } catch (error) {
      console.error(error)
      result.failedCount += 1
    }
  }

  if (result.failedCount > 0) {
    const error = new Error(`${result.addedCount} future event${result.addedCount === 1 ? '' : 's'} updated, but ${result.failedCount} could not be updated. Retry this option. No duplicate invitations will be sent.`)
    error.result = result
    throw error
  }

  return result
}
