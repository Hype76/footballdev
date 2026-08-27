import * as Crypto from 'expo-crypto'
import { CAPABILITIES } from '../../../src/lib/paywall-access.js'
import {
  buildCoachCalendarEvents,
  buildCoachCalendarOccurrenceDates,
  buildCoachCalendarPayload,
  normalizeCoachCalendarEvent,
  normalizeCoachCalendarFormDate,
} from './coachCalendarCore'
import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout, joinApiPath } from './http'
import {
  assertCoachCapability,
  assertCoachOperationalMutation,
  assertCoachOperationalRead,
  getCoachEntryIdentity,
  recordCoachOperationalAudit,
  scopeCoachQuery,
} from './coachOperationalData'
import { getAccessToken, supabase } from './supabase'
import { saveCoachTeamNotificationDisplayName } from './coachTeamNotificationData'
import {
  collapseCoachInvitesByPlayer,
  normalizeCoachInvite,
  summarizeCoachInvites,
} from './coachPhase31ECore'

const config = getMobileRuntimeConfig('coach')

function normalize(value) {
  return String(value ?? '').trim()
}

async function getTrainingAvailabilityByEventId(user, eventIds) {
  if (eventIds.length === 0) return {}
  const [requestPlayersResult, responsesResult] = await Promise.all([
    supabase
      .from('training_availability_request_players')
      .select('id, request_id, calendar_event_id, player_id, player_name, status, email_sent_at, last_error, training_availability_requests(occurrence_date, occurrence_starts_at),scheduled_email_queue:email_queue_id(delivery_state,provider_accepted_at,provider_delivered_at,status)')
      .eq('club_id', user.clubId)
      .in('calendar_event_id', eventIds),
    supabase
      .from('training_availability_responses')
      .select('request_id, calendar_event_id, player_id, status, note, responded_at, responded_by_name')
      .eq('club_id', user.clubId)
      .in('calendar_event_id', eventIds),
  ])
  if (requestPlayersResult.error) throw requestPlayersResult.error
  if (responsesResult.error) throw responsesResult.error
  const responses = new Map((responsesResult.data || []).map((row) => [`${row.request_id}:${row.player_id}`, row]))
  const invitesByOccurrence = {}
  for (const row of requestPlayersResult.data || []) {
    const eventId = normalize(row.calendar_event_id)
    if (!eventId) continue
    const request = Array.isArray(row.training_availability_requests)
      ? row.training_availability_requests[0]
      : row.training_availability_requests
    const occurrenceDate = normalizeCoachCalendarFormDate(request?.occurrence_date || request?.occurrence_starts_at)
    const summaryKey = occurrenceDate ? `${eventId}:${occurrenceDate}` : eventId
    const response = responses.get(`${row.request_id}:${row.player_id}`)
    if (!invitesByOccurrence[summaryKey]) invitesByOccurrence[summaryKey] = []
    invitesByOccurrence[summaryKey].push(normalizeCoachInvite({
      ...row,
      ...response,
      occurrence_date: occurrenceDate,
    }, 'training'))
  }
  return Object.fromEntries(Object.entries(invitesByOccurrence).map(([summaryKey, invites]) => {
    const collapsed = collapseCoachInvitesByPlayer(invites)
    const summary = summarizeCoachInvites(collapsed)
    return [summaryKey, {
      ...summary,
      details: collapsed.map((invite) => ({
        deliveryStatus: invite.deliveryStatus,
        lastError: invite.lastError,
        note: invite.note,
        playerId: invite.playerId,
        playerName: invite.playerName,
        respondedAt: invite.respondedAt,
        respondedByName: invite.respondedByName,
        status: invite.status,
      })),
    }]
  }))
}

async function getInvolvedPlayerIdsByEventId(user, eventIds) {
  if (eventIds.length === 0) return {}
  const { data, error } = await supabase
    .from('calendar_event_invites')
    .select('calendar_event_id, player_id, invite_status, cancelled_at')
    .eq('club_id', user.clubId)
    .in('calendar_event_id', eventIds)
    .neq('invite_status', 'cancelled')
    .is('cancelled_at', null)
  if (error) throw error
  const byEventId = {}
  for (const row of data || []) {
    const eventId = normalize(row.calendar_event_id)
    const playerId = normalize(row.player_id)
    if (!eventId || !playerId) continue
    if (!byEventId[eventId]) byEventId[eventId] = []
    if (!byEventId[eventId].includes(playerId)) byEventId[eventId].push(playerId)
  }
  return byEventId
}

