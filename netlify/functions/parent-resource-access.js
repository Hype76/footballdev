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

async function loadAuthorisedResource({ authUserId, parentLinkId, resourceId, supabaseAdmin }) {
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
  const resourceLink = await maybeSingle(
    supabaseAdmin
      .from('resource_library_links')
      .select('id, resource_id, club_id, team_id, linked_type, linked_id, parent_visible, removed_at')
      .eq('resource_id', resourceId)
      .eq('club_id', parentLink.club_id)
      .eq('team_id', player.team_id)
      .eq('linked_type', 'player')
      .eq('linked_id', player.id)
      .eq('parent_visible', true)
      .is('removed_at', null),
    unavailableMessage,
  )
  const resource = await maybeSingle(
    supabaseAdmin
      .from('resource_library_items')
      .select('id, club_id, team_id, title, description, mime_type, storage_bucket, storage_path, archived_at')
      .eq('id', resourceId)
      .eq('club_id', parentLink.club_id)
      .eq('team_id', player.team_id)
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

  const access = validateParentResourceAccess({
    authUserId,
    externalLink,
    parentLink,
    player,
    resource,
    resourceLink,
  })

  const { data: publication, error: publicationError } = await supabaseAdmin
    .from('formation_board_publications')
    .select('board_id, board_version_id, board_title_snapshot, board_description_snapshot, publication_number')
    .eq('resource_id', resourceId)
    .eq('club_id', parentLink.club_id)
    .eq('team_id', player.team_id)
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
        .eq('team_id', player.team_id),
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
    const parentLinkId = normalizeText(body.parentLinkId)
    const resourceId = normalizeText(body.resourceId)

    if (!UUID_PATTERN.test(parentLinkId) || !UUID_PATTERN.test(resourceId)) {
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

    const { access, formationBoard, resource } = await loadAuthorisedResource({
      authUserId: authData.user.id,
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
