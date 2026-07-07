import { canManageResourceLibrary, canUseResourceLibrary } from '../auth-permissions.js'
import { supabase } from '../supabase-client.js'
import { createAuditLog } from './audit.js'
import { clearViewCaches, getCachedResource, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'
import { getEntryIdentity, getEntryUserId } from './core-normalizers.js'
import { getPlayers } from './players.js'
import { getAvailableTeamsForUser } from './team-actions.js'

export const RESOURCE_LIBRARY_BUCKET = 'resource-library'
export const RESOURCE_LIBRARY_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
export const RESOURCE_LIBRARY_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
])

export const RESOURCE_LIBRARY_CATEGORIES = [
  { label: 'General', value: 'general' },
  { label: 'Training', value: 'training' },
  { label: 'Match day', value: 'match_day' },
  { label: 'Development', value: 'development' },
  { label: 'Admin', value: 'admin' },
]

const EXTENSION_MIME_TYPES = new Map([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['csv', 'text/csv'],
  ['txt', 'text/plain'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
])

const BLOCKED_EXTENSIONS = new Set([
  'bat',
  'cmd',
  'com',
  'dll',
  'docm',
  'exe',
  'html',
  'htm',
  'js',
  'mjs',
  'pptm',
  'ps1',
  'rar',
  'sh',
  'svg',
  'vbs',
  'xlsm',
  'zip',
  '7z',
])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeCategory(value) {
  const normalizedValue = normalizeText(value)
  return RESOURCE_LIBRARY_CATEGORIES.some((category) => category.value === normalizedValue) ? normalizedValue : 'general'
}

function getFileExtension(fileName = '') {
  const parts = normalizeText(fileName).toLowerCase().split('.')
  return parts.length > 1 ? parts.pop() : ''
}

function getSafeFilename(fileName = '') {
  const normalizedName = normalizeText(fileName) || 'resource'
  const safeName = normalizedName
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)

  return safeName || 'resource'
}

