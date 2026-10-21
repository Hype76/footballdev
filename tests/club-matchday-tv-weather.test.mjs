import assert from 'node:assert/strict'
import test from 'node:test'
import { getClubTvWeather, normaliseWeatherPostcode } from '../netlify/functions/lib/_club-tv-weather.js'

test('weather resolves the configured ground, sends identifying headers and caches forecast requests', async () => {
  const calls = [], now = () => Date.parse('2026-10-21T10:00:00Z')
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    if (url.includes('postcodes.io')) return { ok: true, json: async () => ({ result: { postcode: 'CB23 6FY', latitude: 52.22, longitude: -0.07, parish: 'Cambourne', country: 'England' } }) }
    return { ok: true, headers: { get: () => 'Wed, 21 Oct 2026 10:30:00 GMT' }, json: async () => ({ properties: { timeseries: [{ time: '2026-10-21T10:00:00Z', data: { instant: { details: { air_temperature: 12.4, wind_speed: 4 } }, next_1_hours: { summary: { symbol_code: 'partlycloudy_day' } } } }] } }) }
  }
  const result = await getClubTvWeather('CB23 6FY', { fetcher, now })
  assert.equal(result.location, 'Cambourne')
  assert.equal(result.temperature, 12)
  assert.equal(result.windMph, 9)
  assert.equal(result.condition, 'partlycloudy')
  assert.match(calls[1].url, /lat=52.2200&lon=-0.0700/)
  assert.match(calls[1].options.headers['User-Agent'], /FootballPlayer.*https/)
  assert.deepEqual(await getClubTvWeather('CB236FY', { fetcher, now }), result)
  assert.equal(calls.length, 2)
})

test('invalid locations and unavailable forecasts fail without a fabricated weather reading', async () => {
  for (const postcode of ['', 'BT1 1AA', 'https://example.com', '123']) assert.throws(() => normaliseWeatherPostcode(postcode))
  await assert.rejects(getClubTvWeather('SW1A1AA', { fetcher: async () => ({ ok: false }) }), /location unavailable/)
  let calls = 0
  await assert.rejects(getClubTvWeather('SW1A1AA', { fetcher: async () => ++calls === 1 ? { ok: true, json: async () => ({ result: { latitude: 51.5, longitude: -0.1 } }) } : { ok: true, json: async () => ({ properties: { timeseries: [] } }) } }), /Weather unavailable/)
})
