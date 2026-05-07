import { getClubSettings } from '../../lib/supabase.js'

export function createInitialFormData(user, defaults = {}) {
  return {
    team: '',
    section: 'Trial',
    session: '',
    coachName: user?.name || '',
    playerName: '',
    parentName: '',
    parentEmail: '',
    parentContacts: [],
    contactType: 'parent',
    ...defaults,
  }
}

export function getDraftStorageKey(user) {
  if (!user?.id) {
    return ''
  }

  return `create-evaluation-draft:${user.id}:${user.clubId || 'platform'}`
}

export async function getLatestClubLogoUrl(user) {
  if (!user?.clubId) {
    return user?.clubLogoUrl || ''
  }

  try {
    const clubSettings = await getClubSettings(user.clubId)
    return clubSettings.logoUrl || user.clubLogoUrl || ''
  } catch (error) {
    console.error(error)
    return user.clubLogoUrl || ''
  }
}

export function normalizePlayerName(value) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function createEmptyResponseValues(fields) {
  return Object.fromEntries(fields.map((field) => [field.id, '']))
}

export function isScoreFieldType(fieldType) {
  return fieldType === 'score_1_5' || fieldType === 'score_1_10' || fieldType === 'number'
}

export function normalizeResponseValue(field, value) {
  if (isScoreFieldType(field.type)) {
    const numericValue = Number(value)
    return Number.isNaN(numericValue) ? '' : numericValue
  }

  return String(value ?? '').trim()
}

export function buildFormResponses(fields, responseValues) {
  return Object.fromEntries(
    fields
      .map((field) => [field.label, normalizeResponseValue(field, responseValues[field.id])])
      .filter(([, value]) => value !== ''),
  )
}

export function buildScores(formResponses) {
  return Object.fromEntries(
    Object.entries(formResponses).filter(([, value]) => typeof value === 'number' && !Number.isNaN(value)),
  )
}

export function buildComments(formResponses) {
  const entries = Object.entries(formResponses)
  const findResponse = (patterns) =>
    entries.find(([label]) => patterns.some((pattern) => label.toLowerCase().includes(pattern)))?.[1] ?? ''

  return {
    strengths: String(findResponse(['strength']))?.trim() || '',
    improvements: String(findResponse(['improvement', 'weakness', 'development']))?.trim() || '',
    overall: String(findResponse(['overall', 'summary', 'comment']))?.trim() || '',
    selectedStrengths: [],
  }
}

export function getAverageScore(formResponses) {
  const values = Object.values(formResponses)
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value))

  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function createResponseItems(fields, responseValues, includeEmptyValues = false) {
  return fields
    .map((field) => {
      const value = normalizeResponseValue(field, responseValues[field.id])

      if (!includeEmptyValues && value === '') {
        return null
      }

      return {
        label: field.label,
        value,
      }
    })
    .filter(Boolean)
}

export function parseStoredDraft(storageKey) {
  if (!storageKey) {
    return null
  }

  try {
    const storedValue = sessionStorage.getItem(storageKey)

    if (!storedValue) {
      return null
    }

    const parsedValue = JSON.parse(storedValue)
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : null
  } catch (error) {
    console.error(error)
    return null
  }
}

export function normalizeSessionValue(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return parsedDate.toISOString().slice(0, 10)
}

export function formatSessionForInput(value) {
  const normalizedValue = normalizeSessionValue(value)

  if (!normalizedValue) {
    return ''
  }

  return normalizedValue
}

export function formatSessionForDisplay(value) {
  const normalizedValue = normalizeSessionValue(value)

  if (!normalizedValue) {
    return 'Not scheduled'
  }

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${normalizedValue}T00:00:00`))
}

export function parseAssessmentQueue(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(normalizedValue)
    return Array.isArray(parsedValue)
      ? parsedValue.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
  } catch {
    return normalizedValue
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean)
  }
}

export function buildPreviewSummary({ comments, formResponses }) {
  const responseEntries = Object.entries(formResponses ?? {})

  if (responseEntries.length > 0) {
    return responseEntries
      .slice(0, 4)
      .map(([label, value]) => `${label}: ${value}`)
      .join(', ')
  }

  return comments?.overall || comments?.strengths || comments?.improvements || 'No written summary provided.'
}
