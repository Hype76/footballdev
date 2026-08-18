function normalizeText(value) {
  return String(value ?? '').trim()
}

export function normalizeParentCommunicationChannel(value) {
  const channel = normalizeText(value).toLowerCase()
  return ['app', 'email', 'both'].includes(channel) ? channel : 'both'
}

export function allowsParentAppNotifications(value) {
  return ['app', 'both'].includes(normalizeParentCommunicationChannel(value))
}

export function allowsParentEmail(value) {
  return ['email', 'both'].includes(normalizeParentCommunicationChannel(value))
}

export async function getParentCommunicationChannels(client, authUserIds = []) {
  const ids = [...new Set((Array.isArray(authUserIds) ? authUserIds : []).map(normalizeText).filter(Boolean))]
  if (ids.length === 0) return new Map()

  const { data, error } = await client
    .from('parent_communication_preferences')
    .select('auth_user_id, communication_channel')
    .in('auth_user_id', ids)

  if (error) {
    const code = normalizeText(error.code)
    if (['42P01', 'PGRST205'].includes(code)) return new Map()
    throw error
  }

  return new Map((data || []).map((row) => [
    normalizeText(row.auth_user_id),
    normalizeParentCommunicationChannel(row.communication_channel),
  ]))
}

export async function filterParentLinksForAppNotifications(client, parentLinks = []) {
  const links = Array.isArray(parentLinks) ? parentLinks.filter((link) => normalizeText(link?.id)) : []
  const channels = await getParentCommunicationChannels(client, links.map((link) => link.auth_user_id))
  return links.filter((link) => allowsParentAppNotifications(
    channels.get(normalizeText(link.auth_user_id)) || 'both',
  ))
}

function getQueueParentLinkId(row) {
  const payload = row?.payload || {}
  return normalizeText(
    payload?.matchDayAvailability?.parentLinkId
    || payload?.trainingInvitation?.parentLinkId
    || payload?.resourceNotification?.parentLinkId
    || payload?.communicationLog?.metadata?.parentLinkId
    || payload?.parentLinkId
    || payload?.parent_link_id,
  )
}

export async function resolveScheduledParentCommunicationChannel(client, row) {
  const parentLinkId = getQueueParentLinkId(row)
  let query = client
    .from('parent_player_links')
    .select('auth_user_id')
    .eq('club_id', row.club_id)
    .eq('status', 'active')
    .not('auth_user_id', 'is', null)

  if (parentLinkId) {
    query = query.eq('id', parentLinkId)
  } else {
    query = query.eq('email', normalizeText(row.to_email).toLowerCase())
  }

  const { data, error } = await query.limit(5)
  if (error || !data?.length) return 'both'

  const channels = await getParentCommunicationChannels(client, data.map((link) => link.auth_user_id))
  const resolved = data.map((link) => channels.get(normalizeText(link.auth_user_id)) || 'both')

  if (resolved.some((channel) => channel === 'both')) return 'both'
  if (resolved.some((channel) => channel === 'email')) return 'email'
  return resolved.length > 0 ? 'app' : 'both'
}
