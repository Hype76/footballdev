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
