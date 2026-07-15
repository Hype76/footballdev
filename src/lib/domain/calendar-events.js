import { supabase } from '../supabase-client.js'
import { createAuditLog } from './audit.js'
import { clearViewCaches, getCachedResource, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'
import { CAPABILITIES } from '../paywall-access.js'
import { assertClubFeature } from './plan-gates.js'
import {
  getEntryIdentity,
  getEntryUserId,
  normalizeDateOnly,
} from './core-normalizers.js'
import { getSessionTeamsForUser } from './team-actions.js'
import {
  buildRequiredLocalDateTime,
  validateOrdinaryEventDateTime,
} from '../calendar-datetime-integrity.js'

const EVENT_TYPES = ['general', 'availability_deadline', 'parent_cutoff', 'training', 'match']
const RECURRENCE_FREQUENCIES = ['none', 'weekly', 'fortnightly', 'monthly']
const PARENT_AUDIENCES = ['none', 'involved_players', 'all_team_parents', 'all_club_parents']

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEventType(value) {
  const normalizedValue = normalizeText(value)
  return EVENT_TYPES.includes(normalizedValue) ? normalizedValue : 'general'
}

function normalizeRecurrenceFrequency(value) {
  const normalizedValue = normalizeText(value)
  return RECURRENCE_FREQUENCIES.includes(normalizedValue) ? normalizedValue : 'none'
}

function normalizeParentAudience(value) {
  const normalizedValue = normalizeText(value)
  return PARENT_AUDIENCES.includes(normalizedValue) ? normalizedValue : 'none'
}

function normalizeDateTime(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue) {
    return ''
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString()
}

export function normalizeCalendarEvent(row, options = {}) {
  const teamId = row.team_id ?? row.teamId ?? ''
  const isClubWide = !normalizeText(teamId)

  return {
    id: row.id ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId,
    eventType: normalizeEventType(row.event_type ?? row.eventType),
    title: normalizeText(row.title),
    startsAt: row.starts_at ?? row.startsAt ?? '',
    endsAt: row.ends_at ?? row.endsAt ?? '',
    location: normalizeText(row.location),
    notes: normalizeText(row.notes),
    recurrenceFrequency: normalizeRecurrenceFrequency(row.recurrence_frequency ?? row.recurrenceFrequency),
    recurrenceUntil: normalizeDateOnly(row.recurrence_until ?? row.recurrenceUntil),
    parentVisible: row.parent_visible === true || row.parentVisible === true,
    parentAudience: normalizeParentAudience(row.parent_audience ?? row.parentAudience),
    cancelledAt: row.cancelled_at ?? row.cancelledAt ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: normalizeText(row.created_by_name ?? row.createdByName),
    createdByEmail: normalizeText(row.created_by_email ?? row.createdByEmail),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: normalizeText(row.updated_by_name ?? row.updatedByName),
    updatedByEmail: normalizeText(row.updated_by_email ?? row.updatedByEmail),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    notificationRevision: Number(row.notification_revision ?? row.notificationRevision ?? 1),
    canEdit: options.canEdit ?? true,
    isClubWide,
    isInheritedClubEvent: Boolean(options.isInheritedClubEvent),
  }
}

function assertCalendarAccess(user) {
  if (!user?.clubId || user.role === 'parent_portal' || user.role === 'super_admin' || Number(user.roleRank ?? 0) < 20) {
    throw new Error('Coach or manager access is required for calendar changes.')
  }
}

function buildCalendarPayload({ user, event }) {
  const hasStructuredDateTime = event?.date !== undefined
    || event?.startTime !== undefined
    || event?.endTime !== undefined
  const structuredDateTime = hasStructuredDateTime
    ? validateOrdinaryEventDateTime({
      date: event?.date,
      endTime: event?.endTime,
      startTime: event?.startTime,
    })
    : null
  const startsAt = normalizeDateTime(structuredDateTime
    ? buildRequiredLocalDateTime(structuredDateTime.date, structuredDateTime.startTime)
    : event?.startsAt)
  const endsAt = normalizeDateTime(structuredDateTime
    ? buildRequiredLocalDateTime(structuredDateTime.date, structuredDateTime.endTime)
    : event?.endsAt)
  const eventTypeValue = normalizeText(event?.eventType)
  const eventType = normalizeEventType(eventTypeValue)
  const recurrenceFrequency = normalizeRecurrenceFrequency(event?.recurrenceFrequency)
  const recurrenceUntil = normalizeDateOnly(event?.recurrenceUntil) || null
  const requestedTeamId = normalizeText(event?.teamId)
  const isClubLevelAllowed = user?.role === 'admin'
  const safeTeamId = isClubLevelAllowed ? requestedTeamId : requestedTeamId || normalizeText(user?.activeTeamId)
  const title = normalizeText(event?.title)

  if (!eventTypeValue) {
    throw new Error('Choose an event type.')
  }

  if (!title) {
    throw new Error('Add an event title.')
  }

  if (!startsAt) {
    throw new Error('Enter an event date and start time.')
  }

  if (!endsAt) {
    throw new Error('Enter an end time.')
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new Error('End time must be after start time.')
  }

  if (!isClubLevelAllowed && !safeTeamId) {
    throw new Error('Choose a team for this event.')
  }

  if (recurrenceFrequency !== 'none' && !recurrenceUntil) {
    throw new Error('Add a repeat until date for recurring events.')
  }

  const parentVisible = event?.parentVisible === true
  const parentAudience = parentVisible ? normalizeParentAudience(event?.parentAudience) : 'none'

  if (parentVisible && parentAudience === 'none') {
    throw new Error('Choose who can see this event in the parent portal.')
  }

  if (parentVisible && parentAudience === 'all_team_parents' && !safeTeamId) {
    throw new Error('Choose a team before sharing with all parents in the team.')
  }

  return {
    club_id: user.clubId,
    team_id: safeTeamId || null,
    event_type: eventType,
    title,
    starts_at: startsAt,
    ends_at: endsAt,
    location: normalizeText(event?.location),
    notes: normalizeText(event?.notes),
    recurrence_frequency: recurrenceFrequency,
    recurrence_until: recurrenceFrequency === 'none' ? null : recurrenceUntil,
    parent_visible: parentVisible,
    parent_audience: parentAudience,
  }
}

async function assertCalendarTeamAccess({ user, teamId }) {
  if (user?.role === 'admin') {
    return
  }

  const normalizedTeamId = normalizeText(teamId)

  if (!normalizedTeamId) {
    throw new Error('Choose your assigned team before saving this calendar event.')
  }

  const teams = await getSessionTeamsForUser(user)
  const allowedTeamIds = teams.map((team) => normalizeText(team.id)).filter(Boolean)

  if (!allowedTeamIds.includes(normalizedTeamId)) {
    throw new Error('Team staff can only save events against their assigned team.')
  }
}

async function assertCalendarFeatureAccess({ user, payload }) {
  const teamId = normalizeText(payload?.team_id)
  const calendarUser = {
    ...user,
    activeTeamId: teamId || normalizeText(user?.activeTeamId),
    teamId: teamId || normalizeText(user?.activeTeamId),
  }

  if (teamId) {
    await assertClubFeature({
      user: calendarUser,
      clubId: user?.clubId,
      featureName: CAPABILITIES.teamCalendar,
    })
  } else {
    await assertClubFeature({
      user: calendarUser,
      clubId: user?.clubId,
      featureName: CAPABILITIES.clubWideEvents,
    })
  }

  if (normalizeText(payload?.recurrence_frequency) !== 'none') {
    await assertClubFeature({
      user: calendarUser,
      clubId: user?.clubId,
      featureName: CAPABILITIES.recurringEvents,
    })
  }

  if (payload?.parent_visible === true) {
    await assertClubFeature({
      user: calendarUser,
      clubId: user?.clubId,
      featureName: CAPABILITIES.parentPortal,
    })
  }
}

export async function getCalendarEvents({ user, clubWideOnly = false } = {}) {
  if (!user?.clubId || user.role === 'parent_portal' || user.role === 'super_admin') {
    return []
  }

  const activeTeamId = clubWideOnly ? '' : normalizeText(user.activeTeamId)
  const cacheScope = clubWideOnly ? 'club-wide-only' : activeTeamId || 'club-wide'
  const cacheKey = `calendar-events:${user.clubId}:${user.id}:${user.roleRank}:${cacheScope}`

  return getCachedResource(cacheKey, async () => {
    let query = supabase
      .from('calendar_events')
      .select('*')
      .eq('club_id', user.clubId)
      .is('cancelled_at', null)
      .order('starts_at', { ascending: true })

    if (clubWideOnly) {
      query = query.is('team_id', null)
    } else if (activeTeamId) {
      query = query.or(`team_id.eq.${activeTeamId},team_id.is.null`)
    } else {
      query = query.is('team_id', null)
    }

    const { data, error } = await query

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map((row) => {
      const rowTeamId = normalizeText(row.team_id)
      const isInheritedClubEvent = Boolean(activeTeamId) && !rowTeamId

      return normalizeCalendarEvent(row, {
        canEdit: user.role === 'admin' || !isInheritedClubEvent,
        isInheritedClubEvent,
      })
    })
  })
}

export async function getParentPortalSharedCalendarEvents({ parentLinkId } = {}) {
  const normalizedParentLinkId = normalizeText(parentLinkId)

  if (!normalizedParentLinkId) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_shared_calendar_events', {
    parent_link_id_value: normalizedParentLinkId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeCalendarEvent)
}

