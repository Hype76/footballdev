import { supabase } from './supabase'

function normalizeSession(row) {
  return {
    id: row.id,
    title: String(row.title || row.team || 'Session').trim(),
    team: String(row.team || '').trim(),
    opponent: String(row.opponent || '').trim(),
    sessionType: String(row.session_type || 'training').trim(),
    sessionDate: String(row.session_date || '').trim(),
    status: String(row.status || 'open').trim(),
    completedAt: row.completed_at || '',
  }
}

function normalizePlayer(row) {
  const positions = Array.isArray(row.positions) ? row.positions.filter(Boolean).join(', ') : ''
  const primaryContact = Array.isArray(row.parent_contacts) ? row.parent_contacts[0] : null

  return {
    id: row.id,
    playerName: String(row.player_name || 'Unnamed player').trim(),
    section: String(row.section || 'Trial').trim(),
    status: String(row.status || 'active').trim(),
    team: String(row.team || '').trim(),
    positions,
    parentName: String(row.parent_name || primaryContact?.name || '').trim(),
    parentEmail: String(row.parent_email || primaryContact?.email || '').trim(),
    notes: String(row.notes || '').trim(),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    isAssessed: Boolean(row.isAssessed || row.is_assessed),
    assessmentId: row.assessmentId || row.assessment_id || '',
    averageScore: typeof row.averageScore === 'number' ? row.averageScore : row.average_score ?? null,
    assessmentStatus: String(row.assessmentStatus || row.assessment_status || '').trim(),
  }
}

function normalizeTeam(row) {
  return {
    id: row.id,
    name: String(row.name || 'Unnamed team').trim(),
    requireApproval: Boolean(row.require_approval),
  }
}

function normalizeTeamStaffAssignment(row) {
  return {
    id: row.id,
    teamId: row.team_id || '',
    userId: row.user_id || '',
    createdAt: row.created_at || '',
  }
}

function getEntryIdentity(user, prefix = 'created_by') {
  return {
    [`${prefix}_name`]: String(user?.name || user?.email || '').trim(),
    [`${prefix}_email`]: String(user?.email || '').trim().toLowerCase(),
  }
}

function normalizeUser(row) {
  return {
    id: row.id,
    clubId: row.club_id || '',
    name: String(row.name || row.username || row.email || 'User').trim(),
    email: String(row.email || '').trim(),
    role: String(row.role || '').trim(),
    roleLabel: String(row.role_label || row.role || 'User').trim(),
    roleRank: Number(row.role_rank || 0),
    status: String(row.status || 'active').trim(),
  }
}

function normalizeClubRole(row) {
  return {
    id: row.id,
    roleKey: String(row.role_key || '').trim(),
    roleLabel: String(row.role_label || row.role_key || 'Role').trim(),
    roleRank: Number(row.role_rank || 0),
    isSystem: Boolean(row.is_system),
  }
}

const fallbackClubRoles = [
  { id: 'admin', roleKey: 'admin', roleLabel: 'Club Admin', roleRank: 90, isSystem: true },
  { id: 'head_manager', roleKey: 'head_manager', roleLabel: 'Team Admin', roleRank: 70, isSystem: true },
  { id: 'manager', roleKey: 'manager', roleLabel: 'Manager', roleRank: 50, isSystem: true },
  { id: 'coach', roleKey: 'coach', roleLabel: 'Coach', roleRank: 30, isSystem: true },
  { id: 'assistant_coach', roleKey: 'assistant_coach', roleLabel: 'Assistant Coach', roleRank: 20, isSystem: true },
]

function normalizeFormField(row) {
  return {
    id: row.id,
    label: String(row.label || 'Field').trim(),
    type: String(row.type || 'text').trim(),
    options: Array.isArray(row.options) ? row.options.map((option) => String(option)).filter(Boolean) : [],
    required: Boolean(row.required),
    isDefault: Boolean(row.is_default),
    isEnabled: row.is_enabled !== false,
    orderIndex: Number(row.order_index || 0),
  }
}