export async function getCoachCalendarResources(user) {
  assertCoachOperationalRead(user)
  let calendarQuery = supabase
    .from('calendar_events')
    .select('*, teams:team_id(name,notification_display_name)')
    .eq('club_id', user.clubId)
    .order('starts_at', { ascending: true })
    .limit(300)
  calendarQuery = scopeCoachQuery(calendarQuery, user, { includeClubWide: true })

  const matchesPromise = user.activeTeamId
    ? supabase
      .from('match_days')
      .select('id, team_id, opponent, match_date, kickoff_time, kickoff_time_tbc, home_away, shirt_choice, match_duration_minutes, status, venue_name, venue_address, notes, updated_at, teams:team_id(name,notification_display_name)')
      .eq('club_id', user.clubId)
      .eq('team_id', user.activeTeamId)
      .order('match_date', { ascending: true })
      .limit(100)
    : Promise.resolve({ data: [], error: null })
  const sessionsPromise = user.activeTeamId
    ? supabase
      .from('assessment_sessions')
      .select('id, team_id, team, title, opponent, session_type, session_date, start_time, end_time, location, notes, status, updated_at, teams:team_id(name,notification_display_name)')
      .eq('club_id', user.clubId)
      .eq('team_id', user.activeTeamId)
      .order('session_date', { ascending: true })
      .limit(100)
    : Promise.resolve({ data: [], error: null })
  const [calendarResult, matchesResult, sessionsResult] = await Promise.all([calendarQuery, matchesPromise, sessionsPromise])
  const firstError = calendarResult.error || matchesResult.error || sessionsResult.error
  if (firstError) throw firstError
  const calendarRows = calendarResult.data || []
  const calendarIds = calendarRows.map((row) => row.id).filter(Boolean)
  const trainingIds = calendarRows.filter((row) => row.event_type === 'training').map((row) => row.id)
  const [availabilityByEventId, involvedPlayerIdsByEventId] = await Promise.all([
    getTrainingAvailabilityByEventId(user, trainingIds),
    getInvolvedPlayerIdsByEventId(user, calendarIds),
  ])
  return buildCoachCalendarEvents({
    availabilityByEventId,
    calendarEvents: calendarRows.map((row) => ({
      ...row,
      canEdit: user.role === 'admin' || Boolean(row.team_id),
      involvedPlayerIds: involvedPlayerIdsByEventId[normalize(row.id)] || [],
      isInheritedClubEvent: Boolean(user.activeTeamId && !row.team_id),
    })),
    matches: matchesResult.data || [],
    sessions: sessionsResult.data || [],
  })
}

function assertCalendarCapabilities(user, payload) {
  assertCoachCapability(user, payload.team_id ? CAPABILITIES.teamCalendar : CAPABILITIES.clubWideEvents)
  if (payload.recurrence_frequency !== 'none') assertCoachCapability(user, CAPABILITIES.recurringEvents)
  if (payload.parent_visible) assertCoachCapability(user, CAPABILITIES.parentPortal)
}

export async function saveCoachCalendarEvent(user, form, existingEvent = null) {
  assertCoachOperationalMutation(user)
  if (existingEvent && (existingEvent.sourceType !== 'calendar_event' || existingEvent.canEdit === false)) {
    throw new Error('This item must be edited in its authoritative Match Day or Session workflow.')
  }
  const payload = buildCoachCalendarPayload({ context: user, form })
  const playerIds = [...new Set((form?.involvedPlayerIds || []).map(normalize).filter(Boolean))]
  if (payload.parent_visible && payload.parent_audience === 'involved_players' && playerIds.length === 0) {
    throw new Error('Add at least one involved Player or choose a wider parent audience.')
  }
  assertCalendarCapabilities(user, payload)
  if (payload.team_id) {
    await saveCoachTeamNotificationDisplayName(user, payload.team_id, form?.notificationTeamName)
  }
  const now = new Date().toISOString()
  const identity = getCoachEntryIdentity(user, 'updated')
  let query
  let action
  if (existingEvent?.sourceId) {
    query = supabase
      .from('calendar_events')
      .update({ ...payload, ...identity, updated_by: user.id, updated_at: now })
      .eq('id', existingEvent.sourceId)
      .eq('club_id', user.clubId)
    action = 'calendar_event_updated'
  } else {
    query = supabase
      .from('calendar_events')
      .insert({
        ...payload,
        ...getCoachEntryIdentity(user),
        ...identity,
        created_by: user.id,
        updated_by: user.id,
      })
    action = 'calendar_event_created'
  }
  const { data, error } = await query.select('*, teams:team_id(name,notification_display_name)').single()
  if (error) throw error

  if (payload.parent_visible && payload.team_id) {
    const selectionMode = payload.parent_audience === 'all_team_parents' ? 'whole_squad' : 'manual'
    const { error: scopeError } = await supabase.rpc('sync_calendar_event_parent_scope_v2', {
      calendar_event_id_value: data.id,
      include_trial_players_value: false,
      match_day_id_value: null,
      player_ids_value: selectionMode === 'whole_squad' ? [] : playerIds,
      selection_mode_value: selectionMode,
    })
    if (scopeError) throw scopeError
  }

  await recordCoachOperationalAudit({
    action,
    entityId: data.id,
    entityType: 'calendar_event',
    metadata: {
      communicationsMode: config.isProduction && form?.notifyParents === true ? 'canonical_production_queue' : 'disabled_test_sink',
      eventType: payload.event_type,
      startsAt: payload.starts_at,
      teamId: payload.team_id,
      title: payload.title,
    },
    user,
  })
  return normalizeCoachCalendarEvent(data)
}

