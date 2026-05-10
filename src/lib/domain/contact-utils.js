export const PLAYER_CONTACT_TYPES = {
  parent: 'parent',
  self: 'self',
  both: 'both',
}

export function normalizeParentContacts(parentContacts, fallback = {}) {
  const fallbackType = normalizePlayerContactType(fallback.contactType) === PLAYER_CONTACT_TYPES.self ? PLAYER_CONTACT_TYPES.self : PLAYER_CONTACT_TYPES.parent
  const contacts = Array.isArray(parentContacts) ? parentContacts : []
  const normalizedContacts = contacts
    .map((contact) => ({
      name: String(contact?.name ?? contact?.parentName ?? '').trim(),
      email: String(contact?.email ?? contact?.parentEmail ?? '').trim(),
      type: String(contact?.type ?? contact?.contactType ?? '').trim().toLowerCase() === PLAYER_CONTACT_TYPES.self
        ? PLAYER_CONTACT_TYPES.self
        : PLAYER_CONTACT_TYPES.parent,
    }))
    .filter((contact) => contact.name || contact.email)

  if (normalizedContacts.length > 0) {
    return normalizedContacts
  }

  const fallbackName = String(fallback.parentName ?? fallback.parent_name ?? '').trim()
  const fallbackEmail = String(fallback.parentEmail ?? fallback.parent_email ?? '').trim()

  return fallbackName || fallbackEmail
    ? [
        {
          name: fallbackName,
          email: fallbackEmail,
          type: fallbackType,
        },
      ]
    : []
}

export function normalizePlayerContactType(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  return Object.values(PLAYER_CONTACT_TYPES).includes(normalizedValue) ? normalizedValue : PLAYER_CONTACT_TYPES.parent
}

export function getContactTemplateAudiences(contactType) {
  const normalizedContactType = normalizePlayerContactType(contactType)

  if (normalizedContactType === PLAYER_CONTACT_TYPES.self) {
    return ['player']
  }

  if (normalizedContactType === PLAYER_CONTACT_TYPES.both) {
    return ['parent', 'player']
  }

  return ['parent']
}

export function formatParentContactNames(parentContacts, fallbackName = '') {
  const contacts = normalizeParentContacts(parentContacts, {
    parentName: fallbackName,
  }).filter((contact) => contact.name)

  if (contacts.length === 0) {
    return String(fallbackName ?? '').trim()
  }

  if (contacts.length === 1) {
    return contacts[0].name
  }

  return `${contacts.slice(0, -1).map((contact) => contact.name).join(', ')} and ${contacts[contacts.length - 1].name}`
}

export function formatParentContactEmails(parentContacts, fallbackEmail = '') {
  const contacts = normalizeParentContacts(parentContacts, {
    parentEmail: fallbackEmail,
  }).filter((contact) => contact.email)

  return [...new Set(contacts.map((contact) => contact.email))].join(',')
}
