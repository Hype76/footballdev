const MAX_NOTIFICATION_TEAM_NAME_LENGTH = 40

function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function isSeasonToken(value) {
  return /^(?:20)?\d{2}\s*[/\\-]\s*(?:20)?\d{2}$/.test(value)
}

function compactWord(value) {
  const word = normalize(value)

  if (!word) return ''
  if (/^u\d{1,2}$/i.test(word)) return word.toUpperCase()
  if (/^[A-Z0-9]{2,6}$/.test(word)) return word

  return word.charAt(0).toUpperCase()
}

export function deriveTeamNotificationDisplayName(teamName) {
  const words = normalize(teamName)
    .split(' ')
    .filter(Boolean)
    .filter((word) => !isSeasonToken(word))
  const compactWords = words.map(compactWord).filter(Boolean)
  const derived = compactWords.every((word) => word.length === 1)
    ? compactWords.join('')
    : compactWords.join(' ')

  return (derived || normalize(teamName)).slice(0, MAX_NOTIFICATION_TEAM_NAME_LENGTH)
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

export { MAX_NOTIFICATION_TEAM_NAME_LENGTH }