export function formatResourceLibraryFileSize(bytes) {
  const size = Number(bytes || 0)

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function validateResourceLibraryFile(file) {
  if (!file) {
    throw new Error('Choose a resource file before uploading.')
  }

  const extension = getFileExtension(file.name)

  if (!extension || BLOCKED_EXTENSIONS.has(extension) || !EXTENSION_MIME_TYPES.has(extension)) {
    throw new Error('Upload a PDF, DOCX, XLSX, PPTX, CSV, TXT, PNG, JPG, JPEG, or WebP file.')
  }

  const browserMimeType = normalizeText(file.type).toLowerCase()
  const expectedMimeType = EXTENSION_MIME_TYPES.get(extension)
  const mimeType = browserMimeType || expectedMimeType

  if (!RESOURCE_LIBRARY_ALLOWED_MIME_TYPES.has(mimeType) || mimeType !== expectedMimeType) {
    throw new Error('That file type is not allowed for the Resource Library.')
  }

  if (Number(file.size ?? 0) <= 0 || Number(file.size ?? 0) > RESOURCE_LIBRARY_MAX_FILE_SIZE_BYTES) {
    throw new Error('Resource files must be 20 MB or smaller.')
  }

  return {
    extension,
    mimeType,
    safeFilename: getSafeFilename(file.name),
  }
}

function assertResourceLibraryAccess(user) {
  if (!canUseResourceLibrary(user)) {
    throw new Error('Resource Library is only available to authorised club and team staff.')
  }
}

function assertResourceLibraryManageAccess(user) {
  if (!canManageResourceLibrary(user)) {
    throw new Error('Only Club Admins, Team Admins, and Managers can manage Resource Library items.')
  }
}

function getActiveResourceTeamId(user) {
  const activeTeamId = normalizeText(user?.activeTeamId)

  if (!activeTeamId) {
    throw new Error('Choose a team before opening the Team Resource Library.')
  }

  return activeTeamId
}

function getResourceLibraryTeamId(user, teamId = '', message = 'Choose a team before selecting resources.') {
  const normalizedTeamId = normalizeText(teamId) || normalizeText(user?.activeTeamId)

  if (!normalizedTeamId) {
    throw new Error(message)
  }

  return normalizedTeamId
}

function normalizeResourceIds(resourceIds = []) {
  return [...new Set(
    (Array.isArray(resourceIds) ? resourceIds : [])
      .map(normalizeText)
      .filter(Boolean),
  )]
}

function normalizeTeam(row) {
  const team = Array.isArray(row) ? row[0] : row

  return team ? {
    id: team.id ?? '',
    name: normalizeText(team.name),
  } : null
}

function normalizeExternalLink(row) {
  return Array.isArray(row) ? row[0] : row
}

export function normalizeResourceLibraryLink(row) {
  return {
    id: row.id ?? '',
    resourceId: row.resource_id ?? row.resourceId ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    linkedType: normalizeText(row.linked_type ?? row.linkedType),
    linkedId: row.linked_id ?? row.linkedId ?? '',
    assignedBy: row.assigned_by_profile_id ?? row.assignedByProfileId ?? '',
    assignedByName: normalizeText(row.assigned_by_name ?? row.assignedByName),
    assignedByEmail: normalizeText(row.assigned_by_email ?? row.assignedByEmail),
    assignedAt: row.assigned_at ?? row.assignedAt ?? '',
    parentVisible: Boolean(row.parent_visible ?? row.parentVisible ?? false),
    removedAt: row.removed_at ?? row.removedAt ?? '',
  }
}

export function normalizeResourceLibraryItem(row) {
  const team = normalizeTeam(row.teams ?? row.team)
  const links = (row.resource_library_links ?? row.links ?? []).map(normalizeResourceLibraryLink)
  const externalLink = normalizeExternalLink(row.resource_library_external_links ?? row.externalLink)
  const externalUrl = normalizeText(row.external_url ?? row.externalUrl ?? externalLink?.external_url)
  const resourceType = normalizeText(row.resource_type ?? row.resourceType) || (externalUrl ? 'external_link' : 'file')

  return {
    id: row.id ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    teamName: team?.name || '',
    title: normalizeText(row.title),
    description: normalizeText(row.description),
    category: normalizeCategory(row.category),
    resourceType,
    externalUrl,
    storageBucket: normalizeText(row.storage_bucket ?? row.storageBucket) || RESOURCE_LIBRARY_BUCKET,
    storagePath: normalizeText(row.storage_path ?? row.storagePath),
    originalFilename: normalizeText(row.original_filename ?? row.originalFilename),
    mimeType: normalizeText(row.mime_type ?? row.mimeType),
    fileSizeBytes: Number(row.file_size_bytes ?? row.fileSizeBytes ?? 0),
    uploadedBy: row.uploaded_by_profile_id ?? row.uploadedByProfileId ?? '',
    uploadedByName: normalizeText(row.uploaded_by_name ?? row.uploadedByName),
    uploadedByEmail: normalizeText(row.uploaded_by_email ?? row.uploadedByEmail),
    archivedAt: row.archived_at ?? row.archivedAt ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    links: links.filter((link) => !link.removedAt),
  }
}

function normalizeExternalResourceUrl(value) {
  const normalizedValue = normalizeText(value)

  try {
    const parsedUrl = new URL(normalizedValue)
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : ''
  } catch {
    return ''
  }
}

function getResourceLibraryCacheKey(user, suffix = 'items') {
  return `resource-library:${user.clubId}:${user.id}:${user.activeTeamId || 'no-team'}:${suffix}`
}

export async function getResourceLibraryTeams({ user } = {}) {
  if (!canUseResourceLibrary(user)) {
    return []
  }

  return getAvailableTeamsForUser(user)
}

export async function getResourceLibraryPlayers({ user } = {}) {
  if (!canUseResourceLibrary(user)) {
    return []
  }

  return getPlayers({ user })
}

export async function getResourceLibraryItems({ category = '', searchTerm = '', teamId = '', user } = {}) {
  if (!canUseResourceLibrary(user)) {
    return []
  }

  const normalizedCategory = normalizeText(category)
  const normalizedSearchTerm = normalizeText(searchTerm).toLowerCase()
  const normalizedTeamId = normalizeText(teamId) || getActiveResourceTeamId(user)

  return getCachedResource(getResourceLibraryCacheKey(user, `${normalizedCategory || 'all'}:${normalizedTeamId || 'all'}:${normalizedSearchTerm || 'searchless'}`), async () => {
    let query = supabase
      .from('resource_library_items')
      .select('*, teams:team_id(id, name), resource_library_links(*), resource_library_external_links(external_url)')
      .eq('club_id', user.clubId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })

    if (normalizedCategory) {
      query = query.eq('category', normalizeCategory(normalizedCategory))
    }

    query = query.eq('team_id', normalizedTeamId)

    const { data, error } = await query

    if (error) {
      console.error(error)
      throw error
    }

    const items = (data ?? []).map(normalizeResourceLibraryItem)

    if (!normalizedSearchTerm) {
      return items
    }

    return items.filter((item) => [
      item.title,
      item.description,
      item.originalFilename,
      item.externalUrl,
      item.teamName,
    ].some((value) => value.toLowerCase().includes(normalizedSearchTerm)))
  })
}

