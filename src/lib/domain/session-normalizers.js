import { normalizeParentContacts } from './contact-utils.js'

export function normalizeAssessmentSessionRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    team: String(row.team ?? '').trim(),
    opponent: String(row.opponent ?? '').trim(),
    sessionType: String(row.session_type ?? row.sessionType ?? 'training').trim() || 'training',
    sessionDate: String(row.session_date ?? row.sessionDate ?? '').trim(),
    title: String(row.title ?? '').trim(),
    status: String(row.status ?? 'open').trim() || 'open',
    completedBy: row.completed_by ?? row.completedBy ?? '',
    completedByName: String(row.completed_by_name ?? row.completedByName ?? '').trim(),
    completedByEmail: String(row.completed_by_email ?? row.completedByEmail ?? '').trim(),
    completedAt: row.completed_at ?? row.completedAt ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdByEmail: String(row.created_by_email ?? row.createdByEmail ?? '').trim(),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: String(row.updated_by_name ?? row.updatedByName ?? '').trim(),
    updatedByEmail: String(row.updated_by_email ?? row.updatedByEmail ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

export function normalizeAssessmentSessionPlayerRow(row) {
  const playerRow = Array.isArray(row.players) ? row.players[0] : row.players
  const parentContacts = normalizeParentContacts(row.parent_contacts ?? playerRow?.parent_contacts, {
    parentName: row.parent_name ?? playerRow?.parent_name,
    parentEmail: row.parent_email ?? playerRow?.parent_email,
  })

  return {
    id: row.id,
    sessionId: row.session_id ?? row.sessionId ?? '',
    playerId: row.player_id ?? row.playerId ?? '',
    playerName: String(row.player_name ?? playerRow?.player_name ?? row.playerName ?? '').trim(),
    section: String(row.section ?? playerRow?.section ?? 'Trial').trim() || 'Trial',
    team: String(row.team ?? playerRow?.team ?? '').trim(),
    parentName: parentContacts[0]?.name ?? '',
    parentEmail: parentContacts[0]?.email ?? '',
    parentContacts,
    notes: String(row.notes ?? '').trim(),
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdByEmail: String(row.created_by_email ?? row.createdByEmail ?? '').trim(),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: String(row.updated_by_name ?? row.updatedByName ?? '').trim(),
    updatedByEmail: String(row.updated_by_email ?? row.updatedByEmail ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}
