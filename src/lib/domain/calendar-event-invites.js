import { supabase } from '../supabase-client.js'
import { createAuditLog } from './audit.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'
import { normalizeParentContacts } from './contact-utils.js'
import {
  getEntryIdentity,
  getEntryUserId,
} from './core-normalizers.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeDateOnly(value) {
  const normalizedValue = normalizeText(value)

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

function normalizeTimeOnly(value) {
  const normalizedValue = normalizeText(value)
  return /^\d{2}:\d{2}/.test(normalizedValue) ? normalizedValue.slice(0, 5) : ''
}

function getPrimaryContact(player, parentLink) {
  const contacts = normalizeParentContacts(player?.parentContacts ?? player?.parent_contacts, {
    parentName: player?.parentName ?? player?.parent_name,
    parentEmail: player?.parentEmail ?? player?.parent_email,
  })
  const linkedEmail = normalizeEmail(parentLink?.email)

  if (linkedEmail) {
    const linkedContact = contacts.find((contact) => normalizeEmail(contact.email) === linkedEmail)
    return {
      name: linkedContact?.name || player?.parentName || '',
      email: linkedEmail,
      contacts,
    }
  }

  return {
    name: contacts[0]?.name || player?.parentName || '',
    email: normalizeEmail(contacts[0]?.email || player?.parentEmail),
    contacts,
  }
}

function normalizeInvitePlayer(row) {
  const player = Array.isArray(row.players) ? row.players[0] : row.players

  return {
    id: row.player_id ?? player?.id ?? '',
    playerName: normalizeText(player?.player_name ?? row.player_name),
    section: normalizeText(player?.section ?? row.player_status_at_invite),
    team: normalizeText(player?.team),
    parentName: normalizeText(player?.parent_name ?? row.parent_contact_name),
    parentEmail: normalizeEmail(player?.parent_email ?? row.parent_contact_email),
    parentContacts: normalizeParentContacts(player?.parent_contacts ?? row.recipient_contacts, {
      parentName: player?.parent_name ?? row.parent_contact_name,
      parentEmail: player?.parent_email ?? row.parent_contact_email,
    }),
  }
}

export function normalizeCalendarEventInvite(row) {
  return {
    id: row.id ?? '',
    clubId: row.club_id ?? '',
    teamId: row.team_id ?? '',
    calendarEventId: row.calendar_event_id ?? '',
    assessmentSessionId: row.assessment_session_id ?? '',
    playerId: row.player_id ?? '',
    parentLinkId: row.parent_link_id ?? '',
    playerStatusAtInvite: normalizeText(row.player_status_at_invite),
    recipientType: normalizeText(row.recipient_type) || 'parent_guardian',
    parentContactName: normalizeText(row.parent_contact_name),
    parentContactEmail: normalizeEmail(row.parent_contact_email),
    playerContactEmail: normalizeEmail(row.player_contact_email),
    recipientContacts: Array.isArray(row.recipient_contacts) ? row.recipient_contacts : [],
    inviteStatus: normalizeText(row.invite_status) || 'active',
    notifyRequested: row.notify_requested === true,
    invitedAt: row.invited_at ?? '',
    cancelledAt: row.cancelled_at ?? '',
    respondedAt: row.responded_at ?? '',
    player: normalizeInvitePlayer(row),
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  }
}

function assertInviteAccess(user) {
  if (!user?.clubId || user.role === 'parent_portal' || user.role === 'super_admin' || Number(user.roleRank ?? 0) < 20) {
    throw new Error('Coach or manager access is required for event invites.')
  }
}

function getInviteSourceFilter({ calendarEventId, assessmentSessionId }) {
  const normalizedCalendarEventId = normalizeText(calendarEventId)
  const normalizedAssessmentSessionId = normalizeText(assessmentSessionId)

  if (normalizedCalendarEventId && normalizedAssessmentSessionId) {
    throw new Error('Choose one event source before saving invites.')
  }

  if (!normalizedCalendarEventId && !normalizedAssessmentSessionId) {
    throw new Error('Save the calendar item before inviting players.')
  }

  return normalizedCalendarEventId
    ? { column: 'calendar_event_id', value: normalizedCalendarEventId }
    : { column: 'assessment_session_id', value: normalizedAssessmentSessionId }
}