export async function syncCoachCalendarEventResources(user, event, resourceIds = [], occurrenceDate = '') {
  assertCoachOperationalMutation(user, { minimumRank: 50, requiresTeam: true })
  const eventId = normalize(event?.sourceId || event?.id)
  const eventTeamId = normalize(event?.teamId)
  const selectedOccurrenceDate = normalizeCoachCalendarFormDate(occurrenceDate || event?.occurrenceDate || event?.calendarDate)
  const desiredResourceIds = [...new Set((Array.isArray(resourceIds) ? resourceIds : []).map(normalize).filter(Boolean))]

  if (!eventId || event?.sourceType !== 'calendar_event' || !eventTeamId || eventTeamId !== normalize(user.activeTeamId)) {
    throw new Error('Choose an editable event from the active Team before attaching Resources.')
  }
  const validOccurrenceDates = buildCoachCalendarOccurrenceDates({
    date: event?.calendarDate,
    recurrenceFrequency: event?.recurrenceFrequency,
    recurrenceUntil: event?.recurrenceUntil,
  })
  if (!selectedOccurrenceDate || !validOccurrenceDates.includes(selectedOccurrenceDate)) {
    throw new Error('Choose a valid dated occurrence before attaching Resources.')
  }

  if (desiredResourceIds.length > 0) {
    const { data: resources, error: resourcesError } = await supabase
      .from('resource_library_items')
      .select('id')
      .eq('club_id', user.clubId)
      .eq('team_id', eventTeamId)
      .is('archived_at', null)
      .in('id', desiredResourceIds)
    if (resourcesError) throw resourcesError
    const authorisedIds = new Set((resources || []).map((resource) => normalize(resource.id)))
    if (desiredResourceIds.some((resourceId) => !authorisedIds.has(resourceId))) {
      throw new Error('Attach Resources from the active Team only.')
    }
  }

  let existingLinksQuery = supabase
    .from('resource_library_links')
    .select('id, resource_id, team_id, calendar_occurrence_date')
    .eq('club_id', user.clubId)
    .eq('team_id', eventTeamId)
    .eq('linked_type', 'calendar_event')
    .eq('linked_id', eventId)
    .is('removed_at', null)
  if (normalize(event?.recurrenceFrequency).toLowerCase() !== 'none') {
    existingLinksQuery = existingLinksQuery.eq('calendar_occurrence_date', selectedOccurrenceDate)
  }
  const { data: existingLinks, error: existingLinksError } = await existingLinksQuery
  if (existingLinksError) throw existingLinksError

  const desiredIds = new Set(desiredResourceIds)
  const existingIds = new Set((existingLinks || []).map((link) => normalize(link.resource_id)))
  const linksToRemove = (existingLinks || []).filter((link) => !desiredIds.has(normalize(link.resource_id)))
  const resourcesToAdd = desiredResourceIds.filter((resourceId) => !existingIds.has(resourceId))

  if (linksToRemove.length > 0) {
    const removals = await Promise.all(linksToRemove.map((link) => supabase.rpc('remove_resource_library_link', {
      target_link_id: link.id,
      target_club_id: user.clubId,
      target_team_id: eventTeamId,
    })))
    const removalError = removals.find((result) => result.error)?.error
    if (removalError) throw removalError
  }

  if (resourcesToAdd.length > 0) {
    const { error: insertError } = await supabase.from('resource_library_links').insert(resourcesToAdd.map((resourceId) => ({
      assigned_by_email: normalize(user.email).toLowerCase(),
      assigned_by_name: normalize(user.displayName || user.name || user.email),
      assigned_by_profile_id: user.id,
      calendar_occurrence_date: selectedOccurrenceDate,
      club_id: user.clubId,
      linked_id: eventId,
      linked_type: 'calendar_event',
      resource_id: resourceId,
      team_id: eventTeamId,
    })))
    if (insertError) throw insertError
  }

  await recordCoachOperationalAudit({
    action: 'resource_library_event_resources_synced',
    entityId: eventId,
    entityType: 'calendar_event',
    metadata: { occurrenceDate: selectedOccurrenceDate, resourceCount: desiredResourceIds.length, teamId: eventTeamId },
    user,
  })
  return desiredResourceIds
}

