import { getParentNotificationCategory } from '../../../apps/mobile-core/src/parentNotificationInboxCore.js'

export async function updateParentNotificationInbox({ admin, authUser, link, action = 'read', notificationIds = [], now = new Date().toISOString() }) {
  if (!['read', 'clear_general'].includes(action)) throw Object.assign(new Error('Unknown notification action.'), { statusCode: 400 })
  const ids = [...new Set(notificationIds.map(String).filter((id) => /^\d+$/.test(id)))]
  if (action === 'read' && !ids.length) return { success: true, notificationIds: [], readAt: now }
  const rows = []
  // Clear the whole general inbox, including messages beyond the first screen.
  for (let offset = 0; ; offset += 500) {
    let query = admin.from('parent_mobile_notification_events').select('id,intent_type,data')
      .eq('auth_user_id', authUser.id).eq('parent_link_id', link.id).eq('status', 'sent')
      .is('dismissed_at', null).gte('created_at', link.created_at)
      .or(`sent_at.lte.${now},and(sent_at.is.null,created_at.lte.${now})`)
      .order('id', { ascending: true })
    if (action === 'read') query = query.in('id', ids)
    const { data, error } = await query.range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data || []).filter((row) => action === 'read' || getParentNotificationCategory(row) === 'general'))
    if ((data || []).length < 500) break
  }
  const changedIds = []
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100).map((row) => String(row.id))
    const { data, error } = await admin.from('parent_mobile_notification_events')
      .update({ read_at: now, ...(action === 'clear_general' ? { dismissed_at: now } : {}) })
      .eq('auth_user_id', authUser.id).eq('parent_link_id', link.id).in('id', batch)
      .or(`sent_at.lte.${now},and(sent_at.is.null,created_at.lte.${now})`).select('id')
    if (error) throw error
    changedIds.push(...(data || []).map((row) => String(row.id)))
  }
  return { success: true, notificationIds: changedIds, readAt: now, ...(action === 'clear_general' ? { clearedAt: now } : {}) }
}
