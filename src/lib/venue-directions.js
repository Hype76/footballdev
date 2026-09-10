export function getVenueDirectionsOptions(location, { apple = true } = {}) {
  const address = String(location || '').trim()
  if (!address) return []
  const q = encodeURIComponent(address)
  return [
    { label: 'Google Maps', url: `https://www.google.com/maps/search/?api=1&query=${q}` },
    { label: 'Waze', url: `https://waze.com/ul?q=${q}&navigate=yes&utm_source=footballplayer` },
    ...(apple ? [{ label: 'Apple Maps', url: `https://maps.apple.com/?q=${q}` }] : []),
  ]
}
export function getDirectionsLocation(value) {
  const text = String(value || '').trim()
  if (!/^https?:\/\//i.test(text)) return text
  try {
    const url = new URL(text)
    if (!['www.google.com', 'maps.google.com', 'maps.apple.com', 'waze.com', 'www.waze.com'].includes(url.hostname)) return ''
    return url.searchParams.get('query') || url.searchParams.get('q') || url.searchParams.get('destination') || ''
  } catch { return '' }
}
