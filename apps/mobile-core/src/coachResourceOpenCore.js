// Saved files use the scoped store first. Only an absent file may fall back
// online; integrity and authority failures are never bypassed.
export async function openCoachResource({ user, context, resource, openSaved, getAccessUrl, linking, isCurrent = () => true }) {
  if (resource?.type !== 'external_link') {
    let opened
    try { opened = await openSaved(user, context, resource) } catch (error) {
      if (/offline_media_(corrupt|key_missing)/i.test(String(error?.code || error?.message || ''))) throw new Error('The saved file could not be verified. Connect and refresh Resources.')
      if (/offline_media_expired/i.test(String(error?.code || error?.message || ''))) throw new Error('This saved file has expired. Connect and refresh Resources.')
      if (/offline_media_(native_unavailable|viewer_unavailable)/i.test(String(error?.code || error?.message || ''))) throw new Error('This phone cannot open the saved file.')
      throw error
    }
    if (!isCurrent()) return false
    if (opened) return true
  }
  if (user?.isOfflineProfile) throw new Error(resource?.type === 'external_link'
    ? 'This link needs an internet connection.'
    : 'This file was not saved on this phone. Connect and refresh Resources to save it.')
  let accessUrl
  try { accessUrl = await getAccessUrl(user, resource) } catch (error) {
    if (/network|offline|fetch|timeout|connection/i.test(String(error?.message || ''))) {
      throw new Error('This Resource is not saved on this phone. Connect and try again.')
    }
    throw error
  }
  if (!isCurrent()) return false
  const supported = await linking.canOpenURL(accessUrl)
  if (!isCurrent()) return false
  if (!supported) throw new Error('This Resource link is not supported on this device.')
  await linking.openURL(accessUrl)
  return isCurrent()
}
