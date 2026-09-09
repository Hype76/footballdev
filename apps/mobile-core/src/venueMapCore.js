export const MAP_ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright'
export const MAP_USER_AGENT = 'FootballPlayer/1.0 (+https://footballplayer.online)'
const places = new Map()

export function normalizeVenuePlaces(data) {
  return (Array.isArray(data?.features) ? data.features : []).flatMap(feature => {
    const [longitude, latitude] = feature.geometry?.coordinates || []
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) return []
    const p = feature.properties || {}
    return [{ latitude, longitude, label: [...new Set([p.name, [p.housenumber, p.street].filter(Boolean).join(' '), p.city || p.town || p.village, p.postcode, p.country].filter(Boolean))].join(', ') || 'Map location' }]
  }).slice(0, 3)
}

export async function findVenuePlaces(location, signal) {
  const query = String(location || '').trim().slice(0, 300)
  if (!query) return []
  const cached = places.get(query)
  if (cached && Date.now() - cached.time < 86400000) return cached.items
  const postcode = query.match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i)?.[0]
  if (postcode) {
    try {
      const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, { signal, headers: { Accept: 'application/json' } })
      const data = response.ok ? (await response.json()).result : null
      if (Number.isFinite(data?.latitude) && Number.isFinite(data?.longitude)) {
        const items = [{ latitude: data.latitude, longitude: data.longitude, label: `${data.postcode} postcode area` }]
        if (places.size >= 64) places.delete(places.keys().next().value)
        places.set(query, { time: Date.now(), items })
        return items
      }
    } catch (error) { if (signal?.aborted) throw error }
  }
  const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=3&lang=en`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error('Map search unavailable')
  const items = normalizeVenuePlaces(await response.json())
  if (places.size >= 64) places.delete(places.keys().next().value)
  places.set(query, { time: Date.now(), items })
  return items
}

export function venueMapTiles(place, zoom, width, height = 220) {
  const size = 2 ** zoom
  const x = (place.longitude + 180) / 360 * size * 256
  const sin = Math.sin(place.latitude * Math.PI / 180)
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size * 256
  const left = x - width / 2, top = y - height / 2
  const tiles = []
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + width - 1) / 256); tx++) {
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + height - 1) / 256); ty++) {
      if (ty < 0 || ty >= size) continue
      const wrappedX = ((tx % size) + size) % size
      tiles.push({ key: `${zoom}/${wrappedX}/${ty}`, url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`, left: tx * 256 - left, top: ty * 256 - top })
    }
  }
  return tiles
}
