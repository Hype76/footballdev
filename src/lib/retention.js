export const ARCHIVED_PLAYER_RETENTION_MONTHS = 3
export const VOICE_NOTE_RETENTION_DAYS = 14

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

export function addMonths(date, months) {
  const nextDate = new Date(date)
  nextDate.setMonth(nextDate.getMonth() + months)
  return nextDate
}

export function addDays(date, days) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}

export function formatRetentionDate(value) {
  if (!value) {
    return 'Not set'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Not set'
  }

  return dateFormatter.format(date)
}

export function getRetentionCountdownLabel(value) {
  if (!value) {
    return 'Expiry date not set'
  }

  const expiryDate = new Date(value)

  if (Number.isNaN(expiryDate.getTime())) {
    return 'Expiry date not set'
  }

  const millisecondsRemaining = expiryDate.getTime() - Date.now()

  if (millisecondsRemaining <= 0) {
    return 'Ready for cleanup'
  }

  const daysRemaining = Math.ceil(millisecondsRemaining / 86400000)

  if (daysRemaining === 1) {
    return '1 day remaining'
  }

  return `${daysRemaining} days remaining`
}