export async function createCalendarEvent({ user, event }) {
  await blockDemoMutation(user)
  assertCalendarAccess(user)

  const payload = {
    ...buildCalendarPayload({ user, event }),
    created_by: getEntryUserId(user),
    ...getEntryIdentity(user),
    updated_by: getEntryUserId(user),
    ...getEntryIdentity(user, 'updated_by'),
  }
  await assertCalendarTeamAccess({ user, teamId: payload.team_id })
  await assertCalendarFeatureAccess({ user, payload })

  const { data, error } = await supabase
    .from('calendar_events')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)
  await createAuditLog({
    user,
    action: 'calendar_event_created',
    entityType: 'calendar_event',
    entityId: data.id,
    metadata: {
      eventType: payload.event_type,
      startsAt: payload.starts_at,
      teamId: payload.team_id,
      title: payload.title,
    },
  })

  return normalizeCalendarEvent(data)
}

export async function updateCalendarEvent({ user, eventId, event }) {
  await blockDemoMutation(user)
  assertCalendarAccess(user)

  const payload = {
    ...buildCalendarPayload({ user, event }),
    updated_by: getEntryUserId(user),
    ...getEntryIdentity(user, 'updated_by'),
    updated_at: new Date().toISOString(),
  }
  await assertCalendarTeamAccess({ user, teamId: payload.team_id })
  await assertCalendarFeatureAccess({ user, payload })

  const { data, error } = await supabase
    .from('calendar_events')
    .update(payload)
    .eq('id', eventId)
    .eq('club_id', user.clubId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)
  await createAuditLog({
    user,
    action: 'calendar_event_updated',
    entityType: 'calendar_event',
    entityId: eventId,
    metadata: {
      eventType: payload.event_type,
      startsAt: payload.starts_at,
      teamId: payload.team_id,
      title: payload.title,
    },
  })

  return normalizeCalendarEvent(data)
}

