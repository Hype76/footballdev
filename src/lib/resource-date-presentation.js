import { formatUkDate, normalizeDateOnly } from './date-format.js'

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return year >= 1900 && year <= 2199 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''
}

export function getResourceTitleDate(title = '') {
  const yearFirst = String(title).match(/\b(20\d{2}|19\d{2}|21\d{2})[-_ ./](\d{1,2})[-_ ./](\d{1,2})\b/)
  if (yearFirst) return validDate(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]))
  const dayFirst = String(title).match(/\b(\d{1,2})[/:.-](\d{1,2})[/:.-](\d{4}|\d{2})\b/)
  if (!dayFirst) return ''
  const year = Number(dayFirst[3]) + (dayFirst[3].length === 2 ? 2000 : 0)
  return validDate(year, Number(dayFirst[2]), Number(dayFirst[1]))
}

export function getResourceDisplayTitle(resource = {}) {
  const title = String(resource.title || resource.fileName || 'Shared resource')
  return title.replace(/\b(?:(?:20\d{2}|19\d{2}|21\d{2})[-_ ./]\d{1,2}[-_ ./]\d{1,2}|\d{1,2}[/:.-]\d{1,2}[/:.-](?:\d{4}|\d{2}))\b/g, value => {
    const date = getResourceTitleDate(value)
    return date ? formatUkDate(date) : value
  })
}

export function sortResourcesNewestFirst(resources = []) {
  const date = item => normalizeDateOnly(item.eventDate || item.matchDate || item.reportDate)
    || getResourceTitleDate(item.title || item.fileName)
    || normalizeDateOnly(item.assignedAt || item.createdAt || item.link?.assignedAt)
    || ''
  return [...resources].sort((left, right) => date(right).localeCompare(date(left))
    || String(right.assignedAt || right.createdAt || '').localeCompare(String(left.assignedAt || left.createdAt || ''))
    || String(left.title || '').localeCompare(String(right.title || '')))
}