export async function uploadResourceLibraryItem({ category = 'general', description = '', file, teamId = '', title = '', user } = {}) {
  await blockDemoMutation(user)
  assertResourceLibraryManageAccess(user)

  const normalizedTitle = normalizeText(title)

  if (!normalizedTitle) {
    throw new Error('Add a title before uploading this resource.')
  }

  const validatedFile = validateResourceLibraryFile(file)
  const resourceId = crypto.randomUUID()
  const normalizedTeamId = normalizeText(teamId) || getActiveResourceTeamId(user)
  const storagePath = `${user.clubId}/${normalizedTeamId}/${resourceId}/${validatedFile.safeFilename}`

  const { error: uploadError } = await supabase.storage
    .from(RESOURCE_LIBRARY_BUCKET)
    .upload(storagePath, file, {
      contentType: validatedFile.mimeType,
      upsert: false,
    })

  if (uploadError) {
    console.error(uploadError)
    throw uploadError
  }

  const { data, error } = await supabase
    .from('resource_library_items')
    .insert({
      id: resourceId,
      club_id: user.clubId,
      team_id: normalizedTeamId,
      title: normalizedTitle,
      description: normalizeText(description),
      category: normalizeCategory(category),
      storage_bucket: RESOURCE_LIBRARY_BUCKET,
      storage_path: storagePath,
      original_filename: normalizeText(file.name) || validatedFile.safeFilename,
      mime_type: validatedFile.mimeType,
      file_size_bytes: Number(file.size),
      uploaded_by_profile_id: getEntryUserId(user),
      ...getEntryIdentity(user, 'uploaded_by'),
    })
    .select('*, teams:team_id(id, name), resource_library_links(*), resource_library_external_links(external_url)')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`resource-library:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'resource_library_item_uploaded',
    entityType: 'resource_library_item',
    entityId: resourceId,
    metadata: {
      title: normalizedTitle,
      teamId: normalizedTeamId,
      category: normalizeCategory(category),
    },
  })

  return normalizeResourceLibraryItem(data)
}

export async function createExternalResourceLibraryItem({ category = 'general', description = '', externalUrl = '', teamId = '', title = '', user } = {}) {
  await blockDemoMutation(user)
  assertResourceLibraryManageAccess(user)

  const normalizedTitle = normalizeText(title)
  const safeExternalUrl = normalizeExternalResourceUrl(externalUrl)

  if (!normalizedTitle) {
    throw new Error('Add a title before saving this resource link.')
  }

  if (!safeExternalUrl) {
    throw new Error('Add a valid http or https link before saving this resource.')
  }

  const normalizedTeamId = normalizeText(teamId) || getActiveResourceTeamId(user)

  const { data, error } = await supabase.rpc('create_external_resource_library_item', {
    target_club_id: user.clubId,
    target_team_id: normalizedTeamId,
    title_value: normalizedTitle,
    description_value: normalizeText(description),
    category_value: normalizeCategory(category),
    external_url_value: safeExternalUrl,
  })

  if (error) {
    console.error(error)
    throw error
  }

  const resource = Array.isArray(data) ? data[0] : data

  invalidateMemoryCacheByPrefix(`resource-library:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'resource_library_external_link_created',
    entityType: 'resource_library_item',
    entityId: resource?.id || '',
    metadata: {
      title: normalizedTitle,
      teamId: normalizedTeamId,
      category: normalizeCategory(category),
    },
  })

  return normalizeResourceLibraryItem(resource ?? {})
}