const fallbackAssessmentFields = [
  { id: 'technical', label: 'Technical', type: 'score_1_5', options: [], required: true, isDefault: true, orderIndex: 1 },
  { id: 'tactical', label: 'Tactical', type: 'score_1_5', options: [], required: true, isDefault: true, orderIndex: 2 },
  { id: 'physical', label: 'Physical', type: 'score_1_5', options: [], required: false, isDefault: true, orderIndex: 3 },
  { id: 'attitude', label: 'Attitude', type: 'score_1_5', options: [], required: true, isDefault: true, orderIndex: 4 },
  { id: 'strengths', label: 'Strengths', type: 'textarea', options: [], required: false, isDefault: true, orderIndex: 5 },
  { id: 'improvements', label: 'Improvements', type: 'textarea', options: [], required: false, isDefault: true, orderIndex: 6 },
  { id: 'overall-comments', label: 'Overall Comments', type: 'textarea', options: [], required: true, isDefault: true, orderIndex: 7 },
]

function normalizeTemplate(row) {
  const sectionAvailability = Array.isArray(row.section_availability)
    ? row.section_availability.map((section) => String(section || '').trim()).filter(Boolean)
    : []

  return {
    id: row.id,
    teamId: row.team_id || '',
    key: String(row.template_key || '').trim(),
    label: String(row.label || 'Template').trim(),
    subject: String(row.subject || '').trim(),
    body: String(row.body || '').trim(),
    audience: String(row.audience || 'parent').trim(),
    isEnabled: row.is_enabled !== false,
    sectionAvailability,
    orderIndex: Number(row.order_index || 0),
    isCustom: !['decline', 'progress', 'offer', 'assessment'].includes(String(row.template_key || '').trim()),
  }
}

function normalizeFeedback(row) {
  return {
    id: row.id,
    message: String(row.message || '').trim(),
    status: String(row.status || 'open').trim(),
    adminNote: String(row.admin_note || '').trim(),
    createdAt: row.created_at || '',
  }
}

function normalizeAuditLog(row) {
  return {
    id: row.id,
    action: String(row.action || 'activity').trim(),
    entityType: String(row.entity_type || '').trim(),
    createdAt: row.created_at || '',
  }
}

function normalizeClub(row) {
  return {
    id: row.id,
    name: String(row.name || '').trim(),
    contactEmail: String(row.contact_email || '').trim(),
    contactPhone: String(row.contact_phone || '').trim(),
    requireApproval: Boolean(row.require_approval),
  }
}

export async function getMobileSessions(user) {
  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  const { data, error } = await supabase
    .from('assessment_sessions')
    .select('id, title, team, opponent, session_type, session_date, status, completed_at, created_at')
    .eq('club_id', user.clubId)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    throw error
  }

  return (data || []).map(normalizeSession)
}

export async function getMobileSession(user, sessionId) {
  if (!user?.clubId || !sessionId) {
    throw new Error('Session details could not be loaded.')
  }

  const { data, error } = await supabase
    .from('assessment_sessions')
    .select('id, title, team, opponent, session_type, session_date, status, completed_at, created_at')
    .eq('club_id', user.clubId)
    .eq('id', sessionId)
    .single()

  if (error) {
    throw error
  }

  return normalizeSession(data)
}

export async function getMobileSessionPlayers(user, session) {
  if (!user?.clubId || !session?.team) {
    return []
  }

  const { data, error } = await supabase
    .from('players')
    .select('id, player_name, section, status, team, positions, parent_name, parent_email, parent_contacts, notes, created_at, updated_at')
    .eq('club_id', user.clubId)
    .eq('team', session.team)
    .neq('status', 'archived')
    .order('player_name', { ascending: true })

  if (error) {
    throw error
  }

  const players = (data || []).map(normalizePlayer)

  if (players.length === 0) {
    return []
  }

  const playerIds = players.map((player) => player.id).filter(Boolean)
  const { data: evaluations, error: evaluationsError } = await supabase
    .from('evaluations')
    .select('id, player_id, player_name, average_score, status, created_at')
    .eq('club_id', user.clubId)
    .eq('assessment_session_id', session.id)
    .in('player_id', playerIds)
    .order('created_at', { ascending: false })

  if (evaluationsError) {
    throw evaluationsError
  }

  const evaluationsByPlayerId = new Map()
  ;(evaluations || []).forEach((evaluation) => {
    if (!evaluationsByPlayerId.has(evaluation.player_id)) {
      evaluationsByPlayerId.set(evaluation.player_id, evaluation)
    }
  })

  return players.map((player) => {
    const evaluation = evaluationsByPlayerId.get(player.id)

    return {
      ...player,
      isAssessed: Boolean(evaluation),
      assessmentId: evaluation?.id || '',
      averageScore: typeof evaluation?.average_score === 'number' ? evaluation.average_score : null,
      assessmentStatus: String(evaluation?.status || '').trim(),
    }
  })
}

