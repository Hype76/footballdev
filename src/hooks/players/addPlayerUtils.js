import { PLAYER_CONTACT_TYPES, normalizePlayerContactType } from '../../lib/supabase.js'

export function createInitialPlayerForm() {
  return {
    playerName: '',
    shirtNumber: '',
    section: 'Trial',
    teamId: '',
    team: '',
    positions: [],
    positionDraft: '',
    contactType: PLAYER_CONTACT_TYPES.parent,
    parentContacts: [{ name: '', email: '' }],
  }
}

export const RECENT_PLAYER_PAGE_SIZE = 8

export const CONTACT_TYPE_OPTIONS = [
  {
    value: PLAYER_CONTACT_TYPES.self,
    label: 'Player',
    description: 'Send player emails directly to the player.',
  },
  {
    value: PLAYER_CONTACT_TYPES.parent,
    label: 'Parent/Guardian',
    description: 'Send parent emails to parent or guardian contacts.',
  },
  {
    value: PLAYER_CONTACT_TYPES.both,
    label: 'Player and Parents',
    description: 'Send player emails to the player and parent emails to parents or guardians.',
  },
]

export function contactTypeAllowsSelf(contactType) {
  return contactType === PLAYER_CONTACT_TYPES.self || contactType === PLAYER_CONTACT_TYPES.both
}

export function contactTypeAllowsParents(contactType) {
  return contactType === PLAYER_CONTACT_TYPES.parent || contactType === PLAYER_CONTACT_TYPES.both
}

export function ensureContactsForType(contacts, contactType, playerName = '') {
  const normalizedContactType = normalizePlayerContactType(contactType)
  const nextContacts = Array.isArray(contacts)
    ? contacts.map((contact) => ({
        name: String(contact?.name ?? '').trim(),
        email: String(contact?.email ?? '').trim(),
        type: String(contact?.type ?? '').trim().toLowerCase() === PLAYER_CONTACT_TYPES.self
          ? PLAYER_CONTACT_TYPES.self
          : PLAYER_CONTACT_TYPES.parent,
      }))
    : []
  const filteredContacts = nextContacts.filter((contact) => {
    if (contact.type === PLAYER_CONTACT_TYPES.self) {
      return contactTypeAllowsSelf(normalizedContactType)
    }

    return contactTypeAllowsParents(normalizedContactType)
  })

  if (contactTypeAllowsSelf(normalizedContactType) && !filteredContacts.some((contact) => contact.type === PLAYER_CONTACT_TYPES.self)) {
    filteredContacts.unshift({ name: playerName, email: '', type: PLAYER_CONTACT_TYPES.self })
  }

  if (contactTypeAllowsParents(normalizedContactType) && !filteredContacts.some((contact) => contact.type === PLAYER_CONTACT_TYPES.parent)) {
    filteredContacts.push({ name: '', email: '', type: PLAYER_CONTACT_TYPES.parent })
  }

  return filteredContacts.length > 0 ? filteredContacts : [{ name: '', email: '', type: PLAYER_CONTACT_TYPES.parent }]
}

export function getContactGroups(normalizedContactType) {
  return [
    ...(contactTypeAllowsSelf(normalizedContactType)
      ? [
          {
            type: PLAYER_CONTACT_TYPES.self,
            title: 'Player Contact',
            description: 'Used for direct player emails.',
            addLabel: 'Add Player Contact',
            removeLabel: 'Remove Player Contact',
            nameLabel: 'Player Name',
            emailLabel: 'Player Email',
          },
        ]
      : []),
    ...(contactTypeAllowsParents(normalizedContactType)
      ? [
          {
            type: PLAYER_CONTACT_TYPES.parent,
            title: 'Parent/Guardian Contacts',
            description: 'Used for parent or guardian emails.',
            addLabel: 'Add Parent',
            removeLabel: 'Remove Parent',
            nameLabel: 'Name',
            emailLabel: 'Email',
          },
        ]
      : []),
  ]
}