export async function assignResourceLibraryItem({ resourceId, targets = [], user } = {}) {
  await blockDemoMutation(user)
  assertResourceLibraryManageAccess(user)

  const normalizedResourceId = normalizeText(resourceId)
  const activeTeamId = getActiveResourceTeamId(user)
  const normalizedTargets = targets
    .map((target) => ({
      linkedType: normalizeText(target.linkedType),
      linkedId: normalizeText(target.linkedId),
      parentVisible: Boolean(target.parentVisible),
      teamId: normalizeText(target.teamId) || activeTeamId,
    }))
    .filter((target) => target.linkedId && ['player', 'team'].includes(target.linkedType))

  if (!normalizedResourceId) {
    throw new Error('Choose a resource before assigning it.')
  }

  if (normalizedTargets.length === 0) {
    throw new Error('Choose at least one player or team for this resource.')
  }

  const hasCrossTeamTarget = normalizedTargets.some((target) => String(target.teamId) !== activeTeamId)

  if (hasCrossTeamTarget) {
    throw new Error('Team resources can only be assigned inside the active team.')
  }

  const rows = normalizedTargets.map((target) => ({
    resource_id: normalizedResourceId,
    club_id: user.clubId,
    team_id: activeTeamId,
    linked_type: target.linkedType,
    linked_id: target.linkedId,
    parent_visible: target.linkedType === 'player' && target.parentVisible === true,
    assigned_by_profile_id: getEntryUserId(user),
    ...getEntryIdentity(user, 'assigned_by'),
  }))

  const { data, error } = await supabase
    .from('resource_library_links')
    .insert(rows)
    .select('*')

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`resource-library:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'resource_library_item_assigned',
    entityType: 'resource_library_item',
    entityId: normalizedResourceId,
    metadata: {
      targetCount: normalizedTargets.length,
    },
  })

  return (data ?? []).map(normalizeResourceLibraryLink)
}

export async function removeResourceLibraryLink({ linkId, user } = {}) {
  await blockDemoMutation(user)
  assertResourceLibraryManageAccess(user)
  const activeTeamId = getActiveResourceTeamId(user)

  const normalizedLinkId = normalizeText(linkId)

  if (!normalizedLinkId) {
    throw new Error('Choose an assigned resource before removing it.')
  }

  const { error } = await supabase.rpc('remove_resource_library_link', {
    target_link_id: normalizedLinkId,
    target_club_id: user.clubId,
    target_team_id: activeTeamId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`resource-library:${user.clubId}:`)
  clearViewCaches()
}

export async function archiveResourceLibraryItem({ resourceId, user } = {}) {
  await blockDemoMutation(user)
  assertResourceLibraryManageAccess(user)
  const activeTeamId = getActiveResourceTeamId(user)

  const normalizedResourceId = normalizeText(resourceId)

  if (!normalizedResourceId) {
    throw new Error('Choose a resource before archiving it.')
  }

  const { data, error } = await supabase.rpc('archive_resource_library_item', {
    target_resource_id: normalizedResourceId,
    target_club_id: user.clubId,
    target_team_id: activeTeamId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`resource-library:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'resource_library_item_archived',
    entityType: 'resource_library_item',
    entityId: normalizedResourceId,
    metadata: {
      title: data?.[0]?.resource_title || data?.[0]?.title || data?.title || '',
    },
  })

  return normalizeResourceLibraryItem({
    id: normalizedResourceId,
    title: data?.[0]?.resource_title || data?.[0]?.title || data?.title || '',
    club_id: user.clubId,
    team_id: activeTeamId,
    archived_at: new Date().toISOString(),
  })
}