export async function getMobilePlayers(user) {
  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  const { data, error } = await supabase
    .from('players')
    .select('id, player_name, section, status, team, positions, parent_name, parent_email, parent_contacts, notes, created_at, updated_at')
    .eq('club_id', user.clubId)
    .neq('status', 'archived')
    .order('section', { ascending: true })
    .order('player_name', { ascending: true })
    .limit(50)

  if (error) {
    throw error
  }

  return (data || []).map(normalizePlayer)
}

export async function getMobileArchivedPlayers(user) {
  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  const { data, error } = await supabase
    .from('players')
    .select('id, player_name, section, status, team, positions, parent_name, parent_email, parent_contacts, notes, created_at, updated_at')
    .eq('club_id', user.clubId)
    .eq('status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    throw error
  }

  return (data || []).map(normalizePlayer)
}

export async function getMobileTeams(user) {
  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  const { data, error } = await supabase
    .from('teams')
    .select('id, name, require_approval')
    .eq('club_id', user.clubId)
    .order('name', { ascending: true })
    .limit(50)

  if (error) {
    throw error
  }

  return (data || []).map(normalizeTeam)
}

export async function createMobileTeam(user, team) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    throw new Error('Manager access is required to create teams.')
  }

  const name = String(team.name || '').trim()
  if (!name) {
    throw new Error('Team name is required.')
  }

  const { data, error } = await supabase
    .from('teams')
    .insert({
      club_id: user.clubId,
      name,
      require_approval: team.requireApproval !== false,
      created_by: user.id,
    })
    .select('id, name, require_approval')
    .single()

  if (error) {
    throw error
  }

  return normalizeTeam(data)
}

export async function updateMobileTeam(user, teamId, updates) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    throw new Error('Manager access is required to update teams.')
  }

  const payload = {}
  if (Object.prototype.hasOwnProperty.call(updates, 'requireApproval')) {
    payload.require_approval = Boolean(updates.requireApproval)
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
    payload.name = String(updates.name || '').trim()
  }

  const { data, error } = await supabase
    .from('teams')
    .update(payload)
    .eq('club_id', user.clubId)
    .eq('id', teamId)
    .select('id, name, require_approval')
    .single()

  if (error) {
    throw error
  }

  return normalizeTeam(data)
}

export async function getMobileTeamStaffAssignments(user) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    return []
  }

  const teams = await getMobileTeams(user)
  const teamIds = teams.map((team) => team.id).filter(Boolean)

  if (teamIds.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from('team_staff')
    .select('id, team_id, user_id, created_at')
    .in('team_id', teamIds)

  if (error) {
    throw error
  }

  return (data || []).map(normalizeTeamStaffAssignment)
}

export async function replaceMobileTeamStaffAssignments(user, teamId, userIds) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    throw new Error('Manager access is required to update team staff.')
  }

  const normalizedTeamId = String(teamId || '').trim()
  const normalizedUserIds = [...new Set((userIds || []).map((userId) => String(userId || '').trim()).filter(Boolean))]

  if (!normalizedTeamId) {
    throw new Error('Choose a team first.')
  }

  const { data: teamRow, error: teamError } = await supabase
    .from('teams')
    .select('id, club_id')
    .eq('club_id', user.clubId)
    .eq('id', normalizedTeamId)
    .single()

  if (teamError) {
    throw teamError
  }

  if (!teamRow?.id) {
    throw new Error('Team could not be found.')
  }

  if (normalizedUserIds.length > 0) {
    const { data: staffRows, error: staffError } = await supabase
      .from('users')
      .select('id, club_id')
      .eq('club_id', user.clubId)
      .in('id', normalizedUserIds)

    if (staffError) {
      throw staffError
    }

    const allowedUserIds = new Set((staffRows || []).map((staff) => String(staff.id || '')))
    const invalidUserIds = normalizedUserIds.filter((staffId) => !allowedUserIds.has(staffId))

    if (invalidUserIds.length > 0) {
      throw new Error('One or more selected staff members do not belong to this club.')
    }
  }

  const { error: deleteError } = await supabase.from('team_staff').delete().eq('team_id', normalizedTeamId)

  if (deleteError) {
    throw deleteError
  }

  if (normalizedUserIds.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from('team_staff')
    .insert(normalizedUserIds.map((staffId) => ({ team_id: normalizedTeamId, user_id: staffId })))
    .select('id, team_id, user_id, created_at')

  if (error) {
    throw error
  }

  return (data || []).map(normalizeTeamStaffAssignment)
}