async function getActiveParentLinks({ clubId, teamId, playerIds }) {
  const normalizedPlayerIds = [...new Set((playerIds ?? []).map((id) => normalizeText(id)).filter(Boolean))]

  if (!clubId || !teamId || normalizedPlayerIds.length === 0) {
    return new Map()
  }

  const { data, error } = await supabase
    .from('parent_player_links')
    .select('id, player_id, email, link_type, status')
    .eq('club_id', clubId)
    .eq('team_id', teamId)
    .eq('status', 'active')
    .in('player_id', normalizedPlayerIds)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(error)
    throw error
  }

  const linkMap = new Map()

  ;(data ?? []).forEach((link) => {
    const playerId = normalizeText(link.player_id)
    if (playerId && !linkMap.has(playerId)) {
      linkMap.set(playerId, link)
    }
  })

  return linkMap
}

export async function getCalendarEventInvites({ user } = {}) {
  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  const { data, error } = await supabase
    .from('calendar_event_invites')
    .select('*, players:player_id (id, player_name, section, team, parent_name, parent_email, parent_contacts)')
    .eq('club_id', user.clubId)
    .neq('invite_status', 'cancelled')
    .order('created_at', { ascending: false })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeCalendarEventInvite)
}

export async function saveCalendarEventInvites({
  user,
  calendarEventId = '',
  assessmentSessionId = '',
  teamId = '',
  players = [],
  notifyRequested = false,
} = {}) {
  await blockDemoMutation(user)
  assertInviteAccess(user)

  const sourceFilter = getInviteSourceFilter({ calendarEventId, assessmentSessionId })
  const normalizedTeamId = normalizeText(teamId)
  const selectedPlayers = (players ?? [])
    .filter((player) => normalizeText(player?.id))
    .filter((player, index, allPlayers) => allPlayers.findIndex((candidate) => normalizeText(candidate.id) === normalizeText(player.id)) === index)

  if (!normalizedTeamId && selectedPlayers.length > 0) {
    throw new Error('Choose a team before inviting players.')
  }

  const existingQuery = supabase
    .from('calendar_event_invites')
    .select('*')
    .eq('club_id', user.clubId)
    .eq(sourceFilter.column, sourceFilter.value)
    .neq('invite_status', 'cancelled')

  const { data: existingRows, error: existingError } = await existingQuery

  if (existingError) {
    console.error(existingError)
    throw existingError
  }

  const selectedPlayerIds = selectedPlayers.map((player) => normalizeText(player.id))
  const cancelIds = (existingRows ?? [])
    .filter((row) => !selectedPlayerIds.includes(normalizeText(row.player_id)))
    .map((row) => row.id)

  if (cancelIds.length > 0) {
    const { error: cancelError } = await supabase
      .from('calendar_event_invites')
      .update({
        invite_status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_by: getEntryUserId(user),
        ...getEntryIdentity(user, 'updated_by'),
      })
      .in('id', cancelIds)

    if (cancelError) {
      console.error(cancelError)
      throw cancelError
    }
  }

  if (selectedPlayers.length === 0) {
    clearViewCaches()
    invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)
    invalidateMemoryCacheByPrefix(`assessment-sessions:${user.clubId}:`)
    return []
  }

  const parentLinks = await getActiveParentLinks({
    clubId: user.clubId,
    teamId: normalizedTeamId,
    playerIds: selectedPlayerIds,
  })
  const existingRowsByPlayerId = new Map(
    (existingRows ?? []).map((row) => [normalizeText(row.player_id), row]),
  )

  const rows = selectedPlayers.map((player) => {
    const parentLink = parentLinks.get(normalizeText(player.id))
    const contact = getPrimaryContact(player, parentLink)
    const existingRow = existingRowsByPlayerId.get(normalizeText(player.id))

    return {
      club_id: user.clubId,
      team_id: normalizedTeamId,
      calendar_event_id: sourceFilter.column === 'calendar_event_id' ? sourceFilter.value : null,
      assessment_session_id: sourceFilter.column === 'assessment_session_id' ? sourceFilter.value : null,
      player_id: player.id,
      parent_link_id: parentLink?.id || null,
      player_status_at_invite: normalizeText(player.section || player.status),
      recipient_type: 'parent_guardian',
      parent_contact_name: contact.name,
      parent_contact_email: contact.email,
      player_contact_email: '',
      recipient_contacts: contact.contacts,
      invite_status: existingRow?.responded_at ? existingRow.invite_status : 'active',
      notify_requested: notifyRequested === true,
      cancelled_at: null,
      created_by: getEntryUserId(user),
      ...getEntryIdentity(user),
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
      updated_at: new Date().toISOString(),
    }
  })

  const { data, error } = await supabase
    .from('calendar_event_invites')
    .upsert(rows, {
      onConflict: 'club_id,player_id,calendar_event_id,assessment_session_id',
    })
    .select('*, players:player_id (id, player_name, section, team, parent_name, parent_email, parent_contacts)')

  if (error) {
    console.error(error)
    throw error
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix(`calendar-events:${user.clubId}:`)
  invalidateMemoryCacheByPrefix(`assessment-sessions:${user.clubId}:`)
  await createAuditLog({
    user,
    action: 'calendar_event_invites_saved',
    entityType: sourceFilter.column === 'calendar_event_id' ? 'calendar_event' : 'assessment_session',
    entityId: sourceFilter.value,
    metadata: {
      playerCount: selectedPlayers.length,
      teamId: normalizedTeamId,
      notifyRequested: notifyRequested === true,
    },
  })

  return (data ?? []).map(normalizeCalendarEventInvite)
}