export async function getAssignedResourcesForPlayer({ playerId, user } = {}) {
  if (!canUseResourceLibrary(user)) {
    return []
  }

  const normalizedPlayerId = normalizeText(playerId)
  const activeTeamId = getActiveResourceTeamId(user)

  if (!normalizedPlayerId) {
    return []
  }

  return getCachedResource(getResourceLibraryCacheKey(user, `player:${normalizedPlayerId}`), async () => {
    const { data, error } = await supabase
      .from('resource_library_links')
      .select('*, resource_library_items(*, resource_library_external_links(external_url))')
      .eq('club_id', user.clubId)
      .eq('team_id', activeTeamId)
      .eq('linked_type', 'player')
      .eq('linked_id', normalizedPlayerId)
      .is('removed_at', null)
      .order('assigned_at', { ascending: false })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? [])
      .map((link) => {
        const item = Array.isArray(link.resource_library_items) ? link.resource_library_items[0] : link.resource_library_items
        return item ? {
          ...normalizeResourceLibraryItem(item),
          link: normalizeResourceLibraryLink(link),
        } : null
      })
      .filter(Boolean)
      .filter((item) => !item.archivedAt)
  })
}

export async function getParentPortalPlayerResources({ parentLinkId } = {}) {
  const normalizedParentLinkId = normalizeText(parentLinkId)

  if (!normalizedParentLinkId) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_player_resources', {
    parent_link_id_value: normalizedParentLinkId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? [])
    .map((row) => normalizeResourceLibraryItem({
      ...row,
      links: [{
        id: row.link_id,
        resourceId: row.id,
        clubId: row.club_id,
        teamId: row.team_id,
        linkedType: 'player',
        linkedId: row.player_id,
        parentVisible: true,
        assignedAt: row.assigned_at,
      }],
    }))
    .filter((item) => !item.archivedAt)
}

export async function getCalendarEventResources({ eventId, teamId = '', user } = {}) {
  if (!canUseResourceLibrary(user)) {
    return []
  }

  const normalizedEventId = normalizeText(eventId)
  const eventTeamId = getResourceLibraryTeamId(user, teamId, 'Choose the event team before viewing attached resources.')

  if (!normalizedEventId) {
    return []
  }

  return getCachedResource(getResourceLibraryCacheKey(user, `calendar-event:${normalizedEventId}:${eventTeamId}`), async () => {
    const { data, error } = await supabase
      .from('resource_library_links')
      .select('*, resource_library_items(*, resource_library_external_links(external_url))')
      .eq('club_id', user.clubId)
      .eq('team_id', eventTeamId)
      .eq('linked_type', 'calendar_event')
      .eq('linked_id', normalizedEventId)
      .is('removed_at', null)
      .order('assigned_at', { ascending: false })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? [])
      .map((link) => {
        const item = Array.isArray(link.resource_library_items) ? link.resource_library_items[0] : link.resource_library_items
        return item ? {
          ...normalizeResourceLibraryItem(item),
          link: normalizeResourceLibraryLink(link),
        } : null
      })
      .filter(Boolean)
      .filter((item) => !item.archivedAt)
  })
}

