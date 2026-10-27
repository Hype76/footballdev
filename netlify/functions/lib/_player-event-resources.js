import { fanDenied } from './_fan-access.js'

export const canReadPlayerEventResources = (scope) => scope.fan.relationship_type === 'player'
  && scope.fan.permissions?.schedule === true && scope.fan.permissions?.resources === true
  && scope.fan.permissions?.development === true

const occurrence = (item) => {
  const match = String(item.id || '').match(/^([a-f0-9-]{36}):(\d{4}-\d{2}-\d{2})$/i)
  return match ? { eventId: match[1], date: match[2] } : null
}
const relation = (value) => Array.isArray(value) ? value[0] : value
const metadata = (item) => ({ id: item.id, title: item.title, description: item.description, category: item.category,
  createdAt: item.created_at, updatedAt: item.updated_at })
const inScope = (item, scope) => item && !item.archived_at && item.club_id === scope.fan.club_id && item.team_id === scope.player.team_id

export async function attachPlayerEventResources(client, scope, schedule, { featureAllowed = () => true } = {}) {
  if (!canReadPlayerEventResources(scope) || !featureAllowed('resourceLibrary') || !featureAllowed('teamCalendar')) return schedule
  const targets = schedule.map(occurrence).filter(Boolean)
  const ids = [...new Set(targets.map(item => item.eventId))]
  if (!ids.length) return schedule
  const eventResult = await client.from('calendar_events').select('id')
    .eq('club_id', scope.fan.club_id).eq('parent_visible', true).neq('parent_audience', 'none')
    .is('cancelled_at', null).in('id', ids)
  if (eventResult.error) throw eventResult.error
  const visibleEventIds = new Set((eventResult.data || []).map(event => event.id))
  const links = []
  for (let offset = 0; offset < 10000; offset += 500) {
    const result = await client.from('resource_library_links')
      .select('resource_id,club_id,team_id,linked_id,linked_type,calendar_occurrence_date,removed_at,resource_library_items!inner(id,title,description,category,created_at,updated_at,archived_at,club_id,team_id)')
      .eq('club_id', scope.fan.club_id).eq('team_id', scope.player.team_id)
      .eq('linked_type', 'calendar_event').in('linked_id', ids).is('removed_at', null)
      .order('id', { ascending: true }).range(offset, offset + 499)
    if (result.error) throw result.error
    links.push(...(result.data || []))
    if ((result.data || []).length < 500) break
    if (offset === 9500) throw new Error('Too many event attachments to load safely.')
  }
  return schedule.map(item => {
    const target = occurrence(item)
    if (!target || !visibleEventIds.has(target.eventId)) return item
    const resources = links.filter(link => link.club_id === scope.fan.club_id && link.team_id === scope.player.team_id
      && link.linked_type === 'calendar_event' && !link.removed_at && link.linked_id === target.eventId
      && link.calendar_occurrence_date === target.date && inScope(relation(link.resource_library_items), scope))
      .map(link => ({ ...metadata(relation(link.resource_library_items)), eventId: target.eventId,
        occurrenceDate: target.date, sourceType: 'calendar_event' }))
    return { ...item, resources }
  })
}

export async function listFanResources(client, scope, schedule = []) {
  const result = await client.from('resource_library_links')
    .select('resource_id, resource_library_items!inner(id, title, description, category, created_at, updated_at, archived_at, club_id, team_id)')
    .eq('club_id', scope.fan.club_id).eq('team_id', scope.player.team_id)
    .eq('linked_type', 'player').eq('linked_id', scope.player.id).eq('parent_visible', true).is('removed_at', null)
  if (result.error) throw result.error
  const resources = (result.data || []).map(row => relation(row.resource_library_items)).filter(item => inScope(item, scope)).map(metadata)
  if (canReadPlayerEventResources(scope)) resources.push(...schedule.flatMap(item => item.resources || []))
  const unique = new Map()
  for (const item of resources) if (!unique.has(item.id)) unique.set(item.id, item)
  return [...unique.values()]
}

export async function loadPlayerEventResource(client, scope, selected, schedule) {
  const { validateParentResourceAccess, loadResourceFormationBoard } = await import('../parent-resource-access.js')
  if (!canReadPlayerEventResources(scope) || !schedule.some(item => item.resources?.some(resource => resource.id === selected.id
    && resource.eventId === selected.eventId && resource.occurrenceDate === selected.occurrenceDate))) throw fanDenied()
  const { data: link, error } = await client.from('resource_library_links').select('*')
    .eq('resource_id', selected.id).eq('club_id', scope.fan.club_id).eq('team_id', scope.player.team_id)
    .eq('linked_type', 'calendar_event').eq('linked_id', selected.eventId)
    .eq('calendar_occurrence_date', selected.occurrenceDate).is('removed_at', null).maybeSingle()
  if (error) throw error
  if (!link) throw fanDenied()
  const resourceResult = await client.from('resource_library_items').select('*').eq('id', selected.id)
    .eq('club_id', scope.fan.club_id).eq('team_id', scope.player.team_id).is('archived_at', null).maybeSingle()
  if (resourceResult.error) throw resourceResult.error
  const externalResult = await client.from('resource_library_external_links').select('*').eq('resource_id', selected.id).maybeSingle()
  if (externalResult.error) throw externalResult.error
  // The current player's canonical schedule authorises this exact event occurrence.
  // Reuse the existing file/URL and current family checks after that event check.
  const access = validateParentResourceAccess({ authUserId: scope.parent.auth_user_id, parentLink: scope.parent,
    player: scope.player, resource: resourceResult.data, externalLink: externalResult.data,
    resourceLink: { ...link, linked_type: 'player', linked_id: scope.player.id, parent_visible: true } })
  const formationBoard = await loadResourceFormationBoard({ resource: resourceResult.data, supabaseAdmin: client })
  return { access, resource: resourceResult.data, formationBoard }
}
