export const COACH_PLAYER_SECTIONS = Object.freeze(['Trial', 'Squad'])
export const COACH_PLAYER_CONTACT_TYPES = Object.freeze(['parent', 'self'])

function normalize(value) {
  return String(value ?? '').trim()
}

function normalizeWords(value) {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function normalizeContacts(value, fallbackName = '', fallbackEmail = '', contactType = 'parent') {
  const source = Array.isArray(value) ? value : []
  const rows = source.length > 0 ? source : [{ name: fallbackName, email: fallbackEmail, type: contactType }]
  return rows
    .map((contact) => ({
      email: normalize(contact?.email).toLowerCase(),
      name: normalize(contact?.name),
      type: COACH_PLAYER_CONTACT_TYPES.includes(normalize(contact?.type).toLowerCase())
        ? normalize(contact.type).toLowerCase()
        : contactType,
    }))
    .filter((contact) => contact.name || contact.email)
}

export function normalizeCoachPlayer(row, { canViewContacts = true } = {}) {
  const contactType = COACH_PLAYER_CONTACT_TYPES.includes(normalize(row.contact_type ?? row.contactType).toLowerCase())
    ? normalize(row.contact_type ?? row.contactType).toLowerCase()
    : row.is_adult || row.isAdult ? 'self' : 'parent'
  const contacts = canViewContacts
    ? normalizeContacts(row.parent_contacts ?? row.parentContacts, row.parent_name ?? row.parentName, row.parent_email ?? row.parentEmail, contactType)
    : []
  return Object.freeze({
    archivedAt: normalize(row.archived_at ?? row.archivedAt),
    clubId: normalize(row.club_id ?? row.clubId),
    contactType,
    createdAt: normalize(row.created_at ?? row.createdAt),
    id: normalize(row.id),
    notes: normalize(row.notes),
    parentContacts: contacts,
    parentEmail: contacts[0]?.email || '',
    parentName: contacts[0]?.name || '',
    playerName: normalize(row.player_name ?? row.playerName) || 'Unnamed player',
    positions: (Array.isArray(row.positions) ? row.positions : []).map(normalize).filter(Boolean),
    section: COACH_PLAYER_SECTIONS.includes(normalize(row.section)) ? normalize(row.section) : 'Trial',
    shirtNumber: normalize(row.shirt_number ?? row.shirtNumber),
    status: normalize(row.status || 'active').toLowerCase() || 'active',
    team: normalize(row.team),
    teamId: normalize(row.team_id ?? row.teamId),
    updatedAt: normalize(row.updated_at ?? row.updatedAt),
  })
}

export function normalizeCoachPlayerEvaluation(row) {
  const comments = row?.comments && typeof row.comments === 'object' ? row.comments : {}
  return Object.freeze({
    averageScore: row.average_score ?? row.averageScore ?? null,
    comments: normalize(comments.overall || row.overall_comments || row.notes),
    createdAt: normalize(row.created_at ?? row.createdAt),
    date: normalize(row.date),
    fieldValues: row.form_responses && typeof row.form_responses === 'object' ? row.form_responses : {},
    id: normalize(row.id),
    scores: row.scores && typeof row.scores === 'object' ? row.scores : {},
    session: normalize(row.session),
    status: normalize(row.status),
  })
}

export function normalizeCoachPlayerField(row) {
  const supportedTypes = ['text', 'textarea', 'number', 'select', 'score_1_5', 'score_1_10', 'yes_no', 'traffic_light']
  const type = normalize(row.type).toLowerCase()
  return Object.freeze({
    id: normalize(row.id),
    isEnabled: row.is_enabled !== false && row.isEnabled !== false,
    label: normalize(row.label) || 'Field',
    options: (Array.isArray(row.options) ? row.options : []).map(normalize).filter(Boolean),
    orderIndex: Number(row.order_index ?? row.orderIndex ?? 0),
    required: row.required === true,
    type: supportedTypes.includes(type) ? type : 'text',
  })
}

export function filterCoachPlayers(players = [], { query = '', section = 'all', status = 'active' } = {}) {
  const needle = normalize(query).toLowerCase()
  return players.filter((player) => {
    if (section !== 'all' && player.section !== section) return false
    if (status !== 'all' && player.status !== status) return false
    if (!needle) return true
    return [player.playerName, player.shirtNumber, player.team, ...(player.positions || [])]
      .some((value) => normalize(value).toLowerCase().includes(needle))
  })
}

export function getCoachPlayerMutationPolicy({ context, player = null } = {}) {
  const canMutate = context?.paymentAccess?.canMutate === true && Number(context?.roleRank || 0) >= 20 && Boolean(context?.teamId)
  return Object.freeze({
    canArchive: false,
    canCreate: canMutate,
    canEdit: canMutate && player?.status !== 'archived',
    canTransferTeam: false,
    onlineRequired: true,
  })
}

export function buildCoachPlayerPayload({ context, form }) {
  const playerName = normalizeWords(form?.playerName)
  if (!playerName) throw new Error('Add the Player name.')
  const teamId = normalize(context?.teamId || context?.activeTeamId)
  const teamName = normalize(context?.teamName || context?.activeTeamName)
  if (!context?.clubId || !teamId) throw new Error('Choose an active Team context.')
  const section = COACH_PLAYER_SECTIONS.includes(form?.section) ? form.section : 'Trial'
  const contactType = COACH_PLAYER_CONTACT_TYPES.includes(normalize(form?.contactType).toLowerCase())
    ? normalize(form.contactType).toLowerCase()
    : 'parent'
  const contacts = normalizeContacts(form?.parentContacts, form?.parentName, form?.parentEmail, contactType)
  const primaryContact = contacts[0] || { email: '', name: '' }
  return Object.freeze({
    club_id: context.clubId,
    contact_type: contactType,
    notes: normalize(form?.notes),
    parent_contacts: contacts,
    parent_email: primaryContact.email,
    parent_name: primaryContact.name,
    player_name: playerName,
    positions: (Array.isArray(form?.positions) ? form.positions : normalize(form?.positions).split(','))
      .map(normalizeWords)
      .filter(Boolean),
    section,
    shirt_number: normalize(form?.shirtNumber),
    team: teamName,
    team_id: teamId,
  })
}

export function coachPlayerFormFromPlayer(player = null) {
  return {
    contactType: player?.contactType || 'parent',
    notes: normalize(player?.notes),
    parentContacts: player?.parentContacts?.length ? player.parentContacts : [{ email: '', name: '', type: 'parent' }],
    playerName: normalize(player?.playerName),
    positions: (player?.positions || []).join(', '),
    section: player?.section || 'Trial',
    shirtNumber: normalize(player?.shirtNumber),
  }
}

export function getCoachPlayerSensitiveFieldPolicy(context) {
  const operationalStaff = Number(context?.roleRank || 0) >= 20 && Boolean(context?.teamId)
  return Object.freeze({
    canViewContactDetails: operationalStaff,
    canViewPrivateNotes: operationalStaff,
    wrongTeamFailsClosed: true,
  })
}
