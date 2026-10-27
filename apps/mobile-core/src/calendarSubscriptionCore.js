export function getAppleCalendarSubscriptionUrl(value, appRole = 'parent') {
  const url = new URL(String(value || ''))
  const origin = appRole === 'coach' ? 'https://footballplayer.online' : 'https://parent.footballplayer.online'
  if (!['coach', 'parent'].includes(appRole) || url.protocol !== 'https:' || url.origin !== origin
    || url.pathname !== `/.netlify/functions/${appRole}-calendar-feed`
    || !/^[a-f0-9]{64}$/.test(url.searchParams.get('token') || '')
    || [...url.searchParams.keys()].some(key => key !== 'token') || url.hash || url.username || url.password) {
    throw new Error('The calendar link is invalid. Replace it and try again.')
  }
  return `webcal://${url.host}${url.pathname}${url.search}`
}

export function getCalendarSubscriptionToken(value, appRole = 'parent') {
  return new URL(getAppleCalendarSubscriptionUrl(value, appRole)).searchParams.get('token')
}
