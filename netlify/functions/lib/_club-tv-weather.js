const weatherCache = new Map()
const USER_AGENT = 'FootballPlayer-MatchdayTV/1.0 (https://footballplayer.online; support@footballplayer.online)'
export function normaliseWeatherPostcode(value) {
  const postcode = String(value ?? '').toUpperCase().replace(/\s/g, '')
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(postcode) || postcode.startsWith('BT')) throw Object.assign(new Error('Enter a Great Britain ground postcode.'), { statusCode: 400 })
  return postcode
}
export async function getClubTvWeather(value, { fetcher = fetch, now = Date.now } = {}) {
  const postcode = normaliseWeatherPostcode(value)
  const cached = weatherCache.get(postcode)
  if (cached && cached.expires > now()) return cached.data
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const locationResponse = await fetcher(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } })
    if (!locationResponse.ok) throw new Error('Ground location unavailable')
    const location = (await locationResponse.json()).result
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180 || location.country === 'Northern Ireland') throw new Error('Ground location unavailable')
    const response = await fetcher(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${location.latitude.toFixed(4)}&lon=${location.longitude.toFixed(4)}`, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } })
    if (!response.ok) throw new Error('Weather unavailable')
    const json = await response.json()
    const slot = json.properties?.timeseries?.filter((item) => Math.abs(Date.parse(item.time) - now()) < 2 * 3600000).sort((a, b) => Math.abs(Date.parse(a.time) - now()) - Math.abs(Date.parse(b.time) - now()))[0]
    const details = slot?.data?.instant?.details
    if (!Number.isFinite(details?.air_temperature) || !Number.isFinite(details?.wind_speed)) throw new Error('Weather unavailable')
    const data = { postcode: location.postcode, location: location.parish || location.admin_district || location.postcode, temperature: Math.round(details.air_temperature), windMph: Math.round(details.wind_speed * 2.23694), condition: String(slot.data.next_1_hours?.summary?.symbol_code || slot.data.next_6_hours?.summary?.symbol_code || 'Weather').replace(/_(day|night|polartwilight)$/, '').replace(/_/g, ' '), time: slot.time }
    if (weatherCache.size >= 128) weatherCache.delete(weatherCache.keys().next().value)
    weatherCache.set(postcode, { expires: Math.max(now() + 10 * 60000, Math.min(now() + 60 * 60000, Date.parse(response.headers?.get('expires') || '') || 0)), data })
    return data
  } finally { clearTimeout(timeout) }
}
