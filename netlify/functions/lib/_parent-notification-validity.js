function normalizeText(value) {
  return String(value ?? '').trim()
}

function timestamp(value) {
  const parsed = Date.parse(normalizeText(value))
  return Number.isFinite(parsed) ? parsed : null
}

function relation(value) {
  return Array.isArray(value) ? value[0] : value
}

function isFuture(value, now) {
  const parsed = timestamp(value)
  return parsed === null || parsed > now
}

export function getDateInTimeZone(value = new Date(), timeZone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function isCurrentMatchNotificationReference(row = {}, parentLinkId = '', now = Date.now(), today = '') {
  const match = relation(row.match_days)
  const status = normalizeText(row.status).toLowerCase()
  const matchStatus = normalizeText(match?.status).toLowerCase()
  const matchDate = normalizeText(match?.match_date).slice(0, 10)

  return normalizeText(row.parent_link_id) === normalizeText(parentLinkId)
    && status === 'pending'
    && !row.token_revoked_at
    && isFuture(row.expires_at, now)
    && Boolean(match)
    && !match?.deleted_at
    && !['cancelled', 'completed', 'full_time'].includes(matchStatus)
    && (!today || !matchDate || matchDate >= today)
}

export function isCurrentMatchDayNotificationReference(row = {}, today = '') {
  const status = normalizeText(row.status).toLowerCase()
  const matchDate = normalizeText(row.match_date).slice(0, 10)
  return Boolean(row.id)
    && !row.deleted_at
    && !row.concluded_at
    && !['cancelled', 'completed', 'full_time', 'postponed'].includes(status)
    && (!today || !matchDate || matchDate >= today)
}

export function isCurrentTrainingNotificationReference(row = {}, parentLinkId = '', now = Date.now()) {
  const request = relation(row.training_availability_requests)
  const status = normalizeText(row.status).toLowerCase()
  const requestStatus = normalizeText(request?.status).toLowerCase()
  const deadline = row.response_deadline_at || request?.occurrence_starts_at

  return normalizeText(row.parent_link_id) === normalizeText(parentLinkId)
    && normalizeText(row.recipient_type).toLowerCase() === 'parent'
    && ['pending', 'queued', 'sent', 'failed'].includes(status)
    && !row.token_revoked_at
    && Boolean(request)
    && !['cancelled', 'expired'].includes(requestStatus)
    && isFuture(deadline, now)
    && isFuture(request?.occurrence_starts_at, now)
}

export function isCurrentParentPollReference(row = {}, now = Date.now()) {
  return normalizeText(row.status).toLowerCase() === 'open'
    && isFuture(row.closes_at, now)
}
