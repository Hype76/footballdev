export function normalizeDateOnly(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalizedValue)) {
    const [day, month, year] = normalizedValue.split('/')
    return `${year}-${month}-${day}`
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return parsedDate.toISOString().slice(0, 10)
}

export function formatUkDate(value, fallback = 'No date entered') {
  const normalizedValue = String(value ?? '').trim()
  const dateOnlyValue = normalizeDateOnly(normalizedValue)

  if (!dateOnlyValue) {
    return normalizedValue || fallback
  }

  const [year, month, day] = dateOnlyValue.split('-')
  return `${day}/${month}/${year}`
}

export function formatUkDateWords(value, fallback = 'No date entered') {
  const normalizedValue = String(value ?? '').trim()
  const dateOnlyValue = normalizeDateOnly(normalizedValue)

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
  const dateOnlyValue = normalizeDateOnly(normalizedValue)

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

  const datePart = formatUkDate(parsedDate.toISOString().slice(0, 10), fallback)
  const timePart = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsedDate)

  return `${datePart} ${timePart}`
}
