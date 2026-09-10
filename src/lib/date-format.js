function validatedDateOnly(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
    ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''
}

export function normalizeDateOnly(value) {
  if (value instanceof Date || /[T ].*(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value ?? ''))) {
    const instant = new Date(value)
    if (Number.isNaN(instant.getTime())) return ''
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
    const part = type => parts.find(entry => entry.type === type)?.value
    return `${part('year')}-${part('month')}-${part('day')}`
  }
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return validatedDateOnly(...normalizedValue.split('-'))
  }

  if (/^\d{1,2}[/:.-]\d{1,2}[/:.-](?:\d{4}|\d{2})$/.test(normalizedValue)) {
    const [day, month, year] = normalizedValue.split(/[/:.-]/)
    return validatedDateOnly(year.length === 2 ? 2000 + Number(year) : year, month, day)
  }

  const monthWordMatch = normalizedValue.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/)

  if (monthWordMatch) {
    const [, dayValue, monthValue, yearValue] = monthWordMatch
    const monthIndex = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ].indexOf(monthValue.slice(0, 3).toLowerCase())

    if (monthIndex >= 0) {
      return validatedDateOnly(yearValue, monthIndex + 1, dayValue)
    }
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return parsedDate.toISOString().slice(0, 10)
}

export function formatUkDate(value, fallback = 'No date entered') {
  const normalizedValue = String(value ?? '').trim()
  const dateOnlyValue = normalizeDateOnly(value)

  if (!dateOnlyValue) {
    return normalizedValue || fallback
  }

  const [year, month, day] = dateOnlyValue.split('-')
  return `${day}:${month}:${year}`
}

export function formatUkDateWords(value, fallback = 'No date entered') {
  const normalizedValue = String(value ?? '').trim()
  const dateOnlyValue = normalizeDateOnly(value)

  if (!dateOnlyValue) {
    return normalizedValue || fallback
  }

  const [year, month, day] = dateOnlyValue.split('-')
  const parsedDate = new Date(Number(year), Number(month) - 1, Number(day))

  if (Number.isNaN(parsedDate.getTime())) {
    return fallback
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsedDate)
}

export function formatUkMonthYear(value, fallback = 'No date entered') {
  const normalizedValue = String(value ?? '').trim()
  const dateOnlyValue = normalizeDateOnly(value)

  if (!dateOnlyValue) {
    return normalizedValue || fallback
  }

  const [year, month] = dateOnlyValue.split('-')
  const parsedDate = new Date(Number(year), Number(month) - 1, 1)

  if (Number.isNaN(parsedDate.getTime())) {
    return fallback
  }

  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: 'numeric',
  }).format(parsedDate)
}

export function formatUkDateTime(value, fallback = 'No date recorded') {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return fallback
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return fallback
  }

  const datePart = formatUkDate(parsedDate, fallback)
  const timePart = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  }).format(parsedDate)

  return `${datePart} ${timePart}`
}
