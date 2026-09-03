// Called only when the child switcher opens. It never marks another child's alerts read.
export async function getParentChildNotificationBadges({ admin, authUserId, collapse, filterAvailable }) {
  const { data: links, error } = await admin.from('parent_player_links')
    .select('id, auth_user_id, club_id, team_id, player_id, status, created_at')
    .eq('auth_user_id', authUserId).eq('status', 'active')
  if (error) throw error
  const ownedLinks = (links || []).filter((link) => link.auth_user_id === authUserId && link.status === 'active')
  const unreadByParentLink = {}
  // Bound concurrent reads and fetch only the metadata needed for badge validity.
  for (let offset = 0; offset < ownedLinks.length; offset += 4) {
    await Promise.all(ownedLinks.slice(offset, offset + 4).map(async (link) => {
      const { data: rows, error: readError } = await admin.from('parent_mobile_notification_events')
        .select('id, intent_type, data, sent_at, read_at, created_at')
        .eq('auth_user_id', authUserId).eq('parent_link_id', link.id).eq('status', 'sent')
        .is('dismissed_at', null).gte('created_at', link.created_at)
        .order('sent_at', { ascending: false }).limit(500)
      if (readError) throw readError
      const notifications = await filterAvailable(collapse(rows || []), link)
      unreadByParentLink[link.id] = notifications.filter((item) => !item.isRead && item.isBadgeEligible !== false).length
    }))
  }
  return unreadByParentLink
}
