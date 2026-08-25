export const DEFAULT_EXPIRY_DURATION = '00:02:00'
export const MAX_EXPIRY_DAYS = 30

function expiryDurationError() {
  return new Error(`Use DD:HH:MM, for example 02:06:30. The maximum is ${String(MAX_EXPIRY_DAYS).padStart(2, '0')}:00:00.`)
}

export function parseExpiryDuration(value, { allowBlank = false } = {}) {
  const text = String(value ?? '').trim()
  if (!text && allowBlank) return null

  const match = text.match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
  if (!match) throw expiryDurationError()

  const days = Number(match[1])
  const hours = Number(match[2])
  const minutes = Number(match[3])
  const totalMinutes = (days * 24 * 60) + (hours * 60) + minutes
  const maximumMinutes = MAX_EXPIRY_DAYS * 24 * 60

  if (hours > 23 || minutes > 59 || totalMinutes < 1 || totalMinutes > maximumMinutes) {
    throw expiryDurationError()
  }

  return Object.freeze({
    days,
    hours,
    minutes,
    totalHours: totalMinutes / 60,
    totalMinutes,
    normalized: `${String(days).padStart(2, '0')}:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  })
}

export function expiryDurationToHours(value) {
  return parseExpiryDuration(value).totalHours
}

export function expiryDurationToIso(value, { allowBlank = false, now = Date.now() } = {}) {
  const duration = parseExpiryDuration(value, { allowBlank })
  if (!duration) return ''
  return new Date(Number(now) + (duration.totalMinutes * 60 * 1000)).toISOString()
}

export function formatExpiryDurationFromHours(value, fallback = DEFAULT_EXPIRY_DURATION) {
  const totalMinutes = Math.round(Number(value) * 60)
  if (!Number.isFinite(totalMinutes) || totalMinutes < 1) return fallback
  const days = Math.floor(totalMinutes / (24 * 60))
  const remainingMinutes = totalMinutes % (24 * 60)
  const hours = Math.floor(remainingMinutes / 60)
  const minutes = remainingMinutes % 60
  return `${String(days).padStart(2, '0')}:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
