import { formatUkDateTime } from './date-format.js'

export const LOG_PAGE_SIZE = 15
export const BACKUP_PAGE_SIZE = 10

export function formatActivityDateTime(value) {
  if (!value) {
    return 'No date recorded'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'No date recorded'
  }

  return formatUkDateTime(date.toISOString(), 'No date recorded')
}

export function formatActivityAction(value) {
  return String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatActivityMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return ''
  }

  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `${formatActivityAction(key)}: ${String(value)}`)
    .join(', ')
}
