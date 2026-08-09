const UK_TIME_ZONE = 'Europe/London'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function datePartsForInstant(instant) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

export function getUkCalendarDate(value = new Date()) {
  const parts = datePartsForInstant(value instanceof Date ? value : new Date(value))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function ukCalendarDateToInstant(value) {
  const normalized = String(value ?? '').trim()
  if (!DATE_PATTERN.test(normalized)) return ''

  const [year, month, day] = normalized.split('-').map(Number)
  const utcMidnight = Date.UTC(year, month - 1, day)
  const probe = datePartsForInstant(new Date(utcMidnight))
  const representedAsUtc = Date.UTC(
    Number(probe.year),
    Number(probe.month) - 1,
    Number(probe.day),
    Number(probe.hour),
    Number(probe.minute),
    Number(probe.second),
  )
  const instant = new Date(utcMidnight - (representedAsUtc - utcMidnight))
  return getUkCalendarDate(instant) === normalized ? instant.toISOString() : ''
}

export function validateBillingArrangement({ arrangement, startDate, now = new Date(), planKey = '' }) {
  const normalizedArrangement = String(arrangement ?? '').trim().toLowerCase()
  if (!['immediate', 'deferred', 'complimentary'].includes(normalizedArrangement)) {
    throw new Error('Choose an immediate, deferred, or complimentary billing arrangement.')
  }
  if (['individual', 'pilot'].includes(String(planKey ?? '').trim()) && normalizedArrangement !== 'complimentary') {
    throw new Error('Individual and Pilot workspaces require complimentary billing.')
  }

  if (normalizedArrangement !== 'deferred') {
    return { arrangement: normalizedArrangement, billingStartAt: null }
  }

  const billingStartAt = ukCalendarDateToInstant(startDate)
  if (!billingStartAt) throw new Error('Choose a valid UK billing start date.')
  if (String(startDate) < getUkCalendarDate(now)) {
    throw new Error('The billing start date cannot be in the past.')
  }
  return { arrangement: normalizedArrangement, billingStartAt }
}
