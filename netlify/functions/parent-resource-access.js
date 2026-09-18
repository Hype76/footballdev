/* global Netlify */
import { createClient } from '@supabase/supabase-js'
import { assertParentPlanFeatureForScope } from './lib/_parent-plan-gate.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const RESOURCE_LIBRARY_BUCKET = 'resource-library'
const SIGNED_URL_EXPIRY_SECONDS = 60

class ParentResourceAccessError extends Error {
  constructor(message, status = 403) {
    super(message)
    this.status = status
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function getBearerToken(request) {
  const [scheme, token] = normalizeText(request.headers.get('authorization')).split(/\s+/, 2)
  return scheme?.toLowerCase() === 'bearer' ? normalizeText(token) : ''
}

function normalizeExternalUrl(value) {
  try {
    const parsedUrl = new URL(normalizeText(value))
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : ''
  } catch {
    return ''
  }
}

function isScopedResourceStoragePath(value, clubId, teamId) {
  const storagePath = normalizeText(value)
  const pathSegments = storagePath.split('/')

  return !storagePath.includes('\\')
    && pathSegments.length >= 3
    && pathSegments.every((segment) => segment && segment !== '.' && segment !== '..')
    && pathSegments[0] === normalizeText(clubId)
    && pathSegments[1] === normalizeText(teamId)
}

export function validateParentResourceAccess({
  authUserId,
  externalLink,
  parentLink,
  player,
  resource,
  resourceLink,
} = {}) {
  const normalizedAuthUserId = normalizeText(authUserId)

  if (!normalizedAuthUserId
    || !parentLink
    || normalizeText(parentLink.auth_user_id) !== normalizedAuthUserId
    || normalizeText(parentLink.status) !== 'active') {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  if (!player
    || normalizeText(player.id) !== normalizeText(parentLink.player_id)
    || normalizeText(player.club_id) !== normalizeText(parentLink.club_id)
    || normalizeText(player.status || 'active') === 'archived'
    || player.archived_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  if (parentLink.team_id && normalizeText(parentLink.team_id) !== normalizeText(player.team_id)) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  if (!resourceLink
    || normalizeText(resourceLink.club_id) !== normalizeText(parentLink.club_id)
    || normalizeText(resourceLink.team_id) !== normalizeText(player.team_id)
    || normalizeText(resourceLink.linked_type) !== 'player'
    || normalizeText(resourceLink.linked_id) !== normalizeText(player.id)
    || resourceLink.parent_visible !== true
    || resourceLink.removed_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  if (!resource
    || normalizeText(resource.id) !== normalizeText(resourceLink.resource_id)
    || normalizeText(resource.club_id) !== normalizeText(resourceLink.club_id)
    || normalizeText(resource.team_id) !== normalizeText(resourceLink.team_id)
    || resource.archived_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  const externalUrl = normalizeExternalUrl(externalLink?.external_url)

  if (externalLink && (!externalUrl
    || normalizeText(externalLink.resource_id) !== normalizeText(resource.id)
    || normalizeText(externalLink.club_id) !== normalizeText(resource.club_id)
    || normalizeText(externalLink.team_id) !== normalizeText(resource.team_id))) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  if (externalUrl) {
    return {
      accessType: 'external_link',
      accessUrl: externalUrl,
      expiresInSeconds: null,
    }
  }

  if (normalizeText(resource.storage_bucket) !== RESOURCE_LIBRARY_BUCKET
    || !isScopedResourceStoragePath(resource.storage_path, resource.club_id, resource.team_id)) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  return {
    accessType: 'file',
    accessUrl: '',
    expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
  }
}

export function validateParentCalendarEventResourceAccess({
  authUserId,
  calendarInvite,
  calendarEvent,
  calendarOccurrenceDate,
  externalLink,
  parentLink,
  player,
  resource,
  resourceLink,
} = {}) {
  const normalizedAuthUserId = normalizeText(authUserId)
  const eventAudience = normalizeText(calendarEvent?.parent_audience)
  const eventTeamId = normalizeText(calendarEvent?.team_id)
  const parentTeamId = normalizeText(parentLink?.team_id)
  const playerId = normalizeText(player?.id)

  if (!normalizedAuthUserId
    || !parentLink
    || normalizeText(parentLink.auth_user_id) !== normalizedAuthUserId
    || normalizeText(parentLink.status) !== 'active') {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  if (!player
    || normalizeText(player.id) !== normalizeText(parentLink.player_id)
    || normalizeText(player.club_id) !== normalizeText(parentLink.club_id)
    || normalizeText(player.status || 'active') === 'archived'
    || player.archived_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  const eventIsVisible = calendarEvent
    && normalizeText(calendarEvent.club_id) === normalizeText(parentLink.club_id)
    && calendarEvent.parent_visible === true
    && !calendarEvent.cancelled_at
    && (
      eventAudience === 'all_club_parents'
      || (eventAudience === 'all_team_parents' && eventTeamId && eventTeamId === parentTeamId)
      || (eventAudience === 'involved_players'
        && eventTeamId
        && eventTeamId === parentTeamId
        && calendarInvite
        && normalizeText(calendarInvite.club_id) === normalizeText(calendarEvent.club_id)
        && normalizeText(calendarInvite.team_id) === eventTeamId
        && normalizeText(calendarInvite.calendar_event_id) === normalizeText(calendarEvent.id)
        && normalizeText(calendarInvite.player_id) === playerId
        && normalizeText(calendarInvite.invite_status) !== 'cancelled'
        && !calendarInvite.cancelled_at)
    )

  if (!eventIsVisible || !eventTeamId) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  if (!resourceLink
    || normalizeText(resourceLink.club_id) !== normalizeText(calendarEvent.club_id)
    || normalizeText(resourceLink.team_id) !== eventTeamId
    || normalizeText(resourceLink.linked_type) !== 'calendar_event'
    || normalizeText(resourceLink.linked_id) !== normalizeText(calendarEvent.id)
    || normalizeText(resourceLink.calendar_occurrence_date) !== normalizeText(calendarOccurrenceDate)
    || resourceLink.removed_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  if (!resource
    || normalizeText(resource.id) !== normalizeText(resourceLink.resource_id)
    || normalizeText(resource.club_id) !== normalizeText(resourceLink.club_id)
    || normalizeText(resource.team_id) !== normalizeText(resourceLink.team_id)
    || resource.archived_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  const externalUrl = normalizeExternalUrl(externalLink?.external_url)

  if (externalLink && (!externalUrl
    || normalizeText(externalLink.resource_id) !== normalizeText(resource.id)
    || normalizeText(externalLink.club_id) !== normalizeText(resource.club_id)
    || normalizeText(externalLink.team_id) !== normalizeText(resource.team_id))) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  if (externalUrl) {
    return {
      accessType: 'external_link',
      accessUrl: externalUrl,
      expiresInSeconds: null,
    }
  }

  if (normalizeText(resource.storage_bucket) !== RESOURCE_LIBRARY_BUCKET
    || !isScopedResourceStoragePath(resource.storage_path, resource.club_id, resource.team_id)) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }

  return {
    accessType: 'file',
    accessUrl: '',
    expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
  }
}

export function validateParentDerivedEventResourceAccess({ authUserId, calendarEvent, calendarOccurrenceDate, externalLink, parentLink, player, resource, resourceLink } = {}) {
  const sourceType = normalizeText(calendarEvent?.resourceSourceType)
  if (!['match_day', 'assessment_session'].includes(sourceType)
    || calendarEvent?.authorised !== true
    || normalizeText(calendarEvent.club_id) !== normalizeText(parentLink?.club_id)
    || !normalizeText(calendarEvent.team_id)
    || normalizeText(calendarEvent.team_id) !== normalizeText(player?.team_id)
    || normalizeText(calendarEvent.team_id) !== normalizeText(parentLink?.team_id)
    || normalizeText(calendarEvent.occurrenceDate) !== normalizeText(calendarOccurrenceDate)
    || !resourceLink
    || normalizeText(resourceLink.linked_type) !== sourceType
    || normalizeText(resourceLink.linked_id) !== normalizeText(calendarEvent.id)
    || resourceLink.calendar_occurrence_date != null) {
    throw new ParentResourceAccessError('This resource is not available for the selected player.')
  }
  // Event visibility was resolved through the signed-in Parent's canonical read model.
  // Keep file, external URL and current family ownership checks identical to player resources.
  return validateParentResourceAccess({ authUserId, externalLink, parentLink, player, resource,
    resourceLink: { ...resourceLink, linked_type: 'player', linked_id: player.id, parent_visible: true },
  })
}

async function readAllRows(query) {
  const rows = []
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await query().range(offset, offset + 499)
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Event visibility could not be verified.')
    rows.push(...data)
    if (data.length < 500) return rows
  }
  throw new Error('Too many events to verify resource visibility safely.')
}

export async function loadParentDerivedResourceEvents({ parentLink, player, parentClient, supabaseAdmin, cutoffDate = '', targetSourceType = '', targetEventId = '' }) {
  if (!parentClient || !parentLink.team_id || normalizeText(parentLink.team_id) !== normalizeText(player.team_id)) return []
  const [matches, invitations] = await Promise.all([
    targetSourceType === 'assessment_session' ? Promise.resolve([]) : readAllRows(() => {
      let query = parentClient.rpc('get_parent_portal_match_days', { parent_link_id_value: parentLink.id })
        .select('id,club_id,team_id,match_date,status').order('id')
      if (targetEventId) query = query.eq('id', targetEventId)
      if (cutoffDate) query = query.gte('match_date', cutoffDate)
      return query
    }),
    targetSourceType === 'match_day' ? Promise.resolve([]) : readAllRows(() => {
      let query = parentClient.rpc('get_parent_portal_invitation_state', { parent_link_id_value: parentLink.id })
        .select('invitation_id,event_id,source_event_type,child_id,parent_link_id,invitation_state,event_date')
        .eq('source_event_type', 'assessment_session').eq('child_id', player.id).eq('parent_link_id', parentLink.id).order('event_id').order('invitation_id')
      if (targetEventId) query = query.eq('event_id', targetEventId)
      if (cutoffDate) query = query.gte('event_date', cutoffDate)
      return query
    }),
  ])
  const sources = matches.filter((row) => normalizeText(row.club_id) === normalizeText(parentLink.club_id)
    && normalizeText(row.team_id) === normalizeText(player.team_id)
    && (!targetEventId || row.id === targetEventId) && (!cutoffDate || row.match_date >= cutoffDate)
    && !['cancelled', 'postponed'].includes(normalizeText(row.status)) && DATE_PATTERN.test(normalizeText(row.match_date)))
    .map((row) => ({ ...row, resourceSourceType: 'match_day', occurrenceDate: row.match_date, authorised: true }))
  const visibleInvitations = invitations.filter((row) => row.source_event_type === 'assessment_session'
    && (!targetEventId || row.event_id === targetEventId) && (!cutoffDate || row.event_date >= cutoffDate)
    && normalizeText(row.child_id) === normalizeText(player.id) && normalizeText(row.parent_link_id) === normalizeText(parentLink.id)
    && ['active', 'closed', 'expired'].includes(normalizeText(row.invitation_state)))
  const sessionIds = [...new Set(visibleInvitations.map((row) => row.event_id).filter(Boolean))]
  for (let offset = 0; offset < sessionIds.length; offset += 100) {
    const { data: sessions, error } = await supabaseAdmin.from('assessment_sessions')
      .select('id,club_id,team_id,status,session_date').eq('club_id', parentLink.club_id).eq('team_id', player.team_id)
      .in('id', sessionIds.slice(offset, offset + 100)).neq('status', 'cancelled')
    if (error) throw error
    for (const session of sessions || []) {
      const invitation = visibleInvitations.find((row) => row.event_id === session.id)
      if (normalizeText(session.club_id) !== normalizeText(parentLink.club_id) || normalizeText(session.team_id) !== normalizeText(player.team_id)
        || session.status === 'cancelled' || !invitation || !DATE_PATTERN.test(normalizeText(invitation.event_date))
        || normalizeText(session.session_date) !== normalizeText(invitation.event_date)) continue
      sources.push({ ...session, resourceSourceType: 'assessment_session', occurrenceDate: invitation.event_date, authorised: true })
    }
  }
  return sources
}

async function maybeSingle(query, errorMessage) {
  const { data, error } = await query.maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new ParentResourceAccessError(errorMessage)
  }

  return data
}

async function loadActiveParentContext({ authUserId, parentLinkId, supabaseAdmin }) {
  const unavailableMessage = 'This resource is not available for the selected player.'
  const parentLink = await maybeSingle(
    supabaseAdmin
      .from('parent_player_links')
      .select('id, auth_user_id, club_id, team_id, player_id, status')
      .eq('id', parentLinkId)
      .eq('auth_user_id', authUserId)
      .eq('status', 'active'),
    unavailableMessage,
  )
  const player = await maybeSingle(
    supabaseAdmin
      .from('players')
      .select('id, club_id, team_id, status, archived_at')
      .eq('id', parentLink.player_id)
      .eq('club_id', parentLink.club_id),
    unavailableMessage,
  )

  if (normalizeText(player.status || 'active') === 'archived' || player.archived_at) {
    throw new ParentResourceAccessError(unavailableMessage)
  }

  return { parentLink, player }
}

export async function listAuthorisedCalendarEventResources({ authUserId, parentLinkId, supabaseAdmin, parentClient }) {
  const { parentLink, player } = await loadActiveParentContext({ authUserId, parentLinkId, supabaseAdmin })
  const cutoff = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString()
  const cutoffDate = cutoff.slice(0, 10)
  const { data: calendarEvents, error: calendarError } = await supabaseAdmin
    .from('calendar_events')
    .select('id, club_id, team_id, parent_visible, parent_audience, cancelled_at, starts_at')
    .eq('club_id', parentLink.club_id)
    .eq('parent_visible', true)
    .is('cancelled_at', null)
    .in('parent_audience', ['involved_players', 'all_team_parents', 'all_club_parents'])
    .or(`starts_at.gte.${cutoff},recurrence_until.gte.${cutoffDate}`)
    .order('starts_at', { ascending: true })
    .limit(180)

  if (calendarError) throw calendarError

  const involvedEventIds = (calendarEvents || [])
    .filter((event) => event.parent_audience === 'involved_players'
      && normalizeText(event.team_id) === normalizeText(parentLink.team_id))
    .map((event) => normalizeText(event.id))
    .filter(Boolean)
  let activeInviteEventIds = new Set()

  if (involvedEventIds.length > 0) {
    const { data: calendarInvites, error: calendarInvitesError } = await supabaseAdmin
      .from('calendar_event_invites')
      .select('calendar_event_id, club_id, team_id, player_id, invite_status, cancelled_at')
      .eq('club_id', parentLink.club_id)
      .eq('team_id', parentLink.team_id)
      .eq('player_id', player.id)
      .in('calendar_event_id', involvedEventIds)
      .neq('invite_status', 'cancelled')
      .is('cancelled_at', null)
      .limit(180)

    if (calendarInvitesError) throw calendarInvitesError

    activeInviteEventIds = new Set((calendarInvites || []).filter((invite) => (
      normalizeText(invite.club_id) === normalizeText(parentLink.club_id)
      && normalizeText(invite.team_id) === normalizeText(parentLink.team_id)
      && normalizeText(invite.player_id) === normalizeText(player.id)
      && normalizeText(invite.invite_status) !== 'cancelled'
      && !invite.cancelled_at
    )).map((invite) => normalizeText(invite.calendar_event_id)))
  }

  const visibleEvents = (calendarEvents || []).filter((event) => (
    event.parent_audience === 'all_club_parents'
    || (event.parent_audience === 'all_team_parents'
      && normalizeText(event.team_id)
      && normalizeText(event.team_id) === normalizeText(parentLink.team_id))
    || (event.parent_audience === 'involved_players'
      && normalizeText(event.team_id) === normalizeText(parentLink.team_id)
      && activeInviteEventIds.has(normalizeText(event.id)))
  ))
  const derivedEvents = await loadParentDerivedResourceEvents({ parentLink, player, parentClient, supabaseAdmin, cutoffDate })
  const eventKey = (type, id) => `${type || 'calendar_event'}:${normalizeText(id)}`
  const eventById = new Map([...visibleEvents, ...derivedEvents].map((event) => [eventKey(event.resourceSourceType, event.id), event]))

  if (eventById.size === 0) return []

  const sourceIds = [...new Set([...eventById.values()].map((event) => event.id))]
  const resourceLinks = []
  for (let offset = 0; offset < sourceIds.length; offset += 100) {
    resourceLinks.push(...await readAllRows(() => supabaseAdmin
      .from('resource_library_links')
      .select('id, resource_id, club_id, team_id, linked_type, linked_id, calendar_occurrence_date, assigned_at, removed_at')
      .eq('club_id', parentLink.club_id)
      .in('linked_type', ['calendar_event', 'match_day', 'assessment_session'])
      .in('linked_id', sourceIds.slice(offset, offset + 100))
      .is('removed_at', null)
      .order('assigned_at', { ascending: false }).order('id')))
  }

  const inScopeLinks = (resourceLinks || []).filter((link) => {
    const event = eventById.get(eventKey(link.linked_type, link.linked_id))
    return event && normalizeText(link.team_id) === normalizeText(event.team_id)
      && (!event.resourceSourceType || link.calendar_occurrence_date == null)
  })
  const resourceIds = [...new Set(inScopeLinks.map((link) => normalizeText(link.resource_id)).filter(Boolean))]

  if (resourceIds.length === 0) return []

  const resources = []
  const externalLinks = []
  for (let offset = 0; offset < resourceIds.length; offset += 100) {
    const ids = resourceIds.slice(offset, offset + 100)
    const [resourceResult, externalResult] = await Promise.all([
      supabaseAdmin.from('resource_library_items')
        .select('id, club_id, team_id, title, category, original_filename, file_size_bytes, archived_at')
        .eq('club_id', parentLink.club_id).in('id', ids).is('archived_at', null),
      supabaseAdmin.from('resource_library_external_links')
        .select('resource_id, club_id, team_id').eq('club_id', parentLink.club_id).in('resource_id', ids),
    ])
    if (resourceResult.error || externalResult.error) throw resourceResult.error || externalResult.error
    if (!Array.isArray(resourceResult.data) || !Array.isArray(externalResult.data)) throw new Error('Resource metadata could not be verified.')
    resources.push(...resourceResult.data)
    externalLinks.push(...externalResult.data)
  }

  const resourceById = new Map((resources || []).map((resource) => [normalizeText(resource.id), resource]))
  const externalResourceIds = new Set((externalLinks || []).filter((link) => {
    const resource = resourceById.get(normalizeText(link.resource_id))
    return resource
      && normalizeText(link.club_id) === normalizeText(resource.club_id)
      && normalizeText(link.team_id) === normalizeText(resource.team_id)
  }).map((link) => normalizeText(link.resource_id)))

  return inScopeLinks.map((link) => {
    const resource = resourceById.get(normalizeText(link.resource_id))
    const event = eventById.get(eventKey(link.linked_type, link.linked_id))

    if (!resource
      || normalizeText(resource.club_id) !== normalizeText(link.club_id)
      || normalizeText(resource.team_id) !== normalizeText(link.team_id)
      || !event) return null

    return {
      eventId: normalizeText(event.id),
      sourceType: event.resourceSourceType || 'calendar_event',
      occurrenceDate: normalizeText(event.resourceSourceType ? event.occurrenceDate : link.calendar_occurrence_date),
      id: normalizeText(resource.id),
      title: normalizeText(resource.title) || normalizeText(resource.original_filename) || 'Event attachment',
      category: normalizeText(resource.category) || 'general',
      resourceType: externalResourceIds.has(normalizeText(resource.id)) ? 'external_link' : 'file',
      originalFilename: normalizeText(resource.original_filename),
      fileSizeBytes: Math.max(0, Number(resource.file_size_bytes || 0)),
    }
  }).filter(Boolean)
}

export async function loadAuthorisedResource({ authUserId, calendarEventId = '', calendarOccurrenceDate = '', calendarSourceType = 'calendar_event', parentLinkId, resourceId, supabaseAdmin, parentClient }) {
  const unavailableMessage = 'This resource is not available for the selected player.'
  const { parentLink, player } = await loadActiveParentContext({ authUserId, parentLinkId, supabaseAdmin })
  const derivedSource = calendarEventId && ['match_day', 'assessment_session'].includes(calendarSourceType)
  const derivedEvents = derivedSource ? await loadParentDerivedResourceEvents({ parentLink, player, parentClient, supabaseAdmin, targetSourceType: calendarSourceType, targetEventId: calendarEventId }) : []
  const derivedEvent = derivedEvents.find((event) => event.resourceSourceType === calendarSourceType && event.id === calendarEventId
    && event.occurrenceDate === calendarOccurrenceDate)
  if (derivedSource && !derivedEvent) throw new ParentResourceAccessError(unavailableMessage)
  const calendarEvent = derivedEvent || (calendarEventId
    ? await maybeSingle(
        supabaseAdmin
          .from('calendar_events')
          .select('id, club_id, team_id, parent_visible, parent_audience, cancelled_at')
          .eq('id', calendarEventId)
          .eq('club_id', parentLink.club_id)
          .eq('parent_visible', true)
          .is('cancelled_at', null),
        unavailableMessage,
      )
    : null)
  const calendarInvite = calendarEvent?.parent_audience === 'involved_players'
    ? await maybeSingle(
        supabaseAdmin
          .from('calendar_event_invites')
          .select('calendar_event_id, club_id, team_id, player_id, invite_status, cancelled_at')
          .eq('calendar_event_id', calendarEvent.id)
          .eq('club_id', calendarEvent.club_id)
          .eq('team_id', calendarEvent.team_id)
          .eq('player_id', player.id)
          .neq('invite_status', 'cancelled')
          .is('cancelled_at', null),
        unavailableMessage,
      )
    : null
  let resourceLinkQuery = supabaseAdmin
    .from('resource_library_links')
    .select('id, resource_id, club_id, team_id, linked_type, linked_id, calendar_occurrence_date, parent_visible, removed_at')
    .eq('resource_id', resourceId)
    .eq('club_id', parentLink.club_id)
    .eq('team_id', calendarEvent ? calendarEvent.team_id : player.team_id)
    .eq('linked_type', calendarEvent ? calendarSourceType : 'player')
    .eq('linked_id', calendarEvent ? calendarEvent.id : player.id)
    .is('removed_at', null)

  if (!calendarEvent) resourceLinkQuery = resourceLinkQuery.eq('parent_visible', true)
  else if (derivedEvent) resourceLinkQuery = resourceLinkQuery.is('calendar_occurrence_date', null)
  else resourceLinkQuery = resourceLinkQuery.eq('calendar_occurrence_date', calendarOccurrenceDate)

  const resourceLink = await maybeSingle(resourceLinkQuery, unavailableMessage)
  const resource = await maybeSingle(
    supabaseAdmin
      .from('resource_library_items')
      .select('id, club_id, team_id, title, description, mime_type, storage_bucket, storage_path, archived_at')
      .eq('id', resourceId)
      .eq('club_id', parentLink.club_id)
      .eq('team_id', resourceLink.team_id)
      .is('archived_at', null),
    unavailableMessage,
  )
  const { data: externalLink, error: externalLinkError } = await supabaseAdmin
    .from('resource_library_external_links')
    .select('resource_id, club_id, team_id, external_url')
    .eq('resource_id', resourceId)
    .maybeSingle()

  if (externalLinkError) {
    throw externalLinkError
  }

  const access = derivedEvent
    ? validateParentDerivedEventResourceAccess({ authUserId, calendarEvent, calendarOccurrenceDate, externalLink, parentLink, player, resource, resourceLink })
    : calendarEvent
    ? validateParentCalendarEventResourceAccess({ authUserId, calendarEvent, calendarInvite, calendarOccurrenceDate, externalLink, parentLink, player, resource, resourceLink })
    : validateParentResourceAccess({ authUserId, externalLink, parentLink, player, resource, resourceLink })

  const { data: publication, error: publicationError } = await supabaseAdmin
    .from('formation_board_publications')
    .select('board_id, board_version_id, board_title_snapshot, board_description_snapshot, publication_number')
    .eq('resource_id', resourceId)
    .eq('club_id', parentLink.club_id)
    .eq('team_id', resource.team_id)
    .order('publication_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (publicationError) throw publicationError

  let formationBoard = null
  if (publication) {
    const version = await maybeSingle(
      supabaseAdmin
        .from('formation_board_versions')
        .select('id, board_id, club_id, team_id, game_format, formation_preset_key, pitch_orientation, placements, bench, notes, created_at')
        .eq('id', publication.board_version_id)
        .eq('board_id', publication.board_id)
        .eq('club_id', parentLink.club_id)
        .eq('team_id', resource.team_id),
      unavailableMessage,
    )
    formationBoard = {
      bench: Array.isArray(version.bench) ? version.bench : [],
      description: normalizeText(publication.board_description_snapshot || resource.description),
      formation: normalizeText(version.formation_preset_key),
      gameFormat: normalizeText(version.game_format),
      id: normalizeText(version.id),
      notes: normalizeText(version.notes),
      orientation: normalizeText(version.pitch_orientation) || 'portrait',
      placements: Array.isArray(version.placements) ? version.placements : [],
      title: normalizeText(publication.board_title_snapshot || resource.title) || 'Formation Board',
    }
  }

  return {
    access,
    formationBoard,
    resource,
  }
}

export default async (request) => {
  if (request.method !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const accessToken = getBearerToken(request)

    if (!accessToken) {
      throw new ParentResourceAccessError('Sign in again before opening this resource.', 401)
    }

    const body = await request.json().catch(() => ({}))
    const action = normalizeText(body.action).toLowerCase()
    const parentLinkId = normalizeText(body.parentLinkId)
    const resourceId = normalizeText(body.resourceId)
    const calendarEventId = normalizeText(body.calendarEventId)
    const calendarOccurrenceDate = normalizeText(body.calendarOccurrenceDate)
    const calendarSourceType = normalizeText(body.calendarSourceType) || 'calendar_event'
    if (!['calendar_event', 'match_day', 'assessment_session'].includes(calendarSourceType)) {
      throw new ParentResourceAccessError('Choose a valid shared resource.', 400)
    }

    if (!UUID_PATTERN.test(parentLinkId)) {
      throw new ParentResourceAccessError('Choose a valid shared resource.', 400)
    }

    const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL')
    const serviceRoleKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Parent resource access is not configured.')
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken)

    if (authError || !authData?.user?.id) {
      throw new ParentResourceAccessError('Sign in again before opening this resource.', 401)
    }

    const parentClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
    const { parentLink, player } = await loadActiveParentContext({
      authUserId: authData.user.id,
      parentLinkId,
      supabaseAdmin,
    })
    await assertParentPlanFeatureForScope({
      actionCategory: 'READ',
      clubId: parentLink.club_id,
      featureName: 'resourceLibrary',
      parentLinkId: parentLink.id,
      playerId: player.id,
      teamId: parentLink.team_id || player.team_id,
    })

    if (action === 'list_calendar_event_resources') {
      const resources = await listAuthorisedCalendarEventResources({
        authUserId: authData.user.id,
        parentLinkId,
        supabaseAdmin,
        parentClient,
      })
      return json(200, { success: true, resources })
    }

    if (!UUID_PATTERN.test(resourceId)
      || (calendarEventId && !UUID_PATTERN.test(calendarEventId))
      || (calendarEventId && !DATE_PATTERN.test(calendarOccurrenceDate))) {
      throw new ParentResourceAccessError('Choose a valid shared resource.', 400)
    }

    const { access, formationBoard, resource } = await loadAuthorisedResource({
      authUserId: authData.user.id,
      calendarEventId,
      calendarOccurrenceDate,
      calendarSourceType,
      parentClient,
      parentLinkId,
      resourceId,
      supabaseAdmin,
    })

    if (formationBoard) {
      return json(200, { success: true, accessType: 'formation_board', formationBoard })
    }

    if (access.accessType === 'external_link') {
      return json(200, { success: true, ...access })
    }

    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
      .from(RESOURCE_LIBRARY_BUCKET)
      .createSignedUrl(resource.storage_path, SIGNED_URL_EXPIRY_SECONDS)

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw signedUrlError || new Error('Resource access could not be prepared.')
    }

    return json(200, {
      success: true,
      ...access,
      accessUrl: signedUrlData.signedUrl,
    })
  } catch (error) {
    const status = Number(error?.status || 500)

    if (status >= 500) {
      console.error('Parent resource access failed', error)
    }

    return json(status, {
      success: false,
      message: status >= 500
        ? 'Resource access could not be prepared.'
        : error.message || 'This resource is not available for the selected player.',
    })
  }
}

export const config = {
  path: '/api/parent-resources/access',
}