export async function notifyCalendarEventParents({
  user,
  eventId,
  eventSource = 'calendar',
  eventAction,
  playerIds = [],
  requestToken,
} = {}) {
  await blockDemoMutation(user)
  assertCalendarAccess(user)

  const normalizedEventId = normalizeText(eventId)
  const normalizedEventSource = normalizeText(eventSource).toLowerCase()
  const normalizedAction = normalizeText(eventAction).toLowerCase()
  const normalizedRequestToken = normalizeText(requestToken)
  const normalizedPlayerIds = [...new Set(
    (Array.isArray(playerIds) ? playerIds : [])
      .map((playerId) => normalizeText(playerId))
      .filter(Boolean),
  )]

  if (!normalizedEventId) {
    throw new Error('Save the Calendar event before notifying parents.')
  }

  if (!['calendar', 'match-day'].includes(normalizedEventSource)) {
    throw new Error('Choose a supported Calendar event source before notifying parents.')
  }

  if (!['creation', 'update'].includes(normalizedAction)) {
    throw new Error('Choose a valid Calendar notification action.')
  }

  if (!normalizedRequestToken) {
    throw new Error('Start a new Notify parents request before saving.')
  }

  const { data, error } = await supabase.rpc('notify_calendar_event_parents', {
    calendar_event_id_value: normalizedEventSource === 'calendar' ? normalizedEventId : null,
    event_action_value: normalizedAction,
    match_day_id_value: normalizedEventSource === 'match-day' ? normalizedEventId : null,
    notification_request_token_value: normalizedRequestToken,
    player_ids_value: normalizedPlayerIds,
  })

  if (error) {
    console.error(error)
    throw error
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)

  return {
    eventId: normalizeText(data?.eventId),
    eventSource: normalizeText(data?.eventSource),
    eventRevision: Number(data?.eventRevision ?? 0),
    notificationCommandId: normalizeText(data?.notificationCommandId),
    notificationType: normalizeText(data?.notificationType),
    eventActionType: normalizeText(data?.eventActionType),
    portalState: normalizeText(data?.portalState),
    portalCreatedCount: Number(data?.portalCreatedCount ?? 0),
    portalUpdatedCount: Number(data?.portalUpdatedCount ?? 0),
    portalRecordCount: Number(data?.portalRecordCount ?? 0),
    responseRequirement: normalizeText(data?.responseRequirement),
    eligibleRecipientCount: Number(data?.eligibleRecipientCount ?? 0),
    queuedCount: Number(data?.queuedCount ?? 0),
    failedCount: Number(data?.failedCount ?? 0),
    duplicateCount: Number(data?.duplicateCount ?? 0),
    idempotencyPrefix: normalizeText(data?.idempotencyPrefix),
    finalState: normalizeText(data?.finalState),
  }
}

export async function deleteCalendarEvent({ user, eventId }) {
  await blockDemoMutation(user)
  assertCalendarAccess(user)

  const { data: existingEvent, error: existingEventError } = await supabase
    .from('calendar_events')
    .select('id, team_id, recurrence_frequency, parent_visible')
    .eq('id', eventId)
    .eq('club_id', user.clubId)
    .single()

  if (existingEventError) {
    console.error(existingEventError)
    throw existingEventError
  }

  await assertCalendarTeamAccess({ user, teamId: existingEvent.team_id })
  await assertCalendarFeatureAccess({ user, payload: existingEvent })

  const { data, error } = await supabase
    .from('calendar_events')
    .delete()
    .eq('id', eventId)
    .eq('club_id', user.clubId)
    .select('id, title, event_type, starts_at')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)
  await createAuditLog({
    user,
    action: 'calendar_event_deleted',
    entityType: 'calendar_event',
    entityId: eventId,
    metadata: {
      eventType: data.event_type,
      startsAt: data.starts_at,
      title: data.title,
    },
  })
}