export async function createMobileSession(user, session) {
  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to create sessions.')
  }

  const teamId = String(session.teamId || '').trim()
  const teamName = String(session.team || '').trim()
  const sessionDate = String(session.sessionDate || '').trim()
  const sessionType = session.sessionType === 'match' ? 'match' : 'training'
  const opponent = sessionType === 'match' ? String(session.opponent || '').trim() : ''

  if (!teamId || !teamName) {
    throw new Error('Choose a team.')
  }

  if (!sessionDate) {
    throw new Error('Session date is required.')
  }

  const { data, error } = await supabase
    .from('assessment_sessions')
    .insert({
      club_id: user.clubId,
      team_id: teamId,
      team: teamName,
      opponent,
      session_type: sessionType,
      session_date: sessionDate,
      title: opponent ? `${teamName} vs ${opponent}` : `${teamName} Technical Assessment`,
      created_by: user.id,
      ...getEntryIdentity(user),
      updated_by: user.id,
      ...getEntryIdentity(user, 'updated_by'),
    })
    .select('id, title, team, opponent, session_type, session_date, status, created_at')
    .single()

  if (error) {
    throw error
  }

  return normalizeSession(data)
}

export async function completeMobileSession(user, sessionId) {
  if (!user?.clubId || !sessionId) {
    throw new Error('Session details could not be completed.')
  }

  if (Number(user.roleRank || 0) < 50) {
    throw new Error('Manager access is required to complete sessions.')
  }

  const { data, error } = await supabase
    .from('assessment_sessions')
    .update({
      status: 'completed',
      completed_by: user.id,
      completed_by_name: user.name,
      completed_by_email: user.email,
      completed_at: new Date().toISOString(),
      updated_by: user.id,
      updated_by_name: user.name,
      updated_by_email: user.email,
      updated_at: new Date().toISOString(),
    })
    .eq('club_id', user.clubId)
    .eq('id', sessionId)
    .select('id, title, team, opponent, session_type, session_date, status, completed_at, created_at')
    .single()

  if (error) {
    throw error
  }

  return normalizeSession(data)
}

export async function archiveMobilePlayer(user, playerId) {
  if (!user?.clubId || !playerId) {
    throw new Error('Player details could not be archived.')
  }

  const { data, error } = await supabase
    .from('players')
    .update({
      status: 'archived',
      updated_by: user.id,
      updated_by_name: user.name,
      updated_by_email: user.email,
      updated_at: new Date().toISOString(),
    })
    .eq('club_id', user.clubId)
    .eq('id', playerId)
    .select('id, player_name, section, status, team, positions, parent_name, parent_email, parent_contacts, notes, created_at, updated_at')
    .single()

  if (error) {
    throw error
  }

  return normalizePlayer(data)
}

export async function restoreMobilePlayer(user, playerId) {
  if (!user?.clubId || !playerId) {
    throw new Error('Player details could not be restored.')
  }

  const { data, error } = await supabase
    .from('players')
    .update({
      status: 'active',
      updated_by: user.id,
      updated_by_name: user.name,
      updated_by_email: user.email,
      updated_at: new Date().toISOString(),
    })
    .eq('club_id', user.clubId)
    .eq('id', playerId)
    .select('id, player_name, section, status, team, positions, parent_name, parent_email, parent_contacts, notes, created_at, updated_at')
    .single()

  if (error) {
    throw error
  }

  return normalizePlayer(data)
}

export async function getMobileUsers(user) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    return []
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, club_id, email, username, name, role, role_label, role_rank, status')
    .eq('club_id', user.clubId)
    .order('role_rank', { ascending: false })
    .order('email', { ascending: true })
    .limit(100)

  if (error) {
    throw error
  }

  return (data || []).map(normalizeUser)
}

