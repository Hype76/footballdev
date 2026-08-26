/* global Netlify */
import { createClient } from '@supabase/supabase-js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
  }

  if (!player
    || normalizeText(player.id) !== normalizeText(parentLink.player_id)
    || normalizeText(player.club_id) !== normalizeText(parentLink.club_id)
    || normalizeText(player.status || 'active') === 'archived'
    || player.archived_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
  }

  if (parentLink.team_id && normalizeText(parentLink.team_id) !== normalizeText(player.team_id)) {
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
  }

  if (!resourceLink
    || normalizeText(resourceLink.club_id) !== normalizeText(parentLink.club_id)
    || normalizeText(resourceLink.team_id) !== normalizeText(player.team_id)
    || normalizeText(resourceLink.linked_type) !== 'player'
    || normalizeText(resourceLink.linked_id) !== normalizeText(player.id)
    || resourceLink.parent_visible !== true
    || resourceLink.removed_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
  }

  if (!resource
    || normalizeText(resource.id) !== normalizeText(resourceLink.resource_id)
    || normalizeText(resource.club_id) !== normalizeText(resourceLink.club_id)
    || normalizeText(resource.team_id) !== normalizeText(resourceLink.team_id)
    || resource.archived_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
  }

  const externalUrl = normalizeExternalUrl(externalLink?.external_url)

  if (externalLink && (!externalUrl
    || normalizeText(externalLink.resource_id) !== normalizeText(resource.id)
    || normalizeText(externalLink.club_id) !== normalizeText(resource.club_id)
    || normalizeText(externalLink.team_id) !== normalizeText(resource.team_id))) {
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
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
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
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
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
  }

  if (!player
    || normalizeText(player.id) !== normalizeText(parentLink.player_id)
    || normalizeText(player.club_id) !== normalizeText(parentLink.club_id)
    || normalizeText(player.status || 'active') === 'archived'
    || player.archived_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
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
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
  }

  if (!resourceLink
    || normalizeText(resourceLink.club_id) !== normalizeText(calendarEvent.club_id)
    || normalizeText(resourceLink.team_id) !== eventTeamId
    || normalizeText(resourceLink.linked_type) !== 'calendar_event'
    || normalizeText(resourceLink.linked_id) !== normalizeText(calendarEvent.id)
    || resourceLink.removed_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
  }

  if (!resource
    || normalizeText(resource.id) !== normalizeText(resourceLink.resource_id)
    || normalizeText(resource.club_id) !== normalizeText(resourceLink.club_id)
    || normalizeText(resource.team_id) !== normalizeText(resourceLink.team_id)
    || resource.archived_at) {
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
  }

  const externalUrl = normalizeExternalUrl(externalLink?.external_url)

  if (externalLink && (!externalUrl
    || normalizeText(externalLink.resource_id) !== normalizeText(resource.id)
    || normalizeText(externalLink.club_id) !== normalizeText(resource.club_id)
    || normalizeText(externalLink.team_id) !== normalizeText(resource.team_id))) {
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
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
    throw new ParentResourceAccessError('This resource is not available for the selected child.')
  }

  return {
    accessType: 'file',
    accessUrl: '',
    expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
  }
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
  const unavailableMessage = 'This resource is not available for the selected child.'
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