async function callCoachCalendarChangeNotifications(payload) {
  const accessToken = await getAccessToken()
  if (!config.apiBaseUrl || !accessToken) throw new Error('Sign in again before notifying families.')
  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/calendar-change-notifications'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!ok || result?.success === false) throw new Error(result?.message || 'Calendar change notifications could not be sent.')
  return result
}

export async function prepareCoachCalendarChangeNotification(event, changeAction) {
  if (!event?.sourceId || event.sourceType !== 'calendar_event') {
    throw new Error('Open Match Day or Sessions to change this item.')
  }
  return callCoachCalendarChangeNotifications({
    changeAction,
    operation: 'prepare',
    requestToken: Crypto.randomUUID(),
    sourceId: event.sourceId,
    sourceType: 'calendar',
  })
}

export async function commitCoachCalendarChangeNotification(preparationId) {
  return callCoachCalendarChangeNotifications({ operation: 'commit', preparationId })
}

export async function cancelCoachCalendarEvent(user, event) {
  assertCoachOperationalMutation(user)
  if (!event?.sourceId || event.sourceType !== 'calendar_event' || event.canEdit === false) {
    throw new Error('This event cannot be cancelled here.')
  }
  const now = new Date().toISOString()
  const { error } = await supabase.from('calendar_events')
    .update({ ...getCoachEntryIdentity(user, 'updated'), cancelled_at: now, updated_at: now, updated_by: user.id })
    .eq('id', event.sourceId).eq('club_id', user.clubId)
  if (error) throw error
  await recordCoachOperationalAudit({ action: 'calendar_event_cancelled', entityId: event.sourceId, entityType: 'calendar_event', metadata: { title: event.title }, user })
}

export async function deleteCoachCalendarEvent(user, event) {
  assertCoachOperationalMutation(user)
  if (!event?.sourceId || event.sourceType !== 'calendar_event' || event.canEdit === false) {
    throw new Error('This event cannot be deleted here.')
  }
  const { error } = await supabase.from('calendar_events').delete().eq('id', event.sourceId).eq('club_id', user.clubId)
  if (error) throw error
  await recordCoachOperationalAudit({ action: 'calendar_event_deleted', entityId: event.sourceId, entityType: 'calendar_event', metadata: { title: event.title }, user })
}

async function processCoachCalendarNotification(user, commandId) {
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in again before notifying parents.')
  const { ok, response, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/manage-scheduled-emails'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'processCalendarNotification', clubId: user.clubId, commandId, teamId: user.activeTeamId }),
  })
  if (!ok || result?.success === false) {
    throw Object.assign(new Error(normalize(result?.message) || 'Parent notifications could not be processed.'), { status: response.status })
  }
  return result
}

export async function saveCoachTrainingInvitation(user, form) {
  const notifyParents = form?.notifyParents === true || form?.requestTrainingAvailability === true
  const requestTrainingAvailability = form?.requestTrainingAvailability === true
  const trainingForm = {
    ...form,
    eventType: 'training',
    notifyParents,
    parentAudience: form?.parentAudience || 'all_team_parents',
    parentVisible: notifyParents,
  }
  const event = await saveCoachCalendarEvent(user, trainingForm)
  let notification = null
  let delivery = null
  let deliveryError = ''

  if (notifyParents) {
    const { error: settingError } = await supabase.rpc('save_training_availability_setting_v3', {
      enabled_value: requestTrainingAvailability,
      event_id_value: event.sourceId,
      notify_invited_families_value: true,
      send_days_before_value: Math.min(30, Math.max(0, Number(form?.trainingAvailabilitySendDaysBefore || 0))),
    })
    if (settingError) throw settingError
  }

  if (config.isProduction && notifyParents && !requestTrainingAvailability) {
    const { data, error } = await supabase.rpc('notify_calendar_event_parents', {
      calendar_event_id_value: event.sourceId,
      event_action_value: 'creation',
      match_day_id_value: null,
      notification_request_token_value: Crypto.randomUUID(),
      player_ids_value: [],
    })
    if (error) throw error
    notification = data || null
    const commandId = normalize(notification?.notificationCommandId)
    if (commandId && Number(notification?.eligibleRecipientCount || 0) > 0) {
      try { delivery = await processCoachCalendarNotification(user, commandId) }
      catch (error) { deliveryError = normalize(error?.message) || 'Parent notifications remain queued for retry.' }
    }
  }

  return Object.freeze({ delivery, deliveryError, event, notification, requestTrainingAvailability })
}

export function getCoachCalendarCommunicationsBoundary() {
  return Object.freeze({
    apiOrigin: config.apiBaseUrl,
    environment: config.supabaseEnvironment,
    externalDeliveryAllowed: config.isProduction,
    mode: config.isProduction ? 'canonical_production_queue' : 'disabled_test_sink',
    productionAccess: config.isProduction,
    schedulesAllowed: config.isProduction,
  })
}
