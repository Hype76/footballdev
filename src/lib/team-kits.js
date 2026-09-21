import { KIT_TYPES } from './club-kits.js'

export const DEFAULT_TEAM_KIT_COLOURS = Object.freeze({ home: '#1d4ed8', away: '#ffffff' })
export const TEAM_KIT_HEX_PATTERN = /^#[0-9a-f]{6}$/i

export function normalizeKitColour(value) {
  const colour = String(value || '').trim()
  return TEAM_KIT_HEX_PATTERN.test(colour) ? colour.toLowerCase() : null
}

export function hexToHsv(value) {
  const colour = normalizeKitColour(value) || '#000000'
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(colour.slice(index, index + 2), 16) / 255)
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min
  let hue = 0
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  if (hue < 0) hue += 360
  return { h: hue, s: max ? delta / max : 0, v: max }
}

export function hsvToHex({ h = 0, s = 0, v = 0 } = {}) {
  const hue = ((Number(h) % 360) + 360) % 360
  const saturation = Math.max(0, Math.min(1, Number(s)))
  const value = Math.max(0, Math.min(1, Number(v)))
  const chroma = value * saturation
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
  const match = value - chroma
  const [red, green, blue] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x]
  return `#${[red, green, blue].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('')}`
}

export function normalizeTeamKits(row = {}) {
  const home = normalizeKitColour(row.home_kit_colour ?? row.homeKitColour)
  const away = normalizeKitColour(row.away_kit_colour ?? row.awayKitColour)
  return Object.fromEntries(KIT_TYPES.flatMap(type => {
    const colour = type === 'home' ? home : away
    return colour ? [[type, { colour, imagePath: null, source: 'team' }]] : []
  }))
}

export function mergeTeamKits(teamKits = {}, clubKits = {}) {
  return Object.fromEntries(KIT_TYPES.flatMap(type => {
    const kit = teamKits[type] || clubKits[type]
    return kit ? [[type, kit]] : []
  }))
}

export function mobileTeamKitCacheKey(clubId, teamId) {
  return `${String(clubId || '').trim()}:${String(teamId || '').trim()}`
}

export async function readTeamKits(client, clubId, teamId) {
  if (!clubId || !teamId) return {}
  const { data, error } = await client.from('teams')
    .select('home_kit_colour,away_kit_colour')
    .eq('club_id', clubId)
    .eq('id', teamId)
    .maybeSingle()
  if (error) throw error
  return normalizeTeamKits(data || {})
}
