import { supabase } from '../supabase-client.js'
import { createAuditLog } from './audit.js'
import { clearViewCaches, getCachedResource, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'
import {
  getEntryIdentity,
  getEntryUserId,
  normalizeDateOnly,
} from './core-normalizers.js'
import { getSessionTeamsForUser } from './team-actions.js'

const EVENT_TYPES = ['general', 'availability_deadline', 'parent_cutoff']
const RECURRENCE_FREQUENCIES = ['none', 'weekly', 'fortnightly', 'monthly']

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
    cancelledAt: row.cancelled_at ?? row.cancelledAt ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: normalizeText(row.created_by_name ?? row.createdByName),
    createdByEmail: normalizeText(row.created_by_email ?? row.createdByEmail),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: normalizeText(row.updated_by_name ?? row.updatedByName),
    updatedByEmail: normalizeText(row.updated_by_email ?? row.updatedByEmail),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
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
  const startsAt = normalizeDateTime(event?.startsAt)
  const endsAt = normalizeDateTime(event?.endsAt)
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
    throw new Error('Choose a date and start time.')
  }

  if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    throw new Error('End time must be after the start time.')
  }

  if (!isClubLevelAllowed && !safeTeamId) {
    throw new Error('Choose a team for this event.')
  }

  if (recurrenceFrequency !== 'none' && !recurrenceUntil) {
    throw new Error('Add a repeat until date for recurring events.')
  }

  return {
    club_id: user.clubId,
    team_id: safeTeamId || null,
    event_type: eventType,
    title,
    starts_at: startsAt,
    ends_at: endsAt || null,
    location: normalizeText(event?.location),
    notes: normalizeText(event?.notes),
    recurrence_frequency: recurrenceFrequency,
    recurrence_until: recurrenceFrequency === 'none' ? null : recurrenceUntil,
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

export async function getCalendarEvents({ user } = {}) {
  if (!user?.clubId || user.role === 'parent_portal' || user.role === 'super_admin') {
    return []
  }

  const activeTeamId = normalizeText(user.activeTeamId)
  const cacheKey = `calendar-events:${user.clubId}:${user.id}:${user.roleRank}:${activeTeamId || 'club-wide'}`

  return getCachedResource(cacheKey, async () => {
    let query = supabase
      .from('calendar_events')
      .select('*')
      .eq('club_id', user.clubId)
      .is('cancelled_at', null)
      .order('starts_at', { ascending: true })

    if (activeTeamId) {
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

export async function deleteCalendarEvent({ user, eventId }) {
  await blockDemoMutation(user)
  assertCalendarAccess(user)

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
