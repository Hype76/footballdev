export function buildMatchDayNativeMessage({ device, notificationCopy, nativePayload }) {
  return {
    to: device.expo_push_token,
    // Keep the latest visible match card, but do not discard earlier messages in transit.
    tag: notificationCopy.tag,
    threadId: notificationCopy.tag,
    priority: 'high',
    ttl: 4 * 60 * 60,
    title: nativePayload.title,
    body: device.detail_level === 'detailed' ? nativePayload.detailedBody : nativePayload.minimalBody,
    data: { ...nativePayload.data, parentLinkId: device.parent_link_id },
    sound: 'default',
  }
}

export function buildAndroidMatchStartMessage(device, matchDayId) {
  if (device.platform !== 'android') return null
  return {
    to: device.expo_push_token,
    priority: 'high',
    ttl: 120,
    badge: 0,
    data: { app: 'parent', route: 'matchday', type: 'match_started', delivery: 'live_match_start',
      matchDayId, parentLinkId: device.parent_link_id },
  }
}