export async function getMobileClubRoles(user) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    return []
  }

  const { data, error } = await supabase
    .from('club_roles')
    .select('id, role_key, role_label, role_rank, is_system')
    .eq('club_id', user.clubId)
    .lte('role_rank', Number(user.roleRank || 0))
    .order('role_rank', { ascending: false })
    .order('role_label', { ascending: true })

  if (error) {
    throw error
  }

  const roles = (data || []).map(normalizeClubRole)
  const visibleFallbackRoles = fallbackClubRoles.filter((role) => role.roleRank <= Number(user.roleRank || 0))

  if (roles.length === 0) {
    return visibleFallbackRoles
  }

  const roleKeys = new Set(roles.map((role) => role.roleKey))
  return [
    ...roles,
    ...visibleFallbackRoles.filter((role) => !roleKeys.has(role.roleKey)),
  ].sort((left, right) => right.roleRank - left.roleRank || left.roleLabel.localeCompare(right.roleLabel))
}

function canManageMobileMember(actor, member) {
  return Boolean(
    actor?.clubId &&
      member?.id &&
      String(actor.id || '') !== String(member.id || '') &&
      String(actor.clubId || '') === String(member.clubId || actor.clubId || '') &&
      Number(actor.roleRank || 0) >= 50 &&
      Number(member.roleRank || 0) <= Number(actor.roleRank || 0),
  )
}

export async function updateMobileClubUser(user, member, updates) {
  if (!canManageMobileMember(user, member)) {
    throw new Error('You can only update users at your role level or below.')
  }

  const payload = {}
  const name = String(updates.name || '').trim()

  if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
    if (!name) {
      throw new Error('Name is required.')
    }
    payload.name = name
    payload.username = name
  }

  if (updates.role) {
    const roleRank = Number(updates.role.roleRank || 0)
    if (roleRank > Number(user.roleRank || 0)) {
      throw new Error('You cannot assign a role above your own access level.')
    }
    payload.role = String(updates.role.roleKey || '').trim()
    payload.role_label = String(updates.role.roleLabel || '').trim()
    payload.role_rank = roleRank
  }

  if (Object.keys(payload).length === 0) {
    throw new Error('No user changes were provided.')
  }

  const { data, error } = await supabase
    .from('users')
    .update(payload)
    .eq('club_id', user.clubId)
    .eq('id', member.id)
    .select('id, club_id, email, username, name, role, role_label, role_rank, status')
    .single()

  if (error) {
    throw error
  }

  return normalizeUser(data)
}

export async function getMobileFormFields(user) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    return []
  }

  const { data, error } = await supabase
    .from('form_fields')
    .select('id, label, type, options, required, is_default, is_enabled, order_index')
    .eq('club_id', user.clubId)
    .order('order_index', { ascending: true })
    .order('label', { ascending: true })

  if (error) {
    throw error
  }

  return (data || []).map(normalizeFormField)
}

export async function getMobileAssessmentFields(user) {
  const fields = (await getMobileFormFields(user)).filter((field) => field.isEnabled)
  if (fields.length === 0) {
    return fallbackAssessmentFields
  }

  const hasScoreFields = fields.some((field) => ['score_1_5', 'score_1_10', 'number'].includes(field.type))
  const hasCommentField = fields.some((field) => String(field.label || '').toLowerCase().includes('comment'))

  if (hasScoreFields && hasCommentField) {
    return fields
  }

  const existingLabels = new Set(fields.map((field) => String(field.label || '').trim().toLowerCase()))
  const missingFallbackFields = fallbackAssessmentFields.filter((field) => !existingLabels.has(field.label.toLowerCase()))

  return [...missingFallbackFields, ...fields].map((field, index) => ({
    ...field,
    orderIndex: index + 1,
  }))
}

export async function createMobileFormField(user, field) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    throw new Error('Manager access is required to create assessment fields.')
  }

  const label = String(field.label || '').trim()
  if (!label) {
    throw new Error('Field label is required.')
  }

  const { data, error } = await supabase
    .from('form_fields')
    .insert({
      club_id: user.clubId,
      label,
      type: ['text', 'textarea', 'score_1_5'].includes(field.type) ? field.type : 'text',
      required: Boolean(field.required),
      is_enabled: field.isEnabled !== false,
      order_index: Number(field.orderIndex || 100),
      is_default: false,
    })
    .select('id, label, type, required, is_default, is_enabled, order_index')
    .single()

  if (error) {
    throw error
  }

  return normalizeFormField(data)
}

