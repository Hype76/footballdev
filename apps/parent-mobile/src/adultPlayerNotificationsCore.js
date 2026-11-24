// Player taps are fenced to the current account and verified active team link.
export function adultPlayerNotificationScope(userId, link) {
  return JSON.stringify([userId || '', link?.id || '', link?.clubId || '', link?.teamId || ''])
}

export function resolveAdultPlayerNotificationOpen(data, link, items = {}, userId) {
  if ((userId && data?.userId !== userId) || !link?.id || data?.app !== 'player' || data.adultLinkId !== link.id
    || data.clubId !== link.clubId || data.teamId !== link.teamId
    || !['chat', 'invites', 'matchday'].includes(data.route)) return null
  const targetId = data.route === 'chat' ? data.roomId : data.route === 'matchday' ? data.matchDayId : data.invitationId
  const available = data.route === 'chat' ? items.chatRooms : data.route === 'matchday' ? items.matches : items.invitations
  const allowed = (available || []).some(item => (data.route === 'invites' ? item.invitationId : item.id) === targetId)
  return { tab: data.route, targetId: allowed ? targetId : '' }
}

// The portal intentionally supports one currently active Player link per user.
export function resolveAdultPlayerNotificationMode(data, userId, access) {
  if (data?.app !== 'player' || data.userId !== userId || !['chat', 'invites', 'matchday'].includes(data.route)) return 'reject'
  if (!access || ['checking', 'error'].includes(access.status)) return 'retry'
  return access.status === 'linked' && resolveAdultPlayerNotificationOpen(data, access.link, {}, userId) ? 'player' : 'reject'
}

export async function prepareAdultPlayerNotificationMode({ data, userId, refresh, isCurrent, selectPlayer, reject }) {
  if (data?.userId !== userId) { if (isCurrent()) reject(); return 'reject' }
  const access = await refresh()
  if (!isCurrent()) return 'stale'
  const outcome = resolveAdultPlayerNotificationMode(data, userId, access)
  if (outcome === 'player') selectPlayer()
  if (outcome === 'reject') reject()
  return outcome
}

export async function openAdultPlayerNotification({ data, link, userId, load, isCurrent, navigate, consume }) {
  if (!resolveAdultPlayerNotificationOpen(data, link, {}, userId)) { if (isCurrent()) consume(); return 'reject' }
  let result
  try { result = await load() } catch { return 'retry' }
  if (!isCurrent()) return 'stale'
  if (!result || result.stale || result.failed) return 'retry'
  const destination = resolveAdultPlayerNotificationOpen(data, link, result.items, userId)
  if (!destination) { consume(); return 'reject' }
  navigate(destination)
  consume()
  return 'opened'
}
