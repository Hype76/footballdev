function normalizeText(value) {
  return String(value ?? '').trim()
}

function isMissingTableError(error) {
  const code = normalizeText(error?.code)
  const message = normalizeText(error?.message).toLowerCase()

  return code === '42P01' || code === 'PGRST205' || message.includes('relation') && message.includes('does not exist')
}

function sourceId(data = {}) {
  const direct = [
    data.availabilityRequestId,
    data.trainingRequestPlayerId,
    data.notificationId,
    data.communicationLogId,
    data.messageId,
    data.pollId,
    data.resourceId,
    data.invitationId,
    data.eventId,
    data.calendarChangeId,
  ].map(normalizeText).find(Boolean)

  if (direct) return direct

  const matchDayId = normalizeText(data.matchDayId)
  const type = normalizeText(data.type)
  return matchDayId ? `${matchDayId}:${type || 'update'}` : ''
}

export function getParentNotificationDedupeKey({ data = {}, intentType, parentLinkId } = {}) {
  const linkId = normalizeText(parentLinkId || data.parentLinkId)
  const kind = normalizeText(intentType || data.type).toLowerCase()
  const source = kind === 'matchday_update' && normalizeText(data.matchDayId) ? normalizeText(data.matchDayId) : sourceId(data)
  return linkId && source && kind ? `${kind}:${linkId}:${source}` : ''
}

export async function writeParentNotificationInbox({
  body,
  client,
  clubId,
  data = {},
  intentType,
  parentLinks = [],
  teamId,
  title,
} = {}) {
  const links = [...new Map((Array.isArray(parentLinks) ? parentLinks : [])
    .filter((link) => normalizeText(link?.id) && normalizeText(link?.auth_user_id))
    .map((link) => [normalizeText(link.id), link])).values()]

  if (!client || links.length === 0) return { available: 0, inserted: 0 }

  const now = new Date().toISOString()
  const rows = links.map((link) => {
    const notificationData = {
      ...data,
      parentLinkId: normalizeText(data.parentLinkId) || normalizeText(link.id),
    }
    return {
      auth_user_id: normalizeText(link.auth_user_id),
      body: normalizeText(body) || 'A new Football Player update is available.',
      club_id: normalizeText(clubId) || null,
      data: notificationData,
      dedupe_key: getParentNotificationDedupeKey({ data: notificationData, intentType, parentLinkId: link.id }),
      installation_id: null,
      intent_type: normalizeText(intentType),
      parent_link_id: normalizeText(link.id),
      sent_at: now,
      ...(intentType === 'matchday_update' && data.matchDayId ? { read_at: null, created_at: now } : {}),
      status: 'sent',
      team_id: normalizeText(teamId) || null,
      title: normalizeText(title) || 'Football Player update',
    }
  }).filter((row) => row.dedupe_key)

  if (rows.length === 0) return { available: 0, inserted: 0 }

  const { data: inserted, error } = await client
    .from('parent_mobile_notification_events')
    .upsert(rows, { ignoreDuplicates: !(intentType === 'matchday_update' && data.matchDayId), onConflict: 'dedupe_key' })
    .select('id')

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('Parent notification events table is not available; skipping notification event log.')
      return { available: 0, inserted: 0 }
    }

    throw error
  }
  return { available: rows.length, inserted: inserted?.length || 0 }
}
