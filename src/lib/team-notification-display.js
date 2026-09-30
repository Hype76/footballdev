const MAX_NOTIFICATION_TEAM_NAME_LENGTH = 40

function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

export function deriveTeamNotificationDisplayName(teamName) {
  return normalize(teamName).slice(0, MAX_NOTIFICATION_TEAM_NAME_LENGTH)
}

export function normalizeTeamNotificationDisplayName(value) {
  const normalized = normalize(value)

  if (!normalized || normalized.length > MAX_NOTIFICATION_TEAM_NAME_LENGTH) {
    return ''
  }

  return normalized
}

export function resolveTeamNotificationDisplayName(team = {}, fallbackName = '') {
  const saved = normalizeTeamNotificationDisplayName(
    team.notification_display_name ?? team.notificationDisplayName,
  )

  return saved || deriveTeamNotificationDisplayName(team.name ?? fallbackName)
}

export function resolveMatchDayNotificationTeamName(match = {}, fallbackName = '') {
  const snapshot = normalizeTeamNotificationDisplayName(
    match.notification_team_name ?? match.notificationTeamName,
  )
  const team = Array.isArray(match.teams) ? match.teams[0] : match.teams

  return snapshot || resolveTeamNotificationDisplayName(
    team || {},
    match.team_name ?? match.teamName ?? fallbackName,
  )
}

export { MAX_NOTIFICATION_TEAM_NAME_LENGTH }