async function listAuthorisedCalendarEventResources({ authUserId, parentLinkId, supabaseAdmin }) {
  const { parentLink, player } = await loadActiveParentContext({ authUserId, parentLinkId, supabaseAdmin })
  const cutoff = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString()
  const { data: calendarEvents, error: calendarError } = await supabaseAdmin
    .from('calendar_events')
    .select('id, club_id, team_id, parent_visible, parent_audience, cancelled_at, starts_at')
    .eq('club_id', parentLink.club_id)
    .eq('parent_visible', true)
    .is('cancelled_at', null)
    .in('parent_audience', ['involved_players', 'all_team_parents', 'all_club_parents'])
    .gte('starts_at', cutoff)
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
  const eventById = new Map(visibleEvents.map((event) => [normalizeText(event.id), event]))

  if (eventById.size === 0) return []

  const { data: resourceLinks, error: resourceLinksError } = await supabaseAdmin
    .from('resource_library_links')
    .select('id, resource_id, club_id, team_id, linked_type, linked_id, assigned_at, removed_at')
    .eq('club_id', parentLink.club_id)
    .eq('linked_type', 'calendar_event')
    .in('linked_id', [...eventById.keys()])
    .is('removed_at', null)
    .order('assigned_at', { ascending: false })
    .limit(500)

  if (resourceLinksError) throw resourceLinksError

  const inScopeLinks = (resourceLinks || []).filter((link) => {
    const event = eventById.get(normalizeText(link.linked_id))
    return event && normalizeText(link.team_id) === normalizeText(event.team_id)
  })
  const resourceIds = [...new Set(inScopeLinks.map((link) => normalizeText(link.resource_id)).filter(Boolean))]

  if (resourceIds.length === 0) return []

  const { data: resources, error: resourcesError } = await supabaseAdmin
    .from('resource_library_items')
    .select('id, club_id, team_id, title, category, original_filename, file_size_bytes, archived_at')
    .eq('club_id', parentLink.club_id)
    .in('id', resourceIds)
    .is('archived_at', null)
    .limit(500)

  if (resourcesError) throw resourcesError

  const { data: externalLinks, error: externalLinksError } = await supabaseAdmin
    .from('resource_library_external_links')
    .select('resource_id, club_id, team_id')
    .eq('club_id', parentLink.club_id)
    .in('resource_id', resourceIds)
    .limit(500)

  if (externalLinksError) throw externalLinksError

  const resourceById = new Map((resources || []).map((resource) => [normalizeText(resource.id), resource]))
  const externalResourceIds = new Set((externalLinks || []).filter((link) => {
    const resource = resourceById.get(normalizeText(link.resource_id))
    return resource
      && normalizeText(link.club_id) === normalizeText(resource.club_id)
      && normalizeText(link.team_id) === normalizeText(resource.team_id)
  }).map((link) => normalizeText(link.resource_id)))

  return inScopeLinks.map((link) => {
    const resource = resourceById.get(normalizeText(link.resource_id))
    const event = eventById.get(normalizeText(link.linked_id))

    if (!resource
      || normalizeText(resource.club_id) !== normalizeText(link.club_id)
      || normalizeText(resource.team_id) !== normalizeText(link.team_id)
      || !event) return null

    return {
      eventId: normalizeText(event.id),
      id: normalizeText(resource.id),
      title: normalizeText(resource.title) || normalizeText(resource.original_filename) || 'Event attachment',
      category: normalizeText(resource.category) || 'general',
      resourceType: externalResourceIds.has(normalizeText(resource.id)) ? 'external_link' : 'file',
      originalFilename: normalizeText(resource.original_filename),
      fileSizeBytes: Math.max(0, Number(resource.file_size_bytes || 0)),
    }
  }).filter(Boolean)
}

async function loadAuthorisedResource({ authUserId, calendarEventId = '', parentLinkId, resourceId, supabaseAdmin }) {
  const unavailableMessage = 'This resource is not available for the selected child.'
  const { parentLink, player } = await loadActiveParentContext({ authUserId, parentLinkId, supabaseAdmin })
  const calendarEvent = calendarEventId
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
    : null
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
    .select('id, resource_id, club_id, team_id, linked_type, linked_id, parent_visible, removed_at')
    .eq('resource_id', resourceId)
    .eq('club_id', parentLink.club_id)
    .eq('team_id', calendarEvent ? calendarEvent.team_id : player.team_id)
    .eq('linked_type', calendarEvent ? 'calendar_event' : 'player')
    .eq('linked_id', calendarEvent ? calendarEvent.id : player.id)
    .is('removed_at', null)

  if (!calendarEvent) resourceLinkQuery = resourceLinkQuery.eq('parent_visible', true)

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

  const access = calendarEvent
    ? validateParentCalendarEventResourceAccess({ authUserId, calendarEvent, calendarInvite, externalLink, parentLink, player, resource, resourceLink })
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

    if (action === 'list_calendar_event_resources') {
      const resources = await listAuthorisedCalendarEventResources({
        authUserId: authData.user.id,
        parentLinkId,
        supabaseAdmin,
      })
      return json(200, { success: true, resources })
    }

    if (!UUID_PATTERN.test(resourceId) || (calendarEventId && !UUID_PATTERN.test(calendarEventId))) {
      throw new ParentResourceAccessError('Choose a valid shared resource.', 400)
    }

    const { access, formationBoard, resource } = await loadAuthorisedResource({
      authUserId: authData.user.id,
      calendarEventId,
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
        : error.message || 'This resource is not available for the selected child.',
    })
  }
}

export const config = {
  path: '/api/parent-resources/access',
}
