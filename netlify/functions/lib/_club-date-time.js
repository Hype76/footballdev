export const DEFAULT_CLUB_TIME_ZONE = 'Europe/London'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function resolveClubTimeZone(value) {
  const candidate = normalizeText(value) || DEFAULT_CLUB_TIME_ZONE

  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: candidate }).format(new Date())
    return candidate
  } catch {
    return DEFAULT_CLUB_TIME_ZONE
  }
}

export function formatClubDateTime(value, {
  fallback = 'Time to be confirmed',
  options = {},
  timeZone,
} = {}) {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return fallback
  }

  return new Intl.DateTimeFormat('en-GB', {
    ...options,
    timeZone: resolveClubTimeZone(timeZone),
  }).format(parsedDate)
}