export async function syncCalendarEventResourceLinks({ eventId, resourceIds = [], teamId = '', user } = {}) {
  await blockDemoMutation(user)
  assertResourceLibraryManageAccess(user)

  const normalizedEventId = normalizeText(eventId)
  const eventTeamId = getResourceLibraryTeamId(user, teamId, 'Choose the event team before attaching resources.')
  const desiredResourceIds = normalizeResourceIds(resourceIds)

  if (!normalizedEventId) {
    throw new Error('Save the calendar event before attaching resources.')
  }

  if (desiredResourceIds.length > 0) {
    const { data: resources, error: resourceError } = await supabase
      .from('resource_library_items')
      .select('id')
      .eq('club_id', user.clubId)
      .eq('team_id', eventTeamId)
      .is('archived_at', null)
      .in('id', desiredResourceIds)

    if (resourceError) {
      console.error(resourceError)
      throw resourceError
    }

    const foundResourceIds = new Set((resources ?? []).map((resource) => normalizeText(resource.id)))
    const hasOutOfScopeResource = desiredResourceIds.some((resourceId) => !foundResourceIds.has(resourceId))

    if (hasOutOfScopeResource) {
      throw new Error('Attach resources from this event team only.')
    }
  }

  const { data: existingLinks, error: linksError } = await supabase
    .from('resource_library_links')
    .select('*')
    .eq('club_id', user.clubId)
    .eq('linked_type', 'calendar_event')
    .eq('linked_id', normalizedEventId)
    .is('removed_at', null)

  if (linksError) {
    console.error(linksError)
    throw linksError
  }

  const desiredResourceIdSet = new Set(desiredResourceIds)
  const existingActiveResourceIds = new Set(
    (existingLinks ?? [])
      .filter((link) => normalizeText(link.team_id) === eventTeamId)
      .map((link) => normalizeText(link.resource_id)),
  )
  const linkIdsToRemove = (existingLinks ?? [])
    .filter((link) => !desiredResourceIdSet.has(normalizeText(link.resource_id)) || normalizeText(link.team_id) !== eventTeamId)
    .map((link) => normalizeText(link.id))
    .filter(Boolean)
  const resourceIdsToAdd = desiredResourceIds.filter((resourceId) => !existingActiveResourceIds.has(resourceId))

  if (linkIdsToRemove.length > 0) {
    const removeResults = await Promise.all(
      linkIdsToRemove.map((linkId) =>
        supabase.rpc('remove_resource_library_link', {
          target_link_id: linkId,
          target_club_id: user.clubId,
          target_team_id: eventTeamId,
        })),
    )
    const removeError = removeResults.find((result) => result.error)?.error

    if (removeError) {
      console.error(removeError)
      throw removeError
    }
  }

  if (resourceIdsToAdd.length > 0) {
    const rows = resourceIdsToAdd.map((resourceId) => ({
      resource_id: resourceId,
      club_id: user.clubId,
      team_id: eventTeamId,
      linked_type: 'calendar_event',
      linked_id: normalizedEventId,
      assigned_by_profile_id: getEntryUserId(user),
      ...getEntryIdentity(user, 'assigned_by'),
    }))

    const { error: insertError } = await supabase
      .from('resource_library_links')
      .insert(rows)

    if (insertError) {
      console.error(insertError)
      throw insertError
    }
  }

  invalidateMemoryCacheByPrefix(`resource-library:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'resource_library_event_resources_synced',
    entityType: 'calendar_event',
    entityId: normalizedEventId,
    metadata: {
      resourceCount: desiredResourceIds.length,
      teamId: eventTeamId,
    },
  })

  return getCalendarEventResources({ eventId: normalizedEventId, teamId: eventTeamId, user })
}

export async function getResourceLibraryDownloadUrl({ resourceId, user } = {}) {
  assertResourceLibraryAccess(user)
  const activeTeamId = getActiveResourceTeamId(user)

  const normalizedResourceId = normalizeText(resourceId)

  if (!normalizedResourceId) {
    throw new Error('Choose a resource before downloading it.')
  }

  const { data, error } = await supabase
    .from('resource_library_items')
    .select('id, storage_path, storage_bucket, resource_library_external_links(external_url)')
    .eq('id', normalizedResourceId)
    .eq('club_id', user.clubId)
    .eq('team_id', activeTeamId)
    .is('archived_at', null)
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  const externalLink = normalizeExternalLink(data.resource_library_external_links)
  const externalUrl = normalizeExternalResourceUrl(externalLink?.external_url)

  if (externalUrl) {
    return externalUrl
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(data.storage_bucket || RESOURCE_LIBRARY_BUCKET)
    .createSignedUrl(data.storage_path, 60)

  if (signedUrlError) {
    console.error(signedUrlError)
    throw signedUrlError
  }

  return signedUrlData?.signedUrl || ''
}
