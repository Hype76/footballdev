const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::\d{2})?$/

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function normalizeRequiredDate(value) {
  const normalizedValue = normalizeText(value)
  const match = normalizedValue.match(DATE_PATTERN)

  if (!match) {
    return ''
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return ''
  }

  return normalizedValue
}

export function normalizeRequiredTime(value) {
  const normalizedValue = normalizeText(value)
  const match = normalizedValue.match(TIME_PATTERN)

  if (!match) {
    return ''
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (hours > 23 || minutes > 59) {
    return ''
  }

  return `${match[1]}:${match[2]}`
}

export function addMinutesToRequiredTime(value, minutesToAdd) {
  const normalizedTime = normalizeRequiredTime(value)
  const offset = Number(minutesToAdd)

  if (!normalizedTime || !Number.isFinite(offset)) {
    return ''
  }

  const [hours, minutes] = normalizedTime.split(':').map(Number)
  const totalMinutes = (hours * 60 + minutes + offset + 1440) % 1440
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}

export function buildRequiredLocalDateTime(date, time) {
  const normalizedDate = normalizeRequiredDate(date)
  const normalizedTime = normalizeRequiredTime(time)
  return normalizedDate && normalizedTime ? `${normalizedDate}T${normalizedTime}:00` : ''
}

export function isFixtureKickoffTimeTbc(value) {
  return value === true
}

export function validateOrdinaryEventDateTime({ date, endTime, startTime }) {
  const normalizedDate = normalizeRequiredDate(date)
  const normalizedStartTime = normalizeRequiredTime(startTime)
  const normalizedEndTime = normalizeRequiredTime(endTime)

  if (!normalizedDate) {
    throw new Error('Enter an event date.')
  }

  if (!normalizedStartTime) {
    throw new Error('Enter a start time.')
  }

  if (!normalizedEndTime) {
    throw new Error('Enter an end time.')
  }

  if (normalizedEndTime <= normalizedStartTime) {
    throw new Error('End time must be after start time.')
  }

  return {
    date: normalizedDate,
    endTime: normalizedEndTime,
    startTime: normalizedStartTime,
  }
}

export function validateFixtureDateTime({ kickoffTime, kickoffTimeTbc, matchDate }) {
  const normalizedDate = normalizeRequiredDate(matchDate)
  const isTimeTbc = isFixtureKickoffTimeTbc(kickoffTimeTbc)

  if (!normalizedDate) {
    throw new Error('Enter a match date.')
  }

  if (isTimeTbc) {
    return {
      kickoffTime: '',
      kickoffTimeTbc: true,
      matchDate: normalizedDate,
    }
  }

  const normalizedKickoffTime = normalizeRequiredTime(kickoffTime)
  if (!normalizedKickoffTime) {
    throw new Error('Enter a kickoff time or choose Time TBC.')
  }

  return {
    kickoffTime: normalizedKickoffTime,
    kickoffTimeTbc: false,
    matchDate: normalizedDate,
  }
}

export function getFixtureKickoffLabel(match = {}, { long = false, unset = '' } = {}) {
  if (isFixtureKickoffTimeTbc(match.kickoffTimeTbc ?? match.kickoff_time_tbc)) {
    return long ? 'Time TBC' : 'TBC'
  }

  return normalizeRequiredTime(match.kickoffTime ?? match.kickoff_time) || unset
}

export function getFixtureStartDateTime(match = {}) {
  if (isFixtureKickoffTimeTbc(match.kickoffTimeTbc ?? match.kickoff_time_tbc)) {
    return ''
  }

  return buildRequiredLocalDateTime(
    match.matchDate ?? match.match_date,
    match.kickoffTime ?? match.kickoff_time,
  )
}

export function formatFixtureDateTime(match = {}, { locale = 'en-GB' } = {}) {
  const matchDate = normalizeRequiredDate(match.matchDate ?? match.match_date)

  if (!matchDate) {
    return 'Date not set'
  }

  const date = new Date(`${matchDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return matchDate
  }

  const dateLabel = date.toLocaleDateString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
  const kickoffLabel = getFixtureKickoffLabel(match, { long: true })

  return kickoffLabel ? `${dateLabel}, ${kickoffLabel}` : dateLabel
}
