import { SYSTEM_ROLE_OPTIONS } from './core-defaults.js'

export function normalizeWords(value) {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function slugifyRole(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function getLegacyRoleDefaults(role) {
  const normalizedRole = slugifyRole(role)

  if (normalizedRole === 'super_admin') {
    return { key: 'super_admin', label: 'Super Admin', rank: 100 }
  }

  if (normalizedRole === 'manager') {
    return { key: 'manager', label: 'Manager', rank: 50 }
  }

  if (normalizedRole === 'coach') {
    return { key: 'coach', label: 'Coach', rank: 30 }
  }

  const matchedSystemRole = SYSTEM_ROLE_OPTIONS.find((option) => option.key === normalizedRole)

  if (matchedSystemRole) {
    return matchedSystemRole
  }

  return {
    key: normalizedRole || 'coach',
    label: normalizeWords(normalizedRole.replace(/_/g, ' ')) || 'Coach',
    rank: 10,
  }
}

export function normalizeRoleKey(value) {
  return slugifyRole(value) || 'coach'
}

export function normalizeRoleLabel(value, roleKey) {
  const systemRole = SYSTEM_ROLE_OPTIONS.find((option) => option.key === normalizeRoleKey(roleKey))

  if (systemRole) {
    return systemRole.label
  }

  const normalizedLabel = String(value ?? '').trim()

  if (normalizedLabel) {
    return normalizedLabel
  }

  return getLegacyRoleDefaults(roleKey).label
}

export function normalizeRoleRank(value, roleKey) {
  const numericValue = Number(value)

  if (!Number.isNaN(numericValue) && numericValue > 0) {
    return numericValue
  }

  return getLegacyRoleDefaults(roleKey).rank
}

export function normalizeFieldType(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()
  const allowedTypes = ['text', 'textarea', 'number', 'select', 'score_1_5', 'score_1_10']

  if (normalizedValue === 'number') {
    return 'score_1_5'
  }

  return allowedTypes.includes(normalizedValue) ? normalizedValue : 'text'
}

export function normalizeFieldOptions(options) {
  if (Array.isArray(options)) {
    return options.map((option) => String(option).trim()).filter(Boolean)
  }

  if (typeof options === 'string') {
    return options
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean)
  }

  return []
}

export function isPastDate(value) {
  if (!value) {
    return false
  }

  const parsedDate = new Date(value)
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.getTime() <= Date.now()
}

export function normalizeDateOnly(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const ukDateMatch = normalizedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)

  if (ukDateMatch) {
    const [, day, month, year] = ukDateMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

export function getDisplayName(profile) {
  const username = String(profile?.username ?? '').trim()

  if (username) {
    return username
  }

  const explicitName = String(profile?.name ?? '').trim()

  if (explicitName) {
    return explicitName
  }

  const email = String(profile?.email ?? '').trim().toLowerCase()
  const emailPrefix = email.split('@')[0]?.replace(/[._-]+/g, ' ') || 'Coach User'
  return normalizeWords(emailPrefix)
}

export function getEntryUserName(user) {
  return String(user?.username ?? user?.name ?? user?.email ?? '').trim()
}

export function getEntryUserEmail(user) {
  return String(user?.email ?? '').trim().toLowerCase()
}

export function getEntryIdentity(user, prefix = 'created_by') {
  return {
    [`${prefix}_name`]: getEntryUserName(user),
    [`${prefix}_email`]: getEntryUserEmail(user),
  }
}

export function getEntryUserId(user) {
  return user?.id || null
}

export function getClubName(clubs) {
  if (Array.isArray(clubs)) {
    return String(clubs[0]?.name ?? '').trim()
  }

  return String(clubs?.name ?? '').trim()
}

export function getClubValue(clubs, key) {
  if (Array.isArray(clubs)) {
    return clubs[0]?.[key]
  }

  return clubs?.[key]
}
