const normalize = (value) => String(value ?? '').trim()
const CLOSED_MATCH_STATUSES = new Set(['cancelled', 'postponed', 'full_time', 'completed', 'concluded', 'deleted'])

export function canEditCoachFormationBoard(user = {}) {
  return Boolean(
    normalize(user.id)
    && normalize(user.clubId)
    && normalize(user.activeTeamId)
    && Number(user.roleRank || 0) >= 30
    && user.hasActivePlanAccess === true
  )
}

export function getCoachFormationMarkerVisualPosition(position = {}, layout = {}, {
  anchorY = 33,
  markerHeight = 86,
  markerWidth = 78,
} = {}) {
  const width = Number(layout.width || 0)
  const height = Number(layout.height || 0)
  const x = Math.max(0, Math.min(1, Number(position.x || 0)))
  const y = Math.max(0, Math.min(1, Number(position.y || 0)))
  if (!(width > 0) || !(height > 0)) return { x, y }
  const halfWidthRatio = Math.min(0.5, (markerWidth / 2) / width)
  const topRatio = Math.min(0.5, anchorY / height)
  const bottomRatio = Math.min(0.5, (markerHeight - anchorY) / height)
  return {
    x: Math.max(halfWidthRatio, Math.min(1 - halfWidthRatio, x)),
    y: Math.max(topRatio, Math.min(1 - bottomRatio, y)),
  }
}

function londonDateValue(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/London',
    year: 'numeric',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function matchDateValue(match) {
  return normalize(match?.matchDate).slice(0, 10)
}

function dateValue(match) {
  const timestamp = Date.parse(`${normalize(match?.matchDate) || '9999-12-31'}T${normalize(match?.kickoffTime) || '23:59:59'}`)
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER
}

export function sortCoachFormationMatches(matches = []) {
  const priority = { live: 0, half_time: 0, second_half: 0, extra_time: 0, penalties: 0, scheduled: 1, postponed: 2, full_time: 3, cancelled: 4 }
  return [...matches].sort((left, right) => {
    const statusDifference = Number(priority[normalize(left?.status)] ?? 2) - Number(priority[normalize(right?.status)] ?? 2)
    return statusDifference || dateValue(left) - dateValue(right)
  })
}

export function isCoachFormationMatchLinkable(match, { now = new Date(), teamId = '' } = {}) {
  const matchId = normalize(match?.id)
  const matchTeamId = normalize(match?.teamId ?? match?.team_id)
  const status = normalize(match?.status).toLowerCase()
  const matchDate = matchDateValue(match)
  if (!matchId || !matchDate || matchDate < londonDateValue(now)) return false
  if (teamId && matchTeamId !== normalize(teamId)) return false
  if (CLOSED_MATCH_STATUSES.has(status)) return false
  if (match?.deletedAt || match?.deleted_at || match?.concludedAt || match?.concluded_at) return false
  return true
}

export function getLinkableCoachFormationMatches(matches = [], options = {}) {
  return sortCoachFormationMatches(matches.filter((match) => isCoachFormationMatchLinkable(match, options)))
}

export function selectPreferredCoachFormationMatch(matches = [], selectedId = '') {
  const ordered = getLinkableCoachFormationMatches(matches)
  return ordered.find((match) => match.id === selectedId)
    || ordered[0]
    || null
}