export async function updateMobileFormField(user, fieldId, field) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    throw new Error('Manager access is required to update assessment fields.')
  }

  const label = String(field.label || '').trim()
  if (!label) {
    throw new Error('Field label is required.')
  }

  const { data, error } = await supabase
    .from('form_fields')
    .update({
      label,
      type: ['text', 'textarea', 'score_1_5'].includes(field.type) ? field.type : 'text',
      required: Boolean(field.required),
      is_enabled: field.isEnabled !== false,
    })
    .eq('club_id', user.clubId)
    .eq('id', fieldId)
    .select('id, label, type, required, is_default, is_enabled, order_index')
    .single()

  if (error) {
    throw error
  }

  return normalizeFormField(data)
}

export async function getMobileEmailTemplates(user, options = {}) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    return []
  }

  const teamId = String(options.teamId || '').trim()
  const audience = String(options.audience || 'all').trim().toLowerCase()
  const { data, error } = await supabase
    .from('parent_email_templates')
    .select('id, team_id, template_key, label, subject, body, audience, is_enabled, section_availability, order_index')
    .eq('club_id', user.clubId)
    .order('order_index', { ascending: true })
    .order('label', { ascending: true })

  let rows = data || []

  if (error) {
    throw error
  }

  if (teamId) {
    rows = rows.filter((row) => String(row.team_id || '') === teamId)
  }

  if (audience !== 'all') {
    rows = rows.filter((row) => String(row.audience || '').toLowerCase() === audience)
  }

  return rows.map(normalizeTemplate)
}

function createTemplateKey(label) {
  const base = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

  return `${base || 'mobile_template'}_${Date.now().toString(36)}`
}

export async function upsertMobileEmailTemplate(user, template) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    throw new Error('Manager access is required to manage email templates.')
  }

  const teamId = String(template.teamId || '').trim()
  const label = String(template.label || '').trim()
  const subject = String(template.subject || '').trim()
  const body = String(template.body || '').trim()
  const audience = template.audience === 'player' ? 'player' : 'parent'
  const templateKey = String(template.key || createTemplateKey(label)).trim().toLowerCase()

  if (!teamId) {
    throw new Error('Choose a team for this template.')
  }

  if (!label) {
    throw new Error('Template name is required.')
  }

  if (!subject) {
    throw new Error('Subject is required.')
  }

  if (!body) {
    throw new Error('Message body is required.')
  }

  const payload = {
    club_id: user.clubId,
    team_id: teamId,
    template_key: templateKey,
    label,
    subject,
    body,
    audience,
    is_enabled: template.isEnabled !== false,
    section_availability: Array.isArray(template.sectionAvailability) && template.sectionAvailability.length > 0
      ? template.sectionAvailability
      : ['Trial', 'Squad'],
    order_index: Number(template.orderIndex || 100),
    created_by: user.id,
    created_by_name: user.name,
    created_by_email: user.email,
    updated_by: user.id,
    updated_by_name: user.name,
    updated_by_email: user.email,
  }

  const { data, error } = await supabase
    .from('parent_email_templates')
    .upsert(payload, {
      onConflict: 'club_id,team_id,audience,template_key',
    })
    .select('id, team_id, template_key, label, subject, body, audience, is_enabled, section_availability, order_index')
    .single()

  if (error) {
    throw error
  }

  return normalizeTemplate(data)
}

export async function getMobileActivityLogs(user) {
  if (!user?.clubId || Number(user.roleRank || 0) < 50) {
    return []
  }

  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, entity_type, created_at')
    .eq('club_id', user.clubId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw error
  }

  return (data || []).map(normalizeAuditLog)
}

export async function getMobilePlatformFeedback(user) {
  if (!user?.id) {
    return []
  }

  const { data, error } = await supabase
    .from('platform_feedback')
    .select('id, message, status, admin_note, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw error
  }

  return (data || []).map(normalizeFeedback)
}

export async function createMobilePlatformFeedback(user, message) {
  const normalizedMessage = String(message || '').trim()
  if (!user?.id || !normalizedMessage) {
    throw new Error('Feedback message is required.')
  }

  const { data, error } = await supabase
    .from('platform_feedback')
    .insert({
      club_id: user.clubId || null,
      created_by: user.id,
      created_by_name: user.name,
      created_by_email: user.email,
      updated_by: user.id,
      updated_by_name: user.name,
      updated_by_email: user.email,
      message: normalizedMessage,
    })
    .select('id, message, status, admin_note, created_at')
    .single()

  if (error) {
    throw error
  }

  return normalizeFeedback(data)
}