function normalizeParentPortalInvite(row) {
  const calendarEvent = Array.isArray(row.calendar_events) ? row.calendar_events[0] : row.calendar_events
  const session = Array.isArray(row.assessment_sessions) ? row.assessment_sessions[0] : row.assessment_sessions
  const isSession = Boolean(session?.id)
  const startsAt = isSession
    ? `${normalizeDateOnly(session.session_date)}T${normalizeTimeOnly(session.start_time) || '00:00'}:00`
    : calendarEvent?.starts_at || ''
  const endsAt = isSession
    ? `${normalizeDateOnly(session.session_date)}T${normalizeTimeOnly(session.end_time) || normalizeTimeOnly(session.start_time) || '00:00'}:00`
    : calendarEvent?.ends_at || ''

  return {
    id: row.id ?? '',
    inviteStatus: normalizeText(row.invite_status) || 'active',
    sourceType: isSession ? 'training' : 'calendar',
    title: normalizeText(isSession ? session.title || session.team : calendarEvent?.title) || 'Club event',
    eventType: normalizeText(isSession ? session.session_type : calendarEvent?.event_type) || 'general',
    arrivalTime: normalizeTimeOnly(session?.arrival_time),
    startsAt,
    endsAt,
    location: normalizeText(isSession ? session.location : calendarEvent?.location),
    notes: normalizeText(isSession ? session.notes : calendarEvent?.notes),
    parentContactEmail: normalizeEmail(row.parent_contact_email),
    notifyRequested: row.notify_requested === true,
    invitedAt: row.invited_at ?? '',
  }
}

export async function getParentPortalEventInvites({ parentLinkId } = {}) {
  const normalizedParentLinkId = normalizeText(parentLinkId)

  if (!normalizedParentLinkId) {
    return []
  }

  const { data: link, error: linkError } = await supabase
    .from('parent_player_links')
    .select('club_id, player_id, status')
    .eq('id', normalizedParentLinkId)
    .eq('status', 'active')
    .single()

  if (linkError) {
    console.error(linkError)
    throw linkError
  }

  const { data, error } = await supabase
    .from('calendar_event_invites')
    .select('*, calendar_events:calendar_event_id (id, title, event_type, starts_at, ends_at, location, notes, parent_visible, parent_audience), assessment_sessions:assessment_session_id (id, title, session_type, session_date, arrival_time, start_time, end_time, location, notes, team)')
    .eq('club_id', link.club_id)
    .eq('player_id', link.player_id)
    .eq('parent_link_id', normalizedParentLinkId)
    .neq('invite_status', 'cancelled')
    .order('invited_at', { ascending: false })

  if (error) {
    console.error(error)
    throw error
  }

  const now = Date.now()

  return (data ?? [])
    .filter((row) => {
      const calendarEvent = Array.isArray(row.calendar_events) ? row.calendar_events[0] : row.calendar_events

      if (!calendarEvent?.id) {
        return true
      }

      return calendarEvent.parent_visible === true && calendarEvent.parent_audience === 'involved_players'
    })
    .map(normalizeParentPortalInvite)
    .filter((invite) => {
      const startsAt = new Date(invite.startsAt)
      return !Number.isNaN(startsAt.getTime()) && startsAt.getTime() >= now - 86400000
    })
    .sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt)))
}