export async function getMobileClubSettings(user) {
  if (!user?.clubId) {
    throw new Error('Club settings could not be loaded.')
  }

  const { data, error } = await supabase
    .from('clubs')
    .select('id, name, contact_email, contact_phone, require_approval')
    .eq('id', user.clubId)
    .single()

  if (error) {
    throw error
  }

  return normalizeClub(data)
}

export async function updateMobileClubSettings(user, settings) {
  if (!user?.clubId || user.role !== 'admin') {
    throw new Error('Club admin access is required to update club settings.')
  }

  const name = String(settings.name || '').trim()
  if (!name) {
    throw new Error('Club name is required.')
  }

  const { data, error } = await supabase
    .from('clubs')
    .update({
      name,
      contact_email: String(settings.contactEmail || '').trim().toLowerCase(),
      contact_phone: String(settings.contactPhone || '').trim(),
      require_approval: Boolean(settings.requireApproval),
    })
    .eq('id', user.clubId)
    .select('id, name, contact_email, contact_phone, require_approval')
    .single()

  if (error) {
    throw error
  }

  return normalizeClub(data)
}

export async function updateMobileUserProfile(user, profile) {
  if (!user?.id) {
    throw new Error('Account details could not be saved.')
  }

  const name = String(profile.name || '').trim()
  if (!name) {
    throw new Error('Name is required.')
  }

  const { data, error } = await supabase
    .from('users')
    .update({
      name,
      username: name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('id, club_id, email, username, name, role, role_label, role_rank, status')
    .single()

  if (error) {
    throw error
  }

  return normalizeUser(data)
}

export async function createMobilePlayer(user, player) {
  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to add players.')
  }

  const playerName = String(player.playerName || '').trim()
  const team = String(player.team || '').trim()
  const section = ['Trial', 'Squad'].includes(player.section) ? player.section : 'Trial'

  if (!playerName) {
    throw new Error('Player name is required.')
  }

  if (!team) {
    throw new Error('Choose a team.')
  }

  const parentName = String(player.parentName || '').trim()
  const parentEmail = String(player.parentEmail || '').trim().toLowerCase()
  const positions = String(player.positions || '')
    .split(',')
    .map((position) => position.trim())
    .filter(Boolean)

  const payload = {
    club_id: user.clubId,
    player_name: playerName,
    section,
    team,
    positions,
    contact_type: 'parent',
    parent_name: parentName,
    parent_email: parentEmail,
    parent_contacts: parentName || parentEmail ? [{ name: parentName, email: parentEmail }] : [],
    notes: String(player.notes || '').trim(),
    status: 'active',
    created_by: user.id,
    created_by_name: user.name,
    created_by_email: user.email,
    updated_by: user.id,
    updated_by_name: user.name,
    updated_by_email: user.email,
  }

  const { data, error } = await supabase
    .from('players')
    .insert(payload)
    .select('id, player_name, section, status, team, positions, parent_name, parent_email, parent_contacts, notes, created_at, updated_at')
    .single()

  if (error) {
    if (String(error.message || '').toLowerCase().includes('duplicate')) {
      throw new Error('This player already exists.')
    }
    throw error
  }

  return normalizePlayer(data)
}

export async function getMobilePlayer(user, playerId) {
  if (!user?.clubId || !playerId) {
    throw new Error('Player details could not be loaded.')
  }

  const { data, error } = await supabase
    .from('players')
    .select('id, player_name, section, status, team, positions, parent_name, parent_email, parent_contacts, notes, created_at, updated_at')
    .eq('club_id', user.clubId)
    .eq('id', playerId)
    .single()

  if (error) {
    throw error
  }

  return normalizePlayer(data)
}

export async function updateMobilePlayer(user, playerId, player) {
  if (!user?.clubId || !playerId) {
    throw new Error('Player details could not be saved.')
  }

  const playerName = String(player.playerName || '').trim()
  const team = String(player.team || '').trim()
  const section = ['Trial', 'Squad'].includes(player.section) ? player.section : 'Trial'

  if (!playerName) {
    throw new Error('Player name is required.')
  }

  if (!team) {
    throw new Error('Choose a team.')
  }

  const parentName = String(player.parentName || '').trim()
  const parentEmail = String(player.parentEmail || '').trim().toLowerCase()
  const positions = String(player.positions || '')
    .split(',')
    .map((position) => position.trim())
    .filter(Boolean)

  const payload = {
    player_name: playerName,
    section,
    team,
    positions,
    parent_name: parentName,
    parent_email: parentEmail,
    parent_contacts: parentName || parentEmail ? [{ name: parentName, email: parentEmail }] : [],
    notes: String(player.notes || '').trim(),
    updated_by: user.id,
    updated_by_name: user.name,
    updated_by_email: user.email,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('players')
    .update(payload)
    .eq('club_id', user.clubId)
    .eq('id', playerId)
    .select('id, player_name, section, status, team, positions, parent_name, parent_email, parent_contacts, notes, created_at, updated_at')
    .single()

  if (error) {
    throw error
  }

  return normalizePlayer(data)
}

export async function createMobileEvaluation(user, player, assessment, session = null) {
  if (!user?.clubId || !player?.id) {
    throw new Error('A player is required before saving an assessment.')
  }

  const formResponses = assessment.formResponses && typeof assessment.formResponses === 'object'
    ? assessment.formResponses
    : {
        Technical: Number(assessment.technical || 0),
        Tactical: Number(assessment.tactical || 0),
        Attitude: Number(assessment.attitude || 0),
        'Overall Comments': String(assessment.notes || '').trim(),
      }
  const scores = Object.fromEntries(
    Object.entries(formResponses)
      .map(([label, value]) => [label, Number(value)])
      .filter(([, value]) => !Number.isNaN(value) && value > 0),
  )
  const scoreValues = Object.values(scores)
  const averageScore = scoreValues.length > 0 ? scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length : null
  const findComment = (patterns) =>
    Object.entries(formResponses).find(([label]) => patterns.some((pattern) => label.toLowerCase().includes(pattern)))?.[1] || ''

  const payload = {
    player_name: player.playerName,
    player_id: player.id,
    team: player.team || session?.team || '',
    club_id: user.clubId,
    coach_id: user.id,
    coach: user.name || user.email || 'Coach',
    parent_email: player.parentEmail || null,
    parent_name: player.parentName || null,
    parent_contacts: player.parentName || player.parentEmail ? [{ name: player.parentName, email: player.parentEmail }] : [],
    session: session?.title || assessment.session || '',
    date: session?.sessionDate || new Date().toISOString().slice(0, 10),
    scores,
    average_score: averageScore !== null ? Number(averageScore.toFixed(1)) : null,
    comments: {
      strengths: String(findComment(['strength'])).trim(),
      improvements: String(findComment(['improvement', 'weakness', 'development'])).trim(),
      overall: String(findComment(['overall', 'summary', 'comment']) || assessment.notes || '').trim(),
      selectedStrengths: [],
    },
    decision: assessment.decision || '',
    status: 'Submitted',
    form_responses: formResponses,
    section: player.section || 'Trial',
    contact_type: 'parent',
    assessment_session_id: session?.id || null,
    created_by_name: user.name,
    created_by_email: user.email,
    updated_by: user.id,
    updated_by_name: user.name,
    updated_by_email: user.email,
  }

  const { data, error } = await supabase.from('evaluations').insert(payload).select('id, player_name, average_score, status, date').single()

  if (error) {
    throw error
  }

  return data
}

export async function getMobilePreviousEvaluations(user, player) {
  if (!user?.clubId || !player?.playerName) {
    return []
  }

  let query = supabase
    .from('evaluations')
    .select('id, player_name, team, section, session, date, coach, scores, average_score, comments, form_responses, status, created_at')
    .eq('club_id', user.clubId)
    .eq('player_name', player.playerName)
    .order('created_at', { ascending: false })
    .limit(5)

  if (player.team) {
    query = query.eq('team', player.team)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data || []).map((row) => ({
    id: row.id,
    date: String(row.date || row.created_at || '').slice(0, 10),
    session: String(row.session || '').trim(),
    team: String(row.team || '').trim(),
    section: String(row.section || '').trim(),
    coach: String(row.coach || '').trim(),
    status: String(row.status || '').trim(),
    averageScore: typeof row.average_score === 'number' ? row.average_score : null,
    formResponses: row.form_responses && typeof row.form_responses === 'object' ? row.form_responses : {},
    scores: row.scores && typeof row.scores === 'object' ? row.scores : {},
    comments: row.comments && typeof row.comments === 'object' ? row.comments : {},
  }))
}
